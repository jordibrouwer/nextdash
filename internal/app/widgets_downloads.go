package app

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

/*
Download clients (qBittorrent, SABnzbd) on the shared media tile.

No pictures here: a line is a name, a bar, a speed and the time left, and the
tile adds one line on top with the client's own speeds and how many downloads
each group holds. The two clients share their settings, so a reader who moves
from one to the other finds the same panel.
*/

const (
	downloadDefaultRows = 6
	downloadDefaultTTL  = 30
	// downloadMinTTL is lower than the other media tiles' minute: a download
	// moves while you watch it.
	downloadMinTTL = 15
)

// The three tabs a download can sit under.
var (
	downloadActive = MediaGroup{ID: "active", Name: "Downloading"}
	downloadPaused = MediaGroup{ID: "paused", Name: "Paused"}
	downloadDone   = MediaGroup{ID: "done", Name: "Done"}
)

func downloadWidgetFields() []widgetField {
	return []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		{Key: "filter", Kind: "string", Allowed: []string{"active", "all", "paused", "completed"}},
		{Key: "sort", Kind: "string", Allowed: []string{"added", "progress", "speed"}},
		{Key: "hideCompleted", Kind: "bool"},
		{Key: "hideTotals", Kind: "bool"},
		// A qBittorrent category; SABnzbd ignores it.
		{Key: "category", Kind: "string"},
		{Key: "layout", Kind: "string", Allowed: []string{"list", "strip"}},
		{Key: "click", Kind: "string", Allowed: []string{"open", "detail"}},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "ttl", Kind: "int", Min: downloadMinTTL, Max: 3600},
	}
}

type downloadSpec struct {
	Server        string
	CredentialID  string
	Filter        string
	Sort          string
	Category      string
	HideCompleted bool
	Rows          int
	TTL           time.Duration
}

func downloadSpecFrom(config map[string]any) downloadSpec {
	spec := downloadSpec{
		Server:        strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID:  stringOr(config["credentialId"]),
		Filter:        stringOr(config["filter"]),
		Sort:          stringOr(config["sort"]),
		Category:      stringOr(config["category"]),
		HideCompleted: config["hideCompleted"] == true,
		Rows:          downloadDefaultRows,
		TTL:           downloadDefaultTTL * time.Second,
	}
	// All by default: an idle client still shows what it finished last.
	if spec.Filter == "" {
		spec.Filter = "all"
	}
	if spec.Sort == "" {
		spec.Sort = "added"
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, downloadMinTTL, 3600)) * time.Second
	}
	return spec
}

func (spec downloadSpec) fingerprint() string {
	return strings.Join([]string{spec.Server, spec.CredentialID, spec.Filter, spec.Sort, spec.Category,
		strconv.FormatBool(spec.HideCompleted), strconv.Itoa(spec.Rows)}, "|")
}

// groups are the tabs the filter shows, in order.
func (spec downloadSpec) groups() []MediaGroup {
	switch spec.Filter {
	case "active":
		return []MediaGroup{downloadActive}
	case "paused":
		return []MediaGroup{downloadPaused}
	case "completed":
		return []MediaGroup{downloadDone}
	}
	if spec.HideCompleted {
		return []MediaGroup{downloadActive, downloadPaused}
	}
	return []MediaGroup{downloadActive, downloadPaused, downloadDone}
}

// downloadLines keeps, in the order given, at most rows lines per shown group.
type downloadLines struct {
	shown    map[string]bool
	perGroup map[string]int
	rows     int
	items    []MediaItem
}

func newDownloadLines(spec downloadSpec) *downloadLines {
	lines := &downloadLines{shown: map[string]bool{}, perGroup: map[string]int{}, rows: spec.Rows, items: []MediaItem{}}
	for _, g := range spec.groups() {
		lines.shown[g.ID] = true
	}
	return lines
}

func (l *downloadLines) add(group MediaGroup, item MediaItem) {
	if !l.shown[group.ID] || l.perGroup[group.ID] >= l.rows {
		return
	}
	l.perGroup[group.ID]++
	item.Library, item.LibraryID = group.Name, group.ID
	l.items = append(l.items, item)
}

func (t *MediaTotals) count(group MediaGroup) {
	switch group.ID {
	case downloadActive.ID:
		t.Active++
	case downloadPaused.ID:
		t.Paused++
	case downloadDone.ID:
		t.Done++
	}
}

// downloadLeft words seconds as h:mm:ss, the way SABnzbd does; nothing for
// unknown or for no time at all.
func downloadLeft(seconds int64) string {
	if seconds <= 0 || seconds >= qbittorrentEtaUnknown {
		return ""
	}
	return fmt.Sprintf("%d:%02d:%02d", seconds/3600, seconds/60%60, seconds%60)
}

func downloadProgress(v float64) *float64 {
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	return &v
}
