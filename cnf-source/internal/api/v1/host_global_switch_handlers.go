package v1

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cnf/cnfv1/internal/hostops"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/gofiber/fiber/v3"
)

// parseIntCSV 解析形如 "20,21,26" 的整数列表。
func parseIntCSV(s string) ([]int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, fmt.Errorf("空")
	}
	var out []int
	seen := map[int]bool{}
	for _, tok := range strings.Split(s, ",") {
		tok = strings.TrimSpace(tok)
		if tok == "" {
			continue
		}
		v, err := strconv.Atoi(tok)
		if err != nil {
			return nil, err
		}
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out, nil
}

// joinComma 用逗号连接字符串切片。
func joinComma(parts []string) string { return strings.Join(parts, ",") }

// 第5点 全局交换机（Global / Distributed Switch）——「一份规格，多主机一致下发」。
//
// 设计（VMware 分布式交换机的 Linux 等价物）：
//   - 用户定义一套标准交换机规格（网桥名 / bond 模式 / IP 模式），并勾选一组主机。
//   - 平台逐主机复用 CreateStandardSwitch 真实下发（nmcli bridge+bond），并行（限并发 4）。
//   - 每台主机独立选择上行物理网卡（各主机网卡名/数量可能不同），保证落地真实。
//   - 返回每主机结果（成功/失败/步骤/错误），绝不伪造整体成功。
//
// 路由：
//   POST /hosts/global-switch/apply     批量在多台主机上创建同名标准交换机
//   POST /hosts/global-switch/delete    批量在多台主机上删除同名标准交换机
//   GET  /hosts/global-switch/status    汇总各主机上该名交换机的存在情况（一致性视图）

// globalSwitchHostSpec 单台主机的上行选择（其余规格全局共享）。
type globalSwitchHostSpec struct {
	HostID      int      `json:"host_id"`
	Uplinks     []string `json:"uplinks"`       // 该主机选的上行物理网卡（≥1）
	AckMgmtRisk bool     `json:"ack_mgmt_risk"` // 该主机上行含管理网卡时需 true
}

// globalSwitchApplyRequest 全局交换机下发请求。
type globalSwitchApplyRequest struct {
	Name     string                 `json:"name"`      // 网桥名（全局一致）；必填
	BondMode string                 `json:"bond_mode"` // bond 模式（全局一致）；默认 active-backup
	IPMode   string                 `json:"ip_mode"`   // none/dhcp/static（全局一致）；通常 none（虚机转发）
	Hosts    []globalSwitchHostSpec `json:"hosts"`     // 目标主机及各自上行
}

// globalSwitchHostResult 单主机下发结果。
type globalSwitchHostResult struct {
	HostID int      `json:"host_id"`
	OK     bool     `json:"ok"`
	Steps  []string `json:"steps,omitempty"`
	Error  string   `json:"error,omitempty"`
}

func (h *Handlers) applyGlobalSwitch(c fiber.Ctx) error {
	var req globalSwitchApplyRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Name == "" {
		return badRequest(c, "缺少全局交换机名称")
	}
	if len(req.Hosts) == 0 {
		return badRequest(c, "请至少选择一台目标主机")
	}
	bondMode := req.BondMode
	if bondMode == "" {
		bondMode = "active-backup"
	}
	ipMode := req.IPMode
	if ipMode == "" {
		ipMode = "none"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	results := make([]globalSwitchHostResult, len(req.Hosts))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4) // 多主机网络改动风险高，限制并发
	for i, hs := range req.Hosts {
		wg.Add(1)
		go func(idx int, spec globalSwitchHostSpec) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			r := globalSwitchHostResult{HostID: spec.HostID}
			if len(spec.Uplinks) == 0 {
				r.Error = "该主机未选择上行物理网卡"
				results[idx] = r
				return
			}
			cli, err := h.dialHost(ctx, spec.HostID)
			if err != nil {
				if err == mysql.ErrNoCredential {
					r.Error = "该主机未存储 SSH 凭据，无法下发"
				} else {
					r.Error = err.Error()
				}
				results[idx] = r
				return
			}
			defer cli.Close()
			steps, e := hostops.CreateStandardSwitch(cli, hostops.CreateSwitchRequest{
				Name:        req.Name,
				Uplinks:     spec.Uplinks,
				BondMode:    bondMode,
				IPMode:      ipMode,
				AckMgmtRisk: spec.AckMgmtRisk,
			})
			r.Steps = steps
			if e != nil {
				r.Error = e.Error()
			} else {
				r.OK = true
			}
			results[idx] = r
		}(i, hs)
	}
	wg.Wait()

	okCount := 0
	for _, r := range results {
		if r.OK {
			okCount++
		}
	}
	hostIDs := make([]int, len(req.Hosts))
	for i, hs := range req.Hosts {
		hostIDs[i] = hs.HostID
	}
	h.audit(c, "host.global_switch.apply", "host", 0, fiber.Map{"name": req.Name, "host_ids": hostIDs, "ok": okCount})
	return c.JSON(fiber.Map{"data": fiber.Map{
		"results": results, "ok": okCount, "total": len(req.Hosts),
	}, "message": fmt.Sprintf("全局交换机「%s」下发完成：%d/%d 台主机成功", req.Name, okCount, len(req.Hosts))})
}

// globalSwitchDeleteRequest 全局交换机批量删除请求。
type globalSwitchDeleteRequest struct {
	Name        string `json:"name"`          // 网桥名；必填
	HostIDs     []int  `json:"host_ids"`      // 目标主机
	AckMgmtRisk bool   `json:"ack_mgmt_risk"` // 含管理流量交换机需 true
}

func (h *Handlers) deleteGlobalSwitch(c fiber.Ctx) error {
	var req globalSwitchDeleteRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Name == "" {
		return badRequest(c, "缺少全局交换机名称")
	}
	if len(req.HostIDs) == 0 {
		return badRequest(c, "请至少选择一台目标主机")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	results := make([]globalSwitchHostResult, len(req.HostIDs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, hid := range req.HostIDs {
		wg.Add(1)
		go func(idx, hostID int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			r := globalSwitchHostResult{HostID: hostID}
			cli, err := h.dialHost(ctx, hostID)
			if err != nil {
				if err == mysql.ErrNoCredential {
					r.Error = "该主机未存储 SSH 凭据，无法下发"
				} else {
					r.Error = err.Error()
				}
				results[idx] = r
				return
			}
			defer cli.Close()
			steps, e := hostops.DeleteStandardSwitch(cli, req.Name, req.AckMgmtRisk)
			r.Steps = steps
			if e != nil {
				r.Error = e.Error()
			} else {
				r.OK = true
			}
			results[idx] = r
		}(i, hid)
	}
	wg.Wait()

	okCount := 0
	for _, r := range results {
		if r.OK {
			okCount++
		}
	}
	h.audit(c, "host.global_switch.delete", "host", 0, fiber.Map{"name": req.Name, "host_ids": req.HostIDs, "ok": okCount})
	return c.JSON(fiber.Map{"data": fiber.Map{
		"results": results, "ok": okCount, "total": len(req.HostIDs),
	}, "message": fmt.Sprintf("全局交换机「%s」删除完成：%d/%d 台主机成功", req.Name, okCount, len(req.HostIDs))})
}

// globalSwitchHostState 单主机上某名交换机的存在/一致性状态。
type globalSwitchHostState struct {
	HostID   int    `json:"host_id"`
	Hostname string `json:"hostname,omitempty"`
	Present  bool   `json:"present"`           // 该主机上是否存在同名标准交换机
	Uplinks  string `json:"uplinks,omitempty"` // 上行口（逗号分隔），用于一致性比对
	BondMode string `json:"bond_mode,omitempty"`
	State    string `json:"state,omitempty"`
	IsMgmt   bool   `json:"is_mgmt,omitempty"`
	Error    string `json:"error,omitempty"`
}

// getGlobalSwitchStatus 汇总一组主机上某名交换机的存在情况，给出一致性视图。
//
// 入参：?name=br0&host_ids=20,21,26
func (h *Handlers) getGlobalSwitchStatus(c fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return badRequest(c, "缺少 name 查询参数")
	}
	hostIDs, err := parseIntCSV(c.Query("host_ids"))
	if err != nil || len(hostIDs) == 0 {
		return badRequest(c, "host_ids 非法或为空（示例 host_ids=20,21,26）")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	states := make([]globalSwitchHostState, len(hostIDs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, hid := range hostIDs {
		wg.Add(1)
		go func(idx, hostID int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			st := globalSwitchHostState{HostID: hostID}
			cli, err := h.dialHost(ctx, hostID)
			if err != nil {
				st.Error = err.Error()
				states[idx] = st
				return
			}
			defer cli.Close()
			inv, e := hostops.CollectSwitches(cli)
			if e != nil {
				st.Error = e.Error()
				states[idx] = st
				return
			}
			st.Hostname = inv.Hostname
			for _, sw := range inv.Switches {
				if sw.Name == name {
					st.Present = true
					st.BondMode = sw.BondMode
					st.State = sw.State
					st.IsMgmt = sw.IsMgmt
					var ups []string
					for _, u := range sw.Uplinks {
						ups = append(ups, u.Device)
					}
					st.Uplinks = joinComma(ups)
					break
				}
			}
			states[idx] = st
		}(i, hid)
	}
	wg.Wait()

	presentCount := 0
	for _, s := range states {
		if s.Present {
			presentCount++
		}
	}
	consistent := presentCount == len(hostIDs)
	return c.JSON(fiber.Map{"data": fiber.Map{
		"name": name, "states": states,
		"present": presentCount, "total": len(hostIDs), "consistent": consistent,
	}})
}
