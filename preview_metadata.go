package main

import (
	"bytes"
	"html"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"
)

/*
What a page says about itself, beyond a title and a picture.

The HTML is already in hand -- the preview fetch reads it, the health check reads
it -- so everything here is free in the only sense that matters: no extra
request, no extra host contacted, no new privacy question. That is why these
live together rather than each fetching for themselves.

Three things are read that were not before:

og:site_name, because a domain is not a name. "Ars Technica" is what a reader
recognises; "arstechnica.com" is an address they have to translate.

An author and a publication date, from whichever of the four common markups the
page happens to use. A saved article whose date is visible is one you can decide
about without opening it.

And the length of the readable text, which is not for display at all: it is the
second soft-404 signal. See ContentLength on BookmarkPreview.

One limit worth knowing about, measured rather than assumed: the preview fetch
reads the first 512 KB of a page. That is ample for a document that puts its
metadata in <head>, which is nearly all of them -- but YouTube's watch page is
1.4 MB and its og:site_name sits at byte 687,082, past the cut. Nothing here can
recover a tag it never received. Raising that limit is a decision about every
preview fetch rather than about metadata, so it is left where it is, and oEmbed
covers the video providers anyway: their discovery link is in the head, where
the read does reach.
*/

// metaContentPattern finds a meta tag's content by attribute and value.
//
// Written to accept the attributes in either order, because both
// <meta property="og:x" content="y"> and <meta content="y" property="og:x">
// occur in the wild and a pattern that only reads one silently misses half the
// web.
func metaContentPattern(attr, value string) *regexp.Regexp {
	escaped := regexp.QuoteMeta(value)
	return regexp.MustCompile(
		`(?is)<meta[^>]+(?:` +
			attr + `\s*=\s*["']` + escaped + `["'][^>]*content\s*=\s*["']([^"']*)["']` +
			`|` +
			`content\s*=\s*["']([^"']*)["'][^>]*` + attr + `\s*=\s*["']` + escaped + `["']` +
			`)`)
}

// metaContent reads one meta value out of a document.
func metaContent(doc, attr, value string) string {
	match := metaContentPattern(attr, value).FindStringSubmatch(doc)
	if match == nil {
		return ""
	}
	for _, group := range match[1:] {
		if group != "" {
			return html.UnescapeString(strings.TrimSpace(group))
		}
	}
	return ""
}

/*
extractSiteName reads what the publisher calls itself.

og:site_name first, then the Twitter and schema.org spellings of the same idea,
then the tail of a title like "Some article — Ars Technica". The last one is a
guess, so it only fires when the separator leaves something short enough to be a
name rather than half a headline.
*/
func extractSiteName(doc, title string) string {
	for _, candidate := range []struct{ attr, value string }{
		{"property", "og:site_name"},
		{"name", "application-name"},
		{"name", "twitter:site"},
	} {
		found := metaContent(doc, candidate.attr, candidate.value)
		if found == "" {
			continue
		}
		/*
		 * twitter:site is an @handle, not a name.
		 *
		 * Measured on go.dev, which offers only that one: it returned "@golang",
		 * which is an account rather than what the publisher calls itself. A
		 * handle beside a domain is two addresses and no name, so it is skipped
		 * and the title fallback below gets its turn.
		 */
		if strings.HasPrefix(found, "@") {
			continue
		}
		return trimToLength(found, 80)
	}

	// "Article title — Publisher" is a near-universal convention, but only the
	// short tail is safe to read as a name: a long one is just the rest of the
	// sentence.
	for _, sep := range []string{" — ", " – ", " | ", " · "} {
		if idx := strings.LastIndex(title, sep); idx > 0 {
			tail := strings.TrimSpace(title[idx+len(sep):])
			if tail != "" && len(tail) <= 40 && !strings.ContainsAny(tail, ".?!") {
				return tail
			}
		}
	}
	return ""
}

// extractAuthor reads a byline from whichever markup the page uses.
func extractAuthor(doc string) string {
	for _, candidate := range []struct{ attr, value string }{
		{"name", "author"},
		{"property", "article:author"},
		{"name", "twitter:creator"},
		{"property", "og:article:author"},
	} {
		if found := metaContent(doc, candidate.attr, candidate.value); found != "" {
			// article:author is sometimes a profile URL rather than a name;
			// a URL is not a byline, so it is left out rather than shown.
			if strings.HasPrefix(found, "http://") || strings.HasPrefix(found, "https://") {
				continue
			}
			return trimToLength(found, 120)
		}
	}
	return ""
}

/*
extractPublishedAt reads when the page says it was published.

Four markups, one meaning. The formats are the ones actually in use: RFC 3339
with and without a zone, and a bare date -- anything else is left as unknown
rather than guessed at, because a wrong date on a bookmark is worse than none.
*/
func extractPublishedAt(doc string) int64 {
	for _, candidate := range []struct{ attr, value string }{
		{"property", "article:published_time"},
		{"property", "og:article:published_time"},
		{"name", "date"},
		{"itemprop", "datePublished"},
	} {
		raw := metaContent(doc, candidate.attr, candidate.value)
		if raw == "" {
			continue
		}
		for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
			if at, err := time.Parse(layout, raw); err == nil {
				return at.UnixMilli()
			}
		}
	}
	// <time datetime="…"> is the other place a date lives.
	if match := regexp.MustCompile(`(?is)<time[^>]+datetime\s*=\s*["']([^"']+)["']`).FindStringSubmatch(doc); match != nil {
		for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
			if at, err := time.Parse(layout, strings.TrimSpace(match[1])); err == nil {
				return at.UnixMilli()
			}
		}
	}
	return 0
}

// scriptOrStylePattern strips the parts of a document that are not readable
// text, so counting what is left means something.
var (
	/*
	 * Written out per tag rather than with a backreference.
	 *
	 * Go's regexp is RE2, which has no backreferences at all -- `\1` is not a
	 * weaker match here, it fails to compile. Four alternatives is the honest
	 * way to say the same thing.
	 */
	scriptOrStylePattern = regexp.MustCompile(
		`(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>` +
			`|<noscript[^>]*>.*?</noscript>|<template[^>]*>.*?</template>`)
	htmlTagPattern    = regexp.MustCompile(`(?s)<[^>]*>`)
	whitespacePattern = regexp.MustCompile(`\s+`)
)

/*
readableTextLength measures how much of a page is prose.

Not a readability implementation -- a port of Mozilla's algorithm is a dependency
and a large one, and what the soft-404 check needs is a number that moves the
same way theirs does: a page that lost its article loses most of its text.
Scripts, styles and markup are removed first, because a page that replaced its
article with a redirect script still has kilobytes of <script> in it.

Returns a count of characters, which is a proxy for words that survives every
language equally -- a word count would read Chinese as nearly empty.
*/
func readableTextLength(doc string) int {
	stripped := scriptOrStylePattern.ReplaceAllString(doc, " ")
	stripped = htmlTagPattern.ReplaceAllString(stripped, " ")
	stripped = html.UnescapeString(stripped)
	stripped = whitespacePattern.ReplaceAllString(stripped, " ")
	return len(strings.TrimSpace(stripped))
}

func trimToLength(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return strings.TrimSpace(value[:max])
}

// parseContentLength reads a stored length back, tolerating an absent value.
func parseContentLength(raw string) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return 0
	}
	return n
}

/*
readDocumentHead reads a response body only as far as the metadata needs.

The obvious fix for a page whose og: tags sit past the read limit is a bigger
limit, but that pays YouTube's cost on every fetch. Measured on four real
pages: go.dev closes its head at byte 2,013, Hacker News at 347, Ars Technica
at 35,682 -- and YouTube at 695,150, just past the old 512 KB ceiling. So the
limit that matters is not a byte count but a position in the document: read
until </head>, and stop.

Typical pages therefore transfer far less than before, and the pathological
ones still get their metadata. maxBytes remains as a backstop for a document
that never closes its head at all -- a stream, or markup broken enough that
scanning it further is pointless.

The trailing body is deliberately left unread. Callers that need the body text
(readableTextLength) already accept a truncated document: it estimates length
to tell a soft-404 from a real page, and a page cut short reads as shorter,
which is the safe direction for that judgement.
*/
func readDocumentHead(body io.Reader, maxBytes int64) ([]byte, error) {
	var out bytes.Buffer
	buf := make([]byte, 32<<10)
	limited := io.LimitReader(body, maxBytes)
	// A chunk boundary can fall inside "</head>", so rescan a short overlap.
	const overlap = len("</head>") - 1
	for {
		n, err := limited.Read(buf)
		if n > 0 {
			from := out.Len() - overlap
			if from < 0 {
				from = 0
			}
			out.Write(buf[:n])
			if idx := headClosePattern.FindIndex(out.Bytes()[from:]); idx != nil {
				return out.Bytes()[:from+idx[1]], nil
			}
		}
		if err == io.EOF {
			return out.Bytes(), nil
		}
		if err != nil {
			// Whatever arrived before the failure may still hold the tags.
			if out.Len() > 0 {
				return out.Bytes(), nil
			}
			return nil, err
		}
	}
}

var headClosePattern = regexp.MustCompile(`(?i)</head\s*>`)

const (
	/*
	 * previewMaxHead bounds readDocumentHead for a document that never closes
	 * its head. 1 MB clears the widest real head measured (YouTube, 695 KB)
	 * without committing to reading a whole page; a normal site stops long
	 * before this, at its own </head>.
	 */
	previewMaxHead = 1 << 20
	/*
	 * previewBodySample is how much prose is read after the head, for
	 * ContentLength alone. A soft-404 page is short by nature, so a page that
	 * fills this sample is already far past any threshold that would call it
	 * one -- reading more cannot change the verdict.
	 */
	previewBodySample = 64 << 10
)
