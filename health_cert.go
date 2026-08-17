package main

import (
	"log"
	"math"
	"sort"
	"strings"
	"time"
)

/*
Certificate expiry tracking.

A certificate that expires in six days is invisible to a reachability check: the
site is up until the moment it is not, and then everything on that host breaks at
once. The check already completes a TLS handshake, so the expiry is there for the
reading — this file is only about keeping it and deciding when it is worth
saying something.

Kept per host rather than per bookmark. A certificate belongs to a host, and ten
bookmarks on one domain share one: storing it per bookmark would warn ten times
about a single renewal.
*/

const (
	// Warn at a month, a fortnight, and three days. Three thresholds rather than
	// a countdown because the useful signals are "plan the renewal", "do it this
	// week", and "this breaks now" — a daily reminder for thirty days is noise
	// that teaches people to ignore the badge.
	certWarnDays     = 30
	certUrgentDays   = 7
	certCriticalDays = 3
	// A renewal reminder is worth little a year out and nothing an hour out, so
	// the setting is bounded either side of what it replaces.
	certWarnDaysMin = 3
	certWarnDaysMax = 120
)

// certNotifyThresholds are the day marks an alert fires on, largest first so the
// first threshold a certificate crosses is the one reported.
var certNotifyThresholds = []int{certWarnDays, certUrgentDays, certCriticalDays}

// certWarnDaysFor is the first threshold, from settings.
//
// One number rather than three: "warn me a fortnight out" is a thing people
// mean, "warn me at 14, 4 and 2" is not. The two tighter marks are derived from
// it in the same proportion the built-in marks have, so a shorter lead time
// still gets its "do it this week" and "this breaks now".
func certWarnDaysFor(s Settings) int {
	days := s.CertWarnDays
	if days <= 0 {
		return certWarnDays
	}
	if days < certWarnDaysMin {
		return certWarnDaysMin
	}
	if days > certWarnDaysMax {
		return certWarnDaysMax
	}
	return days
}

// certThresholdsFor is the notify ladder for these settings, largest first.
func certThresholdsFor(s Settings) []int {
	warn := certWarnDaysFor(s)
	if warn == certWarnDays {
		return certNotifyThresholds
	}
	urgent := warn * certUrgentDays / certWarnDays
	if urgent < 1 {
		urgent = 1
	}
	critical := warn * certCriticalDays / certWarnDays
	if critical < 1 {
		critical = 1
	}
	if urgent <= critical {
		urgent = critical + 1
	}
	if warn <= urgent {
		warn = urgent + 1
	}
	return []int{warn, urgent, critical}
}

// certSeverityWith is certSeverity against a chosen first threshold.
func certSeverityWith(expiresAt int64, now time.Time, thresholds []int) string {
	if expiresAt <= 0 {
		return ""
	}
	if len(thresholds) < 3 {
		return certSeverity(expiresAt, now)
	}
	days := certDaysLeft(expiresAt, now)
	switch {
	case days < 0:
		return "expired"
	case days <= thresholds[2]:
		return "urgent"
	case days <= thresholds[0]:
		return "warn"
	default:
		return "ok"
	}
}

// certDaysLeft is whole days from now until expiry. Negative once expired.
//
// Flooring rather than truncating means "0 days" covers the final 24 hours
// before expiry, and "-1 days" starts immediately at the moment of expiry —
// int()-truncating a negative Hours()/24 would instead round a certificate
// that expired ten minutes ago up to 0, reading as "urgent" rather than
// "expired" for almost a full day.
func certDaysLeft(expiresAt int64, now time.Time) int {
	if expiresAt <= 0 {
		return 0
	}
	hours := time.UnixMilli(expiresAt).Sub(now).Hours()
	return int(math.Floor(hours / 24))
}

// certSeverity classifies a certificate for the UI: "" when there is nothing to
// say, then ok / warn / urgent / expired as it approaches.
func certSeverity(expiresAt int64, now time.Time) string {
	if expiresAt <= 0 {
		return ""
	}
	days := certDaysLeft(expiresAt, now)
	switch {
	case days < 0:
		return "expired"
	case days <= certCriticalDays:
		return "urgent"
	case days <= certWarnDays:
		return "warn"
	default:
		return "ok"
	}
}

// recordHostCertificates folds this round's observations into the stored map.
//
// Returns the hosts that have newly crossed a warning threshold, so the caller
// can alert once per threshold rather than on every check for days on end.
func recordHostCertificates(stored map[string]HostCertificate, seen []PingResult, now time.Time) []HostCertificate {
	return recordHostCertificatesWith(stored, seen, now, certNotifyThresholds)
}

// recordHostCertificatesWith is recordHostCertificates against a chosen ladder,
// so the lead time can be a setting without every caller passing it.
func recordHostCertificatesWith(stored map[string]HostCertificate, seen []PingResult, now time.Time, thresholds []int) []HostCertificate {
	if stored == nil {
		return nil
	}
	if len(thresholds) == 0 {
		thresholds = certNotifyThresholds
	}
	var crossed []HostCertificate

	for _, result := range seen {
		host := strings.ToLower(strings.TrimSpace(result.CertHost))
		if host == "" || result.CertExpiry <= 0 {
			continue
		}
		entry, existed := stored[host]
		// A moved expiry is a renewal, which clears the notification history:
		// the new certificate has its own thresholds to cross, and keeping the
		// old marks would silence the next expiry entirely.
		if !existed || entry.ExpiresAt != result.CertExpiry {
			entry = HostCertificate{Host: host, ExpiresAt: result.CertExpiry}
		}
		entry.SeenAt = now.UnixMilli()

		// The tightest threshold the certificate has already passed, which is the
		// only one worth reporting: at five days left it is past both 30 and 7,
		// and "expires in 5 days" is the useful sentence. Walking the list from
		// the loose end instead alerted on 30 now and on 7 next round, turning
		// one renewal into a drip of messages.
		days := certDaysLeft(entry.ExpiresAt, now)
		reached := 0
		for _, threshold := range thresholds {
			if days <= threshold && (reached == 0 || threshold < reached) {
				reached = threshold
			}
		}
		// Everything looser is marked seen at the same time, so a certificate
		// that skips straight past several thresholds does not alert again on
		// each of them as it keeps expiring.
		if reached != 0 && !containsInt(entry.NotifiedDays, reached) {
			for _, threshold := range thresholds {
				if threshold >= reached && !containsInt(entry.NotifiedDays, threshold) {
					entry.NotifiedDays = append(entry.NotifiedDays, threshold)
				}
			}
			crossed = append(crossed, entry)
		}
		stored[host] = entry
	}

	sort.Slice(crossed, func(i, j int) bool { return crossed[i].ExpiresAt < crossed[j].ExpiresAt })
	return crossed
}

func containsInt(values []int, want int) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

// pruneHostCertificates drops hosts no bookmark points at any more, so a
// certificate does not outlive the last bookmark that made it interesting.
func pruneHostCertificates(stored map[string]HostCertificate, liveHosts map[string]struct{}) {
	for host := range stored {
		if _, ok := liveHosts[host]; !ok {
			delete(stored, host)
		}
	}
}

// pruneCertificates drops stored certificates for hosts nothing monitored
// points at any more, so a removed or un-monitored bookmark's certificate does
// not linger indefinitely, ageing toward "expired" for a host nobody watches.
func (h *Handlers) pruneCertificates(liveHosts map[string]struct{}) {
	h.healthCacheMu.Lock()
	defer h.healthCacheMu.Unlock()

	cache := readHealthCacheFile()
	if len(cache.Certificates) == 0 {
		return
	}
	before := len(cache.Certificates)
	pruneHostCertificates(cache.Certificates, liveHosts)
	if len(cache.Certificates) == before {
		return
	}
	if err := writeHealthCacheFile(cache); err != nil {
		log.Printf("health-monitor: failed to persist pruned certificates: %v", err)
	}
}

// recordMonitorCertificates persists what this round saw and reports the hosts
// that newly crossed a warning threshold.
//
// Takes the same lock as the cache merge it follows: both rewrite the one file,
// and a read-modify-write on each without it would lose whichever landed first.
func (h *Handlers) recordMonitorCertificates(results []PingResult) []HostCertificate {
	if len(results) == 0 {
		return nil
	}

	h.healthCacheMu.Lock()
	defer h.healthCacheMu.Unlock()

	cache := readHealthCacheFile()
	if cache.Certificates == nil {
		cache.Certificates = map[string]HostCertificate{}
	}
	crossed := recordHostCertificatesWith(cache.Certificates, results, time.Now(), certThresholdsFor(h.store.GetSettings()))
	if err := writeHealthCacheFile(cache); err != nil {
		return nil
	}
	return crossed
}

// expiringCertificates keeps only the hosts close enough to expiry to be worth
// reporting, so a report does not carry an entry per domain for certificates
// with months left.
func expiringCertificates(stored map[string]HostCertificate, now time.Time) map[string]HostCertificate {
	return expiringCertificatesWith(stored, now, certNotifyThresholds)
}

// expiringCertificatesWith is expiringCertificates against a chosen ladder.
func expiringCertificatesWith(stored map[string]HostCertificate, now time.Time, thresholds []int) map[string]HostCertificate {
	if len(stored) == 0 {
		return nil
	}
	out := make(map[string]HostCertificate)
	for host, cert := range stored {
		switch certSeverityWith(cert.ExpiresAt, now, thresholds) {
		case "warn", "urgent", "expired":
			out[host] = cert
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// hostCertificates returns the stored map, for the report and the UI.
func (h *Handlers) hostCertificates() map[string]HostCertificate {
	h.healthCacheMu.Lock()
	defer h.healthCacheMu.Unlock()
	cache := readHealthCacheFile()
	if cache.Certificates == nil {
		return map[string]HostCertificate{}
	}
	out := make(map[string]HostCertificate, len(cache.Certificates))
	for k, v := range cache.Certificates {
		out[k] = v
	}
	return out
}
