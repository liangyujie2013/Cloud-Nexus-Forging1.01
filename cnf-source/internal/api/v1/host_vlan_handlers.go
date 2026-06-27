package v1

import (
	"github.com/cnf/cnfv1/internal/hostops"
	"github.com/gofiber/fiber/v3"
)

// 第6点 VLAN（access + trunk）—— 基于标准交换机（bridge+bond）落地 VLAN 端口组。
//
// 路由：
//   GET    /hosts/:id/vlans            读取 access 端口组 + trunk 网桥 + 可用父设备
//   POST   /hosts/:id/vlans            创建 access VLAN 端口组（VLAN 子接口 + 专属网桥）
//   DELETE /hosts/:id/vlans/:name      删除 access VLAN 端口组
//   POST   /hosts/:id/vlans/trunk      在网桥上启用 VLAN 过滤并放行一组 VLAN（中继）
//
// 所有操作经 SSH 真实下发；凭据缺失/不可达返回明确错误码（复用 switchDialErr）。

func (h *Handlers) getHostVLANs(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		return switchDialErr(c, err)
	}
	defer cli.Close()

	inv, err := hostops.CollectVLANs(cli)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"reachable": false}, "error": "读取 VLAN 失败: " + err.Error(), "code": "COLLECT_FAILED",
		})
	}
	return c.JSON(fiber.Map{"data": fiber.Map{
		"reachable":     true,
		"hostname":      inv.Hostname,
		"has_nm":        inv.HasNM,
		"access_ports":  inv.AccessPorts,
		"trunk_bridges": inv.TrunkBridges,
		"parents":       inv.Parents,
		"warnings":      inv.Warnings,
	}})
}

func (h *Handlers) createHostVLAN(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var req hostops.CreateAccessVLANRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		return switchDialErr(c, err)
	}
	defer cli.Close()

	steps, err := hostops.CreateAccessVLAN(cli, req)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"steps": steps}, "error": err.Error(), "code": "APPLY_FAILED",
		})
	}
	h.audit(c, "host.vlan.create", "host", id, fiber.Map{"parent": req.Parent, "vlan_id": req.VLANID})
	msg := "access VLAN 端口组创建成功"
	return c.JSON(fiber.Map{"data": fiber.Map{"steps": steps, "message": msg}, "message": msg})
}

func (h *Handlers) deleteHostVLAN(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	name := c.Params("name")
	if name == "" {
		return badRequest(c, "缺少 VLAN 端口组名")
	}
	ack := c.Query("ack_mgmt_risk") == "true" || c.Query("ack") == "true"
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		return switchDialErr(c, err)
	}
	defer cli.Close()

	steps, err := hostops.DeleteAccessVLAN(cli, hostops.DeleteAccessVLANRequest{Name: name, AckMgmtRisk: ack})
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"steps": steps}, "error": err.Error(), "code": "APPLY_FAILED",
		})
	}
	h.audit(c, "host.vlan.delete", "host", id, fiber.Map{"name": name})
	msg := "access VLAN 端口组 " + name + " 已删除"
	return c.JSON(fiber.Map{"data": fiber.Map{"steps": steps, "message": msg}, "message": msg})
}

func (h *Handlers) setHostTrunk(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var req hostops.SetTrunkRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		return switchDialErr(c, err)
	}
	defer cli.Close()

	steps, err := hostops.SetTrunk(cli, req)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"steps": steps}, "error": err.Error(), "code": "APPLY_FAILED",
		})
	}
	h.audit(c, "host.vlan.trunk", "host", id, fiber.Map{"bridge": req.Bridge, "vlans": req.VLANs})
	msg := "trunk（VLAN 中继）配置成功"
	return c.JSON(fiber.Map{"data": fiber.Map{"steps": steps, "message": msg}, "message": msg})
}
