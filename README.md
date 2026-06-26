<div align="center">

# Cloud Nexus Forging (CNF)

**企业级 KVM 虚拟化管理平台 · Enterprise-Grade KVM Virtualization Management Platform**

对标 VMware vCenter / Proxmox VE / SmartX CloudTower
Benchmarked against VMware vCenter / Proxmox VE / SmartX CloudTower

![Version](https://img.shields.io/badge/version-1.0.1-blue) ![Frontend](https://img.shields.io/badge/frontend-Vue%203-42b883) ![API](https://img.shields.io/badge/API-Hono%2FREST-orange) ![i18n](https://img.shields.io/badge/i18n-中文%20%2F%20English-success)

[中文](#中文文档) · [English](#english)

</div>

---

<a name="中文文档"></a>

## 中文文档

### 产品简介

**Cloud Nexus Forging（CNF）** 是一款企业级 KVM 虚拟化管理平台，通过单一 Web 控制台对**计算、存储、网络、可用性**资源进行统一纳管。平台采用「数据中心 → 集群 → 宿主机 → 虚拟机」四级层级模型，提供从基础设施编排到单台虚拟机精细化运维的完整工作流，界面全面支持**简体中文 / English** 双语。

> **当前形态说明**：本仓库交付的是 **Vue 3 前端 + Hono REST 后端** 的功能平台；后端当前以内存数据驱动用于演示与交互验证。面向真实宿主机的虚拟化落地（libvirt/KVM）由独立的 Go 工程 `cnf-source/` 承载（见 [真实落地架构](#真实落地架构)）。

### 核心能力

| 模块 | 能力 |
|------|------|
| **基础设施** | 数据中心 / 集群 / 资源池管理，四级拓扑模型 |
| **宿主机** | 主机纳管（SSH 参数）、4 Tab 详情、维护模式、IOMMU/VFIO、PCI 直通、GPU 模式、**SR-IOV PF/VF** |
| **计算资源** | 虚拟机全生命周期、多页签编辑（CPU/磁盘/网卡/引导）、模板、ISO 镜像 |
| **企业级迁移** | 跨数据中心 / 跨集群 / 跨节点迁移；**同指令集跨代 CPU 兼容**；**网络一致性冷/热迁移判定** |
| **存储** | 存储池（local / NFS / iSCSI / FC / 分布式）、卷管理、快照（级联安全约束）、**存储迁移** |
| **网络** | 虚拟交换机、VLAN、网卡 Bond、网络拓扑 |
| **可用性** | 高可用策略、迁移记录、备份任务 |
| **监控** | 集群 KPI、实时主机/GPU 指标（SSE 推送）、历史趋势图、告警规则 |
| **访问控制** | 用户 / 角色 / 权限 / 操作审计、License 节点分级（社区 1–3 / 标准 4–31 / 企业 32–64） |
| **系统** | 平台配置、授权、关于 |

### 技术栈

- **前端**：Vue 3（全局构建版，零构建步骤）、Chart.js 指标可视化、Apple HIG 设计语言
- **后端**：Hono（边缘运行时框架），暴露版本化 REST API（`/api/v1`，共 109 个端点）
- **实时**：Server-Sent Events（SSE）推送实时指标
- **国际化**：自研轻量 i18n（`window.t(key, params)`，中英全量）
- **构建与部署**：Vite 构建，可部署至 Cloudflare Pages
- **真实落地骨架**：Go 1.23 + Fiber v3 + libvirt + MySQL/PostgreSQL（`cnf-source/`）

### 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 本地启动开发服务器（Node 运行时，推荐）
npm run dev:node          # 访问 http://localhost:3000

# 3. 生产构建（Cloudflare Pages）
npm run build
```

> **说明**：本地开发请使用 `npm run dev:node`（基于 `@hono/node-server`，绕开 Cloudflare workerd 对 glibc 的版本依赖）。`npm run dev`（Vite + Wrangler）用于支持 workerd 的环境；生产部署走 `npm run build` + Cloudflare Pages。

- REST API 基址：`/api/v1`
- 实时指标 SSE 端点：`/api/v1/monitoring/metrics/stream`（每 2 秒推送一次）

### 项目结构

```
.
├── src/                        # Hono 后端
│   ├── index.tsx               # REST API（109 端点）+ SSE
│   ├── mock-data.ts            # 数据层（演示数据 + 指标生成）
│   ├── libvirt-xml.ts          # libvirt domain XML 生成器
│   └── server-node.ts          # 本地 Node 启动器
├── public/static/              # 前端（浏览器直接加载，无构建）
│   ├── app.js                  # SPA 壳 / 路由 / 全局 API
│   ├── i18n.js                 # 中英双语
│   ├── view-*.js               # 各业务模块视图
│   ├── component-*.js          # 向导 / 右键菜单 / 拓扑树等组件
│   └── vendor/                 # Vue / Chart.js / FontAwesome（本地化）
├── cnf-source/                 # Go 真实虚拟化工程（控制面 + Agent）
├── scripts/smoke-views.mjs     # 视图烟雾测试
├── CNF_PRD.md                  # 产品需求文档
└── CNF_Handover.md             # 技术交接白皮书
```

<a name="真实落地架构"></a>
### 真实落地架构（规划路线）

面向真实宿主机的虚拟化由 `cnf-source/` 承载，推荐采用 **Agent 模式**：

- **cnf-server**（控制面，Fiber v3）：REST API + RBAC + HA 选主（etcd）
- **cnf-agent**（宿主机代理，libvirt CGO）：本地调用 libvirt，精细控制 CPU 绑核 / NUMA / GPU 直通 / vGPU / SR-IOV / UEFI / 大页，并采集指标
- **依赖**：MySQL/PostgreSQL + Redis + etcd
- **宿主机要求**：Rocky Linux 9 / RHEL 9、qemu-kvm、libvirt、IOMMU（VT-d / AMD-Vi）

详见 [`CNF_Handover.md`](./CNF_Handover.md) 与 [`CNF_PRD.md`](./CNF_PRD.md)。

### 文档

| 文档 | 用途 |
|------|------|
| [`CNF_PRD.md`](./CNF_PRD.md) | 产品需求文档（模块、功能状态、业务流程、路线图） |
| [`CNF_Handover.md`](./CNF_Handover.md) | 技术交接白皮书（架构、API、数据、部署、迁移指南） |

### 许可

专有软件（Proprietary）。文中涉及的产品、品牌及硬件商标均归各自所有者所有。

---

<a name="english"></a>

## English

### Overview

**Cloud Nexus Forging (CNF)** is an enterprise-grade KVM virtualization management platform that provides unified control over **compute, storage, network, and availability** resources through a single web console. Built on a four-tier topology model (Datacenter → Cluster → Host → VM), CNF delivers a complete operations workflow from infrastructure orchestration down to fine-grained per-VM management, with a fully bilingual interface (简体中文 / English).

> **Current form**: This repository delivers a **Vue 3 frontend + Hono REST backend** platform. The backend is currently driven by in-memory data for demonstration and interaction validation. Real-host virtualization (libvirt/KVM) is delivered by the standalone Go project `cnf-source/` (see [Real-World Architecture](#real-world-architecture)).

### Key Capabilities

| Module | Capabilities |
|--------|-------------|
| **Infrastructure** | Datacenter / cluster / resource-pool management with a four-tier topology |
| **Hosts** | SSH-based onboarding, 4-tab detail view, maintenance mode, IOMMU/VFIO, PCI passthrough, GPU mode, **SR-IOV PF/VF** |
| **Compute** | Full VM lifecycle, multi-tab editing (CPU/disk/NIC/boot), templates, ISO images |
| **Enterprise Migration** | Cross-datacenter / cross-cluster / cross-host migration; **same-ISA cross-generation CPU compatibility**; **network-consistency-based live/cold decision** |
| **Storage** | Storage pools (local / NFS / iSCSI / FC / distributed), volumes, snapshots with cascade-safety, **storage migration** |
| **Networking** | Virtual switches, VLANs, NIC bonding, network topology |
| **Availability** | High-availability policies, migration records, backup jobs |
| **Monitoring** | Cluster KPIs, real-time host/GPU metrics (SSE), time-series charts, alert rules |
| **Access Control** | Users / roles / privileges / audit logs; license tiers (Community 1–3 / Standard 4–31 / Enterprise 32–64) |
| **System** | Platform configuration, licensing, about |

### Technology

- **Frontend** — Vue 3 (global build, no build step required), Chart.js, Apple-HIG design language
- **Backend** — Hono (edge runtime), versioned REST API (`/api/v1`, 109 endpoints)
- **Real-time** — Server-Sent Events (SSE) for live metric streaming
- **i18n** — Lightweight in-house i18n (`window.t(key, params)`), full zh/en coverage
- **Build & Deploy** — Vite build, deployable to Cloudflare Pages
- **Real-world skeleton** — Go 1.23 + Fiber v3 + libvirt + MySQL/PostgreSQL (`cnf-source/`)

### Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start the local dev server (Node runtime, recommended)
npm run dev:node          # http://localhost:3000

# 3. Production build (Cloudflare Pages)
npm run build
```

> **Note**: For local development use `npm run dev:node` (built on `@hono/node-server`, bypassing workerd's glibc dependency). `npm run dev` (Vite + Wrangler) targets workerd-capable environments; production deploys via `npm run build` + Cloudflare Pages.

- REST API base path: `/api/v1`
- Real-time metrics SSE endpoint: `/api/v1/monitoring/metrics/stream` (pushes every 2 seconds)

<a name="real-world-architecture"></a>
### Real-World Architecture (Roadmap)

Real-host virtualization is carried by `cnf-source/`, with the recommended **Agent mode**:

- **cnf-server** (control plane, Fiber v3): REST API + RBAC + HA leader election (etcd)
- **cnf-agent** (host agent, libvirt CGO): local libvirt control for CPU pinning / NUMA / GPU passthrough / vGPU / SR-IOV / UEFI / hugepages, plus metric collection
- **Dependencies**: MySQL/PostgreSQL + Redis + etcd
- **Host requirements**: Rocky Linux 9 / RHEL 9, qemu-kvm, libvirt, IOMMU (VT-d / AMD-Vi)

See [`CNF_Handover.md`](./CNF_Handover.md) and [`CNF_PRD.md`](./CNF_PRD.md) for details.

### Documentation

| Document | Purpose |
|----------|---------|
| [`CNF_PRD.md`](./CNF_PRD.md) | Product Requirements Document (modules, feature status, flows, roadmap) |
| [`CNF_Handover.md`](./CNF_Handover.md) | Technical handover whitepaper (architecture, API, data, deployment, migration guide) |

### License

Proprietary. All product, brand, and hardware trademark names referenced herein remain the property of their respective owners.
