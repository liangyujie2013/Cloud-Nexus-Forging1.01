// Package v1 注册 CNFv1.0 REST API v1 路由。
package v1

import (
	"github.com/gofiber/fiber/v3"
)

// RegisterAPIRoutes 注册全部 REST API v1 端点，并按权限点应用 RBAC 中间件。
//
// 鉴权策略：
//   - /api/v1/auth/login 为公开端点（登录换取 JWT），不经鉴权。
//   - 其余所有端点先经 h.Mw.Authenticate 解析 Bearer Token、注入身份，
//     再经 h.Mw.RequirePermission("resource.action") 校验角色权限点。
//   - 权限点采用 resource.action 形式；admin 角色持有 "*" 通配全部。
//
// 由 main.go 装配 Handlers（含 MySQL/Conn/VM/Auth/Mw/Cache 等）后调用。
func RegisterAPIRoutes(app *fiber.App, h *Handlers) {
	api := app.Group("/api/v1")

	// ---- 认证（公开） ----
	api.Post("/auth/login", h.login)

	// ---- 以下端点统一要求登录 ----
	api.Use(h.Mw.Authenticate)

	// ---- 当前用户 / 改密 ----
	api.Get("/auth/me", h.me)
	api.Post("/auth/change-password", h.changePassword)

	// ---- 用户管理（RBAC: user.*） ----
	api.Get("/users", h.Mw.RequirePermission("user.read"), h.listUsers)
	api.Post("/users", h.Mw.RequirePermission("user.create"), h.createUser)
	api.Post("/users/:id/enabled", h.Mw.RequirePermission("user.update"), h.setUserEnabled)
	api.Post("/users/:id/reset-password", h.Mw.RequirePermission("user.update"), h.resetUserPassword)
	api.Delete("/users/:id", h.Mw.RequirePermission("user.delete"), h.deleteUser)

	// ---- 角色管理（RBAC: role.*） ----
	api.Get("/roles", h.Mw.RequirePermission("role.read"), h.listRoles)
	api.Post("/roles", h.Mw.RequirePermission("role.create"), h.createRole)
	api.Put("/roles/:id", h.Mw.RequirePermission("role.update"), h.updateRole)
	api.Delete("/roles/:id", h.Mw.RequirePermission("role.delete"), h.deleteRole)

	// ---- 数据中心（RBAC: datacenter.*） ----
	api.Get("/datacenters", h.Mw.RequirePermission("datacenter.read"), h.listDatacenters)
	api.Get("/datacenters/:id", h.Mw.RequirePermission("datacenter.read"), h.getDatacenter)
	api.Post("/datacenters", h.Mw.RequirePermission("datacenter.create"), h.createDatacenter)
	api.Put("/datacenters/:id", h.Mw.RequirePermission("datacenter.update"), h.updateDatacenter)
	api.Delete("/datacenters/:id", h.Mw.RequirePermission("datacenter.delete"), h.deleteDatacenter)

	// ---- 集群（RBAC: cluster.*） ----
	api.Get("/clusters", h.Mw.RequirePermission("cluster.read"), h.listClusters)
	api.Get("/clusters/:id", h.Mw.RequirePermission("cluster.read"), h.getCluster)
	api.Post("/clusters", h.Mw.RequirePermission("cluster.create"), h.createCluster)
	api.Put("/clusters/:id", h.Mw.RequirePermission("cluster.update"), h.updateCluster)
	api.Delete("/clusters/:id", h.Mw.RequirePermission("cluster.delete"), h.deleteCluster)

	// ---- 主机（RBAC: host.*；含纳管 onboarding） ----
	api.Get("/hosts", h.Mw.RequirePermission("host.read"), h.listHosts)
	api.Get("/hosts/:id", h.Mw.RequirePermission("host.read"), h.getHost)
	api.Get("/hosts/:id/hardware", h.Mw.RequirePermission("host.read"), h.getHostHardware)
	api.Post("/hosts/precheck", h.Mw.RequirePermission("host.create"), h.precheckHost)
	api.Post("/hosts/onboard", h.Mw.RequirePermission("host.create"), h.onboardHost)
	api.Post("/hosts/:id/enable-tcp", h.Mw.RequirePermission("host.update"), h.enableHostTCP)
	api.Post("/hosts/:id/maintenance", h.Mw.RequirePermission("host.update"), h.setHostMaintenance)
	api.Delete("/hosts/:id", h.Mw.RequirePermission("host.delete"), h.deleteHost)

	// ---- 虚拟机生命周期（RBAC: vm.*） ----
	api.Get("/vms", h.Mw.RequirePermission("vm.read"), h.listVMs)
	api.Get("/vms/:id", h.Mw.RequirePermission("vm.read"), h.getVM)
	api.Get("/vms/:id/xml", h.Mw.RequirePermission("vm.read"), h.vmXML)
	api.Post("/vms", h.Mw.RequirePermission("vm.create"), h.createVM)
	api.Delete("/vms/:id", h.Mw.RequirePermission("vm.delete"), h.deleteVM)
	api.Post("/vms/:id/start", h.Mw.RequirePermission("vm.power"), h.startVM)
	api.Post("/vms/:id/stop", h.Mw.RequirePermission("vm.power"), h.stopVM)

	// 热迁移
	api.Post("/vms/:id/migrate", h.Mw.RequirePermission("vm.migrate"), h.migrateVM)
	api.Get("/vms/:id/migrate/progress", h.Mw.RequirePermission("vm.read"), h.migrationProgress)

	// 快照
	api.Get("/vms/:id/snapshots", h.Mw.RequirePermission("vm.read"), h.listSnapshots)
	api.Post("/vms/:id/snapshots", h.Mw.RequirePermission("vm.snapshot"), h.createSnapshot)
	api.Post("/vms/:id/snapshots/:name/revert", h.Mw.RequirePermission("vm.snapshot"), h.revertSnapshot)
	api.Delete("/vms/:id/snapshots/:name", h.Mw.RequirePermission("vm.snapshot"), h.deleteSnapshot)

	// ---- 存储池（RBAC: storage.*） ----
	api.Get("/storage-pools", h.Mw.RequirePermission("storage.read"), h.listStoragePools)
	api.Get("/storage-pools/:id", h.Mw.RequirePermission("storage.read"), h.getStoragePool)
	api.Post("/storage-pools", h.Mw.RequirePermission("storage.create"), h.createStoragePool)
	api.Post("/storage-pools/:id/refresh", h.Mw.RequirePermission("storage.update"), h.refreshStoragePool)
	api.Delete("/storage-pools/:id", h.Mw.RequirePermission("storage.delete"), h.deleteStoragePool)

	// ---- 虚拟交换机 / 网络（RBAC: network.*） ----
	api.Get("/vswitches", h.Mw.RequirePermission("network.read"), h.listVSwitches)
	api.Post("/vswitches", h.Mw.RequirePermission("network.create"), h.createVSwitch)
	api.Delete("/vswitches/:id", h.Mw.RequirePermission("network.delete"), h.deleteVSwitch)
	api.Get("/networks", h.Mw.RequirePermission("network.read"), h.listNetworks)
	api.Post("/networks", h.Mw.RequirePermission("network.create"), h.createNetwork)
	api.Delete("/networks/:id", h.Mw.RequirePermission("network.delete"), h.deleteNetwork)

	// ---- GPU（RBAC: gpu.*） ----
	api.Get("/gpus", h.Mw.RequirePermission("gpu.read"), h.listGPUs)
	api.Get("/gpus/:id/metrics", h.Mw.RequirePermission("gpu.read"), h.gpuMetrics)

	// ---- 监控（RBAC: monitor.*） ----
	api.Get("/metrics/stream", h.Mw.RequirePermission("monitor.read"), h.metricsStream)
	api.Get("/metrics/history", h.Mw.RequirePermission("monitor.read"), h.metricsHistory)
	api.Get("/alert-rules", h.Mw.RequirePermission("monitor.read"), h.listAlertRules)
	api.Post("/alert-rules", h.Mw.RequirePermission("monitor.update"), h.createAlertRule)
	api.Post("/alert-rules/:id/enabled", h.Mw.RequirePermission("monitor.update"), h.setAlertRuleEnabled)
	api.Delete("/alert-rules/:id", h.Mw.RequirePermission("monitor.update"), h.deleteAlertRule)

	// ---- 任务（RBAC: vm.*，复用 power 权限） ----
	api.Post("/tasks/:uuid/cancel", h.Mw.RequirePermission("vm.power"), h.cancelTask)
}
