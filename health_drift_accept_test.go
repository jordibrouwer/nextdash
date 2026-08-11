package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Accepting drift is two things in one write: clear the finding, and drop the
// now-stale baseline so the next check records the page as it is today.
//
// Clearing only the finding is the tempting half-implementation and the one
// worth testing hardest: the stored baseline describes the page as it was
// *before* the accepted change, so leaving it in place re-reports the identical
// drift on the very next check, and the accept button appears to do nothing.

func driftedBookmark() Bookmark {
	return Bookmark{
		Monitor: true, WatchDrift: true,
		DriftURL:         "https://old.example/docs",
		DriftTitle:       "Old Docs",
		DriftFingerprint: "alpha beta gamma",
		DriftNoticed:     "host",
		DriftReason:      "Now redirects to new.example",
		DriftSince:       1700000000000,
	}
}

func TestAcceptDriftClearsTheFinding(t *testing.T) {
	bm := driftedBookmark()
	if !acceptDrift(&bm) {
		t.Fatal("acceptDrift reported no change on a drifted bookmark")
	}
	if bm.DriftNoticed != "" || bm.DriftReason != "" || bm.DriftSince != 0 {
		t.Errorf("finding survived acceptance: %+v", bm)
	}
}

// The half that is easy to miss: the baseline must go too, or the next check
// compares against the pre-change page and reports the same drift again.
func TestAcceptDriftClearsTheStaleBaseline(t *testing.T) {
	bm := driftedBookmark()
	acceptDrift(&bm)
	if bm.DriftURL != "" || bm.DriftTitle != "" || bm.DriftFingerprint != "" {
		t.Errorf("stale baseline survived acceptance, so the next check will "+
			"re-report the same drift: %+v", bm)
	}
}

// Proves the above end-to-end through the real evaluator rather than by
// inspecting fields: after accepting, the next check must take the
// no-baseline branch and record today's page instead of reporting drift.
func TestAcceptedDriftDoesNotReturnOnTheNextCheck(t *testing.T) {
	bm := driftedBookmark()
	acceptDrift(&bm)

	// The check that follows sees the page in its new, accepted shape.
	result := PingResult{
		Status:      "online",
		FinalURL:    "https://new.example/docs",
		Title:       "New Docs",
		Fingerprint: "delta epsilon zeta",
	}
	applyDriftResult(&bm, result, 1700000100000)

	if bm.DriftNoticed != "" {
		t.Errorf("drift was re-reported after acceptance: %q (%s)", bm.DriftNoticed, bm.DriftReason)
	}
	// And the new shape is now the baseline, so a *further* change is caught.
	if bm.DriftFingerprint != "delta epsilon zeta" {
		t.Errorf("accepted page did not become the new baseline: %+v", bm)
	}
}

// A row can lose its finding to a re-check between the report being drawn and
// the click arriving. Accepting then is a no-op, not an error — but it must
// report as one so the caller's count stays honest.
func TestAcceptDriftReportsNoChangeWhenThereIsNothingToAccept(t *testing.T) {
	bm := Bookmark{Monitor: true, WatchDrift: true}
	if acceptDrift(&bm) {
		t.Error("acceptDrift claimed a change on a bookmark with no drift state")
	}
}

// A watched bookmark that has a baseline but no finding is still worth
// re-baselining — that is what "accept" means on a row someone opened before
// the drift cleared itself — so it counts as a change.
func TestAcceptDriftRebaselinesAWatchedBookmarkWithoutAFinding(t *testing.T) {
	bm := Bookmark{
		Monitor: true, WatchDrift: true,
		DriftURL: "https://a.example/", DriftFingerprint: "alpha beta",
	}
	if !acceptDrift(&bm) {
		t.Fatal("acceptDrift reported no change on a bookmark with a baseline")
	}
	if bm.DriftFingerprint != "" {
		t.Errorf("baseline survived: %+v", bm)
	}
}

func TestAcceptDriftHandlesNil(t *testing.T) {
	if acceptDrift(nil) {
		t.Error("acceptDrift(nil) reported a change")
	}
}

// ─── The endpoint ───────────────────────────────────────────────────────────

// driftAcceptTestHandlers stands up a store with three drifted bookmarks on one
// page, which is the shape the bulk endpoint exists for.
func driftAcceptTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"A","url":"https://a.example","monitor":true,"watchDrift":true,
		 "driftUrl":"https://a.example","driftTitle":"A","driftFingerprint":"alpha beta",
		 "driftNoticed":"host","driftReason":"Now redirects to new.example","driftSince":1700000000000},
		{"name":"B","url":"https://b.example","monitor":true,"watchDrift":true,
		 "driftUrl":"https://b.example","driftTitle":"B","driftFingerprint":"gamma delta",
		 "driftNoticed":"title-changed","driftReason":"Page title changed","driftSince":1700000000000},
		{"name":"C","url":"https://c.example","monitor":true,"watchDrift":true,
		 "driftUrl":"https://c.example","driftTitle":"C","driftFingerprint":"epsilon zeta",
		 "driftNoticed":"content","driftReason":"Content changed","driftSince":1700000000000}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	return h
}

func postAcceptDrift(t *testing.T, h *Handlers, body string) (*httptest.ResponseRecorder, struct {
	Accepted int `json:"accepted"`
	Skipped  int `json:"skipped"`
}) {
	t.Helper()
	var decoded struct {
		Accepted int `json:"accepted"`
		Skipped  int `json:"skipped"`
	}
	req := httptest.NewRequest(http.MethodPost, "/api/health/accept-drift", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.AcceptDrift(rec, req)
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("decode response: %v", err)
		}
	}
	return rec, decoded
}

// The case the endpoint exists for: a rebrand tripped every watching bookmark,
// and all of them are cleared in one write.
func TestAcceptDriftEndpointClearsABatch(t *testing.T) {
	h := driftAcceptTestHandlers(t)

	rec, body := postAcceptDrift(t, h, `{"targets":[
		{"pageId":1,"index":0,"url":"https://a.example"},
		{"pageId":1,"index":1,"url":"https://b.example"},
		{"pageId":1,"index":2,"url":"https://c.example"}
	]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if body.Accepted != 3 || body.Skipped != 0 {
		t.Errorf("unexpected counts: %#v", body)
	}

	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.DriftNoticed != "" || bm.DriftFingerprint != "" {
			t.Errorf("%s still carries drift state: %+v", bm.Name, bm)
		}
		// Watching stays on: accepting a change is not the same as no longer
		// caring about the next one.
		if !bm.WatchDrift {
			t.Errorf("%s stopped watching for drift", bm.Name)
		}
	}
}

// The stale-index guard every health write shares: the report can be minutes
// old, so a row whose URL no longer matches must be skipped rather than
// clearing whatever bookmark now sits at that index.
func TestAcceptDriftEndpointSkipsStaleRows(t *testing.T) {
	h := driftAcceptTestHandlers(t)

	rec, body := postAcceptDrift(t, h, `{"targets":[
		{"pageId":1,"index":0,"url":"https://moved-away.example"},
		{"pageId":1,"index":1,"url":"https://b.example"}
	]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if body.Accepted != 1 || body.Skipped != 1 {
		t.Errorf("expected 1 accepted and 1 skipped, got %#v", body)
	}

	bookmarks := h.store.GetBookmarksByPage(1)
	if bookmarks[0].DriftNoticed == "" {
		t.Error("the stale row was cleared anyway — the URL guard did not hold")
	}
	if bookmarks[1].DriftNoticed != "" {
		t.Error("the matching row was not cleared")
	}
}

// No target list means no blast radius the user could see, so it is refused
// rather than treated as "everything".
func TestAcceptDriftEndpointRequiresTargets(t *testing.T) {
	h := driftAcceptTestHandlers(t)

	rec, _ := postAcceptDrift(t, h, `{}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an empty target list, got %d", rec.Code)
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.DriftNoticed == "" {
			t.Fatalf("%s was cleared by a request with no targets", bm.Name)
		}
	}
}

func TestAcceptDriftEndpointRejectsNonPost(t *testing.T) {
	h := driftAcceptTestHandlers(t)
	req := httptest.NewRequest(http.MethodGet, "/api/health/accept-drift", nil)
	rec := httptest.NewRecorder()
	h.AcceptDrift(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}
