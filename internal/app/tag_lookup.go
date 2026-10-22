package app

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

/*
Looking up the sites the catalogue does not know.

The shipped catalogue names some fifty thousand sites, and a collection still
holds links to sites it has never heard of. For those the server asks
Wikidata, once per site: which item names this host as its official website
(P856), and what kind of thing that item is. The kinds go through the same
table the catalogue was built with (tag_qid_subjects.json), so a lookup and a
shipped entry agree on what a newspaper is called.

What leaves the server is the host name and nothing else -- not the path, not
the page, not the reader's tags -- and only for hosts that are on the public
internet: an address on the LAN, behind a tailnet or without a dot never goes
out. The reader can turn it off (Settings.TagLookupOnline); it is on unless
they do, and the check is here, at the source, rather than in the browser.

Answers are kept in tag-lookup-cache.json, a found site for ninety days and a
site Wikidata does not know for thirty, so a collection is asked about once
and not on every visit.
*/

//go:embed tag_qid_subjects.json
var tagQIDSubjectsJSON []byte

const (
	tagLookupHitTTL    = 90 * 24 * time.Hour
	tagLookupMissTTL   = 30 * 24 * time.Hour
	tagLookupMaxBatch  = 50
	tagLookupMinGap    = time.Second
	tagLookupUserAgent = "nextDash (https://github.com/jordibrouwer/nextDash) tag suggestions"
)

// tagLookupEndpoint is Wikidata's query service; a test points it elsewhere.
var tagLookupEndpoint = "https://query.wikidata.org/sparql"

// tagLookupClient is the outbound client; a test swaps it for one that may
// reach a local server.
var tagLookupClient = func() *http.Client {
	return newOutboundHTTPClientWithHeaderTimeout(false, 20*time.Second, 15*time.Second, 3)
}

type tagLookupEntry struct {
	Tags  []string `json:"tags,omitempty"`
	About string   `json:"about,omitempty"` // Wikidata's short description, shown as the reason
	At    int64    `json:"at"`
}

type tagLookupCache struct {
	mu      sync.Mutex
	loaded  bool
	entries map[string]tagLookupEntry
	// One query at a time, at least a second apart: the service is shared
	// and free, and asks its users to be gentle.
	queryMu  sync.Mutex
	lastSent time.Time
}

var globalTagLookupCache = &tagLookupCache{}

func tagLookupCacheFilePath() string {
	return filepath.Join(ResolveDataDir(), "tag-lookup-cache.json")
}

func (c *tagLookupCache) load() {
	if c.loaded {
		return
	}
	c.loaded = true
	c.entries = map[string]tagLookupEntry{}
	if data, err := os.ReadFile(tagLookupCacheFilePath()); err == nil {
		_ = json.Unmarshal(data, &c.entries)
	}
}

// fresh is the cached answer for a host, if it has not expired.
func (c *tagLookupCache) fresh(host string, now time.Time) (tagLookupEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	entry, ok := c.entries[host]
	if !ok {
		return entry, false
	}
	ttl := tagLookupMissTTL
	if len(entry.Tags) > 0 {
		ttl = tagLookupHitTTL
	}
	return entry, now.Sub(time.Unix(entry.At, 0)) < ttl
}

func (c *tagLookupCache) store(found map[string]tagLookupEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	for host, entry := range found {
		c.entries[host] = entry
	}
	_ = writeIndentJSONFile(tagLookupCacheFilePath(), c.entries)
}

// tagQIDTable is the class -> subject table, plus which classes mark a site
// as adult content.
type tagQIDTable struct {
	subjects map[string]string
	adult    map[string]bool
}

var loadTagQIDTable = sync.OnceValue(func() *tagQIDTable {
	table := &tagQIDTable{subjects: map[string]string{}, adult: map[string]bool{}}
	var raw map[string]json.RawMessage
	if json.Unmarshal(tagQIDSubjectsJSON, &raw) != nil {
		return table
	}
	for key, value := range raw {
		if key == "_adult" {
			var list []string
			_ = json.Unmarshal(value, &list)
			for _, q := range list {
				table.adult[q] = true
			}
			continue
		}
		var tag string
		if json.Unmarshal(value, &tag) == nil && tag != "" && strings.HasPrefix(key, "Q") {
			table.subjects[key] = tag
		}
	}
	return table
})

// Subjects that say how a site is made rather than what it is for, and
// channels it is published through; both rank behind a specific subject.
// The same order as scripts/tag-catalogue/classify.cjs.
var (
	tagLookupWeak    = map[string]bool{"publishing": true, "journals": true, "open-access": true, "magazine": true, "media": true, "reference": true, "broadcasting": true}
	tagLookupChannel = map[string]bool{"television": true, "radio": true, "podcasts": true, "film": true}
)

func tagLookupWeight(tag string) int {
	switch {
	case tagLookupWeak[tag]:
		return 2
	case tagLookupChannel[tag]:
		return 1
	}
	return 0
}

/*
tagLookupPrivate says whether a host must never be sent out.

Names first, because they need no lookup: no dot, the suffixes home networks
use, and tailnet names (*.ts.net resolves publicly to a 100.64/10 address).
Then the address itself, for an IP literal or a name that resolves only to
private space -- isPublicHost already knows those.
*/
func tagLookupPrivate(ctx context.Context, host string) bool {
	if !strings.Contains(host, ".") {
		return true
	}
	for _, suffix := range []string{".lan", ".local", ".localdomain", ".home.arpa", ".internal", ".intranet", ".corp", ".home", ".ts.net", ".localhost", ".test", ".invalid", ".example"} {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return !tagLookupPublicAddr(addr)
	}
	ips, err := tagLookupResolve(ctx, host)
	if err != nil || len(ips) == 0 {
		// A name that does not resolve is nobody's website.
		return true
	}
	for _, ip := range ips {
		addr, ok := netip.AddrFromSlice(ip.IP)
		if !ok || !tagLookupPublicAddr(addr.Unmap()) {
			return true
		}
	}
	return false
}

var tagLookupCGNAT = netip.MustParsePrefix("100.64.0.0/10")

// tagLookupResolve is the DNS lookup; a test answers it from a table.
var tagLookupResolve = net.DefaultResolver.LookupIPAddr

func tagLookupPublicAddr(addr netip.Addr) bool {
	return !(addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() ||
		addr.IsMulticast() || addr.IsUnspecified() || tagLookupCGNAT.Contains(addr))
}

func tagLookupSpellings(host string) []string {
	var out []string
	for _, scheme := range []string{"https", "http"} {
		for _, www := range []string{"", "www."} {
			for _, slash := range []string{"/", ""} {
				out = append(out, scheme+"://"+www+host+slash)
			}
		}
	}
	return out
}

// tagLookupQuery asks for every item that names one of these hosts as its
// website, with its classes (instance of, industry, has use, main subject),
// its English description and how many
// Wikipedias write about it.
func tagLookupQuery(hosts []string) string {
	var values []string
	for _, host := range hosts {
		for _, spelling := range tagLookupSpellings(host) {
			values = append(values, "<"+spelling+">")
		}
	}
	return `SELECT ?site ?item ?links ?about (GROUP_CONCAT(DISTINCT STRAFTER(STR(?class), "entity/"); separator=" ") AS ?classes) WHERE {
  VALUES ?site { ` + strings.Join(values, " ") + ` }
  ?item wdt:P856 ?site .
  OPTIONAL { ?item wdt:P31|wdt:P452|wdt:P366|wdt:P921 ?class }
  OPTIONAL { ?item wikibase:sitelinks ?links }
  OPTIONAL { ?item schema:description ?about FILTER(LANG(?about) = "en") }
} GROUP BY ?site ?item ?links ?about`
}

type tagLookupItem struct {
	links   int
	about   string
	classes []string
}

/*
tagLookupAsk sends one query for up to tagLookupMaxBatch hosts and returns
what it found per host. A host with no item is in the result with no tags,
so it is cached as a miss; a failed query returns an error and caches
nothing, so the next visit tries again.
*/
func (c *tagLookupCache) ask(ctx context.Context, hosts []string, now time.Time) (map[string]tagLookupEntry, error) {
	c.queryMu.Lock()
	defer c.queryMu.Unlock()
	if wait := tagLookupMinGap - time.Since(c.lastSent); wait > 0 {
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	c.lastSent = time.Now()

	form := url.Values{"query": {tagLookupQuery(hosts)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tagLookupEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/sparql-results+json")
	req.Header.Set("User-Agent", tagLookupUserAgent)
	resp, err := tagLookupClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wikidata: status %d", resp.StatusCode)
	}
	var body struct {
		Results struct {
			Bindings []map[string]struct {
				Value string `json:"value"`
			} `json:"bindings"`
		} `json:"results"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, resp.Body, 8<<20)).Decode(&body); err != nil {
		return nil, err
	}

	items := map[string]map[string]*tagLookupItem{}
	for _, row := range body.Results.Bindings {
		host := normalizeCatalogueHost(hostOfURL(row["site"].Value))
		item := row["item"].Value
		if host == "" || item == "" {
			continue
		}
		if items[host] == nil {
			items[host] = map[string]*tagLookupItem{}
		}
		known := items[host][item]
		if known == nil {
			known = &tagLookupItem{}
			items[host][item] = known
		}
		if n := atoiOrZero(row["links"].Value); n > known.links {
			known.links = n
		}
		if known.about == "" {
			known.about = row["about"].Value
		}
		known.classes = append(known.classes, strings.Fields(row["classes"].Value)...)
	}

	found := map[string]tagLookupEntry{}
	for _, host := range hosts {
		found[host] = tagLookupClassify(items[host], now)
	}
	return found, nil
}

func atoiOrZero(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return n
		}
		n = n*10 + int(r-'0')
	}
	return n
}

/*
tagLookupClassify turns the items found for a host into its subjects.

The main item -- the one most Wikipedias write about -- speaks for the site:
nytimes.com is also its crossword, and the crossword's classes are not the
newspaper's. Its specific subjects come first, channels after them, and the
weak ones only when nothing else was said. An item of an adult class drops
the site whatever else it is.
*/
func tagLookupClassify(items map[string]*tagLookupItem, now time.Time) tagLookupEntry {
	entry := tagLookupEntry{At: now.Unix()}
	if len(items) == 0 {
		return entry
	}
	table := loadTagQIDTable()
	known := map[string]bool{}
	for _, subject := range loadTagCatalogue().subjects {
		known[subject.Tag] = true
	}
	var main *tagLookupItem
	for _, item := range items {
		for _, q := range item.classes {
			if table.adult[q] {
				return entry
			}
		}
		if main == nil || item.links > main.links {
			main = item
		}
	}
	seen := map[string]bool{}
	var tags []string
	for _, q := range main.classes {
		tag := table.subjects[q]
		if tag != "" && known[tag] && !seen[tag] {
			seen[tag] = true
			tags = append(tags, tag)
		}
	}
	if len(tags) == 0 {
		tags = tagLookupFromAbout(main.about)
	}
	sort.SliceStable(tags, func(i, j int) bool { return tagLookupWeight(tags[i]) < tagLookupWeight(tags[j]) })
	if len(tags) > 2 {
		tags = tags[:2]
	}
	entry.Tags = tags
	if len(tags) > 0 {
		entry.About = main.about
	}
	return entry
}

// Words too general to name a subject on their own.
var tagLookupVague = map[string]bool{"website": true, "online": true, "platform": true, "service": true, "company": true,
	"web": true, "site": true, "portal": true, "app": true, "media": true, "business": true, "community": true,
	"network": true, "information": true, "blog": true, "magazine": true, "free": true, "internet": true,
	"provider": true, "stage": true, "learning": true, "listen": true, "watch": true, "stream": true}

var loadTagLookupNames = sync.OnceValue(func() map[string]string {
	names := map[string]string{}
	for _, subject := range loadTagCatalogue().subjects {
		for _, name := range append([]string{subject.Tag}, subject.Aliases...) {
			if _, taken := names[name]; !taken {
				names[name] = subject.Tag
			}
		}
	}
	return names
})

/*
tagLookupFromAbout reads a subject out of Wikidata's one-line description,
for an item whose classes the table does not map: "Dutch weather website"
says weather. Only a subject's own name or alias counts, matched as a
phrase of up to three words -- "search engine" finds search-engine.
*/
func tagLookupFromAbout(about string) []string {
	var words []string
	for _, word := range strings.FieldsFunc(strings.ToLower(about), func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9')
	}) {
		words = append(words, word)
	}
	names := loadTagLookupNames()
	seen := map[string]bool{}
	var tags []string
	for n := 3; n >= 1; n-- {
		for i := 0; i+n <= len(words); i++ {
			phrase := strings.Join(words[i:i+n], "-")
			if tagLookupVague[phrase] {
				continue
			}
			if tag, ok := names[phrase]; ok && !seen[tag] {
				seen[tag] = true
				tags = append(tags, tag)
			}
		}
	}
	return tags
}

/*
TagLookup answers what Wikidata says about hosts the catalogue does not know.

POST {"hosts": [...]}. Hosts the catalogue already resolves, private hosts
and hosts past the batch size are left out of the answer; the browser asks
again for the rest on its next pass. Answers from the cache cost nothing.
*/
func (h *Handlers) TagLookup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	var body struct {
		Hosts []string `json:"hosts"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if !h.store.GetSettings().TagLookupOnline {
		json.NewEncoder(w).Encode(map[string]any{"enabled": false, "results": map[string]any{}})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	now := time.Now()
	catalogue := loadTagCatalogue()
	results := map[string]tagLookupEntry{}
	var ask []string
	// Hosts that stay home -- the LAN, a tailnet, no dot -- named so the
	// browser can say "not looked up" rather than "nothing found".
	skipped := []string{}
	seen := map[string]bool{}
	for _, raw := range body.Hosts {
		host := normalizeCatalogueHost(raw)
		if host == "" || seen[host] || len(catalogue.resolve(host)) > 0 {
			continue
		}
		seen[host] = true
		if entry, ok := globalTagLookupCache.fresh(host, now); ok {
			if len(entry.Tags) > 0 {
				results[host] = entry
			}
			continue
		}
		if len(ask) >= tagLookupMaxBatch {
			continue
		}
		if tagLookupPrivate(ctx, host) {
			skipped = append(skipped, host)
			continue
		}
		ask = append(ask, host)
	}
	pending := 0
	if len(ask) > 0 {
		found, err := globalTagLookupCache.ask(ctx, ask, now)
		if err != nil {
			pending = len(ask)
		} else {
			globalTagLookupCache.store(found)
			for host, entry := range found {
				if len(entry.Tags) > 0 {
					results[host] = entry
				}
			}
		}
	}
	json.NewEncoder(w).Encode(map[string]any{"enabled": true, "results": results, "pending": pending, "skipped": skipped})
}
