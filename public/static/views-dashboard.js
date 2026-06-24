// CNFv1.0 前端应用（Vue 3 Global build，无构建步骤，CDN 加载）
(function () {
const { ref, computed, onMounted, nextTick } = Vue

window.api = (path, opts) => fetch('/api' + path, opts).then(r => r.json())
const api = window.api

// ============================ 复用：圆环进度组件 ============================
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

// ============================ 视图：仪表盘 ============================
const DashboardView = {
  components: { RingProgress },
  setup() {
    const summary = ref({})
    const metrics = ref({ cluster: {}, gpus: [], hosts: [] })
    const tasks = ref([])
    let es = null
    let chart = null

    const cpuColor = (v) => v > 80 ? '#FF3B30' : v > 60 ? '#FF9500' : '#34C759'

    onMounted(async () => {
      summary.value = await api('/summary')
      tasks.value = await api('/tasks')
      // SSE 实时流
      es = new EventSource('/api/metrics/stream')
      const history = []
      es.onmessage = (e) => {
        const d = JSON.parse(e.data)
        metrics.value = d
        history.push(d.cluster.cpu_usage)
        if (history.length > 30) history.shift()
        if (chart) { chart.data.labels = history.map((_, i) => i); chart.data.datasets[0].data = [...history]; chart.update('none') }
      }
      await nextTick()
      const ctx = document.getElementById('cpuChart')
      if (ctx) {
        chart = new Chart(ctx, {
          type: 'line',
          data: { labels: [], datasets: [{ data: [], borderColor: '#007AFF', backgroundColor: 'rgba(0,122,255,0.1)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
          options: { responsive: true, maintainAspectRatio: false, animation: false,
            scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } }, x: { display: false } },
            plugins: { legend: { display: false } } },
        })
      }
    })

    return { summary, metrics, tasks, cpuColor, t: window.t, i18n: window.i18n }
  },
  template: `
    <div>
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
          <div style="height:200px"><canvas id="cpuChart"></canvas></div>
        </div>
        <div class="apple-card">
          <strong>{{ t('dash_pool_cap') }}</strong>
          <div style="margin-top:16px">
            <div class="flex between" style="margin-bottom:6px"><span class="muted">{{ t('dash_vcpu_alloc') }}</span><span class="mono">{{ metrics.cluster.used_vcpus }}/{{ metrics.cluster.total_vcpus }}</span></div>
            <div class="usage-bar"><div class="fill" :style="{width: (metrics.cluster.used_vcpus/metrics.cluster.total_vcpus*100)+'%', background:'var(--color-blue)'}"></div></div>
            <div class="flex between" style="margin:14px 0 6px"><span class="muted">{{ t('dash_mem_alloc') }}</span><span class="mono">{{ metrics.cluster.used_mem_tb }}/{{ metrics.cluster.total_mem_tb }} TB</span></div>
            <div class="usage-bar"><div class="fill" :style="{width: (metrics.cluster.used_mem_tb/metrics.cluster.total_mem_tb*100)+'%', background:'var(--color-indigo)'}"></div></div>
            <div class="flex between" style="margin:14px 0 6px"><span class="muted">{{ t('dash_mem_usage') }}</span><span class="mono">{{ metrics.cluster.mem_usage }}%</span></div>
            <div class="usage-bar"><div class="fill" :style="{width: metrics.cluster.mem_usage+'%', background: cpuColor(metrics.cluster.mem_usage)}"></div></div>
          </div>
        </div>
      </div>

      <div class="section-title"><i class="fas fa-list-check"></i> {{ t('dash_recent_tasks') }}</div>
      <div class="apple-card" style="padding:0">
        <table class="apple-table">
          <thead><tr><th>{{ t('task_type') }}</th><th>{{ t('task_target') }}</th><th>{{ t('status') }}</th><th>{{ t('task_progress') }}</th><th>{{ t('task_operator') }}</th><th>{{ t('task_time') }}</th></tr></thead>
          <tbody>
            <tr v-for="t2 in tasks" :key="t2.id">
              <td class="mono">{{ t2.type }}</td>
              <td>{{ t2.target }}</td>
              <td>
                <span class="apple-badge" :class="{'apple-badge--running':t2.status==='running','apple-badge--stopped':t2.status==='success','apple-badge--error':t2.status==='failed'}">
                  <span class="dot"></span>{{ {running:t('task_running'),success:t('task_success'),failed:t('task_failed')}[t2.status] }}
                </span>
              </td>
              <td style="width:140px"><div class="apple-progress"><div class="bar" :style="{width:t2.progress+'%'}"></div></div></td>
              <td>{{ t2.user }}</td>
              <td class="muted">{{ t2.time }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`,
}

window.__CNF_VIEWS = { DashboardView, RingProgress }
})()
