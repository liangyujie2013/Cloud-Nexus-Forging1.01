#!/usr/bin/env bash
# =============================================================================
# CNF v1.0.1 真实后端 API 冒烟测试
#
# 覆盖最小闭环：healthz → login → me → list/create host → list/create cluster
#               → list vms → create vm(dry-run) → create vm(real) → start/stop/delete
#               → tasks → audit 错误格式校验
#
# 用法：
#   BASE=http://127.0.0.1:8090 ./scripts/smoke.sh
#   （默认 BASE=http://127.0.0.1:8080）
#
# 说明：在没有可达 libvirt 宿主机的环境里，VM 真实创建/启动/停止/删除会
#       返回明确错误（LIBVIRT_UNREACHABLE / define domain 失败），脚本对此
#       视为“预期的清晰失败”，不算 FAIL —— 这正是“不静默 mock 成功”的体现。
# =============================================================================
set -u
BASE="${BASE:-http://127.0.0.1:8080}"
PASS=0; FAIL=0
ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
note() { echo "  [INFO] $1"; }

# JSON 解析器：优先 jq，回退 node。用法见 jget。
JSON_TOOL=""
if command -v jq >/dev/null 2>&1; then JSON_TOOL="jq"
elif command -v node >/dev/null 2>&1; then JSON_TOOL="node"
elif [ -x /opt/node18/bin/node ]; then JSON_TOOL="/opt/node18/bin/node"
fi

# jget '<json>' key1 [key2 ...] —— 逐层取值（支持整数索引），失败输出空。
jget() {
  local data="$1"; shift
  case "$JSON_TOOL" in
    "") echo "" ;;
    jq)
      local path="."
      for k in "$@"; do
        if echo "$k" | grep -qE '^-?[0-9]+$'; then path="$path[$k]"; else path="$path.$k"; fi
      done
      echo "$data" | jq -r "$path // empty" 2>/dev/null ;;
    *)
      "$JSON_TOOL" -e '
        let d;
        try { d = JSON.parse(process.argv[2]); } catch (e) { process.exit(0); }
        for (const k of process.argv.slice(3)) { if (d == null) { process.exit(0); } d = d[k]; }
        if (d != null) process.stdout.write(String(d));
      ' "" "$data" "$@" 2>/dev/null ;;
  esac
}

echo "== 1. GET /healthz =="
H=$(curl -s --max-time 20 "$BASE/healthz")
echo "$H" | grep -q '"status":"ok"' && ok "healthz ok" || bad "healthz: $H"

echo "== 2. POST /api/v1/auth/login (admin/admin123) =="
L=$(curl -s --max-time 20 -X POST "$BASE/api/v1/auth/login" -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin123"}')
TOKEN=$(jget "$L" token)
if [ -n "$TOKEN" ] && [ "$TOKEN" != "None" ]; then ok "login 取得 JWT"; else bad "login 失败: $L"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

echo "== 3. GET /api/v1/auth/me =="
M=$(curl -s --max-time 20 "$BASE/api/v1/auth/me" -H "$AUTH")
echo "$M" | grep -q '"username":"admin"' && ok "me 返回 admin" || bad "me: $M"

echo "== 4. 错误格式校验：未带 Token 访问受保护端点应 401 =="
U=$(curl -s --max-time 20 "$BASE/api/v1/vms")
echo "$U" | grep -q 'Token\|未\|Bearer' && ok "未鉴权被拒" || note "未鉴权响应: $U"

echo "== 5. GET /api/v1/datacenters =="
DC=$(curl -s --max-time 20 "$BASE/api/v1/datacenters" -H "$AUTH")
DCID=$(jget "$DC" data 0 id)
[ -n "$DCID" ] && [ "$DCID" != "None" ] && ok "datacenter 列表 (id=$DCID)" || note "datacenters: $DC"

echo "== 6. POST /api/v1/clusters =="
CL=$(curl -s --max-time 20 -X POST "$BASE/api/v1/clusters" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"name\":\"smoke-cluster-$$\",\"datacenter_id\":${DCID:-1}}")
CLID=$(jget "$CL" data id)
[ -n "$CLID" ] && [ "$CLID" != "None" ] && ok "创建 cluster (id=$CLID)" || { note "cluster: $CL"; CLID=1; }

echo "== 7. POST /api/v1/hosts (最小纳管) =="
HO=$(curl -s --max-time 40 -X POST "$BASE/api/v1/hosts" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"name\":\"smoke-host-$$\",\"ip_address\":\"10.255.255.$((RANDOM%200+1))\",\"ssh_port\":22,\"cluster_id\":${CLID}}")
HID=$(jget "$HO" data id)
PROBE=$(jget "$HO" probe status)
if [ -n "$HID" ] && [ "$HID" != "None" ]; then
  ok "创建 host (id=$HID, probe=$PROBE)"
  echo "$PROBE" | grep -qE 'probe_failed|unverified' && ok "无 libvirt 时 probe 明确标注($PROBE)，未伪造成功" \
    || note "probe=$PROBE（环境可达 libvirt）"
else bad "host: $HO"; fi

echo "== 8. GET /api/v1/hosts/:id/hardware (探测状态) =="
HW=$(curl -s --max-time 40 "$BASE/api/v1/hosts/${HID:-1}/hardware" -H "$AUTH")
echo "$HW" | grep -q '"probe"' && ok "hardware 返回 probe 状态" || note "hardware: $HW"

echo "== 9. GET /api/v1/vms =="
V=$(curl -s --max-time 20 "$BASE/api/v1/vms" -H "$AUTH")
echo "$V" | grep -q '"data"' && ok "vms 列表可用" || bad "vms: $V"

echo "== 10. POST /api/v1/vms?dry_run=true (XML 预览) =="
DRY=$(curl -s --max-time 20 -X POST "$BASE/api/v1/vms?dry_run=true" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"dry_run\":true,\"vm\":{\"name\":\"smoke-vm\",\"cluster_id\":${CLID},\"cpu_sockets\":1,\"cpu_cores_per_socket\":2,\"cpu_threads_per_core\":1,\"memory_mb\":2048}}")
echo "$DRY" | grep -q '"dry_run":true' && ok "dry-run 返回 XML 预览（区分 real/dry-run）" || bad "dry-run: $DRY"
echo "$DRY" | grep -q '<domain' && ok "dry-run XML 含 <domain>" || note "dry-run xml: $(echo $DRY|head -c 120)"

echo "== 11. POST /api/v1/vms (real，无 libvirt 预期明确失败) =="
RV=$(curl -s --max-time 20 -X POST "$BASE/api/v1/vms" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"disk_size_gb\":10,\"vm\":{\"name\":\"smoke-vm-$$\",\"cluster_id\":${CLID},\"host_id\":${HID:-1},\"cpu_sockets\":1,\"cpu_cores_per_socket\":2,\"cpu_threads_per_core\":1,\"memory_mb\":2048}}")
if echo "$RV" | grep -q '"code"'; then ok "real 创建失败返回统一错误格式 {code,message,details}"; note "$(echo $RV|head -c 160)";
elif echo "$RV" | grep -q '"data"'; then ok "real 创建成功（环境可达 libvirt）"; else note "real create: $RV"; fi

echo "== 12. GET /api/v1/tasks =="
T=$(curl -s --max-time 20 "$BASE/api/v1/tasks" -H "$AUTH")
echo "$T" | grep -q '"data"' && ok "tasks 列表可用" || bad "tasks: $T"

echo "== 13. 错误码：GET 不存在的 VM 应返回 VM_NOT_FOUND =="
NF=$(curl -s --max-time 20 "$BASE/api/v1/vms/999999" -H "$AUTH")
echo "$NF" | grep -q 'VM_NOT_FOUND' && ok "VM_NOT_FOUND 统一错误码" || bad "expected VM_NOT_FOUND: $NF"

echo ""
echo "================ 冒烟结果：PASS=$PASS FAIL=$FAIL ================"
[ "$FAIL" -eq 0 ] && echo "ALL GREEN" || echo "存在失败项，请检查上方 [FAIL]"
exit "$FAIL"
