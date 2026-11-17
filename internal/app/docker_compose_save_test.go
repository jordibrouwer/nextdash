package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

const composeSaveOld = "services:\n  web:\n    image: nginx\n"
const composeSaveNew = "services:\n  web:\n    image: nginx:1.27\n"

// composeSaveFixture is composeFixture with control on, the file written, and
// the handlers handed back so a test can hold a lock.
func composeSaveFixture(t *testing.T) (f *fakeDocker, file string, h *Handlers, router http.Handler) {
	t.Helper()
	hostsTestDir(t)
	f = startFakeDocker(t)
	root := t.TempDir()
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "media-web-1", State: "running", Labels: map[string]string{
		composeLabelProject: "media", composeLabelWorkingDir: "/opt/stacks/media", composeLabelConfig: "/opt/stacks/media/compose.yml",
	}})
	t.Setenv("NEXTDASH_COMPOSE_MAP", "/opt/stacks:"+root)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	file = filepath.Join(root, "media/compose.yml")
	writeTestFile(t, file, composeSaveOld)
	h = dockerTestHandlers(t)
	return f, file, h, newDockerTestRouter(h)
}

func composeSaveBodyOf(content, sha string) string {
	b, _ := json.Marshal(map[string]string{"content": content, "sha256": sha})
	return string(b)
}

func composePut(t *testing.T, router http.Handler, query, body, token string) (int, map[string]any) {
	t.Helper()
	rec := hostsCall(t, router, "PUT", "/api/docker/compose/media/files?"+query, body, token)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestComposeSaveWritesAndBacksUp(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	code, out := composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, composeSha([]byte(composeSaveOld))), "")
	if code != 200 || out["ok"] != true || out["sha256"] != composeSha([]byte(composeSaveNew)) {
		t.Fatalf("%d %v", code, out)
	}
	if mustRead(t, file) != composeSaveNew {
		t.Fatal("file not written")
	}
	stamp, _ := out["backup"].(string)
	if !composeStamp.MatchString(stamp) {
		t.Fatalf("backup stamp = %q", stamp)
	}
	bak := filepath.Join(composeBackupDir("local", "media"), composeFileKey("/opt/stacks/media/compose.yml")+"."+stamp)
	if mustRead(t, bak) != composeSaveOld {
		t.Fatal("backup differs from the old bytes")
	}
	if fi, _ := os.Stat(bak); fi.Mode().Perm() != 0o600 {
		t.Errorf("backup mode = %v", fi.Mode().Perm())
	}
}

func TestComposeSaveGates(t *testing.T) {
	sha := composeSha([]byte(composeSaveOld))
	body := composeSaveBodyOf(composeSaveNew, sha)
	t.Run("control off", func(t *testing.T) {
		_, file, _, router := composeSaveFixture(t)
		t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
		code, out := composePut(t, router, "file=c0", body, "")
		if code != 403 || out["reason"] != reasonDockerControlOff || mustRead(t, file) != composeSaveOld {
			t.Fatalf("%d %v", code, out)
		}
	})
	t.Run("token", func(t *testing.T) {
		_, file, _, router := composeSaveFixture(t)
		t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
		for _, tok := range []string{"", "wrong"} {
			if code, _ := composePut(t, router, "file=c0", body, tok); code != 401 || mustRead(t, file) != composeSaveOld {
				t.Fatalf("token %q: %d", tok, code)
			}
		}
		if code, _ := composePut(t, router, "file=c0", body, "sekret"); code != 200 {
			t.Fatalf("with token: %d", code)
		}
	})
	t.Run("own stack", func(t *testing.T) {
		_, file, _, router := composeSaveFixture(t)
		dockerSelfOverride = strings.Repeat("a", 12)
		t.Cleanup(func() { dockerSelfOverride = "" })
		code, out := composePut(t, router, "file=c0", body, "")
		if code != 403 || out["reason"] != reasonDockerSelf || mustRead(t, file) != composeSaveOld {
			t.Fatalf("%d %v", code, out)
		}
	})
	t.Run("remote host", func(t *testing.T) {
		_, file, _, router := composeSaveFixture(t)
		remote, addr := startFakeDockerTCP(t)
		remote.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "r", State: "running", Labels: map[string]string{composeLabelProject: "media"}})
		host := addRemoteHost(t, addr, true)
		code, out := composePut(t, router, "file=c0&host="+host.ID, body, "")
		if code != 403 || out["reason"] != reasonDockerLocalOnly || mustRead(t, file) != composeSaveOld {
			t.Fatalf("%d %v", code, out)
		}
		if code, out := composePut(t, router, "file=c0&host=d_nope", body, ""); code != 404 || out["reason"] != reasonUnknownDockerHost {
			t.Fatalf("unknown host: %d %v", code, out)
		}
	})
	t.Run("busy", func(t *testing.T) {
		_, file, h, router := composeSaveFixture(t)
		release, ok := h.dockerLock("compose:media")
		if !ok {
			t.Fatal("lock")
		}
		code, out := composePut(t, router, "file=c0", body, "")
		release()
		if code != 409 || out["reason"] != "busy" || mustRead(t, file) != composeSaveOld {
			t.Fatalf("%d %v", code, out)
		}
	})
}

func TestComposeSavePathEscapeOnWrite(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	out := t.TempDir()
	target := filepath.Join(out, "x.yml")
	writeTestFile(t, target, composeSaveOld)
	// Swapped for a symlink after the editor loaded it.
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, file); err != nil {
		t.Fatal(err)
	}
	code, body := composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, composeSha([]byte(composeSaveOld))), "")
	if code != 403 || body["reason"] != composeOutside || mustRead(t, target) != composeSaveOld {
		t.Fatalf("%d %v", code, body)
	}
}

func TestComposeSaveRefusals(t *testing.T) {
	sha := composeSha([]byte(composeSaveOld))
	t.Run("broken yaml", func(t *testing.T) {
		_, file, _, router := composeSaveFixture(t)
		code, out := composePut(t, router, "file=c0", composeSaveBodyOf("services:\n  web:\n    image: [oops\n", sha), "")
		if code != 422 || out["reason"] != composeYAMLInvalid || out["line"].(float64) < 1 || out["column"] == nil || out["message"] == "" {
			t.Fatalf("%d %v", code, out)
		}
		if mustRead(t, file) != composeSaveOld {
			t.Fatal("file changed")
		}
		if n := len(listComposeBackups(composeBackupDir("local", "media"), composeFileKey("/opt/stacks/media/compose.yml"))); n != 0 {
			t.Errorf("%d backups for a refused save", n)
		}
	})
	t.Run("stale", func(t *testing.T) {
		_, file, _, router := composeSaveFixture(t)
		writeTestFile(t, file, composeSaveOld+"# edited elsewhere\n")
		code, out := composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, sha), "")
		if code != 409 || out["reason"] != composeStale || out["sha256"] != composeSha([]byte(composeSaveOld+"# edited elsewhere\n")) {
			t.Fatalf("%d %v", code, out)
		}
		if mustRead(t, file) != composeSaveOld+"# edited elsewhere\n" {
			t.Fatal("file changed")
		}
	})
	t.Run("no sha", func(t *testing.T) {
		_, _, _, router := composeSaveFixture(t)
		if code, _ := composePut(t, router, "file=c0", `{"content":"a: 1"}`, ""); code != 400 {
			t.Fatalf("%d", code)
		}
	})
	t.Run("unknown file id", func(t *testing.T) {
		_, _, _, router := composeSaveFixture(t)
		if code, _ := composePut(t, router, "file=/etc/passwd", composeSaveBodyOf("a: 1", sha), ""); code != 404 {
			t.Fatalf("%d", code)
		}
	})
	t.Run("too large", func(t *testing.T) {
		_, file, _, router := composeSaveFixture(t)
		code, out := composePut(t, router, "file=c0", composeSaveBodyOf(strings.Repeat("a", composeFileMax+1), sha), "")
		if code != 413 || out["reason"] != composeTooLarge || mustRead(t, file) != composeSaveOld {
			t.Fatalf("%d %v", code, out)
		}
	})
	t.Run("directory not writable", func(t *testing.T) {
		if os.Geteuid() == 0 {
			t.Skip("root writes anywhere")
		}
		_, file, _, router := composeSaveFixture(t)
		if err := os.Chmod(filepath.Dir(file), 0o555); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(filepath.Dir(file), 0o755) })
		code, out := composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, sha), "")
		if code != 403 || out["reason"] != composeDenied || !strings.Contains(out["message"].(string), "NEXTDASH_RUN_AS_ROOT=1") {
			t.Fatalf("%d %v", code, out)
		}
	})
	t.Run("backup cannot be written", func(t *testing.T) {
		if os.Geteuid() == 0 {
			t.Skip("root writes anywhere")
		}
		_, file, _, router := composeSaveFixture(t)
		dir := composeBackupDir("local", "media")
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(dir, 0o500); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
		code, out := composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, sha), "")
		if code != 500 || out["reason"] != composeBackupFailed || mustRead(t, file) != composeSaveOld {
			t.Fatalf("%d %v", code, out)
		}
	})
}

func TestComposeWriteRefusalMapsErrno(t *testing.T) {
	if code, b := composeWriteRefusal(&os.PathError{Op: "open", Err: syscall.EROFS}); code != 409 || b["reason"] != composeReadOnly {
		t.Errorf("EROFS: %d %v", code, b)
	}
	if code, b := composeWriteRefusal(&os.PathError{Op: "open", Err: syscall.EACCES}); code != 403 || b["reason"] != composeDenied {
		t.Errorf("EACCES: %d %v", code, b)
	}
}

func TestComposeSaveWarnsButSaves(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	next := "services:\n  web:\n    ports: ['80:80']\n"
	code, out := composePut(t, router, "file=c0", composeSaveBodyOf(next, composeSha([]byte(composeSaveOld))), "")
	if code != 200 || mustRead(t, file) != next {
		t.Fatalf("%d %v", code, out)
	}
	w := out["warnings"].([]any)
	if len(w) != 1 || w[0].(map[string]any)["line"].(float64) != 2 {
		t.Fatalf("warnings = %v", out["warnings"])
	}
}

func TestCheckComposeYAMLStructure(t *testing.T) {
	cases := []struct {
		name, src string
		first     bool
		want      int
	}{
		{"fine", "services:\n  a:\n    image: x\n  b:\n    build: .\n", true, 0},
		{"override has no image", "services:\n  a:\n    ports: ['1:1']\n", false, 0},
		{"extends", "services:\n  a:\n    extends:\n      file: x.yml\n      service: a\n", true, 0},
		{"include", "include:\n  - other.yml\n", true, 0},
		{"no services", "name: x\n", true, 1},
		{"list on top", "- a\n- b\n", true, 1},
		{"empty", "", true, 0},
	}
	for _, c := range cases {
		yerr, w := checkComposeYAML([]byte(c.src), c.first)
		if yerr != nil || len(w) != c.want {
			t.Errorf("%s: err=%v warnings=%v", c.name, yerr, w)
		}
	}
}

func TestComposeSaveKeepsMode(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	if err := os.Chmod(file, 0o640); err != nil {
		t.Fatal(err)
	}
	if code, out := composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, composeSha([]byte(composeSaveOld))), ""); code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	if fi, _ := os.Stat(file); fi.Mode().Perm() != 0o640 {
		t.Errorf("mode = %v", fi.Mode().Perm())
	}
	entries, _ := os.ReadDir(filepath.Dir(file))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".tmp-") {
			t.Errorf("staging file left behind: %s", e.Name())
		}
	}
}

func TestComposeSaveThroughSymlinkKeepsTheLink(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	root := filepath.Dir(filepath.Dir(file))
	real := filepath.Join(root, "real/compose.yml")
	writeTestFile(t, real, composeSaveOld)
	_ = os.Remove(file)
	if err := os.Symlink(real, file); err != nil {
		t.Fatal(err)
	}
	if code, out := composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, composeSha([]byte(composeSaveOld))), ""); code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	if fi, _ := os.Lstat(file); fi.Mode()&os.ModeSymlink == 0 {
		t.Error("the link was replaced by a file")
	}
	if mustRead(t, real) != composeSaveNew {
		t.Error("link target not written")
	}
}

func TestComposeEnvFileSaves(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	env := filepath.Join(filepath.Dir(file), ".env")
	writeTestFile(t, env, "A=1\n")
	code, out := composePut(t, router, "file=env", composeSaveBodyOf("A=2 # not yaml: [\n", composeSha([]byte("A=1\n"))), "")
	if code != 200 || mustRead(t, env) != "A=2 # not yaml: [\n" {
		t.Fatalf("%d %v", code, out)
	}
}

func TestComposeRawNeedsTheWriteToken(t *testing.T) {
	f, _, _, router := composeSaveFixture(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
	f.mu.Lock()
	f.calls = nil
	f.mu.Unlock()
	rec := hostsCall(t, router, "GET", "/api/docker/compose/media/files/raw?file=c0", "", "")
	if rec.Code != 401 || strings.Contains(rec.Body.String(), "nginx") || f.called("GET /containers") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	rec = hostsCall(t, router, "GET", "/api/docker/compose/media/files/raw?file=c0", "", "sekret")
	var out map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || out["content"] != composeSaveOld || out["sha256"] != composeSha([]byte(composeSaveOld)) || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

// ---- backups ----

func composeSaveN(t *testing.T, router http.Handler, file string, n int) {
	t.Helper()
	cur := mustRead(t, file)
	for i := 0; i < n; i++ {
		next := cur + fmt.Sprintf("# %d\n", i)
		code, out := composePut(t, router, "file=c0", composeSaveBodyOf(next, composeSha([]byte(cur))), "")
		if code != 200 {
			t.Fatalf("save %d: %d %v", i, code, out)
		}
		cur = next
	}
}

func TestComposeBackupsKeepTheNewest20(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	composeSaveN(t, router, file, 25)
	rec := hostsCall(t, router, "GET", "/api/docker/compose/media/backups?file=c0", "", "")
	var out struct {
		File    string
		Backups []composeBackup
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || out.File != "c0" || len(out.Backups) != 20 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	for i := 1; i < len(out.Backups); i++ {
		if out.Backups[i-1].Stamp <= out.Backups[i].Stamp {
			t.Fatalf("not newest first: %v", out.Backups)
		}
	}
	// The oldest five are gone, so the first original is not among them.
	entries, _ := os.ReadDir(composeBackupDir("local", "media"))
	if len(entries) != 20 {
		t.Errorf("%d files on disk", len(entries))
	}
}

func TestComposeBackupsListNeedsTheToken(t *testing.T) {
	_, _, _, router := composeSaveFixture(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
	if rec := hostsCall(t, router, "GET", "/api/docker/compose/media/backups?file=c0", "", ""); rec.Code != 401 {
		t.Fatalf("%d", rec.Code)
	}
}

func composeRestore(router http.Handler, t *testing.T, stamp, sha string) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"sha256": sha})
	rec := hostsCall(t, router, "POST", "/api/docker/compose/media/backups/"+stamp+"/restore?file=c0", string(b), "")
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestComposeRestoreBacksUpTheCurrentFileFirst(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	composeSaveN(t, router, file, 1) // the backup now holds composeSaveOld
	dir, key := composeBackupDir("local", "media"), composeFileKey("/opt/stacks/media/compose.yml")
	before := listComposeBackups(dir, key)
	if len(before) != 1 {
		t.Fatalf("backups = %v", before)
	}
	current := mustRead(t, file)
	code, out := composeRestore(router, t, before[0].Stamp, composeSha([]byte(current)))
	if code != 200 || out["ok"] != true || mustRead(t, file) != composeSaveOld {
		t.Fatalf("%d %v", code, out)
	}
	after := listComposeBackups(dir, key)
	if len(after) != 2 {
		t.Fatalf("a restore leaves one more backup, got %v", after)
	}
	if got := mustRead(t, filepath.Join(dir, key+"."+out["backup"].(string))); got != current {
		t.Errorf("pre-restore backup = %q", got)
	}
}

func TestComposeRestoreRefusals(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	composeSaveN(t, router, file, 1)
	dir, key := composeBackupDir("local", "media"), composeFileKey("/opt/stacks/media/compose.yml")
	stamp := listComposeBackups(dir, key)[0].Stamp
	current := mustRead(t, file)
	if code, out := composeRestore(router, t, stamp, composeSha([]byte("something else"))); code != 409 || out["reason"] != composeStale || mustRead(t, file) != current {
		t.Fatalf("stale: %d %v", code, out)
	}
	for _, bad := range []string{"20000101T000000Z", "20261116T101500Z.bak", "x"} {
		if code, _ := composeRestore(router, t, bad, composeSha([]byte(current))); code != 404 {
			t.Errorf("stamp %q: %d", bad, code)
		}
	}
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
	if code, _ := composeRestore(router, t, stamp, composeSha([]byte(current))); code != 403 || mustRead(t, file) != current {
		t.Errorf("control off: %d", code)
	}
}

func TestComposeBackupKeyDiffersByPath(t *testing.T) {
	a, b := composeFileKey("/a/compose.yml"), composeFileKey("/b/compose.yml")
	if a == b || !strings.HasPrefix(a, "compose.yml-") || len(a) != len("compose.yml-")+8 {
		t.Errorf("keys %q %q", a, b)
	}
}

func TestComposeBackupRawServesOnlyListedCopies(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	composeSaveN(t, router, file, 1)
	dir, key := composeBackupDir("local", "media"), composeFileKey("/opt/stacks/media/compose.yml")
	stamp := listComposeBackups(dir, key)[0].Stamp
	rec := hostsCall(t, router, "GET", "/api/docker/compose/media/backups/"+stamp+"/raw?file=c0", "", "")
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || out["content"] != composeSaveOld {
		t.Fatalf("%d %v", rec.Code, out)
	}
	for _, bad := range []string{"20000101T000000Z", "20261116T101500Z.bak", "x"} {
		if rec := hostsCall(t, router, "GET", "/api/docker/compose/media/backups/"+bad+"/raw?file=c0", "", ""); rec.Code != 404 {
			t.Errorf("stamp %q: %d", bad, rec.Code)
		}
	}
	t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
	if rec := hostsCall(t, router, "GET", "/api/docker/compose/media/backups/"+stamp+"/raw?file=c0", "", ""); rec.Code != 401 {
		t.Errorf("without the token: %d", rec.Code)
	}
}

func TestComposeWriteRefusalMountAndPerms(t *testing.T) {
	if code, b := composeWriteRefusal(errComposeFileMount); code != 409 || b["reason"] != composeFileMount || b["message"] == "" {
		t.Errorf("mount: %d %v", code, b)
	}
	if code, b := composeWriteRefusal(syscall.EPERM); code != 403 || b["reason"] != composeDenied {
		t.Errorf("EPERM: %d %v", code, b)
	}
	if !composeNoPermsFS(syscall.EPERM) || composeNoPermsFS(syscall.ENOSPC) {
		t.Error("composeNoPermsFS must accept EPERM and refuse ENOSPC")
	}
}

func TestComposeWriteKeepsInodeWhenTheFileIsSomebodyElses(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root renames and chowns")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "compose.yml")
	writeTestFile(t, path, "old\n")
	before, _ := os.Stat(path)
	f := composeFile{Local: path, Mode: 0644, UID: os.Geteuid() + 1}
	if _, err := writeComposeFile(f, []byte("new\n")); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(path)
	if !os.SameFile(before, after) || mustRead(t, path) != "new\n" {
		t.Error("a file owned by somebody else must be written in place")
	}
	// Our own file still goes through stage and rename (atomic), and leaves no temp file.
	g := composeFile{Local: path, Mode: 0644, UID: os.Geteuid()}
	if _, err := writeComposeFile(g, []byte("third\n")); err != nil {
		t.Fatal(err)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".tmp-*")); len(left) != 0 || mustRead(t, path) != "third\n" {
		t.Errorf("rename path: %v", left)
	}
}

// F15: nothing the masked view consumes after a save or a restore is raw text.
func TestComposeSaveAndRestoreAnswersCarryNoRawText(t *testing.T) {
	_, file, _, router := composeSaveFixture(t)
	secret := "services:\n  web:\n    image: x\n    environment:\n      DB_PASSWORD: raw-save-secret\n"
	rec := hostsCall(t, router, "PUT", "/api/docker/compose/media/files?file=c0", composeSaveBodyOf(secret, composeSha([]byte(composeSaveOld))), "")
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || strings.Contains(rec.Body.String(), "raw-save-secret") || out["content"] != nil || out["sha256"] != composeSha([]byte(secret)) {
		t.Fatalf("save answer: %d %s", rec.Code, rec.Body)
	}
	stamp, _ := out["backup"].(string)
	if stamp == "" {
		t.Fatal("no backup stamp")
	}
	code, rout := composeRestore(router, t, stamp, composeSha([]byte(secret)))
	raw, _ := json.Marshal(rout)
	if code != 200 || strings.Contains(string(raw), "raw-save-secret") || strings.Contains(string(raw), composeSaveOld) || rout["content"] != nil {
		t.Fatalf("restore answer: %d %s", code, raw)
	}
	_ = file
}
