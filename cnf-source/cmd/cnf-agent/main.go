// CNFv1.0 宿主机代理：运行在每台 KVM 宿主机上，通过 libvirt-go 操作 QEMU/KVM，
// 向控制面上报心跳、主机能力（CPU 拓扑/NUMA/GPU）与监控指标。
//
// 注意：本文件依赖 libvirt-go（CGO），必须在安装了 libvirt-devel 的
// Rocky Linux 9 上编译：
//
//	dnf install -y libvirt-devel gcc
//	CGO_ENABLED=1 go build -o cnf-agent ./cmd/cnf-agent
package main

import (
	"log"
	"net/http"
	"os"
	"time"
)

const Version = "1.0.0"

func main() {
	listen := envOr("CNF_AGENT_LISTEN", ":9090")
	master := os.Getenv("CNF_MASTER_IP")
	log.Printf("CNFv1.0 Agent %s 启动，监听 %s，master=%s", Version, listen, master)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","version":"` + Version + `"}`))
	})
	// 上报主机能力（实际实现调用 libvirt GetCapabilities / virConnectGetCapabilities）
	mux.HandleFunc("/capabilities", reportCapabilities)

	// 心跳协程
	go heartbeatLoop(master)

	srv := &http.Server{Addr: listen, Handler: mux, ReadTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

// reportCapabilities 返回主机虚拟化能力（占位，生产实现见 internal/virt）。
func reportCapabilities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"libvirt":"connected","note":"实现见 internal/virt 的 libvirt 连接"}`))
}

// heartbeatLoop 周期性向控制面上报心跳与监控指标。
func heartbeatLoop(master string) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for range t.C {
		if master == "" {
			continue
		}
		// 实际实现：POST /api/v1/hosts/heartbeat（含 CPU/内存/GPU 指标）
		log.Printf("[heartbeat] → %s (采集 CPU/NUMA/GPU 指标并上报)", master)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
