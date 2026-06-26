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
    mode_demo: '原型演示模式', mode_prod: '生产模式 · 真实后端',
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
    dash_cluster_load: '各集群实时负载', dash_online: '在线',
    dash_gpu_summary: 'GPU 概要', dash_gpu_total: 'GPU 总数', dash_gpu_busy: '使用中', dash_gpu_idle: '空闲', dash_gpu_avg: '平均利用率',
    // P1 仪表板归属上下文
    dash_cpu_live_obj: '集群 CPU 利用率（全部集群聚合）', dash_cpu_scope_all: '全部集群',
    dash_pool_cap_obj: '资源池容量（全集群汇总）', dash_gpu_summary_obj: 'GPU 加速卡概要（全集群汇总）',
    dash_gpu_card_owner: '归属主机', dash_gpu_card_vm: '已分配给', dash_gpu_card_idle: '空闲可分配',
    dash_gpu_assigned: '已分配', dash_gpu_available: '可分配', dash_gpu_mode_pt: '直通', dash_gpu_mode_vgpu: 'vGPU',
    dash_gpu_unassigned_vm: '未分配虚拟机', dash_gpu_host_col: '所在主机', dash_gpu_owner_col: '使用方',
    dash_gpu_detail_title: 'GPU 设备明细（归属与使用方）', dash_gpu_util_col: '利用率', dash_gpu_temp_col: '温度',
    dash_cpu_legend: '集群平均 CPU 利用率（%）',
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
    hw_precheck_hint: '检测目标主机的虚拟化计算组件与连通性，缺失部分将由平台推送离线依赖包补齐',
    hw_check_net: '网络连通性检查', hw_check_virt: 'CPU 虚拟化支持', hw_check_mem: '内存与硬件', hw_check_ssh: 'SSH 连接验证',
    hw_check_libvirt: '虚拟化计算组件（libvirt/KVM）', hw_check_tcp: 'libvirtd TCP 监听',
    hw_check_wait: '等待检查', hw_check_running: '检查中…',
    hw_check_reachable: '可达 · SSH 端口已开放', hw_check_unreachable: '不可达 / SSH 拒绝',
    hw_check_ssh_ok: '认证成功（{user}）', hw_check_failed: '探测失败', 
    hw_check_virt_ok: '已支持（VT-x/AMD-V · /dev/kvm）', hw_check_virt_no: 'BIOS 未开启虚拟化或无 /dev/kvm',
    hw_check_libvirt_ok: '已安装并运行', hw_check_libvirt_stopped: '已安装但未运行（将自动启动）',
    hw_check_libvirt_no: '缺失（需开启自动补齐或手工安装）', hw_check_libvirt_autoinstall: '缺失 · 纳管时由平台推送离线依赖包补齐',
    hw_check_tcp_ok: 'TCP {port} 已监听', hw_check_tcp_no: '未监听（需开启自动补齐或手工配置）', hw_check_tcp_autoinstall: '未监听 · 纳管时自动配置',
    hw_check_mem_unknown: '硬件信息采集中',
    hw_auto_install: '自动安装虚拟化计算组件（libvirt / KVM）', 
    hw_auto_install_desc: '检测目标主机已安装的虚拟化组件，缺失部分由平台推送离线依赖包并本地安装；已安装则跳过。',
    hw_precheck_blocked: 'CPU 虚拟化未通过，或虚拟化组件/TCP 缺失且未开启「自动安装」。请开启自动安装开关，或先在目标主机手工安装配置。',
    hw_recheck: '重新预检',
    hw_dep_installing: '正在检测组件并补齐缺失的虚拟化计算组件（平台离线包优先）…', hw_dep_onboarding: '正在采集硬件、落库并以 qemu+tcp 验证连接…',
    hw_dep_ready: '点击「开始纳管」执行节点纳管', hw_dep_ready_auto: '点击「开始纳管」：检测组件，缺失部分由平台推送离线依赖包补齐后纳管',
    hw_dep_success: '主机 {host} 已成功加入集群 {cluster}', hw_dep_failed: '纳管失败，请查看下方日志', 
    hw_install_log: '安装与配置日志（真实执行）', hw_log_live: '实时',
    hw_offline_ready: '平台离线依赖包已就绪', hw_offline_pkgs: '个包', hw_offline_fallback: '缺失组件由平台推送本地安装，不依赖目标主机在线源',
    hw_offline_empty: '平台尚未预置离线依赖包，本次将回退使用目标主机自带在线源（建议预置离线包以摆脱在线源依赖）',
    hw_dep_connect: '正在连接主机…', hw_dep_virt: '安装虚拟化组件…', hw_dep_vswitch: '配置虚拟交换机…',
    hw_dep_agent: '部署管理 Agent…', hw_dep_register: '注册到集群…', hw_dep_sync: '同步网络配置…', hw_dep_done: '部署完成！',
    hw_prev: '上一步', hw_next: '下一步', hw_run_precheck: '开始预检', hw_start_deploy: '开始纳管', hw_finish: '完成',
    hw_add_host: '添加主机',
    // ===== 主机硬件型号 =====
    host_nic_model: '网卡', host_raid_model: 'RAID 卡', host_disk_model: '硬盘',
    host_cluster: '所属集群', host_dc: '所属数据中心', host_vms_running: '运行中 VM',
    // ===== VM 迁移（同集群约束）=====
    mig_title: '虚拟机迁移', mig_select_target: '请选择迁移目标主机', mig_no_target: '当前集群内没有其他可用主机进行迁移',
    mig_same_cluster: '仅可迁移至同集群内的在线主机', mig_cpu_free: 'CPU 余量', mig_mem_free: '内存余量',
    mig_in_progress: '正在将 {vm} 迁移到 {host}…', mig_success: '{vm} 已成功迁移到 {host}', mig_start: '开始迁移',
    mig_source: '源主机', mig_mode_live: '热迁移(在线)', mig_mode_cold: '冷迁移(关机)',
    mig_cold_only: '该虚拟机当前停机，仅支持冷迁移。',
    mig_pick_dc: '① 选择数据中心', mig_pick_cluster: '② 选择集群', mig_pick_host: '③ 选择目标主机',
    mig_pick_dc_first: '请先选择数据中心', mig_pick_cluster_first: '请先选择集群', mig_no_host: '该集群下无可迁移主机',
    mig_free: '空闲', mig_planning: '正在评估迁移计划…',
    mig_fit_ok: '资源充足', mig_fit_insufficient: '资源不足', mig_fit_unavailable: '主机不可用',
    mig_shared_storage: '共享存储(免迁盘)', mig_storage_migration: '存储迁移(同步磁盘)',
    mig_net_path: '网络路径', mig_blocked: '无法迁移',
    mig_start_live: '开始热迁移', mig_start_cold: '开始冷迁移',
    mig_chk_cpu: 'CPU 容量', mig_chk_mem: '内存容量', mig_chk_host: '主机状态', mig_chk_cpu_compat: 'CPU 兼容性', mig_chk_storage: '存储', mig_chk_gpu: 'GPU 直通',
    mig_center_tip_title: '迁移入口已统一到虚拟机列表',
    mig_center_tip: '请在「计算资源 → 虚拟机」列表中，对目标虚拟机点击右键 → 迁移，按「数据中心 → 集群 → 主机」三级选择目标，系统将自动完成资源校验、冷/热迁移判定与共享存储/存储迁移决策。本页仅保留迁移历史记录。',
    mig_goto_vms: '前往虚拟机列表', mig_no_history: '暂无迁移记录',
    // ===== 级联删除校验 =====
    del_blocked_title: '无法删除', del_dc_has_cluster: '数据中心下仍有集群，请先移除集群',
    del_cluster_has_host: '集群下仍有主机，请先移除主机', del_host_has_vm: '主机上仍有运行中的虚拟机，请先迁移或关机',
    del_blocked_children: '关联对象', op_remove: '移除',

    // GPU 补充
    gpu_vgpu: 'vGPU',

    // 存储补充
    st_capacity: '容量', st_read_iops: '读 IOPS', st_write_iops: '写 IOPS',
    st_latency: '延迟', st_active: '活跃', st_shared: '共享存储', st_local: '本地存储',
    // —— 存储池创建向导 / CRUD ——
    sp_pools: '存储池', sp_add: '新建存储池', sp_create_title: '新建存储池', sp_cluster: '所属集群',
    sp_name: '存储池名称', sp_name_ph: '如 prod-ssd-pool', sp_type: '存储类型', sp_capacity: '容量 (TB)',
    sp_volumes: '卷数', sp_free: '可用', sp_delete: '删除存储池',
    sp_type_local: '本地目录', sp_type_local_d: '宿主机本地磁盘/目录，不可共享，性能最高',
    sp_type_nfs: 'NFS 共享', sp_type_nfs_d: '基于 NFS 协议的网络共享存储，可多主机共享',
    sp_type_iscsi: 'iSCSI', sp_type_iscsi_d: 'IP-SAN 块存储，通过 iSCSI Target 提供',
    sp_type_fc: 'FC 光纤', sp_type_fc_d: '光纤通道 SAN，企业级高吞吐低延迟',
    sp_type_dist: '分布式存储', sp_type_dist_d: '横向扩展的分布式块存储，三副本高可用',
    sp_f_target_path: '本地路径', sp_f_nfs_server: 'NFS 服务器', sp_f_nfs_export: '导出路径',
    sp_f_iscsi_portal: 'iSCSI Portal', sp_f_iscsi_iqn: 'Target IQN',
    sp_f_fc_wwpn: 'WWPN', sp_f_dist_monitors: '监视器地址', sp_f_dist_pool: '存储池名',
    sp_step_type: '选择类型', sp_step_conn: '连接参数', sp_step_basic: '基本信息',
    sp_conn_hint: '请填写该存储类型所需的连接参数', sp_del_has_vol: '存储池上仍有卷，请先删除卷',
    // —— 卷管理 CRUD ——
    vol_create_title: '新建卷', vol_create: '创建', vol_delete: '删除卷', vol_del_attached: '卷已挂载到运行中虚拟机',
    vol_no_vm: '不挂载（独立卷）', vol_iops_ph: '0 表示不限制',
    // —— 快照操作 ——
    snap_revert_confirm: '确认回滚 {vm} 到快照「{name}」？回滚后当前未保存的状态将丢失。',
    snap_del_confirm: '确认删除快照「{name}」？', snap_del_current: '当前快照不可删除',

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
    // P5/P6/P7/P8 重构向导
    wiz_ns1: '操作系统 & 名称', wiz_ns2: '放置位置', wiz_ns3: 'CPU & 内存', wiz_ns4: 'NUMA & 绑核',
    wiz_ns5: '磁盘 & 网络', wiz_ns6: 'GPU 设备', wiz_ns7: '预览 & 创建',
    wiz_guest_os: '客户机操作系统', wiz_guest_os_hint: '选择 KVM 支持的客户机系统，系统将自动匹配最佳固件与机器类型。',
    wiz_os_family_linux: 'Linux', wiz_os_family_windows: 'Windows',
    wiz_auto_fw: '自动匹配固件', wiz_auto_machine: '自动匹配机器类型',
    wiz_fw_uefi: 'UEFI (OVMF)', wiz_fw_bios: 'BIOS (SeaBIOS)',
    wiz_machine_q35: 'q35（现代芯片组，推荐）', wiz_machine_i440fx: 'pc-i440fx（传统兼容）',
    wiz_fw_explain: '固件 / 机器类型已根据所选操作系统自动推导，无需手动选择；如需可在「高级」中覆盖。',
    wiz_advanced: '高级选项', wiz_show_advanced: '展开高级', wiz_hide_advanced: '收起高级',
    // P5 放置位置
    wiz_place_hint: '虚拟机必须明确放置位置：数据中心 → 集群 → 宿主机。系统会校验目标宿主机资源是否充足。',
    wiz_sel_dc: '数据中心', wiz_sel_cluster: '集群', wiz_sel_host: '宿主机',
    wiz_host_cap: '可用容量', wiz_host_cap_cpu: '空闲 vCPU', wiz_host_cap_mem: '空闲内存',
    wiz_host_offline_warn: '该宿主机当前不在线，无法放置', wiz_pick_dc_first: '请先选择数据中心',
    wiz_pick_cluster_first: '请先选择集群', wiz_no_host_in_cluster: '该集群暂无可用宿主机',
    wiz_cap_ok: '资源充足', wiz_cap_warn: '资源紧张', wiz_cap_insufficient: '资源不足，无法创建',
    // P6 CPU & 内存 / NUMA
    wiz_vcpu_count: 'vCPU 数量', wiz_vcpu_hint: '默认仅需指定 vCPU 总数；如需精确 NUMA/性能调优，可展开高级设置 Socket×Core×Thread。',
    wiz_topo_advanced: '高级：自定义 CPU 拓扑', wiz_mem_gb: '内存 (GB)',
    wiz_numa_select_hint: '将 vCPU 与内存绑定到同一 NUMA 节点可降低跨节点访问延迟。选择目标宿主机的 NUMA 节点：',
    wiz_numa_auto_label: '由调度器自动放置（不指定 NUMA）',
    wiz_numa_node_n: 'NUMA 节点', wiz_numa_node_cores: '物理核', wiz_numa_node_mem: '本地内存',
    wiz_pin_section: 'CPU 绑核', wiz_pin_toggle: '启用 CPU 绑核（独享物理核，杜绝争抢）',
    wiz_pin_auto_desc: '启用后，系统将从所选 NUMA 节点自动连续分配独享物理核给各 vCPU（参考 SmartX CloudTower 最佳实践，无需手动点格子）。',
    wiz_pin_preview: '绑核预览', wiz_pin_vcpu: 'vCPU', wiz_pin_pcpu: '物理核',
    wiz_pin_need_numa: '请先在上方选择一个具体 NUMA 节点后再启用绑核。',
    // P8 网卡队列
    wiz_nic_queues: '网卡多队列 (multiqueue)', wiz_nic_queues_hint: '多队列可在高吞吐场景下并行处理网络中断，建议设为 vCPU 数（virtio 网卡生效，1=关闭）。',
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
    nav_mon_overview: '总览', nav_mon_realtime: '实时监控', nav_mon_history: '历史性能', nav_mon_rules: '告警规则',
    nav_acc_users: '用户管理', nav_acc_roles: '角色权限', nav_acc_audit: '操作审计',
    nav_sys_config: '基础配置', nav_sys_license: 'License 管理', nav_sys_about: '关于系统',

    // ===== 顶部工具栏 =====
    tb_search_ph: '搜索虚拟机 / 主机 / 任务…', tb_notifications: '通知中心',
    tb_mark_all_read: '全部已读', tb_no_notifications: '暂无通知', tb_logout: '退出登录',
    logout_success: '已退出登录，正在跳转登录页…',

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

    // ===== P8 模板：新建 / 从模板部署 对话框 =====
    tpl_new_title: '新建模板', tpl_source: '创建方式',
    tpl_src_convert: '从停机虚拟机转换', tpl_src_blank: '新建空白模板',
    tpl_src_convert_hint: '将一台已停机的虚拟机转换为可复用模板（克隆磁盘 + 通用化）',
    tpl_src_blank_hint: '从零定义一个空白模板，后续可挂载 ISO 安装系统',
    tpl_pick_vm: '选择源虚拟机（需已停机）', tpl_name_ph: '如：tpl-rocky9-base',
    tpl_guest_os: '客户机操作系统', tpl_vcpu: 'vCPU 数', tpl_mem: '内存 (GB)', tpl_disk: '系统盘 (GB)',
    tpl_tags: '预装组件标签', tpl_tags_ph: '如：cloud-init, qemu-guest-agent（逗号分隔）',
    tpl_no_stopped_vm: '当前没有已停机的虚拟机可供转换',
    tpl_deploy_title: '从模板部署虚拟机', tpl_deploy_from: '源模板',
    tpl_deploy_count: '部署数量', tpl_deploy_prefix: '虚拟机名称前缀', tpl_deploy_prefix_ph: '如：web-prod-',
    tpl_deploy_host: '目标宿主机', tpl_deploy_batch_hint: '数量 > 1 时按「前缀+序号」批量命名（web-prod-01、web-prod-02…）',
    tpl_created: '模板「{name}」已创建', tpl_deployed: '已提交部署 {n} 台虚拟机（基于模板「{name}」）',

    // ===== P9 ISO：上传对话框（本地/URL + MD5）=====
    iso_upload_title: '上传 ISO 镜像', iso_src_local: '本地文件上传', iso_src_url: 'URL 远程下载',
    iso_local_file: '选择本地 ISO 文件', iso_local_pick: '点击选择文件 (.iso)',
    iso_remote_url: '镜像下载地址', iso_remote_url_ph: 'https://… / ftp://… 指向 .iso 文件',
    iso_target_pool: '目标存储池', iso_md5: 'MD5 校验值（可选）', iso_md5_ph: '填写后将在上传完成后比对，留空则跳过校验',
    iso_repo_title: 'ISO 镜像仓 · 存储位置与共享范围',
    iso_repo_fallback: 'ISO 镜像存放于存储域（存储池）下的 iso 子目录；共享存储域（NFS/iSCSI）内的镜像对所属集群全部主机可见，本地存储域仅单台主机可见。',
    iso_store_domain: '存储域', iso_scope: '共享范围', iso_visible_hosts: '可见主机',
    iso_scope_cluster: '集群共享', iso_scope_host: '仅本机', iso_scope_unknown: '未知',
    iso_hint_cluster: '共享存储域：该集群所有主机均可用此镜像创建/挂载虚拟机', iso_hint_host: '本地存储域：仅挂载该池的单台主机可见，不跨主机/集群/数据中心',
    iso_progress: '上传进度', iso_uploading: '正在上传…', iso_verifying: '正在校验 MD5…',
    iso_uploaded_ok: 'ISO「{name}」已上传完成', iso_size_label: '文件大小',

    // ===== P12 备份：新建任务对话框 =====
    bk_new_title: '新建备份任务',
    bk_scope: '备份对象', bk_scope_vm: '单台虚拟机', bk_scope_vms: '多台虚拟机', bk_scope_cluster: '整个集群',
    bk_pick_vm: '选择虚拟机', bk_pick_vms: '选择多台虚拟机（可多选）', bk_pick_cluster: '选择集群',
    bk_mode_label: '备份模式', bk_mode_differential: '差异', bk_mode_full_desc: '完整备份所有数据',
    bk_mode_inc_desc: '仅备份上次备份后变化的数据', bk_mode_diff_desc: '备份上次全量后变化的数据',
    bk_location: '存储位置', bk_loc_local: '本地存储池', bk_loc_nfs: 'NFS 共享', bk_loc_s3: 'S3 对象存储',
    bk_loc_target: '目标位置', bk_s3_bucket: 'S3 Bucket', bk_s3_bucket_ph: '如：cnf-backup',
    bk_nfs_path: 'NFS 路径', bk_nfs_path_ph: '如：192.168.10.50:/export/backup',
    bk_sched_label: '调度策略', bk_sched_manual: '手动', bk_sched_cron: '定时（Cron）',
    bk_cron_expr: 'Cron 表达式', bk_cron_ph: '如：0 3 * * *（每日 03:00）',
    bk_retain_label: '保留策略', bk_retain_count: '保留最近 N 份', bk_retain_days: '保留最近 N 天',
    bk_retain_n: '份数 / 天数', bk_created: '备份任务「{name}」已创建',

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
    // N4 · 虚拟机编辑设置（多页签）
    vme_title: '编辑设置', vme_tab_cpu: '硬件资源', vme_tab_disk: '虚拟磁盘', vme_tab_nic: '网络适配器', vme_tab_boot: '引导选项',
    vme_hotplug_hint: '运行中可热插增大 vCPU/内存；缩减需重启生效。',
    vme_disk: '虚拟磁盘', vme_disk_name: '磁盘名称', vme_disk_pool: '存储池', vme_disk_size: '容量', vme_disk_bus: '总线类型',
    vme_disk_format: '格式', vme_disk_cache: '缓存模式', vme_disk_iops: 'IOPS 上限', vme_disk_shareable: '可共享（多挂载）',
    vme_thin: '精简置备', vme_thick: '厚置备', vme_unlimited: '不限制', vme_add_disk: '添加虚拟磁盘',
    vme_nic: '网络适配器', vme_nic_model: '适配器型号', vme_nic_portgroup: '端口组 / VLAN', vme_nic_queues: '多队列数',
    vme_nic_connected: '已连接', vme_add_nic: '添加网络适配器',
    vme_sriov_pf: 'SR-IOV 物理网卡 (PF)', vme_sriov_vf: '虚拟功能 (VF)', vme_sriov_none: '该宿主机未启用 SR-IOV，请先在主机硬件中开启',
    vme_select: '请选择…', vme_free: '空闲',
    vme_firmware: '固件', vme_secure_boot: '安全启动 (Secure Boot)', vme_boot_order: '引导顺序',
    vme_boot_disk: '硬盘', vme_boot_cdrom: '光驱', vme_boot_network: '网络 (PXE)', vme_boot_menu: '开机显示引导菜单',
    vme_err_no_disk: '至少需要保留一块虚拟磁盘', vme_err_sriov: 'SR-IOV 网卡必须选择 PF 和 VF',
    // N5 · 宿主机 SR-IOV
    sriov_title: 'SR-IOV 网卡（VF 直通）', sriov_enable: '启用 SR-IOV', sriov_disable: '禁用',
    sriov_need_iommu: '请先在上方开启 IOMMU/VFIO', sriov_empty: '尚未在任何物理网卡上启用 SR-IOV',
    sriov_pf_name: '物理网卡 (PF)', sriov_num_vfs: 'VF 数量', sriov_vf_usage: 'VF 占用',
    sriov_hint: '启用后将在该网卡创建指定数量的虚拟功能 (VF)，可在虚拟机网卡配置中直通分配。需 IOMMU 已开启。',

    // ===== 通用操作 / 工具栏 / CRUD / 对话框 =====
    op_new: '新建', op_edit: '编辑', op_delete: '删除', op_batch: '批量操作',
    op_filter: '筛选', op_search: '搜索', op_refresh: '刷新', op_reset: '重置',
    op_confirm: '确定', op_failed: '操作被阻止', op_cancel: '取消', op_save: '保存', op_close: '关闭',
    op_selected_n: '已选 {n} 项', op_batch_delete: '批量删除', op_batch_start: '批量启动', op_batch_stop: '批量关机',
    op_select_all: '全选', op_actions: '操作', op_no_data: '暂无数据',
    op_total_n: '共 {n} 条', op_page_prev: '上一页', op_page_next: '下一页', op_page_of: '第 {c}/{t} 页',
    op_loading: '加载中…', op_required: '此项为必填', op_invalid: '格式不正确',
    confirm_delete_title: '确认删除', confirm_delete_msg: '确定要删除「{name}」吗？此操作不可恢复。',
    confirm_batch_delete_msg: '确定要删除选中的 {n} 个对象吗？此操作不可恢复。',
    toast_success: '操作成功', toast_failed: '操作失败', toast_deleted: '已删除「{name}」',
    toast_created: '已创建「{name}」', toast_saved: '已保存', toast_canceled: '已取消',

    // ===== 数据中心 / 集群 创建·编辑 =====
    dc_create: '新建数据中心', dc_edit: '编辑数据中心', dc_name_ph: '如：北京一区 (DC-Beijing-01)',
    dc_location: '所在地域', dc_location_ph: '如：北京·亦庄', dc_timezone: '时区',
    dc_desc: '描述', dc_desc_ph: '用途 / 备注（可选）',
    cl_create: '新建集群', cl_edit: '编辑集群', cl_name_ph: '如：生产集群 Prod-A',
    cl_desc_ph: '用途 / 备注（可选）', cl_ha: 'HA 高可用',
    cl_ntp_title: '时间同步（NTP）', cl_ntp_hint: '启用 HA 时强烈建议，确保各主机时间一致',
    cl_ntp_mode: 'NTP 模式', cl_ntp_internal: '内部 NTP 源（集群内主机授时，推荐）', cl_ntp_external: '外部 NTP 源',
    cl_ntp_offset: '最大时钟偏移 (ms)', cl_ntp_server: '内部 NTP 服务端', cl_ntp_auto: '自动选择（首台在线主机）',
    cl_ntp_servers: '外部 NTP 服务器', cl_ntp_no_host: '集群尚无主机，纳管主机后可指定其一作为内部 NTP 服务端（暂自动选择）。',

    // ===== 用户管理（完整 CRUD + 配额）=====
    user_st_active: '正常', user_st_disabled: '已禁用', user_st_locked: '已锁定',
    user_edit: '编辑用户', user_quota: '资源配额', user_disable: '禁用', user_enable: '启用',
    user_quota_advanced: '高级设置 · 资源配额', user_quota_default_hint: '默认按角色分配，可展开自定义',
    user_reset_pwd: '重置密码', user_username_rule: '仅限英文字母、数字和下划线',
    user_email_invalid: '请输入有效的邮箱地址', user_pwd_rule: '密码至少 6 位', user_pwd_mismatch: '两次密码不一致',
    user_display_ph: '如：张运维', user_phone: '手机号', user_password: '密码', user_password2: '确认密码',
    user_pwd_keep: '留空则不修改', user_max_vms: '最大虚拟机数', user_max_vcpus: '最大 vCPU',
    user_max_mem: '最大内存', user_max_storage: '最大存储', user_del_blocked: '无法删除用户',
    user_del_confirm: '确定删除用户「{name}」？此操作不可恢复。',

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
    pool_create: '新建资源池', pool_edit: '编辑资源池', pool_name_ph: '如：生产业务池 Prod-Pool',
    pool_shares: '份额（Shares）', pool_shares_hint: '资源争用时按份额比例分配',
    pool_shares_high_d: '争用时优先保障', pool_shares_normal_d: '默认优先级', pool_shares_low_d: '争用时优先让出',
    pool_cpu_alloc: 'CPU 资源分配', pool_mem_alloc: '内存资源分配',
    pool_err_cpu_reserve: 'CPU 预留不能超过上限', pool_err_mem_reserve: '内存预留不能超过上限',
    // N1 术语澄清：区分「主机连接状态」与「虚拟机电源状态」（对标 VMware）
    host_conn_rate: '主机连接率', host_conn_rate_tip: '该数据中心内「已连接」主机占全部主机的比例（主机连接状态，非虚拟机运行状态）',
    vm_run_rate: '虚拟机运行率', vm_run_rate_tip: '处于「运行中」电源状态的虚拟机占比',
    host_connected: '已连接', host_disconnected: '已断开', host_maintenance: '维护模式',
    vm_powered_on: '运行中', vm_powered_off: '已关机', vm_suspended: '已暂停',

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
    // MTU 自定义
    sw_mtu_standard: '标准', sw_mtu_jumbo: '巨型帧', sw_mtu_hint: '可填 576~9216 任意值，常用 1500 / 9000',
    sw_mtu_range: 'MTU 须为 576~9216',
    // VLAN 创建
    vlan_id_range: 'VLAN ID 须为 1~4094', vlan_id_dup: '该 VLAN ID 已存在', vlan_id_hint: '取值范围 1~4094',
    vlan_name_ph: '如：业务前端 VLAN', vlan_subnet_invalid: '请输入有效 CIDR，如 10.10.1.0/24', vlan_dhcp_enable: '启用 DHCP',

    // ===== 监控 · 告警规则 =====
    rule_title: '告警规则', rule_add: '新建规则', rule_name: '规则名', rule_metric: '监控指标',
    rule_condition: '触发条件', rule_severity: '级别', rule_triggered: '触发次数', rule_channel: '通知渠道', rule_enabled: '启用',
    sev_critical: '严重', sev_warning: '警告', sev_info: '提示',
    // —— 监控总览 KPI / 健康度 / 图表 ——
    mon_overview: '总览', mon_health: '系统健康度', mon_health_healthy: '健康', mon_health_warning: '亚健康', mon_health_critical: '告警',
    mon_kpi_hosts: '在线主机', mon_kpi_vms: '运行虚拟机', mon_kpi_cpu: '集群 CPU', mon_kpi_mem: '集群内存',
    mon_kpi_storage: '存储用量', mon_kpi_alerts: '活跃告警', mon_kpi_gpu: 'GPU 占用', mon_kpi_overcommit: 'vCPU 超分',
    mon_chart_cpumem: 'CPU / 内存利用率趋势', mon_chart_net: '网络吞吐 (Mbps)', mon_chart_iops: '存储 IOPS 趋势',
    mon_net_in: '入向', mon_net_out: '出向', mon_realtime_hosts: '主机实时负载', mon_no_alerts: '无活跃告警',
    // —— 告警规则 CRUD ——
    rule_create_title: '新建告警规则', rule_edit_title: '编辑告警规则', rule_metric_ph: '如 host.cpu_usage',
    rule_cond_ph: '如 > 90% 持续 5 分钟', rule_del_confirm: '确认删除告警规则「{name}」？',
    rule_op_edit: '编辑', rule_op_del: '删除', rule_op_toggle: '启用/停用',

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
    // ===== 主机管理 v2.0 (zh) =====
    nav_mod_hosts: '主机管理', nav_hosts_list: '主机列表', nav_hosts_detail: '主机管理 / 网络',
    host_search_ph: '搜索主机名 / IP / 集群', host_filter_all: '全部状态',
    host_st_online: '已连接', host_st_maint: '维护模式', host_st_offline: '已断开',
    // N3 主机右键菜单
    hctx_group_power: '电源（IPMI/BMC）', hctx_group_maint: '维护', hctx_group_config: '网络与配置',
    hctx_power_on: '开机', hctx_reboot: '重启主机', hctx_shutdown: '关机',
    hctx_enter_maint: '进入维护模式', hctx_exit_maint: '退出维护模式',
    hctx_edit_network: '修改管理网络', hctx_open_detail: '主机详情', hctx_remove: '从集群移除',
    ctx_more_actions: '更多操作（右键）',
    dctx_group_create: '新建', dctx_group_config: '配置', dctx_group_danger: '危险操作',
    dctx_new_cluster: '在此新建集群', dctx_add_host: '向此纳管主机',
    dctx_edit: '编辑数据中心', dctx_open_detail: '查看拓扑详情', dctx_delete: '删除数据中心',
    dctx_delete_blocked: '该数据中心下仍有集群，需先删除所有子集群',
    cctx_group_manage: '主机管理', cctx_group_config: '配置', cctx_group_danger: '危险操作',
    cctx_add_host: '向此集群纳管主机', cctx_view_hosts: '查看集群主机',
    cctx_edit: '编辑集群', cctx_open_detail: '查看拓扑详情', cctx_delete: '删除集群',
    cctx_delete_blocked: '该集群下仍有主机，需先移除所有主机',
    hctx_maint_block_title: '无法进入维护模式',
    hctx_maint_block_msg: '该主机上有 {n} 台虚拟机处于运行中。进入维护模式前，必须先将这些虚拟机完整迁移到其它主机，迁移完成后才能进入维护模式。',
    hctx_maint_migrate_now: '前往迁移',
    hctx_exit_ok: '已退出维护模式，主机恢复调度',
    hctx_enter_ok: '已进入维护模式',
    hctx_poweron_ok: '已下发开机指令（IPMI/BMC）',
    hctx_reboot_ok: '已下发重启指令',
    hctx_shutdown_confirm: '确认关闭主机 {name}？其上虚拟机将随之停止。',
    hctx_shutdown_ok: '已下发关机指令',
    host_enter_maint: '进入维护模式', host_exit_maint: '退出维护模式', host_back: '返回列表',
    host_pick_hint: '请选择一台主机查看其概览 / 硬件 / HA 状态 / 虚拟机详情。', host_view_detail: '查看详情',
    // 主机管理 / 网络 页（按集群分组统一管理宿主机管理网络）
    hmn_title: '主机管理 / 管理网络', hmn_intro: '按集群分组统一查看与配置宿主机的管理网络（IP / 子网掩码 / 网关 / 管理 VLAN / 上联网卡）。',
    hmn_col_host: '主机', hmn_col_status: '状态', hmn_col_ip: '管理 IP', hmn_col_netmask: '子网掩码', hmn_col_gateway: '网关', hmn_col_vlan: '管理 VLAN', hmn_col_nic: '上联网卡', hmn_col_ops: '操作',
    hmn_cluster: '集群', hmn_hosts_n: '台主机', hmn_batch: '统一修改管理网络', hmn_edit_host: '编辑管理网络',
    hmn_edit_title: '编辑主机管理网络', hmn_batch_title: '统一修改集群管理网络',
    hmn_batch_hint: '仅下发已填写的字段，留空表示不修改。各主机的管理 IP 保持原值（IP 唯一，不做批量覆盖）。',
    hmn_keep: '（留空＝不修改）', hmn_no_hosts: '该集群下暂无主机',
    hmn_ip_invalid: '管理 IP 格式无效', hmn_netmask_invalid: '子网掩码格式无效', hmn_gateway_invalid: '网关格式无效', hmn_vlan_invalid: '管理 VLAN 须为 0~4094', hmn_ip_conflict: '该管理 IP 已被占用',
    host_maint_blocked: '无法进入维护模式 —— 主机上仍有运行中的虚拟机，请先迁移或关闭它们。',
    host_tab_overview: '概览', host_tab_hardware: '硬件', host_tab_ha: 'HA 状态', host_tab_monitor: '监控', host_tab_vms: '虚拟机',
    host_threads: '线程', host_sockets: '物理 CPU', host_no_vms: '该主机上没有虚拟机', host_perf_trend: '性能趋势（最近一小时）',
    hw_cpu_topo: 'CPU 拓扑', hw_model: '型号', hw_vendor: '厂商', hw_sockets: '物理路数', hw_cores_socket: '每路核心数',
    hw_threads_total: '总线程数', hw_freq: '频率', hw_virt_feat: '虚拟化特性',
    hw_nics: '网络接口', hw_nic_name: '名称', hw_type: '类型', hw_vendor_model: '厂商 / 型号', hw_speed: '速率', hw_link: '链路', hw_traffic: '实时流量（收/发）',
    hw_storage_dev: '存储设备', hw_dev_name: '设备', hw_capacity: '容量', hw_interface: '接口', hw_rpm: '转速', hw_temp: '温度', hw_usage: '使用率',
    hw_pci_dev: 'PCI 设备', hw_dev_class: '设备类别', hw_driver: '驱动', hw_passthrough: '可直通',
    hw_mgmt_net: '管理网络', hw_mgmt_edit: '编辑',
    hw_iommu_title: 'IOMMU / VFIO 直通就绪', hw_iommu_on: '已启用', hw_iommu_off: '未启用',
    hw_iommu_intro: '启用后才能将 GPU / NIC 等 PCI 设备直通给虚拟机（创建 VM 选择 GPU 的前置条件）。',
    hw_iommu_enable: '启用 IOMMU/VFIO', hw_iommu_disable: '禁用 IOMMU/VFIO',
    hw_iommu_count: '可直通设备 {cap} 个 · 已绑定 {bound} 个',
    hw_iommu_need_first: '请先启用主机 IOMMU/VFIO', hw_iommu_reboot_hint: '内核引导参数变更，需重启主机后生效。',
    hw_gpu_title: 'GPU 管理', hw_gpu_assigned: '已分配', hw_gpu_free: '空闲',
    hw_gpu_owner: '归属 VM', hw_gpu_idle_desc: '当前空闲，可分配给虚拟机',
    hw_gpu_passthrough: 'PCI 直通', hw_gpu_vgpu: 'vGPU 切分',
    hw_gpu_release: '释放', hw_gpu_set_pt: '切到直通', hw_gpu_set_vgpu: '切到 vGPU',
    hw_pt_status: '直通状态', hw_pt_in_use: '已直通(占用)', hw_pt_bound: '已绑定vfio', hw_pt_host: '主机占用', hw_pt_na: '不支持',
    hw_pt_bind: '绑定直通', hw_pt_unbind: '还原驱动', hw_pt_locked: '已被 VM 占用',
    ha_health_score: 'HA 健康分', ha_last_check: '最后检查', ha_interval: '检查间隔', ha_enabled_on: 'HA 已启用', ha_enabled_off: 'HA 未启用',
    ha_check_network_heartbeat: '网络心跳', ha_check_storage_heartbeat: '存储心跳', ha_check_libvirt_service: '虚拟化服务', ha_check_resource_availability: '资源可用性', ha_check_fencing_capability: 'Fencing（STONITH）', ha_check_time_sync: '时间同步（NTP）',
    ha_resp: '响应时间', ha_loss: '丢包率', ha_fails: '连续失败', ha_lat: '延迟', ha_lock: '锁文件', ha_failover_cap: '故障转移容量', ha_fence_agent: 'Fence 代理',
    ha_clock_offset: '时钟偏移', ha_offset_thresh: '偏移阈值', ha_ntp_server: '内部 NTP 服务端', ha_ntp_source: 'NTP 源',
    ha_events: '最近 HA 事件', ha_affected: '受影响虚拟机', ha_no_events: '近期无 HA 事件',
    ha_overall_healthy: '健康', ha_overall_degraded: '降级', ha_overall_failed: '故障',
  },
  en: {
    brand_name: 'Cloud Nexus Forging', brand_abbr: 'CNF', brand_version: 'v1.0.1',
    brand_sub: 'Enterprise Distributed Virtualization Platform',
    mode_demo: 'Prototype Demo', mode_prod: 'Production · Real Backend',
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
    dash_cluster_load: 'Per-Cluster Live Load', dash_online: 'online',
    dash_gpu_summary: 'GPU Summary', dash_gpu_total: 'Total GPUs', dash_gpu_busy: 'In Use', dash_gpu_idle: 'Idle', dash_gpu_avg: 'Avg Util',
    dash_cpu_live_obj: 'Cluster CPU Usage (All Clusters Aggregated)', dash_cpu_scope_all: 'All Clusters',
    dash_pool_cap_obj: 'Resource Pool Capacity (All Clusters)', dash_gpu_summary_obj: 'GPU Accelerator Summary (All Clusters)',
    dash_gpu_card_owner: 'Host', dash_gpu_card_vm: 'Assigned to', dash_gpu_card_idle: 'Idle / Available',
    dash_gpu_assigned: 'Assigned', dash_gpu_available: 'Available', dash_gpu_mode_pt: 'Passthrough', dash_gpu_mode_vgpu: 'vGPU',
    dash_gpu_unassigned_vm: 'No VM assigned', dash_gpu_host_col: 'Host', dash_gpu_owner_col: 'Consumer',
    dash_gpu_detail_title: 'GPU Device Details (Ownership & Consumer)', dash_gpu_util_col: 'Util', dash_gpu_temp_col: 'Temp',
    dash_cpu_legend: 'Cluster Avg CPU Usage (%)',
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
    hw_precheck_hint: 'Detecting virtualization compute components and connectivity; missing parts will be pushed as offline dependency packages by the platform',
    hw_check_net: 'Network connectivity', hw_check_virt: 'CPU virtualization support', hw_check_mem: 'Memory & hardware', hw_check_ssh: 'SSH connection',
    hw_check_libvirt: 'Virtualization components (libvirt/KVM)', hw_check_tcp: 'libvirtd TCP listener',
    hw_check_wait: 'Waiting', hw_check_running: 'Checking…',
    hw_check_reachable: 'Reachable · SSH port open', hw_check_unreachable: 'Unreachable / SSH refused',
    hw_check_ssh_ok: 'Authenticated ({user})', hw_check_failed: 'Probe failed',
    hw_check_virt_ok: 'Supported (VT-x/AMD-V · /dev/kvm)', hw_check_virt_no: 'Virtualization disabled in BIOS or no /dev/kvm',
    hw_check_libvirt_ok: 'Installed & running', hw_check_libvirt_stopped: 'Installed but not running (will auto-start)',
    hw_check_libvirt_no: 'Missing (enable auto-fill or install manually)', hw_check_libvirt_autoinstall: 'Missing · platform will push offline dependency packages to fill in',
    hw_check_tcp_ok: 'TCP {port} listening', hw_check_tcp_no: 'Not listening (enable auto-fill or configure manually)', hw_check_tcp_autoinstall: 'Not listening · auto-configured on onboarding',
    hw_check_mem_unknown: 'Collecting hardware info',
    hw_auto_install: 'Auto-install virtualization compute components (libvirt / KVM)',
    hw_auto_install_desc: 'Detect the components already installed on the target host; missing parts are pushed by the platform as offline dependency packages and installed locally. Already installed components are skipped.',
    hw_precheck_blocked: 'CPU virtualization failed, or virtualization components/TCP missing while auto-install is off. Enable auto-install, or install/configure on the target host first.',
    hw_recheck: 'Re-check',
    hw_dep_installing: 'Detecting components and filling in missing virtualization compute components (offline packages first)…', hw_dep_onboarding: 'Collecting hardware, persisting and verifying via qemu+tcp…',
    hw_dep_ready: 'Click "Start Onboarding" to onboard the node', hw_dep_ready_auto: 'Click "Start Onboarding": detect components, fill missing parts via platform offline packages, then onboard',
    hw_dep_success: 'Host {host} joined cluster {cluster}', hw_dep_failed: 'Onboarding failed, see log below',
    hw_install_log: 'Install & config log (real execution)', hw_log_live: 'LIVE',
    hw_offline_ready: 'Platform offline dependency packages ready', hw_offline_pkgs: 'packages', hw_offline_fallback: 'missing components pushed for local install — no dependency on target host online repos',
    hw_offline_empty: 'No offline dependency packages on platform yet; will fall back to the target host online repos (preset offline packages to remove this dependency)',
    hw_dep_connect: 'Connecting to host…', hw_dep_virt: 'Installing virtualization…', hw_dep_vswitch: 'Configuring virtual switch…',
    hw_dep_agent: 'Deploying management agent…', hw_dep_register: 'Registering to cluster…', hw_dep_sync: 'Syncing network config…', hw_dep_done: 'Provision complete!',
    hw_prev: 'Back', hw_next: 'Next', hw_run_precheck: 'Run Pre-check', hw_start_deploy: 'Start Onboarding', hw_finish: 'Finish',
    hw_add_host: 'Add Host',
    // ===== Host hardware =====
    host_nic_model: 'NIC', host_raid_model: 'RAID', host_disk_model: 'Disk',
    host_cluster: 'Cluster', host_dc: 'Datacenter', host_vms_running: 'Running VMs',
    // ===== VM migration =====
    mig_title: 'Migrate VM', mig_select_target: 'Select target host', mig_no_target: 'No other available host in this cluster',
    mig_same_cluster: 'Only online hosts within the same cluster', mig_cpu_free: 'CPU free', mig_mem_free: 'Mem free',
    mig_in_progress: 'Migrating {vm} to {host}…', mig_success: '{vm} migrated to {host}', mig_start: 'Start Migration',
    mig_source: 'Source Host', mig_mode_live: 'Live Migration', mig_mode_cold: 'Cold Migration',
    mig_cold_only: 'This VM is powered off; only cold migration is supported.',
    mig_pick_dc: '① Datacenter', mig_pick_cluster: '② Cluster', mig_pick_host: '③ Target Host',
    mig_pick_dc_first: 'Select a datacenter first', mig_pick_cluster_first: 'Select a cluster first', mig_no_host: 'No migratable host in this cluster',
    mig_free: 'Free', mig_planning: 'Evaluating migration plan…',
    mig_fit_ok: 'Sufficient', mig_fit_insufficient: 'Insufficient', mig_fit_unavailable: 'Unavailable',
    mig_shared_storage: 'Shared Storage (no disk move)', mig_storage_migration: 'Storage Migration (sync disks)',
    mig_net_path: 'Network Path', mig_blocked: 'Cannot migrate',
    mig_start_live: 'Start Live Migration', mig_start_cold: 'Start Cold Migration',
    mig_chk_cpu: 'CPU Capacity', mig_chk_mem: 'Memory Capacity', mig_chk_host: 'Host Status', mig_chk_cpu_compat: 'CPU Compatibility', mig_chk_storage: 'Storage', mig_chk_gpu: 'GPU Passthrough',
    mig_center_tip_title: 'Migration is now launched from the VM list',
    mig_center_tip: 'In Compute → Virtual Machines, right-click a VM → Migrate, then pick the target by Datacenter → Cluster → Host. Resource checks, live/cold decision and shared-storage/storage-migration logic are handled automatically. This page keeps the migration history only.',
    mig_goto_vms: 'Go to VM List', mig_no_history: 'No migration records yet',
    // ===== Cascade delete checks =====
    del_blocked_title: 'Cannot Delete', del_dc_has_cluster: 'Datacenter still has clusters, remove them first',
    del_cluster_has_host: 'Cluster still has hosts, remove them first', del_host_has_vm: 'Host still has running VMs, migrate or stop them first',
    del_blocked_children: 'Related objects', op_remove: 'Remove',

    gpu_vgpu: 'vGPU',

    st_capacity: 'Capacity', st_read_iops: 'Read IOPS', st_write_iops: 'Write IOPS',
    st_latency: 'Latency', st_active: 'Active', st_shared: 'Shared Storage', st_local: 'Local Storage',
    // —— Storage pool wizard / CRUD ——
    sp_pools: 'Storage Pools', sp_add: 'New Storage Pool', sp_create_title: 'New Storage Pool', sp_cluster: 'Cluster',
    sp_name: 'Pool Name', sp_name_ph: 'e.g. prod-ssd-pool', sp_type: 'Storage Type', sp_capacity: 'Capacity (TB)',
    sp_volumes: 'Volumes', sp_free: 'Free', sp_delete: 'Delete Pool',
    sp_type_local: 'Local Directory', sp_type_local_d: 'Host-local disk/directory, non-shared, highest performance',
    sp_type_nfs: 'NFS Share', sp_type_nfs_d: 'NFS network share, shareable across hosts',
    sp_type_iscsi: 'iSCSI', sp_type_iscsi_d: 'IP-SAN block storage via iSCSI target',
    sp_type_fc: 'FC SAN', sp_type_fc_d: 'Fibre Channel SAN, enterprise high-throughput low-latency',
    sp_type_dist: 'Distributed', sp_type_dist_d: 'Scale-out distributed block storage, 3-replica HA',
    sp_f_target_path: 'Local Path', sp_f_nfs_server: 'NFS Server', sp_f_nfs_export: 'Export Path',
    sp_f_iscsi_portal: 'iSCSI Portal', sp_f_iscsi_iqn: 'Target IQN',
    sp_f_fc_wwpn: 'WWPN', sp_f_dist_monitors: 'Monitors', sp_f_dist_pool: 'Pool Name',
    sp_step_type: 'Select Type', sp_step_conn: 'Connection', sp_step_basic: 'Basics',
    sp_conn_hint: 'Provide the connection parameters for this storage type', sp_del_has_vol: 'Pool still has volumes, delete them first',
    // —— Volume CRUD ——
    vol_create_title: 'New Volume', vol_create: 'Create', vol_delete: 'Delete Volume', vol_del_attached: 'Volume attached to running VM',
    vol_no_vm: 'Unattached', vol_iops_ph: '0 = unlimited',
    // —— Snapshot ops ——
    snap_revert_confirm: 'Revert {vm} to snapshot "{name}"? Unsaved current state will be lost.',
    snap_del_confirm: 'Delete snapshot "{name}"?', snap_del_current: 'Current snapshot cannot be deleted',

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

    wiz_ns1: 'OS & Name', wiz_ns2: 'Placement', wiz_ns3: 'CPU & Memory', wiz_ns4: 'NUMA & Pinning',
    wiz_ns5: 'Disk & Network', wiz_ns6: 'GPU', wiz_ns7: 'Review & Create',
    wiz_guest_os: 'Guest Operating System', wiz_guest_os_hint: 'Pick a KVM-supported guest OS; firmware and machine type are auto-matched.',
    wiz_os_family_linux: 'Linux', wiz_os_family_windows: 'Windows',
    wiz_auto_fw: 'Auto firmware', wiz_auto_machine: 'Auto machine type',
    wiz_fw_uefi: 'UEFI (OVMF)', wiz_fw_bios: 'BIOS (SeaBIOS)',
    wiz_machine_q35: 'q35 (modern chipset, recommended)', wiz_machine_i440fx: 'pc-i440fx (legacy)',
    wiz_fw_explain: 'Firmware / machine type are auto-derived from the selected OS. Override under Advanced if needed.',
    wiz_advanced: 'Advanced', wiz_show_advanced: 'Show advanced', wiz_hide_advanced: 'Hide advanced',
    wiz_place_hint: 'A VM must be placed: Datacenter → Cluster → Host. The target host capacity is validated.',
    wiz_sel_dc: 'Datacenter', wiz_sel_cluster: 'Cluster', wiz_sel_host: 'Host',
    wiz_host_cap: 'Available capacity', wiz_host_cap_cpu: 'Free vCPU', wiz_host_cap_mem: 'Free memory',
    wiz_host_offline_warn: 'Host is offline and cannot host VMs', wiz_pick_dc_first: 'Select a datacenter first',
    wiz_pick_cluster_first: 'Select a cluster first', wiz_no_host_in_cluster: 'No available host in this cluster',
    wiz_cap_ok: 'Sufficient', wiz_cap_warn: 'Tight', wiz_cap_insufficient: 'Insufficient — cannot create',
    wiz_vcpu_count: 'vCPU count', wiz_vcpu_hint: 'By default just set the vCPU count; expand Advanced for Socket×Core×Thread tuning.',
    wiz_topo_advanced: 'Advanced: custom CPU topology', wiz_mem_gb: 'Memory (GB)',
    wiz_numa_select_hint: 'Binding vCPU+memory to one NUMA node reduces cross-node latency. Pick a NUMA node of the target host:',
    wiz_numa_auto_label: 'Let scheduler place automatically (no NUMA)',
    wiz_numa_node_n: 'NUMA Node', wiz_numa_node_cores: 'Cores', wiz_numa_node_mem: 'Local memory',
    wiz_pin_section: 'CPU Pinning', wiz_pin_toggle: 'Enable CPU pinning (dedicated physical cores)',
    wiz_pin_auto_desc: 'When enabled, dedicated cores are auto-allocated contiguously from the chosen NUMA node (SmartX CloudTower best practice — no manual grid).',
    wiz_pin_preview: 'Pinning preview', wiz_pin_vcpu: 'vCPU', wiz_pin_pcpu: 'pCPU',
    wiz_pin_need_numa: 'Select a specific NUMA node above before enabling pinning.',
    wiz_nic_queues: 'NIC multiqueue', wiz_nic_queues_hint: 'Multiqueue parallelizes network IRQ handling under high throughput; set to vCPU count (virtio only, 1=off).',
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
    nav_mon_overview: 'Overview', nav_mon_realtime: 'Real-time', nav_mon_history: 'History', nav_mon_rules: 'Alert Rules',
    nav_acc_users: 'Users', nav_acc_roles: 'Roles & Privileges', nav_acc_audit: 'Audit Log',
    nav_sys_config: 'General', nav_sys_license: 'License', nav_sys_about: 'About',

    // ===== Toolbar =====
    tb_search_ph: 'Search VMs / hosts / tasks…', tb_notifications: 'Notifications',
    tb_mark_all_read: 'Mark all read', tb_no_notifications: 'No notifications', tb_logout: 'Sign Out',
    logout_success: 'Signed out, redirecting to login…',

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

    // ===== P8 Template: new / deploy dialogs =====
    tpl_new_title: 'New Template', tpl_source: 'Creation Method',
    tpl_src_convert: 'Convert from Stopped VM', tpl_src_blank: 'New Blank Template',
    tpl_src_convert_hint: 'Convert a stopped VM into a reusable template (clone disk + generalize)',
    tpl_src_blank_hint: 'Define a blank template from scratch; attach an ISO later to install the OS',
    tpl_pick_vm: 'Source VM (must be stopped)', tpl_name_ph: 'e.g. tpl-rocky9-base',
    tpl_guest_os: 'Guest OS', tpl_vcpu: 'vCPUs', tpl_mem: 'Memory (GB)', tpl_disk: 'System Disk (GB)',
    tpl_tags: 'Preinstalled Tags', tpl_tags_ph: 'e.g. cloud-init, qemu-guest-agent (comma separated)',
    tpl_no_stopped_vm: 'No stopped VM available to convert',
    tpl_deploy_title: 'Deploy VM from Template', tpl_deploy_from: 'Source Template',
    tpl_deploy_count: 'Deploy Count', tpl_deploy_prefix: 'VM Name Prefix', tpl_deploy_prefix_ph: 'e.g. web-prod-',
    tpl_deploy_host: 'Target Host', tpl_deploy_batch_hint: 'When count > 1, VMs are named by prefix+index (web-prod-01, web-prod-02…)',
    tpl_created: 'Template "{name}" created', tpl_deployed: 'Submitted deployment of {n} VM(s) from template "{name}"',

    // ===== P9 ISO: upload dialog (local/URL + MD5) =====
    iso_upload_title: 'Upload ISO Image', iso_src_local: 'Local File Upload', iso_src_url: 'Remote URL Download',
    iso_local_file: 'Select Local ISO File', iso_local_pick: 'Click to choose a file (.iso)',
    iso_remote_url: 'Download URL', iso_remote_url_ph: 'https://… / ftp://… pointing to a .iso file',
    iso_target_pool: 'Target Pool', iso_md5: 'MD5 Checksum (optional)', iso_md5_ph: 'If set, verified after upload; leave blank to skip',
    iso_repo_title: 'ISO Image Repository · Storage & Sharing Scope',
    iso_repo_fallback: 'ISO images live in the iso subdirectory of a storage domain (pool). Images on shared domains (NFS/iSCSI) are visible to all hosts of the owning cluster; local domains are visible to a single host only.',
    iso_store_domain: 'Storage Domain', iso_scope: 'Scope', iso_visible_hosts: 'Visible Hosts',
    iso_scope_cluster: 'Cluster-shared', iso_scope_host: 'Host-only', iso_scope_unknown: 'Unknown',
    iso_hint_cluster: 'Shared domain: usable by all hosts in the cluster to create/attach VMs', iso_hint_host: 'Local domain: visible to the single mounting host only, not across hosts/clusters/datacenters',
    iso_progress: 'Upload Progress', iso_uploading: 'Uploading…', iso_verifying: 'Verifying MD5…',
    iso_uploaded_ok: 'ISO "{name}" uploaded', iso_size_label: 'File Size',

    // ===== P12 Backup: new job dialog =====
    bk_new_title: 'New Backup Job',
    bk_scope: 'Backup Scope', bk_scope_vm: 'Single VM', bk_scope_vms: 'Multiple VMs', bk_scope_cluster: 'Entire Cluster',
    bk_pick_vm: 'Select VM', bk_pick_vms: 'Select VMs (multi-select)', bk_pick_cluster: 'Select Cluster',
    bk_mode_label: 'Backup Mode', bk_mode_differential: 'Differential', bk_mode_full_desc: 'Back up all data',
    bk_mode_inc_desc: 'Only data changed since last backup', bk_mode_diff_desc: 'Data changed since last full backup',
    bk_location: 'Storage Location', bk_loc_local: 'Local Pool', bk_loc_nfs: 'NFS Share', bk_loc_s3: 'S3 Object Storage',
    bk_loc_target: 'Target Location', bk_s3_bucket: 'S3 Bucket', bk_s3_bucket_ph: 'e.g. cnf-backup',
    bk_nfs_path: 'NFS Path', bk_nfs_path_ph: 'e.g. 192.168.10.50:/export/backup',
    bk_sched_label: 'Schedule', bk_sched_manual: 'Manual', bk_sched_cron: 'Scheduled (Cron)',
    bk_cron_expr: 'Cron Expression', bk_cron_ph: 'e.g. 0 3 * * * (daily 03:00)',
    bk_retain_label: 'Retention', bk_retain_count: 'Keep last N copies', bk_retain_days: 'Keep last N days',
    bk_retain_n: 'Copies / Days', bk_created: 'Backup job "{name}" created',

    // ===== Context menu =====
    ctx_group_power: 'Power', ctx_group_console: 'Console', ctx_group_snapshot: 'Snapshot',
    ctx_group_migration: 'Migrate & Clone', ctx_group_manage: 'Manage',
    ctx_power_on: 'Power On', ctx_shutdown: 'Shut Down (Guest)', ctx_reboot: 'Reboot',
    ctx_suspend: 'Suspend', ctx_resume: 'Resume', ctx_power_off: 'Force Power Off',
    ctx_open_console: 'Open Graphical Console', ctx_open_serial: 'Open Serial Terminal',
    ctx_take_snapshot: 'Take Snapshot', ctx_manage_snapshots: 'Manage Snapshots', ctx_revert_snapshot: 'Revert to Snapshot',
    ctx_migrate: 'Live Migrate', ctx_clone: 'Clone', ctx_to_template: 'Convert to Template',
    ctx_edit_settings: 'Edit Settings', ctx_rename: 'Rename', ctx_delete: 'Delete VM',
    vme_title: 'Edit Settings', vme_tab_cpu: 'Hardware', vme_tab_disk: 'Virtual Disks', vme_tab_nic: 'Network Adapters', vme_tab_boot: 'Boot Options',
    vme_hotplug_hint: 'vCPU/memory can be hot-added while running; reductions take effect after reboot.',
    vme_disk: 'Hard Disk', vme_disk_name: 'Disk Name', vme_disk_pool: 'Datastore', vme_disk_size: 'Capacity', vme_disk_bus: 'Bus',
    vme_disk_format: 'Format', vme_disk_cache: 'Cache Mode', vme_disk_iops: 'IOPS Limit', vme_disk_shareable: 'Shareable (multi-attach)',
    vme_thin: 'Thin', vme_thick: 'Thick', vme_unlimited: 'Unlimited', vme_add_disk: 'Add Hard Disk',
    vme_nic: 'Network Adapter', vme_nic_model: 'Adapter Type', vme_nic_portgroup: 'Port Group / VLAN', vme_nic_queues: 'Multi-queue',
    vme_nic_connected: 'Connected', vme_add_nic: 'Add Network Adapter',
    vme_sriov_pf: 'SR-IOV Physical NIC (PF)', vme_sriov_vf: 'Virtual Function (VF)', vme_sriov_none: 'SR-IOV not enabled on this host; enable it in Host Hardware first',
    vme_select: 'Select…', vme_free: 'free',
    vme_firmware: 'Firmware', vme_secure_boot: 'Secure Boot', vme_boot_order: 'Boot Order',
    vme_boot_disk: 'Hard Disk', vme_boot_cdrom: 'CD/DVD', vme_boot_network: 'Network (PXE)', vme_boot_menu: 'Show boot menu',
    vme_err_no_disk: 'At least one virtual disk is required', vme_err_sriov: 'SR-IOV adapter requires PF and VF',
    sriov_title: 'SR-IOV NICs (VF Passthrough)', sriov_enable: 'Enable SR-IOV', sriov_disable: 'Disable',
    sriov_need_iommu: 'Enable IOMMU/VFIO above first', sriov_empty: 'SR-IOV not enabled on any physical NIC',
    sriov_pf_name: 'Physical NIC (PF)', sriov_num_vfs: 'Number of VFs', sriov_vf_usage: 'VF Usage',
    sriov_hint: 'Creates the specified number of Virtual Functions (VFs) on the NIC, assignable to VMs via passthrough. Requires IOMMU enabled.',
    ctx_gpu_block: 'GPU passthrough does not support live migration',

    // ===== Common ops / toolbar / CRUD / dialog =====
    op_new: 'New', op_edit: 'Edit', op_delete: 'Delete', op_batch: 'Batch',
    op_filter: 'Filter', op_search: 'Search', op_refresh: 'Refresh', op_reset: 'Reset',
    op_confirm: 'OK', op_failed: 'Operation Blocked', op_cancel: 'Cancel', op_save: 'Save', op_close: 'Close',
    op_selected_n: '{n} selected', op_batch_delete: 'Batch Delete', op_batch_start: 'Batch Start', op_batch_stop: 'Batch Stop',
    op_select_all: 'Select All', op_actions: 'Actions', op_no_data: 'No data',
    op_total_n: '{n} total', op_page_prev: 'Prev', op_page_next: 'Next', op_page_of: 'Page {c}/{t}',
    op_loading: 'Loading…', op_required: 'This field is required', op_invalid: 'Invalid format',
    confirm_delete_title: 'Confirm Delete', confirm_delete_msg: 'Delete "{name}"? This cannot be undone.',
    confirm_batch_delete_msg: 'Delete the selected {n} objects? This cannot be undone.',
    toast_success: 'Success', toast_failed: 'Failed', toast_deleted: 'Deleted "{name}"',
    toast_created: 'Created "{name}"', toast_saved: 'Saved', toast_canceled: 'Canceled',

    // ===== Datacenter / Cluster create·edit =====
    dc_create: 'New Datacenter', dc_edit: 'Edit Datacenter', dc_name_ph: 'e.g. Beijing Zone 1 (DC-Beijing-01)',
    dc_location: 'Location', dc_location_ph: 'e.g. Beijing · Yizhuang', dc_timezone: 'Time Zone',
    dc_desc: 'Description', dc_desc_ph: 'Purpose / notes (optional)',
    cl_create: 'New Cluster', cl_edit: 'Edit Cluster', cl_name_ph: 'e.g. Prod Cluster Prod-A',
    cl_desc_ph: 'Purpose / notes (optional)', cl_ha: 'HA',
    cl_ntp_title: 'Time Sync (NTP)', cl_ntp_hint: 'Strongly recommended with HA to keep host clocks consistent',
    cl_ntp_mode: 'NTP Mode', cl_ntp_internal: 'Internal NTP source (host-served, recommended)', cl_ntp_external: 'External NTP source',
    cl_ntp_offset: 'Max Clock Offset (ms)', cl_ntp_server: 'Internal NTP Server', cl_ntp_auto: 'Auto (first online host)',
    cl_ntp_servers: 'External NTP Servers', cl_ntp_no_host: 'No hosts yet; after adding hosts you can designate one as the internal NTP server (auto for now).',

    // ===== User management (full CRUD + quota) =====
    user_st_active: 'Active', user_st_disabled: 'Disabled', user_st_locked: 'Locked',
    user_edit: 'Edit User', user_quota: 'Resource Quota', user_disable: 'Disable', user_enable: 'Enable',
    user_quota_advanced: 'Advanced · Resource Quota', user_quota_default_hint: 'Defaults by role, expand to customize',
    user_reset_pwd: 'Reset Password', user_username_rule: 'Letters, digits and underscore only',
    user_email_invalid: 'Please enter a valid email', user_pwd_rule: 'Password must be at least 6 chars', user_pwd_mismatch: 'Passwords do not match',
    user_display_ph: 'e.g. John Ops', user_phone: 'Phone', user_password: 'Password', user_password2: 'Confirm Password',
    user_pwd_keep: 'Leave blank to keep', user_max_vms: 'Max VMs', user_max_vcpus: 'Max vCPUs',
    user_max_mem: 'Max Memory', user_max_storage: 'Max Storage', user_del_blocked: 'Cannot Delete User',
    user_del_confirm: 'Delete user "{name}"? This cannot be undone.',

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
    pool_create: 'New Resource Pool', pool_edit: 'Edit Resource Pool', pool_name_ph: 'e.g. Prod-Pool',
    pool_shares: 'Shares', pool_shares_hint: 'Allocated proportionally under contention',
    pool_shares_high_d: 'Prioritized under contention', pool_shares_normal_d: 'Default priority', pool_shares_low_d: 'Yields under contention',
    pool_cpu_alloc: 'CPU Allocation', pool_mem_alloc: 'Memory Allocation',
    pool_err_cpu_reserve: 'Reservation cannot exceed limit', pool_err_mem_reserve: 'Reservation cannot exceed limit',
    host_conn_rate: 'Host Connectivity', host_conn_rate_tip: 'Percentage of hosts in "Connected" state in this datacenter (host connection state, not VM power state)',
    vm_run_rate: 'VM Running Rate', vm_run_rate_tip: 'Percentage of VMs in "Running" power state',
    host_connected: 'Connected', host_disconnected: 'Disconnected', host_maintenance: 'Maintenance',
    vm_powered_on: 'Running', vm_powered_off: 'Powered Off', vm_suspended: 'Suspended',

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
    // MTU custom
    sw_mtu_standard: 'Standard', sw_mtu_jumbo: 'Jumbo', sw_mtu_hint: 'Any value 576~9216, commonly 1500 / 9000',
    sw_mtu_range: 'MTU must be 576~9216',
    // VLAN create
    vlan_id_range: 'VLAN ID must be 1~4094', vlan_id_dup: 'This VLAN ID already exists', vlan_id_hint: 'Range 1~4094',
    vlan_name_ph: 'e.g. Frontend VLAN', vlan_subnet_invalid: 'Enter valid CIDR, e.g. 10.10.1.0/24', vlan_dhcp_enable: 'Enable DHCP',

    // ===== Monitoring alert rules =====
    rule_title: 'Alert Rules', rule_add: 'New Rule', rule_name: 'Rule', rule_metric: 'Metric',
    rule_condition: 'Condition', rule_severity: 'Severity', rule_triggered: 'Triggered', rule_channel: 'Channel', rule_enabled: 'Enabled',
    sev_critical: 'Critical', sev_warning: 'Warning', sev_info: 'Info',
    mon_overview: 'Overview', mon_health: 'System Health', mon_health_healthy: 'Healthy', mon_health_warning: 'Degraded', mon_health_critical: 'Critical',
    mon_kpi_hosts: 'Hosts Online', mon_kpi_vms: 'Running VMs', mon_kpi_cpu: 'Cluster CPU', mon_kpi_mem: 'Cluster Memory',
    mon_kpi_storage: 'Storage Usage', mon_kpi_alerts: 'Active Alerts', mon_kpi_gpu: 'GPU Utilization', mon_kpi_overcommit: 'vCPU Overcommit',
    mon_chart_cpumem: 'CPU / Memory Utilization Trend', mon_chart_net: 'Network Throughput (Mbps)', mon_chart_iops: 'Storage IOPS Trend',
    mon_net_in: 'Inbound', mon_net_out: 'Outbound', mon_realtime_hosts: 'Host Realtime Load', mon_no_alerts: 'No active alerts',
    rule_create_title: 'New Alert Rule', rule_edit_title: 'Edit Alert Rule', rule_metric_ph: 'e.g. host.cpu_usage',
    rule_cond_ph: 'e.g. > 90% for 5 min', rule_del_confirm: 'Delete alert rule "{name}"?',
    rule_op_edit: 'Edit', rule_op_del: 'Delete', rule_op_toggle: 'Enable / Disable',

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
    // ===== Host Management v2.0 (en) =====
    nav_mod_hosts: 'Host Management', nav_hosts_list: 'Host List', nav_hosts_detail: 'Hosts / Network',
    host_search_ph: 'Search hostname / IP / cluster', host_filter_all: 'All Status',
    host_st_online: 'Connected', host_st_maint: 'Maintenance', host_st_offline: 'Disconnected',
    hctx_group_power: 'Power (IPMI/BMC)', hctx_group_maint: 'Maintenance', hctx_group_config: 'Network & Config',
    hctx_power_on: 'Power On', hctx_reboot: 'Reboot Host', hctx_shutdown: 'Shut Down',
    hctx_enter_maint: 'Enter Maintenance Mode', hctx_exit_maint: 'Exit Maintenance Mode',
    hctx_edit_network: 'Edit Management Network', hctx_open_detail: 'Host Details', hctx_remove: 'Remove from Cluster',
    ctx_more_actions: 'More actions (right-click)',
    dctx_group_create: 'Create', dctx_group_config: 'Configure', dctx_group_danger: 'Danger Zone',
    dctx_new_cluster: 'New Cluster Here', dctx_add_host: 'Onboard Host Here',
    dctx_edit: 'Edit Datacenter', dctx_open_detail: 'View in Topology', dctx_delete: 'Delete Datacenter',
    dctx_delete_blocked: 'This datacenter still has clusters; remove all child clusters first',
    cctx_group_manage: 'Host Management', cctx_group_config: 'Configure', cctx_group_danger: 'Danger Zone',
    cctx_add_host: 'Onboard Host to Cluster', cctx_view_hosts: 'View Cluster Hosts',
    cctx_edit: 'Edit Cluster', cctx_open_detail: 'View in Topology', cctx_delete: 'Delete Cluster',
    cctx_delete_blocked: 'This cluster still has hosts; remove all hosts first',
    hctx_maint_block_title: 'Cannot Enter Maintenance Mode',
    hctx_maint_block_msg: '{n} VM(s) are running on this host. They must be fully migrated to other hosts before maintenance mode can be entered.',
    hctx_maint_migrate_now: 'Go to Migration',
    hctx_exit_ok: 'Exited maintenance mode; host resumed scheduling',
    hctx_enter_ok: 'Entered maintenance mode',
    hctx_poweron_ok: 'Power-on command issued (IPMI/BMC)',
    hctx_reboot_ok: 'Reboot command issued',
    hctx_shutdown_confirm: 'Shut down host {name}? Its VMs will stop accordingly.',
    hctx_shutdown_ok: 'Shutdown command issued',
    host_enter_maint: 'Enter Maintenance', host_exit_maint: 'Exit Maintenance', host_back: 'Back to List',
    host_pick_hint: 'Select a host to view its overview / hardware / HA status / VMs.', host_view_detail: 'View Details',
    hmn_title: 'Hosts / Management Network', hmn_intro: 'View and configure host management networks (IP / netmask / gateway / mgmt VLAN / uplink NIC), grouped by cluster.',
    hmn_col_host: 'Host', hmn_col_status: 'Status', hmn_col_ip: 'Mgmt IP', hmn_col_netmask: 'Netmask', hmn_col_gateway: 'Gateway', hmn_col_vlan: 'Mgmt VLAN', hmn_col_nic: 'Uplink NIC', hmn_col_ops: 'Actions',
    hmn_cluster: 'Cluster', hmn_hosts_n: 'hosts', hmn_batch: 'Bulk Edit Network', hmn_edit_host: 'Edit Network',
    hmn_edit_title: 'Edit Host Management Network', hmn_batch_title: 'Bulk Edit Cluster Management Network',
    hmn_batch_hint: 'Only filled fields are applied; blank means unchanged. Each host keeps its own Mgmt IP (IP is unique, never bulk-overwritten).',
    hmn_keep: '(blank = unchanged)', hmn_no_hosts: 'No hosts in this cluster',
    hmn_ip_invalid: 'Invalid management IP', hmn_netmask_invalid: 'Invalid netmask', hmn_gateway_invalid: 'Invalid gateway', hmn_vlan_invalid: 'Mgmt VLAN must be 0~4094', hmn_ip_conflict: 'This management IP is already in use',
    host_maint_blocked: 'Cannot enter maintenance — host still has running VMs. Migrate or stop them first.',
    host_tab_overview: 'Overview', host_tab_hardware: 'Hardware', host_tab_ha: 'HA Status', host_tab_monitor: 'Monitoring', host_tab_vms: 'Virtual Machines',
    host_threads: 'Threads', host_sockets: 'Sockets', host_no_vms: 'No virtual machines on this host', host_perf_trend: 'Performance Trend (last hour)',
    hw_cpu_topo: 'CPU Topology', hw_model: 'Model', hw_vendor: 'Vendor', hw_sockets: 'Sockets', hw_cores_socket: 'Cores / Socket',
    hw_threads_total: 'Total Threads', hw_freq: 'Frequency', hw_virt_feat: 'Virtualization Features',
    hw_nics: 'Network Interfaces', hw_nic_name: 'Name', hw_type: 'Type', hw_vendor_model: 'Vendor / Model', hw_speed: 'Speed', hw_link: 'Link', hw_traffic: 'Traffic (Rx/Tx)',
    hw_storage_dev: 'Storage Devices', hw_dev_name: 'Device', hw_capacity: 'Capacity', hw_interface: 'Interface', hw_rpm: 'RPM', hw_temp: 'Temp', hw_usage: 'Usage',
    hw_pci_dev: 'PCI Devices', hw_dev_class: 'Class', hw_driver: 'Driver', hw_passthrough: 'Passthrough',
    hw_mgmt_net: 'Management Network', hw_mgmt_edit: 'Edit',
    hw_iommu_title: 'IOMMU / VFIO Passthrough Readiness', hw_iommu_on: 'Enabled', hw_iommu_off: 'Disabled',
    hw_iommu_intro: 'Required before passing GPU / NIC PCI devices through to VMs (prerequisite for selecting a GPU when creating a VM).',
    hw_iommu_enable: 'Enable IOMMU/VFIO', hw_iommu_disable: 'Disable IOMMU/VFIO',
    hw_iommu_count: '{cap} passthrough-capable · {bound} bound',
    hw_iommu_need_first: 'Enable host IOMMU/VFIO first', hw_iommu_reboot_hint: 'Kernel boot parameters changed; a host reboot is required to take effect.',
    hw_gpu_title: 'GPU Management', hw_gpu_assigned: 'Assigned', hw_gpu_free: 'Free',
    hw_gpu_owner: 'Owner VM', hw_gpu_idle_desc: 'Idle, available to assign to a VM',
    hw_gpu_passthrough: 'PCI Passthrough', hw_gpu_vgpu: 'vGPU Slicing',
    hw_gpu_release: 'Release', hw_gpu_set_pt: 'Set Passthrough', hw_gpu_set_vgpu: 'Set vGPU',
    hw_pt_status: 'Passthrough', hw_pt_in_use: 'In Use', hw_pt_bound: 'Bound (vfio)', hw_pt_host: 'Host', hw_pt_na: 'N/A',
    hw_pt_bind: 'Bind', hw_pt_unbind: 'Unbind', hw_pt_locked: 'Held by VM',
    ha_health_score: 'HA Health Score', ha_last_check: 'Last check', ha_interval: 'Check interval', ha_enabled_on: 'HA Enabled', ha_enabled_off: 'HA Disabled',
    ha_check_network_heartbeat: 'Network Heartbeat', ha_check_storage_heartbeat: 'Storage Heartbeat', ha_check_libvirt_service: 'Virtualization Service', ha_check_resource_availability: 'Resource Availability', ha_check_fencing_capability: 'Fencing (STONITH)', ha_check_time_sync: 'Time Sync (NTP)',
    ha_resp: 'Response', ha_loss: 'Packet Loss', ha_fails: 'Consec. Failures', ha_lat: 'Latency', ha_lock: 'Lock File', ha_failover_cap: 'Failover Capacity', ha_fence_agent: 'Fence Agent',
    ha_clock_offset: 'Clock Offset', ha_offset_thresh: 'Offset Threshold', ha_ntp_server: 'Internal NTP Server', ha_ntp_source: 'NTP Source',
    ha_events: 'Recent HA Events', ha_affected: 'Affected VMs', ha_no_events: 'No recent HA events',
    ha_overall_healthy: 'Healthy', ha_overall_degraded: 'Degraded', ha_overall_failed: 'Failed',
  },
}

// ============================ 响应式状态 ============================
const saved = localStorage.getItem('cnf_locale')
const locale = ref(saved === 'en' ? 'en' : 'zh')

// 翻译函数：t('key') 返回当前语言文案，缺失回退到 key
function t(key, params) {
  const table = dict[locale.value] || dict.zh
  let s = table[key] !== undefined ? table[key] : (dict.zh[key] !== undefined ? dict.zh[key] : key)
  // 支持 {name} 占位符插值
  if (params && typeof s === 'string') {
    s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? params[k] : m))
  }
  return s
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

// ---- 全局时间格式化：一律采用浏览器本地时区 ----
// 入参可为 ISO 字符串 / 时间戳 / 'YYYY-MM-DD HH:mm'，输出本地化字符串。
window.cnfFmtTime = function (input, opts) {
  if (input === undefined || input === null || input === '' || input === '—' || input === '-') return '—'
  let d
  if (typeof input === 'number') d = new Date(input)
  else if (/^\d{4}-\d{2}-\d{2}[ T]/.test(String(input))) d = new Date(String(input).replace(' ', 'T'))
  else d = new Date(input)
  if (isNaN(d.getTime())) return String(input)
  const loc = (window.i18n && window.i18n.locale) === 'en' ? 'en-US' : 'zh-CN'
  const mode = (opts && opts.mode) || 'datetime'
  if (mode === 'date') return d.toLocaleDateString(loc)
  if (mode === 'time') return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (mode === 'relative') {
    const diff = (Date.now() - d.getTime()) / 1000
    const isEn = loc === 'en-US'
    if (diff < 60) return isEn ? 'just now' : '刚刚'
    if (diff < 3600) return Math.floor(diff / 60) + (isEn ? ' min ago' : ' 分钟前')
    if (diff < 86400) return Math.floor(diff / 3600) + (isEn ? ' h ago' : ' 小时前')
    return Math.floor(diff / 86400) + (isEn ? ' d ago' : ' 天前')
  }
  return d.toLocaleString(loc, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
// 当前本地时间（响应式时钟用）
window.cnfNow = () => new Date()
window.cnfTheme = reactive({ theme })
window.setTheme = setTheme
window.THEMES = ['light', 'dim', 'dark']
window.LOCALES = ['zh', 'en']
})()
