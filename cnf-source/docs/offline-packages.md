# CNF 平台 · 离线安装包清单与准备指南

> 设计理念（**离线包优先**）：平台纳管主机时**不依赖目标宿主机的 yum/dnf 在线源**。
> 流程是：先**检测目标主机已安装哪些虚拟化计算组件、缺哪些**，对缺失部分，
> 只要平台预置了适配该 OS 版本的离线依赖包，就通过 SSH 把 RPM 推送到目标主机，
> 再用 `dnf install --disablerepo='*' *.rpm` **完全离线本地安装**（已装的自动跳过）。
> 仅当平台**尚未预置**该 OS 版本离线包时，才回退使用目标主机自带在线源。
>
> 因此这批离线包是平台**长期集成的核心能力**，建议一次性备齐：本文给出 CNF 平台
> **全部能力**所需的软件包清单（按 HOST OS 版本区分）以及一键下载脚本。你只需在
> **EL8 / EL9 / EL10** 各类系统上运行脚本，把产物放进平台离线仓库目录即可，
> 之后所有纳管都将走离线推送、无需目标主机联网。

---

## 1. 平台离线仓库目录约定

平台读取目录由环境变量 `CNF_OFFLINE_PKG_PATH` 指定，默认：

```
/var/lib/cnf/offline-packages/
├── el8/        # RHEL/Rocky/AlmaLinux/CentOS Stream 8 的 RPM（含全部依赖）
│   ├── qemu-kvm-*.rpm
│   ├── libvirt-*.rpm
│   └── ... (依赖包)
├── el9/        # EL9 系
├── el10/       # EL10 系
└── common/     # 跨版本通用包（可选，所有 OS 都会附加安装）
```

平台启动日志会打印：`离线安装包仓库就绪: /var/lib/cnf/offline-packages`。
接口 `GET /api/v1/offline-packages` 返回仓库内容与按 osTag 分组的数量。

---

## 2. 软件包清单（按能力分档）

> 目标 OS 取主版本号 `rpm -E %rhel` → 8 / 9 / 10，分别对应 `el8/el9/el10`。

### 2.1 核心组件（必装 · 缺一则平台无法纳管或起 VM）

| 软件包 | 用途 | 对应平台能力 |
|--------|------|------------|
| `qemu-kvm` | KVM 用户态模拟器（元包） | 起 VM 的根本 |
| `libvirt` | 虚拟化管理 API + 守护进程 | 所有纳管/管理操作 |
| `libvirt-daemon-driver-qemu` | libvirt 的 QEMU 驱动 | qemu+tcp 连接 |
| `libvirt-daemon-driver-network` | 虚拟网络驱动 | 网络 / NAT |
| `libvirt-daemon-driver-storage` | 存储池驱动 | qcow2 存储池 |
| `libvirt-client` | virsh 命令行 | 排错 / 校验 |
| `virt-install` | 命令行创建 VM | 创建 VM |
| `qemu-img` | 磁盘镜像管理 | 系统盘 / 快照 |

### 2.2 能力扩展（按后续功能选装，强烈建议全收）

| 软件包 | 用途 | 对应平台能力 |
|--------|------|------------|
| `libguestfs-tools` | VM 文件系统读写（注入密码 / SSH key / cloud-init） | 模板定制、首次密码注入 |
| `virt-top` | VM 资源监控 | 监控面板 |
| `swtpm` + `swtpm-tools` | 软件 TPM 2.0 | Windows 11 / 安全启动 |
| `edk2-ovmf` | UEFI 固件 | UEFI 启动 VM |
| `libvirt-daemon-driver-nodedev` | 节点设备枚举 | **GPU / PCI 直通**（VFIO） |
| `libvirt-daemon-driver-secret` | 密钥管理 | 加密磁盘 / Ceph 认证 |
| `nfs-utils` | NFS 客户端 | NFS 共享存储 / 迁移 |
| `chrony` | 时间同步 | HA / 在线迁移前置（时钟偏移检测） |
| `tuned` | 性能调优 profile | 宿主机性能优化 |

### 2.3 版本差异（EL8 vs EL9/EL10）—— 已在脚本中自动处理

| 差异点 | EL8 | EL9 / EL10 |
|--------|-----|------------|
| 网桥工具 | `bridge-utils`（可下载） | 已移除，用系统自带 `iproute`（无需单独下载） |
| libvirt 守护进程 | 单体 `libvirtd`（默认） | **模块化 daemon**（EL9 默认 / EL10 唯一）：`virtqemud` / `virtnetworkd` / `virtstoraged` / `virtproxyd`（由 `libvirt` 元包带入，无需单独下载） |
| 启动方式 | `systemctl enable --now libvirtd` | `systemctl enable/start virtqemud.socket`（含 ro/admin）等，**socket 激活**，首次连接自动拉起 `.service` |
| TCP 监听 | `libvirtd.conf`（`listen_tcp`/`tcp_port`）+ `LIBVIRTD_ARGS="--listen"`，重启 libvirtd | `virtproxyd-tcp.socket`（socket 激活；`*.conf` 内 `listen_tcp` **被忽略**），鉴权在 `virtproxyd.conf` 设 `auth_tcp="none"` |

> ✅ **已实现（平台后端自动适配，无需人工干预）**：后端 `internal/onboard/service.go` 会按目标主机
> `/etc/os-release` 主版本与实际存在的 systemd 单元，自动判定守护进程模式并执行正确启动 / TCP 流程：
> - **EL8** → 单体 `libvirtd`（`enable --now libvirtd` + `libvirtd.conf` 开 TCP）。
> - **EL9** → 默认模块化 `virtqemud.socket` 等（socket 激活）；远程走 `virtproxyd-tcp.socket`。
> - **EL10** → 单体 `libvirtd` 已弃用/不可用，**强制** 模块化 + `virtproxyd`（这正是早期 EL10 纳管在
>   `systemctl enable --now libvirtd` 处失败的根因之一）。
>
> 此外，后端在启动守护进程**之前**会用离线仓库里的系统基础包（`openssl-libs`/`systemd`/`glibc` 等）
> 做一次 `dnf upgrade --disablerepo='*'` 健康修复，对齐版本，**预防/修复**「新 systemd + 旧 openssl-libs」
> 造成的 `EVP_MD_CTX_get_size_ex / OPENSSL_3.4.0` 符号查找失败（`systemctl` status 127）。
>
> **软件包层面**：`libvirt` 元包已包含这些 daemon，**你下载离线包时无需额外列出**。但请确保离线仓库里
> **包含与目标系统匹配的 `openssl-libs` / `systemd` 等基础包**（一键脚本默认会带上），健康修复才能生效。

---

## 3. 一键下载脚本

脚本位置：`cnf-source/scripts/cnf-download-packages.sh`

在**每一种 HOST OS**（EL8 / EL9 / EL10）上以 **root** 运行一次：

```bash
# 1) 把脚本拷到对应 OS 的机器上
scp cnf-download-packages.sh root@<该OS机器>:/root/

# 2) 在该机器上运行（需要该机器能联网访问 yum/dnf 源）
chmod +x cnf-download-packages.sh
./cnf-download-packages.sh

# 3) 产物：当前目录生成 cnf-offline-el<N>/ 目录，内含全部 RPM（含依赖）
```

脚本核心是 `dnf download --resolve --alldeps`，会把每个包**连同全部依赖**一起下载，
保证推到目标机后能完全离线安装。

---

## 4. 放入平台

把三种 OS 下载好的目录分别放进沙箱/平台的离线仓库：

```bash
# 在平台机器上
mkdir -p /var/lib/cnf/offline-packages/{el8,el9,el10}

# 把 EL8 机器下载的 cnf-offline-el8/*.rpm 放进 el8/
cp cnf-offline-el8/*.rpm  /var/lib/cnf/offline-packages/el8/
cp cnf-offline-el9/*.rpm  /var/lib/cnf/offline-packages/el9/
cp cnf-offline-el10/*.rpm /var/lib/cnf/offline-packages/el10/
```

放好后调用 `GET /api/v1/offline-packages` 应能看到各 osTag 的包数量。
之后纳管裸机时，若目标机源不可用，平台会**自动**推送对应版本的 RPM 离线安装。

---

## 5. 验证

```bash
# 平台机器上：确认目录与文件
ls -la /var/lib/cnf/offline-packages/el8/ | head

# 通过 API 确认（需先登录拿 token）
curl -s http://127.0.0.1:8090/api/v1/offline-packages \
  -H "Authorization: Bearer <token>" | python3 -m json.tool
```

期望返回 `groups: {"el8": N, "el9": M, ...}`，`enabled: true`。
