package gpu

import "testing"

func TestNormalizePCI(t *testing.T) {
	cases := map[string]string{
		"00000000:81:00.0": "0000:81:00.0",
		"0000:81:00.0":     "0000:81:00.0",
		"00000000:C1:00.1": "0000:c1:00.1",
	}
	for in, want := range cases {
		if got := normalizePCI(in); got != want {
			t.Errorf("normalizePCI(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSplitCSV(t *testing.T) {
	got := splitCSV("0, 0000:81:00.0,  94 , 68000")
	want := []string{"0", "0000:81:00.0", "94", "68000"}
	if len(got) != len(want) {
		t.Fatalf("长度不符: %d vs %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("字段[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestAtof(t *testing.T) {
	cases := map[string]float64{
		"94.5":            94.5,
		"[N/A]":           0,
		"[Not Supported]": 0,
		"  280 ":          280,
		"":                0,
	}
	for in, want := range cases {
		if got := atof(in); got != want {
			t.Errorf("atof(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestGPUVendorMapping(t *testing.T) {
	if gpuVendors["10de"] != "NVIDIA" {
		t.Error("10de 应映射为 NVIDIA")
	}
	if gpuVendors["1002"] != "AMD" {
		t.Error("1002 应映射为 AMD")
	}
}
