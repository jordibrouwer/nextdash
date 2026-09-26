package app

import (
	"encoding/binary"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

/*
A fake Docker daemon shared by every docker_*_test.go file.

The real Engine API is a unix socket serving JSON, so a stub http.Server on a
real unix listener exercises the whole client -- URL building, method, query
string, status handling -- rather than a mocked http.RoundTripper that would
only prove the test author's idea of the API matches the code's idea of it.
*/

type fakeDocker struct {
	mu         sync.Mutex
	containers map[string]*fakeContainer // by full id
	images     map[string]fakeImage      // by ref and by id
	calls      []string                  // "POST /containers/abc/stop", in order
	failCreate bool
	failStart  map[string]bool // by container name
	socket     string
}

type fakeContainer struct {
	ID, Name, Image, ImageID, State, Status string
	Created                                 int64
	Labels                                  map[string]string
	Ports                                   []map[string]any
	Env                                     []string
	Mounts                                  []map[string]any
	Networks                                map[string]map[string]any
	RestartPolicy                           string
	NetworkMode                             string
	Logs                                    []string
	created                                 bool // set once /containers/create has made it
}

type fakeImage struct {
	ID          string
	RepoDigests []string
	Labels      map[string]string
}

// startFakeDocker starts the daemon on a short-path unix socket -- not
// t.TempDir(): a unix socket path is capped around 104 bytes on macOS, and the
// per-test temp directory alone is longer than that. See
// system_docker_test.go's TestDockerClientReachesUnixSocket for the same fix.
func startFakeDocker(t *testing.T) *fakeDocker {
	t.Helper()
	dir, err := os.MkdirTemp("", "nd")
	if err != nil {
		t.Fatalf("temp dir: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	socket := filepath.Join(dir, "d.sock")

	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Skipf("unix sockets unavailable here: %v", err)
	}

	f := &fakeDocker{
		containers: map[string]*fakeContainer{},
		images:     map[string]fakeImage{},
		failStart:  map[string]bool{},
		socket:     socket,
	}
	server := &httptest.Server{
		Listener: listener,
		Config:   &http.Server{Handler: http.HandlerFunc(f.handle)},
	}
	server.Start()
	t.Cleanup(server.Close)

	t.Setenv("NEXTDASH_DOCKER_SOCKET", socket)
	return f
}

func (f *fakeDocker) add(c fakeContainer) {
	f.mu.Lock()
	defer f.mu.Unlock()
	// A container added by a test is the original; only /containers/create
	// marks one as new, so failStart can fail the replacement and not the
	// container a rollback restarts.
	cp := c
	cp.created = false
	f.containers[cp.ID] = &cp
}

func (f *fakeDocker) called(prefix string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}

func (f *fakeDocker) record(method, path string) {
	f.calls = append(f.calls, method+" "+path)
}

// resolve finds a container by full id, a unique id prefix of at least 12
// characters, or an exact name.
func (f *fakeDocker) resolve(idOrName string) *fakeContainer {
	if c, ok := f.containers[idOrName]; ok {
		return c
	}
	if len(idOrName) >= 12 {
		var match *fakeContainer
		for id, c := range f.containers {
			if strings.HasPrefix(id, idOrName) {
				if match != nil {
					return nil // ambiguous prefix
				}
				match = c
			}
		}
		if match != nil {
			return match
		}
	}
	for _, c := range f.containers {
		if c.Name == idOrName {
			return c
		}
	}
	return nil
}

func writeJSONFake(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (f *fakeDocker) handle(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()

	// Every request the client sends is versioned ("/v1.41/..."); route on
	// what follows that prefix, the way the plan's table names paths.
	path := strings.TrimPrefix(r.URL.Path, "/"+dockerAPIVersion)

	switch {
	case r.Method == "GET" && path == "/_ping":
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
		return

	case r.Method == "GET" && path == "/containers/json":
		f.handleList(w)
		return

	case r.Method == "GET" && strings.HasPrefix(path, "/containers/") && strings.HasSuffix(path, "/json"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/containers/"), "/json")
		f.handleInspect(w, id)
		return

	case r.Method == "GET" && strings.HasPrefix(path, "/images/") && strings.HasSuffix(path, "/json"):
		ref := strings.TrimSuffix(strings.TrimPrefix(path, "/images/"), "/json")
		f.handleImageInspect(w, ref)
		return

	case r.Method == "POST" && strings.HasPrefix(path, "/containers/") &&
		(strings.HasSuffix(path, "/start") || strings.HasSuffix(path, "/stop") ||
			strings.HasSuffix(path, "/restart") || strings.HasSuffix(path, "/pause") ||
			strings.HasSuffix(path, "/unpause")):
		f.handleAction(w, path)
		return

	case r.Method == "POST" && strings.HasPrefix(path, "/containers/") && strings.HasSuffix(path, "/rename"):
		f.handleRename(w, r, path)
		return

	case r.Method == "DELETE" && strings.HasPrefix(path, "/containers/"):
		f.handleRemove(w, r, path)
		return

	case r.Method == "POST" && path == "/containers/create":
		f.handleCreate(w, r)
		return

	case r.Method == "POST" && strings.HasPrefix(path, "/networks/") && strings.HasSuffix(path, "/connect"):
		f.record("POST", path)
		var body struct {
			Container      string         `json:"Container"`
			EndpointConfig map[string]any `json:"EndpointConfig"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if c := f.resolve(body.Container); c != nil {
			if c.Networks == nil {
				c.Networks = map[string]map[string]any{}
			}
			c.Networks[strings.TrimSuffix(strings.TrimPrefix(path, "/networks/"), "/connect")] = body.EndpointConfig
		}
		w.WriteHeader(http.StatusOK)
		return

	case r.Method == "POST" && path == "/images/create":
		f.handlePull(w, r)
		return

	case r.Method == "GET" && strings.HasPrefix(path, "/containers/") && strings.HasSuffix(path, "/stats"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/containers/"), "/stats")
		f.handleStats(w, id)
		return

	case r.Method == "GET" && strings.HasPrefix(path, "/containers/") && strings.HasSuffix(path, "/logs"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/containers/"), "/logs")
		f.handleLogs(w, r, id)
		return
	}

	http.NotFound(w, r)
}

func (f *fakeDocker) handleList(w http.ResponseWriter) {
	out := make([]map[string]any, 0, len(f.containers))
	for _, c := range f.containers {
		out = append(out, map[string]any{
			"Id": c.ID, "Names": []string{"/" + c.Name}, "Image": c.Image, "ImageID": c.ImageID,
			"State": c.State, "Status": c.Status, "Created": c.Created, "Labels": c.Labels,
			"Ports": c.Ports,
		})
	}
	writeJSONFake(w, http.StatusOK, out)
}

func (f *fakeDocker) handleInspect(w http.ResponseWriter, id string) {
	c := f.resolve(id)
	if c == nil {
		writeJSONFake(w, http.StatusNotFound, map[string]string{"message": "no such container"})
		return
	}
	health := map[string]any(nil)
	// Unlike the list endpoint, the real Engine API's container inspect
	// reports Created as an RFC3339 string rather than a unix timestamp.
	created := time.Unix(c.Created, 0).UTC().Format(time.RFC3339Nano)
	writeJSONFake(w, http.StatusOK, map[string]any{
		"Id": c.ID, "Name": "/" + c.Name, "Image": c.ImageID, "Created": created,
		"State": map[string]any{
			"Status": c.State, "Running": c.State == "running", "Paused": c.State == "paused",
			"StartedAt": "2024-01-01T00:00:00Z", "Health": health,
		},
		"Config": map[string]any{"Image": c.Image, "Env": c.Env, "Labels": c.Labels},
		"HostConfig": map[string]any{
			"RestartPolicy": map[string]any{"Name": c.RestartPolicy}, "Binds": []string{},
			"NetworkMode": c.NetworkMode,
		},
		"Mounts": c.Mounts,
		"NetworkSettings": map[string]any{
			"Networks": c.Networks,
		},
	})
}

// handleImageInspect looks the ref up as-is: net/http already percent-decodes
// r.URL.Path, so a ref containing "/" or ":" (url.PathEscape'd by the client)
// arrives here exactly as the caller wrote it.
func (f *fakeDocker) handleImageInspect(w http.ResponseWriter, ref string) {
	img, ok := f.images[ref]
	if !ok {
		// The daemon answers to an image id as well as to a reference.
		for _, candidate := range f.images {
			if candidate.ID == ref {
				img, ok = candidate, true
				break
			}
		}
	}
	if !ok {
		writeJSONFake(w, http.StatusNotFound, map[string]string{"message": "no such image"})
		return
	}
	writeJSONFake(w, http.StatusOK, map[string]any{
		"Id": img.ID, "RepoDigests": img.RepoDigests, "Config": map[string]any{"Labels": img.Labels},
	})
}

func (f *fakeDocker) handleAction(w http.ResponseWriter, path string) {
	rest := strings.TrimPrefix(path, "/containers/")
	slash := strings.LastIndex(rest, "/")
	id, action := rest[:slash], rest[slash+1:]
	c := f.resolve(id)
	if c == nil {
		writeJSONFake(w, http.StatusNotFound, map[string]string{"message": "no such container"})
		return
	}
	f.record("POST", "/containers/"+c.ID+"/"+action)
	if action == "start" && f.failStart[c.Name] && c.created {
		writeJSONFake(w, http.StatusInternalServerError, map[string]string{"message": "boom"})
		return
	}
	switch action {
	case "start":
		c.State = "running"
	case "stop":
		c.State = "exited"
	case "restart":
		c.State = "running"
	case "pause":
		c.State = "paused"
	case "unpause":
		c.State = "running"
	}
	w.WriteHeader(http.StatusNoContent)
}

func (f *fakeDocker) handleRename(w http.ResponseWriter, r *http.Request, path string) {
	rest := strings.TrimPrefix(path, "/containers/")
	id := strings.TrimSuffix(rest, "/rename")
	c := f.resolve(id)
	if c == nil {
		writeJSONFake(w, http.StatusNotFound, map[string]string{"message": "no such container"})
		return
	}
	f.record("POST", path)
	if name := r.URL.Query().Get("name"); name != "" {
		c.Name = name
	}
	w.WriteHeader(http.StatusNoContent)
}

func (f *fakeDocker) handleRemove(w http.ResponseWriter, r *http.Request, path string) {
	id := strings.TrimPrefix(path, "/containers/")
	c := f.resolve(id)
	if c == nil {
		writeJSONFake(w, http.StatusNotFound, map[string]string{"message": "no such container"})
		return
	}
	f.record("DELETE", "/containers/"+c.ID+"?v="+r.URL.Query().Get("v"))
	delete(f.containers, c.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (f *fakeDocker) handleCreate(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	f.record("POST", "/containers/create?name="+name)
	if f.failCreate {
		writeJSONFake(w, http.StatusInternalServerError, map[string]string{"message": "boom"})
		return
	}
	// The daemon refuses a name that is taken, which is why recreate has to
	// rename the old container out of the way first.
	for _, c := range f.containers {
		if c.Name == name {
			writeJSONFake(w, http.StatusConflict, map[string]string{"message": "name in use"})
			return
		}
	}
	var body struct {
		Image      string            `json:"Image"`
		Env        []string          `json:"Env"`
		Labels     map[string]string `json:"Labels"`
		HostConfig struct {
			NetworkMode   string `json:"NetworkMode"`
			RestartPolicy struct {
				Name string `json:"Name"`
			} `json:"RestartPolicy"`
		} `json:"HostConfig"`
		NetworkingConfig struct {
			EndpointsConfig map[string]map[string]any `json:"EndpointsConfig"`
		} `json:"NetworkingConfig"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	id := name + strings.Repeat("0", 64-len(name))
	if len(id) > 64 {
		id = id[:64]
	}
	networks := map[string]map[string]any{}
	for net, cfg := range body.NetworkingConfig.EndpointsConfig {
		networks[net] = cfg
	}
	f.containers[id] = &fakeContainer{
		ID: id, Name: name, Image: body.Image, ImageID: f.images[body.Image].ID, State: "created",
		Env: body.Env, Labels: body.Labels, RestartPolicy: body.HostConfig.RestartPolicy.Name,
		NetworkMode: body.HostConfig.NetworkMode, Networks: networks, created: true,
	}
	writeJSONFake(w, http.StatusCreated, map[string]string{"Id": id})
}

func (f *fakeDocker) handlePull(w http.ResponseWriter, r *http.Request) {
	repo := r.URL.Query().Get("fromImage")
	tag := r.URL.Query().Get("tag")
	ref := repo
	if tag != "" {
		ref = repo + ":" + tag
	}
	f.record("POST", "/images/create?fromImage="+repo+"&tag="+tag)
	if next, ok := f.images[ref+"@new"]; ok {
		f.images[ref] = next
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("{\"status\":\"Pulling\"}\n{\"status\":\"Done\"}\n"))
}

func (f *fakeDocker) handleStats(w http.ResponseWriter, id string) {
	c := f.resolve(id)
	if c == nil {
		writeJSONFake(w, http.StatusNotFound, map[string]string{"message": "no such container"})
		return
	}
	writeJSONFake(w, http.StatusOK, map[string]any{
		"cpu_stats": map[string]any{
			"cpu_usage":        map[string]any{"total_usage": 200},
			"system_cpu_usage": 2000,
			"online_cpus":      2,
		},
		"precpu_stats": map[string]any{
			"cpu_usage":        map[string]any{"total_usage": 100},
			"system_cpu_usage": 1000,
		},
		"memory_stats": map[string]any{
			"usage": 104857600,
			"limit": 1073741824,
			"stats": map[string]any{"inactive_file": 4857600},
		},
	})
}

func (f *fakeDocker) handleLogs(w http.ResponseWriter, r *http.Request, id string) {
	c := f.resolve(id)
	if c == nil {
		writeJSONFake(w, http.StatusNotFound, map[string]string{"message": "no such container"})
		return
	}
	// Recorded with the query string so a test can confirm the client clamped
	// tail before the request ever left the process.
	f.record("GET", "/containers/"+c.ID+"/logs?"+r.URL.RawQuery)
	w.WriteHeader(http.StatusOK)
	for _, line := range c.Logs {
		full := line + "\n"
		header := make([]byte, 8)
		header[0] = 1 // stdout
		binary.BigEndian.PutUint32(header[4:], uint32(len(full)))
		_, _ = w.Write(header)
		_, _ = w.Write([]byte(full))
	}
}

// newDockerTestRouter registers exactly the /api/docker routes main.go
// registers, on a real mux.Router so mux.Vars(r) resolves {id} and {name} the
// way production requests see them. Keep this list and main.go's in sync --
// every task that adds a route adds it here too.
func newDockerTestRouter(h *Handlers) http.Handler {
	r := mux.NewRouter()
	r.HandleFunc("/api/docker/status", h.DockerStatusHandler).Methods("GET")
	r.HandleFunc("/api/docker/containers", h.DockerContainersHandler).Methods("GET")
	r.HandleFunc("/api/docker/containers/{id}", h.DockerContainerDetailHandler).Methods("GET")
	r.HandleFunc("/api/docker/containers/{id}/env/{name}", h.DockerContainerEnvHandler).Methods("GET")
	r.HandleFunc("/api/docker/containers/{id}/stats", h.DockerContainerStatsHandler).Methods("GET")
	r.HandleFunc("/api/docker/containers/{id}/logs", h.DockerContainerLogsHandler).Methods("GET")
	r.HandleFunc("/api/docker/containers/{id}/changelog", h.DockerChangelogHandler).Methods("GET")
	r.HandleFunc("/api/docker/updates", h.DockerUpdatesHandler).Methods("GET")
	r.HandleFunc("/api/docker/updates/check", h.DockerUpdatesCheckHandler).Methods("POST")
	r.HandleFunc("/api/docker/containers/{id}/{action}", h.DockerActionHandler).Methods("POST")
	return r
}
