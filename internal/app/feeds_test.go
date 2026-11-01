package app

import (
	"testing"
	"time"
)

// Read as RSS 2.0 it had no items: the tile said nothing was published.
func TestAnRDFFeedHasItems(t *testing.T) {
	rdf := []byte(`<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><title>Slash</title><link>https://slash.example/</link></channel>
  <item><title>First story</title><link>https://slash.example/1</link><dc:date>2026-09-30T10:00:00+00:00</dc:date></item>
  <item><title>Second story</title><link>https://slash.example/2</link><dc:date>2026-09-30T09:00:00+00:00</dc:date></item>
</rdf:RDF>`)
	items, _ := parseRSSItems(rdf)
	if len(items) != 2 || items[0].Title != "First story" || items[0].Source != "Slash" {
		t.Fatalf("items = %+v", items)
	}
}

// Dates as feeds really write them: a one-digit day, no seconds, no weekday,
// UT, a colon in the offset, and US zone names read at their own offset.
func TestFeedDatesInTheVariantsFeedsUse(t *testing.T) {
	want := time.Date(2026, 10, 1, 15, 4, 0, 0, time.UTC).UnixMilli()
	for _, raw := range []string{
		"Thu, 1 Oct 2026 15:04:00 +0000",
		"Thu, 1 Oct 2026 15:04 +0000",
		"01 Oct 2026 15:04:00 +0000",
		"Thu, 01 Oct 2026 15:04:00 UT",
		"Thu, 01 Oct 2026 17:04:00 +02:00",
		"Thu, 01 Oct 2026 11:04:00 EDT",
	} {
		if got := parseFeedTime(raw); got != want {
			t.Errorf("parseFeedTime(%q) = %d, want %d", raw, got, want)
		}
	}
}
