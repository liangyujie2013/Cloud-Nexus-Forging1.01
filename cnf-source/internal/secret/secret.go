// Package secret 提供落库敏感信息的对称加密（AES-256-GCM 认证加密）。
//
// 用途：主机纳管时把 SSH 口令/私钥加密后存入数据库，后续防火墙/SELinux/改密码/
// 实时监控等功能需要再次 SSH 登录时解密复用，避免每次操作都让用户重输口令。
//
// 设计要点：
//   - AES-256-GCM：认证加密，既保密又防篡改（密文被改动解密会失败）。
//   - 每次加密生成随机 nonce（12 字节），与密文一起存储/编码，绝不复用。
//   - 密钥来源：优先 CNF_SECRET_KEY（任意长度字符串，内部 SHA-256 归一到 32 字节）；
//     未配置则从 JWTSecret 派生，保证开发环境可用（生产应显式配置高熵密钥）。
//   - 编码：EncryptToString 输出 base64(nonce||ciphertext)，便于直接落 VARCHAR/TEXT。
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

// Cipher 一个已初始化的 AES-256-GCM 加解密器。
type Cipher struct {
	aead cipher.AEAD
}

// New 用任意长度的密钥材料构造 Cipher（内部用 SHA-256 归一到 32 字节 = AES-256）。
func New(keyMaterial string) (*Cipher, error) {
	if keyMaterial == "" {
		return nil, errors.New("加密密钥材料不能为空")
	}
	sum := sha256.Sum256([]byte(keyMaterial))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, fmt.Errorf("初始化 AES 失败: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("初始化 GCM 失败: %w", err)
	}
	return &Cipher{aead: aead}, nil
}

// Encrypt 加密明文，返回 nonce||ciphertext 的原始字节。
func (c *Cipher) Encrypt(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("生成 nonce 失败: %w", err)
	}
	// Seal 把 nonce 作为前缀（dst=nonce），密文与认证标签追加其后。
	return c.aead.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt 解密 nonce||ciphertext 字节。
func (c *Cipher) Decrypt(blob []byte) ([]byte, error) {
	ns := c.aead.NonceSize()
	if len(blob) < ns {
		return nil, errors.New("密文长度不足，无法解密")
	}
	nonce, ct := blob[:ns], blob[ns:]
	pt, err := c.aead.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, fmt.Errorf("解密失败（密钥不匹配或数据被篡改）: %w", err)
	}
	return pt, nil
}

// EncryptToString 加密并 base64 编码，便于直接落库为字符串。
func (c *Cipher) EncryptToString(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	blob, err := c.Encrypt([]byte(plaintext))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(blob), nil
}

// DecryptFromString 解码 base64 并解密，返回明文。空串原样返回空串。
func (c *Cipher) DecryptFromString(s string) (string, error) {
	if s == "" {
		return "", nil
	}
	blob, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return "", fmt.Errorf("base64 解码失败: %w", err)
	}
	pt, err := c.Decrypt(blob)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
