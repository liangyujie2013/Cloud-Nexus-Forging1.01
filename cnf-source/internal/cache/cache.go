// Package cache 封装 Redis 7 客户端，提供 CNF 控制面所需的三类能力：
//
//	1. 通用缓存       —— Get/Set/Del/GetJSON/SetJSON
//	2. 分布式锁       —— TryLock/Unlock/Renew（HA 选主、并发操作互斥）
//	3. 指标缓冲       —— PushMetric/RangeMetrics（SSE 监控的滑动窗口）
//
// 所有方法均接受 context，单节点与 HA 多节点共用同一实现。
package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// ErrLockNotHeld 续租/释放时本节点已不再持有锁。
var ErrLockNotHeld = errors.New("锁未被本节点持有")

// Client 是对 *redis.Client 的轻量封装。
type Client struct {
	rdb *redis.Client
}

// New 用环境配置建立 Redis 连接并 Ping 验证。
func New(ctx context.Context, addr, password string, db int) (*Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DB:           db,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		PoolSize:     20,
	})
	pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := rdb.Ping(pctx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("Redis ping 失败: %w", err)
	}
	return &Client{rdb: rdb}, nil
}

// Raw 暴露底层客户端，供高级用法（pub/sub 等）使用。
func (c *Client) Raw() *redis.Client { return c.rdb }

// Close 关闭连接。
func (c *Client) Close() error { return c.rdb.Close() }

// ----------------------------------------------------------------------------
// 通用缓存
// ----------------------------------------------------------------------------

// Set 写入字符串值，ttl<=0 表示不过期。
func (c *Client) Set(ctx context.Context, key, val string, ttl time.Duration) error {
	return c.rdb.Set(ctx, key, val, ttl).Err()
}

// Get 读取字符串值；键不存在返回 ("", false, nil)。
func (c *Client) Get(ctx context.Context, key string) (string, bool, error) {
	v, err := c.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// Del 删除一个或多个键。
func (c *Client) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	return c.rdb.Del(ctx, keys...).Err()
}

// SetJSON 序列化对象后写入。
func (c *Client) SetJSON(ctx context.Context, key string, v any, ttl time.Duration) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.rdb.Set(ctx, key, b, ttl).Err()
}

// GetJSON 读取并反序列化到 dest；键不存在返回 (false, nil)。
func (c *Client) GetJSON(ctx context.Context, key string, dest any) (bool, error) {
	b, err := c.rdb.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal(b, dest)
}

// ----------------------------------------------------------------------------
// 分布式锁（基于 SET NX PX + Lua 原子校验，用于 HA 选主与互斥操作）
// ----------------------------------------------------------------------------

// 释放/续租脚本：仅当 value 与本节点 token 一致时才操作，避免误删他人锁。
var (
	unlockScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
else
	return 0
end`)

	renewScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
	return 0
end`)
)

// TryLock 尝试以 token 获取 key 锁，持有时长 ttl。
// 成功返回 (true,nil)；锁已被他人持有返回 (false,nil)。
func (c *Client) TryLock(ctx context.Context, key, token string, ttl time.Duration) (bool, error) {
	return c.rdb.SetNX(ctx, key, token, ttl).Result()
}

// Renew 续租：仅当本节点仍持有锁时才延长 TTL。
func (c *Client) Renew(ctx context.Context, key, token string, ttl time.Duration) error {
	res, err := renewScript.Run(ctx, c.rdb, []string{key}, token, ttl.Milliseconds()).Int64()
	if err != nil {
		return err
	}
	if res == 0 {
		return ErrLockNotHeld
	}
	return nil
}

// Unlock 释放锁：仅当本节点持有时才删除。
func (c *Client) Unlock(ctx context.Context, key, token string) error {
	res, err := unlockScript.Run(ctx, c.rdb, []string{key}, token).Int64()
	if err != nil {
		return err
	}
	if res == 0 {
		return ErrLockNotHeld
	}
	return nil
}

// LockOwner 返回当前持锁者 token；无人持有返回 ("", false, nil)。
func (c *Client) LockOwner(ctx context.Context, key string) (string, bool, error) {
	return c.Get(ctx, key)
}

// ----------------------------------------------------------------------------
// 指标缓冲（每个目标维护一个有界的时间序列，供 SSE 实时监控）
// ----------------------------------------------------------------------------

// metricKey 构造目标的指标 List 键。
func metricKey(target string) string { return "cnf:metrics:" + target }

// PushMetric 追加一条 JSON 指标采样，并裁剪到最近 maxLen 条。
func (c *Client) PushMetric(ctx context.Context, target string, sample any, maxLen int64) error {
	b, err := json.Marshal(sample)
	if err != nil {
		return err
	}
	key := metricKey(target)
	pipe := c.rdb.TxPipeline()
	pipe.RPush(ctx, key, b)
	if maxLen > 0 {
		pipe.LTrim(ctx, key, -maxLen, -1)
	}
	pipe.Expire(ctx, key, 1*time.Hour)
	_, err = pipe.Exec(ctx)
	return err
}

// RangeMetrics 返回目标最近 n 条原始 JSON 采样（n<=0 返回全部）。
func (c *Client) RangeMetrics(ctx context.Context, target string, n int64) ([][]byte, error) {
	key := metricKey(target)
	start := int64(0)
	if n > 0 {
		start = -n
	}
	vals, err := c.rdb.LRange(ctx, key, start, -1).Result()
	if err != nil {
		return nil, err
	}
	out := make([][]byte, 0, len(vals))
	for _, v := range vals {
		out = append(out, []byte(v))
	}
	return out, nil
}
