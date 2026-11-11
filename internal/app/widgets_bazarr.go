package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Bazarr: which subtitles are missing and which came in, on the shared media tile.

Three topics, each switched on or off in the settings: what is missing, what
was fetched lately, and a line of totals. They share one answer (MediaSubs) and
one tile; a topic that is off is not asked for, and one that fails leaves the
others on screen.

The key goes in the X-API-KEY header. The answers are the ones Bazarr's own
screens use: /api/movies/wanted and /api/episodes/wanted (what is missing,
with a total), /api/movies/history and /api/episodes/history (what came in)
and /api/badges (how many providers have a problem). There are no pictures.
*/

const (
	bazarrDefaultRows = 5
	bazarrDefaultTTL  = 300
	bazarrMinTTL      = 60
)

var bazarrTopics = []string{"missing", "recent", "totals"}

// bazarrFetchedActions are the history actions that mean a subtitle arrived:
// downloaded, downloaded by hand, upgraded and translated. A deletion or a
// sync is not news to this tile.
var bazarrFetchedActions = map[int]bool{1: true, 2: true, 3: true, 6: true}

func bazarrFields() []widgetField {
	return []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		// What the tile shows. Absent means all three.
		{Key: "topics", Kind: "list", Allowed: bazarrTopics},
		{Key: "click", Kind: "string", Allowed: []string{"open", "detail"}},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "ttl", Kind: "int", Min: bazarrMinTTL, Max: 3600},
	}
}

// MediaSubs is what a Bazarr tile draws.
type MediaSubs struct {
	Totals  *MediaSubsTotals   `json:"totals,omitempty"`
	Missing []MediaSubsMissing `json:"missing,omitempty"`
	Recent  []MediaSubsFetched `json:"recent,omitempty"`
	// Topics are the ones the server asked for, so the tile can tell "off"
	// from "nothing happened".
	Topics  []string `json:"topics"`
	OpenURL string   `json:"openUrl"`
	// Partial says a topic could not be read; the next read is soon.
	Partial bool `json:"-"`
}

type MediaSubsTotals struct {
	MissingMovies   int `json:"missingMovies"`
	MissingEpisodes int `json:"missingEpisodes"`
	// ProviderIssues is how many subtitle providers Bazarr says are in trouble.
	ProviderIssues int `json:"providerIssues"`
}

type MediaSubsMissing struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"` // movie | episode
	Title    string `json:"title"`
	Subtitle string `json:"subtitle,omitempty"`
	// Languages are the two-letter codes still missing, "nl+hi" for a hearing
	// impaired track and "en+forced" for a forced one.
	Languages []string `json:"languages"`
	OpenURL   string   `json:"openUrl"`
}

type MediaSubsFetched struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle,omitempty"`
	Language string `json:"language"`
	Provider string `json:"provider,omitempty"`
	// Score is Bazarr's own figure, as text ("90.56%"); empty when it has none.
	Score string `json:"score,omitempty"`
	// Upgrade says the subtitle replaced an older one.
	Upgrade bool   `json:"upgrade,omitempty"`
	At      int64  `json:"at"`
	OpenURL string `json:"openUrl"`
}

type bazarrSpec struct {
	Server       string
	CredentialID string
	Topics       []string
	Rows         int
	TTL          time.Duration
}

func bazarrSpecFrom(config map[string]any) bazarrSpec {
	spec := bazarrSpec{
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		Rows:         bazarrDefaultRows,
		TTL:          bazarrDefaultTTL * time.Second,
	}
	spec.Topics = append(spec.Topics, widgetConfigList(config["topics"], bazarrTopics)...)
	if len(spec.Topics) == 0 {
		spec.Topics = append([]string(nil), bazarrTopics...)
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, bazarrMinTTL, 3600)) * time.Second
	}
	return spec
}

// fingerprint changes with every setting that changes what Bazarr is asked.
func (spec bazarrSpec) fingerprint() string {
	return strings.Join([]string{spec.Server, spec.CredentialID, strings.Join(spec.Topics, ","), strconv.Itoa(spec.Rows)}, "|")
}

func (spec bazarrSpec) has(topic string) bool { return containsString(spec.Topics, topic) }

func (h *Handlers) bazarrGet(ctx context.Context, server string, credential HealthCredential, path string, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, path, nil, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, jellyfinMaxBody)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

type bazarrLanguage struct {
	Code2  string `json:"code2"`
	Name   string `json:"name"`
	Forced bool   `json:"forced"`
	HI     bool   `json:"hi"`
}

// label is the short form the tile shows: nl, nl+hi, en+forced.
func (l bazarrLanguage) label() string {
	code := firstNonEmpty(l.Code2, l.Name)
	switch {
	case l.Forced:
		return code + "+forced"
	case l.HI:
		return code + "+hi"
	}
	return code
}

type bazarrWantedMovie struct {
	Title    string           `json:"title"`
	Missing  []bazarrLanguage `json:"missing_subtitles"`
	RadarrID int64            `json:"radarrId"`
}

type bazarrWantedEpisode struct {
	Series    string           `json:"seriesTitle"`
	Number    string           `json:"episode_number"`
	Title     string           `json:"episodeTitle"`
	Missing   []bazarrLanguage `json:"missing_subtitles"`
	SeriesID  int64            `json:"sonarrSeriesId"`
	EpisodeID int64            `json:"sonarrEpisodeId"`
}

func bazarrLabels(list []bazarrLanguage) []string {
	out := make([]string, 0, len(list))
	for _, lang := range list {
		out = append(out, lang.label())
	}
	return out
}

// bazarrWanted reads both wanted lists. It is used by the missing topic and by
// the totals, which need only the totals of the same answers.
func (h *Handlers) bazarrWanted(ctx context.Context, spec bazarrSpec, credential HealthCredential) ([]MediaSubsMissing, *MediaSubsTotals, error) {
	var movies struct {
		Data  []bazarrWantedMovie `json:"data"`
		Total int                 `json:"total"`
	}
	var episodes struct {
		Data  []bazarrWantedEpisode `json:"data"`
		Total int                   `json:"total"`
	}
	length := strconv.Itoa(spec.Rows)
	var wg sync.WaitGroup
	var movieErr, episodeErr error
	wg.Add(2)
	go func() {
		defer wg.Done()
		movieErr = h.bazarrGet(ctx, spec.Server, credential, "/api/movies/wanted?start=0&length="+length, &movies)
	}()
	go func() {
		defer wg.Done()
		episodeErr = h.bazarrGet(ctx, spec.Server, credential, "/api/episodes/wanted?start=0&length="+length, &episodes)
	}()
	wg.Wait()
	if movieErr != nil && episodeErr != nil {
		return nil, nil, movieErr
	}
	totals := &MediaSubsTotals{MissingMovies: movies.Total, MissingEpisodes: episodes.Total}
	out := make([]MediaSubsMissing, 0, len(movies.Data)+len(episodes.Data))
	for _, movie := range movies.Data {
		out = append(out, MediaSubsMissing{
			ID: "m" + strconv.FormatInt(movie.RadarrID, 10), Kind: "movie", Title: movie.Title,
			Languages: bazarrLabels(movie.Missing),
			OpenURL:   spec.Server + "/movies/" + strconv.FormatInt(movie.RadarrID, 10),
		})
	}
	for _, ep := range episodes.Data {
		out = append(out, MediaSubsMissing{
			ID: "e" + strconv.FormatInt(ep.EpisodeID, 10), Kind: "episode", Title: ep.Series,
			Subtitle:  strings.TrimSpace(ep.Number + " " + ep.Title),
			Languages: bazarrLabels(ep.Missing),
			OpenURL:   spec.Server + "/series/" + strconv.FormatInt(ep.SeriesID, 10),
		})
	}
	if len(out) > spec.Rows {
		out = out[:spec.Rows]
	}
	return out, totals, nil
}

type bazarrHistoryRow struct {
	Action    int            `json:"action"`
	Title     string         `json:"title"`       // movies
	Series    string         `json:"seriesTitle"` // episodes
	Number    string         `json:"episode_number"`
	Episode   string         `json:"episodeTitle"`
	Language  bazarrLanguage `json:"language"`
	Provider  string         `json:"provider"`
	Score     string         `json:"score"`
	Upgraded  bool           `json:"upgradable"`
	Stamp     string         `json:"parsed_timestamp"`
	RadarrID  int64          `json:"radarrId"`
	SeriesID  int64          `json:"sonarrSeriesId"`
	EpisodeID int64          `json:"sonarrEpisodeId"`
	Black     bool           `json:"blacklisted"`
}

// bazarrMs reads Bazarr's own date text (month/day/year) in the server's zone.
func bazarrMs(raw string) int64 {
	if at, err := time.ParseInLocation("01/02/06 15:04:05", raw, time.Local); err == nil {
		return at.UnixMilli()
	}
	return 0
}

func (h *Handlers) bazarrRecent(ctx context.Context, spec bazarrSpec, credential HealthCredential) ([]MediaSubsFetched, error) {
	var movies, episodes struct {
		Data []bazarrHistoryRow `json:"data"`
	}
	length := strconv.Itoa(spec.Rows * 2)
	var wg sync.WaitGroup
	var movieErr, episodeErr error
	wg.Add(2)
	go func() {
		defer wg.Done()
		movieErr = h.bazarrGet(ctx, spec.Server, credential, "/api/movies/history?start=0&length="+length, &movies)
	}()
	go func() {
		defer wg.Done()
		episodeErr = h.bazarrGet(ctx, spec.Server, credential, "/api/episodes/history?start=0&length="+length, &episodes)
	}()
	wg.Wait()
	if movieErr != nil && episodeErr != nil {
		return nil, movieErr
	}
	out := []MediaSubsFetched{}
	add := func(row bazarrHistoryRow, kind string) {
		if !bazarrFetchedActions[row.Action] || row.Black {
			return
		}
		entry := MediaSubsFetched{
			Kind: kind, Language: row.Language.label(), Provider: row.Provider, Score: row.Score,
			Upgrade: row.Action == 3, At: bazarrMs(row.Stamp),
		}
		if kind == "movie" {
			entry.ID = "m" + strconv.FormatInt(row.RadarrID, 10)
			entry.Title = row.Title
			entry.OpenURL = spec.Server + "/movies/" + strconv.FormatInt(row.RadarrID, 10)
		} else {
			entry.ID = "e" + strconv.FormatInt(row.EpisodeID, 10)
			entry.Title = row.Series
			entry.Subtitle = strings.TrimSpace(row.Number + " " + row.Episode)
			entry.OpenURL = spec.Server + "/series/" + strconv.FormatInt(row.SeriesID, 10)
		}
		out = append(out, entry)
	}
	for _, row := range movies.Data {
		add(row, "movie")
	}
	for _, row := range episodes.Data {
		add(row, "episode")
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At > out[j].At })
	if len(out) > spec.Rows {
		out = out[:spec.Rows]
	}
	return out, nil
}

// bazarrProviderIssues is how many providers Bazarr's badges count as in trouble.
func (h *Handlers) bazarrProviderIssues(ctx context.Context, spec bazarrSpec, credential HealthCredential) (int, error) {
	var badges struct {
		Providers int `json:"providers"`
	}
	if err := h.bazarrGet(ctx, spec.Server, credential, "/api/badges", &badges); err != nil {
		return 0, err
	}
	return badges.Providers, nil
}

// fetchBazarr reads every topic the tile asked for.
func (h *Handlers) fetchBazarr(ctx context.Context, spec bazarrSpec) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, nil, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, nil, errMediaNotSetUp
	}
	subs := &MediaSubs{Topics: spec.Topics, OpenURL: spec.Server}
	var firstErr error
	failed := 0
	var mu sync.Mutex
	var wg sync.WaitGroup
	fail := func(err error) {
		mu.Lock()
		defer mu.Unlock()
		failed++
		subs.Partial = true
		if firstErr == nil {
			firstErr = err
		}
	}
	if spec.has("missing") || spec.has("totals") {
		wg.Add(1)
		go func() {
			defer wg.Done()
			missing, totals, err := h.bazarrWanted(ctx, spec, credential)
			if err != nil {
				// Both topics that lean on this answer fail with it.
				mu.Lock()
				if spec.has("missing") {
					failed++
				}
				if spec.has("totals") {
					failed++
				}
				subs.Partial = true
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				return
			}
			mu.Lock()
			if spec.has("missing") {
				subs.Missing = missing
			}
			if spec.has("totals") {
				subs.Totals = totals
			}
			mu.Unlock()
		}()
	}
	if spec.has("totals") {
		wg.Add(1)
		go func() {
			defer wg.Done()
			issues, err := h.bazarrProviderIssues(ctx, spec, credential)
			if err != nil {
				// The totals still show the missing counts; only the providers go.
				mu.Lock()
				subs.Partial = true
				mu.Unlock()
				return
			}
			mu.Lock()
			if subs.Totals == nil {
				subs.Totals = &MediaSubsTotals{}
			}
			subs.Totals.ProviderIssues = issues
			mu.Unlock()
		}()
	}
	if spec.has("recent") {
		wg.Add(1)
		go func() {
			defer wg.Done()
			recent, err := h.bazarrRecent(ctx, spec, credential)
			if err != nil {
				fail(err)
				return
			}
			mu.Lock()
			subs.Recent = recent
			mu.Unlock()
		}()
	}
	wg.Wait()
	// Every topic failing is an error the tile words; some failing is a half
	// answer it shows.
	if failed > 0 && failed >= len(spec.Topics) {
		return result, nil, firstErr
	}
	result.Subs = subs
	result.Partial = subs.Partial
	return result, nil, nil
}

func (h *Handlers) bazarrWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeBazarr, func(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
		spec := bazarrSpecFrom(widget.Config)
		ms := mediaSpec{Service: string(WidgetTypeBazarr), Server: spec.Server, CredentialID: spec.CredentialID,
			Fingerprint: spec.fingerprint(), TTL: spec.TTL}
		return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
			return h.fetchBazarr(ctx, spec)
		}, forced)
	})
}

/*
bazarrSetupHandler tries an address and a key and names the version it found.

Behind the write token, and takes a key that is typed but not yet saved, like
the other media setups: the key is used for this one request and written
nowhere.
*/
func (h *Handlers) bazarrSetupHandler(w http.ResponseWriter, r *http.Request) {
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
			logWarn(logComponentWidgets, "Bazarr setup for %s: %v", hostOf(stringOr(body["server"])), err)
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
		Data struct {
			Version string `json:"bazarr_version"`
		} `json:"data"`
	}
	if err := h.bazarrGet(r.Context(), server, credential, "/api/system/status", &status); err != nil {
		reply(err)
		return
	}
	if status.Data.Version == "" {
		// Something answered, but it is not Bazarr.
		reply(errMediaUnreachable)
		return
	}
	answer.Connected = "Bazarr " + status.Data.Version
	reply(nil)
}
