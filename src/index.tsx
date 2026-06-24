// =============================================================================
//  Cloud Nexus Forging (CNF) v1.0.1 — Hono Mock 后端（路径B 原型）
//  企业级分布式虚拟化管理平台（CNF 自有产品）。
//  统一 RESTful 风格：所有业务接口前缀 /api/v1，按 9 大模块组织、复数名词 + 动作子路径。
//
//  9 模块：仪表板 dashboard / 基础设施 infrastructure / 计算资源 compute /
//         可用性管理 availability / 存储管理 storage / 网络管理 network /
//         监控告警 monitoring / 访问控制 access / 系统设置 system。
// =============================================================================
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { mockData, genMetrics } from './mock-data'
import { buildDomainXML, type VMConfig } from './libvirt-xml'

const app = new Hono()
const API = '/api/v1'

app.use(`${API}/*`, cors())

// ============================================================================
//  模块 1 · 仪表板 dashboard：资源概览 / 性能监控 / 告警摘要
// ============================================================================
// 全局资源汇总（顶部 4 张统计卡）
app.get(`${API}/summary`, (c) => {
  const running = mockData.vms.filter((v) => v.status === 'running').length
  return c.json({
    datacenters: mockData.datacenters.length,
    clusters: mockData.clusters.length,
    hosts: mockData.hosts.length,
    hosts_connected: mockData.hosts.filter((h) => h.status === 'connected').length,
    vms: mockData.vms.length,
    vms_running: running,
    gpus: mockData.gpus.length,
    gpus_assigned: mockData.gpus.filter((g) => g.status === 'assigned').length,
    storage_pools: mockData.storage_pools.length,
  })
})
// 最近任务（性能监控页 / 仪表板）
app.get(`${API}/tasks`, (c) => c.json(mockData.tasks))

// ============================================================================
//  模块 2 · 基础设施 infrastructure：数据中心 / 集群管理 / 主机节点 / 资源池
// ============================================================================
app.get(`${API}/datacenters`, (c) => c.json(mockData.datacenters))
app.get(`${API}/clusters`, (c) => c.json(mockData.clusters))
app.get(`${API}/hosts`, (c) => c.json(mockData.hosts))
app.get(`${API}/resource-pools`, (c) => c.json(mockData.resource_pools))
// 基础设施层级拓扑：数据中心 → 集群 → 主机 → VM
app.get(`${API}/infrastructure/topology`, (c) => {
  const tree = mockData.datacenters.map((dc) => ({
    ...dc,
    children: mockData.clusters
      .filter((cl) => cl.datacenter_id === dc.id)
      .map((cl) => ({
        ...cl,
        children: mockData.hosts
          .filter((h) => h.cluster_id === cl.id)
          .map((h) => ({ ...h, children: mockData.vms.filter((v) => v.host_id === h.id) })),
      })),
  }))
  return c.json(tree)
})

// ============================================================================
//  模块 3 · 计算资源 compute：虚拟机列表 / 模板管理 / ISO 镜像
// ============================================================================
app.get(`${API}/vms`, (c) => c.json(mockData.vms))
app.get(`${API}/vm-templates`, (c) => c.json(mockData.vm_templates))
app.get(`${API}/iso-images`, (c) => c.json(mockData.iso_images))
app.get(`${API}/gpus`, (c) => c.json(mockData.gpus))

// VM 电源操作（右键菜单：开机/关机/重启/挂起/恢复/强制关机）
app.post(`${API}/vms/:id/power`, async (c) => {
  const { action } = await c.req.json<{ action: string }>()
  // 动作 → 目标状态映射
  const statusMap: Record<string, string> = {
    start: 'running', resume: 'running', reboot: 'running',
    shutdown: 'stopped', poweroff: 'stopped', suspend: 'paused',
  }
  const labelMap: Record<string, string> = {
    start: '开机', shutdown: '关机', reboot: '重启', suspend: '挂起', resume: '恢复', poweroff: '强制关机',
  }
  return c.json({
    id: Number(c.req.param('id')),
    action,
    status: statusMap[action] || 'running',
    message: `（原型）${labelMap[action] || action}指令已下发`,
  })
})

// VM 创建（向导提交）
app.post(`${API}/vms`, async (c) => {
  const cfg = await c.req.json()
  return c.json({ id: 999, name: cfg.name, status: 'starting', message: '（原型）虚拟机创建任务已提交' })
})

// libvirt domain XML 实时预览（真实可用：接收 VM 配置 → 生成 XML）
app.post(`${API}/vms/preview-xml`, async (c) => {
  const cfg = await c.req.json<VMConfig>()
  try {
    const xml = buildDomainXML(cfg)
    return c.json({ xml, vcpus: cfg.cpu_sockets * cfg.cpu_cores_per_socket * cfg.cpu_threads_per_core })
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

// ============================================================================
//  模块 4 · 可用性管理 availability：HA 配置 / 迁移中心 / 备份恢复
// ============================================================================
// 集群高级配置（高可用 / 动态资源调度 / CPU 兼容模式 / 资源超分配）
app.get(`${API}/cluster-configs`, (c) => c.json(mockData.cluster_configs))
app.put(`${API}/cluster-configs/:id`, async (c) => {
  const body = await c.req.json()
  return c.json({ ...body, id: Number(c.req.param('id')), saved: true, message: '（原型）集群可用性配置已保存' })
})

// 迁移中心（在线迁移）：历史 + 提交 + 进度
app.get(`${API}/migrations`, (c) => c.json(mockData.migrations))
app.post(`${API}/migrations`, async (c) => {
  const body = await c.req.json<{ vm: string; dst: string; live?: boolean; storage?: boolean }>()
  return c.json({
    task_uuid: crypto.randomUUID(),
    vm: body.vm, dst: body.dst, live: !!body.live, storage: !!body.storage,
    status: 'running',
    message: '（原型）热迁移任务已提交，可轮询 ' + API + '/migrations/progress',
  })
})
// 迁移进度（依据 elapsed 计算渐进进度，确定性，便于演示动画）
app.get(`${API}/migrations/progress`, (c) => {
  const start = Number(c.req.query('start') || Date.now())
  const elapsed = (Date.now() - start) / 1000
  const total = 8
  const pct = Math.min(100, Math.round((elapsed / total) * 100))
  let phase = '内存预拷贝'
  if (pct >= 100) phase = '完成'
  else if (pct >= 95) phase = '停机切换（downtime）'
  else if (pct >= 60) phase = '脏页迭代收敛'
  return c.json({
    progress: pct,
    phase,
    throughput_mbps: pct >= 100 ? 0 : 8000 + Math.round(Math.random() * 2000),
    remaining_mb: Math.max(0, Math.round((100 - pct) * 81.92)),
    done: pct >= 100,
  })
})

// 备份恢复
app.get(`${API}/backup-jobs`, (c) => c.json(mockData.backup_jobs))

// ============================================================================
//  模块 5 · 存储管理 storage：存储池 / 卷管理 / 快照树
// ============================================================================
app.get(`${API}/storage-pools`, (c) => c.json(mockData.storage_pools))
app.get(`${API}/volumes`, (c) => c.json(mockData.volumes))
app.get(`${API}/snapshots`, (c) => c.json(mockData.snapshots))
app.post(`${API}/snapshots`, async (c) => {
  const body = await c.req.json<{ vm: string; name: string; with_memory?: boolean; quiesce?: boolean }>()
  return c.json({
    id: 999, vm: body.vm, name: body.name,
    with_memory: !!body.with_memory, quiesce: !!body.quiesce,
    status: 'success',
    message: '（原型）快照已创建' + (body.with_memory ? '（含内存+NVRAM）' : '（仅磁盘）'),
  })
})

// ============================================================================
//  模块 6 · 网络管理 network：虚拟交换机 / VLAN 配置 / 网络拓扑
// ============================================================================
app.get(`${API}/vswitches`, (c) => c.json(mockData.vswitches))
app.get(`${API}/vlans`, (c) => c.json(mockData.vlans))
// 宿主机物理网卡（创建二层交换机时选择上联口 / 组建 bond）
app.get(`${API}/host-nics`, (c) => c.json(mockData.host_nics))
// 支持的 bond 链路聚合模式
app.get(`${API}/bond-modes`, (c) => c.json(mockData.bond_modes))
// 创建二层虚拟交换机（原型：回显校验结果）
app.post(`${API}/vswitches`, async (c) => {
  const body = await c.req.json()
  const nics: string[] = body.uplink_nics || []
  const bondMode: string = body.bond_mode || 'none'
  const uplink = nics.length > 1
    ? `bond0 (${nics.length}× ${bondMode})`
    : (nics[0] || '—')
  return c.json({
    id: Date.now(),
    name: body.name,
    type: body.type || '分布式虚拟交换机',
    mtu: body.mtu || 1500,
    bond_mode: nics.length > 1 ? bondMode : null,
    uplink,
    ports: 0,
    vlans: [],
    hosts: [],
    message: `（原型）二层虚拟交换机「${body.name}」已创建，上联：${uplink}`,
  })
})
// 网络拓扑：虚拟交换机 → VLAN
app.get(`${API}/network/topology`, (c) => {
  const tree = mockData.vswitches.map((sw) => ({
    ...sw,
    children: mockData.vlans.filter((vl) => vl.vswitch === sw.name),
  }))
  return c.json(tree)
})

// ============================================================================
//  模块 7 · 监控告警 monitoring：实时监控 / 历史性能 / 告警规则
// ============================================================================
app.get(`${API}/alert-rules`, (c) => c.json(mockData.alert_rules))
app.get(`${API}/notifications`, (c) => c.json(mockData.notifications))
// 一次性指标快照（SSE 不可用时回退）
app.get(`${API}/monitoring/metrics`, (c) => c.json(genMetrics()))
// SSE 实时监控流
app.get(`${API}/monitoring/metrics/stream`, (c) => {
  return c.body(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder()
        let count = 0
        const push = () => {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(genMetrics())}\n\n`))
          count++
          if (count > 600) { controller.close(); return }
        }
        push()
        const timer = setInterval(push, 2000)
        c.req.raw.signal?.addEventListener('abort', () => { clearInterval(timer); controller.close() })
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } }
  )
})

// ============================================================================
//  模块 8 · 访问控制 access：用户管理 / 角色权限 / 操作审计
// ============================================================================
app.get(`${API}/users`, (c) => c.json(mockData.users))
app.get(`${API}/roles`, (c) => c.json(mockData.roles))
app.post(`${API}/roles`, async (c) => {
  const body = await c.req.json<{ key: string; privileges: string[] }>()
  return c.json({ id: 999, ...body, system: false, message: '（原型）角色已创建' })
})
app.get(`${API}/privileges`, (c) => c.json(mockData.all_privileges))
app.get(`${API}/permission-assignments`, (c) => c.json(mockData.permission_assignments))
app.get(`${API}/audit-logs`, (c) => c.json(mockData.audit_logs))

// ============================================================================
//  模块 9 · 系统设置 system：基础配置 / License 管理 / 关于系统
// ============================================================================
app.get(`${API}/license`, (c) => c.json(mockData.license))
app.get(`${API}/license/editions`, (c) => c.json(mockData.license_editions))

// favicon（内联渐变 SVG "CNF"，避免 404）
app.get('/favicon.ico', (c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A84FF"/><stop offset="1" stop-color="#5E5CE6"/></linearGradient></defs><rect width="32" height="32" rx="7" fill="url(#g)"/><text x="16" y="21" font-size="11" font-weight="700" text-anchor="middle" fill="white" font-family="-apple-system,sans-serif">CNF</text></svg>`
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml' })
})

// ============================================================================
//  前端 SPA：Vue 3 Global build + 模块化视图脚本（按加载顺序）
// ============================================================================
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloud Nexus Forging · 企业级分布式虚拟化管理平台</title>
  <link rel="icon" href="/favicon.ico">
  <link rel="stylesheet" href="/static/apple-hig.css">
  <link rel="stylesheet" href="/static/app.css">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.global.prod.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
</head>
<body>
  <div id="app"></div>
  <!-- 国际化 + 主题（最先加载） -->
  <script src="/static/i18n.js"></script>
  <!-- 通用组件（component-context-menu.js 负责初始化全局 window.api / __CNF_VIEWS） -->
  <script src="/static/component-context-menu.js"></script>
  <script src="/static/component-vm-wizard.js"></script>
  <!-- 9 模块视图 -->
  <script src="/static/view-dashboard.js"></script>
  <script src="/static/view-infrastructure.js"></script>
  <script src="/static/view-compute.js"></script>
  <script src="/static/view-availability.js"></script>
  <script src="/static/view-storage.js"></script>
  <script src="/static/view-network.js"></script>
  <script src="/static/view-monitoring.js"></script>
  <script src="/static/view-access-control.js"></script>
  <script src="/static/view-system.js"></script>
  <!-- 应用根组件（最后加载） -->
  <script src="/static/app.js"></script>
</body>
</html>`)
})

export default app
