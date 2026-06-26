package onboard

import "testing"

// TestDecideServiceModel 校验「8/9/10 守护进程模式一次性写对」的核心决策逻辑。
//
// 规则：
//   - EL10+：强制模块化（单体已弃用/不可用）。
//   - EL9 ：默认模块化；仅当只有 libvirtd.service 而无 virtqemud.service 时回退单体。
//   - EL8 ：默认单体；仅当只有 virtqemud.service 而无 libvirtd.service 时回退模块化。
//   - 未知版本：以实际存在的 unit 为准，二者皆无按单体。
func TestDecideServiceModel(t *testing.T) {
	cases := []struct {
		name         string
		osMajor      string
		hasLibvirtd  bool
		hasVirtqemud bool
		want         serviceModel
	}{
		// EL10：无论 unit 如何，都必须模块化（关键：截图里的 EL10 报错根因）。
		{"el10 both present", "10", true, true, modelModular},
		{"el10 only virtqemud", "10", false, true, modelModular},
		{"el10 only libvirtd", "10", true, false, modelModular},
		{"el10 none", "10", false, false, modelModular},
		{"el11 future", "11", true, false, modelModular},

		// EL9：默认模块化，单体回退仅在「只有 libvirtd」时。
		{"el9 both", "9", true, true, modelModular},
		{"el9 only virtqemud", "9", false, true, modelModular},
		{"el9 only libvirtd", "9", true, false, modelMonolithic},
		{"el9 none -> modular", "9", false, false, modelModular},

		// EL8：默认单体，模块化回退仅在「只有 virtqemud」时。
		{"el8 both -> mono", "8", true, true, modelMonolithic},
		{"el8 only libvirtd", "8", true, false, modelMonolithic},
		{"el8 only virtqemud -> modular", "8", false, true, modelModular},
		{"el8 none -> mono", "8", false, false, modelMonolithic},

		// 未知版本：以 unit 为准。
		{"unknown only libvirtd", "", true, false, modelMonolithic},
		{"unknown only virtqemud", "", false, true, modelModular},
		{"unknown none -> mono", "", false, false, modelMonolithic},
	}
	for _, tc := range cases {
		got := decideServiceModel(tc.osMajor, tc.hasLibvirtd, tc.hasVirtqemud)
		if got != tc.want {
			t.Errorf("%s: decideServiceModel(%q,%v,%v) = %v, want %v",
				tc.name, tc.osMajor, tc.hasLibvirtd, tc.hasVirtqemud, got, tc.want)
		}
	}
}

// TestServiceModelString 校验模式的中文描述（用于流式日志展示）。
func TestServiceModelString(t *testing.T) {
	if modelMonolithic.String() != "单体 libvirtd" {
		t.Errorf("modelMonolithic.String() = %q", modelMonolithic.String())
	}
	if modelModular.String() != "模块化 virtqemud + sockets" {
		t.Errorf("modelModular.String() = %q", modelModular.String())
	}
	if modelUnknown.String() != "未知" {
		t.Errorf("modelUnknown.String() = %q", modelUnknown.String())
	}
}

// TestGtMajor 校验主版本比较（用于 EL10+ 判定）。
func TestGtMajor(t *testing.T) {
	if !gtMajor("11", 10) {
		t.Error("11 应 > 10")
	}
	if gtMajor("10", 10) {
		t.Error("10 不应 > 10")
	}
	if gtMajor("9", 10) {
		t.Error("9 不应 > 10")
	}
	if gtMajor("", 10) {
		t.Error("空版本不应 > 10")
	}
}
