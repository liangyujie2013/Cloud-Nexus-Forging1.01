// =============================================================================
//  添加主机向导（节点纳管）(component-host-wizard.js) — Cloud Nexus Forging
//  企业级 4 步流程（★ 全程真实 SSH，无任何模拟）：
//    步骤1 选择集群：先选数据中心 → 再选目标集群（体现层级约束）+ 集群信息提示
//    步骤2 连接信息：主机名 / 管理IP / SSH 端口 / SSH 用户 / SSH 密码
//                    + 「自动安装虚拟化计算组件（libvirt / KVM）」开关
//    步骤3 环境预检：真实调用 POST /hosts/precheck —— SSH 探测虚拟化组件/KVM/TCP + 采集硬件
//    步骤4 纳管部署：真实调用 POST /hosts/onboard-stream —— 判定守护进程模式
//                    （EL8 单体 libvirtd / EL9·EL10 模块化 virtqemud）→ 检测组件→缺失
//                    部分由平台推送离线依赖包本地安装（装了就跳过）→ 系统健康修复
//                    （对齐 openssl/systemd 防符号断裂）→ 按模式启动守护进程 → 采集硬件
//                    → 落库 → qemu+tcp 验证 → 置 connected。SSE 展示真实执行步骤与错误。
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

    // ---- 平台离线安装包仓库状态（源不可用时的兜底）----
    const offline = reactive({ loaded: false, enabled: false, data: [], groups: {}, root: '' })
    const loadOffline = async () => {
      const res = await store.getOfflinePackages()
      offline.loaded = true
      if (res && res.ok) {
        offline.enabled = res.enabled
        offline.data = res.data || []
        offline.groups = res.groups || {}
        offline.root = res.root || ''
      }
    }

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
    // 真实预检：调用后端 POST /hosts/precheck-stream（SSE），每完成一项立即实时反馈，
    // 不再「6 项一起转圈、跑完才一次性出结果」——逐项变绿，体验更快更透明。
    const runPrecheck = async () => {
      prechecking.value = true
      precheckError.value = ''
      precheckRan.value = false
      // 初始：全部置「等待」，并把第一项标记为进行中，给出即时反馈。
      precheck.forEach((p, i) => { p.status = i === 0 ? 'running' : 'pending'; p.result = i === 0 ? t('hw_check_running') : t('hw_check_wait') })

      // 后端 item.key → 前端结果映射。warn 级别在「未开自动安装」时按 error 展示阻断。
      const applyItem = (it) => {
        if (!it || !it.key) return
        let status = it.level || (it.ok ? 'success' : 'error')
        // libvirt/tcp 的 warn：若用户未开自动安装，则视为阻断（error）。
        if ((it.key === 'libvirt' || it.key === 'tcp') && status === 'warn' && !form.auto_install) {
          status = 'error'
        }
        setItem(it.key, status, it.detail || '')
        // 下一项标记为进行中，让用户看到「正在检测下一项」。
        const order = ['net', 'ssh', 'virt', 'libvirt', 'tcp', 'mem']
        const ni = order.indexOf(it.key) + 1
        if (ni > 0 && ni < order.length) {
          const next = precheck.find((p) => p.key === order[ni])
          if (next && next.status === 'pending') { next.status = 'running'; next.result = t('hw_check_running') }
        }
      }

      const res = await store.precheckHostStreamSSH(
        {
          ip_address: form.ip_address.trim(),
          ssh_port: form.ssh_port,
          ssh_user: form.ssh_user.trim(),
          password: form.ssh_password,
          libvirt_port: 16509,
        },
        {
          onItem: applyItem,
          onHardware: (hw) => { hardwareInfo.value = hw },
        }
      )
      prechecking.value = false
      precheckRan.value = true

      if (!res.ok) {
        // 致命错误（多为 SSH 连接/鉴权失败）：若尚未逐项标红，则补标。
        const net = precheck.find((p) => p.key === 'net')
        if (net && net.status !== 'error' && net.status !== 'success') setItem('net', 'error', t('hw_check_unreachable'))
        const ssh = precheck.find((p) => p.key === 'ssh')
        if (ssh && ssh.status === 'running') setItem('ssh', 'error', res.error || t('hw_check_failed'))
        precheck.filter((p) => p.status === 'running' || p.status === 'pending').forEach((p) => { p.status = 'pending'; p.result = '—' })
        precheckError.value = res.error || t('hw_check_failed')
        return
      }
      if (res.hardware) hardwareInfo.value = res.hardware
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

    // ---- 纳管部署（真实流式 POST /hosts/onboard-stream，SSE 实时日志）----
    const deployStatus = ref('') // '' | 'success' | 'exception'
    const deployMessage = ref('')
    const deploying = ref(false)
    const deployDone = ref(false)
    // installSteps：实时步骤列表。每个 = { name, command, ok(null=进行中), error, lines:[] }
    const installSteps = ref([])
    const currentStepIdx = ref(-1)
    const deployActivity = ref('') // 当前实时活动（最新一行输出），驱动"心跳"避免进度像卡死
    const logBox = ref(null) // 终端日志容器（用于自动滚到底）

    const scrollLogToEnd = () => {
      // 等 DOM 更新后滚动到底，保证用户始终看到最新输出。
      Vue.nextTick(() => { if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight })
    }

    const runDeploy = async () => {
      if (deployDone.value) { emit('done'); emit('close'); return }
      deploying.value = true
      deployStatus.value = ''
      installSteps.value = []
      currentStepIdx.value = -1
      deployMessage.value = form.auto_install ? t('hw_dep_installing') : t('hw_dep_onboarding')

      const res = await store.onboardHostStreamSSH(
        {
          cluster_id: form.cluster_id,
          name: form.hostname.trim(),
          ip_address: form.ip_address.trim(),
          ssh_port: form.ssh_port,
          ssh_user: form.ssh_user.trim(),
          password: form.ssh_password,
          libvirt_port: 16509,
          auto_install: form.auto_install,
        },
        {
          // 某步骤开始：追加一个 running 步骤，并把当前活动名同步到进度区（让用户随时知道"在干嘛"）
          onStep: (s) => {
            installSteps.value.push({ name: s.name || '执行中', command: s.command || '', ok: null, error: '', lines: [] })
            currentStepIdx.value = installSteps.value.length - 1
            deployMessage.value = s.name || deployMessage.value
            scrollLogToEnd()
          },
          // 实时一行输出：追加到当前步骤的 lines；同时把最新一行作为"当前活动"显示在进度区下方
          onLine: (line) => {
            const idx = currentStepIdx.value
            if (idx >= 0 && installSteps.value[idx]) {
              installSteps.value[idx].lines.push(line)
              // 限制每步行数，避免超长输出拖慢页面
              if (installSteps.value[idx].lines.length > 500) installSteps.value[idx].lines.shift()
            }
            // 推送/安装等长步骤会刷很多行，用最新一行驱动"活动心跳"，避免进度条像卡死
            if (line && line.trim()) deployActivity.value = line.trim().slice(0, 80)
            scrollLogToEnd()
          },
          // 步骤结束：更新 ok/error/输出
          onDone: (step) => {
            const idx = currentStepIdx.value
            const target = (idx >= 0 && installSteps.value[idx] && installSteps.value[idx].name === step.name)
              ? installSteps.value[idx]
              : installSteps.value.find((x) => x.name === step.name && x.ok === null)
            if (target) {
              target.ok = !!step.ok
              target.error = step.error || ''
              if (step.output && !target.lines.length) target.lines = String(step.output).split('\n')
            } else {
              installSteps.value.push({ name: step.name, command: step.command || '', ok: !!step.ok, error: step.error || '', lines: step.output ? String(step.output).split('\n') : [] })
            }
            scrollLogToEnd()
          },
        }
      )
      deploying.value = false

      if (!res.ok) {
        deployStatus.value = 'exception'
        deployMessage.value = res.error || t('hw_dep_failed')
        // 后端 result/error 也可能带 install.steps（非流式回退），补充展示
        if (res.install && Array.isArray(res.install.steps) && !installSteps.value.length) {
          installSteps.value = res.install.steps.map((s) => ({ name: s.name, command: s.command, ok: s.ok, error: s.error, lines: s.output ? String(s.output).split('\n') : [] }))
        }
        toast(deployMessage.value, 'error')
        return
      }
      deployStatus.value = 'success'
      deployDone.value = true
      const clName = selectedCluster.value ? selectedCluster.value.name : ''
      deployMessage.value = res.message || t('hw_dep_success').replace('{host}', form.hostname).replace('{cluster}', clName)
      toast(deployMessage.value, 'success')
    }

    // 进度百分比：用「预期总步骤数」做分母（避免分母随步骤出现而变化、导致前期卡在 5%）。
    // 纳管全流程预期步骤数（自动安装时较多）：SSH→预检→检测→[安装→健康修复→启动→KVM→TCP→防火墙]→采集→落库→验证。
    const expectedSteps = computed(() => (form.auto_install ? 12 : 6))
    const deployProgress = computed(() => {
      if (deployDone.value) return 100
      if (!installSteps.value.length) return deploying.value ? 3 : 0
      const done = installSteps.value.filter((s) => s.ok !== null).length
      // 已完成步骤贡献主进度；当前进行中的步骤再按其输出行数给一点「心跳」增量（最多 +6%）。
      const cur = installSteps.value[currentStepIdx.value]
      let intra = 0
      if (cur && cur.ok === null && cur.lines && cur.lines.length) {
        intra = Math.min(6, Math.round(cur.lines.length / 8))
      }
      const base = Math.round((done / expectedSteps.value) * 92) + 3
      return Math.min(base + intra, 96)
    })

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
      if (step.value === 0) {
        if (!validateStep1()) return
        if (!offline.loaded) loadOffline() // 进入步骤2前预拉离线包状态
      }
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
      deployProgress, deployStatus, deployMessage, deployActivity, deploying, deployDone, runDeploy, installSteps, currentStepIdx, logBox,
      offline, loadOffline,
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
          <!-- 离线安装包就绪状态：源不可用时平台自动推送本地 RPM 安装 -->
          <div v-if="form.auto_install && offline.loaded" class="hw-offline-hint">
            <i class="fas" :class="offline.data.length ? 'fa-box-open' : 'fa-box'"></i>
            <span v-if="offline.data.length">
              {{ t('hw_offline_ready') }}：{{ Object.keys(offline.groups).join(' / ') }}（{{ offline.data.length }} {{ t('hw_offline_pkgs') }}）— {{ t('hw_offline_fallback') }}
            </span>
            <span v-else>{{ t('hw_offline_empty') }}</span>
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

        <!-- 步骤4：纳管部署（真实安装 + 落库 + qemu+tcp 验证；SSE 实时日志）-->
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
            <div v-if="deploying && deployActivity" class="deploy-activity" style="margin-top:6px;font-size:12px;color:var(--text-muted,#86868b);font-family:ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              <i class="fas fa-angle-right"></i> {{ deployActivity }}
            </div>
          </div>
          <!-- 真实安装步骤日志（实时流式，含每行 stdout/stderr）-->
          <div v-if="installSteps.length" class="install-log">
            <div class="install-log-title">
              <i class="fas fa-terminal"></i> {{ t('hw_install_log') }}
              <span class="install-log-live" v-if="deploying"><i class="fas fa-circle"></i> {{ t('hw_log_live') }}</span>
            </div>
            <div class="install-log-body" ref="logBox">
              <div v-for="(s,i) in installSteps" :key="i" class="install-step" :class="{ok:s.ok===true, err:s.ok===false, running:s.ok===null}">
                <div class="install-step-head">
                  <i class="fas" :class="s.ok===true ? 'fa-circle-check' : s.ok===false ? 'fa-circle-xmark' : 'fa-circle-notch fa-spin'"></i>
                  <span class="install-step-name">{{ s.name }}</span>
                  <code v-if="s.command" class="install-step-cmd">{{ s.command }}</code>
                </div>
                <!-- 实时命令输出（终端风格） -->
                <pre v-if="s.lines && s.lines.length" class="install-step-out">{{ s.lines.join('\\n') }}</pre>
                <div v-if="s.error" class="install-step-err"><i class="fas fa-triangle-exclamation"></i> {{ s.error }}</div>
              </div>
            </div>
          </div>
          <div v-else-if="!deploying && !deployDone" class="muted" style="margin-top:10px;font-size:12px;text-align:center">
            {{ form.auto_install ? t('hw_dep_ready_auto') : t('hw_dep_ready') }}
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
