package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// composeFixture starts a fake daemon with one stack ("media") whose labels
// name files under a temp dir, and maps /opt/stacks to that dir.
func composeFixture(t *testing.T, config string) (f *fakeDocker, root string, router http.Handler) {
	t.Helper()
	hostsTestDir(t)
	f = startFakeDocker(t)
	root = t.TempDir()
	labels := map[string]string{
		composeLabelProject:    "media",
		composeLabelWorkingDir: "/opt/stacks/media",
	}
	if config != "" {
		labels[composeLabelConfig] = config
	}
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "media-web-1", State: "running", Labels: labels})
	t.Setenv("NEXTDASH_COMPOSE_MAP", "/opt/stacks:"+root)
	return f, root, newDockerTestRouter(dockerTestHandlers(t))
}

func composeGet(t *testing.T, router http.Handler, path, token string) (int, map[string]any, string) {
	t.Helper()
	rec := hostsCall(t, router, "GET", path, "", token)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec.Code, body, rec.Body.String()
}

const composeAPIFile = "services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: hunter2\n      USER: app\n"

func composeFileState(t *testing.T, body map[string]any, id string) map[string]any {
	t.Helper()
	for _, x := range body["files"].([]any) {
		if m := x.(map[string]any); m["id"] == id {
			return m
		}
	}
	t.Fatalf("no file %q in %v", id, body["files"])
	return nil
}

func TestComposeFilesOKMasksAndHashes(t *testing.T) {
	_, root, router := composeFixture(t, "/opt/stacks/media/compose.yml")
	writeTestFile(t, filepath.Join(root, "media/compose.yml"), composeAPIFile)
	writeTestFile(t, filepath.Join(root, "media/.env"), "DB_PASS=hunter2\n")
	code, body, raw := composeGet(t, router, "/api/docker/compose/media/files", "")
	if code != 200 || body["state"] != "ok" {
		t.Fatalf("%d %s", code, raw)
	}
	if strings.Contains(raw, "hunter2") {
		t.Fatalf("a secret left in the read answer: %s", raw)
	}
	c0 := composeFileState(t, body, "c0")
	if c0["state"] != "ok" || c0["role"] != "compose" || len(c0["sha256"].(string)) != 64 || c0["size"].(float64) != float64(len(composeAPIFile)) {
		t.Errorf("c0 = %v", c0)
	}
	if !strings.Contains(c0["content"].(string), "POSTGRES_PASSWORD: "+composeMask) {
		t.Errorf("content = %v", c0["content"])
	}
	if m := c0["masked"].([]any); len(m) != 1 || m[0].(map[string]any)["key"] != "services.db.environment.POSTGRES_PASSWORD" {
		t.Errorf("masked = %v", m)
	}
	env := composeFileState(t, body, "env")
	if env["role"] != "env" || strings.Contains(env["content"].(string), "hunter2") {
		t.Errorf("env = %v", env)
	}
	if body["workingDir"] != "/opt/stacks/media" || body["self"] != false || body["host"] != "local" {
		t.Errorf("body = %v", body)
	}
	if s := body["suggest"].(map[string]any); s["env"] != "NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks" || s["mount"] != "/opt/stacks:/stacks:ro" {
		t.Errorf("suggest = %v", s)
	}
}

func TestComposeFilesStates(t *testing.T) {
	t.Run("no labels", func(t *testing.T) {
		_, _, router := composeFixture(t, "")
		_, body, _ := composeGet(t, router, "/api/docker/compose/media/files", "")
		if body["state"] != composeNoLabels || len(body["files"].([]any)) != 0 {
			t.Fatalf("body = %v", body)
		}
	})
	t.Run("unmapped gives the lines to add", func(t *testing.T) {
		_, _, router := composeFixture(t, "/srv/other/media/compose.yml")
		_, body, _ := composeGet(t, router, "/api/docker/compose/media/files", "")
		if f := composeFileState(t, body, "c0"); f["state"] != composeUnmapped || f["hostPath"] != "/srv/other/media/compose.yml" {
			t.Fatalf("c0 = %v", f)
		}
		if body["suggest"].(map[string]any)["env"] == "" {
			t.Fatal("no suggestion")
		}
	})
	t.Run("missing", func(t *testing.T) {
		_, _, router := composeFixture(t, "/opt/stacks/media/compose.yml")
		_, body, _ := composeGet(t, router, "/api/docker/compose/media/files", "")
		if f := composeFileState(t, body, "c0"); f["state"] != composeMissing {
			t.Fatalf("c0 = %v", f)
		}
	})
	t.Run("denied", func(t *testing.T) {
		if os.Geteuid() == 0 {
			t.Skip("root reads everything")
		}
		_, root, router := composeFixture(t, "/opt/stacks/media/compose.yml")
		p := filepath.Join(root, "media/compose.yml")
		writeTestFile(t, p, composeAPIFile)
		if err := os.Chmod(p, 0); err != nil {
			t.Fatal(err)
		}
		_, body, _ := composeGet(t, router, "/api/docker/compose/media/files", "")
		if f := composeFileState(t, body, "c0"); f["state"] != composeDenied || f["content"] != "" {
			t.Fatalf("c0 = %v", f)
		}
	})
	t.Run("outside", func(t *testing.T) {
		_, root, router := composeFixture(t, "/opt/stacks/media/compose.yml")
		out := t.TempDir()
		writeTestFile(t, filepath.Join(out, "x.yml"), composeAPIFile)
		if err := os.MkdirAll(filepath.Join(root, "media"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join(out, "x.yml"), filepath.Join(root, "media/compose.yml")); err != nil {
			t.Fatal(err)
		}
		_, body, raw := composeGet(t, router, "/api/docker/compose/media/files", "")
		if f := composeFileState(t, body, "c0"); f["state"] != composeOutside || strings.Contains(raw, "POSTGRES") {
			t.Fatalf("c0 = %v", f)
		}
	})
	t.Run("broken yaml still masks and reports", func(t *testing.T) {
		_, root, router := composeFixture(t, "/opt/stacks/media/compose.yml")
		writeTestFile(t, filepath.Join(root, "media/compose.yml"), "a:\n  DB_PASSWORD: hunter2\n  b: [\n")
		_, body, raw := composeGet(t, router, "/api/docker/compose/media/files", "")
		f := composeFileState(t, body, "c0")
		if f["yamlError"] == nil || strings.Contains(raw, "hunter2") {
			t.Fatalf("c0 = %v", f)
		}
	})
}

func TestComposeFilesOwnStackIsMarked(t *testing.T) {
	_, root, router := composeFixture(t, "/opt/stacks/media/compose.yml")
	writeTestFile(t, filepath.Join(root, "media/compose.yml"), composeAPIFile)
	dockerSelfOverride = strings.Repeat("a", 12)
	t.Cleanup(func() { dockerSelfOverride = "" })
	_, body, _ := composeGet(t, router, "/api/docker/compose/media/files", "")
	if body["self"] != true {
		t.Fatalf("self = %v", body["self"])
	}
	if composeFileState(t, body, "c0")["state"] != "ok" {
		t.Fatal("the own stack stays readable")
	}
}

func TestComposeFilesGates(t *testing.T) {
	_, root, router := composeFixture(t, "/opt/stacks/media/compose.yml")
	writeTestFile(t, filepath.Join(root, "media/compose.yml"), composeAPIFile)
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "r", State: "running", Labels: map[string]string{composeLabelProject: "media", composeLabelConfig: "/opt/stacks/media/compose.yml"}})
	host := addRemoteHost(t, addr, true)

	code, _, raw := composeGet(t, router, "/api/docker/compose/media/files?host="+host.ID, "")
	if code != http.StatusForbidden || !strings.Contains(raw, reasonDockerLocalOnly) {
		t.Errorf("remote: %d %s", code, raw)
	}
	if remote.called("GET /containers") {
		t.Error("a remote host's daemon must not be asked")
	}
	if code, _, raw := composeGet(t, router, "/api/docker/compose/media/files?host=d_nope", ""); code != 404 || !strings.Contains(raw, reasonUnknownDockerHost) {
		t.Errorf("unknown host: %d %s", code, raw)
	}
	if code, _, _ := composeGet(t, router, "/api/docker/compose/other/files", ""); code != 404 {
		t.Errorf("unknown project: %d", code)
	}
	for _, bad := range []string{"Media", "a%2Fb", "-x", "a.b"} {
		if code, _, _ := composeGet(t, router, "/api/docker/compose/"+bad+"/files", ""); code != 404 {
			t.Errorf("project %q: %d", bad, code)
		}
	}
	// A path in the request is never used: the file id does not exist, and the
	// plain read ignores ?file=.
	code, body, raw := composeGet(t, router, "/api/docker/compose/media/files?file=/etc/passwd", "")
	if code != 200 || strings.Contains(raw, "root:") || composeFileState(t, body, "c0")["hostPath"] != "/opt/stacks/media/compose.yml" {
		t.Errorf("file param: %d %s", code, raw)
	}
	if code, _, _ := composeGet(t, router, "/api/docker/compose/media/files/value?file=/etc/passwd&key=x", ""); code != 404 {
		t.Errorf("value with a path as file: %d", code)
	}
}

func TestComposeStatusCarriesTheMap(t *testing.T) {
	_, _, router := composeFixture(t, "/opt/stacks/media/compose.yml")
	t.Setenv("NEXTDASH_COMPOSE_MAP", "/opt/stacks:/stacks,bad")
	_, body, raw := composeGet(t, router, "/api/docker/status", "")
	c, _ := body["compose"].(map[string]any)
	if c == nil || len(c["map"].([]any)) != 1 || len(c["rejected"].([]any)) != 1 {
		t.Fatalf("compose = %v (%s)", c, raw)
	}
}

func TestComposeValueRevealsOnlyMaskedKeys(t *testing.T) {
	_, root, router := composeFixture(t, "/opt/stacks/media/compose.yml")
	writeTestFile(t, filepath.Join(root, "media/compose.yml"), composeAPIFile)
	writeTestFile(t, filepath.Join(root, "media/.env"), "DB_PASS=hunter9\n")
	base := "/api/docker/compose/media/files/value?"
	rec := hostsCall(t, router, "GET", base+"file=c0&key=services.db.environment.POSTGRES_PASSWORD", "", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"value":"hunter2"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q", rec.Header().Get("Cache-Control"))
	}
	if rec := hostsCall(t, router, "GET", base+"file=env&key=DB_PASS", "", ""); !strings.Contains(rec.Body.String(), "hunter9") {
		t.Errorf("env reveal: %d %s", rec.Code, rec.Body)
	}
	for _, q := range []string{"file=c0&key=services.db.environment.USER", "file=c0&key=", "file=c0", "file=nope&key=x", "file=env&key=NOPE"} {
		if rec := hostsCall(t, router, "GET", base+q, "", ""); rec.Code != 404 {
			t.Errorf("%s: %d", q, rec.Code)
		}
	}
	if code, _, raw := composeGet(t, router, base+"file=c0&key=x&host=d_x", ""); code != 404 || !strings.Contains(raw, reasonUnknownDockerHost) {
		t.Errorf("unknown host: %d %s", code, raw)
	}
}

// The token gate comes before anything is read: with a token set and none sent,
// the answer is 401 and neither the daemon nor the file is touched.
func TestComposeValueNeedsTheWriteToken(t *testing.T) {
	f, root, router := composeFixture(t, "/opt/stacks/media/compose.yml")
	writeTestFile(t, filepath.Join(root, "media/compose.yml"), composeAPIFile)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
	path := "/api/docker/compose/media/files/value?file=c0&key=services.db.environment.POSTGRES_PASSWORD"
	f.mu.Lock()
	f.calls = nil
	f.mu.Unlock()
	for _, tok := range []string{"", "wrong"} {
		rec := hostsCall(t, router, "GET", path, "", tok)
		if rec.Code != http.StatusUnauthorized || strings.Contains(rec.Body.String(), "hunter2") {
			t.Fatalf("token %q: %d %s", tok, rec.Code, rec.Body)
		}
	}
	if f.called("GET /containers") {
		t.Fatal("the daemon was asked before the token was checked")
	}
	rec := hostsCall(t, router, "GET", path, "", "sekret")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "hunter2") {
		t.Fatalf("with the token: %d %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("no-store missing")
	}
	// The plain read needs no token, and still shows no secret.
	if code, _, raw := composeGet(t, router, "/api/docker/compose/media/files", ""); code != 200 || strings.Contains(raw, "hunter2") {
		t.Errorf("read: %d", code)
	}
}
