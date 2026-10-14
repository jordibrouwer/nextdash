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
	if catalogue.version != 3 || len(catalogue.subjects) < 400 {
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
	var withStats struct {
		Stats map[string]int `json:"stats"`
	}
	json.Unmarshal(rec.Body.Bytes(), &withStats)
	if got := decode(rec); !reflect.DeepEqual(got["search"], []string{"=google.com"}) {
		t.Errorf("GET from the stored collection: got %v", got)
	}
	// The panel's words: the catalogue's size, and how much of the
	// collection it knows -- google.com among the collection's sites.
	if s := withStats.Stats; s["sites"] < 1000 || s["subjects"] < 400 || s["yours"] < 1 || s["unknown"] > s["yours"] {
		t.Errorf("stats: %v", s)
	}

	rec = httptest.NewRecorder()
	h.TagCatalogue(rec, httptest.NewRequest(http.MethodPost, "/api/tags/catalogue",
		strings.NewReader(`{"hosts":["bing.com"]}`)))
	if got := decode(rec); !reflect.DeepEqual(got, map[string][]string{"search": {"bing.com"}}) {
		t.Errorf("POST with a host list: got %v", got)
	}
}

// What the build derived resolves like a hand-written host, and the browser
// sees one list.
func TestTagCatalogueDerivedHostsResolveAndFoldIntoHosts(t *testing.T) {
	catalogue := parseTagCatalogue([]byte(`{"version":2,"tags":[
		{"tag":"news","aliases":[],"hosts":["nu.nl"],"derived":["nos.nl"]}
	]}`))
	if got := catalogue.subjectsFor("nos.nl"); !reflect.DeepEqual(got, []string{"news"}) {
		t.Errorf("derived host: got %v", got)
	}
	subset := catalogue.subset([]string{"nos.nl", "nu.nl"})
	if !reflect.DeepEqual(subset[0].Hosts, []string{"nu.nl", "nos.nl"}) || subset[0].Derived != nil {
		t.Errorf("subset: hosts %v, derived %v", subset[0].Hosts, subset[0].Derived)
	}
}

// Every parent the shipped file names is a subject, and no chain comes back on
// itself: the engine would stop at a cycle, but one in the file is a mistake.
func TestTagCatalogueParentsFormATree(t *testing.T) {
	catalogue := loadTagCatalogue()
	byTag := map[string]tagCatalogueSubject{}
	for _, subject := range catalogue.subjects {
		byTag[subject.Tag] = subject
	}
	withParent := 0
	for _, subject := range catalogue.subjects {
		if subject.Parent == "" {
			continue
		}
		withParent++
		seen := map[string]bool{subject.Tag: true}
		for up := subject.Parent; up != ""; up = byTag[up].Parent {
			if _, ok := byTag[up]; !ok {
				t.Fatalf("%s: parent %q is not a subject", subject.Tag, up)
			}
			if seen[up] {
				t.Fatalf("%s: parent chain comes back to %q", subject.Tag, up)
			}
			seen[up] = true
		}
	}
	if withParent < 200 {
		t.Errorf("only %d subjects have a parent", withParent)
	}
}

// The browser gets each subject's parent with the subset, hosts or not: the
// engine needs the whole tree to find the reader's word for a subject.
func TestTagCatalogueSubsetCarriesParents(t *testing.T) {
	catalogue := parseTagCatalogue([]byte(`{"version":3,"tags":[
		{"tag":"sports","aliases":[],"hosts":[]},
		{"tag":"soccer","aliases":[],"parent":"sports","hosts":["fifa.com"]}
	]}`))
	subset := catalogue.subset([]string{"nu.nl"})
	if subset[1].Parent != "sports" || len(subset[1].Hosts) != 0 {
		t.Errorf("subset: parent %q, hosts %v", subset[1].Parent, subset[1].Hosts)
	}
}

// Every app names catalogue subjects, at most two, and ids are unique: the
// engine resolves an app's tags through the catalogue's tree, and a tag that
// is not a subject would have no aliases and no parent to find the reader's
// word by.
func TestTagAppsNameCatalogueSubjects(t *testing.T) {
	subjects := map[string]bool{}
	for _, subject := range loadTagCatalogue().subjects {
		subjects[subject.Tag] = true
	}
	apps := loadTagApps()
	if len(apps) < 200 {
		t.Fatalf("only %d apps loaded", len(apps))
	}
	ids := map[string]bool{}
	for _, app := range apps {
		if app.ID == "" || ids[app.ID] {
			t.Errorf("app id %q is empty or used twice", app.ID)
		}
		ids[app.ID] = true
		if len(app.Tags) == 0 || len(app.Tags) > 2 {
			t.Errorf("%s: %d tags", app.ID, len(app.Tags))
		}
		for _, tag := range app.Tags {
			if !subjects[tag] {
				t.Errorf("%s: tag %q is not a catalogue subject", app.ID, tag)
			}
		}
		if len(app.Names) == 0 && len(app.Labels) == 0 {
			t.Errorf("%s: nothing to recognise it by", app.ID)
		}
		for _, name := range app.Names {
			if name != strings.ToLower(name) {
				t.Errorf("%s: name %q is not lower case", app.ID, name)
			}
		}
	}
}
