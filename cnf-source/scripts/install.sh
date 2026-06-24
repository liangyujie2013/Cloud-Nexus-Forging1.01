#!/usr/bin/env bash
# ============================================================================
# CNFv1.0 企业级安装脚本
# 目标 OS：Rocky Linux 9.x / RHEL 9.x
#
# 用法：
#   ./install.sh --single                    单节点模式（控制面+计算）
#   ./install.sh --init-cluster              初始化集群（首个控制节点）
#   ./install.sh --join-cluster <master-ip>  作为计算/控制节点加入集群
# ============================================================================
set -euo pipefail

readonly CNF_VERSION="1.0.0"
readonly CNF_HOME="/opt/cnf"
readonly CNF_USER="cnf"
readonly LOG="/var/log/cnf-install.log"
readonly REQUIRED_PKGS=(
  qemu-kvm libvirt libvirt-daemon-kvm virt-install
  openvswitch postgresql16-server redis
  edk2-ovmf swtpm dnsmasq keepalive iptables-services
)

MODE=""
MASTER_IP=""

log()  { echo -e "\033[0;32m[CNF]\033[0m $*" | tee -a "$LOG"; }
warn() { echo -e "\033[0;33m[WARN]\033[0m $*" | tee -a "$LOG"; }
err()  { echo -e "\033[0;31m[ERR]\033[0m $*"  | tee -a "$LOG" >&2; exit 1; }

# ----------------------------------------------------------------------------
# 1. 参数解析
# ----------------------------------------------------------------------------
parse_args() {
  case "${1:-}" in
    --single)       MODE="single" ;;
    --init-cluster) MODE="init-cluster" ;;
    --join-cluster) MODE="join-cluster"; MASTER_IP="${2:-}";
                    [[ -z "$MASTER_IP" ]] && err "--join-cluster 需要指定 <master-ip>" ;;
    *) err "用法: $0 --single | --init-cluster | --join-cluster <master-ip>" ;;
  esac
  log "安装模式: $MODE"
}

# ----------------------------------------------------------------------------
# 2. 操作系统检测（仅支持 Rocky/RHEL 9）
# ----------------------------------------------------------------------------
check_os() {
  [[ $EUID -eq 0 ]] || err "必须以 root 运行"
  [[ -f /etc/os-release ]] || err "无法识别操作系统"
  source /etc/os-release
  case "$ID" in
    rocky|rhel|almalinux) ;;
    *) err "仅支持 Rocky Linux 9 / RHEL 9，当前: $ID" ;;
  esac
  [[ "${VERSION_ID%%.*}" == "9" ]] || err "需要主版本 9.x，当前: $VERSION_ID"
  log "操作系统检查通过: $PRETTY_NAME"
}

# ----------------------------------------------------------------------------
# 3. 硬件要求检查（虚拟化、内存、磁盘）
# ----------------------------------------------------------------------------
check_hardware() {
  grep -qE 'vmx|svm' /proc/cpuinfo || err "CPU 不支持硬件虚拟化（VT-x/AMD-V），请检查 BIOS"
  local mem_gb; mem_gb=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024 ))
  (( mem_gb >= 8 )) || warn "内存 ${mem_gb}GB 偏低，建议 ≥16GB"
  local disk_gb; disk_gb=$(df -BG /opt 2>/dev/null | awk 'NR==2{gsub("G","",$4); print $4}' || echo 0)
  (( disk_gb >= 50 )) || warn "/opt 可用空间 ${disk_gb}GB 偏低，建议 ≥100GB"
  # IOMMU 检测（GPU 直通必需）
  if ! dmesg 2>/dev/null | grep -qiE 'DMAR|IOMMU'; then
    warn "未检测到 IOMMU，GPU 直通将不可用。可在内核参数添加 intel_iommu=on / amd_iommu=on"
  fi
  log "硬件检查完成（虚拟化✓ 内存${mem_gb}GB 磁盘${disk_gb}GB）"
}

# ----------------------------------------------------------------------------
# 4. 依赖安装
# ----------------------------------------------------------------------------
install_deps() {
  log "安装依赖包..."
  dnf install -y epel-release || true
  dnf module enable -y postgresql:16 || true
  dnf install -y "${REQUIRED_PKGS[@]}" 2>>"$LOG" || \
    warn "部分包安装失败，请检查 $LOG"
  systemctl enable --now libvirtd openvswitch redis 2>>"$LOG" || true
  log "依赖安装完成"
}

# ----------------------------------------------------------------------------
# 5. KVM 环境配置（IOMMU / VFIO / 内核模块）
# ----------------------------------------------------------------------------
configure_kvm() {
  log "配置 KVM / VFIO 环境..."
  # 加载内核模块
  cat > /etc/modules-load.d/cnf-vfio.conf <<'EOF'
vfio
vfio_iommu_type1
vfio_pci
kvm
EOF
  modprobe vfio vfio_pci 2>/dev/null || true
  # 启用 IOMMU（需重启生效）
  if command -v grubby &>/dev/null; then
    if grep -q Intel /proc/cpuinfo; then
      grubby --update-kernel=ALL --args="intel_iommu=on iommu=pt" || true
    else
      grubby --update-kernel=ALL --args="amd_iommu=on iommu=pt" || true
    fi
  fi
  # 大页内存预留（示例 2GB）
  echo "vm.nr_hugepages = 1024" > /etc/sysctl.d/cnf-hugepages.conf
  sysctl -p /etc/sysctl.d/cnf-hugepages.conf 2>/dev/null || true
  log "KVM 环境配置完成（IOMMU 需重启生效）"
}

# ----------------------------------------------------------------------------
# 6. 数据库初始化
# ----------------------------------------------------------------------------
init_database() {
  [[ "$MODE" == "join-cluster" ]] && { log "join 模式跳过数据库初始化"; return; }
  log "初始化 PostgreSQL 16..."
  local PGSETUP=/usr/pgsql-16/bin/postgresql-16-setup
  [[ -x "$PGSETUP" ]] && "$PGSETUP" initdb 2>>"$LOG" || true
  systemctl enable --now postgresql-16 2>>"$LOG" || true
  sudo -u postgres psql <<'SQL' 2>>"$LOG" || true
CREATE USER cnf WITH PASSWORD 'cnf';
CREATE DATABASE cnfv1 OWNER cnf;
SQL
  # 应用迁移
  for f in "$CNF_HOME"/migrations/*.up.sql; do
    [[ -f "$f" ]] || continue
    log "应用迁移: $(basename "$f")"
    sudo -u postgres psql -d cnfv1 -f "$f" 2>>"$LOG" || warn "迁移 $f 出错"
  done
  log "数据库初始化完成"
}

# ----------------------------------------------------------------------------
# 7. 系统用户与目录
# ----------------------------------------------------------------------------
setup_user_dirs() {
  id "$CNF_USER" &>/dev/null || useradd -r -s /sbin/nologin -d "$CNF_HOME" "$CNF_USER"
  usermod -aG libvirt,kvm "$CNF_USER" 2>/dev/null || true
  mkdir -p "$CNF_HOME"/{bin,migrations,web,nvram} /var/lib/cnf /var/log/cnf
  # 复制二进制与资源（假定与脚本同目录）
  local SRC; SRC="$(cd "$(dirname "$0")" && pwd)"
  [[ -f "$SRC/cnf-server" ]] && install -m 0755 "$SRC/cnf-server" "$CNF_HOME/bin/"
  [[ -f "$SRC/cnf-agent"  ]] && install -m 0755 "$SRC/cnf-agent"  "$CNF_HOME/bin/"
  [[ -d "$SRC/migrations" ]] && cp -r "$SRC/migrations/." "$CNF_HOME/migrations/"
  chown -R "$CNF_USER:$CNF_USER" "$CNF_HOME" /var/lib/cnf /var/log/cnf
  log "用户与目录就绪"
}

# ----------------------------------------------------------------------------
# 8. systemd 服务注册
# ----------------------------------------------------------------------------
register_services() {
  log "注册 systemd 服务..."
  local SRC; SRC="$(cd "$(dirname "$0")" && pwd)"
  [[ -d "$SRC/systemd" ]] && cp "$SRC"/systemd/*.service /etc/systemd/system/ 2>/dev/null || true
  systemctl daemon-reload
  case "$MODE" in
    single|init-cluster)
      systemctl enable --now cnf-server cnf-agent 2>>"$LOG" || warn "服务启动失败，查看 journalctl -u cnf-server" ;;
    join-cluster)
      systemctl enable --now cnf-agent 2>>"$LOG" || true ;;
  esac
}

# ----------------------------------------------------------------------------
# 9. 防火墙与 SELinux
# ----------------------------------------------------------------------------
configure_security() {
  log "配置防火墙与 SELinux..."
  if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port=8080/tcp   # API
    firewall-cmd --permanent --add-port=5900-6000/tcp # VNC
    [[ "$MODE" != "join-cluster" ]] && firewall-cmd --permanent --add-port=5432/tcp
    firewall-cmd --reload
  fi
  # SELinux：设置 libvirt/虚拟化布尔值，保持 enforcing
  setsebool -P virt_use_nfs 1 2>/dev/null || true
  setsebool -P virt_use_execmem 1 2>/dev/null || true
  log "安全配置完成（SELinux 保持 enforcing）"
}

# ----------------------------------------------------------------------------
# 10. 集群初始化 / 加入
# ----------------------------------------------------------------------------
setup_cluster() {
  case "$MODE" in
    init-cluster)
      log "初始化 etcd 分布式锁与 keepalived VIP..."
      dnf install -y etcd keepalived 2>>"$LOG" || true
      systemctl enable --now etcd 2>>"$LOG" || true
      log "集群已初始化，其他节点可使用: ./install.sh --join-cluster $(hostname -I | awk '{print $1}')" ;;
    join-cluster)
      log "加入集群 master=$MASTER_IP ..."
      # 向控制面注册（cnf-agent 启动后自动上报）
      echo "CNF_MASTER_IP=$MASTER_IP" > /etc/cnf/agent.env
      mkdir -p /etc/cnf ;;
  esac
}

# ----------------------------------------------------------------------------
# 11. 健康检查与信息输出
# ----------------------------------------------------------------------------
health_check() {
  log "执行健康检查..."
  sleep 3
  if curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
    log "✓ 控制面 API 健康"
  else
    [[ "$MODE" != "join-cluster" ]] && warn "控制面 API 未响应，请查看: journalctl -u cnf-server -n 50"
  fi
  cat <<EOF

============================================================
  CNFv1.0 安装完成 (v${CNF_VERSION})  模式: ${MODE}
------------------------------------------------------------
  管理界面:  http://$(hostname -I | awk '{print $1}'):8080
  默认账号:  admin / admin123  (请立即修改)
  服务管理:  systemctl status cnf-server cnf-agent
  日志查看:  journalctl -u cnf-server -f
  安装日志:  ${LOG}
------------------------------------------------------------
  ⚠ 若启用了 IOMMU，请重启使 GPU 直通生效: reboot
============================================================
EOF
}

main() {
  : > "$LOG"
  parse_args "$@"
  check_os
  check_hardware
  install_deps
  configure_kvm
  setup_user_dirs
  init_database
  setup_cluster
  register_services
  configure_security
  health_check
}

main "$@"
