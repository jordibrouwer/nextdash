package app

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestSanitizeTagRulesKeepsWhatCanMatch(t *testing.T) {
	clean := sanitizeTagRules([]TagRule{
		{Pattern: "  GitHub.com  ", Tag: "  Code "},
		{Pattern: "reddit.com/r", Tag: "homelab"},
		{Pattern: "", Tag: "orphan"},
		{Pattern: "example.com", Tag: ""},
		{Pattern: "https://example.com", Tag: "scheme"},
		{Pattern: "github.com", Tag: "code"},
	})

	if len(clean) != 2 {
		t.Fatalf("kept %d rules: %#v", len(clean), clean)
	}
	// Trimmed and lowercased, so a rule matches what normalizeTags stores.
	if clean[0].Pattern != "github.com" || clean[0].Tag != "code" {
		t.Errorf("first rule = %#v", clean[0])
	}
	if clean[1].Pattern != "reddit.com/r" {
		t.Errorf("second rule = %#v", clean[1])
	}
}

// A pattern deeper than host plus first path segment cannot ever match what
// patternsFor() emits, so it is refused rather than stored as a dead rule.
func TestSanitizeTagRulesRefusesPatternsTooDeepToMatch(t *testing.T) {
	clean := sanitizeTagRules([]TagRule{
		{Pattern: "reddit.com/r/selfhosted", Tag: "homelab"},
		{Pattern: "example.com/a/b/c", Tag: "deep"},
	})
	if len(clean) != 0 {
		t.Fatalf("kept %d rules, want none: %#v", len(clean), clean)
	}
}

// patternsFor() strips a leading "www." and never emits a trailing slash, so a
// rule written either way is narrowed to the shape it will be compared against.
func TestSanitizeTagRulesNormalizesToWhatTheEngineEmits(t *testing.T) {
	clean := sanitizeTagRules([]TagRule{
		{Pattern: "www.github.com", Tag: "code"},
		{Pattern: "github.com/", Tag: "code"},
		{Pattern: "WWW.Reddit.com/r/", Tag: "homelab"},
	})

	// The first two normalize to the same pattern and tag, so the second is a
	// duplicate rather than a second rule.
	if len(clean) != 2 {
		t.Fatalf("kept %d rules: %#v", len(clean), clean)
	}
	if clean[0].Pattern != "github.com" || clean[0].Tag != "code" {
		t.Errorf("first rule = %#v", clean[0])
	}
	if clean[1].Pattern != "reddit.com/r" || clean[1].Tag != "homelab" {
		t.Errorf("second rule = %#v", clean[1])
	}
}

func TestSanitizeTagRulesIsBounded(t *testing.T) {
	many := make([]TagRule, 0, 200)
	for i := 0; i < 200; i++ {
		many = append(many, TagRule{Pattern: "host" + strconv.Itoa(i) + ".example", Tag: "t"})
	}
	if got := len(sanitizeTagRules(many)); got != tagRulesMax {
		t.Errorf("kept %d rules, want exactly %d", got, tagRulesMax)
	}
}

func TestSanitizeDismissedTagSuggestionsNarrowsAndBounds(t *testing.T) {
	got := sanitizeDismissedTagSuggestions([]string{
		"GitHub.com|Dev",                  // lowercased
		"www.reddit.com/|forum",           // www. and the trailing slash stripped
		"github.com|dev",                  // the duplicate of the first, after narrowing
		"reddit.com/r/selfhosted|homelab", // deeper than patternsFor can emit
		"https://github.com|dev",          // carries a scheme
		"nohalf",                          // no tag half at all
		"github.com|",                     // empty tag
	})
	want := []string{"github.com|dev", "reddit.com|forum"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i, entry := range want {
		if got[i] != entry {
			t.Errorf("entry %d = %q, want %q", i, got[i], entry)
		}
	}
}

func TestSanitizeDismissedTagSuggestionsIsBounded(t *testing.T) {
	raw := make([]string, 0, dismissedTagSuggestionsMax+50)
	for i := 0; i < dismissedTagSuggestionsMax+50; i++ {
		raw = append(raw, "site"+strconv.Itoa(i)+".example|tag"+strconv.Itoa(i))
	}
	if got := len(sanitizeDismissedTagSuggestions(raw)); got != dismissedTagSuggestionsMax {
		t.Errorf("kept %d, want the cap of %d", got, dismissedTagSuggestionsMax)
	}
}

func TestReviewOfferSettingsDefaultOnForAnOlderFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	// A settings file written before these keys existed. Read as plain JSON
	// they would be false, which would take the health card away from an
	// install that has always had it -- silently, on the upgrade that added a
	// switch for it.
	older := `{"currentPage":1,"theme":"` + defaultThemeID + `","enableSessionTips":false}`
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(older), 0o644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	settings := store.GetSettings()
	if !settings.EnableTagSuggestionNotice {
		t.Error("enableTagSuggestionNotice read as off for a file that never mentioned it")
	}
	if !settings.EnableHealthReviewNotice {
		t.Error("enableHealthReviewNotice read as off for a file that never mentioned it")
	}
	// And a key the file does answer is still obeyed.
	if settings.EnableSessionTips {
		t.Error("enableSessionTips ignored the value the file gave it")
	}
}

func TestReviewOfferSettingsKeepAnExplicitOff(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	written := `{"currentPage":1,"enableTagSuggestionNotice":false,"enableHealthReviewNotice":false}`
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(written), 0o644); err != nil {
		t.Fatal(err)
	}

	settings := NewStore().GetSettings()
	if settings.EnableTagSuggestionNotice || settings.EnableHealthReviewNotice {
		t.Error("the backfill overwrote an answer the reader had given")
	}
}
