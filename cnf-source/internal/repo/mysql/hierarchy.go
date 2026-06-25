package mysql

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/cnf/cnfv1/internal/model"
)

// ErrNotFound 资源不存在。
var ErrNotFound = errors.New("资源不存在")

// ============================================================================
// 数据中心 CRUD
// ============================================================================

// DatacenterInput 创建/更新数据中心的入参。
type DatacenterInput struct {
	Name        string         `json:"name"`
	Location    string         `json:"location"`
	Description string         `json:"description"`
	Timezone    string         `json:"timezone"`
	Tags        []string       `json:"tags"`
	Metadata    map[string]any `json:"metadata"`
}

func (in *DatacenterInput) defaults() {
	if in.Timezone == "" {
		in.Timezone = "UTC"
	}
}

const datacenterColumns = `id, uuid, name, COALESCE(location,''), COALESCE(description,''),
	timezone, tags, metadata, created_at, updated_at`

func scanDatacenter(s scanner) (*model.Datacenter, error) {
	var (
		dc      model.Datacenter
		uuidStr string
		tags    sql.RawBytes
		meta    sql.RawBytes
	)
	if err := s.Scan(
		&dc.ID, &uuidStr, &dc.Name, &dc.Location, &dc.Description,
		new(string), &tags, &meta, &dc.CreatedAt, &dc.UpdatedAt,
	); err != nil {
		return nil, err
	}
	dc.UUID = uuidParse(uuidStr)
	_ = scanJSON([]byte(meta), &dc.Metadata)
	if dc.Metadata == nil {
		dc.Metadata = map[string]any{}
	}
	return &dc, nil
}

// GetDatacenter 按 id 查询数据中心。
func (r *Repository) GetDatacenter(ctx context.Context, id int) (*model.Datacenter, error) {
	dc, err := scanDatacenter(r.db.QueryRowContext(ctx,
		`SELECT `+datacenterColumns+` FROM datacenters WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return dc, err
}

// ListDatacenters 列出全部数据中心。
func (r *Repository) ListDatacenters(ctx context.Context) ([]model.Datacenter, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+datacenterColumns+` FROM datacenters ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Datacenter
	for rows.Next() {
		dc, err := scanDatacenter(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *dc)
	}
	return out, rows.Err()
}

// CreateDatacenter 新建数据中心，返回完整记录。
func (r *Repository) CreateDatacenter(ctx context.Context, in DatacenterInput) (*model.Datacenter, error) {
	in.defaults()
	const q = `INSERT INTO datacenters (uuid, name, location, description, timezone, tags, metadata)
		VALUES (?,?,?,?,?,?,?)`
	res, err := r.db.ExecContext(ctx, q,
		newUUIDOr(model.Datacenter{}.UUID),
		in.Name, nullStr(in.Location), nullStr(in.Description), in.Timezone,
		mustJSON(in.Tags, true), mustJSON(in.Metadata, false),
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return r.GetDatacenter(ctx, int(id))
}

// UpdateDatacenter 更新数据中心。
func (r *Repository) UpdateDatacenter(ctx context.Context, id int, in DatacenterInput) (*model.Datacenter, error) {
	in.defaults()
	const q = `UPDATE datacenters SET
		name=?, location=?, description=?, timezone=?, tags=?, metadata=?
		WHERE id=?`
	res, err := r.db.ExecContext(ctx, q,
		in.Name, nullStr(in.Location), nullStr(in.Description), in.Timezone,
		mustJSON(in.Tags, true), mustJSON(in.Metadata, false), id,
	)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		if _, err := r.GetDatacenter(ctx, id); err != nil {
			return nil, err
		}
	}
	return r.GetDatacenter(ctx, id)
}

// DeleteDatacenter 删除数据中心；存在下级集群时返回 ErrHasChildren。
func (r *Repository) DeleteDatacenter(ctx context.Context, id int) error {
	var n int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM clusters WHERE datacenter_id=?`, id).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return ErrHasChildren
	}
	res, err := r.db.ExecContext(ctx, `DELETE FROM datacenters WHERE id=?`, id)
	if err != nil {
		return err
	}
	if c, _ := res.RowsAffected(); c == 0 {
		return ErrNotFound
	}
	return nil
}

// ============================================================================
// 集群 CRUD（ClusterExt 在 model.Cluster 之外扩展 NTP 时钟基线字段）
// ============================================================================

// ClusterExt 在领域模型 Cluster 基础上扩展 NTP 时钟同步字段，
// 因为 HA 选主与在线迁移要求集群内各主机时钟一致。
type ClusterExt struct {
	model.Cluster
	NTPMode          string   `json:"ntp_mode"`            // internal | external
	NTPInternalServer string  `json:"ntp_internal_server"` // ntp_mode=internal 时指定内部 NTP 服务器
	NTPServers       []string `json:"ntp_servers"`         // ntp_mode=external 时的上游 NTP 列表
	MaxClockOffsetMS int      `json:"max_clock_offset_ms"` // 允许的最大时钟偏移（毫秒）
}

// ClusterInput 创建/更新集群的入参。
type ClusterInput struct {
	DatacenterID      int      `json:"datacenter_id"`
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	HAEnabled         bool     `json:"ha_enabled"`
	DRSEnabled        bool     `json:"drs_enabled"`
	DRSAggressiveness int      `json:"drs_aggressiveness"`
	OvercommitCPU     float32  `json:"overcommit_cpu"`
	OvercommitMem     float32  `json:"overcommit_mem"`
	EVCMode           string   `json:"evc_mode"`
	NTPMode           string   `json:"ntp_mode"`
	NTPInternalServer string   `json:"ntp_internal_server"`
	NTPServers        []string `json:"ntp_servers"`
	MaxClockOffsetMS  int      `json:"max_clock_offset_ms"`
}

func (in *ClusterInput) defaults() {
	if in.DRSAggressiveness <= 0 {
		in.DRSAggressiveness = 3
	}
	if in.OvercommitCPU <= 0 {
		in.OvercommitCPU = 4.0
	}
	if in.OvercommitMem <= 0 {
		in.OvercommitMem = 1.0
	}
	if in.NTPMode == "" {
		in.NTPMode = "external"
	}
	if in.MaxClockOffsetMS <= 0 {
		in.MaxClockOffsetMS = 2000
	}
}

const clusterColumns = `id, uuid, datacenter_id, name, COALESCE(description,''),
	ha_enabled, drs_enabled, drs_aggressiveness, overcommit_cpu, overcommit_mem,
	COALESCE(evc_mode,''), ntp_mode, COALESCE(ntp_internal_server,''), ntp_servers,
	max_clock_offset_ms, created_at, updated_at`

func scanCluster(s scanner) (*ClusterExt, error) {
	var (
		c          ClusterExt
		uuidStr    string
		ntpServers sql.RawBytes
	)
	if err := s.Scan(
		&c.ID, &uuidStr, &c.DatacenterID, &c.Name, &c.Description,
		&c.HAEnabled, &c.DRSEnabled, &c.DRSAggressiveness, &c.OvercommitCPU, &c.OvercommitMem,
		&c.EVCMode, &c.NTPMode, &c.NTPInternalServer, &ntpServers,
		&c.MaxClockOffsetMS, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}
	c.UUID = uuidParse(uuidStr)
	_ = scanJSON([]byte(ntpServers), &c.NTPServers)
	if c.NTPServers == nil {
		c.NTPServers = []string{}
	}
	return &c, nil
}

// GetCluster 按 id 查询集群（含 NTP 扩展）。
func (r *Repository) GetCluster(ctx context.Context, id int) (*ClusterExt, error) {
	c, err := scanCluster(r.db.QueryRowContext(ctx,
		`SELECT `+clusterColumns+` FROM clusters WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// ListClusters 列出集群；datacenterID>0 时按数据中心过滤。
func (r *Repository) ListClusters(ctx context.Context, datacenterID int) ([]ClusterExt, error) {
	q := `SELECT ` + clusterColumns + ` FROM clusters`
	args := []any{}
	if datacenterID > 0 {
		q += ` WHERE datacenter_id=?`
		args = append(args, datacenterID)
	}
	q += ` ORDER BY id`
	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClusterExt
	for rows.Next() {
		c, err := scanCluster(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// CreateCluster 新建集群，返回完整记录。
func (r *Repository) CreateCluster(ctx context.Context, in ClusterInput) (*ClusterExt, error) {
	in.defaults()
	const q = `INSERT INTO clusters (
		uuid, datacenter_id, name, description,
		ha_enabled, drs_enabled, drs_aggressiveness, overcommit_cpu, overcommit_mem, evc_mode,
		ntp_mode, ntp_internal_server, ntp_servers, max_clock_offset_ms
	) VALUES (?,?,?,?, ?,?,?,?,?,?, ?,?,?,?)`
	res, err := r.db.ExecContext(ctx, q,
		newUUIDOr(model.Cluster{}.UUID), in.DatacenterID, in.Name, nullStr(in.Description),
		in.HAEnabled, in.DRSEnabled, in.DRSAggressiveness, in.OvercommitCPU, in.OvercommitMem, nullStr(in.EVCMode),
		in.NTPMode, nullStr(in.NTPInternalServer), mustJSON(in.NTPServers, true), in.MaxClockOffsetMS,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return r.GetCluster(ctx, int(id))
}

// UpdateCluster 更新集群。
func (r *Repository) UpdateCluster(ctx context.Context, id int, in ClusterInput) (*ClusterExt, error) {
	in.defaults()
	const q = `UPDATE clusters SET
		name=?, description=?,
		ha_enabled=?, drs_enabled=?, drs_aggressiveness=?, overcommit_cpu=?, overcommit_mem=?, evc_mode=?,
		ntp_mode=?, ntp_internal_server=?, ntp_servers=?, max_clock_offset_ms=?
		WHERE id=?`
	res, err := r.db.ExecContext(ctx, q,
		in.Name, nullStr(in.Description),
		in.HAEnabled, in.DRSEnabled, in.DRSAggressiveness, in.OvercommitCPU, in.OvercommitMem, nullStr(in.EVCMode),
		in.NTPMode, nullStr(in.NTPInternalServer), mustJSON(in.NTPServers, true), in.MaxClockOffsetMS, id,
	)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		if _, err := r.GetCluster(ctx, id); err != nil {
			return nil, err
		}
	}
	return r.GetCluster(ctx, id)
}

// DeleteCluster 删除集群；存在下级宿主机时返回 ErrHasChildren。
func (r *Repository) DeleteCluster(ctx context.Context, id int) error {
	var n int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM hosts WHERE cluster_id=?`, id).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return ErrHasChildren
	}
	res, err := r.db.ExecContext(ctx, `DELETE FROM clusters WHERE id=?`, id)
	if err != nil {
		return err
	}
	if c, _ := res.RowsAffected(); c == 0 {
		return ErrNotFound
	}
	return nil
}

// ============================================================================
// 宿主机：删除 / 维护模式 / 硬件清单
// ============================================================================

// DeleteHost 删除宿主机；存在运行中的 VM 时返回 ErrHasChildren。
func (r *Repository) DeleteHost(ctx context.Context, id int) error {
	var n int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM vms WHERE host_id=?`, id).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return ErrHasChildren
	}
	res, err := r.db.ExecContext(ctx, `DELETE FROM hosts WHERE id=?`, id)
	if err != nil {
		return err
	}
	if c, _ := res.RowsAffected(); c == 0 {
		return ErrNotFound
	}
	return nil
}

// SetHostMaintenance 进入/退出维护模式，同步更新状态。
func (r *Repository) SetHostMaintenance(ctx context.Context, id int, enabled bool) error {
	status := model.HostConnected
	if enabled {
		status = model.HostMaintenance
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE hosts SET maintenance_mode=?, status=? WHERE id=?`,
		enabled, status, id)
	if err != nil {
		return err
	}
	if c, _ := res.RowsAffected(); c == 0 {
		if _, err := r.GetHost(ctx, id); err != nil {
			return ErrNotFound
		}
	}
	return nil
}

// UpdateHostStatus 更新宿主机连接状态与心跳。
func (r *Repository) UpdateHostStatus(ctx context.Context, id int, status model.HostStatus) error {
	now := time.Now()
	_, err := r.db.ExecContext(ctx,
		`UPDATE hosts SET status=?, last_heartbeat=? WHERE id=?`,
		status, now, id)
	return err
}

// SaveHostHardware 保存无代理纳管时 SSH 采集到的真实硬件清单与 OS 版本。
func (r *Repository) SaveHostHardware(ctx context.Context, id int, inventory map[string]any, osVersion string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE hosts SET hardware_inventory=?, os_version=? WHERE id=?`,
		mustJSON(inventory, false), nullStr(osVersion), id)
	if err != nil {
		return err
	}
	if c, _ := res.RowsAffected(); c == 0 {
		if _, err := r.GetHost(ctx, id); err != nil {
			return ErrNotFound
		}
	}
	return nil
}

// LoadHostHardware 读取宿主机硬件清单与 OS 版本。
func (r *Repository) LoadHostHardware(ctx context.Context, id int) (map[string]any, string, error) {
	var (
		inv sql.RawBytes
		os  sql.NullString
	)
	err := r.db.QueryRowContext(ctx,
		`SELECT hardware_inventory, os_version FROM hosts WHERE id=?`, id).Scan(&inv, &os)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	inventory := map[string]any{}
	_ = scanJSON([]byte(inv), &inventory)
	return inventory, os.String, nil
}
