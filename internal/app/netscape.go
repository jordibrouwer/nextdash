package app

import (
	"io"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

/*
The Netscape bookmark file, read and written.

One format, thirty years old, and every exporter still speaks it: Chrome,
Firefox, Safari and Edge, plus Pocket, Pinboard, Raindrop, linkding, Shiori,
Linkwarden and Karakeep. That is why this file is worth more than any single
API integration — one parser reaches all of them, with no token and no network.

It was parsed in the browser before, with DOMParser, and the result was posted
as {name, url, category}. So an export carrying tags, notes and dates arrived
here stripped to three fields, and a Bookmark that already has CreatedAt, Tags
and Note got none of them. Reading it server-side fixes that, and gives two
things the browser could not: import from a file the server already has, and
export through the same code that reads — which is what makes the collection
portable rather than merely stored.

golang.org/x/net/html rather than a hand-rolled scanner: an export is not valid
XML — <DT> is never closed, <p> is opened and abandoned — and folder nesting is
exactly where a scanner written against one browser's output breaks on another
browser's. The parser is the Go team's own, with the standard library's
compatibility promise.
*/

// NetscapeBookmark is one <DT><A> row, before it becomes a Bookmark.
//
// Times are Unix milliseconds — nextDash's own unit — converted from the
// seconds the format uses at the point they are read, so nothing downstream has
// to remember which unit it is holding.
type NetscapeBookmark struct {
	Name      string
	URL       string
	Folder    string
	Note      string
	Tags      []string
	CreatedAt int64
	UpdatedAt int64
	// ToRead is Delicious's TOREAD attribute, which every read-later exporter
	// kept. nextDash has no read state, so the caller decides what to do with
	// it rather than this parser inventing a field.
	ToRead  bool
	Private bool
}

// netscapeTimeToMillis converts the format's Unix seconds to milliseconds.
//
// Empty and unparseable values give 0, which every caller reads as "unknown" —
// filling in "now" instead would date a fifteen-year-old bookmark to today and
// put it at the top of Recently added.
func netscapeTimeToMillis(raw string) int64 {
	secs, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || secs <= 0 {
		return 0
	}
	return secs * 1000
}

// netscapeTags splits the Delicious TAGS attribute.
//
// Comma-separated by convention; normalizeTags does the lowering, trimming and
// de-duplicating so an imported tag cannot differ from a typed one.
func netscapeTags(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	return normalizeTags(strings.Split(raw, ","))
}

func nodeAttr(n *html.Node, name string) string {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, name) {
			return a.Val
		}
	}
	return ""
}

func nodeText(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.TextNode {
			b.WriteString(node.Data)
			return
		}
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return strings.TrimSpace(b.String())
}

func isElement(n *html.Node, name string) bool {
	return n != nil && n.Type == html.ElementNode && strings.EqualFold(n.Data, name)
}

/*
ParseNetscapeBookmarks reads an exported bookmark file.

Folders become a flat category name — the deepest folder a bookmark sits in —
because a category in nextDash is one level. A bookmark directly under the root
gets an empty folder, which the caller reads as uncategorized.

A <DD> description belongs to the <DT> before it, not inside it, which is the
one part of this format that trips up every naive reader.
*/
func ParseNetscapeBookmarks(r io.Reader) ([]NetscapeBookmark, error) {
	doc, err := html.Parse(r)
	if err != nil {
		return nil, err
	}

	var out []NetscapeBookmark

	// The parser normalises <DT> into a nesting the source never had: because
	// <DT> is never closed, everything that follows it — including the nested
	// <DL> of a folder — becomes its child. So the walk carries the folder name
	// down rather than looking for a sibling <DL>.
	var walk func(n *html.Node, folder string)
	walk = func(n *html.Node, folder string) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			switch {
			case isElement(c, "dt"):
				// A folder heading and a link are mutually exclusive: <H3> names
				// a folder, <A> is a bookmark.
				var heading, anchor *html.Node
				for d := c.FirstChild; d != nil; d = d.NextSibling {
					if heading == nil && isElement(d, "h3") {
						heading = d
					}
					if anchor == nil && isElement(d, "a") {
						anchor = d
					}
				}

				if heading != nil {
					name := nodeText(heading)
					if name == "" {
						name = folder
					}
					walk(c, name)
					continue
				}

				if anchor != nil {
					bm := netscapeBookmarkFrom(anchor, folder)
					if bm != nil {
						// The <DD> that describes it follows the <DT>, as a
						// sibling. Take the first one before the next <DT>.
						for s := c.NextSibling; s != nil; s = s.NextSibling {
							if isElement(s, "dt") {
								break
							}
							if isElement(s, "dd") {
								bm.Note = nodeText(s)
								break
							}
						}
						out = append(out, *bm)
					}
				}
				// A <DT> can still contain a nested <DL> even when it held a
				// link, so keep walking with the folder unchanged.
				walk(c, folder)

			default:
				walk(c, folder)
			}
		}
	}

	walk(doc, "")
	return out, nil
}

// netscapeBookmarkFrom builds one row, or nil when the address is not one we
// would ever store. Anything that is not http(s) — javascript:, place:, data: —
// is skipped rather than refused: a browser export is full of them, and one
// bookmarklet must not fail an import of two thousand links.
func netscapeBookmarkFrom(a *html.Node, folder string) *NetscapeBookmark {
	href := strings.TrimSpace(nodeAttr(a, "href"))
	if href == "" {
		return nil
	}
	lower := strings.ToLower(href)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return nil
	}

	name := nodeText(a)
	if name == "" {
		name = href
	}

	return &NetscapeBookmark{
		Name:      name,
		URL:       href,
		Folder:    folder,
		Tags:      netscapeTags(nodeAttr(a, "tags")),
		CreatedAt: netscapeTimeToMillis(nodeAttr(a, "add_date")),
		UpdatedAt: netscapeTimeToMillis(nodeAttr(a, "last_modified")),
		ToRead:    nodeAttr(a, "toread") == "1",
		Private:   nodeAttr(a, "private") == "1",
	}
}

/*
WriteNetscapeBookmarks writes the same format back.

Grouped by folder, in the order the folders are first seen, because a file that
comes back with its categories shuffled reads as a different collection. The
attributes written are the ones ParseNetscapeBookmarks reads, which is what
makes the round-trip test in netscape_test.go meaningful: anything written that
cannot be read back is a bug in one half or the other.
*/
func WriteNetscapeBookmarks(w io.Writer, groups []NetscapeFolder) error {
	var b strings.Builder
	b.WriteString("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n")
	b.WriteString("<!-- This is an automatically generated file.\n")
	b.WriteString("     It will be read and overwritten.\n")
	b.WriteString("     DO NOT EDIT! -->\n")
	b.WriteString(`<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">` + "\n")
	b.WriteString("<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n")

	for _, group := range groups {
		indent := "    "
		if group.Name != "" {
			b.WriteString("    <DT><H3>" + html.EscapeString(group.Name) + "</H3>\n")
			b.WriteString("    <DL><p>\n")
			indent = "        "
		}
		for _, bm := range group.Bookmarks {
			b.WriteString(indent + "<DT><A HREF=\"" + html.EscapeString(bm.URL) + "\"")
			if bm.CreatedAt > 0 {
				b.WriteString(` ADD_DATE="` + strconv.FormatInt(bm.CreatedAt/1000, 10) + `"`)
			}
			if bm.UpdatedAt > 0 {
				b.WriteString(` LAST_MODIFIED="` + strconv.FormatInt(bm.UpdatedAt/1000, 10) + `"`)
			}
			if len(bm.Tags) > 0 {
				b.WriteString(` TAGS="` + html.EscapeString(strings.Join(bm.Tags, ",")) + `"`)
			}
			b.WriteString(">" + html.EscapeString(bm.Name) + "</A>\n")
			if strings.TrimSpace(bm.Note) != "" {
				b.WriteString(indent + "<DD>" + html.EscapeString(bm.Note) + "\n")
			}
		}
		if group.Name != "" {
			b.WriteString("    </DL><p>\n")
		}
	}

	b.WriteString("</DL><p>\n")
	_, err := io.WriteString(w, b.String())
	return err
}

// NetscapeFolder is one folder's worth of bookmarks, for the writer.
type NetscapeFolder struct {
	Name      string
	Bookmarks []NetscapeBookmark
}
