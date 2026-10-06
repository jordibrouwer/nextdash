package app

import (
	"embed"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

/*
The demo's Docker: a small Engine API on a real unix socket, so every Docker
feature -- the Containers view, the drawer with its stats and live logs,
start, stop, restart and recreate, disk usage -- works unchanged against it,
streams included. Its containers live in memory and a reset puts them back.

Modelled on the test daemon in docker_fake_test.go, without the failure
switches the tests need, and with containers a self-hoster would recognise.
Nothing here talks to a real daemon or to a registry.
*/

type demoContainer struct {
	ID, Name, Image, ImageID, State, Health, Project string
	Created                                          int64
	Ports                                            []int
	CPU                                              float64 // percent of one core
	MemMB                                            int64
	Logs                                             []string
}

type demoDocker struct {
	mu         sync.Mutex
	containers map[string]*demoContainer
	order      []string
	seq        int
}

var demoDockerEngine = &demoDocker{}

var demoVersionPrefix = regexp.MustCompile(`^/v[0-9]+\.[0-9]+`)

func demoID(name string) string {
	id := fmt.Sprintf("%x", name)
	for len(id) < 64 {
		id += "0"
	}
	return id[:64]
}

// reset puts the containers back to the demo's start.
func (d *demoDocker) reset(now time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	day := int64(24 * 3600)
	at := func(days int64) int64 { return now.Unix() - days*day }
	list := []demoContainer{
		{Name: "jellyfin", Image: "jellyfin/jellyfin:10.10", State: "running", Health: "healthy", Project: "media", Created: at(21), Ports: []int{8096}, CPU: 4.2, MemMB: 612,
			Logs: []string{"[INF] Startup complete 0:00:04", "[INF] Scheduled task Scan Media Library completed", "[INF] Playback started: The Expanse S01E03"}},
		{Name: "sonarr", Image: "lscr.io/linuxserver/sonarr:4", State: "running", Project: "media", Created: at(21), Ports: []int{8989}, CPU: 0.8, MemMB: 287,
			Logs: []string{"[Info] RssSyncService: RSS Sync Completed. Reports found: 48", "[Info] DownloadDecisionMaker: Processing 48 releases"}},
		{Name: "radarr", Image: "lscr.io/linuxserver/radarr:5", State: "running", Project: "media", Created: at(21), Ports: []int{7878}, CPU: 0.6, MemMB: 301,
			Logs: []string{"[Info] RssSyncService: RSS Sync Completed. Reports found: 31", "[Info] ImportApprovedMovie: Imported 1 movie"}},
		{Name: "prowlarr", Image: "lscr.io/linuxserver/prowlarr:1", State: "running", Project: "media", Created: at(21), Ports: []int{9696}, CPU: 0.3, MemMB: 164,
			Logs: []string{"[Info] IndexerStatusService: 6 indexers healthy"}},
		{Name: "qbittorrent", Image: "lscr.io/linuxserver/qbittorrent:5", State: "running", Project: "media", Created: at(14), Ports: []int{8080}, CPU: 2.1, MemMB: 233,
			Logs: []string{"WebUI will be started shortly after internal preparations", "Torrent download finished: ubuntu-24.04.iso"}},
		{Name: "bazarr", Image: "lscr.io/linuxserver/bazarr:1", State: "exited", Project: "media", Created: at(30), Ports: []int{6767},
			Logs: []string{"INFO: BAZARR is started and waiting for request on http://0.0.0.0:6767", "INFO: Bazarr is being shut down..."}},
		{Name: "immich-server", Image: "ghcr.io/immich-app/immich-server:v1.120", State: "running", Health: "healthy", Project: "photos", Created: at(9), Ports: []int{2283}, CPU: 6.5, MemMB: 948,
			Logs: []string{"[Nest] LOG [Bootstrap] Immich Server is listening on http://[::1]:2283", "[Nest] LOG [JobService] Thumbnail generation finished: 214 assets"}},
		{Name: "immich-postgres", Image: "tensorchord/pgvecto-rs:pg16-v0.2", State: "running", Health: "healthy", Project: "photos", Created: at(9), CPU: 1.4, MemMB: 210,
			Logs: []string{"LOG:  database system is ready to accept connections", "LOG:  checkpoint complete"}},
		{Name: "vaultwarden", Image: "vaultwarden/server:1.32", State: "running", Health: "healthy", Project: "security", Created: at(45), Ports: []int{8000}, CPU: 0.1, MemMB: 38,
			Logs: []string{"[INFO] Rocket has launched from http://0.0.0.0:80", "[INFO] User logged in: demo@example.com"}},
		{Name: "uptime-kuma", Image: "louislam/uptime-kuma:1", State: "running", Health: "healthy", Project: "infra", Created: at(60), Ports: []int{3001}, CPU: 1.1, MemMB: 121,
			Logs: []string{"[MONITOR] INFO: Monitor #4 'Jellyfin': Successful Response: 31 ms"}},
		{Name: "homeassistant", Image: "ghcr.io/home-assistant/home-assistant:2024.12", State: "running", Project: "home", Created: at(3), Ports: []int{8123}, CPU: 3.4, MemMB: 455,
			Logs: []string{"INFO (MainThread) [homeassistant.core] Starting Home Assistant", "INFO (MainThread) [homeassistant.bootstrap] Home Assistant initialized in 6.12s"}},
		{Name: "pihole", Image: "pihole/pihole:2024.07", State: "running", Health: "healthy", Project: "infra", Created: at(60), Ports: []int{53, 8053}, CPU: 0.4, MemMB: 86,
			Logs: []string{"[✓] DNS service is running", "[✓] Pi-hole blocking is enabled"}},
		{Name: "traefik", Image: "traefik:v3.2", State: "running", Health: "unhealthy", Project: "infra", Created: at(2), Ports: []int{80, 443}, CPU: 0.7, MemMB: 74,
			Logs: []string{"level=info msg=\"Configuration loaded from flags.\"", "level=error msg=\"Unable to obtain ACME certificate for domains\" providerName=letsencrypt.acme"}},
		{Name: "nextdash", Image: "ghcr.io/jordibrouwer/nextdash:latest", State: "running", Project: "infra", Created: at(1), Ports: []int{8080}, CPU: 0.2, MemMB: 29,
			Logs: []string{"INFO server starting on port 8080", "INFO server demo mode"}},
	}
	d.containers = map[string]*demoContainer{}
	d.order = d.order[:0]
	for i := range list {
		c := list[i]
		c.ID = demoID(c.Name)
		c.ImageID = "sha256:" + demoID(c.Image)
		d.containers[c.ID] = &c
		d.order = append(d.order, c.ID)
	}
}

func (d *demoDocker) resolve(idOrName string) *demoContainer {
	if c, ok := d.containers[idOrName]; ok {
		return c
	}
	for _, c := range d.containers {
		if c.Name == idOrName || (len(idOrName) >= 12 && strings.HasPrefix(c.ID, idOrName)) {
			return c
		}
	}
	return nil
}

func (c *demoContainer) status(now time.Time) string {
	switch c.State {
	case "running":
		up := now.Sub(time.Unix(c.Created, 0))
		text := fmt.Sprintf("Up %d days", int(up.Hours()/24))
		if up < 48*time.Hour {
			text = fmt.Sprintf("Up %d hours", int(up.Hours()))
		}
		if c.Health != "" {
			text += " (" + c.Health + ")"
		}
		return text
	case "paused":
		return "Up (Paused)"
	case "exited":
		return "Exited (0) 3 hours ago"
	}
	return "Created"
}

func (c *demoContainer) labels() map[string]string {
	return map[string]string{
		"com.docker.compose.project": c.Project,
		"com.docker.compose.service": c.Name,
	}
}

func (c *demoContainer) ports() []map[string]any {
	out := []map[string]any{}
	for _, port := range c.Ports {
		out = append(out, map[string]any{"IP": "0.0.0.0", "PrivatePort": port, "PublicPort": port, "Type": "tcp"})
	}
	return out
}

func (c *demoContainer) networks() map[string]map[string]any {
	return map[string]map[string]any{c.Project + "_default": {"IPAddress": "172.20.0." + fmt.Sprint(len(c.Name)+2)}}
}

func demoJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (d *demoDocker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if m := demoVersionPrefix.FindString(path); m != "" {
		path = strings.TrimPrefix(path, m)
	}
	now := time.Now()

	// The streams hold their connection open without holding the state lock.
	switch {
	case r.Method == http.MethodGet && path == "/events":
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if fl, ok := w.(http.Flusher); ok {
			fl.Flush()
		}
		<-r.Context().Done()
		return
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/containers/") && strings.HasSuffix(path, "/logs"):
		d.serveLogs(w, r, strings.TrimSuffix(strings.TrimPrefix(path, "/containers/"), "/logs"))
		return
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	switch {
	case path == "/version":
		demoJSON(w, http.StatusOK, map[string]string{"ApiVersion": "1.47", "MinAPIVersion": "1.24", "Version": "27.3.1"})
	case path == "/_ping":
		_, _ = w.Write([]byte("OK"))
	case path == "/info":
		demoJSON(w, http.StatusOK, map[string]any{"Images": len(d.containers), "Containers": len(d.containers)})
	case r.Method == http.MethodGet && path == "/containers/json":
		d.serveList(w, now)
	case r.Method == http.MethodGet && path == "/networks":
		seen := map[string]bool{}
		nets := []map[string]any{{"Name": "bridge", "Driver": "bridge"}}
		for _, c := range d.containers {
			if name := c.Project + "_default"; !seen[name] {
				seen[name] = true
				nets = append(nets, map[string]any{"Name": name, "Driver": "bridge"})
			}
		}
		demoJSON(w, http.StatusOK, nets)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/containers/") && strings.HasSuffix(path, "/json"):
		d.serveInspect(w, strings.TrimSuffix(strings.TrimPrefix(path, "/containers/"), "/json"))
	case r.Method == http.MethodGet && path == "/images/json":
		out := []map[string]any{}
		for _, c := range d.containers {
			out = append(out, map[string]any{"Id": c.ImageID, "RepoTags": []string{c.Image}})
		}
		demoJSON(w, http.StatusOK, out)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/images/") && strings.HasSuffix(path, "/json"):
		ref := strings.TrimSuffix(strings.TrimPrefix(path, "/images/"), "/json")
		for _, c := range d.containers {
			if c.Image == ref || c.ImageID == ref {
				demoJSON(w, http.StatusOK, map[string]any{"Id": c.ImageID, "RepoDigests": []string{}, "Config": map[string]any{"Labels": map[string]string{}}})
				return
			}
		}
		demoJSON(w, http.StatusNotFound, map[string]string{"message": "no such image"})
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/containers/") && strings.HasSuffix(path, "/stats"):
		d.serveStats(w, strings.TrimSuffix(strings.TrimPrefix(path, "/containers/"), "/stats"), now)
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/containers/") && path != "/containers/create":
		d.serveAction(w, r, path)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/containers/"):
		if c := d.resolve(strings.TrimPrefix(path, "/containers/")); c != nil {
			delete(d.containers, c.ID)
		}
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodPost && path == "/containers/create":
		d.serveCreate(w, r, now)
	case r.Method == http.MethodPost && path == "/images/create":
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"status\":\"Pulling\"}\n{\"status\":\"Image is up to date\"}\n"))
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/networks/"):
		w.WriteHeader(http.StatusOK)
	case r.Method == http.MethodGet && path == "/system/df":
		d.serveDF(w)
	case r.Method == http.MethodPost && (path == "/images/prune" || path == "/build/prune"):
		demoJSON(w, http.StatusOK, map[string]any{"SpaceReclaimed": 0})
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/volumes/"):
		w.WriteHeader(http.StatusNoContent)
	default:
		demoJSON(w, http.StatusNotFound, map[string]string{"message": "page not found"})
	}
}

func (d *demoDocker) serveList(w http.ResponseWriter, now time.Time) {
	out := []map[string]any{}
	for _, id := range d.order {
		c, ok := d.containers[id]
		if !ok {
			continue
		}
		out = append(out, map[string]any{
			"Id": c.ID, "Names": []string{"/" + c.Name}, "Image": c.Image, "ImageID": c.ImageID,
			"State": c.State, "Status": c.status(now), "Created": c.Created, "Labels": c.labels(),
			"Ports": c.ports(), "HostConfig": map[string]any{"NetworkMode": c.Project + "_default"},
			"NetworkSettings": map[string]any{"Networks": c.networks()}, "Mounts": []any{},
			"SizeRw": 12 << 20, "SizeRootFs": c.MemMB << 21,
		})
	}
	demoJSON(w, http.StatusOK, out)
}

func (d *demoDocker) serveInspect(w http.ResponseWriter, id string) {
	c := d.resolve(id)
	if c == nil {
		demoJSON(w, http.StatusNotFound, map[string]string{"message": "no such container"})
		return
	}
	var health any
	if c.Health != "" {
		health = map[string]any{"Status": c.Health, "FailingStreak": map[bool]int{true: 3, false: 0}[c.Health == "unhealthy"]}
	}
	demoJSON(w, http.StatusOK, map[string]any{
		"Id": c.ID, "Name": "/" + c.Name, "Image": c.ImageID,
		"Created": time.Unix(c.Created, 0).UTC().Format(time.RFC3339Nano),
		"State": map[string]any{
			"Status": c.State, "Paused": c.State == "paused", "Running": c.State == "running" || c.State == "paused",
			"StartedAt": time.Unix(c.Created, 0).UTC().Format(time.RFC3339Nano), "Health": health,
		},
		"Config": map[string]any{"Image": c.Image, "Env": []string{"TZ=America/New_York"}, "Labels": c.labels(), "Tty": false},
		"HostConfig": map[string]any{
			"RestartPolicy": map[string]any{"Name": "unless-stopped"}, "Binds": []string{},
			"NetworkMode": c.Project + "_default",
		},
		"Mounts":          []any{},
		"NetworkSettings": map[string]any{"Networks": c.networks()},
	})
}

func (d *demoDocker) serveStats(w http.ResponseWriter, id string, now time.Time) {
	c := d.resolve(id)
	if c == nil {
		demoJSON(w, http.StatusNotFound, map[string]string{"message": "no such container"})
		return
	}
	cpu, mem := c.CPU, c.MemMB
	if c.State != "running" {
		cpu, mem = 0, 0
	}
	// Counters that grow with time, as the daemon's do: the view works out a
	// percentage from two reads, and from cpu against precpu in one. A little
	// movement, so the drawer's chart is not a ruler.
	// The rate swings a quarter either way over about half a minute: usage
	// is the integral of cpu*(1+0.25*cos(t/5)), so two reads agree with it.
	const cores = 2
	seconds := float64(now.UnixNano()) / 1e9
	usage := func(at float64) int64 { return int64((at + 1.25*math.Sin(at/5)) * cpu / 100 * 1e9) }
	system := func(at float64) int64 { return int64(at * 1e9 * cores) }
	demoJSON(w, http.StatusOK, map[string]any{
		"cpu_stats":    map[string]any{"cpu_usage": map[string]any{"total_usage": usage(seconds)}, "system_cpu_usage": system(seconds), "online_cpus": cores},
		"precpu_stats": map[string]any{"cpu_usage": map[string]any{"total_usage": usage(seconds - 1)}, "system_cpu_usage": system(seconds - 1)},
		"memory_stats": map[string]any{"usage": mem << 20, "limit": int64(8) << 30, "stats": map[string]any{"inactive_file": 0}},
	})
}

func (d *demoDocker) serveAction(w http.ResponseWriter, r *http.Request, path string) {
	rest := strings.TrimPrefix(path, "/containers/")
	slash := strings.LastIndex(rest, "/")
	if slash < 0 {
		demoJSON(w, http.StatusNotFound, map[string]string{"message": "page not found"})
		return
	}
	c := d.resolve(rest[:slash])
	if c == nil {
		demoJSON(w, http.StatusNotFound, map[string]string{"message": "no such container"})
		return
	}
	switch rest[slash+1:] {
	case "start", "restart", "unpause":
		c.State = "running"
		c.Created = time.Now().Unix()
	case "stop", "kill":
		c.State = "exited"
	case "pause":
		c.State = "paused"
	case "rename":
		if name := r.URL.Query().Get("name"); name != "" {
			c.Name = name
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// serveCreate makes the replacement a recreate asks for, with the old one's
// look: the demo has one of each.
func (d *demoDocker) serveCreate(w http.ResponseWriter, r *http.Request, now time.Time) {
	name := r.URL.Query().Get("name")
	var body struct {
		Image string `json:"Image"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body)
	d.seq++
	base := demoContainer{Image: body.Image, Project: "infra", CPU: 0.5, MemMB: 64}
	for _, c := range d.containers {
		if c.Image == body.Image {
			base = *c
		}
	}
	base.Name, base.State, base.Created = name, "created", now.Unix()
	base.ID = demoID(fmt.Sprintf("%s-%d", name, d.seq))
	if len(d.containers) >= 40 {
		demoJSON(w, http.StatusConflict, map[string]string{"message": "the demo holds no more containers"})
		return
	}
	d.containers[base.ID] = &base
	d.order = append(d.order, base.ID)
	demoJSON(w, http.StatusCreated, map[string]string{"Id": base.ID})
}

func (d *demoDocker) serveDF(w http.ResponseWriter) {
	images, containers := []map[string]any{}, []map[string]any{}
	var layers int64
	for _, id := range d.order {
		c, ok := d.containers[id]
		if !ok {
			continue
		}
		size := c.MemMB << 21
		layers += size
		images = append(images, map[string]any{"Id": c.ImageID, "RepoTags": []string{c.Image}, "Size": size, "SharedSize": 0})
		containers = append(containers, map[string]any{"Id": c.ID, "SizeRw": 12 << 20, "SizeRootFs": size})
	}
	images = append(images, map[string]any{"Id": "sha256:" + demoID("old-jellyfin"), "RepoTags": []string{}, "Size": int64(780) << 20, "SharedSize": 0})
	demoJSON(w, http.StatusOK, map[string]any{
		"LayersSize": layers + 780<<20, "Images": images, "Containers": containers,
		"Volumes": []map[string]any{
			{"Name": "immich_pgdata", "Driver": "local", "UsageData": map[string]any{"Size": int64(2100) << 20, "RefCount": 1}},
			{"Name": "media_config", "Driver": "local", "UsageData": map[string]any{"Size": int64(340) << 20, "RefCount": 4}},
			{"Name": "old_portainer_data", "Driver": "local", "UsageData": map[string]any{"Size": int64(96) << 20, "RefCount": 0}},
		},
		"BuildCache": []map[string]any{},
	})
}

// serveLogs writes the container's lines in the daemon's framed format, with
// timestamps when asked, and with follow holds the stream open, adding a line
// now and then the way a live container does.
func (d *demoDocker) serveLogs(w http.ResponseWriter, r *http.Request, id string) {
	d.mu.Lock()
	c := d.resolve(id)
	var lines []string
	if c != nil {
		lines = append(lines, c.Logs...)
	}
	running := c != nil && c.State == "running"
	d.mu.Unlock()
	if c == nil {
		demoJSON(w, http.StatusNotFound, map[string]string{"message": "no such container"})
		return
	}
	w.WriteHeader(http.StatusOK)
	stamps := r.URL.Query().Get("timestamps") == "1"
	start := time.Now().Add(-time.Duration(len(lines)) * 7 * time.Minute)
	write := func(at time.Time, line string) {
		full := line + "\n"
		if stamps {
			full = at.UTC().Format(time.RFC3339Nano) + " " + full
		}
		header := make([]byte, 8)
		header[0] = 1
		binary.BigEndian.PutUint32(header[4:], uint32(len(full)))
		_, _ = w.Write(header)
		_, _ = w.Write([]byte(full))
	}
	for i, line := range lines {
		write(start.Add(time.Duration(i)*7*time.Minute), line)
	}
	if r.URL.Query().Get("follow") != "1" || !running {
		return
	}
	fl, _ := w.(http.Flusher)
	if fl != nil {
		fl.Flush()
	}
	ticker := time.NewTicker(8 * time.Second)
	defer ticker.Stop()
	for i := 0; ; i++ {
		select {
		case <-r.Context().Done():
			return
		case at := <-ticker.C:
			write(at, fmt.Sprintf("[INF] heartbeat %d: all good", i+1))
			if fl != nil {
				fl.Flush()
			}
		}
	}
}

/*
startDemoDocker puts the demo's daemon on a socket outside the data directory
(a reset empties that) and points nextDash's Docker features at it, with the
container actions switched on: in the demo they only change this state.
*/
func startDemoDocker() error {
	dir, err := os.MkdirTemp("", "ndd")
	if err != nil {
		return err
	}
	socket := filepath.Join(dir, "docker.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return err
	}
	demoDockerEngine.reset(time.Now())
	server := &http.Server{Handler: demoDockerEngine, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = server.Serve(listener) }()
	if err := os.Setenv("NEXTDASH_DOCKER_SOCKET", socket); err != nil {
		return err
	}
	return os.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
}

//go:embed demo_unraid/*.json
var demoUnraidFS embed.FS

// demoUnraidServerID is the demo's one Unraid server; its answers come from
// the embedded fixture, never from a network.
const demoUnraidServerID = "tower"

/*
startDemoUnraid writes the embedded Unraid answers to a directory outside the
data directory and points the Unraid client at it, the way the tests do with
NEXTDASH_UNRAID_FIXTURE: the Unraid view and its widgets read a server that
does not exist.
*/
func startDemoUnraid() error {
	dir, err := os.MkdirTemp("", "ndu")
	if err != nil {
		return err
	}
	entries, err := demoUnraidFS.ReadDir("demo_unraid")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		data, err := demoUnraidFS.ReadFile("demo_unraid/" + entry.Name())
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, entry.Name()), data, 0o644); err != nil {
			return err
		}
	}
	return os.Setenv("NEXTDASH_UNRAID_FIXTURE", dir)
}
