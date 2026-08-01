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

func (fs *FileStore) noteDataMutation() {
	fs.invalidateReadCache()
}

func (fs *FileStore) writeStoreJSONFile(path string, v any) error {
	if err := writeIndentJSONFile(path, v); err != nil {
		return err
	}
	fs.noteDataMutation()
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
