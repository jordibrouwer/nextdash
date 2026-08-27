package app

import "strings"

// mergeBookmarkMetadata folds duplicate bookmark rows into keeper (in place).
// Keeper identity fields (name, URL, category) stay unless empty on keeper.
func mergeBookmarkMetadata(keeper *Bookmark, sources []Bookmark) {
	for _, src := range sources {
		mergeOneBookmarkIntoKeeper(keeper, src)
	}
	keeper.Tags = normalizeTags(keeper.Tags)
	keeper.Icon = sanitizeBookmarkIcon(keeper.Icon)
}

func mergeOneBookmarkIntoKeeper(keeper *Bookmark, src Bookmark) {
	keeper.OpenCount += src.OpenCount

	if src.Pinned {
		keeper.Pinned = true
	}
	if src.CheckStatus {
		keeper.CheckStatus = true
	}

	if src.CreatedAt > 0 && (keeper.CreatedAt == 0 || src.CreatedAt < keeper.CreatedAt) {
		keeper.CreatedAt = src.CreatedAt
	}
	if src.LastOpened > keeper.LastOpened {
		keeper.LastOpened = src.LastOpened
	}
	// Newest wins, the mirror of CreatedAt above: the merged bookmark was last
	// edited whenever the most recently edited of its sources was.
	if src.UpdatedAt > keeper.UpdatedAt {
		keeper.UpdatedAt = src.UpdatedAt
	}
	if src.LastChecked > keeper.LastChecked {
		keeper.LastChecked = src.LastChecked
	}

	if strings.TrimSpace(keeper.Shortcut) == "" && strings.TrimSpace(src.Shortcut) != "" {
		keeper.Shortcut = strings.TrimSpace(src.Shortcut)
	}
	if strings.TrimSpace(keeper.Category) == "" && strings.TrimSpace(src.Category) != "" {
		keeper.Category = strings.TrimSpace(src.Category)
	}
	if strings.TrimSpace(keeper.Icon) == "" && strings.TrimSpace(src.Icon) != "" {
		keeper.Icon = sanitizeBookmarkIcon(src.Icon)
	}

	appendBookmarkNote(keeper, src.Note)

	if len(src.Tags) > 0 {
		keeper.Tags = append(keeper.Tags, src.Tags...)
	}

	if strings.TrimSpace(keeper.PreviewTitle) == "" && strings.TrimSpace(src.PreviewTitle) != "" {
		keeper.PreviewTitle = strings.TrimSpace(src.PreviewTitle)
	}
	if strings.TrimSpace(keeper.PreviewDesc) == "" && strings.TrimSpace(src.PreviewDesc) != "" {
		keeper.PreviewDesc = strings.TrimSpace(src.PreviewDesc)
	}
	if strings.TrimSpace(keeper.PreviewImage) == "" && strings.TrimSpace(src.PreviewImage) != "" {
		keeper.PreviewImage = strings.TrimSpace(src.PreviewImage)
	}

	if strings.TrimSpace(keeper.LastError) == "" && strings.TrimSpace(src.LastError) != "" {
		keeper.LastError = strings.TrimSpace(src.LastError)
		// The failure comes across with the age it already had, so merging two
		// copies of a dead link does not reset how long it has been dead.
		keeper.BrokenSince = src.BrokenSince
		setBookmarkBrokenSince(keeper, keeper.LastError, src.LastChecked)
	}
}

func appendBookmarkNote(keeper *Bookmark, addition string) {
	addition = strings.TrimSpace(addition)
	if addition == "" {
		return
	}
	existing := strings.TrimSpace(keeper.Note)
	if existing == "" {
		keeper.Note = addition
		return
	}
	if existing == addition {
		return
	}
	for _, part := range strings.Split(existing, "\n") {
		if strings.TrimSpace(part) == addition {
			return
		}
	}
	keeper.Note = existing + "\n" + addition
}
