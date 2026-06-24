// =============================================================================
//  模块视图：存储管理 (view-storage.js)
//  子标签：pools 存储池 / volumes 卷管理 / snapshots 快照树。
//  API：/storage-pools、/volumes、/snapshots、/vms。
// =============================================================================
(function () {
const { ref, reactive, computed, onMounted, watch } = Vue
const api = window.api
const t = window.t

const StorageView = {
  props: { tab: { type: String, default: 'pools' } },
  setup(props) {
    const pools = ref([])
    const volumes = ref([])
    const snaps = ref([])
    const vms = ref([])
    const form = reactive({ vm: '', name: '', description: '', with_memory: false, quiesce: true })
    const creating = ref(false)
    const toast = ref('')

    const typeColor = { local: 'var(--color-green)', nfs: 'var(--color-blue)', iscsi: 'var(--color-indigo)', fc: 'var(--color-purple)' }

    const load = async () => {
      if (props.tab === 'pools' && !pools.value.length) pools.value = await api('/storage-pools')
      if (props.tab === 'volumes' && !volumes.value.length) volumes.value = await api('/volumes')
      if (props.tab === 'snapshots') {
        if (!snaps.value.length) snaps.value = await api('/snapshots')
        if (!vms.value.length) { vms.value = await api('/vms'); if (vms.value.length) form.vm = vms.value[0].name }
      }
    }
    onMounted(load)
    watch(() => props.tab, load)

    const grouped = computed(() => {
      const m = {}
      snaps.value.forEach((s) => { (m[s.vm] = m[s.vm] || []).push(s) })
      return Object.entries(m).map(([vm, list]) => ({ vm, list }))
    })
    const createSnap = async () => {
      if (!form.name) return
      creating.value = true
      const r = await api('/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      creating.value = false; toast.value = r.message
      snaps.value.push({ id: r.id, vm: form.vm, name: form.name, description: form.description, with_memory: form.with_memory, quiesce: form.quiesce, size_gb: form.with_memory ? 64 : 4, parent: null, created_at: new Date().toISOString().slice(0, 16).replace('T', ' '), current: true })
      form.name = ''; form.description = ''
      setTimeout(() => (toast.value = ''), 3500)
    }

    return { props, pools, volumes, vms, form, grouped, createSnap, creating, toast, typeColor, t }
  },
  template: `
    <div>
      <div v-if="toast" class="apple-alert apple-alert--success" style="margin-bottom:14px"><i class="fas fa-circle-check"></i> {{ toast }}</div>

      <!-- ===== pools：存储池 ===== -->
      <template v-if="props.tab==='pools'">
        <div class="grid grid-2">
          <div class="apple-card" v-for="p in pools" :key="p.id">
            <div class="flex between" style="margin-bottom:14px">
              <div><strong>{{ p.name }}</strong><div class="muted" style="font-size:12px;margin-top:2px">{{ p.shared?t('st_shared'):t('st_local') }}</div></div>
              <span class="apple-badge" :style="{background:'rgba(0,0,0,0.04)',color:typeColor[p.type]}">{{ p.type.toUpperCase() }}</span>
            </div>
            <div class="flex between" style="margin-bottom:6px"><span class="muted">{{ t('st_capacity') }}</span><span class="mono">{{ p.used_tb }} / {{ p.capacity_tb }} TB</span></div>
            <div class="usage-bar"><div class="fill" :style="{width:(p.used_tb/p.capacity_tb*100)+'%',background:typeColor[p.type]}"></div></div>
            <div class="gpu-stats" style="margin-top:14px">
              <div class="gpu-stat"><div class="k">{{ t('st_read_iops') }}</div><div class="v">{{ p.read_iops.toLocaleString() }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('st_write_iops') }}</div><div class="v">{{ p.write_iops.toLocaleString() }}</div></div>
              <div class="gpu-stat"><div class="k">{{ t('st_latency') }}</div><div class="v">{{ p.latency }} ms</div></div>
              <div class="gpu-stat"><div class="k">{{ t('status') }}</div><div class="v" style="color:var(--color-green);font-size:14px">● {{ t('st_active') }}</div></div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== volumes：卷管理 ===== -->
      <template v-else-if="props.tab==='volumes'">
        <div class="toolbar"><span class="muted">{{ volumes.length }} {{ t('vol_title') }}</span><div class="spacer"></div><button class="apple-btn apple-btn--primary"><i class="fas fa-plus"></i> {{ t('vol_add') }}</button></div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('vol_name') }}</th><th>{{ t('vol_pool') }}</th><th>{{ t('vol_vm') }}</th><th>{{ t('vol_format') }}</th><th>{{ t('vol_size') }}</th><th>{{ t('vol_used') }}</th><th>{{ t('vol_bus') }}</th><th>{{ t('vol_iops') }}</th></tr></thead>
            <tbody>
              <tr v-for="v in volumes" :key="v.id">
                <td class="mono"><i class="fas fa-hard-drive" style="color:var(--color-indigo)"></i> {{ v.name }}</td>
                <td class="muted">{{ v.pool }}</td>
                <td>{{ v.vm }}</td>
                <td><span class="apple-badge">{{ v.format }}</span></td>
                <td>{{ v.size_gb }} GB</td>
                <td style="width:120px"><div class="usage-bar"><div class="fill" :style="{width:(v.used_gb/v.size_gb*100)+'%',background:'var(--color-blue)'}"></div></div><div class="muted mono" style="font-size:11px;margin-top:2px">{{ v.used_gb }} GB</div></td>
                <td class="mono">{{ v.bus }}</td>
                <td class="mono">{{ v.iops_limit===0 ? t('vol_unlimited') : v.iops_limit.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== snapshots：快照树 ===== -->
      <template v-else>
        <div class="grid grid-2">
          <div class="apple-card">
            <h3 style="margin:0 0 16px"><i class="fas fa-camera" style="color:var(--color-purple)"></i> {{ t('snap_create_title') }}</h3>
            <div class="form-row"><label>{{ t('snap_vm') }}</label><select class="apple-input" v-model="form.vm"><option v-for="v in vms" :key="v.id" :value="v.name">{{ v.name }} ({{ {running:t('st_running'),paused:t('st_paused'),stopped:t('st_stopped')}[v.status] }})</option></select></div>
            <div class="form-row"><label>{{ t('snap_name') }}</label><input class="apple-input" v-model="form.name" :placeholder="t('snap_name_ph')"></div>
            <div class="form-row"><label>{{ t('snap_desc') }}</label><input class="apple-input" v-model="form.description" :placeholder="t('snap_desc_ph')"></div>
            <div class="flex" style="gap:18px;margin:14px 0;flex-wrap:wrap">
              <label class="switch-row"><input type="checkbox" v-model="form.with_memory"> {{ t('snap_mem_label') }}</label>
              <label class="switch-row"><input type="checkbox" v-model="form.quiesce"> {{ t('snap_quiesce_label') }}</label>
            </div>
            <div class="apple-alert" style="margin:12px 0;background:rgba(0,122,255,.06);border-color:rgba(0,122,255,.2)"><i class="fas fa-info-circle" style="color:var(--color-blue)"></i> {{ t('snap_info') }}</div>
            <button class="apple-btn apple-btn--primary" :disabled="creating || !form.name" @click="createSnap"><i class="fas fa-camera"></i> {{ creating ? t('snap_creating') : t('snap_create') }}</button>
          </div>
          <div class="apple-card">
            <h3 style="margin:0 0 12px"><i class="fas fa-code-branch" style="color:var(--color-indigo)"></i> {{ t('snap_chain_title') }}</h3>
            <div v-for="g in grouped" :key="g.vm" style="margin-bottom:18px">
              <div style="font-weight:600;margin-bottom:8px"><i class="fas fa-desktop muted"></i> {{ g.vm }}</div>
              <div class="snap-chain">
                <div class="snap-node" v-for="s in g.list" :key="s.id" :class="{current:s.current}">
                  <div class="flex between"><strong>{{ s.name }}</strong><span v-if="s.current" class="apple-badge apple-badge--running"><span class="dot"></span>{{ t('snap_current') }}</span></div>
                  <div class="muted" style="font-size:12px;margin:2px 0">{{ s.description }}</div>
                  <div class="flex" style="gap:6px;flex-wrap:wrap;margin-top:4px">
                    <span class="apple-badge" :class="s.with_memory?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ s.with_memory?t('snap_mem_nvram'):t('snap_disk_only') }}</span>
                    <span v-if="s.quiesce" class="apple-badge apple-badge--warning"><span class="dot"></span>{{ t('snap_quiesced2') }}</span>
                    <span class="mono muted" style="font-size:12px">{{ s.size_gb }}GB · {{ s.created_at }}</span>
                  </div>
                  <div class="flex" style="gap:8px;margin-top:8px">
                    <button class="apple-btn apple-btn--ghost apple-btn--sm" :disabled="s.current"><i class="fas fa-rotate-left"></i> {{ t('snap_rollback') }}</button>
                    <button class="apple-btn apple-btn--ghost apple-btn--sm"><i class="fas fa-trash"></i> {{ t('delete') }}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.StorageView = StorageView
})()
