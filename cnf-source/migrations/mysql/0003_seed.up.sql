-- ============================================================================
-- CNF v1.0.1 数据库迁移 0003：内置角色 / 管理员 / 默认数据中心
-- 目标数据库：MySQL 8.0 / MariaDB 10.5+
-- UPSERT 采用 INSERT ... ON DUPLICATE KEY UPDATE，VALUES() 写法兼容 MariaDB
-- ============================================================================

SET NAMES utf8mb4;

-- ----------------------------------------------------------------------------
-- 内置角色
--   admin    : '*' 超级权限
--   operator : 计算/存储/网络的全部操作权限
--   viewer   : 各资源只读
-- ----------------------------------------------------------------------------
INSERT INTO roles (name, description, permissions, is_builtin) VALUES
    ('admin', '系统管理员（全部权限）', JSON_ARRAY('*'), 1),
    ('operator', '运维操作员', JSON_ARRAY(
        'vm.read','vm.create','vm.delete','vm.power','vm.migrate','vm.snapshot',
        'host.read','host.create','host.update','host.delete',
        'storage.read','storage.create','storage.update','storage.delete',
        'network.read','network.create','network.delete',
        'datacenter.read','cluster.read',
        'gpu.read','monitor.read','monitor.update'
    ), 1),
    ('viewer', '只读用户', JSON_ARRAY(
        'vm.read','host.read','storage.read','network.read',
        'datacenter.read','cluster.read','gpu.read','monitor.read'
    ), 1)
ON DUPLICATE KEY UPDATE
    description = VALUES(description),
    permissions = VALUES(permissions),
    is_builtin  = VALUES(is_builtin);

-- ----------------------------------------------------------------------------
-- 默认管理员账号  admin / admin123
-- 密码哈希为 bcrypt(cost=10)，已离线验证对应明文 "admin123"
-- ----------------------------------------------------------------------------
INSERT INTO users (username, display_name, email, password_hash, role_id, role, enabled)
SELECT 'admin', '系统管理员', 'admin@cnf.local',
       '$2a$10$Pt/n8/QKcaOKbJxmqA91E.WPuHXjcj.BR2FZiSLK/igR.urYxQBeu',
       r.id, 'admin', 1
FROM roles r WHERE r.name = 'admin'
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    role_id      = VALUES(role_id),
    role         = VALUES(role);

-- ----------------------------------------------------------------------------
-- 说明：不再预置任何「默认数据中心 / 集群 / 主机」等业务数据。
-- 生产落地要求全真实数据：数据中心、集群、宿主机均由用户在 UI 中真实创建/纳管。
-- 本迁移仅初始化登录必需的内置角色与管理员账号（admin / admin123）。
-- ----------------------------------------------------------------------------
