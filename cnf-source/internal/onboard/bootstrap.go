package onboard

import (
	"fmt"
	"strings"
)

// BootstrapResult 纳管预检与配置结果。
type BootstrapResult struct {
	LibvirtInstalled bool   `json:"libvirt_installed"`
	LibvirtRunning   bool   `json:"libvirt_running"`
	KVMSupported     bool   `json:"kvm_supported"`
	TCPListening     bool   `json:"tcp_listening"`
	TCPPort          int    `json:"tcp_port"`
	Message          string `json:"message"`
}

// Precheck 只读探测目标主机是否满足无代理纳管前置条件，不做任何修改。
func Precheck(c *SSHClient, tcpPort int) (*BootstrapResult, error) {
	if tcpPort == 0 {
		tcpPort = 16509
	}
	r := &BootstrapResult{TCPPort: tcpPort}

	// libvirtd 是否安装
	r.LibvirtInstalled = c.RunQuiet("command -v libvirtd >/dev/null 2>&1 && echo yes") == "yes"

	// KVM 硬件虚拟化支持
	vmx := c.RunQuiet("grep -E -c '(vmx|svm)' /proc/cpuinfo 2>/dev/null")
	kvmDev := c.RunQuiet("test -e /dev/kvm && echo yes")
	r.KVMSupported = atoiSafe(vmx) > 0 || kvmDev == "yes"

	// libvirtd 是否运行
	active := c.RunQuiet("systemctl is-active libvirtd 2>/dev/null")
	r.LibvirtRunning = active == "active"

	// TCP 端口监听状态
	listen := c.RunQuiet(fmt.Sprintf("ss -ltn 2>/dev/null | grep -c ':%d '", tcpPort))
	r.TCPListening = atoiSafe(listen) > 0

	switch {
	case !r.LibvirtInstalled:
		r.Message = "目标主机未安装 libvirt，请先安装 libvirt-daemon 与 qemu-kvm"
	case !r.KVMSupported:
		r.Message = "目标主机 BIOS 未开启硬件虚拟化（VT-x/AMD-V）或 /dev/kvm 不存在"
	case !r.TCPListening:
		r.Message = "libvirtd 未监听 TCP，可调用 EnableTCP 自动开启或手工配置"
	default:
		r.Message = "前置条件满足，可直接以 qemu+tcp 纳管"
	}
	return r, nil
}

// EnableTCP 在目标主机开启 libvirtd TCP 监听（需要 sudo/root）。
//
// 步骤：写 /etc/libvirt/libvirtd.conf 开启 listen_tcp / 关闭 auth_tcp，
// 在 sysconfig 给 libvirtd 加 --listen，重启服务并验证端口。
// 这是纳管阶段唯一会修改目标主机的操作，且仅在用户显式请求时执行。
func EnableTCP(c *SSHClient, tcpPort int) (*BootstrapResult, error) {
	if tcpPort == 0 {
		tcpPort = 16509
	}
	cmds := []string{
		// 备份原配置
		`cp -n /etc/libvirt/libvirtd.conf /etc/libvirt/libvirtd.conf.cnf.bak 2>/dev/null || true`,
		// 开启 TCP 监听与端口
		`sed -i 's/^#\?listen_tcp.*/listen_tcp = 1/' /etc/libvirt/libvirtd.conf`,
		`grep -q '^listen_tcp' /etc/libvirt/libvirtd.conf || echo 'listen_tcp = 1' >> /etc/libvirt/libvirtd.conf`,
		`sed -i 's/^#\?auth_tcp.*/auth_tcp = "none"/' /etc/libvirt/libvirtd.conf`,
		`grep -q '^auth_tcp' /etc/libvirt/libvirtd.conf || echo 'auth_tcp = "none"' >> /etc/libvirt/libvirtd.conf`,
		fmt.Sprintf(`sed -i 's/^#\?tcp_port.*/tcp_port = "%d"/' /etc/libvirt/libvirtd.conf`, tcpPort),
		// 让 libvirtd 以 --listen 启动（EL8 socket 激活需关闭后用传统模式）
		`(grep -q 'LIBVIRTD_ARGS' /etc/sysconfig/libvirtd 2>/dev/null && sed -i 's/^#\?LIBVIRTD_ARGS.*/LIBVIRTD_ARGS="--listen"/' /etc/sysconfig/libvirtd) || echo 'LIBVIRTD_ARGS="--listen"' >> /etc/sysconfig/libvirtd`,
		`systemctl stop libvirtd-tcp.socket libvirtd-tls.socket 2>/dev/null || true`,
		`systemctl restart libvirtd`,
	}
	for _, cmd := range cmds {
		if _, err := c.Run(cmd); err != nil {
			// sed/grep 容错命令已带 || true，真正失败的是 restart
			if strings.Contains(cmd, "restart") {
				return nil, fmt.Errorf("重启 libvirtd 失败: %w", err)
			}
		}
	}
	return Precheck(c, tcpPort)
}
