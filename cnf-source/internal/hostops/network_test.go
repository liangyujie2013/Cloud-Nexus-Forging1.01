package hostops

import "testing"

func TestPrefixToNetmask(t *testing.T) {
	cases := map[int]string{
		24: "255.255.255.0",
		16: "255.255.0.0",
		8:  "255.0.0.0",
		32: "255.255.255.255",
		25: "255.255.255.128",
		0:  "0.0.0.0",
	}
	for pfx, want := range cases {
		if got := prefixToNetmask(pfx); got != want {
			t.Errorf("prefixToNetmask(%d)=%q want %q", pfx, got, want)
		}
	}
}

func TestNetmaskToPrefix(t *testing.T) {
	cases := map[string]int{
		"255.255.255.0":   24,
		"255.255.0.0":     16,
		"255.0.0.0":       8,
		"255.255.255.128": 25,
		"255.255.255.255": 32,
	}
	for mask, want := range cases {
		if got := netmaskToPrefix(mask); got != want {
			t.Errorf("netmaskToPrefix(%q)=%d want %d", mask, got, want)
		}
	}
}

func TestSplitNM(t *testing.T) {
	// nmcli -t 转义冒号: "System eth0:uuid-x:eth0:ethernet"
	got := splitNM(`Wired connection 1:11111111-2222:eth0:ethernet`)
	if len(got) != 4 || got[0] != "Wired connection 1" || got[2] != "eth0" {
		t.Fatalf("splitNM unexpected: %#v", got)
	}
	// 带转义冒号
	esc := splitNM(`name\:with\:colon:uuid:dev:type`)
	if esc[0] != "name:with:colon" {
		t.Fatalf("escaped colon not handled: %#v", esc)
	}
}

func TestSplitCIDR(t *testing.T) {
	ip, pfx := splitCIDR("192.168.1.42/24")
	if ip != "192.168.1.42" || pfx != 24 {
		t.Fatalf("splitCIDR got %q/%d", ip, pfx)
	}
}

func TestNMMethodToMode(t *testing.T) {
	if nmMethodToMode("auto") != "dhcp" {
		t.Error("auto should map to dhcp")
	}
	if nmMethodToMode("manual") != "static" {
		t.Error("manual should map to static")
	}
}

func TestParseIPAddrAndLink(t *testing.T) {
	m := map[string]*NIC{}
	parseIPLink(m, `1: lo: <LOOPBACK,UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default link/ether 52:54:00:ab:cd:ef brd ff:ff:ff:ff:ff:ff`)
	parseIPAddr(m, `2: eth0    inet 192.168.1.42/24 brd 192.168.1.255 scope global eth0`)
	n := m["eth0"]
	if n == nil {
		t.Fatal("eth0 not parsed")
	}
	if n.MAC != "52:54:00:ab:cd:ef" {
		t.Errorf("MAC=%q", n.MAC)
	}
	if n.IPv4 != "192.168.1.42" || n.Prefix != 24 {
		t.Errorf("ipv4=%q prefix=%d", n.IPv4, n.Prefix)
	}
	if n.State != "up" {
		t.Errorf("state=%q", n.State)
	}
}

func TestApplyNMConnDetail(t *testing.T) {
	n := &NIC{Device: "eth0"}
	detail := `connection.uuid:abc-123
ipv4.method:manual
ipv4.addresses:192.168.1.42/24
ipv4.gateway:192.168.1.1
ipv4.dns:8.8.8.8,1.1.1.1
GENERAL.HWADDR:52\:54\:00\:AB\:CD\:EF`
	applyNMConnDetail(n, "eth0", detail)
	if n.ConnUUID != "abc-123" {
		t.Errorf("uuid=%q", n.ConnUUID)
	}
	if n.Mode != "static" {
		t.Errorf("mode=%q", n.Mode)
	}
	if n.Gateway != "192.168.1.1" {
		t.Errorf("gw=%q", n.Gateway)
	}
	if len(n.DNS) != 2 {
		t.Errorf("dns=%v", n.DNS)
	}
	if n.MAC != "52:54:00:AB:CD:EF" {
		t.Errorf("mac=%q (escaped colon not unwound)", n.MAC)
	}
}
