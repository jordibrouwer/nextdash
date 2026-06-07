package main

import (
	"net/http"
	"os"
	"strings"
)

func writeAccessToken() string {
	return strings.TrimSpace(os.Getenv("NEXTDASH_WRITE_TOKEN"))
}

func (h *Handlers) requireWriteAccess(w http.ResponseWriter, r *http.Request) bool {
	token := writeAccessToken()
	if token == "" {
		return true
	}
	if r.Header.Get("X-NextDash-Token") != token {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}
