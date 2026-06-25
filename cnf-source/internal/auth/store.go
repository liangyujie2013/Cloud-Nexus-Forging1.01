package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/cnf/cnfv1/internal/model"
)

// ErrUserNotFound 用户不存在。
var ErrUserNotFound = errors.New("用户不存在")

// ErrBadCredentials 用户名或密码错误。
var ErrBadCredentials = errors.New("用户名或密码错误")

// ErrUserDisabled 账户已禁用。
var ErrUserDisabled = errors.New("账户已禁用")

// Store 基于 MySQL 的用户/角色仓储。
type Store struct {
	db *sql.DB
}

// NewStore 构造鉴权仓储。
func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// HashPassword 生成 bcrypt 口令哈希。
func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(b), err
}

// ----------------------------------------------------------------------------
// 用户
// ----------------------------------------------------------------------------

const userColumns = `id, username, COALESCE(display_name,''), COALESCE(email,''),
	password_hash, role_id, COALESCE(role,''), enabled, last_login, created_at, updated_at`

func scanUser(s interface{ Scan(...any) error }) (*model.User, error) {
	var (
		u      model.User
		roleID sql.NullInt64
		last   sql.NullTime
	)
	if err := s.Scan(
		&u.ID, &u.Username, &u.DisplayName, &u.Email,
		&u.PasswordHash, &roleID, &u.Role, &u.Enabled, &last, &u.CreatedAt, &u.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if roleID.Valid {
		v := int(roleID.Int64)
		u.RoleID = &v
	}
	if last.Valid {
		u.LastLogin = &last.Time
	}
	return &u, nil
}

// GetUserByName 按用户名查询。
func (s *Store) GetUserByName(ctx context.Context, username string) (*model.User, error) {
	u, err := scanUser(s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM users WHERE username=?`, username))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	return u, err
}

// GetUser 按 id 查询。
func (s *Store) GetUser(ctx context.Context, id int) (*model.User, error) {
	u, err := scanUser(s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM users WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	return u, err
}

// ListUsers 列出全部用户。
func (s *Store) ListUsers(ctx context.Context) ([]model.User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+userColumns+` FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

// CreateUser 新建用户（明文口令将被哈希）。
func (s *Store) CreateUser(ctx context.Context, u *model.User, plainPassword string) (int, error) {
	hash, err := HashPassword(plainPassword)
	if err != nil {
		return 0, err
	}
	var roleID sql.NullInt64
	if u.RoleID != nil {
		roleID = sql.NullInt64{Int64: int64(*u.RoleID), Valid: true}
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO users (username, display_name, email, password_hash, role_id, role, enabled)
		 VALUES (?,?,?,?,?,?,?)`,
		u.Username, nullStr(u.DisplayName), nullStr(u.Email), hash, roleID, nullStr(u.Role), u.Enabled)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return int(id), nil
}

// UpdatePassword 重置口令。
func (s *Store) UpdatePassword(ctx context.Context, id int, plainPassword string) error {
	hash, err := HashPassword(plainPassword)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE users SET password_hash=? WHERE id=?`, hash, id)
	return err
}

// SetEnabled 启用/禁用账户。
func (s *Store) SetEnabled(ctx context.Context, id int, enabled bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE users SET enabled=? WHERE id=?`, enabled, id)
	return err
}

// DeleteUser 删除用户。
func (s *Store) DeleteUser(ctx context.Context, id int) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE id=?`, id)
	return err
}

// Authenticate 校验用户名口令；成功返回用户并更新 last_login。
func (s *Store) Authenticate(ctx context.Context, username, password string) (*model.User, error) {
	u, err := s.GetUserByName(ctx, username)
	if errors.Is(err, ErrUserNotFound) {
		return nil, ErrBadCredentials
	}
	if err != nil {
		return nil, err
	}
	if !u.Enabled {
		return nil, ErrUserDisabled
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return nil, ErrBadCredentials
	}
	now := time.Now()
	_, _ = s.db.ExecContext(ctx, `UPDATE users SET last_login=? WHERE id=?`, now, u.ID)
	u.LastLogin = &now
	return u, nil
}

// ----------------------------------------------------------------------------
// 角色
// ----------------------------------------------------------------------------

func scanRole(s interface{ Scan(...any) error }) (*model.Role, error) {
	var (
		r     model.Role
		perms sql.RawBytes
	)
	if err := s.Scan(&r.ID, &r.Name, &r.Description, &perms, &r.IsBuiltin, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	if len(perms) > 0 {
		_ = json.Unmarshal([]byte(perms), &r.Permissions)
	}
	if r.Permissions == nil {
		r.Permissions = []string{}
	}
	return &r, nil
}

const roleColumns = `id, name, COALESCE(description,''), permissions, is_builtin, created_at, updated_at`

// GetRoleByName 按名称查询角色。
func (s *Store) GetRoleByName(ctx context.Context, name string) (*model.Role, error) {
	r, err := scanRole(s.db.QueryRowContext(ctx,
		`SELECT `+roleColumns+` FROM roles WHERE name=?`, name))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("角色不存在")
	}
	return r, err
}

// ListRoles 列出全部角色。
func (s *Store) ListRoles(ctx context.Context) ([]model.Role, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+roleColumns+` FROM roles ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Role
	for rows.Next() {
		r, err := scanRole(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// CreateRole 新建角色。
func (s *Store) CreateRole(ctx context.Context, r *model.Role) (int, error) {
	perms, _ := json.Marshal(r.Permissions)
	if len(perms) == 0 {
		perms = []byte("[]")
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO roles (name, description, permissions, is_builtin) VALUES (?,?,?,?)`,
		r.Name, nullStr(r.Description), perms, r.IsBuiltin)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return int(id), nil
}

// UpdateRole 更新角色权限点（内置角色不可改）。
func (s *Store) UpdateRole(ctx context.Context, id int, description string, permissions []string) error {
	perms, _ := json.Marshal(permissions)
	if len(perms) == 0 {
		perms = []byte("[]")
	}
	_, err := s.db.ExecContext(ctx,
		`UPDATE roles SET description=?, permissions=? WHERE id=? AND is_builtin=0`,
		nullStr(description), perms, id)
	return err
}

// DeleteRole 删除非内置角色。
func (s *Store) DeleteRole(ctx context.Context, id int) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM roles WHERE id=? AND is_builtin=0`, id)
	return err
}

func nullStr(v string) sql.NullString {
	if v == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: v, Valid: true}
}
