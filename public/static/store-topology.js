// =============================================================================
//  统一拓扑数据 Store (store-topology.js) — Cloud Nexus Forging
//  对应「集中式状态管理」思想（无第三方依赖，纯 Vue 3 reactivity 实现）：
//    · 单一可信数据源：datacenters / clusters / hosts / vms（响应式）
//    · 聚合派生（computed）：datacenterStats / clusterStats / hostStats —— 自动计算下级数量
//    · 业务操作：fetchAll / addHostToCluster / getMigrationTargets / migrateVm
//               / deleteDatacenter / deleteCluster / removeHost（含层级约束校验）
//    · 全局单例：window.cnfTopology，任意视图共享同一份数据，改动即时同步
//
//  严格层级血缘：数据中心 ──包含──► 集群 ──包含──► 宿主机 ──运行──► 虚拟机
// =============================================================================
(function () {
const { reactive, computed, ref } = Vue
const api = window.api
const toast = window.cnfToast

// ---- 原始数据（响应式，单一可信来源）----
const state = reactive({
  datacenters: [],
  clusters: [],
  hosts: [],
  vms: [],
  loaded: false,
  loading: false,
})

// ---- 拉取全量层级数据 ----
async function fetchAll(force) {
  if (state.loaded && !force) return
  state.loading = true
  try {
    const [dcs, cls, hs, vms] = await Promise.all([
      api('/datacenters'), api('/clusters'), api('/hosts'), api('/vms'),
    ])
    // 真实后端解包后应为数组；若为 error 对象（如 401）则置空数组，避免渲染崩溃。
    state.datacenters = Array.isArray(dcs) ? dcs : []
    state.clusters = Array.isArray(cls) ? cls : []
    state.hosts = Array.isArray(hs) ? hs : []
    state.vms = Array.isArray(vms) ? vms : []
    state.loaded = true
  } finally {
    state.loading = false
  }
}

// =============================================================================
//  聚合统计（computed）—— 层级关系自动计算，与后端单一可信来源保持一致
// =============================================================================
const datacenterStats = computed(() =>
  state.datacenters.map((dc) => {
    const dcClusters = state.clusters.filter((c) => c.datacenter_id === dc.id)
    const dcHosts = state.hosts.filter((h) => h.datacenter_id === dc.id)
    const dcVMs = state.vms.filter((v) => v.datacenter_id === dc.id)
    return {
      ...dc,
      cluster_count: dcClusters.length,
      host_count: dcHosts.length,
      host_online: dcHosts.filter((h) => h.status === 'connected').length,
      vm_count: dcVMs.length,
      vm_running: dcVMs.filter((v) => v.status === 'running').length,
    }
  })
)

const clusterStats = computed(() =>
  state.clusters.map((cl) => {
    const clHosts = state.hosts.filter((h) => h.cluster_id === cl.id)
    const clVMs = state.vms.filter((v) => v.cluster_id === cl.id)
    const dc = state.datacenters.find((d) => d.id === cl.datacenter_id)
    return {
      ...cl,
      datacenter_name: dc ? dc.name : '未知',
      host_count: clHosts.length,
      host_online: clHosts.filter((h) => h.status === 'connected').length,
      vm_count: clVMs.length,
      vm_running: clVMs.filter((v) => v.status === 'running').length,
    }
  })
)

const hostStats = computed(() =>
  state.hosts.map((h) => {
    const hostVMs = state.vms.filter((v) => v.host_id === h.id)
    const cl = state.clusters.find((c) => c.id === h.cluster_id)
    const dc = state.datacenters.find((d) => d.id === h.datacenter_id)
    return {
      ...h,
      cluster_name: cl ? cl.name : '未分配',
      datacenter_name: dc ? dc.name : '未知',
      vm_count: hostVMs.length,
      vm_running: hostVMs.filter((v) => v.status === 'running').length,
      vms_list: hostVMs,
    }
  })
)

// 四层拓扑树（供 TopologyTree 组件 / 数据中心页使用）
const topologyTree = computed(() =>
  datacenterStats.value.map((dc) => ({
    key: 'dc-' + dc.id, type: 'datacenter', id: dc.id, label: dc.name, status: dc.status, raw: dc,
    count: dc.vm_count,
    children: clusterStats.value
      .filter((cl) => cl.datacenter_id === dc.id)
      .map((cl) => ({
        key: 'cluster-' + cl.id, type: 'cluster', id: cl.id, label: cl.name, status: cl.status, raw: cl,
        count: cl.vm_count,
        children: state.hosts
          .filter((h) => h.cluster_id === cl.id)
          .map((h) => ({
            key: 'host-' + h.id, type: 'host', id: h.id, label: h.name, status: h.status, raw: h,
            count: state.vms.filter((v) => v.host_id === h.id).length,
            children: state.vms
              .filter((v) => v.host_id === h.id)
              .map((v) => ({ key: 'vm-' + v.id, type: 'vm', id: v.id, label: v.name, status: v.status, raw: v })),
          })),
      })),
  }))
)

// =============================================================================
//  业务操作（含层级约束校验）
// =============================================================================

// 节点纳管：添加主机到集群（IP 去重 + 集群校验 + 自动继承 DC）
async function addHostToCluster(data) {
  // 前端先做 IP 去重（即时反馈）
  const dup = state.hosts.find((h) => h.ip === data.ip_address)
  if (dup) {
    toast('IP 地址 ' + data.ip_address + ' 已被主机 ' + dup.name + ' 使用', 'error')
    return { ok: false, error: 'IP_DUPLICATE' }
  }
  const cluster = state.clusters.find((c) => c.id === Number(data.cluster_id))
  if (!cluster) {
    toast('目标集群不存在', 'error')
    return { ok: false, error: 'CLUSTER_NOT_FOUND' }
  }
  // 字段映射：后端 POST /hosts 要求 name（必填），前端向导用 hostname。
  // 这里补 name 字段，避免真实后端返回 VALIDATION_FAILED(name 必填)。
  const payload = Object.assign({}, data, { name: data.name || data.hostname })
  const res = await api('/hosts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (res && res.error) {
    toast(res.error, 'error')
    return { ok: false, error: res.code }
  }
  // 同步到本地 store（即时层级联动）
  state.hosts.push(res)
  return { ok: true, host: res, cluster }
}

// 获取迁移目标：只能是「同集群内的其他在线非维护主机」
function getMigrationTargets(vmId) {
  const vm = state.vms.find((v) => v.id === vmId)
  if (!vm) return []
  return state.hosts.filter((h) =>
    h.cluster_id === vm.cluster_id &&
    h.id !== vm.host_id &&
    h.status === 'connected' &&
    !h.maintenance_mode
  )
}

// 执行迁移（变更 VM 归属主机）
async function migrateVm(vmId, targetHostId) {
  const vm = state.vms.find((v) => v.id === vmId)
  if (!vm) return { ok: false }
  vm.status = 'migrating'
  const res = await api('/vms/' + vmId + '/migrate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_host_id: targetHostId }),
  })
  if (res && res.error) {
    vm.status = 'running'
    toast(res.error, 'error')
    return { ok: false, error: res.code }
  }
  vm.host_id = Number(targetHostId)
  vm.status = 'running'
  return { ok: true, result: res }
}

// 删除数据中心（级联校验：有集群则阻止）
async function deleteDatacenter(id) {
  const children = state.clusters.filter((c) => c.datacenter_id === id)
  if (children.length > 0) {
    return { ok: false, code: 'HAS_CHILDREN', children: children.map((x) => x.name),
      error: '数据中心下仍有 ' + children.length + ' 个集群，请先移除集群' }
  }
  const res = await api('/datacenters/' + id, { method: 'DELETE' })
  if (res && res.error) return { ok: false, code: res.code, children: res.children, error: res.error }
  state.datacenters = state.datacenters.filter((d) => d.id !== id)
  return { ok: true }
}

// 删除集群（级联校验：有主机则阻止）
async function deleteCluster(id) {
  const children = state.hosts.filter((h) => h.cluster_id === id)
  if (children.length > 0) {
    return { ok: false, code: 'HAS_CHILDREN', children: children.map((x) => x.name),
      error: '集群下仍有 ' + children.length + ' 台主机，请先移除主机' }
  }
  const res = await api('/clusters/' + id, { method: 'DELETE' })
  if (res && res.error) return { ok: false, code: res.code, children: res.children, error: res.error }
  state.clusters = state.clusters.filter((c) => c.id !== id)
  return { ok: true }
}

// 移除主机（级联校验：有运行中 VM 则阻止）
async function removeHost(id) {
  const running = state.vms.filter((v) => v.host_id === id && v.status === 'running')
  if (running.length > 0) {
    return { ok: false, code: 'HAS_RUNNING_VM', children: running.map((x) => x.name),
      error: '主机上仍有 ' + running.length + ' 台运行中的虚拟机，请先迁移或关机' }
  }
  const res = await api('/hosts/' + id, { method: 'DELETE' })
  if (res && res.error) return { ok: false, code: res.code, children: res.children, error: res.error }
  state.hosts = state.hosts.filter((h) => h.id !== id)
  return { ok: true }
}

// 创建数据中心
async function createDatacenter(data) {
  const res = await api('/datacenters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (res && res.error) return { ok: false, code: res.code, error: res.error }
  state.datacenters.push(res)
  return { ok: true, datacenter: res }
}
// 编辑数据中心
async function updateDatacenter(id, data) {
  const res = await api('/datacenters/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (res && res.error) return { ok: false, code: res.code, error: res.error }
  const idx = state.datacenters.findIndex((d) => d.id === id)
  if (idx >= 0) Object.assign(state.datacenters[idx], res)
  return { ok: true, datacenter: res }
}
// 创建集群（须归属数据中心）
async function createCluster(data) {
  const res = await api('/clusters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (res && res.error) return { ok: false, code: res.code, error: res.error }
  state.clusters.push(res)
  return { ok: true, cluster: res }
}
// 编辑集群
async function updateCluster(id, data) {
  const res = await api('/clusters/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (res && res.error) return { ok: false, code: res.code, error: res.error }
  const idx = state.clusters.findIndex((c) => c.id === id)
  if (idx >= 0) Object.assign(state.clusters[idx], res)
  return { ok: true, cluster: res }
}

// ---- 跨视图导航事件（拓扑树点击 → 切换模块/子页 + 高亮目标）----
function navigateTo(type, id) {
  const map = {
    datacenter: ['infrastructure', 'datacenter'],
    cluster: ['infrastructure', 'clusters'],
    host: ['infrastructure', 'hosts'],
    vm: ['compute', 'vms'],
  }
  const dest = map[type]
  if (!dest) return
  window.dispatchEvent(new CustomEvent('cnf:navigate', {
    detail: { module: dest[0], tab: dest[1], focusType: type, focusId: id },
  }))
}

// ---- 全局单例 ----
window.cnfTopology = {
  state,
  fetchAll,
  datacenterStats, clusterStats, hostStats, topologyTree,
  addHostToCluster, getMigrationTargets, migrateVm,
  createDatacenter, updateDatacenter, createCluster, updateCluster,
  deleteDatacenter, deleteCluster, removeHost,
  navigateTo,
}
})()
