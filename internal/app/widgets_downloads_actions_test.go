package app

import (
	"net/http"
	"strings"
	"testing"
)

func downloadActionPage(t *testing.T, h *Handlers, widgetType WidgetType, id string, config map[string]any) {
	t.Helper()
	widget := Widget{ID: id, Type: widgetType, Title: "Downloads", Config: sanitizeWidgetConfig(widgetType, config)}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
}

func qbSwitched(fake *fakeQBittorrent) string {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	return strings.Join(fake.switched, "\n")
}

// A line names a twelve-character hash; qBittorrent is sent the whole one,
// under the 5.x name, and the 4.x name when 5.x's is unknown.
func TestQBittorrentPausesALineAndAll(t *testing.T) {
	for _, v4 := range []bool{false, true} {
		mediaForgetAll()
		h := newTestHandlers(t)
		fake := newFakeQBittorrent(t)
		fake.v4 = v4
		spec := qbTestSpec(t, h, fake, qbLoginCredential(qbTestPassword), nil)
		downloadActionPage(t, h, WidgetTypeQBittorrent, "w_qbit00000001", map[string]any{
			"server": spec.Server, "credentialId": spec.CredentialID, "filter": "all", "actions": true})

		line := map[string]any{"pageId": 1, "id": "w_qbit00000001", "action": "pause", "target": "bbbbbbbbbbbb"}
		if rec := askWidgetAction(t, h, WidgetTypeQBittorrent, line, ""); rec.Code != http.StatusOK {
			t.Fatalf("v4=%v pause a line: %d %s", v4, rec.Code, rec.Body.String())
		}
		all := map[string]any{"pageId": 1, "id": "w_qbit00000001", "action": "resume", "target": "all"}
		if rec := askWidgetAction(t, h, WidgetTypeQBittorrent, all, ""); rec.Code != http.StatusOK {
			t.Fatalf("v4=%v resume all: %d %s", v4, rec.Code, rec.Body.String())
		}
		pause, resume := "/api/v2/torrents/stop", "/api/v2/torrents/start"
		if v4 {
			pause, resume = "/api/v2/torrents/pause", "/api/v2/torrents/resume"
		}
		got := qbSwitched(fake)
		if !strings.Contains(got, pause+" hashes=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") || !strings.Contains(got, resume+" hashes=all") {
			t.Errorf("v4=%v sent:\n%s", v4, got)
		}
	}
}

// A hash the tile never listed, or the switch off, reaches nothing.
func TestQBittorrentRefusesUnlistedLines(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	fake := newFakeQBittorrent(t)
	spec := qbTestSpec(t, h, fake, qbLoginCredential(qbTestPassword), nil)
	config := map[string]any{"server": spec.Server, "credentialId": spec.CredentialID, "filter": "all"}
	downloadActionPage(t, h, WidgetTypeQBittorrent, "w_qbit00000001", config)
	body := map[string]any{"pageId": 1, "id": "w_qbit00000001", "action": "pause", "target": "all"}
	if rec := askWidgetAction(t, h, WidgetTypeQBittorrent, body, ""); rec.Code != http.StatusForbidden {
		t.Errorf("actions never turned on: %d", rec.Code)
	}
	config["actions"] = true
	downloadActionPage(t, h, WidgetTypeQBittorrent, "w_qbit00000001", config)
	body["target"] = "ffffffffffff"
	if rec := askWidgetAction(t, h, WidgetTypeQBittorrent, body, ""); rec.Code != http.StatusForbidden {
		t.Errorf("an unlisted hash: %d", rec.Code)
	}
	if got := qbSwitched(fake); got != "" {
		t.Errorf("a refused action reached qBittorrent:\n%s", got)
	}
}

func TestSABnzbdPausesTheQueueAndAJob(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	fake := newFakeSABnzbd(t)
	spec := sabTestSpec(t, h, fake, sabTestKey, nil)
	downloadActionPage(t, h, WidgetTypeSABnzbd, "w_sabnzbd00001", map[string]any{
		"server": spec.Server, "credentialId": spec.CredentialID, "filter": "all", "actions": true})

	all := map[string]any{"pageId": 1, "id": "w_sabnzbd00001", "action": "pause", "target": "all"}
	if rec := askWidgetAction(t, h, WidgetTypeSABnzbd, all, ""); rec.Code != http.StatusOK {
		t.Fatalf("pause all: %d %s", rec.Code, rec.Body.String())
	}
	job := map[string]any{"pageId": 1, "id": "w_sabnzbd00001", "action": "resume", "target": "SABnzbd_nzo_example2"}
	if rec := askWidgetAction(t, h, WidgetTypeSABnzbd, job, ""); rec.Code != http.StatusOK {
		t.Fatalf("resume a job: %d %s", rec.Code, rec.Body.String())
	}
	job["target"] = "SABnzbd_nzo_unlisted"
	if rec := askWidgetAction(t, h, WidgetTypeSABnzbd, job, ""); rec.Code != http.StatusForbidden {
		t.Errorf("an unlisted job: %d", rec.Code)
	}
	fake.mu.Lock()
	queries := strings.Join(fake.queries, "\n")
	fake.mu.Unlock()
	if !strings.Contains(queries, "mode=pause") ||
		!strings.Contains(queries, "mode=queue&name=resume") || !strings.Contains(queries, "value=SABnzbd_nzo_example2") {
		t.Errorf("asked SABnzbd:\n%s", queries)
	}
	if strings.Contains(queries, "SABnzbd_nzo_unlisted") {
		t.Errorf("an unlisted job reached SABnzbd")
	}
}

// A client that does not answer says so, rather than "not offered".
func TestDownloadActionSaysTheClientIsDown(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	fake := newFakeSABnzbd(t)
	spec := sabTestSpec(t, h, fake, sabTestKey, nil)
	downloadActionPage(t, h, WidgetTypeSABnzbd, "w_sabnzbd00001", map[string]any{
		"server": spec.Server, "credentialId": spec.CredentialID, "filter": "all", "actions": true})
	fake.Close()
	job := map[string]any{"pageId": 1, "id": "w_sabnzbd00001", "action": "pause", "target": "SABnzbd_nzo_example1"}
	if rec := askWidgetAction(t, h, WidgetTypeSABnzbd, job, ""); rec.Code != http.StatusBadGateway {
		t.Errorf("client down: %d %s", rec.Code, rec.Body.String())
	}
}
