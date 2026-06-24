// 路径B 原型：模拟数据 + TS 版 libvirt XML 生成器（复刻 Go 实现的核心逻辑）。
// 后端为 mock，但 XML 预览是真实可用的逻辑，用于演示配置 → libvirt domain 翻译。

export interface CPUPin { vcpu: number; pcpu: number }
export interface NUMANode { node: number; cpus: number[]; memory_mb: number }

export interface VMConfig {
  name: string
  description?: string
  cpu_sockets: number
  cpu_cores_per_socket: number
  cpu_threads_per_core: number
  cpu_model: string
  cpu_pinning: boolean
  cpu_pinned_map: CPUPin[]
  cpu_pinned_cpus: number[]
  numa_node_affinity: number
  memory_mb: number
  hugepages_enabled: boolean
  boot_mode: 'bios' | 'uefi' | 'uefi_secure'
  machine_type: string
  arch: string
  disks: { device: string; bus: string; format: string; path: string; size_gb: number; iops_limit?: number }[]
  nics: { mac: string; model: string; bridge: string; vlan?: number }[]
  gpus: { pci_address: string; mode: 'passthrough' | 'vgpu'; model?: string }[]
}

function intsToCPUSet(cpus: number[]): string {
  if (!cpus.length) return ''
  const sorted = [...new Set(cpus)].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0], prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] === prev + 1) { prev = sorted[i]; continue }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`)
    if (i < sorted.length) { start = sorted[i]; prev = sorted[i] }
  }
  return parts.join(',')
}

function parsePCI(addr: string) {
  const p = addr.split(':')
  let dom = '0000', bus = '00', slot = '00', fn = '0'
  if (p.length === 3) { dom = p[0]; bus = p[1]; const sf = p[2].split('.'); slot = sf[0]; fn = sf[1] ?? '0' }
  return { dom, bus, slot, fn }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 生成 libvirt domain XML（与 Go 版逻辑一致的 TS 实现）。 */
export function buildDomainXML(vm: VMConfig): string {
  const vcpus = vm.cpu_sockets * vm.cpu_cores_per_socket * vm.cpu_threads_per_core
  const L: string[] = []
  L.push(`<domain type='kvm'>`)
  L.push(`  <name>${esc(vm.name)}</name>`)
  if (vm.description) L.push(`  <description>${esc(vm.description)}</description>`)
  L.push(`  <memory unit='MiB'>${vm.memory_mb}</memory>`)
  L.push(`  <currentMemory unit='MiB'>${vm.memory_mb}</currentMemory>`)
  if (vm.hugepages_enabled) L.push(`  <memoryBacking>\n    <hugepages/>\n    <nosharepages/>\n  </memoryBacking>`)

  // vcpu
  if (vm.cpu_pinning && vm.cpu_pinned_cpus.length)
    L.push(`  <vcpu placement='static' cpuset='${intsToCPUSet(vm.cpu_pinned_cpus)}'>${vcpus}</vcpu>`)
  else
    L.push(`  <vcpu placement='static'>${vcpus}</vcpu>`)

  // cputune
  if (vm.cpu_pinning && (vm.cpu_pinned_map.length || vm.cpu_pinned_cpus.length)) {
    L.push(`  <cputune>`)
    if (vm.cpu_pinned_map.length)
      vm.cpu_pinned_map.forEach(p => L.push(`    <vcpupin vcpu='${p.vcpu}' cpuset='${p.pcpu}'/>`))
    else
      vm.cpu_pinned_cpus.slice(0, vcpus).forEach((pc, i) => L.push(`    <vcpupin vcpu='${i}' cpuset='${pc}'/>`))
    L.push(`  </cputune>`)
  }

  // numatune
  if (vm.numa_node_affinity >= 0) {
    L.push(`  <numatune>`)
    L.push(`    <memory mode='strict' nodeset='${vm.numa_node_affinity}'/>`)
    L.push(`  </numatune>`)
  }

  // os
  const machine = vm.machine_type || 'q35'
  L.push(`  <os>`)
  L.push(`    <type arch='${vm.arch || 'x86_64'}' machine='${machine}'>hvm</type>`)
  if (vm.boot_mode === 'uefi' || vm.boot_mode === 'uefi_secure') {
    const secure = vm.boot_mode === 'uefi_secure' ? 'yes' : 'no'
    L.push(`    <loader readonly='yes' secure='${secure}' type='pflash'>/usr/share/edk2/ovmf/OVMF_CODE.secboot.fd</loader>`)
    L.push(`    <nvram template='/usr/share/edk2/ovmf/OVMF_VARS.fd'>/var/lib/libvirt/qemu/nvram/${vm.name}_VARS.fd</nvram>`)
  }
  L.push(`    <boot dev='hd'/>`)
  L.push(`  </os>`)

  L.push(`  <features>\n    <acpi/>\n    <apic/>${vm.boot_mode === 'uefi_secure' ? '\n    <smm state=\'on\'/>' : ''}\n  </features>`)

  // cpu topology
  const mode = vm.cpu_model === 'host-model' ? 'host-model'
    : (!vm.cpu_model || vm.cpu_model === 'host-passthrough') ? 'host-passthrough' : 'custom'
  if (mode === 'custom') {
    L.push(`  <cpu mode='custom' match='exact' check='partial'>`)
    L.push(`    <model fallback='allow'>${esc(vm.cpu_model)}</model>`)
  } else {
    L.push(`  <cpu mode='${mode}' check='none'>`)
  }
  L.push(`    <topology sockets='${vm.cpu_sockets}' cores='${vm.cpu_cores_per_socket}' threads='${vm.cpu_threads_per_core}'/>`)
  L.push(`  </cpu>`)

  L.push(`  <clock offset='utc'>\n    <timer name='rtc' tickpolicy='catchup'/>\n  </clock>`)
  L.push(`  <on_poweroff>destroy</on_poweroff>\n  <on_reboot>restart</on_reboot>\n  <on_crash>restart</on_crash>`)

  // devices
  L.push(`  <devices>`)
  L.push(`    <emulator>/usr/libexec/qemu-kvm</emulator>`)
  vm.disks.forEach(d => {
    L.push(`    <disk type='file' device='disk'>`)
    L.push(`      <driver name='qemu' type='${d.format || 'qcow2'}' cache='none' io='native' discard='unmap'/>`)
    L.push(`      <source file='${esc(d.path)}'/>`)
    L.push(`      <target dev='${d.device}' bus='${d.bus || 'virtio'}'/>`)
    if (d.iops_limit && d.iops_limit > 0)
      L.push(`      <iotune>\n        <total_iops_sec>${d.iops_limit}</total_iops_sec>\n      </iotune>`)
    L.push(`    </disk>`)
  })
  vm.nics.forEach(n => {
    L.push(`    <interface type='bridge'>`)
    L.push(`      <mac address='${n.mac}'/>`)
    L.push(`      <source bridge='${n.bridge || 'ovsbr0'}'/>`)
    L.push(`      <virtualport type='openvswitch'/>`)
    if (n.vlan && n.vlan > 0) L.push(`      <vlan>\n        <tag id='${n.vlan}'/>\n      </vlan>`)
    L.push(`      <model type='${n.model || 'virtio'}'/>`)
    L.push(`    </interface>`)
  })
  vm.gpus.forEach(g => {
    if (g.mode === 'vgpu') {
      L.push(`    <hostdev mode='subsystem' type='mdev' managed='no' model='vfio-pci' display='off'>`)
      L.push(`      <source>\n        <address uuid='AUTO-GENERATED-MDEV-UUID'/>\n      </source>`)
      L.push(`    </hostdev>`)
    } else {
      const { dom, bus, slot, fn } = parsePCI(g.pci_address)
      L.push(`    <hostdev mode='subsystem' type='pci' managed='yes'>`)
      L.push(`      <source>\n        <address domain='0x${dom}' bus='0x${bus}' slot='0x${slot}' function='0x${fn}'/>\n      </source>`)
      L.push(`    </hostdev>`)
    }
  })
  if (!vm.gpus.length) L.push(`    <video>\n      <model type='virtio' heads='1'/>\n    </video>`)
  L.push(`    <graphics type='vnc' autoport='yes' listen='0.0.0.0'/>`)
  L.push(`    <channel type='unix'>\n      <target type='virtio' name='org.qemu.guest_agent.0'/>\n    </channel>`)
  L.push(`    <memballoon model='virtio'/>`)
  L.push(`  </devices>`)
  L.push(`</domain>`)
  return L.join('\n')
}
