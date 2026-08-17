package main

import (
	"strings"
	"time"
)

// setBookmarkCheckResult is the one place a check result lands on a bookmark.
//
// Every caller used to write LastChecked and LastError itself, which is why
// nothing recorded when a failure had started: each write knew the bookmark was
// failing, none knew whether it had been failing yesterday too. BrokenSince is
// maintained here so it cannot be forgotten at a call site — the same reason
// the check itself has one entry point.
//
// detail is the failure sentence, empty for a healthy result.
func setBookmarkCheckResult(bm *Bookmark, checkedAt int64, detail string) {
	if bm == nil {
		return
	}
	if checkedAt <= 0 {
		checkedAt = time.Now().UnixMilli()
	}
	bm.LastChecked = checkedAt
	trimmed := strings.TrimSpace(detail)
	bm.LastError = trimmed
	setBookmarkBrokenSince(bm, trimmed, checkedAt)
}

// setBookmarkBrokenSince keeps the field in step with an error that was written
// elsewhere — clearing an expectation, for instance, clears the failure it
// caused without going through a check at all.
func setBookmarkBrokenSince(bm *Bookmark, detail string, at int64) {
	if bm == nil {
		return
	}
	if strings.TrimSpace(detail) == "" {
		bm.BrokenSince = 0
		return
	}
	if bm.BrokenSince == 0 {
		if at <= 0 {
			at = time.Now().UnixMilli()
		}
		bm.BrokenSince = at
	}
}
