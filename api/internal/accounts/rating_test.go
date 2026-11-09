package accounts

import "testing"

func TestAllowedReadsNFVCBRatings(t *testing.T) {
	cases := []struct {
		rating, max string
		want        bool
	}{
		{"12", "12", true},
		{"15 (NFVCB 2026/123)", "12", false},
		{"15 (NFVCB 2026/123)", "16", true},
		{"G", "all", true},
		{"18", "16", false},
		{"something else", "16", false},
	}
	for _, c := range cases {
		if got := Allowed(c.rating, c.max); got != c.want {
			t.Errorf("Allowed(%q, %q) = %v, want %v", c.rating, c.max, got, c.want)
		}
	}
}
