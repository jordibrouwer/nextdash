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
Home Assistant: chosen entities per room, with their value and since when, and
a safe few of them switchable.

The long-lived token travels as a Bearer header from the credential store. The
rooms are not in /api/states; one template question asks Home Assistant for the
room of each chosen entity. Switching is a separate route behind the write
token, for entities the widget chose, in domains where a misclick turns on a
lamp rather than opening a door.
*/

const (
	homeAssistantMaxEntities = 60
	homeAssistantMinTTL      = 15
	homeAssistantDefaultTTL  = 30
	homeAssistantDefaultRows = 6
	// homeAssistantSetupMax bounds the list the panel picks from.
	homeAssistantSetupMax = 2000
)

// haEntityID is all an entity id may be. It also goes into a template, so
// nothing that could close a string or open a Jinja block gets through.
var haEntityID = regexp.MustCompile(`^[a-z_]+\.[a-z0-9_]+$`)

// homeAssistantEntityList keeps valid ids, once each, in the reader's order,
// up to the maximum.
func homeAssistantEntityList(raw any) []string {
	items, ok := raw.([]any)
	if !ok {
		if strs, ok := raw.([]string); ok {
			for _, s := range strs {
				items = append(items, s)
			}
		}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, item := range items {
		id, _ := item.(string)
		if !haEntityID.MatchString(id) || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
		if len(out) == homeAssistantMaxEntities {
			break
		}
	}
	return out
}

type haSpec struct {
	Server          string
	CredentialID    string
	Entities        []string
	GroupBy         string
	ShowLastChanged bool
	Rows            int
	TTL             time.Duration
}

func haSpecFrom(config map[string]any) haSpec {
	spec := haSpec{
		Server:          strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID:    stringOr(config["credentialId"]),
		Entities:        homeAssistantEntityList(config["entities"]),
		GroupBy:         stringOr(config["groupBy"]),
		ShowLastChanged: config["showLastChanged"] == true,
		Rows:            homeAssistantDefaultRows,
		TTL:             homeAssistantDefaultTTL * time.Second,
	}
	if spec.GroupBy == "" {
		spec.GroupBy = "area"
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, homeAssistantMinTTL, 3600)) * time.Second
	}
	return spec
}

func (spec haSpec) fingerprint() string {
	return strings.Join([]string{spec.Server, spec.CredentialID, strings.Join(spec.Entities, ","), spec.GroupBy,
		strconv.Itoa(spec.Rows)}, "|")
}

func haDomain(entityID string) string {
	domain, _, _ := strings.Cut(entityID, ".")
	return domain
}

// haControl is what may be done with a domain from the tile: a switch, a
// start, or nothing at all.
func haControl(domain string) string {
	switch domain {
	case "light", "switch", "fan", "input_boolean":
		return "toggle"
	case "scene", "script":
		return "run"
	}
	return ""
}

// haIcon names a glyph for a line; the browser draws it.
func haIcon(domain, deviceClass string) string {
	switch domain {
	case "light", "switch", "fan", "scene", "script", "lock", "cover":
		return domain
	case "input_boolean":
		return "toggle"
	case "binary_sensor":
		switch deviceClass {
		case "door", "opening", "garage_door":
			return "door"
		case "window":
			return "window"
		case "motion", "occupancy", "presence":
			return "motion"
		}
		return "sensor"
	case "sensor":
		switch deviceClass {
		case "temperature", "humidity", "battery", "power", "energy", "illuminance":
			return deviceClass
		}
	}
	return "sensor"
}

// haAreaTemplate asks for the room of every id, as one JSON object. Ids are
// checked again here: the template is code that runs in Home Assistant.
func haAreaTemplate(ids []string) string {
	valid := make([]string, 0, len(ids))
	for _, id := range ids {
		if haEntityID.MatchString(id) {
			valid = append(valid, id)
		}
	}
	list, _ := json.Marshal(valid)
	return "{% set ns = namespace(m={}) %}{% for e in " + string(list) +
		" %}{% set ns.m = dict(ns.m, **{e: area_name(e)}) %}{% endfor %}{{ ns.m | tojson }}"
}

type haState struct {
	EntityID    string         `json:"entity_id"`
	State       string         `json:"state"`
	LastChanged string         `json:"last_changed"`
	Attributes  map[string]any `json:"attributes"`
}

func (s haState) name() string {
	if name, _ := s.Attributes["friendly_name"].(string); strings.TrimSpace(name) != "" {
		return name
	}
	return s.EntityID
}

func (h *Handlers) haCredential(id string) (HealthCredential, error) {
	if id == "" {
		return HealthCredential{}, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(id)
	if !ok {
		return HealthCredential{}, errMediaNotSetUp
	}
	return credential, nil
}

func (h *Handlers) haStates(ctx context.Context, server string, credential HealthCredential) ([]haState, error) {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, "/api/states", nil, "application/json", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var states []haState
	if err := json.NewDecoder(io.LimitReader(resp.Body, jellyfinMaxBody)).Decode(&states); err != nil {
		return nil, fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return states, nil
}

func (h *Handlers) haAreas(ctx context.Context, server string, credential HealthCredential, ids []string) (map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaPost(ctx, server, credential, "/api/template", map[string]string{"template": haAreaTemplate(ids)})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var raw map[string]*string
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&raw); err != nil {
		return nil, fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	areas := map[string]string{}
	for id, area := range raw {
		if area != nil {
			areas[id] = *area
		}
	}
	return areas, nil
}

var haNoArea = MediaGroup{ID: "none", Name: "No area"}

func (h *Handlers) fetchHomeAssistant(ctx context.Context, spec haSpec) (MediaResult, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
	if spec.Server == "" {
		return result, errMediaNotSetUp
	}
	credential, err := h.haCredential(spec.CredentialID)
	if err != nil {
		return result, err
	}
	if len(spec.Entities) == 0 {
		return result, errMediaNoEntities
	}

	var (
		states    []haState
		statesErr error
		areas     map[string]string
		areasErr  error
		wg        sync.WaitGroup
	)
	wg.Add(1)
	go func() {
		defer wg.Done()
		states, statesErr = h.haStates(ctx, spec.Server, credential)
	}()
	groupBy := spec.GroupBy
	if groupBy == "area" {
		wg.Add(1)
		go func() {
			defer wg.Done()
			areas, areasErr = h.haAreas(ctx, spec.Server, credential, spec.Entities)
		}()
	}
	wg.Wait()
	if statesErr != nil {
		return result, statesErr
	}
	if groupBy == "area" && areasErr != nil {
		// The entities are worth showing without their rooms.
		groupBy, result.Partial = "domain", true
	}

	byID := make(map[string]haState, len(states))
	for _, s := range states {
		byID[s.EntityID] = s
	}
	groupOf := func(id string) MediaGroup {
		switch groupBy {
		case "area":
			if area := areas[id]; area != "" {
				return MediaGroup{ID: area, Name: area}
			}
			return haNoArea
		case "domain":
			domain := haDomain(id)
			return MediaGroup{ID: domain, Name: domain}
		}
		return MediaGroup{ID: "all", Name: "Home"}
	}

	groups := map[string]MediaGroup{}
	perGroup := map[string]int{}
	for _, id := range spec.Entities {
		group := groupOf(id)
		if perGroup[group.ID] >= spec.Rows {
			continue
		}
		perGroup[group.ID]++
		groups[group.ID] = group
		item := MediaItem{
			ID:        id,
			Title:     id,
			Kind:      "entity",
			Library:   group.Name,
			LibraryID: group.ID,
			OpenURL:   spec.Server + "/history?entity_id=" + url.QueryEscape(id),
		}
		domain := haDomain(id)
		s, found := byID[id]
		if !found {
			item.Missing = true
			item.Icon = haIcon(domain, "")
			result.Items = append(result.Items, item)
			continue
		}
		deviceClass, _ := s.Attributes["device_class"].(string)
		item.Title = s.name()
		item.Icon = haIcon(domain, deviceClass)
		if at, err := time.Parse(time.RFC3339Nano, s.LastChanged); err == nil {
			item.AddedAt = at.UnixMilli()
		}
		switch {
		case s.State == "unavailable" || s.State == "unknown":
			item.Unavailable = true
			item.Value = s.State
		case haControl(domain) == "run":
			// A scene's state is when it last ran, which is not a value.
			item.Control = "run"
		default:
			item.Value = s.State
			if unit, _ := s.Attributes["unit_of_measurement"].(string); unit != "" {
				item.Value += " " + unit
			}
			item.Control = haControl(domain)
			item.On = s.State == "on"
		}
		result.Items = append(result.Items, item)
	}

	for _, g := range groups {
		result.Libraries = append(result.Libraries, g)
	}
	sort.Slice(result.Libraries, func(i, j int) bool {
		a, b := result.Libraries[i], result.Libraries[j]
		if (a.ID == haNoArea.ID) != (b.ID == haNoArea.ID) {
			return b.ID == haNoArea.ID
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return result, nil
}

// homeAssistantAnswer is one tile's answer through the shared media cache.
func (h *Handlers) homeAssistantAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	spec := haSpecFrom(widget.Config)
	ms := mediaSpec{Service: "homeassistant", Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		result, err := h.fetchHomeAssistant(ctx, spec)
		return result, nil, err
	}, forced)
}

// homeAssistantWidgetHandler answers a tile, and says per request whether
// this reader may switch: that is never part of the cached answer.
func (h *Handlers) homeAssistantWidgetHandler(w http.ResponseWriter, r *http.Request) {
	controls := hasWriteAccess(r) && !demoMode()
	h.serveMediaWidget(w, r, WidgetTypeHomeAssistant, func(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
		result := h.homeAssistantAnswer(ctx, pageID, widget, forced)
		result.Controls = controls
		return result
	})
}

// homeAssistantSetupHandler tries an address and a token, and lists what can
// be chosen: id, name, domain and state, no attributes.
func (h *Handlers) homeAssistantSetupHandler(w http.ResponseWriter, r *http.Request) {
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
	type entity struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Domain string `json:"domain"`
		State  string `json:"state"`
	}
	answer := struct {
		ServerName string   `json:"serverName,omitempty"`
		Version    string   `json:"version,omitempty"`
		Entities   []entity `json:"entities"`
		Error      string   `json:"error,omitempty"`
	}{Entities: []entity{}}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "Home Assistant setup for %s: %v", hostOf(stringOr(body["server"])), err)
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
	states, err := h.haStates(r.Context(), server, credential)
	if err != nil {
		reply(err)
		return
	}
	for _, s := range states {
		if !haEntityID.MatchString(s.EntityID) {
			continue
		}
		answer.Entities = append(answer.Entities, entity{ID: s.EntityID, Name: s.name(), Domain: haDomain(s.EntityID), State: s.State})
		if len(answer.Entities) == homeAssistantSetupMax {
			break
		}
	}
	var config struct {
		LocationName string `json:"location_name"`
		Version      string `json:"version"`
	}
	if resp, err := h.mediaRequest(r.Context(), server, credential, "/api/config", nil, "application/json", nil); err == nil {
		_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&config)
		resp.Body.Close()
	}
	answer.ServerName, answer.Version = config.LocationName, config.Version
	if answer.ServerName == "" {
		answer.ServerName = "Home Assistant"
	}
	reply(nil)
}

/*
homeAssistantActionHandler switches one entity.

The address and the token are the server's, never the browser's: the browser
names a widget and an entity, and the switch happens only if that widget chose
that entity and its domain is one a misclick cannot make dangerous.
*/
func (h *Handlers) homeAssistantActionHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !h.requireWriteAccess(w, r) || !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	var body struct {
		PageID int    `json:"pageId"`
		ID     string `json:"id"`
		Entity string `json:"entity"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	widgets, _ := h.store.GetPageBlocks(body.PageID)
	var found *Widget
	for i := range widgets {
		if widgets[i].ID == body.ID && widgets[i].Type == WidgetTypeHomeAssistant {
			found = &widgets[i]
			break
		}
	}
	if found == nil {
		http.Error(w, "No such widget", http.StatusNotFound)
		return
	}
	spec := haSpecFrom(found.Config)
	chosen := false
	for _, id := range spec.Entities {
		chosen = chosen || id == body.Entity
	}
	domain := haDomain(body.Entity)
	service := map[string]string{"toggle": "toggle", "run": "turn_on"}[haControl(domain)]
	if !chosen || service == "" {
		http.Error(w, "Not switchable from here", http.StatusForbidden)
		return
	}
	credential, err := h.haCredential(spec.CredentialID)
	if err != nil || spec.Server == "" {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": errMediaNotSetUp.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaPost(ctx, spec.Server, credential, "/api/services/"+domain+"/"+service,
		map[string]string{"entity_id": body.Entity})
	// Asked again next time, switched or not: the old answer is stale either way.
	mediaForget("homeassistant", body.PageID, body.ID)
	if err != nil {
		logWarn(logComponentWidgets, "Home Assistant could not switch %s: %v", body.Entity, err)
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": mediaErrorCode(err)})
		return
	}
	defer resp.Body.Close()
	var changed []haState
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&changed)
	type state struct {
		ID    string `json:"id"`
		State string `json:"state"`
		On    bool   `json:"on"`
	}
	answer := struct {
		States []state `json:"states"`
	}{States: []state{}}
	for _, s := range changed {
		answer.States = append(answer.States, state{ID: s.EntityID, State: s.State, On: s.State == "on"})
	}
	_ = json.NewEncoder(w).Encode(answer)
}
