// =============================================================================
//  通用组件：虚拟机创建向导 (component-vm-wizard.js)
//  8 步：基本信息 → CPU 拓扑 → NUMA 亲和 → CPU 绑核 → 内存 → 磁盘&网络
//        → GPU 设备 → libvirt Domain XML 预览 & 创建。
//  XML 由后端 /api/v1/vms/preview-xml 真实生成（与生产 libvirt 逻辑一致）。
// =============================================================================
(function () {
const { ref, reactive, computed, watch } = Vue
const api = window.api

// ============================ VM 创建向导（8 步）============================
const VMWizard = {
  emits: ['close'],
  setup(props, { emit }) {
    const t = window.t
    const step = ref(0)
    const steps = computed(() => [t('wiz_s1'), t('wiz_s2'), t('wiz_s3'), t('wiz_s4'), t('wiz_s5'), t('wiz_s6'), t('wiz_s7'), t('wiz_s8')])
    const hosts = ref([])
    const gpus = ref([])
    const xml = ref('')
    const creating = ref(false)
    const result = ref(null)

    // 表单模型（默认值）
    const f = reactive({
      name: 'new-vm-01',
      description: '',
      host_id: 5,
      cpu_sockets: 2,
      cpu_cores_per_socket: 4,
      cpu_threads_per_core: 2,
      cpu_model: 'host-passthrough',
      cpu_pinning: true,
      cpu_pinned_cpus: [],
      cpu_pinned_map: [],
      numa_node_affinity: 0,
      memory_mb: 16384,
      hugepages_enabled: true,
      boot_mode: 'uefi',
      machine_type: 'q35',
      arch: 'x86_64',
      disks: [{ device: 'vda', bus: 'virtio', format: 'qcow2', path: '/data/new-vm-01.qcow2', size_gb: 80, iops_limit: 5000 }],
      nics: [{ mac: '52:54:00:a1:b2:c3', model: 'virtio', bridge: 'ovsbr0', vlan: 100 }],
      gpus: [],
    })

    const vcpus = computed(() => f.cpu_sockets * f.cpu_cores_per_socket * f.cpu_threads_per_core)
    // 模拟主机有 128 个逻辑核，NUMA0=0-63, NUMA1=64-127
    const hostCPUs = computed(() => Array.from({ length: 128 }, (_, i) => i))
    const numaOf = (cpu) => cpu < 64 ? 0 : 1

    Vue.onMounted(async () => {
      hosts.value = await api('/hosts')
      gpus.value = (await api('/gpus')).filter(g => g.status === 'available' || g.host_id === f.host_id)
    })

    const togglePin = (cpu) => {
      const i = f.cpu_pinned_cpus.indexOf(cpu)
      if (i >= 0) f.cpu_pinned_cpus.splice(i, 1)
      else if (f.cpu_pinned_cpus.length < vcpus.value) f.cpu_pinned_cpus.push(cpu)
      // 自动生成映射
      f.cpu_pinned_map = f.cpu_pinned_cpus.map((pc, idx) => ({ vcpu: idx, pcpu: pc }))
    }
    const autoPin = () => {
      // 自动从所选 NUMA 节点连续分配
      const base = f.numa_node_affinity === 1 ? 64 : 0
      f.cpu_pinned_cpus = Array.from({ length: vcpus.value }, (_, i) => base + i)
      f.cpu_pinned_map = f.cpu_pinned_cpus.map((pc, idx) => ({ vcpu: idx, pcpu: pc }))
    }

    const toggleGPU = (g) => {
      const i = f.gpus.findIndex(x => x.pci_address === g.pci)
      if (i >= 0) f.gpus.splice(i, 1)
      else f.gpus.push({ pci_address: g.pci, mode: g.mode, model: g.model })
    }
    const gpuSelected = (g) => f.gpus.some(x => x.pci_address === g.pci)

    const refreshXML = async () => {
      const res = await api('/vms/preview-xml', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      xml.value = res.xml || ('错误: ' + res.error)
    }
    watch(step, (s) => { if (s === 7) refreshXML() })

    const next = () => { if (step.value < steps.value.length - 1) step.value++ }
    const prev = () => { if (step.value > 0) step.value-- }

    const create = async () => {
      creating.value = true
      result.value = await api('/vms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      creating.value = false
    }

    return { step, steps, f, vcpus, hosts, gpus, hostCPUs, numaOf, togglePin, autoPin,
             toggleGPU, gpuSelected, xml, refreshXML, next, prev, create, creating, result, emit,
             t: window.t, i18n: window.i18n }
  },
  template: `
  <div class="apple-modal-backdrop" @click.self="emit('close')">
    <div class="apple-modal" style="width:860px">
      <div style="padding:24px 28px;border-bottom:1px solid var(--separator)" class="flex between">
        <strong style="font-size:20px"><i class="fas fa-wand-magic-sparkles" style="color:var(--color-blue)"></i> {{ t('wiz_title') }}</strong>
        <button class="apple-btn apple-btn--ghost" @click="emit('close')"><i class="fas fa-xmark"></i></button>
      </div>
      <div style="padding:24px 28px">
        <div class="wizard-steps">
          <div v-for="(s,i) in steps" :key="i" class="wizard-step" :class="{active:i===step,done:i<step}">
            <span class="num"><i v-if="i<step" class="fas fa-check"></i><template v-else>{{ i+1 }}</template></span>{{ s }}
          </div>
        </div>

        <!-- 步骤1 基本信息 -->
        <div v-show="step===0">
          <div class="form-grid">
            <div class="form-row"><label>{{ t('wiz_vm_name') }}</label><input class="apple-input" v-model="f.name"></div>
            <div class="form-row"><label>{{ t('wiz_target_host') }}</label>
              <select class="apple-select" v-model="f.host_id"><option v-for="h in hosts" :value="h.id">{{ h.name }} ({{ h.cpu_model }})</option></select>
            </div>
          </div>
          <div class="form-row"><label>{{ t('description') }}</label><input class="apple-input" v-model="f.description" :placeholder="t('wiz_optional')"></div>
          <div class="form-grid">
            <div class="form-row"><label>{{ t('wiz_arch') }}</label><select class="apple-select" v-model="f.arch"><option>x86_64</option><option>aarch64</option></select></div>
            <div class="form-row"><label>{{ t('wiz_machine') }}</label><select class="apple-select" v-model="f.machine_type"><option>q35</option><option>pc-i440fx</option></select></div>
          </div>
        </div>

        <!-- 步骤2 CPU 拓扑 -->
        <div v-show="step===1">
          <div class="form-grid">
            <div class="form-row"><label>{{ t('wiz_sockets') }}</label><input type="number" min="1" class="apple-input" v-model.number="f.cpu_sockets"></div>
            <div class="form-row"><label>{{ t('wiz_cores') }}</label><input type="number" min="1" class="apple-input" v-model.number="f.cpu_cores_per_socket"></div>
            <div class="form-row"><label>{{ t('wiz_threads') }}</label><input type="number" min="1" max="2" class="apple-input" v-model.number="f.cpu_threads_per_core"></div>
            <div class="form-row"><label>{{ t('wiz_cpu_mode') }}</label><select class="apple-select" v-model="f.cpu_model"><option value="host-passthrough">host-passthrough</option><option value="host-model">host-model</option><option value="Cascadelake-Server">Cascadelake-Server</option></select></div>
          </div>
          <div class="apple-card apple-card--glass" style="margin-top:8px;text-align:center;padding:18px">
            <div class="muted">{{ t('wiz_total_vcpu') }}</div>
            <div style="font-size:36px;font-weight:700;color:var(--color-blue)">{{ vcpus }}</div>
            <div class="muted mono">{{ f.cpu_sockets }} sockets × {{ f.cpu_cores_per_socket }} cores × {{ f.cpu_threads_per_core }} threads</div>
          </div>
        </div>

        <!-- 步骤3 NUMA 亲和 -->
        <div v-show="step===2">
          <div class="form-hint" style="margin-bottom:14px"><i class="fas fa-circle-info"></i> {{ t('wiz_numa_hint') }}</div>
          <div class="grid grid-2">
            <div class="numa-box" :class="{selected:f.numa_node_affinity===-1}" @click="f.numa_node_affinity=-1">
              <div class="nh">{{ t('wiz_no_numa') }}<i v-if="f.numa_node_affinity===-1" class="fas fa-check-circle" style="color:var(--color-blue)"></i></div>
              <div class="muted" style="font-size:12px">{{ t('wiz_no_numa_desc') }}</div>
            </div>
            <div class="numa-box" :class="{selected:f.numa_node_affinity===0}" @click="f.numa_node_affinity=0">
              <div class="nh">{{ t('wiz_numa_node') }} 0<i v-if="f.numa_node_affinity===0" class="fas fa-check-circle" style="color:var(--color-blue)"></i></div>
              <div class="muted" style="font-size:12px">{{ t('wiz_numa0_desc') }}</div>
            </div>
            <div class="numa-box" :class="{selected:f.numa_node_affinity===1}" @click="f.numa_node_affinity=1">
              <div class="nh">{{ t('wiz_numa_node') }} 1<i v-if="f.numa_node_affinity===1" class="fas fa-check-circle" style="color:var(--color-blue)"></i></div>
              <div class="muted" style="font-size:12px">{{ t('wiz_numa1_desc') }}</div>
            </div>
          </div>
        </div>

        <!-- 步骤4 CPU 绑核 -->
        <div v-show="step===3">
          <div class="flex between" style="margin-bottom:12px">
            <label class="flex" style="gap:10px"><span class="apple-toggle"><input type="checkbox" v-model="f.cpu_pinning"><span class="track"><span class="thumb"></span></span></span> {{ t('wiz_enable_pin') }}</label>
            <button class="apple-btn apple-btn--secondary" :disabled="!f.cpu_pinning" @click="autoPin"><i class="fas fa-bolt"></i> {{ t('wiz_auto_pin') }}</button>
          </div>
          <div v-if="f.cpu_pinning">
            <div class="form-hint">{{ t('wiz_selected') }} {{ f.cpu_pinned_cpus.length }} / {{ vcpus }} · {{ t('wiz_pin_hint') }}</div>
            <div class="cpu-viz">
              <div v-for="cpu in hostCPUs" :key="cpu" class="cpu-core"
                   :class="{pinned:f.cpu_pinned_cpus.includes(cpu), numa1:numaOf(cpu)===1}"
                   @click="togglePin(cpu)">{{ cpu }}</div>
            </div>
          </div>
          <div v-else class="muted" style="padding:20px;text-align:center">{{ t('wiz_no_pin') }}</div>
        </div>

        <!-- 步骤5 内存 -->
        <div v-show="step===4">
          <div class="form-row"><label>{{ t('wiz_mem_mb') }}</label><input type="number" step="1024" class="apple-input" v-model.number="f.memory_mb"><div class="form-hint">{{ (f.memory_mb/1024).toFixed(1) }} GB</div></div>
          <label class="flex" style="gap:10px;margin-top:10px"><span class="apple-toggle"><input type="checkbox" v-model="f.hugepages_enabled"><span class="track"><span class="thumb"></span></span></span> {{ t('wiz_hugepages') }}</label>
        </div>

        <!-- 步骤6 磁盘&网络 -->
        <div v-show="step===5">
          <div class="section-title" style="margin-top:0;font-size:15px"><i class="fas fa-hard-drive"></i> {{ t('wiz_disk') }}</div>
          <div class="form-grid">
            <div class="form-row"><label>{{ t('wiz_disk_size') }}</label><input type="number" class="apple-input" v-model.number="f.disks[0].size_gb"></div>
            <div class="form-row"><label>{{ t('wiz_disk_bus') }}</label><select class="apple-select" v-model="f.disks[0].bus"><option>virtio</option><option>scsi</option><option>nvme</option></select></div>
            <div class="form-row"><label>{{ t('wiz_disk_format') }}</label><select class="apple-select" v-model="f.disks[0].format"><option>qcow2</option><option>raw</option></select></div>
            <div class="form-row"><label>{{ t('wiz_iops') }}</label><input type="number" class="apple-input" v-model.number="f.disks[0].iops_limit"></div>
          </div>
          <div class="section-title" style="font-size:15px"><i class="fas fa-network-wired"></i> {{ t('wiz_nic') }}</div>
          <div class="form-grid">
            <div class="form-row"><label>{{ t('wiz_bridge') }}</label><input class="apple-input" v-model="f.nics[0].bridge"></div>
            <div class="form-row"><label>{{ t('wiz_vlan') }}</label><input type="number" class="apple-input" v-model.number="f.nics[0].vlan"></div>
            <div class="form-row"><label>{{ t('wiz_mac') }}</label><input class="apple-input mono" v-model="f.nics[0].mac"></div>
            <div class="form-row"><label>{{ t('wiz_model') }}</label><select class="apple-select" v-model="f.nics[0].model"><option>virtio</option><option>e1000e</option></select></div>
          </div>
        </div>

        <!-- 步骤7 GPU -->
        <div v-show="step===6">
          <div class="form-hint" style="margin-bottom:12px"><i class="fas fa-circle-info"></i> {{ t('wiz_gpu_hint') }}</div>
          <div class="grid grid-2">
            <div class="numa-box" v-for="g in gpus" :key="g.id" :class="{selected:gpuSelected(g)}" @click="toggleGPU(g)">
              <div class="nh"><span><i class="fas fa-microchip" style="color:#76b900"></i> {{ g.model }}</span><i v-if="gpuSelected(g)" class="fas fa-check-circle" style="color:var(--color-blue)"></i></div>
              <div class="muted" style="font-size:12px">{{ g.host }} · {{ g.pci }} · {{ (g.vram_mb/1024).toFixed(0) }}GB · {{ g.mode==='vgpu'?t('gpu_vgpu'):t('gpu_passthrough') }} · NUMA{{ g.numa }}</div>
            </div>
          </div>
          <div v-if="!gpus.length" class="muted" style="padding:20px;text-align:center">{{ t('wiz_no_gpu') }}</div>
        </div>

        <!-- 步骤8 预览 -->
        <div v-show="step===7">
          <div v-if="!result">
            <div class="flex between" style="margin-bottom:10px"><strong>{{ t('wiz_xml_preview') }}</strong><button class="apple-btn apple-btn--secondary" @click="refreshXML"><i class="fas fa-rotate"></i> {{ t('wiz_refresh') }}</button></div>
            <pre class="xml-preview">{{ xml }}</pre>
            <div class="form-hint"><i class="fas fa-circle-check" style="color:var(--color-green)"></i> {{ t('wiz_xml_hint') }}</div>
          </div>
          <div v-else class="apple-card apple-card--glass" style="text-align:center;padding:40px">
            <i class="fas fa-circle-check" style="font-size:48px;color:var(--color-green)"></i>
            <div style="font-size:20px;font-weight:700;margin:14px 0 6px">{{ result.message }}</div>
            <div class="muted">VM「{{ result.name }}」{{ t('wiz_vm_status') }}：{{ result.status }}</div>
          </div>
        </div>
      </div>

      <div style="padding:18px 28px;border-top:1px solid var(--separator)" class="flex between">
        <button class="apple-btn apple-btn--secondary" @click="prev" :disabled="step===0"><i class="fas fa-chevron-left"></i> {{ t('wiz_prev') }}</button>
        <span class="muted">{{ t('wiz_step') }} {{ step+1 }} / {{ steps.length }}</span>
        <button v-if="step<steps.length-1" class="apple-btn apple-btn--primary" @click="next">{{ t('wiz_next') }} <i class="fas fa-chevron-right"></i></button>
        <button v-else-if="!result" class="apple-btn apple-btn--primary" @click="create" :disabled="creating"><i class="fas fa-rocket"></i> {{ creating?t('wiz_creating'):t('wiz_create') }}</button>
        <button v-else class="apple-btn apple-btn--primary" @click="emit('close')">{{ t('wiz_finish') }}</button>
      </div>
    </div>
  </div>`,
}

window.__CNF_VIEWS.VMWizard = VMWizard
})()
