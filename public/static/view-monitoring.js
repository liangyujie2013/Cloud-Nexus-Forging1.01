// =============================================================================
//  模块视图：监控告警 (view-monitoring.js)
//  子标签：
//    overview  总览 —— KPI 指标卡 + 系统健康度环 + CPU/内存/网络/IOPS 趋势图 (Chart.js)
//    realtime  实时监控 —— GPU 实时面板 + 主机实时负载 (SSE 推送)
//    rules     告警规则 —— 完整 CRUD（新建/编辑/启停/删除）
//  API：/monitoring/overview、/monitoring/history、/gpus、/hosts、/alert-rules、
//       SSE /monitoring/metrics/stream
// =============================================================================
(function () {
const { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue
const api = window.api
const t = window.t
const toast = window.cnfToast

const C = {
  blue: '#007AFF', green: '#34C759', orange: '#FF9500', red: '#FF3B30',
  indigo: '#5856D6', purple: '#AF52DE', teal: '#30B0C7', gray: '#8E8E93',
}
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

const MonitoringView = {
  components: { RingProgress: window.__CNF_VIEWS.RingProgress },
  props: { tab: { type: String, default: 'overview' } },
  setup(props) {
    // ---- state ----
    const overview = ref(null)
    const history = ref(null)
    const gpus = ref([])
    const hosts = ref([])
    const rules = ref([])
    const live = ref({})
    const liveHosts = ref({})
    const loading = ref(false)
    let es = null

    // chart instances
    let cpuMemChart = null
    let netChart = null
    let iopsChart = null

    // ---- helpers ----
    const utilColor = (v) => (v > 85 ? C.red : v > 60 ? C.orange : C.green)
    const sevColor = (s) => (s === 'critical' ? C.red : s === 'info' ? C.blue : C.orange)
    const sevLabel = (s) => (s === 'critical' ? t('sev_critical') : s === 'info' ? t('sev_info') : t('sev_warning'))
    const healthColor = (lvl) => (lvl === 'critical' ? C.red : lvl === 'warning' ? C.orange : C.green)
    const healthLabel = (lvl) => (lvl === 'critical' ? t('mon_health_critical') : lvl === 'warning' ? t('mon_health_warning') : t('mon_health_healthy'))

    // ---- SSE realtime ----
    const startStream = () => {
      if (es) return
      es = new EventSource(window.API_BASE + '/monitoring/metrics/stream')
      es.onmessage = (e) => {
        const d = JSON.parse(e.data)
        const gm = {}; d.gpus.forEach((g) => (gm[g.id] = g)); live.value = gm
        const hm = {}; d.hosts.forEach((h) => (hm[h.id] = h)); liveHosts.value = hm
      }
      es.onerror = () => {}
    }
    const stopStream = () => { if (es) { es.close(); es = null } }

    const mergedGpus = computed(() => gpus.value.map((g) => ({ ...g, ...(live.value[g.id] || {}) })))
    const mergedHosts = computed(() => hosts.value.map((h) => {
      const l = liveHosts.value[h.id] || {}
      return { ...h, cpu_usage: l.cpu_usage ?? h.cpu_usage, mem_usage: l.mem_usage ?? Math.round((h.mem_used_gb / h.mem_total_gb) * 100) }
    }))

    // ---- Chart.js rendering ----
    const baseOpts = (yMax) => ({
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 12 }, color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#666' } },
        tooltip: { backgroundColor: 'rgba(0,0,0,.82)', padding: 10, cornerRadius: 8, titleFont: { size: 12 }, bodyFont: { size: 12 } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 11 }, color: '#999' } },
        y: { beginAtZero: true, max: yMax, grid: { color: 'rgba(120,120,128,.14)' }, ticks: { font: { size: 11 }, color: '#999' } },
      },
      elements: { point: { radius: 0, hoverRadius: 4 }, line: { tension: 0.4, borderWidth: 2 } },
    })

    const lineDS = (label, data, color, fill) => ({
      label, data, borderColor: color,
      backgroundColor: fill ? hexA(color, 0.12) : 'transparent',
      fill: !!fill, pointStyle: 'circle',
    })

    const renderCharts = () => {
      if (!window.Chart || !history.value) return
      const h = history.value, labels = h.series.map((p) => p.t)
      // CPU / Mem
      const cm = document.getElementById('mon-chart-cpumem')
      if (cm) {
        if (cpuMemChart) cpuMemChart.destroy()
        cpuMemChart = new Chart(cm, {
          type: 'line',
          data: { labels, datasets: [lineDS('CPU %', h.series.map((p) => p.cpu), C.blue, true), lineDS(t('col_mem') + ' %', h.series.map((p) => p.mem), C.indigo, false)] },
          options: baseOpts(100),
        })
      }
      // Net
      const nc = document.getElementById('mon-chart-net')
      if (nc) {
        if (netChart) netChart.destroy()
        netChart = new Chart(nc, {
          type: 'line',
          data: { labels, datasets: [lineDS(t('mon_net_in'), h.series.map((p) => p.net_in), C.green, true), lineDS(t('mon_net_out'), h.series.map((p) => p.net_out), C.orange, false)] },
          options: baseOpts(undefined),
        })
      }
      // IOPS
      const ic = document.getElementById('mon-chart-iops')
      if (ic) {
        if (iopsChart) iopsChart.destroy()
        iopsChart = new Chart(ic, {
          type: 'line',
          data: { labels, datasets: [lineDS('IOPS', h.series.map((p) => p.iops), C.teal, true)] },
          options: baseOpts(undefined),
        })
      }
    }
    const destroyCharts = () => {
      [cpuMemChart, netChart, iopsChart].forEach((c) => c && c.destroy())
      cpuMemChart = netChart = iopsChart = null
    }

    // ---- data loading per tab ----
    const load = async () => {
      if (props.tab === 'overview') {
        loading.value = true
        const [ov, hi] = await Promise.all([api('/monitoring/overview'), api('/monitoring/history?points=24')])
        overview.value = ov; history.value = hi
        loading.value = false
        await nextTick(); renderCharts()
      } else if (props.tab === 'realtime') {
        if (!gpus.value.length) gpus.value = await api('/gpus')
        if (!hosts.value.length) hosts.value = await api('/hosts')
        startStream()
      } else if (props.tab === 'rules') {
        await loadRules()
      }
    }
    const loadRules = async () => { rules.value = await api('/alert-rules') }

    onMounted(load)
    watch(() => props.tab, (nv, ov) => {
      if (ov === 'realtime' && nv !== 'realtime') stopStream()
      if (ov === 'overview' && nv !== 'overview') destroyCharts()
      load()
    })
    onBeforeUnmount(() => { stopStream(); destroyCharts() })

    // =========================================================================
    //  告警规则 CRUD
    // =========================================================================
    const ruleDlg = reactive({ open: false, mode: 'create', id: null, busy: false, form: {}, errors: {} })
    const blankRule = () => ({ name: '', metric: '', condition: '', severity: 'warning', channel: 'email', enabled: true })

    const openCreateRule = () => { ruleDlg.mode = 'create'; ruleDlg.id = null; ruleDlg.form = blankRule(); ruleDlg.errors = {}; ruleDlg.open = true }
    const openEditRule = (r) => { ruleDlg.mode = 'edit'; ruleDlg.id = r.id; ruleDlg.form = { name: r.name, metric: r.metric, condition: r.condition, severity: r.severity, channel: r.channel, enabled: r.enabled }; ruleDlg.errors = {}; ruleDlg.open = true }
    const closeRuleDlg = () => { ruleDlg.open = false }

    const validateRule = () => {
      const e = {}
      if (!ruleDlg.form.name || !ruleDlg.form.name.trim()) e.name = t('op_required')
      if (!ruleDlg.form.metric || !ruleDlg.form.metric.trim()) e.metric = t('op_required')
      if (!ruleDlg.form.condition || !ruleDlg.form.condition.trim()) e.condition = t('op_required')
      ruleDlg.errors = e
      return Object.keys(e).length === 0
    }

    const submitRule = async () => {
      if (!validateRule()) return
      ruleDlg.busy = true
      try {
        let res
        if (ruleDlg.mode === 'create') res = await api('/alert-rules', { method: 'POST', body: JSON.stringify(ruleDlg.form) })
        else res = await api('/alert-rules/' + ruleDlg.id, { method: 'PUT', body: JSON.stringify(ruleDlg.form) })
        if (res && res.error) { toast(res.error, 'error'); return }
        toast(res.message || t('op_confirm'), 'success')
        ruleDlg.open = false
        await loadRules()
      } catch (err) { toast(t('op_failed'), 'error') } finally { ruleDlg.busy = false }
    }

    const toggleRule = async (r) => {
      const res = await api('/alert-rules/' + r.id, { method: 'PUT', body: JSON.stringify({ enabled: !r.enabled }) })
      if (res && res.error) { toast(res.error, 'error'); return }
      await loadRules()
    }

    // delete confirm dialog
    const delDlg = reactive({ open: false, rule: null, busy: false })
    const askDelRule = (r) => { delDlg.rule = r; delDlg.open = true }
    const confirmDelRule = async () => {
      delDlg.busy = true
      try {
        const res = await api('/alert-rules/' + delDlg.rule.id, { method: 'DELETE' })
        if (res && res.error) { toast(res.error, 'error'); return }
        toast(res.message || t('op_confirm'), 'success')
        delDlg.open = false
        await loadRules()
      } catch (err) { toast(t('op_failed'), 'error') } finally { delDlg.busy = false }
    }

    return {
      props, overview, history, mergedGpus, mergedHosts, rules, loading,
      utilColor, sevColor, sevLabel, healthColor, healthLabel, C, t,
      ruleDlg, openCreateRule, openEditRule, closeRuleDlg, submitRule, toggleRule,
      delDlg, askDelRule, confirmDelRule,
    }
  },
  template: `
    <div>
      <!-- ============================ OVERVIEW ============================ -->
      <template v-if="props.tab==='overview'">
        <div v-if="overview" class="mon-overview">
          <!-- KPI strip + health -->
          <div class="mon-top">
            <div class="mon-kpis">
              <div class="mon-kpi">
                <div class="mk-ico" :style="{background:C.blue+'1a',color:C.blue}"><i class="fas fa-server"></i></div>
                <div class="mk-body"><div class="mk-val">{{ overview.kpis.hosts_online }}<span class="mk-sub">/ {{ overview.kpis.hosts_total }}</span></div><div class="mk-lab">{{ t('mon_kpi_hosts') }}</div></div>
              </div>
              <div class="mon-kpi">
                <div class="mk-ico" :style="{background:C.indigo+'1a',color:C.indigo}"><i class="fas fa-desktop"></i></div>
                <div class="mk-body"><div class="mk-val">{{ overview.kpis.vms_running }}<span class="mk-sub">/ {{ overview.kpis.vms_total }}</span></div><div class="mk-lab">{{ t('mon_kpi_vms') }}</div></div>
              </div>
              <div class="mon-kpi">
                <div class="mk-ico" :style="{background:utilColor(overview.kpis.cpu_usage_pct)+'1a',color:utilColor(overview.kpis.cpu_usage_pct)}"><i class="fas fa-microchip"></i></div>
                <div class="mk-body"><div class="mk-val">{{ overview.kpis.cpu_usage_pct }}<span class="mk-sub">%</span></div><div class="mk-lab">{{ t('mon_kpi_cpu') }} · {{ t('mon_kpi_overcommit') }} {{ overview.kpis.vcpu_overcommit }}x</div></div>
              </div>
              <div class="mon-kpi">
                <div class="mk-ico" :style="{background:utilColor(overview.kpis.mem_usage_pct)+'1a',color:utilColor(overview.kpis.mem_usage_pct)}"><i class="fas fa-memory"></i></div>
                <div class="mk-body"><div class="mk-val">{{ overview.kpis.mem_usage_pct }}<span class="mk-sub">%</span></div><div class="mk-lab">{{ t('mon_kpi_mem') }}</div></div>
              </div>
              <div class="mon-kpi">
                <div class="mk-ico" :style="{background:utilColor(overview.kpis.storage_usage_pct)+'1a',color:utilColor(overview.kpis.storage_usage_pct)}"><i class="fas fa-hard-drive"></i></div>
                <div class="mk-body"><div class="mk-val">{{ overview.kpis.storage_usage_pct }}<span class="mk-sub">%</span></div><div class="mk-lab">{{ t('mon_kpi_storage') }} · {{ overview.kpis.storage_used_tb }}/{{ overview.kpis.storage_total_tb }} TB</div></div>
              </div>
              <div class="mon-kpi">
                <div class="mk-ico" :style="{background:C.purple+'1a',color:C.purple}"><i class="fas fa-bolt-lightning"></i></div>
                <div class="mk-body"><div class="mk-val">{{ overview.kpis.gpus_busy }}<span class="mk-sub">/ {{ overview.kpis.gpus_total }}</span></div><div class="mk-lab">{{ t('mon_kpi_gpu') }}</div></div>
              </div>
              <div class="mon-kpi">
                <div class="mk-ico" :style="{background:(overview.kpis.active_alerts>0?C.orange:C.gray)+'1a',color:overview.kpis.active_alerts>0?C.orange:C.gray}"><i class="fas fa-bell"></i></div>
                <div class="mk-body"><div class="mk-val" :style="{color:overview.kpis.active_alerts>0?C.orange:'inherit'}">{{ overview.kpis.active_alerts }}</div><div class="mk-lab">{{ t('mon_kpi_alerts') }}</div></div>
              </div>
            </div>
            <div class="apple-card apple-card--glass mon-health">
              <div class="mh-title">{{ t('mon_health') }}</div>
              <ring-progress :value="overview.health.score" :color="healthColor(overview.health.level)" :size="128"/>
              <span class="apple-badge" :style="{color:healthColor(overview.health.level)}"><span class="dot" :style="{background:healthColor(overview.health.level)}"></span>{{ healthLabel(overview.health.level) }}</span>
            </div>
          </div>

          <!-- charts -->
          <div class="apple-card mon-chart-card">
            <div class="mc-head"><i class="fas fa-chart-area" :style="{color:C.blue}"></i> {{ t('mon_chart_cpumem') }}</div>
            <div class="mc-canvas"><canvas id="mon-chart-cpumem"></canvas></div>
          </div>
          <div class="mon-chart-row">
            <div class="apple-card mon-chart-card">
              <div class="mc-head"><i class="fas fa-wave-square" :style="{color:C.green}"></i> {{ t('mon_chart_net') }}</div>
              <div class="mc-canvas"><canvas id="mon-chart-net"></canvas></div>
            </div>
            <div class="apple-card mon-chart-card">
              <div class="mc-head"><i class="fas fa-database" :style="{color:C.teal}"></i> {{ t('mon_chart_iops') }}</div>
              <div class="mc-canvas"><canvas id="mon-chart-iops"></canvas></div>
            </div>
          </div>
        </div>
        <div v-else class="apple-card" style="text-align:center;padding:48px;color:var(--text-tertiary)"><i class="fas fa-spinner fa-spin"></i></div>
      </template>

      <!-- ============================ REALTIME ============================ -->
      <template v-else-if="props.tab==='realtime'">
        <div class="toolbar"><span class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('dash_sse_live') }}</span></div>
        <div class="grid grid-3" style="margin-bottom:20px">
          <div class="apple-card gpu-card apple-card--glass" v-for="g in mergedGpus" :key="g.id">
            <div class="head">
              <div><div class="model"><i class="fas fa-microchip" style="color:#76b900"></i> {{ g.model }}</div><div class="meta">{{ g.host }} · {{ g.pci }} · NUMA {{ g.numa }}</div></div>
              <span class="apple-badge" :class="g.status==='assigned'?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ g.status==='assigned' ? (g.mode==='vgpu'?t('gpu_vgpu'):t('gpu_passthrough')) : t('gpu_idle') }}</span>
            </div>
            <div style="position:relative"><ring-progress :value="g.util||0" :color="utilColor(g.util||0)" :label="t('gpu_util')" :size="100"/></div>
            <div class="gpu-stats">
              <div class="gpu-stat"><div class="k">{{ t('gpu_vram') }}</div><div class="v">{{ ((g.mem_used||0)/1024).toFixed(1) }} / {{ (g.vram_mb/1024).toFixed(0) }} GB</div><div class="usage-bar" style="margin-top:6px"><div class="fill" :style="{width:((g.mem_used||0)/g.vram_mb*100)+'%',background:'var(--color-indigo)'}"></div></div></div>
              <div class="gpu-stat"><div class="k">{{ t('gpu_temp') }}</div><div class="v" :style="{color: g.temp>75?'var(--color-red)':'inherit'}">{{ g.temp||0 }}°C</div></div>
              <div class="gpu-stat"><div class="k">{{ t('gpu_power') }}</div><div class="v">{{ g.power||0 }} W</div></div>
              <div class="gpu-stat"><div class="k">{{ t('gpu_bound_vm') }}</div><div class="v" style="font-size:13px">{{ g.vm || '—' }}</div></div>
            </div>
          </div>
        </div>
        <div class="mc-head" style="margin:0 2px 10px"><i class="fas fa-gauge-high" :style="{color:C.blue}"></i> {{ t('mon_realtime_hosts') }}</div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('host_machine') }}</th><th>{{ t('status') }}</th><th style="width:200px">CPU</th><th style="width:200px">{{ t('col_mem') }}</th></tr></thead>
            <tbody>
              <tr v-for="h in mergedHosts" :key="h.id">
                <td><strong>{{ h.name }}</strong><div class="muted" style="font-size:12px">{{ h.cpu_model }}</div></td>
                <td><span class="apple-badge" :class="h.status==='connected'?'apple-badge--running':'apple-badge--warning'"><span class="dot"></span>{{ h.status==='connected'?t('dash_connected'):t('mon_health_warning') }}</span></td>
                <td><div class="flex between" style="margin-bottom:3px"><span class="mono" style="font-size:12px">{{ Math.round(h.cpu_usage) }}%</span></div><div class="usage-bar"><div class="fill" :style="{width:h.cpu_usage+'%',background:utilColor(h.cpu_usage),transition:'width .5s'}"></div></div></td>
                <td><div class="flex between" style="margin-bottom:3px"><span class="mono" style="font-size:12px">{{ Math.round(h.mem_usage) }}%</span></div><div class="usage-bar"><div class="fill" :style="{width:h.mem_usage+'%',background:utilColor(h.mem_usage),transition:'width .5s'}"></div></div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ============================ RULES ============================ -->
      <template v-else>
        <div class="toolbar"><span class="muted">{{ rules.length }} {{ t('rule_title') }}</span><div class="spacer"></div><button class="apple-btn apple-btn--primary" @click="openCreateRule"><i class="fas fa-plus"></i> {{ t('rule_add') }}</button></div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('rule_name') }}</th><th>{{ t('rule_metric') }}</th><th>{{ t('rule_condition') }}</th><th>{{ t('rule_severity') }}</th><th>{{ t('rule_triggered') }}</th><th>{{ t('rule_channel') }}</th><th>{{ t('rule_enabled') }}</th><th style="text-align:right">{{ t('op_actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="r in rules" :key="r.id">
                <td><strong>{{ r.name }}</strong></td>
                <td class="mono muted">{{ r.metric }}</td>
                <td>{{ r.condition }}</td>
                <td><span class="apple-badge" :style="{color:sevColor(r.severity)}"><span class="dot" :style="{background:sevColor(r.severity)}"></span>{{ sevLabel(r.severity) }}</span></td>
                <td><strong :style="{color: r.triggered>0?'var(--color-orange)':'var(--text-tertiary)'}">{{ r.triggered }}</strong></td>
                <td class="muted">{{ r.channel }}</td>
                <td><button class="mon-toggle" :class="{on:r.enabled}" @click="toggleRule(r)" :title="t('rule_op_toggle')"><span></span></button></td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="apple-btn apple-btn--ghost apple-btn--sm" @click="openEditRule(r)"><i class="fas fa-pen"></i></button>
                  <button class="apple-btn apple-btn--ghost apple-btn--sm" style="color:var(--color-red)" @click="askDelRule(r)"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== rule create/edit modal ===== -->
      <div v-if="ruleDlg.open" class="modal-mask" @click.self="!ruleDlg.busy && (ruleDlg.open=false)">
        <div class="modal-dialog">
          <div class="modal-head"><i class="fas fa-bell" style="color:var(--color-orange)"></i> {{ ruleDlg.mode==='create' ? t('rule_create_title') : t('rule_edit_title') }}</div>
          <div class="modal-body">
            <div class="form-row"><label>{{ t('rule_name') }} <span class="req">*</span></label><input v-model="ruleDlg.form.name" :class="{invalid:ruleDlg.errors.name}"><div v-if="ruleDlg.errors.name" class="form-err">{{ ruleDlg.errors.name }}</div></div>
            <div class="form-row"><label>{{ t('rule_metric') }} <span class="req">*</span></label><input class="mono" v-model="ruleDlg.form.metric" :class="{invalid:ruleDlg.errors.metric}" :placeholder="t('rule_metric_ph')"><div v-if="ruleDlg.errors.metric" class="form-err">{{ ruleDlg.errors.metric }}</div></div>
            <div class="form-row"><label>{{ t('rule_condition') }} <span class="req">*</span></label><input v-model="ruleDlg.form.condition" :class="{invalid:ruleDlg.errors.condition}" :placeholder="t('rule_cond_ph')"><div v-if="ruleDlg.errors.condition" class="form-err">{{ ruleDlg.errors.condition }}</div></div>
            <div class="form-grid-2">
              <div class="form-row"><label>{{ t('rule_severity') }}</label><select v-model="ruleDlg.form.severity"><option value="critical">{{ t('sev_critical') }}</option><option value="warning">{{ t('sev_warning') }}</option><option value="info">{{ t('sev_info') }}</option></select></div>
              <div class="form-row"><label>{{ t('rule_channel') }}</label><select v-model="ruleDlg.form.channel"><option value="email">Email</option><option value="webhook">Webhook</option><option value="sms">SMS</option></select></div>
            </div>
            <label class="mon-check"><input type="checkbox" v-model="ruleDlg.form.enabled"> {{ t('rule_enabled') }}</label>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="ruleDlg.busy" @click="closeRuleDlg">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="ruleDlg.busy" @click="submitRule"><i v-if="ruleDlg.busy" class="fas fa-spinner fa-spin"></i> {{ t('op_confirm') }}</button>
          </div>
        </div>
      </div>

      <!-- ===== rule delete confirm ===== -->
      <div v-if="delDlg.open" class="modal-mask" @click.self="!delDlg.busy && (delDlg.open=false)">
        <div class="modal-dialog modal-sm">
          <div class="modal-head"><i class="fas fa-triangle-exclamation" style="color:var(--color-red)"></i> {{ t('rule_op_del') }}</div>
          <div class="modal-body"><p>{{ t('rule_del_confirm').replace('{name}', delDlg.rule ? delDlg.rule.name : '') }}</p></div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--secondary" :disabled="delDlg.busy" @click="delDlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--danger" :disabled="delDlg.busy" @click="confirmDelRule"><i v-if="delDlg.busy" class="fas fa-spinner fa-spin"></i> {{ t('rule_op_del') }}</button>
          </div>
        </div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.MonitoringView = MonitoringView
})()
