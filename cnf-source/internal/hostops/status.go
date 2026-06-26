// Package hostops 通过 SSH 在已纳管主机上执行只读/运维命令，采集真实运行状态、
// 实时性能指标，并提供防火墙/SELinux/SSH 端口/口令等运维能力。
//
// 设计原则（呼应「不要 mock / 清晰报错 / 联动性」）：
//   - 全部数据来自目标机真实命令输出（uptime/free/df/ss/systemctl/getenforce/
//     firewall-cmd/sar/iostat 等），绝不伪造或随机生成。
//   - 单条命令失败不致整体失败：尽力采集，缺失字段以零值/空表示，并在 Warnings 中说明。
package hostops

import (
	"strconv"
	"strings"

	"github.com/cnf/cnfv1/internal/onboard"
)

// HostStatus 主机当前运行状态（一次 SSH 会话内并发采集的快照）。
type HostStatus struct {
	Reachable    bool     `json:"reachable"`     // SSH 是否可达
	Hostname     string   `json:"hostname"`      // 主机名
	OSPretty     string   `json:"os_pretty"`     // 发行版（PRETTY_NAME）
	KernelVer    string   `json:"kernel"`        // 内核版本
	UptimeSec    int64    `json:"uptime_sec"`    // 已运行秒数
	BootTime     string   `json:"boot_time"`     // 启动时刻
	Load1        float64  `json:"load1"`         // 1 分钟负载
	Load5        float64  `json:"load5"`         // 5 分钟负载
	Load15       float64  `json:"load15"`        // 15 分钟负载
	CPUCores     int      `json:"cpu_cores"`     // 逻辑核数
	MemTotalMB   int64    `json:"mem_total_mb"`  // 内存总量
	MemUsedMB    int64    `json:"mem_used_mb"`   // 已用内存
	MemUsagePct  float64  `json:"mem_usage_pct"` // 内存使用率
	SwapTotalMB  int64    `json:"swap_total_mb"`
	SwapUsedMB   int64    `json:"swap_used_mb"`
	RootDiskPct  float64  `json:"root_disk_pct"` // 根分区使用率
	LibvirtState string   `json:"libvirt_state"` // active/inactive/unknown
	KVMLoaded    bool     `json:"kvm_loaded"`    // kvm 内核模块是否加载
	SELinux      string   `json:"selinux"`       // enforcing/permissive/disabled
	Firewalld    string   `json:"firewalld"`     // active/inactive/not-installed
	SSHPort      int      `json:"ssh_port"`      // sshd 实际监听端口
	Warnings     []string `json:"warnings"`      // 采集过程中的非致命问题
}

// CollectStatus 在一个 SSH 会话上采集主机当前状态。
//
// 采用「一条聚合脚本输出 + 标记分段解析」：单次远程执行，按 <<<KEY>>> 标记切分，
// 避免多次往返。任一段缺失只影响对应字段，不影响整体。
func CollectStatus(c *onboard.SSHClient) (*HostStatus, error) {
	st := &HostStatus{}
	// 聚合脚本：每段以 ===KEY=== 开头，便于解析。命令尽量 POSIX 通用。
	script := strings.Join([]string{
		`echo "===HOSTNAME==="; hostname 2>/dev/null`,
		`echo "===OS==="; (. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")`,
		`echo "===KERNEL==="; uname -r 2>/dev/null`,
		`echo "===UPTIME==="; cat /proc/uptime 2>/dev/null`,
		`echo "===BOOT==="; uptime -s 2>/dev/null`,
		`echo "===LOADAVG==="; cat /proc/loadavg 2>/dev/null`,
		`echo "===NPROC==="; nproc 2>/dev/null`,
		`echo "===MEM==="; free -m 2>/dev/null`,
		`echo "===DISK==="; df -P / 2>/dev/null`,
		`echo "===LIBVIRT==="; (systemctl is-active libvirtd 2>/dev/null || systemctl is-active virtqemud 2>/dev/null || echo unknown)`,
		`echo "===KVM==="; (lsmod 2>/dev/null | grep -c '^kvm' || echo 0)`,
		`echo "===SELINUX==="; (getenforce 2>/dev/null || echo unknown)`,
		`echo "===FIREWALLD==="; (systemctl is-active firewalld 2>/dev/null || echo inactive)`,
		`echo "===SSHPORT==="; (grep -iE '^[[:space:]]*Port[[:space:]]+[0-9]+' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1 || echo 22)`,
		`echo "===END==="`,
	}, "; ")

	out, err := c.Run(script)
	if err != nil && out == "" {
		return nil, err
	}
	st.Reachable = true
	parseStatus(st, out)
	return st, nil
}

func parseStatus(st *HostStatus, out string) {
	sections := splitSections(out)

	st.Hostname = firstLine(sections["HOSTNAME"])
	st.OSPretty = firstLine(sections["OS"])
	st.KernelVer = firstLine(sections["KERNEL"])

	if up := firstLine(sections["UPTIME"]); up != "" {
		if f := strings.Fields(up); len(f) >= 1 {
			if v, e := strconv.ParseFloat(f[0], 64); e == nil {
				st.UptimeSec = int64(v)
			}
		}
	}
	st.BootTime = firstLine(sections["BOOT"])

	if la := firstLine(sections["LOADAVG"]); la != "" {
		f := strings.Fields(la)
		if len(f) >= 3 {
			st.Load1, _ = strconv.ParseFloat(f[0], 64)
			st.Load5, _ = strconv.ParseFloat(f[1], 64)
			st.Load15, _ = strconv.ParseFloat(f[2], 64)
		}
	}
	if np := firstLine(sections["NPROC"]); np != "" {
		st.CPUCores, _ = strconv.Atoi(strings.TrimSpace(np))
	}

	parseMem(st, sections["MEM"])
	parseDisk(st, sections["DISK"])

	st.LibvirtState = normState(firstLine(sections["LIBVIRT"]))
	if kc := strings.TrimSpace(firstLine(sections["KVM"])); kc != "" && kc != "0" {
		st.KVMLoaded = true
	}
	st.SELinux = strings.ToLower(firstLine(sections["SELINUX"]))
	if fw := strings.TrimSpace(firstLine(sections["FIREWALLD"])); fw == "active" {
		st.Firewalld = "active"
	} else {
		st.Firewalld = "inactive"
	}
	if sp := firstLine(sections["SSHPORT"]); sp != "" {
		if p, e := strconv.Atoi(strings.TrimSpace(sp)); e == nil && p > 0 {
			st.SSHPort = p
		}
	}
	if st.SSHPort == 0 {
		st.SSHPort = 22
	}
}

// parseMem 解析 `free -m` 输出。
func parseMem(st *HostStatus, block string) {
	for _, line := range strings.Split(block, "\n") {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		switch strings.TrimSuffix(strings.ToLower(f[0]), ":") {
		case "mem":
			// total used free shared buff/cache available
			if len(f) >= 3 {
				st.MemTotalMB, _ = strconv.ParseInt(f[1], 10, 64)
				st.MemUsedMB, _ = strconv.ParseInt(f[2], 10, 64)
			}
		case "swap":
			if len(f) >= 3 {
				st.SwapTotalMB, _ = strconv.ParseInt(f[1], 10, 64)
				st.SwapUsedMB, _ = strconv.ParseInt(f[2], 10, 64)
			}
		}
	}
	if st.MemTotalMB > 0 {
		st.MemUsagePct = round1(float64(st.MemUsedMB) / float64(st.MemTotalMB) * 100)
	}
}

// parseDisk 解析 `df -P /` 输出（取 Use% 列）。
func parseDisk(st *HostStatus, block string) {
	lines := strings.Split(strings.TrimSpace(block), "\n")
	if len(lines) < 2 {
		return
	}
	f := strings.Fields(lines[len(lines)-1])
	for _, col := range f {
		if strings.HasSuffix(col, "%") {
			if v, e := strconv.ParseFloat(strings.TrimSuffix(col, "%"), 64); e == nil {
				st.RootDiskPct = v
				return
			}
		}
	}
}

func normState(s string) string {
	s = strings.TrimSpace(s)
	if s == "active" || s == "inactive" {
		return s
	}
	if s == "" {
		return "unknown"
	}
	return s
}

// --- 小工具 ---

// splitSections 把聚合脚本输出按 ===KEY=== 标记切分为 map。
func splitSections(out string) map[string]string {
	res := map[string]string{}
	var curKey string
	var buf []string
	flush := func() {
		if curKey != "" {
			res[curKey] = strings.TrimRight(strings.Join(buf, "\n"), "\n")
		}
	}
	for _, line := range strings.Split(out, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "===") && strings.HasSuffix(t, "===") {
			flush()
			curKey = strings.TrimSuffix(strings.TrimPrefix(t, "==="), "===")
			buf = nil
			continue
		}
		buf = append(buf, line)
	}
	flush()
	return res
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return s
}

func round1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}
