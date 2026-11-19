package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// ---- fixture ----

const r3WebID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func r3Fixture(t *testing.T) (*fakeDocker, string, *Handlers, http.Handler) {
	t.Helper()
	f, file, h, router := composeSaveFixture(t)
	t.Setenv("NEXTDASH_COMPOSE_SOCKET", "")
	f.images[composeRunHelperImage] = fakeImage{ID: "sha256:helper"}
	f.mu.Lock()
	c := f.containers[r3WebID]
	c.Labels[composeLabelService] = "web"
	c.Image = "nginx:1.0"
	f.mu.Unlock()
	composeWatchResetForTest()
	if st := h.store.GetSettings(); !st.DockerNotify {
		st.DockerNotify = true
		if err := h.store.SaveSettings(st); err != nil {
			t.Fatal(err)
		}
	}
	oldW, oldI := composeWatchWindow, composeWatchInterval
	composeWatchWindow, composeWatchInterval = 400*time.Millisecond, 20*time.Millisecond
	oldTTL := composeSetupTTL
	composeSetupTTL = 0
	t.Cleanup(func() {
		composeWatchResetForTest()
		composeWatchWindow, composeWatchInterval = oldW, oldI
		composeSetupTTL = oldTTL
		dockerStatsStore.reset()
	})
	return f, file, h, router
}

func r3Do(t *testing.T, router http.Handler, method, path, body, token string) (int, map[string]any, string) {
	t.Helper()
	rec := hostsCall(t, router, method, path, body, token)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out, rec.Body.String()
}

func r3JSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func r3Project() composeProject {
	return composeProject{Name: "media", WorkingDir: "/opt/stacks/media", ConfigFiles: []string{"/opt/stacks/media/compose.yml"}}
}

func r3Wait(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func r3WatchState(t *testing.T, router http.Handler) map[string]any {
	t.Helper()
	_, out, _ := r3Do(t, router, "GET", "/api/docker/compose/media/watch", "", "")
	return out
}

func r3StateIs(t *testing.T, router http.Handler, want string) func() bool {
	return func() bool { return r3WatchState(t, router)["state"] == want }
}

// ---- item 1: the variable check ----

const r3VarsFile = `services:
  web:
    image: nginx:${TAG}
    environment:
      - PUID=${PUID}
      - TZ=${TZ:-UTC}
      - KEY=${VPN_KEY:?set it in .env}
      - EXTRA=${EXTRA_ARGS}
      - HOME_ESCAPED=$$HOME
    env_file: ./vpn.env
  api:
    image: x
    command: echo ${PUID}
    env_file:
      - path: ./opt.env
        required: false
`

func TestComposeVarCheckReport(t *testing.T) {
	_, file, _, _ := r3Fixture(t)
	dir := filepath.Dir(file)
	writeTestFile(t, file, r3VarsFile)
	writeTestFile(t, filepath.Join(dir, ".env"), "EXTRA_ARGS=\nTAG=1\n")
	rep := composeVarCheck(r3Project(), nil)
	if rep.State != composeVarBlocked || !rep.Blocked {
		t.Fatalf("state = %s", rep.State)
	}
	byVar := map[string]composeVarIssue{}
	var missing *composeVarIssue
	for i, is := range rep.Issues {
		if is.Var != "" {
			byVar[is.Var] = is
		} else {
			missing = &rep.Issues[i]
		}
	}
	if v := byVar["VPN_KEY"]; v.Level != composeVarBlocked || v.Reason != composeVarReasonRequired || v.Message != "set it in .env" || len(v.Uses) != 1 || v.Uses[0].Service != "web" || v.Uses[0].File != "c0" || v.Uses[0].Line != 7 {
		t.Errorf("VPN_KEY = %+v", v)
	}
	puid := byVar["PUID"]
	if puid.Level != composeVarWarning || puid.Reason != composeVarReasonUnset || len(puid.Uses) != 2 || puid.Uses[0].Service != "api" || puid.Uses[1].Service != "web" {
		t.Errorf("PUID = %+v", puid)
	}
	if _, bad := byVar["TZ"]; bad {
		t.Error("TZ has a default and must not be an issue")
	}
	if _, bad := byVar["EXTRA_ARGS"]; bad {
		t.Error("EXTRA_ARGS is set empty on purpose and must not be an issue")
	}
	if _, bad := byVar["HOME"]; bad {
		t.Error("$$HOME is an escape")
	}
	if !reflect.DeepEqual(rep.Empty, []string{"EXTRA_ARGS"}) || !reflect.DeepEqual(rep.Defaulted, []string{"TZ"}) {
		t.Errorf("empty = %v, defaulted = %v", rep.Empty, rep.Defaulted)
	}
	if missing == nil || missing.Reason != composeVarReasonEnvFileMissing || missing.Level != composeVarBlocked || missing.Path != "/opt/stacks/media/vpn.env" || missing.Uses[0].Service != "web" {
		t.Errorf("missing env_file = %+v", missing)
	}
	for _, is := range rep.Issues {
		if is.Path == "/opt/stacks/media/opt.env" {
			t.Error("a required:false env_file must not block")
		}
	}
	if rep.Used != 5 {
		t.Errorf("used = %d", rep.Used)
	}
}

func TestComposeVarCheckWarningOnly(t *testing.T) {
	_, file, _, _ := r3Fixture(t)
	writeTestFile(t, file, "services:\n  web:\n    image: nginx\n    environment:\n      - A=${A}\n")
	rep := composeVarCheck(r3Project(), nil)
	if rep.State != composeVarWarning || rep.Blocked || len(rep.Issues) != 1 {
		t.Fatalf("%+v", rep)
	}
	writeTestFile(t, filepath.Join(filepath.Dir(file), ".env"), "A=1\n")
	if rep := composeVarCheck(r3Project(), nil); rep.State != composeVarOK || len(rep.Issues) != 0 {
		t.Errorf("%+v", rep)
	}
}

func TestComposeCheckAnswersTheVarCheck(t *testing.T) {
	f, file, _, router := r3Fixture(t)
	writeTestFile(t, file, "services:\n  web:\n    image: nginx\n    environment:\n      - A=${A}\n")
	f.helperLogs = []string{`level=warning msg="The \"A\" variable is not set."`}
	code, out, raw := r3Do(t, router, "POST", "/api/docker/compose/media/check", "", "")
	if code != 200 || out["ok"] != true || !reflect.DeepEqual(anyStrings(out["unsetVars"]), []string{"A"}) {
		t.Fatalf("old fields moved: %d %s", code, raw)
	}
	vc := out["varCheck"].(map[string]any)
	if vc["state"] != "warning" || len(vc["issues"].([]any)) != 1 {
		t.Fatalf("varCheck = %v", vc)
	}
	// An unsaved .env stands in: the staged text sets the variable.
	body := r3JSON(map[string]any{"file": "env", "content": "A=1\n"})
	writeTestFile(t, filepath.Join(filepath.Dir(file), ".env"), "OTHER=1\n")
	code, out, raw = r3Do(t, router, "POST", "/api/docker/compose/media/check", body, "")
	if code != 200 || out["varCheck"].(map[string]any)["state"] != "ok" {
		t.Fatalf("staged: %d %s", code, raw)
	}
}

func TestComposeInvalidCheckAndUpRefusalCarryTheVarCheck(t *testing.T) {
	f, file, _, router := r3Fixture(t)
	writeTestFile(t, file, "services:\n  web:\n    image: nginx\n    environment:\n      - A=${A}\n")
	f.helperExit = 1
	f.helperLogs = []string{"line 3: boom"}
	code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/check", "", "")
	if code != 422 || out["reason"] != composeInvalid || out["varCheck"] == nil {
		t.Fatalf("check: %d %v", code, out)
	}
	code, out, _ = r3Do(t, router, "POST", "/api/docker/compose/media/up", "", "")
	if code != 422 || out["varCheck"] == nil {
		t.Fatalf("up invalid: %d %v", code, out)
	}
	f.mu.Lock()
	f.helperExit = 0
	f.mu.Unlock()
	f.helperLogs = []string{`msg="The \"A\" variable is not set."`}
	code, out, _ = r3Do(t, router, "POST", "/api/docker/compose/media/up", "", "")
	vc, _ := out["varCheck"].(map[string]any)
	if code != 409 || out["reason"] != composeUnsetVars || vc == nil || vc["state"] != "warning" || !reflect.DeepEqual(anyStrings(out["names"]), []string{"A"}) {
		t.Fatalf("up unset: %d %v", code, out)
	}
}

// ---- item 2: the Up preview ----

const r3PlanFile = "services:\n  web:\n    image: nginx:1.27\n    ports:\n      - \"8081:80\"\n  db:\n    image: postgres:16\n  cache:\n    image: redis:7\n"

func r3PlanFixture(t *testing.T) (*fakeDocker, string, http.Handler) {
	f, file, _, router := r3Fixture(t)
	writeTestFile(t, file, r3PlanFile)
	lbl := func(svc string) map[string]string {
		return map[string]string{composeLabelProject: "media", composeLabelWorkingDir: "/opt/stacks/media", composeLabelConfig: "/opt/stacks/media/compose.yml", composeLabelService: svc}
	}
	f.mu.Lock()
	f.containers[r3WebID].Ports = []map[string]any{{"PrivatePort": 80, "PublicPort": 8080, "Type": "tcp"}}
	f.mu.Unlock()
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "media-db-1", State: "running", Image: "postgres:16", Labels: lbl("db")})
	f.add(fakeContainer{ID: strings.Repeat("c", 64), Name: "media-old-1", State: "running", Image: "x", Labels: lbl("old")})
	f.helperLogs = []string{
		" DRY-RUN MODE -  Container media-web-1  Recreate",
		" DRY-RUN MODE -  Container media-web-1  Recreated",
		" DRY-RUN MODE -  Container media-cache-1  Creating",
		" DRY-RUN MODE -  Container media-db-1  Running",
		" DRY-RUN MODE -  Network media_default  Running",
	}
	return f, file, router
}

func r3Entries(out map[string]any, bucket string) map[string]map[string]any {
	res := map[string]map[string]any{}
	for _, e := range out[bucket].([]any) {
		m := e.(map[string]any)
		res[m["container"].(string)] = m
	}
	return res
}

func TestComposePreviewSortsTheDryRun(t *testing.T) {
	f, _, router := r3PlanFixture(t)
	code, out, raw := r3Do(t, router, "POST", "/api/docker/compose/media/preview", "", "")
	if code != 200 || out["ok"] != true {
		t.Fatalf("%d %s", code, raw)
	}
	rec := r3Entries(out, "recreate")
	web := rec["media-web-1"]
	if web == nil || web["service"] != "web" || web["reason"] != composeReasonImage {
		t.Fatalf("recreate = %v", rec)
	}
	codes := []string{}
	for _, r := range web["reasons"].([]any) {
		codes = append(codes, r.(map[string]any)["code"].(string))
	}
	if !reflect.DeepEqual(codes, []string{"image", "ports"}) {
		t.Errorf("reasons = %v", codes)
	}
	first := web["reasons"].([]any)[0].(map[string]any)
	if first["from"] != "nginx:1.0" || first["to"] != "nginx:1.27" {
		t.Errorf("image reason = %v", first)
	}
	if c := r3Entries(out, "create")["media-cache-1"]; c == nil || c["service"] != "cache" || c["reason"] != composeReasonNewService {
		t.Errorf("create = %v", out["create"])
	}
	if u := r3Entries(out, "unchanged")["media-db-1"]; u == nil || u["reason"] != composeReasonSameConfig {
		t.Errorf("unchanged = %v", out["unchanged"])
	}
	o := r3Entries(out, "orphans")["media-old-1"]
	if o == nil || o["reason"] != composeReasonNotInFile || o["willRemove"] == true {
		t.Errorf("orphans = %v", out["orphans"])
	}
	if out["changes"].(float64) != 2 || out["noop"] != false || out["removeOrphans"] != false {
		t.Errorf("counts = %v", out)
	}
	// Dry run only: the helper ran `up -d --dry-run` and nothing else.
	cmd := anyStrings(createsOf(f)[0]["Cmd"])
	if !reflect.DeepEqual(cmd[len(cmd)-3:], []string{"up", "-d", "--dry-run"}) {
		t.Errorf("Cmd = %v", cmd)
	}
	composeAllHelpersRemoved(t, f)
}

func TestComposePreviewWithRemoveOrphans(t *testing.T) {
	f, _, router := r3PlanFixture(t)
	code, out, raw := r3Do(t, router, "POST", "/api/docker/compose/media/preview", `{"removeOrphans":true}`, "")
	if code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	cmd := anyStrings(createsOf(f)[0]["Cmd"])
	if !reflect.DeepEqual(cmd[len(cmd)-4:], []string{"up", "-d", "--dry-run", "--remove-orphans"}) {
		t.Errorf("Cmd = %v", cmd)
	}
	o := r3Entries(out, "orphans")["media-old-1"]
	if o == nil || o["willRemove"] != true || out["changes"].(float64) != 3 {
		t.Errorf("%v", out)
	}
}

func TestComposePreviewOfUnsavedText(t *testing.T) {
	f, file, router := r3PlanFixture(t)
	body := r3JSON(map[string]any{"file": "c0", "content": "services:\n  web:\n    image: nginx:9\n"})
	code, _, raw := r3Do(t, router, "POST", "/api/docker/compose/media/preview", body, "")
	if code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	b := createsOf(f)[0]
	if env := anyStrings(b["Env"]); len(env) != 1 || !strings.Contains(env[0], "nginx:9") {
		t.Errorf("Env = %v", b["Env"])
	}
	if mustRead(t, file) != r3PlanFile {
		t.Error("a preview must write nothing")
	}
	// Not YAML: refused before any helper.
	n := len(createsOf(f))
	code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/preview", r3JSON(map[string]any{"file": "c0", "content": "a: [\n"}), "")
	if code != 422 || out["reason"] != composeYAMLInvalid || len(createsOf(f)) != n {
		t.Errorf("%d %v", code, out)
	}
}

func TestComposePreviewTooOld(t *testing.T) {
	f, _, router := r3PlanFixture(t)
	f.helperExitSeq = []int{125, 0}
	f.helperLogs = []string{"unknown flag: --dry-run", "2.17.3"}
	code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/preview", "", "")
	if code != 422 || out["reason"] != composeTooOld || out["needs"] != composeMinVersion || out["image"] != composeRunHelperImage {
		t.Fatalf("%d %v", code, out)
	}
	if out["version"] != "2.17.3" && out["version"] != nil {
		t.Errorf("version = %v", out["version"])
	}
	composeAllHelpersRemoved(t, f)
}

func TestComposePreviewInvalidFile(t *testing.T) {
	f, _, router := r3PlanFixture(t)
	f.helperExit = 1
	f.helperLogs = []string{"yaml: line 4: did not find expected key"}
	code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/preview", "", "")
	if code != 422 || out["reason"] != composeInvalid || out["line"].(float64) != 4 {
		t.Fatalf("%d %v", code, out)
	}
}

func TestComposeUpRemoveOrphansFlag(t *testing.T) {
	f, _, _, router := r3Fixture(t)
	if code, _, raw := r3Do(t, router, "POST", "/api/docker/compose/media/up", "", ""); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	upCmd := func(b map[string]any) []string { c := anyStrings(b["Cmd"]); return c[len(c)-2:] }
	creates := createsOf(f)
	if got := upCmd(creates[len(creates)-1]); !reflect.DeepEqual(got, []string{"up", "-d"}) {
		t.Errorf("default Up = %v", got)
	}
	if code, _, raw := r3Do(t, router, "POST", "/api/docker/compose/media/up?removeOrphans=1", "", ""); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	creates = createsOf(f)
	cmd := anyStrings(creates[len(creates)-1]["Cmd"])
	if !reflect.DeepEqual(cmd[len(cmd)-3:], []string{"up", "-d", "--remove-orphans"}) {
		t.Errorf("Up with orphans = %v", cmd)
	}
	// A service run never removes the stack's orphans.
	n := len(createsOf(f))
	code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/up?service=web&removeOrphans=1", "", "")
	if code != 422 || out["reason"] != composeOrphansNeedStack || len(createsOf(f)) != n {
		t.Errorf("%d %v", code, out)
	}
	// Pull has nothing to remove: the flag is ignored.
	if code, _, _ := r3Do(t, router, "POST", "/api/docker/compose/media/pull?removeOrphans=1", "", ""); code != 200 {
		t.Errorf("pull: %d", code)
	}
	creates = createsOf(f)
	if strings.Contains(strings.Join(anyStrings(creates[len(creates)-1]["Cmd"]), " "), "remove-orphans") {
		t.Error("pull got --remove-orphans")
	}
}

// ---- the gates of the new write routes ----

func TestComposeNewWriteRoutesAreGated(t *testing.T) {
	routes := []struct{ method, path, body string }{
		{"POST", "/api/docker/compose/media/preview", ""},
		{"POST", "/api/docker/compose/media/up?removeOrphans=1", ""},
		{"POST", "/api/docker/compose/media/watch/restore", ""},
		{"POST", "/api/docker/compose/media/watch/dismiss", ""},
	}
	t.Run("own stack", func(t *testing.T) {
		f, _, _, router := r3Fixture(t)
		dockerSelfOverride = strings.Repeat("a", 12)
		t.Cleanup(func() { dockerSelfOverride = "" })
		for _, r := range routes[:3] {
			code, out, _ := r3Do(t, router, r.method, r.path, r.body, "")
			if code != 403 || out["reason"] != reasonDockerSelf {
				t.Errorf("%s: %d %v", r.path, code, out)
			}
		}
		if len(createsOf(f)) != 0 {
			t.Error("a helper was created for nextDash's own stack")
		}
	})
	t.Run("control off", func(t *testing.T) {
		f, _, _, router := r3Fixture(t)
		t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
		for _, r := range routes[:3] {
			code, out, _ := r3Do(t, router, r.method, r.path, r.body, "")
			if code != 403 || out["reason"] != reasonDockerControlOff {
				t.Errorf("%s: %d %v", r.path, code, out)
			}
		}
		if len(createsOf(f)) != 0 {
			t.Error("a helper was created")
		}
	})
	t.Run("write token", func(t *testing.T) {
		f, _, _, router := r3Fixture(t)
		t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
		for _, r := range routes {
			if code, _, _ := r3Do(t, router, r.method, r.path, r.body, ""); code != 401 {
				t.Errorf("%s without token: %d", r.path, code)
			}
		}
		if len(createsOf(f)) != 0 {
			t.Error("a helper was created without the token")
		}
	})
	t.Run("remote host", func(t *testing.T) {
		f, _, _, router := r3Fixture(t)
		remote, addr := startFakeDockerTCP(t)
		remote.add(fakeContainer{ID: strings.Repeat("d", 64), Name: "r", State: "running", Labels: map[string]string{composeLabelProject: "media"}})
		host := addRemoteHost(t, addr, true)
		code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/preview?host="+host.ID, "", "")
		if code != 403 || out["reason"] != reasonDockerLocalOnly || len(createsOf(f)) != 0 || len(createsOf(remote)) != 0 {
			t.Fatalf("%d %v", code, out)
		}
	})
	t.Run("busy and prune", func(t *testing.T) {
		f, _, h, router := r3Fixture(t)
		release, _ := h.dockerLock("compose:media")
		code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/preview", "", "")
		release()
		if code != 409 || out["reason"] != "busy" || len(createsOf(f)) != 0 {
			t.Fatalf("%d %v", code, out)
		}
		h.dockerPruneRunning.Store(true)
		if code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/preview", "", ""); code != 409 || out["reason"] != "prune-running" {
			t.Fatalf("%d %v", code, out)
		}
	})
}

// ---- item 3: the health watch ----

func TestComposeWatchEndsHealthy(t *testing.T) {
	_, _, _, router := r3Fixture(t)
	if code, _, raw := r3Do(t, router, "POST", "/api/docker/compose/media/up", "", ""); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	st := r3WatchState(t, router)
	if st["state"] != composeWatchWatching && st["state"] != composeWatchHealthy {
		t.Fatalf("right after Up: %v", st)
	}
	r3Wait(t, "healthy", r3StateIs(t, router, composeWatchHealthy))
	st = r3WatchState(t, router)
	svcs := st["services"].([]any)
	if len(svcs) != 1 || svcs[0].(map[string]any)["container"] != "media-web-1" || st["problem"] != nil {
		t.Errorf("%v", st)
	}
	_, all, _ := r3Do(t, router, "GET", "/api/docker/compose/watches", "", "")
	if len(all["watches"].([]any)) != 1 {
		t.Errorf("watches = %v", all)
	}
	if code, _, _ := r3Do(t, router, "POST", "/api/docker/compose/media/watch/dismiss", "", ""); code != 200 {
		t.Errorf("dismiss: %d", code)
	}
	if st := r3WatchState(t, router); st["state"] != composeWatchNone {
		t.Errorf("after dismiss: %v", st)
	}
	// A watch that is still going cannot be dismissed.
	r3Do(t, router, "POST", "/api/docker/compose/media/up", "", "")
	if code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/watch/dismiss", "", ""); code != 409 || out["reason"] != composeWatchNotOpen {
		t.Errorf("dismiss while watching: %d %v", code, out)
	}
}

func TestComposeWatchProblemRaisesANotice(t *testing.T) {
	f, _, h, router := r3Fixture(t)
	_ = h
	r3Do(t, router, "POST", "/api/docker/compose/media/up", "", "")
	r3Wait(t, "first poll", func() bool { return len(r3WatchState(t, router)["services"].([]any)) == 1 })
	f.mu.Lock()
	f.containers[r3WebID].RestartCount = 3
	f.mu.Unlock()
	r3Wait(t, "problem", r3StateIs(t, router, composeWatchProblem))
	st := r3WatchState(t, router)
	pr := st["problem"].(map[string]any)
	if pr["service"] != "web" || pr["code"] != "restarting" || pr["restarts"].(float64) != 3 || !strings.Contains(pr["message"].(string), "restarted 3 times") {
		t.Errorf("problem = %v", pr)
	}
	rs := st["restore"].(map[string]any)
	if rs["available"] != false || rs["reason"] != "no-recent-save" {
		t.Errorf("restore without a save = %v", rs)
	}
	r3Wait(t, "the notice", func() bool { return len(readOpenFile().Open) > 0 })
	open := readOpenFile().Open
	if len(open) != 1 || open[0].Key != "container:media-web-1#"+composeNoticeKind {
		t.Fatalf("open alerts = %+v", open)
	}
	// Muted like any docker notice: nothing is raised for a muted container.
	// Dismiss closes the notice.
	if code, _, _ := r3Do(t, router, "POST", "/api/docker/compose/media/watch/dismiss", "", ""); code != 200 {
		t.Fatalf("dismiss: %d", code)
	}
	if open := readOpenFile().Open; len(open) != 0 {
		t.Errorf("the notice stayed open: %+v", open)
	}
}

// Restarts from before the Up are the baseline even when the first poll fails.
func TestComposeWatchBaselineSurvivesAFailedFirstPoll(t *testing.T) {
	f, _, h, router := r3Fixture(t)
	f.mu.Lock()
	f.containers[r3WebID].RestartCount = 3
	f.failList = 1
	f.mu.Unlock()
	api, _ := newDockerAPI()
	h.composeWatchStart(api, r3Project(), "")
	r3Wait(t, "an end", func() bool {
		s := r3WatchState(t, router)["state"]
		return s == composeWatchHealthy || s == composeWatchProblem
	})
	if st := r3WatchState(t, router); st["state"] != composeWatchHealthy {
		t.Fatalf("old restarts read as a loop: %v", st)
	}
}

func TestComposeWatchProblemIsMutedLikeADockerNotice(t *testing.T) {
	f, _, h, router := r3Fixture(t)
	s := h.store.GetSettings()
	s.DockerNotifyMuted = []string{"media-web-1"}
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	r3Do(t, router, "POST", "/api/docker/compose/media/up", "", "")
	r3Wait(t, "first poll", func() bool { return len(r3WatchState(t, router)["services"].([]any)) == 1 })
	f.mu.Lock()
	f.containers[r3WebID].Health = map[string]any{"Status": "unhealthy"}
	f.mu.Unlock()
	r3Wait(t, "problem", r3StateIs(t, router, composeWatchProblem))
	if pr := r3WatchState(t, router)["problem"].(map[string]any); pr["code"] != "unhealthy" {
		t.Errorf("problem = %v", pr)
	}
	time.Sleep(150 * time.Millisecond) // the notice, if any, follows the state
	if open := readOpenFile().Open; len(open) != 0 {
		t.Errorf("a muted container raised a notice: %+v", open)
	}
}

func TestComposeWatchStretchesForALongStartPeriod(t *testing.T) {
	f, _, _, router := r3Fixture(t)
	f.mu.Lock()
	f.containers[r3WebID].Health = map[string]any{"Status": "starting"}
	f.containers[r3WebID].StartPeriod = int64(1200 * time.Millisecond)
	f.mu.Unlock()
	r3Do(t, router, "POST", "/api/docker/compose/media/up", "", "")
	r3Wait(t, "slow", r3StateIs(t, router, composeWatchSlow))
	if st := r3WatchState(t, router); st["windowSeconds"].(float64) < 1 || st["secondsLeft"].(float64) < 1 {
		t.Errorf("%v", st)
	}
	f.mu.Lock()
	f.containers[r3WebID].Health = map[string]any{"Status": "healthy"}
	f.mu.Unlock()
	r3Wait(t, "healthy", r3StateIs(t, router, composeWatchHealthy))
}

func TestComposeWatchRestoresThePreviousCopy(t *testing.T) {
	f, file, _, router := r3Fixture(t)
	// The save that "broke" the stack.
	code, out := composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, composeSha([]byte(composeSaveOld))), "")
	if code != 200 {
		t.Fatalf("save: %d %v", code, out)
	}
	stamp := out["backup"].(string)
	r3Do(t, router, "POST", "/api/docker/compose/media/up", "", "")
	r3Wait(t, "first poll", func() bool { return len(r3WatchState(t, router)["services"].([]any)) == 1 })
	rs := r3WatchState(t, router)["restore"].(map[string]any)
	files := rs["files"].([]any)
	if rs["available"] != true || len(files) != 1 || files[0].(map[string]any)["stamp"] != stamp || files[0].(map[string]any)["file"] != "c0" {
		t.Fatalf("restore = %v", rs)
	}
	f.mu.Lock()
	f.containers[r3WebID].RestartCount = 4
	f.mu.Unlock()
	r3Wait(t, "problem", r3StateIs(t, router, composeWatchProblem))

	code, out, raw := r3Do(t, router, "POST", "/api/docker/compose/media/watch/restore", "", "")
	if code != http.StatusAccepted || out["state"] != composeWatchRestoring {
		t.Fatalf("%d %s", code, raw)
	}
	r3Wait(t, "restored", r3StateIs(t, router, composeWatchRestored))
	if got := mustRead(t, file); got != composeSaveOld {
		t.Errorf("file after restore = %q", got)
	}
	st := r3WatchState(t, router)
	if st["afterRestore"] != true || st["problem"] != nil {
		t.Errorf("%v", st)
	}
	// The broken text is kept as a backup of its own.
	rec := hostsCall(t, router, "GET", "/api/docker/compose/media/backups?file=c0", "", "")
	var bk struct{ Backups []composeBackup }
	_ = json.Unmarshal(rec.Body.Bytes(), &bk)
	if len(bk.Backups) != 2 {
		t.Errorf("backups = %+v", bk.Backups)
	}
	// Restore ran Up, without the orphan flag.
	creates := createsOf(f)
	cmd := anyStrings(creates[len(creates)-1]["Cmd"])
	if !reflect.DeepEqual(cmd[len(cmd)-2:], []string{"up", "-d"}) {
		t.Errorf("last helper = %v", cmd)
	}
	composeAllHelpersRemoved(t, f)
	// Nothing left to restore now.
	if code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/watch/restore", "", ""); code != 409 || out["reason"] != composeWatchNotOpen {
		t.Errorf("second restore: %d %v", code, out)
	}
	r3Wait(t, "the notice to close", func() bool { return len(readOpenFile().Open) == 0 })
	if open := readOpenFile().Open; len(open) != 0 {
		t.Errorf("the problem notice stayed open: %+v", open)
	}
}

func TestComposeWatchRestoreNeedsAProblemAndACopy(t *testing.T) {
	f, file, _, router := r3Fixture(t)
	if code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/watch/restore", "", ""); code != 409 || out["reason"] != composeWatchNotOpen {
		t.Errorf("no watch: %d %v", code, out)
	}
	r3Do(t, router, "POST", "/api/docker/compose/media/up", "", "")
	r3Wait(t, "first poll", func() bool { return len(r3WatchState(t, router)["services"].([]any)) == 1 })
	f.mu.Lock()
	f.containers[r3WebID].RestartCount = 5
	f.mu.Unlock()
	r3Wait(t, "problem", r3StateIs(t, router, composeWatchProblem))
	n := len(createsOf(f))
	code, out, _ := r3Do(t, router, "POST", "/api/docker/compose/media/watch/restore", "", "")
	if code != 409 || out["reason"] != composeNoRestore || len(createsOf(f)) != n {
		t.Errorf("no save: %d %v", code, out)
	}
	if mustRead(t, file) != composeSaveOld {
		t.Error("the file changed")
	}
}

func TestComposeWatchRestoreRefusesAFileEditedSinceTheSave(t *testing.T) {
	f, file, _, router := r3Fixture(t)
	composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, composeSha([]byte(composeSaveOld))), "")
	r3Do(t, router, "POST", "/api/docker/compose/media/up", "", "")
	r3Wait(t, "first poll", func() bool { return len(r3WatchState(t, router)["services"].([]any)) == 1 })
	// Somebody edits the file by hand: what the save wrote is no longer there.
	writeTestFile(t, file, "services:\n  web:\n    image: edited\n")
	f.mu.Lock()
	f.containers[r3WebID].RestartCount = 5
	f.mu.Unlock()
	r3Wait(t, "problem", r3StateIs(t, router, composeWatchProblem))
	// The info taken at the start said a copy was there; the restore itself
	// re-checks the file and puts nothing over the hand edit.
	code, _, _ := r3Do(t, router, "POST", "/api/docker/compose/media/watch/restore", "", "")
	if code != http.StatusAccepted {
		t.Fatalf("%d", code)
	}
	r3Wait(t, "restore-failed", func() bool {
		pr, _ := r3WatchState(t, router)["problem"].(map[string]any)
		return pr != nil && pr["code"] == "restore-failed"
	})
	if mustRead(t, file) != "services:\n  web:\n    image: edited\n" {
		t.Error("the hand edit was overwritten")
	}
}

// ---- item 4: the setup check ----

func r3Setup(t *testing.T, router http.Handler) map[string]map[string]any {
	t.Helper()
	code, out, raw := r3Do(t, router, "GET", "/api/docker/status", "", "")
	if code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	setup, _ := out["compose"].(map[string]any)["setup"].(map[string]any)
	if setup == nil {
		t.Fatalf("no compose.setup: %s", raw)
	}
	rows := map[string]map[string]any{}
	for _, r := range setup["checks"].([]any) {
		m := r.(map[string]any)
		rows[m["id"].(string)] = m
	}
	if len(rows) != 6 {
		t.Fatalf("checks = %v", setup["checks"])
	}
	return rows
}

func TestComposeSetupCheckOfAWorkingSetup(t *testing.T) {
	f, _, _, router := r3Fixture(t)
	f.images[composeRunHelperImage] = fakeImage{ID: "sha256:helper"}
	t.Setenv("NEXTDASH_COMPOSE_SOCKET", "/run/user/1000/docker.sock")
	rows := r3Setup(t, router)
	for id, r := range rows {
		if r["ok"] != true {
			t.Errorf("%s should be ok: %v", id, r)
		}
	}
	if !strings.Contains(rows["socket"]["detail"].(string), "/run/user/1000/docker.sock") {
		t.Errorf("socket = %v", rows["socket"])
	}
	_, out, _ := r3Do(t, router, "GET", "/api/docker/status", "", "")
	if s := out["compose"].(map[string]any)["setup"].(map[string]any); s["ok"] != true || s["failed"].(float64) != 0 || s["projects"].(float64) != 1 {
		t.Errorf("setup = %v", s)
	}
}

func TestComposeSetupCheckFailuresSayWhatToChange(t *testing.T) {
	f, _, _, router := r3Fixture(t)
	f.mu.Lock()
	delete(f.images, composeRunHelperImage)
	f.mu.Unlock()
	t.Setenv("NEXTDASH_COMPOSE_MAP", "/elsewhere:"+t.TempDir())
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
	rows := r3Setup(t, router)
	fix := func(id string) map[string]any {
		if rows[id]["ok"] != false || rows[id]["fix"] == nil {
			t.Fatalf("%s = %v", id, rows[id])
		}
		return rows[id]["fix"].(map[string]any)
	}
	if m := fix("mapping"); m["copy"] != "NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks" || !strings.Contains(m["text"].(string), "/opt/stacks:/stacks:ro") {
		t.Errorf("mapping fix = %v", m)
	}
	if m := fix("image"); m["copy"] != "docker pull "+composeRunHelperImage || !strings.Contains(m["text"].(string), "NEXTDASH_COMPOSE_IMAGE") {
		t.Errorf("image fix = %v", m)
	}
	if m := fix("control"); m["copy"] != "NEXTDASH_DOCKER_CONTROL=1" {
		t.Errorf("control fix = %v", m)
	}
}

func TestComposeSetupCheckMountReadOnlyAndOwner(t *testing.T) {
	f, _, _, router := r3Fixture(t)
	_ = f
	// A mapped folder that is not there is the "not mounted" answer.
	t.Setenv("NEXTDASH_COMPOSE_MAP", "/opt/stacks:/definitely/not/mounted")
	rows := r3Setup(t, router)
	if rows["mount"]["ok"] != false || !strings.Contains(rows["mount"]["fix"].(map[string]any)["text"].(string), "/opt/stacks:/definitely/not/mounted") {
		t.Errorf("mount = %v", rows["mount"])
	}
	// A compose file nobody can write: the owner row names the fix.
	if os.Geteuid() == 0 {
		t.Skip("root can write everything")
	}
	root := t.TempDir()
	t.Setenv("NEXTDASH_COMPOSE_MAP", "/opt/stacks:"+root)
	file := filepath.Join(root, "media/compose.yml")
	writeTestFile(t, file, composeSaveOld)
	if err := os.Chmod(file, 0o444); err != nil {
		t.Fatal(err)
	}
	rows = r3Setup(t, router)
	if rows["owner"]["ok"] != false || rows["owner"]["fix"].(map[string]any)["copy"] != "NEXTDASH_RUN_AS_ROOT=1" {
		t.Errorf("owner = %v", rows["owner"])
	}
}

// ---- item 5: the stack summary ----

func TestComposeSummaryIsOneLinePerStack(t *testing.T) {
	f, file, _, router := r3Fixture(t)
	f.mu.Lock()
	f.containers[r3WebID].Status = "Up 3 hours (unhealthy)"
	f.mu.Unlock()
	f.add(fakeContainer{ID: strings.Repeat("e", 64), Name: "media-db-1", State: "running", Status: "Up 3 hours", Labels: map[string]string{
		composeLabelProject: "media", composeLabelWorkingDir: "/opt/stacks/media", composeLabelConfig: "/opt/stacks/media/compose.yml", composeLabelService: "db"}})
	dockerStatsStore.recordPoint(strings.Repeat("e", 64), time.Now(), dockerStatsPoint{T: time.Now().UnixMilli(), CPU: 12.5, Mem: 1 << 20})
	dockerTimelines.add("media-web-1", dockerTimelineEntry{At: time.Now().UnixMilli(), Kind: "start"})
	code, out, raw := r3Do(t, router, "GET", "/api/docker/compose/summary", "", "")
	if code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	ps := out["projects"].([]any)
	if len(ps) != 1 {
		t.Fatalf("%s", raw)
	}
	p := ps[0].(map[string]any)
	if p["project"] != "media" || p["containers"].(float64) != 2 || p["running"].(float64) != 2 || p["unhealthy"].(float64) != 1 || p["healthy"].(float64) != 1 || p["text"] != "1/2 healthy" {
		t.Errorf("health = %v", p)
	}
	if p["pending"] != false || p["watch"] != "" {
		t.Errorf("pending/watch = %v", p)
	}
	if p["usage"] != true || p["cpu"].(float64) != 12.5 || p["mem"].(float64) != float64(1<<20) {
		t.Errorf("usage = %v", p)
	}
	// Pending: Up recorded the files; the next save makes the stack differ.
	if code, _, _ := r3Do(t, router, "POST", "/api/docker/compose/media/up", "", ""); code != 200 {
		t.Fatal(code)
	}
	if _, out, _ = r3Do(t, router, "GET", "/api/docker/compose/summary", "", ""); out["projects"].([]any)[0].(map[string]any)["pending"] != false {
		t.Error("pending right after Up")
	}
	composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, composeSha([]byte(composeSaveOld))), "")
	_ = file
	_, out, _ = r3Do(t, router, "GET", "/api/docker/compose/summary", "", "")
	if p := out["projects"].([]any)[0].(map[string]any); p["pending"] != true || p["watch"] == "" {
		t.Errorf("after a save = %v", p)
	}
}

func TestComposeSummaryWithoutSamplesHasNoUsage(t *testing.T) {
	_, _, _, router := r3Fixture(t)
	_, out, _ := r3Do(t, router, "GET", "/api/docker/compose/summary", "", "")
	p := out["projects"].([]any)[0].(map[string]any)
	if p["usage"] != false || p["cpu"] != nil || p["mem"] != nil {
		t.Errorf("%v", p)
	}
	remote, addr := startFakeDockerTCP(t)
	_ = remote
	host := addRemoteHost(t, addr, true)
	if code, out, _ := r3Do(t, router, "GET", "/api/docker/compose/summary?host="+host.ID, "", ""); code != 403 || out["reason"] != reasonDockerLocalOnly {
		t.Errorf("remote: %d %v", code, out)
	}
}

// ---- item 6: .env in place ----

const r3Env = "# db\nexport DB_PASSWORD=\"s3cret-pw\" # keep\nTZ=Europe/Amsterdam\nAPI_TOKEN=tok-1\nAPI_TOKEN=tok-2\nKEY=\"line one\nline two\"\nPUID=1000\n"

func TestComposeMergeMaskedEnv(t *testing.T) {
	masked, _ := redactEnvFile([]byte(r3Env))
	if !strings.Contains(string(masked), composeMask) || strings.Contains(string(masked), "s3cret") {
		t.Fatalf("the view leaks: %s", masked)
	}
	t.Run("untouched view merges back to the original bytes", func(t *testing.T) {
		got, err := composeMergeMaskedEnv([]byte(r3Env), masked)
		if err != nil || string(got) != r3Env {
			t.Fatalf("%v\n%q", err, got)
		}
	})
	t.Run("a changed value and a kept secret", func(t *testing.T) {
		edited := strings.Replace(string(masked), "TZ="+composeMask, "TZ=UTC", 1)
		edited = strings.Replace(edited, "PUID="+composeMask, "PUID=1001", 1)
		got, err := composeMergeMaskedEnv([]byte(r3Env), []byte(edited))
		want := strings.Replace(strings.Replace(r3Env, "Europe/Amsterdam", "UTC", 1), "PUID=1000", "PUID=1001", 1)
		if err != nil || string(got) != want {
			t.Fatalf("%v\n%q\nwant %q", err, got, want)
		}
	})
	t.Run("a secret replaced by a new value", func(t *testing.T) {
		edited := strings.Replace(string(masked), "DB_PASSWORD="+composeMask, "DB_PASSWORD=new", 1)
		got, err := composeMergeMaskedEnv([]byte(r3Env), []byte(edited))
		if err != nil || !strings.Contains(string(got), "DB_PASSWORD=new") || strings.Contains(string(got), composeMask) || !strings.Contains(string(got), "tok-1") {
			t.Fatalf("%v\n%q", err, got)
		}
	})
	t.Run("a masked value with no original is refused", func(t *testing.T) {
		_, err := composeMergeMaskedEnv([]byte(r3Env), []byte(string(masked)+"BRAND_NEW="+composeMask+"\n"))
		if err == nil || err.Reason != composeMaskUnmatched || err.Name != "BRAND_NEW" {
			t.Fatalf("%+v", err)
		}
	})
	t.Run("the mask text inside a typed value is refused", func(t *testing.T) {
		_, err := composeMergeMaskedEnv([]byte(r3Env), []byte(strings.Replace(string(masked), "TZ="+composeMask, "TZ=abc"+composeMask, 1)))
		if err == nil || err.Reason != composeMaskLiteral {
			t.Fatalf("%+v", err)
		}
	})
}

func r3EnvFixture(t *testing.T) (string, http.Handler) {
	_, file, _, router := r3Fixture(t)
	envPath := filepath.Join(filepath.Dir(file), ".env")
	writeTestFile(t, envPath, r3Env)
	return envPath, router
}

func r3EnvView(t *testing.T, router http.Handler) (content, sha string) {
	t.Helper()
	_, out, _ := r3Do(t, router, "GET", "/api/docker/compose/media/files", "", "")
	for _, f := range out["files"].([]any) {
		m := f.(map[string]any)
		if m["id"] == "env" {
			if m["mask"] != composeMask {
				t.Errorf("mask = %v", m["mask"])
			}
			return m["content"].(string), m["sha256"].(string)
		}
	}
	t.Fatal("no env file")
	return
}

func TestComposeEnvSaveKeepsAnUntouchedMaskedValue(t *testing.T) {
	envPath, router := r3EnvFixture(t)
	content, sha := r3EnvView(t, router)
	if strings.Contains(content, "s3cret") {
		t.Fatalf("the view leaks: %s", content)
	}
	edited := strings.Replace(content, "PUID="+composeMask, "PUID=1001", 1)
	body := r3JSON(map[string]any{"content": edited, "sha256": sha, "masked": true})
	code, out, raw := r3Do(t, router, "PUT", "/api/docker/compose/media/files?file=env", body, "")
	if code != 200 || out["ok"] != true {
		t.Fatalf("%d %s", code, raw)
	}
	want := strings.Replace(r3Env, "PUID=1000", "PUID=1001", 1)
	if got := mustRead(t, envPath); got != want {
		t.Errorf("file = %q", got)
	}
	if out["sha256"] != composeSha([]byte(want)) || strings.Contains(raw, "s3cret") {
		t.Errorf("answer = %s", raw)
	}
}

func TestComposeSaveNeverWritesTheMask(t *testing.T) {
	envPath, router := r3EnvFixture(t)
	content, sha := r3EnvView(t, router)
	// The masked view saved back as it is, without asking for the merge: the
	// secrets would become six bullets. Refused, the file untouched.
	body := r3JSON(map[string]any{"content": content, "sha256": sha})
	code, out, _ := r3Do(t, router, "PUT", "/api/docker/compose/media/files?file=env", body, "")
	if code != 422 || out["reason"] != composeMaskLiteral {
		t.Fatalf("unmerged masked view: %d %v", code, out)
	}
	if mustRead(t, envPath) != r3Env {
		t.Fatal("the mask reached the file")
	}
	// Merge asked for, but the text edits a secret into the mask text.
	bad := strings.Replace(content, "TZ="+composeMask, "TZ=x"+composeMask, 1)
	code, out, _ = r3Do(t, router, "PUT", "/api/docker/compose/media/files?file=env", r3JSON(map[string]any{"content": bad, "sha256": sha, "masked": true}), "")
	if code != 422 || out["reason"] != composeMaskLiteral || mustRead(t, envPath) != r3Env {
		t.Fatalf("typed mask: %d %v", code, out)
	}
	// An unmatched placeholder.
	code, out, _ = r3Do(t, router, "PUT", "/api/docker/compose/media/files?file=env", r3JSON(map[string]any{"content": content + "NEW=" + composeMask + "\n", "sha256": sha, "masked": true}), "")
	if code != 422 || out["reason"] != composeMaskUnmatched || out["line"] == nil || mustRead(t, envPath) != r3Env {
		t.Fatalf("unmatched: %d %v", code, out)
	}
	// The same guard covers a compose file.
	_, file, _, router2 := r3Fixture(t)
	yml := "services:\n  web:\n    image: nginx\n    environment:\n      - PASSWORD=hunter2\n"
	writeTestFile(t, file, yml)
	rec := hostsCall(t, router2, "GET", "/api/docker/compose/media/files", "", "")
	var view struct {
		Files []struct {
			ID, Content, Sha256 string
		}
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &view)
	if !strings.Contains(view.Files[0].Content, composeMask) {
		t.Fatalf("the view should mask: %s", view.Files[0].Content)
	}
	code, out, _ = r3Do(t, router2, "PUT", "/api/docker/compose/media/files?file=c0", r3JSON(map[string]any{"content": view.Files[0].Content, "sha256": view.Files[0].Sha256}), "")
	if code != 422 || out["reason"] != composeMaskLiteral || mustRead(t, file) != yml {
		t.Fatalf("compose file: %d %v", code, out)
	}
}

func TestComposeCheckOfAMaskedEnvUsesTheRealValues(t *testing.T) {
	f, file, _, router := r3Fixture(t)
	writeTestFile(t, filepath.Join(filepath.Dir(file), ".env"), "DB_PASSWORD=s3cret\nTZ=UTC\n")
	_, out, _ := r3Do(t, router, "GET", "/api/docker/compose/media/files", "", "")
	content := ""
	for _, fl := range out["files"].([]any) {
		if m := fl.(map[string]any); m["id"] == "env" {
			content = m["content"].(string)
		}
	}
	body := r3JSON(map[string]any{"file": "env", "content": strings.Replace(content, "TZ="+composeMask, "TZ=CET", 1), "masked": true})
	code, _, raw := r3Do(t, router, "POST", "/api/docker/compose/media/check", body, "")
	if code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	env := anyStrings(createsOf(f)[0]["Env"])
	if len(env) != 1 || env[0] != "NEXTDASH_COMPOSE_STAGE=DB_PASSWORD=s3cret\nTZ=CET\n" {
		t.Errorf("the helper got %q, not the merged text", env)
	}
	if strings.Contains(raw, "s3cret") {
		t.Error("the answer holds a secret")
	}
}

func TestComposeBackupDiffNeverShowsASecret(t *testing.T) {
	envPath, router := r3EnvFixture(t)
	content, sha := r3EnvView(t, router)
	// Change a plain value and a secret.
	edited := strings.Replace(content, "PUID="+composeMask, "PUID=1001", 1)
	edited = strings.Replace(edited, "DB_PASSWORD="+composeMask, "DB_PASSWORD=brand-new-pw", 1)
	code, out, raw := r3Do(t, router, "PUT", "/api/docker/compose/media/files?file=env", r3JSON(map[string]any{"content": edited, "sha256": sha, "masked": true}), "")
	if code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	stamp := out["backup"].(string)
	code, diff, raw := r3Do(t, router, "GET", "/api/docker/compose/media/backups/"+stamp+"/diff?file=env", "", "")
	if code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	for _, secret := range []string{"s3cret-pw", "brand-new-pw", "tok-1", "tok-2", "line one"} {
		if strings.Contains(raw, secret) {
			t.Errorf("the diff shows %q:\n%s", secret, raw)
		}
	}
	ops := map[string]string{}
	for _, l := range diff["lines"].([]any) {
		m := l.(map[string]any)
		ops[m["op"].(string)] += m["text"].(string) + "\n"
	}
	if !strings.Contains(ops["-"], "PUID=1000") || !strings.Contains(ops["+"], "PUID=1001") {
		t.Errorf("a plain value should be shown: %v", ops)
	}
	if !strings.Contains(ops["~"], "DB_PASSWORD="+composeMask) || diff["changed"].(float64) != 1 || diff["added"].(float64) != 1 || diff["removed"].(float64) != 1 {
		t.Errorf("a changed secret is one ~ line without its value: %v %v", ops, diff)
	}
	if mustRead(t, envPath) == r3Env {
		t.Error("the save should have changed the file")
	}
	// Same for a compose file: a changed password shows no value.
	_, file, _, router2 := r3Fixture(t)
	writeTestFile(t, file, "services:\n  web:\n    image: nginx\n    environment:\n      - PASSWORD=hunter2\n")
	cur := mustRead(t, file)
	next := strings.Replace(cur, "hunter2", "hunter3", 1)
	_, o2, _ := r3Do(t, router2, "PUT", "/api/docker/compose/media/files?file=c0", r3JSON(map[string]any{"content": next, "sha256": composeSha([]byte(cur))}), "")
	_, d2, raw2 := r3Do(t, router2, "GET", "/api/docker/compose/media/backups/"+o2["backup"].(string)+"/diff?file=c0", "", "")
	if strings.Contains(raw2, "hunter") || d2["changed"].(float64) != 1 {
		t.Errorf("compose diff: %s", raw2)
	}
}

func TestComposeBackupDiffGates(t *testing.T) {
	_, router := r3EnvFixture(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
	if code, _, _ := r3Do(t, router, "GET", "/api/docker/compose/media/backups/20240101T000000Z/diff?file=env", "", ""); code != 401 {
		t.Errorf("no token: %d", code)
	}
	if code, _, _ := r3Do(t, router, "GET", "/api/docker/compose/media/backups/20240101T000000Z/diff?file=env", "", "sekret"); code != 404 {
		t.Errorf("unknown stamp: %d", code)
	}
}

// The demo has a stack folder and a daemon that plays the helper (docker_demo_compose.go),
// so these routes work there: they are allowed, none is denied.
func TestDemoAllowsTheRound3WriteRoutes(t *testing.T) {
	for _, route := range []string{
		"/api/docker/compose/{project}/preview",
		"/api/docker/compose/{project}/watch/restore",
		"/api/docker/compose/{project}/watch/dismiss",
	} {
		found := false
		for _, d := range demoAllowedWrites {
			if d == route {
				found = true
			}
		}
		for _, d := range demoDeniedWrites {
			if d == route {
				t.Errorf("%s is still denied in the demo", route)
			}
		}
		if !found {
			t.Errorf("%s is not in demoAllowedWrites", route)
		}
	}
}
