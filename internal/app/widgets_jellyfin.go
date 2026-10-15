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
The Jellyfin widget: what was added to the media server lately, with pictures.

Fetched here for the reason every outward tile is, and for one of its own: the
key. Jellyfin takes it in a header, and a browser that fetched the list itself
would have to hold it. So the tile reads by widget id, the key stays in the
credential file, and the pictures come through /api/widgets/jellyfin/image --
an <img src> straight at Jellyfin would put the key in every address.

Libraries rather than item types: Jellyfin knows films and series, not anime,
and anime is almost always a library of its own. The library's name is the
label the tile shows.
*/

const (
	jellyfinMaxBody     = 4 << 20
	jellyfinMaxOverview = 400
	jellyfinDefaultRows = 6
	jellyfinDefaultTTL  = 300
)

// JellyfinLibrary is one library a tile can show.
type JellyfinLibrary = MediaGroup

type jellyfinSpec struct {
	Flavor       jellyfinFlavor
	Server       string
	CredentialID string
	UserID       string
	Libraries    []string
	HideWatched  bool
	Rows         int
	TTL          time.Duration
}

func jellyfinSpecFrom(config map[string]any) jellyfinSpec {
	return jellyfinSpecFromFlavor(config, jellyfinFlavorJellyfin)
}

func jellyfinSpecFromFlavor(config map[string]any, flavor jellyfinFlavor) jellyfinSpec {
	spec := jellyfinSpec{
		Flavor:       flavor,
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		UserID:       stringOr(config["userId"]),
		Libraries:    widgetConfigList(config["libraries"], nil),
		HideWatched:  config["hideWatched"] == true,
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

// fingerprint changes whenever a setting changes what Jellyfin is asked, so a
// cached answer is never served for a library choice that has since changed.
func (spec jellyfinSpec) fingerprint() string {
	return strings.Join([]string{
		spec.Flavor.service(), spec.Server, spec.CredentialID, spec.UserID, strings.Join(spec.Libraries, ","),
		strconv.FormatBool(spec.HideWatched), strconv.Itoa(spec.Rows),
	}, "|")
}

// jellyfinMediaCollection keeps films and series; music, books and photos are
// not what this tile is about.
func jellyfinMediaCollection(collectionType string) bool {
	switch strings.ToLower(collectionType) {
	case "", "movies", "tvshows", "mixed", "homevideos":
		return true
	}
	return false
}

func (h *Handlers) jellyfinRequest(ctx context.Context, flavor jellyfinFlavor, server string, credential HealthCredential, path string, query url.Values, accept string) (*http.Response, error) {
	return h.mediaRequest(ctx, server, credential, flavor.Prefix+path, query, accept, func(req *http.Request) {
		/*
		 * The key is also sent the way current Jellyfin reads it.
		 *
		 * Jellyfin 10.11 answers 401 to X-Emby-Token and accepts only
		 * Authorization: MediaBrowser Token="...", while older servers read the
		 * header the panel files the key under. Both go out, so one stored key
		 * works against either. Go drops Authorization itself when a redirect
		 * leaves the host, which is the rule credentialRedirectCheck keeps for the
		 * stored header. Emby reads X-Emby-Token and documents only the full
		 * "Emby Client=..." form of Authorization, so it gets the header alone.
		 */
		if flavor.isEmby() {
			return
		}
		if token := strings.TrimSpace(req.Header.Get("X-Emby-Token")); token != "" && req.Header.Get("Authorization") == "" {
			req.Header.Set("Authorization", `MediaBrowser Token="`+token+`"`)
		}
	})
}

func (h *Handlers) jellyfinGet(ctx context.Context, flavor jellyfinFlavor, server string, credential HealthCredential, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.jellyfinRequest(ctx, flavor, server, credential, path, query, "application/json")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, jellyfinMaxBody)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

type jellyfinRawItem struct {
	ID                      string            `json:"Id"`
	Name                    string            `json:"Name"`
	Type                    string            `json:"Type"`
	ServerID                string            `json:"ServerId"`
	SeriesName              string            `json:"SeriesName"`
	SeriesID                string            `json:"SeriesId"`
	SeriesPrimaryImageTag   string            `json:"SeriesPrimaryImageTag"`
	ParentIndexNumber       int               `json:"ParentIndexNumber"`
	IndexNumber             int               `json:"IndexNumber"`
	ProductionYear          int               `json:"ProductionYear"`
	Genres                  []string          `json:"Genres"`
	RunTimeTicks            int64             `json:"RunTimeTicks"`
	Overview                string            `json:"Overview"`
	DateCreated             string            `json:"DateCreated"`
	ChildCount              int               `json:"ChildCount"`
	ImageTags               map[string]string `json:"ImageTags"`
	BackdropImageTags       []string          `json:"BackdropImageTags"`
	ParentBackdropItemID    string            `json:"ParentBackdropItemId"`
	ParentBackdropImageTags []string          `json:"ParentBackdropImageTags"`
	UserData                struct {
		Played bool `json:"Played"`
	} `json:"UserData"`
	// groupedEpisodes is how many episodes of one series were folded into
	// this line when Jellyfin was not asked to group them.
	groupedEpisodes int
}

func mapJellyfinItem(raw jellyfinRawItem, library JellyfinLibrary, server string, flavor jellyfinFlavor, imageURL func(mediaImageRef) string) (MediaItem, []mediaImageRef) {
	item := MediaItem{
		ID: raw.ID, Title: raw.Name, Kind: strings.ToLower(raw.Type), Year: raw.ProductionYear,
		Genres: raw.Genres, Library: library.Name, LibraryID: library.ID,
		Played: raw.UserData.Played, NewCount: raw.ChildCount,
	}
	if raw.RunTimeTicks > 0 {
		// Ticks are 100 ns: 600,000,000 to the minute.
		item.RuntimeMinutes = int(raw.RunTimeTicks / 600_000_000)
	}
	if overview := strings.TrimSpace(raw.Overview); overview != "" {
		item.Overview = trimToLength(overview, jellyfinMaxOverview)
	}
	if at, err := time.Parse(time.RFC3339Nano, raw.DateCreated); err == nil {
		item.AddedAt = at.UnixMilli()
	}
	if raw.Type == "Episode" {
		item.Title = raw.SeriesName
		item.Subtitle = fmt.Sprintf("S%02dE%02d · %s", raw.ParentIndexNumber, raw.IndexNumber, raw.Name)
	}

	var refs []mediaImageRef
	// An episode's own Primary is a 16:9 still; in a 2:3 frame it is the
	// series poster that reads.
	var poster mediaImageRef
	switch {
	case raw.Type == "Episode" && raw.SeriesID != "" && raw.SeriesPrimaryImageTag != "":
		poster = mediaImageRef{raw.SeriesID, "poster", raw.SeriesPrimaryImageTag}
	case raw.Type != "Episode" && raw.ImageTags["Primary"] != "":
		poster = mediaImageRef{raw.ID, "poster", raw.ImageTags["Primary"]}
	}
	if poster.Item != "" {
		item.Poster = imageURL(poster)
		refs = append(refs, poster)
	}
	var backdrop mediaImageRef
	switch {
	case len(raw.BackdropImageTags) > 0:
		backdrop = mediaImageRef{raw.ID, "backdrop", raw.BackdropImageTags[0]}
	case raw.ParentBackdropItemID != "" && len(raw.ParentBackdropImageTags) > 0:
		backdrop = mediaImageRef{raw.ParentBackdropItemID, "backdrop", raw.ParentBackdropImageTags[0]}
	}
	if backdrop.Item != "" {
		item.Backdrop = imageURL(backdrop)
		refs = append(refs, backdrop)
	}

	item.OpenURL = flavor.openURL(server, raw.ID, raw.ServerID)
	return item, refs
}

// jellyfinPickLibraries keeps the user's media libraries, in the order the
// user sees them in Jellyfin, narrowed to the chosen ones when any are chosen.
// A chosen library that no longer exists is skipped rather than an error.
func jellyfinPickLibraries(views []JellyfinLibrary, chosen []string) []JellyfinLibrary {
	want := map[string]bool{}
	for _, id := range chosen {
		want[id] = true
	}
	var out []JellyfinLibrary
	for _, view := range views {
		if !jellyfinMediaCollection(view.CollectionType) {
			continue
		}
		if len(want) > 0 && !want[view.ID] {
			continue
		}
		out = append(out, view)
	}
	return out
}

func (h *Handlers) fetchJellyfinLatest(ctx context.Context, spec jellyfinSpec, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []JellyfinLibrary{}}
	images := map[mediaImageRef]bool{}
	// The key is enough. A user adds what they may see and what they have
	// watched, and nothing more: without one the server lists every library.
	if spec.Server == "" || spec.CredentialID == "" {
		return result, images, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, images, errMediaNotSetUp
	}

	var all []JellyfinLibrary
	if spec.UserID != "" {
		viewsPath, viewsQuery := spec.Flavor.userViews(spec.UserID)
		var views struct {
			Items []struct {
				ID             string `json:"Id"`
				Name           string `json:"Name"`
				CollectionType string `json:"CollectionType"`
			} `json:"Items"`
		}
		if err := h.jellyfinGet(ctx, spec.Flavor, spec.Server, credential, viewsPath, viewsQuery, &views); err != nil {
			return result, images, err
		}
		for _, view := range views.Items {
			all = append(all, JellyfinLibrary{ID: view.ID, Name: view.Name, CollectionType: view.CollectionType})
		}
	} else {
		var folders []struct {
			Name           string `json:"Name"`
			ItemID         string `json:"ItemId"`
			CollectionType string `json:"CollectionType"`
		}
		if err := h.jellyfinGet(ctx, spec.Flavor, spec.Server, credential, "/Library/VirtualFolders", nil, &folders); err != nil {
			return result, images, err
		}
		for _, folder := range folders {
			all = append(all, JellyfinLibrary{ID: folder.ItemID, Name: folder.Name, CollectionType: folder.CollectionType})
		}
	}
	result.Libraries = jellyfinPickLibraries(all, spec.Libraries)
	if len(result.Libraries) == 0 {
		return result, images, errMediaNoLibraries
	}

	/*
	 * The libraries are asked at the same time.
	 *
	 * One at a time, a big library's list (seconds, on a server with years of
	 * episodes) was added to the next one's, and the whole answer took the sum.
	 * Each keeps its own timeout, and the answers are read in library order so
	 * the result does not depend on which came back first.
	 */
	type libraryAnswer struct {
		raw []jellyfinRawItem
		err error
	}
	answers := make([]libraryAnswer, len(result.Libraries))
	var wg sync.WaitGroup
	for i, library := range result.Libraries {
		wg.Add(1)
		go func(i int, library JellyfinLibrary) {
			defer wg.Done()
			if spec.UserID != "" {
				answers[i].raw, answers[i].err = h.jellyfinLatestForUser(ctx, spec, credential, library)
			} else {
				answers[i].raw, answers[i].err = h.jellyfinRecentWithoutUser(ctx, spec, credential, library)
			}
		}(i, library)
	}
	wg.Wait()

	var firstErr error
	for i, library := range result.Libraries {
		raw := answers[i].raw
		if answers[i].err != nil {
			if firstErr == nil {
				firstErr = answers[i].err
			}
			result.Partial = true
			logWarn(logComponentWidgets, "%s library %s: %v", spec.Flavor.service(), library.Name, answers[i].err)
			continue
		}
		for _, entry := range raw {
			item, refs := mapJellyfinItem(entry, library, spec.Server, spec.Flavor, imageURL)
			// Asked of Jellyfin already; checked again because a grouped
			// series counts as watched only once every episode is.
			if spec.HideWatched && item.Played {
				continue
			}
			if entry.groupedEpisodes > 1 {
				item.NewCount = entry.groupedEpisodes
				item.Subtitle = ""
			}
			result.Items = append(result.Items, item)
			for _, ref := range refs {
				images[ref] = true
			}
		}
	}
	// One library failing is a gap, flagged Partial; all of them failing is
	// the answer.
	if len(result.Items) == 0 && firstErr != nil {
		return result, images, firstErr
	}
	sort.SliceStable(result.Items, func(i, j int) bool {
		return result.Items[i].AddedAt > result.Items[j].AddedAt
	})
	return result, images, nil
}

// jellyfinLatestForUser is Jellyfin's own "latest" for one user: grouped by
// series, and aware of what that user has watched.
func (h *Handlers) jellyfinLatestForUser(ctx context.Context, spec jellyfinSpec, credential HealthCredential, library JellyfinLibrary) ([]jellyfinRawItem, error) {
	path, query := spec.Flavor.latest(spec.UserID)
	query.Set("parentId", library.ID)
	query.Set("limit", strconv.Itoa(spec.Rows))
	query.Set("groupItems", "true")
	query.Set("fields", "Overview,Genres,ProductionYear,DateCreated")
	query.Set("enableImageTypes", "Primary,Backdrop")
	query.Set("imageTypeLimit", "1")
	if spec.HideWatched {
		query.Set("isPlayed", "false")
	}
	var raw []jellyfinRawItem
	err := h.jellyfinGet(ctx, spec.Flavor, spec.Server, credential, path, query, &raw)
	return raw, err
}

/*
jellyfinRecentWithoutUser is what the key alone can ask: the newest films and
episodes of a library, by date added.

Jellyfin's own "latest" is per user, so this does its half of the work here:
episodes of one series become one line, led by the newest, with how many came.
What was watched is a user's, so nothing is known of it and hideWatched has no
effect without one.
*/
func (h *Handlers) jellyfinRecentWithoutUser(ctx context.Context, spec jellyfinSpec, credential HealthCredential, library JellyfinLibrary) ([]jellyfinRawItem, error) {
	query := url.Values{
		"parentId":         {library.ID},
		"recursive":        {"true"},
		"includeItemTypes": {"Movie,Episode"},
		"sortBy":           {"DateCreated"},
		"sortOrder":        {"Descending"},
		// Room for several episodes of the same series before the cut.
		"limit":            {strconv.Itoa(spec.Rows * 6)},
		"fields":           {"Overview,Genres,ProductionYear,DateCreated"},
		"enableImageTypes": {"Primary,Backdrop"},
		"imageTypeLimit":   {"1"},
	}
	var answer struct {
		Items []jellyfinRawItem `json:"Items"`
	}
	if err := h.jellyfinGet(ctx, spec.Flavor, spec.Server, credential, "/Items", query, &answer); err != nil {
		return nil, err
	}
	var out []jellyfinRawItem
	at := map[string]int{}
	for _, entry := range answer.Items {
		if entry.Type == "Episode" && entry.SeriesID != "" {
			if i, seen := at[entry.SeriesID]; seen {
				out[i].groupedEpisodes++
				continue
			}
			at[entry.SeriesID] = len(out)
			entry.groupedEpisodes = 1
		}
		out = append(out, entry)
	}
	if len(out) > spec.Rows {
		out = out[:spec.Rows]
	}
	return out, nil
}

// JellyfinUser is a Jellyfin account the tile can read as.
type JellyfinUser struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// JellyfinSetupAnswer fills the settings panel's choices.
type JellyfinSetupAnswer struct {
	ServerName string            `json:"serverName,omitempty"`
	Version    string            `json:"version,omitempty"`
	Users      []JellyfinUser    `json:"users"`
	Libraries  []JellyfinLibrary `json:"libraries"`
	Error      string            `json:"error,omitempty"`
}

/*
JellyfinSetupHandler tries an address and a key, and lists who and what can
be chosen.

Behind the write token, and takes a key that is typed but not yet saved for the
reason the custom widget's Try does: someone setting the tile up for the first
time is asking about the key on screen. That key is used for these requests and
written nowhere. Libraries come from the server's own list rather than one
user's view, so the panel can offer them before a user is chosen.
*/
func (h *Handlers) JellyfinSetupHandler(w http.ResponseWriter, r *http.Request) {
	h.jellyfinSetup(w, r, jellyfinFlavorJellyfin)
}

// jellyfinSetup is the setup answer for either flavor.
func (h *Handlers) jellyfinSetup(w http.ResponseWriter, r *http.Request, flavor jellyfinFlavor) {
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
	answer := JellyfinSetupAnswer{Users: []JellyfinUser{}, Libraries: []JellyfinLibrary{}}
	reply := func(err error) {
		if err != nil {
			// The panel is told a short code; the cause stays in the log.
			logWarn(logComponentWidgets, "%s setup for %s: %v", flavor.service(), hostOf(stringOr(body["server"])), err)
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
		ServerName string `json:"ServerName"`
		Version    string `json:"Version"`
	}
	if err := h.jellyfinGet(r.Context(), flavor, server, credential, "/System/Info", nil, &info); err != nil {
		reply(err)
		return
	}
	answer.ServerName, answer.Version = info.ServerName, info.Version

	var users []struct {
		ID   string `json:"Id"`
		Name string `json:"Name"`
	}
	if err := h.jellyfinGet(r.Context(), flavor, server, credential, "/Users", nil, &users); err != nil {
		reply(err)
		return
	}
	for _, user := range users {
		answer.Users = append(answer.Users, JellyfinUser{ID: user.ID, Name: user.Name})
	}

	var folders []struct {
		Name           string `json:"Name"`
		ItemID         string `json:"ItemId"`
		CollectionType string `json:"CollectionType"`
	}
	if err := h.jellyfinGet(r.Context(), flavor, server, credential, "/Library/VirtualFolders", nil, &folders); err != nil {
		reply(err)
		return
	}
	for _, folder := range folders {
		if jellyfinMediaCollection(folder.CollectionType) {
			answer.Libraries = append(answer.Libraries, JellyfinLibrary{
				ID: folder.ItemID, Name: folder.Name, CollectionType: folder.CollectionType,
			})
		}
	}
	reply(nil)
}
