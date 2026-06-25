// Package mysql 提供 service.Repository 接口的 MySQL 8.0 / MariaDB 实现。
// 使用标准库 database/sql + go-sql-driver/mysql；
//   - 占位符 ?            （非 PG 的 $1）
//   - 自增主键 + LastInsertId
//   - UUID 由应用层生成（CHAR(36)）
//   - JSON 列经 json.Marshal/Unmarshal
//   - UPSERT 用 INSERT ... ON DUPLICATE KEY UPDATE（VALUES() 兼容 MariaDB）
package mysql

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	_ "github.com/go-sql-driver/mysql"
)

// ErrHasChildren 删除层级资源时，存在下级资源（如 DC 下仍有 cluster）。
var ErrHasChildren = errors.New("资源存在下级依赖，无法删除")

// Repository 基于 *sql.DB 的 Repository 实现。
type Repository struct {
	db *sql.DB
}

// New 用已建立的 *sql.DB 构造仓储。
func New(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// NewFromDSN 从 DSN 建立连接池并 Ping 验证。
//
//	dsn 示例：cnf:cnf@tcp(127.0.0.1:3306)/cnf?parseTime=true&charset=utf8mb4&loc=Local
func NewFromDSN(ctx context.Context, dsn string, maxOpen, maxIdle int) (*Repository, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("打开 MySQL 连接失败: %w", err)
	}
	if maxOpen <= 0 {
		maxOpen = 20
	}
	if maxIdle <= 0 {
		maxIdle = 5
	}
	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(maxIdle)
	db.SetConnMaxLifetime(time.Hour)

	pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.PingContext(pctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("MySQL ping 失败: %w", err)
	}
	return &Repository{db: db}, nil
}

// DB 暴露底层连接池，供 auth/层级/存储/网络等模块复用。
func (r *Repository) DB() *sql.DB { return r.db }

// Close 关闭连接池。
func (r *Repository) Close() error {
	if r.db != nil {
		return r.db.Close()
	}
	return nil
}

// withTx 在事务中执行 fn，自动提交/回滚。
func (r *Repository) withTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// ----------------------------------------------------------------------------
// 通用辅助
// ----------------------------------------------------------------------------

// scanner 抽象 *sql.Row 与 *sql.Rows 的 Scan。
type scanner interface {
	Scan(dest ...any) error
}

// mustJSON 序列化为 JSON 字节；空值按 emptyArray 决定返回 [] 还是 {}。
func mustJSON(v any, emptyArray bool) []byte {
	if v == nil {
		if emptyArray {
			return []byte("[]")
		}
		return []byte("{}")
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		if emptyArray {
			return []byte("[]")
		}
		return []byte("{}")
	}
	return b
}

// scanJSON 反序列化 JSON 字节到 v；空字节安全跳过。
func scanJSON(b []byte, v any) error {
	if len(b) == 0 {
		return nil
	}
	return json.Unmarshal(b, v)
}

// newUUIDOr 返回给定 UUID 的字符串；零值时生成新 UUID。
func newUUIDOr(u uuid.UUID) string {
	if u == uuid.Nil {
		return uuid.NewString()
	}
	return u.String()
}

// newUUIDOr0 返回非零 UUID 字符串，否则返回新 UUID 字符串。
func newUUIDOr0(u *uuid.UUID) string {
	if u == nil || *u == uuid.Nil {
		return uuid.NewString()
	}
	return u.String()
}
