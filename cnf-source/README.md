# CNFv1.0 — Cloud Native Foundation v1.0

> 企业级私有云虚拟化管理平台，对标业界主流虚拟化平台。
> 目标 OS：**Rocky Linux 9.x / RHEL 9.x**。技术栈：**Go 1.22 + Fiber v3 + PostgreSQL 16 + libvirt/KVM**。

本目录是 **路径 A（源码工程）** 的完整交付物。代码在沙箱中经过编译与单元测试验证，
但真正的虚拟化运行**必须在您自己的 Rocky Linux 9 物理服务器上编译部署**（依赖 libvirt/KVM/IOMMU）。

---

## 目录结构

```
cnf-source/
├── cmd/
│   ├── cnf-server/         # 控制面服务入口（Fiber v3 REST API）
│   └── cnf-agent/          # 宿主机代理（libvirt/KVM 桥接，CGO）
├── internal/
│   ├── api/v1/             # REST API v1 路由
│   ├── config/             # 配置加载
│   ├── model/              # 领域模型（hierarchy.go / vm.go）
│   ├── virt/               # ★ libvirt domain XML 生成器（核心差异化）
│   │   ├── domain_xml.go       # CPU拓扑/绑核/NUMA/GPU直通/UEFI/大页
│   │   └── domain_xml_test.go  # 单元测试，覆盖率 76.8%
│   └── storage/            # 统一存储驱动接口 + local/NFS/iSCSI 实现
├── migrations/             # PostgreSQL 16 DDL（0001 层级 / 0002 VM+GPU+RBAC）
├── deploy/systemd/         # cnf-server.service / cnf-agent.service
├── scripts/                # install.sh / upgrade.sh
├── web/src/apple-hig.css   # Apple HIG 设计系统（前端复用）
├── Makefile
└── .env.example
```

## 核心差异化能力（已实现并测试）

| 能力 | 文件 | 说明 |
|------|------|------|
| **CPU 绑核 (cputune)** | `internal/virt/domain_xml.go` | vCPU→pCPU 精确映射 / 顺序映射 / cpuset 区间压缩 |
| **NUMA 亲和 (numatune)** | 同上 | 内存 strict 绑定到指定 NUMA 节点 |
| **CPU 拓扑** | 同上 | sockets × cores × threads + guest NUMA cell |
| **GPU PCI 直通** | 同上 | hostdev type='pci'，自动解析 `0000:81:00.0` |
| **vGPU (mdev)** | 同上 | hostdev type='mdev' + mdev UUID |
| **UEFI / Secure Boot** | 同上 | OVMF loader + NVRAM + SMM |
| **大页内存** | 同上 | memoryBacking hugepages |
| **磁盘 QoS / 链式克隆** | 同上 | iotune + backingStore |
| **统一存储驱动** | `internal/storage/` | local(qcow2) / NFS(mount) / iSCSI(iscsiadm+LVM) |

## 数据库设计

- `0001_init_hierarchy.up.sql`：datacenters → clusters → hosts → storage_pools / networks（外键级联）
- `0002_vm_gpu_rbac_metrics.up.sql`：vms（完整 CPU/NUMA/绑核字段）、gpu_devices、vm_disks/nics、vm_gpus、vm_snapshots、users(RBAC)、tasks、metrics_samples、audit_logs

## 编译与部署

### 1. 自动安装（推荐）
```bash
# 在 Rocky Linux 9 / RHEL 9 上以 root 运行
sudo ./scripts/install.sh --single                    # 单节点
sudo ./scripts/install.sh --init-cluster              # 初始化集群
sudo ./scripts/install.sh --join-cluster 10.0.1.11    # 加入集群
```

### 2. 手动编译
```bash
# 安装编译依赖
sudo dnf install -y golang libvirt-devel gcc postgresql16-server

# 编译（cnf-server 可静态编译，cnf-agent 需 CGO+libvirt-devel）
make build      # 产出 bin/cnf-server bin/cnf-agent
make test       # 运行单元测试（XML 生成器覆盖率 76.8%）
make dist       # 打包 dist/cnfv1-1.0.0.tar.gz
```

### 3. 数据库迁移
```bash
export CNF_DATABASE_URL="postgres://cnf:cnf@127.0.0.1:5432/cnfv1?sslmode=disable"
make migrate
```

### 4. 启动
```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo cp .env.example /etc/cnf/server.env   # 修改密钥
sudo systemctl enable --now cnf-server cnf-agent
curl http://127.0.0.1:8080/healthz
```

## API 入口（v1）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/auth/login | 登录 |
| GET/POST | /api/v1/datacenters | 数据中心 |
| GET/POST | /api/v1/clusters | 集群 |
| GET/POST | /api/v1/hosts | 宿主机 |
| GET/POST | /api/v1/vms | 虚拟机（创建含 CPU拓扑/绑核/NUMA/GPU） |
| POST | /api/v1/vms/:id/migrate | 热迁移 |
| POST | /api/v1/vms/:id/snapshots | 快照（含 NVRAM） |
| GET | /api/v1/vms/:id/xml | 预览 libvirt XML |
| GET | /api/v1/gpus | GPU 列表 |
| GET | /api/v1/metrics/stream | SSE 实时监控 |

> 注：API 路由已搭建骨架（`internal/api/v1/routes.go`），service 层业务逻辑为第二阶段实现重点。

## 测试

```bash
$ make test
ok  github.com/cnf/cnfv1/internal/virt   coverage: 76.8% of statements
```

## 未实现 / 后续阶段（P1-P3）

- service 层完整业务逻辑（VM 生命周期、热迁移、DRS 调度算法）
- libvirt-go 连接池与实际 domain 操作
- HA 故障转移 + etcd 分布式锁 + keepalived VIP 联调
- Prometheus 指标导出器
- 多租户 / 完整 RBAC 中间件

## 默认凭据

`admin / admin123`（迁移脚本注入，bcrypt 加密，**生产环境务必修改**）。
