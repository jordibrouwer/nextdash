package app

import (
	"bytes"
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
	"unicode/utf8"
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
	"duration": true, "ms": true, "relativeDate": true, "text": true,
	"rate": true, "data": true,
}

/*
customWidgetDataUnits are the units a service may already have counted in.

The Size format assumes bytes, which is right for most services and silently
wrong for the ones that do the arithmetic themselves: SABnzbd reports mbleft as
"0.00" meaning megabytes and diskspace1 as "3342.67" meaning gigabytes, and read
as bytes those become "0 B" and "3.3 KB" -- figures that are wrong by three and
six orders of magnitude while looking perfectly reasonable.

So Data asks which unit the number is already in, and scales from there.
*/
var customWidgetDataUnits = map[string]float64{
	"b":  1,
	"kb": 1024,
	"mb": 1024 * 1024,
	"gb": 1024 * 1024 * 1024,
	"tb": 1024 * 1024 * 1024 * 1024,
}

/*
customWidgetShapes are the ways a figure may be drawn, as opposed to written.

A tile of figures all the same size is a list of numbers the reader has to
weigh themselves; the shape is what says which one they came for. Four, because
the useful distinctions are "the one that matters", "the rest", "context for
the rest", and "a proportion", and a fifth would be a preference rather than a
difference.

meter is not offered for every format. It draws a share of a whole, and only a
percentage carries its own whole -- 1 049 808 blocked is not a proportion of
anything this widget is allowed to work out, since working it out is the
expression language this deliberately does not have.
*/
var customWidgetShapes = map[string]bool{
	"large": true, "normal": true, "small": true, "meter": true,
}

/*
customWidgetTones say which way a meter reads.

The same bar means opposite things on two tiles: ninety per cent of a disk is
bad news and ninety per cent of queries answered from cache is good. Nothing in
the number says which, so the widget is told rather than left to guess.

The colours themselves are never chosen here -- the browser paints them from
the theme's own tokens, which every one of the themes defines. A widget that
picked a green would be a widget that looks wrong on the themes whose palette
has no room for it.
*/
var customWidgetTones = map[string]bool{
	"good": true, "bad": true, "neutral": true,
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
	// Shape and Tone are how to draw it. Empty means the tile decides, which is
	// what every widget saved before these existed says.
	Shape string `json:"shape,omitempty"`
	Tone  string `json:"tone,omitempty"`
	// Share is the meter's fill, 0..1, and is set only for a meter. Computed
	// here because the browser would otherwise have to parse "42%" back out of
	// the string this already formatted.
	Share float64 `json:"share,omitempty"`
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
	// Shape is how the figure is drawn; Tone which way a meter reads. Both are
	// presentation, and both are optional: a field that says neither is drawn
	// the way every figure was drawn before there were shapes.
	Shape string
	Tone  string
	/*
	 * Decimals is how many places to round a figure to, and it is a pointer so
	 * that "not set" survives being read back.
	 *
	 * Zero decimals is a real choice -- a queue of 3.7 items is better read as
	 * 4 than as 3.7 -- and it is also what an int field holds when nobody chose
	 * anything, so the two would be indistinguishable. Every widget saved
	 * before this exists says nothing here and keeps the rounding its format
	 * always did.
	 */
	Decimals *int
	// DataUnit is which unit a Data figure is already counted in. Empty means
	// bytes, which is what every other size in this file assumes.
	DataUnit string
}

/*
decimalsFrom reads a chosen number of decimal places, or nothing.

Bounded at six, which is past anything a tile has room for and well past what a
service reports honestly -- the point is that a stored config cannot ask the
formatter for four hundred digits. Anything that is not a number in range is
read as "not set", so a hand-edited file with nonsense in it falls back to what
the format always did rather than failing the whole widget.
*/
func decimalsFrom(raw any) *int {
	number, ok := toFloat(raw)
	if !ok {
		return nil
	}
	places := int(math.Round(number))
	if places < 0 || places > 6 {
		return nil
	}
	return &places
}

/*
dataUnitFrom reads which unit a Data figure counts in, defaulting to bytes.

Anything unrecognised reads as bytes rather than failing the widget: a
hand-edited config with nonsense in it should draw the figure the way it was
drawn before Data existed, not take the tile down.
*/
func dataUnitFrom(raw any) string {
	unit := strings.ToLower(strings.TrimSpace(stringOr(raw)))
	if _, ok := customWidgetDataUnits[unit]; ok {
		return unit
	}
	return "b"
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
		shape := strings.TrimSpace(stringOr(entry["shape"]))
		if !customWidgetShapes[shape] {
			shape = ""
		}
		// A meter over anything but a percentage would be a bar drawn against a
		// whole nobody stated, so the shape is dropped rather than honoured and
		// the figure is written out as it always was.
		if shape == "meter" && format != "percent" {
			shape = ""
		}
		tone := strings.TrimSpace(stringOr(entry["tone"]))
		if !customWidgetTones[tone] {
			tone = ""
		}
		spec.Fields = append(spec.Fields, customFieldSpec{
			Path:     path,
			Label:    trimToLength(strings.TrimSpace(stringOr(entry["label"])), 60),
			Format:   format,
			Shape:    shape,
			Tone:     tone,
			Decimals: decimalsFrom(entry["decimals"]),
			DataUnit: dataUnitFrom(entry["dataUnit"]),
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

Seven formats, no more. Each answers a question a service's numbers actually
raise: how many, how large, how full, how long, how fast, how long ago, and
what does it say.
*/
func formatCustomValue(raw any, format string, decimals *int, dataUnit string) string {
	unit := customWidgetDataUnits[dataUnit]
	if unit == 0 {
		unit = 1
	}
	// A chosen number of places answers the whole question and answers it the
	// same way for every format: the reader asked for two decimals, not for two
	// decimals of whatever this format would otherwise have done. Units stay,
	// because "3342.65" and "3342.65 MB" are not the same figure.
	if decimals != nil {
		if number, ok := toFloat(raw); ok {
			if format == "data" {
				number *= unit
			}
			scaled, suffix := scaleForFormat(number, format)
			return roundToDecimals(scaled, *decimals) + suffix
		}
	}
	switch format {
	case "count":
		if number, ok := toFloat(raw); ok {
			// Rounded, not truncated: a service reporting 9.99 items means ten
			// of something, and showing "9" is a wrong figure rather than a
			// rounded one.
			return formatThousands(int64(math.Round(number)))
		}
	case "bytes":
		if number, ok := toFloat(raw); ok {
			return formatByteSize(number)
		}
	case "rate":
		if number, ok := toFloat(raw); ok {
			return formatBitRate(number)
		}
	case "data":
		if number, ok := toFloat(raw); ok {
			return formatByteSize(number * unit)
		}
	case "percent":
		if number, ok := toFloat(raw); ok {
			// A ratio and a percentage both turn up in the wild, and 0..1 is
			// unambiguous enough: no service reports 0.4% as 0.004.
			if number > 0 && number <= 1 {
				number *= 100
			}
			// One decimal, and never a trailing ".0". Printing every digit the
			// float carried showed "43.729183739999996%" on a tile the size of
			// a stamp: the scaling above turns a clean ratio into a value no
			// shortest-representation format can tidy up again.
			return trimTrailingZeroDecimal(strconv.FormatFloat(number, 'f', 1, 64)) + "%"
		}
	case "duration":
		if number, ok := toFloat(raw); ok {
			return formatDurationSeconds(int64(number))
		}
	case "ms":
		if number, ok := toFloat(raw); ok {
			// Seconds in, milliseconds out. A service that answers in seconds
			// reports a response time as 0.0051589999999999995, and a tile the
			// size of a stamp has no room for a float's full tail — nor any use
			// for it, since nobody reads a response time past the millisecond.
			return formatThousands(int64(math.Round(number * 1000)))
		}
	case "relativeDate":
		if when, ok := toTime(raw); ok {
			return formatRelativeSince(when, time.Now())
		}
	}
	return trimToLength(fmt.Sprint(raw), 120)
}

/*
meterShare turns a percentage into a bar's fill, 0..1.

The same ratio-or-percentage reading the percent format uses, for the same
reason: both turn up in the wild and 0..1 is unambiguous enough. Clamped at
both ends, because a service reporting 104% of a quota is reporting something
true and a bar wider than its track is not a way to say it.
*/
func meterShare(number float64) float64 {
	if number > 0 && number <= 1 {
		number *= 100
	}
	return math.Max(0, math.Min(1, number/100))
}

// trimTrailingZeroDecimal drops a ".0" tail so a whole percentage reads as
// "50%" rather than "50.0%", while 43.7% keeps its digit.
func trimTrailingZeroDecimal(text string) string {
	return strings.TrimSuffix(text, ".0")
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

/*
roundToDecimals writes a number to exactly the places that were asked for.

Trailing zeroes are kept -- two decimals means "0.00", not "0" -- because a
figure that changes width as its digits land reads as the value jumping about.
That is also the answer to the request that started this: SABnzbd reports
mbleft as the string "0.00", and a reader who picks two decimals is asking to
go on seeing exactly that.
*/
func roundToDecimals(value float64, places int) string {
	if places < 0 {
		places = 0
	}
	return strconv.FormatFloat(value, 'f', places, 64)
}

/*
scaleForFormat brings a number into the units its format shows it in, and says
which those are.

Rounding is a question about digits, not about what the figure is -- so a Size
asked for two decimals is still a size, and the number has to be brought down to
the scale its unit names before the decimals mean anything. Appending "MB" to an
unscaled byte count was the first attempt and produced "130760634.00 MB", which
is wrong by a factor of a million and reads as authoritative.

The steps match each format's own formatter exactly: 1024 for a size, 1000 for a
rate, because that is the difference between how storage and connections are
sold.
*/
func scaleForFormat(value float64, format string) (float64, string) {
	switch format {
	case "bytes", "data":
		units := []string{" B", " KB", " MB", " GB", " TB", " PB"}
		index := 0
		for math.Abs(value) >= 1024 && index < len(units)-1 {
			value /= 1024
			index++
		}
		return value, units[index]
	case "rate":
		units := []string{" bps", " Kbps", " Mbps", " Gbps", " Tbps"}
		index := 0
		for math.Abs(value) >= 1000 && index < len(units)-1 {
			value /= 1000
			index++
		}
		return value, units[index]
	case "percent":
		// The same reading the percent format makes: a ratio and a percentage
		// both turn up, and 0..1 is unambiguous enough.
		if value > 0 && value <= 1 {
			value *= 100
		}
		return value, "%"
	case "ms":
		// Seconds in, milliseconds out, as the ms format does.
		return value * 1000, ""
	}
	// count, duration, relativeDate and text carry no unit of their own.
	return value, ""
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

/*
formatBitRate shows a line speed the way a line speed is sold.

Bits, not bytes, and steps of 1000 rather than 1024 -- both because this format
exists to be held against a number somebody else quoted. A gigabit connection
reports 1046085072, and the reader wants to see the "1.05 Gbps" their contract
promises; dividing by 1024 and calling it MB gives 124.703, which is the same
measurement expressed so differently that the two cannot be compared at a
glance. That is a correct number answering a question nobody asked.

Three decimals, because a connection is compared against itself: this week's
1.046 and last week's 1.038 are a real difference, and one decimal rounds both
to 1.0. Trailing zeroes are kept so the figure does not change width as the
digits land.
*/
func formatBitRate(value float64) string {
	units := []string{"bps", "Kbps", "Mbps", "Gbps", "Tbps"}
	index := 0
	for value >= 1000 && index < len(units)-1 {
		value /= 1000
		index++
	}
	if index == 0 {
		// Under a kilobit there is nothing to scale, and three decimals would
		// be noise on a number that is already whole.
		return strconv.FormatInt(int64(value), 10) + " bps"
	}
	return strconv.FormatFloat(value, 'f', 3, 64) + " " + units[index]
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
customWidgetAnswer is what one service said, before anything is made of it.

Split out of fetchCustomWidget because two callers now want the same request
made in exactly the same way and disagree only about what to keep afterwards:
the tile wants the figures, and the test panel wants the document itself --
since a path can only be written by somebody who can see what they are writing
it into.
*/
type customWidgetAnswer struct {
	Status      int
	ContentType string
	// Body is what arrived, capped like every read here.
	Body []byte
	// Document is Body decoded. Nil whenever Error says why it is not.
	Document any
	Took     time.Duration
	// Error is the sentence the tile would show, or empty.
	Error string
	// SignedIn says whether a stored credential went out with the request.
	// Never which one and never its value: the point is only to tell "401
	// because nothing was sent" from "401 because what was sent was wrong".
	SignedIn bool
}

/*
askCustomWidget makes the one request a widget describes.

Through outboundHTTPClient, which checks the address at dial time, validates
redirects and rate-limits globally -- the same client every other outbound
request uses. A widget pointed at a LAN service therefore works exactly when
"Allow local bookmarks" is on, and not otherwise: one setting governs where this
install may reach, rather than this feature inventing a second answer.
*/
func (h *Handlers) askCustomWidget(ctx context.Context, spec customWidgetSpec) customWidgetAnswer {
	started := time.Now()
	answer := customWidgetAnswer{}
	since := func() customWidgetAnswer {
		answer.Took = time.Since(started)
		return answer
	}

	if err := validateHTTPURL(spec.URL, h.allowLocalBookmarks()); err != nil {
		// Named plainly: this is the one failure a reader can act on, and
		// "address is not allowed" sends them to the setting that allows it.
		answer.Error = "that address is not allowed"
		return since()
	}

	ctx, cancel := context.WithTimeout(ctx, customWidgetTimeout)
	defer cancel()

	var body io.Reader
	if spec.Method == http.MethodPost {
		body = strings.NewReader("")
	}
	req, err := http.NewRequestWithContext(ctx, spec.Method, spec.URL, body)
	if err != nil {
		answer.Error = "that address cannot be requested"
		return since()
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
			answer.SignedIn = true
		}
	}

	client := h.outboundHTTPClient(customWidgetTimeout, 3)
	// And the same rule a health check follows: a secret stored for one host
	// does not travel to another because that host answered with a redirect.
	client.CheckRedirect = credentialRedirectCheck(credential, client.CheckRedirect)
	resp, err := client.Do(req)
	if err != nil {
		answer.Error = "no answer from that address"
		logWarn(logComponentWidgets, "%s could not be reached; the tile will show what it has: %v", hostOf(spec.URL), err)
		return since()
	}
	defer drainAndCloseResponse(resp)

	answer.Status = resp.StatusCode
	answer.ContentType = strings.TrimSpace(resp.Header.Get("Content-Type"))
	logDebug(logComponentWidgets, "%s answered %d", hostOf(spec.URL), resp.StatusCode)

	// Read before the status is judged, unlike before. A service explaining a
	// 401 or a 404 in its body is explaining exactly what the reader pressing
	// Test needs to read, and the tile throws it away only because a tile has
	// nowhere to put it.
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, customWidgetMaxBody))
	answer.Body = raw

	if resp.StatusCode >= 400 {
		answer.Error = fmt.Sprintf("the service answered %d", resp.StatusCode)
		logWarn(logComponentWidgets, "%s answered %d; the tile will show what it has", hostOf(spec.URL), resp.StatusCode)
		return since()
	}
	if readErr != nil {
		answer.Error = "the answer could not be read"
		return since()
	}
	var document any
	if err := json.Unmarshal(raw, &document); err != nil {
		answer.Error = describeNonJSONAnswer(resp, raw)
		return since()
	}
	answer.Document = document
	return since()
}

/*
customWidgetFigures reads the figures a widget asked for out of one answer.

Separate from the asking so that the test panel can show both halves of a
disappointing tile at once: what the service actually said, and what these paths
made of it. A path that found nothing is far easier to fix beside the document
it missed.
*/
func customWidgetFigures(answer customWidgetAnswer, spec customWidgetSpec, fetchedAt time.Time) CustomWidgetResult {
	result := CustomWidgetResult{FetchedAt: fetchedAt.UnixMilli()}
	if answer.Error != "" {
		result.Error = answer.Error
		return result
	}

	for _, field := range spec.Fields {
		value := CustomWidgetValue{Label: field.Label}
		if value.Label == "" {
			value.Label = field.Path
		}
		found, ok := customWidgetLookup(answer.Document, field.Path)
		if !ok {
			// Said rather than hidden: a path that stopped matching after an
			// upstream change is the thing worth knowing, and a blank row looks
			// like a zero.
			value.Missing = true
			value.Value = "—"
		} else {
			value.Raw = found
			value.Value = formatCustomValue(found, field.Format, field.Decimals, field.DataUnit)
		}
		value.Shape = field.Shape
		value.Tone = field.Tone
		// A meter needs its fill as a number, and only the percent format has
		// one to give. A missing value keeps its shape but fills nothing: an
		// empty track says "no answer" where a full one would say zero.
		if field.Shape == "meter" && !value.Missing {
			if number, ok := toFloat(found); ok {
				value.Share = meterShare(number)
			}
		}
		result.Values = append(result.Values, value)
	}

	if spec.ItemsPath != "" {
		if found, ok := customWidgetLookup(answer.Document, spec.ItemsPath); ok {
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

// fetchCustomWidget asks one service and turns its answer into figures.
func (h *Handlers) fetchCustomWidget(ctx context.Context, spec customWidgetSpec) CustomWidgetResult {
	now := time.Now()
	return customWidgetFigures(h.askCustomWidget(ctx, spec), spec, now)
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

// customWidgetShownBody caps what a test hands back to the panel. A tile reads
// a figure or two out of a document; a reader writing the paths needs to see
// the document, and sixteen kilobytes is a great deal of JSON to read while
// being far short of what a megabyte would do to the page drawing it.
const customWidgetShownBody = 16 << 10

/*
CustomWidgetTest is one trial run, as the config panel shows it.

Both halves at once, deliberately: what the service actually said, and what the
widget's paths made of it. Either alone is the failure this is for -- figures
that all read "—" say nothing about why, and a document with no figures beside
it leaves the reader checking their paths by eye.
*/
type CustomWidgetTest struct {
	Method string `json:"method"`
	// Host rather than the address. The panel already holds the address the
	// reader typed; echoing it back adds nothing, and a URL with a key in its
	// query string is not a thing to copy into more places than it is in.
	Host        string `json:"host,omitempty"`
	Status      int    `json:"status,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	TookMS      int64  `json:"tookMs"`
	// Bytes is what arrived, which is not always what Body shows.
	Bytes int `json:"bytes"`
	// Body is the document, indented when it is JSON so a reader can follow it
	// -- most services answer on one line, and one line is not readable.
	Body      string `json:"body,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	JSON      bool   `json:"json"`
	// SignedIn says a stored credential went out with the request, so a 401
	// can be read as "the key is wrong" rather than "was a key sent at all".
	SignedIn  bool               `json:"signedIn,omitempty"`
	Result    CustomWidgetResult `json:"result"`
	FetchedAt int64              `json:"fetchedAt"`
	Error     string             `json:"error,omitempty"`
}

/*
customWidgetTestBody is what the panel shows of an answer.

Indented when it parsed, because a service answering on a single 4 kB line is
answering in something no one can read a path out of. Cut rather than refused
when it is long: the beginning of a document is enough to find the names in,
and the panel says it was cut.
*/
func customWidgetTestBody(answer customWidgetAnswer) (string, bool) {
	raw := answer.Body
	/*
	 * Indented from the text rather than re-encoded from the document, and
	 * tried whatever the status was.
	 *
	 * Re-encoding would sort the keys, and a reader is looking for a name in
	 * the order the service wrote it. And a 401 explaining itself in JSON is
	 * the answer most worth reading here, even though nothing parsed it: the
	 * document is only decoded on a status the tile would have used.
	 */
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, raw, "", "  "); err == nil {
		raw = pretty.Bytes()
	}
	if len(raw) > customWidgetShownBody {
		cut := raw[:customWidgetShownBody]
		// Not through the middle of a character: a cut that lands inside a
		// multi-byte rune ends the panel's document with a replacement mark,
		// which reads as something the service sent.
		for len(cut) > 0 {
			last, size := utf8.DecodeLastRune(cut)
			if last != utf8.RuneError || size > 1 {
				break
			}
			cut = cut[:len(cut)-1]
		}
		return string(cut), true
	}
	return string(raw), false
}

/*
CustomWidgetTestHandler answers POST /api/widgets/custom/test.

Takes a config rather than a widget id, which is the one place this differs
from the tile's own route -- and it can, because it is behind the write token.
Whoever holds that can store this exact config on a widget and press refresh on
it, so accepting it here reaches nothing that was not already reachable; it
only saves them saving a widget they are still in the middle of writing, which
is precisely when a test is worth having.

Everything else is unchanged: the same sanitiser that runs at save time, the
same spec, the same client with the same address checks, and nothing written to
the cache -- a draft that was never saved must not become what the tile draws.
*/
func (h *Handlers) CustomWidgetTestHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}

	var config map[string]any
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&config); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	now := time.Now()
	spec, err := customWidgetSpecFrom(sanitizeWidgetConfig(WidgetTypeCustom, config))
	if err != nil {
		// A half-written widget is not an error to shout about: it is the
		// state every widget passes through, and the panel says what is
		// missing rather than the request failing.
		_ = json.NewEncoder(w).Encode(CustomWidgetTest{
			FetchedAt: now.UnixMilli(),
			Error:     err.Error(),
		})
		return
	}

	answer := h.askCustomWidget(r.Context(), spec)
	body, truncated := customWidgetTestBody(answer)
	_ = json.NewEncoder(w).Encode(CustomWidgetTest{
		Method:      spec.Method,
		Host:        hostOf(spec.URL),
		Status:      answer.Status,
		ContentType: answer.ContentType,
		TookMS:      answer.Took.Milliseconds(),
		Bytes:       len(answer.Body),
		Body:        body,
		Truncated:   truncated,
		JSON:        answer.Document != nil,
		SignedIn:    answer.SignedIn,
		Result:      customWidgetFigures(answer, spec, now),
		FetchedAt:   now.UnixMilli(),
		Error:       answer.Error,
	})
}
