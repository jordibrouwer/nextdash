package main

import (
	"testing"
)

func TestMergePrefetchBookmarkIconsPreservesOtherFields(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	bookmarks := store.GetBookmarksByPage(1)
	if len(bookmarks) == 0 {
		t.Fatal("expected default bookmarks")
	}

	bookmarks[0].Name = "Renamed while prefetch ran"
	_ = store.SaveBookmarksByPage(1, bookmarks)

	urlKey := canonicalBookmarkURLKey(bookmarks[0].URL)
	applied := store.MergePrefetchBookmarkIcons(1, []PrefetchIconUpdate{{
		Index:  0,
		URLKey: urlKey,
		Icon:   "icon-prefetch.png",
	}})
	if applied != 1 {
		t.Fatalf("applied = %d, want 1", applied)
	}

	after := store.GetBookmarksByPage(1)
	if after[0].Icon != "icon-prefetch.png" {
		t.Fatalf("icon = %q", after[0].Icon)
	}
	if after[0].Name != "Renamed while prefetch ran" {
		t.Fatalf("name = %q, want preserved rename", after[0].Name)
	}
}

func TestMergePrefetchBookmarkIconsSkipsWhenURLOrIconChanged(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	bookmarks := store.GetBookmarksByPage(1)
	if len(bookmarks) < 2 {
		t.Fatal("expected at least 2 default bookmarks")
	}

	originalURL := bookmarks[1].URL
	urlKey := canonicalBookmarkURLKey(originalURL)

	bookmarks[1].URL = "https://example.com/changed"
	_ = store.SaveBookmarksByPage(1, bookmarks)

	if applied := store.MergePrefetchBookmarkIcons(1, []PrefetchIconUpdate{{
		Index:  1,
		URLKey: urlKey,
		Icon:   "stale.png",
	}}); applied != 0 {
		t.Fatalf("expected skip on URL change, applied=%d", applied)
	}

	bookmarks = store.GetBookmarksByPage(1)
	bookmarks[0].Icon = "existing.ico"
	_ = store.SaveBookmarksByPage(1, bookmarks)

	if applied := store.MergePrefetchBookmarkIcons(1, []PrefetchIconUpdate{{
		Index:  0,
		URLKey: canonicalBookmarkURLKey(bookmarks[0].URL),
		Icon:   "new.png",
	}}); applied != 0 {
		t.Fatalf("expected skip when icon already set, applied=%d", applied)
	}

	after := store.GetBookmarksByPage(1)
	if after[0].Icon != "existing.ico" {
		t.Fatalf("icon = %q, want existing.ico", after[0].Icon)
	}
}

func TestResetAllDataConsumesPrefetchFlagOnce(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	if err := store.ResetAllData(); err != nil {
		t.Fatal(err)
	}
	if !store.TakeDefaultBookmarkIconPrefetch() {
		t.Fatal("expected prefetch flag after reset")
	}
	if store.TakeDefaultBookmarkIconPrefetch() {
		t.Fatal("prefetch flag should be consumed once")
	}
}
