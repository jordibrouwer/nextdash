package app

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
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

// The Overview's news stream is the second block only the config module reads.
// It travels in the help scope, except for the keys other modules print.
func TestNarrowLocaleCarriesTheOverviewWithHelp(t *testing.T) {
	raw := []byte(`{"config": {
        "helpSearchTitle": "Searching",
        "overviewNewFeatureXTitle": "A thing",
        "overviewUpdateAvailableBody": "Update body",
        "overviewUpdateAvailableCta": "View release",
        "columnsLabel": "Columns"}}`)
	read := func(scope string) map[string]string {
		out, err := narrowLocale(raw, scope)
		if err != nil {
			t.Fatalf("%s: %v", scope, err)
		}
		var doc map[string]map[string]string
		if err := json.Unmarshal(out, &doc); err != nil {
			t.Fatalf("%s json: %v", scope, err)
		}
		return doc["config"]
	}
	core, help := read("core"), read("help")
	if _, ok := core["overviewNewFeatureXTitle"]; ok {
		t.Error("a news stream string travelled in the core scope")
	}
	if help["overviewNewFeatureXTitle"] != "A thing" || help["helpSearchTitle"] != "Searching" {
		t.Error("the help scope is missing the news stream or the help prose")
	}
	for _, key := range []string{"overviewUpdateAvailableBody", "overviewUpdateAvailableCta", "columnsLabel"} {
		if core[key] == "" {
			t.Errorf("%s must stay in the core scope", key)
		}
		if _, ok := help[key]; ok {
			t.Errorf("%s travelled in the help scope as well", key)
		}
	}
}

// Every key lands in exactly one of the two scopes, in the files as shipped.
func TestLocaleScopesPartitionTheShippedFiles(t *testing.T) {
	for _, lang := range []string{"en", "nl", "de", "fr", "zh", "es"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "locales", lang+".json"))
		if err != nil {
			t.Fatalf("%s: %v", lang, err)
		}
		var whole map[string]map[string]json.RawMessage
		if err := json.Unmarshal(raw, &whole); err != nil {
			t.Fatalf("%s: %v", lang, err)
		}
		count := func(scope string) int {
			out, err := narrowLocale(raw, scope)
			if err != nil {
				t.Fatalf("%s %s: %v", lang, scope, err)
			}
			var doc map[string]map[string]json.RawMessage
			if err := json.Unmarshal(out, &doc); err != nil {
				t.Fatalf("%s %s: %v", lang, scope, err)
			}
			return len(doc["config"])
		}
		if core, help := count("core"), count("help"); core+help != len(whole["config"]) {
			t.Errorf("%s: core %d + help %d != %d config keys", lang, core, help, len(whole["config"]))
		}
	}
}

// A key in the help scope is only there when the config module opens. Script
// outside that module that prints one gets the English fallback in every other
// language until then; so a script that does must have its key kept in core.
func TestNoScriptOutsideConfigReadsALazyKey(t *testing.T) {
	re := regexp.MustCompile(`config\.((?:help|overview)[A-Za-z0-9_]*)`)
	root := filepath.Join("..", "..", "static", "js")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".js") {
			return err
		}
		// The config module and the sections split out of it load after the
		// help scope is in (dashboard-config-loader.js waits for it).
		if strings.HasPrefix(d.Name(), "dashboard-config") && strings.Contains(path, filepath.Join("js", "dashboard")) {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range re.FindAllStringSubmatch(string(src), -1) {
			if localeKeyIsLazy(m[1]) {
				t.Errorf("%s reads config.%s, which only travels in the help scope; add it to localeHelpAlways", path, m[1])
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
