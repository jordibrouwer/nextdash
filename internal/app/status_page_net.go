package app

import "time"

/*
Network checks on the status page.

Opt-in per service: a check is on the page only when the owner listed its id
in StatusService.NetChecks, it still exists, it is switched on, network checks
are on, and (when the service names a bookmark) it belongs to that bookmark.
The page then carries the service's public name, a state and day bars, and
nothing else: no host, port, path, address, header, error text or check id.
*/

// statusNetRef is a check a service may show, with the bookmark it sits on.
type statusNetRef struct {
	bm  Bookmark
	chk NetCheck
	key string // canonical URL key of the bookmark
}

// statusNetIndex lists every check that may be shown at all: switched on, on a
// bookmark, while network checks are on. Nothing when they are off.
func (h *Handlers) statusNetIndex() map[string]statusNetRef {
	out := map[string]statusNetRef{}
	if !h.store.GetSettings().NetToolsEnabled {
		return out
	}
	for _, p := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(p.ID) {
			for _, c := range bm.Checks {
				if c.ID == "" || !c.Enabled || !netTypesBuilt[c.Type] {
					continue
				}
				if _, dup := out[c.ID]; dup {
					continue
				}
				out[c.ID] = statusNetRef{bm: bm, chk: c, key: canonicalBookmarkURLKey(bm.URL)}
			}
		}
	}
	return out
}

// statusServiceNetRefs resolves a service's opted-in checks against the index.
func statusServiceNetRefs(s StatusService, index map[string]statusNetRef) []statusNetRef {
	var out []statusNetRef
	anchor := ""
	if s.MonitorURL != "" {
		anchor = canonicalBookmarkURLKey(s.MonitorURL)
	}
	for _, id := range s.NetChecks {
		ref, ok := index[id]
		if !ok || (anchor != "" && ref.key != anchor) {
			continue
		}
		out = append(out, ref)
	}
	return out
}

func btoi(b bool) int {
	if b {
		return 1
	}
	return 0
}

// statusNetPart is what one check says about a service: the monitor rule
// (stale is unknown, a failed newest sample is down), and a certificate close
// to expiry reads as degraded.
func statusNetPart(ref statusNetRef, samples []HealthSample, now time.Time) statusPart {
	p := monitorPart(samples, int(netCheckInterval(ref.chk, ref.bm)/time.Minute), now)
	if p.State == statusOperational {
		if st := netCheckStateFor(ref.chk, samples); st != nil && st.Warn {
			p.State = statusDegraded
		}
	}
	return p
}
