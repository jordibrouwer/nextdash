package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// beszelWidgetHandler answers what one Beszel tile should draw. The four
// types share the answer and differ in what they pick out of it.
func (h *Handlers) beszelWidgetHandler(widgetType WidgetType) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.serveMediaWidget(w, r, widgetType, h.beszelAnswer)
	}
}

/*
beszelSetupHandler signs in to a hub and lists its systems.

Behind the write token, and takes a sign-in that is typed but not yet saved,
like the other media setups: someone setting a tile up is asking about the
password on screen, which is used for this one request and written nowhere.
One setup serves all four types -- the three that are not "all systems" borrow
it, as the now-playing tiles borrow their library's.

A stored sign-in may hold a token that lapsed: the hub then answers 200 with an
empty list, so an empty answer is asked once more with a fresh sign-in before
it is believed.
*/
func (h *Handlers) beszelSetupHandler(w http.ResponseWriter, r *http.Request) {
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
	type setupSystem struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Status string `json:"status"`
	}
	answer := struct {
		Connected string        `json:"connected,omitempty"`
		Systems   []setupSystem `json:"systems,omitempty"`
		Error     string        `json:"error,omitempty"`
	}{}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "Beszel setup for %s: %v", hostOf(stringOr(body["server"])), err)
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
	systems, err := h.beszelListSystems(r.Context(), server, credential)
	if err == nil && len(systems) == 0 {
		if err = h.beszelSignInAgain(r.Context(), server, credential); err == nil {
			systems, err = h.beszelListSystems(r.Context(), server, credential)
		}
	}
	if err != nil {
		reply(err)
		return
	}
	noun := "systems"
	if len(systems) == 1 {
		noun = "system"
	}
	answer.Connected = fmt.Sprintf("%d %s", len(systems), noun)
	for _, s := range beszelByName(systems) {
		answer.Systems = append(answer.Systems, setupSystem{ID: s.ID, Name: s.Name, Status: s.status()})
	}
	reply(nil)
}
