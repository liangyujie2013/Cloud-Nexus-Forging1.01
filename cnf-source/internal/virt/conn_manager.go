// Package virt 的 libvirt 连接管理器。
// 维护到各宿主机 libvirtd 的连接池，提供能力发现与 domain 操作的统一入口。
//
// 编译要求：依赖 libvirt-go(CGO)，必须在装有 libvirt-devel 的
// Rocky Linux 9 上编译：dnf install -y libvirt-devel gcc
package virt

import (
	"fmt"
	"sync"
	"time"

	"libvirt.org/go/libvirt"
)

// ConnManager 管理到多台宿主机的 libvirt 连接（线程安全连接池）。
type ConnManager struct {
	mu    sync.RWMutex
	conns map[string]*pooledConn // key: 宿主机 URI
}

type pooledConn struct {
	conn     *libvirt.Connect
	uri      string
	lastUsed time.Time
}

// NewConnManager 创建连接管理器。
func NewConnManager() *ConnManager {
	cm := &ConnManager{conns: make(map[string]*pooledConn)}
	go cm.reaper() // 后台回收空闲连接
	return cm
}

// hostURI 构造 qemu+tcp 连接 URI。生产建议用 qemu+tls 并配置证书。
func hostURI(ip string) string {
	return fmt.Sprintf("qemu+tcp://%s/system", ip)
}

// Get 获取（或建立）到指定宿主机的连接。调用方不要 Close，由管理器统一管理。
func (cm *ConnManager) Get(hostIP string) (*libvirt.Connect, error) {
	uri := hostURI(hostIP)

	cm.mu.RLock()
	if pc, ok := cm.conns[uri]; ok {
		// 校验连接存活
		if alive, err := pc.conn.IsAlive(); err == nil && alive {
			pc.lastUsed = time.Now()
			cm.mu.RUnlock()
			return pc.conn, nil
		}
	}
	cm.mu.RUnlock()

	// 建立新连接
	cm.mu.Lock()
	defer cm.mu.Unlock()
	// double-check
	if pc, ok := cm.conns[uri]; ok {
		if alive, err := pc.conn.IsAlive(); err == nil && alive {
			pc.lastUsed = time.Now()
			return pc.conn, nil
		}
		_, _ = pc.conn.Close()
		delete(cm.conns, uri)
	}

	conn, err := libvirt.NewConnect(uri)
	if err != nil {
		return nil, fmt.Errorf("连接 libvirt %s 失败: %w", uri, err)
	}
	cm.conns[uri] = &pooledConn{conn: conn, uri: uri, lastUsed: time.Now()}
	return conn, nil
}

// Close 关闭指定宿主机连接。
func (cm *ConnManager) Close(hostIP string) {
	uri := hostURI(hostIP)
	cm.mu.Lock()
	defer cm.mu.Unlock()
	if pc, ok := cm.conns[uri]; ok {
		_, _ = pc.conn.Close()
		delete(cm.conns, uri)
	}
}

// CloseAll 关闭所有连接（服务退出时调用）。
func (cm *ConnManager) CloseAll() {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	for uri, pc := range cm.conns {
		_, _ = pc.conn.Close()
		delete(cm.conns, uri)
	}
}

// reaper 每 5 分钟回收空闲超过 30 分钟的连接。
func (cm *ConnManager) reaper() {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for range t.C {
		cm.mu.Lock()
		for uri, pc := range cm.conns {
			if time.Since(pc.lastUsed) > 30*time.Minute {
				_, _ = pc.conn.Close()
				delete(cm.conns, uri)
			}
		}
		cm.mu.Unlock()
	}
}
