package app

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
)

/*
Read routes for a stack's compose files.

GET /api/docker/compose/{project}/files        the files, secrets masked
GET /api/docker/compose/{project}/files/value  one masked value, behind the write token

The project name is the only thing a request chooses. It has to be a project the
daemon lists, and every path comes from that project's labels. A file is named
by an id from the read answer (c0, env, e0), never by a path.
*/

type composeFileView struct {
	ID       string `json:"id"`
	Role     string `json:"role"`
	HostPath string `json:"hostPath"`
	State    string `json:"state"`
	Size     int64  `json:"size"`
	Sha256   string `json:"sha256"`
	// AppliedSha256 is the contents nextDash last brought up ("" if never);
	// PendingChange is whether the file differs from that.
	AppliedSha256 string          `json:"appliedSha256"`
	PendingChange bool            `json:"pendingChange"`
	Writable      bool            `json:"writable"`
	Content       string          `json:"content"`
	Masked        []composeMasked `json:"masked"`
	// Mask is the text every masked value shows. In an edited env file it stands
	// for "keep the value on disk" (save with masked:true); it is never written.
	Mask     string            `json:"mask"`
	YAMLErr  *composeYAMLError `json:"yamlError"`
	Warnings []composeWarning  `json:"warnings"`
}

type composeWarning struct {
	Line    int    `json:"line"`
	Message string `json:"message"`
}

type composeSuggest struct {
	Env   string `json:"env"`
	Mount string `json:"mount"`
}

type composeFilesView struct {
	Project    string `json:"project"`
	Host       string `json:"host"`
	State      string `json:"state"`
	Self       bool   `json:"self"`
	Control    bool   `json:"control"`
	WriteToken bool   `json:"writeToken"`
	WorkingDir string `json:"workingDir"`
	Mismatch   bool   `json:"mismatch"`
	// PendingChange: some file changed since the last Up nextDash ran. Only
	// stacks nextDash upped are ever flagged.
	PendingChange bool              `json:"pendingChange"`
	Map           []composeMapping  `json:"map"`
	Suggest       *composeSuggest   `json:"suggest"`
	Files         []composeFileView `json:"files"`
}

// composeProjectGate runs the gates both routes share, in order: host known,
// remote host refused, daemon reachable, project in the daemon's list. It
// writes the refusal itself and reports false.
func (h *Handlers) composeProjectGate(w http.ResponseWriter, r *http.Request) (composeProject, bool) {
	if dockerRemote(r) {
		if _, ok := findDockerHost(dockerHostOf(r)); !ok {
			dockerRefuse(w, http.StatusNotFound, reasonUnknownDockerHost)
			return composeProject{}, false
		}
		dockerLocalOnly(w, r)
		return composeProject{}, false
	}
	api, reason := h.dockerAPIFor(r)
	if api == nil {
		code := http.StatusServiceUnavailable
		if reason == reasonUnknownDockerHost {
			code = http.StatusNotFound
		}
		dockerRefuse(w, code, reason)
		return composeProject{}, false
	}
	name := mux.Vars(r)["project"]
	if !composeProjectName.MatchString(name) {
		writeDockerError(w, errDockerNotFound)
		return composeProject{}, false
	}
	list, err := api.listContainers(r.Context())
	if err != nil {
		writeDockerError(w, err)
		return composeProject{}, false
	}
	p, ok := composeProjectFrom(list, name)
	if !ok {
		writeDockerError(w, errDockerNotFound)
		return composeProject{}, false
	}
	return p, true
}

// composeSuggestFor is the env value and mount line that would map this
// project: its working directory's parent, to /stacks.
func composeSuggestFor(p composeProject) *composeSuggest {
	dir := p.WorkingDir
	if dir == "" && len(p.ConfigFiles) > 0 {
		dir = filepath.Dir(p.ConfigFiles[0])
	}
	if dir == "" || !filepath.IsAbs(dir) {
		return nil
	}
	prefix := filepath.Dir(filepath.Clean(dir))
	return &composeSuggest{
		Env:   "NEXTDASH_COMPOSE_MAP=" + prefix + ":/stacks",
		Mount: prefix + ":/stacks:ro",
	}
}

func composeSelfOf(p composeProject) bool {
	self := dockerSelfID()
	for _, m := range p.Members {
		if isDockerSelf(m.ID, self) {
			return true
		}
	}
	return false
}

func (h *Handlers) DockerComposeFilesHandler(w http.ResponseWriter, r *http.Request) {
	p, ok := h.composeProjectGate(w, r)
	if !ok {
		return
	}
	maps := composeMap()
	out := composeFilesView{
		Project: p.Name, Host: dockerHostOf(r), State: composeStateOK,
		Self: composeSelfOf(p), Control: dockerHostControl(r), WriteToken: writeAccessToken() != "",
		WorkingDir: p.WorkingDir, Mismatch: p.Mismatch, Map: maps, Suggest: composeSuggestFor(p),
		Files: []composeFileView{},
	}
	if out.Map == nil {
		out.Map = []composeMapping{}
	}
	if len(p.ConfigFiles) == 0 {
		out.State = composeNoLabels
		writeJSON(w, out)
		return
	}
	for _, f := range composeFilesOf(p, maps) {
		out.Files = append(out.Files, composeViewOf(f))
	}
	composeMarkPending(&out)
	writeJSON(w, out)
}

// composeViewOf reads one resolved file and masks it. A file that is not
// readable still gets a row, with its state and no content.
func composeViewOf(f composeFile) composeFileView {
	v := composeFileView{
		ID: f.ID, Role: f.Role, HostPath: f.HostPath, State: f.State, Size: f.Size,
		Writable: f.Writable, Masked: []composeMasked{}, Warnings: []composeWarning{}, Mask: composeMask,
	}
	if f.State != composeStateOK {
		return v
	}
	src, err := readComposeFile(f)
	if err != nil {
		if cs, ok := err.(errComposeState); ok {
			v.State = cs.State
		}
		v.Writable = false
		return v
	}
	sum := sha256.Sum256(src)
	v.Sha256 = hex.EncodeToString(sum[:])
	v.Size = int64(len(src))
	var out []byte
	if f.Role == composeRoleEnv {
		out, v.Masked = redactEnvFile(src)
	} else {
		out, v.Masked, v.YAMLErr = redactComposeYAML(src)
	}
	v.Content = string(out)
	return v
}

// DockerComposeValueHandler answers one masked value, on request, never cached.
// Behind the write token before anything else is read, like
// DockerContainerEnvHandler: a secret in a compose file is no less guarded than
// one in a container's environment. It only reveals what the redactor masked.
func (h *Handlers) DockerComposeValueHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	p, ok := h.composeProjectGate(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	f, ok := composeFileByID(composeFilesOf(p, composeMap()), q.Get("file"))
	if !ok {
		writeDockerError(w, errDockerNotFound)
		return
	}
	src, err := readComposeFile(f)
	if err != nil {
		writeDockerError(w, errDockerNotFound)
		return
	}
	// A value is addressed by index (what the view gives), by line plus key, or
	// by key alone. Index and line are optional extras to the key; with an index
	// the key may be left out.
	key := q.Get("key")
	index, line := -1, 0
	if v := q.Get("index"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			dockerRefuse(w, http.StatusBadRequest, "index")
			return
		}
		index = n
	}
	if v := q.Get("line"); v != "" {
		line, _ = strconv.Atoi(v)
	}
	if index < 0 && strings.TrimSpace(key) == "" {
		writeDockerError(w, errDockerNotFound)
		return
	}
	var masked []composeMasked
	if f.Role == composeRoleEnv {
		masked = envMaskedOf(src)
	} else {
		masked = composeMaskedOf(src)
	}
	value, found := composeFindMasked(masked, key, line, index)
	if !found {
		writeDockerError(w, errDockerNotFound)
		return
	}
	res := map[string]any{"file": f.ID, "key": key, "value": value}
	if index >= 0 {
		res["index"] = index
		res["key"] = masked[index].Key
	}
	writeJSON(w, res)
}
