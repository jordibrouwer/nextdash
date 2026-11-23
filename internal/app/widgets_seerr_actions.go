package app

import (
	"context"
	"net/http"
	"strconv"
	"strings"
)

/*
Approving or declining a request from the Seerr tile. See widgets_actions.go
for the rules every action shares.

Only a request that is waiting for a decision can be decided: the line must be
in the tile's last answer and in its Pending group, and its id must be a
number, since the id goes into the path sent to Seerr. Seerr's own check that
the key may manage requests (a 403 from Seerr) comes back as "not allowed".
*/

func init() {
	answer := func(ctx context.Context, h *Handlers, pageID int, widget Widget) MediaResult {
		return h.seerrAnswer(ctx, pageID, widget, false)
	}
	widgetActions[WidgetTypeSeerr] = widgetActionType{
		Service: "seerr",
		Answer:  answer,
		Actions: map[string]widgetAction{
			"approve": {Run: seerrDecide("approve")},
			"decline": {Run: seerrDecide("decline")},
		},
	}
}

func seerrDecide(verb string) func(context.Context, *Handlers, widgetActionRequest) (any, error) {
	return func(ctx context.Context, h *Handlers, req widgetActionRequest) (any, error) {
		spec := seerrSpecFrom(req.Widget.Config)
		credential, ok := lookupHealthCredential(spec.CredentialID)
		if !ok || spec.Server == "" {
			return nil, errMediaNotSetUp
		}
		id, err := strconv.Atoi(strings.TrimPrefix(req.Target, "r"))
		if err != nil || id <= 0 || !strings.HasPrefix(req.Target, "r") {
			return nil, errWidgetActionRefused
		}
		// The cached answer, already read for the line check: is it waiting?
		pending := false
		for _, item := range h.seerrAnswer(ctx, req.PageID, req.Widget, false).Items {
			if item.ID == req.Target && item.LibraryID == seerrPending.ID {
				pending = true
				break
			}
		}
		if !pending {
			return nil, errWidgetActionRefused
		}
		resp, err := h.mediaSend(ctx, http.MethodPost, spec.Server, credential,
			"/api/v1/request/"+strconv.Itoa(id)+"/"+verb, nil, []byte("{}"), "application/json",
			func(r *http.Request) { r.Header.Set("Content-Type", "application/json") })
		if err != nil {
			return nil, err
		}
		drainAndCloseResponse(resp)
		return nil, nil
	}
}
