package v1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/cnf/cnfv1/internal/auth"
	"github.com/cnf/cnfv1/internal/model"
	"github.com/cnf/cnfv1/internal/onboard"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/gofiber/fiber/v3"
)

// ============================================================================
//  流式纳管（SSE）：POST /hosts/onboard-stream
//
//  目的：把「自动安装 libvirt + KVM 并纳管」的每一步真实执行状态（命令、逐行
//        stdout/stderr、成功/失败）通过 Server-Sent Events 实时推给前端，让用户
//        在向导第 4 步的日志框里看到真实进度，哪怕报错也能立刻看到原因。
//
//  事件类型（event:）：
//    step  —— 某步骤开始     data: {"name","command"}
//    line  —— 一行实时输出   data: {"line"}
//    done  —— 某步骤结束     data: {InstallStep}
//    result—— 全流程结束     data: {"ok","host","precheck","install","message","error"}
//    error —— 致命错误       data: {"error"}
// ============================================================================

// sseWriter 封装 SSE 帧写入，并发安全（onLine 可能来自多个 goroutine）。
type sseWriter struct {
	w  *bufio.Writer
	mu sync.Mutex
}

func (s *sseWriter) send(event string, payload any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := json.Marshal(payload)
	fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, b)
	_ = s.w.Flush()
}

// onboardHostStream POST /hosts/onboard-stream —— SSE 流式纳管。
func (h *Handlers) onboardHostStream(c fiber.Ctx) error {
	var req onboardRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.IPAddress == "" || req.ClusterID <= 0 {
		return badRequest(c, "ip_address 与 cluster_id 必填")
	}

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no") // 关闭反向代理缓冲，确保逐帧下发

	// 关键修复（之前 41% 报「读取流失败: network error」的真因）：
	//   Fiber v3 进入 SendStreamWriter 后，流式回调运行在请求生命周期之外，
	//   此时再访问请求上下文 c（c.Context() / c.IP() / auth.CurrentUserID(c) 等）会
	//   触发已回收 RequestCtx 的 nil 指针解引用 → panic，导致流在发出最终 result 帧
	//   之前就被异常关闭，前端 reader.read() 抛错显示 network error。
	//   解决：在进入流之前，把所有需要的请求态（用户、IP）一次性取出，并用脱离请求
	//   生命周期的 context.Background() 做流内的 DB 操作；流内绝不再碰 c。
	dbCtx := context.Background()
	var auditUID *int
	if uid, ok := auth.CurrentUserID(c); ok && uid > 0 {
		u := uid
		auditUID = &u
	}
	auditUsername := auth.CurrentUsername(c)
	clientIP := c.IP()

	return c.SendStreamWriter(func(w *bufio.Writer) {
		sse := &sseWriter{w: w}

		// 兜底：流内任何 panic 都转成 result(error) 帧后再退出，绝不让连接「无声中断」。
		defer func() {
			if r := recover(); r != nil {
				sse.send("result", fiber.Map{"ok": false, "error": fmt.Sprintf("纳管过程内部异常: %v", r)})
			}
		}()

		// 1) SSH 连接
		sse.send("step", fiber.Map{"name": "SSH 连接目标主机", "command": fmt.Sprintf("ssh %s@%s:%d", req.SSHUser, req.IPAddress, req.SSHPort)})
		cli, err := onboard.Dial(req.sshConfig())
		if err != nil {
			sse.send("done", onboard.InstallStep{Name: "SSH 连接目标主机", OK: false, Error: err.Error()})
			sse.send("result", fiber.Map{"ok": false, "error": "SSH 连接失败: " + err.Error()})
			return
		}
		defer cli.Close()
		sse.send("done", onboard.InstallStep{Name: "SSH 连接目标主机", OK: true, Output: "连接成功"})

		// 2) 预检
		sse.send("step", fiber.Map{"name": "环境预检（libvirt / KVM / TCP）", "command": "precheck"})
		pre, err := onboard.Precheck(cli, req.LibvirtPort)
		if err != nil {
			sse.send("result", fiber.Map{"ok": false, "error": "预检失败: " + err.Error()})
			return
		}
		sse.send("done", onboard.InstallStep{
			Name:   "环境预检（libvirt / KVM / TCP）",
			OK:     true,
			Output: fmt.Sprintf("libvirt=%v running=%v kvm=%v tcp=%v", pre.LibvirtInstalled, pre.LibvirtRunning, pre.KVMSupported, pre.TCPListening),
		})

		// 3) 自动安装（流式）——仅当启用且缺少组件
		var install *onboard.InstallResult
		if req.AutoInstall && (!pre.LibvirtInstalled || !pre.TCPListening) {
			emitter := &onboard.StepEmitter{
				OnStep:     func(name, command string) { sse.send("step", fiber.Map{"name": name, "command": command}) },
				OnLine:     func(line string) { sse.send("line", fiber.Map{"line": line}) },
				OnStepDone: func(step onboard.InstallStep) { sse.send("done", step) },
			}
			install, err = onboard.InstallVirtualizationStream(cli, onboard.InstallOptions{
				TCPPort:     req.LibvirtPort,
				OfflineRepo: h.OfflineRepo, // 在线失败自动回退离线包
			}, emitter)
			if err != nil {
				sse.send("result", fiber.Map{
					"ok": false, "error": "自动安装 libvirt + KVM 失败: " + err.Error(),
					"install": install,
				})
				return
			}
			if install != nil && install.Precheck != nil {
				pre = install.Precheck
			}
		}

		if !pre.LibvirtInstalled || !pre.KVMSupported {
			sse.send("result", fiber.Map{"ok": false, "error": pre.Message, "precheck": pre, "install": install})
			return
		}

		// 4) 采集硬件
		sse.send("step", fiber.Map{"name": "采集硬件清单", "command": "collect-hardware"})
		hw, err := onboard.CollectHardware(cli)
		if err != nil {
			sse.send("result", fiber.Map{"ok": false, "error": "采集硬件失败: " + err.Error(), "install": install})
			return
		}
		sse.send("done", onboard.InstallStep{Name: "采集硬件清单", OK: true, Output: fmt.Sprintf("%s · %d MB · %s", hw.CPUModel, hw.MemoryTotalMB, hw.OSVersion)})

		// 5) 落库
		sse.send("step", fiber.Map{"name": "写入主机记录", "command": "upsert-host"})
		name := req.Name
		if name == "" {
			name = hw.Hostname
		}
		host := &model.Host{
			ClusterID:         req.ClusterID,
			Name:              name,
			Hostname:          hw.Hostname,
			IPAddress:         req.IPAddress,
			CPUModel:          hw.CPUModel,
			CPUSockets:        hw.CPUSockets,
			CPUCoresPerSocket: hw.CPUCoresPerSock,
			CPUThreadsPerCore: hw.CPUThreadsPerCo,
			NUMANodes:         hw.NUMANodes,
			MemoryTotalMB:     hw.MemoryTotalMB,
			LibvirtVersion:    hw.LibvirtVersion,
			QEMUVersion:       hw.QEMUVersion,
			IOMMUEnabled:      hw.IOMMUEnabled,
			VFIOEnabled:       hw.IOMMUEnabled,
			Status:            model.HostProvisioning,
		}
		id, err := h.Repo.UpsertHost(dbCtx, host)
		if err != nil {
			sse.send("result", fiber.Map{"ok": false, "error": "写入主机记录失败: " + err.Error(), "install": install})
			return
		}
		inv := map[string]any{"gpus": hw.GPUs, "disks": hw.Disks, "nics": hw.NICs, "kernel": hw.KernelVersion}
		_ = h.MySQL.SaveHostHardware(dbCtx, id, inv, hw.OSVersion)
		sse.send("done", onboard.InstallStep{Name: "写入主机记录", OK: true, Output: fmt.Sprintf("host id=%d", id)})

		// 6) qemu+tcp 验证
		sse.send("step", fiber.Map{"name": "以 qemu+tcp 验证可达", "command": fmt.Sprintf("qemu+tcp://%s:%d/system", req.IPAddress, pre.TCPPort)})
		connStatus := model.HostProvisioning
		connMsg := pre.Message
		if pre.TCPListening && h.Conn != nil {
			if _, cerr := h.Conn.Get(req.IPAddress); cerr == nil {
				connStatus = model.HostConnected
				connMsg = "qemu+tcp 连接成功，纳管完成"
				sse.send("done", onboard.InstallStep{Name: "以 qemu+tcp 验证可达", OK: true, Output: connMsg})
			} else {
				connMsg = "硬件已采集，但 qemu+tcp 连接失败: " + cerr.Error()
				sse.send("done", onboard.InstallStep{Name: "以 qemu+tcp 验证可达", OK: false, Error: connMsg})
			}
		} else {
			sse.send("done", onboard.InstallStep{Name: "以 qemu+tcp 验证可达", OK: false, Error: "TCP 未监听，跳过"})
		}
		_ = h.MySQL.UpdateHostStatus(dbCtx, id, connStatus)

		// 用流前预先捕获的请求态写审计（绝不在流内碰 c，避免 RequestCtx 回收后的 nil panic）。
		if h.MySQL != nil {
			_ = h.MySQL.WriteAudit(dbCtx, mysql.AuditEntry{
				UserID:     auditUID,
				Username:   auditUsername,
				Action:     "host.create",
				Resource:   "host",
				ResourceID: id,
				Detail: map[string]any{
					"name": name, "ip_address": req.IPAddress, "method": "ssh-onboard-stream",
					"status": string(connStatus),
				},
				IPAddress: clientIP,
			})
		}

		saved, _ := h.Repo.GetHost(dbCtx, id)
		sse.send("result", fiber.Map{
			"ok":       true,
			"host":     saved,
			"precheck": pre,
			"install":  install,
			"message":  connMsg,
		})
	})
}

// ============================================================================
//  流式预检（SSE）：POST /hosts/precheck-stream
//
//  目的：把环境预检的每一项（网络 / SSH / CPU虚拟化 / libvirt组件 / 运行状态 / TCP /
//        硬件采集）逐项实时推给前端，避免「6 项一起转圈、全部跑完才一次性出结果」的
//        迟滞观感（用户反馈预检很慢、看不到进展）。
//
//  事件类型（event:）：
//    item   —— 单项预检完成   data: {"key","ok","level","detail"}
//    hw     —— 硬件采集完成   data: {hardware}
//    result —— 全流程结束     data: {"ok","precheck","hardware","error"}
//    error  —— 致命错误       data: {"error"}
// ============================================================================

// precheckHostStream POST /hosts/precheck-stream —— SSE 流式预检。
func (h *Handlers) precheckHostStream(c fiber.Ctx) error {
	var req onboardRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.IPAddress == "" {
		return badRequest(c, "ip_address 必填")
	}

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	return c.SendStreamWriter(func(w *bufio.Writer) {
		sse := &sseWriter{w: w}

		// 1) 网络可达 + SSH 连接（合并：Dial 成功即代表两者通过）
		cli, err := onboard.Dial(req.sshConfig())
		if err != nil {
			// 区分「网络不可达」与「SSH 认证失败」，给出更精准的逐项反馈。
			sse.send("item", fiber.Map{"key": "net", "ok": false, "level": "error", "detail": "不可达 / SSH 拒绝"})
			sse.send("item", fiber.Map{"key": "ssh", "ok": false, "level": "error", "detail": err.Error()})
			sse.send("result", fiber.Map{"ok": false, "error": "SSH 连接失败: " + err.Error()})
			return
		}
		defer cli.Close()
		sse.send("item", fiber.Map{"key": "net", "ok": true, "level": "success", "detail": "可达 · SSH 端口已开放"})
		sse.send("item", fiber.Map{"key": "ssh", "ok": true, "level": "success", "detail": "认证成功（" + req.SSHUser + "）"})

		// 2) 逐项预检（每完成一项立即下发）
		pre, err := onboard.PrecheckStream(cli, req.LibvirtPort, func(it onboard.PrecheckItem) {
			sse.send("item", fiber.Map{"key": it.Key, "ok": it.OK, "level": it.Level, "detail": it.Detail})
		})
		if err != nil {
			sse.send("result", fiber.Map{"ok": false, "error": "预检失败: " + err.Error()})
			return
		}

		// 3) 采集硬件（较慢，单独一项，完成后下发 hw 事件）
		hw, herr := onboard.CollectHardware(cli)
		if herr != nil {
			sse.send("item", fiber.Map{"key": "mem", "ok": false, "level": "warn", "detail": "硬件采集失败: " + herr.Error()})
		} else {
			sse.send("item", fiber.Map{"key": "mem", "ok": true, "level": "success",
				"detail": fmt.Sprintf("%d MB · %d 核 · %s", hw.MemoryTotalMB, hw.CPUSockets*hw.CPUCoresPerSock*hw.CPUThreadsPerCo, hw.OSVersion)})
			sse.send("hw", hw)
		}

		sse.send("result", fiber.Map{"ok": true, "precheck": pre, "hardware": hw})
	})
}

// ============================================================================
//  离线安装包管理：GET /offline-packages
//
//  列出平台预置的 libvirt/KVM 离线 RPM 包（按 os 版本分组）。当目标宿主机的
//  yum/dnf 在线源不可用时，纳管流程会自动推送这些包到目标主机本地安装。
// ============================================================================

// listOfflinePackages GET /offline-packages —— 列出离线包仓库内容。
func (h *Handlers) listOfflinePackages(c fiber.Ctx) error {
	if h.OfflineRepo == nil {
		return c.JSON(fiber.Map{"data": []any{}, "root": "", "enabled": false})
	}
	pkgs, err := h.OfflineRepo.List()
	if err != nil {
		return serverError(c, err)
	}
	// 按 os_tag 汇总数量，便于前端展示「已就绪的系统版本」。
	groups := map[string]int{}
	var total int64
	for _, p := range pkgs {
		groups[p.OSTag]++
		total += p.SizeKB
	}
	return c.JSON(fiber.Map{
		"data":          pkgs,
		"root":          h.OfflineRepo.Root,
		"enabled":       true,
		"groups":        groups,
		"total_size_kb": total,
	})
}
