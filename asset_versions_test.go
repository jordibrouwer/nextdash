package main

import (
	"os"
	"strings"
	"testing"
)

func TestSharedAssetVersionsMatchWhatsNewStub(t *testing.T) {
	data, err := os.ReadFile("static/js/whats-new-stub.js")
	if err != nil {
		t.Fatalf("read whats-new-stub.js: %v", err)
	}
	src := string(data)
	if !strings.Contains(src, sharedAssetVersions.WhatsNewData) {
		t.Fatalf("whats-new-stub.js missing data version %q (update asset_versions.go and whats-new-stub.js together)", sharedAssetVersions.WhatsNewData)
	}
	if !strings.Contains(src, "2026.07-dashboard-release-v100") {
		t.Fatal("whats-new-stub.js dashboard release token drifted from expected v99")
	}
}
