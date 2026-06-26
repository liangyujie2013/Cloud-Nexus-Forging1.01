// Package onboard 实现无代理（agentless）宿主机纳管：
//
//	ssh.go       —— 通过 SSH 在目标主机执行命令（口令 / 私钥两种鉴权）
//	hardware.go  —— 远程采集 CPU/内存/NUMA/GPU/磁盘/网卡/OS/libvirt 真实硬件清单
//	bootstrap.go —— 校验并按需开启 libvirtd TCP 监听，验证 qemu+tcp 可达
//
// 设计原则：优先无代理；仅当某功能必须 agent 时才下发 RPM（本期纳管不需要）。
package onboard

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
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

// RunStream 执行命令并实时回调每一行输出（stdout 与 stderr 合并，逐行推送），
// 用于 SSE 流式安装日志——前端可在命令执行过程中即时看到真实输出。
//
// onLine 在每读到一行时被调用（不含换行符）；命令结束后返回完整输出与错误。
// 即便命令失败，已读到的输出仍会通过 onLine 推送并在返回的 output 中累计。
func (c *SSHClient) RunStream(cmd string, onLine func(line string)) (string, error) {
	sess, err := c.cli.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()

	stdout, err := sess.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	var mu sync.Mutex
	var wg sync.WaitGroup

	pump := func(r io.Reader) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			mu.Lock()
			buf.WriteString(line)
			buf.WriteByte('\n')
			mu.Unlock()
			if onLine != nil {
				onLine(line)
			}
		}
	}

	if err := sess.Start(cmd); err != nil {
		return "", err
	}
	wg.Add(2)
	go pump(stdout)
	go pump(stderr)
	wg.Wait()
	runErr := sess.Wait()

	out := trimTrailingNewline(buf.String())
	if runErr != nil {
		return out, fmt.Errorf("命令失败 %q: %v", cmd, runErr)
	}
	return out, nil
}

// PushFile 将内存中的字节内容写入目标主机指定路径（通过 base64 管道传输，
// 无需额外 sftp 依赖）。用于「离线安装」场景：把平台内置的 RPM 包推送到
// 目标主机后本地安装，规避目标主机 yum/dnf 源不可用的问题。
//
// remotePath 必须为绝对路径；调用方应保证目录已存在（或先 mkdir）。
func (c *SSHClient) PushFile(content []byte, remotePath string) error {
	sess, err := c.cli.NewSession()
	if err != nil {
		return err
	}
	defer sess.Close()

	enc := base64.StdEncoding.EncodeToString(content)
	stdin, err := sess.StdinPipe()
	if err != nil {
		return err
	}
	var errBuf bytes.Buffer
	sess.Stderr = &errBuf
	// 用 base64 -d 解码写入；single-quote 路径避免空格/特殊字符问题。
	cmd := "base64 -d > '" + strings.ReplaceAll(remotePath, "'", `'\''`) + "'"
	if err := sess.Start(cmd); err != nil {
		return err
	}
	if _, werr := io.WriteString(stdin, enc); werr != nil {
		return werr
	}
	stdin.Close()
	if err := sess.Wait(); err != nil {
		return fmt.Errorf("写入远端文件 %s 失败: %v (%s)", remotePath, err, errBuf.String())
	}
	return nil
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
