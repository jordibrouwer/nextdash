package main

import (
	"net/http"
	"os"
	"strings"
	"sync"
)

var (
	corsConfigOnce sync.Once
	corsAllowAll   bool
	corsOrigins    map[string]struct{}
)

func initCORSConfig() {
	raw := strings.TrimSpace(os.Getenv("NEXTDASH_CORS_ORIGINS"))
	if raw == "" {
		corsAllowAll = true
		return
	}

	corsOrigins = make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		origin := strings.TrimSpace(part)
		if origin == "" {
			continue
		}
		corsOrigins[origin] = struct{}{}
	}
	if len(corsOrigins) == 0 {
		corsAllowAll = true
	}
}

// applyCORSHeaders sets CORS response headers for bookmark API and extension use.
// When NEXTDASH_CORS_ORIGINS is unset, Access-Control-Allow-Origin is * (default).
// When set to a comma-separated allowlist, only matching Origin values are echoed.
func applyCORSHeaders(w http.ResponseWriter, r *http.Request) {
	corsConfigOnce.Do(initCORSConfig)

	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-NextDash-Token")

	if corsAllowAll {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		return
	}

	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return
	}
	if _, ok := corsOrigins[origin]; ok {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
}
