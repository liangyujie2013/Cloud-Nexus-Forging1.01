package mysql

import (
	"context"
	"database/sql"

	"github.com/cnf/cnfv1/internal/model"
)

const hostColumns = `id, uuid, cluster_id, name, COALESCE(hostname,''), ip_address,
	COALESCE(cpu_model,''), cpu_sockets, cpu_cores_per_socket, cpu_threads_per_core, cpu_total_logical,
	numa_nodes, numa_topology, memory_total_mb, memory_reserved_mb,
	hugepages_total, hugepage_size_kb, COALESCE(libvirt_version,''), COALESCE(qemu_version,''),
	iommu_enabled, vfio_enabled, status, maintenance_mode, COALESCE(agent_version,''), created_at, updated_at`

func scanHost(s scanner) (*model.Host, error) {
	var (
		h        model.Host
		uuidStr  string
		numaTopo sql.RawBytes
	)
	err := s.Scan(
		&h.ID, &uuidStr, &h.ClusterID, &h.Name, &h.Hostname, &h.IPAddress,
		&h.CPUModel, &h.CPUSockets, &h.CPUCoresPerSocket, &h.CPUThreadsPerCore, &h.CPUTotalLogical,
		&h.NUMANodes, &numaTopo, &h.MemoryTotalMB, &h.MemoryReservedMB,
		&h.HugepagesTotal, &h.HugepageSizeKB, &h.LibvirtVersion, &h.QEMUVersion,
		&h.IOMMUEnabled, &h.VFIOEnabled, &h.Status, &h.MaintenanceMode, &h.AgentVersion,
		&h.CreatedAt, &h.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	h.UUID = uuidParse(uuidStr)
	_ = scanJSON([]byte(numaTopo), &h.NUMATopology)
	return &h, nil
}

func (r *Repository) GetHost(ctx context.Context, id int) (*model.Host, error) {
	return scanHost(r.db.QueryRowContext(ctx, `SELECT `+hostColumns+` FROM hosts WHERE id=?`, id))
}

func (r *Repository) ListHosts(ctx context.Context, clusterID int) ([]model.Host, error) {
	q := `SELECT ` + hostColumns + ` FROM hosts`
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

// UpsertHost 以 ip_address 为唯一键插入或更新。MySQL 无 RETURNING，
// 通过 LastInsertId 取新插入 id；若为更新（LastInsertId=0），再按 ip 回查。
func (r *Repository) UpsertHost(ctx context.Context, h *model.Host) (int, error) {
	const q = `INSERT INTO hosts (
		uuid, cluster_id, name, hostname, ip_address,
		cpu_model, cpu_sockets, cpu_cores_per_socket, cpu_threads_per_core,
		numa_nodes, numa_topology, memory_total_mb, memory_reserved_mb,
		hugepages_total, hugepage_size_kb, libvirt_version, qemu_version,
		iommu_enabled, vfio_enabled, status, maintenance_mode, agent_version
	) VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?,?)
	ON DUPLICATE KEY UPDATE
		name=VALUES(name), hostname=VALUES(hostname),
		cpu_model=VALUES(cpu_model), cpu_sockets=VALUES(cpu_sockets),
		cpu_cores_per_socket=VALUES(cpu_cores_per_socket), cpu_threads_per_core=VALUES(cpu_threads_per_core),
		numa_nodes=VALUES(numa_nodes), numa_topology=VALUES(numa_topology),
		memory_total_mb=VALUES(memory_total_mb),
		libvirt_version=VALUES(libvirt_version), qemu_version=VALUES(qemu_version),
		iommu_enabled=VALUES(iommu_enabled), vfio_enabled=VALUES(vfio_enabled),
		status=VALUES(status), agent_version=VALUES(agent_version)`
	res, err := r.db.ExecContext(ctx, q,
		newUUIDOr(h.UUID), h.ClusterID, h.Name, nullStr(h.Hostname), h.IPAddress,
		nullStr(h.CPUModel), h.CPUSockets, h.CPUCoresPerSocket, h.CPUThreadsPerCore,
		h.NUMANodes, mustJSON(h.NUMATopology, true), h.MemoryTotalMB, h.MemoryReservedMB,
		h.HugepagesTotal, h.HugepageSizeKB, nullStr(h.LibvirtVersion), nullStr(h.QEMUVersion),
		h.IOMMUEnabled, h.VFIOEnabled, h.Status, h.MaintenanceMode, nullStr(h.AgentVersion),
	)
	if err != nil {
		return 0, err
	}
	if id, _ := res.LastInsertId(); id > 0 {
		return int(id), nil
	}
	// 更新分支：按 ip 回查 id
	var id int
	err = r.db.QueryRowContext(ctx, `SELECT id FROM hosts WHERE ip_address=?`, h.IPAddress).Scan(&id)
	return id, err
}
