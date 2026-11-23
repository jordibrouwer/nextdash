package app

import (
	"context"
	"strconv"
	"strings"
)

/*
Searching for an episode or a film from the Sonarr or Radarr tile. See
widgets_actions.go for the rules every action shares.

Only a line from Upcoming can be searched: its id is "e<episode>" or
"m<movie>", where a queue line is "q<record>". The number goes into the
command body, so it must parse.
*/

func init() {
	for _, entry := range []struct {
		widgetType WidgetType
		kind       arrKind
		prefix     string
		command    string
		field      string
	}{
		{WidgetTypeSonarr, arrSonarr, "e", "EpisodeSearch", "episodeIds"},
		{WidgetTypeRadarr, arrRadarr, "m", "MoviesSearch", "movieIds"},
	} {
		entry := entry
		answer := func(ctx context.Context, h *Handlers, pageID int, widget Widget) MediaResult {
			return h.arrAnswer(entry.kind)(ctx, pageID, widget, false)
		}
		widgetActions[entry.widgetType] = widgetActionType{
			Service: entry.kind.Service,
			Answer:  answer,
			Actions: map[string]widgetAction{
				"search": {Run: arrSearch(entry.prefix, entry.command, entry.field)},
			},
		}
	}
}

func arrSearch(prefix, command, field string) func(context.Context, *Handlers, widgetActionRequest) (any, error) {
	return func(ctx context.Context, h *Handlers, req widgetActionRequest) (any, error) {
		spec := arrSpecFrom(req.Widget.Config)
		credential, ok := lookupHealthCredential(spec.CredentialID)
		if !ok || spec.Server == "" {
			return nil, errMediaNotSetUp
		}
		id, err := strconv.Atoi(strings.TrimPrefix(req.Target, prefix))
		if err != nil || id <= 0 || !strings.HasPrefix(req.Target, prefix) {
			return nil, errWidgetActionRefused
		}
		resp, err := h.mediaPost(ctx, spec.Server, credential, "/api/v3/command",
			map[string]any{"name": command, field: []int{id}})
		if err != nil {
			return nil, err
		}
		drainAndCloseResponse(resp)
		return nil, nil
	}
}
