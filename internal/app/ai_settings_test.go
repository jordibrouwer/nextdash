package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestAISettingsNormalise(t *testing.T) {
	s := Settings{AIProvider: "gpt", AIBaseURL: "http://ollama.lan:11434/v1/?x=1#y"}
	normalizeAISettings(&s)
	if s.AIProvider != "anthropic" || s.AIBaseURL != "http://ollama.lan:11434/v1" {
		t.Fatalf("got %q %q", s.AIProvider, s.AIBaseURL)
	}
	s = Settings{AIBaseURL: "ftp://x"}
	normalizeAISettings(&s)
	if s.AIBaseURL != "" {
		t.Fatalf("ftp kept: %q", s.AIBaseURL)
	}
	s = Settings{}
	normalizeAISettings(&s)
	if s.AIHistoryMax != 0 || s.AIHistoryDays != 0 || aiHistoryMaxOf(s) != 50 || aiHistoryDaysOf(s) != 90 {
		t.Fatalf("defaults: %+v", s)
	}
	s = Settings{AIHistoryMax: 9999, AIHistoryDays: 99999}
	normalizeAISettings(&s)
	if s.AIHistoryMax != 500 || s.AIHistoryDays != 3650 {
		t.Fatalf("clamp: %d %d", s.AIHistoryMax, s.AIHistoryDays)
	}
}

func TestAIKeysAreKeptPerProvider(t *testing.T) {
	newTestHandlers(t)
	if err := saveAIKey("anthropic", "sk-ant-1"); err != nil {
		t.Fatal(err)
	}
	if err := saveAIKey("openai", "sk-2"); err != nil {
		t.Fatal(err)
	}
	if aiKeyFor("anthropic") != "sk-ant-1" || aiKeyFor("openai") != "sk-2" {
		t.Fatal("keys mixed up")
	}
	fi, err := os.Stat(aiSecretsFilePath())
	if err != nil || fi.Mode().Perm() != 0600 {
		t.Fatalf("mode: %v %v", fi, err)
	}
	_ = saveAIKey("openai", "")
	if aiKeyFor("anthropic") != "sk-ant-1" || aiKeyFor("openai") != "" {
		t.Fatal("delete touched the wrong key")
	}
	_ = saveAIKey("anthropic", "")
	if _, err := os.Stat(aiSecretsFilePath()); !os.IsNotExist(err) {
		t.Fatal("file should be gone")
	}
}

func aiKeyCall(h *Handlers, method, target, body, token string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if token != "" {
		req.Header.Set("X-NextDash-Token", token)
	}
	h.AIKeyHandler(rec, req)
	return rec
}

func TestAIKeyRouteNeverAnswersTheKey(t *testing.T) {
	h := newTestHandlers(t)
	want := `{"keySet":{"anthropic":true,"compatible":false,"openai":false}}`
	put := aiKeyCall(h, "PUT", "/api/ai/key", `{"provider":"anthropic","key":"sk-ant-SECRET-42"}`, "")
	if put.Code != http.StatusOK || strings.TrimSpace(put.Body.String()) != want {
		t.Fatalf("put: %d %s", put.Code, put.Body)
	}
	get := aiKeyCall(h, "GET", "/api/ai/key", "", "")
	if strings.TrimSpace(get.Body.String()) != want || get.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("get: %s", get.Body)
	}
	rec := httptest.NewRecorder()
	h.GetSettings(rec, httptest.NewRequest("GET", "/api/settings", nil))
	if strings.Contains(rec.Body.String(), "SECRET-42") {
		t.Fatal("settings leak the key")
	}
	if r := aiKeyCall(h, "PUT", "/api/ai/key", `{"provider":"anthropic","key":"a b"}`, ""); r.Code != 400 {
		t.Fatalf("space: %d", r.Code)
	}
	if r := aiKeyCall(h, "PUT", "/api/ai/key", `{"provider":"x","key":"k"}`, ""); r.Code != 400 {
		t.Fatalf("provider: %d", r.Code)
	}
	if r := aiKeyCall(h, "DELETE", "/api/ai/key?provider=anthropic", "", ""); strings.Contains(r.Body.String(), `"anthropic":true`) {
		t.Fatalf("delete: %s", r.Body)
	}
}

func TestAIKeyNeedsTheWriteToken(t *testing.T) {
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	if r := aiKeyCall(h, "PUT", "/api/ai/key", `{"provider":"openai","key":"k"}`, ""); r.Code != 401 {
		t.Fatalf("no token: %d", r.Code)
	}
	if _, err := os.Stat(aiSecretsFilePath()); !os.IsNotExist(err) {
		t.Fatal("file written without token")
	}
	if r := aiKeyCall(h, "PUT", "/api/ai/key", `{"provider":"openai","key":"k"}`, "tok"); r.Code != 200 {
		t.Fatalf("token: %d", r.Code)
	}
}

func TestAIReadyReasons(t *testing.T) {
	newTestHandlers(t)
	if ok, why := aiReady(Settings{}); ok || why != "off" {
		t.Fatalf("off: %v %q", ok, why)
	}
	if ok, why := aiReady(Settings{AIEnabled: true}); ok || why != "no-key" {
		t.Fatalf("no-key: %v %q", ok, why)
	}
	_ = saveAIKey("compatible", "k")
	if ok, why := aiReady(Settings{AIEnabled: true, AIProvider: "compatible"}); ok || why != "no-address" {
		t.Fatalf("no-address: %v %q", ok, why)
	}
	if ok, why := aiReady(Settings{AIEnabled: true, AIProvider: "compatible", AIBaseURL: "http://x"}); ok || why != "no-model" {
		t.Fatalf("no-model: %v %q", ok, why)
	}
	if ok, why := aiReady(Settings{AIEnabled: true, AIProvider: "compatible", AIBaseURL: "http://x", AIModel: "m"}); !ok || why != "" {
		t.Fatalf("ready: %v %q", ok, why)
	}
	t.Setenv("NEXTDASH_DEMO", "1")
	if ok, why := aiReady(Settings{AIEnabled: true}); ok || why != "demo" {
		t.Fatalf("demo: %v %q", ok, why)
	}
}
