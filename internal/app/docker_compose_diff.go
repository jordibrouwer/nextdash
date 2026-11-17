package app

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gorilla/mux"
)

/*
A backup against the current file, with the secrets left out.

GET /api/docker/compose/{project}/backups/{stamp}/diff?file=<id>

The diff is made of the files' lines, but every line is shown the way the files
view shows it: a secret value is the mask. Two lines that differ only in a
secret come out as one "~" line (the value changed, and is not shown), so the
reader learns THAT it changed and never WHAT it was. An env file masks the
values of keys that look secret (password, token, key ...) and of URLs with
credentials; the rest are shown, so PUID=1000 -> 1001 reads as it is.
*/

const (
	composeDiffMaxLines = 400
	composeDiffCells    = 4_000_000 // beyond this the middle is shown as one block
	composeDiffContext  = 2
)

type composeDiffLine struct {
	Op   string `json:"op"` // "=" same, "-" only in the backup, "+" only in the current file, "~" a secret changed
	Text string `json:"text"`
	Old  int    `json:"old,omitempty"` // line number in the backup
	New  int    `json:"new,omitempty"` // line number in the current file
}

// composeEnvSecret is whether an env entry is shown masked in a diff.
func composeEnvSecret(e composeEnvEntry) bool {
	if strings.HasPrefix(e.name, "line ") {
		return true // not NAME=value: fail closed
	}
	return composeSecretKey.MatchString(e.name) || composeURLCreds.MatchString(e.value)
}

// composeEnvDisplayLines is an env file line by line, with the secret values
// masked and every other value as written. Line numbers do not move.
func composeEnvDisplayLines(src []byte) []string {
	lines := strings.Split(string(src), "\n")
	for _, e := range parseComposeEnv(src) {
		if (e.value == "" && e.extraLines == 0) || !composeEnvSecret(e) {
			continue
		}
		for k := 0; k <= e.extraLines && e.line-1+k < len(lines); k++ {
			idx := e.line - 1 + k
			eol := ""
			if strings.HasSuffix(lines[idx], "\r") {
				eol = "\r"
			}
			if k == 0 {
				lines[idx] = e.prefix + composeMask + eol
			} else {
				lines[idx] = composeMask + eol
			}
		}
	}
	return lines
}

// composeDisplayLines is a file as the diff shows it. ok is false when the
// masked text does not line up with the raw one: the caller then shows no text.
func composeDisplayLines(role string, src []byte) (lines []string, ok bool) {
	raw := strings.Split(string(src), "\n")
	var shown []string
	if role == composeRoleEnv {
		shown = composeEnvDisplayLines(src)
	} else {
		out, _, yerr := redactComposeYAML(src)
		if yerr != nil {
			out, _ = composeFallbackRedact(src)
		}
		shown = strings.Split(string(out), "\n")
	}
	if len(shown) != len(raw) {
		return raw, false
	}
	return shown, true
}

type composeEdit struct {
	op   byte // '=', '-', '+'
	a, b int  // indexes into the old and new lines
}

// composeDiffEdits is the edit script from a to b: common prefix and suffix
// are cut, and the middle goes through a longest-common-subsequence table (or
// is one replace when it is too big for one).
func composeDiffEdits(a, b []string) []composeEdit {
	pre := 0
	for pre < len(a) && pre < len(b) && a[pre] == b[pre] {
		pre++
	}
	sa, sb := len(a), len(b)
	for sa > pre && sb > pre && a[sa-1] == b[sb-1] {
		sa--
		sb--
	}
	var out []composeEdit
	for i := 0; i < pre; i++ {
		out = append(out, composeEdit{'=', i, i})
	}
	ma, mb := a[pre:sa], b[pre:sb]
	if len(ma)*len(mb) > composeDiffCells {
		for i := range ma {
			out = append(out, composeEdit{'-', pre + i, -1})
		}
		for j := range mb {
			out = append(out, composeEdit{'+', -1, pre + j})
		}
	} else {
		n, m := len(ma), len(mb)
		t := make([][]int32, n+1)
		for i := range t {
			t[i] = make([]int32, m+1)
		}
		for i := n - 1; i >= 0; i-- {
			for j := m - 1; j >= 0; j-- {
				if ma[i] == mb[j] {
					t[i][j] = t[i+1][j+1] + 1
				} else if t[i+1][j] >= t[i][j+1] {
					t[i][j] = t[i+1][j]
				} else {
					t[i][j] = t[i][j+1]
				}
			}
		}
		i, j := 0, 0
		for i < n || j < m {
			switch {
			case i < n && j < m && ma[i] == mb[j]:
				out = append(out, composeEdit{'=', pre + i, pre + j})
				i++
				j++
			case j >= m || (i < n && t[i+1][j] >= t[i][j+1]):
				out = append(out, composeEdit{'-', pre + i, -1})
				i++
			default:
				out = append(out, composeEdit{'+', -1, pre + j})
				j++
			}
		}
	}
	for k := 0; sa+k < len(a); k++ {
		out = append(out, composeEdit{'=', sa + k, sb + k})
	}
	return out
}

// composeDiffOf is the diff of old against cur, shown through the display
// lines. Changed lines only, with a little context.
func composeDiffOf(role string, oldSrc, curSrc []byte) (lines []composeDiffLine, added, removed, changed int, truncated bool) {
	rawA, rawB := strings.Split(string(oldSrc), "\n"), strings.Split(string(curSrc), "\n")
	showA, okA := composeDisplayLines(role, oldSrc)
	showB, okB := composeDisplayLines(role, curSrc)
	hide := !okA || !okB
	text := func(shown []string, i int) string {
		if hide {
			return composeMask
		}
		return strings.TrimSuffix(shown[i], "\r")
	}
	edits := composeDiffEdits(rawA, rawB)
	lines = []composeDiffLine{}
	emit := func(l composeDiffLine) {
		if len(lines) >= composeDiffMaxLines {
			truncated = true
			return
		}
		lines = append(lines, l)
	}
	// Which equal lines are close enough to a change to be shown.
	near := make([]bool, len(edits))
	for i, e := range edits {
		if e.op == '=' {
			continue
		}
		for k := i - composeDiffContext; k <= i+composeDiffContext; k++ {
			if k >= 0 && k < len(edits) && edits[k].op == '=' {
				near[k] = true
			}
		}
	}
	for i := 0; i < len(edits); i++ {
		e := edits[i]
		if e.op == '=' {
			if near[i] {
				emit(composeDiffLine{Op: "=", Text: text(showB, e.b), Old: e.a + 1, New: e.b + 1})
			}
			continue
		}
		// A block of removals then additions: pair them up by position.
		var dels, adds []composeEdit
		for i < len(edits) && edits[i].op == '-' {
			dels = append(dels, edits[i])
			i++
		}
		for i < len(edits) && edits[i].op == '+' {
			adds = append(adds, edits[i])
			i++
		}
		i--
		n := len(dels)
		if len(adds) < n {
			n = len(adds)
		}
		for k := 0; k < n; k++ {
			d, a := dels[k], adds[k]
			if !hide && showA[d.a] == showB[a.b] {
				// The raw lines differ and the shown ones do not: a secret changed.
				changed++
				emit(composeDiffLine{Op: "~", Text: text(showB, a.b), Old: d.a + 1, New: a.b + 1})
				continue
			}
			removed++
			added++
			emit(composeDiffLine{Op: "-", Text: text(showA, d.a), Old: d.a + 1})
			emit(composeDiffLine{Op: "+", Text: text(showB, a.b), New: a.b + 1})
		}
		for _, d := range dels[n:] {
			removed++
			emit(composeDiffLine{Op: "-", Text: text(showA, d.a), Old: d.a + 1})
		}
		for _, a := range adds[n:] {
			added++
			emit(composeDiffLine{Op: "+", Text: text(showB, a.b), New: a.b + 1})
		}
	}
	return lines, added, removed, changed, truncated
}

// DockerComposeBackupDiffHandler compares one kept copy with the file as it is
// now. Behind the write token; no secret value is in the answer.
func (h *Handlers) DockerComposeBackupDiffHandler(w http.ResponseWriter, r *http.Request) {
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
	old, err := os.ReadFile(filepath.Join(dir, key+"."+stamp))
	if err != nil || len(old) > composeFileMax {
		writeDockerError(w, errDockerNotFound)
		return
	}
	cur, err := readComposeFile(f)
	if err != nil {
		writeDockerError(w, errDockerNotFound)
		return
	}
	lines, added, removed, changed, truncated := composeDiffOf(f.Role, old, cur)
	writeJSON(w, map[string]any{"file": f.ID, "stamp": stamp, "role": f.Role, "lines": lines,
		"added": added, "removed": removed, "changed": changed, "truncated": truncated,
		"identical": string(old) == string(cur)})
}
