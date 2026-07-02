package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAutoHealSuggestDoesNotBlockStoreReads(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		http.Redirect(w, r, "/new", http.StatusFound)
	}))
	defer slow.Close()

	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{"allowLocalBookmarks":true}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	pagePath := filepath.Join(dir, "bookmarks-1.json")
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[{"name":"Slow","url":"` + slow.URL + `/old","checkStatus":true}]}`
	if err := os.WriteFile(pagePath, []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	store := &FileStore{
		settingsFile: settingsPath,
		dataDir:      dir,
	}
	h := &Handlers{store: store}

	done := make(chan struct{})
	var reads int32
	go func() {
		defer close(done)
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			_ = h.buildBookmarkHealthReport()
			atomic.AddInt32(&reads, 1)
		}
	}()

	req := httptest.NewRequest(http.MethodGet, "/api/health/auto-heal-suggest?pageId=1&index=0&redirectOnly=1", nil)
	rec := httptest.NewRecorder()
	h.AutoHealSuggest(rec, req)

	<-done
	if rec.Code != http.StatusOK {
		t.Fatalf("AutoHealSuggest status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if atomic.LoadInt32(&reads) < 5 {
		t.Fatalf("store reads stalled during redirect suggest: got %d reads in 2s", reads)
	}
}

func TestAutoHealApplyValidatesURLBeforeStoreLock(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{"allowLocalBookmarks":true}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	pagePath := filepath.Join(dir, "bookmarks-1.json")
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[{"name":"Example","url":"https://example.com/old"}]}`
	if err := os.WriteFile(pagePath, []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	store := &FileStore{
		settingsFile: settingsPath,
		dataDir:      dir,
	}
	h := &Handlers{store: store}

	req := httptest.NewRequest(http.MethodPost, "/api/health/auto-heal-apply", strings.NewReader(`{"pageId":1,"index":0,"newUrl":"https://example.com/new","refreshTitle":false}`))
	rec := httptest.NewRecorder()
	h.AutoHealApply(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("AutoHealApply status = %d, body = %s", rec.Code, rec.Body.String())
	}

	bookmarks := store.GetBookmarksByPage(1)
	if len(bookmarks) != 1 || bookmarks[0].URL != "https://example.com/new" {
		t.Fatalf("bookmark URL = %q, want https://example.com/new", bookmarks[0].URL)
	}
}
