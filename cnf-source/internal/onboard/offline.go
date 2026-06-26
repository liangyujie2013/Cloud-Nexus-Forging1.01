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

	emit(fmt.Sprintf("[安装] 从平台离线包本地安装 %d 个 RPM（已禁用在线源，缺什么装什么）...", len(paths)))
	// --disablerepo='*' 彻底绕过在线源；dnf 会自动解析这批本地 RPM 的依赖关系，
	// 已安装的包会被自动跳过（幂等）。
	installCmd := fmt.Sprintf("dnf install -y --disablerepo='*' %s/*.rpm", remoteDir)
	out, ierr := c.RunStream(sudoWrap(c, installCmd), onLine)
	// 清理临时目录（失败不致命）
	_, _ = c.Run(sudoWrap(c, "rm -rf "+remoteDir))
	return out, ierr
}
