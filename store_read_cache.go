package main

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
