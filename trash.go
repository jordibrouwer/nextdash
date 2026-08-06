package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var ErrTrashItemNotFound = errors.New("trash item not found")

const trashDataVersion = 1

// trashRetention matches health history: long enough that "I noticed a week
// later" is still recoverable, short enough that the file stays small.
const trashRetention = 30 * 24 * time.Hour

// trashMaxItems caps the file independently of age. A bulk delete of a filtered
// tag view can drop hundreds of bookmarks at once, and without a cap a single
// mistake would leave the trash larger than the bookmarks it shadows.
const trashMaxItems = 500

// TrashedBookmark is a deleted bookmark plus everything needed to put it back
// where it was.
//
// Index is the position the bookmark held on its page at delete time. It is a
// hint, not a guarantee: bookmarks around it may have moved or been deleted
// before the restore happens, so restore clamps it into range rather than
// trusting it. Storing it is still worth it — restoring a bookmark to the
// bottom of a 60-row page when it was third is technically a restore and
// practically a loss.
type TrashedBookmark struct {
	ID        string   `json:"id"`
	DeletedAt int64    `json:"deletedAt"`
	PageID    int      `json:"pageId"`
	Index     int      `json:"index"`
	Bookmark  Bookmark `json:"bookmark"`
	// PageName is captured at delete time so the trash list can name the origin
	// page even after it is renamed or deleted. Restoring to a page that no
	// longer exists is refused, and this is what lets the UI say which page that
	// was.
	PageName string `json:"pageName,omitempty"`
	// Source records what deleted it (dashboard, health, config, bulk) purely so
	// the list can be read back sensibly. It carries no behaviour.
	Source string `json:"source,omitempty"`
}

// TrashData is persisted at data/trash.json.
type TrashData struct {
	Version int               `json:"version"`
	Items   []TrashedBookmark `json:"items"`
}

func trashFilePath(dataDir string) string {
	return filepath.Join(dataDir, "trash.json")
}

func (fs *FileStore) trashFile() string {
	return trashFilePath(fs.dataDir)
}

func generateTrashID() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("trs_%d", time.Now().UnixNano())
	}
	return "trs_" + hex.EncodeToString(buf)
}

func sortTrashNewestFirst(items []TrashedBookmark) {
	sort.Slice(items, func(i, j int) bool {
		return items[i].DeletedAt > items[j].DeletedAt
	})
}

func (fs *FileStore) readTrashDataLocked() TrashData {
	data, err := os.ReadFile(fs.trashFile())
	if err != nil {
		return TrashData{Version: trashDataVersion, Items: []TrashedBookmark{}}
	}
	var trash TrashData
	if err := json.Unmarshal(data, &trash); err != nil || trash.Items == nil {
		return TrashData{Version: trashDataVersion, Items: []TrashedBookmark{}}
	}
	if trash.Version == 0 {
		trash.Version = trashDataVersion
	}
	return trash
}

func (fs *FileStore) saveTrashDataLocked(trash TrashData) error {
	if trash.Version == 0 {
		trash.Version = trashDataVersion
	}
	if trash.Items == nil {
		trash.Items = []TrashedBookmark{}
	}
	return fs.writeStoreJSONFile(fs.trashFile(), trash)
}

// pruneTrashItems drops everything past the retention window, then caps what is
// left to the newest trashMaxItems.
//
// Age is applied before the cap so a burst of deletions cannot push out older
// items that are still inside their 30 days while itself being expired.
func pruneTrashItems(items []TrashedBookmark, now time.Time) []TrashedBookmark {
	cutoff := now.Add(-trashRetention).UnixMilli()
	kept := make([]TrashedBookmark, 0, len(items))
	for _, item := range items {
		if item.DeletedAt >= cutoff {
			kept = append(kept, item)
		}
	}
	sortTrashNewestFirst(kept)
	if len(kept) > trashMaxItems {
		kept = kept[:trashMaxItems]
	}
	return kept
}

// GetTrashItems returns the trash newest-first, without pruning.
//
// Reads stay read-only so a plain GET never writes to disk; expiry is applied
// at startup and on every write instead. An item a few minutes past its cutoff
// may therefore still be listed, which is harmless — it is still restorable.
func (fs *FileStore) GetTrashItems() []TrashedBookmark {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	trash := fs.readTrashDataLocked()
	// Never nil: the JSON handler would emit `null`, and a client doing
	// `items.length` on that throws rather than showing an empty trash.
	items := make([]TrashedBookmark, 0, len(trash.Items))
	items = append(items, trash.Items...)
	sortTrashNewestFirst(items)
	return items
}

// AddTrashedBookmarks records deleted bookmarks. A bulk delete arrives as one
// call so the file is written once rather than once per bookmark.
func (fs *FileStore) AddTrashedBookmarks(entries []TrashedBookmark) error {
	if len(entries) == 0 {
		return nil
	}

	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	trash := fs.readTrashDataLocked()
	now := time.Now()
	for _, entry := range entries {
		if strings.TrimSpace(entry.Bookmark.URL) == "" && strings.TrimSpace(entry.Bookmark.Name) == "" {
			continue
		}
		if entry.ID == "" {
			entry.ID = generateTrashID()
		}
		if entry.DeletedAt == 0 {
			entry.DeletedAt = now.UnixMilli()
		}
		if entry.Index < 0 {
			entry.Index = 0
		}
		trash.Items = append(trash.Items, entry)
	}
	trash.Items = pruneTrashItems(trash.Items, now)
	return fs.saveTrashDataLocked(trash)
}

// TakeTrashItem removes an item from the trash and returns it, so the caller can
// write it back onto its page.
//
// Taking and restoring are deliberately separate: restoring touches
// bookmarks-N.json, which is guarded by the same mutex this method holds. Doing
// both here would either deadlock or force the bookmark write to bypass the
// normal store path.
func (fs *FileStore) TakeTrashItem(id string) (TrashedBookmark, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	trash := fs.readTrashDataLocked()
	for i, item := range trash.Items {
		if item.ID != id {
			continue
		}
		trash.Items = append(trash.Items[:i:i], trash.Items[i+1:]...)
		if err := fs.saveTrashDataLocked(trash); err != nil {
			return TrashedBookmark{}, err
		}
		return item, nil
	}
	return TrashedBookmark{}, ErrTrashItemNotFound
}

// DeleteTrashItem removes a single item permanently.
func (fs *FileStore) DeleteTrashItem(id string) error {
	_, err := fs.TakeTrashItem(id)
	return err
}

// EmptyTrash discards every item permanently and reports how many went.
func (fs *FileStore) EmptyTrash() (int, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	trash := fs.readTrashDataLocked()
	count := len(trash.Items)
	if count == 0 {
		return 0, nil
	}
	trash.Items = []TrashedBookmark{}
	if err := fs.saveTrashDataLocked(trash); err != nil {
		return 0, err
	}
	return count, nil
}

// PruneTrash applies retention and reports how many items it dropped. Called at
// startup, where an instance that has been off for a month is the case that
// matters — nothing else would expire those items, since expiry otherwise rides
// along with writes.
func (fs *FileStore) PruneTrash() (int, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	trash := fs.readTrashDataLocked()
	before := len(trash.Items)
	trash.Items = pruneTrashItems(trash.Items, time.Now())
	removed := before - len(trash.Items)
	if removed == 0 {
		return 0, nil
	}
	if err := fs.saveTrashDataLocked(trash); err != nil {
		return 0, err
	}
	return removed, nil
}
