package main

import (
	"fmt"
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
				if value = trimToLength(strings.TrimSpace(value), widgetMaxIDLen); value != "" &&
					widgetValueAllowed(value, field.Allowed) {
					clean[field.Key] = value
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
