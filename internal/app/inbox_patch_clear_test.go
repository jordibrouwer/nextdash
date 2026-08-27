package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Clearing a field through PATCH.
//
// An empty string on a JSON struct is indistinguishable from "field not sent",
// so every clearable text field needs an explicit opt-in. Notes already had
// clearNote=1; the title and the preview fields had nothing, which made them
// settable but never emptiable. These lock in the escape hatches and, just as
// importantly, that omitting a field still leaves it alone.

func seedInboxItem(t *testing.T, h *Handlers, link InboxLink) InboxLink {
	t.Helper()
	created, _, err := h.store.AddInboxLink(link, false, 500)
	if err != nil {
		t.Fatalf("seed inbox item: %v", err)
	}
	return created
}

func patchInbox(t *testing.T, h *Handlers, query, body string) InboxLink {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, "/api/inbox"+query, strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.PatchInboxItem(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var resp struct {
		Item InboxLink `json:"item"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return resp.Item
}

func TestPatchClearsPreviewFieldsOnRequest(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	item := seedInboxItem(t, h, InboxLink{
		URL: "https://a.example", Title: "A",
		PreviewTitle: "Prev", PreviewDesc: "Desc", PreviewImage: "https://img.example/x.png",
	})

	got := patchInbox(t, h, "?clearPreview=1", `{"id":"`+item.ID+`"}`)
	if got.PreviewTitle != "" || got.PreviewDesc != "" || got.PreviewImage != "" {
		t.Errorf("preview fields survived an explicit clear: %+v", got)
	}
}

// Without the flag an omitted preview field must be left alone, or every
// unrelated PATCH would wipe the enrichment.
func TestPatchLeavesPreviewAloneWhenNotClearing(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	item := seedInboxItem(t, h, InboxLink{
		URL: "https://a.example", Title: "A",
		PreviewTitle: "Prev", PreviewDesc: "Desc",
	})

	got := patchInbox(t, h, "", `{"id":"`+item.ID+`","note":"just a note"}`)
	if got.PreviewTitle != "Prev" || got.PreviewDesc != "Desc" {
		t.Errorf("an unrelated patch cleared the preview: %+v", got)
	}
}

// Clearing a title falls back rather than leaving a blank row in the list —
// the same fallback AddInboxLink applies when no title is supplied.
func TestPatchClearingTitleFallsBackToTheDomain(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	item := seedInboxItem(t, h, InboxLink{URL: "https://example.com/page", Title: "Custom"})

	got := patchInbox(t, h, "?clearTitle=1", `{"id":"`+item.ID+`"}`)
	if got.Title == "" {
		t.Error("clearing the title left it blank, which renders as an empty row")
	}
	if got.Title == "Custom" {
		t.Error("the title was not cleared at all")
	}
	if got.Title != "example.com" {
		t.Errorf("title fell back to %q, want the domain", got.Title)
	}
}

func TestPatchLeavesTitleAloneWhenNotClearing(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	item := seedInboxItem(t, h, InboxLink{URL: "https://a.example", Title: "Keep me"})

	got := patchInbox(t, h, "", `{"id":"`+item.ID+`","note":"x"}`)
	if got.Title != "Keep me" {
		t.Errorf("title changed on an unrelated patch: %q", got.Title)
	}
}
