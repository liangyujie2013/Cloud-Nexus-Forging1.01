package hostops

import (
	"fmt"
	"strings"

	"github.com/cnf/cnfv1/internal/onboard"
)

// ============================================================
// 第7点 · 服务接口 / 流量标签（主机级带 IP 的服务网络接口）
//
// 概念：
//   服务接口是主机级、带 IP 的虚拟网卡，并打上「流量类型标签」
//   （管理 / 迁移 / 存储 / 容错 / 复制 / 置备），用于区分主机的
//   各类服务流量走哪条网络。
//
// Linux/KVM 落地（全部真实，绝不伪造）：
//   - 一个服务接口 = 一座带 IP 的网桥（bridge），桥接到指定上行（物理口/bond/已有交换机口）。
//   - 「流量标签」用两重真实手段持久化（与 nmcli 版本无关，稳健可查）：
//       1) 连接命名约定：con-name = vmk-<role>（设备名同名，受 IFNAMSIZ 15 字符约束）——
//          这是标签的「事实来源」，重启/重连后仍可解析。vmk 仅为内部短前缀标识。
//       2) connection.zone = cnf-<role>：把角色映射到 firewalld 区域，让标签具备真实防火墙语义
//          （区域不存在也不影响连接本身，仅作信息标注）。
//   - 设计原则同标准交换机：真实读取、安全确认（动管理网卡需 ack）、幂等、失败回滚。
// ============================================================

// vmkRoles 受支持的流量标签（role 关键字 → 中文释义 + 短设备名前缀）。
// 设备名 = vmk-<role>，必须 ≤15 字符（Linux IFNAMSIZ）。
var vmkRoleNames = map[string]string{
	"mgmt":    "管理 (Management)",
	"vmotion": "迁移 (Migration)",
	"storage": "存储 (NFS/iSCSI)",
	"ft":      "容错 (Fault Tolerance)",
	"repl":    "复制 (Replication)",
	"prov":    "置备 (Provisioning)",
}

// vmkRoleOrder 前端下拉的稳定顺序。
var vmkRoleOrder = []string{"mgmt", "vmotion", "storage", "ft", "repl", "prov"}

// VMKRoleOption 前端流量标签下拉项。
type VMKRoleOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

func vmkRoleOptions() []VMKRoleOption {
	out := make([]VMKRoleOption, 0, len(vmkRoleOrder))
	for _, r := range vmkRoleOrder {
		out = append(out, VMKRoleOption{Value: r, Label: vmkRoleNames[r]})
	}
	return out
}

// vmkDevName 由角色推出设备名 / 连接名（事实来源）。
func vmkDevName(role string) string { return "vmk-" + role }

// VMKernel 一个 服务接口的真实视图。
type VMKernel struct {
	Name     string `json:"name"`      // 设备/连接名，如 vmk-vmotion
	Role     string `json:"role"`      // mgmt / vmotion / storage / ft / repl / prov
	RoleCN   string `json:"role_cn"`   // 中文释义
	Uplink   string `json:"uplink"`    // 上行（桥接的物理口/bond/口）；可空（仅本机IP）
	Mode     string `json:"mode"`      // dhcp / static / disabled
	IPv4     string `json:"ipv4"`      // 主 IPv4（不含前缀）
	Prefix   int    `json:"prefix"`    // 前缀长度
	Gateway  string `json:"gateway"`   // 网关（可空）
	State    string `json:"state"`     // up / down
	Zone     string `json:"zone"`      // firewalld 区域（cnf-<role>）
	IsMgmt   bool   `json:"is_mgmt"`   // 是否承载管理流量（角色=mgmt 或上行=管理口）
}

// VMKInventory 一台主机的 服务接口清单 + 可选项。
type VMKInventory struct {
	Hostname string          `json:"hostname"`
	HasNM    bool            `json:"has_nm"`
	VMKs     []VMKernel      `json:"vmks"`         // 已存在的 服务接口
	FreeNICs []SwitchPort    `json:"free_nics"`    // 可作上行的空闲物理网卡
	Bridges  []VMKCarrier    `json:"bridges"`      // 可作上行的已有网桥（标准交换机/端口组）
	Roles    []VMKRoleOption `json:"roles"`        // 流量标签下拉
	MgmtDev  string          `json:"mgmt_dev"`     // 承载默认路由的设备
	UsedRole map[string]bool `json:"used_role"`    // 已被占用的角色（同主机同角色唯一）
	Warnings []string        `json:"warnings"`
}

// VMKCarrier 可作服务接口 上行的已有网桥。
type VMKCarrier struct {
	Device string `json:"device"`
	IsMgmt bool   `json:"is_mgmt"`
}

// CreateVMKernelRequest 创建 服务接口请求。
type CreateVMKernelRequest struct {
	Role        string `json:"role"`          // 流量标签；必填且唯一
	Uplink      string `json:"uplink"`        // 上行设备（物理口/bond/已有网桥）；可空=仅主机 IP（无上行）
	IPMode      string `json:"ip_mode"`       // dhcp / static；必填
	IPv4        string `json:"ipv4"`          // static 时必填
	Prefix      int    `json:"prefix"`        // static 时
	Gateway     string `json:"gateway"`       // static 可选
	AckMgmtRisk bool   `json:"ack_mgmt_risk"` // 动到管理网卡需确认
}

// DeleteVMKernelRequest 删除请求。
type DeleteVMKernelRequest struct {
	Name        string `json:"name"`          // 设备/连接名 vmk-<role>
	AckMgmtRisk bool   `json:"ack_mgmt_risk"`
}

// CollectVMKernels 真实采集主机上的 服务接口与可用上行。
func CollectVMKernels(c *onboard.SSHClient) (*VMKInventory, error) {
	inv := &VMKInventory{Roles: vmkRoleOptions(), UsedRole: map[string]bool{}}

	// 复用标准交换机清单：拿到空闲网卡、已有网桥、管理设备、NM 状态、主机名。
	sw, err := CollectSwitches(c)
	if err != nil {
		return nil, err
	}
	inv.Hostname = sw.Hostname
	inv.HasNM = sw.HasNM
	inv.MgmtDev = sw.MgmtDev
	inv.FreeNICs = sw.FreeNICs
	inv.Warnings = append(inv.Warnings, sw.Warnings...)
	for _, s := range sw.Switches {
		inv.Bridges = append(inv.Bridges, VMKCarrier{Device: s.Name, IsMgmt: s.IsMgmt})
	}

	if !inv.HasNM {
		inv.Warnings = append(inv.Warnings, "目标主机未运行 NetworkManager，无法管理 服务接口")
		return inv, nil
	}

	// 列出所有 vmk-* 连接，逐个读取 method/addresses/gateway/zone/state。
	// 连接名前缀 vmk- 是事实来源；据此还原角色。
	names := strings.Split(c.RunQuiet(`nmcli -t -f NAME connection show 2>/dev/null | grep '^vmk-'`), "\n")
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" || !strings.HasPrefix(name, "vmk-") {
			continue
		}
		role := strings.TrimPrefix(name, "vmk-")
		if _, ok := vmkRoleNames[role]; !ok {
			continue // 非本平台命名的 vmk-* 跳过
		}
		vmk := VMKernel{Name: name, Role: role, RoleCN: vmkRoleNames[role]}
		detail := c.RunQuiet(fmt.Sprintf(
			`nmcli -t -f ipv4.method,ipv4.addresses,ipv4.gateway,connection.zone,GENERAL.STATE connection show %q 2>/dev/null`, name))
		for _, line := range strings.Split(detail, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			kv := strings.SplitN(line, ":", 2)
			if len(kv) != 2 {
				continue
			}
			key, val := strings.TrimSpace(kv[0]), strings.TrimSpace(kv[1])
			switch key {
			case "ipv4.method":
				switch val {
				case "auto":
					vmk.Mode = "dhcp"
				case "manual":
					vmk.Mode = "static"
				default:
					vmk.Mode = val
				}
			case "ipv4.addresses":
				if val != "" && val != "--" {
					addr := strings.Split(val, ",")[0]
					if i := strings.Index(addr, "/"); i > 0 {
						vmk.IPv4 = addr[:i]
						fmt.Sscanf(addr[i+1:], "%d", &vmk.Prefix)
					} else {
						vmk.IPv4 = addr
					}
				}
			case "ipv4.gateway":
				if val != "" && val != "--" {
					vmk.Gateway = val
				}
			case "connection.zone":
				if val != "" && val != "--" {
					vmk.Zone = val
				}
			case "GENERAL.STATE":
				if strings.Contains(val, "activated") {
					vmk.State = "up"
				} else if val != "" {
					vmk.State = "down"
				}
			}
		}
		// 上行：读取该网桥的从属口（取第一个 ethernet/bond 成员）。
		vmk.Uplink = vmkBridgeUplink(c, name)
		vmk.IsMgmt = role == "mgmt" || vmk.Uplink == inv.MgmtDev
		inv.VMKs = append(inv.VMKs, vmk)
		inv.UsedRole[role] = true
	}
	return inv, nil
}

// vmkBridgeUplink 取某网桥的第一个上行从属设备（物理口/bond）。
func vmkBridgeUplink(c *onboard.SSHClient, bridge string) string {
	// br_port 在 /sys 下可靠列出该网桥的从属接口。
	out := strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`ls /sys/class/net/%q/brif 2>/dev/null | head -1`, bridge)))
	return out
}

// CreateVMKernel 真实创建一个 服务接口（带 IP + 流量标签的网桥）。
func CreateVMKernel(c *onboard.SSHClient, req CreateVMKernelRequest) ([]string, error) {
	var steps []string
	role := strings.TrimSpace(req.Role)
	if _, ok := vmkRoleNames[role]; !ok {
		return nil, fmt.Errorf("非法流量标签 %q（支持：mgmt/vmotion/storage/ft/repl/prov）", role)
	}
	if req.IPMode != "dhcp" && req.IPMode != "static" {
		return nil, fmt.Errorf("ip_mode 必须为 dhcp 或 static")
	}
	if strings.TrimSpace(c.RunQuiet(`systemctl is-active NetworkManager 2>/dev/null`)) != "active" {
		return nil, fmt.Errorf("目标主机未运行 NetworkManager，无法创建服务接口")
	}

	name := vmkDevName(role) // 事实来源：设备名=连接名=vmk-<role>
	if len(name) > 15 {
		return nil, fmt.Errorf("服务接口设备名 %q 超过 15 字符上限", name)
	}
	if existsConn(c, name) {
		return nil, fmt.Errorf("流量标签 %q 的 服务接口（%s）已存在，同一主机同一标签唯一", role, name)
	}

	uplink := strings.TrimSpace(req.Uplink)
	mgmtDev := strings.TrimSpace(c.RunQuiet(`ip route show default 2>/dev/null | awk '/default/{for(i=1;i<=NF;i++)if($i=="dev")print $(i+1)}' | head -1`))
	if uplink != "" {
		// 上行需真实存在。
		if strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`ip -o link show %q 2>/dev/null | head -1`, uplink))) == "" {
			return nil, fmt.Errorf("上行设备 %q 在目标主机不存在", uplink)
		}
		if uplink == mgmtDev && !req.AckMgmtRisk {
			return nil, fmt.Errorf("上行 %q 承载管理流量，配置服务接口 可能影响管理网络，请确认风险（ack_mgmt_risk=true）", uplink)
		}
	}
	if role == "mgmt" && !req.AckMgmtRisk {
		return nil, fmt.Errorf("管理流量服务接口 涉及主机管理网络，请确认风险（ack_mgmt_risk=true）")
	}

	if req.IPMode == "static" {
		if !ipv4ish(req.IPv4) {
			return nil, fmt.Errorf("static 模式需提供合法 ipv4 地址")
		}
		if req.Prefix < 1 || req.Prefix > 32 {
			return nil, fmt.Errorf("子网前缀非法：%d（合法 1..32）", req.Prefix)
		}
	}

	zone := "cnf-" + role
	var created []string
	rollback := func() {
		for i := len(created) - 1; i >= 0; i-- {
			_ = c.RunQuiet(fmt.Sprintf(`nmcli connection delete %q 2>/dev/null`, created[i]))
		}
	}

	// 1) 创建网桥（服务接口载体）。
	if o, err := c.Run(fmt.Sprintf(
		`nmcli connection add type bridge ifname %q con-name %q bridge.stp no 2>&1`, name, name)); err != nil {
		return steps, fmt.Errorf("创建 服务接口网桥失败: %v (%s)", err, o)
	}
	created = append(created, name)
	steps = append(steps, "创建 服务接口网桥 "+name+"（标签："+vmkRoleNames[role]+"）")

	// 2) IP 配置。
	if req.IPMode == "dhcp" {
		if o, err := c.Run(fmt.Sprintf(`nmcli connection modify %q ipv4.method auto ipv6.method ignore 2>&1`, name)); err != nil {
			rollback()
			return steps, fmt.Errorf("配置 DHCP 失败: %v (%s)", err, o)
		}
		steps = append(steps, "IP 模式 DHCP")
	} else {
		cmd := fmt.Sprintf(`nmcli connection modify %q ipv4.method manual ipv4.addresses %q ipv6.method ignore`,
			name, fmt.Sprintf("%s/%d", req.IPv4, req.Prefix))
		if strings.TrimSpace(req.Gateway) != "" {
			cmd += fmt.Sprintf(` ipv4.gateway %q`, strings.TrimSpace(req.Gateway))
		}
		if o, err := c.Run(cmd + " 2>&1"); err != nil {
			rollback()
			return steps, fmt.Errorf("配置静态 IP 失败: %v (%s)", err, o)
		}
		steps = append(steps, fmt.Sprintf("IP 模式 静态 %s/%d", req.IPv4, req.Prefix))
	}

	// 3) 流量标签：connection.zone = cnf-<role>（真实 firewalld 语义；区域不存在不影响连接）。
	if o, err := c.Run(fmt.Sprintf(`nmcli connection modify %q connection.zone %q 2>&1`, name, zone)); err != nil {
		steps = append(steps, "设置流量区域返回: "+o)
	} else {
		steps = append(steps, "流量标签区域 "+zone)
	}

	// 4) 绑定上行（可选）：把上行口作为该网桥的从属。
	if uplink != "" {
		portConn := name + "-port-" + uplink
		if len(portConn) > 60 {
			portConn = name + "-port"
		}
		if o, err := c.Run(fmt.Sprintf(
			`nmcli connection add type ethernet ifname %q con-name %q master %q 2>&1`, uplink, portConn, name)); err != nil {
			rollback()
			return steps, fmt.Errorf("绑定上行 %s 失败: %v (%s)", uplink, err, o)
		}
		created = append(created, portConn)
		steps = append(steps, "绑定上行 "+uplink)
	}

	// 5) 激活。
	if o, err := c.Run(fmt.Sprintf(`nmcli connection up %q 2>&1`, name)); err != nil {
		steps = append(steps, "激活返回: "+o)
	} else {
		steps = append(steps, "服务接口已激活")
	}

	// 6) 验证设备已出现。
	if strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`ip -o link show %q 2>/dev/null | head -1`, name))) == "" {
		rollback()
		return steps, fmt.Errorf("服务接口设备 %q 创建后未出现在系统中，已回滚", name)
	}
	steps = append(steps, "服务接口 "+name+" 创建完成")
	return steps, nil
}

// DeleteVMKernel 删除一个 服务接口（网桥 + 其上行从属口）。
func DeleteVMKernel(c *onboard.SSHClient, req DeleteVMKernelRequest) ([]string, error) {
	var steps []string
	name := strings.TrimSpace(req.Name)
	if !strings.HasPrefix(name, "vmk-") {
		return nil, fmt.Errorf("非法 服务接口名 %q（需以 vmk- 开头）", name)
	}
	role := strings.TrimPrefix(name, "vmk-")
	if _, ok := vmkRoleNames[role]; !ok {
		return nil, fmt.Errorf("非法 服务接口名 %q", name)
	}
	if !existsConn(c, name) {
		return nil, fmt.Errorf("服务接口 %q 不存在", name)
	}
	// 管理风险确认：管理标签或上行=管理口。
	uplink := vmkBridgeUplink(c, name)
	mgmtDev := strings.TrimSpace(c.RunQuiet(`ip route show default 2>/dev/null | awk '/default/{for(i=1;i<=NF;i++)if($i=="dev")print $(i+1)}' | head -1`))
	if (role == "mgmt" || uplink == mgmtDev) && !req.AckMgmtRisk {
		return nil, fmt.Errorf("该服务接口 承载管理流量，删除可能中断管理网络，请确认风险（ack_mgmt_risk=true）")
	}

	// 先删上行从属口（按命名前缀），再删网桥本体。
	ports := strings.Split(c.RunQuiet(fmt.Sprintf(`nmcli -t -f NAME connection show 2>/dev/null | grep '^%s-port'`, name)), "\n")
	for _, p := range ports {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		_ = c.RunQuiet(fmt.Sprintf(`nmcli connection delete %q 2>/dev/null`, p))
		steps = append(steps, "删除上行从属口 "+p)
	}
	if o, err := c.Run(fmt.Sprintf(`nmcli connection delete %q 2>&1`, name)); err != nil {
		return steps, fmt.Errorf("删除 服务接口网桥失败: %v (%s)", err, o)
	}
	steps = append(steps, "删除 服务接口网桥 "+name)
	return steps, nil
}

// ipv4ish 简单校验四段点分 IPv4（与前端正则同义，后端兜底）。
func ipv4ish(s string) bool {
	s = strings.TrimSpace(s)
	parts := strings.Split(s, ".")
	if len(parts) != 4 {
		return false
	}
	for _, p := range parts {
		if p == "" || len(p) > 3 {
			return false
		}
		n := 0
		for _, ch := range p {
			if ch < '0' || ch > '9' {
				return false
			}
			n = n*10 + int(ch-'0')
		}
		if n > 255 {
			return false
		}
	}
	return true
}
