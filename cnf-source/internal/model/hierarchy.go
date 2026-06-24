// Package model 定义 CNFv1.0 的核心领域模型，对应 PostgreSQL 表结构。
// 资源层级：Datacenter → Cluster → Host → VM。
package model

import (
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// 层级模型
// ============================================================================

// Datacenter 数据中心：资源层级最顶层。
type Datacenter struct {
	ID          int            `json:"id"          db:"id"`
	UUID        uuid.UUID      `json:"uuid"        db:"uuid"`
	Name        string         `json:"name"        db:"name"`
	Location    string         `json:"location"    db:"location"`
	Description string         `json:"description" db:"description"`
	Metadata    map[string]any `json:"metadata"    db:"metadata"`
	CreatedAt   time.Time      `json:"created_at"  db:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"  db:"updated_at"`
}

// Cluster 集群：HA/DRS 边界与资源超分配置。
type Cluster struct {
	ID                int       `json:"id"                 db:"id"`
	UUID              uuid.UUID `json:"uuid"               db:"uuid"`
	DatacenterID      int       `json:"datacenter_id"      db:"datacenter_id"`
	Name              string    `json:"name"               db:"name"`
	Description       string    `json:"description"        db:"description"`
	HAEnabled         bool      `json:"ha_enabled"         db:"ha_enabled"`
	DRSEnabled        bool      `json:"drs_enabled"        db:"drs_enabled"`
	DRSAggressiveness int       `json:"drs_aggressiveness" db:"drs_aggressiveness"`
	OvercommitCPU     float32   `json:"overcommit_cpu"     db:"overcommit_cpu"`
	OvercommitMem     float32   `json:"overcommit_mem"     db:"overcommit_mem"`
	EVCMode           string    `json:"evc_mode"           db:"evc_mode"`
	CreatedAt         time.Time `json:"created_at"         db:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"         db:"updated_at"`
}

// NUMANode 描述宿主机或虚拟机的单个 NUMA 节点。
type NUMANode struct {
	Node     int   `json:"node"`
	CPUs     []int `json:"cpus"`
	MemoryMB int64 `json:"memory_mb"`
}

// HostStatus 宿主机状态。
type HostStatus string

const (
	HostConnected    HostStatus = "connected"
	HostDisconnected HostStatus = "disconnected"
	HostMaintenance  HostStatus = "maintenance"
	HostError        HostStatus = "error"
	HostProvisioning HostStatus = "provisioning"
)

// Host 宿主机：含 CPU 拓扑、NUMA、IOMMU/VFIO 能力。
type Host struct {
	ID                int        `json:"id"                   db:"id"`
	UUID              uuid.UUID  `json:"uuid"                 db:"uuid"`
	ClusterID         int        `json:"cluster_id"           db:"cluster_id"`
	Name              string     `json:"name"                 db:"name"`
	Hostname          string     `json:"hostname"             db:"hostname"`
	IPAddress         string     `json:"ip_address"           db:"ip_address"`
	CPUModel          string     `json:"cpu_model"            db:"cpu_model"`
	CPUSockets        int        `json:"cpu_sockets"          db:"cpu_sockets"`
	CPUCoresPerSocket int        `json:"cpu_cores_per_socket" db:"cpu_cores_per_socket"`
	CPUThreadsPerCore int        `json:"cpu_threads_per_core" db:"cpu_threads_per_core"`
	CPUTotalLogical   int        `json:"cpu_total_logical"    db:"cpu_total_logical"`
	NUMANodes         int        `json:"numa_nodes"           db:"numa_nodes"`
	NUMATopology      []NUMANode `json:"numa_topology"        db:"numa_topology"`
	MemoryTotalMB     int64      `json:"memory_total_mb"      db:"memory_total_mb"`
	MemoryReservedMB  int64      `json:"memory_reserved_mb"   db:"memory_reserved_mb"`
	HugepagesTotal    int        `json:"hugepages_total"      db:"hugepages_total"`
	HugepageSizeKB    int        `json:"hugepage_size_kb"     db:"hugepage_size_kb"`
	LibvirtVersion    string     `json:"libvirt_version"      db:"libvirt_version"`
	QEMUVersion       string     `json:"qemu_version"         db:"qemu_version"`
	IOMMUEnabled      bool       `json:"iommu_enabled"        db:"iommu_enabled"`
	VFIOEnabled       bool       `json:"vfio_enabled"         db:"vfio_enabled"`
	Status            HostStatus `json:"status"               db:"status"`
	MaintenanceMode   bool       `json:"maintenance_mode"     db:"maintenance_mode"`
	LastHeartbeat     *time.Time `json:"last_heartbeat"       db:"last_heartbeat"`
	AgentVersion      string     `json:"agent_version"        db:"agent_version"`
	CreatedAt         time.Time  `json:"created_at"           db:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"           db:"updated_at"`
}
