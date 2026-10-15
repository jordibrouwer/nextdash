package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
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
The Plex widgets: Plex read through Tautulli.

Plex's own API wants a token that opens the whole account, and answers in a
shape that differs by endpoint. Tautulli already watches the server, holds an
API key that only reads, and answers every command in one envelope, so the
tiles ask Tautulli. The key goes in X-Api-Key, kept in the credential file like
every other key; the pictures come through /api/widgets/plex/image so that an
<img src> never carries it.

Tautulli sends most numbers as strings and now and then as numbers, so every
number and id is read leniently.
*/

const (
	plexMaxBody          = 4 << 20
	plexPlayingDefaultTT = 10 * time.Second
)

// plexNumber is a number Tautulli may send as a number or as a string.
type plexNumber int64

func (n *plexNumber) UnmarshalJSON(raw []byte) error {
	text := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	*n = 0
	if value, err := strconv.ParseFloat(strings.TrimSpace(text), 64); err == nil {
		*n = plexNumber(value)
	}
	return nil
}

// plexText is an id Tautulli may send as a string or as a number.
type plexText string

func (t *plexText) UnmarshalJSON(raw []byte) error {
	text := strings.TrimSpace(string(raw))
	*t = ""
	if text == "null" {
		return nil
	}
	if strings.HasPrefix(text, `"`) {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil
		}
		*t = plexText(strings.TrimSpace(s))
		return nil
	}
	if value, err := strconv.ParseFloat(text, 64); err == nil {
		*t = plexText(strconv.FormatInt(int64(value), 10))
	}
	return nil
}

type plexSpec struct {
	Server       string
	CredentialID string
	Libraries    []string
	Rows         int
	TTL          time.Duration
}

func plexSpecFrom(config map[string]any) plexSpec {
	spec := plexSpec{
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		Libraries:    widgetConfigList(config["libraries"], nil),
		Rows:         jellyfinDefaultRows,
		TTL:          jellyfinDefaultTTL * time.Second,
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, 60, 3600)) * time.Second
	}
	return spec
}

// fingerprint changes whenever a setting changes what Tautulli is asked.
func (spec plexSpec) fingerprint() string {
	return strings.Join([]string{"plex", spec.Server, spec.CredentialID,
		strings.Join(spec.Libraries, ","), strconv.Itoa(spec.Rows)}, "|")
}

type plexPlayingSpec struct {
	Server       string
	CredentialID string
	HideNames    bool
	Rows         int
	TTL          time.Duration
}

func plexPlayingSpecFrom(config map[string]any) plexPlayingSpec {
	spec := plexPlayingSpec{
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		HideNames:    config["hideNames"] == true,
		Rows:         jellyfinDefaultRows,
		TTL:          plexPlayingDefaultTT,
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, 5, 300)) * time.Second
	}
	return spec
}

func (spec plexPlayingSpec) fingerprint() string {
	return strings.Join([]string{"plex-playing", spec.Server, spec.CredentialID,
		strconv.FormatBool(spec.HideNames), strconv.Itoa(spec.Rows)}, "|")
}

// plexGet runs one Tautulli command and decodes its data into out. A result
// other than success is the key being refused, whatever the message says.
func (h *Handlers) plexGet(ctx context.Context, server string, credential HealthCredential, cmd string, params url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	query := url.Values{"cmd": {cmd}}
	for key, values := range params {
		query[key] = values
	}
	resp, err := h.mediaRequest(ctx, server, credential, "/api/v2", query, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var envelope struct {
		Response struct {
			Result  string          `json:"result"`
			Message any             `json:"message"`
			Data    json.RawMessage `json:"data"`
		} `json:"response"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, plexMaxBody)).Decode(&envelope); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	if envelope.Response.Result != "success" {
		return fmt.Errorf("%w: %s: %v", errMediaRefused, cmd, envelope.Response.Message)
	}
	if out == nil || len(bytes.TrimSpace(envelope.Response.Data)) == 0 {
		return nil
	}
	if err := json.Unmarshal(envelope.Response.Data, out); err != nil {
		return fmt.Errorf("%w: %s: %v", errMediaUnreachable, cmd, err)
	}
	return nil
}

type plexRawLibrary struct {
	SectionID   plexText `json:"section_id"`
	SectionName string   `json:"section_name"`
	SectionType string   `json:"section_type"`
}

// plexLibraries lists the libraries a tile can show: films and series. Music
// and photos are not what these tiles are about.
func (h *Handlers) plexLibraries(ctx context.Context, server string, credential HealthCredential) ([]MediaGroup, error) {
	var raw []plexRawLibrary
	if err := h.plexGet(ctx, server, credential, "get_library_names", nil, &raw); err != nil {
		return nil, err
	}
	out := []MediaGroup{}
	for _, library := range raw {
		switch strings.ToLower(library.SectionType) {
		case "movie", "show":
			out = append(out, MediaGroup{ID: string(library.SectionID), Name: library.SectionName,
				CollectionType: strings.ToLower(library.SectionType)})
		}
	}
	return out, nil
}

// plexServerID is the id Plex's web app addresses a server by. Without it the
// tiles still work and simply have no link, so a failure is not an error.
//
// The id never changes, and a now-playing tile asks every few seconds, so it
// is kept an hour per address and key; a failure is kept a minute, which also
// keeps the warning from repeating every beat.
func (h *Handlers) plexServerID(ctx context.Context, server string, credential HealthCredential) string {
	sum := sha256.Sum256([]byte(server + "\x00" + credential.Headers["X-Api-Key"]))
	key := hex.EncodeToString(sum[:8])
	plexServerIDs.mu.Lock()
	if known, ok := plexServerIDs.ids[key]; ok && time.Now().Before(known.until) {
		plexServerIDs.mu.Unlock()
		return known.id
	}
	plexServerIDs.mu.Unlock()

	var info struct {
		Identifier plexText `json:"pms_identifier"`
	}
	id, keep := "", time.Minute
	if err := h.plexGet(ctx, server, credential, "get_server_info", nil, &info); err != nil {
		logWarn(logComponentWidgets, "plex server info for %s: %v", hostOf(server), err)
	} else {
		id, keep = string(info.Identifier), time.Hour
	}
	plexServerIDs.mu.Lock()
	plexServerIDs.ids[key] = plexKnownServer{id: id, until: time.Now().Add(keep)}
	plexServerIDs.mu.Unlock()
	return id
}

type plexKnownServer struct {
	id    string
	until time.Time
}

var plexServerIDs = struct {
	mu  sync.Mutex
	ids map[string]plexKnownServer
}{ids: map[string]plexKnownServer{}}

func plexOpenURL(serverID, ratingKey string) string {
	if serverID == "" || ratingKey == "" {
		return ""
	}
	return "https://app.plex.tv/desktop/#!/server/" + url.PathEscape(serverID) +
		"/details?key=" + url.QueryEscape("/library/metadata/"+ratingKey)
}

func plexFirst(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func plexPoster(thumb, tag string, imageURL func(mediaImageRef) string) (string, []mediaImageRef) {
	if thumb == "" {
		return "", nil
	}
	ref := mediaImageRef{Item: thumb, Kind: "poster", Tag: plexFirst(tag, "1")}
	return imageURL(ref), []mediaImageRef{ref}
}

type plexRecent struct {
	RatingKey            plexText   `json:"rating_key"`
	ParentRatingKey      plexText   `json:"parent_rating_key"`
	GrandparentRatingKey plexText   `json:"grandparent_rating_key"`
	MediaType            string     `json:"media_type"`
	Title                string     `json:"title"`
	ParentTitle          string     `json:"parent_title"`
	GrandparentTitle     string     `json:"grandparent_title"`
	MediaIndex           plexNumber `json:"media_index"`
	ParentMediaIndex     plexNumber `json:"parent_media_index"`
	Year                 plexNumber `json:"year"`
	AddedAt              plexNumber `json:"added_at"`
	Thumb                string     `json:"thumb"`
	ParentThumb          string     `json:"parent_thumb"`
	GrandparentThumb     string     `json:"grandparent_thumb"`
	Genres               []string   `json:"genres"`
	Summary              string     `json:"summary"`
	Duration             plexNumber `json:"duration"`
}

// plexMapRecent turns one library's recent additions into lines. Episodes and
// seasons of one show become one line, led by the newest, with how many came,
// as the Jellyfin tile does.
func plexMapRecent(raws []plexRecent, library MediaGroup, serverID string, imageURL func(mediaImageRef) string, images map[mediaImageRef]bool) []MediaItem {
	type line struct {
		item   MediaItem
		count  int
		season bool // a whole season is in the line, so count is not what is new
		raw    plexRecent
	}
	var lines []*line
	shows := map[string]*line{}
	for _, raw := range raws {
		added := int64(raw.AddedAt) * 1000
		if raw.MediaType == "episode" || raw.MediaType == "season" {
			key := plexFirst(string(raw.GrandparentRatingKey), string(raw.ParentRatingKey), string(raw.RatingKey))
			if raw.MediaType == "episode" {
				key = plexFirst(string(raw.GrandparentRatingKey), string(raw.RatingKey))
			}
			if seen, ok := shows[key]; ok {
				seen.count++
				seen.season = seen.season || raw.MediaType == "season"
				if added > seen.item.AddedAt {
					seen.item.AddedAt = added
				}
				continue
			}
			l := &line{count: 1, season: raw.MediaType == "season", raw: raw, item: MediaItem{
				ID: string(raw.RatingKey), Kind: raw.MediaType, Library: library.Name, LibraryID: library.ID,
				AddedAt: added,
			}}
			shows[key] = l
			lines = append(lines, l)
			continue
		}
		lines = append(lines, &line{count: 1, raw: raw, item: MediaItem{
			ID: string(raw.RatingKey), Kind: plexKind(raw.MediaType), Library: library.Name, LibraryID: library.ID,
			AddedAt: added,
		}})
	}

	out := make([]MediaItem, 0, len(lines))
	for _, l := range lines {
		raw, item := l.raw, l.item
		var refs []mediaImageRef
		if raw.MediaType == "episode" || raw.MediaType == "season" {
			item.Title = plexFirst(raw.GrandparentTitle, raw.ParentTitle, raw.Title)
			key := plexFirst(string(raw.GrandparentRatingKey), string(raw.ParentRatingKey), string(raw.RatingKey))
			thumb := plexFirst(raw.GrandparentThumb, raw.ParentThumb, raw.Thumb)
			if raw.MediaType == "episode" {
				item.Title = plexFirst(raw.GrandparentTitle, raw.Title)
				key = plexFirst(string(raw.GrandparentRatingKey), string(raw.RatingKey))
				thumb = plexFirst(raw.GrandparentThumb, raw.Thumb)
			}
			if l.count > 1 {
				item.Kind, item.ID = "episode", key
				if !l.season {
					item.NewCount = l.count
				}
				item.OpenURL = plexOpenURL(serverID, key)
			} else {
				if raw.MediaType == "episode" {
					item.Subtitle = fmt.Sprintf("S%02dE%02d · %s", raw.ParentMediaIndex, raw.MediaIndex, raw.Title)
				} else {
					item.Subtitle = raw.Title
				}
				item.OpenURL = plexOpenURL(serverID, string(raw.RatingKey))
			}
			item.Poster, refs = plexPoster(thumb, key, imageURL)
		} else {
			item.Title = raw.Title
			item.Year = int(raw.Year)
			item.OpenURL = plexOpenURL(serverID, string(raw.RatingKey))
			item.Poster, refs = plexPoster(raw.Thumb, string(raw.RatingKey), imageURL)
		}
		item.Genres = raw.Genres
		item.Year = int(raw.Year)
		if raw.Duration > 0 {
			item.RuntimeMinutes = int(int64(raw.Duration) / 60_000)
		}
		if overview := strings.TrimSpace(raw.Summary); overview != "" {
			item.Overview = trimToLength(overview, jellyfinMaxOverview)
		}
		for _, ref := range refs {
			images[ref] = true
		}
		out = append(out, item)
	}
	return out
}

func plexKind(mediaType string) string {
	if mediaType == "show" {
		return "series"
	}
	return strings.ToLower(mediaType)
}

func (h *Handlers) fetchPlexLatest(ctx context.Context, spec plexSpec, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
	images := map[mediaImageRef]bool{}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, images, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, images, errMediaNotSetUp
	}
	all, err := h.plexLibraries(ctx, spec.Server, credential)
	if err != nil {
		return result, images, err
	}
	want := map[string]bool{}
	for _, id := range spec.Libraries {
		want[id] = true
	}
	for _, library := range all {
		if len(want) == 0 || want[library.ID] {
			result.Libraries = append(result.Libraries, library)
		}
	}
	if len(result.Libraries) == 0 {
		return result, images, errMediaNoLibraries
	}
	serverID := h.plexServerID(ctx, spec.Server, credential)

	// The libraries are asked at the same time, each with its own timeout, and
	// read in library order so the result does not depend on who came back first.
	type libraryAnswer struct {
		raw []plexRecent
		err error
	}
	answers := make([]libraryAnswer, len(result.Libraries))
	var wg sync.WaitGroup
	for i, library := range result.Libraries {
		wg.Add(1)
		go func(i int, library MediaGroup) {
			defer wg.Done()
			var data struct {
				RecentlyAdded []plexRecent `json:"recently_added"`
			}
			// Room for several episodes of the same show before the cut.
			answers[i].err = h.plexGet(ctx, spec.Server, credential, "get_recently_added", url.Values{
				"count": {strconv.Itoa(spec.Rows * 6)}, "section_id": {library.ID},
			}, &data)
			answers[i].raw = data.RecentlyAdded
		}(i, library)
	}
	wg.Wait()

	var firstErr error
	for i, library := range result.Libraries {
		if answers[i].err != nil {
			if firstErr == nil {
				firstErr = answers[i].err
			}
			result.Partial = true
			logWarn(logComponentWidgets, "plex library %s: %v", library.Name, answers[i].err)
			continue
		}
		result.Items = append(result.Items, plexMapRecent(answers[i].raw, library, serverID, imageURL, images)...)
	}
	if len(result.Items) == 0 && firstErr != nil {
		return result, images, firstErr
	}
	sort.SliceStable(result.Items, func(i, j int) bool {
		return result.Items[i].AddedAt > result.Items[j].AddedAt
	})
	if len(result.Items) > spec.Rows {
		result.Items = result.Items[:spec.Rows]
	}
	return result, images, nil
}

type plexRawSession struct {
	SessionKey           plexText   `json:"session_key"`
	State                string     `json:"state"`
	FriendlyName         string     `json:"friendly_name"`
	Player               string     `json:"player"`
	Product              string     `json:"product"`
	MediaType            string     `json:"media_type"`
	Title                string     `json:"title"`
	GrandparentTitle     string     `json:"grandparent_title"`
	Year                 plexNumber `json:"year"`
	ParentMediaIndex     plexNumber `json:"parent_media_index"`
	MediaIndex           plexNumber `json:"media_index"`
	RatingKey            plexText   `json:"rating_key"`
	GrandparentRatingKey plexText   `json:"grandparent_rating_key"`
	ViewOffset           plexNumber `json:"view_offset"`
	Duration             plexNumber `json:"duration"`
	TranscodeDecision    string     `json:"transcode_decision"`
	Thumb                string     `json:"thumb"`
	GrandparentThumb     string     `json:"grandparent_thumb"`
	Live                 plexNumber `json:"live"`
}

// fetchPlexPlaying lists what plays right now. Nobody watching is an empty
// answer, not an error.
func (h *Handlers) fetchPlexPlaying(ctx context.Context, spec plexPlayingSpec, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}}
	images := map[mediaImageRef]bool{}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, images, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, images, errMediaNotSetUp
	}
	var activity struct {
		Sessions []plexRawSession `json:"sessions"`
	}
	if err := h.plexGet(ctx, spec.Server, credential, "get_activity", nil, &activity); err != nil {
		return result, images, err
	}
	sessions := activity.Sessions
	if len(sessions) == 0 {
		return result, images, nil
	}
	serverID := h.plexServerID(ctx, spec.Server, credential)

	// Playing before paused, then by name and id: lines keep their place
	// between refreshes, whatever order Tautulli answers in.
	sort.SliceStable(sessions, func(i, j int) bool {
		a, b := sessions[i], sessions[j]
		if ap, bp := a.State == "paused", b.State == "paused"; ap != bp {
			return !ap
		}
		if an, bn := strings.ToLower(a.FriendlyName), strings.ToLower(b.FriendlyName); an != bn {
			return an < bn
		}
		return a.SessionKey < b.SessionKey
	})
	for _, session := range sessions {
		if len(result.Items) >= spec.Rows {
			break
		}
		live := session.Live != 0 || session.MediaType == "live"
		item := MediaItem{
			ID: string(session.SessionKey), Title: session.Title, Kind: plexKind(session.MediaType),
			Year: int(session.Year), OpenURL: plexOpenURL(serverID, string(session.RatingKey)),
		}
		thumb, tag := session.Thumb, string(session.RatingKey)
		switch {
		case live:
			item.Kind = "tv"
		case session.MediaType == "episode":
			item.Title = plexFirst(session.GrandparentTitle, session.Title)
			item.Subtitle = fmt.Sprintf("S%02dE%02d · %s", session.ParentMediaIndex, session.MediaIndex, session.Title)
			if session.GrandparentThumb != "" {
				thumb = session.GrandparentThumb
			}
		case session.MediaType == "track":
			item.Subtitle = session.GrandparentTitle
		}
		// The players are named after their owner ("Jordi's iPhone"), so
		// hidden names say only which app it is.
		item.Device = session.Player
		if item.Device == "" || spec.HideNames {
			item.Device = session.Product
		}
		if !spec.HideNames {
			item.Who = session.FriendlyName
		}
		item.Method = "direct"
		if session.TranscodeDecision == "transcode" {
			item.Method = "transcode"
		}
		item.Paused = session.State == "paused"
		if !live && session.Duration > 0 {
			share := clampFloat(float64(session.ViewOffset)/float64(session.Duration), 0, 1, 0)
			item.Progress = &share
			if left := int64(session.Duration) - int64(session.ViewOffset); left > 0 {
				item.Remaining = left / 1000
			}
		}
		var refs []mediaImageRef
		item.Poster, refs = plexPoster(thumb, tag, imageURL)
		for _, ref := range refs {
			images[ref] = true
		}
		result.Items = append(result.Items, item)
	}
	return result, images, nil
}

// PlexSetupAnswer fills the settings panel's choices.
type PlexSetupAnswer struct {
	ServerName string       `json:"serverName,omitempty"`
	Version    string       `json:"version,omitempty"`
	Libraries  []MediaGroup `json:"libraries"`
	Error      string       `json:"error,omitempty"`
}

/*
PlexSetupHandler tries Tautulli's address and key, and lists the libraries that
can be chosen.

Behind the write token, and takes a key that is typed but not yet saved, as the
Jellyfin one does. That key is used for these requests and written nowhere.
*/
func (h *Handlers) PlexSetupHandler(w http.ResponseWriter, r *http.Request) {
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
	answer := PlexSetupAnswer{Libraries: []MediaGroup{}}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "plex setup for %s: %v", hostOf(stringOr(body["server"])), err)
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

	var info struct {
		Name    string `json:"pms_name"`
		Version string `json:"pms_version"`
	}
	if err := h.plexGet(r.Context(), server, credential, "get_server_info", nil, &info); err != nil {
		reply(err)
		return
	}
	answer.ServerName, answer.Version = info.Name, info.Version
	libraries, err := h.plexLibraries(r.Context(), server, credential)
	if err != nil {
		reply(err)
		return
	}
	answer.Libraries = libraries
	reply(nil)
}

// fetchPlexImage asks Tautulli for a poster, scaled down by Plex itself so the
// proxy never carries a full-size original.
func (h *Handlers) fetchPlexImage(ctx context.Context, server string, credential HealthCredential, ref mediaImageRef) ([]byte, error) {
	query := url.Values{"cmd": {"pms_image_proxy"}, "img": {ref.Item}, "width": {"300"}, "height": {"450"}, "fallback": {"poster"}}
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, "/api/v2", query, "image/*", nil)
	if err != nil {
		return nil, err
	}
	return readMediaImage(resp)
}
