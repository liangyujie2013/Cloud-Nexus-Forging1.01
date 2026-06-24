# Cloud Nexus Forging (CNF)

## 项目概述
- **产品名**：Cloud Nexus Forging（CNF）
- **版本**：v1.0.1
- **定位**：企业级分布式虚拟化管理平台（CNF 自有产品，不包含任何第三方品牌名）
- **当前阶段**：阶段一（路径 B）— 可在线点击的原型（Vue 3 CDN + Hono Mock 后端，部署于 Cloudflare Pages 沙箱）

## 已完成功能（阶段一）
- ✅ **产品改名**：CNFv1.0 → Cloud Nexus Forging v1.0.1（品牌、标题、favicon）
- ✅ **9 模块导航**：左侧手风琴式导航，模块 + 子菜单两级
  1. 仪表板（资源概览 / 性能监控 / 告警摘要）
  2. 基础设施（数据中心 / 集群管理 / 主机节点 / 资源池）
  3. 计算资源（虚拟机列表 / 模板管理 / ISO 镜像）
  4. 可用性管理（HA 配置 / 迁移中心 / 备份恢复）
  5. 存储管理（存储池 / 卷管理 / 快照树）
  6. 网络管理（虚拟交换机 / VLAN 配置 / 网络拓扑）
  7. 监控告警（实时监控 / 历史性能 / 告警规则）
  8. 访问控制（用户管理 / 角色权限 / 操作审计）
  9. 系统设置（基础配置 / License 管理 / 关于系统）
- ✅ **VM 右键上下文菜单**：电源 / 控制台 / 快照 / 迁移 / 管理 五组
- ✅ **License 页面**：当前许可证 + 用量进度条 + 社区版/标准版/企业版三版本特性对比
- ✅ **RBAC 界面**：用户列表、角色-权限矩阵、权限分配、操作审计日志
- ✅ **顶部工具栏**：面包屑 / 全局搜索 / 通知中心 / 用户菜单 / 语言切换 / 三主题（白/深灰/黑）
- ✅ **中英双语 i18n** + **三主题** + **SSE 实时监控流**
- ✅ **libvirt Domain XML 实时预览**（VM 创建向导，真实生成逻辑）

### 企业级交互改造（本轮新增）
- ✅ **品牌去第三方化**：界面/源码/构建产物零第三方品牌词，全部采用 CNF 自有中性术语（在线迁移 / 动态资源调度 / 高可用(HA) / CPU 兼容模式 / 分布式存储）
- ✅ **通用右键菜单管理器** `useContextMenu`：智能视口边界计算（实测菜单尺寸后夹取）、ESC / 点击外部 / 滚动 / resize / 失焦 自动关闭
- ✅ **VM 右键菜单增强**：状态联动禁用、危险操作红色、快捷键提示、分组标题 + 分割线、毛玻璃背景 + 淡入动画
- ✅ **列表页 CRUD 标准化（计算资源）**：工具栏 [+新建][批量▾][筛选][搜索][刷新] + 多选/全选 + 分页 + 状态筛选 + 删除二次确认（显示对象名 + 红色危险按钮） + 编辑/重命名表单（校验规则 + loading + Toast）
- ✅ **二层虚拟交换机创建**：以「宿主机网卡图标」网格方式选择上联口（多选）；多网卡自动进入 bond，提供 7 种链路聚合模式可视化选择（balance-rr / active-backup / 802.3ad LACP / balance-xor / broadcast / balance-tlb / balance-alb）

## 公网访问
- **沙箱预览**：见对话中 GetServiceUrl 返回的临时 URL（端口 3000）
- **生产部署**：阶段二交付（Cloudflare Pages）

## API（RESTful，统一前缀 `/api/v1`，按 9 模块组织）
| 模块 | 主要端点 |
|------|----------|
| 仪表板 | `GET /summary`、`GET /tasks` |
| 基础设施 | `GET /datacenters`、`/clusters`、`/hosts`、`/resource-pools`、`/infrastructure/topology` |
| 计算资源 | `GET /vms`、`/vm-templates`、`/iso-images`、`/gpus`；`POST /vms`、`POST /vms/:id/power`、`POST /vms/preview-xml` |
| 可用性 | `GET/PUT /cluster-configs[/:id]`、`GET/POST /migrations`、`GET /migrations/progress`、`GET /backup-jobs` |
| 存储 | `GET /storage-pools`、`/volumes`、`GET/POST /snapshots` |
| 网络 | `GET /vswitches`、`/vlans`、`/host-nics`、`/bond-modes`、`/network/topology`；`POST /vswitches`（二层交换机创建 + bond）|
| 监控 | `GET /alert-rules`、`/notifications`、`/monitoring/metrics[/stream]` |
| 访问控制 | `GET /users`、`GET/POST /roles`、`/privileges`、`/permission-assignments`、`/audit-logs` |
| 系统 | `GET /license`、`GET /license/editions` |

## 数据架构
- **数据模型**：数据中心/集群/主机/VM/GPU/存储池/卷/快照/迁移/集群配置/角色/权限/用户/审计/许可证/版本矩阵/模板/ISO/资源池/虚拟交换机/VLAN/宿主机网卡/bond 模式/备份任务/告警规则/通知（共 26 类）
- **存储服务**：原型阶段使用内存 Mock 数据（`src/mock-data.ts`）；阶段二迁移至生产数据库
- **数据流**：前端 `window.api(/api/v1/*)` → Hono 路由 → mockData / genMetrics

## 代码结构（文件名自解释）
```
src/index.tsx                       # Hono Mock 后端（/api/v1 RESTful，9 模块分区）
src/mock-data.ts                    # 24 类模拟数据 + genMetrics
src/libvirt-xml.ts                  # libvirt Domain XML 生成
public/static/i18n.js               # 中英双语词典 + 主题系统（最先加载）
public/static/component-context-menu.js  # 通用右键菜单管理器 useContextMenu + VM 菜单 + 全局 window.api / cnfToast 初始化
public/static/component-vm-wizard.js     # VM 创建向导（8 步）
public/static/view-dashboard.js          # 仪表板
public/static/view-infrastructure.js     # 基础设施
public/static/view-compute.js            # 计算资源
public/static/view-availability.js       # 可用性管理
public/static/view-storage.js            # 存储管理
public/static/view-network.js            # 网络管理
public/static/view-monitoring.js         # 监控告警
public/static/view-access-control.js     # 访问控制
public/static/view-system.js             # 系统设置（含 License 页）
public/static/app.js                     # 应用根组件（导航 + 工具栏，最后加载）
public/static/app.css / apple-hig.css    # 样式（Apple HIG 设计系统）
```

## 用户指南
1. 左侧点击任一模块标题展开子菜单，点击子项切换视图
2. 计算资源 → 虚拟机列表：右键任意 VM 调出上下文菜单（开机/关机/迁移/快照等）
3. 计算资源 → 虚拟机列表：工具栏新建/批量/筛选/搜索/刷新，勾选后批量操作，右键或“⋮”弹出菜单，删除需二次确认
4. 网络管理 → 虚拟交换机：点「创建虚拟交换机」，点击宿主机网卡图标选择上联口（多选动 bond）并选 bond 模式
5. 系统设置 → License 管理：查看许可用量与三版本对比
6. 右上角切换中/英文与白/深灰/黑三主题；铃铛查看通知中心

## 未实现 / 阶段二计划（路径 A · 生产部署）
- ⏳ Python/FastAPI 生产源码包（编译验证 + 数据库测试 + API 测试）
- ⏳ Element Plus + Vite 生产级前端
- ⏳ 部署脚本（生产部署，非 demo）
- ⏳ 资源调度拖拽迁移编排在 9 模块结构中的最终落位

## 部署
- **平台**：Cloudflare Pages（沙箱预览）
- **状态**：✅ 阶段一原型运行中
- **技术栈**：Hono + TypeScript + Vue 3 (CDN) + TailwindCSS/Apple HIG + Vite
- **最后更新**：2026-06-24
