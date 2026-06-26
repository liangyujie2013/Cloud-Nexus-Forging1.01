// =============================================================================
//  应用根组件 (app.js) — Cloud Nexus Forging (CNF) v1.0.1
//  布局：左侧 9 模块手风琴导航 + 顶部工具栏（面包屑 / 全局搜索 / 通知中心 / 用户菜单
//        / 语言切换 / 外观主题）+ 主内容区按 currentModule + currentTab 渲染模块视图。
//  模块视图统一通过 window.__CNF_VIEWS 注册，本文件最后加载。
// =============================================================================
(function () {
const { createApp, ref, computed, onMounted, onBeforeUnmount } = Vue
const V = window.__CNF_VIEWS
const t = window.t
const api = window.api

const App = {
  components: {
    DashboardView: V.DashboardView,
    InfrastructureView: V.InfrastructureView,
    HostsView: V.HostsView,
    ComputeView: V.ComputeView,
    AvailabilityView: V.AvailabilityView,
    StorageView: V.StorageView,
    NetworkView: V.NetworkView,
    MonitoringView: V.MonitoringView,
    AccessControlView: V.AccessControlView,
    SystemView: V.SystemView,
    VMWizard: V.VMWizard,
    HostWizard: V.HostWizard,
    TopologyTree: V.TopologyTree,
  },
  setup() {
    const locale = window.i18n
    const themeState = window.cnfTheme

    // ---- 9 模块导航定义（label/icon/children 用 i18n key，运行时翻译） ----
    const modules = computed(() => [
      { key: 'dashboard', icon: 'fa-gauge-high', label: 'nav_mod_dashboard', children: [
        { key: 'overview', label: 'nav_dash_overview' },
        { key: 'performance', label: 'nav_dash_performance' },
        { key: 'alerts', label: 'nav_dash_alerts' },
      ] },
      { key: 'infrastructure', icon: 'fa-sitemap', label: 'nav_mod_infrastructure', children: [
        { key: 'datacenter', label: 'nav_infra_datacenter' },
        { key: 'clusters', label: 'nav_infra_clusters' },
        { key: 'pools', label: 'nav_infra_pools' },
      ] },
      { key: 'hosts', icon: 'fa-server', label: 'nav_mod_hosts', children: [
        { key: 'list', label: 'nav_hosts_list' },
        { key: 'detail', label: 'nav_hosts_detail' },
      ] },
      { key: 'compute', icon: 'fa-desktop', label: 'nav_mod_compute', children: [
        { key: 'vms', label: 'nav_compute_vms' },
        { key: 'templates', label: 'nav_compute_templates' },
        { key: 'isos', label: 'nav_compute_isos' },
      ] },
      { key: 'availability', icon: 'fa-shield-halved', label: 'nav_mod_availability', children: [
        { key: 'ha', label: 'nav_avail_ha' },
        { key: 'migration', label: 'nav_avail_migration' },
        { key: 'backup', label: 'nav_avail_backup' },
      ] },
      { key: 'storage', icon: 'fa-database', label: 'nav_mod_storage', children: [
        { key: 'pools', label: 'nav_storage_pools' },
        { key: 'volumes', label: 'nav_storage_volumes' },
        { key: 'snapshots', label: 'nav_storage_snapshots' },
      ] },
      { key: 'network', icon: 'fa-network-wired', label: 'nav_mod_network', children: [
        { key: 'vswitch', label: 'nav_net_vswitch' },
        { key: 'vlan', label: 'nav_net_vlan' },
        { key: 'topology', label: 'nav_net_topology' },
      ] },
      { key: 'monitoring', icon: 'fa-chart-line', label: 'nav_mod_monitoring', children: [
        { key: 'overview', label: 'nav_mon_overview' },
        { key: 'realtime', label: 'nav_mon_realtime' },
        { key: 'rules', label: 'nav_mon_rules' },
      ] },
      { key: 'access', icon: 'fa-user-shield', label: 'nav_mod_access', children: [
        { key: 'users', label: 'nav_acc_users' },
        { key: 'roles', label: 'nav_acc_roles' },
        { key: 'audit', label: 'nav_acc_audit' },
      ] },
      { key: 'system', icon: 'fa-gear', label: 'nav_mod_system', children: [
        { key: 'config', label: 'nav_sys_config' },
        { key: 'license', label: 'nav_sys_license' },
        { key: 'about', label: 'nav_sys_about' },
      ] },
    ])

    // 模块 key → 视图组件名
    const componentMap = {
      dashboard: 'DashboardView', infrastructure: 'InfrastructureView', hosts: 'HostsView', compute: 'ComputeView',
      availability: 'AvailabilityView', storage: 'StorageView', network: 'NetworkView',
      monitoring: 'MonitoringView', access: 'AccessControlView', system: 'SystemView',
    }

    // ---- 路由状态 ----
    const currentModule = ref('dashboard')
    const currentTab = ref('overview')
    const expanded = ref('dashboard') // 手风琴：当前展开的模块（同时只展开一个）

    const currentComponent = computed(() => componentMap[currentModule.value])
    const findModule = (k) => modules.value.find((m) => m.key === k)

    // 切换到指定模块 + 子标签
    const go = (moduleKey, tabKey) => {
      currentModule.value = moduleKey
      expanded.value = moduleKey
      const mod = findModule(moduleKey)
      currentTab.value = tabKey || (mod && mod.children[0] ? mod.children[0].key : '')
    }
    // 点击模块标题：展开/收起，并跳到该模块第一个子标签
    const toggleModule = (moduleKey) => {
      if (expanded.value === moduleKey && currentModule.value === moduleKey) {
        expanded.value = ''
      } else {
        go(moduleKey)
      }
    }

    // ---- 面包屑 ----
    const breadcrumb = computed(() => {
      const mod = findModule(currentModule.value)
      if (!mod) return []
      const child = mod.children.find((c) => c.key === currentTab.value)
      return [t(mod.label), child ? t(child.label) : '']
    })

    // ---- 通知中心 ----
    const notifications = ref([])
    const notifOpen = ref(false)
    const unreadCount = computed(() => notifications.value.filter((n) => !n.read).length)
    const markAllRead = () => notifications.value.forEach((n) => (n.read = true))
    const notifIcon = (lvl) => ({ info: 'fa-circle-info', warning: 'fa-triangle-exclamation', error: 'fa-circle-xmark' }[lvl] || 'fa-circle-info')

    // ---- 用户菜单 ----
    const userOpen = ref(false)

    // ---- 后端模式（demo / real）：真实 MVP 闭环切换 ----
    const backendMode = ref((window.CNF_BACKEND && window.CNF_BACKEND.mode) || 'demo')
    const toggleBackend = async () => {
      const next = backendMode.value === 'real' ? 'demo' : 'real'
      if (next === 'real') {
        // 切到真实后端：先记下 real 模式，再跳转专业登录页 /login 完成认证。
        try {
          localStorage.setItem('cnf_backend_mode', 'real')
          // 默认同源 /api/v1；登录页可在「高级」里改地址
          if (!localStorage.getItem('cnf_real_api_base')) {
            localStorage.setItem('cnf_real_api_base', '/api/v1')
          }
        } catch (e) {}
        const loginUrl = window.CNF_LOGIN_URL || '/login'
        window.location.href = loginUrl
      } else {
        if (window.cnfToast) window.cnfToast('已切换回 Demo Mock 后端', 'info')
        window.cnfSetBackend('demo')
      }
    }

    // ---- P1/P22 退出登录 ----
    //  企业级登出：清除本地会话凭证（JWT Token / 用户信息）→ 关闭后端会话 → 跳转登录页。
    //  Token 键名与 fn9 前后端对接保持一致（window.api 注入 Authorization 时读取同一键）。
    const TOKEN_KEYS = ['cnf_token', 'cnf_refresh_token', 'cnf_user']
    const logout = async () => {
      userOpen.value = false
      try {
        // 通知后端注销当前会话（失败不阻塞前端登出）
        await api('/auth/logout', { method: 'POST' }).catch(() => {})
      } finally {
        // 清除所有本地会话凭证
        TOKEN_KEYS.forEach((k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k) } catch (e) {} })
        if (window.cnfToast) window.cnfToast(t('logout_success'), 'success')
        // 跳转登录页（原型环境下无独立 /login 路由时回到根，触发重新认证）
        setTimeout(() => {
          const loginUrl = window.CNF_LOGIN_URL || '/login'
          // 若部署了独立登录页则跳转，否则刷新当前页（清空内存态，回到登录态）
          window.location.href = loginUrl
        }, 350)
      }
    }

    // ---- 全局搜索（透传到计算资源 VM 列表） ----
    const searchText = ref('')
    const onSearch = () => {
      if (searchText.value.trim()) go('compute', 'vms')
    }

    // ---- 主题 / 语言切换 ----
    const setTheme = (name) => window.setTheme(name)
    const themeLabel = (name) => t('theme_' + name)
    const setLocale = (l) => window.setLocale(l)

    // ---- VM 创建向导（由计算资源视图通过自定义事件触发） ----
    const wizardOpen = ref(false)
    const onOpenWizard = () => (wizardOpen.value = true)

    // ---- 添加主机向导（由基础设施/拓扑树通过自定义事件触发，可携带预设集群）----
    const hostWizardOpen = ref(false)
    const hostWizardPreset = ref(0)
    const onOpenHostWizard = (e) => {
      hostWizardPreset.value = (e && e.detail && e.detail.presetClusterId) || 0
      hostWizardOpen.value = true
    }
    const onHostWizardDone = () => { hostWizardOpen.value = false }

    // ---- 跨视图导航（资源拓扑树点击节点 → 切换模块/子页 + 高亮目标）----
    const currentFocus = ref(null)
    const onNavigate = (e) => {
      const d = e && e.detail
      if (!d) return
      go(d.module, d.tab)
      // 携带聚焦信息（focusType/focusId），透传给目标视图实现高亮定位
      currentFocus.value = { focusType: d.focusType, focusId: d.focusId, _ts: Date.now() }
    }
    // 视图内部切换子标签（如主机列表↔主机详情），保留视图内部状态不重建组件
    const onGoto = (e) => {
      const d = e && e.detail
      if (!d) return
      currentModule.value = d.module
      expanded.value = d.module
      currentTab.value = d.tab
    }

    // real 模式下确保已登录：无 token 则跳转到独立登录页 /login（拿 JWT 后再回到 /）。
    //  注意：不再用 window.prompt（体验差、易误操作），统一走专业登录页。
    const ensureRealLogin = () => {
      if (!window.cnfIsReal || !window.cnfIsReal()) return true
      let tok = null
      try { tok = localStorage.getItem('cnf_token') } catch (e) {}
      if (tok) return true
      // 无 token：跳转登录页，停止后续数据加载（避免全量 401）。
      const loginUrl = window.CNF_LOGIN_URL || '/login'
      window.location.href = loginUrl
      return false
    }

    onMounted(async () => {
      // real 模式：先确保登录（拿到 JWT）再加载数据，避免全量 401；无 token 会跳 /login。
      const authed = ensureRealLogin()
      if (!authed) return
      // 通知中心：真实后端暂未实现 /notifications，失败则保持空列表（不报错、不阻塞）。
      const notif = await api('/notifications')
      notifications.value = Array.isArray(notif) ? notif : []
      // 预加载统一拓扑数据（数据中心/集群/主机/虚拟机的层级血缘）
      if (window.cnfTopology) window.cnfTopology.fetchAll()
      window.addEventListener('cnf:open-vm-wizard', onOpenWizard)
      window.addEventListener('cnf:open-host-wizard', onOpenHostWizard)
      window.addEventListener('cnf:navigate', onNavigate)
      window.addEventListener('cnf:goto', onGoto)
    })
    onBeforeUnmount(() => {
      window.removeEventListener('cnf:open-vm-wizard', onOpenWizard)
      window.removeEventListener('cnf:open-host-wizard', onOpenHostWizard)
      window.removeEventListener('cnf:navigate', onNavigate)
      window.removeEventListener('cnf:goto', onGoto)
    })

    return {
      locale, themeState, THEMES: window.THEMES,
      modules, currentModule, currentTab, expanded, currentComponent,
      go, toggleModule, breadcrumb,
      notifications, notifOpen, unreadCount, markAllRead, notifIcon,
      userOpen, searchText, onSearch, logout,
      backendMode, toggleBackend,
      setTheme, themeLabel, setLocale,
      wizardOpen, hostWizardOpen, hostWizardPreset, onHostWizardDone, currentFocus, t,
    }
  },
  template: `
  <div class="layout">
    <!-- ===================== 左侧 9 模块导航 ===================== -->
    <aside class="sidebar" id="primary-sidebar">
      <div class="sidebar-brand">
        <div class="logo"><i class="fas fa-cubes"></i></div>
        <div class="brand-text">
          <div class="title">{{ t('brand_abbr') }}</div>
          <div class="ver">{{ t('brand_version') }}</div>
        </div>
      </div>

      <nav class="nav">
        <div class="nav-module" v-for="mod in modules" :key="mod.key">
          <div class="nav-module-head" :class="{open:expanded===mod.key, active:currentModule===mod.key}" @click="toggleModule(mod.key)">
            <i class="fas nav-mod-icon" :class="mod.icon"></i>
            <span class="nav-mod-label">{{ t(mod.label) }}</span>
            <i class="fas fa-chevron-right nav-caret" :class="{rot:expanded===mod.key}"></i>
          </div>
          <div class="nav-submenu" v-show="expanded===mod.key">
            <div class="nav-subitem" v-for="ch in mod.children" :key="ch.key"
                 :class="{active:currentModule===mod.key && currentTab===ch.key}"
                 @click="go(mod.key, ch.key)">
              {{ t(ch.label) }}
            </div>
          </div>
        </div>
      </nav>

      <div class="sidebar-footer">
        <span class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('mode_demo') }}</span>
      </div>
    </aside>

    <!-- ===================== 主区域 ===================== -->
    <div class="main">
      <!-- 顶部工具栏（注意：class 用 app-toolbar，避免与视图内 .toolbar 冲突） -->
      <header class="app-toolbar" id="app-toolbar">
        <!-- 面包屑 -->
        <nav class="breadcrumb">
          <i class="fas fa-cubes crumb-home"></i>
          <span class="crumb-sep">/</span>
          <span class="crumb">{{ breadcrumb[0] }}</span>
          <template v-if="breadcrumb[1]">
            <span class="crumb-sep">/</span>
            <span class="crumb last">{{ breadcrumb[1] }}</span>
          </template>
        </nav>

        <!-- 后端模式徽标：demo（Mock）/ real（Go 后端），点击切换 -->
        <button class="cnf-backend-badge" :class="backendMode==='real' ? 'is-real' : 'is-demo'"
                @click="toggleBackend" :title="backendMode==='real' ? '当前：真实 Go 后端（点击切回 Demo）' : '当前：Demo Mock 后端（点击切到真实 Go 后端）'">
          <i class="fas" :class="backendMode==='real' ? 'fa-bolt' : 'fa-flask'"></i>
          <span>{{ backendMode==='real' ? 'REAL' : 'DEMO' }}</span>
        </button>

        <div class="spacer"></div>

        <!-- 全局搜索 -->
        <div class="toolbar-search">
          <i class="fas fa-magnifying-glass"></i>
          <input type="text" v-model="searchText" @keyup.enter="onSearch" :placeholder="t('tb_search_ph')">
        </div>

        <div class="toolbar-actions">
          <!-- 通知中心 -->
          <div class="notif-wrap">
            <button class="icon-btn" @click="notifOpen=!notifOpen; userOpen=false" :title="t('tb_notifications')">
              <i class="fas fa-bell"></i>
              <span class="notif-badge" v-if="unreadCount">{{ unreadCount }}</span>
            </button>
            <div class="popover notif-pop" v-if="notifOpen">
              <div class="popover-head">
                <strong>{{ t('tb_notifications') }}</strong>
                <button class="link-btn" @click="markAllRead">{{ t('tb_mark_all_read') }}</button>
              </div>
              <div class="popover-empty" v-if="!notifications.length">{{ t('tb_no_notifications') }}</div>
              <div class="notif-list" v-else>
                <div class="notif-item" v-for="n in notifications" :key="n.id" :class="{unread:!n.read}">
                  <i class="fas notif-ic" :class="[notifIcon(n.level), 'lvl-'+n.level]"></i>
                  <div class="notif-body">
                    <div class="notif-title">{{ n.title }}</div>
                    <div class="notif-time">{{ n.time }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 语言切换 -->
          <div class="seg-control" role="group" :aria-label="t('language')">
            <button class="seg" :class="{active:locale.locale==='zh'}" @click="setLocale('zh')">中</button>
            <button class="seg" :class="{active:locale.locale==='en'}" @click="setLocale('en')">EN</button>
          </div>

          <!-- 外观主题（白/深灰/黑） -->
          <div class="seg-control" role="group" :aria-label="t('appearance')">
            <button v-for="th in THEMES" :key="th" class="seg seg-icon"
              :class="{active:themeState.theme===th}" @click="setTheme(th)" :title="themeLabel(th)">
              <i class="fas" :class="{light:'fa-sun',dim:'fa-cloud-moon',dark:'fa-moon'}[th]"></i>
            </button>
          </div>

          <!-- 用户菜单 -->
          <div class="user-wrap">
            <button class="user-chip-btn" @click="userOpen=!userOpen; notifOpen=false">
              <span class="avatar">A</span>
              <span class="user-chip-name">administrator</span>
              <i class="fas fa-chevron-down"></i>
            </button>
            <div class="popover user-pop" v-if="userOpen">
              <div class="popover-head"><strong>administrator</strong></div>
              <div class="menu-row" @click="go('system','config'); userOpen=false"><i class="fas fa-gear"></i> {{ t('nav_mod_system') }}</div>
              <div class="menu-row" @click="go('access','audit'); userOpen=false"><i class="fas fa-clipboard-list"></i> {{ t('nav_acc_audit') }}</div>
              <div class="menu-row danger" @click="logout"><i class="fas fa-right-from-bracket"></i> {{ t('tb_logout') }}</div>
            </div>
          </div>
        </div>
      </header>

      <main class="content">
        <component :is="currentComponent" :tab="currentTab" :search="searchText" :focus="currentFocus"></component>
      </main>
    </div>

    <VMWizard v-if="wizardOpen" @close="wizardOpen=false"></VMWizard>
    <HostWizard v-if="hostWizardOpen" :preset-cluster-id="hostWizardPreset" @close="hostWizardOpen=false" @done="onHostWizardDone"></HostWizard>
  </div>`,
}

createApp(App).mount('#app')
})()
