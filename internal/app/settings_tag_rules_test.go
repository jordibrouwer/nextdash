package app

import (
	"strconv"
	"testing"
)

func TestSanitizeTagRulesKeepsWhatCanMatch(t *testing.T) {
	clean := sanitizeTagRules([]TagRule{
		{Pattern: "  GitHub.com  ", Tag: "  Code "},
		{Pattern: "reddit.com/r/selfhosted", Tag: "homelab"},
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
	if clean[1].Pattern != "reddit.com/r/selfhosted" {
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
