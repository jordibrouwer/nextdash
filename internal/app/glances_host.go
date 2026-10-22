package app

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

/*
One Glances host's own state.

nextDash can watch up to glancesMaxHosts machines. Each has its own record (the
rings), incident log, verdict, pace and retention, and its own files in the data
directory; the address, login, pace, retention, notices, tracked items and the
Containers link are the host's own settings (glances_config.go). What is shared
is how the page looks and when a reading turns yellow or red.

The first host keeps the file names the feature had before there could be more
than one (glances-history.json), so an existing install is host "main" without
anything moving.
*/

const (
	glancesMaxHosts = 5
	glancesMainID   = "main"
)

var glancesHostIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,23}$`)

// glancesRingStore is a host's recorded series, and the items it records.
type glancesRingStore struct {
	sync.Mutex
	series map[string]*glancesRing
	// tracked are the processes and containers being recorded, as the sampler
	// last saw Config.
	tracked map[string]bool
}

// glancesStateStore is the latest reading's verdict: ok, warn or bad over the
// thresholds, or unknown while the machine does not answer.
type glancesStateStore struct {
	sync.Mutex
	at    int64
	ok    bool
	level string
	err   string
	// okAt is the last beat that was answered.
	okAt int64
}

// glancesSlowStore keeps the last answer of the slow plugins between minutes.
type glancesSlowStore struct {
	sync.Mutex
	key     string
	at      time.Time
	disks   []glancesDiskIO
	sensors []glancesSensor
	fs      []glancesFS
}

// glancesBeatStore is the pace the readings arrive at.
type glancesBeatStore struct {
	sync.Mutex
	every time.Duration
}

type glancesIncidentStore struct {
	sync.Mutex
	log   []GlancesIncident
	watch map[string]*glancesWatch
	index map[string]int
}

// glancesHost is everything kept for one host.
type glancesHost struct {
	id        string
	rings     glancesRingStore
	saveMu    sync.Mutex
	state     glancesStateStore
	slow      glancesSlowStore
	beat      glancesBeatStore
	incidents glancesIncidentStore
	retention atomic.Int32
	// removed is set when the host is taken out of Config: nothing of it is written again.
	removed atomic.Bool
	// notices remembers what was announced, so a reading hovering at its red line is not a stream of notices.
	notices glancesNoticeMemory
	// wake tells this host's sampler its pace or settings changed.
	wake chan struct{}
}

func newGlancesHost(id string) *glancesHost {
	return &glancesHost{
		id:        id,
		rings:     glancesRingStore{series: map[string]*glancesRing{}, tracked: map[string]bool{}},
		state:     glancesStateStore{level: "unknown"},
		beat:      glancesBeatStore{every: glancesDefaultBeat},
		incidents: glancesIncidentStore{watch: map[string]*glancesWatch{}, index: map[string]int{}},
		wake:      make(chan struct{}, 1),
	}
}

var glancesHosts = struct {
	sync.Mutex
	byID map[string]*glancesHost
}{byID: map[string]*glancesHost{}}

// glancesHostByID is the state of one host, made on first use. An id that
// cannot be one (it names a file) falls back to the main host.
func glancesHostByID(id string) *glancesHost {
	if !glancesHostIDRe.MatchString(id) {
		id = glancesMainID
	}
	glancesHosts.Lock()
	defer glancesHosts.Unlock()
	hs := glancesHosts.byID[id]
	if hs == nil {
		hs = newGlancesHost(id)
		glancesHosts.byID[id] = hs
	}
	return hs
}

// glancesHostIfKnown is a host's state if it has one: a lookup that makes none.
func glancesHostIfKnown(id string) *glancesHost {
	glancesHosts.Lock()
	defer glancesHosts.Unlock()
	return glancesHosts.byID[id]
}

func glancesForgetHost(id string) {
	glancesHosts.Lock()
	delete(glancesHosts.byID, id)
	glancesHosts.Unlock()
}

// glancesHostFile is a host's file: the main host's keeps its old name.
func glancesHostFile(base, id string) string {
	name := base + ".json"
	if id != glancesMainID {
		name = base + "-" + id + ".json"
	}
	return filepath.Join(ResolveDataDir(), name)
}

func (hs *glancesHost) historyPath() string   { return glancesHostFile("glances-history", hs.id) }
func (hs *glancesHost) incidentsPath() string { return glancesHostFile("glances-incidents", hs.id) }

// wakeSampler ends this host's wait for the next beat.
func (hs *glancesHost) wakeSampler() {
	select {
	case hs.wake <- struct{}{}:
	default:
	}
}

// glancesHostRow is one host in the hosts overview: the last readings nextDash
// recorded, so showing every host costs the hosts nothing.
type glancesHostRow struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Configured bool   `json:"configured"`
	Paused     bool   `json:"paused"`
	Level      string `json:"level"`
	OK         bool   `json:"ok"`
	At         int64  `json:"at"`
	// LastOK is the last time the host answered, for "not answering since".
	LastOK    int64    `json:"lastOk"`
	CPU       *float64 `json:"cpu"`
	Mem       *float64 `json:"mem"`
	Disk      *float64 `json:"disk"`
	DiskMount string   `json:"diskMount,omitempty"`
	Temp      *float64 `json:"temp"`
}

// lastValues are the newest points of the series a row needs.
func (hs *glancesHost) lastValues() (cpu, mem, disk *float64, diskMount string, temp *float64) {
	hs.beat.Lock()
	every := hs.beat.every
	hs.beat.Unlock()
	// A series that stopped (an unplugged disk, a sensor that left) is not a current reading.
	fresh := time.Now().Add(-max(3*every, 3*time.Minute)).UnixMilli()
	hs.rings.Lock()
	defer hs.rings.Unlock()
	last := func(name string) *float64 {
		ring := hs.rings.series[name]
		if ring == nil || len(ring.Fine) == 0 {
			return nil
		}
		point := ring.Fine[len(ring.Fine)-1]
		if int64(point[0]) < fresh {
			return nil
		}
		v := point[1]
		return &v
	}
	cpu, mem = last("cpu"), last("mem")
	for name := range hs.rings.series {
		switch {
		case strings.HasPrefix(name, "fs:"):
			if v := last(name); v != nil && (disk == nil || *v > *disk) {
				disk, diskMount = v, strings.TrimPrefix(name, "fs:")
			}
		case strings.HasPrefix(name, "temp:"):
			if v := last(name); v != nil && (temp == nil || *v > *temp) {
				temp = v
			}
		}
	}
	return cpu, mem, disk, diskMount, temp
}

func glancesHostRows() []glancesHostRow {
	var rows []glancesHostRow
	for _, c := range glancesHostConfigs() {
		hs := glancesHostIfKnown(c.ID)
		if hs == nil {
			rows = append(rows, glancesHostRow{ID: c.ID, Name: glancesHostName(c), Configured: c.configured(), Paused: c.Paused, Level: "unknown"})
			continue
		}
		hs.state.Lock()
		level, ok, at, lastOK := hs.state.level, hs.state.ok, hs.state.at, hs.state.okAt
		hs.state.Unlock()
		if !c.connected() {
			level, ok = "unknown", false
		}
		cpu, mem, disk, mount, temp := hs.lastValues()
		rows = append(rows, glancesHostRow{
			ID: c.ID, Name: glancesHostName(c), Configured: c.configured(), Paused: c.Paused, Level: level, OK: ok, At: at, LastOK: lastOK,
			CPU: cpu, Mem: mem, Disk: disk, DiskMount: mount, Temp: temp,
		})
	}
	return rows
}

// glancesHostsHandler answers the hosts overview.
func (h *Handlers) glancesHostsHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"hosts": glancesHostRows()})
}
