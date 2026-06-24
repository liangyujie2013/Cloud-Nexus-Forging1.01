// =============================================================================
//  资源拓扑树组件 (component-topology-tree.js) — Cloud Nexus Forging
//  完整层级：数据中心 → 集群 → 宿主机 → 虚拟机
//    · 数据来源：window.cnfTopology.topologyTree（响应式聚合）
//    · 节点显示：类型图标 + 名称 + 下级 VM 计数 + 状态圆点
//    · 点击节点 → 通过 store.navigateTo 切换右侧内容区到对应详情页（并高亮）
//    · 展开/收起、刷新；Apple HIG 风格（12px 圆角 / 毛玻璃 / 流畅动画）
//  注册为 window.__CNF_VIEWS.TopologyTree（侧栏复用）。
// =============================================================================
(function () {
const { ref, computed } = Vue
const t = window.t

const TYPE_ICON = {
  datacenter: 'fa-building',
  cluster: 'fa-layer-group',
  host: 'fa-server',
  vm: 'fa-desktop',
}
const TYPE_COLOR = {
  datacenter: 'var(--color-blue)',
  cluster: 'var(--color-indigo)',
  host: 'var(--color-orange)',
  vm: 'var(--color-gray)',
}

// 单个树节点（递归组件）
const TreeNode = {
  name: 'TopoTreeNode',
  props: {
    node: { type: Object, required: true },
    depth: { type: Number, default: 0 },
    expandedMap: { type: Object, required: true },
  },
  emits: ['pick', 'toggle'],
  setup(props, { emit }) {
    const hasChildren = computed(() => props.node.children && props.node.children.length > 0)
    const isOpen = computed(() => props.expandedMap[props.node.key] !== false) // 默认展开
    const statusClass = computed(() => {
      const s = props.node.status
      if (s === 'connected' || s === 'online' || s === 'running' || s === 'healthy') return 'status-online'
      if (s === 'maintenance' || s === 'paused' || s === 'warning' || s === 'connecting' || s === 'degraded') return 'status-maintenance'
      if (s === 'offline' || s === 'error' || s === 'stopped') return 'status-offline'
      return 'status-online'
    })
    const onRowClick = () => {
      if (hasChildren.value) emit('toggle', props.node.key)
      emit('pick', props.node)
    }
    return { hasChildren, isOpen, statusClass, onRowClick, TYPE_ICON, TYPE_COLOR, t }
  },
  template: `
    <div class="topo-node">
      <div class="topo-row" :style="{paddingLeft: (depth*16+8)+'px'}" @click="onRowClick">
        <i v-if="hasChildren" class="fas fa-chevron-right topo-chevron" :class="{open:isOpen}"></i>
        <span v-else class="topo-chevron-placeholder"></span>
        <i class="fas topo-type-icon" :class="TYPE_ICON[node.type]" :style="{color: TYPE_COLOR[node.type]}"></i>
        <span class="topo-label">{{ node.label }}</span>
        <span v-if="node.count !== undefined && node.type!=='vm'" class="topo-count">{{ node.count }} VM</span>
        <span class="topo-status" :class="statusClass"></span>
      </div>
      <div class="topo-children" v-if="hasChildren && isOpen">
        <topo-tree-node v-for="child in node.children" :key="child.key"
          :node="child" :depth="depth+1" :expanded-map="expandedMap"
          @pick="$emit('pick', $event)" @toggle="$emit('toggle', $event)" />
      </div>
    </div>`,
}
// 自引用递归注册
TreeNode.components = { TopoTreeNode: TreeNode }

const TopologyTree = {
  components: { TopoTreeNode: TreeNode },
  props: { compact: { type: Boolean, default: false } },
  setup() {
    const store = window.cnfTopology
    const expandedMap = ref({})
    const tree = computed(() => store.topologyTree.value)

    const toggle = (key) => { expandedMap.value = { ...expandedMap.value, [key]: expandedMap.value[key] === false ? true : false } }
    const pick = (node) => { store.navigateTo(node.type, node.id) }
    const refreshTree = async () => { await store.fetchAll(true); window.cnfToast(t('toast_success'), 'success') }

    // 汇总（树头部展示总量）
    const totals = computed(() => {
      const s = store.state
      return { dc: s.datacenters.length, cluster: s.clusters.length, host: s.hosts.length, vm: s.vms.length }
    })

    return { tree, expandedMap, toggle, pick, refreshTree, totals, t }
  },
  template: `
    <div class="topology-tree" :class="{compact:compact}">
      <div class="topo-tree-header">
        <h3><i class="fas fa-sitemap"></i> {{ t('topo_tree_title') }}</h3>
        <button class="icon-btn" :title="t('op_refresh')" @click="refreshTree"><i class="fas fa-rotate-right"></i></button>
      </div>
      <div class="topo-tree-totals">
        <span><i class="fas fa-building" style="color:var(--color-blue)"></i> {{ totals.dc }}</span>
        <span><i class="fas fa-layer-group" style="color:var(--color-indigo)"></i> {{ totals.cluster }}</span>
        <span><i class="fas fa-server" style="color:var(--color-orange)"></i> {{ totals.host }}</span>
        <span><i class="fas fa-desktop" style="color:var(--color-gray)"></i> {{ totals.vm }}</span>
      </div>
      <div class="topo-tree-body">
        <topo-tree-node v-for="node in tree" :key="node.key"
          :node="node" :depth="0" :expanded-map="expandedMap"
          @pick="pick" @toggle="toggle" />
        <div v-if="!tree.length" class="topo-empty"><i class="fas fa-inbox"></i> {{ t('op_no_data') }}</div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.TopologyTree = TopologyTree
})()
