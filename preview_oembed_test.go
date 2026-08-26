package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
oEmbed is discovered from the page rather than from a bundled provider list.

The atlas suggests embedding providers.json -- 373 patterns. Measured against
the real thing that is unnecessary: YouTube's watch page carries its own
discovery link, and the document is already in hand. A bundled list goes stale;
the page's own link is current by definition.
*/
func TestDiscoverOEmbedURL(t *testing.T) {
	// Attribute order varies, so both are read.
	typeFirst := `<link type="application/json+oembed" href="https://p.example/oembed?url=x">`
	hrefFirst := `<link href="https://p.example/oembed?url=x" type="application/json+oembed">`
	for name, doc := range map[string]string{"type first": typeFirst, "href first": hrefFirst} {
		if got := discoverOEmbedURL(doc, "https://p.example/watch"); got != "https://p.example/oembed?url=x" {
			t.Errorf("%s: got %q", name, got)
		}
	}

	// Entities: an href in HTML is escaped, and &amp; is one ampersand.
	escaped := `<link type="application/json+oembed" href="https://p.example/oembed?a=1&amp;b=2">`
	if got := discoverOEmbedURL(escaped, "https://p.example/watch"); !strings.Contains(got, "a=1&b=2") {
		t.Errorf("entity not decoded: %q", got)
	}

	// A relative href resolves against the page it came from.
	if got := discoverOEmbedURL(`<link type="application/json+oembed" href="/oembed?url=x">`,
		"https://p.example/watch"); got != "https://p.example/oembed?url=x" {
		t.Errorf("relative href = %q", got)
	}

	// A page offering nothing gets nothing, and no request follows.
	if got := discoverOEmbedURL(`<html><head><title>x</title></head></html>`, "https://p.example/"); got != "" {
		t.Errorf("invented an endpoint: %q", got)
	}
}

/*
The provider fills in what the page did not say, and never overwrites it.

A publisher's own og:title is what they chose to put on the page; the provider's
title for the same thing is a second opinion. The one genuinely new field is the
player.
*/
func TestApplyOEmbedFillsGapsWithoutOverwriting(t *testing.T) {
	data := oembedResponse{
		Type: "video", Title: "Provider title", AuthorName: "Someone",
		ProviderName: "YouTube", ThumbnailURL: "https://p.example/thumb.jpg",
		HTML: "<iframe src=\"https://p.example/embed\"></iframe>",
	}

	// A preview that already knows its title keeps it.
	preview := BookmarkPreview{Title: "The page's own title"}
	applyOEmbed(&preview, data)
	if preview.Title != "The page's own title" {
		t.Errorf("overwrote the page's own title with %q", preview.Title)
	}
	if preview.Author != "Someone" || preview.SiteName != "YouTube" {
		t.Errorf("gaps not filled: author=%q site=%q", preview.Author, preview.SiteName)
	}
	if preview.EmbedHTML == "" {
		t.Error("no player kept for a video")
	}

	// An empty preview takes the provider's title.
	empty := BookmarkPreview{}
	applyOEmbed(&empty, data)
	if empty.Title != "Provider title" {
		t.Errorf("title = %q", empty.Title)
	}

	// A "link" response has no player, so none is stored.
	linkOnly := BookmarkPreview{}
	applyOEmbed(&linkOnly, oembedResponse{Type: "link", HTML: "<iframe></iframe>"})
	if linkOnly.EmbedHTML != "" {
		t.Errorf("kept a player for a link response: %q", linkOnly.EmbedHTML)
	}
}

// A provider returning kilobytes of markup is not returning an embed.
func TestFetchOEmbedDropsOversizedPlayers(t *testing.T) {
	h := newTestHandlers(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(oembedResponse{
			Type: "rich", Title: "Big", HTML: strings.Repeat("<div>x</div>", 2000),
		})
	}))
	defer server.Close()

	data, ok := h.fetchOEmbed(context.Background(), server.URL)
	if !ok {
		t.Fatal("fetch failed")
	}
	if data.HTML != "" {
		t.Errorf("kept %d bytes of markup as a player", len(data.HTML))
	}
	// The rest of the answer is still useful.
	if data.Title != "Big" {
		t.Errorf("lost the title along with the markup: %q", data.Title)
	}
}

// An endpoint answering with something else is not an error worth reporting:
// oEmbed is enrichment, and the preview is already built without it.
func TestFetchOEmbedSurvivesANonJSONAnswer(t *testing.T) {
	h := newTestHandlers(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "<oembed><type>video</type></oembed>")
	}))
	defer server.Close()

	if _, ok := h.fetchOEmbed(context.Background(), server.URL); ok {
		t.Error("reported success on an XML answer")
	}
}
