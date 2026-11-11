package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Prowlarr: how the indexers are doing, on the shared media tile.

Three topics, each switched on or off in the settings: the indexers with what
they were asked and how fast they answered, what needs attention (Prowlarr's
own health messages and indexers it has switched off after failures) and a line
of totals. They share one answer (MediaIndexers) and one tile; a topic that is
off is not asked for, and one that fails leaves the others on screen.

The key goes in the X-Api-Key header, as for Sonarr and Radarr. The answers are
the ones Prowlarr's own screens use under /api/v1: indexer (the list),
indexerstats (queries, grabs and answer times from a start date), indexerstatus
(the indexers it has paused) and health.

Prowlarr's history carries the full address of every search, key included, so
this widget never reads it.
*/

const (
	prowlarrDefaultRows = 5
	prowlarrDefaultTTL  = 300
	prowlarrMinTTL      = 60
	prowlarrDefaultDays = 7
)

var prowlarrTopics = []string{"indexers", "issues", "totals"}

func prowlarrFields() []widgetField {
	return []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		// What the tile shows. Absent means all three.
		{Key: "topics", Kind: "list", Allowed: prowlarrTopics},
		{Key: "days", Kind: "int", Min: 1, Max: 365},
		{Key: "click", Kind: "string", Allowed: []string{"open", "detail"}},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "ttl", Kind: "int", Min: prowlarrMinTTL, Max: 3600},
	}
}

// MediaIndexers is what a Prowlarr tile draws.
type MediaIndexers struct {
	// Days is the window the counts cover.
	Days     int                  `json:"days"`
	Totals   *MediaIndexersTotals `json:"totals,omitempty"`
	Indexers []MediaIndexerRow    `json:"indexers,omitempty"`
	Issues   []MediaIndexerIssue  `json:"issues,omitempty"`
	// Topics are the ones the server asked for, so the tile can tell "off"
	// from "nothing happened".
	Topics  []string `json:"topics"`
	OpenURL string   `json:"openUrl"`
	// Partial says a topic could not be read; the next read is soon.
	Partial bool `json:"-"`
}

type MediaIndexersTotals struct {
	Enabled int `json:"enabled"`
	Total   int `json:"total"`
	// The counts come from the stats; they are left out when those could not
	// be read, never sent as zero.
	Queries *int64 `json:"queries,omitempty"`
	Grabs   *int64 `json:"grabs,omitempty"`
	Failed  *int64 `json:"failed,omitempty"`
}

type MediaIndexerRow struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Protocol string `json:"protocol"` // torrent | usenet
	Queries  int64  `json:"queries"`
	Grabs    int64  `json:"grabs"`
	Failed   int64  `json:"failed"`
	// AvgMs is the average answer time in milliseconds; 0 when it was not asked.
	AvgMs int64 `json:"avgMs"`
	// Paused says Prowlarr has switched the indexer off for now.
	Paused bool `json:"paused,omitempty"`
	// NoStats says the counts above are unknown, not zero.
	NoStats bool   `json:"noStats,omitempty"`
	OpenURL string `json:"openUrl"`
}

type MediaIndexerIssue struct {
	ID    string `json:"id"`
	Level string `json:"level"` // error | warning | info
	Text  string `json:"text"`
	// Until is when a paused indexer is tried again, in milliseconds; 0 when not paused.
	Until   int64  `json:"until,omitempty"`
	OpenURL string `json:"openUrl"`
}

type prowlarrSpec struct {
	Server       string
	CredentialID string
	Topics       []string
	Days         int
	Rows         int
	TTL          time.Duration
}

func prowlarrSpecFrom(config map[string]any) prowlarrSpec {
	spec := prowlarrSpec{
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		Days:         prowlarrDefaultDays,
		Rows:         prowlarrDefaultRows,
		TTL:          prowlarrDefaultTTL * time.Second,
	}
	spec.Topics = append(spec.Topics, widgetConfigList(config["topics"], prowlarrTopics)...)
	if len(spec.Topics) == 0 {
		spec.Topics = append([]string(nil), prowlarrTopics...)
	}
	if days, ok := widgetConfigInt(config["days"]); ok && days > 0 {
		spec.Days = clampInt(days, 1, 365)
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, prowlarrMinTTL, 3600)) * time.Second
	}
	return spec
}

// fingerprint changes with every setting that changes what Prowlarr is asked.
func (spec prowlarrSpec) fingerprint() string {
	return strings.Join([]string{spec.Server, spec.CredentialID, strings.Join(spec.Topics, ","),
		strconv.Itoa(spec.Days), strconv.Itoa(spec.Rows)}, "|")
}

func (spec prowlarrSpec) has(topic string) bool { return containsString(spec.Topics, topic) }

// prowlarrListLimit bounds the indexer list. Prowlarr sends every indexer with
// its fields and categories, which is tens of kilobytes each.
const prowlarrListLimit = 32 << 20

func (h *Handlers) prowlarrGet(ctx context.Context, server string, credential HealthCredential, path string, out any) error {
	return h.prowlarrGetLimited(ctx, server, credential, path, out, jellyfinMaxBody)
}

func (h *Handlers) prowlarrGetLimited(ctx context.Context, server string, credential HealthCredential, path string, out any, limit int64) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, path, nil, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, limit)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

type prowlarrIndexer struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Enable   bool   `json:"enable"`
	Protocol string `json:"protocol"`
}

type prowlarrStat struct {
	ID       int64 `json:"indexerId"`
	Queries  int64 `json:"numberOfQueries"`
	Grabs    int64 `json:"numberOfGrabs"`
	RSS      int64 `json:"numberOfRssQueries"`
	Auth     int64 `json:"numberOfAuthQueries"`
	FailQ    int64 `json:"numberOfFailedQueries"`
	FailG    int64 `json:"numberOfFailedGrabs"`
	FailRSS  int64 `json:"numberOfFailedRssQueries"`
	FailAuth int64 `json:"numberOfFailedAuthQueries"`
	AvgMs    int64 `json:"averageResponseTime"`
}

func (s prowlarrStat) failed() int64 { return s.FailQ + s.FailG + s.FailRSS + s.FailAuth }

type prowlarrPause struct {
	ID    int64  `json:"indexerId"`
	Until string `json:"disabledTill"`
}

type prowlarrHealth struct {
	Source  string `json:"source"`
	Type    string `json:"type"`
	Message string `json:"message"`
}

func prowlarrMs(raw string) int64 {
	if at, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return at.UnixMilli()
	}
	return 0
}

// fetchProwlarr reads every topic the tile asked for.
func (h *Handlers) fetchProwlarr(ctx context.Context, spec prowlarrSpec) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, nil, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, nil, errMediaNotSetUp
	}
	out := &MediaIndexers{Days: spec.Days, Topics: spec.Topics, OpenURL: spec.Server}

	var (
		list  []prowlarrIndexer
		stats struct {
			Indexers []prowlarrStat `json:"indexers"`
		}
		pauses                                 []prowlarrPause
		health                                 []prowlarrHealth
		errList, errStats, errPause, errHealth error
		wg                                     sync.WaitGroup
	)
	needList := spec.has("indexers") || spec.has("totals") || spec.has("issues")
	needStats := spec.has("indexers") || spec.has("totals")
	needPause := spec.has("indexers") || spec.has("issues")
	needHealth := spec.has("issues")
	run := func(want bool, read func()) {
		if !want {
			return
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			read()
		}()
	}
	run(needList, func() {
		errList = h.prowlarrGetLimited(ctx, spec.Server, credential, "/api/v1/indexer", &list, prowlarrListLimit)
	})
	run(needStats, func() {
		since := time.Now().AddDate(0, 0, -spec.Days).UTC().Format("2006-01-02")
		errStats = h.prowlarrGet(ctx, spec.Server, credential, "/api/v1/indexerstats?startDate="+url.QueryEscape(since), &stats)
	})
	run(needPause, func() { errPause = h.prowlarrGet(ctx, spec.Server, credential, "/api/v1/indexerstatus", &pauses) })
	run(needHealth, func() { errHealth = h.prowlarrGet(ctx, spec.Server, credential, "/api/v1/health", &health) })
	wg.Wait()

	// Without the list nothing can be named: a refused key or an unreachable
	// server shows here first, so it is the error the tile words.
	if needList && errList != nil {
		return result, nil, errList
	}

	byID := map[int64]prowlarrIndexer{}
	enabled := 0
	for _, ix := range list {
		byID[ix.ID] = ix
		if ix.Enable {
			enabled++
		}
	}
	paused := map[int64]int64{}
	now := time.Now().UnixMilli()
	for _, p := range pauses {
		if until := prowlarrMs(p.Until); until > now {
			paused[p.ID] = until
		}
	}
	statByID := map[int64]prowlarrStat{}
	for _, s := range stats.Indexers {
		statByID[s.ID] = s
	}

	if spec.has("indexers") {
		if errStats != nil || errPause != nil {
			out.Partial = true
		}
		rows := []MediaIndexerRow{}
		for _, ix := range list {
			if !ix.Enable {
				continue
			}
			s := statByID[ix.ID]
			row := MediaIndexerRow{ID: ix.ID, Name: ix.Name, Protocol: ix.Protocol, Queries: s.Queries + s.RSS, Grabs: s.Grabs,
				Failed: s.failed(), AvgMs: s.AvgMs, NoStats: errStats != nil, OpenURL: spec.Server + "/indexers"}
			_, row.Paused = paused[ix.ID]
			rows = append(rows, row)
		}
		sort.SliceStable(rows, func(i, j int) bool {
			if rows[i].Paused != rows[j].Paused {
				return rows[i].Paused
			}
			if rows[i].Queries != rows[j].Queries {
				return rows[i].Queries > rows[j].Queries
			}
			return rows[i].Name < rows[j].Name
		})
		if len(rows) > spec.Rows {
			rows = rows[:spec.Rows]
		}
		out.Indexers = rows
	}
	if spec.has("issues") {
		if errHealth != nil || errPause != nil {
			out.Partial = true
		}
		issues := []MediaIndexerIssue{}
		for i, item := range health {
			level := "warning"
			switch strings.ToLower(item.Type) {
			case "error":
				level = "error"
			case "ok", "notice":
				continue
			}
			issues = append(issues, MediaIndexerIssue{ID: "h" + strconv.Itoa(i), Level: level, Text: item.Message,
				OpenURL: spec.Server + "/system/status"})
		}
		for id, until := range paused {
			name := byID[id].Name
			if name == "" {
				name = "#" + strconv.FormatInt(id, 10)
			}
			issues = append(issues, MediaIndexerIssue{ID: "p" + strconv.FormatInt(id, 10), Level: "error", Text: name,
				Until: until, OpenURL: spec.Server + "/indexers"})
		}
		sort.SliceStable(issues, func(i, j int) bool {
			if issues[i].Level != issues[j].Level {
				return issues[i].Level == "error"
			}
			return issues[i].ID < issues[j].ID
		})
		if len(issues) > spec.Rows {
			issues = issues[:spec.Rows]
		}
		out.Issues = issues
	}
	if spec.has("totals") {
		totals := &MediaIndexersTotals{Enabled: enabled, Total: len(list)}
		if errStats != nil {
			out.Partial = true
		} else {
			var queries, grabs, failed int64
			for _, s := range stats.Indexers {
				queries += s.Queries + s.RSS
				grabs += s.Grabs
				failed += s.failed()
			}
			totals.Queries, totals.Grabs, totals.Failed = &queries, &grabs, &failed
		}
		out.Totals = totals
	}
	result.Indexers = out
	result.Partial = out.Partial
	return result, nil, nil
}

func (h *Handlers) prowlarrWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeProwlarr, func(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
		spec := prowlarrSpecFrom(widget.Config)
		ms := mediaSpec{Service: string(WidgetTypeProwlarr), Server: spec.Server, CredentialID: spec.CredentialID,
			Fingerprint: spec.fingerprint(), TTL: spec.TTL}
		return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
			return h.fetchProwlarr(ctx, spec)
		}, forced)
	})
}

/*
prowlarrSetupHandler tries an address and a key and names the version it found.

Behind the write token, and takes a key that is typed but not yet saved, like
the other media setups: the key is used for this one request and written
nowhere.
*/
func (h *Handlers) prowlarrSetupHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !h.requireWriteAccess(w, r) || !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	var body map[string]any
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	answer := struct {
		Connected string `json:"connected,omitempty"`
		Error     string `json:"error,omitempty"`
	}{}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "Prowlarr setup for %s: %v", hostOf(stringOr(body["server"])), err)
			answer.Error = mediaErrorCode(err)
		}
		_ = json.NewEncoder(w).Encode(answer)
	}
	server := strings.TrimRight(sanitizeWidgetURL(stringOr(body["server"])), "/")
	var credential HealthCredential
	if draft := draftCredentialFrom(body["draftCredential"]); draft != nil {
		credential = *draft
	} else if stored, ok := lookupHealthCredential(stringOr(body["credentialId"])); ok {
		credential = stored
	} else {
		reply(errMediaNotSetUp)
		return
	}
	if server == "" {
		reply(errMediaNotSetUp)
		return
	}
	var status struct {
		AppName string `json:"appName"`
		Version string `json:"version"`
	}
	if err := h.prowlarrGet(r.Context(), server, credential, "/api/v1/system/status", &status); err != nil {
		reply(err)
		return
	}
	if status.Version == "" || !strings.EqualFold(status.AppName, "Prowlarr") {
		// Something answered, but it is not Prowlarr.
		reply(errMediaUnreachable)
		return
	}
	answer.Connected = "Prowlarr " + status.Version
	reply(nil)
}
