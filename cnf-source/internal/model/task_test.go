package model

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestTaskMarshalJSON 验证任务序列化包含 MVP 要求的派生字段：
// updated_at / error / target，且 created_at 等基础字段保留。
func TestTaskMarshalJSON(t *testing.T) {
	created := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	started := created.Add(1 * time.Second)
	finished := created.Add(5 * time.Second)

	task := Task{
		ID:           7,
		UUID:         uuid.New(),
		Type:         "create_vm",
		TargetType:   "vm",
		TargetID:     42,
		Status:       TaskSuccess,
		Progress:     100,
		ErrorMessage: "",
		StartedAt:    &started,
		FinishedAt:   &finished,
		CreatedAt:    created,
	}

	b, err := json.Marshal(task)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	// 基础字段
	for _, k := range []string{"id", "type", "status", "progress", "created_at", "updated_at", "error"} {
		if _, ok := m[k]; !ok {
			t.Errorf("缺少字段 %q", k)
		}
	}
	// target 派生字段
	tgt, ok := m["target"].(map[string]any)
	if !ok {
		t.Fatalf("target 字段缺失或类型错误: %v", m["target"])
	}
	if tgt["type"] != "vm" {
		t.Errorf("target.type 期望 vm，得到 %v", tgt["type"])
	}
}

// TestTaskUpdatedAt 验证 UpdatedAt 的优先级：finished > started > created。
func TestTaskUpdatedAt(t *testing.T) {
	created := time.Now()
	started := created.Add(time.Second)
	finished := created.Add(2 * time.Second)

	if got := (Task{CreatedAt: created}).UpdatedAt(); !got.Equal(created) {
		t.Errorf("仅 created 时应返回 created")
	}
	if got := (Task{CreatedAt: created, StartedAt: &started}).UpdatedAt(); !got.Equal(started) {
		t.Errorf("有 started 时应返回 started")
	}
	if got := (Task{CreatedAt: created, StartedAt: &started, FinishedAt: &finished}).UpdatedAt(); !got.Equal(finished) {
		t.Errorf("有 finished 时应返回 finished")
	}
}
