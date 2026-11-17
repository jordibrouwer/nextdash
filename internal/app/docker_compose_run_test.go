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

const composeRunHelperImage = "docker:29.7-cli"

// composeRunFixture is the save fixture with the helper image already present.
func composeRunFixture(t *testing.T) (*fakeDocker, *Handlers, http.Handler) {
	t.Helper()
	f, _, h, router := composeSaveFixture(t)
	t.Setenv("NEXTDASH_COMPOSE_SOCKET", "")
	f.images[composeRunHelperImage] = fakeImage{ID: "sha256:helper"}
	return f, h, router
}

func composeRunPost(t *testing.T, router http.Handler, action, query, token string) (int, map[string]any, string) {
	t.Helper()
	rec := hostsCall(t, router, "POST", "/api/docker/compose/media/"+action+query, "", token)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out, rec.Body.String()
}

func anyStrings(v any) []string {
	var out []string
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

// every helper that was made was also removed, by force
func composeAllHelpersRemoved(t *testing.T, f *fakeDocker) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	removed := map[string]bool{}
	for _, r := range f.removed {
		removed[r.ID] = r.Force
	}
	for id, c := range f.containers {
		if c.Labels[dockerHelperLabel] != "" {
			t.Errorf("helper %s is still there (%s)", c.Name, c.State)
		}
		_ = id
	}
	if len(removed) == 0 {
		t.Error("nothing was removed")
	}
	for id, force := range removed {
		if !force {
			t.Errorf("%s removed without force", id)
		}
	}
}

func createsOf(f *fakeDocker) []map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]map[string]any(nil), f.createBodies...)
}

func TestComposeHelperCreateBody(t *testing.T) {
	const cf = "/opt/stacks/media/compose.yml"
	for _, c := range []struct {
		action string
		want   []string
	}{
		{"up", []string{"up", "-d"}},
		{"down", []string{"down"}},
		{"pull", []string{"pull"}},
	} {
		t.Run(c.action, func(t *testing.T) {
			f, _, router := composeRunFixture(t)
			if code, out, raw := composeRunPost(t, router, c.action, "", ""); code != 200 || out["ok"] != true || out["action"] != c.action {
				t.Fatalf("%d %s", code, raw)
			}
			bodies := createsOf(f)
			want := 1
			if c.action == "up" {
				want = 2 // config -q, then up
			}
			if len(bodies) != want {
				t.Fatalf("%d helpers created: %v", len(bodies), bodies)
			}
			b := bodies[len(bodies)-1]
			base := []string{"compose", "--ansi", "never", "-p", "media", "--project-directory", "/opt/stacks/media", "-f", cf}
			if got := anyStrings(b["Cmd"]); !reflect.DeepEqual(got, append(base, c.want...)) {
				t.Errorf("Cmd = %v", got)
			}
			if got := anyStrings(b["Entrypoint"]); !reflect.DeepEqual(got, []string{"docker"}) {
				t.Errorf("Entrypoint = %v", got)
			}
			if b["Image"] != composeRunHelperImage || b["WorkingDir"] != "/opt/stacks/media" {
				t.Errorf("image/dir = %v %v", b["Image"], b["WorkingDir"])
			}
			labels := b["Labels"].(map[string]any)
			if labels[dockerHelperLabel] != "compose" || labels["nextdash.compose.project"] != "media" {
				t.Errorf("labels = %v", labels)
			}
			hc := b["HostConfig"].(map[string]any)
			if got := anyStrings(hc["Binds"]); !reflect.DeepEqual(got, []string{f.socket + ":/var/run/docker.sock", "/opt/stacks/media:/opt/stacks/media:ro"}) {
				t.Errorf("Binds = %v", got)
			}
			if hc["NetworkMode"] != "none" || hc["AutoRemove"] != false {
				t.Errorf("HostConfig = %v", hc)
			}
			if c.action == "down" {
				for _, a := range anyStrings(b["Cmd"]) {
					if a == "-v" || a == "--volumes" || a == "--rmi" || strings.HasPrefix(a, "--rmi=") {
						t.Errorf("down carries %s", a)
					}
				}
			}
			composeAllHelpersRemoved(t, f)
		})
	}
}

func TestComposeHelperBindsAnOutsideConfigDirectory(t *testing.T) {
	p := composeProject{Name: "m", WorkingDir: "/opt/stacks/m", ConfigFiles: []string{"/opt/stacks/m/compose.yml", "/etc/shared/base.yml", "/etc/shared/more.yml"}}
	hc := composeHelperBody(p, []string{"down"}, "/s.sock")["HostConfig"].(map[string]any)
	want := []string{"/s.sock:/var/run/docker.sock", "/opt/stacks/m:/opt/stacks/m:ro", "/etc/shared:/etc/shared:ro"}
	if got := hc["Binds"].([]string); !reflect.DeepEqual(got, want) {
		t.Errorf("Binds = %v", got)
	}
}

func TestComposeUpValidatesFirst(t *testing.T) {
	f, _, router := composeRunFixture(t)
	f.helperExitSeq = []int{1}
	f.helperLogs = []string{"service web: image is required"}
	code, out, raw := composeRunPost(t, router, "up", "", "")
	if code != 422 || out["reason"] != composeInvalid || out["exitCode"].(float64) != 1 || !strings.Contains(raw, "image is required") {
		t.Fatalf("%d %s", code, raw)
	}
	bodies := createsOf(f)
	if len(bodies) != 1 {
		t.Fatalf("%d creates after a failed validation", len(bodies))
	}
	if got := anyStrings(bodies[0]["Cmd"]); got[len(got)-2] != "config" || got[len(got)-1] != "-q" {
		t.Errorf("first helper ran %v", got)
	}
	composeAllHelpersRemoved(t, f)
}

func TestComposeRunFailureCarriesTheTail(t *testing.T) {
	f, _, router := composeRunFixture(t)
	f.helperExitSeq = []int{0, 3} // validate ok, up fails
	f.helperLogs = []string{"pulling", "boom"}
	code, out, _ := composeRunPost(t, router, "up", "", "")
	if code != 502 || out["reason"] != composeFailed || out["exitCode"].(float64) != 3 || !reflect.DeepEqual(anyStrings(out["tail"]), []string{"pulling", "boom"}) {
		t.Fatalf("%d %v", code, out)
	}
	composeAllHelpersRemoved(t, f)
}

func TestComposeHelperRemovedOnEveryPath(t *testing.T) {
	t.Run("exit 1", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		f.helperExit = 1
		if code, _, _ := composeRunPost(t, router, "down", "", ""); code != 502 {
			t.Fatalf("%d", code)
		}
		composeAllHelpersRemoved(t, f)
	})
	t.Run("start fails", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		f.failStartHelper = true
		if code, _, _ := composeRunPost(t, router, "down", "", ""); code != 502 {
			t.Fatalf("%d", code)
		}
		composeAllHelpersRemoved(t, f)
	})
	t.Run("wait fails", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		f.failWait = true
		if code, _, _ := composeRunPost(t, router, "down", "", ""); code != 502 {
			t.Fatalf("%d", code)
		}
		composeAllHelpersRemoved(t, f)
	})
	t.Run("pull times out: nothing changed, helper removed", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		old := composePullTimeout
		composePullTimeout = 400 * time.Millisecond
		t.Cleanup(func() { composePullTimeout = old })
		f.holdWait = true
		code, out, _ := composeRunPost(t, router, "pull", "", "")
		if code != 504 || out["reason"] != composeTimeout || out["running"] != false {
			t.Fatalf("%d %v", code, out)
		}
		composeAllHelpersRemoved(t, f)
	})
	t.Run("up times out: compose is not killed", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		old := composeRunTimeout
		composeRunTimeout = 400 * time.Millisecond
		t.Cleanup(func() { composeRunTimeout = old })
		f.holdWait = true
		// validate (config) also holds, but has its own 2 minute budget: let it exit.
		f.helperExitSeq = nil
		code, out, _ := composeRunPost(t, router, "down", "", "")
		if code != 504 || out["reason"] != composeTimeout || out["running"] != true {
			t.Fatalf("%d %v", code, out)
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		for _, r := range f.removed {
			t.Errorf("a running compose was removed: %+v", r)
		}
		live := 0
		for _, c := range f.containers {
			if c.Labels[dockerHelperLabel] == "compose" {
				live++
			}
		}
		if live != 1 {
			t.Errorf("want the helper left running, found %d", live)
		}
	})
	t.Run("create fails: nothing to remove", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		f.failCreate = true
		if code, _, _ := composeRunPost(t, router, "down", "", ""); code != 502 {
			t.Fatalf("%d", code)
		}
		if len(f.removed) != 0 {
			t.Errorf("removed %v", f.removed)
		}
	})
}

func TestComposePullsTheHelperImageOnlyWhenMissing(t *testing.T) {
	f, _, router := composeRunFixture(t)
	if code, _, raw := composeRunPost(t, router, "pull", "", ""); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if f.called("POST /images/create") {
		t.Fatal("pulled an image that was present")
	}
	f2, _, router2 := composeRunFixture(t)
	delete(f2.images, composeRunHelperImage)
	if code, _, raw := composeRunPost(t, router2, "pull", "", ""); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if !f2.called("POST /images/create?fromImage=docker&tag=29.7-cli") {
		t.Fatalf("no pull: %v", f2.calls)
	}
}

func TestComposeRunGates(t *testing.T) {
	t.Run("own stack", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		dockerSelfOverride = strings.Repeat("a", 12)
		t.Cleanup(func() { dockerSelfOverride = "" })
		code, out, _ := composeRunPost(t, router, "down", "", "")
		if code != 403 || out["reason"] != reasonDockerSelf || len(createsOf(f)) != 0 {
			t.Fatalf("%d %v", code, out)
		}
	})
	t.Run("control off", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
		code, out, _ := composeRunPost(t, router, "down", "", "")
		if code != 403 || out["reason"] != reasonDockerControlOff || len(createsOf(f)) != 0 {
			t.Fatalf("%d %v", code, out)
		}
	})
	t.Run("token", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		t.Setenv("NEXTDASH_WRITE_TOKEN", "sekret")
		if code, _, _ := composeRunPost(t, router, "down", "", ""); code != 401 || len(createsOf(f)) != 0 {
			t.Fatalf("%d", code)
		}
		if code, _, _ := composeRunPost(t, router, "down", "", "sekret"); code != 200 {
			t.Fatalf("with token: %d", code)
		}
	})
	t.Run("remote host", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		remote, addr := startFakeDockerTCP(t)
		remote.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "r", State: "running", Labels: map[string]string{composeLabelProject: "media"}})
		host := addRemoteHost(t, addr, true)
		code, out, _ := composeRunPost(t, router, "down", "?host="+host.ID, "")
		if code != 403 || out["reason"] != reasonDockerLocalOnly || len(createsOf(f)) != 0 || len(createsOf(remote)) != 0 {
			t.Fatalf("%d %v", code, out)
		}
	})
	t.Run("a member is busy", func(t *testing.T) {
		f, h, router := composeRunFixture(t)
		release, ok := h.dockerLock("name:media-web-1")
		if !ok {
			t.Fatal("lock")
		}
		code, out, _ := composeRunPost(t, router, "down", "", "")
		release()
		if code != 409 || out["reason"] != "busy" || len(createsOf(f)) != 0 {
			t.Fatalf("%d %v", code, out)
		}
		// and nothing stays locked after the refusal
		if _, ok := h.dockerLock("compose:media"); !ok {
			t.Error("the project lock leaked")
		}
	})
	t.Run("prune running", func(t *testing.T) {
		f, h, router := composeRunFixture(t)
		h.dockerPruneRunning.Store(true)
		for _, a := range []string{"up", "pull"} {
			code, out, _ := composeRunPost(t, router, a, "", "")
			if code != 409 || out["reason"] != "prune-running" {
				t.Fatalf("%s: %d %v", a, code, out)
			}
		}
		if len(createsOf(f)) != 0 {
			t.Error("a helper was created")
		}
	})
	t.Run("unknown action and project", func(t *testing.T) {
		_, _, router := composeRunFixture(t)
		if code, _, _ := composeRunPost(t, router, "files", "", ""); code != 404 {
			t.Errorf("action: %d", code)
		}
		if rec := hostsCall(t, router, "POST", "/api/docker/compose/nope/down", "", ""); rec.Code != 404 {
			t.Errorf("project: %d", rec.Code)
		}
	})
	t.Run("no compose labels", func(t *testing.T) {
		f, _, router := composeRunFixture(t)
		f.mu.Lock()
		for _, c := range f.containers {
			delete(c.Labels, composeLabelConfig)
		}
		f.mu.Unlock()
		code, out, _ := composeRunPost(t, router, "down", "", "")
		if code != 409 || out["reason"] != composeNoLabels {
			t.Fatalf("%d %v", code, out)
		}
	})
}

func TestComposeRunStreams(t *testing.T) {
	f, _, router := composeRunFixture(t)
	f.helperLogs = []string{"one", "two"}
	rec := hostsCall(t, router, "POST", "/api/docker/compose/media/up?stream=1", "", "")
	if rec.Code != 200 {
		t.Fatalf("%d", rec.Code)
	}
	var events []dockerProgressEvent
	sc := bufio.NewScanner(rec.Body)
	for sc.Scan() {
		var ev dockerProgressEvent
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			t.Fatalf("bad line %q", sc.Text())
		}
		events = append(events, ev)
	}
	last := events[len(events)-1]
	var body map[string]any
	_ = json.Unmarshal(last.Body, &body)
	if last.Type != "result" || last.Status != 200 || body["ok"] != true || body["exitCode"].(float64) != 0 {
		t.Fatalf("last = %+v %s", last, last.Body)
	}
	var logs, steps []string
	for _, ev := range events {
		switch ev.Type {
		case "log":
			logs = append(logs, ev.Text)
		case "step":
			steps = append(steps, ev.Step+":"+ev.State)
		}
	}
	if !reflect.DeepEqual(logs, []string{"one", "two", "one", "two"}) {
		t.Errorf("logs = %v", logs)
	}
	want := []string{"image:start", "image:done", "validate:start", "validate:done", "run:start", "cleanup:start", "cleanup:done", "run:done"}
	if !reflect.DeepEqual(steps, want) {
		t.Errorf("steps = %v", steps)
	}
}

func TestComposeSocketHostPath(t *testing.T) {
	f, _, _ := composeRunFixture(t)
	h := dockerTestHandlers(t)
	a, reason := h.dockerAPIFor(httpGet())
	if a == nil {
		t.Fatal(reason)
	}
	ctx := httpGet().Context()
	// No self (not in a container): the configured path is the host path.
	if got := composeHostSocket(ctx, a); got != f.socket {
		t.Errorf("no self = %q, want the configured socket %q", got, f.socket)
	}
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "")
	if got := composeHostSocket(ctx, a); got != composeDefaultSocket {
		t.Errorf("default = %q", got)
	}
	t.Setenv("NEXTDASH_DOCKER_SOCKET", f.socket)
	// Self mounts the socket from a host path that differs from the one inside.
	f.add(fakeContainer{ID: strings.Repeat("c", 64), Name: "nextdash", State: "running", Mounts: []map[string]any{
		{"Type": "bind", "Source": "/Users/me/.docker/run/docker.sock", "Destination": f.socket, "RW": true},
		{"Type": "bind", "Source": "/data", "Destination": "/app/data", "RW": true},
	}})
	dockerSelfOverride = strings.Repeat("c", 12)
	t.Cleanup(func() { dockerSelfOverride = "" })
	if got := composeHostSocket(ctx, a); got != "/Users/me/.docker/run/docker.sock" {
		t.Errorf("from self = %q", got)
	}
	// The env wins.
	t.Setenv("NEXTDASH_COMPOSE_SOCKET", "/custom.sock")
	if got := composeHostSocket(ctx, a); got != "/custom.sock" {
		t.Errorf("override = %q", got)
	}
}

func httpGet() *http.Request {
	r, _ := http.NewRequest("GET", "/", nil)
	return r
}

// ---- the helper is invisible ----

func TestContainerNotifierIgnoresComposeHelpers(t *testing.T) {
	r := newNotifierRun(t)
	r.ev("die", "nextdash-compose-media-ab12cd34", "exitCode", "1", dockerHelperLabel, "compose").at(time.Minute).tick()
	r.want()
	if w := r.n.watch["nextdash-compose-media-ab12cd34"]; w != nil {
		t.Fatalf("a helper is being watched: %+v", w)
	}
	// reconcile feeds listed containers as events; a running helper is skipped too.
	out := r.n.reconcile([]dockerContainerSummary{{ID: "x", Names: []string{"/nextdash-compose-media-ab12cd34"}, State: "running",
		Labels: map[string]string{dockerHelperLabel: "compose"}}}, r.now, r.ok)
	if len(out) != 0 || r.n.watch["nextdash-compose-media-ab12cd34"] != nil {
		t.Fatalf("reconcile saw the helper: %v", out)
	}
}

func TestComposeHelpersAreNotListed(t *testing.T) {
	hostsTestDir(t)
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running"})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "nextdash-compose-media-ab12cd34", State: "exited",
		Labels: map[string]string{dockerHelperLabel: "compose"}})
	router := newDockerTestRouter(dockerTestHandlers(t))
	rec := hostsCall(t, router, "GET", "/api/docker/containers", "", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"web"`) || strings.Contains(rec.Body.String(), "nextdash-compose") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}
