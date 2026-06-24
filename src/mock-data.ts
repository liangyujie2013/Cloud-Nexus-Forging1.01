// =============================================================================
//  Cloud Nexus Forging (CNF) v1.0.1 — 路径B 原型模拟数据集
//  企业级分布式虚拟化管理平台，按 9 模块组织。
//  9 模块：仪表板 / 基础设施 / 计算资源 / 可用性管理 / 存储管理 /
//         网络管理 / 监控告警 / 访问控制 / 系统设置。
// =============================================================================
export const mockData = {
  // ===================== 基础设施 · 数据中心（层级根）=====================
  // 注：clusters/hosts/vms 字段为「实时聚合派生值」，由后端 datacenterStats 计算覆盖，此处仅为默认占位。
  datacenters: [
    { id: 1, name: '北京一区 (DC-Beijing-01)', location: '北京·亦庄', timezone: 'Asia/Shanghai', description: '华北主数据中心', status: 'online', created_at: '2026-01-15T08:00:00Z', clusters: 2, hosts: 6, vms: 7 },
    { id: 2, name: '上海二区 (DC-Shanghai-02)', location: '上海·临港', timezone: 'Asia/Shanghai', description: '华东备份数据中心', status: 'online', created_at: '2026-02-20T08:00:00Z', clusters: 1, hosts: 0, vms: 0 },
  ],
  // ===================== 基础设施 · 集群（归属数据中心）=====================
  clusters: [
    { id: 1, datacenter_id: 1, name: '生产集群 Prod-A', description: '核心业务生产集群', ha_enabled: true, drs_enabled: true, overcommit_cpu: 4.0, status: 'healthy', created_at: '2026-01-16T08:00:00Z', hosts: 4, vms: 28, evc_mode: 'CPU 基线 Gen3' },
    { id: 2, datacenter_id: 1, name: 'GPU 计算集群 GPU-Compute', description: 'AI 训练 / 推理 GPU 集群', ha_enabled: true, drs_enabled: false, overcommit_cpu: 1.0, status: 'healthy', created_at: '2026-01-17T08:00:00Z', hosts: 2, vms: 10, evc_mode: 'CPU 基线 Gen4' },
    { id: 3, datacenter_id: 2, name: '测试集群 Test-B', description: '开发测试沙箱集群', ha_enabled: false, drs_enabled: false, overcommit_cpu: 8.0, status: 'healthy', created_at: '2026-02-21T08:00:00Z', hosts: 0, vms: 0, evc_mode: '-' },
  ],
  // ===================== 基础设施 · 宿主机（归属集群，冗余 datacenter_id）=====================
  // 硬件型号（CPU / 网卡 NIC / RAID 卡 / 硬盘）均为真实环境型号。
  hosts: [
    { id: 1, cluster_id: 1, datacenter_id: 1, name: 'node-prod-01', hostname: 'node-prod-01', ip: '192.168.1.100', ssh_port: 22, ssh_user: 'root', status: 'connected', maintenance_mode: false, cpu_model: 'Intel Xeon Gold 6248R', sockets: 2, cores: 24, threads: 2, vcpus: 96, numa_nodes: 2, mem_total_gb: 512, mem_used_gb: 318, cpu_usage: 62, mem_usage: 62, vms: 2, gpus: 0, iommu: true, nic_model: 'Intel X710-DA2 (2×10GbE)', raid_model: 'Broadcom MegaRAID 9560-8i', disk_model: 'Samsung PM9A3 1.92TB NVMe', last_heartbeat: '2026-06-24T09:30:00Z', created_at: '2026-01-16T09:00:00Z' },
    { id: 2, cluster_id: 1, datacenter_id: 1, name: 'node-prod-02', hostname: 'node-prod-02', ip: '192.168.1.101', ssh_port: 22, ssh_user: 'root', status: 'connected', maintenance_mode: false, cpu_model: 'Intel Xeon Gold 6248R', sockets: 2, cores: 24, threads: 2, vcpus: 96, numa_nodes: 2, mem_total_gb: 512, mem_used_gb: 276, cpu_usage: 48, mem_usage: 54, vms: 2, gpus: 0, iommu: true, nic_model: 'Intel X710-DA2 (2×10GbE)', raid_model: 'Broadcom MegaRAID 9560-8i', disk_model: 'Samsung PM9A3 1.92TB NVMe', last_heartbeat: '2026-06-24T09:30:00Z', created_at: '2026-01-16T09:30:00Z' },
    { id: 3, cluster_id: 1, datacenter_id: 1, name: 'node-prod-03', hostname: 'node-prod-03', ip: '192.168.1.102', ssh_port: 22, ssh_user: 'root', status: 'connected', maintenance_mode: false, cpu_model: 'Intel Xeon Gold 6248R', sockets: 2, cores: 24, threads: 2, vcpus: 96, numa_nodes: 2, mem_total_gb: 512, mem_used_gb: 401, cpu_usage: 78, mem_usage: 78, vms: 1, gpus: 0, iommu: true, nic_model: 'Intel X710-DA2 (2×10GbE)', raid_model: 'Broadcom MegaRAID 9560-8i', disk_model: 'Samsung PM9A3 1.92TB NVMe', last_heartbeat: '2026-06-24T09:30:00Z', created_at: '2026-01-16T10:00:00Z' },
    { id: 4, cluster_id: 1, datacenter_id: 1, name: 'node-prod-04', hostname: 'node-prod-04', ip: '192.168.1.103', ssh_port: 22, ssh_user: 'root', status: 'maintenance', maintenance_mode: true, cpu_model: 'Intel Xeon Gold 6248R', sockets: 2, cores: 24, threads: 2, vcpus: 96, numa_nodes: 2, mem_total_gb: 512, mem_used_gb: 0, cpu_usage: 0, mem_usage: 0, vms: 0, gpus: 0, iommu: true, nic_model: 'Intel X710-DA2 (2×10GbE)', raid_model: 'Broadcom MegaRAID 9560-8i', disk_model: 'Samsung PM9A3 1.92TB NVMe', last_heartbeat: '2026-06-24T08:10:00Z', created_at: '2026-01-16T10:30:00Z' },
    { id: 5, cluster_id: 2, datacenter_id: 1, name: 'gpu-node-01', hostname: 'gpu-node-01', ip: '192.168.2.110', ssh_port: 22, ssh_user: 'root', status: 'connected', maintenance_mode: false, cpu_model: 'Intel Xeon Platinum 8358', sockets: 2, cores: 32, threads: 2, vcpus: 128, numa_nodes: 2, mem_total_gb: 1024, mem_used_gb: 612, cpu_usage: 55, mem_usage: 60, vms: 2, gpus: 4, iommu: true, nic_model: 'Mellanox ConnectX-6 Dx (2×100GbE)', raid_model: 'Broadcom MegaRAID 9560-16i', disk_model: 'Intel D7-P5520 3.84TB NVMe', last_heartbeat: '2026-06-24T09:30:00Z', created_at: '2026-01-18T09:00:00Z' },
    { id: 6, cluster_id: 2, datacenter_id: 1, name: 'gpu-node-02', hostname: 'gpu-node-02', ip: '192.168.2.111', ssh_port: 22, ssh_user: 'root', status: 'connected', maintenance_mode: false, cpu_model: 'Intel Xeon Platinum 8358', sockets: 2, cores: 32, threads: 2, vcpus: 128, numa_nodes: 2, mem_total_gb: 1024, mem_used_gb: 720, cpu_usage: 71, mem_usage: 70, vms: 1, gpus: 4, iommu: true, nic_model: 'Mellanox ConnectX-6 Dx (2×100GbE)', raid_model: 'Broadcom MegaRAID 9560-16i', disk_model: 'Intel D7-P5520 3.84TB NVMe', last_heartbeat: '2026-06-24T09:30:00Z', created_at: '2026-01-18T09:30:00Z' },
  ],
  // ===================== 计算资源 · 虚拟机（归属主机，冗余 cluster_id / datacenter_id）=====================
  vms: [
    { id: 1, host_id: 1, cluster_id: 1, datacenter_id: 1, name: 'web-prod-01', status: 'running', vcpus: 8, sockets: 2, cores: 2, threads: 2, mem_gb: 16, mem_mb: 16384, cpu_pinning: true, numa: 0, os: 'Rocky Linux 9', ha: true, gpus: 0, ip: '10.10.1.21', cpu_usage: 34, mem_usage: 58, created_at: '2026-01-20T08:00:00Z' },
    { id: 2, host_id: 1, cluster_id: 1, datacenter_id: 1, name: 'db-postgres-01', status: 'running', vcpus: 16, sockets: 2, cores: 4, threads: 2, mem_gb: 64, mem_mb: 65536, cpu_pinning: true, numa: 1, os: 'Rocky Linux 9', ha: true, gpus: 0, ip: '10.10.1.22', cpu_usage: 67, mem_usage: 81, created_at: '2026-01-21T08:00:00Z' },
    { id: 3, host_id: 2, cluster_id: 1, datacenter_id: 1, name: 'app-server-01', status: 'running', vcpus: 4, sockets: 1, cores: 4, threads: 1, mem_gb: 8, mem_mb: 8192, cpu_pinning: false, numa: -1, os: 'Ubuntu 22.04', ha: false, gpus: 0, ip: '10.10.1.23', cpu_usage: 22, mem_usage: 45, created_at: '2026-02-01T08:00:00Z' },
    { id: 4, host_id: 3, cluster_id: 1, datacenter_id: 1, name: 'cache-redis-01', status: 'running', vcpus: 4, sockets: 1, cores: 2, threads: 2, mem_gb: 32, mem_mb: 32768, cpu_pinning: true, numa: 0, os: 'Rocky Linux 9', ha: true, gpus: 0, ip: '10.10.1.24', cpu_usage: 18, mem_usage: 72, created_at: '2026-02-02T08:00:00Z' },
    { id: 5, host_id: 5, cluster_id: 2, datacenter_id: 1, name: 'ai-training-01', status: 'running', vcpus: 32, sockets: 2, cores: 8, threads: 2, mem_gb: 256, mem_mb: 262144, cpu_pinning: true, numa: 0, os: 'Ubuntu 22.04 + CUDA', ha: false, gpus: 2, ip: '10.10.2.31', cpu_usage: 89, mem_usage: 76, created_at: '2026-02-10T08:00:00Z' },
    { id: 6, host_id: 5, cluster_id: 2, datacenter_id: 1, name: 'ai-inference-01', status: 'running', vcpus: 16, sockets: 1, cores: 16, threads: 1, mem_gb: 128, mem_mb: 131072, cpu_pinning: true, numa: 1, os: 'Ubuntu 22.04 + CUDA', ha: false, gpus: 1, ip: '10.10.2.32', cpu_usage: 64, mem_usage: 52, created_at: '2026-02-11T08:00:00Z' },
    { id: 7, host_id: 6, cluster_id: 2, datacenter_id: 1, name: 'ai-training-02', status: 'paused', vcpus: 32, sockets: 2, cores: 8, threads: 2, mem_gb: 256, mem_mb: 262144, cpu_pinning: true, numa: 0, os: 'Ubuntu 22.04 + CUDA', ha: false, gpus: 2, ip: '10.10.2.33', cpu_usage: 0, mem_usage: 30, created_at: '2026-02-12T08:00:00Z' },
    { id: 8, host_id: 2, cluster_id: 1, datacenter_id: 1, name: 'test-vm-08', status: 'stopped', vcpus: 2, sockets: 1, cores: 2, threads: 1, mem_gb: 4, mem_mb: 4096, cpu_pinning: false, numa: -1, os: 'CentOS Stream 9', ha: false, gpus: 0, ip: '-', cpu_usage: 0, mem_usage: 0, created_at: '2026-03-01T08:00:00Z' },
  ],
  gpus: [
    { id: 1, host_id: 5, host: 'gpu-node-01', pci: '0000:81:00.0', vendor: 'NVIDIA', model: 'A100 80GB PCIe', vram_mb: 81920, mode: 'passthrough', status: 'assigned', vm: 'ai-training-01', numa: 0, util: 94, mem_used: 68000, temp: 71, power: 280 },
    { id: 2, host_id: 5, host: 'gpu-node-01', pci: '0000:81:00.1', vendor: 'NVIDIA', model: 'A100 80GB PCIe', vram_mb: 81920, mode: 'passthrough', status: 'assigned', vm: 'ai-training-01', numa: 0, util: 88, mem_used: 61000, temp: 68, power: 265 },
    { id: 3, host_id: 5, host: 'gpu-node-01', pci: '0000:c1:00.0', vendor: 'NVIDIA', model: 'A100 80GB PCIe', vram_mb: 81920, mode: 'passthrough', status: 'assigned', vm: 'ai-inference-01', numa: 1, util: 56, mem_used: 32000, temp: 61, power: 180 },
    { id: 4, host_id: 5, host: 'gpu-node-01', pci: '0000:c1:00.1', vendor: 'NVIDIA', model: 'A100 80GB PCIe', vram_mb: 81920, mode: 'passthrough', status: 'available', vm: null, numa: 1, util: 0, mem_used: 0, temp: 42, power: 38 },
    { id: 5, host_id: 6, host: 'gpu-node-02', pci: '0000:81:00.0', vendor: 'NVIDIA', model: 'H100 80GB SXM', vram_mb: 81920, mode: 'vgpu', status: 'assigned', vm: 'ai-training-02', numa: 0, util: 0, mem_used: 20000, temp: 45, power: 95 },
    { id: 6, host_id: 6, host: 'gpu-node-02', pci: '0000:81:00.1', vendor: 'NVIDIA', model: 'H100 80GB SXM', vram_mb: 81920, mode: 'passthrough', status: 'available', vm: null, numa: 0, util: 0, mem_used: 0, temp: 41, power: 72 },
  ],
  storage_pools: [
    { id: 1, cluster_id: 1, name: 'prod-nfs-pool', type: 'nfs', capacity_tb: 50, used_tb: 31.2, shared: true, status: 'active', read_iops: 12400, write_iops: 8200, latency: 1.2 },
    { id: 2, cluster_id: 1, name: 'prod-iscsi-fast', type: 'iscsi', capacity_tb: 20, used_tb: 14.8, shared: true, status: 'active', read_iops: 48000, write_iops: 32000, latency: 0.4 },
    { id: 3, cluster_id: 2, host_id: 5, name: 'gpu-local-nvme', type: 'local', capacity_tb: 8, used_tb: 5.1, shared: false, status: 'active', read_iops: 95000, write_iops: 78000, latency: 0.1 },
    { id: 4, cluster_id: 1, name: 'backup-nfs', type: 'nfs', capacity_tb: 100, used_tb: 42.0, shared: true, status: 'active', read_iops: 3200, write_iops: 2100, latency: 3.5 },
  ],
  tasks: [
    { id: 1, type: 'vm.migrate', target: 'web-prod-01', status: 'success', progress: 100, user: 'admin', time: '2026-06-24 09:12' },
    { id: 2, type: 'vm.create', target: 'ai-inference-02', status: 'running', progress: 64, user: 'admin', time: '2026-06-24 09:30' },
    { id: 3, type: 'snapshot.create', target: 'db-postgres-01', status: 'success', progress: 100, user: 'operator', time: '2026-06-24 08:45' },
    { id: 4, type: 'vm.migrate', target: 'cache-redis-01', status: 'failed', progress: 0, user: 'admin', time: '2026-06-24 07:20' },
  ],
  // 快照（含 NVRAM + 内存状态），按 VM 分组
  snapshots: [
    { id: 1, vm_id: 1, vm: 'web-frontend-01', name: 'before-upgrade-v2', description: '升级 nginx 前的安全点', with_memory: true, quiesce: true, size_gb: 8.4, parent: null, created_at: '2026-06-23 22:10', current: false },
    { id: 2, vm_id: 1, vm: 'web-frontend-01', name: 'post-upgrade-stable', description: '升级后稳定版本', with_memory: false, quiesce: true, size_gb: 2.1, parent: 'before-upgrade-v2', created_at: '2026-06-24 01:30', current: true },
    { id: 3, vm_id: 4, vm: 'db-postgres-01', name: 'daily-2026-06-24', description: '每日定时快照（guest-agent 冻结）', with_memory: false, quiesce: true, size_gb: 12.7, parent: null, created_at: '2026-06-24 03:00', current: true },
    { id: 4, vm_id: 6, vm: 'ai-inference-02', name: 'model-loaded-mem', description: '含显存模型的内存快照', with_memory: true, quiesce: false, size_gb: 96.0, parent: null, created_at: '2026-06-24 06:15', current: true },
  ],
  // 迁移历史
  migrations: [
    { id: 1, vm: 'web-frontend-01', src: 'node-prod-01', dst: 'node-prod-02', live: true, storage: false, status: 'success', downtime_ms: 180, throughput_mbps: 9400, duration_s: 42, time: '2026-06-23 20:05' },
    { id: 2, vm: 'cache-redis-01', src: 'node-prod-03', dst: 'node-prod-01', live: true, storage: true, status: 'success', downtime_ms: 420, throughput_mbps: 7100, duration_s: 188, time: '2026-06-23 18:40' },
  ],
  // 集群高级配置（高可用 / 动态资源调度 / CPU 兼容模式 / 超分配）
  cluster_configs: [
    {
      id: 1, name: '生产集群 Prod-A',
      ha_enabled: true, ha_admission_control: true, ha_host_failures: 1,
      drs_enabled: true, drs_automation: 'full', drs_aggressiveness: 3,
      evc_enabled: true, evc_baseline: 'CPU 基线 Gen3',
      overcommit_cpu: 4.0, overcommit_mem: 1.5,
    },
    {
      id: 2, name: 'GPU 计算集群 GPU-Compute',
      ha_enabled: true, ha_admission_control: false, ha_host_failures: 1,
      drs_enabled: false, drs_automation: 'manual', drs_aggressiveness: 2,
      evc_enabled: true, evc_baseline: 'CPU 基线 Gen4',
      overcommit_cpu: 1.0, overcommit_mem: 1.0,
    },
    {
      id: 3, name: '测试集群 Test-B',
      ha_enabled: false, ha_admission_control: false, ha_host_failures: 0,
      drs_enabled: false, drs_automation: 'manual', drs_aggressiveness: 1,
      evc_enabled: false, evc_baseline: '-',
      overcommit_cpu: 8.0, overcommit_mem: 2.0,
    },
  ],
  // RBAC 角色定义（CNF 企业级角色/权限模型）
  roles: [
    { id: 1, key: 'role_admin', system: true, privileges: ['priv_vm_create','priv_vm_config','priv_vm_power','priv_vm_console','priv_vm_snapshot','priv_host_config','priv_host_maint','priv_cluster_config','priv_ds_manage','priv_net_config','priv_perm_manage','priv_global_settings'] },
    { id: 2, key: 'role_vm_admin', system: false, privileges: ['priv_vm_create','priv_vm_config','priv_vm_power','priv_vm_console','priv_vm_snapshot'] },
    { id: 3, key: 'role_vm_user', system: false, privileges: ['priv_vm_power','priv_vm_console'] },
    { id: 4, key: 'role_network', system: false, privileges: ['priv_net_config'] },
    { id: 5, key: 'role_readonly', system: true, privileges: [] },
  ],
  // 所有可分配权限项
  all_privileges: [
    'priv_vm_create','priv_vm_config','priv_vm_power','priv_vm_console','priv_vm_snapshot',
    'priv_host_config','priv_host_maint','priv_cluster_config','priv_ds_manage',
    'priv_net_config','priv_perm_manage','priv_global_settings',
  ],
  // 权限分配（用户/组 → 角色 → 作用域）
  permission_assignments: [
    { id: 1, user: 'administrator@cnf.local', role_key: 'role_admin', scope: 'perm_global', scope_obj: '—', propagate: true },
    { id: 2, user: 'ops-team@cnf.local', role_key: 'role_vm_admin', scope: 'perm_cluster', scope_obj: '生产集群 Prod-A', propagate: true },
    { id: 3, user: 'dev-zhang@cnf.local', role_key: 'role_vm_user', scope: 'perm_dc', scope_obj: '北京一区 DC-Beijing-01', propagate: true },
    { id: 4, user: 'audit@cnf.local', role_key: 'role_readonly', scope: 'perm_global', scope_obj: '—', propagate: true },
    { id: 5, user: 'net-li@cnf.local', role_key: 'role_network', scope: 'perm_dc', scope_obj: '北京一区 DC-Beijing-01', propagate: false },
  ],

  // ===================== 系统设置 · License 管理 =====================
  // 当前许可证（Standard 版：16 节点 / 500 VM / 含 HA + 热迁移 + 审计 + 自定义角色）
  license: {
    edition: 'standard',
    organization: 'Cloud Nexus 科技有限公司',
    license_key: 'CNF-STD-2026-A1B2-C3D4-E5F6-7890',
    issued_at: '2026-01-15',
    expires_at: '2027-01-14',
    hardware_fingerprint: 'HWFP-7F3A9C2E-8B1D-4E6F',
    is_active: true,
    max_nodes: 16,
    max_vms: 500,
    current_nodes: 6,
    current_vms: 8,
  },
  // 三版本特性对比矩阵（Community / Standard / Enterprise）
  license_editions: [
    {
      key: 'community', name_zh: '社区版', name_en: 'Community', price: '免费 / Free',
      max_nodes: 3, max_vms: 50, ha_enabled: false, live_migration: false,
      vlan_mgmt: '基础', storage: 'NFS / iSCSI / 本地', custom_roles: false, audit_log: false, api_access: '只读',
    },
    {
      key: 'standard', name_zh: '标准版', name_en: 'Standard', price: '¥12,800 / 年·节点',
      max_nodes: 16, max_vms: 500, ha_enabled: true, live_migration: true,
      vlan_mgmt: '完整 VLAN', storage: 'NFS / iSCSI / 本地', custom_roles: true, audit_log: true, api_access: '读写',
    },
    {
      key: 'enterprise', name_zh: '企业版', name_en: 'Enterprise', price: '联系销售 / Contact Sales',
      max_nodes: 32, max_vms: 999999, ha_enabled: true, live_migration: true,
      vlan_mgmt: 'VLAN + SDN', storage: 'NFS / iSCSI / 本地 / 分布式存储', custom_roles: true, audit_log: true, api_access: '读写 + Webhook',
    },
  ],

  // ===================== 访问控制 · 用户（含资源配额 + 用量）=====================
  // role_id/role_name：1 超级管理员 / 2 系统管理员 / 3 运维工程师 / 4 只读用户
  users: [
    { id: 1, username: 'administrator', display_name: '系统管理员', email: 'administrator@cnf.local', phone: '138-0000-0001', role_id: 1, role_name: '超级管理员', role_keys: ['role_admin'], source: 'local', status: 'active', is_active: true, last_login_at: '2026-06-24 09:31', last_login: '2026-06-24 09:31', created_at: '2026-01-15',
      resource_quota: { max_vms: 9999, max_vcpus: 9999, max_memory_gb: 99999, max_storage_gb: 999999 },
      resource_usage: { current_vms: 8, current_vcpus: 114, current_memory_gb: 764, current_storage_gb: 4820 } },
    { id: 2, username: 'ops-wang', display_name: '王运维', email: 'ops-wang@cnf.local', phone: '138-0000-0002', role_id: 3, role_name: '运维工程师', role_keys: ['role_vm_admin'], source: 'ldap', status: 'active', is_active: true, last_login_at: '2026-06-24 08:50', last_login: '2026-06-24 08:50', created_at: '2026-02-01',
      resource_quota: { max_vms: 50, max_vcpus: 200, max_memory_gb: 1024, max_storage_gb: 8192 },
      resource_usage: { current_vms: 12, current_vcpus: 88, current_memory_gb: 416, current_storage_gb: 2360 } },
    { id: 3, username: 'dev-zhang', display_name: '张开发', email: 'dev-zhang@cnf.local', phone: '138-0000-0003', role_id: 4, role_name: '只读用户', role_keys: ['role_vm_user'], source: 'ldap', status: 'active', is_active: true, last_login_at: '2026-06-23 17:22', last_login: '2026-06-23 17:22', created_at: '2026-03-10',
      resource_quota: { max_vms: 10, max_vcpus: 40, max_memory_gb: 128, max_storage_gb: 1024 },
      resource_usage: { current_vms: 3, current_vcpus: 12, current_memory_gb: 36, current_storage_gb: 240 } },
    { id: 4, username: 'net-li', display_name: '李网络', email: 'net-li@cnf.local', phone: '138-0000-0004', role_id: 2, role_name: '系统管理员', role_keys: ['role_network'], source: 'local', status: 'active', is_active: true, last_login_at: '2026-06-22 11:05', last_login: '2026-06-22 11:05', created_at: '2026-03-12',
      resource_quota: { max_vms: 30, max_vcpus: 120, max_memory_gb: 512, max_storage_gb: 4096 },
      resource_usage: { current_vms: 0, current_vcpus: 0, current_memory_gb: 0, current_storage_gb: 0 } },
    { id: 5, username: 'audit', display_name: '审计员', email: 'audit@cnf.local', phone: '138-0000-0005', role_id: 4, role_name: '只读用户', role_keys: ['role_readonly'], source: 'local', status: 'disabled', is_active: false, last_login_at: '2026-05-30 14:40', last_login: '2026-05-30 14:40', created_at: '2026-04-01',
      resource_quota: { max_vms: 0, max_vcpus: 0, max_memory_gb: 0, max_storage_gb: 0 },
      resource_usage: { current_vms: 0, current_vcpus: 0, current_memory_gb: 0, current_storage_gb: 0 } },
  ],
  // 角色字典（用户管理表单使用）
  user_roles: [
    { id: 1, name: '超级管理员', key: 'role_admin' },
    { id: 2, name: '系统管理员', key: 'role_sysadmin' },
    { id: 3, name: '运维工程师', key: 'role_ops' },
    { id: 4, name: '只读用户', key: 'role_readonly' },
  ],
  // ===================== 访问控制 · 操作审计 =====================
  audit_logs: [
    { id: 1, ts: '2026-06-24 09:31:12', user: 'administrator', action: 'auth.login', resource: '控制台', source_ip: '10.0.0.21', result: 'success', detail: '管理员登录成功' },
    { id: 2, ts: '2026-06-24 09:30:05', user: 'administrator', action: 'vm.create', resource: 'ai-inference-02', source_ip: '10.0.0.21', result: 'success', detail: '创建虚拟机（32 vCPU / 256GB / 1×A100）' },
    { id: 3, ts: '2026-06-24 09:12:48', user: 'ops-wang', action: 'vm.migrate', resource: 'web-prod-01', source_ip: '10.0.0.35', result: 'success', detail: '在线迁移: node-prod-01 → node-prod-02' },
    { id: 4, ts: '2026-06-24 08:45:30', user: 'ops-wang', action: 'snapshot.create', resource: 'db-postgres-01', source_ip: '10.0.0.35', result: 'success', detail: '创建快照（guest-agent 冻结）' },
    { id: 5, ts: '2026-06-24 07:20:11', user: 'administrator', action: 'vm.migrate', resource: 'cache-redis-01', source_ip: '10.0.0.21', result: 'failed', detail: '目标主机资源不足，迁移回滚' },
    { id: 6, ts: '2026-06-23 22:10:03', user: 'dev-zhang', action: 'vm.power', resource: 'test-vm-08', source_ip: '10.0.0.88', result: 'denied', detail: '权限不足：缺少 priv_vm_power' },
    { id: 7, ts: '2026-06-23 20:05:44', user: 'ops-wang', action: 'role.update', resource: 'role_vm_admin', source_ip: '10.0.0.35', result: 'success', detail: '为角色新增 priv_vm_snapshot 权限' },
  ],

  // ===================== 计算资源 · 模板管理 =====================
  vm_templates: [
    { id: 1, name: 'tpl-rocky9-base', os: 'Rocky Linux 9', os_type: 'linux', description: '企业基线模板：cloud-init + qemu-guest-agent', vcpus: 4, mem_gb: 8, disk_gb: 40, usage_count: 23, pool: 'prod-nfs-pool', updated_at: '2026-06-10 10:20' },
    { id: 2, name: 'tpl-ubuntu2204-cuda', os: 'Ubuntu 22.04 + CUDA 12', os_type: 'linux', description: 'AI 训练模板：CUDA / cuDNN / PyTorch 预装', vcpus: 16, mem_gb: 64, disk_gb: 120, usage_count: 9, pool: 'gpu-local-nvme', updated_at: '2026-06-18 16:42' },
    { id: 3, name: 'tpl-win2022-std', os: 'Windows Server 2022', os_type: 'windows', description: 'Windows 标准模板：virtio 驱动 + RDP', vcpus: 4, mem_gb: 16, disk_gb: 80, usage_count: 5, pool: 'prod-iscsi-fast', updated_at: '2026-05-28 09:15' },
  ],
  // ===================== 计算资源 · ISO 镜像 =====================
  iso_images: [
    { id: 1, name: 'Rocky-9.4-x86_64-dvd.iso', os_type: 'Linux', size_gb: 11.2, pool: 'prod-nfs-pool', uploaded_at: '2026-04-02', checksum_ok: true },
    { id: 2, name: 'ubuntu-22.04.4-live-server.iso', os_type: 'Linux', size_gb: 2.1, pool: 'prod-nfs-pool', uploaded_at: '2026-04-02', checksum_ok: true },
    { id: 3, name: 'Win2022_CN-x64.iso', os_type: 'Windows', size_gb: 5.4, pool: 'prod-iscsi-fast', uploaded_at: '2026-04-05', checksum_ok: true },
    { id: 4, name: 'virtio-win-0.1.240.iso', os_type: 'Drivers', size_gb: 0.6, pool: 'prod-nfs-pool', uploaded_at: '2026-04-05', checksum_ok: false },
  ],
  // ===================== 基础设施 · 资源池 =====================
  resource_pools: [
    { id: 1, cluster_id: 1, name: '生产业务池 Prod-Pool', cpu_shares: 'high', cpu_limit_vcpu: 192, cpu_reserved_vcpu: 96, mem_limit_gb: 768, mem_reserved_gb: 384, vms: 16 },
    { id: 2, cluster_id: 1, name: '测试沙箱池 Test-Pool', cpu_shares: 'low', cpu_limit_vcpu: 64, cpu_reserved_vcpu: 0, mem_limit_gb: 128, mem_reserved_gb: 0, vms: 7 },
    { id: 3, cluster_id: 2, name: 'AI 训练池 GPU-Pool', cpu_shares: 'high', cpu_limit_vcpu: 256, cpu_reserved_vcpu: 128, mem_limit_gb: 1536, mem_reserved_gb: 768, vms: 5 },
  ],

  // ===================== 网络管理 · 虚拟交换机 =====================
  vswitches: [
    { id: 1, name: 'vSwitch-Prod', type: '分布式虚拟交换机', mtu: 1500, uplink: 'bond0 (2×25GbE)', bond_mode: '802.3ad', ports: 128, vlans: [10, 20, 30], hosts: ['node-prod-01', 'node-prod-02', 'node-prod-03'] },
    { id: 2, name: 'vSwitch-Storage', type: '标准网桥', mtu: 9000, uplink: 'bond1 (2×100GbE)', bond_mode: 'active-backup', ports: 64, vlans: [100], hosts: ['node-prod-01', 'node-prod-02'] },
    { id: 3, name: 'vSwitch-GPU', type: '分布式虚拟交换机', mtu: 9000, uplink: 'bond0 (2×100GbE)', bond_mode: 'balance-rr', ports: 48, vlans: [40, 50], hosts: ['gpu-node-01', 'gpu-node-02'] },
  ],
  // ===================== 网络管理 · 宿主机物理网卡（用于交换机上联选择）=====================
  host_nics: [
    { id: 'eth0', name: 'eth0', mac: '00:1b:21:aa:01:00', speed_gbe: 25, state: 'up', driver: 'ixgbe', in_use: false },
    { id: 'eth1', name: 'eth1', mac: '00:1b:21:aa:01:01', speed_gbe: 25, state: 'up', driver: 'ixgbe', in_use: false },
    { id: 'eth2', name: 'eth2', mac: '00:1b:21:aa:01:02', speed_gbe: 100, state: 'up', driver: 'mlx5', in_use: false },
    { id: 'eth3', name: 'eth3', mac: '00:1b:21:aa:01:03', speed_gbe: 100, state: 'up', driver: 'mlx5', in_use: false },
    { id: 'eth4', name: 'eth4', mac: '00:1b:21:aa:01:04', speed_gbe: 10, state: 'down', driver: 'igb', in_use: false },
    { id: 'eth5', name: 'eth5', mac: '00:1b:21:aa:01:05', speed_gbe: 10, state: 'up', driver: 'igb', in_use: true },
  ],
  // ===================== 网络管理 · Bond 链路聚合模式 =====================
  bond_modes: [
    { key: 'balance-rr', label_key: 'bond_balance_rr', min_nics: 2, lacp: false },
    { key: 'active-backup', label_key: 'bond_active_backup', min_nics: 2, lacp: false },
    { key: '802.3ad', label_key: 'bond_8023ad', min_nics: 2, lacp: true },
    { key: 'balance-xor', label_key: 'bond_balance_xor', min_nics: 2, lacp: false },
    { key: 'broadcast', label_key: 'bond_broadcast', min_nics: 2, lacp: false },
    { key: 'balance-tlb', label_key: 'bond_balance_tlb', min_nics: 2, lacp: false },
    { key: 'balance-alb', label_key: 'bond_balance_alb', min_nics: 2, lacp: false },
  ],
  // ===================== 网络管理 · VLAN 配置 =====================
  vlans: [
    { id: 1, vswitch: 'vSwitch-Prod', vlan_id: 10, name: '业务前端 VLAN', subnet: '10.10.1.0/24', gateway: '10.10.1.1', dhcp: true, vms: 12 },
    { id: 2, vswitch: 'vSwitch-Prod', vlan_id: 20, name: '业务后端 VLAN', subnet: '10.10.2.0/24', gateway: '10.10.2.1', dhcp: true, vms: 8 },
    { id: 3, vswitch: 'vSwitch-Prod', vlan_id: 30, name: '管理网 VLAN', subnet: '10.0.0.0/24', gateway: '10.0.0.1', dhcp: false, vms: 0 },
    { id: 4, vswitch: 'vSwitch-Storage', vlan_id: 100, name: '存储网 VLAN', subnet: '10.20.0.0/24', gateway: '10.20.0.1', dhcp: false, vms: 0 },
    { id: 5, vswitch: 'vSwitch-GPU', vlan_id: 40, name: 'AI 训练 VLAN', subnet: '10.10.2.0/24', gateway: '10.10.2.1', dhcp: true, vms: 5 },
  ],

  // ===================== 存储管理 · 卷管理 =====================
  volumes: [
    { id: 1, name: 'web-prod-01-disk0', pool: 'prod-nfs-pool', vm: 'web-prod-01', format: 'qcow2', size_gb: 40, used_gb: 18, bus: 'virtio-scsi', iops_limit: 5000 },
    { id: 2, name: 'db-postgres-01-data', pool: 'prod-iscsi-fast', vm: 'db-postgres-01', format: 'raw', size_gb: 500, used_gb: 312, bus: 'virtio-scsi', iops_limit: 20000 },
    { id: 3, name: 'ai-training-01-nvme', pool: 'gpu-local-nvme', vm: 'ai-training-01', format: 'raw', size_gb: 2000, used_gb: 1240, bus: 'nvme', iops_limit: 0 },
    { id: 4, name: 'cache-redis-01-disk0', pool: 'prod-nfs-pool', vm: 'cache-redis-01', format: 'qcow2', size_gb: 60, used_gb: 22, bus: 'virtio-scsi', iops_limit: 8000 },
  ],

  // ===================== 存储管理 · iSCSI 存储池（自动化配置）=====================
  iscsi_pools: [
    {
      id: 1, name: 'iscsi-prod-fast', type: 'iscsi', cluster_id: 1, cluster_name: '生产集群 Prod-A', status: 'active',
      iscsi_config: { target_portal: '192.168.10.50:3260', target_iqn: 'iqn.2024-01.com.storage:prod.target1', lun_id: 0, auth_method: 'chap', chap_username: 'cnf-prod' },
      auto_config_status: { total_hosts: 4, configured_hosts: 4, failed_hosts: [], last_config_time: '2026-06-20 14:30' },
      capacity: { total_gb: 20480, available_gb: 5320, used_gb: 15160 },
    },
    {
      id: 2, name: 'iscsi-gpu-scratch', type: 'iscsi', cluster_id: 2, cluster_name: 'GPU 计算集群 GPU-Compute', status: 'active',
      iscsi_config: { target_portal: '192.168.20.60:3260', target_iqn: 'iqn.2024-01.com.storage:gpu.scratch', lun_id: 2, auth_method: 'none' },
      auto_config_status: { total_hosts: 2, configured_hosts: 2, failed_hosts: [], last_config_time: '2026-06-21 10:05' },
      capacity: { total_gb: 10240, available_gb: 7100, used_gb: 3140 },
    },
  ],

  // ===================== 存储管理 · 独立虚拟磁盘（可挂载/卸载）=====================
  virtual_disks: [
    { id: 1, name: 'data-disk-db01', storage_pool_id: 2, storage_pool_name: 'prod-iscsi-fast', format: 'raw', provisioning: 'thick', size_gb: 500, allocated_gb: 500, shared_disk: false, encryption_enabled: true, status: 'attached', attached_vms: [{ vm_id: 2, vm_name: 'db-postgres-01', bus_type: 'virtio', boot_order: 2 }], created_at: '2026-03-01 10:00', last_modified: '2026-06-20 08:30' },
    { id: 2, name: 'shared-gfs-vol', storage_pool_id: 1, storage_pool_name: 'prod-nfs-pool', format: 'raw', provisioning: 'thick', size_gb: 1000, allocated_gb: 1000, shared_disk: true, encryption_enabled: false, status: 'attached', attached_vms: [{ vm_id: 1, vm_name: 'web-prod-01', bus_type: 'scsi' }, { vm_id: 3, vm_name: 'app-server-01', bus_type: 'scsi' }], created_at: '2026-03-05 11:20', last_modified: '2026-06-18 16:00' },
    { id: 3, name: 'thin-cache-disk', storage_pool_id: 1, storage_pool_name: 'prod-nfs-pool', format: 'qcow2', provisioning: 'thin', size_gb: 200, allocated_gb: 38, shared_disk: false, encryption_enabled: false, status: 'available', attached_vms: [], created_at: '2026-05-10 09:00', last_modified: '2026-06-22 12:00' },
    { id: 4, name: 'ai-scratch-nvme', storage_pool_id: 3, storage_pool_name: 'gpu-local-nvme', format: 'raw', provisioning: 'thick', size_gb: 2000, allocated_gb: 2000, shared_disk: false, encryption_enabled: false, status: 'attached', attached_vms: [{ vm_id: 5, vm_name: 'ai-training-01', bus_type: 'virtio', boot_order: 3 }], created_at: '2026-02-10 08:00', last_modified: '2026-06-23 06:00' },
  ],

  // ===================== 可用性管理 · 备份恢复 =====================
  backup_jobs: [
    { id: 1, target_vm: 'db-postgres-01', schedule: '每日 03:00', mode: 'snapshot', retention: '保留 14 份', last_run: '2026-06-24 03:00', last_status: 'success', last_size_gb: 312 },
    { id: 2, target_vm: 'web-prod-01', schedule: '每日 02:30', mode: 'snapshot', retention: '保留 7 份', last_run: '2026-06-24 02:30', last_status: 'success', last_size_gb: 18 },
    { id: 3, target_vm: 'cache-redis-01', schedule: '每周日 04:00', mode: 'full', retention: '保留 4 份', last_run: '2026-06-22 04:00', last_status: 'warning', last_size_gb: 22 },
    { id: 4, target_vm: 'ai-training-01', schedule: '手动', mode: 'full', retention: '保留 2 份', last_run: '2026-06-20 18:00', last_status: 'failed', last_size_gb: 0 },
  ],

  // ===================== 监控告警 · 告警规则 =====================
  alert_rules: [
    { id: 1, name: '主机 CPU 过载', metric: 'host.cpu_usage', condition: '> 90% 持续 5 分钟', severity: 'critical', triggered: 2, channel: '邮件 + Webhook', enabled: true },
    { id: 2, name: '主机内存不足', metric: 'host.mem_usage', condition: '> 85% 持续 10 分钟', severity: 'warning', triggered: 1, channel: '邮件', enabled: true },
    { id: 3, name: 'GPU 温度告警', metric: 'gpu.temp', condition: '> 80℃', severity: 'critical', triggered: 0, channel: '邮件 + Webhook', enabled: true },
    { id: 4, name: '存储池容量告警', metric: 'storage.used_pct', condition: '> 80%', severity: 'warning', triggered: 1, channel: '邮件', enabled: true },
    { id: 5, name: 'VM 心跳丢失', metric: 'vm.heartbeat', condition: '无响应 > 60s', severity: 'critical', triggered: 0, channel: '邮件 + 短信', enabled: false },
  ],

  // ===================== 通知中心（顶栏铃铛） =====================
  notifications: [
    { id: 1, level: 'error', title: '迁移失败：cache-redis-01 目标主机资源不足', time: '2026-06-24 07:20', read: false },
    { id: 2, level: 'warning', title: 'node-prod-03 CPU 使用率 78%，接近告警阈值', time: '2026-06-24 09:15', read: false },
    { id: 3, level: 'info', title: 'ai-inference-02 创建任务进行中（64%）', time: '2026-06-24 09:30', read: false },
    { id: 4, level: 'info', title: 'db-postgres-01 每日备份完成（312 GB）', time: '2026-06-24 03:01', read: true },
    { id: 5, level: 'warning', title: 'License 节点用量 6/16，VM 用量 8/500', time: '2026-06-23 23:00', read: true },
  ],
}

// =============================================================================
//  主机硬件深度详情（CPU 拓扑 / 网卡 / 存储设备 / PCI 设备）——按主机 ID 派生
//  真实硬件型号，确定性生成（同一主机每次返回一致）。
// =============================================================================
const HW_PROFILES: Record<number, any> = {
  // node-prod-01..04 (Intel Xeon Gold 6248R)
  default: {
    cpu: { model: 'Intel Xeon Gold 6248R', vendor: 'Intel', sockets: 2, cores_per_socket: 24, threads_per_core: 2, base_freq_ghz: 3.0, max_freq_ghz: 4.0, cache_l3_mb: 35.75, numa_nodes: 2, virtualization_features: ['vmx', 'sse4_2', 'avx2', 'avx512f', 'aes'] },
    nics: [
      { name: 'eno1', type: 'physical', vendor: 'Intel', model: 'X710-DA2', speed_gbps: 10, driver: 'i40e', pci: '0000:18:00.0' },
      { name: 'eno2', type: 'physical', vendor: 'Intel', model: 'X710-DA2', speed_gbps: 10, driver: 'i40e', pci: '0000:18:00.1' },
      { name: 'bond0', type: 'bond', vendor: 'Intel', model: 'X710-DA2 (LACP)', speed_gbps: 20, driver: 'bonding', pci: '-', members: ['eno1', 'eno2'] },
    ],
    disks: [
      { device_name: 'nvme0n1', type: 'NVMe', vendor: 'Samsung', model: 'PM9A3 1.92TB', capacity_gb: 1920, interface: 'NVMe PCIe 4.0 x4', rpm: null },
      { device_name: 'nvme1n1', type: 'NVMe', vendor: 'Samsung', model: 'PM9A3 1.92TB', capacity_gb: 1920, interface: 'NVMe PCIe 4.0 x4', rpm: null },
      { device_name: 'sda', type: 'SSD', vendor: 'Intel', model: 'D3-S4610 480GB', capacity_gb: 480, interface: 'SATA 6Gb/s', rpm: null },
    ],
    pci: [
      { vendor: 'Broadcom', device_name: 'MegaRAID 9560-8i', device_class: 'RAID controller', driver: 'megaraid_sas', passthrough_capable: false, numa_node: 0 },
      { vendor: 'Intel', device_name: 'X710 for 10GbE SFP+', device_class: 'Ethernet controller', driver: 'i40e', passthrough_capable: true, numa_node: 0 },
    ],
  },
  platinum: {
    cpu: { model: 'Intel Xeon Platinum 8358', vendor: 'Intel', sockets: 2, cores_per_socket: 32, threads_per_core: 2, base_freq_ghz: 2.6, max_freq_ghz: 3.4, cache_l3_mb: 48, numa_nodes: 2, virtualization_features: ['vmx', 'sse4_2', 'avx2', 'avx512f', 'avx512_bf16', 'aes'] },
    nics: [
      { name: 'ens3f0', type: 'physical', vendor: 'Mellanox', model: 'ConnectX-6 Dx', speed_gbps: 100, driver: 'mlx5_core', pci: '0000:3b:00.0' },
      { name: 'ens3f1', type: 'physical', vendor: 'Mellanox', model: 'ConnectX-6 Dx', speed_gbps: 100, driver: 'mlx5_core', pci: '0000:3b:00.1' },
      { name: 'bond0', type: 'bond', vendor: 'Mellanox', model: 'ConnectX-6 Dx (LACP)', speed_gbps: 200, driver: 'bonding', pci: '-', members: ['ens3f0', 'ens3f1'] },
    ],
    disks: [
      { device_name: 'nvme0n1', type: 'NVMe', vendor: 'Intel', model: 'D7-P5520 3.84TB', capacity_gb: 3840, interface: 'NVMe PCIe 4.0 x4', rpm: null },
      { device_name: 'nvme1n1', type: 'NVMe', vendor: 'Intel', model: 'D7-P5520 3.84TB', capacity_gb: 3840, interface: 'NVMe PCIe 4.0 x4', rpm: null },
      { device_name: 'sdb', type: 'HDD', vendor: 'Seagate', model: 'Exos X18 16TB', capacity_gb: 16000, interface: 'SAS 12Gb/s', rpm: 7200 },
    ],
    pci: [
      { vendor: 'NVIDIA', device_name: 'A100 80GB PCIe', device_class: 'Display controller', driver: 'nvidia', passthrough_capable: true, numa_node: 0 },
      { vendor: 'NVIDIA', device_name: 'A100 80GB PCIe', device_class: 'Display controller', driver: 'nvidia', passthrough_capable: true, numa_node: 1 },
      { vendor: 'Mellanox', device_name: 'ConnectX-6 Dx', device_class: 'Ethernet controller', driver: 'mlx5_core', passthrough_capable: true, numa_node: 0 },
      { vendor: 'Broadcom', device_name: 'MegaRAID 9560-16i', device_class: 'RAID controller', driver: 'megaraid_sas', passthrough_capable: false, numa_node: 1 },
    ],
  },
}

function hashSeed(n: number, salt = 0) {
  const x = Math.sin(n * 999 + salt * 37) * 10000
  return x - Math.floor(x)
}

/** 主机硬件深度详情（确定性派生，含实时流量/温度/IOPS）。 */
export function getHostHardware(id: number) {
  const host = mockData.hosts.find((h) => h.id === id)
  if (!host) return null
  const cl = mockData.clusters.find((c) => c.id === host.cluster_id)
  const isGpu = host.gpus > 0
  const prof = isGpu ? HW_PROFILES.platinum : HW_PROFILES.default
  const macFor = (i: number) => `00:1a:2b:${(host.id * 16 + i).toString(16).padStart(2, '0')}:4d:${(60 + i).toString(16).padStart(2, '0')}`
  const ipBase = host.ip.split('.').slice(0, 3).join('.')

  const network_interfaces = prof.nics.map((n: any, i: number) => {
    const up = host.status === 'connected' && (n.type === 'bond' || i < 2)
    return {
      name: n.name, type: n.type, vendor: n.vendor, model: n.model,
      mac_address: macFor(i), speed_gbps: n.speed_gbps,
      link_status: up ? 'up' : 'down',
      ip_address: n.type === 'bond' ? host.ip : (i === 0 ? `${ipBase}.${100 + host.id}` : undefined),
      driver: n.driver, pci_address: n.pci,
      bond_members: n.members,
      rx_bytes_per_sec: up ? Math.round(hashSeed(host.id, i) * n.speed_gbps * 1e8 * 0.4) : 0,
      tx_bytes_per_sec: up ? Math.round(hashSeed(host.id, i + 10) * n.speed_gbps * 1e8 * 0.3) : 0,
    }
  })

  const storage_devices = prof.disks.map((d: any, i: number) => {
    const usage = Math.round(20 + hashSeed(host.id, i + 20) * 60)
    const temp = Math.round((d.type === 'NVMe' ? 38 : d.type === 'SSD' ? 32 : 36) + hashSeed(host.id, i + 30) * 10)
    return {
      device_name: d.device_name, type: d.type, vendor: d.vendor, model: d.model,
      serial_number: `S${(host.id * 1000 + i * 7).toString().padStart(6, '0')}NA0${host.id}${i}`,
      capacity_gb: d.capacity_gb, interface: d.interface, rpm: d.rpm,
      temperature_celsius: temp,
      smart_status: temp > 55 ? 'warning' : 'healthy',
      usage_percent: usage,
      read_iops: d.type === 'NVMe' ? Math.round(40000 + hashSeed(host.id, i) * 60000) : d.type === 'SSD' ? Math.round(8000 + hashSeed(host.id, i) * 12000) : Math.round(150 + hashSeed(host.id, i) * 200),
      write_iops: d.type === 'NVMe' ? Math.round(30000 + hashSeed(host.id, i + 5) * 50000) : d.type === 'SSD' ? Math.round(6000 + hashSeed(host.id, i + 5) * 9000) : Math.round(120 + hashSeed(host.id, i + 5) * 180),
    }
  })

  const pci_devices = prof.pci.map((p: any, i: number) => ({
    pci_address: `0000:${(7 + i * 0x20).toString(16).padStart(2, '0')}:00.0`,
    vendor: p.vendor, device_name: p.device_name, device_class: p.device_class,
    driver: p.driver, iommu_group: 10 + i, passthrough_capable: p.passthrough_capable, numa_node: p.numa_node,
  }))

  return {
    id: host.id, hostname: host.hostname, ip_address: host.ip,
    cluster_name: cl?.name || '未分配',
    status: host.status === 'connected' ? 'online' : host.status === 'maintenance' ? 'maintenance' : 'offline',
    cpu_info: {
      ...prof.cpu,
      total_threads: prof.cpu.sockets * prof.cpu.cores_per_socket * prof.cpu.threads_per_core,
      current_usage_percent: host.cpu_usage,
    },
    mem_total_gb: host.mem_total_gb, mem_used_gb: host.mem_used_gb,
    network_interfaces, storage_devices, pci_devices,
    ha_status: getHostHA(id),
  }
}

/** 主机 HA 判定（五项检查 + 健康分 + 事件历史），确定性派生。 */
export function getHostHA(id: number) {
  const host = mockData.hosts.find((h) => h.id === id)
  if (!host) return null
  const cl = mockData.clusters.find((c) => c.id === host.cluster_id)
  const haEnabled = !!cl?.ha_enabled
  const maint = host.status === 'maintenance'
  const offline = host.status !== 'connected' && !maint  // 维护模式不视为宕机

  // 网络心跳
  const netMs = offline ? 0 : +(0.4 + hashSeed(id, 1) * 1.8).toFixed(1)
  const netLoss = offline ? 100 : +(hashSeed(id, 2) * 0.4).toFixed(2)
  const netFails = offline ? 3 : 0
  const network_heartbeat = {
    status: offline ? 'fail' : netLoss > 0.3 ? 'warn' : 'pass',
    last_response_ms: netMs, response_time_ms: netMs, packet_loss_percent: netLoss,
    consecutive_failures: netFails,
    message: offline ? '连续 3 次心跳无响应（30s），疑似主机宕机' : '管理网心跳正常，每 10s 探测一次',
  }
  // 存储心跳
  const stLat = offline ? 0 : +(0.8 + hashSeed(id, 3) * 2.5).toFixed(1)
  const storage_heartbeat = {
    status: offline ? 'fail' : stLat > 2.5 ? 'warn' : 'pass',
    shared_storage_accessible: !offline,
    lock_file_writable: !offline,
    storage_latency_ms: stLat,
    failed_storage_pools: offline ? ['prod-iscsi-fast'] : [],
    message: offline ? '共享存储锁文件超过 60s 未更新，判定存储隔离' : '共享存储锁文件心跳正常',
  }
  // libvirt 服务
  const libvirt_service = {
    status: offline ? 'fail' : 'pass',
    service_running: !offline, api_responsive: !offline,
    vm_count_accessible: mockData.vms.filter((v) => v.host_id === id).length,
    version: 'libvirt 9.0.0 / QEMU 7.2.0',
    message: offline ? 'libvirtd 服务不可达' : 'libvirtd 运行中，API 响应正常',
  }
  // 资源可用性
  const cpuFree = 100 - host.cpu_usage
  const memFree = +(host.mem_total_gb * (1 - host.mem_used_gb / host.mem_total_gb)).toFixed(0)
  const resource_availability = {
    status: offline ? 'fail' : cpuFree < 15 || memFree < 32 ? 'warn' : 'pass',
    cpu_available_percent: offline ? 0 : cpuFree,
    memory_available_gb: offline ? 0 : memFree,
    can_accept_failover_vms: offline ? 0 : Math.max(0, Math.floor(memFree / 16)),
    message: offline ? '主机离线，无法接收故障转移' : `可接收约 ${Math.max(0, Math.floor(memFree / 16))} 台标准 VM 故障转移`,
  }
  // STONITH / Fencing
  const fencing_capability = {
    status: maint ? 'warn' : 'pass',
    ipmi_accessible: true, power_control_available: true, fence_agent_configured: haEnabled,
    message: !haEnabled ? '集群未启用 HA，Fencing 仅配置未激活' : maint ? '主机处于维护模式，Fencing 暂时挂起' : 'IPMI 可达，fence_ipmilan 已配置',
  }

  const checks = { network_heartbeat, storage_heartbeat, libvirt_service, resource_availability, fencing_capability }
  // 健康分：每个 fail -20，warn -8
  let score = 100
  Object.values(checks).forEach((ch: any) => { if (ch.status === 'fail') score -= 20; else if (ch.status === 'warn') score -= 8 })
  score = Math.max(0, score)
  const overall = offline ? 'failed' : score >= 90 ? 'healthy' : score >= 70 ? 'degraded' : 'failed'

  const recent_events = offline
    ? [
        { timestamp: new Date(Date.now() - 120000).toISOString(), event_type: 'fence', description: `对 ${host.name} 执行 STONITH 电源隔离`, affected_vms: [] },
        { timestamp: new Date(Date.now() - 90000).toISOString(), event_type: 'failover', description: `${host.name} 上的 VM 已在集群内重启`, affected_vms: mockData.vms.filter((v) => v.host_id === id).map((v) => v.name) },
      ]
    : [
        { timestamp: new Date(Date.now() - 3600_000).toISOString(), event_type: 'recovery', description: 'HA 健康检查全部通过', affected_vms: [] },
      ]

  return {
    enabled: haEnabled,
    overall_status: overall,
    health_score: score,
    last_check_time: new Date().toISOString(),
    check_interval_seconds: 10,
    checks, recent_events,
  }
}

/** 集群 HA 总览（聚合所有主机 HA 状态）。 */
export function getClusterHAStatus() {
  return mockData.clusters.map((cl) => {
    const clHosts = mockData.hosts.filter((h) => h.cluster_id === cl.id)
    const haList = clHosts.map((h) => getHostHA(h.id)!).filter(Boolean)
    const avg = haList.length ? Math.round(haList.reduce((s, x) => s + x.health_score, 0) / haList.length) : 0
    return {
      cluster_id: cl.id, cluster_name: cl.name, ha_enabled: cl.ha_enabled,
      host_failures_tolerated: cl.ha_enabled ? 1 : 0,
      avg_health_score: avg,
      healthy_hosts: haList.filter((x) => x.overall_status === 'healthy').length,
      total_hosts: clHosts.length,
      hosts: clHosts.map((h) => ({ id: h.id, name: h.name, ...getHostHA(h.id)! })),
    }
  })
}

/** 生成实时监控指标（带随机抖动，供 SSE 推送）。 */
export function genMetrics() {
  const jitter = (base: number, range: number) =>
    Math.max(0, Math.min(100, +(base + (Math.random() - 0.5) * range).toFixed(1)))
  return {
    ts: Date.now(),
    cluster: {
      cpu_usage: jitter(58, 8),
      mem_usage: jitter(64, 6),
      total_vcpus: 640, used_vcpus: 372,
      total_mem_tb: 4.6, used_mem_tb: 2.96,
    },
    gpus: mockData.gpus.map(g => ({
      id: g.id,
      util: g.status === 'assigned' && g.util > 0 ? jitter(g.util, 12) : (g.status === 'available' ? 0 : jitter(g.util, 5)),
      mem_used: g.mem_used,
      temp: g.temp > 0 ? jitter(g.temp, 4) : g.temp,
      power: g.power,
    })),
    hosts: mockData.hosts.filter(h => h.status === 'connected').map(h => ({
      id: h.id, cpu_usage: jitter(h.cpu_usage, 10),
    })),
  }
}
