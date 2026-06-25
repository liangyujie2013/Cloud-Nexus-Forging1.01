// =============================================================================
//  模块视图：系统设置 (view-system.js)
//  子标签：config 基础配置 / license License 管理（三版本对比+用量+升级）/ about 关于系统。
//  License 页驱动数据：GET /api/v1/license（当前许可）、/api/v1/license/editions（版本矩阵）。
// =============================================================================
(function () {
const { ref, computed, onMounted, watch } = Vue
const api = window.api
const t = window.t

const SystemView = {
  props: { tab: { type: String, default: 'config' } },
  setup(props) {
    const license = ref(null)
    const editions = ref([])

    const load = async () => {
      if (!license.value) license.value = await api('/license')
      if (!editions.value.length) editions.value = await api('/license/editions')
    }
    onMounted(load)
    watch(() => props.tab, load)

    // 用量百分比
    const nodesPct = computed(() => license.value ? Math.round((license.value.current_nodes / license.value.max_nodes) * 100) : 0)
    const vmsPct = computed(() => license.value ? Math.round((license.value.current_vms / license.value.max_vms) * 100) : 0)
    const usageColor = (p) => (p > 85 ? 'var(--color-red)' : p > 60 ? 'var(--color-orange)' : 'var(--color-green)')

    // 版本本地化名称
    const edName = (e) => (window.i18n.locale === 'en' ? e.name_en : e.name_zh)
    const isCurrent = (e) => license.value && e.key === license.value.edition
    // 对比表行定义：label i18n key + 取值函数 + 渲染类型
    const rows = computed(() => [
      { label: 'lic_price', get: (e) => e.price, type: 'text' },
      { label: 'lic_feat_max_nodes', get: (e) => e.nodes_label || String(e.max_nodes), type: 'text' },
      { label: 'lic_feat_max_vms', get: (e) => (e.max_vms >= 999999 ? t('lic_unlimited') : e.max_vms), type: 'num' },
      { label: 'lic_feat_ha', get: (e) => e.ha_enabled, type: 'bool' },
      { label: 'lic_feat_migration', get: (e) => e.live_migration, type: 'bool' },
      { label: 'lic_feat_vlan', get: (e) => e.vlan_mgmt, type: 'text' },
      { label: 'lic_feat_storage', get: (e) => e.storage, type: 'text' },
      { label: 'lic_feat_roles', get: (e) => e.custom_roles, type: 'bool' },
      { label: 'lic_feat_audit', get: (e) => e.audit_log, type: 'bool' },
      { label: 'lic_feat_api', get: (e) => e.api_access, type: 'text' },
    ])

    return { props, license, editions, nodesPct, vmsPct, usageColor, edName, isCurrent, rows, t }
  },
  template: `
    <div>
      <!-- ===== config：基础配置 ===== -->
      <template v-if="props.tab==='config'">
        <div class="apple-card" style="max-width:680px">
          <strong style="font-size:16px">{{ t('sys_config_title') }}</strong>
          <div class="form-grid" style="margin-top:18px">
            <div class="form-row"><label>{{ t('sys_platform') }}</label><input class="apple-input" :value="t('brand_name')" readonly></div>
            <div class="form-row"><label>{{ t('sys_version') }}</label><input class="apple-input" :value="t('brand_version')" readonly></div>
          </div>
          <div class="form-row"><label>{{ t('sys_benchmark') }}</label><input class="apple-input" :value="t('sys_benchmark_val')" readonly></div>
          <div class="form-row"><label>{{ t('language') }} / {{ t('appearance') }}</label><div class="muted" style="font-size:13px">请使用右上角工具栏切换（已持久化到本地）</div></div>
        </div>
      </template>

      <!-- ===== license：License 管理 ===== -->
      <template v-else-if="props.tab==='license' && license">
        <!-- 当前许可证 + 用量 -->
        <div class="grid grid-2">
          <div class="apple-card">
            <div class="flex between" style="margin-bottom:14px">
              <strong style="font-size:16px"><i class="fas fa-key" style="color:var(--color-blue)"></i> {{ t('lic_current') }}</strong>
              <span class="apple-badge" :class="license.is_active?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ license.is_active?t('lic_active'):t('lic_inactive') }}</span>
            </div>
            <table class="kv-table">
              <tr><td>{{ t('lic_edition') }}</td><td><strong>{{ {community:t('lic_ed_community'),standard:t('lic_ed_standard'),enterprise:t('lic_ed_enterprise')}[license.edition] }}</strong></td></tr>
              <tr><td>{{ t('lic_org') }}</td><td>{{ license.organization }}</td></tr>
              <tr><td>{{ t('lic_key') }}</td><td class="mono">{{ license.license_key }}</td></tr>
              <tr><td>{{ t('lic_issued') }}</td><td>{{ license.issued_at }}</td></tr>
              <tr><td>{{ t('lic_expires') }}</td><td>{{ license.expires_at }}</td></tr>
              <tr><td>{{ t('lic_hw_fp') }}</td><td class="mono">{{ license.hardware_fingerprint }}</td></tr>
            </table>
          </div>
          <div class="apple-card">
            <strong style="font-size:16px"><i class="fas fa-gauge" style="color:var(--color-indigo)"></i> {{ t('lic_usage') }}</strong>
            <div style="margin-top:18px">
              <div class="flex between" style="margin-bottom:6px"><span class="muted">{{ t('lic_nodes_usage') }}</span><span class="mono">{{ license.current_nodes }} / {{ license.max_nodes }} ({{ nodesPct }}%)</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:nodesPct+'%',background:usageColor(nodesPct)}"></div></div>
              <div class="flex between" style="margin:18px 0 6px"><span class="muted">{{ t('lic_vms_usage') }}</span><span class="mono">{{ license.current_vms }} / {{ license.max_vms }} ({{ vmsPct }}%)</span></div>
              <div class="usage-bar"><div class="fill" :style="{width:vmsPct+'%',background:usageColor(vmsPct)}"></div></div>
            </div>
            <button class="apple-btn apple-btn--primary" style="margin-top:22px;width:100%"><i class="fas fa-arrow-up-right-dots"></i> {{ t('lic_upgrade') }}</button>
          </div>
        </div>

        <!-- 三版本功能对比 -->
        <div class="section-title"><i class="fas fa-table-list"></i> {{ t('lic_compare') }}</div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table lic-compare">
            <thead>
              <tr>
                <th style="width:200px"></th>
                <th v-for="e in editions" :key="e.key" :class="{'lic-current-col':isCurrent(e)}">
                  {{ edName(e) }}
                  <span v-if="isCurrent(e)" class="apple-badge apple-badge--running" style="margin-left:6px"><span class="dot"></span>{{ t('lic_current_badge') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.label">
                <td><strong>{{ t(row.label) }}</strong></td>
                <td v-for="e in editions" :key="e.key" :class="{'lic-current-col':isCurrent(e)}">
                  <template v-if="row.type==='bool'">
                    <i :class="row.get(e)?'fas fa-circle-check':'fas fa-circle-xmark'" :style="{color:row.get(e)?'var(--color-green)':'var(--text-tertiary)'}"></i>
                  </template>
                  <template v-else>{{ row.get(e) }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="muted" style="margin-top:12px;font-size:13px"><i class="fas fa-circle-info"></i> 企业版支持分布式存储、SDN、Webhook 与不限虚拟机数。{{ t('lic_contact_sales') }}：sales@cloudnexusforging.com</div>
      </template>

      <!-- ===== about：关于系统 ===== -->
      <template v-else-if="props.tab==='about'">
        <div class="apple-card" style="max-width:560px;text-align:center;padding:40px">
          <div class="logo" style="width:64px;height:64px;font-size:28px;margin:0 auto 16px"><i class="fas fa-cube"></i></div>
          <div style="font-size:24px;font-weight:700">{{ t('brand_name') }}</div>
          <div class="muted" style="margin:6px 0 18px">{{ t('brand_sub') }} · {{ t('brand_version') }}</div>
          <table class="kv-table" style="text-align:left">
            <tr><td>{{ t('sys_benchmark') }}</td><td>{{ t('sys_benchmark_val') }}</td></tr>
            <tr><td>{{ t('sys_tech') }}</td><td>FastAPI + libvirt/KVM + Element Plus（生产）/ Hono + Vue 3（原型）</td></tr>
            <tr><td>{{ t('sys_node_role') }}</td><td>Master + Worker（分布式）</td></tr>
          </table>
        </div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.SystemView = SystemView
})()
