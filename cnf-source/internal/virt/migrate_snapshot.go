package virt

import (
	"fmt"

	"libvirt.org/go/libvirt"
)

// ============================================================================
// 热迁移：集群内 live migration（可选存储迁移）。
// ============================================================================

// MigrateOptions 迁移参数。
type MigrateOptions struct {
	DestHostIP    string // 目标宿主机 IP
	LiveMigration bool   // 在线迁移（不停机）
	StorageMig    bool   // 同时迁移本地存储（非共享存储时）
	MaxDowntimeMs uint64 // 最大停机时间（ms），0 用默认
	Compressed    bool   // 启用压缩降低带宽
}

// MigrateDomain 将 domain 从 srcHost 迁移到 dest。
func (cm *ConnManager) MigrateDomain(srcHostIP, name string, opts MigrateOptions) error {
	srcConn, err := cm.Get(srcHostIP)
	if err != nil {
		return err
	}
	destConn, err := cm.Get(opts.DestHostIP)
	if err != nil {
		return fmt.Errorf("连接目标宿主机失败: %w", err)
	}

	dom, err := srcConn.LookupDomainByName(name)
	if err != nil {
		return fmt.Errorf("源宿主机找不到 domain %s: %w", name, err)
	}
	defer dom.Free()

	// 组装迁移标志
	var flags libvirt.DomainMigrateFlags = libvirt.MIGRATE_PERSIST_DEST | libvirt.MIGRATE_UNDEFINE_SOURCE
	if opts.LiveMigration {
		flags |= libvirt.MIGRATE_LIVE
	}
	if opts.StorageMig {
		// 迁移非共享存储（完整拷贝磁盘）
		flags |= libvirt.MIGRATE_NON_SHARED_DISK
	}
	if opts.Compressed {
		flags |= libvirt.MIGRATE_COMPRESSED
	}
	// 自动收敛，保证迁移最终完成
	flags |= libvirt.MIGRATE_AUTO_CONVERGE

	// 设置最大停机时间
	if opts.MaxDowntimeMs > 0 {
		_ = dom.MigrateSetMaxDowntime(opts.MaxDowntimeMs, 0)
	}

	// 执行迁移（peer-to-peer，由源 libvirtd 直连目标）
	newDom, err := dom.Migrate(destConn, flags, name, "", 0)
	if err != nil {
		return fmt.Errorf("迁移失败: %w", err)
	}
	if newDom != nil {
		defer newDom.Free()
	}
	return nil
}

// GetMigrationProgress 查询迁移进度（迁移过程中调用）。
func (cm *ConnManager) GetMigrationProgress(hostIP, name string) (float64, error) {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return 0, err
	}
	dom, err := conn.LookupDomainByName(name)
	if err != nil {
		return 0, err
	}
	defer dom.Free()

	info, err := dom.GetJobInfo()
	if err != nil {
		return 0, err
	}
	if info.DataTotal == 0 {
		return 0, nil
	}
	processed := info.DataTotal - info.DataRemaining
	return float64(processed) / float64(info.DataTotal) * 100, nil
}

// ============================================================================
// 快照：含 NVRAM 与内存状态。
// ============================================================================

// SnapshotOptions 快照参数。
type SnapshotOptions struct {
	Name        string
	Description string
	WithMemory  bool // 包含内存（运行态快照）
	Quiesce     bool // 通过 guest-agent 冻结文件系统保证一致性
}

// CreateSnapshot 创建快照。libvirt 默认会包含 NVRAM。
func (cm *ConnManager) CreateSnapshot(hostIP, domainName string, opts SnapshotOptions) error {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return err
	}
	dom, err := conn.LookupDomainByName(domainName)
	if err != nil {
		return err
	}
	defer dom.Free()

	memSnap := "no-state"
	if opts.WithMemory {
		memSnap = "internal"
	}
	snapXML := fmt.Sprintf(`<domainsnapshot>
  <name>%s</name>
  <description>%s</description>
  <memory snapshot='%s'/>
</domainsnapshot>`, xmlEscape(opts.Name), xmlEscape(opts.Description), memSnap)

	var flags libvirt.DomainSnapshotCreateFlags
	if opts.Quiesce {
		flags |= libvirt.DOMAIN_SNAPSHOT_CREATE_QUIESCE
	}
	if !opts.WithMemory {
		flags |= libvirt.DOMAIN_SNAPSHOT_CREATE_DISK_ONLY
	}

	snap, err := dom.CreateSnapshotXML(snapXML, flags)
	if err != nil {
		return fmt.Errorf("创建快照失败: %w", err)
	}
	defer snap.Free()
	return nil
}

// RevertSnapshot 回滚到指定快照（恢复 NVRAM 与磁盘/内存状态）。
func (cm *ConnManager) RevertSnapshot(hostIP, domainName, snapName string) error {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return err
	}
	dom, err := conn.LookupDomainByName(domainName)
	if err != nil {
		return err
	}
	defer dom.Free()

	snap, err := dom.SnapshotLookupByName(snapName, 0)
	if err != nil {
		return fmt.Errorf("找不到快照 %s: %w", snapName, err)
	}
	defer snap.Free()

	return snap.RevertToSnapshot(0)
}

// DeleteSnapshot 删除快照（含其子快照元数据）。
func (cm *ConnManager) DeleteSnapshot(hostIP, domainName, snapName string) error {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return err
	}
	dom, err := conn.LookupDomainByName(domainName)
	if err != nil {
		return err
	}
	defer dom.Free()

	snap, err := dom.SnapshotLookupByName(snapName, 0)
	if err != nil {
		return err
	}
	defer snap.Free()

	return snap.Delete(0)
}

// ListSnapshots 列出 domain 的所有快照名。
func (cm *ConnManager) ListSnapshots(hostIP, domainName string) ([]string, error) {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return nil, err
	}
	dom, err := conn.LookupDomainByName(domainName)
	if err != nil {
		return nil, err
	}
	defer dom.Free()

	snaps, err := dom.ListAllSnapshots(0)
	if err != nil {
		return nil, err
	}
	var names []string
	for i := range snaps {
		if n, err := snaps[i].GetName(); err == nil {
			names = append(names, n)
		}
		_ = snaps[i].Free()
	}
	return names, nil
}
