package main

import "testing"

func TestNormalizeFontSize(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"m":       "m",
		"medium":  "m",
		"small":   "s",
		"large":   "l",
		"xl":      "xl",
		"unknown": "m",
	}
	for in, want := range cases {
		if got := normalizeFontSize(in); got != want {
			t.Fatalf("%q => %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeFontPreset(t *testing.T) {
	t.Parallel()

	if got := normalizeFontPreset("inter"); got != "inter" {
		t.Fatalf("valid preset = %q", got)
	}
	if got := normalizeFontPreset("unknown-font"); got != "source-code-pro" {
		t.Fatalf("invalid preset = %q, want source-code-pro", got)
	}
}

func TestParseBookmarkPageIDFromFilename(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		file   string
		wantID int
		wantOK bool
	}{
		{"valid", "bookmarks-3.json", 3, true},
		{"main page", "bookmarks-1.json", 1, true},
		{"invalid prefix", "pages-1.json", 0, false},
		{"invalid id", "bookmarks-0.json", 0, false},
		{"non numeric", "bookmarks-x.json", 0, false},
	}
	for _, tc := range cases {
		id, ok := parseBookmarkPageIDFromFilename(tc.file)
		if id != tc.wantID || ok != tc.wantOK {
			t.Fatalf("%s: got (%d, %v), want (%d, %v)", tc.name, id, ok, tc.wantID, tc.wantOK)
		}
	}
}

func TestDefaultPageName(t *testing.T) {
	t.Parallel()

	if got := defaultPageName(1); got != "main" {
		t.Fatalf("page 1 = %q", got)
	}
	if got := defaultPageName(4); got != "Page 4" {
		t.Fatalf("page 4 = %q", got)
	}
}

func TestNormalizePageMeta(t *testing.T) {
	t.Parallel()

	page := normalizePageMeta(Page{ID: 99, Name: "  "}, 2)
	if page.ID != 2 {
		t.Fatalf("ID = %d, want 2", page.ID)
	}
	if page.Name != "Page 2" {
		t.Fatalf("Name = %q, want Page 2", page.Name)
	}

	named := normalizePageMeta(Page{Name: "Work"}, 5)
	if named.Name != "Work" {
		t.Fatalf("Name = %q, want Work", named.Name)
	}
}

func TestFinalizePagesListDedupesAndEnsuresMain(t *testing.T) {
	t.Parallel()

	pages := []Page{{ID: 2, Name: "B"}, {ID: 1, Name: "A"}, {ID: 2, Name: "Dup"}}
	got := finalizePagesList(pages, map[int]Page{})
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].ID != 2 || got[1].ID != 1 {
		t.Fatalf("order = %v", got)
	}

	withoutMain := finalizePagesList([]Page{{ID: 3, Name: "C"}}, map[int]Page{
		1: {ID: 1, Name: "Home"},
	})
	if len(withoutMain) != 2 || withoutMain[0].ID != 1 || withoutMain[1].ID != 3 {
		t.Fatalf("main injection = %v", withoutMain)
	}
}

func TestExtractPageIDFromCategoriesFilename(t *testing.T) {
	t.Parallel()

	id, ok := extractPageIDFromCategoriesFilename("categories-4.json")
	if !ok || id != 4 {
		t.Fatalf("valid file: (%d, %v)", id, ok)
	}
	_, ok = extractPageIDFromCategoriesFilename("bookmarks-4.json")
	if ok {
		t.Fatal("bookmarks filename should not match")
	}
}
