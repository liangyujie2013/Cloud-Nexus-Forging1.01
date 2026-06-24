// Package v1 注册 CNFv1.0 REST API v1 路由。
package v1

import (
	"github.com/cnf/cnfv1/internal/config"
	"github.com/gofiber/fiber/v3"
)

// RegisterRoutes 注册尚未接入 service 的骨架路由（认证、层级资源、存储、监控流）。
// 这些端点的业务实现将在后续迭代补全；VM/迁移/快照/GPU 等核心能力
// 已由 RegisterAPIRoutes 接入真实 service 层。
func RegisterRoutes(app *fiber.App, cfg *config.Config) {
	api := app.Group("/api/v1")

	// 认证
	api.Post("/auth/login", notImplemented)

	// 层级资源
	api.Get("/datacenters", notImplemented)
	api.Post("/datacenters", notImplemented)
	api.Get("/clusters", notImplemented)
	api.Post("/clusters", notImplemented)
	api.Get("/hosts", notImplemented)
	api.Post("/hosts", notImplemented)

	// 存储
	api.Get("/storage-pools", notImplemented)
	api.Post("/storage-pools", notImplemented)

	// 监控（SSE 实时流）
	api.Get("/metrics/stream", notImplemented)
}

// RegisterAPIRoutes 接入真实 service 层，注册 VM 生命周期、热迁移、
// 快照、GPU、任务等核心 REST 端点。由 main 装配 Handlers 后调用。
func RegisterAPIRoutes(app *fiber.App, h *Handlers) {
	api := app.Group("/api/v1")

	// 虚拟机生命周期
	api.Get("/vms", h.listVMs)
	api.Post("/vms", h.createVM) // 创建（含 CPU 拓扑/绑核/NUMA/GPU/链式克隆）
	api.Get("/vms/:id", h.getVM)
	api.Delete("/vms/:id", h.deleteVM)
	api.Post("/vms/:id/start", h.startVM)
	api.Post("/vms/:id/stop", h.stopVM)
	api.Get("/vms/:id/xml", h.vmXML) // 预览/拉取 libvirt domain XML

	// 热迁移
	api.Post("/vms/:id/migrate", h.migrateVM)
	api.Get("/vms/:id/migrate/progress", h.migrationProgress)

	// 快照（含 NVRAM + 内存）
	api.Get("/vms/:id/snapshots", h.listSnapshots)
	api.Post("/vms/:id/snapshots", h.createSnapshot)
	api.Post("/vms/:id/snapshots/:name/revert", h.revertSnapshot)
	api.Delete("/vms/:id/snapshots/:name", h.deleteSnapshot)

	// GPU
	api.Get("/gpus", h.listGPUs)
	api.Get("/gpus/:id/metrics", h.gpuMetrics) // 实时 nvidia-smi 采集

	// 任务
	api.Post("/tasks/:uuid/cancel", h.cancelTask)
}

func notImplemented(c fiber.Ctx) error {
	return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
		"error": "endpoint scaffolded; implement in service layer",
		"path":  c.Path(),
	})
}
