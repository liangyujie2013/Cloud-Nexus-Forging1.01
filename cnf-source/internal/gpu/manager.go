// Package gpu 负责 GPU 设备发现、监控采集与 mdev/vGPU 管理。
// 发现走 sysfs/lspci，NVIDIA 监控走 nvidia-smi，vGPU 走 mediated devices(mdev)。
package gpu

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/cnf/cnfv1/internal/model"
)

// Manager GPU 管理器。
type Manager struct{}

func NewManager() *Manager { return &Manager{} }

// 已知 GPU 厂商 PCI Vendor ID。
var gpuVendors = map[string]string{
	"10de": "NVIDIA",
	"1002": "AMD",
	"8086": "Intel",
}

// DiscoverGPUs 通过 sysfs 扫描 PCI 设备，发现 GPU（class 0x0300 显示控制器）。
func (m *Manager) DiscoverGPUs() ([]model.GPUDevice, error) {
	const pciPath = "/sys/bus/pci/devices"
	entries, err := os.ReadDir(pciPath)
	if err != nil {
		return nil, fmt.Errorf("读取 %s 失败: %w", pciPath, err)
	}

	var gpus []model.GPUDevice
	for _, e := range entries {
		dev := filepath.Join(pciPath, e.Name())

		class := readSysfs(filepath.Join(dev, "class"))
		// 0x0300xx = VGA, 0x0302xx = 3D controller
		if !strings.HasPrefix(class, "0x0300") && !strings.HasPrefix(class, "0x0302") {
			continue
		}

		vendorID := strings.TrimPrefix(readSysfs(filepath.Join(dev, "vendor")), "0x")
		deviceID := strings.TrimPrefix(readSysfs(filepath.Join(dev, "device")), "0x")
		vendor := gpuVendors[vendorID]
		if vendor == "" {
			continue // 跳过非 GPU 显示设备
		}

		g := model.GPUDevice{
			PCIAddress: e.Name(), // 已是 0000:81:00.0 格式
			VendorID:   vendorID,
			DeviceID:   deviceID,
			Vendor:     vendor,
			Mode:       model.GPUPassthrough,
			Status:     "available",
			NUMANode:   readIntSysfs(filepath.Join(dev, "numa_node"), -1),
		}

		// IOMMU group（PCI 直通必需）
		if link, err := os.Readlink(filepath.Join(dev, "iommu_group")); err == nil {
			if grp, err := strconv.Atoi(filepath.Base(link)); err == nil {
				g.IOMMUGroup = grp
			}
		}

		gpus = append(gpus, g)
	}

	// 用 nvidia-smi 补全型号/显存
	m.enrichNVIDIA(gpus)
	return gpus, nil
}

// GPUMetric GPU 实时监控指标。
type GPUMetric struct {
	PCIAddress  string  `json:"pci_address"`
	Index       int     `json:"index"`
	Utilization float64 `json:"utilization"` // %
	MemoryUsed  int64   `json:"memory_used"` // MiB
	MemoryTotal int64   `json:"memory_total"`
	Temperature float64 `json:"temperature"` // °C
	PowerDraw   float64 `json:"power_draw"`  // W
	PowerLimit  float64 `json:"power_limit"`
	FanSpeed    float64 `json:"fan_speed"`
}

// CollectNVIDIAMetrics 调用 nvidia-smi 采集所有 NVIDIA GPU 指标。
func (m *Manager) CollectNVIDIAMetrics(ctx context.Context) ([]GPUMetric, error) {
	// 用 query 模式输出 CSV，便于解析
	query := "index,pci.bus_id,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed"
	cmd := exec.CommandContext(ctx, "nvidia-smi",
		"--query-gpu="+query, "--format=csv,noheader,nounits")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("nvidia-smi 执行失败（主机可能无 NVIDIA GPU 或驱动未装）: %w", err)
	}

	var metrics []GPUMetric
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		fields := splitCSV(sc.Text())
		if len(fields) < 9 {
			continue
		}
		metrics = append(metrics, GPUMetric{
			Index:       atoi(fields[0]),
			PCIAddress:  normalizePCI(fields[1]),
			Utilization: atof(fields[2]),
			MemoryUsed:  int64(atof(fields[3])),
			MemoryTotal: int64(atof(fields[4])),
			Temperature: atof(fields[5]),
			PowerDraw:   atof(fields[6]),
			PowerLimit:  atof(fields[7]),
			FanSpeed:    atof(fields[8]),
		})
	}
	return metrics, nil
}

// enrichNVIDIA 用 nvidia-smi 补全型号与显存。
func (m *Manager) enrichNVIDIA(gpus []model.GPUDevice) {
	cmd := exec.Command("nvidia-smi",
		"--query-gpu=pci.bus_id,name,memory.total", "--format=csv,noheader,nounits")
	out, err := cmd.Output()
	if err != nil {
		return // 无 NVIDIA 驱动则跳过
	}
	info := map[string]struct {
		model string
		vram  int
	}{}
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		f := splitCSV(sc.Text())
		if len(f) < 3 {
			continue
		}
		info[normalizePCI(f[0])] = struct {
			model string
			vram  int
		}{f[1], atoi(f[2])}
	}
	for i := range gpus {
		if v, ok := info[strings.ToLower(gpus[i].PCIAddress)]; ok {
			gpus[i].Model = v.model
			gpus[i].VRAMMb = v.vram
		}
	}
}

// ============================================================================
// vGPU / mdev 管理
// ============================================================================

// ListMdevTypes 列出某 GPU 支持的 mdev(vGPU) 类型。
func (m *Manager) ListMdevTypes(pciAddress string) ([]string, error) {
	base := filepath.Join("/sys/bus/pci/devices", pciAddress, "mdev_supported_types")
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil, fmt.Errorf("该 GPU 不支持 mdev/vGPU 或驱动未启用: %w", err)
	}
	var types []string
	for _, e := range entries {
		name := readSysfs(filepath.Join(base, e.Name(), "name"))
		types = append(types, fmt.Sprintf("%s (%s)", e.Name(), strings.TrimSpace(name)))
	}
	return types, nil
}

// CreateMdev 在指定 GPU 上创建一个 vGPU 实例，返回 mdev UUID。
func (m *Manager) CreateMdev(pciAddress, mdevType, mdevUUID string) error {
	createPath := filepath.Join("/sys/bus/pci/devices", pciAddress,
		"mdev_supported_types", mdevType, "create")
	return os.WriteFile(createPath, []byte(mdevUUID), 0o644)
}

// RemoveMdev 移除 vGPU 实例。
func (m *Manager) RemoveMdev(mdevUUID string) error {
	removePath := filepath.Join("/sys/bus/mdev/devices", mdevUUID, "remove")
	return os.WriteFile(removePath, []byte("1"), 0o644)
}

// ============================================================================
// 工具函数
// ============================================================================

func readSysfs(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func readIntSysfs(path string, def int) int {
	v := readSysfs(path)
	if v == "" {
		return def
	}
	if n, err := strconv.Atoi(v); err == nil {
		return n
	}
	return def
}

// normalizePCI 将 nvidia-smi 的 00000000:81:00.0 归一化为 0000:81:00.0。
func normalizePCI(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	parts := strings.SplitN(s, ":", 2)
	if len(parts) == 2 && len(parts[0]) > 4 {
		parts[0] = parts[0][len(parts[0])-4:]
		return parts[0] + ":" + parts[1]
	}
	return s
}

func splitCSV(line string) []string {
	parts := strings.Split(line, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

func atoi(s string) int { n, _ := strconv.Atoi(strings.TrimSpace(s)); return n }
func atof(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "[N/A]" || s == "[Not Supported]" {
		return 0
	}
	f, _ := strconv.ParseFloat(s, 64)
	return f
}
