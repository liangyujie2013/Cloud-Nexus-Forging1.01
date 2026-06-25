package v1

import (
	"github.com/cnf/cnfv1/internal/model"
	"github.com/gofiber/fiber/v3"
)

// ============================================================================
// 功能 5：网络 / 虚拟交换机生命周期
//
//	vSwitch: GET/POST/DELETE /vswitches
//	网络   : GET/POST/DELETE /networks
// ============================================================================

// ---- 虚拟交换机 ----

func (h *Handlers) listVSwitches(c fiber.Ctx) error {
	clusterID, _ := paramQueryInt(c, "cluster_id")
	sws, err := h.MySQL.ListVSwitches(c.Context(), clusterID)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": sws})
}

type createVSwitchRequest struct {
	ClusterID  *int     `json:"cluster_id"`
	Name       string   `json:"name"`
	Kind       string   `json:"kind"`
	MTU        int      `json:"mtu"`
	BondMode   string   `json:"bond_mode"`
	UplinkNICs []string `json:"uplink_nics"`
}

func (h *Handlers) createVSwitch(c fiber.Ctx) error {
	var req createVSwitchRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Name == "" {
		return badRequest(c, "name 必填")
	}
	kind := model.VSwitchKind(req.Kind)
	if kind == "" {
		kind = model.VSwitchBridge
	}
	sw := &model.VSwitch{
		ClusterID:  req.ClusterID,
		Name:       req.Name,
		Kind:       kind,
		MTU:        req.MTU,
		BondMode:   req.BondMode,
		UplinkNICs: req.UplinkNICs,
	}
	id, err := h.MySQL.CreateVSwitch(c.Context(), sw)
	if err != nil {
		return badRequest(c, "创建失败: "+err.Error())
	}
	sw.ID = id
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": sw})
}

func (h *Handlers) deleteVSwitch(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	if err := h.MySQL.DeleteVSwitch(c.Context(), id); err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}

// ---- 虚拟网络 ----

func (h *Handlers) listNetworks(c fiber.Ctx) error {
	clusterID, _ := paramQueryInt(c, "cluster_id")
	nets, err := h.MySQL.ListNetworks(c.Context(), clusterID)
	if err != nil {
		return serverError(c, err)
	}
	return c.JSON(fiber.Map{"data": nets})
}

type createNetworkRequest struct {
	ClusterID   *int   `json:"cluster_id"`
	VSwitchID   *int   `json:"vswitch_id"`
	Name        string `json:"name"`
	Mode        string `json:"mode"`
	BridgeName  string `json:"bridge_name"`
	VLANID      *int   `json:"vlan_id"`
	CIDR        string `json:"cidr"`
	Gateway     string `json:"gateway"`
	DHCPEnabled bool   `json:"dhcp_enabled"`
	MTU         int    `json:"mtu"`
}

func (h *Handlers) createNetwork(c fiber.Ctx) error {
	var req createNetworkRequest
	if err := c.Bind().Body(&req); err != nil {
		return badRequest(c, "请求体非法")
	}
	if req.Name == "" {
		return badRequest(c, "name 必填")
	}
	net := &model.Network{
		ClusterID:   req.ClusterID,
		VSwitchID:   req.VSwitchID,
		Name:        req.Name,
		Mode:        req.Mode,
		BridgeName:  req.BridgeName,
		VLANID:      req.VLANID,
		CIDR:        req.CIDR,
		Gateway:     req.Gateway,
		DHCPEnabled: req.DHCPEnabled,
		MTU:         req.MTU,
	}
	id, err := h.MySQL.CreateNetwork(c.Context(), net)
	if err != nil {
		return badRequest(c, "创建失败: "+err.Error())
	}
	net.ID = id
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": net})
}

func (h *Handlers) deleteNetwork(c fiber.Ctx) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return badRequest(c, "id 非法")
	}
	if err := h.MySQL.DeleteNetwork(c.Context(), id); err != nil {
		return hierarchyError(c, err)
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}
