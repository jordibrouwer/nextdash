package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

/*
The Glances feature: one host, and the page that shows it.

Not a widget. Config → Glances holds the address, the optional login and what
the page draws; once it is switched on and has an address, the Glances page exists.
Everything the browser may not hold stays here: the password lives apart in
glances-secrets.json at 0600, the way unraid-secrets.json keeps its key, and
is never sent back.

The file is read on every use through one mutex rather than cached for good,
so a save takes effect for the sampler and the page on their next beat without
anything to restart.
*/

// glancesBlocks are the parts of the Overview a reader can hide. A hidden part
// is not asked of Glances at all.
var glancesBlocks = []string{
	"system", "figures", "cores", "temps", "network", "diskio",
	"disks", "smart", "processes", "containers", "alerts",
}

// glancesRecordChoices are the seconds between two recordings of the host: what
// the history is made of, whether or not a page is open. A longer interval asks
// the host less and fills the record more slowly.
var glancesRecordChoices = []int{2, 5, 10, 30, 60, 300, 900, 1800, 3600}

const glancesDefaultRecord = 30

// glancesRetentionChoices are the days the history is kept: the long ring's
// length and how long the incident log lasts.
var glancesRetentionChoices = []int{7, 30, 90}

const glancesDefaultRetention = 30

func normalizeGlancesRetention(days int) int {
	for _, choice := range glancesRetentionChoices {
		if days == choice {
			return days
		}
	}
	return glancesDefaultRetention
}

// glancesRetentionDays is the retention in force; 30 until a setting says otherwise.
func (hs *glancesHost) retentionDays() int {
	if d := int(hs.retention.Load()); d != 0 {
		return d
	}
	return glancesDefaultRetention
}

func (hs *glancesHost) retentionSpan() time.Duration {
	return time.Duration(hs.retentionDays()) * 24 * time.Hour
}

// glancesLongCap is how many long points that is.
func (hs *glancesHost) longCap() int { return hs.retentionDays() * glancesLongPerDay }

func (hs *glancesHost) applyRetention(cfg GlancesConfig) {
	hs.retention.Store(int32(normalizeGlancesRetention(cfg.RetentionDays)))
}

// glancesRefreshChoices are the seconds between two reads the page may use.
var glancesRefreshChoices = []int{1, 2, 5, 10, 30, 60, 300, 900}

const (
	glancesDefaultRefresh = 2
	glancesDefaultStrip   = "/rootfs"
	glancesMaxHide        = 20
)

// GlancesThresholds say when a reading turns yellow (warn) and red (bad):
// percentages for cpu, memory, swap and disks, degrees for temperatures.
type GlancesThresholds struct {
	CPUWarn  float64 `json:"cpuWarn"`
	CPUBad   float64 `json:"cpuBad"`
	MemWarn  float64 `json:"memWarn"`
	MemBad   float64 `json:"memBad"`
	SwapWarn float64 `json:"swapWarn"`
	SwapBad  float64 `json:"swapBad"`
	DiskWarn float64 `json:"diskWarn"`
	DiskBad  float64 `json:"diskBad"`
	TempWarn float64 `json:"tempWarn"`
	TempBad  float64 `json:"tempBad"`
}

func defaultGlancesThresholds() GlancesThresholds {
	return GlancesThresholds{
		CPUWarn: 80, CPUBad: 90, MemWarn: 80, MemBad: 90, SwapWarn: 80, SwapBad: 90,
		DiskWarn: 80, DiskBad: 90, TempWarn: 70, TempBad: 85,
	}
}

// GlancesConfig is everything the feature stores except the password.
type GlancesConfig struct {
	// ID and Name are the host these settings are of (glances_host.go); the rest
	// is its own, except Enabled, Refresh, HiddenBlocks, Thresholds, DiskStrip and
	// DiskHide, which every host shares.
	ID      string `json:"id,omitempty"`
	Name    string `json:"name,omitempty"`
	Enabled bool   `json:"enabled"`
	// Paused is the connection switched off: the page and its record stay, but
	// nothing is read from the host until it is switched on again.
	Paused bool `json:"paused,omitempty"`
	// RecordEvery is the seconds between two recordings; 0 reads as the default.
	RecordEvery int `json:"recordEvery,omitempty"`
	// RetentionDays is how long the history and the incident log are kept: 7, 30 (the default) or 90.
	RetentionDays int `json:"retentionDays,omitempty"`
	// DockerLink says whether this Glances host is the machine whose Docker the
	// Containers view manages: auto, yes or no (glances_docker.go).
	DockerLink string `json:"dockerLink,omitempty"`
	Server     string `json:"server"`
	User       string `json:"user,omitempty"`
	// Refresh is the seconds between two reads while the page is open.
	Refresh int `json:"refresh"`
	// HiddenBlocks are Overview parts the reader switched off.
	HiddenBlocks []string `json:"hiddenBlocks,omitempty"`
	// Notify are the kinds of incident that send a notice when they open and close: down, cpu, mem, disk, temp. None by default.
	Notify     []string          `json:"notify,omitempty"`
	Thresholds GlancesThresholds `json:"thresholds"`
	// DiskStrip is a leading part removed from every mount point: Glances in a
	// container sees the host under /rootfs. DiskHide are parts of a mount
	// point that hide it, on top of the pseudo filesystems that always go.
	DiskStrip string   `json:"diskStrip"`
	DiskHide  []string `json:"diskHide,omitempty"`
	// TrackedHistory are the processes ("proc:name") and containers ("ct:name")
	// whose own history nextDash records. Off for all by default: reading them
	// every beat costs the host, so each is switched on by the reader.
	TrackedHistory []string `json:"trackedHistory,omitempty"`
}

// glancesMaxTracked is how many items may be recorded: a container makes four
// series and the processes and containers share glancesMaxConsumers of them.
const glancesMaxTracked = glancesMaxConsumers / 4

func (c GlancesConfig) tracked() map[string]bool {
	out := make(map[string]bool, len(c.TrackedHistory))
	for _, key := range c.TrackedHistory {
		out[key] = true
	}
	return out
}

// normalizeGlancesRecord keeps one of the offered intervals; anything else is the default.
func normalizeGlancesRecord(seconds int) int {
	for _, choice := range glancesRecordChoices {
		if seconds == choice {
			return seconds
		}
	}
	return glancesDefaultRecord
}

// recordInterval is how long the sampler waits between two recordings. A test
// shortens glancesSampleEvery to get a beat quickly; that wins over the setting.
func (c GlancesConfig) recordInterval() time.Duration {
	if glancesSampleEvery != 5*time.Second {
		return glancesSampleEvery
	}
	return time.Duration(normalizeGlancesRecord(c.RecordEvery)) * time.Second
}

func defaultGlancesConfig() GlancesConfig {
	return GlancesConfig{Refresh: glancesDefaultRefresh, Thresholds: defaultGlancesThresholds(), DiskStrip: glancesDefaultStrip}
}

// configured says the page can exist: switched on and told where to look.
func (c GlancesConfig) configured() bool { return c.Enabled && c.Server != "" }

// connected says the host is being read: set up, and the connection not switched off.
func (c GlancesConfig) connected() bool { return c.configured() && !c.Paused }

func (c GlancesConfig) blockHidden(id string) bool {
	for _, hidden := range c.HiddenBlocks {
		if hidden == id {
			return true
		}
	}
	return false
}

func normalizeGlancesConfig(c GlancesConfig) GlancesConfig {
	if !glancesHostIDRe.MatchString(c.ID) {
		c.ID = glancesMainID
	}
	c.Name = strings.TrimSpace(c.Name)
	if len(c.Name) > 40 {
		c.Name = c.Name[:40]
	}
	c.Server = strings.TrimRight(sanitizeWidgetURL(c.Server), "/")
	c.User = strings.TrimSpace(c.User)
	if len(c.User) > 128 {
		c.User = c.User[:128]
	}
	valid := false
	for _, choice := range glancesRefreshChoices {
		valid = valid || c.Refresh == choice
	}
	if !valid {
		c.Refresh = glancesDefaultRefresh
	}
	c.RecordEvery = normalizeGlancesRecord(c.RecordEvery)
	c.RetentionDays = normalizeGlancesRetention(c.RetentionDays)
	c.DockerLink = normalizeGlancesLink(c.DockerLink)

	known := map[string]bool{}
	for _, id := range glancesBlocks {
		known[id] = true
	}
	seen := map[string]bool{}
	hidden := []string{}
	for _, id := range c.HiddenBlocks {
		if known[id] && !seen[id] {
			seen[id] = true
			hidden = append(hidden, id)
		}
	}
	sort.Strings(hidden)
	c.HiddenBlocks = hidden

	c.Notify = normalizeGlancesNotify(c.Notify)
	c.Thresholds = normalizeGlancesThresholds(c.Thresholds)
	c.DiskStrip = strings.TrimSpace(c.DiskStrip)
	if len(c.DiskStrip) > 100 {
		c.DiskStrip = c.DiskStrip[:100]
	}
	var hide []string
	for _, part := range c.DiskHide {
		part = strings.TrimSpace(part)
		if part != "" && len(part) <= 100 && len(hide) < glancesMaxHide {
			hide = append(hide, part)
		}
	}
	c.DiskHide = hide
	var tracked []string
	seenTracked := map[string]bool{}
	for _, key := range c.TrackedHistory {
		key = strings.TrimSpace(key)
		if (strings.HasPrefix(key, "proc:") || strings.HasPrefix(key, "ct:")) && len(key) <= 200 && !seenTracked[key] && len(tracked) < glancesMaxTracked {
			seenTracked[key] = true
			tracked = append(tracked, key)
		}
	}
	c.TrackedHistory = tracked
	return c
}

// normalizeGlancesThresholds keeps a pair usable: an unset (zero) or inverted
// pair goes back to the defaults rather than painting everything red.
func normalizeGlancesThresholds(t GlancesThresholds) GlancesThresholds {
	d := defaultGlancesThresholds()
	pair := func(warn, bad *float64, dw, db, max float64) {
		if *warn <= 0 || *bad <= 0 || *warn > max || *bad > max || *warn >= *bad {
			*warn, *bad = dw, db
		}
	}
	pair(&t.CPUWarn, &t.CPUBad, d.CPUWarn, d.CPUBad, 100)
	pair(&t.MemWarn, &t.MemBad, d.MemWarn, d.MemBad, 100)
	pair(&t.SwapWarn, &t.SwapBad, d.SwapWarn, d.SwapBad, 100)
	pair(&t.DiskWarn, &t.DiskBad, d.DiskWarn, d.DiskBad, 100)
	pair(&t.TempWarn, &t.TempBad, d.TempWarn, d.TempBad, 150)
	return t
}

// ---- storage ----
//
// glances.json holds what is shared (whether the page is on, how often it
// reads, which blocks show, the colour lines, how disks are named) and a list
// of hosts with what is their own. A file from before there could be more than
// one host has those fields at the top: it reads as one host, "main", and is
// written in the new shape at the next save.

var glancesStore struct {
	sync.Mutex
}

func glancesConfigPath() string  { return filepath.Join(ResolveDataDir(), "glances.json") }
func glancesSecretsPath() string { return filepath.Join(ResolveDataDir(), "glances-secrets.json") }

// glancesHostRecord is what is stored for one host.
type glancesHostRecord struct {
	ID             string   `json:"id"`
	Name           string   `json:"name,omitempty"`
	Server         string   `json:"server"`
	User           string   `json:"user,omitempty"`
	Paused         bool     `json:"paused,omitempty"`
	RecordEvery    int      `json:"recordEvery,omitempty"`
	RetentionDays  int      `json:"retentionDays,omitempty"`
	DockerLink     string   `json:"dockerLink,omitempty"`
	Notify         []string `json:"notify,omitempty"`
	TrackedHistory []string `json:"trackedHistory,omitempty"`
}

// glancesFile is glances.json.
type glancesFile struct {
	Enabled      bool                `json:"enabled"`
	Refresh      int                 `json:"refresh"`
	HiddenBlocks []string            `json:"hiddenBlocks,omitempty"`
	Thresholds   GlancesThresholds   `json:"thresholds"`
	DiskStrip    string              `json:"diskStrip"`
	DiskHide     []string            `json:"diskHide,omitempty"`
	Hosts        []glancesHostRecord `json:"hosts,omitempty"`
}

// glancesLegacyFile is the single-host layout, read for the one host it holds.
type glancesLegacyFile struct {
	glancesHostRecord
}

func (r glancesHostRecord) displayName() string {
	if name := strings.TrimSpace(r.Name); name != "" {
		return name
	}
	// Never the address: the name is in the public status, the address is not.
	return "Glances"
}

// config merges the shared settings and one host's own into the view the rest
// of the code works with.
func (f glancesFile) config(r glancesHostRecord) GlancesConfig {
	return GlancesConfig{
		ID: r.ID, Name: r.Name, Enabled: f.Enabled, Paused: r.Paused, RecordEvery: r.RecordEvery, RetentionDays: r.RetentionDays,
		DockerLink: r.DockerLink, Server: r.Server, User: r.User, Refresh: f.Refresh, HiddenBlocks: f.HiddenBlocks,
		Notify: r.Notify, Thresholds: f.Thresholds, DiskStrip: f.DiskStrip, DiskHide: f.DiskHide, TrackedHistory: r.TrackedHistory,
	}
}

func (c GlancesConfig) record() glancesHostRecord {
	return glancesHostRecord{
		ID: c.ID, Name: c.Name, Server: c.Server, User: c.User, Paused: c.Paused, RecordEvery: c.RecordEvery,
		RetentionDays: c.RetentionDays, DockerLink: c.DockerLink, Notify: c.Notify, TrackedHistory: c.TrackedHistory,
	}
}

func (c GlancesConfig) shared(f glancesFile) glancesFile {
	f.Enabled, f.Refresh, f.HiddenBlocks, f.Thresholds, f.DiskStrip, f.DiskHide = c.Enabled, c.Refresh, c.HiddenBlocks, c.Thresholds, c.DiskStrip, c.DiskHide
	return f
}

// readGlancesFileLocked reads glances.json, or the defaults with one empty host.
func readGlancesFileLocked() glancesFile {
	d := defaultGlancesConfig()
	f := glancesFile{Enabled: false, Refresh: d.Refresh, Thresholds: d.Thresholds, DiskStrip: d.DiskStrip}
	data, err := os.ReadFile(glancesConfigPath())
	if err == nil {
		// Unmarshal over the defaults: a key the file leaves out keeps its default.
		_ = json.Unmarshal(data, &f)
		if len(f.Hosts) == 0 {
			var legacy glancesLegacyFile
			if json.Unmarshal(data, &legacy) == nil {
				legacy.ID = glancesMainID
				f.Hosts = []glancesHostRecord{legacy.glancesHostRecord}
			}
		}
	}
	// Through the same normalisation a save uses, host by host.
	var shared GlancesConfig
	if len(f.Hosts) > 0 {
		shared = f.config(f.Hosts[0])
	} else {
		shared = f.config(glancesHostRecord{ID: glancesMainID})
	}
	shared = normalizeGlancesConfig(shared)
	f = shared.shared(f)
	seen := map[string]bool{}
	var hosts []glancesHostRecord
	for _, r := range f.Hosts {
		if len(hosts) >= glancesMaxHosts || !glancesHostIDRe.MatchString(r.ID) || seen[r.ID] {
			continue
		}
		seen[r.ID] = true
		merged := normalizeGlancesConfig(f.config(r)).record()
		hosts = append(hosts, merged)
	}
	if len(hosts) == 0 {
		hosts = []glancesHostRecord{normalizeGlancesConfig(f.config(glancesHostRecord{ID: glancesMainID})).record()}
	}
	f.Hosts = hosts
	return f
}

// loadGlancesConfig is the first host's settings, with the shared ones.
func loadGlancesConfig() GlancesConfig {
	cfg, _ := loadGlancesConfigFor("")
	return cfg
}

// loadGlancesConfigFor reads one host's settings; "" is the first host. The
// second result says the host exists.
func loadGlancesConfigFor(id string) (GlancesConfig, bool) {
	glancesStore.Lock()
	defer glancesStore.Unlock()
	f := readGlancesFileLocked()
	if id == "" {
		return f.config(f.Hosts[0]), true
	}
	for _, r := range f.Hosts {
		if r.ID == id {
			return f.config(r), true
		}
	}
	return f.config(f.Hosts[0]), false
}

// glancesHostConfigs are every host's settings, in order.
func glancesHostConfigs() []GlancesConfig {
	glancesStore.Lock()
	defer glancesStore.Unlock()
	f := readGlancesFileLocked()
	out := make([]GlancesConfig, 0, len(f.Hosts))
	for _, r := range f.Hosts {
		out = append(out, f.config(r))
	}
	return out
}

type glancesSecrets struct {
	// Password is the main host's login, where it always was; the others' are in Hosts.
	Password string            `json:"password,omitempty"`
	Hosts    map[string]string `json:"hosts,omitempty"`
}

func readGlancesSecretsLocked() glancesSecrets {
	var secrets glancesSecrets
	if data, err := os.ReadFile(glancesSecretsPath()); err == nil {
		_ = json.Unmarshal(data, &secrets)
	}
	return secrets
}

func (s glancesSecrets) of(id string) string {
	if id == glancesMainID || id == "" {
		return s.Password
	}
	return s.Hosts[id]
}

func (s *glancesSecrets) set(id, password string) {
	if id == glancesMainID || id == "" {
		s.Password = password
		return
	}
	if password == "" {
		delete(s.Hosts, id)
		return
	}
	if s.Hosts == nil {
		s.Hosts = map[string]string{}
	}
	s.Hosts[id] = password
}

func writeGlancesSecretsLocked(s glancesSecrets) error {
	if s.Password == "" && len(s.Hosts) == 0 {
		if err := os.Remove(glancesSecretsPath()); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return writeFileAtomic(glancesSecretsPath(), data, 0600)
}

// glancesCredential is what a request to this host carries: the login when
// there is one, nothing when the host is open.
func glancesCredential(cfg GlancesConfig) HealthCredential {
	if cfg.User == "" {
		return HealthCredential{}
	}
	glancesStore.Lock()
	defer glancesStore.Unlock()
	return HealthCredential{BasicUser: cfg.User, BasicPassword: readGlancesSecretsLocked().of(cfg.ID)}
}

// saveGlancesConfig writes one host's settings (cfg.ID; "" is the first) and
// the shared ones. password is kept when nil, replaced when set (an empty
// string removes it). With no user the password is dropped: a password with
// nobody to send it as is only a secret lying around. A host that is not in
// the list yet is added, up to glancesMaxHosts.
func saveGlancesConfig(cfg GlancesConfig, password *string) (GlancesConfig, error) {
	glancesStore.Lock()
	defer glancesStore.Unlock()
	f := readGlancesFileLocked()
	if cfg.ID == "" {
		cfg.ID = f.Hosts[0].ID
	}
	cfg = normalizeGlancesConfig(cfg)

	secrets := readGlancesSecretsLocked()
	if password != nil {
		secrets.set(cfg.ID, *password)
	}
	if cfg.User == "" {
		secrets.set(cfg.ID, "")
	}
	if err := writeGlancesSecretsLocked(secrets); err != nil {
		return cfg, err
	}

	f = cfg.shared(f)
	found := false
	for i, r := range f.Hosts {
		if r.ID == cfg.ID {
			f.Hosts[i], found = cfg.record(), true
		}
	}
	if !found {
		if len(f.Hosts) >= glancesMaxHosts {
			return cfg, errGlancesTooManyHosts
		}
		f.Hosts = append(f.Hosts, cfg.record())
	}
	// Only one host is the Docker host: choosing Yes for this one releases the others.
	if cfg.DockerLink == glancesLinkYes {
		for i := range f.Hosts {
			if f.Hosts[i].ID != cfg.ID && normalizeGlancesLink(f.Hosts[i].DockerLink) == glancesLinkYes {
				f.Hosts[i].DockerLink = glancesLinkNo
			}
		}
	}
	return cfg, writeGlancesFileLocked(f, cfg)
}

var errGlancesTooManyHosts = errors.New("too many Glances hosts")

func writeGlancesFileLocked(f glancesFile, saved GlancesConfig) error {
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	glancesHostByID(saved.ID).applyRetention(saved)
	return writeFileAtomic(glancesConfigPath(), data, 0644)
}

// glancesAddHost adds an empty host with a name and returns its settings.
func glancesAddHost(name string) (GlancesConfig, error) {
	glancesStore.Lock()
	defer glancesStore.Unlock()
	f := readGlancesFileLocked()
	if len(f.Hosts) >= glancesMaxHosts {
		return GlancesConfig{}, errGlancesTooManyHosts
	}
	name = strings.TrimSpace(name)
	if len(name) > 40 {
		name = name[:40]
	}
	slug := strings.Trim(regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		slug = "host"
	}
	if len(slug) > 18 {
		slug = strings.Trim(slug[:18], "-")
	}
	id := slug
	for n := 2; ; n++ {
		taken := false
		for _, r := range f.Hosts {
			taken = taken || r.ID == id
		}
		if !taken && glancesHostIDRe.MatchString(id) {
			break
		}
		id = fmt.Sprintf("%s-%d", slug, n)
	}
	rec := glancesHostRecord{ID: id, Name: name}
	f.Hosts = append(f.Hosts, rec)
	cfg := normalizeGlancesConfig(f.config(rec))
	f.Hosts[len(f.Hosts)-1] = cfg.record()
	return cfg, writeGlancesFileLocked(f, cfg)
}

// glancesRemoveHost drops a host, its login and everything recorded for it.
// The last host cannot go: removing it is a reset.
func glancesRemoveHost(id string) error {
	glancesStore.Lock()
	f := readGlancesFileLocked()
	var kept []glancesHostRecord
	for _, r := range f.Hosts {
		if r.ID != id {
			kept = append(kept, r)
		}
	}
	if len(kept) == len(f.Hosts) || len(kept) == 0 {
		glancesStore.Unlock()
		return errGlancesNoSuchHost
	}
	f.Hosts = kept
	secrets := readGlancesSecretsLocked()
	secrets.set(id, "")
	_ = writeGlancesSecretsLocked(secrets)
	err := writeGlancesFileLocked(f, f.config(kept[0]))
	glancesStore.Unlock()
	if err != nil {
		return err
	}
	hs := glancesHostByID(id)
	hs.remove()
	glancesForgetHost(id)
	glancesViewForgetAll()
	glancesLinkForget()
	glancesWakeSampler()
	return nil
}

var errGlancesNoSuchHost = errors.New("no such Glances host, or the only one")

func glancesHasPassword(id string) bool {
	glancesStore.Lock()
	defer glancesStore.Unlock()
	return readGlancesSecretsLocked().of(id) != ""
}

// ---- the settings routes ----

// glancesHostSummary is a host as the page's menu needs it: no address, no login.
type glancesHostSummary struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Configured bool   `json:"configured"`
	Paused     bool   `json:"paused"`
	Level      string `json:"level"`
	OK         bool   `json:"ok"`
}

func glancesHostSummaries() []glancesHostSummary {
	cfgs := glancesHostConfigs()
	out := make([]glancesHostSummary, 0, len(cfgs))
	for _, c := range cfgs {
		hs := glancesHostByID(c.ID)
		hs.state.Lock()
		level, ok := hs.state.level, hs.state.ok
		hs.state.Unlock()
		if !c.connected() {
			level = "unknown"
		}
		out = append(out, glancesHostSummary{ID: c.ID, Name: glancesHostName(c), Configured: c.configured(), Paused: c.Paused, Level: level, OK: ok})
	}
	return out
}

func glancesHostName(c GlancesConfig) string {
	return c.record().displayName()
}

// glancesConfigAnswer is what Config shows: everything but the password, and
// whether one is filed.
type glancesConfigAnswer struct {
	GlancesConfig
	HasPassword bool     `json:"hasPassword"`
	Blocks      []string `json:"blocks"`
	// Collected is what nextDash has recorded so far, for Config to show.
	Collected glancesCollectedAnswer `json:"collected"`
	// Hosts is every host, to pick from.
	Hosts []glancesHostSummary `json:"hosts"`
}

func glancesConfigView(cfg GlancesConfig) glancesConfigAnswer {
	return glancesConfigAnswer{
		GlancesConfig: cfg, HasPassword: glancesHasPassword(cfg.ID), Blocks: glancesBlocks,
		Collected: glancesHostByID(cfg.ID).collectedView(), Hosts: glancesHostSummaries(),
	}
}

// glancesResetAll puts Glances back to how it is on a fresh install: every
// host, the logins, the thresholds and every choice, and everything recorded.
// The page and its icon go until it is set up again.
func glancesResetAll() {
	var ids []string
	for _, c := range glancesHostConfigs() {
		ids = append(ids, c.ID)
	}
	for _, path := range []string{glancesConfigPath(), glancesSecretsPath()} {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			logWarn(logComponentWidgets, "Glances reset could not remove %s: %v", filepath.Base(path), err)
		}
	}
	for _, id := range append(ids, glancesMainID) {
		hs := glancesHostByID(id)
		hs.wipe()
		hs.retention.Store(0)
		hs.setTracked(map[string]bool{})
		hs.setState(0, false, "unknown", "")
		if id != glancesMainID {
			glancesForgetHost(id)
		}
	}
	glancesViewForgetAll()
	glancesInsightsCache.Lock()
	glancesInsightsCache.entries = map[string]glancesInsightsEntry{}
	glancesInsightsCache.Unlock()
	glancesWakeSampler()
}

// glancesResolve is the host a request asks for (?host=<id>), or the first.
func glancesResolve(r *http.Request) (GlancesConfig, *glancesHost) {
	cfg, _ := loadGlancesConfigFor(strings.TrimSpace(r.URL.Query().Get("host")))
	return cfg, glancesHostByID(cfg.ID)
}

// glancesResolveStrict is glancesResolve for a request that writes or reads
// settings: a host that was named and is not there (removed in another tab) is
// a 404, never the first host's settings under another name.
func glancesResolveStrict(w http.ResponseWriter, r *http.Request) (GlancesConfig, *glancesHost, bool) {
	id := strings.TrimSpace(r.URL.Query().Get("host"))
	cfg, known := loadGlancesConfigFor(id)
	if id != "" && !known {
		http.Error(w, "No such host", http.StatusNotFound)
		return cfg, nil, false
	}
	return cfg, glancesHostByID(cfg.ID), true
}

// glancesConfigHandler reads and writes the settings. Behind the write token
// both ways: it holds the address of a machine on the reader's network.
//
// ?host=<id> picks the host; a PUT with ?host=new and a name adds one, and a
// DELETE with ?host=<id>&remove=1 removes one. A bare DELETE is a reset of all.
func (h *Handlers) glancesConfigHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	query := r.URL.Query()
	adding := query.Get("host") == "new"
	if r.Method == http.MethodGet {
		cfg, _, ok := glancesResolveStrict(w, r)
		if !ok {
			return
		}
		_ = json.NewEncoder(w).Encode(glancesConfigView(cfg))
		return
	}
	if r.Method == http.MethodDelete {
		if id := strings.TrimSpace(query.Get("host")); id != "" && query.Get("remove") == "1" {
			if err := glancesRemoveHost(id); err != nil {
				http.Error(w, "That host cannot be removed", http.StatusBadRequest)
				return
			}
			cfg, _ := loadGlancesConfigFor("")
			_ = json.NewEncoder(w).Encode(glancesConfigView(cfg))
			return
		}
		glancesResetAll()
		_ = json.NewEncoder(w).Encode(glancesConfigView(loadGlancesConfig()))
		return
	}

	var body struct {
		GlancesConfig
		// Password is kept when absent, replaced when a string; ClearLogin
		// removes the user and the password together.
		Password   *string `json:"password"`
		ClearLogin bool    `json:"clearLogin"`
	}
	if adding {
		body.GlancesConfig = defaultGlancesConfig()
		shared, _ := loadGlancesConfigFor("")
		body.GlancesConfig.Enabled, body.GlancesConfig.Refresh, body.GlancesConfig.HiddenBlocks = shared.Enabled, shared.Refresh, shared.HiddenBlocks
		body.GlancesConfig.Thresholds, body.GlancesConfig.DiskStrip, body.GlancesConfig.DiskHide = shared.Thresholds, shared.DiskStrip, shared.DiskHide
	} else {
		// Start from what is stored, so a field the request leaves out stays.
		stored, _, ok := glancesResolveStrict(w, r)
		if !ok {
			return
		}
		body.GlancesConfig = stored
	}
	id := body.GlancesConfig.ID
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	body.ID = id
	if body.ClearLogin {
		body.User = ""
	}
	if len(body.TrackedHistory) > glancesMaxTracked {
		http.Error(w, "Too many processes and containers are recorded", http.StatusBadRequest)
		return
	}
	cfg := normalizeGlancesConfig(body.GlancesConfig)
	if body.Enabled && cfg.Server == "" && len(glancesHostConfigs()) <= 1 && !adding {
		http.Error(w, "An address is needed to switch Glances on", http.StatusBadRequest)
		return
	}
	if adding {
		// Only after everything else was checked: a refused request adds nothing.
		created, err := glancesAddHost(body.Name)
		if err != nil {
			http.Error(w, "At most five hosts", http.StatusBadRequest)
			return
		}
		body.ID = created.ID
		cfg.ID = created.ID
		glancesWakeSampler()
	}
	saved, err := saveGlancesConfig(cfg, body.Password)
	if err != nil {
		logWarn(logComponentWidgets, "Glances settings could not be saved: %v", err)
		http.Error(w, "Could not save", http.StatusInternalServerError)
		return
	}
	glancesViewForgetAll()
	glancesLinkForget()
	glancesWakeSampler()
	_ = json.NewEncoder(w).Encode(glancesConfigView(saved))
}
