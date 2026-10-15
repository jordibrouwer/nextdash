package app

import (
	"context"
	"net/http"
	"net/url"
)

// fetchJellyfinImage asks Jellyfin for a poster or a backdrop, scaled down by
// Jellyfin itself so the proxy never carries a full-size original.
func (h *Handlers) fetchJellyfinImage(ctx context.Context, server string, credential HealthCredential, ref mediaImageRef) ([]byte, error) {
	return h.fetchFlavoredImage(jellyfinFlavorJellyfin)(ctx, server, credential, ref)
}

// fetchFlavoredImage is fetchJellyfinImage for one flavor, as the picture
// proxy wants it.
func (h *Handlers) fetchFlavoredImage(flavor jellyfinFlavor) mediaImageFetch {
	return func(ctx context.Context, server string, credential HealthCredential, ref mediaImageRef) ([]byte, error) {
		return h.fetchJellyfinImageFrom(ctx, flavor, server, credential, ref)
	}
}

func (h *Handlers) fetchJellyfinImageFrom(ctx context.Context, flavor jellyfinFlavor, server string, credential HealthCredential, ref mediaImageRef) ([]byte, error) {
	path := "/Items/" + mediaPathEscape(ref.Item) + "/Images/Primary"
	width := "300"
	if ref.Kind == "backdrop" {
		path = "/Items/" + mediaPathEscape(ref.Item) + "/Images/Backdrop/0"
		width = "800"
	}
	query := url.Values{"maxWidth": {width}, "tag": {ref.Tag}, "quality": {"85"}}
	resp, err := h.jellyfinRequest(ctx, flavor, server, credential, path, query, "image/*")
	if err != nil {
		return nil, err
	}
	return readMediaImage(resp)
}

// JellyfinImageHandler serves one picture the widget's last answer offered.
func (h *Handlers) JellyfinImageHandler(w http.ResponseWriter, r *http.Request) {
	h.serveMediaImage(w, r, "jellyfin", h.fetchJellyfinImage)
}
