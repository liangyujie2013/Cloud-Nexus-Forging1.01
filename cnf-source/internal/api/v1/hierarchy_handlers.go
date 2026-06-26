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
		return errNotFound(c, CodeHostNotFound, "主机不存在")
	}
	return c.JSON(fiber.Map{"data": host})
}

// createHostRequest 最小主机纳管请求体（不经 SSH，仅落库 + 可选 libvirt 探测）。
type createHostRequest struct {
	ClusterID int    `json:"cluster_id"`
	Name      string `json:"name"`
	IPAddress string `json:"ip_address"`
	SSHPort   int    `json:"ssh_port"`
}

// createHost POST /hosts —— MVP 最小主机纳管（要求 5）。
//
// 仅持久化主机记录（name / ip_address / ssh_port / cluster_id），
// 随后尝试通过 libvirt（qemu+tcp）探测 CPU/内存/虚拟化能力：
//   - 探测成功 → status=connected，并回填 CPU 拓扑/内存/版本
//   - 探测失败 → status=provisioning（视为 unverified），probe.status=probe_failed
//     并在响应 details 里给出失败原因；绝不伪造纳管成功。
func (h *Handlers) createHost(c fiber.Ctx) error {
	var req createHostRequest
	if err := c.Bind().Body(&req); err != nil {
		return errBadRequest(c, "请求体非法")
	}
	missing := map[string]any{}
	if req.Name == "" {
		missing["name"] = "必填"
	}
	if req.IPAddress == "" {
		missing["ip_address"] = "必填"
	}
	if req.ClusterID <= 0 {
		missing["cluster_id"] = "必填且 > 0"
	}
	if len(missing) > 0 {
		return errValidation(c, "缺少必填字段", map[string]any{"fields": missing})
	}
	if req.SSHPort <= 0 {
		req.SSHPort = 22
	}

	// 1) 先落库（status=provisioning，表示尚未验证）
	host := &model.Host{
		ClusterID: req.ClusterID,
		Name:      req.Name,
		IPAddress: req.IPAddress,
		Status:    model.HostProvisioning,
	}
	id, err := h.Repo.UpsertHost(c.Context(), host)
	if err != nil {
		return errInternal(c, err)
	}

	// 2) 写审计日志（host.create）
	h.audit(c, "host.create", "host", id, map[string]any{
		"name": req.Name, "ip_address": req.IPAddress, "cluster_id": req.ClusterID,
	})

	// 3) 尝试 libvirt 探测硬件/虚拟化能力（不可用则明确标记，不静默成功）
	probe := h.probeHostCapabilities(c, id, req.IPAddress)

	saved, _ := h.Repo.GetHost(c.Context(), id)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"data":  saved,
		"probe": probe,
	})
}

// probeHostCapabilities 通过 libvirt 探测宿主机能力，回填并更新状态。
// 返回探测结果摘要：{status: verified|probe_failed, reason, ...}。
func (h *Handlers) probeHostCapabilities(c fiber.Ctx, hostID int, ip string) map[string]any {
	if h.Conn == nil {
		return map[string]any{"status": "unverified", "reason": "libvirt 连接管理器未初始化"}
	}
	caps, err := h.Conn.DiscoverHostCapabilities(ip)
	if err != nil {
		// 探测失败：保持 provisioning（unverified），明确返回原因。
		_ = h.MySQL.UpdateHostStatus(c.Context(), hostID, model.HostProvisioning)
		return map[string]any{
			"status": "probe_failed",
			"reason": "libvirt 探测失败（qemu+tcp 不可达或未开启）: " + err.Error(),
			"hint":   "请在宿主机执行 cnf-agent 或开启 libvirtd TCP（16509），参见部署文档",
		}
	}
	// 探测成功：回填 CPU/内存/版本并置 connected。
	caps.ClusterID = 0 // 不覆盖既有归属
	_ = h.MySQL.UpdateHostCapabilities(c.Context(), hostID, caps)
	_ = h.MySQL.UpdateHostStatus(c.Context(), hostID, model.HostConnected)
	return map[string]any{
		"status":          "verified",
		"cpu_model":       caps.CPUModel,
		"cpu_sockets":     caps.CPUSockets,
		"cpu_cores":       caps.CPUCoresPerSocket,
		"cpu_threads":     caps.CPUThreadsPerCore,
		"numa_nodes":      caps.NUMANodes,
		"memory_total_mb": caps.MemoryTotalMB,
		"libvirt_version": caps.LibvirtVersion,
		"qemu_version":    caps.QEMUVersion,
	}
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

// getHostHardware GET /hosts/:id/hardware —— 返回硬件清单与虚拟化能力。
//
// 优先尝试 libvirt 实时探测 CPU/内存/虚拟化能力；探测不可用时回退到
// 纳管时落库的硬件清单，并以 probe.status 明确标注 verified / probe_failed /
// unverified，绝不伪造探测成功（要求 5）。
func (h *Handlers) getHostHardware(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return errBadRequest(c, "id 非法")
	}
	host, err := h.Repo.GetHost(c.Context(), id)
	if err != nil {
		return errNotFound(c, CodeHostNotFound, "主机不存在")
	}

	// 落库的 SSH 硬件清单（可能为空）。
	inv, osVer, _ := h.MySQL.LoadHostHardware(c.Context(), id)

	// 实时 libvirt 探测。
	probe := map[string]any{"status": "unverified", "reason": "未进行 libvirt 探测"}
	var caps map[string]any
	if h.Conn != nil {
		if hc, perr := h.Conn.DiscoverHostCapabilities(host.IPAddress); perr == nil {
			caps = map[string]any{
				"cpu_model":       hc.CPUModel,
				"cpu_sockets":     hc.CPUSockets,
				"cpu_cores":       hc.CPUCoresPerSocket,
				"cpu_threads":     hc.CPUThreadsPerCore,
				"numa_nodes":      hc.NUMANodes,
				"numa_topology":   hc.NUMATopology,
				"memory_total_mb": hc.MemoryTotalMB,
				"libvirt_version": hc.LibvirtVersion,
				"qemu_version":    hc.QEMUVersion,
			}
			probe = map[string]any{"status": "verified", "source": "libvirt"}
		} else {
			probe = map[string]any{
				"status": "probe_failed",
				"reason": "libvirt 探测失败（qemu+tcp 不可达）: " + perr.Error(),
			}
		}
	}

	return c.JSON(fiber.Map{"data": fiber.Map{
		"host_id":            id,
		"ip_address":         host.IPAddress,
		"capabilities":       caps,
		"hardware_inventory": inv,
		"os_version":         osVer,
		"probe":              probe,
	}})
}
