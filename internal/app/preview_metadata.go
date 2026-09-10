package app

import (
	"bytes"
	"html"
	"io"
	"regexp"
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

// trimToLength caps a string at max characters.
//
// Counted in runes rather than bytes: slicing a byte at a time cut an accented
// or emoji character in half, and half a character is not a shorter title but
// a broken one -- it reaches the page as U+FFFD. Every caller here is trimming
// text a stranger's website supplied, so the multi-byte case is the ordinary
// one, not the exception.
func trimToLength(value string, max int) string {
	value = strings.TrimSpace(value)
	return strings.TrimSpace(truncateRunes(value, max))
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
	head, _, err := readDocumentHeadAndRest(body, maxBytes)
	return head, err
}

/*
readDocumentHeadAndRest is readDocumentHead, plus what it over-read.

Reading is chunked, so finding </head> in the middle of a 32 KB chunk means the
rest of that chunk has already been taken off the wire. It used to be dropped,
which quietly cost the caller the first stretch of the body -- and the first
stretch of the body is exactly where an h1 is. Handing it back turns a silent
loss into the one place a page states its subject in words.
*/
func readDocumentHeadAndRest(body io.Reader, maxBytes int64) ([]byte, []byte, error) {
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
				end := from + idx[1]
				return out.Bytes()[:end], out.Bytes()[end:], nil
			}
		}
		if err == io.EOF {
			return out.Bytes(), nil, nil
		}
		if err != nil {
			// Whatever arrived before the failure may still hold the tags.
			if out.Len() > 0 {
				return out.Bytes(), nil, nil
			}
			return nil, nil, err
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

/*
extractKeywords pulls the words a page uses to file itself.

Four places, in the order a publisher is likely to mean them: the keywords meta
tag, every article:tag (a page tagged "kubernetes, helm, ops" writes three of
them), og:section, and the first h1. All of it out of the document already in
hand, so this costs no request of its own -- the meta tags from the head, the
h1 from the body sample, since the head read stops at </head> and an h1 is
never inside it.

What comes back is a small, bounded list of derived words -- never the page's
text. A dozen words is tens of bytes per bookmark; two kilobytes of prose per
bookmark is megabytes in the data directory and in every backup ZIP, which is
the reason the design stores the words rather than what they were read from.

Deliberately unclever: no stemming, no frequency counting, no stop-word list
beyond the length floor. The words are matched against a shipped catalogue that
was written to be matched exactly, so a stemmer would only introduce ways for
the two halves to disagree.
*/
func extractKeywords(doc, body string) []string {
	/*
	 * The tag-shaped sources first, prose last.
	 *
	 * A keywords tag and an article:tag were written to file the page; a title
	 * and a description were written to describe it, so they carry a subject
	 * wrapped in sentence. Both are worth reading -- most pages publish no tags
	 * at all, and on a real collection only sixteen of eighty-five yielded a
	 * word without them -- but the cap is what keeps them in their place: the
	 * deliberate sources fill the twelve slots first, and the prose only gets
	 * what is left.
	 */
	raw := []string{
		metaContent(doc, "name", "keywords"),
		metaContent(doc, "property", "article:tag"),
		metaContent(doc, "property", "og:section"),
		metaContent(doc, "name", "news_keywords"),
	}
	// article:tag repeats rather than listing, so one match is not enough.
	for _, match := range metaContentPattern("property", "article:tag").FindAllStringSubmatch(doc, keywordMaxCount) {
		for _, group := range match[1:] {
			if group != "" {
				raw = append(raw, html.UnescapeString(group))
			}
		}
	}
	if heading := firstHeadingPattern.FindStringSubmatch(doc + body); heading != nil {
		raw = append(raw, html.UnescapeString(stripTagsPattern.ReplaceAllString(heading[1], " ")))
	}
	if title := documentTitlePattern.FindStringSubmatch(doc); title != nil {
		raw = append(raw, html.UnescapeString(stripTagsPattern.ReplaceAllString(title[1], " ")))
	}
	raw = append(raw,
		metaContent(doc, "property", "og:description"),
		metaContent(doc, "name", "description"),
	)

	splitFields := func(line string) []string {
		return strings.FieldsFunc(line, func(r rune) bool {
			// A title separates with a dash or a colon as often as with a
			// pipe -- "Ars Technica — Serving the technologist" is three
			// fields, not one.
			return r == ',' || r == ';' || r == '|' || r == '/' || r == '·' ||
				r == '—' || r == '–' || r == ':'
		})
	}

	seen := map[string]struct{}{}
	words := make([]string, 0, keywordMaxCount)
	keep := func(word string) bool {
		if word == "" {
			return false
		}
		if _, dup := seen[word]; dup {
			return false
		}
		seen[word] = struct{}{}
		words = append(words, word)
		return len(words) >= keywordMaxCount
	}

	for _, line := range raw {
		for _, field := range splitFields(line) {
			for _, word := range strings.Fields(field) {
				if keep(normalizeKeyword(word)) {
					return words
				}
			}
		}
	}

	/*
	 * The pairs, once the single words have had the slots they wanted.
	 *
	 * A page writes "peer reviewed" and "meal kit"; the catalogue writes
	 * "peer-reviewed" and "meal-kit", because a subject named in two words has
	 * to be one token to be matched at all. Splitting on whitespace alone left
	 * 354 of the catalogue's 1,924 keywords -- 18% of them -- reachable only by
	 * a page that happened to hyphenate the phrase itself.
	 *
	 * Second pass rather than woven into the first: a pair is weaker evidence
	 * than a word a publisher chose, and the twelve slots belong to the
	 * deliberate sources in the order they were read. Pairs get what is left,
	 * which on most pages is most of it.
	 */
	for _, line := range raw {
		for _, field := range splitFields(line) {
			fields := strings.Fields(field)
			for i := 0; i+1 < len(fields); i++ {
				first := normalizeKeyword(fields[i])
				second := normalizeKeyword(fields[i+1])
				// Both halves have to be words in their own right. A pair
				// resting on "the" or on a page's furniture is not a subject.
				if first == "" || second == "" {
					continue
				}
				if keep(normalizeKeyword(first + "-" + second)) {
					return words
				}
			}
		}
	}
	return words
}

/*
normalizeKeyword reduces one word to the shape the catalogue is written in, or
to "" when it is not a word worth keeping.

Three floors, all of them about the same thing -- a keyword that cannot
discriminate is worse than no keyword, because it proposes a tag on no evidence.
A two-letter word matches too much, a number is a date or a count rather than a
subject, and anything past the length cap is a sentence that lost its commas.
*/
func normalizeKeyword(word string) string {
	word = strings.ToLower(strings.Trim(strings.TrimSpace(word), ".,:;!?\"'()[]{}#"))
	if len(word) < keywordMinLength || len(word) > keywordMaxLength {
		return ""
	}
	digits := 0
	for _, r := range word {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9':
			digits++
		case r == '-':
		default:
			return ""
		}
	}
	if digits == len(word) {
		return ""
	}
	if _, furniture := keywordFurniture[word]; furniture {
		return ""
	}
	return word
}

/*
keywordFurniture is the words a page says because it is a page.

The h1 is the only place many sites state their subject in words, and it is
also where "Sign in", "Welcome to our website" and "You need to enable
JavaScript to run this app" live. Those words carry no subject, and one of them
is worse than merely useless: "javascript" is a real subject in the catalogue,
so a JavaScript-required notice would file a cooking blog under code.

Deliberately short and hand-picked rather than a general stop-word list. The
words below were read off what a real collection's pages actually produced;
anything longer starts removing vocabulary that discriminates.
*/
var keywordFurniture = map[string]struct{}{
	"about": {}, "account": {}, "all": {}, "and": {}, "are": {}, "back": {},
	"browser": {}, "click": {}, "close": {}, "cookie": {}, "cookies": {},
	"continue": {}, "enable": {}, "error": {}, "find": {}, "for": {},
	"forbidden": {}, "get": {}, "here": {}, "how": {}, "javascript": {},
	"just": {}, "loading": {}, "log": {}, "login": {}, "make": {}, "more": {},
	"not": {}, "now": {}, "our": {}, "out": {}, "please": {}, "privacy": {},
	"register": {}, "search": {}, "see": {}, "sign": {}, "signin": {},
	"start": {}, "support": {}, "terms": {}, "that": {}, "the": {}, "this": {},
	"use": {}, "using": {}, "want": {}, "welcome": {}, "what": {}, "when": {},
	"where": {}, "why": {}, "with": {}, "you": {}, "your": {},
	/*
	 * The second half arrived with the title and the description.
	 *
	 * A page's own prose says these because it is selling itself, and each of
	 * them matched a subject by name on a real collection: "breaking news" in
	 * 9gag's title filed a meme site under #news, the word "home" in a
	 * file-sharing page's description filed it under #home, "power" filed a
	 * chat assistant under #energy, and "mobile" filed a webmail client under
	 * #android. A word that names a subject is worth the whole threshold on
	 * its own, which is what makes these expensive rather than merely noisy.
	 */
	"best": {}, "breaking": {}, "created": {}, "files": {}, "free": {},
	"fun": {}, "help": {}, "home": {}, "inbox": {}, "manage": {}, "mobile": {},
	"news": {}, "official": {}, "power": {}, "simple": {}, "source": {},
	"try": {}, "users": {},
}

var (
	firstHeadingPattern  = regexp.MustCompile(`(?is)<h1[^>]*>(.*?)</h1>`)
	documentTitlePattern = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	stripTagsPattern     = regexp.MustCompile(`(?s)<[^>]*>`)
)

const (
	// keywordMaxCount, keywordMinLength and keywordMaxLength bound what one
	// page may contribute. Twelve words is what the design allows per
	// bookmark; the length floor drops "of" and "to", and the ceiling drops a
	// keywords tag that turned out to be a sentence.
	keywordMaxCount  = 12
	keywordMinLength = 3
	keywordMaxLength = 40
)
