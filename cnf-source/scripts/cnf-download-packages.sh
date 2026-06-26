#!/bin/bash
# =============================================================================
#  cnf-download-packages.sh
#  在 EL8 / EL9 / EL10 各类 HOST OS 上以 root 运行一次，下载 CNF 平台所需的
#  全部 RPM（含所有依赖），用于平台「离线安装包」仓库。
#
#  用法：
#     chmod +x cnf-download-packages.sh
#     ./cnf-download-packages.sh
#
#  产物：当前目录下生成 cnf-offline-el<N>/ ，内含全部 .rpm（含依赖）。
#  然后把该目录放进平台 /var/lib/cnf/offline-packages/el<N>/ 即可。
#
#  要求：运行机器需能联网访问 yum/dnf 源（仅下载阶段需要，目标机安装时不需要）。
# =============================================================================
set -euo pipefail

# ---- 0. 识别 OS 主版本 ----
if ! command -v rpm >/dev/null 2>&1; then
  echo "错误：本脚本仅适用于 RPM 系（RHEL/Rocky/AlmaLinux/CentOS Stream）。" >&2
  exit 1
fi
EL=$(rpm -E %rhel 2>/dev/null || echo "")
if [ -z "$EL" ]; then
  echo "错误：无法识别 EL 主版本（rpm -E %rhel 为空）。" >&2
  exit 1
fi

OUT="cnf-offline-el${EL}"
mkdir -p "$OUT"
cd "$OUT"
echo "==> 目标 OS: EL${EL}    输出目录: $(pwd)"

# ---- 1. 确保 dnf download 插件可用 ----
echo "==> 安装 dnf-plugins-core（提供 dnf download）..."
dnf install -y dnf-plugins-core >/dev/null 2>&1 || \
  yum install -y dnf-utils yum-utils >/dev/null 2>&1 || true

# ---- 2. 软件包清单 ----
# 核心组件（必装）
CORE="qemu-kvm \
libvirt \
libvirt-daemon-driver-qemu \
libvirt-daemon-driver-network \
libvirt-daemon-driver-storage \
libvirt-daemon-driver-nodedev \
libvirt-daemon-driver-secret \
libvirt-client \
virt-install \
qemu-img"

# 能力扩展（建议全收：模板注入/监控/UEFI/TPM/共享存储/时钟同步/调优）
EXT="libguestfs-tools \
virt-top \
swtpm \
swtpm-tools \
edk2-ovmf \
nfs-utils \
chrony \
tuned"

# EL8 提供 bridge-utils；EL9+ 已移除（用系统自带 iproute），故仅 EL8 下载
if [ "$EL" -le 8 ]; then
  EXT="$EXT bridge-utils"
fi

PKGS="$CORE $EXT"
echo "==> 计划下载（含全部依赖）："
echo "$PKGS" | tr ' ' '\n' | sed '/^$/d' | sed 's/^/    - /'

# ---- 3. 下载（连同全部依赖） ----
echo "==> 开始下载，请稍候（首次会拉取较多依赖）..."
# --resolve --alldeps：把依赖也一并下载；某些包名在特定版本不存在时不致命跳过
set +e
dnf download --resolve --alldeps $PKGS
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  echo "⚠️ 部分包下载有警告（可能个别扩展包在该版本不存在），逐个重试核心包以确保关键包齐全..."
  for p in $CORE; do
    dnf download --resolve --alldeps "$p" || echo "   跳过：$p（该版本可能无此包名）"
  done
fi

# ---- 4. 汇总 ----
COUNT=$(ls -1 *.rpm 2>/dev/null | wc -l)
SIZE=$(du -sh . 2>/dev/null | awk '{print $1}')
echo ""
echo "============================================================"
echo "✅ 完成！EL${EL} 共下载 ${COUNT} 个 RPM，总大小 ${SIZE}"
echo "   目录：$(pwd)"
echo ""
echo "下一步：把本目录所有 .rpm 放进平台离线仓库："
echo "   mkdir -p /var/lib/cnf/offline-packages/el${EL}"
echo "   cp $(pwd)/*.rpm  /var/lib/cnf/offline-packages/el${EL}/"
echo "============================================================"
