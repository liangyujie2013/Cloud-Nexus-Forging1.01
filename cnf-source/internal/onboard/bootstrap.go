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

// InstallStep 自动安装过程中的单步执行结果（用于前端展示安装进度/日志）。
type InstallStep struct {
	Name    string `json:"name"`    // 步骤名（中文，用于 UI 展示）
	Command string `json:"command"` // 实际执行的命令（脱敏后）
	Output  string `json:"output"`  // 命令输出（截断）
	OK      bool   `json:"ok"`      // 是否成功
	Error   string `json:"error,omitempty"`
}

// InstallResult 自动安装 libvirt + KVM 的总体结果。
type InstallResult struct {
	Steps     []InstallStep    `json:"steps"`
	OS        string           `json:"os"`
	Installed bool             `json:"installed"` // 安装是否整体成功
	Precheck  *BootstrapResult `json:"precheck"`  // 安装后的复检结果
	Message   string           `json:"message"`
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
		if _, err := c.Run(sudoWrap(c, cmd)); err != nil {
			// sed/grep 容错命令已带 || true，真正失败的是 restart
			if strings.Contains(cmd, "restart") {
				return nil, fmt.Errorf("重启 libvirtd 失败: %w", err)
			}
		}
	}
	return Precheck(c, tcpPort)
}

// isRoot 判断当前 SSH 会话是否为 root（id -u == 0）。
func isRoot(c *SSHClient) bool {
	return c.RunQuiet("id -u") == "0"
}

// sudoWrap 在非 root 会话下给命令加 sudo -n（免密 sudo）。
// 命令通过 `sudo -n bash -c '...'` 执行，确保管道/重定向也在提权环境下生效。
// 若用户提供了 sudo 密码（sudoPassword），则改用 `sudo -S` 从 stdin 读取密码。
func sudoWrap(c *SSHClient, cmd string) string {
	if isRoot(c) {
		return cmd
	}
	// 非 root：优先免密 sudo（推荐在 sudoers 配置 NOPASSWD）。
	escaped := strings.ReplaceAll(cmd, `'`, `'\''`)
	return "sudo -n bash -c '" + escaped + "'"
}

// detectPkgMgr 探测目标主机包管理器。RHEL 8+ 系一律 dnf；
// 老系统回退 yum；非 RPM 系返回空（暂不支持自动安装）。
func detectPkgMgr(c *SSHClient) string {
	if c.RunQuiet("command -v dnf >/dev/null 2>&1 && echo y") == "y" {
		return "dnf"
	}
	if c.RunQuiet("command -v yum >/dev/null 2>&1 && echo y") == "y" {
		return "yum"
	}
	return ""
}

// InstallVirtualization 在目标主机自动安装并配置 libvirt + KVM（要求 root 或免密 sudo）。
//
// 支持：RHEL 8/9/10 及衍生版（Rocky / AlmaLinux / CentOS Stream），使用 dnf。
// 流程：探测包管理器 → 安装 qemu-kvm/libvirt/驱动/virt-install →
//
//	enable --now libvirtd → 开启 TCP 16509 → 防火墙放行 → 复检。
//
// 该函数是“裸机自动纳管”的核心：用户仅需提供 SSH 凭据即可把一台未装虚拟化
// 组件的机器变为可纳管的 KVM 宿主机。每步均记录命令与输出，便于前端展示与排错。
func InstallVirtualization(c *SSHClient, tcpPort int) (*InstallResult, error) {
	if tcpPort == 0 {
		tcpPort = 16509
	}
	res := &InstallResult{Steps: []InstallStep{}}

	// 0) 采集 OS 信息（用于展示与判定）
	res.OS = c.RunQuiet(`. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"`)

	// 0.1) 探测包管理器
	pm := detectPkgMgr(c)
	if pm == "" {
		res.Message = "目标主机非 RPM 系（未找到 dnf/yum），暂不支持自动安装，请手工安装 libvirt + qemu-kvm"
		return res, fmt.Errorf("unsupported package manager")
	}

	// 权限预检：必须 root 或可免密 sudo，否则安装命令会失败。
	if !isRoot(c) {
		if c.RunQuiet("sudo -n true >/dev/null 2>&1 && echo y") != "y" {
			res.Message = "当前 SSH 用户既非 root 也未配置免密 sudo（NOPASSWD），无法自动安装。请用 root 登录或在目标主机 sudoers 中为该用户配置 NOPASSWD。"
			return res, fmt.Errorf("insufficient privilege for auto-install")
		}
	}

	// 安装步骤（命令 → 友好名称）。dnf 安装 qemu-kvm 等核心包。
	// libvirt-daemon-driver-qemu 在部分发行版由 libvirt 元包带入，单列以确保 QEMU 驱动存在。
	pkgs := "qemu-kvm libvirt libvirt-daemon-driver-qemu libvirt-client virt-install"
	steps := []struct {
		name string
		cmd  string
		// fatal 为 true 时该步失败则整体失败
		fatal bool
	}{
		{"安装虚拟化软件包（qemu-kvm/libvirt/virt-install）", pm + " install -y " + pkgs, true},
		{"启动并设置开机自启 libvirtd", "systemctl enable --now libvirtd", true},
		{"加载 KVM 内核模块", "modprobe kvm 2>/dev/null; modprobe kvm_intel 2>/dev/null; modprobe kvm_amd 2>/dev/null; true", false},
	}

	for _, s := range steps {
		out, err := c.Run(sudoWrap(c, s.cmd))
		step := InstallStep{Name: s.name, Command: s.cmd, Output: truncate(out, 600), OK: err == nil}
		if err != nil {
			step.Error = err.Error()
			res.Steps = append(res.Steps, step)
			if s.fatal {
				res.Message = "自动安装失败于：" + s.name
				// 仍返回已收集的步骤，便于前端排错
				pc, _ := Precheck(c, tcpPort)
				res.Precheck = pc
				return res, fmt.Errorf("%s 失败: %w", s.name, err)
			}
			continue
		}
		res.Steps = append(res.Steps, step)
	}

	// 开启 libvirtd TCP 监听（复用 EnableTCP，内部已带 sudo 包装）。
	if _, err := EnableTCP(c, tcpPort); err != nil {
		res.Steps = append(res.Steps, InstallStep{
			Name: "配置 libvirtd TCP 监听", Command: "EnableTCP", OK: false, Error: err.Error(),
		})
	} else {
		res.Steps = append(res.Steps, InstallStep{
			Name: fmt.Sprintf("配置 libvirtd TCP 监听（端口 %d）", tcpPort), Command: "EnableTCP", OK: true,
		})
	}

	// 防火墙放行 TCP 16509（firewalld 存在则放行；不存在则跳过，内网场景可忽略）。
	fwCmd := fmt.Sprintf(
		`if systemctl is-active firewalld >/dev/null 2>&1; then firewall-cmd --permanent --add-port=%d/tcp && firewall-cmd --reload; else echo 'firewalld 未运行，跳过'; fi`,
		tcpPort,
	)
	fwOut, fwErr := c.Run(sudoWrap(c, fwCmd))
	res.Steps = append(res.Steps, InstallStep{
		Name: fmt.Sprintf("防火墙放行 TCP %d", tcpPort), Command: fwCmd,
		Output: truncate(fwOut, 300), OK: fwErr == nil,
		Error: errString(fwErr),
	})

	// 复检：安装与配置后的真实状态。
	pc, err := Precheck(c, tcpPort)
	if err != nil {
		return res, err
	}
	res.Precheck = pc
	res.Installed = pc.LibvirtInstalled && pc.LibvirtRunning
	if res.Installed && pc.TCPListening {
		res.Message = "libvirt + KVM 自动安装并配置完成，TCP " + fmt.Sprintf("%d", tcpPort) + " 已监听"
	} else if res.Installed {
		res.Message = "libvirt 已安装并运行，但 TCP 端口未监听，请检查 libvirtd 配置或防火墙"
	} else {
		res.Message = "安装命令已执行，但 libvirtd 未处于运行状态：" + pc.Message
	}
	return res, nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…(截断)"
	}
	return s
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
