package app

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

// starPage builds one page of the listing as the star media type returns it.
func starPage(names []string, at []string) string {
	rows := make([]map[string]any, 0, len(names))
	for i, name := range names {
		rows = append(rows, map[string]any{
			"starred_at": at[i],
			"repo": map[string]any{
				"full_name":   name,
				"html_url":    "https://github.com/" + name,
				"description": name + " description",
				"language":    "Go",
				"topics":      []string{"cli", "tools"},
				"pushed_at":   "2026-01-02T03:04:05Z",
			},
		})
	}
	data, _ := json.Marshal(rows)
	return string(data)
}

// withGitHubAPI points the importer at a stub and restores the real base after.
func withGitHubAPI(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	original := githubAPIBase
	githubAPIBase = server.URL
	t.Cleanup(func() {
		githubAPIBase = original
		server.Close()
	})
}

// withGitHubMaxPages shrinks the page bound so a test can walk to it without
// making a hundred round trips to prove arithmetic.
func withGitHubMaxPages(t *testing.T, n int) {
	t.Helper()
	original := githubStarsMaxPages
	githubStarsMaxPages = n
	t.Cleanup(func() { githubStarsMaxPages = original })
}

// The star date is only present under the star media type; without that header
// every imported repo would be stamped with whatever the fallback is, and a repo
// starred in 2015 would sort as new.
func TestFetchGitHubStarsAsksForStarDates(t *testing.T) {
	var gotAccept, gotAuth string
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		gotAccept = r.Header.Get("Accept")
		gotAuth = r.Header.Get("Authorization")
		fmt.Fprint(w, starPage([]string{"golang/go"}, []string{"2020-05-01T10:00:00Z"}))
	})

	result, err := FetchGitHubStars(context.Background(), "ghp_x", "", "code")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if gotAccept != githubStarsMediaType {
		t.Errorf("Accept = %q, want the star media type", gotAccept)
	}
	if gotAuth != "Bearer ghp_x" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if len(result.Bookmarks) != 1 {
		t.Fatalf("got %d bookmarks", len(result.Bookmarks))
	}

	got := result.Bookmarks[0]
	want := time.Date(2020, 5, 1, 10, 0, 0, 0, time.UTC).UnixMilli()
	if got.CreatedAt != want {
		t.Errorf("createdAt = %d, want the star date %d", got.CreatedAt, want)
	}
	if got.Name != "golang/go" || got.URL != "https://github.com/golang/go" {
		t.Errorf("name/url = %q %q", got.Name, got.URL)
	}
	if got.Note != "golang/go description" {
		t.Errorf("note = %q", got.Note)
	}
	if got.Category != "code" {
		t.Errorf("category = %q", got.Category)
	}
	if strings.Join(got.Tags, ",") != "go,cli,tools" {
		t.Errorf("tags = %v, want language first then topics, lowered", got.Tags)
	}
}

// The listing is newest-first, so a resumed round should stop at the cursor
// rather than re-reading the whole history every time.
func TestFetchGitHubStarsStopsAtTheCursor(t *testing.T) {
	withGitHubMaxPages(t, 3)
	var pages int
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		pages++
		fmt.Fprint(w, starPage(
			[]string{"new/one", "new/two", "old/three"},
			[]string{"2026-03-01T00:00:00Z", "2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z"},
		))
	})

	result, err := FetchGitHubStars(context.Background(), "ghp_x", "2026-01-15T00:00:00Z", "")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(result.Bookmarks) != 2 {
		t.Fatalf("got %d bookmarks, want only those newer than the cursor", len(result.Bookmarks))
	}
	if result.Bookmarks[1].Name == "old/three" {
		t.Error("imported a star older than the cursor")
	}
	if pages != 1 {
		t.Errorf("read %d pages, want to stop inside the first", pages)
	}
	if result.NewestStarredAt != "2026-03-01T00:00:00Z" {
		t.Errorf("cursor = %q, want the newest star seen", result.NewestStarredAt)
	}
}

// A star exactly at the cursor was imported last round; importing it again would
// make every round produce one duplicate for the dedupe to swallow.
func TestFetchGitHubStarsTreatsTheCursorAsAlreadySeen(t *testing.T) {
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, starPage([]string{"same/one"}, []string{"2026-01-15T00:00:00Z"}))
	})

	result, err := FetchGitHubStars(context.Background(), "ghp_x", "2026-01-15T00:00:00Z", "")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(result.Bookmarks) != 0 {
		t.Errorf("re-imported the star sitting on the cursor: %+v", result.Bookmarks)
	}
}

// A bad token and a spent rate limit both arrive as 403 and need opposite
// answers from the reader: fix it, or wait.
func TestFetchGitHubStarsSeparatesRateLimitFromBadToken(t *testing.T) {
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", fmt.Sprint(time.Now().Add(30*time.Minute).Unix()))
		w.WriteHeader(http.StatusForbidden)
	})
	_, err := FetchGitHubStars(context.Background(), "ghp_x", "", "")
	if err == nil || !strings.Contains(err.Error(), "rate limit") {
		t.Errorf("rate-limited 403 gave %v, want a rate-limit error naming the wait", err)
	}
	if err != nil && !strings.Contains(err.Error(), "resets in") {
		t.Errorf("rate-limit error does not say when: %v", err)
	}
}

func TestFetchGitHubStarsReportsBadToken(t *testing.T) {
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	if _, err := FetchGitHubStars(context.Background(), "ghp_bad", "", ""); err != errGitHubUnauthorized {
		t.Errorf("err = %v, want errGitHubUnauthorized", err)
	}
}

// An API that stopped honouring `page` must not spin forever holding a token,
// and a walk cut short must say so — advancing the cursor then would skip the
// unread remainder permanently.
func TestFetchGitHubStarsBoundsThePagesAndSaysSo(t *testing.T) {
	withGitHubMaxPages(t, 3)
	var pages int
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		pages++
		names := make([]string, githubStarsPerPage)
		at := make([]string, githubStarsPerPage)
		for i := range names {
			names[i] = fmt.Sprintf("owner/repo-%d-%d", pages, i)
			at[i] = "2026-01-01T00:00:00Z"
		}
		fmt.Fprint(w, starPage(names, at))
	})

	result, err := FetchGitHubStars(context.Background(), "ghp_x", "", "")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if pages != githubStarsMaxPages {
		t.Errorf("read %d pages, want the bound %d", pages, githubStarsMaxPages)
	}
	if !result.Truncated {
		t.Error("a walk stopped by the bound did not report itself truncated")
	}
}

// A listing that answers with links off github.com is a proxy or a changed API,
// not rows to write into the collection.
func TestFetchGitHubStarsRefusesForeignLinks(t *testing.T) {
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `[{"starred_at":"2026-01-01T00:00:00Z","repo":{"full_name":"evil/one","html_url":"https://evil.example.com/x"}}]`)
	})
	result, err := FetchGitHubStars(context.Background(), "ghp_x", "", "")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(result.Bookmarks) != 0 {
		t.Errorf("imported an off-host link: %+v", result.Bookmarks)
	}
}

// Twenty topics on a repository would put twenty tags on a bookmark, which is
// noise in every filter that reads them.
func TestGitHubStarTagsAreBounded(t *testing.T) {
	topics := []string{"a", "b", "c", "d", "e", "f", "g", "h"}
	tags := githubStarTags("Rust", topics)
	if len(tags) != githubStarsMaxTags {
		t.Fatalf("got %d tags, want %d", len(tags), githubStarsMaxTags)
	}
	if tags[0] != "rust" {
		t.Errorf("tags[0] = %q, want the language first and lowered", tags[0])
	}
}

func TestFetchGitHubStarsNeedsAToken(t *testing.T) {
	if _, err := FetchGitHubStars(context.Background(), "   ", "", ""); err == nil {
		t.Error("fetched with no token")
	}
}
