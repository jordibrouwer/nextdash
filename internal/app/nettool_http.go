package app

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/netip"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"
)

const (
	netHTTPDefaultTimeout = 10 * time.Second
	// netHTTPDefaultStatus is what counts as the right answer when a check names
	// none: a success, after the redirects were followed.
	netHTTPDefaultStatus = "200-299"

	netHTTPMaxHeaders     = 40
	netHTTPMaxHeaderBytes = 4 << 10 // names and values together
	netHTTPMaxHeaderValue = 200
	netHTTPMaxURL         = 200
	netHTTPMaxEndpoint    = 200
	netHTTPMaxExpectHdr   = 200
)

// netHTTPHiddenHeaders keep their name and lose their value in a result: they
// carry a session or a secret.
var netHTTPHiddenHeaders = map[string]bool{
	"set-cookie": true, "set-cookie2": true, "cookie": true,
	"authorization": true, "proxy-authorization": true,
}

// validNetHTTPEndpoint accepts a path with an optional query that stays on the
// bookmark's host: it starts with one "/", names no host, scheme or fragment.
func validNetHTTPEndpoint(ep string) error {
	if ep == "" {
		return nil
	}
	if len(ep) > netHTTPMaxEndpoint {
		return fmt.Errorf("the path can be at most %d characters", netHTTPMaxEndpoint)
	}
	if ep[0] != '/' || strings.HasPrefix(ep, "//") || strings.Contains(ep, "\\") ||
		strings.Contains(ep, "#") || strings.ContainsAny(ep, " \t\r\n") {
		return errors.New("the path must start with a single / and cannot contain spaces, backslashes or a fragment")
	}
	for _, r := range ep {
		if unicode.IsControl(r) {
			return errors.New("the path cannot contain control characters")
		}
	}
	u, err := url.ParseRequestURI(ep)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil {
		return errors.New("the path must be a path on the bookmark's own host, such as /health")
	}
	return nil
}

// parseNetHTTPExpectHeader reads "name" or "name: part" into a lower-case name
// and the text that must be in a value (empty: the header only has to exist).
func parseNetHTTPExpectHeader(spec string) (name, part string, err error) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return "", "", nil
	}
	if len([]rune(spec)) > netHTTPMaxExpectHdr {
		return "", "", fmt.Errorf("the expected header can be at most %d characters", netHTTPMaxExpectHdr)
	}
	for _, r := range spec {
		if unicode.IsControl(r) {
			return "", "", errors.New("the expected header cannot contain control characters")
		}
	}
	n, p, _ := strings.Cut(spec, ":")
	n = strings.ToLower(strings.TrimSpace(n))
	if n == "" {
		return "", "", errors.New("the expected header needs a name, like server or server: nginx")
	}
	for i := 0; i < len(n); i++ {
		ch := n[i]
		if !(ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_') {
			return "", "", errors.New("the header name can only contain letters, digits, - and _")
		}
	}
	return n, strings.TrimSpace(p), nil
}

// netHTTPRequestURL is the address a run starts at: the bookmark's origin plus
// the check's path, or the bookmark's own address when the check names no path.
// A check that aims at a custom host keeps the bookmark's scheme and port and
// gets "/" (the bookmark's path belongs to the bookmark's host).
func netHTTPRequestURL(bm Bookmark, c NetCheck, t netTarget) (*url.URL, error) {
	bu, err := url.Parse(strings.TrimSpace(bm.URL))
	if err != nil || bu.Host == "" {
		return nil, errors.New("the bookmark has no address to request")
	}
	scheme := strings.ToLower(bu.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, errors.New("the bookmark's address is not an http or https address")
	}
	out := &url.URL{Scheme: scheme, Host: bu.Host}
	custom := t.URL == ""
	if custom {
		host := t.Host
		if ip, err := netip.ParseAddr(host); err == nil && ip.Is6() {
			host = "[" + host + "]"
		}
		if p := bu.Port(); p != "" {
			host += ":" + p
		}
		out.Host = host
	}
	if c.Endpoint != "" {
		ep, err := url.ParseRequestURI(c.Endpoint)
		if err != nil {
			return nil, errors.New("the path is not valid")
		}
		out.Path, out.RawPath, out.RawQuery = ep.Path, ep.RawPath, ep.RawQuery
	} else if !custom {
		out.Path, out.RawPath, out.RawQuery = bu.Path, bu.RawPath, bu.RawQuery
	}
	if out.Path == "" {
		out.Path = "/"
	}
	return out, nil
}

// netDisplayURL is what a result may show of an address: no user info, no
// fragment and no query (a query often carries a key), cut to a sane length.
func netDisplayURL(u *url.URL) string {
	if u == nil {
		return ""
	}
	s := u.Scheme + "://" + u.Host + u.EscapedPath()
	if u.RawQuery != "" {
		s += "?…"
	}
	if r := []rune(s); len(r) > netHTTPMaxURL {
		s = string(r[:netHTTPMaxURL]) + "…"
	}
	return s
}

// netHopTrace collects the moments of one request.
type netHopTrace struct {
	start               time.Time
	dnsStart, dnsDone   time.Time
	connStart, connDone time.Time
	tlsStart, tlsDone   time.Time
	wrote, firstByte    time.Time
	ip                  string
}

func (t *netHopTrace) clientTrace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) { t.dnsStart = time.Now() },
		DNSDone:  func(httptrace.DNSDoneInfo) { t.dnsDone = time.Now() },
		ConnectStart: func(_, _ string) {
			if t.connStart.IsZero() {
				t.connStart = time.Now()
			}
		},
		ConnectDone: func(_, _ string, err error) {
			if err == nil {
				t.connDone = time.Now()
			}
		},
		TLSHandshakeStart: func() { t.tlsStart = time.Now() },
		TLSHandshakeDone:  func(_ tls.ConnectionState, _ error) { t.tlsDone = time.Now() },
		GotConn: func(info httptrace.GotConnInfo) {
			if info.Conn != nil {
				if host, _, err := net.SplitHostPort(info.Conn.RemoteAddr().String()); err == nil {
					t.ip = host
				}
			}
		},
		WroteRequest:         func(httptrace.WroteRequestInfo) { t.wrote = time.Now() },
		GotFirstResponseByte: func() { t.firstByte = time.Now() },
	}
}

// netHTTPExpectedStatus is the status rule of a check: its own, else the default.
func netHTTPExpectedStatus(c NetCheck) string {
	if spec := normalizeExpectStatus(c.ExpectStatus); spec != "" {
		return spec
	}
	return netHTTPDefaultStatus
}

func traceMs(from, to time.Time) int {
	if from.IsZero() || to.IsZero() || to.Before(from) {
		return 0
	}
	return ceilMs(to.Sub(from))
}

func netHTTPProto(p string) string {
	return strings.TrimSuffix(p, ".0")
}

func netIsRedirect(status int) bool {
	switch status {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther,
		http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		return true
	}
	return false
}

// netHTTPHeaders is what a result shows of the response headers: names in
// lower case and sorted, values cut, the secret ones hidden, a Location shown
// without its query, at most netHTTPMaxHeaders of them and netHTTPMaxHeaderBytes
// in all. total is how many the answer had.
func netHTTPHeaders(h http.Header) (shown []HTTPHeader, total int) {
	names := make([]string, 0, len(h))
	for name := range h {
		names = append(names, strings.ToLower(name))
	}
	sort.Strings(names)
	used := 0
	for _, name := range names {
		total++
		if len(shown) >= netHTTPMaxHeaders {
			continue
		}
		value := strings.Join(h.Values(name), ", ")
		switch {
		case netHTTPHiddenHeaders[name]:
			value = "[hidden]"
		case name == "location":
			if u, err := url.Parse(value); err == nil {
				if u.Scheme == "" && u.Host == "" {
					value = u.EscapedPath()
					if u.RawQuery != "" {
						value += "?…"
					}
				} else {
					value = netDisplayURL(u)
				}
			}
		}
		value = strings.Map(func(r rune) rune {
			if unicode.IsControl(r) {
				return ' '
			}
			return r
		}, value)
		if r := []rune(value); len(r) > netHTTPMaxHeaderValue {
			value = string(r[:netHTTPMaxHeaderValue]) + "…"
		}
		if used+len(name)+len(value) > netHTTPMaxHeaderBytes {
			continue
		}
		used += len(name) + len(value)
		shown = append(shown, HTTPHeader{Name: name, Value: value})
	}
	return shown, total
}

// netHTTPHeaderMatches is the ExpectHeader rule against the real headers (not
// the trimmed list): present, and containing part (case-insensitive) when
// part is not empty.
func netHTTPHeaderMatches(h http.Header, name, part string) bool {
	values := h.Values(name)
	if len(values) == 0 {
		return false
	}
	if part == "" {
		return true
	}
	for _, v := range values {
		if strings.Contains(strings.ToLower(v), strings.ToLower(part)) {
			return true
		}
	}
	return false
}

func netHTTPDetailLine(status, redirects int, slow bool) string {
	s := fmt.Sprintf("%d", status)
	switch redirects {
	case 0:
	case 1:
		s += " · 1 redirect"
	default:
		s += fmt.Sprintf(" · %d redirects", redirects)
	}
	if slow {
		s += " · slow"
	}
	return s
}

func sameOriginURL(a, b *url.URL) bool {
	return strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Host, b.Host)
}

// runHTTPDetail makes one GET and reports its timeline, redirect chain and
// headers. Redirects are followed here, one request at a time, at most
// netHTTPMaxRedirects: the guard is asked about every hop before it is
// requested, and a hop it refuses is shown in the chain but never requested.
// The body is read to at most netHTTPMaxBody and thrown away. The bookmark's
// stored credential goes only to the host the run started at (never after a
// redirect to another host or scheme), and no result carries it.
//
// Up means: the final status is the expected one (200-299 when the check names
// none) and the expected header, if any, is there. A run slower to its first
// byte than MaxMs is still up but "slow". This is a supplement to the bookmark's
// ordinary HTTP check; it writes nothing into that check's history.
func (h *Handlers) runHTTPDetail(ctx context.Context, g netGuard, t netTarget, bm Bookmark, c NetCheck) NetResult {
	res := netCheckResult(c, t)
	timeout := netCheckTimeout(c, netHTTPDefaultTimeout)
	start, err := netHTTPRequestURL(bm, c, t)
	if err != nil {
		res.Class, res.Error = "other", "The check cannot be run: "+err.Error()+"."
		return res
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	client := g.httpClient(timeout, bm.AllowInsecureTLS)
	defer client.CloseIdleConnections()

	var credential HealthCredential
	haveCredential := false
	if id := strings.TrimSpace(bm.CredentialID); id != "" {
		credential, haveCredential = lookupHealthCredential(id)
	}

	detail := &HTTPDetailResult{}
	res.HTTP = detail
	runStart := time.Now()
	cur := start
	var final *netHopTrace
	var finalHopStart time.Time
	var resp *http.Response

	fail := func(err error) NetResult {
		res.Ms = ceilMs(time.Since(runStart))
		out := g.netFail(ctx, res, err, timeout)
		if out.Class == "tls" {
			out.Error = "The secure connection failed: " + truncateNetDetail(err.Error())
		}
		return out
	}

	for {
		if len(detail.Redirects) > 0 {
			if _, err := g.resolve(runCtx, cur.Hostname()); err != nil {
				if errors.Is(err, errNetGuardBlocked) {
					detail.Redirects = append(detail.Redirects, HTTPHop{URL: netDisplayURL(cur), Blocked: true})
					detail.URL = netDisplayURL(cur)
					res.Ms = ceilMs(time.Since(runStart))
					res.Class = "guard"
					res.Error = "The server redirects to " + netDisplayURL(cur) + ", which the address guard blocks: it points at a private or reserved network."
					if addrs := g.explainBlocked(ctx, cur.Hostname()); len(addrs) > 0 {
						res.Error = "The server redirects to " + netDisplayURL(cur) + ", which the address guard blocks: it resolves to " + addrs[0].String() + ", a private or reserved address."
					}
					res.Detail = netHTTPDetailLine(detail.Status, len(detail.Redirects)-1, false) + " · redirect blocked"
					return res
				}
				return fail(err)
			}
		}
		tr := &netHopTrace{start: time.Now()}
		req, err := http.NewRequestWithContext(httptrace.WithClientTrace(runCtx, tr.clientTrace()), http.MethodGet, cur.String(), nil)
		if err != nil {
			res.Class, res.Error = "other", "The address of the request is not valid."
			return res
		}
		req.Header.Set("User-Agent", "nextDash-NetCheck/1.0")
		req.Header.Set("Accept", "*/*")
		if haveCredential && sameOriginURL(start, cur) {
			applyHealthCredential(req, credential)
		}
		finalHopStart = tr.start
		resp, err = client.Do(req)
		if err != nil {
			return fail(err)
		}
		final = tr
		status := resp.StatusCode
		loc := strings.TrimSpace(resp.Header.Get("Location"))
		if !netIsRedirect(status) || loc == "" {
			break
		}
		detail.Status = status
		hop := HTTPHop{URL: netDisplayURL(cur), Status: status, Ms: traceMs(tr.start, tr.firstByte)}
		next, perr := cur.Parse(loc)
		drainAndCloseResponse(resp)
		detail.Redirects = append(detail.Redirects, hop)
		if perr != nil || (next.Scheme != "http" && next.Scheme != "https") || next.Hostname() == "" {
			res.Ms = ceilMs(time.Since(runStart))
			res.Class, res.Error = "http", "The server redirects somewhere this check cannot follow (not an http or https address)."
			detail.URL = netDisplayURL(cur)
			return res
		}
		if len(detail.Redirects) > netHTTPMaxRedirects {
			res.Ms = ceilMs(time.Since(runStart))
			res.Class, res.Error = "http", fmt.Sprintf("More than %d redirects; the chain was cut off.", netHTTPMaxRedirects)
			detail.URL = netDisplayURL(cur)
			res.Detail = netHTTPDetailLine(status, len(detail.Redirects), false)
			return res
		}
		next.Fragment = ""
		cur = next
	}
	defer resp.Body.Close()

	// The final answer: read a bounded amount of the body to time the download.
	n, copyErr := io.Copy(io.Discard, io.LimitReader(resp.Body, netHTTPMaxBody+1))
	bodyDone := time.Now()
	if n > netHTTPMaxBody {
		n, detail.SizeCapped = netHTTPMaxBody, true
	}
	if copyErr != nil && !errors.Is(copyErr, io.EOF) {
		return fail(copyErr)
	}

	redirects := len(detail.Redirects)
	detail.Status = resp.StatusCode
	detail.Proto = netHTTPProto(resp.Proto)
	detail.Size = n
	detail.IP = final.ip
	detail.URL = netDisplayURL(cur)
	detail.Headers, detail.HeadersTotal = netHTTPHeaders(resp.Header)
	tl := &HTTPTimings{
		DNSMs:      traceMs(final.dnsStart, final.dnsDone),
		ConnectMs:  traceMs(final.connStart, final.connDone),
		TLSMs:      traceMs(final.tlsStart, final.tlsDone),
		WaitMs:     traceMs(final.wrote, final.firstByte),
		TransferMs: traceMs(final.firstByte, bodyDone),
		RedirectMs: traceMs(runStart, finalHopStart),
		TTFBMs:     traceMs(runStart, final.firstByte),
		TotalMs:    traceMs(runStart, bodyDone),
	}
	detail.Timings = tl
	res.IP = detail.IP
	res.Ms = tl.TTFBMs
	if res.Ms < 1 {
		res.Ms = 1
	}

	spec := netHTTPExpectedStatus(c)
	detail.ExpectStatus = spec
	hdrName, hdrPart, _ := parseNetHTTPExpectHeader(c.ExpectHeader)
	if hdrName != "" {
		detail.ExpectHeader = strings.TrimSpace(c.ExpectHeader)
	}
	res.Detail = netHTTPDetailLine(detail.Status, redirects, false)
	if ok, _ := statusMatchesExpectation(detail.Status, spec); !ok {
		res.Class = "http"
		res.Error = fmt.Sprintf("The server answered %d; the check expects %s.", detail.Status, spec)
		return res
	}
	if hdrName != "" && !netHTTPHeaderMatches(resp.Header, hdrName, hdrPart) {
		res.Class = "content"
		switch {
		case len(resp.Header.Values(hdrName)) == 0 && hdrPart == "":
			res.Error = fmt.Sprintf("The answer has no %s header.", hdrName)
		case len(resp.Header.Values(hdrName)) == 0:
			res.Error = fmt.Sprintf("The answer has no %s header (expected one containing %q).", hdrName, hdrPart)
		default:
			res.Error = fmt.Sprintf("The %s header does not contain %q.", hdrName, hdrPart)
		}
		return res
	}
	res.OK = true
	if c.MaxMs > 0 && res.Ms > c.MaxMs {
		res.Slow = true
		res.Detail = netHTTPDetailLine(detail.Status, redirects, true)
	}
	return res
}
