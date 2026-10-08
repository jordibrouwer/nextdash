package app

import (
	"encoding/json"
	"os"
)

// storeReadCache holds in-memory copies of frequently read JSON files so the
// dashboard shell and API handlers do not re-read and unmarshal from disk on
// every request. Invalidated on any data mutation (noteDataMutation).
type storeReadCache struct {
	settings       Settings
	settingsOK     bool
	pages          []Page
	pagesOK        bool
	bookmarks      map[int][]Bookmark
	categories     map[int][]Category
	allBookmarks   []Bookmark
	allBookmarksOK bool
	finders        []Finder
	findersOK      bool
	colors         ColorTheme
	colorsOK       bool
	pageOrder      []int
	pageOrderOK    bool
	revision       string
	revisionOK     bool
}

func newStoreReadCache() storeReadCache {
	return storeReadCache{
		bookmarks:  make(map[int][]Bookmark),
		categories: make(map[int][]Category),
	}
}

func (fs *FileStore) ensureReadCacheMaps() {
	if fs.readCache.bookmarks == nil {
		fs.readCache.bookmarks = make(map[int][]Bookmark)
	}
	if fs.readCache.categories == nil {
		fs.readCache.categories = make(map[int][]Category)
	}
}

func (fs *FileStore) InvalidateReadCache() {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	fs.invalidateReadCache()
}

// ReplaceDataFiles runs a restore's file writes under the store lock and drops
// the read caches after, so no store write can interleave with it: a click
// that read a page before the restore cannot write it back after.
func (fs *FileStore) ReplaceDataFiles(write func() error) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	defer fs.invalidateReadCache()
	return write()
}

func (fs *FileStore) invalidateReadCache() {
	fs.readCache = newStoreReadCache()
}

// noteDataMutation invalidates the cache after a write. pageID narrows it to
// that page's bookmarks/categories when the write cannot have touched
// anything else; pass 0 for a write whose scope isn't a single page (settings,
// colors, finders, page order, page create/delete) to invalidate everything,
// matching the old behavior.
//
// allBookmarks, pages and page order stay cleared unconditionally even for a
// scoped write: GetPages() derives the list from bookmarks-N.json files on
// disk (see getPages), and GetAllBookmarks() aggregates every page, so a
// single page's write can change what either of those report. Only the
// per-page bookmarks/categories entries for *other* pages are the ones a
// scoped write can safely leave alone.
func (fs *FileStore) noteDataMutation(pageID int) {
	/*
		Bumped first, and for every write.

		This is the one place every mutation passes through, which is what
		makes it the right place to count them: a cache elsewhere in the
		program -- the health report is the one that needed it -- can hold the
		generation it was built from and know it is stale without every write
		path having to remember to say so. Invalidating from the call sites was
		the other option, and adding a bookmark was already the path that
		forgot.
	*/
	fs.dataGeneration++
	if pageID <= 0 {
		fs.invalidateReadCache()
		return
	}
	fs.readCache.allBookmarksOK = false
	fs.readCache.pagesOK = false
	fs.readCache.pageOrderOK = false
	fs.readCache.revisionOK = false
	delete(fs.readCache.bookmarks, pageID)
	delete(fs.readCache.categories, pageID)
}

func (fs *FileStore) writeStoreJSONFile(path string, v any, pageID int) error {
	if demoMode() {
		if page, ok := pageFileValue(v); ok {
			if err := demoCheckPageWrite(path, page); err != nil {
				return err
			}
		}
		v = withoutNewDemoChecks(path, v)
	}
	if err := writeIndentJSONFile(path, v); err != nil {
		return err
	}
	fs.noteDataMutation(pageID)
	return nil
}

func cloneBookmarks(in []Bookmark) []Bookmark {
	if len(in) == 0 {
		return []Bookmark{}
	}
	out := make([]Bookmark, len(in))
	copy(out, in)
	return out
}

func cloneCategories(in []Category) []Category {
	if len(in) == 0 {
		return []Category{}
	}
	out := make([]Category, len(in))
	copy(out, in)
	return out
}

func clonePages(in []Page) []Page {
	if len(in) == 0 {
		return []Page{}
	}
	out := make([]Page, len(in))
	copy(out, in)
	return out
}

func cloneFinders(in []Finder) []Finder {
	if len(in) == 0 {
		return []Finder{}
	}
	out := make([]Finder, len(in))
	copy(out, in)
	return out
}

func clonePageOrder(in []int) []int {
	if len(in) == 0 {
		return []int{}
	}
	out := make([]int, len(in))
	copy(out, in)
	return out
}

/*
DataGeneration reports how many writes this store has seen.

Compared for equality by callers that cache something derived from the data;
the value itself carries no meaning and is not persisted, so it starts at nought
again on a restart -- which is correct, because the caches that read it start
empty then too.
*/
func (fs *FileStore) DataGeneration() uint64 {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()
	return fs.dataGeneration
}

/*
withoutNewDemoChecks keeps a page write in the demo from switching checking
on: a bookmark may keep the Periodic or Monitor it already had on disk (the
seeded monitors, whose history is a picture the demo shows), and loses any it
did not have. Here, where every page write passes, rather than in each handler
that can set it. The demo checks no site either way; this is what keeps the
switches honest.
*/
func withoutNewDemoChecks(path string, v any) any {
	page, ok := pageFileValue(v)
	if !ok {
		return v
	}
	had := map[string][2]bool{}
	if data, err := os.ReadFile(path); err == nil {
		var before PageWithBookmarks
		if json.Unmarshal(data, &before) == nil {
			for _, b := range before.Bookmarks {
				had[canonicalBookmarkURLKey(b.URL)] = [2]bool{b.CheckStatus, b.Monitor}
			}
		}
	}
	bookmarks := make([]Bookmark, len(page.Bookmarks))
	copy(bookmarks, page.Bookmarks)
	for i := range bookmarks {
		prior := had[canonicalBookmarkURLKey(bookmarks[i].URL)]
		bookmarks[i].CheckStatus = bookmarks[i].CheckStatus && prior[0]
		bookmarks[i].Monitor = bookmarks[i].Monitor && prior[1]
	}
	page.Bookmarks = bookmarks
	return page
}

// pageFileValue is v as a page file, if it is one.
func pageFileValue(v any) (PageWithBookmarks, bool) {
	switch typed := v.(type) {
	case PageWithBookmarks:
		return typed, true
	case *PageWithBookmarks:
		return *typed, true
	}
	return PageWithBookmarks{}, false
}
