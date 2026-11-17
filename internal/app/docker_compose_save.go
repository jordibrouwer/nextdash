package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"gopkg.in/yaml.v3"
)

/*
Writing a stack's compose file, and the backups that make that safe.

PUT  /api/docker/compose/{project}/files?file=         save
GET  /api/docker/compose/{project}/files/raw?file=     the file as it is, behind the write token
GET  /api/docker/compose/{project}/backups?file=       the copies kept of one file
GET  /api/docker/compose/{project}/backups/{stamp}/raw?file=  one copy as it is, behind the write token
POST /api/docker/compose/{project}/backups/{stamp}/restore?file=

The gates run in DockerActionHandler's order: host known, control, write token,
local host only, then the project, then nextDash's own stack. A save holds the
project's lock, checks the sha256 the editor loaded against the file on disk,
parses the YAML, copies the old file into the data directory, and only then
writes. A backup that cannot be written stops the write.
*/

const (
	composeBackupsDir = "compose-backups"
	composeBackupKeep = 20

	composeFileMount      = "compose-file-mount"
	composeFileMountHint  = "this file is mounted on its own, so it cannot be replaced: mount its folder instead of the file"
	composePermissionHint = "permission denied: set NEXTDASH_RUN_AS_ROOT=1 or fix ownership"
)

var composeStamp = regexp.MustCompile(`^\d{8}T\d{6}Z$`)

// composeLockKey is the project lock a save or restore takes.
func composeLockKey(host, project string) string {
	if host != "" && host != dockerLocalHostID {
		return host + "::compose:" + project
	}
	return "compose:" + project
}

// composeWriteGateOpen runs the gates a save, a restore and a run share, in
// DockerActionHandler's order: host known, control, write token, local host
// only, the project, nextDash's own stack. It writes the refusal itself and
// reports false. The caller takes the lock.
func (h *Handlers) composeWriteGateOpen(w http.ResponseWriter, r *http.Request) (composeProject, bool) {
	if dockerRemote(r) {
		if _, ok := findDockerHost(dockerHostOf(r)); !ok {
			dockerRefuse(w, http.StatusNotFound, reasonUnknownDockerHost)
			return composeProject{}, false
		}
	}
	if !dockerHostControl(r) {
		dockerRefuse(w, http.StatusForbidden, reasonDockerControlOff)
		return composeProject{}, false
	}
	if !h.requireWriteAccess(w, r) {
		return composeProject{}, false
	}
	p, ok := h.composeProjectGate(w, r) // refuses a remote host with local-only
	if !ok {
		return composeProject{}, false
	}
	if composeSelfOf(p) {
		dockerRefuse(w, http.StatusForbidden, reasonDockerSelf)
		return composeProject{}, false
	}
	return p, true
}

// composeWriteGate is the open gate plus the project's lock; the caller defers
// the release.
func (h *Handlers) composeWriteGate(w http.ResponseWriter, r *http.Request) (composeProject, func(), bool) {
	p, ok := h.composeWriteGateOpen(w, r)
	if !ok {
		return composeProject{}, nil, false
	}
	release, ok := h.dockerLock(composeLockKey(dockerHostOf(r), p.Name))
	if !ok {
		dockerRefuse(w, http.StatusConflict, "busy")
		return composeProject{}, nil, false
	}
	return p, release, true
}

// composeRefuseState answers a file that cannot be written as it is.
func composeRefuseState(w http.ResponseWriter, state string) {
	code := http.StatusConflict
	if state == composeOutside {
		code = http.StatusForbidden
	}
	dockerRefuse(w, code, state)
}

func composeSha(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// ---- validation ----

// checkComposeYAML parses src. A parse error is refused (the caller answers
// 422); everything else is a warning, since the file may be mid-edit. The
// structural check only runs for the first config file: an override file has
// services without image or build, and so do extends: and include:.
func checkComposeYAML(src []byte, first bool) (*composeYAMLError, []composeWarning) {
	warnings := []composeWarning{}
	var doc yaml.Node
	if err := yaml.Unmarshal(src, &doc); err != nil {
		return composeYAMLErrorOf(err), warnings
	}
	if len(doc.Content) == 0 {
		return nil, warnings // an empty file parses
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return nil, append(warnings, composeWarning{Line: root.Line, Message: "the top level should be a mapping with a services: key"})
	}
	if !first || yamlMapGet(root, "include") != nil {
		return nil, warnings
	}
	services := yamlMapGet(root, "services")
	if services == nil {
		return nil, append(warnings, composeWarning{Line: root.Line, Message: "no services: key"})
	}
	if services.Kind != yaml.MappingNode {
		return nil, append(warnings, composeWarning{Line: services.Line, Message: "services: should be a mapping"})
	}
	for i := 0; i+1 < len(services.Content); i += 2 {
		name, svc := services.Content[i], services.Content[i+1]
		if svc.Kind != yaml.MappingNode || yamlMapGet(svc, "extends") != nil {
			continue
		}
		if yamlMapGet(svc, "image") == nil && yamlMapGet(svc, "build") == nil {
			warnings = append(warnings, composeWarning{Line: name.Line, Message: fmt.Sprintf("service %q has neither image nor build", name.Value)})
		}
	}
	return nil, warnings
}

// ---- backups ----

var composeKeyChars = regexp.MustCompile(`[^A-Za-z0-9._-]`)

// composeFileKey names a file's backups: its basename and the first 8 hex of
// the sha256 of its host path, so /a/compose.yml and /b/compose.yml differ.
func composeFileKey(hostPath string) string {
	sum := sha256.Sum256([]byte(hostPath))
	return composeKeyChars.ReplaceAllString(filepath.Base(hostPath), "_") + "-" + hex.EncodeToString(sum[:4])
}

func composeBackupDir(host, project string) string {
	if host == "" {
		host = dockerLocalHostID
	}
	return filepath.Join(ResolveDataDir(), composeBackupsDir, composeKeyChars.ReplaceAllString(host, "_"), project)
}

type composeBackup struct {
	Stamp string `json:"stamp"`
	Size  int64  `json:"size"`
}

// listComposeBackups is a file's copies, newest first.
func listComposeBackups(dir, key string) []composeBackup {
	out := []composeBackup{}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		stamp, ok := strings.CutPrefix(e.Name(), key+".")
		if !ok || !composeStamp.MatchString(stamp) || !e.Type().IsRegular() {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, composeBackup{Stamp: stamp, Size: fi.Size()})
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Stamp > out[b].Stamp })
	return out
}

// pruneComposeBackups keeps the newest `keep` copies of one file.
func pruneComposeBackups(dir, key string, keep int) error {
	var first error
	for i, b := range listComposeBackups(dir, key) {
		if i < keep {
			continue
		}
		if err := os.Remove(filepath.Join(dir, key+"."+b.Stamp)); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// backupComposeFile copies old into the data directory before a write. Two
// writes inside one second get consecutive stamps rather than one overwriting
// the other.
func backupComposeFile(host, project string, f composeFile, old []byte) (string, error) {
	dir := composeBackupDir(host, project)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	key := composeFileKey(f.HostPath)
	t := time.Now().UTC()
	for {
		stamp := t.Format("20060102T150405Z")
		path := filepath.Join(dir, key+"."+stamp)
		fh, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(err, os.ErrExist) {
			t = t.Add(time.Second)
			continue
		}
		if err != nil {
			return "", err
		}
		_, werr := fh.Write(old)
		if cerr := fh.Close(); werr == nil {
			werr = cerr
		}
		if werr != nil {
			_ = os.Remove(path)
			return "", werr
		}
		if err := pruneComposeBackups(dir, key, composeBackupKeep); err != nil {
			logWarn(logComponentMutate, "compose backups: pruning %s failed: %v", key, err)
		}
		return stamp, nil
	}
}

// ---- writing ----

// writeComposeFile replaces the file by staging beside it and renaming over it,
// keeping its mode and, when nextDash runs as root, its owner. The target is the
// resolved path, so a symlinked compose file keeps its link. Not writeFileAtomic:
// that one is the data directory's writer, reports under the store's name, and
// creates directories.
func writeComposeFile(f composeFile, data []byte) (notes []string, err error) {
	// Not root and the file belongs to somebody else: a rename would hand the new
	// file to nextdash. Write into the file itself, which keeps owner, mode and inode.
	if os.Geteuid() != 0 && f.UID != os.Geteuid() {
		return nil, composeWriteInPlace(f, data)
	}
	tmp, err := os.CreateTemp(filepath.Dir(f.Local), ".tmp-*")
	if err != nil {
		return nil, err
	}
	tmpPath := tmp.Name()
	fail := func(e error) ([]string, error) {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return notes, e
	}
	if _, err := tmp.Write(data); err != nil {
		return fail(err)
	}
	// vfat (Unraid's /boot) and some network shares keep no modes or owners: that
	// is not a reason to refuse the save.
	if err := tmp.Chmod(f.Mode); err != nil {
		if !composeNoPermsFS(err) {
			return fail(err)
		}
		notes = append(notes, composeNoPermsNote)
	}
	if err := tmp.Sync(); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return notes, err
	}
	if os.Geteuid() == 0 {
		if err := os.Lchown(tmpPath, f.UID, f.GID); err != nil {
			if !composeNoPermsFS(err) {
				_ = os.Remove(tmpPath)
				return notes, err
			}
			if len(notes) == 0 {
				notes = append(notes, composeNoPermsNote)
			}
		}
	}
	if err := os.Rename(tmpPath, f.Local); err != nil {
		_ = os.Remove(tmpPath)
		if errors.Is(err, syscall.EBUSY) || errors.Is(err, syscall.EXDEV) {
			return notes, errComposeFileMount
		}
		return notes, err
	}
	syncDir(filepath.Dir(f.Local))
	return notes, nil
}

const composeNoPermsNote = "This file system keeps no owner or mode (for example vfat on Unraid /boot); the file was saved without them."

// errComposeFileMount is a rename onto a file that is its own mount.
var errComposeFileMount = errors.New("compose file is bind-mounted on its own")

// composeNoPermsFS is whether an errno from chmod or chown only says the file
// system cannot hold the attribute.
func composeNoPermsFS(err error) bool {
	return errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EINVAL) || errors.Is(err, syscall.ENOTSUP) || errors.Is(err, syscall.ENOSYS)
}

func composeWriteInPlace(f composeFile, data []byte) error {
	fh, err := os.OpenFile(f.Local, os.O_WRONLY|os.O_TRUNC, 0)
	if err != nil {
		return err
	}
	if _, err := fh.Write(data); err != nil {
		_ = fh.Close()
		return err
	}
	if err := fh.Sync(); err != nil {
		_ = fh.Close()
		return err
	}
	return fh.Close()
}

// composeWriteRefusal turns a write error into the reason a reader can act on.
func composeWriteRefusal(err error) (code int, body map[string]string) {
	switch {
	case errors.Is(err, errComposeFileMount):
		return http.StatusConflict, map[string]string{"reason": composeFileMount, "message": composeFileMountHint}
	case errors.Is(err, syscall.EROFS):
		return http.StatusConflict, map[string]string{"reason": composeReadOnly}
	case errors.Is(err, os.ErrPermission), errors.Is(err, syscall.EPERM):
		return http.StatusForbidden, map[string]string{"reason": composeDenied, "message": composePermissionHint}
	}
	return http.StatusInternalServerError, map[string]string{"reason": "docker-error", "message": err.Error()}
}

func composeWriteRefuse(w http.ResponseWriter, err error) {
	code, body := composeWriteRefusal(err)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	writeJSON(w, body)
}

// composeWritableCheck is the cheap look before staging: the kernel says whether
// a write would be let through, and why not.
func composeWritableCheck(f composeFile) error {
	if err := syscall.Access(filepath.Dir(f.Local), 2); err != nil {
		return err
	}
	return syscall.Access(f.Local, 2)
}

func composeLogWrite(r *http.Request, event string, p composeProject, f composeFile, err error) {
	fields := map[string]any{"project": p.Name, "file": f.HostPath, "ok": err == nil}
	if dockerRemote(r) {
		fields["host"] = dockerHostOf(r)
	}
	if requestFromMCP(r) {
		fields = mergeActivityFields(activityFieldsFromRequest(r), fields)
	}
	logActivity(activityCategoryMutate, event, fields, event+" "+p.Name+" "+filepath.Base(f.HostPath))
}

// ---- routes ----

// DockerComposeRawHandler hands over the file unmasked. Behind the write token
// before anything is read, like the reveal route.
func (h *Handlers) DockerComposeRawHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	p, ok := h.composeProjectGate(w, r)
	if !ok {
		return
	}
	f, ok := composeFileByID(composeFilesOf(p, composeMap()), r.URL.Query().Get("file"))
	if !ok {
		writeDockerError(w, errDockerNotFound)
		return
	}
	src, err := readComposeFile(f)
	if err != nil {
		var cs errComposeState
		if errors.As(err, &cs) {
			composeRefuseState(w, cs.State)
			return
		}
		writeDockerError(w, err)
		return
	}
	writeJSON(w, map[string]string{"file": f.ID, "content": string(src), "sha256": composeSha(src)})
}

type composeSaveBody struct {
	Content string `json:"content"`
	Sha256  string `json:"sha256"`
	// Masked: Content is the masked view of an env file, edited. A value that is
	// still the mask is replaced by the value the file on disk has.
	Masked bool `json:"masked"`
}

func (h *Handlers) DockerComposeSaveHandler(w http.ResponseWriter, r *http.Request) {
	p, release, ok := h.composeWriteGate(w, r)
	if !ok {
		return
	}
	defer release()
	f, ok := composeFileByID(composeFilesOf(p, composeMap()), r.URL.Query().Get("file"))
	if !ok {
		writeDockerError(w, errDockerNotFound)
		return
	}
	var body composeSaveBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, composeFileMax+8<<10)).Decode(&body); err != nil || body.Sha256 == "" {
		dockerRefuse(w, http.StatusBadRequest, "body")
		return
	}
	if len(body.Content) > composeFileMax {
		dockerRefuse(w, http.StatusRequestEntityTooLarge, composeTooLarge)
		return
	}
	if f.State != composeStateOK {
		composeRefuseState(w, f.State)
		return
	}
	if err := composeWritableCheck(f); err != nil {
		composeWriteRefuse(w, err)
		return
	}
	old, err := readComposeFile(f)
	if err != nil {
		var cs errComposeState
		if errors.As(err, &cs) {
			composeRefuseState(w, cs.State)
			return
		}
		writeDockerError(w, err)
		return
	}
	if current := composeSha(old); current != body.Sha256 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		writeJSON(w, map[string]string{"reason": composeStale, "sha256": current})
		return
	}
	content := []byte(body.Content)
	if f.Role == composeRoleEnv && body.Masked {
		merged, merr := composeMergeMaskedEnv(old, content)
		if merr != nil {
			composeRefuseMerge(w, merr)
			return
		}
		content = merged
	}
	// Whatever the client sent, the mask is never written as a value.
	if composeMaskAdded(old, content) {
		composeRefuseMerge(w, &composeMergeError{Reason: composeMaskLiteral})
		return
	}
	warnings := []composeWarning{}
	if f.Role == composeRoleCompose {
		yerr, warn := checkComposeYAML(content, f.ID == "c0")
		if yerr != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			writeJSON(w, map[string]any{"reason": composeYAMLInvalid, "line": yerr.Line, "column": yerr.Column, "message": yerr.Message})
			return
		}
		warnings = warn
	}
	stamp, err := backupComposeFile(dockerHostOf(r), p.Name, f, old)
	if err != nil {
		logWarn(logComponentMutate, "compose backup of %s failed: %v", f.HostPath, err)
		dockerRefuse(w, http.StatusInternalServerError, composeBackupFailed)
		return
	}
	notes, werr := writeComposeFile(f, content)
	if notes == nil {
		notes = []string{}
	}
	composeLogWrite(r, "compose.save", p, f, werr)
	if werr != nil {
		logWarn(logComponentMutate, "compose save of %s failed: %v", f.HostPath, werr)
		composeWriteRefuse(w, werr)
		return
	}
	composeLastSaveStore(dockerHostOf(r), p.Name, f, stamp, composeSha(content))
	writeJSON(w, map[string]any{"ok": true, "sha256": composeSha(content), "backup": stamp, "warnings": warnings, "notes": notes})
}

func (h *Handlers) DockerComposeBackupsHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	p, ok := h.composeProjectGate(w, r)
	if !ok {
		return
	}
	f, ok := composeFileByID(composeFilesOf(p, composeMap()), r.URL.Query().Get("file"))
	if !ok {
		writeDockerError(w, errDockerNotFound)
		return
	}
	writeJSON(w, map[string]any{"file": f.ID, "backups": listComposeBackups(composeBackupDir(dockerHostOf(r), p.Name), composeFileKey(f.HostPath))})
}

// DockerComposeRestoreHandler is a save of a backup's bytes: the same gates, the
// same stale check, a backup of the current file first. The stamp only selects
// from the listing; no path comes from the request.
func (h *Handlers) DockerComposeRestoreHandler(w http.ResponseWriter, r *http.Request) {
	p, release, ok := h.composeWriteGate(w, r)
	if !ok {
		return
	}
	defer release()
	f, ok := composeFileByID(composeFilesOf(p, composeMap()), r.URL.Query().Get("file"))
	if !ok {
		writeDockerError(w, errDockerNotFound)
		return
	}
	var body struct {
		Sha256 string `json:"sha256"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil || body.Sha256 == "" {
		dockerRefuse(w, http.StatusBadRequest, "body")
		return
	}
	dir, key := composeBackupDir(dockerHostOf(r), p.Name), composeFileKey(f.HostPath)
	stamp := mux.Vars(r)["stamp"]
	found := false
	for _, b := range listComposeBackups(dir, key) {
		if b.Stamp == stamp {
			found = true
			break
		}
	}
	if !found {
		writeDockerError(w, errDockerNotFound)
		return
	}
	if f.State != composeStateOK {
		composeRefuseState(w, f.State)
		return
	}
	if err := composeWritableCheck(f); err != nil {
		composeWriteRefuse(w, err)
		return
	}
	old, err := readComposeFile(f)
	if err != nil {
		var cs errComposeState
		if errors.As(err, &cs) {
			composeRefuseState(w, cs.State)
			return
		}
		writeDockerError(w, err)
		return
	}
	if current := composeSha(old); current != body.Sha256 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		writeJSON(w, map[string]string{"reason": composeStale, "sha256": current})
		return
	}
	fh, err := os.Open(filepath.Join(dir, key+"."+stamp))
	if err != nil {
		writeDockerError(w, errDockerNotFound)
		return
	}
	restored, err := io.ReadAll(io.LimitReader(fh, composeFileMax+1))
	fh.Close()
	if err != nil || len(restored) > composeFileMax {
		dockerRefuse(w, http.StatusInternalServerError, composeBackupFailed)
		return
	}
	newStamp, err := backupComposeFile(dockerHostOf(r), p.Name, f, old)
	if err != nil {
		logWarn(logComponentMutate, "compose backup of %s failed: %v", f.HostPath, err)
		dockerRefuse(w, http.StatusInternalServerError, composeBackupFailed)
		return
	}
	_, werr := writeComposeFile(f, restored)
	composeLogWrite(r, "compose.restore", p, f, werr)
	if werr != nil {
		composeWriteRefuse(w, werr)
		return
	}
	composeLastSaveStore(dockerHostOf(r), p.Name, f, newStamp, composeSha(restored))
	writeJSON(w, map[string]any{"ok": true, "sha256": composeSha(restored), "backup": newStamp, "restored": stamp})
}

// DockerComposeBackupRawHandler hands over one kept copy unmasked, so the panel
// can show it against the current file. Behind the write token like the raw
// route; the stamp only selects from the listing, no path comes from the request.
func (h *Handlers) DockerComposeBackupRawHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	p, ok := h.composeProjectGate(w, r)
	if !ok {
		return
	}
	f, ok := composeFileByID(composeFilesOf(p, composeMap()), r.URL.Query().Get("file"))
	if !ok {
		writeDockerError(w, errDockerNotFound)
		return
	}
	dir, key := composeBackupDir(dockerHostOf(r), p.Name), composeFileKey(f.HostPath)
	stamp := mux.Vars(r)["stamp"]
	found := false
	for _, b := range listComposeBackups(dir, key) {
		if b.Stamp == stamp {
			found = true
			break
		}
	}
	if !found {
		writeDockerError(w, errDockerNotFound)
		return
	}
	fh, err := os.Open(filepath.Join(dir, key+"."+stamp))
	if err != nil {
		writeDockerError(w, errDockerNotFound)
		return
	}
	src, err := io.ReadAll(io.LimitReader(fh, composeFileMax+1))
	fh.Close()
	if err != nil || len(src) > composeFileMax {
		dockerRefuse(w, http.StatusInternalServerError, composeBackupFailed)
		return
	}
	writeJSON(w, map[string]string{"file": f.ID, "stamp": stamp, "content": string(src)})
}
