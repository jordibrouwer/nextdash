package app

import (
	"encoding/json"
	"os"
	"sort"
	"time"
)

/*
Incidents: the moments the machine was over its red line.

The sampler looks at the same readings that colour the page every beat and
keeps a log of when one went past its "red" threshold and when it came back:
the processor, memory, swap, a disk, a temperature, and the host not answering.
Two beats over the line open an incident and three beats under it close it, so
one noisy reading is not an event. The log is kept as long as the graphs (the retention setting),
and is what the Insights section and the markers on the graphs read.
*/

const (
	glancesIncidentOpenAfter  = 2
	glancesIncidentCloseAfter = 3
	glancesIncidentKeep       = 500
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

// hs.beat is the pace the readings arrive at. At five minutes or more a
// beat stands for a long time, so one beat over the line opens an incident and
// one under it closes it; a quicker pace asks two and three, so one noisy
// reading is not an event.

const glancesDefaultBeat = 5 * time.Second

func (hs *glancesHost) setBeat(d time.Duration) {
	hs.beat.Lock()
	hs.beat.every = d
	hs.beat.Unlock()
}

func (hs *glancesHost) beatRules() (openAfter, closeAfter int, lostAfter time.Duration) {
	hs.beat.Lock()
	every := hs.beat.every
	hs.beat.Unlock()
	openAfter, closeAfter = glancesIncidentOpenAfter, glancesIncidentCloseAfter
	if every >= 5*time.Minute {
		openAfter, closeAfter = 1, 1
	}
	// A reading is lost when three beats pass without it, or a minute, whichever is longer.
	lostAfter = max(glancesIncidentLostAfter, 3*every)
	return openAfter, closeAfter, lostAfter
}

func (hs *glancesHost) incidentsReset() {
	hs.incidents.Lock()
	hs.incidents.log = nil
	hs.incidents.watch = map[string]*glancesWatch{}
	hs.incidents.index = map[string]int{}
	hs.incidents.Unlock()
}

func (hs *glancesHost) loadIncidents() {
	hs.incidentsReset()
	data, err := os.ReadFile(hs.incidentsPath())
	if err != nil {
		return
	}
	var stored []GlancesIncident
	if json.Unmarshal(data, &stored) != nil {
		return
	}
	hs.incidents.Lock()
	// An incident that was open when nextDash stopped is closed at its last
	// known moment: the gap in between is not known to have been bad.
	for i := range stored {
		if stored[i].End == 0 {
			stored[i].End = max(stored[i].Start, stored[i].Seen)
		}
	}
	hs.incidents.log = stored
	hs.incidents.Unlock()
}

func (hs *glancesHost) saveIncidentsLocked() {
	if hs.removed.Load() {
		return
	}
	data, err := json.Marshal(hs.incidents.log)
	if err != nil {
		return
	}
	if err := writeFileAtomic(hs.incidentsPath(), data, 0644); err != nil {
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
// GlancesIncidentEvent is an incident that opened or closed in one beat, for notices.
type GlancesIncidentEvent struct {
	Incident GlancesIncident
	Opened   bool
	// Lost: it ended because the reading stopped arriving (the host went away or
	// was paused), not because it came back within its line.
	Lost bool
}

func (hs *glancesHost) observe(now int64, observations []glancesObservation) []GlancesIncidentEvent {
	var events []GlancesIncidentEvent
	openAfter, closeAfter, lostAfter := hs.beatRules()
	hs.incidents.Lock()
	defer hs.incidents.Unlock()
	changed := false
	for _, o := range observations {
		key := o.Kind + "\x00" + o.Subject
		w := hs.incidents.watch[key]
		if w == nil {
			w = &glancesWatch{kind: o.Kind, sub: o.Subject}
			hs.incidents.watch[key] = w
		}
		w.lastSeen = now
		if i, ok := hs.incidents.index[key]; ok && w.open && i < len(hs.incidents.log) {
			hs.incidents.log[i].Seen = now
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
				hs.incidents.log = append(hs.incidents.log, GlancesIncident{Kind: o.Kind, Subject: o.Subject, Start: w.firstBad, Peak: w.peak})
				hs.incidents.index[key] = len(hs.incidents.log) - 1
				events = append(events, GlancesIncidentEvent{Incident: hs.incidents.log[len(hs.incidents.log)-1], Opened: true})
				changed = true
			}
			if w.open {
				if i, ok := hs.incidents.index[key]; ok && i < len(hs.incidents.log) {
					hs.incidents.log[i].Peak = w.peak
				}
			}
			continue
		}
		w.bad = 0
		w.ok++
		if w.open && w.ok >= closeAfter {
			if i, ok := hs.incidents.index[key]; ok && i < len(hs.incidents.log) {
				hs.incidents.log[i].End = w.lastBad
				if hs.incidents.log[i].End <= hs.incidents.log[i].Start {
					hs.incidents.log[i].End = now
				}
				events = append(events, GlancesIncidentEvent{Incident: hs.incidents.log[i]})
			}
			delete(hs.incidents.index, key)
			w.open = false
			changed = true
		}
	}
	// A reading that is no longer made (Glances off, a disk hidden or gone, a
	// sensor that left) does not keep an incident open: it ends where it was
	// last seen.
	lost := lostAfter.Milliseconds()
	for key, w := range hs.incidents.watch {
		if now-w.lastSeen <= lost {
			continue
		}
		if w.open {
			if i, ok := hs.incidents.index[key]; ok && i < len(hs.incidents.log) {
				hs.incidents.log[i].End = max(w.lastSeen, hs.incidents.log[i].Start+1)
				events = append(events, GlancesIncidentEvent{Incident: hs.incidents.log[i], Lost: true})
			}
			delete(hs.incidents.index, key)
			changed = true
		}
		delete(hs.incidents.watch, key)
	}
	if changed {
		cutoff := time.UnixMilli(now).Add(-hs.retentionSpan()).UnixMilli()
		kept := hs.incidents.log[:0:0]
		remap := map[int]int{}
		for i, in := range hs.incidents.log {
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
		for key, i := range hs.incidents.index {
			if n, ok := remap[i]; ok && n >= 0 {
				hs.incidents.index[key] = n
			} else {
				delete(hs.incidents.index, key)
			}
		}
		hs.incidents.log = kept
		hs.saveIncidentsLocked()
	}
	return events
}

// glancesIncidentList is the log, newest first, with what is going on now apart.
func (hs *glancesHost) incidentList() (ongoing, past []GlancesIncident) {
	hs.incidents.Lock()
	defer hs.incidents.Unlock()
	log := append([]GlancesIncident(nil), hs.incidents.log...)
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
func (hs *glancesHost) incidentsBetween(from, to int64) []GlancesIncident {
	hs.incidents.Lock()
	defer hs.incidents.Unlock()
	out := []GlancesIncident{}
	for _, in := range hs.incidents.log {
		if in.Start <= to && (in.End == 0 || in.End >= from) {
			out = append(out, in)
		}
	}
	return out
}
