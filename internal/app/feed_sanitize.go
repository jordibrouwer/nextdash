package app

import (
	"html"
	"strings"
	"unicode/utf8"

	xhtml "golang.org/x/net/html"
)

/*
sanitizeFeedHTML reduces the markup of a feed entry to a handful of tags.

A feed is somebody else's HTML that nextDash would otherwise hand to innerHTML,
so the rule is an allowlist, not a blocklist: the tags below survive without
attributes, links survive with an http(s) href only, and everything else is
unwrapped so its text stays. The elements in feedDropContent lose their text as
well, because their text is code or has no reading value.
*/
var feedAllowedTags = map[string]bool{
	"p": true, "b": true, "strong": true, "i": true, "em": true,
	"a": true, "ul": true, "ol": true, "li": true, "br": true,
}

var feedDropContent = map[string]bool{
	"script": true, "style": true, "iframe": true, "object": true, "embed": true,
	"noscript": true, "template": true, "svg": true, "math": true,
}

// feedBlockTags are unwrapped, but still separate the words either side.
var feedBlockTags = map[string]bool{
	"div": true, "h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"section": true, "article": true, "blockquote": true, "pre": true, "table": true,
	"tr": true, "td": true, "th": true, "figure": true, "figcaption": true, "dl": true,
	"dt": true, "dd": true, "hr": true,
}

// sanitizeFeedHTML returns the allowed subset of raw. maxRunes > 0 cuts the
// visible text at that many runes, adds an ellipsis and closes open tags;
// 0 means no cut.
func sanitizeFeedHTML(raw string, maxRunes int) string {
	z := xhtml.NewTokenizer(strings.NewReader(raw))
	var out strings.Builder
	var open []string
	visible := 0
	skipDepth := 0
	var skipTag string

	closeAll := func() {
		for i := len(open) - 1; i >= 0; i-- {
			out.WriteString("</" + open[i] + ">")
		}
		open = nil
	}
	space := func() {
		if s := out.String(); s != "" && !strings.HasSuffix(s, " ") && !strings.HasSuffix(s, ">") {
			out.WriteByte(' ')
		}
	}

	for {
		tt := z.Next()
		if tt == xhtml.ErrorToken {
			break
		}
		switch tt {
		case xhtml.TextToken:
			if skipDepth > 0 {
				continue
			}
			text := string(z.Text())
			if maxRunes > 0 {
				left := maxRunes - visible
				if utf8.RuneCountInString(text) > left {
					runes := []rune(text)
					if left < 0 {
						left = 0
					}
					out.WriteString(html.EscapeString(string(runes[:left])))
					out.WriteString("…")
					closeAll()
					return out.String()
				}
			}
			visible += utf8.RuneCountInString(text)
			out.WriteString(html.EscapeString(text))
		case xhtml.StartTagToken, xhtml.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			tag := string(name)
			if skipDepth > 0 {
				if tt == xhtml.StartTagToken && tag == skipTag {
					skipDepth++
				}
				continue
			}
			if feedDropContent[tag] {
				if tt == xhtml.StartTagToken {
					skipDepth, skipTag = 1, tag
				}
				continue
			}
			if feedBlockTags[tag] {
				space()
				continue
			}
			if !feedAllowedTags[tag] {
				continue
			}
			if tag == "a" {
				href := ""
				for hasAttr {
					var k, v []byte
					k, v, hasAttr = z.TagAttr()
					if string(k) == "href" {
						href = strings.TrimSpace(string(v))
					}
				}
				lower := strings.ToLower(href)
				if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
					continue
				}
				out.WriteString(`<a href="` + html.EscapeString(href) + `" rel="noopener noreferrer" target="_blank">`)
				open = append(open, "a")
				continue
			}
			if tag == "br" {
				out.WriteString("<br>")
				continue
			}
			out.WriteString("<" + tag + ">")
			if tt == xhtml.StartTagToken {
				open = append(open, tag)
			}
		case xhtml.EndTagToken:
			name, _ := z.TagName()
			tag := string(name)
			if skipDepth > 0 {
				if tag == skipTag {
					skipDepth--
				}
				continue
			}
			if feedBlockTags[tag] {
				space()
				continue
			}
			// Only close what this sanitiser opened, innermost first.
			for i := len(open) - 1; i >= 0; i-- {
				if open[i] == tag {
					for j := len(open) - 1; j >= i; j-- {
						out.WriteString("</" + open[j] + ">")
					}
					open = open[:i]
					break
				}
			}
		}
	}
	closeAll()
	return strings.TrimSpace(out.String())
}
