# CNF v1.0.1 — 真实 MVP 闭环第一阶段 交付报告 / Verify on Rocky Linux 9

> 一句话：前端不再只连 Hono Mock，**Go 真实后端已打通最小闭环**（登录→纳管/读取宿主机→创建/启动/停止/删除 VM），
> 且在无 libvirt 环境下**全部返回明确错误，绝不伪造成功**。本地 14 步真实 API 冒烟 **14/0 通过**。

---

## 1. 本次改动的文件清单

### 后端（Go）
| 文件 | 改动 | 说明 |
|---|---|---|
| `cnf-source/.env.example` | 改 | 统一为 MySQL DSN，删除 postgres/etcd 残留 |
| `cnf-source/Makefile` | 改 | VERSION=1.0.1；`server`/`test`/`vet` 用 `CGO_ENABLED=1`；migrate 用 `mysql` |
| `internal/api/v1/apierr.go` | 新增 | 统一错误格式 `{code,message,details}` + `audit()` |
| `internal/api/v1/task_handlers.go` | 新增 | `GET /tasks`、`GET /tasks/:id` |
| `internal/api/v1/handlers.go` | 改 | VM 创建支持 `dry_run` 预览(区分 real/dry-run)；start/stop/delete 审计+统一错误 |
| `internal/api/v1/auth_handlers.go` | 改 | 登录写审计 + 统一错误 |
| `internal/api/v1/hierarchy_handlers.go` | 改 | `POST /hosts` 最小纳管 + `probeHostCapabilities` + `getHostHardware` 探测状态 |
| `internal/api/v1/onboarding_handlers.go` | 改 | 纳管写审计 |
| `internal/api/v1/routes.go` | 改 | 注册 `POST /hosts`、`GET /tasks`、`GET /tasks/:id` |
| `internal/model/task.go` (+`task_test.go`) | 改/新增 | `Task.UpdatedAt()` / `MarshalJSON()`（含 `updated_at`/`error`/`target`） |
| `internal/repo/mysql/audit.go` | 新增 | `WriteAudit` / `ListAudit`（audit_logs 表） |
| `internal/repo/mysql/gpu_disk_nic_task.go` | 改 | `GetTask` / `GetTaskByUUID` / `ListTasks` |
| `internal/repo/mysql/hierarchy.go` | 改 | `UpdateHostCapabilities` |
| `internal/service/repository.go` (+`mock_repo_test.go`) | 改 | 接口新增 3 个任务查询方法 |
| `internal/virt/conn_manager.go` | 改 | **NewConnect 包裹 8s 超时**：不可达主机快速返回明确错误，不再长时间挂起 |
| `internal/service/vm_service.go` | 改 | **storage pool / conn 为 nil 时返回明确错误**，杜绝 nil panic |
| `cnf-source/scripts/smoke.sh` | 新增 | 14 步真实 API 冒烟测试脚本 |

### 前端（不大改，仅加双模式开关）
| 文件 | 改动 | 说明 |
|---|---|---|
| `public/static/component-context-menu.js` | 改 | `window.CNF_BACKEND`（demo/real）、`window.api` 注入 Bearer、`cnfLogin()` |
| `public/static/app.js` | 改 | `backendMode` + `toggleBackend` + 工具栏 `REAL/DEMO` 徽标 |
| `public/static/app.css` | 改 | 徽标样式（demo 琥珀/real 绿色） |

---

## 2. 闭环进度（哪些 API 真打通，哪些仍是 demo/mock）

| 能力 | 端点 | 状态 |
|---|---|---|
| 健康检查 | `GET /healthz` | ✅ 真实 |
| 登录 | `POST /auth/login` | ✅ 真实（JWT + bcrypt + 审计） |
| 当前用户 | `GET /auth/me` | ✅ 真实 |
| 数据中心/集群 | `GET/POST /datacenters`,`/clusters` | ✅ 真实（MySQL） |
| 纳管宿主机 | `POST /hosts` | ✅ 真实（落库 provisioning + libvirt 探测 + 审计） |
| 宿主机硬件探测 | `GET /hosts/:id/hardware` | ✅ 真实（probe: verified/probe_failed/unverified） |
| VM 列表/详情/XML | `GET /vms`,`/vms/:id`,`/vms/:id/xml` | ✅ 真实 |
| VM 创建(预览) | `POST /vms?dry_run=true` | ✅ 真实（仅生成 XML，不触碰 libvirt） |
| VM 创建/启动/停止/删除 | `POST /vms` / `:id/start` / `:id/stop` / `DELETE` | ✅ 代码真实（libvirt DefineDomain/Create/Shutdown/Destroy/Undefine）；**无 libvirt 时返回明确错误** |
| 任务/审计 | `GET /tasks`,`/tasks/:id` + audit_logs | ✅ 真实 |

> 关键设计：**libvirt 不可达 = 明确错误**。例如 `POST /hosts` 探测失败返回
> `probe.status="probe_failed"`，原因写明"连接超时(8s)：qemu+tcp 不可达"；
> VM 真实创建在未配置存储池时返回 `{code:"INTERNAL_ERROR", details:{cause:"存储池未就绪..."}}`。
> **没有任何静默 mock 成功。**

---

## 3. 如何启动 Go 后端

```bash
cd cnf-source
# 依赖（Rocky Linux 9）：dnf install -y golang gcc libvirt-devel mariadb-server redis
export CNF_LISTEN_ADDR=:8080
export CNF_MYSQL_DSN='cnf:cnf@tcp(127.0.0.1:3306)/cnf?parseTime=true&charset=utf8mb4&loc=Local'
export CNF_REDIS_ADDR=127.0.0.1:6379
export CNF_JWT_SECRET=change-me
export CNF_MIGRATIONS_DIR=migrations/mysql
# 注意：必须 CGO_ENABLED=1（依赖 libvirt CGO）
CGO_ENABLED=1 go build -o bin/cnf-server ./cmd/cnf-server
./bin/cnf-server     # 自动跑 migrations + 种子 admin/admin123
```
健康检查：`curl http://127.0.0.1:8080/healthz` → `{"status":"ok","version":"1.0.1"}`

## 4. 如何让前端连 Go 后端

1. 启动静态前端（`npm run dev` 或任意静态服务器）。
2. 页面工具栏点击 **DEMO** 徽标 → 切换为 **REAL** → 输入 Go API 地址（如 `http://127.0.0.1:8080/api/v1`）。
3. 此后 `window.api()` 自动带 `Authorization: Bearer <cnf_token>`，登录/主机/VM 列表/创建/启停删全部走真实后端。
4. 再次点击徽标可切回 DEMO（Hono Mock）。两种模式**界面明确区分**。

## 5. 如何在真实 KVM 宿主机上验证（Rocky Linux 9 + libvirt）

```bash
# 宿主机：开启 libvirtd TCP（16509）
dnf install -y libvirt qemu-kvm
# /etc/libvirt/libvirtd.conf:
#   listen_tcp = 1 ; auth_tcp = "none"   (实验环境；生产请用 TLS)
# /etc/sysconfig/libvirtd:  LIBVIRTD_ARGS="--listen"
systemctl enable --now libvirtd
# 验证：virsh -c qemu+tcp://<host_ip>/system nodeinfo

# CNF 侧纳管并探测
TOKEN=$(curl -s -XPOST $API/auth/login -d '{"username":"admin","password":"admin123"}' | jq -r .token)
curl -s -XPOST $API/hosts -H "Authorization: Bearer $TOKEN" \
  -d '{"cluster_id":1,"name":"kvm01","ip_address":"<host_ip>","ssh_port":22}'
#   预期 probe.status=="verified"，回填真实 cpu_model/memory_total_mb/libvirt_version
curl -s -XPOST $API/vms -H "Authorization: Bearer $TOKEN" \
  -d '{"vm":{"name":"t1","host_id":1,...},"disk_size_gb":10}'      # 真实 DefineDomain
curl -s -XPOST $API/vms/1/start -H "Authorization: Bearer $TOKEN"  # 真实 Create
curl -s -XPOST $API/vms/1/stop  -H "Authorization: Bearer $TOKEN"  # 真实 Shutdown
curl -s -XDELETE $API/vms/1     -H "Authorization: Bearer $TOKEN"  # 真实 Undefine
```

## 6. 测试与验证结果
- `CGO_ENABLED=1 go test ./...` → model/service/virt/gpu 全部 **ok**。
- `go vet ./...` → 通过。
- `scripts/smoke.sh`（真实 MariaDB+Redis+Go server）→ **PASS=14 FAIL=0**。
  - 含：healthz / 登录 JWT / me / 未鉴权 401 / 数据中心 / 创建集群 /
    纳管主机(probe_failed) / 硬件探测状态 / VM 列表 / dry-run XML 预览 /
    real 创建返回统一错误 / tasks 列表 / VM_NOT_FOUND 错误码。

## 7. 残留风险 & 下一步
- **存储池装配**：VM 真实创建需要 main 层按集群默认存储池注入 `StoragePool`（当前未配置→明确报错）。下一步：实现 `clusters/:id/storage-pools` 配置并在创建路径注入。
- **libvirt 认证**：当前 `qemu+tcp` 无认证仅适合实验；生产应切 `qemu+tls`。
- **探测耗时**：不可达主机探测约 8–18s（连接超时已封顶），建议后续改为异步任务 + 进度查询。
- **前端**：仅切换了核心路径；图表/快照/迁移等高级视图仍可能依赖 Mock 形状，需逐屏对齐真实响应。
- **未引入**（按约束）：K8s、多租户计费、复杂 HA/DRS。
