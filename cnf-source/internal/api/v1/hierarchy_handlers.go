package v1

import (
	"errors"

	"github.com/cnf/cnfv1/internal/model"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/gofiber/fiber/v3"
)

// ============================================================================
// 功能 2：层级资源 CRUD —— Datacenter → Cluster → Host
// ============================================================================

func hierarchyError(c fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, mysql.ErrNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "资源不存在"})
	case errors.Is(err, mysql.ErrHasChildren):
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "存在下级资源，无法删除"})
	default:
		return serverError(c, err)
	}
}

// ---- 数据中心 ----

func (h *Handlers) listDatacenters(c fiber.Ctx) error {
	dcs, err := h.MySQL.ListDatacenters(c.Context())
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": dcs})
}

func (h *Handlers) getDatacenter(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	dc, err := h.MySQL.GetDatacenter(c.Context(), id)
	if err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"data": dc})
}

func (h *Handlers) createDatacenter(c fiber.Ctx) error {
	var in mysql.DatacenterInput
	if err := c.Bind().Body(&in); err != nil {
		return badRequest(c, "请求体非法")
	}
	if in.Name == "" {
		return badRequest(c, "name 必填")
	}
	dc, err := h.MySQL.CreateDatacenter(c.Context(), in)
	if err != nil {
		return badRequest(c, "创建失败: "+err.Error())
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": dc})
}

func (h *Handlers) updateDatacenter(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var in mysql.DatacenterInput
	if err := c.Bind().Body(&in); err != nil {
		return badRequest(c, "请求体非法")
	}
	dc, err := h.MySQL.UpdateDatacenter(c.Context(), id, in)
	if err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"data": dc})
}

func (h *Handlers) deleteDatacenter(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	if err := h.MySQL.DeleteDatacenter(c.Context(), id); err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}

// ---- 集群 ----

func (h *Handlers) listClusters(c fiber.Ctx) error {
	dcID, _ := paramQueryInt(c, "datacenter_id")
	clusters, err := h.MySQL.ListClusters(c.Context(), dcID)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": clusters})
}

func (h *Handlers) getCluster(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	cl, err := h.MySQL.GetCluster(c.Context(), id)
	if err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"data": cl})
}

func (h *Handlers) createCluster(c fiber.Ctx) error {
	var in mysql.ClusterInput
	if err := c.Bind().Body(&in); err != nil {
		return badRequest(c, "请求体非法")
	}
	if in.Name == "" || in.DatacenterID <= 0 {
		return badRequest(c, "name 与 datacenter_id 必填")
	}
	cl, err := h.MySQL.CreateCluster(c.Context(), in)
	if err != nil {
		return badRequest(c, "创建失败: "+err.Error())
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": cl})
}

func (h *Handlers) updateCluster(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var in mysql.ClusterInput
	if err := c.Bind().Body(&in); err != nil {
		return badRequest(c, "请求体非法")
	}
	cl, err := h.MySQL.UpdateCluster(c.Context(), id, in)
	if err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"data": cl})
}

func (h *Handlers) deleteCluster(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	if err := h.MySQL.DeleteCluster(c.Context(), id); err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}

// ---- 宿主机（列表/详情来自既有 Repo；删除/维护/硬件来自 MySQL 扩展）----

func (h *Handlers) listHosts(c fiber.Ctx) error {
	clusterID, _ := paramQueryInt(c, "cluster_id")
	hosts, err := h.Repo.ListHosts(c.Context(), clusterID)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": hosts})
}

func (h *Handlers) getHost(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	host, err := h.Repo.GetHost(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "主机不存在"})
	}
	return c.JSON(fiber.Map{"data": host})
}

func (h *Handlers) deleteHost(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	if err := h.MySQL.DeleteHost(c.Context(), id); err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}

// setHostMaintenance POST /hosts/:id/maintenance  {enabled:bool}
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
	if err := h.MySQL.SetHostMaintenance(c.Context(), id, body.Enabled); err != nil {
		return hierarchyError(c, err)
	}
	status := model.HostConnected
	if body.Enabled {
		status = model.HostMaintenance
	}
	return c.JSON(fiber.Map{"status": string(status)})
}

// getHostHardware GET /hosts/:id/hardware —— 返回纳管时采集的真实硬件清单。
func (h *Handlers) getHostHardware(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	inv, osVer, err := h.MySQL.LoadHostHardware(c.Context(), id)
	if err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"hardware_inventory": inv, "os_version": osVer}})
}
