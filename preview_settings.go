package main

import "strings"

// linkPreviewParts is every row the preview card can draw, in the order it
// draws them. The checklist under Appearance stores a subset of these.
var linkPreviewParts = []string{"image", "description", "note", "tags", "status", "opens", "fresh", "location"}

// normalizeLinkPreviewMode resolves how the card is reached.
//
// Empty means the setting predates the mode — every install until this release — so
// the answer comes from the boolean it replaces: cards on meant cards on hover,
// which is the only way there was.
func normalizeLinkPreviewMode(mode string, legacyEnabled bool) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "off":
		return "off"
	case "hover":
		return "hover"
	case "keyboard":
		return "keyboard"
	}
	if legacyEnabled {
		return "hover"
	}
	return "off"
}

// normalizeLinkPreviewParts keeps the stored list to names the card knows, in
// the card's own order.
//
// A nil list means "everything", which is what a card has always drawn; an
// empty non-nil list is a reader who switched every row off, and that is a
// choice rather than a mistake — so it survives as an empty, non-nil slice.
func normalizeLinkPreviewParts(parts []string) []string {
	if parts == nil {
		return nil
	}
	wanted := make(map[string]bool, len(parts))
	for _, part := range parts {
		wanted[strings.ToLower(strings.TrimSpace(part))] = true
	}
	out := make([]string, 0, len(linkPreviewParts))
	for _, part := range linkPreviewParts {
		if wanted[part] {
			out = append(out, part)
		}
	}
	return out
}
