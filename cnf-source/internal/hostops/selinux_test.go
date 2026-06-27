package hostops

import "testing"

func TestNormMode(t *testing.T) {
	for _, m := range []string{"enforcing", "permissive", "disabled", "ENFORCING", " Permissive "} {
		if _, err := normMode(m); err != nil {
			t.Errorf("normMode(%q) unexpected error: %v", m, err)
		}
	}
	for _, m := range []string{"", "on", "off", "enabled"} {
		if _, err := normMode(m); err == nil {
			t.Errorf("normMode(%q) expected error", m)
		}
	}
}
