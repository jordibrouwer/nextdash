package app

import "testing"

func TestNetCheckTargetCustomHostOffByDefault(t *testing.T) {
	bm := Bookmark{URL: "https://Nas.Example.org:8443/path"}
	c := NetCheck{Type: netTypeTCP, Host: "other.example.org"}
	if _, err := netCheckTarget(bm, c, Settings{}); err == nil {
		t.Fatal("a custom host was accepted while the setting is off")
	}
	got, err := netCheckTarget(bm, c, Settings{NetToolsAllowCustomHost: true})
	if err != nil || got.Host != "other.example.org" || got.Port != 8443 {
		t.Fatalf("custom host on: %+v %v", got, err)
	}
	got, err = netCheckTarget(bm, NetCheck{Type: netTypePing}, Settings{})
	if err != nil || got.Host != "nas.example.org" || got.Port != 0 {
		t.Fatalf("own host: %+v %v", got, err)
	}
}

func TestNetCheckTargetPorts(t *testing.T) {
	https := Bookmark{URL: "https://a.example/"}
	if got, _ := netCheckTarget(https, NetCheck{Type: netTypeTCP}, Settings{}); got.Port != 443 {
		t.Fatalf("https default port %d", got.Port)
	}
	if got, _ := netCheckTarget(Bookmark{URL: "http://a.example/"}, NetCheck{Type: netTypeTCP}, Settings{}); got.Port != 80 {
		t.Fatalf("http default port %d", got.Port)
	}
	if got, _ := netCheckTarget(https, NetCheck{Type: netTypeTCP, Port: 22}, Settings{}); got.Port != 22 {
		t.Fatalf("own port %d", got.Port)
	}
	if _, err := netCheckTarget(Bookmark{URL: "ftp://a.example/"}, NetCheck{Type: netTypeTCP}, Settings{}); err == nil {
		t.Fatal("a tcp check without any port resolved")
	}
	if _, err := netCheckTarget(Bookmark{URL: "not a url"}, NetCheck{Type: netTypePing}, Settings{}); err == nil {
		t.Fatal("a bookmark without a host resolved")
	}
}

func TestNetCheckTargetHostValidation(t *testing.T) {
	good := []string{"example.org", "a-b.example.org", "nas", "192.168.1.20", "::1", "2001:db8::1", "xn--bcher-kva.example"}
	bad := []string{"", "http://example.org", "example.org:443", "example.org/path", "-a.example", "a-.example",
		"a..example", "exa mple.org", "example.org.", "fe80::1%eth0", "a_b.example", "user@example.org"}
	for _, h := range good {
		if !validNetCheckHost(h) {
			t.Errorf("%q should be valid", h)
		}
	}
	for _, h := range bad {
		if validNetCheckHost(h) {
			t.Errorf("%q should be invalid", h)
		}
	}
	long := ""
	for len(long) < 260 {
		long += "a."
	}
	if validNetCheckHost(long) {
		t.Error("a host over 253 characters passed")
	}
	label := ""
	for len(label) < 64 {
		label += "a"
	}
	if validNetCheckHost(label + ".example") {
		t.Error("a 64-character label passed")
	}
}
