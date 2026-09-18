# Unsorted Bookmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Inbox a third triage exit — "Keep" promotes a link to a hidden, real dashboard page ("Unsorted") instead of only marking it read, and that page is browsable through a widget, a full masonry view, and the existing Move to… picker, without inventing a parallel storage mechanism.

**Architecture:** Unsorted is a normal `Page` (real `PageID`, a new `Hidden` flag) holding normal `Bookmark` records, so every existing subsystem — search, health, favicon caching, Move to…, the bookmark-row component — works on it unchanged. Three new surfaces sit on top: a widget, a full view that reuses the tag-filter-view's packed-columns rendering, and one new read endpoint (`GET /api/unsorted`) that resolves/creates the page and returns its bookmarks.

**Tech Stack:** Go (net/http, gorilla/mux, stdlib `testing`) for the backend; vanilla JS (no framework, no build step) for the dashboard frontend; Playwright for browser-level tests.

**Spec:** [docs/superpowers/specs/2026-09-18-unsorted-bookmarks-design.md](../specs/2026-09-18-unsorted-bookmarks-design.md)

## Global Constraints

- The Unsorted page's ID is the fixed constant `999999` (`unsortedPageID`), never computed from existing pages — the frontend's "create a page" flow picks `max(visible ids) + 1` from the *filtered* `/api/pages` list, and a dynamically-assigned low ID would eventually collide with a real page.
- `store.GetPages()` / `getPages()` (Go) stay unfiltered — Health, search and every internal caller must still see the Unsorted page and its bookmarks. Filtering happens only in the `GetPages` **HTTP handler**.
- No new bookmark-storage mechanism. Every "Unsorted bookmark" is a normal `Bookmark` in `bookmarks-999999.json`, created through the existing `/api/bookmarks/add` endpoint.
- No modal, no category prompt, anywhere in the Keep → Unsorted path. That is the entire point of the feature.
- Reuse over invention: the Move to… picker, the bookmark-row component (Edit/Delete/context menu), and the tag-filter-view's packed-columns layout are reused as-is, not reimplemented.
- JS in this codebase has no unit-test framework; frontend behavior is verified through Playwright specs in `tests/`, run with `PW_WORKERS=2` (never the default 4), scoped to the specs covering the change — not a full-suite run.
- New user-facing strings use `t(key, fallback)` with an English fallback string (existing convention throughout the dashboard JS, e.g. `dashboard-context-menu.js:254`). Translating them into the other five locales is a separate translation round, out of scope for this plan.

---

### Task 1: `Page.Hidden` field and reserved Unsorted page ID

**Files:**
- Modify: `internal/app/models.go:355-360` (`Page` struct)
- Test: `internal/app/models_page_test.go` (new file)

**Interfaces:**
- Produces: `Page.Hidden bool` (json `"hidden,omitempty"`); `const unsortedPageID = 999999` (package-level, `internal/app/models.go`).

- [ ] **Step 1: Write the failing test**

```go
// internal/app/models_page_test.go
package app

import "testing"

// A page's Hidden flag has to round-trip through the same file SavePage
// already writes -- PageWithBookmarks embeds Page, so this is a spot-check
// that the new field doesn't get dropped anywhere along that path, not a
// test of SavePage itself (that's covered below in Task 2).
func TestPageHiddenFieldRoundTrips(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	if err := store.SavePage(Page{ID: unsortedPageID, Name: "Unsorted", Hidden: true}); err != nil {
		t.Fatalf("SavePage: %v", err)
	}

	pages := store.getPages()
	var found *Page
	for i := range pages {
		if pages[i].ID == unsortedPageID {
			found = &pages[i]
		}
	}
	if found == nil {
		t.Fatal("unsorted page not found in getPages()")
	}
	if !found.Hidden {
		t.Error("Hidden = false, want true")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/app/ -run TestPageHiddenFieldRoundTrips -v`
Expected: FAIL — `unsortedPageID` and `Page.Hidden` undefined (compile error).

- [ ] **Step 3: Add the field and the constant**

In `internal/app/models.go`, add `Hidden` to the `Page` struct:

```go
type Page struct {
	ID     int    `json:"id"`              // Numeric ID matching the file number (bookmarks-1.json = id: 1)
	Name   string `json:"name"`            // Editable page name
	Icon   string `json:"icon,omitempty"`  // Optional emoji icon shown in the tab
	Color  string `json:"color,omitempty"` // Optional accent color (hex) for the tab indicator
	// Hidden excludes the page from the ordinary page navigation, the page
	// tab strip, and the Config -> Pages list. Used for the single reserved
	// "Unsorted" page (see unsortedPageID) -- everything else about a Hidden
	// page is a normal Page, so Health, search and GetBookmarksByPage all see
	// it exactly as they see any other page.
	Hidden bool `json:"hidden,omitempty"`
}
```

Near the existing page-related constants (below `defaultPageName`, around `internal/app/models.go:2888`), add:

```go
// unsortedPageID is the fixed, reserved page ID for the hidden "Unsorted"
// page (see EnsureUnsortedPage). It is a constant rather than "next available
// ID" precisely because "next available ID" is how ordinary pages are
// assigned (see dashboard-structure-create.js's createPageFromForm): a
// dynamically chosen low ID would eventually collide with a real page created
// after it. 999999 is far outside the range ordinary pages ever reach.
const unsortedPageID = 999999
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/app/ -run TestPageHiddenFieldRoundTrips -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/app/models.go internal/app/models_page_test.go
git commit -m "add Page.Hidden field and reserved unsorted page id"
```

---

### Task 2: `EnsureUnsortedPage` and hiding it from the public pages list

**Files:**
- Modify: `internal/app/models.go` (new method near `SavePage`, `internal/app/models.go:3266`)
- Modify: `internal/app/handlers.go:1946` (`GetPages`), `internal/app/handlers.go:1954` (`SavePages`), `internal/app/handlers.go:1987` (`DeletePage`)
- Test: `internal/app/models_page_test.go` (extend)

**Interfaces:**
- Consumes: `Page.Hidden`, `unsortedPageID` (Task 1); `fs.getPages()`, `fs.SavePage(Page) error` (existing).
- Produces: `func (fs *FileStore) EnsureUnsortedPage() (Page, error)` — idempotent, creates the page on first call, returns it unchanged on later calls. Used by Task 3's handler and Task 5's promote path.

- [ ] **Step 1: Write the failing tests**

```go
// internal/app/models_page_test.go (append)

func TestEnsureUnsortedPageIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	first, err := store.EnsureUnsortedPage()
	if err != nil {
		t.Fatalf("first EnsureUnsortedPage: %v", err)
	}
	if first.ID != unsortedPageID || !first.Hidden {
		t.Fatalf("first = %+v, want id=%d hidden=true", first, unsortedPageID)
	}

	// Put a bookmark on it, then call again -- a second call must not
	// recreate the file and lose the bookmark.
	if err := store.AddBookmark(unsortedPageID, Bookmark{Name: "kept", URL: "https://kept.example"}, false); err != nil {
		t.Fatalf("AddBookmark: %v", err)
	}

	second, err := store.EnsureUnsortedPage()
	if err != nil {
		t.Fatalf("second EnsureUnsortedPage: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("second call returned a different id: %d != %d", second.ID, first.ID)
	}
	if len(store.GetBookmarksByPage(unsortedPageID)) != 1 {
		t.Fatal("bookmark lost across a second EnsureUnsortedPage call")
	}
}

func TestGetPagesHandlerOmitsHiddenPage(t *testing.T) {
	h := newTestHandlers(t)
	if _, err := h.store.EnsureUnsortedPage(); err != nil {
		t.Fatalf("EnsureUnsortedPage: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/pages", nil)
	rec := httptest.NewRecorder()
	h.GetPages(rec, req)

	var pages []Page
	if err := json.Unmarshal(rec.Body.Bytes(), &pages); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, p := range pages {
		if p.ID == unsortedPageID {
			t.Fatalf("GET /api/pages included the hidden unsorted page: %+v", p)
		}
	}

	// But the store-level call (what Health and search use) still sees it.
	all := h.store.GetPages()
	found := false
	for _, p := range all {
		if p.ID == unsortedPageID {
			found = true
		}
	}
	if !found {
		t.Fatal("store.GetPages() no longer returns the hidden page -- Health/search would silently drop it")
	}
}

func TestDeletePageRefusesReservedUnsortedID(t *testing.T) {
	h := newTestHandlers(t)
	if _, err := h.store.EnsureUnsortedPage(); err != nil {
		t.Fatalf("EnsureUnsortedPage: %v", err)
	}

	r := mux.NewRouter()
	r.HandleFunc("/api/pages/{id:[0-9]+}", h.DeletePage).Methods(http.MethodDelete)
	req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/pages/%d", unsortedPageID), nil)
	// requireWriteAccess (security.go:331) only checks this header when
	// writeAccessToken() is non-empty; in a fresh t.TempDir() test store it is
	// empty, so this header is a no-op here but is set anyway so the test
	// keeps working if that ever changes.
	req.Header.Set("X-NextDash-Token", writeAccessToken())
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatal("DeletePage accepted the reserved unsorted page id")
	}
	if len(h.store.GetBookmarksByPage(unsortedPageID)) < 0 { // page still resolvable
		t.Fatal("unsorted page no longer resolvable after refused delete")
	}
}
```

Add the needed imports to the test file if not already present: `"encoding/json"`, `"fmt"`, `"net/http"`, `"net/http/httptest"`, `"github.com/gorilla/mux"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/app/ -run 'TestEnsureUnsortedPage|TestGetPagesHandlerOmitsHiddenPage|TestDeletePageRefusesReservedUnsortedID' -v`
Expected: FAIL — `EnsureUnsortedPage` undefined; `GetPages` still returns the hidden page; `DeletePage` still accepts it.

- [ ] **Step 3: Implement `EnsureUnsortedPage`**

In `internal/app/models.go`, near `SavePage` (`internal/app/models.go:3266`):

```go
// EnsureUnsortedPage returns the reserved hidden "Unsorted" page, creating it
// on first use. It is idempotent: once the page exists, later calls read it
// back rather than re-saving it, so an in-flight promote never races a second
// caller into overwriting bookmarks that were just added (SavePage would
// preserve them anyway -- see its own comment -- but there is no reason to
// write on every call when most calls are just "give me the id").
func (fs *FileStore) EnsureUnsortedPage() (Page, error) {
	for _, p := range fs.getPages() {
		if p.ID == unsortedPageID {
			return p, nil
		}
	}
	page := Page{ID: unsortedPageID, Name: "Unsorted", Hidden: true}
	if err := fs.SavePage(page); err != nil {
		return Page{}, fmt.Errorf("create unsorted page: %w", err)
	}
	return page, nil
}
```

- [ ] **Step 4: Filter the HTTP response and guard the write endpoints**

In `internal/app/handlers.go`, `GetPages` (`internal/app/handlers.go:1946`):

```go
func (h *Handlers) GetPages(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	all := h.store.GetPages()
	visible := make([]Page, 0, len(all))
	for _, p := range all {
		if p.Hidden {
			continue
		}
		visible = append(visible, p)
	}
	writeJSONWithETag(w, r, visible)
}
```

In `SavePages` (`internal/app/handlers.go:1954`), reject the reserved ID up front (defense in depth -- the UI never submits it, since `GetPages` no longer returns it to build a page list from):

```go
func (h *Handlers) SavePages(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var pages []Page
	if err := json.NewDecoder(r.Body).Decode(&pages); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	for _, page := range pages {
		if page.ID == unsortedPageID {
			http.Error(w, "That page id is reserved", http.StatusBadRequest)
			return
		}
	}

	// ... rest of the function is unchanged ...
```

In `DeletePage` (`internal/app/handlers.go:1987`), beside the existing "can't delete page 1" guard:

```go
	// Prevent deleting page 1 (main page)
	if pageID == 1 {
		http.Error(w, "Cannot delete the main page", http.StatusBadRequest)
		return
	}
	if pageID == unsortedPageID {
		http.Error(w, "Cannot delete the unsorted page", http.StatusBadRequest)
		return
	}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/app/ -run 'TestEnsureUnsortedPage|TestGetPagesHandlerOmitsHiddenPage|TestDeletePageRefusesReservedUnsortedID' -v`
Expected: PASS

- [ ] **Step 6: Run the full package's existing page/pages tests to check nothing broke**

Run: `go test ./internal/app/ -run 'Page' -v`
Expected: PASS (existing `GetPages`/`SavePages`/`DeletePage` tests unaffected by the additive filter and guards).

- [ ] **Step 7: Commit**

```bash
git add internal/app/models.go internal/app/handlers.go internal/app/models_page_test.go
git commit -m "add EnsureUnsortedPage, hide it from GET /api/pages, guard writes"
```

---

### Task 3: `GET /api/unsorted` endpoint

**Files:**
- Modify: `internal/app/handlers.go` (new handler, near `GetPages`)
- Modify: `internal/app/main.go:131` (route registration)
- Test: `internal/app/handlers_unsorted_test.go` (new file)

**Interfaces:**
- Consumes: `fs.EnsureUnsortedPage()`, `fs.GetBookmarksByPage(int) []Bookmark` (Task 2, existing).
- Produces: `GET /api/unsorted` → `{"page": Page, "bookmarks": []Bookmark}`, bookmarks sorted newest-first by `CreatedAt`. This is the single endpoint the widget (Task 8), the full view (Task 9), and the Move to… picker (Task 6) all read to learn the page id and its contents.

- [ ] **Step 1: Write the failing test**

```go
// internal/app/handlers_unsorted_test.go
package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetUnsortedCreatesPageAndReturnsSortedBookmarks(t *testing.T) {
	h := newTestHandlers(t)

	page, err := h.store.EnsureUnsortedPage()
	if err != nil {
		t.Fatalf("EnsureUnsortedPage: %v", err)
	}
	older := Bookmark{Name: "older", URL: "https://a.example", CreatedAt: 1000}
	newer := Bookmark{Name: "newer", URL: "https://b.example", CreatedAt: 2000}
	if err := h.store.AddBookmark(page.ID, older, false); err != nil {
		t.Fatalf("AddBookmark older: %v", err)
	}
	if err := h.store.AddBookmark(page.ID, newer, false); err != nil {
		t.Fatalf("AddBookmark newer: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/unsorted", nil)
	rec := httptest.NewRecorder()
	h.GetUnsorted(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Page      Page       `json:"page"`
		Bookmarks []Bookmark `json:"bookmarks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Page.ID != unsortedPageID || !out.Page.Hidden {
		t.Fatalf("page = %+v", out.Page)
	}
	if len(out.Bookmarks) != 2 {
		t.Fatalf("bookmarks = %d, want 2", len(out.Bookmarks))
	}
	if out.Bookmarks[0].Name != "newer" || out.Bookmarks[1].Name != "older" {
		t.Fatalf("order = [%s, %s], want [newer, older]", out.Bookmarks[0].Name, out.Bookmarks[1].Name)
	}
}

// The page is created lazily -- a fresh install with nothing kept yet still
// gets a 200 with an empty list, not a 404, so the widget and the full view
// don't need a special "does it exist" branch.
func TestGetUnsortedCreatesPageOnFirstCall(t *testing.T) {
	h := newTestHandlers(t)

	req := httptest.NewRequest(http.MethodGet, "/api/unsorted", nil)
	rec := httptest.NewRecorder()
	h.GetUnsorted(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Page      Page       `json:"page"`
		Bookmarks []Bookmark `json:"bookmarks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Page.ID != unsortedPageID {
		t.Fatalf("page.id = %d, want %d", out.Page.ID, unsortedPageID)
	}
	if len(out.Bookmarks) != 0 {
		t.Fatalf("bookmarks = %d, want 0", len(out.Bookmarks))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/app/ -run TestGetUnsorted -v`
Expected: FAIL — `h.GetUnsorted` undefined.

- [ ] **Step 3: Implement the handler and register the route**

In `internal/app/handlers.go`, near `GetPages`:

```go
// GetUnsorted returns the reserved Unsorted page and its bookmarks, newest
// first. The page is created on first call (EnsureUnsortedPage), so this
// never 404s -- a fresh install with nothing kept yet gets an empty list,
// not an error the widget or the full view would have to special-case.
func (h *Handlers) GetUnsorted(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	page, err := h.store.EnsureUnsortedPage()
	if !respondStorePersistError(w, err) {
		return
	}
	bookmarks := h.store.GetBookmarksByPage(page.ID)
	sort.Slice(bookmarks, func(i, j int) bool {
		return bookmarks[i].CreatedAt > bookmarks[j].CreatedAt
	})
	writeJSONWithETag(w, r, map[string]any{
		"page":      page,
		"bookmarks": bookmarks,
	})
}
```

(`respondStorePersistError`, `internal/app/handlers.go:66`, returns `true` when `err == nil` and `false` after already writing the error response — confirmed by reading it directly, so `if !respondStorePersistError(w, err) { return }` is the correct polarity, matching every other call site in this file, e.g. `internal/app/handlers.go:1971`.)

In `internal/app/main.go`, beside the other `/api/pages` routes (`internal/app/main.go:131`):

```go
	r.HandleFunc("/api/pages", handlers.GetPages).Methods("GET")
	r.HandleFunc("/api/pages", handlers.SavePages).Methods("POST")
	r.HandleFunc("/api/unsorted", handlers.GetUnsorted).Methods("GET")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/app/ -run TestGetUnsorted -v`
Expected: PASS

- [ ] **Step 5: Build the whole module to catch any signature mismatch**

Run: `go build ./...`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add internal/app/handlers.go internal/app/main.go internal/app/handlers_unsorted_test.go
git commit -m "add GET /api/unsorted"
```

---

### Task 4: Settings flag — `UnsortedEnabled`

**Files:**
- Modify: `internal/app/models.go` (Settings struct, two default blocks, one normalization block)
- Modify: `internal/app/handlers.go:1170` (`htmlPageData`) — no change needed, `Settings` is embedded already; listed here only as the file whose template consumes the new field.
- Test: `internal/app/settings_unsorted_test.go` (new file)

**Interfaces:**
- Produces: `Settings.UnsortedEnabled bool` (json `"unsortedEnabled"`), default `true`. Consumed by Task 9's `isEnabled()` and Task 10's nav-icon template gate.

- [ ] **Step 1: Write the failing test**

```go
// internal/app/settings_unsorted_test.go
package app

import "testing"

func TestUnsortedEnabledDefaultsTrue(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	settings := store.GetSettings()
	if !settings.UnsortedEnabled {
		t.Error("UnsortedEnabled = false on a fresh install, want true")
	}
}

func TestUnsortedEnabledCanBeTurnedOff(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	settings := store.GetSettings()
	settings.UnsortedEnabled = false
	if err := store.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	reloaded := store.GetSettings()
	if reloaded.UnsortedEnabled {
		t.Error("UnsortedEnabled reverted to true after an explicit off")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/app/ -run TestUnsortedEnabled -v`
Expected: FAIL — `Settings.UnsortedEnabled` undefined (compile error).

- [ ] **Step 3: Add the field, its two defaults, and its backfill**

In `internal/app/models.go`, add to the `Settings` struct beside `InboxEnabled` (`internal/app/models.go:665`):

```go
	InboxEnabled              bool                             `json:"inboxEnabled"`            // Enable inbox page and paste-to-inbox flow
	// UnsortedEnabled gates the Unsorted nav icon/shortcut and the "Keep"
	// promote-to-Unsorted action. Off, Keep in the inbox triage falls back to
	// its pre-existing "mark read" behavior (see dashboard-inbox-triage.js).
	UnsortedEnabled bool `json:"unsortedEnabled"`
```

In both default-settings struct literals (`internal/app/models.go:1500`-ish and `internal/app/models.go:3673`-ish, right beside `InboxEnabled: true,`):

```go
			InboxEnabled:                   true,
			UnsortedEnabled:                true,
```

(match the existing alignment style of each literal block — the two blocks are formatted independently, see the differing column widths already in the file.)

In the settings-normalization block (`internal/app/models.go:4270`, right after the `InboxEnabled` backfill):

```go
		if _, ok := rawSettings["inboxEnabled"]; !ok {
			settings.InboxEnabled = true
		}
		if _, ok := rawSettings["unsortedEnabled"]; !ok {
			settings.UnsortedEnabled = true
		}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/app/ -run TestUnsortedEnabled -v`
Expected: PASS

- [ ] **Step 5: Run the existing settings test file to check nothing broke**

Run: `go test ./internal/app/ -run TestSettings -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/app/models.go internal/app/settings_unsorted_test.go
git commit -m "add UnsortedEnabled setting, default true"
```

---

### Task 5: "Keep" promotes to Unsorted instead of marking read

**Files:**
- Modify: `static/js/dashboard/dashboard-inbox-triage.js:353` (`actKeep`)
- Modify: `static/js/dashboard/dashboard-inbox.js:4337` area (new sibling method to `promoteItem`)
- Test: `tests/inbox-triage-keep.spec.js` (new file)

**Interfaces:**
- Consumes: `GET /api/unsorted` (Task 3), `POST /api/bookmarks/add` (existing, contract confirmed at `static/js/dashboard/dashboard-inline-edit.js:1836`: `{page: pageId, bookmark, allowDuplicate}`), `this.inbox.completePromote(id)` (existing, `dashboard-inbox.js:4376`).
- Produces: `DashboardInbox.prototype.keepItem(item)` — silent promote, no modal.

This task changes behavior with no Go-side test harness, so it's verified end-to-end with one Playwright spec rather than a unit test — this matches how the rest of the dashboard JS is tested in this repo (no JS unit-test framework; see the Global Constraints note).

- [ ] **Step 1: Write the failing Playwright spec**

```js
// tests/inbox-triage-keep.spec.js
const { test, expect } = require('@playwright/test');
const { setupDashboard } = require('./helpers/dashboard-setup'); // adjust to whatever helper the other inbox specs import -- see tests/health-focus-drift-mute.spec.js or a neighboring inbox spec for the exact import path and fixture used in this repo before writing this line.

test('Keep promotes an inbox item to Unsorted without opening a modal', async ({ page }) => {
  await setupDashboard(page, {
    inbox: [{ id: 'inl_1', url: 'https://keep.example', title: 'Keep me', addedAt: Date.now() }],
  });

  await page.goto('/#inbox');
  await page.keyboard.press('t'); // start triage, per the existing triage keybindings
  await page.keyboard.press('r'); // Keep

  // No bookmark form modal opened.
  await expect(page.locator('#bookmark-form-modal, .bookmark-form-modal')).toBeHidden();

  // The item is gone from the Inbox.
  await expect(page.locator('[data-inbox-id="inl_1"]')).toHaveCount(0);

  // It now exists as a bookmark on the Unsorted page.
  const res = await page.request.get('/api/unsorted');
  const body = await res.json();
  expect(body.bookmarks.some((b) => b.url === 'https://keep.example')).toBe(true);
});
```

Before running this, open a neighboring inbox Playwright spec (e.g. `tests/health-focus-drift-mute.spec.js` is health, not inbox — search `tests/` for an existing `inbox-triage*.spec.js` or grep `startTriage` inside `tests/*.spec.js`) and copy its actual setup/fixture helper import and the real triage-start keybinding, replacing the placeholder import comment above. The behavior asserted (no modal, item leaves Inbox, bookmark appears at `/api/unsorted`) is what matters; match this repo's existing spec scaffolding for how a dashboard page is loaded with seeded inbox data.

- [ ] **Step 2: Run the spec to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/inbox-triage-keep.spec.js`
Expected: FAIL — item is still in the Inbox with only `readAt` set, `/api/unsorted` has no matching bookmark.

- [ ] **Step 3: Implement `keepItem`**

In `static/js/dashboard/dashboard-inbox.js`, add a new method near `promoteItem` (`dashboard-inbox.js:4337`):

```js
    /**
     * The silent promote: "Keep" from inbox triage. Unlike promoteItem() this
     * never opens the bookmark form -- there is no category to choose, that is
     * the entire point of Unsorted. Resolves the Unsorted page id once per
     * session and caches it, since every Keep after the first would otherwise
     * pay for a GET it already knows the answer to.
     */
    async keepItem(item) {
        const d = this.dash;
        this._trackAction('keep');
        try {
            if (!d._unsortedPageId) {
                const res = await fetch('/api/unsorted');
                if (!res.ok) throw new Error('unsorted lookup failed');
                const data = await res.json();
                d._unsortedPageId = data.page.id;
            }
            const doFetch = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const response = await doFetch('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: d._unsortedPageId,
                    bookmark: {
                        name: item.previewTitle || item.title || item.url,
                        url: item.url,
                        category: '',
                    },
                    // A silent action has nowhere to ask "keep both copies?" --
                    // Keep already promises no dialog, so a duplicate is kept
                    // rather than blocked.
                    allowDuplicate: true,
                }),
            });
            if (!response.ok) {
                throw new Error('bookmark create failed');
            }
            await this.completePromote(item.id);
            d.data?.invalidatePageDataCache?.(d._unsortedPageId);
        } catch (_error) {
            d.showNotification(this.t('dashboard.inboxKeepFailed', 'Could not keep this link'), 'error');
        }
    }
```

In `static/js/dashboard/dashboard-inbox-triage.js`, replace `actKeep` (`dashboard-inbox-triage.js:353`):

```js
    async actKeep() {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        await this.inbox.keepItem(item);
        await this.afterAction(false, {});
    }
```

Check the call at `dashboard-inbox-triage.js:296` (`void this.actKeep();`, the `r` keydown case) and the button at `dashboard-inbox-triage.js:545` still call `actKeep()` unchanged — they already do, since the method's name and zero-argument signature are unchanged.

Update the button label at `dashboard-inbox-triage.js:545` if it currently reads "Keep" with implied "mark read" semantics in its own translation key description — check `dashboard.inboxTriageKeep`'s fallback text; if it is just `'Keep'`, leave it, since that already matches the new behavior.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/inbox-triage-keep.spec.js`
Expected: PASS

- [ ] **Step 5: Run the existing inbox triage specs to check nothing broke**

Run: `PW_WORKERS=2 npx playwright test tests/inbox` (or the exact glob this repo uses for inbox specs — check `tests/` for the naming pattern first with `ls tests/ | grep inbox`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add static/js/dashboard/dashboard-inbox.js static/js/dashboard/dashboard-inbox-triage.js tests/inbox-triage-keep.spec.js
git commit -m "keep in inbox triage promotes to Unsorted, no modal"
```

---

### Task 6: "Move to…" lists Unsorted as a target

**Files:**
- Modify: `static/js/dashboard/dashboard-bookmark-rows.js:1279-1444` (`showMovePopover`)
- Test: `tests/move-popover-unsorted.spec.js` (new file)

**Interfaces:**
- Consumes: `GET /api/unsorted` (Task 3), existing `d._moveBookmarkToPage(bookmarkRef, bookmark, pageId, anchorEl)` (unchanged, called with `Number(id)` at `dashboard-bookmark-rows.js:1425`).
- Produces: one extra `.move-popover-item[data-type="page"]` entry labeled "Unsorted", sourced from a cached `d._unsortedPage` rather than `d.pages`.

- [ ] **Step 1: Write the failing Playwright spec**

```js
// tests/move-popover-unsorted.spec.js
const { test, expect } = require('@playwright/test');
const { setupDashboard } = require('./helpers/dashboard-setup'); // match the real helper -- see Task 5, Step 1 note.

test('Move to... lists Unsorted and moving a bookmark there works', async ({ page }) => {
  await setupDashboard(page, {
    bookmarks: [{ name: 'Move me', url: 'https://move.example', pageId: 1, category: 'General' }],
  });
  await page.goto('/');

  const row = page.locator('[data-bookmark-name="Move me"]'); // adjust selector to match this repo's bookmark row markup -- check an existing move-popover spec if one exists (`ls tests | grep -i move`).
  await row.click({ button: 'right' });
  await page.getByRole('option', { name: 'Unsorted' }).click();

  const res = await page.request.get('/api/unsorted');
  const body = await res.json();
  expect(body.bookmarks.some((b) => b.url === 'https://move.example')).toBe(true);
});
```

Before running, check `ls tests | grep -i move` for an existing move-popover spec and copy its exact row selector and modal-open gesture (right-click vs. a "..." button vs. `Shift+M`) rather than guessing at the placeholder selector above.

- [ ] **Step 2: Run the spec to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/move-popover-unsorted.spec.js`
Expected: FAIL — no "Unsorted" option in the popover.

- [ ] **Step 3: Add the Unsorted entry**

In `static/js/dashboard/dashboard-bookmark-rows.js`, `showMovePopover` (`dashboard-bookmark-rows.js:1279`), after the existing "Page" section block (`dashboard-bookmark-rows.js:1345-1388` roughly — the `otherPages.forEach(...)` loop), add one more section before that `if (otherPages.length > 0)` block runs, fetching (and caching on `d`) the Unsorted page:

```js
        // Fetched once per session and cached on d, same pattern as the
        // Keep action in dashboard-inbox.js -- both need "the id of the
        // Unsorted page" and neither should pay for a GET on every popover
        // open.
        if (!d._unsortedPage) {
            try {
                const res = await fetch('/api/unsorted');
                if (res.ok) {
                    const data = await res.json();
                    d._unsortedPage = data.page;
                }
            } catch (_error) {
                // Best effort -- if this fails, Unsorted just doesn't appear
                // as a target this time; Move to... still works for
                // categories and other pages.
            }
        }

        if (d._unsortedPage && String(d._unsortedPage.id) !== String(d.currentPageId)) {
            const divider = document.createElement('div');
            divider.className = 'move-popover-divider';
            pop.appendChild(divider);

            const item = document.createElement('div');
            item.className = 'move-popover-item';
            item.setAttribute('role', 'option');
            item.setAttribute('data-type', 'page');
            item.setAttribute('data-id', String(d._unsortedPage.id));
            item.setAttribute('aria-selected', 'false');

            const check = document.createElement('span');
            check.className = 'move-popover-check';
            item.appendChild(check);

            const label = document.createElement('span');
            label.textContent = t('dashboard.unsortedPageName', 'Unsorted');
            item.appendChild(label);

            pop.appendChild(item);
            items.push(item);
        }
```

Note `showMovePopover` is currently synchronous (no `await` inside it) — since this adds a `fetch`, change its declaration from `showMovePopover(anchorEl, bookmark, bookmarkIndex) {` to `async showMovePopover(anchorEl, bookmark, bookmarkIndex) {`, and update its one call site (`dashboard-context-menu.js:951`, `case 'move': d.showMovePopover?.(row, bookmark, bookmarkIndex); break;`) to `void d.showMovePopover?.(row, bookmark, bookmarkIndex);` so a rejected promise there doesn't become an unhandled rejection.

Because the popover section that follows (`if (otherPages.length > 0) { ... }`) already builds `items` and later code binds `items.forEach(...)` for keyboard navigation after all sections are appended, keep the new block **before** that `items.forEach` binding (`dashboard-bookmark-rows.js:1436`) — i.e. insert it directly after the existing `if (otherPages.length > 0) { ... }` block closes, not after the function's end.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/move-popover-unsorted.spec.js`
Expected: PASS

- [ ] **Step 5: Run the existing move-popover specs to check nothing broke**

Run: `PW_WORKERS=2 npx playwright test tests/$(ls tests | grep -i move-popover | head -1)` (adjust to the real existing spec filename(s) found via `ls tests | grep -i move`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add static/js/dashboard/dashboard-bookmark-rows.js static/js/dashboard/dashboard-context-menu.js tests/move-popover-unsorted.spec.js
git commit -m "move to... popover lists Unsorted as a target"
```

---

### Task 7: Register the `unsorted` widget type (Go)

**Files:**
- Modify: `internal/app/widgets.go` (near `WidgetTypeInbox`, `internal/app/widgets.go:46-49`, and the type-registry map at `internal/app/widgets.go:131`)
- Modify: `internal/app/widgets_config.go` (near `WidgetTypeInbox`, `internal/app/widgets_config.go:141`, and the list at `internal/app/widgets_config.go:484`)
- Test: `internal/app/widgets_unsorted_test.go` (new file)

**Interfaces:**
- Produces: `WidgetTypeUnsorted WidgetType = "unsorted"`, accepted by whatever validates `Widget.Type` against the registry, with a config schema `[{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows}]` (same shape as Inbox's).

- [ ] **Step 1: Write the failing test**

First, read `internal/app/widgets.go` around line 131 (the map `WidgetTypeInbox: {},` sits in) to see exactly what that map is keyed/valued by and what function consumes it (e.g. a `func isValidWidgetType(t WidgetType) bool` or similar) — then write the test against that real function rather than the guess below, which assumes such a function exists under a predictable name:

```go
// internal/app/widgets_unsorted_test.go
package app

import "testing"

func TestUnsortedWidgetTypeIsRegistered(t *testing.T) {
	if !isValidWidgetType(WidgetTypeUnsorted) { // rename to match the real validator found in widgets.go
		t.Error("WidgetTypeUnsorted not accepted as a valid widget type")
	}
}

func TestUnsortedWidgetConfigSchemaHasRowsField(t *testing.T) {
	schema, ok := WidgetConfigSchema[WidgetTypeUnsorted] // rename to match the real schema map's identifier in widgets_config.go
	if !ok {
		t.Fatal("no config schema registered for WidgetTypeUnsorted")
	}
	found := false
	for _, f := range schema {
		if f.Key == "rows" {
			found = true
		}
	}
	if !found {
		t.Error("unsorted widget schema has no rows field")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/app/ -run TestUnsortedWidget -v`
Expected: FAIL — `WidgetTypeUnsorted` undefined (compile error).

- [ ] **Step 3: Register the type**

In `internal/app/widgets.go`, beside `WidgetTypeInbox` (`internal/app/widgets.go:46-49`):

```go
	// WidgetTypeInbox reports what is waiting to be filed, and how long it has
	// waited.
	WidgetTypeInbox WidgetType = "inbox"
	// WidgetTypeUnsorted lists bookmarks kept from the inbox without a
	// dashboard category -- the same list the full Unsorted view shows,
	// chronological, most recent first.
	WidgetTypeUnsorted WidgetType = "unsorted"
```

Add it to whatever registry map sits at `internal/app/widgets.go:131` beside `WidgetTypeInbox: {},`, matching that map's exact value type (read the map's declaration line above it before copying `{}`  — it may be `struct{}{}`, `true`, or something else).

In `internal/app/widgets_config.go`, beside `WidgetTypeInbox` (`internal/app/widgets_config.go:141-144`):

```go
	WidgetTypeUnsorted: {
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
```

And add `WidgetTypeUnsorted` to the list at `internal/app/widgets_config.go:484` (the grouping list that currently reads `WidgetTypeInbox, WidgetTypeFeeds, WidgetTypeSources, WidgetTypeNeglected,`) — read the ~20 lines around that line first to see what the list is *for* (a display-order grouping, an "incoming"-style category, etc. — `dashboard-config.js:14550` showed a client-side mirror `['incoming', ['inbox', 'feeds', 'sources']]`, so this Go-side list is likely the same grouping's source of truth) before deciding whether `unsorted` belongs in that same group or needs its own.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/app/ -run TestUnsortedWidget -v`
Expected: PASS

- [ ] **Step 5: Run the existing widget tests to check nothing broke**

Run: `go test ./internal/app/ -run Widget -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/app/widgets.go internal/app/widgets_config.go internal/app/widgets_unsorted_test.go
git commit -m "register the unsorted widget type"
```

---

### Task 8: Unsorted widget (JS renderer)

**Files:**
- Create: `static/js/dashboard/dashboard-widget-unsorted.js` (modeled on `static/js/dashboard/dashboard-widget-inbox.js`)
- Modify: `templates/dashboard.html:575` area (new `<script>` tag)
- Modify: `static/js/dashboard/dashboard-config.js:16835` (`WIDGET_TYPES`) and `:16853` (`WIDGET_SETTINGS`)
- Test: `tests/widget-unsorted.spec.js` (new file)

**Interfaces:**
- Consumes: `GET /api/unsorted` (Task 3); the `window.DashboardWidgets` registry pattern (`dashboard-render-core.js:579,691,837` call `window.DashboardWidgets?.[widget.type]?.(body, widget, d)`).
- Produces: `window.DashboardWidgets.unsorted = renderUnsorted`.

- [ ] **Step 1: Write the failing Playwright spec**

```js
// tests/widget-unsorted.spec.js
const { test, expect } = require('@playwright/test');
const { setupDashboard } = require('./helpers/dashboard-setup'); // match the real helper -- see Task 5, Step 1 note.

test('Unsorted widget lists bookmarks chronologically with a view-all link', async ({ page }) => {
  await setupDashboard(page, {
    // Seed straight through the API once the page loads, or via whatever
    // seeding mechanism the existing widget specs use (check
    // tests/widget-*.spec.js, e.g. an inbox or feeds widget spec, for the
    // real seeding convention before writing this test).
  });
  await page.goto('/');
  await page.request.post('/api/bookmarks/add', {
    data: { page: 999999, bookmark: { name: 'Widget item', url: 'https://widget.example', category: '' } },
  });
  // Add a widget of type "unsorted" to the current page the same way an
  // existing widget spec does it (check tests/widget-*.spec.js for the
  // add-widget flow) rather than guessing at UI here.

  await expect(page.locator('.dashboard-widget[data-widget-type="unsorted"]')).toContainText('Widget item');
  await page.locator('.dashboard-widget[data-widget-type="unsorted"] a', { hasText: /view all|bekijk alles/i }).click();
  await expect(page).toHaveURL(/unsorted/);
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/widget-unsorted.spec.js`
Expected: FAIL — no renderer registered for type "unsorted", widget shows nothing or an error state.

- [ ] **Step 3: Write the renderer**

```js
// static/js/dashboard/dashboard-widget-unsorted.js
/**
 * The Unsorted widget: bookmarks kept from the inbox without a dashboard
 * category, most recent first. Reads the same /api/unsorted endpoint the
 * full view and the Move to... popover use, so there is exactly one source
 * of truth for "what is in Unsorted" on the client.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    async function load(dash) {
        if (dash._widgetUnsorted) return dash._widgetUnsorted;
        try {
            const res = await fetch('/api/unsorted');
            if (!res.ok) return null;
            const data = await res.json();
            dash._widgetUnsorted = Array.isArray(data?.bookmarks) ? data.bookmarks : [];
            dash._unsortedPageId = data?.page?.id;
            return dash._widgetUnsorted;
        } catch (_error) {
            return null;
        }
    }

    function render(body, widget, dash, bookmarks) {
        body.replaceChildren();
        const config = widget?.config || {};
        const maxRows = Math.min(Math.max(Number(config.rows) || 5, 1), 20);

        if (!bookmarks.length) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            empty.textContent = label(dash, 'dashboard.widgetUnsortedEmpty', 'Nothing kept yet.');
            body.appendChild(empty);
            return;
        }

        const list = document.createElement('ul');
        list.className = 'dashboard-widget-list dashboard-widget-unsorted-list';
        bookmarks.slice(0, maxRows).forEach((bm) => {
            const row = document.createElement('li');
            row.className = 'dashboard-widget-list-row';
            const link = document.createElement('a');
            link.href = bm.url;
            link.textContent = bm.name || bm.url;
            link.rel = 'noopener noreferrer';
            row.appendChild(link);
            list.appendChild(row);
        });
        body.appendChild(list);

        if (bookmarks.length > maxRows) {
            const more = document.createElement('a');
            more.className = 'dashboard-widget-view-all';
            more.href = '/#unsorted';
            more.textContent = label(dash, 'dashboard.widgetUnsortedViewAll', 'view all');
            body.appendChild(more);
        }
    }

    async function renderUnsorted(body, widget, dash) {
        const bookmarks = await load(dash);
        if (!bookmarks) {
            body.replaceChildren();
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetUnsortedWaiting', 'Loading…');
            body.appendChild(waiting);
            return;
        }
        render(body, widget, dash, bookmarks);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.unsorted = renderUnsorted;
})();
```

Before finalizing, read `static/js/dashboard/dashboard-widget-inbox.js:82-118` (the part after the snippet already seen) for the exact `dashboard-widget-list`/row CSS class names and the "N more" pattern it uses (a `createOverflowLink`-style helper was referenced at `dashboard-widget-inbox.js` around the `list, dash, sorted.length - maxRows, () => ...` call seen earlier) — reuse that exact helper instead of the ad hoc "more" link above if one exists, for visual consistency with every other list-style widget.

In `templates/dashboard.html`, beside the Inbox widget's script tag (`templates/dashboard.html:575`):

```html
    <script src="{{asset "js/dashboard/dashboard-widget-inbox.js"}}" defer></script>
    <script src="{{asset "js/dashboard/dashboard-widget-unsorted.js"}}" defer></script>
```

Regenerate the content-hashed asset tokens the `{{asset ...}}` helper reads — find and run this repo's asset-hash generator (per the project's own convention: a new/changed file under `static/` needs its hash regenerated or the browser serves a stale reference). Locate it with `grep -rl asset_hashes internal/ scripts/ 2>/dev/null` and run whatever generator command that turns up (likely referenced by `asset_hashes_gen.go`, seen in this project's release tooling) before moving on.

In `static/js/dashboard/dashboard-config.js`, add `'unsorted'` to `WIDGET_TYPES` (`dashboard-config.js:16835-16837`) and add its settings entry to `WIDGET_SETTINGS` (`dashboard-config.js:16853`, alongside the other simple list widgets):

```js
        unsorted: [
            { key: 'rows', kind: 'int', min: 1, max: 20,
              label: ['config.widgetRows', 'Rows'] },
        ],
```

(Match `config.widgetRows`'s exact key to whatever the Inbox widget's own "rows" field setting already uses in this same object — grep `WIDGET_SETTINGS` for `inbox:` in this file and copy its `rows` entry's label key verbatim, rather than inventing a new one.)

Search for the actual "add a widget" picker menu (`grep -rn "WIDGET_TYPES\|addWidget" static/js/dashboard/dashboard-config.js | grep -v WIDGET_SETTINGS`) and add an `'unsorted'` entry there too, following whatever pattern that search turns up — the exact call site was not located during planning; this step cannot be skipped, as without it the widget type is registered but not offered in the UI.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/widget-unsorted.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add static/js/dashboard/dashboard-widget-unsorted.js templates/dashboard.html static/js/dashboard/dashboard-config.js tests/widget-unsorted.spec.js internal/app/asset_hashes.go
git commit -m "add unsorted bookmarks widget"
```

(Adjust the last `git add` path to whatever file the asset-hash generator actually wrote to.)

---

### Task 9: Full Unsorted view (packed-columns masonry)

**Files:**
- Create: `static/js/dashboard/dashboard-unsorted.js` (new `DashboardUnsorted` class, modeled on `static/js/dashboard/dashboard-health.js`'s `openHealthView`/`isEnabled`/`isActiveView` shape)
- Modify: `static/js/dashboard.js:218` area (instantiate `this.unsorted = new DashboardUnsorted(this)`)
- Modify: `static/js/dashboard/dashboard-data.js:609,1248` (add an `activeView === 'unsorted'` branch beside the existing `'inbox'`/`'health'` ones)
- Modify: `templates/dashboard.html` (new script tag)
- Test: `tests/unsorted-view.spec.js` (new file)

**Interfaces:**
- Consumes: `GET /api/unsorted` (Task 3); `d.tagFilter._distributeTagFilterColumnBlocks(container, chunkBlocks, opts)` and `d.createCategoryElement(meta, bookmarks)` (both existing, reused as-is — see `dashboard-tag-filter.js:232-250`); `d.setActiveView(view)` (existing, used by `dashboard-health.js:549`).
- Produces: `DashboardUnsorted.VIEW = 'unsorted'`; `openUnsortedView()`; `isEnabled()`; `isActiveView()`; `loadAndRender()`.

- [ ] **Step 1: Write the failing Playwright spec**

```js
// tests/unsorted-view.spec.js
const { test, expect } = require('@playwright/test');
const { setupDashboard } = require('./helpers/dashboard-setup'); // match the real helper -- see Task 5, Step 1 note.

test('Unsorted view renders kept bookmarks in packed columns, chronologically', async ({ page }) => {
  await setupDashboard(page, {});
  await page.goto('/');
  await page.request.post('/api/bookmarks/add', {
    data: { page: 999999, bookmark: { name: 'Older', url: 'https://older.example', category: '', createdAt: 1000 } },
  });
  await page.request.post('/api/bookmarks/add', {
    data: { page: 999999, bookmark: { name: 'Newer', url: 'https://newer.example', category: '', createdAt: 2000 } },
  });

  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyU');
  await page.keyboard.up('Shift');

  await expect(page.locator('.unsorted-view')).toBeVisible();
  const rows = page.locator('.unsorted-view .bookmarks-list a, .unsorted-view .dashboard-column a'); // adjust selector to match whatever createCategoryElement actually renders per row -- inspect via `page.locator('.tag-filter-view a').first()` in an existing tag-filter spec if unsure.
  await expect(rows.first()).toContainText('Newer');
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/unsorted-view.spec.js`
Expected: FAIL — Shift+U does nothing yet.

- [ ] **Step 3: Implement `DashboardUnsorted`**

```js
// static/js/dashboard/dashboard-unsorted.js
/**
 * The full Unsorted view: every bookmark kept from the inbox without a
 * dashboard category, in fixed-width packed columns, chronological.
 *
 * The masonry layout is not reimplemented here. DashboardTagFilter already
 * builds it (see dashboard-tag-filter.js:renderTagFilterDashboard) from an
 * arbitrary bookmark array chunked into groups of ten and handed to
 * _distributeTagFilterColumnBlocks -- this view supplies a different
 * bookmark array (from /api/unsorted, not a tag match) and reuses the exact
 * same chunking and column-distribution calls.
 */
class DashboardUnsorted {
    static VIEW = 'unsorted';

    constructor(dashboard) {
        this.dash = dashboard;
    }

    isEnabled() {
        return this.dash.settings?.unsortedEnabled !== false;
    }

    isActiveView() {
        return this.dash.activeView === DashboardUnsorted.VIEW;
    }

    async openUnsortedView() {
        const d = this.dash;
        if (!this.isEnabled()) {
            return false;
        }
        if (d.activeView === DashboardUnsorted.VIEW) {
            return true;
        }
        if (d.isInlineEditActive() && !(await d.confirmInlineEditBeforeNavigation())) {
            return false;
        }
        d._abortInlineEditForRender?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        d.setActiveView(DashboardUnsorted.VIEW);
        window.nextdashTrack?.('view:unsorted');
        await this.loadAndRender();
        return true;
    }

    async loadAndRender() {
        const d = this.dash;
        let bookmarks = [];
        try {
            const res = await fetch('/api/unsorted');
            if (res.ok) {
                const data = await res.json();
                bookmarks = Array.isArray(data?.bookmarks) ? data.bookmarks : [];
                d._unsortedPageId = data?.page?.id;
            }
        } catch (_error) {
            // Falls through to the empty-state render below.
        }
        this.render(bookmarks);
    }

    render(bookmarks) {
        const d = this.dash;
        const container = document.getElementById('dashboard-layout');
        if (!container) return;

        container.innerHTML = '';
        container.classList.add('unsorted-view');

        if (!bookmarks.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state empty-state--unsorted';
            empty.textContent = d.formatDashboardLabel('unsortedEmpty', {}, 'Nothing kept yet.');
            container.appendChild(empty);
            return;
        }

        const CHUNK_SIZE = 10;
        const chunkBlocks = [];
        for (let offset = 0; offset < bookmarks.length; offset += CHUNK_SIZE) {
            const chunk = bookmarks.slice(offset, offset + CHUNK_SIZE);
            const chunkIndex = Math.floor(offset / CHUNK_SIZE);
            chunkBlocks.push(
                d.createCategoryElement(
                    { id: `__unsorted_chunk_${chunkIndex}`, name: '', tagFilterChunk: true },
                    chunk
                )
            );
        }

        const body = document.createElement('div');
        d._copyDashboardGridLayoutToElement(body, container);
        const gridLayout = d.syncDashboardGridLayout();
        d.tagFilter._distributeTagFilterColumnBlocks(body, chunkBlocks, { animate: false, gridLayout });
        container.appendChild(body);
    }
}

window.DashboardUnsorted = DashboardUnsorted;
```

In `static/js/dashboard.js`, beside `this.tagFilter = new DashboardTagFilter(this);` (`static/js/dashboard.js:218`):

```js
        this.tagFilter = new DashboardTagFilter(this);
        this.unsorted = new DashboardUnsorted(this);
```

In `static/js/dashboard/dashboard-data.js`, add a branch beside each existing `d.activeView === 'inbox'`/`'health'` check (`dashboard-data.js:609` and `:1248`):

```js
        if (d.activeView === 'unsorted' && d.unsorted?.isEnabled?.()) {
            await d.unsorted.loadAndRender();
            return true;
        }
```

In `templates/dashboard.html`, add the script tag before `dashboard-tag-filter.js`'s own tag (find it with `grep -n dashboard-tag-filter.js templates/dashboard.html`) since `DashboardUnsorted`'s constructor doesn't depend on load order but its `render()` method calls `d.tagFilter`, which must exist by the time any view is opened — matching where `dashboard-tag-filter.js`'s own tag already sits is sufficient:

```html
    <script src="{{asset "js/dashboard/dashboard-unsorted.js"}}" defer></script>
```

Regenerate asset hashes again (same step as Task 8).

- [ ] **Step 4: Wire the keyboard shortcut**

In `static/js/dashboard/dashboard-setup.js`, beside the `Shift+I` block (`dashboard-setup.js:466-474`):

```js
            if (e.shiftKey && e.code === 'KeyU') {
                if (d.unsorted?.isEnabled?.()) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.nextdashRecordKey?.('Shift + U');
                    void d.unsorted.openUnsortedView();
                }
                return;
            }
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/unsorted-view.spec.js`
Expected: PASS — adjust the row selector in Step 1 to whatever `createCategoryElement` actually emits if the first run shows a different DOM shape than guessed.

- [ ] **Step 6: Run the existing tag-filter specs to check nothing broke**

Run: `PW_WORKERS=2 npx playwright test tests/$(ls tests | grep -i tag-filter | head -1)`
Expected: PASS — `_distributeTagFilterColumnBlocks` is shared, unmodified code; this just confirms the new caller didn't need changes to it that would have affected the old one.

- [ ] **Step 7: Commit**

```bash
git add static/js/dashboard/dashboard-unsorted.js static/js/dashboard.js static/js/dashboard/dashboard-data.js static/js/dashboard/dashboard-setup.js templates/dashboard.html tests/unsorted-view.spec.js
git commit -m "add full unsorted view (packed-columns, shift+u)"
```

---

### Task 10: Row style — favicon default, hover peek

**Files:**
- Modify: `static/css/dashboard.css` (near the existing `.bookmark-preview-card` rules, `dashboard.css:4444`)
- Verify only (no code change expected): `dashboard-preview.js`'s peek mode already binds to any `.bookmark-row`/equivalent hover target `d.createCategoryElement` produces — confirm during this task rather than assume.

**Interfaces:**
- Consumes: `dashboard-preview.js`'s existing hover-peek binding (whatever selector it currently listens on — read `dashboard-preview.js` for that selector before writing CSS, since if the peek binds by delegated listener on a shared ancestor class, `.unsorted-view` rows may already trigger it for free with zero JS/CSS changes).

- [ ] **Step 1: Manually verify whether peek already works with no changes**

Run the app locally (`preview_start` per this session's dev workflow), open the Unsorted view (Shift+U) with a few kept bookmarks, and hover a row. If the peek card already appears (likely, since rows are built by the same `createCategoryElement` every other bookmark grid uses, and `dashboard-preview.js` was found earlier to bind generically rather than per-view), **this task is done with no diff** — skip to Step 4 and record that finding in the commit message instead of a code change.

- [ ] **Step 2: If peek does not fire, find out why**

Read `dashboard-preview.js`'s hover-binding code (search `addEventListener('mouseenter'` or a delegated `'pointerover'` in that file) and compare its selector/root against `.unsorted-view`'s DOM. The likely gap, if any, is that the binding is scoped to `#dashboard-layout` in "dashboard" mode but the Unsorted view sets a different root class that excludes it from whatever selector gates peek-eligibility — in that case, add `.unsorted-view` to that selector's exclusion/inclusion list at the exact line found.

- [ ] **Step 3: If a CSS gap is found (e.g. columns too narrow for the peek card to position correctly)**

Only if manual verification in Step 1 shows a real visual problem (peek card clipped, mispositioned) — not preemptively — add the minimal fix to `static/css/dashboard.css` near `.bookmark-preview-card` (`dashboard.css:4444`), keeping the existing `position: fixed` positioning logic untouched since that already accounts for viewport edges.

- [ ] **Step 4: Commit (even if the diff is empty aside from a comment)**

```bash
git add static/css/dashboard.css static/js/dashboard/dashboard-preview.js
git commit -m "confirm/fix hover peek in the unsorted view" --allow-empty
```

---

### Task 11: Nav icon + Config toggle

**Files:**
- Modify: `templates/dashboard.html:317-324` (nav icon, beside the Health icon)
- Modify: `internal/app/handlers.go:1167` (`htmlPageData`) — no field addition needed, `UnsortedEnabled` already flows through the embedded `Settings` (Task 4); confirm this during the task rather than add a redundant field.
- Modify: `static/js/dashboard/dashboard-toolbar.js:427-451` (delegated click handling)
- Modify: `static/js/dashboard/dashboard-config.js` (a settings toggle beside the existing Inbox-enabled toggle — search `inboxEnabled` in this file's Behavior/General section for the exact existing toggle to copy)
- Test: `tests/header-shortcuts.spec.js` (extend — this file already covers Shift+H/Shift+I per its name)

**Interfaces:**
- Consumes: `.UnsortedEnabled` (template, from embedded `Settings`), `d.unsorted.openUnsortedView()` (Task 9).

- [ ] **Step 1: Write the failing test — extend the existing header-shortcuts spec**

Read `tests/header-shortcuts.spec.js` first (it already tests Shift+H and likely Shift+I) and add one test in the same style:

```js
test('Shift+U opens the Unsorted view', async ({ page }) => {
  // Mirror whatever setup the existing Shift+H test in this file uses.
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyU');
  await page.keyboard.up('Shift');
  await expect(page.locator('.unsorted-view')).toBeVisible();
});

test('the unsorted nav icon opens the Unsorted view', async ({ page }) => {
  await page.locator('.unsorted-link-anchor').click();
  await expect(page.locator('.unsorted-view')).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/header-shortcuts.spec.js`
Expected: FAIL — Task 9 already wired the keyboard shortcut, so the first new test may already pass; the icon-click test fails since `.unsorted-link-anchor` does not exist yet.

- [ ] **Step 3: Add the nav icon**

In `templates/dashboard.html`, beside the Health icon block (`templates/dashboard.html:317-324`):

```html
                    {{if .UnsortedEnabled}}<div class="unsorted-link unsorted-link--icon">
                        <a href="/#unsorted" class="unsorted-link-anchor" data-i18n-aria="dashboard.unsorted" data-i18n-tooltip="dashboard.unsorted" aria-label="unsorted" title="unsorted">
                            <svg class="unsorted-link-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                                <rect x="4" y="4" width="7" height="7" rx="1.5"/>
                                <rect x="13" y="4" width="7" height="7" rx="1.5"/>
                                <rect x="4" y="13" width="7" height="7" rx="1.5"/>
                                <rect x="13" y="13" width="7" height="7" rx="1.5"/>
                            </svg>
                        </a>
                    </div>{{end}}
```

- [ ] **Step 4: Wire the click handler**

In `static/js/dashboard/dashboard-toolbar.js`, extend the delegated selector and branch (`dashboard-toolbar.js:427-451`):

```js
            const anchor = e.target?.closest?.(
                '.config-link-anchor, .health-link-anchor, .unsorted-link-anchor, .dashboard-link-anchor'
            );
            if (!anchor) return;
            if (e.defaultPrevented || e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            if (anchor.classList.contains('config-link-anchor')) {
                void d.config?.openConfigView?.();
            } else if (anchor.classList.contains('health-link-anchor')) {
                void d.health?.openHealthView?.();
            } else if (anchor.classList.contains('unsorted-link-anchor')) {
                void d.unsorted?.openUnsortedView?.();
            } else {
                void d.pageNav?.requestPageNavigation?.(d.currentPageId);
            }
```

- [ ] **Step 5: Add the Config toggle**

In `static/js/dashboard/dashboard-config.js`, find the existing `inboxEnabled` toggle in the Behavior/General section (search `inboxEnabled` for a `bool('inboxEnabled', ...)` call, following the same shape as `bool('packedColumns', 'config.packedColumnsLabel', 'Pack columns tightly')` seen at `dashboard-config.js:11742`) and add a sibling:

```js
                    bool('unsortedEnabled', 'config.unsortedEnabledLabel', 'Show Unsorted'),
```

- [ ] **Step 6: Run to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/header-shortcuts.spec.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add templates/dashboard.html static/js/dashboard/dashboard-toolbar.js static/js/dashboard/dashboard-config.js tests/header-shortcuts.spec.js
git commit -m "add unsorted nav icon and config toggle"
```

---

### Task 12: Changelog entry

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add the entry**

Per this repo's "every change gets a changelog line" convention, add one line under the current unreleased heading describing the user-visible change: Keep now saves a link permanently to Unsorted instead of only marking it read, plus the new Unsorted widget, view, and nav icon. Match the exact wording style and heading location of the most recent entries already in the file.

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "changelog: unsorted bookmarks"
```

---

## Deferred (explicitly out of scope for this plan)

- Locale translations for the new `dashboard.unsorted*`/`config.unsorted*` keys — a separate translation round, per this project's convention (translate only in a dedicated round, never during feature work).
- `trimInboxItems` respecting `Note`/`Tags`/`SnoozedUntil` for items that stay in the Inbox — noted as a smaller, separate question in the spec's Non-goals.
