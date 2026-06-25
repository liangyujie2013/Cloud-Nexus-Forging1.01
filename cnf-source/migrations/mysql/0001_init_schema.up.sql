-- ============================================================================
-- CNF v1.0.1 数据库迁移 0001：层级模型与核心资源表
-- 目标数据库：MySQL 8.0 / MariaDB 10.5+
-- 设计原则：Datacenter → Cluster → Host → VM 四层级联，外键 ON DELETE CASCADE
--           完整体现 NUMA / CPU 绑核 / GPU 直通 / 无代理纳管字段
-- 类型映射：PG INET/CIDR/MACADDR → VARCHAR；JSONB → JSON；ENUM 内联；
--           SERIAL → INT AUTO_INCREMENT；TIMESTAMPTZ → TIMESTAMP；生成列 STORED
-- 引擎/字符集：InnoDB / utf8mb4
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
-- 数据中心（资源层级最顶层）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS datacenters (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    uuid        CHAR(36) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL UNIQUE,
    location    VARCHAR(200) NULL,
    description TEXT NULL,
    timezone    VARCHAR(64) NOT NULL DEFAULT 'UTC',
    tags        JSON NULL,
    metadata    JSON NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据中心（资源层级最顶层）';

-- ----------------------------------------------------------------------------
-- 集群（HA/DRS 边界，资源超分配置 + NTP 时钟基线）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clusters (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    uuid                CHAR(36) NOT NULL UNIQUE,
    datacenter_id       INT NOT NULL,
    name                VARCHAR(100) NOT NULL,
    description         TEXT NULL,
    ha_enabled          TINYINT(1) NOT NULL DEFAULT 0,
    drs_enabled         TINYINT(1) NOT NULL DEFAULT 0,
    drs_aggressiveness  TINYINT NOT NULL DEFAULT 3,
    overcommit_cpu      FLOAT NOT NULL DEFAULT 4.0,
    overcommit_mem      FLOAT NOT NULL DEFAULT 1.0,
    evc_mode            VARCHAR(50) NULL,
    -- NTP 时钟同步（HA 选主与迁移要求各主机时钟一致）
    ntp_mode            ENUM('internal','external') NOT NULL DEFAULT 'external',
    ntp_internal_server VARCHAR(253) NULL,
    ntp_servers         JSON NULL,
    max_clock_offset_ms INT NOT NULL DEFAULT 2000,
    metadata            JSON NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_clusters_dc_name (datacenter_id, name),
    KEY idx_clusters_datacenter (datacenter_id),
    CONSTRAINT fk_clusters_datacenter FOREIGN KEY (datacenter_id)
        REFERENCES datacenters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='集群（HA/DRS 边界）';

-- ----------------------------------------------------------------------------
-- 宿主机（含 CPU 拓扑、NUMA、IOMMU/VFIO 能力、无代理纳管连接信息、硬件清单）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hosts (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    uuid                    CHAR(36) NOT NULL UNIQUE,
    cluster_id              INT NOT NULL,
    name                    VARCHAR(100) NOT NULL,
    hostname                VARCHAR(253) NULL,
    ip_address              VARCHAR(45) NOT NULL,
    -- 无代理纳管：libvirt 远程连接配置
    libvirt_transport       ENUM('tcp','tls','ssh') NOT NULL DEFAULT 'tcp',
    libvirt_port            INT NOT NULL DEFAULT 16509,
    ssh_port                INT NOT NULL DEFAULT 22,
    ssh_user                VARCHAR(64) NOT NULL DEFAULT 'root',
    agent_enabled           TINYINT(1) NOT NULL DEFAULT 0,
    -- 管理网络
    netmask                 VARCHAR(45) NULL,
    gateway                 VARCHAR(45) NULL,
    mgmt_vlan               INT NULL,
    mgmt_nic                VARCHAR(64) NULL,
    -- CPU 拓扑
    cpu_model               VARCHAR(200) NULL,
    cpu_sockets             INT NOT NULL DEFAULT 1,
    cpu_cores_per_socket    INT NOT NULL DEFAULT 1,
    cpu_threads_per_core    INT NOT NULL DEFAULT 1,
    cpu_total_logical       INT GENERATED ALWAYS AS
                            (cpu_sockets * cpu_cores_per_socket * cpu_threads_per_core) STORED,
    cpu_mhz                 INT NULL,
    -- NUMA
    numa_nodes              INT NOT NULL DEFAULT 1,
    numa_topology           JSON NULL,
    -- 内存
    memory_total_mb         BIGINT NOT NULL DEFAULT 0,
    memory_reserved_mb      BIGINT NOT NULL DEFAULT 0,
    hugepages_total         INT NOT NULL DEFAULT 0,
    hugepage_size_kb        INT NOT NULL DEFAULT 2048,
    -- 虚拟化能力
    libvirt_version         VARCHAR(50) NULL,
    qemu_version            VARCHAR(50) NULL,
    iommu_enabled           TINYINT(1) NOT NULL DEFAULT 0,
    vfio_enabled            TINYINT(1) NOT NULL DEFAULT 0,
    sriov_capable           TINYINT(1) NOT NULL DEFAULT 0,
    -- 真实硬件清单（RAID/磁盘/网卡速率/GPU/OS）由纳管时 SSH 采集
    hardware_inventory      JSON NULL,
    os_version              VARCHAR(100) NULL,
    -- 状态
    status                  ENUM('connected','disconnected','maintenance','error','provisioning')
                            NOT NULL DEFAULT 'provisioning',
    maintenance_mode        TINYINT(1) NOT NULL DEFAULT 0,
    last_heartbeat          TIMESTAMP NULL,
    agent_version           VARCHAR(50) NULL,
    metadata                JSON NULL,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_hosts_cluster_name (cluster_id, name),
    UNIQUE KEY uq_hosts_ip (ip_address),
    KEY idx_hosts_cluster (cluster_id),
    KEY idx_hosts_status (status),
    CONSTRAINT fk_hosts_cluster FOREIGN KEY (cluster_id)
        REFERENCES clusters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='宿主机（CPU 拓扑/NUMA/IOMMU/无代理纳管）';

-- ----------------------------------------------------------------------------
-- 存储池（local 属于单主机；nfs/iscsi/fc/ceph 等可被集群共享）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage_pools (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    uuid            CHAR(36) NOT NULL UNIQUE,
    cluster_id      INT NULL,
    host_id         INT NULL,
    name            VARCHAR(100) NOT NULL,
    type            ENUM('local','nfs','iscsi','fc','nvmeof','ceph','distributed')
                    NOT NULL DEFAULT 'local',
    config          JSON NULL,
    target_path     VARCHAR(500) NULL,
    source_path     VARCHAR(500) NULL,
    capacity_bytes  BIGINT NOT NULL DEFAULT 0,
    allocated_bytes BIGINT NOT NULL DEFAULT 0,
    available_bytes BIGINT NOT NULL DEFAULT 0,
    is_shared       TINYINT(1) NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    metadata        JSON NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_storage_pools_cluster (cluster_id),
    KEY idx_storage_pools_host (host_id),
    CONSTRAINT fk_storage_cluster FOREIGN KEY (cluster_id)
        REFERENCES clusters(id) ON DELETE CASCADE,
    CONSTRAINT fk_storage_host FOREIGN KEY (host_id)
        REFERENCES hosts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='存储池：local/NFS/iSCSI/FC/NVMe-oF/Ceph';

-- ----------------------------------------------------------------------------
-- 虚拟交换机（Linux bridge / 分布式交换机，支持 bond / MTU / 上联网卡）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vswitches (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    uuid            CHAR(36) NOT NULL UNIQUE,
    cluster_id      INT NULL,
    name            VARCHAR(100) NOT NULL,
    kind            ENUM('bridge','distributed') NOT NULL DEFAULT 'bridge',
    mtu             INT NOT NULL DEFAULT 1500,
    bond_mode       VARCHAR(32) NULL,
    uplink_nics     JSON NULL,
    metadata        JSON NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_vswitches_cluster (cluster_id),
    CONSTRAINT fk_vswitches_cluster FOREIGN KEY (cluster_id)
        REFERENCES clusters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='虚拟交换机：bridge / 分布式';

-- ----------------------------------------------------------------------------
-- 虚拟网络（挂载到 vSwitch，含 VLAN / DHCP / MTU）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS networks (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    uuid            CHAR(36) NOT NULL UNIQUE,
    cluster_id      INT NULL,
    vswitch_id      INT NULL,
    name            VARCHAR(100) NOT NULL,
    mode            VARCHAR(20) NOT NULL DEFAULT 'bridge',
    bridge_name     VARCHAR(50) NULL,
    vlan_id         INT NULL,
    cidr            VARCHAR(45) NULL,
    gateway         VARCHAR(45) NULL,
    dhcp_enabled    TINYINT(1) NOT NULL DEFAULT 0,
    mtu             INT NOT NULL DEFAULT 1500,
    metadata        JSON NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_networks_cluster (cluster_id),
    KEY idx_networks_vswitch (vswitch_id),
    CONSTRAINT fk_networks_cluster FOREIGN KEY (cluster_id)
        REFERENCES clusters(id) ON DELETE CASCADE,
    CONSTRAINT fk_networks_vswitch FOREIGN KEY (vswitch_id)
        REFERENCES vswitches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='虚拟网络：VLAN / DHCP / MTU';

SET FOREIGN_KEY_CHECKS = 1;
