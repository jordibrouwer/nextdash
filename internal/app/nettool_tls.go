package app

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	netTLSDefaultTimeout = 5 * time.Second
	// netTLSDefaultMinDays is the warning line of a check that names none: a
	// certificate that is still valid but has fewer days left than this is "warn".
	netTLSDefaultMinDays = 14
	netTLSMaxMinDays     = 120
)

// netTLSMinDays is the check's warning threshold in days, or the default.
func netTLSMinDays(c NetCheck) int {
	if c.MinDaysLeft > 0 {
		return c.MinDaysLeft
	}
	return netTLSDefaultMinDays
}

// runTLS reads the certificate chain a port presents and judges it. A chain
// that does not verify (expired, self-signed, wrong name, unknown issuer) is a
// failure of class "tls" that still carries the chain; a valid one with fewer
// days left than the check's MinDaysLeft is up but "warn". The host the
// certificate is checked against is the check's target host, so the SNI and the
// name match the address the bookmark points at.
func (h *Handlers) runTLS(ctx context.Context, g netGuard, t netTarget, c NetCheck) NetResult {
	res := netCheckResult(c, t)
	timeout := netCheckTimeout(c, netTLSDefaultTimeout)
	inspectCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	start := time.Now()
	out, err := g.tlsInspect(inspectCtx, t.Host, t.Port, t.Host, timeout)
	res.Ms = ceilMs(time.Since(start))
	minDays := netTLSMinDays(c)
	if len(out.Chain) > 0 {
		out.ServerName, out.MinDays = t.Host, minDays
		res.TLS = &out
		res.Secondary = out.DaysLeft
	}
	if err != nil {
		res = g.netFail(ctx, res, err, timeout)
		if len(out.Chain) > 0 {
			res.Class, res.Error, res.Detail = tlsVerifyFailure(err, out, t.Host)
		} else if res.Class == "tls" {
			res.Error = tlsHandshakeSentence(err)
		}
		return res
	}
	res.OK = true
	res.Detail = fmt.Sprintf("%s, %s", out.Version, tlsDaysPhrase(out.DaysLeft))
	if out.DaysLeft <= minDays {
		res.Warn = true
		res.Detail = tlsDaysPhrase(out.DaysLeft)
	}
	return res
}

func tlsDaysPhrase(days int) string {
	switch {
	case days < 0:
		return fmt.Sprintf("expired %d days ago", -days)
	case days == 0:
		return "expires today"
	case days == 1:
		return "1 day left"
	}
	return fmt.Sprintf("%d days left", days)
}

// tlsHandshakeSentence explains a handshake that never produced a certificate.
func tlsHandshakeSentence(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "first record does not look like a TLS handshake"):
		return "This port does not speak TLS. A mail or similar port may use STARTTLS, which is not supported."
	case strings.Contains(msg, "protocol version"):
		return "The server only offers a TLS version older than 1.2, which is not supported."
	}
	return "The TLS handshake failed: " + truncateNetDetail(msg)
}

// tlsVerifyFailure turns a verification error into the class, the sentence and
// the short detail of a failed result.
func tlsVerifyFailure(err error, out TLSResult, host string) (class, sentence, detail string) {
	class = "tls"
	var inv x509.CertificateInvalidError
	var hostErr x509.HostnameError
	var unknown x509.UnknownAuthorityError
	switch {
	case errors.As(err, &inv) && inv.Reason == x509.Expired:
		if out.DaysLeft < 0 {
			return class, fmt.Sprintf("The certificate expired %d days ago.", -out.DaysLeft), tlsDaysPhrase(out.DaysLeft)
		}
		return class, "The certificate is not valid yet.", "not valid yet"
	case errors.As(err, &hostErr):
		return class, "The certificate is not valid for " + host + ".", "wrong host name"
	case errors.As(err, &unknown):
		return class, "The certificate is not trusted: its issuer is not a known authority (self-signed, or an intermediate certificate is missing).", "not trusted"
	}
	return class, "The certificate could not be verified: " + truncateNetDetail(err.Error()), "not verified"
}

// netTLSThresholds is the ladder of day marks a check's expiry warning fires
// on, largest first. The first mark is the check's own MinDaysLeft, the two
// tighter ones follow in the proportion of the certificate warnings (the same
// function), so a renewal gets its "plan it", "do it this week" and "breaks now".
func netTLSThresholds(minDays int) []int {
	if minDays < 3 {
		return []int{minDays}
	}
	if minDays > netTLSMaxMinDays {
		minDays = netTLSMaxMinDays
	}
	return certThresholdsFor(Settings{CertWarnDays: minDays})
}

// netCertNotifications records what this round's TLS checks saw and returns one
// "cert-expiring" notification per check that newly crossed a mark of its
// ladder. It reuses the host certificate bookkeeping (recordHostCertificatesWith:
// a renewal resets the marks, a mark is told once) in a map of its own, keyed by
// the check's history key, so these never show up as a host in the Health
// certificate list and are never mixed with the HTTP monitor's own warning for
// the same host. A failed (expired, untrusted) check is down and says so itself;
// a muted check is left alone so unmuting it later still tells.
func (h *Handlers) netCertNotifications(outcomes []netOutcome, now time.Time) []monitorNotification {
	var todo []netOutcome
	for _, out := range outcomes {
		if out.due.check.Type == netTypeTLS && out.res.OK && out.res.TLS != nil && out.res.TLS.Valid &&
			len(out.res.TLS.Chain) > 0 && !out.due.muted {
			todo = append(todo, out)
		}
	}
	if len(todo) == 0 {
		return nil
	}
	h.healthCacheMu.Lock()
	defer h.healthCacheMu.Unlock()
	cache := readHealthCacheFile()
	if cache.NetCertificates == nil {
		cache.NetCertificates = map[string]HostCertificate{}
	}
	var pending []monitorNotification
	for _, out := range todo {
		key := netHistoryKey(out.due.check.ID)
		expires := out.res.TLS.Chain[0].NotAfter
		crossed := recordHostCertificatesWith(cache.NetCertificates,
			[]PingResult{{CertHost: key, CertExpiry: expires}}, now, netTLSThresholds(netTLSMinDays(out.due.check)))
		for _, n := range certExpiryNotifications(crossed, now) {
			n.Name = out.due.bm.Name
			n.URL = out.due.bm.URL
			n.Check = netCheckLabel(out.due.check, out.due.bm)
			n.CheckID = out.due.check.ID
			pending = append(pending, n)
		}
	}
	if err := writeHealthCacheFile(cache); err != nil {
		logWarn(logComponentHealth, "the TLS expiry marks could not be saved (%v); they may warn again next round", err)
		return nil
	}
	return pending
}

// pruneNetCertificates drops the expiry marks of checks that no longer exist.
// known is the history key of every check of every bookmark.
func (h *Handlers) pruneNetCertificates(known map[string]bool) {
	h.healthCacheMu.Lock()
	defer h.healthCacheMu.Unlock()
	cache := readHealthCacheFile()
	changed := false
	for key := range cache.NetCertificates {
		if !known[key] {
			delete(cache.NetCertificates, key)
			changed = true
		}
	}
	if changed {
		if err := writeHealthCacheFile(cache); err != nil {
			logWarn(logComponentHealth, "the pruned TLS expiry marks could not be saved (%v)", err)
		}
	}
}
