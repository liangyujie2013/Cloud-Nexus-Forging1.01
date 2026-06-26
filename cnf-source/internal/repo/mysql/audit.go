package mysql

import (
	"context"
	"database/sql"
)

// AuditEntry 一条审计日志（对应 audit_logs 表）。
type AuditEntry struct {
	UserID     *int           `json:"user_id"`
	Username   string         `json:"username"`
	Action     string         `json:"action"` // 如 login / host.create / vm.create / vm.start / vm.stop / vm.delete
	Resource   string         `json:"resource"`
	ResourceID int            `json:"resource_id"`
	Detail     map[string]any `json:"detail"`
	IPAddress  string         `json:"ip_address"`
}

// WriteAudit 写入一条审计日志。best-effort：调用方通常忽略其错误，
// 不应因审计失败阻断主流程。
func (r *Repository) WriteAudit(ctx context.Context, e AuditEntry) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO audit_logs (user_id, username, action, resource, resource_id, detail, ip_address)
		 VALUES (?,?,?,?,?,?,?)`,
		nullInt(e.UserID), nullStr(e.Username), e.Action, nullStr(e.Resource),
		nullZeroInt(e.ResourceID), mustJSON(e.Detail, false), nullStr(e.IPAddress))
	return err
}

// ListAudit 列出审计日志（按时间倒序，最多 limit 条）。
func (r *Repository) ListAudit(ctx context.Context, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, COALESCE(username,''), action, COALESCE(resource,''),
		        resource_id, detail, COALESCE(ip_address,''), created_at
		 FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id, resourceID   int
			username, action string
			resource, ip     string
			detail           []byte
			createdAt        any
			uid              sql.NullInt64
		)
		if err := rows.Scan(&id, &uid, &username, &action, &resource,
			&resourceID, &detail, &ip, &createdAt); err != nil {
			return nil, err
		}
		userID := intPtr(uid)
		var d map[string]any
		_ = scanJSON(detail, &d)
		out = append(out, map[string]any{
			"id": id, "user_id": userID, "username": username, "action": action,
			"resource": resource, "resource_id": resourceID, "detail": d,
			"ip_address": ip, "created_at": createdAt,
		})
	}
	return out, rows.Err()
}
