package v1

// host_sshport_handlers.go —— 修改主机 SSH 端口（真实、安全、可回退）：
//   POST /hosts/:id/ssh-port        单机改端口
//   POST /hosts/ssh-port/batch      多机批量改端口
//
// 安全流程（绝不伪造、改错可回退）：
//   1) 目标机双写 Port（旧+新）+ semanage + firewalld + 重启 sshd（PrepareSSHPortChange）
//   2) 用新端口真实回连验证 —— 通过才算成功
//   3) 验证通过：移除旧端口(FinalizeSSHPort) + 同步 DB host_credentials.ssh_port
//   4) 验证失败：保留旧端口（仍可访问），明确报错，不动 DB

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/cnf/cnfv1/internal/hostops"
	"github.com/cnf/cnfv1/internal/onboard"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/gofiber/fiber/v3"
)

type sshPortRequest struct {
	Port int `json:"port"`
}

// sshPortChangeOutcome 单机改端口的完整结果（含验证）。
type sshPortChangeOutcome struct {
	OldPort   int      `json:"old_port"`
	NewPort   int      `json:"new_port"`
	Steps     []string `json:"steps"`
	Verified  bool     `json:"verified"`
	Warnings  []string `json:"warnings"`
	Message   string   `json:"message"`
}

// changeHostSSHPort 在单台主机上完成「改端口 + 新端口验证 + 收尾 + 同步 DB」。
func (h *Handlers) changeHostSSHPort(ctx context.Context, hostID, newPort int) (*sshPortChangeOutcome, error) {
	cfg, err := h.loadHostSSHConfig(ctx, hostID)
	if err != nil {
		return nil, err
	}
	cli, err := onboard.Dial(cfg)
	if err != nil {
		return nil, fmt.Errorf("SSH 连接主机失败: %w", err)
	}

	// 1) 目标机双写 + 重启
	prep, perr := hostops.PrepareSSHPortChange(cli, newPort)
	cli.Close()
	if perr != nil {
		return nil, perr
	}
	out := &sshPortChangeOutcome{OldPort: prep.OldPort, NewPort: prep.NewPort, Steps: prep.Steps, Warnings: prep.Warnings}

	// 2) 用新端口真实回连验证（给 sshd 重启留出时间，重试几次）
	verifyCfg := cfg
	verifyCfg.Port = newPort
	verifyCfg.Timeout = 6 * time.Second
	var vcli *onboard.SSHClient
	var verr error
	for i := 0; i < 5; i++ {
		time.Sleep(1500 * time.Millisecond)
		vcli, verr = onboard.Dial(verifyCfg)
		if verr == nil {
			break
		}
	}
	if verr != nil {
		// 验证失败：旧端口仍在监听（双写），主机不会失联。不动 DB，明确报错。
		out.Verified = false
		out.Message = fmt.Sprintf("新端口 %d 回连验证失败，已保留旧端口 %d（主机未失联）。请检查云安全组/网络后重试：%v", newPort, prep.OldPort, verr)
		return out, fmt.Errorf(out.Message)
	}
	out.Verified = true

	// 3) 验证通过：移除旧端口收尾
	finSteps, ferr := hostops.FinalizeSSHPort(vcli, prep.OldPort, newPort)
	vcli.Close()
	out.Steps = append(out.Steps, finSteps...)
	if ferr != nil {
		// 收尾失败不影响新端口可用（双端口态），告警即可，仍同步 DB 为新端口。
		out.Warnings = append(out.Warnings, "移除旧端口收尾失败（新端口已可用）: "+ferr.Error())
	}

	// 4) 同步 DB：后续所有运维走新端口
	if e := h.MySQL.UpdateHostCredentialSSHPort(ctx, hostID, newPort); e != nil {
		out.Warnings = append(out.Warnings, "同步数据库 ssh_port 失败（请手动核对）: "+e.Error())
	}
	out.Message = fmt.Sprintf("SSH 端口已改为 %d 并验证通过，数据库已同步", newPort)
	return out, nil
}

// postHostSSHPort POST /hosts/:id/ssh-port —— 单机改 SSH 端口。
func (h *Handlers) postHostSSHPort(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var req sshPortRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Port < 1 || req.Port > 65535 {
		return badRequest(c, "端口非法（1-65535）")
	}

	out, cerr := h.changeHostSSHPort(c.Context(), id, req.Port)
	if cerr != nil {
		code := "SSHPORT_FAILED"
		if errors.Is(cerr, mysql.ErrNoCredential) {
			code = "NO_CREDENTIAL"
		}
		body := fiber.Map{"error": cerr.Error(), "code": code}
		if out != nil {
			body["data"] = out
		}
		return c.Status(fiber.StatusOK).JSON(body)
	}
	h.audit(c, "host.ssh_port.change", "host", id, map[string]any{"old": out.OldPort, "new": out.NewPort})
	return c.JSON(fiber.Map{"data": out, "message": out.Message})
}

type sshPortBatchRequest struct {
	HostIDs []int `json:"host_ids"`
	Port    int   `json:"port"`
}

// postSSHPortBatch POST /hosts/ssh-port/batch —— 多机批量改 SSH 端口。
func (h *Handlers) postSSHPortBatch(c fiber.Ctx) error {
	var req sshPortBatchRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if len(req.HostIDs) == 0 {
		return badRequest(c, "host_ids 为空")
	}
	if req.Port < 1 || req.Port > 65535 {
		return badRequest(c, "端口非法（1-65535）")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	type result struct {
		HostID   int      `json:"host_id"`
		OK       bool     `json:"ok"`
		Verified bool     `json:"verified"`
		OldPort  int      `json:"old_port,omitempty"`
		NewPort  int      `json:"new_port,omitempty"`
		Steps    []string `json:"steps,omitempty"`
		Error    string   `json:"error,omitempty"`
	}
	results := make([]result, len(req.HostIDs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4) // 改端口风险高，限制并发

	for i, hid := range req.HostIDs {
		wg.Add(1)
		go func(idx, hostID int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			r := result{HostID: hostID}
			out, e := h.changeHostSSHPort(ctx, hostID, req.Port)
			if out != nil {
				r.OldPort, r.NewPort, r.Steps, r.Verified = out.OldPort, out.NewPort, out.Steps, out.Verified
			}
			if e != nil {
				r.Error = e.Error()
			} else {
				r.OK = true
			}
			results[idx] = r
		}(i, hid)
	}
	wg.Wait()

	okCount := 0
	for _, r := range results {
		if r.OK {
			okCount++
		}
	}
	h.audit(c, "host.ssh_port.batch", "host", 0, map[string]any{"host_ids": req.HostIDs, "port": req.Port, "ok": okCount})
	return c.JSON(fiber.Map{"data": fiber.Map{
		"results": results, "ok": okCount, "total": len(req.HostIDs),
	}, "message": fmt.Sprintf("批量改 SSH 端口完成：%d/%d 成功（仅验证通过计为成功）", okCount, len(req.HostIDs))})
}
