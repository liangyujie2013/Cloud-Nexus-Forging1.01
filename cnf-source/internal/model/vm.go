package model

import (
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// 虚拟机及其子资源
// ============================================================================

// VMStatus 虚拟机状态。
type VMStatus string

const (
	VMStopped   VMStatus = "stopped"
	VMStarting  VMStatus = "starting"
	VMRunning   VMStatus = "running"
	VMPaused    VMStatus = "paused"
	VMSuspended VMStatus = "suspended"
	VMMigrating VMStatus = "migrating"
	VMError     VMStatus = "error"
	VMDeleting  VMStatus = "deleting"
)

// CPUPin 表示单条 vCPU→pCPU 绑定关系。
type CPUPin struct {
	VCPU int `json:"vcpu"`
	PCPU int `json:"pcpu"`
}

// VMCPUConfig 高级 CPU 配置（核心差异化）。
type VMCPUConfig struct {
	Sockets          int      `json:"sockets"`            // CPU 插槽数
	CoresPerSocket   int      `json:"cores_per_socket"`   // 每插槽核心数
	ThreadsPerCore   int      `json:"threads_per_core"`   // 每核心线程数
	Model            string   `json:"model"`              // host-passthrough / host-model / 具名
	CPUPinning       bool     `json:"cpu_pinning"`        // 是否启用绑核
	PinnedMap        []CPUPin `json:"pinned_map"`         // vCPU→pCPU 精确映射
	PinnedCPUs       []int    `json:"pinned_cpus"`        // 兼容：物理 CPU ID 列表
	NUMANodeAffinity int      `json:"numa_node_affinity"` // NUMA 节点亲和性，-1 不绑定
	Shares           int      `json:"shares"`             // CPU 权重
	Quota            int      `json:"quota"`              // CFS quota，-1 不限制
}

// VCPUs 返回总 vCPU 数。
func (c VMCPUConfig) VCPUs() int {
	if c.Sockets <= 0 || c.CoresPerSocket <= 0 || c.ThreadsPerCore <= 0 {
		return 0
	}
	return c.Sockets * c.CoresPerSocket * c.ThreadsPerCore
}

// BootMode 引导模式。
type BootMode string

const (
	BootBIOS       BootMode = "bios"
	BootUEFI       BootMode = "uefi"
	BootUEFISecure BootMode = "uefi_secure"
)

// VM 虚拟机：完整 CPU 拓扑/绑核/NUMA 亲和/引导配置。
type VM struct {
	ID          int        `json:"id"           db:"id"`
	UUID        uuid.UUID  `json:"uuid"         db:"uuid"`
	HostID      *int       `json:"host_id"      db:"host_id"`
	ClusterID   int        `json:"cluster_id"   db:"cluster_id"`
	Name        string     `json:"name"         db:"name"`
	Description string     `json:"description"  db:"description"`
	LibvirtUUID *uuid.UUID `json:"libvirt_uuid" db:"libvirt_uuid"`

	// CPU 配置（展开存储，便于 SQL 索引；对外用 CPUConfig() 聚合）
	CPUSockets        int        `json:"cpu_sockets"          db:"cpu_sockets"`
	CPUCoresPerSocket int        `json:"cpu_cores_per_socket" db:"cpu_cores_per_socket"`
	CPUThreadsPerCore int        `json:"cpu_threads_per_core" db:"cpu_threads_per_core"`
	VCPUs             int        `json:"vcpus"                db:"vcpus"`
	CPUModel          string     `json:"cpu_model"            db:"cpu_model"`
	CPUPinning        bool       `json:"cpu_pinning"          db:"cpu_pinning"`
	CPUPinnedMap      []CPUPin   `json:"cpu_pinned_map"       db:"cpu_pinned_map"`
	CPUPinnedCPUs     []int      `json:"cpu_pinned_cpus"      db:"cpu_pinned_cpus"`
	NUMANodeAffinity  int        `json:"numa_node_affinity"   db:"numa_node_affinity"`
	NUMATopology      []NUMANode `json:"numa_topology"      db:"numa_topology"`
	CPUShares         int        `json:"cpu_shares"           db:"cpu_shares"`
	CPUQuota          int        `json:"cpu_quota"            db:"cpu_quota"`

	// 内存
	MemoryMB         int  `json:"memory_mb"         db:"memory_mb"`
	MemoryMaxMB      int  `json:"memory_max_mb"     db:"memory_max_mb"`
	HugepagesEnabled bool `json:"hugepages_enabled" db:"hugepages_enabled"`
	MemoryBalloon    bool `json:"memory_balloon"    db:"memory_balloon"`

	// 引导
	Arch        string   `json:"arch"         db:"arch"`
	MachineType string   `json:"machine_type" db:"machine_type"`
	BootMode    BootMode `json:"boot_mode"    db:"boot_mode"`
	BootOrder   []string `json:"boot_order"   db:"boot_order"`
	NVRAMPath   string   `json:"nvram_path"   db:"nvram_path"`

	// 状态与策略
	Status          VMStatus `json:"status"            db:"status"`
	HAEnabled       bool     `json:"ha_enabled"        db:"ha_enabled"`
	HAPriority      int      `json:"ha_priority"       db:"ha_priority"`
	AutoStart       bool     `json:"auto_start"        db:"auto_start"`
	GuestOS         string   `json:"guest_os"          db:"guest_os"`
	GuestAgentReady bool     `json:"guest_agent_ready" db:"guest_agent_ready"`
	VNCPort         int      `json:"vnc_port"          db:"vnc_port"`
	VNCPassword     string   `json:"-"                 db:"vnc_password"`

	// 关联子资源（查询时填充，非数据库列）
	Disks []VMDisk    `json:"disks,omitempty" db:"-"`
	NICs  []VMNic     `json:"nics,omitempty"  db:"-"`
	GPUs  []GPUDevice `json:"gpus,omitempty" db:"-"`

	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// CPUConfig 聚合返回 VMCPUConfig，便于传递给 XML 生成器。
func (v *VM) CPUConfig() VMCPUConfig {
	return VMCPUConfig{
		Sockets:          v.CPUSockets,
		CoresPerSocket:   v.CPUCoresPerSocket,
		ThreadsPerCore:   v.CPUThreadsPerCore,
		Model:            v.CPUModel,
		CPUPinning:       v.CPUPinning,
		PinnedMap:        v.CPUPinnedMap,
		PinnedCPUs:       v.CPUPinnedCPUs,
		NUMANodeAffinity: v.NUMANodeAffinity,
		Shares:           v.CPUShares,
		Quota:            v.CPUQuota,
	}
}

// VMDisk 虚拟机磁盘。
type VMDisk struct {
	ID            int       `json:"id"             db:"id"`
	UUID          uuid.UUID `json:"uuid"           db:"uuid"`
	VMID          int       `json:"vm_id"          db:"vm_id"`
	StoragePoolID *int      `json:"storage_pool_id" db:"storage_pool_id"`
	Name          string    `json:"name"           db:"name"`
	Device        string    `json:"device"         db:"device"`
	Bus           string    `json:"bus"            db:"bus"`
	Format        string    `json:"format"         db:"format"`
	Path          string    `json:"path"           db:"path"`
	SizeBytes     int64     `json:"size_bytes"     db:"size_bytes"`
	Bootable      bool      `json:"bootable"       db:"bootable"`
	ReadOnly      bool      `json:"readonly"       db:"readonly"`
	IOPSLimit     int       `json:"iops_limit"     db:"iops_limit"`
	BPSLimit      int64     `json:"bps_limit"      db:"bps_limit"`
	BackingFile   string    `json:"backing_file"   db:"backing_file"`
	BootOrder     *int      `json:"boot_order"     db:"boot_order"`
}

// VMNic 虚拟机网卡。
type VMNic struct {
	ID           int       `json:"id"            db:"id"`
	UUID         uuid.UUID `json:"uuid"          db:"uuid"`
	VMID         int       `json:"vm_id"         db:"vm_id"`
	NetworkID    *int      `json:"network_id"    db:"network_id"`
	MACAddress   string    `json:"mac_address"   db:"mac_address"`
	Model        string    `json:"model"         db:"model"`
	IPAddress    string    `json:"ip_address"    db:"ip_address"`
	InboundKbps  int       `json:"inbound_kbps"  db:"inbound_kbps"`
	OutboundKbps int       `json:"outbound_kbps" db:"outbound_kbps"`
	SRIOVVf      string    `json:"sriov_vf"      db:"sriov_vf"`
	OrderIndex   int       `json:"order_index"   db:"order_index"`
	// 网络运行时信息（XML 生成需要）
	BridgeName string `json:"bridge_name" db:"-"`
	VLANID     int    `json:"vlan_id"     db:"-"`
}

// GPUMode GPU 工作模式。
type GPUMode string

const (
	GPUPassthrough GPUMode = "passthrough"
	GPUVGPU        GPUMode = "vgpu"
	GPUMdev        GPUMode = "mdev"
	GPUNone        GPUMode = "none"
)

// GPUDevice GPU 设备：PCI 直通 / vGPU(mdev)。
type GPUDevice struct {
	ID           int       `json:"id"            db:"id"`
	UUID         uuid.UUID `json:"uuid"          db:"uuid"`
	HostID       int       `json:"host_id"       db:"host_id"`
	PCIAddress   string    `json:"pci_address"   db:"pci_address"`
	IOMMUGroup   int       `json:"iommu_group"   db:"iommu_group"`
	Vendor       string    `json:"vendor"        db:"vendor"`
	VendorID     string    `json:"vendor_id"     db:"vendor_id"`
	DeviceID     string    `json:"device_id"     db:"device_id"`
	Model        string    `json:"model"         db:"model"`
	VRAMMb       int       `json:"vram_mb"       db:"vram_mb"`
	Mode         GPUMode   `json:"mode"          db:"mode"`
	MdevType     string    `json:"mdev_type"     db:"mdev_type"`
	MaxInstances int       `json:"max_instances" db:"max_instances"`
	Status       string    `json:"status"        db:"status"`
	NUMANode     int       `json:"numa_node"     db:"numa_node"`
	// 运行时分配给 VM 时填充
	MdevUUID *uuid.UUID `json:"mdev_uuid,omitempty" db:"-"`
}
