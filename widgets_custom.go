package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	neturl "net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
The custom widget: one escape hatch instead of a provider per service.

Every dashboard that grew a widget per service ended up maintaining one thing
per upstream release it does not control. Glance ships six service widgets and a
custom-api; Homepage ships about a hundred and sixty and felt Pi-hole v6 rewrite
its API. So this is the one that answers "my service is not in the list", and it
is deliberately the only one that talks to anything outside.

What it does is small on purpose: fetch a JSON document, pull named values out
of it by path, and show them formatted. No expression language, no arithmetic,
no templating. The moment a config can compute, the config is a second product
with its own bugs and no debugger -- and a widget only ever needs a number out
of a response, which is far less than an importer needs.

Fetching happens here rather than in the browser, for three reasons at once: the
page cannot reach a LAN service across origins, a key sent from the browser is a
key handed to every script on the page, and the address is stored rather than
sent -- so the request names a widget, and the server visits only what that
widget was already configured to visit.
*/

const (
	// customWidgetTimeout bounds one fetch. A tile is a glance; a service that
	// needs longer than this to answer a statistics endpoint is a service the
	// dashboard should say nothing about yet.
	customWidgetTimeout = 8 * time.Second
	// customWidgetMaxBody caps the document read. Statistics endpoints answer
	// in kilobytes; a megabyte is far past every real one and short of anything
	// that would hurt to hold.
	customWidgetMaxBody = 1 << 20
	// customWidgetMinTTL is the floor on how often one widget may ask. Without
	// it a dashboard left open on a wall becomes a load generator.
	customWidgetMinTTL = 30
	customWidgetMaxTTL = 24 * 60 * 60
	// customWidgetDefaultTTL is five minutes, matching what the atlas suggests:
	// long enough that a wall display costs nothing, short enough that a figure
	// is not stale by the time anyone reads it.
	customWidgetDefaultTTL = 300
	// customWidgetMaxFields bounds a tile. More than this is a report.
	customWidgetMaxFields = 8
	// customWidgetMaxItems bounds the list variant.
	customWidgetMaxItems = 20
)

// customWidgetFormats are the only ways a value may be presented. Named rather
// than free-form: a format is a choice from a list, and a list can be a dropdown.
var customWidgetFormats = map[string]bool{
	"count": true, "bytes": true, "percent": true,
	"duration": true, "relativeDate": true, "text": true,
}

// CustomWidgetValue is one figure as the tile should show it.
type CustomWidgetValue struct {
	Label string `json:"label"`
	Value string `json:"value"`
	// Raw is what was found before formatting, so a caller that wants to do
	// something else with it does not have to parse the formatted string back.
	Raw any `json:"raw,omitempty"`
	// Missing says the path found nothing. Different from a value of zero,
	// which is a fact.
	Missing bool `json:"missing,omitempty"`
}

// CustomWidgetResult is what the tile draws.
type CustomWidgetResult struct {
	Values []CustomWidgetValue `json:"values,omitempty"`
	Items  []string            `json:"items,omitempty"`
	// FetchedAt says how old this is, because a cached figure that looks live
	// is worse than a stale one that says so.
	FetchedAt int64  `json:"fetchedAt"`
	Error     string `json:"error,omitempty"`
}

/*
customWidgetCache holds one answer per widget for its own TTL.

Per widget rather than per URL: two widgets on the same endpoint may ask at
different rates, and the one that asked for thirty seconds should not be served
an hour-old answer because its neighbour asked for an hour.
*/
var customWidgetCache = struct {
	sync.Mutex
	at map[string]customWidgetEntry
}{at: map[string]customWidgetEntry{}}

type customWidgetEntry struct {
	result  CustomWidgetResult
	expires time.Time
}

func customWidgetCached(id string, now time.Time) (CustomWidgetResult, bool) {
	customWidgetCache.Lock()
	defer customWidgetCache.Unlock()
	entry, ok := customWidgetCache.at[id]
	if !ok || now.After(entry.expires) {
		return CustomWidgetResult{}, false
	}
	return entry.result, true
}

func customWidgetStore(id string, result CustomWidgetResult, ttl time.Duration, now time.Time) {
	customWidgetCache.Lock()
	defer customWidgetCache.Unlock()
	// A cache with no bound is a leak with a schedule. Widgets are few, so the
	// ceiling is generous and the sweep is only what has expired.
	if len(customWidgetCache.at) > 200 {
		for key, entry := range customWidgetCache.at {
			if now.After(entry.expires) {
				delete(customWidgetCache.at, key)
			}
		}
	}
	customWidgetCache.at[id] = customWidgetEntry{result: result, expires: now.Add(ttl)}
}

// customWidgetForget drops one widget's cached answer, so a settings change is
// visible on the next draw rather than after its TTL.
func customWidgetForget(id string) {
	customWidgetCache.Lock()
	defer customWidgetCache.Unlock()
	delete(customWidgetCache.at, id)
}

/*
customFieldSpec is one figure a widget asks for.

path is dotted, with [n] for arrays: "server.disk[0].used". Not JSONPath and not
a query language -- a path either names something or it does not.
*/
type customFieldSpec struct {
	Path   string
	Label  string
	Format string
}

// customWidgetSpec is the stored config, read into something typed.
type customWidgetSpec struct {
	URL          string
	Method       string
	CredentialID string
	TTL          int
	Fields       []customFieldSpec
	ItemsPath    string
}

var errCustomWidgetNotConfigured = errors.New("this widget has no address yet")

/*
customWidgetSpecFrom reads a widget's config into a spec.

Everything is bounded here as well as at save time: a config can also arrive by
someone editing bookmarks-N.json, and a tile that trusted the file would be a
way to make the server fetch anything on any schedule.
*/
func customWidgetSpecFrom(config map[string]any) (customWidgetSpec, error) {
	spec := customWidgetSpec{Method: http.MethodGet, TTL: customWidgetDefaultTTL}

	rawURL, _ := config["url"].(string)
	spec.URL = strings.TrimSpace(rawURL)
	if spec.URL == "" {
		return customWidgetSpec{}, errCustomWidgetNotConfigured
	}
	parsed, err := neturl.Parse(spec.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return customWidgetSpec{}, errors.New("the address must be http or https")
	}

	if method, ok := config["method"].(string); ok {
		// GET and POST only. Anything else is asking a dashboard tile to change
		// something, which is not what a tile is for.
		if strings.EqualFold(strings.TrimSpace(method), http.MethodPost) {
			spec.Method = http.MethodPost
		}
	}
	if id, ok := config["credentialId"].(string); ok {
		spec.CredentialID = normalizeCredentialID(id)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok {
		spec.TTL = clampInt(ttl, customWidgetMinTTL, customWidgetMaxTTL)
	}
	if items, ok := config["itemsPath"].(string); ok {
		spec.ItemsPath = trimToLength(strings.TrimSpace(items), 200)
	}

	rawFields, _ := config["fields"].([]any)
	for _, raw := range rawFields {
		if len(spec.Fields) >= customWidgetMaxFields {
			break
		}
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		path := trimToLength(strings.TrimSpace(stringOr(entry["path"])), 200)
		if path == "" {
			continue
		}
		format := strings.TrimSpace(stringOr(entry["format"]))
		if !customWidgetFormats[format] {
			format = "text"
		}
		spec.Fields = append(spec.Fields, customFieldSpec{
			Path:   path,
			Label:  trimToLength(strings.TrimSpace(stringOr(entry["label"])), 60),
			Format: format,
		})
	}

	if len(spec.Fields) == 0 && spec.ItemsPath == "" {
		return customWidgetSpec{}, errors.New("this widget has nothing to show yet")
	}
	return spec, nil
}

func stringOr(raw any) string {
	if text, ok := raw.(string); ok {
		return text
	}
	return ""
}

func clampInt(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

/*
customWidgetLookup walks a dotted path with [n] indexes.

Deliberately not a query language. "server.disk[0].used" either names something
or it does not, and "does not" is an answer the tile can show -- a path that
silently matched several things would make a wrong figure look right.
*/
func customWidgetLookup(document any, path string) (any, bool) {
	current := document
	for _, segment := range strings.Split(path, ".") {
		segment = strings.TrimSpace(segment)
		if segment == "" {
			continue
		}
		name := segment
		var indexes []int
		if open := strings.Index(segment, "["); open >= 0 {
			name = segment[:open]
			rest := segment[open:]
			for len(rest) > 0 {
				closeAt := strings.Index(rest, "]")
				if closeAt <= 1 || rest[0] != '[' {
					return nil, false
				}
				index, err := strconv.Atoi(rest[1:closeAt])
				if err != nil || index < 0 {
					return nil, false
				}
				indexes = append(indexes, index)
				rest = rest[closeAt+1:]
			}
		}
		if name != "" {
			object, ok := current.(map[string]any)
			if !ok {
				return nil, false
			}
			current, ok = object[name]
			if !ok {
				return nil, false
			}
		}
		for _, index := range indexes {
			list, ok := current.([]any)
			if !ok || index >= len(list) {
				return nil, false
			}
			current = list[index]
		}
	}
	return current, true
}

/*
formatCustomValue turns what was found into what is shown.

Six formats, no more. Each answers a question a service's numbers actually
raise: how many, how large, how full, how long, how long ago, and what does it
say.
*/
func formatCustomValue(raw any, format string) string {
	switch format {
	case "count":
		if number, ok := toFloat(raw); ok {
			return formatThousands(int64(number))
		}
	case "bytes":
		if number, ok := toFloat(raw); ok {
			return formatByteSize(number)
		}
	case "percent":
		if number, ok := toFloat(raw); ok {
			// A ratio and a percentage both turn up in the wild, and 0..1 is
			// unambiguous enough: no service reports 0.4% as 0.004.
			if number > 0 && number <= 1 {
				number *= 100
			}
			return strconv.FormatFloat(number, 'f', -1, 64) + "%"
		}
	case "duration":
		if number, ok := toFloat(raw); ok {
			return formatDurationSeconds(int64(number))
		}
	case "relativeDate":
		if when, ok := toTime(raw); ok {
			return formatRelativeSince(when, time.Now())
		}
	}
	return trimToLength(fmt.Sprint(raw), 120)
}

func toFloat(raw any) (float64, bool) {
	switch value := raw.(type) {
	case float64:
		return value, true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		return parsed, err == nil
	}
	return 0, false
}

/*
toTime reads the shapes a date arrives in.

Unix seconds and milliseconds are told apart by magnitude rather than by asking:
anything past the year 3000 in seconds is milliseconds, and no service reports a
date in the year 33658.
*/
func toTime(raw any) (time.Time, bool) {
	if text, ok := raw.(string); ok {
		for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
			if when, err := time.Parse(layout, strings.TrimSpace(text)); err == nil {
				return when, true
			}
		}
		return time.Time{}, false
	}
	number, ok := toFloat(raw)
	if !ok || number <= 0 {
		return time.Time{}, false
	}
	if number > 32503680000 {
		return time.UnixMilli(int64(number)), true
	}
	return time.Unix(int64(number), 0), true
}

func formatThousands(value int64) string {
	text := strconv.FormatInt(value, 10)
	negative := strings.HasPrefix(text, "-")
	text = strings.TrimPrefix(text, "-")
	var parts []string
	for len(text) > 3 {
		parts = append([]string{text[len(text)-3:]}, parts...)
		text = text[:len(text)-3]
	}
	parts = append([]string{text}, parts...)
	out := strings.Join(parts, " ")
	if negative {
		return "-" + out
	}
	return out
}

func formatByteSize(value float64) string {
	units := []string{"B", "KB", "MB", "GB", "TB", "PB"}
	index := 0
	for value >= 1024 && index < len(units)-1 {
		value /= 1024
		index++
	}
	if index == 0 {
		return strconv.FormatInt(int64(value), 10) + " B"
	}
	return strconv.FormatFloat(math.Round(value*10)/10, 'f', -1, 64) + " " + units[index]
}

func formatDurationSeconds(seconds int64) string {
	if seconds < 0 {
		seconds = -seconds
	}
	switch {
	case seconds < 60:
		return strconv.FormatInt(seconds, 10) + "s"
	case seconds < 3600:
		return strconv.FormatInt(seconds/60, 10) + "m"
	case seconds < 86400:
		return strconv.FormatInt(seconds/3600, 10) + "h"
	}
	return strconv.FormatInt(seconds/86400, 10) + "d"
}

func formatRelativeSince(when, now time.Time) string {
	delta := now.Sub(when)
	if delta < 0 {
		delta = -delta
	}
	return formatDurationSeconds(int64(delta.Seconds()))
}

/*
describeNonJSONAnswer says what arrived instead of JSON.

"that answer is not JSON" is true and useless. The common cause is an address
that names a host and no path: a service's web interface answers the root with
its own front page, 200 and HTML, so the widget is looking at a login screen
rather than at an API. Left unsaid, that failure is indistinguishable from a
wrong credential or a service that has changed its format, and the reader has
three things to check instead of one.

The body is looked at as well as the header, because a great many services
label a page text/plain or nothing at all.
*/
func describeNonJSONAnswer(resp *http.Response, raw []byte) string {
	body := strings.TrimSpace(string(raw))
	if body == "" {
		return "that address answered with nothing"
	}
	mediaType := ""
	if resp != nil {
		mediaType, _, _ = mime.ParseMediaType(resp.Header.Get("Content-Type"))
	}
	looksLikeAPage := strings.EqualFold(mediaType, "text/html") ||
		strings.HasPrefix(body, "<!") || strings.HasPrefix(body, "<html") ||
		strings.HasPrefix(body, "<HTML")
	if looksLikeAPage {
		return "that address answered with a web page, not JSON — check the path"
	}
	if mediaType != "" && !strings.Contains(mediaType, "json") {
		return fmt.Sprintf("that address answered with %s, not JSON", mediaType)
	}
	return "that answer is not JSON"
}

/*
fetchCustomWidget asks one service and turns its answer into figures.

Through outboundHTTPClient, which checks the address at dial time, validates
redirects and rate-limits globally -- the same client every other outbound
request uses. A widget pointed at a LAN service therefore works exactly when
"Allow local bookmarks" is on, and not otherwise: one setting governs where this
install may reach, rather than this feature inventing a second answer.
*/
func (h *Handlers) fetchCustomWidget(ctx context.Context, spec customWidgetSpec) CustomWidgetResult {
	now := time.Now()
	result := CustomWidgetResult{FetchedAt: now.UnixMilli()}

	if err := validateHTTPURL(spec.URL, h.allowLocalBookmarks()); err != nil {
		// Named plainly: this is the one failure a reader can act on, and
		// "address is not allowed" sends them to the setting that allows it.
		result.Error = "that address is not allowed"
		return result
	}

	ctx, cancel := context.WithTimeout(ctx, customWidgetTimeout)
	defer cancel()

	var body io.Reader
	if spec.Method == http.MethodPost {
		body = strings.NewReader("")
	}
	req, err := http.NewRequestWithContext(ctx, spec.Method, spec.URL, body)
	if err != nil {
		result.Error = "that address cannot be requested"
		return result
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "nextDash Widget/1.0")
	var credential HealthCredential
	if spec.CredentialID != "" {
		// The same store the health checks use: kept in its own file, 0600, and
		// never handed back to a browser. The widget names one; it never holds
		// one.
		if found, ok := lookupHealthCredential(spec.CredentialID); ok {
			credential = found
			applyHealthCredential(req, credential)
		}
	}

	client := h.outboundHTTPClient(customWidgetTimeout, 3)
	// And the same rule a health check follows: a secret stored for one host
	// does not travel to another because that host answered with a redirect.
	client.CheckRedirect = credentialRedirectCheck(credential, client.CheckRedirect)
	resp, err := client.Do(req)
	if err != nil {
		result.Error = "no answer from that address"
		return result
	}
	defer drainAndCloseResponse(resp)

	if resp.StatusCode >= 400 {
		result.Error = fmt.Sprintf("the service answered %d", resp.StatusCode)
		return result
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, customWidgetMaxBody))
	if err != nil {
		result.Error = "the answer could not be read"
		return result
	}
	var document any
	if err := json.Unmarshal(raw, &document); err != nil {
		result.Error = describeNonJSONAnswer(resp, raw)
		return result
	}

	for _, field := range spec.Fields {
		value := CustomWidgetValue{Label: field.Label}
		if value.Label == "" {
			value.Label = field.Path
		}
		found, ok := customWidgetLookup(document, field.Path)
		if !ok {
			// Said rather than hidden: a path that stopped matching after an
			// upstream change is the thing worth knowing, and a blank row looks
			// like a zero.
			value.Missing = true
			value.Value = "—"
		} else {
			value.Raw = found
			value.Value = formatCustomValue(found, field.Format)
		}
		result.Values = append(result.Values, value)
	}

	if spec.ItemsPath != "" {
		if found, ok := customWidgetLookup(document, spec.ItemsPath); ok {
			if list, isList := found.([]any); isList {
				for _, item := range list {
					if len(result.Items) >= customWidgetMaxItems {
						break
					}
					result.Items = append(result.Items, trimToLength(fmt.Sprint(item), 200))
				}
			}
		}
	}
	return result
}

/*
CustomWidgetHandler answers GET /api/widgets/custom?pageId=&id=.

Takes a widget id rather than a URL. That is the whole safety story: the address
comes from what this install stored, so the route cannot be talked into fetching
something by asking. A caller can only make the server visit what a widget on
one of their own pages was already configured to visit.
*/
func (h *Handlers) CustomWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	pageID, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("pageId")))
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}
	widgetID := strings.TrimSpace(r.URL.Query().Get("id"))
	if widgetID == "" {
		http.Error(w, "Missing widget id", http.StatusBadRequest)
		return
	}

	widgets, _ := h.store.GetPageBlocks(pageID)
	var found *Widget
	for i := range widgets {
		if widgets[i].ID == widgetID && widgets[i].Type == WidgetTypeCustom {
			found = &widgets[i]
			break
		}
	}
	if found == nil {
		http.Error(w, "No such widget", http.StatusNotFound)
		return
	}

	spec, err := customWidgetSpecFrom(found.Config)
	if err != nil {
		// A half-configured widget is not an error to shout about: it is a
		// widget someone has not finished, and the tile says so.
		_ = json.NewEncoder(w).Encode(CustomWidgetResult{
			FetchedAt: time.Now().UnixMilli(),
			Error:     err.Error(),
		})
		return
	}

	now := time.Now()
	cacheKey := strconv.Itoa(pageID) + ":" + widgetID
	/*
	 * refresh=1 is the one parameter here that costs a request at somebody
	 * else's service, with this install's stored credential on it -- it skips
	 * the cache, including the short TTL a failure gets so that an open
	 * dashboard cannot become a retry loop against a service that is down.
	 *
	 * So it is behind the token, while the ordinary read is not. Whoever is
	 * pressing refresh is the reader in front of the config screen; everything
	 * else drawing the tile is content with the answer the cache already has.
	 */
	forced := r.URL.Query().Get("refresh") == "1"
	if forced && !h.requireWriteAccess(w, r) {
		return
	}
	if cached, ok := customWidgetCached(cacheKey, now); ok && !forced {
		_ = json.NewEncoder(w).Encode(cached)
		return
	}

	result := h.fetchCustomWidget(r.Context(), spec)
	// A failure is cached for a short while too, so a service that is down does
	// not turn an open dashboard into a retry loop against it.
	ttl := time.Duration(spec.TTL) * time.Second
	if result.Error != "" {
		ttl = time.Duration(customWidgetMinTTL) * time.Second
	}
	customWidgetStore(cacheKey, result, ttl, now)
	_ = json.NewEncoder(w).Encode(result)
}
