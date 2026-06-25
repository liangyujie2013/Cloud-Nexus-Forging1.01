// =============================================================================
//  模块视图：可用性管理 (view-availability.js)
//  子标签：ha HA 配置（集群 高可用/资源调度/CPU兼容/超分配）/ migration 迁移中心（在线迁移控制台
//          + 历史）/ backup 备份恢复（备份作业列表）。
//  API：/cluster-configs、/migrations(+/progress)、/backup-jobs、/hosts、/vms。
// =============================================================================
(function () {
const { ref, reactive, computed, onMounted, watch } = Vue
const api = window.api
const t = window.t

const AvailabilityView = {
  props: { tab: { type: String, default: 'ha' } },
  setup(props) {
    // ---- HA 配置 ----
    const configs = ref([])
    const sel = ref(null)
    const hosts = ref([])
    const toast = ref('')
    const pick = (c) => { sel.value = JSON.parse(JSON.stringify(c)) }
    const members = computed(() => (sel.value ? hosts.value.filter((h) => h.cluster_id === sel.value.id) : []))
    const saveHA = async () => {
      const r = await api('/cluster-configs/' + sel.value.id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sel.value),
      })
      const i = configs.value.findIndex((c) => c.id === sel.value.id)
      if (i >= 0) configs.value[i] = JSON.parse(JSON.stringify(sel.value))
      showToast(r.message || t('cc_saved'))
    }

    // ---- 迁移中心 ----
    const vms = ref([])
    const history = ref([])
    const form = reactive({ vm: '', dst: '', live: true, storage: false, compressed: true, downtime: 300 })
    const job = reactive({ active: false, progress: 0, phase: '', throughput: 0, remaining: 0, done: false })
    let timer = null
    let startTs = 0
    const selectedVM = computed(() => vms.value.find((v) => v.name === form.vm))
    const gpuBlocked = computed(() => form.live && selectedVM.value && selectedVM.value.gpus > 0)
    const submitMigration = async () => {
      if (!form.vm || !form.dst || gpuBlocked.value) return
      await api('/migrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      job.active = true; job.done = false; job.progress = 0; job.phase = t('mig_phase_precopy')
      startTs = Date.now(); clearInterval(timer); timer = setInterval(poll, 600)
    }
    const poll = async () => {
      const r = await api('/migrations/progress?start=' + startTs)
      job.progress = r.progress; job.phase = r.phase; job.throughput = r.throughput_mbps; job.remaining = r.remaining_mb
      if (r.done) {
        job.done = true; clearInterval(timer)
        history.value.unshift({ id: Date.now(), vm: form.vm, src: t('mig_current_host'), dst: form.dst,
          live: form.live, storage: form.storage, status: 'success', downtime_ms: form.downtime,
          throughput_mbps: 9000, duration_s: 8, time: new Date().toISOString().slice(0, 16).replace('T', ' ') })
      }
    }

    // ---- 备份 ----
    const backupJobs = ref([])
    const clusters = ref([])
    const allVms = ref([])

    // ---- P12 新建备份任务对话框（对象/模式/位置/调度/保留 完整生命周期）----
    const bkDlg = reactive({
      open: false, busy: false,
      form: {
        name: '', scope: 'vm', target_vm_ids: [], cluster_id: null,
        mode: 'full', location: 'local', location_target: '',
        schedule_type: 'cron', cron: '0 3 * * *',
        retention_type: 'count', retention_value: 7,
      },
      errors: {},
    })
    const openBackupCreate = async () => {
      if (!allVms.value.length) allVms.value = await api('/vms')
      if (!clusters.value.length) clusters.value = await api('/clusters')
      bkDlg.form = {
        name: '', scope: 'vm', target_vm_ids: allVms.value[0] ? [allVms.value[0].id] : [], cluster_id: clusters.value[0]?.id || null,
        mode: 'full', location: 'local', location_target: '',
        schedule_type: 'cron', cron: '0 3 * * *', retention_type: 'count', retention_value: 7,
      }
      bkDlg.errors = {}; bkDlg.busy = false; bkDlg.open = true
    }
    const toggleBkVm = (id) => {
      const i = bkDlg.form.target_vm_ids.indexOf(id)
      if (i >= 0) bkDlg.form.target_vm_ids.splice(i, 1); else bkDlg.form.target_vm_ids.push(id)
    }
    const validateBk = () => {
      const e = {}
      if (!(bkDlg.form.name || '').trim()) e.name = t('op_required')
      if (bkDlg.form.scope === 'vm' && !bkDlg.form.target_vm_ids.length) e.target = t('op_required')
      if (bkDlg.form.scope === 'vms' && !bkDlg.form.target_vm_ids.length) e.target = t('op_required')
      if (bkDlg.form.scope === 'cluster' && !bkDlg.form.cluster_id) e.target = t('op_required')
      if (bkDlg.form.schedule_type === 'cron' && !(bkDlg.form.cron || '').trim()) e.cron = t('op_required')
      if (bkDlg.form.location !== 'local' && !(bkDlg.form.location_target || '').trim()) e.location_target = t('op_required')
      if (!bkDlg.form.retention_value || bkDlg.form.retention_value < 1) e.retention_value = t('op_invalid')
      bkDlg.errors = e
      return Object.keys(e).length === 0
    }
    const saveBackup = async () => {
      if (!validateBk()) return
      bkDlg.busy = true
      try {
        const f = bkDlg.form
        const body = {
          name: f.name.trim(), scope: f.scope,
          target_vm_ids: f.scope === 'cluster' ? [] : (f.scope === 'vm' ? f.target_vm_ids.slice(0, 1) : f.target_vm_ids),
          cluster_id: f.scope === 'cluster' ? f.cluster_id : null,
          mode: f.mode, location: f.location, location_target: f.location_target,
          schedule_type: f.schedule_type, cron: f.cron,
          retention_type: f.retention_type, retention_value: Number(f.retention_value),
        }
        const res = await api('/backup-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (res.error) { showToast(res.error); bkDlg.busy = false; return }
        backupJobs.value.unshift(res)
        bkDlg.open = false
        showToast(t('bk_created').replace('{name}', res.name))
      } catch (err) { showToast(t('toast_failed')) }
      finally { bkDlg.busy = false }
    }
    const runBackupNow = (b) => { showToast(t('bk_run_now') + ': ' + b.name + ' （原型）') }

    const showToast = (m) => { toast.value = m; setTimeout(() => (toast.value = ''), 3200) }
    const bkStatusBadge = (s) => ({
      success: { cls: 'apple-badge--running', label: t('bk_status_success') },
      warning: { cls: 'apple-badge--warning', label: t('bk_status_warning') },
      failed: { cls: 'apple-badge--error', label: t('bk_status_failed') },
      pending: { cls: 'apple-badge--stopped', label: t('st_pending') || '待运行' },
    }[s] || { cls: '', label: s })

    const load = async () => {
      if (props.tab === 'ha' && !configs.value.length) {
        configs.value = await api('/cluster-configs'); hosts.value = await api('/hosts')
        if (configs.value.length) pick(configs.value[0])
      }
      if (props.tab === 'migration') {
        if (!hosts.value.length) hosts.value = await api('/hosts')
        if (!vms.value.length) { vms.value = (await api('/vms')).filter((v) => v.status === 'running'); if (vms.value.length) form.vm = vms.value[0].name }
        if (!history.value.length) history.value = await api('/migrations')
      }
      if (props.tab === 'backup' && !backupJobs.value.length) backupJobs.value = await api('/backup-jobs')
    }
    onMounted(load)
    watch(() => props.tab, load)

    // P10：迁移入口统一到「虚拟机列表 → 右键 → 迁移」，此处提供跳转
    const gotoVmList = () => window.dispatchEvent(new CustomEvent('cnf:goto', { detail: { module: 'compute', tab: 'vms' } }))
    return { props, configs, sel, hosts, members, pick, saveHA, toast,
             vms, history, form, job, gpuBlocked, submitMigration, backupJobs, bkStatusBadge, t, gotoVmList,
             clusters, allVms, bkDlg, openBackupCreate, toggleBkVm, saveBackup, runBackupNow }
  },
  template: `
    <div>
      <div v-if="toast" class="apple-alert apple-alert--success" style="margin-bottom:14px"><i class="fas fa-circle-check"></i> {{ toast }}</div>

      <!-- ===== ha：HA 配置 ===== -->
      <template v-if="props.tab==='ha'">
        <div class="cc-layout">
          <div class="apple-card" style="padding:8px">
            <div class="cc-list-item" v-for="c in configs" :key="c.id" :class="{active:sel&&sel.id===c.id}" @click="pick(c)">
              <i class="fas fa-layer-group" :style="{color:sel&&sel.id===c.id?'var(--color-blue)':'var(--text-tertiary)'}"></i>
              <div style="flex:1"><div style="font-weight:600;font-size:14px">{{ c.name }}</div>
                <div class="muted" style="font-size:11px"><span v-if="c.ha_enabled">HA</span><span v-if="c.drs_enabled"> · 资源调度</span><span v-if="c.evc_enabled"> · CPU兼容</span></div></div>
            </div>
          </div>
          <div v-if="sel">
            <div class="apple-card setting-block">
              <div class="setting-head"><div><div class="setting-title"><i class="fas fa-shield-halved" style="color:var(--color-green)"></i> {{ t('cc_ha') }}</div><div class="muted setting-sub">{{ t('cc_ha_desc') }}</div></div>
                <label class="apple-switch"><input type="checkbox" v-model="sel.ha_enabled"><span class="slider"></span></label></div>
              <div v-if="sel.ha_enabled" class="setting-body">
                <label class="switch-row"><input type="checkbox" v-model="sel.ha_admission_control"> {{ t('cc_admission') }}</label>
                <div class="muted" style="font-size:12px;margin:2px 0 8px 24px">{{ t('cc_admission_desc') }}</div>
                <div class="form-row" v-if="sel.ha_admission_control"><label>{{ t('cc_host_failures') }}</label><input class="apple-input" type="number" min="0" max="4" v-model.number="sel.ha_host_failures" style="max-width:120px"></div>
              </div>
            </div>
            <div class="apple-card setting-block">
              <div class="setting-head"><div><div class="setting-title"><i class="fas fa-arrows-rotate" style="color:var(--color-blue)"></i> {{ t('cc_drs') }}</div><div class="muted setting-sub">{{ t('cc_drs_desc') }}</div></div>
                <label class="apple-switch"><input type="checkbox" v-model="sel.drs_enabled"><span class="slider"></span></label></div>
              <div v-if="sel.drs_enabled" class="setting-body">
                <div class="form-row"><label>{{ t('cc_drs_level') }}</label>
                  <div class="seg-control" style="background:var(--bg-secondary)">
                    <button class="seg" :class="{active:sel.drs_automation==='manual'}" @click="sel.drs_automation='manual'">{{ t('cc_manual') }}</button>
                    <button class="seg" :class="{active:sel.drs_automation==='partial'}" @click="sel.drs_automation='partial'">{{ t('cc_partial') }}</button>
                    <button class="seg" :class="{active:sel.drs_automation==='full'}" @click="sel.drs_automation='full'">{{ t('cc_full') }}</button>
                  </div>
                </div>
                <div class="form-row"><label>{{ t('cc_aggr') }}</label><input type="range" min="1" max="5" v-model.number="sel.drs_aggressiveness" style="flex:1;max-width:260px;accent-color:var(--color-blue)"><span class="mono" style="width:20px">{{ sel.drs_aggressiveness }}</span></div>
              </div>
            </div>
            <div class="apple-card setting-block" v-if="members.length">
              <div class="setting-title" style="margin-bottom:10px"><i class="fas fa-server muted"></i> {{ t('cc_members') }} ({{ members.length }})</div>
              <div class="flex" style="flex-wrap:wrap;gap:8px"><span v-for="h in members" :key="h.id" class="host-chip"><i class="fas fa-server" :style="{color:h.status==='connected'?'var(--color-green)':'var(--color-orange)'}"></i> {{ h.name }} <span class="muted">· {{ h.vcpus }}vCPU</span></span></div>
            </div>
            <button class="apple-btn apple-btn--primary" @click="saveHA"><i class="fas fa-check"></i> {{ t('apply') }}</button>
          </div>
        </div>
      </template>

      <!-- ===== migration：迁移记录（控制台已精简，迁移入口统一走 虚拟机列表 → 右键 → 迁移）===== -->
      <template v-else-if="props.tab==='migration'">
        <div class="iso-repo-note" style="margin-bottom:14px">
          <i class="fas fa-circle-info"></i>
          <div>
            <strong>{{ t('mig_center_tip_title') }}</strong>
            <div class="muted" style="margin-top:4px;line-height:1.6">{{ t('mig_center_tip') }}</div>
            <button class="apple-btn apple-btn--primary apple-btn--sm" style="margin-top:10px" @click="gotoVmList"><i class="fas fa-desktop"></i> {{ t('mig_goto_vms') }}</button>
          </div>
        </div>
        <div class="apple-card" style="padding:0">
          <div style="padding:16px 16px 0"><h3 style="margin:0 0 4px"><i class="fas fa-clock-rotate-left" style="color:var(--color-indigo)"></i> {{ t('mig_history') }}</h3></div>
          <table class="apple-table">
            <thead><tr><th>{{ t('mig_vm') }}</th><th>{{ t('mig_path') }}</th><th>{{ t('mig_mode') }}</th><th>{{ t('mig_downtime_col') }}</th><th>{{ t('status') }}</th><th>{{ t('task_time') }}</th></tr></thead>
            <tbody>
              <tr v-for="m in history" :key="m.id">
                <td><strong>{{ m.vm }}</strong></td>
                <td class="mono" style="font-size:12px">{{ m.src }} → {{ m.dst }}</td>
                <td><span class="apple-badge" :class="m.live?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ m.live?t('mig_online'):t('mig_cold') }}</span><span v-if="m.storage" class="apple-badge apple-badge--warning"><span class="dot"></span>{{ t('mig_col_storage') }}</span></td>
                <td class="mono">{{ m.downtime_ms }}ms</td>
                <td><span class="apple-badge" :class="m.status==='success'?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ m.status==='success'?t('mig_success'):t('mig_failed') }}</span></td>
                <td class="muted" style="font-size:12px">{{ m.time }}</td>
              </tr>
              <tr v-if="!history.length"><td colspan="6" class="muted" style="text-align:center;padding:18px">{{ t('mig_no_history') }}</td></tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== backup：备份恢复 ===== -->
      <template v-else>
        <div class="toolbar"><span class="muted">{{ backupJobs.length }} {{ t('bk_title') }}</span><div class="spacer"></div><button class="apple-btn apple-btn--primary" @click="openBackupCreate"><i class="fas fa-plus"></i> {{ t('bk_add') }}</button></div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('bk_job_name') }}</th><th>{{ t('bk_target') }}</th><th>{{ t('bk_schedule') }}</th><th>{{ t('bk_mode') }}</th><th>{{ t('bk_retention') }}</th><th>{{ t('bk_last_run') }}</th><th>{{ t('bk_last_status') }}</th><th>{{ t('bk_last_size') }}</th><th>{{ t('actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="b in backupJobs" :key="b.id">
                <td><strong>{{ b.name }}</strong></td>
                <td class="mono">{{ b.target_vm }}</td>
                <td>{{ b.schedule }}</td>
                <td><span class="apple-badge">{{ b.mode==='full'?t('bk_mode_full'):(b.mode==='differential'?t('bk_mode_differential'):t('bk_mode_incremental')) }}</span></td>
                <td>{{ b.retention }}</td>
                <td class="muted">{{ b.last_run }}</td>
                <td><span class="apple-badge" :class="bkStatusBadge(b.last_status).cls"><span class="dot"></span>{{ bkStatusBadge(b.last_status).label }}</span></td>
                <td class="mono">{{ b.last_size_gb }} GB</td>
                <td><button class="apple-btn apple-btn--ghost apple-btn--sm" @click="runBackupNow(b)"><i class="fas fa-play"></i> {{ t('bk_run_now') }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== P12 新建备份任务对话框 ===== -->
      <div v-if="bkDlg.open" class="modal-mask" @click.self="!bkDlg.busy && (bkDlg.open=false)">
        <div class="modal-dialog modal-lg">
          <div class="modal-head"><i class="fas fa-shield-halved" style="color:var(--color-green)"></i> {{ t('bk_new_title') }}</div>
          <div class="modal-body">
            <div class="form-row">
              <label>{{ t('bk_job_name') }} <span class="req">*</span></label>
              <input class="apple-input" v-model="bkDlg.form.name" :class="{invalid:bkDlg.errors.name}" placeholder="bk-prod-daily" />
              <div v-if="bkDlg.errors.name" class="form-err">{{ bkDlg.errors.name }}</div>
            </div>

            <!-- 备份对象 -->
            <div class="form-row">
              <label>{{ t('bk_scope') }}</label>
              <div class="seg-control" style="background:var(--bg-secondary)">
                <button class="seg" :class="{active:bkDlg.form.scope==='vm'}" @click="bkDlg.form.scope='vm'">{{ t('bk_scope_vm') }}</button>
                <button class="seg" :class="{active:bkDlg.form.scope==='vms'}" @click="bkDlg.form.scope='vms'">{{ t('bk_scope_vms') }}</button>
                <button class="seg" :class="{active:bkDlg.form.scope==='cluster'}" @click="bkDlg.form.scope='cluster'">{{ t('bk_scope_cluster') }}</button>
              </div>
            </div>
            <div class="form-row" v-if="bkDlg.form.scope==='vm'">
              <label>{{ t('bk_pick_vm') }} <span class="req">*</span></label>
              <select class="apple-input" :value="bkDlg.form.target_vm_ids[0]" @change="bkDlg.form.target_vm_ids=[Number($event.target.value)]" :class="{invalid:bkDlg.errors.target}">
                <option v-for="v in allVms" :key="v.id" :value="v.id">{{ v.name }} · {{ v.os }}</option>
              </select>
              <div v-if="bkDlg.errors.target" class="form-err">{{ bkDlg.errors.target }}</div>
            </div>
            <div class="form-row" v-else-if="bkDlg.form.scope==='vms'">
              <label>{{ t('bk_pick_vms') }} <span class="req">*</span></label>
              <div class="multi-pick" :class="{invalid:bkDlg.errors.target}">
                <label class="multi-pick-item" v-for="v in allVms" :key="v.id" :class="{active:bkDlg.form.target_vm_ids.includes(v.id)}">
                  <input type="checkbox" :checked="bkDlg.form.target_vm_ids.includes(v.id)" @change="toggleBkVm(v.id)" />
                  <span>{{ v.name }} <span class="muted">· {{ v.os }}</span></span>
                </label>
              </div>
              <div v-if="bkDlg.errors.target" class="form-err">{{ bkDlg.errors.target }}</div>
            </div>
            <div class="form-row" v-else>
              <label>{{ t('bk_pick_cluster') }} <span class="req">*</span></label>
              <select class="apple-input" v-model="bkDlg.form.cluster_id" :class="{invalid:bkDlg.errors.target}">
                <option v-for="cl in clusters" :key="cl.id" :value="cl.id">{{ cl.name }}</option>
              </select>
              <div v-if="bkDlg.errors.target" class="form-err">{{ bkDlg.errors.target }}</div>
            </div>

            <!-- 备份模式 -->
            <div class="form-row">
              <label>{{ t('bk_mode_label') }}</label>
              <div class="choice-cards" style="grid-template-columns:1fr 1fr 1fr">
                <label class="choice-card" :class="{active:bkDlg.form.mode==='full'}"><input type="radio" value="full" v-model="bkDlg.form.mode" /><div><div class="cc-title">{{ t('bk_mode_full') }}</div><div class="cc-sub muted">{{ t('bk_mode_full_desc') }}</div></div></label>
                <label class="choice-card" :class="{active:bkDlg.form.mode==='incremental'}"><input type="radio" value="incremental" v-model="bkDlg.form.mode" /><div><div class="cc-title">{{ t('bk_mode_incremental') }}</div><div class="cc-sub muted">{{ t('bk_mode_inc_desc') }}</div></div></label>
                <label class="choice-card" :class="{active:bkDlg.form.mode==='differential'}"><input type="radio" value="differential" v-model="bkDlg.form.mode" /><div><div class="cc-title">{{ t('bk_mode_differential') }}</div><div class="cc-sub muted">{{ t('bk_mode_diff_desc') }}</div></div></label>
              </div>
            </div>

            <!-- 存储位置 -->
            <div class="form-grid-2">
              <div class="form-row">
                <label>{{ t('bk_location') }}</label>
                <select class="apple-input" v-model="bkDlg.form.location">
                  <option value="local">{{ t('bk_loc_local') }}</option>
                  <option value="nfs">{{ t('bk_loc_nfs') }}</option>
                  <option value="s3">{{ t('bk_loc_s3') }}</option>
                </select>
              </div>
              <div class="form-row" v-if="bkDlg.form.location==='nfs'">
                <label>{{ t('bk_nfs_path') }} <span class="req">*</span></label>
                <input class="apple-input mono" v-model="bkDlg.form.location_target" :class="{invalid:bkDlg.errors.location_target}" :placeholder="t('bk_nfs_path_ph')" />
              </div>
              <div class="form-row" v-else-if="bkDlg.form.location==='s3'">
                <label>{{ t('bk_s3_bucket') }} <span class="req">*</span></label>
                <input class="apple-input mono" v-model="bkDlg.form.location_target" :class="{invalid:bkDlg.errors.location_target}" :placeholder="t('bk_s3_bucket_ph')" />
              </div>
            </div>

            <!-- 调度策略 -->
            <div class="form-grid-2">
              <div class="form-row">
                <label>{{ t('bk_sched_label') }}</label>
                <div class="seg-control" style="background:var(--bg-secondary)">
                  <button class="seg" :class="{active:bkDlg.form.schedule_type==='manual'}" @click="bkDlg.form.schedule_type='manual'">{{ t('bk_sched_manual') }}</button>
                  <button class="seg" :class="{active:bkDlg.form.schedule_type==='cron'}" @click="bkDlg.form.schedule_type='cron'">{{ t('bk_sched_cron') }}</button>
                </div>
              </div>
              <div class="form-row" v-if="bkDlg.form.schedule_type==='cron'">
                <label>{{ t('bk_cron_expr') }} <span class="req">*</span></label>
                <input class="apple-input mono" v-model="bkDlg.form.cron" :class="{invalid:bkDlg.errors.cron}" :placeholder="t('bk_cron_ph')" />
              </div>
            </div>

            <!-- 保留策略 -->
            <div class="form-grid-2">
              <div class="form-row">
                <label>{{ t('bk_retain_label') }}</label>
                <div class="seg-control" style="background:var(--bg-secondary)">
                  <button class="seg" :class="{active:bkDlg.form.retention_type==='count'}" @click="bkDlg.form.retention_type='count'">{{ t('bk_retain_count') }}</button>
                  <button class="seg" :class="{active:bkDlg.form.retention_type==='days'}" @click="bkDlg.form.retention_type='days'">{{ t('bk_retain_days') }}</button>
                </div>
              </div>
              <div class="form-row">
                <label>{{ t('bk_retain_n') }} <span class="req">*</span></label>
                <input class="apple-input" type="number" min="1" max="365" v-model.number="bkDlg.form.retention_value" :class="{invalid:bkDlg.errors.retention_value}" />
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="bkDlg.busy" @click="bkDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="bkDlg.busy" @click="saveBackup">
              <i v-if="bkDlg.busy" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-check"></i> {{ t('op_confirm') }}
            </button>
          </div>
        </div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.AvailabilityView = AvailabilityView
})()
