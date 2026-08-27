package app

import (
	"encoding/json"
	"net/http"
)

// Set at link time by the Docker build. The -X flag names the variable by its
// full package path, so both halves must move together if this package is ever
// renamed or relocated:
//
//	-X github.com/jordibrouwer/nextDash/internal/app.buildVersion=...
//	-X github.com/jordibrouwer/nextDash/internal/app.buildCommit=...
//
// A stale path there fails silently — the build succeeds and the version stays
// "dev" — so it is checked by TestBuildVersionLdflagPathMatchesDockerfile.
var (
	buildVersion = "dev"
	buildCommit  = ""
)

func Version(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"version": buildVersion,
		"commit":  buildCommit,
	})
}
