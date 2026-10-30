package app

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

func docsRank(hits []aiDocHit, ids ...string) int {
	for i, h := range hits {
		for _, id := range ids {
			if h.ID == id {
				return i + 1
			}
		}
	}
	return 0
}

func TestDocsIndexBuildsFromTheEmbeddedFiles(t *testing.T) {
	idx := aiDocsGet()
	if len(idx.docs) < 100 {
		t.Fatalf("only %d sections", len(idx.docs))
	}
	seen := map[string]bool{}
	sources := map[string]int{}
	junk := regexp.MustCompile(`(?i)<a id=|<img |<p align|!\[|<details|</p>`)
	for _, d := range idx.docs {
		if d.ID == "" || d.Title == "" || d.Path == "" || strings.TrimSpace(d.Text) == "" {
			t.Fatalf("incomplete section %+v", d.ID)
		}
		if seen[d.ID] {
			t.Errorf("duplicate id %s", d.ID)
		}
		seen[d.ID] = true
		sources[d.Source]++
		if len(d.Text) > aiDocsPartMax {
			t.Errorf("%s is %d bytes", d.ID, len(d.Text))
		}
		if m := junk.FindString(d.Text); m != "" {
			t.Errorf("%s still carries %q", d.ID, m)
		}
	}
	if sources["MANUAL"] == 0 || sources["README"] == 0 {
		t.Errorf("sources %v", sources)
	}
	if d, ok := idx.Read("manual:2311-the-assistant"); !ok || d.Path != "MANUAL › 23. Security and self-hosting › 23.11 The assistant" {
		t.Errorf("the assistant section: %+v", d)
	}
}

func TestDocsSearchFindsTheRightSection(t *testing.T) {
	idx := aiDocsGet()
	cases := []struct {
		query string
		top   int
		want  []string
	}{
		{"what is the write token", 1, []string{"manual:232-the-write-token"}},
		{"how do I back up my data", 3, []string{"manual:191-backups-data", "manual:19-data-backups-and-import"}},
		{"docker control", 3, []string{"manual:14-containers", "manual:146-what-it-needs"}},
		{"what does the Unraid page do", 3, []string{"manual:156-unraid-widgets", "manual:sh-unraid"}},
		{"which shortcut opens the command palette", 3, []string{"manual:85-commands"}},
		{"the assistant", 2, []string{"manual:2311-the-assistant", "manual:2311-the-assistant#2"}},
		{"wat is de write token", 1, []string{"manual:232-the-write-token"}},
	}
	for _, c := range cases {
		hits := idx.Search(c.query, 8)
		if rank := docsRank(hits, c.want...); rank == 0 || rank > c.top {
			var got []string
			for _, h := range hits {
				got = append(got, h.ID)
			}
			t.Errorf("%q: want one of %v in the top %d, got %v", c.query, c.want, c.top, got)
		}
	}
}

func TestDocsSearchResultsCarrySnippets(t *testing.T) {
	hits := aiDocsGet().Search("write token", 20)
	if len(hits) != aiDocsMaxLimit {
		t.Fatalf("the limit is not capped at %d: %d results", aiDocsMaxLimit, len(hits))
	}
	if n := len(aiDocsGet().Search("write token", 0)); n != aiDocsDefaultLimit {
		t.Errorf("default limit gave %d", n)
	}
	for _, h := range hits {
		if h.Snippet == "" || len([]rune(h.Snippet)) > aiDocsSnippetRunes+4 || h.Source == "" || h.Path == "" {
			t.Errorf("bad hit %+v", h)
		}
	}
	if !strings.Contains(strings.ToLower(hits[0].Snippet), "token") {
		t.Errorf("the snippet does not show the match: %q", hits[0].Snippet)
	}
}

func TestDocsSearchWithNoMatchIsEmptyNotAnError(t *testing.T) {
	if hits := aiDocsGet().Search("zzzqqq xylophone", 5); len(hits) != 0 {
		t.Fatalf("got %+v", hits)
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(aiRunDocsTool(aiCall("1", aiDocsSearchTool, `{"query":"zzzqqq xylophone"}`))), &out); err != nil {
		t.Fatal(err)
	}
	if _, bad := out["error"]; bad {
		t.Errorf("an empty search is an error: %v", out)
	}
	if results, ok := out["results"].([]any); !ok || len(results) != 0 || out["note"] == nil {
		t.Errorf("empty search gave %v", out)
	}
	if !strings.Contains(aiRunDocsTool(aiCall("1", aiDocsSearchTool, `{"query":"  "}`)), "error") {
		t.Error("a blank query is not refused")
	}
}

func TestReadDocPagesAndErrors(t *testing.T) {
	var first map[string]any
	if err := json.Unmarshal([]byte(aiRunDocsTool(aiCall("1", aiDocsReadTool, `{"id":"manual:2311-the-assistant"}`))), &first); err != nil {
		t.Fatal(err)
	}
	if first["part"] != float64(1) || first["parts"].(float64) < 2 || first["next"] != "manual:2311-the-assistant#2" {
		t.Fatalf("first part %v", first)
	}
	if text, _ := first["text"].(string); len(text) == 0 || len(text) > aiDocsPartMax {
		t.Errorf("text is %d bytes", len(text))
	}
	var second map[string]any
	if err := json.Unmarshal([]byte(aiRunDocsTool(aiCall("1", aiDocsReadTool, `{"id":"manual:2311-the-assistant#2"}`))), &second); err != nil {
		t.Fatal(err)
	}
	if second["part"] != float64(2) || second["previous"] != "manual:2311-the-assistant" {
		t.Errorf("second part %v", second)
	}
	// A cut on a paragraph boundary: no part ends mid-sentence of a paragraph.
	for _, d := range aiDocsGet().docs {
		if d.Parts > 1 && strings.HasSuffix(d.Text, "\n") {
			t.Errorf("%s ends on a newline", d.ID)
		}
	}
	bad := aiRunDocsTool(aiCall("1", aiDocsReadTool, `{"id":"manual:nope"}`))
	if !strings.Contains(bad, "No section has that id") || strings.Contains(bad, "manual:2") {
		t.Errorf("unknown id: %s", bad)
	}
}

func TestLongSectionsAreSplitOnParagraphs(t *testing.T) {
	para := strings.Repeat("word ", 300)
	var b strings.Builder
	for i := 0; i < 12; i++ {
		b.WriteString(para + "\n\n")
	}
	parts := aiDocsParts(strings.TrimSpace(b.String()), aiDocsPartMax)
	if len(parts) < 2 {
		t.Fatalf("%d parts", len(parts))
	}
	for _, p := range parts {
		if len(p) > aiDocsPartMax || strings.HasPrefix(p, "\n") || strings.Count(p, para) < 1 {
			t.Errorf("part of %d bytes", len(p))
		}
		if strings.Count(p, "word")%300 != 0 {
			t.Errorf("a paragraph was cut inside: %d words", strings.Count(p, "word"))
		}
	}
	// One paragraph longer than the cap is still cut.
	for _, p := range aiDocsParts(strings.Repeat("é", 10000), aiDocsPartMax) {
		if len(p) > aiDocsPartMax || !strings.HasPrefix(p, "é") {
			t.Errorf("long paragraph part %d bytes", len(p))
		}
	}
}

func TestDocsSplitIgnoresHeadingsInCodeAndStripsMarkup(t *testing.T) {
	src := "# Doc\n\n## One\n\n<a id=\"x\"></a>\n<img src=\"https://t.example/p.png\">\n```sh\n# not a heading\n```\n\n[a link](https://x.example) and ![pic](a.png)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n"
	idx := buildAIDocsIndex(src, "")
	d, ok := idx.Read("manual:one")
	if !ok {
		t.Fatalf("ids: %v", idx.byID)
	}
	if strings.Contains(d.Text, "t.example") || strings.Contains(d.Text, "pic") || strings.Contains(d.Text, "x.example") || strings.Contains(d.Text, "---") {
		t.Errorf("markup left in %q", d.Text)
	}
	if !strings.Contains(d.Text, "# not a heading") || !strings.Contains(d.Text, "a link and") || !strings.Contains(d.Text, "1 | 2") {
		t.Errorf("content lost in %q", d.Text)
	}
}

// The Go list of Config sections is the one in the dashboard's JavaScript.
func TestConfigSectionsMatchTheDashboard(t *testing.T) {
	src, err := os.ReadFile(repoFile(t, "static", "js", "dashboard", "dashboard-config.js"))
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?s)static SECTIONS = \[(.*?)\];`).FindSubmatch(src)
	if m == nil {
		t.Fatal("DashboardConfig.SECTIONS not found")
	}
	var js []string
	for _, q := range regexp.MustCompile(`'([a-z0-9-]+)'`).FindAllSubmatch(m[1], -1) {
		js = append(js, string(q[1]))
	}
	if strings.Join(js, ",") != strings.Join(aiConfigSections, ",") {
		t.Errorf("aiConfigSections drifted from DashboardConfig.SECTIONS:\n go %v\n js %v", aiConfigSections, js)
	}
}
