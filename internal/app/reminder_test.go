package app

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestReminderPushMessage(t *testing.T) {
	now := time.Now()
	one, ok := reminderPushMessage([]dueReminder{{Name: "Plex", URL: "https://plex.lan"}}, now)
	if !ok || one.Title != "Reminder: Plex" || one.Kind != "reminder" {
		t.Fatalf("single: %+v ok=%v", one, ok)
	}
	many, ok := reminderPushMessage([]dueReminder{{Name: "A"}, {Name: "B"}, {Name: "C"}, {Name: "D"}}, now)
	if !ok || many.Title != "4 reminders" || many.Body != "A, B, C and 1 more" {
		t.Fatalf("many: %+v ok=%v", many, ok)
	}
	if _, ok := reminderPushMessage([]dueReminder{{Name: "Old", Stale: true}}, now); ok {
		t.Fatal("a stale reminder must not be pushed")
	}
	mixed, _ := reminderPushMessage([]dueReminder{{Name: "Old", Stale: true}, {Name: "New"}}, now)
	if mixed.Title != "Reminder: New" {
		t.Fatalf("stale ones are left out of the push: %+v", mixed)
	}
}

func TestPageSaveNeverChangesAReminder(t *testing.T) {
	stored := []Bookmark{{Name: "A", URL: "https://a.example/", RemindAt: 100, RemindSentAt: 200}}
	// A tab that holds the page from before the reminder was answered or moved.
	stale := []Bookmark{{Name: "A", URL: "https://a.example/", RemindAt: 50, RemindSentAt: 999}}
	carryServerOwnedBookmarkFields(stale, stored)
	if stale[0].RemindAt != 100 || stale[0].RemindSentAt != 200 {
		t.Fatalf("a page save must put back the stored reminder: %+v", stale[0])
	}
	cleared := []Bookmark{{Name: "A", URL: "https://a.example/"}}
	carryServerOwnedBookmarkFields(cleared, stored)
	if cleared[0].RemindAt != 100 || cleared[0].RemindSentAt != 200 {
		t.Fatalf("a page save without the field must not clear it: %+v", cleared[0])
	}
	// The address was edited: the row at the same place keeps its reminder and
	// does not get it pushed again.
	edited := []Bookmark{{Name: "A", URL: "https://a-fixed.example/", RemindAt: 100}}
	carryServerOwnedBookmarkFields(edited, stored)
	if edited[0].RemindAt != 100 || edited[0].RemindSentAt != 200 {
		t.Fatalf("an edited address keeps the reminder and its sent mark: %+v", edited[0])
	}
}

func TestPatchFieldsResetRemindSent(t *testing.T) {
	row := Bookmark{Name: "A", URL: "https://a.example/", RemindAt: 100, RemindSentAt: 200}
	fields := func(s string) map[string]json.RawMessage {
		m := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(s), &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	future := time.Now().Add(time.Hour).UnixMilli()
	next, err := mergeBookmarkFields(row, fields(`{"remindAt":`+strconv.FormatInt(future, 10)+`}`))
	if err != nil || next.RemindAt != future || next.RemindSentAt != 0 {
		t.Fatalf("new time: %+v err=%v", next, err)
	}
	next, _ = mergeBookmarkFields(row, fields(`{"name":"B"}`))
	if next.RemindAt != 100 || next.RemindSentAt != 200 {
		t.Fatalf("an unrelated field must leave the reminder alone: %+v", next)
	}
	next, _ = mergeBookmarkFields(row, fields(`{"remindSentAt":0}`))
	if next.RemindSentAt != 200 {
		t.Fatalf("a client cannot set remindSentAt: %+v", next)
	}
	past := time.Now().Add(-time.Hour).UnixMilli()
	next, _ = mergeBookmarkFields(row, fields(`{"remindAt":`+strconv.FormatInt(past, 10)+`}`))
	if next.RemindAt != past || next.RemindSentAt == 0 {
		t.Fatalf("a past time (undo) is due at once but not pushed again: %+v", next)
	}
	next, _ = mergeBookmarkFields(row, fields(`{"remindAt":-5}`))
	if next.RemindAt != 0 || next.RemindSentAt != 0 {
		t.Fatalf("negative is no reminder: %+v", next)
	}
	next, _ = mergeBookmarkFields(row, fields(`{"remindAt":0}`))
	if next.RemindAt != 0 || next.RemindSentAt != 0 {
		t.Fatalf("cleared: %+v", next)
	}
}

func TestMarkDueRemindersMarksOnce(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	store := NewStore()
	h := NewHandlers(store, nil)
	pages := store.GetPages()
	if len(pages) == 0 {
		t.Skip("no page in a fresh store")
	}
	pid := pages[0].ID
	now := time.Now()
	ms := func(d time.Duration) int64 { return now.Add(d).UnixMilli() }
	rows := []Bookmark{
		{Name: "due", URL: "https://due.example/", RemindAt: ms(-time.Minute)},
		{Name: "ahead", URL: "https://ahead.example/", RemindAt: ms(time.Hour)},
		{Name: "old", URL: "https://old.example/", RemindAt: ms(-30 * 24 * time.Hour)},
		{Name: "sent", URL: "https://sent.example/", RemindAt: ms(-time.Hour), RemindSentAt: ms(-30 * time.Minute)},
		{Name: "none", URL: "https://none.example/"},
	}
	if err := store.SaveBookmarksByPage(pid, rows); err != nil {
		t.Fatal(err)
	}
	if !h.reminderPending(now.UnixMilli()) {
		t.Fatal("two reminders wait for their push")
	}
	got := h.markDueReminders(now)
	names := []string{}
	stale := map[string]bool{}
	for _, d := range got {
		names = append(names, d.Name)
		stale[d.Name] = d.Stale
	}
	if strings.Join(names, ",") != "due,old" || stale["due"] || !stale["old"] {
		t.Fatalf("marked %v (stale %v), want due (fresh) and old (stale)", names, stale)
	}
	if again := h.markDueReminders(now); len(again) != 0 {
		t.Fatalf("a second pass marked %v: a reminder is pushed once", again)
	}
	if h.reminderPending(now.UnixMilli()) {
		t.Fatal("nothing waits after the pass")
	}
	for _, b := range store.GetAllBookmarks() {
		if b.Name == "ahead" && b.RemindSentAt != 0 {
			t.Fatal("a reminder still ahead must stay unsent")
		}
	}
}
