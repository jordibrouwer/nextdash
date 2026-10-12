package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func newsRelease(t *testing.T, raw string) whatsNewRelease {
	t.Helper()
	var rel whatsNewRelease
	if err := json.Unmarshal([]byte(raw), &rel); err != nil {
		t.Fatal(err)
	}
	return rel
}

func TestDigestNewsTakesTheWeeksHighlights(t *testing.T) {
	week := newsRelease(t, `{"tag":"v1.20.0","releasedAt":"2026-10-09","modalLead":"Lead.","sections":[{"title":"A","items":[
		{"badge":"new","text":"<strong>Paste a link and see what it is</strong> before you save.","highlight":true},
		{"badge":"new","text":"<strong>Not marked</strong> stays out."},
		{"badge":"new","title":"Weekly digest","text":"<strong>Once a week, one message:</strong> long.","highlight":true}]}]}`)
	unmarked := newsRelease(t, `{"tag":"v1.19.9","releasedAt":"2026-10-06","modalLead":"A <strong>row height</strong> setting.","sections":[]}`)
	old := newsRelease(t, `{"tag":"v1.19.0","releasedAt":"2026-10-01","sections":[{"items":[{"badge":"new","text":"x","highlight":true}]}]}`)

	in := digestInput{Now: digestNow, Settings: Settings{DigestNews: true}, Releases: []whatsNewRelease{week, unmarked, old}}
	d := buildDigest(in)
	if d.News == nil {
		t.Fatal("a week with releases should have news")
	}
	if got := strings.Join(d.News.Releases, ","); got != "v1.20.0,v1.19.9" {
		t.Fatalf("releases %q", got)
	}
	want := []string{"Paste a link and see what it is", "Weekly digest", "A row height setting"}
	if strings.Join(d.News.Highlights, "|") != strings.Join(want, "|") {
		t.Fatalf("highlights %q", d.News.Highlights)
	}
	if d.empty() {
		t.Fatal("news alone is a digest")
	}

	n := digestNotice(d)
	if !strings.Contains(n.Title, "nextDash v1.20.0, v1.19.9 is out") || !strings.Contains(n.Error, "New in nextDash v1.20.0, v1.19.9: Paste a link") {
		t.Fatalf("title %q body %q", n.Title, n.Error)
	}

	in.Settings.DigestNews = false
	if buildDigest(in).News != nil {
		t.Fatal("news switched off but present")
	}
}

func TestDigestNewsNeverLeadsOverWhatNeedsTheReader(t *testing.T) {
	d := digestSnapshot{
		Updates: &digestUpdates{Available: []string{"plex:latest"}},
		News:    &digestNews{Releases: []string{"v1.20.0"}},
	}
	if n := digestNotice(d); !strings.Contains(n.Title, "container update") {
		t.Fatalf("title %q", n.Title)
	}
}

func TestDigestNewsReadsTheShippedFiles(t *testing.T) {
	// The newest shipped release, read the way the scheduler reads it: the
	// window around its own date finds it.
	data, err := readWhatsNewIndex()
	if err != nil {
		t.Skip("no index")
	}
	var index []struct {
		Tag           string `json:"tag"`
		ReleasedAt    string `json:"releasedAt"`
		HideFromModal bool   `json:"hideFromModal"`
	}
	if json.Unmarshal(data, &index) != nil || len(index) == 0 {
		t.Fatal("index unreadable")
	}
	for _, entry := range index {
		if entry.HideFromModal {
			continue
		}
		now := digestNow
		if parsed, err := time.Parse("2006-01-02", entry.ReleasedAt); err == nil {
			now = parsed.Add(12 * time.Hour)
		}
		releases := readRecentWhatsNewReleases(now)
		if len(releases) == 0 || releases[0].Tag != entry.Tag {
			t.Fatalf("want %s first, got %+v", entry.Tag, releases)
		}
		return
	}
}
