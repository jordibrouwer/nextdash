package app

// The "facts" view of the health report.
//
// The dashboard fetches this report on every load to put a number on the health
// icon, and the preview card reads uptime and certificate expiry out of it. Both
// want a fraction of it: the counts, plus the handful of bookmarks that have
// something to report. The full report carries a row for every bookmark — name,
// tags, scores, reasons — plus duplicate groups, the daily trend and the fleet
// view, and it grows linearly with the collection. A library of five hundred
// bookmarks was downloading a couple of hundred kilobytes per page load for
// twelve counts.
//
// The health view itself still asks for the whole thing; it is the one screen
// that draws it.

// HealthFactsRow is what a bookmark can report without the view around it.
type HealthFactsRow struct {
	URL         string `json:"url"`
	Monitor     bool   `json:"monitor,omitempty"`
	CertHost    string `json:"certHost,omitempty"`
	BrokenSince int64  `json:"brokenSince,omitempty"`
	LastError   string `json:"lastError,omitempty"`
	// Uptime over thirty days, sent only when there are samples behind it —
	// "no data" and "0% up" are different answers.
	Uptime30d      float64 `json:"uptime30d,omitempty"`
	Uptime30dCount int     `json:"uptime30dSamples,omitempty"`
	// The three fields below are the uptime widget's, and are sent for
	// monitored rows only.
	//
	// The widget used to insist on the full report, which is loaded when the
	// health view is opened and never before it — so a tile added to the
	// dashboard read "Open Health once to fill this in" until the reader went
	// and did that. It needs four things per row and the row already carries
	// the first, so these are the rest.
	Uptime7d      float64 `json:"uptime7d,omitempty"`
	Uptime7dCount int     `json:"uptime7dSamples,omitempty"`
	DownSince     int64   `json:"downSince,omitempty"`
	// Heartbeat is the bar's states and nothing else: the sparkline colours a
	// tick per bucket and reads no other field, while a full HeartbeatBucket
	// carries from, to, up, down, avgMs and reason. Forty of those per monitor
	// on every dashboard load would be the weight this view exists to avoid,
	// so the shape here is one letter per bucket -- see heartbeatStates.
	Heartbeat string `json:"heartbeat,omitempty"`
}

// factsHeartbeatBuckets is how much of the bar the compact view carries.
//
// The widget draws the last 24 of whatever it is given, so sending 40 would be
// sending sixteen the reader never sees.
const factsHeartbeatBuckets = 24

/*
heartbeatStates compresses a heartbeat to one letter per bucket.

u=up, d=down, x=degraded, .=no samples in that bucket. A letter rather than a
word because this rides on every dashboard load: twenty monitors is 480 bytes
this way against about 4KB as JSON objects, for a bar that draws the same.
*/
func heartbeatStates(buckets []HeartbeatBucket) string {
	if len(buckets) > factsHeartbeatBuckets {
		buckets = buckets[len(buckets)-factsHeartbeatBuckets:]
	}
	out := make([]byte, 0, len(buckets))
	for _, bucket := range buckets {
		switch bucket.State {
		case heartbeatUp:
			out = append(out, 'u')
		case heartbeatDown:
			out = append(out, 'd')
		case heartbeatDegraded:
			out = append(out, 'x')
		default:
			out = append(out, '.')
		}
	}
	return string(out)
}

// HealthFactsReport is the badge's and the preview card's half of the report.
type HealthFactsReport struct {
	GeneratedAt  int64                      `json:"generatedAt"`
	Summary      HealthSummary              `json:"summary"`
	Rows         []HealthFactsRow           `json:"rows,omitempty"`
	Certificates map[string]HostCertificate `json:"certificates,omitempty"`
}

// buildHealthFactsReport keeps the rows that say something and drops the rest.
//
// A healthy, unmonitored bookmark has no uptime, no certificate and no failure,
// so a row for it would be weight without content — which is the whole reason
// this view exists.
func buildHealthFactsReport(report BookmarkHealthReport) HealthFactsReport {
	out := HealthFactsReport{
		GeneratedAt:  report.GeneratedAt,
		Summary:      report.Summary,
		Certificates: report.Certificates,
	}
	for _, issue := range report.Issues {
		row := HealthFactsRow{
			URL:         issue.URL,
			Monitor:     issue.Monitor,
			CertHost:    issue.CertHost,
			BrokenSince: issue.BrokenSince,
			LastError:   issue.LastError,
		}
		if stats := issue.MonitorStats; stats != nil {
			if stats.Uptime30d.Samples > 0 {
				row.Uptime30d = stats.Uptime30d.Ratio
				row.Uptime30dCount = stats.Uptime30d.Samples
			}
			if stats.Uptime7d.Samples > 0 {
				row.Uptime7d = stats.Uptime7d.Ratio
				row.Uptime7dCount = stats.Uptime7d.Samples
			}
			row.DownSince = stats.DownSince
			row.Heartbeat = heartbeatStates(stats.Heartbeat)
		}
		// A monitored bookmark keeps its row whatever it has to say. It is the
		// subject of the uptime widget, and a monitor switched on this morning
		// -- no samples, no certificate, no failure -- is exactly the one the
		// reader is watching; dropping it here left the tile empty for the
		// bookmarks it was added for.
		if !row.Monitor && row.Uptime30dCount == 0 && row.CertHost == "" && row.BrokenSince == 0 && row.LastError == "" {
			continue
		}
		out.Rows = append(out.Rows, row)
	}
	return out
}
