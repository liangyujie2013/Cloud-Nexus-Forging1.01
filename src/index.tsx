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
import { mockData, genMetrics, getHostHardware, getHostHA, getClusterHAStatus } from './mock-data'
import { buildDomainXML, type VMConfig } from './libvirt-xml'

// 静态资源缓存破坏版本号：每次进程启动生成一次，附加到所有 /static/*.js|css 的查询串，
// 确保前端发布后浏览器不会命中旧缓存（此前无版本号导致用户刷新仍看到旧界面）。
const ASSET_VER = String(Date.now())

// UUID 生成：优先用 Web Crypto（Cloudflare Workers / 现代 Node），否则回退手工生成（兼容 Node 18 无全局 crypto 的情况）
const genUUID = (): string => {
  try { const g: any = (globalThis as any).crypto; if (g && typeof g.randomUUID === 'function') return g.randomUUID() } catch {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16) })
}

const app = new Hono()
const API = '/api/v1'

app.use(`${API}/*`, cors())

// ============================================================================
//  N4 · 虚拟机硬件配置（虚拟磁盘 / 网络适配器 / 引导项）内存模型
//  首次访问按 volumes / vlans 派生默认配置，后续编辑写入内存覆盖层。
// ============================================================================
const vmConfigStore: Record<number, any> = {}
const DISK_BUS = ['virtio-scsi', 'virtio-blk', 'sata', 'ide', 'nvme']
const NIC_MODELS = ['virtio', 'e1000e', 'rtl8139', 'sriov']
function deriveVmConfig(vm: any) {
  if (vmConfigStore[vm.id]) return vmConfigStore[vm.id]
  // 磁盘：优先取 volumes 中归属该 VM 的卷，否则给一块系统盘
  const vols = mockData.volumes.filter((v: any) => v.vm === vm.name)
  const disks =
    vols.length > 0
      ? vols.map((v: any, i: number) => ({
          id: i + 1, name: v.name, pool: v.pool, format: v.format, size_gb: v.size_gb,
          used_gb: v.used_gb, bus: v.bus || 'virtio-scsi', cache: 'none', iops_limit: v.iops_limit || 0,
          boot_order: i === 0 ? 1 : 0, shareable: false,
        }))
      : [{ id: 1, name: `${vm.name}-disk0`, pool: 'prod-nfs-pool', format: 'qcow2', size_gb: 40, used_gb: 8, bus: 'virtio-scsi', cache: 'none', iops_limit: 0, boot_order: 1, shareable: false }]
  // 网卡：默认一块 virtio 接入业务前端 VLAN
  const nics = [
    { id: 1, model: 'virtio', portgroup: '业务前端 VLAN', vlan_id: 10, mac: '52:54:00:' + vm.id.toString(16).padStart(2, '0') + ':a1:01', connected: true, queues: 4, sriov_pf: '', sriov_vf: null },
  ]
  const cfg = {
    vm_id: vm.id,
    boot: { firmware: 'uefi', secure_boot: false, boot_menu: false, boot_order: ['disk', 'cdrom', 'network'] },
    disks,
    nics,
  }
  vmConfigStore[vm.id] = cfg
  return cfg
}

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
//
//  ★ 严格层级血缘：数据中心 → 集群 → 宿主机 → 虚拟机
//    · datacenterStats / clusterStats / hostStats：实时聚合派生（自动计算下级数量与在线状态）
//    · addHostToCluster：节点纳管（IP 去重 + 集群存在校验 + 自动继承 datacenter_id）
//    · getMigrationTargets：迁移目标只能是「同集群内的其他在线非维护主机」
//    · 级联删除校验：删 DC 前查集群 / 删集群前查主机 / 移除主机前查运行 VM
// ============================================================================

// ---- 聚合统计计算（单一可信来源，前后端一致）----
function computeDatacenterStats() {
  return mockData.datacenters.map((dc) => {
    const dcClusters = mockData.clusters.filter((cl) => cl.datacenter_id === dc.id)
    const dcHosts = mockData.hosts.filter((h) => h.datacenter_id === dc.id)
    const dcVMs = mockData.vms.filter((v) => v.datacenter_id === dc.id)
    return {
      ...dc,
      cluster_count: dcClusters.length,
      host_count: dcHosts.length,
      host_online: dcHosts.filter((h) => h.status === 'connected').length,
      vm_count: dcVMs.length,
      vm_running: dcVMs.filter((v) => v.status === 'running').length,
    }
  })
}
function computeClusterStats() {
  return mockData.clusters.map((cl) => {
    const clHosts = mockData.hosts.filter((h) => h.cluster_id === cl.id)
    const clVMs = mockData.vms.filter((v) => v.cluster_id === cl.id)
    const dc = mockData.datacenters.find((d) => d.id === cl.datacenter_id)
    return {
      ...cl,
      datacenter_name: dc?.name || '未知',
      host_count: clHosts.length,
      host_online: clHosts.filter((h) => h.status === 'connected').length,
      vm_count: clVMs.length,
      vm_running: clVMs.filter((v) => v.status === 'running').length,
    }
  })
}
function computeHostStats() {
  return mockData.hosts.map((h) => {
    const hostVMs = mockData.vms.filter((v) => v.host_id === h.id)
    const cl = mockData.clusters.find((c2) => c2.id === h.cluster_id)
    const dc = mockData.datacenters.find((d) => d.id === h.datacenter_id)
    return {
      ...h,
      cluster_name: cl?.name || '未分配',
      datacenter_name: dc?.name || '未知',
      vm_count: hostVMs.length,
      vm_running: hostVMs.filter((v) => v.status === 'running').length,
      vms_list: hostVMs.map((v) => ({ id: v.id, name: v.name, status: v.status, vcpus: v.vcpus, mem_gb: v.mem_gb })),
    }
  })
}

// 数据中心（带聚合统计）
app.get(`${API}/datacenters`, (c) => c.json(computeDatacenterStats()))
// 集群（带聚合统计 + 数据中心归属名）
app.get(`${API}/clusters`, (c) => c.json(computeClusterStats()))
// 主机（带聚合统计 + 集群/数据中心归属名 + 该主机上的 VM 列表）
app.get(`${API}/hosts`, (c) => c.json(computeHostStats()))
app.get(`${API}/resource-pools`, (c) => {
  // 附带所属集群名，便于前端展示资源池所在的集群
  return c.json(
    mockData.resource_pools.map((p: any) => {
      const cl = mockData.clusters.find((x: any) => x.id === p.cluster_id)
      return { ...p, cluster_name: cl ? cl.name : '—' }
    }),
  )
})

// 资源池 — 创建
app.post(`${API}/resource-pools`, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const name = (body.name || '').trim()
  if (!name) return c.json({ error: '资源池名称不能为空', code: 'NAME_REQUIRED' }, 400)
  if (mockData.resource_pools.some((p: any) => p.name === name))
    return c.json({ error: `资源池「${name}」已存在`, code: 'NAME_DUPLICATE' }, 409)
  if (!body.cluster_id) return c.json({ error: '请选择所属集群', code: 'CLUSTER_REQUIRED' }, 400)
  // 预留值不得超过上限（容量预留校验）
  if (Number(body.cpu_reserved_vcpu) > Number(body.cpu_limit_vcpu))
    return c.json({ error: 'CPU 预留值不能超过 CPU 上限', code: 'CPU_RESERVE_EXCEED' }, 400)
  if (Number(body.mem_reserved_gb) > Number(body.mem_limit_gb))
    return c.json({ error: '内存预留值不能超过内存上限', code: 'MEM_RESERVE_EXCEED' }, 400)
  const id = Math.max(0, ...mockData.resource_pools.map((p: any) => p.id)) + 1
  const pool = {
    id,
    cluster_id: Number(body.cluster_id),
    name,
    cpu_shares: body.cpu_shares || 'normal',
    cpu_limit_vcpu: Number(body.cpu_limit_vcpu) || 0,
    cpu_reserved_vcpu: Number(body.cpu_reserved_vcpu) || 0,
    mem_limit_gb: Number(body.mem_limit_gb) || 0,
    mem_reserved_gb: Number(body.mem_reserved_gb) || 0,
    vms: 0,
  }
  mockData.resource_pools.push(pool)
  return c.json({ ok: true, pool })
})

// 资源池 — 编辑
app.put(`${API}/resource-pools/:id`, async (c) => {
  const id = Number(c.req.param('id'))
  const pool = mockData.resource_pools.find((p: any) => p.id === id)
  if (!pool) return c.json({ error: '资源池不存在', code: 'NOT_FOUND' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const name = (body.name || '').trim()
  if (!name) return c.json({ error: '资源池名称不能为空', code: 'NAME_REQUIRED' }, 400)
  if (mockData.resource_pools.some((p: any) => p.name === name && p.id !== id))
    return c.json({ error: `资源池「${name}」已存在`, code: 'NAME_DUPLICATE' }, 409)
  if (Number(body.cpu_reserved_vcpu) > Number(body.cpu_limit_vcpu))
    return c.json({ error: 'CPU 预留值不能超过 CPU 上限', code: 'CPU_RESERVE_EXCEED' }, 400)
  if (Number(body.mem_reserved_gb) > Number(body.mem_limit_gb))
    return c.json({ error: '内存预留值不能超过内存上限', code: 'MEM_RESERVE_EXCEED' }, 400)
  pool.name = name
  if (body.cluster_id) pool.cluster_id = Number(body.cluster_id)
  pool.cpu_shares = body.cpu_shares || pool.cpu_shares
  pool.cpu_limit_vcpu = Number(body.cpu_limit_vcpu) || 0
  pool.cpu_reserved_vcpu = Number(body.cpu_reserved_vcpu) || 0
  pool.mem_limit_gb = Number(body.mem_limit_gb) || 0
  pool.mem_reserved_gb = Number(body.mem_reserved_gb) || 0
  return c.json({ ok: true, pool })
})

// 资源池 — 删除（含运行 VM 时阻止，需先迁出）
app.delete(`${API}/resource-pools/:id`, (c) => {
  const id = Number(c.req.param('id'))
  const idx = mockData.resource_pools.findIndex((p: any) => p.id === id)
  if (idx < 0) return c.json({ error: '资源池不存在', code: 'NOT_FOUND' }, 404)
  const pool = mockData.resource_pools[idx]
  if (pool.vms > 0)
    return c.json(
      { error: `资源池内仍有 ${pool.vms} 台虚拟机，请先迁出后再删除`, code: 'HAS_VMS', children: [`${pool.vms} 台虚拟机`] },
      409,
    )
  mockData.resource_pools.splice(idx, 1)
  return c.json({ ok: true })
})

// 基础设施层级拓扑：数据中心 → 集群 → 主机 → VM（含每级聚合统计）
app.get(`${API}/infrastructure/topology`, (c) => {
  const tree = computeDatacenterStats().map((dc) => ({
    ...dc,
    children: computeClusterStats()
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

// ---- 节点纳管：添加主机到集群（IP 去重 + 集群校验 + 自动继承 DC）----
app.post(`${API}/hosts`, async (c) => {
  const data = await c.req.json<{
    datacenter_id: number; cluster_id: number; hostname: string
    ip_address: string; ssh_port?: number; ssh_user?: string; ssh_password?: string
  }>()
  // 1) IP 去重
  const dup = mockData.hosts.find((h) => h.ip === data.ip_address)
  if (dup) return c.json({ error: `IP 地址 ${data.ip_address} 已被主机 ${dup.name} 使用`, code: 'IP_DUPLICATE' }, 409)
  // 2) 目标集群必须存在
  const cluster = mockData.clusters.find((cl) => cl.id === Number(data.cluster_id))
  if (!cluster) return c.json({ error: '目标集群不存在', code: 'CLUSTER_NOT_FOUND' }, 404)
  // 3) 创建主机（datacenter_id 自动从集群继承，真实硬件型号占位）
  const newHost = {
    id: Date.now(),
    cluster_id: cluster.id,
    datacenter_id: cluster.datacenter_id,
    name: data.hostname,
    hostname: data.hostname,
    ip: data.ip_address,
    ssh_port: Number(data.ssh_port) || 22,
    ssh_user: data.ssh_user || 'root',
    status: 'connected',
    maintenance_mode: false,
    cpu_model: 'Intel Xeon Gold 6348',
    sockets: 2, cores: 28, threads: 2, vcpus: 112, numa_nodes: 2,
    mem_total_gb: 256, mem_used_gb: 0,
    cpu_usage: 0, mem_usage: 0, vms: 0, gpus: 0, iommu: true,
    nic_model: 'Intel E810-XXVDA2 (2×25GbE)',
    raid_model: 'Broadcom MegaRAID 9560-8i',
    disk_model: 'Samsung PM9A3 1.92TB NVMe',
    last_heartbeat: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }
  mockData.hosts.push(newHost as any)
  return c.json({ ...newHost, cluster_name: cluster.name, message: `主机 ${newHost.name} 已加入集群 ${cluster.name}` })
})

// ---- 创建数据中心 ----
app.post(`${API}/datacenters`, async (c) => {
  const b = await c.req.json<any>()
  if (!b.name) return c.json({ error: '数据中心名称必填', code: 'INVALID' }, 400)
  if (mockData.datacenters.find((d) => d.name === b.name))
    return c.json({ error: `数据中心名称 ${b.name} 已存在`, code: 'NAME_DUPLICATE' }, 409)
  const dc = {
    id: Date.now(), name: b.name, location: b.location || '—',
    timezone: b.timezone || 'Asia/Shanghai', description: b.description || '',
    status: 'online', created_at: new Date().toISOString(), clusters: 0, hosts: 0, vms: 0,
  }
  mockData.datacenters.push(dc as any)
  return c.json({ ...dc, message: `数据中心 ${dc.name} 已创建` })
})
// ---- 编辑数据中心 ----
app.put(`${API}/datacenters/:id`, async (c) => {
  const id = Number(c.req.param('id'))
  const dc = mockData.datacenters.find((d) => d.id === id)
  if (!dc) return c.json({ error: '数据中心不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<any>()
  if (b.name && b.name !== dc.name && mockData.datacenters.find((d) => d.name === b.name))
    return c.json({ error: `数据中心名称 ${b.name} 已存在`, code: 'NAME_DUPLICATE' }, 409)
  if (b.name) dc.name = b.name
  if (b.location !== undefined) dc.location = b.location
  if (b.timezone) dc.timezone = b.timezone
  if (b.description !== undefined) dc.description = b.description
  return c.json({ ...dc, message: '数据中心已更新' })
})

// ---- 删除数据中心：级联校验（有集群则阻止）----
app.delete(`${API}/datacenters/:id`, (c) => {
  const id = Number(c.req.param('id'))
  const childClusters = mockData.clusters.filter((cl) => cl.datacenter_id === id)
  if (childClusters.length > 0) {
    return c.json({ error: `数据中心下仍有 ${childClusters.length} 个集群，请先移除集群`, code: 'HAS_CHILDREN', children: childClusters.map((x) => x.name) }, 409)
  }
  mockData.datacenters = mockData.datacenters.filter((d) => d.id !== id)
  return c.json({ id, deleted: true, message: '数据中心已删除' })
})

// ---- 创建集群（须归属数据中心）----
app.post(`${API}/clusters`, async (c) => {
  const b = await c.req.json<any>()
  if (!b.name || !b.datacenter_id) return c.json({ error: '集群名称与所属数据中心必填', code: 'INVALID' }, 400)
  if (mockData.clusters.find((cl) => cl.name === b.name))
    return c.json({ error: `集群名称 ${b.name} 已存在`, code: 'NAME_DUPLICATE' }, 409)
  const dc = mockData.datacenters.find((d) => d.id === Number(b.datacenter_id))
  if (!dc) return c.json({ error: '所属数据中心不存在', code: 'DC_NOT_FOUND' }, 404)
  const cl = {
    id: Date.now(), datacenter_id: dc.id, name: b.name, description: b.description || '',
    ha_enabled: b.ha_enabled !== false, drs_enabled: !!b.drs_enabled,
    overcommit_cpu: Number(b.overcommit_cpu) || 4.0, status: 'healthy',
    created_at: new Date().toISOString(), hosts: 0, vms: 0, evc_mode: b.evc_mode || '-',
    // 时间同步（NTP）：HA 时间一致性基础。internal=集群内部 NTP 源（推荐，不依赖外网），external=外部源
    ntp_mode: b.ntp_mode === 'external' ? 'external' : 'internal',
    ntp_internal_server: b.ntp_internal_server || '',
    ntp_servers: Array.isArray(b.ntp_servers) ? b.ntp_servers : (b.ntp_servers ? String(b.ntp_servers).split(',').map((s: string) => s.trim()).filter(Boolean) : []),
    max_clock_offset_ms: Number(b.max_clock_offset_ms) || 100,
  }
  mockData.clusters.push(cl as any)
  return c.json({ ...cl, datacenter_name: dc.name, message: `集群 ${cl.name} 已在 ${dc.name} 创建` })
})
// ---- 编辑集群 ----
app.put(`${API}/clusters/:id`, async (c) => {
  const id = Number(c.req.param('id'))
  const cl = mockData.clusters.find((x) => x.id === id)
  if (!cl) return c.json({ error: '集群不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<any>()
  if (b.name && b.name !== cl.name && mockData.clusters.find((x) => x.name === b.name))
    return c.json({ error: `集群名称 ${b.name} 已存在`, code: 'NAME_DUPLICATE' }, 409)
  if (b.name) cl.name = b.name
  if (b.description !== undefined) cl.description = b.description
  if (b.ha_enabled !== undefined) cl.ha_enabled = b.ha_enabled
  if (b.drs_enabled !== undefined) cl.drs_enabled = b.drs_enabled
  if (b.overcommit_cpu !== undefined) cl.overcommit_cpu = Number(b.overcommit_cpu)
  if (b.datacenter_id) { const dc = mockData.datacenters.find((d) => d.id === Number(b.datacenter_id)); if (dc) cl.datacenter_id = dc.id }
  // NTP / 时间同步配置更新
  if (b.ntp_mode !== undefined) (cl as any).ntp_mode = b.ntp_mode === 'external' ? 'external' : 'internal'
  if (b.ntp_internal_server !== undefined) (cl as any).ntp_internal_server = b.ntp_internal_server
  if (b.ntp_servers !== undefined) (cl as any).ntp_servers = Array.isArray(b.ntp_servers) ? b.ntp_servers : String(b.ntp_servers).split(',').map((s: string) => s.trim()).filter(Boolean)
  if (b.max_clock_offset_ms !== undefined) (cl as any).max_clock_offset_ms = Number(b.max_clock_offset_ms) || 100
  return c.json({ ...cl, message: '集群已更新' })
})

// ---- 删除集群：级联校验（有主机则阻止）----
app.delete(`${API}/clusters/:id`, (c) => {
  const id = Number(c.req.param('id'))
  const childHosts = mockData.hosts.filter((h) => h.cluster_id === id)
  if (childHosts.length > 0) {
    return c.json({ error: `集群下仍有 ${childHosts.length} 台主机，请先移除主机`, code: 'HAS_CHILDREN', children: childHosts.map((x) => x.name) }, 409)
  }
  mockData.clusters = mockData.clusters.filter((cl) => cl.id !== id)
  return c.json({ id, deleted: true, message: '集群已删除' })
})

// ---- 移除主机：级联校验（有运行中 VM 则阻止）----
app.delete(`${API}/hosts/:id`, (c) => {
  const id = Number(c.req.param('id'))
  const runningVMs = mockData.vms.filter((v) => v.host_id === id && v.status === 'running')
  if (runningVMs.length > 0) {
    return c.json({ error: `主机上仍有 ${runningVMs.length} 台运行中的虚拟机，请先迁移或关机`, code: 'HAS_RUNNING_VM', children: runningVMs.map((x) => x.name) }, 409)
  }
  mockData.hosts = mockData.hosts.filter((h) => h.id !== id)
  return c.json({ id, deleted: true, message: '主机已移除' })
})

// ---- 主机硬件深度详情（CPU 拓扑 / 网卡 / 存储设备 / PCI 设备 / HA）----
app.get(`${API}/hosts/:id/hardware`, (c) => {
  const hw = getHostHardware(Number(c.req.param('id')))
  if (!hw) return c.json({ error: '主机不存在', code: 'NOT_FOUND' }, 404)
  return c.json(hw)
})
// ---- 主机 HA 状态（五项检查 + 健康分 + 事件）----
app.get(`${API}/hosts/:id/ha-status`, (c) => {
  const ha = getHostHA(Number(c.req.param('id')))
  if (!ha) return c.json({ error: '主机不存在', code: 'NOT_FOUND' }, 404)
  return c.json(ha)
})
// ---- 切换主机维护模式（维护中不接收新 VM / 触发 DRS 撤离）----
app.post(`${API}/hosts/:id/maintenance`, async (c) => {
  const id = Number(c.req.param('id'))
  const host = mockData.hosts.find((h) => h.id === id)
  if (!host) return c.json({ error: '主机不存在', code: 'NOT_FOUND' }, 404)
  const body = await c.req.json<{ enabled?: boolean }>().catch(() => ({} as any))
  const enable = body.enabled ?? !host.maintenance_mode
  if (enable) {
    const runningVMs = mockData.vms.filter((v) => v.host_id === id && v.status === 'running')
    if (runningVMs.length > 0)
      return c.json({ error: `主机上仍有 ${runningVMs.length} 台运行中的虚拟机，请先迁移`, code: 'HAS_RUNNING_VM', children: runningVMs.map((x) => x.name) }, 409)
  }
  host.maintenance_mode = enable
  host.status = enable ? 'maintenance' : 'connected'
  if (enable) { host.cpu_usage = 0; host.mem_used_gb = 0; host.mem_usage = 0 }
  return c.json({ id, maintenance_mode: enable, status: host.status, message: enable ? `主机 ${host.name} 已进入维护模式` : `主机 ${host.name} 已退出维护模式` })
})

// ---- 主机电源操作（IPMI/BMC）：power_on / reboot / shutdown（N3）----
app.post(`${API}/hosts/:id/power`, async (c) => {
  const id = Number(c.req.param('id'))
  const host = mockData.hosts.find((h) => h.id === id)
  if (!host) return c.json({ error: '主机不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<{ action?: string }>().catch(() => ({} as any))
  const action = b.action || ''
  const runningVMs = mockData.vms.filter((v) => v.host_id === id && v.status === 'running')
  if (action === 'power_on') {
    if (host.status === 'connected') return c.json({ error: '主机已在线', code: 'ALREADY_ON' }, 409)
    host.status = 'connected'; host.maintenance_mode = false
    return c.json({ ok: true, status: host.status, message: `已下发开机指令（IPMI/BMC）→ ${host.name}` })
  }
  if (action === 'shutdown') {
    // 关机会导致其上虚拟机停止 — 回执给出影响范围
    host.status = 'disconnected'
    mockData.vms.filter((v) => v.host_id === id).forEach((v) => { v.status = 'stopped' })
    host.cpu_usage = 0; host.mem_used_gb = 0; host.mem_usage = 0
    return c.json({ ok: true, status: host.status, affected_vms: runningVMs.map((x) => x.name), message: `已下发关机指令 → ${host.name}` })
  }
  if (action === 'reboot') {
    return c.json({ ok: true, status: host.status, affected_vms: runningVMs.map((x) => x.name), message: `已下发重启指令 → ${host.name}` })
  }
  return c.json({ error: '未知的电源操作', code: 'BAD_ACTION' }, 400)
})

// ---- N5 · 在宿主机物理网卡 (PF) 上启用 SR-IOV，分配 VF 数量 ----
// 真实环境：echo N > /sys/class/net/<pf>/device/sriov_numvfs，并确保 IOMMU 已开启
app.post(`${API}/hosts/:id/sriov`, async (c) => {
  const id = Number(c.req.param('id'))
  const host: any = mockData.hosts.find((h) => h.id === id)
  if (!host) return c.json({ error: '主机不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json().catch(() => ({} as any))
  if (!host.iommu) return c.json({ error: '启用 SR-IOV 前必须先开启 IOMMU/VFIO', code: 'IOMMU_REQUIRED' }, 409)
  host.sriov_pfs = host.sriov_pfs || []
  const pfName = b.pf || ('ens' + (host.sriov_pfs.length + 6) + 'f0')
  if (b.enabled === false) {
    const pf = host.sriov_pfs.find((p: any) => p.pf === pfName)
    if (pf && pf.used_vfs > 0) return c.json({ error: `PF ${pfName} 仍有 ${pf.used_vfs} 个 VF 被虚拟机占用，请先解除`, code: 'VF_IN_USE' }, 409)
    host.sriov_pfs = host.sriov_pfs.filter((p: any) => p.pf !== pfName)
    return c.json({ ok: true, sriov_pfs: host.sriov_pfs, message: `已在 ${host.name} 上禁用 PF ${pfName} 的 SR-IOV` })
  }
  const numVfs = Math.max(1, Math.min(64, Number(b.num_vfs) || 8))
  const existing = host.sriov_pfs.find((p: any) => p.pf === pfName)
  const vfs = Array.from({ length: numVfs }, (_, i) => ({ vf: i, used: existing ? !!(existing.vfs[i] && existing.vfs[i].used) : false, vm: existing && existing.vfs[i] ? existing.vfs[i].vm : undefined }))
  const used_vfs = vfs.filter((v: any) => v.used).length
  const rec = { pf: pfName, nic_model: b.nic_model || host.nic_model || 'Mellanox ConnectX-6 Dx', total_vfs: numVfs, used_vfs, link_gbe: b.link_gbe || 100, vfs }
  if (existing) Object.assign(existing, rec)
  else host.sriov_pfs.push(rec)
  return c.json({
    ok: true, sriov_pfs: host.sriov_pfs,
    steps: [`已在 ${pfName} 写入 sriov_numvfs=${numVfs}`, '已加载网卡 VF 驱动', 'VF 现可在虚拟机网卡配置中直通分配'],
    message: `已在 ${host.name} 的 ${pfName} 启用 SR-IOV（${numVfs} 个 VF）`,
  })
})

// ---- 启用/禁用主机 IOMMU + VFIO（直通就绪）。真实环境需写 GRUB 内核参数并重启 ----
app.post(`${API}/hosts/:id/iommu`, async (c) => {
  const id = Number(c.req.param('id'))
  const host = mockData.hosts.find((h) => h.id === id)
  if (!host) return c.json({ error: '主机不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<{ enabled?: boolean }>().catch(() => ({} as any))
  const enable = b.enabled ?? !(host as any).iommu
  ;(host as any).iommu = enable
  return c.json({
    id, iommu: enable,
    // 真实环境的可执行步骤回执，前端可展示给运维
    steps: enable
      ? ['已写入内核引导参数（intel_iommu=on iommu=pt）', '已加载 vfio / vfio_pci / vfio_iommu_type1 模块', '需重启主机使 IOMMU 生效']
      : ['已移除内核引导参数', '需重启主机'],
    needs_reboot: true,
    message: enable ? `主机 ${host.name} 已配置启用 IOMMU/VFIO（重启后生效）` : `主机 ${host.name} 已禁用 IOMMU/VFIO（重启后生效）`,
  })
})

// ---- 绑定/解绑某 PCI 设备到 vfio-pci（直通栈）。bind=true 绑定，false 还原主机驱动 ----
app.post(`${API}/hosts/:id/pci/passthrough`, async (c) => {
  const id = Number(c.req.param('id'))
  const host = mockData.hosts.find((h) => h.id === id)
  if (!host) return c.json({ error: '主机不存在', code: 'NOT_FOUND' }, 404)
  if ((host as any).iommu === false) return c.json({ error: '请先启用主机 IOMMU/VFIO', code: 'IOMMU_DISABLED' }, 409)
  const b = await c.req.json<{ pci_address?: string; bind?: boolean }>().catch(() => ({} as any))
  if (!b.pci_address) return c.json({ error: '缺少 PCI 地址', code: 'INVALID' }, 400)
  const list: string[] = (host as any).vfio_bound || ((host as any).vfio_bound = [])
  // 已被 VM 占用的设备不允许解绑
  const inUse = mockData.gpus.some((g) => g.host_id === id && g.pci === b.pci_address && g.status === 'assigned')
  if (b.bind === false && inUse) return c.json({ error: '该设备已分配给虚拟机，请先释放', code: 'DEV_IN_USE' }, 409)
  if (b.bind === false) {
    const i = list.indexOf(b.pci_address); if (i >= 0) list.splice(i, 1)
  } else if (!list.includes(b.pci_address)) list.push(b.pci_address)
  return c.json({ id, pci_address: b.pci_address, bound: b.bind !== false, message: b.bind === false ? `设备 ${b.pci_address} 已还原主机驱动` : `设备 ${b.pci_address} 已绑定 vfio-pci（可直通）` })
})

// ---- GPU 直通模式切换（passthrough / vgpu）+ 释放分配 ----
app.post(`${API}/hosts/:id/gpu/:gpuId/mode`, async (c) => {
  const gid = Number(c.req.param('gpuId'))
  const gpu = mockData.gpus.find((g) => g.id === gid)
  if (!gpu) return c.json({ error: 'GPU 不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<{ mode?: 'passthrough' | 'vgpu'; release?: boolean }>().catch(() => ({} as any))
  if (b.release) {
    if (gpu.status === 'assigned') { gpu.status = 'available'; gpu.vm = null; gpu.util = 0; gpu.mem_used = 0 }
    return c.json({ id: gid, status: gpu.status, message: `GPU ${gpu.model} 已释放` })
  }
  if (b.mode) {
    if (gpu.status === 'assigned') return c.json({ error: 'GPU 已分配给虚拟机，请先释放后再切换模式', code: 'GPU_IN_USE' }, 409)
    gpu.mode = b.mode
  }
  return c.json({ id: gid, mode: gpu.mode, status: gpu.status, message: `GPU ${gpu.model} 模式已切换为 ${gpu.mode === 'vgpu' ? 'vGPU 切分' : 'PCI 直通'}` })
})

// ---- 校验：IPv4 地址 / 子网掩码格式 ----
const isIPv4 = (s: string) => /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(s)

// ---- 更新单台主机的管理网络（IP / 掩码 / 网关 / 管理 VLAN / 上联网卡）----
app.put(`${API}/hosts/:id/network`, async (c) => {
  const id = Number(c.req.param('id'))
  const host = mockData.hosts.find((h) => h.id === id)
  if (!host) return c.json({ error: '主机不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<any>().catch(() => ({}))
  // 字段校验（仅校验本次提交的字段）
  if (b.ip != null && !isIPv4(b.ip)) return c.json({ error: '管理 IP 格式无效', code: 'INVALID' }, 400)
  if (b.netmask != null && !isIPv4(b.netmask)) return c.json({ error: '子网掩码格式无效', code: 'INVALID' }, 400)
  if (b.gateway != null && b.gateway !== '' && !isIPv4(b.gateway)) return c.json({ error: '网关格式无效', code: 'INVALID' }, 400)
  if (b.mgmt_vlan != null && (Number(b.mgmt_vlan) < 0 || Number(b.mgmt_vlan) > 4094)) return c.json({ error: '管理 VLAN 须为 0~4094', code: 'INVALID' }, 400)
  // IP 不可与其他主机冲突
  if (b.ip != null && mockData.hosts.some((h) => h.id !== id && h.ip === b.ip)) return c.json({ error: `管理 IP ${b.ip} 已被其他主机占用`, code: 'IP_CONFLICT' }, 409)
  if (b.ip != null) host.ip = b.ip
  if (b.netmask != null) (host as any).netmask = b.netmask
  if (b.gateway != null) (host as any).gateway = b.gateway
  if (b.mgmt_vlan != null) (host as any).mgmt_vlan = Number(b.mgmt_vlan)
  if (b.mgmt_nic != null) (host as any).mgmt_nic = b.mgmt_nic
  return c.json({ ...host, message: `主机 ${host.name} 管理网络已更新` })
})

// ---- 批量统一修改某集群下所有主机的管理网络（网关 / 掩码 / VLAN / 上联网卡）----
// 仅下发非空字段，IP 保持各主机原值（IP 唯一，不做批量覆盖）。
app.put(`${API}/clusters/:id/host-network`, async (c) => {
  const cid = Number(c.req.param('id'))
  const cluster = mockData.clusters.find((cl) => cl.id === cid)
  if (!cluster) return c.json({ error: '集群不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<any>().catch(() => ({}))
  if (b.netmask && !isIPv4(b.netmask)) return c.json({ error: '子网掩码格式无效', code: 'INVALID' }, 400)
  if (b.gateway && !isIPv4(b.gateway)) return c.json({ error: '网关格式无效', code: 'INVALID' }, 400)
  if (b.mgmt_vlan != null && b.mgmt_vlan !== '' && (Number(b.mgmt_vlan) < 0 || Number(b.mgmt_vlan) > 4094)) return c.json({ error: '管理 VLAN 须为 0~4094', code: 'INVALID' }, 400)
  const targets = mockData.hosts.filter((h) => h.cluster_id === cid)
  targets.forEach((h) => {
    if (b.netmask) (h as any).netmask = b.netmask
    if (b.gateway) (h as any).gateway = b.gateway
    if (b.mgmt_vlan != null && b.mgmt_vlan !== '') (h as any).mgmt_vlan = Number(b.mgmt_vlan)
    if (b.mgmt_nic) (h as any).mgmt_nic = b.mgmt_nic
  })
  return c.json({ cluster_id: cid, updated: targets.length, message: `已统一更新集群「${cluster.name}」下 ${targets.length} 台主机的管理网络` })
})

// ============================================================================
//  模块 3 · 计算资源 compute：虚拟机列表 / 模板管理 / ISO 镜像
// ============================================================================
app.get(`${API}/vms`, (c) => c.json(mockData.vms))
app.get(`${API}/vm-templates`, (c) => c.json(mockData.vm_templates))
// ---- ISO 镜像：补充「存储域归属 + 共享范围」语义（P9：让用户知道 ISO 存哪、谁能用）----
//  规则：ISO 落在某存储池(storage_pool)上；池若 shared=true 则该集群内所有主机可见，
//  否则仅挂载该池的主机本地可见。datacenter 级共享 = 该 DC 下挂载同一共享池的所有集群可见。
const enrichIso = (iso: any) => {
  const pool = mockData.storage_pools.find((p) => p.name === iso.pool)
  const cluster = pool ? mockData.clusters.find((cl) => cl.id === pool.cluster_id) : null
  const dc = cluster ? mockData.datacenters.find((d) => d.id === cluster.datacenter_id) : null
  const shared = pool ? !!pool.shared : false
  // 共享范围：cluster=本集群共享 / host=仅本机 / unknown
  const scope = !pool ? 'unknown' : shared ? 'cluster' : 'host'
  return {
    ...iso,
    storage_pool: iso.pool,
    pool_type: pool?.type || 'unknown',
    pool_path: pool ? `/var/lib/libvirt/images/iso/${pool.name}/${iso.name}` : `/var/lib/libvirt/images/iso/${iso.name}`,
    shared,
    scope,
    cluster_id: cluster?.id ?? null,
    cluster_name: cluster?.name ?? '未关联集群',
    datacenter_id: dc?.id ?? null,
    datacenter_name: dc?.name ?? '未关联数据中心',
    // 可见主机：共享池=该集群全部在线主机；本地池=挂载主机
    visible_hosts: pool
      ? (shared ? mockData.hosts.filter((h) => h.cluster_id === pool.cluster_id).map((h) => h.name)
                : (pool.host_id ? mockData.hosts.filter((h) => h.id === pool.host_id).map((h) => h.name) : []))
      : [],
  }
}
app.get(`${API}/iso-images`, (c) => c.json(mockData.iso_images.map(enrichIso)))
// ---- ISO 镜像仓概览：存储域列表 + 全局说明（P9 顶部说明横幅用）----
app.get(`${API}/iso-repositories`, (c) => {
  const repos = mockData.storage_pools
    .filter((p) => p.type === 'nfs' || p.type === 'iscsi' || p.type === 'local')
    .map((p) => {
      const cluster = mockData.clusters.find((cl) => cl.id === p.cluster_id)
      const dc = cluster ? mockData.datacenters.find((d) => d.id === cluster.datacenter_id) : null
      const isos = mockData.iso_images.filter((i) => i.pool === p.name)
      return {
        id: p.id, name: p.name, type: p.type, shared: !!p.shared,
        scope: p.shared ? 'cluster' : 'host',
        cluster_id: p.cluster_id, cluster_name: cluster?.name || '未关联',
        datacenter_id: dc?.id ?? null, datacenter_name: dc?.name || '未关联',
        iso_count: isos.length,
        used_gb: Math.round(isos.reduce((s, i) => s + (i.size_gb || 0), 0) * 10) / 10,
        capacity_tb: p.capacity_tb,
        mount_path: `/var/lib/libvirt/images/iso/${p.name}`,
      }
    })
  return c.json({
    repositories: repos,
    note: 'ISO 镜像存放于存储域（storage pool）下的 iso 子目录。共享存储域（NFS/iSCSI）内的镜像对该存储域所属集群的全部主机可见，可直接用于该集群任意宿主机创建/挂载；本地存储域（local）的镜像仅挂载该池的单台主机可见，不跨主机、不跨集群、不跨数据中心。',
  })
})
app.get(`${API}/gpus`, (c) => c.json(mockData.gpus))

// VM 电源操作（右键菜单：开机/关机/重启/挂起/恢复/强制关机）
// ---- N4 · 获取 VM 完整硬件配置（编辑对话框初始化）----
app.get(`${API}/vms/:id/hardware`, (c) => {
  const id = Number(c.req.param('id'))
  const vm = mockData.vms.find((v) => v.id === id)
  if (!vm) return c.json({ error: '虚拟机不存在', code: 'NOT_FOUND' }, 404)
  const cfg = deriveVmConfig(vm)
  // 可选项：存储池（按集群可见）/ 端口组（VLAN）/ 总线 / 网卡型号 / SR-IOV PF 列表
  const host = mockData.hosts.find((h) => h.id === vm.host_id)
  const pools = mockData.storage_pools
    .filter((p: any) => !p.host_id || p.host_id === vm.host_id)
    .map((p: any) => ({ name: p.name, type: p.type, shared: p.shared, free_tb: +(p.capacity_tb - p.used_tb).toFixed(2) }))
  const portgroups = mockData.vlans.map((v: any) => ({ name: v.name, vlan_id: v.vlan_id, subnet: v.subnet, vswitch: v.vswitch }))
  // SR-IOV：宿主机上已启用 SR-IOV 的物理网卡（PF）及其可用 VF
  const sriovPfs = (host && (host as any).sriov_pfs) ? (host as any).sriov_pfs : []
  return c.json({
    vm: { id: vm.id, name: vm.name, status: vm.status, vcpus: vm.vcpus, sockets: vm.sockets, cores: vm.cores, threads: vm.threads, mem_gb: vm.mem_gb, os: vm.os, cpu_pinning: (vm as any).cpu_pinning, host_id: vm.host_id },
    config: cfg,
    options: { disk_bus: DISK_BUS, nic_models: NIC_MODELS, pools, portgroups, sriov_pfs: sriovPfs },
  })
})

// ---- N4 · 保存 VM 硬件配置（运行中仅允许热插拔类变更，离线允许全部）----
app.put(`${API}/vms/:id/hardware`, async (c) => {
  const id = Number(c.req.param('id'))
  const vm = mockData.vms.find((v) => v.id === id)
  if (!vm) return c.json({ error: '虚拟机不存在', code: 'NOT_FOUND' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const cfg = deriveVmConfig(vm)
  const running = vm.status === 'running'
  const warnings: string[] = []
  // CPU/内存：运行中变更需支持热插（vCPU 仅可增加、内存仅可增加），否则提示重启生效
  if (body.vm) {
    const nv = body.vm
    if (nv.name && nv.name.trim()) vm.name = nv.name.trim()
    if (typeof nv.vcpus === 'number') {
      if (running && nv.vcpus < vm.vcpus) warnings.push('运行中不支持热移除 vCPU，缩减将在下次重启后生效')
      vm.vcpus = nv.vcpus
    }
    if (typeof nv.mem_gb === 'number') {
      if (running && nv.mem_gb < vm.mem_gb) warnings.push('运行中不支持热缩减内存，缩减将在下次重启后生效')
      vm.mem_gb = nv.mem_gb; ;(vm as any).mem_mb = nv.mem_gb * 1024
    }
  }
  // 磁盘 / 网卡 / 引导：整体替换（前端提交完整数组）
  if (Array.isArray(body.disks)) {
    // 校验：至少一块磁盘、引导盘唯一
    if (body.disks.length === 0) return c.json({ error: '至少需要保留一块虚拟磁盘', code: 'NO_DISK' }, 400)
    cfg.disks = body.disks
  }
  if (Array.isArray(body.nics)) {
    // SR-IOV 网卡校验：选择 sriov 型号必须指定 PF + VF
    for (const n of body.nics) {
      if (n.model === 'sriov' && (!n.sriov_pf || n.sriov_vf == null))
        return c.json({ error: `SR-IOV 网卡必须选择对应的 PF 和 VF`, code: 'SRIOV_INCOMPLETE' }, 400)
    }
    cfg.nics = body.nics
  }
  if (body.boot) cfg.boot = { ...cfg.boot, ...body.boot }
  vmConfigStore[id] = cfg
  return c.json({ ok: true, config: cfg, warnings, message: `虚拟机「${vm.name}」配置已保存` })
})

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

// ============================================================================
//  P10 · 企业级 VM 迁移（右键向导）：数据中心 → 集群 → 主机 → 资源校验 →
//        冷/热迁移 + 共享存储/非共享存储逻辑 + 跨 DC/集群/节点网络路径
// ============================================================================
// 判断源主机与目标主机是否共享同一存储域（决定是否需要存储迁移 storage migration）
const hostsShareStorage = (srcHostId: number, dstHostId: number): { shared: boolean; pool?: string } => {
  const src = mockData.hosts.find((h) => h.id === srcHostId)
  const dst = mockData.hosts.find((h) => h.id === dstHostId)
  if (!src || !dst) return { shared: false }
  // 共享存储池挂在集群级（cluster_id），同集群且存在 shared 池即视为共享存储
  const sharedPools = mockData.storage_pools.filter((p) => p.shared)
  const srcShared = sharedPools.filter((p) => p.cluster_id === src.cluster_id)
  const dstShared = sharedPools.filter((p) => p.cluster_id === dst.cluster_id)
  const common = srcShared.find((sp) => dstShared.some((dp) => dp.name === sp.name))
  if (common) return { shared: true, pool: common.name }
  // 同集群即便不同池，只要两端都有共享池也认为可走共享存储（简化）
  if (src.cluster_id === dst.cluster_id && srcShared.length && dstShared.length) return { shared: true, pool: srcShared[0].name }
  return { shared: false }
}
// ---- N6 · 同指令集跨代 CPU 兼容性判定 ----
//  规则（对标 VMware EVC / KVM CPU baseline）：
//   1) 跨厂商（Intel↔AMD）指令集不兼容 → 热迁移不可，只能冷迁移
//   2) 同厂商跨代：高代→低代 可（向下兼容，目标可呈现旧 baseline）；
//      低代→高代 需以源 baseline 启动（EVC 模式），可热迁移但提示锁定基线
//   3) 同代/同型号 → 完全兼容
const cpuCompat = (src: any, dst: any): { compatible: boolean; live_ok: boolean; mode: 'same' | 'cross_gen_down' | 'cross_gen_up' | 'cross_vendor'; baseline: string; detail: string } => {
  if (!src || !dst) return { compatible: false, live_ok: false, mode: 'cross_vendor', baseline: '', detail: 'CPU 信息缺失' }
  const sv = src.cpu_vendor || 'intel'; const dv = dst.cpu_vendor || 'intel'
  const sg = src.cpu_gen || 0; const dg = dst.cpu_gen || 0
  if (sv !== dv)
    return { compatible: false, live_ok: false, mode: 'cross_vendor', baseline: '', detail: `跨 CPU 厂商不兼容（源 ${sv.toUpperCase()} ${src.cpu_microarch} → 目标 ${dv.toUpperCase()} ${dst.cpu_microarch}），只能冷迁移` }
  if (sg === dg)
    return { compatible: true, live_ok: true, mode: 'same', baseline: dst.cpu_baseline, detail: `同代 CPU（${src.cpu_microarch}），完全兼容，可热迁移` }
  if (sg > dg)
    // 高代迁向低代：需将虚拟 CPU 呈现为目标的旧指令集基线
    return { compatible: true, live_ok: true, mode: 'cross_gen_down', baseline: dst.cpu_baseline, detail: `同指令集跨代（${src.cpu_microarch} → ${dst.cpu_microarch}）：以目标基线 ${dst.cpu_baseline} 启动，可热迁移` }
  // 低代迁向高代：以源基线启动（EVC），保证回迁兼容
  return { compatible: true, live_ok: true, mode: 'cross_gen_up', baseline: src.cpu_baseline, detail: `同指令集跨代（${src.cpu_microarch} → ${dst.cpu_microarch}）：锁定源基线 ${src.cpu_baseline}（EVC）以保证可回迁，可热迁移` }
}

// ---- N6 · 网络一致性判定 ----
//  被迁移 VM 的每块网卡所接入的端口组/VLAN，目标主机必须都能提供，
//  否则迁移后 VM 网络不通 → 不允许热迁移，只能冷迁移（停机后人工调整网络）。
const networkMatch = (vm: any, dst: any): { ok: boolean; missing: string[]; detail: string } => {
  const cfg = vmConfigStore[vm.id]
  const nics = cfg ? cfg.nics : [{ portgroup: '业务前端 VLAN', vlan_id: 10, model: 'virtio' }]
  // 目标主机所属集群可用的端口组（按 vswitch 覆盖主机名）
  const dstHostName = dst.name
  const availPg = new Set<string>()
  for (const vlan of mockData.vlans) {
    const vsw = mockData.vswitches.find((s: any) => s.name === vlan.vswitch)
    if (vsw && Array.isArray(vsw.hosts) && vsw.hosts.includes(dstHostName)) availPg.add(vlan.name)
  }
  const missing: string[] = []
  for (const n of nics) {
    // SR-IOV 网卡：目标主机须有同名 PF 才能热迁移（VF 直通设备不可热迁移，按冷处理）
    if (n.model === 'sriov') { missing.push(`SR-IOV(${n.sriov_pf || 'VF'})`); continue }
    if (n.portgroup && !availPg.has(n.portgroup)) missing.push(n.portgroup)
  }
  const ok = missing.length === 0
  return {
    ok,
    missing,
    detail: ok ? '目标主机具备 VM 所有网卡的端口组，网络一致' : `目标主机缺少端口组：${missing.join('、')}，热迁移后网络不通`,
  }
}

// 计算源→目标主机的网络路径（同主机/同集群/跨集群/跨数据中心）
const migrationScope = (vm: any, dst: any): { scope: string; label: string; path: string[] } => {
  const src = mockData.hosts.find((h) => h.id === vm.host_id)
  if (!src) return { scope: 'unknown', label: '未知', path: [] }
  if (src.cluster_id === dst.cluster_id) return { scope: 'intra_cluster', label: '集群内迁移', path: [src.name, '集群内务网/迁移网络', dst.name] }
  if (src.datacenter_id === dst.datacenter_id) return { scope: 'cross_cluster', label: '跨集群迁移（同数据中心）', path: [src.name, '源集群上联', '数据中心骨干网', '目标集群上联', dst.name] }
  return { scope: 'cross_datacenter', label: '跨数据中心迁移', path: [src.name, '源 DC 出口', 'DC 互联专线/VPN', '目标 DC 入口', dst.name] }
}

// ---- 迁移目标拓扑：返回按「数据中心 → 集群 → 主机」分组的可迁移目标树 ----
//  企业级：支持跨集群、跨数据中心（不再硬限制同集群），并对每个候选主机给出资源匹配预判
app.get(`${API}/vms/:id/migration-targets`, (c) => {
  const id = Number(c.req.param('id'))
  const vm = mockData.vms.find((v) => v.id === id)
  if (!vm) return c.json({ error: '虚拟机不存在', code: 'VM_NOT_FOUND' }, 404)
  const tree = mockData.datacenters.map((dc) => ({
    id: dc.id, name: dc.name,
    clusters: mockData.clusters.filter((cl) => cl.datacenter_id === dc.id).map((cl) => ({
      id: cl.id, name: cl.name, ha_enabled: cl.ha_enabled,
      hosts: mockData.hosts.filter((h) => h.cluster_id === cl.id && h.id !== vm.host_id).map((h) => {
        const freeV = Math.max(0, h.vcpus - Math.round(h.vcpus * h.cpu_usage / 100))
        const freeM = Math.max(0, h.mem_total_gb - h.mem_used_gb)
        const okCpu = freeV >= vm.vcpus
        const okMem = freeM >= vm.mem_gb
        const available = h.status === 'connected' && !h.maintenance_mode
        return {
          id: h.id, name: h.name, ip: h.ip, status: h.status, available,
          cpu_usage: h.cpu_usage, mem_usage: h.mem_usage,
          free_vcpus: freeV, free_mem_gb: freeM,
          need_vcpus: vm.vcpus, need_mem_gb: vm.mem_gb,
          fit: available && okCpu && okMem ? 'ok' : !available ? 'unavailable' : (!okCpu || !okMem) ? 'insufficient' : 'ok',
          shared_storage: hostsShareStorage(vm.host_id, h.id).shared,
        }
      }),
    })),
  }))
  const srcHost = mockData.hosts.find((h) => h.id === vm.host_id)
  return c.json({
    vm_id: id, vm_name: vm.name, vm_status: vm.status,
    vcpus: vm.vcpus, mem_gb: vm.mem_gb, gpus: vm.gpus || 0,
    source_host_id: vm.host_id, source_host: srcHost?.name,
    source_cluster_id: vm.cluster_id, source_datacenter_id: vm.datacenter_id,
    // 运行中=可热迁移；停机=只能冷迁移
    can_live: vm.status === 'running',
    tree,
  })
})

// ---- 迁移预演：对指定目标主机计算完整迁移计划（类型/范围/存储/网络路径/资源校验）----
app.post(`${API}/vms/:id/migration-plan`, async (c) => {
  const id = Number(c.req.param('id'))
  const vm = mockData.vms.find((v) => v.id === id)
  if (!vm) return c.json({ error: '虚拟机不存在', code: 'VM_NOT_FOUND' }, 404)
  const b = await c.req.json<{ target_host_id?: number; mode?: 'live' | 'cold' }>().catch(() => ({} as any))
  const dst = mockData.hosts.find((h) => h.id === Number(b.target_host_id))
  if (!dst) return c.json({ error: '请选择目标主机', code: 'NO_TARGET' }, 400)
  const srcHost = mockData.hosts.find((h) => h.id === vm.host_id)
  const sto = hostsShareStorage(vm.host_id, dst.id)
  const sc = migrationScope(vm, dst)
  const freeV = Math.max(0, dst.vcpus - Math.round(dst.vcpus * dst.cpu_usage / 100))
  const freeM = Math.max(0, dst.mem_total_gb - dst.mem_used_gb)
  const cpu = cpuCompat(srcHost, dst)       // N6 同指令集跨代 CPU 兼容
  const net = networkMatch(vm, dst)         // N6 网络一致性
  const checks = [
    { key: 'cpu', pass: freeV >= vm.vcpus, detail: `需 ${vm.vcpus} vCPU / 目标空闲 ${freeV} vCPU` },
    { key: 'mem', pass: freeM >= vm.mem_gb, detail: `需 ${vm.mem_gb} GB / 目标空闲 ${freeM} GB` },
    { key: 'host', pass: dst.status === 'connected' && !dst.maintenance_mode, detail: dst.status === 'connected' && !dst.maintenance_mode ? '目标主机在线可用' : '目标主机离线或维护中' },
    { key: 'cpu_compat', pass: cpu.compatible, detail: cpu.detail, cpu_mode: cpu.mode, baseline: cpu.baseline },
    { key: 'network', pass: net.ok, detail: net.detail, missing: net.missing },
    { key: 'storage', pass: true, detail: sto.shared ? `共享存储 ${sto.pool}，无需迁移磁盘` : '非共享存储，需同步迁移虚拟磁盘（存储迁移）' },
    { key: 'gpu', pass: !(vm.gpus > 0), detail: vm.gpus > 0 ? 'VM 绑定 GPU 直通，热迁移受限，建议冷迁移' : '无 GPU 直通约束' },
  ]
  // ---- 迁移模式判定（N6 核心）----
  //  强制冷迁移条件：① VM 停机 ② GPU 直通 ③ CPU 跨厂商不兼容 ④ 网络不一致（热迁后断网）
  let coldReason: string | null = null
  if (vm.status !== 'running') coldReason = 'VM 当前停机，只能执行冷迁移'
  else if (vm.gpus > 0) coldReason = 'VM 绑定 GPU 直通设备，VF/PCI 直通不支持热迁移，需冷迁移'
  else if (!cpu.live_ok) coldReason = cpu.detail
  else if (!net.ok) coldReason = `目标主机网络不一致（缺少端口组：${net.missing.join('、')}），热迁移后虚拟机网络不通，只能冷迁移`
  const forceCold = coldReason !== null
  const requestedLive = b.mode ? b.mode === 'live' : vm.status === 'running'
  const mode = forceCold ? 'cold' : (requestedLive ? 'live' : 'cold')
  // 硬阻断：资源不足 / 目标不可用 / CPU 完全不兼容（连冷迁移也需注意，但允许冷迁移）
  const blockers = checks.filter((ck) => !ck.pass && (ck.key === 'cpu' || ck.key === 'mem' || ck.key === 'host'))
  return c.json({
    vm_id: id, vm_name: vm.name,
    source_host: srcHost?.name, target_host: dst.name,
    source_cpu: srcHost?.cpu_model, target_cpu: dst.cpu_model,
    cpu_mode: cpu.mode, cpu_baseline: cpu.baseline,
    network_consistent: net.ok, network_missing: net.missing,
    scope: sc.scope, scope_label: sc.label, network_path: sc.path,
    shared_storage: sto.shared, storage_pool: sto.pool || null,
    storage_migration: !sto.shared,
    mode, mode_forced_cold: forceCold, cold_reason: coldReason,
    checks,
    can_migrate: blockers.length === 0,
    blockers: blockers.map((x) => x.detail),
    est_seconds: sto.shared ? (mode === 'live' ? 30 + vm.mem_gb : 15) : 120 + vm.mem_gb * 2,
  })
})

// ---- 执行 VM 迁移（企业级：支持跨集群/跨 DC + 冷/热 + 存储迁移；资源不足拒绝）----
app.post(`${API}/vms/:id/migrate`, async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{ target_host_id?: number; mode?: 'live' | 'cold' }>()
  const vm = mockData.vms.find((v) => v.id === id)
  if (!vm) return c.json({ error: '虚拟机不存在', code: 'VM_NOT_FOUND' }, 404)
  const target = mockData.hosts.find((h) => h.id === Number(b.target_host_id))
  if (!target) return c.json({ error: '目标主机不存在', code: 'HOST_NOT_FOUND' }, 404)
  if (target.status !== 'connected' || target.maintenance_mode)
    return c.json({ error: '目标主机不可用（离线或维护中）', code: 'HOST_UNAVAILABLE' }, 409)
  // 资源校验
  const freeV = Math.max(0, target.vcpus - Math.round(target.vcpus * target.cpu_usage / 100))
  const freeM = Math.max(0, target.mem_total_gb - target.mem_used_gb)
  if (freeV < vm.vcpus) return c.json({ error: `目标主机 vCPU 不足（需 ${vm.vcpus}，空闲 ${freeV}）`, code: 'INSUFFICIENT_CPU' }, 409)
  if (freeM < vm.mem_gb) return c.json({ error: `目标主机内存不足（需 ${vm.mem_gb}GB，空闲 ${freeM}GB）`, code: 'INSUFFICIENT_MEM' }, 409)
  const srcHost = mockData.hosts.find((h) => h.id === vm.host_id)
  const sto = hostsShareStorage(vm.host_id, target.id)
  const sc = migrationScope(vm, target)
  const cpu = cpuCompat(srcHost, target)   // N6 同指令集跨代 CPU
  const net = networkMatch(vm, target)     // N6 网络一致性
  // N6 与迁移预演一致的强制冷迁移判定：① 停机 ② GPU 直通 ③ CPU 跨厂商 ④ 网络不一致
  let coldReason: string | null = null
  if (vm.status !== 'running') coldReason = 'VM 当前停机，只能执行冷迁移'
  else if (vm.gpus > 0) coldReason = 'VM 绑定 GPU 直通设备，VF/PCI 直通不支持热迁移，需冷迁移'
  else if (!cpu.live_ok) coldReason = cpu.detail
  else if (!net.ok) coldReason = `目标主机网络不一致（缺少端口组：${net.missing.join('、')}），只能冷迁移`
  const forceCold = coldReason !== null
  // 用户请求热迁移但条件不满足 → 直接拒绝并说明原因（避免静默降级造成误操作）
  if (b.mode === 'live' && forceCold)
    return c.json({ error: `无法热迁移：${coldReason}`, code: 'LIVE_NOT_ALLOWED', cold_reason: coldReason }, 409)
  const mode = forceCold ? 'cold' : (b.mode === 'cold' ? 'cold' : 'live')
  // 变更归属（同时更新 cluster/datacenter，支持跨集群/跨 DC）
  vm.host_id = target.id
  vm.cluster_id = target.cluster_id
  ;(vm as any).datacenter_id = target.datacenter_id
  return c.json({
    vm_id: id, vm_name: vm.name,
    source_host: srcHost?.name, target_host: target.name,
    scope: sc.scope, scope_label: sc.label,
    cpu_mode: cpu.mode, cpu_baseline: cpu.baseline,
    network_consistent: net.ok, network_missing: net.missing,
    mode, mode_forced_cold: forceCold, cold_reason: coldReason,
    shared_storage: sto.shared, storage_migration: !sto.shared,
    status: vm.status === 'stopped' ? 'stopped' : 'running',
    task_uuid: genUUID(),
    message: `${vm.name} 已${mode === 'live' ? '热' : '冷'}迁移到 ${target.name}（${sc.label}${sto.shared ? '·共享存储' : '·存储迁移'}${forceCold && vm.status === 'running' ? '·已降级为冷迁移' : ''}）`,
  })
})

// ---- P8 模板管理：新建模板（从停机 VM 转换 / 新建空白）+ 从模板部署（支持批量）----
app.post(`${API}/vm-templates`, async (c) => {
  const b = await c.req.json<{
    source?: 'convert' | 'blank'; source_vm_id?: number; name?: string;
    os?: string; os_type?: string; vcpus?: number; mem_gb?: number; disk_gb?: number; tags?: string[]
  }>()
  if (!b.name || !b.name.trim()) return c.json({ error: '模板名称必填', code: 'NAME_REQUIRED' }, 400)
  if (mockData.vm_templates.some((t) => t.name === b.name!.trim()))
    return c.json({ error: '模板名称已存在', code: 'NAME_DUPLICATE' }, 409)
  let base = { os: b.os || 'Rocky Linux 9', os_type: b.os_type || 'linux', vcpus: b.vcpus || 4, mem_gb: b.mem_gb || 8, disk_gb: b.disk_gb || 40 }
  // 从停机 VM 转换：继承其规格
  if (b.source === 'convert' && b.source_vm_id) {
    const vm = mockData.vms.find((v) => v.id === Number(b.source_vm_id))
    if (!vm) return c.json({ error: '源虚拟机不存在', code: 'VM_NOT_FOUND' }, 404)
    if (vm.status !== 'stopped') return c.json({ error: '只能转换已停机的虚拟机', code: 'VM_NOT_STOPPED' }, 409)
    base = { os: vm.os, os_type: /win/i.test(vm.os) ? 'windows' : 'linux', vcpus: vm.vcpus, mem_gb: vm.mem_gb, disk_gb: b.disk_gb || 40 }
  }
  const id = Math.max(0, ...mockData.vm_templates.map((t) => t.id)) + 1
  const tpl = {
    id, name: b.name.trim(), ...base,
    description: (b.tags && b.tags.length ? b.tags.join(' + ') : (b.source === 'convert' ? '由虚拟机转换' : '空白模板')),
    usage_count: 0, pool: 'prod-nfs-pool', tags: b.tags || [],
    updated_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
  }
  mockData.vm_templates.unshift(tpl)
  return c.json({ ...tpl, message: `（原型）模板「${tpl.name}」已创建` }, 201)
})

// 从模板部署虚拟机（count>1 批量按 prefix+序号命名）
app.post(`${API}/vm-templates/:id/deploy`, async (c) => {
  const id = Number(c.req.param('id'))
  const tpl = mockData.vm_templates.find((t) => t.id === id)
  if (!tpl) return c.json({ error: '模板不存在', code: 'TEMPLATE_NOT_FOUND' }, 404)
  const b = await c.req.json<{ count?: number; name_prefix?: string; host_id?: number }>()
  const count = Math.max(1, Math.min(50, Number(b.count) || 1))
  const prefix = (b.name_prefix || tpl.name + '-').trim()
  const names = count === 1 ? [prefix.replace(/-$/, '')] : Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`)
  tpl.usage_count += count
  return c.json({
    template_id: id, template_name: tpl.name, count, names, host_id: b.host_id || null,
    status: 'deploying', message: `（原型）已提交部署 ${count} 台虚拟机（基于模板「${tpl.name}」）`,
  }, 201)
})

// ---- P9 ISO 管理：上传 ISO（本地文件 / URL 远程下载 + MD5 校验）----
app.post(`${API}/iso-images`, async (c) => {
  const b = await c.req.json<{ source?: 'local' | 'url'; name?: string; url?: string; os_type?: string; pool?: string; size_gb?: number; md5?: string }>()
  let name = (b.name || '').trim()
  if (b.source === 'url') {
    if (!b.url || !/^(https?|ftp):\/\/.+\.iso$/i.test(b.url.trim()))
      return c.json({ error: 'URL 无效，需以 http(s)/ftp 开头并指向 .iso 文件', code: 'URL_INVALID' }, 400)
    if (!name) name = b.url.trim().split('/').pop() || 'remote.iso'
  }
  if (!name) return c.json({ error: 'ISO 名称必填', code: 'NAME_REQUIRED' }, 400)
  if (!/\.iso$/i.test(name)) name += '.iso'
  const id = Math.max(0, ...mockData.iso_images.map((i) => i.id)) + 1
  const iso = {
    id, name, os_type: b.os_type || 'Linux', size_gb: b.size_gb || 0,
    pool: b.pool || 'prod-nfs-pool', uploaded_at: new Date().toISOString().slice(0, 10),
    checksum_ok: b.md5 ? true : true, md5: b.md5 || '', source: b.source || 'local',
  }
  mockData.iso_images.unshift(iso)
  return c.json({ ...enrichIso(iso), message: `（原型）ISO「${iso.name}」已${b.source === 'url' ? '下载' : '上传'}完成` }, 201)
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
    task_uuid: genUUID(),
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

// ---- P12 备份任务：新建（对象/模式/位置/调度/保留 完整生命周期）----
app.post(`${API}/backup-jobs`, async (c) => {
  const b = await c.req.json<{
    name?: string; scope?: 'vm' | 'vms' | 'cluster'; target_vm_ids?: number[]; cluster_id?: number;
    mode?: 'full' | 'incremental' | 'differential';
    location?: 'local' | 'nfs' | 's3'; location_target?: string;
    schedule_type?: 'manual' | 'cron'; cron?: string;
    retention_type?: 'count' | 'days'; retention_value?: number
  }>()
  if (!b.name || !b.name.trim()) return c.json({ error: '任务名必填', code: 'NAME_REQUIRED' }, 400)
  if (b.schedule_type === 'cron' && (!b.cron || !b.cron.trim()))
    return c.json({ error: '定时调度需填写 Cron 表达式', code: 'CRON_REQUIRED' }, 400)
  // 备份对象描述
  let target = '—'
  if (b.scope === 'vm' && b.target_vm_ids?.[0]) {
    target = mockData.vms.find((v) => v.id === b.target_vm_ids![0])?.name || '—'
  } else if (b.scope === 'vms' && b.target_vm_ids?.length) {
    target = `${b.target_vm_ids.length} 台虚拟机`
  } else if (b.scope === 'cluster' && b.cluster_id) {
    target = mockData.clusters.find((cl) => cl.id === b.cluster_id)?.name || '整个集群'
  }
  const schedule = b.schedule_type === 'cron' ? `Cron ${b.cron}` : '手动'
  const retention = b.retention_type === 'days' ? `保留 ${b.retention_value || 7} 天` : `保留 ${b.retention_value || 7} 份`
  const id = Math.max(0, ...mockData.backup_jobs.map((j) => j.id)) + 1
  const job = {
    id, name: b.name.trim(), target_vm: target, scope: b.scope || 'vm',
    schedule, mode: b.mode || 'full', retention,
    location: b.location || 'local', location_target: b.location_target || '',
    last_run: '—', last_status: 'pending', last_size_gb: 0,
  }
  mockData.backup_jobs.unshift(job)
  return c.json({ ...job, message: `（原型）备份任务「${job.name}」已创建` }, 201)
})

// ---- 会话注销（fn9 对接：清理服务端会话/刷新令牌）----
app.post(`${API}/auth/logout`, (c) => c.json({ ok: true, message: '会话已注销' }))

// ---- 集群 HA 总览（聚合所有主机的 HA 判定）----
app.get(`${API}/ha/cluster-status`, (c) => c.json(getClusterHAStatus()))
// ---- 启用集群 HA ----
app.post(`${API}/ha/enable`, async (c) => {
  const b = await c.req.json<{ cluster_id: number; enabled?: boolean }>().catch(() => ({} as any))
  const cl = mockData.clusters.find((x) => x.id === Number(b.cluster_id))
  if (!cl) return c.json({ error: '集群不存在', code: 'NOT_FOUND' }, 404)
  cl.ha_enabled = b.enabled ?? true
  return c.json({ cluster_id: cl.id, ha_enabled: cl.ha_enabled, message: cl.ha_enabled ? `集群 ${cl.name} HA 已启用` : `集群 ${cl.name} HA 已停用` })
})
// ---- 测试 STONITH / Fencing 配置 ----
app.post(`${API}/ha/test-fencing`, async (c) => {
  const b = await c.req.json<{ host_id?: number }>().catch(() => ({} as any))
  const host = mockData.hosts.find((h) => h.id === Number(b.host_id))
  return c.json({ host_id: b.host_id, host_name: host?.name, ipmi_reachable: true, fence_agent: 'fence_ipmilan', test_result: 'pass', message: `（原型）对 ${host?.name || '主机'} 的 Fencing 测试通过：IPMI 可达，电源控制正常` })
})

// ============================================================================
//  模块 5 · 存储管理 storage：存储池 / 卷管理 / 快照树
//
//  ★ 存储归属模型（务必明确，避免歧义）：
//    存储池「挂载给集群(cluster)」，由该集群内的「所有宿主机」共享挂载使用，
//    而非挂给管理平台、也非挂给单台主机。
//      · 共享类型 (nfs/iscsi/fc/distributed)：平台自动在集群所有主机上挂载，
//        是「批量添加」——选一次集群 = 集群内全部主机自动配置。
//      · 本地类型 (local)：仅属于单台主机（须指定 host_id），不可跨主机共享。
//
//  完整存储添加逻辑（与真实虚拟化平台一致）：
//    存储池(选类型+连接参数+目标集群) ──► 卷/磁盘(在池上分配) ──► 挂载给虚拟机
//
//  磁盘迁移（storage migration）：
//    · 共享存储上的磁盘：随 VM 在线迁移到「同集群」其他主机，无需拷盘（仅切换计算节点）。
//    · 跨存储池迁移：需拷贝底层数据到目标池（storage vMotion）。
//    · 约束：目标池必须能被目标主机访问（共享池=同集群即可；本地池=必须同主机）。
//
//  删除约束：池上仍有卷 → 阻止；卷已挂载到运行中 VM → 阻止。
// ============================================================================

// 存储池支持的类型（前端创建向导据此渲染连接参数表单）
const STORAGE_POOL_TYPES = [
  { type: 'local', shared: false, fields: ['target_path'] },
  { type: 'nfs', shared: true, fields: ['nfs_server', 'nfs_export'] },
  { type: 'iscsi', shared: true, fields: ['iscsi_portal', 'iscsi_iqn'] },
  { type: 'fc', shared: true, fields: ['fc_wwpn'] },
  { type: 'distributed', shared: true, fields: ['dist_monitors', 'dist_pool'] },
]

// 存储池（带聚合统计 + 集群归属名 + 卷数量 + 挂载主机清单）
//   挂载主机语义：
//     · 共享池(shared=true)：自动挂载到「所属集群的全部主机」（批量），mounted_hosts=集群全部主机
//     · 本地池(shared=false)：仅挂载到单台主机（host_id），mounted_hosts=该主机
function computeStoragePools() {
  return mockData.storage_pools.map((p) => {
    const poolVols = mockData.volumes.filter((v) => v.pool === p.name)
    const cl = mockData.clusters.find((c2) => c2.id === p.cluster_id)
    let mountedHosts: { id: number; name: string; hostname: string; mount_status: string }[]
    if (p.shared) {
      mountedHosts = mockData.hosts
        .filter((h) => h.cluster_id === p.cluster_id)
        .map((h) => ({ id: h.id, name: h.name, hostname: h.hostname, mount_status: h.status === 'connected' ? 'mounted' : (h.status === 'maintenance' ? 'standby' : 'unreachable') }))
    } else {
      const h = mockData.hosts.find((x) => x.id === (p as any).host_id) || mockData.hosts.find((x) => x.cluster_id === p.cluster_id)
      mountedHosts = h ? [{ id: h.id, name: h.name, hostname: h.hostname, mount_status: h.status === 'connected' ? 'mounted' : 'unreachable' }] : []
    }
    return {
      ...p,
      cluster_name: cl?.name || '未分配',
      scope: p.shared ? 'cluster' : 'host', // cluster=集群级共享 / host=单机本地
      mounted_hosts: mountedHosts,
      mounted_host_count: mountedHosts.length,
      volume_count: poolVols.length,
      free_tb: +(p.capacity_tb - p.used_tb).toFixed(1),
      usage_pct: Math.round((p.used_tb / p.capacity_tb) * 100),
    }
  })
}

app.get(`${API}/storage-pool-types`, (c) => c.json(STORAGE_POOL_TYPES))
app.get(`${API}/storage-pools`, (c) => c.json(computeStoragePools()))
app.get(`${API}/volumes`, (c) => c.json(mockData.volumes))
app.get(`${API}/snapshots`, (c) => c.json(mockData.snapshots))

// ---- 创建存储池（必选类型 + 类型对应连接参数 + 集群归属；名称去重）----
app.post(`${API}/storage-pools`, async (c) => {
  const b = await c.req.json<any>()
  if (!b.name || !b.type) return c.json({ error: '名称与类型必填', code: 'INVALID' }, 400)
  if (mockData.storage_pools.find((p) => p.name === b.name))
    return c.json({ error: `存储池名称 ${b.name} 已存在`, code: 'NAME_DUPLICATE' }, 409)
  const typeDef = STORAGE_POOL_TYPES.find((t) => t.type === b.type)
  if (!typeDef) return c.json({ error: '不支持的存储类型', code: 'BAD_TYPE' }, 400)
  const pool = {
    id: Date.now(),
    cluster_id: Number(b.cluster_id) || 1,
    name: b.name,
    type: b.type,
    capacity_tb: Number(b.capacity_tb) || 10,
    used_tb: 0,
    shared: typeDef.shared,
    status: 'active',
    read_iops: 0, write_iops: 0, latency: 0,
    conn: b.conn || {},
  }
  mockData.storage_pools.push(pool as any)
  return c.json({ ...pool, message: `存储池 ${pool.name}（${pool.type.toUpperCase()}）已创建` })
})

// ---- 删除存储池（约束：池上仍有卷则阻止）----
app.delete(`${API}/storage-pools/:id`, (c) => {
  const id = Number(c.req.param('id'))
  const pool = mockData.storage_pools.find((p) => p.id === id)
  if (!pool) return c.json({ error: '存储池不存在', code: 'NOT_FOUND' }, 404)
  const vols = mockData.volumes.filter((v) => v.pool === pool.name)
  if (vols.length > 0)
    return c.json({ error: `存储池上仍有 ${vols.length} 个卷，请先删除卷`, code: 'HAS_VOLUMES', children: vols.map((v) => v.name) }, 409)
  mockData.storage_pools = mockData.storage_pools.filter((p) => p.id !== id)
  return c.json({ id, deleted: true, message: '存储池已删除' })
})

// ---- 创建卷（选池 + 格式 + 容量 + 总线；可选挂载 VM；名称去重）----
app.post(`${API}/volumes`, async (c) => {
  const b = await c.req.json<any>()
  if (!b.name || !b.pool) return c.json({ error: '名称与存储池必填', code: 'INVALID' }, 400)
  if (mockData.volumes.find((v) => v.name === b.name))
    return c.json({ error: `卷名称 ${b.name} 已存在`, code: 'NAME_DUPLICATE' }, 409)
  const pool = mockData.storage_pools.find((p) => p.name === b.pool)
  if (!pool) return c.json({ error: '目标存储池不存在', code: 'POOL_NOT_FOUND' }, 404)
  const vol = {
    id: Date.now(),
    name: b.name, pool: b.pool, vm: b.vm || '-',
    format: b.format || 'qcow2',
    size_gb: Number(b.size_gb) || 20,
    used_gb: 0,
    bus: b.bus || 'virtio-scsi',
    iops_limit: Number(b.iops_limit) || 0,
  }
  mockData.volumes.push(vol as any)
  return c.json({ ...vol, message: `卷 ${vol.name}（${vol.size_gb}GB / ${vol.format}）已在 ${vol.pool} 创建` })
})

// ---- 删除卷（约束：已挂载到运行中 VM 则阻止）----
app.delete(`${API}/volumes/:id`, (c) => {
  const id = Number(c.req.param('id'))
  const vol = mockData.volumes.find((v) => v.id === id)
  if (!vol) return c.json({ error: '卷不存在', code: 'NOT_FOUND' }, 404)
  const attachedVm = mockData.vms.find((v) => v.name === vol.vm && v.status === 'running')
  if (attachedVm)
    return c.json({ error: `卷已挂载到运行中的虚拟机 ${attachedVm.name}，请先卸载或关机`, code: 'ATTACHED_RUNNING', children: [attachedVm.name] }, 409)
  mockData.volumes = mockData.volumes.filter((v) => v.id !== id)
  return c.json({ id, deleted: true, message: '卷已删除' })
})

// ---- 创建快照 ----
app.post(`${API}/snapshots`, async (c) => {
  const b = await c.req.json<{ vm: string; name: string; description?: string; with_memory?: boolean; quiesce?: boolean }>()
  const vm = mockData.vms.find((v) => v.name === b.vm)
  // 同一 VM 的当前快照置为非当前
  mockData.snapshots.forEach((s) => { if (s.vm === b.vm) s.current = false })
  const snap = {
    id: Date.now(), vm_id: vm?.id || 0, vm: b.vm, name: b.name, description: b.description || '',
    with_memory: !!b.with_memory, quiesce: !!b.quiesce,
    size_gb: b.with_memory ? +(vm ? vm.mem_gb * 0.4 + 4 : 64).toFixed(1) : +(Math.random() * 8 + 2).toFixed(1),
    parent: mockData.snapshots.filter((s) => s.vm === b.vm).slice(-1)[0]?.name || null,
    created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
    current: true,
  }
  mockData.snapshots.push(snap as any)
  return c.json({ ...snap, message: '快照已创建' + (b.with_memory ? '（含内存+NVRAM）' : '（仅磁盘）') })
})

// ---- 回滚到快照（该快照置为当前）----
app.post(`${API}/snapshots/:id/revert`, (c) => {
  const id = Number(c.req.param('id'))
  const snap = mockData.snapshots.find((s) => s.id === id)
  if (!snap) return c.json({ error: '快照不存在', code: 'NOT_FOUND' }, 404)
  mockData.snapshots.forEach((s) => { if (s.vm === snap.vm) s.current = false })
  snap.current = true
  return c.json({ id, vm: snap.vm, name: snap.name, message: `已回滚 ${snap.vm} 到快照「${snap.name}」` })
})

// ---- 删除快照（约束：当前快照不可删）----
app.delete(`${API}/snapshots/:id`, (c) => {
  const id = Number(c.req.param('id'))
  const snap = mockData.snapshots.find((s) => s.id === id)
  if (!snap) return c.json({ error: '快照不存在', code: 'NOT_FOUND' }, 404)
  if (snap.current) return c.json({ error: '当前快照不可删除，请先回滚到其他快照', code: 'IS_CURRENT' }, 409)
  mockData.snapshots = mockData.snapshots.filter((s) => s.id !== id)
  return c.json({ id, deleted: true, message: '快照已删除' })
})

// ---- iSCSI 存储池（平台自动化配置：用户填参数，平台自动在所有主机执行）----
app.get(`${API}/storage/iscsi/pools`, (c) => c.json(mockData.iscsi_pools))
app.post(`${API}/storage/iscsi/pools`, async (c) => {
  const b = await c.req.json<any>()
  if (!b.name || !b.iscsi_config?.target_portal || !b.iscsi_config?.target_iqn)
    return c.json({ error: '存储池名称、Target Portal、IQN 必填', code: 'INVALID' }, 400)
  if (mockData.iscsi_pools.find((p) => p.name === b.name) || mockData.storage_pools.find((p) => p.name === b.name))
    return c.json({ error: `存储池名称 ${b.name} 已存在`, code: 'NAME_DUPLICATE' }, 409)
  const cl = mockData.clusters.find((x) => x.id === Number(b.cluster_id)) || mockData.clusters[0]
  const totalHosts = mockData.hosts.filter((h) => h.cluster_id === cl.id).length
  const pool = {
    id: Date.now(), name: b.name, type: 'iscsi', cluster_id: cl.id, cluster_name: cl.name, status: 'active',
    iscsi_config: { target_portal: b.iscsi_config.target_portal, target_iqn: b.iscsi_config.target_iqn, lun_id: Number(b.iscsi_config.lun_id) || 0, auth_method: b.iscsi_config.auth_method || 'none', chap_username: b.iscsi_config.chap_username },
    auto_config_status: { total_hosts: totalHosts, configured_hosts: totalHosts, failed_hosts: [], last_config_time: new Date().toISOString().slice(0, 16).replace('T', ' ') },
    capacity: { total_gb: Number(b.capacity_gb) || 10240, available_gb: Number(b.capacity_gb) || 10240, used_gb: 0 },
  }
  mockData.iscsi_pools.push(pool as any)
  // 同时登记到统一存储池列表，便于卷创建选择
  mockData.storage_pools.push({ id: pool.id, cluster_id: cl.id, name: pool.name, type: 'iscsi', capacity_tb: +(pool.capacity.total_gb / 1024).toFixed(1), used_tb: 0, shared: true, status: 'active', read_iops: 0, write_iops: 0, latency: 0 } as any)
  return c.json({ ...pool, message: `iSCSI 存储池 ${pool.name} 已创建，自动配置 ${totalHosts} 台主机` })
})
// iSCSI 自动配置进度（依据 start 计算渐进，逐台主机点亮）
app.get(`${API}/storage/iscsi/pools/:id/status`, (c) => {
  const id = Number(c.req.param('id'))
  const pool = mockData.iscsi_pools.find((p) => p.id === id)
  const total = pool?.auto_config_status.total_hosts || mockData.hosts.filter((h) => h.cluster_id === (pool?.cluster_id || 1)).length
  const start = Number(c.req.query('start') || Date.now())
  const elapsed = (Date.now() - start) / 1000
  const perHost = 2.5
  const configured = Math.min(total, Math.floor(elapsed / perHost) + 1)
  const clHosts = mockData.hosts.filter((h) => h.cluster_id === (pool?.cluster_id || 1)).slice(0, total)
  const STAGES = ['installing', 'configuring', 'discovering', 'logging_in', 'creating_pool', 'done']
  const hostStatus = clHosts.map((h, i) => {
    let status = 'pending'
    if (i < configured - 1) status = 'done'
    else if (i === configured - 1) status = STAGES[Math.min(STAGES.length - 1, Math.floor((elapsed % perHost) / (perHost / STAGES.length)))]
    return { hostname: h.hostname, status, error: null }
  })
  return c.json({ pool_id: id, total_hosts: total, configured_hosts: configured >= total ? total : configured - 1, hosts: hostStatus, done: configured >= total })
})

// ---- 独立虚拟磁盘管理（创建 / 挂载 / 卸载 / 删除）----
app.get(`${API}/storage/volumes`, (c) => c.json(mockData.virtual_disks))
app.post(`${API}/storage/volumes`, async (c) => {
  const b = await c.req.json<any>()
  if (!b.name || !b.storage_pool_id || !b.size_gb) return c.json({ error: '磁盘名称、存储池、容量必填', code: 'INVALID' }, 400)
  if (mockData.virtual_disks.find((d) => d.name === b.name)) return c.json({ error: `磁盘名称 ${b.name} 已存在`, code: 'NAME_DUPLICATE' }, 409)
  const pool = mockData.storage_pools.find((p) => p.id === Number(b.storage_pool_id))
  if (!pool) return c.json({ error: '目标存储池不存在', code: 'POOL_NOT_FOUND' }, 404)
  const thin = b.provisioning === 'thin'
  const disk = {
    id: Date.now(), name: b.name, storage_pool_id: pool.id, storage_pool_name: pool.name,
    format: thin ? 'qcow2' : 'raw', provisioning: thin ? 'thin' : 'thick',
    size_gb: Number(b.size_gb), allocated_gb: thin ? 1 : Number(b.size_gb),
    shared_disk: !!b.shared_disk, encryption_enabled: !!b.encryption_enabled,
    status: 'available', attached_vms: [],
    created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
    last_modified: new Date().toISOString().slice(0, 16).replace('T', ' '),
  }
  mockData.virtual_disks.push(disk as any)
  return c.json({ ...disk, message: `磁盘 ${disk.name}（${disk.size_gb}GB / ${disk.provisioning === 'thin' ? '精简' : '厚'}置备）已创建` })
})
app.post(`${API}/storage/volumes/:id/attach`, async (c) => {
  const id = Number(c.req.param('id'))
  const disk = mockData.virtual_disks.find((d) => d.id === id)
  if (!disk) return c.json({ error: '磁盘不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<{ vm_id: number; bus_type?: string }>()
  const vm = mockData.vms.find((v) => v.id === Number(b.vm_id))
  if (!vm) return c.json({ error: '目标虚拟机不存在', code: 'VM_NOT_FOUND' }, 404)
  if (!disk.shared_disk && disk.attached_vms.length > 0)
    return c.json({ error: '非共享磁盘已被挂载，请先卸载或启用共享', code: 'ALREADY_ATTACHED' }, 409)
  if (disk.attached_vms.find((a) => a.vm_id === vm.id))
    return c.json({ error: '该磁盘已挂载到此虚拟机', code: 'ALREADY_ATTACHED' }, 409)
  disk.attached_vms.push({ vm_id: vm.id, vm_name: vm.name, bus_type: (b.bus_type as any) || 'virtio' } as any)
  disk.status = 'attached'
  return c.json({ ...disk, message: `磁盘 ${disk.name} 已挂载到 ${vm.name}` })
})
app.post(`${API}/storage/volumes/:id/detach`, async (c) => {
  const id = Number(c.req.param('id'))
  const disk = mockData.virtual_disks.find((d) => d.id === id)
  if (!disk) return c.json({ error: '磁盘不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<{ vm_id: number }>().catch(() => ({} as any))
  if (b.vm_id) disk.attached_vms = disk.attached_vms.filter((a) => a.vm_id !== Number(b.vm_id))
  else disk.attached_vms = []
  if (disk.attached_vms.length === 0) disk.status = 'available'
  return c.json({ ...disk, message: '磁盘已卸载' })
})
app.delete(`${API}/storage/volumes/:id`, (c) => {
  const id = Number(c.req.param('id'))
  const disk = mockData.virtual_disks.find((d) => d.id === id)
  if (!disk) return c.json({ error: '磁盘不存在', code: 'NOT_FOUND' }, 404)
  if (disk.attached_vms.length > 0)
    return c.json({ error: `磁盘已挂载到 ${disk.attached_vms.length} 台虚拟机，请先卸载`, code: 'ATTACHED', children: disk.attached_vms.map((a) => a.vm_name) }, 409)
  mockData.virtual_disks = mockData.virtual_disks.filter((d) => d.id !== id)
  return c.json({ id, deleted: true, message: '磁盘已删除' })
})
// ---- 扩容磁盘（只增不减）----
app.post(`${API}/storage/volumes/:id/expand`, async (c) => {
  const id = Number(c.req.param('id'))
  const disk = mockData.virtual_disks.find((d) => d.id === id)
  if (!disk) return c.json({ error: '磁盘不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<{ new_size_gb: number }>()
  const ns = Number(b.new_size_gb)
  if (!ns || ns <= disk.size_gb) return c.json({ error: `新容量须大于当前 ${disk.size_gb}GB`, code: 'INVALID_SIZE' }, 400)
  disk.size_gb = ns
  if (disk.provisioning === 'thick') disk.allocated_gb = ns
  disk.last_modified = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return c.json({ ...disk, message: `磁盘 ${disk.name} 已扩容至 ${ns}GB` })
})

// ---- 磁盘迁移（storage migration / storage vMotion）----
//   候选目标池：由「目标主机所在集群」可访问的存储池决定
//     · 共享池：目标主机所在集群的所有共享池都可访问
//     · 本地池：仅当目标主机即该本地池所属主机时可访问
//   迁移类型：
//     · same_pool   同池（仅切换计算节点，共享盘随 VM 走，无需拷数据）
//     · cross_pool  跨池（storage vMotion，需拷贝底层数据）
app.get(`${API}/storage/volumes/:id/migration-targets`, (c) => {
  const id = Number(c.req.param('id'))
  const disk = mockData.virtual_disks.find((d) => d.id === id)
  if (!disk) return c.json({ error: '磁盘不存在', code: 'NOT_FOUND' }, 404)
  // 列出所有主机，并标注可访问的池
  const hosts = mockData.hosts.map((h) => {
    const cl = mockData.clusters.find((x) => x.id === h.cluster_id)
    const accessiblePools = computeStoragePools().filter((p) => {
      if (p.shared) return p.cluster_id === h.cluster_id
      return (p as any).host_id === h.id
    }).map((p) => ({ id: p.id, name: p.name, type: p.type, shared: p.shared, free_tb: p.free_tb }))
    return { id: h.id, name: h.name, hostname: h.hostname, cluster_id: h.cluster_id, cluster_name: cl?.name || '-', status: h.status, accessible_pools: accessiblePools }
  })
  return c.json({ disk_id: id, disk_name: disk.name, current_pool_id: disk.storage_pool_id, current_pool_name: disk.storage_pool_name, hosts })
})
app.post(`${API}/storage/volumes/:id/migrate`, async (c) => {
  const id = Number(c.req.param('id'))
  const disk = mockData.virtual_disks.find((d) => d.id === id)
  if (!disk) return c.json({ error: '磁盘不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<{ target_host_id: number; target_pool_id: number }>()
  const targetHost = mockData.hosts.find((h) => h.id === Number(b.target_host_id))
  const targetPool = mockData.storage_pools.find((p) => p.id === Number(b.target_pool_id))
  if (!targetHost) return c.json({ error: '目标主机不存在', code: 'HOST_NOT_FOUND' }, 404)
  if (!targetPool) return c.json({ error: '目标存储池不存在', code: 'POOL_NOT_FOUND' }, 404)
  // 约束：目标池必须能被目标主机访问
  const accessible = targetPool.shared
    ? targetPool.cluster_id === targetHost.cluster_id
    : (targetPool as any).host_id === targetHost.id
  if (!accessible)
    return c.json({ error: `目标主机 ${targetHost.name} 无法访问存储池 ${targetPool.name}（共享池须同集群 / 本地池须同主机）`, code: 'POOL_UNREACHABLE' }, 409)
  const crossPool = targetPool.id !== disk.storage_pool_id
  // 迁移磁盘归属池
  disk.storage_pool_id = targetPool.id
  disk.storage_pool_name = targetPool.name
  disk.last_modified = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return c.json({
    ...disk,
    migration_type: crossPool ? 'cross_pool' : 'same_pool',
    target_host: targetHost.name,
    target_pool: targetPool.name,
    message: crossPool
      ? `磁盘 ${disk.name} 已通过 Storage vMotion 迁移到 ${targetPool.name}（${targetHost.name}），底层数据已拷贝`
      : `磁盘 ${disk.name} 已迁移计算节点到 ${targetHost.name}（共享存储无需拷盘）`,
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
// ---- 创建 VLAN（VLAN ID 1~4094 去重 + 必填校验）----
app.post(`${API}/vlans`, async (c) => {
  const b = await c.req.json<any>()
  const vid = Number(b.vlan_id)
  if (!vid || vid < 1 || vid > 4094) return c.json({ error: 'VLAN ID 须为 1~4094', code: 'INVALID' }, 400)
  if (!b.name) return c.json({ error: 'VLAN 名称必填', code: 'INVALID' }, 400)
  if (mockData.vlans.find((v) => v.vlan_id === vid))
    return c.json({ error: `VLAN ID ${vid} 已存在`, code: 'VLAN_DUPLICATE' }, 409)
  const vlan = {
    id: Date.now(), vswitch: b.vswitch || (mockData.vswitches[0]?.name || ''),
    vlan_id: vid, name: b.name, subnet: b.subnet || '—', gateway: b.gateway || '—',
    dhcp: !!b.dhcp, vms: 0,
  }
  mockData.vlans.push(vlan as any)
  // 同步把 VLAN ID 登记到所属虚拟交换机
  const sw = mockData.vswitches.find((s) => s.name === vlan.vswitch)
  if (sw && !sw.vlans.includes(vid)) sw.vlans.push(vid)
  return c.json({ ...vlan, message: `VLAN ${vid}（${vlan.name}）已创建` })
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

// ---- 监控总览：集群级关键指标聚合（KPI 卡 + 健康度）----
app.get(`${API}/monitoring/overview`, (c) => {
  const hosts = mockData.hosts
  const onlineHosts = hosts.filter((h) => h.status === 'connected')
  const vms = mockData.vms
  const totalVcpus = hosts.reduce((s, h) => s + h.vcpus, 0)
  const usedVcpus = vms.filter((v) => v.status === 'running').reduce((s, v) => s + v.vcpus, 0)
  const totalMemGb = hosts.reduce((s, h) => s + h.mem_total_gb, 0)
  const usedMemGb = hosts.reduce((s, h) => s + h.mem_used_gb, 0)
  const totalCapTb = mockData.storage_pools.reduce((s, p) => s + p.capacity_tb, 0)
  const usedCapTb = mockData.storage_pools.reduce((s, p) => s + p.used_tb, 0)
  const avgCpu = onlineHosts.length ? Math.round(onlineHosts.reduce((s, h) => s + h.cpu_usage, 0) / onlineHosts.length) : 0
  const activeAlerts = mockData.alert_rules.filter((r) => r.enabled && r.triggered > 0).reduce((s, r) => s + r.triggered, 0)
  return c.json({
    kpis: {
      hosts_online: onlineHosts.length, hosts_total: hosts.length,
      vms_running: vms.filter((v) => v.status === 'running').length, vms_total: vms.length,
      cpu_usage_pct: avgCpu,
      mem_usage_pct: Math.round((usedMemGb / totalMemGb) * 100),
      vcpu_overcommit: +(usedVcpus / totalVcpus).toFixed(2),
      storage_usage_pct: Math.round((usedCapTb / totalCapTb) * 100),
      storage_used_tb: +usedCapTb.toFixed(1), storage_total_tb: +totalCapTb.toFixed(1),
      active_alerts: activeAlerts,
      gpus_total: mockData.gpus.length,
      gpus_busy: mockData.gpus.filter((g) => g.status === 'assigned').length,
    },
    // 健康度评分（综合 CPU/内存/存储/告警）
    health: (() => {
      let score = 100
      if (avgCpu > 80) score -= 15; else if (avgCpu > 65) score -= 6
      const memPct = Math.round((usedMemGb / totalMemGb) * 100)
      if (memPct > 85) score -= 15; else if (memPct > 70) score -= 6
      score -= activeAlerts * 5
      score = Math.max(40, score)
      return { score, level: score >= 85 ? 'healthy' : score >= 65 ? 'warning' : 'critical' }
    })(),
  })
})

// ---- 历史性能时序（最近 N 个采样点，用于折线图）----
app.get(`${API}/monitoring/history`, (c) => {
  const points = Number(c.req.query('points')) || 24
  const now = Date.now()
  const seed = (base: number, amp: number, i: number, phase = 0) =>
    Math.max(0, Math.min(100, +(base + amp * Math.sin((i / 4) + phase) + (Math.random() - 0.5) * 6).toFixed(1)))
  const series = Array.from({ length: points }, (_, i) => {
    const idx = points - 1 - i
    return {
      t: new Date(now - idx * 3600_000).toISOString().slice(11, 16),
      cpu: seed(58, 14, i, 0),
      mem: seed(64, 8, i, 1),
      net_in: +(Math.max(0, 420 + 180 * Math.sin(i / 3) + (Math.random() - 0.5) * 120)).toFixed(0),
      net_out: +(Math.max(0, 310 + 140 * Math.sin(i / 3 + 1) + (Math.random() - 0.5) * 100)).toFixed(0),
      iops: +(Math.max(0, 38000 + 12000 * Math.sin(i / 5) + (Math.random() - 0.5) * 8000)).toFixed(0),
    }
  })
  return c.json({ points, series })
})

// ---- 告警规则 CRUD ----
app.get(`${API}/alert-rules`, (c) => c.json(mockData.alert_rules))
app.post(`${API}/alert-rules`, async (c) => {
  const b = await c.req.json<any>()
  if (!b.name || !b.metric) return c.json({ error: '名称与指标必填', code: 'INVALID' }, 400)
  const rule = {
    id: Date.now(), name: b.name, metric: b.metric,
    condition: b.condition || '> 80%', severity: b.severity || 'warning',
    triggered: 0, channel: b.channel || '邮件', enabled: b.enabled !== false,
  }
  mockData.alert_rules.push(rule as any)
  return c.json({ ...rule, message: `告警规则「${rule.name}」已创建` })
})
app.put(`${API}/alert-rules/:id`, async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json<any>()
  const rule = mockData.alert_rules.find((r) => r.id === id)
  if (!rule) return c.json({ error: '规则不存在', code: 'NOT_FOUND' }, 404)
  Object.assign(rule, b)
  return c.json({ ...rule, message: '告警规则已更新' })
})
app.delete(`${API}/alert-rules/:id`, (c) => {
  const id = Number(c.req.param('id'))
  mockData.alert_rules = mockData.alert_rules.filter((r) => r.id !== id)
  return c.json({ id, deleted: true, message: '告警规则已删除' })
})

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
app.get(`${API}/user-roles`, (c) => c.json(mockData.user_roles))

// ---- 创建用户（用户名去重 + 必填校验 + 资源配额）----
app.post(`${API}/users`, async (c) => {
  const b = await c.req.json<any>()
  if (!b.username || !b.display_name || !b.email) return c.json({ error: '用户名、显示名、邮箱必填', code: 'INVALID' }, 400)
  if (!/^[A-Za-z0-9_]+$/.test(b.username)) return c.json({ error: '用户名只能包含英文字母、数字和下划线', code: 'BAD_USERNAME' }, 400)
  if (mockData.users.find((u) => u.username === b.username)) return c.json({ error: `用户名 ${b.username} 已存在`, code: 'NAME_DUPLICATE' }, 409)
  const role = mockData.user_roles.find((r) => r.id === Number(b.role_id)) || mockData.user_roles[3]
  const user = {
    id: Date.now(), username: b.username, display_name: b.display_name, email: b.email, phone: b.phone || '',
    role_id: role.id, role_name: role.name, role_keys: [role.key], source: 'local',
    status: 'active', is_active: true,
    last_login_at: '—', last_login: '—', created_at: new Date().toISOString().slice(0, 10),
    resource_quota: {
      max_vms: Number(b.resource_quota?.max_vms) || 0, max_vcpus: Number(b.resource_quota?.max_vcpus) || 0,
      max_memory_gb: Number(b.resource_quota?.max_memory_gb) || 0, max_storage_gb: Number(b.resource_quota?.max_storage_gb) || 0,
    },
    resource_usage: { current_vms: 0, current_vcpus: 0, current_memory_gb: 0, current_storage_gb: 0 },
  }
  mockData.users.push(user as any)
  return c.json({ ...user, message: `用户 ${user.display_name} 已创建` })
})

// ---- 编辑用户（基本信息 / 角色 / 配额；密码可选）----
app.patch(`${API}/users/:id`, async (c) => {
  const id = Number(c.req.param('id'))
  const u = mockData.users.find((x) => x.id === id)
  if (!u) return c.json({ error: '用户不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<any>()
  if (b.display_name) u.display_name = b.display_name
  if (b.email) u.email = b.email
  if (b.phone !== undefined) u.phone = b.phone
  if (b.role_id) { const role = mockData.user_roles.find((r) => r.id === Number(b.role_id)); if (role) { u.role_id = role.id; u.role_name = role.name; u.role_keys = [role.key] } }
  if (b.status) { u.status = b.status; u.is_active = b.status === 'active' }
  if (b.resource_quota) u.resource_quota = { ...u.resource_quota, ...Object.fromEntries(Object.entries(b.resource_quota).map(([k, v]) => [k, Number(v) || 0])) }
  return c.json({ ...u, message: '用户已更新' })
})

// ---- 删除用户（约束：有运行中 VM 则阻止）----
app.delete(`${API}/users/:id`, (c) => {
  const id = Number(c.req.param('id'))
  const u = mockData.users.find((x) => x.id === id)
  if (!u) return c.json({ error: '用户不存在', code: 'NOT_FOUND' }, 404)
  if (u.resource_usage && u.resource_usage.current_vms > 0)
    return c.json({ error: `该用户名下仍有 ${u.resource_usage.current_vms} 台运行中的虚拟机，请先转移或删除`, code: 'HAS_RUNNING_VM', children: [`${u.resource_usage.current_vms} 台虚拟机`] }, 409)
  mockData.users = mockData.users.filter((x) => x.id !== id)
  return c.json({ id, deleted: true, message: '用户已删除' })
})

// ---- 启用 / 禁用账号 ----
app.post(`${API}/users/:id/status`, async (c) => {
  const id = Number(c.req.param('id'))
  const u = mockData.users.find((x) => x.id === id)
  if (!u) return c.json({ error: '用户不存在', code: 'NOT_FOUND' }, 404)
  const b = await c.req.json<{ status?: string }>().catch(() => ({} as any))
  u.status = b.status || (u.status === 'active' ? 'disabled' : 'active')
  u.is_active = u.status === 'active'
  return c.json({ id, status: u.status, message: u.status === 'active' ? '账号已启用' : '账号已禁用' })
})

// ---- 重置密码 ----
app.post(`${API}/users/:id/reset-password`, (c) => {
  const id = Number(c.req.param('id'))
  const u = mockData.users.find((x) => x.id === id)
  if (!u) return c.json({ error: '用户不存在', code: 'NOT_FOUND' }, 404)
  return c.json({ id, message: `用户 ${u.display_name} 的密码已重置（原型：临时密码已发送至 ${u.email}）` })
})

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
// =============================================================================
//  登录页 /login —— 真实落地登录入口（独立页面，不依赖 Vue，自包含）。
//  提交 → POST {API_BASE}/auth/login → 存 JWT 到 localStorage → 跳回 /。
//  API_BASE 取 localStorage.cnf_real_api_base（默认 /api/v1，同源代理）。
// =============================================================================
app.get('/login', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 · Cloud Nexus Forging</title>
  <link rel="icon" href="/favicon.ico">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg,#0a1628 0%,#0f2847 45%,#13315c 100%); color: #1d1d1f; }
    .login-card { width: 380px; background: #fff; border-radius: 18px; padding: 40px 36px;
      box-shadow: 0 20px 60px rgba(0,0,0,.35); animation: rise .4s ease; }
    @keyframes rise { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform:none; } }
    .brand { display:flex; align-items:center; gap:12px; margin-bottom: 28px; }
    .brand-logo { width:44px; height:44px; border-radius:12px;
      background: linear-gradient(135deg,#0a84ff,#0066cc); display:flex; align-items:center;
      justify-content:center; color:#fff; font-size:22px; font-weight:700; }
    .brand-txt h1 { font-size:19px; font-weight:700; letter-spacing:.5px; }
    .brand-txt p { font-size:12px; color:#86868b; margin-top:2px; }
    label { display:block; font-size:13px; font-weight:600; color:#1d1d1f; margin:18px 0 7px; }
    input { width:100%; height:44px; border:1.5px solid #d2d2d7; border-radius:10px; padding:0 14px;
      font-size:15px; outline:none; transition:border-color .15s; }
    input:focus { border-color:#0a84ff; }
    .field-api { margin-top:6px; }
    .field-api input { height:38px; font-size:13px; color:#6e6e73; }
    .btn { width:100%; height:46px; margin-top:26px; border:none; border-radius:10px;
      background:#0a84ff; color:#fff; font-size:16px; font-weight:600; cursor:pointer;
      transition:background .15s,transform .05s; }
    .btn:hover { background:#0070e0; }
    .btn:active { transform:scale(.99); }
    .btn:disabled { background:#a9d4ff; cursor:not-allowed; }
    .msg { margin-top:16px; min-height:20px; font-size:13px; text-align:center; }
    .msg.err { color:#ff3b30; }
    .msg.ok { color:#34c759; }
    .hint { margin-top:18px; font-size:12px; color:#86868b; text-align:center; line-height:1.6; }
    .toggle-api { font-size:12px; color:#0a84ff; cursor:pointer; user-select:none; margin-top:14px; display:inline-block; }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="brand">
      <div class="brand-logo">C</div>
      <div class="brand-txt"><h1>Cloud Nexus Forging</h1><p>企业级分布式虚拟化管理平台 v1.0.1</p></div>
    </div>
    <form id="f">
      <label for="u">用户名</label>
      <input id="u" type="text" autocomplete="username" value="admin" autofocus>
      <label for="p">密码</label>
      <input id="p" type="password" autocomplete="current-password" value="admin123">
      <span class="toggle-api" id="toggleApi">⚙ 高级：后端地址</span>
      <div class="field-api" id="apiWrap" style="display:none">
        <input id="api" type="text" placeholder="/api/v1">
      </div>
      <button class="btn" id="btn" type="submit">登 录</button>
      <div class="msg" id="msg"></div>
    </form>
    <div class="hint">默认账号：admin / admin123<br>同源部署后端地址填 /api/v1</div>
  </div>
  <script>
    // 同源部署：后端经 :3000 的 /api/v1 反向代理透传，浏览器只需访问同源相对路径。
    // 关键修复：默认强制用同源 '/api/v1'，忽略 localStorage 里残留的旧绝对地址
    //（如旧公网 IP:8090），那是「登录失败：Failed to fetch」(跨域/不可达) 的根因。
    var DEFAULT_BASE = '/api/v1';
    // 仅当存储的是相对路径(以 / 开头)时才沿用；绝对 URL 一律回退到同源默认值。
    var stored = '';
    try { stored = localStorage.getItem('cnf_real_api_base') || ''; } catch (e) {}
    var apiBase = (stored && stored.charAt(0) === '/') ? stored : DEFAULT_BASE;
    document.getElementById('api').value = apiBase;
    document.getElementById('toggleApi').onclick = function(){
      var w = document.getElementById('apiWrap');
      w.style.display = w.style.display === 'none' ? 'block' : 'none';
    };
    document.getElementById('f').onsubmit = async function(e){
      e.preventDefault();
      var btn = document.getElementById('btn'), msg = document.getElementById('msg');
      var u = document.getElementById('u').value.trim();
      var p = document.getElementById('p').value;
      var base = (document.getElementById('api').value.trim() || DEFAULT_BASE).replace(/\\/$/,'');
      msg.className = 'msg'; msg.textContent = '';
      btn.disabled = true; btn.textContent = '登录中…';
      try {
        var res = await fetch(base + '/auth/login', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ username:u, password:p })
        });
        var data = await res.json().catch(function(){return {};});
        if (!res.ok || !data.token) {
          throw new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
        }
        // 持久化：登录态 + 真实后端模式 + 地址
        localStorage.setItem('cnf_token', data.token);
        if (data.user) localStorage.setItem('cnf_user', JSON.stringify(data.user));
        localStorage.setItem('cnf_backend_mode', 'real');
        localStorage.setItem('cnf_real_api_base', base);
        msg.className = 'msg ok'; msg.textContent = '登录成功，正在进入…';
        setTimeout(function(){ window.location.href = '/'; }, 400);
      } catch (err) {
        var hint = (String(err.message || err).indexOf('fetch') >= 0)
          ? '（无法连接后端，请确认「高级·后端地址」为 /api/v1）' : '';
        msg.className = 'msg err'; msg.textContent = '登录失败：' + (err.message || err) + hint;
        btn.disabled = false; btn.textContent = '登 录';
      }
    };
  </script>
</body>
</html>`)
})

app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloud Nexus Forging · 企业级分布式虚拟化管理平台</title>
  <link rel="icon" href="/favicon.ico">
  <link rel="stylesheet" href="/static/apple-hig.css?v=${ASSET_VER}">
  <link rel="stylesheet" href="/static/app.css?v=${ASSET_VER}">
  <!-- 本地化前端依赖（消除外网 CDN 依赖，避免受限网络白屏；生产可离线运行）-->
  <link href="/static/vendor/fontawesome.css" rel="stylesheet">
  <script src="/static/vendor/vue.global.prod.js"></script>
  <script src="/static/vendor/chart.umd.min.js"></script>
</head>
<body>
  <div id="app"></div>
  <!-- 国际化 + 主题（最先加载） -->
  <script src="/static/i18n.js?v=${ASSET_VER}"></script>
  <!-- 通用组件（component-context-menu.js 负责初始化全局 window.api / __CNF_VIEWS） -->
  <script src="/static/component-context-menu.js?v=${ASSET_VER}"></script>
  <script src="/static/component-vm-wizard.js?v=${ASSET_VER}"></script>
  <!-- 统一拓扑 Store（单一可信数据源，须在依赖它的组件/视图之前加载） -->
  <script src="/static/store-topology.js?v=${ASSET_VER}"></script>
  <!-- 拓扑相关组件：资源拓扑树 + 添加主机向导 -->
  <script src="/static/component-topology-tree.js?v=${ASSET_VER}"></script>
  <script src="/static/component-host-wizard.js?v=${ASSET_VER}"></script>
  <!-- 9 模块视图 -->
  <script src="/static/view-dashboard.js?v=${ASSET_VER}"></script>
  <script src="/static/view-infrastructure.js?v=${ASSET_VER}"></script>
  <script src="/static/view-hosts.js?v=${ASSET_VER}"></script>
  <script src="/static/view-compute.js?v=${ASSET_VER}"></script>
  <script src="/static/view-availability.js?v=${ASSET_VER}"></script>
  <script src="/static/view-storage.js?v=${ASSET_VER}"></script>
  <script src="/static/view-network.js?v=${ASSET_VER}"></script>
  <script src="/static/view-monitoring.js?v=${ASSET_VER}"></script>
  <script src="/static/view-access-control.js?v=${ASSET_VER}"></script>
  <script src="/static/view-system.js?v=${ASSET_VER}"></script>
  <!-- 应用根组件（最后加载） -->
  <script src="/static/app.js?v=${ASSET_VER}"></script>
</body>
</html>`)
})

export default app
