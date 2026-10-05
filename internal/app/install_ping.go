package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The install ping is the one thing nextDash sends when extended analytics is
// off: once a day, a random install id and the version, so the project can say
// how many installs exist. It is on by default and has its own switch, separate
// from the usage analytics opt-in. DISABLE_TELEMETRY stops it as well.
//
// Nothing else rides along: no hostname, no address, no settings, no counts.
// Umami sees the request's own IP, as any server does, but the id is what it
// counts by.
var (
	installPingURL       = "https://stats.nextdash.cc/api/send"
	installPingWebsiteID = "4295c1a8-1013-4aae-8320-6067bb4e78fa"
)

const (
	installPingInterval = 24 * time.Hour
	installPingTimeout  = 10 * time.Second
	installIDFile       = "install-id"
)

// installPingEnabled reports whether the daily ping may be sent: the user's
// switch, unless the operator disabled telemetry outright.
func installPingEnabled(settings Settings) bool {
	if telemetryDisabledByEnv() {
		return false
	}
	return settings.InstallPingEnabled
}

// loadOrCreateInstallID returns the random id this install reports, creating
// it on first use. Deleting the file gives the install a new identity.
func loadOrCreateInstallID(dataDir string) (string, error) {
	path := filepath.Join(dataDir, installIDFile)
	if raw, err := os.ReadFile(path); err == nil {
		if id := strings.TrimSpace(string(raw)); len(id) == 32 {
			return id, nil
		}
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := hex.EncodeToString(buf)
	if err := os.WriteFile(path, []byte(id+"\n"), 0o600); err != nil {
		return "", err
	}
	return id, nil
}

// sendInstallPing posts one ping. A failure is not retried before the next
// tick: a blocked network must cost nothing.
func sendInstallPing(ctx context.Context, id, version string) error {
	body, err := json.Marshal(map[string]any{
		"type": "event",
		"payload": map[string]any{
			"website":  installPingWebsiteID,
			"hostname": "installs.nextdash.cc",
			"url":      "/",
			"name":     "install-ping",
			"id":       id,
			"data":     map[string]any{"version": version},
		},
	})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, installPingTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, installPingURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "nextDash-install-ping")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// StartInstallPingScheduler sends the ping at start and then every 24h while
// the switch is on. Inside the goroutine, like the other schedulers, so a
// blocked network cannot delay start-up.
func (h *Handlers) StartInstallPingScheduler(stop <-chan struct{}) {
	run := func() {
		if !installPingEnabled(h.store.GetSettings()) {
			return
		}
		id, err := loadOrCreateInstallID(ResolveDataDir())
		if err != nil {
			logWarn(logComponentServer, "install id could not be stored (%v); no ping this time", err)
			return
		}
		_ = sendInstallPing(context.Background(), id, releaseTag())
	}

	ticker := time.NewTicker(installPingInterval)
	go func() {
		defer ticker.Stop()
		run()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				run()
			}
		}
	}()
}
