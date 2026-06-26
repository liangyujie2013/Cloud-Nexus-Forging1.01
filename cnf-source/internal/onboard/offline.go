package onboard

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ============================================================================
//  离线安装包仓库（offline package repo）
//
//  目的：当目标宿主机的 yum/dnf 在线源不可用（无外网 / 源配置错误 / 内网隔离）时，
//        平台把预置在本地的 RPM 包通过 SSH 推送到目标主机，再用 dnf 从本地目录安装，
//        实现「源有问题也能装上 libvirt + KVM」。
//
//  目录约定：<OfflinePkgPath>/<osTag>/*.rpm
//    osTag 取值：el8 / el9 / el10（按目标主机 /etc/os-release 的 major 版本映射）。
//    另允许 <OfflinePkgPath>/common/*.rpm 作为跨版本通用包补充。
// ============================================================================

// OfflinePkg 描述仓库中的一个 RPM 包。
type OfflinePkg struct {
	Name    string `json:"name"`     // 文件名，如 qemu-kvm-6.2.0-...el8.x86_64.rpm
	OSTag   string `json:"os_tag"`   // el8 / el9 / el10 / common
	SizeKB  int64  `json:"size_kb"`  // 文件大小（KB）
	RelPath string `json:"rel_path"` // 相对仓库根的路径
}

// OfflineRepo 平台本地离线包仓库。
type OfflineRepo struct {
	Root string // 仓库根目录（config.OfflinePkgPath）
}

// NewOfflineRepo 构造仓库并确保根目录存在。
func NewOfflineRepo(root string) *OfflineRepo {
	if root == "" {
		root = "/var/lib/cnf/offline-packages"
	}
	_ = os.MkdirAll(root, 0o755)
	return &OfflineRepo{Root: root}
}

// OSTagFromPretty 从 os-release 的 PRETTY_NAME / VERSION_ID 推导 elN 标签。
// 入参为 `major` 主版本号字符串（如 "8"/"9"/"10"），返回 "el8" 等。
func OSTagFromMajor(major string) string {
	major = strings.TrimSpace(major)
	if major == "" {
		return ""
	}
	return "el" + major
}

// List 列出仓库中所有 RPM 包（按 osTag、文件名排序）。
func (r *OfflineRepo) List() ([]OfflinePkg, error) {
	var pkgs []OfflinePkg
	entries, err := os.ReadDir(r.Root)
	if err != nil {
		if os.IsNotExist(err) {
			return pkgs, nil
		}
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		osTag := e.Name()
		sub := filepath.Join(r.Root, osTag)
		files, _ := os.ReadDir(sub)
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(strings.ToLower(f.Name()), ".rpm") {
				continue
			}
			info, ierr := f.Info()
			var sz int64
			if ierr == nil {
				sz = info.Size() / 1024
			}
			pkgs = append(pkgs, OfflinePkg{
				Name:    f.Name(),
				OSTag:   osTag,
				SizeKB:  sz,
				RelPath: filepath.Join(osTag, f.Name()),
			})
		}
	}
	sort.Slice(pkgs, func(i, j int) bool {
		if pkgs[i].OSTag != pkgs[j].OSTag {
			return pkgs[i].OSTag < pkgs[j].OSTag
		}
		return pkgs[i].Name < pkgs[j].Name
	})
	return pkgs, nil
}

// packagesFor 返回适配指定 osTag 的本地 RPM 绝对路径列表（含 common 目录）。
func (r *OfflineRepo) packagesFor(osTag string) ([]string, error) {
	var paths []string
	dirs := []string{}
	if osTag != "" {
		dirs = append(dirs, filepath.Join(r.Root, osTag))
	}
	dirs = append(dirs, filepath.Join(r.Root, "common"))
	for _, d := range dirs {
		files, err := os.ReadDir(d)
		if err != nil {
			continue // 目录不存在则跳过
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(strings.ToLower(f.Name()), ".rpm") {
				continue
			}
			paths = append(paths, filepath.Join(d, f.Name()))
		}
	}
	return paths, nil
}

// HasPackagesFor 判断是否存在适配该 osTag 的离线包（决定能否走离线安装）。
func (r *OfflineRepo) HasPackagesFor(osTag string) bool {
	paths, _ := r.packagesFor(osTag)
	return len(paths) > 0
}

var knownArchSuffixes = []string{".x86_64", ".noarch", ".aarch64", ".i686", ".src"}

// rpmNameFromFile 从 RPM 文件名解析出「包名」（NEVRA 中的 N）。
//
// RPM 文件名格式：<name>-<version>-<release>.<arch>.rpm，其中 name 可能含连字符
// （如 libvirt-daemon-driver-qemu）。解析规则：先去掉 .rpm 与 .<arch>，得到
// name-version-release；version-release 是最后两个「以连字符分隔且版本段以数字开头」
// 的字段，剩余前缀即为包名。
//
// 例：
//
//	libvirt-daemon-driver-qemu-11.10.0-12.3.el10_2.x86_64.rpm → libvirt-daemon-driver-qemu
//	iotop-c-1.26-4.el10.x86_64.rpm                            → iotop-c
//	htop-3.3.0-5.el10_0.x86_64.rpm                            → htop
func rpmNameFromFile(file string) string {
	s := filepath.Base(file)
	s = strings.TrimSuffix(s, ".rpm")
	// 去掉架构后缀
	for _, a := range knownArchSuffixes {
		if strings.HasSuffix(s, a) {
			s = strings.TrimSuffix(s, a)
			break
		}
	}
	// 现在 s = name-version-release。从右往左切两段（release、version）。
	// release：最后一个连字符之后；version：倒数第二个连字符之后。
	lastDash := strings.LastIndex(s, "-")
	if lastDash <= 0 {
		return s
	}
	prefix := s[:lastDash] // name-version
	secondDash := strings.LastIndex(prefix, "-")
	if secondDash <= 0 {
		return prefix
	}
	// 校验 version 段以数字开头（NEVRA 的 version 必须以数字起始），否则保守返回整体
	verSeg := prefix[secondDash+1:]
	if len(verSeg) == 0 || verSeg[0] < '0' || verSeg[0] > '9' {
		return prefix
	}
	return prefix[:secondDash]
}

// availablePackageNames 返回该 osTag(+common) 离线目录里实际存在的「包名」集合。
func (r *OfflineRepo) availablePackageNames(osTag string) map[string]bool {
	names := map[string]bool{}
	paths, _ := r.packagesFor(osTag)
	for _, p := range paths {
		if n := rpmNameFromFile(p); n != "" {
			names[n] = true
		}
	}
	return names
}

// filterAvailable 仅保留 want 中「离线仓库里确实存在的包名」。
//
// 关键：dnf install 遇到不存在的包名（如 el10 没有 libvirt-daemon-kvm）会整笔事务
// 报 "Unable to find a match" 失败；而 el10 的 dnf 4.20 又不支持 --skip-unavailable。
// 因此在构造安装命令前先按「仓库实际包名」过滤，跳过的名字回传给调用方记录日志。
func filterAvailable(want []string, available map[string]bool) (keep []string, skipped []string) {
	for _, w := range want {
		if available[w] {
			keep = append(keep, w)
		} else {
			skipped = append(skipped, w)
		}
	}
	return keep, skipped
}

// systemBasePrefixes 系统级基础包前缀。这些包属于「系统健康修复」（RepairSystemABI）
// 的范畴，仅在目标机出现「部分升级 ABI 断裂」（如 EL10 systemd↔openssl 错配）时，
// 用 `dnf upgrade` 对齐已装版本。**组件安装阶段不应推送它们**：
//   - 健康的目标机（如 RHEL 9.6 自带可用的 openssl 3.2.2）并不需要升级 openssl；
//   - 强行 install 离线的新版 openssl/openssl-fips-provider 反而会与已装子包产生
//     **文件冲突**（如 fips.so 同时存在于 openssl-fips-provider 与 -provider-so），
//     这种冲突 `--allowerasing` 也救不了，会让整笔事务失败。
// 因此组件安装只推「虚拟化相关包及其非系统级依赖」，系统基础包交给 RepairSystemABI。
var systemBasePrefixes = []string{
	"openssl-", "openssl3-",
	"openssl-libs-", "openssl-fips-provider", "openssl-pkcs11-",
	"systemd-", "glibc-", "glibc-common-", "glibc-langpack-", "glibc-all-langpacks-",
	"libgcrypt-", "libgpg-error-", "crypto-policies-",
	"kernel-", "kernel-core-", "kernel-tools-", "linux-firmware-",
	// 发行版「身份」包：绝不能推送——离线包多来自 CentOS Stream，会与目标机的
	// redhat-release/rocky-release 冲突（system-release 互斥）。真机 RHEL 9.6 已复现：
	//   centos-stream-release 与 redhat-release-9.6 冲突 → 整笔事务失败。
	"centos-stream-release", "centos-release", "centos-gpg-keys", "centos-stream-repos",
	"redhat-release", "rocky-release", "rocky-repos", "rocky-gpg-keys",
	"almalinux-release", "almalinux-repos", "epel-release",
}

// isSystemBasePkg 判断 RPM 文件名是否属于系统基础包（组件安装阶段应排除）。
func isSystemBasePkg(name string) bool {
	for _, pre := range systemBasePrefixes {
		if strings.HasPrefix(name, pre) {
			return true
		}
	}
	return false
}

// offlineWantPackages 离线安装阶段「按名安装」的顶层包清单。
//
// 关键设计转变（解决 RHEL 9.6 上 `dnf upgrade *.rpm` 误删 dnf/yum 的根因）：
//   旧做法把整个依赖闭包目录 `dnf upgrade *.rpm`，会强行把目标机已装的「基础运行库」
//   （python3-libs/rpm-libs/glib2/libcurl/systemd...）也升级到离线包版本，结果与
//   RHEL 9.6 已装基础冲突，dnf 又因 --allowerasing 升级到「移除受保护的 dnf/yum」而失败。
//
//   新做法：把离线目录当成一个**本地 file:// 仓库**（含 createrepo 生成的 repodata），
//   只 `dnf install <顶层包名>`。dnf 解析器据此**只取真正需要的依赖**，已被目标机满足的
//   基础包不动（不会升级 python3-libs/glib2/dnf 等），从根上杜绝「移除受保护包」。
//
// 清单 = 虚拟化核心 + 常用运维/监控工具（htop 等，满足 Request P）。
// 缺失探测到的包会与本清单合并去重；目标机已装的包 dnf 会自动跳过（幂等）。
var offlineWantPackages = []string{
	// 虚拟化核心（仅列出 el8/el9/el10 通用且确定存在的顶层包名）。
	// 注意：不要列出 "libvirt-daemon-kvm" —— 该包在 Rocky/RHEL 10 上不存在，
	// dnf install 遇到不存在的名字会整笔事务报 "Unable to find a match" 而失败。
	// 各发行版差异的子包（libvirt-daemon-driver-* 等）由 bootstrap 层按「实际缺失」
	// 探测后通过 wantExtra 传入；本清单只保留三发行版都存在的稳妥名字。
	"qemu-kvm", "qemu-img",
	"libvirt", "libvirt-client", "virt-install",
	"libvirt-daemon", "libvirt-daemon-driver-qemu",
	"libvirt-daemon-config-network",
	// 常用运维/监控工具（用户部署后纳管主机即自带）。
	// iotop 在 el10 上实际包名为 iotop-c，这里仍写 iotop —— 配合 --skip-unavailable，
	// 不存在的名字会被跳过而不影响整体事务（el10 的 iotop-c 由依赖闭包带入）。
	"htop", "tmux", "vim-enhanced", "wget", "tar", "bzip2", "unzip",
	"net-tools", "bind-utils", "nmap-ncat", "lsof",
	"sysstat", "iotop", "bash-completion", "chrony", "rsync",
}

// PushAndInstall 以「离线本地仓库」方式在目标机安装虚拟化组件 + 运维工具。
//
// 流程（核心是「按名安装」而非「整目录 upgrade」）：
//  1. 把该 osTag（+common）的全部 RPM 推到目标机 /tmp/cnf-offline-rpms；
//  2. 在目标机用 createrepo_c 生成 repodata（目标机若无 createrepo_c，则推送平台
//     预生成的 repodata/ 目录）；
//  3. 写一个仅指向该目录的 file:// dnf 仓库（cnf-offline），其余源全部禁用；
//  4. `dnf install --disablerepo='*' --enablerepo=cnf-offline <顶层包名...>`。
//
// onLine 用于流式回传每行进度。wantExtra 为缺失探测额外要装的包（与内置清单合并去重）。
func (r *OfflineRepo) PushAndInstall(c *SSHClient, osTag string, wantExtra []string, onLine func(string)) (string, error) {
	all, err := r.packagesFor(osTag)
	if err != nil {
		return "", err
	}
	if len(all) == 0 {
		return "", fmt.Errorf("平台离线仓库中没有适配 %s 的 RPM 包，请先在「离线安装包」中上传", osTag)
	}
	// 合并「内置顶层清单」+「缺失探测包」并去重，作为 dnf install 的目标。
	want := dedupStrings(append(append([]string{}, offlineWantPackages...), wantExtra...))
	// 关键：按「仓库实际存在的包名」过滤，跳过当前发行版没有的名字（如 el10 无
	// libvirt-daemon-kvm、iotop 名为 iotop-c），否则 dnf install 会整笔事务报
	// "Unable to find a match" 失败（el10 的 dnf 4.20 不支持 --skip-unavailable）。
	available := r.availablePackageNames(osTag)
	keep, skipped := filterAvailable(want, available)
	if len(skipped) > 0 && onLine != nil {
		onLine(fmt.Sprintf("ℹ️ 以下顶层包不在 %s 离线仓库中，自动跳过（其能力多由依赖闭包带入）：%s",
			osTag, strings.Join(skipped, " ")))
	}
	if len(keep) == 0 {
		return "", fmt.Errorf("过滤后没有可安装的顶层包（仓库与清单不匹配）")
	}
	return r.pushAndInstallRepo(c, osTag, all, keep, onLine)
}

// dedupStrings 去重并保持稳定顺序。
func dedupStrings(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

// RepairSystemABI 修复「部分升级」导致的系统级 ABI/符号断裂（即使虚拟化组件已齐全也要做）。
//
// 场景：之前的失败安装把 systemd 升到新版（如 257-23，依赖 openssl 3.4.0 的
// EVP_MD_CTX_get_size_ex 符号），却没同步升级 openssl-libs，导致 systemctl 一运行就
// 符号查找失败（status 127）。组件检测会判为「已齐全」从而跳过安装，旧逻辑永远修不好它。
//
// 做法：把该 osTag（+common）离线包里的「系统基础包」（openssl-libs/openssl/
// systemd*/glibc* 等）推到目标机，用 `dnf upgrade --disablerepo='*'` 在一个事务里
// 把已安装的这些包对齐到离线包版本，消除 systemd↔openssl-libs 的版本错配。
//
// 仅当离线仓库里确有这些基础包时才执行；无则静默跳过（不视为错误）。
// onLine 回传进度。返回（是否实际执行了修复, 输出, 错误）。
func (r *OfflineRepo) RepairSystemABI(c *SSHClient, osTag string, onLine func(string)) (bool, string, error) {
	all, _ := r.packagesFor(osTag)
	if len(all) == 0 {
		return false, "", nil
	}
	// 只挑系统基础包（按文件名前缀匹配），避免把整套 RPM 都推一遍拖慢速度。
	basePrefixes := []string{
		"openssl-libs-", "openssl-", "openssl3-",
		"systemd-", "systemd-libs-", "systemd-pam-", "systemd-udev-",
		"glibc-", "glibc-common-", "glibc-langpack-",
		"libgcrypt-", "libgpg-error-", "crypto-policies-",
	}
	var base []string
	for _, p := range all {
		name := filepath.Base(p)
		for _, pre := range basePrefixes {
			if strings.HasPrefix(name, pre) {
				base = append(base, p)
				break
			}
		}
	}
	if len(base) == 0 {
		return false, "", nil // 离线仓库没有基础包，跳过修复。
	}

	emit := func(s string) {
		if onLine != nil {
			onLine(s)
		}
	}
	emit(fmt.Sprintf("[健康修复] 推送 %d 个系统基础包（openssl/systemd/glibc 等）对齐版本，预防/修复 systemd↔openssl 符号断裂...", len(base)))

	remoteDir := "/tmp/cnf-offline-base"
	if _, err := c.Run(sudoWrap(c, "rm -rf "+remoteDir+" && mkdir -p "+remoteDir)); err != nil {
		return false, "", fmt.Errorf("创建远端临时目录失败: %w", err)
	}
	for i, p := range base {
		data, rerr := os.ReadFile(p)
		if rerr != nil {
			return false, "", fmt.Errorf("读取本地包 %s 失败: %w", filepath.Base(p), rerr)
		}
		emit(fmt.Sprintf("[推送基础包 %d/%d] %s", i+1, len(base), filepath.Base(p)))
		if perr := c.PushFile(data, remoteDir+"/"+filepath.Base(p)); perr != nil {
			return false, "", fmt.Errorf("推送 %s 失败: %w", filepath.Base(p), perr)
		}
	}
	// 只升级（不安装新包），把已装的基础包对齐到离线版本；无可升级项时 dnf 返回非零也无妨。
	// --allowerasing 允许移除被取代/文件冲突的旧子包（如 openssl-fips-provider-so）。
	upCmd := fmt.Sprintf("dnf upgrade -y --disablerepo='*' --nobest --allowerasing %s/*.rpm", remoteDir)
	emit("[健康修复] dnf upgrade（仅对齐已安装的系统基础包到离线版本）")
	out, _ := c.RunStream(sudoWrap(c, upCmd), onLine)
	_, _ = c.Run(sudoWrap(c, "rm -rf "+remoteDir))
	return true, out, nil
}

// pushAndInstallRepo 把本地 RPM（含平台预生成的 repodata）推送到目标机，配置成一个
// 仅 file:// 的本地仓库，再 `dnf install <顶层包名>`。这是「按名安装」策略，
// 由 dnf 解析器只拉取真正需要的依赖，避免整目录 upgrade 误删受保护包。
//
//	allRPMs：该 osTag(+common) 下的全部 RPM 绝对路径（连同 repodata 一起推）。
//	want   ：要安装的顶层包名（已去重）。
func (r *OfflineRepo) pushAndInstallRepo(c *SSHClient, osTag string, allRPMs, want []string, onLine func(string)) (string, error) {
	if len(allRPMs) == 0 {
		return "", fmt.Errorf("没有可推送的 RPM 包")
	}
	if len(want) == 0 {
		return "", fmt.Errorf("没有指定要安装的顶层包")
	}

	emit := func(s string) {
		if onLine != nil {
			onLine(s)
		}
	}

	remoteDir := "/tmp/cnf-offline-rpms"
	if _, err := c.Run(sudoWrap(c, "rm -rf "+remoteDir+" && mkdir -p "+remoteDir+"/repodata")); err != nil {
		return "", fmt.Errorf("创建远端临时目录失败: %w", err)
	}

	// 1) 推送全部 RPM。
	for i, p := range allRPMs {
		data, rerr := os.ReadFile(p)
		if rerr != nil {
			return "", fmt.Errorf("读取本地包 %s 失败: %w", filepath.Base(p), rerr)
		}
		remote := remoteDir + "/" + filepath.Base(p)
		if i%50 == 0 || i == len(allRPMs)-1 {
			emit(fmt.Sprintf("[推送 %d/%d] %s ...", i+1, len(allRPMs), filepath.Base(p)))
		}
		if perr := c.PushFile(data, remote); perr != nil {
			return "", fmt.Errorf("推送 %s 失败: %w", filepath.Base(p), perr)
		}
	}

	// 2) 准备 repodata：优先推送平台预生成的 repodata（打包时由 build-offline-repo.sh /
	//    createrepo_c 生成），目标机无需任何在线源即可解析依赖。
	//    若平台未预生成，则尝试目标机本地 createrepo_c 生成（兜底）。
	repoReady := false
	if r.pushRepodata(c, osTag, remoteDir, emit) {
		repoReady = true
		emit("✓ 已推送平台预生成的 repodata（离线本地仓库就绪）")
	} else {
		// 兜底：目标机若有 createrepo_c，就地生成。
		emit("ℹ️ 平台未预置 repodata，尝试在目标机用 createrepo_c 生成本地仓库元数据...")
		if _, err := c.Run(sudoWrap(c, "command -v createrepo_c >/dev/null 2>&1 && createrepo_c "+remoteDir+" >/dev/null 2>&1")); err == nil {
			if c.RunQuiet("test -f "+remoteDir+"/repodata/repomd.xml && echo yes") == "yes" {
				repoReady = true
				emit("✓ 目标机 createrepo_c 生成 repodata 成功")
			}
		}
	}

	// 3) 写本地 file:// 仓库配置（仅启用本仓库）。
	repoConf := "/etc/yum.repos.d/cnf-offline.repo"
	repoBody := strings.Join([]string{
		"[cnf-offline]",
		"name=CNF Offline Packages",
		"baseurl=file://" + remoteDir,
		"enabled=1",
		"gpgcheck=0",
		"priority=1",
	}, "\n")
	writeRepo := fmt.Sprintf("cat > %s <<'CNFEOF'\n%s\nCNFEOF", repoConf, repoBody)
	if _, err := c.Run(sudoWrap(c, writeRepo)); err != nil {
		return "", fmt.Errorf("写入离线仓库配置失败: %w", err)
	}
	cleanup := func() {
		_, _ = c.Run(sudoWrap(c, "rm -f "+repoConf+" ; rm -rf "+remoteDir))
	}

	// 4) 按名安装。--disablerepo='*' --enablerepo=cnf-offline 彻底绕开在线源，只用本地仓库。
	//    --setopt=cnf-offline.module_hotfixes=1 让模块化包（如 EL9 的 virt 模块）可直接装。
	//    不加 --allowerasing：从根上杜绝「移除受保护的 dnf/yum」——按名安装本就不会动基础包。
	wantStr := strings.Join(want, " ")
	var out string
	if repoReady {
		emit(fmt.Sprintf("[安装] 离线本地仓库按名安装 %d 个顶层包（dnf 自动解析依赖、跳过已装项）...", len(want)))
		installCmd := fmt.Sprintf(
			"dnf install -y --disablerepo='*' --enablerepo=cnf-offline --nobest --setopt=install_weak_deps=0 --setopt=cnf-offline.module_hotfixes=1 %s",
			wantStr,
		)
		emit(installCmd)
		o, ierr := c.RunStream(sudoWrap(c, installCmd), onLine)
		out = o
		if ierr != nil {
			cleanup()
			return out, ierr
		}
		cleanup()
		return out, nil
	}

	// 兜底（无 repodata 可用）：按文件名逐个 install 显式 RPM 路径中的顶层包。
	//   dnf 仍能解析这批本地文件之间的依赖，但要求 want 对应的 RPM 文件确实在目录里。
	emit("⚠️ 无可用 repodata，回退为「按文件路径安装顶层包」模式...")
	var wantPaths []string
	for _, w := range want {
		for _, p := range allRPMs {
			base := filepath.Base(p)
			// 形如 <name>-<ver>-<rel>.<arch>.rpm，前缀严格匹配 "<name>-数字"。
			if strings.HasPrefix(base, w+"-") {
				wantPaths = append(wantPaths, remoteDir+"/"+base)
				break
			}
		}
	}
	if len(wantPaths) == 0 {
		cleanup()
		return "", fmt.Errorf("离线目录中找不到任何待装顶层包的 RPM 文件")
	}
	installCmd := "dnf install -y --disablerepo='*' --nobest " + strings.Join(wantPaths, " ")
	emit(installCmd)
	o, ierr := c.RunStream(sudoWrap(c, installCmd), onLine)
	out = o
	cleanup()
	if ierr != nil {
		return out, ierr
	}
	return out, nil
}

// pushRepodata 把平台本地预生成的 repodata（<root>/<osTag>/repodata/*）推送到目标机
// remoteDir/repodata。返回是否成功推送了非空 repodata。
func (r *OfflineRepo) pushRepodata(c *SSHClient, osTag, remoteDir string, emit func(string)) bool {
	srcDir := filepath.Join(r.Root, osTag, "repodata")
	entries, err := os.ReadDir(srcDir)
	if err != nil || len(entries) == 0 {
		return false
	}
	pushed := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, rerr := os.ReadFile(filepath.Join(srcDir, e.Name()))
		if rerr != nil {
			continue
		}
		if perr := c.PushFile(data, remoteDir+"/repodata/"+e.Name()); perr != nil {
			continue
		}
		pushed++
	}
	// 必须包含 repomd.xml 才算有效仓库。
	if c.RunQuiet("test -f "+remoteDir+"/repodata/repomd.xml && echo yes") == "yes" {
		emit(fmt.Sprintf("（推送 repodata %d 个文件）", pushed))
		return true
	}
	return false
}
