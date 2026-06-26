#!/bin/bash
# =============================================================================
#  CNF 离线安装包仓库构建器（build-offline-repo.sh）
#
#  目的：在【开发/打包阶段】用国内快速镜像源（aliyun，可换 tuna/ustc 等）按发行版
#        下载「版本匹配、依赖闭包完整」的 RPM，落到 <REPO_ROOT>/elN/ 目录，
#        随管理平台一起打包。最终用户离线部署后，纳管主机时由平台推送这些 RPM
#        本地安装（dnf --disablerepo='*'），完全不依赖目标主机在线源。
#
#  关键设计（解决之前 EL9 用 CentOS Stream 包导致与 RHEL 9.6 冲突的根因）：
#    - 每个 elN 都用【对应版本的 Rocky Linux 源】下载。
#      Rocky 8/9/10 与 RHEL 8/9/10 ABI 兼容、版本对齐，装在 Rocky 和 RHEL 上都不冲突；
#      且不会像 CentOS Stream 那样「跑在 RHEL 前面」引入 openssl/glibc 高版本冲突。
#    - 用 `dnf download --resolve --alldeps` 解析完整依赖闭包（含 BaseOS/AppStream/CRB/EPEL）。
#    - 系统基础包（openssl/systemd/glibc/kernel/*-release）也会被闭包带入，
#      但平台侧「组件安装」会自动跳过它们（见 offline.go systemBasePrefixes），
#      仅「健康修复」阶段按需 upgrade 对齐——因此这里下载它们无害，且利于 EL10 修复场景。
#
#  用法：
#    ./build-offline-repo.sh <8|9|10|all> [REPO_ROOT]
#    REPO_ROOT 默认 /var/lib/cnf/offline-packages
#
#  依赖：宿主机需有 dnf（RHEL/Rocky/Fedora 系）。建议在干净环境运行。
# =============================================================================
set -uo pipefail

REPO_ROOT="${2:-/var/lib/cnf/offline-packages}"
MIRROR="${CNF_MIRROR:-mirrors.aliyun.com}"   # 可用环境变量切换镜像
WORK="/tmp/cnf-offline-build"
ARCH="x86_64"

# ---- 需要纳入离线仓库的包集合 -------------------------------------------------
# 1) 虚拟化核心（KVM/libvirt 全家桶 + 模块化 daemon + 远程 proxy）
VIRT_PKGS=(
    qemu-kvm qemu-img
    libvirt libvirt-client virt-install
    libvirt-daemon
    libvirt-daemon-common
    libvirt-daemon-driver-qemu
    libvirt-daemon-driver-network
    libvirt-daemon-driver-storage
    libvirt-daemon-driver-nodedev
    libvirt-daemon-driver-nwfilter
    libvirt-daemon-driver-secret
    libvirt-daemon-driver-interface
    libvirt-daemon-config-network
    libvirt-daemon-config-nwfilter
    libvirt-daemon-kvm
    # 远程 TCP（EL9/EL10 模块化用 virtproxyd；EL8 单体用 libvirtd-tcp.socket，已含在 libvirt-daemon）
    libvirt-daemon-proxy
)
# 2) 常用运维/监控工具（用户部署后纳管主机即自带，提升可用性）
TOOL_PKGS=(
    htop tmux vim-enhanced wget curl tar bzip2 unzip
    net-tools bind-utils nmap-ncat lsof
    sysstat iotop bash-completion
    chrony rsync
)

# EL8 的 libvirt-daemon-proxy 不存在（单体），构建时按版本剔除（见下）。

log() { echo -e "\033[36m[builder]\033[0m $*"; }
err() { echo -e "\033[31m[builder][ERR]\033[0m $*" >&2; }

# 生成某个 Rocky 版本的临时 dnf repo 配置，返回 repo 文件路径。
make_repo_conf() {
    local ver="$1" conf="$2"
    local crb="CRB"
    [ "$ver" = "8" ] && crb="PowerTools"   # EL8 叫 PowerTools，EL9/10 叫 CRB
    cat > "$conf" <<EOF
[cnf-baseos]
name=Rocky $ver - BaseOS
baseurl=https://$MIRROR/rockylinux/$ver/BaseOS/$ARCH/os/
gpgcheck=0
enabled=1

[cnf-appstream]
name=Rocky $ver - AppStream
baseurl=https://$MIRROR/rockylinux/$ver/AppStream/$ARCH/os/
gpgcheck=0
enabled=1

[cnf-crb]
name=Rocky $ver - CRB/PowerTools
baseurl=https://$MIRROR/rockylinux/$ver/$crb/$ARCH/os/
gpgcheck=0
enabled=1

[cnf-epel]
name=EPEL $ver
baseurl=https://$MIRROR/epel/$ver/Everything/$ARCH/
gpgcheck=0
enabled=1
EOF
}

build_one() {
    local ver="$1"
    local tag="el$ver"
    local dest="$REPO_ROOT/$tag"
    local conf="$WORK/$tag.repo"
    local cache="$WORK/cache-$tag"
    local dl="$WORK/dl-$tag"

    log "===== 构建 $tag（Rocky $ver @ $MIRROR）====="
    rm -rf "$cache" "$dl"; mkdir -p "$cache" "$dl" "$dest"
    make_repo_conf "$ver" "$conf"

    # 按版本组装包列表（EL8 无 libvirt-daemon-proxy）。
    local pkgs=("${VIRT_PKGS[@]}" "${TOOL_PKGS[@]}")
    if [ "$ver" = "8" ]; then
        pkgs=()
        for p in "${VIRT_PKGS[@]}" "${TOOL_PKGS[@]}"; do
            [ "$p" = "libvirt-daemon-proxy" ] && continue
            pkgs+=("$p")
        done
    fi

    log "解析依赖闭包并下载（--resolve --alldeps）共 ${#pkgs[@]} 个顶层包..."
    # 关键隔离参数（在 RHEL8 宿主上为 el9/el10 解析时必须）：
    #   --installroot   ：用空的 rpmdb，避免把宿主机已装包当成「已满足」而漏下载依赖；
    #   module_platform_id：对齐目标版本的模块平台，避免 @modulefailsafe 的 platform:el8 冲突；
    #   --setopt=install_weak_deps=1：连同弱依赖一并下载，保证目标机离线装时不缺件。
    dnf \
        --setopt=reposdir=/dev/null \
        -c "$conf" \
        --releasever="$ver" \
        --setopt=module_platform_id="platform:el$ver" \
        --setopt=install_weak_deps=1 \
        --setopt=cachedir="$cache" \
        --installroot="$WORK/root-$tag" \
        --forcearch="$ARCH" \
        download --resolve --alldeps --arch="$ARCH,noarch" \
        --destdir="$dl" \
        "${pkgs[@]}" 2>&1 | tail -40

    local n
    n=$(ls "$dl"/*.rpm 2>/dev/null | wc -l)
    if [ "$n" -eq 0 ]; then
        err "$tag 下载 0 个 RPM，构建失败（检查镜像/网络）"
        return 1
    fi
    log "$tag 解析得到 $n 个 RPM，写入 $dest"
    # 用新内容替换旧目录（先清空避免残留旧发行版包）。
    rm -f "$dest"/*.rpm
    mv "$dl"/*.rpm "$dest"/
    # 生成 repodata，供目标机以 file:// 本地仓库「按名安装」
    # （核心：避免整目录 dnf upgrade *.rpm 误删受保护的 dnf/yum 等基础包）。
    if command -v createrepo_c >/dev/null 2>&1; then
        log "$tag 生成 repodata（createrepo_c）..."
        rm -rf "$dest/repodata"
        createrepo_c --quiet "$dest" || err "$tag createrepo_c 失败"
    else
        err "未找到 createrepo_c，请先安装：dnf install -y createrepo_c（离线按名安装依赖 repodata）"
    fi
    du -sh "$dest"
    log "$tag 完成。"
}

mkdir -p "$WORK"
case "${1:-}" in
    8|9|10) build_one "$1" ;;
    all)    for v in 8 9 10; do build_one "$v" || err "el$v 构建失败，继续下一个"; done ;;
    *) echo "用法: $0 <8|9|10|all> [REPO_ROOT]"; exit 2 ;;
esac

log "全部完成。仓库根：$REPO_ROOT"
for t in el8 el9 el10; do
    [ -d "$REPO_ROOT/$t" ] && printf "  %-5s %4s 个RPM  %s\n" "$t" "$(ls "$REPO_ROOT/$t"/*.rpm 2>/dev/null|wc -l)" "$(du -sh "$REPO_ROOT/$t" 2>/dev/null|cut -f1)"
done
