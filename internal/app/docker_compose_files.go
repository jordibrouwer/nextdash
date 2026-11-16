package app

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"gopkg.in/yaml.v3"
)

/*
A stack's compose files, found from the labels the daemon already carries.

The labels hold HOST paths. nextDash runs in a container and sees only what is
mounted, so NEXTDASH_COMPOSE_MAP (hostPrefix:containerPrefix[,...]) says where
a host path appears inside this container. Nothing a request says becomes a
path: the project name picks a project the daemon listed, and every path comes
from that project's labels. A request names a file only by an id (c0, env, e0).

Every read goes through resolveComposeFile again, so no route trusts an earlier
answer: the file may have been swapped for a symlink since.
*/

const (
	composeLabelProject    = "com.docker.compose.project"
	composeLabelConfig     = "com.docker.compose.project.config_files"
	composeLabelWorkingDir = "com.docker.compose.project.working_dir"
	composeLabelEnvFile    = "com.docker.compose.project.environment_file"

	// composeFileMax is the largest file shown or saved.
	composeFileMax = 1 << 20

	composeRoleCompose = "compose"
	composeRoleEnv     = "env"
)

// Reason codes. The first group is what a file or a project can be in; the rest
// belong to the write and run routes of phase 2.
const (
	composeStateOK        = "ok"
	composeNoLabels       = "compose-no-labels"
	composeUnmapped       = "compose-unmapped"
	composeOutside        = "compose-outside"
	composeMissing        = "compose-missing"
	composeDenied         = "compose-denied"
	composeNotFile        = "compose-not-file"
	composeNotYAML        = "compose-not-yaml"
	composeTooLarge       = "compose-too-large"
	composeReadOnly       = "compose-read-only"
	composeStale          = "compose-stale"
	composeYAMLInvalid    = "compose-yaml"
	composeInvalid        = "compose-invalid"
	composeFailed         = "compose-failed"
	composeBackupFailed   = "compose-backup-failed"
	composeProjectPattern = `^[a-z0-9][a-z0-9_-]*$`
)

var composeProjectName = regexp.MustCompile(composeProjectPattern)

type composeMapping struct {
	Host      string `json:"host"`
	Container string `json:"container"`
}

// composeFile is one file of a project, resolved but not necessarily readable.
// State is composeStateOK or one of the codes above; Local is only set when the
// path got through the map and the symlink check.
type composeFile struct {
	ID       string
	Role     string
	HostPath string
	Local    string
	State    string
	Size     int64
	Mode     os.FileMode
	UID, GID int
	Writable bool
}

type composeProject struct {
	Name        string
	Members     []dockerContainerSummary
	ConfigFiles []string
	WorkingDir  string
	EnvFiles    []string // environment_file label, when the daemon sets it
	Mismatch    bool
}

// parseComposeMap reads NEXTDASH_COMPOSE_MAP. Each pair splits on its LAST colon
// (a host path may hold one), and both sides must be absolute. Bad pairs are
// handed back so Config can say which were ignored. Longest host prefix first.
func parseComposeMap(raw string) ([]composeMapping, []string) {
	var maps []composeMapping
	var rejected []string
	seen := map[string]bool{}
	for _, pair := range strings.Split(raw, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		i := strings.LastIndex(pair, ":")
		if i <= 0 || i == len(pair)-1 {
			rejected = append(rejected, pair)
			continue
		}
		host, container := strings.TrimSpace(pair[:i]), strings.TrimSpace(pair[i+1:])
		if !filepath.IsAbs(host) || !filepath.IsAbs(container) {
			rejected = append(rejected, pair)
			continue
		}
		host, container = filepath.Clean(host), filepath.Clean(container)
		if seen[host] {
			rejected = append(rejected, pair)
			continue
		}
		seen[host] = true
		maps = append(maps, composeMapping{Host: host, Container: container})
	}
	sort.SliceStable(maps, func(a, b int) bool { return len(maps[a].Host) > len(maps[b].Host) })
	return maps, rejected
}

var composeMapWarned sync.Map

// composeMap is the configured map. A rejected pair is logged once per value.
func composeMap() []composeMapping {
	raw := envPath("NEXTDASH_COMPOSE_MAP")
	maps, rejected := parseComposeMap(raw)
	if len(rejected) > 0 {
		if _, seen := composeMapWarned.LoadOrStore(raw, true); !seen {
			logWarn(logComponentServer, "NEXTDASH_COMPOSE_MAP: ignored %s (need absolute hostPrefix:containerPrefix)", strings.Join(rejected, ", "))
		}
	}
	return maps
}

// composeMapRejected is what composeMap ignored, for the status route.
func composeMapRejected() []string {
	_, rejected := parseComposeMap(envPath("NEXTDASH_COMPOSE_MAP"))
	return rejected
}

// composeProjectFrom gathers a project from the daemon's list. config_files is
// read per member; when members disagree the union is shown, sorted, and
// Mismatch says so.
func composeProjectFrom(list []dockerContainerSummary, name string) (composeProject, bool) {
	p := composeProject{Name: name}
	var first string
	var haveFirst bool
	union := map[string]bool{}
	for _, c := range list {
		if c.Labels[composeLabelProject] != name {
			continue
		}
		p.Members = append(p.Members, c)
		if p.WorkingDir == "" {
			p.WorkingDir = strings.TrimSpace(c.Labels[composeLabelWorkingDir])
		}
		if len(p.EnvFiles) == 0 {
			p.EnvFiles = splitComposeList(c.Labels[composeLabelEnvFile])
		}
		raw := strings.TrimSpace(c.Labels[composeLabelConfig])
		if raw == "" {
			continue
		}
		if !haveFirst {
			first, haveFirst = raw, true
			p.ConfigFiles = splitComposeList(raw)
		} else if raw != first {
			p.Mismatch = true
		}
		for _, f := range splitComposeList(raw) {
			union[f] = true
		}
	}
	if len(p.Members) == 0 {
		return composeProject{}, false
	}
	if p.Mismatch {
		p.ConfigFiles = p.ConfigFiles[:0]
		for f := range union {
			p.ConfigFiles = append(p.ConfigFiles, f)
		}
		sort.Strings(p.ConfigFiles)
	}
	return p, true
}

func splitComposeList(raw string) []string {
	var out []string
	for _, f := range strings.Split(raw, ",") {
		if f = strings.TrimSpace(f); f != "" {
			out = append(out, f)
		}
	}
	return out
}

var (
	errComposeUnmapped = errors.New("compose path is not under any mapped prefix")
	errComposeOutside  = errors.New("compose path leaves the mapped prefix")
)

// composeMatch finds the mapping a host path falls under: longest prefix, on a
// path boundary only (/opt/stacks2 is not under /opt/stacks). A ".." anywhere in
// the label path is refused before anything is joined.
func composeMatch(hostPath string, maps []composeMapping) (composeMapping, string, error) {
	if !filepath.IsAbs(hostPath) {
		return composeMapping{}, "", errComposeUnmapped
	}
	for _, seg := range strings.Split(hostPath, "/") {
		if seg == ".." {
			return composeMapping{}, "", errComposeOutside
		}
	}
	clean := filepath.Clean(hostPath)
	for _, m := range maps { // already longest first
		if m.Host == "/" || clean == m.Host || strings.HasPrefix(clean, m.Host+"/") {
			rel := strings.TrimPrefix(strings.TrimPrefix(clean, m.Host), "/")
			return m, filepath.Join(m.Container, rel), nil
		}
	}
	return composeMapping{}, "", errComposeUnmapped
}

// mapComposePath turns a label path into the path inside this container.
func mapComposePath(hostPath string, maps []composeMapping) (string, error) {
	_, local, err := composeMatch(hostPath, maps)
	return local, err
}

// underDir is whether path is dir itself or inside it, on a path boundary.
func underDir(path, dir string) bool {
	if dir == "/" {
		return true
	}
	return path == dir || strings.HasPrefix(path, dir+"/")
}

// resolveComposeFile runs every check a path has to pass: it maps, it still lies
// under its container prefix once symlinks are followed, it is a regular file,
// the name fits its role (compose files end .yml/.yaml; env files are not YAML
// and have no suffix rule), and it is at most 1 MiB.
func resolveComposeFile(hostPath, role string, maps []composeMapping) composeFile {
	f := composeFile{Role: role, HostPath: hostPath}
	m, local, err := composeMatch(hostPath, maps)
	switch {
	case errors.Is(err, errComposeOutside):
		f.State = composeOutside
		return f
	case err != nil:
		f.State = composeUnmapped
		return f
	}
	resolved, err := filepath.EvalSymlinks(local)
	if err != nil {
		f.State = composeStateOf(err)
		return f
	}
	prefix, err := filepath.EvalSymlinks(m.Container)
	if err != nil || !underDir(resolved, prefix) {
		f.State = composeOutside
		return f
	}
	fi, err := os.Stat(resolved)
	if err != nil {
		f.State = composeStateOf(err)
		return f
	}
	if !fi.Mode().IsRegular() {
		f.State = composeNotFile
		return f
	}
	if role == composeRoleCompose {
		switch strings.ToLower(filepath.Ext(hostPath)) {
		case ".yml", ".yaml":
		default:
			f.State = composeNotYAML
			return f
		}
	}
	if fi.Size() > composeFileMax {
		f.State = composeTooLarge
		f.Size = fi.Size()
		return f
	}
	f.Local, f.Size, f.Mode = resolved, fi.Size(), fi.Mode().Perm()
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		f.UID, f.GID = int(st.Uid), int(st.Gid)
	}
	// EROFS shows up as an Access error on a read-only mount, so Writable is
	// simply "the kernel would let a write through".
	f.Writable = syscall.Access(filepath.Dir(resolved), 2) == nil && syscall.Access(resolved, 2) == nil
	f.State = composeStateOK
	return f
}

func composeStateOf(err error) string {
	switch {
	case errors.Is(err, os.ErrNotExist):
		return composeMissing
	case errors.Is(err, os.ErrPermission):
		return composeDenied
	}
	return composeMissing
}

// errComposeState carries the reason a file could not be read.
type errComposeState struct{ State string }

func (e errComposeState) Error() string { return "compose file: " + e.State }

// readComposeFile resolves again and then reads, so a file swapped for a symlink
// out of the prefix since the last answer is caught at the read. The read is
// capped, in case the file grew between the Stat and here.
func readComposeFile(f composeFile) ([]byte, error) {
	return readComposeFileWith(f, composeMap())
}

func readComposeFileWith(f composeFile, maps []composeMapping) ([]byte, error) {
	g := resolveComposeFile(f.HostPath, f.Role, maps)
	if g.State != composeStateOK {
		return nil, errComposeState{State: g.State}
	}
	fh, err := os.Open(g.Local)
	if err != nil {
		return nil, errComposeState{State: composeStateOf(err)}
	}
	defer fh.Close()
	if fi, err := fh.Stat(); err != nil || !fi.Mode().IsRegular() {
		return nil, errComposeState{State: composeNotFile}
	}
	data, err := io.ReadAll(io.LimitReader(fh, composeFileMax+1))
	if err != nil {
		return nil, errComposeState{State: composeStateOf(err)}
	}
	if len(data) > composeFileMax {
		return nil, errComposeState{State: composeTooLarge}
	}
	return data, nil
}

// composeEnvFilesIn lists the env_file entries a compose file names, as host
// paths. Relative entries are taken from the working directory, the way compose
// does; an entry that leaves the working directory comes back as given, and the
// resolver reports it outside. YAML that does not parse names nothing.
func composeEnvFilesIn(src []byte, workingDir string) []string {
	var doc yaml.Node
	if yaml.Unmarshal(src, &doc) != nil || len(doc.Content) == 0 {
		return nil
	}
	root := doc.Content[0]
	services := yamlMapGet(root, "services")
	if services == nil || services.Kind != yaml.MappingNode {
		return nil
	}
	var out []string
	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" {
			return
		}
		if !filepath.IsAbs(p) {
			p = workingDir + "/" + p
		}
		// Keep a ".." segment visible: composeMatch refuses it, which is the
		// answer a leaving path should get.
		out = append(out, p)
	}
	for i := 1; i < len(services.Content); i += 2 {
		ef := yamlMapGet(services.Content[i], "env_file")
		if ef == nil {
			continue
		}
		switch ef.Kind {
		case yaml.ScalarNode:
			add(ef.Value)
		case yaml.SequenceNode:
			for _, item := range ef.Content {
				switch item.Kind {
				case yaml.ScalarNode:
					add(item.Value)
				case yaml.MappingNode:
					if p := yamlMapGet(item, "path"); p != nil && p.Kind == yaml.ScalarNode {
						add(p.Value)
					}
				}
			}
		}
	}
	return out
}

func yamlMapGet(n *yaml.Node, key string) *yaml.Node {
	if n == nil || n.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			return n.Content[i+1]
		}
	}
	return nil
}

// composeFilesOf lists every file a project shows, with ids: c<i> for the config
// files in label order, env for the working directory's .env (or the
// environment_file label), e<i> for env_file entries the compose files name.
// A default .env that does not exist is left out: most stacks have none.
func composeFilesOf(p composeProject, maps []composeMapping) []composeFile {
	var files []composeFile
	seen := map[string]bool{}
	for i, hp := range p.ConfigFiles {
		f := resolveComposeFile(hp, composeRoleCompose, maps)
		f.ID = "c" + strconv.Itoa(i)
		files = append(files, f)
	}
	envPaths := p.EnvFiles
	defaultEnv := false
	if len(envPaths) == 0 && p.WorkingDir != "" {
		envPaths = []string{strings.TrimRight(p.WorkingDir, "/") + "/.env"}
		defaultEnv = true
	}
	extra := 0
	addEnv := func(hp string, first bool) {
		if seen[hp] {
			return
		}
		f := resolveComposeFile(hp, composeRoleEnv, maps)
		if first && defaultEnv && f.State == composeMissing {
			return // most stacks have no .env; only show it when something names it
		}
		seen[hp] = true
		if first {
			f.ID = "env"
		} else {
			f.ID = "e" + strconv.Itoa(extra)
			extra++
		}
		files = append(files, f)
	}
	for i, hp := range envPaths {
		addEnv(hp, i == 0)
	}
	for _, f := range files {
		if f.Role != composeRoleCompose || f.State != composeStateOK {
			continue
		}
		src, err := readComposeFileWith(f, maps)
		if err != nil {
			continue
		}
		for _, hp := range composeEnvFilesIn(src, p.WorkingDir) {
			addEnv(hp, false)
		}
	}
	return files
}

// composeFileByID is how a route picks a file: only by an id the read answer
// handed out, never by a path.
func composeFileByID(files []composeFile, id string) (composeFile, bool) {
	for _, f := range files {
		if f.ID == id {
			return f, true
		}
	}
	return composeFile{}, false
}
