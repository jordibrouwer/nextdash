package app

// carryServerOwnedBookmarkFields puts back what a page-replacing save cannot
// know about.
//
// The dashboard saves a page by POSTing the whole list back, built from what
// the browser had in memory. Everything the *server* writes on its own —
// opens, the last check and its error, the fetched preview text, the last-seen
// certificate host — is invisible to that list the moment it changes after the
// page was loaded. Opening a bookmark and then editing any bookmark on the page
// wrote the count straight back to zero.
//
// So: a field the payload does not carry is taken from the stored bookmark of
// the same URL. A field the payload does carry wins, which is what makes an
// edit an edit — and what keeps an import, which deliberately brings its own
// counts, from being overwritten by whatever was there before.
func carryServerOwnedBookmarkFields(next []Bookmark, stored []Bookmark) {
	if len(next) == 0 || len(stored) == 0 {
		return
	}
	byURL := make(map[string]Bookmark, len(stored))
	for _, bookmark := range stored {
		if key := canonicalBookmarkURLKey(bookmark.URL); key != "" {
			byURL[key] = bookmark
		}
	}
	for i := range next {
		previous, ok := byURL[canonicalBookmarkURLKey(next[i].URL)]
		if !ok {
			continue
		}
		// A tab loaded before an open elsewhere sends the counts it loaded:
		// non-zero, so they used to win, and the newer opens were lost. The
		// three fields move together, and the newer last open decides.
		if previous.LastOpened > next[i].LastOpened {
			next[i].OpenCount = previous.OpenCount
			next[i].LastOpened = previous.LastOpened
			next[i].OpenLog = previous.OpenLog
		}
		if next[i].OpenCount == 0 {
			next[i].OpenCount = previous.OpenCount
		}
		if next[i].LastOpened == 0 {
			next[i].LastOpened = previous.LastOpened
		}
		if len(next[i].OpenLog) == 0 {
			next[i].OpenLog = previous.OpenLog
		}
		if next[i].CreatedAt == 0 {
			next[i].CreatedAt = previous.CreatedAt
		}
		// An empty error is "no error", which a check is entitled to say — but
		// only a check says it. A payload with no check time at all is not
		// reporting a result, so it must not clear a failure the row is in.
		// Read before LastChecked is filled in, or the answer is always "the
		// payload had a time".
		reportsACheck := next[i].LastChecked != 0
		// The check time a tab loaded and sends back is not a check of its
		// own: a newer one stored since, a failure found by the monitor, wins
		// with its error and "down since".
		if reportsACheck && previous.LastChecked > next[i].LastChecked {
			next[i].LastChecked = previous.LastChecked
			next[i].LastError = previous.LastError
			next[i].BrokenSince = previous.BrokenSince
		}
		if next[i].LastChecked == 0 {
			next[i].LastChecked = previous.LastChecked
		}
		if next[i].LastError == "" && !reportsACheck {
			next[i].LastError = previous.LastError
		}
		// BrokenSince is written by the server in the same breath as LastError
		// (setBookmarkCheckResult), so a payload that is not reporting a check
		// cannot know it either. Carrying the error without it left the row
		// reading as broken with no start date, throwing away the "down since"
		// history the field exists for.
		if next[i].BrokenSince == 0 && !reportsACheck {
			next[i].BrokenSince = previous.BrokenSince
		}
		if next[i].PreviewTitle == "" {
			next[i].PreviewTitle = previous.PreviewTitle
		}
		if next[i].PreviewDesc == "" {
			next[i].PreviewDesc = previous.PreviewDesc
		}
		if next[i].PreviewImage == "" {
			next[i].PreviewImage = previous.PreviewImage
		}
		if next[i].CertHost == "" {
			next[i].CertHost = previous.CertHost
		}
		// Drift and archive bookkeeping is written by the checks alone. A tab
		// loaded before a check sent the rows without it, and the finding, its
		// baseline and the archive's dates were stored empty: the next check
		// then took the parked page as the new normal. Each group moves whole.
		if next[i].DriftURL == "" && next[i].DriftFingerprint == "" {
			next[i].DriftURL = previous.DriftURL
			next[i].DriftTitle = previous.DriftTitle
			next[i].DriftFingerprint = previous.DriftFingerprint
		}
		if next[i].DriftNoticed == "" && previous.DriftNoticed != "" && previous.DriftSince >= next[i].DriftSince {
			next[i].DriftNoticed = previous.DriftNoticed
			next[i].DriftSince = previous.DriftSince
			next[i].DriftReason = previous.DriftReason
		}
		if previous.ArchiveCheckedAt > next[i].ArchiveCheckedAt {
			next[i].ArchiveDiedAt = previous.ArchiveDiedAt
			next[i].ArchiveSnapshotURL = previous.ArchiveSnapshotURL
			next[i].ArchiveCheckedAt = previous.ArchiveCheckedAt
		}
		if next[i].ArchiveJobID == "" {
			next[i].ArchiveJobID = previous.ArchiveJobID
			next[i].ArchiveJobAt = previous.ArchiveJobAt
		}
	}
}
