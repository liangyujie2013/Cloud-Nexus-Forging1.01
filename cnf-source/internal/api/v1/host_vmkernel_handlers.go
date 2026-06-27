package v1

import (
	"github.com/cnf/cnfv1/internal/hostops"
	"github.com/gofiber/fiber/v3"
)

// 第7点 服务接口 / 流量标签 —— 主机级带 IP 的服务接口（management/vmotion/storage…）。
//
// 路由：
//   GET    /hosts/:id/vmkernels         读取服务接口列表 + 可用上行 + 流量标签选项
//   POST   /hosts/:id/vmkernels         创建一个带 IP + 流量标签的服务接口
//   DELETE /hosts/:id/vmkernels/:name   删除服务接口
//
// 所有操作经 SSH 真实下发；凭据缺失/不可达返回明确错误码（复用 switchDialErr）。

func (h *Handlers) getHostVMKernels(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		return switchDialErr(c, err)
	}
	defer cli.Close()

	inv, err := hostops.CollectVMKernels(cli)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"reachable": false}, "error": "读取服务接口失败: " + err.Error(), "code": "COLLECT_FAILED",
		})
	}
	return c.JSON(fiber.Map{"data": fiber.Map{
		"reachable": true,
		"hostname":  inv.Hostname,
		"has_nm":    inv.HasNM,
		"vmks":      inv.VMKs,
		"free_nics": inv.FreeNICs,
		"bridges":   inv.Bridges,
		"roles":     inv.Roles,
		"mgmt_dev":  inv.MgmtDev,
		"used_role": inv.UsedRole,
		"warnings":  inv.Warnings,
	}})
}

func (h *Handlers) createHostVMKernel(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var req hostops.CreateVMKernelRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		return switchDialErr(c, err)
	}
	defer cli.Close()

	steps, err := hostops.CreateVMKernel(cli, req)
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"steps": steps}, "error": err.Error(), "code": "APPLY_FAILED",
		})
	}
	h.audit(c, "host.vmkernel.create", "host", id, fiber.Map{"role": req.Role, "uplink": req.Uplink, "ip_mode": req.IPMode})
	msg := "服务接口创建成功"
	return c.JSON(fiber.Map{"data": fiber.Map{"steps": steps, "message": msg}, "message": msg})
}

func (h *Handlers) deleteHostVMKernel(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	name := c.Params("name")
	if name == "" {
		return badRequest(c, "缺少服务接口名")
	}
	ack := c.Query("ack_mgmt_risk") == "true" || c.Query("ack") == "true"
	cli, err := h.dialHost(c.Context(), id)
	if err != nil {
		return switchDialErr(c, err)
	}
	defer cli.Close()

	steps, err := hostops.DeleteVMKernel(cli, hostops.DeleteVMKernelRequest{Name: name, AckMgmtRisk: ack})
	if err != nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"data": fiber.Map{"steps": steps}, "error": err.Error(), "code": "APPLY_FAILED",
		})
	}
	h.audit(c, "host.vmkernel.delete", "host", id, fiber.Map{"name": name})
	msg := "服务接口 " + name + " 已删除"
	return c.JSON(fiber.Map{"data": fiber.Map{"steps": steps, "message": msg}, "message": msg})
}
