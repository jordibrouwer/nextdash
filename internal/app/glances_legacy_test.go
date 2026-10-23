package app

import (
	"context"
	"time"
)

// The tests were written when there was one host. They still talk to it: the
// main host, which keeps the file names the feature always had. These stand in
// for the free functions and variables that became the host's own.

func mainHost() *glancesHost { return glancesHostByID(glancesMainID) }

var (
	glancesRings     = &mainHost().rings
	glancesState     = &mainHost().state
	glancesSlow      = &mainHost().slow
	glancesBeat      = &mainHost().beat
	glancesIncidents = &mainHost().incidents
)

func glancesRecord(at int64, readings map[string]float64) { mainHost().record(at, readings) }
func glancesSetTracked(t map[string]bool)                 { mainHost().setTracked(t) }
func glancesWipe()                                        { mainHost().wipe() }
func glancesSeriesNames() []string                        { return mainHost().seriesNames() }
func glancesCollected() (int, int, int64)                 { return mainHost().collected() }
func glancesQuery(names []string, since int64, step time.Duration, now time.Time) map[string][]glancesPoint {
	return mainHost().query(names, since, step, now)
}
func glancesQueryWindow(names []string, since, until int64, step time.Duration, now time.Time) map[string][]glancesPoint {
	return mainHost().queryWindow(names, since, until, step, now)
}
func loadGlancesHistory()                                  { mainHost().loadHistory() }
func saveGlancesHistory()                                  { mainHost().saveHistory() }
func setGlancesState(at int64, ok bool, level, err string) { mainHost().setState(at, ok, level, err) }
func glancesHistoryPath() string                           { return mainHost().historyPath() }
func glancesIncidentsPath() string                         { return mainHost().incidentsPath() }
func glancesIncidentsReset()                               { mainHost().incidentsReset() }
func loadGlancesIncidents()                                { mainHost().loadIncidents() }
func saveGlancesIncidentsLocked()                          { mainHost().saveIncidentsLocked() }
func glancesObserve(now int64, o []glancesObservation) []GlancesIncidentEvent {
	return mainHost().observe(now, o)
}
func glancesIncidentList() ([]GlancesIncident, []GlancesIncident) { return mainHost().incidentList() }
func glancesIncidentsBetween(from, to int64) []GlancesIncident {
	return mainHost().incidentsBetween(from, to)
}
func glancesSnapshot() map[string]glancesSnap      { return mainHost().snapshot() }
func glancesApplyRetention(cfg GlancesConfig)      { mainHost().applyRetention(cfg) }
func glancesRetentionDays() int                    { return mainHost().retentionDays() }
func glancesRetention() time.Duration              { return mainHost().retentionSpan() }
func glancesLongCap() int                          { return mainHost().longCap() }
func glancesCollectedView() glancesCollectedAnswer { return mainHost().collectedView() }
func setGlancesBeat(d time.Duration)               { mainHost().setBeat(d) }
func glancesBeatRules() (int, int, time.Duration)  { return mainHost().beatRules() }

func (h *Handlers) glancesSampleOnce(ctx context.Context) { h.glancesSampleHost(ctx, mainHost()) }
