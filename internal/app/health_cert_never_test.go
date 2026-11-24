package app

import (
	"testing"
	"time"
)

func TestNeverWarnHostStaysSilentEvenWhenExpired(t *testing.T) {
	now := time.Now()
	settings := Settings{CertWarnByHost: map[string]int{"nas.local": certWarnNever}}
	stored := map[string]HostCertificate{
		"nas.local":   {Host: "nas.local", ExpiresAt: now.Add(-48 * time.Hour).UnixMilli()},
		"other.local": {Host: "other.local", ExpiresAt: now.Add(-48 * time.Hour).UnixMilli()},
	}
	ladder := func(host string) []int { return certThresholdsForHost(settings, host) }

	shown := expiringCertificatesFor(stored, now, ladder)
	if _, ok := shown["nas.local"]; ok {
		t.Error("a never-warn host is listed as expiring")
	}
	if _, ok := shown["other.local"]; !ok {
		t.Error("the other host lost its expired warning")
	}

	seen := []PingResult{
		{CertHost: "nas.local", CertExpiry: now.Add(-48 * time.Hour).UnixMilli()},
		{CertHost: "other.local", CertExpiry: now.Add(-48 * time.Hour).UnixMilli()},
	}
	crossed := recordHostCertificatesFor(map[string]HostCertificate{}, seen, now, ladder)
	if len(crossed) != 1 || crossed[0].Host != "other.local" {
		t.Errorf("only other.local should alert, got %+v", crossed)
	}
}

func TestNeverWarnSurvivesASettingsRoundTrip(t *testing.T) {
	h := newTestHandlers(t)
	s := h.store.GetSettings()
	s.CertWarnByHost = map[string]int{"NAS.local": certWarnNever}
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if got := h.store.GetSettings().CertWarnByHost["nas.local"]; got != certWarnNever {
		t.Errorf("never-warn became %d", got)
	}
}
