package v1

import (
	"github.com/cnf/cnfv1/internal/model"
	"github.com/cnf/cnfv1/internal/onboard"
	"github.com/gofiber/fiber/v3"
)

// ============================================================================
// 功能 3：无代理（agentless）宿主机纳管
//
//	POST /hosts/precheck        —— SSH 只读预检（libvirt/KVM/TCP）
//	POST /hosts/onboard         —— SSH 采集硬件 → 落库 → 以 qemu+tcp 连接验证
//	POST /hosts/:id/enable-tcp  —— 按需在目标主机开启 libvirtd TCP（唯一写操作）
// ============================================================================

// onboardRequest 纳管请求体。
type onboardRequest struct {
	ClusterID  int    `json:"cluster_id"`
	Name       string `json:"name"`
	IPAddress  string `json:"ip_address"`
	SSHPort    int    `json:"ssh_port"`
	SSHUser    string `json:"ssh_user"`
	Password   string `json:"password"`
	PrivateKey string `json:"private_key"`
	LibvirtPort int   `json:"libvirt_port"`
}

func (r *onboardRequest) sshConfig() onboard.SSHConfig {
	return onboard.SSHConfig{
		Host:       r.IPAddress,
		Port:       r.SSHPort,
		User:       r.SSHUser,
		Password:   r.Password,
		PrivateKey: []byte(r.PrivateKey),
	}
}

// precheckHost POST /hosts/precheck —— 只读探测，不修改目标主机也不落库。
func (h *Handlers) precheckHost(c fiber.Ctx) error {
	var req onboardRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.IPAddress == "" {
		return badRequest(c, "ip_address 必填")
	}
	cli, err := onboard.Dial(req.sshConfig())
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "SSH 连接失败: " + err.Error()})
	}
	defer cli.Close()

	result, err := onboard.Precheck(cli, req.LibvirtPort)
	if err != nil {
		return serverError(c, err)
	}
	hw, err := onboard.CollectHardware(cli)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"precheck": result, "hardware": hw})
}

// onboardHost POST /hosts/onboard —— 采集硬件、落库、以 qemu+tcp 验证连接。
func (h *Handlers) onboardHost(c fiber.Ctx) error {
	var req onboardRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.IPAddress == "" || req.ClusterID <= 0 {
		return badRequest(c, "ip_address 与 cluster_id 必填")
	}

	cli, err := onboard.Dial(req.sshConfig())
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "SSH 连接失败: " + err.Error()})
	}
	defer cli.Close()

	// 1) 预检
	pre, err := onboard.Precheck(cli, req.LibvirtPort)
	if err != nil {
		return serverError(c, err)
	}
	if !pre.LibvirtInstalled || !pre.KVMSupported {
		return c.Status(fiber.StatusPreconditionFailed).JSON(fiber.Map{
			"error":    pre.Message,
			"precheck": pre,
		})
	}

	// 2) 采集真实硬件
	hw, err := onboard.CollectHardware(cli)
	if err != nil {
		return serverError(c, err)
	}

	// 3) 组装 Host 并落库（UpsertHost 以 ip 为唯一键，幂等）
	name := req.Name
	if name == "" {
		name = hw.Hostname
	}
	host := &model.Host{
		ClusterID:         req.ClusterID,
		Name:              name,
		Hostname:          hw.Hostname,
		IPAddress:         req.IPAddress,
		CPUModel:          hw.CPUModel,
		CPUSockets:        hw.CPUSockets,
		CPUCoresPerSocket: hw.CPUCoresPerSock,
		CPUThreadsPerCore: hw.CPUThreadsPerCo,
		NUMANodes:         hw.NUMANodes,
		MemoryTotalMB:     hw.MemoryTotalMB,
		LibvirtVersion:    hw.LibvirtVersion,
		QEMUVersion:       hw.QEMUVersion,
		IOMMUEnabled:      hw.IOMMUEnabled,
		VFIOEnabled:       hw.IOMMUEnabled,
		Status:            model.HostProvisioning,
	}
	id, err := h.Repo.UpsertHost(c.Context(), host)
	if err != nil {
		return serverError(c, err)
	}

	// 4) 保存完整硬件清单 JSON 与 OS 版本
	inv := map[string]any{
		"gpus":   hw.GPUs,
		"disks":  hw.Disks,
		"nics":   hw.NICs,
		"kernel": hw.KernelVersion,
	}
	if err := h.MySQL.SaveHostHardware(c.Context(), id, inv, hw.OSVersion); err != nil {
		return serverError(c, err)
	}

	// 5) 以 qemu+tcp 验证可达；成功则置 connected
	connStatus := model.HostProvisioning
	connMsg := pre.Message
	if pre.TCPListening && h.Conn != nil {
		if _, cerr := h.Conn.Get(req.IPAddress); cerr == nil {
			connStatus = model.HostConnected
			connMsg = "qemu+tcp 连接成功，纳管完成"
		} else {
			connMsg = "硬件已采集，但 qemu+tcp 连接失败: " + cerr.Error()
		}
	}
	_ = h.MySQL.UpdateHostStatus(c.Context(), id, connStatus)

	// 审计：host.create（无代理纳管路径）。
	h.audit(c, "host.create", "host", id, map[string]any{
		"name": name, "ip_address": req.IPAddress, "method": "ssh-onboard",
		"status": string(connStatus),
	})

	saved, _ := h.Repo.GetHost(c.Context(), id)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"data":     saved,
		"precheck": pre,
		"message":  connMsg,
	})
}

// enableHostTCP POST /hosts/:id/enable-tcp —— 在目标主机开启 libvirtd TCP（写操作）。
func (h *Handlers) enableHostTCP(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	host, err := h.Repo.GetHost(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "主机不存在"})
	}
	var body struct {
		Password   string `json:"password"`
		PrivateKey string `json:"private_key"`
		SSHUser    string `json:"ssh_user"`
		SSHPort    int    `json:"ssh_port"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return badRequest(c, "请求体非法")
	}
	cli, err := onboard.Dial(onboard.SSHConfig{
		Host:       host.IPAddress,
		Port:       body.SSHPort,
		User:       body.SSHUser,
		Password:   body.Password,
		PrivateKey: []byte(body.PrivateKey),
	})
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "SSH 连接失败: " + err.Error()})
	}
	defer cli.Close()

	result, err := onboard.EnableTCP(cli, 16509)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": result})
}
