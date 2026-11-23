package app

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

/*
Pausing and resuming a download client from its tile: one line, or the whole
client (target "all"). See widgets_actions.go for the rules every action
shares.
*/

func init() {
	qbAnswer := func(ctx context.Context, h *Handlers, pageID int, widget Widget) MediaResult {
		return h.qbittorrentAnswer(ctx, pageID, widget, false)
	}
	widgetActions[WidgetTypeQBittorrent] = widgetActionType{
		Service: "qbittorrent",
		Answer:  qbAnswer,
		Actions: map[string]widgetAction{
			"pause":  {All: true, Run: qbittorrentSwitch("stop", "pause")},
			"resume": {All: true, Run: qbittorrentSwitch("start", "resume")},
		},
	}
	sabAnswer := func(ctx context.Context, h *Handlers, pageID int, widget Widget) MediaResult {
		return h.sabnzbdAnswer(ctx, pageID, widget, false)
	}
	widgetActions[WidgetTypeSABnzbd] = widgetActionType{
		Service: "sabnzbd",
		Answer:  sabAnswer,
		Actions: map[string]widgetAction{
			"pause":  {All: true, Run: sabnzbdSwitch("pause")},
			"resume": {All: true, Run: sabnzbdSwitch("resume")},
		},
	}
}

/*
qbittorrentSwitch stops or starts torrents.

qBittorrent 5 renamed pause and resume to stop and start; the new name is
tried first and the old one when the client does not know it (404). A line
carries the first twelve characters of a hash, so the full one is looked up:
qBittorrent takes only whole hashes.
*/
func qbittorrentSwitch(name, oldName string) func(context.Context, *Handlers, widgetActionRequest) (any, error) {
	return func(ctx context.Context, h *Handlers, req widgetActionRequest) (any, error) {
		spec := downloadSpecFrom(req.Widget.Config)
		credential, ok := lookupHealthCredential(spec.CredentialID)
		if !ok || spec.Server == "" {
			return nil, errMediaNotSetUp
		}
		hashes := widgetActionAll
		if req.Target != widgetActionAll {
			var torrents []qbittorrentTorrent
			if err := h.qbittorrentGet(ctx, spec.Server, credential, "/api/v2/torrents/info", nil, &torrents); err != nil {
				return nil, err
			}
			hashes = ""
			for _, t := range torrents {
				if req.Target != "" && strings.HasPrefix(t.Hash, req.Target) {
					hashes = t.Hash
					break
				}
			}
			if hashes == "" {
				return nil, errWidgetActionRefused
			}
		}
		form := []byte(url.Values{"hashes": {hashes}}.Encode())
		post := func(path string) error {
			resp, err := h.mediaSend(ctx, http.MethodPost, spec.Server, credential, path, nil, form, "text/plain",
				func(r *http.Request) { r.Header.Set("Content-Type", "application/x-www-form-urlencoded") })
			if err != nil {
				return err
			}
			drainAndCloseResponse(resp)
			return nil
		}
		err := post("/api/v2/torrents/" + name)
		var status *mediaHTTPError
		if errors.As(err, &status) && status.Status == http.StatusNotFound {
			err = post("/api/v2/torrents/" + oldName)
		}
		return nil, err
	}
}

/*
sabnzbdSwitch pauses or resumes SABnzbd: the whole queue (mode=pause), or one
job in it (mode=queue&name=pause&value=<nzo_id>).
*/
func sabnzbdSwitch(mode string) func(context.Context, *Handlers, widgetActionRequest) (any, error) {
	return func(ctx context.Context, h *Handlers, req widgetActionRequest) (any, error) {
		spec := downloadSpecFrom(req.Widget.Config)
		credential, ok := lookupHealthCredential(spec.CredentialID)
		if !ok || spec.Server == "" {
			return nil, errMediaNotSetUp
		}
		query := url.Values{"mode": {mode}}
		if req.Target != widgetActionAll {
			query = url.Values{"mode": {"queue"}, "name": {mode}, "value": {req.Target}}
		}
		var answer struct {
			Status bool `json:"status"`
		}
		if err := h.sabnzbdGet(ctx, spec.Server, credential, query, &answer); err != nil {
			return nil, err
		}
		return nil, nil
	}
}
