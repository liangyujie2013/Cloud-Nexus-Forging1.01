// Package config 加载 CNF v1.0.1 运行配置（环境变量优先，回退合理默认值）。
//
// 持久化：MySQL 8.0 / MariaDB（主数据）+ Redis 7（缓存 / 分布式锁 / 指标缓冲）。
// 部署形态：单节点 与 HA 多节点（基于 Redis 锁选主）皆支持。
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Version 产品版本号。打包与 /api/v1/version 均引用此常量。
const Version = "1.0.1"

// Config 控制面运行配置。
type Config struct {
	// 服务监听
	ListenAddr string

	// MySQL / MariaDB
	MySQLDSN     string // go-sql-driver DSN，例：cnf:cnf@tcp(127.0.0.1:3306)/cnf?parseTime=true&charset=utf8mb4&loc=Local
	MySQLMaxOpen int
	MySQLMaxIdle int

	// Redis
	RedisAddr     string // host:port
	RedisPassword string
	RedisDB       int

	// 鉴权 / RBAC
	JWTSecret      string
	JWTExpireHours int

	// 高可用
	HAEnabled     bool
	NodeID        string        // 集群内本节点唯一标识；未设置时回退主机名
	HALeaseTTL    time.Duration // 选主租约 TTL
	HARenewPeriod time.Duration // 续租周期

	// libvirt 默认连接方式（host 表内可逐主机覆盖）
	LibvirtTransport string // tcp | tls | ssh
	LibvirtPort      int

	// 数据库迁移目录
	MigrationsDir string

	// 默认本地存储池根目录（qcow2 系统盘存放路径）。
	// 真实创建 VM 时，未显式指定存储池则使用此目录下的 LocalDriver。
	StorageLocalPath string
}

// Load 从环境变量加载配置（带默认值），并做基本校验。
func Load() (*Config, error) {
	c := &Config{
		ListenAddr: envOr("CNF_LISTEN_ADDR", ":8080"),

		MySQLDSN:     envOr("CNF_MYSQL_DSN", "cnf:cnf@tcp(127.0.0.1:3306)/cnf?parseTime=true&charset=utf8mb4&loc=Local"),
		MySQLMaxOpen: envInt("CNF_MYSQL_MAX_OPEN", 20),
		MySQLMaxIdle: envInt("CNF_MYSQL_MAX_IDLE", 5),

		RedisAddr:     envOr("CNF_REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword: envOr("CNF_REDIS_PASSWORD", ""),
		RedisDB:       envInt("CNF_REDIS_DB", 0),

		JWTSecret:      envOr("CNF_JWT_SECRET", "change-me-in-production"),
		JWTExpireHours: envInt("CNF_JWT_EXPIRE_HOURS", 24),

		HAEnabled:     envBool("CNF_HA_ENABLED", false),
		NodeID:        envOr("CNF_NODE_ID", defaultNodeID()),
		HALeaseTTL:    time.Duration(envInt("CNF_HA_LEASE_TTL_SEC", 15)) * time.Second,
		HARenewPeriod: time.Duration(envInt("CNF_HA_RENEW_SEC", 5)) * time.Second,

		LibvirtTransport: envOr("CNF_LIBVIRT_TRANSPORT", "tcp"),
		LibvirtPort:      envInt("CNF_LIBVIRT_PORT", 16509),

		MigrationsDir: envOr("CNF_MIGRATIONS_DIR", "migrations/mysql"),

		StorageLocalPath: envOr("CNF_STORAGE_LOCAL_PATH", "/var/lib/cnf/images"),
	}

	if err := c.validate(); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *Config) validate() error {
	if c.MySQLDSN == "" {
		return fmt.Errorf("CNF_MYSQL_DSN 不能为空")
	}
	if !strings.Contains(c.MySQLDSN, "parseTime=true") {
		// go-sql-driver 默认把 DATETIME/TIMESTAMP 扫描为 []byte，需 parseTime=true 才能映射 time.Time。
		return fmt.Errorf("CNF_MYSQL_DSN 必须包含 parseTime=true")
	}
	if c.JWTSecret == "" {
		return fmt.Errorf("CNF_JWT_SECRET 不能为空")
	}
	if c.HARenewPeriod >= c.HALeaseTTL {
		return fmt.Errorf("HA 续租周期(%s)必须小于租约 TTL(%s)", c.HARenewPeriod, c.HALeaseTTL)
	}
	switch c.LibvirtTransport {
	case "tcp", "tls", "ssh":
	default:
		return fmt.Errorf("CNF_LIBVIRT_TRANSPORT 仅支持 tcp/tls/ssh，得到 %q", c.LibvirtTransport)
	}
	return nil
}

func defaultNodeID() string {
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return "cnf-node"
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
