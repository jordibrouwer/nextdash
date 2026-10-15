package app

import (
	"context"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const jellyfinPlayingDefaultTTL = 10 * time.Second

type jellyfinPlayingSpec struct {
	Server       string
	CredentialID string
	HideNames    bool
	Rows         int
	TTL          time.Duration
}

func jellyfinPlayingSpecFrom(config map[string]any) jellyfinPlayingSpec {
	spec := jellyfinPlayingSpec{
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		HideNames:    config["hideNames"] == true,
		Rows:         jellyfinDefaultRows,
		TTL:          jellyfinPlayingDefaultTTL,
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, 5, 300)) * time.Second
	}
	return spec
}

// fingerprint changes with every setting that changes the answer, so names
// are gone the moment hideNames is switched on, not when the cache runs out.
func (spec jellyfinPlayingSpec) fingerprint() string {
	return strings.Join([]string{spec.Server, spec.CredentialID,
		strconv.FormatBool(spec.HideNames), strconv.Itoa(spec.Rows)}, "|")
}

type jellyfinRawSession struct {
	ID         string `json:"Id"`
	UserName   string `json:"UserName"`
	DeviceName string `json:"DeviceName"`
	Client     string `json:"Client"`
	PlayState  struct {
		PositionTicks int64  `json:"PositionTicks"`
		IsPaused      bool   `json:"IsPaused"`
		PlayMethod    string `json:"PlayMethod"`
	} `json:"PlayState"`
	NowPlayingItem *jellyfinRawItem `json:"NowPlayingItem"`
}

// fetchJellyfinPlaying lists what plays right now. Nobody watching is an
// empty answer, not an error.
func (h *Handlers) fetchJellyfinPlaying(ctx context.Context, spec jellyfinPlayingSpec, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}}
	images := map[mediaImageRef]bool{}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, images, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, images, errMediaNotSetUp
	}
	var sessions []jellyfinRawSession
	if err := h.jellyfinGet(ctx, spec.Server, credential, "/Sessions",
		url.Values{"activeWithinSeconds": {"120"}}, &sessions); err != nil {
		return result, images, err
	}
	// Playing before paused, then by name and id: lines keep their place
	// between refreshes, whatever order Jellyfin answers in.
	sort.SliceStable(sessions, func(i, j int) bool {
		a, b := sessions[i], sessions[j]
		if a.PlayState.IsPaused != b.PlayState.IsPaused {
			return !a.PlayState.IsPaused
		}
		if an, bn := strings.ToLower(a.UserName), strings.ToLower(b.UserName); an != bn {
			return an < bn
		}
		return a.ID < b.ID
	})
	for _, session := range sessions {
		if session.NowPlayingItem == nil || len(result.Items) >= spec.Rows {
			continue
		}
		raw := *session.NowPlayingItem
		item, refs := mapJellyfinItem(raw, JellyfinLibrary{}, spec.Server, imageURL)
		item.ID = session.ID
		if raw.Type == "TvChannel" {
			item.Kind = "tv"
		}
		// The phone apps name the device after its owner ("Jordi's iPhone"),
		// so hidden names say only which app it is.
		item.Device = session.DeviceName
		if item.Device == "" || spec.HideNames {
			item.Device = session.Client
		}
		if !spec.HideNames {
			item.Who = session.UserName
		}
		item.Method = "direct"
		if session.PlayState.PlayMethod == "Transcode" {
			item.Method = "transcode"
		}
		item.Paused = session.PlayState.IsPaused
		if raw.RunTimeTicks > 0 {
			share := float64(session.PlayState.PositionTicks) / float64(raw.RunTimeTicks)
			share = clampFloat(share, 0, 1, 0)
			item.Progress = &share
			// Ticks are 100 ns: 10,000,000 to the second.
			if left := raw.RunTimeTicks - session.PlayState.PositionTicks; left > 0 {
				item.Remaining = left / 10_000_000
			}
		}
		for _, ref := range refs {
			images[ref] = true
		}
		result.Items = append(result.Items, item)
	}
	return result, images, nil
}
