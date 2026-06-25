// =============================================================================
//  模块视图：基础设施 (view-infrastructure.js) — Cloud Nexus Forging v2.0
//  子标签：datacenter 数据中心（资源拓扑树 + DC 统计卡）/ clusters 集群管理
//          / hosts 主机节点 / pools 资源池。
//
//  ★ 完整层级血缘（数据中心 → 集群 → 宿主机 → 虚拟机）：
//    · 所有数据来自统一 store（window.cnfTopology），聚合统计实时一致
//    · datacenter 页：左侧资源拓扑树 + 右侧 DC 统计卡（集群数/主机数/VM数）
//    · clusters 页：显示所属数据中心 + 主机数/VM数 + 「添加主机」+ 删除级联校验
//    · hosts 页：显示所属集群/数据中心 + 真实硬件型号 + 该主机运行的 VM 列表 + 移除校验
//    · 删除前级联校验（删 DC 查集群 / 删集群查主机 / 移除主机查运行 VM）
// =============================================================================
(function () {
const { ref, computed, onMounted, watch } = Vue
const t = window.t
const store = window.cnfTopology
const toast = window.cnfToast

const InfrastructureView = {
  components: { TopologyTree: window.__CNF_VIEWS.TopologyTree },
  props: { tab: { type: String, default: 'datacenter' }, focus: { type: Object, default: null } },
  setup(props) {
    const pools = ref([])

    // ---- 聚合数据（来自统一 store）----
    const datacenters = computed(() => store.datacenterStats.value)
    const clusters = computed(() => store.clusterStats.value)
    const hosts = computed(() => store.hostStats.value)

    // ---- P2：全局 KPI 汇总条（数据中心页顶部，给出大盘视图）----
    const infraSummary = computed(() => {
      const dcs = datacenters.value
      const cls = clusters.value
      const hs = hosts.value
      const hostOnline = hs.filter((h) => h.status === 'connected').length
      const vmCount = hs.reduce((s, h) => s + (h.vm_count || 0), 0)
      const vmRunning = hs.reduce((s, h) => s + (h.vm_running || 0), 0)
      return {
        dc: dcs.length, cluster: cls.length,
        host: hs.length, hostOnline,
        vm: vmCount, vmRunning,
        hostRate: hs.length ? Math.round((hostOnline / hs.length) * 100) : 0,
        vmRate: vmCount ? Math.round((vmRunning / vmCount) * 100) : 0,
      }
    })
    // 每个 DC 的健康率（主机在线占比），用于卡片右上角徽标
    const dcHealth = (dc) => (dc.host_count ? Math.round((dc.host_online / dc.host_count) * 100) : 0)

    // ---- 主机详情展开（显示该主机上运行的 VM 列表）----
    const expandedHost = ref(null)
    const toggleHost = (id) => { expandedHost.value = expandedHost.value === id ? null : id }

    // ---- 删除级联校验对话框 ----
    const blockDlg = ref({ open: false, title: '', message: '', children: [] })
    const showBlocked = (title, message, children) => { blockDlg.value = { open: true, title, message, children: children || [] } }

    // ============================================================
    //  数据中心：创建 / 编辑对话框
    // ============================================================
    const dcDlg = ref({ open: false, mode: 'create', id: null, form: {}, err: {}, saving: false })
    const openDcCreate = () => { dcDlg.value = { open: true, mode: 'create', id: null, form: { name: '', location: '', timezone: 'Asia/Shanghai', description: '' }, err: {}, saving: false } }
    const openDcEdit = (dc) => { dcDlg.value = { open: true, mode: 'edit', id: dc.id, form: { name: dc.name, location: dc.location || '', timezone: dc.timezone || 'Asia/Shanghai', description: dc.description || '' }, err: {}, saving: false } }
    const saveDc = async () => {
      const f = dcDlg.value.form; const err = {}
      if (!f.name || !f.name.trim()) err.name = t('op_required')
      dcDlg.value.err = err
      if (Object.keys(err).length) return
      dcDlg.value.saving = true
      const res = dcDlg.value.mode === 'create'
        ? await store.createDatacenter(f)
        : await store.updateDatacenter(dcDlg.value.id, f)
      dcDlg.value.saving = false
      if (!res.ok) {
        if (res.code === 'NAME_DUPLICATE') { dcDlg.value.err = { name: res.error }; return }
        return toast(res.error || t('op_failed'), 'error')
      }
      toast(dcDlg.value.mode === 'create' ? t('toast_created') : t('toast_saved'), 'success')
      dcDlg.value.open = false
    }

    // ============================================================
    //  集群：创建 / 编辑对话框
    // ============================================================
    const clDlg = ref({ open: false, mode: 'create', id: null, form: {}, err: {}, saving: false })
    const openClCreate = () => { clDlg.value = { open: true, mode: 'create', id: null, form: { name: '', datacenter_id: (datacenters.value[0] && datacenters.value[0].id) || '', description: '', ha_enabled: true, drs_enabled: false, overcommit_cpu: 4.0, ntp_mode: 'internal', ntp_internal_server: '', ntp_servers: 'pool.ntp.org, ntp.aliyun.com', max_clock_offset_ms: 100 }, err: {}, saving: false } }
    const openClEdit = (cl) => { clDlg.value = { open: true, mode: 'edit', id: cl.id, form: { name: cl.name, datacenter_id: cl.datacenter_id, description: cl.description || '', ha_enabled: cl.ha_enabled, drs_enabled: cl.drs_enabled, overcommit_cpu: cl.overcommit_cpu, ntp_mode: cl.ntp_mode || 'internal', ntp_internal_server: cl.ntp_internal_server || '', ntp_servers: Array.isArray(cl.ntp_servers) ? cl.ntp_servers.join(', ') : (cl.ntp_servers || ''), max_clock_offset_ms: cl.max_clock_offset_ms || 100 }, err: {}, saving: false } }
    // 内部 NTP 源候选：当前编辑集群下的主机（创建时尚无主机，下拉为空，提示纳管后再指定）
    const clNtpHosts = computed(() => clDlg.value.id ? hosts.value.filter((h) => h.cluster_id === clDlg.value.id) : [])
    const saveCl = async () => {
      const f = clDlg.value.form; const err = {}
      if (!f.name || !f.name.trim()) err.name = t('op_required')
      if (!f.datacenter_id) err.datacenter_id = t('op_required')
      clDlg.value.err = err
      if (Object.keys(err).length) return
      clDlg.value.saving = true
      const res = clDlg.value.mode === 'create'
        ? await store.createCluster(f)
        : await store.updateCluster(clDlg.value.id, f)
      clDlg.value.saving = false
      if (!res.ok) {
        if (res.code === 'NAME_DUPLICATE') { clDlg.value.err = { name: res.error }; return }
        return toast(res.error || t('op_failed'), 'error')
      }
      toast(clDlg.value.mode === 'create' ? t('toast_created') : t('toast_saved'), 'success')
      clDlg.value.open = false
    }

    // ---- 添加主机向导（通过全局事件打开，可携带预设集群）----
    const addHost = (presetClusterId) => {
      window.dispatchEvent(new CustomEvent('cnf:open-host-wizard', { detail: { presetClusterId: presetClusterId || 0 } }))
    }

    // ============================================================
    //  资源池：创建 / 编辑 / 删除对话框（N2 修复死按钮 — 完整 CRUD）
    //  对标 VMware 资源池：份额(shares) + CPU/内存上限(limit) + 预留(reservation)
    // ============================================================
    const poolDlg = ref({ open: false, mode: 'create', id: null, form: {}, err: {}, saving: false })
    const reloadPools = async () => { pools.value = await window.api('/resource-pools') }
    const openPoolCreate = () => {
      poolDlg.value = {
        open: true, mode: 'create', id: null,
        form: { name: '', cluster_id: (clusters.value[0] && clusters.value[0].id) || '', cpu_shares: 'normal', cpu_limit_vcpu: 64, cpu_reserved_vcpu: 0, mem_limit_gb: 128, mem_reserved_gb: 0 },
        err: {}, saving: false,
      }
    }
    const openPoolEdit = (p) => {
      poolDlg.value = {
        open: true, mode: 'edit', id: p.id,
        form: { name: p.name, cluster_id: p.cluster_id, cpu_shares: p.cpu_shares, cpu_limit_vcpu: p.cpu_limit_vcpu, cpu_reserved_vcpu: p.cpu_reserved_vcpu, mem_limit_gb: p.mem_limit_gb, mem_reserved_gb: p.mem_reserved_gb },
        err: {}, saving: false,
      }
    }
    const savePool = async () => {
      const f = poolDlg.value.form; const err = {}
      if (!f.name || !f.name.trim()) err.name = t('op_required')
      if (!f.cluster_id) err.cluster_id = t('op_required')
      if (Number(f.cpu_reserved_vcpu) > Number(f.cpu_limit_vcpu)) err.cpu_reserved_vcpu = t('pool_err_cpu_reserve')
      if (Number(f.mem_reserved_gb) > Number(f.mem_limit_gb)) err.mem_reserved_gb = t('pool_err_mem_reserve')
      poolDlg.value.err = err
      if (Object.keys(err).length) return
      poolDlg.value.saving = true
      const path = poolDlg.value.mode === 'create' ? '/resource-pools' : '/resource-pools/' + poolDlg.value.id
      const res = await window.api(path, { method: poolDlg.value.mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      poolDlg.value.saving = false
      if (!res.ok) {
        if (res.code === 'NAME_DUPLICATE') { poolDlg.value.err = { name: res.error }; return }
        return toast(res.error || t('op_failed'), 'error')
      }
      toast(poolDlg.value.mode === 'create' ? t('toast_created') : t('toast_saved'), 'success')
      poolDlg.value.open = false
      await reloadPools()
    }
    const delPool = async (p) => {
      const res = await window.api('/resource-pools/' + p.id, { method: 'DELETE' })
      if (!res.ok) return showBlocked(t('del_blocked_title'), res.error, res.children)
      toast(t('toast_success'), 'success')
      await reloadPools()
    }
    const poolClusterName = (cid) => { const c = clusters.value.find((x) => x.id === cid); return c ? c.name : '—' }

    // ---- 删除数据中心（级联校验）----
    const delDatacenter = async (dc) => {
      const res = await store.deleteDatacenter(dc.id)
      if (!res.ok) return showBlocked(t('del_blocked_title'), res.error, res.children)
      toast(t('toast_success'), 'success')
    }
    // ---- 删除集群（级联校验）----
    const delCluster = async (cl) => {
      const res = await store.deleteCluster(cl.id)
      if (!res.ok) return showBlocked(t('del_blocked_title'), res.error, res.children)
      toast(t('toast_success'), 'success')
    }
    // ---- 移除主机（级联校验）----
    const delHost = async (h) => {
      const res = await store.removeHost(h.id)
      if (!res.ok) return showBlocked(t('del_blocked_title'), res.error, res.children)
      toast(t('toast_success'), 'success')
    }

    const load = async () => {
      await store.fetchAll()
      if (props.tab === 'pools' && !pools.value.length) pools.value = await window.api('/resource-pools')
    }
    onMounted(load)
    watch(() => props.tab, load)

    // ---- 跨视图聚焦高亮（拓扑树点击跳转时定位目标行）----
    const focusId = ref(null)
    const focusType = ref(null)
    watch(() => props.focus, (f) => {
      if (!f) return
      focusType.value = f.focusType; focusId.value = f.focusId
      if (f.focusType === 'host') expandedHost.value = f.focusId
      setTimeout(() => { focusId.value = null }, 2400)
    }, { immediate: true })

    const sharesLabel = (s) => ({ high: t('shares_high'), normal: t('shares_normal'), low: t('shares_low') }[s] || s)

    return {
      props, pools, datacenters, clusters, hosts,
      infraSummary, dcHealth,
      expandedHost, toggleHost, blockDlg, addHost,
      delDatacenter, delCluster, delHost,
      dcDlg, openDcCreate, openDcEdit, saveDc,
      clDlg, openClCreate, openClEdit, saveCl, clNtpHosts,
      poolDlg, openPoolCreate, openPoolEdit, savePool, delPool, poolClusterName,
      focusId, focusType, sharesLabel, t,
    }
  },
  template: `
    <div>
      <!-- ===== datacenter：KPI 汇总条 + 资源拓扑树 + DC 卡片（P2 专业化 / P3 添加主机）===== -->
      <template v-if="props.tab==='datacenter'">
        <!-- P2：顶部全局 KPI 汇总条（vCenter/CloudTower 风格大盘）-->
        <div class="infra-kpi-bar">
          <div class="infra-kpi"><div class="ik-ico" style="background:rgba(0,122,255,.12);color:var(--color-blue)"><i class="fas fa-building"></i></div><div><div class="ik-num">{{ infraSummary.dc }}</div><div class="ik-lbl">{{ t('nav_infra_datacenter') }}</div></div></div>
          <div class="infra-kpi"><div class="ik-ico" style="background:rgba(88,86,214,.12);color:var(--color-indigo)"><i class="fas fa-layer-group"></i></div><div><div class="ik-num">{{ infraSummary.cluster }}</div><div class="ik-lbl">{{ t('nav_infra_clusters') }}</div></div></div>
          <div class="infra-kpi"><div class="ik-ico" style="background:rgba(255,149,0,.12);color:var(--color-orange)"><i class="fas fa-server"></i></div><div><div class="ik-num">{{ infraSummary.hostOnline }}<span class="ik-sub">/{{ infraSummary.host }}</span></div><div class="ik-lbl">{{ t('host_machine') }} · {{ t('dash_online') }} {{ infraSummary.hostRate }}%</div></div></div>
          <div class="infra-kpi"><div class="ik-ico" style="background:rgba(52,199,89,.12);color:var(--color-green)"><i class="fas fa-desktop"></i></div><div><div class="ik-num">{{ infraSummary.vmRunning }}<span class="ik-sub">/{{ infraSummary.vm }}</span></div><div class="ik-lbl">{{ t('dash_vms') }} · {{ t('dash_running') }} {{ infraSummary.vmRate }}%</div></div></div>
        </div>
        <div class="crud-toolbar">
          <button class="apple-btn apple-btn--primary" @click="openDcCreate"><i class="fas fa-plus"></i> {{ t('dc_create') }}</button>
          <button class="apple-btn apple-btn--secondary" @click="addHost(0)"><i class="fas fa-server"></i> {{ t('hw_add_host') }}</button>
          <div class="spacer"></div>
          <span class="muted" style="font-size:13px"><i class="fas fa-info-circle"></i> {{ t('topo_full_hint') }}</span>
        </div>
        <div class="infra-topo-layout">
          <!-- 左：资源拓扑树 -->
          <TopologyTree />
          <!-- 右：数据中心卡片（清晰分层 + 容量进度条 + 行内添加主机）-->
          <div class="infra-topo-right">
            <div class="grid grid-1" style="gap:14px">
              <div class="apple-card dc-card2" v-for="dc in datacenters" :key="dc.id"
                   :class="{focused: focusType==='datacenter' && focusId===dc.id}">
                <div class="dc2-head">
                  <div class="dc2-title">
                    <span class="dc2-ico"><i class="fas fa-building"></i></span>
                    <div>
                      <div class="dc2-name">{{ dc.name }}</div>
                      <div class="muted" style="font-size:12px"><i class="fas fa-location-dot"></i> {{ dc.location || '—' }}<template v-if="dc.description"> · {{ dc.description }}</template></div>
                    </div>
                  </div>
                  <div class="dc2-actions">
                    <span class="health-pill" :class="dcHealth(dc)>=100?'ok':(dcHealth(dc)>=60?'warn':'bad')" :title="t('host_conn_rate_tip')"><span class="dot"></span>{{ dcHealth(dc) }}% {{ t('host_conn_rate') }}</span>
                    <button class="icon-btn" :title="t('hw_add_host')" @click="addHost(0)"><i class="fas fa-server"></i></button>
                    <button class="icon-btn" :title="t('op_edit')" @click="openDcEdit(dc)"><i class="fas fa-pen"></i></button>
                    <button class="icon-btn danger" :title="t('op_delete')" @click="delDatacenter(dc)"><i class="fas fa-trash"></i></button>
                  </div>
                </div>
                <div class="dc2-metrics">
                  <div class="dc2-metric"><div class="m-k"><i class="fas fa-layer-group" style="color:var(--color-indigo)"></i> {{ t('nav_infra_clusters') }}</div><div class="m-v">{{ dc.cluster_count }}</div></div>
                  <div class="dc2-metric"><div class="m-k"><i class="fas fa-server" style="color:var(--color-orange)"></i> {{ t('host_machine') }}</div><div class="m-v">{{ dc.host_online }}<span class="muted" style="font-size:14px">/{{ dc.host_count }}</span></div></div>
                  <div class="dc2-metric"><div class="m-k"><i class="fas fa-desktop" style="color:var(--color-green)"></i> {{ t('dash_vms') }}</div><div class="m-v">{{ dc.vm_running }}<span class="muted" style="font-size:14px">/{{ dc.vm_count }}</span></div></div>
                </div>
                <div class="dc2-bar">
                  <div class="flex between" style="font-size:12px;margin-bottom:4px"><span class="muted" :title="t('host_conn_rate_tip')">{{ t('host_conn_rate') }}</span><span class="mono">{{ dcHealth(dc) }}%</span></div>
                  <div class="usage-bar"><div class="fill" :style="{width:dcHealth(dc)+'%',background:dcHealth(dc)>=100?'var(--color-green)':(dcHealth(dc)>=60?'var(--color-orange)':'var(--color-red)')}"></div></div>
                </div>
              </div>
              <div v-if="!datacenters.length" class="apple-card" style="text-align:center;padding:40px"><i class="fas fa-inbox" style="font-size:32px;color:var(--text-tertiary)"></i><div class="muted" style="margin-top:10px">{{ t('op_no_data') }}</div></div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== clusters：集群管理（显示所属数据中心 + 聚合统计 + 添加主机/删除校验）===== -->
      <template v-else-if="props.tab==='clusters'">
        <div class="crud-toolbar">
          <button class="apple-btn apple-btn--primary" @click="openClCreate"><i class="fas fa-plus"></i> {{ t('cl_create') }}</button>
          <div class="spacer"></div>
          <span class="muted" style="font-size:13px">{{ clusters.length }} {{ t('nav_infra_clusters') }}</span>
        </div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr>
              <th>{{ t('name') }}</th><th>{{ t('host_dc') }}</th><th>HA</th><th>{{ t('nav_drs') }}</th><th>CPU{{ t('cc_cpu_over') }}</th>
              <th>{{ t('host_machine') }}</th><th>{{ t('dash_vms') }}</th><th style="width:120px">{{ t('op_actions') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="c in clusters" :key="c.id" :class="{focused: focusType==='cluster' && focusId===c.id}">
                <td><strong>{{ c.name }}</strong><div class="muted" style="font-size:12px">{{ c.description }}</div></td>
                <td><span class="apple-badge"><i class="fas fa-building"></i> {{ c.datacenter_name }}</span></td>
                <td><i :class="c.ha_enabled?'fas fa-circle-check':'far fa-circle'" :style="{color:c.ha_enabled?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
                <td><i :class="c.drs_enabled?'fas fa-circle-check':'far fa-circle'" :style="{color:c.drs_enabled?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
                <td class="mono">{{ c.overcommit_cpu }}×</td>
                <td><strong>{{ c.host_online }}</strong><span class="muted">/{{ c.host_count }}</span></td>
                <td><strong>{{ c.vm_running }}</strong><span class="muted">/{{ c.vm_count }}</span></td>
                <td>
                  <button class="icon-btn" :title="t('hw_add_host')" @click="addHost(c.id)"><i class="fas fa-plus"></i></button>
                  <button class="icon-btn" :title="t('op_edit')" @click="openClEdit(c)"><i class="fas fa-pen"></i></button>
                  <button class="icon-btn danger" :title="t('op_delete')" @click="delCluster(c)"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== hosts：主机节点（所属集群/DC + 真实硬件 + 运行VM列表 + 移除校验）===== -->
      <template v-else-if="props.tab==='hosts'">
        <div class="crud-toolbar">
          <button class="apple-btn apple-btn--primary" @click="addHost(0)"><i class="fas fa-plus"></i> {{ t('hw_add_host') }}</button>
          <div class="spacer"></div>
          <span class="muted" style="font-size:13px">{{ hosts.length }} {{ t('host_machine') }}</span>
        </div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr>
              <th style="width:34px"></th><th>{{ t('name') }}</th><th>{{ t('host_cluster') }}</th><th>{{ t('status') }}</th>
              <th>IP</th><th>CPU</th><th>{{ t('col_mem') }}</th><th>{{ t('dash_vms') }}</th><th>GPU</th><th>{{ t('col_load') }}</th><th style="width:54px"></th>
            </tr></thead>
            <tbody>
              <template v-for="h in hosts" :key="h.id">
                <tr class="host-row" :class="{focused: focusType==='host' && focusId===h.id}" @click="toggleHost(h.id)">
                  <td><i class="fas fa-chevron-right chevron" :class="{open:expandedHost===h.id}"></i></td>
                  <td><strong>{{ h.name }}</strong><div class="muted" style="font-size:12px">{{ h.cpu_model }}</div></td>
                  <td>
                    <div><span class="apple-badge"><i class="fas fa-layer-group"></i> {{ h.cluster_name }}</span></div>
                    <div class="muted" style="font-size:11px;margin-top:2px"><i class="fas fa-building"></i> {{ h.datacenter_name }}</div>
                  </td>
                  <td><span class="apple-badge" :class="h.status==='connected'?'apple-badge--running':'apple-badge--warning'"><span class="dot"></span>{{ h.status==='connected'?t('dash_connected'):(h.status==='connecting'?'纳管中':'维护') }}</span></td>
                  <td class="mono muted">{{ h.ip }}</td>
                  <td class="mono">{{ h.sockets }}×{{ h.cores }}×{{ h.threads }} = {{ h.vcpus }}</td>
                  <td class="mono">{{ h.mem_used_gb }}/{{ h.mem_total_gb }} GB</td>
                  <td><strong>{{ h.vm_running }}</strong><span class="muted">/{{ h.vm_count }}</span></td>
                  <td>{{ h.gpus>0 ? h.gpus+' ×' : '—' }}</td>
                  <td style="width:90px"><div class="usage-bar"><div class="fill" :style="{width:h.cpu_usage+'%',background:h.cpu_usage>80?'var(--color-red)':'var(--color-blue)'}"></div></div></td>
                  <td><button class="icon-btn danger" :title="t('op_remove')" @click.stop="delHost(h)"><i class="fas fa-trash"></i></button></td>
                </tr>
                <!-- 展开：硬件详情 + 该主机运行的 VM 列表 -->
                <tr v-if="expandedHost===h.id" class="host-detail-row">
                  <td colspan="11">
                    <div class="host-detail">
                      <div class="host-hw">
                        <div class="hw-item"><span class="hw-k"><i class="fas fa-microchip"></i> CPU</span><span class="hw-v">{{ h.cpu_model }} · {{ h.sockets }}×{{ h.cores }}C/{{ h.threads }}T</span></div>
                        <div class="hw-item"><span class="hw-k"><i class="fas fa-ethernet"></i> {{ t('host_nic_model') }}</span><span class="hw-v">{{ h.nic_model }}</span></div>
                        <div class="hw-item"><span class="hw-k"><i class="fas fa-hard-drive"></i> {{ t('host_raid_model') }}</span><span class="hw-v">{{ h.raid_model }}</span></div>
                        <div class="hw-item"><span class="hw-k"><i class="fas fa-database"></i> {{ t('host_disk_model') }}</span><span class="hw-v">{{ h.disk_model }}</span></div>
                      </div>
                      <div class="host-vms">
                        <div class="host-vms-title"><i class="fas fa-desktop"></i> {{ t('host_vms_running') }}（{{ h.vm_running }}/{{ h.vm_count }}）</div>
                        <div v-if="h.vms_list.length" class="host-vm-chips">
                          <span class="host-vm-chip" v-for="v in h.vms_list" :key="v.id" :class="'st-'+v.status">
                            <span class="dot"></span>{{ v.name }} <span class="muted">· {{ v.vcpus }}vCPU/{{ v.mem_gb }}GB</span>
                          </span>
                        </div>
                        <div v-else class="muted" style="font-size:13px">{{ t('op_no_data') }}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== pools：资源池（N2 完整 CRUD — 对标 VMware 资源池）===== -->
      <template v-else>
        <div class="crud-toolbar">
          <button class="apple-btn apple-btn--primary" @click="openPoolCreate"><i class="fas fa-plus"></i> {{ t('pool_add') }}</button>
          <div class="spacer"></div>
          <span class="muted" style="font-size:13px">{{ pools.length }} {{ t('pool_title') }}</span>
        </div>
        <div class="grid grid-3">
          <div class="apple-card pool-card" v-for="p in pools" :key="p.id">
            <div class="flex between" style="margin-bottom:6px">
              <strong>{{ p.name }}</strong>
              <span class="apple-badge" :class="p.cpu_shares==='high'?'apple-badge--running':(p.cpu_shares==='low'?'apple-badge--stopped':'apple-badge--warning')"><span class="dot"></span>{{ sharesLabel(p.cpu_shares) }}</span>
            </div>
            <div class="muted" style="font-size:12px;margin-bottom:10px"><i class="fas fa-layer-group"></i> {{ p.cluster_name || poolClusterName(p.cluster_id) }}</div>
            <div class="gpu-stats">
              <div class="gpu-stat"><div class="k">{{ t('pool_cpu_limit') }}</div><div class="v">{{ p.cpu_limit_vcpu }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('pool_mem_limit') }}</div><div class="v">{{ p.mem_limit_gb }} GB</div></div>
              <div class="gpu-stat"><div class="k">{{ t('pool_cpu_reserved') }}</div><div class="v">{{ p.cpu_reserved_vcpu }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('pool_mem_reserved') }}</div><div class="v">{{ p.mem_reserved_gb }} GB</div></div>
              <div class="gpu-stat"><div class="k">{{ t('pool_vms') }}</div><div class="v">{{ p.vms }}</div></div>
            </div>
            <div class="pool-actions">
              <button class="apple-btn apple-btn--ghost apple-btn--sm" @click="openPoolEdit(p)"><i class="fas fa-pen"></i> {{ t('op_edit') }}</button>
              <button class="apple-btn apple-btn--ghost apple-btn--sm danger" @click="delPool(p)"><i class="fas fa-trash"></i> {{ t('op_delete') }}</button>
            </div>
          </div>
          <div v-if="!pools.length" class="apple-card" style="text-align:center;padding:40px;grid-column:1/-1"><i class="fas fa-inbox" style="font-size:32px;color:var(--text-tertiary)"></i><div class="muted" style="margin-top:10px">{{ t('op_no_data') }}</div></div>
        </div>
      </template>

      <!-- ===== 数据中心 创建/编辑 对话框 ===== -->
      <div v-if="dcDlg.open" class="modal-mask" @click.self="dcDlg.open=false">
        <div class="modal-dialog">
          <div class="modal-head"><i class="fas fa-building" style="color:var(--color-blue)"></i> {{ dcDlg.mode==='create' ? t('dc_create') : t('dc_edit') }}</div>
          <div class="modal-body">
            <div class="form-row">
              <label class="req">{{ t('name') }}</label>
              <input :class="{invalid:dcDlg.err.name}" v-model="dcDlg.form.name" :placeholder="t('dc_name_ph')">
              <div v-if="dcDlg.err.name" class="form-err">{{ dcDlg.err.name }}</div>
            </div>
            <div class="form-grid-2">
              <div class="form-row"><label>{{ t('dc_location') }}</label><input  v-model="dcDlg.form.location" :placeholder="t('dc_location_ph')"></div>
              <div class="form-row"><label>{{ t('dc_timezone') }}</label>
                <select  v-model="dcDlg.form.timezone">
                  <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
                  <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
                  <option value="Europe/London">Europe/London (UTC+0)</option>
                  <option value="America/New_York">America/New_York (UTC-5)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
            </div>
            <div class="form-row"><label>{{ t('dc_desc') }}</label><textarea  rows="2" v-model="dcDlg.form.description" :placeholder="t('dc_desc_ph')"></textarea></div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--ghost" @click="dcDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="dcDlg.saving" @click="saveDc"><i v-if="dcDlg.saving" class="fas fa-spinner fa-spin"></i> {{ t('op_confirm') }}</button>
          </div>
        </div>
      </div>

      <!-- ===== 资源池 创建/编辑 对话框（N2）===== -->
      <div v-if="poolDlg.open" class="modal-mask" @click.self="poolDlg.open=false">
        <div class="modal-dialog">
          <div class="modal-head"><i class="fas fa-cubes" style="color:var(--color-purple,#af52de)"></i> {{ poolDlg.mode==='create' ? t('pool_create') : t('pool_edit') }}</div>
          <div class="modal-body">
            <div class="form-grid-2">
              <div class="form-row">
                <label class="req">{{ t('name') }}</label>
                <input :class="{invalid:poolDlg.err.name}" v-model="poolDlg.form.name" :placeholder="t('pool_name_ph')">
                <div v-if="poolDlg.err.name" class="form-err">{{ poolDlg.err.name }}</div>
              </div>
              <div class="form-row">
                <label class="req">{{ t('host_cluster') }}</label>
                <select :class="{invalid:poolDlg.err.cluster_id}" v-model="poolDlg.form.cluster_id">
                  <option v-for="c in clusters" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
                <div v-if="poolDlg.err.cluster_id" class="form-err">{{ poolDlg.err.cluster_id }}</div>
              </div>
            </div>
            <div class="form-row">
              <label>{{ t('pool_shares') }} <span class="muted" style="font-weight:400;font-size:12px">{{ t('pool_shares_hint') }}</span></label>
              <select v-model="poolDlg.form.cpu_shares">
                <option value="high">{{ t('shares_high') }} — {{ t('pool_shares_high_d') }}</option>
                <option value="normal">{{ t('shares_normal') }} — {{ t('pool_shares_normal_d') }}</option>
                <option value="low">{{ t('shares_low') }} — {{ t('pool_shares_low_d') }}</option>
              </select>
            </div>
            <div class="ntp-fieldset">
              <div class="ntp-legend"><i class="fas fa-microchip"></i> {{ t('pool_cpu_alloc') }}</div>
              <div class="form-grid-2">
                <div class="form-row"><label>{{ t('pool_cpu_limit') }} (vCPU)</label><input type="number" min="0" v-model.number="poolDlg.form.cpu_limit_vcpu"></div>
                <div class="form-row"><label>{{ t('pool_cpu_reserved') }} (vCPU)</label><input :class="{invalid:poolDlg.err.cpu_reserved_vcpu}" type="number" min="0" v-model.number="poolDlg.form.cpu_reserved_vcpu"><div v-if="poolDlg.err.cpu_reserved_vcpu" class="form-err">{{ poolDlg.err.cpu_reserved_vcpu }}</div></div>
              </div>
            </div>
            <div class="ntp-fieldset">
              <div class="ntp-legend"><i class="fas fa-memory"></i> {{ t('pool_mem_alloc') }}</div>
              <div class="form-grid-2">
                <div class="form-row"><label>{{ t('pool_mem_limit') }} (GB)</label><input type="number" min="0" v-model.number="poolDlg.form.mem_limit_gb"></div>
                <div class="form-row"><label>{{ t('pool_mem_reserved') }} (GB)</label><input :class="{invalid:poolDlg.err.mem_reserved_gb}" type="number" min="0" v-model.number="poolDlg.form.mem_reserved_gb"><div v-if="poolDlg.err.mem_reserved_gb" class="form-err">{{ poolDlg.err.mem_reserved_gb }}</div></div>
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--ghost" @click="poolDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="poolDlg.saving" @click="savePool"><i v-if="poolDlg.saving" class="fas fa-spinner fa-spin"></i> {{ t('op_confirm') }}</button>
          </div>
        </div>
      </div>

      <!-- ===== 集群 创建/编辑 对话框 ===== -->
      <div v-if="clDlg.open" class="modal-mask" @click.self="clDlg.open=false">
        <div class="modal-dialog">
          <div class="modal-head"><i class="fas fa-layer-group" style="color:var(--color-indigo)"></i> {{ clDlg.mode==='create' ? t('cl_create') : t('cl_edit') }}</div>
          <div class="modal-body">
            <div class="form-grid-2">
              <div class="form-row">
                <label class="req">{{ t('name') }}</label>
                <input :class="{invalid:clDlg.err.name}" v-model="clDlg.form.name" :placeholder="t('cl_name_ph')">
                <div v-if="clDlg.err.name" class="form-err">{{ clDlg.err.name }}</div>
              </div>
              <div class="form-row">
                <label class="req">{{ t('host_dc') }}</label>
                <select :class="{invalid:clDlg.err.datacenter_id}" v-model="clDlg.form.datacenter_id">
                  <option v-for="dc in datacenters" :key="dc.id" :value="dc.id">{{ dc.name }}</option>
                </select>
                <div v-if="clDlg.err.datacenter_id" class="form-err">{{ clDlg.err.datacenter_id }}</div>
              </div>
            </div>
            <div class="form-row"><label>{{ t('dc_desc') }}</label><input  v-model="clDlg.form.description" :placeholder="t('cl_desc_ph')"></div>
            <div class="form-grid-2">
              <div class="form-row"><label>CPU {{ t('cc_cpu_over') }}</label><input  type="number" step="0.5" min="1" v-model.number="clDlg.form.overcommit_cpu"></div>
              <div class="form-row" style="justify-content:flex-end">
                <label class="switch-row"><input type="checkbox" v-model="clDlg.form.ha_enabled"> {{ t('cl_ha') }}</label>
                <label class="switch-row"><input type="checkbox" v-model="clDlg.form.drs_enabled"> {{ t('nav_drs') }}</label>
              </div>
            </div>

            <!-- 时间同步（NTP）：HA 时间一致性基础，启用 HA 时强烈建议配置内部 NTP 源 -->
            <div class="ntp-fieldset" v-if="clDlg.form.ha_enabled">
              <div class="ntp-legend"><i class="fas fa-clock"></i> {{ t('cl_ntp_title') }}<span class="muted" style="font-weight:400;font-size:12px;margin-left:6px">{{ t('cl_ntp_hint') }}</span></div>
              <div class="form-grid-2">
                <div class="form-row">
                  <label>{{ t('cl_ntp_mode') }}</label>
                  <select v-model="clDlg.form.ntp_mode">
                    <option value="internal">{{ t('cl_ntp_internal') }}</option>
                    <option value="external">{{ t('cl_ntp_external') }}</option>
                  </select>
                </div>
                <div class="form-row">
                  <label>{{ t('cl_ntp_offset') }}</label>
                  <input type="number" min="10" max="5000" step="10" v-model.number="clDlg.form.max_clock_offset_ms" placeholder="100">
                </div>
              </div>
              <!-- 内部源：从本集群主机中指定一台作为 NTP 服务端 -->
              <div class="form-row" v-if="clDlg.form.ntp_mode==='internal'">
                <label>{{ t('cl_ntp_server') }}</label>
                <select v-model="clDlg.form.ntp_internal_server" v-if="clNtpHosts.length">
                  <option value="">{{ t('cl_ntp_auto') }}</option>
                  <option v-for="h in clNtpHosts" :key="h.id" :value="h.name">{{ h.name }} · {{ h.ip }}</option>
                </select>
                <div v-else class="hosts-pick-hint"><i class="fas fa-circle-info"></i> {{ t('cl_ntp_no_host') }}</div>
              </div>
              <!-- 外部源：填写外部 NTP 服务器列表 -->
              <div class="form-row" v-else>
                <label>{{ t('cl_ntp_servers') }}</label>
                <input v-model="clDlg.form.ntp_servers" placeholder="pool.ntp.org, ntp.aliyun.com">
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--ghost" @click="clDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="clDlg.saving" @click="saveCl"><i v-if="clDlg.saving" class="fas fa-spinner fa-spin"></i> {{ t('op_confirm') }}</button>
          </div>
        </div>
      </div>

      <!-- 级联删除阻止对话框 -->
      <div v-if="blockDlg.open" class="modal-mask" @click.self="blockDlg.open=false">
        <div class="modal-dialog modal-sm">
          <div class="modal-head"><i class="fas fa-ban" style="color:var(--color-red)"></i> {{ blockDlg.title }}</div>
          <div class="modal-body">
            <p>{{ blockDlg.message }}</p>
            <div v-if="blockDlg.children.length" class="block-children">
              <div class="muted" style="font-size:12px;margin-bottom:6px">{{ t('del_blocked_children') }}：</div>
              <span class="apple-badge" v-for="(ch,i) in blockDlg.children" :key="i" style="margin:2px">{{ ch }}</span>
            </div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--primary" @click="blockDlg.open=false">{{ t('close') }}</button>
          </div>
        </div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.InfrastructureView = InfrastructureView
})()
