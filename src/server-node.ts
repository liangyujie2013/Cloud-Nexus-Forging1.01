// =============================================================================
//  本地开发启动器（Node 运行时）
//  说明：当前沙箱 glibc 2.34 < workerd 要求的 2.35，无法运行 wrangler/miniflare。
//  本文件用 @hono/node-server 直接跑 Hono app，并 serve public/static 静态资源，
//  完全绕开 Cloudflare workerd，仅用于本地预览开发。
//  生产部署仍走 `npm run build` + Cloudflare Pages（不受本文件影响）。
// =============================================================================
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import app from './index'

const PORT = Number(process.env.PORT) || 3000

// 静态资源：/static/* -> public/static/*
app.use('/static/*', serveStatic({ root: './public' }))

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`✅ CNF dev server (node) running at http://0.0.0.0:${info.port}/`)
})
