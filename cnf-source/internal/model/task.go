package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// marshalTaskJSON 序列化任务并附加派生字段：
//   - updated_at：最近变更时间（见 Task.UpdatedAt）
//   - target：target_type/target_id 的组合，便于前端直接展示
//   - error：error_message 的别名（MVP 要求字段名为 error）
func marshalTaskJSON(a any, updatedAt time.Time) ([]byte, error) {
	b, err := json.Marshal(a)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	m["updated_at"] = updatedAt
	m["error"] = m["error_message"]
	if tt, _ := m["target_type"].(string); tt != "" {
		m["target"] = map[string]any{"type": tt, "id": m["target_id"]}
	}
	return json.Marshal(m)
}

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

// UpdatedAt 返回任务的最近变更时间（派生字段，无独立列）：
// 优先 finished_at，其次 started_at，最后回退 created_at。
// JSON 序列化时通过 MarshalJSON 暴露，满足 MVP 任务字段要求。
func (t Task) UpdatedAt() time.Time {
	if t.FinishedAt != nil {
		return *t.FinishedAt
	}
	if t.StartedAt != nil {
		return *t.StartedAt
	}
	return t.CreatedAt
}

// MarshalJSON 在标准字段基础上附加派生的 updated_at 与 error 别名，
// 使任务对象同时满足 {id,type,status,progress,target,error,created_at,updated_at}。
func (t Task) MarshalJSON() ([]byte, error) {
	type alias Task // 避免递归
	return marshalTaskJSON(alias(t), t.UpdatedAt())
}
