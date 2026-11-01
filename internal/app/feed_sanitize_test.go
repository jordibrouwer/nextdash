package app

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSanitizeFeedHTML(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"keeps allowed tags", `<p>Hi <b>there</b></p>`, `<p>Hi <b>there</b></p>`},
		{"drops attributes", `<p onclick="x()">a</p>`, `<p>a</p>`},
		{"drops script with content", `<script>alert(1)</script>ok`, `ok`},
		{"unwraps javascript link", `<a href="javascript:alert(1)">x</a>`, `x`},
		{"hardens http link", `<a href="https://e.com/a" title="t">x</a>`, `<a href="https://e.com/a" rel="noopener noreferrer" target="_blank">x</a>`},
		{"drops images", `<img src="https://e.com/i.png" onerror="x">text`, `text`},
		{"unwraps blocks", `<div><h2>T</h2><span>s</span></div>`, `T s`},
		{"keeps lists", `<ul><li>a</li><li>b</li></ul>`, `<ul><li>a</li><li>b</li></ul>`},
		{"escapes text", `1 < 2 &amp; 3`, `1 &lt; 2 &amp; 3`},
		{"drops iframe content", `<iframe>inner</iframe>after`, `after`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := strings.Join(strings.Fields(sanitizeFeedHTML(c.in, 0)), " ")
			if got != c.want {
				t.Fatalf("sanitizeFeedHTML(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestSanitizeFeedHTMLEscapedMarkupIsUnescapedOnce(t *testing.T) {
	// After XML decoding, an escaped description arrives as real markup.
	got := sanitizeFeedHTML("<p>escaped</p>", 0)
	if got != "<p>escaped</p>" {
		t.Fatalf("got %q", got)
	}
}

func TestSanitizeFeedHTMLTruncatesAndBalances(t *testing.T) {
	in := "<p><b>" + strings.Repeat("x", 2000) + "</b></p>"
	got := sanitizeFeedHTML(in, 600)
	plain := strings.NewReplacer("<p>", "", "</p>", "", "<b>", "", "</b>", "").Replace(got)
	if n := utf8.RuneCountInString(plain); n > 601 {
		t.Fatalf("visible runes = %d, want <= 601", n)
	}
	if !strings.HasSuffix(plain, "…") {
		t.Fatalf("missing ellipsis: %q", got[len(got)-20:])
	}
	if strings.Count(got, "<b>") != strings.Count(got, "</b>") || strings.Count(got, "<p>") != strings.Count(got, "</p>") {
		t.Fatalf("unbalanced tags: %q", got[:20]+"…"+got[len(got)-30:])
	}
}
