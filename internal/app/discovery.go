package app

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
App discovery: the containers become bookmarks. The run lists the containers
(the Docker socket, or the file NEXTDASH_DISCOVERY_FIXTURE names), works out
where each one's web page lives (discovery_candidates.go), asks that address
for a page (discovery_probe.go) and keeps what it found in data/discovery.json.

The first run only feeds the first-start card. After that a container is
"new" when its NAME is not among the names known from earlier runs: an update
recreates a container under the same name with a new id, and that is not a new
app, and neither is one that was gone for a run or two (compose down, then up).
A name a run cannot decide on yet -- a new container still booting, or one
that is stopped -- is not known until it is. A new app is added to the dashboard straight away, or proposed in the
Inbox, as the setting says.
*/

const (
	// discoveryRetryWindow is how long after its start a container whose
	// candidates all fail is probed again on every run: it may still be booting.
	discoveryRetryWindow = 15 * time.Minute
	discoveryBatch       = 8
	discoveryRunBudget   = 60 * time.Second
	discoveryEvery       = 5 * time.Minute
	// discoveryForget is how long a name that is no longer listed stays known.
	discoveryForget = 7 * 24 * time.Hour
)

// discoveredApp is one container with a web page. Icon is the icon-set entry as
// "set/name", or "". DisplayName is the nextdash.name label, when there is one;
// the container's Name stays the key everything else is filed under.
type discoveredApp struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Kind        string `json:"kind"`
	Icon        string `json:"icon"`
	Source      string `json:"source"`
	Title       string `json:"title,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	// IconURL is where the card shows the set icon from; filled in for the
	// answer, never stored.
	IconURL string `json:"iconUrl,omitempty"`
	// HostBound marks an address on the host the run probed through (a port,
	// an Unraid [IP]); it follows the host the dashboard is opened on.
	HostBound bool `json:"hostBound,omitempty"`
}

// onHost is the app with its host-bound address moved from the host the run
// used to host, the one the browser reaches the server on.
func (a discoveredApp) onHost(runHost, host string) discoveredApp {
	runHost, host = strings.Trim(runHost, "[]"), strings.Trim(host, "[]")
	if !a.HostBound || runHost == "" || host == "" || strings.EqualFold(runHost, host) {
		return a
	}
	u, err := url.Parse(a.URL)
	if err != nil || !strings.EqualFold(u.Hostname(), runHost) {
		return a
	}
	if port := u.Port(); port != "" {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	} else {
		u.Host = host
	}
	a.URL = u.String()
	return a
}

func (a discoveredApp) bookmarkName() string {
	if a.DisplayName != "" {
		return a.DisplayName
	}
	return a.Name
}

// discoveryRecentAdd is a direct add the browser has not acknowledged yet.
type discoveryRecentAdd struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Key      string `json:"key"`
	Category string `json:"category"`
	AddedAt  int64  `json:"addedAt"`
}

// discoveryState is data/discovery.json.
type discoveryState struct {
	FirstRunDone bool `json:"firstRunDone"`
	// Seen maps every container name of the previous run to its id.
	Seen map[string]string `json:"seen"`
	// Known holds every name decided on, with the last time a run listed it;
	// a name is new when it is not here. Kept a week after it was last listed.
	Known map[string]int64 `json:"known"`
	// Probed maps a name to the id last probed to the end while it ran: that
	// container is not asked again until it is recreated.
	Probed map[string]string `json:"probed"`
	// Host is the host the last run put port addresses on.
	Host string `json:"host,omitempty"`
	// Proposed holds the names already added or put in the Inbox: once only.
	Proposed map[string]bool `json:"proposed"`
	// Retry holds the containers still being probed because they may be
	// booting, with their Created time.
	Retry map[string]int64 `json:"retry"`
	Apps  []discoveredApp  `json:"apps"`
	// PageID is the page the card last added to; direct adds go there.
	PageID int `json:"pageId,omitempty"`
	// KindCategory remembers the category the card used per page and kind.
	KindCategory map[int]map[string]string `json:"kindCategory,omitempty"`
	RecentAdds   []discoveryRecentAdd      `json:"recentAdds,omitempty"`
	// CardAdds is what the card's last Add placed, for its Undo; StarterReplaced
	// says that Add also took the starter links off main.
	CardAdds        []discoveryRecentAdd `json:"cardAdds,omitempty"`
	StarterReplaced bool                 `json:"starterReplaced,omitempty"`
	// Pending holds the new apps waiting for the reader's yes (asking first,
	// the default), by container name, until Add or Ignore answers them.
	Pending []string `json:"pending,omitempty"`
}

func (st *discoveryState) normalize() {
	if st.Seen == nil {
		st.Seen = map[string]string{}
	}
	if st.Proposed == nil {
		st.Proposed = map[string]bool{}
	}
	if st.Retry == nil {
		st.Retry = map[string]int64{}
	}
	if st.Known == nil {
		st.Known = map[string]int64{}
		for name := range st.Seen {
			st.Known[name] = time.Now().Unix()
		}
	}
	if st.Probed == nil {
		st.Probed = map[string]string{}
		for name, id := range st.Seen {
			st.Probed[name] = id
		}
	}
}

type discoveryRunResult struct {
	Ran      bool     `json:"ran"`
	Docker   bool     `json:"docker"`
	Apps     int      `json:"apps"`
	Added    []string `json:"added"`
	Proposed []string `json:"proposed"`
	Asked    []string `json:"asked"`
}

func discoveryStatePath() string { return filepath.Join(ResolveDataDir(), "discovery.json") }

// discoveryLocked is the state, loaded on first use. Caller holds discoveryMu.
func (h *Handlers) discoveryLocked() *discoveryState {
	if h.discovery == nil {
		st := &discoveryState{}
		if data, err := os.ReadFile(discoveryStatePath()); err == nil {
			_ = json.Unmarshal(data, st)
		}
		st.normalize()
		h.discovery = st
	}
	return h.discovery
}

func (h *Handlers) saveDiscoveryLocked() error {
	data, err := json.MarshalIndent(h.discovery, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(discoveryStatePath(), data, 0o644)
}

// withDiscoveryState runs fn on the state under its lock and saves it.
func (h *Handlers) withDiscoveryState(fn func(*discoveryState)) error {
	h.discoveryMu.Lock()
	defer h.discoveryMu.Unlock()
	fn(h.discoveryLocked())
	return h.saveDiscoveryLocked()
}

// listDiscoveryContainers reads the fixture file when there is one, else the
// Docker socket.
func listDiscoveryContainers(ctx context.Context) ([]dockerContainerSummary, error) {
	if path := strings.TrimSpace(os.Getenv("NEXTDASH_DISCOVERY_FIXTURE")); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var out []dockerContainerSummary
		if err := json.Unmarshal(data, &out); err != nil {
			return nil, err
		}
		return out, nil
	}
	api, reason := newDockerAPI()
	if api == nil {
		return nil, errors.New(reason)
	}
	return api.listContainers(ctx)
}

// discoveryLanNetworks names the networks that give a container an address of
// its own; the fixture has none.
func discoveryLanNetworks(ctx context.Context) map[string]bool {
	if strings.TrimSpace(os.Getenv("NEXTDASH_DISCOVERY_FIXTURE")) != "" {
		return nil
	}
	if api, _ := newDockerAPI(); api != nil {
		return api.dockerLanNetworks(ctx)
	}
	return nil
}

// discoveryHost is the host port links use: the address set in the Containers
// view, else the host the dashboard was last opened on, else the default
// gateway when nextDash runs in a container, else localhost.
func (h *Handlers) discoveryHost(s Settings) string {
	if s.DockerHostAddress != "" {
		return s.DockerHostAddress
	}
	if s.DockerHostSeen != "" {
		return s.DockerHostSeen
	}
	if ip := containerGatewayIP(); ip != "" {
		return ip
	}
	return "localhost"
}

// discoveryProbeHost is where the server itself reaches the published ports:
// the address set in the Containers view, else the default gateway when
// nextDash runs in a container, else localhost. Not the host the browser last
// used -- that name may resolve only on the reader's network, or be this
// container's own loopback -- so links are moved to it afterwards (onHost).
func (h *Handlers) discoveryProbeHost(s Settings) string {
	if s.DockerHostAddress != "" {
		return s.DockerHostAddress
	}
	if ip := containerGatewayIP(); ip != "" {
		return ip
	}
	return "localhost"
}

func discoveryHosts(s Settings, host string) []string {
	out := []string{host}
	for _, c := range []string{s.DockerHostAddress, s.DockerHostSeen} {
		if c != "" && !containsString(out, c) {
			out = append(out, c)
		}
	}
	return out
}

// discoveryPublishedPorts are the published, non-UDP ports, as the browser's
// container shape holds them.
func discoveryPublishedPorts(c dockerContainerSummary) []int {
	var out []int
	for _, p := range c.Ports {
		if p.PublicPort > 0 && !strings.EqualFold(p.Type, "udp") {
			out = append(out, p.PublicPort)
		}
	}
	return out
}

// discoveryIconRef is the icon-set entry for a container as "set/name": the
// nextdash.icon label when it names one, else the sets' own match.
func discoveryIconRef(c dockerContainerSummary) string {
	x := currentIconSets()
	if x == nil {
		return ""
	}
	if label := strings.TrimSpace(c.Labels["nextdash.icon"]); label != "" {
		if strings.Contains(label, "://") {
			return "" // an address is not a set icon
		}
		for _, set := range []string{iconSetDashboard, iconSetSelfhst} {
			if e := x.entry(set, label); e != nil {
				return e.Set + "/" + e.Name
			}
		}
		return ""
	}
	if e := x.matchContainer(c.Image, c.name()); e != nil {
		return e.Set + "/" + e.Name
	}
	return ""
}

// discoveryIconURL is the address of a "set/name" icon's file, for a preview.
func discoveryIconURL(icon string) string {
	set, name, ok := strings.Cut(icon, "/")
	if !ok {
		return ""
	}
	x := currentIconSets()
	if x == nil {
		return ""
	}
	e := x.entry(set, name)
	if e == nil {
		return ""
	}
	return iconSetFileURL(e.Set, e.variantFile("base"))
}

// resetDiscovery forgets every container seen, as a fresh install has not
// seen any: after a reset the apps card is offered again.
func (h *Handlers) resetDiscovery() {
	h.discoveryMu.Lock()
	defer h.discoveryMu.Unlock()
	h.discovery = &discoveryState{}
	h.discovery.normalize()
	_ = os.Remove(discoveryStatePath())
}

// discoveryIconFile copies a set icon into data/icons/ and returns the name a
// bookmark stores, or "" when there is none.
func discoveryIconFile(ctx context.Context, icon string) string {
	set, name, ok := strings.Cut(icon, "/")
	if !ok {
		return ""
	}
	e := currentIconSets().entry(set, name)
	if e == nil {
		return ""
	}
	file, err := adoptIconSetFile(ctx, e.Set, e.variantFile("base"))
	if err != nil {
		return ""
	}
	return file
}

// discoveryEntry is one container's turn through a run.
type discoveryEntry struct {
	c       dockerContainerSummary
	name    string
	skip    bool
	matched bool
	probe   bool
	cands   []discoveryCandidate
	reached bool // every candidate was asked before the budget ran out
	ok      bool
	app     discoveredApp
	carried bool // an app from the previous run, not probed this time
	stopped bool // listed but not running: not probed this time
}

func (e *discoveryEntry) probeAll(ctx context.Context) {
	for _, cand := range e.cands {
		res := probeDiscoveryCandidate(ctx, cand)
		if ctx.Err() != nil {
			return
		}
		if res.OK {
			u := cand.URL
			if res.URL != "" {
				u = res.URL
			}
			e.ok = true
			e.app = discoveredApp{
				Name:        e.name,
				URL:         u,
				Kind:        discoveryKind(e.c.Image, e.name, e.c.Labels),
				Icon:        discoveryIconRef(e.c),
				Source:      string(cand.Source),
				Title:       res.Title,
				DisplayName: strings.TrimSpace(e.c.Labels["nextdash.name"]),
			}
			break
		}
	}
	e.reached = true
}

// runDiscovery is one look through the containers. now is injected so the
// retry window can be tested.
func (h *Handlers) runDiscovery(ctx context.Context, now time.Time) (discoveryRunResult, error) {
	res := discoveryRunResult{Added: []string{}, Proposed: []string{}, Asked: []string{}}
	if demoMode() {
		return res, nil
	}
	settings := h.store.GetSettings()
	if !settings.DiscoverApps {
		// Off, then on again, is silent: the first run after it comes back
		// refreshes what was seen and proposes nothing.
		h.discoveryMu.Lock()
		defer h.discoveryMu.Unlock()
		if st := h.discoveryLocked(); st.FirstRunDone {
			st.FirstRunDone = false
			return res, h.saveDiscoveryLocked()
		}
		return res, nil
	}

	h.discoveryRunMu.Lock()
	defer h.discoveryRunMu.Unlock()
	h.discoveryRunning.Store(true)
	defer h.discoveryRunning.Store(false)
	res.Ran = true

	list, err := listDiscoveryContainers(ctx)
	if err != nil {
		h.discoveryDocker.Store(false)
		return res, nil
	}
	h.discoveryDocker.Store(true)
	res.Docker = true

	// What the previous run left, copied: probing takes a while and the
	// state lock is not held for it.
	h.discoveryMu.Lock()
	st := h.discoveryLocked()
	prevSeen := make(map[string]string, len(st.Seen))
	for k, v := range st.Seen {
		prevSeen[k] = v
	}
	prevRetry := make(map[string]int64, len(st.Retry))
	for k, v := range st.Retry {
		prevRetry[k] = v
	}
	prevProposed := make(map[string]bool, len(st.Proposed))
	for k, v := range st.Proposed {
		prevProposed[k] = v
	}
	prevApps := make(map[string]discoveredApp, len(st.Apps))
	for _, a := range st.Apps {
		prevApps[a.Name] = a
	}
	prevKnown := make(map[string]int64, len(st.Known))
	for k, v := range st.Known {
		prevKnown[k] = v
	}
	prevProbed := make(map[string]string, len(st.Probed))
	for k, v := range st.Probed {
		prevProbed[k] = v
	}
	first := st.FirstRunDone
	prevHost := st.Host
	readState := st
	h.discoveryMu.Unlock()

	selfID := discoverySelfID()
	host := h.discoveryProbeHost(settings)
	linkHost := h.discoveryHost(settings)
	hosts := discoveryHosts(settings, host)
	bareHost := strings.Trim(host, "[]")
	lan := discoveryLanNetworks(ctx)
	bookmarks := h.store.GetAllBookmarks()

	entries := make([]*discoveryEntry, 0, len(list))
	for _, c := range list {
		e := &discoveryEntry{c: c, name: c.name()}
		entries = append(entries, e)
		if discoverySkipReason(c, settings, selfID) != "" {
			e.skip = true
			continue
		}
		lanIP := dockerLanIP(c, lan)
		if _, _, ok := matchContainerBookmark(discoveryContainer{
			Name: e.name, WebUI: dockerWebUI(c), LanIP: lanIP, Ports: discoveryPublishedPorts(c),
		}, bookmarks, settings.DockerBookmarkLinks, hosts); ok {
			e.matched = true
			continue
		}
		e.cands = discoveryCandidates(c, bareHost, lanIP, settings.DockerWebUIs[e.name])
		_, inRetry := prevRetry[e.name]
		_, wasApp := prevApps[e.name]
		if c.State != "" && c.State != "running" {
			// Stopped: nothing answers, so nothing is decided about it yet.
			e.stopped = true
			continue
		}
		// A container probed before under this id that was not a web app and
		// is out of its retry window stays that way until it is recreated.
		e.probe = prevProbed[e.name] != c.ID || inRetry || wasApp
	}

	budget, cancel := context.WithTimeout(ctx, discoveryRunBudget)
	defer cancel()
	var todo []*discoveryEntry
	for _, e := range entries {
		if e.probe {
			todo = append(todo, e)
		}
	}
	for i := 0; i < len(todo) && budget.Err() == nil; i += discoveryBatch {
		end := i + discoveryBatch
		if end > len(todo) {
			end = len(todo)
		}
		var wg sync.WaitGroup
		for _, e := range todo[i:end] {
			wg.Add(1)
			go func(e *discoveryEntry) {
				defer wg.Done()
				e.probeAll(budget)
			}(e)
		}
		wg.Wait()
	}

	// One app per address, named after the first container Docker lists. A
	// container not probed this time keeps the app it had.
	var apps []*discoveryEntry
	byURL := map[string]bool{}
	for _, e := range entries {
		if e.skip || e.matched {
			continue
		}
		if (e.probe && !e.ok) || e.stopped {
			// An app that did not answer this time (down for a moment, or not
			// asked before the budget ran out) keeps the entry it had; it is
			// asked again next run.
			if a, ok := prevApps[e.name]; ok {
				// On the host this run probes, as the apps it found are.
				e.app, e.ok, e.carried = a.onHost(prevHost, bareHost), true, true
			}
		}
		if !e.ok {
			continue
		}
		if !e.carried && (e.app.Source == string(discoveryPort) || e.app.Source == string(discoveryUnraid)) {
			if u, err := url.Parse(e.app.URL); err == nil && strings.EqualFold(u.Hostname(), bareHost) {
				e.app.HostBound = true
			}
		}
		key := canonicalBookmarkURLKey(e.app.URL)
		if key == "" || byURL[key] {
			e.ok = false
			continue
		}
		byURL[key] = true
		apps = append(apps, e)
	}

	// What is new, by name: not known from an earlier run. A new container
	// that was still booting, or stopped, was not decided on, so it is not
	// known yet and counts as new once it answers.
	var fresh []*discoveryEntry
	if first {
		for _, e := range apps {
			if e.carried {
				continue
			}
			if _, known := prevKnown[e.name]; !known && !prevProposed[e.name] {
				fresh = append(fresh, e)
			}
		}
	}

	newSeen := map[string]string{}
	newRetry := map[string]int64{}
	newKnown := map[string]int64{}
	for name, last := range prevKnown {
		if now.Sub(time.Unix(last, 0)) < discoveryForget {
			newKnown[name] = last
		}
	}
	newProbed := map[string]string{}
	listed := map[string]bool{}
	for _, e := range entries {
		listed[e.name] = true
	}
	for name, id := range prevProbed {
		if listed[name] {
			newProbed[name] = id
		}
	}
	for _, e := range entries {
		_, wasKnown := prevKnown[e.name]
		if wasKnown {
			newKnown[e.name] = now.Unix()
		}
		if e.probe && !e.reached {
			// Not asked in time: its old state stands.
			if id, ok := prevSeen[e.name]; ok {
				newSeen[e.name] = id
			}
			if created, ok := prevRetry[e.name]; ok {
				newRetry[e.name] = created
			}
			continue
		}
		newSeen[e.name] = e.c.ID
		retrying := e.probe && !e.ok && now.Sub(time.Unix(e.c.Created, 0)) < discoveryRetryWindow
		if retrying {
			newRetry[e.name] = e.c.Created
		}
		if e.probe {
			newProbed[e.name] = e.c.ID
		}
		// The first run knows everything it lists. After it, a new name that
		// is still booting or stopped is left undecided.
		if !first || !(retrying || e.stopped) {
			newKnown[e.name] = now.Unix()
		}
	}

	// Icons are fetched before the state lock is taken.
	iconFiles := map[string]string{}
	for _, e := range fresh {
		if e.app.Icon != "" {
			iconFiles[e.name] = discoveryIconFile(ctx, e.app.Icon)
		}
	}

	if discoveryBeforeSaveHook != nil {
		discoveryBeforeSaveHook()
	}
	h.discoveryMu.Lock()
	defer h.discoveryMu.Unlock()
	st = h.discoveryLocked()
	if st != readState {
		// Reset while this run was probing: what it found belongs to the data
		// that is gone.
		return res, nil
	}
	// A name taken out while this run was probing (Remove on the ignored
	// list) stays out: the run's maps were built from the copy before it.
	for name := range prevKnown {
		if _, still := st.Known[name]; !still {
			delete(newKnown, name)
		}
	}
	for name := range prevProbed {
		if _, still := st.Probed[name]; !still {
			delete(newProbed, name)
		}
	}

	handled := map[string]bool{}
	var runErr error
	if len(fresh) > 0 {
		switch settings.DiscoveryNewApps {
		case "inbox":
			for _, e := range fresh {
				_, _, err := h.store.AddInboxLink(InboxLink{
					URL:           e.app.URL,
					Title:         e.app.bookmarkName(),
					Source:        "discovery",
					Icon:          iconFiles[e.name],
					PreviewTitle:  e.app.Title,
					ContainerName: e.name,
					AppKind:       e.app.Kind,
					AppIcon:       e.app.Icon,
				}, true, 0)
				switch {
				case err == nil:
					res.Proposed = append(res.Proposed, e.name)
					handled[e.name] = true
				case errors.Is(err, ErrInboxDuplicateURL):
					handled[e.name] = true
				default:
					runErr = err
				}
			}
		case "add":
			items := make([]discoveryAddItem, 0, len(fresh))
			for _, e := range fresh {
				items = append(items, discoveryAddItem{App: e.app.onHost(bareHost, linkHost), IconFile: iconFiles[e.name]})
			}
			added, outcome, err := h.addDiscoveredBookmarks(ctx, st, h.discoveryTargetPage(st), items, true, false)
			if err != nil {
				runErr = err
			}
			addedAt := now.UnixMilli()
			for _, a := range added {
				a.AddedAt = addedAt
				st.RecentAdds = append(st.RecentAdds, a)
				res.Added = append(res.Added, a.Name)
			}
			for name, ok := range outcome {
				if ok {
					handled[name] = true
				}
			}
		default:
			// Ask first: the dashboard puts the question in the middle of the
			// screen, and nothing lands on a page until it is answered.
			for _, e := range fresh {
				if !containsString(st.Pending, e.name) {
					st.Pending = append(st.Pending, e.name)
				}
				res.Asked = append(res.Asked, e.name)
				handled[e.name] = true
			}
		}
	}
	for _, e := range fresh {
		if handled[e.name] {
			st.Proposed[e.name] = true
		} else {
			// Not placed: left out of what is known, so the next run finds it
			// new again.
			delete(newKnown, e.name)
		}
	}

	st.Apps = st.Apps[:0:0]
	for _, e := range apps {
		st.Apps = append(st.Apps, e.app)
	}
	res.Apps = len(st.Apps)
	st.Seen = newSeen
	st.Retry = newRetry
	st.Known = newKnown
	st.Probed = newProbed
	st.Host = bareHost
	st.FirstRunDone = true
	if err := h.saveDiscoveryLocked(); err != nil && runErr == nil {
		runErr = err
	}
	return res, runErr
}

// discoveryTargetPage is the page direct adds go to: the one the card last
// added to, else the main page, else the first page there is.
func (h *Handlers) discoveryTargetPage(st *discoveryState) int {
	if st.PageID > 0 && h.pageExists(st.PageID) {
		return st.PageID
	}
	if h.pageExists(1) {
		return 1
	}
	for _, p := range h.store.GetPages() {
		if p.ID != unsortedPageID {
			return p.ID
		}
	}
	return 1
}

// discoveryAddItem is one app to put on a page. Category is a name, as the
// user sees it; empty means the one the state or the kind gives. IconFile is
// the file in data/icons/ the bookmark takes.
type discoveryAddItem struct {
	App      discoveredApp
	Category string
	IconFile string
}

func newDiscoveryCategoryID() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	var b strings.Builder
	for i := 0; i < 6; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			n = big.NewInt(int64(i))
		}
		b.WriteByte(alphabet[n.Int64()])
	}
	return "cat_" + strconv.FormatInt(time.Now().UnixMilli(), 36) + "_" + b.String()
}

func findCategoryByName(cats []Category, name string) *Category {
	name = strings.TrimSpace(name)
	for i := range cats {
		if strings.EqualFold(strings.TrimSpace(cats[i].Name), name) {
			return &cats[i]
		}
	}
	return nil
}

// addDiscoveredBookmarks is the one path that creates bookmarks, categories and
// links for discovered apps: the card's Add and a direct add both use it.
// Caller holds discoveryMu. direct picks the category the way a direct add
// does (the one the card used for the kind, else by the English kind name);
// otherwise Category is the name to reuse or create. cardDone also sets
// discoveryCardDone, and records the page and the categories used.
//
// outcome says per name whether it is dealt with: added, or already on a
// page. A name missing from outcome failed and may be tried again.
func (h *Handlers) addDiscoveredBookmarks(ctx context.Context, st *discoveryState, pageID int, items []discoveryAddItem, direct, cardDone bool) (added []discoveryRecentAdd, outcome map[string]bool, err error) {
	outcome = map[string]bool{}
	cats := h.store.GetCategoriesByPage(pageID)
	for i := range cats {
		if cats[i].OriginalID == "" {
			cats[i].OriginalID = cats[i].ID
		}
	}
	changed := false
	// New categories go to the top of the page, where the reader sees them.
	var made []Category
	catOf := make([]string, len(items))
	for i, it := range items {
		kind := it.App.Kind
		if kind == "" {
			kind = "Apps"
		}
		var cat *Category
		name := strings.TrimSpace(it.Category)
		if direct {
			if id := st.KindCategory[pageID][kind]; id != "" {
				for j := range cats {
					if cats[j].ID == id {
						cat = &cats[j]
					}
				}
			}
			name = kind
		}
		if name == "" {
			name = kind
		}
		if cat == nil {
			cat = findCategoryByName(made, name)
		}
		if cat == nil {
			cat = findCategoryByName(cats, name)
		}
		if cat == nil {
			id := newDiscoveryCategoryID()
			made = append(made, Category{ID: id, OriginalID: id, Name: clampEntityName(name)})
			cat = &made[len(made)-1]
			changed = true
		}
		catOf[i] = cat.ID
	}
	if changed {
		cats = append(append([]Category(nil), made...), cats...)
		if err := h.store.SaveCategoriesByPage(pageID, cats); err != nil {
			return nil, outcome, err
		}
	}
	nameOf := func(id string) string {
		for _, c := range cats {
			if c.ID == id {
				return c.Name
			}
		}
		return ""
	}

	links := map[string]string{}
	for i, it := range items {
		u := strings.TrimSpace(it.App.URL)
		if h.validateBookmarkURL(u) != nil {
			outcome[it.App.Name] = true // never placeable; not tried again
			continue
		}
		if existing := findBookmarkByURLKey(h.store, canonicalBookmarkURLKey(u)); existing != nil {
			// Already on a page: the container is tied to that bookmark.
			links[it.App.Name] = matchBookmarkKey(*existing)
			outcome[it.App.Name] = true
			continue
		}
		bm := Bookmark{
			Name:        clampEntityName(it.App.bookmarkName()),
			URL:         u,
			Category:    catOf[i],
			CheckStatus: true,
			Icon:        sanitizeBookmarkIcon(it.IconFile),
			CreatedAt:   time.Now().UnixMilli(),
		}
		trimBookmarkTextFields(&bm)
		if addErr := h.store.AddBookmarkToPage(pageID, bm); addErr != nil {
			if errors.Is(addErr, ErrBookmarkDuplicateURL) {
				outcome[it.App.Name] = true
				continue
			}
			err = addErr
			continue
		}
		key := strconv.Itoa(pageID) + "::" + u
		links[it.App.Name] = key
		outcome[it.App.Name] = true
		added = append(added, discoveryRecentAdd{Name: it.App.Name, URL: u, Key: key, Category: nameOf(catOf[i])})
		if !direct {
			if st.KindCategory == nil {
				st.KindCategory = map[int]map[string]string{}
			}
			if st.KindCategory[pageID] == nil {
				st.KindCategory[pageID] = map[string]string{}
			}
			kind := it.App.Kind
			if kind == "" {
				kind = "Apps"
			}
			st.KindCategory[pageID][kind] = catOf[i]
		}
	}
	if cardDone {
		st.PageID = pageID
	}
	if len(links) > 0 || cardDone {
		if serr := h.updateSettings(func(s *Settings) {
			if len(links) > 0 && s.DockerBookmarkLinks == nil {
				s.DockerBookmarkLinks = map[string]string{}
			}
			for name, key := range links {
				s.DockerBookmarkLinks[name] = key
			}
			if cardDone {
				s.DiscoveryCardDone = true
			}
		}); serr != nil && err == nil {
			err = serr
		}
	}
	return added, outcome, err
}

// updateSettings is the settings read-merge-write as one step.
func (h *Handlers) updateSettings(mutate func(*Settings)) error {
	h.settingsMu.Lock()
	defer h.settingsMu.Unlock()
	s := h.store.GetSettings()
	mutate(&s)
	return h.store.SaveSettings(s)
}

// StartDiscoveryScheduler runs discovery once at start and then every five
// minutes. A run still going when the tick comes makes it skip.
func (h *Handlers) StartDiscoveryScheduler(stop <-chan struct{}) {
	go func() {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		go func() {
			<-stop
			cancel()
		}()
		tick := func() {
			if h.discoveryRunning.Load() {
				return
			}
			defer func() {
				if r := recover(); r != nil {
					logWarn(logComponentNotify, "an app discovery run failed and was skipped: %v", r)
				}
			}()
			if _, err := h.runDiscovery(ctx, time.Now()); err != nil {
				logWarn(logComponentNotify, "app discovery could not save everything: %v", err)
			}
		}
		tick()
		ticker := time.NewTicker(discoveryEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tick()
			}
		}
	}()
}

// discoveryAppMatches says whether an app already has a bookmark, from what the
// app itself knows: its address, taken as its web UI.
func discoveryAppMatches(a discoveredApp, bookmarks []Bookmark, links map[string]string, hosts []string) bool {
	c := discoveryContainer{Name: a.Name, WebUI: a.URL}
	if u, err := url.Parse(a.URL); err == nil {
		if p, err := strconv.Atoi(u.Port()); err == nil {
			c.Ports = []int{p}
		}
	}
	_, _, ok := matchContainerBookmark(c, bookmarks, links, hosts)
	return ok
}

// discoveryBeforeSaveHook runs between a run's probing and its save; tests use
// it to change the state underneath a run.
var discoveryBeforeSaveHook func()
