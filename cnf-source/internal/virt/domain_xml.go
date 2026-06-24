// Package virt 负责把 CNF 领域模型翻译为 libvirt domain XML。
// 这是平台的核心差异化能力：完整支持 CPU 拓扑、CPU 绑核(cputune)、
// NUMA 亲和(numatune)、大页内存、GPU PCI 直通 / vGPU(mdev)。
package virt

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/cnf/cnfv1/internal/model"
)

// DomainXMLBuilder 增量构建 libvirt domain XML。
// 也可直接使用 libvirt.org/go/libvirtxml 的结构体，这里手写以保证字段可控、可读。
type DomainXMLBuilder struct {
	vm           *model.VM
	gpus         []model.GPUDevice
	osLoader     string // OVMF_CODE.fd 路径（UEFI）
	osNVRAMTpl   string // OVMF_VARS.fd 模板路径
	emulatorPath string
}

// NewDomainXMLBuilder 创建构建器。
func NewDomainXMLBuilder(vm *model.VM) *DomainXMLBuilder {
	return &DomainXMLBuilder{
		vm:           vm,
		gpus:         vm.GPUs,
		osLoader:     "/usr/share/edk2/ovmf/OVMF_CODE.secboot.fd",
		osNVRAMTpl:   "/usr/share/edk2/ovmf/OVMF_VARS.fd",
		emulatorPath: "/usr/libexec/qemu-kvm",
	}
}

// Build 生成完整的 libvirt domain XML 字符串。
func (b *DomainXMLBuilder) Build() (string, error) {
	vm := b.vm
	cpu := vm.CPUConfig()
	if cpu.VCPUs() == 0 {
		return "", fmt.Errorf("invalid CPU topology: sockets/cores/threads must be > 0")
	}

	var sb strings.Builder
	sb.WriteString(`<domain type='kvm'>` + "\n")
	sb.WriteString(fmt.Sprintf("  <name>%s</name>\n", xmlEscape(vm.Name)))
	if vm.LibvirtUUID != nil {
		sb.WriteString(fmt.Sprintf("  <uuid>%s</uuid>\n", vm.LibvirtUUID.String()))
	}
	if vm.Description != "" {
		sb.WriteString(fmt.Sprintf("  <description>%s</description>\n", xmlEscape(vm.Description)))
	}

	// ---- 内存 ----
	sb.WriteString(fmt.Sprintf("  <memory unit='MiB'>%d</memory>\n", vm.MemoryMB))
	sb.WriteString(fmt.Sprintf("  <currentMemory unit='MiB'>%d</currentMemory>\n", vm.MemoryMB))
	if vm.MemoryMaxMB > vm.MemoryMB {
		// 内存热插槽
		sb.WriteString(fmt.Sprintf("  <maxMemory slots='16' unit='MiB'>%d</maxMemory>\n", vm.MemoryMaxMB))
	}
	if vm.HugepagesEnabled {
		sb.WriteString("  <memoryBacking>\n    <hugepages/>\n    <nosharepages/>\n  </memoryBacking>\n")
	}

	// ---- vCPU 与绑核 ----
	b.writeVCPU(&sb, cpu)
	b.writeCPUTune(&sb, cpu)
	b.writeNUMATune(&sb, cpu)

	// ---- OS / 引导 ----
	b.writeOS(&sb)

	// ---- features ----
	sb.WriteString("  <features>\n    <acpi/>\n    <apic/>\n")
	if vm.BootMode == model.BootUEFISecure {
		sb.WriteString("    <smm state='on'/>\n")
	}
	sb.WriteString("  </features>\n")

	// ---- CPU 拓扑 + guest NUMA ----
	b.writeCPU(&sb, cpu)

	// ---- 时钟 ----
	sb.WriteString("  <clock offset='utc'>\n")
	sb.WriteString("    <timer name='rtc' tickpolicy='catchup'/>\n")
	sb.WriteString("    <timer name='pit' tickpolicy='delay'/>\n")
	sb.WriteString("    <timer name='hpet' present='no'/>\n")
	sb.WriteString("  </clock>\n")

	sb.WriteString("  <on_poweroff>destroy</on_poweroff>\n")
	sb.WriteString("  <on_reboot>restart</on_reboot>\n")
	sb.WriteString("  <on_crash>restart</on_crash>\n")

	// ---- devices ----
	sb.WriteString("  <devices>\n")
	sb.WriteString(fmt.Sprintf("    <emulator>%s</emulator>\n", b.emulatorPath))
	b.writeDisks(&sb)
	b.writeNICs(&sb)
	b.writeGPUs(&sb)
	b.writeConsole(&sb)
	// virtio balloon
	if vm.MemoryBalloon {
		sb.WriteString("    <memballoon model='virtio'/>\n")
	}
	// guest agent channel
	sb.WriteString("    <channel type='unix'>\n")
	sb.WriteString("      <target type='virtio' name='org.qemu.guest_agent.0'/>\n")
	sb.WriteString("    </channel>\n")
	sb.WriteString("  </devices>\n")

	sb.WriteString("</domain>\n")
	return sb.String(), nil
}

// writeVCPU 写入 <vcpu>，绑核时使用 placement='static'。
func (b *DomainXMLBuilder) writeVCPU(sb *strings.Builder, cpu model.VMCPUConfig) {
	placement := "static"
	vcpus := cpu.VCPUs()
	if cpu.CPUPinning && len(cpu.PinnedCPUs) > 0 {
		cpuset := intsToCPUSet(cpu.PinnedCPUs)
		sb.WriteString(fmt.Sprintf("  <vcpu placement='%s' cpuset='%s'>%d</vcpu>\n", placement, cpuset, vcpus))
	} else {
		sb.WriteString(fmt.Sprintf("  <vcpu placement='%s'>%d</vcpu>\n", placement, vcpus))
	}
}

// writeCPUTune 写入 <cputune>：精确的 vCPU→pCPU 绑定 + 权重 + 配额。
func (b *DomainXMLBuilder) writeCPUTune(sb *strings.Builder, cpu model.VMCPUConfig) {
	if !cpu.CPUPinning && cpu.Shares == 0 && cpu.Quota == 0 {
		return
	}
	sb.WriteString("  <cputune>\n")
	if cpu.CPUPinning {
		// 优先使用精确映射
		if len(cpu.PinnedMap) > 0 {
			for _, p := range cpu.PinnedMap {
				sb.WriteString(fmt.Sprintf("    <vcpupin vcpu='%d' cpuset='%d'/>\n", p.VCPU, p.PCPU))
			}
		} else if len(cpu.PinnedCPUs) > 0 {
			// 顺序映射 vcpu i → pinnedCPUs[i]
			for i := 0; i < cpu.VCPUs() && i < len(cpu.PinnedCPUs); i++ {
				sb.WriteString(fmt.Sprintf("    <vcpupin vcpu='%d' cpuset='%d'/>\n", i, cpu.PinnedCPUs[i]))
			}
		}
	}
	if cpu.Shares > 0 {
		sb.WriteString(fmt.Sprintf("    <shares>%d</shares>\n", cpu.Shares))
	}
	if cpu.Quota > 0 {
		sb.WriteString(fmt.Sprintf("    <quota>%d</quota>\n", cpu.Quota))
		sb.WriteString("    <period>100000</period>\n")
	}
	sb.WriteString("  </cputune>\n")
}

// writeNUMATune 写入 <numatune>：NUMA 节点亲和（内存与 CPU 同节点，避免跨 NUMA 访问）。
func (b *DomainXMLBuilder) writeNUMATune(sb *strings.Builder, cpu model.VMCPUConfig) {
	if cpu.NUMANodeAffinity < 0 {
		return
	}
	sb.WriteString("  <numatune>\n")
	sb.WriteString(fmt.Sprintf("    <memory mode='strict' nodeset='%d'/>\n", cpu.NUMANodeAffinity))
	sb.WriteString("  </numatune>\n")
}

// writeCPU 写入 <cpu>：CPU 模型 + 拓扑 + guest NUMA 拓扑。
func (b *DomainXMLBuilder) writeCPU(sb *strings.Builder, cpu model.VMCPUConfig) {
	mode := "host-passthrough"
	switch cpu.Model {
	case "", "host-passthrough":
		mode = "host-passthrough"
	case "host-model":
		mode = "host-model"
	default:
		mode = "custom"
	}

	if mode == "custom" {
		sb.WriteString("  <cpu mode='custom' match='exact' check='partial'>\n")
		sb.WriteString(fmt.Sprintf("    <model fallback='allow'>%s</model>\n", xmlEscape(cpu.Model)))
	} else {
		sb.WriteString(fmt.Sprintf("  <cpu mode='%s' check='none'>\n", mode))
	}
	sb.WriteString(fmt.Sprintf("    <topology sockets='%d' cores='%d' threads='%d'/>\n",
		cpu.Sockets, cpu.CoresPerSocket, cpu.ThreadsPerCore))

	// guest NUMA 拓扑（暴露给虚拟机内部 OS）
	if len(b.vm.NUMATopology) > 0 {
		sb.WriteString("    <numa>\n")
		for _, n := range b.vm.NUMATopology {
			sb.WriteString(fmt.Sprintf("      <cell id='%d' cpus='%s' memory='%d' unit='MiB'/>\n",
				n.Node, intsToCPUSet(n.CPUs), n.MemoryMB))
		}
		sb.WriteString("    </numa>\n")
	}
	sb.WriteString("  </cpu>\n")
}

// writeOS 写入 <os>：BIOS / UEFI(OVMF) + 引导顺序。
func (b *DomainXMLBuilder) writeOS(sb *strings.Builder) {
	vm := b.vm
	machine := vm.MachineType
	if machine == "" {
		machine = "q35"
	}
	sb.WriteString("  <os>\n")
	sb.WriteString(fmt.Sprintf("    <type arch='%s' machine='%s'>hvm</type>\n", orDefault(vm.Arch, "x86_64"), machine))

	if vm.BootMode == model.BootUEFI || vm.BootMode == model.BootUEFISecure {
		secure := "no"
		if vm.BootMode == model.BootUEFISecure {
			secure = "yes"
		}
		sb.WriteString(fmt.Sprintf("    <loader readonly='yes' secure='%s' type='pflash'>%s</loader>\n", secure, b.osLoader))
		nvram := vm.NVRAMPath
		if nvram == "" {
			nvram = fmt.Sprintf("/var/lib/libvirt/qemu/nvram/%s_VARS.fd", vm.Name)
		}
		sb.WriteString(fmt.Sprintf("    <nvram template='%s'>%s</nvram>\n", b.osNVRAMTpl, nvram))
	}

	for _, dev := range vm.BootOrder {
		sb.WriteString(fmt.Sprintf("    <boot dev='%s'/>\n", dev))
	}
	sb.WriteString("  </os>\n")
}

// writeDisks 写入磁盘设备，含 QoS(iotune) 与链式克隆 backingStore。
func (b *DomainXMLBuilder) writeDisks(sb *strings.Builder) {
	for _, d := range b.vm.Disks {
		sb.WriteString(fmt.Sprintf("    <disk type='file' device='disk'>\n"))
		sb.WriteString(fmt.Sprintf("      <driver name='qemu' type='%s' cache='none' io='native' discard='unmap'/>\n", orDefault(d.Format, "qcow2")))
		sb.WriteString(fmt.Sprintf("      <source file='%s'/>\n", xmlEscape(d.Path)))
		if d.BackingFile != "" {
			sb.WriteString("      <backingStore type='file'>\n")
			sb.WriteString("        <format type='qcow2'/>\n")
			sb.WriteString(fmt.Sprintf("        <source file='%s'/>\n", xmlEscape(d.BackingFile)))
			sb.WriteString("      </backingStore>\n")
		}
		sb.WriteString(fmt.Sprintf("      <target dev='%s' bus='%s'/>\n", d.Device, orDefault(d.Bus, "virtio")))
		if d.ReadOnly {
			sb.WriteString("      <readonly/>\n")
		}
		if d.BootOrder != nil {
			sb.WriteString(fmt.Sprintf("      <boot order='%d'/>\n", *d.BootOrder))
		}
		if d.IOPSLimit > 0 || d.BPSLimit > 0 {
			sb.WriteString("      <iotune>\n")
			if d.IOPSLimit > 0 {
				sb.WriteString(fmt.Sprintf("        <total_iops_sec>%d</total_iops_sec>\n", d.IOPSLimit))
			}
			if d.BPSLimit > 0 {
				sb.WriteString(fmt.Sprintf("        <total_bytes_sec>%d</total_bytes_sec>\n", d.BPSLimit))
			}
			sb.WriteString("      </iotune>\n")
		}
		sb.WriteString("    </disk>\n")
	}
}

// writeNICs 写入网卡，支持 OVS/Bridge、VLAN、带宽 QoS。
func (b *DomainXMLBuilder) writeNICs(sb *strings.Builder) {
	for _, n := range b.vm.NICs {
		bridge := orDefault(n.BridgeName, "br0")
		sb.WriteString("    <interface type='bridge'>\n")
		sb.WriteString(fmt.Sprintf("      <mac address='%s'/>\n", n.MACAddress))
		sb.WriteString(fmt.Sprintf("      <source bridge='%s'/>\n", bridge))
		// OVS 虚拟交换机
		sb.WriteString("      <virtualport type='openvswitch'/>\n")
		if n.VLANID > 0 {
			sb.WriteString("      <vlan>\n")
			sb.WriteString(fmt.Sprintf("        <tag id='%d'/>\n", n.VLANID))
			sb.WriteString("      </vlan>\n")
		}
		sb.WriteString(fmt.Sprintf("      <model type='%s'/>\n", orDefault(n.Model, "virtio")))
		if n.InboundKbps > 0 || n.OutboundKbps > 0 {
			sb.WriteString("      <bandwidth>\n")
			if n.InboundKbps > 0 {
				sb.WriteString(fmt.Sprintf("        <inbound average='%d'/>\n", n.InboundKbps))
			}
			if n.OutboundKbps > 0 {
				sb.WriteString(fmt.Sprintf("        <outbound average='%d'/>\n", n.OutboundKbps))
			}
			sb.WriteString("      </bandwidth>\n")
		}
		sb.WriteString("    </interface>\n")
	}
}

// writeGPUs 写入 GPU：PCI 直通(hostdev type='pci') 或 vGPU(hostdev type='mdev')。
func (b *DomainXMLBuilder) writeGPUs(sb *strings.Builder) {
	for _, g := range b.gpus {
		switch g.Mode {
		case model.GPUVGPU, model.GPUMdev:
			if g.MdevUUID == nil {
				continue
			}
			sb.WriteString("    <hostdev mode='subsystem' type='mdev' managed='no' model='vfio-pci' display='off'>\n")
			sb.WriteString("      <source>\n")
			sb.WriteString(fmt.Sprintf("        <address uuid='%s'/>\n", g.MdevUUID.String()))
			sb.WriteString("      </source>\n")
			sb.WriteString("    </hostdev>\n")
		default: // passthrough
			dom, bus, slot, fn := parsePCIAddress(g.PCIAddress)
			sb.WriteString("    <hostdev mode='subsystem' type='pci' managed='yes'>\n")
			sb.WriteString("      <source>\n")
			sb.WriteString(fmt.Sprintf("        <address domain='0x%s' bus='0x%s' slot='0x%s' function='0x%s'/>\n", dom, bus, slot, fn))
			sb.WriteString("      </source>\n")
			sb.WriteString("    </hostdev>\n")
		}
	}
}

// writeConsole 写入 VNC + virtio-vga 显卡 + spice 可选。
func (b *DomainXMLBuilder) writeConsole(sb *strings.Builder) {
	port := b.vm.VNCPort
	portAttr := "autoport='yes'"
	if port > 0 {
		portAttr = fmt.Sprintf("port='%d' autoport='no'", port)
	}
	pwd := ""
	if b.vm.VNCPassword != "" {
		pwd = fmt.Sprintf(" passwd='%s'", xmlEscape(b.vm.VNCPassword))
	}
	sb.WriteString(fmt.Sprintf("    <graphics type='vnc' %s listen='0.0.0.0'%s/>\n", portAttr, pwd))
	// 若 GPU 直通则不需要模拟显卡，否则提供 virtio-vga
	if len(b.gpus) == 0 {
		sb.WriteString("    <video>\n      <model type='virtio' heads='1'/>\n    </video>\n")
	}
	sb.WriteString("    <console type='pty'/>\n")
}

// ============================================================================
// 工具函数
// ============================================================================

// intsToCPUSet 把 [0,1,2,4,5] 压缩为 "0-2,4-5" 形式的 cpuset 字符串。
func intsToCPUSet(cpus []int) string {
	if len(cpus) == 0 {
		return ""
	}
	// 简单去重排序
	seen := map[int]bool{}
	var sorted []int
	for _, c := range cpus {
		if !seen[c] {
			seen[c] = true
			sorted = append(sorted, c)
		}
	}
	// 冒泡足矣（CPU 数量有限）
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j] < sorted[i] {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	var parts []string
	start := sorted[0]
	prev := sorted[0]
	for i := 1; i <= len(sorted); i++ {
		if i < len(sorted) && sorted[i] == prev+1 {
			prev = sorted[i]
			continue
		}
		if start == prev {
			parts = append(parts, strconv.Itoa(start))
		} else {
			parts = append(parts, fmt.Sprintf("%d-%d", start, prev))
		}
		if i < len(sorted) {
			start = sorted[i]
			prev = sorted[i]
		}
	}
	return strings.Join(parts, ",")
}

// parsePCIAddress 解析 "0000:81:00.0" → (domain, bus, slot, function)。
func parsePCIAddress(addr string) (dom, bus, slot, fn string) {
	dom, bus, slot, fn = "0000", "00", "00", "0"
	parts := strings.Split(addr, ":")
	if len(parts) == 3 {
		dom = parts[0]
		bus = parts[1]
		sf := strings.Split(parts[2], ".")
		if len(sf) == 2 {
			slot = sf[0]
			fn = sf[1]
		}
	} else if len(parts) == 2 {
		bus = parts[0]
		sf := strings.Split(parts[1], ".")
		if len(sf) == 2 {
			slot = sf[0]
			fn = sf[1]
		}
	}
	return
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

func xmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "'", "&apos;", "\"", "&quot;")
	return r.Replace(s)
}
