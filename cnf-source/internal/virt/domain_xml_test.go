package virt

import (
	"strings"
	"testing"

	"github.com/cnf/cnfv1/internal/model"
	"github.com/google/uuid"
)

// newTestVM 构造一个含高级 CPU/NUMA/GPU 配置的 VM。
func newTestVM() *model.VM {
	lu := uuid.New()
	bo := 1
	return &model.VM{
		Name:              "test-vm",
		LibvirtUUID:       &lu,
		CPUSockets:        2,
		CPUCoresPerSocket: 4,
		CPUThreadsPerCore: 2, // 总 16 vCPU
		CPUModel:          "host-passthrough",
		CPUPinning:        true,
		CPUPinnedMap: []model.CPUPin{
			{VCPU: 0, PCPU: 8}, {VCPU: 1, PCPU: 9},
		},
		CPUPinnedCPUs:    []int{8, 9, 10, 11},
		NUMANodeAffinity: 1,
		MemoryMB:         16384,
		HugepagesEnabled: true,
		MemoryBalloon:    true,
		Arch:             "x86_64",
		MachineType:      "q35",
		BootMode:         model.BootUEFI,
		BootOrder:        []string{"hd"},
		Disks: []model.VMDisk{
			{Device: "vda", Bus: "virtio", Format: "qcow2",
				Path: "/data/test.qcow2", IOPSLimit: 5000, BootOrder: &bo},
		},
		NICs: []model.VMNic{
			{MACAddress: "52:54:00:12:34:56", Model: "virtio", BridgeName: "ovsbr0", VLANID: 100},
		},
		GPUs: []model.GPUDevice{
			{PCIAddress: "0000:81:00.0", Mode: model.GPUPassthrough},
		},
	}
}

func TestBuild_BasicStructure(t *testing.T) {
	xml, err := NewDomainXMLBuilder(newTestVM()).Build()
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	for _, want := range []string{
		"<domain type='kvm'>", "<name>test-vm</name>",
		"<memory unit='MiB'>16384</memory>",
		"<vcpu placement='static'", "16</vcpu>",
	} {
		if !strings.Contains(xml, want) {
			t.Errorf("XML 缺少 %q\n%s", want, xml)
		}
	}
}

func TestBuild_CPUTopologyAndPinning(t *testing.T) {
	xml, _ := NewDomainXMLBuilder(newTestVM()).Build()
	if !strings.Contains(xml, "<topology sockets='2' cores='4' threads='2'/>") {
		t.Error("CPU 拓扑不正确")
	}
	if !strings.Contains(xml, "<vcpupin vcpu='0' cpuset='8'/>") {
		t.Error("CPU 绑核映射缺失")
	}
	if !strings.Contains(xml, "<cputune>") {
		t.Error("缺少 cputune 段")
	}
}

func TestBuild_NUMAAffinity(t *testing.T) {
	xml, _ := NewDomainXMLBuilder(newTestVM()).Build()
	if !strings.Contains(xml, "<numatune>") ||
		!strings.Contains(xml, "nodeset='1'") {
		t.Errorf("NUMA 亲和配置缺失\n%s", xml)
	}
}

func TestBuild_GPUPassthrough(t *testing.T) {
	xml, _ := NewDomainXMLBuilder(newTestVM()).Build()
	if !strings.Contains(xml, "<hostdev mode='subsystem' type='pci' managed='yes'>") {
		t.Error("GPU PCI 直通 hostdev 缺失")
	}
	if !strings.Contains(xml, "bus='0x81'") || !strings.Contains(xml, "slot='0x00'") {
		t.Errorf("PCI 地址解析错误\n%s", xml)
	}
}

func TestBuild_UEFIBoot(t *testing.T) {
	xml, _ := NewDomainXMLBuilder(newTestVM()).Build()
	if !strings.Contains(xml, "<loader readonly='yes'") ||
		!strings.Contains(xml, "pflash") {
		t.Error("UEFI loader 配置缺失")
	}
}

func TestBuild_Hugepages(t *testing.T) {
	xml, _ := NewDomainXMLBuilder(newTestVM()).Build()
	if !strings.Contains(xml, "<hugepages/>") {
		t.Error("大页内存配置缺失")
	}
}

func TestIntsToCPUSet(t *testing.T) {
	cases := map[string][]int{
		"0-2,4-5": {0, 1, 2, 4, 5},
		"8":       {8},
		"0-3":     {3, 2, 1, 0}, // 乱序应排序合并
	}
	for want, in := range cases {
		if got := intsToCPUSet(in); got != want {
			t.Errorf("intsToCPUSet(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestParsePCIAddress(t *testing.T) {
	dom, bus, slot, fn := parsePCIAddress("0000:81:00.0")
	if dom != "0000" || bus != "81" || slot != "00" || fn != "0" {
		t.Errorf("解析错误: %s %s %s %s", dom, bus, slot, fn)
	}
}

func TestBuild_InvalidCPU(t *testing.T) {
	vm := newTestVM()
	vm.CPUSockets = 0
	if _, err := NewDomainXMLBuilder(vm).Build(); err == nil {
		t.Error("非法 CPU 拓扑应报错")
	}
}
