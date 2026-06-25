-- ============================================================================
-- CNF v1.0.1 数据库迁移 0002：虚拟机、GPU、磁盘/网卡/快照、RBAC、任务、监控、审计
-- 目标数据库：MySQL 8.0 / MariaDB 10.5+
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
-- 虚拟机（核心表：完整 CPU 拓扑 / 绑核 / NUMA 亲和 / 引导配置）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vms (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    uuid                    CHAR(36) NOT NULL UNIQUE,
    host_id                 INT NULL,
    cluster_id              INT NOT NULL,
    name                    VARCHAR(100) NOT NULL,
    description             TEXT NULL,
    libvirt_uuid            CHAR(36) NULL,
    -- CPU 高级配置
    cpu_sockets             INT NOT NULL DEFAULT 1,
    cpu_cores_per_socket    INT NOT NULL DEFAULT 1,
    cpu_threads_per_core    INT NOT NULL DEFAULT 1,
    vcpus                   INT GENERATED ALWAYS AS
                            (cpu_sockets * cpu_cores_per_socket * cpu_threads_per_core) STORED,
    cpu_model               VARCHAR(100) NOT NULL DEFAULT 'host-passthrough',
    cpu_pinning             TINYINT(1) NOT NULL DEFAULT 0,
    cpu_pinned_map          JSON NULL,
    cpu_pinned_cpus         JSON NULL,
    numa_node_affinity      INT NOT NULL DEFAULT -1,
    numa_topology           JSON NULL,
    cpu_shares              INT NOT NULL DEFAULT 1024,
    cpu_quota               INT NOT NULL DEFAULT -1,
    -- 内存
    memory_mb               INT NOT NULL,
    memory_max_mb           INT NULL,
    hugepages_enabled       TINYINT(1) NOT NULL DEFAULT 0,
    memory_balloon          TINYINT(1) NOT NULL DEFAULT 1,
    -- 引导
    arch                    VARCHAR(10) NOT NULL DEFAULT 'x86_64',
    machine_type            VARCHAR(50) NOT NULL DEFAULT 'q35',
    boot_mode               ENUM('bios','uefi','uefi_secure') NOT NULL DEFAULT 'uefi',
    boot_order              JSON NULL,
    nvram_path              VARCHAR(500) NULL,
    -- 状态与策略
    status                  ENUM('stopped','starting','running','paused','suspended','migrating','error','deleting')
                            NOT NULL DEFAULT 'stopped',
    ha_enabled              TINYINT(1) NOT NULL DEFAULT 0,
    ha_priority             TINYINT NOT NULL DEFAULT 3,
    auto_start              TINYINT(1) NOT NULL DEFAULT 0,
    guest_os                VARCHAR(100) NULL,
    guest_agent_ready       TINYINT(1) NOT NULL DEFAULT 0,
    vnc_port                INT NULL,
    vnc_password            VARCHAR(100) NULL,
    metadata                JSON NULL,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vms_cluster_name (cluster_id, name),
    KEY idx_vms_host (host_id),
    KEY idx_vms_cluster (cluster_id),
    KEY idx_vms_status (status),
    CONSTRAINT fk_vms_host FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE SET NULL,
    CONSTRAINT fk_vms_cluster FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='虚拟机：CPU 拓扑/绑核/NUMA/引导';

-- ----------------------------------------------------------------------------
-- GPU 设备（属于主机，可直通 / vGPU 分配给 VM）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gpu_devices (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    uuid            CHAR(36) NOT NULL UNIQUE,
    host_id         INT NOT NULL,
    pci_address     VARCHAR(20) NOT NULL,
    iommu_group     INT NULL,
    vendor          VARCHAR(100) NULL,
    vendor_id       VARCHAR(10) NULL,
    device_id       VARCHAR(10) NULL,
    model           VARCHAR(200) NULL,
    vram_mb         INT NULL,
    mode            ENUM('passthrough','vgpu','mdev','none') NOT NULL DEFAULT 'passthrough',
    mdev_type       VARCHAR(100) NULL,
    max_instances   INT NOT NULL DEFAULT 1,
    status          ENUM('available','assigned','error','disabled') NOT NULL DEFAULT 'available',
    numa_node       INT NOT NULL DEFAULT -1,
    metadata        JSON NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_gpu_host_pci (host_id, pci_address),
    KEY idx_gpu_host (host_id),
    KEY idx_gpu_status (status),
    CONSTRAINT fk_gpu_host FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='GPU 设备：直通 / vGPU';

-- ----------------------------------------------------------------------------
-- VM ↔ GPU 分配关系
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vm_gpus (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    vm_id           INT NOT NULL,
    gpu_device_id   INT NOT NULL,
    mdev_uuid       CHAR(36) NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vm_gpu (vm_id, gpu_device_id),
    KEY idx_vm_gpus_vm (vm_id),
    KEY idx_vm_gpus_gpu (gpu_device_id),
    CONSTRAINT fk_vmgpu_vm FOREIGN KEY (vm_id) REFERENCES vms(id) ON DELETE CASCADE,
    CONSTRAINT fk_vmgpu_gpu FOREIGN KEY (gpu_device_id) REFERENCES gpu_devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='VM↔GPU 分配';

-- ----------------------------------------------------------------------------
-- VM 磁盘
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vm_disks (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    uuid            CHAR(36) NOT NULL UNIQUE,
    vm_id           INT NOT NULL,
    storage_pool_id INT NULL,
    name            VARCHAR(100) NOT NULL,
    device          VARCHAR(20) NOT NULL DEFAULT 'disk',
    bus             ENUM('virtio','scsi','sata','ide','nvme') NOT NULL DEFAULT 'virtio',
    format          VARCHAR(20) NOT NULL DEFAULT 'qcow2',
    provisioning    ENUM('thin','thick') NOT NULL DEFAULT 'thin',
    path            VARCHAR(500) NULL,
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    bootable        TINYINT(1) NOT NULL DEFAULT 0,
    readonly        TINYINT(1) NOT NULL DEFAULT 0,
    iops_limit      INT NOT NULL DEFAULT 0,
    bps_limit       BIGINT NOT NULL DEFAULT 0,
    backing_file    VARCHAR(500) NULL,
    boot_order      INT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_vm_disks_vm (vm_id),
    CONSTRAINT fk_disk_vm FOREIGN KEY (vm_id) REFERENCES vms(id) ON DELETE CASCADE,
    CONSTRAINT fk_disk_pool FOREIGN KEY (storage_pool_id) REFERENCES storage_pools(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='VM 磁盘';

-- ----------------------------------------------------------------------------
-- VM 网卡
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vm_nics (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    uuid            CHAR(36) NOT NULL UNIQUE,
    vm_id           INT NOT NULL,
    network_id      INT NULL,
    mac_address     VARCHAR(20) NOT NULL,
    model           VARCHAR(20) NOT NULL DEFAULT 'virtio',
    ip_address      VARCHAR(45) NULL,
    inbound_kbps    INT NOT NULL DEFAULT 0,
    outbound_kbps   INT NOT NULL DEFAULT 0,
    sriov_vf        VARCHAR(64) NULL,
    order_index     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_vm_nics_vm (vm_id),
    CONSTRAINT fk_nic_vm FOREIGN KEY (vm_id) REFERENCES vms(id) ON DELETE CASCADE,
    CONSTRAINT fk_nic_network FOREIGN KEY (network_id) REFERENCES networks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='VM 网卡';

-- ----------------------------------------------------------------------------
-- VM 快照（区分内存快照 / 仅磁盘快照）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vm_snapshots (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    uuid            CHAR(36) NOT NULL UNIQUE,
    vm_id           INT NOT NULL,
    name            VARCHAR(100) NOT NULL,
    description     TEXT NULL,
    include_memory  TINYINT(1) NOT NULL DEFAULT 0,
    parent_name     VARCHAR(100) NULL,
    state           VARCHAR(20) NOT NULL DEFAULT 'created',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_snapshot_vm_name (vm_id, name),
    KEY idx_snapshots_vm (vm_id),
    CONSTRAINT fk_snapshot_vm FOREIGN KEY (vm_id) REFERENCES vms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='VM 快照';

-- ----------------------------------------------------------------------------
-- 角色（RBAC：权限点 JSON 数组，'*' 表示超级权限）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(64) NOT NULL UNIQUE,
    description     VARCHAR(255) NULL,
    permissions     JSON NOT NULL,
    is_builtin      TINYINT(1) NOT NULL DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色（权限点集合）';

-- ----------------------------------------------------------------------------
-- 用户
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    username        VARCHAR(64) NOT NULL UNIQUE,
    display_name    VARCHAR(100) NULL,
    email           VARCHAR(200) NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role_id         INT NULL,
    role            VARCHAR(64) NULL,
    enabled         TINYINT(1) NOT NULL DEFAULT 1,
    last_login      TIMESTAMP NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_users_role (role_id),
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户';

-- ----------------------------------------------------------------------------
-- 异步任务
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    uuid            CHAR(36) NOT NULL UNIQUE,
    type            VARCHAR(64) NOT NULL,
    target_type     VARCHAR(64) NULL,
    target_id       INT NULL,
    status          ENUM('pending','running','success','failed','cancelled') NOT NULL DEFAULT 'pending',
    progress        INT NOT NULL DEFAULT 0,
    user_id         INT NULL,
    payload         JSON NULL,
    result          JSON NULL,
    error_message   TEXT NULL,
    started_at      TIMESTAMP NULL,
    finished_at     TIMESTAMP NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_tasks_status (status),
    KEY idx_tasks_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='异步任务';

-- ----------------------------------------------------------------------------
-- 告警规则
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_rules (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    name             VARCHAR(100) NOT NULL,
    metric           VARCHAR(64) NOT NULL,
    operator         VARCHAR(8) NOT NULL DEFAULT '>',
    threshold        DOUBLE NOT NULL DEFAULT 0,
    duration_seconds INT NOT NULL DEFAULT 60,
    severity         ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
    notify_channel   VARCHAR(100) NULL,
    enabled          TINYINT(1) NOT NULL DEFAULT 1,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='告警规则';

-- ----------------------------------------------------------------------------
-- 指标采样（监控历史趋势，毫秒精度时间戳）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metrics_samples (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    target_type     VARCHAR(32) NOT NULL,
    target_key      VARCHAR(128) NOT NULL,
    metric          VARCHAR(64) NOT NULL,
    value           DOUBLE NOT NULL,
    sampled_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_metrics_lookup (target_type, target_key, metric, sampled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='指标采样（历史趋势）';

-- ----------------------------------------------------------------------------
-- 审计日志
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NULL,
    username        VARCHAR(64) NULL,
    action          VARCHAR(100) NOT NULL,
    resource        VARCHAR(100) NULL,
    resource_id     INT NULL,
    detail          JSON NULL,
    ip_address      VARCHAR(45) NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_audit_user (user_id),
    KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审计日志';

SET FOREIGN_KEY_CHECKS = 1;
