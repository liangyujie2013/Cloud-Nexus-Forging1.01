package onboard

import (
	"os"
	"path/filepath"
	"testing"
)

// TestOSTagFromMajor 校验主版本号 → elN 标签映射（离线包目录选择的依据）。
func TestOSTagFromMajor(t *testing.T) {
	cases := map[string]string{
		"8":   "el8",
		"9":   "el9",
		"10":  "el10",
		" 9 ": "el9", // 容忍空白
		"":    "",    // 空版本不映射
	}
	for in, want := range cases {
		if got := OSTagFromMajor(in); got != want {
			t.Errorf("OSTagFromMajor(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestOfflineRepoPackageSelection 校验「离线包优先」选择逻辑：
//   - HasPackagesFor 仅在该 osTag（或 common）存在 RPM 时为 true；
//   - packagesFor 会把 <osTag>/*.rpm 与 common/*.rpm 合并（跨版本通用包附加）；
//   - 非 .rpm 文件被忽略。
func TestOfflineRepoPackageSelection(t *testing.T) {
	root := t.TempDir()
	repo := NewOfflineRepo(root)

	// 初始：空仓库，任何 osTag 都没有包。
	if repo.HasPackagesFor("el8") {
		t.Fatal("空仓库不应判定 el8 有包")
	}

	// 放置 el9 与 common 下的 RPM，外加一个干扰文件。
	mustWrite := func(rel string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("el9/libvirt-9.0.0.el9.x86_64.rpm")
	mustWrite("el9/qemu-kvm-7.2.0.el9.x86_64.rpm")
	mustWrite("common/edk2-ovmf.noarch.rpm")
	mustWrite("el9/README.txt") // 非 RPM，应忽略

	// el9 现在应有包；el8 仍只继承 common。
	if !repo.HasPackagesFor("el9") {
		t.Error("el9 放了 RPM 后应判定有包")
	}
	if !repo.HasPackagesFor("el8") {
		t.Error("common 目录有 RPM，任何 osTag 都应判定有包（继承 common）")
	}

	// packagesFor(el9) 应包含 el9 的 2 个 + common 的 1 个 = 3 个，且不含 README.txt。
	paths, err := repo.packagesFor("el9")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 3 {
		t.Fatalf("packagesFor(el9) 期望 3 个 RPM，实际 %d 个: %v", len(paths), paths)
	}
	for _, p := range paths {
		if filepath.Ext(p) != ".rpm" {
			t.Errorf("packagesFor 不应返回非 .rpm 文件: %s", p)
		}
	}

	// packagesFor(el8) 只应拿到 common 的 1 个（el8 目录不存在）。
	p8, _ := repo.packagesFor("el8")
	if len(p8) != 1 {
		t.Fatalf("packagesFor(el8) 期望 1 个（仅 common），实际 %d 个: %v", len(p8), p8)
	}
}

// TestOfflineRepoListGrouping 校验 List 能正确列出并标注 osTag。
func TestOfflineRepoListGrouping(t *testing.T) {
	root := t.TempDir()
	repo := NewOfflineRepo(root)
	_ = os.MkdirAll(filepath.Join(root, "el10"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "el10", "libvirt-10.0.0.el10.x86_64.rpm"), []byte("xx"), 0o644)

	pkgs, err := repo.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(pkgs) != 1 {
		t.Fatalf("List 期望 1 个包，实际 %d", len(pkgs))
	}
	if pkgs[0].OSTag != "el10" {
		t.Errorf("OSTag 期望 el10，实际 %q", pkgs[0].OSTag)
	}
}
