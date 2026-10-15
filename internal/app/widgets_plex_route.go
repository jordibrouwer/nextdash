package app

import (
	"context"
	"net/http"
	"time"
)

func (h *Handlers) plexAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	spec := plexSpecFrom(widget.Config)
	ms := mediaSpec{Service: "plex", Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		return h.fetchPlexLatest(ctx, spec, imageURL)
	}, forced)
}

func (h *Handlers) plexPlayingAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	spec := plexPlayingSpecFrom(widget.Config)
	// A second under the tile's beat, as the Jellyfin one does.
	ms := mediaSpec{Service: "plex-playing", Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL - time.Second}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		return h.fetchPlexPlaying(ctx, spec, imageURL)
	}, forced)
}

// PlexHandler answers what one Plex tile should draw.
func (h *Handlers) PlexHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypePlex, h.plexAnswer)
}

// PlexImageHandler serves one picture the widget's last answer offered.
func (h *Handlers) PlexImageHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaImage(w, r, "plex", h.fetchPlexImage)
}

// PlexPlayingHandler answers what one Plex now-playing tile should draw.
func (h *Handlers) PlexPlayingHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypePlexPlaying, h.plexPlayingAnswer)
}

// PlexPlayingImageHandler serves a poster the tile's last answer named.
func (h *Handlers) PlexPlayingImageHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaImage(w, r, "plex-playing", h.fetchPlexImage)
}
