package auth

import (
	"context"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
)

// tinyTimeout 权限校验查库的超时上限。
const tinyTimeout = 3 * time.Second

// Locals 键：在请求上下文中保存解析出的身份。
const (
	LocalUserID   = "auth_user_id"
	LocalUsername = "auth_username"
	LocalRole     = "auth_role"
)

// Middleware 聚合鉴权所需依赖。
type Middleware struct {
	tokens *TokenManager
	store  *Store
}

// NewMiddleware 构造鉴权中间件。
func NewMiddleware(tokens *TokenManager, store *Store) *Middleware {
	return &Middleware{tokens: tokens, store: store}
}

// Authenticate 解析 Bearer Token，校验通过后把身份注入 Locals。
// 无 Token / 非法 Token 一律 401。
func (m *Middleware) Authenticate(c fiber.Ctx) error {
	authz := c.Get("Authorization")
	if authz == "" || !strings.HasPrefix(authz, "Bearer ") {
		return unauthorized(c, "缺少 Bearer Token")
	}
	tokenStr := strings.TrimSpace(strings.TrimPrefix(authz, "Bearer "))
	claims, err := m.tokens.Parse(tokenStr)
	if err != nil {
		return unauthorized(c, "Token 无效或已过期")
	}
	c.Locals(LocalUserID, claims.UserID)
	c.Locals(LocalUsername, claims.Username)
	c.Locals(LocalRole, claims.Role)
	return c.Next()
}

// RequirePermission 返回一个要求指定权限点的中间件。
// 必须在 Authenticate 之后使用。基于用户角色的权限点集合判定。
func (m *Middleware) RequirePermission(point string) fiber.Handler {
	return func(c fiber.Ctx) error {
		roleName, _ := c.Locals(LocalRole).(string)
		if roleName == "" {
			return forbidden(c, "无角色，拒绝访问")
		}
		// 查角色权限点（admin 等内置角色含 "*"）。
		ctx, cancel := context.WithTimeout(c.Context(), tinyTimeout)
		defer cancel()
		role, err := m.store.GetRoleByName(ctx, roleName)
		if err != nil {
			return forbidden(c, "角色不存在或无法校验权限")
		}
		if !role.HasPermission(point) {
			return forbidden(c, "缺少权限: "+point)
		}
		return c.Next()
	}
}

// CurrentUserID 从 Locals 取当前用户 id（未登录返回 0,false）。
func CurrentUserID(c fiber.Ctx) (int, bool) {
	v, ok := c.Locals(LocalUserID).(int)
	return v, ok
}

// CurrentUsername 从 Locals 取当前用户名。
func CurrentUsername(c fiber.Ctx) string {
	v, _ := c.Locals(LocalUsername).(string)
	return v
}

func unauthorized(c fiber.Ctx, msg string) error {
	return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": msg})
}

func forbidden(c fiber.Ctx, msg string) error {
	return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": msg})
}
