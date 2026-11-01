package app

import "testing"

const rssItemsFixture = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Blog</title>
<item><title>Old</title><link>https://example.com/old</link><guid>g-old</guid><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate><description>old text</description></item>
<item><title>New</title><link>https://example.com/new</link><guid>g-new</guid><pubDate>Tue, 02 Jan 2024 10:00:00 GMT</pubDate><description>short</description><content:encoded><![CDATA[<p>Full <b>body</b></p>]]></content:encoded></item>
</channel></rss>`

func TestParseFeedItemsRSS(t *testing.T) {
	title, items, err := parseFeedItems([]byte(rssItemsFixture), "https://example.com/")
	if err != nil {
		t.Fatal(err)
	}
	if title != "Blog" || len(items) != 2 {
		t.Fatalf("title=%q items=%d", title, len(items))
	}
	if items[0].Title != "New" || items[1].Title != "Old" {
		t.Fatalf("not newest first: %q, %q", items[0].Title, items[1].Title)
	}
	if items[0].ID != "g-new" || items[0].Link != "https://example.com/new" || items[0].PublishedAt == 0 {
		t.Fatalf("bad item: %+v", items[0])
	}
	if items[0].Summary != "<p>Full <b>body</b></p>" {
		t.Fatalf("content:encoded should win, got %q", items[0].Summary)
	}
	if items[1].Summary != "old text" {
		t.Fatalf("description fallback, got %q", items[1].Summary)
	}
}

func TestParseFeedItemsAtom(t *testing.T) {
	atom := `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title>One</title><id>tag:x,1</id>
<link rel="replies" href="https://e.com/replies"/><link rel="alternate" href="https://e.com/one"/>
<updated>2024-01-02T10:00:00Z</updated><summary>sum</summary><content type="html">&lt;p&gt;html&lt;/p&gt;</content></entry></feed>`
	_, items, err := parseFeedItems([]byte(atom), "https://e.com/")
	if err != nil || len(items) != 1 {
		t.Fatalf("err=%v items=%d", err, len(items))
	}
	it := items[0]
	if it.ID != "tag:x,1" || it.Link != "https://e.com/one" || it.Summary != "<p>html</p>" {
		t.Fatalf("bad atom item: %+v", it)
	}
}

func TestParseFeedItemsRDF(t *testing.T) {
	rdf := `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>R</title></channel>
<item><title>I1</title><link>https://r.org/1</link><dc:date>2024-01-02T10:00:00Z</dc:date></item></rdf:RDF>`
	_, items, err := parseFeedItems([]byte(rdf), "https://r.org/")
	if err != nil || len(items) != 1 || items[0].Title != "I1" {
		t.Fatalf("err=%v items=%+v", err, items)
	}
}

func TestParseFeedItemsRejectsNonFeed(t *testing.T) {
	if _, _, err := parseFeedItems([]byte("<html><body>no</body></html>"), "https://e.com/"); err == nil {
		t.Fatal("expected an error for a non-feed")
	}
}

func TestFeedEntryImageSources(t *testing.T) {
	wrap := func(item string) string {
		return `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>t</title><item><title>x</title><link>https://e.com/p</link>` + item + `</item></channel></rss>`
	}
	cases := []struct{ name, item, want string }{
		{"enclosure image", `<enclosure url="https://e.com/a.jpg" type="image/jpeg"/>`, "https://e.com/a.jpg"},
		{"enclosure audio ignored", `<enclosure url="https://e.com/a.mp3" type="audio/mpeg"/>`, ""},
		{"media content", `<media:content url="https://e.com/m.png" medium="image"/>`, "https://e.com/m.png"},
		{"media thumbnail", `<media:thumbnail url="https://e.com/t.png"/>`, "https://e.com/t.png"},
		{"media group", `<media:group><media:content url="https://e.com/g.png" type="image/png"/></media:group>`, "https://e.com/g.png"},
		{"first img in description", `<description><![CDATA[<p><img src="https://e.com/d.png"> hi</p>]]></description>`, "https://e.com/d.png"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, items, err := parseFeedItems([]byte(wrap(c.item)), "https://e.com/")
			if err != nil || len(items) != 1 {
				t.Fatalf("err=%v items=%d", err, len(items))
			}
			if items[0].ImageSource != c.want {
				t.Fatalf("ImageSource = %q, want %q", items[0].ImageSource, c.want)
			}
		})
	}
}

func TestFeedItemsResolveRelativeURLs(t *testing.T) {
	body := `<rss version="2.0"><channel><title>t</title><item><title>x</title><link>/post/1</link><description><![CDATA[<img src="img/a.png">]]></description></item></channel></rss>`
	_, items, err := parseFeedItems([]byte(body), "https://example.com/blog/")
	if err != nil || len(items) != 1 {
		t.Fatalf("err=%v items=%d", err, len(items))
	}
	if items[0].Link != "https://example.com/post/1" {
		t.Fatalf("link = %q", items[0].Link)
	}
	if items[0].ImageSource != "https://example.com/post/img/a.png" {
		t.Fatalf("image = %q", items[0].ImageSource)
	}
}

func TestFeedItemIDFallbacks(t *testing.T) {
	if got := feedItemID(feedSourceEntry{GUID: "g", ID: "i"}); got != "g" {
		t.Fatalf("guid first, got %q", got)
	}
	if got := feedItemID(feedSourceEntry{ID: "i"}); got != "i" {
		t.Fatalf("id second, got %q", got)
	}
	if got := feedItemID(feedSourceEntry{Links: []feedSourceLink{{Text: "https://e.com/x"}}}); got != "https://e.com/x" {
		t.Fatalf("link third, got %q", got)
	}
	if got := feedItemID(feedSourceEntry{Titles: []string{"t"}, Published: "p"}); len(got) != 16 {
		t.Fatalf("hash fallback should be 16 chars, got %q", got)
	}
}
