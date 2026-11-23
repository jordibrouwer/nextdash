package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// The services' action endpoints in these fakes are written from their
// documentation, not recorded from a live install.

// seerrPendingFake is a Seerr whose request 762 is waiting for a decision;
// every other request in the fixture is approved or available.
func seerrPendingFake(t *testing.T) *fakeSeerr {
	t.Helper()
	fake := newFakeSeerr(t)
	var page map[string]any
	if err := json.Unmarshal(readSeerrFixture(t, "request.json"), &page); err != nil {
		t.Fatal(err)
	}
	for _, r := range page["results"].([]any) {
		request := r.(map[string]any)
		if request["id"].(float64) == 762 {
			request["status"] = float64(1)
		}
	}
	raw, _ := json.Marshal(page)
	fake.requests = raw
	return fake
}

func (f *fakeSeerr) posted() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return strings.Join(f.posts, "\n")
}

func TestSeerrApprovesAndDeclinesAPendingRequest(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	fake := seerrPendingFake(t)
	spec := seerrTestSpec(t, h, fake, nil)
	config := map[string]any{"server": spec.Server, "credentialId": spec.CredentialID, "rows": float64(20)}
	downloadActionPage(t, h, WidgetTypeSeerr, "w_seerr0000001", config)
	body := map[string]any{"pageId": 1, "id": "w_seerr0000001", "action": "approve", "target": "r762"}

	if rec := askWidgetAction(t, h, WidgetTypeSeerr, body, ""); rec.Code != http.StatusForbidden {
		t.Errorf("actions off: %d", rec.Code)
	}
	if fake.posted() != "" {
		t.Fatalf("a switched-off widget reached Seerr:\n%s", fake.posted())
	}

	config["actions"] = true
	downloadActionPage(t, h, WidgetTypeSeerr, "w_seerr0000001", config)
	if rec := askWidgetAction(t, h, WidgetTypeSeerr, body, ""); rec.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", rec.Code, rec.Body.String())
	}
	body["action"] = "decline"
	if rec := askWidgetAction(t, h, WidgetTypeSeerr, body, ""); rec.Code != http.StatusOK {
		t.Fatalf("decline: %d %s", rec.Code, rec.Body.String())
	}
	got := fake.posted()
	if !strings.Contains(got, "/api/v1/request/762/approve {}") || !strings.Contains(got, "/api/v1/request/762/decline {}") {
		t.Errorf("sent:\n%s", got)
	}
}

// Only a request waiting for a decision can be decided, and only one the
// tile listed.
func TestSeerrRefusesLinesThatAreNotPending(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	fake := seerrPendingFake(t)
	spec := seerrTestSpec(t, h, fake, nil)
	downloadActionPage(t, h, WidgetTypeSeerr, "w_seerr0000001", map[string]any{
		"server": spec.Server, "credentialId": spec.CredentialID, "rows": float64(20), "actions": true})
	for _, target := range []string{"r768" /* available */, "r761" /* approved */, "r999" /* never shown */, "762" /* no r */, ""} {
		body := map[string]any{"pageId": 1, "id": "w_seerr0000001", "action": "approve", "target": target}
		if rec := askWidgetAction(t, h, WidgetTypeSeerr, body, ""); rec.Code != http.StatusForbidden {
			t.Errorf("target %q: %d", target, rec.Code)
		}
	}
	if got := fake.posted(); got != "" {
		t.Errorf("a refused action reached Seerr:\n%s", got)
	}
}

func arrActionFake(t *testing.T, h *Handlers, widgetType WidgetType) (*fakeArr, string) {
	t.Helper()
	mediaForgetAll()
	fake := newFakeArr(t)
	soon := time.Now().UTC().Add(36 * time.Hour).Format(time.RFC3339)
	if widgetType == WidgetTypeRadarr {
		fake.calendar = fmt.Sprintf(`[{"id":21,"title":"Soon","titleSlug":"soon","year":2026,"digitalRelease":%q,"images":[]}]`, soon)
	} else {
		fake.calendar = fmt.Sprintf(`[{"id":11,"seriesId":7,"seasonNumber":1,"episodeNumber":2,"title":"Pilot","airDateUtc":%q,
			"series":{"title":"Severance","titleSlug":"severance","year":2022,"images":[]}}]`, soon)
	}
	fake.queue = `{"records":[{"id":3,"title":"Queued","size":1000,"sizeleft":250,"timeleft":"00:10:00",
		"series":{"title":"Severance","titleSlug":"severance","images":[]},"movie":{"title":"Soon","titleSlug":"soon","images":[]},
		"episode":{"seasonNumber":1,"episodeNumber":3,"title":"In Perpetuity"}}]}`
	spec := arrTestSpec(t, h, fake, nil)
	id := "w_arr000000001"
	config := map[string]any{"server": spec.Server, "credentialId": spec.CredentialID}
	downloadActionPage(t, h, widgetType, id, config)
	return fake, id
}

func (f *fakeArr) posted() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return strings.Join(f.posts, "\n")
}

func TestArrSearchesAnUpcomingLine(t *testing.T) {
	for _, c := range []struct {
		widgetType WidgetType
		target     string
		want       string
	}{
		{WidgetTypeSonarr, "e11", `/api/v3/command {"episodeIds":[11],"name":"EpisodeSearch"}`},
		{WidgetTypeRadarr, "m21", `/api/v3/command {"movieIds":[21],"name":"MoviesSearch"}`},
	} {
		h := newTestHandlers(t)
		fake, id := arrActionFake(t, h, c.widgetType)
		body := map[string]any{"pageId": 1, "id": id, "action": "search", "target": c.target}
		if rec := askWidgetAction(t, h, c.widgetType, body, ""); rec.Code != http.StatusForbidden {
			t.Errorf("%s actions off: %d", c.widgetType, rec.Code)
		}
		if fake.posted() != "" {
			t.Fatalf("%s: a switched-off widget reached the service", c.widgetType)
		}
		spec := arrSpecFrom(sanitizeWidgetConfig(c.widgetType, map[string]any{"server": fake.URL, "credentialId": "widget:w_arr000000001"}))
		downloadActionPage(t, h, c.widgetType, id, map[string]any{"server": spec.Server, "credentialId": spec.CredentialID, "actions": true})
		if rec := askWidgetAction(t, h, c.widgetType, body, ""); rec.Code != http.StatusOK {
			t.Fatalf("%s search: %d %s", c.widgetType, rec.Code, rec.Body.String())
		}
		if got := fake.posted(); got != c.want {
			t.Errorf("%s sent %q, want %q", c.widgetType, got, c.want)
		}
	}
}

// A queue line, a line the tile never showed and a bad number reach nothing.
func TestArrSearchRefusesOtherLines(t *testing.T) {
	for _, widgetType := range []WidgetType{WidgetTypeSonarr, WidgetTypeRadarr} {
		h := newTestHandlers(t)
		fake, id := arrActionFake(t, h, widgetType)
		downloadActionPage(t, h, widgetType, id, map[string]any{"server": fake.URL, "credentialId": "widget:w_arr000000001", "actions": true})
		for _, target := range []string{"q3", "e999", "m999", "e", "x11", ""} {
			body := map[string]any{"pageId": 1, "id": id, "action": "search", "target": target}
			if rec := askWidgetAction(t, h, widgetType, body, ""); rec.Code != http.StatusForbidden {
				t.Errorf("%s target %q: %d", widgetType, target, rec.Code)
			}
		}
		if got := fake.posted(); got != "" {
			t.Errorf("%s: a refused search reached the service:\n%s", widgetType, got)
		}
	}
}

// dnsActionPage saves a DNS widget with the switch as given.
func dnsActionPage(t *testing.T, h *Handlers, widget Widget, actions bool) {
	t.Helper()
	widget.Config["actions"] = actions
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
}

func piholeSent(f *fakePihole) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return strings.Join(f.posts, "\n")
}

func TestPiholePausesAndResumesBlocking(t *testing.T) {
	h := newTestHandlers(t)
	f := newFakePihole(t)
	widget := piholeWidget(t, h, f, "pi-pass")
	ask := func(action string, arg int, target string) int {
		body := map[string]any{"pageId": 1, "id": widget.ID, "action": action, "target": target, "arg": arg}
		return askWidgetAction(t, h, WidgetTypePihole, body, "").Code
	}

	dnsActionPage(t, h, widget, false)
	if code := ask("pause", 300, "all"); code != http.StatusForbidden {
		t.Errorf("actions off: %d", code)
	}
	if got := piholeSent(f); got != "" {
		t.Fatalf("a switched-off widget reached Pi-hole:\n%s", got)
	}

	dnsActionPage(t, h, widget, true)
	for _, bad := range []int{1, 299, 7200, -1} {
		if code := ask("pause", bad, "all"); code != http.StatusForbidden {
			t.Errorf("pause %d s: %d", bad, code)
		}
	}
	if code := ask("pause", 300, "somewhere"); code != http.StatusForbidden {
		t.Errorf("a target that is not all: %d", code)
	}
	if got := piholeSent(f); got != "" {
		t.Fatalf("a refused pause reached Pi-hole:\n%s", got)
	}
	if code := ask("pause", 1800, "all"); code != http.StatusOK {
		t.Fatalf("pause 30 min: %d", code)
	}
	if code := ask("pause", 0, "all"); code != http.StatusOK {
		t.Fatalf("pause until resumed: %d", code)
	}
	if code := ask("resume", 0, "all"); code != http.StatusOK {
		t.Fatalf("resume: %d", code)
	}
	want := `/api/dns/blocking {"blocking":false,"timer":1800}` + "\n" +
		`/api/dns/blocking {"blocking":false,"timer":null}` + "\n" +
		`/api/dns/blocking {"blocking":true,"timer":null}`
	if got := piholeSent(f); got != want {
		t.Errorf("sent:\n%s\nwant:\n%s", got, want)
	}
}

func TestPiholeSaysHowLongThePauseHasLeft(t *testing.T) {
	h := newTestHandlers(t)
	f := newFakePihole(t)
	f.blocking = "disabled"
	d := h.dnsAnswer(h.fetchPihole)(t.Context(), 1, piholeWidget(t, h, f, "pi-pass"), false).Dns
	left := d.PausedUntil - time.Now().UnixMilli()
	if d == nil || left <= 250000 || left > 300000 {
		t.Fatalf("paused until: %+v (%d ms left)", d, left)
	}
}

func TestAdguardPausesAndResumesProtection(t *testing.T) {
	h := newTestHandlers(t)
	var posted []string
	srv := fakeAdguardRecording(t, adguardStatsJSON, "true", &posted)
	widget := adguardWidget(t, h, srv, "secret")
	ask := func(action string, arg int) int {
		body := map[string]any{"pageId": 1, "id": widget.ID, "action": action, "target": "all", "arg": arg}
		return askWidgetAction(t, h, WidgetTypeAdguard, body, "").Code
	}

	dnsActionPage(t, h, widget, false)
	if code := ask("pause", 300); code != http.StatusForbidden {
		t.Errorf("actions off: %d", code)
	}
	dnsActionPage(t, h, widget, true)
	if code := ask("pause", 600); code != http.StatusForbidden {
		t.Errorf("a duration that is not offered: %d", code)
	}
	if len(posted) != 0 {
		t.Fatalf("a refused pause reached AdGuard: %v", posted)
	}
	for _, step := range []struct {
		action string
		arg    int
	}{{"pause", 3600}, {"pause", 0}, {"resume", 0}} {
		if code := ask(step.action, step.arg); code != http.StatusOK {
			t.Fatalf("%s %d: %d", step.action, step.arg, code)
		}
	}
	want := []string{
		`/control/protection {"duration":3600000,"enabled":false}`,
		`/control/protection {"enabled":false}`,
		`/control/protection {"enabled":true}`,
	}
	if strings.Join(posted, "\n") != strings.Join(want, "\n") {
		t.Errorf("sent %v, want %v", posted, want)
	}
}

func TestAdguardSaysHowLongThePauseHasLeft(t *testing.T) {
	h := newTestHandlers(t)
	srv := fakeAdguard(t, adguardStatsJSON, "false")
	d := h.dnsAnswer(h.fetchAdguard)(t.Context(), 1, adguardWidget(t, h, srv, "secret"), false).Dns
	left := d.PausedUntil - time.Now().UnixMilli()
	if d == nil || left <= 80000 || left > 90000 {
		t.Fatalf("paused until: %+v (%d ms left)", d, left)
	}
}
