package app

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func badgeRequest(h *Handlers, address string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.UptimeBadge(rec, httptest.NewRequest(http.MethodGet, "/badge/uptime.svg?url="+url.QueryEscape(address), nil))
	return rec
}

func TestUptimeBadgeIsOffUnlessSwitchedOn(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	if rec := badgeRequest(h, "https://off.example/"); rec.Code != http.StatusNotFound {
		t.Fatalf("badge answered %d with the switch off, want 404", rec.Code)
	}
}

// seedBadgeHistory gives an address 100 samples, one of them down, and a
// bookmark on page 1 that monitors it or not.
func seedBadgeHistory(t *testing.T, dir, address string, monitor bool) {
	t.Helper()
	page := `{"id":1,"name":"Page 1","bookmarks":[{"name":"x","url":"` + address + `","monitor":` + map[bool]string{true: "true", false: "false"}[monitor] + `}]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	samples := make([]HealthSample, 0, 100)
	for i := 0; i < 100; i++ {
		samples = append(samples, HealthSample{T: now - int64(i+1)*60_000, Up: i != 0})
	}
	history := emptyHealthHistory()
	history.Samples[canonicalBookmarkURLKey(address)] = samples
	if err := writeHealthHistoryFile(history); err != nil {
		t.Fatalf("write history: %v", err)
	}
}

func TestUptimeBadgeReportsTheRatioAndHidesTheAddress(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"uptimeBadges":true}`)
	address := "https://monitored.example/"
	seedBadgeHistory(t, dir, address, true)

	rec := badgeRequest(h, address)
	body := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "image/svg+xml") {
		t.Fatalf("answered %d as %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if !strings.Contains(body, "99.00%") {
		t.Errorf("badge does not carry 99.00%%: %s", body)
	}
	if strings.Contains(body, "monitored.example") {
		t.Error("the address is drawn into the badge")
	}
}

func TestUptimeBadgeSaysNoDataForAnAddressItDoesNotKnow(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"uptimeBadges":true}`)
	rec := badgeRequest(h, "https://nobody.example/")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "no data") {
		t.Fatalf("unknown address: %d %s", rec.Code, rec.Body.String())
	}
}

// History alone is not enough: a bookmark re-checked once by hand has samples,
// and its badge would tell the web the address is known here.
func TestUptimeBadgeSaysNoDataForAnUnmonitoredBookmark(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"uptimeBadges":true}`)
	seedBadgeHistory(t, dir, "https://nas.lan:5000/", false)
	rec := badgeRequest(h, "https://nas.lan:5000/")
	if !strings.Contains(rec.Body.String(), "no data") {
		t.Fatalf("unmonitored address answered: %s", rec.Body.String())
	}
}
