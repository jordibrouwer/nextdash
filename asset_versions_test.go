package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// dashboardReleaseTokenRE matches the versioned dashboard release token in
// whats-new-stub.js (e.g. "2026.07-dashboard-release-v104"). We assert the
// token exists rather than pinning an exact version so the test survives
// routine release bumps but still catches an accidentally removed token.
var dashboardReleaseTokenRE = regexp.MustCompile(`\d{4}\.\d{2}-dashboard-release-v\d+`)

func TestSharedAssetVersionsMatchWhatsNewStub(t *testing.T) {
	data, err := os.ReadFile("static/js/whats-new-stub.js")
	if err != nil {
		t.Fatalf("read whats-new-stub.js: %v", err)
	}
	src := string(data)
	if !strings.Contains(src, sharedAssetVersions.WhatsNewData) {
		t.Fatalf("whats-new-stub.js missing data version %q (update asset_versions.go and whats-new-stub.js together)", sharedAssetVersions.WhatsNewData)
	}
	if !dashboardReleaseTokenRE.MatchString(src) {
		t.Fatal("whats-new-stub.js is missing a dashboard release token (expected e.g. 2026.07-dashboard-release-vNNN)")
	}
}
