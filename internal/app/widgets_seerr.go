package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Seerr (Overseerr, Jellyseerr): what was asked for, by whom, and whether it has
arrived.

A request names a film or series only by its TMDB id, so each line costs one
more question to Seerr for the title and the picture paths -- asked four at a
time, for no more lines than the tile shows. The pictures themselves live at
TMDB, not on the Seerr server: the proxy fetches them from image.tmdb.org, a
fixed public address, without any key, so the browser still never talks to a
third party and the Seerr key never leaves for one.
*/

const (
	seerrDefaultRows = 6
	seerrDefaultTTL  = 300
	// seerrDetailsAtOnce bounds the title lookups running together.
	seerrDetailsAtOnce = 4
)

// tmdbImageBase is where TMDB serves pictures; a variable so tests can point
// it at a stand-in.
var tmdbImageBase = "https://image.tmdb.org"

// tmdbFileName is all a TMDB picture path may be: one file name.
var tmdbFileName = regexp.MustCompile(`^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$`)

type seerrSpec struct {
	Server       string
	CredentialID string
	Status       string
	RequestedBy  string
	MediaType    string
	Rows         int
	TTL          time.Duration
}

func seerrSpecFrom(config map[string]any) seerrSpec {
	spec := seerrSpec{
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		Status:       stringOr(config["status"]),
		RequestedBy:  stringOr(config["requestedBy"]),
		MediaType:    stringOr(config["mediaType"]),
		Rows:         seerrDefaultRows,
		TTL:          seerrDefaultTTL * time.Second,
	}
	if spec.Status == "" {
		spec.Status = "all"
	}
	if spec.MediaType == "" {
		spec.MediaType = "both"
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, 60, 3600)) * time.Second
	}
	return spec
}

func (spec seerrSpec) fingerprint() string {
	return strings.Join([]string{spec.Server, spec.CredentialID, spec.Status, spec.RequestedBy,
		spec.MediaType, strconv.Itoa(spec.Rows)}, "|")
}

type seerrUser struct {
	ID          int    `json:"id"`
	DisplayName string `json:"displayName"`
}

type seerrRequest struct {
	ID          int       `json:"id"`
	Status      int       `json:"status"`
	Type        string    `json:"type"`
	CreatedAt   string    `json:"createdAt"`
	RequestedBy seerrUser `json:"requestedBy"`
	Media       struct {
		TmdbID int `json:"tmdbId"`
		Status int `json:"status"`
	} `json:"media"`
}

type seerrDetails struct {
	Title        string `json:"title"`
	Name         string `json:"name"`
	ReleaseDate  string `json:"releaseDate"`
	FirstAirDate string `json:"firstAirDate"`
	Overview     string `json:"overview"`
	PosterPath   string `json:"posterPath"`
	BackdropPath string `json:"backdropPath"`
	Runtime      int    `json:"runtime"`
	Genres       []struct {
		Name string `json:"name"`
	} `json:"genres"`
}

// The three tabs a request can sit under.
var (
	seerrPending   = MediaGroup{ID: "pending", Name: "Pending"}
	seerrApproved  = MediaGroup{ID: "approved", Name: "Approved"}
	seerrAvailable = MediaGroup{ID: "available", Name: "Available"}
)

/*
seerrGroup sorts a request into a tab.

Waiting for a decision is pending; the film or series being there (media
status 5, or 4 for a partly available series) is available, whatever the
request says; anything else that was approved or completed is on its way.
Declined and failed requests are left out -- nothing is coming.
*/
func seerrGroup(r seerrRequest) (MediaGroup, bool) {
	switch {
	case r.Status == 1:
		return seerrPending, true
	case r.Media.Status == 5 || r.Media.Status == 4:
		return seerrAvailable, true
	case r.Status == 2 || r.Status == 5:
		return seerrApproved, true
	}
	return MediaGroup{}, false
}

// tmdbImageRef turns a TMDB path into a picture the proxy may fetch. Only a
// bare file name is accepted; the file name is its own tag, since TMDB gives
// changed artwork a new name.
func tmdbImageRef(path, kind string) (mediaImageRef, bool) {
	if !strings.HasPrefix(path, "/") {
		return mediaImageRef{}, false
	}
	file := strings.TrimPrefix(path, "/")
	if !tmdbFileName.MatchString(file) {
		return mediaImageRef{}, false
	}
	return mediaImageRef{Item: file, Kind: kind, Tag: file}, true
}

func (h *Handlers) seerrGet(ctx context.Context, server string, credential HealthCredential, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, path, query, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, jellyfinMaxBody)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

func (h *Handlers) fetchSeerr(ctx context.Context, spec seerrSpec, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
	images := map[mediaImageRef]bool{}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, images, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, images, errMediaNotSetUp
	}

	switch spec.Status {
	case "pending":
		result.Libraries = []MediaGroup{seerrPending}
	case "approved":
		result.Libraries = []MediaGroup{seerrApproved}
	case "available":
		result.Libraries = []MediaGroup{seerrAvailable}
	default:
		result.Libraries = []MediaGroup{seerrPending, seerrApproved, seerrAvailable}
	}

	// More than shown, so filtering by type or requester here still fills
	// the tile; the filters are applied here because not every Seerr version
	// takes them as parameters.
	take := spec.Rows * 3 * len(result.Libraries)
	if take > 100 {
		take = 100
	}
	query := url.Values{
		"take":   {strconv.Itoa(take)},
		"skip":   {"0"},
		"sort":   {"added"},
		"filter": {spec.Status},
	}
	var page struct {
		Results []seerrRequest `json:"results"`
	}
	if err := h.seerrGet(ctx, spec.Server, credential, "/api/v1/request", query, &page); err != nil {
		return result, images, err
	}

	type line struct {
		request seerrRequest
		group   MediaGroup
	}
	// Rows per tab, as Jellyfin gives them per library: the newest requests
	// all having arrived must not leave the other tabs empty.
	perGroup := map[string]int{}
	var lines []line
	for _, r := range page.Results {
		if spec.MediaType != "both" && r.Type != spec.MediaType {
			continue
		}
		if spec.RequestedBy != "" && strconv.Itoa(r.RequestedBy.ID) != spec.RequestedBy {
			continue
		}
		group, ok := seerrGroup(r)
		if !ok || perGroup[group.ID] >= spec.Rows {
			continue
		}
		perGroup[group.ID]++
		lines = append(lines, line{r, group})
	}

	// Titles and pictures, a few at a time. A line whose details fail stays,
	// named by its number: the request is real even when TMDB has lost it.
	details := make([]*seerrDetails, len(lines))
	limit := make(chan struct{}, seerrDetailsAtOnce)
	var wg sync.WaitGroup
	for i, l := range lines {
		if l.request.Media.TmdbID == 0 || (l.request.Type != "movie" && l.request.Type != "tv") {
			continue
		}
		wg.Add(1)
		go func(i int, r seerrRequest) {
			defer wg.Done()
			limit <- struct{}{}
			defer func() { <-limit }()
			var d seerrDetails
			path := "/api/v1/" + r.Type + "/" + strconv.Itoa(r.Media.TmdbID)
			if err := h.seerrGet(ctx, spec.Server, credential, path, nil, &d); err == nil {
				details[i] = &d
			}
		}(i, l.request)
	}
	wg.Wait()

	for i, l := range lines {
		r := l.request
		item := MediaItem{
			ID:        "r" + strconv.Itoa(r.ID),
			Title:     "Request #" + strconv.Itoa(r.ID),
			Kind:      r.Type,
			Library:   l.group.Name,
			LibraryID: l.group.ID,
		}
		if r.RequestedBy.DisplayName != "" {
			item.Subtitle = "requested by " + r.RequestedBy.DisplayName
		}
		if at, err := time.Parse(time.RFC3339Nano, r.CreatedAt); err == nil {
			item.AddedAt = at.UnixMilli()
		}
		if r.Media.TmdbID > 0 {
			item.OpenURL = spec.Server + "/" + r.Type + "/" + strconv.Itoa(r.Media.TmdbID)
		}
		if d := details[i]; d != nil {
			if title := strings.TrimSpace(d.Title + d.Name); title != "" {
				item.Title = title
			}
			date := d.ReleaseDate
			if date == "" {
				date = d.FirstAirDate
			}
			if len(date) >= 4 {
				item.Year, _ = strconv.Atoi(date[:4])
			}
			if d.Overview != "" {
				item.Overview = trimToLength(strings.TrimSpace(d.Overview), jellyfinMaxOverview)
			}
			item.RuntimeMinutes = d.Runtime
			for _, g := range d.Genres {
				item.Genres = append(item.Genres, g.Name)
			}
			if ref, ok := tmdbImageRef(d.PosterPath, "poster"); ok {
				item.Poster = imageURL(ref)
				images[ref] = true
			}
			if ref, ok := tmdbImageRef(d.BackdropPath, "backdrop"); ok {
				item.Backdrop = imageURL(ref)
				images[ref] = true
			}
		}
		result.Items = append(result.Items, item)
	}
	sort.SliceStable(result.Items, func(i, j int) bool { return result.Items[i].AddedAt > result.Items[j].AddedAt })
	return result, images, nil
}

// fetchTMDBImage fetches a poster or backdrop from TMDB itself, with no
// credential: the Seerr key is for Seerr, and TMDB's pictures are public.
func (h *Handlers) fetchTMDBImage(ctx context.Context, _ string, _ HealthCredential, ref mediaImageRef) ([]byte, error) {
	if !tmdbFileName.MatchString(ref.Item) {
		return nil, errMediaNotAllowed
	}
	size := "w342"
	if ref.Kind == "backdrop" {
		size = "w780"
	}
	resp, err := h.mediaRequest(ctx, tmdbImageBase, HealthCredential{}, "/t/p/"+size+"/"+ref.Item, nil, "image/*", nil)
	if err != nil {
		return nil, err
	}
	return readMediaImage(resp)
}

// seerrSetupHandler tries an address and a key, and lists who can be chosen
// as the requester.
func (h *Handlers) seerrSetupHandler(w http.ResponseWriter, r *http.Request) {
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
		ServerName string         `json:"serverName,omitempty"`
		Version    string         `json:"version,omitempty"`
		Users      []JellyfinUser `json:"users"`
		Error      string         `json:"error,omitempty"`
	}{Users: []JellyfinUser{}}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "Seerr setup for %s: %v", hostOf(stringOr(body["server"])), err)
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

	// The user list needs the key, so it is also what proves the key: status
	// and the public settings answer anyone.
	var users struct {
		Results []seerrUser `json:"results"`
	}
	if err := h.seerrGet(r.Context(), server, credential, "/api/v1/user", url.Values{"take": {"100"}}, &users); err != nil {
		reply(err)
		return
	}
	for _, u := range users.Results {
		answer.Users = append(answer.Users, JellyfinUser{ID: strconv.Itoa(u.ID), Name: u.DisplayName})
	}
	var status struct {
		Version string `json:"version"`
	}
	_ = h.seerrGet(r.Context(), server, credential, "/api/v1/status", nil, &status)
	var public struct {
		ApplicationTitle string `json:"applicationTitle"`
	}
	_ = h.seerrGet(r.Context(), server, credential, "/api/v1/settings/public", nil, &public)
	answer.Version = status.Version
	answer.ServerName = public.ApplicationTitle
	if answer.ServerName == "" {
		answer.ServerName = "Seerr"
	}
	reply(nil)
}

// seerrAnswer is one Seerr tile's answer, through the shared media cache.
func (h *Handlers) seerrAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	spec := seerrSpecFrom(widget.Config)
	ms := mediaSpec{Service: "seerr", Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		return h.fetchSeerr(ctx, spec, imageURL)
	}, forced)
}

func (h *Handlers) seerrWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeSeerr, h.seerrAnswer)
}

func (h *Handlers) seerrImageHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaImage(w, r, "seerr", h.fetchTMDBImage)
}
