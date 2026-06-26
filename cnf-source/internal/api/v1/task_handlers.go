package v1

import (
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/gofiber/fiber/v3"
)

// ============================================================================
// 任务查询（MVP 闭环要求 3 / 8）
//
//	GET /tasks            列出任务（?status= 过滤，?limit= 限制条数）
//	GET /tasks/:id        按自增 id 或 UUID 查询单个任务
//
// 任务记录由 TaskQueue 在 VM 创建/迁移/快照等长耗时操作时写入，
// 前端可轮询观察 status / progress。
// ============================================================================

// listTasks GET /tasks?status=&limit=
func (h *Handlers) listTasks(c fiber.Ctx) error {
	status := c.Query("status")
	limit, _ := paramQueryInt(c, "limit")
	tasks, err := h.Repo.ListTasks(c.Context(), status, limit)
	if err != nil {
		return errInternal(c, err)
	}
	return c.JSON(fiber.Map{"data": tasks})
}

// getTask GET /tasks/:id —— id 既支持自增整数，也支持 UUID 字符串。
func (h *Handlers) getTask(c fiber.Ctx) error {
	idParam := c.Params("id")
	// 优先按整数 id 查询；非整数则按 UUID 查询。
	if id, err := paramInt(c, "id"); err == nil {
		t, gerr := h.Repo.GetTask(c.Context(), id)
		if gerr == nil {
			return c.JSON(fiber.Map{"data": t})
		}
		// 整数 id 未命中时回退尝试 UUID（极少数纯数字 UUID 不在考虑范围）。
	}
	t, err := h.Repo.GetTaskByUUID(c.Context(), idParam)
	if err != nil {
		if err == mysql.ErrNotFound {
			return errNotFound(c, CodeTaskNotFound, "任务不存在")
		}
		return errNotFound(c, CodeTaskNotFound, "任务不存在")
	}
	return c.JSON(fiber.Map{"data": t})
}
