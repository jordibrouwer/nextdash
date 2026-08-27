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
		if issue.MonitorStats != nil && issue.MonitorStats.Uptime30d.Samples > 0 {
			row.Uptime30d = issue.MonitorStats.Uptime30d.Ratio
			row.Uptime30dCount = issue.MonitorStats.Uptime30d.Samples
		}
		if row.Uptime30dCount == 0 && row.CertHost == "" && row.BrokenSince == 0 && row.LastError == "" {
			continue
		}
		out.Rows = append(out.Rows, row)
	}
	return out
}
