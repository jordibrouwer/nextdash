package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func historyView(t *testing.T, h *Handlers, query string) (int, healthHistoryView) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.HealthHistoryView(rec, httptest.NewRequest(http.MethodGet, "/api/health/history"+query, nil))
	var out healthHistoryView
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v\n%s", err, rec.Body.String())
		}
	}
	return rec.Code, out
}

// One bookmark's checks for the large health view: the individual checks
// still kept, and one summary per day over the whole 90 days -- the days
// whose checks were already folded away and the days still held as checks,
// merged into one series.
func TestHealthHistoryViewMergesDaysAndSamples(t *testing.T) {
	now := time.Now()
	old := dayStart(now.Add(-60 * 24 * time.Hour))
	recent := now.Add(-2 * time.Hour).UnixMilli()
	history := fmt.Sprintf(`{"generatedAt":1,
		"samples":{"https://alpha.example":[{"t":%d,"u":true,"p":120,"c":200},{"t":%d,"u":false,"c":502}]},
		"days":{"https://alpha.example":[{"d":%d,"n":10,"u":9,"p":200}]}}`, recent, recent+60000, old)
	h := newExportFixture(t, exportPageJSON, history)

	code, view := historyView(t, h, "?url=https://alpha.example")
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if len(view.Samples) != 2 || view.Samples[1].Code != 502 {
		t.Fatalf("samples: %+v", view.Samples)
	}
	if len(view.Days) != 2 {
		t.Fatalf("want the folded day and today's, got %+v", view.Days)
	}
	if view.Days[0].D != old || view.Days[0].N != 10 {
		t.Fatalf("folded day lost: %+v", view.Days[0])
	}
	if last := view.Days[1]; last.N != 2 || last.U != 1 {
		t.Fatalf("today's checks not summarised: %+v", last)
	}
	if view.SampleDays != 30 || view.DayDays != 90 {
		t.Fatalf("windows: %d / %d", view.SampleDays, view.DayDays)
	}
}

// A bookmark nobody has checked yet has no history: an empty answer, not an
// error, so the view can say so.
func TestHealthHistoryViewEmptyForUnknown(t *testing.T) {
	h := newExportFixture(t, exportPageJSON, `{"generatedAt":1,"samples":{}}`)
	code, view := historyView(t, h, "?url=https://beta.example")
	if code != http.StatusOK || len(view.Samples) != 0 || len(view.Days) != 0 {
		t.Fatalf("code %d view %+v", code, view)
	}
	if code, _ := historyView(t, h, ""); code != http.StatusBadRequest {
		t.Fatalf("no url: want 400, got %d", code)
	}
}
