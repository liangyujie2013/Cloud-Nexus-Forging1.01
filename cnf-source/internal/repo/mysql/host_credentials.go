package mysql

import (
	"context"
	"database/sql"
	"errors"
)

// HostCredential 主机 SSH 凭据（密文形态，secret_cipher / passphrase_cipher 为
// base64(nonce||ciphertext)；明文加解密由上层 secret.Cipher 负责，本层只读写密文）。
type HostCredential struct {
	HostID           int
	AuthType         string // password | key
	SSHUser          string
	SSHPort          int
	SecretCipher     string // password 模式：口令密文；key 模式：私钥 PEM 密文
	PassphraseCipher string // 私钥口令密文，可空
}

// ErrNoCredential 主机未存储 SSH 凭据。
var ErrNoCredential = errors.New("主机未存储 SSH 凭据")

// UpsertHostCredential 写入/更新主机凭据（密文）。
func (r *Repository) UpsertHostCredential(ctx context.Context, c HostCredential) error {
	if c.AuthType == "" {
		c.AuthType = "password"
	}
	if c.SSHUser == "" {
		c.SSHUser = "root"
	}
	if c.SSHPort <= 0 {
		c.SSHPort = 22
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO host_credentials (host_id, auth_type, ssh_user, ssh_port, secret_cipher, passphrase_cipher)
		VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			auth_type=VALUES(auth_type),
			ssh_user=VALUES(ssh_user),
			ssh_port=VALUES(ssh_port),
			secret_cipher=VALUES(secret_cipher),
			passphrase_cipher=VALUES(passphrase_cipher)`,
		c.HostID, c.AuthType, c.SSHUser, c.SSHPort, c.SecretCipher, nullStr(c.PassphraseCipher),
	)
	return err
}

// 注：nullStr(s string) sql.NullString 已在 helpers.go 中定义，此处直接复用。

// GetHostCredential 读取主机凭据（密文）。无记录返回 ErrNoCredential。
func (r *Repository) GetHostCredential(ctx context.Context, hostID int) (*HostCredential, error) {
	var c HostCredential
	var pass sql.NullString
	err := r.db.QueryRowContext(ctx, `
		SELECT host_id, auth_type, ssh_user, ssh_port, secret_cipher, COALESCE(passphrase_cipher,'')
		FROM host_credentials WHERE host_id=?`, hostID,
	).Scan(&c.HostID, &c.AuthType, &c.SSHUser, &c.SSHPort, &c.SecretCipher, &pass)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoCredential
	}
	if err != nil {
		return nil, err
	}
	c.PassphraseCipher = pass.String
	return &c, nil
}

// HasHostCredential 是否已存储凭据。
func (r *Repository) HasHostCredential(ctx context.Context, hostID int) bool {
	var x int
	err := r.db.QueryRowContext(ctx, `SELECT 1 FROM host_credentials WHERE host_id=?`, hostID).Scan(&x)
	return err == nil
}

// UpdateHostCredentialSSHPort 仅更新凭据里的 ssh_port（改 SSH 端口功能用）。
func (r *Repository) UpdateHostCredentialSSHPort(ctx context.Context, hostID, port int) error {
	_, err := r.db.ExecContext(ctx, `UPDATE host_credentials SET ssh_port=? WHERE host_id=?`, port, hostID)
	return err
}

// UpdateHostCredentialPassword 改密码成功后，同步更新存储的口令密文（仅 password 模式）。
func (r *Repository) UpdateHostCredentialPassword(ctx context.Context, hostID int, secretCipher string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE host_credentials SET auth_type='password', secret_cipher=? WHERE host_id=?`,
		secretCipher, hostID)
	return err
}
