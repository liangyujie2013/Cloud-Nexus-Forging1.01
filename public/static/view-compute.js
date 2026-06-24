// =============================================================================
//  模块视图：计算资源 (view-compute.js)
//  子标签：vms 虚拟机列表（支持右键菜单）/ templates 模板管理 / isos ISO 镜像。
//  右键菜单复用 component-context-menu.js 的 VMContextMenu 组件。
// =============================================================================
(function () {
const { ref, reactive, onMounted, watch } = Vue
const api = window.api
const t = window.t

const ComputeView = {
  components: { VMContextMenu: window.__CNF_VIEWS.VMContextMenu },
  props: { tab: { type: String, default: 'vms' }, search: { type: String, default: '' } },
  setup(props) {
    const vms = ref([])
    const templates = ref([])
    const isos = ref([])

    // 右键菜单状态
    const ctx = reactive({ open: false, vm: null, x: 0, y: 0 })
    const toast = ref('')

    const load = async (tab) => {
      if (tab === 'vms' && !vms.value.length) vms.value = await api('/vms')
      if (tab === 'templates' && !templates.value.length) templates.value = await api('/vm-templates')
      if (tab === 'isos' && !isos.value.length) isos.value = await api('/iso-images')
    }
    onMounted(() => load(props.tab))
    watch(() => props.tab, (tb) => load(tb))

    // 打开右键菜单
    const openContext = (e, vm) => {
      ctx.vm = vm; ctx.x = e.clientX; ctx.y = e.clientY; ctx.open = true
    }
    const closeContext = () => { ctx.open = false }

    // 处理右键命令
    const onCtxAction = async ({ command, vm, hint }) => {
      const powerCmds = { power_on: 'start', shutdown: 'shutdown', reboot: 'reboot', suspend: 'suspend', resume: 'resume', power_off: 'poweroff' }
      if (powerCmds[command]) {
        const res = await api('/vms/' + vm.id + '/power', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: powerCmds[command] }),
        })
        // 原型：本地同步状态，立即反映到表格
        const target = vms.value.find((v) => v.id === vm.id)
        if (target) target.status = res.status
        showToast(`「${vm.name}」${t('ctx_' + command.replace('power_', 'power_'))}：${res.message}`)
      } else if (command === 'migrate') {
        showToast(`「${vm.name}」${t('ctx_migrate')}（请前往「可用性管理 → 迁移中心」执行）`)
      } else {
        showToast(`「${vm.name}」：${t('ctx_' + command)}（原型演示）`)
      }
    }

    const showToast = (msg) => { toast.value = msg; setTimeout(() => (toast.value = ''), 3200) }

    const statusBadge = (s) => ({
      running: { cls: 'apple-badge--running', label: t('st_running') },
      paused: { cls: 'apple-badge--warning', label: t('st_paused') },
      stopped: { cls: 'apple-badge--stopped', label: t('st_stopped') },
    }[s] || { cls: '', label: s })

    const openWizard = () => window.dispatchEvent(new CustomEvent('cnf:open-vm-wizard'))

    return { props, vms, templates, isos, ctx, openContext, closeContext, onCtxAction, toast, statusBadge, openWizard, t }
  },
  template: `
    <div @click="closeContext">
      <!-- ===== vms：虚拟机列表（右键菜单）===== -->
      <template v-if="props.tab==='vms'">
        <div class="toolbar">
          <span class="muted">{{ vms.length }} {{ t('vm_count') }} · <i class="fas fa-circle-info"></i> 在虚拟机行上点击右键打开操作菜单</span>
          <div class="spacer"></div>
          <button class="apple-btn apple-btn--primary" @click="openWizard"><i class="fas fa-plus"></i> {{ t('vm_create') }}</button>
        </div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('col_name') }}</th><th>{{ t('col_status') }}</th><th>{{ t('col_cpu') }}</th><th>{{ t('col_mem') }}</th><th>{{ t('col_pin_numa') }}</th><th>{{ t('col_gpu') }}</th><th>{{ t('col_ha') }}</th><th>{{ t('col_ip') }}</th><th>{{ t('col_load') }}</th></tr></thead>
            <tbody>
              <tr v-for="v in vms" :key="v.id" class="vm-row" @contextmenu.prevent="openContext($event, v)">
                <td><strong>{{ v.name }}</strong><div class="muted" style="font-size:12px">{{ v.os }}</div></td>
                <td><span class="apple-badge" :class="statusBadge(v.status).cls"><span class="dot"></span>{{ statusBadge(v.status).label }}</span></td>
                <td class="mono">{{ v.sockets }}×{{ v.cores }}×{{ v.threads }} = {{ v.vcpus }}</td>
                <td>{{ v.mem_gb }} GB</td>
                <td><span v-if="v.cpu_pinning" class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('pinned') }}·N{{ v.numa }}</span><span v-else class="muted">—</span></td>
                <td>{{ v.gpus>0 ? v.gpus+' ×' : '—' }}</td>
                <td><i :class="v.ha?'fas fa-shield-halved':'far fa-circle'" :style="{color:v.ha?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
                <td class="mono muted">{{ v.ip }}</td>
                <td style="width:90px"><div class="usage-bar"><div class="fill" :style="{width:v.cpu_usage+'%',background:v.cpu_usage>80?'var(--color-red)':'var(--color-blue)'}"></div></div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== templates：模板管理 ===== -->
      <template v-else-if="props.tab==='templates'">
        <div class="toolbar">
          <span class="muted">{{ templates.length }} {{ t('tpl_title') }}</span>
          <div class="spacer"></div>
          <button class="apple-btn apple-btn--primary"><i class="fas fa-plus"></i> {{ t('tpl_add') }}</button>
        </div>
        <div class="grid grid-2">
          <div class="apple-card" v-for="tp in templates" :key="tp.id">
            <div class="flex between" style="margin-bottom:10px">
              <div><strong>{{ tp.name }}</strong><div class="muted" style="font-size:12px;margin-top:2px"><i class="fas fa-compact-disc"></i> {{ tp.os }}</div></div>
              <button class="apple-btn apple-btn--secondary"><i class="fas fa-rocket"></i> {{ t('tpl_deploy') }}</button>
            </div>
            <div class="muted" style="font-size:13px;margin-bottom:12px">{{ tp.description }}</div>
            <div class="gpu-stats">
              <div class="gpu-stat"><div class="k">{{ t('tpl_spec') }}</div><div class="v">{{ tp.vcpus }} vCPU · {{ tp.mem_gb }}GB · {{ tp.disk_gb }}GB</div></div>
              <div class="gpu-stat"><div class="k">{{ t('tpl_usage') }}</div><div class="v">{{ tp.usage_count }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('tpl_updated') }}</div><div class="v" style="font-size:13px">{{ tp.updated_at }}</div></div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== isos：ISO 镜像 ===== -->
      <template v-else>
        <div class="toolbar">
          <span class="muted">{{ isos.length }} {{ t('iso_title') }}</span>
          <div class="spacer"></div>
          <button class="apple-btn apple-btn--primary"><i class="fas fa-upload"></i> {{ t('iso_upload') }}</button>
        </div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('name') }}</th><th>{{ t('iso_os_type') }}</th><th>{{ t('iso_size') }}</th><th>{{ t('iso_pool') }}</th><th>{{ t('iso_uploaded') }}</th><th>{{ t('iso_checksum') }}</th></tr></thead>
            <tbody>
              <tr v-for="iso in isos" :key="iso.id">
                <td class="mono"><i class="fas fa-compact-disc" style="color:var(--color-indigo)"></i> {{ iso.name }}</td>
                <td><span class="apple-badge">{{ iso.os_type }}</span></td>
                <td>{{ iso.size_gb }} GB</td>
                <td class="muted">{{ iso.pool }}</td>
                <td class="muted">{{ iso.uploaded_at }}</td>
                <td><i :class="iso.checksum_ok?'fas fa-circle-check':'fas fa-circle-xmark'" :style="{color:iso.checksum_ok?'var(--color-green)':'var(--color-red)'}"></i></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 右键菜单 + 操作回执 -->
      <VMContextMenu v-if="ctx.open" :vm="ctx.vm" :x="ctx.x" :y="ctx.y" @action="onCtxAction" @close="closeContext" />
      <div v-if="toast" class="cnf-toast"><i class="fas fa-circle-check"></i> {{ toast }}</div>
    </div>`,
}

window.__CNF_VIEWS.ComputeView = ComputeView
})()
