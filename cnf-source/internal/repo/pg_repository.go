// Package repo 提供 service.Repository 接口的 PostgreSQL（pgx）实现。
package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/cnf/cnfv1/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotImplemented 标记尚未落地的持久层方法（随迭代逐步补全）。
var ErrNotImplemented = errors.New("repository 方法尚未实现")

// PGRepository 基于 pgxpool 的 Repository 实现。
type PGRepository struct {
	pool *pgxpool.Pool
}

// New 用已建立的连接池构造仓储。
func New(pool *pgxpool.Pool) *PGRepository {
	return &PGRepository{pool: pool}
}

// NewFromURL 从连接串建立连接池并构造仓储。
func NewFromURL(ctx context.Context, dsn string) (*PGRepository, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("连接 PostgreSQL 失败: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("PostgreSQL ping 失败: %w", err)
	}
	return &PGRepository{pool: pool}, nil
}

// Close 关闭连接池。
func (r *PGRepository) Close() {
	if r.pool != nil {
		r.pool.Close()
	}
}

// ============================================================================
// VM
// ============================================================================

const vmColumns = `id, uuid, host_id, cluster_id, name, description, libvirt_uuid,
	cpu_sockets, cpu_cores_per_socket, cpu_threads_per_core, vcpus, cpu_model,
	cpu_pinning, numa_node_affinity, cpu_shares, cpu_quota,
	memory_mb, memory_max_mb, hugepages_enabled, memory_balloon,
	arch, machine_type, boot_mode, nvram_path,
	status, ha_enabled, ha_priority, auto_start, guest_os, guest_agent_ready,
	vnc_port, vnc_password, created_at`

func scanVM(row pgx.Row) (*model.VM, error) {
	var v model.VM
	err := row.Scan(
		&v.ID, &v.UUID, &v.HostID, &v.ClusterID, &v.Name, &v.Description, &v.LibvirtUUID,
		&v.CPUSockets, &v.CPUCoresPerSocket, &v.CPUThreadsPerCore, &v.VCPUs, &v.CPUModel,
		&v.CPUPinning, &v.NUMANodeAffinity, &v.CPUShares, &v.CPUQuota,
		&v.MemoryMB, &v.MemoryMaxMB, &v.HugepagesEnabled, &v.MemoryBalloon,
		&v.Arch, &v.MachineType, &v.BootMode, &v.NVRAMPath,
		&v.Status, &v.HAEnabled, &v.HAPriority, &v.AutoStart, &v.GuestOS, &v.GuestAgentReady,
		&v.VNCPort, &v.VNCPassword, &v.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *PGRepository) GetVM(ctx context.Context, id int) (*model.VM, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+vmColumns+` FROM vms WHERE id = $1`, id)
	return scanVM(row)
}

func (r *PGRepository) GetVMByName(ctx context.Context, clusterID int, name string) (*model.VM, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+vmColumns+` FROM vms WHERE cluster_id = $1 AND name = $2`, clusterID, name)
	return scanVM(row)
}

func (r *PGRepository) ListVMs(ctx context.Context, clusterID int) ([]model.VM, error) {
	q := `SELECT ` + vmColumns + ` FROM vms`
	args := []any{}
	if clusterID > 0 {
		q += ` WHERE cluster_id = $1`
		args = append(args, clusterID)
	}
	q += ` ORDER BY id`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.VM
	for rows.Next() {
		v, err := scanVM(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

func (r *PGRepository) CreateVM(ctx context.Context, v *model.VM) (int, error) {
	// UUID 为空时由 SQL 中的 gen_random_uuid() 兜底生成。
	const q = `INSERT INTO vms (
		uuid, host_id, cluster_id, name, description, libvirt_uuid,
		cpu_sockets, cpu_cores_per_socket, cpu_threads_per_core, vcpus, cpu_model,
		cpu_pinning, numa_node_affinity, cpu_shares, cpu_quota,
		memory_mb, memory_max_mb, hugepages_enabled, memory_balloon,
		arch, machine_type, boot_mode, nvram_path,
		status, ha_enabled, ha_priority, auto_start, guest_os, guest_agent_ready,
		vnc_port, vnc_password
	) VALUES (
		COALESCE(NULLIF($1,'00000000-0000-0000-0000-000000000000')::uuid, gen_random_uuid()),
		$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
	) RETURNING id`
	var id int
	err := r.pool.QueryRow(ctx, q,
		v.UUID.String(), v.HostID, v.ClusterID, v.Name, v.Description, v.LibvirtUUID,
		v.CPUSockets, v.CPUCoresPerSocket, v.CPUThreadsPerCore, v.VCPUs, v.CPUModel,
		v.CPUPinning, v.NUMANodeAffinity, v.CPUShares, v.CPUQuota,
		v.MemoryMB, v.MemoryMaxMB, v.HugepagesEnabled, v.MemoryBalloon,
		v.Arch, v.MachineType, v.BootMode, v.NVRAMPath,
		v.Status, v.HAEnabled, v.HAPriority, v.AutoStart, v.GuestOS, v.GuestAgentReady,
		v.VNCPort, v.VNCPassword,
	).Scan(&id)
	return id, err
}

func (r *PGRepository) UpdateVM(ctx context.Context, v *model.VM) error {
	const q = `UPDATE vms SET host_id=$2, name=$3, description=$4, status=$5,
		cpu_sockets=$6, cpu_cores_per_socket=$7, cpu_threads_per_core=$8, vcpus=$9,
		memory_mb=$10, auto_start=$11 WHERE id=$1`
	_, err := r.pool.Exec(ctx, q,
		v.ID, v.HostID, v.Name, v.Description, v.Status,
		v.CPUSockets, v.CPUCoresPerSocket, v.CPUThreadsPerCore, v.VCPUs,
		v.MemoryMB, v.AutoStart)
	return err
}

func (r *PGRepository) UpdateVMStatus(ctx context.Context, id int, status model.VMStatus) error {
	_, err := r.pool.Exec(ctx, `UPDATE vms SET status=$2 WHERE id=$1`, id, status)
	return err
}

func (r *PGRepository) DeleteVM(ctx context.Context, id int) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM vms WHERE id=$1`, id)
	return err
}

// ============================================================================
// Host
// ============================================================================

const hostColumns = `id, uuid, cluster_id, name, hostname, ip_address,
	cpu_model, cpu_sockets, cpu_cores_per_socket, cpu_threads_per_core, cpu_total_logical,
	numa_nodes, memory_total_mb, memory_reserved_mb,
	hugepages_total, hugepage_size_kb, libvirt_version, qemu_version,
	iommu_enabled, vfio_enabled, status, maintenance_mode, agent_version, created_at, updated_at`

func scanHost(row pgx.Row) (*model.Host, error) {
	var h model.Host
	err := row.Scan(
		&h.ID, &h.UUID, &h.ClusterID, &h.Name, &h.Hostname, &h.IPAddress,
		&h.CPUModel, &h.CPUSockets, &h.CPUCoresPerSocket, &h.CPUThreadsPerCore, &h.CPUTotalLogical,
		&h.NUMANodes, &h.MemoryTotalMB, &h.MemoryReservedMB,
		&h.HugepagesTotal, &h.HugepageSizeKB, &h.LibvirtVersion, &h.QEMUVersion,
		&h.IOMMUEnabled, &h.VFIOEnabled, &h.Status, &h.MaintenanceMode, &h.AgentVersion,
		&h.CreatedAt, &h.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func (r *PGRepository) GetHost(ctx context.Context, id int) (*model.Host, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+hostColumns+` FROM hosts WHERE id=$1`, id)
	return scanHost(row)
}

func (r *PGRepository) ListHosts(ctx context.Context, clusterID int) ([]model.Host, error) {
	q := `SELECT ` + hostColumns + ` FROM hosts`
	args := []any{}
	if clusterID > 0 {
		q += ` WHERE cluster_id=$1`
		args = append(args, clusterID)
	}
	q += ` ORDER BY id`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Host
	for rows.Next() {
		h, err := scanHost(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *h)
	}
	return out, rows.Err()
}

func (r *PGRepository) UpsertHost(ctx context.Context, h *model.Host) (int, error) {
	const q = `INSERT INTO hosts (
		uuid, cluster_id, name, hostname, ip_address,
		cpu_model, cpu_sockets, cpu_cores_per_socket, cpu_threads_per_core, cpu_total_logical,
		numa_nodes, memory_total_mb, memory_reserved_mb,
		hugepages_total, hugepage_size_kb, libvirt_version, qemu_version,
		iommu_enabled, vfio_enabled, status, maintenance_mode, agent_version
	) VALUES (
		COALESCE(NULLIF($1,'00000000-0000-0000-0000-000000000000')::uuid, gen_random_uuid()),
		$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
	)
	ON CONFLICT (ip_address) DO UPDATE SET
		name=EXCLUDED.name, hostname=EXCLUDED.hostname,
		cpu_model=EXCLUDED.cpu_model, cpu_total_logical=EXCLUDED.cpu_total_logical,
		numa_nodes=EXCLUDED.numa_nodes, memory_total_mb=EXCLUDED.memory_total_mb,
		libvirt_version=EXCLUDED.libvirt_version, qemu_version=EXCLUDED.qemu_version,
		iommu_enabled=EXCLUDED.iommu_enabled, vfio_enabled=EXCLUDED.vfio_enabled,
		status=EXCLUDED.status, agent_version=EXCLUDED.agent_version, updated_at=now()
	RETURNING id`
	var id int
	err := r.pool.QueryRow(ctx, q,
		h.UUID.String(), h.ClusterID, h.Name, h.Hostname, h.IPAddress,
		h.CPUModel, h.CPUSockets, h.CPUCoresPerSocket, h.CPUThreadsPerCore, h.CPUTotalLogical,
		h.NUMANodes, h.MemoryTotalMB, h.MemoryReservedMB,
		h.HugepagesTotal, h.HugepageSizeKB, h.LibvirtVersion, h.QEMUVersion,
		h.IOMMUEnabled, h.VFIOEnabled, h.Status, h.MaintenanceMode, h.AgentVersion,
	).Scan(&id)
	return id, err
}

// ============================================================================
// GPU
// ============================================================================

func (r *PGRepository) GetGPU(ctx context.Context, id int) (*model.GPUDevice, error) {
	var g model.GPUDevice
	err := r.pool.QueryRow(ctx,
		`SELECT id, host_id, pci_address, vendor, model, mode FROM gpu_devices WHERE id=$1`, id).
		Scan(&g.ID, &g.HostID, &g.PCIAddress, &g.Vendor, &g.Model, &g.Mode)
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *PGRepository) ListGPUsByHost(ctx context.Context, hostID int) ([]model.GPUDevice, error) {
	q := `SELECT id, host_id, pci_address, vendor, model, mode FROM gpu_devices`
	args := []any{}
	if hostID > 0 {
		q += ` WHERE host_id=$1`
		args = append(args, hostID)
	}
	q += ` ORDER BY id`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.GPUDevice
	for rows.Next() {
		var g model.GPUDevice
		if err := rows.Scan(&g.ID, &g.HostID, &g.PCIAddress, &g.Vendor, &g.Model, &g.Mode); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (r *PGRepository) UpsertGPU(ctx context.Context, g *model.GPUDevice) (int, error) {
	const q = `INSERT INTO gpu_devices (host_id, pci_address, vendor, model, mode)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (host_id, pci_address) DO UPDATE SET
			vendor=EXCLUDED.vendor, model=EXCLUDED.model
		RETURNING id`
	var id int
	err := r.pool.QueryRow(ctx, q, g.HostID, g.PCIAddress, g.Vendor, g.Model, g.Mode).Scan(&id)
	return id, err
}

// AssignGPU 在 vm_gpus 关联表登记分配，并将设备状态置为 in-use。
func (r *PGRepository) AssignGPU(ctx context.Context, vmID, gpuID int, mdevUUID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`INSERT INTO vm_gpus (vm_id, gpu_device_id, mdev_uuid)
		 VALUES ($1,$2,NULLIF($3,'')::uuid)
		 ON CONFLICT (vm_id, gpu_device_id) DO UPDATE SET mdev_uuid=EXCLUDED.mdev_uuid`,
		vmID, gpuID, mdevUUID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE gpu_devices SET status='in-use', updated_at=now() WHERE id=$1`, gpuID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ReleaseGPU 解除分配并将设备状态恢复 available。
func (r *PGRepository) ReleaseGPU(ctx context.Context, vmID, gpuID int) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`DELETE FROM vm_gpus WHERE vm_id=$1 AND gpu_device_id=$2`, vmID, gpuID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE gpu_devices SET status='available', updated_at=now() WHERE id=$1`, gpuID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ============================================================================
// Disk / NIC
// ============================================================================

func (r *PGRepository) ListDisks(ctx context.Context, vmID int) ([]model.VMDisk, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT name, device, bus, format, path, size_bytes, bootable FROM vm_disks WHERE vm_id=$1 ORDER BY id`, vmID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.VMDisk
	for rows.Next() {
		var d model.VMDisk
		if err := rows.Scan(&d.Name, &d.Device, &d.Bus, &d.Format, &d.Path, &d.SizeBytes, &d.Bootable); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *PGRepository) CreateDisk(ctx context.Context, d *model.VMDisk) (int, error) {
	var id int
	err := r.pool.QueryRow(ctx,
		`INSERT INTO vm_disks (vm_id, name, device, bus, format, path, size_bytes, bootable)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		d.VMID, d.Name, d.Device, d.Bus, d.Format, d.Path, d.SizeBytes, d.Bootable).Scan(&id)
	return id, err
}

func (r *PGRepository) ListNICs(ctx context.Context, vmID int) ([]model.VMNic, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, vm_id, mac_address, model, COALESCE(host(ip_address),''), order_index
		 FROM vm_nics WHERE vm_id=$1 ORDER BY order_index, id`, vmID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.VMNic
	for rows.Next() {
		var n model.VMNic
		if err := rows.Scan(&n.ID, &n.VMID, &n.MACAddress, &n.Model, &n.IPAddress, &n.OrderIndex); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (r *PGRepository) CreateNIC(ctx context.Context, n *model.VMNic) (int, error) {
	var id int
	err := r.pool.QueryRow(ctx,
		`INSERT INTO vm_nics (vm_id, mac_address, model, order_index)
		 VALUES ($1,$2,$3,$4) RETURNING id`,
		n.VMID, n.MACAddress, n.Model, n.OrderIndex).Scan(&id)
	return id, err
}

// ============================================================================
// Task
// ============================================================================

func (r *PGRepository) CreateTask(ctx context.Context, t *model.Task) (int, error) {
	var id int
	err := r.pool.QueryRow(ctx,
		`INSERT INTO tasks (uuid, type, target_type, target_id, status, progress, user_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
		t.UUID, t.Type, t.TargetType, t.TargetID, t.Status, t.Progress, t.UserID).Scan(&id)
	return id, err
}

func (r *PGRepository) UpdateTask(ctx context.Context, t *model.Task) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE tasks SET status=$2, progress=$3, error_message=$4, started_at=$5, finished_at=$6
		 WHERE id=$1`,
		t.ID, t.Status, t.Progress, t.ErrorMessage, t.StartedAt, t.FinishedAt)
	return err
}
