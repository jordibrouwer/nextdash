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

func TestDueMonitorTargetsOnlyMonitoredBookmarks(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Monitored","url":"https://mon.example","monitor":true,"monitorIntervalMinutes":5},
		{"name":"CheckOnly","url":"https://check.example","checkStatus":true},
		{"name":"Plain","url":"https://plain.example"}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	targets, known, _ := h.dueMonitorTargets(time.Now())
	if len(targets) != 1 {
		t.Fatalf("expected only the monitored bookmark, got %#v", targets)
	}
	if targets[0].url != "https://mon.example" {
		t.Errorf("wrong target: %#v", targets[0])
	}
	if targets[0].interval != 5*time.Minute {
		t.Errorf("expected 5m interval, got %v", targets[0].interval)
	}
	// checkStatus-only bookmarks belong to the other tier and must not appear in
	// the monitor's known set, or the sweep would keep history for them.
	if len(known) != 1 || !known[canonicalBookmarkURLKey("https://mon.example")] {
		t.Errorf("unexpected known set: %#v", known)
	}
}

func TestDueMonitorTargetsRespectsInterval(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Monitored","url":"https://mon.example","monitor":true,"monitorIntervalMinutes":15}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	key := canonicalBookmarkURLKey("https://mon.example")
	now := time.Now()

	// A recent sample means not due yet.
	if err := h.appendHealthSamples(map[string][]HealthSample{
		key: {{T: msAgo(now, 2*time.Minute), Up: true}},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if targets, _, _ := h.dueMonitorTargets(now); len(targets) != 0 {
		t.Fatalf("expected not due within the interval, got %#v", targets)
	}

	// Older than the interval → due again.
	if err := h.appendHealthSamples(map[string][]HealthSample{
		key: {{T: msAgo(now, 20*time.Minute), Up: true}},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	// The newest sample is still the 2-minute-old one, so still not due.
	if targets, _, _ := h.dueMonitorTargets(now); len(targets) != 0 {
		t.Fatalf("due must be decided by the newest sample, got %#v", targets)
	}
}

func TestDueMonitorTargetsDoesNotDriftByATick(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Monitored","url":"https://mon.example","monitor":true,"monitorIntervalMinutes":5}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	key := canonicalBookmarkURLKey("https://mon.example")
	now := time.Now()

	// A sample is timestamped once its ping completes, so it sits just past the
	// tick that scheduled it. The tick a full interval later is therefore a shade
	// short of 5 minutes; it must still count as due, or every round slips a whole
	// tick and the monitor settles into a 6-minute cadence.
	if err := h.appendHealthSamples(map[string][]HealthSample{
		key: {{T: msAgo(now, 5*time.Minute-800*time.Millisecond), Up: true}},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if targets, _, _ := h.dueMonitorTargets(now); len(targets) != 1 {
		t.Fatalf("expected due despite sub-tick lateness, got %#v", targets)
	}

	// The slack must stay well under one tick, so a genuinely recent check is not
	// re-run on the very next tick.
	if err := h.appendHealthSamples(map[string][]HealthSample{
		key: {{T: msAgo(now, monitorTickInterval), Up: true}},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if targets, _, _ := h.dueMonitorTargets(now); len(targets) != 0 {
		t.Fatalf("a check from one tick ago must not be due, got %#v", targets)
	}
}

func TestDueMonitorTargetsNewMonitorIsImmediatelyDue(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Fresh","url":"https://fresh.example","monitor":true}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	targets, _, _ := h.dueMonitorTargets(time.Now())
	if len(targets) != 1 {
		t.Fatalf("a monitor with no history should be due immediately, got %#v", targets)
	}
	// No explicit interval → default, not the 5-minute floor.
	if targets[0].interval != time.Duration(defaultMonitorIntervalMinutes)*time.Minute {
		t.Errorf("expected default interval, got %v", targets[0].interval)
	}
}

func TestRunDueMonitorsRecordsHistoryAndCache(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Local","url":"` + server.URL + `","monitor":true,"monitorIntervalMinutes":5}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	h.runDueMonitors()

	key := canonicalBookmarkURLKey(server.URL)
	samples := h.healthHistoryFor(key)
	if len(samples) != 1 {
		t.Fatalf("expected one recorded sample, got %d", len(samples))
	}
	if !samples[0].Up || samples[0].Code != http.StatusOK {
		t.Errorf("unexpected sample: %#v", samples[0])
	}

	// The existing health cache must be updated too, so the current view and the
	// score keep agreeing with the monitor.
	cache := readHealthCacheFile()
	entry, ok := cache.Cache[key]
	if !ok {
		t.Fatalf("expected a health cache entry for %s", key)
	}
	if entry.Status != "online" {
		t.Errorf("expected online status in cache, got %q", entry.Status)
	}

	// And the result is mirrored onto the bookmark itself.
	bookmarks := h.store.GetBookmarksByPage(1)
	if len(bookmarks) != 1 || bookmarks[0].LastChecked == 0 {
		t.Errorf("expected LastChecked to be mirrored onto the bookmark: %#v", bookmarks)
	}
}

func TestRunDueMonitorsRecordsFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Down","url":"` + server.URL + `","monitor":true,"monitorIntervalMinutes":5}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	h.runDueMonitors()

	samples := h.healthHistoryFor(canonicalBookmarkURLKey(server.URL))
	if len(samples) != 1 {
		t.Fatalf("expected one sample, got %d", len(samples))
	}
	if samples[0].Up {
		t.Errorf("expected a failed sample, got %#v", samples[0])
	}
	if samples[0].Code != http.StatusServiceUnavailable {
		t.Errorf("expected the HTTP status to be recorded, got %d", samples[0].Code)
	}
}

// A bookmark that is not monitored must never accumulate history, otherwise the
// history file grows for installs that never enabled monitoring.
func TestRunDueMonitorsLeavesUnmonitoredAlone(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"CheckOnly","url":"` + server.URL + `","checkStatus":true}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	h.runDueMonitors()

	if got := h.healthHistoryFor(canonicalBookmarkURLKey(server.URL)); len(got) != 0 {
		t.Fatalf("unmonitored bookmark should have no history, got %#v", got)
	}
}

// A certificate must not outlive the last bookmark that made it interesting:
// once a monitored bookmark is turned off (or removed), the next sweep prunes
// its host's stored certificate rather than leaving it to age toward
// "expired" for a host nothing watches any more.
func TestRunDueMonitorsPrunesCertificatesForUnmonitoredHosts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	bookmarksPath := filepath.Join(dir, "bookmarks-1.json")
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Watched","url":"` + server.URL + `","monitor":true,"monitorIntervalMinutes":5}
	]}`
	if err := os.WriteFile(bookmarksPath, []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	// Seed a certificate for this bookmark's host directly, since the test
	// server is plain HTTP and never produces a real one.
	host := hostnameOnly(t, server.URL)
	cache := readHealthCacheFile()
	cache.Certificates = map[string]HostCertificate{
		host: {Host: host, ExpiresAt: time.Now().Add(400 * 24 * time.Hour).UnixMilli()},
	}
	if err := writeHealthCacheFile(cache); err != nil {
		t.Fatalf("seed certificate: %v", err)
	}

	// Turn monitoring off — nothing live points at this host any more.
	if err := os.WriteFile(bookmarksPath, []byte(`{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Watched","url":"`+server.URL+`"}
	]}`), 0o644); err != nil {
		t.Fatalf("rewrite bookmarks: %v", err)
	}

	h.runDueMonitors()

	after := readHealthCacheFile()
	if _, ok := after.Certificates[host]; ok {
		t.Error("certificate for an un-monitored host should have been pruned")
	}
}

func hostnameOnly(t *testing.T, rawURL string) string {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse %q: %v", rawURL, err)
	}
	return strings.ToLower(u.Hostname())
}
