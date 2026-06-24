// CNFv1.0 管理视图：集群设置（HA/DRS/EVC）+ 权限管理（RBAC）
(function () {
const { ref, reactive, onMounted, computed } = Vue
const api = window.api
const t = window.t

// ============================ 视图：集群设置 ============================
const ClusterConfigView = {
  setup() {
    const configs = ref([])
    const sel = ref(null)        // 当前选中集群配置（深拷贝用于编辑）
    const hosts = ref([])
    const toast = ref('')

    onMounted(async () => {
      configs.value = await api('/cluster-configs')
      hosts.value = await api('/hosts')
      if (configs.value.length) pick(configs.value[0])
    })
    const pick = (c) => { sel.value = JSON.parse(JSON.stringify(c)) }

    // 当前集群成员主机（按 cluster_id 匹配，演示用名称包含匹配）
    const members = computed(() => {
      if (!sel.value) return []
      // 简化：mock host 有 cluster_id；映射 config.id → cluster_id
      return hosts.value.filter(h => h.cluster_id === sel.value.id)
    })

    const save = async () => {
      const r = await api('/cluster-configs/' + sel.value.id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sel.value),
      })
      // 写回列表
      const i = configs.value.findIndex(c => c.id === sel.value.id)
      if (i >= 0) configs.value[i] = JSON.parse(JSON.stringify(sel.value))
      toast.value = r.message || t('cc_saved')
      setTimeout(() => toast.value = '', 3000)
    }

    return { configs, sel, members, pick, save, toast, t }
  },
  template: `
    <div>
      <div v-if="toast" class="apple-alert apple-alert--success" style="margin-bottom:14px"><i class="fas fa-circle-check"></i> {{ toast }}</div>
      <div class="cc-layout">
        <!-- 集群选择列表 -->
        <div class="apple-card" style="padding:8px">
          <div class="cc-list-item" v-for="c in configs" :key="c.id"
               :class="{active: sel && sel.id===c.id}" @click="pick(c)">
            <i class="fas fa-layer-group" :style="{color: sel&&sel.id===c.id ? 'var(--color-blue)':'var(--text-tertiary)'}"></i>
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px">{{ c.name }}</div>
              <div class="muted" style="font-size:11px">
                <span v-if="c.ha_enabled">HA</span><span v-if="c.drs_enabled"> · DRS</span><span v-if="c.evc_enabled"> · EVC</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 配置面板 -->
        <div v-if="sel">
          <!-- vSphere HA -->
          <div class="apple-card setting-block">
            <div class="setting-head">
              <div><div class="setting-title"><i class="fas fa-shield-halved" style="color:var(--color-green)"></i> {{ t('cc_ha') }}</div>
                <div class="muted setting-sub">{{ t('cc_ha_desc') }}</div></div>
              <label class="apple-switch"><input type="checkbox" v-model="sel.ha_enabled"><span class="slider"></span></label>
            </div>
            <div v-if="sel.ha_enabled" class="setting-body">
              <label class="switch-row"><input type="checkbox" v-model="sel.ha_admission_control"> {{ t('cc_admission') }}</label>
              <div class="muted" style="font-size:12px;margin:2px 0 8px 24px">{{ t('cc_admission_desc') }}</div>
              <div class="form-row" v-if="sel.ha_admission_control"><label>{{ t('cc_host_failures') }}</label>
                <input class="apple-input" type="number" min="0" max="4" v-model.number="sel.ha_host_failures" style="max-width:120px"></div>
            </div>
          </div>

          <!-- vSphere DRS -->
          <div class="apple-card setting-block">
            <div class="setting-head">
              <div><div class="setting-title"><i class="fas fa-arrows-rotate" style="color:var(--color-blue)"></i> {{ t('cc_drs') }}</div>
                <div class="muted setting-sub">{{ t('cc_drs_desc') }}</div></div>
              <label class="apple-switch"><input type="checkbox" v-model="sel.drs_enabled"><span class="slider"></span></label>
            </div>
            <div v-if="sel.drs_enabled" class="setting-body">
              <div class="form-row"><label>{{ t('cc_drs_level') }}</label>
                <div class="seg-control" style="background:var(--bg-secondary)">
                  <button class="seg" :class="{active:sel.drs_automation==='manual'}" @click="sel.drs_automation='manual'">{{ t('cc_manual') }}</button>
                  <button class="seg" :class="{active:sel.drs_automation==='partial'}" @click="sel.drs_automation='partial'">{{ t('cc_partial') }}</button>
                  <button class="seg" :class="{active:sel.drs_automation==='full'}" @click="sel.drs_automation='full'">{{ t('cc_full') }}</button>
                </div>
              </div>
              <div class="form-row"><label>{{ t('cc_aggr') }}</label>
                <input type="range" min="1" max="5" v-model.number="sel.drs_aggressiveness" style="flex:1;max-width:260px;accent-color:var(--color-blue)">
                <span class="mono" style="width:20px">{{ sel.drs_aggressiveness }}</span>
              </div>
            </div>
          </div>

          <!-- EVC -->
          <div class="apple-card setting-block">
            <div class="setting-head">
              <div><div class="setting-title"><i class="fas fa-microchip" style="color:var(--color-indigo)"></i> {{ t('cc_evc') }}</div>
                <div class="muted setting-sub">{{ t('cc_evc_desc') }}</div></div>
              <label class="apple-switch"><input type="checkbox" v-model="sel.evc_enabled"><span class="slider"></span></label>
            </div>
            <div v-if="sel.evc_enabled" class="setting-body">
              <div class="form-row"><label>{{ t('cc_evc_baseline') }}</label>
                <select class="apple-input" v-model="sel.evc_baseline" style="max-width:280px">
                  <option>Intel Merom</option><option>Intel Sandy Bridge</option>
                  <option>Intel Haswell</option><option>Intel Broadwell</option>
                  <option>Intel Skylake</option><option>Intel Cascade Lake</option>
                  <option>Intel Ice Lake</option><option>Intel Sapphire Rapids</option>
                  <option>AMD Zen 2</option><option>AMD Zen 3</option><option>AMD Zen 4</option>
                </select>
              </div>
            </div>
          </div>

          <!-- 超分配 -->
          <div class="apple-card setting-block">
            <div class="setting-title" style="margin-bottom:12px"><i class="fas fa-gauge-high" style="color:var(--color-orange)"></i> {{ t('cc_overcommit') }}</div>
            <div class="grid grid-2">
              <div class="form-row"><label>{{ t('cc_cpu_over') }}</label><input class="apple-input" type="number" step="0.5" v-model.number="sel.overcommit_cpu"></div>
              <div class="form-row"><label>{{ t('cc_mem_over') }}</label><input class="apple-input" type="number" step="0.1" v-model.number="sel.overcommit_mem"></div>
            </div>
          </div>

          <!-- 成员主机 -->
          <div class="apple-card setting-block" v-if="members.length">
            <div class="setting-title" style="margin-bottom:10px"><i class="fas fa-server muted"></i> {{ t('cc_members') }} ({{ members.length }})</div>
            <div class="flex" style="flex-wrap:wrap;gap:8px">
              <span v-for="h in members" :key="h.id" class="host-chip">
                <i class="fas fa-server" :style="{color: h.status==='connected'?'var(--color-green)':'var(--color-orange)'}"></i>
                {{ h.name }} <span class="muted">· {{ h.vcpus }}vCPU</span>
              </span>
            </div>
          </div>

          <div style="margin-top:8px">
            <button class="apple-btn apple-btn--primary" @click="save"><i class="fas fa-check"></i> {{ t('apply') }}</button>
          </div>
        </div>
      </div>
    </div>`,
}

// ============================ 视图：权限管理（RBAC）============================
const PermissionsView = {
  setup() {
    const tab = ref('roles')
    const roles = ref([])
    const privileges = ref([])
    const assignments = ref([])
    const selRole = ref(null)

    onMounted(async () => {
      roles.value = await api('/roles')
      privileges.value = await api('/privileges')
      assignments.value = await api('/permission-assignments')
      if (roles.value.length) selRole.value = roles.value[0]
    })

    const hasPriv = (role, p) => role && role.privileges.includes(p)
    const roleName = (key) => t(key)

    return { tab, roles, privileges, assignments, selRole, hasPriv, roleName, t }
  },
  template: `
    <div>
      <div class="seg-control" style="margin-bottom:16px">
        <button class="seg" :class="{active:tab==='roles'}" @click="tab='roles'">{{ t('perm_roles') }}</button>
        <button class="seg" :class="{active:tab==='users'}" @click="tab='users'">{{ t('perm_users') }}</button>
      </div>

      <!-- 角色定义 -->
      <div v-if="tab==='roles'" class="perm-layout">
        <div class="apple-card" style="padding:8px">
          <div class="toolbar" style="padding:6px 8px"><span class="muted" style="font-size:13px">{{ t('perm_role_def') }}</span></div>
          <div class="cc-list-item" v-for="r in roles" :key="r.id" :class="{active:selRole&&selRole.id===r.id}" @click="selRole=r">
            <i class="fas" :class="r.system?'fa-lock':'fa-user-tag'" :style="{color:selRole&&selRole.id===r.id?'var(--color-blue)':'var(--text-tertiary)'}"></i>
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px">{{ roleName(r.key) }}</div>
              <div class="muted" style="font-size:11px">{{ t(r.key+'_desc') }}</div>
            </div>
            <span v-if="r.system" class="apple-badge apple-badge--stopped" style="font-size:10px"><span class="dot"></span>系统</span>
          </div>
        </div>

        <div v-if="selRole" class="apple-card">
          <div class="flex between" style="margin-bottom:14px">
            <div><div class="setting-title">{{ roleName(selRole.key) }}</div>
              <div class="muted setting-sub">{{ t(selRole.key+'_desc') }}</div></div>
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

      <!-- 用户与全局权限 -->
      <div v-if="tab==='users'" class="apple-card" style="padding:0">
        <div class="toolbar" style="padding:12px 16px">
          <span class="muted">{{ assignments.length }} {{ t('perm_assigned_to') }}</span>
          <div class="spacer"></div>
          <button class="apple-btn apple-btn--primary apple-btn--sm"><i class="fas fa-plus"></i> {{ t('perm_add_user') }}</button>
        </div>
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
    </div>`,
}

window.__CNF_VIEWS.ClusterConfigView = ClusterConfigView
window.__CNF_VIEWS.PermissionsView = PermissionsView
})()
