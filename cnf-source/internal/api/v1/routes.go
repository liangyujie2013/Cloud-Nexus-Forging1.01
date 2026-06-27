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

	// 说明（Fiber v3 路由语义）：
	//   Get(path, handler, middleware...) 的执行顺序为 [middleware..., handler]，
	//   即可变参的 middleware 先执行、handler 最后执行。因此这里把
	//   RequirePermission 作为可变参中间件（先跑、做 RBAC 校验），
	//   真实业务 handler 作为第二个参数（后跑）。

	// ---- 用户管理（RBAC: user.*） ----
	api.Get("/users", h.listUsers, h.Mw.RequirePermission("user.read"))
	api.Post("/users", h.createUser, h.Mw.RequirePermission("user.create"))
	api.Post("/users/:id/enabled", h.setUserEnabled, h.Mw.RequirePermission("user.update"))
	api.Post("/users/:id/reset-password", h.resetUserPassword, h.Mw.RequirePermission("user.update"))
	api.Delete("/users/:id", h.deleteUser, h.Mw.RequirePermission("user.delete"))

	// ---- 角色管理（RBAC: role.*） ----
	api.Get("/roles", h.listRoles, h.Mw.RequirePermission("role.read"))
	api.Post("/roles", h.createRole, h.Mw.RequirePermission("role.create"))
	api.Put("/roles/:id", h.updateRole, h.Mw.RequirePermission("role.update"))
	api.Delete("/roles/:id", h.deleteRole, h.Mw.RequirePermission("role.delete"))

	// ---- 数据中心（RBAC: datacenter.*） ----
	api.Get("/datacenters", h.listDatacenters, h.Mw.RequirePermission("datacenter.read"))
	api.Get("/datacenters/:id", h.getDatacenter, h.Mw.RequirePermission("datacenter.read"))
	api.Post("/datacenters", h.createDatacenter, h.Mw.RequirePermission("datacenter.create"))
	api.Put("/datacenters/:id", h.updateDatacenter, h.Mw.RequirePermission("datacenter.update"))
	api.Delete("/datacenters/:id", h.deleteDatacenter, h.Mw.RequirePermission("datacenter.delete"))

	// ---- 集群（RBAC: cluster.*） ----
	api.Get("/clusters", h.listClusters, h.Mw.RequirePermission("cluster.read"))
	api.Get("/clusters/:id", h.getCluster, h.Mw.RequirePermission("cluster.read"))
	api.Post("/clusters", h.createCluster, h.Mw.RequirePermission("cluster.create"))
	api.Put("/clusters/:id", h.updateCluster, h.Mw.RequirePermission("cluster.update"))
	api.Delete("/clusters/:id", h.deleteCluster, h.Mw.RequirePermission("cluster.delete"))

	// ---- 主机（RBAC: host.*；含纳管 onboarding） ----
	api.Get("/hosts", h.listHosts, h.Mw.RequirePermission("host.read"))
	// 批量实时指标（列表卡片用）——静态段，置于 /hosts/:id 之前确保不被当作 :id。
	api.Get("/hosts/metrics", h.getHostsMetrics, h.Mw.RequirePermission("host.read"))
	api.Get("/hosts/:id", h.getHost, h.Mw.RequirePermission("host.read"))
	api.Get("/hosts/:id/hardware", h.getHostHardware, h.Mw.RequirePermission("host.read"))
	api.Post("/hosts", h.createHost, h.Mw.RequirePermission("host.create"))
	api.Post("/hosts/precheck", h.precheckHost, h.Mw.RequirePermission("host.create"))
	api.Post("/hosts/precheck-stream", h.precheckHostStream, h.Mw.RequirePermission("host.create"))
	api.Post("/hosts/onboard", h.onboardHost, h.Mw.RequirePermission("host.create"))
	api.Post("/hosts/onboard-stream", h.onboardHostStream, h.Mw.RequirePermission("host.create"))
	api.Post("/hosts/:id/enable-tcp", h.enableHostTCP, h.Mw.RequirePermission("host.update"))
	// ---- 主机运维：实时状态 / 监控 / 防火墙 / SELinux / SSH 端口 / 改密码 ----
	api.Get("/hosts/:id/status", h.getHostStatus, h.Mw.RequirePermission("host.read"))
	api.Get("/hosts/:id/metrics", h.getHostMetrics, h.Mw.RequirePermission("host.read"))
	// 主机网络：真实读取网卡（名称/MAC/UUID/模式/IP/掩码/网关）+ DHCP↔静态切换写配置
	api.Get("/hosts/:id/network", h.getHostNetwork, h.Mw.RequirePermission("host.read"))
	api.Put("/hosts/:id/network", h.updateHostNetwork, h.Mw.RequirePermission("host.update"))
	// 第4点 标准交换机（Linux bridge + bond via nmcli）：读 / 建 / 删。
	api.Get("/hosts/:id/switches", h.getHostSwitches, h.Mw.RequirePermission("host.read"))
	api.Post("/hosts/:id/switches", h.createHostSwitch, h.Mw.RequirePermission("host.update"))
	api.Delete("/hosts/:id/switches/:name", h.deleteHostSwitch, h.Mw.RequirePermission("host.update"))
	// 主机防火墙（firewalld）：读状态 / 开关 / 平台端口放行 / 自定义端口策略（单机 + 多机批量）
	// 批量端点为静态段，置于 /hosts/:id/firewall 之前确保不被当作 :id。
	api.Post("/hosts/firewall/batch", h.postFirewallBatch, h.Mw.RequirePermission("host.update"))
	api.Get("/hosts/:id/firewall", h.getHostFirewall, h.Mw.RequirePermission("host.read"))
	api.Post("/hosts/:id/firewall", h.postHostFirewall, h.Mw.RequirePermission("host.update"))
	// 主机 SELinux：读状态(运行时+持久) / 设置模式(单机 + 多机批量)。批量静态段先注册。
	api.Post("/hosts/selinux/batch", h.postSELinuxBatch, h.Mw.RequirePermission("host.update"))
	api.Get("/hosts/:id/selinux", h.getHostSELinux, h.Mw.RequirePermission("host.read"))
	api.Post("/hosts/:id/selinux", h.postHostSELinux, h.Mw.RequirePermission("host.update"))
	// 主机 SSH 端口修改：双写+验证+回退+同步DB（单机 + 多机批量）。批量静态段先注册。
	api.Post("/hosts/ssh-port/batch", h.postSSHPortBatch, h.Mw.RequirePermission("host.update"))
	api.Post("/hosts/:id/ssh-port", h.postHostSSHPort, h.Mw.RequirePermission("host.update"))

	// ---- 离线安装包仓库（自动部署 libvirt/KVM 时源不可用的兜底） ----
	api.Get("/offline-packages", h.listOfflinePackages, h.Mw.RequirePermission("host.read"))
	api.Post("/hosts/:id/maintenance", h.setHostMaintenance, h.Mw.RequirePermission("host.update"))
	// 主机电源：reboot/shutdown 经 SSH 真实下发（power_on 需带外，明确不支持）
	api.Post("/hosts/:id/power", h.hostPower, h.Mw.RequirePermission("host.update"))
	// 连接管理：重新连接（SSH 探活后置 connected）/ 断开（仅标记 disconnected，保留凭据）
	api.Post("/hosts/:id/reconnect", h.reconnectHost, h.Mw.RequirePermission("host.update"))
	api.Post("/hosts/:id/disconnect", h.disconnectHost, h.Mw.RequirePermission("host.update"))
	api.Delete("/hosts/:id", h.deleteHost, h.Mw.RequirePermission("host.delete"))

	// ---- 虚拟机生命周期（RBAC: vm.*） ----
	api.Get("/vms", h.listVMs, h.Mw.RequirePermission("vm.read"))
	api.Get("/vms/:id", h.getVM, h.Mw.RequirePermission("vm.read"))
	api.Get("/vms/:id/xml", h.vmXML, h.Mw.RequirePermission("vm.read"))
	api.Post("/vms", h.createVM, h.Mw.RequirePermission("vm.create"))
	api.Delete("/vms/:id", h.deleteVM, h.Mw.RequirePermission("vm.delete"))
	api.Post("/vms/:id/start", h.startVM, h.Mw.RequirePermission("vm.power"))
	api.Post("/vms/:id/stop", h.stopVM, h.Mw.RequirePermission("vm.power"))

	// 热迁移
	api.Post("/vms/:id/migrate", h.migrateVM, h.Mw.RequirePermission("vm.migrate"))
	api.Get("/vms/:id/migrate/progress", h.migrationProgress, h.Mw.RequirePermission("vm.read"))

	// 快照
	api.Get("/vms/:id/snapshots", h.listSnapshots, h.Mw.RequirePermission("vm.read"))
	api.Post("/vms/:id/snapshots", h.createSnapshot, h.Mw.RequirePermission("vm.snapshot"))
	api.Post("/vms/:id/snapshots/:name/revert", h.revertSnapshot, h.Mw.RequirePermission("vm.snapshot"))
	api.Delete("/vms/:id/snapshots/:name", h.deleteSnapshot, h.Mw.RequirePermission("vm.snapshot"))

	// ---- 存储池（RBAC: storage.*） ----
	api.Get("/storage-pools", h.listStoragePools, h.Mw.RequirePermission("storage.read"))
	api.Get("/storage-pools/:id", h.getStoragePool, h.Mw.RequirePermission("storage.read"))
	api.Post("/storage-pools", h.createStoragePool, h.Mw.RequirePermission("storage.create"))
	api.Post("/storage-pools/:id/refresh", h.refreshStoragePool, h.Mw.RequirePermission("storage.update"))
	api.Delete("/storage-pools/:id", h.deleteStoragePool, h.Mw.RequirePermission("storage.delete"))

	// ---- 虚拟交换机 / 网络（RBAC: network.*） ----
	api.Get("/vswitches", h.listVSwitches, h.Mw.RequirePermission("network.read"))
	api.Post("/vswitches", h.createVSwitch, h.Mw.RequirePermission("network.create"))
	api.Delete("/vswitches/:id", h.deleteVSwitch, h.Mw.RequirePermission("network.delete"))
	api.Get("/networks", h.listNetworks, h.Mw.RequirePermission("network.read"))
	api.Post("/networks", h.createNetwork, h.Mw.RequirePermission("network.create"))
	api.Delete("/networks/:id", h.deleteNetwork, h.Mw.RequirePermission("network.delete"))

	// ---- GPU（RBAC: gpu.*） ----
	api.Get("/gpus", h.listGPUs, h.Mw.RequirePermission("gpu.read"))
	api.Get("/gpus/:id/metrics", h.gpuMetrics, h.Mw.RequirePermission("gpu.read"))

	// ---- 监控（RBAC: monitor.*） ----
	api.Get("/metrics/stream", h.metricsStream, h.Mw.RequirePermission("monitor.read"))
	api.Get("/metrics/history", h.metricsHistory, h.Mw.RequirePermission("monitor.read"))
	api.Get("/alert-rules", h.listAlertRules, h.Mw.RequirePermission("monitor.read"))
	api.Post("/alert-rules", h.createAlertRule, h.Mw.RequirePermission("monitor.update"))
	api.Post("/alert-rules/:id/enabled", h.setAlertRuleEnabled, h.Mw.RequirePermission("monitor.update"))
	api.Delete("/alert-rules/:id", h.deleteAlertRule, h.Mw.RequirePermission("monitor.update"))

	// ---- 任务（RBAC: vm.read 查询 / vm.power 取消） ----
	api.Get("/tasks", h.listTasks, h.Mw.RequirePermission("vm.read"))
	api.Get("/tasks/:id", h.getTask, h.Mw.RequirePermission("vm.read"))
	api.Post("/tasks/:uuid/cancel", h.cancelTask, h.Mw.RequirePermission("vm.power"))
}
