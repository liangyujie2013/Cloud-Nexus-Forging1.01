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

// PushAndInstall 把适配 osTag 的所有本地 RPM 推送到目标主机临时目录，
// 然后用 dnf 从本地文件安装（--disablerepo='*' 完全绕开在线源）。
//
// 这是「全量」推送：把仓库里该 osTag（含 common）的所有 RPM 都推过去，
// dnf 自动解析依赖、跳过已安装项。适合平台离线包就是「一整套依赖闭包」的场景。
//
// onLine 用于流式回传每行进度（推送进度 + dnf 输出）。
// 返回安装命令的完整输出与错误。
func (r *OfflineRepo) PushAndInstall(c *SSHClient, osTag string, onLine func(string)) (string, error) {
	paths, err := r.packagesFor(osTag)
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", fmt.Errorf("平台离线仓库中没有适配 %s 的 RPM 包，请先在「离线安装包」中上传", osTag)
	}
	return r.pushAndInstallPaths(c, paths, onLine)
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
	upCmd := fmt.Sprintf("dnf upgrade -y --disablerepo='*' --nobest %s/*.rpm", remoteDir)
	emit("[健康修复] dnf upgrade（仅对齐已安装的系统基础包到离线版本）")
	out, _ := c.RunStream(sudoWrap(c, upCmd), onLine)
	_, _ = c.Run(sudoWrap(c, "rm -rf "+remoteDir))
	return true, out, nil
}

// pushAndInstallPaths 把给定的本地 RPM 路径列表推送到目标主机并本地安装。
// dnf 以「整个本地目录」为输入，自动解析这批 RPM 之间的依赖闭包，并跳过
// 目标主机上已安装的包（缺什么装什么，不会重复安装）。
func (r *OfflineRepo) pushAndInstallPaths(c *SSHClient, paths []string, onLine func(string)) (string, error) {
	if len(paths) == 0 {
		return "", fmt.Errorf("没有可推送的 RPM 包")
	}

	remoteDir := "/tmp/cnf-offline-rpms"
	if _, err := c.Run(sudoWrap(c, "rm -rf "+remoteDir+" && mkdir -p "+remoteDir)); err != nil {
		return "", fmt.Errorf("创建远端临时目录失败: %w", err)
	}

	emit := func(s string) {
		if onLine != nil {
			onLine(s)
		}
	}

	for i, p := range paths {
		data, rerr := os.ReadFile(p)
		if rerr != nil {
			return "", fmt.Errorf("读取本地包 %s 失败: %w", filepath.Base(p), rerr)
		}
		remote := remoteDir + "/" + filepath.Base(p)
		emit(fmt.Sprintf("[推送 %d/%d] %s (%d KB)", i+1, len(paths), filepath.Base(p), len(data)/1024))
		if perr := c.PushFile(data, remote); perr != nil {
			return "", fmt.Errorf("推送 %s 失败: %w", filepath.Base(p), perr)
		}
	}

	// 安装策略（关键）：必须避免「部分升级」导致的 ABI/符号断裂。
	//
	// 典型坑：libvirt 会拉新版 systemd，systemd 又依赖新版 openssl-libs 的符号
	// （如 EVP_MD_CTX_get_size_ex / OPENSSL_3_4_0）。若只用 `dnf install`，dnf 对
	// **已安装**的 openssl-libs 默认不主动升级（即使目录里有新版），结果变成
	// 「新 systemd + 旧 openssl-libs」→ systemctl 符号查找失败（status 127）。
	//
	// 解决：用 `dnf upgrade --best` 把目录里所有 RPM（含已装包的更新版）作为一个
	// 整体事务处理——已装的升级到目录版本、未装的作为依赖一并装入，保证整批包的
	// 依赖闭包在一个事务里版本一致。`upgrade *.rpm` 在 dnf4/dnf5 上都会把「目录里
	// 比已装版本新的包」升级，并自动安装其依赖（含目录中的新包）。
	emit(fmt.Sprintf("[安装] 从平台离线包整体安装/升级 %d 个 RPM（单事务，避免部分升级断裂）...", len(paths)))
	// --disablerepo='*' 彻底绕过在线源；--nobest 容忍个别包无法取最优版本时继续；
	// 用 upgrade 让已装包（如 openssl-libs/systemd-libs）与新装包在同一事务里对齐版本。
	upgradeCmd := fmt.Sprintf("dnf upgrade -y --disablerepo='*' --nobest %s/*.rpm", remoteDir)
	emit("[1/2] dnf upgrade（对齐已安装包到离线包版本，防止符号/ABI 断裂）")
	out1, uerr := c.RunStream(sudoWrap(c, upgradeCmd), onLine)
	if uerr != nil {
		// upgrade 失败不立即返回：可能因为「没有可升级项」而非真错误，继续 install。
		emit("⚠️ dnf upgrade 阶段返回非零（可能无可升级项），继续执行 install 安装新包...")
	}
	// 再 install 安装剩余新包（已升级/已安装的会被跳过，幂等）。
	emit("[2/2] dnf install（安装尚缺的新包，已装项自动跳过）")
	installCmd := fmt.Sprintf("dnf install -y --disablerepo='*' --nobest %s/*.rpm", remoteDir)
	out2, ierr := c.RunStream(sudoWrap(c, installCmd), onLine)
	// 清理临时目录（失败不致命）
	_, _ = c.Run(sudoWrap(c, "rm -rf "+remoteDir))

	out := out1 + "\n" + out2
	// 只要 install 阶段成功即视为成功（upgrade 的非零多为「无升级项」）。
	if ierr != nil {
		return out, ierr
	}
	return out, nil
}
