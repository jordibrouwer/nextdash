package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Glances: how one machine is doing, on the shared media tile.

Glances is read only and speaks plain JSON under /api/4. It can sit behind
nothing, a Basic login or a header, so the credential is optional; a login it
refuses is told apart from a key (errMediaLogin). Version 3 answers under
/api/3 and 404s every /api/4 path, which is the one thing worth telling the
reader in words: needs Glances 4.

A plugin the server has switched off 404s on its own. That is not a failure:
the part is skipped and the tile draws what is there. Any other part that
fails marks the answer partial, and a failed quicklook (cpu, memory, swap)
leaves nothing worth drawing, so it is an error answer.
*/

const (
	glancesDefaultRows = 8
	glancesDefaultTTL  = 30
	glancesMinTTL      = 10
	// glancesAPI is the prefix every path is asked under.
	glancesAPI = "/api/4"
	// glancesLargeBody caps the two answers that grow with the machine: every
	// process, every container. Other paths keep the media cap.
	glancesLargeBody = 16 << 20

	glancesWarnPercent = 80
	glancesBadPercent  = 90
)

var (
	errGlancesNotFound = errors.New("not available")
	errGlancesNeedsV4  = errors.New("needs Glances 4")
)

// glancesPseudoFS are filesystem types that are not storage a reader chose.
var glancesPseudoFS = map[string]bool{
	"tmpfs": true, "devtmpfs": true, "overlay": true, "squashfs": true,
	"proc": true, "sysfs": true, "ramfs": true,
}

// glancesPseudoMounts are mount points under which nothing is the reader's own.
var glancesPseudoMounts = []string{"/snap", "/run", "/sys", "/proc", "/dev"}

func glancesWidgetFields() []widgetField {
	return []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		// What the tile draws; the server sends them all.
		{Key: "meters", Kind: "list", Allowed: []string{"cpu", "mem", "swap", "load", "disk", "net", "temp"}},
		// Mount points to show; empty means every real filesystem.
		{Key: "filesystems", Kind: "list"},
		{Key: "click", Kind: "string", Allowed: []string{"open", "detail"}},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "ttl", Kind: "int", Min: glancesMinTTL, Max: 3600},
	}
}

type glancesSpec struct {
	Server       string
	CredentialID string
	Meters       []string
	Filesystems  []string
	Rows         int
	TTL          time.Duration
}

func glancesSpecFrom(config map[string]any) glancesSpec {
	spec := glancesSpec{
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		Meters:       widgetConfigList(config["meters"], nil),
		Filesystems:  widgetConfigList(config["filesystems"], nil),
		Rows:         glancesDefaultRows,
		TTL:          glancesDefaultTTL * time.Second,
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, glancesMinTTL, 3600)) * time.Second
	}
	return spec
}

// fingerprint changes with every setting that changes what the tile is told.
func (spec glancesSpec) fingerprint() string {
	return strings.Join([]string{spec.Server, spec.CredentialID, strings.Join(spec.Meters, ","),
		strings.Join(spec.Filesystems, ","), strconv.Itoa(spec.Rows)}, "|")
}

// beat is how long an answer lives: a second under the tile's beat.
func (spec glancesSpec) beat() time.Duration { return spec.TTL - time.Second }

// ---- the server's answer ----

// Every reading is a pointer: a plugin that leaves one out is absent, not 0.
type glancesQuicklook struct {
	CPU  *float64 `json:"cpu"`
	Mem  *float64 `json:"mem"`
	Swap *float64 `json:"swap"`
}

type glancesLoad struct {
	Min1  *float64 `json:"min1"`
	Min5  *float64 `json:"min5"`
	Min15 *float64 `json:"min15"`
}

type glancesFS struct {
	MntPoint string   `json:"mnt_point"`
	FSType   string   `json:"fs_type"`
	Percent  *float64 `json:"percent"`
}

// glancesNet carries the rates only when Glances has had two samples to
// subtract; the first answer after a start has none.
type glancesNet struct {
	Name     string   `json:"interface_name"`
	IsUp     bool     `json:"is_up"`
	RecvRate *float64 `json:"bytes_recv_rate_per_sec"`
	SentRate *float64 `json:"bytes_sent_rate_per_sec"`
}

type glancesSensor struct {
	Label    string   `json:"label"`
	Type     string   `json:"type"`
	Value    *float64 `json:"value"`
	Unit     string   `json:"unit"`
	Warning  *float64 `json:"warning"`
	Critical *float64 `json:"critical"`
}

type glancesSystem struct {
	Hostname string `json:"hostname"`
	HrName   string `json:"hr_name"`
}

type glancesAlert struct {
	End float64 `json:"end"`
}

// glancesHistory is /cpu/history/<n>: [timestamp, value] pairs, oldest first.
type glancesHistory struct {
	Total [][]json.RawMessage `json:"total"`
}

// spark is the total series as numbers; a pair without a number is skipped,
// and fewer than two points is no line at all.
func (hist glancesHistory) spark() []float64 {
	var out []float64
	for _, pair := range hist.Total {
		if len(pair) < 2 {
			continue
		}
		var v *float64
		if json.Unmarshal(pair[1], &v) != nil || v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) {
			continue
		}
		out = append(out, beszelRound(*v, 1))
	}
	if len(out) < 2 {
		return nil
	}
	return out
}

// glancesTone says how far over its line a percentage is: 0 fine, 1 warn, 2 bad.
func glancesTone(value *float64) int {
	return beszelTone(value, glancesWarnPercent, glancesBadPercent)
}

// glancesSensorTone uses the lines the machine reports for the sensor, and the
// tile's usual temperature lines when it reports none.
func glancesSensorTone(t MediaTemp) int {
	switch {
	case t.Crit != nil && t.Value >= *t.Crit:
		return 2
	case t.Warn != nil && t.Value >= *t.Warn:
		return 1
	case t.Warn != nil || t.Crit != nil:
		return 0
	}
	return beszelTone(&t.Value, beszelWarnTemp, beszelBadTemp)
}

func glancesIsPseudo(fs glancesFS) bool {
	if glancesPseudoFS[fs.FSType] {
		return true
	}
	for _, prefix := range glancesPseudoMounts {
		if fs.MntPoint == prefix || strings.HasPrefix(fs.MntPoint, prefix+"/") {
			return true
		}
	}
	return false
}

// glancesFilesystems: the chosen mount points, or every real one, fullest first.
func glancesFilesystems(fs []glancesFS, spec glancesSpec) []MediaFs {
	chosen := map[string]bool{}
	for _, name := range spec.Filesystems {
		chosen[name] = true
	}
	var out []MediaFs
	for _, f := range fs {
		if f.Percent == nil {
			continue
		}
		if len(chosen) > 0 && !chosen[f.MntPoint] || len(chosen) == 0 && glancesIsPseudo(f) {
			continue
		}
		out = append(out, MediaFs{Name: f.MntPoint, Pct: beszelRound(*f.Percent, 1)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Pct > out[j].Pct })
	return out
}

// glancesTemps are the temperature sensors, hottest first. Fans and batteries
// share the list in Glances; only degrees are kept.
func glancesTemps(sensors []glancesSensor) []MediaTemp {
	var out []MediaTemp
	for _, s := range sensors {
		if s.Value == nil || !strings.HasPrefix(s.Type, "temperature") {
			continue
		}
		out = append(out, MediaTemp{Name: s.Label, Value: *s.Value, Warn: s.Warning, Crit: s.Critical})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Value > out[j].Value })
	return out
}

// glancesVirtualNIC is an interface that only carries traffic between things on
// this machine, which would count the same bytes twice.
func glancesVirtualNIC(name string) bool {
	if name == "lo" {
		return true
	}
	for _, prefix := range []string{"docker", "veth", "br-", "virbr"} {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

// glancesRates sums received and sent over the real interfaces that are up.
// Not one reading yet: nil, never 0.
func glancesRates(net []glancesNet) (down, up *int64) {
	var recv, sent float64
	var haveRecv, haveSent bool
	for _, n := range net {
		if !n.IsUp || glancesVirtualNIC(n.Name) {
			continue
		}
		if n.RecvRate != nil {
			recv, haveRecv = recv+*n.RecvRate, true
		}
		if n.SentRate != nil {
			sent, haveSent = sent+*n.SentRate, true
		}
	}
	if haveRecv {
		v := int64(math.Round(recv))
		down = &v
	}
	if haveSent {
		v := int64(math.Round(sent))
		up = &v
	}
	return down, up
}

// glancesMeters is what the tile draws for the machine. Pure: every part that
// was skipped arrives empty and leaves its meter absent.
func glancesMeters(q glancesQuicklook, fs []glancesFS, net []glancesNet, sensors []glancesSensor, load glancesLoad, spec glancesSpec) *MediaMeters {
	m := &MediaMeters{Status: "up", CPU: beszelPercent(q.CPU), Mem: beszelPercent(q.Mem), Swap: beszelPercent(q.Swap)}
	if load.Min1 != nil && load.Min5 != nil && load.Min15 != nil {
		m.Load = []float64{beszelRound(*load.Min1, 2), beszelRound(*load.Min5, 2), beszelRound(*load.Min15, 2)}
	}
	m.Fs = glancesFilesystems(fs, spec)
	// The root is the disk meter; a machine without one shows its fullest.
	for _, f := range m.Fs {
		if m.Disk == nil || f.Name == "/" {
			pct := f.Pct
			m.Disk = &pct
			if f.Name == "/" {
				break
			}
		}
	}
	m.Temps = glancesTemps(sensors)
	if len(m.Temps) > 0 {
		hottest := m.Temps[0].Value
		m.Temp = &hottest
	}
	m.Net, m.NetUp = glancesRates(net)
	return m
}

var glancesUptimeRe = regexp.MustCompile(`^(?:(\d+) days?, )?(\d+):(\d+):(\d+)`)

// glancesUptime reads "12 days, 3:04:05"; 0 when it is worded some other way.
func glancesUptime(text string) int64 {
	m := glancesUptimeRe.FindStringSubmatch(text)
	if m == nil {
		return 0
	}
	n := func(s string) int64 { v, _ := strconv.ParseInt(s, 10, 64); return v }
	return n(m[1])*86400 + n(m[2])*3600 + n(m[3])*60 + n(m[4])
}

// ---- asking the server ----

// glancesGet asks one path under /api/4. A 404 is a plugin that is off, except
// for /status, whose 404 is a server that is not version 4. A refused login is
// not a refused key.
func (h *Handlers) glancesGet(ctx context.Context, server string, credential HealthCredential, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, glancesAPI+path, query, "application/json", nil)
	if err != nil {
		var status *mediaHTTPError
		switch {
		case errors.As(err, &status) && status.Status == 404 && path == "/status":
			return errGlancesNeedsV4
		case errors.As(err, &status) && status.Status == 404:
			return errGlancesNotFound
		case errors.Is(err, errMediaRefused):
			return fmt.Errorf("%w: %v", errMediaLogin, err)
		}
		return err
	}
	defer resp.Body.Close()
	limit := int64(jellyfinMaxBody)
	if path == "/processlist" || path == "/containers" {
		limit = glancesLargeBody
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, limit)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

// glancesAnswer is the tile's answer, through the shared media cache.
func (h *Handlers) glancesAnswer(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
	spec := glancesSpecFrom(widget.Config)
	ms := mediaSpec{Service: "glances", Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.beat()}
	return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		result, err := h.fetchGlances(ctx, spec)
		return result, nil, err
	}, forced)
}

func (h *Handlers) fetchGlances(ctx context.Context, spec glancesSpec) (MediaResult, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
	if spec.Server == "" {
		return result, errMediaNotSetUp
	}
	// The credential is optional: a Glances server may be open.
	var credential HealthCredential
	if spec.CredentialID != "" {
		var ok bool
		if credential, ok = lookupHealthCredential(spec.CredentialID); !ok {
			return result, errMediaNotSetUp
		}
	}

	var (
		quick   glancesQuicklook
		load    glancesLoad
		fs      []glancesFS
		net     []glancesNet
		sensors []glancesSensor
		system  glancesSystem
		uptime  string
		alerts  []glancesAlert
		history glancesHistory
	)
	// Every part is asked at once; each is its own request with its own timeout.
	parts := []struct {
		path string
		out  any
	}{
		{"/quicklook", &quick}, {"/load", &load}, {"/fs", &fs}, {"/network", &net},
		{"/sensors", &sensors}, {"/system", &system}, {"/uptime", &uptime}, {"/alert", &alerts},
		{"/cpu/history/60", &history},
	}
	const historyPart = 8
	errs := make([]error, len(parts))
	var wg sync.WaitGroup
	for i, part := range parts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = h.glancesGet(ctx, spec.Server, credential, part.path, nil, part.out)
		}()
	}
	wg.Wait()

	if err := errs[0]; err != nil {
		if errors.Is(err, errGlancesNotFound) {
			// Every path 404s on version 3: ask the one that says so.
			var status map[string]any
			if h.glancesGet(ctx, spec.Server, credential, "/status", nil, &status) == errGlancesNeedsV4 {
				return result, errGlancesNeedsV4
			}
		}
		return result, err
	}
	for i, err := range errs[1:] {
		// The CPU stretch is the nice-to-have: without it the tile has its meters.
		if i+1 == historyPart {
			if err != nil && !errors.Is(err, errGlancesNotFound) {
				logWarn(logComponentWidgets, "glances widget history for %s: %v", hostOf(spec.Server), err)
			}
			continue
		}
		if err != nil && !errors.Is(err, errGlancesNotFound) {
			result.Partial = true
		}
	}

	m := glancesMeters(quick, fs, net, sensors, load, spec)
	m.Host, m.OS = system.Hostname, system.HrName
	m.Uptime = glancesUptime(uptime)
	if errs[historyPart] == nil {
		m.Spark = history.spark()
	}
	for _, a := range alerts {
		if a.End < 0 {
			m.Alerts++
		}
	}
	title := system.Hostname
	if title == "" {
		title = "Glances"
	}
	result.Items = []MediaItem{{ID: "glances", Title: title, Kind: "system", OpenURL: spec.Server, Meters: m}}
	return result, nil
}
