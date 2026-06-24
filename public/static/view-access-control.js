// =============================================================================
//  模块视图：访问控制 (view-access-control.js)
//  子标签：users 用户管理 / roles 角色权限（角色定义 + 权限矩阵 + 权限分配）
//          / audit 操作审计。CNF 企业级角色/权限（Roles/Privileges）模型。
// =============================================================================
(function () {
const { ref, onMounted, watch, computed } = Vue
const api = window.api
const t = window.t
const toast = window.cnfToast
const fmt = window.cnfFmtTime

const AccessControlView = {
  props: { tab: { type: String, default: 'users' } },
  setup(props) {
    const users = ref([])
    const roles = ref([])
    const userRoles = ref([])   // 用户角色（1超管/2系统管理员/3运维/4只读）
    const privileges = ref([])
    const assignments = ref([])
    const auditLogs = ref([])
    const selRole = ref(null)

    const load = async () => {
      users.value = await api('/users')
      if (!userRoles.value.length) userRoles.value = await api('/user-roles')
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

    // ============================================================
    //  用户状态徽标
    // ============================================================
    const userStatusMeta = (s) => ({
      active: { cls: 'apple-badge--running', label: t('user_st_active') },
      disabled: { cls: 'apple-badge--stopped', label: t('user_st_disabled') },
      locked: { cls: 'apple-badge--warning', label: t('user_st_locked') },
    }[s] || { cls: 'apple-badge--stopped', label: s })
    const fmtTime = (v) => (v && v !== '—' && v !== '-') ? fmt(v, { mode: 'datetime' }) : '—'

    // ============================================================
    //  用户 创建 / 编辑 对话框
    // ============================================================
    // 默认配额：按角色给出合理预设（精简表单——多数场景无需手填）
    const blankQuota = () => ({ max_vms: 10, max_vcpus: 40, max_memory_gb: 128, max_storage_gb: 1000 })
    const showQuota = ref(false)   // 资源配额折叠为「高级设置」，默认收起
    const userDlg = ref({ open: false, mode: 'create', id: null, form: {}, err: {}, saving: false })
    const openUserCreate = () => {
      showQuota.value = false
      userDlg.value = { open: true, mode: 'create', id: null, saving: false, err: {},
        form: { username: '', display_name: '', email: '', phone: '', password: '', password2: '', role_id: 4, resource_quota: blankQuota() } }
    }
    const openUserEdit = (u) => {
      showQuota.value = false
      userDlg.value = { open: true, mode: 'edit', id: u.id, saving: false, err: {},
        form: { username: u.username, display_name: u.display_name, email: u.email, phone: u.phone || '', password: '', password2: '', role_id: u.role_id, resource_quota: { ...u.resource_quota } } }
    }
    const saveUser = async () => {
      const f = userDlg.value.form; const err = {}; const isCreate = userDlg.value.mode === 'create'
      if (isCreate) {
        if (!f.username || !f.username.trim()) err.username = t('op_required')
        else if (!/^[A-Za-z0-9_]+$/.test(f.username)) err.username = t('user_username_rule')
      }
      if (!f.display_name || !f.display_name.trim()) err.display_name = t('op_required')
      if (!f.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) err.email = t('user_email_invalid')
      if (isCreate) {
        if (!f.password || f.password.length < 6) err.password = t('user_pwd_rule')
        else if (f.password !== f.password2) err.password2 = t('user_pwd_mismatch')
      } else if (f.password) {
        if (f.password.length < 6) err.password = t('user_pwd_rule')
        else if (f.password !== f.password2) err.password2 = t('user_pwd_mismatch')
      }
      userDlg.value.err = err
      if (Object.keys(err).length) return
      userDlg.value.saving = true
      const payload = { display_name: f.display_name, email: f.email, phone: f.phone, role_id: Number(f.role_id), resource_quota: f.resource_quota }
      let res
      if (isCreate) { payload.username = f.username; payload.password = f.password; res = await api('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) }
      else { res = await api('/users/' + userDlg.value.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) }
      userDlg.value.saving = false
      if (res && res.error) {
        if (res.code === 'NAME_DUPLICATE') { userDlg.value.err = { username: res.error }; return }
        if (res.code === 'BAD_USERNAME') { userDlg.value.err = { username: res.error }; return }
        return toast(res.error, 'error')
      }
      toast(isCreate ? t('toast_created') : t('toast_saved'), 'success')
      userDlg.value.open = false
      await load()
    }

    // ---- 启用 / 禁用 ----
    const toggleUserStatus = async (u) => {
      const next = u.status === 'active' ? 'disabled' : 'active'
      const res = await api('/users/' + u.id + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
      if (res && res.error) return toast(res.error, 'error')
      toast(res.message, 'success'); await load()
    }
    // ---- 重置密码 ----
    const resetPwd = async (u) => {
      const res = await api('/users/' + u.id + '/reset-password', { method: 'POST' })
      if (res && res.error) return toast(res.error, 'error')
      toast(res.message, 'success')
    }
    // ---- 删除（运行中 VM 阻止）----
    const blockDlg = ref({ open: false, title: '', message: '', children: [] })
    const confirmDlg = ref({ open: false, user: null })
    const askDeleteUser = (u) => { confirmDlg.value = { open: true, user: u } }
    const doDeleteUser = async () => {
      const u = confirmDlg.value.user; confirmDlg.value.open = false
      const res = await api('/users/' + u.id, { method: 'DELETE' })
      if (res && res.error) {
        if (res.code === 'HAS_RUNNING_VM') return blockDlg.value = { open: true, title: t('user_del_blocked'), message: res.error, children: res.children || [] }
        return toast(res.error, 'error')
      }
      toast(res.message, 'success'); await load()
    }

    return { props, users, roles, userRoles, privileges, assignments, auditLogs, selRole,
      hasPriv, roleName, roleNamesOf, resultBadge,
      userStatusMeta, fmtTime, userDlg, showQuota, openUserCreate, openUserEdit, saveUser,
      toggleUserStatus, resetPwd, blockDlg, confirmDlg, askDeleteUser, doDeleteUser, t }
  },
  template: `
    <div>
      <!-- ===== users：用户管理（完整 CRUD）===== -->
      <template v-if="props.tab==='users'">
        <div class="crud-toolbar">
          <button class="apple-btn apple-btn--primary" @click="openUserCreate"><i class="fas fa-user-plus"></i> {{ t('acc_add_user') }}</button>
          <div class="spacer"></div>
          <span class="muted" style="font-size:13px">{{ users.length }} {{ t('acc_users_title') }}</span>
        </div>
        <div class="apple-card" style="padding:0">
          <table class="apple-table">
            <thead><tr><th>{{ t('acc_username') }}</th><th>{{ t('acc_display_name') }}</th><th>{{ t('acc_email') }}</th><th>{{ t('acc_roles') }}</th><th>{{ t('user_quota') }}</th><th>{{ t('status') }}</th><th>{{ t('acc_last_login') }}</th><th style="width:150px">{{ t('op_actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td><i class="fas fa-user muted"></i> <strong>{{ u.username }}</strong></td>
                <td>{{ u.display_name }}</td>
                <td class="mono muted">{{ u.email }}</td>
                <td><span class="apple-badge apple-badge--running"><span class="dot"></span>{{ u.role_name }}</span></td>
                <td class="mono" style="font-size:12px">
                  <span :title="t('user_quota')">{{ u.resource_usage.current_vms }}/{{ u.resource_quota.max_vms }} VM · {{ u.resource_usage.current_vcpus }}/{{ u.resource_quota.max_vcpus }} vCPU</span>
                </td>
                <td><span class="apple-badge" :class="userStatusMeta(u.status).cls"><span class="dot"></span>{{ userStatusMeta(u.status).label }}</span></td>
                <td class="muted">{{ fmtTime(u.last_login_at || u.last_login) }}</td>
                <td>
                  <button class="icon-btn" :title="t('op_edit')" @click="openUserEdit(u)"><i class="fas fa-pen"></i></button>
                  <button class="icon-btn" :title="u.status==='active'?t('user_disable'):t('user_enable')" @click="toggleUserStatus(u)"><i class="fas" :class="u.status==='active'?'fa-user-slash':'fa-user-check'"></i></button>
                  <button class="icon-btn" :title="t('user_reset_pwd')" @click="resetPwd(u)"><i class="fas fa-key"></i></button>
                  <button class="icon-btn danger" :title="t('op_delete')" @click="askDeleteUser(u)"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 用户 创建/编辑 对话框 -->
        <div v-if="userDlg.open" class="modal-mask" @click.self="userDlg.open=false">
          <div class="modal-dialog modal-lg">
            <div class="modal-head"><i class="fas fa-user-plus" style="color:var(--color-blue)"></i> {{ userDlg.mode==='create' ? t('acc_add_user') : t('user_edit') }}</div>
            <div class="modal-body">
              <div class="form-grid-2">
                <div class="form-row">
                  <label class="req">{{ t('acc_username') }}</label>
                  <input :class="{invalid:userDlg.err.username}" v-model="userDlg.form.username" :disabled="userDlg.mode==='edit'" placeholder="ops_zhang">
                  <div v-if="userDlg.err.username" class="form-err">{{ userDlg.err.username }}</div>
                  <div v-else class="muted" style="font-size:11px;margin-top:4px">{{ t('user_username_rule') }}</div>
                </div>
                <div class="form-row">
                  <label class="req">{{ t('acc_display_name') }}</label>
                  <input :class="{invalid:userDlg.err.display_name}" v-model="userDlg.form.display_name" :placeholder="t('user_display_ph')">
                  <div v-if="userDlg.err.display_name" class="form-err">{{ userDlg.err.display_name }}</div>
                </div>
              </div>
              <div class="form-grid-2">
                <div class="form-row">
                  <label class="req">{{ t('acc_email') }}</label>
                  <input :class="{invalid:userDlg.err.email}" v-model="userDlg.form.email" placeholder="name@example.com">
                  <div v-if="userDlg.err.email" class="form-err">{{ userDlg.err.email }}</div>
                </div>
                <div class="form-row"><label>{{ t('user_phone') }}</label><input v-model="userDlg.form.phone" placeholder="13800138000"></div>
              </div>
              <div class="form-grid-2">
                <div class="form-row">
                  <label :class="{req:userDlg.mode==='create'}">{{ t('user_password') }}</label>
                  <input type="password" :class="{invalid:userDlg.err.password}" v-model="userDlg.form.password" :placeholder="userDlg.mode==='edit'?t('user_pwd_keep'):''">
                  <div v-if="userDlg.err.password" class="form-err">{{ userDlg.err.password }}</div>
                </div>
                <div class="form-row">
                  <label :class="{req:userDlg.mode==='create'}">{{ t('user_password2') }}</label>
                  <input type="password" :class="{invalid:userDlg.err.password2}" v-model="userDlg.form.password2">
                  <div v-if="userDlg.err.password2" class="form-err">{{ userDlg.err.password2 }}</div>
                </div>
              </div>
              <div class="form-row">
                <label class="req">{{ t('acc_roles') }}</label>
                <select v-model.number="userDlg.form.role_id">
                  <option v-for="r in userRoles" :key="r.id" :value="r.id">{{ r.name }}</option>
                </select>
              </div>
              <!-- 资源配额：折叠为「高级设置」，默认收起，避免表单过长 -->
              <div class="advanced-toggle" @click="showQuota=!showQuota">
                <i class="fas" :class="showQuota?'fa-chevron-down':'fa-chevron-right'"></i>
                {{ t('user_quota_advanced') }}
                <span class="muted" style="font-weight:400;font-size:12px">· {{ t('user_quota_default_hint') }}</span>
              </div>
              <div v-show="showQuota" class="quota-fieldset">
                <div class="form-grid-2">
                  <div class="form-row"><label>{{ t('user_max_vms') }}</label><input type="number" min="0" v-model.number="userDlg.form.resource_quota.max_vms"></div>
                  <div class="form-row"><label>{{ t('user_max_vcpus') }}</label><input type="number" min="0" v-model.number="userDlg.form.resource_quota.max_vcpus"></div>
                  <div class="form-row"><label>{{ t('user_max_mem') }} (GB)</label><input type="number" min="0" v-model.number="userDlg.form.resource_quota.max_memory_gb"></div>
                  <div class="form-row"><label>{{ t('user_max_storage') }} (GB)</label><input type="number" min="0" v-model.number="userDlg.form.resource_quota.max_storage_gb"></div>
                </div>
              </div>
            </div>
            <div class="modal-foot">
              <button class="apple-btn apple-btn--ghost" @click="userDlg.open=false">{{ t('op_cancel') }}</button>
              <button class="apple-btn apple-btn--primary" :disabled="userDlg.saving" @click="saveUser"><i v-if="userDlg.saving" class="fas fa-spinner fa-spin"></i> {{ t('op_confirm') }}</button>
            </div>
          </div>
        </div>

        <!-- 删除确认 -->
        <div v-if="confirmDlg.open" class="modal-mask" @click.self="confirmDlg.open=false">
          <div class="modal-dialog modal-sm">
            <div class="modal-head"><i class="fas fa-triangle-exclamation" style="color:var(--color-orange)"></i> {{ t('op_delete') }}</div>
            <div class="modal-body"><p>{{ t('user_del_confirm', { name: confirmDlg.user && confirmDlg.user.display_name }) }}</p></div>
            <div class="modal-foot">
              <button class="apple-btn apple-btn--ghost" @click="confirmDlg.open=false">{{ t('op_cancel') }}</button>
              <button class="apple-btn apple-btn--danger" @click="doDeleteUser">{{ t('op_delete') }}</button>
            </div>
          </div>
        </div>

        <!-- 删除阻止（有运行中 VM）-->
        <div v-if="blockDlg.open" class="modal-mask" @click.self="blockDlg.open=false">
          <div class="modal-dialog modal-sm">
            <div class="modal-head"><i class="fas fa-ban" style="color:var(--color-red)"></i> {{ blockDlg.title }}</div>
            <div class="modal-body">
              <p>{{ blockDlg.message }}</p>
              <div v-if="blockDlg.children.length" class="block-children">
                <span class="apple-badge" v-for="(ch,i) in blockDlg.children" :key="i" style="margin:2px">{{ ch }}</span>
              </div>
            </div>
            <div class="modal-foot"><button class="apple-btn apple-btn--primary" @click="blockDlg.open=false">{{ t('op_close') }}</button></div>
          </div>
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
