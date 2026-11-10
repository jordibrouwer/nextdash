package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"
)

const netDNSDefaultTimeout = 5 * time.Second

// runDNS asks the system resolver for one record type of the target's host
// (through the guard) and compares the answer with the expected value. A
// change of the record set is not a failure: drift is information, applied
// afterwards by the monitor round (dnsDriftApply).
func (h *Handlers) runDNS(ctx context.Context, g netGuard, t netTarget, c NetCheck) NetResult {
	res := netCheckResult(c, t)
	record := strings.ToUpper(strings.TrimSpace(c.Record))
	if record == "" {
		record = "A"
	}
	timeout := netCheckTimeout(c, netDNSDefaultTimeout)
	lookupCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	start := time.Now()
	out, err := g.lookup(lookupCtx, t.Host, record, strings.TrimSpace(c.Resolver))
	res.Ms = ceilMs(time.Since(start))
	out.QueryMs = res.Ms
	res.DNS = &out
	if err != nil {
		res = g.netFail(ctx, res, err, timeout)
		var dnsErr *net.DNSError
		switch {
		case errors.Is(err, errNetDNSNeedsName):
			res.Class, res.Error = "other", err.Error()
		case errors.As(err, &dnsErr) && dnsErr.IsNotFound:
			res.Error = fmt.Sprintf("No %s records found for %s.", record, t.Host)
		case res.Class == "dns":
			res.Error = "The DNS lookup failed: " + truncateNetDetail(err.Error())
		}
		return res
	}
	if len(out.Records) == 0 {
		res.Class, res.Error = "dns", fmt.Sprintf("No %s records found for %s.", record, t.Host)
		return res
	}
	res.Detail = dnsDetail(record, out.Records)
	if want := strings.TrimSpace(c.Expect); want != "" && !dnsExpectMatches(record, want, out.Records) {
		res.Class, res.Error = "content", "None of the records is the expected value."
		return res
	}
	res.OK = true
	if c.MaxMs > 0 && res.Ms > c.MaxMs {
		res.Slow = true
		res.Detail = "slow"
	}
	return res
}

// dnsDetail is the one line a sample keeps: "MX 10 mail.example.org. +1 more".
func dnsDetail(record string, recs []DNSRecord) string {
	if len(recs) == 0 {
		return record
	}
	d := record + " " + dnsDisplay(record, recs[0])
	if len(recs) > 1 {
		d += fmt.Sprintf(" +%d more", len(recs)-1)
	}
	return d
}

func dnsDisplay(record string, r DNSRecord) string {
	if record == "MX" {
		return fmt.Sprintf("%d %s", r.Prio, r.Value)
	}
	return r.Value
}

// dnsNorm is how a value is compared: lower case, no trailing dot.
func dnsNorm(v string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(v)), ".")
}

// dnsExpectMatches: a TXT record matches when it contains the expected text;
// every other type when one record equals it (an MX by its host name too).
func dnsExpectMatches(record, want string, recs []DNSRecord) bool {
	w := dnsNorm(want)
	for _, r := range recs {
		v := dnsNorm(r.Value)
		switch record {
		case "TXT":
			if strings.Contains(v, w) {
				return true
			}
		case "CAA":
			// "0 issue letsencrypt.org", or without the flags: "issue letsencrypt.org".
			_, noFlags, _ := strings.Cut(v, " ")
			if v == w || noFlags == w {
				return true
			}
		case "MX":
			if v == w || dnsNorm(dnsDisplay(record, r)) == w {
				return true
			}
		default:
			if v == w {
				return true
			}
		}
	}
	return false
}

// dnsValueSet is the record set as sorted, de-duplicated, normalised values:
// the order an answer came in (round robin) never matters, and neither does
// the TTL, which is not even read.
func dnsValueSet(record string, recs []DNSRecord) []string {
	seen := map[string]bool{}
	var vals []string
	for _, r := range recs {
		v := dnsNorm(dnsDisplay(record, r))
		if !seen[v] {
			seen[v] = true
			vals = append(vals, v)
		}
	}
	sort.Strings(vals)
	return vals
}

// dnsFingerprint is 16 hex of a sha-256 over the record type and the sorted
// values.
func dnsFingerprint(record string, vals []string) string {
	sum := sha256.Sum256([]byte(record + "\n" + strings.Join(vals, "\n")))
	return hex.EncodeToString(sum[:])[:16]
}

// dnsEncodeSet is what Baseline and DriftSet hold: the fingerprint, then the
// values, one per line (the values are needed to say what changed).
func dnsEncodeSet(record string, vals []string) string {
	return dnsFingerprint(record, vals) + "\n" + strings.Join(vals, "\n")
}

func dnsDecodeSet(enc string) (fp string, vals []string) {
	head, rest, _ := strings.Cut(enc, "\n")
	if rest != "" {
		vals = strings.Split(rest, "\n")
	}
	return head, vals
}

// dnsDiff says what changed between two value sets: "MX +mail2.example.org
// -mail.example.org", cut to the detail limit.
func dnsDiff(record string, old, cur []string) string {
	oldSet, curSet := map[string]bool{}, map[string]bool{}
	for _, v := range old {
		oldSet[v] = true
	}
	for _, v := range cur {
		curSet[v] = true
	}
	parts := []string{record}
	for _, v := range cur {
		if !oldSet[v] {
			parts = append(parts, "+"+v)
		}
	}
	for _, v := range old {
		if !curSet[v] {
			parts = append(parts, "−"+v)
		}
	}
	d := strings.Join(parts, " ")
	if r := []rune(d); len(r) > netDetailMax {
		d = string(r[:netDetailMax-1]) + "…"
	}
	return d
}

// dnsDriftResult is what applying a round's answer to a check's drift state
// decided.
type dnsDriftResult struct {
	check    NetCheck // the check with its drift fields updated
	changed  bool     // the set differs from the baseline now
	newDrift bool     // this answer is a drift not seen before
	touched  bool     // a stored field changed, so the check must be written
}

// dnsDriftApply compares a DNS answer with the check's baseline. The first
// answer becomes the baseline without a word. A different set is recorded as
// drift (DriftSet, DriftDiff, DriftAt) and stays until it is accepted or the
// records go back; the check itself stays up. Answers that say nothing about
// the records (a failed lookup, a guard refusal) leave everything alone.
func dnsDriftApply(c NetCheck, res NetResult) dnsDriftResult {
	out := dnsDriftResult{check: c}
	if !c.WatchDrift || res.DNS == nil || len(res.DNS.Records) == 0 || res.Class == "guard" || res.Class == "demo" {
		return out
	}
	record := strings.ToUpper(c.Record)
	vals := dnsValueSet(record, res.DNS.Records)
	enc := dnsEncodeSet(record, vals)
	if c.Baseline == "" {
		out.check.Baseline = enc
		out.touched = true
		return out
	}
	baseFP, baseVals := dnsDecodeSet(c.Baseline)
	if baseFP == dnsFingerprint(record, vals) {
		if c.DriftSet != "" || c.DriftDiff != "" || c.DriftAt != 0 {
			out.check.DriftSet, out.check.DriftDiff, out.check.DriftAt = "", "", 0
			out.touched = true
		}
		return out
	}
	out.changed = true
	if c.DriftSet == enc {
		return out
	}
	out.newDrift = true
	out.touched = true
	out.check.DriftSet = enc
	out.check.DriftDiff = dnsDiff(record, baseVals, vals)
	out.check.DriftAt = res.At
	return out
}

// applyDNSDrift runs dnsDriftApply on the DNS outcomes of a monitor round, puts
// the verdict on each result (Changed, Diff and, for a new drift, the sample
// detail) and writes the changed drift fields back, one page mutation per
// page. The mutation re-reads the stored check, so a form saved in the
// meantime is neither lost nor given an old baseline: the write is skipped for
// a check that no longer exists or changed its record or its watching.
func (h *Handlers) applyDNSDrift(outcomes []netOutcome) {
	byPage := map[int][]NetCheck{}
	for i := range outcomes {
		out := &outcomes[i]
		if out.due.check.Type != netTypeDNS || out.res.DNS == nil {
			continue
		}
		d := dnsDriftApply(out.due.check, out.res)
		out.res.DNS.Changed = d.changed
		if d.changed {
			out.res.DNS.Diff = d.check.DriftDiff
		}
		if d.newDrift {
			out.res.Detail = d.check.DriftDiff
		}
		if d.touched {
			byPage[out.due.pageID] = append(byPage[out.due.pageID], d.check)
		}
	}
	for pageID, updates := range byPage {
		err := h.store.MutateBookmarksOnPage(pageID, func(current []Bookmark) ([]Bookmark, error) {
			next := make([]Bookmark, len(current))
			copy(next, current)
			for _, u := range updates {
				for i := range next {
					checks := append([]NetCheck(nil), next[i].Checks...)
					for j := range checks {
						st := checks[j]
						if st.ID != u.ID || st.Type != netTypeDNS || st.Record != u.Record || !st.WatchDrift {
							continue
						}
						checks[j].Baseline, checks[j].DriftSet = u.Baseline, u.DriftSet
						checks[j].DriftDiff, checks[j].DriftAt = u.DriftDiff, u.DriftAt
						next[i].Checks = checks
					}
				}
			}
			return next, nil
		})
		if err != nil {
			logWarn(logComponentHealth, "DNS changes could not be saved (%v); they are seen again next round", err)
		}
	}
}

// acceptNetBaselines makes the pending record set the new baseline, for one
// check or for every check with a drift. It reads nothing from the network:
// the set to accept was stored with the drift. Returns how many were accepted.
func (h *Handlers) acceptNetBaselines(checkID string, all bool) (int, error) {
	accepted := 0
	for _, page := range h.store.GetPages() {
		err := h.store.MutateBookmarksOnPage(page.ID, func(current []Bookmark) ([]Bookmark, error) {
			next := make([]Bookmark, len(current))
			copy(next, current)
			for i := range next {
				var checks []NetCheck
				for j, c := range next[i].Checks {
					if c.DriftSet == "" || (!all && c.ID != checkID) {
						continue
					}
					if checks == nil {
						checks = append([]NetCheck(nil), next[i].Checks...)
					}
					checks[j].Baseline = c.DriftSet
					checks[j].DriftSet, checks[j].DriftDiff, checks[j].DriftAt = "", "", 0
					accepted++
				}
				if checks != nil {
					next[i].Checks = checks
				}
			}
			return next, nil
		})
		if err != nil {
			return accepted, err
		}
	}
	return accepted, nil
}

// AcceptNetBaseline accepts the changed DNS records of one check ({checkId})
// or of every check ({all:true}) as the new baseline.
func (h *Handlers) AcceptNetBaseline(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req struct {
		CheckID string `json:"checkId"`
		All     bool   `json:"all"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		netWriteError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}
	req.CheckID = strings.TrimSpace(req.CheckID)
	if req.CheckID == "" && !req.All {
		netWriteError(w, http.StatusBadRequest, "checkId or all is required")
		return
	}
	if req.CheckID != "" {
		if _, _, _, ok := findNetCheck(h.store, req.CheckID); !ok {
			netWriteError(w, http.StatusNotFound, "check not found")
			return
		}
	}
	n, err := h.acceptNetBaselines(req.CheckID, req.All)
	if !respondStorePersistError(w, err) {
		return
	}
	if n > 0 {
		logActivity(activityCategoryHealth, "net_baseline_accept", map[string]any{"count": n}, "")
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{"accepted": n})
}
