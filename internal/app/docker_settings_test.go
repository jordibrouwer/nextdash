package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestNormalizeDockerSettings(t *testing.T) {
	s := Settings{DockerRefreshSeconds: 7, DockerLogLines: 9999,
		DockerHiddenContainers: []string{" portainer ", "", "portainer", strings.Repeat("x", 300), "proxy"}}
	normalizeDockerSettings(&s)
	if s.DockerRefreshSeconds != 5 || s.DockerLogLines != 200 {
		t.Fatalf("refresh = %d logs = %d, want the defaults for values off the list", s.DockerRefreshSeconds, s.DockerLogLines)
	}
	if strings.Join(s.DockerHiddenContainers, ",") != "portainer,proxy" {
		t.Fatalf("hidden = %q -- trimmed, deduplicated, empty and overlong names dropped", s.DockerHiddenContainers)
	}
	s = Settings{DockerRefreshSeconds: 30, DockerLogLines: 1000}
	normalizeDockerSettings(&s)
	if s.DockerRefreshSeconds != 30 || s.DockerLogLines != 1000 {
		t.Fatalf("allowed values must stay: %d %d", s.DockerRefreshSeconds, s.DockerLogLines)
	}
}

// A hidden container is gone from the list, the search index behind it and
// the widget's counts -- it is still there on the host, just not in the way.
func TestDockerHiddenContainersLeaveListAndCounts(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running"})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "portainer", State: "running"})
	h := dockerTestHandlers(t)
	s := h.store.GetSettings()
	s.DockerHiddenContainers = []string{"portainer"}
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatalf("save: %v", err)
	}
	rec := httptest.NewRecorder()
	h.DockerContainersHandler(rec, httptest.NewRequest("GET", "/api/docker/containers", nil))
	if strings.Contains(rec.Body.String(), "portainer") {
		t.Fatalf("hidden container listed: %s", rec.Body)
	}
	if got := readDocker(); got.Running != 1 || got.Total != 1 {
		t.Fatalf("widget counts running=%d total=%d, want 1 and 1", got.Running, got.Total)
	}
}

func TestDockerGitHubTokenIsStoredAndNeverReturned(t *testing.T) {
	h := dockerTestHandlers(t)
	router := newDockerTestRouter(h)
	req := httptest.NewRequest("PUT", "/api/docker/github-token", strings.NewReader(`{"token":"ghp_secret123"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/github-token", nil))
	if strings.Contains(rec.Body.String(), "ghp_secret123") || !strings.Contains(rec.Body.String(), `"set":true`) {
		t.Fatalf("get = %s -- says whether it is set, never the value", rec.Body)
	}
	if dockerGitHubToken() != "ghp_secret123" {
		t.Fatal("token not readable by the server")
	}
	info, err := os.Stat(dockerSecretsFilePath())
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("secrets file mode = %v err = %v, want 0600", info.Mode().Perm(), err)
	}
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("DELETE", "/api/docker/github-token", nil))
	if rec.Code != http.StatusOK || dockerGitHubToken() != "" {
		t.Fatalf("delete: %d, token now %q", rec.Code, dockerGitHubToken())
	}
}

func TestDockerGitHubTokenNeedsWriteToken(t *testing.T) {
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	router := newDockerTestRouter(dockerTestHandlers(t))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/docker/github-token", strings.NewReader(`{"token":"x"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401", rec.Code)
	}
}

// With a token the changelog asks GitHub as that account: 5000 an hour
// instead of 60.
func TestChangelogSendsGitHubToken(t *testing.T) {
	var auth string
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		w.Write([]byte(`[]`))
	}))
	defer gh.Close()
	old, oldClient := dockerGitHubBase, dockerGitHubClient
	dockerGitHubBase, dockerGitHubClient = gh.URL, gh.Client()
	t.Cleanup(func() { dockerGitHubBase, dockerGitHubClient = old, oldClient })
	resetChangelogCache()

	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "app", Image: "owner/app:1", ImageID: "sha256:run", State: "running"})
	f.images["run"] = fakeImage{ID: "sha256:run", Labels: map[string]string{"org.opencontainers.image.source": "https://github.com/owner/app"}}
	h := dockerTestHandlers(t)
	if err := saveDockerGitHubToken("ghp_abc"); err != nil {
		t.Fatalf("save token: %v", err)
	}
	rec := httptest.NewRecorder()
	newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/app/changelog", nil))
	if auth != "Bearer ghp_abc" {
		t.Fatalf("Authorization = %q", auth)
	}
}

func TestDockerStatusSaysWriteTokenAndSelfName(t *testing.T) {
	f := startFakeDocker(t)
	id := strings.Repeat("e", 64)
	f.add(fakeContainer{ID: id, Name: "nextdash", State: "running"})
	dockerSelfOverride = id[:12]
	t.Cleanup(func() { dockerSelfOverride = "" })
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	h := dockerTestHandlers(t)
	rec := httptest.NewRecorder()
	h.DockerStatusHandler(rec, httptest.NewRequest("GET", "/api/docker/status", nil))
	var st map[string]any
	json.NewDecoder(rec.Body).Decode(&st)
	if st["writeToken"] != true || st["selfName"] != "nextdash" {
		t.Fatalf("status = %v", st)
	}
	_ = context.Background()
}

// A settings file from before this setting keeps the view on.
func TestDockerViewEnabledDefaultsOn(t *testing.T) {
	h := dockerTestHandlers(t)
	if !h.store.GetSettings().DockerViewEnabled {
		t.Fatal("the containers view must be on by default")
	}
}

// The Containers key legend takes the Bookmarks and Inbox choices; anything
// else, or nothing, is where it always stood: above the list.
func TestDockerViewKeyLegendChoices(t *testing.T) {
	for in, want := range map[string]string{"": "above", "above": "above", "below": "below", "off": "off", "sideways": "above"} {
		s := Settings{DockerViewKeyLegend: in}
		normalizeDockerSettings(&s)
		if s.DockerViewKeyLegend != want {
			t.Errorf("%q -> %q, want %q", in, s.DockerViewKeyLegend, want)
		}
	}
}
