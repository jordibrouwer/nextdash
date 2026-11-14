package app

import "strings"

// Where a block shows. Empty is everywhere and is stored as nothing, so a
// category, widget or collection written before this field existed is shown on
// every device.
const (
	visibleOnDesktop = "desktop"
	visibleOnMobile  = "mobile"
)

// normalizeVisibleOn is the answer a stored word stands for: "desktop",
// "mobile", or empty for everywhere. A word this build does not know is
// everywhere, so a block never disappears because of a typo or a newer file.
func normalizeVisibleOn(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case visibleOnDesktop:
		return visibleOnDesktop
	case visibleOnMobile:
		return visibleOnMobile
	}
	return ""
}

// normalizeCollectionVisibleOn cleans the map for the collections that have no
// record of their own (the built-in and per-tag ones). Everywhere is the
// absence of an entry.
func normalizeCollectionVisibleOn(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for id, value := range in {
		id = strings.TrimSpace(id)
		if id == "" || !isCollectionBlockID(id) {
			continue
		}
		if v := normalizeVisibleOn(value); v != "" {
			out[id] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// normalizeMobileHome is the start screen a phone opens on: "search" (search
// first) or "status" (status first). Anything else is search.
func normalizeMobileHome(value string) string {
	if strings.ToLower(strings.TrimSpace(value)) == "status" {
		return "status"
	}
	return "search"
}
