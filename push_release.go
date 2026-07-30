package main

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"time"
)

// notifyReleaseOnStartup pushes a notification when the running build is newer
// than the last release the operator was told about.
//
// The release tag comes from the What's new index the binary ships with, so it
// changes only when a new image is pulled and started — checking on startup is
// therefore the whole story, and there is nothing to poll. Deliberately no
// outbound call to a release feed: nextDash is self-hosted and must not phone
// home to decide what to show.
func (h *Handlers) notifyReleaseOnStartup() {
	settings := h.store.GetSettings()
	if !settings.PushNotifyEnabled || !settings.PushNotifyRelease {
		return
	}

	tag := strings.TrimSpace(releaseTag())
	if tag == "" {
		return
	}

	state := readPushReleaseState()
	if state.LastNotifiedTag == tag {
		return
	}
	// First run after enabling: record the current release without announcing it,
	// so turning the toggle on does not immediately fire a notification for the
	// version already running.
	if state.LastNotifiedTag == "" {
		writePushReleaseState(pushReleaseState{LastNotifiedTag: tag, NotifiedAt: time.Now().UnixMilli()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), pushSendTimeout+2*time.Second)
	defer cancel()
	h.pushReleaseAvailable(ctx, tag)

	writePushReleaseState(pushReleaseState{LastNotifiedTag: tag, NotifiedAt: time.Now().UnixMilli()})
}

// pushReleaseState remembers which release has already been announced, so a
// restart of the same version stays quiet.
type pushReleaseState struct {
	LastNotifiedTag string `json:"lastNotifiedTag"`
	NotifiedAt      int64  `json:"notifiedAt"`
}

// The state lives alongside the subscriptions rather than in settings: it is
// derived bookkeeping, not something the operator configures, and settings.json
// is user-editable and round-tripped through import/export.
func readPushReleaseState() pushReleaseState {
	pushMu.Lock()
	defer pushMu.Unlock()

	data, err := os.ReadFile(pushReleaseStateFilePath())
	if err != nil {
		return pushReleaseState{}
	}
	var state pushReleaseState
	if err := json.Unmarshal(data, &state); err != nil {
		return pushReleaseState{}
	}
	return state
}

func writePushReleaseState(state pushReleaseState) {
	pushMu.Lock()
	defer pushMu.Unlock()

	if err := writeIndentJSONFile(pushReleaseStateFilePath(), state); err != nil {
		logPushError("failed to persist release state: %v", err)
	}
}
