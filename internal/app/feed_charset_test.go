package app

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// A feed declared ISO-8859-1 is read, with its accents intact.
func TestDecodeFeedXMLReadsLatin1(t *testing.T) {
	raw := []byte("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><rss><channel><title>Caf\xe9 \x93news\x94</title></channel></rss>")
	var doc feedSourceDoc
	if err := decodeFeedXML(raw, &doc); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if doc.Title != "Café “news”" {
		t.Fatalf("title = %q", doc.Title)
	}
	if !isFeedDocument(raw) {
		t.Fatalf("a Latin-1 feed is not recognised as a feed")
	}
}

// An Atom entry whose last <link> is rel="replies" still has its address.
func TestFeedEntryURLReadsEveryAtomLink(t *testing.T) {
	raw := []byte(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title>` +
		`<link rel="alternate" href="https://blog.example/a"/><link rel="replies" href="https://blog.example/a#comments"/></entry></feed>`)
	var doc feedSourceDoc
	if err := decodeFeedXML(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Entries) != 1 || doc.Entries[0].url() != "https://blog.example/a" {
		t.Fatalf("entries = %+v", doc.Entries)
	}
}

// A summary is cut on a character, not in the middle of one.
func TestFeedEntryNoteCutsOnACharacter(t *testing.T) {
	note := feedEntryNote(feedSourceEntry{Description: strings.Repeat("é", 400)})
	if !utf8.ValidString(note) || utf8.RuneCountInString(note) != 400 {
		t.Fatalf("note: valid %v, %d runes", utf8.ValidString(note), utf8.RuneCountInString(note))
	}
}
