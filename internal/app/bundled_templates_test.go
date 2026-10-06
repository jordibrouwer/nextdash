package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func applyOnboardingTemplate(t *testing.T, h *Handlers, req OnboardingTemplateRequest) (int, map[string]any) {
	t.Helper()
	t.Setenv("NEXTDASH_DISABLE_PREFETCH", "1")
	body, _ := json.Marshal(req)
	rec := httptest.NewRecorder()
	h.ApplyOnboardingTemplate(rec, httptest.NewRequest(http.MethodPost, "/api/onboarding/template", bytes.NewReader(body)))
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func bookmarkURLsByName(bookmarks []Bookmark) map[string]string {
	out := map[string]string{}
	for _, bookmark := range bookmarks {
		out[bookmark.Name] = bookmark.URL
	}
	return out
}

// Each shipped template reads as a template, proposes an address for every
// variable, and keeps the project's own link.
func TestBundledTemplatesParseAndProposeEveryAddress(t *testing.T) {
	for _, id := range bundledTemplateIDs {
		raw, ok := bundledTemplateRaw(id)
		if !ok {
			t.Fatalf("%s: not embedded", id)
		}
		tpl, err := parsePageTemplate(raw)
		if err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		used := map[string]bool{}
		for _, bookmark := range tpl.Bookmarks {
			if match := templateRefRE.FindStringSubmatch(bookmark.URL); match != nil {
				used[match[1]] = true
			}
		}
		for _, variable := range tpl.Variables {
			if variable.Default == "" {
				t.Errorf("%s: variable %q has no default", id, variable.Key)
			}
			if _, ok := expandTemplateDefault(variable.Default, "192.168.1.10"); !ok {
				t.Errorf("%s: default %q does not expand", id, variable.Default)
			}
			if !used[variable.Key] {
				t.Errorf("%s: variable %q is used by no link", id, variable.Key)
			}
		}
		found := false
		for _, bookmark := range tpl.Bookmarks {
			found = found || bookmark.URL == "https://nextdash.cc/"
		}
		if !found {
			t.Errorf("%s: lost the nextdash.cc link", id)
		}
		if bytes.Contains(raw, []byte(`"credentialId"`)) {
			t.Errorf("%s: carries a credential reference", id)
		}
	}
}

func TestServerAddressFillsTheDefault(t *testing.T) {
	cases := []struct{ def, server, want string }{
		{"http://{server}:8096", "192.168.1.10", "http://192.168.1.10:8096"},
		{"http://{server}:8096", "nas.local/", "http://nas.local:8096"},
		{"http://{server}:8096", "https://nas.local", "https://nas.local:8096"},
		{"https://{server}:8006", "nas.local:443", "https://nas.local:443"},
		{"http://{server}", "nas.local", "http://nas.local"},
		{"http://192.168.1.1", "", "http://192.168.1.1"},
	}
	for _, c := range cases {
		got, ok := expandTemplateDefault(c.def, c.server)
		if !ok || got != c.want {
			t.Errorf("expand(%q, %q) = %q, %v; want %q", c.def, c.server, got, ok, c.want)
		}
	}
	for _, bad := range []string{"", "nas.local/media", "me@nas.local", "nas.local?x=1", "ftp://nas.local"} {
		if got, ok := expandTemplateDefault("http://{server}:8096", bad); ok {
			t.Errorf("expand(%q) = %q, want refused", bad, got)
		}
	}
}

func TestDefaultMainPageIsWhatAFreshInstallWrites(t *testing.T) {
	h := newTestHandlers(t)
	if !h.isUntouchedMainPage() {
		t.Fatal("a fresh install's main page does not count as untouched")
	}
}

// Main still the seed: the template takes its place, on the one address.
func TestTemplateReplacesAnUntouchedMainPage(t *testing.T) {
	h := newTestHandlers(t)
	code, out := applyOnboardingTemplate(t, h, OnboardingTemplateRequest{ID: "media-server", Server: "192.168.1.10",
		Values: map[string]string{"qbittorrent": "http://10.0.0.5:8081"}})
	if code != http.StatusOK || out["replaced"] != true {
		t.Fatalf("status %d, %v", code, out)
	}
	urls := bookmarkURLsByName(h.store.GetBookmarksByPage(1))
	if urls["Jellyfin"] != "http://192.168.1.10:8096/" || urls["qBittorrent"] != "http://10.0.0.5:8081/" {
		t.Errorf("addresses: %v", urls)
	}
	if _, ok := urls["YouTube"]; ok {
		t.Error("the starter links stayed")
	}
	if urls["nextDash"] != "https://nextdash.cc/" {
		t.Error("the nextdash.cc link is missing")
	}
	shortcuts := map[string]string{}
	for _, bookmark := range h.store.GetBookmarksByPage(1) {
		shortcuts[bookmark.Name] = bookmark.Shortcut
	}
	// The starter links' own letters are not in the way of the template's.
	if shortcuts["Sonarr"] != "S" || shortcuts["nextDash"] != "N" {
		t.Errorf("shortcuts: %v", shortcuts)
	}
	for _, page := range h.store.GetPages() {
		if page.ID == 1 && page.Name != "Media server" {
			t.Errorf("main is named %q", page.Name)
		}
	}
	if len(h.store.GetPages()) != 1 {
		t.Errorf("%d pages, want 1", len(h.store.GetPages()))
	}
}

// A main page somebody changed is theirs: the template comes as a new page.
func TestTemplateLeavesAChangedMainPageAlone(t *testing.T) {
	for name, change := range map[string]func(h *Handlers){
		"a link renamed": func(h *Handlers) {
			bookmarks := h.store.GetBookmarksByPage(1)
			bookmarks[1].Name = "My GitHub"
			_ = h.store.SaveBookmarksByPage(1, bookmarks)
		},
		"a link added": func(h *Handlers) {
			bookmarks := append(h.store.GetBookmarksByPage(1), Bookmark{Name: "Mine", URL: "https://example.com/"})
			_ = h.store.SaveBookmarksByPage(1, bookmarks)
		},
		"the note edited": func(h *Handlers) {
			widgets, order := h.store.GetPageBlocks(1)
			for i := range widgets {
				if widgets[i].Type == WidgetTypeNotes {
					widgets[i].Config = map[string]any{"text": "mine"}
				}
			}
			_ = h.store.SavePageBlocks(1, widgets, order)
		},
	} {
		t.Run(name, func(t *testing.T) {
			h := newTestHandlers(t)
			change(h)
			code, out := applyOnboardingTemplate(t, h, OnboardingTemplateRequest{ID: "homelab", Server: "nas.local"})
			if code != http.StatusOK || out["replaced"] != false {
				t.Fatalf("status %d, %v", code, out)
			}
			if _, ok := bookmarkURLsByName(h.store.GetBookmarksByPage(1))["Google"]; !ok {
				t.Error("main lost its links")
			}
			result, _ := out["result"].(map[string]any)
			pageID := int(result["pageId"].(float64))
			if urls := bookmarkURLsByName(h.store.GetBookmarksByPage(pageID)); urls["Home Assistant"] != "http://nas.local:8123/" {
				t.Errorf("new page: %v", urls)
			}
		})
	}
}

func TestOnboardingRefusesAnAddressWithAPath(t *testing.T) {
	h := newTestHandlers(t)
	code, _ := applyOnboardingTemplate(t, h, OnboardingTemplateRequest{ID: "homelab", Server: "nas.local/admin"})
	if code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", code)
	}
	if !h.isUntouchedMainPage() {
		t.Error("a refused address still changed main")
	}
}

func TestExportNeverWritesADefault(t *testing.T) {
	h := newTestHandlers(t)
	applyOnboardingTemplate(t, h, OnboardingTemplateRequest{ID: "media-server", Server: "192.168.1.10"})
	_, raw := exportTemplate(t, h, 1, TemplateExportOptions{})
	if strings.Contains(string(raw), `"default"`) || strings.Contains(string(raw), "{server}") {
		t.Errorf("the export carries a default:\n%s", raw)
	}
}

func TestBundledListSaysWhetherMainIsReplaced(t *testing.T) {
	h := newTestHandlers(t)
	read := func() map[string]any {
		rec := httptest.NewRecorder()
		h.BundledTemplates(rec, httptest.NewRequest(http.MethodGet, "/api/page-templates/bundled", nil))
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	first := read()
	if first["replacesMain"] != true || len(first["templates"].([]any)) != 3 {
		t.Fatalf("%v", first)
	}
	applyOnboardingTemplate(t, h, OnboardingTemplateRequest{ID: "developer", Server: "192.168.1.10"})
	if read()["replacesMain"] != false {
		t.Error("main still offered for replacing after a template took it")
	}
}
