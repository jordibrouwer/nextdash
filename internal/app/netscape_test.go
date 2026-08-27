package app

import (
	"bytes"
	"strings"
	"testing"
)

// A real export, in the shape browsers actually write it: <DT> never closed,
// <p> opened and abandoned, folders nested, a <DD> following the <DT> it
// describes rather than sitting inside it, and a javascript: bookmarklet in
// among the links.
const chromeStyleExport = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://root.example.com/" ADD_DATE="1600000000">At the root</A>
    <DT><H3 ADD_DATE="1500000000">Development</H3>
    <DL><p>
        <DT><A HREF="https://go.dev/" ADD_DATE="1610000000" LAST_MODIFIED="1620000000" TAGS="Go, programming ,go">The Go site</A>
        <DD>Notes that belong to the row above
        <DT><A HREF="https://example.com/read-me" TOREAD="1" PRIVATE="1">Read later</A>
        <DT><H3>Nested deeper</H3>
        <DL><p>
            <DT><A HREF="https://deep.example.com/">Deep link</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="javascript:alert(1)">A bookmarklet</A>
    <DT><A HREF="place:type=6">A Firefox smart folder</A>
</DL><p>`

func parseFixture(t *testing.T, doc string) map[string]NetscapeBookmark {
	t.Helper()
	got, err := ParseNetscapeBookmarks(strings.NewReader(doc))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	byURL := make(map[string]NetscapeBookmark, len(got))
	for _, bm := range got {
		byURL[bm.URL] = bm
	}
	return byURL
}

func TestParseNetscapeReadsEveryFieldTheFormatCarries(t *testing.T) {
	byURL := parseFixture(t, chromeStyleExport)

	if len(byURL) != 4 {
		t.Fatalf("parsed %d bookmarks, want 4 (three folders' worth plus the root one)", len(byURL))
	}

	// The browser-side parser produced name, url and folder. Everything below
	// this line is what it threw away.
	goSite, ok := byURL["https://go.dev/"]
	if !ok {
		t.Fatal("the Go site is missing")
	}
	if goSite.Folder != "Development" {
		t.Errorf("folder = %q, want Development", goSite.Folder)
	}
	if goSite.CreatedAt != 1610000000*1000 {
		t.Errorf("createdAt = %d, want unix seconds converted to millis", goSite.CreatedAt)
	}
	if goSite.UpdatedAt != 1620000000*1000 {
		t.Errorf("updatedAt = %d, want unix seconds converted to millis", goSite.UpdatedAt)
	}
	// Through normalizeTags, so an imported tag cannot differ from a typed one.
	if len(goSite.Tags) != 2 || goSite.Tags[0] != "go" || goSite.Tags[1] != "programming" {
		t.Errorf("tags = %v, want [go programming] -- lowered, trimmed, de-duplicated", goSite.Tags)
	}
	// The <DD> follows the <DT>; it is not a child of it. This is the part of
	// the format a naive reader gets wrong.
	if goSite.Note != "Notes that belong to the row above" {
		t.Errorf("note = %q, want the text of the <DD> that follows the row", goSite.Note)
	}

	readLater := byURL["https://example.com/read-me"]
	if !readLater.ToRead || !readLater.Private {
		t.Errorf("toread=%v private=%v, want both true", readLater.ToRead, readLater.Private)
	}
	// Absent dates stay zero rather than becoming "now": filling them in would
	// date a fifteen-year-old bookmark to today and put it atop Recently added.
	if readLater.CreatedAt != 0 {
		t.Errorf("createdAt = %d for a row with no ADD_DATE, want 0", readLater.CreatedAt)
	}
}

func TestParseNetscapeKeepsNestingAndSkipsWhatCannotBeStored(t *testing.T) {
	byURL := parseFixture(t, chromeStyleExport)

	if got := byURL["https://deep.example.com/"].Folder; got != "Nested deeper" {
		t.Errorf("folder = %q, want the deepest folder the bookmark sits in", got)
	}
	if got := byURL["https://root.example.com/"].Folder; got != "" {
		t.Errorf("folder = %q for a root bookmark, want empty (uncategorized)", got)
	}

	// A browser export is full of these. One bookmarklet must not fail an
	// import of two thousand links, so they are skipped rather than refused.
	for _, url := range []string{"javascript:alert(1)", "place:type=6"} {
		if _, found := byURL[url]; found {
			t.Errorf("%q was imported; only http(s) belongs in a bookmark", url)
		}
	}
}

// Safari writes the same format with different casing and no folder wrapper at
// the top level. Attribute lookups are case-insensitive for exactly this.
func TestParseNetscapeIsCaseInsensitive(t *testing.T) {
	byURL := parseFixture(t, `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<dl><p>
    <dt><a href="https://safari.example.com/" add_date="1700000000" tags="News">Lower case</a>
</dl>`)

	bm, ok := byURL["https://safari.example.com/"]
	if !ok {
		t.Fatal("a lower-case export produced nothing")
	}
	if bm.CreatedAt != 1700000000*1000 || len(bm.Tags) != 1 || bm.Tags[0] != "news" {
		t.Errorf("got %+v, want the date and tag read from lower-case attributes", bm)
	}
}

// The round trip is what makes the writer trustworthy: anything it writes that
// the reader cannot read back is a bug in one half or the other, and this is
// the cheapest way to find out which.
func TestNetscapeRoundTrip(t *testing.T) {
	groups := []NetscapeFolder{
		{Name: "", Bookmarks: []NetscapeBookmark{
			{Name: "Root link", URL: "https://root.example.com/", CreatedAt: 1600000000000},
		}},
		{Name: "Development & tools", Bookmarks: []NetscapeBookmark{
			{
				Name:      `A title with "quotes" & an ampersand`,
				URL:       "https://go.dev/?a=1&b=2",
				Tags:      []string{"go", "programming"},
				Note:      "A note with <angle brackets> in it",
				CreatedAt: 1610000000000,
				UpdatedAt: 1620000000000,
			},
		}},
	}

	var buf bytes.Buffer
	if err := WriteNetscapeBookmarks(&buf, groups); err != nil {
		t.Fatalf("write: %v", err)
	}

	byURL := parseFixture(t, buf.String())
	if len(byURL) != 2 {
		t.Fatalf("round trip produced %d bookmarks, want 2:\n%s", len(byURL), buf.String())
	}

	got := byURL["https://go.dev/?a=1&b=2"]
	// A URL with its own query string and a title with an ampersand are exactly
	// what a hand-built writer gets wrong.
	if got.Name != `A title with "quotes" & an ampersand` {
		t.Errorf("name = %q, want it back unchanged", got.Name)
	}
	if got.Folder != "Development & tools" {
		t.Errorf("folder = %q, want it back unchanged", got.Folder)
	}
	if got.Note != "A note with <angle brackets> in it" {
		t.Errorf("note = %q, want it back unchanged", got.Note)
	}
	if got.CreatedAt != 1610000000000 || got.UpdatedAt != 1620000000000 {
		t.Errorf("dates = %d/%d, want them back unchanged", got.CreatedAt, got.UpdatedAt)
	}
	if len(got.Tags) != 2 || got.Tags[0] != "go" {
		t.Errorf("tags = %v, want them back unchanged", got.Tags)
	}
	if byURL["https://root.example.com/"].Folder != "" {
		t.Error("a root bookmark came back inside a folder")
	}
}

func TestParseNetscapeHandlesAnEmptyFile(t *testing.T) {
	got, err := ParseNetscapeBookmarks(strings.NewReader(""))
	if err != nil {
		t.Fatalf("an empty file is not an error, got %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d bookmarks from an empty file", len(got))
	}
}
