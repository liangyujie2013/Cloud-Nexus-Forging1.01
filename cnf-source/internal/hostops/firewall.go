package hostops

// firewall.go —— 主机防火墙（firewalld）真实运维：读状态 / 开关 / 自动放行平台端口 / 自定义策略。
//
// 设计原则（呼应「不要 mock / 清晰报错 / 联动性」）：
//   - 全部经 firewall-cmd 在目标机真实执行；读状态来自真实输出，开关与端口改动持久化(--permanent)后 --reload 生效。
//   - 任一步失败返回明确错误与已执行步骤，绝不静默成功、绝不伪造。
//   - 平台必需端口（SSH 当前端口 / libvirt TCP 16509,16514 / VNC 5900-5999 / 迁移 49152-49215）
//     由平台统一放行，确保纳管后各项功能联动可用。

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/cnf/cnfv1/internal/onboard"
)

// FirewallState 防火墙当前状态快照（真实读取）。
type FirewallState struct {
	Installed   bool     `json:"installed"`    // 是否安装 firewalld
	Running     bool     `json:"running"`      // firewalld 是否运行中
	DefaultZone string   `json:"default_zone"` // 默认 zone
	OpenPorts   []string `json:"open_ports"`   // 已放行端口（如 "5900-5999/tcp"）
	OpenServices []string `json:"open_services"` // 已放行服务（如 "ssh"）
	PlatformReady bool   `json:"platform_ready"` // 平台必需端口是否已全部放行
	MissingPlatformPorts []string `json:"missing_platform_ports"` // 缺失的平台端口
	Warnings    []string `json:"warnings"`
}

// FirewallPort 单条端口策略。
type FirewallPort struct {
	Port     int    `json:"port"`      // 单端口（与 PortRange 二选一）
	PortFrom int    `json:"port_from"` // 端口段起
	PortTo   int    `json:"port_to"`   // 端口段止
	Protocol string `json:"protocol"`  // tcp | udp
}

// spec 把端口策略转成 firewall-cmd 的 port 表达式，如 "5900-5999/tcp" 或 "22/tcp"。
func (p FirewallPort) spec() (string, error) {
	proto := strings.ToLower(strings.TrimSpace(p.Protocol))
	if proto != "tcp" && proto != "udp" {
		return "", fmt.Errorf("协议非法（仅 tcp/udp）: %q", p.Protocol)
	}
	if p.PortFrom > 0 && p.PortTo > 0 {
		if p.PortFrom > p.PortTo || p.PortFrom < 1 || p.PortTo > 65535 {
			return "", fmt.Errorf("端口段非法: %d-%d", p.PortFrom, p.PortTo)
		}
		return fmt.Sprintf("%d-%d/%s", p.PortFrom, p.PortTo, proto), nil
	}
	if p.Port < 1 || p.Port > 65535 {
		return "", fmt.Errorf("端口非法: %d", p.Port)
	}
	return fmt.Sprintf("%d/%s", p.Port, proto), nil
}

// PlatformPorts 返回平台运行所必需放行的端口集合。
// sshPort 取自该主机凭据里的真实 SSH 端口（默认 22）。
func PlatformPorts(sshPort int) []FirewallPort {
	if sshPort <= 0 {
		sshPort = 22
	}
	return []FirewallPort{
		{Port: sshPort, Protocol: "tcp"},               // SSH（运维通道）
		{Port: 16509, Protocol: "tcp"},                 // libvirt TCP
		{Port: 16514, Protocol: "tcp"},                 // libvirt TLS
		{PortFrom: 5900, PortTo: 5999, Protocol: "tcp"}, // VNC 控制台
		{PortFrom: 49152, PortTo: 49215, Protocol: "tcp"}, // 在线迁移
	}
}

// CollectFirewall 读取目标主机防火墙真实状态，并据 sshPort 判定平台必需端口是否齐全。
func CollectFirewall(c *onboard.SSHClient, sshPort int) (*FirewallState, error) {
	st := &FirewallState{}
	// 是否安装
	if strings.TrimSpace(c.RunQuiet(`command -v firewall-cmd >/dev/null 2>&1 && echo yes || echo no`)) != "yes" {
		st.Installed = false
		st.Warnings = append(st.Warnings, "目标主机未安装 firewalld（firewall-cmd 不存在）")
		return st, nil
	}
	st.Installed = true
	// 运行状态
	st.Running = strings.TrimSpace(c.RunQuiet(`systemctl is-active firewalld 2>/dev/null`)) == "active"
	if !st.Running {
		st.Warnings = append(st.Warnings, "firewalld 未运行，端口策略不生效")
	}
	// 默认 zone
	st.DefaultZone = strings.TrimSpace(c.RunQuiet(`firewall-cmd --get-default-zone 2>/dev/null`))
	if st.DefaultZone == "" {
		st.DefaultZone = "public"
	}
	// 已放行端口/服务（permanent 视图，反映持久策略）
	ports := strings.TrimSpace(c.RunQuiet(`firewall-cmd --permanent --zone=` + st.DefaultZone + ` --list-ports 2>/dev/null`))
	if ports != "" {
		st.OpenPorts = strings.Fields(ports)
	}
	svcs := strings.TrimSpace(c.RunQuiet(`firewall-cmd --permanent --zone=` + st.DefaultZone + ` --list-services 2>/dev/null`))
	if svcs != "" {
		st.OpenServices = strings.Fields(svcs)
	}
	// 平台端口齐全性判定
	st.MissingPlatformPorts = missingPlatformPorts(st, sshPort)
	st.PlatformReady = len(st.MissingPlatformPorts) == 0
	return st, nil
}

// missingPlatformPorts 计算尚未放行的平台必需端口（考虑 ssh 服务等价 22/tcp）。
func missingPlatformPorts(st *FirewallState, sshPort int) []string {
	have := map[string]bool{}
	for _, p := range st.OpenPorts {
		have[p] = true
	}
	// ssh 服务等价放行 22/tcp
	sshSvc := false
	for _, s := range st.OpenServices {
		if s == "ssh" {
			sshSvc = true
		}
	}
	var missing []string
	for _, pp := range PlatformPorts(sshPort) {
		spec, _ := pp.spec()
		if have[spec] {
			continue
		}
		// SSH 端口若以 ssh 服务形式放行（仅 22）也算齐全
		if sshSvc && spec == "22/tcp" {
			continue
		}
		missing = append(missing, spec)
	}
	sort.Strings(missing)
	return missing
}

// SetFirewallEnabled 开启/关闭 firewalld（enable+start / disable+stop），真实执行。
func SetFirewallEnabled(c *onboard.SSHClient, enabled bool) ([]string, error) {
	if strings.TrimSpace(c.RunQuiet(`command -v firewall-cmd >/dev/null 2>&1 && echo yes || echo no`)) != "yes" {
		return nil, fmt.Errorf("目标主机未安装 firewalld，无法开关防火墙")
	}
	var steps []string
	if enabled {
		if _, err := c.Run(`systemctl enable --now firewalld`); err != nil {
			return steps, fmt.Errorf("启用 firewalld 失败: %w", err)
		}
		steps = append(steps, "systemctl enable --now firewalld")
	} else {
		if _, err := c.Run(`systemctl disable --now firewalld`); err != nil {
			return steps, fmt.Errorf("停用 firewalld 失败: %w", err)
		}
		steps = append(steps, "systemctl disable --now firewalld")
	}
	return steps, nil
}

// OpenPlatformPorts 在目标主机上一次性放行所有平台必需端口（持久化 + reload）。
func OpenPlatformPorts(c *onboard.SSHClient, sshPort int) ([]string, error) {
	return ApplyFirewallPorts(c, PlatformPorts(sshPort), true)
}

// ApplyFirewallPorts 批量放行(add=true)或移除(add=false)一组端口策略，持久化后 reload 生效。
func ApplyFirewallPorts(c *onboard.SSHClient, ports []FirewallPort, add bool) ([]string, error) {
	if strings.TrimSpace(c.RunQuiet(`command -v firewall-cmd >/dev/null 2>&1 && echo yes || echo no`)) != "yes" {
		return nil, fmt.Errorf("目标主机未安装 firewalld，无法配置端口策略")
	}
	if strings.TrimSpace(c.RunQuiet(`systemctl is-active firewalld 2>/dev/null`)) != "active" {
		return nil, fmt.Errorf("firewalld 未运行，请先开启防火墙再配置端口策略")
	}
	zone := strings.TrimSpace(c.RunQuiet(`firewall-cmd --get-default-zone 2>/dev/null`))
	if zone == "" {
		zone = "public"
	}
	flag := "--add-port"
	if !add {
		flag = "--remove-port"
	}
	var steps []string
	for _, pp := range ports {
		spec, err := pp.spec()
		if err != nil {
			return steps, err
		}
		cmd := fmt.Sprintf(`firewall-cmd --permanent --zone=%s %s=%s`, zone, flag, spec)
		if _, err := c.Run(cmd); err != nil {
			return steps, fmt.Errorf("配置端口 %s 失败: %w", spec, err)
		}
		steps = append(steps, cmd)
	}
	// reload 使持久策略生效
	if _, err := c.Run(`firewall-cmd --reload`); err != nil {
		return steps, fmt.Errorf("firewall-cmd --reload 失败: %w", err)
	}
	steps = append(steps, "firewall-cmd --reload")
	return steps, nil
}

// ParsePortSpec 把前端传入的字符串端口表达式（"5900-5999/tcp" 或 "22/tcp"）解析为 FirewallPort。
// 供 handler 接收自定义策略时使用。
func ParsePortSpec(spec string) (FirewallPort, error) {
	var fp FirewallPort
	spec = strings.TrimSpace(spec)
	parts := strings.SplitN(spec, "/", 2)
	if len(parts) != 2 {
		return fp, fmt.Errorf("端口表达式非法（应形如 22/tcp 或 5900-5999/tcp）: %q", spec)
	}
	fp.Protocol = strings.ToLower(strings.TrimSpace(parts[1]))
	portPart := strings.TrimSpace(parts[0])
	if strings.Contains(portPart, "-") {
		rng := strings.SplitN(portPart, "-", 2)
		from, e1 := strconv.Atoi(strings.TrimSpace(rng[0]))
		to, e2 := strconv.Atoi(strings.TrimSpace(rng[1]))
		if e1 != nil || e2 != nil {
			return fp, fmt.Errorf("端口段非法: %q", portPart)
		}
		fp.PortFrom, fp.PortTo = from, to
	} else {
		p, e := strconv.Atoi(portPart)
		if e != nil {
			return fp, fmt.Errorf("端口非法: %q", portPart)
		}
		fp.Port = p
	}
	// 校验
	if _, err := fp.spec(); err != nil {
		return fp, err
	}
	return fp, nil
}
