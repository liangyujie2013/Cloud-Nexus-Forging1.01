package hostops

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/cnf/cnfv1/internal/onboard"
)

// LiveMetrics 主机实时性能指标（轻量、单次 SSH，用于列表卡片与监控刷新）。
//
// 全部为真实采集：CPU 使用率通过两次 /proc/stat 采样差值计算，内存通过 free -m，
// 负载通过 /proc/loadavg，磁盘通过 df。绝不使用随机数/伪造。
type LiveMetrics struct {
	Reachable    bool    `json:"reachable"`
	CPUUsagePct  float64 `json:"cpu_usage_pct"`  // 0-100，整机 CPU 使用率
	CPUCores     int     `json:"cpu_cores"`      // 逻辑核数
	Load1        float64 `json:"load1"`          // 1 分钟负载
	Load5        float64 `json:"load5"`          // 5 分钟负载
	Load15       float64 `json:"load15"`         // 15 分钟负载
	MemTotalMB   int64   `json:"mem_total_mb"`
	MemUsedMB    int64   `json:"mem_used_mb"`
	MemUsagePct  float64 `json:"mem_usage_pct"`  // 0-100
	SwapTotalMB  int64   `json:"swap_total_mb"`
	SwapUsedMB   int64   `json:"swap_used_mb"`
	RootDiskPct  float64 `json:"root_disk_pct"`  // 根分区使用率
	UptimeSec    int64   `json:"uptime_sec"`
}

// CollectLiveMetrics 在一个 SSH 会话内采集实时指标。
//
// CPU 使用率：读两次 /proc/stat（间隔 0.5s），按 (busyΔ / totalΔ) 计算，得到真实瞬时占用。
func CollectLiveMetrics(c *onboard.SSHClient) (*LiveMetrics, error) {
	m := &LiveMetrics{}
	// 一条聚合脚本：先取 stat 快照1 → sleep 0.5 → stat 快照2 + 其余指标，单次往返。
	script := strings.Join([]string{
		`echo "===STAT1==="; grep '^cpu ' /proc/stat`,
		`sleep 0.5`,
		`echo "===STAT2==="; grep '^cpu ' /proc/stat`,
		`echo "===NPROC==="; nproc 2>/dev/null`,
		`echo "===LOADAVG==="; cat /proc/loadavg 2>/dev/null`,
		`echo "===MEM==="; free -m 2>/dev/null`,
		`echo "===DISK==="; df -P / 2>/dev/null`,
		`echo "===UPTIME==="; cat /proc/uptime 2>/dev/null`,
		`echo "===END==="`,
	}, "; ")

	out, err := c.Run(script)
	if err != nil && out == "" {
		return nil, err
	}
	m.Reachable = true
	parseLiveMetrics(m, out)
	return m, nil
}

func parseLiveMetrics(m *LiveMetrics, out string) {
	sec := splitSections(out)

	m.CPUUsagePct = cpuUsageFromStats(firstLine(sec["STAT1"]), firstLine(sec["STAT2"]))

	if np := strings.TrimSpace(firstLine(sec["NPROC"])); np != "" {
		m.CPUCores, _ = strconv.Atoi(np)
	}
	if la := firstLine(sec["LOADAVG"]); la != "" {
		f := strings.Fields(la)
		if len(f) >= 3 {
			m.Load1, _ = strconv.ParseFloat(f[0], 64)
			m.Load5, _ = strconv.ParseFloat(f[1], 64)
			m.Load15, _ = strconv.ParseFloat(f[2], 64)
		}
	}
	// 复用 status.go 中的 free -m 解析逻辑（这里内联，避免耦合 HostStatus）
	parseMemLive(m, sec["MEM"])
	parseDiskLive(m, sec["DISK"])

	if up := firstLine(sec["UPTIME"]); up != "" {
		if f := strings.Fields(up); len(f) >= 1 {
			if v, e := strconv.ParseFloat(f[0], 64); e == nil {
				m.UptimeSec = int64(v)
			}
		}
	}
}

// cpuUsageFromStats 由两次 `cpu ...` 行计算整机 CPU 使用率（百分比）。
//
// /proc/stat 的 cpu 行：user nice system idle iowait irq softirq steal guest guest_nice
// busy = total - (idle + iowait)；usage = busyΔ / totalΔ * 100。
func cpuUsageFromStats(line1, line2 string) float64 {
	t1, i1, ok1 := parseCPULine(line1)
	t2, i2, ok2 := parseCPULine(line2)
	if !ok1 || !ok2 {
		return 0
	}
	totalDelta := t2 - t1
	idleDelta := i2 - i1
	if totalDelta <= 0 {
		return 0
	}
	usage := float64(totalDelta-idleDelta) / float64(totalDelta) * 100
	if usage < 0 {
		usage = 0
	}
	if usage > 100 {
		usage = 100
	}
	return round1(usage)
}

// parseCPULine 解析 `cpu  ...` 行，返回 total、idle(=idle+iowait)。
func parseCPULine(line string) (total, idle int64, ok bool) {
	f := strings.Fields(line)
	if len(f) < 5 || f[0] != "cpu" {
		return 0, 0, false
	}
	vals := make([]int64, 0, len(f)-1)
	for _, s := range f[1:] {
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			break
		}
		vals = append(vals, v)
	}
	if len(vals) < 4 {
		return 0, 0, false
	}
	var sum int64
	for _, v := range vals {
		sum += v
	}
	// idle = vals[3]; iowait = vals[4]（若存在）
	idleVal := vals[3]
	if len(vals) >= 5 {
		idleVal += vals[4]
	}
	return sum, idleVal, true
}

func parseMemLive(m *LiveMetrics, block string) {
	for _, line := range strings.Split(block, "\n") {
		f := strings.Fields(line)
		if len(f) < 3 {
			continue
		}
		switch strings.TrimSuffix(strings.ToLower(f[0]), ":") {
		case "mem":
			m.MemTotalMB, _ = strconv.ParseInt(f[1], 10, 64)
			m.MemUsedMB, _ = strconv.ParseInt(f[2], 10, 64)
		case "swap":
			m.SwapTotalMB, _ = strconv.ParseInt(f[1], 10, 64)
			m.SwapUsedMB, _ = strconv.ParseInt(f[2], 10, 64)
		}
	}
	if m.MemTotalMB > 0 {
		m.MemUsagePct = round1(float64(m.MemUsedMB) / float64(m.MemTotalMB) * 100)
	}
}

func parseDiskLive(m *LiveMetrics, block string) {
	lines := strings.Split(strings.TrimSpace(block), "\n")
	if len(lines) < 2 {
		return
	}
	f := strings.Fields(lines[len(lines)-1])
	for _, col := range f {
		if strings.HasSuffix(col, "%") {
			if v, e := strconv.ParseFloat(strings.TrimSuffix(col, "%"), 64); e == nil {
				m.RootDiskPct = v
				return
			}
		}
	}
}

// String 便于调试。
func (m *LiveMetrics) String() string {
	return fmt.Sprintf("CPU=%.1f%% MEM=%.1f%%(%d/%dMB) load=%.2f disk=%.0f%%",
		m.CPUUsagePct, m.MemUsagePct, m.MemUsedMB, m.MemTotalMB, m.Load1, m.RootDiskPct)
}
