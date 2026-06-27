package hostops

import (
	"math"
	"testing"
)

func TestParseCPULine(t *testing.T) {
	// cpu  user nice system idle iowait irq softirq steal
	total, idle, ok := parseCPULine("cpu  100 0 50 800 50 0 0 0")
	if !ok {
		t.Fatal("should parse")
	}
	// sum = 100+0+50+800+50 = 1000; idle = 800+50 = 850
	if total != 1000 || idle != 850 {
		t.Errorf("total=%d idle=%d, want 1000/850", total, idle)
	}
}

func TestCPUUsageFromStats(t *testing.T) {
	// snapshot1: total=1000 idle=850 (busy=150)
	// snapshot2: total=1100 idle=900 (busy=200) → delta total=100 idle=50 busy=50 → 50%
	s1 := "cpu  100 0 50 800 50 0 0 0"
	s2 := "cpu  130 0 70 850 50 0 0 0" // sum=1100, idle=850+50=900
	got := cpuUsageFromStats(s1, s2)
	if math.Abs(got-50.0) > 0.6 {
		t.Errorf("cpu usage = %.1f, want ~50", got)
	}
}

func TestCPUUsageZeroDelta(t *testing.T) {
	// identical snapshots → 0% (no division panic)
	s := "cpu  100 0 50 800 50 0 0 0"
	if got := cpuUsageFromStats(s, s); got != 0 {
		t.Errorf("identical snapshots should be 0, got %.1f", got)
	}
}

func TestCPUUsageClamped(t *testing.T) {
	// malformed / empty → 0, no panic
	if got := cpuUsageFromStats("", ""); got != 0 {
		t.Errorf("empty → 0, got %.1f", got)
	}
}

func TestParseLiveMetrics(t *testing.T) {
	out := `===STAT1===
cpu  1000 0 500 8000 500 0 0 0
===STAT2===
cpu  1100 0 550 8400 500 0 0 0
===NPROC===
4
===LOADAVG===
0.50 0.30 0.20 1/200 12345
===MEM===
              total        used        free      shared  buff/cache   available
Mem:           7820        2000        3000         100        2820        5500
Swap:          2048         100        1948
===DISK===
Filesystem     1024-blocks    Used Available Capacity Mounted on
/dev/sda1         51200000 10240000  40960000      20% /
===UPTIME===
123456.78 100000.00
===END===`
	m := &LiveMetrics{}
	parseLiveMetrics(m, out)
	if m.CPUCores != 4 {
		t.Errorf("cores=%d", m.CPUCores)
	}
	if m.Load1 != 0.5 {
		t.Errorf("load1=%v", m.Load1)
	}
	if m.MemTotalMB != 7820 || m.MemUsedMB != 2000 {
		t.Errorf("mem=%d/%d", m.MemUsedMB, m.MemTotalMB)
	}
	wantMemPct := round1(2000.0 / 7820.0 * 100)
	if m.MemUsagePct != wantMemPct {
		t.Errorf("mem pct=%v want %v", m.MemUsagePct, wantMemPct)
	}
	if m.SwapTotalMB != 2048 || m.SwapUsedMB != 100 {
		t.Errorf("swap=%d/%d", m.SwapUsedMB, m.SwapTotalMB)
	}
	if m.RootDiskPct != 20 {
		t.Errorf("disk=%v", m.RootDiskPct)
	}
	if m.UptimeSec != 123456 {
		t.Errorf("uptime=%d", m.UptimeSec)
	}
	// CPU: delta total = (1100+550+8400+500)-(1000+500+8000+500)... compute
	// s1 sum=1000+0+500+8000+500=10000, idle=8000+500=8500
	// s2 sum=1100+0+550+8400+500=10550, idle=8400+500=8900
	// dtotal=550, didle=400, busy=150 → 150/550=27.3%
	if math.Abs(m.CPUUsagePct-27.3) > 1.0 {
		t.Errorf("cpu pct=%v want ~27.3", m.CPUUsagePct)
	}
}
