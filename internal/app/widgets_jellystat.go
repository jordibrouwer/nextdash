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
Jellystat: who watched what, on the shared media tile.

Four topics, each switched on or off in the settings: recent plays, the most
viewed items, the most active people and a line of totals. They share one
answer (MediaStats) and one tile; a topic that is off is not asked for, and one
that fails leaves the others on screen.

The key goes in the x-api-token header. Jellystat answers the statistics under
/stats and the library lists under /api; the pictures come from its /proxy,
which is how Jellystat itself shows them.

Jellystat splits only some of its answers by library: the totals (its views
over time are per library) and the list of recent plays (a history per
library). The top lists count every library, because Jellystat cannot do
otherwise, and the tile's setting says so.

Counts arrive from Postgres as strings as often as numbers, so every figure is
read through jellystatNum.
*/

const (
	jellystatDefaultRows = 5
	jellystatDefaultTTL  = 300
	jellystatMinTTL      = 60
	jellystatDefaultDays = 30
	// jellystatTopLimit is how many items a top list gets before rows cuts.
	jellystatTopLimit = 10
	// jellystatMaxActivity bounds one read of the recent plays.
	jellystatMaxActivity = 20
)

var jellystatTopics = []string{"activity", "items", "users", "totals"}

func jellystatFields() []widgetField {
	return []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		// What the tile shows. Absent means all four.
		{Key: "topics", Kind: "list", Allowed: jellystatTopics},
		{Key: "days", Kind: "int", Min: 1, Max: 365},
		// Library ids; empty means every library.
		{Key: "libraries", Kind: "list"},
		{Key: "click", Kind: "string", Allowed: []string{"open", "detail"}},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "ttl", Kind: "int", Min: jellystatMinTTL, Max: 3600},
	}
}

// MediaStats is what a Jellystat tile draws.
type MediaStats struct {
	// Days is the window the totals and the top lists cover.
	Days     int                `json:"days"`
	Totals   *MediaStatsTotals  `json:"totals,omitempty"`
	Activity []MediaStatsPlay   `json:"activity,omitempty"`
	Items    []MediaStatsItem   `json:"items,omitempty"`
	Users    []MediaStatsPerson `json:"users,omitempty"`
	// Topics are the ones the server asked for, so the tile can tell "off"
	// from "nothing happened".
	Topics  []string `json:"topics"`
	OpenURL string   `json:"openUrl"`
	// Partial says a topic could not be read; the next read is soon.
	Partial bool `json:"-"`
}

type MediaStatsTotals struct {
	Plays   int64 `json:"plays"`
	Seconds int64 `json:"seconds"`
}

type MediaStatsPlay struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle,omitempty"`
	Who      string `json:"who,omitempty"`
	Device   string `json:"device,omitempty"`
	Method   string `json:"method,omitempty"`
	Seconds  int64  `json:"seconds,omitempty"`
	At       int64  `json:"at"`
	Poster   string `json:"poster,omitempty"`
	OpenURL  string `json:"openUrl"`
}

type MediaStatsItem struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	Plays   int64  `json:"plays"`
	Seconds int64  `json:"seconds,omitempty"`
	Poster  string `json:"poster,omitempty"`
	OpenURL string `json:"openUrl"`
}

type MediaStatsPerson struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Plays   int64  `json:"plays"`
	OpenURL string `json:"openUrl"`
}

// jellystatNum reads a JSON number that may arrive as a string.
type jellystatNum float64

func (n *jellystatNum) UnmarshalJSON(raw []byte) error {
	text := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	if text == "" || text == "null" {
		*n = 0
		return nil
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil {
		*n = 0
		return nil
	}
	*n = jellystatNum(value)
	return nil
}

func (n jellystatNum) int64() int64 { return int64(n) }

type jellystatSpec struct {
	Server       string
	CredentialID string
	Topics       []string
	Days         int
	Libraries    []string
	Rows         int
	TTL          time.Duration
}

func jellystatSpecFrom(config map[string]any) jellystatSpec {
	spec := jellystatSpec{
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		Days:         jellystatDefaultDays,
		Rows:         jellystatDefaultRows,
		TTL:          jellystatDefaultTTL * time.Second,
	}
	for _, name := range widgetConfigList(config["topics"], jellystatTopics) {
		spec.Topics = append(spec.Topics, name)
	}
	if len(spec.Topics) == 0 {
		spec.Topics = append([]string(nil), jellystatTopics...)
	}
	spec.Libraries = widgetConfigList(config["libraries"], nil)
	sort.Strings(spec.Libraries)
	if days, ok := widgetConfigInt(config["days"]); ok && days > 0 {
		spec.Days = clampInt(days, 1, 365)
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, jellystatMinTTL, 3600)) * time.Second
	}
	return spec
}

// fingerprint changes with every setting that changes what Jellystat is asked.
func (spec jellystatSpec) fingerprint() string {
	return strings.Join([]string{spec.Server, spec.CredentialID, strings.Join(spec.Topics, ","),
		strconv.Itoa(spec.Days), strings.Join(spec.Libraries, ","), strconv.Itoa(spec.Rows)}, "|")
}

func (spec jellystatSpec) has(topic string) bool { return containsString(spec.Topics, topic) }

// jellystatSend asks once: a GET, or a POST with a JSON body.
func (h *Handlers) jellystatSend(ctx context.Context, server string, credential HealthCredential, method, path string, body any, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	var resp *http.Response
	var err error
	if method == http.MethodPost {
		resp, err = h.mediaPost(ctx, server, credential, path, body)
	} else {
		resp, err = h.mediaRequest(ctx, server, credential, path, nil, "application/json", nil)
	}
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, jellyfinMaxBody)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

type jellystatLibrary struct {
	ID       string `json:"Id"`
	Name     string `json:"Name"`
	Archived bool   `json:"archived"`
}

func (h *Handlers) jellystatLibraries(ctx context.Context, server string, credential HealthCredential) ([]jellystatLibrary, error) {
	var all []jellystatLibrary
	if err := h.jellystatSend(ctx, server, credential, http.MethodGet, "/api/getLibraries", nil, &all); err != nil {
		return nil, err
	}
	out := all[:0]
	for _, lib := range all {
		if !lib.Archived && lib.ID != "" {
			out = append(out, lib)
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

func jellystatItemURL(server, id string) string {
	return server + "/libraries/item/" + url.PathEscape(id)
}

type jellystatPlay struct {
	ID       string       `json:"NowPlayingItemId"`
	Name     string       `json:"NowPlayingItemName"`
	Series   string       `json:"SeriesName"`
	User     string       `json:"UserName"`
	Device   string       `json:"DeviceName"`
	Client   string       `json:"Client"`
	Method   string       `json:"PlayMethod"`
	Duration jellystatNum `json:"PlaybackDuration"`
	At       string       `json:"ActivityDateInserted"`
}

type jellystatHistory struct {
	Results []jellystatPlay `json:"results"`
}

func jellystatMs(raw string) int64 {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02 15:04:05"} {
		if at, err := time.Parse(layout, raw); err == nil {
			return at.UnixMilli()
		}
	}
	return 0
}

func (h *Handlers) jellystatActivity(ctx context.Context, spec jellystatSpec, credential HealthCredential,
	imageURL func(mediaImageRef) string, images map[mediaImageRef]bool) ([]MediaStatsPlay, error) {
	size := clampInt(spec.Rows, 1, jellystatMaxActivity)
	var plays []jellystatPlay
	if len(spec.Libraries) == 0 {
		var page jellystatHistory
		path := "/stats/getPlaybackActivity?size=" + strconv.Itoa(size) + "&page=1"
		if err := h.jellystatSend(ctx, spec.Server, credential, http.MethodGet, path, nil, &page); err != nil {
			return nil, err
		}
		plays = page.Results
	} else {
		// One history per chosen library, merged newest first.
		var failed error
		var mu sync.Mutex
		var wg sync.WaitGroup
		for _, id := range spec.Libraries {
			wg.Add(1)
			go func(id string) {
				defer wg.Done()
				var page jellystatHistory
				path := "/api/getLibraryHistory?size=" + strconv.Itoa(size) + "&page=1"
				err := h.jellystatSend(ctx, spec.Server, credential, http.MethodPost, path, map[string]any{"libraryid": id}, &page)
				mu.Lock()
				defer mu.Unlock()
				if err != nil {
					failed = err
					return
				}
				plays = append(plays, page.Results...)
			}(id)
		}
		wg.Wait()
		if failed != nil && len(plays) == 0 {
			return nil, failed
		}
		sort.SliceStable(plays, func(i, j int) bool { return jellystatMs(plays[i].At) > jellystatMs(plays[j].At) })
	}
	out := make([]MediaStatsPlay, 0, len(plays))
	for _, play := range plays {
		title, subtitle := play.Name, ""
		if play.Series != "" {
			title, subtitle = play.Series, play.Name
		}
		entry := MediaStatsPlay{
			ID: play.ID, Title: title, Subtitle: subtitle, Who: play.User,
			Device: firstNonEmpty(play.Device, play.Client), Method: play.Method,
			Seconds: play.Duration.int64(), At: jellystatMs(play.At),
			OpenURL: jellystatItemURL(spec.Server, play.ID),
		}
		if play.ID != "" {
			ref := mediaImageRef{Item: play.ID, Kind: "poster", Tag: "p"}
			entry.Poster = imageURL(ref)
			images[ref] = true
		}
		out = append(out, entry)
	}
	if len(out) > size {
		out = out[:size]
	}
	return out, nil
}

type jellystatViewed struct {
	ID       string       `json:"Id"`
	Name     string       `json:"Name"`
	Plays    jellystatNum `json:"Plays"`
	Duration jellystatNum `json:"total_playback_duration"`
	Hash     string       `json:"PrimaryImageHash"`
}

// jellystatKinds maps what Jellystat calls a type to what the tile calls it.
var jellystatKinds = []struct{ Type, Kind string }{{"Movie", "movie"}, {"Series", "series"}, {"Audio", "music"}}

func (h *Handlers) jellystatItems(ctx context.Context, spec jellystatSpec, credential HealthCredential,
	imageURL func(mediaImageRef) string, images map[mediaImageRef]bool) ([]MediaStatsItem, error) {
	var mu sync.Mutex
	var wg sync.WaitGroup
	var out []MediaStatsItem
	var failures int
	var firstErr error
	for _, kind := range jellystatKinds {
		wg.Add(1)
		go func(kind struct{ Type, Kind string }) {
			defer wg.Done()
			var rows []jellystatViewed
			body := map[string]any{"days": spec.Days, "type": kind.Type}
			err := h.jellystatSend(ctx, spec.Server, credential, http.MethodPost, "/stats/getMostViewedByType", body, &rows)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failures++
				if firstErr == nil {
					firstErr = err
				}
				return
			}
			for _, row := range rows {
				if row.ID == "" || row.Plays.int64() <= 0 {
					continue
				}
				item := MediaStatsItem{ID: row.ID, Title: row.Name, Kind: kind.Kind, Plays: row.Plays.int64(),
					Seconds: row.Duration.int64(), OpenURL: jellystatItemURL(spec.Server, row.ID)}
				ref := mediaImageRef{Item: row.ID, Kind: "poster", Tag: firstNonEmpty(row.Hash, "p")}
				item.Poster = imageURL(ref)
				images[ref] = true
				out = append(out, item)
			}
		}(kind)
	}
	wg.Wait()
	if failures == len(jellystatKinds) {
		return nil, firstErr
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Plays != out[j].Plays {
			return out[i].Plays > out[j].Plays
		}
		return out[i].Title < out[j].Title
	})
	if len(out) > jellystatTopLimit {
		out = out[:jellystatTopLimit]
	}
	return out, nil
}

func (h *Handlers) jellystatUsers(ctx context.Context, spec jellystatSpec, credential HealthCredential) ([]MediaStatsPerson, error) {
	var rows []struct {
		ID    string       `json:"UserId"`
		Name  string       `json:"Name"`
		Plays jellystatNum `json:"Plays"`
	}
	if err := h.jellystatSend(ctx, spec.Server, credential, http.MethodPost, "/stats/getMostActiveUsers",
		map[string]any{"days": spec.Days}, &rows); err != nil {
		return nil, err
	}
	out := make([]MediaStatsPerson, 0, len(rows))
	for _, row := range rows {
		if row.Name == "" {
			continue
		}
		out = append(out, MediaStatsPerson{ID: row.ID, Name: row.Name, Plays: row.Plays.int64(),
			OpenURL: spec.Server + "/users/" + url.PathEscape(row.ID)})
	}
	return out, nil
}

// jellystatTotals sums Jellystat's views over time. Each day holds a Key and
// one {count, duration} per library; a library filter keeps only the chosen
// names, so the figures follow the library choice.
func (h *Handlers) jellystatTotals(ctx context.Context, spec jellystatSpec, credential HealthCredential) (*MediaStatsTotals, error) {
	var answer struct {
		Stats []map[string]json.RawMessage `json:"stats"`
	}
	path := "/stats/getViewsOverTime?days=" + strconv.Itoa(spec.Days)
	if err := h.jellystatSend(ctx, spec.Server, credential, http.MethodGet, path, nil, &answer); err != nil {
		return nil, err
	}
	var chosen map[string]bool
	if len(spec.Libraries) > 0 {
		libraries, err := h.jellystatLibraries(ctx, spec.Server, credential)
		if err != nil {
			return nil, err
		}
		chosen = map[string]bool{}
		for _, lib := range libraries {
			if containsString(spec.Libraries, lib.ID) {
				chosen[lib.Name] = true
			}
		}
	}
	totals := &MediaStatsTotals{}
	for _, day := range answer.Stats {
		for name, raw := range day {
			if name == "Key" || (chosen != nil && !chosen[name]) {
				continue
			}
			var cell struct {
				Count    jellystatNum `json:"count"`
				Duration jellystatNum `json:"duration"`
			}
			if json.Unmarshal(raw, &cell) != nil {
				continue
			}
			totals.Plays += cell.Count.int64()
			totals.Seconds += cell.Duration.int64()
		}
	}
	return totals, nil
}

// fetchJellystat reads every topic the tile asked for.
func (h *Handlers) fetchJellystat(ctx context.Context, spec jellystatSpec, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
	images := map[mediaImageRef]bool{}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, nil, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, nil, errMediaNotSetUp
	}
	stats := &MediaStats{Days: spec.Days, Topics: spec.Topics, OpenURL: spec.Server}
	var firstErr error
	failed := 0
	note := func(err error) {
		failed++
		stats.Partial = true
		if firstErr == nil {
			firstErr = err
		}
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	run := func(topic string, read func() error) {
		if !spec.has(topic) {
			return
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := read(); err != nil {
				mu.Lock()
				note(err)
				mu.Unlock()
			}
		}()
	}
	run("totals", func() error {
		totals, err := h.jellystatTotals(ctx, spec, credential)
		mu.Lock()
		stats.Totals = totals
		mu.Unlock()
		return err
	})
	run("activity", func() error {
		// imageURL and images are touched by two readers, so each gets its own.
		own := map[mediaImageRef]bool{}
		plays, err := h.jellystatActivity(ctx, spec, credential, imageURL, own)
		mu.Lock()
		stats.Activity = plays
		for ref := range own {
			images[ref] = true
		}
		mu.Unlock()
		return err
	})
	run("items", func() error {
		own := map[mediaImageRef]bool{}
		items, err := h.jellystatItems(ctx, spec, credential, imageURL, own)
		mu.Lock()
		stats.Items = items
		for ref := range own {
			images[ref] = true
		}
		mu.Unlock()
		return err
	})
	run("users", func() error {
		people, err := h.jellystatUsers(ctx, spec, credential)
		mu.Lock()
		stats.Users = people
		mu.Unlock()
		return err
	})
	wg.Wait()
	// Every topic failing is an error the tile words; some failing is a
	// half answer it shows.
	if failed > 0 && failed == len(spec.Topics) {
		return result, nil, firstErr
	}
	result.Stats = stats
	result.Partial = stats.Partial
	return result, images, nil
}

// jellystatImageRoute is what Jellystat's own proxy needs for one picture.
func (h *Handlers) fetchJellystatImage(ctx context.Context, server string, credential HealthCredential, ref mediaImageRef) ([]byte, error) {
	query := url.Values{"id": {ref.Item}, "fillWidth": {"300"}, "quality": {"80"}}
	resp, err := h.mediaRequest(ctx, server, credential, "/proxy/Items/Images/Primary/", query, "image/*", nil)
	if err != nil {
		return nil, err
	}
	return readMediaImage(resp)
}

func (h *Handlers) jellystatWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeJellystat, func(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
		spec := jellystatSpecFrom(widget.Config)
		ms := mediaSpec{Service: string(WidgetTypeJellystat), Server: spec.Server, CredentialID: spec.CredentialID,
			Fingerprint: spec.fingerprint(), TTL: spec.TTL}
		return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
			return h.fetchJellystat(ctx, spec, imageURL)
		}, forced)
	})
}

func (h *Handlers) jellystatImageHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaImage(w, r, string(WidgetTypeJellystat), h.fetchJellystatImage)
}

/*
jellystatSetupHandler tries an address and a key and lists the libraries.

Behind the write token, and takes a key that is typed but not yet saved, like
the other media setups: the key is used for this one request and written
nowhere.
*/
func (h *Handlers) jellystatSetupHandler(w http.ResponseWriter, r *http.Request) {
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
	type setupLibrary struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	answer := struct {
		Connected string         `json:"connected,omitempty"`
		Libraries []setupLibrary `json:"libraries,omitempty"`
		Error     string         `json:"error,omitempty"`
	}{}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "Jellystat setup for %s: %v", hostOf(stringOr(body["server"])), err)
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
	libraries, err := h.jellystatLibraries(r.Context(), server, credential)
	if err != nil {
		reply(err)
		return
	}
	noun := "libraries"
	if len(libraries) == 1 {
		noun = "library"
	}
	answer.Connected = fmt.Sprintf("%d %s", len(libraries), noun)
	for _, lib := range libraries {
		answer.Libraries = append(answer.Libraries, setupLibrary{ID: lib.ID, Name: lib.Name})
	}
	reply(nil)
}
