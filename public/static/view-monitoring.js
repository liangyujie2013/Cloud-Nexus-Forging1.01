// =============================================================================
//  模块视图：监控告警 (view-monitoring.js)
//  子标签：realtime 实时监控（GPU 实时面板，SSE 推送）/ history 历史性能（主机负载）
//          / rules 告警规则。API：/gpus、/hosts、/alert-rules、SSE /monitoring/metrics/stream。
// =============================================================================
(function () {
const { ref, computed, onMounted, onBeforeUnmount, watch } = Vue
const api = window.api
const t = window.t

const MonitoringView = {
  components: { RingProgress: window.__CNF_VIEWS.RingProgress },
  props: { tab: { type: String, default: 'realtime' } },
  setup(props) {
    const gpus = ref([])
    const hosts = ref([])
    const rules = ref([])
    const live = ref({})
    const liveHosts = ref({})
    let es = null

    const utilColor = (v) => (v > 85 ? '#FF3B30' : v > 60 ? '#FF9500' : '#34C759')
    const sevColor = (s) => (s === 'critical' ? 'var(--color-red)' : 'var(--color-orange)')

    const startStream = () => {
      if (es) return
      es = new EventSource(window.API_BASE + '/monitoring/metrics/stream')
      es.onmessage = (e) => {
        const d = JSON.parse(e.data)
        const gm = {}; d.gpus.forEach((g) => (gm[g.id] = g)); live.value = gm
        const hm = {}; d.hosts.forEach((h) => (hm[h.id] = h)); liveHosts.value = hm
      }
    }

    const load = async () => {
      if (props.tab === 'realtime') { if (!gpus.value.length) gpus.value = await api('/gpus'); startStream() }
      if (props.tab === 'history') { if (!hosts.value.length) hosts.value = await api('/hosts'); startStream() }
      if (props.tab === 'rules' && !rules.value.length) rules.value = await api('/alert-rules')
    }
    onMounted(load)
    watch(() => props.tab, load)
    onBeforeUnmount(() => { if (es) es.close() })

    const mergedGpus = computed(() => gpus.value.map((g) => ({ ...g, ...(live.value[g.id] || {}) })))
    const mergedHosts = computed(() => hosts.value.map((h) => ({ ...h, cpu_usage: (liveHosts.value[h.id] || {}).cpu_usage ?? h.cpu_usage })))

    return { props, mergedGpus, mergedHosts, rules, utilColor, sevColor, t }
  },
  template: `
    <div>
      <!-- ===== realtime：实时监控（GPU）===== -->
      <template v-if="props.tab==='realtime'">
        <div class="toolbar"><span class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('dash_sse_live') }}</span></div>
        <div class="grid grid-3">
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
      </template>

      <!-- ===== history：历史性能（主机负载）===== -->
      <template v-else-if="props.tab==='history'">
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('host_machine') }}</th><th>{{ t('status') }}</th><th>CPU</th><th>{{ t('col_mem') }}</th><th>{{ t('col_load') }}</th></tr></thead>
            <tbody>
              <tr v-for="h in mergedHosts" :key="h.id">
                <td><strong>{{ h.name }}</strong><div class="muted" style="font-size:12px">{{ h.cpu_model }}</div></td>
                <td><span class="apple-badge" :class="h.status==='connected'?'apple-badge--running':'apple-badge--warning'"><span class="dot"></span>{{ h.status==='connected'?t('dash_connected'):'维护' }}</span></td>
                <td class="mono">{{ h.vcpus }} vCPU</td>
                <td class="mono">{{ h.mem_used_gb }}/{{ h.mem_total_gb }} GB</td>
                <td style="width:160px"><div class="flex between" style="margin-bottom:3px"><span class="mono" style="font-size:12px">{{ Math.round(h.cpu_usage) }}%</span></div><div class="usage-bar"><div class="fill" :style="{width:h.cpu_usage+'%',background:h.cpu_usage>80?'var(--color-red)':'var(--color-blue)',transition:'width .5s'}"></div></div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== rules：告警规则 ===== -->
      <template v-else>
        <div class="toolbar"><span class="muted">{{ rules.length }} {{ t('rule_title') }}</span><div class="spacer"></div><button class="apple-btn apple-btn--primary"><i class="fas fa-plus"></i> {{ t('rule_add') }}</button></div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('rule_name') }}</th><th>{{ t('rule_metric') }}</th><th>{{ t('rule_condition') }}</th><th>{{ t('rule_severity') }}</th><th>{{ t('rule_triggered') }}</th><th>{{ t('rule_channel') }}</th><th>{{ t('rule_enabled') }}</th></tr></thead>
            <tbody>
              <tr v-for="r in rules" :key="r.id">
                <td><strong>{{ r.name }}</strong></td>
                <td class="mono muted">{{ r.metric }}</td>
                <td>{{ r.condition }}</td>
                <td><span class="apple-badge" :style="{color:sevColor(r.severity)}"><span class="dot" :style="{background:sevColor(r.severity)}"></span>{{ r.severity==='critical'?t('sev_critical'):t('sev_warning') }}</span></td>
                <td><strong :style="{color: r.triggered>0?'var(--color-orange)':'var(--text-tertiary)'}">{{ r.triggered }}</strong></td>
                <td class="muted">{{ r.channel }}</td>
                <td><i :class="r.enabled?'fas fa-circle-check':'far fa-circle'" :style="{color:r.enabled?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.MonitoringView = MonitoringView
})()
