package service

import (
	"context"
	"crypto/rand"
	"fmt"
	"time"

	"github.com/cnf/cnfv1/internal/model"
	"github.com/cnf/cnfv1/internal/storage"
	"github.com/cnf/cnfv1/internal/virt"
	"github.com/google/uuid"
)

// VMService 虚拟机生命周期管理。
type VMService struct {
	repo Repository
	conn *virt.ConnManager
}

// NewVMService 构造。
func NewVMService(repo Repository, conn *virt.ConnManager) *VMService {
	return &VMService{repo: repo, conn: conn}
}

// CreateVMRequest VM 创建请求。
type CreateVMRequest struct {
	VM           *model.VM
	DiskSizeGB   int64
	StoragePool  storage.Driver // 已连接的存储驱动
	TemplatePath string         // 模板克隆源（空则创建空盘）
	LinkedClone  bool           // 链式克隆（基于 backing file，瞬时）
}

// Create 创建虚拟机：分配磁盘 → 生成 XML → define → （可选）启动。
func (s *VMService) Create(ctx context.Context, req *CreateVMRequest) (*model.VM, error) {
	vm := req.VM

	// 1. 校验目标宿主机
	if vm.HostID == nil {
		return nil, fmt.Errorf("必须指定目标宿主机")
	}
	host, err := s.repo.GetHost(ctx, *vm.HostID)
	if err != nil {
		return nil, fmt.Errorf("宿主机不存在: %w", err)
	}

	// 2. 校验 CPU 拓扑
	if vm.CPUConfig().VCPUs() == 0 {
		return nil, fmt.Errorf("非法 CPU 拓扑")
	}
	// 校验绑核数量与 vCPU 数匹配
	if vm.CPUPinning && len(vm.CPUPinnedCPUs) > 0 && len(vm.CPUPinnedCPUs) < vm.CPUConfig().VCPUs() {
		return nil, fmt.Errorf("绑核 CPU 数(%d) 少于 vCPU 数(%d)", len(vm.CPUPinnedCPUs), vm.CPUConfig().VCPUs())
	}

	// 3. 生成 libvirt UUID
	lu := uuid.New()
	vm.LibvirtUUID = &lu
	vm.Status = model.VMStarting

	// 4. 准备系统盘
	diskName := fmt.Sprintf("%s-disk0", vm.Name)
	var vol *storage.Volume
	if req.LinkedClone && req.TemplatePath != "" {
		// 链式克隆：基于模板 backing file（秒级，节省空间）
		if err := req.StoragePool.CloneVolume(ctx, req.TemplatePath, diskName); err != nil {
			return nil, fmt.Errorf("链式克隆失败: %w", err)
		}
		vol, _ = req.StoragePool.CreateVolume(ctx, diskName, req.DiskSizeGB)
	} else if req.TemplatePath != "" {
		// 完整克隆
		if err := req.StoragePool.CloneVolume(ctx, req.TemplatePath, diskName); err != nil {
			return nil, fmt.Errorf("模板克隆失败: %w", err)
		}
		vol = &storage.Volume{Name: diskName, Path: req.TemplatePath, Format: "qcow2"}
	} else {
		// 空盘
		vol, err = req.StoragePool.CreateVolume(ctx, diskName, req.DiskSizeGB)
		if err != nil {
			return nil, fmt.Errorf("创建磁盘失败: %w", err)
		}
	}

	bootOrder := 1
	vm.Disks = append([]model.VMDisk{{
		Name:      diskName,
		Device:    "vda",
		Bus:       "virtio",
		Format:    "qcow2",
		Path:      vol.Path,
		SizeBytes: req.DiskSizeGB * 1 << 30,
		Bootable:  true,
		BootOrder: &bootOrder,
	}}, vm.Disks...)

	// 5. 为没有 MAC 的网卡生成 MAC
	for i := range vm.NICs {
		if vm.NICs[i].MACAddress == "" {
			vm.NICs[i].MACAddress = generateMAC()
		}
	}

	// 6. 生成 libvirt domain XML
	xml, err := virt.NewDomainXMLBuilder(vm).Build()
	if err != nil {
		return nil, fmt.Errorf("生成 XML 失败: %w", err)
	}

	// 7. 持久化到数据库
	id, err := s.repo.CreateVM(ctx, vm)
	if err != nil {
		return nil, fmt.Errorf("保存 VM 失败: %w", err)
	}
	vm.ID = id

	// 8. define 到 libvirt
	if _, err := s.conn.DefineDomain(host.IPAddress, xml); err != nil {
		_ = s.repo.UpdateVMStatus(ctx, id, model.VMError)
		return nil, fmt.Errorf("define domain 失败: %w", err)
	}

	// 9. 自动启动
	if vm.AutoStart {
		if err := s.conn.StartDomain(host.IPAddress, vm.Name); err != nil {
			_ = s.repo.UpdateVMStatus(ctx, id, model.VMError)
			return nil, fmt.Errorf("启动 VM 失败: %w", err)
		}
		_ = s.repo.UpdateVMStatus(ctx, id, model.VMRunning)
		vm.Status = model.VMRunning
	} else {
		_ = s.repo.UpdateVMStatus(ctx, id, model.VMStopped)
		vm.Status = model.VMStopped
	}

	return vm, nil
}

// Start 启动 VM。
func (s *VMService) Start(ctx context.Context, vmID int) error {
	vm, host, err := s.vmAndHost(ctx, vmID)
	if err != nil {
		return err
	}
	if err := s.conn.StartDomain(host.IPAddress, vm.Name); err != nil {
		return err
	}
	return s.repo.UpdateVMStatus(ctx, vmID, model.VMRunning)
}

// Stop 关闭 VM。graceful=true 走 ACPI 优雅关机，超时后强制 destroy。
func (s *VMService) Stop(ctx context.Context, vmID int, graceful bool) error {
	vm, host, err := s.vmAndHost(ctx, vmID)
	if err != nil {
		return err
	}
	if graceful {
		if err := s.conn.ShutdownDomain(host.IPAddress, vm.Name); err != nil {
			return err
		}
		// 等待 60s，超时强制断电
		if err := s.conn.WaitForState(host.IPAddress, vm.Name, virt.DomainShutoff, 60*time.Second); err != nil {
			_ = s.conn.DestroyDomain(host.IPAddress, vm.Name)
		}
	} else {
		if err := s.conn.DestroyDomain(host.IPAddress, vm.Name); err != nil {
			return err
		}
	}
	return s.repo.UpdateVMStatus(ctx, vmID, model.VMStopped)
}

// Restart 重启 VM。
func (s *VMService) Restart(ctx context.Context, vmID int) error {
	if err := s.Stop(ctx, vmID, true); err != nil {
		return err
	}
	return s.Start(ctx, vmID)
}

// Delete 删除 VM（undefine + 删除磁盘）。
func (s *VMService) Delete(ctx context.Context, vmID int, deleteDisks bool, pool storage.Driver) error {
	vm, host, err := s.vmAndHost(ctx, vmID)
	if err != nil {
		return err
	}
	_ = s.repo.UpdateVMStatus(ctx, vmID, model.VMDeleting)

	// 先确保停机
	if state, _ := s.conn.GetDomainState(host.IPAddress, vm.Name); state == virt.DomainRunning {
		_ = s.conn.DestroyDomain(host.IPAddress, vm.Name)
	}
	// undefine（含 NVRAM、快照元数据）
	if err := s.conn.UndefineDomain(host.IPAddress, vm.Name); err != nil {
		return fmt.Errorf("undefine 失败: %w", err)
	}
	// 删除磁盘
	if deleteDisks && pool != nil {
		disks, _ := s.repo.ListDisks(ctx, vmID)
		for _, d := range disks {
			_ = pool.DeleteVolume(ctx, d.Name)
		}
	}
	return s.repo.DeleteVM(ctx, vmID)
}

// vmAndHost 查询 VM 及其所在宿主机。
func (s *VMService) vmAndHost(ctx context.Context, vmID int) (*model.VM, *model.Host, error) {
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

// generateMAC 生成 KVM 私有 MAC（52:54:00 前缀）。
func generateMAC() string {
	buf := make([]byte, 3)
	_, _ = rand.Read(buf)
	return fmt.Sprintf("52:54:00:%02x:%02x:%02x", buf[0], buf[1], buf[2])
}
