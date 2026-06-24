// =============================================================================
//  模块视图：基础设施 (view-infrastructure.js) — Cloud Nexus Forging v2.0
//  子标签：datacenter 数据中心（资源拓扑树 + DC 统计卡）/ clusters 集群管理
//          / hosts 主机节点 / pools 资源池。
//
//  ★ 完整层级血缘（数据中心 → 集群 → 宿主机 → 虚拟机）：
//    · 所有数据来自统一 store（window.cnfTopology），聚合统计实时一致
//    · datacenter 页：左侧资源拓扑树 + 右侧 DC 统计卡（集群数/主机数/VM数）
//    · clusters 页：显示所属数据中心 + 主机数/VM数 + 「添加主机」+ 删除级联校验
//    · hosts 页：显示所属集群/数据中心 + 真实硬件型号 + 该主机运行的 VM 列表 + 移除校验
//    · 删除前级联校验（删 DC 查集群 / 删集群查主机 / 移除主机查运行 VM）
// =============================================================================
(function () {
const { ref, computed, onMounted, watch } = Vue
const t = window.t
const store = window.cnfTopology
const toast = window.cnfToast

const InfrastructureView = {
  components: { TopologyTree: window.__CNF_VIEWS.TopologyTree },
  props: { tab: { type: String, default: 'datacenter' }, focus: { type: Object, default: null } },
  setup(props) {
    const pools = ref([])

    // ---- 聚合数据（来自统一 store）----
    const datacenters = computed(() => store.datacenterStats.value)
    const clusters = computed(() => store.clusterStats.value)
    const hosts = computed(() => store.hostStats.value)

    // ---- 主机详情展开（显示该主机上运行的 VM 列表）----
    const expandedHost = ref(null)
    const toggleHost = (id) => { expandedHost.value = expandedHost.value === id ? null : id }

    // ---- 删除级联校验对话框 ----
    const blockDlg = ref({ open: false, title: '', message: '', children: [] })
    const showBlocked = (title, message, children) => { blockDlg.value = { open: true, title, message, children: children || [] } }

    // ============================================================
    //  数据中心：创建 / 编辑对话框
    // ============================================================
    const dcDlg = ref({ open: false, mode: 'create', id: null, form: {}, err: {}, saving: false })
    const openDcCreate = () => { dcDlg.value = { open: true, mode: 'create', id: null, form: { name: '', location: '', timezone: 'Asia/Shanghai', description: '' }, err: {}, saving: false } }
    const openDcEdit = (dc) => { dcDlg.value = { open: true, mode: 'edit', id: dc.id, form: { name: dc.name, location: dc.location || '', timezone: dc.timezone || 'Asia/Shanghai', description: dc.description || '' }, err: {}, saving: false } }
    const saveDc = async () => {
      const f = dcDlg.value.form; const err = {}
      if (!f.name || !f.name.trim()) err.name = t('op_required')
      dcDlg.value.err = err
      if (Object.keys(err).length) return
      dcDlg.value.saving = true
      const res = dcDlg.value.mode === 'create'
        ? await store.createDatacenter(f)
        : await store.updateDatacenter(dcDlg.value.id, f)
      dcDlg.value.saving = false
      if (!res.ok) {
        if (res.code === 'NAME_DUPLICATE') { dcDlg.value.err = { name: res.error }; return }
        return toast(res.error || t('op_failed'), 'error')
      }
      toast(dcDlg.value.mode === 'create' ? t('toast_created') : t('toast_saved'), 'success')
      dcDlg.value.open = false
    }

    // ============================================================
    //  集群：创建 / 编辑对话框
    // ============================================================
    const clDlg = ref({ open: false, mode: 'create', id: null, form: {}, err: {}, saving: false })
    const openClCreate = () => { clDlg.value = { open: true, mode: 'create', id: null, form: { name: '', datacenter_id: (datacenters.value[0] && datacenters.value[0].id) || '', description: '', ha_enabled: true, drs_enabled: false, overcommit_cpu: 4.0 }, err: {}, saving: false } }
    const openClEdit = (cl) => { clDlg.value = { open: true, mode: 'edit', id: cl.id, form: { name: cl.name, datacenter_id: cl.datacenter_id, description: cl.description || '', ha_enabled: cl.ha_enabled, drs_enabled: cl.drs_enabled, overcommit_cpu: cl.overcommit_cpu }, err: {}, saving: false } }
    const saveCl = async () => {
      const f = clDlg.value.form; const err = {}
      if (!f.name || !f.name.trim()) err.name = t('op_required')
      if (!f.datacenter_id) err.datacenter_id = t('op_required')
      clDlg.value.err = err
      if (Object.keys(err).length) return
      clDlg.value.saving = true
      const res = clDlg.value.mode === 'create'
        ? await store.createCluster(f)
        : await store.updateCluster(clDlg.value.id, f)
      clDlg.value.saving = false
      if (!res.ok) {
        if (res.code === 'NAME_DUPLICATE') { clDlg.value.err = { name: res.error }; return }
        return toast(res.error || t('op_failed'), 'error')
      }
      toast(clDlg.value.mode === 'create' ? t('toast_created') : t('toast_saved'), 'success')
      clDlg.value.open = false
    }

    // ---- 添加主机向导（通过全局事件打开，可携带预设集群）----
    const addHost = (presetClusterId) => {
      window.dispatchEvent(new CustomEvent('cnf:open-host-wizard', { detail: { presetClusterId: presetClusterId || 0 } }))
    }

    // ---- 删除数据中心（级联校验）----
    const delDatacenter = async (dc) => {
      const res = await store.deleteDatacenter(dc.id)
      if (!res.ok) return showBlocked(t('del_blocked_title'), res.error, res.children)
      toast(t('toast_success'), 'success')
    }
    // ---- 删除集群（级联校验）----
    const delCluster = async (cl) => {
      const res = await store.deleteCluster(cl.id)
      if (!res.ok) return showBlocked(t('del_blocked_title'), res.error, res.children)
      toast(t('toast_success'), 'success')
    }
    // ---- 移除主机（级联校验）----
    const delHost = async (h) => {
      const res = await store.removeHost(h.id)
      if (!res.ok) return showBlocked(t('del_blocked_title'), res.error, res.children)
      toast(t('toast_success'), 'success')
    }

    const load = async () => {
      await store.fetchAll()
      if (props.tab === 'pools' && !pools.value.length) pools.value = await window.api('/resource-pools')
    }
    onMounted(load)
    watch(() => props.tab, load)

    // ---- 跨视图聚焦高亮（拓扑树点击跳转时定位目标行）----
    const focusId = ref(null)
    const focusType = ref(null)
    watch(() => props.focus, (f) => {
      if (!f) return
      focusType.value = f.focusType; focusId.value = f.focusId
      if (f.focusType === 'host') expandedHost.value = f.focusId
      setTimeout(() => { focusId.value = null }, 2400)
    }, { immediate: true })

    const sharesLabel = (s) => ({ high: t('shares_high'), normal: t('shares_normal'), low: t('shares_low') }[s] || s)

    return {
      props, pools, datacenters, clusters, hosts,
      expandedHost, toggleHost, blockDlg, addHost,
      delDatacenter, delCluster, delHost,
      dcDlg, openDcCreate, openDcEdit, saveDc,
      clDlg, openClCreate, openClEdit, saveCl,
      focusId, focusType, sharesLabel, t,
    }
  },
  template: `
    <div>
      <!-- ===== datacenter：资源拓扑树 + DC 统计卡 ===== -->
      <template v-if="props.tab==='datacenter'">
        <div class="crud-toolbar">
          <button class="apple-btn apple-btn--primary" @click="openDcCreate"><i class="fas fa-plus"></i> {{ t('dc_create') }}</button>
          <div class="spacer"></div>
          <span class="muted" style="font-size:13px">{{ datacenters.length }} {{ t('nav_infra_datacenter') }}</span>
        </div>
        <div class="muted" style="margin-bottom:12px"><i class="fas fa-info-circle"></i> {{ t('topo_full_hint') }}</div>
        <div class="infra-topo-layout">
          <!-- 左：资源拓扑树 -->
          <TopologyTree />
          <!-- 右：数据中心统计卡 -->
          <div class="infra-topo-right">
            <div class="grid grid-1" style="gap:12px">
              <div class="apple-card dc-card" v-for="dc in datacenters" :key="dc.id"
                   :class="{focused: focusType==='datacenter' && focusId===dc.id}">
                <div class="flex between" style="margin-bottom:12px">
                  <div><i class="fas fa-building" style="color:var(--color-blue)"></i> <strong>{{ dc.name }}</strong>
                    <div class="muted" style="font-size:12px;margin-top:2px">{{ dc.location }} · {{ dc.description }}</div>
                  </div>
                  <span class="apple-badge apple-badge--running"><span class="dot"></span>{{ dc.status }}</span>
                </div>
                <div class="gpu-stats">
                  <div class="gpu-stat"><div class="k">{{ t('nav_infra_clusters') }}</div><div class="v">{{ dc.cluster_count }}</div></div>
                  <div class="gpu-stat"><div class="k">{{ t('host_machine') }}</div><div class="v">{{ dc.host_online }}/{{ dc.host_count }}</div></div>
                  <div class="gpu-stat"><div class="k">{{ t('dash_vms') }}</div><div class="v">{{ dc.vm_running }}/{{ dc.vm_count }}</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== clusters：集群管理（显示所属数据中心 + 聚合统计 + 添加主机/删除校验）===== -->
      <template v-else-if="props.tab==='clusters'">
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr>
              <th>{{ t('name') }}</th><th>{{ t('host_dc') }}</th><th>HA</th><th>{{ t('nav_drs') }}</th><th>CPU{{ t('cc_cpu_over') }}</th>
              <th>{{ t('host_machine') }}</th><th>{{ t('dash_vms') }}</th><th style="width:120px">{{ t('op_actions') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="c in clusters" :key="c.id" :class="{focused: focusType==='cluster' && focusId===c.id}">
                <td><strong>{{ c.name }}</strong><div class="muted" style="font-size:12px">{{ c.description }}</div></td>
                <td><span class="apple-badge"><i class="fas fa-building"></i> {{ c.datacenter_name }}</span></td>
                <td><i :class="c.ha_enabled?'fas fa-circle-check':'far fa-circle'" :style="{color:c.ha_enabled?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
                <td><i :class="c.drs_enabled?'fas fa-circle-check':'far fa-circle'" :style="{color:c.drs_enabled?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
                <td class="mono">{{ c.overcommit_cpu }}×</td>
                <td><strong>{{ c.host_online }}</strong><span class="muted">/{{ c.host_count }}</span></td>
                <td><strong>{{ c.vm_running }}</strong><span class="muted">/{{ c.vm_count }}</span></td>
                <td>
                  <button class="icon-btn" :title="t('hw_add_host')" @click="addHost(c.id)"><i class="fas fa-plus"></i></button>
                  <button class="icon-btn danger" :title="t('op_delete')" @click="delCluster(c)"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== hosts：主机节点（所属集群/DC + 真实硬件 + 运行VM列表 + 移除校验）===== -->
      <template v-else-if="props.tab==='hosts'">
        <div class="crud-toolbar">
          <button class="apple-btn apple-btn--primary" @click="addHost(0)"><i class="fas fa-plus"></i> {{ t('hw_add_host') }}</button>
          <div class="spacer"></div>
          <span class="muted" style="font-size:13px">{{ hosts.length }} {{ t('host_machine') }}</span>
        </div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr>
              <th style="width:34px"></th><th>{{ t('name') }}</th><th>{{ t('host_cluster') }}</th><th>{{ t('status') }}</th>
              <th>IP</th><th>CPU</th><th>{{ t('col_mem') }}</th><th>{{ t('dash_vms') }}</th><th>GPU</th><th>{{ t('col_load') }}</th><th style="width:54px"></th>
            </tr></thead>
            <tbody>
              <template v-for="h in hosts" :key="h.id">
                <tr class="host-row" :class="{focused: focusType==='host' && focusId===h.id}" @click="toggleHost(h.id)">
                  <td><i class="fas fa-chevron-right chevron" :class="{open:expandedHost===h.id}"></i></td>
                  <td><strong>{{ h.name }}</strong><div class="muted" style="font-size:12px">{{ h.cpu_model }}</div></td>
                  <td>
                    <div><span class="apple-badge"><i class="fas fa-layer-group"></i> {{ h.cluster_name }}</span></div>
                    <div class="muted" style="font-size:11px;margin-top:2px"><i class="fas fa-building"></i> {{ h.datacenter_name }}</div>
                  </td>
                  <td><span class="apple-badge" :class="h.status==='connected'?'apple-badge--running':'apple-badge--warning'"><span class="dot"></span>{{ h.status==='connected'?t('dash_connected'):(h.status==='connecting'?'纳管中':'维护') }}</span></td>
                  <td class="mono muted">{{ h.ip }}</td>
                  <td class="mono">{{ h.sockets }}×{{ h.cores }}×{{ h.threads }} = {{ h.vcpus }}</td>
                  <td class="mono">{{ h.mem_used_gb }}/{{ h.mem_total_gb }} GB</td>
                  <td><strong>{{ h.vm_running }}</strong><span class="muted">/{{ h.vm_count }}</span></td>
                  <td>{{ h.gpus>0 ? h.gpus+' ×' : '—' }}</td>
                  <td style="width:90px"><div class="usage-bar"><div class="fill" :style="{width:h.cpu_usage+'%',background:h.cpu_usage>80?'var(--color-red)':'var(--color-blue)'}"></div></div></td>
                  <td><button class="icon-btn danger" :title="t('op_remove')" @click.stop="delHost(h)"><i class="fas fa-trash"></i></button></td>
                </tr>
                <!-- 展开：硬件详情 + 该主机运行的 VM 列表 -->
                <tr v-if="expandedHost===h.id" class="host-detail-row">
                  <td colspan="11">
                    <div class="host-detail">
                      <div class="host-hw">
                        <div class="hw-item"><span class="hw-k"><i class="fas fa-microchip"></i> CPU</span><span class="hw-v">{{ h.cpu_model }} · {{ h.sockets }}×{{ h.cores }}C/{{ h.threads }}T</span></div>
                        <div class="hw-item"><span class="hw-k"><i class="fas fa-ethernet"></i> {{ t('host_nic_model') }}</span><span class="hw-v">{{ h.nic_model }}</span></div>
                        <div class="hw-item"><span class="hw-k"><i class="fas fa-hard-drive"></i> {{ t('host_raid_model') }}</span><span class="hw-v">{{ h.raid_model }}</span></div>
                        <div class="hw-item"><span class="hw-k"><i class="fas fa-database"></i> {{ t('host_disk_model') }}</span><span class="hw-v">{{ h.disk_model }}</span></div>
                      </div>
                      <div class="host-vms">
                        <div class="host-vms-title"><i class="fas fa-desktop"></i> {{ t('host_vms_running') }}（{{ h.vm_running }}/{{ h.vm_count }}）</div>
                        <div v-if="h.vms_list.length" class="host-vm-chips">
                          <span class="host-vm-chip" v-for="v in h.vms_list" :key="v.id" :class="'st-'+v.status">
                            <span class="dot"></span>{{ v.name }} <span class="muted">· {{ v.vcpus }}vCPU/{{ v.mem_gb }}GB</span>
                          </span>
                        </div>
                        <div v-else class="muted" style="font-size:13px">{{ t('op_no_data') }}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
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

      <!-- 级联删除阻止对话框 -->
      <div v-if="blockDlg.open" class="modal-mask" @click.self="blockDlg.open=false">
        <div class="modal-dialog modal-sm">
          <div class="modal-head"><i class="fas fa-ban" style="color:var(--color-red)"></i> {{ blockDlg.title }}</div>
          <div class="modal-body">
            <p>{{ blockDlg.message }}</p>
            <div v-if="blockDlg.children.length" class="block-children">
              <div class="muted" style="font-size:12px;margin-bottom:6px">{{ t('del_blocked_children') }}：</div>
              <span class="apple-badge" v-for="(ch,i) in blockDlg.children" :key="i" style="margin:2px">{{ ch }}</span>
            </div>
          </div>
          <div class="modal-foot">
            <button class="apple-btn apple-btn--primary" @click="blockDlg.open=false">{{ t('close') }}</button>
          </div>
        </div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.InfrastructureView = InfrastructureView
})()
