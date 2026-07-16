package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var ErrInboxItemNotFound = errors.New("inbox item not found")

const inboxDataVersion = 1

// InboxLink is a lightweight saved URL (not a full bookmark).
type InboxLink struct {
	ID           string   `json:"id"`
	URL          string   `json:"url"`
	Title        string   `json:"title,omitempty"`
	AddedAt      int64    `json:"addedAt"`
	Source       string   `json:"source,omitempty"`
	PreviewTitle string   `json:"previewTitle,omitempty"`
	PreviewDesc  string   `json:"previewDesc,omitempty"`
	PreviewImage string   `json:"previewImage,omitempty"`
	Note         string   `json:"note,omitempty"`
	Tags         []string `json:"tags,omitempty"`
	Domain       string   `json:"domain,omitempty"`
	ReadAt       int64    `json:"readAt,omitempty"`
	// SnoozedUntil hides the item from the main list until this time (Unix ms).
	// 0 means not snoozed. No server-side timer is needed — the client re-surfaces
	// the item once now passes this value.
	SnoozedUntil int64 `json:"snoozedUntil,omitempty"`
}

// InboxData is persisted at data/inbox.json.
type InboxData struct {
	Version int         `json:"version"`
	Items   []InboxLink `json:"items"`
}

func inboxFilePath(dataDir string) string {
	return filepath.Join(dataDir, "inbox.json")
}

func (fs *FileStore) inboxFile() string {
	return inboxFilePath(fs.dataDir)
}

func normalizePasteDestination(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "bookmark", "inbox":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "ask"
	}
}

func generateInboxID() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("inl_%d", time.Now().UnixNano())
	}
	return "inl_" + hex.EncodeToString(buf)
}

func inboxDomainFromURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Hostname()
}

func sortInboxItemsNewestFirst(items []InboxLink) {
	sort.Slice(items, func(i, j int) bool {
		return items[i].AddedAt > items[j].AddedAt
	})
}

func (fs *FileStore) readInboxDataLocked() InboxData {
	data, err := os.ReadFile(fs.inboxFile())
	if err != nil {
		return InboxData{Version: inboxDataVersion, Items: []InboxLink{}}
	}
	var inbox InboxData
	if err := json.Unmarshal(data, &inbox); err != nil || inbox.Items == nil {
		return InboxData{Version: inboxDataVersion, Items: []InboxLink{}}
	}
	if inbox.Version == 0 {
		inbox.Version = inboxDataVersion
	}
	return inbox
}

func (fs *FileStore) saveInboxDataLocked(inbox InboxData) error {
	if inbox.Version == 0 {
		inbox.Version = inboxDataVersion
	}
	if inbox.Items == nil {
		inbox.Items = []InboxLink{}
	}
	return writeIndentJSONFile(fs.inboxFile(), inbox)
}

func trimInboxItems(items []InboxLink, maxItems int) []InboxLink {
	if maxItems <= 0 || len(items) <= maxItems {
		return items
	}
	sortInboxItemsNewestFirst(items)
	return items[:maxItems]
}

func (fs *FileStore) GetInboxItems() []InboxLink {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	inbox := fs.readInboxDataLocked()
	items := append([]InboxLink(nil), inbox.Items...)
	sortInboxItemsNewestFirst(items)
	return items
}

func (fs *FileStore) AddInboxLink(link InboxLink, dedupe bool, maxItems int) (InboxLink, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	inbox := fs.readInboxDataLocked()
	urlKey := canonicalBookmarkURLKey(link.URL)
	if urlKey == "" {
		return InboxLink{}, fmt.Errorf("invalid inbox url")
	}

	if dedupe {
		for _, existing := range inbox.Items {
			if canonicalBookmarkURLKey(existing.URL) == urlKey {
				return existing, ErrInboxDuplicateURL
			}
		}
	}

	if strings.TrimSpace(link.ID) == "" {
		link.ID = generateInboxID()
	}
	if link.AddedAt == 0 {
		link.AddedAt = time.Now().UnixMilli()
	}
	link.URL = strings.TrimSpace(link.URL)
	link.Domain = inboxDomainFromURL(link.URL)
	if strings.TrimSpace(link.Title) == "" {
		if domain := link.Domain; domain != "" {
			link.Title = domain
		} else {
			link.Title = link.URL
		}
	}
	link.Tags = normalizeTags(link.Tags)

	inbox.Items = append(inbox.Items, link)
	inbox.Items = trimInboxItems(inbox.Items, maxItems)
	if err := fs.saveInboxDataLocked(inbox); err != nil {
		return InboxLink{}, err
	}
	return link, nil
}

var ErrInboxDuplicateURL = errors.New("inbox duplicate url")

func (fs *FileStore) DeleteInboxLink(id string) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	id = strings.TrimSpace(id)
	if id == "" {
		return ErrInboxItemNotFound
	}

	inbox := fs.readInboxDataLocked()
	next := make([]InboxLink, 0, len(inbox.Items))
	found := false
	for _, item := range inbox.Items {
		if item.ID == id {
			found = true
			continue
		}
		next = append(next, item)
	}
	if !found {
		return ErrInboxItemNotFound
	}
	inbox.Items = next
	return fs.saveInboxDataLocked(inbox)
}

func (fs *FileStore) RestoreInboxLink(link InboxLink, maxItems int) (InboxLink, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	id := strings.TrimSpace(link.ID)
	if id == "" {
		return InboxLink{}, fmt.Errorf("invalid inbox id")
	}

	inbox := fs.readInboxDataLocked()
	for _, existing := range inbox.Items {
		if existing.ID == id {
			return existing, nil
		}
	}

	link.ID = id
	link.URL = strings.TrimSpace(link.URL)
	if link.URL == "" {
		return InboxLink{}, fmt.Errorf("invalid inbox url")
	}
	if link.AddedAt == 0 {
		link.AddedAt = time.Now().UnixMilli()
	}
	link.Domain = inboxDomainFromURL(link.URL)
	if strings.TrimSpace(link.Title) == "" {
		if domain := link.Domain; domain != "" {
			link.Title = domain
		} else {
			link.Title = link.URL
		}
	}
	link.Tags = normalizeTags(link.Tags)

	inbox.Items = append([]InboxLink{link}, inbox.Items...)
	inbox.Items = trimInboxItems(inbox.Items, maxItems)
	if err := fs.saveInboxDataLocked(inbox); err != nil {
		return InboxLink{}, err
	}
	return link, nil
}

func (fs *FileStore) UpdateInboxLink(id string, mutate func(*InboxLink) error) (InboxLink, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	id = strings.TrimSpace(id)
	if id == "" {
		return InboxLink{}, ErrInboxItemNotFound
	}

	inbox := fs.readInboxDataLocked()
	for i := range inbox.Items {
		if inbox.Items[i].ID != id {
			continue
		}
		if mutate != nil {
			if err := mutate(&inbox.Items[i]); err != nil {
				return InboxLink{}, err
			}
		}
		if err := fs.saveInboxDataLocked(inbox); err != nil {
			return InboxLink{}, err
		}
		return inbox.Items[i], nil
	}
	return InboxLink{}, ErrInboxItemNotFound
}
