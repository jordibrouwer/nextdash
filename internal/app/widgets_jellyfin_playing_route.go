package app

import (
	"context"
	"net/http"
	"time"
)

// jellyfinPlayingAnswer is one now-playing tile's answer, through the shared
// media cache.
func (h *Handlers) jellyfinPlayingAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	return h.flavoredPlayingAnswer(ctx, pageID, widget, forced, jellyfinFlavorJellyfin)
}

func (h *Handlers) flavoredPlayingAnswer(ctx context.Context, pageID int, widget Widget, forced bool, flavor jellyfinFlavor) MediaResult {
	spec := jellyfinPlayingSpecFromFlavor(widget.Config, flavor)
	/*
	 * A second under the tile's beat: the tile asks every TTL, and an answer
	 * kept exactly that long is still fresh for a beat that lands a moment
	 * early, which then redraws the old sessions and skips a beat.
	 */
	ms := mediaSpec{Service: flavor.playingService(), Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL - time.Second}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		return h.fetchJellyfinPlaying(ctx, spec, imageURL)
	}, forced)
}

// JellyfinPlayingHandler answers what one now-playing tile should draw.
func (h *Handlers) JellyfinPlayingHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeJellyfinPlaying, h.jellyfinPlayingAnswer)
}

// JellyfinPlayingImageHandler serves a poster the tile's last answer named.
func (h *Handlers) JellyfinPlayingImageHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaImage(w, r, "jellyfin-playing", h.fetchJellyfinImage)
}
