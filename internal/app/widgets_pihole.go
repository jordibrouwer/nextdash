package app

import (
	"context"
	"net/url"
	"sort"
	"strings"
)

/*
Pi-hole v6: the same tile as AdGuard, from Pi-hole's own API.

v6 signs in for a session id (the credential carries a Session: password only,
POST /api/auth, token session.sid sent as X-FTL-SID); mediaRequest keeps and
renews it. v5 has no such API and is not supported.

The history comes in ten-minute slots; the tile draws hours, so they are
summed by the hour and the last day is kept. Response times arrive in seconds.
*/

type piholeSummary struct {
	Queries struct {
		Total   int64 `json:"total"`
		Blocked int64 `json:"blocked"`
	} `json:"queries"`
	Gravity struct {
		Domains *int64 `json:"domains_being_blocked"`
	} `json:"gravity"`
}

type piholeHistory struct {
	History []struct {
		Timestamp float64 `json:"timestamp"`
		Total     int64   `json:"total"`
		Blocked   int64   `json:"blocked"`
	} `json:"history"`
}

// piholeHours sums the ten-minute slots by the hour, oldest first, last 24.
func piholeHours(history piholeHistory) []MediaDnsHour {
	byHour := map[int64]*MediaDnsHour{}
	var order []int64
	for _, slot := range history.History {
		hour := int64(slot.Timestamp) / 3600
		entry := byHour[hour]
		if entry == nil {
			entry = &MediaDnsHour{}
			byHour[hour] = entry
			order = append(order, hour)
		}
		entry.Queries += slot.Total
		entry.Blocked += slot.Blocked
	}
	sort.Slice(order, func(i, j int) bool { return order[i] < order[j] })
	if len(order) > 24 {
		order = order[len(order)-24:]
	}
	out := make([]MediaDnsHour, 0, len(order))
	for _, hour := range order {
		out = append(out, *byHour[hour])
	}
	return out
}

func (h *Handlers) fetchPihole(ctx context.Context, spec dnsSpec, credential HealthCredential) (*MediaDns, error) {
	var summary piholeSummary
	if err := h.dnsGetJSON(ctx, spec.Server, credential, "/api/stats/summary", &summary); err != nil {
		return nil, err
	}
	dns := &MediaDns{
		Service: "pihole", Queries: summary.Queries.Total, Blocked: summary.Queries.Blocked,
		BlockedPct: dnsPercent(summary.Queries.Blocked, summary.Queries.Total),
		Gravity:    summary.Gravity.Domains, OpenURL: spec.Server + "/admin",
	}
	// Everything below is the lesser question: a part that fails is absent.
	var history piholeHistory
	if h.dnsGetJSON(ctx, spec.Server, credential, "/api/history", &history) == nil {
		dns.Hourly = piholeHours(history)
	} else {
		dns.Partial = true
	}
	var domains struct {
		Domains []struct {
			Domain string `json:"domain"`
			Count  int64  `json:"count"`
		} `json:"domains"`
	}
	if h.dnsGetQuery(ctx, spec.Server, credential, "/api/stats/top_domains",
		url.Values{"blocked": {"true"}, "count": {"10"}}, &domains) == nil {
		counts := map[string]int64{}
		for _, d := range domains.Domains {
			counts[d.Domain] += d.Count
		}
		dns.TopBlocked = dnsTop(counts)
	} else {
		dns.Partial = true
	}
	var clients struct {
		Clients []struct {
			Name  string `json:"name"`
			IP    string `json:"ip"`
			Count int64  `json:"count"`
		} `json:"clients"`
	}
	if h.dnsGetQuery(ctx, spec.Server, credential, "/api/stats/top_clients", url.Values{"count": {"10"}}, &clients) == nil {
		counts := map[string]int64{}
		for _, c := range clients.Clients {
			name := c.Name
			if name == "" {
				name = c.IP
			}
			counts[name] += c.Count
		}
		dns.TopClients = dnsTop(counts)
	} else {
		dns.Partial = true
	}
	var types struct {
		Types map[string]int64 `json:"types"`
	}
	if h.dnsGetJSON(ctx, spec.Server, credential, "/api/stats/query_types", &types) == nil {
		dns.QueryTypes = dnsTop(types.Types)
	} else {
		dns.Partial = true
	}
	var upstreams struct {
		Upstreams []struct {
			IP         string `json:"ip"`
			Name       string `json:"name"`
			Port       int    `json:"port"`
			Count      int64  `json:"count"`
			Statistics struct {
				Response *float64 `json:"response"`
			} `json:"statistics"`
		} `json:"upstreams"`
		Forwarded int64 `json:"forwarded_queries"`
	}
	if h.dnsGetJSON(ctx, spec.Server, credential, "/api/stats/upstreams", &upstreams) == nil {
		for _, u := range upstreams.Upstreams {
			// "blocklist" and "cache" are Pi-hole's own pseudo upstreams, counted
			// against all queries rather than the forwarded ones.
			if u.Port < 0 || u.IP == "blocklist" || u.IP == "cache" {
				continue
			}
			name := u.Name
			if name == "" {
				name = u.IP
			}
			entry := MediaDnsUpstream{Name: name, Pct: dnsPercent(u.Count, upstreams.Forwarded)}
			if u.Statistics.Response != nil {
				ms := dnsRound1(*u.Statistics.Response * 1000)
				entry.Ms = &ms
			}
			dns.Upstreams = append(dns.Upstreams, entry)
		}
		sort.SliceStable(dns.Upstreams, func(i, j int) bool {
			a, b := dns.Upstreams[i].Pct, dns.Upstreams[j].Pct
			return a != nil && (b == nil || *a > *b)
		})
		if len(dns.Upstreams) > 5 {
			dns.Upstreams = dns.Upstreams[:5]
		}
	} else {
		dns.Partial = true
	}
	var blocking struct {
		Blocking string `json:"blocking"`
	}
	if h.dnsGetJSON(ctx, spec.Server, credential, "/api/dns/blocking", &blocking) == nil {
		// Only the two states that say something; "unknown" and "failed" are not off.
		switch strings.ToLower(blocking.Blocking) {
		case "enabled":
			on := true
			dns.Protection = &on
		case "disabled":
			off := false
			dns.Protection = &off
		}
	} else {
		dns.Partial = true
	}
	return dns, nil
}

func (h *Handlers) piholeProbe(ctx context.Context, server string, credential HealthCredential) (string, error) {
	server = strings.TrimSuffix(server, "/admin")
	var summary piholeSummary
	if err := h.dnsGetJSON(ctx, server, credential, "/api/stats/summary", &summary); err != nil {
		return "", err
	}
	return "v6", nil
}
