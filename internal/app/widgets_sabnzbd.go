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
)

/*
SABnzbd: the queue, and what finished last, through /api.

The key travels as ?apikey= -- SABnzbd has no header form -- and comes from the
stored credential on each request, never from the widget's address. SABnzbd 5
refuses a wrong key with 403; older versions answer 200 with the refusal in the
body, so both read as a refused key.
*/

type sabnzbdQueue struct {
	Queue struct {
		Paused   bool   `json:"paused"`
		KBPerSec string `json:"kbpersec"`
		Slots    []struct {
			ID         string `json:"nzo_id"`
			Filename   string `json:"filename"`
			Status     string `json:"status"`
			Percentage string `json:"percentage"`
			MB         string `json:"mb"`
			TimeLeft   string `json:"timeleft"`
			Category   string `json:"cat"`
			TimeAdded  int64  `json:"time_added"`
		} `json:"slots"`
	} `json:"queue"`
}

type sabnzbdHistory struct {
	History struct {
		Slots []struct {
			ID        string `json:"nzo_id"`
			Name      string `json:"name"`
			Status    string `json:"status"`
			Bytes     int64  `json:"bytes"`
			Category  string `json:"category"`
			Completed int64  `json:"completed"`
		} `json:"slots"`
	} `json:"history"`
}

func (h *Handlers) sabnzbdGet(ctx context.Context, server string, credential HealthCredential, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	query.Set("output", "json")
	resp, err := h.mediaRequest(ctx, server, credential, "/api", query, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, jellyfinMaxBody))
	if err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	var refusal struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &refusal) == nil && refusal.Error != "" {
		if strings.Contains(strings.ToLower(refusal.Error), "api key") {
			return fmt.Errorf("%w: %s", errMediaRefused, refusal.Error)
		}
		return fmt.Errorf("%w: %s", errMediaUnreachable, refusal.Error)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

// sabnzbdCategory is a category worth showing; "*" is SABnzbd's "none".
func sabnzbdCategory(cat string) string {
	if cat == "*" {
		return ""
	}
	return cat
}

func (h *Handlers) fetchSABnzbd(ctx context.Context, spec downloadSpec) (MediaResult, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: spec.groups()}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, errMediaNotSetUp
	}

	var queue sabnzbdQueue
	if err := h.sabnzbdGet(ctx, spec.Server, credential, url.Values{"mode": {"queue"}, "limit": {"100"}}, &queue); err != nil {
		return result, err
	}
	speed, _ := strconv.ParseFloat(queue.Queue.KBPerSec, 64)
	totals := &MediaTotals{Down: int64(speed * 1024)}
	lines := newDownloadLines(spec)

	type queued struct {
		group MediaGroup
		item  MediaItem
	}
	var slots []queued
	speedGiven := false
	for _, s := range queue.Queue.Slots {
		group := downloadActive
		if queue.Queue.Paused || s.Status == "Paused" {
			group = downloadPaused
		}
		totals.count(group)
		percent, _ := strconv.ParseFloat(s.Percentage, 64)
		mb, _ := strconv.ParseFloat(s.MB, 64)
		item := MediaItem{
			ID:       s.ID,
			Title:    s.Filename,
			Subtitle: sabnzbdCategory(s.Category),
			Kind:     "download",
			AddedAt:  s.TimeAdded * 1000,
			OpenURL:  spec.Server,
			Progress: downloadProgress(percent / 100),
			Size:     int64(mb * (1 << 20)),
		}
		if s.TimeLeft != "0:00:00" {
			item.Left = s.TimeLeft
		}
		// SABnzbd downloads one at a time: the client's speed is that one's.
		if group == downloadActive && s.Status == "Downloading" && !speedGiven {
			item.Speed, speedGiven = totals.Down, true
		}
		slots = append(slots, queued{group, item})
	}
	// Queue order is SABnzbd's own; progress is the one other order it has.
	if spec.Sort == "progress" {
		sort.SliceStable(slots, func(i, j int) bool { return *slots[i].item.Progress > *slots[j].item.Progress })
	}
	for _, s := range slots {
		lines.add(s.group, s.item)
	}

	shown := false
	for _, g := range result.Libraries {
		shown = shown || g.ID == downloadDone.ID
	}
	if shown {
		var history sabnzbdHistory
		if err := h.sabnzbdGet(ctx, spec.Server, credential, url.Values{"mode": {"history"}, "limit": {strconv.Itoa(spec.Rows)}}, &history); err != nil {
			result.Partial = true
		}
		for _, s := range history.History.Slots {
			item := MediaItem{
				ID:       s.ID,
				Title:    s.Name,
				Subtitle: sabnzbdCategory(s.Category),
				Kind:     "download",
				AddedAt:  s.Completed * 1000,
				OpenURL:  spec.Server,
				Size:     s.Bytes,
			}
			switch s.Status {
			case "Completed":
				totals.Done++
				item.Progress = downloadProgress(1)
				lines.add(downloadDone, item)
			case "Failed":
				item.Subtitle = "failed"
				lines.add(downloadDone, item)
			default:
				// Still being verified, repaired or unpacked: busy.
				lines.add(downloadActive, item)
			}
		}
	}
	result.Items = lines.items
	result.Totals = totals
	return result, nil
}

// sabnzbdSetupHandler tries an address and a key. The version answers anyone,
// so the key is proved with a one-line look at the queue.
func (h *Handlers) sabnzbdSetupHandler(w http.ResponseWriter, r *http.Request) {
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
		ServerName string `json:"serverName,omitempty"`
		Version    string `json:"version,omitempty"`
		Error      string `json:"error,omitempty"`
	}{}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "SABnzbd setup for %s: %v", hostOf(stringOr(body["server"])), err)
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
	var queue sabnzbdQueue
	if err := h.sabnzbdGet(r.Context(), server, credential, url.Values{"mode": {"queue"}, "limit": {"1"}}, &queue); err != nil {
		reply(err)
		return
	}
	var version struct {
		Version string `json:"version"`
	}
	_ = h.sabnzbdGet(r.Context(), server, credential, url.Values{"mode": {"version"}}, &version)
	answer.ServerName, answer.Version = "SABnzbd", version.Version
	reply(nil)
}

// sabnzbdAnswer is one SABnzbd tile's answer, through the shared media cache.
func (h *Handlers) sabnzbdAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	spec := downloadSpecFrom(widget.Config)
	ms := mediaSpec{Service: "sabnzbd", Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		result, err := h.fetchSABnzbd(ctx, spec)
		return result, nil, err
	}, forced)
}

func (h *Handlers) sabnzbdWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeSABnzbd, h.sabnzbdAnswer)
}
