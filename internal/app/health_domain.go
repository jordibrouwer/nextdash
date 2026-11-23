package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/publicsuffix"
)

/*
Domain expiry tracking, through RDAP.

A certificate that runs out is an inconvenience; a domain that runs out takes
the host, the certificate and the mail with it, and is harder to get back. The
registries publish the date through RDAP, a plain JSON service that replaced
WHOIS, so the date is one request away.

Kept per registrable domain, the way certificates are kept per host: ten
bookmarks on nas.example.com and www.example.com share one registration and one
renewal, and should warn once.

Two honest limits, both checked against the live services on 17 October 2026.
Some registries have no RDAP service at all (.de, .io, .be, .eu and others), and
some answer but leave the expiry date out (.nl). Those domains are remembered
with a state saying so, shown quietly, and never warned about.
*/

const (
	domainWarnDays    = 60
	domainUrgentDays  = 7
	domainCriticalDay = 3
	domainWarnDaysMin = 8
	domainWarnDaysMax = 180

	// A registration changes once a year, so asking more than daily would only
	// be noise for a registry.
	domainRecheck = 24 * time.Hour
	// A failed lookup is tried again sooner, but not on every pass.
	domainErrorRetry = 6 * time.Hour
	// The most lookups one pass may start, so a first run on a large collection
	// is spread over a few passes instead of arriving at a registry at once.
	domainMaxPerPass = 12

	rdapBootstrapURL     = "https://data.iana.org/rdap/dns.json"
	rdapBootstrapMaxAge  = 24 * time.Hour
	rdapTimeout          = 10 * time.Second
	rdapMaxResponseBytes = 1 << 20
)

const (
	domainStateOK          = "ok"
	domainStateHidden      = "hidden"
	domainStateUnsupported = "unsupported"
	domainStateError       = "error"
)

// domainThresholdsFor is the notify ladder for these settings, largest first:
// the first warning from settings, then a week and three days.
func domainThresholdsFor(s Settings) []int {
	warn := s.DomainWarnDays
	if warn <= 0 {
		warn = domainWarnDays
	}
	if warn < domainWarnDaysMin {
		warn = domainWarnDaysMin
	}
	if warn > domainWarnDaysMax {
		warn = domainWarnDaysMax
	}
	return []int{warn, domainUrgentDays, domainCriticalDay}
}

// registrableDomain reduces a host to the name that is actually registered.
//
// Left out on purpose: addresses, single labels, and anything whose suffix is
// not on the public ICANN list. That covers .local, .lan, .test and the like,
// and private suffixes such as github.io, where user.github.io is a page on
// someone else's registration rather than a domain of its own.
func registrableDomain(host string) (string, bool) {
	host = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
	if host == "" || !strings.Contains(host, ".") || net.ParseIP(host) != nil {
		return "", false
	}
	suffix, icann := publicsuffix.PublicSuffix(host)
	if !icann || suffix == "arpa" || strings.HasSuffix(suffix, ".arpa") {
		return "", false
	}
	domain, err := publicsuffix.EffectiveTLDPlusOne(host)
	if err != nil || domain == "" {
		return "", false
	}
	return domain, true
}

// domainOfURL is the registrable domain of a bookmark address, if it has one.
func domainOfURL(raw string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", false
	}
	return registrableDomain(parsed.Hostname())
}

// ---- RDAP -----------------------------------------------------------------

// rdapResult is what one lookup learned.
type rdapResult struct {
	State     string
	ExpiresAt int64
	Status    []string
}

type rdapClient struct {
	http *http.Client

	mu      sync.Mutex
	servers map[string]string // extension -> base URL, always ending in a slash
	loaded  time.Time
}

func newRDAPClient() *rdapClient {
	return &rdapClient{http: &http.Client{
		Timeout: rdapTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "https" {
				return errors.New("redirect to a non-https address")
			}
			return nil
		},
	}}
}

// parseRDAPBootstrap reads IANA's list, which maps extensions to RDAP servers:
// {"services": [[["com","net"], ["https://rdap.example/"]], ...]}.
func parseRDAPBootstrap(raw []byte) (map[string]string, error) {
	var doc struct {
		Services [][][]string `json:"services"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, service := range doc.Services {
		if len(service) < 2 {
			continue
		}
		base := ""
		for _, candidate := range service[1] {
			if strings.HasPrefix(candidate, "https://") {
				base = candidate
				break
			}
		}
		if base == "" {
			continue
		}
		if !strings.HasSuffix(base, "/") {
			base += "/"
		}
		for _, tld := range service[0] {
			out[strings.ToLower(tld)] = base
		}
	}
	if len(out) == 0 {
		return nil, errors.New("the bootstrap list names no servers")
	}
	return out, nil
}

// serverFor returns the RDAP base URL for an extension, or "" when it has none.
// The list is fetched once a day; a failed fetch keeps the one already held.
func (c *rdapClient) serverFor(ctx context.Context, tld string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.servers == nil || time.Since(c.loaded) > rdapBootstrapMaxAge {
		raw, err := c.get(ctx, rdapBootstrapURL, "application/json")
		if err == nil {
			var servers map[string]string
			if servers, err = parseRDAPBootstrap(raw); err == nil {
				c.servers, c.loaded = servers, time.Now()
			}
		}
		if err != nil && c.servers == nil {
			return "", err
		}
		// The old list is used for another hour: without this every lookup
		// would ask IANA again, each one waiting out the timeout under the lock.
		if err != nil {
			c.loaded = time.Now().Add(time.Hour - rdapBootstrapMaxAge)
		}
	}
	return c.servers[strings.ToLower(tld)], nil
}

func (c *rdapClient) get(ctx context.Context, target, accept string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("User-Agent", "nextDash")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, rdapMaxResponseBytes))
}

// parseRDAPDomain reads one domain answer. An answer without an expiration
// event is a registry that does not publish the date, which is a result and not
// a failure.
func parseRDAPDomain(raw []byte) (rdapResult, error) {
	var doc struct {
		Status []string `json:"status"`
		Events []struct {
			Action string `json:"eventAction"`
			Date   string `json:"eventDate"`
		} `json:"events"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return rdapResult{}, err
	}
	out := rdapResult{State: domainStateHidden, Status: doc.Status}
	for _, event := range doc.Events {
		if !strings.EqualFold(strings.TrimSpace(event.Action), "expiration") {
			continue
		}
		when, err := time.Parse(time.RFC3339, strings.TrimSpace(event.Date))
		if err != nil || when.IsZero() {
			continue
		}
		out.State = domainStateOK
		out.ExpiresAt = when.UnixMilli()
		break
	}
	return out, nil
}

// lookup asks the registry of the domain's extension. Only ever called with a
// name registrableDomain produced, so the path segment is a plain hostname.
func (c *rdapClient) lookup(ctx context.Context, domain string) (rdapResult, error) {
	dot := strings.LastIndex(domain, ".")
	if dot < 0 {
		return rdapResult{}, errors.New("not a domain")
	}
	base, err := c.serverFor(ctx, domain[dot+1:])
	if err != nil {
		return rdapResult{}, err
	}
	if base == "" {
		return rdapResult{State: domainStateUnsupported}, nil
	}
	raw, err := c.get(ctx, base+"domain/"+domain, "application/rdap+json, application/json")
	if err != nil {
		return rdapResult{}, err
	}
	return parseRDAPDomain(raw)
}

// ---- recording ------------------------------------------------------------

// parseManualDomainDate reads a hand-typed expiry, "YYYY-MM-DD", as the last
// millisecond of that day in UTC (Unix ms): a registrar's date names a day the
// domain is still good on, so it must not read as expired at that day's start.
// ok is false for anything else.
func parseManualDomainDate(value string) (int64, bool) {
	when, err := time.Parse("2006-01-02", strings.TrimSpace(value))
	if err != nil {
		return 0, false
	}
	return when.Add(24*time.Hour).UnixMilli() - 1, true
}

// sanitizeDomainExpiryManual keeps the hand-typed dates that name a registrable
// domain and hold a real date. Keys are folded to lower case.
func sanitizeDomainExpiryManual(in map[string]string) map[string]string {
	if len(in) == 0 {
		return in
	}
	out := make(map[string]string, len(in))
	for name, value := range in {
		domain, ok := registrableDomain(name)
		if !ok || domain != strings.ToLower(strings.TrimSpace(name)) {
			continue
		}
		if _, ok := parseManualDomainDate(value); !ok {
			continue
		}
		out[domain] = strings.TrimSpace(value)
	}
	return out
}

// manualDomainDates is the typed-in dates as Unix ms, by domain.
func manualDomainDates(s Settings) map[string]int64 {
	out := make(map[string]int64, len(s.DomainExpiryManual))
	for name, value := range s.DomainExpiryManual {
		if ms, ok := parseManualDomainDate(value); ok {
			out[strings.ToLower(name)] = ms
		}
	}
	return out
}

// crossedThreshold marks every threshold the entry has reached and returns a
// copy of it when one is new, so each warning goes out once.
func crossedThreshold(entry *HostDomain, now time.Time, thresholds []int) *HostDomain {
	days := certDaysLeft(entry.ExpiresAt, now)
	reached := 0
	for _, threshold := range thresholds {
		if days <= threshold && (reached == 0 || threshold < reached) {
			reached = threshold
		}
	}
	if reached == 0 || containsInt(entry.NotifiedDays, reached) {
		return nil
	}
	for _, threshold := range thresholds {
		if threshold >= reached && !containsInt(entry.NotifiedDays, threshold) {
			entry.NotifiedDays = append(entry.NotifiedDays, threshold)
		}
	}
	copied := *entry
	return &copied
}

// hasRegistryDate says the entry's date came from a registry.
func (e HostDomain) hasRegistryDate() bool {
	return e.ExpiresAt > 0 && !e.Manual && (e.State == domainStateOK || e.State == domainStateError)
}

// applyManualDate lays a hand-typed date over an entry the registry gave none
// for. A date from the registry always wins. Moving the typed date later or
// removing it starts the countdown over. Reports the entry when it newly crossed a warning threshold.
func applyManualDate(entry *HostDomain, manualMs int64, now time.Time, thresholds []int) *HostDomain {
	if entry.hasRegistryDate() {
		return nil
	}
	if manualMs <= 0 {
		if entry.Manual {
			entry.Manual = false
			entry.ExpiresAt = 0
			entry.NotifiedDays = nil
		}
		return nil
	}
	// A date moved later is a renewal and starts the countdown over; one moved
	// earlier (a typo fixed) keeps what was already warned, as a registry's does.
	if !entry.Manual || manualMs > entry.ExpiresAt {
		entry.NotifiedDays = nil
	}
	entry.Manual = true
	entry.ExpiresAt = manualMs
	return crossedThreshold(entry, now, thresholds)
}

// recordDomainResult folds one lookup into the stored map and reports the entry
// when it newly crossed a warning threshold. manualMs is the date typed in for
// this domain, or 0.
//
// A later expiry is a renewal and clears the notification history; an earlier
// one is taken as the registry's word but keeps it. A failed lookup keeps the
// date it already had, since one bad answer is no reason to forget a deadline.
func recordDomainResult(stored map[string]HostDomain, domain string, result rdapResult, lookupErr error, now time.Time, thresholds []int, manualMs int64) *HostDomain {
	if stored == nil {
		return nil
	}
	entry, existed := stored[domain]
	entry.Domain = domain
	entry.CheckedAt = now.UnixMilli()

	if lookupErr != nil {
		entry.State = domainStateError
		crossed := applyManualDate(&entry, manualMs, now, thresholds)
		stored[domain] = entry
		return crossed
	}
	entry.State = result.State
	entry.Status = result.Status
	if result.State != domainStateOK || result.ExpiresAt <= 0 {
		// A typed date and its history survive; applyManualDate keeps or drops
		// them. A date the registry used to give is gone.
		if !entry.Manual {
			entry.ExpiresAt = 0
			entry.NotifiedDays = nil
		}
		crossed := applyManualDate(&entry, manualMs, now, thresholds)
		stored[domain] = entry
		return crossed
	}
	if !existed || entry.Manual || result.ExpiresAt > entry.ExpiresAt {
		entry.NotifiedDays = nil
	}
	entry.Manual = false
	entry.ExpiresAt = result.ExpiresAt
	crossed := crossedThreshold(&entry, now, thresholds)
	stored[domain] = entry
	return crossed
}

// domainDue says whether a stored entry is old enough to look up again.
func domainDue(entry HostDomain, existed bool, now time.Time) bool {
	if !existed {
		return true
	}
	age := now.Sub(time.UnixMilli(entry.CheckedAt))
	if entry.State == domainStateError {
		return age >= domainErrorRetry
	}
	return age >= domainRecheck
}

// summarizeDomains counts what the lookups cover and lists the domains that
// have no date to show.
func summarizeDomains(stored map[string]HostDomain, enabled bool) DomainSummary {
	summary := DomainSummary{Enabled: enabled}
	if !enabled {
		return summary
	}
	for name, entry := range stored {
		switch entry.State {
		case domainStateOK:
			summary.Watched++
		case domainStateError:
			// A lookup that failed keeps the date it had; with one, it is still watched.
			if entry.ExpiresAt > 0 {
				summary.Watched++
			} else {
				summary.Failed = append(summary.Failed, name)
			}
		case domainStateHidden, domainStateUnsupported:
			summary.Watched++
			if entry.Manual && entry.ExpiresAt > 0 {
				continue
			}
			summary.NoDate = append(summary.NoDate, DomainNoDate{Domain: name, State: entry.State})
		}
	}
	sort.Strings(summary.Failed)
	sort.Slice(summary.NoDate, func(i, j int) bool { return summary.NoDate[i].Domain < summary.NoDate[j].Domain })
	return summary
}

// domainExpiryNotifications turns crossed entries into notices. A separate
// event from the certificate one, so a receiver can tell the two apart.
func domainExpiryNotifications(entries []HostDomain, now time.Time) []monitorNotification {
	out := make([]monitorNotification, 0, len(entries))
	for _, entry := range entries {
		days := certDaysLeft(entry.ExpiresAt, now)
		reason := fmt.Sprintf("Domain registration expires in %d days", days)
		if days < 0 {
			reason = "Domain registration has expired"
		} else if days == 0 {
			reason = "Domain registration expires today"
		}
		out = append(out, monitorNotification{
			Event:    "domain-expiring",
			Name:     entry.Domain,
			URL:      "https://" + entry.Domain,
			Status:   "warning",
			Error:    reason,
			At:       now.UnixMilli(),
			DaysLeft: days,
		})
	}
	return out
}

// ---- the pass -------------------------------------------------------------

var domainRDAP = newRDAPClient()

// domainsOfCheckedBookmarks is every registrable domain a checked or monitored
// bookmark points at. The same set certificates are kept alive by, so the two
// agree about which hosts are watched.
func (h *Handlers) domainsOfCheckedBookmarks() map[string]struct{} {
	out := map[string]struct{}{}
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			if !bm.CheckStatus && !bm.Monitor {
				continue
			}
			if domain, ok := domainOfURL(bm.URL); ok {
				out[domain] = struct{}{}
			}
			if domain, ok := registrableDomain(bm.CertHost); ok {
				out[domain] = struct{}{}
			}
		}
	}
	return out
}

func (h *Handlers) hostDomains() map[string]HostDomain {
	h.healthCacheMu.Lock()
	defer h.healthCacheMu.Unlock()
	cache := readHealthCacheFile()
	out := make(map[string]HostDomain, len(cache.Domains))
	for name, entry := range cache.Domains {
		out[name] = entry
	}
	return out
}

// refreshDomainExpiry runs one pass: forget domains nothing watches, look up the
// ones that are due, record the answers and send the warnings that crossed a
// threshold. Cheap when nothing is due, which is almost every pass.
func (h *Handlers) refreshDomainExpiry(ctx context.Context) {
	settings := h.store.GetSettings()
	if !settings.DomainExpiry {
		return
	}
	live := h.domainsOfCheckedBookmarks()
	now := time.Now()
	thresholds := domainThresholdsFor(settings)

	manual := manualDomainDates(settings)
	stored := h.hostDomains()
	var due []string
	for name := range live {
		entry, existed := stored[name]
		if domainDue(entry, existed, now) {
			due = append(due, name)
		}
	}
	sort.Strings(due)
	if len(due) > domainMaxPerPass {
		due = due[:domainMaxPerPass]
	}

	var (
		wg      sync.WaitGroup
		sem     = make(chan struct{}, 2)
		mu      sync.Mutex
		crossed []HostDomain
	)
	changed := false
	for _, name := range due {
		wg.Add(1)
		sem <- struct{}{}
		go func(name string) {
			defer wg.Done()
			defer func() { <-sem }()
			lookupCtx, cancel := context.WithTimeout(ctx, rdapTimeout+5*time.Second)
			result, err := domainRDAP.lookup(lookupCtx, name)
			cancel()
			if err != nil {
				logWarn(logComponentHealth, "the registration date of %s could not be looked up (%v); it will be tried again later", name, err)
			}
			mu.Lock()
			defer mu.Unlock()
			h.healthCacheMu.Lock()
			defer h.healthCacheMu.Unlock()
			cache := readHealthCacheFile()
			if cache.Domains == nil {
				cache.Domains = map[string]HostDomain{}
			}
			if hit := recordDomainResult(cache.Domains, name, result, err, time.Now(), thresholds, manual[name]); hit != nil {
				crossed = append(crossed, *hit)
			}
			if writeErr := writeHealthCacheFile(cache); writeErr != nil {
				logWarn(logComponentHealth, "the domain dates could not be saved (%v)", writeErr)
				return
			}
			changed = true
		}(name)
	}
	wg.Wait()

	// Typed dates take hold at once for domains not looked up in this pass.
	if hits, touched := h.reconcileManualDomains(live, manual, thresholds, due); touched {
		changed = true
		crossed = append(crossed, hits...)
	}
	if h.pruneDomains(live) {
		changed = true
	}
	if changed {
		h.invalidateHealthReportCache()
	}
	if len(crossed) > 0 {
		sort.Slice(crossed, func(i, j int) bool { return crossed[i].ExpiresAt < crossed[j].ExpiresAt })
		h.dispatchMonitorNotifications(context.WithoutCancel(ctx), domainExpiryNotifications(crossed, time.Now()))
	}
}

// reconcileManualDomains applies the typed-in dates to the stored entries that
// were not just looked up, so an edit or a removal is recorded within one pass
// and its warnings go out without waiting for the daily lookup.
func (h *Handlers) reconcileManualDomains(live map[string]struct{}, manual map[string]int64, thresholds []int, skip []string) ([]HostDomain, bool) {
	skipped := map[string]struct{}{}
	for _, name := range skip {
		skipped[name] = struct{}{}
	}
	h.healthCacheMu.Lock()
	defer h.healthCacheMu.Unlock()
	cache := readHealthCacheFile()
	if len(cache.Domains) == 0 {
		return nil, false
	}
	now := time.Now()
	var crossed []HostDomain
	touched := false
	for name, entry := range cache.Domains {
		if _, ok := live[name]; !ok {
			continue
		}
		if _, ok := skipped[name]; ok {
			continue
		}
		before := entry
		hit := applyManualDate(&entry, manual[name], now, thresholds)
		if entry.Manual != before.Manual || entry.ExpiresAt != before.ExpiresAt || len(entry.NotifiedDays) != len(before.NotifiedDays) {
			cache.Domains[name] = entry
			touched = true
		}
		if hit != nil {
			crossed = append(crossed, *hit)
		}
	}
	if !touched {
		return nil, false
	}
	if err := writeHealthCacheFile(cache); err != nil {
		logWarn(logComponentHealth, "the typed domain dates could not be saved (%v)", err)
		return nil, false
	}
	return crossed, true
}

// pruneDomains drops domains no checked bookmark points at any more.
func (h *Handlers) pruneDomains(live map[string]struct{}) bool {
	h.healthCacheMu.Lock()
	defer h.healthCacheMu.Unlock()
	cache := readHealthCacheFile()
	before := len(cache.Domains)
	for name := range cache.Domains {
		if _, ok := live[name]; !ok {
			delete(cache.Domains, name)
		}
	}
	if len(cache.Domains) == before {
		return false
	}
	if err := writeHealthCacheFile(cache); err != nil {
		logWarn(logComponentHealth, "the pruned domain list could not be saved (%v); it will be pruned again later", err)
		return false
	}
	return true
}

// StartDomainExpiryScheduler runs the domain pass until stop is closed. A few
// minutes between passes, not a day: a pass only looks up what is due, and a
// short interval means a newly added bookmark or a switch turned on shows its
// date soon instead of tomorrow.
func (h *Handlers) StartDomainExpiryScheduler(stop <-chan struct{}) {
	// The demo shows a seeded picture; lookups would replace it with whatever the
	// real registries say about the demo's invented names.
	if demoMode() {
		return
	}
	go func() {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		go func() { <-stop; cancel() }()

		select {
		case <-ctx.Done():
			return
		case <-time.After(20 * time.Second):
		}
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			h.refreshDomainExpiry(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// overlayManualDomains lays the typed-in dates over a copy of the stored
// entries, for the report, so a date just typed shows at once instead of at the
// next pass. Nothing is written; the pass records it and sends the warnings.
// Only domains a checked bookmark points at count, as for the lookups.
func overlayManualDomains(stored map[string]HostDomain, manual map[string]int64, live map[string]struct{}) map[string]HostDomain {
	out := make(map[string]HostDomain, len(stored)+len(manual))
	for name, entry := range stored {
		// A typed date removed from settings drops out at once too.
		if entry.Manual {
			if _, ok := manual[name]; !ok {
				applyManualDate(&entry, 0, time.Time{}, nil)
			}
		}
		out[name] = entry
	}
	for name, ms := range manual {
		if _, ok := live[name]; !ok {
			continue
		}
		entry, existed := out[name]
		if !existed {
			entry = HostDomain{Domain: name, State: domainStateHidden}
		}
		applyManualDate(&entry, ms, time.Time{}, nil)
		out[name] = entry
	}
	return out
}

// datedDomains is every domain with a date to count down to. Unlike the
// certificates the report carries all of them, not only the ones near a
// threshold: the widget's window is its own setting and can reach past the
// warning ladder, and a collection has tens of domains, not thousands.
//
// A domain whose last lookup failed keeps the date it already had
// (recordDomainResult), and is shown with it: one bad answer from a registry is
// no reason for a known deadline to drop out of the report.
func datedDomains(stored map[string]HostDomain) map[string]HostDomain {
	out := map[string]HostDomain{}
	for name, entry := range stored {
		if entry.ExpiresAt > 0 && (entry.State == domainStateOK || entry.State == domainStateError || entry.Manual) {
			out[name] = entry
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// bookmarkDomain is the registrable domain a bookmark's own address sits on, or
// "" when it has none (an IP address, a private name). Falls back to the host a
// check last saw over TLS only when the address itself gives nothing.
func bookmarkDomain(bm Bookmark) string {
	if domain, ok := domainOfURL(bm.URL); ok {
		return domain
	}
	if domain, ok := registrableDomain(bm.CertHost); ok {
		return domain
	}
	return ""
}
