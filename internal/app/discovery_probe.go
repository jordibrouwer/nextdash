package app

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"html"
	"io"
	"mime"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	discoveryProbeTimeout   = 4 * time.Second
	discoveryProbeMaxBody   = 64 * 1024
	discoveryProbeRedirects = 3
)

// discoveryProbeResult says whether a candidate address answers like a web
// app. Reason is set when the answer was not a plain yes (for instance
// "unresolved" for a proxy name this machine cannot look up).
type discoveryProbeResult struct {
	OK     bool
	Reason string
	Title  string
	// URL is the address that answered when it is not the one asked: a port
	// candidate that only answers on https. Empty means the candidate's own.
	URL string
}

var discoveryTitleRE = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)

// probeDiscoveryCandidate asks a candidate address for its page. A web app is
// what answers with HTML, a login page included. Addresses the user or the
// container itself named (manual, label) are trusted without a request.
func probeDiscoveryCandidate(ctx context.Context, cand discoveryCandidate) discoveryProbeResult {
	switch cand.Source {
	case discoveryManual, discoveryLabel:
		return discoveryProbeResult{OK: true}
	}
	ctx, cancel := context.WithTimeout(ctx, discoveryProbeTimeout)
	defer cancel()

	res, err := probeDiscoveryOnce(ctx, cand.URL)
	// Only a port candidate is guessed as plain http; many apps serve https
	// on the port instead. Unraid candidates are taken as given, no fallback.
	// A TLS port answers a plain request with an error page, so a no-page
	// answer falls back too, not only a failed connection.
	if (err != nil || !res.OK) && cand.Source == discoveryPort && strings.HasPrefix(cand.URL, "http://") {
		secure := "https://" + strings.TrimPrefix(cand.URL, "http://")
		if res2, err2 := probeDiscoveryOnce(ctx, secure); err2 == nil && res2.OK {
			res2.URL = secure
			return res2
		}
	}
	if err != nil {
		var dnsErr *net.DNSError
		// A proxy name that does not resolve here is split DNS, not a dead
		// app: the browser may well resolve it.
		if cand.Source == discoveryProxy && errors.As(err, &dnsErr) && dnsErr.IsNotFound {
			return discoveryProbeResult{OK: true, Reason: "unresolved"}
		}
		return discoveryProbeResult{Reason: err.Error()}
	}
	return res
}

// probeDiscoveryOnce does one GET. A non-nil error means no usable answer was
// got at all; a result with OK false means it answered, but not with a page.
func probeDiscoveryOnce(ctx context.Context, target string) (discoveryProbeResult, error) {
	transport := newSSRFSafeTransport(true, discoveryProbeTimeout)
	// Self-signed certificates are normal on a home network; this probe only
	// asks whether a page answers and sends nothing.
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // probe of a LAN address, no data sent
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(_ *http.Request, via []*http.Request) error {
			if len(via) > discoveryProbeRedirects {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return discoveryProbeResult{}, err
	}
	req.Header.Set("Accept", "text/html,*/*;q=0.5")
	resp, err := client.Do(req)
	if err != nil {
		return discoveryProbeResult{}, err
	}
	defer resp.Body.Close()

	// A page, or a login in front of one. Any other answer -- an error page
	// in HTML included -- is not the app.
	switch resp.StatusCode {
	case http.StatusOK, http.StatusUnauthorized, http.StatusForbidden:
	default:
		return discoveryProbeResult{Reason: fmt.Sprintf("status %d", resp.StatusCode)}, nil
	}
	mt, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if mt != "text/html" && mt != "application/xhtml+xml" {
		return discoveryProbeResult{Reason: "not html"}, nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, discoveryProbeMaxBody))
	title := ""
	if m := discoveryTitleRE.FindSubmatch(body); m != nil {
		title = strings.Join(strings.Fields(html.UnescapeString(string(m[1]))), " ")
	}
	return discoveryProbeResult{OK: true, Title: title}, nil
}
