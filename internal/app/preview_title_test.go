package app

import "testing"

// A page's <title> is markup like the rest of the document, so "Q&amp;A" in
// the source is "Q&A" on the page. The preview read it raw, and the bookmark
// form, the card and every other reader showed the entity as written.
func TestExtractTitleFromHTMLDecodesEntities(t *testing.T) {
	h := &Handlers{}
	cases := map[string]string{
		"<head><title>Q&amp;A &#8211; Tom&#39;s  site</title></head>": "Q&A – Tom's site",
		"<title>\n  Plain title\n</title>":                               "Plain title",
		"<title>&lt;b&gt; is bold</title>":                                "<b> is bold",
	}
	for in, want := range cases {
		if got := h.extractTitleFromHTML(in); got != want {
			t.Errorf("extractTitleFromHTML(%q) = %q, want %q", in, got, want)
		}
	}
}
