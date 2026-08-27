package app

import (
	"strings"
	"testing"
	"testing/iotest"
	"time"
)

/*
Reading a page's own metadata, from HTML that is already in hand.

The shapes below are the ones actually in the wild, not invented: attribute
order varies between publishers, and a pattern that only reads one order
silently misses half the web.
*/
func TestMetaContentReadsEitherAttributeOrder(t *testing.T) {
	first := `<meta property="og:site_name" content="Ars Technica">`
	second := `<meta content="Ars Technica" property="og:site_name">`

	for name, doc := range map[string]string{"attr first": first, "content first": second} {
		if got := metaContent(doc, "property", "og:site_name"); got != "Ars Technica" {
			t.Errorf("%s: got %q", name, got)
		}
	}
	// Entities are decoded: a name is text, not markup.
	if got := metaContent(`<meta property="og:site_name" content="Ben &amp; Jerry">`, "property", "og:site_name"); got != "Ben & Jerry" {
		t.Errorf("entity not decoded: %q", got)
	}
}

/*
twitter:site is an @handle, not a name.

Measured on go.dev, which offers only that one and returned "@golang" -- an
account rather than what the publisher calls itself. A handle beside a domain is
two addresses and no name.
*/
func TestExtractSiteNameSkipsHandles(t *testing.T) {
	if got := extractSiteName(`<meta name="twitter:site" content="@golang">`, ""); got != "" {
		t.Errorf("used a handle as a name: %q", got)
	}
	// A real name in the same slot is still used.
	if got := extractSiteName(`<meta name="twitter:site" content="The Go Blog">`, ""); got != "The Go Blog" {
		t.Errorf("got %q", got)
	}
	// og:site_name wins over everything.
	doc := `<meta name="twitter:site" content="@x"><meta property="og:site_name" content="Ars Technica">`
	if got := extractSiteName(doc, ""); got != "Ars Technica" {
		t.Errorf("got %q", got)
	}
}

/*
The title's tail is a name only when it is short enough to be one.

"Article — Publisher" is near-universal, but the same separator appears inside
headlines, and reading half a sentence as a publisher is worse than showing the
domain.
*/
func TestExtractSiteNameFromTitleIsConservative(t *testing.T) {
	if got := extractSiteName("", "Go 1.24 is released! — The Go Blog"); got != "The Go Blog" {
		t.Errorf("got %q", got)
	}
	// Too long to be a name.
	long := "Something — and then a great deal more text that is plainly the rest of the sentence"
	if got := extractSiteName("", long); got != "" {
		t.Errorf("read a sentence as a publisher: %q", got)
	}
	// Ends in punctuation: a clause, not a name.
	if got := extractSiteName("", "A thing — but is it really?"); got != "" {
		t.Errorf("got %q", got)
	}
}

// A date is read from whichever of the four markups a page uses, and an
// unparseable one is left unknown rather than guessed at.
func TestExtractPublishedAt(t *testing.T) {
	want := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC).UnixMilli()
	for name, doc := range map[string]string{
		"article":  `<meta property="article:published_time" content="2026-03-01T12:00:00Z">`,
		"itemprop": `<meta itemprop="datePublished" content="2026-03-01T12:00:00Z">`,
		"time tag": `<time datetime="2026-03-01T12:00:00Z">March</time>`,
	} {
		if got := extractPublishedAt(doc); got != want {
			t.Errorf("%s: got %d, want %d", name, got, want)
		}
	}
	// A wrong date on a bookmark is worse than none.
	if got := extractPublishedAt(`<meta name="date" content="last Tuesday">`); got != 0 {
		t.Errorf("guessed a date from prose: %d", got)
	}
}

// An author URL is not a byline.
func TestExtractAuthorSkipsProfileLinks(t *testing.T) {
	if got := extractAuthor(`<meta property="article:author" content="https://example.com/staff/jo">`); got != "" {
		t.Errorf("used a URL as a byline: %q", got)
	}
	if got := extractAuthor(`<meta name="author" content="Jo Writer">`); got != "Jo Writer" {
		t.Errorf("got %q", got)
	}
}

/*
The readable length is measured after the markup is taken out.

A page that replaced its article with a redirect script still carries kilobytes
of <script>, and counting that would report it as full of text -- which is
exactly the page the soft-404 check is trying to notice.
*/
func TestReadableTextLengthIgnoresScriptsAndMarkup(t *testing.T) {
	withScript := `<html><head><script>` + strings.Repeat("var x = 1; ", 500) + `</script></head>` +
		`<body><p>Short notice.</p></body></html>`
	length := readableTextLength(withScript)
	if length > 60 {
		t.Errorf("length = %d, want only the visible text counted", length)
	}
	if length == 0 {
		t.Error("counted nothing at all")
	}

	// An article counts as an article.
	article := `<html><body><p>` + strings.Repeat("real prose here. ", 300) + `</p></body></html>`
	if readableTextLength(article) < 4000 {
		t.Errorf("an article measured %d", readableTextLength(article))
	}
}

/*
The reader stops at </head>, which is what makes a page like YouTube work at
all: its og: tags sit at byte 686,863, past the 512 KB the fetcher used to read.
Measured on four real pages, heads end at 347, 2,013, 35,682 and 695,150 bytes
-- so no single byte count serves them all, and the document's own structure
does.
*/
func TestReadDocumentHeadStopsAtHeadClose(t *testing.T) {
	doc := "<html><head><title>x</title></head><body>" + strings.Repeat("y", 100000) + "</body>"
	got, err := readDocumentHead(strings.NewReader(doc), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(string(got), "</head>") {
		t.Errorf("did not stop at head close, got %d bytes ending %q",
			len(got), string(got[max(0, len(got)-20):]))
	}
	if len(got) > 100 {
		t.Errorf("read %d bytes of a body it did not need", len(got))
	}
}

// The tag can straddle a read boundary; the scanner rescans an overlap so it
// is still found.
func TestReadDocumentHeadFindsTagAcrossChunkBoundary(t *testing.T) {
	// 32 KB is the chunk size, so place the tag to span it.
	pad := strings.Repeat("p", (32<<10)-3)
	doc := "<head>" + pad + "</head>" + strings.Repeat("z", 5000)
	got, err := readDocumentHead(iotest.OneByteReader(strings.NewReader(doc)), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(string(got), "</head>") {
		t.Errorf("lost the tag across a boundary; read %d bytes", len(got))
	}
}

// A document that never closes its head must not read forever.
func TestReadDocumentHeadHonoursTheBackstop(t *testing.T) {
	endless := strings.NewReader("<head>" + strings.Repeat("q", 500000))
	got, err := readDocumentHead(endless, 4096)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) > 4096 {
		t.Errorf("read %d bytes past a 4096 limit", len(got))
	}
}

// Capitalisation and stray space are both legal in the closing tag.
func TestReadDocumentHeadAcceptsTagVariants(t *testing.T) {
	for _, tag := range []string{"</head>", "</HEAD>", "</head >"} {
		doc := "<head><title>t</title>" + tag + strings.Repeat("b", 9000)
		got, err := readDocumentHead(strings.NewReader(doc), 1<<20)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) > 200 {
			t.Errorf("%s: read %d bytes, did not recognise the tag", tag, len(got))
		}
	}
}
