package app

import "context"

/*
Pausing DNS blocking from the Pi-hole or AdGuard tile, and turning it back
on. See widgets_actions.go for the rules every action shares.

Blocking is one switch for the whole server, so the target is always "all".
A pause lasts one of a few set times, or until it is resumed (0): the browser
names the seconds, the server accepts only those.
*/

// dnsPauseSeconds are the pauses the tile offers; 0 is until resumed.
var dnsPauseSeconds = map[int]bool{300: true, 1800: true, 3600: true, 0: true}

func init() {
	register := func(widgetType WidgetType, fetch func(*Handlers, context.Context, dnsSpec, HealthCredential) (*MediaDns, error)) {
		answer := func(ctx context.Context, h *Handlers, pageID int, widget Widget) MediaResult {
			return h.dnsAnswer(func(ctx context.Context, spec dnsSpec, credential HealthCredential) (*MediaDns, error) {
				return fetch(h, ctx, spec, credential)
			})(ctx, pageID, widget, false)
		}
		widgetActions[widgetType] = widgetActionType{
			Service: string(widgetType),
			Answer:  answer,
			Actions: map[string]widgetAction{
				"pause":  {All: true, Run: dnsBlocking(false)},
				"resume": {All: true, Run: dnsBlocking(true)},
			},
		}
	}
	register(WidgetTypePihole, (*Handlers).fetchPihole)
	register(WidgetTypeAdguard, (*Handlers).fetchAdguard)
}

func dnsBlocking(on bool) func(context.Context, *Handlers, widgetActionRequest) (any, error) {
	return func(ctx context.Context, h *Handlers, req widgetActionRequest) (any, error) {
		if !on && !dnsPauseSeconds[req.Arg] {
			return nil, errWidgetActionRefused
		}
		spec := dnsSpecFrom(req.Widget.Type, req.Widget.Config)
		credential, ok := lookupHealthCredential(spec.CredentialID)
		if !ok || spec.Server == "" {
			return nil, errMediaNotSetUp
		}
		path := "/api/dns/blocking"
		// Pi-hole counts seconds and says null for no end; AdGuard counts
		// milliseconds and leaves the field out.
		body := map[string]any{"blocking": on, "timer": nil}
		if !on && req.Arg > 0 {
			body["timer"] = req.Arg
		}
		if spec.Type == WidgetTypeAdguard {
			path = "/control/protection"
			body = map[string]any{"enabled": on}
			if !on && req.Arg > 0 {
				body["duration"] = req.Arg * 1000
			}
		}
		resp, err := h.mediaPost(ctx, spec.Server, credential, path, body)
		if err != nil {
			return nil, err
		}
		drainAndCloseResponse(resp)
		return nil, nil
	}
}
