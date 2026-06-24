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
        else if (props.tab === 'isos') isos.value = await api('/iso-images')
      } finally { loading.value = false }
    }
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

    return {
      props, vms, templates, isos, loading, ctx, onCtxAction,
      kw, statusFilter, filterOpen, batchOpen, selected, page,
      filtered, paged, pageCount, isSelected, toggleSelect, allChecked, toggleAll, selectedVms,
      confirmDlg, confirmOk, askDelete, batchPower, batchDelete,
      editDlg, openEdit, saveEdit,
      migDlg, openMigrate, doMigrate,
      statusBadge, openWizard, refresh, setFilter, t,
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
          <button class="apple-btn apple-btn--primary"><i class="fas fa-plus"></i> {{ t('tpl_add') }}</button>
        </div>
        <div class="grid grid-2">
          <div class="apple-card" v-for="tp in templates" :key="tp.id">
            <div class="flex between" style="margin-bottom:10px">
              <div><strong>{{ tp.name }}</strong><div class="muted" style="font-size:12px;margin-top:2px"><i class="fas fa-compact-disc"></i> {{ tp.os }}</div></div>
              <button class="apple-btn apple-btn--secondary"><i class="fas fa-rocket"></i> {{ t('tpl_deploy') }}</button>
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

      <!-- ===== isos：ISO 镜像 ===== -->
      <template v-else>
        <div class="toolbar">
          <span class="muted">{{ isos.length }} {{ t('iso_title') }}</span>
          <div class="spacer"></div>
          <button class="apple-btn apple-btn--primary"><i class="fas fa-upload"></i> {{ t('iso_upload') }}</button>
        </div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('name') }}</th><th>{{ t('iso_os_type') }}</th><th>{{ t('iso_size') }}</th><th>{{ t('iso_pool') }}</th><th>{{ t('iso_uploaded') }}</th><th>{{ t('iso_checksum') }}</th></tr></thead>
            <tbody>
              <tr v-for="iso in isos" :key="iso.id">
                <td class="mono"><i class="fas fa-compact-disc" style="color:var(--color-indigo)"></i> {{ iso.name }}</td>
                <td><span class="apple-badge">{{ iso.os_type }}</span></td>
                <td>{{ iso.size_gb }} GB</td>
                <td class="muted">{{ iso.pool }}</td>
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
    </div>`,
}

window.__CNF_VIEWS.ComputeView = ComputeView
})()
