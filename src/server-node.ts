// =============================================================================
//  本地开发启动器（Node 运行时）
//  说明：当前沙箱 glibc 2.34 < workerd 要求的 2.35，无法运行 wrangler/miniflare。
//  本文件用 @hono/node-server 直接跑 Hono app，并 serve public/static 静态资源，
//  完全绕开 Cloudflare workerd，仅用于本地预览开发。
//  生产部署仍走 `npm run build` + Cloudflare Pages（不受本文件影响）。
// =============================================================================
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import demoApp from './index'

const PORT = Number(process.env.PORT) || 3000

// =============================================================================
//  外层 app：先挂「真实后端反向代理」（可选），再回落到 demo Mock app。
//
//  设置 CNF_PROXY_TARGET=http://127.0.0.1:8090 后，本 dev server 会把
//  /api/v1/* 透传到真实 Go 后端，实现「同源访问」——浏览器只需访问 :3000，
//  REAL 模式 API base 填 /api/v1 即可，无跨域、无第二次公网往返（更快更稳）。
//
//  关键：代理路由必须在 demoApp 之前注册并匹配，否则会被 demo 的 /api/v1
//  路由先命中（Hono 先注册先匹配）。故这里用独立的外层 Hono 实例。
//  未设置 CNF_PROXY_TARGET 时维持原 demo Mock 行为不变。
// =============================================================================
// 默认指向本地真实 Go 后端 :8090。
// 历史问题：未设置该环境变量时会回落到内置 demo Mock，导致前端全程拿到「演示假数据」
// （6 台假主机 / 各类残留垃圾数据），且新增/删除主机无法识别。改为默认代理真实后端，
// 彻底杜绝 mock 污染；如需强制走 demo，可显式设置 CNF_PROXY_TARGET=mock。
const RAW_PROXY = process.env.CNF_PROXY_TARGET || 'http://127.0.0.1:8090'
const PROXY_TARGET = RAW_PROXY === 'mock' ? '' : RAW_PROXY
const app = new Hono()

// 静态资源：/static/* -> public/static/*（放最前，优先于代理与 demo）
app.use('/static/*', serveStatic({ root: './public' }))

if (PROXY_TARGET) {
  const target = PROXY_TARGET.replace(/\/$/, '')
  app.all('/api/v1/*', async (c) => {
    const url = new URL(c.req.url)
    const upstream = target + url.pathname + url.search
    const headers = new Headers(c.req.raw.headers)
    headers.delete('host')
    headers.delete('accept-encoding') // 禁止上游压缩，避免流式 SSE 被缓冲
    const init: RequestInit = { method: c.req.method, headers }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      init.body = await c.req.raw.arrayBuffer()
    }
    // SSE / 流式接口（纳管部署、预检流）必须「边收边转」，不能 await arrayBuffer()
    // 把整条流读完——长连接会被 fetch 判定 terminated（即 UI 报「代理到真实后端失败: terminated」）。
    // 关闭 fetch 的超时（duplex 半双工流式透传），并直接把上游 body 作为可读流回传。
    ;(init as any).duplex = 'half'
    try {
      const resp = await fetch(upstream, init)
      const respHeaders = new Headers(resp.headers)
      respHeaders.delete('content-encoding')
      respHeaders.delete('content-length')
      const ctype = (resp.headers.get('content-type') || '').toLowerCase()
      const isStream =
        ctype.includes('text/event-stream') ||
        ctype.includes('application/x-ndjson') ||
        (resp.headers.get('transfer-encoding') || '').toLowerCase().includes('chunked')
      if (isStream && resp.body) {
        // 关键：SSE 透传需禁用缓冲并保留实时性。
        respHeaders.set('cache-control', 'no-cache, no-transform')
        respHeaders.set('x-accel-buffering', 'no')
        respHeaders.set('connection', 'keep-alive')
        return new Response(resp.body, { status: resp.status, headers: respHeaders })
      }
      // 普通接口：可直接读完返回。
      const body = await resp.arrayBuffer()
      return new Response(body, { status: resp.status, headers: respHeaders })
    } catch (err: any) {
      return c.json(
        { code: 'PROXY_ERROR', message: '代理到真实后端失败: ' + (err?.message || err), details: { upstream } },
        502,
      )
    }
  })
  console.log(`🔀 /api/v1/* 反向代理 -> ${target}（同源真实后端）`)
} else {
  console.log('ℹ️  CNF_PROXY_TARGET=mock，/api/v1 走内置 demo Mock（仅供前端独立演示）')
}

// 其余所有请求（含页面 HTML、未代理时的 demo /api/v1）回落到原 demo app。
app.all('*', (c) => demoApp.fetch(c.req.raw, (c as any).env))

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`✅ CNF dev server (node) running at http://0.0.0.0:${info.port}/`)
})
