package app

import (
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
