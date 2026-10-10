package app

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

/*
The status page: one read-only page, behind one secret link, that tells the
people who use this install's services whether those services work.

Two files. status-page.json is the layout the owner made and travels with a
backup. status-page-secrets.json holds the link's token and never does: a
restore on another box must not bring an old link back to life.
*/

const (
	statusPageMaxGroups   = 20
	statusPageMaxServices = 50
	statusNameMax         = 80
	statusTitleMax        = 120
	statusNoticeMax       = 500
)

type StatusPageConfig struct {
	Enabled bool          `json:"enabled"`
	Title   string        `json:"title"`
	Notice  string        `json:"notice,omitempty"`
	LANOnly bool          `json:"lanOnly"`
	Groups  []StatusGroup `json:"groups"`
}

type StatusGroup struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Services []StatusService `json:"services"`
}

// StatusService is one row on the page: a monitored bookmark, a container, or
// both, where the worse of the two counts.
type StatusService struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	MonitorURL string `json:"monitorUrl,omitempty"`
	Container  string `json:"container,omitempty"`
	ShowLink   bool   `json:"showLink"`
	ShowSpeed  bool   `json:"showSpeed"`
}

// statusPageMu serialises read-modify-write of both status page files.
var statusPageMu sync.Mutex

func statusPageFilePath() string {
	return filepath.Join(ResolveDataDir(), "status-page.json")
}

func statusSecretsFilePath() string {
	return filepath.Join(ResolveDataDir(), "status-page-secrets.json")
}

func newStatusID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func clipRunes(s string, max int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > max {
		r = r[:max]
	}
	return string(r)
}

func normalizeStatusPage(c StatusPageConfig) StatusPageConfig {
	out := StatusPageConfig{
		Enabled: c.Enabled,
		Title:   clipRunes(c.Title, statusTitleMax),
		Notice:  clipRunes(c.Notice, statusNoticeMax),
		LANOnly: c.LANOnly,
		Groups:  []StatusGroup{},
	}
	seen := map[string]bool{}
	uniqueID := func(id string) string {
		id = strings.TrimSpace(id)
		for id == "" || seen[id] {
			id = newStatusID()
		}
		seen[id] = true
		return id
	}
	for _, g := range c.Groups {
		if len(out.Groups) == statusPageMaxGroups {
			break
		}
		group := StatusGroup{ID: uniqueID(g.ID), Name: clipRunes(g.Name, statusNameMax), Services: []StatusService{}}
		for _, s := range g.Services {
			if len(group.Services) == statusPageMaxServices {
				break
			}
			s.MonitorURL = strings.TrimSpace(s.MonitorURL)
			s.Container = strings.TrimSpace(s.Container)
			if s.MonitorURL == "" && s.Container == "" {
				continue
			}
			s.ID = uniqueID(s.ID)
			s.Name = clipRunes(s.Name, statusNameMax)
			if s.Name == "" {
				if s.Container != "" {
					s.Name = s.Container
				} else {
					s.Name = s.MonitorURL
				}
			}
			group.Services = append(group.Services, s)
		}
		out.Groups = append(out.Groups, group)
	}
	return out
}

// readStatusPage reads the layout. A missing file is an empty, disabled page;
// an unreadable one is an error, so the page answers 404 and Config can say why.
func readStatusPage() (StatusPageConfig, error) {
	data, err := os.ReadFile(statusPageFilePath())
	if errors.Is(err, os.ErrNotExist) {
		return normalizeStatusPage(StatusPageConfig{}), nil
	}
	if err != nil {
		return StatusPageConfig{}, err
	}
	var c StatusPageConfig
	if err := json.Unmarshal(data, &c); err != nil {
		return StatusPageConfig{}, err
	}
	return normalizeStatusPage(c), nil
}

func writeStatusPage(c StatusPageConfig) error {
	return writeIndentJSONFile(statusPageFilePath(), normalizeStatusPage(c))
}

const statusTokenMinLen = 32

type statusSecrets struct {
	Token string `json:"token"`
}

func newStatusToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func readStatusToken() string {
	data, err := os.ReadFile(statusSecretsFilePath())
	if err != nil {
		return ""
	}
	var s statusSecrets
	if json.Unmarshal(data, &s) != nil {
		return ""
	}
	return strings.TrimSpace(s.Token)
}

func writeStatusToken(token string) error {
	data, err := json.Marshal(statusSecrets{Token: token})
	if err != nil {
		return err
	}
	return writeFileAtomic(statusSecretsFilePath(), data, 0600)
}

func ensureStatusToken() (string, error) {
	statusPageMu.Lock()
	defer statusPageMu.Unlock()
	if tok := readStatusToken(); len(tok) >= statusTokenMinLen {
		return tok, nil
	}
	tok, err := newStatusToken()
	if err != nil {
		return "", err
	}
	return tok, writeStatusToken(tok)
}

func rotateStatusToken() (string, error) {
	statusPageMu.Lock()
	defer statusPageMu.Unlock()
	tok, err := newStatusToken()
	if err != nil {
		return "", err
	}
	return tok, writeStatusToken(tok)
}

// statusTokenMatches compares in constant time. A stored token shorter than
// the minimum (a hand edit) opens nothing.
func statusTokenMatches(given string) bool {
	tok := readStatusToken()
	if len(tok) < statusTokenMinLen || len(given) < statusTokenMinLen {
		return false
	}
	return tokensMatch(given, tok)
}
