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

	// libvirt 是否安装：单体 libvirtd 或模块化 virtqemud 任一存在即视为已安装
	// （EL10 默认无单体 libvirtd，只有 virtqemud，旧判定会误报「未安装」）。
	r.LibvirtInstalled = c.RunQuiet(
		"{ command -v libvirtd >/dev/null 2>&1 || command -v virtqemud >/dev/null 2>&1 || rpm -q libvirt >/dev/null 2>&1; } && echo yes") == "yes"

	// KVM 硬件虚拟化支持
	vmx := c.RunQuiet("grep -E -c '(vmx|svm)' /proc/cpuinfo 2>/dev/null")
	kvmDev := c.RunQuiet("test -e /dev/kvm && echo yes")
	r.KVMSupported = atoiSafe(vmx) > 0 || kvmDev == "yes"

	// libvirt 是否运行：单体看 libvirtd；模块化看 virtqemud.socket/.service 任一 active。
	// 模块化采用 socket 激活，.service 平时不常驻，故 .socket active 即算「就绪」。
	runCnt := c.RunQuiet("systemctl is-active libvirtd virtqemud.socket virtqemud.service 2>/dev/null | grep -c active")
	r.LibvirtRunning = atoiSafe(runCnt) > 0

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

// EnableTCP 在目标主机开启 libvirt 远程 TCP 监听（需要 sudo/root）。
//
// 这是纳管阶段唯一会修改目标主机的操作，且仅在用户显式请求时执行。
// 按目标主机的守护进程模式自动选择正确实现：
//   - EL8 单体 libvirtd：改 libvirtd.conf + LIBVIRTD_ARGS="--listen"，重启 libvirtd。
//   - EL9/EL10 模块化：通过 virtproxyd-tcp.socket（socket 激活）开启监听。
func EnableTCP(c *SSHClient, tcpPort int) (*BootstrapResult, error) {
	if tcpPort == 0 {
		tcpPort = 16509
	}
	osMajor := c.RunQuiet(`. /etc/os-release 2>/dev/null; echo "${VERSION_ID%%.*}"`)
	model := detectServiceModel(c, osMajor)
	if err := enableTCPForModel(c, model, tcpPort, func(string) {}); err != nil {
		return nil, err
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

// virtComponent 描述一个虚拟化计算组件及其在目标主机上的「已安装」探测命令。
type virtComponent struct {
	Pkg   string // dnf 包名
	Probe string // 探测命令：输出 "yes" 表示已安装
	Desc  string // 中文角色描述（用于日志展示）
}

// coreComponents 平台纳管所需的核心虚拟化计算组件清单（按 RHEL 8/9/10 通用）。
// 每个组件都带一条只读探测命令，用于「检测目标主机已装了什么、缺什么」。
func coreComponents() []virtComponent {
	return []virtComponent{
		{Pkg: "qemu-kvm", Probe: "command -v qemu-kvm >/dev/null 2>&1 || command -v qemu-system-x86_64 >/dev/null 2>&1 || rpm -q qemu-kvm >/dev/null 2>&1", Desc: "QEMU/KVM 虚拟化引擎"},
		{Pkg: "libvirt", Probe: "command -v libvirtd >/dev/null 2>&1 || rpm -q libvirt >/dev/null 2>&1", Desc: "libvirt 虚拟化管理守护"},
		{Pkg: "libvirt-client", Probe: "command -v virsh >/dev/null 2>&1 || rpm -q libvirt-client >/dev/null 2>&1", Desc: "virsh 客户端"},
		{Pkg: "libvirt-daemon-driver-qemu", Probe: "rpm -q libvirt-daemon-driver-qemu >/dev/null 2>&1", Desc: "libvirt QEMU 驱动"},
		{Pkg: "virt-install", Probe: "command -v virt-install >/dev/null 2>&1 || rpm -q virt-install >/dev/null 2>&1", Desc: "虚拟机安装工具"},
	}
}

// detectMissingComponents 逐个探测核心组件，返回「缺失」的包名列表。
// 已安装的组件直接跳过，不会重复安装（满足「装了就不装、缺什么补什么」）。
func detectMissingComponents(c *SSHClient, emitter *StepEmitter) (missing []string, summary string) {
	var present, absent []string
	for _, comp := range coreComponents() {
		ok := c.RunQuiet(comp.Probe+" && echo yes") == "yes"
		if ok {
			present = append(present, comp.Pkg)
			emitter.line(fmt.Sprintf("  ✓ 已安装：%-30s %s", comp.Pkg, comp.Desc))
		} else {
			absent = append(absent, comp.Pkg)
			missing = append(missing, comp.Pkg)
			emitter.line(fmt.Sprintf("  ✗ 缺失  ：%-30s %s", comp.Pkg, comp.Desc))
		}
	}
	summary = fmt.Sprintf("已安装 %d 项，缺失 %d 项", len(present), len(absent))
	return missing, summary
}

// InstallOptions 控制自动安装行为。
type InstallOptions struct {
	TCPPort int
	// OfflineRepo 平台离线包仓库。这是平台集成的核心能力：
	// 纳管时先检测目标主机缺哪些虚拟化组件，凡平台预置了适配该 OS 版本的离线依赖包，
	// 即直接推送到目标主机本地安装（--disablerepo='*'，完全不依赖目标主机的 yum/dnf 在线源）；
	// 仅当平台尚未预置该 OS 版本的离线包时，才回退使用目标主机自带在线源。
	OfflineRepo *OfflineRepo
	// PreferOffline 已废弃：现在只要平台预置了离线包就默认离线优先，无需此开关。
	// 保留字段仅为向后兼容，置任何值都不再改变行为。
	PreferOffline bool
}

// StepEmitter 流式回调：onStep 在每个安装步骤开始时调用，onLine 在该步骤产生
// 每行输出时调用，onStepDone 在步骤结束时携带最终结果。可全为 nil（非流式）。
type StepEmitter struct {
	OnStep     func(name, command string)
	OnLine     func(line string)
	OnStepDone func(step InstallStep)
}

func (e *StepEmitter) step(name, cmd string) {
	if e != nil && e.OnStep != nil {
		e.OnStep(name, cmd)
	}
}
func (e *StepEmitter) line(s string) {
	if e != nil && e.OnLine != nil {
		e.OnLine(s)
	}
}
func (e *StepEmitter) done(s InstallStep) {
	if e != nil && e.OnStepDone != nil {
		e.OnStepDone(s)
	}
}

// InstallVirtualization 在目标主机自动安装并配置 libvirt + KVM（要求 root 或免密 sudo）。
// 非流式封装：内部委托 InstallVirtualizationStream（不带回调）。
func InstallVirtualization(c *SSHClient, tcpPort int) (*InstallResult, error) {
	return InstallVirtualizationStream(c, InstallOptions{TCPPort: tcpPort}, nil)
}

// InstallVirtualizationStream 自动安装的核心实现，支持流式日志回调；离线包优先。
//
// 支持：RHEL 8/9/10 及衍生版（Rocky / AlmaLinux / CentOS Stream），使用 dnf。
// 流程：探测包管理器 → 判定守护进程模式（EL8 单体 / EL9·EL10 模块化）→
//
//	检测已装/缺失虚拟化组件（装了就不装）→ 补齐缺失组件
//	（平台离线包优先：缺什么由平台推送对应离线 RPM 本地安装，不依赖目标机在线源；
//	 平台未预置该 OS 离线包时才回退目标机自带源）→
//	系统健康修复（对齐 openssl/systemd 防符号断裂）→
//	按模式启动守护进程（单体 libvirtd / 模块化 virtqemud.socket）→
//	按模式开启 TCP 16509（libvirtd.conf / virtproxyd-tcp.socket）→ 防火墙放行 → 复检。
//
// 每步通过 emitter 实时回传命令、逐行输出与结果，前端可在白色方块里看到真实执行状态。
func InstallVirtualizationStream(c *SSHClient, opts InstallOptions, emitter *StepEmitter) (*InstallResult, error) {
	tcpPort := opts.TCPPort
	if tcpPort == 0 {
		tcpPort = 16509
	}
	res := &InstallResult{Steps: []InstallStep{}}

	// 0) 采集 OS 信息（用于展示、判定与离线包匹配）
	res.OS = c.RunQuiet(`. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"`)
	osMajor := c.RunQuiet(`. /etc/os-release 2>/dev/null; echo "${VERSION_ID%%.*}"`)
	osTag := OSTagFromMajor(osMajor)

	// 0.0) 提前确定 libvirt 守护进程模式（EL8 单体 / EL9·EL10 模块化），
	//      并立刻告知用户——避免「跑了半天才发现用错模式而失败」的体验。
	model := detectServiceModel(c, osMajor)
	emitter.line(fmt.Sprintf("◆ 目标系统：%s（主版本 el%s）", orDash(res.OS), orDash(osMajor)))
	emitter.line(fmt.Sprintf("◆ libvirt 守护进程模式：%s", model.String()))
	switch model {
	case modelMonolithic:
		emitter.line("  （EL8 默认单体 libvirtd：将用 systemctl enable --now libvirtd 启动）")
	case modelModular:
		emitter.line("  （EL9/EL10 模块化：将启用 virtqemud.socket 等，socket 激活，远程走 virtproxyd-tcp.socket）")
	}

	// 记录并推送一个步骤的工具函数。
	record := func(step InstallStep) {
		res.Steps = append(res.Steps, step)
		emitter.done(step)
	}

	// 0.1) 探测包管理器
	pm := detectPkgMgr(c)
	if pm == "" {
		res.Message = "目标主机非 RPM 系（未找到 dnf/yum），暂不支持自动安装，请手工安装 libvirt + qemu-kvm"
		record(InstallStep{Name: "探测包管理器", Command: "command -v dnf/yum", OK: false, Error: res.Message})
		return res, fmt.Errorf("unsupported package manager")
	}

	// 权限预检：必须 root 或可免密 sudo，否则安装命令会失败。
	if !isRoot(c) {
		if c.RunQuiet("sudo -n true >/dev/null 2>&1 && echo y") != "y" {
			res.Message = "当前 SSH 用户既非 root 也未配置免密 sudo（NOPASSWD），无法自动安装。请用 root 登录或在目标主机 sudoers 中为该用户配置 NOPASSWD。"
			record(InstallStep{Name: "权限检查", Command: "sudo -n true", OK: false, Error: res.Message})
			return res, fmt.Errorf("insufficient privilege for auto-install")
		}
	}

	// 1) 检测目标主机已安装的虚拟化组件，得出「缺什么」。
	//    已安装的组件直接跳过；只补齐缺失部分。
	detectName := fmt.Sprintf("检测虚拟化计算组件（%s）", orDash(res.OS))
	emitter.step(detectName, "rpm -q / command -v 逐项探测")
	missing, summary := detectMissingComponents(c, emitter)
	record(InstallStep{Name: detectName, Command: "detect-components", Output: summary, OK: true})

	// 1.0) 若核心组件齐全，跳过安装直接进入服务配置阶段（装了就不装）。
	if len(missing) == 0 {
		emitter.line("✓ 核心虚拟化组件已齐全，跳过安装，直接进入服务配置阶段")
		record(InstallStep{Name: "安装虚拟化计算组件", Command: "skip", Output: "组件已齐全，无需安装", OK: true})
	} else {
		// 2) 补齐缺失组件：平台离线包优先。
		//    平台预置了适配该 OS 版本的离线依赖包 → 直接推送本地安装（不依赖目标机在线源）；
		//    平台未预置 → 回退目标主机自带的 dnf/yum 在线源。
		hasOffline := opts.OfflineRepo != nil && opts.OfflineRepo.HasPackagesFor(osTag)
		installOK := false
		var installErr error

		// 离线推送安装：把平台预置的 RPM（该 osTag + common）推到目标机本地安装。
		tryOffline := func() bool {
			if opts.OfflineRepo == nil {
				return false
			}
			name := fmt.Sprintf("平台推送离线依赖包并本地安装（%s · 缺 %d 项）", orDash(osTag), len(missing))
			emitter.step(name, "push RPMs → dnf install --disablerepo='*'")
			emitter.line(fmt.Sprintf("缺失组件：%s", strings.Join(missing, " ")))
			out, oerr := opts.OfflineRepo.PushAndInstall(c, osTag, emitter.line)
			st := InstallStep{Name: name, Command: "offline-install", Output: truncate(out, 4000), OK: oerr == nil}
			if oerr != nil {
				st.Error = oerr.Error()
			}
			record(st)
			return oerr == nil
		}

		// 在线安装：仅安装缺失的包（dnf 自动跳过已装项）。
		tryOnline := func() bool {
			onlineName := fmt.Sprintf("目标主机在线源安装缺失组件（缺 %d 项）", len(missing))
			onlineCmd := pm + " install -y " + strings.Join(missing, " ")
			emitter.step(onlineName, onlineCmd)
			out, err := c.RunStream(sudoWrap(c, onlineCmd), emitter.line)
			st := InstallStep{Name: onlineName, Command: onlineCmd, Output: truncate(out, 4000), OK: err == nil}
			if err != nil {
				st.Error = err.Error()
				installErr = err
			}
			record(st)
			return err == nil
		}

		if hasOffline {
			// 平台已预置适配该 OS 的离线包 → 离线优先（平台集成能力，不依赖目标机源）。
			emitter.line(fmt.Sprintf("✓ 平台已预置适配 %s 的离线依赖包，将直接推送本地安装（无需目标主机访问在线源）", orDash(osTag)))
			installOK = tryOffline()
			// 离线失败 → 再尝试目标主机自带在线源兜底。
			if !installOK {
				emitter.line("⚠️ 离线推送安装失败，尝试目标主机自带在线源兜底...")
				installOK = tryOnline()
			}
		} else {
			// 平台未预置该 OS 离线包 → 用目标主机自带在线源（请提前在平台准备离线包以摆脱此依赖）。
			if opts.OfflineRepo != nil {
				emitter.line(fmt.Sprintf("ℹ️ 平台尚未预置适配 %s 的离线依赖包，本次使用目标主机自带在线源安装；建议在平台「离线安装包」预置 %s 包以摆脱在线源依赖", orDash(osTag), orDash(osTag)))
			}
			installOK = tryOnline()
		}

		if !installOK {
			res.Message = "补齐缺失虚拟化组件失败"
			if opts.OfflineRepo != nil && !hasOffline {
				res.Message += fmt.Sprintf("（平台未预置适配 %s 的离线包，且目标主机在线源不可用）", orDash(osTag))
			} else if hasOffline {
				res.Message += "（离线推送与在线源兜底均失败）"
			}
			pc, _ := Precheck(c, tcpPort)
			res.Precheck = pc
			if installErr != nil {
				return res, fmt.Errorf("安装虚拟化软件包失败: %w", installErr)
			}
			return res, fmt.Errorf("安装虚拟化软件包失败")
		}
	}

	// 1.5) 系统健康修复（关键，防止「跳过安装」时遗留的部分升级 ABI 断裂）：
	//      即便核心组件已齐全，目标机也可能因历史失败安装处于「新 systemd + 旧 openssl-libs」
	//      状态——此时 systemctl 一运行就符号查找失败（status 127）。这里用离线包里的
	//      系统基础包（openssl-libs/systemd/glibc 等）做一次 dnf upgrade 对齐，先把系统修好，
	//      再去碰 systemctl。仅当平台预置了该 OS 离线基础包时执行；否则静默跳过。
	if opts.OfflineRepo != nil && opts.OfflineRepo.HasPackagesFor(osTag) {
		name := "系统健康修复（对齐 openssl/systemd 防符号断裂）"
		emitter.step(name, "offline base dnf upgrade")
		did, out, rerr := opts.OfflineRepo.RepairSystemABI(c, osTag, emitter.line)
		if !did {
			emitter.line("（离线仓库未含系统基础包，跳过健康修复）")
			record(InstallStep{Name: name, Command: "skip", Output: "无系统基础离线包，跳过", OK: true})
		} else {
			st := InstallStep{Name: name, Command: "offline-base-upgrade", Output: truncate(out, 2000), OK: rerr == nil}
			if rerr != nil {
				st.Error = rerr.Error()
			}
			record(st)
		}
	}

	// 2) 启动 libvirt 守护进程（按版本选择正确模式：EL8 单体 / EL9·EL10 模块化）。
	//    替代旧的「无脑 systemctl enable --now libvirtd」——在 EL10 上单体已弃用/不可用。
	{
		name := "启动并设置开机自启 libvirt 守护进程"
		emitter.step(name, "startLibvirtService("+model.String()+")")
		cmd, out, err := startLibvirtService(c, model, emitter.line)
		st := InstallStep{Name: name, Command: cmd, Output: truncate(out, 800), OK: err == nil}
		if err != nil {
			st.Error = err.Error()
			record(st)
			res.Message = "libvirt 守护进程启动失败（" + model.String() + "）"
			pc, _ := Precheck(c, tcpPort)
			res.Precheck = pc
			return res, fmt.Errorf("%s 失败: %w", name, err)
		}
		record(st)
	}

	// 3) 加载 KVM 内核模块（非致命）
	{
		name := "加载 KVM 内核模块"
		cmd := "modprobe kvm 2>/dev/null; modprobe kvm_intel 2>/dev/null; modprobe kvm_amd 2>/dev/null; true"
		emitter.step(name, cmd)
		out, err := c.RunStream(sudoWrap(c, cmd), emitter.line)
		record(InstallStep{Name: name, Command: cmd, Output: truncate(out, 300), OK: err == nil, Error: errString(err)})
	}

	// 4) 开启远程 TCP 监听（按模式：EL8 走 libvirtd.conf+--listen；EL9/EL10 走 virtproxyd-tcp.socket）
	{
		name := fmt.Sprintf("配置 libvirt 远程 TCP 监听（端口 %d · %s）", tcpPort, model.String())
		emitter.step(name, "enableTCPForModel")
		err := enableTCPForModel(c, model, tcpPort, emitter.line)
		st := InstallStep{Name: name, Command: "enableTCPForModel", OK: err == nil}
		if err != nil {
			st.Error = err.Error()
		}
		record(st)
	}

	// 5) 防火墙放行 TCP（firewalld 存在则放行；不存在则跳过）
	{
		name := fmt.Sprintf("防火墙放行 TCP %d", tcpPort)
		fwCmd := fmt.Sprintf(
			`if systemctl is-active firewalld >/dev/null 2>&1; then firewall-cmd --permanent --add-port=%d/tcp && firewall-cmd --reload; else echo 'firewalld 未运行，跳过'; fi`,
			tcpPort,
		)
		emitter.step(name, fwCmd)
		fwOut, fwErr := c.RunStream(sudoWrap(c, fwCmd), emitter.line)
		record(InstallStep{Name: name, Command: fwCmd, Output: truncate(fwOut, 300), OK: fwErr == nil, Error: errString(fwErr)})
	}

	// 6) 复检
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

func orDash(s string) string {
	if s == "" {
		return "未知系统"
	}
	return s
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
