package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
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
	Enabled bool `json:"enabled"`
	// Paused is the connection switched off: the page and its record stay, but
	// nothing is read from the host until it is switched on again.
	Paused bool `json:"paused,omitempty"`
	// RecordEvery is the seconds between two recordings; 0 reads as the default.
	RecordEvery int `json:"recordEvery,omitempty"`
	// DockerLink says whether this Glances host is the machine whose Docker the
	// Containers view manages: auto, yes or no (glances_docker.go).
	DockerLink string `json:"dockerLink,omitempty"`
	Server     string `json:"server"`
	User       string `json:"user,omitempty"`
	// Refresh is the seconds between two reads while the page is open.
	Refresh int `json:"refresh"`
	// HiddenBlocks are Overview parts the reader switched off.
	HiddenBlocks []string          `json:"hiddenBlocks,omitempty"`
	Thresholds   GlancesThresholds `json:"thresholds"`
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

var glancesStore struct {
	sync.Mutex
}

func glancesConfigPath() string  { return filepath.Join(ResolveDataDir(), "glances.json") }
func glancesSecretsPath() string { return filepath.Join(ResolveDataDir(), "glances-secrets.json") }

// loadGlancesConfig reads the stored settings, or the defaults when there is
// no file yet (the feature is then off).
func loadGlancesConfig() GlancesConfig {
	glancesStore.Lock()
	defer glancesStore.Unlock()
	return readGlancesConfigLocked()
}

func readGlancesConfigLocked() GlancesConfig {
	cfg := defaultGlancesConfig()
	data, err := os.ReadFile(glancesConfigPath())
	if err != nil {
		return cfg
	}
	// Unmarshal over the defaults: a key the file leaves out keeps its default.
	_ = json.Unmarshal(data, &cfg)
	return normalizeGlancesConfig(cfg)
}

type glancesSecrets struct {
	Password string `json:"password,omitempty"`
}

func readGlancesPasswordLocked() string {
	var secrets glancesSecrets
	if data, err := os.ReadFile(glancesSecretsPath()); err == nil {
		_ = json.Unmarshal(data, &secrets)
	}
	return secrets.Password
}

// glancesCredential is what a request to this host carries: the login when
// there is one, nothing when the host is open.
func glancesCredential(cfg GlancesConfig) HealthCredential {
	if cfg.User == "" {
		return HealthCredential{}
	}
	glancesStore.Lock()
	defer glancesStore.Unlock()
	return HealthCredential{BasicUser: cfg.User, BasicPassword: readGlancesPasswordLocked()}
}

// saveGlancesConfig writes the settings. password is kept when nil, replaced
// when set (an empty string removes it). With no user the password is dropped:
// a password with nobody to send it as is only a secret lying around.
func saveGlancesConfig(cfg GlancesConfig, password *string) (GlancesConfig, error) {
	glancesStore.Lock()
	defer glancesStore.Unlock()
	cfg = normalizeGlancesConfig(cfg)

	secrets := glancesSecrets{Password: readGlancesPasswordLocked()}
	if password != nil {
		secrets.Password = *password
	}
	if cfg.User == "" {
		secrets.Password = ""
	}
	if secrets.Password == "" {
		if err := os.Remove(glancesSecretsPath()); err != nil && !os.IsNotExist(err) {
			return cfg, err
		}
	} else {
		data, err := json.Marshal(secrets)
		if err != nil {
			return cfg, err
		}
		if err := writeFileAtomic(glancesSecretsPath(), data, 0600); err != nil {
			return cfg, err
		}
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return cfg, err
	}
	return cfg, writeFileAtomic(glancesConfigPath(), data, 0644)
}

func glancesHasPassword() bool {
	glancesStore.Lock()
	defer glancesStore.Unlock()
	return readGlancesPasswordLocked() != ""
}

// ---- the settings routes ----

// glancesConfigAnswer is what Config shows: everything but the password, and
// whether one is filed.
type glancesConfigAnswer struct {
	GlancesConfig
	HasPassword bool     `json:"hasPassword"`
	Blocks      []string `json:"blocks"`
	// Collected is what nextDash has recorded so far, for Config to show.
	Collected glancesCollectedAnswer `json:"collected"`
}

func glancesConfigView(cfg GlancesConfig) glancesConfigAnswer {
	return glancesConfigAnswer{GlancesConfig: cfg, HasPassword: glancesHasPassword(), Blocks: glancesBlocks, Collected: glancesCollectedView()}
}

// glancesResetAll puts Glances back to how it is on a fresh install: the address,
// the login, the thresholds and every choice, and everything recorded. The page
// and its icon go until it is set up again.
func glancesResetAll() {
	for _, path := range []string{glancesConfigPath(), glancesSecretsPath()} {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			logWarn(logComponentWidgets, "Glances reset could not remove %s: %v", filepath.Base(path), err)
		}
	}
	glancesWipe()
	glancesSetTracked(map[string]bool{})
	glancesViewForgetAll()
	glancesInsightsCache.Lock()
	glancesInsightsCache.entries = map[string]glancesInsightsEntry{}
	glancesInsightsCache.Unlock()
	setGlancesState(0, false, "unknown", "")
	glancesWakeSampler()
}

// glancesConfigHandler reads and writes the settings. Behind the write token
// both ways: it holds the address of a machine on the reader's network.
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
	if r.Method == http.MethodGet {
		_ = json.NewEncoder(w).Encode(glancesConfigView(loadGlancesConfig()))
		return
	}
	if r.Method == http.MethodDelete {
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
	// Start from what is stored, so a field the request leaves out stays.
	body.GlancesConfig = loadGlancesConfig()
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if body.ClearLogin {
		body.User = ""
	}
	if len(body.TrackedHistory) > glancesMaxTracked {
		http.Error(w, "Too many processes and containers are recorded", http.StatusBadRequest)
		return
	}
	cfg := normalizeGlancesConfig(body.GlancesConfig)
	if body.Enabled && cfg.Server == "" {
		http.Error(w, "An address is needed to switch Glances on", http.StatusBadRequest)
		return
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
