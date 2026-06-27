package v1

// host_selinux_handlers.go —— 主机 SELinux 真实运维接口：
//   GET  /hosts/:id/selinux        读取单机 SELinux 状态（运行时 + 持久）
//   POST /hosts/:id/selinux        单机设置模式（enforcing/permissive/disabled）
//   POST /hosts/selinux/batch      多机批量设置（并发，逐机真实结果）
//
// 设计：经 SSH 真实执行 setenforce + 改写 /etc/selinux/config；切到/从 disabled 需重启时
// 明确返回 reboot_required，绝不伪造即时生效。

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

// getHostSELinux GET /hosts/:id/selinux —— 真实读取 SELinux 状态。
func (h *Handlers) getHostSELinux(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		if errors.Is(err, mysql.ErrNoCredential) {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"data": fiber.Map{"reachable": false}, "code": "NO_CREDENTIAL",
				"error": "该主机未存储 SSH 凭据，无法读取 SELinux 状态。",
			})
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"reachable": false}, "code": "SSH_UNREACHABLE", "error": err.Error(),
		})
	}
	defer cli.Close()

	st, serr := hostops.CollectSELinux(cli)
	if serr != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"reachable": false}, "code": "COLLECT_FAILED", "error": serr.Error(),
		})
	}
	return c.JSON(fiber.Map{"data": fiber.Map{
		"reachable":  true,
		"available":  st.Available,
		"current":    st.Current,
		"persistent": st.Persistent,
		"consistent": st.Consistent,
		"warnings":   st.Warnings,
	}})
}

type selinuxActionRequest struct {
	Mode string `json:"mode"` // enforcing | permissive | disabled
}

// applySELinux 在单台主机上真实设置 SELinux 模式。
func (h *Handlers) applySELinux(ctx context.Context, hostID int, mode string) (*hostops.SELinuxResult, error) {
	cli, err := h.dialHost(ctx, hostID)
	if err != nil {
		return nil, err
	}
	defer cli.Close()
	return hostops.SetSELinux(cli, mode)
}

// postHostSELinux POST /hosts/:id/selinux —— 单机设置 SELinux 模式。
func (h *Handlers) postHostSELinux(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var req selinuxActionRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Mode == "" {
		return badRequest(c, "缺少 mode")
	}

	res, aerr := h.applySELinux(c.Context(), id, req.Mode)
	if aerr != nil {
		code := "SELINUX_FAILED"
		if errors.Is(aerr, mysql.ErrNoCredential) {
			code = "NO_CREDENTIAL"
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"error": aerr.Error(), "code": code})
	}
	h.audit(c, "host.selinux.set", "host", id, map[string]any{"mode": req.Mode, "reboot_required": res.RebootRequired})
	return c.JSON(fiber.Map{"data": fiber.Map{
		"steps":           res.Steps,
		"current":         res.Current,
		"persistent":      res.Persistent,
		"reboot_required": res.RebootRequired,
		"message":         res.Message,
	}, "message": res.Message})
}

type selinuxBatchRequest struct {
	HostIDs []int  `json:"host_ids"`
	Mode    string `json:"mode"`
}

// postSELinuxBatch POST /hosts/selinux/batch —— 多机批量设置 SELinux。
func (h *Handlers) postSELinuxBatch(c fiber.Ctx) error {
	var req selinuxBatchRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if len(req.HostIDs) == 0 {
		return badRequest(c, "host_ids 为空")
	}
	if req.Mode == "" {
		return badRequest(c, "缺少 mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	type result struct {
		HostID         int      `json:"host_id"`
		OK             bool     `json:"ok"`
		Steps          []string `json:"steps,omitempty"`
		RebootRequired bool     `json:"reboot_required"`
		Message        string   `json:"message,omitempty"`
		Error          string   `json:"error,omitempty"`
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
			r := result{HostID: hostID}
			res, e := h.applySELinux(ctx, hostID, req.Mode)
			if e != nil {
				r.Error = e.Error()
			} else {
				r.OK = true
				r.Steps = res.Steps
				r.RebootRequired = res.RebootRequired
				r.Message = res.Message
			}
			results[idx] = r
		}(i, hid)
	}
	wg.Wait()

	okCount := 0
	rebootN := 0
	for _, r := range results {
		if r.OK {
			okCount++
		}
		if r.RebootRequired {
			rebootN++
		}
	}
	h.audit(c, "host.selinux.batch", "host", 0, map[string]any{
		"host_ids": req.HostIDs, "mode": req.Mode, "ok": okCount, "reboot_required": rebootN,
	})
	return c.JSON(fiber.Map{"data": fiber.Map{
		"results": results, "ok": okCount, "total": len(req.HostIDs), "reboot_required_count": rebootN,
	}, "message": fmt.Sprintf("批量 SELinux 完成：%d/%d 成功，%d 台需重启", okCount, len(req.HostIDs), rebootN)})
}
