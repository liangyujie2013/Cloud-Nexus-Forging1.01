// Package onboard 实现无代理（agentless）宿主机纳管：
//
//	ssh.go       —— 通过 SSH 在目标主机执行命令（口令 / 私钥两种鉴权）
//	hardware.go  —— 远程采集 CPU/内存/NUMA/GPU/磁盘/网卡/OS/libvirt 真实硬件清单
//	bootstrap.go —— 校验并按需开启 libvirtd TCP 监听，验证 qemu+tcp 可达
//
// 设计原则：优先无代理；仅当某功能必须 agent 时才下发 RPM（本期纳管不需要）。
package onboard

import (
	"bytes"
	"fmt"
	"net"
	"time"

	"golang.org/x/crypto/ssh"
)

// SSHConfig SSH 连接参数。
type SSHConfig struct {
	Host       string
	Port       int
	User       string
	Password   string // 与 PrivateKey 二选一
	PrivateKey []byte // PEM 私钥
	Timeout    time.Duration
}

// SSHClient 一个已建立的 SSH 会话客户端。
type SSHClient struct {
	cli *ssh.Client
}

// Dial 建立 SSH 连接。
//
// 注意：生产环境应校验主机指纹；本期为简化纳管流程使用 InsecureIgnoreHostKey，
// 并在文档中标注——后续可改为 TOFU（首次信任）+ known_hosts 持久化。
func Dial(cfg SSHConfig) (*SSHClient, error) {
	if cfg.Port == 0 {
		cfg.Port = 22
	}
	if cfg.User == "" {
		cfg.User = "root"
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 15 * time.Second
	}

	var auths []ssh.AuthMethod
	if len(cfg.PrivateKey) > 0 {
		signer, err := ssh.ParsePrivateKey(cfg.PrivateKey)
		if err != nil {
			return nil, fmt.Errorf("解析私钥失败: %w", err)
		}
		auths = append(auths, ssh.PublicKeys(signer))
	}
	if cfg.Password != "" {
		auths = append(auths, ssh.Password(cfg.Password))
	}
	if len(auths) == 0 {
		return nil, fmt.Errorf("必须提供口令或私钥")
	}

	clientCfg := &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            auths,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         cfg.Timeout,
	}
	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	cli, err := ssh.Dial("tcp", addr, clientCfg)
	if err != nil {
		return nil, fmt.Errorf("SSH 连接 %s 失败: %w", addr, err)
	}
	return &SSHClient{cli: cli}, nil
}

// Run 执行单条命令，返回标准输出（去尾换行）。
func (c *SSHClient) Run(cmd string) (string, error) {
	sess, err := c.cli.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()
	var out, errBuf bytes.Buffer
	sess.Stdout = &out
	sess.Stderr = &errBuf
	if err := sess.Run(cmd); err != nil {
		return out.String(), fmt.Errorf("命令失败 %q: %v (%s)", cmd, err, errBuf.String())
	}
	return trimTrailingNewline(out.String()), nil
}

// RunQuiet 执行命令，忽略错误只取输出（用于可选探测项）。
func (c *SSHClient) RunQuiet(cmd string) string {
	out, _ := c.Run(cmd)
	return out
}

// Close 关闭连接。
func (c *SSHClient) Close() error {
	if c.cli != nil {
		return c.cli.Close()
	}
	return nil
}

func trimTrailingNewline(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	return s
}
