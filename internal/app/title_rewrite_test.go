package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTitleRewriteApply(t *testing.T) {
	title := "NCSC-2026-0506 [1.00] [H/H] Kwetsbaarheden verholpen in NGINX door F5 Networks"
	rewrite, err := compileTitleRewrite(`^NCSC-\d+-\d+ \[[^\]]*\] \[[^\]]*\] .*? in `, "")
	if err != nil {
		t.Fatal(err)
	}
	if got := rewrite.apply(title); got != "NGINX door F5 Networks" {
		t.Fatalf("apply = %q", got)
	}
}

func TestTitleRewriteReplacementUsesGroups(t *testing.T) {
	rewrite, err := compileTitleRewrite(`^(\w+): (.*)$`, "$2 ($1)")
	if err != nil {
		t.Fatal(err)
	}
	if got := rewrite.apply("News: Something happened"); got != "Something happened (News)" {
		t.Fatalf("apply = %q", got)
	}
}

func TestTitleRewriteEmptyPatternIsNoRewrite(t *testing.T) {
	rewrite, err := compileTitleRewrite("   ", "x")
	if err != nil || rewrite != nil {
		t.Fatalf("rewrite = %v, err = %v", rewrite, err)
	}
	if got := rewrite.apply("Unchanged"); got != "Unchanged" {
		t.Fatalf("nil rewrite changed the title: %q", got)
	}
}

// A pattern that eats the whole title keeps the original.
func TestTitleRewriteNeverEmptiesATitle(t *testing.T) {
	rewrite, err := compileTitleRewrite(`.*`, "")
	if err != nil {
		t.Fatal(err)
	}
	if got := rewrite.apply("Whole title"); got != "Whole title" {
		t.Fatalf("apply = %q", got)
	}
}

func TestTitleRewriteRefusesBadPatterns(t *testing.T) {
	if _, err := compileTitleRewrite(`^NCSC-\d+ \[[^\]`, ""); err == nil {
		t.Fatal("an unbalanced pattern compiled")
	}
	long := make([]byte, titleRewriteMaxLen+1)
	for i := range long {
		long[i] = 'a'
	}
	if _, err := compileTitleRewrite(string(long), ""); err == nil {
		t.Fatal("a pattern past the cap compiled")
	}
}

func TestSuggestTitleRewritePrefix(t *testing.T) {
	titles := []string{
		"NCSC-2026-0506 [1.00] [H/H] Kwetsbaarheden verholpen in NGINX door F5 Networks",
		"NCSC-2026-0507 [1.01] [M/H] Kwetsbaarheden verholpen in Firefox",
		"NCSC-2026-0508 [2.00] [H/M] Kwetsbaarheid verholpen in Chrome",
		"NCSC-2026-0509 [1.00] [L/L] Updates voor Windows",
	}
	got := suggestTitleRewrite(titles)
	want := `^NCSC-\d+-\d+ \[[^\]]*\] \[[^\]]*\] `
	if got != want {
		t.Fatalf("suggest = %q, want %q", got, want)
	}
	rewrite, err := compileTitleRewrite(got, "")
	if err != nil {
		t.Fatal(err)
	}
	if out := rewrite.apply(titles[3]); out != "Updates voor Windows" {
		t.Fatalf("apply = %q", out)
	}
}

func TestSuggestTitleRewriteSuffix(t *testing.T) {
	titles := []string{
		"One story | Example Times",
		"Another story | Example Times",
		"A third story | Example Times",
		"A fourth story | Example Times",
	}
	if got, want := suggestTitleRewrite(titles), ` \| Example Times$`; got != want {
		t.Fatalf("suggest = %q, want %q", got, want)
	}
}

func TestSuggestTitleRewriteStaysQuiet(t *testing.T) {
	cases := map[string][]string{
		"too few": {"NCSC-1 [1.0] a", "NCSC-2 [1.0] b"},
		"plain words only": {
			"Breaking news today", "Breaking news tonight",
			"Breaking news again", "Breaking news once more",
		},
		"nothing shared": {
			"Alpha story", "Beta story", "Gamma tale", "Delta report",
		},
	}
	for name, titles := range cases {
		if got := suggestTitleRewrite(titles); got != "" {
			t.Errorf("%s: suggested %q", name, got)
		}
	}
}

// The last word of a title is never given up, however many titles share it.
func TestSuggestTitleRewriteLeavesSomething(t *testing.T) {
	titles := []string{
		"NCSC-2026-0506 [1.00]", "NCSC-2026-0507 [1.00]",
		"NCSC-2026-0508 [1.00]", "NCSC-2026-0509 [1.00]",
	}
	got := suggestTitleRewrite(titles)
	rewrite, err := compileTitleRewrite(got, "")
	if err != nil || rewrite == nil {
		t.Fatalf("suggest = %q, err = %v", got, err)
	}
	for _, title := range titles {
		if out := rewrite.apply(title); out != "[1.00]" {
			t.Fatalf("apply(%q) = %q", title, out)
		}
	}
}

func TestTitleRewritePreviewUsesTheServersCompiler(t *testing.T) {
	h := &Handlers{}
	call := func(body string) map[string]any {
		t.Helper()
		rec := httptest.NewRecorder()
		h.TitleRewritePreview(rec, httptest.NewRequest(http.MethodPost, "/api/title-rewrite", strings.NewReader(body)))
		var out map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("%v: %s", err, rec.Body.String())
		}
		return out
	}
	ok := call(`{"find":"^A: ","titles":["A: one","B: two"]}`)
	if results, _ := ok["results"].([]any); len(results) != 2 || results[0] != "one" || results[1] != "B: two" {
		t.Fatalf("results = %v", ok["results"])
	}
	// A lookahead is valid in a browser and refused here, which is the point.
	bad := call(`{"find":"^(?=A)","titles":["A: one"]}`)
	if bad["error"] != "bad-pattern" {
		t.Fatalf("error = %v, want bad-pattern", bad["error"])
	}
	if results, _ := bad["results"].([]any); len(results) != 1 || results[0] != "A: one" {
		t.Fatalf("a bad pattern changed the titles: %v", bad["results"])
	}
	sug := call(`{"suggest":true,"titles":["N-1 [1] a b","N-2 [2] c d","N-3 [3] e f","N-4 [4] g h"]}`)
	if sug["suggestion"] == nil || sug["suggestion"] == "" {
		t.Fatalf("no suggestion: %v", sug)
	}
}
