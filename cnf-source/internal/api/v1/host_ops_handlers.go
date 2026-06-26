package v1

import (
	"context"
	"errors"

	"github.com/cnf/cnfv1/internal/hostops"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/gofiber/fiber/v3"
)

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
