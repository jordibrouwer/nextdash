package app

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Every field the Behavior schema renders must be one the server stores.
//
// showSyncToasts was not: the client invented the key, defaulted it, and drew a
// toggle for it — so it flipped, "saved", and came back false on the next load,
// because json.Unmarshal drops what the struct does not name. Nothing failed;
// it simply did not work. This reads the schema out of the JS and checks each
// field against the Settings tags, which is the only place the two meet.
func TestBehaviorSchemaFieldsExistInSettings(t *testing.T) {
	js, err := os.ReadFile(repoFile(t, "static", "js", "dashboard", "dashboard-config.js"))
	if err != nil {
		t.Fatalf("read config js: %v", err)
	}
	src := string(js)

	start := strings.Index(src, "behaviorSchema({ forIndex = false } = {}) {")
	if start < 0 {
		t.Fatal("behaviorSchema not found — this test is reading the wrong thing")
	}
	end := strings.Index(src[start:], "\n    bindControlPanels")
	if end < 0 {
		t.Fatal("could not find the end of behaviorSchema")
	}
	schema := src[start : start+end]

	fields := map[string]bool{}
	for _, re := range []*regexp.Regexp{
		regexp.MustCompile(`field:\s*'([A-Za-z0-9_]+)'`),
		regexp.MustCompile(`bool\('([A-Za-z0-9_]+)'`),
		regexp.MustCompile(`chrome\('([A-Za-z0-9_]+)'`),
	} {
		for _, m := range re.FindAllStringSubmatch(schema, -1) {
			fields[m[1]] = true
		}
	}
	if len(fields) < 50 {
		t.Fatalf("found only %d schema fields; the extraction is broken rather than the schema", len(fields))
	}

	models, err := os.ReadFile("models.go")
	if err != nil {
		t.Fatalf("read models.go: %v", err)
	}
	tags := map[string]bool{}
	for _, m := range regexp.MustCompile(`json:"([A-Za-z0-9_]+)`).FindAllStringSubmatch(string(models), -1) {
		tags[m[1]] = true
	}

	// The one deliberate exception: it says whether the *other* settings follow
	// you between browsers, so it lives in that browser and nowhere else.
	allowed := map[string]bool{"deviceSpecificSettings": true}

	var stray []string
	for field := range fields {
		if !tags[field] && !allowed[field] {
			stray = append(stray, field)
		}
	}
	if len(stray) > 0 {
		t.Fatalf("Behavior renders controls for settings the server does not store: %v", stray)
	}
}
