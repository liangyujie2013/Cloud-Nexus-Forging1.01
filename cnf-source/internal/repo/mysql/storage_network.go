package mysql

import (
	"context"
	"database/sql"
	"errors"

	"github.com/cnf/cnfv1/internal/model"
)

// ============================================================================
// 存储池 CRUD
// ============================================================================

const storagePoolColumns = `id, uuid, cluster_id, host_id, name, type,
	config, COALESCE(target_path,''), COALESCE(source_path,''),
	capacity_bytes, allocated_bytes, available_bytes, is_shared, status, created_at, updated_at`

func scanStoragePool(s scanner) (*model.StoragePool, error) {
	var (
		p       model.StoragePool
		cluster sql.NullInt64
		host    sql.NullInt64
		cfg     []byte
	)
	if err := s.Scan(
		&p.ID, &p.UUID, &cluster, &host, &p.Name, &p.Type,
		&cfg, &p.TargetPath, &p.SourcePath,
		&p.CapacityBytes, &p.AllocatedBytes, &p.AvailableBytes, &p.IsShared, &p.Status,
		&p.CreatedAt, &p.UpdatedAt,
	); err != nil {
		return nil, err
	}
	p.ClusterID = intPtr(cluster)
	p.HostID = intPtr(host)
	_ = scanJSON([]byte(cfg), &p.Config)
	if p.Config == nil {
		p.Config = map[string]any{}
	}
	return &p, nil
}

// GetStoragePool 按 id 查询存储池。
func (r *Repository) GetStoragePool(ctx context.Context, id int) (*model.StoragePool, error) {
	p, err := scanStoragePool(r.db.QueryRowContext(ctx,
		`SELECT `+storagePoolColumns+` FROM storage_pools WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// ListStoragePools 列出存储池；clusterID>0 时按集群过滤（含共享池）。
func (r *Repository) ListStoragePools(ctx context.Context, clusterID int) ([]model.StoragePool, error) {
	q := `SELECT ` + storagePoolColumns + ` FROM storage_pools`
	args := []any{}
	if clusterID > 0 {
		q += ` WHERE cluster_id=? OR is_shared=1`
		args = append(args, clusterID)
	}
	q += ` ORDER BY id`
	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.StoragePool
	for rows.Next() {
		p, err := scanStoragePool(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// CreateStoragePool 新建存储池。
func (r *Repository) CreateStoragePool(ctx context.Context, p *model.StoragePool) (int, error) {
	if p.Type == "" {
		p.Type = model.PoolLocal
	}
	if p.Status == "" {
		p.Status = "active"
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO storage_pools (uuid, cluster_id, host_id, name, type, config,
			target_path, source_path, capacity_bytes, allocated_bytes, available_bytes, is_shared, status)
		 VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?)`,
		newUUIDOr0Str(p.UUID), nullInt(p.ClusterID), nullInt(p.HostID), p.Name, p.Type, mustJSON(p.Config, false),
		nullStr(p.TargetPath), nullStr(p.SourcePath), p.CapacityBytes, p.AllocatedBytes, p.AvailableBytes,
		p.IsShared, p.Status)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return int(id), nil
}

// UpdateStoragePoolUsage 刷新容量/已分配/可用（由 libvirt 池状态同步）。
func (r *Repository) UpdateStoragePoolUsage(ctx context.Context, id int, capacity, allocated, available int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE storage_pools SET capacity_bytes=?, allocated_bytes=?, available_bytes=? WHERE id=?`,
		capacity, allocated, available, id)
	return err
}

// DeleteStoragePool 删除存储池（FK 会把引用此池的磁盘 storage_pool_id 置空）。
func (r *Repository) DeleteStoragePool(ctx context.Context, id int) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM storage_pools WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ============================================================================
// 虚拟交换机 CRUD
// ============================================================================

const vswitchColumns = `id, uuid, cluster_id, name, kind, mtu, COALESCE(bond_mode,''), uplink_nics, created_at, updated_at`

func scanVSwitch(s scanner) (*model.VSwitch, error) {
	var (
		v       model.VSwitch
		cluster sql.NullInt64
		uplinks []byte
	)
	if err := s.Scan(&v.ID, &v.UUID, &cluster, &v.Name, &v.Kind, &v.MTU, &v.BondMode, &uplinks,
		&v.CreatedAt, &v.UpdatedAt); err != nil {
		return nil, err
	}
	v.ClusterID = intPtr(cluster)
	_ = scanJSON([]byte(uplinks), &v.UplinkNICs)
	if v.UplinkNICs == nil {
		v.UplinkNICs = []string{}
	}
	return &v, nil
}

// ListVSwitches 列出虚拟交换机。
func (r *Repository) ListVSwitches(ctx context.Context, clusterID int) ([]model.VSwitch, error) {
	q := `SELECT ` + vswitchColumns + ` FROM vswitches`
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
	var out []model.VSwitch
	for rows.Next() {
		v, err := scanVSwitch(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// CreateVSwitch 新建虚拟交换机。
func (r *Repository) CreateVSwitch(ctx context.Context, v *model.VSwitch) (int, error) {
	if v.Kind == "" {
		v.Kind = model.VSwitchBridge
	}
	if v.MTU == 0 {
		v.MTU = 1500
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO vswitches (uuid, cluster_id, name, kind, mtu, bond_mode, uplink_nics)
		 VALUES (?,?,?,?,?,?,?)`,
		newUUIDOr0Str(v.UUID), nullInt(v.ClusterID), v.Name, v.Kind, v.MTU, nullStr(v.BondMode),
		mustJSON(v.UplinkNICs, true))
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return int(id), nil
}

// DeleteVSwitch 删除虚拟交换机（引用它的网络 vswitch_id 会被置空）。
func (r *Repository) DeleteVSwitch(ctx context.Context, id int) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM vswitches WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ============================================================================
// 虚拟网络 CRUD
// ============================================================================

const networkColumns = `id, uuid, cluster_id, vswitch_id, name, mode, COALESCE(bridge_name,''),
	vlan_id, COALESCE(cidr,''), COALESCE(gateway,''), dhcp_enabled, mtu, created_at, updated_at`

func scanNetwork(s scanner) (*model.Network, error) {
	var (
		n        model.Network
		cluster  sql.NullInt64
		vswitch  sql.NullInt64
		vlan     sql.NullInt64
	)
	if err := s.Scan(&n.ID, &n.UUID, &cluster, &vswitch, &n.Name, &n.Mode, &n.BridgeName,
		&vlan, &n.CIDR, &n.Gateway, &n.DHCPEnabled, &n.MTU, &n.CreatedAt, &n.UpdatedAt); err != nil {
		return nil, err
	}
	n.ClusterID = intPtr(cluster)
	n.VSwitchID = intPtr(vswitch)
	n.VLANID = intPtr(vlan)
	return &n, nil
}

// ListNetworks 列出虚拟网络。
func (r *Repository) ListNetworks(ctx context.Context, clusterID int) ([]model.Network, error) {
	q := `SELECT ` + networkColumns + ` FROM networks`
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
	var out []model.Network
	for rows.Next() {
		n, err := scanNetwork(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *n)
	}
	return out, rows.Err()
}

// CreateNetwork 新建虚拟网络。
func (r *Repository) CreateNetwork(ctx context.Context, n *model.Network) (int, error) {
	if n.Mode == "" {
		n.Mode = "bridge"
	}
	if n.MTU == 0 {
		n.MTU = 1500
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO networks (uuid, cluster_id, vswitch_id, name, mode, bridge_name,
			vlan_id, cidr, gateway, dhcp_enabled, mtu)
		 VALUES (?,?,?,?,?,?, ?,?,?,?,?)`,
		newUUIDOr0Str(n.UUID), nullInt(n.ClusterID), nullInt(n.VSwitchID), n.Name, n.Mode, nullStr(n.BridgeName),
		nullInt(n.VLANID), nullStr(n.CIDR), nullStr(n.Gateway), n.DHCPEnabled, n.MTU)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return int(id), nil
}

// DeleteNetwork 删除虚拟网络（引用它的 VM 网卡 network_id 会被置空）。
func (r *Repository) DeleteNetwork(ctx context.Context, id int) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM networks WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
