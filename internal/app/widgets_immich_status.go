package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
The Immich status tile: how big the library is, how full the disk, what the
background jobs are doing, and whether an update is out.

Each topic is asked on its own and a topic that fails is left out, not drawn
as zero. Immich keeps the server's figures and the jobs for an administrator,
so a key made for a plain user is refused them: that is said once
(NeedsAdmin) and is not a failure to retry, where a topic that could not be
read at all makes the answer partial and is asked for again soon.
*/

const (
	immichStatusDefaultTTL = 120
	immichStatusMinTTL     = 30
)

var immichStatusTopics = []string{"library", "storage", "jobs", "duplicates"}

func immichStatusFields() []widgetField {
	return []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		// What the tile shows. Absent means library, storage and jobs.
		{Key: "topics", Kind: "list", Allowed: immichStatusTopics},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "ttl", Kind: "int", Min: immichStatusMinTTL, Max: 3600},
	}
}

// MediaImmich is what an Immich status tile draws. Every figure is a pointer
// or a list so that what Immich did not say is absent, never a quiet zero.
type MediaImmich struct {
	Topics  []string `json:"topics"`
	Version string   `json:"version,omitempty"`
	// Update is the release that is out, set only when it is newer.
	Update string `json:"update,omitempty"`
	// Photos and Videos are counts; the usages are bytes.
	Photos      *int64 `json:"photos,omitempty"`
	Videos      *int64 `json:"videos,omitempty"`
	Usage       *int64 `json:"usage,omitempty"`
	UsagePhotos *int64 `json:"usagePhotos,omitempty"`
	UsageVideos *int64 `json:"usageVideos,omitempty"`
	// Disk is the volume the library lives on.
	Disk *MediaImmichDisk `json:"disk,omitempty"`
	// Queues is every job queue that is not idle and quiet; Failed is the sum
	// of what failed over all of them.
	Queues     []MediaImmichQueue `json:"queues,omitempty"`
	JobsRead   bool               `json:"jobsRead,omitempty"`
	Failed     int                `json:"failed,omitempty"`
	Duplicates *int               `json:"duplicates,omitempty"`
	Partial    bool               `json:"partial,omitempty"`
	// NeedsAdmin says a topic was refused to this key.
	NeedsAdmin bool   `json:"needsAdmin,omitempty"`
	OpenURL    string `json:"openUrl"`
}

type MediaImmichDisk struct {
	Used int64   `json:"used"`
	Size int64   `json:"size"`
	Pct  float64 `json:"pct"`
}

type MediaImmichQueue struct {
	Name    string `json:"name"`
	Active  int    `json:"active"`
	Waiting int    `json:"waiting"`
	Failed  int    `json:"failed"`
	Paused  bool   `json:"paused,omitempty"`
}

type immichStatusSpec struct {
	Server       string
	CredentialID string
	Topics       []string
	TTL          time.Duration
}

func immichStatusSpecFrom(config map[string]any) immichStatusSpec {
	spec := immichStatusSpec{
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		Topics:       widgetConfigList(config["topics"], immichStatusTopics),
		TTL:          immichStatusDefaultTTL * time.Second,
	}
	if _, set := config["topics"]; !set || len(spec.Topics) == 0 {
		spec.Topics = []string{"library", "storage", "jobs"}
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, immichStatusMinTTL, 3600)) * time.Second
	}
	return spec
}

func (spec immichStatusSpec) fingerprint() string {
	return strings.Join([]string{"status", spec.Server, spec.CredentialID, strings.Join(spec.Topics, ",")}, "|")
}

func (spec immichStatusSpec) has(topic string) bool { return containsString(spec.Topics, topic) }

// immichNewer says whether release is a later version than installed. Both
// are "v3.4.1"; anything that does not read that way is not newer.
func immichNewer(release, installed string) bool {
	parse := func(raw string) ([3]int, bool) {
		var out [3]int
		parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(raw), "v"), ".")
		if len(parts) < 3 {
			return out, false
		}
		for i := 0; i < 3; i++ {
			digits := parts[i]
			if cut := strings.IndexAny(digits, "-+"); cut >= 0 {
				digits = digits[:cut]
			}
			n, err := strconv.Atoi(digits)
			if err != nil {
				return out, false
			}
			out[i] = n
		}
		return out, true
	}
	a, okA := parse(release)
	b, okB := parse(installed)
	if !okA || !okB {
		return false
	}
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

func int64Ptr(value int64) *int64 { return &value }

func (h *Handlers) fetchImmichStatus(ctx context.Context, spec immichStatusSpec) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, nil, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, nil, errMediaNotSetUp
	}
	status := &MediaImmich{Topics: spec.Topics, OpenURL: spec.Server}

	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		failed   int
		denied   int
		firstErr error
	)
	// run asks one topic; a failure is counted and the topic is left out.
	run := func(task func() error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := task(); err != nil {
				mu.Lock()
				if errors.Is(err, errMediaRefused) {
					denied++
				} else {
					failed++
				}
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
			}
		}()
	}

	run(func() error {
		// The version is its own line, so it is not a topic that can fail the tile.
		var about struct {
			Version string `json:"version"`
		}
		if err := h.immichGet(ctx, spec.Server, credential, "/server/about", nil, &about); err != nil {
			return err
		}
		var check struct {
			Release string `json:"releaseVersion"`
		}
		_ = h.immichGet(ctx, spec.Server, credential, "/server/version-check", nil, &check)
		mu.Lock()
		status.Version = about.Version
		if immichNewer(check.Release, about.Version) {
			status.Update = check.Release
		}
		mu.Unlock()
		return nil
	})
	if spec.has("library") {
		run(func() error {
			var stats struct {
				Photos      int64 `json:"photos"`
				Videos      int64 `json:"videos"`
				Usage       int64 `json:"usage"`
				UsagePhotos int64 `json:"usagePhotos"`
				UsageVideos int64 `json:"usageVideos"`
			}
			if err := h.immichGet(ctx, spec.Server, credential, "/server/statistics", nil, &stats); err != nil {
				return err
			}
			mu.Lock()
			status.Photos, status.Videos, status.Usage = int64Ptr(stats.Photos), int64Ptr(stats.Videos), int64Ptr(stats.Usage)
			status.UsagePhotos, status.UsageVideos = int64Ptr(stats.UsagePhotos), int64Ptr(stats.UsageVideos)
			mu.Unlock()
			return nil
		})
	}
	if spec.has("storage") {
		run(func() error {
			var disk struct {
				Size int64   `json:"diskSizeRaw"`
				Used int64   `json:"diskUseRaw"`
				Pct  float64 `json:"diskUsagePercentage"`
			}
			if err := h.immichGet(ctx, spec.Server, credential, "/server/storage", nil, &disk); err != nil {
				return err
			}
			mu.Lock()
			status.Disk = &MediaImmichDisk{Used: disk.Used, Size: disk.Size, Pct: disk.Pct}
			mu.Unlock()
			return nil
		})
	}
	if spec.has("jobs") {
		run(func() error {
			var jobs map[string]struct {
				QueueStatus struct {
					IsPaused bool `json:"isPaused"`
				} `json:"queueStatus"`
				JobCounts struct {
					Active  int `json:"active"`
					Waiting int `json:"waiting"`
					Failed  int `json:"failed"`
					Delayed int `json:"delayed"`
				} `json:"jobCounts"`
			}
			if err := h.immichGet(ctx, spec.Server, credential, "/jobs", nil, &jobs); err != nil {
				return err
			}
			queues := []MediaImmichQueue{}
			failedJobs := 0
			for name, queue := range jobs {
				counts := queue.JobCounts
				failedJobs += counts.Failed
				if counts.Active+counts.Waiting+counts.Failed == 0 && !queue.QueueStatus.IsPaused {
					continue
				}
				queues = append(queues, MediaImmichQueue{Name: name, Active: counts.Active,
					Waiting: counts.Waiting, Failed: counts.Failed, Paused: queue.QueueStatus.IsPaused})
			}
			// Failures first, then what is busy, then by name: the order must
			// not change from one read to the next.
			sort.Slice(queues, func(i, j int) bool {
				a, b := queues[i], queues[j]
				if (a.Failed > 0) != (b.Failed > 0) {
					return a.Failed > 0
				}
				if (a.Active+a.Waiting > 0) != (b.Active+b.Waiting > 0) {
					return a.Active+a.Waiting > 0
				}
				return a.Name < b.Name
			})
			mu.Lock()
			status.Queues, status.JobsRead, status.Failed = queues, true, failedJobs
			mu.Unlock()
			return nil
		})
	}
	if spec.has("duplicates") {
		run(func() error {
			count, err := h.immichCount(ctx, spec.Server, credential, "/duplicates")
			if err != nil {
				return err
			}
			mu.Lock()
			status.Duplicates = &count
			mu.Unlock()
			return nil
		})
	}
	wg.Wait()

	// Everything failing is an error the tile words; some failing is a half
	// answer it shows.
	asked := len(spec.Topics) + 1
	if failed+denied >= asked {
		return result, nil, firstErr
	}
	status.Partial = failed > 0
	status.NeedsAdmin = denied > 0
	result.Immich = status
	result.Partial = status.Partial
	return result, nil, nil
}

func (h *Handlers) immichStatusAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	spec := immichStatusSpecFrom(widget.Config)
	ms := mediaSpec{Service: string(WidgetTypeImmichStatus), Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		return h.fetchImmichStatus(ctx, spec)
	}, forced)
}

// immichCountMax bounds what one counted list may weigh.
const immichCountMax = 128 << 20

/*
immichCount counts the entries of a list without keeping them.

Immich's duplicates come as every group with every photo in full, which for a
library with a few thousand groups is more than the limit a list is read with;
only how many there are is wanted, so they are read one at a time and dropped.
*/
func (h *Handlers) immichCount(ctx context.Context, server string, credential HealthCredential, path string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, mediaAnswerTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, "/api"+path, nil, "application/json", nil)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(resp.Body, immichCountMax))
	if token, err := decoder.Token(); err != nil || token != json.Delim('[') {
		return 0, errMediaUnreachable
	}
	count := 0
	for decoder.More() {
		var skip json.RawMessage
		if err := decoder.Decode(&skip); err != nil {
			return 0, errMediaUnreachable
		}
		count++
	}
	return count, nil
}
