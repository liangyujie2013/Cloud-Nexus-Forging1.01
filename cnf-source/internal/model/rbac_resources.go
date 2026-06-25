package model

import "time"

// ============================================================================
// RBAC：角色 / 用户
// ============================================================================

// Role 角色：权限点集合。permissions 为 resource.action 字符串数组，
// 单个元素 "*" 表示超级权限（放行一切）。
type Role struct {
	ID          int       `json:"id"          db:"id"`
	Name        string    `json:"name"        db:"name"`
	Description string    `json:"description" db:"description"`
	Permissions []string  `json:"permissions" db:"-"`
	IsBuiltin   bool      `json:"is_builtin"  db:"is_builtin"`
	CreatedAt   time.Time `json:"created_at"  db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"  db:"updated_at"`
}

// HasPermission 判断角色是否拥有指定权限点。
// 规则：包含 "*" → 全部放行；包含 "resource.*" → 该资源全部动作放行；精确匹配。
func (r *Role) HasPermission(point string) bool {
	for _, p := range r.Permissions {
		if p == "*" || p == point {
			return true
		}
		// resource.* 通配
		if len(p) > 2 && p[len(p)-2:] == ".*" {
			prefix := p[:len(p)-1] // 保留到 "resource."
			if len(point) >= len(prefix) && point[:len(prefix)] == prefix {
				return true
			}
		}
	}
	return false
}

// User 用户账户。PasswordHash 仅服务端使用，绝不出现在 JSON 响应。
type User struct {
	ID           int        `json:"id"           db:"id"`
	Username     string     `json:"username"     db:"username"`
	DisplayName  string     `json:"display_name" db:"display_name"`
	Email        string     `json:"email"        db:"email"`
	PasswordHash string     `json:"-"            db:"password_hash"`
	RoleID       *int       `json:"role_id"      db:"role_id"`
	Role         string     `json:"role"         db:"role"`
	Enabled      bool       `json:"enabled"      db:"enabled"`
	LastLogin    *time.Time `json:"last_login"   db:"last_login"`
	CreatedAt    time.Time  `json:"created_at"   db:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"   db:"updated_at"`
}

// ============================================================================
// 存储池
// ============================================================================

// StoragePoolType 存储池后端类型。
type StoragePoolType string

const (
	PoolLocal       StoragePoolType = "local"
	PoolNFS         StoragePoolType = "nfs"
	PoolISCSI       StoragePoolType = "iscsi"
	PoolFC          StoragePoolType = "fc"
	PoolNVMeOF      StoragePoolType = "nvmeof"
	PoolCeph        StoragePoolType = "ceph"
	PoolDistributed StoragePoolType = "distributed"
)

// StoragePool 存储池：local 属于单主机，其余可被集群共享。
type StoragePool struct {
	ID             int             `json:"id"              db:"id"`
	UUID           string          `json:"uuid"            db:"uuid"`
	ClusterID      *int            `json:"cluster_id"      db:"cluster_id"`
	HostID         *int            `json:"host_id"         db:"host_id"`
	Name           string          `json:"name"            db:"name"`
	Type           StoragePoolType `json:"type"            db:"type"`
	Config         map[string]any  `json:"config"          db:"-"`
	TargetPath     string          `json:"target_path"     db:"target_path"`
	SourcePath     string          `json:"source_path"     db:"source_path"`
	CapacityBytes  int64           `json:"capacity_bytes"  db:"capacity_bytes"`
	AllocatedBytes int64           `json:"allocated_bytes" db:"allocated_bytes"`
	AvailableBytes int64           `json:"available_bytes" db:"available_bytes"`
	IsShared       bool            `json:"is_shared"       db:"is_shared"`
	Status         string          `json:"status"          db:"status"`
	CreatedAt      time.Time       `json:"created_at"      db:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"      db:"updated_at"`
}

// ============================================================================
// 网络：虚拟交换机 / 虚拟网络
// ============================================================================

// VSwitchKind 交换机类型。
type VSwitchKind string

const (
	VSwitchBridge      VSwitchKind = "bridge"
	VSwitchDistributed VSwitchKind = "distributed"
)

// VSwitch 虚拟交换机：Linux bridge 或分布式交换机，支持 bond / MTU / 上联网卡。
type VSwitch struct {
	ID         int         `json:"id"          db:"id"`
	UUID       string      `json:"uuid"        db:"uuid"`
	ClusterID  *int        `json:"cluster_id"  db:"cluster_id"`
	Name       string      `json:"name"        db:"name"`
	Kind       VSwitchKind `json:"kind"        db:"kind"`
	MTU        int         `json:"mtu"         db:"mtu"`
	BondMode   string      `json:"bond_mode"   db:"bond_mode"`
	UplinkNICs []string    `json:"uplink_nics" db:"-"`
	CreatedAt  time.Time   `json:"created_at"  db:"created_at"`
	UpdatedAt  time.Time   `json:"updated_at"  db:"updated_at"`
}

// Network 虚拟网络：挂载到 vSwitch，含 VLAN / DHCP / MTU。
type Network struct {
	ID          int       `json:"id"           db:"id"`
	UUID        string    `json:"uuid"         db:"uuid"`
	ClusterID   *int      `json:"cluster_id"   db:"cluster_id"`
	VSwitchID   *int      `json:"vswitch_id"   db:"vswitch_id"`
	Name        string    `json:"name"         db:"name"`
	Mode        string    `json:"mode"         db:"mode"`
	BridgeName  string    `json:"bridge_name"  db:"bridge_name"`
	VLANID      *int      `json:"vlan_id"      db:"vlan_id"`
	CIDR        string    `json:"cidr"         db:"cidr"`
	Gateway     string    `json:"gateway"      db:"gateway"`
	DHCPEnabled bool      `json:"dhcp_enabled" db:"dhcp_enabled"`
	MTU         int       `json:"mtu"          db:"mtu"`
	CreatedAt   time.Time `json:"created_at"   db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"   db:"updated_at"`
}

// ============================================================================
// 监控：告警规则 / 指标采样 / 审计日志
// ============================================================================

// AlertSeverity 告警级别。
type AlertSeverity string

const (
	AlertInfo     AlertSeverity = "info"
	AlertWarning  AlertSeverity = "warning"
	AlertCritical AlertSeverity = "critical"
)

// AlertRule 告警规则：当 metric operator threshold 持续 duration 秒触发。
type AlertRule struct {
	ID              int           `json:"id"               db:"id"`
	Name            string        `json:"name"             db:"name"`
	Metric          string        `json:"metric"           db:"metric"`
	Operator        string        `json:"operator"         db:"operator"`
	Threshold       float64       `json:"threshold"        db:"threshold"`
	DurationSeconds int           `json:"duration_seconds" db:"duration_seconds"`
	Severity        AlertSeverity `json:"severity"         db:"severity"`
	NotifyChannel   string        `json:"notify_channel"   db:"notify_channel"`
	Enabled         bool          `json:"enabled"          db:"enabled"`
	CreatedAt       time.Time     `json:"created_at"       db:"created_at"`
	UpdatedAt       time.Time     `json:"updated_at"       db:"updated_at"`
}

// MetricSample 指标采样点（历史趋势）。
type MetricSample struct {
	ID         int64     `json:"id"          db:"id"`
	TargetType string    `json:"target_type" db:"target_type"`
	TargetKey  string    `json:"target_key"  db:"target_key"`
	Metric     string    `json:"metric"      db:"metric"`
	Value      float64   `json:"value"       db:"value"`
	SampledAt  time.Time `json:"sampled_at"  db:"sampled_at"`
}

// AuditLog 审计日志条目。
type AuditLog struct {
	ID         int64          `json:"id"          db:"id"`
	UserID     *int           `json:"user_id"     db:"user_id"`
	Username   string         `json:"username"    db:"username"`
	Action     string         `json:"action"      db:"action"`
	Resource   string         `json:"resource"    db:"resource"`
	ResourceID *int           `json:"resource_id" db:"resource_id"`
	Detail     map[string]any `json:"detail"      db:"-"`
	IPAddress  string         `json:"ip_address"  db:"ip_address"`
	CreatedAt  time.Time      `json:"created_at"  db:"created_at"`
}
