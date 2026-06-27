package hostops

// power.go —— 主机电源与维护模式的真实运维能力（通过 SSH 在目标机执行）。
//
// 设计原则（呼应「不要 mock / 清晰报错 / 联动性」）：
//   - reboot / shutdown 通过 systemctl 在目标机真实下发，命令真实执行。
//   - power_on（开机）无法通过 SSH 对一台已关机的主机生效（需 WOL/IPMI 带外），
//     因此明确返回不支持，绝不伪造「已开机」的成功。
//   - 进入维护模式前，用 virsh 真实列出运行中的虚拟机；存在运行中 VM 时拒绝并回传清单，
//     由调用方提示先迁移/关机，绝不静默放行。

import (
	"fmt"
	"strings"

	"github.com/cnf/cnfv1/internal/onboard"
)

// PowerResult 电源操作的执行结果。
type PowerResult struct {
	Action  string   `json:"action"`  // reboot | shutdown
	Steps   []string `json:"steps"`   // 已执行的命令/动作（便于审计与排错）
	Message string   `json:"message"` // 人类可读结果
}

// RunningVM 运行中虚拟机（维护模式前置检查用）。
type RunningVM struct {
	Name string `json:"name"`
}

// PowerAction 在目标主机上执行 reboot / shutdown。
//
// reboot：systemctl reboot（失败回退 reboot）。
// shutdown：systemctl poweroff（失败回退 shutdown -h now）。
// 命令通过 nohup + & 异步触发，避免 SSH 会话被立即切断导致误判失败。
func PowerAction(c *onboard.SSHClient, action string) (*PowerResult, error) {
	res := &PowerResult{Action: action}
	switch action {
	case "reboot":
		// 延迟 1s 让 SSH 响应先返回，再真正重启。
		cmd := `nohup sh -c 'sleep 1; systemctl reboot || reboot' >/dev/null 2>&1 &`
		if _, err := c.Run(cmd); err != nil {
			return nil, fmt.Errorf("下发重启命令失败: %w", err)
		}
		res.Steps = append(res.Steps, "systemctl reboot")
		res.Message = "重启命令已下发，主机正在重启"
		return res, nil
	case "shutdown":
		cmd := `nohup sh -c 'sleep 1; systemctl poweroff || shutdown -h now' >/dev/null 2>&1 &`
		if _, err := c.Run(cmd); err != nil {
			return nil, fmt.Errorf("下发关机命令失败: %w", err)
		}
		res.Steps = append(res.Steps, "systemctl poweroff")
		res.Message = "关机命令已下发，主机正在关闭"
		return res, nil
	case "power_on":
		// 已关机主机无法经 SSH 唤醒，需带外（WOL/IPMI）能力，当前不支持，明确告知。
		return nil, fmt.Errorf("开机（power_on）需带外管理（WOL/IPMI），SSH 无法对已关机主机生效，暂不支持")
	default:
		return nil, fmt.Errorf("不支持的电源动作: %q（仅支持 reboot/shutdown）", action)
	}
}

// ListRunningVMs 通过 virsh 真实列出目标主机上处于运行态的虚拟机名称。
//
// 用 `virsh list --state-running --name`；若 virsh 不可用或 libvirtd 未启动，
// 返回错误由调用方判断（维护模式前置检查需要确切结果，不能想当然认为没有 VM）。
func ListRunningVMs(c *onboard.SSHClient) ([]RunningVM, error) {
	// LANG=C 保证英文输出，便于解析。
	out, err := c.Run(`LANG=C virsh list --state-running --name 2>/dev/null`)
	if err != nil {
		// virsh 不存在 / libvirtd 未运行：尝试探测原因，给出明确信息。
		if probe := c.RunQuiet(`command -v virsh >/dev/null 2>&1 && echo HAS_VIRSH || echo NO_VIRSH`); strings.TrimSpace(probe) == "NO_VIRSH" {
			return nil, fmt.Errorf("目标主机未安装 virsh（libvirt 客户端），无法核实运行中虚拟机")
		}
		// virsh 存在但执行失败（多半 libvirtd 未运行）——视为「无运行中 VM」更危险，
		// 因此返回错误让上层谨慎处理。
		return nil, fmt.Errorf("执行 virsh 列举运行中虚拟机失败: %w", err)
	}
	var vms []RunningVM
	for _, line := range strings.Split(out, "\n") {
		name := strings.TrimSpace(line)
		if name == "" {
			continue
		}
		vms = append(vms, RunningVM{Name: name})
	}
	return vms, nil
}
