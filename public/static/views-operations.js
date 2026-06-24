// CNFv1.0 Stage 2 演示视图：热迁移控制台 + 快照管理
(function () {
const { ref, onMounted, computed, reactive } = Vue
const api = window.api

// ============================ 视图：热迁移控制台 ============================
const MigrationView = {
  setup() {
    const vms = ref([])
    const hosts = ref([])
    const history = ref([])
    const form = reactive({ vm: '', dst: '', live: true, storage: false, compressed: true, downtime: 300 })
    const job = reactive({ active: false, progress: 0, phase: '', throughput: 0, remaining: 0, done: false })
    let timer = null
    let startTs = 0

    onMounted(async () => {
      vms.value = (await api('/vms')).filter(v => v.status === 'running')
      hosts.value = await api('/hosts')
      history.value = await api('/migrations')
      if (vms.value.length) form.vm = vms.value[0].name
    })

    // 校验：选中 VM 是否带 GPU 直通（带 GPU 的不允许热迁移）
    const selectedVM = computed(() => vms.value.find(v => v.name === form.vm))
    const gpuBlocked = computed(() => form.live && selectedVM.value && selectedVM.value.gpus > 0)

    const submit = async () => {
      if (!form.vm || !form.dst) return
      if (gpuBlocked.value) return
      await api('/migrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      job.active = true; job.done = false; job.progress = 0; job.phase = window.t('mig_phase_precopy')
      startTs = Date.now()
      clearInterval(timer)
      timer = setInterval(poll, 600)
    }

    const poll = async () => {
      const r = await api('/migrate/progress?start=' + startTs)
      job.progress = r.progress; job.phase = r.phase
      job.throughput = r.throughput_mbps; job.remaining = r.remaining_mb
      if (r.done) {
        job.done = true
        clearInterval(timer)
        history.value.unshift({
          id: Date.now(), vm: form.vm,
          src: selectedVM.value ? window.t('mig_current_host') : '-', dst: form.dst,
          live: form.live, storage: form.storage, status: 'success',
          downtime_ms: form.downtime, throughput_mbps: 9000, duration_s: 8,
          time: new Date().toISOString().slice(0, 16).replace('T', ' '),
        })
      }
    }

    return { vms, hosts, history, form, job, gpuBlocked, selectedVM, submit, t: window.t, i18n: window.i18n }
  },
  template: `
    <div class="grid grid-2">
      <div class="apple-card">
        <h3 style="margin:0 0 16px"><i class="fas fa-right-left" style="color:var(--color-blue)"></i> {{ t('mig_console_title') }}</h3>
        <div class="form-row"><label>{{ t('mig_vm') }}</label>
          <select class="apple-input" v-model="form.vm">
            <option v-for="v in vms" :key="v.id" :value="v.name">{{ v.name }} ({{ v.vcpus }}vCPU / {{ v.mem_gb }}GB{{ v.gpus>0?' / '+v.gpus+'×GPU':'' }})</option>
          </select>
        </div>
        <div class="form-row"><label>{{ t('mig_target_host') }}</label>
          <select class="apple-input" v-model="form.dst">
            <option value="">{{ t('mig_choose') }}</option>
            <option v-for="h in hosts" :key="h.id" :value="h.name" :disabled="h.status!=='connected'">{{ h.name }} · {{ h.ip }} · {{ t('mig_remain') }} {{ (h.mem_total_gb-h.mem_used_gb) }}GB</option>
          </select>
        </div>
        <div class="flex" style="gap:18px;margin:14px 0;flex-wrap:wrap">
          <label class="switch-row"><input type="checkbox" v-model="form.live"> {{ t('mig_live2') }}</label>
          <label class="switch-row"><input type="checkbox" v-model="form.storage"> {{ t('mig_storage2') }}</label>
          <label class="switch-row"><input type="checkbox" v-model="form.compressed"> {{ t('mig_compress') }}</label>
        </div>
        <div class="form-row"><label>{{ t('mig_downtime') }}</label><input class="apple-input" type="number" v-model.number="form.downtime"></div>

        <div v-if="gpuBlocked" class="apple-alert apple-alert--warning" style="margin:12px 0">
          <i class="fas fa-triangle-exclamation"></i> {{ t('mig_gpu_block') }}
        </div>

        <button class="apple-btn apple-btn--primary" :disabled="job.active && !job.done || gpuBlocked || !form.dst" @click="submit" style="margin-top:6px">
          <i class="fas fa-paper-plane"></i> {{ job.active && !job.done ? t('mig_running') : t('mig_go') }}
        </button>

        <div v-if="job.active" style="margin-top:20px">
          <div class="flex between" style="margin-bottom:6px">
            <span class="muted">{{ job.phase }}</span>
            <span class="mono">{{ job.progress }}%</span>
          </div>
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
          <thead><tr><th>{{ t('mig_vm') }}</th><th>{{ t('mig_path') }}</th><th>{{ t('mig_mode') }}</th><th>{{ t('mig_downtime_col') }}</th><th>{{ t('mig_progress_throughput') }}</th><th>{{ t('status') }}</th><th>{{ t('task_time') }}</th></tr></thead>
          <tbody>
            <tr v-for="m in history" :key="m.id">
              <td><strong>{{ m.vm }}</strong></td>
              <td class="mono" style="font-size:12px">{{ m.src }} → {{ m.dst }}</td>
              <td>
                <span class="apple-badge" :class="m.live?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ m.live?t('mig_online'):t('mig_cold') }}</span>
                <span v-if="m.storage" class="apple-badge apple-badge--warning"><span class="dot"></span>{{ t('mig_col_storage') }}</span>
              </td>
              <td class="mono">{{ m.downtime_ms }}ms</td>
              <td class="mono">{{ m.throughput_mbps }}M</td>
              <td><span class="apple-badge" :class="m.status==='success'?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ m.status==='success'?t('mig_success'):t('mig_failed') }}</span></td>
              <td class="muted" style="font-size:12px">{{ m.time }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`,
}

// ============================ 视图：快照管理 ============================
const SnapshotView = {
  setup() {
    const snaps = ref([])
    const vms = ref([])
    const form = reactive({ vm: '', name: '', description: '', with_memory: false, quiesce: true })
    const creating = ref(false)
    const toast = ref('')

    const load = async () => { snaps.value = await api('/snapshots') }
    onMounted(async () => {
      await load()
      vms.value = await api('/vms')
      if (vms.value.length) form.vm = vms.value[0].name
    })

    // 按 VM 分组展示快照链
    const grouped = computed(() => {
      const m = {}
      snaps.value.forEach(s => { (m[s.vm] = m[s.vm] || []).push(s) })
      return Object.entries(m).map(([vm, list]) => ({ vm, list }))
    })

    const create = async () => {
      if (!form.name) return
      creating.value = true
      const r = await api('/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      creating.value = false
      toast.value = r.message
      // 乐观插入
      snaps.value.push({ id: r.id, vm: form.vm, name: form.name, description: form.description, with_memory: form.with_memory, quiesce: form.quiesce, size_gb: form.with_memory ? 64 : 4, parent: null, created_at: new Date().toISOString().slice(0, 16).replace('T', ' '), current: true })
      form.name = ''; form.description = ''
      setTimeout(() => toast.value = '', 3500)
    }

    return { snaps, vms, form, grouped, create, creating, toast, t: window.t, i18n: window.i18n }
  },
  template: `
    <div>
      <div v-if="toast" class="apple-alert apple-alert--success" style="margin-bottom:14px"><i class="fas fa-circle-check"></i> {{ toast }}</div>
      <div class="grid grid-2">
        <div class="apple-card">
          <h3 style="margin:0 0 16px"><i class="fas fa-camera" style="color:var(--color-purple)"></i> {{ t('snap_create_title') }}</h3>
          <div class="form-row"><label>{{ t('snap_vm') }}</label>
            <select class="apple-input" v-model="form.vm">
              <option v-for="v in vms" :key="v.id" :value="v.name">{{ v.name }} ({{ {running:t('st_running'),paused:t('st_paused'),stopped:t('st_stopped')}[v.status] }})</option>
            </select>
          </div>
          <div class="form-row"><label>{{ t('snap_name') }}</label><input class="apple-input" v-model="form.name" :placeholder="t('snap_name_ph')"></div>
          <div class="form-row"><label>{{ t('snap_desc') }}</label><input class="apple-input" v-model="form.description" :placeholder="t('snap_desc_ph')"></div>
          <div class="flex" style="gap:18px;margin:14px 0;flex-wrap:wrap">
            <label class="switch-row"><input type="checkbox" v-model="form.with_memory"> {{ t('snap_mem_label') }}</label>
            <label class="switch-row"><input type="checkbox" v-model="form.quiesce"> {{ t('snap_quiesce_label') }}</label>
          </div>
          <div class="apple-alert" style="margin:12px 0;background:rgba(0,122,255,.06);border-color:rgba(0,122,255,.2)">
            <i class="fas fa-info-circle" style="color:var(--color-blue)"></i>
            {{ t('snap_info') }}
          </div>
          <button class="apple-btn apple-btn--primary" :disabled="creating || !form.name" @click="create">
            <i class="fas fa-camera"></i> {{ creating ? t('snap_creating') : t('snap_create') }}
          </button>
        </div>

        <div class="apple-card">
          <h3 style="margin:0 0 12px"><i class="fas fa-code-branch" style="color:var(--color-indigo)"></i> {{ t('snap_chain_title') }}</h3>
          <div v-for="g in grouped" :key="g.vm" style="margin-bottom:18px">
            <div style="font-weight:600;margin-bottom:8px"><i class="fas fa-desktop muted"></i> {{ g.vm }}</div>
            <div class="snap-chain">
              <div class="snap-node" v-for="s in g.list" :key="s.id" :class="{current:s.current}">
                <div class="flex between">
                  <strong>{{ s.name }}</strong>
                  <span v-if="s.current" class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('snap_current') }}</span>
                </div>
                <div class="muted" style="font-size:12px;margin:2px 0">{{ s.description }}</div>
                <div class="flex" style="gap:6px;flex-wrap:wrap;margin-top:4px">
                  <span class="apple-badge" :class="s.with_memory?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ s.with_memory?t('snap_mem_nvram'):t('snap_disk_only') }}</span>
                  <span v-if="s.quiesce" class="apple-badge apple-badge--warning"><span class="dot"></span>{{ t('snap_quiesced2') }}</span>
                  <span class="mono muted" style="font-size:12px">{{ s.size_gb }}GB · {{ s.created_at }}</span>
                </div>
                <div class="flex" style="gap:8px;margin-top:8px">
                  <button class="apple-btn apple-btn--ghost apple-btn--sm" :disabled="s.current"><i class="fas fa-rotate-left"></i> {{ t('snap_rollback') }}</button>
                  <button class="apple-btn apple-btn--ghost apple-btn--sm"><i class="fas fa-trash"></i> {{ t('delete') }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.MigrationView = MigrationView
window.__CNF_VIEWS.SnapshotView = SnapshotView
})()
