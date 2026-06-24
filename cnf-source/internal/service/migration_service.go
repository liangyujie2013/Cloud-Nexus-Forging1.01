package service

import (
	"context"
	"fmt"

	"github.com/cnf/cnfv1/internal/model"
	"github.com/cnf/cnfv1/internal/virt"
)

// MigrationService 热迁移服务（集群内）。
type MigrationService struct {
	repo Repository
	conn *virt.ConnManager
}

func NewMigrationService(repo Repository, conn *virt.ConnManager) *MigrationService {
	return &MigrationService{repo: repo, conn: conn}
}

// MigrateRequest 迁移请求。
type MigrateRequest struct {
	VMID          int
	DestHostID    int
	Live          bool   // 在线迁移（不停机）
	StorageMig    bool   // 同时迁移本地存储（非共享存储）
	MaxDowntimeMs uint64 // 最大停机时间
	Compressed    bool
}

// Migrate 执行热迁移：校验目标主机资源 → live migrate → 更新 host_id。
func (s *MigrationService) Migrate(ctx context.Context, req *MigrateRequest) error {
	vm, err := s.repo.GetVM(ctx, req.VMID)
	if err != nil {
		return fmt.Errorf("VM 不存在: %w", err)
	}
	if vm.HostID == nil {
		return fmt.Errorf("VM 未绑定源宿主机")
	}
	srcHost, err := s.repo.GetHost(ctx, *vm.HostID)
	if err != nil {
		return err
	}
	destHost, err := s.repo.GetHost(ctx, req.DestHostID)
	if err != nil {
		return fmt.Errorf("目标宿主机不存在: %w", err)
	}

	// 必须同集群
	if srcHost.ClusterID != destHost.ClusterID {
		return fmt.Errorf("仅支持集群内迁移（源集群 %d != 目标集群 %d）", srcHost.ClusterID, destHost.ClusterID)
	}
	if srcHost.ID == destHost.ID {
		return fmt.Errorf("源宿主机与目标宿主机相同")
	}

	// 资源预检：目标主机剩余内存是否足够
	availMB := destHost.MemoryTotalMB - destHost.MemoryReservedMB
	if int64(vm.MemoryMB) > availMB {
		return fmt.Errorf("目标主机内存不足：需要 %dMB，可用 %dMB", vm.MemoryMB, availMB)
	}

	// GPU 直通 VM 不支持在线迁移（设备状态无法迁移）
	gpus, _ := s.repo.ListGPUsByHost(ctx, srcHost.ID)
	if len(vm.GPUs) > 0 && req.Live {
		_ = gpus
		return fmt.Errorf("GPU 直通虚拟机不支持在线迁移，请先分离 GPU 或使用冷迁移")
	}

	// 标记迁移中
	_ = s.repo.UpdateVMStatus(ctx, req.VMID, model.VMMigrating)

	// 执行迁移
	err = s.conn.MigrateDomain(srcHost.IPAddress, vm.Name, virt.MigrateOptions{
		DestHostIP:    destHost.IPAddress,
		LiveMigration: req.Live,
		StorageMig:    req.StorageMig,
		MaxDowntimeMs: req.MaxDowntimeMs,
		Compressed:    req.Compressed,
	})
	if err != nil {
		_ = s.repo.UpdateVMStatus(ctx, req.VMID, model.VMRunning)
		return fmt.Errorf("迁移失败: %w", err)
	}

	// 更新归属
	vm.HostID = &destHost.ID
	vm.Status = model.VMRunning
	if err := s.repo.UpdateVM(ctx, vm); err != nil {
		return fmt.Errorf("迁移成功但更新归属失败: %w", err)
	}
	return nil
}

// Progress 查询迁移进度（0-100）。
func (s *MigrationService) Progress(ctx context.Context, vmID int) (float64, error) {
	vm, err := s.repo.GetVM(ctx, vmID)
	if err != nil {
		return 0, err
	}
	if vm.HostID == nil {
		return 0, fmt.Errorf("VM 未绑定宿主机")
	}
	host, err := s.repo.GetHost(ctx, *vm.HostID)
	if err != nil {
		return 0, err
	}
	return s.conn.GetMigrationProgress(host.IPAddress, vm.Name)
}
