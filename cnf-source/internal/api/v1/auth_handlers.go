package v1

import (
	"errors"

	"github.com/cnf/cnfv1/internal/auth"
	"github.com/cnf/cnfv1/internal/model"
	"github.com/gofiber/fiber/v3"
)

// ============================================================================
// 功能 1：鉴权 / RBAC —— 登录、当前用户、改密、用户与角色管理
// ============================================================================

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// login POST /auth/login —— 校验口令，签发 JWT。
func (h *Handlers) login(c fiber.Ctx) error {
	var req loginRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Username == "" || req.Password == "" {
		return badRequest(c, "用户名与密码不能为空")
	}
	u, err := h.Auth.Authenticate(c.Context(), req.Username, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrBadCredentials):
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "用户名或密码错误"})
		case errors.Is(err, auth.ErrUserDisabled):
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "账户已禁用"})
		default:
			return serverError(c, err)
		}
	}
	token, exp, err := h.Tokens.Generate(u.ID, u.Username, u.Role)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{
		"token":      token,
		"expires_at": exp,
		"user": fiber.Map{
			"id":           u.ID,
			"username":     u.Username,
			"display_name": u.DisplayName,
			"role":         u.Role,
		},
	})
}

// me GET /auth/me —— 返回当前登录用户及其权限点。
func (h *Handlers) me(c fiber.Ctx) error {
	uid, ok := auth.CurrentUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "未登录"})
	}
	u, err := h.Auth.GetUser(c.Context(), uid)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "用户不存在"})
	}
	var perms []string
	if u.Role != "" {
		if role, rerr := h.Auth.GetRoleByName(c.Context(), u.Role); rerr == nil {
			perms = role.Permissions
		}
	}
	return c.JSON(fiber.Map{"data": u, "permissions": perms})
}

type changePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

// changePassword POST /auth/change-password —— 当前用户自助改密。
func (h *Handlers) changePassword(c fiber.Ctx) error {
	uid, ok := auth.CurrentUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "未登录"})
	}
	var req changePasswordRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if len(req.NewPassword) < 6 {
		return badRequest(c, "新密码至少 6 位")
	}
	u, err := h.Auth.GetUser(c.Context(), uid)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "用户不存在"})
	}
	// 校验旧密码
	if _, err := h.Auth.Authenticate(c.Context(), u.Username, req.OldPassword); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "原密码错误"})
	}
	if err := h.Auth.UpdatePassword(c.Context(), uid, req.NewPassword); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

// ---- 用户管理（需 user.* 权限）----

// listUsers GET /users
func (h *Handlers) listUsers(c fiber.Ctx) error {
	users, err := h.Auth.ListUsers(c.Context())
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": users})
}

type createUserRequest struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	Role        string `json:"role"`
}

// createUser POST /users
func (h *Handlers) createUser(c fiber.Ctx) error {
	var req createUserRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Username == "" || len(req.Password) < 6 {
		return badRequest(c, "用户名必填，密码至少 6 位")
	}
	// 关联角色（按名称取 id）
	u := &model.User{
		Username:    req.Username,
		DisplayName: req.DisplayName,
		Email:       req.Email,
		Role:        req.Role,
		Enabled:     true,
	}
	if req.Role != "" {
		if role, err := h.Auth.GetRoleByName(c.Context(), req.Role); err == nil {
			u.RoleID = &role.ID
		}
	}
	id, err := h.Auth.CreateUser(c.Context(), u, req.Password)
	if err != nil {
		return badRequest(c, "创建用户失败: "+err.Error())
	}
	created, _ := h.Auth.GetUser(c.Context(), id)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": created})
}

// setUserEnabled POST /users/:id/enabled  {enabled:bool}
func (h *Handlers) setUserEnabled(c fiber.Ctx) error {
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
	if err := h.Auth.SetEnabled(c.Context(), id, body.Enabled); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

// resetUserPassword POST /users/:id/password  {password:string}
func (h *Handlers) resetUserPassword(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return badRequest(c, "请求体非法")
	}
	if len(body.Password) < 6 {
		return badRequest(c, "密码至少 6 位")
	}
	if err := h.Auth.UpdatePassword(c.Context(), id, body.Password); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

// deleteUser DELETE /users/:id
func (h *Handlers) deleteUser(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	if err := h.Auth.DeleteUser(c.Context(), id); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}

// ---- 角色管理 ----

// listRoles GET /roles
func (h *Handlers) listRoles(c fiber.Ctx) error {
	roles, err := h.Auth.ListRoles(c.Context())
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": roles})
}

type roleRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

// createRole POST /roles
func (h *Handlers) createRole(c fiber.Ctx) error {
	var req roleRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Name == "" {
		return badRequest(c, "角色名必填")
	}
	r := &model.Role{Name: req.Name, Description: req.Description, Permissions: req.Permissions}
	id, err := h.Auth.CreateRole(c.Context(), r)
	if err != nil {
		return badRequest(c, "创建角色失败: "+err.Error())
	}
	r.ID = id
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": r})
}

// updateRole PUT /roles/:id
func (h *Handlers) updateRole(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	var req roleRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if err := h.Auth.UpdateRole(c.Context(), id, req.Description, req.Permissions); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

// deleteRole DELETE /roles/:id
func (h *Handlers) deleteRole(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	if err := h.Auth.DeleteRole(c.Context(), id); err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}
