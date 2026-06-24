// Package storage 定义统一存储驱动接口，屏蔽 local/NFS/iSCSI/FC/NVMe-oF 差异。
package storage

import (
	"context"
	"fmt"
)

// Volume 卷信息。
type Volume struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	SizeBytes int64  `json:"size_bytes"`
	Format    string `json:"format"`
}

// CapacityInfo 容量信息。
type CapacityInfo struct {
	TotalBytes     int64 `json:"total_bytes"`
	UsedBytes      int64 `json:"used_bytes"`
	AvailableBytes int64 `json:"available_bytes"`
}

// StorageMetrics 性能指标。
type StorageMetrics struct {
	ReadIOPS  float64 `json:"read_iops"`
	WriteIOPS float64 `json:"write_iops"`
	ReadMBps  float64 `json:"read_mbps"`
	WriteMBps float64 `json:"write_mbps"`
	Latency   float64 `json:"latency_ms"`
}

// Driver 统一存储驱动接口。所有后端必须实现。
type Driver interface {
	// Type 返回驱动类型标识。
	Type() string
	// Connect 建立与存储后端的连接（挂载 NFS、登录 iSCSI target 等）。
	Connect(ctx context.Context, config map[string]any) error
	// Disconnect 断开连接。
	Disconnect(ctx context.Context) error
	// CreateVolume 创建卷。
	CreateVolume(ctx context.Context, name string, sizeGB int64) (*Volume, error)
	// DeleteVolume 删除卷。
	DeleteVolume(ctx context.Context, name string) error
	// CloneVolume 克隆卷（支持链式/完整克隆，由实现决定）。
	CloneVolume(ctx context.Context, srcName, dstName string) error
	// GetCapacity 获取容量信息。
	GetCapacity(ctx context.Context) (*CapacityInfo, error)
	// GetMetrics 获取性能指标。
	GetMetrics(ctx context.Context) (*StorageMetrics, error)
}

// Factory 根据类型创建驱动实例。
func Factory(storageType string) (Driver, error) {
	switch storageType {
	case "local":
		return &LocalDriver{}, nil
	case "nfs":
		return &NFSDriver{}, nil
	case "iscsi":
		return &ISCSIDriver{}, nil
	default:
		return nil, fmt.Errorf("unsupported storage type: %s", storageType)
	}
}
