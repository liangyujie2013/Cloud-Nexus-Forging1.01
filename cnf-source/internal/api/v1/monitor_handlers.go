package v1

import (
	"bufio"
	"context"
	"fmt"
	"time"

	"github.com/cnf/cnfv1/internal/cache"
	"github.com/cnf/cnfv1/internal/model"
	"github.com/gofiber/fiber/v3"
	"github.com/valyala/fasthttp"
)

// ============================================================================
// 功能 6：监控 —— SSE 实时指标流 + 历史趋势 + 告警规则
//
//	GET /metrics/stream?target=host:1   SSE 实时推送（从 Redis 环形缓冲读取）
//	GET /metrics/history?...            历史趋势（MySQL）
//	GET/POST/DELETE /alert-rules        告警规则管理
// ============================================================================

// metricsStream GET /metrics/stream —— Server-Sent Events 实时指标。
func (h *Handlers) metricsStream(c fiber.Ctx) error {
	target := c.Query("target")
	if target == "" {
		target = "cluster:all"
	}
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	cacheCli := h.Cache
	// 用独立 context 控制流生命周期；客户端断开时 StreamWriter 写入失败即退出。
	streamCtx, cancel := context.WithCancel(context.Background())

	c.Response().SetBodyStreamWriter(fasthttp.StreamWriter(func(w *bufio.Writer) {
		defer cancel()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		// 首帧立即推送一次
		if err := writeMetrics(w, cacheCli, streamCtx, target); err != nil {
			return
		}
		for {
			select {
			case <-streamCtx.Done():
				return
			case <-ticker.C:
				if err := writeMetrics(w, cacheCli, streamCtx, target); err != nil {
					return
				}
			}
		}
	}))
	return nil
}

// writeMetrics 从 Redis 环形缓冲取最近一条样本并以 SSE 帧写出；写失败（客户端断开）返回错误以终止流。
func writeMetrics(w *bufio.Writer, cacheCli *cache.Client, ctx context.Context, target string) error {
	var payload []byte
	if cacheCli != nil {
		if samples, err := cacheCli.RangeMetrics(ctx, target, 1); err == nil && len(samples) > 0 {
			payload = samples[len(samples)-1]
		}
	}
	if payload == nil {
		payload = []byte(fmt.Sprintf(`{"target":%q,"ts":%d,"note":"no-sample"}`, target, time.Now().Unix()))
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
		return err
	}
	return w.Flush()
}

// metricsHistory GET /metrics/history?target_type=&target_key=&metric=&limit=
func (h *Handlers) metricsHistory(c fiber.Ctx) error {
	targetType := c.Query("target_type")
	targetKey := c.Query("target_key")
	metric := c.Query("metric")
	if targetType == "" || targetKey == "" || metric == "" {
		return badRequest(c, "target_type / target_key / metric 必填")
	}
	limit, _ := paramQueryInt(c, "limit")
	samples, err := h.MySQL.QueryMetricSamples(c.Context(), targetType, targetKey, metric, limit)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": samples})
}

// ---- 告警规则 ----

func (h *Handlers) listAlertRules(c fiber.Ctx) error {
	rules, err := h.MySQL.ListAlertRules(c.Context())
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": rules})
}

type alertRuleRequest struct {
	Name            string  `json:"name"`
	Metric          string  `json:"metric"`
	Operator        string  `json:"operator"`
	Threshold       float64 `json:"threshold"`
	DurationSeconds int     `json:"duration_seconds"`
	Severity        string  `json:"severity"`
	NotifyChannel   string  `json:"notify_channel"`
	Enabled         bool    `json:"enabled"`
}

func (h *Handlers) createAlertRule(c fiber.Ctx) error {
	var req alertRuleRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Name == "" || req.Metric == "" {
		return badRequest(c, "name 与 metric 必填")
	}
	rule := &model.AlertRule{
		Name:            req.Name,
		Metric:          req.Metric,
		Operator:        req.Operator,
		Threshold:       req.Threshold,
		DurationSeconds: req.DurationSeconds,
		Severity:        model.AlertSeverity(req.Severity),
		NotifyChannel:   req.NotifyChannel,
		Enabled:         req.Enabled,
	}
	id, err := h.MySQL.CreateAlertRule(c.Context(), rule)
	if err != nil {
		return badRequest(c, "创建失败: "+err.Error())
	}
	rule.ID = id
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": rule})
}

func (h *Handlers) setAlertRuleEnabled(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return badRequest(c, "请求体非法")
	}
	if err := h.MySQL.SetAlertRuleEnabled(c.Context(), id, body.Enabled); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

func (h *Handlers) deleteAlertRule(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	if err := h.MySQL.DeleteAlertRule(c.Context(), id); err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}

// listAuditLogs GET /audit-logs?limit=100 —— 真实操作审计（来自 audit_logs 表，按时间倒序）。
//
// 这是访问控制 → 操作审计页面的数据源，全部为平台真实记录的操作（登录/主机/虚机/网络等）。
func (h *Handlers) listAuditLogs(c fiber.Ctx) error {
	limit, _ := paramQueryInt(c, "limit")
	if limit <= 0 {
		limit = 100
	}
	logs, err := h.MySQL.ListAudit(c.Context(), limit)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": logs})
}
