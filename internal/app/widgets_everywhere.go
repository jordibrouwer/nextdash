package app

import (
	"errors"
	"fmt"
	"reflect"
	"slices"
)

/*
A widget that is on every page.

Switched on, the widget gets a real copy on each page: the same id, stored in
that page's own file and named in that page's own block order. Moving it,
resizing it, hiding it or limiting it to a screen therefore works the way it
does for any widget, per page. Title and settings are shared: saving a change on
one page carries it to the copies.

What stays per page is what a page decides about its own layout, see
perPageWidgetKeys, plus the place in the block order and visibleOn.

Taking a copy off one page (the normal delete) leaves the others and puts that
page in EverywhereSkip, so a later save does not bring it back. Switching the
setting off removes the copies from the other pages and keeps the one in hand.
Switching it off and on again clears the skip list.
*/

// perPageWidgetKeys are the Config keys each copy keeps for itself: whether it
// is shown on that page and how wide it is there.
var perPageWidgetKeys = []string{"enabled", "columns"}

// widgetEverywhereMaxSkip bounds the skip list: a page id list longer than the
// number of pages a dashboard has is a sign of a bad write, not a layout.
const widgetEverywhereMaxSkip = 200

// mirrorable reports whether a widget takes part in "on every page". A stack
// does not: its members are widgets of its own page, which the other pages lack.
func (w Widget) mirrorable() bool {
	return w.everywhereOn() && w.Type != WidgetTypeStack
}

// everywhereOn reports whether the setting is on; absent counts as off here,
// and keepEverywhere is what stops an absent flag from switching a stored one off.
func (w Widget) everywhereOn() bool {
	return w.Everywhere != nil && *w.Everywhere
}

/*
keepEverywhere reconciles the incoming widgets with the stored ones before they
are normalised.

A save that leaves the setting out (an older tab, a payload built by hand) keeps
what is stored: only an explicit false switches it off. The skip list belongs to
the server: a stale list sent back must not forget a page that took its copy
off, so for a widget that is on in both the two lists are joined. Switching it on
again from off starts the list over.

The revision is the server's too. A tab that saves a lower one than stored has
not seen a change another page pushed into this copy; its title and shared
settings are what it loaded, and sent back they would undo that change on
every page. The stored ones stay, the page's own keys are taken. A save without
a revision (an older tab, a payload built by hand) is taken as it is.
*/
func keepEverywhere(incoming, stored []Widget) []Widget {
	byID := make(map[string]Widget, len(stored))
	for _, widget := range stored {
		byID[widget.ID] = widget
	}
	out := make([]Widget, len(incoming))
	copy(out, incoming)
	for i, widget := range out {
		old, ok := byID[widget.ID]
		if !ok {
			continue
		}
		switch {
		case widget.Everywhere == nil && old.everywhereOn():
			on := true
			out[i].Everywhere = &on
			out[i].EverywhereSkip = slices.Clone(old.EverywhereSkip)
		case widget.everywhereOn() && old.everywhereOn():
			out[i].EverywhereSkip = append(slices.Clone(old.EverywhereSkip), widget.EverywhereSkip...)
			if widget.EverywhereRev > 0 && widget.EverywhereRev < old.EverywhereRev {
				out[i].Title = old.Title
				out[i].Config = staleSharedConfig(old.Config, widget.Config)
			}
		case widget.everywhereOn():
			out[i].EverywhereSkip = nil
		}
		out[i].EverywhereRev = old.EverywhereRev
	}
	return out
}

// staleSharedConfig is the stored shared settings with the page's own keys
// taken from what a stale tab sent.
func staleSharedConfig(stored, sent map[string]any) map[string]any {
	out := sharedConfig(stored)
	for _, key := range perPageWidgetKeys {
		if value, ok := sent[key]; ok {
			out[key] = value
		}
	}
	return out
}

// normalizeEverywhereSkip keeps positive page ids once each, in order.
func normalizeEverywhereSkip(ids []int) []int {
	if len(ids) == 0 {
		return nil
	}
	out := make([]int, 0, len(ids))
	for _, id := range ids {
		if id <= 0 || slices.Contains(out, id) {
			continue
		}
		out = append(out, id)
		if len(out) >= widgetEverywhereMaxSkip {
			break
		}
	}
	slices.Sort(out)
	if len(out) == 0 {
		return nil
	}
	return out
}

// sharedConfig is a copy of config without the keys a page keeps for itself.
func sharedConfig(config map[string]any) map[string]any {
	out := make(map[string]any, len(config))
	for key, value := range config {
		if slices.Contains(perPageWidgetKeys, key) {
			continue
		}
		out[key] = value
	}
	return out
}

// sameSharedState reports whether two widgets agree on everything a copy shares.
func sameSharedState(a, b Widget) bool {
	return a.Title == b.Title &&
		a.everywhereOn() == b.everywhereOn() &&
		slices.Equal(a.EverywhereSkip, b.EverywhereSkip) &&
		reflect.DeepEqual(sharedConfig(a.Config), sharedConfig(b.Config))
}

// mirroredInto is the widget as it should read on another page: the source's
// shared state on top of whatever that page already keeps for itself.
func mirroredInto(source Widget, existing *Widget) Widget {
	config := sharedConfig(source.Config)
	on := true
	out := Widget{
		ID:             source.ID,
		Type:           source.Type,
		Title:          source.Title,
		Everywhere:     &on,
		EverywhereSkip: slices.Clone(source.EverywhereSkip),
		Config:         config,
	}
	if existing == nil {
		out.VisibleOn = source.VisibleOn
		for _, key := range perPageWidgetKeys {
			if value, ok := source.Config[key]; ok {
				config[key] = value
			}
		}
		return out
	}
	out.VisibleOn = existing.VisibleOn
	out.EverywhereRev = existing.EverywhereRev
	for _, key := range perPageWidgetKeys {
		if value, ok := existing.Config[key]; ok {
			config[key] = value
		}
	}
	return out
}

// everywherePageIDs lists the pages a copy can live on: every page but the one
// named and the hidden ones.
func (fs *FileStore) everywherePageIDs(except int) []int {
	var ids []int
	for _, page := range fs.getPages() {
		if page.ID == except || page.Hidden {
			continue
		}
		ids = append(ids, page.ID)
	}
	return ids
}

// editPageWidgetsLocked reads a page, lets edit change its widgets and writes
// the page back when it did. The block order is resolved afterwards, so a widget
// the edit added lands last and one it removed leaves no gap.
func (fs *FileStore) editPageWidgetsLocked(pageID int, edit func(widgets []Widget) ([]Widget, bool)) error {
	page, err := fs.readPageWithBookmarksLocked(pageID)
	if err != nil {
		if errors.Is(err, ErrBookmarkNotFound) {
			return nil
		}
		return err
	}
	next, changed := edit(normalizeWidgets(page.Widgets))
	if !changed {
		return nil
	}
	page.Widgets = next
	page.BlockOrder = resolveBlockOrder(page.BlockOrder, page.Categories, normalizeWidgets(next))
	path := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	if err := fs.writeStoreJSONFile(path, page, pageID); err != nil {
		return err
	}
	fs.invalidateReadCache()
	return nil
}

// syncEverywhereLocked carries what a save on one page did to its "on every
// page" widgets over to the other pages. before and after are that page's
// normalised widgets around the save.
//
// A widget whose shared state did not change is left alone: a save that only
// moved things around must not overwrite a copy somebody edited a moment ago
// from another page.
func (fs *FileStore) syncEverywhereLocked(pageID int, before, after []Widget) error {
	beforeByID := make(map[string]Widget, len(before))
	for _, widget := range before {
		beforeByID[widget.ID] = widget
	}
	afterByID := make(map[string]Widget, len(after))
	for _, widget := range after {
		afterByID[widget.ID] = widget
	}

	var first error
	note := func(err error) {
		if err != nil && first == nil {
			first = err
		}
	}

	for _, widget := range after {
		if !widget.mirrorable() {
			continue
		}
		if old, had := beforeByID[widget.ID]; had && old.mirrorable() && sameSharedState(old, widget) {
			continue
		}
		note(fs.pushEverywhereLocked(pageID, widget))
	}
	for _, old := range before {
		if !old.mirrorable() {
			continue
		}
		now, present := afterByID[old.ID]
		switch {
		case !present:
			// The copy was taken off this page: the others stay, and this page
			// is remembered so a later save does not put it back.
			note(fs.skipEverywhereLocked(pageID, old))
		case !now.mirrorable():
			note(fs.dropEverywhereLocked(pageID, old.ID))
		}
	}
	return first
}

// pushEverywhereLocked writes the widget to every other page that has not
// opted out of it, adding a copy where there is none.
func (fs *FileStore) pushEverywhereLocked(pageID int, source Widget) error {
	var first error
	for _, other := range fs.everywherePageIDs(pageID) {
		if slices.Contains(source.EverywhereSkip, other) {
			continue
		}
		err := fs.editPageWidgetsLocked(other, func(widgets []Widget) ([]Widget, bool) {
			for i := range widgets {
				if widgets[i].ID != source.ID {
					continue
				}
				// An unrelated widget that happens to share the id is left alone.
				if widgets[i].Type != source.Type {
					return widgets, false
				}
				next := mirroredInto(source, &widgets[i])
				if reflect.DeepEqual(next, widgets[i]) {
					return widgets, false
				}
				// A tab still holding this page's copy at the old revision
				// now reads as stale.
				next.EverywhereRev = max(widgets[i].EverywhereRev, source.EverywhereRev) + 1
				out := slices.Clone(widgets)
				out[i] = next
				return out, true
			}
			if len(widgets) >= widgetMaxPerPage {
				return widgets, false
			}
			return append(slices.Clone(widgets), mirroredInto(source, nil)), true
		})
		if err != nil && first == nil {
			first = err
		}
	}
	return first
}

// skipEverywhereLocked records, on every remaining copy, that pageID no longer
// carries the widget.
func (fs *FileStore) skipEverywhereLocked(pageID int, gone Widget) error {
	skip := normalizeEverywhereSkip(append(slices.Clone(gone.EverywhereSkip), pageID))
	var first error
	for _, other := range fs.everywherePageIDs(pageID) {
		err := fs.editPageWidgetsLocked(other, func(widgets []Widget) ([]Widget, bool) {
			for i := range widgets {
				if widgets[i].ID != gone.ID || !widgets[i].mirrorable() || slices.Equal(widgets[i].EverywhereSkip, skip) {
					continue
				}
				out := slices.Clone(widgets)
				out[i].EverywhereSkip = skip
				return out, true
			}
			return widgets, false
		})
		if err != nil && first == nil {
			first = err
		}
	}
	return first
}

// dropEverywhereLocked removes the copies from every page but pageID: the
// setting was switched off there.
func (fs *FileStore) dropEverywhereLocked(pageID int, id string) error {
	var first error
	for _, other := range fs.everywherePageIDs(pageID) {
		err := fs.editPageWidgetsLocked(other, func(widgets []Widget) ([]Widget, bool) {
			for i := range widgets {
				if widgets[i].ID != id || !widgets[i].mirrorable() {
					continue
				}
				return slices.Delete(slices.Clone(widgets), i, i+1), true
			}
			return widgets, false
		})
		if err != nil && first == nil {
			first = err
		}
	}
	return first
}

// forgetEverywhereSkipLocked takes a deleted page off the skip lists: page ids
// are handed out again, and a new page must not inherit the old one's opt-out.
func (fs *FileStore) forgetEverywhereSkipLocked(pageID int) {
	for _, other := range fs.everywherePageIDs(pageID) {
		_ = fs.editPageWidgetsLocked(other, func(widgets []Widget) ([]Widget, bool) {
			var out []Widget
			for i := range widgets {
				if !widgets[i].mirrorable() || !slices.Contains(widgets[i].EverywhereSkip, pageID) {
					continue
				}
				if out == nil {
					out = slices.Clone(widgets)
				}
				out[i].EverywhereSkip = normalizeEverywhereSkip(slices.DeleteFunc(slices.Clone(widgets[i].EverywhereSkip), func(id int) bool { return id == pageID }))
			}
			if out == nil {
				return widgets, false
			}
			return out, true
		})
	}
}

// mirrorEverywhereIntoNewPage gives a page that is being created a copy of every
// "on every page" widget the other pages carry.
func (fs *FileStore) mirrorEverywhereIntoNewPage(page *PageWithBookmarks) {
	if page.Page.Hidden {
		return
	}
	seen := make(map[string]bool, len(page.Widgets))
	for _, widget := range page.Widgets {
		seen[widget.ID] = true
	}
	for _, other := range fs.everywherePageIDs(page.Page.ID) {
		source, err := fs.readPageWithBookmarksLocked(other)
		if err != nil {
			continue
		}
		for _, widget := range normalizeWidgets(source.Widgets) {
			if !widget.mirrorable() || seen[widget.ID] || len(page.Widgets) >= widgetMaxPerPage {
				continue
			}
			seen[widget.ID] = true
			page.Widgets = append(page.Widgets, mirroredInto(widget, nil))
		}
	}
	if len(page.Widgets) > 0 {
		page.BlockOrder = resolveBlockOrder(page.BlockOrder, page.Categories, normalizeWidgets(page.Widgets))
	}
}
