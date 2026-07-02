package main

import (
	"encoding/json"
	"net/http"
)

// Set at link time: -X main.buildVersion=... -X main.buildCommit=...
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
