// Command onboard-e2e 是一个临时的真机端到端测试驱动器。
//
// 它直接调用 internal/onboard 包对真实测试机执行：
//   precheck-stream → install(stream, with offline repo) → enable-tcp → 复检
// 并把每一步/每一行实时打印到 stdout，便于专业验证 EL8/EL9/EL10 三种服务模式。
//
// 用法：
//
//	go run ./cmd/onboard-e2e -host 192.168.1.9 -pass 1 [-install]
//
// 注意：这是测试工具，验证完成后可删除；不参与生产构建（仅手动运行）。
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/cnf/cnfv1/internal/onboard"
)

func main() {
	host := flag.String("host", "", "目标主机 IP")
	port := flag.Int("port", 22, "SSH 端口")
	user := flag.String("user", "root", "SSH 用户")
	pass := flag.String("pass", "1", "SSH 密码")
	tcpPort := flag.Int("tcp", 16509, "libvirt TCP 端口")
	doInstall := flag.Bool("install", false, "是否执行自动安装（含离线包修复）")
	doTCP := flag.Bool("tcp-enable", false, "是否执行开启 TCP 监听")
	repoRoot := flag.String("repo", "/var/lib/cnf/offline-packages", "离线包仓库根目录")
	flag.Parse()

	if *host == "" {
		fmt.Println("必须指定 -host")
		os.Exit(2)
	}

	hr := func(s string) { fmt.Printf("\n========== %s ==========\n", s) }

	hr(fmt.Sprintf("连接 %s:%d (user=%s)", *host, *port, *user))
	c, err := onboard.Dial(onboard.SSHConfig{
		Host:     *host,
		Port:     *port,
		User:     *user,
		Password: *pass,
		Timeout:  20 * time.Second,
	})
	if err != nil {
		fmt.Printf("✗ SSH 连接失败: %v\n", err)
		os.Exit(1)
	}
	defer c.Close()
	fmt.Println("✓ SSH 已连接")

	// 系统画像
	osr, _ := c.Run("cat /etc/os-release | grep -E '^(NAME|VERSION_ID)='")
	fmt.Printf("[系统] %s\n", strings.ReplaceAll(strings.TrimSpace(osr), "\n", " | "))

	// 1) precheck-stream
	hr("第一步：流式预检 PrecheckStream")
	pre, err := onboard.PrecheckStream(c, *tcpPort, func(it onboard.PrecheckItem) {
		mark := "✓"
		if !it.OK {
			if it.Level == "error" {
				mark = "✗"
			} else {
				mark = "⚠"
			}
		}
		fmt.Printf("  %s [%-8s] %s\n", mark, it.Key, it.Detail)
	})
	if err != nil {
		fmt.Printf("✗ 预检失败: %v\n", err)
	} else {
		fmt.Printf("[预检结果] installed=%v running=%v kvm=%v tcp=%v msg=%q\n",
			pre.LibvirtInstalled, pre.LibvirtRunning, pre.KVMSupported, pre.TCPListening, pre.Message)
	}

	// 2) install (optional)
	if *doInstall {
		hr("第二步：流式安装 InstallVirtualizationStream（含离线包健康修复）")
		repo := onboard.NewOfflineRepo(*repoRoot)
		emitter := &onboard.StepEmitter{
			OnStep: func(name, command string) {
				fmt.Printf("\n  ▶ 步骤: %s\n    $ %s\n", name, truncate(command, 200))
			},
			OnLine: func(line string) {
				l := strings.TrimRight(line, "\r\n")
				if l != "" {
					fmt.Printf("      | %s\n", l)
				}
			},
			OnStepDone: func(s onboard.InstallStep) {
				st := "OK"
				if !s.OK {
					st = "FAIL: " + s.Error
				}
				fmt.Printf("    ◀ %s [%s]\n", s.Name, st)
			},
		}
		res, err := onboard.InstallVirtualizationStream(c, onboard.InstallOptions{
			TCPPort:     *tcpPort,
			OfflineRepo: repo,
		}, emitter)
		if err != nil {
			fmt.Printf("✗ 安装返回错误: %v\n", err)
		}
		if res != nil {
			fmt.Printf("\n[安装结果] os=%s installed=%v msg=%q\n", res.OS, res.Installed, res.Message)
			if res.Precheck != nil {
				p := res.Precheck
				fmt.Printf("[安装后复检] installed=%v running=%v kvm=%v tcp=%v\n",
					p.LibvirtInstalled, p.LibvirtRunning, p.KVMSupported, p.TCPListening)
			}
		}
	}

	// 3) enable TCP (optional)
	if *doTCP {
		hr("第三步：开启 TCP 监听 EnableTCP")
		res, err := onboard.EnableTCP(c, *tcpPort)
		if err != nil {
			fmt.Printf("✗ EnableTCP 错误: %v\n", err)
		}
		if res != nil {
			fmt.Printf("[EnableTCP] tcp=%v msg=%q\n", res.TCPListening, res.Message)
		}
	}

	// 4) 真机落地验证：服务状态 / 自启 / TCP
	hr("第四步：真机落地验证（服务/自启/TCP 端口）")
	checks := []struct{ label, cmd string }{
		{"libvirtd is-active", "systemctl is-active libvirtd 2>/dev/null || echo n/a"},
		{"libvirtd is-enabled", "systemctl is-enabled libvirtd 2>/dev/null || echo n/a"},
		{"virtqemud.socket is-active", "systemctl is-active virtqemud.socket 2>/dev/null || echo n/a"},
		{"virtqemud.socket is-enabled", "systemctl is-enabled virtqemud.socket 2>/dev/null || echo n/a"},
		{"virtqemud.service is-active", "systemctl is-active virtqemud.service 2>/dev/null || echo n/a"},
		{"virtproxyd-tcp.socket is-active", "systemctl is-active virtproxyd-tcp.socket 2>/dev/null || echo n/a"},
		{"virtproxyd-tcp.socket is-enabled", "systemctl is-enabled virtproxyd-tcp.socket 2>/dev/null || echo n/a"},
		{fmt.Sprintf("TCP :%d listening", *tcpPort), fmt.Sprintf("ss -ltn 2>/dev/null | grep ':%d ' || echo 'not-listening'", *tcpPort)},
		{"virsh -c qemu:///system version", "virsh -c qemu:///system version 2>&1 | head -3 || echo 'virsh-fail'"},
	}
	for _, ch := range checks {
		out, _ := c.Run(ch.cmd)
		fmt.Printf("  %-34s => %s\n", ch.label, strings.ReplaceAll(strings.TrimSpace(out), "\n", " / "))
	}

	hr("完成")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
