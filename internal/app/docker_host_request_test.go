package app

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func getJSON(t *testing.T, router http.Handler, path string) (int, map[string]any) {
	t.Helper()
	rec := hostsCall(t, router, "GET", path, "", "")
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// A remote host on a fake TCP daemon, registered through the same store the
// hosts API writes.
func addRemoteHost(t *testing.T, addr string, allow bool) DockerHost {
	t.Helper()
	h, err := addDockerHost(DockerHost{Name: "pi", Kind: "tcp", Address: addr, AllowActions: allow}, dockerHostSecretUpdate{})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func containerNames(body map[string]any) []string {
	var names []string
	list, _ := body["containers"].([]any)
	for _, c := range list {
		names = append(names, c.(map[string]any)["name"].(string))
	}
	return names
}

func TestContainersListFollowsTheHostParam(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	local := startFakeDocker(t)
	local.add(fakeContainer{ID: strings.Repeat("1", 64), Name: "postgres", Image: "postgres:16", State: "running"})
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("2", 64), Name: "postgres", Image: "postgres:15", State: "running"})
	remote.add(fakeContainer{ID: strings.Repeat("3", 64), Name: "pihole", Image: "pihole:latest", State: "running"})
	h := addRemoteHost(t, addr, false)

	_, body := getJSON(t, router, "/api/docker/containers")
	if got := containerNames(body); len(got) != 1 || got[0] != "postgres" {
		t.Errorf("local list = %v", got)
	}
	if _, has := body["host"]; has {
		t.Error("the local answer grew a host field")
	}
	_, body = getJSON(t, router, "/api/docker/containers?host="+h.ID)
	if got := containerNames(body); len(got) != 2 || body["host"] != h.ID {
		t.Errorf("remote list = %v host=%v", got, body["host"])
	}
}

func TestSameNameOnTwoHostsResolvesToTheRightOne(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	local := startFakeDocker(t)
	local.add(fakeContainer{ID: strings.Repeat("1", 64), Name: "postgres", Image: "postgres:16", State: "running", Env: []string{"WHERE=local"}})
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("2", 64), Name: "postgres", Image: "postgres:15", State: "running", Env: []string{"WHERE=remote"}})
	h := addRemoteHost(t, addr, false)

	_, d := getJSON(t, router, "/api/docker/containers/postgres")
	if d["image"] != "postgres:16" {
		t.Errorf("local detail = %v", d["image"])
	}
	_, d = getJSON(t, router, "/api/docker/containers/postgres?host="+h.ID)
	if d["image"] != "postgres:15" {
		t.Errorf("remote detail = %v", d["image"])
	}
	_, env := getJSON(t, router, "/api/docker/containers/postgres/env/WHERE?host="+h.ID)
	if env["value"] != "remote" {
		t.Errorf("remote env = %v", env)
	}
}

func TestUnknownHostIsNotLocal(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	local := startFakeDocker(t)
	local.add(fakeContainer{ID: strings.Repeat("1", 64), Name: "postgres", State: "running"})

	code, _ := getJSON(t, router, "/api/docker/containers/postgres?host=d_nope")
	if code != http.StatusNotFound {
		t.Errorf("detail on an unknown host = %d, want 404 (never the local container)", code)
	}
	_, body := getJSON(t, router, "/api/docker/containers?host=d_nope")
	if body["available"] != false || body["reason"] != reasonUnknownDockerHost {
		t.Errorf("list on an unknown host = %v", body)
	}
}

func TestLocalOnlyRoutesRefuseARemoteHost(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	startFakeDocker(t)
	_, addr := startFakeDockerTCP(t)
	h := addRemoteHost(t, addr, true)
	for _, path := range []string{
		"/api/docker/containers/x/timeline", "/api/docker/history", "/api/docker/disk",
	} {
		code, body := getJSON(t, router, path+"?host="+h.ID)
		if code != http.StatusForbidden || body["reason"] != reasonDockerLocalOnly {
			t.Errorf("%s: %d %v", path, code, body)
		}
	}
	for _, c := range []struct{ method, path string }{
		{"POST", "/api/docker/updates/choice"},
		{"POST", "/api/docker/prune/images"}, {"POST", "/api/docker/binds/measure"},
		{"DELETE", "/api/docker/volumes/v"},
	} {
		rec := hostsCall(t, router, c.method, c.path+"?host="+h.ID, "{}", "")
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), reasonDockerLocalOnly) {
			t.Errorf("%s %s: %d %s", c.method, c.path, rec.Code, rec.Body)
		}
	}
}

func TestStatusNamesTheHostAndItsOwnControl(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	startFakeDocker(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	_, addr := startFakeDockerTCP(t)
	off := addRemoteHost(t, addr, false)

	_, local := getJSON(t, router, "/api/docker/status")
	if local["control"] != true || local["socket"] != true {
		t.Errorf("local status = %v", local)
	}
	if _, has := local["host"]; has {
		t.Error("the local status grew a host field")
	}
	_, remote := getJSON(t, router, "/api/docker/status?host="+off.ID)
	if remote["control"] != false || remote["socket"] != true || remote["host"] != off.ID {
		t.Errorf("remote status = %v (the env opt-in must not switch on a remote host)", remote)
	}
}

// A daemon that accepts the connection and never answers must cost one client
// timeout and no more, and must not touch the local host.
func TestAHangingHostAnswersWithinTheTimeout(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	local := startFakeDocker(t)
	local.add(fakeContainer{ID: strings.Repeat("1", 64), Name: "postgres", State: "running"})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skip(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			t.Cleanup(func() { c.Close() })
		}
	}()
	old := dockerClientTimeout
	dockerClientTimeout = 300 * time.Millisecond
	t.Cleanup(func() { dockerClientTimeout = old })
	h := addRemoteHost(t, ln.Addr().String(), false)

	start := time.Now()
	_, body := getJSON(t, router, "/api/docker/containers?host="+h.ID)
	if body["available"] != false || body["reason"] != "timeout" {
		t.Errorf("a hanging host was reported available or without a reason: %v", body)
	}
	if time.Since(start) > 3*time.Second {
		t.Errorf("a hanging host held the request for %v", time.Since(start))
	}
	if _, body = getJSON(t, router, "/api/docker/containers"); body["available"] != true {
		t.Errorf("the local list was affected: %v", body)
	}
}

func TestRemoteActionsNeedTheHostsOwnSwitch(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1") // the local opt-in must not carry over
	local := startFakeDocker(t)
	local.add(fakeContainer{ID: strings.Repeat("1", 64), Name: "postgres", State: "running"})
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("2", 64), Name: "postgres", State: "running"})
	off := addRemoteHost(t, addr, false)

	rec := hostsCall(t, router, "POST", "/api/docker/containers/postgres/stop?host="+off.ID, "", "")
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), reasonDockerControlOff) {
		t.Fatalf("stop on a read-only host: %d %s", rec.Code, rec.Body)
	}
	if remote.called("POST /containers/") || local.called("POST /containers/") {
		t.Fatal("a refused action reached a daemon")
	}

	if _, err := updateDockerHost(off.ID, DockerHost{Name: "pi", Kind: "tcp", Address: addr, AllowActions: true}, dockerHostSecretUpdate{}); err != nil {
		t.Fatal(err)
	}
	rec = hostsCall(t, router, "POST", "/api/docker/containers/postgres/stop?host="+off.ID, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("stop with the switch on: %d %s", rec.Code, rec.Body)
	}
	if !remote.called("POST /containers/" + strings.Repeat("2", 64) + "/stop") {
		t.Error("the stop never reached the remote daemon")
	}
	if local.called("POST /containers/") {
		t.Error("the stop reached the local container of the same name")
	}
}

func TestRemoteUpdateAndRollbackAreLocalOnly(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	startFakeDocker(t)
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("2", 64), Name: "web", State: "running"})
	h := addRemoteHost(t, addr, true)
	for _, action := range []string{"update", "rollback"} {
		rec := hostsCall(t, router, "POST", "/api/docker/containers/web/"+action+"?host="+h.ID, "", "")
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), reasonDockerLocalOnly) {
			t.Errorf("%s: %d %s", action, rec.Code, rec.Body)
		}
	}
	if remote.called("POST") {
		t.Error("an update reached the remote daemon")
	}
}

func TestSelfProtectionAndLocksStayWithTheirHost(t *testing.T) {
	hostsTestDir(t)
	h := dockerTestHandlers(t)
	router := newDockerTestRouter(h)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	oldSelf := dockerSelfOverride
	dockerSelfOverride = strings.Repeat("2", 12) // nextDash is the container with id 2222...
	t.Cleanup(func() { dockerSelfOverride = oldSelf })
	startFakeDocker(t)
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("2", 64), Name: "twin", State: "running"})
	host := addRemoteHost(t, addr, true)

	rec := hostsCall(t, router, "POST", "/api/docker/containers/twin/stop?host="+host.ID, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("a remote container that shares nextDash's id prefix was treated as nextDash itself: %d %s", rec.Code, rec.Body)
	}

	// A lock held on the local "twin" does not block the remote "twin".
	local := dockerContainerSummary{ID: strings.Repeat("2", 64), Names: []string{"/twin"}}
	release, ok := h.dockerLockContainer(local)
	if !ok {
		t.Fatal("local lock refused")
	}
	defer release()
	if rel, ok := h.dockerLockContainerOn(host.ID, local); !ok {
		t.Error("a local lock blocked the same container name on another host")
	} else {
		rel()
	}
	if !h.dockerAnyBusy() {
		t.Error("the local lock does not count as busy")
	}
	rel, _ := h.dockerLockContainerOn(host.ID, dockerContainerSummary{ID: strings.Repeat("9", 64), Names: []string{"/other"}})
	release()
	if h.dockerAnyBusy() {
		t.Error("an action on another host counts as busy for a local prune")
	}
	rel()
}

// A web address set by hand for the local "sonarr" is not the address of a
// "sonarr" on another host.
func TestRemoteContainerIgnoresNameKeyedSettings(t *testing.T) {
	hostsTestDir(t)
	local := startFakeDocker(t)
	local.add(fakeContainer{ID: strings.Repeat("1", 64), Name: "sonarr", State: "running"})
	h := dockerTestHandlers(t)
	settings := h.store.GetSettings()
	settings.DockerWebUIs = map[string]string{"sonarr": "https://sonarr.home.lan"}
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	router := newDockerTestRouter(h)
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("2", 64), Name: "sonarr", State: "running"})
	host := addRemoteHost(t, addr, false)

	_, body := getJSON(t, router, "/api/docker/containers")
	if got := body["containers"].([]any)[0].(map[string]any)["webuiCustom"]; got != "https://sonarr.home.lan" {
		t.Fatalf("local custom address = %v", got)
	}
	_, body = getJSON(t, router, "/api/docker/containers?host="+host.ID)
	if got := body["containers"].([]any)[0].(map[string]any)["webuiCustom"]; got != nil && got != "" {
		t.Errorf("the local custom address showed on a remote container: %v", got)
	}
	_, detail := getJSON(t, router, "/api/docker/containers/sonarr?host="+host.ID)
	if got := detail["webuiCustom"]; got != nil && got != "" {
		t.Errorf("detail: %v", got)
	}
}
