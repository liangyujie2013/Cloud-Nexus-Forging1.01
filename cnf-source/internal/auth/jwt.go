// Package auth 实现 CNF 的鉴权与 RBAC：
//
//	jwt.go        —— JWT（HS256）签发与校验
//	store.go      —— 用户/角色持久化（MySQL）+ bcrypt 口令校验
//	middleware.go —— Fiber 中间件：解析 Bearer Token、注入身份、按权限点放行
package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrInvalidToken Token 非法或过期。
var ErrInvalidToken = errors.New("token 无效或已过期")

// Claims 自定义 JWT 载荷：携带用户身份与角色名。
type Claims struct {
	UserID   int    `json:"uid"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// TokenManager 负责 JWT 的签发与校验。
type TokenManager struct {
	secret      []byte
	expireHours int
}

// NewTokenManager 构造 Token 管理器。
func NewTokenManager(secret string, expireHours int) *TokenManager {
	if expireHours <= 0 {
		expireHours = 24
	}
	return &TokenManager{secret: []byte(secret), expireHours: expireHours}
}

// Generate 为用户签发 Token。
func (m *TokenManager) Generate(userID int, username, role string) (string, time.Time, error) {
	now := time.Now()
	exp := now.Add(time.Duration(m.expireHours) * time.Hour)
	claims := Claims{
		UserID:   userID,
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   username,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
			Issuer:    "cnf",
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(m.secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, exp, nil
}

// Parse 校验并解析 Token。
func (m *TokenManager) Parse(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	tok, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("非预期的签名算法: %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil || !tok.Valid {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
