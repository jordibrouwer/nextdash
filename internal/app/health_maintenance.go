package app

import (
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
Maintenance windows.

A host that goes down for ten minutes every night while its backup runs produces
an incident and an alert every single night. Nothing is wrong, but the badge is
red every morning and the alerts stop being read — which is worse than having no
alerts, because now the real one is buried too.

A window says "expect downtime here". Checks still run and samples are still
recorded, so the heartbeat stays honest about what happened; what changes is that
those samples do not raise an alert and do not count against uptime. The
distinction matters: hiding the checks would make a genuine week-long outage
starting inside a window invisible.

Windows are weekly and local to the server's timezone, which is the one the
person reading the dashboard shares.
*/

// MaintenanceWindow is one recurring quiet period.
type MaintenanceWindow struct {
	// Days is 0 (Sunday) through 6 (Saturday). Empty means every day.
	Days []int `json:"days,omitempty"`
	// Start and End are "HH:MM" in the server's local time. A window whose end is
	// before its start wraps past midnight, which is when most of them run.
	Start string `json:"start"`
	End   string `json:"end"`
	// Label is optional and only for the UI, so a window can say what it is for.
	Label string `json:"label,omitempty"`
}

// parseClock reads "HH:MM" into minutes since midnight.
func parseClock(value string) (int, bool) {
	h, m, found := strings.Cut(strings.TrimSpace(value), ":")
	if !found {
		return 0, false
	}
	hours, err1 := strconv.Atoi(strings.TrimSpace(h))
	mins, err2 := strconv.Atoi(strings.TrimSpace(m))
	if err1 != nil || err2 != nil || hours < 0 || hours > 23 || mins < 0 || mins > 59 {
		return 0, false
	}
	return hours*60 + mins, true
}

// covers reports whether the window is open at t.
func (w MaintenanceWindow) covers(t time.Time) bool {
	start, okStart := parseClock(w.Start)
	end, okEnd := parseClock(w.End)
	if !okStart || !okEnd || start == end {
		return false
	}
	minute := t.Hour()*60 + t.Minute()

	if start < end {
		// Same-day window: the day must match the day the window opens.
		return w.coversDay(int(t.Weekday())) && minute >= start && minute < end
	}
	// Wraps past midnight. Before the end, the window belongs to the previous
	// day — a "Sunday 23:00–01:00" window is still open at 00:30 on Monday, and
	// checking today's weekday would close it an hour early.
	if minute >= start {
		return w.coversDay(int(t.Weekday()))
	}
	if minute < end {
		return w.coversDay(int(t.AddDate(0, 0, -1).Weekday()))
	}
	return false
}

func (w MaintenanceWindow) coversDay(day int) bool {
	if len(w.Days) == 0 {
		return true
	}
	for _, d := range w.Days {
		if d == day {
			return true
		}
	}
	return false
}

// isValid reports whether a window describes a real period. An invalid one is
// dropped rather than treated as always-open, which would silence everything.
func (w MaintenanceWindow) isValid() bool {
	start, okStart := parseClock(w.Start)
	end, okEnd := parseClock(w.End)
	return okStart && okEnd && start != end
}

// normalizeMaintenanceWindows drops unusable entries and tidies the days, so a
// hand-edited settings file cannot leave alerting permanently suppressed.
func normalizeMaintenanceWindows(windows []MaintenanceWindow) []MaintenanceWindow {
	if len(windows) == 0 {
		return nil
	}
	out := make([]MaintenanceWindow, 0, len(windows))
	for _, w := range windows {
		if !w.isValid() {
			continue
		}
		days := make([]int, 0, len(w.Days))
		seen := map[int]bool{}
		for _, d := range w.Days {
			if d < 0 || d > 6 || seen[d] {
				continue
			}
			seen[d] = true
			days = append(days, d)
		}
		sort.Ints(days)
		// Seven days listed is the same as none, and "none" is the cheaper test.
		if len(days) == 7 {
			days = nil
		}
		w.Days = days
		w.Label = strings.TrimSpace(w.Label)
		out = append(out, w)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// inMaintenanceWindow reports whether any window is open at t.
func inMaintenanceWindow(windows []MaintenanceWindow, t time.Time) bool {
	for _, w := range windows {
		if w.covers(t) {
			return true
		}
	}
	return false
}
