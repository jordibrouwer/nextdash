package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAlertSilenceIsPerKindOfFailure(t *testing.T) {
	now := time.Now()
	forever := Bookmark{HealthIgnored: []HealthIgnore{{Flag: "broken"}}}
	keyword := Bookmark{HealthIgnored: []HealthIgnore{{Flag: "content"}}}
	snoozed := Bookmark{HealthIgnored: []HealthIgnore{{Flag: "broken", Until: now.Add(time.Hour).UnixMilli()}}}
	expired := Bookmark{HealthIgnored: []HealthIgnore{{Flag: "broken", Until: now.Add(-time.Hour).UnixMilli()}}}

	cases := []struct {
		name   string
		bm     Bookmark
		up     bool
		reason string
		want   bool
	}{
		{"host down, broken ignored", forever, false, "Timeout", true},
		{"keyword rule fails, broken ignored", forever, false, `Page is missing "ok"`, false},
		{"keyword rule fails, content ignored", keyword, false, `Page is missing "ok"`, true},
		{"host down, only content ignored", keyword, false, "Connection refused", false},
		{"snooze still running", snoozed, false, "Timeout", true},
		{"snooze over", expired, false, "Timeout", false},
		{"nothing ignored", Bookmark{}, false, "Timeout", false},
		{"recovery is never held by kind", forever, true, "", false},
		{"expected-status rule fails, content ignored", keyword, false, "HTTP 404, expected 200", true},
		{"expected-status rule fails, only broken ignored", forever, false, "HTTP 404, expected 200", false},
		{"plain HTTP error, content ignored", keyword, false, "HTTP 503", false},
		{"recovery, nothing ignored", Bookmark{}, true, "", false},
	}
	for _, c := range cases {
		if got := alertSilenceFor(c.bm, now).holds(c.up, c.reason); got != c.want {
			t.Errorf("%s: holds = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestAlertSilenceMergeIsAUnion(t *testing.T) {
	a := alertSilence{broken: true}
	b := alertSilence{content: true}
	m := a.merge(b)
	if !m.broken || !m.content {
		t.Fatalf("merge = %+v, want both", m)
	}
	if got := (alertSilence{}).merge(alertSilence{}); got.broken || got.content {
		t.Fatalf("empty merge = %+v", got)
	}
}

// The wiring: a monitored bookmark that ignored "broken" reaches the alert pass
// already silenced, and a second page's copy that ignored it silences the URL.
func TestMonitorTargetCarriesIgnoredFailureKinds(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	page1 := `{"id":1,"name":"One","bookmarks":[
		{"name":"Plain","url":"https://a.example","monitor":true},
		{"name":"Ignored","url":"https://b.example","monitor":true,"healthIgnored":[{"flag":"broken"}]},
		{"name":"Twin","url":"https://c.example","monitor":true}
	]}`
	page2 := `{"id":2,"name":"Two","bookmarks":[
		{"name":"Twin","url":"https://c.example","monitor":true,"healthIgnored":[{"flag":"content"}]}
	]}`
	for name, body := range map[string]string{"bookmarks-1.json": page1, "bookmarks-2.json": page2} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	targets, _, _ := h.dueMonitorTargets(time.Now())
	byURL := map[string]monitorTarget{}
	for _, tg := range targets {
		byURL[tg.url] = tg
	}
	if got := byURL["https://a.example"].silence; got.broken || got.content {
		t.Errorf("plain bookmark silenced: %+v", got)
	}
	if got := byURL["https://b.example"].silence; !got.broken || got.content {
		t.Errorf("ignored bookmark silence = %+v, want broken only", got)
	}
	if got := byURL["https://c.example"].silence; !got.content {
		t.Errorf("a copy's ignore did not reach the URL: %+v", got)
	}
}
