package mysql

import (
	"context"
	"database/sql"

	"github.com/cnf/cnfv1/internal/model"
)

// vmColumns 与 scanVM 一一对应。vcpus 为生成列，读取但不写入。
const vmColumns = `id, uuid, host_id, cluster_id, name, COALESCE(description,''), libvirt_uuid,
	cpu_sockets, cpu_cores_per_socket, cpu_threads_per_core, vcpus, cpu_model,
	cpu_pinning, cpu_pinned_map, cpu_pinned_cpus, numa_node_affinity, numa_topology, cpu_shares, cpu_quota,
	memory_mb, COALESCE(memory_max_mb,0), hugepages_enabled, memory_balloon,
	arch, machine_type, boot_mode, boot_order, COALESCE(nvram_path,''),
	status, ha_enabled, ha_priority, auto_start, COALESCE(guest_os,''), guest_agent_ready,
	COALESCE(vnc_port,0), COALESCE(vnc_password,''), created_at, updated_at`

func scanVM(s scanner) (*model.VM, error) {
	var (
		v          model.VM
		uuidStr    string
		libvirtRaw sql.NullString
		pinnedMap  sql.RawBytes
		pinnedCPUs sql.RawBytes
		numaTopo   sql.RawBytes
		bootOrder  sql.RawBytes
		hostID     sql.NullInt64
	)
	err := s.Scan(
		&v.ID, &uuidStr, &hostID, &v.ClusterID, &v.Name, &v.Description, &libvirtRaw,
		&v.CPUSockets, &v.CPUCoresPerSocket, &v.CPUThreadsPerCore, &v.VCPUs, &v.CPUModel,
		&v.CPUPinning, &pinnedMap, &pinnedCPUs, &v.NUMANodeAffinity, &numaTopo, &v.CPUShares, &v.CPUQuota,
		&v.MemoryMB, &v.MemoryMaxMB, &v.HugepagesEnabled, &v.MemoryBalloon,
		&v.Arch, &v.MachineType, &v.BootMode, &bootOrder, &v.NVRAMPath,
		&v.Status, &v.HAEnabled, &v.HAPriority, &v.AutoStart, &v.GuestOS, &v.GuestAgentReady,
		&v.VNCPort, &v.VNCPassword, &v.CreatedAt, &v.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	v.UUID = uuidParse(uuidStr)
	v.HostID = intPtr(hostID)
	if libvirtRaw.Valid && libvirtRaw.String != "" {
		u := uuidParse(libvirtRaw.String)
		v.LibvirtUUID = &u
	}
	_ = scanJSON([]byte(pinnedMap), &v.CPUPinnedMap)
	_ = scanJSON([]byte(pinnedCPUs), &v.CPUPinnedCPUs)
	_ = scanJSON([]byte(numaTopo), &v.NUMATopology)
	_ = scanJSON([]byte(bootOrder), &v.BootOrder)
	return &v, nil
}

func (r *Repository) GetVM(ctx context.Context, id int) (*model.VM, error) {
	return scanVM(r.db.QueryRowContext(ctx, `SELECT `+vmColumns+` FROM vms WHERE id=?`, id))
}

func (r *Repository) GetVMByName(ctx context.Context, clusterID int, name string) (*model.VM, error) {
	return scanVM(r.db.QueryRowContext(ctx,
		`SELECT `+vmColumns+` FROM vms WHERE cluster_id=? AND name=?`, clusterID, name))
}

func (r *Repository) ListVMs(ctx context.Context, clusterID int) ([]model.VM, error) {
	q := `SELECT ` + vmColumns + ` FROM vms`
	args := []any{}
	if clusterID > 0 {
		q += ` WHERE cluster_id=?`
		args = append(args, clusterID)
	}
	q += ` ORDER BY id`
	rows, err := r.db.QueryContext(ctx, q, args...)
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

func (r *Repository) CreateVM(ctx context.Context, v *model.VM) (int, error) {
	var libvirtUUID any
	if v.LibvirtUUID != nil {
		libvirtUUID = v.LibvirtUUID.String()
	}
	const q = `INSERT INTO vms (
		uuid, host_id, cluster_id, name, description, libvirt_uuid,
		cpu_sockets, cpu_cores_per_socket, cpu_threads_per_core, cpu_model,
		cpu_pinning, cpu_pinned_map, cpu_pinned_cpus, numa_node_affinity, numa_topology, cpu_shares, cpu_quota,
		memory_mb, memory_max_mb, hugepages_enabled, memory_balloon,
		arch, machine_type, boot_mode, boot_order, nvram_path,
		status, ha_enabled, ha_priority, auto_start, guest_os, guest_agent_ready,
		vnc_port, vnc_password
	) VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?)`
	res, err := r.db.ExecContext(ctx, q,
		newUUIDOr(v.UUID), nullInt(v.HostID), v.ClusterID, v.Name, nullStr(v.Description), libvirtUUID,
		v.CPUSockets, v.CPUCoresPerSocket, v.CPUThreadsPerCore, v.CPUModel,
		v.CPUPinning, mustJSON(v.CPUPinnedMap, true), mustJSON(v.CPUPinnedCPUs, true),
		v.NUMANodeAffinity, mustJSON(v.NUMATopology, true), v.CPUShares, v.CPUQuota,
		v.MemoryMB, nullZeroInt(v.MemoryMaxMB), v.HugepagesEnabled, v.MemoryBalloon,
		v.Arch, v.MachineType, v.BootMode, mustJSON(v.BootOrder, true), nullStr(v.NVRAMPath),
		v.Status, v.HAEnabled, v.HAPriority, v.AutoStart, nullStr(v.GuestOS), v.GuestAgentReady,
		nullZeroInt(v.VNCPort), nullStr(v.VNCPassword),
	)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	return int(id), err
}

func (r *Repository) UpdateVM(ctx context.Context, v *model.VM) error {
	const q = `UPDATE vms SET host_id=?, name=?, description=?, status=?,
		cpu_sockets=?, cpu_cores_per_socket=?, cpu_threads_per_core=?,
		memory_mb=?, auto_start=? WHERE id=?`
	_, err := r.db.ExecContext(ctx, q,
		nullInt(v.HostID), v.Name, nullStr(v.Description), v.Status,
		v.CPUSockets, v.CPUCoresPerSocket, v.CPUThreadsPerCore,
		v.MemoryMB, v.AutoStart, v.ID)
	return err
}

func (r *Repository) UpdateVMStatus(ctx context.Context, id int, status model.VMStatus) error {
	_, err := r.db.ExecContext(ctx, `UPDATE vms SET status=? WHERE id=?`, status, id)
	return err
}

func (r *Repository) DeleteVM(ctx context.Context, id int) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM vms WHERE id=?`, id)
	return err
}
