package app

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
)

/*
The settings on Config -> Containers, and the one secret among them.

Most are plain fields on Settings and are normalised here to the values the
page offers, so a hand-edited settings file cannot ask the view to poll every
millisecond or the daemon for a million log lines.

The GitHub token is kept apart, in docker-secrets.json at 0600 and out of the
backup, the way health-credentials.json is: it is a credential, and a settings
file travels to places a credential should not.
*/

var dockerRefreshChoices = map[int]bool{2: true, 5: true, 10: true, 30: true}
var dockerLogLineChoices = map[int]bool{100: true, 200: true, 500: true, 1000: true}

const (
	dockerMaxHidden        = 100
	dockerMaxHiddenNameLen = 128
)

func normalizeDockerSettings(s *Settings) {
	if !dockerRefreshChoices[s.DockerRefreshSeconds] {
		s.DockerRefreshSeconds = 5
	}
	if !dockerLogLineChoices[s.DockerLogLines] {
		s.DockerLogLines = 200
	}
	switch s.DockerViewKeyLegend {
	case "above", "below", "off":
	default:
		s.DockerViewKeyLegend = "above"
	}
	s.DockerHiddenContainers = normalizeDockerNameList(s.DockerHiddenContainers)
	s.DockerNotifyMuted = normalizeDockerNameList(s.DockerNotifyMuted)
	s.DockerWebUIs = normalizeDockerWebUIs(s.DockerWebUIs)
	s.DockerHostAddress = normalizeDockerHostAddress(s.DockerHostAddress)
}

// normalizeDockerNameList trims, de-duplicates and caps a list of container
// names, the hidden list and the muted list alike.
func normalizeDockerNameList(names []string) []string {
	seen := map[string]bool{}
	kept := []string{}
	for _, raw := range names {
		name := strings.TrimPrefix(strings.TrimSpace(raw), "/")
		if name == "" || len(name) > dockerMaxHiddenNameLen || seen[name] {
			continue
		}
		seen[name] = true
		kept = append(kept, name)
		if len(kept) == dockerMaxHidden {
			break
		}
	}
	return kept
}

// normalizeDockerHostAddress keeps a bare host -- a name or an IP, an IPv6
// one in brackets -- and drops anything with a scheme, port or path: the
// links put their own scheme and port around it.
func normalizeDockerHostAddress(raw string) string {
	host := strings.TrimSpace(raw)
	if host == "" || len(host) > 253 {
		return ""
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		if ip.To4() != nil {
			return ip.String()
		}
		return "[" + ip.String() + "]"
	}
	if !dockerHostName.MatchString(host) {
		return ""
	}
	return host
}

var dockerHostName = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$`)

const dockerMaxWebUILen = 2048

// normalizeDockerWebUIs keeps only web addresses. [IP] is Unraid's stand-in
// for the host the dashboard was opened on, so it is allowed where a host goes.
func normalizeDockerWebUIs(in map[string]string) map[string]string {
	out := map[string]string{}
	for rawName, rawURL := range in {
		name := strings.TrimPrefix(strings.TrimSpace(rawName), "/")
		link := strings.TrimSpace(rawURL)
		if name == "" || len(name) > dockerMaxHiddenNameLen || link == "" || len(link) > dockerMaxWebUILen {
			continue
		}
		parsed, err := url.Parse(strings.ReplaceAll(link, "[IP]", "host"))
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			continue
		}
		out[name] = link
		if len(out) == dockerMaxHidden {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

/*
dockerSettingsFrom is how code without a store -- the widget's metrics reader,
toDockerView -- learns which containers to leave out and the addresses set by
hand. Set when the handlers are built; empty in a test that never built any,
which hides nothing and sets none. An atomic pointer, as tests build handlers
while other code reads it.
*/
var dockerSettingsFrom atomic.Pointer[dockerSettingsSource]

type dockerSettingsSource struct {
	hidden func() []string
	webUIs func() map[string]string
}

// wireDockerSettings points dockerSettingsFrom at this store.
func (h *Handlers) wireDockerSettings() {
	store := h.store
	dockerSettingsFrom.Store(&dockerSettingsSource{
		hidden: func() []string { return store.GetSettings().DockerHiddenContainers },
		webUIs: func() map[string]string { return store.GetSettings().DockerWebUIs },
	})
}

func dockerCustomWebUI(name string) string {
	src := dockerSettingsFrom.Load()
	if src == nil {
		return ""
	}
	return src.webUIs()[name]
}

func dockerHiddenSet() map[string]bool {
	out := map[string]bool{}
	src := dockerSettingsFrom.Load()
	if src == nil {
		return out
	}
	for _, name := range src.hidden() {
		out[name] = true
	}
	return out
}

func dockerSecretsFilePath() string {
	return filepath.Join(ResolveDataDir(), "docker-secrets.json")
}

var dockerSecretsMu sync.Mutex

type dockerSecrets struct {
	GitHubToken string `json:"githubToken,omitempty"`
}

func readDockerSecrets() dockerSecrets {
	var out dockerSecrets
	data, err := os.ReadFile(dockerSecretsFilePath())
	if err == nil {
		_ = json.Unmarshal(data, &out)
	}
	return out
}

func dockerGitHubToken() string {
	dockerSecretsMu.Lock()
	defer dockerSecretsMu.Unlock()
	return strings.TrimSpace(readDockerSecrets().GitHubToken)
}

func saveDockerGitHubToken(token string) error {
	dockerSecretsMu.Lock()
	defer dockerSecretsMu.Unlock()
	secrets := readDockerSecrets()
	secrets.GitHubToken = strings.TrimSpace(token)
	if secrets.GitHubToken == "" {
		err := os.Remove(dockerSecretsFilePath())
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	data, err := json.Marshal(secrets)
	if err != nil {
		return err
	}
	return writeFileAtomic(dockerSecretsFilePath(), data, 0600)
}

// DockerGitHubTokenHandler says whether a token is set and takes a new one; it
// never hands the token back.
func (h *Handlers) DockerGitHubTokenHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		writeJSON(w, map[string]bool{"set": dockerGitHubToken() != ""})
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	token := ""
	if r.Method == http.MethodPut {
		var body struct {
			Token string `json:"token"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		token = body.Token
		// A GitHub token is printable ASCII without spaces; anything else is
		// a paste gone wrong, and would only fail later and less clearly.
		if strings.ContainsAny(strings.TrimSpace(token), " \t\r\n") {
			http.Error(w, "A token has no spaces", http.StatusBadRequest)
			return
		}
	}
	if err := saveDockerGitHubToken(token); err != nil {
		http.Error(w, "Could not store the token", http.StatusInternalServerError)
		return
	}
	// A changelog fetched without the token may have hit the anonymous limit;
	// with a new token, ask again rather than serve that answer.
	changelogCache.Range(func(key, _ any) bool {
		changelogCache.Delete(key)
		return true
	})
	logActivity(activityCategoryMutate, "docker.github-token", map[string]any{"set": token != ""},
		"docker: GitHub token "+map[bool]string{true: "set", false: "removed"}[token != ""])
	writeJSON(w, map[string]bool{"set": token != ""})
}
