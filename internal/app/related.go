package app

import (
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

/*
Related links.

For one bookmark, the few others that belong with it, found from what nextDash
already keeps and from nothing else: the tags they share, the site they are on,
and how often they are opened close together. No network, no page content, no
model.

The weights are deliberately plain numbers in one place (the constants below),
so that they can be tuned against real data without reading the algorithm.
*/

const (
	// relatedMax is how many links come back.
	relatedMax = 3
	// relatedMinScore is the least a bookmark needs. A tag scores ln(N/df), so
	// a tag on more than a third of the library (ln(3) = 1.1 is the line)
	// does not make a link related by itself: sharing "homelab" with everything
	// is no relation. Two middling tags together do.
	relatedMinScore = 1.0
	// relatedSiteCap is the most the same site adds. Like a tag, a site counts
	// for less the more of the library it is: ln(N / bookmarks on that site),
	// so forty github.com bookmarks in a library of a hundred are not each
	// other's relations by address alone, and two on a small site are.
	relatedSiteCap = 2.0
	// relatedCoOpenWindowMs is how close two opens must be to count as together.
	relatedCoOpenWindowMs = 10 * 60 * 1000
	// relatedCoOpenMinPairs is how many such pairs it takes before the signal
	// counts: one coincidence is not a habit.
	relatedCoOpenMinPairs = 2
	// relatedCoOpenPerPair is the score of each pair, up to relatedCoOpenCap.
	relatedCoOpenPerPair = 0.5
	relatedCoOpenCap     = 2.5
)

// relatedLink is one answer.
type relatedLink struct {
	Name    string   `json:"name"`
	URL     string   `json:"url"`
	PageID  int      `json:"pageId"`
	Reasons []string `json:"reasons"`

	score     float64
	openCount int
}

// relatedSite is the host and port without a leading "www.", for comparing
// sites. The port is part of it: on a home network every service answers on the
// same address, and the port is what tells Sonarr from Radarr.
func relatedSite(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Host), "www.")
}

// relatedLooseKey is an address without its scheme and a leading "www.", for
// telling the same page under two spellings from two pages.
func relatedLooseKey(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return ""
	}
	key := strings.TrimPrefix(strings.ToLower(u.Host), "www.") + strings.TrimSuffix(u.EscapedPath(), "/")
	if u.RawQuery != "" {
		key += "?" + u.RawQuery
	}
	return key
}

// coOpenPairs counts the opens of a that have an open of b within the window.
// Both logs are in time order (pruneOpenLog keeps them so), which lets one pass
// of two pointers do it.
func coOpenPairs(a, b []int64) int {
	pairs, j := 0, 0
	for _, t := range a {
		for j < len(b) && b[j] < t-relatedCoOpenWindowMs {
			j++
		}
		if j < len(b) && b[j] <= t+relatedCoOpenWindowMs {
			pairs++
			// One open of b pairs with one open of a: counted again for the
			// next open of a, one visit would read as a habit.
			j++
		}
	}
	return pairs
}

// sortedLog returns the open log in time order: the same slice when it
// already is, a sorted copy when it is not (a log stored by an older build or
// sent by a client is not pruned, so its order is not promised).
func sortedLog(log []int64) []int64 {
	if sort.SliceIsSorted(log, func(i, j int) bool { return log[i] < log[j] }) {
		return log
	}
	out := append([]int64(nil), log...)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// relatedTo ranks the bookmarks that belong with target, strongest first, at
// most relatedMax of them. all is every bookmark; target is matched by its
// canonical address.
func relatedTo(targetURL string, all []Bookmark) []relatedLink {
	key := canonicalBookmarkURLKey(targetURL)
	if key == "" {
		return []relatedLink{}
	}
	// The pool: not the hidden Unsorted page, and one row per address. The same
	// address on two pages is one bookmark with the tags and the opens of both,
	// so that what the reader hovered is not decided by which page file is read
	// first.
	index := map[string]int{}
	pool := make([]Bookmark, 0, len(all))
	for _, b := range all {
		if b.PageID == unsortedPageID {
			continue
		}
		k := canonicalBookmarkURLKey(b.URL)
		if k == "" {
			continue
		}
		if at, seen := index[k]; seen {
			merged := &pool[at]
			merged.Tags = append(append([]string{}, merged.Tags...), b.Tags...)
			merged.OpenLog = append(append([]int64{}, merged.OpenLog...), b.OpenLog...)
			if b.OpenCount > merged.OpenCount {
				merged.OpenCount = b.OpenCount
			}
			continue
		}
		index[k] = len(pool)
		pool = append(pool, b)
	}
	at, found := index[key]
	if !found {
		return []relatedLink{}
	}
	target := &pool[at]

	// How common each tag is, for the weight of sharing it.
	df := map[string]int{}
	for _, b := range pool {
		for _, tag := range normalizeTags(b.Tags) {
			df[tag]++
		}
	}
	n := float64(len(pool))
	siteCount := map[string]int{}
	for _, b := range pool {
		if site := relatedSite(b.URL); site != "" {
			siteCount[site]++
		}
	}
	targetTags := map[string]bool{}
	for _, tag := range normalizeTags(target.Tags) {
		targetTags[tag] = true
	}
	site := relatedSite(target.URL)
	targetLoose := relatedLooseKey(target.URL)
	targetLog := sortedLog(target.OpenLog)

	out := make([]relatedLink, 0, len(pool))
	for _, b := range pool {
		if canonicalBookmarkURLKey(b.URL) == key {
			continue
		}
		// The same page under http and https, or with and without "www.", is
		// the bookmark itself rather than a relation of it.
		if targetLoose != "" && relatedLooseKey(b.URL) == targetLoose {
			continue
		}
		var score float64
		reasons := []string{}
		var tagScore float64
		for _, tag := range normalizeTags(b.Tags) {
			if targetTags[tag] {
				tagScore += math.Log(n / float64(df[tag]))
			}
		}
		if tagScore > 0 {
			score += tagScore
			reasons = append(reasons, "tags")
		}
		if site != "" && relatedSite(b.URL) == site {
			score += math.Min(math.Log(n/float64(siteCount[site])), relatedSiteCap)
			reasons = append(reasons, "site")
		}
		if pairs := coOpenPairs(targetLog, sortedLog(b.OpenLog)); pairs >= relatedCoOpenMinPairs {
			score += math.Min(float64(pairs)*relatedCoOpenPerPair, relatedCoOpenCap)
			reasons = append(reasons, "coopen")
		}
		if len(reasons) == 0 || score < relatedMinScore {
			continue
		}
		out = append(out, relatedLink{
			Name: b.Name, URL: b.URL, PageID: b.PageID, Reasons: reasons,
			score: score, openCount: b.OpenCount,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].score != out[j].score {
			return out[i].score > out[j].score
		}
		if out[i].openCount != out[j].openCount {
			return out[i].openCount > out[j].openCount
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	if len(out) > relatedMax {
		out = out[:relatedMax]
	}
	return out
}

// RelatedLinks answers GET /api/related?url=<address>: up to three bookmarks
// that belong with that one. Read-only, like GET /api/bookmarks.
func (h *Handlers) RelatedLinks(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	target := strings.TrimSpace(r.URL.Query().Get("url"))
	links := relatedTo(target, h.store.GetAllBookmarks())
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(links)
}
