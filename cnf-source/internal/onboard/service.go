package onboard

import (
	"fmt"
	"strings"
)

// 本文件集中处理 RHEL/Rocky/AlmaLinux 8 / 9 / 10 三代在 libvirt「守护进程模式」上的
// 根本差异，是「8/9/10 一次性写对」的关键。背景（来自 libvirt.org/daemons.html 与
// Rocky 10 Release Notes）：
//
//   • EL8（RHEL/Rocky/Alma 8）：默认 **单体守护进程 libvirtd**。
//        启动：systemctl enable --now libvirtd
//        远程 TCP：libvirtd.conf 里 listen_tcp=1 + LIBVIRTD_ARGS="--listen"，或 libvirtd-tcp.socket。
//
//   • EL9（RHEL/Rocky/Alma 9）：默认 **模块化守护进程 virtqemud 等**（libvirtd 仍在，但已弃用）。
//        正确做法：用 socket 激活的 virtqemud.socket（及 virtnetworkd/virtstoraged/... ），
//        远程 TCP 走 virtproxyd-tcp.socket（端口 16509）。
//
//   • EL10（RHEL/Rocky/Alma 10）：**单体 libvirtd 已弃用/不再作为默认**，
//        官方明确「Use the modular daemons and sockets as replacements」。
//        因此必须用 virtqemud.socket + virtproxyd（远程），直接 `enable --now libvirtd`
//        在 EL10 上极易失败（甚至 unit 不存在 / socket-only 配置使其无意义）。
//        当 socket 激活时，libvirtd.conf 里的 listen_tcp/tcp_port 全部被忽略，
//        必须改由 systemd 的 *.socket 单元控制监听。
//
// 设计目标：根据探测到的 OS 主版本选定正确模式，并在「单体可用就用单体、否则用模块化」
// 之间做稳健回退；同时提供 TCP 开启的版本化实现。

// serviceModel 表示目标主机应采用的 libvirt 守护进程模式。
type serviceModel int

const (
	modelUnknown    serviceModel = iota
	modelMonolithic              // 单体 libvirtd（EL8 默认）
	modelModular                 // 模块化 virtqemud + sockets（EL9/EL10 推荐/必需）
)

func (m serviceModel) String() string {
	switch m {
	case modelMonolithic:
		return "单体 libvirtd"
	case modelModular:
		return "模块化 virtqemud + sockets"
	default:
		return "未知"
	}
}

// modularDriverDaemons 为模块化模式下需要启用的二级/主驱动守护进程集合。
// qemu 是主 hypervisor 驱动；network/nodedev/nwfilter/secret/storage/interface 为支撑驱动。
// proxy 仅在需要远程访问（TCP）时单独处理。
var modularDriverDaemons = []string{
	"virtqemud",
	"virtnetworkd",
	"virtstoraged",
	"virtnodedevd",
	"virtnwfilterd",
	"virtsecretd",
	"virtinterfaced",
}

// detectServiceModel 依据 OS 主版本与目标主机实际存在的 systemd 单元，决定守护进程模式。
//
// 判定逻辑（稳健、可回退）：
//   - EL10+：强制模块化（单体在 EL10 已不作为默认/可能不可用）。
//   - EL9 ：优先模块化（默认即模块化）；若系统上确实只装了单体 libvirtd.service
//     且无 virtqemud.service，则回退单体。
//   - EL8 ：优先单体；若系统上反而是模块化布局（无 libvirtd.service 而有 virtqemud.service）
//     则回退模块化（兼容用户自定义 / 衍生镜像）。
//   - 主版本未知：以「哪个 unit 存在」为准，二者皆无则按单体（dnf 装包后再检测）。
func detectServiceModel(c *SSHClient, osMajor string) serviceModel {
	hasLibvirtd := unitExists(c, "libvirtd.service")
	hasVirtqemud := unitExists(c, "virtqemud.service")
	return decideServiceModel(osMajor, hasLibvirtd, hasVirtqemud)
}

// decideServiceModel 是 detectServiceModel 的纯函数内核（不依赖 SSH，便于单测）。
// 入参：OS 主版本字符串 + 目标机是否存在 libvirtd.service / virtqemud.service 两个单元。
func decideServiceModel(osMajor string, hasLibvirtd, hasVirtqemud bool) serviceModel {
	switch {
	case osMajor == "10" || gtMajor(osMajor, 10):
		// EL10+：模块化是唯一受支持方式。
		return modelModular
	case osMajor == "9":
		if hasVirtqemud {
			return modelModular
		}
		if hasLibvirtd {
			return modelMonolithic
		}
		return modelModular // 装包后通常会出现 virtqemud
	case osMajor == "8":
		if hasLibvirtd {
			return modelMonolithic
		}
		if hasVirtqemud {
			return modelModular
		}
		return modelMonolithic
	default:
		// 未知版本：以实际存在的 unit 为准。
		if hasLibvirtd {
			return modelMonolithic
		}
		if hasVirtqemud {
			return modelModular
		}
		return modelMonolithic
	}
}

// unitExists 判断目标主机上是否存在某个 systemd 单元（service/socket）。
// 用 `systemctl cat` / list-unit-files 判定，避免误判 socket-only 场景。
func unitExists(c *SSHClient, unit string) bool {
	out := c.RunQuiet(fmt.Sprintf(
		"systemctl list-unit-files %s 2>/dev/null | grep -c '^%s' ", unit, unit))
	if atoiSafe(out) > 0 {
		return true
	}
	// 兜底：unit 文件可能未被 list（如已 mask），用 cat 再确认。
	return c.RunQuiet(fmt.Sprintf("systemctl cat %s >/dev/null 2>&1 && echo yes", unit)) == "yes"
}

// gtMajor 判断 osMajor（字符串）是否 > n。
func gtMajor(osMajor string, n int) bool {
	return atoiSafe(osMajor) > n
}

// startLibvirtService 按选定的服务模式，在目标主机启动并设置开机自启 libvirt 守护进程。
// 返回实际执行的命令描述与合并输出；错误时附带可读信息。
//
// 这是替代旧的「无脑 systemctl enable --now libvirtd」的核心：
//   - 单体：enable --now libvirtd（EL8）
//   - 模块化：unmask + enable + start 各 virt*d.socket（EL9/EL10，socket 激活，
//     首次连接时自动拉起 .service，无需手动 start .service）
func startLibvirtService(c *SSHClient, model serviceModel, emit func(string)) (cmdDesc string, out string, err error) {
	switch model {
	case modelMonolithic:
		// EL8 的 libvirtd 默认即 **socket 激活**（libvirtd.socket / libvirtd-ro.socket 出厂 enabled）。
		// 因此正确做法是启用并启动这些 socket（首次连接时自动拉起 libvirtd.service），
		// 而 **不能** 直接 `systemctl start libvirtd` 叠加 `--listen`——后者与 socket 激活互斥，
		// libvirtd 会以 status=6/NOTCONFIGURED 报「--listen parameter not permitted with
		// systemd activation sockets」并启动失败（真机 EL8 已复现）。
		emit("[服务模式] 单体 libvirtd（EL8 默认，socket 激活）→ 启用 libvirtd.socket / -ro.socket")
		// 先清理可能残留的失败状态（历史上误用 --listen 导致的 failed）。
		_, _ = c.Run(sudoWrap(c, "systemctl reset-failed libvirtd 2>/dev/null || true"))
		// 清掉历史误写的 --listen，避免下次 socket 拉起 service 时再次冲突。
		_, _ = c.Run(sudoWrap(c, `sed -i '/^LIBVIRTD_ARGS/d' /etc/sysconfig/libvirtd 2>/dev/null || true`))
		_, _ = c.Run(sudoWrap(c, "systemctl daemon-reload 2>/dev/null || true"))
		cmd := strings.Join([]string{
			"systemctl unmask libvirtd.socket libvirtd-ro.socket libvirtd-admin.socket 2>/dev/null || true",
			"systemctl enable --now libvirtd.socket libvirtd-ro.socket libvirtd-admin.socket 2>/dev/null || true",
		}, " ; ")
		o, _ := c.RunStream(sudoWrap(c, cmd), emit)
		// 校验：libvirtd.socket active（或 service 已 active）即视为就绪。
		ok := c.RunQuiet("systemctl is-active libvirtd.socket libvirtd.service 2>/dev/null | grep -cx active")
		if atoiSafe(ok) == 0 {
			// 兜底：socket 不可用时尝试直接拉起 service（无 --listen）。
			emit("⚠️ libvirtd.socket 未激活，尝试直接启动 libvirtd.service（不带 --listen）兜底...")
			o2, _ := c.RunStream(sudoWrap(c, "systemctl enable --now libvirtd 2>/dev/null || true"), emit)
			o += "\n" + o2
			ok = c.RunQuiet("systemctl is-active libvirtd.socket libvirtd.service 2>/dev/null | grep -cx active")
			if atoiSafe(ok) == 0 {
				return cmd, o, fmt.Errorf("libvirtd 单体守护进程启动失败（socket 与 service 均未激活）")
			}
		}
		emit("✓ 单体 libvirtd 就绪（socket 激活，首次连接自动拉起 libvirtd.service）")
		return cmd, o, nil

	case modelModular:
		emit("[服务模式] 模块化 virtqemud + sockets（EL9/EL10 推荐/必需）")
		emit("说明：模块化采用 socket 激活——启用并启动各 virt*d.socket，首次连接时自动拉起对应 .service。")

		// 1) 若历史上启了单体 libvirtd（混用会冲突），先停掉其 service 与 socket。
		stopMono := "systemctl stop libvirtd.service libvirtd{,-ro,-admin,-tcp,-tls}.socket 2>/dev/null || true"
		_, _ = c.Run(sudoWrap(c, stopMono))

		// 2) 先 daemon-reload，确保新装包带来的 unit 文件被 systemd 感知（关键：
		//    刚装完 libvirt-daemon-driver-qemu 后若不 reload，systemctl 可能仍看不到 virtqemud.*）。
		_, _ = c.Run(sudoWrap(c, "systemctl daemon-reload 2>/dev/null || true"))

		var sb strings.Builder
		// 3) 逐个驱动：unmask → enable → start 其 socket（rw/ro/admin）。
		//    不再用 unitExists 预先跳过（其判定在某些镜像上不可靠，导致全被跳过 → 啥也没启）。
		//    直接对所有驱动执行（每条都 || true 容错），最终以 virtqemud 是否就绪为准。
		for _, drv := range modularDriverDaemons {
			steps := []string{
				fmt.Sprintf("systemctl unmask %s.service 2>/dev/null || true", drv),
				fmt.Sprintf("systemctl unmask %s.socket %s-ro.socket %s-admin.socket 2>/dev/null || true", drv, drv, drv),
				fmt.Sprintf("systemctl enable %s.socket %s-ro.socket %s-admin.socket 2>/dev/null || true", drv, drv, drv),
				fmt.Sprintf("systemctl start %s.socket %s-ro.socket %s-admin.socket 2>/dev/null || true", drv, drv, drv),
			}
			joined := strings.Join(steps, " ; ")
			emit(fmt.Sprintf("[模块化] 启用并启动 %s 的 socket（rw/ro/admin）", drv))
			o, _ := c.RunStream(sudoWrap(c, joined), emit)
			sb.WriteString(o)
			sb.WriteString("\n")
		}

		// 4) 校验主驱动是否就绪（socket active 或 service active 均算就绪）。
		if modularReady(c) {
			emit("✓ 模块化守护进程就绪：virtqemud 已激活（首次连接将自动拉起 virtqemud.service）")
			return "modular: enable virt*d.socket", sb.String(), nil
		}

		// 5) 未就绪 → 尝试直接拉起 virtqemud.service 兜底。
		emit("⚠️ virtqemud.socket 未激活，尝试直接启动 virtqemud.service 兜底...")
		o, _ := c.RunStream(sudoWrap(c, "systemctl enable --now virtqemud.service 2>/dev/null || true"), emit)
		sb.WriteString(o)
		if modularReady(c) {
			emit("✓ 模块化守护进程就绪（virtqemud.service 直启成功）")
			return "modular: enable virt*d.socket", sb.String(), nil
		}

		// 6) 仍未就绪：极可能是模块化 daemon 包未安装（virtqemud 单元根本不存在）。
		//    给出可执行的清晰诊断，而不是泛泛的"未就绪"。
		diag := diagnoseModular(c)
		sb.WriteString("\n[诊断]\n")
		sb.WriteString(diag)
		emit("✗ 模块化守护进程仍未就绪。诊断：")
		for _, ln := range strings.Split(diag, "\n") {
			if strings.TrimSpace(ln) != "" {
				emit("  " + ln)
			}
		}
		return "modular: enable virt*d.socket", sb.String(),
			fmt.Errorf("模块化守护进程未就绪：virtqemud 单元缺失或无法启动（多为模块化 daemon 包未安装，详见诊断）")

	default:
		return "", "", fmt.Errorf("无法确定 libvirt 守护进程模式")
	}
}

// modularReady 判断模块化主驱动 virtqemud 是否就绪：socket 或 service 任一 active 即可。
func modularReady(c *SSHClient) bool {
	cnt := c.RunQuiet("systemctl is-active virtqemud.socket virtqemud.service 2>/dev/null | grep -cx active")
	return atoiSafe(cnt) > 0
}

// diagnoseModular 收集模块化未就绪的可执行诊断信息（unit 是否存在、相关包是否安装、报错原因）。
func diagnoseModular(c *SSHClient) string {
	var b strings.Builder
	// virtqemud unit 是否存在
	unit := c.RunQuiet("systemctl list-unit-files 'virtqemud*' 2>/dev/null | grep -c virtqemud")
	if atoiSafe(unit) == 0 {
		b.WriteString("virtqemud 的 systemd 单元不存在 → 模块化 daemon 包未安装。\n")
		b.WriteString("缺少包（任一即可提供 virtqemud）：libvirt-daemon-driver-qemu / libvirt-daemon-common。\n")
		b.WriteString("解决：在平台「离线安装包」的 el10 目录放入并重试纳管，平台会自动推送安装。\n")
	} else {
		b.WriteString("virtqemud 单元存在但启动失败。\n")
		// 取一行最近的失败原因。
		why := c.RunQuiet("systemctl status virtqemud.socket 2>&1 | tail -5; echo '---'; journalctl -u virtqemud --no-pager -n 5 2>/dev/null")
		if strings.TrimSpace(why) != "" {
			b.WriteString("最近日志：\n" + truncate(why, 800) + "\n")
		}
	}
	// 相关包安装情况
	rpmq := c.RunQuiet("rpm -q libvirt libvirt-daemon-driver-qemu libvirt-daemon-common 2>&1")
	b.WriteString("相关包：\n" + truncate(rpmq, 400))
	return b.String()
}

// modularDaemonPackages 提供模块化 daemon（virtqemud 等）的 RPM 包名。
// 当目标机缺 virtqemud 单元时，需要安装这些包（EL9/EL10）。
func modularDaemonPackages() []string {
	return []string{
		"libvirt-daemon-common",           // 提供 virt*d 公共与基础 unit
		"libvirt-daemon-driver-qemu",      // 提供 virtqemud
		"libvirt-daemon-driver-network",   // virtnetworkd
		"libvirt-daemon-driver-storage",   // virtstoraged
		"libvirt-daemon-driver-nodedev",   // virtnodedevd
		"libvirt-daemon-driver-nwfilter",  // virtnwfilterd
		"libvirt-daemon-driver-secret",    // virtsecretd
		"libvirt-daemon-driver-interface", // virtinterfaced
		"libvirt-daemon-proxy",            // 提供 virtproxyd（远程 TCP，EL10 包名）
	}
}

// hasVirtqemudUnit 判断目标机上是否存在 virtqemud 的 systemd 单元（用于决定是否需补装模块化包）。
func hasVirtqemudUnit(c *SSHClient) bool {
	cnt := c.RunQuiet("systemctl list-unit-files 'virtqemud*' 2>/dev/null | grep -c virtqemud")
	return atoiSafe(cnt) > 0
}

// enableTCPForModel 按服务模式开启远程 TCP 监听（端口 tcpPort，默认 16509）。
//
//   - 单体（EL8）：沿用 libvirtd.conf（listen_tcp/auth_tcp/tcp_port）+ LIBVIRTD_ARGS="--listen"，重启 libvirtd。
//   - 模块化（EL9/EL10）：socket 激活下 libvirtd.conf 的 listen_tcp 被忽略，
//     必须改由 virtproxyd-tcp.socket 控制监听。需先确保 virtproxyd 启用，
//     并将其 TCP socket 的 ListenStream 改为目标端口后启动。
//     注意：virtproxyd 默认 auth_tcp 需为 "none" 才能免认证（与单体一致）。
func enableTCPForModel(c *SSHClient, model serviceModel, tcpPort int, emit func(string)) error {
	if tcpPort == 0 {
		tcpPort = 16509
	}
	switch model {
	case modelMonolithic:
		return enableTCPMonolithic(c, tcpPort, emit)
	case modelModular:
		return enableTCPModular(c, tcpPort, emit)
	default:
		return fmt.Errorf("无法确定守护进程模式，无法配置 TCP")
	}
}

// enableTCPMonolithic 单体 libvirtd 的 TCP 开启（EL8）。
//
// 关键：EL8 的 libvirtd 默认是 **socket 激活**（libvirtd.socket 出厂 enabled）。
// 在 socket 激活下：
//   - 旧式 `LIBVIRTD_ARGS="--listen"` + `systemctl restart libvirtd` 会直接失败
//     （status=6/NOTCONFIGURED：--listen 与 systemd activation sockets 互斥，真机已复现）；
//   - libvirtd.conf 里的 listen_tcp/tcp_port 在 socket 激活下亦被忽略，监听端口由
//     libvirtd-tcp.socket 的 ListenStream 决定。
//
// 因此正确做法是「保持 socket 激活、启用 libvirtd-tcp.socket」：
//   - 在 libvirtd.conf 设 auth_tcp="none"（免认证，生产可改 TLS/SASL）；
//   - 若端口非默认 16509，用 drop-in 覆盖 libvirtd-tcp.socket 的 ListenStream；
//   - enable + start libvirtd-tcp.socket（libvirtd.service 仍由 socket 激活按需拉起）。
func enableTCPMonolithic(c *SSHClient, tcpPort int, emit func(string)) error {
	emit(fmt.Sprintf("[TCP·单体] 通过 libvirtd-tcp.socket 监听 TCP %d（socket 激活，auth_tcp=none；不使用 --listen）", tcpPort))

	// 0) 清理历史误写的 --listen，避免 socket 拉起 service 时冲突导致 NOTCONFIGURED。
	_, _ = c.Run(sudoWrap(c, `sed -i '/^LIBVIRTD_ARGS/d' /etc/sysconfig/libvirtd 2>/dev/null || true`))
	_, _ = c.Run(sudoWrap(c, "systemctl reset-failed libvirtd 2>/dev/null || true"))

	// 1) auth_tcp=none + 关闭 TLS 监听（与生产免认证 TCP 行为一致）。
	confCmds := []string{
		`cp -n /etc/libvirt/libvirtd.conf /etc/libvirt/libvirtd.conf.cnf.bak 2>/dev/null || true`,
		`sed -i 's/^#\?auth_tcp.*/auth_tcp = "none"/' /etc/libvirt/libvirtd.conf`,
		`grep -q '^auth_tcp' /etc/libvirt/libvirtd.conf || echo 'auth_tcp = "none"' >> /etc/libvirt/libvirtd.conf`,
		`sed -i 's/^#\?listen_tls.*/listen_tls = 0/' /etc/libvirt/libvirtd.conf`,
		`grep -q '^listen_tls' /etc/libvirt/libvirtd.conf || echo 'listen_tls = 0' >> /etc/libvirt/libvirtd.conf`,
	}
	for _, cmd := range confCmds {
		_, _ = c.Run(sudoWrap(c, cmd))
	}

	// 2) 端口非默认时用 drop-in 覆盖 libvirtd-tcp.socket 的 ListenStream。
	if tcpPort != 16509 {
		dropin := fmt.Sprintf(
			"mkdir -p /etc/systemd/system/libvirtd-tcp.socket.d && "+
				"printf '[Socket]\\nListenStream=\\nListenStream=%d\\n' > /etc/systemd/system/libvirtd-tcp.socket.d/cnf-port.conf && "+
				"systemctl daemon-reload",
			tcpPort)
		if _, err := c.Run(sudoWrap(c, dropin)); err != nil {
			return fmt.Errorf("配置 libvirtd-tcp.socket 端口失败: %w", err)
		}
	}

	// 3) 关键：socket 激活要求「先把所有 socket 起好、service 处于未运行」，
	//    systemd 才允许 libvirtd-tcp.socket 监听。若 libvirtd.service 已在运行
	//    （例如此前已有连接把它拉起），直接 start tcp.socket 会被拒：
	//    「Socket service libvirtd.service already active, refusing.」
	//    因此先停掉 service（连同所有 socket 一起停），再统一启动全部 socket，
	//    service 留给后续首次连接按需激活。
	enableCmds := strings.Join([]string{
		"systemctl unmask libvirtd.socket libvirtd-ro.socket libvirtd-admin.socket libvirtd-tcp.socket 2>/dev/null || true",
		// 先停 service + 现有 socket，清空监听 fd 归属，避免 tcp.socket 被拒。
		"systemctl stop libvirtd.service 2>/dev/null || true",
		"systemctl stop libvirtd.socket libvirtd-ro.socket libvirtd-admin.socket libvirtd-tcp.socket libvirtd-tls.socket 2>/dev/null || true",
		// 设开机自启。
		"systemctl enable libvirtd.socket libvirtd-ro.socket libvirtd-admin.socket libvirtd-tcp.socket 2>/dev/null || true",
		// 统一一次性启动全部 socket（含 tcp）；service 不在此处启动。
		"systemctl start libvirtd.socket libvirtd-ro.socket libvirtd-admin.socket libvirtd-tcp.socket",
	}, " ; ")
	if out, err := c.RunStream(sudoWrap(c, enableCmds), emit); err != nil {
		return fmt.Errorf("启动 libvirtd-tcp.socket 失败: %w（输出：%s）", err, truncate(out, 300))
	}

	// 4) 校验 libvirtd-tcp.socket 已激活。
	if c.RunQuiet("systemctl is-active libvirtd-tcp.socket 2>/dev/null") != "active" {
		// 取诊断信息便于排错。
		why := c.RunQuiet("systemctl status libvirtd-tcp.socket 2>&1 | tail -6")
		return fmt.Errorf("libvirtd-tcp.socket 未处于 active 状态（%s）", truncate(why, 300))
	}
	return nil
}

// enableTCPModular 模块化 virtproxyd 的 TCP 开启（EL9/EL10）。
//
// 关键点：
//   - socket 激活下 *.conf 的 listen_tcp 被忽略，TCP 监听由 virtproxyd-tcp.socket 决定。
//   - 仍需在 /etc/libvirt/virtproxyd.conf 设 auth_tcp="none" 以免认证（生产可按需改为 TLS/SASL）。
//   - 用 systemd drop-in 覆盖 virtproxyd-tcp.socket 的 ListenStream 为目标端口，
//     避免直接改发行版自带 unit 文件。
func enableTCPModular(c *SSHClient, tcpPort int, emit func(string)) error {
	emit(fmt.Sprintf("[TCP·模块化] 通过 virtproxyd-tcp.socket 监听 TCP %d（socket 激活，忽略 conf 内 listen_tcp）", tcpPort))

	// 1) virtproxyd 鉴权设为 none（与单体 auth_tcp=none 行为一致）。
	confCmds := []string{
		`mkdir -p /etc/libvirt`,
		`touch /etc/libvirt/virtproxyd.conf`,
		`cp -n /etc/libvirt/virtproxyd.conf /etc/libvirt/virtproxyd.conf.cnf.bak 2>/dev/null || true`,
		`sed -i 's/^#\?auth_tcp.*/auth_tcp = "none"/' /etc/libvirt/virtproxyd.conf`,
		`grep -q '^auth_tcp' /etc/libvirt/virtproxyd.conf || echo 'auth_tcp = "none"' >> /etc/libvirt/virtproxyd.conf`,
	}
	for _, cmd := range confCmds {
		_, _ = c.Run(sudoWrap(c, cmd))
	}

	// 2) drop-in 覆盖 virtproxyd-tcp.socket 的监听端口（若非默认 16509）。
	if tcpPort != 16509 {
		dropin := fmt.Sprintf(
			"mkdir -p /etc/systemd/system/virtproxyd-tcp.socket.d && "+
				"printf '[Socket]\\nListenStream=\\nListenStream=%d\\n' > /etc/systemd/system/virtproxyd-tcp.socket.d/cnf-port.conf && "+
				"systemctl daemon-reload",
			tcpPort)
		if _, err := c.Run(sudoWrap(c, dropin)); err != nil {
			return fmt.Errorf("配置 virtproxyd-tcp.socket 端口失败: %w", err)
		}
	}

	// 3) 启用并启动 virtproxyd 的 socket（含 tcp）。virtproxyd.service 由 socket 激活拉起。
	enableCmds := strings.Join([]string{
		"systemctl unmask virtproxyd.service virtproxyd.socket virtproxyd-ro.socket virtproxyd-admin.socket virtproxyd-tcp.socket 2>/dev/null || true",
		"systemctl enable virtproxyd.socket virtproxyd-ro.socket virtproxyd-admin.socket 2>/dev/null || true",
		"systemctl start virtproxyd.socket virtproxyd-ro.socket virtproxyd-admin.socket 2>/dev/null || true",
		// tcp socket 单独 enable+start（安全角度默认不开机自启，这里因平台纳管需要而显式开启）。
		"systemctl enable virtproxyd-tcp.socket 2>/dev/null || true",
		"systemctl restart virtproxyd-tcp.socket",
	}, " ; ")
	if out, err := c.RunStream(sudoWrap(c, enableCmds), emit); err != nil {
		return fmt.Errorf("启动 virtproxyd-tcp.socket 失败: %w（输出：%s）", err, truncate(out, 300))
	}

	// 4) 校验 virtproxyd-tcp.socket 已激活。
	if c.RunQuiet("systemctl is-active virtproxyd-tcp.socket 2>/dev/null") != "active" {
		return fmt.Errorf("virtproxyd-tcp.socket 未处于 active 状态")
	}
	return nil
}
