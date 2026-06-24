// =============================================================================
//  模块视图：存储管理 (view-storage.js) — Cloud Nexus Forging v2.0
//  子标签：pools 存储池 / volumes 卷管理 / snapshots 快照树。
//
//  ★ 完整存储添加逻辑（与真实虚拟化平台一致）：
//    存储池(后端，须选类型 + 连接参数 + 集群) ──► 卷(在池上分配的虚拟磁盘) ──► 挂载给 VM
//    · 存储池：3 步向导（选类型 → 连接参数 → 基本信息），支持 local/nfs/iscsi/fc/distributed
//    · 卷管理：创建（选池/格式/容量/总线/挂载VM）+ 删除（运行态约束）
//    · 快照：创建 / 回滚 / 删除（当前快照不可删，二次确认）
//    · 所有删除均含级联/状态约束校验，阻止时弹出说明对话框
// =============================================================================
(function () {
const { ref, reactive, computed, onMounted, watch } = Vue
const api = window.api
const t = window.t
const toast = window.cnfToast
const store = window.cnfTopology

// 存储类型元数据（图标 + 颜色 + 连接参数字段）
const TYPE_META = {
  local:       { icon: 'fa-folder-open',     color: 'var(--color-green)' },
  nfs:         { icon: 'fa-network-wired',    color: 'var(--color-blue)' },
  iscsi:       { icon: 'fa-server',           color: 'var(--color-indigo)' },
  fc:          { icon: 'fa-bolt',             color: 'var(--color-purple)' },
  distributed: { icon: 'fa-cubes',            color: 'var(--color-orange)' },
}
const TYPE_FIELDS = {
  local:       [{ k: 'target_path', label: 'sp_f_target_path', ph: '/var/lib/cnf/images' }],
  nfs:         [{ k: 'nfs_server', label: 'sp_f_nfs_server', ph: '192.168.10.5' }, { k: 'nfs_export', label: 'sp_f_nfs_export', ph: '/export/cnf' }],
  iscsi:       [{ k: 'iscsi_portal', label: 'sp_f_iscsi_portal', ph: '192.168.10.6:3260' }, { k: 'iscsi_iqn', label: 'sp_f_iscsi_iqn', ph: 'iqn.2026-01.com.cnf:target0' }],
  fc:          [{ k: 'fc_wwpn', label: 'sp_f_fc_wwpn', ph: '50:01:43:80:12:34:56:78' }],
  distributed: [{ k: 'dist_monitors', label: 'sp_f_dist_monitors', ph: '192.168.10.7,192.168.10.8' }, { k: 'dist_pool', label: 'sp_f_dist_pool', ph: 'cnf-rbd' }],
}

const StorageView = {
  props: { tab: { type: String, default: 'pools' } },
  setup(props) {
    const pools = ref([])
    const volumes = ref([])
    const snaps = ref([])
    const vms = ref([])
    const clusters = computed(() => store.clusterStats.value)

    // ---- 通用「操作被阻止」对话框（级联/状态约束）----
    const blockDlg = reactive({ open: false, title: '', message: '', children: [] })
    const showBlocked = (msg, children) => { blockDlg.title = t('op_failed') || '操作被阻止'; blockDlg.message = msg; blockDlg.children = children || []; blockDlg.open = true }

    // ---- 通用确认对话框 ----
    const confirmDlg = reactive({ open: false, title: '', message: '', busy: false, onOk: null })
    const askConfirm = (title, message, onOk) => { confirmDlg.title = title; confirmDlg.message = message; confirmDlg.onOk = onOk; confirmDlg.open = true }
    const confirmOk = async () => { if (!confirmDlg.onOk) return; confirmDlg.busy = true; await confirmDlg.onOk(); confirmDlg.busy = false; confirmDlg.open = false }

    // =====================================================================
    //  存储池：3 步创建向导
    // =====================================================================
    const poolWiz = reactive({
      open: false, step: 0, busy: false,
      form: { type: '', cluster_id: null, name: '', capacity_tb: 10, conn: {} },
      errors: {},
    })
    const poolTypes = ['local', 'nfs', 'iscsi', 'fc', 'distributed']
    const openPoolWiz = () => {
      poolWiz.open = true; poolWiz.step = 0; poolWiz.busy = false; poolWiz.errors = {}
      poolWiz.form = { type: '', cluster_id: clusters.value[0]?.id || 1, name: '', capacity_tb: 10, conn: {} }
    }
    const pickType = (type) => { poolWiz.form.type = type; poolWiz.form.conn = {}; poolWiz.errors = {} }
    const currentFields = computed(() => TYPE_FIELDS[poolWiz.form.type] || [])
    const poolNext = () => {
      const e = {}
      if (poolWiz.step === 0) { if (!poolWiz.form.type) e.type = t('op_required') }
      if (poolWiz.step === 1) { currentFields.value.forEach((f) => { if (!poolWiz.form.conn[f.k]) e[f.k] = t('op_required') }) }
      poolWiz.errors = e
      if (Object.keys(e).length) return
      if (poolWiz.step < 2) poolWiz.step++
    }
    const poolPrev = () => { if (poolWiz.step > 0) poolWiz.step-- }
    const createPool = async () => {
      const e = {}
      const name = (poolWiz.form.name || '').trim()
      if (!name) e.name = t('op_required')
      else if (pools.value.find((p) => p.name === name)) e.name = t('op_invalid')
      if (!poolWiz.form.capacity_tb || poolWiz.form.capacity_tb < 1) e.capacity_tb = t('op_invalid')
      poolWiz.errors = e
      if (Object.keys(e).length) return
      poolWiz.busy = true
      const r = await api('/storage-pools', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...poolWiz.form, name }),
      })
      poolWiz.busy = false
      if (r && r.error) return toast(r.error, 'error')
      pools.value = await api('/storage-pools')
      poolWiz.open = false
      toast(r.message, 'success')
    }
    const delPool = (p) => {
      askConfirm(t('sp_delete'), (t('confirm_delete_msg') || '确认删除「{name}」？').replace('{name}', p.name), async () => {
        const r = await api('/storage-pools/' + p.id, { method: 'DELETE' })
        if (r && r.error) { confirmDlg.open = false; return showBlocked(r.error, r.children) }
        pools.value = await api('/storage-pools')
        toast(r.message, 'success')
      })
    }

    // =====================================================================
    //  卷管理 CRUD
    // =====================================================================
    const volDlg = reactive({ open: false, busy: false, form: { name: '', pool: '', format: 'qcow2', size_gb: 40, bus: 'virtio-scsi', vm: '', iops_limit: 0 }, errors: {} })
    const openVolDlg = () => {
      volDlg.errors = {}
      volDlg.form = { name: '', pool: pools.value[0]?.name || '', format: 'qcow2', size_gb: 40, bus: 'virtio-scsi', vm: '', iops_limit: 0 }
      volDlg.open = true
    }
    const createVol = async () => {
      const e = {}
      if (!volDlg.form.name.trim()) e.name = t('op_required')
      else if (volumes.value.find((v) => v.name === volDlg.form.name.trim())) e.name = t('op_invalid')
      if (!volDlg.form.pool) e.pool = t('op_required')
      if (!volDlg.form.size_gb || volDlg.form.size_gb < 1) e.size_gb = t('op_invalid')
      volDlg.errors = e
      if (Object.keys(e).length) return
      volDlg.busy = true
      const r = await api('/volumes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...volDlg.form, name: volDlg.form.name.trim() }),
      })
      volDlg.busy = false
      if (r && r.error) return toast(r.error, 'error')
      volumes.value = await api('/volumes')
      pools.value = await api('/storage-pools')
      volDlg.open = false
      toast(r.message, 'success')
    }
    const delVol = (v) => {
      askConfirm(t('vol_delete'), (t('confirm_delete_msg') || '确认删除「{name}」？').replace('{name}', v.name), async () => {
        const r = await api('/volumes/' + v.id, { method: 'DELETE' })
        if (r && r.error) { confirmDlg.open = false; return showBlocked(r.error, r.children) }
        volumes.value = await api('/volumes')
        pools.value = await api('/storage-pools')
        toast(r.message, 'success')
      })
    }

    // =====================================================================
    //  快照：创建 / 回滚 / 删除
    // =====================================================================
    const snapForm = reactive({ vm: '', name: '', description: '', with_memory: false, quiesce: true })
    const snapBusy = ref(false)
    const grouped = computed(() => {
      const m = {}
      snaps.value.forEach((s) => { (m[s.vm] = m[s.vm] || []).push(s) })
      return Object.entries(m).map(([vm, list]) => ({ vm, list }))
    })
    const createSnap = async () => {
      if (!snapForm.name) return
      snapBusy.value = true
      const r = await api('/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapForm) })
      snapBusy.value = false
      if (r && r.error) return toast(r.error, 'error')
      snaps.value = await api('/snapshots')
      snapForm.name = ''; snapForm.description = ''
      toast(r.message, 'success')
    }
    const revertSnap = (s) => {
      if (s.current) return
      askConfirm(t('snap_rollback'), t('snap_revert_confirm').replace('{vm}', s.vm).replace('{name}', s.name), async () => {
        const r = await api('/snapshots/' + s.id + '/revert', { method: 'POST' })
        if (r && r.error) { confirmDlg.open = false; return toast(r.error, 'error') }
        snaps.value = await api('/snapshots')
        toast(r.message, 'success')
      })
    }
    const delSnap = (s) => {
      if (s.current) return showBlocked(t('snap_del_current'), [])
      askConfirm(t('snap_delete'), t('snap_del_confirm').replace('{name}', s.name), async () => {
        const r = await api('/snapshots/' + s.id, { method: 'DELETE' })
        if (r && r.error) { confirmDlg.open = false; return showBlocked(r.error, r.children) }
        snaps.value = await api('/snapshots')
        toast(r.message, 'success')
      })
    }

    const load = async () => {
      await store.fetchAll()
      if (props.tab === 'pools') pools.value = await api('/storage-pools')
      if (props.tab === 'volumes') {
        volumes.value = await api('/volumes')
        if (!pools.value.length) pools.value = await api('/storage-pools')
        if (!vms.value.length) vms.value = await api('/vms')
      }
      if (props.tab === 'snapshots') {
        snaps.value = await api('/snapshots')
        if (!vms.value.length) { vms.value = await api('/vms'); if (vms.value.length) snapForm.vm = vms.value[0].name }
      }
    }
    onMounted(load)
    watch(() => props.tab, load)

    const typeColor = (ty) => (TYPE_META[ty] || {}).color || 'var(--text-secondary)'
    const typeIcon = (ty) => (TYPE_META[ty] || {}).icon || 'fa-database'
    const typeLabel = (ty) => t('sp_type_' + (ty === 'distributed' ? 'dist' : ty)) || ty

    return {
      props, pools, volumes, snaps, vms, clusters,
      blockDlg, confirmDlg, confirmOk,
      poolWiz, poolTypes, openPoolWiz, pickType, currentFields, poolNext, poolPrev, createPool, delPool,
      volDlg, openVolDlg, createVol, delVol,
      snapForm, snapBusy, grouped, createSnap, revertSnap, delSnap,
      typeColor, typeIcon, typeLabel, t,
    }
  },
  template: `
    <div>
      <!-- ===== pools：存储池（卡片 + 创建向导 + 删除约束）===== -->
      <template v-if="props.tab==='pools'">
        <div class="crud-toolbar">
          <button class="apple-btn apple-btn--primary" @click="openPoolWiz"><i class="fas fa-plus"></i> {{ t('sp_add') }}</button>
          <div class="spacer"></div>
          <span class="muted" style="font-size:13px">{{ pools.length }} {{ t('sp_pools') }}</span>
        </div>
        <div class="grid grid-2">
          <div class="apple-card" v-for="p in pools" :key="p.id">
            <div class="flex between" style="margin-bottom:14px">
              <div>
                <strong><i class="fas" :class="typeIcon(p.type)" :style="{color:typeColor(p.type)}"></i> {{ p.name }}</strong>
                <div class="muted" style="font-size:12px;margin-top:2px">
                  <span class="apple-badge"><i class="fas fa-layer-group"></i> {{ p.cluster_name }}</span>
                  · {{ p.shared?t('st_shared'):t('st_local') }} · {{ p.volume_count }} {{ t('sp_volumes') }}
                </div>
              </div>
              <div class="flex" style="gap:6px;align-items:flex-start">
                <span class="apple-badge" :style="{background:'rgba(0,0,0,0.04)',color:typeColor(p.type)}">{{ typeLabel(p.type) }}</span>
                <button class="icon-btn danger" :title="t('sp_delete')" @click="delPool(p)"><i class="fas fa-trash"></i></button>
              </div>
            </div>
            <div class="flex between" style="margin-bottom:6px"><span class="muted">{{ t('st_capacity') }}</span><span class="mono">{{ p.used_tb }} / {{ p.capacity_tb }} TB（{{ t('sp_free') }} {{ p.free_tb }}）</span></div>
            <div class="usage-bar"><div class="fill" :style="{width:p.usage_pct+'%',background:typeColor(p.type)}"></div></div>
            <div class="gpu-stats" style="margin-top:14px">
              <div class="gpu-stat"><div class="k">{{ t('st_read_iops') }}</div><div class="v">{{ (p.read_iops||0).toLocaleString() }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('st_write_iops') }}</div><div class="v">{{ (p.write_iops||0).toLocaleString() }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('st_latency') }}</div><div class="v">{{ p.latency }} ms</div></div>
              <div class="gpu-stat"><div class="k">{{ t('status') }}</div><div class="v" style="color:var(--color-green);font-size:14px">● {{ t('st_active') }}</div></div>
            </div>
          </div>
          <div v-if="!pools.length" class="apple-card muted" style="text-align:center;padding:32px"><i class="fas fa-inbox"></i> {{ t('op_no_data') }}</div>
        </div>
      </template>

      <!-- ===== volumes：卷管理（创建 + 删除约束）===== -->
      <template v-else-if="props.tab==='volumes'">
        <div class="crud-toolbar">
          <button class="apple-btn apple-btn--primary" :disabled="!pools.length" @click="openVolDlg"><i class="fas fa-plus"></i> {{ t('vol_add') }}</button>
          <div class="spacer"></div>
          <span class="muted" style="font-size:13px">{{ volumes.length }} {{ t('vol_title') }}</span>
        </div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('vol_name') }}</th><th>{{ t('vol_pool') }}</th><th>{{ t('vol_vm') }}</th><th>{{ t('vol_format') }}</th><th>{{ t('vol_size') }}</th><th>{{ t('vol_used') }}</th><th>{{ t('vol_bus') }}</th><th>{{ t('vol_iops') }}</th><th style="width:54px">{{ t('op_actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="v in volumes" :key="v.id">
                <td class="mono"><i class="fas fa-hard-drive" style="color:var(--color-indigo)"></i> {{ v.name }}</td>
                <td class="muted">{{ v.pool }}</td>
                <td>{{ v.vm && v.vm!=='-' ? v.vm : '—' }}</td>
                <td><span class="apple-badge">{{ v.format }}</span></td>
                <td>{{ v.size_gb }} GB</td>
                <td style="width:120px"><div class="usage-bar"><div class="fill" :style="{width:(v.used_gb/v.size_gb*100)+'%',background:'var(--color-blue)'}"></div></div><div class="muted mono" style="font-size:11px;margin-top:2px">{{ v.used_gb }} GB</div></td>
                <td class="mono">{{ v.bus }}</td>
                <td class="mono">{{ v.iops_limit===0 ? t('vol_unlimited') : v.iops_limit.toLocaleString() }}</td>
                <td><button class="icon-btn danger" :title="t('vol_delete')" @click="delVol(v)"><i class="fas fa-trash"></i></button></td>
              </tr>
              <tr v-if="!volumes.length"><td colspan="9" class="empty-row"><i class="fas fa-inbox"></i> {{ t('op_no_data') }}</td></tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== snapshots：快照树（创建 / 回滚 / 删除）===== -->
      <template v-else>
        <div class="grid grid-2">
          <div class="apple-card">
            <h3 style="margin:0 0 16px"><i class="fas fa-camera" style="color:var(--color-purple)"></i> {{ t('snap_create_title') }}</h3>
            <div class="form-row"><label>{{ t('snap_vm') }}</label><select v-model="snapForm.vm"><option v-for="v in vms" :key="v.id" :value="v.name">{{ v.name }} ({{ {running:t('st_running'),paused:t('st_paused'),stopped:t('st_stopped')}[v.status] }})</option></select></div>
            <div class="form-row"><label>{{ t('snap_name') }}</label><input v-model="snapForm.name" :placeholder="t('snap_name_ph')"></div>
            <div class="form-row"><label>{{ t('snap_desc') }}</label><input v-model="snapForm.description" :placeholder="t('snap_desc_ph')"></div>
            <div class="flex" style="gap:18px;margin:14px 0;flex-wrap:wrap">
              <label class="switch-row"><input type="checkbox" v-model="snapForm.with_memory"> {{ t('snap_mem_label') }}</label>
              <label class="switch-row"><input type="checkbox" v-model="snapForm.quiesce"> {{ t('snap_quiesce_label') }}</label>
            </div>
            <div class="info-alert"><i class="fas fa-circle-info"></i> {{ t('snap_info') }}</div>
            <button class="apple-btn apple-btn--primary" style="margin-top:14px" :disabled="snapBusy || !snapForm.name" @click="createSnap"><i v-if="snapBusy" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-camera"></i> {{ snapBusy ? t('snap_creating') : t('snap_create') }}</button>
          </div>
          <div class="apple-card">
            <h3 style="margin:0 0 12px"><i class="fas fa-code-branch" style="color:var(--color-indigo)"></i> {{ t('snap_chain_title') }}</h3>
            <div v-for="g in grouped" :key="g.vm" style="margin-bottom:18px">
              <div style="font-weight:600;margin-bottom:8px"><i class="fas fa-desktop muted"></i> {{ g.vm }}</div>
              <div class="snap-chain">
                <div class="snap-node" v-for="s in g.list" :key="s.id" :class="{current:s.current}">
                  <div class="flex between"><strong>{{ s.name }}</strong><span v-if="s.current" class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('snap_current') }}</span></div>
                  <div class="muted" style="font-size:12px;margin:2px 0">{{ s.description }}</div>
                  <div class="flex" style="gap:6px;flex-wrap:wrap;margin-top:4px">
                    <span class="apple-badge" :class="s.with_memory?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ s.with_memory?t('snap_mem_nvram'):t('snap_disk_only') }}</span>
                    <span v-if="s.quiesce" class="apple-badge apple-badge--warning"><span class="dot"></span>{{ t('snap_quiesced2') }}</span>
                    <span class="mono muted" style="font-size:12px">{{ s.size_gb }}GB · {{ s.created_at }}</span>
                  </div>
                  <div class="flex" style="gap:8px;margin-top:8px">
                    <button class="apple-btn apple-btn--secondary apple-btn--sm" :disabled="s.current" @click="revertSnap(s)"><i class="fas fa-rotate-left"></i> {{ t('snap_rollback') }}</button>
                    <button class="apple-btn apple-btn--ghost apple-btn--sm" :disabled="s.current" @click="delSnap(s)"><i class="fas fa-trash"></i> {{ t('delete') }}</button>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="!grouped.length" class="muted" style="text-align:center;padding:24px"><i class="fas fa-inbox"></i> {{ t('op_no_data') }}</div>
          </div>
        </div>
      </template>

      <!-- ===================== 存储池创建向导（3 步）===================== -->
      <div v-if="poolWiz.open" class="modal-mask" @click.self="!poolWiz.busy && (poolWiz.open=false)">
        <div class="modal-dialog modal-lg">
          <div class="modal-head"><i class="fas fa-database" style="color:var(--color-blue)"></i> {{ t('sp_create_title') }}</div>
          <div class="wiz-steps">
            <div class="wiz-step" v-for="(s,i) in [t('sp_step_type'),t('sp_step_conn'),t('sp_step_basic')]" :key="i" :class="{active:poolWiz.step===i, done:poolWiz.step>i}">
              <span class="wiz-step-dot"><i v-if="poolWiz.step>i" class="fas fa-check"></i><span v-else>{{ i+1 }}</span></span>
              <span class="wiz-step-label">{{ s }}</span>
            </div>
          </div>
          <div class="modal-body" style="min-height:220px">
            <!-- 步骤1：选择类型 -->
            <template v-if="poolWiz.step===0">
              <div class="sp-type-grid">
                <div class="sp-type-card" v-for="ty in poolTypes" :key="ty" :class="{active:poolWiz.form.type===ty}" @click="pickType(ty)">
                  <i class="fas" :class="typeIcon(ty)" :style="{color:typeColor(ty)}"></i>
                  <div class="sp-type-name">{{ typeLabel(ty) }}</div>
                  <div class="sp-type-desc">{{ t('sp_type_' + (ty==='distributed'?'dist':ty) + '_d') }}</div>
                </div>
              </div>
              <div v-if="poolWiz.errors.type" class="form-err">{{ poolWiz.errors.type }}</div>
            </template>
            <!-- 步骤2：连接参数 -->
            <template v-else-if="poolWiz.step===1">
              <div class="info-alert"><i class="fas fa-circle-info"></i> {{ t('sp_conn_hint') }}（{{ typeLabel(poolWiz.form.type) }}）</div>
              <div class="form-row" v-for="f in currentFields" :key="f.k">
                <label>{{ t(f.label) }} <span class="req">*</span></label>
                <input v-model="poolWiz.form.conn[f.k]" :class="{invalid:poolWiz.errors[f.k]}" :placeholder="f.ph" />
                <div v-if="poolWiz.errors[f.k]" class="form-err">{{ poolWiz.errors[f.k] }}</div>
              </div>
            </template>
            <!-- 步骤3：基本信息 -->
            <template v-else>
              <div class="form-row">
                <label>{{ t('sp_name') }} <span class="req">*</span></label>
                <input v-model="poolWiz.form.name" :class="{invalid:poolWiz.errors.name}" :placeholder="t('sp_name_ph')" />
                <div v-if="poolWiz.errors.name" class="form-err">{{ poolWiz.errors.name }}</div>
              </div>
              <div class="form-grid-2">
                <div class="form-row">
                  <label>{{ t('sp_cluster') }}</label>
                  <select v-model="poolWiz.form.cluster_id"><option v-for="c in clusters" :key="c.id" :value="c.id">{{ c.name }}</option></select>
                </div>
                <div class="form-row">
                  <label>{{ t('sp_capacity') }} <span class="req">*</span></label>
                  <input type="number" min="1" v-model.number="poolWiz.form.capacity_tb" :class="{invalid:poolWiz.errors.capacity_tb}" />
                  <div v-if="poolWiz.errors.capacity_tb" class="form-err">{{ poolWiz.errors.capacity_tb }}</div>
                </div>
              </div>
            </template>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="poolWiz.step===0 || poolWiz.busy" @click="poolPrev">{{ t('hw_prev') }}</button>
            <div class="spacer"></div>
            <button class="apple-btn apple-btn--secondary" :disabled="poolWiz.busy" @click="poolWiz.open=false">{{ t('op_cancel') }}</button>
            <button v-if="poolWiz.step<2" class="apple-btn apple-btn--primary" @click="poolNext">{{ t('hw_next') }}</button>
            <button v-else class="apple-btn apple-btn--primary" :disabled="poolWiz.busy" @click="createPool"><i v-if="poolWiz.busy" class="fas fa-spinner fa-spin"></i> {{ t('vol_create') }}</button>
          </div>
        </div>
      </div>

      <!-- ===================== 卷创建对话框 ===================== -->
      <div v-if="volDlg.open" class="modal-mask" @click.self="!volDlg.busy && (volDlg.open=false)">
        <div class="modal-dialog">
          <div class="modal-head"><i class="fas fa-hard-drive" style="color:var(--color-indigo)"></i> {{ t('vol_create_title') }}</div>
          <div class="modal-body">
            <div class="form-row">
              <label>{{ t('vol_name') }} <span class="req">*</span></label>
              <input v-model="volDlg.form.name" :class="{invalid:volDlg.errors.name}" placeholder="web-prod-disk1" />
              <div v-if="volDlg.errors.name" class="form-err">{{ volDlg.errors.name }}</div>
            </div>
            <div class="form-grid-2">
              <div class="form-row">
                <label>{{ t('vol_pool') }} <span class="req">*</span></label>
                <select v-model="volDlg.form.pool" :class="{invalid:volDlg.errors.pool}"><option v-for="p in pools" :key="p.id" :value="p.name">{{ p.name }}（{{ p.free_tb }}TB {{ t('sp_free') }}）</option></select>
              </div>
              <div class="form-row">
                <label>{{ t('vol_format') }}</label>
                <select v-model="volDlg.form.format"><option value="qcow2">qcow2</option><option value="raw">raw</option></select>
              </div>
            </div>
            <div class="form-grid-2">
              <div class="form-row">
                <label>{{ t('vol_size') }} (GB) <span class="req">*</span></label>
                <input type="number" min="1" v-model.number="volDlg.form.size_gb" :class="{invalid:volDlg.errors.size_gb}" />
                <div v-if="volDlg.errors.size_gb" class="form-err">{{ volDlg.errors.size_gb }}</div>
              </div>
              <div class="form-row">
                <label>{{ t('vol_bus') }}</label>
                <select v-model="volDlg.form.bus"><option value="virtio-scsi">virtio-scsi</option><option value="virtio-blk">virtio-blk</option><option value="nvme">nvme</option><option value="sata">sata</option></select>
              </div>
            </div>
            <div class="form-grid-2">
              <div class="form-row">
                <label>{{ t('vol_vm') }}</label>
                <select v-model="volDlg.form.vm"><option value="">{{ t('vol_no_vm') }}</option><option v-for="v in vms" :key="v.id" :value="v.name">{{ v.name }}</option></select>
              </div>
              <div class="form-row">
                <label>{{ t('vol_iops') }}</label>
                <input type="number" min="0" v-model.number="volDlg.form.iops_limit" :placeholder="t('vol_iops_ph')" />
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="volDlg.busy" @click="volDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="volDlg.busy" @click="createVol"><i v-if="volDlg.busy" class="fas fa-spinner fa-spin"></i> {{ t('vol_create') }}</button>
          </div>
        </div>
      </div>

      <!-- ===================== 通用确认对话框 ===================== -->
      <div v-if="confirmDlg.open" class="modal-mask" @click.self="!confirmDlg.busy && (confirmDlg.open=false)">
        <div class="modal-dialog modal-sm">
          <div class="modal-head"><i class="fas fa-triangle-exclamation" style="color:var(--color-orange)"></i> {{ confirmDlg.title }}</div>
          <div class="modal-body"><p>{{ confirmDlg.message }}</p></div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="confirmDlg.busy" @click="confirmDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--danger" :disabled="confirmDlg.busy" @click="confirmOk"><i v-if="confirmDlg.busy" class="fas fa-spinner fa-spin"></i> {{ t('op_confirm') || '确认' }}</button>
          </div>
        </div>
      </div>

      <!-- ===================== 操作被阻止对话框 ===================== -->
      <div v-if="blockDlg.open" class="modal-mask" @click.self="blockDlg.open=false">
        <div class="modal-dialog modal-sm">
          <div class="modal-head"><i class="fas fa-ban" style="color:var(--color-red)"></i> {{ blockDlg.title }}</div>
          <div class="modal-body">
            <p>{{ blockDlg.message }}</p>
            <div v-if="blockDlg.children.length" class="block-children">
              <span class="apple-badge" v-for="(ch,i) in blockDlg.children" :key="i" style="margin:2px">{{ ch }}</span>
            </div>
          </div>
          <div class="modal-foot"><button class="apple-btn apple-btn--primary" @click="blockDlg.open=false">{{ t('close') }}</button></div>
        </div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.StorageView = StorageView
})()
