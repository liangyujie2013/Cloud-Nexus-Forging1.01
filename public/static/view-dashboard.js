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
  props: { value: { type: Number, default: 0 }, size: { type: Number, default: 88 }, color: { type: String, default: '#005A9C' }, label: String },
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
    // summary 现由真实拓扑 + GPU 清单派生（后端无 /summary 端点），见下方 summary computed。
    // hostMetrics：来自真实 /hosts/metrics（字段 cpu_usage_pct / mem_usage_pct），按 host id 索引。
    const hostMetrics = ref({})
    // 预置 cluster 字段，避免首屏（SSE 未到达前）容量条出现「裸单位」无数值的难看状态
    const metrics = ref({ cluster: { cpu_usage: 0, mem_usage: 0, total_vcpus: 0, used_vcpus: 0, total_mem_tb: 0, used_mem_tb: 0 }, gpus: [], hosts: [] })
    const clusters = ref([])
    const tasks = ref([])
    const rules = ref([])
    // P1：GPU 设备清单（含归属主机 / 使用方 VM / 模式 / 状态），用于让 GPU 概要「说清楚谁的卡、给了谁」
    const gpuInventory = ref([])
    let es = null
    let chart = null
    const history = []

    const cpuColor = (v) => (v > 80 ? '#E53E3E' : v > 60 ? '#F5A623' : '#00A859')
    const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0)

    // P1：GPU 概要按「分配状态」统计（已分配/可分配），比单纯 util>5 更贴近企业语义
    const gpuSummary = computed(() => {
      const inv = gpuInventory.value || []
      if (!inv.length) {
        const list = metrics.value.gpus || []
        const busy = list.filter((g) => g.util > 5).length
        const avgUtil = list.length ? Math.round(list.reduce((s, g) => s + g.util, 0) / list.length) : 0
        return { total: list.length, busy, idle: list.length - busy, avgUtil }
      }
      const liveById = {}
      ;(metrics.value.gpus || []).forEach((g) => { liveById[g.id] = g })
      const assigned = inv.filter((g) => g.status === 'assigned').length
      const utils = inv.map((g) => (liveById[g.id] ? liveById[g.id].util : g.util) || 0)
      const avgUtil = utils.length ? Math.round(utils.reduce((a, b) => a + b, 0) / utils.length) : 0
      return { total: inv.length, busy: assigned, idle: inv.length - assigned, avgUtil }
    })

    // P1：GPU 明细行——把静态归属（host / vm / mode / status）与实时 util/temp 合并，
    // 让仪表板能回答「这块卡是谁的、装在哪台主机、给了哪个 VM」。
    const gpuRows = computed(() => {
      const liveById = {}
      ;(metrics.value.gpus || []).forEach((g) => { liveById[g.id] = g })
      return (gpuInventory.value || []).map((g) => {
        const live = liveById[g.id] || {}
        return {
          id: g.id, model: g.model, host: g.host, host_id: g.host_id,
          vm: g.vm, status: g.status, mode: g.mode, numa: g.numa,
          vram_gb: Math.round((g.vram_mb || 0) / 1024),
          util: live.util != null ? live.util : (g.util || 0),
          temp: live.temp != null ? live.temp : (g.temp || 0),
        }
      })
    })

    // 真实派生 summary：基于拓扑 store（数据中心/集群/主机/VM）+ GPU 清单。
    // 后端无 /summary 聚合端点，故在前端按单一可信来源（store）实时计算，避免顶部卡片空白。
    const summary = computed(() => {
      const tp = window.cnfTopology
      const hosts = tp ? tp.hostStats.value : []
      const vms = (tp && tp.state && tp.state.vms) ? tp.state.vms : []
      const dcs = (tp && tp.state && tp.state.datacenters) ? tp.state.datacenters : []
      const cls = clusters.value && clusters.value.length ? clusters.value : ((tp && tp.state && tp.state.clusters) ? tp.state.clusters : [])
      const gpus = gpuInventory.value || []
      return {
        datacenters: dcs.length,
        clusters: cls.length,
        hosts: hosts.length,
        hosts_connected: hosts.filter((h) => h.status === 'connected').length,
        vms: vms.length,
        vms_running: vms.filter((v) => v.status === 'running').length,
        gpus: gpus.length,
        gpus_assigned: gpus.filter((g) => g.status === 'assigned').length,
      }
    })

    // 单台主机实时 CPU%（优先真实 SSE 帧 metrics.hosts，回退 /hosts/metrics 快照）。
    const hostCpu = (h) => {
      const sse = (metrics.value.hosts || []).find((x) => x.id === h.id)
      if (sse && sse.cpu_usage != null) return sse.cpu_usage
      const m = hostMetrics.value[String(h.id)]
      return (m && m.reachable !== false && m.cpu_usage_pct != null) ? m.cpu_usage_pct : null
    }
    const hostMem = (h) => {
      const m = hostMetrics.value[String(h.id)]
      return (m && m.reachable !== false && m.mem_usage_pct != null) ? m.mem_usage_pct : null
    }

    // 按集群聚合主机负载——使用真实 /hosts/metrics，仅统计采集到的主机，杜绝 NaN。
    const clusterLoad = computed(() => {
      return clusters.value.map((cl) => {
        const hosts = (window.cnfTopology ? window.cnfTopology.hostStats.value : []).filter((h) => h.cluster_id === cl.id)
        const cpuVals = hosts.map(hostCpu).filter((v) => v != null && !Number.isNaN(v))
        const memVals = hosts.map(hostMem).filter((v) => v != null && !Number.isNaN(v))
        const cpu = cpuVals.length ? Math.round(cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length) : 0
        const mem = memVals.length ? Math.round(memVals.reduce((a, b) => a + b, 0) / memVals.length) : 0
        return { id: cl.id, name: cl.name, host_count: cl.host_count, host_online: cl.host_online, cpu, mem }
      })
    })

    // 拉取真实主机实时指标快照（用于集群负载/容量条），定时刷新。
    let metricsTimer = null
    const refreshHostMetrics = async () => {
      const res = await api('/hosts/metrics')
      if (res && !res.error) {
        hostMetrics.value = res
        // 用真实数据填充集群级 CPU/内存快照（取所有可达主机均值），供顶部 CPU 折线与容量条使用。
        const vals = Object.values(res).filter((m) => m && m.reachable !== false)
        if (vals.length) {
          const avgCpu = Math.round(vals.reduce((a, m) => a + (m.cpu_usage_pct || 0), 0) / vals.length)
          const avgMem = Math.round(vals.reduce((a, m) => a + (m.mem_usage_pct || 0), 0) / vals.length)
          const totMem = vals.reduce((a, m) => a + (m.mem_total_mb || 0), 0)
          const usedMem = vals.reduce((a, m) => a + (m.mem_used_mb || 0), 0)
          metrics.value = {
            ...metrics.value,
            cluster: {
              ...metrics.value.cluster,
              cpu_usage: avgCpu, mem_usage: avgMem,
              total_mem_tb: +(totMem / 1024 / 1024).toFixed(2),
              used_mem_tb: +(usedMem / 1024 / 1024).toFixed(2),
            },
          }
          history.push(avgCpu)
          if (history.length > 30) history.shift()
          if (chart) { chart.data.labels = history.map((_, i) => i); chart.data.datasets[0].data = [...history]; chart.update('none') }
        }
      }
    }

    const startStream = () => {
      // 真实后端 SSE 路径为 /metrics/stream；demo Mock 为 /monitoring/metrics/stream。
      // EventSource 无法携带 Authorization 头，真实后端要求 JWT 时会握手失败——
      // 这里捕获 onerror 并关闭，避免控制台噪音与潜在阻塞；监控数据缺失不影响其余面板。
      const isReal = window.cnfIsReal && window.cnfIsReal()
      const streamPath = isReal ? '/metrics/stream' : '/monitoring/metrics/stream'
      try {
        es = new EventSource(window.API_BASE + streamPath)
      } catch (e) {
        es = null
        return
      }
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data)
          if (!d || !d.cluster) return
          metrics.value = d
          history.push(d.cluster.cpu_usage)
          if (history.length > 30) history.shift()
          if (chart) {
            chart.data.labels = history.map((_, i) => i)
            chart.data.datasets[0].data = [...history]
            chart.update('none')
          }
        } catch (err) { /* 单帧解析失败忽略 */ }
      }
      es.onerror = () => {
        // 实时流不可用（端点缺失 / 鉴权 / 网络）：静默关闭，保留快照与静态数据。
        if (es) { es.close(); es = null }
      }
    }

    const buildChart = async () => {
      await nextTick()
      const ctx = document.getElementById('dashboardCpuChart')
      if (ctx && window.Chart && !chart) {
        chart = new Chart(ctx, {
          type: 'line',
          data: { labels: history.map((_, i) => i), datasets: [{ data: [...history], borderColor: '#005A9C', backgroundColor: 'rgba(0,90,156,0.12)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
          options: { responsive: true, maintainAspectRatio: false, animation: false,
            scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }, x: { display: false } },
            plugins: { legend: { display: false } } },
        })
      }
    }

    // 小工具：api() 失败时返回 {error}，这里统一兜底，避免把错误对象塞进数据态导致渲染异常。
    const okOr = (res, fallback) => (res && !res.error ? res : fallback)
    onMounted(async () => {
      // 确保拓扑 store 已加载（summary computed 依赖它）。
      if (window.cnfTopology && window.cnfTopology.fetchAll) { try { await window.cnfTopology.fetchAll() } catch (e) {} }
      clusters.value = okOr(await api('/clusters'), [])
      tasks.value = okOr(await api('/tasks'), [])
      rules.value = okOr(await api('/alert-rules'), [])
      gpuInventory.value = okOr(await api('/gpus'), [])  // P1：GPU 归属清单
      // 真实主机指标：首屏拉一次 + 每 5s 刷新（集群负载/容量条/CPU 折线据此）。
      await refreshHostMetrics()
      metricsTimer = setInterval(refreshHostMetrics, 5000)
      startStream()
      if (props.tab !== 'alerts') buildChart()
    })
    // 切换到含图表的标签时重建
    watch(() => props.tab, async (tb) => {
      if (tb !== 'alerts') { chart = null; await buildChart() }
    })
    onBeforeUnmount(() => { if (es) es.close(); if (chart) chart.destroy(); if (metricsTimer) clearInterval(metricsTimer) })

    const sevColor = (s) => (s === 'critical' ? 'var(--color-red)' : 'var(--color-orange)')

    return { summary, metrics, clusters, tasks, rules, cpuColor, pct, sevColor, gpuSummary, gpuRows, gpuInventory, clusterLoad, props, t }
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
            <div class="sub">{{ t('dash_assigned_total') }} · gpu-node-01/02</div>
          </div>
        </div>

        <div class="grid grid-2" style="margin-top:20px">
          <div class="apple-card">
            <div class="flex between" style="margin-bottom:6px">
              <strong>{{ t('dash_cpu_live') }}</strong>
              <span class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('dash_sse_live') }}</span>
            </div>
            <div class="muted" style="font-size:12px;margin-bottom:10px"><i class="fas fa-crosshairs"></i> {{ t('dash_cpu_scope_all') }} · {{ clusters.length }} {{ t('dash_clusters_n') }} / {{ summary.hosts }} {{ t('host_machine') }} · {{ t('dash_cpu_legend') }}</div>
            <div style="height:188px"><canvas id="dashboardCpuChart"></canvas></div>
          </div>
          <div class="apple-card">
            <strong>{{ t('dash_pool_cap') }}</strong>
            <div class="muted" style="font-size:12px;margin-top:4px"><i class="fas fa-layer-group"></i> {{ t('dash_cpu_scope_all') }} · {{ clusters.length }} {{ t('dash_clusters_n') }}</div>
            <div style="margin-top:14px">
              <div class="flex between" style="margin-bottom:6px"><span class="muted">{{ t('dash_vcpu_alloc') }}</span><span class="mono">{{ metrics.cluster.used_vcpus }} / {{ metrics.cluster.total_vcpus }} ({{ pct(metrics.cluster.used_vcpus, metrics.cluster.total_vcpus) }}%)</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:pct(metrics.cluster.used_vcpus,metrics.cluster.total_vcpus)+'%', background:'var(--color-blue)'}"></div></div>
              <div class="flex between" style="margin:14px 0 6px"><span class="muted">{{ t('dash_mem_alloc') }}</span><span class="mono">{{ metrics.cluster.used_mem_tb }} / {{ metrics.cluster.total_mem_tb }} TB ({{ pct(metrics.cluster.used_mem_tb, metrics.cluster.total_mem_tb) }}%)</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:pct(metrics.cluster.used_mem_tb,metrics.cluster.total_mem_tb)+'%', background:'var(--color-indigo)'}"></div></div>
              <div class="flex between" style="margin:14px 0 6px"><span class="muted">{{ t('dash_mem_usage') }}</span><span class="mono">{{ Math.round(metrics.cluster.mem_usage) }}%</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:metrics.cluster.mem_usage+'%', background:cpuColor(metrics.cluster.mem_usage)}"></div></div>
            </div>
          </div>
        </div>

        <!-- 第三行：各集群实时负载 + GPU 概要（让概览更充实有用）-->
        <div class="grid grid-2" style="margin-top:20px">
          <div class="apple-card">
            <strong><i class="fas fa-layer-group" style="color:var(--color-indigo)"></i> {{ t('dash_cluster_load') }}</strong>
            <div class="dash-cluster-list" style="margin-top:14px">
              <div v-for="cl in clusterLoad" :key="cl.id" class="dash-cluster-row">
                <div class="dcr-name">{{ cl.name }} <span class="muted" style="font-size:12px;font-weight:400" :title="t('host_conn_rate_tip')">· {{ cl.host_online }}/{{ cl.host_count }} {{ t('host_connected') }}</span></div>
                <div class="dcr-bars">
                  <div class="dcr-bar"><span class="muted">CPU</span><div class="usage-bar"><div class="fill" :style="{width:cl.cpu+'%',background:cpuColor(cl.cpu)}"></div></div><span class="mono">{{ cl.cpu }}%</span></div>
                  <div class="dcr-bar"><span class="muted">{{ t('col_mem') }}</span><div class="usage-bar"><div class="fill" :style="{width:cl.mem+'%',background:cpuColor(cl.mem)}"></div></div><span class="mono">{{ cl.mem }}%</span></div>
                </div>
              </div>
              <div v-if="!clusterLoad.length" class="muted" style="text-align:center;padding:14px">—</div>
            </div>
          </div>
          <div class="apple-card">
            <strong><i class="fas fa-microchip" style="color:var(--color-pink)"></i> {{ t('dash_gpu_summary') }}</strong>
            <div class="muted" style="font-size:12px;margin-top:4px"><i class="fas fa-circle-info"></i> {{ t('dash_gpu_summary_obj') }}</div>
            <div class="dash-gpu-stats" style="margin-top:12px">
              <div class="dgs-item"><div class="dgs-num">{{ gpuSummary.total }}</div><div class="muted">{{ t('dash_gpu_total') }}</div></div>
              <div class="dgs-item"><div class="dgs-num" style="color:var(--color-green)">{{ gpuSummary.busy }}</div><div class="muted">{{ t('dash_gpu_assigned') }}</div></div>
              <div class="dgs-item"><div class="dgs-num" style="color:var(--text-tertiary)">{{ gpuSummary.idle }}</div><div class="muted">{{ t('dash_gpu_available') }}</div></div>
              <div class="dgs-item"><div class="dgs-num" :style="{color:cpuColor(gpuSummary.avgUtil)}">{{ gpuSummary.avgUtil }}%</div><div class="muted">{{ t('dash_gpu_avg') }}</div></div>
            </div>
            <!-- P1：每块 GPU 明确「型号 + 所在主机 + 使用方 VM + 状态」，不再是孤立的 GPU1 97% -->
            <div class="gpu-owner-list" style="margin-top:14px">
              <div v-for="g in gpuRows" :key="g.id" class="gpu-owner-row">
                <div class="gor-head">
                  <span class="gor-model"><i class="fas fa-microchip" style="color:#76b900"></i> {{ g.model }}</span>
                  <span class="apple-badge" :class="g.status==='assigned'?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ g.status==='assigned' ? t('dash_gpu_assigned') : t('dash_gpu_available') }}</span>
                </div>
                <div class="gor-meta muted">
                  <span><i class="fas fa-server"></i> {{ g.host }}</span>
                  <span><i class="fas fa-plug"></i> {{ g.mode==='vgpu' ? t('dash_gpu_mode_vgpu') : t('dash_gpu_mode_pt') }} · NUMA{{ g.numa }} · {{ g.vram_gb }}GB</span>
                  <span v-if="g.vm" style="color:var(--color-blue)"><i class="fas fa-desktop"></i> {{ t('dash_gpu_card_vm') }} {{ g.vm }}</span>
                  <span v-else style="color:var(--text-tertiary)"><i class="fas fa-circle-minus"></i> {{ t('dash_gpu_unassigned_vm') }}</span>
                </div>
                <div class="gor-bar">
                  <div class="usage-bar" style="flex:1"><div class="fill" :style="{width:g.util+'%',background:cpuColor(g.util)}"></div></div>
                  <span class="mono" style="font-size:12px;min-width:42px;text-align:right">{{ Math.round(g.util) }}%</span>
                  <span class="muted mono" style="font-size:11px;min-width:46px;text-align:right">{{ Math.round(g.temp) }}°C</span>
                </div>
              </div>
              <div v-if="!gpuRows.length" class="muted" style="text-align:center;padding:14px">—</div>
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
