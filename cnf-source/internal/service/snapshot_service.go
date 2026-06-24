package service

import (
	"context"
	"fmt"

	"github.com/cnf/cnfv1/internal/model"
	"github.com/cnf/cnfv1/internal/virt"
)

// SnapshotService 快照服务（含 NVRAM 与内存）。
type SnapshotService struct {
	repo Repository
	conn *virt.ConnManager
}

func NewSnapshotService(repo Repository, conn *virt.ConnManager) *SnapshotService {
	return &SnapshotService{repo: repo, conn: conn}
}

// CreateSnapshotRequest 快照创建请求。
type CreateSnapshotRequest struct {
	VMID        int
	Name        string
	Description string
	WithMemory  bool // 内存快照（运行态可恢复到精确时刻）
	Quiesce     bool // guest-agent 冻结文件系统保证磁盘一致性
}

// Create 创建快照。
func (s *SnapshotService) Create(ctx context.Context, req *CreateSnapshotRequest) error {
	vm, host, err := s.vmHost(ctx, req.VMID)
	if err != nil {
		return err
	}
	if req.Name == "" {
		return fmt.Errorf("快照名不能为空")
	}
	return s.conn.CreateSnapshot(host.IPAddress, vm.Name, virt.SnapshotOptions{
		Name:        req.Name,
		Description: req.Description,
		WithMemory:  req.WithMemory,
		Quiesce:     req.Quiesce,
	})
}

// Revert 回滚到快照（恢复 NVRAM + 磁盘 + 内存状态）。
func (s *SnapshotService) Revert(ctx context.Context, vmID int, snapName string) error {
	vm, host, err := s.vmHost(ctx, vmID)
	if err != nil {
		return err
	}
	return s.conn.RevertSnapshot(host.IPAddress, vm.Name, snapName)
}

// Delete 删除快照。
func (s *SnapshotService) Delete(ctx context.Context, vmID int, snapName string) error {
	vm, host, err := s.vmHost(ctx, vmID)
	if err != nil {
		return err
	}
	return s.conn.DeleteSnapshot(host.IPAddress, vm.Name, snapName)
}

// List 列出 VM 的所有快照。
func (s *SnapshotService) List(ctx context.Context, vmID int) ([]string, error) {
	vm, host, err := s.vmHost(ctx, vmID)
	if err != nil {
		return nil, err
	}
	return s.conn.ListSnapshots(host.IPAddress, vm.Name)
}

// vmHost 查询 VM 及其所在宿主机。
func (s *SnapshotService) vmHost(ctx context.Context, vmID int) (*model.VM, *model.Host, error) {
	vm, err := s.repo.GetVM(ctx, vmID)
	if err != nil {
		return nil, nil, fmt.Errorf("VM 不存在: %w", err)
	}
	if vm.HostID == nil {
		return nil, nil, fmt.Errorf("VM 未绑定宿主机")
	}
	host, err := s.repo.GetHost(ctx, *vm.HostID)
	if err != nil {
		return nil, nil, fmt.Errorf("宿主机不存在: %w", err)
	}
	return vm, host, nil
}
