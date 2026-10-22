package app

import (
	"strings"
	"time"
)

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
	if len(src.OpenLog) > 0 {
		keeper.OpenLog = pruneOpenLog(append(append([]int64{}, keeper.OpenLog...), src.OpenLog...), time.Now().UnixMilli())
	}

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
		// An icon of its own always wins over the mode, but a stored "letter"
		// on the keeper would still read as the user's wish for no icon.
		if keeper.Icon != "" && keeper.IconMode == "letter" {
			keeper.IconMode = ""
		}
	}
	if keeper.IconMode == "" && strings.TrimSpace(keeper.Icon) == "" {
		keeper.IconMode = src.IconMode
	}

	// Monitoring setup is per bookmark and the source is about to be deleted:
	// without this the merged bookmark silently stops being checked the way
	// the duplicate was. Fill-only, so the keeper's own setup always wins.
	keeper.Monitor = keeper.Monitor || src.Monitor
	keeper.WatchDrift = keeper.WatchDrift || src.WatchDrift
	if keeper.MonitorIntervalMinutes == 0 {
		keeper.MonitorIntervalMinutes = src.MonitorIntervalMinutes
	}
	if strings.TrimSpace(keeper.CheckURL) == "" && strings.TrimSpace(src.CheckURL) != "" {
		keeper.CheckURL = strings.TrimSpace(src.CheckURL)
		// The TLS exemption belongs to the host it was granted for.
		keeper.AllowInsecureTLS = src.AllowInsecureTLS
	}
	if keeper.CredentialID == "" {
		keeper.CredentialID = src.CredentialID
	}
	if strings.TrimSpace(keeper.ExpectStatus) == "" {
		keeper.ExpectStatus = src.ExpectStatus
	}
	// Text and its polarity are one expectation: moved together or not at all.
	if strings.TrimSpace(keeper.ExpectText) == "" && strings.TrimSpace(src.ExpectText) != "" {
		keeper.ExpectText = src.ExpectText
		keeper.ExpectTextAbsent = src.ExpectTextAbsent
	}
	keeper.HealthIgnored = mergeHealthIgnored(keeper.HealthIgnored, src.HealthIgnored)

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

// mergeHealthIgnored unions two ignore lists by flag. When both silence the
// same flag the longer silence wins (zero is "for good"), so merging never
// brings a condition back that either copy had muted.
func mergeHealthIgnored(a, b []HealthIgnore) []HealthIgnore {
	if len(b) == 0 {
		return a
	}
	out := append([]HealthIgnore{}, a...)
	for _, add := range b {
		found := false
		for i := range out {
			if out[i].Flag != add.Flag {
				continue
			}
			found = true
			if out[i].Until != 0 && (add.Until == 0 || add.Until > out[i].Until) {
				out[i].Until = add.Until
			}
			break
		}
		if !found {
			out = append(out, add)
		}
	}
	return out
}
