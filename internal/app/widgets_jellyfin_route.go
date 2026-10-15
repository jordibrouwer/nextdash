package app

import (
	"context"
	"net/http"
)

// jellyfinAnswer is one Jellyfin tile's answer, through the shared media cache.
func (h *Handlers) jellyfinAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	return h.flavoredAnswer(ctx, pageID, widget, forced, jellyfinFlavorJellyfin)
}

// flavoredAnswer is one Jellyfin-or-Emby tile's answer, through the shared
// media cache.
func (h *Handlers) flavoredAnswer(ctx context.Context, pageID int, widget Widget, forced bool, flavor jellyfinFlavor) MediaResult {
	spec := jellyfinSpecFromFlavor(widget.Config, flavor)
	ms := mediaSpec{Service: flavor.service(), Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		return h.fetchJellyfinLatest(ctx, spec, imageURL)
	}, forced)
}

// JellyfinWidgetHandler answers what one Jellyfin tile should draw.
func (h *Handlers) JellyfinWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeJellyfin, h.jellyfinAnswer)
}
