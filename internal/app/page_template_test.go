package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"github.com/gorilla/mux"
)

// A one-pixel PNG.
var templateTestPNG, _ = base64.StdEncoding.DecodeString(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")

func templateTestRouter(h *Handlers) *mux.Router {
	r := mux.NewRouter()
	r.HandleFunc("/api/pages/{id:[0-9]+}/template/hosts", h.PageTemplateHosts).Methods("GET")
	r.HandleFunc("/api/pages/{id:[0-9]+}/template", h.ExportPageTemplate).Methods("POST")
	r.HandleFunc("/api/pages/template", h.ImportPageTemplate).Methods("POST")
	return r
}

// seedTemplatePage writes a homelab page: two links on one LAN host, one on
// another, a public one, a notes widget and a custom widget with a key.
func seedTemplatePage(t *testing.T, h *Handlers) int {
	t.Helper()
	page := Page{ID: 5, Name: "Homelab", Icon: "🏠", Color: "#336699"}
	if err := h.store.SavePage(page); err != nil {
		t.Fatal(err)
	}
	if err := h.store.SavePageOrder(append(h.store.GetPageOrder(), 5)); err != nil {
		t.Fatal(err)
	}
	categories := []Category{{ID: "media", Name: "Media"}, {ID: "net", Name: "Network", Spread: true}}
	if err := h.store.SaveCategoriesByPage(5, categories); err != nil {
		t.Fatal(err)
	}
	iconsDir := filepath.Join(ResolveDataDir(), "icons")
	_ = os.MkdirAll(iconsDir, 0o755)
	if err := os.WriteFile(filepath.Join(iconsDir, "icon-jelly.png"), templateTestPNG, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(iconsDir, "icon-evil.svg"), []byte(`<svg onload="alert(1)"/>`), 0o644); err != nil {
		t.Fatal(err)
	}
	bookmarks := []Bookmark{
		{Name: "Jellyfin", URL: "http://192.168.1.10:8096/web/index.html", Category: "media", Icon: "icon-jelly.png",
			Tags: []string{"media"}, Pinned: true, Shortcut: "j", OpenCount: 41, LastOpened: 1700000000000,
			CheckStatus: true, LastError: "timeout", CreatedAt: 1600000000000},
		{Name: "Jellyfin admin", URL: "http://192.168.1.10:8096/web/#/dashboard", Category: "media"},
		{Name: "Pi-hole", URL: "http://pihole.lan/admin/?token=s3cret&view=1", Category: "net", Icon: "icon-evil.svg"},
		{Name: "Docs", URL: "https://jellyfin.org/docs", Category: "media"},
	}
	if err := h.store.SaveBookmarksByPage(5, bookmarks); err != nil {
		t.Fatal(err)
	}
	widgets := []Widget{
		{ID: "w_aaaaaaaaaaaa", Type: WidgetTypeNotes, Config: map[string]any{"text": "wifi password is hunter2"}},
		{ID: "w_bbbbbbbbbbbb", Type: WidgetTypeCustom, Title: "Sonarr", Config: map[string]any{
			"url": "http://192.168.1.20:8989/api/v3/queue?apikey=abc123&pageSize=5"}},
	}
	if err := h.store.SavePageBlocks(5, widgets, []string{"w_bbbbbbbbbbbb", "media", "net", "w_aaaaaaaaaaaa"}); err != nil {
		t.Fatal(err)
	}
	return 5
}

func exportTemplate(t *testing.T, h *Handlers, pageID int, options TemplateExportOptions) (PageTemplate, []byte) {
	t.Helper()
	body, _ := json.Marshal(options)
	rec := httptest.NewRecorder()
	templateTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/pages/5/template", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("export answered %d: %s", rec.Code, rec.Body.String())
	}
	var tpl PageTemplate
	if err := json.Unmarshal(rec.Body.Bytes(), &tpl); err != nil {
		t.Fatalf("export is not JSON: %v", err)
	}
	return tpl, rec.Body.Bytes()
}

func importTemplate(t *testing.T, h *Handlers, file []byte, values map[string]string, dryRun bool) (int, TemplateImportResult, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"template": json.RawMessage(file), "values": values})
	target := "/api/pages/template"
	if dryRun {
		target += "?dryRun=1"
	}
	rec := httptest.NewRecorder()
	templateTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, target, bytes.NewReader(body)))
	var result TemplateImportResult
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	return rec.Code, result, rec.Body.String()
}

func TestTemplateLeavesUsageHealthAndSecretsAtHome(t *testing.T) {
	h := newTestHandlers(t)
	seedTemplatePage(t, h)
	_, raw := exportTemplate(t, h, 5, TemplateExportOptions{})
	text := string(raw)
	for _, leak := range []string{"192.168.1.10", "192.168.1.20", "pihole.lan", "s3cret", "abc123", "hunter2",
		"openCount", "lastOpened", "checkStatus", "lastError", "createdAt", "timeout", "svg"} {
		if strings.Contains(text, leak) {
			t.Errorf("the template carries %q:\n%s", leak, text)
		}
	}
	for _, kept := range []string{"https://jellyfin.org/docs", "{{jellyfin}}/web/index.html", "{{pi-hole}}/admin/?view=1",
		"{{sonarr}}/api/v3/queue?pageSize=5", `"pinned": true`, `"shortcut": "j"`} {
		if !strings.Contains(text, kept) {
			t.Errorf("the template lost %q:\n%s", kept, text)
		}
	}
}

// The file is built from an allowlist: a field on Bookmark nobody has decided
// about does not travel. This fails when templateBookmark grows a field that
// is not one of the ones below -- read the reason in page_template.go first.
func TestTemplateBookmarkIsAnAllowlist(t *testing.T) {
	want := []string{"Name", "URL", "Category", "Tags", "Pinned", "Shortcut", "Icon", "IconMode"}
	var got []string
	typ := reflect.TypeOf(templateBookmark{})
	for i := 0; i < typ.NumField(); i++ {
		got = append(got, typ.Field(i).Name)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("templateBookmark fields = %v, want %v", got, want)
	}
}

func TestNotesTextOnlyWhenAskedFor(t *testing.T) {
	h := newTestHandlers(t)
	seedTemplatePage(t, h)
	_, raw := exportTemplate(t, h, 5, TemplateExportOptions{IncludeNotes: true})
	if !strings.Contains(string(raw), "hunter2") {
		t.Fatal("includeNotes did not keep the note")
	}
}

func TestPrivateHostsAreProposedAsVariables(t *testing.T) {
	cases := map[string]bool{
		"192.168.1.10": true, "10.0.0.1": true, "172.20.1.1": true, "127.0.0.1": true, "localhost": true,
		"nas": true, "nas.lan": true, "pi.local": true, "x.home.arpa": true, "fd00::1": true,
		"jellyfin.org": false, "8.8.8.8": false, "my.example.com": false,
	}
	for host, want := range cases {
		if got := isTemplatePrivateHost(host); got != want {
			t.Errorf("isTemplatePrivateHost(%q) = %v, want %v", host, got, want)
		}
	}
	hosts := detectTemplateHosts([]Bookmark{
		{Name: "Home Assistant", URL: "http://192.168.1.5:8123/"},
		{Name: "HA logs", URL: "http://192.168.1.5:8123/logs"},
		{Name: "Home Assistant", URL: "http://10.0.0.5/"},
	}, nil)
	if len(hosts) != 2 || hosts[0].Key != "home-assistant" || hosts[0].Count != 2 || hosts[1].Key != "home-assistant-2" {
		t.Fatalf("hosts = %+v", hosts)
	}
}

func TestImportFillsVariablesAndMakesANewPage(t *testing.T) {
	h := newTestHandlers(t)
	seedTemplatePage(t, h)
	_, raw := exportTemplate(t, h, 5, TemplateExportOptions{})

	code, preview, body := importTemplate(t, h, raw, nil, true)
	if code != http.StatusOK {
		t.Fatalf("dry run answered %d: %s", code, body)
	}
	if preview.Name != "Homelab (2)" || preview.PageID != 0 {
		t.Fatalf("dry run = %+v", preview)
	}
	byKey := map[string]int{}
	for _, v := range preview.Variables {
		byKey[v.Key] = v.Count
	}
	if byKey["jellyfin"] != 2 || byKey["pi-hole"] != 1 || byKey["sonarr"] != 1 {
		t.Fatalf("variables = %+v", preview.Variables)
	}
	if len(h.store.GetPages()) != 2 {
		t.Fatal("a dry run wrote a page")
	}

	// Jellyfin filled in, Pi-hole left empty: its link is skipped, not dead.
	code, result, body := importTemplate(t, h, raw, map[string]string{"jellyfin": "https://media.example.net/", "sonarr": "10.1.1.1:8989"}, false)
	if code != http.StatusOK || result.PageID == 0 {
		t.Fatalf("import answered %d: %s", code, body)
	}
	if result.Skipped.Unfilled != 1 || result.Bookmarks != 3 {
		t.Fatalf("result = %+v", result)
	}
	got := h.store.GetBookmarksByPage(result.PageID)
	urls := []string{}
	for _, b := range got {
		urls = append(urls, b.URL)
		if b.OpenCount != 0 || b.LastOpened != 0 || b.LastError != "" {
			t.Errorf("usage came along: %+v", b)
		}
	}
	want := []string{"https://media.example.net/web/index.html", "https://media.example.net/web/#/dashboard", "https://jellyfin.org/docs"}
	if !reflect.DeepEqual(urls, want) {
		t.Fatalf("urls = %v, want %v", urls, want)
	}
	if got[0].Icon == "" || got[0].Icon == "icon-jelly.png" || got[0].Category != "media" || !got[0].Pinned {
		t.Errorf("first bookmark = %+v", got[0])
	}
	// The receiver already has "j" (the original page): the shortcut stays theirs.
	if got[0].Shortcut != "" || result.Skipped.Shortcuts != 1 {
		t.Errorf("shortcut j was taken and still imported: %+v", got[0])
	}

	widgets, order := h.store.GetPageBlocks(result.PageID)
	if len(widgets) != 2 {
		t.Fatalf("widgets = %+v", widgets)
	}
	for _, w := range widgets {
		if w.ID == "w_aaaaaaaaaaaa" || w.ID == "w_bbbbbbbbbbbb" {
			t.Errorf("widget kept the sender's id %s", w.ID)
		}
		if w.Type == WidgetTypeCustom && w.Config["url"] != "http://10.1.1.1:8989/api/v3/queue?pageSize=5" {
			t.Errorf("custom url = %v", w.Config["url"])
		}
		if w.Type == WidgetTypeNotes && w.Config["text"] != nil && w.Config["text"] != "" {
			t.Errorf("note text arrived: %v", w.Config["text"])
		}
	}
	if len(order) != 4 || order[1] != "media" || order[2] != "net" || order[0] != widgets[1].ID && order[0] != widgets[0].ID {
		t.Errorf("order = %v", order)
	}
	pageOrder := h.store.GetPageOrder()
	if pageOrder[len(pageOrder)-1] != result.PageID {
		t.Errorf("the new page is not last: %v", pageOrder)
	}
}

func TestImportRefusesWhatIsNotATemplate(t *testing.T) {
	h := newTestHandlers(t)
	for name, file := range map[string]string{
		"not json":     `hello`,
		"wrong kind":   `{"nextdash":"look","version":1}`,
		"from future":  `{"nextdash":"page-template","version":99,"name":"x","categories":[],"bookmarks":[]}`,
		"page as file": `{"page":{"id":1,"name":"x"},"bookmarks":[]}`,
	} {
		if code, _, _ := importTemplate(t, h, []byte(file), nil, true); code != http.StatusUnprocessableEntity && code != http.StatusBadRequest {
			t.Errorf("%s: answered %d", name, code)
		}
	}
	big := `{"nextdash":"page-template","version":1,"name":"` + strings.Repeat("x", pageTemplateMaxBytes) + `"}`
	if code, _, _ := importTemplate(t, h, []byte(big), nil, true); code == http.StatusOK {
		t.Error("an oversized file was accepted")
	}
}

func TestImportDropsHostileContent(t *testing.T) {
	h := newTestHandlers(t)
	svg := "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(`<svg onload="alert(1)"/>`))
	lying := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte(`<svg onload="alert(1)"/>`))
	file := `{"nextdash":"page-template","version":1,"name":"Evil","color":"red;}body{x","categories":[{"id":"a","name":"A"}],
		"widgets":[{"id":"w1","type":"keylogger","config":{}},{"id":"w2","type":"notes","config":{"text":"hi","pageId":3}}],
		"blockOrder":["w1","w2","a","ghost"],
		"icons":{"s":"` + svg + `","l":"` + lying + `"},
		"bookmarks":[
			{"name":"js","url":"javascript:alert(1)","category":"a"},
			{"name":"data","url":"data:text/html,hi"},
			{"name":"svg","url":"https://a.example/","icon":"s"},
			{"name":"lie","url":"https://b.example/","icon":"l","category":"nope"},
			{"name":"dup","url":"https://a.example/"}
		]}`
	code, result, body := importTemplate(t, h, []byte(file), nil, false)
	if code != http.StatusOK {
		t.Fatalf("answered %d: %s", code, body)
	}
	if result.Bookmarks != 2 || result.Skipped.Bookmarks != 2 || result.Skipped.Duplicates != 1 || result.Skipped.Icons != 2 {
		t.Fatalf("result = %+v", result)
	}
	if len(result.Skipped.Widgets) != 1 || result.Skipped.Widgets[0] != "keylogger" {
		t.Errorf("skipped widgets = %v", result.Skipped.Widgets)
	}
	for _, page := range h.store.GetPages() {
		if page.ID == result.PageID && page.Color != "" {
			t.Errorf("color %q came through", page.Color)
		}
	}
	for _, b := range h.store.GetBookmarksByPage(result.PageID) {
		if b.Icon != "" {
			t.Errorf("%s got an icon from a file that is not a raster image", b.Name)
		}
		if b.Name == "lie" && b.Category != "" {
			t.Errorf("bookmark kept a category the template does not have: %q", b.Category)
		}
	}
	widgets, order := h.store.GetPageBlocks(result.PageID)
	if len(widgets) != 1 || len(order) != 2 {
		t.Errorf("widgets %+v order %v", widgets, order)
	}
}

func TestPastedTemplateTextImportsLikeAFile(t *testing.T) {
	h := newTestHandlers(t)
	seedTemplatePage(t, h)
	_, raw := exportTemplate(t, h, 5, TemplateExportOptions{})
	pasted, _ := json.Marshal(string(raw))
	code, result, body := importTemplate(t, h, pasted, nil, true)
	if code != http.StatusOK || result.Name == "" {
		t.Fatalf("pasted text answered %d: %s", code, body)
	}
}

func TestTemplateFillsAnEmptyPageAndNoOther(t *testing.T) {
	h := newTestHandlers(t)
	seedTemplatePage(t, h)
	_, raw := exportTemplate(t, h, 5, TemplateExportOptions{})
	if err := h.store.SavePage(Page{ID: 7, Name: "Fresh"}); err != nil {
		t.Fatal(err)
	}
	if err := h.store.SavePageOrder(append(h.store.GetPageOrder(), 7)); err != nil {
		t.Fatal(err)
	}
	pagesBefore := len(h.store.GetPages())

	fill := func(into int) (int, TemplateImportResult) {
		body, _ := json.Marshal(map[string]any{"template": json.RawMessage(raw), "intoPage": into,
			"values": map[string]string{"jellyfin": "http://10.9.9.9:8096"}})
		rec := httptest.NewRecorder()
		templateTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/pages/template", bytes.NewReader(body)))
		var result TemplateImportResult
		_ = json.Unmarshal(rec.Body.Bytes(), &result)
		return rec.Code, result
	}

	// The seeded page has bookmarks: filling it would merge, so it is refused.
	if code, _ := fill(5); code != http.StatusConflict {
		t.Fatalf("filling a page with bookmarks answered %d", code)
	}
	code, result := fill(7)
	if code != http.StatusOK || result.PageID != 7 || result.Name != "Fresh" {
		t.Fatalf("fill answered %d: %+v", code, result)
	}
	if len(h.store.GetPages()) != pagesBefore {
		t.Error("filling a page made another one")
	}
	if got := h.store.GetBookmarksByPage(7); len(got) != 3 || got[0].URL != "http://10.9.9.9:8096/web/index.html" {
		t.Errorf("bookmarks = %+v", got)
	}
	// Now it is not empty, and a second fill is refused.
	if code, _ := fill(7); code != http.StatusConflict {
		t.Errorf("a second fill answered %d", code)
	}
}

// A shortcut comes in only as the bookmark form stores one: one to five
// letters, upper case, not a finder's or another bookmark's.
func TestImportKeepsOnlyShortcutsTheFormCouldStore(t *testing.T) {
	h := newTestHandlers(t)
	file := []byte(`{"nextdash":"page-template","version":1,"name":"Keys","categories":[],"bookmarks":[
		{"name":"a","url":"https://a.example/","shortcut":"jf"},
		{"name":"b","url":"https://b.example/","shortcut":"jf-1!"},
		{"name":"c","url":"https://c.example/","shortcut":"TOOLONG"}]}`)
	code, result, body := importTemplate(t, h, file, nil, false)
	if code != http.StatusOK {
		t.Fatalf("import answered %d: %s", code, body)
	}
	if result.Skipped.Shortcuts != 2 {
		t.Fatalf("skipped shortcuts = %d, want 2", result.Skipped.Shortcuts)
	}
	got := map[string]string{}
	for _, bm := range h.store.GetBookmarksByPage(result.PageID) {
		got[bm.Name] = bm.Shortcut
	}
	if got["a"] != "JF" || got["b"] != "" || got["c"] != "" {
		t.Fatalf("shortcuts = %v", got)
	}
}

// A label longer than the limit is cut between characters, not inside one.
func TestTemplateLabelsAreCutByCharacter(t *testing.T) {
	name := strings.Repeat("é", 59) + "中文"
	hosts := detectTemplateHosts([]Bookmark{{Name: name, URL: "http://nas.lan/"}}, nil)
	if len(hosts) != 1 {
		t.Fatalf("hosts = %+v", hosts)
	}
	if !utf8.ValidString(hosts[0].Label) || utf8.RuneCountInString(hosts[0].Label) != templateMaxLabelLength {
		t.Fatalf("label %q is not %d whole characters", hosts[0].Label, templateMaxLabelLength)
	}
}

// Imports at the same moment each get a page of their own.
func TestConcurrentImportsMakeSeparatePages(t *testing.T) {
	h := newTestHandlers(t)
	seedTemplatePage(t, h)
	_, raw := exportTemplate(t, h, 5, TemplateExportOptions{})

	const n = 4
	ids := make(chan int, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body, _ := json.Marshal(map[string]any{"template": json.RawMessage(raw)})
			rec := httptest.NewRecorder()
			templateTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/pages/template", bytes.NewReader(body)))
			var result TemplateImportResult
			_ = json.Unmarshal(rec.Body.Bytes(), &result)
			ids <- result.PageID
		}()
	}
	wg.Wait()
	close(ids)
	seen := map[int]bool{}
	for id := range ids {
		if id == 0 || seen[id] {
			t.Fatalf("import got page id %d twice or not at all (seen %v)", id, seen)
		}
		seen[id] = true
	}
}
