-- ============================================================================
-- CNFv1.0 数据库迁移 0002：虚拟机、GPU、磁盘/网卡、任务、用户权限、监控
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 虚拟机（核心表，含完整 CPU 拓扑 / 绑核 / NUMA 亲和 / 引导配置）
-- ----------------------------------------------------------------------------
CREATE TABLE vms (
    id                      SERIAL PRIMARY KEY,
    uuid                    UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    -- 层级归属：VM 绑定到主机，主机故障时由 HA 重新调度
    host_id                 INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
    cluster_id              INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    name                    VARCHAR(100) NOT NULL,
    description             TEXT,
    libvirt_uuid            UUID,                 -- libvirt domain UUID

    -- ===== CPU 高级配置（核心差异化）=====
    cpu_sockets             INTEGER NOT NULL DEFAULT 1  CHECK (cpu_sockets > 0),
    cpu_cores_per_socket    INTEGER NOT NULL DEFAULT 1  CHECK (cpu_cores_per_socket > 0),
    cpu_threads_per_core    INTEGER NOT NULL DEFAULT 1  CHECK (cpu_threads_per_core > 0),
    vcpus                   INTEGER GENERATED ALWAYS AS (cpu_sockets * cpu_cores_per_socket * cpu_threads_per_core) STORED,
    cpu_model               VARCHAR(100) NOT NULL DEFAULT 'host-passthrough',
    cpu_pinning             BOOLEAN NOT NULL DEFAULT FALSE,
    -- 绑核映射：[{"vcpu":0,"pcpu":4},{"vcpu":1,"pcpu":5}]
    cpu_pinned_map          JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- 兼容旧字段：单纯的物理 CPU 列表
    cpu_pinned_cpus         JSONB NOT NULL DEFAULT '[]'::jsonb,
    numa_node_affinity      INTEGER NOT NULL DEFAULT -1,   -- -1 表示不绑定 NUMA
    -- VM 内部 NUMA 拓扑（guest NUMA）
    numa_topology           JSONB NOT NULL DEFAULT '[]'::jsonb,
    cpu_shares              INTEGER NOT NULL DEFAULT 1024,
    cpu_quota               INTEGER NOT NULL DEFAULT -1,   -- CFS quota，-1 不限制

    -- ===== 内存配置 =====
    memory_mb               INTEGER NOT NULL CHECK (memory_mb > 0),
    memory_max_mb           INTEGER,                       -- 内存热插上限
    hugepages_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    memory_balloon          BOOLEAN NOT NULL DEFAULT TRUE,

    -- ===== 引导配置 =====
    arch                    VARCHAR(10) NOT NULL DEFAULT 'x86_64',
    machine_type            VARCHAR(50) NOT NULL DEFAULT 'q35',
    boot_mode               boot_mode NOT NULL DEFAULT 'uefi',
    boot_order              JSONB NOT NULL DEFAULT '["hd","cdrom","network"]'::jsonb,
    nvram_path              VARCHAR(500),

    -- ===== 状态与策略 =====
    status                  vm_status NOT NULL DEFAULT 'stopped',
    ha_enabled              BOOLEAN NOT NULL DEFAULT FALSE,
    ha_priority             SMALLINT NOT NULL DEFAULT 3 CHECK (ha_priority BETWEEN 1 AND 5),
    auto_start              BOOLEAN NOT NULL DEFAULT FALSE,
    guest_os                VARCHAR(100),
    guest_agent_ready       BOOLEAN NOT NULL DEFAULT FALSE,
    vnc_port                INTEGER,
    vnc_password            VARCHAR(100),

    metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cluster_id, name)
);
CREATE INDEX idx_vms_host    ON vms(host_id);
CREATE INDEX idx_vms_cluster ON vms(cluster_id);
CREATE INDEX idx_vms_status  ON vms(status);
COMMENT ON TABLE vms IS '虚拟机：完整 CPU 拓扑/绑核/NUMA 亲和/引导配置';
COMMENT ON COLUMN vms.cpu_pinned_map IS 'vCPU→pCPU 绑定映射：[{"vcpu":0,"pcpu":4}]';

-- ----------------------------------------------------------------------------
-- GPU 设备（属于主机，可直通/vGPU 分配给 VM）
-- ----------------------------------------------------------------------------
CREATE TABLE gpu_devices (
    id              SERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    host_id         INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    pci_address     VARCHAR(20) NOT NULL,          -- 0000:81:00.0
    iommu_group     INTEGER,
    vendor          VARCHAR(100),                  -- NVIDIA / AMD / Intel
    vendor_id       VARCHAR(10),                   -- 10de
    device_id       VARCHAR(10),
    model           VARCHAR(200),                  -- NVIDIA A100 80GB
    vram_mb         INTEGER,
    mode            gpu_mode NOT NULL DEFAULT 'passthrough',
    -- vGPU 配置（mdev 类型，如 nvidia-471）
    mdev_type       VARCHAR(100),
    max_instances   INTEGER NOT NULL DEFAULT 1,
    status          gpu_status NOT NULL DEFAULT 'available',
    numa_node       INTEGER NOT NULL DEFAULT -1,   -- GPU 所在 NUMA 节点（亲和优化）
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (host_id, pci_address)
);
CREATE INDEX idx_gpu_host   ON gpu_devices(host_id);
CREATE INDEX idx_gpu_status ON gpu_devices(status);
COMMENT ON TABLE gpu_devices IS 'GPU 设备：PCI 直通 / vGPU(mdev)，含 NUMA 亲和';

-- ----------------------------------------------------------------------------
-- VM ↔ GPU 分配关系
-- ----------------------------------------------------------------------------
CREATE TABLE vm_gpus (
    id              SERIAL PRIMARY KEY,
    vm_id           INTEGER NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
    gpu_device_id   INTEGER NOT NULL REFERENCES gpu_devices(id) ON DELETE CASCADE,
    mdev_uuid       UUID,                          -- vGPU 实例 UUID
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (vm_id, gpu_device_id)
);
CREATE INDEX idx_vm_gpus_vm  ON vm_gpus(vm_id);
CREATE INDEX idx_vm_gpus_gpu ON vm_gpus(gpu_device_id);

-- ----------------------------------------------------------------------------
-- VM 磁盘
-- ----------------------------------------------------------------------------
CREATE TABLE vm_disks (
    id              SERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    vm_id           INTEGER NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
    storage_pool_id INTEGER REFERENCES storage_pools(id) ON DELETE SET NULL,
    name            VARCHAR(100) NOT NULL,
    device          VARCHAR(10) NOT NULL DEFAULT 'vda',  -- vda, vdb...
    bus             disk_bus NOT NULL DEFAULT 'virtio',
    format          VARCHAR(20) NOT NULL DEFAULT 'qcow2', -- qcow2/raw
    path            VARCHAR(500) NOT NULL,
    size_bytes      BIGINT NOT NULL CHECK (size_bytes > 0),
    bootable        BOOLEAN NOT NULL DEFAULT FALSE,
    readonly        BOOLEAN NOT NULL DEFAULT FALSE,
    -- QoS：每秒 IOPS / 带宽限制
    iops_limit      INTEGER NOT NULL DEFAULT 0,
    bps_limit       BIGINT  NOT NULL DEFAULT 0,
    -- 链式克隆 backing file
    backing_file    VARCHAR(500),
    boot_order      INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (vm_id, device)
);
CREATE INDEX idx_vm_disks_vm   ON vm_disks(vm_id);
CREATE INDEX idx_vm_disks_pool ON vm_disks(storage_pool_id);

-- ----------------------------------------------------------------------------
-- VM 网卡
-- ----------------------------------------------------------------------------
CREATE TABLE vm_nics (
    id              SERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    vm_id           INTEGER NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
    network_id      INTEGER REFERENCES networks(id) ON DELETE SET NULL,
    mac_address     MACADDR NOT NULL,
    model           VARCHAR(20) NOT NULL DEFAULT 'virtio',
    ip_address      INET,
    -- 带宽 QoS（kbps）
    inbound_kbps    INTEGER NOT NULL DEFAULT 0,
    outbound_kbps   INTEGER NOT NULL DEFAULT 0,
    -- SR-IOV VF 直通
    sriov_vf        VARCHAR(20),
    order_index     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (vm_id, mac_address)
);
CREATE INDEX idx_vm_nics_vm  ON vm_nics(vm_id);
CREATE INDEX idx_vm_nics_net ON vm_nics(network_id);

-- ----------------------------------------------------------------------------
-- 快照（含 NVRAM）
-- ----------------------------------------------------------------------------
CREATE TABLE vm_snapshots (
    id              SERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    vm_id           INTEGER NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
    parent_id       INTEGER REFERENCES vm_snapshots(id) ON DELETE SET NULL,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    with_memory     BOOLEAN NOT NULL DEFAULT FALSE,
    state_file      VARCHAR(500),
    nvram_file      VARCHAR(500),
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    is_current      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (vm_id, name)
);
CREATE INDEX idx_snapshots_vm ON vm_snapshots(vm_id);

-- ----------------------------------------------------------------------------
-- 用户、角色与权限（RBAC + 多租户预留）
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    username        VARCHAR(64) NOT NULL UNIQUE,
    email           VARCHAR(255) UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,         -- bcrypt
    display_name    VARCHAR(100),
    role            VARCHAR(32) NOT NULL DEFAULT 'viewer',  -- admin/operator/viewer
    tenant_id       INTEGER,                       -- 多租户预留
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_secret      VARCHAR(64),
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_role ON users(role);

-- ----------------------------------------------------------------------------
-- 异步任务（VM 创建/迁移/快照等长耗时操作）
-- ----------------------------------------------------------------------------
CREATE TABLE tasks (
    id              SERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    type            VARCHAR(50) NOT NULL,          -- vm.create / vm.migrate / snapshot.create
    target_type     VARCHAR(50),                   -- vm / host / cluster
    target_id       INTEGER,
    status          task_status NOT NULL DEFAULT 'pending',
    progress        SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    result          JSONB,
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_target ON tasks(target_type, target_id);

-- ----------------------------------------------------------------------------
-- 监控指标（时序，建议后续接 TimescaleDB / Prometheus remote-write）
-- ----------------------------------------------------------------------------
CREATE TABLE metrics_samples (
    id              BIGSERIAL PRIMARY KEY,
    target_type     VARCHAR(20) NOT NULL,          -- host / vm / gpu / storage
    target_id       INTEGER NOT NULL,
    metric          VARCHAR(50) NOT NULL,          -- cpu_usage / gpu_util / mem_used
    value           DOUBLE PRECISION NOT NULL,
    ts              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_metrics_lookup ON metrics_samples(target_type, target_id, metric, ts DESC);

-- ----------------------------------------------------------------------------
-- 审计日志
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(100) NOT NULL,
    resource        VARCHAR(100),
    resource_id     INTEGER,
    ip_address      INET,
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- updated_at 自动更新触发器
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY['datacenters','clusters','hosts','vms','gpu_devices',
                                 'storage_pools','networks','vm_disks','users']) LOOP
        EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
                        FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();', t);
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 默认管理员（密码：admin123，bcrypt，生产环境务必修改）
-- ----------------------------------------------------------------------------
INSERT INTO users (username, email, password_hash, display_name, role)
VALUES ('admin','admin@cnf.local',
        crypt('admin123', gen_salt('bf')), 'Administrator', 'admin')
ON CONFLICT (username) DO NOTHING;
