(function () {
const { ref, onMounted, computed, nextTick } = Vue
const api = window.api

// ============================ 视图：GPU 监控面板 ============================
const GPUView = {
  components: { RingProgress: window.__CNF_VIEWS.RingProgress },
  setup() {
    const gpus = ref([])
    const live = ref({})
    let es = null
    const utilColor = (v) => v > 85 ? '#FF3B30' : v > 60 ? '#FF9500' : '#34C759'
    onMounted(async () => {
      gpus.value = await api('/gpus')
      es = new EventSource('/api/metrics/stream')
      es.onmessage = (e) => {
        const d = JSON.parse(e.data)
        const m = {}; d.gpus.forEach(g => m[g.id] = g); live.value = m
      }
    })
    const merged = computed(() => gpus.value.map(g => ({ ...g, ...(live.value[g.id] || {}) })))
    return { merged, utilColor, t: window.t, i18n: window.i18n }
  },
  template: `
    <div>
      <div class="grid grid-3">
        <div class="apple-card gpu-card apple-card--glass" v-for="g in merged" :key="g.id">
          <div class="head">
            <div>
              <div class="model"><i class="fas fa-microchip" style="color:#76b900"></i> {{ g.model }}</div>
              <div class="meta">{{ g.host }} · {{ g.pci }} · NUMA {{ g.numa }}</div>
            </div>
            <span class="apple-badge" :class="g.status==='assigned'?'apple-badge--running':'apple-badge--stopped'">
              <span class="dot"></span>{{ g.status==='assigned' ? (g.mode==='vgpu'?t('gpu_vgpu'):t('gpu_passthrough')) : t('gpu_idle') }}
            </span>
          </div>
          <div style="position:relative">
            <RingProgress :value="g.util||0" :color="utilColor(g.util||0)" :label="t('gpu_util')" :size="100"/>
          </div>
          <div class="gpu-stats">
            <div class="gpu-stat">
              <div class="k">{{ t('gpu_vram') }}</div>
              <div class="v">{{ ((g.mem_used||0)/1024).toFixed(1) }} / {{ (g.vram_mb/1024).toFixed(0) }} GB</div>
              <div class="usage-bar" style="margin-top:6px"><div class="fill" :style="{width:((g.mem_used||0)/g.vram_mb*100)+'%',background:'var(--color-indigo)'}"></div></div>
            </div>
            <div class="gpu-stat">
              <div class="k">{{ t('gpu_temp') }}</div>
              <div class="v" :style="{color: g.temp>75?'var(--color-red)':'inherit'}">{{ g.temp||0 }}°C</div>
            </div>
            <div class="gpu-stat"><div class="k">{{ t('gpu_power') }}</div><div class="v">{{ g.power||0 }} W</div></div>
            <div class="gpu-stat"><div class="k">{{ t('gpu_bound_vm') }}</div><div class="v" style="font-size:13px">{{ g.vm || '—' }}</div></div>
          </div>
        </div>
      </div>
    </div>`,
}

// ============================ 视图：资源拓扑 ============================
const TopologyView = {
  setup() {
    const tree = ref([])
    const expanded = ref({})
    onMounted(async () => {
      tree.value = await api('/topology')
      // 默认展开第一层
      tree.value.forEach(dc => expanded.value['dc'+dc.id] = true)
    })
    const toggle = (k) => expanded.value[k] = !expanded.value[k]
    return { tree, expanded, toggle, t: window.t, i18n: window.i18n }
  },
  template: `
    <div class="apple-card">
      <div class="muted" style="margin-bottom:12px"><i class="fas fa-info-circle"></i> {{ t('topo_full_hint') }}</div>
      <div class="tree-node" v-for="dc in tree" :key="dc.id">
        <div class="tree-row" @click="toggle('dc'+dc.id)">
          <i class="fas fa-chevron-right chevron" :class="{open:expanded['dc'+dc.id]}"></i>
          <i class="fas fa-building" style="color:var(--color-blue)"></i>
          <strong>{{ dc.name }}</strong><span class="muted">· {{ dc.location }}</span>
        </div>
        <div class="tree-children" v-if="expanded['dc'+dc.id]">
          <div class="tree-node" v-for="cl in dc.children" :key="cl.id">
            <div class="tree-row" @click="toggle('cl'+cl.id)">
              <i class="fas fa-chevron-right chevron" :class="{open:expanded['cl'+cl.id]}"></i>
              <i class="fas fa-layer-group" style="color:var(--color-indigo)"></i>
              {{ cl.name }}
              <span v-if="cl.ha_enabled" class="apple-badge apple-badge--running" style="margin-left:6px"><span class="dot"></span>HA</span>
              <span v-if="cl.drs_enabled" class="apple-badge apple-badge--warning"><span class="dot"></span>DRS</span>
            </div>
            <div class="tree-children" v-if="expanded['cl'+cl.id]">
              <div class="tree-node" v-for="h in cl.children" :key="h.id">
                <div class="tree-row" @click="toggle('h'+h.id)">
                  <i class="fas fa-chevron-right chevron" :class="{open:expanded['h'+h.id]}"></i>
                  <i class="fas fa-server" :style="{color: h.status==='connected'?'var(--color-green)':'var(--color-orange)'}"></i>
                  {{ h.name }} <span class="muted">· {{ h.ip }} · {{ h.vcpus }}vCPU · {{ h.mem_total_gb }}GB</span>
                  <span v-if="h.gpus>0" class="apple-badge apple-badge--running" style="margin-left:6px"><span class="dot"></span>{{ h.gpus }} GPU</span>
                </div>
                <div class="tree-children" v-if="expanded['h'+h.id]">
                  <div class="tree-row" v-for="v in h.children" :key="v.id">
                    <span style="width:14px"></span>
                    <i class="fas fa-desktop" :style="{color: v.status==='running'?'var(--color-green)':v.status==='paused'?'var(--color-orange)':'var(--color-gray)'}"></i>
                    {{ v.name }} <span class="muted">· {{ v.vcpus }}vCPU · {{ v.mem_gb }}GB</span>
                    <span v-if="v.cpu_pinning" class="apple-badge apple-badge--running" style="margin-left:6px"><span class="dot"></span>{{ t('pin_numa') }}{{ v.numa }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`,
}

// ============================ 视图：虚拟机列表 ============================
const VMListView = {
  props: ['onCreate'],
  setup() {
    const vms = ref([])
    onMounted(async () => { vms.value = await api('/vms') })
    return { vms, t: window.t, i18n: window.i18n }
  },
  template: `
    <div>
      <div class="toolbar">
        <span class="muted">{{ vms.length }} {{ t('vm_count') }}</span>
        <div class="spacer"></div>
        <button class="apple-btn apple-btn--primary" @click="$root.openWizard()"><i class="fas fa-plus"></i> {{ t('vm_create') }}</button>
      </div>
      <div class="apple-card" style="padding:0">
        <table class="apple-table">
          <thead><tr><th>{{ t('col_name') }}</th><th>{{ t('col_status') }}</th><th>{{ t('col_cpu') }}</th><th>{{ t('col_mem') }}</th><th>{{ t('col_pin_numa') }}</th><th>{{ t('col_gpu') }}</th><th>{{ t('col_ha') }}</th><th>{{ t('col_ip') }}</th><th>{{ t('col_load') }}</th></tr></thead>
          <tbody>
            <tr v-for="v in vms" :key="v.id">
              <td><strong>{{ v.name }}</strong><div class="muted" style="font-size:12px">{{ v.os }}</div></td>
              <td><span class="apple-badge" :class="{'apple-badge--running':v.status==='running','apple-badge--warning':v.status==='paused','apple-badge--stopped':v.status==='stopped'}"><span class="dot"></span>{{ {running:t('st_running'),paused:t('st_paused'),stopped:t('st_stopped')}[v.status] }}</span></td>
              <td class="mono">{{ v.sockets }}×{{ v.cores }}×{{ v.threads }} = {{ v.vcpus }}</td>
              <td>{{ v.mem_gb }} GB</td>
              <td>
                <span v-if="v.cpu_pinning" class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('pinned') }}·N{{ v.numa }}</span>
                <span v-else class="muted">—</span>
              </td>
              <td>{{ v.gpus>0 ? v.gpus+' ×' : '—' }}</td>
              <td><i :class="v.ha?'fas fa-shield-halved':'far fa-circle'" :style="{color:v.ha?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
              <td class="mono muted">{{ v.ip }}</td>
              <td style="width:90px"><div class="usage-bar"><div class="fill" :style="{width:v.cpu_usage+'%',background:v.cpu_usage>80?'var(--color-red)':'var(--color-blue)'}"></div></div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`,
}

// ============================ 视图：存储 ============================
const StorageView = {
  setup() {
    const pools = ref([])
    onMounted(async () => { pools.value = await api('/storage-pools') })
    const typeColor = { local: 'var(--color-green)', nfs: 'var(--color-blue)', iscsi: 'var(--color-indigo)', fc: 'var(--color-purple)' }
    return { pools, typeColor, t: window.t, i18n: window.i18n }
  },
  template: `
    <div class="grid grid-2">
      <div class="apple-card" v-for="p in pools" :key="p.id">
        <div class="flex between" style="margin-bottom:14px">
          <div><strong>{{ p.name }}</strong><div class="muted" style="font-size:12px;margin-top:2px">{{ p.shared?t('st_shared'):t('st_local') }}</div></div>
          <span class="apple-badge" :style="{background:'rgba(0,0,0,0.04)',color:typeColor[p.type]}">{{ p.type.toUpperCase() }}</span>
        </div>
        <div class="flex between" style="margin-bottom:6px"><span class="muted">{{ t('st_capacity') }}</span><span class="mono">{{ p.used_tb }} / {{ p.capacity_tb }} TB</span></div>
        <div class="usage-bar"><div class="fill" :style="{width:(p.used_tb/p.capacity_tb*100)+'%',background:typeColor[p.type]}"></div></div>
        <div class="gpu-stats" style="margin-top:14px">
          <div class="gpu-stat"><div class="k">{{ t('st_read_iops') }}</div><div class="v">{{ p.read_iops.toLocaleString() }}</div></div>
          <div class="gpu-stat"><div class="k">{{ t('st_write_iops') }}</div><div class="v">{{ p.write_iops.toLocaleString() }}</div></div>
          <div class="gpu-stat"><div class="k">{{ t('st_latency') }}</div><div class="v">{{ p.latency }} ms</div></div>
          <div class="gpu-stat"><div class="k">{{ t('status') }}</div><div class="v" style="color:var(--color-green);font-size:14px">● {{ t('st_active') }}</div></div>
        </div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.GPUView = GPUView
window.__CNF_VIEWS.TopologyView = TopologyView
window.__CNF_VIEWS.VMListView = VMListView
window.__CNF_VIEWS.StorageView = StorageView
})()
