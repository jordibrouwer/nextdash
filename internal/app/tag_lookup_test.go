package app

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeWikidata answers the lookup query from a table of host -> bindings and
// records every host name it was sent.
func fakeWikidata(t *testing.T, answers map[string][]map[string]string) (*atomic.Int32, *[]string) {
	t.Helper()
	var calls atomic.Int32
	var asked []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		raw, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(raw))
		query := form.Get("query")
		var rows []map[string]map[string]string
		for host, bindings := range answers {
			if !strings.Contains(query, "<https://"+host+"/>") {
				continue
			}
			for _, binding := range bindings {
				row := map[string]map[string]string{"site": {"value": "https://" + host + "/"}}
				for key, value := range binding {
					row[key] = map[string]string{"value": value}
				}
				rows = append(rows, row)
			}
		}
		for _, part := range strings.Split(query, "<https://") {
			if host, _, ok := strings.Cut(part, "/>"); ok && !strings.Contains(host, "www.") {
				asked = append(asked, host)
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"results": map[string]any{"bindings": rows}})
	}))
	t.Cleanup(server.Close)

	oldEndpoint, oldClient, oldResolve := tagLookupEndpoint, tagLookupClient, tagLookupResolve
	tagLookupEndpoint = server.URL
	tagLookupClient = func() *http.Client { return server.Client() }
	// Every *.example.org name is a public site; anything else does not exist.
	tagLookupResolve = func(_ context.Context, host string) ([]net.IPAddr, error) {
		if strings.HasSuffix(host, ".example.org") {
			return []net.IPAddr{{IP: net.ParseIP("93.184.215.14")}}, nil
		}
		return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
	}
	globalTagLookupCache = &tagLookupCache{}
	t.Cleanup(func() {
		tagLookupEndpoint, tagLookupClient, tagLookupResolve = oldEndpoint, oldClient, oldResolve
		globalTagLookupCache = &tagLookupCache{}
	})
	return &calls, &asked
}

func lookupForTest(t *testing.T, h *Handlers, hosts ...string) map[string]tagLookupEntry {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"hosts": hosts})
	rec := httptest.NewRecorder()
	h.TagLookup(rec, httptest.NewRequest(http.MethodPost, "/api/tags/lookup", strings.NewReader(string(body))))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Results map[string]tagLookupEntry `json:"results"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	return out.Results
}

func TestTagLookupFindsASubjectAndRemembersIt(t *testing.T) {
	h := newTestHandlers(t)
	calls, _ := fakeWikidata(t, map[string][]map[string]string{
		// A newspaper, and a crossword on the same site with fewer articles:
		// the newspaper speaks for the site.
		"krant.example.org": {
			{"item": "http://www.wikidata.org/entity/Q1", "links": "30", "classes": "Q11032", "about": "Dutch daily newspaper"},
			{"item": "http://www.wikidata.org/entity/Q2", "links": "2", "classes": "Q7889"},
		},
	})
	got := lookupForTest(t, h, "krant.example.org")
	if !reflect.DeepEqual(got["krant.example.org"].Tags, []string{"news"}) {
		t.Fatalf("got %+v, want news only", got)
	}
	if got["krant.example.org"].About != "Dutch daily newspaper" {
		t.Errorf("about: %q", got["krant.example.org"].About)
	}
	lookupForTest(t, h, "krant.example.org")
	if calls.Load() != 1 {
		t.Errorf("asked Wikidata %d times, want once: the second answer comes from the cache", calls.Load())
	}
}

func TestTagLookupReadsTheDescriptionWhenNoClassIsMapped(t *testing.T) {
	h := newTestHandlers(t)
	fakeWikidata(t, map[string][]map[string]string{
		"weer.example.org": {{"item": "http://www.wikidata.org/entity/Q3", "links": "4", "classes": "Q35127", "about": "Dutch weather website"}},
	})
	got := lookupForTest(t, h, "weer.example.org")
	if !reflect.DeepEqual(got["weer.example.org"].Tags, []string{"weather"}) {
		t.Errorf("got %+v, want weather", got)
	}
}

func TestTagLookupDropsAdultSites(t *testing.T) {
	h := newTestHandlers(t)
	fakeWikidata(t, map[string][]map[string]string{
		"x.example.org": {{"item": "http://www.wikidata.org/entity/Q4", "links": "9", "classes": "Q11032 Q4373046"}},
	})
	if got := lookupForTest(t, h, "x.example.org"); len(got) != 0 {
		t.Errorf("got %+v, want nothing", got)
	}
}

func TestTagLookupNeverSendsPrivateOrKnownHosts(t *testing.T) {
	h := newTestHandlers(t)
	calls, asked := fakeWikidata(t, map[string][]map[string]string{})
	body, _ := json.Marshal(map[string]any{"hosts": []string{"nas.lan", "immich.tail1234.ts.net", "router", "192.168.1.1", "100.100.1.2", "google.com", "www.github.com"}})
	rec := httptest.NewRecorder()
	h.TagLookup(rec, httptest.NewRequest(http.MethodPost, "/api/tags/lookup", strings.NewReader(string(body))))
	if calls.Load() != 0 {
		t.Errorf("asked Wikidata about %v; private and catalogued hosts must stay home", *asked)
	}
	var out struct {
		Skipped []string `json:"skipped"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	// Named as skipped, so the browser can say "not looked up"; a name
	// without a dot is no site at all and drops out before that.
	want := []string{"nas.lan", "immich.tail1234.ts.net", "192.168.1.1", "100.100.1.2"}
	if !reflect.DeepEqual(out.Skipped, want) {
		t.Errorf("skipped %v, want %v", out.Skipped, want)
	}
}

func TestTagLookupOffAsksNobody(t *testing.T) {
	h := newTestHandlers(t)
	calls, _ := fakeWikidata(t, map[string][]map[string]string{
		"krant.example.org": {{"item": "http://www.wikidata.org/entity/Q1", "links": "30", "classes": "Q11032"}},
	})
	settings := h.store.GetSettings()
	settings.TagLookupOnline = false
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	if got := lookupForTest(t, h, "krant.example.org"); len(got) != 0 || calls.Load() != 0 {
		t.Errorf("turned off, still asked: %d calls, %+v", calls.Load(), got)
	}
}

func TestTagLookupIsOnForAnInstallThatNeverAnswered(t *testing.T) {
	h := newTestHandlers(t)
	if !h.store.GetSettings().TagLookupOnline {
		t.Error("an install without the key should have it on")
	}
}

func TestTagLookupPrivateNames(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, host := range []string{"nas.lan", "printer.local", "x.home.arpa", "box.tailnet-1.ts.net", "10.0.0.2", "100.64.3.4", "localhost", "router"} {
		if !tagLookupPrivate(ctx, host) {
			t.Errorf("%s: want private", host)
		}
	}
}
