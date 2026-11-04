package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

const homepageServices = `
- Media:
    - Jellyfin:
        href: http://192.168.1.5:8096
        description: Films and series
        icon: jellyfin.png
        widget:
          type: jellyfin
          key: SECRET-KEY-NOT-TO-BE-COPIED
    - Players:
        - Sonarr:
            href: https://sonarr.lan
    - NoAddress:
        description: nothing to open
- Network:
    - Router:
        href: http://192.168.1.1
`

const homepageBookmarks = `
- Developer:
    - GitHub:
        - abbr: GH
          href: https://github.com
- Social:
    - Reddit:
        - icon: reddit.png
          href: https://reddit.com/r/selfhosted
`

const dashyConf = `
pageInfo:
  title: Home
sections:
  - name: Tools
    items:
      - title: Portainer
        url: http://nas:9000
        description: Containers
        subItems:
          - title: Portainer docs
            url: https://docs.portainer.io
      - title: Not a link
        url: ftp://nope
  - name: Empty
    items: []
`

const homerConf = `
title: Dashboard
links:
  - name: Contribute
    url: https://github.com/bastienwirtz/homer
services:
  - name: Apps
    icon: fas fa-cloud
    items:
      - name: Wiki
        subtitle: Notes
        tag: docs
        url: https://wiki.lan
      - name: Skipped
        url: /relative
`

func TestParseHomepageServices(t *testing.T) {
	rows, kind, err := ParseDashboardConfig([]byte(homepageServices))
	if err != nil || kind != "homepage" {
		t.Fatalf("kind=%q err=%v", kind, err)
	}
	got := map[string]string{}
	for _, r := range rows {
		got[r.Name] = r.Folder + "|" + r.URL + "|" + r.Note
	}
	want := map[string]string{
		"Jellyfin": "Media|http://192.168.1.5:8096|Films and series",
		"Sonarr":   "Players|https://sonarr.lan|",
		"Router":   "Network|http://192.168.1.1|",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("rows = %v, want %v", got, want)
	}
}

// A widget's key sits in the same file; it must never reach a bookmark.
func TestParseHomepageNeverCopiesAWidgetKey(t *testing.T) {
	rows, _, _ := ParseDashboardConfig([]byte(homepageServices))
	for _, r := range rows {
		for _, field := range []string{r.Name, r.URL, r.Folder, r.Note} {
			if field == "SECRET-KEY-NOT-TO-BE-COPIED" {
				t.Fatalf("a widget key was carried into %+v", r)
			}
		}
	}
}

func TestParseHomepageBookmarks(t *testing.T) {
	rows, kind, err := ParseDashboardConfig([]byte(homepageBookmarks))
	if err != nil || kind != "homepage" || len(rows) != 2 {
		t.Fatalf("kind=%q rows=%v err=%v", kind, rows, err)
	}
	if rows[0].Name != "GitHub" || rows[0].Folder != "Developer" || rows[0].URL != "https://github.com" {
		t.Errorf("first = %+v", rows[0])
	}
}

func TestParseDashy(t *testing.T) {
	rows, kind, err := ParseDashboardConfig([]byte(dashyConf))
	if err != nil || kind != "dashy" {
		t.Fatalf("kind=%q err=%v", kind, err)
	}
	if len(rows) != 2 || rows[0].Name != "Portainer" || rows[1].Name != "Portainer docs" || rows[0].Folder != "Tools" {
		t.Errorf("rows = %+v", rows)
	}
}

func TestParseHomer(t *testing.T) {
	rows, kind, err := ParseDashboardConfig([]byte(homerConf))
	if err != nil || kind != "homer" {
		t.Fatalf("kind=%q err=%v", kind, err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %+v", rows)
	}
	if rows[0].Name != "Wiki" || rows[0].Folder != "Apps" || rows[0].Note != "Notes" || !reflect.DeepEqual(rows[0].Tags, []string{"docs"}) {
		t.Errorf("wiki = %+v", rows[0])
	}
	if rows[1].Folder != "Links" {
		t.Errorf("links = %+v", rows[1])
	}
}

func TestParseDashboardConfigRefusesWhatItDoesNotKnow(t *testing.T) {
	for name, text := range map[string]string{
		"prose":        "just some words",
		"unknown map":  "title: x\ntheme: dark\n",
		"empty":        "",
		"broken yaml":  "- a:\n   - b: [",
		"no addresses": "- Group:\n    - Thing:\n        description: no href\n",
	} {
		if _, _, err := ParseDashboardConfig([]byte(text)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestLooksLikeDashboardConfig(t *testing.T) {
	if looksLikeDashboardConfig([]byte("  <!DOCTYPE NETSCAPE-Bookmark-file-1>")) {
		t.Error("an HTML bookmark file was taken for a dashboard configuration")
	}
	if !looksLikeDashboardConfig([]byte("\xef\xbb\xbf- Media:\n")) {
		t.Error("a YAML list was not recognised")
	}
}

func TestImportHTMLRouteReadsAHomepageFile(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	post := func(query string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/import-html?"+query, strings.NewReader(homepageServices))
		rec := httptest.NewRecorder()
		h.ImportBookmarksHTML(rec, req)
		return rec
	}

	dry := post("page=1&dryRun=1")
	if dry.Code != http.StatusOK {
		t.Fatalf("dry run = %d: %s", dry.Code, dry.Body.String())
	}
	var preview ImportPreview
	if err := json.Unmarshal(dry.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Total != 3 || preview.New != 3 || preview.Folders != 3 {
		t.Errorf("preview = %+v, want 3 links in 3 folders", preview)
	}

	real := post("page=1")
	if real.Code != http.StatusOK {
		t.Fatalf("import = %d: %s", real.Code, real.Body.String())
	}
	found := map[string]bool{}
	for _, b := range h.store.GetBookmarksByPage(1) {
		found[b.Name] = true
	}
	for _, name := range []string{"Jellyfin", "Sonarr", "Router"} {
		if !found[name] {
			t.Errorf("%s was not imported", name)
		}
	}
}

func TestImportHTMLRouteStillRefusesNonsense(t *testing.T) {
	h := newTestHandlers(t)
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/import-html?page=1&dryRun=1", strings.NewReader("not a bookmark file at all"))
	rec := httptest.NewRecorder()
	h.ImportBookmarksHTML(rec, req)
	// A file that is neither: the bookmark reader's own answer (an empty list
	// is a valid, empty file; nothing is invented from the words).
	var preview ImportPreview
	if rec.Code == http.StatusOK {
		_ = json.Unmarshal(rec.Body.Bytes(), &preview)
		if preview.Total != 0 {
			t.Errorf("prose produced %d links", preview.Total)
		}
	}
}

// A group that contains itself through an alias must end, not overflow the stack.
func TestParseHomepageSurvivesASelfReferringAlias(t *testing.T) {
	text := "- G: &x\n    - s:\n        href: http://a.example\n    - sub: *x\n"
	rows, _, err := ParseDashboardConfig([]byte(text))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(rows) != 1 || rows[0].URL != "http://a.example" {
		t.Errorf("rows = %+v", rows)
	}
}

// A few kilobytes of aliases that expand to millions of links are refused.
func TestParseDashboardConfigRefusesAnAliasBomb(t *testing.T) {
	var b strings.Builder
	b.WriteString("- G0: &l0\n    - s:\n        href: http://a.example\n")
	for i := 1; i <= 9; i++ {
		b.WriteString("- G" + string(rune('0'+i)) + ": &l" + string(rune('0'+i)) + "\n")
		for j := 0; j < 10; j++ {
			b.WriteString("    - s" + string(rune('a'+j)) + ": *l" + string(rune('0'+i-1)) + "\n")
		}
	}
	_, _, err := ParseDashboardConfig([]byte(b.String()))
	if err == nil {
		t.Fatal("an alias bomb was read")
	}
}

func TestParseDashboardConfigRefusesDeepNesting(t *testing.T) {
	var b strings.Builder
	indent := ""
	for i := 0; i < 40; i++ {
		b.WriteString(indent + "- G:\n")
		indent += "    "
	}
	b.WriteString(indent + "- s:\n" + indent + "    href: http://a.example\n")
	if _, _, err := ParseDashboardConfig([]byte(b.String())); err == nil {
		t.Fatal("40 levels of groups were read")
	}
}

// One group listing the same aliased mapping of services many times: the rows
// stop at the budget instead of running to list length times mapping size.
func TestParseHomepageAliasFanOutStopsAtTheBudget(t *testing.T) {
	var b strings.Builder
	b.WriteString("- G:\n  - &a\n")
	for i := 0; i < 300; i++ {
		b.WriteString("    s" + strconv.Itoa(i) + ": {href: http://x.example}\n")
	}
	for i := 0; i < 300; i++ {
		b.WriteString("  - *a\n")
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(b.String()), &doc); err != nil {
		t.Fatal(err)
	}
	reader := &configReader{onPath: map[*yaml.Node]bool{}}
	reader.homepageGroups(resolveAlias(doc.Content[0]), "", 0)
	if !reader.failed {
		t.Fatal("90,000 rows were read without failing")
	}
	if len(reader.rows) > dashboardConfigMaxRows+1 {
		t.Fatalf("kept %d rows past a budget of %d", len(reader.rows), dashboardConfigMaxRows)
	}
}
