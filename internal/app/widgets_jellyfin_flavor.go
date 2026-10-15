package app

import (
	"net/url"
)

/*
jellyfinFlavor is the one place Jellyfin and Emby differ.

Emby is where Jellyfin came from, so the same client reads both: the same
headers, libraries, items, sessions and pictures. What differs is small. Emby
serves everything under /emby, lists a user's libraries and latest items with
the user in the path, and opens an item in its web app on another address.
The zero value is Jellyfin.
*/
type jellyfinFlavor struct {
	// Service names the flavor: it keys the media cache and the picture proxy.
	Service string
	// Prefix goes in front of every request path.
	Prefix string
}

var (
	jellyfinFlavorJellyfin = jellyfinFlavor{Service: "jellyfin"}
	jellyfinFlavorEmby     = jellyfinFlavor{Service: "emby", Prefix: "/emby"}
)

func (f jellyfinFlavor) service() string {
	if f.Service == "" {
		return jellyfinFlavorJellyfin.Service
	}
	return f.Service
}

// playingService is the cache and proxy name of the now-playing tile.
func (f jellyfinFlavor) playingService() string { return f.service() + "-playing" }

func (f jellyfinFlavor) isEmby() bool { return f.Service == jellyfinFlavorEmby.Service }

// userViews is the request for the libraries one user sees.
func (f jellyfinFlavor) userViews(userID string) (string, url.Values) {
	if f.isEmby() {
		return "/Users/" + mediaPathEscape(userID) + "/Views", nil
	}
	return "/UserViews", url.Values{"userId": {userID}}
}

// latest is the request for a user's latest items; the caller adds the rest
// of the query.
func (f jellyfinFlavor) latest(userID string) (string, url.Values) {
	if f.isEmby() {
		return "/Users/" + mediaPathEscape(userID) + "/Items/Latest", url.Values{}
	}
	return "/Items/Latest", url.Values{"userId": {userID}}
}

// openURL is where an item opens in the server's own web app.
func (f jellyfinFlavor) openURL(server, itemID, serverID string) string {
	if f.isEmby() {
		link := server + "/web/index.html#!/item?id=" + url.QueryEscape(itemID)
		if serverID != "" {
			link += "&serverId=" + url.QueryEscape(serverID)
		}
		return link
	}
	link := server + "/web/#/details?id=" + url.QueryEscape(itemID)
	if serverID != "" {
		link += "&serverId=" + url.QueryEscape(serverID)
	}
	return link
}
