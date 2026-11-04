package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// The fixtures are written from the services' documented answers, not
// recorded from a live install: the field names and shapes are the real ones.

const (
	adguardCredential = "widget:w_adguard00001"
	piholeCredential  = "widget:w_pihole000001"
)

func fakeAdguard(t *testing.T, stats string, protection string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "admin" || pass != "secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/control/status":
			_, _ = fmt.Fprintf(w, `{"version":"v0.107.52","running":true,"protection_enabled":%s}`, protection)
		case "/control/stats":
			_, _ = w.Write([]byte(stats))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func adguardWidget(t *testing.T, h *Handlers, srv *httptest.Server, password string) Widget {
	t.Helper()
	allowLocalForTest(t, h, true)
	if err := saveHealthCredential(adguardCredential, HealthCredential{Label: "AdGuard", BasicUser: "admin", BasicPassword: password}); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	return Widget{ID: "w_adguard", Type: WidgetTypeAdguard, Config: sanitizeWidgetConfig(WidgetTypeAdguard,
		map[string]any{"server": srv.URL, "credentialId": adguardCredential})}
}

const adguardStatsJSON = `{"time_units":"hours","num_dns_queries":18420,"num_blocked_filtering":5710,"avg_processing_time":0.0143,
"dns_queries":[100,200,300],"blocked_filtering":[10,20,30],
"top_blocked_domains":[{"graph.facebook.com":540},{"doubleclick.net":812},{"telemetry.vendor.io":377}],
"top_clients":[{"192.168.1.20":9100},{"tv-woonkamer":5300}]}`

func TestAdguardAnswerHasFiguresListsAndProtection(t *testing.T) {
	h := newTestHandlers(t)
	srv := fakeAdguard(t, adguardStatsJSON, "true")
	result := h.dnsAnswer(h.fetchAdguard)(context.Background(), 1, adguardWidget(t, h, srv, "secret"), false)
	d := result.Dns
	if result.Error != "" || d == nil {
		t.Fatalf("answer: %+v", result)
	}
	if d.Queries != 18420 || d.Blocked != 5710 || !approx(d.BlockedPct, 31.0) || !approx(d.AvgMs, 14.3) {
		t.Errorf("figures: %+v", d)
	}
	if d.Protection == nil || !*d.Protection || len(d.Hourly) != 3 || d.Hourly[2].Blocked != 30 {
		t.Errorf("protection/hourly: %+v", d)
	}
	if len(d.TopBlocked) != 3 || d.TopBlocked[0].Name != "doubleclick.net" || d.TopClients[0].Count != 9100 {
		t.Errorf("lists: %+v %+v", d.TopBlocked, d.TopClients)
	}
}

func TestAdguardProtectionOffIsSaid(t *testing.T) {
	h := newTestHandlers(t)
	srv := fakeAdguard(t, adguardStatsJSON, "false")
	d := h.dnsAnswer(h.fetchAdguard)(context.Background(), 1, adguardWidget(t, h, srv, "secret"), false).Dns
	if d == nil || d.Protection == nil || *d.Protection {
		t.Fatalf("protection: %+v", d)
	}
}

func TestAdguardNoQueriesIsNotZeroPercent(t *testing.T) {
	h := newTestHandlers(t)
	srv := fakeAdguard(t, `{"num_dns_queries":0,"num_blocked_filtering":0,"dns_queries":[],"blocked_filtering":[]}`, "true")
	d := h.dnsAnswer(h.fetchAdguard)(context.Background(), 1, adguardWidget(t, h, srv, "secret"), false).Dns
	if d == nil || d.BlockedPct != nil || d.AvgMs != nil || len(d.Hourly) != 0 {
		t.Fatalf("an empty day must carry no percentage, speed or strip: %+v", d)
	}
}

func TestAdguardWrongPasswordIsKeyRefused(t *testing.T) {
	h := newTestHandlers(t)
	srv := fakeAdguard(t, adguardStatsJSON, "true")
	result := h.dnsAnswer(h.fetchAdguard)(context.Background(), 1, adguardWidget(t, h, srv, "nope"), false)
	if result.Error != "key refused" {
		t.Fatalf("error: %q", result.Error)
	}
}

// fakePihole serves v6: a session from /api/auth, refused when the id is old.
type fakePihole struct {
	*httptest.Server
	mu       sync.Mutex
	logins   int
	valid    string
	blocking string
}

func newFakePihole(t *testing.T) *fakePihole {
	t.Helper()
	f := &fakePihole{blocking: "enabled"}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.URL.Path == "/api/auth" {
			if !strings.Contains(readBody(r), `"password":"pi-pass"`) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			f.logins++
			f.valid = fmt.Sprintf("sid-%d", f.logins)
			_, _ = fmt.Fprintf(w, `{"session":{"valid":true,"sid":%q,"validity":1800}}`, f.valid)
			return
		}
		if r.Header.Get("X-FTL-SID") != f.valid || f.valid == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/stats/summary":
			_, _ = w.Write([]byte(`{"queries":{"total":38900,"blocked":9320,"percent_blocked":23.96},"gravity":{"domains_being_blocked":1200000}}`))
		case "/api/history":
			// Six slots in hour 100 and six in hour 101.
			var slots []string
			for i := 0; i < 12; i++ {
				slots = append(slots, fmt.Sprintf(`{"timestamp":%d,"total":10,"cached":1,"blocked":2,"forwarded":7}`, 100*3600+i*600))
			}
			_, _ = fmt.Fprintf(w, `{"history":[%s]}`, strings.Join(slots, ","))
		case "/api/stats/top_domains":
			if r.URL.Query().Get("blocked") != "true" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"domains":[{"domain":"ads.tiktok.com","count":251},{"domain":"doubleclick.net","count":812}]}`))
		case "/api/stats/top_clients":
			_, _ = w.Write([]byte(`{"clients":[{"name":"","ip":"192.168.1.9","count":50},{"name":"nas","ip":"192.168.1.5","count":1900}]}`))
		case "/api/stats/query_types":
			_, _ = w.Write([]byte(`{"types":{"A":58,"AAAA":27,"HTTPS":11}}`))
		case "/api/stats/upstreams":
			_, _ = w.Write([]byte(`{"upstreams":[{"ip":"blocklist","name":"blocklist","port":-1,"count":9320,"statistics":{"response":0,"variance":0}},{"ip":"cache","name":"cache","port":-1,"count":4000,"statistics":{"response":0,"variance":0}},{"ip":"1.1.1.1","name":null,"port":53,"count":22,"statistics":{"response":0.011}},{"ip":"10.0.0.2","name":"unbound.lan","port":53,"count":71,"statistics":{"response":0.006}}],"forwarded_queries":100}`))
		case "/api/dns/blocking":
			_, _ = fmt.Fprintf(w, `{"blocking":%q,"timer":null}`, f.blocking)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(f.Close)
	return f
}

func readBody(r *http.Request) string {
	buf := make([]byte, 512)
	n, _ := r.Body.Read(buf)
	return string(buf[:n])
}

func piholeWidget(t *testing.T, h *Handlers, f *fakePihole, password string) Widget {
	t.Helper()
	allowLocalForTest(t, h, true)
	cred := HealthCredential{Label: "Pi-hole", Session: &CredentialSession{
		Format: "json", LoginPath: "/api/auth", PassField: "password", Password: password,
		TokenPath: "session.sid", TokenHeader: "X-FTL-SID",
	}}
	if err := saveHealthCredential(piholeCredential, cred); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	return Widget{ID: "w_pihole", Type: WidgetTypePihole, Config: sanitizeWidgetConfig(WidgetTypePihole,
		map[string]any{"server": f.URL, "credentialId": piholeCredential})}
}

func TestPiholeAnswerSumsHoursAndNamesClients(t *testing.T) {
	h := newTestHandlers(t)
	f := newFakePihole(t)
	result := h.dnsAnswer(h.fetchPihole)(context.Background(), 1, piholeWidget(t, h, f, "pi-pass"), false)
	d := result.Dns
	if result.Error != "" || d == nil {
		t.Fatalf("answer: %+v", result)
	}
	if d.Queries != 38900 || d.Blocked != 9320 || !approx(d.BlockedPct, 24.0) || d.Gravity == nil || *d.Gravity != 1200000 {
		t.Errorf("figures: %+v", d)
	}
	if len(d.Hourly) != 2 || d.Hourly[0].Queries != 60 || d.Hourly[0].Blocked != 12 {
		t.Errorf("hourly (ten-minute slots summed by the hour): %+v", d.Hourly)
	}
	if d.TopBlocked[0].Name != "doubleclick.net" || d.TopClients[0].Name != "nas" || d.TopClients[1].Name != "192.168.1.9" {
		t.Errorf("lists: %+v %+v", d.TopBlocked, d.TopClients)
	}
	if d.QueryTypes[0].Name != "A" || len(d.Upstreams) != 2 /* pseudo upstreams left out */ || d.Upstreams[0].Name != "unbound.lan" || !approx(d.Upstreams[0].Ms, 6.0) {
		t.Errorf("types/upstreams: %+v %+v", d.QueryTypes, d.Upstreams)
	}
	if d.Protection == nil || !*d.Protection || d.OpenURL != f.URL+"/admin" {
		t.Errorf("protection/open: %+v", d)
	}
}

func TestPiholeBlockingDisabledIsSaid(t *testing.T) {
	h := newTestHandlers(t)
	f := newFakePihole(t)
	f.blocking = "disabled"
	d := h.dnsAnswer(h.fetchPihole)(context.Background(), 1, piholeWidget(t, h, f, "pi-pass"), false).Dns
	if d == nil || d.Protection == nil || *d.Protection {
		t.Fatalf("protection: %+v", d)
	}
}

func TestPiholeLapsedSessionSignsInOnce(t *testing.T) {
	h := newTestHandlers(t)
	f := newFakePihole(t)
	widget := piholeWidget(t, h, f, "pi-pass")
	ask := h.dnsAnswer(h.fetchPihole)
	if r := ask(context.Background(), 1, widget, false); r.Error != "" {
		t.Fatalf("first: %+v", r)
	}
	f.mu.Lock()
	f.valid = "lapsed"
	f.mu.Unlock()
	mediaForgetAll()
	if r := ask(context.Background(), 1, widget, false); r.Error != "" || r.Dns == nil {
		t.Fatalf("after lapse: %+v", r)
	}
	if f.logins != 2 {
		t.Errorf("sign-ins: %d, want 2", f.logins)
	}
}

func TestPiholeWrongPasswordIsRefused(t *testing.T) {
	h := newTestHandlers(t)
	f := newFakePihole(t)
	if r := h.dnsAnswer(h.fetchPihole)(context.Background(), 1, piholeWidget(t, h, f, "wrong"), false); r.Error != "key refused" {
		t.Fatalf("error: %q", r.Error)
	}
}

func TestDnsConfigKeepsOnlyKnownChoices(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeAdguard, map[string]any{
		"look": "tiles", "parts": []any{"figures", "types", "bogus"}, "rows": 7})
	if clean["look"] != "tiles" {
		t.Errorf("look: %v", clean["look"])
	}
	if parts, _ := clean["parts"].([]string); len(parts) != 1 || parts[0] != "figures" {
		t.Errorf("AdGuard has no query types: %v", clean["parts"])
	}
	if bad := sanitizeWidgetConfig(WidgetTypePihole, map[string]any{"look": "neon"}); bad["look"] != nil {
		t.Errorf("unknown look kept: %v", bad["look"])
	}
}

func TestPiholeUnknownBlockingIsNotOff(t *testing.T) {
	h := newTestHandlers(t)
	f := newFakePihole(t)
	f.blocking = "unknown"
	d := h.dnsAnswer(h.fetchPihole)(context.Background(), 1, piholeWidget(t, h, f, "pi-pass"), false).Dns
	if d == nil || d.Protection != nil {
		t.Fatalf("unknown must carry no state: %+v", d)
	}
}

func TestPiholeAddressWithAdminIsTrimmed(t *testing.T) {
	h := newTestHandlers(t)
	f := newFakePihole(t)
	w := piholeWidget(t, h, f, "pi-pass")
	w.Config["server"] = f.URL + "/admin"
	r := h.dnsAnswer(h.fetchPihole)(context.Background(), 1, w, false)
	if r.Error != "" || r.Dns == nil || r.Dns.OpenURL != f.URL+"/admin" {
		t.Fatalf("answer: %+v", r)
	}
}

func TestAdguardDaysPeriodSendsNoHourlyStrip(t *testing.T) {
	h := newTestHandlers(t)
	srv := fakeAdguard(t, `{"time_units":"days","num_dns_queries":900,"num_blocked_filtering":90,"dns_queries":[300,300,300],"blocked_filtering":[30,30,30]}`, "true")
	d := h.dnsAnswer(h.fetchAdguard)(context.Background(), 1, adguardWidget(t, h, srv, "secret"), false).Dns
	if d == nil || len(d.Hourly) != 0 || d.Queries != 900 {
		t.Fatalf("a per-day series must not be drawn as hours: %+v", d)
	}
}
