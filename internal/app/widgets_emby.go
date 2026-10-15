package app

import (
	"context"
	"net/http"
)

/*
The Emby widgets: the Jellyfin client, pointed at Emby's flavor of the same
API (see jellyfinFlavor). Only the names differ here, so caches and picture
proxies never mix with a Jellyfin tile's.
*/

func (h *Handlers) embyAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	return h.flavoredAnswer(ctx, pageID, widget, forced, jellyfinFlavorEmby)
}

func (h *Handlers) embyPlayingAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	return h.flavoredPlayingAnswer(ctx, pageID, widget, forced, jellyfinFlavorEmby)
}

// EmbyHandler answers what one Emby tile should draw.
func (h *Handlers) EmbyHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeEmby, h.embyAnswer)
}

// EmbyImageHandler serves one picture the widget's last answer offered.
func (h *Handlers) EmbyImageHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaImage(w, r, jellyfinFlavorEmby.service(), h.fetchFlavoredImage(jellyfinFlavorEmby))
}

// EmbySetupHandler tries an address and a key, like JellyfinSetupHandler.
func (h *Handlers) EmbySetupHandler(w http.ResponseWriter, r *http.Request) {
	h.jellyfinSetup(w, r, jellyfinFlavorEmby)
}

// EmbyPlayingHandler answers what one Emby now-playing tile should draw.
func (h *Handlers) EmbyPlayingHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaWidget(w, r, WidgetTypeEmbyPlaying, h.embyPlayingAnswer)
}

// EmbyPlayingImageHandler serves a poster the tile's last answer named.
func (h *Handlers) EmbyPlayingImageHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaImage(w, r, jellyfinFlavorEmby.playingService(), h.fetchFlavoredImage(jellyfinFlavorEmby))
}
