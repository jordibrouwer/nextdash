package app

import "strings"

// linkPreviewParts is every row the preview card can draw, in the order it
// draws them. The checklist under Appearance stores a subset of these.
//
// It has to carry every name the card knows: this list is a filter, so a row
// missing here is stripped out of the reader's stored list on every save. That
// is what happened to the byline and the player -- both were added to the card
// and to the checklist, never here, so nobody could keep them switched on.
var linkPreviewParts = []string{"image", "byline", "embed", "description", "note", "tags", "status", "opens", "fresh", "location"}

// linkPreviewPartsAddedLater is what this list gained after readers had
// already saved a checklist. A row that did not exist cannot have been
// refused, so a stored list gets them once -- see the migration in models.go.
var linkPreviewPartsAddedLater = []string{"byline", "embed"}

// withLaterLinkPreviewParts adds the rows introduced after a list was stored.
//
// Only for a list that exists: a nil list already means "everything the card
// knows", and an empty one is a reader who switched every row off -- adding
// two rows to that would be answering a question they did answer.
func withLaterLinkPreviewParts(parts []string) []string {
	if len(parts) == 0 {
		return parts
	}
	return normalizeLinkPreviewParts(append(append([]string{}, parts...), linkPreviewPartsAddedLater...))
}

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
