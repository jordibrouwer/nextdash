package app

import "testing"

func TestMergeCarriesMonitoringSetup(t *testing.T) {
	keeper := Bookmark{Name: "k", URL: "https://a.example", Icon: "", IconMode: "letter"}
	src := Bookmark{
		Name: "s", URL: "https://b.example", Icon: "x.png",
		Monitor: true, WatchDrift: true, MonitorIntervalMinutes: 15,
		CheckURL: "https://b.example/health", AllowInsecureTLS: true,
		CredentialID: "cred1", ExpectStatus: "200-299",
		ExpectText: "ok", ExpectTextAbsent: true,
		HealthIgnored: []HealthIgnore{{Flag: "stale", Until: 0}},
		NotifyMuted:   true,
	}
	mergeBookmarkMetadata(&keeper, []Bookmark{src})

	if !keeper.Monitor || !keeper.WatchDrift || keeper.MonitorIntervalMinutes != 15 {
		t.Errorf("monitor/drift/interval not carried: %+v", keeper)
	}
	if keeper.CheckURL != src.CheckURL || !keeper.AllowInsecureTLS {
		t.Errorf("check URL and its TLS exemption should move together: %+v", keeper)
	}
	if keeper.CredentialID != "cred1" || keeper.ExpectStatus != "200-299" {
		t.Errorf("credential/status not carried: %+v", keeper)
	}
	if keeper.ExpectText != "ok" || !keeper.ExpectTextAbsent {
		t.Errorf("expectation not carried as a pair: %+v", keeper)
	}
	if keeper.Icon == "" || keeper.IconMode != "" {
		t.Errorf("adopted icon must clear letter mode: icon=%q mode=%q", keeper.Icon, keeper.IconMode)
	}
	if len(keeper.HealthIgnored) != 1 || keeper.HealthIgnored[0].Flag != "stale" {
		t.Errorf("ignore list not unioned: %+v", keeper.HealthIgnored)
	}
	if keeper.NotifyMuted {
		t.Error("NotifyMuted stays the keeper's")
	}
}

func TestMergeKeepsKeeperMonitoringSetup(t *testing.T) {
	keeper := Bookmark{
		CheckURL: "https://k.example/up", AllowInsecureTLS: false, CredentialID: "mine",
		ExpectStatus: "200", ExpectText: "mine", MonitorIntervalMinutes: 5,
		HealthIgnored: []HealthIgnore{{Flag: "stale", Until: 100}},
	}
	src := Bookmark{
		CheckURL: "https://s.example/up", AllowInsecureTLS: true, CredentialID: "theirs",
		ExpectStatus: "204", ExpectText: "theirs", ExpectTextAbsent: true, MonitorIntervalMinutes: 60,
		HealthIgnored: []HealthIgnore{{Flag: "stale", Until: 0}, {Flag: "slow", Until: 50}},
	}
	mergeBookmarkMetadata(&keeper, []Bookmark{src})

	if keeper.CheckURL != "https://k.example/up" || keeper.AllowInsecureTLS {
		t.Errorf("keeper check URL overwritten: %+v", keeper)
	}
	if keeper.CredentialID != "mine" || keeper.ExpectStatus != "200" || keeper.MonitorIntervalMinutes != 5 {
		t.Errorf("keeper setup overwritten: %+v", keeper)
	}
	if keeper.ExpectText != "mine" || keeper.ExpectTextAbsent {
		t.Errorf("keeper expectation overwritten: %+v", keeper)
	}
	if len(keeper.HealthIgnored) != 2 || keeper.HealthIgnored[0].Until != 0 {
		t.Errorf("union should keep the longer silence: %+v", keeper.HealthIgnored)
	}
}
