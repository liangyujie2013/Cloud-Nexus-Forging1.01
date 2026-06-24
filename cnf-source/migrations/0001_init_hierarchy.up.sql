-- ============================================================================
-- CNFv1.0 数据库迁移 0001：扩展、层级模型与核心资源表
-- 目标数据库：PostgreSQL 16
-- 设计原则：Datacenter → Cluster → Host → VM 四层级联，外键级联约束
--           完整体现 NUMA / CPU 绑核 / GPU 直通字段
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 扩展
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 枚举类型
-- ----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE host_status     AS ENUM ('connected','disconnected','maintenance','error','provisioning');
    CREATE TYPE vm_status       AS ENUM ('stopped','starting','running','paused','suspended','migrating','error','deleting');
    CREATE TYPE gpu_status      AS ENUM ('available','assigned','error','disabled');
    CREATE TYPE gpu_mode        AS ENUM ('passthrough','vgpu','mdev','none');
    CREATE TYPE storage_type    AS ENUM ('local','nfs','iscsi','fc','nvmeof','ceph');
    CREATE TYPE disk_bus        AS ENUM ('virtio','scsi','sata','ide','nvme');
    CREATE TYPE boot_mode       AS ENUM ('bios','uefi','uefi_secure');
    CREATE TYPE task_status     AS ENUM ('pending','running','success','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 层级模型：数据中心
-- ----------------------------------------------------------------------------
CREATE TABLE datacenters (
    id          SERIAL PRIMARY KEY,
    uuid        UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    name        VARCHAR(100) NOT NULL UNIQUE,
    location    VARCHAR(200),
    description TEXT,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE datacenters IS '数据中心（资源层级最顶层）';

-- ----------------------------------------------------------------------------
-- 层级模型：集群
-- ----------------------------------------------------------------------------
CREATE TABLE clusters (
    id              SERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    datacenter_id   INTEGER NOT NULL REFERENCES datacenters(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    -- 高可用与动态资源调度
    ha_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    drs_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    drs_aggressiveness SMALLINT NOT NULL DEFAULT 3 CHECK (drs_aggressiveness BETWEEN 1 AND 5),
    -- 资源超分比
    overcommit_cpu  REAL NOT NULL DEFAULT 4.0  CHECK (overcommit_cpu  >= 1.0),
    overcommit_mem  REAL NOT NULL DEFAULT 1.0  CHECK (overcommit_mem  >= 1.0),
    -- EVC / CPU 兼容基线（跨主机迁移）
    evc_mode        VARCHAR(50),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (datacenter_id, name)
);
CREATE INDEX idx_clusters_datacenter ON clusters(datacenter_id);
COMMENT ON TABLE clusters IS '集群（HA/DRS 边界，资源超分配置）';

-- ----------------------------------------------------------------------------
-- 层级模型：宿主机
-- ----------------------------------------------------------------------------
CREATE TABLE hosts (
    id                      SERIAL PRIMARY KEY,
    uuid                    UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    cluster_id              INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    name                    VARCHAR(100) NOT NULL,
    hostname                VARCHAR(253),
    ip_address              INET NOT NULL,
    -- CPU 拓扑
    cpu_model               VARCHAR(200),
    cpu_sockets             INTEGER NOT NULL DEFAULT 1  CHECK (cpu_sockets > 0),
    cpu_cores_per_socket    INTEGER NOT NULL DEFAULT 1  CHECK (cpu_cores_per_socket > 0),
    cpu_threads_per_core    INTEGER NOT NULL DEFAULT 1  CHECK (cpu_threads_per_core > 0),
    cpu_total_logical       INTEGER GENERATED ALWAYS AS (cpu_sockets * cpu_cores_per_socket * cpu_threads_per_core) STORED,
    cpu_mhz                 INTEGER,
    -- NUMA 拓扑（每个 NUMA 节点的 CPU 列表与内存写入 numa_topology）
    numa_nodes              INTEGER NOT NULL DEFAULT 1  CHECK (numa_nodes > 0),
    numa_topology           JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- 内存
    memory_total_mb         BIGINT NOT NULL DEFAULT 0,
    memory_reserved_mb      BIGINT NOT NULL DEFAULT 0,
    hugepages_total         INTEGER NOT NULL DEFAULT 0,
    hugepage_size_kb        INTEGER NOT NULL DEFAULT 2048,
    -- 虚拟化能力
    libvirt_version         VARCHAR(50),
    qemu_version            VARCHAR(50),
    iommu_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
    vfio_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
    -- 状态
    status                  host_status NOT NULL DEFAULT 'provisioning',
    maintenance_mode        BOOLEAN NOT NULL DEFAULT FALSE,
    last_heartbeat          TIMESTAMPTZ,
    agent_version           VARCHAR(50),
    metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cluster_id, name)
);
CREATE INDEX idx_hosts_cluster   ON hosts(cluster_id);
CREATE INDEX idx_hosts_status    ON hosts(status);
CREATE UNIQUE INDEX idx_hosts_ip ON hosts(ip_address);
COMMENT ON TABLE hosts IS '宿主机（含 CPU 拓扑、NUMA、IOMMU/VFIO 能力）';
COMMENT ON COLUMN hosts.numa_topology IS 'NUMA 拓扑明细：[{"node":0,"cpus":[0,1,2,3],"memory_mb":65536}]';

-- ----------------------------------------------------------------------------
-- 存储池（属于集群，可被多主机共享）
-- ----------------------------------------------------------------------------
CREATE TABLE storage_pools (
    id              SERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    cluster_id      INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    type            storage_type NOT NULL DEFAULT 'local',
    -- 连接配置（NFS server/path、iSCSI target/IQN、FC WWN 等）
    config          JSONB NOT NULL DEFAULT '{}'::jsonb,
    mount_path      VARCHAR(500),
    capacity_bytes  BIGINT NOT NULL DEFAULT 0,
    allocated_bytes BIGINT NOT NULL DEFAULT 0,
    is_shared       BOOLEAN NOT NULL DEFAULT FALSE,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cluster_id, name)
);
CREATE INDEX idx_storage_pools_cluster ON storage_pools(cluster_id);
COMMENT ON TABLE storage_pools IS '存储池：统一抽象 local/NFS/iSCSI/FC/NVMe-oF';

-- ----------------------------------------------------------------------------
-- 虚拟网络（属于集群，OVS/Linux Bridge）
-- ----------------------------------------------------------------------------
CREATE TABLE networks (
    id              SERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    cluster_id      INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    -- bridge / ovs / nat / isolated
    mode            VARCHAR(20) NOT NULL DEFAULT 'bridge',
    bridge_name     VARCHAR(50),
    vlan_id         INTEGER CHECK (vlan_id IS NULL OR (vlan_id BETWEEN 0 AND 4094)),
    cidr            CIDR,
    gateway         INET,
    mtu             INTEGER NOT NULL DEFAULT 1500,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cluster_id, name)
);
CREATE INDEX idx_networks_cluster ON networks(cluster_id);
COMMENT ON TABLE networks IS '虚拟网络：OVS / Linux Bridge / VLAN';
