// =============================================================================
//  模块视图：网络管理 (view-network.js)
//  子标签：vswitch 虚拟交换机（Open vSwitch）/ vlan VLAN 配置 / topology 网络拓扑。
//  API：/vswitches、/vlans、/network/topology。
// =============================================================================
(function () {
const { ref, onMounted, watch } = Vue
const api = window.api
const t = window.t

const NetworkView = {
  props: { tab: { type: String, default: 'vswitch' } },
  setup(props) {
    const vswitches = ref([])
    const vlans = ref([])
    const topo = ref([])
    const expanded = ref({})

    const load = async () => {
      if (props.tab === 'vswitch' && !vswitches.value.length) vswitches.value = await api('/vswitches')
      if (props.tab === 'vlan' && !vlans.value.length) vlans.value = await api('/vlans')
      if (props.tab === 'topology' && !topo.value.length) {
        topo.value = await api('/network/topology')
        topo.value.forEach((sw) => (expanded.value['sw' + sw.id] = true))
      }
    }
    onMounted(load)
    watch(() => props.tab, load)
    const toggle = (k) => (expanded.value[k] = !expanded.value[k])

    return { props, vswitches, vlans, topo, expanded, toggle, t }
  },
  template: `
    <div>
      <!-- ===== vswitch：虚拟交换机 ===== -->
      <template v-if="props.tab==='vswitch'">
        <div class="toolbar"><span class="muted">{{ vswitches.length }} {{ t('sw_title') }}</span><div class="spacer"></div><button class="apple-btn apple-btn--primary"><i class="fas fa-plus"></i> {{ t('sw_add') }}</button></div>
        <div class="grid grid-2">
          <div class="apple-card" v-for="sw in vswitches" :key="sw.id">
            <div class="flex between" style="margin-bottom:12px">
              <div><strong>{{ sw.name }}</strong><div class="muted" style="font-size:12px;margin-top:2px"><i class="fas fa-network-wired"></i> {{ sw.type }}</div></div>
              <span class="apple-badge apple-badge--running"><span class="dot"></span>MTU {{ sw.mtu }}</span>
            </div>
            <div class="gpu-stats">
              <div class="gpu-stat"><div class="k">{{ t('sw_uplink') }}</div><div class="v" style="font-size:13px">{{ sw.uplink }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('sw_ports') }}</div><div class="v">{{ sw.ports }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('sw_vlans') }}</div><div class="v" style="font-size:13px">{{ sw.vlans.join(', ') }}</div></div>
            </div>
            <div style="margin-top:12px"><span class="muted" style="font-size:12px">{{ t('sw_hosts') }}：</span>
              <span v-for="h in sw.hosts" :key="h" class="host-chip" style="margin:2px"><i class="fas fa-server muted"></i> {{ h }}</span>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== vlan：VLAN 配置 ===== -->
      <template v-else-if="props.tab==='vlan'">
        <div class="toolbar"><span class="muted">{{ vlans.length }} {{ t('vlan_title') }}</span><div class="spacer"></div><button class="apple-btn apple-btn--primary"><i class="fas fa-plus"></i> {{ t('vlan_add') }}</button></div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('vlan_id') }}</th><th>{{ t('vlan_name') }}</th><th>{{ t('vlan_subnet') }}</th><th>{{ t('vlan_gateway') }}</th><th>{{ t('vlan_vswitch') }}</th><th>{{ t('vlan_vms') }}</th><th>{{ t('vlan_dhcp') }}</th></tr></thead>
            <tbody>
              <tr v-for="v in vlans" :key="v.id">
                <td><span class="apple-badge apple-badge--running"><span class="dot"></span>VLAN {{ v.vlan_id }}</span></td>
                <td><strong>{{ v.name }}</strong></td>
                <td class="mono">{{ v.subnet }}</td>
                <td class="mono muted">{{ v.gateway }}</td>
                <td class="muted">{{ v.vswitch }}</td>
                <td>{{ v.vms }}</td>
                <td><i :class="v.dhcp?'fas fa-circle-check':'far fa-circle'" :style="{color:v.dhcp?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== topology：网络拓扑（交换机 → VLAN）===== -->
      <template v-else>
        <div class="apple-card">
          <div class="muted" style="margin-bottom:12px"><i class="fas fa-info-circle"></i> {{ t('net_topo_hint') }}</div>
          <div class="tree-node" v-for="sw in topo" :key="sw.id">
            <div class="tree-row" @click="toggle('sw'+sw.id)">
              <i class="fas fa-chevron-right chevron" :class="{open:expanded['sw'+sw.id]}"></i>
              <i class="fas fa-network-wired" style="color:var(--color-blue)"></i> <strong>{{ sw.name }}</strong>
              <span class="muted">· {{ sw.type }} · MTU {{ sw.mtu }} · {{ sw.ports }} ports</span>
            </div>
            <div class="tree-children" v-if="expanded['sw'+sw.id]">
              <div class="tree-row" v-for="vl in sw.children" :key="vl.id">
                <span style="width:14px"></span>
                <i class="fas fa-diagram-project" style="color:var(--color-indigo)"></i>
                <span class="apple-badge apple-badge--running" style="margin-right:6px"><span class="dot"></span>VLAN {{ vl.vlan_id }}</span>
                {{ vl.name }} <span class="muted">· {{ vl.subnet }} · {{ vl.vms }} {{ t('vlan_vms') }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.NetworkView = NetworkView
})()
