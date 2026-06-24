// =============================================================================
//  模块视图：基础设施 (view-infrastructure.js)
//  子标签：datacenter 数据中心（四层拓扑树）/ clusters 集群管理 / hosts 主机节点
//          / pools 资源池。API：/infrastructure/topology、/clusters、/hosts、/resource-pools。
// =============================================================================
(function () {
const { ref, onMounted, watch } = Vue
const api = window.api
const t = window.t

const InfrastructureView = {
  props: { tab: { type: String, default: 'datacenter' } },
  setup(props) {
    const tree = ref([])
    const expanded = ref({})
    const clusters = ref([])
    const hosts = ref([])
    const pools = ref([])

    const load = async () => {
      if (props.tab === 'datacenter' && !tree.value.length) {
        tree.value = await api('/infrastructure/topology')
        tree.value.forEach((dc) => (expanded.value['dc' + dc.id] = true))
      }
      if (props.tab === 'clusters' && !clusters.value.length) clusters.value = await api('/clusters')
      if (props.tab === 'hosts' && !hosts.value.length) hosts.value = await api('/hosts')
      if (props.tab === 'pools' && !pools.value.length) pools.value = await api('/resource-pools')
    }
    onMounted(load)
    watch(() => props.tab, load)
    const toggle = (k) => (expanded.value[k] = !expanded.value[k])
    const sharesLabel = (s) => ({ high: t('shares_high'), normal: t('shares_normal'), low: t('shares_low') }[s] || s)

    return { props, tree, expanded, toggle, clusters, hosts, pools, sharesLabel, t }
  },
  template: `
    <div>
      <!-- ===== datacenter：四层拓扑树 ===== -->
      <template v-if="props.tab==='datacenter'">
        <div class="apple-card">
          <div class="muted" style="margin-bottom:12px"><i class="fas fa-info-circle"></i> {{ t('topo_full_hint') }}</div>
          <div class="tree-node" v-for="dc in tree" :key="dc.id">
            <div class="tree-row" @click="toggle('dc'+dc.id)">
              <i class="fas fa-chevron-right chevron" :class="{open:expanded['dc'+dc.id]}"></i>
              <i class="fas fa-building" style="color:var(--color-blue)"></i><strong>{{ dc.name }}</strong><span class="muted">· {{ dc.location }}</span>
            </div>
            <div class="tree-children" v-if="expanded['dc'+dc.id]">
              <div class="tree-node" v-for="cl in dc.children" :key="cl.id">
                <div class="tree-row" @click="toggle('cl'+cl.id)">
                  <i class="fas fa-chevron-right chevron" :class="{open:expanded['cl'+cl.id]}"></i>
                  <i class="fas fa-layer-group" style="color:var(--color-indigo)"></i> {{ cl.name }}
                  <span v-if="cl.ha_enabled" class="apple-badge apple-badge--running" style="margin-left:6px"><span class="dot"></span>HA</span>
                  <span v-if="cl.drs_enabled" class="apple-badge apple-badge--warning"><span class="dot"></span>资源调度</span>
                </div>
                <div class="tree-children" v-if="expanded['cl'+cl.id]">
                  <div class="tree-node" v-for="h in cl.children" :key="h.id">
                    <div class="tree-row" @click="toggle('h'+h.id)">
                      <i class="fas fa-chevron-right chevron" :class="{open:expanded['h'+h.id]}"></i>
                      <i class="fas fa-server" :style="{color:h.status==='connected'?'var(--color-green)':'var(--color-orange)'}"></i>
                      {{ h.name }} <span class="muted">· {{ h.ip }} · {{ h.vcpus }}vCPU · {{ h.mem_total_gb }}GB</span>
                      <span v-if="h.gpus>0" class="apple-badge apple-badge--running" style="margin-left:6px"><span class="dot"></span>{{ h.gpus }} GPU</span>
                    </div>
                    <div class="tree-children" v-if="expanded['h'+h.id]">
                      <div class="tree-row" v-for="v in h.children" :key="v.id">
                        <span style="width:14px"></span>
                        <i class="fas fa-desktop" :style="{color:v.status==='running'?'var(--color-green)':v.status==='paused'?'var(--color-orange)':'var(--color-gray)'}"></i>
                        {{ v.name }} <span class="muted">· {{ v.vcpus }}vCPU · {{ v.mem_gb }}GB</span>
                        <span v-if="v.cpu_pinning" class="apple-badge apple-badge--running" style="margin-left:6px"><span class="dot"></span>{{ t('pin_numa') }}{{ v.numa }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== clusters：集群管理 ===== -->
      <template v-else-if="props.tab==='clusters'">
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('name') }}</th><th>HA</th><th>资源调度</th><th>CPU兼容</th><th>{{ t('cc_cpu_over') }}</th><th>{{ t('host_machine') }}</th><th>{{ t('dash_vms') }}</th></tr></thead>
            <tbody>
              <tr v-for="c in clusters" :key="c.id">
                <td><strong>{{ c.name }}</strong></td>
                <td><i :class="c.ha_enabled?'fas fa-circle-check':'far fa-circle'" :style="{color:c.ha_enabled?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
                <td><i :class="c.drs_enabled?'fas fa-circle-check':'far fa-circle'" :style="{color:c.drs_enabled?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
                <td class="muted">{{ c.evc_mode }}</td>
                <td class="mono">{{ c.overcommit_cpu }}×</td>
                <td>{{ c.hosts }}</td>
                <td>{{ c.vms }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== hosts：主机节点 ===== -->
      <template v-else-if="props.tab==='hosts'">
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('name') }}</th><th>{{ t('status') }}</th><th>IP</th><th>CPU</th><th>{{ t('col_mem') }}</th><th>{{ t('dash_vms') }}</th><th>GPU</th><th>{{ t('col_load') }}</th></tr></thead>
            <tbody>
              <tr v-for="h in hosts" :key="h.id">
                <td><strong>{{ h.name }}</strong><div class="muted" style="font-size:12px">{{ h.cpu_model }}</div></td>
                <td><span class="apple-badge" :class="h.status==='connected'?'apple-badge--running':'apple-badge--warning'"><span class="dot"></span>{{ h.status==='connected'?t('dash_connected'):'维护' }}</span></td>
                <td class="mono muted">{{ h.ip }}</td>
                <td class="mono">{{ h.sockets }}×{{ h.cores }}×{{ h.threads }} = {{ h.vcpus }}</td>
                <td class="mono">{{ h.mem_used_gb }}/{{ h.mem_total_gb }} GB</td>
                <td>{{ h.vms }}</td>
                <td>{{ h.gpus>0 ? h.gpus+' ×' : '—' }}</td>
                <td style="width:90px"><div class="usage-bar"><div class="fill" :style="{width:h.cpu_usage+'%',background:h.cpu_usage>80?'var(--color-red)':'var(--color-blue)'}"></div></div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== pools：资源池 ===== -->
      <template v-else>
        <div class="toolbar"><span class="muted">{{ pools.length }} {{ t('pool_title') }}</span><div class="spacer"></div><button class="apple-btn apple-btn--primary"><i class="fas fa-plus"></i> {{ t('pool_add') }}</button></div>
        <div class="grid grid-3">
          <div class="apple-card" v-for="p in pools" :key="p.id">
            <div class="flex between" style="margin-bottom:12px">
              <strong>{{ p.name }}</strong>
              <span class="apple-badge" :class="p.cpu_shares==='high'?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ sharesLabel(p.cpu_shares) }}</span>
            </div>
            <div class="gpu-stats">
              <div class="gpu-stat"><div class="k">{{ t('pool_cpu_limit') }}</div><div class="v">{{ p.cpu_limit_vcpu }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('pool_mem_limit') }}</div><div class="v">{{ p.mem_limit_gb }} GB</div></div>
              <div class="gpu-stat"><div class="k">{{ t('pool_cpu_reserved') }}</div><div class="v">{{ p.cpu_reserved_vcpu }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('pool_mem_reserved') }}</div><div class="v">{{ p.mem_reserved_gb }} GB</div></div>
              <div class="gpu-stat"><div class="k">{{ t('pool_vms') }}</div><div class="v">{{ p.vms }}</div></div>
            </div>
          </div>
        </div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.InfrastructureView = InfrastructureView
})()
