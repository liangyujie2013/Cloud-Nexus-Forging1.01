// =============================================================================
//  模块视图：访问控制 (view-access-control.js)
//  子标签：users 用户管理 / roles 角色权限（角色定义 + 权限矩阵 + 权限分配）
//          / audit 操作审计。对齐 vSphere 角色/权限（Roles/Privileges）模型。
// =============================================================================
(function () {
const { ref, onMounted, watch } = Vue
const api = window.api
const t = window.t

const AccessControlView = {
  props: { tab: { type: String, default: 'users' } },
  setup(props) {
    const users = ref([])
    const roles = ref([])
    const privileges = ref([])
    const assignments = ref([])
    const auditLogs = ref([])
    const selRole = ref(null)

    const load = async () => {
      if (!users.value.length) users.value = await api('/users')
      if (!roles.value.length) {
        roles.value = await api('/roles')
        if (roles.value.length) selRole.value = roles.value[0]
      }
      if (!privileges.value.length) privileges.value = await api('/privileges')
      if (!assignments.value.length) assignments.value = await api('/permission-assignments')
      if (!auditLogs.value.length) auditLogs.value = await api('/audit-logs')
    }
    onMounted(load)
    watch(() => props.tab, load)

    const hasPriv = (role, p) => role && role.privileges.includes(p)
    const roleName = (key) => t(key)
    const roleNamesOf = (keys) => keys.map((k) => t(k)).join('、')
    const resultBadge = (r) => ({
      success: { cls: 'apple-badge--running', label: t('acc_result_success') },
      failed: { cls: 'apple-badge--error', label: t('acc_result_failed') },
      denied: { cls: 'apple-badge--warning', label: t('acc_result_denied') },
    }[r] || { cls: '', label: r })

    return { props, users, roles, privileges, assignments, auditLogs, selRole, hasPriv, roleName, roleNamesOf, resultBadge, t }
  },
  template: `
    <div>
      <!-- ===== users：用户管理 ===== -->
      <template v-if="props.tab==='users'">
        <div class="toolbar">
          <span class="muted">{{ users.length }} {{ t('acc_users_title') }}</span>
          <div class="spacer"></div>
          <button class="apple-btn apple-btn--primary"><i class="fas fa-user-plus"></i> {{ t('acc_add_user') }}</button>
        </div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('acc_username') }}</th><th>{{ t('acc_display_name') }}</th><th>{{ t('acc_email') }}</th><th>{{ t('acc_roles') }}</th><th>{{ t('acc_source') }}</th><th>{{ t('status') }}</th><th>{{ t('acc_last_login') }}</th></tr></thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td><i class="fas fa-user muted"></i> <strong>{{ u.username }}</strong></td>
                <td>{{ u.display_name }}</td>
                <td class="mono muted">{{ u.email }}</td>
                <td><span class="apple-badge apple-badge--running"><span class="dot"></span>{{ roleNamesOf(u.role_keys) }}</span></td>
                <td><span class="apple-badge">{{ u.source==='ldap'?t('acc_source_ldap'):t('acc_source_local') }}</span></td>
                <td><span class="apple-badge" :class="u.is_active?'apple-badge--running':'apple-badge--stopped'"><span class="dot"></span>{{ u.is_active?t('enabled'):t('disabled') }}</span></td>
                <td class="muted">{{ u.last_login }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== roles：角色权限（角色定义 + 权限矩阵 + 权限分配）===== -->
      <template v-else-if="props.tab==='roles'">
        <div class="perm-layout">
          <!-- 角色列表 -->
          <div class="apple-card" style="padding:8px">
            <div class="toolbar" style="padding:6px 8px"><span class="muted" style="font-size:13px">{{ t('perm_role_def') }}</span><div class="spacer"></div><button class="apple-btn apple-btn--secondary apple-btn--sm"><i class="fas fa-plus"></i></button></div>
            <div class="cc-list-item" v-for="r in roles" :key="r.id" :class="{active:selRole&&selRole.id===r.id}" @click="selRole=r">
              <i class="fas" :class="r.system?'fa-lock':'fa-user-tag'" :style="{color:selRole&&selRole.id===r.id?'var(--color-blue)':'var(--text-tertiary)'}"></i>
              <div style="flex:1">
                <div style="font-weight:600;font-size:14px">{{ roleName(r.key) }}</div>
                <div class="muted" style="font-size:11px">{{ t(r.key+'_desc') }}</div>
              </div>
              <span v-if="r.system" class="apple-badge apple-badge--stopped" style="font-size:10px"><span class="dot"></span>系统</span>
            </div>
          </div>

          <!-- 权限矩阵 -->
          <div v-if="selRole" class="apple-card">
            <div class="flex between" style="margin-bottom:14px">
              <div><div class="setting-title">{{ roleName(selRole.key) }}</div><div class="muted setting-sub">{{ t(selRole.key+'_desc') }}</div></div>
              <span class="apple-badge apple-badge--running"><span class="dot"></span>{{ selRole.privileges.length }} {{ t('perm_privileges') }}</span>
            </div>
            <div class="priv-grid">
              <label class="priv-item" v-for="p in privileges" :key="p" :class="{granted:hasPriv(selRole,p)}">
                <input type="checkbox" :checked="hasPriv(selRole,p)" :disabled="selRole.system">
                <i class="fas" :class="hasPriv(selRole,p)?'fa-circle-check':'fa-circle'" :style="{color:hasPriv(selRole,p)?'var(--color-green)':'var(--text-tertiary)'}"></i>
                <span class="mono" style="font-size:12px">{{ t(p) }}</span>
              </label>
            </div>
          </div>
        </div>

        <!-- 权限分配 -->
        <div class="section-title"><i class="fas fa-users-gear"></i> {{ t('perm_assigned_to') }}</div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('perm_user') }}</th><th>{{ t('perm_role') }}</th><th>{{ t('perm_scope') }}</th><th>{{ t('perm_propagate') }}</th></tr></thead>
            <tbody>
              <tr v-for="a in assignments" :key="a.id">
                <td><i class="fas fa-user muted"></i> <span class="mono" style="font-size:13px">{{ a.user }}</span></td>
                <td><span class="apple-badge apple-badge--running"><span class="dot"></span>{{ roleName(a.role_key) }}</span></td>
                <td><strong>{{ t(a.scope) }}</strong><span class="muted" v-if="a.scope_obj!=='—'"> · {{ a.scope_obj }}</span></td>
                <td><i :class="a.propagate?'fas fa-check':'fas fa-minus'" :style="{color:a.propagate?'var(--color-green)':'var(--text-tertiary)'}"></i></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== audit：操作审计 ===== -->
      <template v-else>
        <div class="toolbar"><span class="muted">{{ auditLogs.length }} {{ t('acc_audit_title') }}</span></div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('acc_audit_time') }}</th><th>{{ t('acc_audit_user') }}</th><th>{{ t('acc_audit_action') }}</th><th>{{ t('acc_audit_resource') }}</th><th>{{ t('acc_audit_ip') }}</th><th>{{ t('acc_audit_result') }}</th><th>{{ t('acc_audit_detail') }}</th></tr></thead>
            <tbody>
              <tr v-for="log in auditLogs" :key="log.id">
                <td class="mono muted">{{ log.ts }}</td>
                <td><i class="fas fa-user muted"></i> {{ log.user }}</td>
                <td class="mono">{{ log.action }}</td>
                <td>{{ log.resource }}</td>
                <td class="mono muted">{{ log.source_ip }}</td>
                <td><span class="apple-badge" :class="resultBadge(log.result).cls"><span class="dot"></span>{{ resultBadge(log.result).label }}</span></td>
                <td class="muted" style="font-size:13px">{{ log.detail }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>`,
}

window.__CNF_VIEWS.AccessControlView = AccessControlView
})()
