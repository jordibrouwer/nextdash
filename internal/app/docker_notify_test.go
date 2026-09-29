package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func dockerEv(action, name string, attrs ...string) dockerEvent {
	ev := dockerEvent{Type: "container", Action: action}
	ev.Actor.ID = strings.Repeat("e", 64)
	ev.Actor.Attributes = map[string]string{"name": name}
	for i := 0; i+1 < len(attrs); i += 2 {
		ev.Actor.Attributes[attrs[i]] = attrs[i+1]
	}
	return ev
}

type notifierRun struct {
	t   *testing.T
	n   *containerNotifier
	now time.Time
	out []monitorNotification
	ok  func(name, id string) bool
}

func newNotifierRun(t *testing.T) *notifierRun {
	return &notifierRun{t: t, n: newContainerNotifier(), now: time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC),
		ok: func(string, string) bool { return true }}
}

func (r *notifierRun) at(d time.Duration) *notifierRun { r.now = r.now.Add(d); return r }
func (r *notifierRun) ev(action, name string, attrs ...string) *notifierRun {
	r.out = append(r.out, r.n.event(dockerEv(action, name, attrs...), r.now, r.ok)...)
	return r
}
func (r *notifierRun) tick() *notifierRun { r.out = append(r.out, r.n.tick(r.now, r.ok)...); return r }
func (r *notifierRun) titles() []string {
	var out []string
	for _, n := range r.out {
		out = append(out, n.Title)
	}
	return out
}
func (r *notifierRun) want(titles ...string) {
	r.t.Helper()
	if got := strings.Join(r.titles(), " | "); got != strings.Join(titles, " | ") {
		r.t.Fatalf("notices = %q\nwant      %q", got, strings.Join(titles, " | "))
	}
}

// A container that dies with nobody asking, and stays down, is a stop worth
// telling; its next start is the recovery.
func TestContainerNotifierCrash(t *testing.T) {
	r := newNotifierRun(t)
	r.ev("die", "web", "exitCode", "137").at(10 * time.Second).tick()
	r.want()
	r.at(25 * time.Second).tick()
	r.want("web stopped unexpectedly")
	if r.out[0].Error != "exit code 137" || r.out[0].Event != "down" {
		t.Fatalf("notice = %+v", r.out[0])
	}
	r.at(time.Minute).tick().want("web stopped unexpectedly")
	r.ev("start", "web").want("web stopped unexpectedly", "web is running again")
}

// A deliberate stop -- anyone's docker stop, or nextDash's own action -- is not
// news, and neither is a crash the restart policy fixes at once.
func TestContainerNotifierQuietCases(t *testing.T) {
	r := newNotifierRun(t)
	r.ev("kill", "web", "signal", "15").at(time.Second).ev("die", "web", "exitCode", "0").ev("stop", "web")
	r.at(time.Minute).tick()
	r.n.expect("api", r.now)
	r.at(2*time.Second).ev("die", "api", "exitCode", "0").at(time.Minute).tick()
	r.ev("die", "db", "exitCode", "1").at(3*time.Second).ev("start", "db").at(time.Minute).tick()
	r.want()
}

// Three crash-and-restart cycles in ten minutes are a loop: one notice for it,
// none per cycle, and a recovery once it has stayed up ten minutes.
func TestContainerNotifierRestartLoop(t *testing.T) {
	r := newNotifierRun(t)
	for i := 0; i < 4; i++ {
		r.ev("die", "api", "exitCode", "1").at(2*time.Second).ev("start", "api").at(time.Minute).tick()
	}
	r.want("api keeps restarting")
	if !strings.Contains(r.out[0].Error, "3 times") || !strings.Contains(r.out[0].Error, "exit code 1") {
		t.Fatalf("notice = %+v", r.out[0])
	}
	r.at(5 * time.Minute).tick().want("api keeps restarting")
	r.at(6*time.Minute).tick().want("api keeps restarting", "api is stable again")
}

func TestContainerNotifierHealthAndOOM(t *testing.T) {
	r := newNotifierRun(t)
	r.ev("health_status: unhealthy", "web").ev("health_status: unhealthy", "web")
	r.ev("health_status: healthy", "web")
	r.ev("oom", "big").ev("die", "big", "exitCode", "137").at(time.Minute).tick()
	r.want("web is unhealthy", "web is healthy again", "big stopped unexpectedly")
	if r.out[2].Error != "out of memory (exit code 137)" {
		t.Fatalf("oom notice = %+v", r.out[2])
	}
}

// Muted, hidden and nextDash's own container raise nothing, and a recovery is
// only told for an incident that was.
func TestContainerNotifierSkipsWhatIsNotAllowed(t *testing.T) {
	r := newNotifierRun(t)
	r.ok = func(name, _ string) bool { return name != "quiet" }
	r.ev("die", "quiet", "exitCode", "1").at(time.Minute).tick().ev("start", "quiet")
	r.ev("health_status: unhealthy", "quiet").ev("health_status: healthy", "quiet")
	r.want()
}

// The whole path: the fake daemon's event stream, the notifier, and the
// Health webhook receiving the notice.
func TestDockerNotifierReachesTheWebhook(t *testing.T) {
	var mu sync.Mutex
	var got []monitorNotification
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var n monitorNotification
		_ = json.Unmarshal(body, &n)
		mu.Lock()
		got = append(got, n)
		mu.Unlock()
	}))
	defer srv.Close()
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running", Status: "Up 1 hour"})
	f.events = []map[string]any{
		{"Type": "container", "Action": "health_status: unhealthy",
			"Actor": map[string]any{"ID": strings.Repeat("a", 64), "Attributes": map[string]string{"name": "web"}}},
	}
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"`+srv.URL+`","allowLocalBookmarks":true,"dockerNotify":true}`)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	api, _ := newDockerAPI()
	go func() { _ = h.watchDockerEventsOnce(ctx, api, newContainerNotifier()) }()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || got[0].Title != "web is unhealthy" || got[0].Source != "container" {
		t.Fatalf("webhook got %+v", got)
	}
	if !f.called("GET /events") {
		t.Fatalf("calls = %v", f.calls)
	}
}

// The master switch off, nothing goes out.
func TestDockerNotifierMasterSwitch(t *testing.T) {
	startFakeDocker(t)
	h, _ := healthRecheckTestHandlers(t, `{"dockerNotify":false,"dockerNotifyMuted":["quiet"]}`)
	if h.dockerNotifyAllowed("web", "") {
		t.Fatal("switched off, nothing is allowed")
	}
	h2, _ := healthRecheckTestHandlers(t, `{"dockerNotify":true,"dockerNotifyMuted":["quiet"]}`)
	if !h2.dockerNotifyAllowed("web", "") || h2.dockerNotifyAllowed("quiet", "") {
		t.Fatal("muted names are skipped, the rest are not")
	}
}

// A settings file written before the switch existed never answered it: the
// switch is on for it, as it is for a fresh install.
func TestDockerNotifyDefaultsOnForAnOlderSettingsFile(t *testing.T) {
	startFakeDocker(t)
	h, _ := healthRecheckTestHandlers(t, `{"theme":"dark"}`)
	if !h.store.GetSettings().DockerNotify || !h.store.GetSettings().DockerViewCloseOutside {
		t.Fatal("dockerNotify and dockerViewCloseOutside must default to on when the file does not name them")
	}
	h2, _ := healthRecheckTestHandlers(t, `{"dockerNotify":false}`)
	if h2.store.GetSettings().DockerNotify {
		t.Fatal("an explicit off must stay off")
	}
}
