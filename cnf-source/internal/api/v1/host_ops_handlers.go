package v1

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/cnf/cnfv1/internal/hostops"
	"github.com/cnf/cnfv1/internal/model"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/gofiber/fiber/v3"
)

// getHostMetrics GET /hosts/:id/metrics —— 单主机实时性能指标（CPU%/内存/负载/磁盘）。
//
// 真实采集（两次 /proc/stat 采样算 CPU 占用、free -m、loadavg、df），用于详情/监控刷新。
func (h *Handlers) getHostMetrics(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		if errors.Is(err, mysql.ErrNoCredential) {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"data": fiber.Map{"reachable": false}, "code": "NO_CREDENTIAL",
				"error": "该主机未存储 SSH 凭据，无法采集性能指标。请更新凭据或重新纳管。",
			})
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"reachable": false}, "code": "SSH_UNREACHABLE", "error": err.Error(),
		})
	}
	defer cli.Close()

	m, err := hostops.CollectLiveMetrics(cli)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"reachable": false}, "code": "COLLECT_FAILED", "error": err.Error(),
		})
	}
	return c.JSON(fiber.Map{"data": m})
}

// getHostsMetrics GET /hosts/metrics —— 批量实时指标（列表卡片用），并发采集 + 整体超时。
//
// 返回 map：host_id(string) → LiveMetrics。无凭据/不可达的主机以 {reachable:false} 表示，
// 绝不伪造数据；前端据此显示「—」而非 NaN。
func (h *Handlers) getHostsMetrics(c fiber.Ctx) error {
	hosts, err := h.Repo.ListHosts(c.Context(), 0)
	if err != nil {
		return serverError(c, err)
	}

	results := make(map[string]any)
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8) // 限制并发，避免一次性大量 SSH

	// 整体超时：列表刷新不应被慢主机拖死。
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	for _, host := range hosts {
		hid := host.ID
		// 仅对有凭据的主机尝试采集
		if !h.hostHasCredential(c.Context(), hid) {
			results[itoa(hid)] = fiber.Map{"reachable": false, "code": "NO_CREDENTIAL"}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				mu.Lock()
				results[itoa(hid)] = fiber.Map{"reachable": false, "code": "TIMEOUT"}
				mu.Unlock()
				return
			}
			cli, derr := h.dialHost(ctx, hid)
			if derr != nil {
				mu.Lock()
				results[itoa(hid)] = fiber.Map{"reachable": false, "code": "SSH_UNREACHABLE"}
				mu.Unlock()
				return
			}
			defer cli.Close()
			m, merr := hostops.CollectLiveMetrics(cli)
			mu.Lock()
			if merr != nil {
				results[itoa(hid)] = fiber.Map{"reachable": false, "code": "COLLECT_FAILED"}
			} else {
				results[itoa(hid)] = m
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	return c.JSON(fiber.Map{"data": results})
}

func itoa(i int) string {
	return strconv.Itoa(i)
}

// getHostStatus GET /hosts/:id/status —— 通过存储的 SSH 凭据实时采集主机当前状态。
//
// 返回真实运行数据（uptime/负载/内存/磁盘/libvirt/KVM/SELinux/firewalld/SSH 端口）。
// 凭据缺失或 SSH 不可达时给出明确错误（绝不静默成功）。
func (h *Handlers) getHostStatus(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		if errors.Is(err, mysql.ErrNoCredential) {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"data": fiber.Map{"reachable": false},
				"error": "该主机未存储 SSH 凭据，无法实时采集状态。请在主机管理中更新凭据，或重新纳管。",
				"code":  "NO_CREDENTIAL",
			})
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data":  fiber.Map{"reachable": false},
			"error": err.Error(),
			"code":  "SSH_UNREACHABLE",
		})
	}
	defer cli.Close()

	st, err := hostops.CollectStatus(cli)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data":  fiber.Map{"reachable": false},
			"error": "采集主机状态失败: " + err.Error(),
			"code":  "COLLECT_FAILED",
		})
	}
	return c.JSON(fiber.Map{"data": st})
}

// hasCredential 小工具：判断主机是否已存凭据（供前端决定是否展示「需更新凭据」提示）。
func (h *Handlers) hostHasCredential(ctx context.Context, hostID int) bool {
	if h.MySQL == nil {
		return false
	}
	return h.MySQL.HasHostCredential(ctx, hostID)
}

// ============================================================
//  功能：主机网络（真实读取网卡 + DHCP↔静态切换写配置生效）
// ============================================================

// getHostNetwork GET /hosts/:id/network —— 通过 SSH 真实读取主机所有网卡。
//
// 返回每块网卡的 设备名/类型/MAC/状态/连接名/UUID/模式(DHCP|static)/IPv4/掩码/网关/DNS。
// 凭据缺失或不可达时给出明确错误码（NO_CREDENTIAL / SSH_UNREACHABLE / COLLECT_FAILED）。
func (h *Handlers) getHostNetwork(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		if errors.Is(err, mysql.ErrNoCredential) {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"data":  fiber.Map{"reachable": false},
				"error": "该主机未存储 SSH 凭据，无法读取网卡信息。请在主机管理中更新凭据，或重新纳管。",
				"code":  "NO_CREDENTIAL",
			})
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data":  fiber.Map{"reachable": false},
			"error": err.Error(),
			"code":  "SSH_UNREACHABLE",
		})
	}
	defer cli.Close()

	info, err := hostops.CollectNICs(cli)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data":  fiber.Map{"reachable": false},
			"error": "读取网卡信息失败: " + err.Error(),
			"code":  "COLLECT_FAILED",
		})
	}
	resp := fiber.Map{
		"reachable": true,
		"hostname":  info.Hostname,
		"nics":      info.NICs,
		"has_nm":    info.HasNM,
		"default_gw":  info.DefaultGW,
		"default_dev": info.DefaultDev,
		"warnings":  info.Warnings,
	}
	return c.JSON(fiber.Map{"data": resp})
}

// updateHostNetworkRequest 修改主机网卡请求体。
type updateHostNetworkRequest struct {
	Device  string `json:"device"`  // 目标网卡（必填）
	Mode    string `json:"mode"`    // dhcp | static（必填）
	IPv4    string `json:"ipv4"`    // static 必填
	Prefix  int    `json:"prefix"`  // static：前缀（与 netmask 二选一）
	Netmask string `json:"netmask"` // static：掩码（自动换算 prefix）
	Gateway string `json:"gateway"` // static 可选
	DNS     string `json:"dns"`     // 可选，逗号/空格分隔

	// 兼容旧前端字段（仅 IP/掩码/网关）：若未显式给 device，则尝试用 mgmt_nic。
	IP       string `json:"ip"`
	MgmtNIC  string `json:"mgmt_nic"`
}

// updateHostNetwork PUT /hosts/:id/network —— 真正修改主机网卡（DHCP↔静态），写配置并立即生效。
//
// 通过 nmcli 修改对应连接并 reapply/up。任一步失败返回明确错误（绝不静默成功）。
// 修改的是被纳管的目标主机，不触碰平台自身。
func (h *Handlers) updateHostNetwork(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var req updateHostNetworkRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}

	// 兼容旧前端：device 缺省取 mgmt_nic；ipv4 缺省取 ip；只给 IP 视为 static。
	if req.Device == "" {
		req.Device = req.MgmtNIC
	}
	if req.IPv4 == "" {
		req.IPv4 = req.IP
	}
	if req.Mode == "" {
		if req.IPv4 != "" {
			req.Mode = "static"
		} else {
			req.Mode = "dhcp"
		}
	}
	if req.Device == "" {
		return badRequest(c, "缺少目标网卡 device")
	}

	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		if errors.Is(err, mysql.ErrNoCredential) {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"error": "该主机未存储 SSH 凭据，无法修改网络。请先更新凭据或重新纳管。",
				"code":  "NO_CREDENTIAL",
			})
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"error": err.Error(),
			"code":  "SSH_UNREACHABLE",
		})
	}
	defer cli.Close()

	steps, err := hostops.ApplyNICConfig(cli, hostops.NICChange{
		Device:  req.Device,
		Mode:    req.Mode,
		IPv4:    req.IPv4,
		Prefix:  req.Prefix,
		Netmask: req.Netmask,
		Gateway: req.Gateway,
		DNS:     req.DNS,
	})
	if err != nil {
		// 改 IP 可能导致 SSH 断开但配置其实已写入——把已执行步骤一并回传，便于排查。
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"error": err.Error(),
			"code":  "APPLY_FAILED",
			"steps": steps,
		})
	}

	h.audit(c, "host.network.update", "host", id, map[string]any{
		"device": req.Device, "mode": req.Mode, "ipv4": req.IPv4, "gateway": req.Gateway,
	})

	return c.JSON(fiber.Map{
		"data":    fiber.Map{"steps": steps},
		"message": "主机网络已更新并生效",
	})
}

// ============================================================
//  功能：主机电源（reboot/shutdown 真实下发）与维护模式（真实前置检查 + 状态联动）
// ============================================================

// hostPower POST /hosts/:id/power  {action: reboot|shutdown}
//
// 通过 SSH 在目标主机真实下发 systemctl reboot/poweroff。power_on 需带外管理，
// 明确返回不支持（绝不伪造成功）。下发后把主机状态置为 disconnected（重启/关机后将失联），
// 由后续心跳/状态刷新恢复，前端因此能看到真实状态变化。
func (h *Handlers) hostPower(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var body struct {
		Action string `json:"action"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return badRequest(c, "请求体非法")
	}
	if body.Action == "" {
		return badRequest(c, "缺少 action（reboot/shutdown）")
	}

	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		if errors.Is(err, mysql.ErrNoCredential) {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"error": "该主机未存储 SSH 凭据，无法执行电源操作。请先更新凭据或重新纳管。",
				"code":  "NO_CREDENTIAL",
			})
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"error": err.Error(), "code": "SSH_UNREACHABLE"})
	}
	defer cli.Close()

	res, perr := hostops.PowerAction(cli, body.Action)
	if perr != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"error": perr.Error(), "code": "POWER_FAILED"})
	}

	// 真实联动：重启/关机后主机将失联，置为 disconnected，前端立即看到状态变化。
	_ = h.MySQL.UpdateHostStatus(c.Context(), id, model.HostDisconnected)

	h.audit(c, "host.power."+body.Action, "host", id, map[string]any{"action": body.Action})
	return c.JSON(fiber.Map{"data": res, "message": res.Message})
}

// setHostMaintenance POST /hosts/:id/maintenance  {enabled:bool}
//
// 进入维护模式前，用 virsh 真实核实目标主机上是否仍有运行中的虚拟机；存在则拒绝并回传
// 清单（前端提示先迁移/关机），绝不静默放行。通过后写 DB（maintenance_mode + status），
// 前端据此显示明显的维护标识与「退出维护」入口（功能联动、状态可见）。
func (h *Handlers) setHostMaintenance(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return badRequest(c, "请求体非法")
	}

	// 进入维护：前置核实运行中 VM。退出维护：无需检查。
	if body.Enabled {
		cli, derr := h.dialHost(c.Context(), id)
		if derr != nil {
			if errors.Is(derr, mysql.ErrNoCredential) {
				return c.Status(fiber.StatusOK).JSON(fiber.Map{
					"error": "该主机未存储 SSH 凭据，无法核实运行中虚拟机以安全进入维护模式。",
					"code":  "NO_CREDENTIAL",
				})
			}
			return c.Status(fiber.StatusOK).JSON(fiber.Map{"error": derr.Error(), "code": "SSH_UNREACHABLE"})
		}
		vms, verr := hostops.ListRunningVMs(cli)
		cli.Close()
		if verr != nil {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"error": "无法核实运行中虚拟机，为安全起见拒绝进入维护模式：" + verr.Error(),
				"code":  "VM_CHECK_FAILED",
			})
		}
		if len(vms) > 0 {
			children := make([]fiber.Map, 0, len(vms))
			for _, v := range vms {
				children = append(children, fiber.Map{"name": v.Name, "type": "vm"})
			}
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"error":    "该主机仍有运行中的虚拟机，请先迁移或关机后再进入维护模式",
				"code":     "HAS_RUNNING_VMS",
				"children": children,
			})
		}
	}

	if err := h.MySQL.SetHostMaintenance(c.Context(), id, body.Enabled); err != nil {
		return hierarchyError(c, err)
	}
	status := model.HostConnected
	msg := "已退出维护模式"
	if body.Enabled {
		status = model.HostMaintenance
		msg = "已进入维护模式"
	}
	h.audit(c, "host.maintenance", "host", id, map[string]any{"enabled": body.Enabled})
	// message 同时置于 data 内：前端 window.api() 成功时解包返回 data，需在 data 内才能读到提示文案。
	return c.JSON(fiber.Map{"data": fiber.Map{"status": string(status), "message": msg}, "message": msg})
}
