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
  // 实时指标（来自 GET /hosts/metrics 真实采集，键为 host id 字符串）。
  // 形如 { "21": {reachable:true, cpu_usage_pct, mem_usage_pct, ...} }
  metrics: {},
  metricsLoading: false,
})

// ---- 拉取全量主机实时指标（真实数据，无 mock）----
// 调用后端批量端点 GET /hosts/metrics（并发 SSH 采集，不可达主机返回 {reachable:false}）。
async function fetchHostMetrics() {
  state.metricsLoading = true
  try {
    // api() 成功时解包 {data:{...}} → 直接得到 {hostId: metrics} 映射。
    const res = await api('/hosts/metrics')
    if (res && !res.error && typeof res === 'object') {
      state.metrics = res
    }
  } catch (e) {
    // 静默失败仅清空指标（卡片显示「—」），不伪造数据。
  } finally {
    state.metricsLoading = false
  }
  return state.metrics
}

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
    // 后端主机 IP 字段为 ip_address；前端统一用 h.ip。在此规整，保证列表/去重/详情一致。
    state.hosts = (Array.isArray(hs) ? hs : []).map((h) => ({ ...h, ip: h.ip || h.ip_address || '' }))
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
    // 合入真实实时指标（若已采集到）。metrics 键为 host id 字符串。
    const m = state.metrics[String(h.id)] || null
    return {
      ...h,
      cluster_name: cl ? cl.name : '未分配',
      datacenter_name: dc ? dc.name : '未知',
      vm_count: hostVMs.length,
      vm_running: hostVMs.filter((v) => v.status === 'running').length,
      vms_list: hostVMs,
      // 真实指标（来自后端 SSH 采集）；未采集到或不可达时 metrics=null / reachable:false。
      metrics: m,
      metrics_reachable: m ? m.reachable !== false : null,
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

// 原始 POST：不经 api() 的 {data} 自动解包，保留后端响应的全部同级字段
// （onboard/precheck 会同时返回 data + precheck + install + message）。
async function rawPost(path, body) {
  const headers = { 'Content-Type': 'application/json' }
  try {
    const tok = localStorage.getItem('cnf_token')
    if (tok) headers['Authorization'] = 'Bearer ' + tok
  } catch (e) {}
  try {
    const r = await fetch(window.API_BASE + path, { method: 'POST', headers, body: JSON.stringify(body) })
    const json = await r.json().catch(() => ({}))
    return { _status: r.status, _ok: r.ok, body: json }
  } catch (err) {
    return { _status: 0, _ok: false, body: { error: '网络请求失败：' + (err && err.message || err) } }
  }
}

// 真实 SSH 预检：调用后端 POST /hosts/precheck（只读探测，不修改目标主机也不落库）。
// 返回 { ok, precheck, hardware } 或 { ok:false, error }。
async function precheckHostSSH(payload) {
  const r = await rawPost('/hosts/precheck', payload)
  const b = r.body || {}
  if (!r._ok || b.error || b.code) {
    return { ok: false, error: b.error || b.message || ('预检失败 HTTP ' + r._status) }
  }
  return { ok: true, precheck: b.precheck, hardware: b.hardware }
}

// 通用 SSE 读取器：fetch + ReadableStream 解析「event:/data:」帧，逐帧回调 onFrame(event, obj)。
// 返回 Promise<{ ok, error }>（仅表示流是否正常读完；业务结果由 onFrame 内部聚合）。
async function readSSE(path, payload, onFrame) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }
  try {
    const tok = localStorage.getItem('cnf_token')
    if (tok) headers['Authorization'] = 'Bearer ' + tok
  } catch (e) {}

  let resp
  try {
    resp = await fetch(window.API_BASE + path, { method: 'POST', headers, body: JSON.stringify(payload) })
  } catch (err) {
    return { ok: false, error: '网络请求失败：' + (err && err.message || err) }
  }
  if (!resp.ok && resp.headers.get('content-type') && resp.headers.get('content-type').includes('json')) {
    const j = await resp.json().catch(() => ({}))
    return { ok: false, error: j.error || j.message || ('请求失败 HTTP ' + resp.status) }
  }
  if (!resp.body) return { ok: false, error: '当前浏览器不支持流式响应，请升级浏览器' }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  const parseFrames = () => {
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      let ev = 'message', dataLines = []
      frame.split('\n').forEach((ln) => {
        if (ln.startsWith('event:')) ev = ln.slice(6).trim()
        else if (ln.startsWith('data:')) dataLines.push(ln.slice(5).trim())
      })
      if (dataLines.length) {
        let obj = {}
        try { obj = JSON.parse(dataLines.join('\n')) } catch (e) { obj = { raw: dataLines.join('\n') } }
        onFrame(ev, obj)
      }
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      parseFrames()
    }
    buf += decoder.decode()
    parseFrames()
  } catch (err) {
    return { ok: false, error: '读取流失败：' + (err && err.message || err) }
  }
  return { ok: true }
}

// 流式预检：调用 POST /hosts/precheck-stream（SSE），每完成一项立即回调，消除「全部转圈」迟滞。
// 回调 handlers：
//   onItem({key, ok, level, detail}) —— 单项预检完成
//   onHardware(hw)                   —— 硬件采集完成
// 返回 Promise<{ ok, precheck, hardware, error }>（result 事件内容）。
async function precheckHostStreamSSH(payload, handlers) {
  handlers = handlers || {}
  let finalResult = null
  const r = await readSSE('/hosts/precheck-stream', payload, (event, obj) => {
    if (event === 'item' && handlers.onItem) handlers.onItem(obj)
    else if (event === 'hw' && handlers.onHardware) handlers.onHardware(obj)
    else if (event === 'result') finalResult = obj
    else if (event === 'error') finalResult = { ok: false, error: obj.error || '未知错误' }
  })
  if (!r.ok) return { ok: false, error: r.error }
  if (!finalResult) return { ok: false, error: '连接中断，未收到最终结果' }
  return finalResult
}

// 真实 SSH 纳管：调用后端 POST /hosts/onboard（采集硬件→落库→qemu+tcp 验证）。
// auto_install=true 时后端会在缺组件时自动安装 libvirt+KVM 并配置 TCP。
// 返回 { ok, host, precheck, install, message } 或 { ok:false, error, install }。
async function onboardHostSSH(payload) {
  const dup = state.hosts.find((h) => h.ip === payload.ip_address)
  if (dup) return { ok: false, error: 'IP 地址 ' + payload.ip_address + ' 已被主机 ' + dup.name + ' 使用' }
  const r = await rawPost('/hosts/onboard', payload)
  const b = r.body || {}
  if (!r._ok || b.error || b.code) {
    return { ok: false, error: b.error || b.message || ('纳管失败 HTTP ' + r._status), install: b.install, precheck: b.precheck }
  }
  const host = b.data || b
  if (host && host.id) {
    const idx = state.hosts.findIndex((h) => h.id === host.id)
    if (idx >= 0) Object.assign(state.hosts[idx], host)
    else state.hosts.push(host)
  }
  return { ok: true, host, precheck: b.precheck, install: b.install, message: b.message }
}

// 流式纳管：调用 POST /hosts/onboard-stream（SSE），实时回传每步真实执行日志。
// 用 fetch + ReadableStream 解析 SSE（可携带 Bearer 头，优于 EventSource）。
//
// 回调 handlers：
//   onStep(step)   —— 某步骤开始 { name, command }
//   onLine(line)   —— 一行实时输出（字符串）
//   onDone(step)   —— 某步骤结束 { name, ok, output, error }
// 返回 Promise<{ ok, host, precheck, install, message, error }>（result 事件内容）。
async function onboardHostStreamSSH(payload, handlers) {
  handlers = handlers || {}
  const dup = state.hosts.find((h) => h.ip === payload.ip_address)
  if (dup) return { ok: false, error: 'IP 地址 ' + payload.ip_address + ' 已被主机 ' + dup.name + ' 使用' }

  const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }
  try {
    const tok = localStorage.getItem('cnf_token')
    if (tok) headers['Authorization'] = 'Bearer ' + tok
  } catch (e) {}

  let resp
  try {
    resp = await fetch(window.API_BASE + '/hosts/onboard-stream', {
      method: 'POST', headers, body: JSON.stringify(payload),
    })
  } catch (err) {
    return { ok: false, error: '网络请求失败：' + (err && err.message || err) }
  }
  if (!resp.ok && resp.headers.get('content-type') && resp.headers.get('content-type').includes('json')) {
    const j = await resp.json().catch(() => ({}))
    return { ok: false, error: j.error || j.message || ('纳管失败 HTTP ' + resp.status) }
  }
  if (!resp.body) {
    return { ok: false, error: '当前浏览器不支持流式响应，请升级浏览器' }
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  let finalResult = null

  const dispatch = (event, data) => {
    let obj = {}
    try { obj = JSON.parse(data) } catch (e) { obj = { raw: data } }
    if (event === 'step' && handlers.onStep) handlers.onStep(obj)
    else if (event === 'line' && handlers.onLine) handlers.onLine(obj.line != null ? obj.line : (obj.raw || ''))
    else if (event === 'done' && handlers.onDone) handlers.onDone(obj)
    else if (event === 'result') finalResult = obj
    else if (event === 'error') finalResult = { ok: false, error: obj.error || '未知错误' }
  }

  // 解析 SSE：以空行分隔的帧，每帧含 event: / data: 行。
  const parseFrames = () => {
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      let ev = 'message', dataLines = []
      frame.split('\n').forEach((ln) => {
        if (ln.startsWith('event:')) ev = ln.slice(6).trim()
        else if (ln.startsWith('data:')) dataLines.push(ln.slice(5).trim())
      })
      if (dataLines.length) dispatch(ev, dataLines.join('\n'))
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      parseFrames()
    }
    buf += decoder.decode()
    parseFrames()
  } catch (err) {
    return { ok: false, error: '读取流失败：' + (err && err.message || err) }
  }

  if (!finalResult) return { ok: false, error: '连接中断，未收到最终结果' }
  // 成功落库则同步到本地 state.hosts。
  if (finalResult.ok && finalResult.host && finalResult.host.id) {
    const host = finalResult.host
    const idx = state.hosts.findIndex((h) => h.id === host.id)
    if (idx >= 0) Object.assign(state.hosts[idx], host)
    else state.hosts.push(host)
  }
  return finalResult
}

// 获取平台离线安装包仓库内容（GET /offline-packages）。
// 返回 { ok, data:[{name,os_tag,size_kb}], groups:{el8:n}, enabled, root }。
async function getOfflinePackages() {
  const headers = {}
  try {
    const tok = localStorage.getItem('cnf_token')
    if (tok) headers['Authorization'] = 'Bearer ' + tok
  } catch (e) {}
  try {
    const r = await fetch(window.API_BASE + '/offline-packages', { headers })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: j.error || ('HTTP ' + r.status) }
    return { ok: true, data: j.data || [], groups: j.groups || {}, enabled: !!j.enabled, root: j.root || '' }
  } catch (err) {
    return { ok: false, error: '网络请求失败：' + (err && err.message || err) }
  }
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
// 规范化集群表单 → 后端契约：
//   - ntp_servers：后端是 []string；表单里是「逗号分隔字符串」，这里拆成数组，
//     否则后端 JSON 反序列化失败返回「请求体非法」(BAD_REQUEST)。
//   - overcommit_cpu / max_clock_offset_ms：确保为数值类型。
function normalizeClusterPayload(data) {
  const p = Object.assign({}, data)
  if (typeof p.ntp_servers === 'string') {
    p.ntp_servers = p.ntp_servers
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  } else if (!Array.isArray(p.ntp_servers)) {
    p.ntp_servers = []
  }
  if (p.datacenter_id != null) p.datacenter_id = Number(p.datacenter_id)
  if (p.overcommit_cpu != null) p.overcommit_cpu = Number(p.overcommit_cpu)
  if (p.max_clock_offset_ms != null) p.max_clock_offset_ms = Number(p.max_clock_offset_ms)
  return p
}
// 创建集群（须归属数据中心）
async function createCluster(data) {
  const res = await api('/clusters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizeClusterPayload(data)),
  })
  if (res && res.error) return { ok: false, code: res.code, error: res.error }
  state.clusters.push(res)
  return { ok: true, cluster: res }
}
// 编辑集群
async function updateCluster(id, data) {
  const res = await api('/clusters/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizeClusterPayload(data)),
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
  fetchHostMetrics,
  datacenterStats, clusterStats, hostStats, topologyTree,
  addHostToCluster, precheckHostSSH, precheckHostStreamSSH, onboardHostSSH, onboardHostStreamSSH, getOfflinePackages, getMigrationTargets, migrateVm,
  createDatacenter, updateDatacenter, createCluster, updateCluster,
  deleteDatacenter, deleteCluster, removeHost,
  navigateTo,
}
})()
