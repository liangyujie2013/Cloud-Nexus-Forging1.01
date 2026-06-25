package v1

import (
	"github.com/cnf/cnfv1/internal/model"
	"github.com/cnf/cnfv1/internal/storage"
	"github.com/gofiber/fiber/v3"
)

// ============================================================================
// 功能 4：存储池生命周期
//
//	GET    /storage-pools           列表
//	GET    /storage-pools/:id       详情
//	POST   /storage-pools           创建（按 type 选择驱动并探测容量）
//	POST   /storage-pools/:id/refresh  刷新容量
//	DELETE /storage-pools/:id       删除
// ============================================================================

func (h *Handlers) listStoragePools(c fiber.Ctx) error {
	clusterID, _ := paramQueryInt(c, "cluster_id")
	pools, err := h.MySQL.ListStoragePools(c.Context(), clusterID)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": pools})
}

func (h *Handlers) getStoragePool(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	p, err := h.MySQL.GetStoragePool(c.Context(), id)
	if err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"data": p})
}

type createStoragePoolRequest struct {
	ClusterID  *int           `json:"cluster_id"`
	HostID     *int           `json:"host_id"`
	Name       string         `json:"name"`
	Type       string         `json:"type"`
	TargetPath string         `json:"target_path"`
	SourcePath string         `json:"source_path"`
	Config     map[string]any `json:"config"`
	IsShared   bool           `json:"is_shared"`
}

func (h *Handlers) createStoragePool(c fiber.Ctx) error {
	var req createStoragePoolRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Name == "" {
		return badRequest(c, "name 必填")
	}
	if req.Type == "" {
		req.Type = "local"
	}
	// 校验驱动类型有效（local/nfs/iscsi/...）
	if _, err := storage.Factory(req.Type); err != nil {
		return badRequest(c, "不支持的存储类型: "+req.Type)
	}

	pool := &model.StoragePool{
		ClusterID:  req.ClusterID,
		HostID:     req.HostID,
		Name:       req.Name,
		Type:       model.StoragePoolType(req.Type),
		TargetPath: req.TargetPath,
		SourcePath: req.SourcePath,
		Config:     req.Config,
		IsShared:   req.IsShared,
		Status:     "active",
	}

	// 尝试探测容量（local 类型可在控制面所在主机直接探测；其余在装配阶段绑定主机驱动）
	if drv, err := storage.Factory(req.Type); err == nil {
		cfg := req.Config
		if cfg == nil {
			cfg = map[string]any{}
		}
		if req.TargetPath != "" {
			cfg["path"] = req.TargetPath
		}
		if err := drv.Connect(c.Context(), cfg); err == nil {
			if cap, cerr := drv.GetCapacity(c.Context()); cerr == nil && cap != nil {
				pool.CapacityBytes = cap.TotalBytes
				pool.AllocatedBytes = cap.UsedBytes
				pool.AvailableBytes = cap.AvailableBytes
			}
			_ = drv.Disconnect(c.Context())
		}
	}

	id, err := h.MySQL.CreateStoragePool(c.Context(), pool)
	if err != nil {
		return badRequest(c, "创建失败: "+err.Error())
	}
	created, _ := h.MySQL.GetStoragePool(c.Context(), id)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": created})
}

func (h *Handlers) refreshStoragePool(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	p, err := h.MySQL.GetStoragePool(c.Context(), id)
	if err != nil {
		return hierarchyError(c, err)
	}
	drv, err := storage.Factory(string(p.Type))
	if err != nil {
		return badRequest(c, "不支持的存储类型")
	}
	cfg := p.Config
	if cfg == nil {
		cfg = map[string]any{}
	}
	if p.TargetPath != "" {
		cfg["path"] = p.TargetPath
	}
	if err := drv.Connect(c.Context(), cfg); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "连接存储失败: " + err.Error()})
	}
	defer drv.Disconnect(c.Context())
	cap, err := drv.GetCapacity(c.Context())
	if err != nil {
		return serverError(c, err)
	}
	if err := h.MySQL.UpdateStoragePoolUsage(c.Context(), id, cap.TotalBytes, cap.UsedBytes, cap.AvailableBytes); err != nil {
		return serverError(c, err)
	}
	updated, _ := h.MySQL.GetStoragePool(c.Context(), id)
	return c.JSON(fiber.Map{"data": updated})
}

func (h *Handlers) deleteStoragePool(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	if err := h.MySQL.DeleteStoragePool(c.Context(), id); err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}
