import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { mockData, genMetrics } from './mock-data'
import { buildDomainXML, type VMConfig } from './libvirt-xml'

const app = new Hono()

app.use('/api/*', cors())

// ============================ API：层级资源 ============================
app.get('/api/datacenters', (c) => c.json(mockData.datacenters))
app.get('/api/clusters', (c) => c.json(mockData.clusters))
app.get('/api/hosts', (c) => c.json(mockData.hosts))
app.get('/api/vms', (c) => c.json(mockData.vms))
app.get('/api/gpus', (c) => c.json(mockData.gpus))
app.get('/api/storage-pools', (c) => c.json(mockData.storage_pools))
app.get('/api/tasks', (c) => c.json(mockData.tasks))
app.get('/api/snapshots', (c) => c.json(mockData.snapshots))
app.get('/api/migrations', (c) => c.json(mockData.migrations))
app.get('/api/cluster-configs', (c) => c.json(mockData.cluster_configs))
app.get('/api/roles', (c) => c.json(mockData.roles))
app.get('/api/privileges', (c) => c.json(mockData.all_privileges))
app.get('/api/permission-assignments', (c) => c.json(mockData.permission_assignments))

// 模拟保存集群配置
app.put('/api/cluster-configs/:id', async (c) => {
  const body = await c.req.json()
  return c.json({ ...body, id: Number(c.req.param('id')), saved: true, message: '（原型）集群设置已保存' })
})

// 模拟提交热迁移：返回任务句柄
app.post('/api/migrate', async (c) => {
  const body = await c.req.json<{ vm: string; dst: string; live?: boolean; storage?: boolean }>()
  return c.json({
    task_uuid: crypto.randomUUID(),
    vm: body.vm,
    dst: body.dst,
    live: !!body.live,
    storage: !!body.storage,
    status: 'running',
    message: '（原型）热迁移任务已提交，可轮询 /api/migrate/progress',
  })
})

// 模拟迁移进度：依据 elapsed 计算渐进进度（确定性，便于演示动画）
app.get('/api/migrate/progress', (c) => {
  const start = Number(c.req.query('start') || Date.now())
  const elapsed = (Date.now() - start) / 1000
  const total = 8 // 8 秒走完
  const pct = Math.min(100, Math.round((elapsed / total) * 100))
  // 迁移阶段：内存预拷贝 → 脏页迭代 → 停机切换 → 完成
  let phase = '内存预拷贝'
  if (pct >= 95) phase = '停机切换（downtime）'
  else if (pct >= 60) phase = '脏页迭代收敛'
  else if (pct >= 100) phase = '完成'
  return c.json({
    progress: pct,
    phase: pct >= 100 ? '完成' : phase,
    throughput_mbps: pct >= 100 ? 0 : 8000 + Math.round(Math.random() * 2000),
    remaining_mb: Math.max(0, Math.round((100 - pct) * 81.92)),
    done: pct >= 100,
  })
})

// 模拟创建快照
app.post('/api/snapshots', async (c) => {
  const body = await c.req.json<{ vm: string; name: string; with_memory?: boolean; quiesce?: boolean }>()
  return c.json({
    id: 999, vm: body.vm, name: body.name,
    with_memory: !!body.with_memory, quiesce: !!body.quiesce,
    status: 'success',
    message: '（原型）快照已创建' + (body.with_memory ? '（含内存+NVRAM）' : '（仅磁盘）'),
  })
})

// 资源拓扑树（数据中心 → 集群 → 主机 → VM）
app.get('/api/topology', (c) => {
  const tree = mockData.datacenters.map(dc => ({
    ...dc,
    children: mockData.clusters.filter(cl => cl.datacenter_id === dc.id).map(cl => ({
      ...cl,
      children: mockData.hosts.filter(h => h.cluster_id === cl.id).map(h => ({
        ...h,
        children: mockData.vms.filter(v => v.host_id === h.id),
      })),
    })),
  }))
  return c.json(tree)
})

// 汇总指标
app.get('/api/summary', (c) => {
  const running = mockData.vms.filter(v => v.status === 'running').length
  return c.json({
    datacenters: mockData.datacenters.length,
    clusters: mockData.clusters.length,
    hosts: mockData.hosts.length,
    hosts_connected: mockData.hosts.filter(h => h.status === 'connected').length,
    vms: mockData.vms.length,
    vms_running: running,
    gpus: mockData.gpus.length,
    gpus_assigned: mockData.gpus.filter(g => g.status === 'assigned').length,
    storage_pools: mockData.storage_pools.length,
  })
})

// ============================ API：libvirt XML 实时预览 ============================
// 真实可用的逻辑：接收 VM 配置 → 返回 libvirt domain XML
app.post('/api/preview-xml', async (c) => {
  const cfg = await c.req.json<VMConfig>()
  try {
    const xml = buildDomainXML(cfg)
    return c.json({ xml, vcpus: cfg.cpu_sockets * cfg.cpu_cores_per_socket * cfg.cpu_threads_per_core })
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

// 模拟创建 VM
app.post('/api/vms', async (c) => {
  const cfg = await c.req.json()
  return c.json({ id: 999, name: cfg.name, status: 'starting', message: '（原型）VM 创建任务已提交' })
})

// ============================ API：SSE 实时监控流 ============================
app.get('/api/metrics/stream', (c) => {
  return c.body(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder()
        let count = 0
        const push = () => {
          const data = JSON.stringify(genMetrics())
          controller.enqueue(enc.encode(`data: ${data}\n\n`))
          count++
          if (count > 600) { controller.close(); return }
        }
        push()
        const timer = setInterval(push, 2000)
        c.req.raw.signal?.addEventListener('abort', () => { clearInterval(timer); controller.close() })
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } }
  )
})

// 一次性指标快照（SSE 不可用时回退）
app.get('/api/metrics', (c) => c.json(genMetrics()))

// favicon（内联 SVG，避免 404）
app.get('/favicon.ico', (c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#007AFF"/><text x="16" y="22" font-size="18" text-anchor="middle" fill="white" font-family="sans-serif">C</text></svg>`
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml' })
})

// ============================ 前端 SPA ============================
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CNFv1.0 · 企业级虚拟化管理平台</title>
  <link rel="stylesheet" href="/static/apple-hig.css">
  <link rel="stylesheet" href="/static/app.css">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.global.prod.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
</head>
<body>
  <div id="app"></div>
  <script src="/static/i18n.js"></script>
  <script src="/static/views-dashboard.js"></script>
  <script src="/static/views-resources.js"></script>
  <script src="/static/views-operations.js"></script>
  <script src="/static/views-admin.js"></script>
  <script src="/static/views-drs.js"></script>
  <script src="/static/views-wizard.js"></script>
  <script src="/static/app.js"></script>
</body>
</html>`)
})

export default app
