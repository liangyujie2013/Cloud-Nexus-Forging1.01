package v1

import (
	"errors"

	"github.com/cnf/cnfv1/internal/hostops"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/gofiber/fiber/v3"
)

// 第4点 标准交换机（Linux bridge + bond via nmcli）。
//
// 路由：
//   GET    /hosts/:id/switches            读取标准交换机 + 空闲上行网卡 + bond 模式选项
//   POST   /hosts/:id/switches            创建标准交换机（bond 可选，active-backup 默认）
//   DELETE /hosts/:id/switches/:name      删除标准交换机
//
// 所有操作经 SSH 真实下发；凭据缺失/不可达返回明确错误码。

func (h *Handlers) getHostSwitches(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		return switchDialErr(c, err)
	}
	defer cli.Close()

	inv, err := hostops.CollectSwitches(cli)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"reachable": false}, "error": "读取标准交换机失败: " + err.Error(), "code": "COLLECT_FAILED",
		})
	}
	return c.JSON(fiber.Map{"data": fiber.Map{
		"reachable":  true,
		"hostname":   inv.Hostname,
		"has_nm":     inv.HasNM,
		"switches":   inv.Switches,
		"free_nics":  inv.FreeNICs,
		"mgmt_dev":   inv.MgmtDev,
		"bond_modes": inv.BondModes,
		"warnings":   inv.Warnings,
	}})
}

func (h *Handlers) createHostSwitch(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var req hostops.CreateSwitchRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		return switchDialErr(c, err)
	}
	defer cli.Close()

	steps, err := hostops.CreateStandardSwitch(cli, req)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"steps": steps}, "error": err.Error(), "code": "APPLY_FAILED",
		})
	}
	h.audit(c, "host.switch.create", "host", id, fiber.Map{"name": req.Name, "uplinks": req.Uplinks, "bond_mode": req.BondMode})
	msg := "标准交换机 " + req.Name + " 创建成功"
	return c.JSON(fiber.Map{"data": fiber.Map{"steps": steps, "message": msg}, "message": msg})
}

func (h *Handlers) deleteHostSwitch(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	name := c.Params("name")
	if name == "" {
		return badRequest(c, "缺少交换机名")
	}
	ack := c.Query("ack_mgmt_risk") == "true" || c.Query("ack") == "true"
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		return switchDialErr(c, err)
	}
	defer cli.Close()

	steps, err := hostops.DeleteStandardSwitch(cli, name, ack)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"steps": steps}, "error": err.Error(), "code": "APPLY_FAILED",
		})
	}
	h.audit(c, "host.switch.delete", "host", id, fiber.Map{"name": name})
	msg := "标准交换机 " + name + " 已删除"
	return c.JSON(fiber.Map{"data": fiber.Map{"steps": steps, "message": msg}, "message": msg})
}

// switchDialErr 统一处理拨号错误为明确错误码（与其余 host 操作一致）。
func switchDialErr(c fiber.Ctx, err error) error {
	if errors.Is(err, mysql.ErrNoCredential) {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"reachable": false},
			"error": "该主机未存储 SSH 凭据，无法管理标准交换机。请先更新凭据或重新纳管。",
			"code":  "NO_CREDENTIAL",
		})
	}
	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"data": fiber.Map{"reachable": false}, "error": err.Error(), "code": "SSH_UNREACHABLE",
	})
}
