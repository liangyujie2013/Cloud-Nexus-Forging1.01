package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/cnf/cnfv1/internal/model"
	"github.com/google/uuid"
)

// TaskHandler 任务执行函数。
// ctx 控制取消；progress 回调用于上报 0~100 进度。
// 返回的 map 写入 Task.Result，error 非空则任务置为 failed。
type TaskHandler func(ctx context.Context, t *model.Task, progress func(int)) (map[string]any, error)

// runningTask 内部追踪一个执行中的任务。
type runningTask struct {
	task   *model.Task
	cancel context.CancelFunc
}

// TaskQueue 异步任务队列：固定大小的 worker pool 串行消费 channel，
// 每个任务的进度/状态实时回写 Repository（即数据库），
// 前端可轮询 GET /tasks/:uuid 观察长耗时操作（创建/迁移/快照）。
type TaskQueue struct {
	repo     Repository
	jobs     chan *queuedJob
	workers  int
	wg       sync.WaitGroup
	mu       sync.RWMutex
	running  map[uuid.UUID]*runningTask
	stopOnce sync.Once
	stopped  chan struct{}
}

type queuedJob struct {
	task    *model.Task
	handler TaskHandler
}

// NewTaskQueue 构造任务队列。workers<=0 时默认为 4。
func NewTaskQueue(repo Repository, workers int) *TaskQueue {
	if workers <= 0 {
		workers = 4
	}
	return &TaskQueue{
		repo:    repo,
		jobs:    make(chan *queuedJob, 256),
		workers: workers,
		running: make(map[uuid.UUID]*runningTask),
		stopped: make(chan struct{}),
	}
}

// Start 启动 worker pool。
func (q *TaskQueue) Start() {
	for i := 0; i < q.workers; i++ {
		q.wg.Add(1)
		go q.worker()
	}
}

// Stop 优雅停止：关闭 jobs channel 并等待在途任务结束。
func (q *TaskQueue) Stop() {
	q.stopOnce.Do(func() {
		close(q.stopped)
		close(q.jobs)
	})
	q.wg.Wait()
}

// Enqueue 创建并入队一个任务，立即返回任务句柄（状态 pending）。
// taskType: create_vm / migrate_vm / snapshot / collect_metrics 等。
func (q *TaskQueue) Enqueue(ctx context.Context, taskType, targetType string, targetID int, payload map[string]any, h TaskHandler) (*model.Task, error) {
	t := &model.Task{
		UUID:       uuid.New(),
		Type:       taskType,
		TargetType: targetType,
		TargetID:   targetID,
		Status:     model.TaskPending,
		Progress:   0,
		Payload:    payload,
		CreatedAt:  time.Now(),
	}
	id, err := q.repo.CreateTask(ctx, t)
	if err != nil {
		return nil, fmt.Errorf("创建任务记录失败: %w", err)
	}
	t.ID = id

	select {
	case <-q.stopped:
		return nil, fmt.Errorf("任务队列已停止")
	case q.jobs <- &queuedJob{task: t, handler: h}:
		return t, nil
	default:
		// 队列已满，直接标记失败
		t.Status = model.TaskFailed
		t.ErrorMessage = "任务队列已满"
		_ = q.repo.UpdateTask(ctx, t)
		return nil, fmt.Errorf("任务队列已满，请稍后重试")
	}
}

// Cancel 取消执行中的任务（best-effort，依赖 handler 监听 ctx）。
func (q *TaskQueue) Cancel(taskUUID uuid.UUID) bool {
	q.mu.RLock()
	rt, ok := q.running[taskUUID]
	q.mu.RUnlock()
	if !ok {
		return false
	}
	rt.cancel()
	return true
}

func (q *TaskQueue) worker() {
	defer q.wg.Done()
	for job := range q.jobs {
		q.execute(job)
	}
}

func (q *TaskQueue) execute(job *queuedJob) {
	t := job.task
	// 每个任务独立 context，支持取消；执行最长 30 分钟兜底超时。
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	q.mu.Lock()
	q.running[t.UUID] = &runningTask{task: t, cancel: cancel}
	q.mu.Unlock()
	defer func() {
		q.mu.Lock()
		delete(q.running, t.UUID)
		q.mu.Unlock()
	}()

	// 标记 running
	now := time.Now()
	t.Status = model.TaskRunning
	t.StartedAt = &now
	t.Progress = 0
	_ = q.repo.UpdateTask(ctx, t)

	// 进度回调（限频写库，避免每 1% 一次 update）
	var lastWrite int
	progress := func(p int) {
		if p < 0 {
			p = 0
		}
		if p > 100 {
			p = 100
		}
		t.Progress = p
		if p == 100 || p-lastWrite >= 5 {
			lastWrite = p
			_ = q.repo.UpdateTask(ctx, t)
		}
	}

	// panic 保护
	result, err := func() (res map[string]any, e error) {
		defer func() {
			if r := recover(); r != nil {
				e = fmt.Errorf("任务执行 panic: %v", r)
			}
		}()
		return job.handler(ctx, t, progress)
	}()

	fin := time.Now()
	t.FinishedAt = &fin
	if err != nil {
		t.Status = model.TaskFailed
		t.ErrorMessage = err.Error()
	} else {
		t.Status = model.TaskSuccess
		t.Progress = 100
		t.Result = result
	}
	_ = q.repo.UpdateTask(ctx, t)
}
