// 路径B 原型的模拟数据集：数据中心/集群/主机/VM/GPU/存储。
export const mockData = {
  datacenters: [
    { id: 1, name: '北京一区 (DC-Beijing-01)', location: '北京·亦庄', clusters: 2, hosts: 6, vms: 38 },
    { id: 2, name: '上海二区 (DC-Shanghai-02)', location: '上海·临港', clusters: 1, hosts: 3, vms: 17 },
  ],
  clusters: [
    { id: 1, datacenter_id: 1, name: '生产集群 Prod-A', ha_enabled: true, drs_enabled: true, overcommit_cpu: 4.0, hosts: 4, vms: 28, evc_mode: 'Intel Cascade Lake' },
    { id: 2, datacenter_id: 1, name: 'GPU 计算集群 GPU-Compute', ha_enabled: true, drs_enabled: false, overcommit_cpu: 1.0, hosts: 2, vms: 10, evc_mode: 'Intel Ice Lake' },
    { id: 3, datacenter_id: 2, name: '测试集群 Test-B', ha_enabled: false, drs_enabled: false, overcommit_cpu: 8.0, hosts: 3, vms: 17, evc_mode: '-' },
  ],
  hosts: [
    { id: 1, cluster_id: 1, name: 'node-prod-01', ip: '10.0.1.11', status: 'connected', cpu_model: 'Xeon Gold 6248R', sockets: 2, cores: 24, threads: 2, vcpus: 96, numa_nodes: 2, mem_total_gb: 512, mem_used_gb: 318, cpu_usage: 62, vms: 8, gpus: 0, iommu: true },
    { id: 2, cluster_id: 1, name: 'node-prod-02', ip: '10.0.1.12', status: 'connected', cpu_model: 'Xeon Gold 6248R', sockets: 2, cores: 24, threads: 2, vcpus: 96, numa_nodes: 2, mem_total_gb: 512, mem_used_gb: 276, cpu_usage: 48, vms: 7, gpus: 0, iommu: true },
    { id: 3, cluster_id: 1, name: 'node-prod-03', ip: '10.0.1.13', status: 'connected', cpu_model: 'Xeon Gold 6248R', sockets: 2, cores: 24, threads: 2, vcpus: 96, numa_nodes: 2, mem_total_gb: 512, mem_used_gb: 401, cpu_usage: 78, vms: 9, gpus: 0, iommu: true },
    { id: 4, cluster_id: 1, name: 'node-prod-04', ip: '10.0.1.14', status: 'maintenance', cpu_model: 'Xeon Gold 6248R', sockets: 2, cores: 24, threads: 2, vcpus: 96, numa_nodes: 2, mem_total_gb: 512, mem_used_gb: 0, cpu_usage: 0, vms: 0, gpus: 0, iommu: true },
    { id: 5, cluster_id: 2, name: 'gpu-node-01', ip: '10.0.2.11', status: 'connected', cpu_model: 'Xeon Platinum 8358', sockets: 2, cores: 32, threads: 2, vcpus: 128, numa_nodes: 2, mem_total_gb: 1024, mem_used_gb: 612, cpu_usage: 55, vms: 5, gpus: 4, iommu: true },
    { id: 6, cluster_id: 2, name: 'gpu-node-02', ip: '10.0.2.12', status: 'connected', cpu_model: 'Xeon Platinum 8358', sockets: 2, cores: 32, threads: 2, vcpus: 128, numa_nodes: 2, mem_total_gb: 1024, mem_used_gb: 720, cpu_usage: 71, vms: 5, gpus: 4, iommu: true },
  ],
  vms: [
    { id: 1, host_id: 1, name: 'web-prod-01', status: 'running', vcpus: 8, sockets: 2, cores: 2, threads: 2, mem_gb: 16, cpu_pinning: true, numa: 0, os: 'Rocky Linux 9', ha: true, gpus: 0, ip: '10.10.1.21', cpu_usage: 34, mem_usage: 58 },
    { id: 2, host_id: 1, name: 'db-postgres-01', status: 'running', vcpus: 16, sockets: 2, cores: 4, threads: 2, mem_gb: 64, cpu_pinning: true, numa: 1, os: 'Rocky Linux 9', ha: true, gpus: 0, ip: '10.10.1.22', cpu_usage: 67, mem_usage: 81 },
    { id: 3, host_id: 2, name: 'app-server-01', status: 'running', vcpus: 4, sockets: 1, cores: 4, threads: 1, mem_gb: 8, cpu_pinning: false, numa: -1, os: 'Ubuntu 22.04', ha: false, gpus: 0, ip: '10.10.1.23', cpu_usage: 22, mem_usage: 45 },
    { id: 4, host_id: 3, name: 'cache-redis-01', status: 'running', vcpus: 4, sockets: 1, cores: 2, threads: 2, mem_gb: 32, cpu_pinning: true, numa: 0, os: 'Rocky Linux 9', ha: true, gpus: 0, ip: '10.10.1.24', cpu_usage: 18, mem_usage: 72 },
    { id: 5, host_id: 5, name: 'ai-training-01', status: 'running', vcpus: 32, sockets: 2, cores: 8, threads: 2, mem_gb: 256, cpu_pinning: true, numa: 0, os: 'Ubuntu 22.04 + CUDA', ha: false, gpus: 2, ip: '10.10.2.31', cpu_usage: 89, mem_usage: 76 },
    { id: 6, host_id: 5, name: 'ai-inference-01', status: 'running', vcpus: 16, sockets: 1, cores: 16, threads: 1, mem_gb: 128, cpu_pinning: true, numa: 1, os: 'Ubuntu 22.04 + CUDA', ha: false, gpus: 1, ip: '10.10.2.32', cpu_usage: 64, mem_usage: 52 },
    { id: 7, host_id: 6, name: 'ai-training-02', status: 'paused', vcpus: 32, sockets: 2, cores: 8, threads: 2, mem_gb: 256, cpu_pinning: true, numa: 0, os: 'Ubuntu 22.04 + CUDA', ha: false, gpus: 2, ip: '10.10.2.33', cpu_usage: 0, mem_usage: 30 },
    { id: 8, host_id: 2, name: 'test-vm-08', status: 'stopped', vcpus: 2, sockets: 1, cores: 2, threads: 1, mem_gb: 4, cpu_pinning: false, numa: -1, os: 'CentOS Stream 9', ha: false, gpus: 0, ip: '-', cpu_usage: 0, mem_usage: 0 },
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
  // 集群高级配置（HA / DRS / EVC / 超分配）
  cluster_configs: [
    {
      id: 1, name: '生产集群 Prod-A',
      ha_enabled: true, ha_admission_control: true, ha_host_failures: 1,
      drs_enabled: true, drs_automation: 'full', drs_aggressiveness: 3,
      evc_enabled: true, evc_baseline: 'Intel Cascade Lake',
      overcommit_cpu: 4.0, overcommit_mem: 1.5,
    },
    {
      id: 2, name: 'GPU 计算集群 GPU-Compute',
      ha_enabled: true, ha_admission_control: false, ha_host_failures: 1,
      drs_enabled: false, drs_automation: 'manual', drs_aggressiveness: 2,
      evc_enabled: true, evc_baseline: 'Intel Ice Lake',
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
  // RBAC 角色定义（对齐 vSphere 角色/权限模型）
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
