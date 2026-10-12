package app

import (
	"encoding/json"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

/*
The "New in nextDash" part of the weekly digest.

It is made from the same files the What's new window reads: every release that
came out in the digest's week, and in each the items its writer marked as a
highlight. A release with no highlight is named by its one-line lead instead,
so a week with a release never passes without it.
*/

type whatsNewItem struct {
	Badge     string `json:"badge"`
	Text      string `json:"text"`
	Title     string `json:"title"`
	Highlight bool   `json:"highlight"`
}

type whatsNewRelease struct {
	Tag        string `json:"tag"`
	ReleasedAt string `json:"releasedAt"`
	ModalLead  string `json:"modalLead"`
	Sections   []struct {
		Kind  string         `json:"kind"`
		Items []whatsNewItem `json:"items"`
	} `json:"sections"`
}

type digestNews struct {
	Releases   []string `json:"releases"`
	Highlights []string `json:"highlights,omitempty"`
}

// readWhatsNewFile prefers the copy on disk, as readWhatsNewIndex does.
func readWhatsNewFile(name string) ([]byte, error) {
	if data, err := os.ReadFile(filepath.Join("static", "data", "whats-new", name)); err == nil {
		return data, nil
	}
	return embeddedFiles.ReadFile("static/data/whats-new/" + name)
}

/*
readRecentWhatsNewReleases loads the releases of the last eight days, newest
first. A day more than the digest's week, so a release on the edge is read and
buildDigest decides; a release held back from the window is left out here too.
*/
func readRecentWhatsNewReleases(now time.Time) []whatsNewRelease {
	data, err := readWhatsNewIndex()
	if err != nil {
		return nil
	}
	var index []struct {
		ID            string `json:"id"`
		Tag           string `json:"tag"`
		ReleasedAt    string `json:"releasedAt"`
		HideFromModal bool   `json:"hideFromModal"`
	}
	if json.Unmarshal(data, &index) != nil {
		return nil
	}
	since := now.AddDate(0, 0, -8).Format("2006-01-02")
	var out []whatsNewRelease
	for _, entry := range index {
		id := entry.ID
		if id == "" {
			id = entry.Tag
		}
		if entry.HideFromModal || id == "" || entry.ReleasedAt < since || strings.ContainsAny(id, `/\`) {
			continue
		}
		raw, err := readWhatsNewFile(id + ".json")
		if err != nil {
			continue
		}
		var rel whatsNewRelease
		if json.Unmarshal(raw, &rel) != nil {
			continue
		}
		if rel.Tag == "" {
			rel.Tag = id
		}
		if rel.ReleasedAt == "" {
			rel.ReleasedAt = entry.ReleasedAt
		}
		out = append(out, rel)
	}
	return out
}

var (
	digestStrongRe = regexp.MustCompile(`(?is)<strong>(.*?)</strong>`)
	digestTagRe    = regexp.MustCompile(`<[^>]*>`)
)

// digestPlain is release HTML as one line of text.
func digestPlain(s string) string {
	s = html.UnescapeString(digestTagRe.ReplaceAllString(s, ""))
	return strings.Join(strings.Fields(s), " ")
}

// digestHighlightTitle is an item's short title, or the bold lead of its text.
func digestHighlightTitle(item whatsNewItem) string {
	if t := digestPlain(item.Title); t != "" {
		return t
	}
	text := item.Text
	if m := digestStrongRe.FindStringSubmatch(text); m != nil {
		text = m[1]
	}
	return strings.TrimRight(digestPlain(text), " .:,;")
}

// buildDigestNews is the part for the week ending at now, or nil.
func buildDigestNews(releases []whatsNewRelease, now time.Time) *digestNews {
	from := now.Add(-digestNewWindow).Format("2006-01-02")
	to := now.Format("2006-01-02")
	news := &digestNews{}
	for _, rel := range releases {
		if rel.ReleasedAt < from || rel.ReleasedAt > to {
			continue
		}
		news.Releases = append(news.Releases, rel.Tag)
		marked := false
		for _, section := range rel.Sections {
			for _, item := range section.Items {
				if !item.Highlight {
					continue
				}
				if title := digestHighlightTitle(item); title != "" {
					news.Highlights = append(news.Highlights, title)
					marked = true
				}
			}
		}
		if !marked {
			if lead := strings.TrimRight(digestPlain(rel.ModalLead), " ."); lead != "" {
				news.Highlights = append(news.Highlights, lead)
			}
		}
	}
	if len(news.Releases) == 0 {
		return nil
	}
	if len(news.Highlights) > digestNamesMax {
		news.Highlights = news.Highlights[:digestNamesMax]
	}
	return news
}
