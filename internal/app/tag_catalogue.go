package app

import (
	_ "embed"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

/*
The shipped tag catalogue, served a slice at a time.

The catalogue names subjects and the sites that belong to them. It used to
ship whole, as a static file every browser fetched; that was fine at two
thousand hosts and is not at fifteen thousand. So it lives in the binary and
the browser asks for the part that concerns it: every subject, because the
page-text source matches words against all of them, but only the hosts its own
bookmarks sit on.

The answer keeps the shape the engine has always read -- a list of subjects
with hosts -- so static/js/shared/tag-suggestions.js resolves a host exactly
as it did, with the one rule this file adds: a host written "=google.com"
matches itself and lends nothing to its subdomains.
*/

//go:embed tag_catalogue.json
var tagCatalogueJSON []byte

type tagCatalogueSubject struct {
	Tag     string   `json:"tag"`
	Aliases []string `json:"aliases"`
	Hosts   []string `json:"hosts"`
	// Derived is what the build (scripts/tag-catalogue) found for the
	// subject, beside the hand-written Hosts. Both resolve alike; the answer
	// to the browser folds them into Hosts.
	Derived  []string `json:"derived,omitempty"`
	Keywords []string `json:"keywords,omitempty"`
}

type tagCatalogueHost struct {
	subject int
	written string // as the file has it, "=" and all
	exact   bool
}

type tagCatalogue struct {
	version  int
	subjects []tagCatalogueSubject
	byHost   map[string][]tagCatalogueHost
}

// tagCatalogueMaxHosts bounds one POST. A collection of several thousand
// bookmarks sits on fewer hosts than that; anything past it is not a browser
// asking about its own links.
const tagCatalogueMaxHosts = 5000

var loadTagCatalogue = sync.OnceValue(func() *tagCatalogue {
	return parseTagCatalogue(tagCatalogueJSON)
})

func parseTagCatalogue(raw []byte) *tagCatalogue {
	var doc struct {
		Version int                   `json:"version"`
		Tags    []tagCatalogueSubject `json:"tags"`
	}
	catalogue := &tagCatalogue{byHost: map[string][]tagCatalogueHost{}}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return catalogue
	}
	catalogue.version = doc.Version
	catalogue.subjects = doc.Tags
	for i, subject := range doc.Tags {
		for _, written := range subject.allHosts() {
			exact := strings.HasPrefix(written, "=")
			host := strings.TrimPrefix(written, "=")
			catalogue.byHost[host] = append(catalogue.byHost[host], tagCatalogueHost{subject: i, written: written, exact: exact})
		}
	}
	return catalogue
}

/*
resolve finds the catalogue's entries for a host, or for the nearest parent
that has any.

The same walk as lookupHost in the engine: most specific suffix first, never a
bare TLD. An exact entry only answers for its own host, so a parent whose
entries are all exact is passed over and the walk goes on up -- maps.google.nl
must not become #search because google.nl is.
*/
func (c *tagCatalogue) resolve(host string) []tagCatalogueHost {
	host = normalizeCatalogueHost(host)
	if host == "" {
		return nil
	}
	labels := strings.Split(host, ".")
	for i := 0; i <= len(labels)-2; i++ {
		var found []tagCatalogueHost
		for _, entry := range c.byHost[strings.Join(labels[i:], ".")] {
			if i == 0 || !entry.exact {
				found = append(found, entry)
			}
		}
		if len(found) > 0 {
			return found
		}
	}
	return nil
}

// subjectsFor is the tags a host resolves to, in file order.
func (c *tagCatalogue) subjectsFor(host string) []string {
	var tags []string
	for _, entry := range c.resolve(host) {
		tags = append(tags, c.subjects[entry.subject].Tag)
	}
	return tags
}

/*
subset is every subject, each carrying only the hosts that answer for the
given ones. Written as the file writes them, so the engine reads the "=" the
same way the server did.
*/
func (c *tagCatalogue) subset(hosts []string) []tagCatalogueSubject {
	wanted := make([]map[string]bool, len(c.subjects))
	for _, host := range hosts {
		for _, entry := range c.resolve(host) {
			if wanted[entry.subject] == nil {
				wanted[entry.subject] = map[string]bool{}
			}
			wanted[entry.subject][entry.written] = true
		}
	}
	out := make([]tagCatalogueSubject, len(c.subjects))
	for i, subject := range c.subjects {
		picked := []string{}
		for _, written := range subject.allHosts() {
			if wanted[i][written] {
				picked = append(picked, written)
			}
		}
		out[i] = tagCatalogueSubject{Tag: subject.Tag, Aliases: subject.Aliases, Hosts: picked, Keywords: subject.Keywords}
	}
	return out
}

func (s tagCatalogueSubject) allHosts() []string {
	if len(s.Derived) == 0 {
		return s.Hosts
	}
	return append(append([]string{}, s.Hosts...), s.Derived...)
}

// normalizeCatalogueHost is patternsFor's host: lower case, no www.
func normalizeCatalogueHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	host = strings.TrimSuffix(strings.TrimPrefix(host, "www."), ".")
	if !strings.Contains(host, ".") {
		return ""
	}
	return host
}

func hostOfURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return parsed.Hostname()
}

// collectionHosts is every host the stored collection and the inbox sit on.
func (h *Handlers) collectionHosts() []string {
	seen := map[string]bool{}
	var hosts []string
	add := func(raw string) {
		host := normalizeCatalogueHost(hostOfURL(raw))
		if host != "" && !seen[host] {
			seen[host] = true
			hosts = append(hosts, host)
		}
	}
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			add(bm.URL)
		}
	}
	for _, item := range h.store.GetInboxItems() {
		add(item.URL)
	}
	return hosts
}

/*
TagCatalogue answers with the catalogue for the collection.

GET works out the hosts itself, from every page and the inbox, so the panels
that ask need know nothing about which links exist. POST takes a list instead:
for the link being typed into the add form, which the server has not stored
yet.
*/
func (h *Handlers) TagCatalogue(w http.ResponseWriter, r *http.Request) {
	var hosts []string
	switch r.Method {
	case http.MethodGet:
		hosts = h.collectionHosts()
	case http.MethodPost:
		var body struct {
			Hosts []string `json:"hosts"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
		if len(body.Hosts) > tagCatalogueMaxHosts {
			http.Error(w, "Too many hosts", http.StatusRequestEntityTooLarge)
			return
		}
		hosts = body.Hosts
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	catalogue := loadTagCatalogue()
	// The hosts the catalogue has nothing for: what the browser may ask
	// /api/tags/lookup about, when the reader has that turned on.
	unknown := []string{}
	seen := map[string]bool{}
	for _, raw := range hosts {
		host := normalizeCatalogueHost(raw)
		if host != "" && !seen[host] && len(catalogue.resolve(host)) == 0 {
			seen[host] = true
			unknown = append(unknown, host)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{
		"version": catalogue.version,
		"tags":    catalogue.subset(hosts),
		"unknown": unknown,
	})
}
