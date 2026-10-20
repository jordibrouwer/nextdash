package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Beszel: how the machines are doing, on the shared media tile.

Four tiles read one hub: all systems, one system, only what needs a look, and
every disk. They share the sign-in, the setup panel and -- the part that
matters on a page -- the question. Four tiles on one page ask the hub for its
systems once per beat, not four times; the one extra question, the last hour of
cpu for the single-system tile, is that tile's own.

The hub is PocketBase. A token goes in the Authorization header as it is, with
no "Bearer" in front, and it is never put in an address. An expired token is
not refused: PocketBase treats it as a guest and answers 200 with an empty
list, so a list that was full and is now empty is the sign to sign in again.

Beszel keeps the last values on a system that went down. They are old, so a
system that is not up carries its status and nothing else, on every tile: no
meters, no filesystems, nothing a tile could draw as a current reading.
*/

const (
	beszelDefaultRows = 12
	beszelDefaultTTL  = 60
	// beszelMinTTL is Beszel's own beat: an agent reports once a minute and
	// asking much faster only redraws the same list.
	beszelMinTTL = 30
	// beszelHistoryPoints is the history the single-system tile draws.
	beszelHistoryPoints = 60

	beszelWarnPercent = 80
	beszelBadPercent  = 90
	beszelWarnTemp    = 70
	beszelBadTemp     = 85
)

// beszelNow is the clock for the history window; tests pin it.
var beszelNow = time.Now

// beszelStatuses are the four states a system has, in the order the counts
// are written.
var beszelStatuses = []string{"up", "down", "paused", "pending"}

func beszelWidgetFields() []widgetField {
	return []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		// Ids on one hub; empty means all of them.
		{Key: "systems", Kind: "list"},
		{Key: "system", Kind: "string"},
		{Key: "hidePaused", Kind: "bool"},
		{Key: "sort", Kind: "string", Allowed: []string{"name", "heaviest", "status"}},
		// What the tile draws; the server sends them all.
		{Key: "meters", Kind: "list", Allowed: []string{"cpu", "mem", "disk", "temp", "gpu", "net", "load"}},
		{Key: "click", Kind: "string", Allowed: []string{"open", "detail"}},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "ttl", Kind: "int", Min: beszelMinTTL, Max: 3600},
	}
}

/*
beszelFieldsFor is what one of the four types accepts: the same panel with
the choice that does not apply to it left out, so a stored widget never holds a
setting its tile ignores.
*/
func beszelFieldsFor(widgetType WidgetType) []widgetField {
	var fields []widgetField
	for _, field := range beszelWidgetFields() {
		switch {
		case field.Key == "system" && widgetType != WidgetTypeBeszelSystem:
			continue
		case field.Key == "systems" && widgetType == WidgetTypeBeszelSystem:
			continue
		case field.Key == "sort" && widgetType != WidgetTypeBeszel:
			continue
		}
		fields = append(fields, field)
	}
	return fields
}

type beszelSpec struct {
	Type         WidgetType
	Server       string
	CredentialID string
	Systems      []string
	System       string
	HidePaused   bool
	Sort         string
	Rows         int
	TTL          time.Duration
}

func beszelSpecFrom(widgetType WidgetType, config map[string]any) beszelSpec {
	spec := beszelSpec{
		Type:         widgetType,
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		Systems:      widgetConfigList(config["systems"], nil),
		System:       stringOr(config["system"]),
		HidePaused:   config["hidePaused"] == true,
		Sort:         stringOr(config["sort"]),
		Rows:         beszelDefaultRows,
		TTL:          beszelDefaultTTL * time.Second,
	}
	if spec.Sort == "" {
		spec.Sort = "name"
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, beszelMinTTL, 3600)) * time.Second
	}
	return spec
}

// fingerprint changes with every setting that changes what the tile is told,
// so a choice takes effect now and not when the cache runs out.
func (spec beszelSpec) fingerprint() string {
	return strings.Join([]string{string(spec.Type), spec.Server, spec.CredentialID,
		strings.Join(spec.Systems, ","), spec.System, strconv.FormatBool(spec.HidePaused),
		spec.Sort, strconv.Itoa(spec.Rows)}, "|")
}

// beszelBeat is how long an answer lives: a second under the tile's beat, so a
// tile that asks a moment early still gets a new one rather than skipping a beat.
func (spec beszelSpec) beat() time.Duration { return spec.TTL - time.Second }

// ---- the hub's answer ----

type beszelInfo struct {
	CPU *float64 `json:"cpu"`
	// MP is memory, DP the root filesystem, DT the hottest sensor, G the gpu.
	MP *float64 `json:"mp"`
	DP *float64 `json:"dp"`
	DT *float64 `json:"dt"`
	G  *float64 `json:"g"`
	// BB is bytes a second; old agents send B, megabytes a second.
	BB  *float64       `json:"bb"`
	B   *float64       `json:"b"`
	U   *float64       `json:"u"`
	V   string         `json:"v"`
	LA  []float64      `json:"la"`
	Efs map[string]any `json:"efs"`
}

type beszelSystem struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Status  string     `json:"status"`
	Updated string     `json:"updated"`
	Info    beszelInfo `json:"info"`
}

// status is one of the four the tiles know; anything the hub adds later reads
// as pending rather than as a state nothing draws.
func (s beszelSystem) status() string {
	for _, known := range beszelStatuses {
		if s.Status == known {
			return known
		}
	}
	return "pending"
}

func (s beszelSystem) updatedMillis() int64 {
	for _, layout := range []string{"2006-01-02 15:04:05.999Z07:00", time.RFC3339Nano} {
		if at, err := time.Parse(layout, s.Updated); err == nil {
			return at.UnixMilli()
		}
	}
	return 0
}

func (s beszelSystem) openURL(server string) string {
	return server + "/system/" + url.PathEscape(s.Name)
}

func beszelRound(value float64, places int) float64 {
	scale := math.Pow(10, float64(places))
	return math.Round(value*scale) / scale
}

func beszelPercent(value *float64) *float64 {
	if value == nil {
		return nil
	}
	rounded := beszelRound(*value, 1)
	return &rounded
}

// meters is what the tiles draw for this system. Not up: the status alone.
func (s beszelSystem) meters() *MediaMeters {
	m := &MediaMeters{Status: s.status()}
	if m.Status != "up" {
		return m
	}
	info := s.Info
	m.CPU, m.Mem, m.Disk, m.Temp, m.GPU = beszelPercent(info.CPU), beszelPercent(info.MP), beszelPercent(info.DP),
		beszelPercent(info.DT), beszelPercent(info.G)
	for _, v := range info.LA {
		if len(m.Load) < 3 {
			m.Load = append(m.Load, beszelRound(v, 2))
		}
	}
	switch {
	case info.BB != nil:
		net := int64(math.Round(*info.BB))
		m.Net = &net
	case info.B != nil:
		net := int64(math.Round(*info.B * (1 << 20)))
		m.Net = &net
	}
	if info.U != nil {
		m.Uptime = int64(*info.U)
	}
	m.Agent = info.V
	m.Fs = s.filesystems()
	return m
}

// filesystems are the root first, then every extra one the agent watches, by name.
func (s beszelSystem) filesystems() []MediaFs {
	var out []MediaFs
	if s.Info.DP != nil {
		out = append(out, MediaFs{Name: "/", Pct: beszelRound(*s.Info.DP, 1)})
	}
	names := make([]string, 0, len(s.Info.Efs))
	for name := range s.Info.Efs {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if pct, ok := s.Info.Efs[name].(float64); ok {
			out = append(out, MediaFs{Name: name, Pct: beszelRound(pct, 1)})
		}
	}
	return out
}

// beszelTone says how far over its line a reading is: 0 fine, 1 warn, 2 bad.
// The same lines the tile draws its bars by.
func beszelTone(value *float64, warn, bad float64) int {
	switch {
	case value == nil:
		return 0
	case *value >= bad:
		return 2
	case *value >= warn:
		return 1
	}
	return 0
}

// beszelProblem names what is over its line on an up system, and how far.
func beszelProblem(m *MediaMeters) (tone int, reason string) {
	var parts []string
	check := func(label string, value *float64, warn, bad float64, unit string) {
		t := beszelTone(value, warn, bad)
		if t == 0 {
			return
		}
		if t > tone {
			tone = t
		}
		parts = append(parts, fmt.Sprintf("%s %d%s", label, int(math.Round(*value)), unit))
	}
	check("cpu", m.CPU, beszelWarnPercent, beszelBadPercent, "%")
	check("mem", m.Mem, beszelWarnPercent, beszelBadPercent, "%")
	check("disk", m.Disk, beszelWarnPercent, beszelBadPercent, "%")
	check("gpu", m.GPU, beszelWarnPercent, beszelBadPercent, "%")
	// A temperature carries no label: 71° beside a percentage reads as heat.
	if t := beszelTone(m.Temp, beszelWarnTemp, beszelBadTemp); t > 0 {
		if t > tone {
			tone = t
		}
		parts = append(parts, fmt.Sprintf("%d°", int(math.Round(*m.Temp))))
	}
	return tone, strings.Join(parts, " · ")
}

// beszelHeaviest is the fullest of cpu, memory and disk, or -1 when there is
// nothing current to weigh.
func beszelHeaviest(m *MediaMeters) float64 {
	heaviest := -1.0
	for _, v := range []*float64{m.CPU, m.Mem, m.Disk} {
		if v != nil && *v > heaviest {
			heaviest = *v
		}
	}
	return heaviest
}

// ---- asking the hub ----

func (h *Handlers) beszelGet(ctx context.Context, server string, credential HealthCredential, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, path, query, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, jellyfinMaxBody)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

// beszelListSystems asks once, with whatever session is cached.
func (h *Handlers) beszelListSystems(ctx context.Context, server string, credential HealthCredential) ([]beszelSystem, error) {
	var page struct {
		Items []beszelSystem `json:"items"`
	}
	err := h.beszelGet(ctx, server, credential, "/api/collections/systems/records",
		url.Values{"perPage": {"200"}, "sort": {"name"}}, &page)
	return page.Items, err
}

// beszelSignInAgain throws the cached session away and signs in once more. A
// credential that is not a sign-in (a stored header) has nothing to renew.
func (h *Handlers) beszelSignInAgain(ctx context.Context, server string, credential HealthCredential) error {
	if credential.Session == nil {
		return nil
	}
	base, err := url.Parse(server)
	if err != nil {
		return errMediaNotAllowed
	}
	key := credentialSessionKey(base.Host, credential.Session)
	stale, _ := cachedCredentialSession(key)
	if _, err := h.freshCredentialSession(ctx, base, credential.Session, key, stale); err != nil {
		return mediaSignInError(err)
	}
	return nil
}

// beszelSeen remembers which hubs have answered with systems, so that an empty
// list can be told from a hub with none: the first is a lapsed token, the
// second a hub nobody has added a machine to yet.
var beszelSeen = struct {
	sync.Mutex
	hubs map[string]bool
}{hubs: map[string]bool{}}

/*
beszelHubKey names one hub and one sign-in to it, for the shared question and
for what has been seen.

Not the credential id: every widget files its sign-in under an id of its own
(widget:{id}), so four tiles set up against the same hub with the same user
hold four ids for one login. Keyed by id they would never share. A sign-in is
known by the same thing its cached session is -- host, login path, user and a
hash of the password -- and a stored header by the id, since there is nothing
else to tell two apart.
*/
func beszelHubKey(server, credentialID string, credential HealthCredential) string {
	if credential.Session != nil {
		if base, err := url.Parse(server); err == nil {
			return server + "|" + credentialSessionKey(base.Host, credential.Session)
		}
	}
	return server + "|" + credentialID
}

func beszelHasSeen(key string) bool {
	beszelSeen.Lock()
	defer beszelSeen.Unlock()
	return beszelSeen.hubs[key]
}

func beszelMarkSeen(key string) {
	beszelSeen.Lock()
	beszelSeen.hubs[key] = true
	beszelSeen.Unlock()
}

/*
beszelFetchSystems lists the hub's systems and deals with the one answer a
lapsed token gives: nothing, said politely.

Empty after a full list: sign in once more. Still empty: the key is refused,
because a hub that had systems a minute ago and has none for a fresh sign-in is
not a hub with none.
*/
func (h *Handlers) beszelFetchSystems(ctx context.Context, server string, credential HealthCredential, seenKey string) ([]beszelSystem, error) {
	systems, err := h.beszelListSystems(ctx, server, credential)
	if err != nil {
		return nil, err
	}
	if len(systems) == 0 && beszelHasSeen(seenKey) {
		if err := h.beszelSignInAgain(ctx, server, credential); err != nil {
			return nil, err
		}
		if systems, err = h.beszelListSystems(ctx, server, credential); err != nil {
			return nil, err
		}
		if len(systems) == 0 {
			return nil, fmt.Errorf("%w: the hub answers empty to a new sign-in", errMediaRefused)
		}
	}
	if len(systems) > 0 {
		beszelMarkSeen(seenKey)
	}
	return systems, nil
}

// The shared question. One entry per hub, sign-in and beat; the entry's own
// lock is held while it asks, so tiles that arrive together wait for the one
// answer rather than each making the trip.
type beszelSharedEntry struct {
	mu      sync.Mutex
	systems []beszelSystem
	ok      bool
	expires time.Time
}

var beszelShared = struct {
	sync.Mutex
	at map[string]*beszelSharedEntry
}{at: map[string]*beszelSharedEntry{}}

// beszelForgetAll empties what is shared and what is remembered; tests use it
// between cases.
func beszelForgetAll() {
	beszelShared.Lock()
	beszelShared.at = map[string]*beszelSharedEntry{}
	beszelShared.Unlock()
	beszelSeen.Lock()
	beszelSeen.hubs = map[string]bool{}
	beszelSeen.Unlock()
}

// beszelExpireAll makes every shared answer due again but keeps what is
// remembered, as a beat passing would.
func beszelExpireAll() {
	beszelShared.Lock()
	defer beszelShared.Unlock()
	for _, entry := range beszelShared.at {
		entry.mu.Lock()
		entry.expires = time.Time{}
		entry.mu.Unlock()
	}
}

// beszelSystems is the list every tile on the page is drawn from. A read the
// reader asked for (forced) goes to the hub.
func (h *Handlers) beszelSystems(ctx context.Context, spec beszelSpec, credential HealthCredential, forced bool) ([]beszelSystem, error) {
	hub := beszelHubKey(spec.Server, spec.CredentialID, credential)
	key := hub + "|" + strconv.Itoa(int(spec.TTL/time.Second))
	beszelShared.Lock()
	entry := beszelShared.at[key]
	if entry == nil {
		entry = &beszelSharedEntry{}
		beszelShared.at[key] = entry
	}
	beszelShared.Unlock()

	entry.mu.Lock()
	defer entry.mu.Unlock()
	if !forced && entry.ok && time.Now().Before(entry.expires) {
		return entry.systems, nil
	}
	systems, err := h.beszelFetchSystems(ctx, spec.Server, credential, hub)
	if err != nil {
		return nil, err
	}
	entry.systems, entry.ok, entry.expires = systems, true, time.Now().Add(spec.beat())
	return systems, nil
}

// beszelHistory is the last hour of cpu for one system, a point a minute,
// oldest first. No sort is asked for: the stats collection holds hundreds of
// thousands of records and refuses one, and the window filter is what keeps
// the answer to an hour.
func (h *Handlers) beszelHistory(ctx context.Context, server string, credential HealthCredential, system beszelSystem) ([]float64, error) {
	// The id comes from the hub, but it goes inside a filter string.
	if system.ID == "" || strings.ContainsAny(system.ID, `'"\ `) {
		return nil, errMediaUnreachable
	}
	since := beszelNow().UTC().Add(-time.Hour).Format("2006-01-02 15:04:05")
	var page struct {
		Items []struct {
			Created string `json:"created"`
			Stats   struct {
				CPU *float64 `json:"cpu"`
			} `json:"stats"`
		} `json:"items"`
	}
	err := h.beszelGet(ctx, server, credential, "/api/collections/system_stats/records", url.Values{
		"filter":  {fmt.Sprintf("system='%s' && type='1m' && created>='%s'", system.ID, since)},
		"perPage": {strconv.Itoa(beszelHistoryPoints)},
		"fields":  {"created,stats.cpu"},
	}, &page)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(page.Items, func(i, j int) bool { return page.Items[i].Created < page.Items[j].Created })
	var points []float64
	for _, record := range page.Items {
		if record.Stats.CPU != nil {
			points = append(points, *record.Stats.CPU)
		}
	}
	return points, nil
}

// ---- the four tiles ----

// beszelCounts is how many of the chosen systems are in each state.
func beszelCounts(systems []beszelSystem) map[string]int {
	counts := map[string]int{}
	for _, status := range beszelStatuses {
		counts[status] = 0
	}
	for _, s := range systems {
		counts[s.status()]++
	}
	return counts
}

// beszelChosen is the systems the tile reads: the ones it names, or all of them.
func beszelChosen(spec beszelSpec, all []beszelSystem) []beszelSystem {
	if len(spec.Systems) == 0 {
		return all
	}
	wanted := map[string]bool{}
	for _, id := range spec.Systems {
		wanted[id] = true
	}
	var out []beszelSystem
	for _, s := range all {
		if wanted[s.ID] {
			out = append(out, s)
		}
	}
	return out
}

func beszelLibraries(all []beszelSystem) []MediaGroup {
	groups := make([]MediaGroup, 0, len(all))
	for _, s := range all {
		groups = append(groups, MediaGroup{ID: s.ID, Name: s.Name})
	}
	sort.SliceStable(groups, func(i, j int) bool {
		return strings.ToLower(groups[i].Name) < strings.ToLower(groups[j].Name)
	})
	return groups
}

func (spec beszelSpec) item(s beszelSystem) MediaItem {
	return MediaItem{
		ID: s.ID, Title: s.Name, Kind: "system", OpenURL: s.openURL(spec.Server),
		When: s.updatedMillis(), Meters: s.meters(),
	}
}

func beszelByName(systems []beszelSystem) []beszelSystem {
	sorted := append([]beszelSystem(nil), systems...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return strings.ToLower(sorted[i].Name) < strings.ToLower(sorted[j].Name)
	})
	return sorted
}

func beszelStatusRank(status string) int {
	switch status {
	case "down":
		return 0
	case "pending":
		return 1
	case "up":
		return 2
	}
	return 3
}

func (h *Handlers) fetchBeszel(ctx context.Context, spec beszelSpec, forced bool) (MediaResult, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, errMediaNotSetUp
	}
	if spec.Type == WidgetTypeBeszelSystem && spec.System == "" {
		return result, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, errMediaNotSetUp
	}
	all, err := h.beszelSystems(ctx, spec, credential, forced)
	if err != nil {
		return result, err
	}
	result.Libraries = beszelLibraries(all)

	switch spec.Type {
	case WidgetTypeBeszelSystem:
		return h.beszelSystemTile(ctx, spec, credential, all, result)
	case WidgetTypeBeszelAttention:
		chosen := beszelChosen(spec, all)
		result.Counts = beszelCounts(chosen)
		result.Items = h.beszelAttention(spec, chosen)
	case WidgetTypeBeszelStorage:
		chosen := beszelChosen(spec, all)
		result.Counts = beszelCounts(chosen)
		result.Items = beszelStorage(spec, chosen)
	default:
		chosen := beszelChosen(spec, all)
		result.Counts = beszelCounts(chosen)
		result.Items = beszelSystemsTile(spec, chosen)
	}
	return result, nil
}

// beszelSystemsTile: one line per system.
func beszelSystemsTile(spec beszelSpec, chosen []beszelSystem) []MediaItem {
	type line struct {
		item  MediaItem
		heavy float64
		rank  int
		name  string
	}
	var lines []line
	for _, s := range beszelByName(chosen) {
		if spec.HidePaused && s.status() == "paused" {
			continue
		}
		item := spec.item(s)
		lines = append(lines, line{item, beszelHeaviest(item.Meters), beszelStatusRank(s.status()), strings.ToLower(s.Name)})
	}
	switch spec.Sort {
	case "heaviest":
		// Current readings first, heaviest on top; a system with none to
		// weigh follows, in the order of its state.
		sort.SliceStable(lines, func(i, j int) bool {
			a, b := lines[i], lines[j]
			switch {
			case a.heavy >= 0 && b.heavy >= 0:
				return a.heavy > b.heavy
			case a.heavy >= 0 || b.heavy >= 0:
				return a.heavy >= 0
			}
			return a.rank < b.rank
		})
	case "status":
		sort.SliceStable(lines, func(i, j int) bool { return lines[i].rank < lines[j].rank })
	}
	items := make([]MediaItem, 0, len(lines))
	for _, l := range lines {
		items = append(items, l.item)
	}
	return capItems(items, spec.Rows)
}

func capItems(items []MediaItem, rows int) []MediaItem {
	if len(items) > rows {
		return items[:rows]
	}
	return items
}

// beszelAttention: only what asks for a look, the worst first.
func (h *Handlers) beszelAttention(spec beszelSpec, chosen []beszelSystem) []MediaItem {
	type line struct {
		item  MediaItem
		order int
		name  string
	}
	var lines []line
	for _, s := range chosen {
		status := s.status()
		item := spec.item(s)
		order := 0
		switch status {
		case "down":
			item.Subtitle, order = "down", 0
		case "pending":
			item.Subtitle, order = "pending", 3
		case "paused":
			if spec.HidePaused {
				continue
			}
			item.Subtitle, order = "paused", 4
		default:
			tone, reason := beszelProblem(item.Meters)
			if tone == 0 {
				continue
			}
			item.Subtitle, order = reason, 3-tone
		}
		lines = append(lines, line{item, order, strings.ToLower(s.Name)})
	}
	sort.SliceStable(lines, func(i, j int) bool {
		if lines[i].order != lines[j].order {
			return lines[i].order < lines[j].order
		}
		return lines[i].name < lines[j].name
	})
	items := make([]MediaItem, 0, len(lines))
	for _, l := range lines {
		items = append(items, l.item)
	}
	return capItems(items, spec.Rows)
}

// beszelStorage: every filesystem of every system that is up, the fullest first.
func beszelStorage(spec beszelSpec, chosen []beszelSystem) []MediaItem {
	var items []MediaItem
	for _, s := range beszelByName(chosen) {
		if s.status() != "up" {
			continue
		}
		for _, fs := range s.filesystems() {
			pct := fs.Pct
			items = append(items, MediaItem{
				ID: s.ID + ":" + fs.Name, Title: s.Name, Subtitle: fs.Name, Kind: "fs",
				Library: s.Name, LibraryID: s.ID, OpenURL: s.openURL(spec.Server),
				Meters: &MediaMeters{Status: "up", Disk: &pct, Fs: []MediaFs{fs}},
			})
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return *items[i].Meters.Disk > *items[j].Meters.Disk })
	return capItems(items, spec.Rows)
}

// beszelSystemTile: the one system, with its last hour of cpu when it is up.
func (h *Handlers) beszelSystemTile(ctx context.Context, spec beszelSpec, credential HealthCredential, all []beszelSystem, result MediaResult) (MediaResult, error) {
	var found *beszelSystem
	for i := range all {
		if all[i].ID == spec.System {
			found = &all[i]
			break
		}
	}
	if found == nil {
		return result, errMediaSystemGone
	}
	result.Counts = beszelCounts([]beszelSystem{*found})
	item := spec.item(*found)
	if item.Meters.Status == "up" {
		if item.Meters.Agent != "" {
			item.Subtitle = "agent " + item.Meters.Agent
		}
		// The hour is the nice-to-have: without it the tile still has its meters.
		if points, err := h.beszelHistory(ctx, spec.Server, credential, *found); err != nil {
			logWarn(logComponentWidgets, "beszel widget history for %s: %v", hostOf(spec.Server), err)
			result.Partial = true
		} else {
			item.Meters.Spark = points
		}
	}
	result.Items = []MediaItem{item}
	return result, nil
}

// beszelAnswer is one Beszel tile's answer, through the shared media cache.
func (h *Handlers) beszelAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	spec := beszelSpecFrom(widget.Type, widget.Config)
	ms := mediaSpec{Service: string(widget.Type), Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.beat()}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		result, err := h.fetchBeszel(ctx, spec, forced)
		return result, nil, err
	}, forced)
}
