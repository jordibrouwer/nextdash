package app

import (
	"time"
)

/*
What the demo's timeline shows: Home Assistant went down a minute after it was
auto-updated, which is the story the page exists to tell. The outage is one the
demo's monitors already have, so nothing else in the demo moves; the update is
placed a minute before it, and the container is tied to the bookmark by a
manual link (demoTimelineLinks, saved with the settings).
*/

var demoTimelineLinks = map[string]string{
	"homeassistant": "2::https://www.home-assistant.io/",
}

func (h *Handlers) seedDemoTimeline(now time.Time) error {
	hist := readHealthHistoryFile()
	ha := deriveIncidents(hist.Samples[canonicalBookmarkURLKey("https://www.home-assistant.io/")], now)
	var outageAt int64
	for _, inc := range ha {
		if !inc.Ongoing && inc.Start > outageAt {
			outageAt = inc.Start
		}
	}
	if outageAt == 0 {
		outageAt = now.Add(-26 * time.Hour).UnixMilli()
	}
	at := func(d time.Duration) int64 { return now.Add(d).UnixMilli() }

	dockerUpdateHistoryMu.Lock()
	err := writeIndentJSONFile(dockerUpdateHistoryFilePath(), map[string]any{"entries": []dockerUpdateHistoryEntry{
		{At: at(-3*24*time.Hour - 2*time.Hour), Kind: "update", Container: "sonarr", Image: "lscr.io/linuxserver/sonarr:4",
			FromImageID: "sha256:5a1f0c9e8d7b", ToImageID: "sha256:9c2e4b6a1f03", FromVersion: "4.0.10", ToVersion: "4.0.11", By: "auto"},
		{At: outageAt - time.Minute.Milliseconds(), Kind: "update", Container: "homeassistant", Image: "ghcr.io/home-assistant/home-assistant:2024.12",
			FromImageID: "sha256:7d3b2a9c4e11", ToImageID: "sha256:e0f8a5c7b362", FromVersion: "2024.12.4", ToVersion: "2024.12.5", By: "auto"},
	}})
	dockerUpdateHistoryMu.Unlock()
	if err != nil {
		return err
	}

	dockerTimelines.replace(map[string][]dockerTimelineEntry{
		"sonarr": {
			{At: at(-2*24*time.Hour - 3*time.Hour), Kind: "unhealthy"},
			{At: at(-2*24*time.Hour - 3*time.Hour + 8*time.Minute), Kind: "healthy"},
		},
		"traefik": {
			{At: at(-2 * time.Hour), Kind: "unhealthy"},
		},
		"bazarr": {
			{At: at(-30 * time.Hour), Kind: "crash", Detail: "exit 137, out of memory"},
		},
	})
	if err := dockerTimelines.flush(); err != nil {
		return err
	}

	unraidEventsMu.Lock()
	defer unraidEventsMu.Unlock()
	return writeIndentJSONFile(unraidEventsFilePath(), map[string]any{"entries": []unraidEvent{
		{At: at(-27 * time.Hour), Event: "disk-errors", Title: "Disk 3 reported read errors", Detail: "2 new errors"},
	}})
}
