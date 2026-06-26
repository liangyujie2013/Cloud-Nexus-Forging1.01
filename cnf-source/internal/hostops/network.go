package hostops

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/cnf/cnfv1/internal/onboard"
)

// NIC 描述目标主机一块网卡的真实网络配置（来自 nmcli/ip 输出，绝不伪造）。
type NIC struct {
	Device     string   `json:"device"`      // 设备名，如 eth0 / ens192 / bond0
	Type       string   `json:"type"`        // ethernet / bond / bridge / vlan ...
	MAC        string   `json:"mac"`         // 硬件地址
	State      string   `json:"state"`       // up / down / connected / unmanaged ...
	ConnName   string   `json:"conn_name"`   // NetworkManager 连接名（修改配置时使用）
	ConnUUID   string   `json:"conn_uuid"`   // 连接 UUID
	Mode       string   `json:"mode"`        // dhcp / static / manual / disabled / unknown
	IPv4       string   `json:"ipv4"`        // 主 IPv4 地址（不含前缀）
	Prefix     int      `json:"prefix"`      // 子网前缀长度，如 24
	Netmask    string   `json:"netmask"`     // 由前缀换算的点分掩码
	Gateway    string   `json:"gateway"`     // IPv4 网关
	DNS        []string `json:"dns"`         // DNS 服务器
	Addresses  []string `json:"addresses"`   // 全部 IPv4 地址（addr/prefix）
	NMManaged  bool     `json:"nm_managed"`  // 是否被 NetworkManager 管理
	IsPhysical bool     `json:"is_physical"` // 是否物理网卡（非 lo/虚拟桥）
}

// NetworkInfo 主机网络总览。
type NetworkInfo struct {
	Hostname    string   `json:"hostname"`
	NICs        []NIC    `json:"nics"`
	HasNM       bool     `json:"has_nm"`        // 是否安装并运行 NetworkManager
	DefaultGW   string   `json:"default_gw"`    // 默认路由网关
	DefaultDev  string   `json:"default_dev"`   // 默认路由出口设备
	Warnings    []string `json:"warnings"`
}

// CollectNICs 在一个 SSH 会话内采集主机所有网卡的真实信息。
//
// 优先用 nmcli（能给出连接 UUID / DHCP-or-static 模式），辅以 ip addr / ip route 兜底。
func CollectNICs(c *onboard.SSHClient) (*NetworkInfo, error) {
	info := &NetworkInfo{}

	script := strings.Join([]string{
		`echo "===HOSTNAME==="; hostname 2>/dev/null`,
		`echo "===HASNM==="; (systemctl is-active NetworkManager 2>/dev/null || echo inactive)`,
		// nmcli 设备一览：DEVICE TYPE STATE CONNECTION
		`echo "===NMDEV==="; (nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device 2>/dev/null)`,
		// 每个连接的详尽字段（含 UUID / method / addresses / gateway / dns / mac）
		`echo "===NMCON==="; (nmcli -t -f NAME,UUID,DEVICE,TYPE connection show 2>/dev/null)`,
		// ip 兜底
		`echo "===IPADDR==="; ip -o addr show 2>/dev/null`,
		`echo "===IPLINK==="; ip -o link show 2>/dev/null`,
		`echo "===ROUTE==="; ip route show default 2>/dev/null`,
		`echo "===END==="`,
	}, "; ")

	out, err := c.Run(script)
	if err != nil && out == "" {
		return nil, err
	}
	sections := splitSections(out)

	info.Hostname = firstLine(sections["HOSTNAME"])
	info.HasNM = strings.TrimSpace(firstLine(sections["HASNM"])) == "active"
	parseDefaultRoute(info, sections["ROUTE"])

	// 以 ip link / ip addr 建立设备基线（保证即便没有 NM 也能列出网卡）
	nicMap := map[string]*NIC{}
	parseIPLink(nicMap, sections["IPLINK"])
	parseIPAddr(nicMap, sections["IPADDR"])

	// 用 nmcli 设备状态补充 connection 名与 state
	devConn := map[string]string{} // device -> connection name
	if info.HasNM {
		parseNMDev(nicMap, devConn, sections["NMDEV"])
	}

	// 逐个连接拉取详情（method/uuid/ip/gw/dns）。只对有连接的设备执行。
	if info.HasNM {
		for dev, conn := range devConn {
			if conn == "" || conn == "--" {
				continue
			}
			detail := c.RunQuiet(fmt.Sprintf(
				`nmcli -t -f connection.uuid,ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns,GENERAL.HWADDR connection show %q 2>/dev/null`,
				conn))
			applyNMConnDetail(nicMap[dev], conn, detail)
		}
	}

	// 整理为切片：过滤 lo，标记物理性，补掩码。
	for _, n := range nicMap {
		if n.Device == "lo" {
			continue
		}
		if n.Prefix > 0 {
			n.Netmask = prefixToNetmask(n.Prefix)
		}
		n.IsPhysical = isPhysicalNIC(n)
		if n.Mode == "" {
			// 无 NM 信息时，依据是否有静态地址粗略判断（保守标 unknown）
			n.Mode = "unknown"
		}
		if info.DefaultDev == n.Device && n.Gateway == "" {
			n.Gateway = info.DefaultGW
		}
		info.NICs = append(info.NICs, *n)
	}
	sortNICs(info.NICs)
	return info, nil
}

// NICChange 描述一次网卡配置变更请求。
type NICChange struct {
	Device  string `json:"device"`   // 目标设备（必填）
	Mode    string `json:"mode"`     // "dhcp" 或 "static"（必填）
	IPv4    string `json:"ipv4"`     // static 时必填
	Prefix  int    `json:"prefix"`   // static 时必填（如 24）；也可由 netmask 推导
	Netmask string `json:"netmask"`  // 可选，自动换算 prefix
	Gateway string `json:"gateway"`  // static 可选
	DNS     string `json:"dns"`      // 可选，逗号或空格分隔
}

// ApplyNICConfig 在目标主机上把某网卡切到 DHCP 或静态并立即生效（nmcli con mod + up）。
//
// 返回执行步骤说明（供前端展示真实操作过程）。任一步失败立即返回错误。
//
// 安全说明：修改的是「目标被纳管主机」的网络，绝不触碰平台自身。
func ApplyNICConfig(c *onboard.SSHClient, ch NICChange) ([]string, error) {
	var steps []string
	if ch.Device == "" {
		return nil, fmt.Errorf("缺少目标网卡设备名")
	}
	mode := strings.ToLower(strings.TrimSpace(ch.Mode))
	if mode != "dhcp" && mode != "static" {
		return nil, fmt.Errorf("mode 仅支持 dhcp 或 static，收到 %q", ch.Mode)
	}

	// 必须有 NetworkManager 才能安全写配置
	if strings.TrimSpace(c.RunQuiet(`systemctl is-active NetworkManager 2>/dev/null`)) != "active" {
		return nil, fmt.Errorf("目标主机未运行 NetworkManager，暂不支持自动改网（建议先启用 NetworkManager）")
	}

	// 设备必须真实存在——否则直接报错，绝不在目标机上创建「幽灵连接」污染配置。
	if dev := strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`ip -o link show %q 2>/dev/null | head -1`, ch.Device))); dev == "" {
		return nil, fmt.Errorf("目标主机不存在网卡 %q（请先用「读取网卡」确认设备名）", ch.Device)
	}

	// 找到设备对应的连接名；没有则尝试用设备名同名连接。
	conn := strings.TrimSpace(c.RunQuiet(fmt.Sprintf(
		`nmcli -t -f GENERAL.CONNECTION device show %q 2>/dev/null | head -1 | cut -d: -f2`, ch.Device)))
	if conn == "" || conn == "--" {
		// 无活动连接：直接以设备名查/建一个连接
		conn = ch.Device
		exists := strings.TrimSpace(c.RunQuiet(fmt.Sprintf(
			`nmcli -t -f NAME connection show 2>/dev/null | grep -Fx %q`, conn)))
		if exists == "" {
			if o, err := c.Run(fmt.Sprintf(
				`nmcli connection add type ethernet ifname %q con-name %q 2>&1`, ch.Device, conn)); err != nil {
				return steps, fmt.Errorf("创建连接失败: %v (%s)", err, o)
			}
			steps = append(steps, "创建 NetworkManager 连接 "+conn)
		}
	}

	if mode == "dhcp" {
		cmd := fmt.Sprintf(
			`nmcli connection modify %q ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.dns "" 2>&1`, conn)
		if o, err := c.Run(cmd); err != nil {
			return steps, fmt.Errorf("切换 DHCP 失败: %v (%s)", err, o)
		}
		steps = append(steps, "已将 "+conn+" 设为 DHCP（ipv4.method auto，清空静态地址）")
	} else {
		// static：换算 prefix
		prefix := ch.Prefix
		if prefix <= 0 && ch.Netmask != "" {
			prefix = netmaskToPrefix(ch.Netmask)
		}
		if ch.IPv4 == "" || prefix <= 0 || prefix > 32 {
			return steps, fmt.Errorf("静态配置需提供合法 IPv4 与子网（IP=%q prefix=%d）", ch.IPv4, prefix)
		}
		addr := fmt.Sprintf("%s/%d", ch.IPv4, prefix)
		cmd := fmt.Sprintf(`nmcli connection modify %q ipv4.method manual ipv4.addresses %q`, conn, addr)
		if ch.Gateway != "" {
			cmd += fmt.Sprintf(` ipv4.gateway %q`, ch.Gateway)
		} else {
			cmd += ` ipv4.gateway ""`
		}
		if dns := normalizeDNS(ch.DNS); dns != "" {
			cmd += fmt.Sprintf(` ipv4.dns %q`, dns)
		}
		cmd += " 2>&1"
		if o, err := c.Run(cmd); err != nil {
			return steps, fmt.Errorf("写入静态配置失败: %v (%s)", err, o)
		}
		steps = append(steps, fmt.Sprintf("已将 %s 设为静态 %s 网关 %s", conn, addr, ch.Gateway))
	}

	// 立即生效：reapply 优先（不断连），失败再 up。
	if o, err := c.Run(fmt.Sprintf(`nmcli device reapply %q 2>&1 || nmcli connection up %q 2>&1`, ch.Device, conn)); err != nil {
		steps = append(steps, "配置已写入，但即时生效命令返回: "+o)
		return steps, fmt.Errorf("配置已保存但生效失败（可能需要重启网络或会话因改 IP 断开）: %v", err)
	}
	steps = append(steps, "配置已生效（nmcli reapply/up）")
	return steps, nil
}

// ---------- 解析辅助 ----------

func parseDefaultRoute(info *NetworkInfo, block string) {
	// 形如: default via 192.168.1.1 dev eth0 proto static metric 100
	line := firstLine(block)
	f := strings.Fields(line)
	for i := 0; i < len(f); i++ {
		if f[i] == "via" && i+1 < len(f) {
			info.DefaultGW = f[i+1]
		}
		if f[i] == "dev" && i+1 < len(f) {
			info.DefaultDev = f[i+1]
		}
	}
}

func parseIPLink(m map[string]*NIC, block string) {
	// ip -o link show 形如:
	// 2: eth0: <BROADCAST,...> mtu 1500 ... link/ether 52:54:00:.. brd ..
	for _, line := range strings.Split(block, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// 去掉前导 "N: "
		idx := strings.Index(line, ": ")
		if idx < 0 {
			continue
		}
		rest := line[idx+2:]
		name := rest
		if j := strings.Index(rest, ":"); j >= 0 {
			name = rest[:j]
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		// 处理 @ 形式（vlan: eth0.10@eth0）
		if at := strings.Index(name, "@"); at >= 0 {
			name = name[:at]
		}
		n := getNIC(m, name)
		if li := strings.Index(line, "link/"); li >= 0 {
			parts := strings.Fields(line[li:])
			if len(parts) >= 2 {
				n.MAC = parts[1]
			}
		}
		low := strings.ToLower(line)
		if strings.Contains(low, "state up") {
			n.State = "up"
		} else if strings.Contains(low, "state down") {
			n.State = "down"
		}
	}
}

func parseIPAddr(m map[string]*NIC, block string) {
	// ip -o addr show 形如:
	// 2: eth0    inet 192.168.1.42/24 brd ... scope global eth0
	for _, line := range strings.Split(block, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		dev := strings.TrimSuffix(f[1], ":")
		if at := strings.Index(dev, "@"); at >= 0 {
			dev = dev[:at]
		}
		for i := 0; i < len(f)-1; i++ {
			if f[i] == "inet" {
				cidr := f[i+1] // a.b.c.d/nn
				n := getNIC(m, dev)
				n.Addresses = append(n.Addresses, cidr)
				if n.IPv4 == "" {
					ip, pfx := splitCIDR(cidr)
					n.IPv4 = ip
					n.Prefix = pfx
				}
			}
		}
	}
}

func parseNMDev(m map[string]*NIC, devConn map[string]string, block string) {
	// nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device
	for _, line := range strings.Split(block, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		f := splitNM(line)
		if len(f) < 4 {
			continue
		}
		dev, typ, state, conn := f[0], f[1], f[2], f[3]
		if dev == "" || dev == "lo" {
			continue
		}
		n := getNIC(m, dev)
		n.Type = typ
		n.State = state
		n.NMManaged = state != "unmanaged"
		devConn[dev] = conn
		if conn != "" && conn != "--" {
			n.ConnName = conn
		}
	}
}

func applyNMConnDetail(n *NIC, conn, detail string) {
	if n == nil {
		return
	}
	n.ConnName = conn
	for _, line := range strings.Split(detail, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// 形如 key:value。nmcli -t 会把值里的冒号转义成 \:（如 MAC、IPv6），
		// 因此先找首个「未转义」冒号作为 key/value 分隔，再对 value 去转义。
		key, rawVal := splitFirstUnescapedColon(line)
		if key == "" {
			continue
		}
		val := strings.TrimSpace(unescapeNM(rawVal))
		switch key {
		case "connection.uuid":
			n.ConnUUID = val
		case "ipv4.method":
			n.Mode = nmMethodToMode(val)
		case "ipv4.addresses":
			if val != "" && val != "--" {
				// 可能多地址逗号分隔
				for _, a := range strings.Split(val, ",") {
					a = strings.TrimSpace(a)
					if a == "" {
						continue
					}
					if n.IPv4 == "" {
						ip, pfx := splitCIDR(a)
						n.IPv4 = ip
						n.Prefix = pfx
					}
				}
			}
		case "ipv4.gateway":
			if val != "" && val != "--" {
				n.Gateway = val
			}
		case "ipv4.dns":
			if val != "" && val != "--" {
				for _, d := range strings.FieldsFunc(val, func(r rune) bool { return r == ',' || r == ' ' }) {
					if d != "" {
						n.DNS = append(n.DNS, d)
					}
				}
			}
		case "GENERAL.HWADDR":
			if val != "" && val != "--" && n.MAC == "" {
				n.MAC = val
			}
		}
	}
}

func nmMethodToMode(m string) string {
	switch strings.ToLower(strings.TrimSpace(m)) {
	case "auto":
		return "dhcp"
	case "manual":
		return "static"
	case "disabled":
		return "disabled"
	case "":
		return "unknown"
	default:
		return strings.ToLower(m)
	}
}

func getNIC(m map[string]*NIC, dev string) *NIC {
	if n, ok := m[dev]; ok {
		return n
	}
	n := &NIC{Device: dev}
	m[dev] = n
	return n
}

func isPhysicalNIC(n *NIC) bool {
	if n.Device == "lo" {
		return false
	}
	// 常见虚拟接口前缀过滤
	for _, p := range []string{"virbr", "vnet", "docker", "veth", "br-", "cni", "flannel", "tap", "tun"} {
		if strings.HasPrefix(n.Device, p) {
			return false
		}
	}
	switch n.Type {
	case "bridge", "tun", "loopback":
		return false
	}
	return true
}

// splitFirstUnescapedColon 在首个未转义冒号处切分 key/value（key 不去转义，value 原样返回）。
func splitFirstUnescapedColon(line string) (string, string) {
	for i := 0; i < len(line); i++ {
		if line[i] == '\\' {
			i++
			continue
		}
		if line[i] == ':' {
			return strings.TrimSpace(unescapeNM(line[:i])), line[i+1:]
		}
	}
	return "", ""
}

// unescapeNM 去掉 nmcli -t 的反斜杠转义（\: -> :，\\ -> \）。
func unescapeNM(s string) string {
	if !strings.ContainsRune(s, '\\') {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) {
			b.WriteByte(s[i+1])
			i++
			continue
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

// splitNM 处理 nmcli -t 输出（冒号分隔，转义为 \:）。
func splitNM(line string) []string {
	var fields []string
	var cur strings.Builder
	for i := 0; i < len(line); i++ {
		if line[i] == '\\' && i+1 < len(line) {
			cur.WriteByte(line[i+1])
			i++
			continue
		}
		if line[i] == ':' {
			fields = append(fields, cur.String())
			cur.Reset()
			continue
		}
		cur.WriteByte(line[i])
	}
	fields = append(fields, cur.String())
	return fields
}

func splitCIDR(s string) (string, int) {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '/'); i >= 0 {
		ip := s[:i]
		pfx, _ := strconv.Atoi(s[i+1:])
		return ip, pfx
	}
	return s, 0
}

func prefixToNetmask(prefix int) string {
	if prefix < 0 || prefix > 32 {
		return ""
	}
	var mask uint32 = 0
	if prefix > 0 {
		mask = ^uint32(0) << (32 - prefix)
	}
	return fmt.Sprintf("%d.%d.%d.%d",
		(mask>>24)&0xff, (mask>>16)&0xff, (mask>>8)&0xff, mask&0xff)
}

func netmaskToPrefix(mask string) int {
	parts := strings.Split(strings.TrimSpace(mask), ".")
	if len(parts) != 4 {
		return 0
	}
	var m uint32
	for _, p := range parts {
		v, err := strconv.Atoi(p)
		if err != nil || v < 0 || v > 255 {
			return 0
		}
		m = (m << 8) | uint32(v)
	}
	count := 0
	for i := 31; i >= 0; i-- {
		if m&(1<<uint(i)) != 0 {
			count++
		} else {
			break
		}
	}
	return count
}

func normalizeDNS(s string) string {
	fields := strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == ';' })
	return strings.Join(fields, ",")
}

// sortNICs：物理网卡优先、其次按设备名稳定排序。
func sortNICs(nics []NIC) {
	for i := 0; i < len(nics); i++ {
		for j := i + 1; j < len(nics); j++ {
			swap := false
			if nics[j].IsPhysical && !nics[i].IsPhysical {
				swap = true
			} else if nics[j].IsPhysical == nics[i].IsPhysical && nics[j].Device < nics[i].Device {
				swap = true
			}
			if swap {
				nics[i], nics[j] = nics[j], nics[i]
			}
		}
	}
}
