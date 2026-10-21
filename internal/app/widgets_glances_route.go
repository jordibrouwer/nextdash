package app

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
)

// glancesWidgetHandler answers what one Glances tile should draw.
func (h *Handlers) glancesWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeGlances, h.glancesAnswer)
}

/*
glancesSetupHandler checks a Glances server and lists what it offers.

Behind the write token, and takes a login that is typed but not yet saved,
like the other media setups: it is used for this one request and written
nowhere. The credential is optional, since a Glances server may be open.
The plugin list and the filesystems are what the setup form offers to pick
from; a server that has switched one off just offers nothing for it.
*/
func (h *Handlers) glancesSetupHandler(w http.ResponseWriter, r *http.Request) {
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
	type setupFS struct {
		Name string `json:"name"`
	}
	answer := struct {
		Connected   string    `json:"connected,omitempty"`
		Plugins     []string  `json:"plugins,omitempty"`
		Filesystems []setupFS `json:"filesystems,omitempty"`
		Error       string    `json:"error,omitempty"`
	}{}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "Glances setup for %s: %v", hostOf(stringOr(body["server"])), err)
			answer = struct {
				Connected   string    `json:"connected,omitempty"`
				Plugins     []string  `json:"plugins,omitempty"`
				Filesystems []setupFS `json:"filesystems,omitempty"`
				Error       string    `json:"error,omitempty"`
			}{Error: mediaErrorCode(err)}
		}
		_ = json.NewEncoder(w).Encode(answer)
	}

	server := strings.TrimRight(sanitizeWidgetURL(stringOr(body["server"])), "/")
	if server == "" {
		reply(errMediaNotSetUp)
		return
	}
	var credential HealthCredential
	if draft := draftCredentialFrom(body["draftCredential"]); draft != nil {
		credential = *draft
	} else if stored, ok := lookupHealthCredential(stringOr(body["credentialId"])); ok {
		credential = stored
	}

	var status any
	if err := h.glancesGet(r.Context(), server, credential, "/status", nil, &status); err != nil {
		reply(err)
		return
	}
	answer.Connected = "Glances 4.x"

	var plugins []string
	if err := h.glancesGet(r.Context(), server, credential, "/pluginslist", nil, &plugins); err == nil {
		answer.Plugins = plugins
	}
	var filesystems []glancesFS
	if err := h.glancesGet(r.Context(), server, credential, "/fs", nil, &filesystems); err == nil {
		sort.Slice(filesystems, func(i, j int) bool { return filesystems[i].MntPoint < filesystems[j].MntPoint })
		for _, fs := range filesystems {
			if fs.MntPoint != "" && !glancesIsPseudo(fs) {
				answer.Filesystems = append(answer.Filesystems, setupFS{Name: fs.MntPoint})
			}
		}
	}
	reply(nil)
}
