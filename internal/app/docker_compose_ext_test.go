package app

import (
	"bufio"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

const composeExtFile = "services:\n  web:\n    image: nginx\n  db:\n    image: postgres\n  idle:\n    image: busybox\n"

var (
	composeExtWebID = strings.Repeat("a", 64)
	composeExtDBID  = strings.Repeat("c", 64)
)

// composeExtFixture is the run fixture with a file of three services, of which
// web and db have a container.
func composeExtFixture(t *testing.T) (*fakeDocker, string, *Handlers, http.Handler) {
	t.Helper()
	f, file, h, router := composeSaveFixture(t)
	t.Setenv("NEXTDASH_COMPOSE_SOCKET", "")
	f.images[composeRunHelperImage] = fakeImage{ID: "sha256:helper"}
	writeTestFile(t, file, composeExtFile)
	f.mu.Lock()
	f.containers[composeExtWebID].Labels[composeLabelService] = "web"
	f.containers[composeExtWebID].ImageID = "sha256:old"
	f.containers[composeExtWebID].Image = "nginx"
	f.containers[composeExtWebID].Logs = []string{"web one", "web two"}
	f.mu.Unlock()
	f.add(fakeContainer{ID: composeExtDBID, Name: "media-db-1", State: "running", ImageID: "sha256:dbold", Image: "postgres", Logs: []string{"db one"}, Labels: map[string]string{
		composeLabelProject: "media", composeLabelWorkingDir: "/opt/stacks/media", composeLabelConfig: "/opt/stacks/media/compose.yml",
		composeLabelService: "db",
	}})
	return f, file, h, router
}

func lastCmd(t *testing.T, f *fakeDocker) []string {
	t.Helper()
	b := createsOf(f)
	return anyStrings(b[len(b)-1]["Cmd"])
}

// ---- A2 check ----

func TestComposeCheckRunsConfigOnlyAndTakesNoContainerLock(t *testing.T) {
	f, _, h, router := composeExtFixture(t)
	release, ok := h.dockerLock("name:media-web-1") // an action is running on a member
	if !ok {
		t.Fatal("lock")
	}
	defer release()
	code, out, raw := composeRunPost(t, router, "check", "", "")
	if code != 200 || out["ok"] != true {
		t.Fatalf("%d %s", code, raw)
	}
	if n := len(createsOf(f)); n != 1 {
		t.Fatalf("%d helpers", n)
	}
	got := lastCmd(t, f)
	if got[len(got)-2] != "config" || got[len(got)-1] != "-q" {
		t.Errorf("Cmd = %v", got)
	}
	composeAllHelpersRemoved(t, f)
}

func TestComposeCheckWaitsForARunOnTheProject(t *testing.T) {
	f, _, h, router := composeExtFixture(t)
	release, _ := h.dockerLock("compose:media")
	code, out, _ := composeRunPost(t, router, "check", "", "")
	release()
	if code != 409 || out["reason"] != "busy" || len(createsOf(f)) != 0 {
		t.Fatalf("%d %v", code, out)
	}
}

func TestComposeCheckInvalidCarriesLineAndTail(t *testing.T) {
	for _, c := range []struct {
		name      string
		logs      []string
		line, col float64
	}{
		{"line only", []string{"yaml: line 5: mapping values are not allowed in this context"}, 5, 0},
		{"line and column", []string{"validating compose.yml:", "line 3, column 7: bad"}, 3, 7},
		{"no position", []string{"services.web.image must be a string"}, 0, 0},
	} {
		t.Run(c.name, func(t *testing.T) {
			f, _, _, router := composeExtFixture(t)
			f.helperExitSeq = []int{1}
			f.helperLogs = c.logs
			code, out, raw := composeRunPost(t, router, "check", "", "")
			if code != 422 || out["reason"] != composeInvalid || out["exitCode"].(float64) != 1 {
				t.Fatalf("%d %s", code, raw)
			}
			if !reflect.DeepEqual(anyStrings(out["tail"]), c.logs) {
				t.Errorf("tail = %v", out["tail"])
			}
			l, _ := out["line"].(float64)
			col, _ := out["column"].(float64)
			if l != c.line || col != c.col {
				t.Errorf("line %v column %v", l, col)
			}
			composeAllHelpersRemoved(t, f)
		})
	}
}

func TestComposeCheckGates(t *testing.T) {
	t.Run("own stack", func(t *testing.T) {
		f, _, _, router := composeExtFixture(t)
		dockerSelfOverride = strings.Repeat("a", 12)
		t.Cleanup(func() { dockerSelfOverride = "" })
		code, out, _ := composeRunPost(t, router, "check", "", "")
		if code != 403 || out["reason"] != reasonDockerSelf || len(createsOf(f)) != 0 {
			t.Fatalf("%d %v", code, out)
		}
	})
	t.Run("control off", func(t *testing.T) {
		f, _, _, router := composeExtFixture(t)
		t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
		code, out, _ := composeRunPost(t, router, "check", "", "")
		if code != 403 || out["reason"] != reasonDockerControlOff || len(createsOf(f)) != 0 {
			t.Fatalf("%d %v", code, out)
		}
	})
	t.Run("token", func(t *testing.T) {
		f, _, _, router := composeExtFixture(t)
		t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
		if code, _, _ := composeRunPost(t, router, "check", "", ""); code != 401 || len(createsOf(f)) != 0 {
			t.Fatalf("%d", code)
		}
		if code, _, _ := composeRunPost(t, router, "check", "", "sekret"); code != 200 {
			t.Fatalf("with token: %d", code)
		}
	})
}

// ---- A4 edited, not applied ----

func composeFilesGet(t *testing.T, router http.Handler) map[string]any {
	t.Helper()
	rec := hostsCall(t, router, "GET", "/api/docker/compose/media/files", "", "")
	out := map[string]any{}
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func composeFirstFile(out map[string]any) map[string]any {
	return out["files"].([]any)[0].(map[string]any)
}

func TestComposeAppliedStateFollowsUpSaveAndDown(t *testing.T) {
	_, file, _, router := composeExtFixture(t)
	out := composeFilesGet(t, router)
	if out["pendingChange"] != false || composeFirstFile(out)["appliedSha256"] != "" {
		t.Fatalf("never upped should not flag: %v", out)
	}
	if code, _, raw := composeRunPost(t, router, "up", "", ""); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	out = composeFilesGet(t, router)
	if composeFirstFile(out)["appliedSha256"] != composeSha([]byte(composeExtFile)) || out["pendingChange"] != false || composeFirstFile(out)["pendingChange"] != false {
		t.Fatalf("after up: %v", composeFirstFile(out))
	}
	code, _ := composePut(t, router, "file=c0", composeSaveBodyOf(composeSaveNew, composeSha([]byte(composeExtFile))), "")
	if code != 200 || mustRead(t, file) != composeSaveNew {
		t.Fatalf("save %d", code)
	}
	out = composeFilesGet(t, router)
	if out["pendingChange"] != true || composeFirstFile(out)["pendingChange"] != true || composeFirstFile(out)["appliedSha256"] != composeSha([]byte(composeExtFile)) {
		t.Fatalf("after save: %v", composeFirstFile(out))
	}
	if code, _, _ := composeRunPost(t, router, "up", "", ""); code != 200 {
		t.Fatal(code)
	}
	if out = composeFilesGet(t, router); out["pendingChange"] != false {
		t.Fatalf("after second up: %v", out)
	}
	if code, _, _ := composeRunPost(t, router, "down", "", ""); code != 200 {
		t.Fatal(code)
	}
	if out = composeFilesGet(t, router); composeFirstFile(out)["appliedSha256"] != "" {
		t.Errorf("down should forget: %v", composeFirstFile(out))
	}
}

func TestComposeAppliedNotRecordedByFailedOrPartialRuns(t *testing.T) {
	f, _, _, router := composeExtFixture(t)
	f.helperExitSeq = []int{0, 3} // validate ok, up fails
	if code, _, _ := composeRunPost(t, router, "up", "", ""); code != 502 {
		t.Fatal(code)
	}
	if composeFirstFile(composeFilesGet(t, router))["appliedSha256"] != "" {
		t.Error("a failed up was recorded")
	}
	if code, _, raw := composeRunPost(t, router, "up", "?service=web", ""); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if composeFirstFile(composeFilesGet(t, router))["appliedSha256"] != "" {
		t.Error("one service's up counted as the stack's")
	}
}

// ---- B1 service ----

func TestComposeServiceIsValidatedAndPassedLast(t *testing.T) {
	for _, c := range []struct {
		action string
		want   []string
	}{
		{"up", []string{"up", "-d", "web"}},
		{"pull", []string{"pull", "web"}},
		{"restart", []string{"restart", "web"}},
	} {
		t.Run(c.action, func(t *testing.T) {
			f, _, _, router := composeExtFixture(t)
			code, out, raw := composeRunPost(t, router, c.action, "?service=web", "")
			if code != 200 || out["service"] != "web" {
				t.Fatalf("%d %s", code, raw)
			}
			got := lastCmd(t, f)
			if !reflect.DeepEqual(got[len(got)-len(c.want):], c.want) {
				t.Errorf("Cmd = %v", got)
			}
		})
	}
	t.Run("a service only in the file is fine", func(t *testing.T) {
		f, _, _, router := composeExtFixture(t)
		if code, _, raw := composeRunPost(t, router, "up", "?service=idle", ""); code != 200 {
			t.Fatalf("%d %s", code, raw)
		}
		if got := lastCmd(t, f); got[len(got)-1] != "idle" {
			t.Errorf("Cmd = %v", got)
		}
	})
	t.Run("unknown or malformed is refused before any helper", func(t *testing.T) {
		f, _, _, router := composeExtFixture(t)
		for _, s := range []string{"nope", "--help", "web%20db", "-v", "web;rm", "../x", ""} {
			code, out, _ := composeRunPost(t, router, "up", "?service="+s, "")
			if code != 422 || out["reason"] != composeUnknownService {
				t.Errorf("%q: %d %v", s, code, out)
			}
		}
		if n := len(createsOf(f)); n != 0 {
			t.Errorf("%d helpers created", n)
		}
	})
	t.Run("down takes no service", func(t *testing.T) {
		f, _, _, router := composeExtFixture(t)
		code, out, _ := composeRunPost(t, router, "down", "?service=web", "")
		if code != 422 || out["reason"] != composeServiceNotAllowed || len(createsOf(f)) != 0 {
			t.Fatalf("%d %v", code, out)
		}
	})
}

func TestComposeServiceLocksOnlyItsContainers(t *testing.T) {
	_, _, h, router := composeExtFixture(t)
	release, ok := h.dockerLock("name:media-db-1")
	if !ok {
		t.Fatal("lock")
	}
	if code, _, raw := composeRunPost(t, router, "restart", "?service=web", ""); code != 200 {
		t.Fatalf("web with db busy: %d %s", code, raw)
	}
	if code, out, _ := composeRunPost(t, router, "restart", "?service=db", ""); code != 409 || out["reason"] != "busy" {
		t.Fatalf("db busy: %d %v", code, out)
	}
	if code, _, _ := composeRunPost(t, router, "restart", "", ""); code != 409 {
		t.Fatalf("whole stack with db busy: %d", code)
	}
	release()
}

// ---- B4 restart, pull and up ----

func TestComposeRestartAndUpdateRuns(t *testing.T) {
	t.Run("restart", func(t *testing.T) {
		f, _, _, router := composeExtFixture(t)
		code, out, raw := composeRunPost(t, router, "restart", "", "")
		if code != 200 || out["action"] != "restart" {
			t.Fatalf("%d %s", code, raw)
		}
		if n := len(createsOf(f)); n != 1 {
			t.Fatalf("%d helpers (restart is not validated)", n)
		}
		if got := lastCmd(t, f); got[len(got)-1] != "restart" {
			t.Errorf("Cmd = %v", got)
		}
		composeAllHelpersRemoved(t, f)
	})
	t.Run("update validates, pulls, ups, and records a changed image", func(t *testing.T) {
		f, _, _, router := composeExtFixture(t)
		creates := 0
		f.onCreate = func() {
			creates++
			if creates == 3 { // the up: the web container is now on a new image
				f.containers[composeExtWebID].ImageID = "sha256:new"
			}
		}
		code, out, raw := composeRunPost(t, router, "update", "", "")
		if code != 200 || out["action"] != "update" {
			t.Fatalf("%d %s", code, raw)
		}
		var cmds []string
		for _, b := range createsOf(f) {
			c := anyStrings(b["Cmd"])
			cmds = append(cmds, c[len(c)-1])
		}
		if !reflect.DeepEqual(cmds, []string{"-q", "pull", "-d"}) {
			t.Fatalf("helpers ran %v", cmds)
		}
		hist := dockerUpdateHistoryFor("media-web-1")
		if len(hist) != 1 || hist[0].Kind != "update" || hist[0].FromImageID != "sha256:old" || hist[0].ToImageID != "sha256:new" {
			t.Fatalf("history = %+v", hist)
		}
		if len(dockerUpdateHistoryFor("media-db-1")) != 0 {
			t.Error("an unchanged container got an entry")
		}
		composeAllHelpersRemoved(t, f)
	})
	t.Run("update with a failing pull stops there", func(t *testing.T) {
		f, _, _, router := composeExtFixture(t)
		f.helperExitSeq = []int{0, 1} // validate ok, pull fails
		code, out, _ := composeRunPost(t, router, "update", "", "")
		if code != 502 || out["reason"] != composeFailed || len(createsOf(f)) != 2 {
			t.Fatalf("%d %v, %d helpers", code, out, len(createsOf(f)))
		}
		if len(dockerUpdateHistoryFor("media-web-1")) != 0 {
			t.Error("a failed update was recorded")
		}
	})
	t.Run("own stack stays refused", func(t *testing.T) {
		for _, a := range []string{"restart", "update"} {
			f, _, _, router := composeExtFixture(t)
			dockerSelfOverride = strings.Repeat("a", 12)
			code, out, _ := composeRunPost(t, router, a, "", "")
			dockerSelfOverride = ""
			if code != 403 || out["reason"] != reasonDockerSelf || len(createsOf(f)) != 0 {
				t.Fatalf("%s: %d %v", a, code, out)
			}
		}
	})
	t.Run("control off and token", func(t *testing.T) {
		for _, a := range []string{"restart", "update"} {
			f, _, _, router := composeExtFixture(t)
			t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
			if code, out, _ := composeRunPost(t, router, a, "", ""); code != 403 || out["reason"] != reasonDockerControlOff {
				t.Fatalf("%s control: %d %v", a, code, out)
			}
			t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
			t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
			if code, _, _ := composeRunPost(t, router, a, "", ""); code != 401 {
				t.Fatalf("%s token: %d", a, code)
			}
			if len(createsOf(f)) != 0 {
				t.Errorf("%s: a helper was created", a)
			}
			t.Setenv("NEXTDASH_WRITE_TOKEN", "")
		}
	})
}

// ---- B3 combined log ----

func fastLogSettle(t *testing.T) {
	old := composeLogSettle
	composeLogSettle = 20 * time.Millisecond
	t.Cleanup(func() { composeLogSettle = old })
}

func composeLogLines(t *testing.T, router http.Handler, query, token string) (int, []composeLogLine) {
	t.Helper()
	rec := hostsCall(t, router, "GET", "/api/docker/compose/media/logs/stream"+query, "", token)
	var out []composeLogLine
	if rec.Code != 200 {
		return rec.Code, nil
	}
	sc := bufio.NewScanner(rec.Body)
	for sc.Scan() {
		if strings.TrimSpace(sc.Text()) == "" {
			continue
		}
		var l composeLogLine
		if err := json.Unmarshal(sc.Bytes(), &l); err != nil {
			t.Fatal(err)
		}
		out = append(out, l)
	}
	return rec.Code, out
}

func TestComposeLogStreamTagsEachLineWithItsService(t *testing.T) {
	fastLogSettle(t)
	_, _, _, router := composeExtFixture(t)
	code, lines := composeLogLines(t, router, "", "")
	if code != 200 || len(lines) != 5 { // 3 lines and one end marker per container
		t.Fatalf("%d %+v", code, lines)
	}
	count := map[string]int{}
	ends := 0
	for _, l := range lines {
		if l.S == "end" {
			ends++
			continue
		}
		count[l.Service]++
		if l.S != "out" || (l.Service == "web") != (l.Container == "media-web-1") {
			t.Errorf("line %+v", l)
		}
	}
	if ends != 2 || count["web"] != 2 || count["db"] != 1 {
		t.Errorf("per service = %v", count)
	}
	if _, only := composeLogLines(t, router, "?service=db", ""); len(only) != 2 || only[0].M != "db one" || only[1].S != "end" {
		t.Errorf("service=db: %+v", only)
	}
	if code, _ := composeLogLines(t, router, "?service=nope", ""); code != 422 {
		t.Errorf("unknown service: %d", code)
	}
}

func TestComposeLogStreamGates(t *testing.T) {
	fastLogSettle(t)
	_, _, _, router := composeExtFixture(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "") // reading needs no control
	if code, lines := composeLogLines(t, router, "", ""); code != 200 || len(lines) != 5 {
		t.Fatalf("control off: %d %d", code, len(lines))
	}
	t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
	if code, _ := composeLogLines(t, router, "", ""); code != 401 {
		t.Fatalf("no token: %d", code)
	}
	if code, lines := composeLogLines(t, router, "", "sekret"); code != 200 || len(lines) != 5 {
		t.Fatalf("token: %d %d", code, len(lines))
	}
}

// ---- A2 check of unsaved text ----

func composeCheckBodyPost(t *testing.T, router http.Handler, body map[string]string) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	rec := hostsCall(t, router, "POST", "/api/docker/compose/media/check", string(b), "")
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestComposeCheckOfTextFeedsItOnStdinInPlaceOfTheFile(t *testing.T) {
	f, file, _, router := composeExtFixture(t)
	text := "services:\n  web:\n    image: nginx:2\n"
	code, out := composeCheckBodyPost(t, router, map[string]string{"file": "c0", "content": text})
	if code != 200 || out["ok"] != true {
		t.Fatalf("%d %v", code, out)
	}
	b := createsOf(f)
	if len(b) != 1 {
		t.Fatalf("%d helpers", len(b))
	}
	cmd := anyStrings(b[0]["Cmd"])
	joined := strings.Join(cmd, " ")
	if !strings.Contains(joined, "-f - config -q") || strings.Contains(joined, "-f /opt/stacks/media/compose.yml") {
		t.Errorf("the text takes the file's place: %v", cmd)
	}
	if env := anyStrings(b[0]["Env"]); len(env) != 1 || env[0] != "NEXTDASH_COMPOSE_STAGE="+text {
		t.Errorf("env = %v", env)
	}
	if got := mustRead(t, file); got != composeExtFile {
		t.Errorf("a check writes nothing, the file is now %q", got)
	}
}

func TestComposeCheckOfTextRefusals(t *testing.T) {
	f, _, _, router := composeExtFixture(t)
	for name, c := range map[string]struct {
		body map[string]string
		code int
	}{
		"not yaml":     {map[string]string{"file": "c0", "content": "services:\n  web: INVALID: x\n"}, 422},
		"unknown file": {map[string]string{"file": "c9", "content": "services: {}\n"}, 404},
		"too large":    {map[string]string{"file": "c0", "content": strings.Repeat("# x\n", composeStageMax)}, 413},
	} {
		if code, _ := composeCheckBodyPost(t, router, c.body); code != c.code {
			t.Errorf("%s: %d, want %d", name, code, c.code)
		}
	}
	if n := len(createsOf(f)); n != 0 {
		t.Errorf("a refused check made %d helpers", n)
	}
}
