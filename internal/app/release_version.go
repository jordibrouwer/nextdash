package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// releaseTag is the newest published release, e.g. "v2026.07.23.6".
//
// Read from the What's new index rather than kept in a constant, because that
// file is already the source of truth for what has shipped: the modal, the
// config overview and the changelog all follow it. A second copy would be one
// more thing to bump per release and would drift the moment someone forgot.
//
// Distinct from appVersionToken(), which fingerprints the static assets for
// stale-page detection and changes on any CSS bump, and from buildVersion,
// which is only set when the binary is built with ldflags and reads "dev"
// otherwise. Neither answers "which release is this".
var releaseTag = func() func() string {
	var once sync.Once
	var tag string
	return func() string {
		once.Do(func() {
			tag = readLatestReleaseTag()
		})
		return tag
	}
}()

// readLatestReleaseTag returns the first entry's tag from the What's new index,
// which is ordered newest first. Empty when the index cannot be read or is
// malformed — callers treat that as "unknown" rather than failing, since this
// only feeds analytics and a wrong value is worse than no value.
func readLatestReleaseTag() string {
	data, err := readWhatsNewIndex()
	if err != nil {
		return ""
	}

	var entries []struct {
		Tag string `json:"tag"`
		ID  string `json:"id"`
	}
	if err := json.Unmarshal(data, &entries); err != nil || len(entries) == 0 {
		return ""
	}

	first := entries[0]
	if first.Tag != "" {
		return first.Tag
	}
	return first.ID
}

// readWhatsNewIndex prefers the file on disk so a development container with
// ./static mounted reports what it actually serves, and falls back to the copy
// embedded in the binary.
func readWhatsNewIndex() ([]byte, error) {
	diskPath := filepath.Join("static", "data", "whats-new", "index.json")
	if data, err := os.ReadFile(diskPath); err == nil {
		return data, nil
	}
	return embeddedFiles.ReadFile("static/data/whats-new/index.json")
}
