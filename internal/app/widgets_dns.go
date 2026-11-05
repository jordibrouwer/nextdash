package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
DNS blockers: AdGuard Home and Pi-hole on the shared media tile.

Both answer the same question -- how many queries, how many blocked, who asks
and what is refused -- so they share one answer (MediaDns) and one tile, and a
service brings only the function that fills it. Unknown is not zero: a figure
the service did not send is nil and the tile does not draw it.
*/

const (
	dnsDefaultRows = 10
	dnsDefaultTTL  = 60
	// dnsMinTTL: both services count live, but a second-by-second redraw of
	// an hourly strip says nothing new.
	dnsMinTTL = 30
	// dnsTopLimit is how long a top list gets; the tile cuts it by rows.
	dnsTopLimit = 10
)

// MediaDns is what a DNS blocker tile draws.
type MediaDns struct {
	Service string `json:"service"`
	Queries int64  `json:"queries"`
	Blocked int64  `json:"blocked"`
	// BlockedPct is nil when there were no queries: 0 of 0 is not 0 %.
	BlockedPct *float64 `json:"blockedPct,omitempty"`
	AvgMs      *float64 `json:"avgMs,omitempty"`
	// Protection is nil when the service did not say.
	Protection *bool `json:"protection,omitempty"`
	// Hourly is the last day, oldest first. Empty when the service sent none.
	Hourly     []MediaDnsHour     `json:"hourly,omitempty"`
	TopBlocked []MediaDnsTop      `json:"topBlocked,omitempty"`
	TopClients []MediaDnsTop      `json:"topClients,omitempty"`
	QueryTypes []MediaDnsTop      `json:"queryTypes,omitempty"`
	Upstreams  []MediaDnsUpstream `json:"upstreams,omitempty"`
	// Gravity is how many domains the lists block (Pi-hole).
	Gravity *int64 `json:"gravity,omitempty"`
	Version string `json:"version,omitempty"`
	OpenURL string `json:"openUrl"`
	// Partial says a lesser part could not be read; the next read is soon.
	Partial bool `json:"-"`
}

type MediaDnsHour struct {
	Queries int64 `json:"q"`
	Blocked int64 `json:"b"`
}

type MediaDnsTop struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

type MediaDnsUpstream struct {
	Name string   `json:"name"`
	Pct  *float64 `json:"pct,omitempty"`
	Ms   *float64 `json:"ms,omitempty"`
}

// dnsPercent is blocked over queries in tenths of a percent, nil for none.
func dnsPercent(blocked, queries int64) *float64 {
	if queries <= 0 {
		return nil
	}
	value := float64(blocked) * 100 / float64(queries)
	value = float64(int64(value*10+0.5)) / 10
	return &value
}

// dnsRound1 keeps one decimal.
func dnsRound1(value float64) float64 { return float64(int64(value*10+0.5)) / 10 }

// dnsTop turns a count map into a list, biggest first, names breaking ties so
// two reads of the same answer agree.
func dnsTop(counts map[string]int64) []MediaDnsTop {
	out := make([]MediaDnsTop, 0, len(counts))
	for name, count := range counts {
		out = append(out, MediaDnsTop{Name: name, Count: count})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	if len(out) > dnsTopLimit {
		out = out[:dnsTopLimit]
	}
	return out
}

func dnsFields(withExtras bool) []widgetField {
	parts := []string{"figures", "chart", "blocked", "clients", "protection"}
	if withExtras {
		parts = append(parts, "types", "upstreams")
	}
	return []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		{Key: "look", Kind: "string", Allowed: []string{"pulse", "leaders", "tiles", "mix"}},
		// What the tile draws; the server sends them all.
		{Key: "parts", Kind: "list", Allowed: parts},
		{Key: "click", Kind: "string", Allowed: []string{"open", "detail"}},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "ttl", Kind: "int", Min: dnsMinTTL, Max: 3600},
	}
}

type dnsSpec struct {
	Type         WidgetType
	Server       string
	CredentialID string
	TTL          time.Duration
}

func dnsSpecFrom(widgetType WidgetType, config map[string]any) dnsSpec {
	spec := dnsSpec{
		Type:         widgetType,
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		TTL:          dnsDefaultTTL * time.Second,
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, dnsMinTTL, 3600)) * time.Second
	}
	// Pi-hole's address is often pasted with its /admin; the API is above it.
	if widgetType == WidgetTypePihole {
		spec.Server = strings.TrimSuffix(spec.Server, "/admin")
	}
	return spec
}

// fingerprint changes with every setting that changes what the service is
// asked. The look and the parts are the browser's, so they are not in it.
func (spec dnsSpec) fingerprint() string {
	return strings.Join([]string{string(spec.Type), spec.Server, spec.CredentialID}, "|")
}

func (spec dnsSpec) beat() time.Duration { return spec.TTL - time.Second }

// dnsFetch fills the answer from one service.
type dnsFetch func(ctx context.Context, spec dnsSpec, credential HealthCredential) (*MediaDns, error)

// dnsAnswer is one tile's answer through the shared media cache.
func (h *Handlers) dnsAnswer(fetch dnsFetch) func(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	return func(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
		spec := dnsSpecFrom(widget.Type, widget.Config)
		ms := mediaSpec{Service: string(widget.Type), Server: spec.Server, CredentialID: spec.CredentialID,
			Fingerprint: spec.fingerprint(), TTL: spec.beat()}
		return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
			result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
			if spec.Server == "" || spec.CredentialID == "" {
				return result, nil, errMediaNotSetUp
			}
			credential, ok := lookupHealthCredential(spec.CredentialID)
			if !ok {
				return result, nil, errMediaNotSetUp
			}
			dns, err := fetch(ctx, spec, credential)
			if err != nil {
				return result, nil, err
			}
			result.Dns = dns
			result.Partial = dns.Partial
			return result, nil, nil
		}, forced)
	}
}

func (h *Handlers) dnsWidgetHandler(widgetType WidgetType, fetch dnsFetch) http.HandlerFunc {
	answer := h.dnsAnswer(fetch)
	return func(w http.ResponseWriter, r *http.Request) {
		h.serveMediaWidget(w, r, widgetType, answer)
	}
}

// dnsGetJSON asks a service once, with the stored credential.
func (h *Handlers) dnsGetJSON(ctx context.Context, server string, credential HealthCredential, path string, out any) error {
	return h.dnsGetQuery(ctx, server, credential, path, nil, out)
}

func (h *Handlers) dnsGetQuery(ctx context.Context, server string, credential HealthCredential, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, path, query, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, jellyfinMaxBody)).Decode(out); err != nil {
		return errMediaUnreachable
	}
	return nil
}

// dnsSetupHandler checks a typed-but-unsaved sign-in against the service and
// says what it found. Behind the write token, like the other media setups.
func (h *Handlers) dnsSetupHandler(name string, probe func(ctx context.Context, server string, credential HealthCredential) (string, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.setCORSHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if !h.requireWriteAccess(w, r) || !h.requireSSRFAPIRateLimit(w, r) {
			return
		}
		var body map[string]any
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		answer := struct {
			Connected string `json:"connected,omitempty"`
			Error     string `json:"error,omitempty"`
		}{}
		reply := func(err error) {
			if err != nil {
				logWarn(logComponentWidgets, "%s setup for %s: %v", name, hostOf(stringOr(body["server"])), err)
				answer.Error = mediaErrorCode(err)
			}
			_ = json.NewEncoder(w).Encode(answer)
		}
		server := strings.TrimRight(sanitizeWidgetURL(stringOr(body["server"])), "/")
		var credential HealthCredential
		if draft := draftCredentialFrom(body["draftCredential"]); draft != nil {
			credential = *draft
		} else if stored, ok := lookupHealthCredential(stringOr(body["credentialId"])); ok {
			credential = stored
		} else {
			reply(errMediaNotSetUp)
			return
		}
		if server == "" {
			reply(errMediaNotSetUp)
			return
		}
		connected, err := probe(r.Context(), server, credential)
		if err != nil {
			reply(err)
			return
		}
		answer.Connected = connected
		reply(nil)
	}
}

// dnsInt64 reads a JSON number that may be an int or a float.
func dnsInt64(value any) int64 {
	switch v := value.(type) {
	case float64:
		return int64(v)
	case json.Number:
		n, _ := v.Int64()
		return n
	case string:
		n, _ := strconv.ParseInt(v, 10, 64)
		return n
	}
	return 0
}
