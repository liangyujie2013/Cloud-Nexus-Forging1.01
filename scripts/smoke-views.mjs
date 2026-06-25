// Lightweight smoke test: load Vue (local vendor) + all view IIFEs into a stubbed
// browser-like global, mount the App into a fake #app, drive the dead-button handlers,
// and assert no runtime errors. Catches real JS bugs the flaky external proxy can't.
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

const ROOT = path.resolve('public/static')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// ---- minimal DOM/browser stubs ----
const noop = () => {}
const makeEl = () => {
  const el = {
    style: {}, classList: { add: noop, remove: noop, contains: () => false },
    children: [], attributes: {}, dataset: {},
    appendChild(c) { this.children.push(c); return c },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    addEventListener: noop, removeEventListener: noop, querySelector: () => null,
    querySelectorAll: () => [], insertBefore() {}, removeChild() {},
    focus: noop, blur: noop, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    set innerHTML(v) { this._html = v }, get innerHTML() { return this._html || '' },
    set textContent(v) { this._text = v }, get textContent() { return this._text || '' },
  }
  return el
}
const appEl = makeEl()
const documentStub = {
  createElement: makeEl, createElementNS: makeEl, createComment: makeEl, createTextNode: () => makeEl(),
  querySelector: (s) => (s === '#app' ? appEl : makeEl()),
  querySelectorAll: () => [], getElementById: (id) => (id === 'app' ? appEl : makeEl()),
  addEventListener: noop, removeEventListener: noop, documentElement: makeEl(), body: makeEl(),
  head: makeEl(), createEvent: () => ({ initEvent: noop }),
}

const calls = { fetched: [] }
const localStore = {}
const storage = {
  getItem: (k) => (k in localStore ? localStore[k] : null),
  setItem: (k, v) => { localStore[k] = String(v) }, removeItem: (k) => { delete localStore[k] }, clear: () => {},
}

const sandbox = {}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.self = sandbox
sandbox.document = documentStub
sandbox.navigator = { userAgent: 'node-smoke' }
sandbox.location = { href: 'http://localhost:3000/', pathname: '/', reload: noop, assign: noop }
sandbox.localStorage = storage
sandbox.sessionStorage = storage
sandbox.console = console
sandbox.setTimeout = setTimeout
sandbox.clearTimeout = clearTimeout
sandbox.setInterval = setInterval
sandbox.clearInterval = clearInterval
sandbox.requestAnimationFrame = (cb) => setTimeout(cb, 0)
sandbox.cancelAnimationFrame = noop
sandbox.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail } }
sandbox.Event = class { constructor(type) { this.type = type } }
sandbox.crypto = { randomUUID: () => 'uuid-smoke' }
sandbox.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop })
sandbox.dispatchEvent = noop
sandbox.addEventListener = noop
sandbox.removeEventListener = noop
sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' })
sandbox.API_BASE = '/api/v1'
// fetch stub: returns mock-ish data; record calls
sandbox.fetch = (url, opts) => {
  calls.fetched.push({ url, method: (opts && opts.method) || 'GET' })
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockResponse(url, opts)) })
}
function mockResponse(url) {
  if (url.includes('/notifications')) return []
  if (url.includes('/vms')) return [{ id: 8, name: 'test-vm-08', status: 'stopped', os: 'CentOS Stream 9', vcpus: 2, mem_gb: 4, sockets: 1, cores: 2, threads: 1, host_id: 2, cluster_id: 1, gpus: 0, ha: false, ip: '-', cpu_usage: 0, numa: -1, cpu_pinning: false }]
  if (url.includes('/vm-templates')) return [{ id: 1, name: 'tpl-rocky9-base', os: 'Rocky Linux 9', vcpus: 4, mem_gb: 8, disk_gb: 40, usage_count: 23, description: 'x', updated_at: '2026-06-10' }]
  if (url.includes('/iso-images')) return []
  if (url.includes('/hosts')) return [{ id: 1, name: 'node-prod-01', ip: '192.168.1.100', status: 'connected', cluster_id: 1 }]
  if (url.includes('/clusters')) return [{ id: 1, name: '生产集群 Prod-A' }]
  if (url.includes('/backup-jobs')) return []
  if (url.includes('/cluster-configs')) return []
  if (url.includes('/migrations')) return []
  return {}
}

const ctx = vm.createContext(sandbox)

// load order matters (same as index.tsx)
const files = [
  'theme.js', 'i18n.js', 'component-context-menu.js', 'component-vm-wizard.js',
  'store-topology.js', 'component-topology-tree.js', 'component-host-wizard.js',
  'view-dashboard.js', 'view-infrastructure.js', 'view-hosts.js', 'view-compute.js',
  'view-availability.js', 'view-storage.js', 'view-network.js', 'view-monitoring.js',
  'view-access-control.js', 'view-system.js',
]
// ensure registry exists
vm.runInContext('window.__CNF_VIEWS = window.__CNF_VIEWS || {};', ctx)

// Vue
vm.runInContext(read('vendor/vue.global.prod.js'), ctx, { filename: 'vue.global.prod.js' })
if (!sandbox.Vue) { console.error('FAIL: Vue did not load'); process.exit(1) }

let loadErr = null
for (const f of files) {
  try {
    const src = fs.existsSync(path.join(ROOT, f)) ? read(f) : null
    if (src == null) { console.warn('skip missing', f); continue }
    vm.runInContext(src, ctx, { filename: f })
  } catch (e) { loadErr = `load ${f}: ${e.message}`; break }
}
if (loadErr) { console.error('FAIL', loadErr); process.exit(1) }

const V = sandbox.window.__CNF_VIEWS
const required = ['ComputeView', 'AvailabilityView']
for (const r of required) if (!V[r]) { console.error('FAIL: missing view', r); process.exit(1) }

// Exercise ComputeView.setup() and its dead-button handlers
;(async () => {
  try {
    const t = sandbox.window.t
    // ---- ComputeView templates tab ----
    const cv = V.ComputeView.setup({ tab: 'templates', search: '' })
    if (typeof cv.openTplCreate !== 'function') throw new Error('openTplCreate not exposed')
    if (typeof cv.openDeploy !== 'function') throw new Error('openDeploy not exposed')
    if (typeof cv.openIsoUpload !== 'function') throw new Error('openIsoUpload not exposed')
    await cv.openTplCreate()
    if (!cv.tplDlg.open) throw new Error('openTplCreate did not open dialog')
    cv.openIsoUpload()
    if (!cv.isoDlg.open) throw new Error('openIsoUpload did not open dialog')
    await cv.openDeploy({ id: 1, name: 'tpl-rocky9-base', os: 'Rocky Linux 9', vcpus: 4, mem_gb: 8 })
    if (!cv.deployDlg.open) throw new Error('openDeploy did not open dialog')

    // ---- AvailabilityView backup tab ----
    const av = V.AvailabilityView.setup({ tab: 'backup' })
    if (typeof av.openBackupCreate !== 'function') throw new Error('openBackupCreate not exposed')
    await av.openBackupCreate()
    if (!av.bkDlg.open) throw new Error('openBackupCreate did not open dialog')

    console.log('PASS: views load + dead-button handlers open dialogs without runtime errors')
    console.log('  tplDlg.open =', cv.tplDlg.open, '| isoDlg.open =', cv.isoDlg.open, '| deployDlg.open =', cv.deployDlg.open, '| bkDlg.open =', av.bkDlg.open)
    process.exit(0)
  } catch (e) {
    console.error('FAIL: runtime error ->', e.message)
    console.error(e.stack)
    process.exit(1)
  }
})()
