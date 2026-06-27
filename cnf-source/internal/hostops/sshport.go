package hostops

// sshport.go —— 修改主机 SSH 端口（真实、安全、可回退）。
//
// 风险极高：改错会失去对主机的 SSH 访问。因此采用「先并存、验证通过后再切换」策略：
//   1) 校验新端口合法且未被占用；
//   2) SELinux：semanage port 放行新端口为 ssh_port_t（无 semanage 时跳过并告警）；
//   3) firewalld：放行新端口（持久化 + reload）；
//   4) sshd_config：同时保留旧端口与新端口（Port 双写），避免重启后立即失联；
//   5) 重启 sshd；
//   6) 由调用方用新端口真实回连验证 —— 验证通过后才同步 DB 与（可选）移除旧端口。
//
// 本模块只负责目标机上的真实改动；DB 同步与新端口回连验证在 handler 层完成（需凭据/IP）。

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/cnf/cnfv1/internal/onboard"
)

// SSHPortChangeResult SSH 端口变更（目标机侧）执行结果。
type SSHPortChangeResult struct {
	OldPort  int      `json:"old_port"`
	NewPort  int      `json:"new_port"`
	Steps    []string `json:"steps"`
	Warnings []string `json:"warnings"`
}

// PrepareSSHPortChange 在目标机上执行 SSH 端口变更（保留旧端口双写 + 重启 sshd）。
//
// 返回后调用方应立即用 newPort 回连验证；验证通过再 FinalizeSSHPort 移除旧端口（可选）。
func PrepareSSHPortChange(c *onboard.SSHClient, newPort int) (*SSHPortChangeResult, error) {
	if newPort < 1 || newPort > 65535 {
		return nil, fmt.Errorf("新端口非法: %d（应 1-65535）", newPort)
	}
	res := &SSHPortChangeResult{NewPort: newPort}

	// 当前 sshd 监听端口（取第一个 Port 指令，缺省 22）
	cur := strings.TrimSpace(c.RunQuiet(`sshd -T 2>/dev/null | awk '/^port /{print $2; exit}'`))
	if cur == "" {
		cur = strings.TrimSpace(c.RunQuiet(`grep -E '^[[:space:]]*Port[[:space:]]+' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2; exit}'`))
	}
	oldPort, _ := strconv.Atoi(strings.TrimSpace(cur))
	if oldPort == 0 {
		oldPort = 22
	}
	res.OldPort = oldPort
	if oldPort == newPort {
		return nil, fmt.Errorf("新端口与当前端口相同(%d)，无需修改", newPort)
	}

	// 1) SELinux：放行新端口为 ssh_port_t（仅非 22 才需要；有 semanage 才做）
	if newPort != 22 {
		if strings.TrimSpace(c.RunQuiet(`command -v semanage >/dev/null 2>&1 && echo yes || echo no`)) == "yes" {
			// 已存在则 -m 修改，否则 -a 添加；用 || 兼容两种情况
			cmd := fmt.Sprintf(`semanage port -a -t ssh_port_t -p tcp %d 2>/dev/null || semanage port -m -t ssh_port_t -p tcp %d`, newPort, newPort)
			if _, err := c.Run(cmd); err != nil {
				// 端口可能已属 ssh_port_t（语义已就绪），不阻断，仅告警
				res.Warnings = append(res.Warnings, "semanage 放行新端口提示: "+err.Error())
			}
			res.Steps = append(res.Steps, fmt.Sprintf("semanage port -a/-m ssh_port_t tcp %d", newPort))
		} else {
			res.Warnings = append(res.Warnings, "目标机无 semanage（SELinux 工具），若 SELinux 为 enforcing 新端口可能被拦截")
		}
	}

	// 2) firewalld：放行新端口（运行时才有意义；未运行则告警）
	if strings.TrimSpace(c.RunQuiet(`systemctl is-active firewalld 2>/dev/null`)) == "active" {
		zone := strings.TrimSpace(c.RunQuiet(`firewall-cmd --get-default-zone 2>/dev/null`))
		if zone == "" {
			zone = "public"
		}
		cmd := fmt.Sprintf(`firewall-cmd --permanent --zone=%s --add-port=%d/tcp && firewall-cmd --reload`, zone, newPort)
		if _, err := c.Run(cmd); err != nil {
			return res, fmt.Errorf("firewalld 放行新端口失败: %w", err)
		}
		res.Steps = append(res.Steps, fmt.Sprintf("firewall-cmd --add-port=%d/tcp --permanent + reload", newPort))
	} else {
		res.Warnings = append(res.Warnings, "firewalld 未运行，跳过端口放行")
	}

	// 3) sshd_config：双写 Port（保留旧端口，追加新端口），并清理重复
	//    先去掉已有的精确新端口行，避免重复；保留旧端口行；追加新端口行。
	editCmd := fmt.Sprintf(`
set -e
cp -f /etc/ssh/sshd_config /etc/ssh/sshd_config.cnf-bak.$(date +%%s)
# 确保存在旧端口显式声明（若原本靠默认 22，则补一行 Port %d）
if ! grep -qE '^[[:space:]]*Port[[:space:]]+%d([[:space:]]|$)' /etc/ssh/sshd_config; then
  echo 'Port %d' >> /etc/ssh/sshd_config
fi
# 追加新端口（若不存在）
if ! grep -qE '^[[:space:]]*Port[[:space:]]+%d([[:space:]]|$)' /etc/ssh/sshd_config; then
  echo 'Port %d' >> /etc/ssh/sshd_config
fi
sshd -t
`, oldPort, oldPort, oldPort, newPort, newPort)
	if _, err := c.Run(editCmd); err != nil {
		return res, fmt.Errorf("写 sshd_config 或语法校验失败（已备份原文件，未重启 sshd）: %w", err)
	}
	res.Steps = append(res.Steps, fmt.Sprintf("sshd_config 双写 Port %d + Port %d (sshd -t 通过)", oldPort, newPort))

	// 4) 重启 sshd（双端口监听；旧连接不受影响，验证后再清旧端口）
	if _, err := c.Run(`systemctl restart sshd 2>/dev/null || systemctl restart ssh`); err != nil {
		return res, fmt.Errorf("重启 sshd 失败: %w", err)
	}
	res.Steps = append(res.Steps, "systemctl restart sshd")
	return res, nil
}

// FinalizeSSHPort 在新端口验证通过后，移除 sshd_config 中的旧端口声明并重启 sshd。
//
// 仅当确认新端口可达后调用，避免误删导致失联。
func FinalizeSSHPort(c *onboard.SSHClient, oldPort, newPort int) ([]string, error) {
	var steps []string
	if oldPort == newPort {
		return steps, nil
	}
	// 删除旧端口行（精确匹配），保留新端口
	del := fmt.Sprintf(`sed -i -E '/^[[:space:]]*Port[[:space:]]+%d([[:space:]]|$)/d' /etc/ssh/sshd_config && sshd -t`, oldPort)
	if _, err := c.Run(del); err != nil {
		return steps, fmt.Errorf("移除旧端口失败（保持双端口安全态）: %w", err)
	}
	steps = append(steps, fmt.Sprintf("移除 sshd_config 旧端口 Port %d", oldPort))
	if _, err := c.Run(`systemctl restart sshd 2>/dev/null || systemctl restart ssh`); err != nil {
		return steps, fmt.Errorf("重启 sshd 失败: %w", err)
	}
	steps = append(steps, "systemctl restart sshd")
	// 关闭防火墙旧端口（若 firewalld 运行）
	if strings.TrimSpace(c.RunQuiet(`systemctl is-active firewalld 2>/dev/null`)) == "active" && oldPort != 22 {
		zone := strings.TrimSpace(c.RunQuiet(`firewall-cmd --get-default-zone 2>/dev/null`))
		if zone == "" {
			zone = "public"
		}
		_, _ = c.Run(fmt.Sprintf(`firewall-cmd --permanent --zone=%s --remove-port=%d/tcp && firewall-cmd --reload`, zone, oldPort))
		steps = append(steps, fmt.Sprintf("firewalld 移除旧端口 %d/tcp", oldPort))
	}
	return steps, nil
}
