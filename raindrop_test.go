package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// raindropStub answers the two endpoints the importer uses.
func raindropStub(t *testing.T, items []map[string]any, collections []map[string]any) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(r.URL.Path, "/collections/childrens"):
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{}})
		case strings.Contains(r.URL.Path, "/collections"):
			_ = json.NewEncoder(w).Encode(map[string]any{"items": collections})
		default:
			page := r.URL.Query().Get("page")
			if page != "0" && page != "" {
				_ = json.NewEncoder(w).Encode(map[string]any{"result": true, "items": []any{}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": true, "items": items})
		}
	}))
	original := raindropAPIBase
	raindropAPIBase = server.URL
	t.Cleanup(func() {
		raindropAPIBase = original
		server.Close()
	})
}

func raindropItemJSON(link, title string, collectionID int64, created string, tags []string, excerpt, note string) map[string]any {
	return map[string]any{
		"_id": 1, "link": link, "title": title, "excerpt": excerpt, "note": note,
		"tags": tags, "created": created, "lastUpdate": created,
		"collection": map[string]any{"$id": collectionID},
	}
}

/*
The collection the reader filed a bookmark in becomes its category.

This is the whole difference from the GitHub source, and the reason it matters:
a starred repo has no folder, so stars can all land in one category. A raindrop
sits in a collection the reader built themselves, and flattening two thousand of
them into one category throws away the structure that made the service worth
using.
*/
func TestFetchRaindropsUsesTheCollectionAsTheCategory(t *testing.T) {
	raindropStub(t,
		[]map[string]any{
			raindropItemJSON("https://example.com/one", "One", 42, "2026-03-01T00:00:00Z", []string{"Go", "go", " Weekly "}, "scraped excerpt", "my own note"),
			raindropItemJSON("https://example.com/two", "Two", 99, "2026-02-01T00:00:00Z", nil, "", ""),
		},
		[]map[string]any{{"_id": 42, "title": "Reading"}},
	)

	result, err := FetchRaindrops(context.Background(), "tok", "", "Raindrop")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(result.Bookmarks) != 2 {
		t.Fatalf("got %d bookmarks", len(result.Bookmarks))
	}

	first := result.Bookmarks[0]
	if first.Category != "Reading" {
		t.Errorf("category = %q, want the collection name", first.Category)
	}
	// The note the reader wrote beats the excerpt the service scraped.
	if first.Note != "my own note" {
		t.Errorf("note = %q, want the reader's own note", first.Note)
	}
	if strings.Join(first.Tags, ",") != "go,weekly" {
		t.Errorf("tags = %v, want normalised and de-duplicated", first.Tags)
	}
	want := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	if first.CreatedAt != want {
		t.Errorf("createdAt = %d, want the save date %d", first.CreatedAt, want)
	}

	// A collection the listing did not name falls back to the configured one
	// rather than landing the bookmark nowhere.
	if second := result.Bookmarks[1]; second.Category != "Raindrop" {
		t.Errorf("unknown collection gave category %q, want the fallback", second.Category)
	}
}

// With no note of their own, the scraped excerpt is better than nothing.
func TestFetchRaindropsFallsBackToTheExcerpt(t *testing.T) {
	raindropStub(t,
		[]map[string]any{raindropItemJSON("https://example.com/x", "X", 1, "2026-01-01T00:00:00Z", nil, "the excerpt", "")},
		nil,
	)
	result, err := FetchRaindrops(context.Background(), "tok", "", "")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if result.Bookmarks[0].Note != "the excerpt" {
		t.Errorf("note = %q", result.Bookmarks[0].Note)
	}
}

// Sorted newest-first, so a resumed round stops at the cursor rather than
// re-reading the whole account every time.
func TestFetchRaindropsStopsAtTheCursor(t *testing.T) {
	raindropStub(t,
		[]map[string]any{
			raindropItemJSON("https://example.com/new", "New", 1, "2026-03-01T00:00:00Z", nil, "", ""),
			raindropItemJSON("https://example.com/edge", "Edge", 1, "2026-01-15T00:00:00Z", nil, "", ""),
			raindropItemJSON("https://example.com/old", "Old", 1, "2026-01-01T00:00:00Z", nil, "", ""),
		}, nil)

	result, err := FetchRaindrops(context.Background(), "tok", "2026-01-15T00:00:00Z", "")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(result.Bookmarks) != 1 {
		t.Fatalf("got %d bookmarks, want only the one newer than the cursor", len(result.Bookmarks))
	}
	if result.Bookmarks[0].Name != "New" {
		t.Errorf("kept %q", result.Bookmarks[0].Name)
	}
	if result.NewestCreated != "2026-03-01T00:00:00Z" {
		t.Errorf("cursor = %q", result.NewestCreated)
	}
}

// Raindrop stores file uploads and other non-web entries; those are skipped, not
// fatal, so one of them cannot fail an import of two thousand links.
func TestFetchRaindropsSkipsNonWebEntries(t *testing.T) {
	raindropStub(t,
		[]map[string]any{
			raindropItemJSON("", "no link", 1, "2026-01-01T00:00:00Z", nil, "", ""),
			raindropItemJSON("javascript:void(0)", "bookmarklet", 1, "2026-01-01T00:00:00Z", nil, "", ""),
			raindropItemJSON("https://example.com/real", "real", 1, "2026-01-01T00:00:00Z", nil, "", ""),
		}, nil)

	result, err := FetchRaindrops(context.Background(), "tok", "", "")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(result.Bookmarks) != 1 || result.Bookmarks[0].Name != "real" {
		t.Errorf("kept %+v, want only the http row", result.Bookmarks)
	}
}

func TestFetchRaindropsReportsBadToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	original := raindropAPIBase
	raindropAPIBase = server.URL
	defer func() { raindropAPIBase = original }()

	if _, err := FetchRaindrops(context.Background(), "bad", "", ""); err != errRaindropUnauthorized {
		t.Errorf("err = %v, want errRaindropUnauthorized", err)
	}
}

// A walk cut short must say so, or the caller advances the cursor past
// bookmarks it never read.
func TestFetchRaindropsBoundsThePagesAndSaysSo(t *testing.T) {
	original := raindropMaxPages
	raindropMaxPages = 3
	defer func() { raindropMaxPages = original }()

	var pages int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/collections") {
			fmt.Fprint(w, `{"items":[]}`)
			return
		}
		pages++
		items := make([]map[string]any, raindropPerPage)
		for i := range items {
			items[i] = raindropItemJSON(fmt.Sprintf("https://example.com/%d-%d", pages, i), "x", 1, "2026-01-01T00:00:00Z", nil, "", "")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": true, "items": items})
	}))
	defer server.Close()
	baseOriginal := raindropAPIBase
	raindropAPIBase = server.URL
	defer func() { raindropAPIBase = baseOriginal }()

	result, err := FetchRaindrops(context.Background(), "tok", "", "")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if !result.Truncated {
		t.Error("a walk stopped by the bound did not report itself truncated")
	}
	if pages != raindropMaxPages {
		t.Errorf("read %d pages, want the bound %d", pages, raindropMaxPages)
	}
}

// A failure listing collections must not fail the import: bookmarks with the
// fallback category are recoverable, a refused import is not.
func TestFetchRaindropsSurvivesACollectionsFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/collections") {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"result": true, "items": []map[string]any{
			raindropItemJSON("https://example.com/one", "One", 42, "2026-01-01T00:00:00Z", nil, "", ""),
		}})
	}))
	defer server.Close()
	original := raindropAPIBase
	raindropAPIBase = server.URL
	defer func() { raindropAPIBase = original }()

	result, err := FetchRaindrops(context.Background(), "tok", "", "Raindrop")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(result.Bookmarks) != 1 || result.Bookmarks[0].Category != "Raindrop" {
		t.Errorf("got %+v, want the import to continue with the fallback category", result.Bookmarks)
	}
}

func TestFetchRaindropsNeedsAToken(t *testing.T) {
	if _, err := FetchRaindrops(context.Background(), "  ", "", ""); err == nil {
		t.Error("fetched with no token")
	}
}

/*
Raindrop allows the same collection name under different parents.

Handed over as-is, two collections both called "Reading" arrive at the importer
as one indistinguishable string and merge into a single category -- mixing two
lists the reader deliberately keeps apart. The collection ids still tell them
apart here, and nowhere downstream can, so the numbering has to happen here.
*/
func TestFetchRaindropsNumbersDuplicateCollectionNames(t *testing.T) {
	raindropStub(t,
		[]map[string]any{
			raindropItemJSON("https://example.com/a", "A", 10, "2026-03-03T00:00:00Z", nil, "", ""),
			raindropItemJSON("https://example.com/b", "B", 11, "2026-03-02T00:00:00Z", nil, "", ""),
			raindropItemJSON("https://example.com/c", "C", 12, "2026-03-01T00:00:00Z", nil, "", ""),
		},
		[]map[string]any{
			{"_id": 10, "title": "Reading"},
			{"_id": 11, "title": "Reading"},
			{"_id": 12, "title": "Other"},
		},
	)

	result, err := FetchRaindrops(context.Background(), "tok", "", "Raindrop")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(result.Bookmarks) != 3 {
		t.Fatalf("got %d bookmarks", len(result.Bookmarks))
	}

	categories := map[string]string{}
	for _, b := range result.Bookmarks {
		categories[b.Name] = b.Category
	}
	if categories["A"] == categories["B"] {
		t.Errorf("both collections became %q; they are separate lists", categories["A"])
	}
	if categories["A"] != "Reading" {
		t.Errorf("first Reading = %q, want it unchanged", categories["A"])
	}
	if categories["B"] != "Reading 2" {
		t.Errorf("second Reading = %q, want it numbered", categories["B"])
	}
	// A name that is not a duplicate is left alone.
	if categories["C"] != "Other" {
		t.Errorf("unique name = %q, want no number", categories["C"])
	}
}
