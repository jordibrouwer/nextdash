package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

/*
Incidents: the moments the machine was over its red line.

The sampler looks at the same readings that colour the page every beat and
keeps a log of when one went past its "red" threshold and when it came back:
the processor, memory, swap, a disk, a temperature, and the host not answering.
Two beats over the line open an incident and three beats under it close it, so
one noisy reading is not an event. The log is kept thirty days, like the graphs,
and is what the Insights section and the markers on the graphs read.
*/

const (
	glancesIncidentOpenAfter  = 2
	glancesIncidentCloseAfter = 3
	glancesIncidentKeep       = 500
	glancesIncidentMaxAge     = 30 * 24 * time.Hour
	// glancesIncidentLostAfter closes an incident whose reading has not been made for this long.
	glancesIncidentLostAfter = time.Minute
)

// GlancesIncident is one stretch over a red line. End is 0 while it goes on.
type GlancesIncident struct {
	Kind    string  `json:"kind"`
	Subject string  `json:"subject,omitempty"`
	Start   int64   `json:"start"`
	End     int64   `json:"end,omitempty"`
	Peak    float64 `json:"peak,omitempty"`
	// Seen is the last beat that saw it still going: where it ends if nextDash
	// stops or loses sight of the reading.
	Seen int64 `json:"seen,omitempty"`
}

type glancesWatch struct {
	bad, ok   int
	firstBad  int64
	lastBad   int64
	peak      float64
	open      bool
	lastSeen  int64
	kind, sub string
}

// glancesBeat is the pace the readings arrive at. At five minutes or more a
// beat stands for a long time, so one beat over the line opens an incident and
// one under it closes it; a quicker pace asks two and three, so one noisy
// reading is not an event.
var glancesBeat = struct {
	sync.Mutex
	every time.Duration
}{every: glancesDefaultBeat}

const glancesDefaultBeat = 5 * time.Second

func setGlancesBeat(d time.Duration) {
	glancesBeat.Lock()
	glancesBeat.every = d
	glancesBeat.Unlock()
}

func glancesBeatRules() (openAfter, closeAfter int, lostAfter time.Duration) {
	glancesBeat.Lock()
	every := glancesBeat.every
	glancesBeat.Unlock()
	openAfter, closeAfter = glancesIncidentOpenAfter, glancesIncidentCloseAfter
	if every >= 5*time.Minute {
		openAfter, closeAfter = 1, 1
	}
	// A reading is lost when three beats pass without it, or a minute, whichever is longer.
	lostAfter = max(glancesIncidentLostAfter, 3*every)
	return openAfter, closeAfter, lostAfter
}

var glancesIncidents = struct {
	sync.Mutex
	log   []GlancesIncident
	watch map[string]*glancesWatch
	index map[string]int
}{watch: map[string]*glancesWatch{}, index: map[string]int{}}

func glancesIncidentsPath() string { return filepath.Join(ResolveDataDir(), "glances-incidents.json") }

func glancesIncidentsReset() {
	glancesIncidents.Lock()
	glancesIncidents.log = nil
	glancesIncidents.watch = map[string]*glancesWatch{}
	glancesIncidents.index = map[string]int{}
	glancesIncidents.Unlock()
}

func loadGlancesIncidents() {
	glancesIncidentsReset()
	data, err := os.ReadFile(glancesIncidentsPath())
	if err != nil {
		return
	}
	var stored []GlancesIncident
	if json.Unmarshal(data, &stored) != nil {
		return
	}
	glancesIncidents.Lock()
	// An incident that was open when nextDash stopped is closed at its last
	// known moment: the gap in between is not known to have been bad.
	for i := range stored {
		if stored[i].End == 0 {
			stored[i].End = max(stored[i].Start, stored[i].Seen)
		}
	}
	glancesIncidents.log = stored
	glancesIncidents.Unlock()
}

func saveGlancesIncidentsLocked() {
	data, err := json.Marshal(glancesIncidents.log)
	if err != nil {
		return
	}
	if err := writeFileAtomic(glancesIncidentsPath(), data, 0644); err != nil {
		logWarn(logComponentWidgets, "Glances incidents could not be saved: %v", err)
	}
}

// glancesObservation is one reading and whether it is over its red line.
type glancesObservation struct {
	Kind, Subject string
	Value         float64
	Bad           bool
}

/*
glancesObserve takes one beat's readings. A reading that was not made this beat
is left as it was: a sensor that is not read does not clear an incident.
*/
func glancesObserve(now int64, observations []glancesObservation) {
	openAfter, closeAfter, lostAfter := glancesBeatRules()
	glancesIncidents.Lock()
	defer glancesIncidents.Unlock()
	changed := false
	for _, o := range observations {
		key := o.Kind + "\x00" + o.Subject
		w := glancesIncidents.watch[key]
		if w == nil {
			w = &glancesWatch{kind: o.Kind, sub: o.Subject}
			glancesIncidents.watch[key] = w
		}
		w.lastSeen = now
		if i, ok := glancesIncidents.index[key]; ok && w.open && i < len(glancesIncidents.log) {
			glancesIncidents.log[i].Seen = now
		}
		if o.Bad {
			w.ok = 0
			if w.bad == 0 {
				w.firstBad = now
				w.peak = o.Value
			}
			w.bad++
			w.lastBad = now
			if o.Value > w.peak {
				w.peak = o.Value
			}
			if !w.open && w.bad >= openAfter {
				w.open = true
				glancesIncidents.log = append(glancesIncidents.log, GlancesIncident{Kind: o.Kind, Subject: o.Subject, Start: w.firstBad, Peak: w.peak})
				glancesIncidents.index[key] = len(glancesIncidents.log) - 1
				changed = true
			}
			if w.open {
				if i, ok := glancesIncidents.index[key]; ok && i < len(glancesIncidents.log) {
					glancesIncidents.log[i].Peak = w.peak
				}
			}
			continue
		}
		w.bad = 0
		w.ok++
		if w.open && w.ok >= closeAfter {
			if i, ok := glancesIncidents.index[key]; ok && i < len(glancesIncidents.log) {
				glancesIncidents.log[i].End = w.lastBad
				if glancesIncidents.log[i].End <= glancesIncidents.log[i].Start {
					glancesIncidents.log[i].End = now
				}
			}
			delete(glancesIncidents.index, key)
			w.open = false
			changed = true
		}
	}
	// A reading that is no longer made (Glances off, a disk hidden or gone, a
	// sensor that left) does not keep an incident open: it ends where it was
	// last seen.
	lost := lostAfter.Milliseconds()
	for key, w := range glancesIncidents.watch {
		if now-w.lastSeen <= lost {
			continue
		}
		if w.open {
			if i, ok := glancesIncidents.index[key]; ok && i < len(glancesIncidents.log) {
				glancesIncidents.log[i].End = max(w.lastSeen, glancesIncidents.log[i].Start+1)
			}
			delete(glancesIncidents.index, key)
			changed = true
		}
		delete(glancesIncidents.watch, key)
	}
	if changed {
		cutoff := time.UnixMilli(now).Add(-glancesIncidentMaxAge).UnixMilli()
		kept := glancesIncidents.log[:0:0]
		remap := map[int]int{}
		for i, in := range glancesIncidents.log {
			if in.End != 0 && in.End < cutoff {
				continue
			}
			remap[i] = len(kept)
			kept = append(kept, in)
		}
		if len(kept) > glancesIncidentKeep {
			drop := len(kept) - glancesIncidentKeep
			for i := range remap {
				remap[i] = max(-1, remap[i]-drop)
			}
			kept = kept[drop:]
		}
		for key, i := range glancesIncidents.index {
			if n, ok := remap[i]; ok && n >= 0 {
				glancesIncidents.index[key] = n
			} else {
				delete(glancesIncidents.index, key)
			}
		}
		glancesIncidents.log = kept
		saveGlancesIncidentsLocked()
	}
}

// glancesIncidentList is the log, newest first, with what is going on now apart.
func glancesIncidentList() (ongoing, past []GlancesIncident) {
	glancesIncidents.Lock()
	defer glancesIncidents.Unlock()
	log := append([]GlancesIncident(nil), glancesIncidents.log...)
	sort.SliceStable(log, func(i, j int) bool { return log[i].Start > log[j].Start })
	for _, in := range log {
		if in.End == 0 {
			ongoing = append(ongoing, in)
		} else {
			past = append(past, in)
		}
	}
	return ongoing, past
}

// glancesIncidentsBetween are the incidents that overlap a window, for the
// bands drawn over a graph. An ongoing one has End 0.
func glancesIncidentsBetween(from, to int64) []GlancesIncident {
	glancesIncidents.Lock()
	defer glancesIncidents.Unlock()
	out := []GlancesIncident{}
	for _, in := range glancesIncidents.log {
		if in.Start <= to && (in.End == 0 || in.End >= from) {
			out = append(out, in)
		}
	}
	return out
}
