package storage

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// ============================================================================
// LocalDriver：本地目录 + qcow2，使用 qemu-img 管理卷。
// ============================================================================

type LocalDriver struct {
	basePath string
}

func (d *LocalDriver) Type() string { return "local" }

func (d *LocalDriver) Connect(ctx context.Context, config map[string]any) error {
	p, ok := config["path"].(string)
	if !ok || p == "" {
		return fmt.Errorf("local driver requires 'path' config")
	}
	if err := os.MkdirAll(p, 0o755); err != nil {
		return err
	}
	d.basePath = p
	return nil
}

func (d *LocalDriver) Disconnect(ctx context.Context) error { return nil }

func (d *LocalDriver) volPath(name string) string {
	return filepath.Join(d.basePath, name+".qcow2")
}

func (d *LocalDriver) CreateVolume(ctx context.Context, name string, sizeGB int64) (*Volume, error) {
	path := d.volPath(name)
	cmd := exec.CommandContext(ctx, "qemu-img", "create", "-f", "qcow2",
		path, fmt.Sprintf("%dG", sizeGB))
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("qemu-img create failed: %s: %w", string(out), err)
	}
	return &Volume{Name: name, Path: path, SizeBytes: sizeGB * 1 << 30, Format: "qcow2"}, nil
}

func (d *LocalDriver) DeleteVolume(ctx context.Context, name string) error {
	return os.Remove(d.volPath(name))
}

// CloneVolume 使用 qcow2 backing file 实现链式克隆（瞬时、节省空间）。
func (d *LocalDriver) CloneVolume(ctx context.Context, srcName, dstName string) error {
	src := d.volPath(srcName)
	dst := d.volPath(dstName)
	cmd := exec.CommandContext(ctx, "qemu-img", "create", "-f", "qcow2",
		"-b", src, "-F", "qcow2", dst)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("clone failed: %s: %w", string(out), err)
	}
	return nil
}

func (d *LocalDriver) GetCapacity(ctx context.Context) (*CapacityInfo, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(d.basePath, &stat); err != nil {
		return nil, err
	}
	total := int64(stat.Blocks) * int64(stat.Bsize)
	avail := int64(stat.Bavail) * int64(stat.Bsize)
	return &CapacityInfo{TotalBytes: total, AvailableBytes: avail, UsedBytes: total - avail}, nil
}

func (d *LocalDriver) GetMetrics(ctx context.Context) (*StorageMetrics, error) {
	// 生产实现应解析 /proc/diskstats；此处返回占位。
	return &StorageMetrics{}, nil
}

// ============================================================================
// NFSDriver：挂载 NFS 共享，卷管理委托给 local 语义。
// ============================================================================

type NFSDriver struct {
	server     string
	exportPath string
	mountPoint string
	local      *LocalDriver
}

func (d *NFSDriver) Type() string { return "nfs" }

func (d *NFSDriver) Connect(ctx context.Context, config map[string]any) error {
	d.server, _ = config["server"].(string)
	d.exportPath, _ = config["export"].(string)
	d.mountPoint, _ = config["mount_point"].(string)
	if d.server == "" || d.exportPath == "" || d.mountPoint == "" {
		return fmt.Errorf("nfs driver requires server/export/mount_point")
	}
	if err := os.MkdirAll(d.mountPoint, 0o755); err != nil {
		return err
	}
	// 已挂载则跳过
	if !isMounted(d.mountPoint) {
		opts := "vers=4.2,hard,timeo=600,retrans=2,_netdev"
		src := fmt.Sprintf("%s:%s", d.server, d.exportPath)
		cmd := exec.CommandContext(ctx, "mount", "-t", "nfs", "-o", opts, src, d.mountPoint)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("nfs mount failed: %s: %w", string(out), err)
		}
	}
	d.local = &LocalDriver{basePath: d.mountPoint}
	return nil
}

func (d *NFSDriver) Disconnect(ctx context.Context) error {
	if isMounted(d.mountPoint) {
		return exec.CommandContext(ctx, "umount", d.mountPoint).Run()
	}
	return nil
}

func (d *NFSDriver) CreateVolume(ctx context.Context, name string, sizeGB int64) (*Volume, error) {
	return d.local.CreateVolume(ctx, name, sizeGB)
}
func (d *NFSDriver) DeleteVolume(ctx context.Context, name string) error {
	return d.local.DeleteVolume(ctx, name)
}
func (d *NFSDriver) CloneVolume(ctx context.Context, src, dst string) error {
	return d.local.CloneVolume(ctx, src, dst)
}
func (d *NFSDriver) GetCapacity(ctx context.Context) (*CapacityInfo, error) {
	return d.local.GetCapacity(ctx)
}
func (d *NFSDriver) GetMetrics(ctx context.Context) (*StorageMetrics, error) {
	return &StorageMetrics{}, nil
}

// ============================================================================
// ISCSIDriver：iSCSI target 登录 + 多路径块设备管理。
// ============================================================================

type ISCSIDriver struct {
	portal string // 192.168.1.10:3260
	iqn    string // iqn.2024-01.com.example:target0
	device string // /dev/sdX 或多路径 /dev/mapper/xxx
}

func (d *ISCSIDriver) Type() string { return "iscsi" }

func (d *ISCSIDriver) Connect(ctx context.Context, config map[string]any) error {
	d.portal, _ = config["portal"].(string)
	d.iqn, _ = config["iqn"].(string)
	if d.portal == "" || d.iqn == "" {
		return fmt.Errorf("iscsi driver requires portal/iqn")
	}
	// 发现 target
	if out, err := exec.CommandContext(ctx, "iscsiadm", "-m", "discovery",
		"-t", "sendtargets", "-p", d.portal).CombinedOutput(); err != nil {
		return fmt.Errorf("iscsi discovery failed: %s: %w", string(out), err)
	}
	// 登录
	if out, err := exec.CommandContext(ctx, "iscsiadm", "-m", "node",
		"-T", d.iqn, "-p", d.portal, "--login").CombinedOutput(); err != nil {
		return fmt.Errorf("iscsi login failed: %s: %w", string(out), err)
	}
	return nil
}

func (d *ISCSIDriver) Disconnect(ctx context.Context) error {
	return exec.CommandContext(ctx, "iscsiadm", "-m", "node",
		"-T", d.iqn, "-p", d.portal, "--logout").Run()
}

// CreateVolume 对块设备而言通常由存储阵列侧创建 LUN，这里用 LVM 在块设备上切卷。
func (d *ISCSIDriver) CreateVolume(ctx context.Context, name string, sizeGB int64) (*Volume, error) {
	cmd := exec.CommandContext(ctx, "lvcreate", "-L", fmt.Sprintf("%dG", sizeGB),
		"-n", name, "cnf_vg")
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("lvcreate failed: %s: %w", string(out), err)
	}
	return &Volume{Name: name, Path: "/dev/cnf_vg/" + name, SizeBytes: sizeGB * 1 << 30, Format: "raw"}, nil
}

func (d *ISCSIDriver) DeleteVolume(ctx context.Context, name string) error {
	return exec.CommandContext(ctx, "lvremove", "-f", "/dev/cnf_vg/"+name).Run()
}

func (d *ISCSIDriver) CloneVolume(ctx context.Context, src, dst string) error {
	// LVM 快照式克隆
	return exec.CommandContext(ctx, "lvcreate", "-s", "-n", dst, "/dev/cnf_vg/"+src).Run()
}

func (d *ISCSIDriver) GetCapacity(ctx context.Context) (*CapacityInfo, error) {
	out, err := exec.CommandContext(ctx, "vgs", "--noheadings", "--units", "b",
		"-o", "vg_size,vg_free", "cnf_vg").Output()
	if err != nil {
		return nil, err
	}
	fields := strings.Fields(string(out))
	if len(fields) < 2 {
		return &CapacityInfo{}, nil
	}
	total, _ := strconv.ParseInt(strings.TrimSuffix(fields[0], "B"), 10, 64)
	free, _ := strconv.ParseInt(strings.TrimSuffix(fields[1], "B"), 10, 64)
	return &CapacityInfo{TotalBytes: total, AvailableBytes: free, UsedBytes: total - free}, nil
}

func (d *ISCSIDriver) GetMetrics(ctx context.Context) (*StorageMetrics, error) {
	return &StorageMetrics{}, nil
}

// isMounted 检查挂载点是否已挂载。
func isMounted(path string) bool {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return false
	}
	return strings.Contains(string(data), " "+path+" ")
}
