package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

/*
The JSON check: one GET of the bookmark's address (or of a path on the same
host), and one value in the JSON answer compared with what the check expects.

The path language is the custom widget's own (customWidgetLookup), called as it
is: "db.state", "items[0].name", "services[name=api].up", a trailing "#" to
count. A path that names nothing is an answer ("not found"), never zero.

Three rules decide what may leave this file:

  - The request goes through the same guard as the HTTP-detail check, one hop at
    a time, and a hop to a private address is refused. The stored credential goes
    only to the scheme and host:port the run started at, never after a redirect
    to anywhere else.
  - Nothing of the credential comes back. Its values are scrubbed from every
    sentence and value a result carries, and a transport error never prints the
    address it was asked for (a credential may live in its query).
  - A value under a path that names a token, key, secret or password is never
    shown, and nothing nested is: an object or a list is described by its size.
*/

const (
	netJSONDefaultTimeout = 10 * time.Second
	netJSONMaxPath        = 200
	netJSONMaxExpect      = 200
	netJSONMaxValue       = 200
	netJSONHidden         = "[hidden]"
)

var netJSONOps = map[string]bool{"eq": true, "ne": true, "gt": true, "lt": true, "contains": true, "exists": true}

// netJSONSecretPath: a path that names one of these says the value under it is
// a secret. It is a blocklist, so it is only the first of two rules; the second
// (netJSONRedactor) covers every answer to a request that carried a credential.
var netJSONSecretPath = regexp.MustCompile(`(?i)token|key|secret|pass|pwd|auth|jwt|bearer|cookie|session|credential|private|signature|otp|hash|salt`)

func netJSONPathIsSecret(path string) bool { return netJSONSecretPath.MatchString(path) }

// netJSONSafeWords are the plain status words a value or an expected value may
// show even in an authenticated answer: they carry no secret, and "status eq ok"
// is what most checks say.
var netJSONSafeWords = map[string]bool{
	"ok": true, "up": true, "down": true, "healthy": true, "unhealthy": true, "running": true,
	"stopped": true, "active": true, "inactive": true, "online": true, "offline": true,
	"enabled": true, "disabled": true, "ready": true, "error": true, "warning": true,
	"fail": true, "failed": true, "success": true, "degraded": true, "idle": true,
	"true": true, "false": true, "null": true,
}

// netJSONRedactor is the single rule for what of a JSON answer a result may
// show. A value is shown as it is only when
//
//   - the path does not look like a secret (netJSONSecretPath), AND
//   - the request carried no credential (authed false), or the text is a number,
//     a boolean/null or a plain status word (netJSONSafeWords).
//
// Anything else (a string from an authenticated answer, a value under a secret
// path) is described instead: "string (12 chars)" or "[hidden]". The point of
// the second half is that a blocklist on names cannot know that users[0].hash
// or config[0].value is a password: once a credential opened the door, the
// result says what kind of value it found and how long it is, never the text.
// The expected value follows the same rule, since it may be the secret itself.
type netJSONRedactor struct {
	secretPath bool
	authed     bool
}

func (r netJSONRedactor) text(s string) bool {
	if r.secretPath {
		return false
	}
	if !r.authed {
		return true
	}
	if _, ok := toFloat(s); ok {
		return true
	}
	return netJSONSafeWords[strings.ToLower(strings.TrimSpace(s))]
}

// expect is the expected value as a result may show it.
func (r netJSONRedactor) expect(s string) string {
	if s == "" || r.text(s) {
		return s
	}
	return netJSONHidden
}

// normalizeNetJSON cleans and judges the three fields a JSON check owns. exists
// has no expected value; gt and lt need a number to compare with.
func normalizeNetJSON(path, op, expect string) (string, string, string, error) {
	path = strings.TrimSpace(path)
	switch {
	case path == "":
		return "", "", "", errors.New("enter the path of the value to look at, such as status or db.state")
	case len([]rune(path)) > netJSONMaxPath:
		return "", "", "", fmt.Errorf("the path can be at most %d characters", netJSONMaxPath)
	}
	for _, r := range path {
		if unicode.IsControl(r) {
			return "", "", "", errors.New("the path cannot contain control characters")
		}
	}
	op = strings.ToLower(strings.TrimSpace(op))
	if !netJSONOps[op] {
		return "", "", "", errors.New("pick an operator: eq, ne, gt, lt, contains or exists")
	}
	expect = strings.TrimSpace(expect)
	if op == "exists" {
		return path, op, "", nil
	}
	if expect == "" {
		return "", "", "", errors.New("enter the value the answer should have")
	}
	if len([]rune(expect)) > netJSONMaxExpect {
		return "", "", "", fmt.Errorf("the expected value can be at most %d characters", netJSONMaxExpect)
	}
	for _, r := range expect {
		if unicode.IsControl(r) {
			return "", "", "", errors.New("the expected value cannot contain control characters")
		}
	}
	if op == "gt" || op == "lt" {
		if _, ok := toFloat(expect); !ok {
			return "", "", "", errors.New("greater than and less than compare numbers: the expected value must be a number")
		}
	}
	return path, op, expect, nil
}

// netJSONText is a found value as text for comparing: numbers without an
// exponent, null as "null", an object or list as JSON.
func netJSONText(v any) string {
	if v == nil {
		return "null"
	}
	return jsonText(v)
}

// netJSONType names the kind of a decoded JSON value.
func netJSONType(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case float64:
		return "number"
	case bool:
		return "boolean"
	case []any:
		return "list"
	case map[string]any:
		return "object"
	}
	return "value"
}

// jsonCompare judges a found value against what the check expects. gt and lt
// are only ever true for numbers (a number, or text that reads as one); eq
// matches the text of the value, or the same number written differently (42,
// 42.0); contains looks inside a string or among the entries of a list,
// ignoring case; exists is true for anything that was found.
func jsonCompare(op string, found any, expect string) bool {
	switch op {
	case "exists":
		return true
	case "eq", "ne":
		same := netJSONText(found) == expect
		if !same {
			if n, ok := found.(float64); ok {
				if e, ok := toFloat(expect); ok && n == e {
					same = true
				}
			}
		}
		return same == (op == "eq")
	case "gt", "lt":
		n, ok := toFloat(found)
		e, ok2 := toFloat(expect)
		if !ok || !ok2 {
			return false
		}
		if op == "gt" {
			return n > e
		}
		return n < e
	case "contains":
		want := strings.ToLower(expect)
		switch v := found.(type) {
		case string:
			return strings.Contains(strings.ToLower(v), want)
		case []any:
			for _, entry := range v {
				if strings.ToLower(netJSONText(entry)) == want {
					return true
				}
			}
		}
		return false
	}
	return false
}

// netJSONDisplay is what a result may show of a found value: nothing for a
// secret path, a size for an object or list, the kind and length of a string
// that may not be shown (netJSONRedactor), else the text, cut.
func netJSONDisplay(v any, r netJSONRedactor) string {
	if r.secretPath {
		return netJSONHidden
	}
	switch value := v.(type) {
	case string:
		if !r.text(value) {
			return fmt.Sprintf("string (%d chars)", len([]rune(value)))
		}
	case map[string]any:
		if len(value) == 1 {
			return "object (1 key)"
		}
		return fmt.Sprintf("object (%d keys)", len(value))
	case []any:
		if len(value) == 1 {
			return "list (1 item)"
		}
		return fmt.Sprintf("list (%d items)", len(value))
	}
	text := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, netJSONText(v))
	if r := []rune(text); len(r) > netJSONMaxValue {
		text = string(r[:netJSONMaxValue]) + "…"
	}
	return text
}

// netScrubCredential takes every secret value of a credential out of a text:
// the header values, the query values and the password. Values shorter than
// four characters are left (they would mangle ordinary words and are no secret
// worth the name).
func netScrubCredential(s string, c HealthCredential) string {
	hide := func(v string) {
		if len(v) >= 4 {
			s = strings.ReplaceAll(s, v, netJSONHidden)
		}
	}
	for _, v := range c.Headers {
		hide(v)
		// A bearer token is stored as "Bearer xyz" and may be echoed without the scheme.
		if _, rest, ok := strings.Cut(v, " "); ok {
			hide(rest)
		}
	}
	for _, v := range c.Query {
		hide(v)
	}
	hide(c.BasicPassword)
	return s
}

func netJSONSentence(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	r := []rune(s)
	r[0] = unicode.ToUpper(r[0])
	s = string(r)
	if !strings.HasSuffix(s, ".") {
		s += "."
	}
	return s
}

// runJSON makes one GET and judges one value in the JSON answer. Redirects are
// followed here, one request at a time, at most netHTTPMaxRedirects; the guard is
// asked about every hop before it is requested. The body is read to at most
// netHTTPMaxBody. Up means: a 2xx answer, valid JSON, a value at the path, and
// that value satisfies the operator. The sample's response time is the whole run.
func (h *Handlers) runJSON(ctx context.Context, g netGuard, t netTarget, bm Bookmark, c NetCheck) NetResult {
	res := netCheckResult(c, t)
	timeout := netCheckTimeout(c, netJSONDefaultTimeout)
	path, op, expect, err := normalizeNetJSON(c.Path, c.Op, c.Expect)
	if err != nil {
		res.Class, res.Error = "other", "The check cannot be run: "+err.Error()+"."
		return res
	}
	var credential HealthCredential
	haveCredential := false
	if id := strings.TrimSpace(c.CredentialID); id != "" {
		credential, haveCredential = lookupHealthCredential(id)
	} else if id := strings.TrimSpace(bm.CredentialID); id != "" {
		credential, haveCredential = lookupHealthCredential(id)
	}
	start, err := netHTTPRequestURL(bm, c, t)
	if err != nil {
		res.Class, res.Error = "other", "The check cannot be run: "+err.Error()+"."
		return res
	}
	// Whether a credential opens the first request decides how much of the
	// answer a result may show (netJSONRedactor): a credential that is not
	// sent (a check with a host of its own) opens nothing.
	redact := netJSONRedactor{
		secretPath: netJSONPathIsSecret(path),
		authed:     haveCredential && netCredentialMayGo(bm, start),
	}
	jr := &JSONResult{Path: path, Op: op, Expect: redact.expect(expect)}
	shownExpect := jr.Expect
	res.JSON = jr
	res.Port = bookmarkURLPort(Bookmark{URL: start.String()})
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	client := g.httpClient(timeout, bm.AllowInsecureTLS)
	defer client.CloseIdleConnections()

	scrub := func(s string) string {
		if haveCredential {
			s = netScrubCredential(s, credential)
		}
		return s
	}

	runStart := time.Now()
	elapsed := func() int {
		if ms := ceilMs(time.Since(runStart)); ms > 1 {
			return ms
		}
		return 1
	}
	finish := func(class, message, detail string) NetResult {
		res.Ms, jr.Ms = elapsed(), elapsed()
		res.Class, res.Error, res.Detail = class, scrub(message), scrub(detail)
		jr.Value = scrub(jr.Value)
		return res
	}
	fail := func(err error, at *url.URL) NetResult {
		// A transport error names the address it asked for, query and all;
		// netFail reads the error without it (netErrText), and finish takes
		// the credential's values out of what is left.
		res = g.netFail(ctx, res, err, timeout)
		out := res
		return finish(out.Class, out.Error, "")
	}

	cur := start
	hops := 0
	var resp *http.Response
	for {
		if hops > 0 {
			if _, err := g.resolve(runCtx, cur.Hostname()); err != nil {
				if errors.Is(err, errNetGuardBlocked) {
					if addrs := g.explainBlocked(ctx, cur.Hostname()); len(addrs) > 0 {
						res.GuardAddr = addrs[0].String()
					}
					return finish("guard", netGuardRedirectSentence, "redirect blocked")
				}
				return fail(err, cur)
			}
		}
		req, err := http.NewRequestWithContext(runCtx, http.MethodGet, cur.String(), nil)
		if err != nil {
			return finish("other", "The address of the request is not valid.", "")
		}
		req.Header.Set("User-Agent", "nextDash-NetCheck/1.0")
		req.Header.Set("Accept", "application/json")
		if haveCredential && netCredentialMayGo(bm, cur) {
			applyHealthCredential(req, credential)
		}
		resp, err = client.Do(req)
		if err != nil {
			return fail(err, cur)
		}
		status := resp.StatusCode
		loc := strings.TrimSpace(resp.Header.Get("Location"))
		if !netIsRedirect(status) || loc == "" {
			break
		}
		next, perr := cur.Parse(loc)
		drainAndCloseResponse(resp)
		hops++
		if perr != nil || (next.Scheme != "http" && next.Scheme != "https") || next.Hostname() == "" {
			return finish("http", "The server redirects somewhere this check cannot follow (not an http or https address).", "")
		}
		if hops > netHTTPMaxRedirects {
			return finish("http", fmt.Sprintf("More than %d redirects; the chain was cut off.", netHTTPMaxRedirects), "")
		}
		next.Fragment = ""
		cur = next
	}
	defer resp.Body.Close()
	jr.Status = resp.StatusCode
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		msg := fmt.Sprintf("The server answered %d; this check needs a 2xx answer.", resp.StatusCode)
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			msg += " Check the credential."
		}
		return finish("http", msg, strconv.Itoa(resp.StatusCode))
	}

	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, netHTTPMaxBody+1))
	if readErr != nil {
		return fail(readErr, cur)
	}
	jr.Size = int64(len(raw))
	if len(raw) > netHTTPMaxBody {
		jr.Size = netHTTPMaxBody
		return finish("content", "The answer is larger than 1 MB; this check reads at most 1 MB.", "answer too large")
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return finish("content", netJSONSentence(describeNonJSONAnswer(resp, raw)), "not JSON")
	}
	value, found := customWidgetLookup(doc, path)
	jr.Found = found
	if !found {
		return finish("content", "Nothing at "+path+" in the answer.", "not found")
	}
	jr.Type = netJSONType(value)
	jr.Value = netJSONDisplay(value, redact)
	res.Detail = jr.Value
	if op == "gt" || op == "lt" {
		if _, ok := toFloat(value); !ok {
			return finish("content", fmt.Sprintf("The value at %s is not a number (it is %s), so it cannot be compared.", path, jr.Type), jr.Value)
		}
	}
	if !jsonCompare(op, value, expect) {
		var msg string
		switch {
		case redact.secretPath:
			msg = "The value at " + path + " is not what the check expects."
		case op == "exists":
			msg = "Nothing at " + path + " in the answer."
		case op == "eq":
			msg = fmt.Sprintf("The value at %s is %s, but the check expects %s.", path, jr.Value, shownExpect)
		case op == "ne":
			msg = fmt.Sprintf("The value at %s is %s, which the check expects it not to be.", path, jr.Value)
		case op == "gt":
			msg = fmt.Sprintf("The value at %s is %s, but the check expects more than %s.", path, jr.Value, shownExpect)
		case op == "lt":
			msg = fmt.Sprintf("The value at %s is %s, but the check expects less than %s.", path, jr.Value, shownExpect)
		default:
			msg = fmt.Sprintf("The value at %s (%s) does not contain %s.", path, jr.Value, shownExpect)
		}
		return finish("content", msg, jr.Value)
	}
	jr.OK = true
	res.OK = true
	res.Ms, jr.Ms = elapsed(), elapsed()
	res.Detail = scrub(res.Detail)
	jr.Value = scrub(jr.Value)
	return res
}
