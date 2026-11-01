package app

import (
	"fmt"
	"net/url"
	"sort"
	"strings"
)

/*
The "watched feeds" part of the weekly digest.

It counts the entries each watch remembers (Recent) that were published in the
digest's week. Muted feeds are included: the digest is a summary, not an alert.
A feed keeps at most feedWatchRecent entries, so a feed that has that many in
the week may have had more, and the total is then "at least".
*/

// digestFeeds: Items and Sites are exact counts of what was found in Recent;
// AtLeast says a feed was full, Top is the busiest sites, a sample.
type digestFeeds struct {
	Items   int             `json:"items"`
	Sites   int             `json:"sites"`
	AtLeast bool            `json:"atLeast,omitempty"`
	Top     []digestCounted `json:"top,omitempty"`
}

// digestFeedsNamed is how many sites the line names before "and N more".
const digestFeedsNamed = 2

func buildDigestFeeds(in digestInput) *digestFeeds {
	since := in.Now.Add(-digestNewWindow).UnixMilli()
	now := in.Now.UnixMilli()
	names := map[string]string{}
	for _, bm := range in.Bookmarks {
		key := canonicalBookmarkURLKey(bm.URL)
		if _, ok := names[key]; !ok && strings.TrimSpace(bm.Name) != "" {
			names[key] = strings.TrimSpace(bm.Name)
		}
	}
	perSite := map[string]int{}
	total := 0
	f := &digestFeeds{}
	for _, w := range in.Feeds {
		n := 0
		for _, it := range w.Recent {
			at := it.PublishedAt
			if at == 0 {
				at = it.FoundAt
			}
			if at >= since && at <= now {
				n++
			}
		}
		if n == 0 {
			continue
		}
		if n >= feedWatchRecent {
			f.AtLeast = true
		}
		name := names[w.BookmarkKey]
		if name == "" {
			name = strings.TrimSpace(w.Title)
		}
		if name == "" {
			if u, err := url.Parse(w.FeedURL); err == nil {
				name = u.Hostname()
			}
		}
		if name == "" {
			name = w.FeedURL
		}
		perSite[name] += n
		total += n
	}
	if total == 0 {
		return nil
	}
	f.Items = total
	f.Sites = len(perSite)
	for name, n := range perSite {
		f.Top = append(f.Top, digestCounted{Name: name, Count: n})
	}
	sort.Slice(f.Top, func(i, j int) bool {
		if f.Top[i].Count != f.Top[j].Count {
			return f.Top[i].Count > f.Top[j].Count
		}
		return f.Top[i].Name < f.Top[j].Name
	})
	if len(f.Top) > digestNamesMax {
		f.Top = f.Top[:digestNamesMax]
	}
	return f
}

// digestFeedsCount is "23 items on 5 sites", "at least 23 items on 5 sites".
func digestFeedsCount(f *digestFeeds) string {
	s := digestCount(f.Items, "item", "items") + " on " + digestCount(f.Sites, "site", "sites")
	if f.AtLeast {
		s = "at least " + s
	}
	return s
}

func digestFeedsLead(f *digestFeeds) string {
	return "watched feeds published " + digestFeedsCount(f)
}

// digestFeedsLine: "Watched feeds published 23 items on 5 sites this week: A (9), B (6) and 3 more".
func digestFeedsLine(f *digestFeeds) string {
	var named []string
	for i, c := range f.Top {
		if i >= digestFeedsNamed && f.Sites > digestFeedsNamed+1 {
			break
		}
		named = append(named, fmt.Sprintf("%s (%d)", c.Name, c.Count))
	}
	list := strings.Join(named, ", ")
	if len(named) == f.Sites && len(named) > 1 {
		list = strings.Join(named[:len(named)-1], ", ") + " and " + named[len(named)-1]
	} else if more := f.Sites - len(named); more > 0 {
		list += fmt.Sprintf(" and %d more", more)
	}
	return "Watched feeds published " + digestFeedsCount(f) + " this week: " + list + "."
}
