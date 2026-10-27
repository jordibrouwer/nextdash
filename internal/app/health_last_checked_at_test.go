package app

import "testing"

// The summary's LastCheckedAt is when links were last checked: the newest
// LastChecked of any bookmark. It must not follow the report's build time, or
// "Last check" reads "just now" while the checks themselves are weeks old.
func TestSummaryLastCheckedAtIsNewestCheck(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Old","url":"https://old.example","checkStatus":true,"lastChecked":1000},
		{"name":"Newest","url":"https://new.example","checkStatus":true,"lastChecked":5000},
		{"name":"Never","url":"https://never.example"}
	]}`)

	first := healthReportVia(t, h)
	if first.Summary.LastCheckedAt != 5000 {
		t.Fatalf("LastCheckedAt = %d, want 5000", first.Summary.LastCheckedAt)
	}
	second := healthReportVia(t, h)
	if second.Summary.LastCheckedAt != 5000 {
		t.Errorf("LastCheckedAt moved to %d on rebuild, want 5000", second.Summary.LastCheckedAt)
	}
}

func TestSummaryLastCheckedAtZeroWhenNeverChecked(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Never","url":"https://never.example"}
	]}`)
	if got := healthReportVia(t, h).Summary.LastCheckedAt; got != 0 {
		t.Errorf("LastCheckedAt = %d, want 0", got)
	}
}
