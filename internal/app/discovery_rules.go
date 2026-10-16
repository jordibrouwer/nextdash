package app

import (
	"strings"
)

// discoveryKinds are the default kind names in display order. A container
// that matches nothing is an "Apps" entry.
var discoveryKinds = []string{
	"Media", "Media management", "Downloads", "Monitoring", "Network",
	"Home", "Documents & photos", "Development", "Tools", "Apps",
}

// discoveryKindMap maps an image's base repository name (see imageRepoName)
// to its kind. Sorted by repository name.
var discoveryKindMap = map[string]string{
	"adguardhome":         "Network",
	"bazarr":              "Media management",
	"beszel":              "Monitoring",
	"caddy":               "Network",
	"code-server":         "Development",
	"deluge":              "Downloads",
	"dozzle":              "Monitoring",
	"emby":                "Media",
	"esphome":             "Home",
	"forgejo":             "Development",
	"gatus":               "Monitoring",
	"gitea":               "Development",
	"glances":             "Monitoring",
	"grafana":             "Monitoring",
	"home-assistant":      "Home",
	"immich-server":       "Documents & photos",
	"jellyfin":            "Media",
	"jellyseerr":          "Media management",
	"jenkins":             "Development",
	"lidarr":              "Media management",
	"netdata":             "Monitoring",
	"nextcloud":           "Documents & photos",
	"nginx-proxy-manager": "Network",
	"node-red":            "Home",
	"nzbget":              "Downloads",
	"overseerr":           "Media management",
	"paperless-ngx":       "Documents & photos",
	"photoprism":          "Documents & photos",
	"pihole":              "Network",
	"plex":                "Media",
	"pms-docker":          "Media",
	"prometheus":          "Monitoring",
	"prowlarr":            "Media management",
	"qbittorrent":         "Downloads",
	"radarr":              "Media management",
	"readarr":             "Media management",
	"sabnzbd":             "Downloads",
	"scrutiny":            "Monitoring",
	"seerr":               "Media management",
	"sonarr":              "Media management",
	"syncthing":           "Documents & photos",
	"tailscale":           "Network",
	"traefik":             "Network",
	"transmission":        "Downloads",
	"uptime-kuma":         "Monitoring",
	"wireguard":           "Network",
	"zigbee2mqtt":         "Home",
}

// discoveryDeniedImages are base repository names that are plumbing, not
// apps: databases, brokers, socket proxies and updaters. Sorted.
var discoveryDeniedImages = map[string]bool{
	"diun":                true,
	"docker-socket-proxy": true,
	"mariadb":             true,
	"memcached":           true,
	"mongo":               true,
	"mosquitto":           true,
	"mysql":               true,
	"postgres":            true,
	"rabbitmq":            true,
	"redis":               true,
	"valkey":              true,
	"watchtower":          true,
}

// discoveryKind picks the kind a proposed app lands in: the nextdash.category
// label first, then the image's repository name, then the container name.
func discoveryKind(image, name string, labels map[string]string) string {
	if v := strings.TrimSpace(labels["nextdash.category"]); v != "" {
		return v
	}
	if k, ok := discoveryKindMap[imageRepoName(image)]; ok {
		return k
	}
	if k, ok := discoveryKindMap[strings.ToLower(strings.TrimPrefix(strings.TrimSpace(name), "/"))]; ok {
		return k
	}
	return "Apps"
}

// discoverySkipReason says why a container is never proposed, or "" when it
// may be. Only the first reason that applies is returned.
func discoverySkipReason(c dockerContainerSummary, s Settings, selfID string) string {
	name := c.name()
	switch {
	case isDockerSelf(c.ID, selfID):
		return "self"
	case isTruthyLabel(c.Labels["nextdash.hide"]):
		return "hidden-label"
	case containsString(s.DiscoveryIgnored, name):
		return "ignored"
	case containsString(s.DockerHiddenContainers, name):
		return "hidden-view"
	case discoveryDeniedImages[imageRepoName(c.Image)]:
		return "denied-image"
	}
	return ""
}

func isTruthyLabel(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// discoverySelfID is this process's container id (or its 12-character
// prefix), or "" when nextDash does not run in a container.
func discoverySelfID() string { return dockerSelfID() }
