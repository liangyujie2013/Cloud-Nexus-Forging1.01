// CNFv1.0 国际化（i18n）+ 主题系统
// 术语严格对齐 VMware vSphere 官方中英文 UI 命名，便于 vSphere 用户无缝迁移。
(function () {
const { ref, reactive } = Vue

// ============================ 词典 ============================
// 命名对齐 VMware vSphere：
//   集群 Cluster / 主机 Host / 资源池 Resource Pool / vMotion 迁移 /
//   DRS 分布式资源调度 / HA 高可用 / EVC 增强型 vMotion 兼容性 /
//   快照 Snapshot / 角色 Role / 权限 Privilege / 全局权限 Global Permissions
const dict = {
  zh: {
    // 品牌 & 通用
    brand_sub: '云原生基础平台',
    mode_demo: '原型演示模式',
    save: '保存', cancel: '取消', confirm: '确定', close: '关闭', apply: '应用',
    create: '创建', edit: '编辑', delete: '删除', search: '搜索', loading: '加载中…',
    enabled: '已启用', disabled: '已禁用', yes: '是', no: '否', actions: '操作',
    status: '状态', name: '名称', description: '说明', type: '类型', all: '全部',

    // 导航分组
    nav_overview: '清单与监控', nav_compute: '主机和集群', nav_ops: '虚拟机操作',
    nav_infra: '存储', nav_admin: '管理',
    // 导航项（VMware 对齐）
    nav_dashboard: '摘要', nav_topology: '主机和集群', nav_vms: '虚拟机',
    nav_gpu: 'GPU 监控', nav_migration: 'vMotion 迁移', nav_snapshot: '快照管理',
    nav_storage: '数据存储', nav_cluster_cfg: '集群设置', nav_permissions: '权限管理',
    nav_drs: 'DRS 迁移编排',

    // 顶栏标题
    title_dashboard: '摘要', title_topology: '主机和集群', title_vms: '虚拟机',
    title_gpu: 'GPU 监控', title_storage: '数据存储', title_migration: 'vMotion 迁移',
    title_snapshot: '快照管理', title_cluster_cfg: '集群设置',
    title_permissions: '权限管理', title_drs: 'DRS 迁移编排（拖拽）',

    // 用户
    user_admin: '管理员',
    appearance: '外观', language: '语言',
    theme_light: '浅色', theme_dim: '深灰', theme_dark: '纯黑',

    // 仪表盘
    dash_dc: '数据中心', dash_clusters: '集群', dash_hosts: '主机',
    dash_vms: '虚拟机', dash_gpus: 'GPU', dash_pools: '数据存储',
    dash_running: '运行中', dash_connected: '已连接', dash_assigned: '已分配',
    dash_cluster_cpu: '集群 CPU 使用率', dash_cluster_mem: '集群内存使用率',
    dash_realtime: '实时监控',

    // 虚拟机列表
    vm_count: '台虚拟机', vm_create: '新建虚拟机',
    col_name: '名称', col_status: '状态', col_cpu: 'CPU 拓扑', col_mem: '内存',
    col_pin_numa: '绑核 / NUMA', col_gpu: 'GPU', col_ha: 'HA', col_ip: 'IP 地址', col_load: '负载',
    st_running: '已打开电源', st_paused: '已暂停', st_stopped: '已关闭电源',
    pinned: '绑核', none: '—',

    // 拓扑
    topo_hint: '数据中心 → 集群 → 主机 → 虚拟机（点击展开）',
    vcpu: 'vCPU',

    // GPU
    gpu_util: 'GPU 利用率', gpu_vram: '显存', gpu_temp: '温度',
    gpu_power: '功耗', gpu_bound_vm: '绑定虚拟机', gpu_passthrough: '直通',
    gpu_idle: '空闲',

    // vMotion 迁移
    mig_start: '发起 vMotion 迁移', mig_vm: '虚拟机', mig_dst: '目标主机',
    mig_choose: '请选择…', mig_remain: '剩余',
    mig_live: '在线迁移（vMotion，不停机）', mig_storage: '存储 vMotion（非共享盘）',
    mig_compress: '压缩传输', mig_downtime: '最大停机 (ms)',
    mig_gpu_block: '该虚拟机绑定 GPU 直通设备，无法执行在线 vMotion；请改用冷迁移或先解绑 GPU。',
    mig_go: '开始迁移', mig_running: '迁移中…',
    mig_history: '迁移历史', mig_path: '路径', mig_mode: '模式',
    mig_downtime_col: '停机', mig_throughput: '吞吐',
    mig_online: '在线', mig_cold: '冷迁移', mig_success: '成功', mig_failed: '失败',
    phase_precopy: '内存预拷贝', phase_iterate: '脏页迭代收敛',
    phase_switch: '停机切换（downtime）', phase_done: '完成',

    // 快照
    snap_create: '创建快照', snap_vm: '虚拟机', snap_name: '快照名称',
    snap_desc: '说明', snap_with_mem: '包含虚拟机内存（含 NVRAM，可恢复运行态）',
    snap_quiesce: '静默客户机文件系统（VMware Tools 保证一致性）',
    snap_tip: '内存快照保存 vCPU/内存/NVRAM 状态，恢复后虚拟机回到精确时刻；仅磁盘快照更快更省空间。',
    snap_creating: '创建中…', snap_chain: '快照树', snap_current: '当前状态',
    snap_mem_nvram: '内存 + NVRAM', snap_disk_only: '仅磁盘', snap_quiesced: '已静默',
    snap_revert: '恢复到此处', snap_delete: '删除',

    // 集群设置
    cc_select: '选择集群', cc_ha: 'vSphere HA 高可用', cc_drs: 'vSphere DRS',
    cc_evc: 'EVC 模式', cc_overcommit: '资源超分配',
    cc_ha_desc: '主机故障时自动在其他主机重启受影响虚拟机',
    cc_drs_desc: '根据负载在主机间自动均衡虚拟机（vMotion）',
    cc_evc_desc: '增强型 vMotion 兼容性，确保跨 CPU 代际迁移',
    cc_drs_level: 'DRS 自动化级别', cc_manual: '手动', cc_partial: '半自动',
    cc_full: '全自动', cc_aggr: '迁移阈值（激进度）',
    cc_admission: '准入控制', cc_admission_desc: '预留故障切换容量，保证 HA 资源',
    cc_host_failures: '容许主机故障数', cc_cpu_over: 'CPU 超分配比', cc_mem_over: '内存超分配比',
    cc_evc_baseline: 'CPU 基线', cc_members: '集群成员主机', cc_saved: '集群设置已保存',

    // 权限管理（RBAC）
    perm_roles: '角色', perm_users: '用户与全局权限', perm_role_def: '角色定义',
    perm_add_role: '新建角色', perm_add_user: '分配权限',
    perm_privileges: '权限项', perm_assigned_to: '已分配对象',
    perm_role: '角色', perm_user: '用户/组', perm_scope: '作用域', perm_propagate: '向下传播',
    role_admin: '管理员', role_admin_desc: '完全管理权限（所有对象）',
    role_vm_admin: '虚拟机管理员', role_vm_admin_desc: '虚拟机创建/配置/电源操作',
    role_vm_user: '虚拟机用户', role_vm_user_desc: '控制台访问与电源操作',
    role_readonly: '只读', role_readonly_desc: '仅查看，不可修改',
    role_network: '网络管理员', role_network_desc: '网络与分布式交换机配置',
    priv_vm_create: '虚拟机.创建', priv_vm_config: '虚拟机.配置', priv_vm_power: '虚拟机.电源操作',
    priv_vm_console: '虚拟机.控制台交互', priv_vm_snapshot: '虚拟机.快照管理',
    priv_host_config: '主机.配置', priv_host_maint: '主机.维护模式',
    priv_cluster_config: '集群.配置', priv_ds_manage: '数据存储.管理',
    priv_net_config: '网络.配置', priv_perm_manage: '权限.管理', priv_global_settings: '全局.系统设置',
    perm_global: '全局', perm_dc: '数据中心', perm_cluster: '集群',

    // DRS 拖拽迁移
    drs_hint: '将虚拟机卡片拖拽到目标主机以发起 vMotion 迁移。系统自动校验资源与兼容性。',
    drs_capacity: '容量', drs_vms_on: '承载虚拟机', drs_drop_here: '拖放到此主机迁移',
    drs_recommend: 'DRS 建议', drs_balanced: '集群已均衡',
    drs_migrating: '正在迁移', drs_to: '至',
    drs_cannot_gpu: 'GPU 直通虚拟机不可在线迁移',
    drs_insufficient: '目标主机资源不足',
    drs_same_host: '已在该主机上',
    drs_apply_rec: '应用建议',

    // 仪表盘补充
    dash_clusters_n: '个集群', dash_connected_total: '已连接 / 总数',
    dash_running_total: '运行中 / 总数', dash_assigned_total: '已分配 / 总数',
    dash_cpu_live: '集群 CPU 利用率（实时）', dash_sse_live: 'SSE 实时',
    dash_pool_cap: '资源池容量', dash_vcpu_alloc: 'vCPU 分配', dash_mem_alloc: '内存分配',
    dash_mem_usage: '集群内存使用率', dash_recent_tasks: '最近任务',
    task_type: '任务类型', task_target: '目标', task_progress: '进度',
    task_operator: '操作者', task_time: '时间',
    task_running: '进行中', task_success: '成功', task_failed: '失败',
    host_machine: '宿主机',

    // 拓扑补充
    topo_full_hint: '数据中心 → 集群 → 主机 → 虚拟机 四层拓扑（点击展开）',
    pin_numa: '绑核 NUMA',

    // GPU 补充
    gpu_vgpu: 'vGPU',

    // 存储补充
    st_capacity: '容量', st_read_iops: '读 IOPS', st_write_iops: '写 IOPS',
    st_latency: '延迟', st_active: '活跃', st_shared: '共享存储', st_local: '本地存储',

    // 迁移控制台补充
    mig_console_title: '发起热迁移', mig_target_host: '目标宿主机',
    mig_live2: '在线热迁移（不停机）', mig_storage2: '存储迁移（非共享盘）',
    mig_progress_throughput: '吞吐', mig_progress_remaining: '剩余',
    mig_progress_status: '状态', mig_done: '完成', mig_in_progress: '进行中',
    mig_phase_precopy: '内存预拷贝', mig_current_host: '当前宿主机',
    mig_col_storage: '存储',

    // 快照补充
    snap_create_title: '创建快照', snap_name_ph: '如 before-upgrade-v3',
    snap_desc_ph: '可选', snap_mem_label: '内存快照（含 NVRAM，可恢复运行态）',
    snap_quiesce_label: 'guest-agent 冻结（保证磁盘一致性）',
    snap_info: '内存快照保存 vCPU/内存/NVRAM 状态，恢复后 VM 回到精确时刻；仅磁盘快照更快更省空间。',
    snap_chain_title: '快照链', snap_rollback: '回滚', snap_quiesced2: '已冻结',

    // 向导
    wiz_title: '创建虚拟机',
    wiz_s1: '基本信息', wiz_s2: 'CPU 拓扑', wiz_s3: 'NUMA 亲和', wiz_s4: 'CPU 绑核',
    wiz_s5: '内存', wiz_s6: '磁盘 & 网络', wiz_s7: 'GPU 设备', wiz_s8: '预览 & 创建',
    wiz_vm_name: '虚拟机名称', wiz_target_host: '目标宿主机', wiz_arch: '客户机架构',
    wiz_machine: '机器类型', wiz_sockets: 'CPU 插槽 (Sockets)', wiz_cores: '每插槽核心 (Cores)',
    wiz_threads: '每核心线程 (Threads)', wiz_cpu_mode: 'CPU 模式', wiz_total_vcpu: '总 vCPU 数',
    wiz_numa_hint: '将 VM 的内存与 vCPU 绑定到同一 NUMA 节点可显著降低内存访问延迟（避免跨 NUMA）。',
    wiz_no_numa: '不绑定 NUMA', wiz_no_numa_desc: '由调度器自由分配，灵活但可能跨节点',
    wiz_numa0_desc: 'CPU 0-63 · 本地内存 256GB', wiz_numa1_desc: 'CPU 64-127 · 本地内存 256GB',
    wiz_numa_node: 'NUMA 节点',
    wiz_enable_pin: '启用 CPU 绑核（独享物理核）', wiz_auto_pin: '自动绑定',
    wiz_pin_hint: '点击选择，蓝=已绑定，紫框=NUMA1', wiz_selected: '已选',
    wiz_no_pin: '未启用绑核，vCPU 将由 CFS 调度器动态分配到物理核。',
    wiz_mem_mb: '内存大小 (MB)', wiz_hugepages: '启用大页内存（HugePages，降低 TLB miss）',
    wiz_disk: '磁盘', wiz_disk_size: '大小 (GB)', wiz_disk_bus: '总线', wiz_disk_format: '格式',
    wiz_iops: 'IOPS 限制', wiz_nic: '网卡', wiz_bridge: '网桥 (OVS)', wiz_vlan: 'VLAN ID',
    wiz_mac: 'MAC 地址', wiz_model: '模型',
    wiz_gpu_hint: '选择要直通/分配给该 VM 的 GPU（需主机启用 IOMMU/VFIO）。',
    wiz_no_gpu: '该主机无可用 GPU。',
    wiz_xml_preview: 'libvirt Domain XML 预览', wiz_refresh: '刷新',
    wiz_xml_hint: '此 XML 由真实生成逻辑产出（与 Go 后端 internal/virt 一致），可直接 virsh define。',
    wiz_vm_status: '状态', wiz_prev: '上一步', wiz_next: '下一步',
    wiz_step: '步骤', wiz_creating: '创建中...', wiz_create: '创建虚拟机', wiz_finish: '完成',
    wiz_optional: '可选',
  },
  en: {
    brand_sub: 'Cloud Native Foundation',
    mode_demo: 'Prototype Demo',
    save: 'Save', cancel: 'Cancel', confirm: 'OK', close: 'Close', apply: 'Apply',
    create: 'Create', edit: 'Edit', delete: 'Delete', search: 'Search', loading: 'Loading…',
    enabled: 'Enabled', disabled: 'Disabled', yes: 'Yes', no: 'No', actions: 'Actions',
    status: 'Status', name: 'Name', description: 'Description', type: 'Type', all: 'All',

    nav_overview: 'Inventory & Monitor', nav_compute: 'Hosts & Clusters', nav_ops: 'VM Operations',
    nav_infra: 'Storage', nav_admin: 'Administration',
    nav_dashboard: 'Summary', nav_topology: 'Hosts & Clusters', nav_vms: 'Virtual Machines',
    nav_gpu: 'GPU Monitor', nav_migration: 'vMotion', nav_snapshot: 'Snapshots',
    nav_storage: 'Datastores', nav_cluster_cfg: 'Cluster Settings', nav_permissions: 'Permissions',
    nav_drs: 'DRS Orchestration',

    title_dashboard: 'Summary', title_topology: 'Hosts & Clusters', title_vms: 'Virtual Machines',
    title_gpu: 'GPU Monitor', title_storage: 'Datastores', title_migration: 'vMotion Migration',
    title_snapshot: 'Snapshot Manager', title_cluster_cfg: 'Cluster Settings',
    title_permissions: 'Permission Management', title_drs: 'DRS Orchestration (Drag & Drop)',

    user_admin: 'Administrator',
    appearance: 'Appearance', language: 'Language',
    theme_light: 'Light', theme_dim: 'Dim', theme_dark: 'Black',

    dash_dc: 'Datacenters', dash_clusters: 'Clusters', dash_hosts: 'Hosts',
    dash_vms: 'Virtual Machines', dash_gpus: 'GPUs', dash_pools: 'Datastores',
    dash_running: 'Running', dash_connected: 'Connected', dash_assigned: 'Assigned',
    dash_cluster_cpu: 'Cluster CPU Usage', dash_cluster_mem: 'Cluster Memory Usage',
    dash_realtime: 'Real-time Monitor',

    vm_count: 'virtual machines', vm_create: 'New Virtual Machine',
    col_name: 'Name', col_status: 'State', col_cpu: 'CPU Topology', col_mem: 'Memory',
    col_pin_numa: 'Pinning / NUMA', col_gpu: 'GPU', col_ha: 'HA', col_ip: 'IP Address', col_load: 'Load',
    st_running: 'Powered On', st_paused: 'Suspended', st_stopped: 'Powered Off',
    pinned: 'Pinned', none: '—',

    topo_hint: 'Datacenter → Cluster → Host → VM (click to expand)',
    vcpu: 'vCPU',

    gpu_util: 'GPU Utilization', gpu_vram: 'VRAM', gpu_temp: 'Temp',
    gpu_power: 'Power', gpu_bound_vm: 'Bound VM', gpu_passthrough: 'Passthrough',
    gpu_idle: 'Idle',

    mig_start: 'Start vMotion', mig_vm: 'Virtual Machine', mig_dst: 'Target Host',
    mig_choose: 'Select…', mig_remain: 'free',
    mig_live: 'Live Migration (vMotion, zero downtime)', mig_storage: 'Storage vMotion (non-shared disk)',
    mig_compress: 'Compressed transfer', mig_downtime: 'Max Downtime (ms)',
    mig_gpu_block: 'This VM has GPU passthrough and cannot be live-migrated; use cold migration or detach the GPU first.',
    mig_go: 'Start Migration', mig_running: 'Migrating…',
    mig_history: 'Migration History', mig_path: 'Path', mig_mode: 'Mode',
    mig_downtime_col: 'Downtime', mig_throughput: 'Throughput',
    mig_online: 'Live', mig_cold: 'Cold', mig_success: 'Success', mig_failed: 'Failed',
    phase_precopy: 'Memory pre-copy', phase_iterate: 'Dirty-page convergence',
    phase_switch: 'Stop-and-switch (downtime)', phase_done: 'Completed',

    snap_create: 'Create Snapshot', snap_vm: 'Virtual Machine', snap_name: 'Snapshot Name',
    snap_desc: 'Description', snap_with_mem: 'Snapshot VM memory (incl. NVRAM, restorable running state)',
    snap_quiesce: 'Quiesce guest file system (VMware Tools consistency)',
    snap_tip: 'Memory snapshots capture vCPU/RAM/NVRAM state to restore the exact moment; disk-only snapshots are faster and smaller.',
    snap_creating: 'Creating…', snap_chain: 'Snapshot Tree', snap_current: 'You are here',
    snap_mem_nvram: 'Memory + NVRAM', snap_disk_only: 'Disk only', snap_quiesced: 'Quiesced',
    snap_revert: 'Revert to', snap_delete: 'Delete',

    cc_select: 'Select Cluster', cc_ha: 'vSphere HA', cc_drs: 'vSphere DRS',
    cc_evc: 'EVC Mode', cc_overcommit: 'Resource Overcommit',
    cc_ha_desc: 'Restart affected VMs on other hosts when a host fails',
    cc_drs_desc: 'Automatically balance VMs across hosts by load (vMotion)',
    cc_evc_desc: 'Enhanced vMotion Compatibility for migration across CPU generations',
    cc_drs_level: 'DRS Automation Level', cc_manual: 'Manual', cc_partial: 'Partially Automated',
    cc_full: 'Fully Automated', cc_aggr: 'Migration Threshold (Aggressiveness)',
    cc_admission: 'Admission Control', cc_admission_desc: 'Reserve failover capacity to guarantee HA',
    cc_host_failures: 'Host failures to tolerate', cc_cpu_over: 'CPU Overcommit', cc_mem_over: 'Memory Overcommit',
    cc_evc_baseline: 'CPU Baseline', cc_members: 'Cluster Member Hosts', cc_saved: 'Cluster settings saved',

    perm_roles: 'Roles', perm_users: 'Users & Global Permissions', perm_role_def: 'Role Definitions',
    perm_add_role: 'New Role', perm_add_user: 'Assign Permission',
    perm_privileges: 'Privileges', perm_assigned_to: 'Assignments',
    perm_role: 'Role', perm_user: 'User/Group', perm_scope: 'Scope', perm_propagate: 'Propagate',
    role_admin: 'Administrator', role_admin_desc: 'Full administrative rights (all objects)',
    role_vm_admin: 'VM Administrator', role_vm_admin_desc: 'VM create/configure/power operations',
    role_vm_user: 'VM User', role_vm_user_desc: 'Console access and power operations',
    role_readonly: 'Read-Only', role_readonly_desc: 'View only, no modifications',
    role_network: 'Network Admin', role_network_desc: 'Network & distributed switch configuration',
    priv_vm_create: 'VM.Create', priv_vm_config: 'VM.Configure', priv_vm_power: 'VM.Power Operations',
    priv_vm_console: 'VM.Console Interaction', priv_vm_snapshot: 'VM.Snapshot Management',
    priv_host_config: 'Host.Configuration', priv_host_maint: 'Host.Maintenance Mode',
    priv_cluster_config: 'Cluster.Configure', priv_ds_manage: 'Datastore.Manage',
    priv_net_config: 'Network.Configure', priv_perm_manage: 'Permissions.Manage', priv_global_settings: 'Global.System Settings',
    perm_global: 'Global', perm_dc: 'Datacenter', perm_cluster: 'Cluster',

    drs_hint: 'Drag a VM card onto a target host to start vMotion. The system validates resources and compatibility automatically.',
    drs_capacity: 'Capacity', drs_vms_on: 'VMs hosted', drs_drop_here: 'Drop here to migrate',
    drs_recommend: 'DRS Recommendations', drs_balanced: 'Cluster is balanced',
    drs_migrating: 'Migrating', drs_to: 'to',
    drs_cannot_gpu: 'GPU-passthrough VM cannot be live-migrated',
    drs_insufficient: 'Insufficient resources on target host',
    drs_same_host: 'Already on this host',
    drs_apply_rec: 'Apply Recommendation',

    dash_clusters_n: 'clusters', dash_connected_total: 'Connected / Total',
    dash_running_total: 'Running / Total', dash_assigned_total: 'Assigned / Total',
    dash_cpu_live: 'Cluster CPU Usage (Live)', dash_sse_live: 'SSE Live',
    dash_pool_cap: 'Resource Pool Capacity', dash_vcpu_alloc: 'vCPU Allocation', dash_mem_alloc: 'Memory Allocation',
    dash_mem_usage: 'Cluster Memory Usage', dash_recent_tasks: 'Recent Tasks',
    task_type: 'Task Type', task_target: 'Target', task_progress: 'Progress',
    task_operator: 'Operator', task_time: 'Time',
    task_running: 'In Progress', task_success: 'Success', task_failed: 'Failed',
    host_machine: 'Hosts',

    topo_full_hint: 'Datacenter → Cluster → Host → VM four-tier topology (click to expand)',
    pin_numa: 'Pinned NUMA',

    gpu_vgpu: 'vGPU',

    st_capacity: 'Capacity', st_read_iops: 'Read IOPS', st_write_iops: 'Write IOPS',
    st_latency: 'Latency', st_active: 'Active', st_shared: 'Shared Storage', st_local: 'Local Storage',

    mig_console_title: 'Start Live Migration', mig_target_host: 'Target Host',
    mig_live2: 'Live migration (zero downtime)', mig_storage2: 'Storage migration (non-shared disk)',
    mig_progress_throughput: 'Throughput', mig_progress_remaining: 'Remaining',
    mig_progress_status: 'Status', mig_done: 'Completed', mig_in_progress: 'In Progress',
    mig_phase_precopy: 'Memory pre-copy', mig_current_host: 'Current Host',
    mig_col_storage: 'Storage',

    snap_create_title: 'Create Snapshot', snap_name_ph: 'e.g. before-upgrade-v3',
    snap_desc_ph: 'Optional', snap_mem_label: 'Memory snapshot (incl. NVRAM, restorable running state)',
    snap_quiesce_label: 'guest-agent quiesce (disk consistency)',
    snap_info: 'Memory snapshots capture vCPU/RAM/NVRAM state to restore the exact moment; disk-only snapshots are faster and smaller.',
    snap_chain_title: 'Snapshot Tree', snap_rollback: 'Revert', snap_quiesced2: 'Quiesced',

    wiz_title: 'Create Virtual Machine',
    wiz_s1: 'Basic Info', wiz_s2: 'CPU Topology', wiz_s3: 'NUMA Affinity', wiz_s4: 'CPU Pinning',
    wiz_s5: 'Memory', wiz_s6: 'Disk & Network', wiz_s7: 'GPU Devices', wiz_s8: 'Review & Create',
    wiz_vm_name: 'VM Name', wiz_target_host: 'Target Host', wiz_arch: 'Guest Architecture',
    wiz_machine: 'Machine Type', wiz_sockets: 'CPU Sockets', wiz_cores: 'Cores per Socket',
    wiz_threads: 'Threads per Core', wiz_cpu_mode: 'CPU Mode', wiz_total_vcpu: 'Total vCPUs',
    wiz_numa_hint: 'Binding VM memory and vCPUs to the same NUMA node significantly reduces memory latency (avoids cross-NUMA).',
    wiz_no_numa: 'No NUMA binding', wiz_no_numa_desc: 'Freely scheduled, flexible but may cross nodes',
    wiz_numa0_desc: 'CPU 0-63 · Local memory 256GB', wiz_numa1_desc: 'CPU 64-127 · Local memory 256GB',
    wiz_numa_node: 'NUMA Node',
    wiz_enable_pin: 'Enable CPU pinning (dedicated physical cores)', wiz_auto_pin: 'Auto Pin',
    wiz_pin_hint: 'Click to select; blue=pinned, purple border=NUMA1', wiz_selected: 'Selected',
    wiz_no_pin: 'Pinning disabled; vCPUs will be scheduled dynamically by CFS across physical cores.',
    wiz_mem_mb: 'Memory Size (MB)', wiz_hugepages: 'Enable HugePages (reduce TLB miss)',
    wiz_disk: 'Disk', wiz_disk_size: 'Size (GB)', wiz_disk_bus: 'Bus', wiz_disk_format: 'Format',
    wiz_iops: 'IOPS Limit', wiz_nic: 'NIC', wiz_bridge: 'Bridge (OVS)', wiz_vlan: 'VLAN ID',
    wiz_mac: 'MAC Address', wiz_model: 'Model',
    wiz_gpu_hint: 'Select GPU(s) to pass through/assign to this VM (host must enable IOMMU/VFIO).',
    wiz_no_gpu: 'No GPU available on this host.',
    wiz_xml_preview: 'libvirt Domain XML Preview', wiz_refresh: 'Refresh',
    wiz_xml_hint: 'This XML is produced by the real generation logic (matching Go backend internal/virt) and is directly virsh-define-able.',
    wiz_vm_status: 'Status', wiz_prev: 'Previous', wiz_next: 'Next',
    wiz_step: 'Step', wiz_creating: 'Creating...', wiz_create: 'Create VM', wiz_finish: 'Finish',
    wiz_optional: 'Optional',
  },
}

// ============================ 响应式状态 ============================
const saved = localStorage.getItem('cnf_locale')
const locale = ref(saved === 'en' ? 'en' : 'zh')

// 翻译函数：t('key') 返回当前语言文案，缺失回退到 key
function t(key) {
  const table = dict[locale.value] || dict.zh
  return table[key] !== undefined ? table[key] : (dict.zh[key] !== undefined ? dict.zh[key] : key)
}

function setLocale(l) {
  locale.value = l
  localStorage.setItem('cnf_locale', l)
  document.documentElement.setAttribute('lang', l === 'en' ? 'en' : 'zh-CN')
}

// ============================ 主题（白/深灰/黑）============================
const savedTheme = localStorage.getItem('cnf_theme') || 'light'
const theme = ref(savedTheme)
function setTheme(name) {
  theme.value = name
  localStorage.setItem('cnf_theme', name)
  document.documentElement.setAttribute('data-theme', name)
}

// 初始化应用
document.documentElement.setAttribute('data-theme', theme.value)
document.documentElement.setAttribute('lang', locale.value === 'en' ? 'en' : 'zh-CN')

window.i18n = reactive({ locale })
window.t = t
window.setLocale = setLocale
window.cnfTheme = reactive({ theme })
window.setTheme = setTheme
window.THEMES = ['light', 'dim', 'dark']
window.LOCALES = ['zh', 'en']
})()
