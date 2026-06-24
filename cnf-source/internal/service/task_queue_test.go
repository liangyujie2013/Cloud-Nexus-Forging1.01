package service

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cnf/cnfv1/internal/model"
)

func waitTask(t *testing.T, repo *mockRepo, id int, want model.TaskStatus, timeout time.Duration) *model.Task {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if tk := repo.getTask(id); tk != nil && tk.Status == want {
			return tk
		}
		time.Sleep(5 * time.Millisecond)
	}
	tk := repo.getTask(id)
	t.Fatalf("任务 %d 未在 %v 内达到状态 %s，当前=%v", id, timeout, want, tk)
	return nil
}

func TestTaskQueueSuccess(t *testing.T) {
	repo := newMockRepo()
	q := NewTaskQueue(repo, 2)
	q.Start()
	defer q.Stop()

	task, err := q.Enqueue(context.Background(), "test", "vm", 1, nil,
		func(ctx context.Context, tk *model.Task, progress func(int)) (map[string]any, error) {
			progress(50)
			progress(100)
			return map[string]any{"ok": true}, nil
		})
	if err != nil {
		t.Fatalf("入队失败: %v", err)
	}

	done := waitTask(t, repo, task.ID, model.TaskSuccess, 2*time.Second)
	if done.Progress != 100 {
		t.Errorf("进度应为 100，实际 %d", done.Progress)
	}
	if done.Result["ok"] != true {
		t.Errorf("Result 未回写: %v", done.Result)
	}
	if done.FinishedAt == nil {
		t.Error("FinishedAt 应被设置")
	}
}

func TestTaskQueueFailure(t *testing.T) {
	repo := newMockRepo()
	q := NewTaskQueue(repo, 1)
	q.Start()
	defer q.Stop()

	task, _ := q.Enqueue(context.Background(), "test", "vm", 1, nil,
		func(ctx context.Context, tk *model.Task, progress func(int)) (map[string]any, error) {
			return nil, errors.New("boom")
		})

	done := waitTask(t, repo, task.ID, model.TaskFailed, 2*time.Second)
	if done.ErrorMessage != "boom" {
		t.Errorf("错误信息应为 boom，实际 %q", done.ErrorMessage)
	}
}

func TestTaskQueuePanicRecover(t *testing.T) {
	repo := newMockRepo()
	q := NewTaskQueue(repo, 1)
	q.Start()
	defer q.Stop()

	task, _ := q.Enqueue(context.Background(), "test", "vm", 1, nil,
		func(ctx context.Context, tk *model.Task, progress func(int)) (map[string]any, error) {
			panic("explode")
		})

	done := waitTask(t, repo, task.ID, model.TaskFailed, 2*time.Second)
	if done.ErrorMessage == "" {
		t.Error("panic 应被捕获并写入 ErrorMessage")
	}
}

func TestTaskQueueCancel(t *testing.T) {
	repo := newMockRepo()
	q := NewTaskQueue(repo, 1)
	q.Start()
	defer q.Stop()

	started := make(chan struct{})
	task, _ := q.Enqueue(context.Background(), "test", "vm", 1, nil,
		func(ctx context.Context, tk *model.Task, progress func(int)) (map[string]any, error) {
			close(started)
			<-ctx.Done() // 等待取消
			return nil, ctx.Err()
		})

	<-started
	if !q.Cancel(task.UUID) {
		t.Fatal("Cancel 应返回 true")
	}
	done := waitTask(t, repo, task.ID, model.TaskFailed, 2*time.Second)
	if done.ErrorMessage == "" {
		t.Error("取消后应有错误信息")
	}
}

func TestSchedulerRunsPeriodically(t *testing.T) {
	s := NewScheduler(nil)
	var count int32
	s.Register("tick", 20*time.Millisecond, true, func(ctx context.Context) error {
		atomic.AddInt32(&count, 1)
		return nil
	})
	s.Start()
	time.Sleep(75 * time.Millisecond)
	s.Stop()

	got := atomic.LoadInt32(&count)
	// runAtBoot 一次 + 至少 2 次 tick
	if got < 3 {
		t.Errorf("调度执行次数应 >=3，实际 %d", got)
	}
}

func TestSchedulerPanicDoesNotKill(t *testing.T) {
	s := NewScheduler(nil)
	var count int32
	s.Register("panicky", 20*time.Millisecond, true, func(ctx context.Context) error {
		n := atomic.AddInt32(&count, 1)
		if n == 1 {
			panic("first run panics")
		}
		return nil
	})
	s.Start()
	time.Sleep(75 * time.Millisecond)
	s.Stop()

	// panic 后调度 goroutine 仍应继续 tick
	if atomic.LoadInt32(&count) < 2 {
		t.Errorf("panic 后调度应继续，执行次数 %d", count)
	}
}
