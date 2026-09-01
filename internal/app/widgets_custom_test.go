package app

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

/*
A path either names something or it does not.

Deliberately not a query language: one that silently matched several things
would make a wrong figure look right, and a tile has no room to say which of
three matches it drew.
*/
func TestCustomWidgetPathWalking(t *testing.T) {
	var document any
	if err := json.Unmarshal([]byte(`{
		"photos": 4210,
		"server": {"disk": [{"used": 91, "label": "ssd"}, {"used": 12}]},
		"empty": null
	}`), &document); err != nil {
		t.Fatal(err)
	}

	for path, want := range map[string]any{
		"photos":               float64(4210),
		"server.disk[0].used":  float64(91),
		"server.disk[1].used":  float64(12),
		"server.disk[0].label": "ssd",
	} {
		got, ok := customWidgetLookup(document, path)
		if !ok || got != want {
			t.Errorf("%s = %v (%v), want %v", path, got, ok, want)
		}
	}

	// Not found is an answer, and one the tile shows rather than hides.
	for _, path := range []string{"missing", "server.disk[9].used", "photos.nested", "server.disk[x]"} {
		if _, ok := customWidgetLookup(document, path); ok {
			t.Errorf("%s reported a value it does not have", path)
		}
	}
}

// Eight formats, each answering a question a service's numbers actually raise.
func TestCustomWidgetFormatting(t *testing.T) {
	cases := []struct {
		raw          any
		format, want string
	}{
		{float64(4210), "count", "4 210"},
		{float64(1536), "bytes", "1.5 KB"},
		{float64(0.42), "percent", "42%"},
		{float64(87), "percent", "87%"},
		{float64(3600), "duration", "1h"},
		{float64(90), "duration", "1m"},
		// Seconds in, whole milliseconds out — AdGuard reports 0.0051589999999999995.
		{float64(0.0051589999999999995), "ms", "5"},
		{float64(1.25), "ms", "1 250"},
		{"hello", "text", "hello"},
		// A line speed, in the units a line is sold in. These are Speedtest
		// Tracker's own numbers for a gigabit connection: the reader is holding
		// them against the "1 Gbps" on their contract, so bits and steps of
		// 1000 are what make the two comparable at a glance.
		{float64(1046085072), "rate", "1.046 Gbps"},
		{float64(1035033264), "rate", "1.035 Gbps"},
		// Three decimals, because this week against last week is the whole
		// point and one decimal rounds both readings to 1.0.
		{float64(1038000000), "rate", "1.038 Gbps"},
		// Trailing zeroes stay, so the figure does not change width as it moves.
		{float64(1000000000), "rate", "1.000 Gbps"},
		// A slower line scales down on its own rather than reading 0.094 Gbps.
		{float64(94000000), "rate", "94.000 Mbps"},
		// Under a kilobit there is nothing to scale, and decimals would be
		// noise on a number that is already whole.
		{float64(512), "rate", "512 bps"},
		// A value the format cannot read falls back to showing it, rather than
		// showing nothing: the reader can then see what arrived.
		{"not a number", "count", "not a number"},
	}
	for _, c := range cases {
		if got := formatCustomValue(c.raw, c.format, nil, ""); got != c.want {
			t.Errorf("%v as %s = %q, want %q", c.raw, c.format, got, c.want)
		}
	}
}

/*
A shape is presentation, and a meter is presentation with a precondition.

The precondition is the point: a bar draws a share of a whole, and only a
percentage carries its own whole. Asking for one over a count is asking the
widget to work out a denominator, which is the expression language it does not
have -- so the shape is dropped and the figure is written out instead.
*/
func TestCustomWidgetShapes(t *testing.T) {
	spec, err := customWidgetSpecFrom(map[string]any{
		"url": "http://service.test/stats",
		"fields": []any{
			map[string]any{"path": "cpu", "format": "percent", "shape": "meter", "tone": "bad"},
			map[string]any{"path": "queries", "format": "count", "shape": "meter"},
			map[string]any{"path": "name", "format": "text", "shape": "large"},
			map[string]any{"path": "other", "format": "count", "shape": "sideways"},
			map[string]any{"path": "toned", "format": "percent", "shape": "meter", "tone": "purple"},
		},
	})
	if err != nil {
		t.Fatalf("the config was refused: %v", err)
	}
	if len(spec.Fields) != 5 {
		t.Fatalf("got %d fields, want 5", len(spec.Fields))
	}
	if spec.Fields[0].Shape != "meter" || spec.Fields[0].Tone != "bad" {
		t.Errorf("a meter over a percentage was not kept: %+v", spec.Fields[0])
	}
	// The two that must not survive, each for its own reason.
	if spec.Fields[1].Shape != "" {
		t.Errorf("a meter over a count was kept: %q", spec.Fields[1].Shape)
	}
	if spec.Fields[3].Shape != "" {
		t.Errorf("a shape nobody offers was kept: %q", spec.Fields[3].Shape)
	}
	if spec.Fields[4].Tone != "" {
		t.Errorf("a tone nobody offers was kept: %q", spec.Fields[4].Tone)
	}
	// And the one that is simply allowed.
	if spec.Fields[2].Shape != "large" {
		t.Errorf("large was not kept: %q", spec.Fields[2].Shape)
	}
}

// A bar's fill, from either of the two ways a service states a percentage.
func TestCustomWidgetMeterShare(t *testing.T) {
	cases := []struct {
		raw  float64
		want float64
	}{
		{0.42, 0.42},
		{42, 0.42},
		{0, 0},
		{100, 1},
		// Past the end at both ends: true of the service, not drawable as a bar.
		{104, 1},
		{-5, 0},
	}
	for _, c := range cases {
		if got := meterShare(c.raw); math.Abs(got-c.want) > 0.0001 {
			t.Errorf("meterShare(%v) = %v, want %v", c.raw, got, c.want)
		}
	}
}

/*
The route takes a widget id, never a URL.

That is the whole safety story: the address comes from what this install stored,
so the endpoint cannot be talked into fetching something by asking it to.
*/
func TestCustomWidgetFetchesOnlyWhatWasStored(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	asked := 0
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"photos": 4210, "usage": 1536}`))
	}))
	defer service.Close()

	widget := Widget{ID: "w_abc123", Type: WidgetTypeCustom, Title: "Immich", Config: map[string]any{
		"url": service.URL,
		"fields": []any{
			map[string]any{"path": "photos", "label": "photos", "format": "count"},
			map[string]any{"path": "usage", "label": "storage", "format": "bytes"},
		},
	}}
	spec, err := customWidgetSpecFrom(normalizeWidgetForTest(t, widget).Config)
	if err != nil {
		t.Fatal(err)
	}

	result := h.fetchCustomWidget(context.Background(), spec)
	if result.Error != "" {
		t.Fatalf("fetch failed: %s", result.Error)
	}
	if len(result.Values) != 2 {
		t.Fatalf("got %d values", len(result.Values))
	}
	if result.Values[0].Value != "4 210" || result.Values[1].Value != "1.5 KB" {
		t.Errorf("values = %q, %q", result.Values[0].Value, result.Values[1].Value)
	}
	if asked != 1 {
		t.Errorf("asked the service %d times for one draw", asked)
	}
}

// A path that stopped matching after an upstream change is worth saying: a
// blank row reads like a zero.
func TestCustomWidgetSaysWhenAPathFindsNothing(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"photos": 1}`))
	}))
	defer service.Close()

	spec, err := customWidgetSpecFrom(map[string]any{
		"url":    service.URL,
		"fields": []any{map[string]any{"path": "videos", "label": "videos", "format": "count"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	result := h.fetchCustomWidget(context.Background(), spec)
	if len(result.Values) != 1 || !result.Values[0].Missing {
		t.Fatalf("a missing path was not reported: %+v", result.Values)
	}
}

/*
Where a widget may reach is the install's existing answer, not a new one.

validateHTTPURL against allowLocalBookmarks governs every other outbound
request, so a widget pointed at a LAN service works exactly when that setting
says it may -- rather than this feature deciding for itself.
*/
func TestCustomWidgetObeysTheAddressRules(t *testing.T) {
	h := newTestHandlers(t)
	// Local addresses off: the default for an install that never said otherwise.
	allowLocalForTest(t, h, false)

	for _, address := range []string{
		"http://169.254.169.254/latest/meta-data/",
		"http://127.0.0.1:9/",
		"http://localhost:8080/api/settings",
	} {
		spec, err := customWidgetSpecFrom(map[string]any{
			"url":    address,
			"fields": []any{map[string]any{"path": "x", "format": "text"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		result := h.fetchCustomWidget(context.Background(), spec)
		if result.Error == "" {
			t.Errorf("%s was fetched with local addresses switched off", address)
		}
		/*
		 * And it says which kind of failure it is.
		 *
		 * The transport blocks these at dial time regardless, so the check
		 * ahead of it is not what makes them safe -- it is what makes them
		 * legible. Without it the tile reads "no answer from that address",
		 * which sends someone looking for an outage instead of at the setting
		 * that would allow it.
		 */
		if !strings.Contains(result.Error, "not allowed") {
			t.Errorf("%s failed as %q, want it named as a refused address", address, result.Error)
		}
	}
}

// The config is bounded on the way in, because it can also arrive by someone
// editing the file a widget is stored in.
func TestCustomWidgetConfigIsNarrowed(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeCustom, map[string]any{
		"url":          "https://service.example/stats",
		"method":       "DELETE",
		"ttl":          5,
		"itemsPath":    "recent",
		"credentialId": "immich",
		"smuggled":     "value",
		"fields": []any{
			map[string]any{"path": "photos", "label": "photos", "format": "count"},
			map[string]any{"path": "", "label": "nameless"},
			map[string]any{"path": "x", "format": "invented"},
			"not an object",
		},
	})

	if _, present := clean["smuggled"]; present {
		t.Error("an undeclared key was stored")
	}
	// GET and POST only: anything else asks a dashboard tile to change something.
	if _, present := clean["method"]; present {
		t.Errorf("method = %v, want it dropped", clean["method"])
	}
	// Below the floor, so it is brought up to it: a dashboard on a wall still
	// cannot poll every five seconds, and the reader who asked for it gets the
	// closest thing allowed rather than silently getting the default back.
	if clean["ttl"] != customWidgetMinTTL {
		t.Errorf("ttl = %v, want %d", clean["ttl"], customWidgetMinTTL)
	}
	fields, _ := clean["fields"].([]any)
	if len(fields) != 2 {
		t.Fatalf("kept %d fields, want 2: %v", len(fields), fields)
	}
	second, _ := fields[1].(map[string]any)
	if second["format"] != "text" {
		t.Errorf("an invented format became %v, want text", second["format"])
	}
}

// An address that is not http(s) is refused rather than stored: a stored one
// reads as configured and fetches nothing.
func TestCustomWidgetRefusesAnAddressItCouldNeverFetch(t *testing.T) {
	for _, address := range []string{"file:///etc/passwd", "javascript:alert(1)", "not a url", ""} {
		clean := sanitizeWidgetConfig(WidgetTypeCustom, map[string]any{"url": address})
		if _, present := clean["url"]; present {
			t.Errorf("%q was stored as an address", address)
		}
	}
	clean := sanitizeWidgetConfig(WidgetTypeCustom, map[string]any{"url": "https://ok.example/x?a=1"})
	if clean["url"] != "https://ok.example/x?a=1" {
		t.Errorf("a good address was altered: %v", clean["url"])
	}
}

// A service that is down must not turn an open dashboard into a retry loop.
func TestCustomWidgetCachesPerWidget(t *testing.T) {
	now := time.Now()
	customWidgetStore("1:w_a", CustomWidgetResult{Values: []CustomWidgetValue{{Value: "A"}}}, time.Minute, now)
	customWidgetStore("1:w_b", CustomWidgetResult{Values: []CustomWidgetValue{{Value: "B"}}}, time.Minute, now)

	a, ok := customWidgetCached("1:w_a", now.Add(time.Second))
	if !ok || a.Values[0].Value != "A" {
		t.Errorf("wrong entry served: %+v", a)
	}
	// Two widgets on one endpoint may ask at different rates; one must not be
	// served the other's answer.
	b, _ := customWidgetCached("1:w_b", now.Add(time.Second))
	if b.Values[0].Value != "B" {
		t.Errorf("entries crossed: %+v", b)
	}
	if _, ok := customWidgetCached("1:w_a", now.Add(2*time.Minute)); ok {
		t.Error("an expired entry was served")
	}
	customWidgetForget("1:w_a")
	if _, ok := customWidgetCached("1:w_a", now.Add(time.Second)); ok {
		t.Error("a forgotten entry was still served")
	}
}

func normalizeWidgetForTest(t *testing.T, widget Widget) Widget {
	t.Helper()
	out, err := normalizeWidget(widget)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// The credential is named by the widget and never held by it.
func TestCustomWidgetSendsAStoredCredential(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	if err := saveHealthCredential("immich", HealthCredential{
		Label: "Immich", Headers: map[string]string{"X-Api-Key": "the-key"},
	}); err != nil {
		t.Fatal(err)
	}

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "the-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"photos": 7}`))
	}))
	defer service.Close()

	spec, err := customWidgetSpecFrom(map[string]any{
		"url":          service.URL,
		"credentialId": "immich",
		"fields":       []any{map[string]any{"path": "photos", "format": "count"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	result := h.fetchCustomWidget(context.Background(), spec)
	if result.Error != "" {
		t.Fatalf("the key was not sent: %s", result.Error)
	}
	if len(result.Values) != 1 || result.Values[0].Value != "7" {
		t.Errorf("values = %+v", result.Values)
	}
	// And the answer never carries the key back to whoever asked.
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "the-key") {
		t.Error("the credential reached the response")
	}
}

// allowLocalBookmarks is a stored setting rather than an environment variable,
// so a test that wants it has to say so through the store.
func allowLocalForTest(t *testing.T, h *Handlers, allow bool) {
	t.Helper()
	settings := h.store.GetSettings()
	settings.AllowLocalBookmarks = allow
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
}

/*
A chosen number of decimals, on any format that carries a number.

SABnzbd is the case that asked for it: it reports mbleft as the string "0.00"
and diskspace1 as "3342.65", which arrive as text and so were shown exactly as
sent, however many digits that was.
*/
func TestFormattingToAChosenNumberOfDecimals(t *testing.T) {
	places := func(n int) *int { return &n }
	cases := []struct {
		raw          any
		format       string
		decimals     *int
		want, reason string
	}{
		// The figure is brought to the scale its unit names before the decimals
		// are counted -- appending "MB" to an unscaled byte count would be
		// wrong by a factor of a million.
		{float64(130760634), "bytes", places(2), "124.70 MB", "a size keeps its unit"},
		{float64(130760634), "bytes", places(0), "125 MB", "and rounds to whole"},
		{float64(1046085072), "rate", places(2), "1.05 Gbps", "a rate keeps its unit"},
		{0.4372, "percent", places(1), "43.7%", "a ratio is read as a percentage first"},
		// A service that reports numbers as strings is the whole reason this
		// exists: text carries no unit, so it is the number and nothing else.
		{"3342.65", "text", places(1), "3342.7", "a numeric string rounds"},
		{"0.00", "text", places(2), "0.00", "and keeps the places asked for"},
		{float64(3.7), "count", places(0), "4", "a count rounds like anything else"},
		// Trailing zeroes stay: a figure that changes width as its digits land
		// reads as the value jumping about.
		{float64(1048576), "bytes", places(3), "1.000 MB", "trailing zeroes stay"},
		// Nothing chosen is the behaviour every widget had before this existed.
		{float64(1536), "bytes", nil, "1.5 KB", "no choice leaves the format alone"},
		// A value that is not a number cannot be rounded, and saying so beats
		// showing a zero that looks like a reading.
		{"paused", "text", places(2), "paused", "text that is not a number is left as it is"},
	}
	for _, c := range cases {
		if got := formatCustomValue(c.raw, c.format, c.decimals, ""); got != c.want {
			t.Errorf("%v as %s = %q, want %q (%s)", c.raw, c.format, got, c.want, c.reason)
		}
	}
}

// A stored config is not a trusted source: it can be hand-edited, and asking the
// formatter for four hundred digits should not be possible.
func TestDecimalsOutsideTheUsefulRangeAreIgnored(t *testing.T) {
	for _, raw := range []any{float64(-1), float64(7), float64(400), "two", nil, true} {
		if got := decimalsFrom(raw); got != nil {
			t.Errorf("decimalsFrom(%v) = %d, want nil", raw, *got)
		}
	}
	for _, raw := range []any{float64(0), float64(3), float64(6)} {
		if got := decimalsFrom(raw); got == nil {
			t.Errorf("decimalsFrom(%v) = nil, want the number", raw)
		}
	}
}

// The choice has to survive the round trip, or it is a setting that forgets.
func TestDecimalsSurviveReadingTheStoredConfig(t *testing.T) {
	spec, err := customWidgetSpecFrom(map[string]any{
		"url": "https://example.test/api",
		"fields": []any{
			map[string]any{"path": "a", "label": "with", "format": "text", "decimals": float64(2)},
			map[string]any{"path": "b", "label": "without", "format": "text"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(spec.Fields) != 2 {
		t.Fatalf("read %d fields, want 2", len(spec.Fields))
	}
	if spec.Fields[0].Decimals == nil || *spec.Fields[0].Decimals != 2 {
		t.Errorf("field 0 decimals = %v, want 2", spec.Fields[0].Decimals)
	}
	// Nothing chosen stays nothing chosen: zero would be a real choice.
	if spec.Fields[1].Decimals != nil {
		t.Errorf("field 1 decimals = %v, want nil", spec.Fields[1].Decimals)
	}
}

/*
Data is Size for a service that already did the arithmetic.

Size reads its input as bytes, which is right for most services and silently
wrong for the ones that count in their own units: SABnzbd reports mbleft as
"0.00" meaning megabytes and diskspace1 as "3342.67" meaning gigabytes, and read
as bytes those come out as "0 B" and "3.3 KB" -- wrong by three and six orders
of magnitude, and reasonable-looking at both.
*/
func TestDataFormatScalesFromTheUnitTheServiceCountsIn(t *testing.T) {
	places := func(n int) *int { return &n }
	cases := []struct {
		raw          any
		unit         string
		decimals     *int
		want, reason string
	}{
		// SABnzbd's own numbers, which is what this was built for.
		{"3342.67", "gb", nil, "3.3 TB", "gigabytes of free space read as terabytes"},
		{"0.00", "mb", nil, "0 B", "an empty queue is still zero"},
		{"1536", "mb", nil, "1.5 GB", "megabytes climb to gigabytes"},
		{"3342.67", "gb", places(2), "3.26 TB", "decimals apply on top of the unit"},
		// Bytes is the default, so a Data figure with no unit set behaves
		// exactly as Size always did.
		{float64(130760634), "", nil, "124.7 MB", "no unit means bytes"},
		{float64(130760634), "b", nil, "124.7 MB", "and so does b"},
		// A unit nobody recognises falls back to bytes rather than failing the
		// figure: a hand-edited config should not take the tile down.
		{float64(1024), "furlongs", nil, "1 KB", "an unknown unit reads as bytes"},
	}
	for _, c := range cases {
		if got := formatCustomValue(c.raw, "data", c.decimals, c.unit); got != c.want {
			t.Errorf("%v as data in %q = %q, want %q (%s)", c.raw, c.unit, got, c.want, c.reason)
		}
	}
}

// The unit has to survive the round trip, or a Data figure silently reverts to
// reading bytes and is wrong by orders of magnitude.
func TestDataUnitSurvivesTheStoredConfig(t *testing.T) {
	spec, err := customWidgetSpecFrom(sanitizeWidgetConfig(WidgetTypeCustom, map[string]any{
		"url": "https://example.test/api",
		"fields": []any{
			map[string]any{"path": "a", "format": "data", "dataUnit": "gb"},
			map[string]any{"path": "b", "format": "data"},
			map[string]any{"path": "c", "format": "text", "dataUnit": "gb"},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if got := spec.Fields[0].DataUnit; got != "gb" {
		t.Errorf("field 0 unit = %q, want gb", got)
	}
	// Nothing chosen means bytes, which is what Size always assumed.
	if got := spec.Fields[1].DataUnit; got != "b" {
		t.Errorf("field 1 unit = %q, want b", got)
	}
	// A unit on a format that has no use for one says nothing about the figure,
	// so the sanitiser does not keep it.
	out := sanitizeWidgetConfig(WidgetTypeCustom, map[string]any{
		"url":    "https://example.test/api",
		"fields": []any{map[string]any{"path": "c", "format": "text", "dataUnit": "gb"}},
	})
	fields, _ := out["fields"].([]any)
	field, _ := fields[0].(map[string]any)
	if _, ok := field["dataUnit"]; ok {
		t.Error("a dataUnit was kept on a format that does not use one")
	}
}

/*
Try it says it asks the address "with whatever is in this panel", and the key
was the one thing it did not send: the payload carried a credentialId, which
names what is *stored*, so a widget being set up for the first time tested
itself anonymously. The service answered 401 -- indistinguishable from a wrong
key, which is the single conclusion this panel exists to rule out.
*/
func TestTryItSendsAKeyThatHasNotBeenSavedYet(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	var seen string
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.Header.Get("X-Api-Key")
		if seen == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"version":"2.5.2"}`))
	}))
	defer service.Close()

	h := NewHandlers(NewStore(), embeddedFiles)
	body, _ := json.Marshal(map[string]any{
		"url":    service.URL,
		"fields": []any{map[string]any{"path": "version", "label": "version", "format": "text"}},
		// Nothing is stored for this widget: the key exists only on screen.
		"draftCredential": map[string]any{
			"headers": map[string]any{"X-Api-Key": "7bd851a0de71"},
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/widgets/custom/test", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.CustomWidgetTestHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if seen != "7bd851a0de71" {
		t.Errorf("the service saw %q, want the typed key", seen)
	}

	var answer CustomWidgetTest
	if err := json.NewDecoder(rec.Body).Decode(&answer); err != nil {
		t.Fatal(err)
	}
	if answer.Status != http.StatusOK {
		t.Errorf("the panel reported %d, want 200", answer.Status)
	}
	// The chip that says a sign-in went with it -- the difference between "the
	// key is wrong" and "no key was sent".
	if !answer.SignedIn {
		t.Error("the panel said nothing was signed in")
	}
}

// Asking is not saving, which is what the panel promises in so many words.
func TestTryItDoesNotStoreTheKeyItWasHandedToTry(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"version":"2.5.2"}`))
	}))
	defer service.Close()

	h := NewHandlers(NewStore(), embeddedFiles)
	body, _ := json.Marshal(map[string]any{
		"url":          service.URL,
		"credentialId": "widget:w_1",
		"fields":       []any{map[string]any{"path": "version", "label": "v", "format": "text"}},
		"draftCredential": map[string]any{
			"headers": map[string]any{"X-Api-Key": "not-to-be-written"},
		},
	})
	rec := httptest.NewRecorder()
	h.CustomWidgetTestHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/custom/test", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	if _, ok := lookupHealthCredential("widget:w_1"); ok {
		t.Error("trying a key filed it")
	}
	if data, err := os.ReadFile(healthCredentialFilePath()); err == nil {
		if strings.Contains(string(data), "not-to-be-written") {
			t.Error("the tried key reached the credential file")
		}
	}
}

// The draft goes through the same sanitiser a stored credential does, so this
// route is not a second, laxer way to put a header on a request.
func TestADraftCredentialIsSanitisedLikeAStoredOne(t *testing.T) {
	if got := draftCredentialFrom(map[string]any{
		"headers": map[string]any{"X-Api-Key\r\nInjected": "value"},
	}); got != nil {
		t.Errorf("a header that could split a request was accepted: %v", got.Headers)
	}
	if got := draftCredentialFrom(map[string]any{"headers": map[string]any{}}); got != nil {
		t.Error("an empty credential should read as nothing sent")
	}
	if got := draftCredentialFrom("not an object"); got != nil {
		t.Error("a non-object should read as nothing sent")
	}
	got := draftCredentialFrom(map[string]any{
		"query": map[string]any{"apikey": "abc"},
	})
	if got == nil || got.Query["apikey"] != "abc" {
		t.Errorf("a query credential did not survive: %v", got)
	}
}
