package app

import (
	"context"
	"net/netip"
	"strings"
	"testing"
	"time"
)

func TestValidatePublicHTTPURL(t *testing.T) {
	t.Parallel()

	allowed := []string{
		"https://example.com/path",
		"http://github.com",
	}
	for _, u := range allowed {
		if err := validateHTTPURL(u, false); err != nil {
			t.Fatalf("%q should be allowed: %v", u, err)
		}
	}

	blocked := []string{
		"",
		"javascript:alert(1)",
		"file:///etc/passwd",
		"http://127.0.0.1:8080",
		"http://localhost/",
		"http://10.0.0.1/internal",
	}
	for _, u := range blocked {
		if err := validateHTTPURL(u, false); err == nil {
			t.Fatalf("%q should be blocked", u)
		}
	}
}

func TestSanitizeBookmarkIcon(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"":              "",
		"  ":            "",
		"my-icon.png":   "my-icon.png",
		"Icon_123.ico":  "Icon_123.ico",
		"../etc/passwd": "",
		"foo/bar.png":   "",
		`"><evil>`:      "",
	}
	long := strings.Repeat("a", 201) + ".png"
	cases[long] = ""

	for input, want := range cases {
		if got := sanitizeBookmarkIcon(input); got != want {
			t.Fatalf("sanitizeBookmarkIcon(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSSRFSafeDialContextBlocksLoopback(t *testing.T) {
	t.Parallel()

	dial := ssrfSafeDialContext(false, time.Second)
	_, err := dial(context.Background(), "tcp", "127.0.0.1:9")
	if err == nil {
		t.Fatal("expected loopback dial to be blocked")
	}
}

func TestSSRFSafeDialContextAllowsLoopbackWhenEnabled(t *testing.T) {
	t.Parallel()

	dial := ssrfSafeDialContext(true, 200*time.Millisecond)
	conn, err := dial(context.Background(), "tcp", "127.0.0.1:9")
	if err == nil {
		conn.Close()
		t.Fatal("expected connection error to closed port, not SSRF block")
	}
	if strings.Contains(strings.ToLower(err.Error()), "disallowed ip") {
		t.Fatalf("loopback should be allowed when allowLocal is true: %v", err)
	}
}

func TestIsAllowedDialIP(t *testing.T) {
	t.Parallel()

	public := netip.MustParseAddr("8.8.8.8")
	private := netip.MustParseAddr("10.0.0.1")
	loopback := netip.MustParseAddr("127.0.0.1")

	if !isAllowedDialIP(public, false) {
		t.Fatal("public IP should be allowed")
	}
	if isAllowedDialIP(private, false) || isAllowedDialIP(loopback, false) {
		t.Fatal("private/loopback should be blocked by default")
	}
	if !isAllowedDialIP(private, true) || !isAllowedDialIP(loopback, true) {
		t.Fatal("private/loopback should be allowed when allowLocal is true")
	}
}

// Non-public ranges the standard predicates miss (tailnet, "this network",
// reserved, translators) need allowLocal, like a private address.
func TestIsAllowedDialIPNonPublicRanges(t *testing.T) {
	t.Parallel()
	for _, s := range []string{
		"100.64.1.1", "100.127.255.254", "0.0.0.1", "240.0.0.1", "255.255.255.255",
		"198.18.0.1", "198.19.255.255", "64:ff9b::a00:1", "2002:a00:1::1",
		"::127.0.0.1", "::a00:1", "::ffff:100.64.1.1",
	} {
		a := netip.MustParseAddr(s)
		if isAllowedDialIP(a, false) {
			t.Errorf("%s must be refused without allowLocal", s)
		}
		if !isAllowedDialIP(a, true) {
			t.Errorf("%s must be allowed with allowLocal", s)
		}
	}
	for _, s := range []string{"100.63.255.255", "100.128.0.1", "198.17.0.1", "198.20.0.1", "8.8.8.8", "64:ff9b::808:808", "2002:808:808::1", "2606:4700::1111"} {
		if !isAllowedDialIP(netip.MustParseAddr(s), false) {
			t.Errorf("%s is public and must stay allowed", s)
		}
	}
}

func TestValidateBookmarkURLAllowsLocalWhenEnabled(t *testing.T) {
	t.Parallel()

	if err := validateBookmarkURL("http://127.0.0.1:8080", false); err == nil {
		t.Fatal("localhost bookmark should be rejected by default")
	}
	if err := validateBookmarkURL("http://127.0.0.1:8080", true); err != nil {
		t.Fatalf("localhost bookmark should be allowed when enabled: %v", err)
	}
	if err := validateBookmarkURL("https://example.com", false); err != nil {
		t.Fatalf("public bookmark should be allowed: %v", err)
	}
}

func TestIsPublicHostCtx_RespectsDeadline(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()
	time.Sleep(2 * time.Millisecond)
	if isPublicHostCtx(ctx, "example.com") {
		t.Fatal("isPublicHostCtx() should fail when context is already expired")
	}
}

func TestValidateHTTPURLCtx_RespectsDeadline(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()
	time.Sleep(2 * time.Millisecond)
	if err := validateHTTPURLCtx(ctx, "https://example.com", false); err == nil {
		t.Fatal("validateHTTPURLCtx() should fail when context is already expired")
	}
}
