package service

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// ScheduledJob 一个周期性任务。
type ScheduledJob struct {
	Name      string                          // 任务名（日志/去重）
	Interval  time.Duration                   // 执行间隔
	Fn        func(ctx context.Context) error // 执行体
	runAtBoot bool                            // 启动后是否立即执行一次
}

// Scheduler 轻量级周期调度器（固定间隔，非 crontab 表达式）。
// 用于宿主机指标采集、GPU 利用率采集、孤儿任务清理等后台巡检。
// 相比引入第三方 cron 库，固定间隔已满足私有云巡检场景且零依赖。
type Scheduler struct {
	mu      sync.Mutex
	jobs    []ScheduledJob
	cancels []context.CancelFunc
	started bool
	log     *slog.Logger
}

// NewScheduler 构造调度器。logger 可为 nil（使用默认）。
func NewScheduler(log *slog.Logger) *Scheduler {
	if log == nil {
		log = slog.Default()
	}
	return &Scheduler{log: log}
}

// Register 注册一个周期任务（须在 Start 前调用）。
// runAtBoot=true 表示启动后立即先跑一次再进入定时循环。
func (s *Scheduler) Register(name string, interval time.Duration, runAtBoot bool, fn func(ctx context.Context) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs = append(s.jobs, ScheduledJob{
		Name:      name,
		Interval:  interval,
		Fn:        fn,
		runAtBoot: runAtBoot,
	})
}

// Start 启动所有已注册任务，每个任务一个独立 goroutine。
func (s *Scheduler) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return
	}
	s.started = true
	for _, job := range s.jobs {
		ctx, cancel := context.WithCancel(context.Background())
		s.cancels = append(s.cancels, cancel)
		go s.run(ctx, job)
	}
}

// Stop 停止所有周期任务。
func (s *Scheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.cancels {
		c()
	}
	s.cancels = nil
	s.started = false
}

func (s *Scheduler) run(ctx context.Context, job ScheduledJob) {
	exec := func() {
		start := time.Now()
		if err := safeRun(ctx, job.Fn); err != nil {
			s.log.Warn("scheduled job failed",
				slog.String("job", job.Name),
				slog.String("error", err.Error()),
				slog.Duration("elapsed", time.Since(start)),
			)
		}
	}

	if job.runAtBoot {
		exec()
	}

	ticker := time.NewTicker(job.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			exec()
		}
	}
}

// safeRun 包裹 panic，避免单次巡检 panic 拖垮整个调度 goroutine。
func safeRun(ctx context.Context, fn func(ctx context.Context) error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = recoverErr(r)
		}
	}()
	return fn(ctx)
}
