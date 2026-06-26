package v1

import (
	"context"
	"fmt"

	"github.com/cnf/cnfv1/internal/onboard"
	"github.com/cnf/cnfv1/internal/repo/mysql"
)

// saveHostCredential 把纳管请求里的 SSH 凭据加密后落库（一对一关联 host）。
//
// password 模式存口令密文；私钥模式存 PEM 私钥密文（auth_type=key）。
func (h *Handlers) saveHostCredential(ctx context.Context, hostID int, req *onboardRequest) error {
	if h.Secret == nil {
		return fmt.Errorf("加密器未初始化")
	}
	authType := "password"
	plain := req.Password
	if req.PrivateKey != "" {
		authType = "key"
		plain = req.PrivateKey
	}
	if plain == "" {
		return fmt.Errorf("既无口令也无私钥，无法保存凭据")
	}
	cipherText, err := h.Secret.EncryptToString(plain)
	if err != nil {
		return err
	}
	sshPort := req.SSHPort
	if sshPort <= 0 {
		sshPort = 22
	}
	sshUser := req.SSHUser
	if sshUser == "" {
		sshUser = "root"
	}
	return h.MySQL.UpsertHostCredential(ctx, mysql.HostCredential{
		HostID:       hostID,
		AuthType:     authType,
		SSHUser:      sshUser,
		SSHPort:      sshPort,
		SecretCipher: cipherText,
	})
}

// loadHostSSHConfig 读取并解密某主机的 SSH 凭据，组装成可用于 onboard.Dial 的配置。
//
// 返回的 onboard.SSHConfig 已填好 Host/Port/User/Password|PrivateKey；
// 主机 IP 取自 hosts 表（凭据表只存端口/用户/密文，IP 以主机记录为准）。
func (h *Handlers) loadHostSSHConfig(ctx context.Context, hostID int) (onboard.SSHConfig, error) {
	var cfg onboard.SSHConfig
	if h.Secret == nil {
		return cfg, fmt.Errorf("加密器未初始化")
	}
	host, err := h.Repo.GetHost(ctx, hostID)
	if err != nil {
		return cfg, fmt.Errorf("主机不存在: %w", err)
	}
	cred, err := h.MySQL.GetHostCredential(ctx, hostID)
	if err != nil {
		return cfg, err // 包含 ErrNoCredential，调用方据此提示用户重新提供凭据
	}
	plain, err := h.Secret.DecryptFromString(cred.SecretCipher)
	if err != nil {
		return cfg, fmt.Errorf("解密 SSH 凭据失败: %w", err)
	}
	cfg.Host = host.IPAddress
	cfg.Port = cred.SSHPort
	cfg.User = cred.SSHUser
	if cred.AuthType == "key" {
		cfg.PrivateKey = []byte(plain)
		if cred.PassphraseCipher != "" {
			// 当前 onboard.SSHConfig 暂不支持带口令私钥；保留扩展位，后续按需补。
			_, _ = h.Secret.DecryptFromString(cred.PassphraseCipher)
		}
	} else {
		cfg.Password = plain
	}
	return cfg, nil
}

// dialHost 用存储的凭据直接建立到目标主机的 SSH 连接（运维功能统一入口）。
func (h *Handlers) dialHost(ctx context.Context, hostID int) (*onboard.SSHClient, error) {
	cfg, err := h.loadHostSSHConfig(ctx, hostID)
	if err != nil {
		return nil, err
	}
	cli, err := onboard.Dial(cfg)
	if err != nil {
		return nil, fmt.Errorf("SSH 连接主机失败（凭据可能已变更，请在主机管理中更新）: %w", err)
	}
	return cli, nil
}
