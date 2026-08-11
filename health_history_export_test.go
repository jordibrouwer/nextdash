package main

import (
	"encoding/csv"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// newExportFixture writes one page and a history file, then points the data dir
// at them. healthHistoryFilePath reads the process-wide data dir, so the env var
// is what makes the handler see this history rather than the real one.
func newExportFixture(t *testing.T, pageJSON, historyJSON string) *Handlers {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "pages.json"), []byte(`{"order":[1]}`), 0o644); err != nil {
		t.Fatalf("write pages: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "health-history.json"), []byte(historyJSON), 0o644); err != nil {
		t.Fatalf("write history: %v", err)
	}
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	return &Handlers{store: store}
}

func exportCSV(t *testing.T, h *Handlers, query string) (*httptest.ResponseRecorder, [][]string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/health/history-export"+query, nil)
	rec := httptest.NewRecorder()
	h.ExportHealthHistory(rec, req)
	if rec.Code != http.StatusOK {
		return rec, nil
	}
	body := strings.TrimPrefix(rec.Body.String(), "\ufeff")
	records, err := csv.NewReader(strings.NewReader(body)).ReadAll()
	if err != nil {
		t.Fatalf("parse csv: %v\nbody: %q", err, body)
	}
	return rec, records
}

const exportPageJSON = `{"page":{"id":1,"name":"Servers"},"bookmarks":[
	{"name":"Alpha","url":"https://alpha.example","monitor":true},
	{"name":"Beta","url":"https://beta.example","monitor":true}
]}`

func TestExportHealthHistoryWritesSamples(t *testing.T) {
	now := time.Now().UnixMilli()
	history := `{"generatedAt":0,"samples":{
		"https://alpha.example":[
			{"t":` + strconv.FormatInt(now-60000, 10) + `,"u":true,"p":120,"c":200},
			{"t":` + strconv.FormatInt(now, 10) + `,"u":false,"p":0,"c":0}
		]
	}}`
	h := newExportFixture(t, exportPageJSON, history)

	rec, records := exportCSV(t, h, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/csv") {
		t.Fatalf("content-type = %q", got)
	}
	if !strings.Contains(rec.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatalf("content-disposition = %q", rec.Header().Get("Content-Disposition"))
	}

	// Header + two samples.
	if len(records) != 3 {
		t.Fatalf("rows = %d, want 3: %v", len(records), records)
	}
	wantHeader := []string{"name", "url", "page", "timestamp", "up", "pingMs", "httpStatus", "maint"}
	for i, col := range wantHeader {
		if records[0][i] != col {
			t.Fatalf("header[%d] = %q, want %q", i, records[0][i], col)
		}
	}

	// The bookmark's name and page are joined in, not left as a bare URL.
	if records[1][0] != "Alpha" {
		t.Fatalf("name = %q, want Alpha", records[1][0])
	}
	if records[1][2] != "Servers" {
		t.Fatalf("page = %q, want Servers", records[1][2])
	}
	if records[1][4] != "true" || records[2][4] != "false" {
		t.Fatalf("up column = %q/%q, want true/false", records[1][4], records[2][4])
	}
	if records[1][5] != "120" {
		t.Fatalf("pingMs = %q, want 120", records[1][5])
	}

	// Timestamps are RFC 3339 so a spreadsheet parses them as dates.
	if _, err := time.Parse(time.RFC3339, records[1][3]); err != nil {
		t.Fatalf("timestamp %q is not RFC3339: %v", records[1][3], err)
	}

	if got := rec.Header().Get("X-NextDash-Rows"); got != "2" {
		t.Fatalf("X-NextDash-Rows = %q, want 2", got)
	}
}

// The maint column lets an external analysis exclude expected downtime from
// real outages — without it, a nightly maintenance window is indistinguishable
// from an actual failure once the data leaves the app.
func TestExportHealthHistoryIncludesMaintColumn(t *testing.T) {
	now := time.Now().UnixMilli()
	history := `{"samples":{
		"https://alpha.example":[
			{"t":` + strconv.FormatInt(now-60000, 10) + `,"u":false,"p":0,"c":0,"m":true},
			{"t":` + strconv.FormatInt(now, 10) + `,"u":true,"p":10,"c":200}
		]
	}}`
	h := newExportFixture(t, exportPageJSON, history)

	_, records := exportCSV(t, h, "")
	if len(records) != 3 {
		t.Fatalf("rows = %d, want 3: %v", len(records), records)
	}
	if records[1][7] != "true" {
		t.Fatalf("maint column for the maintenance sample = %q, want true", records[1][7])
	}
	if records[2][7] != "false" {
		t.Fatalf("maint column for the ordinary sample = %q, want false", records[2][7])
	}
}

func TestExportHealthHistoryStartsWithBOM(t *testing.T) {
	now := time.Now().UnixMilli()
	history := `{"samples":{"https://alpha.example":[{"t":` + strconv.FormatInt(now, 10) + `,"u":true,"p":10,"c":200}]}}`
	h := newExportFixture(t, exportPageJSON, history)

	req := httptest.NewRequest(http.MethodGet, "/api/health/history-export", nil)
	rec := httptest.NewRecorder()
	h.ExportHealthHistory(rec, req)

	// Without the BOM Excel reads the file as latin-1 and mangles accents.
	if !strings.HasPrefix(rec.Body.String(), "\ufeff") {
		t.Fatal("export does not start with a UTF-8 BOM")
	}
}

func TestExportHealthHistoryFiltersByURL(t *testing.T) {
	now := time.Now().UnixMilli()
	history := `{"samples":{
		"https://alpha.example":[{"t":` + strconv.FormatInt(now, 10) + `,"u":true,"p":10,"c":200}],
		"https://beta.example":[{"t":` + strconv.FormatInt(now, 10) + `,"u":true,"p":20,"c":200}]
	}}`
	h := newExportFixture(t, exportPageJSON, history)

	_, records := exportCSV(t, h, "?url=https://beta.example")
	if len(records) != 2 {
		t.Fatalf("rows = %d, want 2 (header + one sample): %v", len(records), records)
	}
	if records[1][0] != "Beta" {
		t.Fatalf("name = %q, want Beta", records[1][0])
	}
}

func TestExportHealthHistoryUnknownURLIs404(t *testing.T) {
	h := newExportFixture(t, exportPageJSON, `{"samples":{}}`)

	req := httptest.NewRequest(http.MethodGet, "/api/health/history-export?url=https://nope.example", nil)
	rec := httptest.NewRecorder()
	h.ExportHealthHistory(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestExportHealthHistoryFiltersByDays(t *testing.T) {
	now := time.Now()
	history := `{"samples":{"https://alpha.example":[
		{"t":` + strconv.FormatInt(now.AddDate(0, 0, -10).UnixMilli(), 10) + `,"u":true,"p":10,"c":200},
		{"t":` + strconv.FormatInt(now.UnixMilli(), 10) + `,"u":true,"p":20,"c":200}
	]}}`
	h := newExportFixture(t, exportPageJSON, history)

	_, records := exportCSV(t, h, "?days=2")
	if len(records) != 2 {
		t.Fatalf("rows = %d, want 2 (header + the recent sample): %v", len(records), records)
	}
	if records[1][5] != "20" {
		t.Fatalf("kept the wrong sample: pingMs = %q", records[1][5])
	}
}

// Asking for more than retention returns what exists rather than failing.
func TestExportHealthHistoryClampsDaysToRetention(t *testing.T) {
	now := time.Now()
	history := `{"samples":{"https://alpha.example":[
		{"t":` + strconv.FormatInt(now.AddDate(0, 0, -10).UnixMilli(), 10) + `,"u":true,"p":10,"c":200}
	]}}`
	h := newExportFixture(t, exportPageJSON, history)

	rec, records := exportCSV(t, h, "?days=365")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if len(records) != 2 {
		t.Fatalf("rows = %d, want 2: %v", len(records), records)
	}
}

func TestExportHealthHistoryRejectsInvalidDays(t *testing.T) {
	h := newExportFixture(t, exportPageJSON, `{"samples":{}}`)

	for _, bad := range []string{"0", "-3", "abc"} {
		req := httptest.NewRequest(http.MethodGet, "/api/health/history-export?days="+bad, nil)
		rec := httptest.NewRecorder()
		h.ExportHealthHistory(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("days=%q gave status %d, want 400", bad, rec.Code)
		}
	}
}

func TestExportHealthHistoryEmptyStillHasHeader(t *testing.T) {
	h := newExportFixture(t, exportPageJSON, `{"samples":{}}`)

	rec, records := exportCSV(t, h, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if len(records) != 1 {
		t.Fatalf("rows = %d, want just the header: %v", len(records), records)
	}
	if got := rec.Header().Get("X-NextDash-Rows"); got != "0" {
		t.Fatalf("X-NextDash-Rows = %q, want 0", got)
	}
}

// A name beginning with = would execute as a formula when the CSV is opened in
// Excel or Sheets, so it is prefixed with an apostrophe.
func TestExportHealthHistoryEscapesFormulaInjection(t *testing.T) {
	now := time.Now().UnixMilli()
	page := `{"page":{"id":1,"name":"Servers"},"bookmarks":[
		{"name":"=cmd|' /c calc'!A0","url":"https://alpha.example","monitor":true}
	]}`
	history := `{"samples":{"https://alpha.example":[{"t":` + strconv.FormatInt(now, 10) + `,"u":true,"p":10,"c":200}]}}`
	h := newExportFixture(t, page, history)

	_, records := exportCSV(t, h, "")
	if len(records) != 2 {
		t.Fatalf("rows = %d: %v", len(records), records)
	}
	if !strings.HasPrefix(records[1][0], "'") {
		t.Fatalf("name %q is not neutralised", records[1][0])
	}
}

// Repeated exports of unchanged data must be byte-identical, so a series of
// exports is diffable.
func TestExportHealthHistoryIsDeterministic(t *testing.T) {
	now := time.Now().UnixMilli()
	history := `{"samples":{
		"https://beta.example":[{"t":` + strconv.FormatInt(now, 10) + `,"u":true,"p":20,"c":200}],
		"https://alpha.example":[{"t":` + strconv.FormatInt(now, 10) + `,"u":true,"p":10,"c":200}]
	}}`
	h := newExportFixture(t, exportPageJSON, history)

	first := httptest.NewRecorder()
	h.ExportHealthHistory(first, httptest.NewRequest(http.MethodGet, "/api/health/history-export", nil))
	second := httptest.NewRecorder()
	h.ExportHealthHistory(second, httptest.NewRequest(http.MethodGet, "/api/health/history-export", nil))

	if first.Body.String() != second.Body.String() {
		t.Fatal("two exports of the same data differ")
	}
	// And alpha sorts before beta regardless of map order.
	_, records := exportCSV(t, h, "")
	if records[1][1] != "https://alpha.example" {
		t.Fatalf("first data row = %q, want alpha", records[1][1])
	}
}

// Samples are written oldest-first so the file reads as a time series.
func TestExportHealthHistorySortsSamplesByTime(t *testing.T) {
	now := time.Now().UnixMilli()
	history := `{"samples":{"https://alpha.example":[
		{"t":` + strconv.FormatInt(now, 10) + `,"u":true,"p":30,"c":200},
		{"t":` + strconv.FormatInt(now-120000, 10) + `,"u":true,"p":10,"c":200},
		{"t":` + strconv.FormatInt(now-60000, 10) + `,"u":true,"p":20,"c":200}
	]}}`
	h := newExportFixture(t, exportPageJSON, history)

	_, records := exportCSV(t, h, "")
	if len(records) != 4 {
		t.Fatalf("rows = %d: %v", len(records), records)
	}
	want := []string{"10", "20", "30"}
	for i, ping := range want {
		if records[i+1][5] != ping {
			t.Fatalf("row %d pingMs = %q, want %q (samples not sorted)", i+1, records[i+1][5], ping)
		}
	}
}
