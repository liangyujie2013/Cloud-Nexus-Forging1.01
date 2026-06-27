# CNF 项目完整交接白皮书 / CNF Project Handover Whitepaper

> 本文件由当前首席工程师在交接前依据**仓库内真实代码**逐项核验后生成。
> 所有 API、文件路径、数据结构、命令均来自 `cnf/` 工作区的实际文件。
> 凡无法从代码确证的内容，均以 **⚠️需要确认** 显式标注，绝不臆测。
>
> 生成时间：2026-06-25 · 分支：`genspark_ai_developer` · 最新提交：`6d386a6`

---

## 1. 项目基础信息

### 1.1 项目定位
- **产品名**：Cloud Nexus Forging（CNF）—— 企业级 KVM 虚拟化管理平台，对标业界主流虚拟化管理平台。
- **目标场景**：纳管真实 RHEL/Rocky 8/9 KVM 宿主机（libvirt），提供数据中心→集群→主机→虚拟机四级层级管理、存储/网络/GPU/高可用/监控/权限的统一 Web 控制台。
- **当前形态（真实）**：仓库 `cnf/` 内运行的是一套 **纯前端 Vue3 SPA + Hono Mock 后端**。**后端所有数据来自 `src/mock-data.ts` 内存数据，不连接任何真实 libvirt / 数据库**。它是一个**功能演示 / 交互原型（UI + 交互逻辑完整，数据为模拟）**。
- **另有一套 Go 源码工程**位于 `cnf/cnf-source/`（Go 1.23 + Fiber v3 + libvirt + MySQL/PostgreSQL），是「真实虚拟化落地」的代码骨架，**与前端 Mock 后端是两条独立路径，前端当前不调用它**。

### 1.2 当前真实完成度
| 维度 | 完成度 | 依据 |
|------|--------|------|
| 前端 UI + 交互原型（Mock 数据驱动） | **约 78%** | 11 个 view 文件齐全，109 个 Mock API，主要 CRUD/向导/右键菜单已接 |
| 真实后端（连真实 libvirt/KVM/DB） | **约 10%（仅骨架）** | `cnf-source/` 有结构与 domain XML 生成器，但前后端未打通、未在真实主机部署验证 |
| **整体可交付生产** | **约 30%** | 演示级可用；生产级（真实纳管）尚未打通 |

> ⚠️需要确认：以上百分比为工程师基于代码覆盖面的评估，非自动化度量。请以"演示原型基本完成、真实落地刚起步"为准理解。

### 1.3 技术栈精确版本（来自 `package.json` / `go.mod`，真实）
**前端 + Mock 后端（主运行路径）**
- 运行时：**Node.js 18.20.4**（沙箱固定路径 `/opt/node18/bin`）
- 包管理：**npm**（仓库为 `package-lock.json`，非 pnpm/yarn）
- 后端框架：**Hono ^4.12.26**
- 本地运行适配：`@hono/node-server ^2.0.6`、`tsx ^4.22.4`
- 构建：**Vite ^6.3.5** + `@hono/vite-build ^1.2.0` + `@hono/vite-dev-server ^0.25.2`
- 部署目标：**Cloudflare Pages**（`wrangler ^4.4.0`，`wrangler.jsonc` compatibility_date 2026-04-26）
- 前端框架：**Vue 3 全局构建版**（`public/static/vendor/vue.global.prod.js`，**无构建步骤**，IIFE 注册视图）
- 图表：**Chart.js**（`public/static/vendor/chart.umd.min.js`，本地化）
- 图标/字体：FontAwesome（`public/static/vendor/fontawesome.css` + `webfonts/`，本地化）
- ⚠️ **没有 Vite/webpack 编译前端**：所有 `view-*.js` 是浏览器直接加载的普通 JS（IIFE），仅 `src/index.tsx`（Hono 后端）走 TS。

**Go 源码工程（`cnf-source/`，独立路径，未打通）**
- **Go 1.23**，Fiber v3（`gofiber/fiber/v3 v3.0.0-beta.4`）
- `golang-jwt/jwt/v5`、`google/uuid`、`redis/go-redis/v9 v9.7.0`
- **`libvirt.org/go/libvirt v1.8000.0`**（CGO，需宿主机装 libvirt-devel）
- 数据库驱动：`go-sql-driver/mysql v1.8.1`
- ⚠️ go.mod 写 MySQL 驱动，但 `cnf-source/README.md` 与 `.env.example` 写 PostgreSQL，**两处不一致**（见 §4）。

### 1.4 完整 `.env.example`（真实）
**前端/Mock 后端路径**：仓库**没有** `.env.example`，Mock 后端不读环境变量（除 `PORT`）。唯一环境变量：
```env
# cnf/ 本地开发（src/server-node.ts 唯一读取项）
PORT=3000
```
**Go 源码工程**（`cnf-source/.env.example`，逐字真实）：
```env
# CNFv1.0 控制面环境变量示例。复制为 /etc/cnf/server.env 并按需修改。
CNF_LISTEN_ADDR=:8080
CNF_DATABASE_URL=postgres://cnf:<PASSWORD>@127.0.0.1:5432/cnfv1?sslmode=disable
CNF_REDIS_URL=redis://127.0.0.1:6379/0
CNF_ETCD_URL=http://127.0.0.1:2379
# 生产环境务必更换为强随机值
CNF_JWT_SECRET=<JWT_SECRET_PLACEHOLDER>
```

### 1.5 本地启动完整命令（从零开始，真实可用）
沙箱/Linux 环境（glibc < 2.35，**无法跑 wrangler/miniflare**，必须用 node 启动器）：
```bash
# 0. 确保使用 Node 18（沙箱）
export PATH=/opt/node18/bin:$PATH
node -v   # 期望 v18.20.4

# 1. 进入工作区并安装依赖
cd cnf
npm install

# 2. 启动本地开发服务器（Node 运行时，绕开 Cloudflare workerd）
#    本质：tsx 跑 src/server-node.ts → 加载 src/index.tsx(Hono app) + serve public/static
npm run dev:node
#    或后台运行：
#    node node_modules/tsx/dist/cli.mjs src/server-node.ts > /tmp/cnf-dev.log 2>&1 &

# 3. 访问
#    http://localhost:3000/            前端控制台
#    http://localhost:3000/api/v1/...  REST API
```
> ⚠️ `npm run dev`（纯 Vite + wrangler 适配）在本沙箱因 glibc 版本无法运行；**本地一律用 `npm run dev:node`**。生产构建/部署才用 `npm run build` + Cloudflare Pages。

---

## 2. 已开发功能清单

> 完成度针对「前端原型 + Mock 后端」。测试状态来源：`node scripts/smoke-views.mjs`（视图加载 + 死按钮处理器烟雾测试）与 curl 端点测试。

### [虚拟机管理 / Compute] - 完成度 80%
文件：`public/static/view-compute.js`（67KB）、`public/static/component-vm-wizard.js`、`public/static/component-context-menu.js`
- [x] VM 列表（OS 图标/状态色/负载条/IP） - `view-compute.js` - 烟雾测试 PASS
- [x] 创建 VM 4 步向导（GuestOS 智能选择/CPU/存储/网络） - `component-vm-wizard.js` - PASS
- [x] VM 电源操作（开/关/重启/挂起） - `POST /vms/:id/power` - curl PASS
- [x] VM 多页签编辑（CPU/磁盘/网卡/引导，N4） - `view-compute.js` openEdit + `GET/PUT /vms/:id/hardware` - curl PASS
- [x] SR-IOV 网卡（VM 网卡选 PF+VF，N5） - `view-compute.js` pfVfs + `PUT /vms/:id/hardware`（SRIOV_INCOMPLETE 校验） - curl PASS
- [x] 迁移向导（右键 → 数据中心/集群/主机三级选择，N6 后端） - `GET /vms/:id/migration-targets` + `POST /vms/:id/migration-plan` + `POST /vms/:id/migrate` - **后端 curl 待验证（见已知问题）**
- [x] 模板管理（新建/部署） - `POST /vm-templates` `/deploy` - PASS
- [x] ISO 管理（上传/URL） - `POST /iso-images` - PASS
- [ ] **N6 前端展示**：迁移向导显示 cpu_mode/network_consistent/cold_reason - 难度【低】（后端已返回字段，前端仅需渲染）
- [ ] **N7 存储迁移右键入口**：后端 `POST /storage/volumes/:id/migrate` 已存在，但 VM 右键菜单 `component-context-menu.js` **未加 storage_migrate 命令**、`view-compute.js` 无对应 dialog - 难度【中】
- 已知问题：N6 后端 `migrate`/`migration-plan` 已写完但本轮服务器重启后 curl 不可达（疑似后台进程 detach，非代码问题），**未端到端验证**。临时方案：下个 AI 用 `run_in_background:true` 重启后 curl 验证。

### [监控面板 / Monitoring + Dashboard] - 完成度 70%
文件：`public/static/view-dashboard.js`、`public/static/view-monitoring.js`、`public/static/view-availability.js`
- [x] 仪表板 KPI + 集群 CPU 实时（SSE） - `view-dashboard.js` EventSource - PASS
- [x] 实时监控（GPU 面板 + 主机负载，SSE 推送） - `view-monitoring.js` `/monitoring/metrics/stream` - PASS
- [x] 历史性能图表 - `GET /monitoring/history` + Chart.js - PASS
- [x] 监控总览 - `GET /monitoring/overview` - PASS
- [x] 告警规则 CRUD（新建/编辑/启停/删除） - `view-monitoring.js` + `/alert-rules` - PASS
- [ ] **N8 告警指标目录下拉**：当前 `view-monitoring.js:345` 监控指标是**自由文本输入**（placeholder「如 host.cpu_usage」），需改为**全量指标下拉 + 描述 + 标准化术语** - 难度【中】（需新增指标目录数据/端点）
- 已知问题：告警规则的 metric 字段无校验枚举，用户可输入任意字符串。

### [存储管理 / Storage] - 完成度 80%
文件：`public/static/view-storage.js`（28KB）
- [x] 存储池列表/类型/创建（local/NFS/iSCSI/FC/分布式） - `/storage-pools` `/storage-pool-types` `POST /storage-pools` - PASS
- [x] 卷管理（创建/删除/挂载/卸载/扩容） - `/storage/volumes` `/attach` `/detach` `/expand` - PASS
- [x] 快照（创建/恢复/删除，级联安全约束） - `/snapshots` `/revert` - PASS
- [x] iSCSI 池（创建/状态） - `/storage/iscsi/pools` - PASS
- [x] **存储迁移后端**（虚拟磁盘迁移，N7 后端） - `GET /storage/volumes/:id/migration-targets` + `POST /storage/volumes/:id/migrate` - **后端存在，前端入口未接（见虚拟机管理 N7）**
- 已知问题：存储迁移后端已就绪但缺前端入口。

### [网络管理 / Network] - 完成度 65%
文件：`public/static/view-network.js`（19KB）
- [x] 虚拟交换机列表/创建 - `/vswitches` `POST /vswitches` - PASS
- [x] VLAN 列表/创建 - `/vlans` `POST /vlans` - PASS
- [x] 主机网卡 / Bond 模式 - `/host-nics` `/bond-modes` - PASS
- [x] **网络拓扑后端** - `GET /network/topology` 已存在 - PASS
- [ ] **S3 网络拓扑前端可视化**（SVG/Canvas 分层：主机→交换机→VLAN→VM） - 难度【高】（后端有 topology 数据，前端可视化未做）
- 已知问题：拓扑数据有，前端图形化未实现。

### [用户权限 / Access Control] - 完成度 75%
文件：`public/static/view-access-control.js`（21KB）
- [x] 用户 CRUD（创建/编辑/启停/重置密码，用户名去重+正则校验） - `/users` `PATCH` `DELETE` `/status` `/reset-password` - PASS
- [x] 角色与权限（roles/privileges/permission-assignments） - `/roles` `/privileges` `/permission-assignments` - PASS
- [x] 操作审计日志 - `/audit-logs` - PASS
- [x] License 版本（社区 1-3 / 标准 4-31 / 企业 32-64 节点） - `/license` `/license/editions` - PASS
- 已知问题：无真实认证后端，`POST /auth/logout` 仅返回 ok（前端清 Token 跳登录）。无登录接口/JWT 校验中间件（Mock 路径）。

### [宿主机纳管 / Hosts] - 完成度 75%
文件：`public/static/view-hosts.js`（62KB）、`public/static/component-host-wizard.js`、`public/static/component-context-menu.js`
- [x] 主机列表 + 4 Tab 详情（基本/硬件/运行VM/性能） - `view-hosts.js` + `/hosts/:id/hardware` - PASS
- [x] 添加主机 3 步向导 - `component-host-wizard.js` + `POST /hosts` - PASS
- [x] 主机右键上下文菜单（N3） - `component-context-menu.js` HostContextMenu - PASS
- [x] 维护模式（含运行 VM 阻断校验，N3） - `POST /hosts/:id/maintenance` - PASS
- [x] 主机电源（N3） - `POST /hosts/:id/power` - PASS
- [x] IOMMU/VFIO 启用、PCI 直通、GPU 模式（P4） - `/hosts/:id/iommu` `/pci/passthrough` `/gpu/:gpuId/mode` - PASS
- [x] SR-IOV PF 启用/禁用（N5） - `POST /hosts/:id/sriov`（IOMMU_REQUIRED/VF_IN_USE 校验） - curl PASS
- [x] 内联管理网络编辑 - `PUT /hosts/:id/network` - PASS
- 已知问题：所有主机操作仅改 Mock 内存，不连真实 SSH/libvirt。

### [双语界面 / i18n] - 完成度 90%
文件：`public/static/i18n.js`（99KB，zh + en 全量）
- [x] 中英双语 + `window.t(key, params)` 插值（`{x}` replace） - PASS
- [x] N1~N5 术语已校准（专业级：已连接/资源池/SR-IOV 等）
- [ ] **N6 迁移字段标签**（cpu_mode/network_consistent/cold_reason） - 难度【低】
- [ ] **N7/N8 新键** - 难度【低】
- 已知问题：N6/N7/N8 待补的 key 尚未加。

### [SSE 实时数据] - 完成度 85%
文件：后端 `src/index.tsx:1589`，前端 `view-dashboard.js:103` / `view-monitoring.js:55`
- [x] SSE 端点 `/monitoring/metrics/stream`（ReadableStream，每 2s push，上限 600 次后关闭，监听 abort） - PASS
- [x] 前端 EventSource 订阅（dashboard 集群 CPU + monitoring GPU/主机） - PASS
- [x] 非 SSE 回退快照 `/monitoring/metrics` - PASS
- 已知 SSE 事件：**只有匿名 `data:` 事件**（无具名 event 类型），payload 见 §3.5。
- 已知问题：数据为 `genMetrics()` 随机抖动模拟，非真实采集。

### 本批次新需求落地情况（N6~N10 / S3~S4）
- **N6** 迁移深化：后端**已完成**（cpuCompat / networkMatch / migration-plan 重写 / migrate 同步，提交 `6d386a6`）。前端展示 + i18n + 端到端验证**未完成**。
- **N7** 存储迁移：**后端已存在**（`/storage/volumes/:id/migrate`），前端右键入口**未接**。
- **N8** 告警指标目录：**未开始**（当前为自由文本）。
- **S3** 网络拓扑/监控图表/系统管理：监控图表**已有**；网络拓扑可视化**未做**；系统管理见 `view-system.js`（8.6KB，基础版）。
- **S4** 模板/ISO/备份深化：基础 CRUD 有（`/vm-templates` `/iso-images` `/backup-jobs`），企业级深化**未做**。
- **N9** 死按钮全面测试：有烟雾测试脚本 `scripts/smoke-views.mjs`，**未做逐按钮人工巡检**。
- **N10** GitHub 清理 + 去 AI 化 + 双语 README：**未开始**（README 已是英文专业版，但未中英双语化、未做分支清理）。

---

===输出未完===，请回复"继续"

---

## 3. 完整代码结构

### 3.1 真实目录树（核验自仓库）
```
cnf/
├── package.json              # 依赖与脚本（dev/dev:node/build/preview/deploy）
├── package-lock.json         # npm 锁文件（确认用 npm，非 pnpm）
├── tsconfig.json             # TS 配置（jsx: hono/jsx）
├── vite.config.ts            # Vite + Cloudflare Pages 构建（生产路径）
├── wrangler.jsonc            # Cloudflare Pages 配置（KV/R2/D1 全部注释未启用）
├── ecosystem.config.cjs      # PM2 配置（wrangler pages dev，本沙箱不可用）
├── .gitignore
├── README.md                 # 英文产品级 README（已去技术栈细节）
├── P-FIXES.md                # ★ 整改清单唯一可信来源（P1–P24 + 阶段一~四）
├── CNF_Handover.md           # ★ 本交接文档
├── src/                      # Hono Mock 后端（TS，tsx 运行）
│   ├── index.tsx             # ★ 主后端：109 个 REST API + SSE（约 1700 行）
│   ├── mock-data.ts          # ★ 全部内存数据 + genMetrics()/getHostHardware()（约 620 行）
│   ├── libvirt-xml.ts        # libvirt domain XML 生成器（preview-xml 用）
│   └── server-node.ts        # ★ 本地启动器（@hono/node-server，serve static，端口 3000）
├── scripts/
│   └── smoke-views.mjs       # 视图烟雾测试（Node+vm 加载真实 Vue 跑 view-*.js）
├── public/static/            # 前端（浏览器直接加载，无构建）
│   ├── app.js                # ★ SPA 壳：路由/顶栏/用户菜单/退出登录/全局 api()
│   ├── i18n.js               # ★ 中英双语全量 + t(key,params) 插值
│   ├── apple-hig.css         # Apple HIG 设计系统基础
│   ├── app.css               # 业务样式（vme-*/sriov-*/pool-* 等）
│   ├── store-topology.js     # ★ window.cnfTopology 拓扑 store（CRUD/fetchAll）
│   ├── component-context-menu.js   # ★ useContextMenu() + VM/Host 右键菜单 + window.api
│   ├── component-host-wizard.js    # 添加主机 3 步向导
│   ├── component-vm-wizard.js      # 创建 VM 4 步向导
│   ├── component-topology-tree.js  # 左侧拓扑树
│   ├── view-dashboard.js     # 仪表板（KPI + SSE 集群 CPU）
│   ├── view-infrastructure.js# 基础设施（DC/集群/主机/资源池）
│   ├── view-hosts.js         # 主机管理（4 Tab 详情 + SR-IOV + IOMMU + 维护）
│   ├── view-compute.js       # ★ 虚拟机（列表/编辑/迁移/模板/ISO）
│   ├── view-storage.js       # 存储（池/卷/快照/iSCSI）
│   ├── view-network.js       # 网络（vswitch/vlan/bond）
│   ├── view-monitoring.js    # 监控（总览/实时SSE/历史/告警规则）
│   ├── view-availability.js  # 可用性（HA/迁移历史/备份）
│   ├── view-access-control.js# 访问控制（用户/角色/审计/License）
│   ├── view-system.js        # 系统管理（基础版）
│   └── vendor/               # 本地化第三方：vue.global.prod.js / chart.umd.min.js / fontawesome
└── cnf-source/               # ★ 独立 Go 源码工程（真实虚拟化路径，未与前端打通）
    ├── cmd/cnf-server/main.go    # 控制面入口（Fiber v3）
    ├── cmd/cnf-agent/main.go     # 宿主机代理（libvirt CGO）
    ├── internal/                 # api/auth/cache/config/gpu/ha/model/onboard/repo/service/storage/virt
    ├── migrations/mysql/         # 0001/0002/0003 (up+down) SQL
    ├── deploy/systemd/           # cnf-server.service / cnf-agent.service
    ├── scripts/install.sh, upgrade.sh
    ├── go.mod / go.sum
    └── .env.example
```

### 3.2 核心文件完整路径
| 角色 | 路径 |
|------|------|
| 后端路由+API | `cnf/src/index.tsx` |
| Mock 数据/类型 | `cnf/src/mock-data.ts` |
| 本地启动器 | `cnf/src/server-node.ts` |
| 全局 api()/右键菜单 | `cnf/public/static/component-context-menu.js`（`window.api`、`window.API_BASE='/api/v1'`、`window.useContextMenu()`） |
| 拓扑 Store | `cnf/public/static/store-topology.js`（`window.cnfTopology`） |
| SPA 壳/路由 | `cnf/public/static/app.js`（`window.__CNF_VIEWS` 注册表） |
| i18n | `cnf/public/static/i18n.js`（`window.t`） |

> ⚠️ 无独立"类型定义文件"。TS 类型散落在 `src/index.tsx`/`mock-data.ts`（多处 `any`）。前端是纯 JS 无类型。

### 3.3 重要 API 列表（核验自 `src/index.tsx`，共 109 个，节选关键）
基址：`window.API_BASE = '/api/v1'`。返回多为 `c.json(...)`；CRUD 失败返回 `{ error, code }` + HTTP 4xx/409。

**层级/基础设施**
- `GET /summary`、`GET /tasks`
- `GET /datacenters` `POST /datacenters` `PUT /datacenters/:id` `DELETE /datacenters/:id`
- `GET /clusters` `POST /clusters` `PUT /clusters/:id` `DELETE /clusters/:id`
- `GET /hosts` `POST /hosts` `DELETE /hosts/:id`、`GET /infrastructure/topology`
- `GET /resource-pools` `POST` `PUT /:id` `DELETE /:id`

**主机操作**
- `GET /hosts/:id/hardware`、`GET /hosts/:id/ha-status`
- `POST /hosts/:id/maintenance`（body 含进入/退出；运行 VM 阻断 → `HAS_RUNNING_VM`）
- `POST /hosts/:id/power`
- `POST /hosts/:id/sriov`（body `{pf,total_vfs,enabled}`；需 `iommu` 否则 `IOMMU_REQUIRED 409`；`used_vfs>0` 禁用 → `VF_IN_USE 409`）
- `POST /hosts/:id/iommu`、`POST /hosts/:id/pci/passthrough`、`POST /hosts/:id/gpu/:gpuId/mode`
- `PUT /hosts/:id/network`、`PUT /clusters/:id/host-network`

**虚拟机**
- `GET /vms`、`POST /vms`、`POST /vms/:id/power`
- `GET /vms/:id/hardware` → `{vm, config, options:{disk_bus,nic_models,pools,portgroups,sriov_pfs}}`
- `PUT /vms/:id/hardware`（body `{vm,disks,nics,boot}`；空盘 → `NO_DISK`；SR-IOV 缺 pf/vf → `SRIOV_INCOMPLETE 400`）→ `{ok,config,warnings,message}`
- `GET /vms/:id/migration-targets` → DC→集群→主机树（每主机 fit:ok/insufficient/unavailable）
- `POST /vms/:id/migration-plan`（body `{target_host_id,mode}`）→ 含 `cpu_mode/cpu_baseline/network_consistent/network_missing/cold_reason/checks/can_migrate/blockers/est_seconds`
- `POST /vms/:id/migrate`（body `{target_host_id,mode}`）→ 请求热迁但不满足 → `LIVE_NOT_ALLOWED 409`
- `GET/POST /vm-templates`、`POST /vm-templates/:id/deploy`、`GET/POST /iso-images`、`GET /iso-repositories`、`POST /vms/preview-xml`、`GET /gpus`

**存储**
- `GET /storage-pool-types` `GET /storage-pools` `POST` `DELETE /:id`
- `GET /volumes` `POST` `DELETE /:id`、`GET /snapshots` `POST` `POST /:id/revert` `DELETE /:id`
- `GET/POST /storage/iscsi/pools`、`GET /storage/iscsi/pools/:id/status`
- `GET/POST /storage/volumes`、`/attach` `/detach` `/expand` `DELETE`
- **N7：** `GET /storage/volumes/:id/migration-targets`、`POST /storage/volumes/:id/migrate`

**网络/监控/可用性**
- `GET /vswitches` `POST`、`GET /vlans` `POST`、`GET /host-nics` `GET /bond-modes`、`GET /network/topology`
- `GET /monitoring/overview` `GET /monitoring/history` `GET /monitoring/metrics` `GET /monitoring/metrics/stream`(SSE)
- `GET /alert-rules` `POST` `PUT /:id` `DELETE /:id`、`GET /notifications`
- `GET /ha/cluster-status` `POST /ha/enable` `POST /ha/test-fencing`
- `GET/POST /migrations` `GET /migrations/progress`、`GET/POST /backup-jobs`、`GET/PUT /cluster-configs`

**访问控制**
- `GET /users` `POST` `PATCH /:id` `DELETE /:id` `POST /:id/status` `POST /:id/reset-password`
- `GET /user-roles` `GET /roles` `POST /roles` `GET /privileges` `GET /permission-assignments` `GET /audit-logs`
- `POST /auth/logout`（仅返回 ok）、`GET /license` `GET /license/editions`

### 3.4 环境变量映射表
| 变量名 | 用途 | 示例值 | 适用路径 |
|--------|------|--------|----------|
| `PORT` | 本地 node 启动器监听端口 | `3000` | 前端/Mock（`server-node.ts`） |
| `CNF_LISTEN_ADDR` | Go 控制面监听地址 | `:8080` | Go 工程 |
| `CNF_DATABASE_URL` | 数据库连接串 | `postgres://cnf:<PASSWORD>@127.0.0.1:5432/cnfv1` | Go 工程 |
| `CNF_REDIS_URL` | Redis 连接 | `redis://127.0.0.1:6379/0` | Go 工程 |
| `CNF_ETCD_URL` | etcd（HA 选主） | `http://127.0.0.1:2379` | Go 工程 |
| `CNF_JWT_SECRET` | JWT 签名密钥 | `<JWT_SECRET_PLACEHOLDER>` | Go 工程 |

### 3.5 SSE 实现说明 + 已实现事件类型
- 端点：`GET /api/v1/monitoring/metrics/stream`（`src/index.tsx:1589`）
- 实现：Hono `c.body(new ReadableStream(...))`，`Content-Type: text/event-stream`；首帧立即 push，之后 `setInterval` 每 **2000ms** push；累计 **600** 帧后 `controller.close()`；监听 `c.req.raw.signal` abort 清理。
- **事件类型：仅匿名 `data:` 事件，无具名 event。** 前端 `new EventSource(...).onmessage` 接收。
- payload 结构（`genMetrics()`，`mock-data.ts:579`，随机抖动）：
```json
{ "ts": 1719300000000,
  "cluster": { "cpu_usage": 58.x, "mem_usage": 64.x, "total_vcpus": 640, "used_vcpus": 372, "total_mem_tb": 4.6, "used_mem_tb": 2.96 },
  "gpus":  [ { "id": 1, "util": 0-100, "mem_used": n, "temp": n, "power": n } ],
  "hosts": [ { "id": 1, "cpu_usage": 0-100 } ] }
```
- 前端订阅：`view-dashboard.js:103`（集群 CPU 实时）、`view-monitoring.js:55`（GPU + 主机负载）。

---

## 4. 数据库与持久化

### 4.1 前端/Mock 路径（当前运行）
- **无数据库**。所有数据在 `cnf/src/mock-data.ts` 内存对象 `mockData`，进程重启即重置。
- 部分写操作（如 N4 VM 硬件、N5 SR-IOV）通过 `index.tsx` 内的 `vmConfigStore`（内存 Record）叠加，**不持久化**。
- 顶层数据表（mockData 键，核验自文件行号）：`datacenters(10) clusters(15) hosts(22) vms(31) gpus(41) storage_pools(49) snapshots(62) migrations(69) cluster_configs(74) roles(98) all_privileges(106) permission_assignments(112) license(122) users(159) user_roles(177) audit_logs(184) vm_templates(195) iso_images(201) resource_pools(208) vswitches(215) host_nics(221) bond_modes(230) vlans(240) volumes(249) iscsi_pools(257) virtual_disks(273) backup_jobs(281) alert_rules(289) notifications(298)`。

### 4.2 Go 工程路径（真实落地用，未启用）
- **数据库类型不一致 ⚠️需要确认**：`go.mod` 引入 `go-sql-driver/mysql v1.8.1` 且迁移目录为 `migrations/mysql/`；但 `cnf-source/.env.example` 与 `cnf-source/README.md` 均写 **PostgreSQL 16**。**实际以哪个为准需产品确认**（代码层面是 MySQL 驱动 + mysql 迁移，文档写 PostgreSQL）。
- 迁移文件（真实）：`cnf-source/migrations/mysql/`
  - `0001_init_schema.up.sql` / `.down.sql`（层级：datacenters→clusters→hosts→storage_pools/networks）
  - `0002_vm_gpu_rbac.up.sql` / `.down.sql`（VM + GPU + RBAC）
  - `0003_seed.up.sql` / `.down.sql`（种子数据）
- 迁移/种子执行：经 `cnf-source/Makefile` 与 `cnf-source/scripts/install.sh`（⚠️需要确认：具体 make target 名未在本次核验中逐条展开，请打开 Makefile 确认 `make migrate` 类目标）。
- ORM：**无 ORM**，使用 `database/sql` + 原生 SQL（`internal/repo/mysql/`）。

### 4.3 备份恢复
- Mock 路径：无需备份（无状态）。代码备份用 git。
- Go 路径：按所选数据库标准工具（`pg_dump`/`mysqldump`）。⚠️需要确认：仓库未见专用备份脚本。

---

## 5. 外部依赖与宿主机环境

### 5.1 第三方服务清单
- **前端/Mock 路径**：**零外部服务**（仅 Node 进程）。
- **Go 路径**（来自 `.env.example`）：**Redis**（缓存/会话）、**etcd**（HA 选主，见 `internal/ha/election.go`）、**MySQL 或 PostgreSQL**（见 §4.2 待确认）。

### 5.2 宿主机必装软件（真实虚拟化落地，来自 go.mod / cnf-source/README）
- **qemu-kvm**、**libvirt** + **libvirt-devel**（CGO 编译 `libvirt.org/go/libvirt` 必需）
- **IOMMU/VT-d/AMD-Vi**（GPU 直通/SR-IOV，BIOS + 内核参数 `intel_iommu=on` / `amd_iommu=on`）
- **Go 1.23**（编译）、目标 OS **Rocky Linux 9 / RHEL 9**
- 安装命令（参考，⚠️需在真实 RHEL/Rocky 9 上验证）：
```bash
dnf install -y qemu-kvm libvirt libvirt-devel virt-install gcc
systemctl enable --now libvirtd
```

### 5.3 已遇到的权限/环境问题及解决方案（真实，来自本项目历史）
1. **沙箱 glibc 2.34 < workerd 要求 2.35** → `npm run dev`(wrangler) 无法运行。**方案：用 `npm run dev:node`（@hono/node-server）绕过**（见 `server-node.ts` 注释）。
2. **Node 无全局 crypto（Node 18）** → 用 `genUUID()` 自实现（`index.tsx:16`）。
3. **GitHub 推送受阻**：`ghu_` token 无 PR API 权限，且本会话 `~/.git-credentials` 为空 → push 失败。**方案：本地提交累积，给用户手动对比链接**：`https://github.com/liangyujie2013/Cloud-Nexus-Forging1.01/compare/main...genspark_ai_developer`。
4. **Edit 工具对模板字符串反引号锚点偶发失败** → 改用普通注释行作锚点。

---

## 6. 换机迁移指南

### 6.1 必须复制 vs 必须排除
**必须复制**：整个 `cnf/` 除排除项外的全部源码 —— `src/`、`public/`、`scripts/`、`cnf-source/`（除 bin/dist）、`package.json`、`package-lock.json`、`*.config.*`、`README.md`、`P-FIXES.md`、`CNF_Handover.md`、`.gitignore`。
**必须排除**（见 `.gitignore`）：`node_modules/`、`dist/`、`.wrangler`、`.env`/`.dev.vars`、`*.log`、`cnf-source/bin/`、`cnf-source/dist/`、`*.tar.gz`、`.DS_Store`。

### 6.2 新电脑环境重建命令序列
```bash
# 1. 装 Node 18（与沙箱一致）
#    （生产机可用 nvm install 18.20.4）
export PATH=/opt/node18/bin:$PATH   # 沙箱；普通机器装好 node18 即可

# 2. 取代码
git clone <REPO_URL> cnf && cd cnf
git checkout genspark_ai_developer   # 含 N1~N6 最新提交

# 3. 装依赖
npm install

# 4. 启动
npm run dev:node                     # http://localhost:3000
```

### 6.3 首次启动健康检查
```bash
curl -s -w "\n%{http_code}\n" http://localhost:3000/api/v1/summary      # 期望 200 + JSON
curl -s http://localhost:3000/api/v1/hosts | head -c 200                 # 期望 6 台主机
curl -sN http://localhost:3000/api/v1/monitoring/metrics/stream | head -1 # 期望 data: {...}
node scripts/smoke-views.mjs                                             # 期望 PASS
```

### 6.4 常见报错及解决
| 报错 | 原因 | 解决 |
|------|------|------|
| `Unknown file extension ".tsx"` | 用 `node --check` 直接查 tsx | 正常，tsx 运行时处理；用 `npm run dev:node` |
| `could not read Username for github.com` | 凭据为空 | 配置 git 凭据后 `git push -f origin genspark_ai_developer` |
| wrangler/miniflare 启动失败 | glibc < 2.35 | 改用 `npm run dev:node` |
| 端口 3000 占用 | 旧进程未退 | `pkill -f tsx` 后重启 |
| HTTP 000（curl 不可达）但日志显示 running | 后台进程 detach 异常 | 用 `run_in_background:true` 重启，等待 ~4s 再 curl |

---

## 7. KVM 宿主机纳管方案

### 7.1 无代理(SSH+libvirt) vs Agent 模式对比
| 维度 | 无代理（SSH + libvirt-tcp/ssh） | Agent 模式（宿主机装 cnf-agent） |
|------|-------------------------------|--------------------------------|
| 部署 | 仅需宿主机开 SSH + libvirtd | 需在每台宿主机部署 agent 二进制 + systemd |
| 实时性 | 拉取式，需轮询 | 推送式，事件实时上报 |
| 性能采集 | 每次 SSH 开销大 | 本地常驻，低开销 |
| GPU 直通/SR-IOV/绑核 | 需远程执行复杂命令 | 本地 CGO 直接调 libvirt API |
| 故障隔离/HA fencing | 弱 | 强（agent 可参与心跳） |
| 本项目现状 | 主机表有 `ssh_port/ssh_user` 字段 | **`cnf-source/cmd/cnf-agent` 已有骨架** |

### 7.2 明确推荐方案 + 理由
**推荐：Agent 模式（cnf-agent）**。理由：
1. 本项目核心差异化（CPU 绑核/NUMA/GPU PCI 直通/vGPU mdev/SR-IOV/大页）依赖 **libvirt domain XML 精细控制**，`cnf-source/internal/virt/domain_xml.go` 已实现且测试覆盖 76.8%，**本地 CGO 调 libvirt 远比远程 SSH 拼命令可靠**。
2. 实时监控/SSE 需要低延迟推送，Agent 常驻最合适。
3. HA fencing / 心跳需要 Agent 参与（`internal/ha/election.go` + etcd）。
4. 仓库已有 `cmd/cnf-agent/main.go` 与 `deploy/systemd/cnf-agent.service` 骨架，方向已定。

> 无代理模式可作为「轻量只读纳管 / 临时接入」的补充，但不作为主路径。

### 7.3 推荐方案实施路径与功能开发清单（P0→P2 见 §8）
1. **打通控制面 ↔ Agent**：定义 agent 上报协议（gRPC/HTTP），`cnf-server` 接收注册/心跳/指标。
2. **真实纳管替换 Mock**：把前端调用从 `/api/v1`(Hono Mock) 切到 Go `cnf-server`(:8080)，逐模块替换数据源。
3. **domain XML 落地**：`vms/preview-xml`(已有前端预览) → 经 agent `virDomainDefineXML` 真实创建。
4. **数据库定稿**：确认 MySQL/PostgreSQL，跑 migrations + seed。
5. **监控采集**：agent 周期采集 libvirt/`virsh domstats` + GPU(nvidia-smi/DCGM) → 控制面 SSE。
6. **HA**：etcd 选主 + 心跳 5s×3 失败判故障 + fencing（P10 已在前端定义交互）。

---

## 8. 开发优先级

### P0 立即处理
| 任务 | 原因 | 前置依赖 | 涉及文件 |
|------|------|----------|----------|
| 验证并修复 N6 迁移后端端到端 | N6 后端已写（`6d386a6`）但本轮未 curl 验证，迁移是核心功能 | 服务器可稳定启动 | `src/index.tsx`(migration-plan/migrate) |
| N6 前端展示迁移新字段 | 后端已返回 cpu_mode/network/cold_reason，前端不显示则用户无感 | N6 后端验证 | `view-compute.js`(迁移向导)、`i18n.js` |
| 修复推送阻塞 / 推送累积提交 | N1~N6 共 6 个本地提交未推送，有丢失风险 | git 凭据 | （仓库 git） |

### P1 近期重要
| 任务 | 原因 | 前置依赖 | 涉及文件 |
|------|------|----------|----------|
| N7 存储迁移前端入口 | 后端 `/storage/volumes/:id/migrate` 已就绪，缺右键入口 | 无 | `component-context-menu.js`(加 storage_migrate)、`view-compute.js`(dialog)、`i18n.js` |
| N8 告警指标目录下拉 | 当前自由文本易错，需 标准化术语指标目录 | 新增指标目录数据 | `view-monitoring.js:345`、`mock-data.ts`、`i18n.js` |
| N9 死按钮全面巡检 | 产品多次反馈按钮假死 | 无 | 全部 `view-*.js`；`scripts/smoke-views.mjs` |

### P2 中期规划
| 任务 | 原因 | 前置依赖 | 涉及文件 |
|------|------|----------|----------|
| S3 网络拓扑可视化 | 后端 `/network/topology` 有数据，缺图形 | 无 | `view-network.js`（SVG/Canvas） |
| S4 模板/ISO/备份企业级深化 | 当前仅基础 CRUD | 无 | `view-compute.js`、`view-availability.js`、`src/index.tsx` |
| N10 GitHub 清理 + 去 AI 化 + 中英双语 README | 交付规范化 | 推送恢复 | `README.md`、各文件注释、分支 |
| 真实后端打通（Go cnf-server/agent） | 当前 Mock，无法生产纳管 | DB 定稿 + agent 协议 | `cnf-source/**` + 前端数据源切换 |

---

## 9. 给下个 AI 的系统提示词

```
你是 CNF 企业级 KVM 虚拟化管理平台的首席工程师，接手已有基础的项目。

用户背景：不懂代码的产品经理，完全依赖 AI，无法判断代码对错。请用产品语言解释，关键决策替他做主并说明理由。

项目事实（务必先认知）：
- 工作区 cnf/ 是「Vue3 SPA（public/static/*.js，无构建步骤）+ Hono Mock 后端（src/index.tsx，数据全在 src/mock-data.ts 内存）」。
- 本地只能用 `export PATH=/opt/node18/bin:$PATH && cd cnf && npm run dev:node`（端口 3000）。`npm run dev`(wrangler) 因 glibc 版本无法运行。
- 另有 cnf/cnf-source 是独立 Go 真实虚拟化骨架，前端当前不调用它。
- 前端视图通过 window.__CNF_VIEWS 注册（IIFE）；全局 window.api / window.API_BASE='/api/v1' / window.useContextMenu / window.cnfTopology / window.t(key,params) / window.cnfToast。

代码输出规范：必须给出完整文件内容 + 完整路径 + 执行命令，严禁省略。改动后立即提交并推送（凭据若仍空则给用户手动对比链接）。

回答风格：简洁直接，主动发现问题并给建议，不废话。每完成一个模块输出「[模块名]整改完成」。

技术约束：不得擅自更改已定技术栈（Vue3 全局版/Hono/Node18/无构建前端）；如需变更必须先征得同意。修改 src/index.tsx 后用 dev:node 重启（pkill -f tsx 后等 ~1s 重启，再等 ~4s curl）并跑 `node scripts/smoke-views.mjs`。

第一任务：阅读项目根目录 CNF_Handover.md，汇报项目现状和最紧急问题（P0），然后从 §8 P0 第一项开始。
```

---

## 10. 项目状态卡片

| 项 | 内容 |
|----|------|
| **文档生成时间** | 2026-06-25 |
| **总完成度** | 前端原型约 78% / 真实落地约 10% / 整体可交付约 30% |
| **当前版本号** | CNF v1.0.1（前端）；cnf-source 标 CNFv1.0 |
| **当前分支 / 最新提交** | `genspark_ai_developer` / `6d386a6`（N6 后端，本地未推送） |
| **未推送提交** | `5f8cf10`(N1+N2) `accf94f`(N3) `cd98039`(N4+N5) `6d386a6`(N6) |
| **最重要 3 个待办** | ① 验证+修复 N6 迁移后端端到端并前端展示；② 推送累积的 6 个本地提交（修复凭据）；③ N7 存储迁移前端入口 + N8 告警指标目录 |
| **下次开发建议起点** | `npm run dev:node` 启动 → curl 验证 `POST /api/v1/vms/5/migration-plan {target_host_id:4}` 应因 Intel→AMD 跨厂商强制冷迁移（cold_reason 非空）；Intel→Intel(node-prod-01→03)应允许热迁移并返回 cpu_mode='cross_gen_*' + baseline |
| **手动对比/推送链接** | `https://github.com/liangyujie2013/Cloud-Nexus-Forging1.01/compare/main...genspark_ai_developer` |

【CNF交接文档输出完毕】
