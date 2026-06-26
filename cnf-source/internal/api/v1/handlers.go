package v1

import (
	"strconv"

	"github.com/cnf/cnfv1/internal/auth"
	"github.com/cnf/cnfv1/internal/cache"
	"github.com/cnf/cnfv1/internal/gpu"
	"github.com/cnf/cnfv1/internal/model"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/cnf/cnfv1/internal/service"
	"github.com/cnf/cnfv1/internal/storage"
	"github.com/cnf/cnfv1/internal/virt"
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
)

// Handlers 聚合所有 service 依赖，作为 HTTP 处理器的接收者。
// 由 main.go 装配后通过 RegisterRoutes 注入。
type Handlers struct {
	Repo      service.Repository
	MySQL     *mysql.Repository    // MySQL 仓储（层级/存储/网络等扩展 CRUD）
	Conn      *virt.ConnManager
	VM        *service.VMService
	Migration *service.MigrationService
	Snapshot  *service.SnapshotService
	GPU       *gpu.Manager
	Queue     *service.TaskQueue

	// 鉴权 / RBAC / 缓存
	Tokens *auth.TokenManager
	Auth   *auth.Store
	Mw     *auth.Middleware
	Cache  *cache.Client

	// DefaultStoragePool 默认存储池（创建 VM 系统盘时使用）。
	// 由装配层（main）按 CNF_STORAGE_LOCAL_PATH 初始化 LocalDriver 注入。
	DefaultStoragePool storage.Driver
}

// ---- 工具 ----

func paramInt(c fiber.Ctx, key string) (int, error) {
	return strconv.Atoi(c.Params(key))
}

// paramQueryInt 解析查询串中的整数参数；缺省或非法返回 0。
func paramQueryInt(c fiber.Ctx, key string) (int, error) {
	v := c.Query(key)
	if v == "" {
		return 0, nil
	}
	return strconv.Atoi(v)
}

func badRequest(c fiber.Ctx, msg string) error {
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": msg})
}

func serverError(c fiber.Ctx, err error) error {
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
}

// ============================================================================
// VM 生命周期
// ============================================================================

// listVMs GET /vms?cluster_id=
func (h *Handlers) listVMs(c fiber.Ctx) error {
	clusterID, _ := strconv.Atoi(c.Query("cluster_id"))
	vms, err := h.Repo.ListVMs(c.Context(), clusterID)
	if err != nil {
		return errInternal(c, err)
	}
	return c.JSON(fiber.Map{"data": vms})
}

// getVM GET /vms/:id
func (h *Handlers) getVM(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return errBadRequest(c, "非法 VM ID")
	}
	vm, err := h.Repo.GetVM(c.Context(), id)
	if err != nil {
		return errNotFound(c, CodeVMNotFound, "虚拟机不存在")
	}
	return c.JSON(fiber.Map{"data": vm})
}

// createVMRequest 创建 VM 的请求体。
type createVMRequest struct {
	VM           model.VM `json:"vm"`
	DiskSizeGB   int64    `json:"disk_size_gb"`
	TemplatePath string   `json:"template_path"`
	LinkedClone  bool     `json:"linked_clone"`
	DryRun       bool     `json:"dry_run"` // 仅预览 domain XML，不创建真实 VM
}

// createVM POST /vms
//
// dry_run=true（查询串或请求体）时仅生成并校验 domain XML，不分配磁盘、
// 不 define 到 libvirt、不落库，用于预览（区分 real 与 dry-run）。
func (h *Handlers) createVM(c fiber.Ctx) error {
	var req createVMRequest
	if err := c.Bind().Body(&req); err != nil {
		return errBadRequest(c, "请求体解析失败: "+err.Error())
	}

	// dry-run 预览：仅生成 XML，不触碰 libvirt / DB。
	if req.DryRun || c.Query("dry_run") == "true" {
		xml, err := virt.NewDomainXMLBuilder(&req.VM).Build()
		if err != nil {
			return errValidation(c, "生成 domain XML 失败", map[string]any{"cause": err.Error()})
		}
		return c.JSON(fiber.Map{
			"dry_run": true,
			"mode":    "dry-run",
			"xml":     xml,
			"message": "dry-run 预览：未创建真实虚拟机",
		})
	}

	if req.DiskSizeGB <= 0 {
		return errValidation(c, "disk_size_gb 必须 > 0", map[string]any{"field": "disk_size_gb"})
	}

	svcReq := &service.CreateVMRequest{
		VM:           &req.VM,
		DiskSizeGB:   req.DiskSizeGB,
		TemplatePath: req.TemplatePath,
		LinkedClone:  req.LinkedClone,
		// 注入默认存储池：当前按 CNF_STORAGE_LOCAL_PATH 初始化的 LocalDriver。
		// 后续可扩展为按 VM 所属集群的默认存储池路由。
		StoragePool: h.DefaultStoragePool,
	}

	vm, err := h.VM.Create(c.Context(), svcReq)
	if err != nil {
		return errInternal(c, err)
	}
	h.audit(c, "vm.create", "vm", vm.ID, map[string]any{"name": vm.Name, "mode": "real"})
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": vm, "mode": "real"})
}

// startVM POST /vms/:id/start
func (h *Handlers) startVM(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return errBadRequest(c, "非法 VM ID")
	}
	if err := h.VM.Start(c.Context(), id); err != nil {
		h.audit(c, "vm.start", "vm", id, map[string]any{"result": "failed", "error": err.Error()})
		return errInternal(c, err)
	}
	h.audit(c, "vm.start", "vm", id, map[string]any{"result": "ok"})
	return c.JSON(fiber.Map{"status": "running"})
}

// stopVM POST /vms/:id/stop?force=true
func (h *Handlers) stopVM(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return errBadRequest(c, "非法 VM ID")
	}
	graceful := c.Query("force") != "true"
	if err := h.VM.Stop(c.Context(), id, graceful); err != nil {
		h.audit(c, "vm.stop", "vm", id, map[string]any{"result": "failed", "error": err.Error()})
		return errInternal(c, err)
	}
	h.audit(c, "vm.stop", "vm", id, map[string]any{"result": "ok", "graceful": graceful})
	return c.JSON(fiber.Map{"status": "stopped"})
}

// deleteVM DELETE /vms/:id?delete_disks=true
func (h *Handlers) deleteVM(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return errBadRequest(c, "非法 VM ID")
	}
	deleteDisks := c.Query("delete_disks") == "true"
	if err := h.VM.Delete(c.Context(), id, deleteDisks, nil); err != nil {
		h.audit(c, "vm.delete", "vm", id, map[string]any{"result": "failed", "error": err.Error()})
		return errInternal(c, err)
	}
	h.audit(c, "vm.delete", "vm", id, map[string]any{"result": "ok", "delete_disks": deleteDisks})
	return c.JSON(fiber.Map{"status": "deleted"})
}

// vmXML GET /vms/:id/xml —— 预览 libvirt domain XML（运行态从 host 拉取）。
func (h *Handlers) vmXML(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return errBadRequest(c, "非法 VM ID")
	}
	vm, err := h.Repo.GetVM(c.Context(), id)
	if err != nil {
		return errNotFound(c, CodeVMNotFound, "虚拟机不存在")
	}
	// 优先返回从宿主机实时拉取的 XML；失败则用 builder 生成预览。
	if vm.HostID != nil {
		if host, err := h.Repo.GetHost(c.Context(), *vm.HostID); err == nil {
			if live, err := h.Conn.GetDomainXML(host.IPAddress, vm.Name); err == nil {
				c.Set("Content-Type", "application/xml")
				return c.SendString(live)
			}
		}
	}
	xml, err := virt.NewDomainXMLBuilder(vm).Build()
	if err != nil {
		return errInternal(c, err)
	}
	c.Set("Content-Type", "application/xml")
	return c.SendString(xml)
}

// ============================================================================
// 热迁移
// ============================================================================

type migrateRequest struct {
	DestHostID    int    `json:"dest_host_id"`
	Live          bool   `json:"live"`
	StorageMig    bool   `json:"storage_mig"`
	MaxDowntimeMs uint64 `json:"max_downtime_ms"`
	Compressed    bool   `json:"compressed"`
}

// migrateVM POST /vms/:id/migrate
func (h *Handlers) migrateVM(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "非法 VM ID")
	}
	var req migrateRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体解析失败: "+err.Error())
	}
	if req.DestHostID == 0 {
		return badRequest(c, "dest_host_id 必填")
	}
	err = h.Migration.Migrate(c.Context(), &service.MigrateRequest{
		VMID:          id,
		DestHostID:    req.DestHostID,
		Live:          req.Live,
		StorageMig:    req.StorageMig,
		MaxDowntimeMs: req.MaxDowntimeMs,
		Compressed:    req.Compressed,
	})
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"status": "migrated", "dest_host_id": req.DestHostID})
}

// migrationProgress GET /vms/:id/migrate/progress
func (h *Handlers) migrationProgress(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "非法 VM ID")
	}
	p, err := h.Migration.Progress(c.Context(), id)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"progress": p})
}

// ============================================================================
// 快照
// ============================================================================

type createSnapshotRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	WithMemory  bool   `json:"with_memory"`
	Quiesce     bool   `json:"quiesce"`
}

// createSnapshot POST /vms/:id/snapshots
func (h *Handlers) createSnapshot(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "非法 VM ID")
	}
	var req createSnapshotRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体解析失败: "+err.Error())
	}
	err = h.Snapshot.Create(c.Context(), &service.CreateSnapshotRequest{
		VMID:        id,
		Name:        req.Name,
		Description: req.Description,
		WithMemory:  req.WithMemory,
		Quiesce:     req.Quiesce,
	})
	if err != nil {
		return serverError(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "created", "name": req.Name})
}

// listSnapshots GET /vms/:id/snapshots
func (h *Handlers) listSnapshots(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "非法 VM ID")
	}
	names, err := h.Snapshot.List(c.Context(), id)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": names})
}

// revertSnapshot POST /vms/:id/snapshots/:name/revert
func (h *Handlers) revertSnapshot(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "非法 VM ID")
	}
	if err := h.Snapshot.Revert(c.Context(), id, c.Params("name")); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"status": "reverted"})
}

// deleteSnapshot DELETE /vms/:id/snapshots/:name
func (h *Handlers) deleteSnapshot(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "非法 VM ID")
	}
	if err := h.Snapshot.Delete(c.Context(), id, c.Params("name")); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}

// ============================================================================
// GPU
// ============================================================================

// listGPUs GET /gpus?host_id=
func (h *Handlers) listGPUs(c fiber.Ctx) error {
	hostID, _ := strconv.Atoi(c.Query("host_id"))
	gpus, err := h.Repo.ListGPUsByHost(c.Context(), hostID)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": gpus})
}

// gpuMetrics GET /gpus/:id/metrics —— 实时采集（nvidia-smi）。
func (h *Handlers) gpuMetrics(c fiber.Ctx) error {
	metrics, err := h.GPU.CollectNVIDIAMetrics(c.Context())
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": metrics})
}

// ============================================================================
// 任务
// ============================================================================

// cancelTask POST /tasks/:uuid/cancel
func (h *Handlers) cancelTask(c fiber.Ctx) error {
	u, err := uuid.Parse(c.Params("uuid"))
	if err != nil {
		return badRequest(c, "非法任务 UUID")
	}
	if h.Queue == nil || !h.Queue.Cancel(u) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "任务不存在或已结束"})
	}
	return c.JSON(fiber.Map{"status": "cancelling"})
}
