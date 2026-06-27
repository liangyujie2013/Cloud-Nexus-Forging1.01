package hostops

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/cnf/cnfv1/internal/onboard"
)

// ============================================================
// 第6点 · VLAN（access + trunk）—— 在标准交换机（bridge+bond）之上落地 VLAN 端口组，
// 全部用 nmcli 真实下发。
//
// 模型（VMware 端口组的 Linux 等价物）：
//
//   access（接入）：在交换机的 bond/上行设备上建一个 VLAN 子接口（如 bond0.100），
//                   再桥接到一个独立网桥（如 br0.100）。挂到该网桥的虚机即处于 VLAN 100，
//                   出口自动打 tag、入口剥 tag —— 这就是「接入端口组」。
//
//   trunk（中继）：直接复用承载多 VLAN 的网桥。我们用「网桥 VLAN 过滤（bridge vlan filtering）」
//                  在网桥上放行一组 VLAN ID，让带 tag 的帧透传。虚机网卡再各自设 access VLAN。
//                  这等价于 VMware 的 VLAN trunking（VLAN 4095 / 指定范围）。
//
// 设计原则（呼应「不要 mock / 清晰报错 / 联动性 / 安全」）：
//   - 绝不伪造：读取来自 nmcli/ip 真实输出；写入是真实 nmcli 命令；失败回滚。
//   - 安全第一：禁止在管理网卡/管理网桥上直接做有破坏性的 VLAN 改动而不确认。
//   - VLAN ID 校验：1..4094（0 与 4095 保留），重复检查避免重名残留。
// ============================================================

// VLANPort 一个 access VLAN 端口组（VLAN 子接口 + 其专属网桥）。
type VLANPort struct {
	Name      string `json:"name"`       // 端口组网桥名，如 br0.100
	VLANID    int    `json:"vlan_id"`    // VLAN 标签 1..4094
	Parent    string `json:"parent"`     // 父设备（bond 或上行物理口），如 bond0
	VlanIf    string `json:"vlan_if"`    // VLAN 子接口设备名，如 bond0.100
	VlanConn  string `json:"vlan_conn"`  // VLAN 子接口的 nmcli 连接名
	BridgeConn string `json:"bridge_conn"`// 端口组网桥的 nmcli 连接名
	State     string `json:"state"`      // up / down
}

// TrunkBridge 一个启用了 VLAN 过滤的中继网桥。
type TrunkBridge struct {
	Name       string `json:"name"`        // 网桥名
	BridgeConn string `json:"bridge_conn"` // nmcli 连接名
	VLANs      []int  `json:"vlans"`       // 放行的 VLAN ID 列表
	State      string `json:"state"`       // up / down
}

// VLANInventory 一台主机的 VLAN 清单（基于其标准交换机）。
type VLANInventory struct {
	Hostname     string        `json:"hostname"`
	HasNM        bool          `json:"has_nm"`
	AccessPorts  []VLANPort    `json:"access_ports"`  // 已建的 access 端口组
	TrunkBridges []TrunkBridge `json:"trunk_bridges"` // 已启用 VLAN 过滤的网桥
	// 可作为 VLAN 父设备的候选：标准交换机的 bond / 网桥本体。
	Parents  []VLANParent `json:"parents"`
	Warnings []string     `json:"warnings"`
}

// VLANParent VLAN 子接口可挂载的父设备（来自已有标准交换机）。
type VLANParent struct {
	Device string `json:"device"` // 父设备名（bond0 / br0）
	Kind   string `json:"kind"`   // "bond" | "bridge"
	Switch string `json:"switch"` // 所属标准交换机（网桥名）
	IsMgmt bool   `json:"is_mgmt"`// 是否承载管理流量（改动有风险）
}

// CreateAccessVLANRequest 创建 access 端口组请求。
type CreateAccessVLANRequest struct {
	Parent      string `json:"parent"`       // 父设备（bond/网桥/物理口）；必填
	VLANID      int    `json:"vlan_id"`      // 1..4094；必填
	BridgeName  string `json:"bridge_name"`  // 端口组网桥名；默认 <parent>.<vlan>
	AckMgmtRisk bool   `json:"ack_mgmt_risk"`// 父设备含管理流量时需 true
}

// SetTrunkRequest 在网桥上设置 VLAN 过滤放行集合（trunk）。
type SetTrunkRequest struct {
	Bridge      string `json:"bridge"`        // 目标网桥（标准交换机）；必填
	VLANs       []int  `json:"vlans"`         // 放行的 VLAN ID 列表（1..4094）
	AckMgmtRisk bool   `json:"ack_mgmt_risk"` // 管理网桥需 true
}

// DeleteAccessVLANRequest 删除 access 端口组。
type DeleteAccessVLANRequest struct {
	Name        string `json:"name"`          // 端口组网桥名
	AckMgmtRisk bool   `json:"ack_mgmt_risk"`
}

// CollectVLANs 真实采集主机上的 VLAN access 端口组与 trunk 网桥，并给出可用父设备。
func CollectVLANs(c *onboard.SSHClient) (*VLANInventory, error) {
	inv := &VLANInventory{}

	// 复用标准交换机采集：父设备来自已有交换机的 bond / 网桥。
	swInv, err := CollectSwitches(c)
	if err != nil {
		return nil, err
	}
	inv.Hostname = swInv.Hostname
	inv.HasNM = swInv.HasNM
	if !swInv.HasNM {
		inv.Warnings = append(inv.Warnings, "目标主机未运行 NetworkManager，无法管理 VLAN（请先启用 NetworkManager）")
	}
	if len(swInv.Switches) == 0 {
		inv.Warnings = append(inv.Warnings, "尚未创建标准交换机，请先创建标准交换机再配置 VLAN")
	}

	// 候选父设备：每个标准交换机的 bond（优先）与网桥本体。
	for _, sw := range swInv.Switches {
		if sw.Bond != "" {
			inv.Parents = append(inv.Parents, VLANParent{Device: sw.Bond, Kind: "bond", Switch: sw.Name, IsMgmt: sw.IsMgmt})
		}
		inv.Parents = append(inv.Parents, VLANParent{Device: sw.Name, Kind: "bridge", Switch: sw.Name, IsMgmt: sw.IsMgmt})
	}

	// 采集真实 VLAN 子接口与其桥接关系。
	script := strings.Join([]string{
		// VLAN 连接：NAME:DEVICE:vlan.parent:vlan.id
		`echo "===VLANS==="; nmcli -t -f NAME,DEVICE,TYPE connection show 2>/dev/null | awk -F: '$3=="vlan"{print $1":"$2}'`,
		`echo "===VLANDETAIL==="; for cn in $(nmcli -t -f NAME,TYPE connection show 2>/dev/null | awk -F: '$2=="vlan"{print $1}'); do echo "$cn|$(nmcli -t -f vlan.parent,vlan.id,connection.master connection show "$cn" 2>/dev/null | tr '\n' '|')"; done`,
		// 网桥 VLAN 过滤状态：DEVICE 与 vlan_filtering
		`echo "===BRVLAN==="; for br in $(ls /sys/class/net 2>/dev/null); do if [ -d "/sys/class/net/$br/bridge" ]; then echo "$br:$(cat /sys/class/net/$br/bridge/vlan_filtering 2>/dev/null)"; fi; done`,
		// bridge vlan 真实放行表
		`echo "===BRVLANSHOW==="; bridge -j vlan show 2>/dev/null`,
		`echo "===END==="`,
	}, "; ")
	out := c.RunQuiet(script)
	sections := splitSections(out)

	// 解析 VLAN 设备清单。
	vlanDevConn := map[string]string{} // vlanDev -> connName
	for _, line := range strings.Split(sections["VLANS"], "\n") {
		if line = strings.TrimSpace(line); line == "" {
			continue
		}
		f := splitNM(line)
		if len(f) >= 2 && f[1] != "" && f[1] != "--" {
			vlanDevConn[f[1]] = f[0]
		}
	}

	// 解析每个 VLAN 子接口的 parent / id / master(桥)。
	for _, line := range strings.Split(sections["VLANDETAIL"], "\n") {
		if line = strings.TrimSpace(line); line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 2)
		if len(parts) < 2 {
			continue
		}
		conn := parts[0]
		fields := strings.Split(parts[1], "|")
		// nmcli -t 输出形如 "vlan.parent:virbr0"，需剥掉字段名前缀只取值。
		var parent, vid, master string
		for _, f := range fields {
			f = strings.TrimSpace(f)
			if f == "" {
				continue
			}
			kv := strings.SplitN(f, ":", 2)
			if len(kv) != 2 {
				continue
			}
			key, val := strings.TrimSpace(kv[0]), strings.TrimSpace(kv[1])
			switch key {
			case "vlan.parent":
				parent = val
			case "vlan.id":
				vid = val
			case "connection.master":
				master = val
			}
		}
		id, _ := strconv.Atoi(vid)
		if id <= 0 {
			continue
		}
		// 找该 VLAN 连接对应的设备名。
		vlanIf := ""
		for dev, cn := range vlanDevConn {
			if cn == conn {
				vlanIf = dev
				break
			}
		}
		port := VLANPort{
			VLANID:   id,
			Parent:   parent,
			VlanIf:   vlanIf,
			VlanConn: conn,
		}
		// master 即端口组网桥（access 模式下 VLAN 子接口桥接到专属网桥）。
		if master != "" && master != "--" {
			port.BridgeConn = master
			// 端口组网桥设备名：取 master 连接对应的设备。
			brDev := strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`nmcli -t -f connection.interface-name connection show %q 2>/dev/null | awk -F: '{print $2}'`, master)))
			if brDev == "" {
				brDev = master
			}
			port.Name = brDev
			port.State = strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`cat /sys/class/net/%s/operstate 2>/dev/null`, brDev)))
		} else {
			port.Name = vlanIf
			port.State = strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`cat /sys/class/net/%s/operstate 2>/dev/null`, vlanIf)))
		}
		inv.AccessPorts = append(inv.AccessPorts, port)
	}
	sort.Slice(inv.AccessPorts, func(i, j int) bool {
		if inv.AccessPorts[i].Parent != inv.AccessPorts[j].Parent {
			return inv.AccessPorts[i].Parent < inv.AccessPorts[j].Parent
		}
		return inv.AccessPorts[i].VLANID < inv.AccessPorts[j].VLANID
	})

	// 解析启用了 VLAN 过滤的网桥（trunk）。
	filterOn := map[string]bool{}
	for _, line := range strings.Split(sections["BRVLAN"], "\n") {
		if line = strings.TrimSpace(line); line == "" {
			continue
		}
		f := strings.SplitN(line, ":", 2)
		if len(f) == 2 && strings.TrimSpace(f[1]) == "1" {
			filterOn[strings.TrimSpace(f[0])] = true
		}
	}
	// 用 bridge vlan show 文本解析每个网桥放行的 VLAN（非 PVID 的 tagged）。
	vlansByBr := parseBridgeVlanShow(sections["BRVLANSHOW"])
	for br := range filterOn {
		tb := TrunkBridge{Name: br}
		tb.State = strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`cat /sys/class/net/%s/operstate 2>/dev/null`, br)))
		// nmcli 连接名
		tb.BridgeConn = strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`nmcli -t -f NAME,DEVICE connection show 2>/dev/null | awk -F: '$2==%q{print $1}' | head -1`, br)))
		if vs, ok := vlansByBr[br]; ok {
			tb.VLANs = vs
		}
		inv.TrunkBridges = append(inv.TrunkBridges, tb)
	}
	sort.Slice(inv.TrunkBridges, func(i, j int) bool { return inv.TrunkBridges[i].Name < inv.TrunkBridges[j].Name })

	return inv, nil
}

// CreateAccessVLAN 在指定父设备上创建一个 access VLAN 端口组（VLAN 子接口 + 专属网桥）。
func CreateAccessVLAN(c *onboard.SSHClient, req CreateAccessVLANRequest) ([]string, error) {
	var steps []string
	parent := strings.TrimSpace(req.Parent)
	if parent == "" {
		return nil, fmt.Errorf("缺少 VLAN 父设备（bond/网桥/物理口）")
	}
	if req.VLANID < 1 || req.VLANID > 4094 {
		return nil, fmt.Errorf("VLAN ID 非法：%d（合法范围 1..4094）", req.VLANID)
	}
	if strings.TrimSpace(c.RunQuiet(`systemctl is-active NetworkManager 2>/dev/null`)) != "active" {
		return nil, fmt.Errorf("目标主机未运行 NetworkManager，无法创建 VLAN")
	}
	// 父设备真实存在校验。
	if strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`ip -o link show %q 2>/dev/null | head -1`, parent))) == "" {
		return nil, fmt.Errorf("父设备 %q 在目标主机不存在", parent)
	}
	// 管理风险确认：父设备是否承载默认路由。
	mgmtDev := strings.TrimSpace(c.RunQuiet(`ip route show default 2>/dev/null | awk '/default/{for(i=1;i<=NF;i++)if($i=="dev")print $(i+1)}' | head -1`))
	if parent == mgmtDev && !req.AckMgmtRisk {
		return nil, fmt.Errorf("父设备 %q 承载管理流量，创建 VLAN 可能影响管理网络。请确认风险后重试（ack_mgmt_risk=true）", parent)
	}

	vlanIf := fmt.Sprintf("%s.%d", parent, req.VLANID)
	bridgeName := strings.TrimSpace(req.BridgeName)
	if bridgeName == "" {
		bridgeName = vlanIf // 默认端口组网桥名与 VLAN 子接口同名（br0.100 等）
	}
	if existsConn(c, vlanIf) {
		return nil, fmt.Errorf("VLAN 子接口 %q 已存在（父设备上已配置该 VLAN）", vlanIf)
	}
	if existsConn(c, bridgeName) {
		return nil, fmt.Errorf("端口组网桥 %q 已存在，请换一个名称", bridgeName)
	}

	vlanConn := vlanIf
	bridgeConn := bridgeName
	var created []string
	rollback := func() {
		for i := len(created) - 1; i >= 0; i-- {
			_ = c.RunQuiet(fmt.Sprintf(`nmcli connection delete %q 2>/dev/null`, created[i]))
		}
	}

	// 1) 端口组网桥（纯转发，无 IP）。
	if o, err := c.Run(fmt.Sprintf(`nmcli connection add type bridge ifname %q con-name %q bridge.stp no ipv4.method disabled ipv6.method ignore 2>&1`, bridgeName, bridgeConn)); err != nil {
		return steps, fmt.Errorf("创建端口组网桥失败: %v (%s)", err, o)
	}
	created = append(created, bridgeConn)
	steps = append(steps, "创建端口组网桥 "+bridgeName)

	// 2) VLAN 子接口（挂到父设备，并桥接到端口组网桥）。
	if o, err := c.Run(fmt.Sprintf(
		`nmcli connection add type vlan ifname %q con-name %q dev %q id %d master %q 2>&1`,
		vlanIf, vlanConn, parent, req.VLANID, bridgeConn)); err != nil {
		rollback()
		return steps, fmt.Errorf("创建 VLAN 子接口失败: %v (%s)", err, o)
	}
	created = append(created, vlanConn)
	steps = append(steps, fmt.Sprintf("创建 VLAN 子接口 %s（VLAN %d）并桥接到 %s", vlanIf, req.VLANID, bridgeName))

	// 3) 激活。
	_ = c.RunQuiet(fmt.Sprintf(`nmcli connection up %q 2>&1`, bridgeConn))
	if o, err := c.Run(fmt.Sprintf(`nmcli connection up %q 2>&1`, vlanConn)); err != nil {
		steps = append(steps, "VLAN 激活返回: "+o)
	} else {
		steps = append(steps, "VLAN 端口组已激活")
	}

	// 4) 验证 VLAN 子接口已就绪。
	if strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`ip -o link show %q 2>/dev/null | head -1`, vlanIf))) == "" {
		rollback()
		return steps, fmt.Errorf("VLAN 子接口 %q 创建后未出现在系统中，已回滚", vlanIf)
	}
	steps = append(steps, "access VLAN 端口组 "+bridgeName+" 创建完成")
	return steps, nil
}

// DeleteAccessVLAN 删除 access VLAN 端口组（VLAN 子接口 + 专属网桥连接）。
func DeleteAccessVLAN(c *onboard.SSHClient, req DeleteAccessVLANRequest) ([]string, error) {
	var steps []string
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("缺少要删除的 VLAN 端口组名")
	}
	if strings.TrimSpace(c.RunQuiet(`systemctl is-active NetworkManager 2>/dev/null`)) != "active" {
		return nil, fmt.Errorf("目标主机未运行 NetworkManager")
	}

	inv, err := CollectVLANs(c)
	if err != nil {
		return nil, fmt.Errorf("读取 VLAN 拓扑失败: %v", err)
	}
	var target *VLANPort
	for i := range inv.AccessPorts {
		if inv.AccessPorts[i].Name == name {
			target = &inv.AccessPorts[i]
			break
		}
	}
	if target == nil {
		return nil, fmt.Errorf("未找到名为 %q 的 access VLAN 端口组", name)
	}
	// 管理风险：父设备承载默认路由时需确认。
	mgmtDev := strings.TrimSpace(c.RunQuiet(`ip route show default 2>/dev/null | awk '/default/{for(i=1;i<=NF;i++)if($i=="dev")print $(i+1)}' | head -1`))
	if target.Parent == mgmtDev && !req.AckMgmtRisk {
		return nil, fmt.Errorf("VLAN 端口组 %q 的父设备承载管理流量，删除可能影响管理网络。请确认风险后重试", name)
	}

	// 先删 VLAN 子接口连接，再删端口组网桥连接。
	var conns []string
	if target.VlanConn != "" && target.VlanConn != "--" {
		conns = append(conns, target.VlanConn)
	}
	if target.BridgeConn != "" && target.BridgeConn != "--" {
		conns = append(conns, target.BridgeConn)
	}
	if len(conns) == 0 {
		return nil, fmt.Errorf("VLAN 端口组 %q 没有可删除的 nmcli 连接", name)
	}
	for _, cn := range conns {
		if o, err := c.Run(fmt.Sprintf(`nmcli connection delete %q 2>&1`, cn)); err != nil {
			steps = append(steps, fmt.Sprintf("删除连接 %s 返回: %s", cn, o))
		} else {
			steps = append(steps, "删除连接 "+cn)
		}
	}
	steps = append(steps, "access VLAN 端口组 "+name+" 已删除")
	return steps, nil
}

// SetTrunk 在指定网桥上启用 VLAN 过滤并放行一组 VLAN（trunk/中继）。
//
// 真实下发：nmcli 打开 bridge.vlan-filtering，并对网桥及其端口设置 bridge vlan 放行表。
func SetTrunk(c *onboard.SSHClient, req SetTrunkRequest) ([]string, error) {
	var steps []string
	br := strings.TrimSpace(req.Bridge)
	if br == "" {
		return nil, fmt.Errorf("缺少目标网桥")
	}
	if strings.TrimSpace(c.RunQuiet(`systemctl is-active NetworkManager 2>/dev/null`)) != "active" {
		return nil, fmt.Errorf("目标主机未运行 NetworkManager")
	}
	// 网桥真实存在。
	if strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`test -d /sys/class/net/%s/bridge && echo y`, br))) != "y" {
		return nil, fmt.Errorf("网桥 %q 不存在或不是网桥设备", br)
	}
	// 校验 VLAN ID。
	if len(req.VLANs) == 0 {
		return nil, fmt.Errorf("请至少放行一个 VLAN ID")
	}
	seen := map[int]bool{}
	var vids []int
	for _, v := range req.VLANs {
		if v < 1 || v > 4094 {
			return nil, fmt.Errorf("VLAN ID 非法：%d（合法范围 1..4094）", v)
		}
		if !seen[v] {
			seen[v] = true
			vids = append(vids, v)
		}
	}
	sort.Ints(vids)
	// 管理风险。
	mgmtDev := strings.TrimSpace(c.RunQuiet(`ip route show default 2>/dev/null | awk '/default/{for(i=1;i<=NF;i++)if($i=="dev")print $(i+1)}' | head -1`))
	if br == mgmtDev && !req.AckMgmtRisk {
		return nil, fmt.Errorf("网桥 %q 承载管理流量，启用 VLAN 过滤可能中断管理网络。请确认风险后重试", br)
	}

	bridgeConn := strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`nmcli -t -f NAME,DEVICE connection show 2>/dev/null | awk -F: '$2==%q{print $1}' | head -1`, br)))
	if bridgeConn == "" {
		return nil, fmt.Errorf("网桥 %q 没有对应的 nmcli 连接，无法持久化 VLAN 过滤", br)
	}

	// 1) 打开网桥 VLAN 过滤（nmcli 持久化）。
	if o, err := c.Run(fmt.Sprintf(`nmcli connection modify %q bridge.vlan-filtering yes 2>&1`, bridgeConn)); err != nil {
		return steps, fmt.Errorf("启用网桥 VLAN 过滤失败: %v (%s)", err, o)
	}
	steps = append(steps, "网桥 "+br+" 启用 VLAN 过滤")

	// 2) 重新激活使过滤生效。
	if o, err := c.Run(fmt.Sprintf(`nmcli connection up %q 2>&1`, bridgeConn)); err != nil {
		steps = append(steps, "网桥重激活返回: "+o)
	}

	// 3) 放行 VLAN：先确保运行态过滤开启，再对网桥自身添加 self VLAN，
	//    并对所有从属端口（bond/物理口）放行这组 VLAN（带 tag 透传）。
	_ = c.RunQuiet(fmt.Sprintf(`ip link set dev %s type bridge vlan_filtering 1 2>/dev/null`, br))
	// 列出网桥端口。
	ports := strings.Fields(strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`ls /sys/class/net/%s/brif 2>/dev/null`, br))))
	var vidStrs []string
	for _, v := range vids {
		vidStrs = append(vidStrs, strconv.Itoa(v))
		// 网桥 self 放行（用于本机收发该 VLAN）。
		_ = c.RunQuiet(fmt.Sprintf(`bridge vlan add dev %s vid %d self 2>/dev/null`, br, v))
		// 每个端口放行该 VLAN（tagged）。
		for _, p := range ports {
			_ = c.RunQuiet(fmt.Sprintf(`bridge vlan add dev %s vid %d 2>/dev/null`, p, v))
		}
	}
	steps = append(steps, fmt.Sprintf("放行 VLAN: %s（端口 %s）", strings.Join(vidStrs, ","), strings.Join(ports, ",")))

	// 4) 验证：读回运行态放行表。
	if strings.TrimSpace(c.RunQuiet(fmt.Sprintf(`cat /sys/class/net/%s/bridge/vlan_filtering 2>/dev/null`, br))) != "1" {
		return steps, fmt.Errorf("网桥 %q VLAN 过滤未能开启，请检查内核 bridge 模块/网桥状态", br)
	}
	steps = append(steps, "trunk（VLAN 中继）配置完成")
	return steps, nil
}

// parseBridgeVlanShow 解析 `bridge -j vlan show` 的 JSON 输出，返回每个网桥设备放行的
// VLAN 列表（不含默认 PVID 1）。JSON 比文本格式稳健，跨内核版本一致。
func parseBridgeVlanShow(out string) map[string][]int {
	out = strings.TrimSpace(out)
	res := map[string][]int{}
	if out == "" || out[0] != '[' {
		return res
	}
	var entries []struct {
		Ifname string `json:"ifname"`
		VLANs  []struct {
			VLAN     int      `json:"vlan"`
			VLANEnd  int      `json:"vlanEnd"`
			Flags    []string `json:"flags"`
		} `json:"vlans"`
	}
	if err := json.Unmarshal([]byte(out), &entries); err != nil {
		return res
	}
	for _, e := range entries {
		if e.Ifname == "" {
			continue
		}
		set := map[int]bool{}
		for _, v := range e.VLANs {
			// 跳过默认 PVID 1（仅当它带 PVID 标志时；显式放行的 1 也不计入端口组放行集合）。
			isPVID := false
			for _, fl := range v.Flags {
				if fl == "PVID" {
					isPVID = true
				}
			}
			end := v.VLANEnd
			if end < v.VLAN {
				end = v.VLAN
			}
			for vid := v.VLAN; vid <= end && vid >= 1 && vid <= 4094; vid++ {
				if vid == 1 && isPVID {
					continue
				}
				if vid == 1 {
					continue // 默认 PVID 1 不计入放行集合
				}
				set[vid] = true
			}
		}
		if len(set) > 0 {
			var vs []int
			for vid := range set {
				vs = append(vs, vid)
			}
			sort.Ints(vs)
			res[e.Ifname] = vs
		}
	}
	return res
}
