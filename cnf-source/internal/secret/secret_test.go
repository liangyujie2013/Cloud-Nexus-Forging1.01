package secret

import "testing"

func TestEncryptDecryptRoundTrip(t *testing.T) {
	c, err := New("my-test-key-material")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	cases := []string{"1", "M7#dchL5$2024", "", "中文口令 with spaces & symbols!@#", "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END-----"}
	for _, pt := range cases {
		enc, err := c.EncryptToString(pt)
		if err != nil {
			t.Fatalf("encrypt %q: %v", pt, err)
		}
		if pt != "" && enc == pt {
			t.Errorf("ciphertext equals plaintext for %q (not encrypted)", pt)
		}
		dec, err := c.DecryptFromString(enc)
		if err != nil {
			t.Fatalf("decrypt %q: %v", pt, err)
		}
		if dec != pt {
			t.Errorf("round-trip mismatch: got %q want %q", dec, pt)
		}
	}
}

func TestDecryptWrongKeyFails(t *testing.T) {
	c1, _ := New("key-one")
	c2, _ := New("key-two")
	enc, _ := c1.EncryptToString("secret")
	if _, err := c2.DecryptFromString(enc); err == nil {
		t.Error("expected decryption with wrong key to fail, but it succeeded")
	}
}

func TestNonceIsRandom(t *testing.T) {
	c, _ := New("k")
	a, _ := c.EncryptToString("same")
	b, _ := c.EncryptToString("same")
	if a == b {
		t.Error("two encryptions of same plaintext produced identical ciphertext (nonce reuse)")
	}
}
