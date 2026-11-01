package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const jsonFeed11Fixture = `
{"version":"https://jsonfeed.org/version/1.1","title":"JSON Blog","items":[
{"id":"old","url":"https://example.com/old","title":"Old","content_html":"<p>old</p>","date_published":"2024-01-01T10:00:00Z"},
{"id":"new","url":"https://example.com/new","external_url":"https://other.example/x","title":"New","content_html":"<p>Full <b>body</b></p>","content_text":"plain","summary":"short","image":"/img/new.png","banner_image":"https://example.com/banner.png","date_published":"2024-01-02T10:00:00Z"}
]}`

func TestParseJSONFeed11(t *testing.T) {
	title, items, err := parseFeedItems([]byte(jsonFeed11Fixture), "https://example.com/")
	if err != nil {
		t.Fatal(err)
	}
	if title != "JSON Blog" || len(items) != 2 {
		t.Fatalf("title=%q items=%d", title, len(items))
	}
	if items[0].Title != "New" || items[1].Title != "Old" {
		t.Fatalf("not newest first: %q, %q", items[0].Title, items[1].Title)
	}
	n := items[0]
	if n.ID != "new" || n.Link != "https://example.com/new" || n.PublishedAt == 0 {
		t.Fatalf("bad item: %+v", n)
	}
	if n.Summary != "<p>Full <b>body</b></p>" {
		t.Fatalf("content_html should win, got %q", n.Summary)
	}
	if n.ImageSource != "https://example.com/img/new.png" {
		t.Fatalf("image: %q", n.ImageSource)
	}
}

func TestParseJSONFeedContentTextEscaped(t *testing.T) {
	body := `  {"version":"https://jsonfeed.org/version/1","title":"T","items":[
{"id":"1","title":"One","content_text":"first <b>para</b>\n\nsecond & last"}]}`
	_, items, err := parseFeedItems([]byte(body), "https://example.com/")
	if err != nil || len(items) != 1 {
		t.Fatalf("err=%v items=%d", err, len(items))
	}
	s := items[0].Summary
	if strings.Contains(s, "<b>") || !strings.Contains(s, "&lt;b&gt;") || !strings.Contains(s, "&amp;") {
		t.Fatalf("text not escaped: %q", s)
	}
	if strings.Count(s, "<p>") != 2 {
		t.Fatalf("paragraphs lost: %q", s)
	}
}

func TestParseJSONFeedFallbacks(t *testing.T) {
	body := `{"version":"https://jsonfeed.org/version/1.1","title":"T","items":[
{"url":"https://example.com/a","content_text":"Headline line\nmore text","banner_image":"https://example.com/b.png","date_modified":"2024-03-01T00:00:00Z"},
{"id":"x","external_url":"https://other.example/e","title":"Ext","image":"javascript:alert(1)"}]}`
	_, items, err := parseFeedItems([]byte(body), "https://example.com/")
	if err != nil || len(items) != 2 {
		t.Fatalf("err=%v items=%d", err, len(items))
	}
	a := items[0]
	if a.ID != "https://example.com/a" || a.Title != "Headline line" || a.ImageSource != "https://example.com/b.png" || a.PublishedAt == 0 {
		t.Fatalf("fallbacks: %+v", a)
	}
	e := items[1]
	if e.Link != "https://other.example/e" || e.ImageSource != "" {
		t.Fatalf("external/image guard: %+v", e)
	}
}

func TestJSONFeedScriptIsSanitised(t *testing.T) {
	body := `{"version":"https://jsonfeed.org/version/1.1","title":"T","items":[
{"id":"1","title":"Bad","url":"javascript:alert(1)","content_html":"<p onclick=\"x()\">hi</p><script>alert(1)</script><a href=\"javascript:alert(2)\">l</a>"}]}`
	_, items, err := parseFeedItems([]byte(body), "https://example.com/")
	if err != nil || len(items) != 1 {
		t.Fatalf("err=%v items=%d", err, len(items))
	}
	low := strings.ToLower(items[0].Summary)
	if strings.Contains(low, "<script") || strings.Contains(low, "onclick") || strings.Contains(low, "javascript:") {
		t.Fatalf("unsafe summary: %q", items[0].Summary)
	}
	if items[0].Link != "" {
		t.Fatalf("link: %q", items[0].Link)
	}
}

func TestExtractFeedsFindsJSONFeed(t *testing.T) {
	head := `<html><head>
<link rel="alternate" type="application/feed+json" title="JSON" href="/feed.json">
<link rel="alternate" type="application/json" title="Site feed" href="/other.json">
<link rel="alternate" type="application/json" title="Oembed" href="/oembed?format=json">
</head></html>`
	got := extractFeedsFromHTML(head)
	if len(got) != 2 || got[0].URL != "/feed.json" || got[0].Type != "application/feed+json" || got[1].URL != "/other.json" {
		t.Fatalf("got %+v", got)
	}
}

func TestWatchJSONFeedNewItemIsNews(t *testing.T) {
	var items []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/feed+json")
		fmt.Fprintf(w, `{"version":"https://jsonfeed.org/version/1.1","title":"Stub","items":[%s]}`, strings.Join(items, ","))
	}))
	defer srv.Close()
	entry := func(id string, day int) string {
		return fmt.Sprintf(`{"id":%q,"url":"https://e.com/%s","title":%q,"content_text":"t","date_published":"2024-01-%02dT10:00:00Z"}`, id, id, id, day)
	}
	items = []string{entry("a", 1)}
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	items = []string{entry("a", 1), entry("b", 2)}
	w, news := h.pollWatch(context.Background(), w, watchNow)
	if len(news) != 1 || news[0].Title != "b" || len(w.Items) != 1 {
		t.Fatalf("news=%+v items=%d", news, len(w.Items))
	}
}
