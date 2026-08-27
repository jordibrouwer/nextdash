package app

import (
	"os"
	"path/filepath"
	"testing"
)

// A bookmark's Category holds a category id. Deleting one category from a page
// that still has others is allowed and deliberately leaves its bookmarks
// pointing at the id that is now gone (SaveCategoriesByPage only remaps ids it
// was given an OriginalID for). Nothing heals that afterwards: the
// rebuild-from-refs recovery in GetCategoriesByPage only fires when the
// category list is *entirely* empty. The dashboard then renders those
// bookmarks in the same place as genuinely uncategorized ones, so the loss is
// invisible — the health report is where it becomes visible.
func TestHealthReportFlagsOrphanedCategory(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1",
		"categories":[{"id":"work","name":"Work"}],
		"bookmarks":[
			{"name":"Orphaned","url":"https://orphan.example","category":"ghost"},
			{"name":"Categorised","url":"https://ok.example","category":"work"},
			{"name":"Uncategorised","url":"https://none.example","category":""}
		]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	report := h.buildBookmarkHealthReport()

	orphan := findIssue(t, report, "Orphaned")
	if !hasReason(orphan, "no longer exists") {
		t.Errorf("expected an orphaned-category reason, got %#v", orphan.Reasons)
	}
	if !hasFlag(orphan, "orphaned-category") {
		t.Errorf("expected the orphaned-category flag, got %#v", orphan.Flags)
	}
	// The reason names the id the bookmark still points at; without it the row
	// says something is wrong but not what to look for.
	if !hasReason(orphan, "ghost") {
		t.Errorf("expected the reason to name the missing category, got %#v", orphan.Reasons)
	}
	if orphan.Score >= 100 {
		t.Errorf("expected a score penalty, got %d", orphan.Score)
	}

	// The control: without these two, the test would pass just as well against
	// a check that flags every bookmark.
	if ok := findIssue(t, report, "Categorised"); hasFlag(ok, "orphaned-category") {
		t.Errorf("a bookmark in an existing category must not be flagged: %#v", ok.Flags)
	}
	// Empty is "uncategorized", a legitimate state, not a dangling reference.
	if none := findIssue(t, report, "Uncategorised"); hasFlag(none, "orphaned-category") {
		t.Errorf("an uncategorized bookmark must not be flagged: %#v", none.Flags)
	}

	if report.Summary.OrphanedCategoryCount != 1 {
		t.Errorf("OrphanedCategoryCount = %d, want 1", report.Summary.OrphanedCategoryCount)
	}
}

// The recovery path that made orphans look impossible: with no categories at
// all, GetCategoriesByPage rebuilds the list from what the bookmarks reference,
// so every id resolves and nothing is orphaned. Pinning this keeps the report
// from crying wolf over a legacy file that the store already heals.
func TestHealthReportDoesNotFlagRebuiltCategories(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1",
		"bookmarks":[
			{"name":"Recovered","url":"https://recovered.example","category":"work"}
		]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	report := h.buildBookmarkHealthReport()

	if issue := findIssue(t, report, "Recovered"); hasFlag(issue, "orphaned-category") {
		t.Errorf("a category rebuilt from bookmark refs must not read as orphaned: %#v", issue.Flags)
	}
	if report.Summary.OrphanedCategoryCount != 0 {
		t.Errorf("OrphanedCategoryCount = %d, want 0", report.Summary.OrphanedCategoryCount)
	}
}

// Categories are per page, so the same id existing on another page says nothing
// about this one — matching how the dashboard keys categories by pageId::id.
func TestHealthReportOrphanIsPerPage(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	page1 := `{"id":1,"name":"Page 1",
		"categories":[{"id":"work","name":"Work"}],
		"bookmarks":[{"name":"OnPageOne","url":"https://one.example","category":"work"}]}`
	page2 := `{"id":2,"name":"Page 2",
		"categories":[{"id":"personal","name":"Personal"}],
		"bookmarks":[{"name":"OnPageTwo","url":"https://two.example","category":"work"}]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(page1), 0o644); err != nil {
		t.Fatalf("write page 1: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-2.json"), []byte(page2), 0o644); err != nil {
		t.Fatalf("write page 2: %v", err)
	}

	report := h.buildBookmarkHealthReport()

	if one := findIssue(t, report, "OnPageOne"); hasFlag(one, "orphaned-category") {
		t.Errorf("page 1's own category must resolve: %#v", one.Flags)
	}
	if two := findIssue(t, report, "OnPageTwo"); !hasFlag(two, "orphaned-category") {
		t.Errorf("page 2 has no \"work\" category, so its bookmark is orphaned: %#v", two.Flags)
	}
	if report.Summary.OrphanedCategoryCount != 1 {
		t.Errorf("OrphanedCategoryCount = %d, want 1", report.Summary.OrphanedCategoryCount)
	}
}
