// =============================================================================
//  模块视图：仪表板 (view-dashboard.js)
//  子标签：overview 资源概览 / performance 性能监控 / alerts 告警摘要。
//  同时定义并注册通用 RingProgress 圆环组件供其他模块复用。
// =============================================================================
(function () {
const { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } = Vue
const api = window.api
const t = window.t

// ---------------------------- 通用：圆环进度 ----------------------------
const RingProgress = {
  props: { value: { type: Number, default: 0 }, size: { type: Number, default: 88 }, color: { type: String, default: '#007AFF' }, label: String },
  template: `
    <div class="ring-wrap">
      <svg class="apple-ring" :width="size" :height="size">
        <circle :cx="size/2" :cy="size/2" :r="r" stroke="var(--bg-secondary)" :stroke-width="sw"></circle>
        <circle :cx="size/2" :cy="size/2" :r="r" :stroke="color" :stroke-width="sw"
          :stroke-dasharray="circ" :stroke-dashoffset="offset"></circle>
      </svg>
      <div class="ring-label" style="position:absolute">
        <div class="pct" :style="{color}">{{ Math.round(value) }}<span style="font-size:14px">%</span></div>
        <div class="txt" v-if="label">{{ label }}</div>
      </div>
    </div>`,
  computed: {
    r() { return (this.size - this.sw) / 2 },
    sw() { return 8 },
    circ() { return 2 * Math.PI * this.r },
    offset() { return this.circ * (1 - this.value / 100) },
  },
}
window.__CNF_VIEWS.RingProgress = RingProgress

// ---------------------------- 仪表板视图 ----------------------------
const DashboardView = {
  components: { RingProgress },
  props: { tab: { type: String, default: 'overview' } },
  setup(props) {
    const summary = ref({})
    const metrics = ref({ cluster: {}, gpus: [], hosts: [] })
    const tasks = ref([])
    const rules = ref([])
    let es = null
    let chart = null
    const history = []

    const cpuColor = (v) => (v > 80 ? '#FF3B30' : v > 60 ? '#FF9500' : '#34C759')

    const startStream = () => {
      es = new EventSource(window.API_BASE + '/monitoring/metrics/stream')
      es.onmessage = (e) => {
        const d = JSON.parse(e.data)
        metrics.value = d
        history.push(d.cluster.cpu_usage)
        if (history.length > 30) history.shift()
        if (chart) {
          chart.data.labels = history.map((_, i) => i)
          chart.data.datasets[0].data = [...history]
          chart.update('none')
        }
      }
    }

    const buildChart = async () => {
      await nextTick()
      const ctx = document.getElementById('dashboardCpuChart')
      if (ctx && window.Chart && !chart) {
        chart = new Chart(ctx, {
          type: 'line',
          data: { labels: [], datasets: [{ data: [], borderColor: '#0A84FF', backgroundColor: 'rgba(10,132,255,0.12)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
          options: { responsive: true, maintainAspectRatio: false, animation: false,
            scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }, x: { display: false } },
            plugins: { legend: { display: false } } },
        })
      }
    }

    onMounted(async () => {
      summary.value = await api('/summary')
      tasks.value = await api('/tasks')
      rules.value = await api('/alert-rules')
      startStream()
      if (props.tab !== 'alerts') buildChart()
    })
    // 切换到含图表的标签时重建
    watch(() => props.tab, async (tb) => {
      if (tb !== 'alerts') { chart = null; await buildChart() }
    })
    onBeforeUnmount(() => { if (es) es.close(); if (chart) chart.destroy() })

    const sevColor = (s) => (s === 'critical' ? 'var(--color-red)' : 'var(--color-orange)')

    return { summary, metrics, tasks, rules, cpuColor, sevColor, props, t }
  },
  template: `
    <div>
      <!-- ===== overview：资源概览 ===== -->
      <template v-if="props.tab==='overview'">
        <div class="grid grid-4">
          <div class="apple-card stat-card">
            <div class="flex between"><span class="label"><i class="fas fa-building" style="color:var(--color-blue)"></i> {{ t('dash_dc') }}</span></div>
            <div class="value">{{ summary.datacenters }}</div>
            <div class="sub">{{ summary.clusters }} {{ t('dash_clusters_n') }}</div>
          </div>
          <div class="apple-card stat-card">
            <div class="flex between"><span class="label"><i class="fas fa-server" style="color:var(--color-green)"></i> {{ t('host_machine') }}</span></div>
            <div class="value">{{ summary.hosts_connected }}<span style="font-size:18px;color:var(--text-secondary)">/{{ summary.hosts }}</span></div>
            <div class="sub">{{ t('dash_connected_total') }}</div>
          </div>
          <div class="apple-card stat-card">
            <div class="flex between"><span class="label"><i class="fas fa-desktop" style="color:var(--color-indigo)"></i> {{ t('dash_vms') }}</span></div>
            <div class="value">{{ summary.vms_running }}<span style="font-size:18px;color:var(--text-secondary)">/{{ summary.vms }}</span></div>
            <div class="sub">{{ t('dash_running_total') }}</div>
          </div>
          <div class="apple-card stat-card">
            <div class="flex between"><span class="label"><i class="fas fa-microchip" style="color:var(--color-pink)"></i> {{ t('dash_gpus') }}</span></div>
            <div class="value">{{ summary.gpus_assigned }}<span style="font-size:18px;color:var(--text-secondary)">/{{ summary.gpus }}</span></div>
            <div class="sub">{{ t('dash_assigned_total') }}</div>
          </div>
        </div>

        <div class="grid grid-2" style="margin-top:20px">
          <div class="apple-card">
            <div class="flex between" style="margin-bottom:16px">
              <strong>{{ t('dash_cpu_live') }}</strong>
              <span class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('dash_sse_live') }}</span>
            </div>
            <div style="height:200px"><canvas id="dashboardCpuChart"></canvas></div>
          </div>
          <div class="apple-card">
            <strong>{{ t('dash_pool_cap') }}</strong>
            <div style="margin-top:16px">
              <div class="flex between" style="margin-bottom:6px"><span class="muted">{{ t('dash_vcpu_alloc') }}</span><span class="mono">{{ metrics.cluster.used_vcpus }}/{{ metrics.cluster.total_vcpus }}</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:(metrics.cluster.used_vcpus/metrics.cluster.total_vcpus*100)+'%', background:'var(--color-blue)'}"></div></div>
              <div class="flex between" style="margin:14px 0 6px"><span class="muted">{{ t('dash_mem_alloc') }}</span><span class="mono">{{ metrics.cluster.used_mem_tb }}/{{ metrics.cluster.total_mem_tb }} TB</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:(metrics.cluster.used_mem_tb/metrics.cluster.total_mem_tb*100)+'%', background:'var(--color-indigo)'}"></div></div>
              <div class="flex between" style="margin:14px 0 6px"><span class="muted">{{ t('dash_mem_usage') }}</span><span class="mono">{{ metrics.cluster.mem_usage }}%</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:metrics.cluster.mem_usage+'%', background:cpuColor(metrics.cluster.mem_usage)}"></div></div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== performance：性能监控（实时任务 + CPU 折线）===== -->
      <template v-else-if="props.tab==='performance'">
        <div class="apple-card">
          <div class="flex between" style="margin-bottom:16px">
            <strong>{{ t('dash_cpu_live') }}</strong>
            <span class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('dash_sse_live') }}</span>
          </div>
          <div style="height:240px"><canvas id="dashboardCpuChart"></canvas></div>
        </div>
        <div class="section-title"><i class="fas fa-list-check"></i> {{ t('dash_recent_tasks') }}</div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('task_type') }}</th><th>{{ t('task_target') }}</th><th>{{ t('status') }}</th><th>{{ t('task_progress') }}</th><th>{{ t('task_operator') }}</th><th>{{ t('task_time') }}</th></tr></thead>
            <tbody>
              <tr v-for="tk in tasks" :key="tk.id">
                <td class="mono">{{ tk.type }}</td>
                <td>{{ tk.target }}</td>
                <td><span class="apple-badge" :class="{'apple-badge--running':tk.status==='running','apple-badge--stopped':tk.status==='success','apple-badge--error':tk.status==='failed'}"><span class="dot"></span>{{ {running:t('task_running'),success:t('task_success'),failed:t('task_failed')}[tk.status] }}</span></td>
                <td style="width:140px"><div class="apple-progress"><div class="bar" :style="{width:tk.progress+'%'}"></div></div></td>
                <td>{{ tk.user }}</td>
                <td class="muted">{{ tk.time }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== alerts：告警摘要 ===== -->
      <template v-else>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('rule_name') }}</th><th>{{ t('rule_metric') }}</th><th>{{ t('rule_condition') }}</th><th>{{ t('rule_severity') }}</th><th>{{ t('rule_triggered') }}</th><th>{{ t('rule_enabled') }}</th></tr></thead>
            <tbody>
              <tr v-for="r in rules" :key="r.id">
                <td><strong>{{ r.name }}</strong></td>
                <td class="mono muted">{{ r.metric }}</td>
                <td>{{ r.condition }}</td>
                <td><span class="apple-badge" :style="{color:sevColor(r.severity)}"><span class="dot" :style="{background:sevColor(r.severity)}"></span>{{ r.severity==='critical'?t('sev_critical'):t('sev_warning') }}</span></td>
                <td><strong :style="{color: r.triggered>0?'var(--color-orange)':'var(--text-tertiary)'}">{{ r.triggered }}</strong></td>
                <td><i :class="r.enabled?'fas fa-circle-check':'far fa-circle'" :style="{color:r.enabled?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.DashboardView = DashboardView
})()
