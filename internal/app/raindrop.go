package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"os"
	"strings"
	"time"
)

/*
Raindrop.io as a source.

The second service on the register, and the one that shows what the register was
for: everything below is a parser and a cursor, because the token, the preview,
the dedupe and the confirm are already built.

Raindrop's API is friendlier than GitHub's in the ways that matter here. A test
token never expires, so there is no refresh dance. /raindrops/0 returns every
bookmark across every collection, so there is no walking a collection tree. And
each row already carries what nextDash wants to keep -- tags, an excerpt, the
date it was saved, and the collection it lives in.

That last one is why the category handling differs from GitHub's. A starred repo
has no folder, so stars all land in one category the reader names. A raindrop
sits in a collection the reader made themselves, and throwing that away to put
two thousand bookmarks in one category would be losing the very structure they
came with. So the collection becomes the category, and the configured category is
the fallback for the ones filed nowhere.
*/

// raindropAPIBase is a var so a test can point it at a stub; NEXTDASH_RAINDROP_API_BASE
// overrides it for an end-to-end test, exactly as the GitHub source does.
var raindropAPIBase = func() string {
	if base := strings.TrimSpace(os.Getenv("NEXTDASH_RAINDROP_API_BASE")); base != "" {
		return strings.TrimSuffix(base, "/")
	}
	return "https://api.raindrop.io/rest/v1"
}()

const (
	// raindropPerPage is the API's maximum.
	raindropPerPage = 50
	// raindropTimeout bounds one page fetch.
	raindropTimeout = 20 * time.Second
	// raindropMaxBytes caps one page's body.
	raindropMaxBytes  = 8 << 20
	raindropUserAgent = "nextDash-raindrop/1.0"
)

// raindropMaxPages bounds one round; a var so a test can walk to it cheaply.
var raindropMaxPages = 200

// raindropItem is one bookmark as the API returns it.
type raindropItem struct {
	ID         int64    `json:"_id"`
	Link       string   `json:"link"`
	Title      string   `json:"title"`
	Excerpt    string   `json:"excerpt"`
	Note       string   `json:"note"`
	Tags       []string `json:"tags"`
	Created    string   `json:"created"`
	LastUpdate string   `json:"lastUpdate"`
	Collection struct {
		ID int64 `json:"$id"`
	} `json:"collection"`
}

type raindropPage struct {
	Result bool           `json:"result"`
	Items  []raindropItem `json:"items"`
	Count  int            `json:"count"`
}

// raindropCollection is one of the reader's own collections, used to turn a
// collection id into the name they gave it.
type raindropCollection struct {
	ID    int64  `json:"_id"`
	Title string `json:"title"`
}

type raindropCollectionsPage struct {
	Items []raindropCollection `json:"items"`
}

// RaindropResult is what one round produced.
type RaindropResult struct {
	Bookmarks []ImportedRow
	// NewestCreated is the cursor for the next round, RFC 3339 as given.
	NewestCreated string
	Pages         int
	Truncated     bool
}

var errRaindropUnauthorized = errors.New("raindrop rejected the token")

// raindropTime parses the API's RFC 3339 stamps to Unix milliseconds. An absent
// or unparseable stamp gives 0, which every caller reads as unknown.
func raindropTime(raw string) int64 {
	at, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	if err != nil {
		return 0
	}
	return at.UnixMilli()
}

/*
raindropCollectionNames maps collection id to the name the reader gave it.

Fetched once per round rather than per bookmark. A failure here is not fatal: the
import falls back to the configured category, because bookmarks with the wrong
category are recoverable and a refused import is not.
*/
func raindropCollectionNames(ctx context.Context, client *http.Client, token string) map[int64]string {
	var ordered []raindropCollection
	// Root collections and nested ones are two endpoints; both are cheap and a
	// reader with nested collections is the common case, not the exotic one.
	for _, path := range []string{"/collections", "/collections/childrens"} {
		body, err := raindropGet(ctx, client, raindropAPIBase+path, token)
		if err != nil {
			continue
		}
		var page raindropCollectionsPage
		if json.Unmarshal(body, &page) != nil {
			continue
		}
		ordered = append(ordered, page.Items...)
	}

	/*
	 * Raindrop allows the same name under different parents -- two collections
	 * both called "Reading" is ordinary, not a mistake. Handed over as-is they
	 * would arrive at the importer as one indistinguishable string and merge
	 * into a single category, silently mixing two lists the reader keeps apart.
	 *
	 * So repeats are numbered here, where the collection ids still tell them
	 * apart: Reading, Reading 2, Reading 3. Nothing downstream can recover this
	 * distinction later, which is why it cannot be left to the importer.
	 */
	names := make(map[int64]string, len(ordered))
	used := map[string]int{}
	for _, c := range ordered {
		name := strings.TrimSpace(c.Title)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		used[key]++
		if n := used[key]; n > 1 {
			name = fmt.Sprintf("%s %d", name, n)
		}
		names[c.ID] = name
	}
	return names
}

// raindropItemToBookmark converts one row, or nil if it is not importable.
func raindropItemToBookmark(item raindropItem, collections map[int64]string, fallbackCategory string) *ImportedRow {
	link := strings.TrimSpace(item.Link)
	if link == "" {
		return nil
	}
	parsed, err := neturl.Parse(link)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		// Raindrop stores file uploads and other non-web entries too; those are
		// skipped rather than refused, the way the Netscape parser skips a
		// bookmarklet rather than failing an import of two thousand links.
		return nil
	}

	name := strings.TrimSpace(item.Title)
	if name == "" {
		name = link
	}

	// The note the reader wrote wins over the excerpt the service scraped: one
	// is theirs, the other is the first paragraph of the page.
	note := strings.TrimSpace(item.Note)
	if note == "" {
		note = strings.TrimSpace(item.Excerpt)
	}

	// The collection they filed it in, not one category for everything: that
	// structure is the reason they used Raindrop rather than a bookmarks bar.
	category := strings.TrimSpace(collections[item.Collection.ID])
	if category == "" {
		category = fallbackCategory
	}

	return &ImportedRow{
		Name:      name,
		URL:       link,
		Category:  category,
		Note:      note,
		Tags:      normalizeTags(item.Tags),
		CreatedAt: raindropTime(item.Created),
		UpdatedAt: raindropTime(item.LastUpdate),
	}
}

/*
FetchRaindrops walks every bookmark, newest first, stopping at the cursor.

Collection 0 is Raindrop's "all bookmarks", so one walk covers every collection
including the unsorted ones. Sorted by -created so the same newest-first
resumption GitHub uses works here: the first row not newer than the cursor means
everything below it has been seen.
*/
func FetchRaindrops(ctx context.Context, token, since, fallbackCategory string) (RaindropResult, error) {
	var out RaindropResult
	token = strings.TrimSpace(token)
	if token == "" {
		return out, errors.New("no raindrop token configured")
	}

	client := &http.Client{Timeout: raindropTimeout}
	sinceAt := raindropTime(since)
	collections := raindropCollectionNames(ctx, client, token)
	seen := map[string]struct{}{}

	// The API pages from zero.
	for page := 0; page < raindropMaxPages; page++ {
		url := fmt.Sprintf("%s/raindrops/0?perpage=%d&page=%d&sort=-created", raindropAPIBase, raindropPerPage, page)
		body, err := raindropGet(ctx, client, url, token)
		if err != nil {
			return out, err
		}
		var parsed raindropPage
		if err := json.Unmarshal(body, &parsed); err != nil {
			return out, fmt.Errorf("raindrop sent something that is not a bookmark listing: %w", err)
		}
		out.Pages = page + 1
		if len(parsed.Items) == 0 {
			return out, nil
		}

		for _, item := range parsed.Items {
			if sinceAt > 0 && raindropTime(item.Created) <= sinceAt {
				return out, nil
			}
			if out.NewestCreated == "" {
				out.NewestCreated = strings.TrimSpace(item.Created)
			}
			bookmark := raindropItemToBookmark(item, collections, fallbackCategory)
			if bookmark == nil {
				continue
			}
			key := canonicalBookmarkURLKey(bookmark.URL)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
			out.Bookmarks = append(out.Bookmarks, *bookmark)
		}

		if len(parsed.Items) < raindropPerPage {
			return out, nil
		}
	}

	// Stopped by the bound with bookmarks unread; the caller must not advance
	// the cursor past them.
	out.Truncated = true
	return out, nil
}

func raindropGet(ctx context.Context, client *http.Client, url, token string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", raindropUserAgent)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		return nil, errRaindropUnauthorized
	case resp.StatusCode == http.StatusTooManyRequests:
		// Raindrop states its limit in the response rather than leaving the
		// caller to guess, so the reader is told to wait rather than told the
		// service is broken.
		return nil, errors.New("raindrop rate limit reached, try again in a minute")
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("raindrop answered %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, raindropMaxBytes))
}
