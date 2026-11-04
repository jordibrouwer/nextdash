package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

/*
Layout history: the last arrangements of a page, kept so one can be put back.

What is kept is exactly what SavePageBlocks writes -- the page's widgets and the
order its blocks are drawn in. Not the bookmarks, and not the categories: those
carry the links people care about, and rolling a category list back under
bookmarks that have since moved would orphan them. A layout is the part of a
page that is arrangement alone, which is also the part that gets rearranged,
renamed and closed without asking.

A burst of edits is one step: a drag is a handful of saves, and twenty entries
that differ by one place each would push the arrangement worth returning to out
of the list. A snapshot is taken only when the newest one is older than
layoutHistoryBurst, so the entry is the state before the burst began. Restoring
is a save like any other, so the state it replaces is kept too, and a restore
can be undone the same way.

The file holds widget settings, an address with a key in it among them; it is
under the same write token as the page, and it is a cache for backup purposes:
not carried, and removed on restore, because it describes the data that was
replaced.
*/

const (
	layoutHistoryPerPage = 20
	layoutHistoryBurst   = 20 * time.Second
	layoutHistoryFile    = "layout-history.json"
)

// LayoutSnapshot is one earlier arrangement of one page.
type LayoutSnapshot struct {
	ID      string   `json:"id"`
	At      int64    `json:"at"` // Unix milliseconds: when the layout was replaced
	Widgets []Widget `json:"widgets"`
	Order   []string `json:"order"`
}

type layoutHistoryDoc struct {
	// Pages is keyed by page id, newest snapshot first.
	Pages map[string][]LayoutSnapshot `json:"pages"`
}

func layoutHistoryPath(dataDir string) string {
	return filepath.Join(dataDir, layoutHistoryFile)
}

func readLayoutHistory(dataDir string) layoutHistoryDoc {
	var doc layoutHistoryDoc
	if raw, err := os.ReadFile(layoutHistoryPath(dataDir)); err == nil {
		// Derived, disposable data: a file that does not read is an empty history.
		if json.Unmarshal(raw, &doc) != nil {
			doc = layoutHistoryDoc{}
		}
	}
	if doc.Pages == nil {
		doc.Pages = map[string][]LayoutSnapshot{}
	}
	return doc
}

func sameLayout(aWidgets []Widget, aOrder []string, bWidgets []Widget, bOrder []string) bool {
	a, errA := json.Marshal(struct {
		W []Widget
		O []string
	}{aWidgets, aOrder})
	b, errB := json.Marshal(struct {
		W []Widget
		O []string
	}{bWidgets, bOrder})
	return errA == nil && errB == nil && string(a) == string(b)
}

// recordLayoutSnapshot files the layout that was just replaced. force skips the
// burst rule: a restore always keeps what it replaces, so it can be undone.
// Called with the
// store lock held, after the new one was written; a failure here is never the
// caller's failure -- losing a history entry must not lose a save.
func (fs *FileStore) recordLayoutSnapshot(pageID int, widgets []Widget, order []string, force bool) {
	if demoMode() {
		return
	}
	now := time.Now()
	// The burst rule is checked before the file is read: most saves are inside
	// one, and each would otherwise parse the whole history to find that out.
	if !force && now.Sub(fs.layoutLast[pageID]) < layoutHistoryBurst {
		return
	}
	doc := readLayoutHistory(fs.dataDir)
	key := strconv.Itoa(pageID)
	list := doc.Pages[key]
	if !force && len(list) > 0 && now.Sub(time.UnixMilli(list[0].At)) < layoutHistoryBurst {
		return
	}
	if fs.layoutLast == nil {
		fs.layoutLast = map[int]time.Time{}
	}
	fs.layoutLast[pageID] = now
	idBytes := make([]byte, 5)
	if _, err := rand.Read(idBytes); err != nil {
		return
	}
	snapshot := LayoutSnapshot{ID: hex.EncodeToString(idBytes), At: now.UnixMilli(), Widgets: widgets, Order: order}
	list = append([]LayoutSnapshot{snapshot}, list...)
	if len(list) > layoutHistoryPerPage {
		list = list[:layoutHistoryPerPage]
	}
	doc.Pages[key] = list
	if err := writeCompactJSONFile(layoutHistoryPath(fs.dataDir), doc); err != nil {
		logWarn(logComponentStore, "layout history could not be written: %v", err)
	}
}

// LayoutHistory returns a page's snapshots, newest first.
func (fs *FileStore) LayoutHistory(pageID int) []LayoutSnapshot {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()
	return readLayoutHistory(fs.dataDir).Pages[strconv.Itoa(pageID)]
}

// layoutHistoryEntry is what the list shows: no widget content, only what
// restoring that entry would change against what the page holds now.
type layoutHistoryEntry struct {
	ID        string   `json:"id"`
	At        int64    `json:"at"`
	Widgets   int      `json:"widgets"`
	Brings    []string `json:"brings,omitempty"`    // widgets that are not on the page now, and would come back
	Removes   []string `json:"removes,omitempty"`   // widgets on the page now that this layout does not have
	Reordered bool     `json:"reordered,omitempty"` // the blocks would stand in another order
	Changed   bool     `json:"changed"`             // false: identical to the page now
}

func layoutName(w Widget) string {
	if w.Title != "" {
		return w.Title
	}
	return string(w.Type)
}

func describeLayout(snapshot LayoutSnapshot, nowWidgets []Widget, nowOrder []string) layoutHistoryEntry {
	entry := layoutHistoryEntry{ID: snapshot.ID, At: snapshot.At, Widgets: len(snapshot.Widgets)}
	have := map[string]Widget{}
	for _, w := range nowWidgets {
		have[w.ID] = w
	}
	then := map[string]Widget{}
	for _, w := range snapshot.Widgets {
		then[w.ID] = w
		if _, ok := have[w.ID]; !ok {
			entry.Brings = append(entry.Brings, layoutName(w))
		}
	}
	for _, w := range nowWidgets {
		if _, ok := then[w.ID]; !ok {
			entry.Removes = append(entry.Removes, layoutName(w))
		}
	}
	entry.Reordered = !sameStrings(snapshot.Order, nowOrder)
	entry.Changed = !sameLayout(snapshot.Widgets, snapshot.Order, nowWidgets, nowOrder)
	return entry
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// LayoutHistoryHandler answers GET /api/pages/{id}/layout-history.
func (h *Handlers) LayoutHistoryHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageID, ok := pageIDFromRequest(r)
	if !ok || !h.pageExists(pageID) {
		http.Error(w, "No such page", http.StatusNotFound)
		return
	}
	nowWidgets, nowOrder := h.store.GetPageBlocks(pageID)
	entries := []layoutHistoryEntry{}
	for _, snapshot := range h.store.LayoutHistory(pageID) {
		entries = append(entries, describeLayout(snapshot, nowWidgets, nowOrder))
	}
	writeJSON(w, map[string]any{"pageId": pageID, "entries": entries})
}

// RestoreLayoutHandler answers POST /api/pages/{id}/layout-history/{snapshot}/restore.
func (h *Handlers) RestoreLayoutHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageID, ok := pageIDFromRequest(r)
	if !ok || !h.pageExists(pageID) {
		http.Error(w, "No such page", http.StatusNotFound)
		return
	}
	id := mux.Vars(r)["snapshot"]
	var found *LayoutSnapshot
	for _, snapshot := range h.store.LayoutHistory(pageID) {
		if snapshot.ID == id {
			s := snapshot
			found = &s
			break
		}
	}
	if found == nil {
		http.Error(w, "No such layout", http.StatusNotFound)
		return
	}
	widgets := found.Widgets
	if widgets == nil {
		widgets = []Widget{}
	}
	// The tiles answer from a cache keyed by widget; a custom one restored with
	// another address would otherwise show the old address's answer until it ran out.
	for _, widget := range widgets {
		if widget.Type == WidgetTypeCustom {
			customWidgetForget(strconv.Itoa(pageID) + ":" + widget.ID)
		}
	}
	// A save like any other: the layout it replaces is kept as the newest entry.
	if err := h.store.RestoreLayout(pageID, widgets, found.Order); err != nil {
		respondStorePersistError(w, err)
		return
	}
	savedWidgets, savedOrder := h.store.GetPageBlocks(pageID)
	if savedWidgets == nil {
		savedWidgets = []Widget{}
	}
	writeJSON(w, PageBlocksResponse{PageID: pageID, Widgets: savedWidgets, Order: savedOrder})
}

// RestoreLayout saves an earlier layout back, and keeps the one it replaces.
func (fs *FileStore) RestoreLayout(pageID int, widgets []Widget, order []string) error {
	return fs.savePageBlocks(pageID, widgets, order, true)
}

// forgetLayoutHistory drops a page's history, for a page that is deleted: its
// widget settings (an address may carry a key) have no reason to outlive it, and
// a later page that is given the same id must not inherit them. Store lock held.
func (fs *FileStore) forgetLayoutHistory(pageID int) {
	delete(fs.layoutLast, pageID)
	doc := readLayoutHistory(fs.dataDir)
	key := strconv.Itoa(pageID)
	if _, ok := doc.Pages[key]; !ok {
		return
	}
	delete(doc.Pages, key)
	if len(doc.Pages) == 0 {
		_ = os.Remove(layoutHistoryPath(fs.dataDir))
		return
	}
	if err := writeCompactJSONFile(layoutHistoryPath(fs.dataDir), doc); err != nil {
		logWarn(logComponentStore, "layout history could not be written: %v", err)
	}
}
