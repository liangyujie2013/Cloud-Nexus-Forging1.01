// =============================================================================
//  添加主机向导（节点纳管）(component-host-wizard.js) — Cloud Nexus Forging
//  企业级 4 步流程：
//    步骤1 选择集群：先选数据中心 → 再选目标集群（体现层级约束）+ 集群信息提示
//    步骤2 连接信息：主机名 / 管理IP / SSH 端口 / SSH 用户 / SSH 密码（表单校验）
//    步骤3 环境预检：网络连通 / CPU 虚拟化 / 内存容量 / SSH 验证（逐项模拟）
//    步骤4 纳管部署：连接 → 安装虚拟化组件 → 配置虚拟交换机 → 部署 Agent → 注册集群（进度）
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

    // ---- 预检项目 ----
    const precheck = reactive([
      { key: 'net', name: t('hw_check_net'), status: 'pending', result: t('hw_check_wait') },
      { key: 'virt', name: t('hw_check_virt'), status: 'pending', result: t('hw_check_wait') },
      { key: 'mem', name: t('hw_check_mem'), status: 'pending', result: t('hw_check_wait') },
      { key: 'ssh', name: t('hw_check_ssh'), status: 'pending', result: t('hw_check_wait') },
    ])
    const prechecking = ref(false)
    const precheckResults = {
      net: 'RTT 0.4ms · 可达', virt: 'Intel VT-x / IOMMU 已启用', mem: '256 GB 可用', ssh: '认证成功 (root)',
    }
    const runPrecheck = async () => {
      prechecking.value = true
      for (const item of precheck) {
        item.status = 'running'; item.result = t('hw_check_running')
        await new Promise((r) => setTimeout(r, 800))
        item.status = 'success'; item.result = precheckResults[item.key]
      }
      prechecking.value = false
    }
    const precheckPassed = computed(() => precheck.every((p) => p.status === 'success'))

    // ---- 部署 ----
    const deployProgress = ref(0)
    const deployStatus = ref('') // '' | 'success' | 'exception'
    const deployMessage = ref('')
    const deploying = ref(false)
    const deployDone = ref(false)
    const deploySteps = computed(() => [
      t('hw_dep_connect'), t('hw_dep_virt'), t('hw_dep_vswitch'),
      t('hw_dep_agent'), t('hw_dep_register'), t('hw_dep_sync'), t('hw_dep_done'),
    ])
    const runDeploy = async () => {
      if (deployDone.value) { emit('done'); emit('close'); return }
      deploying.value = true
      const seq = deploySteps.value
      for (let i = 0; i < seq.length; i++) {
        deployMessage.value = seq[i]
        deployProgress.value = Math.round(((i + 1) / seq.length) * 100)
        await new Promise((r) => setTimeout(r, 900))
      }
      // 真正提交到 store（含 IP 去重 + 集群校验 + 自动继承 DC）
      const res = await store.addHostToCluster({
        datacenter_id: form.datacenter_id,
        cluster_id: form.cluster_id,
        hostname: form.hostname,
        ip_address: form.ip_address,
        ssh_port: form.ssh_port,
        ssh_user: form.ssh_user,
        ssh_password: form.ssh_password,
      })
      deploying.value = false
      if (!res.ok) {
        deployStatus.value = 'exception'
        deployMessage.value = t('hw_dep_failed')
        return
      }
      deployStatus.value = 'success'
      deployDone.value = true
      deployMessage.value = t('hw_dep_success').replace('{host}', form.hostname).replace('{cluster}', selectedCluster.value ? selectedCluster.value.name : '')
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
      precheck, prechecking, runPrecheck, precheckPassed,
      deployProgress, deployStatus, deployMessage, deploying, deployDone, runDeploy,
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
        </template>

        <!-- 步骤3：环境预检 -->
        <template v-else-if="step===2">
          <div class="muted" style="margin-bottom:12px"><i class="fas fa-clipboard-check"></i> {{ t('hw_precheck_hint') }}</div>
          <div class="precheck-list">
            <div v-for="ck in precheck" :key="ck.key" class="precheck-item">
              <i class="fas precheck-ic"
                :class="{ 'fa-circle-notch fa-spin': ck.status==='running', 'fa-circle-check': ck.status==='success', 'far fa-circle': ck.status==='pending' }"
                :style="{color: ck.status==='success' ? 'var(--color-green)' : ck.status==='running' ? 'var(--color-blue)' : 'var(--text-tertiary)'}"></i>
              <span class="precheck-name">{{ ck.name }}</span>
              <span class="precheck-result" :class="{ok:ck.status==='success'}">{{ ck.result }}</span>
            </div>
          </div>
        </template>

        <!-- 步骤4：纳管部署 -->
        <template v-else>
          <div class="deploy-box">
            <div class="usage-bar deploy-bar">
              <div class="fill" :style="{width:deployProgress+'%', background: deployStatus==='exception' ? 'var(--color-red)' : 'var(--color-blue)'}"></div>
            </div>
            <div class="deploy-pct">{{ deployProgress }}%</div>
            <div class="deploy-msg" :class="{ok:deployStatus==='success', err:deployStatus==='exception'}">
              <i v-if="deploying" class="fas fa-spinner fa-spin"></i>
              <i v-else-if="deployStatus==='success'" class="fas fa-circle-check"></i>
              <i v-else-if="deployStatus==='exception'" class="fas fa-circle-xmark"></i>
              <span>{{ deployMessage || t('hw_dep_ready') }}</span>
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
