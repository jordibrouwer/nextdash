package main

import (
	"fmt"
	neturl "net/url"
	"strings"
)

/*
What a widget may be told, and what is dropped on the way in.

normalizeWidget checked the type, the id and the title, and passed Config
through untouched -- so whatever a client sent was written to bookmarks-N.json:
unknown keys, values of any size, nesting of any depth. With one type reading
one field that was a small thing. With eight types carrying filters it is a
storage question, and the file it lands in is the one holding every bookmark
someone owns.

So each type declares its own fields, and a value that does not fit becomes the
default rather than an error. That direction matters: a widget stored by a newer
version, or edited by hand, keeps working with the settings this version
understands instead of refusing to load. Nothing here can fail -- it can only
narrow.

The shapes are deliberately small. A widget setting is a number, a flag, a short
identifier or a short list of them; anything larger belongs in the view the
widget links to.
*/

const (
	// widgetMaxRows bounds every "how many lines" setting. A tile that grows
	// past a dozen rows is a view, and there is already a view.
	widgetMaxRows = 20
	// widgetMinRows keeps a tile from being configured into emptiness.
	widgetMinRows = 1
	// widgetMaxListLen bounds a list of ids -- pages, tags, which figures to
	// show. Longer than this is not a filter, it is a copy of the data.
	widgetMaxListLen = 24
	// widgetMaxIDLen bounds one entry in such a list.
	widgetMaxIDLen = 64
	// widgetMaxDays bounds a "within N days" or "over N days" window. Two years
	// is past every useful reading and short of anything absurd.
	widgetMaxDays = 730
	// widgetMaxColumns is how wide a widget may ever be drawn.
	widgetMaxColumns = 2
	// widgetMaxURLLen bounds a custom widget's address. Long enough for a query
	// string a service actually uses, short of anything being smuggled.
	widgetMaxURLLen = 2000
	// widgetMaxPathLen bounds a dotted path into a response.
	widgetMaxPathLen = 200
)

/*
widgetField describes one setting a type accepts.

A table rather than a switch per type: the sanitiser reads it, and the config UI
is generated from the same shape on the client, so a field that exists in one
and not the other is a mismatch that shows up immediately rather than a setting
that silently does nothing -- which is exactly what happened to the health
widget's own `show`.
*/
type widgetField struct {
	Key string
	// Kind is bool, int, string or list.
	Kind string
	// Min and Max bound an int. Ignored for other kinds.
	Min, Max int
	// Allowed, when set, is the complete set of values a string or list entry
	// may take. Anything else is dropped.
	Allowed []string
	// MaxLen overrides the default cap for a string. A widget setting is
	// usually an identifier and 64 characters is plenty, but a URL is not an
	// identifier -- and silently truncating one produces an address that looks
	// configured and fetches nothing.
	MaxLen int
}

// widgetFields is what each type accepts. A type absent from here accepts
// nothing, which is the safe default for a type added without its settings.
var widgetFields = map[WidgetType][]widgetField{
	WidgetTypeHealth: {
		// Read since the day the health widget shipped, and never settable
		// until now: nothing in the config UI wrote it.
		{Key: "show", Kind: "list", Allowed: []string{"broken", "down", "content", "healthy"}},
		{Key: "pageId", Kind: "int", Min: 0, Max: 1 << 20},
	},
	WidgetTypeUptime: {
		{Key: "pageId", Kind: "int", Min: 0, Max: 1 << 20},
		{Key: "tags", Kind: "list"},
		{Key: "downOnly", Kind: "bool"},
		{Key: "sparkline", Kind: "bool"},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
	WidgetTypeCerts: {
		// No bookmark filter: expiry belongs to the host, and ten bookmarks on
		// one domain are one line. The threshold is the whole question.
		{Key: "withinDays", Kind: "int", Min: 1, Max: widgetMaxDays},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
	WidgetTypeTrend: {
		// One line over everything. Filtering it would make the line mean
		// something else than "how is this collection doing".
		{Key: "days", Kind: "int", Min: 7, Max: 90},
	},
	WidgetTypeInbox: {
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "showSource", Kind: "bool"},
	},
	WidgetTypeFeeds: {
		{Key: "freshOnly", Kind: "bool"},
		{Key: "showRetired", Kind: "bool"},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
	WidgetTypeSources: {
		{Key: "errorsOnly", Kind: "bool"},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
	/*
	 * The custom widget's config is shaped rather than flat: fields[] is a list
	 * of objects, which the table below cannot describe.
	 *
	 * So it declares the scalars here and sanitiseCustomWidgetConfig handles
	 * the list -- rather than growing the table a nested-object kind that only
	 * one type would ever use.
	 */
	WidgetTypeArchive: {
		{Key: "pageId", Kind: "int", Min: 0, Max: 1 << 20},
		// brokenOnly changes the question rather than the filter: off, the
		// coverage is of the whole collection; on, it is of the links that are
		// already broken -- "of what died, how much did I keep".
		{Key: "brokenOnly", Kind: "bool"},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
	WidgetTypeTrash: {
		// warnDays is when an entry starts reading as urgent. Bounded well
		// under the retention window, since a warning that covers the whole
		// window warns about everything and therefore about nothing.
		{Key: "warnDays", Kind: "int", Min: 1, Max: 30},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
	WidgetTypeUnchecked: {
		{Key: "pageId", Kind: "int", Min: 0, Max: 1 << 20},
		{Key: "staleDays", Kind: "int", Min: 1, Max: widgetMaxDays},
		// A bookmark with checking switched off is a deliberate choice, not a
		// gap, so whether it counts is the reader's to decide.
		{Key: "includeDisabled", Kind: "bool"},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
	WidgetTypeDuplicates: {
		// minCount is how many copies make a finding. Two is the default and
		// the floor -- one copy is not a duplicate of anything.
		{Key: "minCount", Kind: "int", Min: 2, Max: widgetMaxRows},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
	WidgetTypeBackups: {
		{Key: "showList", Kind: "bool"},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
	WidgetTypeCustom: {
		{Key: "url", Kind: "url"},
		{Key: "method", Kind: "string", Allowed: []string{"GET", "POST"}},
		{Key: "credentialId", Kind: "string"},
		{Key: "ttl", Kind: "int", Min: customWidgetMinTTL, Max: customWidgetMaxTTL},
		{Key: "itemsPath", Kind: "string", MaxLen: widgetMaxPathLen},
	},
	WidgetTypeNeglected: {
		{Key: "pageId", Kind: "int", Min: 0, Max: 1 << 20},
		{Key: "tags", Kind: "list"},
		// Never-opened and not-opened-in-a-year are two different findings, so
		// whether the first counts is a choice rather than an assumption.
		{Key: "includeNeverOpened", Kind: "bool"},
		{Key: "sinceDays", Kind: "int", Min: 7, Max: widgetMaxDays},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
	},
}

/*
sanitizeWidgetConfig keeps what the type declares and drops the rest.

Never returns an error. A setting that cannot be read becomes absent, which the
renderer already treats as "use the default" -- so a widget written by a newer
version degrades to this version's understanding rather than refusing to load.
*/
func sanitizeWidgetConfig(widgetType WidgetType, config map[string]any) map[string]any {
	clean := map[string]any{}
	if config == nil {
		return clean
	}
	/*
	 * enabled is not in the table because every type has it: the config UI
	 * writes it for the "Shown" toggle, and a type declaring it would be eight
	 * copies of one line.
	 */
	if raw, ok := config["enabled"]; ok {
		if enabled, isBool := raw.(bool); isBool {
			clean["enabled"] = enabled
		}
	}
	/*
	 * columns is shared for the same reason enabled is: every type can be one
	 * or two columns wide, and declaring it eight times would be eight copies
	 * of one line.
	 *
	 * Two is the ceiling. A widget is a summary; one that needs three columns
	 * is a view that has not admitted it yet. What the grid actually has is
	 * decided when it is drawn -- a dashboard showing one column narrows the
	 * widget rather than dropping it.
	 */
	if raw, ok := config["columns"]; ok {
		if columns, valid := widgetConfigInt(raw); valid && columns >= 1 && columns <= widgetMaxColumns {
			clean["columns"] = columns
		}
	}

	// The one nested setting, handled before the flat ones below.
	if widgetType == WidgetTypeCustom {
		if fields := sanitizeCustomWidgetFields(config["fields"]); fields != nil {
			clean["fields"] = fields
		}
	}

	for _, field := range widgetFields[widgetType] {
		raw, ok := config[field.Key]
		if !ok {
			continue
		}
		switch field.Kind {
		case "bool":
			if value, isBool := raw.(bool); isBool {
				clean[field.Key] = value
			}
		case "int":
			if value, ok := widgetConfigInt(raw); ok && value >= field.Min && value <= field.Max {
				clean[field.Key] = value
			}
		case "string":
			if value, isString := raw.(string); isString {
				limit := field.MaxLen
				if limit <= 0 {
					limit = widgetMaxIDLen
				}
				if value = trimToLength(strings.TrimSpace(value), limit); value != "" &&
					widgetValueAllowed(value, field.Allowed) {
					clean[field.Key] = value
				}
			}
		case "url":
			// Checked rather than trimmed: an address that is not http(s) would
			// be refused at fetch time anyway, and a stored one reads as
			// configured while never working.
			if value, isString := raw.(string); isString {
				if address := sanitizeWidgetURL(value); address != "" {
					clean[field.Key] = address
				}
			}
		case "list":
			if list := widgetConfigList(raw, field.Allowed); len(list) > 0 {
				clean[field.Key] = list
			}
		}
	}
	return clean
}

/*
widgetConfigInt reads a number from JSON.

Numbers arrive as float64 through encoding/json and as int from Go callers and
tests, so both are read. A float carrying a fraction is refused rather than
truncated: "3.7 rows" is a caller sending the wrong thing, and silently making
it 3 hides that.
*/
func widgetConfigInt(raw any) (int, bool) {
	switch value := raw.(type) {
	case int:
		return value, true
	case int64:
		return int(value), true
	case float64:
		if value != float64(int(value)) {
			return 0, false
		}
		return int(value), true
	}
	return 0, false
}

// widgetConfigList reads a bounded list of short strings, dropping blanks,
// duplicates and anything outside the allowed set.
func widgetConfigList(raw any, allowed []string) []string {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	seen := map[string]struct{}{}
	list := make([]string, 0, len(items))
	for _, item := range items {
		if len(list) >= widgetMaxListLen {
			break
		}
		text, isString := item.(string)
		if !isString {
			continue
		}
		text = trimToLength(strings.TrimSpace(text), widgetMaxIDLen)
		if text == "" || !widgetValueAllowed(text, allowed) {
			continue
		}
		if _, duplicate := seen[text]; duplicate {
			continue
		}
		seen[text] = struct{}{}
		list = append(list, text)
	}
	return list
}

// widgetValueAllowed reports whether a value is in the allowed set. An empty
// set means the field takes free-form short strings -- a tag, a page id.
func widgetValueAllowed(value string, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

// widgetTypeNames lists the register in a stable order, for anything that has
// to present the types rather than dispatch on them.
func widgetTypeNames() []string {
	ordered := []WidgetType{
		WidgetTypeHealth, WidgetTypeUptime, WidgetTypeCerts, WidgetTypeTrend,
		WidgetTypeInbox, WidgetTypeFeeds, WidgetTypeSources, WidgetTypeNeglected,
		WidgetTypeArchive, WidgetTypeUnchecked, WidgetTypeDuplicates,
		WidgetTypeTrash, WidgetTypeBackups,
		// Custom stays last: it is the escape hatch for a service with no
		// widget of its own, and a list that offers it first invites someone
		// to build by hand what is two entries above it.
		WidgetTypeCustom,
	}
	names := make([]string, 0, len(ordered))
	for _, widgetType := range ordered {
		if _, ok := knownWidgetTypes[widgetType]; ok {
			names = append(names, string(widgetType))
		}
	}
	if len(names) != len(knownWidgetTypes) {
		// A type in the register that this list forgot would be addable through
		// the API and absent from the UI, which is the kind of gap that is only
		// noticed much later.
		panic(fmt.Sprintf("widgetTypeNames lists %d of %d registered types",
			len(names), len(knownWidgetTypes)))
	}
	return names
}

/*
sanitizeWidgetURL keeps an address only if it could ever be fetched.

http and https only, and a host that is actually there. Where the request may
*go* is not decided here -- validateHTTPURL does that at fetch time, against the
same "allow local bookmarks" setting every other outbound request obeys, so this
feature does not get a second opinion about the LAN.
*/
func sanitizeWidgetURL(raw string) string {
	address := trimToLength(strings.TrimSpace(raw), widgetMaxURLLen)
	if address == "" {
		return ""
	}
	parsed, err := neturl.Parse(address)
	if err != nil || parsed.Host == "" {
		return ""
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}
	return address
}

/*
sanitizeCustomWidgetFields narrows the one setting that is a list of objects.

Handled beside the table rather than in it: fields[] is the only nested shape
any widget has, and teaching the table about nested objects would be a general
mechanism built for a single caller.
*/
func sanitizeCustomWidgetFields(raw any) []any {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]any, 0, len(items))
	for _, item := range items {
		if len(out) >= customWidgetMaxFields {
			break
		}
		entry, isObject := item.(map[string]any)
		if !isObject {
			continue
		}
		path := trimToLength(strings.TrimSpace(stringOr(entry["path"])), widgetMaxPathLen)
		if path == "" {
			// A field with no path names nothing, and an empty row on a tile
			// reads as a value that failed rather than one never asked for.
			continue
		}
		format := strings.TrimSpace(stringOr(entry["format"]))
		if !customWidgetFormats[format] {
			format = "text"
		}
		clean := map[string]any{"path": path, "format": format}
		if label := trimToLength(strings.TrimSpace(stringOr(entry["label"])), 60); label != "" {
			clean["label"] = label
		}
		out = append(out, clean)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
