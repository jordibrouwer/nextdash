package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// arrWidgetHandler answers what one Sonarr or Radarr tile should draw.
func (h *Handlers) arrWidgetHandler(kind arrKind, widgetType WidgetType) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.serveMediaWidget(w, r, widgetType, func(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
			spec := arrSpecFrom(widget.Config)
			ms := mediaSpec{Service: kind.Service, Server: spec.Server, CredentialID: spec.CredentialID,
				Fingerprint: spec.fingerprint(), TTL: spec.TTL}
			return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
				return h.fetchArr(ctx, kind, spec, time.Now(), imageURL)
			}, forced)
		})
	}
}

// arrImageHandler serves one poster the tile's last answer offered.
func (h *Handlers) arrImageHandler(kind arrKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.serveMediaImage(w, r, kind.Service, h.fetchArrImage)
	}
}

/*
arrSetupHandler tries an address and a key and names what answered.

Behind the write token, and takes a key that is typed but not yet saved, as
Jellyfin's does: someone setting the tile up for the first time is asking
about the key on screen. That key is used for this one request and written
nowhere.
*/
func (h *Handlers) arrSetupHandler(kind arrKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
				logWarn(logComponentWidgets, "%s setup for %s: %v", kind.Name, hostOf(stringOr(body["server"])), err)
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
		if err := h.arrGet(r.Context(), arrSpec{Server: server}, credential, "/api/v3/system/status", nil, &status); err != nil {
			reply(err)
			return
		}
		answer.ServerName, answer.Version = status.AppName, status.Version
		if answer.ServerName == "" {
			answer.ServerName = kind.Name
		}
		reply(nil)
	}
}
