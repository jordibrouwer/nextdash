package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

/*
Actions a service tile can take: approve a request, pause a download client,
start a search, pause DNS blocking, switch a light.

One pattern for all of them. The browser names a widget, an action and what
it acts on; the server finds the widget, reads the address and the key
itself, and acts only when

  - the widget's own switch (config "actions") is on,
  - the action is one this widget type offers,
  - the target passes the action's check: by default it must be a line the
    tile was last shown, so a browser cannot name a request or a torrent the
    tile never listed.

Every action sits behind the write token and is refused in the demo.
*/

// widgetActionAll is the target that means the whole client.
const widgetActionAll = "all"

// errWidgetActionRefused is a target or argument the widget does not offer.
var errWidgetActionRefused = errors.New("not offered")

// widgetActionRequest is what the browser sent, with the widget it names.
type widgetActionRequest struct {
	PageID int
	Widget Widget
	Action string
	Target string
	// Arg is an action's one setting, such as how long a pause lasts.
	Arg int
}

// widgetAction is one thing a tile may do.
type widgetAction struct {
	// Check says whether the target may be acted on. Nil means it must be a
	// line in the tile's last answer.
	Check func(ctx context.Context, h *Handlers, req widgetActionRequest) bool
	// All lets the target be "all": the whole client rather than one line.
	All bool
	Run func(ctx context.Context, h *Handlers, req widgetActionRequest) (any, error)
}

// widgetActionType is what one widget type offers.
type widgetActionType struct {
	// Service is the media cache name, forgotten after every action.
	Service string
	// Answer reads the tile's answer through the cache, for the line check.
	Answer func(ctx context.Context, h *Handlers, pageID int, widget Widget) MediaResult
	// OnByDefault is for Home Assistant, which switched before the setting
	// existed: an install that never chose keeps switching.
	OnByDefault bool
	Actions     map[string]widgetAction
}

// widgetActions lists every widget type that can act. Filled per service in
// its own file's init, so the table and the code stay side by side.
var widgetActions = map[WidgetType]widgetActionType{}

// widgetActionsOn is the widget's own switch.
func widgetActionsOn(widget Widget) bool {
	kind, ok := widgetActions[widget.Type]
	if !ok {
		return false
	}
	if on, set := widget.Config["actions"].(bool); set {
		return on
	}
	return kind.OnByDefault
}

// widgetControls says whether this reader sees the buttons. Per request,
// never stored with the cached answer.
func widgetControls(r *http.Request, widget Widget) bool {
	return widgetActionsOn(widget) && hasWriteAccess(r) && !demoMode()
}

// widgetActionLineSeen says whether target is a line in the tile's answer.
func widgetActionLineSeen(result MediaResult, target string) bool {
	for _, item := range result.Items {
		if item.ID == target {
			return true
		}
	}
	return false
}

// widgetActionHandler answers POST /api/widgets/{type}/action.
func (h *Handlers) widgetActionHandler(widgetType WidgetType) http.HandlerFunc {
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
		var body struct {
			PageID int    `json:"pageId"`
			ID     string `json:"id"`
			Action string `json:"action"`
			Target string `json:"target"`
			Arg    int    `json:"arg"`
			// Entity is how Home Assistant tiles asked before there was one
			// pattern; a tab opened before an update still sends it.
			Entity string `json:"entity"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		if body.Target == "" {
			body.Target = body.Entity
		}
		kind := widgetActions[widgetType]
		if body.Action == "" && widgetType == WidgetTypeHomeAssistant {
			body.Action = haControl(haDomain(body.Target))
		}

		widgets, _ := h.store.GetPageBlocks(body.PageID)
		var found *Widget
		for i := range widgets {
			if widgets[i].ID == body.ID && widgets[i].Type == widgetType {
				found = &widgets[i]
				break
			}
		}
		if found == nil {
			http.Error(w, "No such widget", http.StatusNotFound)
			return
		}
		if !widgetActionsOn(*found) {
			http.Error(w, "Actions are off for this widget", http.StatusForbidden)
			return
		}
		action, ok := kind.Actions[body.Action]
		if !ok && body.Entity != "" {
			// The old Home Assistant form names an entity it cannot switch.
			http.Error(w, "Not offered by this widget", http.StatusForbidden)
			return
		}
		if !ok {
			http.Error(w, "Unknown action", http.StatusBadRequest)
			return
		}
		req := widgetActionRequest{PageID: body.PageID, Widget: *found, Action: body.Action, Target: body.Target, Arg: body.Arg}
		allowed := false
		switch {
		case action.Check != nil:
			allowed = action.Check(r.Context(), h, req)
		case action.All && body.Target == widgetActionAll:
			allowed = true
		case kind.Answer != nil && body.Target != "":
			result := kind.Answer(r.Context(), h, body.PageID, *found)
			allowed = widgetActionLineSeen(result, body.Target)
			if !allowed && result.Error != "" {
				// The service did not answer: say so, not "not offered".
				w.WriteHeader(http.StatusBadGateway)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": result.Error})
				return
			}
		}
		if !allowed {
			http.Error(w, "Not offered by this widget", http.StatusForbidden)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), mediaRequestTimeout)
		defer cancel()
		answer, err := action.Run(ctx, h, req)
		// Asked again next time, done or not: the old answer is stale either way.
		mediaForget(kind.Service, body.PageID, body.ID)
		if errors.Is(err, errWidgetActionRefused) {
			http.Error(w, "Not offered by this widget", http.StatusForbidden)
			return
		}
		if err != nil {
			logWarn(logComponentWidgets, "%s could not %s %s: %v", widgetType, body.Action, body.Target, err)
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": mediaErrorCode(err)})
			return
		}
		if answer == nil {
			answer = map[string]bool{"ok": true}
		}
		_ = json.NewEncoder(w).Encode(answer)
	}
}
