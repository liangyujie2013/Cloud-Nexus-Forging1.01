-- 0004_host_credentials.up.sql
-- 主机 SSH 凭据加密存储。
--
-- 背景：纳管时用完即弃的 SSH 口令/私钥无法支撑后续运维（防火墙/SELinux/改密码/
-- 改 SSH 端口/实时监控均需再次 SSH 登录目标机）。本表把凭据以 AES-256-GCM 密文存储，
-- 密文形态为 base64(nonce||ciphertext)，密钥来自平台 CNF_SECRET_KEY（不入库）。
--
-- 安全：独立成表（不污染 hosts 主表，便于细粒度授权与审计）；与 hosts 一对一；
-- 主机删除级联清理。绝不存明文。
CREATE TABLE IF NOT EXISTS host_credentials (
    host_id        INT NOT NULL PRIMARY KEY,
    auth_type      ENUM('password','key') NOT NULL DEFAULT 'password',
    ssh_user       VARCHAR(64)  NOT NULL DEFAULT 'root',
    ssh_port       INT          NOT NULL DEFAULT 22,
    -- AES-256-GCM 密文：base64(nonce||ciphertext)。password 模式存口令密文，key 模式存私钥 PEM 密文。
    secret_cipher  TEXT         NOT NULL,
    -- 私钥口令（passphrase）密文，可空。
    passphrase_cipher TEXT      NULL,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_host_credentials_host FOREIGN KEY (host_id)
        REFERENCES hosts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='主机 SSH 凭据（AES-256-GCM 加密存储）';
