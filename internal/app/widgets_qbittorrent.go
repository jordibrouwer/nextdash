package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

/*
qBittorrent: what is downloading, paused and finished, through the WebUI API.

It signs in with a username and password for a cookie (the stored credential's
Session; mediaRequest keeps the cookie and signs in again when it lapses), or,
from 5.2, takes an API key as a Bearer header. The list is asked for whole and
grouped here: qBittorrent's own filters changed names in 5.0 (paused became
stopped), and grouping by state reads both.
*/

// qbittorrentEtaUnknown is the eta qBittorrent gives when it cannot tell.
const qbittorrentEtaUnknown = 8640000

type qbittorrentTorrent struct {
	Hash     string  `json:"hash"`
	Name     string  `json:"name"`
	State    string  `json:"state"`
	Progress float64 `json:"progress"`
	Eta      int64   `json:"eta"`
	Size     int64   `json:"size"`
	DLSpeed  int64   `json:"dlspeed"`
	UpSpeed  int64   `json:"upspeed"`
	Category string  `json:"category"`
	AddedOn  int64   `json:"added_on"`
}

// qbittorrentGroup sorts a torrent state into a tab. A state this does not
// know yet is counted as busy rather than hidden.
func qbittorrentGroup(state string) MediaGroup {
	switch state {
	case "pausedDL", "stoppedDL", "error", "missingFiles":
		return downloadPaused
	case "uploading", "stalledUP", "queuedUP", "forcedUP", "checkingUP", "pausedUP", "stoppedUP":
		return downloadDone
	}
	return downloadActive
}

func (h *Handlers) qbittorrentGet(ctx context.Context, server string, credential HealthCredential, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, path, query, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if text, ok := out.(*string); ok {
		raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		if err != nil {
			return fmt.Errorf("%w: %v", errMediaUnreachable, err)
		}
		*text = strings.TrimSpace(string(raw))
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, jellyfinMaxBody)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

func (h *Handlers) fetchQBittorrent(ctx context.Context, spec downloadSpec) (MediaResult, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: spec.groups()}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, errMediaNotSetUp
	}

	order := map[string]string{"added": "added_on", "progress": "progress", "speed": "dlspeed"}[spec.Sort]
	query := url.Values{"sort": {order}, "reverse": {"true"}}
	if spec.Category != "" {
		query.Set("category", spec.Category)
	}
	// One after the other: the first signs in, the second uses its session.
	var torrents []qbittorrentTorrent
	if err := h.qbittorrentGet(ctx, spec.Server, credential, "/api/v2/torrents/info", query, &torrents); err != nil {
		return result, err
	}
	var transfer struct {
		Down int64 `json:"dl_info_speed"`
		Up   int64 `json:"up_info_speed"`
	}
	transferErr := h.qbittorrentGet(ctx, spec.Server, credential, "/api/v2/transfer/info", nil, &transfer)

	totals := &MediaTotals{Down: transfer.Down, Up: transfer.Up}
	lines := newDownloadLines(spec)
	for _, t := range torrents {
		group := qbittorrentGroup(t.State)
		totals.count(group)
		id := t.Hash
		if len(id) > 12 {
			id = id[:12]
		}
		item := MediaItem{
			ID:       id,
			Title:    t.Name,
			Subtitle: t.Category,
			Kind:     "download",
			AddedAt:  t.AddedOn * 1000,
			OpenURL:  spec.Server,
			Progress: downloadProgress(t.Progress),
			Size:     t.Size,
			Speed:    t.DLSpeed,
		}
		if group == downloadDone {
			item.Speed = t.UpSpeed
		} else {
			item.Left = downloadLeft(t.Eta)
		}
		lines.add(group, item)
	}
	result.Items = lines.items
	if transferErr == nil {
		result.Totals = totals
	} else {
		// The torrents are worth showing without the speeds.
		result.Totals = &MediaTotals{Active: totals.Active, Paused: totals.Paused, Done: totals.Done}
	}
	return result, nil
}

/*
qbittorrentSetupHandler tries an address and a sign-in and lists the
categories that can be chosen.

The version is the question that needs the sign-in, so it is also what proves
it.
*/
func (h *Handlers) qbittorrentSetupHandler(w http.ResponseWriter, r *http.Request) {
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
		Categories []JellyfinUser `json:"categories"`
		Error      string         `json:"error,omitempty"`
	}{Categories: []JellyfinUser{}}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "qBittorrent setup for %s: %v", hostOf(stringOr(body["server"])), err)
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

	var version string
	if err := h.qbittorrentGet(r.Context(), server, credential, "/api/v2/app/version", nil, &version); err != nil {
		reply(err)
		return
	}
	answer.ServerName, answer.Version = "qBittorrent", strings.TrimPrefix(version, "v")
	var categories map[string]struct {
		Name string `json:"name"`
	}
	_ = h.qbittorrentGet(r.Context(), server, credential, "/api/v2/torrents/categories", nil, &categories)
	for key, c := range categories {
		name := c.Name
		if name == "" {
			name = key
		}
		answer.Categories = append(answer.Categories, JellyfinUser{ID: name, Name: name})
	}
	sort.Slice(answer.Categories, func(i, j int) bool { return answer.Categories[i].Name < answer.Categories[j].Name })
	reply(nil)
}

// qbittorrentAnswer is one qBittorrent tile's answer, through the shared
// media cache.
func (h *Handlers) qbittorrentAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	spec := downloadSpecFrom(widget.Config)
	ms := mediaSpec{Service: "qbittorrent", Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		result, err := h.fetchQBittorrent(ctx, spec)
		return result, nil, err
	}, forced)
}

func (h *Handlers) qbittorrentWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeQBittorrent, h.qbittorrentAnswer)
}
