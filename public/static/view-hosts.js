// =============================================================================
//  模块视图：主机管理 (view-hosts.js) — Cloud Nexus Forging v2.0
//  独立一级模块。子标签：
//    list      主机列表 —— 全集群主机卡片，实时 CPU/内存负载、维护模式切换
//    detail    主机管理 / 网络 —— 按集群分组的管理网络表（IP/掩码/网关/VLAN/网卡），
//              支持单台编辑与「集群级批量统一修改」；点击列表卡片则进入单台主机详情
//              （概览 / 硬件 / HA 状态 / 监控 / 虚拟机）。
//  数据：/hosts、/hosts/:id/hardware、/hosts/:id/ha-status、/hosts/:id/maintenance、
//        /hosts/:id/network(PUT)、/clusters/:id/host-network(PUT 批量)
//  时间统一走 window.cnfFmtTime（浏览器本地时区）。
// =============================================================================
(function () {
const { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue
const api = window.api
const t = window.t
const toast = window.cnfToast
const fmt = window.cnfFmtTime
const store = window.cnfTopology

const C = { blue: '#007AFF', green: '#34C759', orange: '#FF9500', red: '#FF3B30', indigo: '#5856D6', purple: '#AF52DE', teal: '#30B0C7', gray: '#8E8E93' }
const bytesRate = (n) => {
  if (!n) return '0 B/s'
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']; let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return v.toFixed(1) + ' ' + u[i]
}
const utilColor = (v) => (v > 85 ? C.red : v > 65 ? C.orange : C.green)

const HostsView = {
  components: { RingProgress: window.__CNF_VIEWS.RingProgress },
  props: { tab: { type: String, default: 'list' }, focus: { type: Object, default: null } },
  setup(props) {
    const hosts = computed(() => store.hostStats.value)
    const selectedId = ref(null)
    const detail = ref(null)        // hardware payload
    const ha = ref(null)            // ha-status payload
    const detailTab = ref('overview')
    const loading = ref(false)
    const search = ref('')
    const statusFilter = ref('')
    let charts = {}

    // ---- list filtering ----
    const filteredHosts = computed(() => {
      let list = hosts.value
      if (search.value.trim()) {
        const q = search.value.trim().toLowerCase()
        list = list.filter((h) => h.name.toLowerCase().includes(q) || (h.ip || '').includes(q) || (h.cluster_name || '').toLowerCase().includes(q))
      }
      if (statusFilter.value) list = list.filter((h) => h.status === statusFilter.value)
      return list
    })

    const statusMeta = (s) => ({
      connected: { cls: 'apple-badge--running', key: 'host_st_online' },
      maintenance: { cls: 'apple-badge--warning', key: 'host_st_maint' },
      disconnected: { cls: 'apple-badge--stopped', key: 'host_st_offline' },
    }[s] || { cls: 'apple-badge--stopped', key: 'host_st_offline' })

    // ---- open detail ----
    const openDetail = async (id) => {
      selectedId.value = id
      detailTab.value = 'overview'
      loading.value = true
      const [hw, h] = await Promise.all([api('/hosts/' + id + '/hardware'), api('/hosts/' + id + '/ha-status')])
      detail.value = hw; ha.value = h
      loading.value = false
      window.dispatchEvent(new CustomEvent('cnf:goto', { detail: { module: 'hosts', tab: 'detail' } }))
    }
    const backToList = () => {
      destroyCharts()
      selectedId.value = null; detail.value = null; ha.value = null
      window.dispatchEvent(new CustomEvent('cnf:goto', { detail: { module: 'hosts', tab: 'list' } }))
    }
    // 添加主机：复用全局主机纳管向导（与基础设施一致）
    const addHost = () => window.dispatchEvent(new CustomEvent('cnf:open-host-wizard', { detail: { presetClusterId: 0 } }))

    // ============================================================
    //  「主机管理 / 网络」页（detail tab 未选主机时）—— 按集群分组
    //  统一查看 / 配置宿主机管理网络（IP / 掩码 / 网关 / VLAN / 网卡）
    // ============================================================
    const ipv4Re = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/
    // 按集群分组的主机（用于管理网络表格）
    const clusterGroups = computed(() => {
      const map = new Map()
      hosts.value.forEach((h) => {
        const key = h.cluster_id ?? 0
        if (!map.has(key)) map.set(key, { cluster_id: key, cluster_name: h.cluster_name || t('hmn_no_hosts'), hosts: [] })
        map.get(key).hosts.push(h)
      })
      return Array.from(map.values())
    })

    // 单台主机管理网络编辑对话框
    const netDlg = reactive({ open: false, busy: false, host: null, form: {}, errors: {} })
    const openNetEdit = (h) => {
      netDlg.host = h
      netDlg.form = { ip: h.ip || '', netmask: h.netmask || '255.255.255.0', gateway: h.gateway || '', mgmt_vlan: h.mgmt_vlan ?? '', mgmt_nic: h.mgmt_nic || 'bond0' }
      netDlg.errors = {}
      netDlg.open = true
    }
    const submitNet = async () => {
      const e = {}
      if (!ipv4Re.test(netDlg.form.ip)) e.ip = t('hmn_ip_invalid')
      if (!ipv4Re.test(netDlg.form.netmask)) e.netmask = t('hmn_netmask_invalid')
      if (netDlg.form.gateway && !ipv4Re.test(netDlg.form.gateway)) e.gateway = t('hmn_gateway_invalid')
      const vlan = netDlg.form.mgmt_vlan
      if (vlan !== '' && (Number(vlan) < 0 || Number(vlan) > 4094)) e.mgmt_vlan = t('hmn_vlan_invalid')
      netDlg.errors = e
      if (Object.keys(e).length) return
      netDlg.busy = true
      try {
        const res = await api('/hosts/' + netDlg.host.id + '/network', { method: 'PUT', body: JSON.stringify(netDlg.form) })
        if (res && res.error) { netDlg.errors = { ip: res.code === 'IP_CONFLICT' ? t('hmn_ip_conflict') : res.error }; return }
        toast(res.message, 'success')
        await store.fetchAll()
        netDlg.open = false
      } catch (err) { toast(t('op_failed'), 'error') } finally { netDlg.busy = false }
    }

    // 集群级批量统一修改管理网络对话框
    const batchDlg = reactive({ open: false, busy: false, cluster: null, form: {}, errors: {} })
    const openBatch = (group) => {
      batchDlg.cluster = group
      batchDlg.form = { netmask: '', gateway: '', mgmt_vlan: '', mgmt_nic: '' }
      batchDlg.errors = {}
      batchDlg.open = true
    }
    const submitBatch = async () => {
      const e = {}
      if (batchDlg.form.netmask && !ipv4Re.test(batchDlg.form.netmask)) e.netmask = t('hmn_netmask_invalid')
      if (batchDlg.form.gateway && !ipv4Re.test(batchDlg.form.gateway)) e.gateway = t('hmn_gateway_invalid')
      const vlan = batchDlg.form.mgmt_vlan
      if (vlan !== '' && (Number(vlan) < 0 || Number(vlan) > 4094)) e.mgmt_vlan = t('hmn_vlan_invalid')
      batchDlg.errors = e
      if (Object.keys(e).length) return
      batchDlg.busy = true
      try {
        const res = await api('/clusters/' + batchDlg.cluster.cluster_id + '/host-network', { method: 'PUT', body: JSON.stringify(batchDlg.form) })
        if (res && res.error) { toast(res.error, 'error'); return }
        toast(res.message, 'success')
        await store.fetchAll()
        batchDlg.open = false
      } catch (err) { toast(t('op_failed'), 'error') } finally { batchDlg.busy = false }
    }

    // react to nav tab changes (e.g. user clicks "主机列表")
    watch(() => props.tab, (nv) => {
      if (nv === 'list') { selectedId.value = null; detail.value = null; destroyCharts() }
    })
    // allow opening a specific host via focus prop (from topology tree: {focusType:'host', focusId})
    watch(() => props.focus, (f) => {
      if (f && f.focusType === 'host' && f.focusId) openDetail(f.focusId)
      else if (f && f.hostId) openDetail(f.hostId)
    }, { immediate: true })

    // ---- maintenance toggle ----
    const maintBusy = ref(0)
    const blockDlg = reactive({ open: false, title: '', message: '', children: [] })
    const toggleMaintenance = async (h) => {
      maintBusy.value = h.id
      try {
        const res = await api('/hosts/' + h.id + '/maintenance', { method: 'POST', body: JSON.stringify({ enabled: h.status !== 'maintenance' }) })
        if (res && res.error) {
          blockDlg.open = true; blockDlg.title = t('host_maint_blocked'); blockDlg.message = res.error; blockDlg.children = res.children || []
          return
        }
        toast(res.message, 'success')
        await store.fetchAll()
        if (selectedId.value === h.id) await openDetail(h.id)
      } catch (e) { toast(t('op_failed'), 'error') } finally { maintBusy.value = 0 }
    }

    // ---- detail VM list ----
    const detailHost = computed(() => hosts.value.find((h) => h.id === selectedId.value))
    const detailVMs = computed(() => detailHost.value ? detailHost.value.vms_list || [] : [])

    // ---- HA helpers ----
    const haCheckList = computed(() => {
      if (!ha.value) return []
      const c = ha.value.checks
      return [
        { key: 'network_heartbeat', icon: 'fa-heart-pulse', ...c.network_heartbeat },
        { key: 'storage_heartbeat', icon: 'fa-hard-drive', ...c.storage_heartbeat },
        { key: 'libvirt_service', icon: 'fa-server', ...c.libvirt_service },
        { key: 'resource_availability', icon: 'fa-gauge-high', ...c.resource_availability },
        { key: 'fencing_capability', icon: 'fa-plug-circle-bolt', ...c.fencing_capability },
        { key: 'time_sync', icon: 'fa-clock', ...c.time_sync },
      ]
    })
    const haStatusColor = (s) => (s === 'pass' ? C.green : s === 'warn' ? C.orange : C.red)
    const haStatusText = (s) => (s === 'pass' ? 'PASS' : s === 'warn' ? 'WARN' : 'FAIL')
    const overallColor = (s) => (s === 'healthy' ? C.green : s === 'degraded' ? C.orange : C.red)
    const overallText = (s) => (s === 'healthy' ? t('ha_overall_healthy') : s === 'degraded' ? t('ha_overall_degraded') : t('ha_overall_failed'))
    const evIcon = (t2) => ({ failover: 'fa-arrows-turn-right', recovery: 'fa-circle-check', fence: 'fa-bolt', warning: 'fa-triangle-exclamation' }[t2] || 'fa-circle-info')
    const evColor = (t2) => ({ failover: C.orange, recovery: C.green, fence: C.red, warning: C.orange }[t2] || C.gray)

    // ---- charts (overview tab: CPU/mem rings already; monitor tab: history line) ----
    const destroyCharts = () => { Object.values(charts).forEach((c) => c && c.destroy()); charts = {} }
    const renderMonitorChart = async () => {
      if (!window.Chart) return
      await nextTick()
      const el = document.getElementById('host-mon-chart')
      if (!el) return
      if (charts.mon) charts.mon.destroy()
      // synthesize a deterministic-ish 20-point history around current usage
      const base = detailHost.value ? detailHost.value.cpu_usage : 50
      const mbase = detailHost.value ? detailHost.value.mem_usage : 50
      const labels = Array.from({ length: 20 }, (_, i) => { const d = new Date(Date.now() - (19 - i) * 180000); return fmt(d, { mode: 'time' }) })
      const cpu = labels.map((_, i) => Math.max(2, Math.min(99, Math.round(base + 14 * Math.sin(i / 3) + (Math.random() - 0.5) * 8))))
      const mem = labels.map((_, i) => Math.max(2, Math.min(99, Math.round(mbase + 8 * Math.sin(i / 4 + 1) + (Math.random() - 0.5) * 5))))
      const sec = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#888'
      charts.mon = new Chart(el, {
        type: 'line',
        data: { labels, datasets: [
          { label: 'CPU %', data: cpu, borderColor: C.blue, backgroundColor: 'rgba(0,122,255,.12)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
          { label: t('col_mem') + ' %', data: mem, borderColor: C.indigo, backgroundColor: 'transparent', fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0 },
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 10, color: sec, font: { size: 12 } } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7, color: '#999', font: { size: 11 } } }, y: { beginAtZero: true, max: 100, grid: { color: 'rgba(120,120,128,.14)' }, ticks: { color: '#999', font: { size: 11 } } } } },
      })
    }
    watch(detailTab, (nv) => { if (nv === 'monitor') renderMonitorChart(); else destroyCharts() })

    onMounted(async () => { if (!hosts.value.length) await store.fetchAll() })
    onBeforeUnmount(destroyCharts)

    const showDetailView = computed(() => props.tab === 'detail' && selectedId.value && detail.value)

    return {
      props, hosts, filteredHosts, search, statusFilter, statusMeta, openDetail, backToList, addHost,
      selectedId, detail, ha, detailTab, loading, showDetailView, detailHost, detailVMs,
      toggleMaintenance, maintBusy, blockDlg,
      clusterGroups, netDlg, openNetEdit, submitNet, batchDlg, openBatch, submitBatch,
      haCheckList, haStatusColor, haStatusText, overallColor, overallText, evIcon, evColor,
      bytesRate, utilColor, C, t, fmt,
    }
  },
  template: `
  <div>
    <!-- ====================== 主机列表（卡片 · 实时负载 / 维护模式）====================== -->
    <template v-if="props.tab==='list' && !showDetailView">
      <div class="toolbar">
        <button class="apple-btn apple-btn--primary" @click="addHost"><i class="fas fa-plus"></i> {{ t('hw_add_host') }}</button>
        <div class="toolbar-search"><i class="fas fa-magnifying-glass"></i><input v-model="search" :placeholder="t('host_search_ph')"></div>
        <select class="host-filter-select" v-model="statusFilter">
          <option value="">{{ t('host_filter_all') }}</option>
          <option value="connected">{{ t('host_st_online') }}</option>
          <option value="maintenance">{{ t('host_st_maint') }}</option>
          <option value="disconnected">{{ t('host_st_offline') }}</option>
        </select>
        <div class="spacer"></div>
        <span class="muted">{{ filteredHosts.length }} {{ t('host_machine') }}</span>
      </div>
      <div class="grid grid-3">
        <div class="apple-card host-tile" v-for="h in filteredHosts" :key="h.id" @click="openDetail(h.id)">
          <div class="ht-head">
            <div class="ht-title"><i class="fas fa-server" :style="{color:C.blue}"></i> {{ h.name }}</div>
            <span class="apple-badge" :class="statusMeta(h.status).cls"><span class="dot"></span>{{ t(statusMeta(h.status).key) }}</span>
          </div>
          <div class="ht-meta">{{ h.ip }} · {{ h.cluster_name }}</div>
          <div class="ht-cpu">{{ h.cpu_model }}</div>
          <div class="ht-bars">
            <div class="ht-bar">
              <div class="flex between"><span class="muted" style="font-size:12px">CPU</span><span class="mono" style="font-size:12px">{{ Math.round(h.cpu_usage) }}%</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:h.cpu_usage+'%',background:utilColor(h.cpu_usage)}"></div></div>
            </div>
            <div class="ht-bar">
              <div class="flex between"><span class="muted" style="font-size:12px">{{ t('col_mem') }}</span><span class="mono" style="font-size:12px">{{ Math.round(h.mem_usage) }}%</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:h.mem_usage+'%',background:utilColor(h.mem_usage)}"></div></div>
            </div>
          </div>
          <div class="ht-foot">
            <span class="muted"><i class="fas fa-desktop"></i> {{ h.vm_running }}/{{ h.vm_count }} VM</span>
            <span class="muted" v-if="h.gpus"><i class="fas fa-microchip" style="color:#76b900"></i> {{ h.gpus }} GPU</span>
            <div class="spacer"></div>
            <button class="apple-btn apple-btn--ghost apple-btn--sm" :disabled="maintBusy===h.id" @click.stop="toggleMaintenance(h)">
              <i v-if="maintBusy===h.id" class="fas fa-spinner fa-spin"></i>
              <i v-else :class="h.status==='maintenance'?'fas fa-play':'fas fa-wrench'"></i>
              {{ h.status==='maintenance' ? t('host_exit_maint') : t('host_enter_maint') }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 主机管理 / 网络（按集群分组统一管理宿主机管理网络）============ -->
    <template v-else-if="props.tab==='detail' && !showDetailView">
      <div class="hmn-intro">
        <div class="hmn-intro-title"><i class="fas fa-network-wired" :style="{color:C.teal}"></i> {{ t('hmn_title') }}</div>
        <div class="muted">{{ t('hmn_intro') }}</div>
      </div>
      <div class="apple-card hmn-cluster-card" v-for="g in clusterGroups" :key="g.cluster_id">
        <div class="hmn-cluster-head">
          <div><i class="fas fa-layer-group" :style="{color:C.indigo}"></i> <strong>{{ g.cluster_name }}</strong>
            <span class="muted" style="margin-left:8px;font-weight:400">· {{ g.hosts.length }} {{ t('hmn_hosts_n') }}</span></div>
          <button class="apple-btn apple-btn--secondary apple-btn--sm" @click="openBatch(g)"><i class="fas fa-sliders"></i> {{ t('hmn_batch') }}</button>
        </div>
        <div style="overflow-x:auto">
          <table class="apple-table hmn-table">
            <thead><tr>
              <th>{{ t('hmn_col_host') }}</th><th>{{ t('hmn_col_status') }}</th><th>{{ t('hmn_col_ip') }}</th>
              <th>{{ t('hmn_col_netmask') }}</th><th>{{ t('hmn_col_gateway') }}</th><th>{{ t('hmn_col_vlan') }}</th>
              <th>{{ t('hmn_col_nic') }}</th><th style="text-align:right">{{ t('hmn_col_ops') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="h in g.hosts" :key="h.id">
                <td><strong>{{ h.name }}</strong></td>
                <td><span class="apple-badge" :class="statusMeta(h.status).cls"><span class="dot"></span>{{ t(statusMeta(h.status).key) }}</span></td>
                <td class="mono">{{ h.ip }}</td>
                <td class="mono muted">{{ h.netmask || '—' }}</td>
                <td class="mono muted">{{ h.gateway || '—' }}</td>
                <td class="mono"><span class="hw-chip">VLAN {{ h.mgmt_vlan ?? '—' }}</span></td>
                <td class="mono muted">{{ h.mgmt_nic || '—' }}</td>
                <td style="text-align:right"><button class="apple-btn apple-btn--ghost apple-btn--sm" @click="openNetEdit(h)"><i class="fas fa-pen"></i> {{ t('hmn_edit_host') }}</button></td>
              </tr>
              <tr v-if="!g.hosts.length"><td colspan="8" class="muted" style="text-align:center;padding:16px">{{ t('hmn_no_hosts') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- ====================== DETAIL ====================== -->
    <template v-else>
      <div class="toolbar">
        <button class="apple-btn apple-btn--ghost apple-btn--sm" @click="backToList"><i class="fas fa-arrow-left"></i> {{ t('host_back') }}</button>
        <div class="detail-title"><i class="fas fa-server" :style="{color:C.blue}"></i> {{ detail.hostname }} <span class="muted" style="font-weight:400">· {{ detail.ip_address }} · {{ detail.cluster_name }}</span></div>
        <div class="spacer"></div>
        <button class="apple-btn apple-btn--secondary apple-btn--sm" :disabled="maintBusy===selectedId" @click="toggleMaintenance(detailHost)">
          <i :class="detailHost && detailHost.status==='maintenance'?'fas fa-play':'fas fa-wrench'"></i>
          {{ detailHost && detailHost.status==='maintenance' ? t('host_exit_maint') : t('host_enter_maint') }}
        </button>
      </div>

      <!-- detail sub-tabs -->
      <div class="seg-tabs">
        <button :class="{active:detailTab==='overview'}" @click="detailTab='overview'"><i class="fas fa-gauge"></i> {{ t('host_tab_overview') }}</button>
        <button :class="{active:detailTab==='hardware'}" @click="detailTab='hardware'"><i class="fas fa-microchip"></i> {{ t('host_tab_hardware') }}</button>
        <button :class="{active:detailTab==='ha'}" @click="detailTab='ha'"><i class="fas fa-shield-halved"></i> {{ t('host_tab_ha') }}</button>
        <button :class="{active:detailTab==='monitor'}" @click="detailTab='monitor'"><i class="fas fa-chart-line"></i> {{ t('host_tab_monitor') }}</button>
        <button :class="{active:detailTab==='vms'}" @click="detailTab='vms'"><i class="fas fa-desktop"></i> {{ t('host_tab_vms') }} ({{ detailVMs.length }})</button>
      </div>

      <!-- OVERVIEW -->
      <div v-if="detailTab==='overview'" class="grid grid-3" style="align-items:start">
        <div class="apple-card" style="display:flex;flex-direction:column;align-items:center;gap:10px">
          <div class="muted" style="font-size:13px;font-weight:600">CPU</div>
          <ring-progress :value="detail.cpu_info.current_usage_percent" :color="utilColor(detail.cpu_info.current_usage_percent)" :size="118"/>
          <div class="muted" style="font-size:12px;text-align:center">{{ detail.cpu_info.total_threads }} {{ t('host_threads') }} · {{ detail.cpu_info.sockets }} {{ t('host_sockets') }}</div>
        </div>
        <div class="apple-card" style="display:flex;flex-direction:column;align-items:center;gap:10px">
          <div class="muted" style="font-size:13px;font-weight:600">{{ t('col_mem') }}</div>
          <ring-progress :value="Math.round(detail.mem_used_gb/detail.mem_total_gb*100)" :color="utilColor(Math.round(detail.mem_used_gb/detail.mem_total_gb*100))" :size="118"/>
          <div class="muted" style="font-size:12px">{{ detail.mem_used_gb }} / {{ detail.mem_total_gb }} GB</div>
        </div>
        <div class="apple-card">
          <div class="info-row"><span>{{ t('host_machine') }}</span><strong>{{ detail.hostname }}</strong></div>
          <div class="info-row"><span>IP</span><strong class="mono">{{ detail.ip_address }}</strong></div>
          <div class="info-row"><span>{{ t('nav_infra_clusters') }}</span><strong>{{ detail.cluster_name }}</strong></div>
          <div class="info-row"><span>{{ t('status') }}</span><strong :style="{color: detail.status==='online'?C.green:detail.status==='maintenance'?C.orange:C.red}">{{ t(statusMeta(detailHost.status).key) }}</strong></div>
          <div class="info-row"><span>CPU</span><strong style="font-size:13px">{{ detail.cpu_info.model }}</strong></div>
          <div class="info-row"><span>NUMA</span><strong>{{ detail.cpu_info.numa_nodes }}</strong></div>
          <div class="info-row"><span>HA</span><strong :style="{color: ha?overallColor(ha.overall_status):''}">{{ ha ? overallText(ha.overall_status) + ' · ' + ha.health_score : '—' }}</strong></div>
        </div>
      </div>

      <!-- HARDWARE -->
      <div v-else-if="detailTab==='hardware'">
        <!-- CPU topology -->
        <div class="hw-section-title"><i class="fas fa-microchip" :style="{color:C.blue}"></i> {{ t('hw_cpu_topo') }}</div>
        <div class="apple-card hw-cpu-grid">
          <div><span class="muted">{{ t('hw_model') }}</span><strong>{{ detail.cpu_info.model }}</strong></div>
          <div><span class="muted">{{ t('hw_vendor') }}</span><strong>{{ detail.cpu_info.vendor }}</strong></div>
          <div><span class="muted">{{ t('hw_sockets') }}</span><strong>{{ detail.cpu_info.sockets }}</strong></div>
          <div><span class="muted">{{ t('hw_cores_socket') }}</span><strong>{{ detail.cpu_info.cores_per_socket }}</strong></div>
          <div><span class="muted">{{ t('hw_threads_total') }}</span><strong>{{ detail.cpu_info.total_threads }}</strong></div>
          <div><span class="muted">{{ t('hw_freq') }}</span><strong>{{ detail.cpu_info.base_freq_ghz }} – {{ detail.cpu_info.max_freq_ghz }} GHz</strong></div>
          <div><span class="muted">L3 Cache</span><strong>{{ detail.cpu_info.cache_l3_mb }} MB</strong></div>
          <div><span class="muted">NUMA</span><strong>{{ detail.cpu_info.numa_nodes }}</strong></div>
          <div class="hw-feats"><span class="muted">{{ t('hw_virt_feat') }}</span><div><span class="hw-chip" v-for="f in detail.cpu_info.virtualization_features" :key="f">{{ f }}</span></div></div>
        </div>

        <!-- NICs -->
        <div class="hw-section-title"><i class="fas fa-network-wired" :style="{color:C.green}"></i> {{ t('hw_nics') }}</div>
        <div class="apple-card" style="padding:0;overflow-x:auto">
          <table class="apple-table">
            <thead><tr><th>{{ t('hw_nic_name') }}</th><th>{{ t('hw_type') }}</th><th>{{ t('hw_vendor_model') }}</th><th>MAC</th><th>{{ t('hw_speed') }}</th><th>{{ t('hw_link') }}</th><th>IP</th><th>{{ t('hw_traffic') }}</th></tr></thead>
            <tbody>
              <tr v-for="n in detail.network_interfaces" :key="n.name">
                <td><strong class="mono">{{ n.name }}</strong><div class="muted" style="font-size:11px">{{ n.pci_address }} · {{ n.driver }}</div></td>
                <td><span class="hw-chip">{{ n.type }}</span><div v-if="n.bond_members" class="muted" style="font-size:11px;margin-top:3px">{{ n.bond_members.join(' + ') }}</div></td>
                <td>{{ n.vendor }} {{ n.model }}</td>
                <td class="mono" style="font-size:12px">{{ n.mac_address }}</td>
                <td class="mono">{{ n.speed_gbps }} Gbps</td>
                <td><span class="apple-badge" :class="n.link_status==='up'?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ n.link_status }}</span></td>
                <td class="mono" style="font-size:12px">{{ n.ip_address || '—' }}</td>
                <td><div style="font-size:12px"><span style="color:var(--color-green)">↓ {{ bytesRate(n.rx_bytes_per_sec) }}</span><br><span style="color:var(--color-orange)">↑ {{ bytesRate(n.tx_bytes_per_sec) }}</span></div></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Storage devices -->
        <div class="hw-section-title"><i class="fas fa-hard-drive" :style="{color:C.indigo}"></i> {{ t('hw_storage_dev') }}</div>
        <div class="apple-card" style="padding:0;overflow-x:auto">
          <table class="apple-table">
            <thead><tr><th>{{ t('hw_dev_name') }}</th><th>{{ t('hw_type') }}</th><th>{{ t('hw_vendor_model') }}</th><th>{{ t('hw_capacity') }}</th><th>{{ t('hw_interface') }}</th><th>{{ t('hw_rpm') }}</th><th>{{ t('hw_temp') }}</th><th>SMART</th><th>{{ t('hw_usage') }}</th><th>IOPS (R/W)</th></tr></thead>
            <tbody>
              <tr v-for="d in detail.storage_devices" :key="d.device_name">
                <td><strong class="mono">{{ d.device_name }}</strong><div class="muted" style="font-size:11px">{{ d.serial_number }}</div></td>
                <td><span class="hw-chip">{{ d.type }}</span></td>
                <td>{{ d.vendor }} {{ d.model }}</td>
                <td class="mono">{{ d.capacity_gb>=1000 ? (d.capacity_gb/1000).toFixed(2)+' TB' : d.capacity_gb+' GB' }}</td>
                <td style="font-size:12px">{{ d.interface }}</td>
                <td class="mono">{{ d.rpm ? d.rpm+' RPM' : '—' }}</td>
                <td class="mono" :style="{color: d.temperature_celsius>50?'var(--color-orange)':'inherit'}">{{ d.temperature_celsius }}°C</td>
                <td><span class="apple-badge" :class="d.smart_status==='healthy'?'apple-badge--running':d.smart_status==='warning'?'apple-badge--warning':'apple-badge--stopped'"><span class="dot"></span>{{ d.smart_status }}</span></td>
                <td style="width:120px"><div class="flex between"><span class="mono" style="font-size:11px">{{ d.usage_percent }}%</span></div><div class="usage-bar"><div class="fill" :style="{width:d.usage_percent+'%',background:utilColor(d.usage_percent)}"></div></div></td>
                <td class="mono" style="font-size:12px">{{ d.read_iops.toLocaleString() }} / {{ d.write_iops.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- PCI devices -->
        <div class="hw-section-title"><i class="fas fa-plug" :style="{color:C.purple}"></i> {{ t('hw_pci_dev') }}</div>
        <div class="apple-card" style="padding:0;overflow-x:auto">
          <table class="apple-table">
            <thead><tr><th>PCI</th><th>{{ t('hw_vendor_model') }}</th><th>{{ t('hw_dev_class') }}</th><th>{{ t('hw_driver') }}</th><th>IOMMU</th><th>NUMA</th><th>{{ t('hw_passthrough') }}</th></tr></thead>
            <tbody>
              <tr v-for="p in detail.pci_devices" :key="p.pci_address">
                <td class="mono" style="font-size:12px">{{ p.pci_address }}</td>
                <td><strong>{{ p.vendor }}</strong> {{ p.device_name }}</td>
                <td class="muted">{{ p.device_class }}</td>
                <td class="mono" style="font-size:12px">{{ p.driver }}</td>
                <td class="mono">{{ p.iommu_group }}</td>
                <td class="mono">{{ p.numa_node }}</td>
                <td><i :class="p.passthrough_capable?'fas fa-circle-check':'fas fa-circle-minus'" :style="{color:p.passthrough_capable?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- HA STATUS -->
      <div v-else-if="detailTab==='ha'">
        <div class="ha-score-panel apple-card apple-card--glass">
          <ring-progress :value="ha.health_score" :color="overallColor(ha.overall_status)" :label="t('ha_health_score')" :size="140"/>
          <div class="ha-score-info">
            <h3 :style="{color:overallColor(ha.overall_status)}">{{ overallText(ha.overall_status) }}</h3>
            <div class="muted">{{ t('ha_last_check') }}：{{ fmt(ha.last_check_time, {mode:'relative'}) }}</div>
            <div class="muted">{{ t('ha_interval') }}：{{ ha.check_interval_seconds }}s</div>
            <span class="apple-badge" :class="ha.enabled?'apple-badge--running':'apple-badge--stopped'" style="margin-top:8px"><span class="dot"></span>{{ ha.enabled ? t('ha_enabled_on') : t('ha_enabled_off') }}</span>
          </div>
        </div>

        <div class="ha-checks-grid">
          <div v-for="ck in haCheckList" :key="ck.key" class="apple-card ha-check-card" :style="{borderLeft:'4px solid '+haStatusColor(ck.status)}">
            <div class="hc-head">
              <i class="fas" :class="ck.icon" :style="{color:haStatusColor(ck.status)}"></i>
              <strong>{{ t('ha_check_'+ck.key) }}</strong>
              <span class="hc-badge" :style="{background:haStatusColor(ck.status)+'22',color:haStatusColor(ck.status)}">{{ haStatusText(ck.status) }}</span>
            </div>
            <p class="hc-msg">{{ ck.message }}</p>
            <div class="hc-metrics">
              <template v-if="ck.key==='network_heartbeat'">
                <span>{{ t('ha_resp') }}: <b>{{ ck.response_time_ms }}ms</b></span>
                <span>{{ t('ha_loss') }}: <b>{{ ck.packet_loss_percent }}%</b></span>
                <span>{{ t('ha_fails') }}: <b>{{ ck.consecutive_failures }}</b></span>
              </template>
              <template v-else-if="ck.key==='storage_heartbeat'">
                <span>{{ t('ha_lat') }}: <b>{{ ck.storage_latency_ms }}ms</b></span>
                <span>{{ t('ha_lock') }}: <b>{{ ck.lock_file_writable ? 'OK' : 'FAIL' }}</b></span>
              </template>
              <template v-else-if="ck.key==='libvirt_service'">
                <span>{{ ck.version }}</span>
                <span>VM: <b>{{ ck.vm_count_accessible }}</b></span>
              </template>
              <template v-else-if="ck.key==='resource_availability'">
                <span>CPU {{ t('sp_free') }}: <b>{{ ck.cpu_available_percent }}%</b></span>
                <span>{{ t('col_mem') }} {{ t('sp_free') }}: <b>{{ ck.memory_available_gb }}GB</b></span>
                <span>{{ t('ha_failover_cap') }}: <b>{{ ck.can_accept_failover_vms }}</b></span>
              </template>
              <template v-else-if="ck.key==='fencing_capability'">
                <span>IPMI: <b>{{ ck.ipmi_accessible ? 'OK' : 'N/A' }}</b></span>
                <span>{{ t('ha_fence_agent') }}: <b>{{ ck.fence_agent_configured ? 'OK' : 'N/A' }}</b></span>
              </template>
              <template v-else-if="ck.key==='time_sync'">
                <span>{{ t('ha_clock_offset') }}: <b>{{ ck.clock_offset_ms == null ? '—' : ck.clock_offset_ms + 'ms' }}</b></span>
                <span>{{ t('ha_offset_thresh') }}: <b>{{ ck.max_offset_ms }}ms</b></span>
                <span v-if="ck.is_ntp_server" class="hw-chip" style="background:rgba(0,122,255,.12);color:var(--color-blue)"><i class="fas fa-server"></i> {{ t('ha_ntp_server') }}</span>
                <span v-else>{{ t('ha_ntp_source') }}: <b>{{ ck.ntp_source }}</b></span>
              </template>
            </div>
          </div>
        </div>

        <div class="hw-section-title"><i class="fas fa-clock-rotate-left" :style="{color:C.gray}"></i> {{ t('ha_events') }}</div>
        <div class="apple-card ha-timeline">
          <div class="ha-event" v-for="(e,i) in ha.recent_events" :key="i">
            <div class="hev-dot" :style="{background:evColor(e.event_type)}"><i class="fas" :class="evIcon(e.event_type)"></i></div>
            <div class="hev-body">
              <div class="hev-desc">{{ e.description }}</div>
              <div class="muted" style="font-size:12px">{{ fmt(e.timestamp) }}<template v-if="e.affected_vms && e.affected_vms.length"> · {{ t('ha_affected') }}: {{ e.affected_vms.join(', ') }}</template></div>
            </div>
          </div>
          <div v-if="!ha.recent_events.length" class="muted" style="padding:14px;text-align:center">{{ t('ha_no_events') }}</div>
        </div>
      </div>

      <!-- MONITOR -->
      <div v-else-if="detailTab==='monitor'">
        <div class="apple-card mon-chart-card">
          <div class="mc-head"><i class="fas fa-chart-area" :style="{color:C.blue}"></i> {{ t('host_perf_trend') }}</div>
          <div class="mc-canvas"><canvas id="host-mon-chart"></canvas></div>
        </div>
      </div>

      <!-- VMS -->
      <div v-else-if="detailTab==='vms'">
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('host_machine') }}</th><th>{{ t('status') }}</th><th>vCPU</th><th>{{ t('col_mem') }}</th></tr></thead>
            <tbody>
              <tr v-for="v in detailVMs" :key="v.id">
                <td><strong>{{ v.name }}</strong></td>
                <td><span class="apple-badge" :class="v.status==='running'?'apple-badge--running':v.status==='paused'?'apple-badge--warning':'apple-badge--stopped'"><span class="dot"></span>{{ v.status }}</span></td>
                <td class="mono">{{ v.vcpus }}</td>
                <td class="mono">{{ v.mem_gb }} GB</td>
              </tr>
              <tr v-if="!detailVMs.length"><td colspan="4" class="muted" style="text-align:center;padding:18px">{{ t('host_no_vms') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 单台主机管理网络编辑对话框 -->
    <div v-if="netDlg.open" class="modal-mask" @click.self="netDlg.open=false">
      <div class="modal-dialog">
        <div class="modal-head"><i class="fas fa-network-wired" :style="{color:C.teal}"></i> {{ t('hmn_edit_title') }} <span class="muted" style="font-weight:400">· {{ netDlg.host && netDlg.host.name }}</span></div>
        <div class="modal-body">
          <div class="form-grid-2">
            <div class="form-row"><label class="req">{{ t('hmn_col_ip') }}</label><input v-model="netDlg.form.ip" :class="{invalid:netDlg.errors.ip}" placeholder="192.168.1.100"><div v-if="netDlg.errors.ip" class="form-err">{{ netDlg.errors.ip }}</div></div>
            <div class="form-row"><label class="req">{{ t('hmn_col_netmask') }}</label><input v-model="netDlg.form.netmask" :class="{invalid:netDlg.errors.netmask}" placeholder="255.255.255.0"><div v-if="netDlg.errors.netmask" class="form-err">{{ netDlg.errors.netmask }}</div></div>
            <div class="form-row"><label>{{ t('hmn_col_gateway') }}</label><input v-model="netDlg.form.gateway" :class="{invalid:netDlg.errors.gateway}" placeholder="192.168.1.1"><div v-if="netDlg.errors.gateway" class="form-err">{{ netDlg.errors.gateway }}</div></div>
            <div class="form-row"><label>{{ t('hmn_col_vlan') }}</label><input type="number" min="0" max="4094" v-model.number="netDlg.form.mgmt_vlan" :class="{invalid:netDlg.errors.mgmt_vlan}" placeholder="10"><div v-if="netDlg.errors.mgmt_vlan" class="form-err">{{ netDlg.errors.mgmt_vlan }}</div></div>
            <div class="form-row"><label>{{ t('hmn_col_nic') }}</label><input v-model="netDlg.form.mgmt_nic" placeholder="bond0"></div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="apple-btn apple-btn--ghost" @click="netDlg.open=false">{{ t('op_cancel') }}</button>
          <button class="apple-btn apple-btn--primary" :disabled="netDlg.busy" @click="submitNet"><i v-if="netDlg.busy" class="fas fa-spinner fa-spin"></i> {{ t('op_confirm') }}</button>
        </div>
      </div>
    </div>

    <!-- 集群级批量统一修改管理网络对话框 -->
    <div v-if="batchDlg.open" class="modal-mask" @click.self="batchDlg.open=false">
      <div class="modal-dialog">
        <div class="modal-head"><i class="fas fa-sliders" :style="{color:C.indigo}"></i> {{ t('hmn_batch_title') }} <span class="muted" style="font-weight:400">· {{ batchDlg.cluster && batchDlg.cluster.cluster_name }}</span></div>
        <div class="modal-body">
          <div class="hosts-pick-hint" style="margin-bottom:14px"><i class="fas fa-circle-info"></i> {{ t('hmn_batch_hint') }}</div>
          <div class="form-grid-2">
            <div class="form-row"><label>{{ t('hmn_col_netmask') }} <span class="muted" style="font-weight:400;font-size:11px">{{ t('hmn_keep') }}</span></label><input v-model="batchDlg.form.netmask" :class="{invalid:batchDlg.errors.netmask}" placeholder="255.255.255.0"><div v-if="batchDlg.errors.netmask" class="form-err">{{ batchDlg.errors.netmask }}</div></div>
            <div class="form-row"><label>{{ t('hmn_col_gateway') }} <span class="muted" style="font-weight:400;font-size:11px">{{ t('hmn_keep') }}</span></label><input v-model="batchDlg.form.gateway" :class="{invalid:batchDlg.errors.gateway}" placeholder="192.168.1.1"><div v-if="batchDlg.errors.gateway" class="form-err">{{ batchDlg.errors.gateway }}</div></div>
            <div class="form-row"><label>{{ t('hmn_col_vlan') }} <span class="muted" style="font-weight:400;font-size:11px">{{ t('hmn_keep') }}</span></label><input type="number" min="0" max="4094" v-model="batchDlg.form.mgmt_vlan" :class="{invalid:batchDlg.errors.mgmt_vlan}" placeholder="10"><div v-if="batchDlg.errors.mgmt_vlan" class="form-err">{{ batchDlg.errors.mgmt_vlan }}</div></div>
            <div class="form-row"><label>{{ t('hmn_col_nic') }} <span class="muted" style="font-weight:400;font-size:11px">{{ t('hmn_keep') }}</span></label><input v-model="batchDlg.form.mgmt_nic" placeholder="bond0"></div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="apple-btn apple-btn--ghost" @click="batchDlg.open=false">{{ t('op_cancel') }}</button>
          <button class="apple-btn apple-btn--primary" :disabled="batchDlg.busy" @click="submitBatch"><i v-if="batchDlg.busy" class="fas fa-spinner fa-spin"></i> {{ t('op_confirm') }}</button>
        </div>
      </div>
    </div>

    <!-- block dialog (maintenance has running VM) -->
    <div v-if="blockDlg.open" class="modal-mask" @click.self="blockDlg.open=false">
      <div class="modal-dialog modal-sm">
        <div class="modal-head"><i class="fas fa-triangle-exclamation" style="color:var(--color-orange)"></i> {{ blockDlg.title }}</div>
        <div class="modal-body"><p>{{ blockDlg.message }}</p><ul v-if="blockDlg.children.length" class="block-list"><li v-for="c in blockDlg.children" :key="c">{{ c }}</li></ul></div>
        <div class="modal-foot"><button class="apple-btn apple-btn--primary" @click="blockDlg.open=false">{{ t('op_close') }}</button></div>
      </div>
    </div>
  </div>`,
}

window.__CNF_VIEWS.HostsView = HostsView
})()
