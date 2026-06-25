package mysql

import (
	"context"
	"database/sql"

	"github.com/cnf/cnfv1/internal/model"
)

// ============================================================================
// 监控：告警规则 / 指标采样 / 审计日志
// ============================================================================

const alertRuleColumns = `id, name, metric, operator, threshold, duration_seconds,
	severity, COALESCE(notify_channel,''), enabled, created_at, updated_at`

func scanAlertRule(s scanner) (*model.AlertRule, error) {
	var a model.AlertRule
	if err := s.Scan(&a.ID, &a.Name, &a.Metric, &a.Operator, &a.Threshold, &a.DurationSeconds,
		&a.Severity, &a.NotifyChannel, &a.Enabled, &a.CreatedAt, &a.UpdatedAt); err != nil {
		return nil, err
	}
	return &a, nil
}

// ListAlertRules 列出告警规则。
func (r *Repository) ListAlertRules(ctx context.Context) ([]model.AlertRule, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+alertRuleColumns+` FROM alert_rules ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.AlertRule
	for rows.Next() {
		a, err := scanAlertRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// CreateAlertRule 新建告警规则。
func (r *Repository) CreateAlertRule(ctx context.Context, a *model.AlertRule) (int, error) {
	if a.Operator == "" {
		a.Operator = ">"
	}
	if a.DurationSeconds <= 0 {
		a.DurationSeconds = 60
	}
	if a.Severity == "" {
		a.Severity = model.AlertWarning
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO alert_rules (name, metric, operator, threshold, duration_seconds, severity, notify_channel, enabled)
		 VALUES (?,?,?,?,?,?,?,?)`,
		a.Name, a.Metric, a.Operator, a.Threshold, a.DurationSeconds, a.Severity, nullStr(a.NotifyChannel), a.Enabled)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return int(id), nil
}

// SetAlertRuleEnabled 启用/禁用规则。
func (r *Repository) SetAlertRuleEnabled(ctx context.Context, id int, enabled bool) error {
	_, err := r.db.ExecContext(ctx, `UPDATE alert_rules SET enabled=? WHERE id=?`, enabled, id)
	return err
}

// DeleteAlertRule 删除规则。
func (r *Repository) DeleteAlertRule(ctx context.Context, id int) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM alert_rules WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// InsertMetricSample 写入一条指标采样（历史趋势）。
func (r *Repository) InsertMetricSample(ctx context.Context, s *model.MetricSample) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO metrics_samples (target_type, target_key, metric, value) VALUES (?,?,?,?)`,
		s.TargetType, s.TargetKey, s.Metric, s.Value)
	return err
}

// QueryMetricSamples 查询某目标某指标在最近 limit 条的趋势。
func (r *Repository) QueryMetricSamples(ctx context.Context, targetType, targetKey, metric string, limit int) ([]model.MetricSample, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, target_type, target_key, metric, value, sampled_at
		 FROM metrics_samples
		 WHERE target_type=? AND target_key=? AND metric=?
		 ORDER BY sampled_at DESC LIMIT ?`,
		targetType, targetKey, metric, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.MetricSample
	for rows.Next() {
		var m model.MetricSample
		if err := rows.Scan(&m.ID, &m.TargetType, &m.TargetKey, &m.Metric, &m.Value, &m.SampledAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertAuditLog 写入审计日志。
func (r *Repository) InsertAuditLog(ctx context.Context, a *model.AuditLog) error {
	var uid sql.NullInt64
	if a.UserID != nil {
		uid = sql.NullInt64{Int64: int64(*a.UserID), Valid: true}
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO audit_logs (user_id, username, action, resource, resource_id, detail, ip_address)
		 VALUES (?,?,?,?,?,?,?)`,
		uid, nullStr(a.Username), a.Action, nullStr(a.Resource), nullInt(a.ResourceID),
		mustJSON(a.Detail, false), nullStr(a.IPAddress))
	return err
}

// ListAuditLogs 列出最近的审计日志。
func (r *Repository) ListAuditLogs(ctx context.Context, limit int) ([]model.AuditLog, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, COALESCE(username,''), action, COALESCE(resource,''), resource_id, detail, COALESCE(ip_address,''), created_at
		 FROM audit_logs ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.AuditLog
	for rows.Next() {
		var (
			a      model.AuditLog
			uid    sql.NullInt64
			resID  sql.NullInt64
			detail sql.RawBytes
		)
		if err := rows.Scan(&a.ID, &uid, &a.Username, &a.Action, &a.Resource, &resID, &detail, &a.IPAddress, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.UserID = intPtr(uid)
		a.ResourceID = intPtr(resID)
		_ = scanJSON([]byte(detail), &a.Detail)
		out = append(out, a)
	}
	return out, rows.Err()
}
