// =============================================================================
//  通用右键上下文菜单 (component-context-menu.js)
//  本文件最先加载，负责初始化全局基础设施：
//    window.__CNF_VIEWS   视图/组件注册表
//    window.API_BASE      统一接口前缀 /api/v1
//    window.api(path,opts) 统一 fetch 客户端（自动 JSON 解析）
//    window.useContextMenu() 通用右键菜单管理器（任意页面复用）
//    window.cnfToast(msg,type) 全局 Toast 反馈
//
//  组件：
//    VMContextMenu  虚拟机右键菜单（分组标题 + 分割线 + 状态联动禁用 +
//                   危险操作红色 + 快捷键提示 + 智能视口边界 + 淡入动画）
//
//  CNF 自有风格，分组：电源 / 控制台 / 快照 / 迁移与克隆 / 管理。
// =============================================================================
(function () {
const { ref, computed, onMounted, onBeforeUnmount, nextTick } = Vue

// ---- 全局基础设施 ----
window.__CNF_VIEWS = window.__CNF_VIEWS || {}
window.API_BASE = '/api/v1'
window.api = (path, opts) => fetch(window.API_BASE + path, opts).then((r) => r.json())

const t = window.t

// =============================================================================
//  通用 Toast：成功 / 失败 / 信息 反馈（无依赖，自动消失）
// =============================================================================
window.cnfToast = function (message, type = 'success', duration = 2600) {
  const icon = type === 'error' ? 'fa-circle-xmark'
    : type === 'warning' ? 'fa-triangle-exclamation'
    : type === 'info' ? 'fa-circle-info' : 'fa-circle-check'
  const el = document.createElement('div')
  el.className = 'cnf-toast cnf-toast--' + type
  el.innerHTML = '<i class="fas ' + icon + '"></i><span></span>'
  el.querySelector('span').textContent = message
  document.body.appendChild(el)
  setTimeout(() => { el.classList.add('cnf-toast--out'); setTimeout(() => el.remove(), 280) }, duration)
}

// =============================================================================
//  通用右键菜单管理器 useContextMenu()
//  返回 { visible, x, y, payload, open(event, payload), close }
//  特性：智能视口边界（实测菜单尺寸后再夹取）、ESC / 点击外部 / 滚动 / resize / 失焦 自动关闭。
//  任意页面：const ctx = useContextMenu(); @contextmenu.prevent="ctx.open($event, row)"
// =============================================================================
window.useContextMenu = function () {
  const visible = ref(false)
  const x = ref(0)
  const y = ref(0)
  const payload = ref(null)
  // 触发点：先记录原始坐标，菜单渲染后再依据实测尺寸夹取边界
  const rawX = ref(0)
  const rawY = ref(0)

  function clampToViewport() {
    const el = document.querySelector('.ctx-menu')
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let nx = rawX.value
    let ny = rawY.value
    if (nx + rect.width + margin > window.innerWidth) nx = window.innerWidth - rect.width - margin
    if (ny + rect.height + margin > window.innerHeight) ny = window.innerHeight - rect.height - margin
    x.value = Math.max(margin, nx)
    y.value = Math.max(margin, ny)
  }

  function open(event, data) {
    if (event) { event.preventDefault(); event.stopPropagation() }
    rawX.value = event ? event.clientX : 0
    rawY.value = event ? event.clientY : 0
    x.value = rawX.value
    y.value = rawY.value
    payload.value = data
    visible.value = true
    // 渲染后实测尺寸再夹取，避免硬编码菜单宽高导致溢出
    nextTick(() => clampToViewport())
  }

  function close() {
    if (!visible.value) return
    visible.value = false
    payload.value = null
  }

  // 全局关闭事件：点击外部 / 滚动 / 窗口尺寸变化 / 失焦
  const onDocClick = (e) => { if (visible.value && !e.target.closest('.ctx-menu')) close() }
  const onScroll = () => close()
  const onResize = () => close()
  const onBlur = () => close()
  const onKey = (e) => { if (e.key === 'Escape') close() }

  onMounted(() => {
    document.addEventListener('mousedown', onDocClick, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onBlur)
    document.addEventListener('keydown', onKey)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocClick, true)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('keydown', onKey)
  })

  return { visible, x, y, payload, open, close }
}

// =============================================================================
//  VM 右键菜单结构：分组 → 命令项
//  字段：command 回调判定 / label i18n 键 / icon / disabled 状态联动 /
//        danger 危险红 / shortcut 快捷键提示 / hint 悬浮说明
// =============================================================================
function buildMenu(vm) {
  const running = vm.status === 'running'
  const paused = vm.status === 'paused'
  const stopped = vm.status === 'stopped'
  const gpuBlocked = vm.gpus > 0 && running
  return [
    { group: 'ctx_group_power', items: [
      { command: 'power_on', label: 'ctx_power_on', icon: 'fa-play', disabled: running, hint: 'start' },
      { command: 'shutdown', label: 'ctx_shutdown', icon: 'fa-power-off', disabled: !running, hint: 'shutdown' },
      { command: 'reboot', label: 'ctx_reboot', icon: 'fa-rotate-right', disabled: !running, hint: 'reboot', shortcut: 'Ctrl+R' },
      { command: 'suspend', label: 'ctx_suspend', icon: 'fa-pause', disabled: !running, hint: 'suspend' },
      { command: 'resume', label: 'ctx_resume', icon: 'fa-play', disabled: !paused, hint: 'resume' },
      { command: 'power_off', label: 'ctx_power_off', icon: 'fa-plug-circle-xmark', disabled: stopped, hint: 'poweroff', danger: true },
    ]},
    { group: 'ctx_group_console', items: [
      { command: 'open_console', label: 'ctx_open_console', icon: 'fa-display', disabled: stopped, shortcut: 'Enter' },
      { command: 'open_serial', label: 'ctx_open_serial', icon: 'fa-terminal', disabled: stopped },
    ]},
    { group: 'ctx_group_snapshot', items: [
      { command: 'take_snapshot', label: 'ctx_take_snapshot', icon: 'fa-camera', shortcut: 'Ctrl+S' },
      { command: 'manage_snapshots', label: 'ctx_manage_snapshots', icon: 'fa-layer-group' },
      { command: 'revert_snapshot', label: 'ctx_revert_snapshot', icon: 'fa-clock-rotate-left' },
    ]},
    { group: 'ctx_group_migration', items: [
      { command: 'migrate', label: 'ctx_migrate', icon: 'fa-right-left', disabled: gpuBlocked, hint: gpuBlocked ? t('ctx_gpu_block') : '' },
      { command: 'clone', label: 'ctx_clone', icon: 'fa-clone' },
      { command: 'to_template', label: 'ctx_to_template', icon: 'fa-file-export', disabled: running },
    ]},
    { group: 'ctx_group_manage', items: [
      { command: 'edit_settings', label: 'ctx_edit_settings', icon: 'fa-sliders' },
      { command: 'rename', label: 'ctx_rename', icon: 'fa-pen', shortcut: 'F2' },
      { command: 'delete', label: 'ctx_delete', icon: 'fa-trash', disabled: running, danger: true, shortcut: 'Del', hint: running ? t('ctx_delete') : '' },
    ]},
  ]
}

const VMContextMenu = {
  props: {
    vm: { type: Object, required: true },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
  },
  emits: ['action', 'close'],
  setup(props, { emit }) {
    const menu = computed(() => buildMenu(props.vm))
    const style = computed(() => ({ left: props.x + 'px', top: props.y + 'px' }))
    const pick = (item) => {
      if (item.disabled) return
      emit('action', { command: item.command, vm: props.vm, hint: item.hint })
      emit('close')
    }
    return { menu, style, pick, t }
  },
  template: `
    <div class="ctx-menu" :style="style" @click.stop @contextmenu.prevent @mousedown.stop>
      <div class="ctx-header"><i class="fas fa-desktop"></i> <span>{{ vm.name }}</span></div>
      <template v-for="(grp,gi) in menu" :key="gi">
        <div class="ctx-group-label">{{ t(grp.group) }}</div>
        <button v-for="(it,ii) in grp.items" :key="ii"
          class="ctx-item" :class="{disabled:it.disabled, danger:it.danger}"
          :title="it.hint || ''" @click="pick(it)">
          <i class="fas ctx-ic" :class="it.icon"></i>
          <span class="ctx-label">{{ t(it.label) }}</span>
          <span v-if="it.shortcut" class="ctx-shortcut">{{ it.shortcut }}</span>
        </button>
        <div v-if="gi < menu.length-1" class="ctx-sep"></div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.VMContextMenu = VMContextMenu

// =============================================================================
//  主机（宿主机）右键菜单结构（N3）：分组 → 命令项
//  分组：电源 / 维护 / 网络与配置
//  状态联动：
//    · connected   → 可关机/重启/进入维护；不可开机
//    · maintenance → 可退出维护/开机/关机；进入维护已是当前态
//    · disconnected→ 可开机；其余禁用
// =============================================================================
function buildHostMenu(h) {
  const connected = h.status === 'connected'
  const maintenance = h.status === 'maintenance' || h.maintenance_mode
  const off = h.status === 'disconnected' || h.status === 'poweroff'
  return [
    { group: 'hctx_group_power', items: [
      { command: 'power_on', label: 'hctx_power_on', icon: 'fa-play', disabled: connected || maintenance, hint: 'IPMI/BMC 开机' },
      { command: 'reboot', label: 'hctx_reboot', icon: 'fa-rotate-right', disabled: off, hint: '重启宿主机' },
      { command: 'shutdown', label: 'hctx_shutdown', icon: 'fa-power-off', disabled: off, danger: true, hint: '关闭宿主机' },
    ]},
    { group: 'hctx_group_maint', items: [
      { command: 'enter_maintenance', label: 'hctx_enter_maint', icon: 'fa-screwdriver-wrench', disabled: maintenance || off, hint: '进入维护模式（需先迁出运行中虚拟机）' },
      { command: 'exit_maintenance', label: 'hctx_exit_maint', icon: 'fa-circle-check', disabled: !maintenance, hint: '退出维护模式恢复调度' },
    ]},
    { group: 'hctx_group_config', items: [
      { command: 'edit_network', label: 'hctx_edit_network', icon: 'fa-network-wired', disabled: off, hint: '修改管理网络（IP/掩码/网关/VLAN）' },
      { command: 'open_detail', label: 'hctx_open_detail', icon: 'fa-circle-info', hint: '查看硬件/IOMMU/GPU详情' },
      { command: 'remove', label: 'hctx_remove', icon: 'fa-trash', disabled: connected && (h.vm_count > 0), danger: true, hint: '从集群移除（需无运行虚拟机）' },
    ]},
  ]
}

const HostContextMenu = {
  props: {
    host: { type: Object, required: true },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
  },
  emits: ['action', 'close'],
  setup(props, { emit }) {
    const menu = computed(() => buildHostMenu(props.host))
    const style = computed(() => ({ left: props.x + 'px', top: props.y + 'px' }))
    const pick = (item) => {
      if (item.disabled) return
      emit('action', { command: item.command, host: props.host, hint: item.hint })
      emit('close')
    }
    return { menu, style, pick, t }
  },
  template: `
    <div class="ctx-menu" :style="style" @click.stop @contextmenu.prevent @mousedown.stop>
      <div class="ctx-header"><i class="fas fa-server"></i> <span>{{ host.name }}</span></div>
      <template v-for="(grp,gi) in menu" :key="gi">
        <div class="ctx-group-label">{{ t(grp.group) }}</div>
        <button v-for="(it,ii) in grp.items" :key="ii"
          class="ctx-item" :class="{disabled:it.disabled, danger:it.danger}"
          :title="it.hint || ''" @click="pick(it)">
          <i class="fas ctx-ic" :class="it.icon"></i>
          <span class="ctx-label">{{ t(it.label) }}</span>
        </button>
        <div v-if="gi < menu.length-1" class="ctx-sep"></div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.HostContextMenu = HostContextMenu
})()
