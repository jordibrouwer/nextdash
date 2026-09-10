package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
seedBookmarkForTest leaves exactly one bookmark in the collection.

Replacing rather than adding: a fresh store ships with eight real bookmarks on
page 1, and a scan round walks every page. Adding to them would make each of
these tests fetch eight live websites -- slow, flaky, and rude to the sites.
*/
func seedBookmarkForTest(t *testing.T, h *Handlers, url string) {
	t.Helper()
	for _, page := range h.store.GetPages() {
		id := page.ID
		err := h.store.MutateBookmarksOnPage(id, func([]Bookmark) ([]Bookmark, error) {
			if id == 1 {
				return []Bookmark{{Name: "Seeded", URL: url}}, nil
			}
			return nil, nil
		})
		if err != nil {
			t.Fatalf("clearing page %d: %v", id, err)
		}
	}
}

func decodeJSONForTest(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding %q: %v", recorder.Body.String(), err)
	}
	return body
}

func postForTest(t *testing.T, handler http.HandlerFunc, path string) map[string]any {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, nil)
	recorder := httptest.NewRecorder()
	handler(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body.String())
	}
	return decodeJSONForTest(t, recorder)
}

func TestExtractKeywordsReadsTheFourPlaces(t *testing.T) {
	head := `<html><head>
		<meta name="keywords" content="Kubernetes, helm charts, ops">
		<meta property="article:tag" content="containers">
		<meta property="article:tag" content="observability">
		<meta property="og:section" content="Infrastructure">
		</head>`
	// The h1 is read from the body sample, because the head read stops at
	// </head> -- reading it from the head alone silently found nothing.
	body := `<body><h1>Running <em>etcd</em> in production</h1></body></html>`

	got := extractKeywords(head, body)
	joined := strings.Join(got, " ")
	for _, want := range []string{"kubernetes", "helm", "charts", "containers", "observability", "infrastructure", "etcd", "production"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in %v", want, got)
		}
	}
	// Lowercased, and the h1's own markup is not part of a word.
	for _, word := range got {
		if strings.ToLower(word) != word {
			t.Errorf("keyword %q was not lowercased", word)
		}
		if strings.ContainsAny(word, "<>/") {
			t.Errorf("keyword %q carries markup", word)
		}
	}
}

func TestExtractKeywordsReadsTheTitleAndDescription(t *testing.T) {
	// No tags of any kind: what such a page says about itself is all there is,
	// and most of the web is this page.
	head := `<html><head><title>Bazarr — Subtitles for Sonarr and Radarr</title>
		<meta name="description" content="Manage and download subtitles automatically.">
		</head>`

	got := extractKeywords(head, "")
	joined := strings.Join(got, " ")
	for _, want := range []string{"bazarr", "subtitles", "sonarr", "radarr", "download"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in %v", want, got)
		}
	}
	// The title's separator is not part of a word, and the words a page says
	// because it is a page are gone.
	for _, unwanted := range []string{"—", "and", "manage", "for"} {
		for _, word := range got {
			if word == unwanted {
				t.Errorf("kept %q, which carries no subject", unwanted)
			}
		}
	}
}

func TestExtractKeywordsPrefersTheDeliberateSources(t *testing.T) {
	var filler []string
	for i := 0; i < 20; i++ {
		filler = append(filler, "prose"+string(rune('a'+i)))
	}
	head := `<html><head><title>` + strings.Join(filler, " ") + `</title>
		<meta name="keywords" content="kubernetes, helm">
		</head>`

	got := extractKeywords(head, "")
	// The cap is what keeps prose in its place: a keywords tag was written to
	// file the page, a title to sell it, so the tag fills the slots first.
	if len(got) < 2 || got[0] != "kubernetes" || got[1] != "helm" {
		t.Errorf("the keywords tag did not come first: %v", got)
	}
}

func TestExtractKeywordsIsBoundedAndDeduplicated(t *testing.T) {
	var words []string
	for i := 0; i < 40; i++ {
		words = append(words, "word"+string(rune('a'+i%26)))
	}
	doc := `<meta name="keywords" content="` + strings.Join(words, ", ") + `">`
	got := extractKeywords(doc, "")
	if len(got) > keywordMaxCount {
		t.Errorf("kept %d keywords, want at most %d", len(got), keywordMaxCount)
	}
	seen := map[string]struct{}{}
	for _, word := range got {
		if _, dup := seen[word]; dup {
			t.Errorf("keyword %q appears twice in %v", word, got)
		}
		seen[word] = struct{}{}
	}
}

func TestNormalizeKeywordDropsWhatCannotDiscriminate(t *testing.T) {
	cases := map[string]string{
		"Kubernetes":  "kubernetes",
		"  helm,  ":   "helm",
		"open-source": "open-source",
		"of":          "", // below the length floor
		"2026":        "", // a date, not a subject
		"a-very-long-keyword-that-is-really-a-sentence-in-disguise": "",
		"naïve": "", // not ASCII, so not a word the catalogue can hold
		"#tag":  "tag",
		// A page says these because it is a page, not because of its subject.
		// "javascript" is the one that mattered: it is a real catalogue
		// subject, so a JavaScript-required notice would have filed a cooking
		// blog under code.
		"javascript": "",
		"Sign":       "",
		"your":       "",
	}
	for input, want := range cases {
		if got := normalizeKeyword(input); got != want {
			t.Errorf("normalizeKeyword(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestTagScanStoresKeywordsAndSkipsWhatItAlreadyRead(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><head><title>Ops</title>
			<meta name="keywords" content="kubernetes, helm">
			</head><body></body></html>`))
	}))
	defer service.Close()

	seedBookmarkForTest(t, h, service.URL)

	before := len(h.tagScanTargets())
	if before != 1 {
		t.Fatalf("expected one bookmark waiting to be read, got %d", before)
	}

	body := postForTest(t, h.TagScan, "/api/tags/scan")
	if body["read"] != float64(1) {
		t.Errorf("read = %v, want 1 (body %v)", body["read"], body)
	}
	if body["found"] != float64(1) {
		t.Errorf("found = %v, want 1 (body %v)", body["found"], body)
	}

	key := canonicalBookmarkURLKey(service.URL)
	entry, ok := h.getPreviewCacheEntry(key)
	if !ok {
		t.Fatal("nothing was written to the preview cache")
	}
	if len(entry.Keywords) == 0 {
		t.Errorf("no keywords stored: %+v", entry)
	}

	// Read once is read: the second round has nothing left to do, so a round
	// can finish rather than circling the same pages forever.
	if after := len(h.tagScanTargets()); after != 0 {
		t.Errorf("%d targets still waiting after a successful read", after)
	}
}

func TestTagScanCountsAnUnreadablePageAsSkippedRatherThanFailing(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer service.Close()

	seedBookmarkForTest(t, h, service.URL)

	body := postForTest(t, h.TagScan, "/api/tags/scan")
	if body["failed"] != float64(1) {
		t.Errorf("failed = %v, want 1 (body %v)", body["failed"], body)
	}
	// Still recorded, so the round moves on rather than offering it again.
	if after := len(h.tagScanTargets()); after != 0 {
		t.Errorf("a page that could not be read is still queued (%d left)", after)
	}
}

func TestTagScanStatusReportsTheCostWithoutFetching(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	seedBookmarkForTest(t, h, "https://example.com/one")

	request := httptest.NewRequest(http.MethodGet, "/api/tags/scan", nil)
	recorder := httptest.NewRecorder()
	h.TagScanStatus(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	body := decodeJSONForTest(t, recorder)
	if body["pending"] != float64(1) {
		t.Errorf("pending = %v, want 1", body["pending"])
	}
	// And it read nothing: the entry would exist if it had.
	if _, ok := h.getPreviewCacheEntry(canonicalBookmarkURLKey("https://example.com/one")); ok {
		t.Error("the status route fetched a page")
	}
}

func TestTagKeywordsClearKeepsTheRestOfThePreview(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><head><title>Ops handbook</title>
			<meta name="keywords" content="kubernetes, helm">
			<meta name="description" content="Running clusters.">
			</head><body></body></html>`))
	}))
	defer service.Close()

	seedBookmarkForTest(t, h, service.URL)
	postForTest(t, h.TagScan, "/api/tags/scan")

	key := canonicalBookmarkURLKey(service.URL)
	before, ok := h.getPreviewCacheEntry(key)
	if !ok || len(before.Keywords) == 0 || before.Title == "" {
		t.Fatalf("nothing to clear: %+v", before)
	}

	body := postForTest(t, h.TagKeywordsClear, "/api/tags/keywords/clear")
	if body["cleared"] != float64(1) {
		t.Errorf("cleared = %v, want 1", body["cleared"])
	}

	after, ok := h.getPreviewCacheEntry(key)
	if !ok {
		t.Fatal("the cache entry itself was thrown away")
	}
	if len(after.Keywords) != 0 {
		t.Errorf("keywords survived: %v", after.Keywords)
	}
	// The title, the description and the fetch stamp were fetched for the
	// preview card and are not this feature's to delete.
	if after.Title != before.Title || after.Description != before.Description {
		t.Errorf("the preview lost more than its keywords: %+v", after)
	}
	if after.FetchedAt == 0 {
		t.Error("FetchedAt was cleared, so the round would read the page again")
	}
}

func TestTagScanResetMakesPagesAskableWithoutLosingWords(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><head><title>Ops</title>
			<meta name="keywords" content="kubernetes, helm">
			</head><body></body></html>`))
	}))
	defer service.Close()

	seedBookmarkForTest(t, h, service.URL)
	postForTest(t, h.TagScan, "/api/tags/scan")
	if left := len(h.tagScanTargets()); left != 0 {
		t.Fatalf("%d pages still waiting after a round", left)
	}

	body := postForTest(t, h.TagScanReset, "/api/tags/scan/reset")
	if body["reset"] != float64(1) {
		t.Errorf("reset = %v, want 1", body["reset"])
	}
	if left := len(h.tagScanTargets()); left != 1 {
		t.Errorf("%d pages askable after a reset, want 1", left)
	}

	// The words stay until they are replaced, so the panel goes on proposing
	// from what it has while the round runs.
	entry, ok := h.getPreviewCacheEntry(canonicalBookmarkURLKey(service.URL))
	if !ok || len(entry.Keywords) == 0 {
		t.Errorf("the reset threw the words away: %+v", entry)
	}
}

func TestTagScanRemembersAPageItCouldNotRead(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer service.Close()

	seedBookmarkForTest(t, h, service.URL)
	postForTest(t, h.TagScan, "/api/tags/scan")

	// A page that answered 500 never reached the extraction, so nothing
	// stamped it -- and an unstamped page is one every later round offers
	// again, forever.
	entry, ok := h.getPreviewCacheEntry(canonicalBookmarkURLKey(service.URL))
	if !ok || entry.KeywordsAt == 0 {
		t.Errorf("an unreadable page was not remembered as asked: %+v", entry)
	}
}
