package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Tags posted on add used to be dropped: InboxLink carried them and the store
// normalised them, but the request struct had no field to decode them into.
func TestAddInboxItemKeepsTags(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)

	body := `{"url":"https://tagged.example","title":"T","tags":["Read Later","go"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/inbox", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.AddInboxItem(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("add = %d (%s)", rec.Code, rec.Body.String())
	}

	var resp struct {
		Item InboxLink `json:"item"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Item.Tags) == 0 {
		t.Fatal("tags sent on add were dropped")
	}
	// Stored too, not just echoed back.
	for _, item := range h.store.GetInboxItems() {
		if item.ID == resp.Item.ID {
			if len(item.Tags) == 0 {
				t.Error("tags were echoed in the response but not persisted")
			}
			return
		}
	}
	t.Error("added item not found in the store")
}
