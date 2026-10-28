package app

import (
	"fmt"
	"strings"
)

const (
	defaultDigestWeekday = 1 // Monday
	defaultDigestTime    = "08:00"
)

// parseDigestTime reads "HH:MM"; anything else is the default time.
func parseDigestTime(s string) (hour, minute int) {
	var h, m int
	if _, err := fmt.Sscanf(strings.TrimSpace(s), "%d:%d", &h, &m); err != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 8, 0
	}
	return h, m
}

func normalizeDigestSettings(s *Settings) {
	// The digest cannot be switched off, and its Now group (broken links,
	// certificates, domains) cannot be dropped. The fields stay in the struct
	// so an old settings file still loads.
	s.DigestEnabled = true
	s.DigestHealth = true
	if s.DigestWeekday < 0 || s.DigestWeekday > 6 {
		s.DigestWeekday = defaultDigestWeekday
	}
	h, m := parseDigestTime(s.DigestTime)
	s.DigestTime = fmt.Sprintf("%02d:%02d", h, m)
}
