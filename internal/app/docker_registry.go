package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

/*
Is there a newer image behind this tag?

One HEAD request per image to the registry's manifest endpoint, which answers
with the digest the tag points at now. That digest is compared to the one the
local image was pulled with. A HEAD does not count against Docker Hub's pull
limit, which is why this is safe to run on a timer.

Anonymous only. A private registry answers 401 to the token as well, and the
image is reported as "unknown: auth-required" rather than guessed at.
*/

type imageRef struct{ Registry, Repo, Tag string }

func (r imageRef) key() string { return r.Registry + "/" + r.Repo + ":" + r.Tag }

func parseImageRef(ref string) (imageRef, bool) {
	ref = strings.TrimSpace(ref)
	// An image id is no reference: no registry has it under that name.
	if ref == "" || strings.Contains(ref, "@") || dockerIsImageID(ref) {
		return imageRef{}, false
	}
	repo, tag := splitImageTag(ref)
	registry := "registry-1.docker.io"
	if first, rest, ok := strings.Cut(repo, "/"); ok && (strings.ContainsAny(first, ".:") || first == "localhost") {
		registry, repo = first, rest
		if registry == "docker.io" || registry == "index.docker.io" {
			registry = "registry-1.docker.io"
		}
	}
	if registry == "registry-1.docker.io" && !strings.Contains(repo, "/") {
		repo = "library/" + repo
	}
	return imageRef{Registry: registry, Repo: repo, Tag: tag}, true
}

type registryLookup struct {
	client *http.Client
	scheme string
}

var dockerRegistry = &registryLookup{client: newOutboundHTTPClient(false, 15*time.Second, 3), scheme: "https"}

var manifestAccept = strings.Join([]string{
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.docker.distribution.manifest.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
}, ", ")

var bearerParam = regexp.MustCompile(`(\w+)="([^"]*)"`)

func (l *registryLookup) remoteDigest(ctx context.Context, ref imageRef) (string, string, error) {
	target := l.scheme + "://" + ref.Registry + "/v2/" + ref.Repo + "/manifests/" + url.PathEscape(ref.Tag)
	resp, err := l.head(ctx, target, "")
	if err != nil {
		return "", "unreachable", err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		token, terr := l.token(ctx, resp.Header.Get("Www-Authenticate"), ref.Repo)
		if terr != nil || token == "" {
			return "", "auth-required", terr
		}
		if resp, err = l.head(ctx, target, token); err != nil {
			return "", "unreachable", err
		}
	}
	switch {
	case resp.StatusCode == http.StatusOK:
		if d := resp.Header.Get("Docker-Content-Digest"); d != "" {
			return d, "", nil
		}
		return "", "unreachable", nil
	case resp.StatusCode == http.StatusTooManyRequests:
		return "", "rate-limited", nil
	case resp.StatusCode == http.StatusNotFound:
		return "", "not-found", nil
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return "", "auth-required", nil
	}
	return "", "unreachable", nil
}

func (l *registryLookup) head(ctx context.Context, target, token string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", manifestAccept)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := l.client.Do(req)
	if err != nil {
		return nil, err
	}
	resp.Body.Close()
	return resp, nil
}

func (l *registryLookup) token(ctx context.Context, challenge, repo string) (string, error) {
	if !strings.HasPrefix(strings.ToLower(challenge), "bearer ") {
		return "", nil
	}
	params := map[string]string{}
	for _, m := range bearerParam.FindAllStringSubmatch(challenge, -1) {
		params[m[1]] = m[2]
	}
	realm, err := url.Parse(params["realm"])
	if err != nil || realm.Host == "" {
		return "", err
	}
	q := realm.Query()
	if s := params["service"]; s != "" {
		q.Set("service", s)
	}
	q.Set("scope", "repository:"+repo+":pull")
	realm.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, realm.String(), nil)
	if err != nil {
		return "", err
	}
	resp, err := l.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var body struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.Token != "" {
		return body.Token, nil
	}
	return body.AccessToken, nil
}
