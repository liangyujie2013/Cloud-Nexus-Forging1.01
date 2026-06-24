// Package service 实现 CNFv1.0 的核心业务逻辑层。
// service 编排 model（数据）、virt（libvirt 操作）、storage（卷管理）、gpu（设备管理），
// 并通过 Repository 接口与持久层解耦（便于 mock 测试）。
package service

import (
	"context"

	"github.com/cnf/cnfv1/internal/model"
)

// Repository 持久层接口（由 pgx 实现，测试时用 mock）。
type Repository interface {
	// VM
	GetVM(ctx context.Context, id int) (*model.VM, error)
	GetVMByName(ctx context.Context, clusterID int, name string) (*model.VM, error)
	ListVMs(ctx context.Context, clusterID int) ([]model.VM, error)
	CreateVM(ctx context.Context, vm *model.VM) (int, error)
	UpdateVM(ctx context.Context, vm *model.VM) error
	UpdateVMStatus(ctx context.Context, id int, status model.VMStatus) error
	DeleteVM(ctx context.Context, id int) error

	// Host
	GetHost(ctx context.Context, id int) (*model.Host, error)
	ListHosts(ctx context.Context, clusterID int) ([]model.Host, error)
	UpsertHost(ctx context.Context, h *model.Host) (int, error)

	// GPU
	GetGPU(ctx context.Context, id int) (*model.GPUDevice, error)
	ListGPUsByHost(ctx context.Context, hostID int) ([]model.GPUDevice, error)
	UpsertGPU(ctx context.Context, g *model.GPUDevice) (int, error)
	AssignGPU(ctx context.Context, vmID, gpuID int, mdevUUID string) error
	ReleaseGPU(ctx context.Context, vmID, gpuID int) error

	// Disk / NIC
	ListDisks(ctx context.Context, vmID int) ([]model.VMDisk, error)
	CreateDisk(ctx context.Context, d *model.VMDisk) (int, error)
	ListNICs(ctx context.Context, vmID int) ([]model.VMNic, error)
	CreateNIC(ctx context.Context, n *model.VMNic) (int, error)

	// Task
	CreateTask(ctx context.Context, t *model.Task) (int, error)
	UpdateTask(ctx context.Context, t *model.Task) error
}
