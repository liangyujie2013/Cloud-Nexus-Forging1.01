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
    { id: 3, cluster_id: 2, name: 'gpu-local-nvme', type: 'local', capacity_tb: 8, used_tb: 5.1, shared: false, status: 'active', read_iops: 95000, write_iops: 78000, latency: 0.1 },
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

  // ===================== 访问控制 · 用户 =====================
  users: [
    { id: 1, username: 'administrator', display_name: '系统管理员', email: 'administrator@cnf.local', role_keys: ['role_admin'], source: 'local', is_active: true, last_login: '2026-06-24 09:31', created_at: '2026-01-15' },
    { id: 2, username: 'ops-wang', display_name: '王运维', email: 'ops-wang@cnf.local', role_keys: ['role_vm_admin'], source: 'ldap', is_active: true, last_login: '2026-06-24 08:50', created_at: '2026-02-01' },
    { id: 3, username: 'dev-zhang', display_name: '张开发', email: 'dev-zhang@cnf.local', role_keys: ['role_vm_user'], source: 'ldap', is_active: true, last_login: '2026-06-23 17:22', created_at: '2026-03-10' },
    { id: 4, username: 'net-li', display_name: '李网络', email: 'net-li@cnf.local', role_keys: ['role_network'], source: 'local', is_active: true, last_login: '2026-06-22 11:05', created_at: '2026-03-12' },
    { id: 5, username: 'audit', display_name: '审计员', email: 'audit@cnf.local', role_keys: ['role_readonly'], source: 'local', is_active: false, last_login: '2026-05-30 14:40', created_at: '2026-04-01' },
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
