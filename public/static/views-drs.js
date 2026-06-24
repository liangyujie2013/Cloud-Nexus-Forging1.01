// CNFv1.0 DRS 迁移编排视图：拖拽虚拟机到目标主机发起 vMotion
(function () {
const { ref, reactive, onMounted, computed } = Vue
const api = window.api
const t = window.t

const DRSView = {
  setup() {
    const hosts = ref([])
    const vms = ref([])
    const dragVM = ref(null)        // 当前拖拽的 VM
    const dropTarget = ref(null)    // 当前悬停的主机 id
    const dropError = ref({})       // { hostId: errorKey } 悬停时的校验错误
    const migrating = reactive({ active: false, vm: '', from: '', to: '', progress: 0 })
    const toast = ref('')

    onMounted(async () => {
      hosts.value = await api('/hosts')
      vms.value = (await api('/vms')).map(v => ({ ...v }))
    })

    // 主机承载的 VM
    const vmsOf = (hostId) => vms.value.filter(v => v.host_id === hostId)
    const hostFreeMem = (h) => h.mem_total_gb - h.mem_used_gb

    // ---- 拖拽事件 ----
    const onDragStart = (vm, ev) => {
      dragVM.value = vm
      ev.dataTransfer.effectAllowed = 'move'
      ev.dataTransfer.setData('text/plain', vm.name)
    }
    const onDragEnd = () => { dragVM.value = null; dropTarget.value = null; dropError.value = {} }

    // 校验：能否迁移到目标主机，返回错误 key 或 null
    const validate = (vm, host) => {
      if (!vm) return null
      if (vm.host_id === host.id) return 'drs_same_host'
      if (vm.gpus > 0) return 'drs_cannot_gpu'           // GPU 直通不可在线迁移
      if (host.status !== 'connected') return 'drs_insufficient'
      if (hostFreeMem(host) < vm.mem_gb) return 'drs_insufficient'
      return null
    }

    const onDragOver = (host, ev) => {
      if (!dragVM.value) return
      const err = validate(dragVM.value, host)
      dropError.value = { [host.id]: err }
      if (!err) { ev.preventDefault(); dropTarget.value = host.id }  // 仅合法时允许放置
      else dropTarget.value = host.id
    }
    const onDragLeave = (host) => { if (dropTarget.value === host.id) { dropTarget.value = null } }

    const onDrop = (host, ev) => {
      ev.preventDefault()
      const vm = dragVM.value
      dropTarget.value = null
      if (!vm) return
      const err = validate(vm, host)
      if (err) { toast.value = '⚠ ' + t(err); setTimeout(() => toast.value = '', 3000); onDragEnd(); return }
      runMigration(vm, host)
      onDragEnd()
    }

    // ---- 模拟迁移动画 ----
    const runMigration = (vm, host) => {
      const fromHost = hosts.value.find(h => h.id === vm.host_id)
      migrating.active = true; migrating.vm = vm.name
      migrating.from = fromHost ? fromHost.name : '-'; migrating.to = host.name; migrating.progress = 0
      const timer = setInterval(() => {
        migrating.progress += Math.round(8 + Math.random() * 14)
        if (migrating.progress >= 100) {
          migrating.progress = 100
          clearInterval(timer)
          // 更新 VM 归属主机
          const target = vms.value.find(v => v.id === vm.id)
          if (target) target.host_id = host.id
          setTimeout(() => { migrating.active = false }, 700)
          toast.value = '✓ ' + vm.name + ' → ' + host.name
          setTimeout(() => toast.value = '', 3000)
        }
      }, 320)
    }

    // ---- DRS 建议（依据主机内存使用率不均衡度生成）----
    const recommendations = computed(() => {
      const connected = hosts.value.filter(h => h.status === 'connected')
      if (connected.length < 2) return []
      const usages = connected.map(h => ({ h, pct: h.mem_used_gb / h.mem_total_gb }))
      usages.sort((a, b) => b.pct - a.pct)
      const hi = usages[0], lo = usages[usages.length - 1]
      if (hi.pct - lo.pct < 0.18) return []   // 已均衡
      // 从最忙主机挑一台无 GPU 的可迁移 VM
      const movable = vmsOf(hi.h.id).find(v => v.gpus === 0 && v.status === 'running')
      if (!movable) return []
      return [{ vm: movable, from: hi.h, to: lo.h, gain: Math.round((hi.pct - lo.pct) * 100) }]
    })

    const applyRec = (rec) => runMigration(rec.vm, rec.to)
    const memPct = (h) => Math.round(h.mem_used_gb / h.mem_total_gb * 100)

    return {
      hosts, vms, vmsOf, hostFreeMem, memPct,
      dragVM, dropTarget, dropError,
      onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
      migrating, toast, recommendations, applyRec, t,
    }
  },
  template: `
    <div>
      <div class="apple-alert" style="margin-bottom:14px;background:rgba(0,122,255,.06);border-color:rgba(0,122,255,.2)">
        <i class="fas fa-hand-pointer" style="color:var(--color-blue)"></i> {{ t('drs_hint') }}
      </div>
      <div v-if="toast" class="apple-alert" :class="toast.startsWith('✓')?'apple-alert--success':'apple-alert--warning'" style="margin-bottom:14px">
        <i class="fas" :class="toast.startsWith('✓')?'fa-circle-check':'fa-triangle-exclamation'"></i> {{ toast.slice(2) }}
      </div>

      <!-- DRS 建议条 -->
      <div class="apple-card drs-rec" style="margin-bottom:16px">
        <div class="flex between">
          <div class="setting-title" style="font-size:15px"><i class="fas fa-wand-magic-sparkles" style="color:var(--color-purple)"></i> {{ t('drs_recommend') }}</div>
        </div>
        <div v-if="recommendations.length" style="margin-top:10px">
          <div class="flex between rec-item" v-for="(rec,i) in recommendations" :key="i">
            <div class="flex" style="gap:8px">
              <i class="fas fa-desktop" style="color:var(--color-blue)"></i>
              <strong>{{ rec.vm.name }}</strong>
              <span class="muted">{{ rec.from.name }}</span>
              <i class="fas fa-arrow-right-long muted"></i>
              <span style="color:var(--color-green)">{{ rec.to.name }}</span>
              <span class="apple-badge apple-badge--warning"><span class="dot"></span>-{{ rec.gain }}% 不均衡</span>
            </div>
            <button class="apple-btn apple-btn--primary apple-btn--sm" @click="applyRec(rec)"><i class="fas fa-bolt"></i> {{ t('drs_apply_rec') }}</button>
          </div>
        </div>
        <div v-else class="muted" style="margin-top:8px"><i class="fas fa-circle-check" style="color:var(--color-green)"></i> {{ t('drs_balanced') }}</div>
      </div>

      <!-- 迁移进行中浮层 -->
      <div v-if="migrating.active" class="apple-card mig-banner" style="margin-bottom:16px">
        <div class="flex between" style="margin-bottom:8px">
          <span><i class="fas fa-spinner fa-spin" style="color:var(--color-blue)"></i> {{ t('drs_migrating') }}: <strong>{{ migrating.vm }}</strong> · {{ migrating.from }} <i class="fas fa-arrow-right-long muted"></i> {{ migrating.to }}</span>
          <span class="mono">{{ migrating.progress }}%</span>
        </div>
        <div class="usage-bar" style="height:8px"><div class="fill" :style="{width:migrating.progress+'%',background:'var(--color-blue)',transition:'width .3s'}"></div></div>
      </div>

      <!-- 主机网格（拖放目标）-->
      <div class="grid grid-3 drs-grid">
        <div class="apple-card host-pool" v-for="h in hosts" :key="h.id"
             :class="{
               'drop-ok': dropTarget===h.id && !dropError[h.id],
               'drop-bad': dropTarget===h.id && dropError[h.id],
               'host-offline': h.status!=='connected'
             }"
             @dragover="onDragOver(h,$event)" @dragleave="onDragLeave(h)" @drop="onDrop(h,$event)">
          <div class="flex between" style="margin-bottom:10px">
            <div class="flex" style="gap:8px">
              <i class="fas fa-server" :style="{color: h.status==='connected'?'var(--color-green)':'var(--color-orange)'}"></i>
              <strong>{{ h.name }}</strong>
            </div>
            <span class="muted mono" style="font-size:12px">{{ h.ip }}</span>
          </div>
          <div class="flex between" style="font-size:12px;margin-bottom:4px">
            <span class="muted">{{ t('drs_capacity') }}</span>
            <span class="mono">{{ h.mem_used_gb }} / {{ h.mem_total_gb }} GB · {{ vmsOf(h.id).length }} {{ t('drs_vms_on') }}</span>
          </div>
          <div class="usage-bar" style="margin-bottom:12px"><div class="fill" :style="{width:memPct(h)+'%',background: memPct(h)>80?'var(--color-red)':memPct(h)>60?'var(--color-orange)':'var(--color-green)'}"></div></div>

          <!-- VM 卡片（可拖拽）-->
          <div class="vm-pool">
            <div class="vm-chip" v-for="v in vmsOf(h.id)" :key="v.id"
                 :draggable="true" @dragstart="onDragStart(v,$event)" @dragend="onDragEnd"
                 :class="{dragging: dragVM && dragVM.id===v.id, 'has-gpu': v.gpus>0}">
              <i class="fas" :class="v.status==='running'?'fa-circle-play':'fa-circle-stop'"
                 :style="{color: v.status==='running'?'var(--color-green)':'var(--color-gray)',fontSize:'10px'}"></i>
              <span style="flex:1">{{ v.name }}</span>
              <span class="muted" style="font-size:11px">{{ v.mem_gb }}G</span>
              <i v-if="v.gpus>0" class="fas fa-microchip" style="color:#76b900;font-size:11px" title="GPU passthrough"></i>
              <i class="fas fa-grip-vertical drag-handle"></i>
            </div>
            <div v-if="!vmsOf(h.id).length" class="vm-empty muted">{{ t('drs_drop_here') }}</div>
          </div>

          <!-- 拖放提示遮罩 -->
          <div class="drop-hint" v-if="dropTarget===h.id">
            <i class="fas" :class="dropError[h.id]?'fa-ban':'fa-circle-down'"></i>
            <span>{{ dropError[h.id] ? t(dropError[h.id]) : t('drs_drop_here') }}</span>
          </div>
        </div>
      </div>
    </div>`,
}

window.__CNF_VIEWS.DRSView = DRSView
})()
