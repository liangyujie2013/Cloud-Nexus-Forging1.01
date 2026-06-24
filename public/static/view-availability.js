// =============================================================================
//  模块视图：可用性管理 (view-availability.js)
//  子标签：ha HA 配置（集群 HA/DRS/EVC/超分配）/ migration 迁移中心（vMotion 控制台
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

    const showToast = (m) => { toast.value = m; setTimeout(() => (toast.value = ''), 3200) }
    const bkStatusBadge = (s) => ({
      success: { cls: 'apple-badge--running', label: t('bk_status_success') },
      warning: { cls: 'apple-badge--warning', label: t('bk_status_warning') },
      failed: { cls: 'apple-badge--error', label: t('bk_status_failed') },
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

    return { props, configs, sel, hosts, members, pick, saveHA, toast,
             vms, history, form, job, gpuBlocked, submitMigration, backupJobs, bkStatusBadge, t }
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
                <div class="muted" style="font-size:11px"><span v-if="c.ha_enabled">HA</span><span v-if="c.drs_enabled"> · DRS</span><span v-if="c.evc_enabled"> · EVC</span></div></div>
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

      <!-- ===== migration：迁移中心 ===== -->
      <template v-else-if="props.tab==='migration'">
        <div class="grid grid-2">
          <div class="apple-card">
            <h3 style="margin:0 0 16px"><i class="fas fa-right-left" style="color:var(--color-blue)"></i> {{ t('mig_console_title') }}</h3>
            <div class="form-row"><label>{{ t('mig_vm') }}</label>
              <select class="apple-input" v-model="form.vm"><option v-for="v in vms" :key="v.id" :value="v.name">{{ v.name }} ({{ v.vcpus }}vCPU / {{ v.mem_gb }}GB{{ v.gpus>0?' / '+v.gpus+'×GPU':'' }})</option></select></div>
            <div class="form-row"><label>{{ t('mig_target_host') }}</label>
              <select class="apple-input" v-model="form.dst"><option value="">{{ t('mig_choose') }}</option><option v-for="h in hosts" :key="h.id" :value="h.name" :disabled="h.status!=='connected'">{{ h.name }} · {{ h.ip }} · {{ t('mig_remain') }} {{ (h.mem_total_gb-h.mem_used_gb) }}GB</option></select></div>
            <div class="flex" style="gap:18px;margin:14px 0;flex-wrap:wrap">
              <label class="switch-row"><input type="checkbox" v-model="form.live"> {{ t('mig_live2') }}</label>
              <label class="switch-row"><input type="checkbox" v-model="form.storage"> {{ t('mig_storage2') }}</label>
              <label class="switch-row"><input type="checkbox" v-model="form.compressed"> {{ t('mig_compress') }}</label>
            </div>
            <div v-if="gpuBlocked" class="apple-alert apple-alert--warning" style="margin:12px 0"><i class="fas fa-triangle-exclamation"></i> {{ t('mig_gpu_block') }}</div>
            <button class="apple-btn apple-btn--primary" :disabled="job.active && !job.done || gpuBlocked || !form.dst" @click="submitMigration"><i class="fas fa-paper-plane"></i> {{ job.active && !job.done ? t('mig_running') : t('mig_go') }}</button>
            <div v-if="job.active" style="margin-top:20px">
              <div class="flex between" style="margin-bottom:6px"><span class="muted">{{ job.phase }}</span><span class="mono">{{ job.progress }}%</span></div>
              <div class="usage-bar" style="height:10px"><div class="fill" :style="{width:job.progress+'%',background:job.done?'var(--color-green)':'var(--color-blue)',transition:'width .5s'}"></div></div>
              <div class="gpu-stats" style="margin-top:14px">
                <div class="gpu-stat"><div class="k">{{ t('mig_progress_throughput') }}</div><div class="v">{{ job.throughput }} Mbps</div></div>
                <div class="gpu-stat"><div class="k">{{ t('mig_progress_remaining') }}</div><div class="v">{{ job.remaining }} MB</div></div>
                <div class="gpu-stat"><div class="k">{{ t('mig_progress_status') }}</div><div class="v" :style="{color:job.done?'var(--color-green)':'var(--color-orange)'}">{{ job.done?'✓ '+t('mig_done'):'● '+t('mig_in_progress') }}</div></div>
              </div>
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
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <!-- ===== backup：备份恢复 ===== -->
      <template v-else>
        <div class="toolbar"><span class="muted">{{ backupJobs.length }} {{ t('bk_title') }}</span><div class="spacer"></div><button class="apple-btn apple-btn--primary"><i class="fas fa-plus"></i> {{ t('bk_add') }}</button></div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('bk_job_name') }}</th><th>{{ t('bk_target') }}</th><th>{{ t('bk_schedule') }}</th><th>{{ t('bk_mode') }}</th><th>{{ t('bk_retention') }}</th><th>{{ t('bk_last_run') }}</th><th>{{ t('bk_last_status') }}</th><th>{{ t('bk_last_size') }}</th><th>{{ t('actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="b in backupJobs" :key="b.id">
                <td><strong>{{ b.name }}</strong></td>
                <td class="mono">{{ b.target_vm }}</td>
                <td>{{ b.schedule }}</td>
                <td><span class="apple-badge">{{ b.mode==='full'?t('bk_mode_full'):t('bk_mode_incremental') }}</span></td>
                <td>{{ b.retention }}</td>
                <td class="muted">{{ b.last_run }}</td>
                <td><span class="apple-badge" :class="bkStatusBadge(b.last_status).cls"><span class="dot"></span>{{ bkStatusBadge(b.last_status).label }}</span></td>
                <td class="mono">{{ b.last_size_gb }} GB</td>
                <td><button class="apple-btn apple-btn--ghost apple-btn--sm"><i class="fas fa-play"></i> {{ t('bk_run_now') }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.AvailabilityView = AvailabilityView
})()
