package app

import (
	"net/http"
	"strconv"
	"testing"
	"time"
)

// A move is an add and a delete. The tab's copy may predate the push of a
// reminder; the moved row takes the stored reminder, so it is not pushed again.
func TestAddBookmarkMoveKeepsTheStoredReminder(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	remindAt := time.Now().Add(-time.Hour).UnixMilli()
	sentAt := time.Now().Add(-time.Minute).UnixMilli()
	netTestPage(t, dir, `{"name":"A","url":"https://a.example","remindAt":`+strconv.FormatInt(remindAt, 10)+`,"remindSentAt":`+strconv.FormatInt(sentAt, 10)+`}`)
	netTestPageN(t, dir, 2)

	// The stale tab: the reminder time, no sent mark.
	body := `{"page":2,"allowDuplicate":true,"movedFrom":"https://a.example","movedFromPage":1,"bookmark":{"name":"A","url":"https://a.example","remindAt":` + strconv.FormatInt(remindAt, 10) + `}}`
	if rec := netAddBookmarkPost(h, body); rec.Code != http.StatusOK {
		t.Fatalf("move = %d %s", rec.Code, rec.Body.String())
	}
	got := h.store.GetBookmarksByPage(2)
	if len(got) != 1 || got[0].RemindAt != remindAt || got[0].RemindSentAt != sentAt {
		t.Fatalf("the moved row lost its sent mark: %#v", got)
	}
	if due := h.markDueReminders(time.Now()); len(due) != 0 {
		t.Fatalf("the moved reminder came due again: %#v", due)
	}
}

// A plain add never brings a sent mark of its own.
func TestAddBookmarkDropsClientRemindSentAt(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir)
	future := time.Now().Add(time.Hour).UnixMilli()
	body := `{"page":1,"bookmark":{"name":"B","url":"https://b.example","remindAt":` + strconv.FormatInt(future, 10) + `,"remindSentAt":123}}`
	if rec := netAddBookmarkPost(h, body); rec.Code != http.StatusOK {
		t.Fatalf("add = %d %s", rec.Code, rec.Body.String())
	}
	got := h.store.GetBookmarksByPage(1)
	if len(got) != 1 || got[0].RemindSentAt != 0 || got[0].RemindAt != future {
		t.Fatalf("want the reminder without the client's sent mark: %#v", got)
	}
}
