package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

/*
The weekly digest.

One message a week: what broke, what can be updated, what nobody opens. It is
not an alert, so it does not go through quietGate (nothing is held); it waits
for the quiet hours to end instead, and a digest that came due while the server
was off goes out on the first tick after the start, once.

State is one small file with the due slot it last handled. The slot is the date
of the latest configured weekday-and-time at or before now, so a restart, a
late start and a clock that ticks twice all give the same answer.
*/

const digestTickEvery = time.Minute

var digestMu sync.Mutex

type digestState struct {
	DueKey string          `json:"dueKey"`
	Latest *digestSnapshot `json:"latest,omitempty"`
}

func digestStatePath() string { return filepath.Join(ResolveDataDir(), "digest.json") }

func readDigestState() digestState {
	var st digestState
	if data, err := os.ReadFile(digestStatePath()); err == nil {
		_ = json.Unmarshal(data, &st)
	}
	return st
}

func writeDigestState(st digestState) {
	if err := writeCompactJSONFile(digestStatePath(), st); err != nil {
		logWarn(logComponentNotify, "the digest could not be saved: %v", err)
	}
}

// digestDue is the latest slot at or before now, and its date as the key.
func digestDue(s Settings, now time.Time) (time.Time, string) {
	loc := quietLocation(s)
	n := now.In(loc)
	hour, minute := parseDigestTime(s.DigestTime)
	back := (int(n.Weekday()) - s.DigestWeekday + 7) % 7
	due := time.Date(n.Year(), n.Month(), n.Day()-back, hour, minute, 0, 0, loc)
	if due.After(n) {
		due = time.Date(due.Year(), due.Month(), due.Day()-7, hour, minute, 0, 0, loc)
	}
	return due, due.Format("2006-01-02")
}

func (h *Handlers) collectDigestInput(now time.Time) digestInput {
	settings := h.store.GetSettings()
	report := h.loadBookmarkHealthReport(false)
	return digestInput{
		Now:             now,
		Settings:        settings,
		Issues:          report.Issues,
		StaleDays:       int(staleOpenThreshold(settings) / (24 * time.Hour)),
		Bookmarks:       h.store.GetAllBookmarks(),
		InboxCount:      len(h.store.GetInboxItems()),
		Updates:         h.dockerUpdateSnapshot(),
		CertsExpiring:   digestCertLines(report.Certificates, now),
		DomainsExpiring: digestDomainLines(report.Domains, now),
		Releases:        readRecentWhatsNewReleases(now),
	}
}

// digestDeliver is the seam the tests replace.
var digestDeliver = func(h *Handlers, ctx context.Context, n monitorNotification) {
	settings := h.store.GetSettings()
	if settings.PushNotifyEnabled {
		h.sendWebPushNotification(ctx, webPushMessage{
			Title: n.Title, Body: n.Error, Kind: "digest", Tag: "nextdash-digest",
			URL: "/#digest", At: n.At,
		})
	}
	h.postMonitorTarget(ctx, []monitorNotification{n})
}

// digestSlotAllowed is false for a slot that falls less than a week after the
// install (Settings.FirstRunAt). An install without that stamp, which is every
// one that predates it, is never held back.
func digestSlotAllowed(s Settings, due time.Time) bool {
	if s.FirstRunAt == 0 {
		return true
	}
	return due.UnixMilli() >= s.FirstRunAt+7*24*60*60*1000
}

func (h *Handlers) digestTick(ctx context.Context, now time.Time) {
	settings := h.store.GetSettings()
	if quietNow(settings, now) {
		return
	}
	due, key := digestDue(settings, now)

	digestMu.Lock()
	defer digestMu.Unlock()
	/*
	 * The first tick ever -- a fresh install, an upgrade to the build that has
	 * the digest, or the digest switched on for the first time -- has no state
	 * file. Due-and-not-sent would read last Monday's slot as missed and send it
	 * at once: a push minutes after starting the new build, about a week the
	 * reader never asked about. So the first tick only takes the current slot,
	 * and the first digest is the next one. A server that was down over Monday
	 * has the file, and still sends late, once.
	 */
	if _, err := os.Stat(digestStatePath()); os.IsNotExist(err) {
		writeDigestState(digestState{DueKey: key})
		return
	}
	st := readDigestState()
	if st.DueKey == key {
		return
	}
	// A new install gets its first digest a week after it started: a slot
	// that falls earlier is marked as handled and skipped, not sent late.
	if !digestSlotAllowed(settings, due) {
		st.DueKey = key
		writeDigestState(st)
		return
	}
	snap := buildDigest(h.collectDigestInput(now))
	snap.DueKey = key
	st.DueKey = key
	if snap.empty() {
		writeDigestState(st)
		return
	}
	st.Latest = &snap
	writeDigestState(st) // before sending: a failed send is not retried
	logActivity(activityCategoryMutate, "digest.sent", map[string]any{"dueKey": key}, "weekly digest")
	digestDeliver(h, ctx, digestNotice(snap))
}

func (h *Handlers) StartDigestScheduler(stop <-chan struct{}) {
	go func() {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		go func() { <-stop; cancel() }()
		ticker := time.NewTicker(digestTickEvery)
		defer ticker.Stop()
		h.digestTick(ctx, quietClock())
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.digestTick(ctx, quietClock())
			}
		}
	}()
}

// digestCertLines formats the report's certificates as "host (N days)",
// sorted by host.
func digestCertLines(certs map[string]HostCertificate, now time.Time) []string {
	hosts := make([]string, 0, len(certs))
	for host := range certs {
		hosts = append(hosts, host)
	}
	sort.Strings(hosts)
	lines := make([]string, 0, len(hosts))
	for _, host := range hosts {
		lines = append(lines, fmt.Sprintf("%s (%d days)", host, certDaysLeft(certs[host].ExpiresAt, now)))
	}
	return lines
}

// DigestLatest answers GET /api/digest/latest: the stored snapshot for the
// dashboard card, or 204 when there is none.
func (h *Handlers) DigestLatest(w http.ResponseWriter, r *http.Request) {
	digestMu.Lock()
	st := readDigestState()
	digestMu.Unlock()
	if st.Latest == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(st.Latest)
}

// DigestTest answers POST /api/digest/test: a proof digest from live data,
// stored as the latest and sent now. It leaves the week's slot alone, so the
// scheduled digest still goes out.
func (h *Handlers) DigestTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	now := time.Now()
	snap := buildDigest(h.collectDigestInput(now))
	if snap.empty() {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	_, snap.DueKey = digestDue(h.store.GetSettings(), now)
	digestMu.Lock()
	st := readDigestState()
	st.Latest = &snap
	writeDigestState(st)
	digestMu.Unlock()
	digestDeliver(h, r.Context(), digestNotice(snap))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snap)
}

// digestDomainLines formats the report's domains as "domain (N days)", sorted by
// name.
func digestDomainLines(domains map[string]HostDomain, now time.Time) []string {
	names := make([]string, 0, len(domains))
	for name := range domains {
		names = append(names, name)
	}
	sort.Strings(names)
	lines := make([]string, 0, len(names))
	for _, name := range names {
		lines = append(lines, fmt.Sprintf("%s (%d days)", name, certDaysLeft(domains[name].ExpiresAt, now)))
	}
	return lines
}
