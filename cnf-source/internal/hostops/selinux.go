package hostops

// selinux.go —— 主机 SELinux 真实运维：读当前态 / 设置运行时模式 / 持久化到 /etc/selinux/config。
//
// 设计原则（呼应「不要 mock / 清晰报错 / 联动性」）：
//   - 运行时态来自 getenforce；持久态来自 /etc/selinux/config 的 SELINUX= 行，均真实读取。
//   - setenforce 仅能在 enforcing↔permissive 间即时切换；切到/从 disabled 必须改配置并重启，
//     绝不伪造「即时已禁用/已启用」。需要重启时明确返回 reboot_required=true 并说明。
//   - 任一步失败返回明确错误与已执行步骤。

import (
	"fmt"
	"strings"

	"github.com/cnf/cnfv1/internal/onboard"
)

// SELinuxState SELinux 当前状态（真实读取）。
type SELinuxState struct {
	Available  bool   `json:"available"`   // 系统是否支持 SELinux（getenforce 是否存在）
	Current    string `json:"current"`     // 运行时：enforcing | permissive | disabled
	Persistent string `json:"persistent"`  // 持久(/etc/selinux/config)：enforcing | permissive | disabled
	Consistent bool   `json:"consistent"`  // 运行时与持久是否一致
	Warnings   []string `json:"warnings"`
}

// CollectSELinux 读取目标主机 SELinux 真实状态（运行时 + 持久）。
func CollectSELinux(c *onboard.SSHClient) (*SELinuxState, error) {
	st := &SELinuxState{}
	if strings.TrimSpace(c.RunQuiet(`command -v getenforce >/dev/null 2>&1 && echo yes || echo no`)) != "yes" {
		st.Available = false
		st.Warnings = append(st.Warnings, "目标主机不支持 SELinux（getenforce 不存在）")
		return st, nil
	}
	st.Available = true
	st.Current = strings.ToLower(strings.TrimSpace(c.RunQuiet(`getenforce 2>/dev/null`)))
	// 持久态：读 /etc/selinux/config 的 SELINUX= 行
	cfg := strings.TrimSpace(c.RunQuiet(`grep -E '^SELINUX=' /etc/selinux/config 2>/dev/null | head -1 | cut -d= -f2`))
	st.Persistent = strings.ToLower(strings.TrimSpace(cfg))
	if st.Persistent == "" {
		st.Persistent = st.Current
		st.Warnings = append(st.Warnings, "未能读取 /etc/selinux/config 持久配置，以运行时态近似")
	}
	st.Consistent = st.Current == st.Persistent
	return st, nil
}

// SELinuxResult SELinux 设置结果。
type SELinuxResult struct {
	Steps          []string `json:"steps"`
	Current        string   `json:"current"`         // 设置后的运行时态
	Persistent     string   `json:"persistent"`      // 设置后的持久态
	RebootRequired bool     `json:"reboot_required"` // 是否需重启才完全生效
	Message        string   `json:"message"`
}

// normMode 规范化模式取值。
func normMode(m string) (string, error) {
	m = strings.ToLower(strings.TrimSpace(m))
	switch m {
	case "enforcing", "permissive", "disabled":
		return m, nil
	default:
		return "", fmt.Errorf("非法 SELinux 模式: %q（仅 enforcing/permissive/disabled）", m)
	}
}

// SetSELinux 设置 SELinux 模式，运行时（尽力）+ 持久化到配置文件。
//
// 规则（真实、不伪造）：
//   - 目标 enforcing/permissive 且当前非 disabled：setenforce 立即生效 + 改配置持久化。
//   - 目标 disabled：setenforce 无法即时禁用 → 仅改配置，reboot_required=true。
//   - 当前 disabled、目标 enforcing/permissive：setenforce 在 disabled 下无效 →
//     仅改配置，reboot_required=true。
func SetSELinux(c *onboard.SSHClient, mode string) (*SELinuxResult, error) {
	m, err := normMode(mode)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(c.RunQuiet(`command -v getenforce >/dev/null 2>&1 && echo yes || echo no`)) != "yes" {
		return nil, fmt.Errorf("目标主机不支持 SELinux，无法设置")
	}
	cur := strings.ToLower(strings.TrimSpace(c.RunQuiet(`getenforce 2>/dev/null`)))
	res := &SELinuxResult{}

	// 1) 运行时切换（仅 enforcing↔permissive 且当前非 disabled 时可即时生效）
	runtimeApplied := false
	if cur != "disabled" && (m == "enforcing" || m == "permissive") {
		flag := "1"
		if m == "permissive" {
			flag = "0"
		}
		if _, e := c.Run(`setenforce ` + flag); e != nil {
			return res, fmt.Errorf("setenforce 失败: %w", e)
		}
		res.Steps = append(res.Steps, "setenforce "+flag)
		runtimeApplied = true
	}

	// 2) 持久化：改写 /etc/selinux/config 的 SELINUX= 行
	persistCmd := fmt.Sprintf(`test -f /etc/selinux/config && sed -i -E 's/^SELINUX=.*/SELINUX=%s/' /etc/selinux/config`, m)
	if _, e := c.Run(persistCmd); e != nil {
		return res, fmt.Errorf("持久化 SELinux 配置失败: %w", e)
	}
	res.Steps = append(res.Steps, "sed -i 's/^SELINUX=.*/SELINUX="+m+"/' /etc/selinux/config")
	res.Persistent = m

	// 3) 判定是否需要重启
	res.Current = strings.ToLower(strings.TrimSpace(c.RunQuiet(`getenforce 2>/dev/null`)))
	if m == "disabled" {
		// disabled 必须重启才生效（运行时无法即时禁用）
		res.RebootRequired = res.Current != "disabled"
	} else if cur == "disabled" {
		// 从 disabled 启用，需重启
		res.RebootRequired = true
	} else {
		res.RebootRequired = !runtimeApplied
	}

	if res.RebootRequired {
		res.Message = "已写入持久配置（SELINUX=" + m + "），需重启主机后完全生效"
	} else {
		res.Message = "SELinux 已切换为 " + m + " 并已持久化"
	}
	return res, nil
}
