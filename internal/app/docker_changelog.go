package app

import (
	"context"
	"encoding/json"
	"net/http"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"
)

/*
What changed between the running version and the newest one: GitHub releases
for the image's declared source repo, anchored on the version label of the
image the container actually runs -- not the tag, which after a pull already
points at whatever was fetched last.
*/

var (
	dockerGitHubBase   = "https://api.github.com"
	dockerGitHubClient = newOutboundHTTPClient(false, 15*time.Second, 3)
	githubRepoPath     = regexp.MustCompile(`^https?://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$`)
	changelogCache     sync.Map // "owner/repo" -> changelogCacheEntry
)

const (
	changelogCacheTTL = 24 * time.Hour
	changelogBodyCap  = 20000 // runes
)

type changelogCacheEntry struct {
	fetched  time.Time
	releases []dockerGithubRelease
}

type dockerGithubRelease struct {
	Tag       string `json:"tag"`
	Name      string `json:"name"`
	Body      string `json:"body"`
	URL       string `json:"url"`
	Published string `json:"published"`
}

// dockerLink is one of the "go look here" pointers the drawer offers when the
// changelog itself is unavailable or empty: kind is "source", "registry" or
// "webui".
type dockerLink struct {
	Kind string `json:"kind"`
	URL  string `json:"url"`
}

type dockerChangelog struct {
	Current  string                `json:"current,omitempty"`
	Releases []dockerGithubRelease `json:"releases"`
	Links    []dockerLink          `json:"links"`
	Reason   string                `json:"reason,omitempty"` // "no-source" | "rate-limited" | "unreachable"
}

func githubRepoFromSource(src string) (string, string, bool) {
	m := githubRepoPath.FindStringSubmatch(strings.TrimSpace(src))
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}

func normalizeVersion(v string) string {
	return strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(strings.TrimSpace(v)), "version-"), "v")
}

// releasesBetween returns the releases newer than current, newest first. With
// no version to anchor on, the newest three stand in -- enough to see what a
// project has been doing without pretending to know which of them is new.
func releasesBetween(all []dockerGithubRelease, current string) []dockerGithubRelease {
	cur := normalizeVersion(current)
	if cur != "" {
		for i, r := range all {
			if normalizeVersion(r.Tag) == cur || strings.HasPrefix(normalizeVersion(r.Tag), cur+"-") {
				return all[:i]
			}
		}
	}
	if len(all) > 3 {
		return all[:3]
	}
	return all
}

// registryPageFor turns an image reference into the registry's own page for
// it, when the registry is one this knows how to link to.
func registryPageFor(image string) string {
	ref, ok := parseImageRef(image)
	if !ok {
		return ""
	}
	switch ref.Registry {
	case "registry-1.docker.io":
		return "https://hub.docker.com/r/" + strings.TrimPrefix(ref.Repo, "library/")
	case "ghcr.io":
		owner, name, _ := strings.Cut(ref.Repo, "/")
		return "https://github.com/" + owner + "/" + name + "/pkgs/container/" + name
	case "lscr.io":
		return "https://docs.linuxserver.io/images/docker-" + path.Base(ref.Repo)
	case "quay.io":
		return "https://quay.io/repository/" + ref.Repo
	}
	return ""
}

// capRunes truncates by rune, not by byte, so a multi-byte body is never cut
// mid-character.
func capRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

type githubReleaseRaw struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
}

// fetchGithubReleasesLive is the one HTTP call: 20 releases, newest first (the
// order GitHub already answers in). The prerelease filter runs here, before
// the cache, because dockerGithubRelease itself drops the flag -- keeping a
// prerelease is only right when the version actually running is one too.
func fetchGithubReleasesLive(ctx context.Context, owner, repo, current string) ([]dockerGithubRelease, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		dockerGitHubBase+"/repos/"+owner+"/"+repo+"/releases?per_page=20", nil)
	if err != nil {
		return nil, "unreachable"
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "nextDash")
	// Optional, from Config -> Containers: 5000 requests an hour instead of 60.
	if token := dockerGitHubToken(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := dockerGitHubClient.Do(req)
	if err != nil {
		return nil, "unreachable"
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusForbidden, http.StatusTooManyRequests:
		return nil, "rate-limited"
	case http.StatusOK:
	default:
		return nil, "unreachable"
	}
	var raw []githubReleaseRaw
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, "unreachable"
	}
	wantPrerelease := strings.Contains(normalizeVersion(current), "-")
	out := make([]dockerGithubRelease, 0, len(raw))
	for _, rr := range raw {
		if rr.Draft {
			continue
		}
		if rr.Prerelease && !wantPrerelease {
			continue
		}
		out = append(out, dockerGithubRelease{
			Tag:       rr.TagName,
			Name:      rr.Name,
			Body:      capRunes(rr.Body, changelogBodyCap),
			URL:       rr.HTMLURL,
			Published: rr.PublishedAt,
		})
	}
	return out, ""
}

// fetchGithubReleases serves the cache when it is younger than 24h, and falls
// back to a stale cache entry rather than an empty list when the live fetch
// is rate-limited or unreachable.
func fetchGithubReleases(ctx context.Context, owner, repo, current string) ([]dockerGithubRelease, string) {
	key := owner + "/" + repo
	if v, ok := changelogCache.Load(key); ok {
		if entry := v.(changelogCacheEntry); time.Since(entry.fetched) < changelogCacheTTL {
			return entry.releases, ""
		}
	}
	releases, reason := fetchGithubReleasesLive(ctx, owner, repo, current)
	if reason == "" {
		changelogCache.Store(key, changelogCacheEntry{fetched: time.Now(), releases: releases})
		return releases, ""
	}
	if v, ok := changelogCache.Load(key); ok {
		return v.(changelogCacheEntry).releases, reason
	}
	return nil, reason
}

// DockerChangelogHandler answers what changed since the container's own
// running version. It reads Version and Source off the image the container
// actually runs (inspectContainer then inspectImage by that image id), the
// same anchor the detail handler uses -- never the tag, which after a pull no
// longer names the image this container is on.
func (h *Handlers) DockerChangelogHandler(w http.ResponseWriter, r *http.Request) {
	api, c, ok := h.dockerTarget(w, r)
	if !ok {
		return
	}
	in, err := api.inspectContainer(r.Context(), c.ID)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	// A pruned or missing image just means no labels to read, not a failed
	// request: the links (registry, webui) still stand on their own.
	img, _ := api.inspectImage(r.Context(), in.Image)

	cl := dockerChangelog{
		Current:  img.Config.Labels["org.opencontainers.image.version"],
		Releases: []dockerGithubRelease{},
		Links:    []dockerLink{},
	}
	source := img.Config.Labels["org.opencontainers.image.source"]
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		cl.Links = append(cl.Links, dockerLink{Kind: "source", URL: source})
	}
	if reg := registryPageFor(c.Image); reg != "" {
		cl.Links = append(cl.Links, dockerLink{Kind: "registry", URL: reg})
	}
	if ui := dockerWebUI(c); ui != "" {
		cl.Links = append(cl.Links, dockerLink{Kind: "webui", URL: ui})
	}

	owner, repo, ok := githubRepoFromSource(source)
	if !ok {
		cl.Reason = "no-source"
		writeJSON(w, cl)
		return
	}
	all, reason := fetchGithubReleases(r.Context(), owner, repo, cl.Current)
	cl.Reason = reason
	cl.Releases = releasesBetween(all, cl.Current)
	if cl.Releases == nil {
		cl.Releases = []dockerGithubRelease{}
	}
	writeJSON(w, cl)
}
