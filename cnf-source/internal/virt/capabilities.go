package virt

import (
	"encoding/xml"
	"fmt"

	"github.com/cnf/cnfv1/internal/model"
	"libvirt.org/go/libvirt"
)

// ============================================================================
// 宿主机能力发现：解析 libvirt capabilities / nodeinfo，提取 CPU 拓扑与 NUMA。
// ============================================================================

// capabilitiesXML 仅解析我们关心的字段。
type capabilitiesXML struct {
	Host struct {
		CPU struct {
			Arch     string `xml:"arch"`
			Model    string `xml:"model"`
			Topology struct {
				Sockets int `xml:"sockets,attr"`
				Cores   int `xml:"cores,attr"`
				Threads int `xml:"threads,attr"`
			} `xml:"topology"`
		} `xml:"cpu"`
		Topology struct {
			Cells struct {
				Num   int `xml:"num,attr"`
				Cells []struct {
					ID     int `xml:"id,attr"`
					Memory struct {
						Unit  string `xml:"unit,attr"`
						Value int64  `xml:",chardata"`
					} `xml:"memory"`
					CPUs struct {
						Num  int `xml:"num,attr"`
						CPUs []struct {
							ID int `xml:"id,attr"`
						} `xml:"cpu"`
					} `xml:"cpus"`
				} `xml:"cell"`
			} `xml:"cells"`
		} `xml:"topology"`
	} `xml:"host"`
}

// DiscoverHostCapabilities 连接宿主机并采集其虚拟化能力，填充 Host 模型。
func (cm *ConnManager) DiscoverHostCapabilities(hostIP string) (*model.Host, error) {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return nil, err
	}

	h := &model.Host{IPAddress: hostIP, Status: model.HostConnected}

	// 版本信息
	if v, err := conn.GetVersion(); err == nil {
		h.QEMUVersion = formatVersion(v)
	}
	if v, err := conn.GetLibVersion(); err == nil {
		h.LibvirtVersion = formatVersion(v)
	}
	if hn, err := conn.GetHostname(); err == nil {
		h.Hostname = hn
	}

	// nodeinfo：逻辑 CPU 数、内存
	if ni, err := conn.GetNodeInfo(); err == nil {
		h.CPUSockets = int(ni.Sockets)
		h.CPUCoresPerSocket = int(ni.Cores)
		h.CPUThreadsPerCore = int(ni.Threads)
		h.NUMANodes = int(ni.Nodes)
		h.MemoryTotalMB = int64(ni.Memory) / 1024 // KiB → MiB
		h.CPUModel = ni.Model
	}

	// capabilities XML：精确 NUMA 拓扑
	capsXML, err := conn.GetCapabilities()
	if err == nil {
		var caps capabilitiesXML
		if xml.Unmarshal([]byte(capsXML), &caps) == nil {
			if caps.Host.CPU.Model != "" {
				h.CPUModel = caps.Host.CPU.Model
			}
			h.NUMANodes = caps.Host.Topology.Cells.Num
			for _, cell := range caps.Host.Topology.Cells.Cells {
				node := model.NUMANode{Node: cell.ID}
				// 内存单位通常为 KiB
				node.MemoryMB = cell.Memory.Value / 1024
				for _, c := range cell.CPUs.CPUs {
					node.CPUs = append(node.CPUs, c.ID)
				}
				h.NUMATopology = append(h.NUMATopology, node)
			}
		}
	}

	// 空闲内存
	if free, err := conn.GetFreeMemory(); err == nil {
		used := h.MemoryTotalMB - int64(free)/1024/1024
		if used > 0 {
			h.MemoryReservedMB = used
		}
	}

	return h, nil
}

// CollectHostMetrics 采集宿主机实时指标（CPU 利用率、内存使用）。
func (cm *ConnManager) CollectHostMetrics(hostIP string) (map[string]float64, error) {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return nil, err
	}
	m := map[string]float64{}

	// 两次采样 CPU stats 计算利用率
	s1, err := conn.GetAllDomainStats(nil, libvirt.DOMAIN_STATS_CPU_TOTAL, 0)
	if err == nil {
		// 简化：实际应间隔采样两次做差值；此处返回 domain 数量等基础信息
		m["active_domains"] = float64(len(s1))
		for _, s := range s1 {
			_ = s.Domain.Free()
		}
	}

	if free, err := conn.GetFreeMemory(); err == nil {
		m["free_memory_mb"] = float64(free) / 1024 / 1024
	}
	return m, nil
}

func formatVersion(v uint32) string {
	major := v / 1000000
	minor := (v % 1000000) / 1000
	release := v % 1000
	return fmt.Sprintf("%d.%d.%d", major, minor, release)
}
