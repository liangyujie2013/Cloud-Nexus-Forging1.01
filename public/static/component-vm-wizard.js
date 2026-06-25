// =============================================================================
//  通用组件：虚拟机创建向导 (component-vm-wizard.js) — 企业级重构 (P5/P6/P7/P8)
//  7 步：① 操作系统 & 名称（GuestOS 选择 + 固件/机器类型自动推导）
//        ② 放置位置（数据中心 → 集群 → 宿主机 + 资源容量校验）
//        ③ CPU & 内存（默认仅 vCPU 数；高级可展开 Socket×Core×Thread）
//        ④ NUMA & 绑核（NUMA 节点选择 + 自动绑核，参考 SmartX CloudTower，废弃 128 格子）
//        ⑤ 磁盘 & 网络（含 multiqueue 网卡队列）
//        ⑥ GPU 设备（仅当目标主机有可用 GPU 且已启用 IOMMU）
//        ⑦ libvirt Domain XML 预览 & 创建
//  XML 由后端 /api/v1/vms/preview-xml 真实生成。
// =============================================================================
(function () {
const { ref, reactive, computed, watch } = Vue
const api = window.api

// -------- KVM 支持的客户机操作系统目录（含固件/机器类型/默认网卡模型推导）--------
//  实际生产可由后端 /api/v1/guest-os-catalog 返回 osinfo-db；此处内置主流条目。
const GUEST_OS_CATALOG = [
  { id: 'rocky9',  name: 'Rocky Linux 9',       family: 'linux',   firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'rocky8',  name: 'Rocky Linux 8',       family: 'linux',   firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'rhel10',  name: 'RHEL 10',             family: 'linux',   firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'rhel9',   name: 'RHEL 9',              family: 'linux',   firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'rhel8',   name: 'RHEL 8',              family: 'linux',   firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'ubuntu2204', name: 'Ubuntu 22.04 LTS', family: 'linux',   firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'ubuntu2004', name: 'Ubuntu 20.04 LTS', family: 'linux',   firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'centos9', name: 'CentOS Stream 9',     family: 'linux',   firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'debian12',name: 'Debian 12',           family: 'linux',   firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'win2022', name: 'Windows Server 2022', family: 'windows', firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'win2019', name: 'Windows Server 2019', family: 'windows', firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'win11',   name: 'Windows 11',          family: 'windows', firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'win10',   name: 'Windows 10',          family: 'windows', firmware: 'uefi', machine: 'q35',       nic: 'virtio', disk: 'virtio' },
  { id: 'win2008', name: 'Windows Server 2008', family: 'windows', firmware: 'bios', machine: 'pc-i440fx', nic: 'e1000e', disk: 'sata' },
  { id: 'other',   name: 'Other / Generic',     family: 'linux',   firmware: 'bios', machine: 'pc-i440fx', nic: 'virtio', disk: 'virtio' },
]

const VMWizard = {
  emits: ['close'],
  setup(props, { emit }) {
    const t = window.t
    const step = ref(0)
    const steps = computed(() => [t('wiz_ns1'), t('wiz_ns2'), t('wiz_ns3'), t('wiz_ns4'), t('wiz_ns5'), t('wiz_ns6'), t('wiz_ns7')])

    const datacenters = ref([])
    const clusters = ref([])
    const hosts = ref([])
    const gpus = ref([])
    const xml = ref('')
    const creating = ref(false)
    const result = ref(null)
    const showAdvOS = ref(false)
    const showAdvCPU = ref(false)
    const errors = reactive({})

    // 表单模型（默认值）
    const f = reactive({
      name: 'new-vm-01',
      description: '',
      os_id: 'rocky9',
      os: 'Rocky Linux 9',
      boot_mode: 'uefi',
      machine_type: 'q35',
      arch: 'x86_64',
      // 放置位置（P5）
      datacenter_id: null,
      cluster_id: null,
      host_id: null,
      // CPU / 内存（P6 默认仅 vcpus）
      vcpus: 4,
      cpu_sockets: 1,
      cpu_cores_per_socket: 4,
      cpu_threads_per_core: 1,
      cpu_model: 'host-passthrough',
      memory_mb: 8192,
      hugepages_enabled: true,
      // NUMA & 绑核（P6）
      numa_node_affinity: -1,
      cpu_pinning: false,
      cpu_pinned_cpus: [],
      cpu_pinned_map: [],
      // 磁盘 & 网络（P8 含 queues）
      disks: [{ device: 'vda', bus: 'virtio', format: 'qcow2', path: '/data/new-vm-01.qcow2', size_gb: 80, iops_limit: 5000 }],
      nics: [{ mac: '52:54:00:a1:b2:c3', model: 'virtio', bridge: 'ovsbr0', vlan: 100, queues: 1 }],
      gpus: [],
    })

    // ---- GuestOS 联动：选择 OS → 自动推导固件 / 机器类型 / 网卡 / 磁盘总线（P7/P5）----
    const currentOS = computed(() => GUEST_OS_CATALOG.find((o) => o.id === f.os_id) || GUEST_OS_CATALOG[0])
    const linuxOS = computed(() => GUEST_OS_CATALOG.filter((o) => o.family === 'linux'))
    const windowsOS = computed(() => GUEST_OS_CATALOG.filter((o) => o.family === 'windows'))
    watch(() => f.os_id, () => {
      const o = currentOS.value
      f.os = o.name
      if (!showAdvOS.value) { f.boot_mode = o.firmware; f.machine_type = o.machine }
      f.nics[0].model = o.nic
      f.disks[0].bus = o.disk
    })

    // ---- 放置位置级联（P5）----
    const clustersInDc = computed(() => clusters.value.filter((c) => c.datacenter_id === f.datacenter_id))
    const hostsInCluster = computed(() => hosts.value.filter((h) => h.cluster_id === f.cluster_id))
    const selectedHost = computed(() => hosts.value.find((h) => h.id === f.host_id) || null)

    watch(() => f.datacenter_id, () => { f.cluster_id = null; f.host_id = null })
    watch(() => f.cluster_id, () => { f.host_id = null })

    // 目标主机可用容量（空闲 vCPU / 空闲内存），并据此判定能否放置
    const hostCapacity = computed(() => {
      const h = selectedHost.value
      if (!h) return null
      const usedV = (h.vms_list || []).reduce((s, v) => s + (v.vcpus || 0), 0)
      const usedM = (h.vms_list || []).reduce((s, v) => s + (v.mem_gb || 0), 0)
      const freeV = Math.max(0, h.vcpus - usedV)
      const freeM = Math.max(0, h.mem_total_gb - usedM)
      const needV = f.vcpus
      const needM = Math.round(f.memory_mb / 1024)
      let level = 'ok'
      if (needV > freeV || needM > freeM) level = 'insufficient'
      else if (needV > freeV * 0.85 || needM > freeM * 0.85) level = 'warn'
      return { freeV, freeM, totalV: h.vcpus, totalM: h.mem_total_gb, needV, needM, level, online: h.status === 'connected', numa_nodes: h.numa_nodes || 2, iommu: !!h.iommu }
    })

    // vCPU 总数（拓扑高级模式由 socket×core×thread 计算，否则直接用 f.vcpus）
    const vcpus = computed(() => showAdvCPU.value ? (f.cpu_sockets * f.cpu_cores_per_socket * f.cpu_threads_per_core) : f.vcpus)
    watch(vcpus, (v) => { if (showAdvCPU.value) f.vcpus = v })

    // ---- NUMA 节点（来自目标主机；每节点核数 = 总vcpus/numa_nodes）----
    const numaNodes = computed(() => {
      const h = selectedHost.value
      if (!h) return []
      const n = h.numa_nodes || 2
      const coresPer = Math.floor(h.vcpus / n)
      const memPer = Math.round(h.mem_total_gb / n)
      return Array.from({ length: n }, (_, i) => ({ node: i, cores: coresPer, base: i * coresPer, mem_gb: memPer }))
    })

    // ---- 自动绑核（P6：从所选 NUMA 节点连续分配，不再手动点 128 格子）----
    const pinPreview = computed(() => {
      if (!f.cpu_pinning || f.numa_node_affinity < 0) return []
      const node = numaNodes.value.find((nn) => nn.node === f.numa_node_affinity)
      const base = node ? node.base : 0
      return Array.from({ length: vcpus.value }, (_, i) => ({ vcpu: i, pcpu: base + i }))
    })
    watch([() => f.cpu_pinning, () => f.numa_node_affinity, vcpus], () => {
      f.cpu_pinned_map = pinPreview.value
      f.cpu_pinned_cpus = pinPreview.value.map((p) => p.pcpu)
    })

    // ---- GPU（仅目标主机的可用 GPU；需 IOMMU）----
    const hostGpus = computed(() => gpus.value.filter((g) => g.host_id === f.host_id && (g.status === 'available' || (selectedHost.value && g.host === selectedHost.value.name))))
    const toggleGPU = (g) => {
      const i = f.gpus.findIndex((x) => x.pci_address === g.pci)
      if (i >= 0) f.gpus.splice(i, 1)
      else f.gpus.push({ pci_address: g.pci, mode: g.mode, model: g.model })
    }
    const gpuSelected = (g) => f.gpus.some((x) => x.pci_address === g.pci)

    Vue.onMounted(async () => {
      datacenters.value = await api('/datacenters')
      clusters.value = await api('/clusters')
      hosts.value = await api('/hosts')
      gpus.value = await api('/gpus')
      if (datacenters.value.length) f.datacenter_id = datacenters.value[0].id
    })

    // ---- 每步校验 ----
    const validateStep = (s) => {
      Object.keys(errors).forEach((k) => delete errors[k])
      if (s === 0) {
        if (!f.name || !f.name.trim()) errors.name = t('op_required')
      } else if (s === 1) {
        if (!f.datacenter_id) errors.datacenter_id = t('op_required')
        if (!f.cluster_id) errors.cluster_id = t('op_required')
        if (!f.host_id) errors.host_id = t('op_required')
        else if (hostCapacity.value && !hostCapacity.value.online) errors.host_id = t('wiz_host_offline_warn')
        else if (hostCapacity.value && hostCapacity.value.level === 'insufficient') errors.host_id = t('wiz_cap_insufficient')
      } else if (s === 3) {
        if (f.cpu_pinning && f.numa_node_affinity < 0) errors.pin = t('wiz_pin_need_numa')
      }
      return Object.keys(errors).length === 0
    }

    const refreshXML = async () => {
      const res = await api('/vms/preview-xml', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      xml.value = res.xml || ('错误: ' + res.error)
    }
    watch(step, (s) => { if (s === 6) refreshXML() })

    const next = () => { if (validateStep(step.value) && step.value < steps.value.length - 1) step.value++ }
    const prev = () => { if (step.value > 0) step.value-- }

    const create = async () => {
      creating.value = true
      result.value = await api('/vms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      creating.value = false
    }

    return {
      step, steps, f, errors, vcpus, datacenters, clusters, hosts, gpus,
      currentOS, linuxOS, windowsOS, showAdvOS, showAdvCPU,
      clustersInDc, hostsInCluster, selectedHost, hostCapacity, numaNodes, pinPreview,
      hostGpus, toggleGPU, gpuSelected,
      xml, refreshXML, next, prev, create, creating, result, emit,
      t: window.t, i18n: window.i18n,
    }
  },
  template: `
  <div class="apple-modal-backdrop" @click.self="emit('close')">
    <div class="apple-modal" style="width:880px">
      <div style="padding:24px 28px;border-bottom:1px solid var(--separator)" class="flex between">
        <strong style="font-size:20px"><i class="fas fa-wand-magic-sparkles" style="color:var(--color-blue)"></i> {{ t('wiz_title') }}</strong>
        <button class="apple-btn apple-btn--ghost" @click="emit('close')"><i class="fas fa-xmark"></i></button>
      </div>
      <div style="padding:24px 28px;max-height:64vh;overflow-y:auto">
        <div class="wizard-steps">
          <div v-for="(s,i) in steps" :key="i" class="wizard-step" :class="{active:i===step,done:i<step}">
            <span class="num"><i v-if="i<step" class="fas fa-check"></i><template v-else>{{ i+1 }}</template></span>{{ s }}
          </div>
        </div>

        <!-- ① 操作系统 & 名称 -->
        <div v-show="step===0">
          <div class="form-hint" style="margin-bottom:14px"><i class="fas fa-circle-info"></i> {{ t('wiz_guest_os_hint') }}</div>
          <div class="form-grid">
            <div class="form-row">
              <label class="req">{{ t('wiz_vm_name') }}</label>
              <input class="apple-input" :class="{invalid:errors.name}" v-model="f.name">
              <div v-if="errors.name" class="form-err">{{ errors.name }}</div>
            </div>
            <div class="form-row">
              <label class="req">{{ t('wiz_guest_os') }}</label>
              <select class="apple-select" v-model="f.os_id">
                <optgroup :label="t('wiz_os_family_linux')">
                  <option v-for="o in linuxOS" :key="o.id" :value="o.id">{{ o.name }}</option>
                </optgroup>
                <optgroup :label="t('wiz_os_family_windows')">
                  <option v-for="o in windowsOS" :key="o.id" :value="o.id">{{ o.name }}</option>
                </optgroup>
              </select>
            </div>
          </div>
          <div class="form-row"><label>{{ t('description') }}</label><input class="apple-input" v-model="f.description" :placeholder="t('wiz_optional')"></div>

          <!-- 自动推导的固件/机器类型（只读展示 + 高级覆盖）-->
          <div class="apple-alert apple-alert--success" style="margin-top:6px">
            <i class="fas fa-circle-check"></i>
            <div style="flex:1">
              <div>{{ t('wiz_fw_explain') }}</div>
              <div class="flex" style="gap:18px;margin-top:8px;font-size:13px;flex-wrap:wrap">
                <span><i class="fas fa-microchip"></i> {{ t('wiz_arch') }}: <strong class="mono">{{ f.arch }}</strong></span>
                <span><i class="fas fa-bolt"></i> {{ t('wiz_auto_fw') }}: <strong>{{ f.boot_mode==='uefi'?t('wiz_fw_uefi'):t('wiz_fw_bios') }}</strong></span>
                <span><i class="fas fa-server"></i> {{ t('wiz_auto_machine') }}: <strong>{{ f.machine_type==='q35'?t('wiz_machine_q35'):t('wiz_machine_i440fx') }}</strong></span>
              </div>
            </div>
          </div>
          <button class="link-btn" style="margin-top:10px" @click="showAdvOS=!showAdvOS"><i class="fas" :class="showAdvOS?'fa-chevron-up':'fa-chevron-down'"></i> {{ showAdvOS?t('wiz_hide_advanced'):t('wiz_show_advanced') }}</button>
          <div v-if="showAdvOS" class="form-grid" style="margin-top:10px">
            <div class="form-row"><label>{{ t('wiz_arch') }}</label><select class="apple-select" v-model="f.arch"><option>x86_64</option><option>aarch64</option></select></div>
            <div class="form-row"><label>{{ t('wiz_auto_fw') }}</label><select class="apple-select" v-model="f.boot_mode"><option value="uefi">{{ t('wiz_fw_uefi') }}</option><option value="bios">{{ t('wiz_fw_bios') }}</option></select></div>
            <div class="form-row"><label>{{ t('wiz_auto_machine') }}</label><select class="apple-select" v-model="f.machine_type"><option value="q35">{{ t('wiz_machine_q35') }}</option><option value="pc-i440fx">{{ t('wiz_machine_i440fx') }}</option></select></div>
          </div>
        </div>

        <!-- ② 放置位置（P5）-->
        <div v-show="step===1">
          <div class="form-hint" style="margin-bottom:14px"><i class="fas fa-circle-info"></i> {{ t('wiz_place_hint') }}</div>
          <div class="form-grid">
            <div class="form-row">
              <label class="req">{{ t('wiz_sel_dc') }}</label>
              <select class="apple-select" :class="{invalid:errors.datacenter_id}" v-model="f.datacenter_id">
                <option :value="null" disabled>{{ t('wiz_pick_dc_first') }}</option>
                <option v-for="dc in datacenters" :key="dc.id" :value="dc.id">{{ dc.name }}</option>
              </select>
            </div>
            <div class="form-row">
              <label class="req">{{ t('wiz_sel_cluster') }}</label>
              <select class="apple-select" :class="{invalid:errors.cluster_id}" v-model="f.cluster_id" :disabled="!f.datacenter_id">
                <option :value="null" disabled>{{ t('wiz_pick_cluster_first') }}</option>
                <option v-for="c in clustersInDc" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <label class="req">{{ t('wiz_sel_host') }}</label>
            <select class="apple-select" :class="{invalid:errors.host_id}" v-model="f.host_id" :disabled="!f.cluster_id">
              <option :value="null" disabled>{{ hostsInCluster.length ? '—' : t('wiz_no_host_in_cluster') }}</option>
              <option v-for="h in hostsInCluster" :key="h.id" :value="h.id" :disabled="h.status!=='connected'">
                {{ h.name }} ({{ h.cpu_model }}){{ h.status!=='connected' ? ' · '+t('wiz_host_offline_warn') : '' }}
              </option>
            </select>
            <div v-if="errors.host_id" class="form-err">{{ errors.host_id }}</div>
          </div>

          <!-- 目标主机容量校验卡 -->
          <div v-if="hostCapacity" class="apple-alert" :class="hostCapacity.level==='insufficient'?'apple-alert--warning':(hostCapacity.level==='warn'?'apple-alert--warning':'apple-alert--success')" style="margin-top:6px">
            <i class="fas" :class="hostCapacity.level==='insufficient'?'fa-triangle-exclamation':(hostCapacity.level==='warn'?'fa-circle-exclamation':'fa-circle-check')"></i>
            <div style="flex:1">
              <strong>{{ hostCapacity.level==='insufficient'?t('wiz_cap_insufficient'):(hostCapacity.level==='warn'?t('wiz_cap_warn'):t('wiz_cap_ok')) }}</strong>
              <div class="flex" style="gap:18px;margin-top:8px;font-size:13px;flex-wrap:wrap">
                <span>{{ t('wiz_host_cap_cpu') }}: <strong class="mono">{{ hostCapacity.freeV }}</strong> / {{ hostCapacity.totalV }} vCPU（需 {{ hostCapacity.needV }}）</span>
                <span>{{ t('wiz_host_cap_mem') }}: <strong class="mono">{{ hostCapacity.freeM }}</strong> / {{ hostCapacity.totalM }} GB（需 {{ hostCapacity.needM }}）</span>
                <span>NUMA: <strong>{{ hostCapacity.numa_nodes }}</strong> · IOMMU: <strong :style="{color:hostCapacity.iommu?'var(--color-green)':'var(--color-red)'}">{{ hostCapacity.iommu?'on':'off' }}</strong></span>
              </div>
            </div>
          </div>
        </div>

        <!-- ③ CPU & 内存（P6）-->
        <div v-show="step===2">
          <div class="form-hint" style="margin-bottom:14px"><i class="fas fa-circle-info"></i> {{ t('wiz_vcpu_hint') }}</div>
          <div class="form-grid">
            <div class="form-row" v-if="!showAdvCPU">
              <label>{{ t('wiz_vcpu_count') }}</label>
              <input type="number" min="1" max="256" class="apple-input" v-model.number="f.vcpus">
            </div>
            <div class="form-row"><label>{{ t('wiz_mem_gb') }}</label>
              <input type="number" min="1" step="1" class="apple-input" :value="Math.round(f.memory_mb/1024)" @input="f.memory_mb=$event.target.value*1024">
            </div>
          </div>
          <button class="link-btn" @click="showAdvCPU=!showAdvCPU"><i class="fas" :class="showAdvCPU?'fa-chevron-up':'fa-chevron-down'"></i> {{ t('wiz_topo_advanced') }}</button>
          <div v-if="showAdvCPU">
            <div class="form-grid" style="margin-top:10px">
              <div class="form-row"><label>{{ t('wiz_sockets') }}</label><input type="number" min="1" class="apple-input" v-model.number="f.cpu_sockets"></div>
              <div class="form-row"><label>{{ t('wiz_cores') }}</label><input type="number" min="1" class="apple-input" v-model.number="f.cpu_cores_per_socket"></div>
              <div class="form-row"><label>{{ t('wiz_threads') }}</label><input type="number" min="1" max="2" class="apple-input" v-model.number="f.cpu_threads_per_core"></div>
              <div class="form-row"><label>{{ t('wiz_cpu_mode') }}</label><select class="apple-select" v-model="f.cpu_model"><option value="host-passthrough">host-passthrough</option><option value="host-model">host-model</option><option value="Cascadelake-Server">Cascadelake-Server</option></select></div>
            </div>
            <div class="apple-card apple-card--glass" style="margin-top:8px;text-align:center;padding:16px">
              <div class="muted">{{ t('wiz_total_vcpu') }}</div>
              <div style="font-size:32px;font-weight:700;color:var(--color-blue)">{{ vcpus }}</div>
              <div class="muted mono">{{ f.cpu_sockets }} × {{ f.cpu_cores_per_socket }} × {{ f.cpu_threads_per_core }}</div>
            </div>
          </div>
          <label class="flex" style="gap:10px;margin-top:14px"><span class="apple-toggle"><input type="checkbox" v-model="f.hugepages_enabled"><span class="track"><span class="thumb"></span></span></span> {{ t('wiz_hugepages') }}</label>
        </div>

        <!-- ④ NUMA & 绑核（P6：节点选择 + 自动绑核，无 128 格子）-->
        <div v-show="step===3">
          <div class="form-hint" style="margin-bottom:12px"><i class="fas fa-circle-info"></i> {{ t('wiz_numa_select_hint') }}</div>
          <div class="numa-pick">
            <div class="numa-card" :class="{selected:f.numa_node_affinity===-1}" @click="f.numa_node_affinity=-1">
              <div class="nc-head"><i class="fas fa-shuffle"></i> {{ t('wiz_numa_auto_label') }}<i v-if="f.numa_node_affinity===-1" class="fas fa-check-circle nc-check"></i></div>
            </div>
            <div class="numa-card" v-for="nn in numaNodes" :key="nn.node" :class="{selected:f.numa_node_affinity===nn.node}" @click="f.numa_node_affinity=nn.node">
              <div class="nc-head"><i class="fas fa-network-wired"></i> {{ t('wiz_numa_node_n') }} {{ nn.node }}<i v-if="f.numa_node_affinity===nn.node" class="fas fa-check-circle nc-check"></i></div>
              <div class="muted" style="font-size:12px;margin-top:6px">{{ t('wiz_numa_node_cores') }} {{ nn.base }}–{{ nn.base+nn.cores-1 }}（{{ nn.cores }}）· {{ t('wiz_numa_node_mem') }} {{ nn.mem_gb }}GB</div>
            </div>
            <div v-if="!numaNodes.length" class="muted" style="padding:14px">{{ t('wiz_pick_host_first') || '—' }}</div>
          </div>

          <div class="pin-section" style="margin-top:18px">
            <label class="flex" style="gap:10px"><span class="apple-toggle"><input type="checkbox" v-model="f.cpu_pinning"><span class="track"><span class="thumb"></span></span></span> {{ t('wiz_pin_toggle') }}</label>
            <div class="muted" style="font-size:12px;margin-top:6px">{{ t('wiz_pin_auto_desc') }}</div>
            <div v-if="errors.pin" class="form-err">{{ errors.pin }}</div>
            <!-- 自动绑核预览（vCPU → 物理核映射，紧凑芯片图）-->
            <div v-if="f.cpu_pinning && pinPreview.length" style="margin-top:12px">
              <div class="muted" style="font-size:12px;margin-bottom:8px">{{ t('wiz_pin_preview') }}（{{ pinPreview.length }} {{ t('wiz_pin_vcpu') }}）</div>
              <div class="pin-grid">
                <div class="pin-chip" v-for="p in pinPreview" :key="p.vcpu">
                  <span class="pc-v">v{{ p.vcpu }}</span><i class="fas fa-arrow-right-long"></i><span class="pc-p">p{{ p.pcpu }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ⑤ 磁盘 & 网络（P8 含 multiqueue）-->
        <div v-show="step===4">
          <div class="section-title" style="margin-top:0;font-size:15px"><i class="fas fa-hard-drive"></i> {{ t('wiz_disk') }}</div>
          <div class="form-grid">
            <div class="form-row"><label>{{ t('wiz_disk_size') }}</label><input type="number" class="apple-input" v-model.number="f.disks[0].size_gb"></div>
            <div class="form-row"><label>{{ t('wiz_disk_bus') }}</label><select class="apple-select" v-model="f.disks[0].bus"><option>virtio</option><option>scsi</option><option>nvme</option><option>sata</option></select></div>
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
          <!-- P8：网卡多队列 -->
          <div class="form-row">
            <label>{{ t('wiz_nic_queues') }}</label>
            <input type="number" min="1" max="32" class="apple-input" v-model.number="f.nics[0].queues" :disabled="f.nics[0].model!=='virtio'">
            <div class="form-hint">{{ t('wiz_nic_queues_hint') }}<template v-if="f.nics[0].model==='virtio'"> · {{ t('wiz_vcpu_count') }}={{ vcpus }}</template></div>
          </div>
        </div>

        <!-- ⑥ GPU -->
        <div v-show="step===5">
          <div class="form-hint" style="margin-bottom:12px"><i class="fas fa-circle-info"></i> {{ t('wiz_gpu_hint') }}</div>
          <div v-if="selectedHost && !selectedHost.iommu" class="apple-alert apple-alert--warning"><i class="fas fa-triangle-exclamation"></i> <div>{{ selectedHost.name }} 未启用 IOMMU/VFIO，请先在「主机管理 → 硬件」中启用后再分配 GPU。</div></div>
          <div class="grid grid-2" v-else>
            <div class="numa-box" v-for="g in hostGpus" :key="g.id" :class="{selected:gpuSelected(g)}" @click="toggleGPU(g)">
              <div class="nh"><span><i class="fas fa-microchip" style="color:#76b900"></i> {{ g.model }}</span><i v-if="gpuSelected(g)" class="fas fa-check-circle" style="color:var(--color-blue)"></i></div>
              <div class="muted" style="font-size:12px">{{ g.host }} · {{ g.pci }} · {{ (g.vram_mb/1024).toFixed(0) }}GB · {{ g.mode==='vgpu'?t('gpu_vgpu'):t('gpu_passthrough') }} · NUMA{{ g.numa }}</div>
            </div>
          </div>
          <div v-if="selectedHost && selectedHost.iommu && !hostGpus.length" class="muted" style="padding:20px;text-align:center">{{ t('wiz_no_gpu') }}</div>
        </div>

        <!-- ⑦ 预览 & 创建 -->
        <div v-show="step===6">
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
