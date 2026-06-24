package model

import (
	"time"

	"github.com/google/uuid"
)

// TaskStatus 异步任务状态。
type TaskStatus string

const (
	TaskPending   TaskStatus = "pending"
	TaskRunning   TaskStatus = "running"
	TaskSuccess   TaskStatus = "success"
	TaskFailed    TaskStatus = "failed"
	TaskCancelled TaskStatus = "cancelled"
)

// Task 异步任务（VM 创建/迁移/快照等长耗时操作）。
type Task struct {
	ID           int            `json:"id"            db:"id"`
	UUID         uuid.UUID      `json:"uuid"          db:"uuid"`
	Type         string         `json:"type"          db:"type"`
	TargetType   string         `json:"target_type"   db:"target_type"`
	TargetID     int            `json:"target_id"     db:"target_id"`
	Status       TaskStatus     `json:"status"        db:"status"`
	Progress     int            `json:"progress"      db:"progress"`
	UserID       *int           `json:"user_id"       db:"user_id"`
	Payload      map[string]any `json:"payload"       db:"payload"`
	Result       map[string]any `json:"result"        db:"result"`
	ErrorMessage string         `json:"error_message" db:"error_message"`
	StartedAt    *time.Time     `json:"started_at"    db:"started_at"`
	FinishedAt   *time.Time     `json:"finished_at"   db:"finished_at"`
	CreatedAt    time.Time      `json:"created_at"    db:"created_at"`
}
