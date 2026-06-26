package v1

import (
	"errors"

	"github.com/cnf/cnfv1/internal/auth"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/gofiber/fiber/v3"
)

// audit 写一条审计日志（best-effort，失败不阻断主流程）。
// 自动从请求上下文提取当前用户与来源 IP。
// action 形如 login / host.create / vm.create / vm.start / vm.stop / vm.delete。
func (h *Handlers) audit(c fiber.Ctx, action, resource string, resourceID int, detail map[string]any) {
	if h.MySQL == nil {
		return
	}
	var uidPtr *int
	if uid, ok := auth.CurrentUserID(c); ok && uid > 0 {
		uidPtr = &uid
	}
	_ = h.MySQL.WriteAudit(c.Context(), mysql.AuditEntry{
		UserID:     uidPtr,
		Username:   auth.CurrentUsername(c),
		Action:     action,
		Resource:   resource,
		ResourceID: resourceID,
		Detail:     detail,
		IPAddress:  c.IP(),
	})
}

// ============================================================================
// 统一 API 错误格式（MVP 闭环要求 7）
//
// 所有核心 API 的错误响应统一为：
//
//	{
//	  "code": "VM_NOT_FOUND",
//	  "message": "Virtual machine not found",
//	  "details": {}
//	}
//
// code    机器可读的稳定错误码（前端据此分支处理 / i18n）。
// message 人类可读的错误说明（默认中文，可被 details 补充）。
// details 结构化补充信息（缺省为 {}，绝不为 null）。
// ============================================================================

// APIError 统一错误响应体。
type APIError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

// 常用错误码常量（resource_action 大写蛇形）。
const (
	CodeBadRequest      = "BAD_REQUEST"
	CodeUnauthorized    = "UNAUTHORIZED"
	CodeForbidden       = "FORBIDDEN"
	CodeNotFound        = "NOT_FOUND"
	CodeConflict        = "CONFLICT"
	CodeInternal        = "INTERNAL_ERROR"
	CodeVMNotFound      = "VM_NOT_FOUND"
	CodeHostNotFound    = "HOST_NOT_FOUND"
	CodeTaskNotFound    = "TASK_NOT_FOUND"
	CodeHasChildren     = "RESOURCE_HAS_CHILDREN"
	CodeLibvirtUnreach  = "LIBVIRT_UNREACHABLE"
	CodeValidation      = "VALIDATION_FAILED"
	CodePreconditionErr = "PRECONDITION_FAILED"
)

// writeErr 以统一格式写出错误响应。details 为 nil 时输出 {}。
func writeErr(c fiber.Ctx, status int, code, message string, details map[string]any) error {
	if details == nil {
		details = map[string]any{}
	}
	return c.Status(status).JSON(APIError{Code: code, Message: message, Details: details})
}

// errBadRequest 400。
func errBadRequest(c fiber.Ctx, message string) error {
	return writeErr(c, fiber.StatusBadRequest, CodeBadRequest, message, nil)
}

// errValidation 400 校验失败（带字段细节）。
func errValidation(c fiber.Ctx, message string, details map[string]any) error {
	return writeErr(c, fiber.StatusBadRequest, CodeValidation, message, details)
}

// errNotFound 404（可指定具体 code）。
func errNotFound(c fiber.Ctx, code, message string) error {
	return writeErr(c, fiber.StatusNotFound, code, message, nil)
}

// errConflict 409。
func errConflict(c fiber.Ctx, code, message string) error {
	return writeErr(c, fiber.StatusConflict, code, message, nil)
}

// errInternal 500，附带底层 error 文本到 details.cause。
func errInternal(c fiber.Ctx, err error) error {
	d := map[string]any{}
	if err != nil {
		d["cause"] = err.Error()
	}
	return writeErr(c, fiber.StatusInternalServerError, CodeInternal, "服务器内部错误", d)
}

// errFromHierarchy 将 mysql 层级仓储错误映射为统一格式。
func errFromHierarchy(c fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, mysql.ErrNotFound):
		return errNotFound(c, CodeNotFound, "资源不存在")
	case errors.Is(err, mysql.ErrHasChildren):
		return errConflict(c, CodeHasChildren, "存在下级资源，无法删除")
	default:
		return errInternal(c, err)
	}
}

// errFromAuth 将 auth 错误映射为统一格式。
func errFromAuth(c fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, auth.ErrBadCredentials):
		return writeErr(c, fiber.StatusUnauthorized, CodeUnauthorized, "用户名或密码错误", nil)
	case errors.Is(err, auth.ErrUserDisabled):
		return writeErr(c, fiber.StatusForbidden, CodeForbidden, "账户已禁用", nil)
	case errors.Is(err, auth.ErrUserNotFound):
		return errNotFound(c, CodeNotFound, "用户不存在")
	default:
		return errInternal(c, err)
	}
}
