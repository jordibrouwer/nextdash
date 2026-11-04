package app

import "context"

/*
AdGuard Home: queries, what is blocked and who asks, on the DNS tile.

The web interface user and password go as Basic auth (the stored credential).
Two questions per beat: /control/status for whether protection is on, and
/control/stats for the figures, the last day by the hour and the top lists.
Times arrive in seconds; the tile is told milliseconds.
*/

type adguardStats struct {
	TimeUnits  string             `json:"time_units"`
	Queries    int64              `json:"num_dns_queries"`
	Blocked    int64              `json:"num_blocked_filtering"`
	AvgSeconds *float64           `json:"avg_processing_time"`
	DNS        []int64            `json:"dns_queries"`
	BlockedBy  []int64            `json:"blocked_filtering"`
	TopBlocked []map[string]int64 `json:"top_blocked_domains"`
	TopClients []map[string]int64 `json:"top_clients"`
}

type adguardStatus struct {
	Version    string `json:"version"`
	Protection *bool  `json:"protection_enabled"`
}

// adguardTop merges the single-key maps AdGuard uses for a list.
func adguardTop(list []map[string]int64) []MediaDnsTop {
	counts := map[string]int64{}
	for _, entry := range list {
		for name, count := range entry {
			counts[name] += count
		}
	}
	return dnsTop(counts)
}

func (h *Handlers) fetchAdguard(ctx context.Context, spec dnsSpec, credential HealthCredential) (*MediaDns, error) {
	var stats adguardStats
	if err := h.dnsGetJSON(ctx, spec.Server, credential, "/control/stats", &stats); err != nil {
		return nil, err
	}
	dns := &MediaDns{
		Service: "adguard", Queries: stats.Queries, Blocked: stats.Blocked,
		BlockedPct: dnsPercent(stats.Blocked, stats.Queries),
		TopBlocked: adguardTop(stats.TopBlocked), TopClients: adguardTop(stats.TopClients),
		OpenURL: spec.Server,
	}
	if stats.AvgSeconds != nil {
		ms := dnsRound1(*stats.AvgSeconds * 1000)
		dns.AvgMs = &ms
	}
	// With a longer statistics period the arrays are per day, not per hour:
	// a day series under a "last 24 h" strip would be a lie, so none is sent.
	for i, q := range stats.DNS {
		if stats.TimeUnits == "days" {
			break
		}
		hour := MediaDnsHour{Queries: q}
		if i < len(stats.BlockedBy) {
			hour.Blocked = stats.BlockedBy[i]
		}
		dns.Hourly = append(dns.Hourly, hour)
	}
	// Status is the lesser question: a failure there leaves the figures.
	var status adguardStatus
	if err := h.dnsGetJSON(ctx, spec.Server, credential, "/control/status", &status); err == nil {
		dns.Protection = status.Protection
		dns.Version = status.Version
	} else {
		dns.Partial = true
	}
	return dns, nil
}

func (h *Handlers) adguardProbe(ctx context.Context, server string, credential HealthCredential) (string, error) {
	var status adguardStatus
	if err := h.dnsGetJSON(ctx, server, credential, "/control/status", &status); err != nil {
		return "", err
	}
	if status.Version == "" {
		return "ok", nil
	}
	return status.Version, nil
}
