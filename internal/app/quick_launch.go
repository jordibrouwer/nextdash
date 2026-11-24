package app

import "strings"

// Quick launch is a panel in the middle of the screen with the bookmarks you
// pinned and the ones you open most. A corner element, Shift+Q and a mouse
// drawn in circles open it. The list is built in the browser from the
// bookmarks it already holds (static/js/quick-launch-core.js); the server only
// keeps the choices and keeps them inside what the panel can draw.

const (
	quickLaunchSourceMix    = "mix"    // pinned first, filled with the most opened
	quickLaunchSourcePinned = "pinned" // pinned only
	quickLaunchSourceTop    = "top"    // most opened only

	maxQuickLaunchHidden = 100
	// The most the panel holds: the ones put in by hand come first, the rest fill what is left.
	maxQuickLaunch = 12

	defaultQuickLaunchTurns = 1.5
	// Seconds the pointer may rest outside the panel before it closes itself.
	defaultQuickLaunchAutoClose = 5
)

// normalizeQuickLaunch keeps every Quick launch choice inside what the panel
// draws. An unknown value reads as the default, the way the other named
// choices in this file do. Turns snap to halves between 1 and 3, so a typed
// 1.2 or a stored 0 cannot make the gesture fire on a twitch or never.
func normalizeQuickLaunch(s *Settings) {
	switch s.QuickLaunchSource {
	case quickLaunchSourceMix, quickLaunchSourcePinned, quickLaunchSourceTop:
	default:
		s.QuickLaunchSource = quickLaunchSourceMix
	}
	switch s.QuickLaunchAutoClose {
	case 0, 3, 5, 10:
	default:
		s.QuickLaunchAutoClose = defaultQuickLaunchAutoClose
	}
	s.QuickLaunchHidden = cleanQuickLaunchURLs(s.QuickLaunchHidden, maxQuickLaunchHidden)
	s.QuickLaunchAdded = cleanQuickLaunchURLs(s.QuickLaunchAdded, maxQuickLaunch)
	t := s.QuickLaunchTurns
	if !(t >= 1) { // also catches NaN and 0
		t = defaultQuickLaunchTurns
	}
	if t > 3 {
		t = 3
	}
	s.QuickLaunchTurns = float64(int(t*2+0.5)) / 2
}

// cleanQuickLaunchURLs keeps a list of addresses to what the panel can match:
// trimmed, not empty, once each, the newest `max`. A list that grows without
// bound would ride along in every settings answer.
func cleanQuickLaunchURLs(in []string, max int) []string {
	out := make([]string, 0, len(in))
	seen := make(map[string]bool, len(in))
	for _, u := range in {
		u = strings.TrimSpace(u)
		if u == "" || len(u) > 2048 || seen[u] {
			continue
		}
		seen[u] = true
		out = append(out, u)
	}
	if len(out) > max {
		out = out[len(out)-max:]
	}
	return out
}
