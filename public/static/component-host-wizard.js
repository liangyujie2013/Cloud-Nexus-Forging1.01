// =============================================================================
//  添加主机向导（节点纳管）(component-host-wizard.js) — Cloud Nexus Forging
//  企业级 4 步流程（★ 全程真实 SSH，无任何模拟）：
//    步骤1 选择集群：先选数据中心 → 再选目标集群（体现层级约束）+ 集群信息提示
//    步骤2 连接信息：主机名 / 管理IP / SSH 端口 / SSH 用户 / SSH 密码
//                    + 「自动安装 libvirt 和 KVM（若未安装）」开关
//    步骤3 环境预检：真实调用 POST /hosts/precheck —— SSH 探测 libvirt/KVM/TCP + 采集硬件
//    步骤4 纳管部署：真实调用 POST /hosts/onboard —— （可选）自动安装 → 采集硬件 → 落库 →
//                    qemu+tcp 验证 → 置 connected。展示真实安装步骤与错误。
//  Apple HIG：毛玻璃 modal / 12px 圆角 / 流畅过渡。无任何第三方 UI 框架。
//  通过自定义事件 cnf:open-host-wizard 打开（可携带 presetClusterId）。
// =============================================================================
(function () {
const { ref, reactive, computed } = Vue
const store = window.cnfTopology
const toast = window.cnfToast

const HostWizard = {
  emits: ['close', 'done'],
  props: { presetClusterId: { type: Number, default: 0 } },
  setup(props, { emit }) {
    const t = window.t
    const step = ref(0)
    const steps = computed(() => [t('hw_step1'), t('hw_step2'), t('hw_step3'), t('hw_step4')])

    const form = reactive({
      datacenter_id: null,
      cluster_id: null,
      hostname: '',
      ip_address: '',
      ssh_port: 22,
      ssh_user: 'root',
      ssh_password: '',
      auto_install: true, // 默认开启：裸机也能一键纳管
    })
    const errors = reactive({})

    // 预设集群（从集群页「+添加主机」进入时）
    if (props.presetClusterId) {
      const cl = store.state.clusters.find((c) => c.id === props.presetClusterId)
      if (cl) { form.datacenter_id = cl.datacenter_id; form.cluster_id = cl.id }
    }

    const datacenters = computed(() => store.state.datacenters)
    const availableClusters = computed(() =>
      form.datacenter_id ? store.clusterStats.value.filter((c) => c.datacenter_id === form.datacenter_id) : []
    )
    const selectedCluster = computed(() => availableClusters.value.find((c) => c.id === form.cluster_id))

    const onDatacenterChange = () => { form.cluster_id = null }

    // ---- 预检项目（真实 SSH 探测结果驱动）----
    const precheck = reactive([
      { key: 'net', name: t('hw_check_net'), status: 'pending', result: t('hw_check_wait') },
      { key: 'ssh', name: t('hw_check_ssh'), status: 'pending', result: t('hw_check_wait') },
      { key: 'virt', name: t('hw_check_virt'), status: 'pending', result: t('hw_check_wait') },
      { key: 'libvirt', name: t('hw_check_libvirt'), status: 'pending', result: t('hw_check_wait') },
      { key: 'tcp', name: t('hw_check_tcp'), status: 'pending', result: t('hw_check_wait') },
      { key: 'mem', name: t('hw_check_mem'), status: 'pending', result: t('hw_check_wait') },
    ])
    const prechecking = ref(false)
    const precheckError = ref('')
    const precheckRan = ref(false)      // 是否已跑过一次预检
    const hardwareInfo = ref(null)      // 采集到的真实硬件
    const setItem = (key, status, result) => {
      const it = precheck.find((p) => p.key === key)
      if (it) { it.status = status; it.result = result }
    }
    // 真实预检：调用后端 POST /hosts/precheck（SSH 只读探测 + 采集硬件）。
    const runPrecheck = async () => {
      prechecking.value = true
      precheckError.value = ''
      precheckRan.value = false
      precheck.forEach((p) => { p.status = 'running'; p.result = t('hw_check_running') })

      const res = await store.precheckHostSSH({
        ip_address: form.ip_address.trim(),
        ssh_port: form.ssh_port,
        ssh_user: form.ssh_user.trim(),
        password: form.ssh_password,
        libvirt_port: 16509,
      })
      prechecking.value = false
      precheckRan.value = true

      if (!res.ok) {
        // SSH 连接 / 鉴权失败：网络与 SSH 项标红，给出真实错误。
        setItem('net', 'error', t('hw_check_unreachable'))
        setItem('ssh', 'error', res.error || t('hw_check_failed'))
        precheck.filter((p) => !['net', 'ssh'].includes(p.key)).forEach((p) => { p.status = 'pending'; p.result = '—' })
        precheckError.value = res.error || t('hw_check_failed')
        return
      }

      const pc = res.precheck || {}
      const hw = res.hardware || {}
      hardwareInfo.value = hw

      // 网络 + SSH：能拿到预检结果即说明 SSH 通了。
      setItem('net', 'success', t('hw_check_reachable'))
      setItem('ssh', 'success', t('hw_check_ssh_ok').replace('{user}', form.ssh_user))
      // CPU 虚拟化
      setItem('virt', pc.kvm_supported ? 'success' : 'error',
        pc.kvm_supported ? t('hw_check_virt_ok') : t('hw_check_virt_no'))
      // libvirt 安装/运行
      if (pc.libvirt_installed && pc.libvirt_running) {
        setItem('libvirt', 'success', t('hw_check_libvirt_ok'))
      } else if (pc.libvirt_installed) {
        setItem('libvirt', 'warn', t('hw_check_libvirt_stopped'))
      } else {
        setItem('libvirt', form.auto_install ? 'warn' : 'error',
          form.auto_install ? t('hw_check_libvirt_autoinstall') : t('hw_check_libvirt_no'))
      }
      // TCP 监听
      if (pc.tcp_listening) {
        setItem('tcp', 'success', t('hw_check_tcp_ok').replace('{port}', pc.tcp_port || 16509))
      } else {
        setItem('tcp', form.auto_install ? 'warn' : 'error',
          form.auto_install ? t('hw_check_tcp_autoinstall') : t('hw_check_tcp_no'))
      }
      // 内存
      const memGb = hw.memory_total_mb ? Math.round(hw.memory_total_mb / 1024) : 0
      setItem('mem', memGb > 0 ? 'success' : 'warn',
        memGb > 0 ? (memGb + ' GB · ' + (hw.cpu_model || '')) : t('hw_check_mem_unknown'))
    }
    // 是否可进入纳管：CPU 虚拟化必须支持；libvirt/TCP 缺失但开了自动安装则放行。
    const precheckPassed = computed(() => {
      if (!precheckRan.value || precheckError.value) return false
      const virt = precheck.find((p) => p.key === 'virt')
      if (!virt || virt.status !== 'success') return false
      const lib = precheck.find((p) => p.key === 'libvirt')
      const tcp = precheck.find((p) => p.key === 'tcp')
      const okOrAuto = (it) => it && (it.status === 'success' || (it.status === 'warn' && form.auto_install))
      return okOrAuto(lib) && okOrAuto(tcp)
    })

    // ---- 纳管部署（真实 POST /hosts/onboard）----
    const deployProgress = ref(0)
    const deployStatus = ref('') // '' | 'success' | 'exception'
    const deployMessage = ref('')
    const deploying = ref(false)
    const deployDone = ref(false)
    const installSteps = ref([])   // 后端返回的真实安装步骤
    const runDeploy = async () => {
      if (deployDone.value) { emit('done'); emit('close'); return }
      deploying.value = true
      deployStatus.value = ''
      installSteps.value = []
      deployProgress.value = 10
      deployMessage.value = form.auto_install ? t('hw_dep_installing') : t('hw_dep_onboarding')

      const res = await store.onboardHostSSH({
        cluster_id: form.cluster_id,
        name: form.hostname.trim(),
        ip_address: form.ip_address.trim(),
        ssh_port: form.ssh_port,
        ssh_user: form.ssh_user.trim(),
        password: form.ssh_password,
        libvirt_port: 16509,
        auto_install: form.auto_install,
      })
      deploying.value = false
      deployProgress.value = 100

      // 展示真实安装步骤（无论成败）
      if (res.install && Array.isArray(res.install.steps)) installSteps.value = res.install.steps

      if (!res.ok) {
        deployStatus.value = 'exception'
        deployMessage.value = res.error || t('hw_dep_failed')
        if (res.install && Array.isArray(res.install.steps)) installSteps.value = res.install.steps
        toast(deployMessage.value, 'error')
        return
      }
      deployStatus.value = 'success'
      deployDone.value = true
      const clName = selectedCluster.value ? selectedCluster.value.name : ''
      deployMessage.value = res.message || t('hw_dep_success').replace('{host}', form.hostname).replace('{cluster}', clName)
      toast(deployMessage.value, 'success')
    }

    // ---- 校验 ----
    const validateStep1 = () => {
      const e = {}
      if (!form.datacenter_id) e.datacenter_id = t('op_required')
      if (!form.cluster_id) e.cluster_id = t('op_required')
      Object.assign(errors, e, { datacenter_id: e.datacenter_id, cluster_id: e.cluster_id })
      return !e.datacenter_id && !e.cluster_id
    }
    const validateStep2 = () => {
      const e = {}
      if (!form.hostname.trim()) e.hostname = t('op_required')
      else if (!/^[A-Za-z0-9.-]{2,40}$/.test(form.hostname.trim())) e.hostname = t('op_invalid')
      const ipRe = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
      if (!form.ip_address.trim()) e.ip_address = t('op_required')
      else if (!ipRe.test(form.ip_address.trim()) || form.ip_address.split('.').some((n) => +n > 255)) e.ip_address = t('hw_err_ip')
      else if (store.state.hosts.find((h) => h.ip === form.ip_address.trim())) e.ip_address = t('hw_err_ip_dup')
      if (!form.ssh_user.trim()) e.ssh_user = t('op_required')
      if (!form.ssh_password) e.ssh_password = t('op_required')
      Object.assign(errors, { hostname: e.hostname, ip_address: e.ip_address, ssh_user: e.ssh_user, ssh_password: e.ssh_password })
      return !e.hostname && !e.ip_address && !e.ssh_user && !e.ssh_password
    }

    const next = async () => {
      if (step.value === 0) { if (!validateStep1()) return }
      if (step.value === 1) { if (!validateStep2()) return }
      if (step.value === 2) {
        // 进入预检步骤前若未跑过，自动触发
        if (!precheckPassed.value && !prechecking.value) { await runPrecheck() }
        if (!precheckPassed.value) return
      }
      if (step.value < 3) step.value++
    }
    const prev = () => { if (step.value > 0) step.value-- }

    const nextLabel = computed(() => {
      if (step.value === 2) return precheckPassed.value ? t('hw_next') : t('hw_run_precheck')
      return t('hw_next')
    })

    return {
      step, steps, form, errors,
      datacenters, availableClusters, selectedCluster, onDatacenterChange,
      precheck, prechecking, runPrecheck, precheckPassed, precheckError, precheckRan, hardwareInfo,
      deployProgress, deployStatus, deployMessage, deploying, deployDone, runDeploy, installSteps,
      next, prev, nextLabel, t,
    }
  },
  template: `
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal-dialog modal-lg host-wizard">
      <div class="modal-head"><i class="fas fa-server" style="color:var(--color-blue)"></i> {{ t('hw_title') }}</div>

      <!-- 步骤条 -->
      <div class="wiz-steps">
        <div class="wiz-step" v-for="(s,i) in steps" :key="i" :class="{active:step===i, done:step>i}">
          <span class="wiz-step-dot"><i v-if="step>i" class="fas fa-check"></i><span v-else>{{ i+1 }}</span></span>
          <span class="wiz-step-label">{{ s }}</span>
        </div>
      </div>

      <div class="modal-body host-wizard-body">
        <!-- 步骤1：选择集群 -->
        <template v-if="step===0">
          <div class="form-row">
            <label>{{ t('hw_datacenter') }} <span class="req">*</span></label>
            <select v-model="form.datacenter_id" :class="{invalid:errors.datacenter_id}" @change="onDatacenterChange">
              <option :value="null" disabled>{{ t('hw_select_dc') }}</option>
              <option v-for="dc in datacenters" :key="dc.id" :value="dc.id">{{ dc.name }}</option>
            </select>
            <div v-if="errors.datacenter_id" class="form-err">{{ errors.datacenter_id }}</div>
          </div>
          <div class="form-row">
            <label>{{ t('hw_target_cluster') }} <span class="req">*</span></label>
            <select v-model="form.cluster_id" :class="{invalid:errors.cluster_id}" :disabled="!form.datacenter_id">
              <option :value="null" disabled>{{ form.datacenter_id ? t('hw_select_cluster') : t('hw_select_dc_first') }}</option>
              <option v-for="cl in availableClusters" :key="cl.id" :value="cl.id">{{ cl.name }}（{{ cl.host_count }} {{ t('host_machine') }}）</option>
            </select>
            <div v-if="errors.cluster_id" class="form-err">{{ errors.cluster_id }}</div>
          </div>
          <div v-if="selectedCluster" class="info-alert">
            <i class="fas fa-circle-info"></i>
            <div>
              <div>{{ t('hw_cluster_info') }}：{{ selectedCluster.description }}</div>
              <div>{{ t('hw_cluster_ha') }}：{{ selectedCluster.ha_enabled ? t('enabled') : t('disabled') }} · {{ t('hw_cluster_hosts') }}：{{ selectedCluster.host_count }} {{ t('host_machine') }}</div>
            </div>
          </div>
        </template>

        <!-- 步骤2：连接信息 -->
        <template v-else-if="step===1">
          <div class="form-row">
            <label>{{ t('hw_hostname') }} <span class="req">*</span></label>
            <input v-model="form.hostname" :class="{invalid:errors.hostname}" placeholder="node3-mgr" />
            <div v-if="errors.hostname" class="form-err">{{ errors.hostname }}</div>
          </div>
          <div class="form-row">
            <label>{{ t('hw_mgmt_ip') }} <span class="req">*</span></label>
            <input v-model="form.ip_address" :class="{invalid:errors.ip_address}" placeholder="192.168.1.104" />
            <div v-if="errors.ip_address" class="form-err">{{ errors.ip_address }}</div>
          </div>
          <div class="form-grid-2">
            <div class="form-row">
              <label>{{ t('hw_ssh_port') }}</label>
              <input type="number" min="1" max="65535" v-model.number="form.ssh_port" />
            </div>
            <div class="form-row">
              <label>{{ t('hw_ssh_user') }} <span class="req">*</span></label>
              <input v-model="form.ssh_user" :class="{invalid:errors.ssh_user}" />
              <div v-if="errors.ssh_user" class="form-err">{{ errors.ssh_user }}</div>
            </div>
          </div>
          <div class="form-row">
            <label>{{ t('hw_ssh_pass') }} <span class="req">*</span></label>
            <input type="password" v-model="form.ssh_password" :class="{invalid:errors.ssh_password}" />
            <div v-if="errors.ssh_password" class="form-err">{{ errors.ssh_password }}</div>
          </div>
          <!-- 自动安装开关：裸机也能一键纳管 -->
          <div class="hw-toggle-row">
            <label class="hw-switch">
              <input type="checkbox" v-model="form.auto_install" />
              <span class="hw-switch-slider"></span>
            </label>
            <div class="hw-toggle-text">
              <div class="hw-toggle-title">{{ t('hw_auto_install') }}</div>
              <div class="hw-toggle-desc">{{ t('hw_auto_install_desc') }}</div>
            </div>
          </div>
        </template>

        <!-- 步骤3：环境预检（真实 SSH 探测）-->
        <template v-else-if="step===2">
          <div class="muted" style="margin-bottom:12px"><i class="fas fa-clipboard-check"></i> {{ t('hw_precheck_hint') }}</div>
          <div class="precheck-list">
            <div v-for="ck in precheck" :key="ck.key" class="precheck-item">
              <i class="fas precheck-ic"
                :class="{ 'fa-circle-notch fa-spin': ck.status==='running', 'fa-circle-check': ck.status==='success', 'fa-triangle-exclamation': ck.status==='warn', 'fa-circle-xmark': ck.status==='error', 'far fa-circle': ck.status==='pending' }"
                :style="{color: ck.status==='success' ? 'var(--color-green)' : ck.status==='warn' ? 'var(--color-orange)' : ck.status==='error' ? 'var(--color-red)' : ck.status==='running' ? 'var(--color-blue)' : 'var(--text-tertiary)'}"></i>
              <span class="precheck-name">{{ ck.name }}</span>
              <span class="precheck-result" :class="{ok:ck.status==='success', warn:ck.status==='warn', err:ck.status==='error'}">{{ ck.result }}</span>
            </div>
          </div>
          <div v-if="precheckError" class="info-alert" style="border-color:var(--color-red);background:rgba(255,59,48,.06);margin-top:12px">
            <i class="fas fa-circle-exclamation" style="color:var(--color-red)"></i>
            <div>{{ precheckError }}</div>
          </div>
          <div v-if="precheckRan && !precheckError && !precheckPassed" class="info-alert" style="border-color:var(--color-orange);background:rgba(255,149,0,.06);margin-top:12px">
            <i class="fas fa-triangle-exclamation" style="color:var(--color-orange)"></i>
            <div>{{ t('hw_precheck_blocked') }}</div>
          </div>
          <div v-if="precheckRan && precheckPassed && !precheck.find(p=>p.key==='libvirt' && p.status==='warn') && form.auto_install" class="muted" style="margin-top:10px;font-size:12px"></div>
          <div v-if="precheckRan" style="margin-top:12px">
            <button class="apple-btn apple-btn--secondary apple-btn--sm" :disabled="prechecking" @click="runPrecheck">
              <i class="fas fa-rotate-right"></i> {{ t('hw_recheck') }}
            </button>
          </div>
        </template>

        <!-- 步骤4：纳管部署（真实安装 + 落库 + qemu+tcp 验证）-->
        <template v-else>
          <div class="deploy-box">
            <div class="usage-bar deploy-bar">
              <div class="fill" :style="{width:deployProgress+'%', background: deployStatus==='exception' ? 'var(--color-red)' : deployStatus==='success' ? 'var(--color-green)' : 'var(--color-blue)'}"></div>
            </div>
            <div class="deploy-pct">{{ deployProgress }}%</div>
            <div class="deploy-msg" :class="{ok:deployStatus==='success', err:deployStatus==='exception'}">
              <i v-if="deploying" class="fas fa-spinner fa-spin"></i>
              <i v-else-if="deployStatus==='success'" class="fas fa-circle-check"></i>
              <i v-else-if="deployStatus==='exception'" class="fas fa-circle-xmark"></i>
              <span>{{ deployMessage || (form.auto_install ? t('hw_dep_ready_auto') : t('hw_dep_ready')) }}</span>
            </div>
          </div>
          <!-- 真实安装步骤日志 -->
          <div v-if="installSteps.length" class="install-log">
            <div class="install-log-title"><i class="fas fa-terminal"></i> {{ t('hw_install_log') }}</div>
            <div v-for="(s,i) in installSteps" :key="i" class="install-step" :class="{ok:s.ok, err:!s.ok}">
              <i class="fas" :class="s.ok ? 'fa-circle-check' : 'fa-circle-xmark'"></i>
              <div class="install-step-body">
                <div class="install-step-name">{{ s.name }}</div>
                <div v-if="s.error" class="install-step-err">{{ s.error }}</div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="modal-foot">
        <button class="apple-btn apple-btn--secondary" :disabled="step===0 || deploying" @click="prev">{{ t('hw_prev') }}</button>
        <div class="spacer"></div>
        <button class="apple-btn apple-btn--secondary" :disabled="deploying" @click="$emit('close')">{{ t('op_cancel') }}</button>
        <button v-if="step<3" class="apple-btn apple-btn--primary" :disabled="prechecking" @click="next">
          <i v-if="prechecking" class="fas fa-spinner fa-spin"></i> {{ nextLabel }}
        </button>
        <button v-else class="apple-btn apple-btn--primary" :disabled="deploying" @click="runDeploy">
          <i v-if="deploying" class="fas fa-spinner fa-spin"></i>
          {{ deployDone ? t('hw_finish') : t('hw_start_deploy') }}
        </button>
      </div>
    </div>
  </div>`,
}

window.__CNF_VIEWS.HostWizard = HostWizard
})()
