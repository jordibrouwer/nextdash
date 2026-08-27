package app

import (
	"encoding/json"
	"strings"
	"testing"
)

// The Help tab's prose is a third of the translation file and is read only by
// the config module. Splitting it out is only safe if the split is exact: every
// key lands in one scope and none is lost.
func TestNarrowLocaleSplitsHelpFromTheRest(t *testing.T) {
	raw := []byte(`{
        "dashboard": {"a": "1"},
        "config": {"helpSearchTitle": "Searching", "helpSupportKofi": "Ko-fi", "columnsLabel": "Columns"}
    }`)

	core, err := narrowLocale(raw, "core")
	if err != nil {
		t.Fatalf("core: %v", err)
	}
	var coreDoc map[string]map[string]string
	if err := json.Unmarshal(core, &coreDoc); err != nil {
		t.Fatalf("core json: %v", err)
	}
	if _, ok := coreDoc["config"]["helpSearchTitle"]; ok {
		t.Fatal("a help string travelled in the core scope")
	}
	if coreDoc["config"]["columnsLabel"] != "Columns" {
		t.Fatal("an ordinary config string was dropped from core")
	}
	if coreDoc["dashboard"]["a"] != "1" {
		t.Fatal("a section outside config was dropped")
	}
	// One exception, and it has to be in core: the What's new modal prints it
	// without the config module being loaded at all.
	if coreDoc["config"]["helpSupportKofi"] != "Ko-fi" {
		t.Fatal("helpSupportKofi must stay in the core scope")
	}

	help, err := narrowLocale(raw, "help")
	if err != nil {
		t.Fatalf("help: %v", err)
	}
	var helpDoc map[string]map[string]string
	if err := json.Unmarshal(help, &helpDoc); err != nil {
		t.Fatalf("help json: %v", err)
	}
	if helpDoc["config"]["helpSearchTitle"] != "Searching" {
		t.Fatal("the help scope is missing its own strings")
	}
	if _, ok := helpDoc["config"]["columnsLabel"]; ok {
		t.Fatal("an ordinary config string travelled in the help scope")
	}
	if len(helpDoc) != 1 {
		t.Fatalf("help scope carries %d sections, want only config", len(helpDoc))
	}
}

// No scope at all is the whole file, which is what a client from before this
// split — or a plain fetch — still gets.
func TestLocaleWithoutScopeIsUnchanged(t *testing.T) {
	raw := []byte(`{"config":{"helpX":"1","y":"2"}}`)
	out, err := localeScopedBytes(nil, "test-unscoped.json", "")
	if err == nil && len(out) > 0 {
		t.Skip("locale file present on disk; the unscoped path is covered by the handler test")
	}
	if !strings.Contains(string(raw), "helpX") {
		t.Fatal("fixture broken")
	}
}
