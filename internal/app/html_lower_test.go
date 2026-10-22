package app

import "testing"

// Offsets found in a lowered copy index the original, so the copy must keep
// the original's byte length even when the page is not valid UTF-8.
func TestHTMLExtractorsSurviveLengthChangingBytes(t *testing.T) {
	h := &Handlers{}
	// Each prefix changes length under strings.ToLower: an invalid byte
	// becomes U+FFFD (3 bytes), the Kelvin sign and U+0130 shrink/grow.
	for _, prefix := range []string{"\xe9\xe9\xe9\xe9", "KKK", "İİİ"} {
		if got := h.extractTitleFromHTML(prefix + "<title>Hi</title>"); got != "Hi" {
			t.Errorf("extractTitleFromHTML(%q) = %q", prefix, got)
		}
		if got := extractHTMLTitle(prefix + "<TITLE>Hi</TITLE>"); got != "Hi" {
			t.Errorf("extractHTMLTitle(%q) = %q", prefix, got)
		}
		meta := prefix + `<meta property="og:title" content="Hello">`
		if got := h.extractMetaFromHTML(meta, "property", "og:title"); got != "Hello" {
			t.Errorf("extractMetaFromHTML(%q) = %q", prefix, got)
		}
		icon := prefix + `<LINK rel="icon" href="/f.ico">`
		if got := h.extractIconFromHTML(icon); got != "/f.ico" {
			t.Errorf("extractIconFromHTML(%q) = %q", prefix, got)
		}
		feed := prefix + `<link rel="alternate" type="application/rss+xml" href="/feed.xml">`
		if got := extractFeedFromHTML(feed); got != "/feed.xml" {
			t.Errorf("extractFeedFromHTML(%q) = %q", prefix, got)
		}
	}
}

func TestAsciiLowerKeepsLength(t *testing.T) {
	in := "AB\xe9KZ"
	out := asciiLower(in)
	if len(out) != len(in) || out != "ab\xe9Kz" {
		t.Errorf("asciiLower(%q) = %q", in, out)
	}
}
