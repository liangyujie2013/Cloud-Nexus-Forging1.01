package v1

// host_firewall_handlers.go —— 主机防火墙（firewalld）真实运维接口：
//   GET  /hosts/:id/firewall           读取单机防火墙状态（真实 firewall-cmd）
//   POST /hosts/:id/firewall           单机操作：开关 / 放行平台端口 / 自定义端口增删
//   POST /hosts/firewall/batch         多机批量操作（并发，逐机返回结果，绝不伪造）
//
// 设计：所有变更经 SSH 在目标机真实执行并持久化；任一主机失败不影响其它主机，逐机回传
// 真实结果（ok/steps/error），呼应「批量、单机均真实、清晰报错、联动」。

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/cnf/cnfv1/internal/hostops"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/gofiber/fiber/v3"
)

// hostSSHPort 取该主机凭据里的真实 SSH 端口（缺省 22），用于平台端口放行联动。
func (h *Handlers) hostSSHPort(ctx context.Context, hostID int) int {
	if h.MySQL == nil {
		return 22
	}
	cred, err := h.MySQL.GetHostCredential(ctx, hostID)
	if err != nil || cred.SSHPort <= 0 {
		return 22
	}
	return cred.SSHPort
}

// getHostFirewall GET /hosts/:id/firewall —— 真实读取防火墙状态。
func (h *Handlers) getHostFirewall(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		if errors.Is(err, mysql.ErrNoCredential) {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"data": fiber.Map{"reachable": false}, "code": "NO_CREDENTIAL",
				"error": "该主机未存储 SSH 凭据，无法读取防火墙状态。请更新凭据或重新纳管。",
			})
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"reachable": false}, "code": "SSH_UNREACHABLE", "error": err.Error(),
		})
	}
	defer cli.Close()

	st, ferr := hostops.CollectFirewall(cli, h.hostSSHPort(c.Context(), id))
	if ferr != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"reachable": false}, "code": "COLLECT_FAILED", "error": ferr.Error(),
		})
	}
	return c.JSON(fiber.Map{"data": fiber.Map{
		"reachable":              true,
		"installed":              st.Installed,
		"running":                st.Running,
		"default_zone":           st.DefaultZone,
		"open_ports":             st.OpenPorts,
		"open_services":          st.OpenServices,
		"platform_ready":         st.PlatformReady,
		"missing_platform_ports": st.MissingPlatformPorts,
		"warnings":               st.Warnings,
	}})
}

// firewallActionRequest 防火墙操作请求体。
//   action: enable | disable | open_platform | add_ports | remove_ports
//   ports : 自定义端口表达式列表（如 ["8080/tcp","6000-6010/udp"]），用于 add_ports/remove_ports
type firewallActionRequest struct {
	Action string   `json:"action"`
	Ports  []string `json:"ports"`
}

// applyFirewallAction 在单台主机上真实执行一个防火墙操作，返回已执行步骤。
func (h *Handlers) applyFirewallAction(ctx context.Context, hostID int, req firewallActionRequest) ([]string, error) {
	cli, err := h.dialHost(ctx, hostID)
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	switch req.Action {
	case "enable":
		steps, e := hostops.SetFirewallEnabled(cli, true)
		if e != nil {
			return steps, e
		}
		// 开启后默认放行平台必需端口（呼应「打开时默认开放平台所需端口」）
		pp, e2 := hostops.OpenPlatformPorts(cli, h.hostSSHPort(ctx, hostID))
		return append(steps, pp...), e2
	case "disable":
		return hostops.SetFirewallEnabled(cli, false)
	case "open_platform":
		return hostops.OpenPlatformPorts(cli, h.hostSSHPort(ctx, hostID))
	case "add_ports", "remove_ports":
		if len(req.Ports) == 0 {
			return nil, fmt.Errorf("未提供端口策略")
		}
		var ports []hostops.FirewallPort
		for _, s := range req.Ports {
			fp, perr := hostops.ParsePortSpec(s)
			if perr != nil {
				return nil, perr
			}
			ports = append(ports, fp)
		}
		return hostops.ApplyFirewallPorts(cli, ports, req.Action == "add_ports")
	default:
		return nil, fmt.Errorf("不支持的防火墙操作: %q", req.Action)
	}
}

// postHostFirewall POST /hosts/:id/firewall —— 单机防火墙操作（真实执行）。
func (h *Handlers) postHostFirewall(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var req firewallActionRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Action == "" {
		return badRequest(c, "缺少 action")
	}

	steps, aerr := h.applyFirewallAction(c.Context(), id, req)
	if aerr != nil {
		code := "FW_FAILED"
		if errors.Is(aerr, mysql.ErrNoCredential) {
			code = "NO_CREDENTIAL"
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"error": aerr.Error(), "code": code, "steps": steps})
	}
	h.audit(c, "host.firewall."+req.Action, "host", id, map[string]any{"ports": req.Ports})
	return c.JSON(fiber.Map{"data": fiber.Map{"steps": steps}, "message": "防火墙操作已生效"})
}

// firewallBatchRequest 多机批量请求体。
type firewallBatchRequest struct {
	HostIDs []int    `json:"host_ids"`
	Action  string   `json:"action"`
	Ports   []string `json:"ports"`
}

// postFirewallBatch POST /hosts/firewall/batch —— 多机批量防火墙操作。
//
// 并发对每台主机真实执行，逐机返回 {host_id, ok, steps?, error?}；
// 单机失败不影响其它主机，整体不伪造成功。
func (h *Handlers) postFirewallBatch(c fiber.Ctx) error {
	var req firewallBatchRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if len(req.HostIDs) == 0 {
		return badRequest(c, "host_ids 为空")
	}
	if req.Action == "" {
		return badRequest(c, "缺少 action")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	type result struct {
		HostID int      `json:"host_id"`
		OK     bool     `json:"ok"`
		Steps  []string `json:"steps,omitempty"`
		Error  string   `json:"error,omitempty"`
	}
	results := make([]result, len(req.HostIDs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	for i, hid := range req.HostIDs {
		wg.Add(1)
		go func(idx, hostID int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			steps, e := h.applyFirewallAction(ctx, hostID, firewallActionRequest{Action: req.Action, Ports: req.Ports})
			r := result{HostID: hostID, OK: e == nil, Steps: steps}
			if e != nil {
				r.Error = e.Error()
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
	h.audit(c, "host.firewall.batch."+req.Action, "host", 0, map[string]any{
		"host_ids": req.HostIDs, "ok": okCount, "total": len(req.HostIDs),
	})
	return c.JSON(fiber.Map{"data": fiber.Map{
		"results": results, "ok": okCount, "total": len(req.HostIDs),
	}, "message": fmt.Sprintf("批量防火墙操作完成：%d/%d 成功", okCount, len(req.HostIDs))})
}
