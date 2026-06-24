// Cloud Nexus Forging (CNF) v1.0.1 国际化（i18n）+ 主题系统
// 术语采用 CNF 自有中性命名，不包含任何第三方产品名。
// i18n key 命名自解释：模块前缀_含义（nav_mod_* 模块 / nav_<mod>_* 子菜单 / lic_* License / acc_* 访问控制 …）。
(function () {
const { ref, reactive } = Vue

// ============================ 词典 ============================
// CNF 自有术语：
//   集群 / 主机 / 资源池 / 在线迁移 /
//   动态资源调度 / 高可用(HA) / CPU 兼容模式 /
//   快照 / 角色 / 权限 / 全局权限
const dict = {
  zh: {
    // 品牌 & 通用
    brand_name: 'Cloud Nexus Forging', brand_abbr: 'CNF', brand_version: 'v1.0.1',
    brand_sub: '企业级分布式虚拟化管理平台',
    mode_demo: '原型演示模式',
    save: '保存', cancel: '取消', confirm: '确定', close: '关闭', apply: '应用',
    create: '创建', edit: '编辑', delete: '删除', search: '搜索', loading: '加载中…',
    enabled: '已启用', disabled: '已禁用', yes: '是', no: '否', actions: '操作',
    status: '状态', name: '名称', description: '说明', type: '类型', all: '全部',

    // 导航分组
    nav_overview: '清单与监控', nav_compute: '主机和集群', nav_ops: '虚拟机操作',
    nav_infra: '存储', nav_admin: '管理',
    // 导航项
    nav_dashboard: '摘要', nav_topology: '主机和集群', nav_vms: '虚拟机',
    nav_gpu: 'GPU 监控', nav_migration: '在线迁移', nav_snapshot: '快照管理',
    nav_storage: '数据存储', nav_cluster_cfg: '集群设置', nav_permissions: '权限管理',
    nav_drs: '资源调度编排',

    // 顶栏标题
    title_dashboard: '摘要', title_topology: '主机和集群', title_vms: '虚拟机',
    title_gpu: 'GPU 监控', title_storage: '数据存储', title_migration: '在线迁移',
    title_snapshot: '快照管理', title_cluster_cfg: '集群设置',
    title_permissions: '权限管理', title_drs: '资源调度编排（拖拽）',

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

    // 在线迁移
    mig_start: '发起在线迁移', mig_vm: '虚拟机', mig_dst: '目标主机',
    mig_choose: '请选择…', mig_remain: '剩余',
    mig_live: '在线迁移（不停机）', mig_storage: '存储迁移（非共享盘）',
    mig_compress: '压缩传输', mig_downtime: '最大停机 (ms)',
    mig_gpu_block: '该虚拟机绑定 GPU 直通设备，无法执行在线迁移；请改用冷迁移或先解绑 GPU。',
    mig_go: '开始迁移', mig_running: '迁移中…',
    mig_history: '迁移历史', mig_path: '路径', mig_mode: '模式',
    mig_downtime_col: '停机', mig_throughput: '吞吐',
    mig_online: '在线', mig_cold: '冷迁移', mig_success: '成功', mig_failed: '失败',
    phase_precopy: '内存预拷贝', phase_iterate: '脏页迭代收敛',
    phase_switch: '停机切换（downtime）', phase_done: '完成',

    // 快照
    snap_create: '创建快照', snap_vm: '虚拟机', snap_name: '快照名称',
    snap_desc: '说明', snap_with_mem: '包含虚拟机内存（含 NVRAM，可恢复运行态）',
    snap_quiesce: '静默客户机文件系统（CNF 客户机增强工具保证一致性）',
    snap_tip: '内存快照保存 vCPU/内存/NVRAM 状态，恢复后虚拟机回到精确时刻；仅磁盘快照更快更省空间。',
    snap_creating: '创建中…', snap_chain: '快照树', snap_current: '当前状态',
    snap_mem_nvram: '内存 + NVRAM', snap_disk_only: '仅磁盘', snap_quiesced: '已静默',
    snap_revert: '恢复到此处', snap_delete: '删除',

    // 集群设置
    cc_select: '选择集群', cc_ha: '高可用（HA）', cc_drs: '动态资源调度',
    cc_evc: 'CPU 兼容模式', cc_overcommit: '资源超分配',
    cc_ha_desc: '主机故障时自动在其他主机重启受影响虚拟机',
    cc_drs_desc: '根据负载在主机间自动均衡虚拟机（在线迁移）',
    cc_evc_desc: 'CPU 兼容模式，确保跨 CPU 代际迁移',
    cc_drs_level: '资源调度自动化级别', cc_manual: '手动', cc_partial: '半自动',
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

    // 资源调度拖拽迁移
    drs_hint: '将虚拟机卡片拖拽到目标主机以发起在线迁移。系统自动校验资源与兼容性。',
    drs_capacity: '容量', drs_vms_on: '承载虚拟机', drs_drop_here: '拖放到此主机迁移',
    drs_recommend: '调度建议', drs_balanced: '集群已均衡',
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
    // ===== 资源拓扑树 =====
    topo_tree_title: '资源拓扑',
    topo_belongs: '归属',
    // ===== 添加主机向导（节点纳管）=====
    hw_title: '添加主机到集群',
    hw_step1: '选择集群', hw_step2: '连接信息', hw_step3: '环境预检', hw_step4: '纳管部署',
    hw_datacenter: '数据中心', hw_target_cluster: '目标集群',
    hw_select_dc: '请选择数据中心', hw_select_cluster: '请选择目标集群', hw_select_dc_first: '请先选择数据中心',
    hw_cluster_info: '集群说明', hw_cluster_ha: 'HA 状态', hw_cluster_hosts: '当前主机',
    hw_hostname: '主机名', hw_mgmt_ip: '管理 IP', hw_ssh_port: 'SSH 端口', hw_ssh_user: 'SSH 用户', hw_ssh_pass: 'SSH 密码',
    hw_err_ip: 'IP 地址格式不正确', hw_err_ip_dup: '该 IP 已被其他主机占用',
    hw_precheck_hint: '正在检查目标主机的虚拟化环境与连通性',
    hw_check_net: '网络连通性检查', hw_check_virt: 'CPU 虚拟化支持', hw_check_mem: '内存容量检查', hw_check_ssh: 'SSH 连接验证',
    hw_check_wait: '等待检查', hw_check_running: '检查中…',
    hw_dep_connect: '正在连接主机…', hw_dep_virt: '安装虚拟化组件…', hw_dep_vswitch: '配置虚拟交换机…',
    hw_dep_agent: '部署管理 Agent…', hw_dep_register: '注册到集群…', hw_dep_sync: '同步网络配置…', hw_dep_done: '部署完成！',
    hw_dep_ready: '点击「开始部署」执行节点纳管', hw_dep_success: '主机 {host} 已成功加入集群 {cluster}', hw_dep_failed: '部署失败，请检查连接信息', 
    hw_prev: '上一步', hw_next: '下一步', hw_run_precheck: '开始预检', hw_start_deploy: '开始部署', hw_finish: '完成',
    hw_add_host: '添加主机',
    // ===== 主机硬件型号 =====
    host_nic_model: '网卡', host_raid_model: 'RAID 卡', host_disk_model: '硬盘',
    host_cluster: '所属集群', host_dc: '所属数据中心', host_vms_running: '运行中 VM',
    // ===== VM 迁移（同集群约束）=====
    mig_title: '虚拟机迁移', mig_select_target: '请选择迁移目标主机', mig_no_target: '当前集群内没有其他可用主机进行迁移',
    mig_same_cluster: '仅可迁移至同集群内的在线主机', mig_cpu_free: 'CPU 余量', mig_mem_free: '内存余量',
    mig_in_progress: '正在将 {vm} 迁移到 {host}…', mig_success: '{vm} 已成功迁移到 {host}', mig_start: '开始迁移',
    // ===== 级联删除校验 =====
    del_blocked_title: '无法删除', del_dc_has_cluster: '数据中心下仍有集群，请先移除集群',
    del_cluster_has_host: '集群下仍有主机，请先移除主机', del_host_has_vm: '主机上仍有运行中的虚拟机，请先迁移或关机',
    del_blocked_children: '关联对象', op_remove: '移除',

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
    wiz_xml_hint: '此 XML 由后端虚拟化引擎生成，可直接 virsh define。',
    wiz_vm_status: '状态', wiz_prev: '上一步', wiz_next: '下一步',
    wiz_step: '步骤', wiz_creating: '创建中...', wiz_create: '创建虚拟机', wiz_finish: '完成',
    wiz_optional: '可选',

    // ===== 9 模块导航（nav_mod_* 模块名 / nav_<mod>_* 子菜单） =====
    nav_mod_dashboard: '仪表板', nav_mod_infrastructure: '基础设施', nav_mod_compute: '计算资源',
    nav_mod_availability: '可用性管理', nav_mod_storage: '存储管理', nav_mod_network: '网络管理',
    nav_mod_monitoring: '监控告警', nav_mod_access: '访问控制', nav_mod_system: '系统设置',
    nav_dash_overview: '资源概览', nav_dash_performance: '性能监控', nav_dash_alerts: '告警摘要',
    nav_infra_datacenter: '数据中心', nav_infra_clusters: '集群管理', nav_infra_hosts: '主机节点', nav_infra_pools: '资源池',
    nav_compute_vms: '虚拟机列表', nav_compute_templates: '模板管理', nav_compute_isos: 'ISO 镜像',
    nav_avail_ha: 'HA 配置', nav_avail_migration: '迁移中心', nav_avail_backup: '备份恢复',
    nav_storage_pools: '存储池', nav_storage_volumes: '卷管理', nav_storage_snapshots: '快照树',
    nav_net_vswitch: '虚拟交换机', nav_net_vlan: 'VLAN 配置', nav_net_topology: '网络拓扑',
    nav_mon_realtime: '实时监控', nav_mon_history: '历史性能', nav_mon_rules: '告警规则',
    nav_acc_users: '用户管理', nav_acc_roles: '角色权限', nav_acc_audit: '操作审计',
    nav_sys_config: '基础配置', nav_sys_license: 'License 管理', nav_sys_about: '关于系统',

    // ===== 顶部工具栏 =====
    tb_search_ph: '搜索虚拟机 / 主机 / 任务…', tb_notifications: '通知中心',
    tb_mark_all_read: '全部已读', tb_no_notifications: '暂无通知', tb_logout: '退出登录',

    // ===== 仪表板补充 =====
    dash_clusters_n: '个集群', dash_connected: '已连接', dash_connected_total: '台主机在线',
    dash_assigned_total: '块 GPU 已分配', dash_gpus: 'GPU 加速卡',
    dash_vcpu_alloc: 'vCPU 分配', dash_mem_alloc: '内存分配', dash_recent_tasks: '最近任务',
    dash_sse_live: '实时数据流',
    task_target: '目标对象', task_time: '时间', task_progress: '进度',
    task_success: '成功', task_failed: '失败',

    // ===== 计算资源 · 模板 / ISO =====
    tpl_title: '虚拟机模板', tpl_add: '新建模板', tpl_deploy: '从模板部署',
    tpl_spec: '规格', tpl_usage: '部署次数', tpl_updated: '更新时间',
    iso_title: 'ISO 镜像库', iso_upload: '上传 ISO', iso_os_type: '系统类型',
    iso_size: '大小', iso_pool: '存储池', iso_uploaded: '上传时间', iso_checksum: '校验',

    // ===== 右键上下文菜单（分组标题 + 命令项 + 快捷键）=====
    ctx_group_power: '电源', ctx_group_console: '控制台', ctx_group_snapshot: '快照',
    ctx_group_migration: '迁移与克隆', ctx_group_manage: '管理',
    ctx_power_on: '启动', ctx_shutdown: '关机（来宾）', ctx_reboot: '重启',
    ctx_suspend: '挂起', ctx_resume: '恢复', ctx_power_off: '强制断电',
    ctx_open_console: '打开图形控制台', ctx_open_serial: '打开串口终端',
    ctx_take_snapshot: '创建快照', ctx_manage_snapshots: '管理快照', ctx_revert_snapshot: '恢复到快照',
    ctx_migrate: '在线迁移', ctx_clone: '克隆', ctx_to_template: '转换为模板',
    ctx_edit_settings: '编辑设置', ctx_rename: '重命名', ctx_delete: '删除虚拟机',
    ctx_gpu_block: 'GPU 直通设备不支持在线迁移',

    // ===== 通用操作 / 工具栏 / CRUD / 对话框 =====
    op_new: '新建', op_edit: '编辑', op_delete: '删除', op_batch: '批量操作',
    op_filter: '筛选', op_search: '搜索', op_refresh: '刷新', op_reset: '重置',
    op_confirm: '确定', op_cancel: '取消', op_save: '保存', op_close: '关闭',
    op_selected_n: '已选 {n} 项', op_batch_delete: '批量删除', op_batch_start: '批量启动', op_batch_stop: '批量关机',
    op_select_all: '全选', op_actions: '操作', op_no_data: '暂无数据',
    op_total_n: '共 {n} 条', op_page_prev: '上一页', op_page_next: '下一页', op_page_of: '第 {c}/{t} 页',
    op_loading: '加载中…', op_required: '此项为必填', op_invalid: '格式不正确',
    confirm_delete_title: '确认删除', confirm_delete_msg: '确定要删除「{name}」吗？此操作不可恢复。',
    confirm_batch_delete_msg: '确定要删除选中的 {n} 个对象吗？此操作不可恢复。',
    toast_success: '操作成功', toast_failed: '操作失败', toast_deleted: '已删除「{name}」',
    toast_created: '已创建「{name}」', toast_saved: '已保存', toast_canceled: '已取消',

    // ===== 二层虚拟交换机创建（网卡选择 + bond 模式）=====
    sw_create: '创建虚拟交换机', sw_edit: '编辑交换机',
    sw_name: '交换机名称', sw_type: '交换机类型', sw_mtu: 'MTU',
    sw_uplink: '上联网卡', sw_uplink_pick: '点击宿主机网卡图标以选择上联口（可多选组成 bond）',
    sw_bond_mode: 'Bond 模式', sw_bond_none: '不绑定（单网卡）',
    sw_nic_speed: '速率', sw_nic_state: '状态', sw_nic_up: '已连接', sw_nic_down: '未连接',
    sw_selected_nics: '已选网卡', sw_bond_section: 'Bond 链路聚合',
    bond_balance_rr: 'balance-rr（轮询，吞吐优先）',
    bond_active_backup: 'active-backup（主备容错）',
    bond_8023ad: '802.3ad（LACP 动态聚合，需交换机支持）',
    bond_balance_xor: 'balance-xor（基于 MAC 哈希分流）',
    bond_broadcast: 'broadcast（广播冗余）',
    bond_balance_tlb: 'balance-tlb（自适应发送负载均衡）',
    bond_balance_alb: 'balance-alb（自适应收发负载均衡）',
    bond_need_two: '该 bond 模式至少需要选择 2 块网卡',

    // ===== 基础设施 · 资源池 =====
    pool_title: '资源池', pool_add: '新建资源池', pool_cpu_limit: 'CPU 上限',
    pool_cpu_reserved: 'CPU 预留', pool_mem_limit: '内存上限', pool_mem_reserved: '内存预留', pool_vms: '虚拟机数',
    shares_high: '高份额', shares_normal: '正常份额', shares_low: '低份额',

    // ===== 可用性 · 备份恢复 =====
    bk_title: '备份任务', bk_add: '新建备份任务', bk_target: '目标虚拟机', bk_job_name: '任务名',
    bk_schedule: '调度计划', bk_mode: '备份模式', bk_mode_full: '全量', bk_mode_incremental: '增量',
    bk_retention: '保留策略', bk_last_run: '上次运行', bk_last_status: '上次结果', bk_last_size: '备份大小',
    bk_run_now: '立即运行', bk_status_success: '成功', bk_status_warning: '告警', bk_status_failed: '失败',
    // 迁移中心补充
    mig_vm: '虚拟机', mig_target_host: '目标主机', mig_current_host: '当前主机', mig_path: '迁移路径',
    mig_mode: '迁移模式', mig_storage2: '同时迁移存储', mig_cold: '冷迁移', mig_remain: '剩余',
    mig_progress_remaining: '剩余数据', mig_in_progress: '迁移进行中', mig_done: '迁移完成',
    mig_running: '运行中', mig_success: '成功', mig_failed: '失败',

    // ===== 存储 · 卷 / 快照补充 =====
    vol_title: '个卷', vol_add: '新建卷', vol_name: '卷名', vol_pool: '存储池', vol_vm: '挂载虚拟机',
    vol_format: '格式', vol_size: '容量', vol_used: '已用', vol_bus: '总线', vol_iops: 'IOPS 限制', vol_unlimited: '不限',
    st_active: '活动', st_shared: '共享存储', st_local: '本地存储', st_read_iops: '读 IOPS', st_write_iops: '写 IOPS',
    st_running: '运行中', st_paused: '已挂起', st_stopped: '已停止',
    snap_current: '当前', snap_disk_only: '仅磁盘', snap_mem_label: '含内存', snap_name: '快照名',
    snap_name_ph: '例如 before-upgrade-v2', snap_quiesced2: '已冻结', snap_rollback: '回滚', snap_vm: '虚拟机',

    // ===== 网络 · 交换机 / VLAN =====
    sw_title: '虚拟交换机', sw_add: '新建交换机', sw_uplink: '上联', sw_ports: '端口数',
    sw_vlans: '承载 VLAN', sw_hosts: '成员主机',
    vlan_title: 'VLAN 列表', vlan_add: '新建 VLAN', vlan_vswitch: '所属交换机', vlan_id: 'VLAN ID',
    vlan_name: '名称', vlan_subnet: '子网', vlan_gateway: '网关', vlan_dhcp: 'DHCP', vlan_vms: '台虚拟机',
    net_topo_hint: '展开交换机查看其承载的 VLAN 与虚拟机分布。',

    // ===== 监控 · 告警规则 =====
    rule_title: '告警规则', rule_add: '新建规则', rule_name: '规则名', rule_metric: '监控指标',
    rule_condition: '触发条件', rule_severity: '级别', rule_triggered: '触发次数', rule_channel: '通知渠道', rule_enabled: '启用',
    sev_critical: '严重', sev_warning: '警告',

    // ===== 访问控制 · 用户 / 审计 =====
    acc_users_title: '用户列表', acc_add_user: '新建用户', acc_username: '用户名', acc_display_name: '显示名',
    acc_email: '邮箱', acc_roles: '角色', acc_source: '来源', acc_source_local: '本地', acc_source_ldap: 'LDAP',
    acc_last_login: '最近登录',
    acc_audit_title: '操作审计', acc_audit_time: '时间', acc_audit_user: '操作者', acc_audit_action: '操作',
    acc_audit_resource: '对象', acc_audit_ip: '来源 IP', acc_audit_result: '结果', acc_audit_detail: '详情',
    acc_result_success: '成功', acc_result_failed: '失败', acc_result_denied: '拒绝',

    // ===== 系统设置 · 配置 / License =====
    sys_config_title: '平台基础配置', sys_platform: '平台名称', sys_version: '版本号',
    sys_benchmark: '产品定位', sys_benchmark_val: '企业级分布式虚拟化管理平台',
    sys_node_role: '节点角色', sys_tech: '技术栈',
    lic_current: '当前许可证', lic_active: '已激活', lic_inactive: '未激活',
    lic_edition: '许可版本', lic_org: '授权组织', lic_key: '许可密钥', lic_issued: '签发日期',
    lic_expires: '到期日期', lic_hw_fp: '硬件指纹',
    lic_ed_community: '社区版', lic_ed_standard: '标准版', lic_ed_enterprise: '企业版',
    lic_usage: '资源用量', lic_nodes_usage: '节点用量', lic_vms_usage: '虚拟机用量',
    lic_upgrade: '升级许可版本', lic_compare: '版本特性对比', lic_unlimited: '无限制',
    lic_current_badge: '当前版本', lic_contact_sales: '联系销售',
    lic_price: '价格', lic_feat_max_nodes: '最大节点数', lic_feat_max_vms: '最大虚拟机数',
    lic_feat_ha: '高可用 HA', lic_feat_migration: '热迁移 / 在线迁移', lic_feat_vlan: 'VLAN / SDN',
    lic_feat_storage: '存储后端', lic_feat_roles: '自定义角色', lic_feat_audit: '操作审计', lic_feat_api: 'API 访问',
  },
  en: {
    brand_name: 'Cloud Nexus Forging', brand_abbr: 'CNF', brand_version: 'v1.0.1',
    brand_sub: 'Enterprise Distributed Virtualization Platform',
    mode_demo: 'Prototype Demo',
    save: 'Save', cancel: 'Cancel', confirm: 'OK', close: 'Close', apply: 'Apply',
    create: 'Create', edit: 'Edit', delete: 'Delete', search: 'Search', loading: 'Loading…',
    enabled: 'Enabled', disabled: 'Disabled', yes: 'Yes', no: 'No', actions: 'Actions',
    status: 'Status', name: 'Name', description: 'Description', type: 'Type', all: 'All',

    nav_overview: 'Inventory & Monitor', nav_compute: 'Hosts & Clusters', nav_ops: 'VM Operations',
    nav_infra: 'Storage', nav_admin: 'Administration',
    nav_dashboard: 'Summary', nav_topology: 'Hosts & Clusters', nav_vms: 'Virtual Machines',
    nav_gpu: 'GPU Monitor', nav_migration: 'Live Migration', nav_snapshot: 'Snapshots',
    nav_storage: 'Datastores', nav_cluster_cfg: 'Cluster Settings', nav_permissions: 'Permissions',
    nav_drs: 'Scheduling Orchestration',

    title_dashboard: 'Summary', title_topology: 'Hosts & Clusters', title_vms: 'Virtual Machines',
    title_gpu: 'GPU Monitor', title_storage: 'Datastores', title_migration: 'Live Migration',
    title_snapshot: 'Snapshot Manager', title_cluster_cfg: 'Cluster Settings',
    title_permissions: 'Permission Management', title_drs: 'Scheduling Orchestration (Drag & Drop)',

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

    mig_start: 'Start Live Migration', mig_vm: 'Virtual Machine', mig_dst: 'Target Host',
    mig_choose: 'Select…', mig_remain: 'free',
    mig_live: 'Live Migration (zero downtime)', mig_storage: 'Storage Migration (non-shared disk)',
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
    snap_quiesce: 'Quiesce guest file system (CNF Guest Agent consistency)',
    snap_tip: 'Memory snapshots capture vCPU/RAM/NVRAM state to restore the exact moment; disk-only snapshots are faster and smaller.',
    snap_creating: 'Creating…', snap_chain: 'Snapshot Tree', snap_current: 'You are here',
    snap_mem_nvram: 'Memory + NVRAM', snap_disk_only: 'Disk only', snap_quiesced: 'Quiesced',
    snap_revert: 'Revert to', snap_delete: 'Delete',

    cc_select: 'Select Cluster', cc_ha: 'High Availability (HA)', cc_drs: 'Dynamic Resource Scheduling',
    cc_evc: 'CPU Compatibility Mode', cc_overcommit: 'Resource Overcommit',
    cc_ha_desc: 'Restart affected VMs on other hosts when a host fails',
    cc_drs_desc: 'Automatically balance VMs across hosts by load (live migration)',
    cc_evc_desc: 'CPU compatibility mode for migration across CPU generations',
    cc_drs_level: 'Scheduling Automation Level', cc_manual: 'Manual', cc_partial: 'Partially Automated',
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

    drs_hint: 'Drag a VM card onto a target host to start live migration. The system validates resources and compatibility automatically.',
    drs_capacity: 'Capacity', drs_vms_on: 'VMs hosted', drs_drop_here: 'Drop here to migrate',
    drs_recommend: 'Scheduling Recommendations', drs_balanced: 'Cluster is balanced',
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
    // ===== Resource topology tree =====
    topo_tree_title: 'Resource Topology',
    topo_belongs: 'Belongs to',
    // ===== Add Host Wizard =====
    hw_title: 'Add Host to Cluster',
    hw_step1: 'Select Cluster', hw_step2: 'Connection', hw_step3: 'Pre-check', hw_step4: 'Provision',
    hw_datacenter: 'Datacenter', hw_target_cluster: 'Target Cluster',
    hw_select_dc: 'Select a datacenter', hw_select_cluster: 'Select a target cluster', hw_select_dc_first: 'Select a datacenter first',
    hw_cluster_info: 'Cluster', hw_cluster_ha: 'HA', hw_cluster_hosts: 'Current hosts',
    hw_hostname: 'Hostname', hw_mgmt_ip: 'Management IP', hw_ssh_port: 'SSH Port', hw_ssh_user: 'SSH User', hw_ssh_pass: 'SSH Password',
    hw_err_ip: 'Invalid IP address', hw_err_ip_dup: 'IP already used by another host',
    hw_precheck_hint: 'Checking virtualization environment and connectivity',
    hw_check_net: 'Network connectivity', hw_check_virt: 'CPU virtualization support', hw_check_mem: 'Memory capacity', hw_check_ssh: 'SSH connection',
    hw_check_wait: 'Waiting', hw_check_running: 'Checking…',
    hw_dep_connect: 'Connecting to host…', hw_dep_virt: 'Installing virtualization…', hw_dep_vswitch: 'Configuring virtual switch…',
    hw_dep_agent: 'Deploying management agent…', hw_dep_register: 'Registering to cluster…', hw_dep_sync: 'Syncing network config…', hw_dep_done: 'Provision complete!',
    hw_dep_ready: 'Click "Start Provision" to onboard the node', hw_dep_success: 'Host {host} joined cluster {cluster}', hw_dep_failed: 'Provision failed, please check connection',
    hw_prev: 'Back', hw_next: 'Next', hw_run_precheck: 'Run Pre-check', hw_start_deploy: 'Start Provision', hw_finish: 'Finish',
    hw_add_host: 'Add Host',
    // ===== Host hardware =====
    host_nic_model: 'NIC', host_raid_model: 'RAID', host_disk_model: 'Disk',
    host_cluster: 'Cluster', host_dc: 'Datacenter', host_vms_running: 'Running VMs',
    // ===== VM migration =====
    mig_title: 'Migrate VM', mig_select_target: 'Select target host', mig_no_target: 'No other available host in this cluster',
    mig_same_cluster: 'Only online hosts within the same cluster', mig_cpu_free: 'CPU free', mig_mem_free: 'Mem free',
    mig_in_progress: 'Migrating {vm} to {host}…', mig_success: '{vm} migrated to {host}', mig_start: 'Start Migration',
    // ===== Cascade delete checks =====
    del_blocked_title: 'Cannot Delete', del_dc_has_cluster: 'Datacenter still has clusters, remove them first',
    del_cluster_has_host: 'Cluster still has hosts, remove them first', del_host_has_vm: 'Host still has running VMs, migrate or stop them first',
    del_blocked_children: 'Related objects', op_remove: 'Remove',

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
    wiz_xml_hint: 'This XML is produced by the backend virtualization engine and is directly virsh-define-able.',
    wiz_vm_status: 'Status', wiz_prev: 'Previous', wiz_next: 'Next',
    wiz_step: 'Step', wiz_creating: 'Creating...', wiz_create: 'Create VM', wiz_finish: 'Finish',
    wiz_optional: 'Optional',

    // ===== 9-module navigation =====
    nav_mod_dashboard: 'Dashboard', nav_mod_infrastructure: 'Infrastructure', nav_mod_compute: 'Compute',
    nav_mod_availability: 'Availability', nav_mod_storage: 'Storage', nav_mod_network: 'Network',
    nav_mod_monitoring: 'Monitoring', nav_mod_access: 'Access Control', nav_mod_system: 'System',
    nav_dash_overview: 'Resource Overview', nav_dash_performance: 'Performance', nav_dash_alerts: 'Alert Summary',
    nav_infra_datacenter: 'Datacenters', nav_infra_clusters: 'Clusters', nav_infra_hosts: 'Hosts', nav_infra_pools: 'Resource Pools',
    nav_compute_vms: 'Virtual Machines', nav_compute_templates: 'Templates', nav_compute_isos: 'ISO Images',
    nav_avail_ha: 'HA Config', nav_avail_migration: 'Migration', nav_avail_backup: 'Backup',
    nav_storage_pools: 'Storage Pools', nav_storage_volumes: 'Volumes', nav_storage_snapshots: 'Snapshots',
    nav_net_vswitch: 'vSwitches', nav_net_vlan: 'VLANs', nav_net_topology: 'Topology',
    nav_mon_realtime: 'Real-time', nav_mon_history: 'History', nav_mon_rules: 'Alert Rules',
    nav_acc_users: 'Users', nav_acc_roles: 'Roles & Privileges', nav_acc_audit: 'Audit Log',
    nav_sys_config: 'General', nav_sys_license: 'License', nav_sys_about: 'About',

    // ===== Toolbar =====
    tb_search_ph: 'Search VMs / hosts / tasks…', tb_notifications: 'Notifications',
    tb_mark_all_read: 'Mark all read', tb_no_notifications: 'No notifications', tb_logout: 'Sign Out',

    // ===== Dashboard extras =====
    dash_clusters_n: 'clusters', dash_connected: 'Connected', dash_connected_total: 'hosts online',
    dash_assigned_total: 'GPUs assigned', dash_gpus: 'GPU Accelerators',
    dash_vcpu_alloc: 'vCPU Allocation', dash_mem_alloc: 'Memory Allocation', dash_recent_tasks: 'Recent Tasks',
    dash_sse_live: 'Live stream',
    task_target: 'Target', task_time: 'Time', task_progress: 'Progress',
    task_success: 'Success', task_failed: 'Failed',

    // ===== Compute templates / ISO =====
    tpl_title: 'VM Templates', tpl_add: 'New Template', tpl_deploy: 'Deploy from Template',
    tpl_spec: 'Spec', tpl_usage: 'Deployments', tpl_updated: 'Updated',
    iso_title: 'ISO Library', iso_upload: 'Upload ISO', iso_os_type: 'OS Type',
    iso_size: 'Size', iso_pool: 'Pool', iso_uploaded: 'Uploaded', iso_checksum: 'Checksum',

    // ===== Context menu =====
    ctx_group_power: 'Power', ctx_group_console: 'Console', ctx_group_snapshot: 'Snapshot',
    ctx_group_migration: 'Migrate & Clone', ctx_group_manage: 'Manage',
    ctx_power_on: 'Power On', ctx_shutdown: 'Shut Down (Guest)', ctx_reboot: 'Reboot',
    ctx_suspend: 'Suspend', ctx_resume: 'Resume', ctx_power_off: 'Force Power Off',
    ctx_open_console: 'Open Graphical Console', ctx_open_serial: 'Open Serial Terminal',
    ctx_take_snapshot: 'Take Snapshot', ctx_manage_snapshots: 'Manage Snapshots', ctx_revert_snapshot: 'Revert to Snapshot',
    ctx_migrate: 'Live Migrate', ctx_clone: 'Clone', ctx_to_template: 'Convert to Template',
    ctx_edit_settings: 'Edit Settings', ctx_rename: 'Rename', ctx_delete: 'Delete VM',
    ctx_gpu_block: 'GPU passthrough does not support live migration',

    // ===== Common ops / toolbar / CRUD / dialog =====
    op_new: 'New', op_edit: 'Edit', op_delete: 'Delete', op_batch: 'Batch',
    op_filter: 'Filter', op_search: 'Search', op_refresh: 'Refresh', op_reset: 'Reset',
    op_confirm: 'OK', op_cancel: 'Cancel', op_save: 'Save', op_close: 'Close',
    op_selected_n: '{n} selected', op_batch_delete: 'Batch Delete', op_batch_start: 'Batch Start', op_batch_stop: 'Batch Stop',
    op_select_all: 'Select All', op_actions: 'Actions', op_no_data: 'No data',
    op_total_n: '{n} total', op_page_prev: 'Prev', op_page_next: 'Next', op_page_of: 'Page {c}/{t}',
    op_loading: 'Loading…', op_required: 'This field is required', op_invalid: 'Invalid format',
    confirm_delete_title: 'Confirm Delete', confirm_delete_msg: 'Delete "{name}"? This cannot be undone.',
    confirm_batch_delete_msg: 'Delete the selected {n} objects? This cannot be undone.',
    toast_success: 'Success', toast_failed: 'Failed', toast_deleted: 'Deleted "{name}"',
    toast_created: 'Created "{name}"', toast_saved: 'Saved', toast_canceled: 'Canceled',

    // ===== L2 virtual switch creation =====
    sw_create: 'Create Virtual Switch', sw_edit: 'Edit Switch',
    sw_name: 'Switch Name', sw_type: 'Switch Type', sw_mtu: 'MTU',
    sw_uplink: 'Uplink NIC', sw_uplink_pick: 'Click host NIC icons to pick uplinks (multi-select to form a bond)',
    sw_bond_mode: 'Bond Mode', sw_bond_none: 'No bond (single NIC)',
    sw_nic_speed: 'Speed', sw_nic_state: 'State', sw_nic_up: 'Up', sw_nic_down: 'Down',
    sw_selected_nics: 'Selected NICs', sw_bond_section: 'Bond Link Aggregation',
    bond_balance_rr: 'balance-rr (round-robin, throughput)',
    bond_active_backup: 'active-backup (failover)',
    bond_8023ad: '802.3ad (LACP, switch support required)',
    bond_balance_xor: 'balance-xor (MAC hash)',
    bond_broadcast: 'broadcast (redundancy)',
    bond_balance_tlb: 'balance-tlb (adaptive TX load balancing)',
    bond_balance_alb: 'balance-alb (adaptive TX/RX load balancing)',
    bond_need_two: 'This bond mode requires at least 2 NICs',

    // ===== Infrastructure resource pools =====
    pool_title: 'Resource Pools', pool_add: 'New Pool', pool_cpu_limit: 'CPU Limit',
    pool_cpu_reserved: 'CPU Reserved', pool_mem_limit: 'Mem Limit', pool_mem_reserved: 'Mem Reserved', pool_vms: 'VMs',
    shares_high: 'High Shares', shares_normal: 'Normal Shares', shares_low: 'Low Shares',

    // ===== Availability backup =====
    bk_title: 'Backup Jobs', bk_add: 'New Backup Job', bk_target: 'Target VM', bk_job_name: 'Job Name',
    bk_schedule: 'Schedule', bk_mode: 'Mode', bk_mode_full: 'Full', bk_mode_incremental: 'Incremental',
    bk_retention: 'Retention', bk_last_run: 'Last Run', bk_last_status: 'Last Status', bk_last_size: 'Size',
    bk_run_now: 'Run Now', bk_status_success: 'Success', bk_status_warning: 'Warning', bk_status_failed: 'Failed',
    mig_vm: 'Virtual Machine', mig_target_host: 'Target Host', mig_current_host: 'Current Host', mig_path: 'Path',
    mig_mode: 'Mode', mig_storage2: 'Migrate storage too', mig_cold: 'Cold Migration', mig_remain: 'Remaining',
    mig_progress_remaining: 'Remaining data', mig_in_progress: 'Migrating', mig_done: 'Completed',
    mig_running: 'Running', mig_success: 'Success', mig_failed: 'Failed',

    // ===== Storage volumes / snapshots =====
    vol_title: 'volumes', vol_add: 'New Volume', vol_name: 'Volume', vol_pool: 'Pool', vol_vm: 'Attached VM',
    vol_format: 'Format', vol_size: 'Size', vol_used: 'Used', vol_bus: 'Bus', vol_iops: 'IOPS Limit', vol_unlimited: 'Unlimited',
    st_active: 'Active', st_shared: 'Shared', st_local: 'Local', st_read_iops: 'Read IOPS', st_write_iops: 'Write IOPS',
    st_running: 'Running', st_paused: 'Paused', st_stopped: 'Stopped',
    snap_current: 'Current', snap_disk_only: 'Disk only', snap_mem_label: 'With memory', snap_name: 'Snapshot Name',
    snap_name_ph: 'e.g. before-upgrade-v2', snap_quiesced2: 'Quiesced', snap_rollback: 'Rollback', snap_vm: 'Virtual Machine',

    // ===== Network =====
    sw_title: 'Virtual Switches', sw_add: 'New Switch', sw_uplink: 'Uplink', sw_ports: 'Ports',
    sw_vlans: 'VLANs', sw_hosts: 'Member Hosts',
    vlan_title: 'VLANs', vlan_add: 'New VLAN', vlan_vswitch: 'vSwitch', vlan_id: 'VLAN ID',
    vlan_name: 'Name', vlan_subnet: 'Subnet', vlan_gateway: 'Gateway', vlan_dhcp: 'DHCP', vlan_vms: 'VMs',
    net_topo_hint: 'Expand a switch to see its VLANs and VM distribution.',

    // ===== Monitoring alert rules =====
    rule_title: 'Alert Rules', rule_add: 'New Rule', rule_name: 'Rule', rule_metric: 'Metric',
    rule_condition: 'Condition', rule_severity: 'Severity', rule_triggered: 'Triggered', rule_channel: 'Channel', rule_enabled: 'Enabled',
    sev_critical: 'Critical', sev_warning: 'Warning',

    // ===== Access control =====
    acc_users_title: 'Users', acc_add_user: 'New User', acc_username: 'Username', acc_display_name: 'Display Name',
    acc_email: 'Email', acc_roles: 'Roles', acc_source: 'Source', acc_source_local: 'Local', acc_source_ldap: 'LDAP',
    acc_last_login: 'Last Login',
    acc_audit_title: 'Audit Log', acc_audit_time: 'Time', acc_audit_user: 'User', acc_audit_action: 'Action',
    acc_audit_resource: 'Resource', acc_audit_ip: 'Source IP', acc_audit_result: 'Result', acc_audit_detail: 'Detail',
    acc_result_success: 'Success', acc_result_failed: 'Failed', acc_result_denied: 'Denied',

    // ===== System / License =====
    sys_config_title: 'Platform General Settings', sys_platform: 'Platform Name', sys_version: 'Version',
    sys_benchmark: 'Product Positioning', sys_benchmark_val: 'Enterprise Distributed Virtualization Platform',
    sys_node_role: 'Node Role', sys_tech: 'Tech Stack',
    lic_current: 'Current License', lic_active: 'Active', lic_inactive: 'Inactive',
    lic_edition: 'Edition', lic_org: 'Organization', lic_key: 'License Key', lic_issued: 'Issued',
    lic_expires: 'Expires', lic_hw_fp: 'Hardware Fingerprint',
    lic_ed_community: 'Community', lic_ed_standard: 'Standard', lic_ed_enterprise: 'Enterprise',
    lic_usage: 'Resource Usage', lic_nodes_usage: 'Node Usage', lic_vms_usage: 'VM Usage',
    lic_upgrade: 'Upgrade Edition', lic_compare: 'Edition Comparison', lic_unlimited: 'Unlimited',
    lic_current_badge: 'Current', lic_contact_sales: 'Contact Sales',
    lic_price: 'Price', lic_feat_max_nodes: 'Max Nodes', lic_feat_max_vms: 'Max VMs',
    lic_feat_ha: 'High Availability', lic_feat_migration: 'Live Migration', lic_feat_vlan: 'VLAN / SDN',
    lic_feat_storage: 'Storage Backend', lic_feat_roles: 'Custom Roles', lic_feat_audit: 'Audit Log', lic_feat_api: 'API Access',
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
