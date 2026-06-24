// CNFv1.0 应用根组件：侧边栏导航 + 视图路由 + 主题(白/深灰/黑) + 中英切换 + VM 向导
(function () {
const { createApp, ref, computed } = Vue
const t = window.t

const App = {
  components: {
    DashboardView: window.__CNF_VIEWS.DashboardView,
    GPUView: window.__CNF_VIEWS.GPUView,
    TopologyView: window.__CNF_VIEWS.TopologyView,
    VMListView: window.__CNF_VIEWS.VMListView,
    StorageView: window.__CNF_VIEWS.StorageView,
    MigrationView: window.__CNF_VIEWS.MigrationView,
    SnapshotView: window.__CNF_VIEWS.SnapshotView,
    ClusterConfigView: window.__CNF_VIEWS.ClusterConfigView,
    PermissionsView: window.__CNF_VIEWS.PermissionsView,
    DRSView: window.__CNF_VIEWS.DRSView,
    VMWizard: window.__CNF_VIEWS.VMWizard,
  },
  setup() {
    const current = ref('dashboard')
    const wizardOpen = ref(false)
    const locale = window.i18n
    const themeState = window.cnfTheme
    const menuOpen = ref(false)

    // 导航定义：label 用 i18n key，运行时翻译
    const nav = computed(() => [
      { section: 'nav_overview' },
      { key: 'dashboard', label: 'nav_dashboard', icon: 'fa-gauge-high' },
      { key: 'topology', label: 'nav_topology', icon: 'fa-sitemap' },
      { section: 'nav_compute' },
      { key: 'vms', label: 'nav_vms', icon: 'fa-desktop' },
      { key: 'gpu', label: 'nav_gpu', icon: 'fa-microchip' },
      { key: 'cluster_cfg', label: 'nav_cluster_cfg', icon: 'fa-sliders' },
      { section: 'nav_ops' },
      { key: 'migration', label: 'nav_migration', icon: 'fa-right-left' },
      { key: 'drs', label: 'nav_drs', icon: 'fa-arrows-to-dot' },
      { key: 'snapshot', label: 'nav_snapshot', icon: 'fa-camera' },
      { section: 'nav_infra' },
      { key: 'storage', label: 'nav_storage', icon: 'fa-database' },
      { section: 'nav_admin' },
      { key: 'permissions', label: 'nav_permissions', icon: 'fa-user-shield' },
    ])

    const viewMap = {
      dashboard: 'DashboardView', topology: 'TopologyView',
      vms: 'VMListView', gpu: 'GPUView', storage: 'StorageView',
      migration: 'MigrationView', snapshot: 'SnapshotView',
      cluster_cfg: 'ClusterConfigView', permissions: 'PermissionsView', drs: 'DRSView',
    }
    const currentView = computed(() => viewMap[current.value])
    const currentTitle = computed(() => t('title_' + current.value))

    // 主题切换：循环 light → dim → dark
    const themeIcon = computed(() => ({ light: 'fa-sun', dim: 'fa-cloud-moon', dark: 'fa-moon' }[themeState.theme]))
    const setTheme = (name) => { window.setTheme(name); menuOpen.value = false }
    const themeLabel = (name) => t('theme_' + name)

    const setLocale = (l) => { window.setLocale(l); menuOpen.value = false }

    const openWizard = () => wizardOpen.value = true
    const tr = (k) => t(k)

    return {
      current, nav, currentView, currentTitle, wizardOpen, openWizard,
      locale, themeState, themeIcon, setTheme, themeLabel, setLocale, tr,
      menuOpen, THEMES: window.THEMES,
    }
  },
  template: `
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="logo"><i class="fas fa-cubes"></i></div>
        <div><div class="title">CNFv1.0</div><div class="ver">{{ tr('brand_sub') }}</div></div>
      </div>
      <nav class="nav">
        <template v-for="(item,i) in nav" :key="i">
          <div v-if="item.section" class="nav-section">{{ tr(item.section) }}</div>
          <div v-else class="nav-item" :class="{active:current===item.key}" @click="current=item.key">
            <i class="fas" :class="item.icon"></i> {{ tr(item.label) }}
          </div>
        </template>
      </nav>
      <div class="sidebar-footer">
        <div class="user-chip">
          <div class="avatar">A</div>
          <div style="flex:1"><div style="font-weight:600;font-size:14px">admin</div><div class="muted" style="font-size:11px">{{ tr('user_admin') }}</div></div>
        </div>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <h1>{{ currentTitle }}</h1>
        <div class="topbar-actions">
          <span class="apple-badge apple-badge--running"><span class="dot"></span>{{ tr('mode_demo') }}</span>

          <!-- 语言切换分段控件 -->
          <div class="seg-control" role="group" :aria-label="tr('language')">
            <button class="seg" :class="{active:locale.locale==='zh'}" @click="setLocale('zh')">中文</button>
            <button class="seg" :class="{active:locale.locale==='en'}" @click="setLocale('en')">EN</button>
          </div>

          <!-- 外观切换分段控件（白/深灰/黑）-->
          <div class="seg-control" role="group" :aria-label="tr('appearance')">
            <button v-for="th in THEMES" :key="th" class="seg seg-icon"
              :class="{active:themeState.theme===th}" @click="setTheme(th)" :title="themeLabel(th)">
              <i class="fas" :class="{light:'fa-sun',dim:'fa-cloud-moon',dark:'fa-moon'}[th]"></i>
            </button>
          </div>
        </div>
      </header>
      <main class="content">
        <component :is="currentView"></component>
      </main>
    </div>

    <VMWizard v-if="wizardOpen" @close="wizardOpen=false"></VMWizard>
  </div>`,
}

const app = createApp(App)
app.mount('#app')
})()
