package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	aiProviderAnthropic  = "anthropic"
	aiProviderOpenAI     = "openai"
	aiProviderCompatible = "compatible"

	aiHistoryMaxDefault  = 50
	aiHistoryDaysDefault = 90
)

// aiDefaultModels: compatible has none, the field is required there.
var aiDefaultModels = map[string]string{
	aiProviderAnthropic:  "claude-sonnet-5-5",
	aiProviderOpenAI:     "gpt-5-mini",
	aiProviderCompatible: "",
}

func aiKnownProvider(p string) bool {
	_, ok := aiDefaultModels[p]
	return ok
}

func normalizeAISettings(s *Settings) {
	if !aiKnownProvider(s.AIProvider) {
		s.AIProvider = aiProviderAnthropic
	}
	s.AIBaseURL = strings.TrimRight(normalizeSearxngURL(s.AIBaseURL), "/")
	m := strings.TrimSpace(s.AIModel)
	if len(m) > 200 {
		m = m[:200]
	}
	s.AIModel = m
	if s.AIHistoryMax != 0 {
		s.AIHistoryMax = min(max(s.AIHistoryMax, 1), 500)
	}
	if s.AIHistoryDays != 0 {
		s.AIHistoryDays = min(max(s.AIHistoryDays, 1), 3650)
	}
}

// aiProviderOf reads "" as anthropic: the missing-file defaults branch of
// GetSettings skips normalising.
func aiProviderOf(s Settings) string {
	if aiKnownProvider(s.AIProvider) {
		return s.AIProvider
	}
	return aiProviderAnthropic
}

func aiModelOf(s Settings) string {
	if m := strings.TrimSpace(s.AIModel); m != "" {
		return m
	}
	return aiDefaultModels[aiProviderOf(s)]
}

func aiHistoryMaxOf(s Settings) int {
	if s.AIHistoryMax <= 0 {
		return aiHistoryMaxDefault
	}
	return s.AIHistoryMax
}

func aiHistoryDaysOf(s Settings) int {
	if s.AIHistoryDays <= 0 {
		return aiHistoryDaysDefault
	}
	return s.AIHistoryDays
}

func aiSecretsFilePath() string {
	return filepath.Join(ResolveDataDir(), "ai-secrets.json")
}

var aiSecretsMu sync.Mutex

type aiSecrets struct {
	Keys map[string]string `json:"keys,omitempty"`
}

func readAISecrets() aiSecrets {
	var out aiSecrets
	if data, err := os.ReadFile(aiSecretsFilePath()); err == nil {
		_ = json.Unmarshal(data, &out)
	}
	return out
}

func aiKeyFor(provider string) string {
	aiSecretsMu.Lock()
	defer aiSecretsMu.Unlock()
	return strings.TrimSpace(readAISecrets().Keys[provider])
}

func saveAIKey(provider, key string) error {
	aiSecretsMu.Lock()
	defer aiSecretsMu.Unlock()
	secrets := readAISecrets()
	if secrets.Keys == nil {
		secrets.Keys = map[string]string{}
	}
	key = strings.TrimSpace(key)
	if key == "" {
		delete(secrets.Keys, provider)
	} else {
		secrets.Keys[provider] = key
	}
	if len(secrets.Keys) == 0 {
		err := os.Remove(aiSecretsFilePath())
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	data, err := json.Marshal(secrets)
	if err != nil {
		return err
	}
	return writeFileAtomic(aiSecretsFilePath(), data, 0600)
}

func aiKeysSet() map[string]bool {
	out := map[string]bool{}
	for p := range aiDefaultModels {
		out[p] = aiKeyFor(p) != ""
	}
	return out
}

// aiReady says whether the assistant can run, else why not.
func aiReady(s Settings) (bool, string) {
	if demoMode() {
		return false, "demo"
	}
	if !s.AIEnabled {
		return false, "off"
	}
	p := aiProviderOf(s)
	if aiKeyFor(p) == "" {
		return false, "no-key"
	}
	if p == aiProviderCompatible {
		if normalizeSearxngURL(s.AIBaseURL) == "" {
			return false, "no-address"
		}
		if aiModelOf(s) == "" {
			return false, "no-model"
		}
	}
	return true, ""
}

// AIKeyHandler says which providers have a key and takes a new one; it never
// hands a key back.
func (h *Handlers) AIKeyHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if demoMode() {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodGet {
		writeJSON(w, map[string]any{"keySet": aiKeysSet()})
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	provider, key := "", ""
	if r.Method == http.MethodPut {
		var body struct {
			Provider string `json:"provider"`
			Key      string `json:"key"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		provider, key = body.Provider, body.Key
		if strings.ContainsAny(strings.TrimSpace(key), " \t\r\n") {
			http.Error(w, "A key has no spaces", http.StatusBadRequest)
			return
		}
	} else {
		provider = r.URL.Query().Get("provider")
	}
	if !aiKnownProvider(provider) {
		http.Error(w, "Unknown provider", http.StatusBadRequest)
		return
	}
	if err := saveAIKey(provider, key); err != nil {
		http.Error(w, "Could not store the key", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"keySet": aiKeysSet()})
}
