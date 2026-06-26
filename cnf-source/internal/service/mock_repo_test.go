package service

import (
	"context"
	"fmt"
	"sync"

	"github.com/cnf/cnfv1/internal/model"
)

// mockRepo 是内存实现的 Repository，用于 service 层纯 Go 单元测试。
type mockRepo struct {
	mu     sync.Mutex
	vms    map[int]*model.VM
	hosts  map[int]*model.Host
	tasks  map[int]*model.Task
	taskID int
}

func newMockRepo() *mockRepo {
	return &mockRepo{
		vms:   make(map[int]*model.VM),
		hosts: make(map[int]*model.Host),
		tasks: make(map[int]*model.Task),
	}
}

// ---- VM ----
func (m *mockRepo) GetVM(ctx context.Context, id int) (*model.VM, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if v, ok := m.vms[id]; ok {
		return v, nil
	}
	return nil, fmt.Errorf("vm %d not found", id)
}
func (m *mockRepo) GetVMByName(ctx context.Context, clusterID int, name string) (*model.VM, error) {
	return nil, fmt.Errorf("not implemented")
}
func (m *mockRepo) ListVMs(ctx context.Context, clusterID int) ([]model.VM, error) {
	return nil, nil
}
func (m *mockRepo) CreateVM(ctx context.Context, vm *model.VM) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := len(m.vms) + 1
	vm.ID = id
	cp := *vm
	m.vms[id] = &cp
	return id, nil
}
func (m *mockRepo) UpdateVM(ctx context.Context, vm *model.VM) error { return nil }
func (m *mockRepo) UpdateVMStatus(ctx context.Context, id int, status model.VMStatus) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if v, ok := m.vms[id]; ok {
		v.Status = status
	}
	return nil
}
func (m *mockRepo) DeleteVM(ctx context.Context, id int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.vms, id)
	return nil
}

// ---- Host ----
func (m *mockRepo) GetHost(ctx context.Context, id int) (*model.Host, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if h, ok := m.hosts[id]; ok {
		return h, nil
	}
	return nil, fmt.Errorf("host %d not found", id)
}
func (m *mockRepo) ListHosts(ctx context.Context, clusterID int) ([]model.Host, error) {
	return nil, nil
}
func (m *mockRepo) UpsertHost(ctx context.Context, h *model.Host) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if h.ID == 0 {
		h.ID = len(m.hosts) + 1
	}
	cp := *h
	m.hosts[h.ID] = &cp
	return h.ID, nil
}

// ---- GPU ----
func (m *mockRepo) GetGPU(ctx context.Context, id int) (*model.GPUDevice, error) {
	return nil, fmt.Errorf("not implemented")
}
func (m *mockRepo) ListGPUsByHost(ctx context.Context, hostID int) ([]model.GPUDevice, error) {
	return nil, nil
}
func (m *mockRepo) UpsertGPU(ctx context.Context, g *model.GPUDevice) (int, error) {
	return 1, nil
}
func (m *mockRepo) AssignGPU(ctx context.Context, vmID, gpuID int, mdevUUID string) error {
	return nil
}
func (m *mockRepo) ReleaseGPU(ctx context.Context, vmID, gpuID int) error { return nil }

// ---- Disk / NIC ----
func (m *mockRepo) ListDisks(ctx context.Context, vmID int) ([]model.VMDisk, error) {
	return nil, nil
}
func (m *mockRepo) CreateDisk(ctx context.Context, d *model.VMDisk) (int, error) { return 1, nil }
func (m *mockRepo) ListNICs(ctx context.Context, vmID int) ([]model.VMNic, error) {
	return nil, nil
}
func (m *mockRepo) CreateNIC(ctx context.Context, n *model.VMNic) (int, error) { return 1, nil }

// ---- Task ----
func (m *mockRepo) CreateTask(ctx context.Context, t *model.Task) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.taskID++
	t.ID = m.taskID
	cp := *t
	m.tasks[t.ID] = &cp
	return t.ID, nil
}
func (m *mockRepo) UpdateTask(ctx context.Context, t *model.Task) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *t
	m.tasks[t.ID] = &cp
	return nil
}
func (m *mockRepo) GetTask(ctx context.Context, id int) (*model.Task, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[id]; ok {
		cp := *t
		return &cp, nil
	}
	return nil, fmt.Errorf("task not found")
}
func (m *mockRepo) GetTaskByUUID(ctx context.Context, u string) (*model.Task, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.tasks {
		if t.UUID.String() == u {
			cp := *t
			return &cp, nil
		}
	}
	return nil, fmt.Errorf("task not found")
}
func (m *mockRepo) ListTasks(ctx context.Context, status string, limit int) ([]model.Task, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []model.Task{}
	for _, t := range m.tasks {
		if status == "" || string(t.Status) == status {
			out = append(out, *t)
		}
	}
	return out, nil
}

// getTask 测试辅助：读取任务最新快照。
func (m *mockRepo) getTask(id int) *model.Task {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[id]; ok {
		cp := *t
		return &cp
	}
	return nil
}
