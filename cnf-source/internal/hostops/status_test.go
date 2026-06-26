package hostops

import "testing"

func TestParseStatus(t *testing.T) {
	out := `===HOSTNAME===
node-a
===OS===
Rocky Linux 10.0 (Red Quartz)
===KERNEL===
6.12.0-55.el10.x86_64
===UPTIME===
123456.78 98765.43
===BOOT===
2026-06-20 09:00:00
===LOADAVG===
0.52 0.61 0.70 2/512 12345
===NPROC===
8
===MEM===
              total        used        free      shared  buff/cache   available
Mem:          16000        4000        2000         100       10000       11500
Swap:          2048         256        1792
===DISK===
Filesystem     1024-blocks    Used Available Capacity Mounted on
/dev/vda1         51200000 20480000  30720000      40% /
===LIBVIRT===
active
===KVM===
2
===SELINUX===
Enforcing
===FIREWALLD===
active
===SSHPORT===
2222
===END===
`
	st := &HostStatus{}
	parseStatus(st, out)

	if st.Hostname != "node-a" {
		t.Errorf("hostname=%q", st.Hostname)
	}
	if st.OSPretty != "Rocky Linux 10.0 (Red Quartz)" {
		t.Errorf("os=%q", st.OSPretty)
	}
	if st.UptimeSec != 123456 {
		t.Errorf("uptime=%d", st.UptimeSec)
	}
	if st.Load1 != 0.52 || st.Load5 != 0.61 || st.Load15 != 0.70 {
		t.Errorf("load=%v %v %v", st.Load1, st.Load5, st.Load15)
	}
	if st.CPUCores != 8 {
		t.Errorf("cores=%d", st.CPUCores)
	}
	if st.MemTotalMB != 16000 || st.MemUsedMB != 4000 {
		t.Errorf("mem total=%d used=%d", st.MemTotalMB, st.MemUsedMB)
	}
	if st.MemUsagePct != 25 {
		t.Errorf("mem pct=%v want 25", st.MemUsagePct)
	}
	if st.SwapTotalMB != 2048 || st.SwapUsedMB != 256 {
		t.Errorf("swap total=%d used=%d", st.SwapTotalMB, st.SwapUsedMB)
	}
	if st.RootDiskPct != 40 {
		t.Errorf("disk pct=%v", st.RootDiskPct)
	}
	if st.LibvirtState != "active" {
		t.Errorf("libvirt=%q", st.LibvirtState)
	}
	if !st.KVMLoaded {
		t.Error("kvm should be loaded")
	}
	if st.SELinux != "enforcing" {
		t.Errorf("selinux=%q", st.SELinux)
	}
	if st.Firewalld != "active" {
		t.Errorf("firewalld=%q", st.Firewalld)
	}
	if st.SSHPort != 2222 {
		t.Errorf("ssh port=%d", st.SSHPort)
	}
}

func TestParseStatusDefaultsSSHPort(t *testing.T) {
	st := &HostStatus{}
	parseStatus(st, "===SSHPORT===\n\n===END===\n")
	if st.SSHPort != 22 {
		t.Errorf("default ssh port should be 22, got %d", st.SSHPort)
	}
}
