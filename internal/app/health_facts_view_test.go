package app

import "testing"

// The badge fetches this on every dashboard load. What it must not do is grow
// with the collection: a healthy, unmonitored bookmark has nothing to report,
// and a row for it would be weight without content.
func TestFactsViewKeepsOnlyTheRowsThatSaySomething(t *testing.T) {
	report := BookmarkHealthReport{
		GeneratedAt: 42,
		Summary:     HealthSummary{TotalBookmarks: 4, BrokenCount: 1},
		Issues: []HealthIssue{
			{URL: "https://healthy.example", Name: "Healthy", Status: "healthy"},
			{URL: "https://broken.example", BrokenSince: 99, LastError: "dns"},
			{URL: "https://cert.example", CertHost: "cert.example"},
			{
				URL: "https://monitored.example", Monitor: true,
				MonitorStats: &MonitorStats{Uptime30d: UptimeWindow{Ratio: 0.99, Samples: 500}},
			},
		},
	}

	facts := buildHealthFactsReport(report)

	if len(facts.Rows) != 3 {
		t.Fatalf("expected the three rows with something to report, got %d: %+v", len(facts.Rows), facts.Rows)
	}
	for _, row := range facts.Rows {
		if row.URL == "https://healthy.example" {
			t.Fatalf("a healthy bookmark should carry no row")
		}
	}
	if facts.Summary.TotalBookmarks != 4 || facts.Summary.BrokenCount != 1 {
		t.Fatalf("the counts must survive untouched: %+v", facts.Summary)
	}
	if facts.GeneratedAt != 42 {
		t.Fatalf("generatedAt was dropped")
	}
}

// A monitor with no samples yet has no uptime — which is a different answer
// from 0%, and the row must not claim one.
func TestFactsViewKeepsNoDataApartFromZero(t *testing.T) {
	report := BookmarkHealthReport{Issues: []HealthIssue{{
		URL: "https://fresh.example", Monitor: true, CertHost: "fresh.example",
		MonitorStats: &MonitorStats{Uptime30d: UptimeWindow{Ratio: 0, Samples: 0}},
	}}}

	facts := buildHealthFactsReport(report)

	if len(facts.Rows) != 1 {
		t.Fatalf("the certificate host alone should keep the row: %+v", facts.Rows)
	}
	if facts.Rows[0].Uptime30dCount != 0 || facts.Rows[0].Uptime30d != 0 {
		t.Fatalf("uptime was invented from no samples: %+v", facts.Rows[0])
	}
}

/*
The uptime widget's row, without a trip through the health view.

The tile needs four things per monitored bookmark and used to get them only
from the full report, which is loaded when the health view is opened — so a tile
added to the dashboard read "Open Health once to fill this in" until the reader
went and did that. These fields are what let the badge's own request fill it.
*/
func TestFactsViewCarriesWhatTheUptimeTileDraws(t *testing.T) {
	report := BookmarkHealthReport{Issues: []HealthIssue{{
		URL: "https://watched.example", Monitor: true,
		MonitorStats: &MonitorStats{
			Uptime7d:  UptimeWindow{Ratio: 0.98, Samples: 300},
			Uptime30d: UptimeWindow{Ratio: 0.99, Samples: 1200},
			DownSince: 1234,
			Heartbeat: []HeartbeatBucket{
				{State: heartbeatUp, Up: 3},
				{State: heartbeatDown, Down: 3},
				{State: heartbeatDegraded, Up: 1, Down: 1},
				{State: "", Up: 0},
			},
		},
	}}}

	facts := buildHealthFactsReport(report)

	if len(facts.Rows) != 1 {
		t.Fatalf("expected the monitored row, got %+v", facts.Rows)
	}
	row := facts.Rows[0]
	if row.Uptime7d != 0.98 || row.Uptime7dCount != 300 {
		t.Errorf("seven-day uptime did not survive: %+v", row)
	}
	if row.DownSince != 1234 {
		t.Errorf("downSince did not survive: %+v", row)
	}
	// One letter per bucket: the sparkline reads the state and nothing else, and
	// forty objects of six fields per monitor is the weight this view avoids.
	if row.Heartbeat != "udx." {
		t.Errorf("heartbeat = %q, want \"udx.\"", row.Heartbeat)
	}
}

// Only the tail is sent, because only the tail is drawn.
func TestFactsViewHeartbeatKeepsTheTail(t *testing.T) {
	buckets := make([]HeartbeatBucket, 40)
	for i := range buckets {
		buckets[i] = HeartbeatBucket{State: heartbeatUp}
	}
	buckets[len(buckets)-1].State = heartbeatDown

	states := heartbeatStates(buckets)

	if len(states) != factsHeartbeatBuckets {
		t.Fatalf("sent %d buckets, want %d", len(states), factsHeartbeatBuckets)
	}
	if states[len(states)-1] != 'd' {
		t.Errorf("the newest bucket was dropped: %q", states)
	}
}

/*
A monitor switched on this morning keeps its row.

It has no samples, no certificate and no failure, which is precisely the shape
the row filter drops — and it is the bookmark the reader just said they wanted
to watch, so dropping it left the tile empty for the ones it was added for.
*/
func TestFactsViewKeepsAFreshMonitor(t *testing.T) {
	report := BookmarkHealthReport{Issues: []HealthIssue{
		{URL: "https://fresh-monitor.example", Monitor: true},
		{URL: "https://plain.example"},
	}}

	facts := buildHealthFactsReport(report)

	if len(facts.Rows) != 1 || facts.Rows[0].URL != "https://fresh-monitor.example" {
		t.Fatalf("expected the fresh monitor and nothing else: %+v", facts.Rows)
	}
}
