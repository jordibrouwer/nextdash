package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"regexp"
	"strings"
	"time"
)

/*
Mastodon bookmarks and favourites.

Every instance is its own server with its own registration, which sounds like
the hard part and is not: POST /api/v1/apps needs no developer account and no
review, and urn:ietf:wg:oauth:2.0:oob means the reader is shown a code to paste
rather than needing a redirect back into nextDash. For a local-first tool with
no public URL, that last part is what makes this possible at all.

The genuinely awkward part is paging. There is no page number and no offset:
the next page's address arrives in a Link header, and reading it wrong means
either missing posts or looping. That is why the header parsing below is its own
function with its own test rather than a regex inline.
*/

const (
	mastodonTimeout  = 20 * time.Second
	mastodonMaxBytes = 8 << 20
	mastodonAgent    = "nextDash-mastodon/1.0"
	// mastodonPerPage is the API's maximum for these endpoints.
	mastodonPerPage = 40
	// mastodonMaxPages bounds one round. Forty pages is 1600 posts, far beyond
	// what anyone has bookmarked, and it stops a Link header that points at
	// itself from becoming an endless walk.
	mastodonMaxPages = 40
)

var (
	errMastodonUnauthorized = errors.New("mastodon rejected the token")
	errMastodonNoInstance   = errors.New("no mastodon instance configured")
)

// mastodonStatus is as much of a post as a bookmark needs.
type mastodonStatus struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	URI       string `json:"uri"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
	Account   struct {
		Acct        string `json:"acct"`
		DisplayName string `json:"display_name"`
	} `json:"account"`
	// A boost carries the original in reblog; the bookmark belongs to that.
	Reblog *mastodonStatus `json:"reblog"`
}

/*
mastodonNextPage reads the next page's address out of a Link header.

The header is a comma-separated list of <url>; rel="name" pairs, and only the
one with rel="next" continues the walk -- rel="prev" points backwards, and
following it is how a pager turns into a loop.
*/
var mastodonLinkPattern = regexp.MustCompile(`<([^>]+)>\s*;\s*rel="([^"]+)"`)

func mastodonNextPage(linkHeader string) string {
	for _, match := range mastodonLinkPattern.FindAllStringSubmatch(linkHeader, -1) {
		if len(match) == 3 && strings.EqualFold(strings.TrimSpace(match[2]), "next") {
			return strings.TrimSpace(match[1])
		}
	}
	return ""
}

// mastodonInstanceURL turns what the reader typed into a base address.
//
// They will paste "mastodon.social", "@me@mastodon.social" or a full URL, and
// all three mean the same server.
func mastodonInstanceURL(raw string) (string, error) {
	handle := strings.TrimSpace(raw)
	if handle == "" {
		return "", errMastodonNoInstance
	}
	// An @user@host handle: the host is the part that matters.
	if strings.Count(handle, "@") >= 1 && !strings.Contains(handle, "://") {
		parts := strings.Split(strings.TrimPrefix(handle, "@"), "@")
		handle = parts[len(parts)-1]
	}
	if !strings.Contains(handle, "://") {
		handle = "https://" + handle
	}
	parsed, err := neturl.Parse(handle)
	if err != nil || parsed.Hostname() == "" {
		return "", errors.New("that is not a Mastodon instance")
	}
	// https only: an instance served over http would send the token in clear.
	return "https://" + parsed.Hostname(), nil
}

// MastodonResult is one round's worth of bookmarks.
type MastodonResult struct {
	Bookmarks []ImportedRow
	NewestID  string
	Pages     int
	Truncated bool
}

/*
FetchMastodonBookmarks walks the reader's bookmarks, newest first.

The cursor is a status id rather than a timestamp: Mastodon ids are ordered, and
the API pages by them, so this is the one the service itself understands.
*/
func (h *Handlers) FetchMastodonBookmarks(ctx context.Context, source SourceState) (MastodonResult, error) {
	var out MastodonResult

	base, err := mastodonInstanceURL(source.Handle)
	if err != nil {
		return out, err
	}
	token := strings.TrimSpace(source.Token)
	if token == "" {
		return out, errors.New("no mastodon access token configured")
	}

	return h.fetchMastodonAt(ctx, base, source)
}

/*
fetchMastodonAt is the walk itself, against an already-resolved instance.

Split from the resolution so a test can point it at a stub: mastodonInstanceURL
forces https, which is right for a real instance holding a real token and makes
a local test server unreachable.
*/
func (h *Handlers) fetchMastodonAt(ctx context.Context, base string, source SourceState) (MastodonResult, error) {
	var out MastodonResult
	token := strings.TrimSpace(source.Token)

	next := fmt.Sprintf("%s/api/v1/bookmarks?limit=%d", base, mastodonPerPage)
	client := h.outboundHTTPClient(mastodonTimeout, 3)
	seen := map[string]struct{}{}

	for page := 0; page < mastodonMaxPages; page++ {
		statuses, link, err := h.fetchMastodonPage(ctx, client, next, token)
		if err != nil {
			return out, err
		}
		out.Pages = page + 1
		if len(statuses) == 0 {
			return out, nil
		}

		for _, status := range statuses {
			// A boost's bookmark belongs to the post that was boosted.
			if status.Reblog != nil {
				status = *status.Reblog
			}
			if out.NewestID == "" {
				out.NewestID = status.ID
			}
			// Already imported: ids are ordered, so anything at or below the
			// cursor was seen last round.
			if source.Cursor != "" && status.ID <= source.Cursor {
				return out, nil
			}

			row := mastodonStatusToRow(status, source.TargetCategory)
			if row == nil {
				continue
			}
			key := canonicalBookmarkURLKey(row.URL)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
			out.Bookmarks = append(out.Bookmarks, *row)
		}

		next = mastodonNextPage(link)
		if next == "" {
			return out, nil
		}
	}

	// Stopped by the page bound with posts unread, so the caller must not move
	// the cursor past them.
	out.Truncated = true
	return out, nil
}

func (h *Handlers) fetchMastodonPage(ctx context.Context, client *http.Client, url, token string) ([]mastodonStatus, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", mastodonAgent)

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		return nil, "", errMastodonUnauthorized
	case resp.StatusCode == http.StatusTooManyRequests:
		return nil, "", errors.New("this instance's rate limit was reached, try again in a few minutes")
	case resp.StatusCode != http.StatusOK:
		return nil, "", fmt.Errorf("the instance answered %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, mastodonMaxBytes))
	if err != nil {
		return nil, "", err
	}
	var statuses []mastodonStatus
	if err := json.Unmarshal(body, &statuses); err != nil {
		return nil, "", fmt.Errorf("that instance sent something that is not a bookmark list: %w", err)
	}
	return statuses, resp.Header.Get("Link"), nil
}

// mastodonHTMLTags strips the markup Mastodon wraps post content in.
var mastodonHTMLTags = regexp.MustCompile(`<[^>]*>`)

/*
mastodonStatusToRow turns a post into a bookmark.

A post has no title, so the name is who wrote it plus the opening of what they
said -- which is what a reader scanning their grid would recognise it by. The
whole post goes in the note, so nothing is lost to that truncation.
*/
func mastodonStatusToRow(status mastodonStatus, category string) *ImportedRow {
	link := strings.TrimSpace(status.URL)
	if link == "" {
		link = strings.TrimSpace(status.URI)
	}
	if link == "" {
		return nil
	}
	parsed, err := neturl.Parse(link)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil
	}

	text := mastodonHTMLTags.ReplaceAllString(status.Content, " ")
	text = strings.Join(strings.Fields(text), " ")

	author := strings.TrimSpace(status.Account.DisplayName)
	if author == "" {
		author = strings.TrimSpace(status.Account.Acct)
	}

	name := text
	if len(name) > 70 {
		name = strings.TrimSpace(name[:70]) + "…"
	}
	if author != "" {
		if name == "" {
			name = author
		} else {
			name = author + ": " + name
		}
	}
	if name == "" {
		name = link
	}

	var createdAt int64
	if at, err := time.Parse(time.RFC3339, strings.TrimSpace(status.CreatedAt)); err == nil {
		createdAt = at.UnixMilli()
	}

	return &ImportedRow{
		Name:      name,
		URL:       link,
		Category:  category,
		Note:      text,
		CreatedAt: createdAt,
	}
}
