package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"strconv"
	"strings"
	"time"
)

/*
GitHub stars as bookmarks.

The first source in the register that needs a credential, and the one that makes
the register worth having: it pages, it resumes, and it is polite about it.

Two things about this API decide the shape of everything below.

The first is the media type. GET /user/starred answers with plain repositories
by default and the star date is simply absent; only
"application/vnd.github.star+json" wraps each row as {starred_at, repo}. That
header is the difference between importing a collection with its history and
importing it all stamped today, which would put a repo starred in 2015 at the
top of Recently added.

The second is that starred repos come back newest-first, which turns resuming
into something cheap: walk pages until a star older than the cursor appears, then
stop. A first run reads everything; every run after it usually reads one page.
*/

// githubAPIBase is a var so a test can point the walk at a stub server; the
// update check does the same with its release URL, for the same reason.
var githubAPIBase = "https://api.github.com"

// githubStarsMaxPages bounds one round. Ten thousand stars is far beyond any
// real account, and an API that stopped honouring `page` must not become an
// infinite loop holding a token.
//
// A var for the same reason as the base URL: proving the bound holds means
// walking to it, and doing that at the real value is a hundred round trips per
// test run to demonstrate arithmetic.
var githubStarsMaxPages = 100

const (
	// githubStarsPerPage is the API's maximum. Fewer pages means fewer round
	// trips against a rate limit measured in requests, not rows.
	githubStarsPerPage = 100

	// githubStarsTimeout bounds one page fetch.
	githubStarsTimeout = 20 * time.Second
	// githubStarsMaxBytes caps one page's body. A hundred repositories with
	// their descriptions and topics is far below this; anything above it is not
	// a page of stars.
	githubStarsMaxBytes  = 8 << 20
	githubStarsUserAgent = "nextDash-github-stars/1.0"
	// githubStarsMediaType is what makes starred_at appear at all.
	githubStarsMediaType = "application/vnd.github.star+json"
	// githubStarsMaxTags bounds the tags taken from one repository. GitHub allows
	// twenty topics; a bookmark carrying twenty tags is noise in every filter.
	githubStarsMaxTags = 6
)

// githubStarRow is one row of the starred listing under the star media type.
type githubStarRow struct {
	StarredAt string `json:"starred_at"`
	Repo      struct {
		FullName    string   `json:"full_name"`
		HTMLURL     string   `json:"html_url"`
		Description string   `json:"description"`
		Language    string   `json:"language"`
		Topics      []string `json:"topics"`
		Archived    bool     `json:"archived"`
		PushedAt    string   `json:"pushed_at"`
	} `json:"repo"`
}

// GitHubStarResult is what one round produced, before anything is written.
type GitHubStarResult struct {
	Bookmarks []ImportedRow
	// NewestStarredAt is the cursor for the next round: the timestamp of the
	// newest star seen, in RFC 3339 as the API gives it.
	NewestStarredAt string
	// Pages is how many requests it took, so the summary can say whether a round
	// was the cheap kind.
	Pages int
	// Truncated is set when the page bound stopped the walk early. The cursor
	// then must NOT advance, or the unread remainder is skipped forever.
	Truncated bool
}

var errGitHubUnauthorized = errors.New("github rejected the token")

/*
githubStarTags turns a repository into the handful of tags worth filtering on.

The primary language first, because it is the one thing every repository has and
the one people actually filter by, then topics until the cap. normalizeTags does
the lowering and de-duplicating, so a tag from here cannot differ from a typed
one — "Go" and "go" being two tags would make the filter lie.
*/
func githubStarTags(language string, topics []string) []string {
	raw := make([]string, 0, len(topics)+1)
	if strings.TrimSpace(language) != "" {
		raw = append(raw, language)
	}
	raw = append(raw, topics...)
	tags := normalizeTags(raw)
	if len(tags) > githubStarsMaxTags {
		tags = tags[:githubStarsMaxTags]
	}
	return tags
}

// githubStarTime parses the API's RFC 3339 stamps to Unix milliseconds.
// An unparseable or absent stamp gives 0, which every caller reads as unknown —
// the same rule the Netscape parser follows, for the same reason.
func githubStarTime(raw string) int64 {
	at, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	if err != nil {
		return 0
	}
	return at.UnixMilli()
}

// githubStarRowToBookmark converts one row, or nil if it is not importable.
func githubStarRowToBookmark(row githubStarRow, category string) *ImportedRow {
	url := strings.TrimSpace(row.Repo.HTMLURL)
	if url == "" {
		return nil
	}
	// Not validateHTTPURL: that resolves the host to defend against a
	// caller-supplied address, and these come from api.github.com under a token
	// -- one DNS lookup per starred repo would make importing a thousand stars
	// a thousand lookups to prove github.com is not a private network. The
	// scheme and host are checked instead, which is what could actually be
	// surprising here.
	if !isGitHubRepoURL(url) {
		return nil
	}
	name := strings.TrimSpace(row.Repo.FullName)
	if name == "" {
		name = url
	}
	starredAt := githubStarTime(row.StarredAt)
	return &ImportedRow{
		Name:     name,
		URL:      url,
		Category: category,
		Note:     strings.TrimSpace(row.Repo.Description),
		Tags:     githubStarTags(row.Repo.Language, row.Repo.Topics),
		// The star date, not the repository's creation date: this is a record of
		// when it entered *this* collection, which is what Recently added means.
		CreatedAt: starredAt,
		UpdatedAt: githubStarTime(row.Repo.PushedAt),
	}
}

// isGitHubRepoURL keeps an import to the host it claims to come from.
//
// A star listing that answered with links somewhere else is either a proxy in
// the middle or an API that changed shape; either way those are not rows this
// should quietly write into the reader's collection.
func isGitHubRepoURL(raw string) bool {
	parsed, err := neturl.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "github.com" || host == "www.github.com"
}

/*
FetchGitHubStars walks the starred listing until it reaches the cursor.

The since cursor is the newest starred_at of the previous round. Because the
listing is newest-first, the first row that is not newer than it means everything
below has been seen, and the walk stops mid-page — which is what makes a routine
round one request rather than a hundred.
*/
func FetchGitHubStars(ctx context.Context, token, since, category string) (GitHubStarResult, error) {
	var out GitHubStarResult
	token = strings.TrimSpace(token)
	if token == "" {
		return out, errors.New("no github token configured")
	}

	sinceAt := githubStarTime(since)
	client := &http.Client{Timeout: githubStarsTimeout}
	seen := map[string]struct{}{}

	for page := 1; page <= githubStarsMaxPages; page++ {
		url := fmt.Sprintf("%s/user/starred?per_page=%d&page=%d", githubAPIBase, githubStarsPerPage, page)
		rows, err := fetchGitHubStarPage(ctx, client, url, token)
		if err != nil {
			return out, err
		}
		out.Pages = page
		if len(rows) == 0 {
			return out, nil
		}

		for _, row := range rows {
			// Newest-first, so the first row at or below the cursor ends the
			// walk: everything after it was imported in an earlier round.
			if sinceAt > 0 && githubStarTime(row.StarredAt) <= sinceAt {
				return out, nil
			}
			if out.NewestStarredAt == "" {
				out.NewestStarredAt = strings.TrimSpace(row.StarredAt)
			}
			bookmark := githubStarRowToBookmark(row, category)
			if bookmark == nil {
				continue
			}
			// A repository renamed between two pages can appear twice while the
			// listing shifts under the walk; the canonical key is the same one
			// the duplicate detection uses.
			key := canonicalBookmarkURLKey(bookmark.URL)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
			out.Bookmarks = append(out.Bookmarks, *bookmark)
		}

		// A short page is the last page.
		if len(rows) < githubStarsPerPage {
			return out, nil
		}
	}

	// The bound stopped the walk with stars still unread. Saying so lets the
	// caller refuse to advance the cursor, which would otherwise skip the
	// remainder permanently.
	out.Truncated = true
	return out, nil
}

func fetchGitHubStarPage(ctx context.Context, client *http.Client, url, token string) ([]githubStarRow, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", githubStarsMediaType)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", githubStarsUserAgent)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		// 403 is also how this API reports a spent rate limit, and the two need
		// different answers from the reader: one means fix your token, the other
		// means wait. The remaining-count tells them apart.
		if resp.Header.Get("X-RateLimit-Remaining") == "0" {
			return nil, githubRateLimitError(resp)
		}
		return nil, errGitHubUnauthorized
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("github answered %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, githubStarsMaxBytes))
	if err != nil {
		return nil, err
	}
	var rows []githubStarRow
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("github sent something that is not a star listing: %w", err)
	}
	return rows, nil
}

// githubRateLimitError says when the limit resets, because "try again later" is
// not actionable and the header knows the answer.
func githubRateLimitError(resp *http.Response) error {
	reset, err := strconv.ParseInt(resp.Header.Get("X-RateLimit-Reset"), 10, 64)
	if err != nil || reset <= 0 {
		return errors.New("github rate limit reached")
	}
	wait := time.Until(time.Unix(reset, 0)).Round(time.Minute)
	if wait < time.Minute {
		wait = time.Minute
	}
	return fmt.Errorf("github rate limit reached, resets in %s", wait)
}
