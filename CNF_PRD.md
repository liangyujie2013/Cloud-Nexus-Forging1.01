# CNF 产品需求文档（PRD）
# Cloud Nexus Forging — Product Requirements Document

> **文档性质**：本 PRD 基于 `//webapp` 仓库**已实现的真实代码**反向梳理 + 产品规划补全。
> 凡"已实现"项均可在代码中核验；"规划中/未实现"项明确标注，不与现状混淆。
>
> 版本：v1.0.1 · 编制日期：2026-06-25 · 对标：VMware vCenter / Proxmox VE / SmartX CloudTower

---

## 0. 文档说明与图例

| 标记 | 含义 |
|------|------|
| ✅ 已实现 | 代码中可核验（前端 UI + Mock 后端接口齐全） |
| 🟡 部分实现 | 后端或前端单边完成，另一端缺失 |
| ⬜ 规划中 | 尚未开发 |
| ⚠️ | 需产品/技术确认的事项 |

> **重要前提**：当前系统为「Vue3 前端 + Hono Mock 后端（内存数据）」的**功能原型**，所有"已实现"指交互与接口层面完成，数据为模拟，**尚未对接真实 libvirt/KVM/数据库**。另有 `cnf-source/` Go 工程为真实落地骨架（见 §10）。

---

## 1. 产品概述

### 1.1 产品定位
CNF（Cloud Nexus Forging）是一款**企业级 KVM 虚拟化管理平台**，通过单一 Web 控制台对计算、存储、网络、可用性资源进行统一纳管，目标替代/对标 VMware vCenter、Proxmox VE、SmartX CloudTower。

### 1.2 目标用户
| 角色 | 核心诉求 |
|------|----------|
| **虚拟化管理员** | 创建/管理虚拟机、宿主机纳管、迁移、快照、模板 |
| **平台运维** | 监控告警、容量规划、高可用、备份恢复 |
| **资源使用方/租户** | 在配额内申请并使用 VM、存储、GPU 资源 |
| **安全/审计** | 用户角色权限管理、操作审计追溯 |

### 1.3 核心价值主张
1. **四级层级模型**：数据中心 → 集群 → 宿主机 → 虚拟机，企业级组织结构。
2. **真实 KVM 能力深度**：CPU 绑核/NUMA 亲和/GPU 直通/vGPU/SR-IOV/UEFI/大页（domain XML 级控制）。
3. **企业级迁移**：跨数据中心/跨集群/跨节点 + 同指令集跨代 CPU 兼容 + 网络一致性冷热判定。
4. **全中英双语 + VMware 风格专业 UX**。
5. **实时监控**：SSE 推送集群/主机/GPU 实时指标。

### 1.4 技术形态
- 前端：Vue 3 全局构建版（无构建步骤，IIFE 注册视图）+ Chart.js。
- 演示后端：Hono（`/api/v1`，109 个 REST 端点 + SSE）。
- 真实后端骨架：Go 1.23 + Fiber v3 + libvirt + MySQL/PostgreSQL（`cnf-source/`，未打通）。

---

## 2. 系统架构与信息架构

### 2.1 一级模块（10 个，核验自 `app.js` 导航）
| # | 模块 | 子模块 | 视图文件 |
|---|------|--------|----------|
| 1 | **仪表板 Dashboard** | 总览 / 性能 / 告警 | `view-dashboard.js` |
| 2 | **基础设施 Infrastructure** | 数据中心 / 集群 / 资源池 | `view-infrastructure.js` |
| 3 | **宿主机 Hosts** | 列表 / 详情 | `view-hosts.js` |
| 4 | **计算资源 Compute** | 虚拟机 / 模板 / ISO 镜像 | `view-compute.js` |
| 5 | **可用性 Availability** | 高可用 / 迁移 / 备份 | `view-availability.js` |
| 6 | **存储 Storage** | 存储池 / 卷 / 快照 | `view-storage.js` |
| 7 | **网络 Network** | 虚拟交换机 / VLAN / 拓扑 | `view-network.js` |
| 8 | **监控 Monitoring** | 总览 / 实时 / 告警规则 | `view-monitoring.js` |
| 9 | **访问控制 Access** | 用户 / 角色 / 审计 | `view-access-control.js` |
| 10 | **系统 System** | 配置 / 授权 / 关于 | `view-system.js` |

### 2.2 数据层级模型
```
Datacenter（数据中心）
  └── Cluster（集群，含 HA 开关）
        └── Host（宿主机，归属集群，含 CPU 代际/SR-IOV/IOMMU）
              └── VM（虚拟机，归属主机，冗余 cluster_id/datacenter_id）
        └── ResourcePool（资源池）
        └── StoragePool（存储池）
        └── vSwitch/VLAN（虚拟网络）
```

---

## 3. 功能需求详述（按模块）

### 3.1 仪表板 Dashboard ✅（约 75%）
| 需求 | 状态 | 说明/接口 |
|------|------|-----------|
| 集群 KPI 概览（CPU/内存/vCPU/容量） | ✅ | `GET /summary`、`GET /monitoring/overview` |
| 集群 CPU 实时曲线（SSE） | ✅ | `GET /monitoring/metrics/stream`（每 2s 推送） |
| GPU 概要（归属主机/VM/状态/模式） | ✅ | `GET /gpus` |
| 告警概览 | ✅ | `GET /alert-rules` |
| 资源池标注监控对象 | ✅ | 已实现 |

### 3.2 基础设施 Infrastructure ✅（约 85%）
| 需求 | 状态 | 接口 |
|------|------|------|
| 数据中心 CRUD | ✅ | `GET/POST /datacenters`、`PUT/DELETE /datacenters/:id` |
| 集群 CRUD（含 HA 开关） | ✅ | `GET/POST/PUT/DELETE /clusters` |
| 资源池完整 CRUD | ✅ | `GET/POST /resource-pools`、`PUT/DELETE /:id` |
| 层级拓扑 | ✅ | `GET /infrastructure/topology` |

### 3.3 宿主机 Hosts ✅（约 75%）
| 需求 | 状态 | 接口/说明 |
|------|------|-----------|
| 主机列表（OS/物理逻辑核/VM 数/状态） | ✅ | `GET /hosts` |
| 主机详情 4 Tab（基本/硬件/运行VM/性能） | ✅ | `GET /hosts/:id/hardware` |
| 添加主机 3 步向导（SSH 纳管参数） | ✅ | `POST /hosts`（含 ssh_port/ssh_user） |
| 右键上下文菜单 | ✅ | `component-context-menu.js` |
| 维护模式（运行 VM 阻断校验） | ✅ | `POST /hosts/:id/maintenance`（HAS_RUNNING_VM） |
| 主机电源（开/关/重启） | ✅ | `POST /hosts/:id/power` |
| IOMMU/VFIO 启用 | ✅ | `POST /hosts/:id/iommu` |
| PCI 直通 / GPU 模式切换 | ✅ | `/hosts/:id/pci/passthrough`、`/gpu/:gpuId/mode` |
| **SR-IOV PF 启用/禁用** | ✅ | `POST /hosts/:id/sriov`（IOMMU_REQUIRED/VF_IN_USE 校验） |
| 管理网络内联编辑 | ✅ | `PUT /hosts/:id/network` |

### 3.4 计算资源 Compute 🟡（约 80%）
| 需求 | 状态 | 接口/说明 |
|------|------|-----------|
| VM 列表（OS图标/状态色/负载条/IP） | ✅ | `GET /vms` |
| 创建 VM 4 步向导（GuestOS/CPU/存储/网络） | ✅ | `POST /vms`、`POST /vms/preview-xml` |
| VM 电源操作 | ✅ | `POST /vms/:id/power` |
| **VM 多页签编辑**（CPU/磁盘/网卡/引导） | ✅ | `GET/PUT /vms/:id/hardware`（NO_DISK/SRIOV_INCOMPLETE 校验） |
| **VM 网卡选 SR-IOV PF+VF** | ✅ | `PUT /vms/:id/hardware` |
| **企业级迁移**（跨DC/集群/节点） | ✅ 后端 | `GET /vms/:id/migration-targets`、`POST /vms/:id/migration-plan` |
| ├ 同指令集跨代 CPU 兼容判定 | ✅ 后端 | `cpuCompat()`：同代/跨代/跨厂商 |
| ├ 网络一致性冷热判定 | ✅ 后端 | `networkMatch()`：端口组比对 → 不一致只能冷迁移 |
| └ 迁移执行（热迁不满足→409 拒绝） | ✅ 后端 | `POST /vms/:id/migrate`（LIVE_NOT_ALLOWED） |
| **迁移向导前端展示新字段** | ⬜ | cpu_mode/network_consistent/cold_reason 未渲染 **(P0)** |
| 模板管理（新建/部署） | ✅ | `GET/POST /vm-templates`、`/deploy` |
| ISO 管理（上传/URL） | ✅ | `GET/POST /iso-images` |
| **存储迁移右键入口** | 🟡 | 后端 `POST /storage/volumes/:id/migrate` 已就绪，前端入口缺 **(P1)** |

### 3.5 可用性 Availability 🟡（约 60%）
| 需求 | 状态 | 接口 |
|------|------|------|
| 高可用策略（心跳/准入/优先级） | ✅ | `GET /ha/cluster-status`、`POST /ha/enable`、`POST /ha/test-fencing` |
| 迁移历史记录 | ✅ | `GET/POST /migrations`、`GET /migrations/progress` |
| 备份任务（对象/模式/位置/调度/保留） | 🟡 | `GET/POST /backup-jobs`（基础版，企业级深化未做 **S4**） |

### 3.6 存储 Storage ✅（约 80%）
| 需求 | 状态 | 接口 |
|------|------|------|
| 存储池类型/列表/创建（local/NFS/iSCSI/FC/分布式） | ✅ | `GET /storage-pool-types`、`GET/POST /storage-pools`、`DELETE /:id` |
| 卷管理（创建/删除/挂载/卸载/扩容） | ✅ | `GET/POST /volumes`、`/storage/volumes/:id/attach|detach|expand` |
| 快照（创建/恢复/删除，级联安全） | ✅ | `GET/POST /snapshots`、`/:id/revert`、`DELETE /:id` |
| iSCSI 池（创建/状态） | ✅ | `GET/POST /storage/iscsi/pools`、`/:id/status` |
| 存储迁移目标/执行 | ✅ 后端 | `GET /storage/volumes/:id/migration-targets`、`POST .../migrate` |

### 3.7 网络 Network 🟡（约 65%）
| 需求 | 状态 | 接口 |
|------|------|------|
| 虚拟交换机 列表/创建 | ✅ | `GET/POST /vswitches` |
| VLAN 列表/创建 | ✅ | `GET/POST /vlans` |
| 主机网卡 / Bond 模式 | ✅ | `GET /host-nics`、`GET /bond-modes` |
| 网络拓扑数据 | ✅ 后端 | `GET /network/topology` |
| **网络拓扑可视化**（SVG/Canvas 分层） | ⬜ | 前端图形化未做 **(S3)** |

### 3.8 监控 Monitoring 🟡（约 70%）
| 需求 | 状态 | 接口 |
|------|------|------|
| 监控总览 | ✅ | `GET /monitoring/overview` |
| 实时监控（GPU + 主机负载，SSE） | ✅ | `GET /monitoring/metrics/stream` |
| 历史性能图表（Chart.js） | ✅ | `GET /monitoring/history` |
| 告警规则 CRUD | ✅ | `GET/POST/PUT/DELETE /alert-rules` |
| **告警指标目录下拉**（全量指标+描述+VMware术语） | ⬜ | 当前为自由文本输入 **(N8/P1)** |

### 3.9 访问控制 Access ✅（约 75%）
| 需求 | 状态 | 接口 |
|------|------|------|
| 用户 CRUD（去重/正则/配额/启停/重置密码） | ✅ | `GET/POST /users`、`PATCH/DELETE /:id`、`/:id/status`、`/:id/reset-password` |
| 角色与权限 | ✅ | `GET /roles`、`POST /roles`、`GET /privileges`、`GET /permission-assignments` |
| 操作审计日志 | ✅ | `GET /audit-logs` |
| 退出登录 | ✅ | `POST /auth/logout`（前端清 Token 跳登录） |
| **真实登录/JWT 校验中间件** | ⬜ | Mock 路径无认证；Go 工程有 `auth/jwt.go` 骨架 ⚠️ |

### 3.10 系统 System 🟡（约 60%）
| 需求 | 状态 | 接口 |
|------|------|------|
| License 版本（社区1-3/标准4-31/企业32-64节点） | ✅ | `GET /license`、`GET /license/editions` |
| 系统配置 | 🟡 | `view-system.js` 基础版 **(S3 深化)** |
| 关于页（产品/版本/授权） | ✅ | 已实现 |

---

## 4. 关键业务流程（已实现逻辑）

### 4.1 虚拟机迁移决策流程 ✅（N6 核心）
```
选择目标主机
  → 计算迁移范围（同集群 / 跨集群 / 跨数据中心）
  → CPU 兼容判定 cpuCompat():
       同代          → 可热迁移
       同厂商跨代低→高 → 锁源基线(EVC)，可热迁移
       同厂商跨代高→低 → 用目标基线，可热迁移
       跨厂商(Intel↔AMD) → 不兼容，强制冷迁移
  → 网络一致性 networkMatch():
       目标主机具备 VM 全部网卡端口组 → 网络一致，可热迁移
       缺端口组 / SR-IOV 直通       → 不一致，强制冷迁移
  → 强制冷迁移条件(任一命中)：① VM停机 ② GPU直通 ③ CPU跨厂商 ④ 网络不一致
  → 资源校验(vCPU/内存/目标在线) → 通过则可迁移
  → 用户请求热迁但不满足 → 409 拒绝并说明原因
```

### 4.2 SR-IOV 启用流程 ✅（N5）
```
宿主机启用 PF → 前置要求 IOMMU 已开(否则 IOMMU_REQUIRED 409)
  → 创建 N 个 VF
VM 网卡选 sriov 型号 → 选 PF → 选空闲 VF
  → 缺 PF/VF → SRIOV_INCOMPLETE 400
禁用 PF → 若有 VF 被占用 → VF_IN_USE 409
```

### 4.3 宿主机维护模式流程 ✅（N3）
```
进入维护 → 检测是否有运行中 VM
  → 有 → HAS_RUNNING_VM 阻断，提示先迁移
  → 无 → 进入维护模式
```

---

## 5. 数据模型（核验自 `mock-data.ts`）

### 5.1 核心实体（30 张内存表）
`datacenters / clusters / hosts / vms / gpus / storage_pools / snapshots / migrations / cluster_configs / roles / all_privileges / permission_assignments / license / users / user_roles / audit_logs / vm_templates / iso_images / resource_pools / vswitches / host_nics / bond_modes / vlans / volumes / iscsi_pools / virtual_disks / backup_jobs / alert_rules / notifications`

### 5.2 关键实体字段示例
**Host（宿主机）**：`id, cluster_id, datacenter_id, name, ip, ssh_port, ssh_user, status, maintenance_mode, cpu_model, cpu_vendor, cpu_microarch, cpu_gen, cpu_baseline, sockets, cores, threads, vcpus, numa_nodes, mem_total_gb, iommu, sriov_pfs[], ...`

**VM（虚拟机）**：`id, host_id, cluster_id, datacenter_id, name, status, vcpus, sockets, cores, threads, mem_gb, cpu_pinning, numa, os, ha, gpus, ip, ...`

> 真实落地的 DDL 见 `cnf-source/migrations/mysql/0001~0003`（⚠️ 数据库类型 MySQL/PostgreSQL 待统一，见 §10）。

---

## 6. 非功能需求

| 类别 | 需求 | 现状 |
|------|------|------|
| **国际化** | 全中英双语 + 运行时切换 | ✅ `i18n.js`（`window.t(key,params)`） |
| **实时性** | 指标推送延迟 ≤ 2s | ✅ SSE 每 2s |
| **一致性 UX** | VMware 风格、Apple HIG 设计语言 | ✅ `apple-hig.css` + `app.css` |
| **可访问性** | 按钮全响应、无死按钮 | 🟡 有烟雾测试，待全面巡检 **(N9)** |
| **安全** | JWT 认证、RBAC、审计 | 🟡 Mock 无认证；Go 工程有骨架 |
| **可移植** | 前端零构建、本地一键启动 | ✅ `npm run dev:node` |

---

## 7. 用户角色与权限（RBAC）
- 已实现：用户、角色、权限项（privileges）、权限分配（permission-assignments）、审计日志。
- License 节点数分级：**社区版 1-3 / 标准版 4-31 / 企业版 32-64**。
- ⚠️ 真实权限校验（中间件级拦截）仅在 Go 工程 `internal/auth/middleware.go` 有骨架，Mock 后端未强制校验。

---

## 8. 已知约束与技术债

| 项 | 说明 |
|----|------|
| 数据非持久 | Mock 后端数据在内存，重启重置 |
| 前后端未打通真实虚拟化 | 当前不连 libvirt/KVM；真实纳管需走 §10 路线 |
| 数据库类型不一致 ⚠️ | `go.mod` 为 MySQL 驱动，文档写 PostgreSQL，需统一 |
| 本地运行限制 | 沙箱 glibc < 2.35，wrangler 不可用，须用 `dev:node` |

---

## 9. 产品路线图（优先级）

### P0 立即（迁移闭环）
- 迁移向导前端展示 cpu_mode/network_consistent/cold_reason（N6 收尾）
- 真实环境 curl 端到端验证迁移决策

### P1 近期
- N7 存储迁移右键入口（后端已就绪）
- N8 告警指标目录下拉（全量指标 + 描述 + VMware 术语）
- N9 死按钮全面巡检

### P2 中期
- S3 网络拓扑可视化 + 系统管理深化
- S4 模板/ISO/备份企业级深化
- 真实后端打通（Go cnf-server/agent，见 §10）

---

## 10. 真实落地架构（Go 工程，规划路线）

### 10.1 组件
- **cnf-server**（控制面，Fiber v3，:8080）：REST API + RBAC + HA 选主（etcd）。
- **cnf-agent**（宿主机代理，libvirt CGO）：本地调 libvirt domain XML，采集指标。
- **依赖**：MySQL/PostgreSQL（待统一）+ Redis + etcd。

### 10.2 推荐纳管方案：**Agent 模式**
理由：CPU 绑核/NUMA/GPU 直通/SR-IOV/大页依赖本地 libvirt 精细控制（`internal/virt/domain_xml.go` 已实现，测试覆盖 76.8%），Agent 常驻优于远程 SSH 拼命令。

### 10.3 落地步骤
1. 打通控制面 ↔ Agent 上报协议（注册/心跳/指标）。
2. 前端数据源从 Mock(`/api/v1`) 切到 Go cnf-server。
3. `preview-xml` → Agent `virDomainDefineXML` 真实创建 VM。
4. 数据库定稿 + 迁移 + 种子。
5. 监控采集（libvirt domstats + GPU）→ SSE。
6. HA：etcd 选主 + 5s×3 心跳失败判故障 + fencing。

---

## 附录 A：接口总览
- 基址 `/api/v1`，共 **109 个** REST 端点 + 1 个 SSE 流。
- 完整端点清单见 `CNF_Handover.md` §3.3。

## 附录 B：相关文档
- `README.md`：产品级英文说明
- `P-FIXES.md`：整改清单（P1–P24 + 阶段一~四）唯一可信来源
- `CNF_Handover.md`：完整技术交接白皮书（10 章节）

---
**（PRD 完）**
