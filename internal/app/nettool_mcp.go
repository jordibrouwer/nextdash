package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

/*
The network test tools: one-off tests and check management for an assistant.

They sit behind their own switch (netTools, off by default), because the first
of them sends traffic from this server and the last two change what the server
sends on a schedule.

Three rules carry over from the UI and none of them is new here:

A bookmark is named by its URL (and its page when the URL is filed on several),
like every other tool. No tool takes a host or a port: a test always aims at
the bookmark's own address or at a check stored on it, so a model cannot turn
this into a scanner. The decoder refuses a stray field, which is what makes
"host" in a call a refusal instead of a silently ignored word.

run_network_test goes through runNetTestFor, the function the Tools tab's route
uses, so the budget per client, the one-run-per-host rule, the address guard,
the demo block and the activity log are the same ones. It is read-only in the
MCP sense (it changes nothing stored) and open-world (it reaches out), and the
assistant may call it without a click for that reason; the limits are therefore
in the shared function and not in the route.

set_net_check and delete_net_check write through PutNetChecks, the only writer
of checks, so the validation, the install-wide cap and the activity log are not
a second copy.
*/

// mcpAnnotationsOpenWorld is mcpAnnotations for a tool that reaches outside
// this install: it adds openWorldHint, so a client can tell "reads a file"
// from "sends packets".
func mcpAnnotationsOpenWorld(readOnly, destructive bool) map[string]any {
	out := mcpAnnotations(readOnly, destructive)
	out["openWorldHint"] = true
	return out
}

func mcpNetToolsDefinitions() []map[string]any {
	urlProp := map[string]any{"type": "string", "description": "The bookmark's URL."}
	pageProp := map[string]any{
		"type":        "integer",
		"description": "Page id. Only needed when the same URL is filed on several pages; the error then lists them.",
	}
	checkProp := map[string]any{
		"type":        "string",
		"description": "The check's id, from list_net_checks.",
	}
	return []map[string]any{
		{
			"name":        "run_network_test",
			"annotations": mcpAnnotationsOpenWorld(true, false),
			"description": "Run one network test now against a bookmark's own host: tcp (is the port open), ping (is it reachable, with loss and round-trip time), dns (the records of its host name), tls (the certificate chain its port presents, its TLS version and the days left), http (one GET of the bookmark's address with the timeline, the redirect chain, the status and the response headers) or json (one GET whose JSON answer is looked into: the value under json_path compared with an operator and an expected value). " +
				"Give type for the bookmark's own address, or check_id for one of its stored checks (which then tests that check's own port). A json test without check_id needs json_path and op (and expect, except for exists); path may name a path on the bookmark's own host. " +
				"There is no way to name another host or port. Sends real traffic from the nextDash server, rate limited, one test per host at a time. " +
				"Returns {ok, ms, class, error, detail, host, ip, port, tcp, ping}; dns carries the records; tls carries the version, cipher, chain (at most 5 certificates) and days left, and warn is true when a valid certificate has too few days left; http carries the status, protocol, size (read up to 1 MB), timings (dns, connect, tls, wait, transfer, ttfb, total in ms), the redirect chain (at most 10 hops; a hop the address guard refuses is listed as blocked and not followed) and the response headers (at most 40, values cut, cookies and authorization hidden); json carries path, op, the value found at the path (cut to 200 characters; an object or list is only described; hidden when the path names a token, key, secret or password), its type, whether it met the check, the status and the size read (up to 1 MB), never the rest of the answer and never a credential; class says why it failed (dns, timeout, refused, guard, icmp, tls, http for an unexpected status, content for a missing header or a JSON value that is missing, not JSON or not as expected, demo). " +
				"A test of a scheduled check also counts as one more sample of it.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url":       urlProp,
					"page":      pageProp,
					"type":      map[string]any{"type": "string", "description": "tcp, ping, dns, tls, http or json. Leave out when check_id is given."},
					"record":    map[string]any{"type": "string", "description": "dns only, without check_id: A (default), AAAA, CNAME, MX, TXT or NS."},
					"path":      map[string]any{"type": "string", "description": "json only, without check_id: a path on the bookmark's own host, starting with a single /. Empty uses the bookmark's own address. Never a full URL."},
					"json_path": map[string]any{"type": "string", "description": "json only, without check_id: the value to look at in the answer, such as status, db.state, items[0].name or services[name=api].up (at most 200 characters)."},
					"op":        map[string]any{"type": "string", "description": "json only, without check_id: eq, ne, gt, lt, contains or exists."},
					"expect":    map[string]any{"type": "string", "description": "json only, without check_id: the value to compare with. Not used by exists; a number for gt and lt."},
					"check_id":  checkProp,
				},
				"required": []string{"url"},
			},
		},
		{
			"name":        "list_net_checks",
			"annotations": mcpAnnotations(true, false),
			"description": "The network checks (tcp, ping, dns, tls, http, json) stored on bookmarks, with the state each was last in. " +
				"Give url to list one bookmark's checks, or leave it out for every check in the install. " +
				"Reads stored results only and sends nothing. Each has an id for get_net_check, set_net_check, delete_net_check and run_network_test.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url":   urlProp,
					"page":  pageProp,
					"limit": map[string]any{"type": "integer", "description": "How many to return, at most 200. Defaults to 50."},
				},
			},
		},
		{
			"name":        "get_net_check",
			"annotations": mcpAnnotations(true, false),
			"description": "One network check with its settings, its last state, uptime over 24 hours, 7 and 30 days, recent incidents and its newest samples (newest first, at most 30). " +
				"Sends nothing; use run_network_test to test now.",
			"inputSchema": map[string]any{
				"type":       "object",
				"properties": map[string]any{"check_id": checkProp},
				"required":   []string{"check_id"},
			},
		},
		{
			"name":        "set_net_check",
			"annotations": mcpAnnotations(false, false),
			"description": "Add a network check to a bookmark, or change one of its checks (give check_id). " +
				"Types: tcp (a port), ping, dns (a record type of the bookmark's host name, optionally with an expected value and a watch for changes), tls (the certificate on a port, 443 unless the bookmark's https address or port says otherwise; up with a warning when fewer than min_days_left days remain, down when the certificate is expired or not trusted) http (a GET of the bookmark's address, or of path on the same host, with an expected status and optionally an expected header; down on another status or a missing header, slow when the first byte takes longer than max_ms; redirects are followed up to 10 hops and each hop must pass the address guard) and json (a GET like http, then the value under json_path in the JSON answer compared with op and expect; down on a non-2xx status, an answer that is not JSON or larger than 1 MB, a missing value, or a value that does not meet the check; the credential of the bookmark is sent only to the bookmark's own host and never comes back in a result). A new check is not scheduled until enabled is true; a scheduled check then sends traffic every interval_minutes. " +
				"Fields left out stay as they are. There is no host argument: a check aims at the bookmark's own host; port is only for tcp and tls; path only for http and json, on that same host. A check made here uses the bookmark's own credential if it has one; credentials cannot be chosen through this tool. " +
				"Refused with the reason when a limit is hit (six checks per bookmark, the install-wide cap).",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url":              urlProp,
					"page":             pageProp,
					"check_id":         map[string]any{"type": "string", "description": "The check to change. Leave out to add a new one."},
					"type":             map[string]any{"type": "string", "description": "tcp, ping, dns, tls, http or json. Required for a new check; cannot change an existing one."},
					"enabled":          map[string]any{"type": "boolean", "description": "Run it on a schedule."},
					"label":            map[string]any{"type": "string", "description": "A name for it, at most 60 characters. An empty string clears it."},
					"interval_minutes": map[string]any{"type": "integer", "description": "Minutes between runs, 5 to 1440. 0 follows the bookmark's own interval."},
					"timeout_sec":      map[string]any{"type": "integer", "description": "Seconds to wait, 1 to 10. 0 is the default."},
					"muted":            map[string]any{"type": "boolean", "description": "Keep its alerts quiet."},
					"port":             map[string]any{"type": "integer", "description": "tcp and tls only: the port, 1 to 65535. 0 follows the bookmark's address (tls: 443 for https)."},
					"min_days_left":    map[string]any{"type": "integer", "description": "tls only: a valid certificate with fewer days left than this is a warning (and sends one expiry notice per mark). 1 to 120; 0 is the default of 14."},
					"count":            map[string]any{"type": "integer", "description": "Ping only: packets per run, 1 to 10."},
					"max_loss_pct":     map[string]any{"type": "integer", "description": "Ping only: loss in percent above which it counts as down, 0 to 100."},
					"max_ms":           map[string]any{"type": "integer", "description": "A slower answer is reported as slow (it still counts as up). 0 turns that off."},
					"record":           map[string]any{"type": "string", "description": "DNS only, required for a new dns check: A, AAAA, CNAME, MX, TXT or NS."},
					"expect":           map[string]any{"type": "string", "description": "DNS: a value one of the records must have (a TXT record may contain it). An empty string clears it. JSON: the value op compares with (a number for gt and lt)."},
					"watch_drift":      map[string]any{"type": "boolean", "description": "DNS only: report in the bell when the set of records changes. Useful for MX, TXT, NS and CNAME; noisy for A and AAAA behind a CDN."},
					"path":             map[string]any{"type": "string", "description": "HTTP and JSON: a path and optional query on the bookmark's own host, starting with a single /, such as /health. Empty uses the bookmark's own address. Never a full URL."},
					"json_path":        map[string]any{"type": "string", "description": "JSON only, required for a new json check: the value to look at, such as status, db.state, items[0].name or services[name=api].up. At most 200 characters."},
					"op":               map[string]any{"type": "string", "description": "JSON only, required for a new json check: eq, ne, gt, lt, contains or exists."},
					"expect_status":    map[string]any{"type": "string", "description": "HTTP only: the status that counts as up, such as 200, 200-299 or 200,301. Empty means 200-299, judged after the redirects."},
					"expect_header":    map[string]any{"type": "string", "description": "HTTP only: a header that must be in the answer, as name or name: text it must contain (case-insensitive). Empty clears it."},
				},
				"required": []string{"url"},
			},
		},
		{
			"name":        "delete_net_check",
			"annotations": mcpAnnotations(false, true),
			"description": "Delete one network check from a bookmark. Its history goes with it at the next cleanup, and it cannot be restored. " +
				"Ask the person before calling this unless they asked for the deletion.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url":      urlProp,
					"page":     pageProp,
					"check_id": checkProp,
				},
				"required": []string{"url", "check_id"},
			},
		},
	}
}

// mcpNetDecode reads a tool's arguments and refuses a field it does not know,
// so a call that names a host or a port is an error rather than a silently
// ignored word.
func mcpNetDecode(args json.RawMessage, into any) map[string]any {
	if len(bytes.TrimSpace(args)) == 0 || string(bytes.TrimSpace(args)) == "null" {
		args = json.RawMessage("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(args))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		return map[string]any{"error": "Could not read the arguments (" + err.Error() + "). Network tools take no host or port."}
	}
	return nil
}

// mcpNetRefusal is the message of a refused inner call: the handlers answer
// {"error": "..."} for a refusal.
func mcpNetRefusal(rec *bufferedResponse) map[string]any {
	var body struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(rec.body.Bytes(), &body) == nil && body.Error != "" {
		return map[string]any{"error": body.Error}
	}
	return mcpErrorFrom(rec)
}

// mcpNetCheckSummary is a check as a model should read it: the settings that
// matter and the state it was last in, without the baseline of a DNS check
// (get_net_check carries that).
func (h *Handlers) mcpNetCheckSummary(bm Bookmark, pageID int, c NetCheck, samples []HealthSample) map[string]any {
	out := map[string]any{
		"check_id": c.ID,
		"type":     c.Type,
		"label":    netCheckLabel(c, bm),
		"enabled":  c.Enabled,
		"muted":    c.Muted || bm.NotifyMuted,
		"url":      strings.TrimSpace(bm.URL),
		"name":     strings.TrimSpace(bm.Name),
		"pageId":   pageID,
		"page":     pageNameForID(h.store, pageID),
	}
	out["interval_minutes"] = int(netCheckInterval(c, bm) / time.Minute)
	if c.TimeoutSec > 0 {
		out["timeout_sec"] = c.TimeoutSec
	}
	if c.Port > 0 {
		out["port"] = c.Port
	}
	if c.Host != "" {
		out["host"] = c.Host
	}
	if c.Type == netTypeTLS {
		out["min_days_left"] = netTLSMinDays(c)
	}
	if c.Count > 0 {
		out["count"] = c.Count
	}
	if c.MaxLossPct > 0 {
		out["max_loss_pct"] = c.MaxLossPct
	}
	if c.MaxMs > 0 {
		out["max_ms"] = c.MaxMs
	}
	if c.Type == netTypeHTTP {
		if c.Endpoint != "" {
			out["path"] = c.Endpoint
		}
		out["expect_status"] = netHTTPExpectedStatus(c)
		if c.ExpectHeader != "" {
			out["expect_header"] = c.ExpectHeader
		}
	}
	if c.Type == netTypeJSON {
		if c.Endpoint != "" {
			out["path"] = c.Endpoint
		}
		out["json_path"] = c.Path
		out["op"] = c.Op
		// A value under a secret-looking path is not echoed: the expected value
		// may be the secret itself.
		if c.Op != "exists" && c.Expect != "" {
			if netJSONPathIsSecret(c.Path) {
				out["expect"] = netJSONHidden
			} else {
				out["expect"] = c.Expect
			}
		}
		out["uses_credential"] = strings.TrimSpace(c.CredentialID) != "" || strings.TrimSpace(bm.CredentialID) != ""
	}
	if c.Type == netTypeDNS {
		out["record"] = c.Record
		if c.Expect != "" {
			out["expect"] = c.Expect
		}
		out["watch_drift"] = c.WatchDrift
		if c.DriftDiff != "" {
			out["dns_changed"] = c.DriftDiff
		}
	}
	if state := netCheckStateFor(c, samples); state != nil {
		out["state"] = state
	}
	return out
}

func (h *Handlers) mcpRunNetworkTest(r *http.Request, args json.RawMessage) map[string]any {
	if e := mcpNeedsToken(r); e != nil {
		return e
	}
	var body struct {
		URL     string `json:"url"`
		Page    int    `json:"page"`
		Type    string `json:"type"`
		Record  string `json:"record"`
		CheckID string `json:"check_id"`
		// A one-off json test.
		Path     string `json:"path"`
		JSONPath string `json:"json_path"`
		Op       string `json:"op"`
		Expect   string `json:"expect"`
	}
	if e := mcpNetDecode(args, &body); e != nil {
		return e
	}
	if strings.TrimSpace(body.Type) == "" && strings.TrimSpace(body.CheckID) == "" {
		return map[string]any{"error": "Give type (tcp, ping, dns, tls, http or json) or check_id."}
	}
	bm, page, refused := h.mcpResolveBookmark(body.URL, body.Page)
	if refused != nil {
		return refused
	}
	// The route's own SSRF budget first, then the network-test budget inside
	// runNetTestFor: both count against the caller's address, as for the UI.
	client := clientIP(r)
	if h.ssrfAPILimiter != nil && !h.ssrfAPILimiter.allow(client) {
		return map[string]any{"error": "Too many requests; wait a minute.", "retry_after_seconds": 60}
	}
	res, status, err := h.runNetTestForSpec(r.Context(), client, page, bm.URL, strings.TrimSpace(body.Type), strings.TrimSpace(body.CheckID), strings.TrimSpace(body.Record),
		netOneOffJSON{Endpoint: body.Path, Path: body.JSONPath, Op: body.Op, Expect: body.Expect})
	if err != nil {
		out := map[string]any{"error": err.Error()}
		if status == http.StatusTooManyRequests {
			out["retry_after_seconds"] = 60
		}
		return out
	}
	encoded, _ := json.Marshal(res)
	out := map[string]any{}
	_ = json.Unmarshal(encoded, &out)
	out["url"] = strings.TrimSpace(bm.URL)
	return out
}

func (h *Handlers) mcpListNetChecks(r *http.Request, args json.RawMessage) map[string]any {
	var body struct {
		URL   string `json:"url"`
		Page  int    `json:"page"`
		Limit int    `json:"limit"`
	}
	if e := mcpNetDecode(args, &body); e != nil {
		return e
	}
	limit := clampLimit(body.Limit, 50, 200)
	history := h.readAllHealthHistory()

	checks := []map[string]any{}
	total := 0
	add := func(bm Bookmark, pageID int) {
		for _, c := range bm.Checks {
			total++
			if len(checks) < limit {
				checks = append(checks, h.mcpNetCheckSummary(bm, pageID, c, history[netHistoryKey(c.ID)]))
			}
		}
	}
	if strings.TrimSpace(body.URL) != "" {
		bm, page, refused := h.mcpResolveBookmark(body.URL, body.Page)
		if refused != nil {
			return refused
		}
		add(bm, page)
	} else {
		for _, p := range h.store.GetPages() {
			for _, bm := range h.store.GetBookmarksByPage(p.ID) {
				add(bm, p.ID)
			}
		}
	}
	out := map[string]any{"checks": checks, "total": total}
	if total > len(checks) {
		out["truncated"] = true
	}
	return out
}

func (h *Handlers) mcpGetNetCheck(r *http.Request, args json.RawMessage) map[string]any {
	var body struct {
		CheckID string `json:"check_id"`
	}
	if e := mcpNetDecode(args, &body); e != nil {
		return e
	}
	bm, pageID, chk, ok := findNetCheck(h.store, strings.TrimSpace(body.CheckID))
	if !ok {
		return map[string]any{"error": "No check with that id. Call list_net_checks for the ids."}
	}
	key := netHistoryKey(chk.ID)
	all := h.readAllHealthHistory()[key]
	days := h.readAllHealthDays()[key]
	out := h.mcpNetCheckSummary(bm, pageID, chk, all)

	if stats := netCheckStats(all, days, netCheckInterval(chk, bm), time.Now()); stats != nil {
		compact := map[string]any{
			"uptime_24h":   stats.Uptime24h,
			"uptime_7d":    stats.Uptime7d,
			"uptime_30d":   stats.Uptime30d,
			"total_checks": stats.TotalChecks,
		}
		if stats.DownSince > 0 {
			compact["down_since"] = stats.DownSince
		}
		if n := len(stats.Incidents); n > 0 {
			if n > 5 {
				stats.Incidents = stats.Incidents[n-5:]
			}
			compact["incidents"] = stats.Incidents
		}
		out["stats"] = compact
	}
	if chk.Baseline != "" {
		out["baseline"] = chk.Baseline
	}
	if chk.DriftDiff != "" {
		out["drift"] = map[string]any{"diff": chk.DriftDiff, "at": chk.DriftAt}
	}

	// The newest samples first; what a model needs is how it has been doing
	// lately, not 2000 rows.
	const keep = 30
	recent := []map[string]any{}
	for i := len(all) - 1; i >= 0 && len(recent) < keep; i-- {
		s := all[i]
		row := map[string]any{"at": s.T, "ok": s.Up}
		if s.PingMs > 0 {
			row["ms"] = s.PingMs
		}
		if s.Fail != "" {
			row["class"] = s.Fail
		}
		if s.D != "" {
			row["detail"] = s.D
		}
		if s.L > 0 {
			row["secondary"] = s.L
		}
		if s.Maint {
			row["maintenance"] = true
		}
		recent = append(recent, row)
	}
	out["samples"] = recent
	return out
}

// mcpPutNetChecks writes one bookmark's whole list through the route the UI
// uses, and says why when it is refused.
func (h *Handlers) mcpPutNetChecks(r *http.Request, page int, rawURL string, next []NetCheck) map[string]any {
	if next == nil {
		next = []NetCheck{}
	}
	rec, err := h.mcpInner(r, http.MethodPut, "/api/net/checks", map[string]any{
		"pageId": page, "url": rawURL, "checks": next,
	}, nil, h.PutNetChecks)
	if err != nil {
		return map[string]any{"error": "Could not build the request."}
	}
	if rec.status >= 400 {
		return mcpNetRefusal(rec)
	}
	return nil
}

func (h *Handlers) mcpSetNetCheck(r *http.Request, args json.RawMessage) map[string]any {
	if e := mcpNeedsToken(r); e != nil {
		return e
	}
	var body struct {
		URL             string  `json:"url"`
		Page            int     `json:"page"`
		CheckID         string  `json:"check_id"`
		Type            string  `json:"type"`
		Enabled         *bool   `json:"enabled"`
		Label           *string `json:"label"`
		IntervalMinutes *int    `json:"interval_minutes"`
		TimeoutSec      *int    `json:"timeout_sec"`
		Muted           *bool   `json:"muted"`
		Port            *int    `json:"port"`
		MinDaysLeft     *int    `json:"min_days_left"`
		Count           *int    `json:"count"`
		MaxLossPct      *int    `json:"max_loss_pct"`
		MaxMs           *int    `json:"max_ms"`
		Record          *string `json:"record"`
		Expect          *string `json:"expect"`
		WatchDrift      *bool   `json:"watch_drift"`
		Path            *string `json:"path"`
		ExpectStatus    *string `json:"expect_status"`
		ExpectHeader    *string `json:"expect_header"`
		JSONPath        *string `json:"json_path"`
		Op              *string `json:"op"`
	}
	if e := mcpNetDecode(args, &body); e != nil {
		return e
	}
	bm, page, refused := h.mcpResolveBookmark(body.URL, body.Page)
	if refused != nil {
		return refused
	}

	next := append([]NetCheck(nil), bm.Checks...)
	idx := -1
	body.CheckID = strings.TrimSpace(body.CheckID)
	body.Type = strings.ToLower(strings.TrimSpace(body.Type))
	if body.CheckID != "" {
		for i, c := range next {
			if c.ID == body.CheckID {
				idx = i
				break
			}
		}
		if idx < 0 {
			return map[string]any{"error": "That bookmark has no check with that id. Call list_net_checks for its checks."}
		}
		if body.Type != "" && body.Type != next[idx].Type {
			return map[string]any{"error": "The type of a check cannot change. Delete it and add a new one."}
		}
	} else {
		if body.Type == "" {
			return map[string]any{"error": "Give type (tcp, ping, dns, tls, http or json) to add a check, or check_id to change one."}
		}
		next = append(next, NetCheck{Type: body.Type})
		idx = len(next) - 1
	}
	before := map[string]bool{}
	for _, c := range bm.Checks {
		before[c.ID] = true
	}

	c := &next[idx]
	if body.Enabled != nil {
		c.Enabled = *body.Enabled
	}
	if body.Label != nil {
		c.Label = strings.TrimSpace(*body.Label)
	}
	if body.IntervalMinutes != nil {
		c.IntervalMinutes = *body.IntervalMinutes
	}
	if body.TimeoutSec != nil {
		c.TimeoutSec = *body.TimeoutSec
	}
	if body.Muted != nil {
		c.Muted = *body.Muted
	}
	if body.Port != nil {
		c.Port = *body.Port
	}
	if body.MinDaysLeft != nil {
		c.MinDaysLeft = *body.MinDaysLeft
	}
	if body.Count != nil {
		c.Count = *body.Count
	}
	if body.MaxLossPct != nil {
		c.MaxLossPct = *body.MaxLossPct
	}
	if body.MaxMs != nil {
		c.MaxMs = *body.MaxMs
	}
	if body.Record != nil {
		c.Record = strings.ToUpper(strings.TrimSpace(*body.Record))
	}
	if body.Expect != nil {
		c.Expect = strings.TrimSpace(*body.Expect)
	}
	if body.WatchDrift != nil {
		c.WatchDrift = *body.WatchDrift
	}
	if body.Path != nil {
		c.Endpoint = strings.TrimSpace(*body.Path)
	}
	if body.ExpectStatus != nil {
		c.ExpectStatus = strings.TrimSpace(*body.ExpectStatus)
	}
	if body.ExpectHeader != nil {
		c.ExpectHeader = strings.TrimSpace(*body.ExpectHeader)
	}
	if body.JSONPath != nil {
		c.Path = strings.TrimSpace(*body.JSONPath)
	}
	if body.Op != nil {
		c.Op = strings.ToLower(strings.TrimSpace(*body.Op))
	}
	if refusal := h.mcpPutNetChecks(r, page, bm.URL, next); refusal != nil {
		return refusal
	}

	// What was stored, read back: the server sets the id of a new check and
	// normalises the rest.
	list := h.store.GetBookmarksByPage(page)
	i := netRowIndex(list, canonicalBookmarkURLKey(bm.URL), 0)
	if i < 0 {
		return map[string]any{"error": "The bookmark is gone."}
	}
	saved := list[i]
	for _, s := range saved.Checks {
		if (body.CheckID != "" && s.ID == body.CheckID) || (body.CheckID == "" && !before[s.ID]) {
			return map[string]any{
				"saved": true,
				"check": h.mcpNetCheckSummary(saved, page, s, h.readAllHealthHistory()[netHistoryKey(s.ID)]),
			}
		}
	}
	return map[string]any{"error": "The check was not saved."}
}

func (h *Handlers) mcpDeleteNetCheck(r *http.Request, args json.RawMessage) map[string]any {
	if e := mcpNeedsToken(r); e != nil {
		return e
	}
	var body struct {
		URL     string `json:"url"`
		Page    int    `json:"page"`
		CheckID string `json:"check_id"`
	}
	if e := mcpNetDecode(args, &body); e != nil {
		return e
	}
	body.CheckID = strings.TrimSpace(body.CheckID)
	if body.CheckID == "" {
		return map[string]any{"error": "check_id is required."}
	}
	bm, page, refused := h.mcpResolveBookmark(body.URL, body.Page)
	if refused != nil {
		return refused
	}
	var gone *NetCheck
	next := make([]NetCheck, 0, len(bm.Checks))
	for _, c := range bm.Checks {
		if c.ID == body.CheckID {
			c := c
			gone = &c
			continue
		}
		next = append(next, c)
	}
	if gone == nil {
		return map[string]any{"error": "That bookmark has no check with that id. Call list_net_checks for its checks."}
	}
	if refusal := h.mcpPutNetChecks(r, page, bm.URL, next); refusal != nil {
		return refusal
	}
	return map[string]any{
		"deleted": true, "check_id": gone.ID, "label": netCheckLabel(*gone, bm),
		"url": strings.TrimSpace(bm.URL), "page": pageNameForID(h.store, page),
	}
}
