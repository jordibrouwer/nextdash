package app

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

/*
The Unraid server the Unraid widgets read, and its API key.

One connection for all seven widgets: a widget only says how it draws, never
where it reads. The key is kept apart in unraid-secrets.json at 0600, the way
docker-secrets.json keeps the GitHub token, so settings.json can travel without it.
*/

func normalizeUnraidSettings(s *Settings) {
	if len(s.UnraidServers) > unraidMaxServers {
		s.UnraidServers = s.UnraidServers[:unraidMaxServers]
	}
	for i := range s.UnraidServers {
		srv := &s.UnraidServers[i]
		if srv.ID == "" {
			srv.ID = newUnraidServerID()
		}
		srv.Name = strings.TrimSpace(srv.Name)
		if len(srv.Name) > 64 {
			srv.Name = srv.Name[:64]
		}
		srv.BaseURL = normalizeUnraidBaseURL(srv.BaseURL)
	}
}

// normalizeUnraidBaseURL keeps scheme://host[:port], nothing after it: the
// client appends /graphql itself, and the widgets build web UI links from it.
func normalizeUnraidBaseURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

const unraidMaxServers = 1

func newUnraidServerID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "u_" + hex.EncodeToString(b)
}

func activeUnraidServer(s Settings) (UnraidServer, bool) {
	for _, srv := range s.UnraidServers {
		if srv.Enabled && srv.BaseURL != "" {
			return srv, true
		}
	}
	return UnraidServer{}, false
}

func unraidSecretsFilePath() string {
	return filepath.Join(ResolveDataDir(), "unraid-secrets.json")
}

var unraidSecretsMu sync.Mutex

type unraidSecrets struct {
	Keys map[string]string `json:"keys,omitempty"`
}

func readUnraidSecrets() unraidSecrets {
	var out unraidSecrets
	if data, err := os.ReadFile(unraidSecretsFilePath()); err == nil {
		_ = json.Unmarshal(data, &out)
	}
	if out.Keys == nil {
		out.Keys = map[string]string{}
	}
	return out
}

func unraidAPIKey(serverID string) string {
	unraidSecretsMu.Lock()
	defer unraidSecretsMu.Unlock()
	return strings.TrimSpace(readUnraidSecrets().Keys[serverID])
}

func saveUnraidAPIKey(serverID, key string) error {
	unraidSecretsMu.Lock()
	defer unraidSecretsMu.Unlock()
	secrets := readUnraidSecrets()
	key = strings.TrimSpace(key)
	if key == "" {
		delete(secrets.Keys, serverID)
	} else {
		secrets.Keys[serverID] = key
	}
	if len(secrets.Keys) == 0 {
		if err := os.Remove(unraidSecretsFilePath()); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	data, err := json.Marshal(secrets)
	if err != nil {
		return err
	}
	return writeFileAtomic(unraidSecretsFilePath(), data, 0600)
}

// suggestUnraidBaseURL proposes the Docker bridge gateway when nextDash runs in
// a container: on Unraid that is the host itself, where the API listens.
func suggestUnraidBaseURL() string {
	if _, err := os.Stat("/.dockerenv"); err != nil {
		return ""
	}
	f, err := os.Open("/proc/net/route")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		// Destination 00000000 is the default route; Gateway is little-endian hex.
		if len(fields) > 2 && fields[1] == "00000000" && len(fields[2]) == 8 {
			var b [4]byte
			for i := 0; i < 4; i++ {
				var v byte
				fmt.Sscanf(fields[2][6-2*i:8-2*i], "%02X", &v)
				b[i] = v
			}
			return "http://" + net.IP(b[:]).String()
		}
	}
	return ""
}
