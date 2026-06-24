// =============================================================================
//  模块视图：网络管理 (view-network.js)
//  子标签：vswitch 二层虚拟交换机 / vlan VLAN 配置 / topology 网络拓扑。
//  API：/vswitches、/vlans、/host-nics、/bond-modes、/network/topology。
//
//  二层虚拟交换机创建对话框：
//    · 以「宿主机网卡图标」网格方式选择上联口（可多选）
//    · 多选时自动进入 bond 链路聚合，提供 7 种 bond 模式可视化选择
//    · 表单校验（名称必填、bond 模式最少 2 网卡）+ loading + Toast 反馈
// =============================================================================
(function () {
const { ref, reactive, computed, onMounted, watch } = Vue
const api = window.api
const t = window.t
const toast = window.cnfToast

const NetworkView = {
  props: { tab: { type: String, default: 'vswitch' } },
  setup(props) {
    const vswitches = ref([])
    const vlans = ref([])
    const topo = ref([])
    const hostNics = ref([])
    const bondModes = ref([])
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

    // ---- 创建交换机对话框 ----
    const dlg = reactive({
      open: false, busy: false,
      form: { name: '', type: '分布式虚拟交换机', mtu: 1500, uplink_nics: [], bond_mode: '802.3ad' },
      errors: {},
    })

    const openCreate = async () => {
      if (!hostNics.value.length) hostNics.value = await api('/host-nics')
      if (!bondModes.value.length) bondModes.value = await api('/bond-modes')
      dlg.form = { name: '', type: '分布式虚拟交换机', mtu: 1500, uplink_nics: [], bond_mode: '802.3ad' }
      dlg.errors = {}; dlg.open = true
    }

    const toggleNic = (nic) => {
      if (nic.state !== 'up') return // 仅可选已连接网卡
      const arr = dlg.form.uplink_nics
      const i = arr.indexOf(nic.id)
      if (i >= 0) arr.splice(i, 1); else arr.push(nic.id)
    }
    const nicSelected = (id) => dlg.form.uplink_nics.includes(id)
    const isBond = computed(() => dlg.form.uplink_nics.length > 1)
    const currentBond = computed(() => bondModes.value.find((b) => b.key === dlg.form.bond_mode))

    const validate = () => {
      const e = {}
      const name = (dlg.form.name || '').trim()
      if (!name) e.name = t('op_required')
      else if (!/^[A-Za-z0-9._-]{2,40}$/.test(name)) e.name = t('op_invalid')
      if (!dlg.form.uplink_nics.length) e.uplink = t('op_required')
      if (isBond.value) {
        const bm = currentBond.value
        if (bm && dlg.form.uplink_nics.length < (bm.min_nics || 2)) e.bond = t('bond_need_two')
      }
      dlg.errors = e
      return Object.keys(e).length === 0
    }

    const submit = async () => {
      if (!validate()) return
      dlg.busy = true
      try {
        const res = await api('/vswitches', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: dlg.form.name.trim(), type: dlg.form.type, mtu: Number(dlg.form.mtu),
            uplink_nics: dlg.form.uplink_nics, bond_mode: isBond.value ? dlg.form.bond_mode : 'none',
          }),
        })
        vswitches.value.unshift(res)
        dlg.open = false
        toast(t('toast_created').replace('{name}', res.name), 'success')
      } catch (err) {
        toast(t('toast_failed'), 'error')
      } finally { dlg.busy = false }
    }

    const nicIcon = (n) => n.speed_gbe >= 100 ? 'fa-bolt' : n.speed_gbe >= 25 ? 'fa-ethernet' : 'fa-network-wired'

    return {
      props, vswitches, vlans, topo, hostNics, bondModes, expanded, toggle,
      dlg, openCreate, toggleNic, nicSelected, isBond, currentBond, validate, submit, nicIcon, t,
    }
  },
  template: `
    <div>
      <!-- ===== vswitch：二层虚拟交换机 ===== -->
      <template v-if="props.tab==='vswitch'">
        <div class="toolbar"><span class="muted">{{ vswitches.length }} {{ t('sw_title') }}</span><div class="spacer"></div><button class="apple-btn apple-btn--primary" @click="openCreate"><i class="fas fa-plus"></i> {{ t('sw_create') }}</button></div>
        <div class="grid grid-2">
          <div class="apple-card" v-for="sw in vswitches" :key="sw.id">
            <div class="flex between" style="margin-bottom:12px">
              <div><strong>{{ sw.name }}</strong><div class="muted" style="font-size:12px;margin-top:2px"><i class="fas fa-network-wired"></i> {{ sw.type }}</div></div>
              <span class="apple-badge apple-badge--running"><span class="dot"></span>MTU {{ sw.mtu }}</span>
            </div>
            <div class="gpu-stats">
              <div class="gpu-stat"><div class="k">{{ t('sw_uplink') }}</div><div class="v" style="font-size:13px">{{ sw.uplink }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('sw_bond_mode') }}</div><div class="v" style="font-size:13px">{{ sw.bond_mode || '—' }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('sw_vlans') }}</div><div class="v" style="font-size:13px">{{ sw.vlans && sw.vlans.length ? sw.vlans.join(', ') : '—' }}</div></div>
            </div>
            <div style="margin-top:12px"><span class="muted" style="font-size:12px">{{ t('sw_hosts') }}：</span>
              <span v-if="!sw.hosts || !sw.hosts.length" class="muted">—</span>
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

      <!-- ===== 创建二层虚拟交换机对话框 ===== -->
      <div v-if="dlg.open" class="modal-mask" @click.self="!dlg.busy && (dlg.open=false)">
        <div class="modal-dialog" style="width:620px">
          <div class="modal-head"><i class="fas fa-network-wired"></i> {{ t('sw_create') }}</div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="form-row">
                <label>{{ t('sw_name') }} <span class="req">*</span></label>
                <input v-model="dlg.form.name" :class="{invalid:dlg.errors.name}" placeholder="vSwitch-XXX" />
                <div v-if="dlg.errors.name" class="form-err">{{ dlg.errors.name }}</div>
              </div>
              <div class="form-row">
                <label>{{ t('sw_type') }}</label>
                <select v-model="dlg.form.type">
                  <option value="分布式虚拟交换机">分布式虚拟交换机</option>
                  <option value="标准网桥">标准网桥</option>
                </select>
              </div>
            </div>
            <div class="form-row" style="width:50%">
              <label>{{ t('sw_mtu') }}</label>
              <select v-model.number="dlg.form.mtu">
                <option :value="1500">1500（标准）</option>
                <option :value="9000">9000（巨型帧）</option>
              </select>
            </div>

            <!-- 宿主机网卡图标选择 -->
            <div class="form-row">
              <label>{{ t('sw_uplink') }} <span class="req">*</span></label>
              <div class="muted" style="font-size:12px;margin-bottom:10px">{{ t('sw_uplink_pick') }}</div>
              <div class="nic-grid">
                <button type="button" v-for="n in hostNics" :key="n.id"
                  class="nic-card" :class="{selected:nicSelected(n.id), disabled:n.state!=='up'}"
                  @click="toggleNic(n)">
                  <i class="fas" :class="nicIcon(n)"></i>
                  <div class="nic-name">{{ n.name }}</div>
                  <div class="nic-meta">{{ n.speed_gbe }}GbE</div>
                  <span class="nic-state" :class="n.state==='up'?'up':'down'">{{ n.state==='up' ? t('sw_nic_up') : t('sw_nic_down') }}</span>
                  <i v-if="nicSelected(n.id)" class="fas fa-circle-check nic-check"></i>
                </button>
              </div>
              <div v-if="dlg.errors.uplink" class="form-err">{{ dlg.errors.uplink }}</div>
            </div>

            <!-- Bond 模式选择（仅多网卡时）-->
            <div class="form-row" v-if="isBond">
              <label>{{ t('sw_bond_section') }} · {{ t('sw_bond_mode') }}</label>
              <div class="bond-grid">
                <button type="button" v-for="b in bondModes" :key="b.key"
                  class="bond-card" :class="{selected:dlg.form.bond_mode===b.key}"
                  @click="dlg.form.bond_mode=b.key">
                  <div class="bond-top">
                    <span class="bond-key">{{ b.key }}</span>
                    <span v-if="b.lacp" class="apple-badge apple-badge--warning" style="font-size:10px">LACP</span>
                  </div>
                  <div class="bond-desc">{{ t(b.label_key) }}</div>
                </button>
              </div>
              <div v-if="dlg.errors.bond" class="form-err">{{ dlg.errors.bond }}</div>
            </div>
            <div v-else-if="dlg.form.uplink_nics.length===1" class="muted" style="font-size:12px">
              <i class="fas fa-circle-info"></i> {{ t('sw_bond_none') }}
            </div>
          </div>
          <div class="modal-foot">
            <span class="muted" style="font-size:13px;margin-right:auto">{{ t('sw_selected_nics') }}：{{ dlg.form.uplink_nics.length }}</span>
            <button class="apple-btn apple-btn--secondary" :disabled="dlg.busy" @click="dlg.open=false">{{ t('op_cancel') }}</button>
            <button class="apple-btn apple-btn--primary" :disabled="dlg.busy" @click="submit">
              <i v-if="dlg.busy" class="fas fa-spinner fa-spin"></i> {{ t('sw_create') }}
            </button>
          </div>
        </div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.NetworkView = NetworkView
})()
