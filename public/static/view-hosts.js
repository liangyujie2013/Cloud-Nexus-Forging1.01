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
  components: { RingProgress: window.__CNF_VIEWS.RingProgress, HostContextMenu: window.__CNF_VIEWS.HostContextMenu },
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

    // ============================================================
    //  实时指标（真实数据）—— 批量采集 + 轮询；不可达/无凭据显示「—」，绝不伪造。
    // ============================================================
    const metricsLoading = computed(() => store.state.metricsLoading)
    let metricsTimer = null
    const refreshMetrics = async () => { await store.fetchHostMetrics() }
    const startMetricsPolling = () => {
      stopMetricsPolling()
      refreshMetrics()
      metricsTimer = setInterval(refreshMetrics, 15000)  // 15s 轮询真实指标
    }
    const stopMetricsPolling = () => { if (metricsTimer) { clearInterval(metricsTimer); metricsTimer = null } }
    // 取某主机真实指标（可能为 null）
    const hMetric = (h) => (h && h.metrics) || null
    // 指标百分比 → 显示文本（有值则 round + %，否则 —）
    const pctText = (v) => (v == null || isNaN(v) ? '—' : Math.round(v) + '%')
    const pctWidth = (v) => (v == null || isNaN(v) ? 0 : Math.max(0, Math.min(100, v)))
    // 运行时长（秒）→ 友好文本
    const uptimeText = (sec) => {
      if (!sec || sec <= 0) return '—'
      const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), mm = Math.floor((sec % 3600) / 60)
      if (d > 0) return d + t('hv_uptime_d') + ' ' + hh + t('hv_uptime_h')
      if (hh > 0) return hh + t('hv_uptime_h') + ' ' + mm + t('hv_uptime_m')
      return mm + t('hv_uptime_m')
    }

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

    // ---- open detail（全部真实数据：/status 实时状态 + /hardware libvirt 能力&清单 + /metrics）----
    const liveStatus = ref(null)   // GET /hosts/:id/status 真实快照
    const openDetail = async (id) => {
      selectedId.value = id
      detailTab.value = 'overview'
      loading.value = true
      detail.value = null; liveStatus.value = null
      // 并发拉取真实硬件清单 + 实时状态；ha-status 端点不存在，已移除。
      const [hw, st] = await Promise.all([
        api('/hosts/' + id + '/hardware'),
        api('/hosts/' + id + '/status'),
      ])
      detail.value = (hw && !hw.error) ? hw : null
      liveStatus.value = (st && !st.error && st.reachable !== false) ? st : null
      loading.value = false
      // 详情视图覆盖在当前视图之上（showDetailView=true 即接管渲染），无需切换 nav tab。
      stopMetricsPolling()
    }
    const backToList = () => {
      destroyCharts(); stopMonitor()
      selectedId.value = null; detail.value = null; ha.value = null; liveStatus.value = null
      // 返回后恢复列表/管理视图的指标轮询
      if (props.tab === 'list' || props.tab === 'management') startMetricsPolling()
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

    // 单台主机管理网络编辑对话框 —— 真实读取网卡（名称/MAC/UUID/模式 DHCP|static/IP/掩码/网关），
    // 并支持 DHCP↔静态切换、写配置生效（后端 nmcli）。
    const netDlg = reactive({
      open: false, busy: false, loading: false, host: null,
      nics: [], selected: null,        // 真实网卡列表 + 当前选中设备
      info: null, loadError: '',
      form: { mode: 'dhcp', device: '', ipv4: '', netmask: '255.255.255.0', gateway: '', dns: '' },
      steps: [], errors: {}
    })
    // 选中某网卡 → 用其真实配置回填表单
    const pickNic = (dev) => {
      const n = netDlg.nics.find((x) => x.device === dev)
      if (!n) return
      netDlg.selected = dev
      netDlg.form = {
        mode: n.mode === 'static' ? 'static' : (n.mode === 'dhcp' ? 'dhcp' : 'dhcp'),
        device: n.device,
        ipv4: n.ipv4 || '',
        netmask: n.netmask || '255.255.255.0',
        gateway: n.gateway || '',
        dns: (n.dns || []).join(', ')
      }
      netDlg.errors = {}
      netDlg.steps = []
    }
    const openNetEdit = async (h) => {
      netDlg.host = h
      netDlg.nics = []; netDlg.selected = null; netDlg.info = null
      netDlg.loadError = ''; netDlg.errors = {}; netDlg.steps = []
      netDlg.form = { mode: 'dhcp', device: '', ipv4: '', netmask: '255.255.255.0', gateway: '', dns: '' }
      netDlg.open = true
      netDlg.loading = true
      try {
        // api() 在成功时解包 {data:...} → res 即为网卡数据对象；
        // 出错（NO_CREDENTIAL/SSH_UNREACHABLE/COLLECT_FAILED）时透传 {error,code,data}。
        const res = await api('/hosts/' + h.id + '/network')
        if (!res || res.error || res.reachable === false) {
          netDlg.loadError = (res && res.error) || '无法读取主机网卡（凭据缺失或主机不可达）'
        } else {
          netDlg.info = res
          netDlg.nics = (res.nics || []).filter((n) => n.device !== 'lo')
          // 默认选中默认路由出口网卡，否则第一块物理网卡
          const def = netDlg.nics.find((n) => n.device === res.default_dev) ||
                      netDlg.nics.find((n) => n.is_physical) || netDlg.nics[0]
          if (def) pickNic(def.device)
          else netDlg.loadError = '未发现可配置网卡'
        }
      } catch (err) {
        netDlg.loadError = t('op_failed') || '读取网卡失败'
      } finally { netDlg.loading = false }
    }
    const submitNet = async () => {
      const e = {}
      if (!netDlg.form.device) e.device = '请选择网卡'
      if (netDlg.form.mode === 'static') {
        if (!ipv4Re.test(netDlg.form.ipv4)) e.ipv4 = t('hmn_ip_invalid')
        if (!ipv4Re.test(netDlg.form.netmask)) e.netmask = t('hmn_netmask_invalid')
        if (netDlg.form.gateway && !ipv4Re.test(netDlg.form.gateway)) e.gateway = t('hmn_gateway_invalid')
      }
      netDlg.errors = e
      if (Object.keys(e).length) return
      netDlg.busy = true
      netDlg.steps = []
      try {
        const payload = { device: netDlg.form.device, mode: netDlg.form.mode }
        if (netDlg.form.mode === 'static') {
          payload.ipv4 = netDlg.form.ipv4
          payload.netmask = netDlg.form.netmask
          payload.gateway = netDlg.form.gateway
          payload.dns = netDlg.form.dns
        }
        const res = await api('/hosts/' + netDlg.host.id + '/network', { method: 'PUT', body: JSON.stringify(payload) })
        if (res && res.error) {
          netDlg.steps = res.steps || []
          netDlg.errors = { device: res.error }
          toast(res.error, 'error')
          return
        }
        // 成功时 api() 解包 data → res 即 {steps:[...]}
        netDlg.steps = (res && res.steps) || []
        toast(t('toast_success') || '主机网络已更新并生效', 'success')
        // 重新读取以反映最新模式（res 即网卡数据对象）
        const fresh = await api('/hosts/' + netDlg.host.id + '/network')
        if (fresh && !fresh.error && fresh.reachable !== false) {
          netDlg.nics = (fresh.nics || []).filter((n) => n.device !== 'lo')
          if (netDlg.selected) pickNic(netDlg.selected)
        }
        await store.fetchAll()
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

    // react to nav tab changes（列表/管理/网络三个独立视图）
    watch(() => props.tab, (nv) => {
      if (nv === 'list' || nv === 'management' || nv === 'network') {
        selectedId.value = null; detail.value = null; destroyCharts()
      }
      // 列表与管理视图需要实时指标；进入即开始轮询，离开停止。
      if (nv === 'list' || nv === 'management') startMetricsPolling()
      else stopMetricsPolling()
    })
    // allow opening a specific host via focus prop (from topology tree: {focusType:'host', focusId})
    watch(() => props.focus, (f) => {
      if (f && f.focusType === 'host' && f.focusId) openDetail(f.focusId)
      else if (f && f.hostId) openDetail(f.hostId)
    }, { immediate: true })

    // ---- maintenance toggle ----
    const maintBusy = ref(0)
    const blockDlg = reactive({ open: false, title: '', message: '', children: [], host: null })
    const toggleMaintenance = async (h) => {
      maintBusy.value = h.id
      try {
        const res = await api('/hosts/' + h.id + '/maintenance', { method: 'POST', body: JSON.stringify({ enabled: h.status !== 'maintenance' }) })
        if (res && res.error) {
          // N3：进入维护时仍有运行中虚拟机 → 提示必须先完整迁移
          blockDlg.open = true; blockDlg.title = t('hctx_maint_block_title'); blockDlg.host = h
          blockDlg.message = t('hctx_maint_block_msg', { n: (res.children || []).length })
          blockDlg.children = res.children || []
          return
        }
        toast(res.message, 'success')
        await store.fetchAll()
        if (selectedId.value === h.id) await openDetail(h.id)
      } catch (e) { toast(t('op_failed'), 'error') } finally { maintBusy.value = 0 }
    }
    // 阻止对话框 → 前往迁移中心（虚拟机列表）
    const gotoMigrate = () => {
      blockDlg.open = false
      window.dispatchEvent(new CustomEvent('cnf:goto', { detail: { module: 'compute', tab: 'vms' } }))
    }

    // ============================================================
    //  N3 · 主机右键上下文菜单（电源/维护/网络与配置）
    // ============================================================
    const hostCtx = window.useContextMenu()
    const onHostCtxAction = async ({ command, host }) => {
      if (!host) return
      if (command === 'open_detail') return openDetail(host.id)
      if (command === 'edit_network') return openNetEdit(host)
      if (command === 'enter_maintenance') return toggleMaintenance(host)
      if (command === 'exit_maintenance') return toggleMaintenance(host)
      if (command === 'remove') return removeHostCtx(host)
      if (command === 'power_on' || command === 'reboot' || command === 'shutdown') {
        if (command === 'shutdown' && !confirm(t('hctx_shutdown_confirm', { name: host.name }))) return
        const res = await api('/hosts/' + host.id + '/power', { method: 'POST', body: JSON.stringify({ action: command }) })
        if (res && res.error) return toast(res.error, 'error')
        toast(res.message || t('toast_success'), 'success')
        await store.fetchAll()
        if (selectedId.value === host.id) await openDetail(host.id)
      }
    }
    const removeHostCtx = async (host) => {
      const res = await store.removeHost(host.id)
      if (!res.ok) { blockDlg.open = true; blockDlg.title = t('del_blocked_title'); blockDlg.message = res.error; blockDlg.children = res.children || []; blockDlg.host = null; return }
      toast(t('toast_success'), 'success')
    }

    // ---- detail VM list ----
    const detailHost = computed(() => hosts.value.find((h) => h.id === selectedId.value))
    const detailVMs = computed(() => detailHost.value ? detailHost.value.vms_list || [] : [])

    // ============================================================
    //  P4 · 硬件 → IOMMU/VFIO 直通就绪 + GPU 管理（对标 ESXi/vCenter）
    // ============================================================
    const iommuBusy = ref(false)
    const pciBusy = ref('')
    const gpuBusy = ref(0)
    // 重新拉取硬件（操作后刷新直通状态）
    const reloadHw = async () => { if (selectedId.value) detail.value = await api('/hosts/' + selectedId.value + '/hardware') }
    // 启用 / 禁用主机 IOMMU
    const iommuConfirm = reactive({ open: false, steps: [], title: '' })
    const toggleIommu = async () => {
      if (!detail.value) return
      const enable = !(detail.value.iommu_summary && detail.value.iommu_summary.enabled)
      iommuBusy.value = true
      try {
        const res = await api('/hosts/' + selectedId.value + '/iommu', { method: 'POST', body: JSON.stringify({ enabled: enable }) })
        if (res && res.error) { toast(res.error, 'error'); return }
        await reloadHw()
        iommuConfirm.title = res.message
        iommuConfirm.steps = res.steps || []
        iommuConfirm.open = true
        toast(res.message, 'success')
      } catch (e) { toast(t('op_failed'), 'error') } finally { iommuBusy.value = false }
    }
    // 绑定 / 解绑 PCI 设备到 vfio-pci
    const togglePci = async (p) => {
      const bind = p.passthrough_state === 'host'
      pciBusy.value = p.pci_address
      try {
        const res = await api('/hosts/' + selectedId.value + '/pci/passthrough', { method: 'POST', body: JSON.stringify({ pci_address: p.pci_address, bind }) })
        if (res && res.error) { toast(res.error, 'error'); return }
        await reloadHw()
        toast(res.message, 'success')
      } catch (e) { toast(t('op_failed'), 'error') } finally { pciBusy.value = '' }
    }
    // GPU 模式切换 / 释放
    const switchGpuMode = async (g, mode) => {
      gpuBusy.value = g.id
      try {
        const res = await api('/hosts/' + selectedId.value + '/gpu/' + g.id + '/mode', { method: 'POST', body: JSON.stringify({ mode }) })
        if (res && res.error) { toast(res.error, 'error'); return }
        await Promise.all([reloadHw(), store.fetchAll()])
        toast(res.message, 'success')
      } catch (e) { toast(t('op_failed'), 'error') } finally { gpuBusy.value = 0 }
    }
    const releaseGpu = async (g) => {
      gpuBusy.value = g.id
      try {
        const res = await api('/hosts/' + selectedId.value + '/gpu/' + g.id + '/mode', { method: 'POST', body: JSON.stringify({ release: true }) })
        if (res && res.error) { toast(res.error, 'error'); return }
        await Promise.all([reloadHw(), store.fetchAll()])
        toast(res.message, 'success')
      } catch (e) { toast(t('op_failed'), 'error') } finally { gpuBusy.value = 0 }
    }
    // ---- N5 · SR-IOV 物理网卡 (PF) 启用 / 配置 / 禁用 ----
    const sriovDlg = reactive({ open: false, busy: false, form: {}, errors: {} })
    const openSriovEnable = () => {
      sriovDlg.form = { pf: '', nic_model: (detail.value && detail.value.hostname) ? '' : '', num_vfs: 8, link_gbe: 100 }
      sriovDlg.errors = {}; sriovDlg.open = true
    }
    const saveSriov = async () => {
      const e = {}
      if (sriovDlg.form.num_vfs < 1 || sriovDlg.form.num_vfs > 64) e.num_vfs = t('op_invalid')
      sriovDlg.errors = e
      if (Object.keys(e).length) return
      sriovDlg.busy = true
      try {
        const res = await api('/hosts/' + selectedId.value + '/sriov', { method: 'POST', body: JSON.stringify({ enabled: true, pf: sriovDlg.form.pf || undefined, num_vfs: Number(sriovDlg.form.num_vfs), link_gbe: Number(sriovDlg.form.link_gbe) }) })
        if (res && res.error) { toast(res.error, 'error'); return }
        await reloadHw()
        toast(res.message, 'success'); sriovDlg.open = false
      } finally { sriovDlg.busy = false }
    }
    const disableSriov = async (pf) => {
      const res = await api('/hosts/' + selectedId.value + '/sriov', { method: 'POST', body: JSON.stringify({ enabled: false, pf: pf.pf }) })
      if (res && res.error) return toast(res.error, 'error')
      await reloadHw(); toast(res.message, 'success')
    }

    // PCI 直通状态 → 中文标签 / 颜色
    const ptState = (s) => ({
      in_use: { txt: t('hw_pt_in_use'), color: C.blue, badge: 'apple-badge--running' },
      bound: { txt: t('hw_pt_bound'), color: C.teal, badge: 'apple-badge--warning' },
      host: { txt: t('hw_pt_host'), color: C.gray, badge: 'apple-badge--stopped' },
      'n/a': { txt: t('hw_pt_na'), color: C.gray, badge: 'apple-badge--stopped' },
    }[s] || { txt: s, color: C.gray, badge: 'apple-badge--stopped' })
    const gpuModeText = (m) => (m === 'vgpu' ? t('hw_gpu_vgpu') : t('hw_gpu_passthrough'))

    // 硬件页内联编辑管理网络（替代旧的独立「修改管理网络」反人类弹窗入口）
    const hwNetEdit = reactive({ editing: false, busy: false, form: {}, errors: {} })
    const startHwNetEdit = () => {
      const m = detail.value.mgmt_network || {}
      hwNetEdit.form = { ip: m.ip || '', netmask: m.netmask || '255.255.255.0', gateway: m.gateway || '', mgmt_vlan: m.mgmt_vlan ?? '', mgmt_nic: m.mgmt_nic || 'bond0' }
      hwNetEdit.errors = {}; hwNetEdit.editing = true
    }
    const saveHwNet = async () => {
      const e = {}
      if (!ipv4Re.test(hwNetEdit.form.ip)) e.ip = t('hmn_ip_invalid')
      if (!ipv4Re.test(hwNetEdit.form.netmask)) e.netmask = t('hmn_netmask_invalid')
      if (hwNetEdit.form.gateway && !ipv4Re.test(hwNetEdit.form.gateway)) e.gateway = t('hmn_gateway_invalid')
      const vlan = hwNetEdit.form.mgmt_vlan
      if (vlan !== '' && (Number(vlan) < 0 || Number(vlan) > 4094)) e.mgmt_vlan = t('hmn_vlan_invalid')
      hwNetEdit.errors = e
      if (Object.keys(e).length) return
      hwNetEdit.busy = true
      try {
        const res = await api('/hosts/' + selectedId.value + '/network', { method: 'PUT', body: JSON.stringify(hwNetEdit.form) })
        if (res && res.error) { hwNetEdit.errors = { ip: res.code === 'IP_CONFLICT' ? t('hmn_ip_conflict') : res.error }; return }
        toast(res.message, 'success')
        await Promise.all([reloadHw(), store.fetchAll()])
        hwNetEdit.editing = false
      } catch (err) { toast(t('op_failed'), 'error') } finally { hwNetEdit.busy = false }
    }

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

    // ---- charts (overview tab: CPU/mem rings already; monitor tab: REAL history line) ----
    // 真实监控趋势：进入「监控」页后每隔几秒采集一次 GET /hosts/:id/metrics，
    // 将真实 CPU%/内存% 追加到历史缓冲并重绘曲线。无 Math.random，无伪造数据。
    const monHistory = reactive({ labels: [], cpu: [], mem: [] })
    let monTimer = null
    const destroyCharts = () => { Object.values(charts).forEach((c) => c && c.destroy()); charts = {} }
    const fetchOneMetric = async (id) => {
      try {
        const res = await api('/hosts/' + id + '/metrics')
        if (res && !res.error && res.reachable !== false) return res
      } catch (e) {}
      return null
    }
    const pushMonPoint = (m) => {
      const ts = fmt(new Date(), { mode: 'time' })
      monHistory.labels.push(ts)
      monHistory.cpu.push(m && m.cpu_usage_pct != null ? Math.round(m.cpu_usage_pct * 10) / 10 : null)
      monHistory.mem.push(m && m.mem_usage_pct != null ? Math.round(m.mem_usage_pct * 10) / 10 : null)
      // 仅保留最近 40 个采样点（约 2 分钟 @3s）
      while (monHistory.labels.length > 40) { monHistory.labels.shift(); monHistory.cpu.shift(); monHistory.mem.shift() }
    }
    const renderMonitorChart = async () => {
      if (!window.Chart || !selectedId.value) return
      await nextTick()
      const el = document.getElementById('host-mon-chart')
      if (!el) return
      const sec = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#888'
      if (charts.mon) {
        charts.mon.data.labels = monHistory.labels.slice()
        charts.mon.data.datasets[0].data = monHistory.cpu.slice()
        charts.mon.data.datasets[1].data = monHistory.mem.slice()
        charts.mon.update('none')
        return
      }
      charts.mon = new Chart(el, {
        type: 'line',
        data: { labels: monHistory.labels.slice(), datasets: [
          { label: 'CPU %', data: monHistory.cpu.slice(), borderColor: C.blue, backgroundColor: 'rgba(0,122,255,.12)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0, spanGaps: true },
          { label: t('col_mem') + ' %', data: monHistory.mem.slice(), borderColor: C.indigo, backgroundColor: 'transparent', fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0, spanGaps: true },
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 10, color: sec, font: { size: 12 } } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7, color: '#999', font: { size: 11 } } }, y: { beginAtZero: true, max: 100, grid: { color: 'rgba(120,120,128,.14)' }, ticks: { color: '#999', font: { size: 11 } } } } },
      })
    }
    const startMonitor = async () => {
      stopMonitor()
      monHistory.labels = []; monHistory.cpu = []; monHistory.mem = []
      // 立即取一帧再开始轮询，避免空图
      const first = await fetchOneMetric(selectedId.value)
      pushMonPoint(first); await renderMonitorChart()
      monTimer = setInterval(async () => {
        const m = await fetchOneMetric(selectedId.value)
        pushMonPoint(m); renderMonitorChart()
      }, 3000)
    }
    const stopMonitor = () => { if (monTimer) { clearInterval(monTimer); monTimer = null } }
    watch(detailTab, (nv) => { if (nv === 'monitor') startMonitor(); else { stopMonitor(); destroyCharts() } })

    onMounted(async () => {
      if (!hosts.value.length) await store.fetchAll()
      if (props.tab === 'list' || props.tab === 'management') startMetricsPolling()
    })
    onBeforeUnmount(() => { destroyCharts(); stopMetricsPolling(); stopMonitor(); if (detailMetTimer) clearInterval(detailMetTimer) })

    // 单台主机详情：由列表/管理视图点击进入。只要拿到真实硬件或实时状态任一即展示。
    const showDetailView = computed(() => !!selectedId.value && (!!detail.value || !!liveStatus.value) && !loading.value)
    // 派生真实硬件视图数据（对齐后端 /hardware 实际结构：capabilities + hardware_inventory + probe）
    const hwCaps = computed(() => (detail.value && detail.value.capabilities) || null)
    const hwInv = computed(() => (detail.value && detail.value.hardware_inventory) || null)
    const hwProbe = computed(() => (detail.value && detail.value.probe) || null)
    // 实时指标（详情页 overview 用）：进入详情后单独轮询该主机 /metrics，保证 CPU/内存实时。
    const detailMetric = ref(null)
    let detailMetTimer = null
    const refreshDetailMetric = async () => {
      if (!selectedId.value) return
      const m = await fetchOneMetric(selectedId.value)
      detailMetric.value = m
    }
    watch(showDetailView, (v) => {
      if (v) { refreshDetailMetric(); detailMetTimer = setInterval(refreshDetailMetric, 5000) }
      else if (detailMetTimer) { clearInterval(detailMetTimer); detailMetTimer = null; detailMetric.value = null }
    })

    return {
      props, hosts, filteredHosts, search, statusFilter, statusMeta, openDetail, backToList, addHost,
      selectedId, detail, liveStatus, hwCaps, hwInv, hwProbe, detailMetric, detailTab, loading, showDetailView, detailHost, detailVMs,
      toggleMaintenance, maintBusy, blockDlg, gotoMigrate,
      hostCtx, onHostCtxAction,
      metricsLoading, refreshMetrics, hMetric, pctText, pctWidth, uptimeText,
      clusterGroups, netDlg, openNetEdit, submitNet, pickNic, batchDlg, openBatch, submitBatch,
      bytesRate, utilColor, C, t, fmt,
    }
  },
  template: `
  <div>
    <!-- ====================== ① 主机列表（卡片 · 真实实时负载）====================== -->
    <template v-if="props.tab==='list' && !showDetailView">
      <div class="hmn-intro">
        <div class="hmn-intro-title"><i class="fas fa-server" :style="{color:C.blue}"></i> {{ t('hv_list_title') }}</div>
        <div class="muted">{{ t('hv_list_intro') }}</div>
      </div>
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
        <button class="apple-btn apple-btn--ghost apple-btn--sm" :disabled="metricsLoading" @click="refreshMetrics" :title="t('hv_refresh')">
          <i class="fas fa-rotate" :class="{'fa-spin':metricsLoading}"></i> {{ t('hv_refresh') }}
        </button>
        <span class="muted" style="margin-left:10px">{{ filteredHosts.length }} {{ t('host_machine') }}</span>
      </div>
      <div v-if="!filteredHosts.length" class="apple-card" style="text-align:center;padding:40px"><span class="muted"><i class="fas fa-server"></i> {{ t('hv_no_hosts') }}</span></div>
      <div class="grid grid-3">
        <div class="apple-card host-tile" :class="{'host-tile--maint': h.status==='maintenance'}" v-for="h in filteredHosts" :key="h.id" @click="openDetail(h.id)" @contextmenu="hostCtx.open($event, h)" :title="t('hctx_open_detail')">
          <!-- 维护模式醒目角标：进入维护后卡片有明显视觉变化（呼应「进入维护要有明显变化」）-->
          <div v-if="h.status==='maintenance'" class="ht-maint-ribbon"><i class="fas fa-screwdriver-wrench"></i> {{ t('host_st_maint') }}</div>
          <div class="ht-head">
            <div class="ht-title"><i class="fas fa-server" :style="{color:C.blue}"></i> {{ h.name }} <i class="fas fa-ellipsis-vertical host-ctx-hint" :title="t('hctx_group_config')" @click.stop="hostCtx.open($event, h)"></i></div>
            <span class="apple-badge" :class="statusMeta(h.status).cls"><span class="dot"></span>{{ t(statusMeta(h.status).key) }}</span>
          </div>
          <div class="ht-meta">{{ h.ip }} · {{ h.cluster_name }}</div>
          <div class="ht-cpu">{{ h.cpu_model }}</div>
          <!-- 真实指标：采集中显示提示；不可达显示「—」；有数据显示真实百分比。绝不显示 NaN。 -->
          <div v-if="hMetric(h) && hMetric(h).reachable===false" class="ht-metric-warn muted" style="font-size:12px;padding:10px 0">
            <i class="fas fa-plug-circle-xmark" :style="{color:C.gray}"></i> {{ t('hv_metric_unreachable') }}
          </div>
          <div v-else-if="!hMetric(h) && metricsLoading" class="muted" style="font-size:12px;padding:10px 0">
            <i class="fas fa-spinner fa-spin"></i> {{ t('hv_metric_loading') }}
          </div>
          <div v-else class="ht-bars">
            <div class="ht-bar">
              <div class="flex between"><span class="muted" style="font-size:12px">CPU</span><span class="mono" style="font-size:12px">{{ pctText(hMetric(h) && hMetric(h).cpu_usage_pct) }}</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:pctWidth(hMetric(h) && hMetric(h).cpu_usage_pct)+'%',background:utilColor(pctWidth(hMetric(h) && hMetric(h).cpu_usage_pct))}"></div></div>
            </div>
            <div class="ht-bar">
              <div class="flex between"><span class="muted" style="font-size:12px">{{ t('col_mem') }}</span><span class="mono" style="font-size:12px">{{ pctText(hMetric(h) && hMetric(h).mem_usage_pct) }}</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:pctWidth(hMetric(h) && hMetric(h).mem_usage_pct)+'%',background:utilColor(pctWidth(hMetric(h) && hMetric(h).mem_usage_pct))}"></div></div>
            </div>
          </div>
          <div class="ht-foot">
            <span class="muted"><i class="fas fa-desktop"></i> {{ h.vm_running }}/{{ h.vm_count }} VM</span>
            <span class="muted" v-if="hMetric(h) && hMetric(h).reachable!==false"><i class="fas fa-hard-drive" :style="{color:C.indigo}"></i> {{ pctText(hMetric(h).root_disk_pct) }}</span>
            <div class="spacer"></div>
            <span class="muted" v-if="hMetric(h) && hMetric(h).reachable!==false" style="font-size:11px"><i class="fas fa-clock"></i> {{ uptimeText(hMetric(h).uptime_sec) }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- ====================== ② 主机管理（运维：状态 / 电源 / 维护模式，一行一台）====================== -->
    <template v-else-if="props.tab==='management' && !showDetailView">
      <div class="hmn-intro">
        <div class="hmn-intro-title"><i class="fas fa-screwdriver-wrench" :style="{color:C.orange}"></i> {{ t('hv_mgmt_title') }}</div>
        <div class="muted">{{ t('hv_mgmt_intro') }}</div>
      </div>
      <div class="toolbar">
        <button class="apple-btn apple-btn--primary" @click="addHost"><i class="fas fa-plus"></i> {{ t('hw_add_host') }}</button>
        <div class="toolbar-search"><i class="fas fa-magnifying-glass"></i><input v-model="search" :placeholder="t('host_search_ph')"></div>
        <div class="spacer"></div>
        <button class="apple-btn apple-btn--ghost apple-btn--sm" :disabled="metricsLoading" @click="refreshMetrics" :title="t('hv_refresh')">
          <i class="fas fa-rotate" :class="{'fa-spin':metricsLoading}"></i> {{ t('hv_refresh') }}
        </button>
      </div>
      <div class="apple-card" style="padding:0;overflow-x:auto">
        <table class="apple-table">
          <thead><tr>
            <th>{{ t('hmn_col_host') }}</th><th>{{ t('hmn_col_status') }}</th><th>{{ t('hmn_col_ip') }}</th>
            <th>{{ t('hv_col_cpu') }}</th><th>{{ t('hv_col_mem') }}</th><th>{{ t('hv_col_disk') }}</th>
            <th>{{ t('hv_col_load') }}</th><th>{{ t('hv_col_uptime') }}</th><th style="text-align:right">{{ t('hmn_col_ops') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="h in filteredHosts" :key="h.id">
              <td><strong style="cursor:pointer" @click="openDetail(h.id)">{{ h.name }}</strong><div class="muted" style="font-size:11px">{{ h.cluster_name }}</div></td>
              <td><span class="apple-badge" :class="statusMeta(h.status).cls"><span class="dot"></span>{{ t(statusMeta(h.status).key) }}</span></td>
              <td class="mono">{{ h.ip }}</td>
              <td class="mono"><span :style="{color: hMetric(h)&&hMetric(h).reachable!==false ? utilColor(pctWidth(hMetric(h).cpu_usage_pct)) : ''}">{{ hMetric(h)&&hMetric(h).reachable!==false ? pctText(hMetric(h).cpu_usage_pct) : '—' }}</span></td>
              <td class="mono"><span :style="{color: hMetric(h)&&hMetric(h).reachable!==false ? utilColor(pctWidth(hMetric(h).mem_usage_pct)) : ''}">{{ hMetric(h)&&hMetric(h).reachable!==false ? pctText(hMetric(h).mem_usage_pct) : '—' }}</span></td>
              <td class="mono muted">{{ hMetric(h)&&hMetric(h).reachable!==false ? pctText(hMetric(h).root_disk_pct) : '—' }}</td>
              <td class="mono muted">{{ hMetric(h)&&hMetric(h).reachable!==false ? (hMetric(h).load1!=null?hMetric(h).load1:'—') : '—' }}</td>
              <td class="mono muted" style="font-size:12px">{{ hMetric(h)&&hMetric(h).reachable!==false ? uptimeText(hMetric(h).uptime_sec) : '—' }}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="apple-btn apple-btn--ghost apple-btn--sm" @click="openDetail(h.id)" :title="t('hv_open_detail')"><i class="fas fa-circle-info"></i></button>
                <button class="apple-btn apple-btn--ghost apple-btn--sm" :disabled="maintBusy===h.id" @click="toggleMaintenance(h)">
                  <i v-if="maintBusy===h.id" class="fas fa-spinner fa-spin"></i>
                  <i v-else :class="h.status==='maintenance'?'fas fa-play':'fas fa-wrench'"></i>
                  {{ h.status==='maintenance' ? t('host_exit_maint') : t('host_enter_maint') }}
                </button>
              </td>
            </tr>
            <tr v-if="!filteredHosts.length"><td colspan="9" class="muted" style="text-align:center;padding:18px">{{ t('hv_no_hosts') }}</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ====================== ③ 主机网络（真实网卡 + DHCP/静态切换，一行一台）====================== -->
    <template v-else-if="props.tab==='network' && !showDetailView">
      <div class="hmn-intro">
        <div class="hmn-intro-title"><i class="fas fa-network-wired" :style="{color:C.teal}"></i> {{ t('hv_net_title') }}</div>
        <div class="muted">{{ t('hv_net_intro') }}</div>
      </div>
      <div class="apple-card hmn-cluster-card" v-for="g in clusterGroups" :key="g.cluster_id">
        <div class="hmn-cluster-head">
          <div><i class="fas fa-layer-group" :style="{color:C.indigo}"></i> <strong>{{ g.cluster_name }}</strong>
            <span class="muted" style="margin-left:8px;font-weight:400">· {{ g.hosts.length }} {{ t('hmn_hosts_n') }}</span></div>
        </div>
        <div style="overflow-x:auto">
          <table class="apple-table hmn-table">
            <thead><tr>
              <th>{{ t('hmn_col_host') }}</th><th>{{ t('hmn_col_status') }}</th><th>{{ t('hmn_col_ip') }}</th>
              <th style="text-align:right">{{ t('hmn_col_ops') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="h in g.hosts" :key="h.id">
                <td><strong>{{ h.name }}</strong></td>
                <td><span class="apple-badge" :class="statusMeta(h.status).cls"><span class="dot"></span>{{ t(statusMeta(h.status).key) }}</span></td>
                <td class="mono">{{ h.ip }}</td>
                <td style="text-align:right"><button class="apple-btn apple-btn--secondary apple-btn--sm" @click="openNetEdit(h)"><i class="fas fa-ethernet"></i> {{ t('hv_open_net') }}</button></td>
              </tr>
              <tr v-if="!g.hosts.length"><td colspan="4" class="muted" style="text-align:center;padding:16px">{{ t('hmn_no_hosts') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- ====================== DETAIL（全部真实数据：实时状态 + libvirt 硬件 + 实时监控）====================== -->
    <template v-else>
      <div class="toolbar">
        <button class="apple-btn apple-btn--ghost apple-btn--sm" @click="backToList"><i class="fas fa-arrow-left"></i> {{ t('host_back') }}</button>
        <div class="detail-title"><i class="fas fa-server" :style="{color:C.blue}"></i>
          {{ (liveStatus && liveStatus.hostname) || (detailHost && detailHost.name) }}
          <span class="muted" style="font-weight:400">· {{ detailHost && detailHost.ip }} · {{ detailHost && detailHost.cluster_name }}</span>
          <span v-if="detailHost && detailHost.status==='maintenance'" class="apple-badge apple-badge--warning" style="margin-left:10px"><span class="dot"></span>{{ t('host_st_maint') }}</span>
        </div>
        <div class="spacer"></div>
        <button class="apple-btn" :class="detailHost && detailHost.status==='maintenance' ? 'apple-btn--primary' : 'apple-btn--secondary'" :disabled="maintBusy===selectedId" @click="toggleMaintenance(detailHost)">
          <i v-if="maintBusy===selectedId" class="fas fa-spinner fa-spin"></i>
          <i v-else :class="detailHost && detailHost.status==='maintenance'?'fas fa-play':'fas fa-wrench'"></i>
          {{ detailHost && detailHost.status==='maintenance' ? t('host_exit_maint') : t('host_enter_maint') }}
        </button>
      </div>

      <!-- detail sub-tabs（移除无真实数据源的 HA 页；监控接真实 /metrics）-->
      <div class="seg-tabs">
        <button :class="{active:detailTab==='overview'}" @click="detailTab='overview'"><i class="fas fa-gauge"></i> {{ t('host_tab_overview') }}</button>
        <button :class="{active:detailTab==='hardware'}" @click="detailTab='hardware'"><i class="fas fa-microchip"></i> {{ t('host_tab_hardware') }}</button>
        <button :class="{active:detailTab==='monitor'}" @click="detailTab='monitor'"><i class="fas fa-chart-line"></i> {{ t('host_tab_monitor') }}</button>
        <button :class="{active:detailTab==='vms'}" @click="detailTab='vms'"><i class="fas fa-desktop"></i> {{ t('host_tab_vms') }} ({{ detailVMs.length }})</button>
      </div>

      <!-- OVERVIEW：实时状态 + CPU/内存环 + 操作系统/内核/服务真实信息 -->
      <div v-if="detailTab==='overview'">
        <div v-if="!liveStatus" class="apple-card" style="text-align:center;padding:24px">
          <span class="muted"><i class="fas fa-plug-circle-xmark"></i> {{ t('hv_metric_unreachable') }}</span>
        </div>
        <template v-else>
          <div class="grid grid-3" style="align-items:start">
            <div class="apple-card" style="display:flex;flex-direction:column;align-items:center;gap:10px">
              <div class="muted" style="font-size:13px;font-weight:600">CPU</div>
              <ring-progress :value="Math.round((detailMetric && detailMetric.cpu_usage_pct) || 0)" :color="utilColor((detailMetric && detailMetric.cpu_usage_pct) || 0)" :size="118"/>
              <div class="muted" style="font-size:12px;text-align:center">{{ liveStatus.cpu_cores }} {{ t('host_threads') }} · {{ t('hv_col_load') }} {{ liveStatus.load1 }}</div>
            </div>
            <div class="apple-card" style="display:flex;flex-direction:column;align-items:center;gap:10px">
              <div class="muted" style="font-size:13px;font-weight:600">{{ t('col_mem') }}</div>
              <ring-progress :value="Math.round(liveStatus.mem_usage_pct)" :color="utilColor(liveStatus.mem_usage_pct)" :size="118"/>
              <div class="muted" style="font-size:12px">{{ (liveStatus.mem_used_mb/1024).toFixed(1) }} / {{ (liveStatus.mem_total_mb/1024).toFixed(1) }} GB</div>
            </div>
            <div class="apple-card">
              <div class="info-row"><span>{{ t('host_machine') }}</span><strong>{{ liveStatus.hostname }}</strong></div>
              <div class="info-row"><span>IP</span><strong class="mono">{{ detailHost && detailHost.ip }}</strong></div>
              <div class="info-row"><span>OS</span><strong style="font-size:13px">{{ liveStatus.os_pretty }}</strong></div>
              <div class="info-row"><span>{{ t('hd_kernel') }}</span><strong class="mono" style="font-size:12px">{{ liveStatus.kernel }}</strong></div>
              <div class="info-row"><span>{{ t('hv_col_uptime') }}</span><strong>{{ uptimeText(liveStatus.uptime_sec) }}</strong></div>
              <div class="info-row"><span>{{ t('hv_col_disk') }}</span><strong>{{ Math.round(liveStatus.root_disk_pct) }}%</strong></div>
            </div>
          </div>
          <!-- 真实服务/运维状态：libvirt / KVM / SELinux / 防火墙 / SSH 端口 -->
          <div class="hw-section-title"><i class="fas fa-gears" :style="{color:C.indigo}"></i> {{ t('hd_services') }}</div>
          <div class="apple-card hw-cpu-grid">
            <div><span class="muted">libvirtd</span><strong :style="{color: liveStatus.libvirt_state==='active'?C.green:C.orange}">{{ liveStatus.libvirt_state }}</strong></div>
            <div><span class="muted">KVM {{ t('hd_module') }}</span><strong :style="{color: liveStatus.kvm_loaded?C.green:C.red}">{{ liveStatus.kvm_loaded ? t('hd_loaded') : t('hd_not_loaded') }}</strong></div>
            <div><span class="muted">SELinux</span><strong>{{ liveStatus.selinux }}</strong></div>
            <div><span class="muted">firewalld</span><strong :style="{color: liveStatus.firewalld==='active'?C.green:C.gray}">{{ liveStatus.firewalld }}</strong></div>
            <div><span class="muted">SSH {{ t('hd_port') }}</span><strong class="mono">{{ liveStatus.ssh_port }}</strong></div>
            <div><span class="muted">{{ t('hd_boot_time') }}</span><strong class="mono" style="font-size:12px">{{ liveStatus.boot_time }}</strong></div>
          </div>
          <div v-if="liveStatus.warnings && liveStatus.warnings.length" class="hosts-pick-hint" style="margin-top:10px"><i class="fas fa-triangle-exclamation"></i> {{ liveStatus.warnings.join('；') }}</div>
        </template>
      </div>

      <!-- HARDWARE：真实 libvirt capabilities + SSH 采集的硬件清单（无探测则明确标注）-->
      <div v-else-if="detailTab==='hardware'">
        <div v-if="hwProbe" class="hosts-pick-hint" :style="{marginBottom:'12px', background: hwProbe.status==='verified' ? 'rgba(52,199,89,.10)' : 'rgba(255,149,0,.10)'}">
          <i class="fas" :class="hwProbe.status==='verified'?'fa-circle-check':'fa-triangle-exclamation'"></i>
          {{ hwProbe.status==='verified' ? t('hd_probe_ok') : (t('hd_probe_fail') + (hwProbe.reason ? ('：'+hwProbe.reason) : '')) }}
        </div>

        <!-- 虚拟化能力（libvirt 实时探测）-->
        <div v-if="hwCaps">
          <div class="hw-section-title"><i class="fas fa-microchip" :style="{color:C.blue}"></i> {{ t('hd_virt_caps') }}</div>
          <div class="apple-card hw-cpu-grid">
            <div><span class="muted">{{ t('hw_model') }}</span><strong>{{ hwCaps.cpu_model }}</strong></div>
            <div><span class="muted">{{ t('hw_sockets') }}</span><strong>{{ hwCaps.cpu_sockets }}</strong></div>
            <div><span class="muted">{{ t('hw_cores_socket') }}</span><strong>{{ hwCaps.cpu_cores }}</strong></div>
            <div><span class="muted">{{ t('hd_threads_core') }}</span><strong>{{ hwCaps.cpu_threads }}</strong></div>
            <div><span class="muted">NUMA</span><strong>{{ hwCaps.numa_nodes }}</strong></div>
            <div><span class="muted">{{ t('col_mem') }}</span><strong>{{ (hwCaps.memory_total_mb/1024).toFixed(1) }} GB</strong></div>
            <div><span class="muted">libvirt</span><strong class="mono">{{ hwCaps.libvirt_version }}</strong></div>
            <div><span class="muted">QEMU</span><strong class="mono">{{ hwCaps.qemu_version }}</strong></div>
          </div>
        </div>

        <!-- 硬件清单（纳管时 SSH 采集：网卡 / 磁盘 / GPU）-->
        <template v-if="hwInv">
          <div class="hw-section-title"><i class="fas fa-network-wired" :style="{color:C.green}"></i> {{ t('hw_nics') }}</div>
          <div class="apple-card" style="padding:0;overflow-x:auto">
            <table class="apple-table">
              <thead><tr><th>{{ t('hw_nic_name') }}</th><th>MAC</th><th>{{ t('hw_speed') }}</th></tr></thead>
              <tbody>
                <tr v-for="n in (hwInv.nics||[])" :key="n.name">
                  <td><strong class="mono">{{ n.name }}</strong></td>
                  <td class="mono" style="font-size:12px">{{ n.mac }}</td>
                  <td class="mono">{{ n.speed_mb ? (n.speed_mb/1000)+' Gbps' : '—' }}</td>
                </tr>
                <tr v-if="!(hwInv.nics||[]).length"><td colspan="3" class="muted" style="text-align:center;padding:14px">{{ t('hd_no_data') }}</td></tr>
              </tbody>
            </table>
          </div>

          <div class="hw-section-title"><i class="fas fa-hard-drive" :style="{color:C.indigo}"></i> {{ t('hw_storage_dev') }}</div>
          <div class="apple-card" style="padding:0;overflow-x:auto">
            <table class="apple-table">
              <thead><tr><th>{{ t('hw_dev_name') }}</th><th>{{ t('hw_type') }}</th><th>{{ t('hw_capacity') }}</th></tr></thead>
              <tbody>
                <tr v-for="d in (hwInv.disks||[])" :key="d.name">
                  <td><strong class="mono">{{ d.name }}</strong></td>
                  <td><span class="hw-chip">{{ d.rotational ? 'HDD' : 'SSD' }}</span></td>
                  <td class="mono">{{ (d.size_bytes/1000/1000/1000).toFixed(0) }} GB</td>
                </tr>
                <tr v-if="!(hwInv.disks||[]).length"><td colspan="3" class="muted" style="text-align:center;padding:14px">{{ t('hd_no_data') }}</td></tr>
              </tbody>
            </table>
          </div>

          <div v-if="(hwInv.gpus||[]).length">
            <div class="hw-section-title"><i class="fas fa-microchip" :style="{color:'#76b900'}"></i> GPU / {{ t('hw_pci_dev') }}</div>
            <div class="apple-card" style="padding:0;overflow-x:auto">
              <table class="apple-table">
                <thead><tr><th>PCI</th><th>{{ t('hw_vendor_model') }}</th></tr></thead>
                <tbody>
                  <tr v-for="g in hwInv.gpus" :key="g.pci_address">
                    <td class="mono" style="font-size:12px">{{ g.pci_address }}</td>
                    <td>{{ g.vendor }} {{ g.model }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
        <div v-else class="apple-card" style="text-align:center;padding:24px"><span class="muted">{{ t('hd_no_inventory') }}</span></div>
      </div>

      <!-- MONITOR：真实实时趋势（轮询 /hosts/:id/metrics）-->
      <div v-else-if="detailTab==='monitor'">
        <div class="apple-card mon-chart-card">
          <div class="mc-head"><i class="fas fa-chart-area" :style="{color:C.blue}"></i> {{ t('host_perf_trend') }}
            <span class="muted" style="font-weight:400;font-size:12px;margin-left:8px">{{ t('hd_realtime_note') }}</span>
          </div>
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

    <!-- 单台主机管理网络编辑对话框 —— 真实网卡 + DHCP/静态切换 -->
    <div v-if="netDlg.open" class="modal-mask" @click.self="netDlg.open=false">
      <div class="modal-dialog" style="max-width:640px">
        <div class="modal-head"><i class="fas fa-network-wired" :style="{color:C.teal}"></i> {{ t('hmn_edit_title') }} <span class="muted" style="font-weight:400">· {{ netDlg.host && netDlg.host.name }}</span></div>
        <div class="modal-body">
          <!-- 加载/错误态 -->
          <div v-if="netDlg.loading" class="muted" style="padding:18px;text-align:center"><i class="fas fa-spinner fa-spin"></i> 正在读取主机网卡…</div>
          <div v-else-if="netDlg.loadError" class="form-err" style="padding:12px;background:rgba(255,59,48,.08);border-radius:8px"><i class="fas fa-triangle-exclamation"></i> {{ netDlg.loadError }}</div>
          <div v-else-if="!netDlg.nics.length" class="muted" style="padding:18px;text-align:center">未发现可配置网卡</div>
          <template v-else>
            <!-- 网卡选择 -->
            <div class="form-row" style="margin-bottom:12px">
              <label class="req">选择网卡</label>
              <select v-model="netDlg.selected" @change="pickNic(netDlg.selected)" class="apple-input" style="width:100%">
                <option v-for="n in netDlg.nics" :key="n.device" :value="n.device">
                  {{ n.device }} · {{ n.type }} · {{ n.mode==='dhcp'?'DHCP':(n.mode==='static'?'静态':n.mode) }}{{ n.ipv4 ? (' · '+n.ipv4) : '' }}
                </option>
              </select>
            </div>
            <!-- 当前网卡真实信息（只读展示 MAC/UUID/状态） -->
            <div v-if="netDlg.selected" class="hnv-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin:6px 0 14px;font-size:13px">
              <div class="hnv-item"><span class="muted">MAC</span> <strong class="mono">{{ (netDlg.nics.find(x=>x.device===netDlg.selected)||{}).mac || '—' }}</strong></div>
              <div class="hnv-item"><span class="muted">状态</span> <strong>{{ (netDlg.nics.find(x=>x.device===netDlg.selected)||{}).state || '—' }}</strong></div>
              <div class="hnv-item" style="grid-column:1/3"><span class="muted">连接 UUID</span> <strong class="mono" style="font-size:11px">{{ (netDlg.nics.find(x=>x.device===netDlg.selected)||{}).conn_uuid || '—' }}</strong></div>
            </div>
            <!-- 模式切换 -->
            <div class="form-row" style="margin-bottom:12px">
              <label>寻址模式</label>
              <div style="display:flex;gap:18px;align-items:center">
                <label style="display:flex;gap:6px;align-items:center;font-weight:500"><input type="radio" value="dhcp" v-model="netDlg.form.mode"> DHCP（自动获取）</label>
                <label style="display:flex;gap:6px;align-items:center;font-weight:500"><input type="radio" value="static" v-model="netDlg.form.mode"> 静态 IP</label>
              </div>
              <div v-if="netDlg.errors.device" class="form-err">{{ netDlg.errors.device }}</div>
            </div>
            <!-- 静态参数 -->
            <div v-if="netDlg.form.mode==='static'" class="form-grid-2">
              <div class="form-row"><label class="req">{{ t('hmn_col_ip') }}</label><input v-model="netDlg.form.ipv4" :class="{invalid:netDlg.errors.ipv4}" placeholder="192.168.1.100"><div v-if="netDlg.errors.ipv4" class="form-err">{{ netDlg.errors.ipv4 }}</div></div>
              <div class="form-row"><label class="req">{{ t('hmn_col_netmask') }}</label><input v-model="netDlg.form.netmask" :class="{invalid:netDlg.errors.netmask}" placeholder="255.255.255.0"><div v-if="netDlg.errors.netmask" class="form-err">{{ netDlg.errors.netmask }}</div></div>
              <div class="form-row"><label>{{ t('hmn_col_gateway') }}</label><input v-model="netDlg.form.gateway" :class="{invalid:netDlg.errors.gateway}" placeholder="192.168.1.1"><div v-if="netDlg.errors.gateway" class="form-err">{{ netDlg.errors.gateway }}</div></div>
              <div class="form-row"><label>DNS</label><input v-model="netDlg.form.dns" placeholder="8.8.8.8, 1.1.1.1"></div>
            </div>
            <div v-else class="muted" style="font-size:13px;padding:8px 0"><i class="fas fa-circle-info"></i> 将清空静态地址，改由 DHCP 自动获取 IP/网关/DNS。</div>
            <!-- 执行步骤回显 -->
            <div v-if="netDlg.steps.length" style="margin-top:12px;padding:10px;background:rgba(52,199,89,.08);border-radius:8px;font-size:12px">
              <div v-for="(s,i) in netDlg.steps" :key="i" class="mono"><i class="fas fa-check" :style="{color:C.green}"></i> {{ s }}</div>
            </div>
            <div class="hosts-pick-hint" style="margin-top:12px;font-size:12px"><i class="fas fa-triangle-exclamation"></i> 修改 IP 可能导致与该主机的连接短暂中断；改完后平台会自动重新读取确认。</div>
          </template>
        </div>
        <div class="modal-foot">
          <button class="apple-btn apple-btn--ghost" @click="netDlg.open=false">{{ t('op_cancel') }}</button>
          <button class="apple-btn apple-btn--primary" :disabled="netDlg.busy || netDlg.loading || !netDlg.nics.length" @click="submitNet"><i v-if="netDlg.busy" class="fas fa-spinner fa-spin"></i> {{ t('op_confirm') }}</button>
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
        <div class="modal-foot">
          <button class="apple-btn apple-btn--ghost" @click="blockDlg.open=false">{{ t('op_close') }}</button>
          <button v-if="blockDlg.host && blockDlg.children.length" class="apple-btn apple-btn--primary" @click="gotoMigrate"><i class="fas fa-right-left"></i> {{ t('hctx_maint_migrate_now') }}</button>
        </div>
      </div>
    </div>

    <!-- N3 主机右键上下文菜单 -->
    <HostContextMenu v-if="hostCtx.visible.value" :host="hostCtx.payload.value" :x="hostCtx.x.value" :y="hostCtx.y.value" @action="onHostCtxAction" @close="hostCtx.close" />
  </div>`,
}

window.__CNF_VIEWS.HostsView = HostsView
})()
