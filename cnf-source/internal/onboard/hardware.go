package onboard

import (
	"strconv"
	"strings"
)

// HardwareInfo 远程采集到的真实硬件清单。
type HardwareInfo struct {
	Hostname        string         `json:"hostname"`
	OSVersion       string         `json:"os_version"`
	KernelVersion   string         `json:"kernel_version"`
	CPUModel        string         `json:"cpu_model"`
	CPUSockets      int            `json:"cpu_sockets"`
	CPUCoresPerSock int            `json:"cpu_cores_per_socket"`
	CPUThreadsPerCo int            `json:"cpu_threads_per_core"`
	CPUTotalLogical int            `json:"cpu_total_logical"`
	NUMANodes       int            `json:"numa_nodes"`
	MemoryTotalMB   int64          `json:"memory_total_mb"`
	LibvirtVersion  string         `json:"libvirt_version"`
	QEMUVersion     string         `json:"qemu_version"`
	IOMMUEnabled    bool           `json:"iommu_enabled"`
	GPUs            []GPUInfo      `json:"gpus"`
	Disks           []DiskInfo     `json:"disks"`
	NICs            []NICInfo      `json:"nics"`
	Raw             map[string]any `json:"raw,omitempty"`
}

// GPUInfo PCI GPU 设备。
type GPUInfo struct {
	PCIAddress string `json:"pci_address"`
	Vendor     string `json:"vendor"`
	Model      string `json:"model"`
}

// DiskInfo 块设备。
type DiskInfo struct {
	Name       string `json:"name"`
	SizeBytes  int64  `json:"size_bytes"`
	Rotational bool   `json:"rotational"`
}

// NICInfo 物理网卡。
type NICInfo struct {
	Name    string `json:"name"`
	MAC     string `json:"mac"`
	SpeedMb int    `json:"speed_mb"`
}

// CollectHardware 通过一组只读命令采集主机硬件清单（不修改目标主机）。
func CollectHardware(c *SSHClient) (*HardwareInfo, error) {
	hw := &HardwareInfo{Raw: map[string]any{}}

	hw.Hostname = c.RunQuiet("hostname -f")
	hw.OSVersion = parseOSRelease(c.RunQuiet("cat /etc/os-release"))
	hw.KernelVersion = c.RunQuiet("uname -r")

	// lscpu 解析 CPU 拓扑
	lscpu := c.RunQuiet("LANG=C lscpu")
	parseLscpu(lscpu, hw)

	// 内存
	if memKB := parseMeminfoKB(c.RunQuiet("cat /proc/meminfo")); memKB > 0 {
		hw.MemoryTotalMB = memKB / 1024
	}

	// libvirt / qemu 版本
	hw.LibvirtVersion = strings.TrimSpace(c.RunQuiet("libvirtd --version 2>/dev/null | awk '{print $NF}'"))
	hw.QEMUVersion = strings.TrimSpace(c.RunQuiet("qemu-system-x86_64 --version 2>/dev/null | head -1 | awk '{print $4}'"))

	// IOMMU（内核命令行含 intel_iommu=on 或 amd_iommu=on，且 /sys/kernel/iommu_groups 非空）
	cmdline := c.RunQuiet("cat /proc/cmdline")
	groups := c.RunQuiet("ls /sys/kernel/iommu_groups 2>/dev/null | wc -l")
	hw.IOMMUEnabled = (strings.Contains(cmdline, "iommu=on") || strings.Contains(cmdline, "iommu=pt")) && atoiSafe(groups) > 0

	// GPU（lspci 过滤 VGA / 3D / Display 控制器）
	hw.GPUs = parseGPUs(c.RunQuiet("lspci -D 2>/dev/null"))

	// 块设备
	hw.Disks = parseDisks(c.RunQuiet("lsblk -dnb -o NAME,SIZE,ROTA 2>/dev/null"))

	// 物理网卡
	hw.NICs = parseNICs(c)

	return hw, nil
}

// ---- 解析函数 ----

func parseOSRelease(s string) string {
	for _, line := range strings.Split(s, "\n") {
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)
		}
	}
	return ""
}

func parseLscpu(s string, hw *HardwareInfo) {
	var sockets, coresPerSock, threadsPerCore, cpus, numa int
	for _, line := range strings.Split(s, "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		switch key {
		case "Model name":
			hw.CPUModel = val
		case "Socket(s)":
			sockets = atoiSafe(val)
		case "Core(s) per socket":
			coresPerSock = atoiSafe(val)
		case "Thread(s) per core":
			threadsPerCore = atoiSafe(val)
		case "CPU(s)":
			cpus = atoiSafe(val)
		case "NUMA node(s)":
			numa = atoiSafe(val)
		}
	}
	if sockets == 0 {
		sockets = 1
	}
	if coresPerSock == 0 {
		coresPerSock = 1
	}
	if threadsPerCore == 0 {
		threadsPerCore = 1
	}
	if numa == 0 {
		numa = 1
	}
	hw.CPUSockets = sockets
	hw.CPUCoresPerSock = coresPerSock
	hw.CPUThreadsPerCo = threadsPerCore
	hw.NUMANodes = numa
	if cpus > 0 {
		hw.CPUTotalLogical = cpus
	} else {
		hw.CPUTotalLogical = sockets * coresPerSock * threadsPerCore
	}
}

func parseMeminfoKB(s string) int64 {
	for _, line := range strings.Split(s, "\n") {
		if strings.HasPrefix(line, "MemTotal:") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				return int64(atoiSafe(f[1]))
			}
		}
	}
	return 0
}

func parseGPUs(lspci string) []GPUInfo {
	var out []GPUInfo
	for _, line := range strings.Split(lspci, "\n") {
		low := strings.ToLower(line)
		if !strings.Contains(low, "vga compatible controller") &&
			!strings.Contains(low, "3d controller") &&
			!strings.Contains(low, "display controller") {
			continue
		}
		// 形如: 0000:01:00.0 VGA compatible controller: NVIDIA Corporation ...
		fields := strings.SplitN(line, " ", 2)
		if len(fields) < 2 {
			continue
		}
		addr := fields[0]
		desc := fields[1]
		if idx := strings.Index(desc, ": "); idx >= 0 {
			desc = desc[idx+2:]
		}
		vendor := "unknown"
		dl := strings.ToLower(desc)
		switch {
		case strings.Contains(dl, "nvidia"):
			vendor = "NVIDIA"
		case strings.Contains(dl, "amd") || strings.Contains(dl, "ati"):
			vendor = "AMD"
		case strings.Contains(dl, "intel"):
			vendor = "Intel"
		}
		out = append(out, GPUInfo{PCIAddress: addr, Vendor: vendor, Model: strings.TrimSpace(desc)})
	}
	return out
}

func parseDisks(lsblk string) []DiskInfo {
	var out []DiskInfo
	for _, line := range strings.Split(lsblk, "\n") {
		f := strings.Fields(line)
		if len(f) < 3 {
			continue
		}
		out = append(out, DiskInfo{
			Name:       f[0],
			SizeBytes:  int64(atoiSafe(f[1])),
			Rotational: f[2] == "1",
		})
	}
	return out
}

func parseNICs(c *SSHClient) []NICInfo {
	var out []NICInfo
	names := strings.Fields(c.RunQuiet("ls /sys/class/net 2>/dev/null"))
	for _, n := range names {
		if n == "lo" || strings.HasPrefix(n, "virbr") || strings.HasPrefix(n, "veth") {
			continue
		}
		mac := c.RunQuiet("cat /sys/class/net/" + n + "/address 2>/dev/null")
		speed := atoiSafe(c.RunQuiet("cat /sys/class/net/" + n + "/speed 2>/dev/null"))
		out = append(out, NICInfo{Name: n, MAC: mac, SpeedMb: speed})
	}
	return out
}

func atoiSafe(s string) int {
	s = strings.TrimSpace(s)
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}
