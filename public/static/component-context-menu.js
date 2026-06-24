// =============================================================================
//  通用组件：VM 右键上下文菜单 (component-context-menu.js)
//  对齐 VMware vSphere 风格，分组：电源 / 控制台 / 快照 / 迁移 / 管理。
//  用法：
//    <vm-context-menu :vm="ctxVM" :x="ctxX" :y="ctxY" v-if="ctxOpen"
//        @action="onCtxAction" @close="ctxOpen=false" />
//  发出事件 action: { command, vm }，command 取值见 buildMenu。
//
//  本文件最先加载，负责初始化全局：window.__CNF_VIEWS、window.api（/api/v1 前缀）。
// =============================================================================
(function () {
const { computed, onMounted, onBeforeUnmount } = Vue

// ---- 全局基础设施：统一 API 客户端（/api/v1 前缀）+ 视图注册表 ----
window.__CNF_VIEWS = window.__CNF_VIEWS || {}
window.API_BASE = '/api/v1'
window.api = (path, opts) => fetch(window.API_BASE + path, opts).then((r) => r.json())

const t = window.t

// 菜单结构：分组 → 命令项。command 用于回调判定，icon/label 见名知意。
function buildMenu(vm) {
  const running = vm.status === 'running'
  const paused = vm.status === 'paused'
  const stopped = vm.status === 'stopped'
  return [
    { group: 'ctx_group_power', items: [
      { command: 'power_on', label: 'ctx_power_on', icon: 'fa-play', disabled: running, hint: 'start' },
      { command: 'shutdown', label: 'ctx_shutdown', icon: 'fa-power-off', disabled: !running, hint: 'shutdown' },
      { command: 'reboot', label: 'ctx_reboot', icon: 'fa-rotate-right', disabled: !running, hint: 'reboot' },
      { command: 'suspend', label: 'ctx_suspend', icon: 'fa-pause', disabled: !running, hint: 'suspend' },
      { command: 'resume', label: 'ctx_resume', icon: 'fa-play', disabled: !paused, hint: 'resume' },
      { command: 'power_off', label: 'ctx_power_off', icon: 'fa-plug-circle-xmark', disabled: stopped, hint: 'poweroff', danger: true },
    ]},
    { group: 'ctx_group_console', items: [
      { command: 'open_console', label: 'ctx_open_console', icon: 'fa-display', disabled: stopped },
      { command: 'open_serial', label: 'ctx_open_serial', icon: 'fa-terminal', disabled: stopped },
    ]},
    { group: 'ctx_group_snapshot', items: [
      { command: 'take_snapshot', label: 'ctx_take_snapshot', icon: 'fa-camera' },
      { command: 'manage_snapshots', label: 'ctx_manage_snapshots', icon: 'fa-layer-group' },
      { command: 'revert_snapshot', label: 'ctx_revert_snapshot', icon: 'fa-clock-rotate-left' },
    ]},
    { group: 'ctx_group_migration', items: [
      { command: 'migrate', label: 'ctx_migrate', icon: 'fa-right-left', disabled: vm.gpus > 0 && running, hint: vm.gpus > 0 ? 'GPU 直通不可在线迁移' : '' },
      { command: 'clone', label: 'ctx_clone', icon: 'fa-clone' },
      { command: 'to_template', label: 'ctx_to_template', icon: 'fa-file-export', disabled: running },
    ]},
    { group: 'ctx_group_manage', items: [
      { command: 'edit_settings', label: 'ctx_edit_settings', icon: 'fa-sliders' },
      { command: 'rename', label: 'ctx_rename', icon: 'fa-pen' },
      { command: 'delete', label: 'ctx_delete', icon: 'fa-trash', disabled: running, danger: true },
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
    // 防止菜单溢出视口
    const style = computed(() => {
      const maxX = window.innerWidth - 260
      const maxY = window.innerHeight - 440
      return { left: Math.max(8, Math.min(props.x, maxX)) + 'px', top: Math.max(8, Math.min(props.y, maxY)) + 'px' }
    })
    const pick = (item) => {
      if (item.disabled) return
      emit('action', { command: item.command, vm: props.vm, hint: item.hint })
      emit('close')
    }
    const onEsc = (e) => { if (e.key === 'Escape') emit('close') }
    onMounted(() => document.addEventListener('keydown', onEsc))
    onBeforeUnmount(() => document.removeEventListener('keydown', onEsc))
    return { menu, style, pick, t }
  },
  template: `
    <div class="ctx-menu" :style="style" @click.stop @contextmenu.prevent>
      <div class="ctx-header"><i class="fas fa-desktop"></i> {{ vm.name }}</div>
      <template v-for="(grp,gi) in menu" :key="gi">
        <div class="ctx-group-label">{{ t(grp.group) }}</div>
        <button v-for="(it,ii) in grp.items" :key="ii"
          class="ctx-item" :class="{disabled:it.disabled, danger:it.danger}"
          :title="it.hint || ''" @click="pick(it)">
          <i class="fas ctx-ic" :class="it.icon"></i>
          <span>{{ t(it.label) }}</span>
        </button>
        <div v-if="gi < menu.length-1" class="ctx-sep"></div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.VMContextMenu = VMContextMenu
})()
