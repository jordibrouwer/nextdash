package app

import (
	"context"
	"fmt"
	"time"
)

// Typed sub-results, one per check type. Only the shapes are here; the
// engines that fill them arrive with their phase.
type TCPResult struct {
	Open      bool   `json:"open"`
	ConnectMs int    `json:"connectMs"`
	IP        string `json:"ip,omitempty"`
	Port      int    `json:"port,omitempty"`
}

type PingStats struct {
	Sent     int   `json:"sent"`
	Received int   `json:"received"`
	LossPct  int   `json:"lossPct"`
	MinMs    int   `json:"minMs"`
	AvgMs    int   `json:"avgMs"`
	MaxMs    int   `json:"maxMs"`
	JitterMs int   `json:"jitterMs"`
	RTTs     []int `json:"rtts,omitempty"`
	ViaTCP   bool  `json:"viaTcp,omitempty"`
}

type DNSRecord struct {
	Value string `json:"value"`
	TTL   int    `json:"ttl,omitempty"`
	Prio  int    `json:"prio,omitempty"`
}

type DNSResult struct {
	Record   string      `json:"record"`
	Resolver string      `json:"resolver,omitempty"`
	Records  []DNSRecord `json:"records,omitempty"`
	QueryMs  int         `json:"queryMs"`
	Changed  bool        `json:"changed,omitempty"`
	Diff     string      `json:"diff,omitempty"`
}

type TLSCert struct {
	Subject   string   `json:"subject"`
	Issuer    string   `json:"issuer"`
	NotBefore int64    `json:"notBefore"`
	NotAfter  int64    `json:"notAfter"`
	SigAlg    string   `json:"sigAlg,omitempty"`
	SAN       []string `json:"san,omitempty"`
	SANMore   int      `json:"sanMore,omitempty"` // names cut off after the first 20
}

type TLSResult struct {
	Version  string    `json:"version"`
	Cipher   string    `json:"cipher,omitempty"`
	ALPN     string    `json:"alpn,omitempty"`
	Chain    []TLSCert `json:"chain,omitempty"` // at most 5 certificates, the server's own first
	DaysLeft int       `json:"daysLeft"`        // of the first certificate; negative once expired
	Valid    bool      `json:"valid"`           // the chain verifies for the host name, against the system roots
	// ChainTotal is how many certificates the server sent; Chain holds the first few.
	ChainTotal int `json:"chainTotal,omitempty"`
	// ServerName is the name the certificate was checked against (also the SNI).
	ServerName string `json:"serverName,omitempty"`
	MinDays    int    `json:"minDays,omitempty"` // the warning threshold used
}

// HTTPTimings is the timeline of an HTTP-detail run, in milliseconds. The
// first five describe the request that got the final answer (a redirect that
// came before it is RedirectMs). TTFBMs and TotalMs count from the start of
// the whole run, so TTFBMs is also the sample's response time.
type HTTPTimings struct {
	DNSMs      int `json:"dnsMs"`
	ConnectMs  int `json:"connectMs"`
	TLSMs      int `json:"tlsMs"`
	WaitMs     int `json:"waitMs"`     // request sent until the first byte of the answer
	TransferMs int `json:"transferMs"` // first byte until the (limited) body was read
	RedirectMs int `json:"redirectMs"` // the redirects before the final request
	TTFBMs     int `json:"ttfbMs"`
	TotalMs    int `json:"totalMs"`
}

// HTTPHop is one step of a redirect chain. A hop that the address guard
// refused is shown (Blocked) but was never requested.
type HTTPHop struct {
	URL     string `json:"url"` // scheme, host and path; the query is left out
	Status  int    `json:"status,omitempty"`
	Ms      int    `json:"ms,omitempty"`
	Blocked bool   `json:"blocked,omitempty"`
}

// HTTPHeader is one response header, name in lower case. Secret-carrying
// headers keep their name and lose their value.
type HTTPHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type HTTPDetailResult struct {
	Status       int          `json:"status"`
	Proto        string       `json:"proto,omitempty"`
	IP           string       `json:"ip,omitempty"`
	Size         int64        `json:"size,omitempty"` // bytes read, at most netHTTPMaxBody
	SizeCapped   bool         `json:"sizeCapped,omitempty"`
	URL          string       `json:"url,omitempty"` // where the run ended (no query)
	Timings      *HTTPTimings `json:"timings,omitempty"`
	Redirects    []HTTPHop    `json:"redirects,omitempty"`
	Headers      []HTTPHeader `json:"headers,omitempty"`
	HeadersTotal int          `json:"headersTotal,omitempty"` // how many the answer had
	ExpectStatus string       `json:"expectStatus,omitempty"` // the rule applied
	ExpectHeader string       `json:"expectHeader,omitempty"`
}

// JSONResult is what a JSON check found. Value is the value under Path as a
// short text (at most 200 characters; an object or list is only described, and
// a value under a path that names a token, key, secret or password is
// "[hidden]"). Expect is the check's expected value, hidden under the same rule.
// Nothing here carries the credential or the rest of the answer.
type JSONResult struct {
	Path   string `json:"path"`
	Op     string `json:"op"`
	Expect string `json:"expect,omitempty"`
	Found  bool   `json:"found"`
	Value  string `json:"value,omitempty"`
	Type   string `json:"type,omitempty"` // string, number, boolean, null, object or list
	OK     bool   `json:"ok"`
	Status int    `json:"status,omitempty"`
	Ms     int    `json:"ms"`
	Size   int64  `json:"size,omitempty"` // bytes read, at most netHTTPMaxBody
}

// NetResult is one run of one check, from the scheduler, /api/net/run or MCP.
type NetResult struct {
	Type      string `json:"type"`
	CheckID   string `json:"checkId,omitempty"`
	At        int64  `json:"at"`
	OK        bool   `json:"ok"`
	Slow      bool   `json:"slow,omitempty"` // MaxMs exceeded; counts as up
	Warn      bool   `json:"warn,omitempty"` // TLS under MinDaysLeft; counts as up
	Ms        int    `json:"ms"`
	Class     string `json:"class,omitempty"`     // dns|timeout|refused|tls|http|content|guard|icmp|demo|other
	Error     string `json:"error,omitempty"`     // English sentence
	Detail    string `json:"detail,omitempty"`    // up to 120 runes; becomes sample.D
	Secondary int    `json:"secondary,omitempty"` // sample.L: loss % or days left
	Host      string `json:"host"`
	IP        string `json:"ip,omitempty"`
	Port      int    `json:"port,omitempty"`
	ViaTCP    bool   `json:"viaTcp,omitempty"`

	TCP  *TCPResult        `json:"tcp,omitempty"`
	Ping *PingStats        `json:"ping,omitempty"`
	DNS  *DNSResult        `json:"dns,omitempty"`
	TLS  *TLSResult        `json:"tls,omitempty"`
	HTTP *HTTPDetailResult `json:"http,omitempty"`
	JSON *JSONResult       `json:"json,omitempty"`
}

// netRunDeadline caps every run, whatever the type.
const netRunDeadline = 10 * time.Second

// runNetCheck is the one entry for the monitor loop, /api/net/run and MCP.
// Types that are not built yet answer with a class "other" result.
func (h *Handlers) runNetCheck(ctx context.Context, bm Bookmark, c NetCheck) NetResult {
	ctx, cancel := context.WithTimeout(ctx, netRunDeadline)
	defer cancel()
	res := NetResult{Type: c.Type, CheckID: c.ID, At: time.Now().UnixMilli()}
	target, err := netCheckTarget(bm, c, h.store.GetSettings())
	if err != nil {
		res.Class, res.Error = netErrorClassOrOther(err), err.Error()
		return res
	}
	res.Host, res.Port = target.Host, target.Port
	switch c.Type {
	case netTypeTCP:
		return h.runTCP(ctx, h.netGuard(), target, c)
	case netTypePing:
		return h.runPing(ctx, h.netGuard(), target, c, h.store.GetSettings().NetToolsPing)
	case netTypeDNS:
		return h.runDNS(ctx, h.netGuard(), target, c)
	case netTypeTLS:
		return h.runTLS(ctx, h.netGuard(), target, c)
	case netTypeHTTP:
		return h.runHTTPDetail(ctx, h.netGuard(), target, bm, c)
	case netTypeJSON:
		return h.runJSON(ctx, h.netGuard(), target, bm, c)
	default:
		res.Class, res.Error = "other", "type not available yet"
	}
	return res
}

// netErrorClassOrOther is netErrorClass for a failure that is not a network
// error (a bad target): those are "other" rather than text-matched.
func netErrorClassOrOther(err error) string {
	if cls := netErrorClass(err); cls != "" && cls != "other" {
		return cls
	}
	return "other"
}

// sample is the history row of a result. The detail is cut to netDetailMax
// runes here, the single place a detail enters the history.
func (r NetResult) sample(maint bool) HealthSample {
	return HealthSample{
		T:      r.At,
		Up:     r.OK,
		PingMs: r.Ms,
		Fail:   r.Class,
		D:      truncateNetDetail(r.Detail),
		L:      r.Secondary,
		Maint:  maint,
	}
}

// netCheckResult starts a result for a check against a target.
func netCheckResult(c NetCheck, t netTarget) NetResult {
	return NetResult{Type: c.Type, CheckID: c.ID, At: time.Now().UnixMilli(), Host: t.Host, Port: t.Port}
}

// netFail fills the failure fields of a result from an error: the class from
// netErrorClass, an English sentence for the UI. A guard refusal says where the
// host points (a lookup that is only shown, never dialed).
func (g netGuard) netFail(ctx context.Context, res NetResult, err error, timeout time.Duration) NetResult {
	res.OK = false
	res.Class = netErrorClassOrOther(err)
	switch res.Class {
	case "guard":
		res.Error = "The address guard blocks this host: it points at a private or reserved network."
		if addrs := g.explainBlocked(ctx, res.Host); len(addrs) > 0 {
			res.Error = "The address guard blocks this host: it resolves to " + addrs[0].String() + ", a private or reserved address."
		}
	case "demo":
		res.Error = "Network checks do not reach out in the demo."
	case "icmp":
		res.Error = "ICMP is not permitted here."
	case "dns":
		res.Error = "The host name could not be resolved."
	case "refused":
		res.Error = "The connection was refused: nothing is listening there."
	case "timeout":
		res.Error = fmt.Sprintf("No answer within %d s.", int(timeout.Seconds()))
	default:
		res.Error = "The check failed: " + truncateNetDetail(err.Error())
	}
	return res
}
