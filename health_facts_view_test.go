package main

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
