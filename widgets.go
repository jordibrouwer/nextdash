package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

/*
Widgets: a block on the dashboard that holds something other than bookmarks.

The grid already draws blocks that are not categories -- smart collections go
through the same column builder -- so a widget is a third kind of block rather
than a new rendering model. What it needs that those did not is a place in the
order: a smart collection always sits at the top, and a widget has to be able to
live between two categories the reader chose.

Stored beside categories in bookmarks-N.json, because they share one ordering.
Two files each carrying half the order is how a drag ends up writing one and not
the other, and then the dashboard and the config screen disagree about where
something is.
*/

// widgetIDPrefix marks a block id as a widget, so one glance at an entry in
// BlockOrder says which list it belongs to without consulting either.
const widgetIDPrefix = "w_"

// WidgetType is a kind of widget the server will accept.
type WidgetType string

const (
	// WidgetTypeHealth reports what the health view would report, in a block.
	WidgetTypeHealth WidgetType = "health"
	// WidgetTypeUptime lists monitored bookmarks by how well they have been
	// answering -- what is down now, uptime over a window, the longest outage.
	WidgetTypeUptime WidgetType = "uptime"
	// WidgetTypeCerts lists certificates about to expire, grouped by host: ten
	// bookmarks on one domain are one line, because expiry is a property of the
	// host and not of any one bookmark.
	WidgetTypeCerts WidgetType = "certs"
	// WidgetTypeTrend draws broken links over time. One number cannot say
	// whether things are getting better; the line can.
	WidgetTypeTrend WidgetType = "trend"
	// WidgetTypeInbox reports what is waiting to be filed, and how long it has
	// been waiting.
	WidgetTypeInbox WidgetType = "inbox"
	// WidgetTypeFeeds reports feeds with fresh items, and -- the part nobody
	// sees today -- the feeds that retired themselves after repeated failures.
	WidgetTypeFeeds WidgetType = "feeds"
	// WidgetTypeSources reports what each import source last did. An import that
	// failed is visible only in config today, so it is found by wondering why
	// nothing new arrived.
	WidgetTypeSources WidgetType = "sources"
	// WidgetTypeNeglected asks the graveyard question in reverse: not which link
	// died, but which one you stopped opening.
	WidgetTypeNeglected WidgetType = "neglected"
	/*
	 * WidgetTypeCustom reads a figure out of any JSON endpoint.
	 *
	 * The one escape hatch, and the only widget that talks to anything outside.
	 * A dashboard that grows a widget per service ends up maintaining one thing
	 * per upstream release it does not control; this answers "my service is not
	 * in the list" without adding a codepath per service.
	 */
	WidgetTypeCustom WidgetType = "custom"
)

// knownWidgetTypes is the register. A type not in here is refused rather than
// stored: a widget whose type nothing renders is an invisible block that still
// takes a place in the order.
var knownWidgetTypes = map[WidgetType]struct{}{
	WidgetTypeHealth:    {},
	WidgetTypeUptime:    {},
	WidgetTypeCerts:     {},
	WidgetTypeTrend:     {},
	WidgetTypeInbox:     {},
	WidgetTypeFeeds:     {},
	WidgetTypeSources:   {},
	WidgetTypeNeglected: {},
	WidgetTypeCustom:    {},
}

var errUnknownWidgetType = errors.New("unknown widget type")

/*
Widget is one block.

Config is deliberately a free-form map rather than a struct per type: the server
stores and orders widgets, and what a health widget needs to know is the health
widget's business. A typed field per setting would mean every new widget type
changes this file and every file that reads it.
*/
type Widget struct {
	ID    string     `json:"id"`
	Type  WidgetType `json:"type"`
	Title string     `json:"title,omitempty"`
	// Config is whatever that type understands. Never nil after normalisation,
	// so a renderer can read it without checking.
	Config map[string]any `json:"config,omitempty"`
}

// newWidgetID mints an id that cannot collide with a category slug.
//
// Random rather than sequential: ids end up in BlockOrder, and a counter would
// hand a deleted widget's number to the next one, which then inherits its place
// in the order.
func newWidgetID() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		// A source of randomness that fails is not something to paper over with
		// a predictable id; the caller gets an empty one and refuses the write.
		return ""
	}
	return widgetIDPrefix + hex.EncodeToString(buf)
}

// isWidgetID reports whether a block id names a widget.
func isWidgetID(id string) bool {
	return strings.HasPrefix(id, widgetIDPrefix)
}

/*
normalizeWidget trims a widget into the shape the rest of the code may assume.

Returns an error for a type nothing renders, because storing one would put a
block in the order that draws nothing -- a gap in the grid with no way to select
or remove it from the dashboard.
*/
func normalizeWidget(widget Widget) (Widget, error) {
	widget.Type = WidgetType(strings.TrimSpace(string(widget.Type)))
	if _, ok := knownWidgetTypes[widget.Type]; !ok {
		return Widget{}, errUnknownWidgetType
	}

	widget.ID = strings.TrimSpace(widget.ID)
	if !isWidgetID(widget.ID) {
		widget.ID = newWidgetID()
	}
	if widget.ID == "" {
		return Widget{}, errors.New("could not generate a widget id")
	}

	widget.Title = strings.TrimSpace(widget.Title)
	if len(widget.Title) > 80 {
		widget.Title = widget.Title[:80]
	}
	// Config is the client's, so it is narrowed to what this type declares
	// before it reaches storage -- see sanitizeWidgetConfig.
	widget.Config = sanitizeWidgetConfig(widget.Type, widget.Config)
	return widget, nil
}

/*
resolveBlockOrder decides the order the dashboard draws blocks in.

Three rules, and the second is the one that matters:

Stored order first, for the ids that still exist. An id naming something that
has since been deleted is skipped rather than leaving a hole.

Anything not named in the stored order goes after it, categories before widgets,
each in its own existing order. That is what makes this safe to add to a file
written before BlockOrder existed: with no stored order at all, every category
falls through to this rule and comes out exactly as it went in.

And nothing appears twice, however often the stored order names it.
*/
func resolveBlockOrder(stored []string, categories []Category, widgets []Widget) []string {
	known := make(map[string]struct{}, len(categories)+len(widgets))
	for _, category := range categories {
		if id := strings.TrimSpace(category.ID); id != "" {
			known[id] = struct{}{}
		}
	}
	for _, widget := range widgets {
		if id := strings.TrimSpace(widget.ID); id != "" {
			known[id] = struct{}{}
		}
	}

	out := make([]string, 0, len(known))
	placed := make(map[string]struct{}, len(known))
	for _, id := range stored {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, exists := known[id]; !exists {
			continue
		}
		if _, already := placed[id]; already {
			continue
		}
		placed[id] = struct{}{}
		out = append(out, id)
	}

	for _, category := range categories {
		id := strings.TrimSpace(category.ID)
		if id == "" {
			continue
		}
		if _, already := placed[id]; already {
			continue
		}
		placed[id] = struct{}{}
		out = append(out, id)
	}
	for _, widget := range widgets {
		id := strings.TrimSpace(widget.ID)
		if id == "" {
			continue
		}
		if _, already := placed[id]; already {
			continue
		}
		placed[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// widgetMaxPerPage bounds a page. Twenty-four is two columns of a screenful:
// past that a widget is no longer a summary of the page, it is the page. The
// body limit on the save route is not a substitute -- it bounds the bytes, not
// the number of blocks the grid then has to draw on every render.
const widgetMaxPerPage = 24

/*
normalizeWidgets cleans a page's widgets, dropping the ones nothing renders.

Dropping rather than refusing the whole write: a file that arrived from an older
or newer version should still open, minus the block that cannot be drawn. The
cap is applied on the way out for the same reason -- a file that somehow holds
more is read as its first twenty-four rather than refused entirely.
*/
func normalizeWidgets(widgets []Widget) []Widget {
	if len(widgets) == 0 {
		return nil
	}
	out := make([]Widget, 0, len(widgets))
	seen := make(map[string]struct{}, len(widgets))
	for _, widget := range widgets {
		if len(out) >= widgetMaxPerPage {
			break
		}
		normalized, err := normalizeWidget(widget)
		if err != nil {
			continue
		}
		if _, dup := seen[normalized.ID]; dup {
			continue
		}
		seen[normalized.ID] = struct{}{}
		out = append(out, normalized)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

/*
GetPageBlocks reads a page's widgets and the order its blocks are drawn in.

One call rather than two, because the order is only meaningful beside the things
it orders: fetching them separately invites a caller to draw an order that names
a widget it did not fetch.
*/
func (fs *FileStore) GetPageBlocks(pageID int) ([]Widget, []string) {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	page, err := fs.readPageWithBookmarksLocked(pageID)
	if err != nil {
		return nil, nil
	}
	widgets := normalizeWidgets(page.Widgets)
	return widgets, resolveBlockOrder(page.BlockOrder, page.Categories, widgets)
}

/*
SavePageBlocks writes a page's widgets and block order together.

Read-modify-write inside the lock, touching only these two fields: everything
else in the file belongs to somebody else, and a save that carried a stale copy
of the bookmarks would undo whatever was written between the read and the write.
*/
func (fs *FileStore) SavePageBlocks(pageID int, widgets []Widget, order []string) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	page, err := fs.readPageWithBookmarksLocked(pageID)
	if err != nil {
		return err
	}

	page.Widgets = normalizeWidgets(widgets)
	// Resolved rather than stored as given, so a caller cannot write an order
	// naming blocks that do not exist -- or leave one out and make it vanish.
	page.BlockOrder = resolveBlockOrder(order, page.Categories, page.Widgets)

	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	if err := fs.writeStoreJSONFile(filePath, page, pageID); err != nil {
		return err
	}
	fs.invalidateReadCache()
	return nil
}
