package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

/*
Category icons live in the name.

A category used to carry an icon of its own: a glyph or the name of an uploaded
image, drawn in front of the name. The icon is part of the title now -- an
emoji typed in the name, or :file.svg: for an app icon -- so a title is one
thing, and a widget's title can carry an icon the same way.

foldCategoryIcon moves what the field held to the front of the name. It runs
once over every page file at start, and on every save, so an old client or an
imported template cannot bring the field back.
*/

var uploadedIconName = regexp.MustCompile(`(?i)^[a-z0-9][a-z0-9._-]*\.[a-z0-9]+$`)

// foldCategoryIcon returns the category with its icon in front of its name and
// the field empty. A file name becomes :file:, anything else is written as it is.
func foldCategoryIcon(c Category) Category {
	icon := strings.TrimSpace(c.Icon)
	c.Icon = ""
	if icon == "" {
		return c
	}
	if uploadedIconName.MatchString(icon) {
		icon = ":" + icon + ":"
	}
	c.Name = clampEntityName(icon + " " + c.Name)
	return c
}

// migrateCategoryIconsIntoNames folds the icon of every category on every page.
// There is nothing to remember afterwards: a page with no icon left in it is
// not touched, so a second start finds nothing to do.
func (fs *FileStore) migrateCategoryIconsIntoNames() {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	files, err := os.ReadDir(fs.dataDir)
	if err != nil {
		return
	}
	for _, file := range files {
		if file.IsDir() || !strings.HasPrefix(file.Name(), "bookmarks-") || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}
		pageID, ok := parseBookmarkPageIDFromFilename(file.Name())
		if !ok {
			continue
		}
		path := filepath.Join(fs.dataDir, file.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var page PageWithBookmarks
		if json.Unmarshal(data, &page) != nil {
			continue
		}
		changed := false
		for i := range page.Categories {
			if strings.TrimSpace(page.Categories[i].Icon) != "" {
				page.Categories[i] = foldCategoryIcon(page.Categories[i])
				changed = true
			}
		}
		if changed {
			_ = fs.writeStoreJSONFile(path, page, pageID)
		}
	}
	fs.readCache.categories = map[int][]Category{}
}
