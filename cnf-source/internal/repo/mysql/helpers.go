package mysql

import (
	"database/sql"

	"github.com/google/uuid"
)

// nullInt 把 *int 转为 sql.NullInt64（nil → NULL）。
func nullInt(p *int) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(*p), Valid: true}
}

// nullZeroInt 把 int 转为 sql.NullInt64（0 → NULL）。
func nullZeroInt(v int) sql.NullInt64 {
	if v == 0 {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(v), Valid: true}
}

// nullStr 把 string 转为 sql.NullString（"" → NULL）。
func nullStr(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

// uuidParse 宽松解析 UUID 字符串，失败返回零值。
func uuidParse(s string) uuid.UUID {
	u, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil
	}
	return u
}

// intPtr 返回 NullInt64 对应的 *int（NULL → nil）。
func intPtr(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}
