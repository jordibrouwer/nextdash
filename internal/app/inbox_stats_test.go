package app

import (
	"path/filepath"
	"testing"
	"time"
)

func newInboxStatsTestStore(t *testing.T) *FileStore {
	t.Helper()
	dir := t.TempDir()
	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	store.initializeDefaultFiles()
	return store
}

func TestRecordInboxEventCounters(t *testing.T) {
	store := newInboxStatsTestStore(t)

	store.RecordInboxEvent(InboxEvent{Type: inboxEventAdded, Source: "paste"})
	store.RecordInboxEvent(InboxEvent{Type: inboxEventAdded, Source: "extension"})
	store.RecordInboxEvent(InboxEvent{Type: inboxEventPromoted, RetentionMs: 2 * 86400000})
	store.RecordInboxEvent(InboxEvent{Type: inboxEventDeleted, RetentionMs: 4 * 86400000})
	store.RecordInboxEvent(InboxEvent{Type: inboxEventKept})

	stats := store.GetInboxStats()
	if stats.TotalAdded != 2 {
		t.Fatalf("TotalAdded = %d, want 2", stats.TotalAdded)
	}
	if stats.TotalPromoted != 1 {
		t.Fatalf("TotalPromoted = %d, want 1", stats.TotalPromoted)
	}
	if stats.TotalDeleted != 1 {
		t.Fatalf("TotalDeleted = %d, want 1", stats.TotalDeleted)
	}
	if stats.TotalKept != 1 {
		t.Fatalf("TotalKept = %d, want 1", stats.TotalKept)
	}
	if stats.BySource["paste"] != 1 || stats.BySource["extension"] != 1 {
		t.Fatalf("BySource = %+v", stats.BySource)
	}
	if stats.RetentionCount != 2 {
		t.Fatalf("RetentionCount = %d, want 2", stats.RetentionCount)
	}
	wantSum := int64(6 * 86400000)
	if stats.SumRetentionMs != wantSum {
		t.Fatalf("SumRetentionMs = %d, want %d", stats.SumRetentionMs, wantSum)
	}
	if stats.FirstEventAt == 0 {
		t.Fatal("FirstEventAt should be set")
	}
}

func TestRecordInboxEventIgnoresUnknownType(t *testing.T) {
	store := newInboxStatsTestStore(t)
	store.RecordInboxEvent(InboxEvent{Type: "bogus"})
	stats := store.GetInboxStats()
	if stats.TotalAdded != 0 || stats.FirstEventAt != 0 {
		t.Fatalf("unknown event should be ignored, got %+v", stats)
	}
}

func TestRecordInboxEventDailyBuckets(t *testing.T) {
	store := newInboxStatsTestStore(t)
	now := time.Now().UnixMilli()
	yesterday := time.Now().AddDate(0, 0, -1).UnixMilli()

	store.RecordInboxEvent(InboxEvent{Type: inboxEventAdded, AtMs: now})
	store.RecordInboxEvent(InboxEvent{Type: inboxEventPromoted, AtMs: now})
	store.RecordInboxEvent(InboxEvent{Type: inboxEventAdded, AtMs: yesterday})

	stats := store.GetInboxStats()
	if len(stats.DailyBuckets) != 2 {
		t.Fatalf("expected 2 daily buckets, got %d (%+v)", len(stats.DailyBuckets), stats.DailyBuckets)
	}
	todayKey := time.UnixMilli(now).UTC().Format("2006-01-02")
	if b := stats.DailyBuckets[todayKey]; b.Added != 1 || b.Promoted != 1 {
		t.Fatalf("today bucket = %+v, want Added=1 Promoted=1", b)
	}
}

func TestRecordInboxEventPrunesOldBuckets(t *testing.T) {
	store := newInboxStatsTestStore(t)
	old := time.Now().AddDate(0, 0, -(inboxStatsBucketRetentionDays + 10)).UnixMilli()

	store.RecordInboxEvent(InboxEvent{Type: inboxEventAdded, AtMs: old})
	store.RecordInboxEvent(InboxEvent{Type: inboxEventAdded, AtMs: time.Now().UnixMilli()})

	stats := store.GetInboxStats()
	// The old bucket is pruned on write; only the recent bucket survives.
	if len(stats.DailyBuckets) != 1 {
		t.Fatalf("expected old bucket pruned, got %d buckets (%+v)", len(stats.DailyBuckets), stats.DailyBuckets)
	}
	// But the lifetime counter still reflects both adds.
	if stats.TotalAdded != 2 {
		t.Fatalf("TotalAdded = %d, want 2", stats.TotalAdded)
	}
}

func TestGetInboxStatsReturnsCopies(t *testing.T) {
	store := newInboxStatsTestStore(t)
	store.RecordInboxEvent(InboxEvent{Type: inboxEventAdded, Source: "paste"})

	stats := store.GetInboxStats()
	stats.BySource["paste"] = 999
	day := sortedInboxStatBucketDays(stats.DailyBuckets)
	if len(day) > 0 {
		stats.DailyBuckets[day[0]] = InboxDayCounts{Added: 999}
	}

	// Mutating the returned copy must not affect stored state.
	fresh := store.GetInboxStats()
	if fresh.BySource["paste"] != 1 {
		t.Fatalf("stored BySource mutated: %+v", fresh.BySource)
	}
}
