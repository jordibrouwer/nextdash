package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestDemoDocker(t *testing.T) *demoDocker {
	t.Helper()
	d := &demoDocker{stacksDir: t.TempDir()}
	d.reset(time.Now())
	return d
}

func demoCall(t *testing.T, d *demoDocker, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	rec := httptest.NewRecorder()
	d.ServeHTTP(rec, httptest.NewRequest(method, path, &buf))
	return rec
}

// runDemoHelper plays what nextDash does with a helper: create, start, wait,
// read the log, remove. It returns the exit code and the log lines.
func runDemoHelper(t *testing.T, d *demoDocker, project string, stage string, args ...string) (int, []string) {
	t.Helper()
	dir := demoStackHostDir + "/" + project
	cmd := []string{"compose", "--ansi", "never", "-p", project, "--project-directory", dir, "--env-file", dir + "/.env", "-f", dir + "/compose.yml"}
	cmd = append(cmd, args...)
	body := map[string]any{"Image": composeHelperImage(), "Entrypoint": []string{"docker"}, "Cmd": cmd,
		"Labels": map[string]string{dockerHelperLabel: "compose"}}
	if stage != "" {
		for i := range cmd {
			if cmd[i] == "-f" {
				cmd[i+1] = "-"
			}
		}
		body["Entrypoint"] = []string{"sh", "-c"}
		body["Cmd"] = append([]string{`printf '%s' "$NEXTDASH_COMPOSE_STAGE" | docker "$@"`, "sh"}, cmd...)
		body["Env"] = []string{"NEXTDASH_COMPOSE_STAGE=" + stage}
	}
	rec := demoCall(t, d, http.MethodPost, "/containers/create?name=nextdash-compose-"+project+"-t", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var made struct{ Id string }
	_ = json.Unmarshal(rec.Body.Bytes(), &made)
	if rec = demoCall(t, d, http.MethodPost, "/containers/"+made.Id+"/start", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("start: %d", rec.Code)
	}
	rec = demoCall(t, d, http.MethodPost, "/containers/"+made.Id+"/wait", nil)
	var waited struct{ StatusCode int }
	_ = json.Unmarshal(rec.Body.Bytes(), &waited)
	logs := demoCall(t, d, http.MethodGet, "/containers/"+made.Id+"/logs?stdout=1&follow=1", nil).Body.Bytes()
	var lines []string
	for len(logs) >= 8 {
		n := int(logs[4])<<24 | int(logs[5])<<16 | int(logs[6])<<8 | int(logs[7])
		if len(logs) < 8+n {
			break
		}
		lines = append(lines, strings.TrimRight(string(logs[8:8+n]), "\n"))
		logs = logs[8+n:]
	}
	demoCall(t, d, http.MethodDelete, "/containers/"+made.Id+"?force=true&v=true", nil)
	return waited.StatusCode, lines
}

func (d *demoDocker) member(project, name string) *demoContainer { return d.stackMember(project, name) }

func TestDemoStacksCarryTheComposeLabelsAndFiles(t *testing.T) {
	d := newTestDemoDocker(t)
	c := d.member("media", "sonarr")
	if c == nil {
		t.Fatal("no sonarr")
	}
	l := c.labels()
	if l["com.docker.compose.project.config_files"] != "/srv/stacks/media/compose.yml" || l["com.docker.compose.project.working_dir"] != "/srv/stacks/media" {
		t.Fatalf("labels: %v", l)
	}
	data, err := os.ReadFile(filepath.Join(d.stacksDir, "media", "compose.yml"))
	if err != nil || !strings.Contains(string(data), "  sonarr:\n    image: lscr.io/linuxserver/sonarr:4") {
		t.Fatalf("compose file: %v %s", err, data)
	}
	if env, _ := os.ReadFile(filepath.Join(d.stacksDir, "photos", ".env")); !strings.Contains(string(env), "DB_PASSWORD=") {
		t.Fatalf("photos .env: %s", env)
	}
}

func TestDemoComposeCheckAcceptsTheFilesAndRefusesBrokenText(t *testing.T) {
	d := newTestDemoDocker(t)
	if exit, lines := runDemoHelper(t, d, "media", "", "config", "-q"); exit != 0 || len(lines) != 0 {
		t.Fatalf("config -q: exit %d, %v", exit, lines)
	}
	if exit, lines := runDemoHelper(t, d, "media", "services:\n  a:\n   image: x\n  b: [", "config", "-q"); exit != 15 || len(lines) == 0 {
		t.Fatalf("broken text: exit %d, %v", exit, lines)
	}
	if exit, _ := runDemoHelper(t, d, "media", "services:\n  a:\n    ports: []\n", "config", "-q"); exit != 15 {
		t.Fatalf("a service without an image: exit %d", exit)
	}
}

func TestDemoComposeCheckWarnsAboutAVariableNothingSets(t *testing.T) {
	d := newTestDemoDocker(t)
	_, lines := runDemoHelper(t, d, "media", "services:\n  a:\n    image: x:1\n    environment:\n      K: ${NOPE}\n", "config", "-q")
	if len(lines) != 1 || !composeUnsetVar.MatchString(lines[0]) {
		t.Fatalf("lines: %v", lines)
	}
	if names := composeUnsetNames(lines); len(names) != 1 || names[0] != "NOPE" {
		t.Fatalf("names: %v", names)
	}
}

func TestDemoComposeDownStopsTheStackAndUpStartsItAgain(t *testing.T) {
	d := newTestDemoDocker(t)
	if exit, _ := runDemoHelper(t, d, "photos", "", "down"); exit != 0 {
		t.Fatalf("down: %d", exit)
	}
	// Kept, stopped: a stack with no container would leave the list for good.
	for _, name := range []string{"immich-server", "immich-postgres"} {
		if c := d.member("photos", name); c == nil || c.State != "exited" {
			t.Fatalf("%s after down: %+v", name, c)
		}
	}
	exit, lines := runDemoHelper(t, d, "photos", "", "up", "-d")
	if exit != 0 || d.member("photos", "immich-server").State != "running" {
		t.Fatalf("up: %d %v", exit, lines)
	}
	if !strings.Contains(strings.Join(lines, "\n"), "Container immich-server  Started") {
		t.Fatalf("log: %v", lines)
	}
}

func TestDemoComposeUpMakesAServiceTheFileAddedAndRemovesOrphansOnRequest(t *testing.T) {
	d := newTestDemoDocker(t)
	file := filepath.Join(d.stacksDir, "security", "compose.yml")
	data, _ := os.ReadFile(file)
	added := string(data) + "  whoami:\n    image: traefik/whoami:v1.10\n    ports:\n      - \"8081:8081\"\n"
	if err := os.WriteFile(file, []byte(added), 0o644); err != nil {
		t.Fatal(err)
	}
	runDemoHelper(t, d, "security", "", "up", "-d")
	if c := d.member("security", "whoami"); c == nil || c.State != "running" {
		t.Fatalf("whoami: %+v", c)
	}
	if err := os.WriteFile(file, data, 0o644); err != nil {
		t.Fatal(err)
	}
	_, lines := runDemoHelper(t, d, "security", "", "up", "-d")
	if d.member("security", "whoami") == nil || !strings.Contains(strings.Join(lines, "\n"), "orphan containers ([whoami])") {
		t.Fatalf("orphan not reported: %v", lines)
	}
	runDemoHelper(t, d, "security", "", "up", "-d", "--remove-orphans")
	if d.member("security", "whoami") != nil {
		t.Fatal("the orphan stayed")
	}
}

func TestDemoComposeUpRecreatesAServiceWhoseImageChanged(t *testing.T) {
	d := newTestDemoDocker(t)
	file := filepath.Join(d.stacksDir, "media", "compose.yml")
	data, _ := os.ReadFile(file)
	changed := strings.Replace(string(data), "sonarr:4", "sonarr:5", 1)
	if err := os.WriteFile(file, []byte(changed), 0o644); err != nil {
		t.Fatal(err)
	}
	_, plan := runDemoHelper(t, d, "media", "", "up", "-d", "--dry-run")
	found := false
	for _, l := range plan {
		if m := composePlanLine.FindStringSubmatch(l); m != nil && m[2] == "sonarr" && strings.EqualFold(m[3], "recreate") && strings.Contains(l, "DRY-RUN") {
			found = true
		}
	}
	if !found || d.member("media", "sonarr").Image != "lscr.io/linuxserver/sonarr:4" {
		t.Fatalf("dry run %v changed the demo or missed sonarr", plan)
	}
	runDemoHelper(t, d, "media", "", "up", "-d")
	if c := d.member("media", "sonarr"); c.Image != "lscr.io/linuxserver/sonarr:5" || c.State != "running" {
		t.Fatalf("after up: %+v", c)
	}
}

func TestDemoComposeRestartAndPullAndAServiceOnly(t *testing.T) {
	d := newTestDemoDocker(t)
	before := d.member("media", "radarr").Created
	time.Sleep(1100 * time.Millisecond)
	if exit, lines := runDemoHelper(t, d, "media", "", "restart", "radarr"); exit != 0 || d.member("media", "radarr").Created <= before || strings.Contains(strings.Join(lines, "\n"), "sonarr") {
		t.Fatalf("restart one: %d %v", exit, lines)
	}
	if exit, lines := runDemoHelper(t, d, "media", "", "pull", "ghost"); exit == 0 {
		t.Fatalf("a service that is not there: %d %v", exit, lines)
	}
	if exit, _ := runDemoHelper(t, d, "media", "", "version", "--short"); exit != 0 {
		t.Fatal("version")
	}
}

func TestDemoHelpersAreRemovedAndNeverLeakJobs(t *testing.T) {
	d := newTestDemoDocker(t)
	runDemoHelper(t, d, "media", "", "config", "-q")
	if len(d.jobs) != 0 {
		t.Fatalf("jobs left: %v", d.jobs)
	}
	for _, c := range d.containers {
		if c.Helper != nil {
			t.Fatalf("a helper is left: %s", c.Name)
		}
	}
}
