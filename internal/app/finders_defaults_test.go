package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const braveFinderURL = "https://search.brave.com/search?q=%s&source=nextdash"

func findersOnDisk(t *testing.T) []Finder {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(ResolveDataDir(), "finders.json"))
	if err != nil {
		t.Fatalf("reading finders.json: %v", err)
	}
	var finders []Finder
	if err := json.Unmarshal(raw, &finders); err != nil {
		t.Fatalf("parsing finders.json: %v", err)
	}
	return finders
}

func hasBrave(finders []Finder) bool {
	for _, f := range finders {
		if strings.Contains(strings.ToLower(f.SearchUrl), "search.brave.com") {
			return true
		}
	}
	return false
}

// A fresh install ships Brave as a finder, on "b".
func TestFreshInstallSeedsBraveFinder(t *testing.T) {
	tmp := t.TempDir()
	// t.Chdir alone does not isolate this: ResolveDataDir prefers
	// NEXTDASH_DATA_DIR, which TestMain sets for the whole suite.
	t.Setenv("NEXTDASH_DATA_DIR", tmp)
	t.Chdir(tmp)

	store := NewStore()
	finders := store.GetFinders()

	var brave *Finder
	for i := range finders {
		if strings.Contains(finders[i].SearchUrl, "search.brave.com") {
			brave = &finders[i]
			break
		}
	}
	if brave == nil {
		t.Fatalf("fresh install has no Brave finder: %+v", finders)
	}
	if brave.Shortcut != "b" {
		t.Fatalf("Brave shortcut = %q, want \"b\"", brave.Shortcut)
	}
	if brave.SearchUrl != braveFinderURL {
		t.Fatalf("Brave searchUrl = %q, want %q", brave.SearchUrl, braveFinderURL)
	}
}

// An install that predates this gains Brave once, without losing what it had.
func TestExistingInstallGainsBraveFinderOnce(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", tmp)
	t.Chdir(tmp)
	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}

	existing := []Finder{{Name: "DuckDuckGo", SearchUrl: "https://duckduckgo.com/?q=%s", Shortcut: "du"}}
	data, _ := json.MarshalIndent(existing, "", "  ")
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "finders.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	finders := store.GetFinders()

	if !hasBrave(finders) {
		t.Fatalf("existing install did not gain Brave: %+v", finders)
	}
	// What was already there survives.
	if len(finders) != 2 {
		t.Fatalf("expected the original finder plus Brave, got %d: %+v", len(finders), finders)
	}

	// Second boot: the reader may have deleted it again, and that must stick.
	kept := []Finder{existing[0]}
	data2, _ := json.MarshalIndent(kept, "", "  ")
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "finders.json"), data2, 0644); err != nil {
		t.Fatal(err)
	}

	store2 := NewStore()
	finders2 := store2.GetFinders()
	if hasBrave(finders2) {
		t.Fatalf("Brave came back after the reader removed it: %+v", finders2)
	}
}

// Someone who already added Brave themselves keeps their own entry: no
// duplicate, and their shortcut and name are left alone.
func TestExistingBraveFinderIsNotDuplicated(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", tmp)
	t.Chdir(tmp)
	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}

	mine := []Finder{
		{Name: "Brave (mine)", SearchUrl: "https://search.brave.com/search?q=%s", Shortcut: "br"},
	}
	data, _ := json.MarshalIndent(mine, "", "  ")
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "finders.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	finders := store.GetFinders()

	if len(finders) != 1 {
		t.Fatalf("expected the reader's own Brave and nothing added, got %d: %+v", len(finders), finders)
	}
	if finders[0].Shortcut != "br" || finders[0].Name != "Brave (mine)" {
		t.Fatalf("the reader's own Brave entry was changed: %+v", finders[0])
	}
}
