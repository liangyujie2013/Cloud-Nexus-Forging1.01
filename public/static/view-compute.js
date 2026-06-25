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
    const editDlg = reactive({ open: false, mode: 'edit', busy: false, vm: null, form: { name: '', vcpus: 1, mem_gb: 1 }, errors: {} })

    // ---- 虚拟机迁移对话框（体现集群约束：目标只能是同集群在线主机）----
    const migDlg = reactive({ open: false, busy: false, vm: null, targets: [], targetId: null })

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

    // ---- 虚拟机迁移：核心集群约束 ----
    //  目标主机列表只显示「同集群内的其他在线非维护主机」（store.getMigrationTargets）。
    const openMigrate = async (vm) => {
      // 确保 store 已加载层级数据（VM 列表、主机、集群血缘）
      await store.fetchAll()
      const targets = store.getMigrationTargets(vm.id)
      migDlg.vm = vm
      migDlg.targets = targets
      migDlg.targetId = targets.length ? targets[0].id : null
      migDlg.busy = false
      // 同集群内没有其他可用主机 → 直接提示并不打开对话框
      if (!targets.length) return toast(t('mig_no_target'), 'warning')
      migDlg.open = true
    }
    const doMigrate = async () => {
      if (!migDlg.targetId) return
      migDlg.busy = true
      const target = migDlg.targets.find((h) => h.id === migDlg.targetId)
      toast(t('mig_in_progress').replace('{vm}', migDlg.vm.name).replace('{host}', target ? target.name : ''), 'info')
      const res = await store.migrateVm(migDlg.vm.id, migDlg.targetId)
      migDlg.busy = false
      if (!res.ok) return
      // 同步本地 VM 列表的归属主机（即时一致）
      const local = vms.value.find((v) => v.id === migDlg.vm.id)
      if (local) local.host_id = Number(migDlg.targetId)
      migDlg.open = false
      toast(t('mig_success').replace('{vm}', migDlg.vm.name).replace('{host}', target ? target.name : ''), 'success')
    }

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
    const openEdit = (vm, mode) => {
      editDlg.mode = mode; editDlg.vm = vm
      editDlg.form = { name: vm.name, vcpus: vm.vcpus, mem_gb: vm.mem_gb }
      editDlg.errors = {}; editDlg.open = true
    }
    const validate = () => {
      const e = {}
      const name = (editDlg.form.name || '').trim()
      if (!name) e.name = t('op_required')
      else if (!/^[A-Za-z0-9\u4e00-\u9fa5._-]{2,40}$/.test(name)) e.name = t('op_invalid')
      if (editDlg.mode === 'edit') {
        if (!editDlg.form.vcpus || editDlg.form.vcpus < 1) e.vcpus = t('op_invalid')
        if (!editDlg.form.mem_gb || editDlg.form.mem_gb < 1) e.mem_gb = t('op_invalid')
      }
      editDlg.errors = e
      return Object.keys(e).length === 0
    }
    const saveEdit = async () => {
      if (!validate()) return
      editDlg.busy = true
      await new Promise((r) => setTimeout(r, 400))
      const target = vms.value.find((v) => v.id === editDlg.vm.id)
      if (target) {
        target.name = editDlg.form.name.trim()
        if (editDlg.mode === 'edit') { target.vcpus = Number(editDlg.form.vcpus); target.mem_gb = Number(editDlg.form.mem_gb) }
      }
      editDlg.busy = false; editDlg.open = false
      toast(t('toast_saved'), 'success')
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
      editDlg, openEdit, saveEdit,
      migDlg, openMigrate, doMigrate,
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
        <div class="modal-dialog">
          <div class="modal-head"><i class="fas fa-sliders"></i> {{ editDlg.mode==='rename' ? t('ctx_rename') : t('ctx_edit_settings') }} · {{ editDlg.vm.name }}</div>
          <div class="modal-body">
            <div class="form-row">
              <label>{{ t('col_name') }} <span class="req">*</span></label>
              <input v-model="editDlg.form.name" :class="{invalid:editDlg.errors.name}" :placeholder="t('col_name')" />
              <div v-if="editDlg.errors.name" class="form-err">{{ editDlg.errors.name }}</div>
            </div>
            <template v-if="editDlg.mode==='edit'">
              <div class="form-row">
                <label>vCPU <span class="req">*</span></label>
                <input type="number" min="1" max="128" v-model.number="editDlg.form.vcpus" :class="{invalid:editDlg.errors.vcpus}" />
                <div v-if="editDlg.errors.vcpus" class="form-err">{{ editDlg.errors.vcpus }}</div>
              </div>
              <div class="form-row">
                <label>{{ t('col_mem') }} (GB) <span class="req">*</span></label>
                <input type="number" min="1" max="2048" v-model.number="editDlg.form.mem_gb" :class="{invalid:editDlg.errors.mem_gb}" />
                <div v-if="editDlg.errors.mem_gb" class="form-err">{{ editDlg.errors.mem_gb }}</div>
              </div>
            </template>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="editDlg.busy" @click="editDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="editDlg.busy" @click="saveEdit">
              <i v-if="editDlg.busy" class="fas fa-spinner fa-spin"></i> {{ t('op_save') }}
            </button>
          </div>
        </div>
      </div>

      <!-- 虚拟机迁移对话框（目标主机列表仅同集群在线主机）-->
      <div v-if="migDlg.open" class="modal-mask" @click.self="!migDlg.busy && (migDlg.open=false)">
        <div class="modal-dialog">
          <div class="modal-head"><i class="fas fa-truck-fast" style="color:var(--color-indigo)"></i> {{ t('mig_title') }} · {{ migDlg.vm.name }}</div>
          <div class="modal-body">
            <div class="info-alert"><i class="fas fa-circle-info"></i> {{ t('mig_same_cluster') }}</div>
            <div class="form-row">
              <label>{{ t('mig_select_target') }} <span class="req">*</span></label>
              <div class="mig-target-list">
                <label class="mig-target" v-for="h in migDlg.targets" :key="h.id"
                       :class="{active: migDlg.targetId===h.id}">
                  <input type="radio" name="mig-target" :value="h.id" v-model="migDlg.targetId" />
                  <div class="mig-target-main">
                    <div class="mig-target-name"><i class="fas fa-server" style="color:var(--color-blue)"></i> <strong>{{ h.name }}</strong>
                      <span class="apple-badge apple-badge--running" style="margin-left:6px"><span class="dot"></span>{{ h.cluster_name }}</span>
                    </div>
                    <div class="mig-target-meta muted">{{ h.ip }} · {{ h.cpu_model }}</div>
                  </div>
                  <div class="mig-target-free">
                    <div><span class="muted">{{ t('mig_cpu_free') }}</span> <strong>{{ 100 - (h.cpu_usage||0) }}%</strong></div>
                    <div><span class="muted">{{ t('mig_mem_free') }}</span> <strong>{{ (h.mem_total_gb||0) - (h.mem_used_gb||0) }} GB</strong></div>
                  </div>
                </label>
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="migDlg.busy" @click="migDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="migDlg.busy || !migDlg.targetId" @click="doMigrate">
              <i v-if="migDlg.busy" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-truck-fast"></i> {{ t('mig_start') }}
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
