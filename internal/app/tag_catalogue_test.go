package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
)

// The fixture is the catalogue's contract with the reader: a well-known site
// gets the subject anyone would give it, and a subdomain does not inherit a
// subject that is not its own.
func TestTagCatalogueResolvesTheFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/tag-catalogue-expect.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Expect map[string][]string `json:"expect"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	catalogue := loadTagCatalogue()
	if catalogue.version != 2 || len(catalogue.subjects) < 400 {
		t.Fatalf("catalogue did not load: version %d, %d subjects", catalogue.version, len(catalogue.subjects))
	}
	for host, want := range fixture.Expect {
		got := catalogue.subjectsFor(host)
		if len(want) == 0 && len(got) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s: got %v, want %v", host, got, want)
		}
	}
}

func TestTagCatalogueExactHostLendsNothingToSubdomains(t *testing.T) {
	catalogue := parseTagCatalogue([]byte(`{"version":2,"tags":[
		{"tag":"search","aliases":[],"hosts":["=example.com"]},
		{"tag":"docs","aliases":[],"hosts":["example.org"]}
	]}`))
	if got := catalogue.subjectsFor("example.com"); !reflect.DeepEqual(got, []string{"search"}) {
		t.Errorf("exact host itself: got %v", got)
	}
	if got := catalogue.subjectsFor("maps.example.com"); got != nil {
		t.Errorf("subdomain of an exact host: got %v, want nothing", got)
	}
	if got := catalogue.subjectsFor("wiki.example.org"); !reflect.DeepEqual(got, []string{"docs"}) {
		t.Errorf("subdomain of a plain host: got %v", got)
	}
}

func TestTagCatalogueSubsetKeepsEverySubjectButOnlyAskedHosts(t *testing.T) {
	catalogue := loadTagCatalogue()
	subset := catalogue.subset([]string{"www.google.com", "docs.docker.com"})
	if len(subset) != len(catalogue.subjects) {
		t.Fatalf("subset has %d subjects, catalogue %d", len(subset), len(catalogue.subjects))
	}
	hosts := map[string][]string{}
	for _, subject := range subset {
		if len(subject.Hosts) > 0 {
			hosts[subject.Tag] = subject.Hosts
		}
	}
	want := map[string][]string{"search": {"=google.com"}, "containers": {"docker.com"}}
	if !reflect.DeepEqual(hosts, want) {
		t.Errorf("got %v, want %v", hosts, want)
	}
}

func TestTagCatalogueEndpoint(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.store.AddBookmarkToPage(1, Bookmark{Name: "Google", URL: "https://www.google.com/"}); err != nil {
		t.Fatal(err)
	}

	decode := func(rec *httptest.ResponseRecorder) map[string][]string {
		t.Helper()
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Tags []tagCatalogueSubject `json:"tags"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		out := map[string][]string{}
		for _, subject := range body.Tags {
			if len(subject.Hosts) > 0 {
				out[subject.Tag] = subject.Hosts
			}
		}
		return out
	}

	rec := httptest.NewRecorder()
	h.TagCatalogue(rec, httptest.NewRequest(http.MethodGet, "/api/tags/catalogue", nil))
	if got := decode(rec); !reflect.DeepEqual(got["search"], []string{"=google.com"}) {
		t.Errorf("GET from the stored collection: got %v", got)
	}

	rec = httptest.NewRecorder()
	h.TagCatalogue(rec, httptest.NewRequest(http.MethodPost, "/api/tags/catalogue",
		strings.NewReader(`{"hosts":["bing.com"]}`)))
	if got := decode(rec); !reflect.DeepEqual(got, map[string][]string{"search": {"bing.com"}}) {
		t.Errorf("POST with a host list: got %v", got)
	}
}
