package main

import "testing"

// A monitored bookmark that is down must be counted apart from an ordinary
// broken link: the header flags a live outage differently, and double-counting
// it in both would make BrokenCount unreliable. A non-monitored broken bookmark
// stays in BrokenCount; a down monitor moves to MonitorDownCount; neither leaks
// into the other.
func TestMonitorDownCountedApartFromBroken(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Plain broken","url":"https://plain.example","checkStatus":true,"lastError":"HTTP 500","lastChecked":1},
		{"name":"Down monitor","url":"https://mon.example","monitor":true,"monitorIntervalMinutes":5,"lastError":"Unreachable","lastChecked":1},
		{"name":"Healthy monitor","url":"https://up.example","monitor":true,"monitorIntervalMinutes":5,"lastChecked":1}
	]}`)

	s := healthReportVia(t, h).Summary
	if s.BrokenCount != 1 {
		t.Errorf("BrokenCount = %d, want 1 (only the plain broken link)", s.BrokenCount)
	}
	if s.MonitorDownCount != 1 {
		t.Errorf("MonitorDownCount = %d, want 1 (only the down monitor)", s.MonitorDownCount)
	}
}

// A monitor that recovered clears LastError, so it must leave MonitorDownCount
// rather than lingering — the header should stop flagging an outage that is over.
func TestRecoveredMonitorLeavesDownCount(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Recovered","url":"https://mon.example","monitor":true,"monitorIntervalMinutes":5,"lastChecked":1}
	]}`)

	if got := healthReportVia(t, h).Summary.MonitorDownCount; got != 0 {
		t.Errorf("MonitorDownCount = %d, want 0 for a monitor with no error", got)
	}
}
