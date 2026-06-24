package virt

import (
	"fmt"
	"time"

	"libvirt.org/go/libvirt"
)

// ============================================================================
// Domain 底层操作封装：define/start/stop/migrate/snapshot 直接对接 libvirt。
// service 层调用这些方法，不直接接触 libvirt API。
// ============================================================================

// DomainState 归一化的 domain 状态。
type DomainState string

const (
	DomainRunning  DomainState = "running"
	DomainPaused   DomainState = "paused"
	DomainShutoff  DomainState = "shutoff"
	DomainCrashed  DomainState = "crashed"
	DomainShutdown DomainState = "shutdown"
	DomainUnknown  DomainState = "unknown"
)

// DefineDomain 定义（持久化）一个 domain，但不启动。返回 domain UUID。
func (cm *ConnManager) DefineDomain(hostIP, domainXML string) (string, error) {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return "", err
	}
	dom, err := conn.DomainDefineXML(domainXML)
	if err != nil {
		return "", fmt.Errorf("define domain 失败: %w", err)
	}
	defer dom.Free()
	uuid, err := dom.GetUUIDString()
	if err != nil {
		return "", err
	}
	return uuid, nil
}

// StartDomain 启动 domain。
func (cm *ConnManager) StartDomain(hostIP, name string) error {
	return cm.withDomain(hostIP, name, func(d *libvirt.Domain) error {
		return d.Create()
	})
}

// ShutdownDomain 优雅关机（发送 ACPI），超时后调用方可强制 destroy。
func (cm *ConnManager) ShutdownDomain(hostIP, name string) error {
	return cm.withDomain(hostIP, name, func(d *libvirt.Domain) error {
		return d.Shutdown()
	})
}

// DestroyDomain 强制断电。
func (cm *ConnManager) DestroyDomain(hostIP, name string) error {
	return cm.withDomain(hostIP, name, func(d *libvirt.Domain) error {
		return d.Destroy()
	})
}

// SuspendDomain 暂停（冻结 CPU）。
func (cm *ConnManager) SuspendDomain(hostIP, name string) error {
	return cm.withDomain(hostIP, name, func(d *libvirt.Domain) error {
		return d.Suspend()
	})
}

// ResumeDomain 恢复。
func (cm *ConnManager) ResumeDomain(hostIP, name string) error {
	return cm.withDomain(hostIP, name, func(d *libvirt.Domain) error {
		return d.Resume()
	})
}

// UndefineDomain 删除 domain 定义（含 NVRAM）。
func (cm *ConnManager) UndefineDomain(hostIP, name string) error {
	return cm.withDomain(hostIP, name, func(d *libvirt.Domain) error {
		return d.UndefineFlags(libvirt.DOMAIN_UNDEFINE_NVRAM |
			libvirt.DOMAIN_UNDEFINE_SNAPSHOTS_METADATA)
	})
}

// GetDomainState 查询 domain 状态。
func (cm *ConnManager) GetDomainState(hostIP, name string) (DomainState, error) {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return DomainUnknown, err
	}
	dom, err := conn.LookupDomainByName(name)
	if err != nil {
		return DomainUnknown, err
	}
	defer dom.Free()
	state, _, err := dom.GetState()
	if err != nil {
		return DomainUnknown, err
	}
	return mapState(state), nil
}

// WaitForState 轮询等待 domain 进入目标状态（用于关机确认）。
func (cm *ConnManager) WaitForState(hostIP, name string, target DomainState, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		s, err := cm.GetDomainState(hostIP, name)
		if err == nil && s == target {
			return nil
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("等待 domain %s 进入 %s 状态超时", name, target)
}

// GetDomainXML 导出 domain 当前 XML（迁移/快照前使用）。
func (cm *ConnManager) GetDomainXML(hostIP, name string) (string, error) {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return "", err
	}
	dom, err := conn.LookupDomainByName(name)
	if err != nil {
		return "", err
	}
	defer dom.Free()
	return dom.GetXMLDesc(0)
}

// withDomain 查找 domain 并执行操作的辅助方法。
func (cm *ConnManager) withDomain(hostIP, name string, fn func(*libvirt.Domain) error) error {
	conn, err := cm.Get(hostIP)
	if err != nil {
		return err
	}
	dom, err := conn.LookupDomainByName(name)
	if err != nil {
		return fmt.Errorf("找不到 domain %s: %w", name, err)
	}
	defer dom.Free()
	return fn(dom)
}

func mapState(s libvirt.DomainState) DomainState {
	switch s {
	case libvirt.DOMAIN_RUNNING:
		return DomainRunning
	case libvirt.DOMAIN_PAUSED:
		return DomainPaused
	case libvirt.DOMAIN_SHUTOFF:
		return DomainShutoff
	case libvirt.DOMAIN_CRASHED:
		return DomainCrashed
	case libvirt.DOMAIN_SHUTDOWN:
		return DomainShutdown
	default:
		return DomainUnknown
	}
}
