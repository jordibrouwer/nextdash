package app

import (
	"testing"
	"time"
)

func trendNow() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) }

func TestNetTrendPoints24hBucketsAndGaps(t *testing.T) {
	now := trendNow()
	at := func(ago time.Duration) int64 { return now.Add(-ago).UnixMilli() }
	samples := []HealthSample{
		{T: at(2 * time.Hour), Up: true, PingMs: 100},
		{T: at(2*time.Hour - time.Minute), Up: true, PingMs: 300},
		{T: at(30 * time.Minute), Up: false},
		{T: at(10 * time.Minute), Up: true, PingMs: 50, Maint: true}, // skipped
		{T: at(30 * time.Hour), Up: true, PingMs: 999},               // outside 24h
	}
	pts := netTrendPoints(samples, nil, "24h", now)
	if len(pts) != 2 {
		t.Fatalf("points = %d (%+v), want 2: the maintenance sample and the old one are not points", len(pts), pts)
	}
	if pts[0].A != 200 || pts[0].X != 300 || pts[0].N != 2 || pts[0].F != 0 {
		t.Errorf("first point = %+v, want mean 200, peak 300, 2 checks", pts[0])
	}
	if pts[1].A != 0 || pts[1].F != 1 || pts[1].N != 1 {
		t.Errorf("second point = %+v, want a failure with no mean", pts[1])
	}
	if pts[0].T >= pts[1].T {
		t.Errorf("points not oldest first")
	}
}

func TestNetTrend7dUsesDaysBeforeRawSamples(t *testing.T) {
	now := trendNow()
	day := func(ago int) int64 { return dayStartMs(now.Add(-time.Duration(ago) * 24 * time.Hour).UnixMilli()) }
	days := []HealthDay{
		{D: day(6), N: 10, U: 10, P: 80, PN: 10, X: 200},
		{D: day(5), N: 10, U: 9, P: 90, PN: 9},
		{D: day(0), N: 4, U: 4, P: 70, PN: 4}, // the raw day: dropped part is not drawn twice
	}
	samples := []HealthSample{{T: now.Add(-time.Hour).UnixMilli(), Up: true, PingMs: 60}}
	pts := netTrendPoints(samples, days, "7d", now)
	if len(pts) != 3 {
		t.Fatalf("points = %d (%+v), want 2 days + 1 raw bucket", len(pts), pts)
	}
	if pts[0].X != 200 || pts[0].W != 24*3600*1000 {
		t.Errorf("day point = %+v, want the stored peak and a day width", pts[0])
	}
	if pts[1].X != 90 {
		t.Errorf("a day without a stored peak must draw its mean, got %+v", pts[1])
	}
	if pts[1].F != 1 {
		t.Errorf("failures = %d, want N-U = 1", pts[1].F)
	}
	if pts[2].W != 2*3600*1000 || pts[2].A != 60 {
		t.Errorf("raw bucket = %+v", pts[2])
	}
}

func TestNetTrend30dMergesDaysAndRaw(t *testing.T) {
	now := trendNow()
	today := dayStartMs(now.UnixMilli())
	days := []HealthDay{{D: today, N: 2, U: 2, P: 100, PN: 2, X: 120}}
	samples := []HealthSample{
		{T: now.Add(-time.Hour).UnixMilli(), Up: true, PingMs: 400},
		{T: now.Add(-2 * time.Hour).UnixMilli(), Up: false},
	}
	pts := netTrendPoints(samples, days, "30d", now)
	if len(pts) != 1 {
		t.Fatalf("points = %d, want today as one point", len(pts))
	}
	p := pts[0]
	if p.N != 4 || p.F != 1 || p.A != (100*2+400)/3 || p.X != 400 {
		t.Errorf("merged day = %+v", p)
	}
}

func TestNetSpark(t *testing.T) {
	now := trendNow()
	if got := netSpark(nil, now); got != nil {
		t.Errorf("no samples = %v, want nil", got)
	}
	onlyFail := []HealthSample{{T: now.Add(-time.Hour).UnixMilli(), Up: false}}
	if got := netSpark(onlyFail, now); got != nil {
		t.Errorf("nothing measured = %v, want nil", got)
	}
	s := []HealthSample{
		{T: now.Add(-30 * time.Minute).UnixMilli(), Up: true, PingMs: 40},
		{T: now.Add(-5 * time.Hour).UnixMilli(), Up: false},
		{T: now.Add(-5*time.Hour - 30*time.Minute).UnixMilli(), Up: true, PingMs: 10},
	}
	got := netSpark(s, now)
	if len(got) != netSparkSlices || got[netSparkSlices-1] != 40 {
		t.Fatalf("spark = %v", got)
	}
	failed := 0
	for _, v := range got {
		if v == -1 {
			failed++
		}
	}
	if failed != 1 {
		t.Errorf("failed slices = %d in %v, want 1", failed, got)
	}
}

func TestNetTrendRoute(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), `,"maxMs":300`),
		`{"name":"T","url":"https://t.example","checks":[{"id":"`+netTestCheckID(2)+`","type":"tls","enabled":true}]}`)
	now := time.Now()
	if err := h.appendHealthSamples(map[string][]HealthSample{netHistoryKey(netTestCheckID(1)): {
		{T: msAgo(now, time.Hour), Up: true, PingMs: 20},
		{T: msAgo(now, 30*time.Minute), Up: false},
	}}); err != nil {
		t.Fatal(err)
	}
	got := netGet(t, h, "/api/net/trend?check="+netTestCheckID(1), h.GetNetTrend)
	if got["supported"] != true || got["maxMs"].(float64) != 300 || got["fails"].(float64) != 1 || got["avg"].(float64) != 20 {
		t.Errorf("trend = %v", got)
	}
	if n := len(got["points"].([]any)); n != 2 {
		t.Errorf("points = %d, want 2", n)
	}
	tls := netGet(t, h, "/api/net/trend?check="+netTestCheckID(2), h.GetNetTrend)
	if tls["supported"] != false {
		t.Errorf("tls = %v, want supported:false", tls)
	}
}

func TestNetFoldDaysKeepsPeak(t *testing.T) {
	now := trendNow()
	days := foldSamplesIntoDays(nil, []HealthSample{
		{T: now.UnixMilli(), Up: true, PingMs: 50},
		{T: now.UnixMilli(), Up: true, PingMs: 220},
	})
	days = foldSamplesIntoDays(days, []HealthSample{{T: now.UnixMilli(), Up: true, PingMs: 90}})
	if len(days) != 1 || days[0].X != 220 {
		t.Errorf("days = %+v, want the day's peak 220 kept across folds", days)
	}
}
