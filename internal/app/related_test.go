package app

import (
	"strings"
	"testing"
)

func relatedNames(links []relatedLink) string {
	out := make([]string, 0, len(links))
	for _, l := range links {
		out = append(out, l.Name)
	}
	return strings.Join(out, ",")
}

func TestRelatedPrefersRareSharedTags(t *testing.T) {
	// "dev" is on everything; "gitops" only on two. Sharing the rare tag wins.
	all := []Bookmark{
		{Name: "Argo", URL: "https://argo.example/", PageID: 1, Tags: []string{"dev", "gitops"}},
		{Name: "Flux", URL: "https://flux.example/", PageID: 1, Tags: []string{"dev", "gitops"}},
		{Name: "MDN", URL: "https://mdn.example/", PageID: 1, Tags: []string{"dev"}},
		{Name: "Go", URL: "https://go.example/", PageID: 1, Tags: []string{"dev"}},
		{Name: "Bank", URL: "https://bank.example/", PageID: 1, Tags: []string{"money"}},
	}
	got := relatedTo("https://argo.example/", all)
	if len(got) == 0 || got[0].Name != "Flux" {
		t.Fatalf("Flux shares the rare tag and must come first: %s", relatedNames(got))
	}
	for _, l := range got {
		if l.Name == "Bank" || l.Name == "Argo" {
			t.Fatalf("unrelated or self in the answer: %s", relatedNames(got))
		}
	}
}

func TestRelatedSiteAndNoise(t *testing.T) {
	all := []Bookmark{
		{Name: "Docs", URL: "https://www.svc.example/docs", PageID: 1},
		{Name: "Forum", URL: "https://svc.example/forum", PageID: 2},
		{Name: "Other", URL: "https://other.example/", PageID: 1},
	}
	got := relatedTo("https://www.svc.example/docs", all)
	if relatedNames(got) != "Forum" || got[0].Reasons[0] != "site" {
		t.Fatalf("same site (www ignored): %s", relatedNames(got))
	}
	// A bookmark with no tags, no site mates and no history has nothing related.
	if got := relatedTo("https://other.example/", all); len(got) != 0 {
		t.Fatalf("no row for a bookmark with no real link: %s", relatedNames(got))
	}
	if got := relatedTo("https://nowhere.example/", all); len(got) != 0 {
		t.Fatalf("an unknown address has no related links: %s", relatedNames(got))
	}
}

func TestRelatedCoOpenNeedsAHabit(t *testing.T) {
	min := int64(60 * 1000)
	a := []int64{1000 * min, 2000 * min, 3000 * min}
	together := []int64{1003 * min, 2005 * min, 3500 * min} // two of three within 10 minutes
	once := []int64{1002 * min, 5000 * min, 6000 * min}     // one coincidence
	all := []Bookmark{
		{Name: "A", URL: "https://a.example/", PageID: 1, OpenLog: a},
		{Name: "Together", URL: "https://t.example/", PageID: 1, OpenLog: together},
		{Name: "Once", URL: "https://o.example/", PageID: 1, OpenLog: once},
	}
	got := relatedTo("https://a.example/", all)
	if relatedNames(got) != "Together" || got[0].Reasons[0] != "coopen" {
		t.Fatalf("only the habit counts: %s", relatedNames(got))
	}
}

func TestRelatedRareTagBeatsCommonTag(t *testing.T) {
	// "a" is on five of six bookmarks, "r" on two. On a tie the name would put
	// Xa first, so only the weighting can put Yr there.
	all := []Bookmark{
		{Name: "T", URL: "https://t.example/", PageID: 1, Tags: []string{"a", "r"}},
		{Name: "Xa", URL: "https://x.example/", PageID: 1, Tags: []string{"a"}},
		{Name: "Yr", URL: "https://y.example/", PageID: 1, Tags: []string{"r"}},
		{Name: "f1", URL: "https://f1.example/", PageID: 1, Tags: []string{"a"}},
		{Name: "f2", URL: "https://f2.example/", PageID: 1, Tags: []string{"a"}},
		{Name: "f3", URL: "https://f3.example/", PageID: 1, Tags: []string{"a"}},
	}
	got := relatedTo("https://t.example/", all)
	if len(got) == 0 || got[0].Name != "Yr" {
		t.Fatalf("the rare tag counts for more: %s", relatedNames(got))
	}
}

func relatedFillers(n int, tag string) []Bookmark {
	out := make([]Bookmark, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, Bookmark{Name: "filler" + strings.Repeat("x", i), URL: "https://filler" + strings.Repeat("x", i) + ".example/", PageID: 1, Tags: []string{tag}})
	}
	return out
}

func TestRelatedLeavesOutUnsortedAndDuplicates(t *testing.T) {
	all := append([]Bookmark{
		{Name: "Me", URL: "https://me.example/", PageID: 1, Tags: []string{"x", "y"}},
		{Name: "Kept", URL: "https://kept.example/", PageID: unsortedPageID, Tags: []string{"x", "y"}},
		{Name: "Dup", URL: "https://dup.example/", PageID: 1, Tags: []string{"x", "y"}},
		{Name: "Dup again", URL: "https://dup.example", PageID: 2, Tags: []string{"x", "y"}},
		{Name: "B", URL: "https://b.example/", PageID: 1, Tags: []string{"x", "y"}},
	}, relatedFillers(6, "z")...)
	got := relatedTo("https://me.example/", all)
	if relatedNames(got) != "B,Dup" {
		t.Fatalf("want B and Dup once, got %s", relatedNames(got))
	}
}

func TestRelatedSameAddressOnTwoPagesIsOneBookmark(t *testing.T) {
	// The copy on page 10 carries the tags; the one on page 2 carries none. Which
	// page file is read first must not decide the answer.
	all := append([]Bookmark{
		{Name: "Me", URL: "https://me.example/", PageID: 2},
		{Name: "Me", URL: "https://me.example/", PageID: 10, Tags: []string{"x", "y"}},
		{Name: "Mate", URL: "https://mate.example/", PageID: 1, Tags: []string{"x", "y"}},
	}, relatedFillers(6, "z")...)
	if got := relatedTo("https://me.example/", all); relatedNames(got) != "Mate" {
		t.Fatalf("the tags of both copies count: %s", relatedNames(got))
	}
}

func TestRelatedACommonTagAloneIsNoRelation(t *testing.T) {
	// "homelab" is on every bookmark but one.
	all := []Bookmark{{Name: "Me", URL: "https://me.example/", PageID: 1, Tags: []string{"homelab"}}}
	all = append(all, relatedFillers(8, "homelab")...)
	all = append(all, Bookmark{Name: "Other", URL: "https://other.example/", PageID: 1, Tags: []string{"misc"}})
	if got := relatedTo("https://me.example/", all); len(got) != 0 {
		t.Fatalf("a tag nearly everything carries relates nothing: %s", relatedNames(got))
	}
}

func TestRelatedSiteIncludesThePort(t *testing.T) {
	all := []Bookmark{
		{Name: "Sonarr", URL: "http://192.168.1.10:8989/", PageID: 1},
		{Name: "Radarr", URL: "http://192.168.1.10:7878/", PageID: 1},
		{Name: "Sonarr docs", URL: "http://192.168.1.10:8989/docs", PageID: 1},
	}
	if got := relatedTo("http://192.168.1.10:8989/", all); relatedNames(got) != "Sonarr docs" {
		t.Fatalf("another port is another service: %s", relatedNames(got))
	}
}

func TestCoOpenOneOpenPairsOnce(t *testing.T) {
	min := int64(60 * 1000)
	// A opened twice around a single open of B.
	if got := coOpenPairs([]int64{1000 * min, 1003 * min}, []int64{1001 * min}); got != 1 {
		t.Fatalf("one open of B is one pair, got %d", got)
	}
}

func TestRelatedCapsTheAnswer(t *testing.T) {
	all := []Bookmark{{Name: "Me", URL: "https://me.example/", PageID: 1, Tags: []string{"x", "y"}}}
	for _, n := range []string{"B", "C", "D", "E", "F"} {
		all = append(all, Bookmark{Name: n, URL: "https://" + strings.ToLower(n) + ".example/", PageID: 1, Tags: []string{"x", "y"}})
	}
	all = append(all, relatedFillers(6, "z")...)
	if got := relatedTo("https://me.example/", all); len(got) != relatedMax {
		t.Fatalf("at most %d, got %s", relatedMax, relatedNames(got))
	}
}
