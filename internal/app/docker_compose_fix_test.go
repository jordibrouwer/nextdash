package app

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// F2: the stack's env file and profiles reach the helper.
func TestComposeHelperCarriesEnvFilesAndProfiles(t *testing.T) {
	p := composeProject{Name: "m", WorkingDir: "/opt/stacks/m", ConfigFiles: []string{"/opt/stacks/m/compose.yml"},
		EnvFiles: []string{"/etc/secrets/prod.env", "/opt/stacks/m/.env", "relative.env"}, Profiles: []string{"debug", "extra"}}
	b := composeHelperBody(p, []string{"up", "-d"}, "/s.sock")
	want := []string{"compose", "--ansi", "never", "-p", "m", "--project-directory", "/opt/stacks/m",
		"--env-file", "/etc/secrets/prod.env", "--env-file", "/opt/stacks/m/.env", "--profile", "debug", "--profile", "extra",
		"-f", "/opt/stacks/m/compose.yml", "up", "-d"}
	if got := b["Cmd"].([]string); !reflect.DeepEqual(got, want) {
		t.Errorf("Cmd = %v", got)
	}
	binds := b["HostConfig"].(map[string]any)["Binds"].([]string)
	if !reflect.DeepEqual(binds, []string{"/s.sock:/var/run/docker.sock", "/opt/stacks/m:/opt/stacks/m:ro", "/etc/secrets:/etc/secrets:ro"}) {
		t.Errorf("Binds = %v", binds)
	}
}

func TestComposeUpRunsWithTheEnvironmentFileLabel(t *testing.T) {
	f, _, _, router := composeSaveFixtureForRun(t)
	f.mu.Lock()
	f.containers[strings.Repeat("a", 64)].Labels[composeLabelEnvFile] = "/opt/stacks/media/prod.env"
	f.mu.Unlock()
	if code, _, raw := composeRunPost(t, router, "up", "", ""); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	for _, b := range createsOf(f) {
		if cmd := anyStrings(b["Cmd"]); !reflect.DeepEqual(cmd[7:9], []string{"--env-file", "/opt/stacks/media/prod.env"}) {
			t.Errorf("a helper without the env file: %v", cmd)
		}
	}
}

func composeSaveFixtureForRun(t *testing.T) (*fakeDocker, *Handlers, string, http.Handler) {
	f, h, router := composeRunFixture(t)
	return f, h, "", router
}

func TestComposeUpRefusesUnsetVariables(t *testing.T) {
	f, _, _, router := composeSaveFixtureForRun(t)
	f.helperLogs = []string{`time="x" level=warning msg="The \"PUID\" variable is not set. Defaulting to a blank string."`,
		`time="x" level=warning msg="The \"TZ\" variable is not set. Defaulting to a blank string."`}
	code, out, raw := composeRunPost(t, router, "up", "", "")
	if code != 409 || out["reason"] != composeUnsetVars || !reflect.DeepEqual(anyStrings(out["vars"]), []string{"PUID", "TZ"}) {
		t.Fatalf("%d %s", code, raw)
	}
	if !reflect.DeepEqual(anyStrings(out["names"]), []string{"PUID", "TZ"}) {
		t.Errorf("names = %v", out["names"])
	}
	if !strings.Contains(out["message"].(string), "PUID, TZ") {
		t.Errorf("message must name the variables: %v", out["message"])
	}
	if n := len(createsOf(f)); n != 1 {
		t.Errorf("only the validate helper may have run, got %d", n)
	}
	// The one-time confirmation: the same run goes ahead with blanks.
	if code, _, raw := composeRunPost(t, router, "up", "?allowUnset=1", ""); code != 200 {
		t.Fatalf("allow-unset: %d %s", code, raw)
	}
}

func TestComposeCheckListsUnsetVariablesWithoutRefusing(t *testing.T) {
	f, _, _, router := composeSaveFixtureForRun(t)
	f.helperLogs = []string{`level=warning msg="The \"PUID\" variable is not set."`}
	code, out, raw := composeRunPost(t, router, "check", "", "")
	if code != 200 || out["ok"] != true || !reflect.DeepEqual(anyStrings(out["unsetVars"]), []string{"PUID"}) {
		t.Fatalf("%d %s", code, raw)
	}
}

// F5: a Check of an edited .env stands the text in for the env file.
func TestComposeCheckOfAnEditedEnvFile(t *testing.T) {
	f, file, _, router := composeExtFixture(t)
	envPath := filepath.Join(filepath.Dir(file), ".env")
	writeTestFile(t, envPath, "A=1\n")
	code, out := composeCheckBodyPost(t, router, map[string]string{"file": "env", "content": "A=2\nSECRET=hunter2\n"})
	if code != 200 || out["ok"] != true || out["stagedIgnored"] != nil {
		t.Fatalf("%d %v", code, out)
	}
	b := createsOf(f)[0]
	cmd := anyStrings(b["Cmd"])
	if !strings.Contains(strings.Join(cmd, " "), "--env-file "+composeStagePath) || !strings.Contains(cmd[0], composeStagePath) {
		t.Errorf("the staged env file is not handed over: %v", cmd)
	}
	if env := anyStrings(b["Env"]); len(env) != 1 || env[0] != "NEXTDASH_COMPOSE_STAGE=A=2\nSECRET=hunter2\n" {
		t.Errorf("Env = %v", env)
	}
	if mustRead(t, envPath) != "A=1\n" {
		t.Error("a check must write nothing")
	}
}

func TestComposeCheckOfAServiceEnvFileSaysItWasNotStaged(t *testing.T) {
	_, file, _, router := composeExtFixture(t)
	dir := filepath.Dir(file)
	writeTestFile(t, file, "services:\n  web:\n    image: nginx\n    env_file: app.env\n")
	writeTestFile(t, filepath.Join(dir, "app.env"), "A=1\n")
	code, out := composeCheckBodyPost(t, router, map[string]string{"file": "e0", "content": "A=2\n"})
	if code != 200 || out["stagedIgnored"] != true {
		t.Fatalf("%d %v", code, out)
	}
}

// F9
func TestComposeHelperBindsTheDockerConfigOnlyWhenSet(t *testing.T) {
	p := composeProject{Name: "m", WorkingDir: "/opt/stacks/m", ConfigFiles: []string{"/opt/stacks/m/compose.yml"}}
	has := func() bool {
		for _, b := range composeHelperBody(p, []string{"pull"}, "/s")["HostConfig"].(map[string]any)["Binds"].([]string) {
			if b == "/home/u/.docker:/root/.docker:ro" {
				return true
			}
		}
		return false
	}
	if has() {
		t.Error("no bind without the setting")
	}
	t.Setenv("NEXTDASH_COMPOSE_DOCKER_CONFIG", "/home/u/.docker")
	if !has() {
		t.Error("the config folder must be bound read-only")
	}
}

func TestComposePullFailureOnAPrivateImageHasAHint(t *testing.T) {
	f, _, _, router := composeSaveFixtureForRun(t)
	f.helperExit = 1
	f.helperLogs = []string{"Error response from daemon: unauthorized: authentication required"}
	code, out, _ := composeRunPost(t, router, "pull", "", "")
	if code != 502 || !strings.Contains(out["hint"].(string), "NEXTDASH_COMPOSE_DOCKER_CONFIG") {
		t.Fatalf("%d %v", code, out)
	}
}

// F10: helpers are gone from every list, and a start-up sweep removes finished ones.
func TestListContainersHidesHelpersAtTheSource(t *testing.T) {
	hostsTestDir(t)
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running"})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "nextdash-compose-x-1", State: "exited", Labels: map[string]string{dockerHelperLabel: "compose"}})
	api, _ := dockerTestHandlers(t).dockerAPIFor(httpGet())
	list, err := api.listContainers(context.Background())
	if err != nil || len(list) != 1 || list[0].name() != "web" {
		t.Fatalf("listContainers = %v %v", list, err)
	}
	if all, _ := api.listAllContainers(context.Background()); len(all) != 2 {
		t.Fatalf("the sweep needs the unfiltered list: %d", len(all))
	}
}

func TestComposeSweepAllRemovesFinishedHelpersOfEveryProject(t *testing.T) {
	hostsTestDir(t)
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "h1", State: "exited", Labels: map[string]string{dockerHelperLabel: "compose", "nextdash.compose.project": "one"}})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "h2", State: "running", Labels: map[string]string{dockerHelperLabel: "compose", "nextdash.compose.project": "two"}})
	f.add(fakeContainer{ID: strings.Repeat("c", 64), Name: "web", State: "exited"})
	api, _ := dockerTestHandlers(t).dockerAPIFor(httpGet())
	composeSweepAll(context.Background(), api)
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.removed) != 1 || f.removed[0].ID != strings.Repeat("a", 64) {
		t.Errorf("removed = %+v", f.removed)
	}
}

func TestComposeRefusesARunWhileAnEarlierHelperStillRuns(t *testing.T) {
	f, _, _, router := composeSaveFixtureForRun(t)
	f.add(fakeContainer{ID: strings.Repeat("d", 64), Name: "left", State: "running", Labels: map[string]string{dockerHelperLabel: "compose", "nextdash.compose.project": "media"}})
	code, out, _ := composeRunPost(t, router, "up", "", "")
	if code != 409 || out["reason"] != composeRunning {
		t.Fatalf("%d %v", code, out)
	}
}

// F11 is TestEveryDataFileHasABackupPolicy; this pins the policy.
func TestComposeAppliedIsNeverExported(t *testing.T) {
	if dataFiles["compose-applied.json"] != dataNever {
		t.Error("compose-applied.json must be dataNever")
	}
}

// F12 note when saving as non-root onto vfat is covered in docker_compose_save_test.go.

// F8: the follower never writes after the helper function has returned.
func TestComposeFollowerEndsBeforeTheRunReturns(t *testing.T) {
	f, _, _, _ := composeSaveFixtureForRun(t)
	f.failWait = true
	f.helperLogs = []string{"a", "b", "c"}
	api, _ := dockerTestHandlers(t).dockerAPIFor(httpGet())
	p := composeProject{Name: "media", WorkingDir: "/opt/stacks/media", ConfigFiles: []string{"/opt/stacks/media/compose.yml"}}
	before := time.Now()
	_, _, err := runComposeHelper(context.Background(), api.forActions(), p, []string{"down"})
	if err == nil {
		t.Fatal("wait was set to fail")
	}
	if time.Since(before) > 4*time.Second {
		t.Errorf("the run waited the whole bound for a follower that should end with the container: %v", time.Since(before))
	}
}

func TestComposeUnsetNamesParsesWarnings(t *testing.T) {
	got := composeUnsetNames([]string{`The "B" variable is not set. Defaulting to a blank string.`, `x The "A" variable is not set`, `The "B" variable is not set`, "nothing"})
	if !reflect.DeepEqual(got, []string{"A", "B"}) {
		t.Errorf("%v", got)
	}
}

// keep the os import honest for the env test helpers
var _ = os.Getenv
