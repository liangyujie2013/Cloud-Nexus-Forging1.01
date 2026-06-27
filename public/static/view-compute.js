// =============================================================================
//  模块视图：计算资源 (view-compute.js)
//  子标签：vms 虚拟机列表 / templates 模板管理 / isos ISO 镜像。
//
//  CRUD 标准化（vms）：
//    · 工具栏 [+新建][批量操作▼][筛选][搜索][刷新]
//    · 多选 + 全选 + 已选计数 + 批量启动/关机/删除
//    · 状态筛选 + 关键字搜索 + 分页
//    · 右键菜单（状态联动禁用 / 危险红 / 快捷键 / Toast 反馈）
//    · 删除二次确认（显示对象名 + 红色危险按钮）
//    · 编辑/重命名对话框（表单校验规则 + loading + Toast）
// =============================================================================
(function () {
const { ref, reactive, computed, onMounted, watch } = Vue
const api = window.api
const t = window.t
const toast = window.cnfToast
const useContextMenu = window.useContextMenu
const store = window.cnfTopology

const PAGE_SIZE = 8

const ComputeView = {
  components: { VMContextMenu: window.__CNF_VIEWS.VMContextMenu },
  props: { tab: { type: String, default: 'vms' }, search: { type: String, default: '' } },
  setup(props) {
    const vms = ref([])
    const templates = ref([])
    const isos = ref([])
    const isoRepos = ref([])          // P9：ISO 镜像仓（存储域）概览
    const isoRepoNote = ref('')       // P9：全局存储/共享范围说明
    const loading = ref(false)

    // ---- 通用右键菜单管理器（智能边界 / ESC / 滚动 / 外部点击关闭）----
    const ctx = useContextMenu()

    // ---- CRUD 状态：搜索 / 筛选 / 选择 / 分页 ----
    const kw = ref('')
    const statusFilter = ref('all')         // all / running / paused / stopped
    const filterOpen = ref(false)
    const batchOpen = ref(false)
    const selected = ref(new Set())
    const page = ref(1)

    // ---- 删除二次确认对话框 ----
    const confirmDlg = reactive({ open: false, title: '', message: '', targets: [], danger: true, busy: false, onOk: null })

    // ---- 编辑/重命名表单对话框 ----
    const editDlg = reactive({ open: false, mode: 'edit', busy: false, loading: false, tab: 'cpu', vm: null, form: { name: '', vcpus: 1, mem_gb: 1 }, config: null, options: null, errors: {} })

    // ---- P10 · 企业级迁移向导（右键 → 数据中心 → 集群 → 主机 → 资源校验 → 冷/热 → 执行）----
    const migDlg = reactive({
      open: false, busy: false, planning: false, vm: null,
      tree: [], info: null,                 // 迁移源信息 + DC/集群/主机树
      dcId: null, clusterId: null, hostId: null,
      mode: 'live',                         // live=热迁移 / cold=冷迁移
      plan: null,                           // 选定目标后的迁移计划
    })

    const load = async () => {
      loading.value = true
      try {
        if (props.tab === 'vms') vms.value = await api('/vms')
        else if (props.tab === 'templates') templates.value = await api('/vm-templates')
        else if (props.tab === 'isos') {
          const [list, repo] = await Promise.all([api('/iso-images'), api('/iso-repositories')])
          isos.value = list
          isoRepos.value = (repo && repo.repositories) || []
          isoRepoNote.value = (repo && repo.note) || ''
        }
      } finally { loading.value = false }
    }
    // P9：共享范围 → 中文标签 / 图标 / 颜色
    const scopeMeta = (s) => ({
      cluster: { txt: t('iso_scope_cluster'), icon: 'fa-share-nodes', color: 'var(--color-green)' },
      host: { txt: t('iso_scope_host'), icon: 'fa-server', color: 'var(--color-orange)' },
      unknown: { txt: t('iso_scope_unknown'), icon: 'fa-circle-question', color: 'var(--text-tertiary)' },
    }[s] || { txt: s, icon: 'fa-circle-question', color: 'var(--text-tertiary)' })
    onMounted(() => load())
    watch(() => props.tab, () => { kw.value = ''; statusFilter.value = 'all'; selected.value = new Set(); page.value = 1; load() })
    // 顶部全局搜索联动
    watch(() => props.search, (s) => { if (props.tab === 'vms' && s) kw.value = s })

    // ---- 过滤 + 分页 ----
    const filtered = computed(() => {
      let list = vms.value
      if (statusFilter.value !== 'all') list = list.filter((v) => v.status === statusFilter.value)
      const q = kw.value.trim().toLowerCase()
      if (q) list = list.filter((v) => (v.name + ' ' + v.os + ' ' + v.ip).toLowerCase().includes(q))
      return list
    })
    const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
    const paged = computed(() => {
      const start = (page.value - 1) * PAGE_SIZE
      return filtered.value.slice(start, start + PAGE_SIZE)
    })
    watch([filtered, pageCount], () => { if (page.value > pageCount.value) page.value = pageCount.value })

    // ---- 多选 ----
    const isSelected = (id) => selected.value.has(id)
    const toggleSelect = (id) => { const s = new Set(selected.value); s.has(id) ? s.delete(id) : s.add(id); selected.value = s }
    const allChecked = computed(() => paged.value.length > 0 && paged.value.every((v) => selected.value.has(v.id)))
    const toggleAll = () => {
      const s = new Set(selected.value)
      if (allChecked.value) paged.value.forEach((v) => s.delete(v.id))
      else paged.value.forEach((v) => s.add(v.id))
      selected.value = s
    }
    const selectedVms = computed(() => vms.value.filter((v) => selected.value.has(v.id)))

    // ---- 电源指令（单台）----
    const powerCmds = { power_on: 'start', shutdown: 'shutdown', reboot: 'reboot', suspend: 'suspend', resume: 'resume', power_off: 'poweroff' }
    const doPower = async (vm, command) => {
      try {
        const res = await api('/vms/' + vm.id + '/power', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: powerCmds[command] }),
        })
        const target = vms.value.find((v) => v.id === vm.id)
        if (target) target.status = res.status
        toast(`「${vm.name}」${res.message}`, 'success')
      } catch (e) { toast(`「${vm.name}」${t('toast_failed')}`, 'error') }
    }

    // ---- 右键菜单命令分发 ----
    const onCtxAction = async ({ command, vm }) => {
      if (powerCmds[command]) return doPower(vm, command)
      if (command === 'delete') return askDelete([vm])
      if (command === 'rename' || command === 'edit_settings') return openEdit(vm, command === 'rename' ? 'rename' : 'edit')
      if (command === 'migrate') return openMigrate(vm)
      toast(`「${vm.name}」：${t('ctx_' + command)}（原型演示）`, 'info')
    }

    // ---- P10 · 迁移向导：打开 → 拉取「数据中心 → 集群 → 主机」目标树 ----
    const openMigrate = async (vm) => {
      migDlg.vm = vm
      migDlg.tree = []; migDlg.info = null; migDlg.plan = null
      migDlg.dcId = null; migDlg.clusterId = null; migDlg.hostId = null
      migDlg.busy = false; migDlg.planning = false
      migDlg.open = true
      const info = await api('/vms/' + vm.id + '/migration-targets')
      if (info && info.error) { migDlg.open = false; return toast(info.error, 'error') }
      migDlg.info = info
      migDlg.tree = info.tree || []
      migDlg.mode = info.can_live ? 'live' : 'cold'   // 停机 VM 只能冷迁移
    }
    // 当前选中数据中心下的集群 / 集群下的主机
    const migClusters = computed(() => {
      const dc = migDlg.tree.find((d) => d.id === migDlg.dcId)
      return dc ? dc.clusters : []
    })
    const migHosts = computed(() => {
      const cl = migClusters.value.find((c) => c.id === migDlg.clusterId)
      return cl ? cl.hosts : []
    })
    // 选择目标主机 → 拉取迁移计划（资源校验 / 冷热 / 共享存储 / 网络路径）
    const pickMigHost = async (h) => {
      if (h.fit === 'unavailable') return
      migDlg.hostId = h.id
      migDlg.planning = true; migDlg.plan = null
      try {
        const plan = await api('/vms/' + migDlg.vm.id + '/migration-plan', { method: 'POST', body: JSON.stringify({ target_host_id: h.id, mode: migDlg.mode }) })
        if (plan && plan.error) { toast(plan.error, 'error'); return }
        migDlg.plan = plan
        if (plan.mode_forced_cold) migDlg.mode = 'cold'
      } finally { migDlg.planning = false }
    }
    // 切换冷/热迁移后重新评估计划
    const setMigMode = async (m) => {
      if (migDlg.plan && migDlg.plan.mode_forced_cold && m === 'live') return
      migDlg.mode = m
      if (migDlg.hostId) await pickMigHost(migHosts.value.find((x) => x.id === migDlg.hostId) || { id: migDlg.hostId, fit: 'ok' })
    }
    // 执行迁移
    const doMigrate = async () => {
      if (!migDlg.hostId || !migDlg.plan || !migDlg.plan.can_migrate) return
      migDlg.busy = true
      const target = migHosts.value.find((h) => h.id === migDlg.hostId)
      toast(t('mig_in_progress').replace('{vm}', migDlg.vm.name).replace('{host}', target ? target.name : ''), 'info')
      try {
        const res = await api('/vms/' + migDlg.vm.id + '/migrate', { method: 'POST', body: JSON.stringify({ target_host_id: migDlg.hostId, mode: migDlg.mode }) })
        if (res && res.error) { toast(res.error, 'error'); return }
        const local = vms.value.find((v) => v.id === migDlg.vm.id)
        if (local) { local.host_id = Number(migDlg.hostId); if (target) { local.cluster_id = target_cluster(); } }
        await store.fetchAll()
        migDlg.open = false
        toast(res.message || t('mig_success').replace('{vm}', migDlg.vm.name).replace('{host}', target ? target.name : ''), 'success')
      } catch (e) { toast(t('toast_failed'), 'error') } finally { migDlg.busy = false }
    }
    const target_cluster = () => migDlg.clusterId
    // 资源匹配徽标
    const fitMeta = (f) => ({
      ok: { txt: t('mig_fit_ok'), color: 'var(--color-green)', icon: 'fa-circle-check' },
      insufficient: { txt: t('mig_fit_insufficient'), color: 'var(--color-orange)', icon: 'fa-triangle-exclamation' },
      unavailable: { txt: t('mig_fit_unavailable'), color: 'var(--text-tertiary)', icon: 'fa-ban' },
    }[f] || { txt: f, color: 'var(--text-tertiary)', icon: 'fa-circle-question' })

    // ---- 删除二次确认 ----
    const askDelete = (targets) => {
      const single = targets.length === 1
      confirmDlg.title = t('confirm_delete_title')
      confirmDlg.message = single
        ? t('confirm_delete_msg').replace('{name}', targets[0].name)
        : t('confirm_batch_delete_msg').replace('{n}', targets.length)
      confirmDlg.targets = targets
      confirmDlg.onOk = async () => {
        confirmDlg.busy = true
        await new Promise((r) => setTimeout(r, 350)) // 原型：模拟后端往返
        const ids = new Set(targets.map((v) => v.id))
        vms.value = vms.value.filter((v) => !ids.has(v.id))
        const s = new Set(selected.value); ids.forEach((id) => s.delete(id)); selected.value = s
        confirmDlg.busy = false
        confirmDlg.open = false
        toast(single ? t('toast_deleted').replace('{name}', targets[0].name) : `${t('toast_success')}（${targets.length}）`, 'success')
      }
      confirmDlg.open = true
    }
    const confirmOk = () => { if (confirmDlg.onOk) confirmDlg.onOk() }

    // ---- 批量操作 ----
    const batchPower = async (command) => {
      batchOpen.value = false
      const list = selectedVms.value
      if (!list.length) return toast(t('op_no_data'), 'warning')
      for (const vm of list) await doPower(vm, command)
    }
    const batchDelete = () => { batchOpen.value = false; if (selectedVms.value.length) askDelete(selectedVms.value); else toast(t('op_no_data'), 'warning') }

    // ---- 编辑/重命名对话框 + 表单校验 ----
    const openEdit = async (vm, mode) => {
      editDlg.mode = mode; editDlg.vm = vm
      editDlg.form = { name: vm.name, vcpus: vm.vcpus, mem_gb: vm.mem_gb }
      editDlg.errors = {}; editDlg.tab = 'cpu'
      editDlg.config = null; editDlg.options = null
      editDlg.open = true
      // 完整编辑：拉取虚拟磁盘 / 网卡 / 引导项 + 可选项
      if (mode === 'edit') {
        editDlg.loading = true
        const res = await api('/vms/' + vm.id + '/hardware')
        editDlg.loading = false
        if (res && res.error) { toast(res.error, 'error'); editDlg.open = false; return }
        editDlg.config = JSON.parse(JSON.stringify(res.config))
        editDlg.options = res.options
        editDlg.form.vcpus = res.vm.vcpus; editDlg.form.mem_gb = res.vm.mem_gb
        editDlg.form.sockets = res.vm.sockets; editDlg.form.cores = res.vm.cores; editDlg.form.threads = res.vm.threads
      }
    }
    const validate = () => {
      const e = {}
      const name = (editDlg.form.name || '').trim()
      if (!name) e.name = t('op_required')
      else if (!/^[A-Za-z0-9\u4e00-\u9fa5._-]{2,40}$/.test(name)) e.name = t('op_invalid')
      if (editDlg.mode === 'edit') {
        if (!editDlg.form.vcpus || editDlg.form.vcpus < 1) e.vcpus = t('op_invalid')
        if (!editDlg.form.mem_gb || editDlg.form.mem_gb < 1) e.mem_gb = t('op_invalid')
        const cfg = editDlg.config
        if (cfg) {
          if (!cfg.disks.length) e.disks = t('vme_err_no_disk')
          for (const n of cfg.nics) { if (n.model === 'sriov' && (!n.sriov_pf || n.sriov_vf == null)) e.nics = t('vme_err_sriov') }
        }
      }
      editDlg.errors = e
      return Object.keys(e).length === 0
    }
    // 虚拟磁盘操作
    const addDisk = () => {
      const cfg = editDlg.config; if (!cfg) return
      const id = Math.max(0, ...cfg.disks.map((d) => d.id)) + 1
      const pool = (editDlg.options.pools[0] && editDlg.options.pools[0].name) || 'prod-nfs-pool'
      cfg.disks.push({ id, name: editDlg.vm.name + '-disk' + cfg.disks.length, pool, format: 'qcow2', size_gb: 40, used_gb: 0, bus: 'virtio-scsi', cache: 'none', iops_limit: 0, boot_order: 0, shareable: false })
    }
    const removeDisk = (i) => { editDlg.config.disks.splice(i, 1) }
    // 网卡操作
    const addNic = () => {
      const cfg = editDlg.config; if (!cfg) return
      const id = Math.max(0, ...cfg.nics.map((n) => n.id)) + 1
      const pg = (editDlg.options.portgroups[0] && editDlg.options.portgroups[0].name) || '业务前端 VLAN'
      cfg.nics.push({ id, model: 'virtio', portgroup: pg, vlan_id: editDlg.options.portgroups[0] ? editDlg.options.portgroups[0].vlan_id : 0, mac: '', connected: true, queues: 4, sriov_pf: '', sriov_vf: null })
    }
    const removeNic = (i) => { editDlg.config.nics.splice(i, 1) }
    // 选择 SR-IOV PF 后，可用 VF 列表
    const pfVfs = (pfName) => {
      const pf = (editDlg.options && editDlg.options.sriov_pfs || []).find((p) => p.pf === pfName)
      return pf ? pf.vfs.filter((v) => !v.used).map((v) => v.vf) : []
    }
    const saveEdit = async () => {
      if (!validate()) return
      editDlg.busy = true
      try {
        if (editDlg.mode === 'rename') {
          const target = vms.value.find((v) => v.id === editDlg.vm.id)
          if (target) target.name = editDlg.form.name.trim()
          // 同步后端（复用 hardware PUT 仅改名）
          await api('/vms/' + editDlg.vm.id + '/hardware', { method: 'PUT', body: JSON.stringify({ vm: { name: editDlg.form.name.trim() } }) })
          toast(t('toast_saved'), 'success'); editDlg.open = false; return
        }
        const cfg = editDlg.config
        const res = await api('/vms/' + editDlg.vm.id + '/hardware', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vm: { name: editDlg.form.name.trim(), vcpus: Number(editDlg.form.vcpus), mem_gb: Number(editDlg.form.mem_gb) }, disks: cfg.disks, nics: cfg.nics, boot: cfg.boot }),
        })
        if (res && res.error) { toast(res.error, 'error'); return }
        const target = vms.value.find((v) => v.id === editDlg.vm.id)
        if (target) { target.name = editDlg.form.name.trim(); target.vcpus = Number(editDlg.form.vcpus); target.mem_gb = Number(editDlg.form.mem_gb) }
        if (res.warnings && res.warnings.length) res.warnings.forEach((w) => toast(w, 'warning'))
        toast(res.message || t('toast_saved'), 'success')
        editDlg.open = false
      } finally { editDlg.busy = false }
    }

    const statusBadge = (s) => ({
      running: { cls: 'apple-badge--running', label: t('st_running') },
      paused: { cls: 'apple-badge--warning', label: t('st_paused') },
      stopped: { cls: 'apple-badge--stopped', label: t('st_stopped') },
    }[s] || { cls: '', label: s })

    const openWizard = () => window.dispatchEvent(new CustomEvent('cnf:open-vm-wizard'))
    const refresh = () => { selected.value = new Set(); load(); toast(t('toast_success'), 'success') }
    const setFilter = (v) => { statusFilter.value = v; filterOpen.value = false; page.value = 1 }

    // =====================================================================
    //  P8 模板管理：新建模板（从停机 VM 转换 / 新建空白）+ 从模板部署（批量）
    // =====================================================================
    const GUEST_OS = [
      'Rocky Linux 9', 'Rocky Linux 8', 'RHEL 9', 'RHEL 8', 'RHEL 10',
      'Ubuntu 22.04', 'Ubuntu 20.04', 'CentOS Stream 9',
      'Windows Server 2022', 'Windows Server 2019', 'Windows 11', 'Windows 10',
    ]
    const hostsRef = ref([])
    const ensureHosts = async () => { if (!hostsRef.value.length) hostsRef.value = await api('/hosts') }

    // ---- 新建模板对话框 ----
    const tplDlg = reactive({
      open: false, busy: false,
      form: { source: 'blank', source_vm_id: null, name: '', os: 'Rocky Linux 9', vcpus: 4, mem_gb: 8, disk_gb: 40, tags: '' },
      errors: {},
    })
    const stoppedVms = computed(() => vms.value.filter((v) => v.status === 'stopped'))
    const openTplCreate = async () => {
      // 需要 VM 列表来支持「从停机 VM 转换」
      if (!vms.value.length) vms.value = await api('/vms')
      tplDlg.form = { source: 'blank', source_vm_id: stoppedVms.value[0]?.id || null, name: '', os: 'Rocky Linux 9', vcpus: 4, mem_gb: 8, disk_gb: 40, tags: '' }
      tplDlg.errors = {}; tplDlg.busy = false; tplDlg.open = true
    }
    // 选择源 VM 时自动带出其规格
    watch(() => tplDlg.form.source_vm_id, (id) => {
      if (tplDlg.form.source !== 'convert' || !id) return
      const vm = vms.value.find((v) => v.id === Number(id))
      if (vm) { tplDlg.form.os = vm.os; tplDlg.form.vcpus = vm.vcpus; tplDlg.form.mem_gb = vm.mem_gb }
    })
    const validateTpl = () => {
      const e = {}
      const name = (tplDlg.form.name || '').trim()
      if (!name) e.name = t('op_required')
      else if (!/^[A-Za-z0-9._-]{2,40}$/.test(name)) e.name = t('op_invalid')
      if (tplDlg.form.source === 'convert' && !tplDlg.form.source_vm_id) e.source_vm_id = t('op_required')
      if (!tplDlg.form.vcpus || tplDlg.form.vcpus < 1) e.vcpus = t('op_invalid')
      if (!tplDlg.form.mem_gb || tplDlg.form.mem_gb < 1) e.mem_gb = t('op_invalid')
      if (!tplDlg.form.disk_gb || tplDlg.form.disk_gb < 1) e.disk_gb = t('op_invalid')
      tplDlg.errors = e
      return Object.keys(e).length === 0
    }
    const saveTpl = async () => {
      if (!validateTpl()) return
      tplDlg.busy = true
      try {
        const tags = (tplDlg.form.tags || '').split(',').map((s) => s.trim()).filter(Boolean)
        const res = await api('/vm-templates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: tplDlg.form.source, source_vm_id: tplDlg.form.source_vm_id,
            name: tplDlg.form.name.trim(), os: tplDlg.form.os, os_type: /win/i.test(tplDlg.form.os) ? 'windows' : 'linux',
            vcpus: Number(tplDlg.form.vcpus), mem_gb: Number(tplDlg.form.mem_gb), disk_gb: Number(tplDlg.form.disk_gb), tags,
          }),
        })
        if (res.error) { toast(res.error, 'error'); return }
        templates.value.unshift(res)
        tplDlg.open = false
        toast(t('tpl_created').replace('{name}', res.name), 'success')
      } catch (e) { toast(t('toast_failed'), 'error') }
      finally { tplDlg.busy = false }
    }

    // ---- 从模板部署对话框 ----
    const deployDlg = reactive({ open: false, busy: false, tpl: null, form: { count: 1, name_prefix: '', host_id: null }, errors: {} })
    const openDeploy = async (tp) => {
      await ensureHosts()
      deployDlg.tpl = tp
      deployDlg.form = { count: 1, name_prefix: tp.name + '-', host_id: hostsRef.value.find((h) => h.status === 'connected')?.id || null }
      deployDlg.errors = {}; deployDlg.busy = false; deployDlg.open = true
    }
    const validateDeploy = () => {
      const e = {}
      const n = Number(deployDlg.form.count)
      if (!n || n < 1 || n > 50) e.count = t('op_invalid')
      if (n > 1 && !(deployDlg.form.name_prefix || '').trim()) e.name_prefix = t('op_required')
      if (!deployDlg.form.host_id) e.host_id = t('op_required')
      deployDlg.errors = e
      return Object.keys(e).length === 0
    }
    const doDeploy = async () => {
      if (!validateDeploy()) return
      deployDlg.busy = true
      try {
        const res = await api('/vm-templates/' + deployDlg.tpl.id + '/deploy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: Number(deployDlg.form.count), name_prefix: deployDlg.form.name_prefix.trim(), host_id: deployDlg.form.host_id }),
        })
        if (res.error) { toast(res.error, 'error'); return }
        const tp = templates.value.find((x) => x.id === deployDlg.tpl.id)
        if (tp) tp.usage_count = (tp.usage_count || 0) + Number(deployDlg.form.count)
        deployDlg.open = false
        toast(t('tpl_deployed').replace('{n}', res.count).replace('{name}', deployDlg.tpl.name), 'success')
      } catch (e) { toast(t('toast_failed'), 'error') }
      finally { deployDlg.busy = false }
    }

    // =====================================================================
    //  P9 ISO 上传：本地文件 / URL 远程下载 + MD5 校验 + 进度反馈
    // =====================================================================
    const isoDlg = reactive({
      open: false, busy: false, progress: 0, phase: '',
      form: { source: 'local', name: '', url: '', os_type: 'Linux', pool: 'prod-nfs-pool', md5: '', size_gb: 0 },
      errors: {},
    })
    const openIsoUpload = () => {
      isoDlg.form = { source: 'local', name: '', url: '', os_type: 'Linux', pool: 'prod-nfs-pool', md5: '', size_gb: 0 }
      isoDlg.errors = {}; isoDlg.busy = false; isoDlg.progress = 0; isoDlg.phase = ''; isoDlg.open = true
    }
    const onIsoFile = (ev) => {
      const f = ev.target.files && ev.target.files[0]
      if (!f) return
      isoDlg.form.name = f.name
      isoDlg.form.size_gb = Math.round((f.size / 1073741824) * 100) / 100
    }
    const validateIso = () => {
      const e = {}
      if (isoDlg.form.source === 'url') {
        const u = (isoDlg.form.url || '').trim()
        if (!u) e.url = t('op_required')
        else if (!/^(https?|ftp):\/\/.+\.iso$/i.test(u)) e.url = t('op_invalid')
      } else {
        if (!(isoDlg.form.name || '').trim()) e.name = t('op_required')
      }
      isoDlg.errors = e
      return Object.keys(e).length === 0
    }
    const submitIso = async () => {
      if (!validateIso()) return
      isoDlg.busy = true; isoDlg.progress = 0
      isoDlg.phase = isoDlg.form.source === 'url' ? t('iso_uploading') : t('iso_uploading')
      // 进度动画（原型：模拟上传/下载 + 校验）
      await new Promise((resolve) => {
        const timer = setInterval(() => {
          isoDlg.progress = Math.min(100, isoDlg.progress + 12 + Math.random() * 10)
          if (isoDlg.progress >= 100) { clearInterval(timer); resolve() }
        }, 180)
      })
      if (isoDlg.form.md5) { isoDlg.phase = t('iso_verifying'); await new Promise((r) => setTimeout(r, 500)) }
      try {
        const res = await api('/iso-images', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...isoDlg.form, size_gb: Number(isoDlg.form.size_gb) || (isoDlg.form.source === 'url' ? 2.0 : 0) }),
        })
        if (res.error) { toast(res.error, 'error'); isoDlg.busy = false; return }
        isos.value.unshift(res)
        isoDlg.open = false
        toast(t('iso_uploaded_ok').replace('{name}', res.name), 'success')
      } catch (e) { toast(t('toast_failed'), 'error') }
      finally { isoDlg.busy = false }
    }

    return {
      props, vms, templates, isos, loading, ctx, onCtxAction,
      kw, statusFilter, filterOpen, batchOpen, selected, page,
      filtered, paged, pageCount, isSelected, toggleSelect, allChecked, toggleAll, selectedVms,
      confirmDlg, confirmOk, askDelete, batchPower, batchDelete,
      editDlg, openEdit, saveEdit, addDisk, removeDisk, addNic, removeNic, pfVfs,
      migDlg, openMigrate, doMigrate, migClusters, migHosts, pickMigHost, setMigMode, fitMeta,
      statusBadge, openWizard, refresh, setFilter, t,
      GUEST_OS, hostsRef, stoppedVms,
      tplDlg, openTplCreate, saveTpl,
      deployDlg, openDeploy, doDeploy,
      isoDlg, openIsoUpload, onIsoFile, submitIso,
      isoRepos, isoRepoNote, scopeMeta,
    }
  },
  template: `
    <div>
      <!-- ===== vms：虚拟机列表（CRUD 标准化）===== -->
      <template v-if="props.tab==='vms'">
        <!-- 标准工具栏：新建 / 批量 / 筛选 / 搜索 / 刷新 -->
        <div class="crud-toolbar">
          <button class="apple-btn apple-btn--primary" @click="openWizard"><i class="fas fa-plus"></i> {{ t('vm_create') }}</button>

          <div class="dropdown">
            <button class="apple-btn apple-btn--secondary" :disabled="!selected.size" @click="batchOpen=!batchOpen">
              <i class="fas fa-layer-group"></i> {{ t('op_batch') }} <i class="fas fa-caret-down"></i>
            </button>
            <div v-if="batchOpen" class="dropdown-menu" @mouseleave="batchOpen=false">
              <button class="menu-row" @click="batchPower('power_on')"><i class="fas fa-play"></i> {{ t('op_batch_start') }}</button>
              <button class="menu-row" @click="batchPower('shutdown')"><i class="fas fa-power-off"></i> {{ t('op_batch_stop') }}</button>
              <div class="ctx-sep"></div>
              <button class="menu-row danger" @click="batchDelete"><i class="fas fa-trash"></i> {{ t('op_batch_delete') }}</button>
            </div>
          </div>

          <div class="dropdown">
            <button class="apple-btn apple-btn--secondary" @click="filterOpen=!filterOpen">
              <i class="fas fa-filter"></i> {{ t('op_filter') }}<span v-if="statusFilter!=='all'" class="filter-dot"></span>
            </button>
            <div v-if="filterOpen" class="dropdown-menu" @mouseleave="filterOpen=false">
              <button class="menu-row" :class="{active:statusFilter==='all'}" @click="setFilter('all')">{{ t('col_status') }}: {{ t('op_select_all') }}</button>
              <button class="menu-row" :class="{active:statusFilter==='running'}" @click="setFilter('running')"><span class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('st_running') }}</span></button>
              <button class="menu-row" :class="{active:statusFilter==='paused'}" @click="setFilter('paused')"><span class="apple-badge apple-badge--warning"><span class="dot"></span>{{ t('st_paused') }}</span></button>
              <button class="menu-row" :class="{active:statusFilter==='stopped'}" @click="setFilter('stopped')"><span class="apple-badge apple-badge--stopped"><span class="dot"></span>{{ t('st_stopped') }}</span></button>
            </div>
          </div>

          <div class="crud-search">
            <i class="fas fa-magnifying-glass"></i>
            <input v-model="kw" :placeholder="t('op_search')" @input="page=1" />
            <i v-if="kw" class="fas fa-circle-xmark clear" @click="kw=''"></i>
          </div>

          <div class="spacer"></div>
          <span v-if="selected.size" class="muted" style="font-size:13px">{{ t('op_selected_n').replace('{n}', selected.size) }}</span>
          <button class="icon-btn" :title="t('op_refresh')" @click="refresh"><i class="fas fa-rotate-right" :class="{spin:loading}"></i></button>
        </div>

        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr>
              <th style="width:38px"><input type="checkbox" :checked="allChecked" @change="toggleAll" /></th>
              <th>{{ t('col_name') }}</th><th>{{ t('col_status') }}</th><th>{{ t('col_cpu') }}</th><th>{{ t('col_mem') }}</th>
              <th>{{ t('col_pin_numa') }}</th><th>{{ t('col_gpu') }}</th><th>{{ t('col_ha') }}</th><th>{{ t('col_ip') }}</th>
              <th>{{ t('col_load') }}</th><th style="width:60px">{{ t('op_actions') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="v in paged" :key="v.id" class="vm-row" :class="{'row-selected':isSelected(v.id)}" @contextmenu="ctx.open($event, v)">
                <td><input type="checkbox" :checked="isSelected(v.id)" @change="toggleSelect(v.id)" @click.stop /></td>
                <td><strong>{{ v.name }}</strong><div class="muted" style="font-size:12px">{{ v.os }}</div></td>
                <td><span class="apple-badge" :class="statusBadge(v.status).cls"><span class="dot"></span>{{ statusBadge(v.status).label }}</span></td>
                <td class="mono">{{ v.sockets }}×{{ v.cores }}×{{ v.threads }} = {{ v.vcpus }}</td>
                <td>{{ v.mem_gb }} GB</td>
                <td><span v-if="v.cpu_pinning" class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('pinned') }}·N{{ v.numa }}</span><span v-else class="muted">—</span></td>
                <td>{{ v.gpus>0 ? v.gpus+' ×' : '—' }}</td>
                <td><i :class="v.ha?'fas fa-shield-halved':'far fa-circle'" :style="{color:v.ha?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
                <td class="mono muted">{{ v.ip }}</td>
                <td style="width:90px"><div class="usage-bar"><div class="fill" :style="{width:v.cpu_usage+'%',background:v.cpu_usage>80?'var(--color-red)':'var(--color-blue)'}"></div></div></td>
                <td><button class="icon-btn" :title="t('op_actions')" @click.stop="ctx.open($event, v)"><i class="fas fa-ellipsis-vertical"></i></button></td>
              </tr>
              <tr v-if="!paged.length"><td colspan="11" class="empty-row"><i class="fas fa-inbox"></i> {{ t('op_no_data') }}</td></tr>
            </tbody>
          </table>
          <!-- 分页 -->
          <div class="crud-pager" v-if="filtered.length">
            <span class="muted">{{ t('op_total_n').replace('{n}', filtered.length) }}</span>
            <div class="spacer"></div>
            <button class="icon-btn" :disabled="page<=1" @click="page--"><i class="fas fa-chevron-left"></i></button>
            <span class="muted" style="font-size:13px">{{ t('op_page_of').replace('{c}', page).replace('{t}', pageCount) }}</span>
            <button class="icon-btn" :disabled="page>=pageCount" @click="page++"><i class="fas fa-chevron-right"></i></button>
          </div>
        </div>
      </template>

      <!-- ===== templates：模板管理 ===== -->
      <template v-else-if="props.tab==='templates'">
        <div class="toolbar">
          <span class="muted">{{ templates.length }} {{ t('tpl_title') }}</span>
          <div class="spacer"></div>
          <button class="apple-btn apple-btn--primary" @click="openTplCreate"><i class="fas fa-plus"></i> {{ t('tpl_add') }}</button>
        </div>
        <div class="grid grid-2">
          <div class="apple-card" v-for="tp in templates" :key="tp.id">
            <div class="flex between" style="margin-bottom:10px">
              <div><strong>{{ tp.name }}</strong><div class="muted" style="font-size:12px;margin-top:2px"><i class="fas fa-compact-disc"></i> {{ tp.os }}</div></div>
              <button class="apple-btn apple-btn--secondary" @click="openDeploy(tp)"><i class="fas fa-rocket"></i> {{ t('tpl_deploy') }}</button>
            </div>
            <div class="muted" style="font-size:13px;margin-bottom:12px">{{ tp.description }}</div>
            <div class="gpu-stats">
              <div class="gpu-stat"><div class="k">{{ t('tpl_spec') }}</div><div class="v">{{ tp.vcpus }} vCPU · {{ tp.mem_gb }}GB · {{ tp.disk_gb }}GB</div></div>
              <div class="gpu-stat"><div class="k">{{ t('tpl_usage') }}</div><div class="v">{{ tp.usage_count }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('tpl_updated') }}</div><div class="v" style="font-size:13px">{{ tp.updated_at }}</div></div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== isos：ISO 镜像（含存储域 / 共享范围说明 P9）===== -->
      <template v-else>
        <!-- 说明横幅：ISO 存哪、谁能用 -->
        <div class="iso-repo-note">
          <i class="fas fa-circle-info"></i>
          <div>
            <strong>{{ t('iso_repo_title') }}</strong>
            <div class="muted" style="margin-top:4px;line-height:1.6">{{ isoRepoNote || t('iso_repo_fallback') }}</div>
          </div>
        </div>

        <!-- 镜像仓（存储域）概览卡片 -->
        <div class="grid grid-3" style="margin-bottom:14px">
          <div class="apple-card iso-repo-card" v-for="r in isoRepos" :key="r.id">
            <div class="irc-head">
              <div class="irc-name"><i class="fas fa-database" style="color:var(--color-indigo)"></i> {{ r.name }}</div>
              <span class="iso-scope-pill" :style="{background:scopeMeta(r.scope).color+'1f',color:scopeMeta(r.scope).color}">
                <i class="fas" :class="scopeMeta(r.scope).icon"></i> {{ scopeMeta(r.scope).txt }}
              </span>
            </div>
            <div class="irc-meta">
              <span class="hw-chip">{{ r.type.toUpperCase() }}</span>
              <span class="muted">{{ r.datacenter_name }} · {{ r.cluster_name }}</span>
            </div>
            <div class="irc-path mono">{{ r.mount_path }}</div>
            <div class="irc-stat"><i class="fas fa-compact-disc"></i> {{ r.iso_count }} {{ t('iso_title') }} · {{ r.used_gb }} GB / {{ r.capacity_tb }} TB</div>
          </div>
        </div>

        <div class="toolbar">
          <span class="muted">{{ isos.length }} {{ t('iso_title') }}</span>
          <div class="spacer"></div>
          <button class="apple-btn apple-btn--primary" @click="openIsoUpload"><i class="fas fa-upload"></i> {{ t('iso_upload') }}</button>
        </div>
        <div class="apple-card" style="padding:0;overflow-x:auto">
          <table class="apple-table">
            <thead><tr><th>{{ t('name') }}</th><th>{{ t('iso_os_type') }}</th><th>{{ t('iso_size') }}</th><th>{{ t('iso_store_domain') }}</th><th>{{ t('iso_scope') }}</th><th>{{ t('iso_visible_hosts') }}</th><th>{{ t('iso_uploaded') }}</th><th>{{ t('iso_checksum') }}</th></tr></thead>
            <tbody>
              <tr v-for="iso in isos" :key="iso.id">
                <td class="mono"><i class="fas fa-compact-disc" style="color:var(--color-indigo)"></i> {{ iso.name }}
                  <div class="muted" style="font-size:11px">{{ iso.pool_path }}</div>
                </td>
                <td><span class="apple-badge">{{ iso.os_type }}</span></td>
                <td>{{ iso.size_gb }} GB</td>
                <td>
                  <div><strong>{{ iso.storage_pool }}</strong> <span class="hw-chip">{{ (iso.pool_type||'').toUpperCase() }}</span></div>
                  <div class="muted" style="font-size:11px">{{ iso.datacenter_name }} · {{ iso.cluster_name }}</div>
                </td>
                <td>
                  <span class="iso-scope-pill" :style="{background:scopeMeta(iso.scope).color+'1f',color:scopeMeta(iso.scope).color}">
                    <i class="fas" :class="scopeMeta(iso.scope).icon"></i> {{ scopeMeta(iso.scope).txt }}
                  </span>
                </td>
                <td class="muted" style="font-size:12px">
                  <span v-if="iso.visible_hosts && iso.visible_hosts.length">{{ iso.visible_hosts.join('、') }}</span>
                  <span v-else>—</span>
                </td>
                <td class="muted">{{ iso.uploaded_at }}</td>
                <td><i :class="iso.checksum_ok?'fas fa-circle-check':'fas fa-circle-xmark'" :style="{color:iso.checksum_ok?'var(--color-green)':'var(--color-red)'}"></i></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 右键菜单 -->
      <VMContextMenu v-if="ctx.visible.value" :vm="ctx.payload.value" :x="ctx.x.value" :y="ctx.y.value" @action="onCtxAction" @close="ctx.close" />

      <!-- 删除二次确认对话框 -->
      <div v-if="confirmDlg.open" class="modal-mask" @click.self="!confirmDlg.busy && (confirmDlg.open=false)">
        <div class="modal-dialog modal-sm">
          <div class="modal-head"><i class="fas fa-triangle-exclamation" style="color:var(--color-red)"></i> {{ confirmDlg.title }}</div>
          <div class="modal-body"><p>{{ confirmDlg.message }}</p></div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="confirmDlg.busy" @click="confirmDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--danger" :disabled="confirmDlg.busy" @click="confirmOk">
              <i v-if="confirmDlg.busy" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-trash"></i> {{ t('op_delete') }}
            </button>
          </div>
        </div>
      </div>

      <!-- 编辑/重命名对话框（表单校验）-->
      <div v-if="editDlg.open" class="modal-mask" @click.self="!editDlg.busy && (editDlg.open=false)">
        <div class="modal-dialog" :class="editDlg.mode==='edit' ? 'modal-lg' : ''">
          <div class="modal-head"><i class="fas fa-sliders"></i> {{ editDlg.mode==='rename' ? t('ctx_rename') : t('vme_title') }} · {{ editDlg.vm.name }}</div>

          <!-- 重命名：极简 -->
          <template v-if="editDlg.mode==='rename'">
            <div class="modal-body">
              <div class="form-row">
                <label>{{ t('col_name') }} <span class="req">*</span></label>
                <input v-model="editDlg.form.name" :class="{invalid:editDlg.errors.name}" :placeholder="t('col_name')" />
                <div v-if="editDlg.errors.name" class="form-err">{{ editDlg.errors.name }}</div>
              </div>
            </div>
          </template>

          <!-- 完整编辑：多页签（硬件/磁盘/网络/引导）对标主流平台「编辑设置」 -->
          <template v-else>
            <div v-if="editDlg.loading" class="modal-body" style="text-align:center;padding:40px"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--text-tertiary)"></i></div>
            <template v-else-if="editDlg.config">
              <div class="vme-tabs">
                <button class="vme-tab" :class="{active:editDlg.tab==='cpu'}" @click="editDlg.tab='cpu'"><i class="fas fa-microchip"></i> {{ t('vme_tab_cpu') }}</button>
                <button class="vme-tab" :class="{active:editDlg.tab==='disk'}" @click="editDlg.tab='disk'"><i class="fas fa-hard-drive"></i> {{ t('vme_tab_disk') }} ({{ editDlg.config.disks.length }})</button>
                <button class="vme-tab" :class="{active:editDlg.tab==='nic'}" @click="editDlg.tab='nic'"><i class="fas fa-ethernet"></i> {{ t('vme_tab_nic') }} ({{ editDlg.config.nics.length }})</button>
                <button class="vme-tab" :class="{active:editDlg.tab==='boot'}" @click="editDlg.tab='boot'"><i class="fas fa-power-off"></i> {{ t('vme_tab_boot') }}</button>
              </div>
              <div class="modal-body vme-body">
                <!-- 硬件资源 -->
                <template v-if="editDlg.tab==='cpu'">
                  <div class="form-row">
                    <label>{{ t('col_name') }} <span class="req">*</span></label>
                    <input v-model="editDlg.form.name" :class="{invalid:editDlg.errors.name}" />
                    <div v-if="editDlg.errors.name" class="form-err">{{ editDlg.errors.name }}</div>
                  </div>
                  <div class="form-grid-2">
                    <div class="form-row"><label>vCPU <span class="req">*</span></label><input type="number" min="1" max="256" v-model.number="editDlg.form.vcpus" :class="{invalid:editDlg.errors.vcpus}" /></div>
                    <div class="form-row"><label>{{ t('col_mem') }} (GB) <span class="req">*</span></label><input type="number" min="1" max="4096" v-model.number="editDlg.form.mem_gb" :class="{invalid:editDlg.errors.mem_gb}" /></div>
                  </div>
                  <div class="vme-hint"><i class="fas fa-circle-info"></i> {{ t('vme_hotplug_hint') }}</div>
                </template>

                <!-- 虚拟磁盘 -->
                <template v-if="editDlg.tab==='disk'">
                  <div v-for="(d,i) in editDlg.config.disks" :key="d.id" class="vme-dev-card">
                    <div class="vme-dev-head"><i class="fas fa-hard-drive"></i> {{ t('vme_disk') }} {{ i }} <span class="muted">· {{ d.size_gb }} GB · {{ d.format }}</span><div class="spacer"></div><button class="icon-btn danger" :disabled="editDlg.config.disks.length<=1" @click="removeDisk(i)"><i class="fas fa-trash"></i></button></div>
                    <div class="form-grid-2">
                      <div class="form-row"><label>{{ t('vme_disk_name') }}</label><input v-model="d.name" /></div>
                      <div class="form-row"><label>{{ t('vme_disk_pool') }}</label><select v-model="d.pool"><option v-for="p in editDlg.options.pools" :key="p.name" :value="p.name">{{ p.name }} ({{ p.shared?t('iso_scope_cluster'):t('iso_scope_host') }})</option></select></div>
                      <div class="form-row"><label>{{ t('vme_disk_size') }} (GB)</label><input type="number" min="1" v-model.number="d.size_gb" /></div>
                      <div class="form-row"><label>{{ t('vme_disk_bus') }}</label><select v-model="d.bus"><option v-for="b in editDlg.options.disk_bus" :key="b" :value="b">{{ b }}</option></select></div>
                      <div class="form-row"><label>{{ t('vme_disk_format') }}</label><select v-model="d.format"><option value="qcow2">qcow2 ({{ t('vme_thin') }})</option><option value="raw">raw ({{ t('vme_thick') }})</option></select></div>
                      <div class="form-row"><label>{{ t('vme_disk_cache') }}</label><select v-model="d.cache"><option value="none">none (Direct I/O)</option><option value="writeback">writeback</option><option value="writethrough">writethrough</option></select></div>
                      <div class="form-row"><label>{{ t('vme_disk_iops') }}</label><input type="number" min="0" v-model.number="d.iops_limit" :placeholder="t('vme_unlimited')" /></div>
                      <div class="form-row" style="justify-content:flex-end"><label class="switch-row"><input type="checkbox" v-model="d.shareable"> {{ t('vme_disk_shareable') }}</label></div>
                    </div>
                  </div>
                  <button class="apple-btn apple-btn--secondary" @click="addDisk"><i class="fas fa-plus"></i> {{ t('vme_add_disk') }}</button>
                  <div v-if="editDlg.errors.disks" class="form-err">{{ editDlg.errors.disks }}</div>
                </template>

                <!-- 网络适配器 -->
                <template v-if="editDlg.tab==='nic'">
                  <div v-for="(n,i) in editDlg.config.nics" :key="n.id" class="vme-dev-card">
                    <div class="vme-dev-head"><i class="fas fa-ethernet"></i> {{ t('vme_nic') }} {{ i }} <span class="muted">· {{ n.model }}</span><div class="spacer"></div><button class="icon-btn danger" @click="removeNic(i)"><i class="fas fa-trash"></i></button></div>
                    <div class="form-grid-2">
                      <div class="form-row"><label>{{ t('vme_nic_model') }}</label><select v-model="n.model"><option value="virtio">virtio (paravirt)</option><option value="e1000e">e1000e</option><option value="rtl8139">rtl8139</option><option value="sriov">SR-IOV (VF 直通)</option></select></div>
                      <div class="form-row" v-if="n.model!=='sriov'"><label>{{ t('vme_nic_portgroup') }}</label><select v-model="n.portgroup"><option v-for="pg in editDlg.options.portgroups" :key="pg.name" :value="pg.name">{{ pg.name }} (VLAN {{ pg.vlan_id }})</option></select></div>
                      <!-- SR-IOV：选择 PF + VF -->
                      <template v-if="n.model==='sriov'">
                        <div class="form-row"><label>{{ t('vme_sriov_pf') }}</label>
                          <select v-model="n.sriov_pf" @change="n.sriov_vf=null">
                            <option value="">{{ t('vme_select') }}</option>
                            <option v-for="pf in editDlg.options.sriov_pfs" :key="pf.pf" :value="pf.pf">{{ pf.pf }} · {{ pf.nic_model }} · {{ pf.link_gbe }}GbE ({{ pf.total_vfs-pf.used_vfs }}/{{ pf.total_vfs }} VF {{ t('vme_free') }})</option>
                          </select>
                          <div v-if="!editDlg.options.sriov_pfs.length" class="form-err">{{ t('vme_sriov_none') }}</div>
                        </div>
                        <div class="form-row"><label>{{ t('vme_sriov_vf') }}</label>
                          <select v-model.number="n.sriov_vf" :disabled="!n.sriov_pf">
                            <option :value="null">{{ t('vme_select') }}</option>
                            <option v-for="vf in pfVfs(n.sriov_pf)" :key="vf" :value="vf">VF {{ vf }}</option>
                          </select>
                        </div>
                      </template>
                      <div class="form-row" v-if="n.model==='virtio'"><label>{{ t('vme_nic_queues') }}</label><input type="number" min="1" max="16" v-model.number="n.queues" /></div>
                      <div class="form-row" style="justify-content:flex-end"><label class="switch-row"><input type="checkbox" v-model="n.connected"> {{ t('vme_nic_connected') }}</label></div>
                    </div>
                  </div>
                  <button class="apple-btn apple-btn--secondary" @click="addNic"><i class="fas fa-plus"></i> {{ t('vme_add_nic') }}</button>
                  <div v-if="editDlg.errors.nics" class="form-err">{{ editDlg.errors.nics }}</div>
                </template>

                <!-- 引导选项 -->
                <template v-if="editDlg.tab==='boot'">
                  <div class="form-grid-2">
                    <div class="form-row"><label>{{ t('vme_firmware') }}</label><select v-model="editDlg.config.boot.firmware"><option value="bios">BIOS (SeaBIOS)</option><option value="uefi">UEFI (OVMF)</option></select></div>
                    <div class="form-row" style="justify-content:flex-end"><label class="switch-row" :class="{disabled:editDlg.config.boot.firmware!=='uefi'}"><input type="checkbox" v-model="editDlg.config.boot.secure_boot" :disabled="editDlg.config.boot.firmware!=='uefi'"> {{ t('vme_secure_boot') }}</label></div>
                  </div>
                  <div class="form-row"><label>{{ t('vme_boot_order') }}</label>
                    <div class="vme-boot-order">
                      <span class="vme-boot-item" v-for="(b,bi) in editDlg.config.boot.boot_order" :key="bi"><i class="fas" :class="b==='disk'?'fa-hard-drive':(b==='cdrom'?'fa-compact-disc':'fa-network-wired')"></i> {{ t('vme_boot_'+b) }}</span>
                    </div>
                  </div>
                  <div class="form-row" style="justify-content:flex-end"><label class="switch-row"><input type="checkbox" v-model="editDlg.config.boot.boot_menu"> {{ t('vme_boot_menu') }}</label></div>
                </template>
              </div>
            </template>
          </template>

          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="editDlg.busy" @click="editDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="editDlg.busy || editDlg.loading" @click="saveEdit">
              <i v-if="editDlg.busy" class="fas fa-spinner fa-spin"></i> {{ t('op_save') }}
            </button>
          </div>
        </div>
      </div>

      <!-- P10 · 企业级迁移向导：数据中心 → 集群 → 主机 → 资源校验 → 冷/热 → 执行 -->
      <div v-if="migDlg.open" class="modal-mask" @click.self="!migDlg.busy && (migDlg.open=false)">
        <div class="modal-dialog modal-lg">
          <div class="modal-head"><i class="fas fa-truck-fast" style="color:var(--color-indigo)"></i> {{ t('mig_title') }} · {{ migDlg.vm.name }}
            <span v-if="migDlg.info" class="muted" style="font-weight:400;margin-left:8px">{{ migDlg.info.vcpus }} vCPU · {{ migDlg.info.mem_gb }} GB<template v-if="migDlg.info.gpus"> · {{ migDlg.info.gpus }} GPU</template></span>
          </div>
          <div class="modal-body" style="max-height:64vh;overflow:auto">
            <div v-if="!migDlg.info" class="muted" style="text-align:center;padding:24px"><i class="fas fa-spinner fa-spin"></i> {{ t('op_loading') }}</div>
            <template v-else>
              <!-- 源信息 + 迁移模式 -->
              <div class="mig-src">
                <div><span class="muted">{{ t('mig_source') }}</span> <strong><i class="fas fa-server" style="color:var(--color-gray)"></i> {{ migDlg.info.source_host }}</strong></div>
                <div class="mig-mode-seg">
                  <button :class="{active:migDlg.mode==='live'}" :disabled="!migDlg.info.can_live || (migDlg.plan && migDlg.plan.mode_forced_cold)" @click="setMigMode('live')"><i class="fas fa-bolt"></i> {{ t('mig_mode_live') }}</button>
                  <button :class="{active:migDlg.mode==='cold'}" @click="setMigMode('cold')"><i class="fas fa-power-off"></i> {{ t('mig_mode_cold') }}</button>
                </div>
              </div>
              <div v-if="!migDlg.info.can_live" class="info-alert" style="margin-top:8px"><i class="fas fa-circle-info"></i> {{ t('mig_cold_only') }}</div>

              <!-- 三级选择：数据中心 / 集群 / 主机 -->
              <div class="mig-pick-grid">
                <div class="mig-col">
                  <div class="mig-col-title">{{ t('mig_pick_dc') }}</div>
                  <div class="mig-opt" v-for="dc in migDlg.tree" :key="dc.id" :class="{active:migDlg.dcId===dc.id}" @click="migDlg.dcId=dc.id; migDlg.clusterId=null; migDlg.hostId=null; migDlg.plan=null">
                    <i class="fas fa-building"></i> {{ dc.name }}
                  </div>
                </div>
                <div class="mig-col">
                  <div class="mig-col-title">{{ t('mig_pick_cluster') }}</div>
                  <div v-if="!migDlg.dcId" class="mig-empty">{{ t('mig_pick_dc_first') }}</div>
                  <div v-else class="mig-opt" v-for="cl in migClusters" :key="cl.id" :class="{active:migDlg.clusterId===cl.id}" @click="migDlg.clusterId=cl.id; migDlg.hostId=null; migDlg.plan=null">
                    <i class="fas fa-layer-group"></i> {{ cl.name }} <span class="muted" style="font-size:11px">· {{ cl.hosts.length }}</span>
                  </div>
                </div>
                <div class="mig-col">
                  <div class="mig-col-title">{{ t('mig_pick_host') }}</div>
                  <div v-if="!migDlg.clusterId" class="mig-empty">{{ t('mig_pick_cluster_first') }}</div>
                  <div v-else-if="!migHosts.length" class="mig-empty">{{ t('mig_no_host') }}</div>
                  <div v-else class="mig-opt mig-host-opt" v-for="h in migHosts" :key="h.id"
                       :class="{active:migDlg.hostId===h.id, disabled:h.fit==='unavailable'}" @click="pickMigHost(h)">
                    <div class="flex between" style="width:100%">
                      <span><i class="fas fa-server"></i> {{ h.name }}</span>
                      <i class="fas" :class="fitMeta(h.fit).icon" :style="{color:fitMeta(h.fit).color}" :title="fitMeta(h.fit).txt"></i>
                    </div>
                    <div class="muted" style="font-size:11px">{{ t('mig_free') }} {{ h.free_vcpus }} vCPU / {{ h.free_mem_gb }} GB</div>
                  </div>
                </div>
              </div>

              <!-- 迁移计划：资源校验 + 范围 + 存储 + 网络路径 -->
              <div v-if="migDlg.planning" class="muted" style="text-align:center;padding:14px"><i class="fas fa-spinner fa-spin"></i> {{ t('mig_planning') }}</div>
              <div v-else-if="migDlg.plan" class="mig-plan">
                <div class="mig-plan-head">
                  <span class="hw-chip"><i class="fas fa-route"></i> {{ migDlg.plan.scope_label }}</span>
                  <span class="hw-chip" :style="{color: migDlg.plan.mode==='live'?'var(--color-green)':'var(--color-orange)'}">{{ migDlg.plan.mode==='live'?t('mig_mode_live'):t('mig_mode_cold') }}</span>
                  <span class="hw-chip">{{ migDlg.plan.shared_storage ? t('mig_shared_storage') : t('mig_storage_migration') }}</span>
                  <span class="muted" style="font-size:12px;margin-left:auto">≈ {{ migDlg.plan.est_seconds }}s</span>
                </div>
                <div v-if="migDlg.plan.cold_reason" class="info-alert" style="margin:6px 0"><i class="fas fa-circle-info"></i> {{ migDlg.plan.cold_reason }}</div>
                <!-- 网络路径 -->
                <div class="mig-netpath">
                  <span class="muted" style="font-size:12px">{{ t('mig_net_path') }}：</span>
                  <template v-for="(p,i) in migDlg.plan.network_path" :key="i">
                    <span class="mig-hop">{{ p }}</span><i v-if="i<migDlg.plan.network_path.length-1" class="fas fa-arrow-right mig-arrow"></i>
                  </template>
                </div>
                <!-- 资源校验清单 -->
                <div class="mig-checks">
                  <div class="mig-check" v-for="ck in migDlg.plan.checks" :key="ck.key">
                    <i class="fas" :class="ck.pass?'fa-circle-check':'fa-triangle-exclamation'" :style="{color:ck.pass?'var(--color-green)':'var(--color-orange)'}"></i>
                    <span class="mig-check-key">{{ t('mig_chk_'+ck.key) }}</span>
                    <span class="muted" style="font-size:12px">{{ ck.detail }}</span>
                  </div>
                </div>
                <div v-if="!migDlg.plan.can_migrate" class="form-err" style="margin-top:8px"><i class="fas fa-ban"></i> {{ t('mig_blocked') }}：{{ migDlg.plan.blockers.join('；') }}</div>
              </div>
            </template>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="migDlg.busy" @click="migDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="migDlg.busy || !migDlg.plan || !migDlg.plan.can_migrate" @click="doMigrate">
              <i v-if="migDlg.busy" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-truck-fast"></i> {{ migDlg.mode==='live'?t('mig_start_live'):t('mig_start_cold') }}
            </button>
          </div>
        </div>
      </div>

      <!-- ===== P8 新建模板对话框（从停机 VM 转换 / 新建空白）===== -->
      <div v-if="tplDlg.open" class="modal-mask" @click.self="!tplDlg.busy && (tplDlg.open=false)">
        <div class="modal-dialog">
          <div class="modal-head"><i class="fas fa-clone" style="color:var(--color-blue)"></i> {{ t('tpl_new_title') }}</div>
          <div class="modal-body">
            <div class="form-row">
              <label>{{ t('tpl_source') }}</label>
              <div class="choice-cards">
                <label class="choice-card" :class="{active:tplDlg.form.source==='blank'}">
                  <input type="radio" value="blank" v-model="tplDlg.form.source" />
                  <div><div class="cc-title"><i class="fas fa-file"></i> {{ t('tpl_src_blank') }}</div><div class="cc-sub muted">{{ t('tpl_src_blank_hint') }}</div></div>
                </label>
                <label class="choice-card" :class="{active:tplDlg.form.source==='convert'}">
                  <input type="radio" value="convert" v-model="tplDlg.form.source" />
                  <div><div class="cc-title"><i class="fas fa-arrow-right-arrow-left"></i> {{ t('tpl_src_convert') }}</div><div class="cc-sub muted">{{ t('tpl_src_convert_hint') }}</div></div>
                </label>
              </div>
            </div>
            <div class="form-row" v-if="tplDlg.form.source==='convert'">
              <label>{{ t('tpl_pick_vm') }} <span class="req">*</span></label>
              <select class="apple-input" v-model="tplDlg.form.source_vm_id" :class="{invalid:tplDlg.errors.source_vm_id}">
                <option v-if="!stoppedVms.length" :value="null" disabled>{{ t('tpl_no_stopped_vm') }}</option>
                <option v-for="v in stoppedVms" :key="v.id" :value="v.id">{{ v.name }} · {{ v.os }} · {{ v.vcpus }}vCPU / {{ v.mem_gb }}GB</option>
              </select>
              <div v-if="tplDlg.errors.source_vm_id" class="form-err">{{ tplDlg.errors.source_vm_id }}</div>
            </div>
            <div class="form-row">
              <label>{{ t('col_name') }} <span class="req">*</span></label>
              <input class="apple-input" v-model="tplDlg.form.name" :class="{invalid:tplDlg.errors.name}" :placeholder="t('tpl_name_ph')" />
              <div v-if="tplDlg.errors.name" class="form-err">{{ tplDlg.errors.name }}</div>
            </div>
            <div class="form-grid-2">
              <div class="form-row">
                <label>{{ t('tpl_guest_os') }}</label>
                <select class="apple-input" v-model="tplDlg.form.os" :disabled="tplDlg.form.source==='convert'">
                  <option v-for="o in GUEST_OS" :key="o" :value="o">{{ o }}</option>
                </select>
              </div>
              <div class="form-row">
                <label>{{ t('tpl_vcpu') }} <span class="req">*</span></label>
                <input class="apple-input" type="number" min="1" max="128" v-model.number="tplDlg.form.vcpus" :class="{invalid:tplDlg.errors.vcpus}" />
              </div>
            </div>
            <div class="form-grid-2">
              <div class="form-row">
                <label>{{ t('tpl_mem') }} <span class="req">*</span></label>
                <input class="apple-input" type="number" min="1" max="2048" v-model.number="tplDlg.form.mem_gb" :class="{invalid:tplDlg.errors.mem_gb}" />
              </div>
              <div class="form-row">
                <label>{{ t('tpl_disk') }} <span class="req">*</span></label>
                <input class="apple-input" type="number" min="1" max="8192" v-model.number="tplDlg.form.disk_gb" :class="{invalid:tplDlg.errors.disk_gb}" />
              </div>
            </div>
            <div class="form-row">
              <label>{{ t('tpl_tags') }}</label>
              <input class="apple-input" v-model="tplDlg.form.tags" :placeholder="t('tpl_tags_ph')" />
            </div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="tplDlg.busy" @click="tplDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="tplDlg.busy" @click="saveTpl">
              <i v-if="tplDlg.busy" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-check"></i> {{ t('op_confirm') }}
            </button>
          </div>
        </div>
      </div>

      <!-- ===== P8 从模板部署对话框（支持批量）===== -->
      <div v-if="deployDlg.open" class="modal-mask" @click.self="!deployDlg.busy && (deployDlg.open=false)">
        <div class="modal-dialog">
          <div class="modal-head"><i class="fas fa-rocket" style="color:var(--color-indigo)"></i> {{ t('tpl_deploy_title') }}</div>
          <div class="modal-body">
            <div class="info-alert"><i class="fas fa-circle-info"></i> {{ t('tpl_deploy_from') }}: <strong>{{ deployDlg.tpl && deployDlg.tpl.name }}</strong> · {{ deployDlg.tpl && deployDlg.tpl.os }} · {{ deployDlg.tpl && deployDlg.tpl.vcpus }}vCPU / {{ deployDlg.tpl && deployDlg.tpl.mem_gb }}GB</div>
            <div class="form-grid-2">
              <div class="form-row">
                <label>{{ t('tpl_deploy_count') }} <span class="req">*</span></label>
                <input class="apple-input" type="number" min="1" max="50" v-model.number="deployDlg.form.count" :class="{invalid:deployDlg.errors.count}" />
                <div v-if="deployDlg.errors.count" class="form-err">{{ deployDlg.errors.count }}</div>
              </div>
              <div class="form-row">
                <label>{{ t('tpl_deploy_host') }} <span class="req">*</span></label>
                <select class="apple-input" v-model="deployDlg.form.host_id" :class="{invalid:deployDlg.errors.host_id}">
                  <option v-for="h in hostsRef" :key="h.id" :value="h.id" :disabled="h.status!=='connected'">{{ h.name }} · {{ h.ip }}{{ h.status!=='connected'?' (不可用)':'' }}</option>
                </select>
                <div v-if="deployDlg.errors.host_id" class="form-err">{{ deployDlg.errors.host_id }}</div>
              </div>
            </div>
            <div class="form-row">
              <label>{{ t('tpl_deploy_prefix') }}<span v-if="deployDlg.form.count>1" class="req"> *</span></label>
              <input class="apple-input" v-model="deployDlg.form.name_prefix" :class="{invalid:deployDlg.errors.name_prefix}" :placeholder="t('tpl_deploy_prefix_ph')" />
              <div v-if="deployDlg.errors.name_prefix" class="form-err">{{ deployDlg.errors.name_prefix }}</div>
              <div class="muted" style="font-size:12px;margin-top:4px" v-if="deployDlg.form.count>1">{{ t('tpl_deploy_batch_hint') }}</div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="deployDlg.busy" @click="deployDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="deployDlg.busy" @click="doDeploy">
              <i v-if="deployDlg.busy" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-rocket"></i> {{ t('tpl_deploy') }}
            </button>
          </div>
        </div>
      </div>

      <!-- ===== P9 ISO 上传对话框（本地/URL + MD5 + 进度）===== -->
      <div v-if="isoDlg.open" class="modal-mask" @click.self="!isoDlg.busy && (isoDlg.open=false)">
        <div class="modal-dialog">
          <div class="modal-head"><i class="fas fa-upload" style="color:var(--color-blue)"></i> {{ t('iso_upload_title') }}</div>
          <div class="modal-body">
            <div class="form-row">
              <div class="choice-cards">
                <label class="choice-card" :class="{active:isoDlg.form.source==='local'}">
                  <input type="radio" value="local" v-model="isoDlg.form.source" :disabled="isoDlg.busy" />
                  <div><div class="cc-title"><i class="fas fa-hard-drive"></i> {{ t('iso_src_local') }}</div></div>
                </label>
                <label class="choice-card" :class="{active:isoDlg.form.source==='url'}">
                  <input type="radio" value="url" v-model="isoDlg.form.source" :disabled="isoDlg.busy" />
                  <div><div class="cc-title"><i class="fas fa-link"></i> {{ t('iso_src_url') }}</div></div>
                </label>
              </div>
            </div>
            <div class="form-row" v-if="isoDlg.form.source==='local'">
              <label>{{ t('iso_local_file') }} <span class="req">*</span></label>
              <input type="file" accept=".iso" @change="onIsoFile" :disabled="isoDlg.busy" />
              <div v-if="isoDlg.form.name" class="muted" style="font-size:12px;margin-top:4px">{{ isoDlg.form.name }}<span v-if="isoDlg.form.size_gb"> · {{ isoDlg.form.size_gb }} GB</span></div>
              <div v-if="isoDlg.errors.name" class="form-err">{{ isoDlg.errors.name }}</div>
            </div>
            <div class="form-row" v-else>
              <label>{{ t('iso_remote_url') }} <span class="req">*</span></label>
              <input class="apple-input" v-model="isoDlg.form.url" :class="{invalid:isoDlg.errors.url}" :placeholder="t('iso_remote_url_ph')" :disabled="isoDlg.busy" />
              <div v-if="isoDlg.errors.url" class="form-err">{{ isoDlg.errors.url }}</div>
            </div>
            <div class="form-grid-2">
              <div class="form-row">
                <label>{{ t('iso_os_type') }}</label>
                <select class="apple-input" v-model="isoDlg.form.os_type" :disabled="isoDlg.busy">
                  <option value="Linux">Linux</option><option value="Windows">Windows</option><option value="Drivers">Drivers</option><option value="Other">Other</option>
                </select>
              </div>
              <div class="form-row">
                <label>{{ t('iso_target_pool') }}</label>
                <select class="apple-input" v-model="isoDlg.form.pool" :disabled="isoDlg.busy">
                  <option v-for="r in isoRepos" :key="r.id" :value="r.name">{{ r.name }} · {{ r.datacenter_name }}/{{ r.cluster_name }} · {{ scopeMeta(r.scope).txt }}</option>
                  <option v-if="!isoRepos.length" value="prod-nfs-pool">prod-nfs-pool</option>
                </select>
                <div class="form-hint" v-for="r in isoRepos.filter(x=>x.name===isoDlg.form.pool)" :key="r.id">
                  <i class="fas" :class="scopeMeta(r.scope).icon" :style="{color:scopeMeta(r.scope).color}"></i>
                  {{ r.scope==='cluster' ? t('iso_hint_cluster') : t('iso_hint_host') }} · {{ r.mount_path }}
                </div>
              </div>
            </div>
            <div class="form-row">
              <label>{{ t('iso_md5') }}</label>
              <input class="apple-input mono" v-model="isoDlg.form.md5" :placeholder="t('iso_md5_ph')" :disabled="isoDlg.busy" />
            </div>
            <div v-if="isoDlg.busy" style="margin-top:6px">
              <div class="flex between" style="margin-bottom:6px"><span class="muted">{{ isoDlg.phase }}</span><span class="mono">{{ Math.round(isoDlg.progress) }}%</span></div>
              <div class="usage-bar" style="height:10px"><div class="fill" :style="{width:isoDlg.progress+'%',background:'var(--color-blue)',transition:'width .2s'}"></div></div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="isoDlg.busy" @click="isoDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="isoDlg.busy" @click="submitIso">
              <i v-if="isoDlg.busy" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-upload"></i> {{ t('iso_upload') }}
            </button>
          </div>
        </div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.ComputeView = ComputeView
})()
