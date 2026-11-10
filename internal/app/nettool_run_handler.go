package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// netRunError is a refusal of a one-off test with the HTTP status it maps to.
type netRunError struct {
	status int
	msg    string
}

func (e netRunError) Error() string { return e.msg }

// netRunRequest is all a one-off test may say: which bookmark, and which
// check of it (or which type, for the bookmark's own host and port). Nothing
// here names a host or a port, and the decoder refuses a body that tries.
type netRunRequest struct {
	PageID  int    `json:"pageId"`
	URL     string `json:"url"`
	Type    string `json:"type"`
	CheckID string `json:"checkId"`
	// Record is only for a one-off DNS test (no checkId): which record type to
	// ask for, one of a fixed list. It names no host.
	Record string `json:"record"`
}

// RunNetTest runs one network test now. The host and port are always the
// bookmark's and its stored checks': a body with any other field is a 400.
func (h *Handlers) RunNetTest(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	var req netRunRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		netWriteError(w, http.StatusBadRequest, "Invalid request: only pageId, url, type, checkId and record are accepted")
		return
	}
	res, status, err := h.runNetTestForRecord(r.Context(), clientIP(r), req.PageID, req.URL, req.Type, req.CheckID, req.Record)
	if err != nil {
		if status == http.StatusTooManyRequests {
			w.Header().Set("Retry-After", "60")
		}
		netWriteError(w, status, err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, res)
}

// netRunOne runs a check through the stub the tests set, else the real engine.
func (h *Handlers) netRunOne(ctx context.Context, bm Bookmark, c NetCheck) NetResult {
	if h.netRunner != nil {
		return h.netRunner(ctx, bm, c)
	}
	return h.runNetCheck(ctx, bm, c)
}

// runNetTestFor is the one way a one-off test runs, for the route and for MCP,
// so the budget per client and the one-run-per-host rule hold for both. The
// bookmark is found by page and URL; the check is one of that bookmark's own,
// or a temporary one that carries only a type, which makes its target the
// bookmark's host and the port of its address.
func (h *Handlers) runNetTestFor(ctx context.Context, clientKey string, pageID int, url, typ, checkID string) (NetResult, int, error) {
	return h.runNetTestForRecord(ctx, clientKey, pageID, url, typ, checkID, "")
}

// runNetTestForRecord is runNetTestFor with the record type of a one-off DNS
// test (A when empty). The record is ignored for a stored check, which has its own.
func (h *Handlers) runNetTestForRecord(ctx context.Context, clientKey string, pageID int, url, typ, checkID, record string) (NetResult, int, error) {
	settings := h.store.GetSettings()
	if !settings.NetToolsEnabled {
		return NetResult{}, http.StatusForbidden, netRunError{http.StatusForbidden, "Network tests are turned off in the settings."}
	}
	key := canonicalBookmarkURLKey(url)
	if pageID <= 0 || key == "" {
		return NetResult{}, http.StatusBadRequest, netRunError{http.StatusBadRequest, "pageId and url are required"}
	}
	list := h.store.GetBookmarksByPage(pageID)
	idx := netRowIndex(list, key, 0)
	if idx < 0 {
		return NetResult{}, http.StatusNotFound, netRunError{http.StatusNotFound, "bookmark not found"}
	}
	bm := list[idx]

	var chk NetCheck
	stored := false
	if checkID != "" {
		for _, c := range bm.Checks {
			if c.ID == checkID {
				chk, stored = c, true
				break
			}
		}
		if !stored {
			// Also what a check of another bookmark gets: its port is not
			// this bookmark's to test.
			return NetResult{}, http.StatusNotFound, netRunError{http.StatusNotFound, "check not found"}
		}
		if typ != "" && typ != chk.Type {
			return NetResult{}, http.StatusBadRequest, netRunError{http.StatusBadRequest, "type does not match the check"}
		}
	} else {
		chk = NetCheck{Type: typ}
		if typ == netTypeDNS {
			rec := strings.ToUpper(strings.TrimSpace(record))
			if rec == "" {
				rec = "A"
			}
			if !netDNSRecords[rec] {
				return NetResult{}, http.StatusBadRequest, netRunError{http.StatusBadRequest, "unknown record type"}
			}
			chk.Record = rec
		}
	}
	if !netTypesBuilt[chk.Type] {
		return NetResult{}, http.StatusBadRequest, netRunError{http.StatusBadRequest, "this test type is not available"}
	}
	if h.netToolLimiter != nil && !h.netToolLimiter.allow(clientKey) {
		return NetResult{}, http.StatusTooManyRequests, netRunError{http.StatusTooManyRequests, "Too many network tests; wait a minute."}
	}

	// One run per host at a time. A target that cannot be worked out never
	// reaches the network, so it needs no place in line.
	if target, err := netCheckTarget(bm, chk, settings); err == nil && target.Host != "" {
		if _, busy := h.netRunInflight.LoadOrStore(target.Host, struct{}{}); busy {
			return NetResult{}, http.StatusConflict, netRunError{http.StatusConflict, "A test of this host is already running."}
		}
		defer h.netRunInflight.Delete(target.Host)
	}

	res := h.netRunOne(ctx, bm, chk)
	// A test of a stored DNS check says whether the records still match its
	// baseline; it writes nothing (only the monitor round moves the drift).
	if stored && chk.Type == netTypeDNS && chk.Baseline != "" && res.DNS != nil && len(res.DNS.Records) > 0 {
		vals := dnsValueSet(strings.ToUpper(chk.Record), res.DNS.Records)
		if fp, old := dnsDecodeSet(chk.Baseline); fp != dnsFingerprint(strings.ToUpper(chk.Record), vals) {
			res.DNS.Changed, res.DNS.Diff = true, dnsDiff(strings.ToUpper(chk.Record), old, vals)
		}
	}
	logActivity(activityCategoryHealth, "net_run", map[string]any{
		"url": activityURL(bm.URL), "type": chk.Type, "host": res.Host,
	}, "")
	if res.Class == "guard" {
		logActivity(activityCategoryHealth, "net_guard_denied", map[string]any{
			"url": activityURL(bm.URL), "type": chk.Type, "host": res.Host,
		}, "")
	}

	// A test of a scheduled check is one more sample of it; a one-off test of
	// a bookmark leaves the history alone.
	if stored && chk.Enabled {
		now := time.Now()
		hkey := netHistoryKey(chk.ID)
		updates := map[string][]HealthSample{hkey: {res.sample(maintenanceInEffect(settings, now))}}
		h.announceNetRecoveries(updates)
		if err := h.appendHealthSamples(updates); err != nil {
			logWarn(logComponentHealth, "the test of %s could not be added to the history (%v)", hkey, err)
		}
	}
	return res, http.StatusOK, nil
}

// netRecoveryTransitions are the "up" transitions in updates that belong to an
// enabled network check, the same way announceRecoveries reads them for a
// monitored bookmark: only a sample that is up and outside maintenance counts.
func (h *Handlers) netRecoveryTransitions(updates map[string][]HealthSample) []monitorTransition {
	var out []monitorTransition
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			for _, c := range bm.Checks {
				key := netHistoryKey(c.ID)
				samples := updates[key]
				if !c.Enabled || len(samples) == 0 {
					continue
				}
				last := samples[len(samples)-1]
				if !last.Up || last.Maint {
					continue
				}
				out = append(out, monitorTransition{
					key: key, name: bm.Name, url: bm.URL, up: true, at: last.T,
					muted: bm.NotifyMuted || c.Muted,
					check: netCheckLabel(c, bm), checkID: c.ID,
				})
			}
		}
	}
	return out
}

// announceNetRecoveries sends "back online" for a network check whose
// recovery a one-off test saw first. Called before the sample is stored, like
// announceRecoveries: once the up sample is in the history the monitor round
// compares up with up and the recovery is never sent. The rule that stops a
// second "back online" there applies here too (an up older than the newest
// stored sample is skipped).
func (h *Handlers) announceNetRecoveries(updates map[string][]HealthSample) {
	transitions := h.netRecoveryTransitions(updates)
	if len(transitions) == 0 {
		return
	}
	if pending, _ := h.pendingMonitorNotificationsAlerted(transitions); len(pending) > 0 {
		go h.dispatchMonitorNotifications(context.Background(), pending)
	}
}
