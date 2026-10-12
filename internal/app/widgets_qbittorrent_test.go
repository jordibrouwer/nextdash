package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

const (
	qbTestUser     = "reader"
	qbTestPassword = "qb-pass-0123"
	qbTestKey      = "qbt_key0123456789"
)

// fakeQBittorrent answers from testdata/qbittorrent: shapes recorded from a
// real qBittorrent 5.1, names and hashes replaced.
type fakeQBittorrent struct {
	*httptest.Server
	mu       sync.Mutex
	paths    []string
	logins   int
	sid      string
	torrents []byte
}

func readQBFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "qbittorrent", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func newFakeQBittorrent(t *testing.T) *fakeQBittorrent {
	t.Helper()
	transfer := readQBFixture(t, "transfer.json")
	categories := readQBFixture(t, "categories.json")
	version := readQBFixture(t, "version.txt")
	fake := &fakeQBittorrent{torrents: readQBFixture(t, "torrents.json")}
	fake.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		fake.paths = append(fake.paths, r.URL.Path+"?"+r.URL.RawQuery)
		if r.URL.Path == "/api/v2/auth/login" {
			// qBittorrent answers 200 "Fails." to a wrong password, and to a
			// login without a Referer.
			if r.Header.Get("Referer") == "" || r.FormValue("username") != qbTestUser || r.FormValue("password") != qbTestPassword {
				_, _ = w.Write([]byte("Fails."))
				return
			}
			fake.logins++
			fake.sid = "sid-" + string(rune('a'+fake.logins))
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: fake.sid})
			_, _ = w.Write([]byte("Ok."))
			return
		}
		cookie, err := r.Cookie("SID")
		signedIn := err == nil && fake.sid != "" && cookie.Value == fake.sid
		if !signedIn && r.Header.Get("Authorization") != "Bearer "+qbTestKey {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case "/api/v2/torrents/info":
			_, _ = w.Write(fake.torrents)
		case "/api/v2/transfer/info":
			_, _ = w.Write(transfer)
		case "/api/v2/torrents/categories":
			_, _ = w.Write(categories)
		case "/api/v2/app/version":
			_, _ = w.Write(version)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(fake.Close)
	return fake
}

func (f *fakeQBittorrent) saw(part string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range f.paths {
		if strings.Contains(p, part) {
			return true
		}
	}
	return false
}

func qbLoginCredential(password string) HealthCredential {
	return HealthCredential{Label: "qBittorrent", Session: &CredentialSession{
		LoginPath: "/api/v2/auth/login", UserField: "username", PassField: "password",
		User: qbTestUser, Password: password, Referer: true}}
}

func qbTestSpec(t *testing.T, h *Handlers, fake *fakeQBittorrent, credential HealthCredential, config map[string]any) downloadSpec {
	t.Helper()
	allowLocalForTest(t, h, true)
	if err := saveHealthCredential("widget:w_qbit00000001", credential); err != nil {
		t.Fatal(err)
	}
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_qbit00000001", "filter": "all"}
	for k, v := range config {
		full[k] = v
	}
	return downloadSpecFrom(sanitizeWidgetConfig(WidgetTypeQBittorrent, full))
}

func itemByTitle(t *testing.T, items []MediaItem, title string) MediaItem {
	t.Helper()
	for _, item := range items {
		if item.Title == title {
			return item
		}
	}
	t.Fatalf("no %q among %d items", title, len(items))
	return MediaItem{}
}

func TestDownloadWidgetConfig(t *testing.T) {
	for _, widgetType := range []WidgetType{WidgetTypeQBittorrent, WidgetTypeSABnzbd} {
		clean := sanitizeWidgetConfig(widgetType, map[string]any{
			"server": "http://dl.lan:8080", "credentialId": "widget:w_000000000009",
			"filter": "paused", "sort": "speed", "hideCompleted": true, "hideTotals": true,
			"category": "movies", "layout": "hero", "ttl": float64(5),
		})
		if clean["filter"] != "paused" || clean["sort"] != "speed" || clean["hideCompleted"] != true ||
			clean["hideTotals"] != true || clean["category"] != "movies" {
			t.Errorf("%s kept: %#v", widgetType, clean)
		}
		if clean["layout"] != nil || clean["ttl"] != 15 {
			t.Errorf("%s narrowed: %#v", widgetType, clean)
		}
		for _, key := range []string{"server", "credentialId"} {
			if !withheldWidgetKeys[widgetType][key] {
				t.Errorf("%s: %s is handed to a tokenless reader", widgetType, key)
			}
		}
	}
	if spec := downloadSpecFrom(map[string]any{}); spec.Filter != "all" || spec.Sort != "added" || spec.TTL.Seconds() != 30 {
		t.Errorf("defaults: %+v", spec)
	}
}

func TestQBittorrentGroupsTorrents(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeQBittorrent(t)
	spec := qbTestSpec(t, h, fake, qbLoginCredential(qbTestPassword), nil)

	result, err := h.fetchQBittorrent(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 3 || len(result.Libraries) != 3 {
		t.Fatalf("%d items in %d groups", len(result.Items), len(result.Libraries))
	}
	busy := itemByTitle(t, result.Items, "Example.Movie.2024.2160p")
	if busy.LibraryID != "active" || busy.Progress == nil || *busy.Progress != 0.25 || busy.Speed != 5242880 ||
		busy.Size != 8589934592 || busy.Left != "0:12:34" || busy.Subtitle != "radarr" || busy.OpenURL != fake.URL {
		t.Errorf("downloading: %+v", busy)
	}
	// No metadata yet: nothing known, and nothing divided by it.
	waiting := itemByTitle(t, result.Items, "Example.Album.FLAC")
	if waiting.LibraryID != "paused" || waiting.Left != "" || waiting.Size != 0 || waiting.Progress == nil || *waiting.Progress != 0 {
		t.Errorf("paused without metadata: %+v", waiting)
	}
	seeding := itemByTitle(t, result.Items, "Example.Show.S01E01.1080p")
	if seeding.LibraryID != "done" || seeding.Left != "" {
		t.Errorf("seeding: %+v", seeding)
	}
	if result.Totals == nil || *result.Totals != (MediaTotals{Down: 5242880, Up: 1024, Active: 1, Paused: 1, Done: 1}) {
		t.Errorf("totals: %+v", result.Totals)
	}
	for _, item := range result.Items {
		if strings.Contains(item.ID, "aaaa") && len(item.ID) > 12 {
			t.Errorf("the full hash is handed out: %q", item.ID)
		}
	}
}

// qBittorrent 5 renamed paused to stopped; both read the same.
func TestQBittorrentStatesOfFourAndFive(t *testing.T) {
	cases := map[string]string{
		"downloading": "active", "stalledDL": "active", "metaDL": "active", "queuedDL": "active",
		"pausedDL": "paused", "stoppedDL": "paused", "error": "paused", "missingFiles": "paused",
		"uploading": "done", "stalledUP": "done", "pausedUP": "done", "stoppedUP": "done",
		"somethingNew": "active",
	}
	for state, want := range cases {
		if got := qbittorrentGroup(state).ID; got != want {
			t.Errorf("%s: %s, want %s", state, got, want)
		}
	}
}

func TestQBittorrentFilters(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeQBittorrent(t)

	spec := qbTestSpec(t, h, fake, qbLoginCredential(qbTestPassword), map[string]any{"filter": "active"})
	result, err := h.fetchQBittorrent(context.Background(), spec)
	if err != nil || len(result.Items) != 1 || result.Items[0].LibraryID != "active" || len(result.Libraries) != 1 {
		t.Fatalf("active: %v %+v", err, result.Items)
	}

	spec = qbTestSpec(t, h, fake, qbLoginCredential(qbTestPassword), map[string]any{"hideCompleted": true})
	result, _ = h.fetchQBittorrent(context.Background(), spec)
	for _, item := range result.Items {
		if item.LibraryID == "done" {
			t.Errorf("hideCompleted still shows %q", item.Title)
		}
	}
	// The totals count what is there, not what is shown.
	if result.Totals == nil || result.Totals.Done != 1 {
		t.Errorf("totals: %+v", result.Totals)
	}

	spec = qbTestSpec(t, h, fake, qbLoginCredential(qbTestPassword), map[string]any{"category": "radarr", "sort": "speed"})
	if _, err := h.fetchQBittorrent(context.Background(), spec); err != nil {
		t.Fatal(err)
	}
	if !fake.saw("category=radarr") || !fake.saw("sort=dlspeed") {
		t.Errorf("asked: %v", fake.paths)
	}

	spec = qbTestSpec(t, h, fake, qbLoginCredential(qbTestPassword), map[string]any{"rows": float64(2)})
	result, _ = h.fetchQBittorrent(context.Background(), spec)
	if len(result.Items) != 3 {
		t.Errorf("rows cut per group, not overall: %d items", len(result.Items))
	}
}

func TestQBittorrentSignsInOrTakesAKey(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeQBittorrent(t)

	spec := qbTestSpec(t, h, fake, HealthCredential{Headers: map[string]string{"Authorization": "Bearer " + qbTestKey}}, nil)
	if _, err := h.fetchQBittorrent(context.Background(), spec); err != nil {
		t.Fatalf("API key: %v", err)
	}
	if fake.logins != 0 {
		t.Errorf("signed in although a key was given")
	}

	spec = qbTestSpec(t, h, fake, qbLoginCredential("wrong"), nil)
	if _, err := h.fetchQBittorrent(context.Background(), spec); mediaErrorCode(err) != "key refused" {
		t.Errorf("wrong password: %v", err)
	}
}

func TestQBittorrentSetup(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeQBittorrent(t)
	body := map[string]any{"server": fake.URL, "draftCredential": map[string]any{"session": map[string]any{
		"loginPath": "/api/v2/auth/login", "userField": "username", "passField": "password",
		"user": qbTestUser, "password": qbTestPassword, "referer": true}}}
	raw, _ := json.Marshal(body)

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	rec := httptest.NewRecorder()
	h.qbittorrentSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/qbittorrent/setup", bytes.NewReader(raw)))
	if rec.Code != http.StatusUnauthorized || fake.logins != 0 {
		t.Fatalf("without the write token: %d", rec.Code)
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	rec = httptest.NewRecorder()
	h.qbittorrentSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/qbittorrent/setup", bytes.NewReader(raw)))
	var answer struct {
		ServerName string `json:"serverName"`
		Version    string `json:"version"`
		Categories []struct {
			ID, Name string
		} `json:"categories"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Error != "" || answer.ServerName != "qBittorrent" || answer.Version != "5.1.2" || len(answer.Categories) != 3 {
		t.Errorf("setup: %+v", answer)
	}
	if strings.Contains(rec.Body.String(), qbTestPassword) || strings.Contains(rec.Body.String(), "sid-") {
		t.Errorf("setup answer carries the password or the session")
	}
}

// A page template carries the address as a variable and leaves the category
// at home: it is a name on one client.
func TestQBittorrentTravelsWithoutItsCategory(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.store.SavePage(Page{ID: 7, Name: "Downloads"}); err != nil {
		t.Fatal(err)
	}
	if err := h.store.SavePageOrder(append(h.store.GetPageOrder(), 7)); err != nil {
		t.Fatal(err)
	}
	widget := Widget{ID: "w_dddddddddddd", Type: WidgetTypeQBittorrent, Title: "Torrents", Config: map[string]any{
		"server": "http://192.168.1.40:8080", "category": "movies", "credentialId": "widget:w_dddddddddddd", "filter": "paused"}}
	if err := h.store.SavePageBlocks(7, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	_, raw := exportTemplate(t, h, 7, TemplateExportOptions{})
	text := string(raw)
	for _, leak := range []string{"192.168.1.40", `"category"`, "widget:w_dddddddddddd"} {
		if strings.Contains(text, leak) {
			t.Errorf("the template carries %q", leak)
		}
	}
	if !strings.Contains(text, `"filter": "paused"`) {
		t.Errorf("the template lost the filter:\n%s", text)
	}
}
