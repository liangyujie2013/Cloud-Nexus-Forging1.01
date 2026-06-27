package hostops

import "testing"

func TestFirewallPortSpec(t *testing.T) {
	cases := []struct {
		p    FirewallPort
		want string
		ok   bool
	}{
		{FirewallPort{Port: 22, Protocol: "tcp"}, "22/tcp", true},
		{FirewallPort{PortFrom: 5900, PortTo: 5999, Protocol: "tcp"}, "5900-5999/tcp", true},
		{FirewallPort{Port: 53, Protocol: "udp"}, "53/udp", true},
		{FirewallPort{Port: 22, Protocol: "sctp"}, "", false},
		{FirewallPort{Port: 0, Protocol: "tcp"}, "", false},
		{FirewallPort{PortFrom: 6000, PortTo: 5000, Protocol: "tcp"}, "", false},
	}
	for _, c := range cases {
		got, err := c.p.spec()
		if c.ok && (err != nil || got != c.want) {
			t.Errorf("spec(%+v) = %q,%v want %q", c.p, got, err, c.want)
		}
		if !c.ok && err == nil {
			t.Errorf("spec(%+v) expected error", c.p)
		}
	}
}

func TestParsePortSpec(t *testing.T) {
	fp, err := ParsePortSpec("8080/tcp")
	if err != nil || fp.Port != 8080 || fp.Protocol != "tcp" {
		t.Fatalf("ParsePortSpec(8080/tcp) = %+v,%v", fp, err)
	}
	fp, err = ParsePortSpec("6000-6010/udp")
	if err != nil || fp.PortFrom != 6000 || fp.PortTo != 6010 || fp.Protocol != "udp" {
		t.Fatalf("ParsePortSpec(range) = %+v,%v", fp, err)
	}
	if _, err := ParsePortSpec("notaport"); err == nil {
		t.Error("expected error for malformed spec")
	}
	if _, err := ParsePortSpec("99999/tcp"); err == nil {
		t.Error("expected error for out-of-range port")
	}
}

func TestPlatformPorts(t *testing.T) {
	pp := PlatformPorts(2222)
	if len(pp) != 5 {
		t.Fatalf("expected 5 platform ports, got %d", len(pp))
	}
	// 第一个应为自定义 SSH 端口
	if pp[0].Port != 2222 {
		t.Errorf("expected ssh port 2222, got %d", pp[0].Port)
	}
	// 默认 22
	if PlatformPorts(0)[0].Port != 22 {
		t.Error("expected default ssh port 22")
	}
}

func TestMissingPlatformPorts(t *testing.T) {
	st := &FirewallState{
		OpenPorts:    []string{"16509/tcp", "16514/tcp", "5900-5999/tcp", "49152-49215/tcp"},
		OpenServices: []string{"ssh"},
	}
	// 22/tcp 由 ssh 服务覆盖，其余已全开 → 应无缺失
	if m := missingPlatformPorts(st, 22); len(m) != 0 {
		t.Errorf("expected no missing ports, got %v", m)
	}
	// 自定义 SSH 端口 2222，ssh 服务只覆盖 22 → 缺 2222/tcp
	if m := missingPlatformPorts(st, 2222); len(m) != 1 || m[0] != "2222/tcp" {
		t.Errorf("expected missing 2222/tcp, got %v", m)
	}
}
