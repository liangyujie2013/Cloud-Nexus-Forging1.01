// Package config 加载 CNFv1.0 运行配置（环境变量优先，回退默认值）。
package config

import (
	"os"
)

// Config 控制面配置。
type Config struct {
	ListenAddr  string
	DatabaseURL string
	RedisURL    string
	EtcdURL     string
	JWTSecret   string
}

// Load 从环境变量加载配置。
func Load() (*Config, error) {
	return &Config{
		ListenAddr:  envOr("CNF_LISTEN_ADDR", ":8080"),
		DatabaseURL: envOr("CNF_DATABASE_URL", "postgres://cnf:cnf@127.0.0.1:5432/cnfv1?sslmode=disable"),
		RedisURL:    envOr("CNF_REDIS_URL", "redis://127.0.0.1:6379/0"),
		EtcdURL:     envOr("CNF_ETCD_URL", "http://127.0.0.1:2379"),
		JWTSecret:   envOr("CNF_JWT_SECRET", "change-me-in-production"),
	}, nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
