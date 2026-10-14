package app

import (
	"net/http"
	"strings"
)

/*
A tag taken off a bookmark by hand is a tag turned down.

Suggestions already stay down once refused from the panel or a chip
(Settings.DismissedTagSuggestions, "site|tag"). A reader who removes #video
from a youtube.com bookmark has said the same thing in another place, and a
lookup round that put it straight back would be ignoring them. So every save
that drops a tag from a bookmark records "host|tag" with the other refusals,
where "Turned down" lists it and "Offer again" can take it back.

Recorded at the source -- the two routes a bookmark's tags are written
through -- rather than in each of the dozen places in the browser that edit
tags. A bookmark that disappears from the page is deleted or moved, not
re-tagged, and records nothing.
*/

// refusedTagsHeader carries what a save recorded back to the browser, which
// adds it to the settings it holds: the next settings save from that tab
// would otherwise write its older list over this one.
const refusedTagsHeader = "X-NextDash-Refused-Tags"

// wantedTagsHeader names the refusals a save took back, for the same reason.
const wantedTagsHeader = "X-NextDash-Wanted-Tags"

// undoHeader marks a write that puts things back the way they were. A tag an
// undo takes off was put there a moment ago by the step being undone -- an
// applied suggestion, most often -- and is not one the reader turned down.
const undoHeader = "X-NextDash-Undo"

/*
refuseRemovedTags records the tags a save took off, and forgets the refusals
a save took back: a tag put (back) on a bookmark by hand is plainly wanted
there, and "Turned down" should stop saying otherwise.
*/
func (h *Handlers) refuseRemovedTags(w http.ResponseWriter, r *http.Request, before, after []Bookmark) {
	undo := r.Header.Get(undoHeader) == "1"
	previous := make(map[string][]string, len(before))
	for _, bm := range before {
		if key := canonicalBookmarkURLKey(bm.URL); key != "" {
			previous[key] = normalizeTags(bm.Tags)
		}
	}
	var refused []string
	wanted := map[string]bool{}
	for _, bm := range after {
		key := canonicalBookmarkURLKey(bm.URL)
		old, ok := previous[key]
		if !ok {
			continue
		}
		host := normalizeCatalogueHost(hostOfURL(bm.URL))
		if host == "" {
			continue
		}
		was := map[string]bool{}
		for _, tag := range old {
			was[tag] = true
		}
		now := map[string]bool{}
		for _, tag := range normalizeTags(bm.Tags) {
			now[tag] = true
			if !was[tag] {
				wanted[host+"|"+tag] = true
			}
		}
		if undo {
			continue
		}
		for _, tag := range old {
			if !now[tag] {
				refused = append(refused, host+"|"+tag)
			}
		}
	}
	if len(refused) == 0 && len(wanted) == 0 {
		return
	}
	settings := h.store.GetSettings()
	var kept, forgotten []string
	for _, entry := range settings.DismissedTagSuggestions {
		if wanted[entry] {
			forgotten = append(forgotten, entry)
		} else {
			kept = append(kept, entry)
		}
	}
	// Full: the oldest refusals give way, so the newest -- the one the reader
	// just made -- is never the one dropped.
	all := append(kept, refused...)
	if len(all) > dismissedTagSuggestionsMax {
		all = all[len(all)-dismissedTagSuggestionsMax:]
	}
	merged := sanitizeDismissedTagSuggestions(all)
	if strings.Join(merged, ",") == strings.Join(settings.DismissedTagSuggestions, ",") {
		return
	}
	settings.DismissedTagSuggestions = merged
	if err := h.store.SaveSettings(settings); err != nil {
		return
	}
	if len(refused) > 0 {
		w.Header().Set(refusedTagsHeader, strings.Join(refused, ","))
	}
	if len(forgotten) > 0 {
		w.Header().Set(wantedTagsHeader, strings.Join(forgotten, ","))
	}
}
