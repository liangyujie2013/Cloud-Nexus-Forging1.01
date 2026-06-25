// Package ha 基于 Redis 分布式锁实现 HA 控制面选主（leader election）。
//
// 多节点部署时，所有 cnf-server 竞争同一把锁；持锁者成为 leader，
// 独占执行需要单点的后台任务（HA 故障转移决策、DRS 再平衡、告警评估、
// 指标聚合等）。leader 周期性续租；崩溃后租约到期，其余节点自动接管。
//
// 单节点部署时（HAEnabled=false）直接视为 leader，无需 Redis。
package ha

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/cnf/cnfv1/internal/cache"
)

const leaderKey = "cnf:ha:leader"

// Elector 选主器。
type Elector struct {
	cache    *cache.Client
	nodeID   string
	lease    time.Duration
	renew    time.Duration
	enabled  bool
	isLeader atomic.Bool
	onChange func(isLeader bool)
}

// Config 选主配置。
type Config struct {
	Enabled     bool
	NodeID      string
	LeaseTTL    time.Duration
	RenewPeriod time.Duration
	// OnChange 在 leader 状态翻转时回调（可选）。
	OnChange func(isLeader bool)
}

// New 构造选主器。单节点（!Enabled）直接恒为 leader。
func New(c *cache.Client, cfg Config) *Elector {
	if cfg.LeaseTTL <= 0 {
		cfg.LeaseTTL = 15 * time.Second
	}
	if cfg.RenewPeriod <= 0 || cfg.RenewPeriod >= cfg.LeaseTTL {
		cfg.RenewPeriod = cfg.LeaseTTL / 3
	}
	e := &Elector{
		cache:    c,
		nodeID:   cfg.NodeID,
		lease:    cfg.LeaseTTL,
		renew:    cfg.RenewPeriod,
		enabled:  cfg.Enabled,
		onChange: cfg.OnChange,
	}
	if !cfg.Enabled {
		e.setLeader(true) // 单节点恒为 leader
	}
	return e
}

// IsLeader 当前节点是否为 leader。
func (e *Elector) IsLeader() bool { return e.isLeader.Load() }

// NodeID 返回本节点标识。
func (e *Elector) NodeID() string { return e.nodeID }

// Run 启动选主循环，直到 ctx 取消。单节点模式立即返回。
func (e *Elector) Run(ctx context.Context) {
	if !e.enabled || e.cache == nil {
		return
	}
	// 首次立即尝试，之后按 renew 周期心跳
	e.tick(ctx)
	t := time.NewTicker(e.renew)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			// 优雅退出：若为 leader 主动释放锁，加速他人接管
			if e.IsLeader() {
				rctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				_ = e.cache.Unlock(rctx, leaderKey, e.nodeID)
				cancel()
			}
			e.setLeader(false)
			return
		case <-t.C:
			e.tick(ctx)
		}
	}
}

// tick 执行一次选主/续租。
func (e *Elector) tick(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, e.renew)
	defer cancel()

	if e.IsLeader() {
		// 已是 leader：续租；续租失败说明锁已丢失，降级
		if err := e.cache.Renew(cctx, leaderKey, e.nodeID, e.lease); err != nil {
			e.setLeader(false)
		}
		return
	}
	// 非 leader：尝试抢锁
	ok, err := e.cache.TryLock(cctx, leaderKey, e.nodeID, e.lease)
	if err == nil && ok {
		e.setLeader(true)
	}
}

// LeaderID 返回当前集群 leader 的节点标识（无人持有返回 ""）。
func (e *Elector) LeaderID(ctx context.Context) string {
	if !e.enabled || e.cache == nil {
		return e.nodeID
	}
	owner, ok, err := e.cache.LockOwner(ctx, leaderKey)
	if err != nil || !ok {
		return ""
	}
	return owner
}

func (e *Elector) setLeader(v bool) {
	old := e.isLeader.Swap(v)
	if old != v && e.onChange != nil {
		e.onChange(v)
	}
}
