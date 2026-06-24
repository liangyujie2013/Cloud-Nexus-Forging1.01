# CNFv1.0 · 企业级虚拟化管理平台

## 项目概述
- **名称**：CNFv1.0 (Cloud Native Foundation v1.0)
- **目标**：对标 VMware vSphere 8 / SmartX ELF 的企业级私有云虚拟化管理平台
- **交付方式**：A（源码工程）+ B（在线原型）组合

## 本仓库包含两部分

### 路径 A：源码工程（`cnf-source/`）
可在 **Rocky Linux 9 / RHEL 9** 上编译部署的完整 Go + 前端源码：
- PostgreSQL 16 完整 DDL（层级模型 + NUMA/CPU 绑核字段）
- Go 核心模型 + **libvirt domain XML 生成器**（CPU 绑核 / NUMA 亲和 / GPU 直通 / UEFI / 大页，单元测试覆盖率 **76.8%**）
- 统一存储驱动接口（local / NFS / iSCSI）
- install.sh / upgrade.sh / systemd 服务文件
- Apple HIG 设计系统 CSS

> 发布包：`CNFv1.0-source-2026-06-24.tar.gz`

### 路径 B：在线原型（本 Hono Web 应用）
Apple HIG 风格的可交互 Web 原型，可在线预览界面与交互效果。
后端为 mock 数据，但 **libvirt XML 预览端点为真实生成逻辑**（与 Go 后端一致）。

**全局特性（最新）**：
- 🌐 **中 / 英双语切换**：顶栏分段控件一键切换，功能名称严格对齐 **VMware vSphere** 官方术语（vMotion / DRS / vSphere HA / EVC / 已打开电源 Powered On 等），偏好持久化到 localStorage。
- 🎨 **三套外观主题**：浅色（白）/ 深灰（GitHub Dim）/ 纯黑（OLED），通过 `data-theme` 切换并平滑过渡，偏好持久化。
- 所有视图（含原有视图）均已接入 i18n，切换语言全应用即时生效。

## 功能入口（在线原型）

| 视图 (VMware 对齐) | 功能 |
|------|------|
| 摘要 Summary | 资源统计卡 + 集群 CPU 实时曲线(SSE) + 容量条 + 任务表 |
| 主机和集群 Hosts & Clusters | 数据中心→集群→主机→VM 四层可展开树 |
| 虚拟机 Virtual Machines | VM 列表（CPU 拓扑/绑核/NUMA/GPU/HA）+ 8 步创建向导 |
| GPU 监控 | 圆环利用率 + 显存条 + 温度/功耗 + 实时刷新 |
| **集群设置 Cluster Settings** | vSphere HA（准入控制/容许故障数）+ DRS（自动化级别/迁移阈值）+ EVC（CPU 基线）+ 资源超分配 |
| vMotion 迁移 | 在线/存储 vMotion 控制台 + 进度阶段 + 迁移历史 |
| **DRS 迁移编排（拖拽）** | HTML5 拖拽 VM→主机发起 vMotion，自动校验资源/GPU 兼容性 + DRS 负载均衡建议 |
| 快照管理 | 内存+NVRAM / 仅磁盘快照 + Quiesce 静默 + 快照树 |
| 数据存储 Datastores | 容量 + IOPS + 延迟，按 local/NFS/iSCSI 区分 |
| **权限管理 Permissions** | RBAC 角色定义（权限项网格）+ 用户与全局权限分配（作用域/向下传播） |

**VM 创建向导（核心）**：8 步——基本信息 / CPU 拓扑 / NUMA 亲和 / CPU 绑核可视化 / 内存 / 磁盘&网络 / GPU 选择 / **实时 libvirt XML 预览**。

## API 端点

| 路径 | 说明 |
|------|------|
| GET /api/summary | 汇总统计 |
| GET /api/topology | 层级拓扑树 |
| GET /api/vms /hosts /gpus /storage-pools /tasks | 资源列表 |
| GET /api/snapshots, POST /api/snapshots | 快照列表 / 创建 |
| GET /api/migrations, POST /api/migrate, GET /api/migrate/progress | 迁移历史 / 发起 / 进度 |
| **GET /api/cluster-configs, PUT /api/cluster-configs/:id** | 集群 HA/DRS/EVC 设置（读取 / 保存） |
| **GET /api/roles, /api/privileges, /api/permission-assignments** | RBAC 角色 / 权限项 / 权限分配 |
| POST /api/preview-xml | **真实 libvirt XML 生成**（输入 VM 配置） |
| GET /api/metrics/stream | SSE 实时监控流 |

## 数据架构
- **数据模型**：Datacenter → Cluster → Host → VM（含 GPU/Disk/NIC 子资源）
- **存储服务**：生产用 PostgreSQL 16；在线原型用内存 mock 数据
- **实时数据流**：SSE (Server-Sent Events)

## 技术栈
- **后端（生产）**：Go 1.22 + Fiber v3 + PostgreSQL 16 + libvirt/KVM
- **后端（原型）**：Hono + TypeScript（Cloudflare Pages）
- **前端**：Vue 3 (CDN) + 自研 Apple HIG 组件 + Chart.js
- **i18n**：全局响应式 `window.i18n` + `window.t(key)` 词典（zh/en，~230 键，VMware 术语对齐）
- **主题**：CSS 自定义属性 `[data-theme="light|dim|dark"]` + localStorage 持久化
- **交互**：HTML5 Drag & Drop API（DRS 拖拽迁移）

## 本地开发
```bash
npm run build
pm2 start ecosystem.config.cjs
curl http://localhost:3000/api/summary
```

## 部署状态
- **平台**：Cloudflare Pages（原型）
- **状态**：✅ 本地运行中
- **最后更新**：2026-06-24

## 后续开发建议
- **P0**：✅ 源码工程 service 层业务逻辑（VM 生命周期、libvirt-go 连接）已完成（第二阶段）
- **P1**：NUMA/绑核调度算法、GPU vGPU 扩展、热迁移联调
- **P2**：HA 故障转移 + etcd 锁、跨集群迁移、多租户 RBAC（原型已具备界面）
- **P3**：Prometheus 导出器、自动化升级、备份恢复
- **原型增强（已完成）**：✅ 集群设置 / 权限管理 / DRS 拖拽迁移视图 · ✅ 中英双语 · ✅ 三主题（白/深灰/黑）· ✅ VMware 术语对齐
