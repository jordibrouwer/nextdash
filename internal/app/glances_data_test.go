package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

// seedGlancesRecord fills the rings with `hours` of a made-up host: cpu steady
// at 20, memory climbing, one disk filling 2 points a day, the host answering.
func seedGlancesRecord(t *testing.T, hours int) time.Time {
	t.Helper()
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	now := time.Now()
	start := now.Add(-time.Duration(hours) * time.Hour)
	for at := start; at.Before(now); at = at.Add(30 * time.Second) {
		frac := at.Sub(start).Hours() / 24
		glancesRecord(at.UnixMilli(), map[string]float64{
			"up": 1, "cpu": 20, "mem": 40 + 8*frac, "swap": 0,
			"fs:/mnt/disk1": 70 + 2*frac,
			"net:eth0:rx":   1000, "net:eth0:tx": 500,
			"temp:Core 0": 55,
		})
	}
	return now
}

func glancesTestRouter(t *testing.T) *mux.Router {
	t.Helper()
	h := newTestHandlers(t)
	r := mux.NewRouter()
	registerGlancesViewRoutes(r, h)
	return r
}

func TestGlancesInsightsMath(t *testing.T) {
	seedGlancesRecord(t, 30)
	out := glancesComputeInsights(defaultGlancesConfig(), "24h", "cpu", time.UTC, time.Now())
	if out.Health.Score < 90 || out.Health.Level != "good" {
		t.Errorf("a calm host: %+v", out.Health)
	}
	if len(out.Forecast) != 1 || out.Forecast[0].Mount != "/mnt/disk1" || out.Forecast[0].DaysToFull == nil {
		t.Fatalf("forecast: %+v", out.Forecast)
	}
	// 2 points a day from ~72: about 14 days to a full disk.
	if d := *out.Forecast[0].DaysToFull; d < 10 || d > 18 {
		t.Errorf("days to full = %d", d)
	}
	if out.Memory == nil || out.Memory.SlopeDay < 6 || out.Memory.SlopeDay > 10 || !out.Memory.Leak {
		t.Errorf("memory trend: %+v", out.Memory)
	}
	if s := out.Stats["cpu"]; s.N == 0 || s.Avg != 20 || s.P95 != 20 {
		t.Errorf("cpu stats: %+v", s)
	}
	if out.Availability.Day == nil || *out.Availability.Day != 100 {
		t.Errorf("availability: %+v", out.Availability.Day)
	}
	if len(out.Heatmap.Days) != 7 || out.Heatmap.Max != 20 {
		t.Errorf("heatmap: days=%d max=%v", len(out.Heatmap.Days), out.Heatmap.Max)
	}
	if len(out.Network.Days) != 7 {
		t.Errorf("network days: %d", len(out.Network.Days))
	}
	if out.Temperature == nil || out.Temperature.Max != 55 {
		t.Errorf("temperature: %+v", out.Temperature)
	}
}

func TestGlancesInsightsEmptyRecordIsQuiet(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	out := glancesComputeInsights(defaultGlancesConfig(), "30d", "net", time.UTC, time.Now())
	if len(out.Forecast) != 0 || out.Memory != nil || len(out.Consumers) != 0 || out.Temperature != nil {
		t.Errorf("nothing recorded, nothing said: %+v", out)
	}
}

func TestGlancesInsightsOnlyTrackedConsumers(t *testing.T) {
	now := seedGlancesRecord(t, 3)
	start := now.Add(-3 * time.Hour)
	for at := start; at.Before(now); at = at.Add(30 * time.Second) {
		glancesRecord(at.UnixMilli(), map[string]float64{"proc:node:cpu": 40, "proc:node:mem": 5, "ct:app:cpu": 10, "ct:app:mem": 1e8})
	}
	out := glancesComputeInsights(defaultGlancesConfig(), "24h", "cpu", time.UTC, now)
	if len(out.Consumers) != 2 || out.Consumers[0].Name != "node" || out.Consumers[0].Kind != "process" {
		t.Fatalf("consumers: %+v", out.Consumers)
	}
}

func TestGlancesHistoryUntilAndCSV(t *testing.T) {
	now := seedGlancesRecord(t, 30)
	r := glancesTestRouter(t)
	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}
	since := now.Add(-26 * time.Hour).UnixMilli()
	until := now.Add(-2 * time.Hour).UnixMilli()
	rec := get("/api/glances/history?series=cpu&since=" + strconv.FormatInt(since, 10) + "&until=" + strconv.FormatInt(until, 10))
	var body struct {
		Series map[string][][2]float64 `json:"series"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	pts := body.Series["cpu"]
	if len(pts) == 0 {
		t.Fatal("no points in the window")
	}
	if last := int64(pts[len(pts)-1][0]); last > until+int64(time.Minute/time.Millisecond)*10 {
		t.Errorf("the window runs past until: %d > %d", last, until)
	}

	csvRec := get("/api/glances/history.csv?series=cpu,mem&since=" + strconv.FormatInt(now.Add(-time.Hour).UnixMilli(), 10))
	if csvRec.Code != http.StatusOK || !strings.HasPrefix(csvRec.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("csv: %d %s", csvRec.Code, csvRec.Header().Get("Content-Type"))
	}
	lines := strings.Split(strings.TrimSpace(csvRec.Body.String()), "\n")
	if lines[0] != "time,cpu,mem" || len(lines) < 10 {
		t.Errorf("csv shape: %q (%d lines)", lines[0], len(lines))
	}
}

func TestGlancesWipeNeedsTheTokenAndForgetsEverything(t *testing.T) {
	seedGlancesRecord(t, 2)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	r := glancesTestRouter(t)
	do := func(token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodDelete, "/api/glances/data", nil)
		if token != "" {
			req.Header.Set("X-NextDash-Token", token)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}
	if rec := do(""); rec.Code != http.StatusUnauthorized {
		t.Errorf("wipe without the token: %d", rec.Code)
	}
	if series, _, _ := glancesCollected(); series == 0 {
		t.Fatal("a refused wipe emptied the record")
	}
	rec := do("tok")
	if rec.Code != http.StatusOK {
		t.Fatalf("wipe: %d", rec.Code)
	}
	var got glancesCollectedAnswer
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.Series != 0 || got.Points != 0 {
		t.Errorf("after the wipe: %+v", got)
	}
}

func TestGlancesConfigAnswerSaysWhatIsCollected(t *testing.T) {
	seedGlancesRecord(t, 1)
	view := glancesConfigView(defaultGlancesConfig())
	if view.Collected.Series == 0 || view.Collected.Points == 0 || view.Collected.Since == 0 || view.Collected.KeepDays != 30 {
		t.Errorf("collected: %+v", view.Collected)
	}
}
