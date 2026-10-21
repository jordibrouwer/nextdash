package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func readGlances[T any](t *testing.T, name string) T {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "glances", name+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func fixtureMeters(t *testing.T, network string, spec glancesSpec) *MediaMeters {
	t.Helper()
	return glancesMeters(
		readGlances[glancesQuicklook](t, "quicklook"),
		readGlances[[]glancesFS](t, "fs"),
		readGlances[[]glancesNet](t, network),
		readGlances[[]glancesSensor](t, "sensors"),
		readGlances[glancesLoad](t, "load"),
		spec,
	)
}

func TestGlancesMetersFromFixtures(t *testing.T) {
	m := fixtureMeters(t, "network", glancesSpecFrom(map[string]any{}))
	if !approx(m.CPU, 23.1) || !approx(m.Mem, 61.4) || !approx(m.Swap, 3.2) {
		t.Fatalf("cpu/mem/swap = %v %v %v", m.CPU, m.Mem, m.Swap)
	}
	if len(m.Load) != 3 || m.Load[0] != 0.87 {
		t.Fatalf("load = %v", m.Load)
	}
	if len(m.Fs) != 2 || m.Fs[0].Name != "/mnt/data" || m.Fs[1].Name != "/" {
		t.Fatalf("fs = %+v", m.Fs)
	}
	if len(m.Temps) != 4 || m.Temps[0].Name != "Core 1" || m.Temps[0].Value != 97 || m.Temps[3].Name != "nvme0n1 Composite" {
		t.Fatalf("temps = %+v", m.Temps)
	}
	if m.Net == nil || *m.Net != 125000 || m.NetUp == nil || *m.NetUp != 42000 {
		t.Fatalf("net = %v up %v", m.Net, m.NetUp)
	}
	// A chosen filesystem list narrows what is drawn.
	narrow := fixtureMeters(t, "network", glancesSpecFrom(map[string]any{"filesystems": []any{"/"}}))
	if len(narrow.Fs) != 1 || narrow.Fs[0].Name != "/" {
		t.Fatalf("narrow fs = %+v", narrow.Fs)
	}
}

func TestGlancesMissingRateIsNil(t *testing.T) {
	m := fixtureMeters(t, "network_norate", glancesSpecFrom(map[string]any{}))
	if m.Net != nil || m.NetUp != nil {
		t.Fatalf("net = %v up %v, want nil", m.Net, m.NetUp)
	}
}

func TestGlancesTone(t *testing.T) {
	for value, want := range map[float64]int{79: 0, 80: 1, 90: 2} {
		v := value
		if got := glancesTone(&v); got != want {
			t.Errorf("tone(%v) = %d, want %d", value, got, want)
		}
	}
	if glancesTone(nil) != 0 {
		t.Error("unknown reads as fine")
	}
	crit := 60.0
	if got := glancesSensorTone(MediaTemp{Name: "x", Value: 61, Crit: &crit}); got != 2 {
		t.Errorf("sensor over its critical line = %d, want 2", got)
	}
}

func glancesFixtureServer(t *testing.T, seen func(*http.Request)) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen != nil {
			seen(r)
		}
		const prefix = "/api/4/"
		name := r.URL.Path[len(prefix):]
		raw, err := os.ReadFile(filepath.Join("testdata", "glances", name+".json"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(raw)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestGlancesGetErrors(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	status := http.StatusNotFound
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
	}))
	defer srv.Close()
	var out any
	ask := func(path string) error {
		return h.glancesGet(context.Background(), srv.URL, HealthCredential{}, path, nil, &out)
	}
	if err := ask("/quicklook"); !errors.Is(err, errGlancesNotFound) {
		t.Errorf("404 = %v", err)
	}
	if err := ask("/status"); !errors.Is(err, errGlancesNeedsV4) {
		t.Errorf("/status 404 = %v", err)
	}
	status = http.StatusUnauthorized
	if err := ask("/quicklook"); !errors.Is(err, errMediaLogin) {
		t.Errorf("401 = %v", err)
	}
	if mediaErrorCode(errMediaLogin) != "login refused" || mediaErrorCode(errGlancesNeedsV4) != "needs Glances 4" {
		t.Error("error codes are not passed to the tile")
	}
}

func TestGlancesBasicAuthSent(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	var header []string
	srv := glancesFixtureServer(t, func(r *http.Request) { header = append(header, r.Header.Get("Authorization")) })
	var out glancesLoad
	cred := HealthCredential{Label: "Glances", BasicUser: "reader", BasicPassword: "pw"}
	if err := h.glancesGet(context.Background(), srv.URL, cred, "/load", nil, &out); err != nil {
		t.Fatal(err)
	}
	if err := h.glancesGet(context.Background(), srv.URL, HealthCredential{}, "/load", nil, &out); err != nil {
		t.Fatal(err)
	}
	if len(header) != 2 || header[0] != "Basic cmVhZGVyOnB3" || header[1] != "" {
		t.Fatalf("Authorization headers = %q", header)
	}
}

func TestGlancesAnswer(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	mediaForgetAll()
	srv := glancesFixtureServer(t, nil)
	widget := Widget{ID: "w_glances0001", Type: WidgetTypeGlances, Config: map[string]any{"server": srv.URL}}
	result := h.glancesAnswer(context.Background(), 1, widget, true)
	if result.Error != "" || len(result.Items) != 1 || result.Items[0].Meters == nil {
		t.Fatalf("answer = %+v", result)
	}
	m := result.Items[0].Meters
	if m.Status != "up" || m.Host != "nas" || m.Alerts != 1 || m.Uptime != 12*86400+3*3600+4*60+5 || len(m.Fs) != 2 {
		t.Fatalf("meters = %+v", m)
	}
	if result.Partial {
		t.Error("a 200 for every part is not partial")
	}

	// No quicklook: nothing to draw, and no meters.
	gone := httptest.NewServer(http.NotFoundHandler())
	defer gone.Close()
	bad := Widget{ID: "w_glances0002", Type: WidgetTypeGlances, Config: map[string]any{"server": gone.URL}}
	got := h.glancesAnswer(context.Background(), 1, bad, true)
	if got.Error != "needs Glances 4" || len(got.Items) != 0 {
		t.Fatalf("v3 answer = %+v", got)
	}
}

// glancesHistoryServer serves the fixtures, and /cpu/history/60 as `history`
// says: the recorded series, a 404, or a broken body.
func glancesHistoryServer(t *testing.T, history string) *httptest.Server {
	t.Helper()
	files := glancesFixtureServer(t, nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/4/cpu/history/60" {
			resp, err := http.Get(files.URL + r.URL.Path)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			defer resp.Body.Close()
			w.WriteHeader(resp.StatusCode)
			_, _ = io.Copy(w, resp.Body)
			return
		}
		switch history {
		case "fixture":
			raw, err := os.ReadFile(filepath.Join("testdata", "glances", "history_cpu.json"))
			if err != nil {
				t.Error(err)
			}
			_, _ = w.Write(raw)
		case "empty":
			_, _ = w.Write([]byte(`{"total":[]}`))
		case "broken":
			_, _ = w.Write([]byte(`{"total":`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestGlancesAnswerSpark(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	mediaForgetAll()
	srv := glancesHistoryServer(t, "fixture")
	widget := Widget{ID: "w_glances0003", Type: WidgetTypeGlances, Config: map[string]any{"server": srv.URL}}
	result := h.glancesAnswer(context.Background(), 1, widget, true)
	if result.Error != "" || len(result.Items) != 1 || result.Items[0].Meters == nil {
		t.Fatalf("answer = %+v", result)
	}
	want := readGlances[struct {
		Total [][]any `json:"total"`
	}](t, "history_cpu").Total
	spark := result.Items[0].Meters.Spark
	if len(spark) != len(want) || len(spark) < 2 {
		t.Fatalf("spark = %v, want %d points", spark, len(want))
	}
	// Oldest first, the values as Glances sent them.
	if spark[0] != want[0][1].(float64) || spark[len(spark)-1] != want[len(want)-1][1].(float64) {
		t.Fatalf("spark = %v", spark)
	}
	if result.Partial {
		t.Error("a full answer is not partial")
	}
}

func TestGlancesAnswerSparkAbsent(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	for i, history := range []string{"404", "empty", "broken"} {
		mediaForgetAll()
		srv := glancesHistoryServer(t, history)
		widget := Widget{ID: "w_glances001" + strconv.Itoa(i), Type: WidgetTypeGlances, Config: map[string]any{"server": srv.URL}}
		result := h.glancesAnswer(context.Background(), 1, widget, true)
		if result.Error != "" || len(result.Items) != 1 || result.Items[0].Meters == nil {
			t.Fatalf("%s: answer = %+v", history, result)
		}
		m := result.Items[0].Meters
		if m.Spark != nil {
			t.Errorf("%s: spark = %v, want none", history, m.Spark)
		}
		if result.Partial {
			t.Errorf("%s: the history alone does not make the answer partial", history)
		}
		if m.CPU == nil || len(m.Fs) != 2 {
			t.Errorf("%s: meters = %+v", history, m)
		}
	}
}
