package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

/*
monolith: a copy of the page on your own disk.

Save Page Now puts a copy on archive.org, which is the right default -- somebody
else pays for the storage and keeps it online for decades. It is also a copy you
do not control, of a page a third party agreed to keep, reachable only while
archive.org is reachable. For a local-first tool that is a gap worth closing for
the pages that matter.

monolith is a Rust binary that flattens a page into one HTML file with the CSS,
the scripts and the images inlined as data URLs. One file, no directory of
assets, openable from a filesystem in ten years. nextDash shells out to it and
keeps the result under data/archives/.

Chosen over the alternatives from the same shortlist: ArchiveBox's REST API is
still alpha, and SingleFile needs Deno and a Chrome. monolith is one static
binary with no runtime.

The limit is worth stating because it decides what this is good for: monolith
has no JavaScript engine, so a page that fetches its content after load is saved
as the shell it arrives as. For an article, a recipe, a reference page -- the
things people actually lose -- that is the whole page. For a single-page app it
is not.

This is the first place nextDash runs an external program, which sets the shape
below: the binary is looked up rather than taken from settings, the URL is passed
as an argument and never through a shell, and a run that hangs is killed.
*/

const (
	// monolithTimeout bounds one capture. A page with large images inlined is
	// legitimately slow; a run past this is stuck.
	monolithTimeout = 90 * time.Second
	// monolithMaxBytes caps a stored capture. Everything is inlined as base64,
	// so a media-heavy page can be tens of megabytes -- past this it is not a
	// page worth keeping whole.
	monolithMaxBytes = 32 << 20
	// monolithPerRequestTimeout bounds one asset fetch inside a run, so a single
	// stuck image cannot spend the whole capture budget.
	monolithPerRequestTimeout = 20 * time.Second
	// monolithBinary is the program looked for on PATH.
	monolithBinary = "monolith"
)

var (
	errMonolithMissing = errors.New("monolith is not installed")
	// monolithLookup is a var so a test can stand in for the PATH search.
	monolithLookup = func() (string, error) { return exec.LookPath(monolithBinary) }
	// One capture at a time. monolith fetches every asset on the page, so two
	// runs at once is two pages' worth of concurrent requests at a stranger's
	// server, from a tool whose whole promise is being unobtrusive.
	monolithRun sync.Mutex
)

// MonolithAvailable reports whether the binary can be found.
func MonolithAvailable() bool {
	path, err := monolithLookup()
	return err == nil && strings.TrimSpace(path) != ""
}

// localArchiveDir is where captures live: inside the data directory, so a
// backup of data/ is a backup of the archive too.
func localArchiveDir() string {
	return filepath.Join(ResolveDataDir(), "archives")
}

/*
localArchiveName is the filename for one capture.

Derived from the canonical URL key rather than the URL itself: it is already the
identity every other part of nextDash uses for "the same page".

Everything except letters, digits, dash and underscore becomes a dash -- dots
included, so no sequence of them can spell "..". The name is uglier for it and
that is the right trade: it is an identifier, not something anyone reads. The timestamp keeps successive
captures of the same page side by side rather than overwriting history -- the
point of a local archive is having the version you saved.
*/
func localArchiveName(target string, at time.Time) string {
	key := canonicalBookmarkURLKey(target)
	safe := make([]rune, 0, len(key))
	for _, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			safe = append(safe, r)
		case r == '-', r == '_':
			safe = append(safe, r)
		default:
			safe = append(safe, '-')
		}
	}
	trimmed := strings.Trim(string(safe), "-")
	if trimmed == "" {
		trimmed = "page"
	}
	if len(trimmed) > 80 {
		trimmed = trimmed[:80]
	}
	return fmt.Sprintf("%s-%s.html", trimmed, at.UTC().Format("20060102-150405"))
}

// LocalCapture is one stored copy.
type LocalCapture struct {
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
	/*
	 * URL is where the browser can open it: /api/archives/{name}, behind the
	 * write token.
	 *
	 * Deliberately not under /data/, which is served without authentication
	 * from a narrow allowlist -- icons and an uploaded favicon. A capture is the
	 * entire content of a page the reader chose to keep, which can be an
	 * intranet page or anything else behind their own login, so it does not go
	 * in that allowlist.
	 */
	URL string `json:"url"`
	At  int64  `json:"at"`
}

/*
CaptureLocally runs monolith and stores the result.

The URL goes in as an argument to the program, never through a shell: there is
no shell in the picture, so nothing in a URL can be read as a command. Output
goes to a file this chooses rather than to one monolith derives, so the path is
never influenced by what the page or the address says.
*/
func (h *Handlers) CaptureLocally(ctx context.Context, target string) (LocalCapture, error) {
	target = strings.TrimSpace(target)
	if err := h.validateBookmarkURL(target); err != nil {
		return LocalCapture{}, err
	}

	binary, err := monolithLookup()
	if err != nil || strings.TrimSpace(binary) == "" {
		return LocalCapture{}, errMonolithMissing
	}

	dir := localArchiveDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return LocalCapture{}, err
	}
	at := time.Now()
	path := filepath.Join(dir, localArchiveName(target, at))

	monolithRun.Lock()
	defer monolithRun.Unlock()

	// The shorter of the two deadlines wins: WithTimeout only ever tightens a
	// context, so a caller that gave up already is not waited on for another
	// ninety seconds.
	runCtx, cancel := context.WithTimeout(ctx, monolithTimeout)
	defer cancel()

	/*
	 * The flags, each of them a decision:
	 *
	 *   -o   write to the path chosen here, never one derived from the address
	 *   -q   quiet; anything non-fatal on stderr is not this caller's business
	 *   -I   isolate -- a CSP meta tag that stops the saved page reaching the
	 *        network when it is opened. An archive that phones home years later
	 *        is not an archive, and combined with the header the route sets it
	 *        means a capture cannot become a tracking beacon.
	 *   -t   network timeout per request, below the whole-run budget so a single
	 *        stuck asset cannot eat it
	 *
	 * No -j or -i: stripping scripts and images would save something that is not
	 * what the reader saw, which is the one thing an archive must not do.
	 * Verified against monolith 2.10, whose flags these are -- an earlier
	 * version of this passed -s, which that release does not have, and every
	 * capture failed on the argument parser.
	 */
	cmd := exec.CommandContext(runCtx, binary,
		"-o", path,
		"-q",
		"-I",
		"-t", fmt.Sprint(int(monolithPerRequestTimeout.Seconds())),
		target,
	)
	// No inherited environment: this is a network fetch on the reader's behalf
	// and has no business seeing the server's variables.
	cmd.Env = []string{}
	/*
	 * Kill the whole process, not just the parent.
	 *
	 * CommandContext sends a signal on cancellation, but CombinedOutput waits
	 * for the output pipes to close -- and they stay open as long as any child
	 * holds them. A capture that spawned something was therefore waited on for
	 * the full ninety seconds after the deadline had already passed, which is
	 * exactly the hang the timeout exists to prevent.
	 *
	 * WaitDelay gives the process a moment to die on its own and then closes
	 * the pipes regardless, so cancelling means the call returns.
	 */
	cmd.WaitDelay = 2 * time.Second
	output, runErr := cmd.CombinedOutput()

	if runErr != nil {
		// Whatever it managed to write is not a capture; leaving it would make
		// a failed run look like a stored page.
		_ = os.Remove(path)
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return LocalCapture{}, fmt.Errorf("monolith took longer than %s", monolithTimeout)
		}
		detail := strings.TrimSpace(string(output))
		if len(detail) > 300 {
			detail = detail[:300]
		}
		if detail == "" {
			detail = runErr.Error()
		}
		return LocalCapture{}, fmt.Errorf("monolith failed: %s", detail)
	}

	info, err := os.Stat(path)
	if err != nil {
		return LocalCapture{}, fmt.Errorf("monolith wrote nothing")
	}
	if info.Size() == 0 {
		_ = os.Remove(path)
		return LocalCapture{}, fmt.Errorf("monolith wrote an empty file")
	}
	if info.Size() > monolithMaxBytes {
		_ = os.Remove(path)
		return LocalCapture{}, fmt.Errorf("the capture was %d MB, past the %d MB limit",
			info.Size()>>20, int64(monolithMaxBytes)>>20)
	}

	return LocalCapture{
		Path:  path,
		Bytes: info.Size(),
		URL:   "/api/archives/" + filepath.Base(path),
		At:    at.UnixMilli(),
	}, nil
}

// CaptureLocallyHandler answers POST /api/archives/capture.
func (h *Handlers) CaptureLocallyHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}

	capture, err := h.CaptureLocally(r.Context(), r.URL.Query().Get("url"))
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, errMonolithMissing) {
			// Not an error in the run: the program is not installed, which is
			// something the reader fixes rather than retries.
			status = http.StatusPreconditionFailed
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":     err.Error(),
			"available": !errors.Is(err, errMonolithMissing),
		})
		return
	}
	writeJSON(w, capture)
}

// ServeLocalArchive answers GET /api/archives/{name}.
//
// Behind the write token, and serving only files directly inside the archive
// directory: the name is reduced to its base so nothing in a request can walk
// out of it, and the result must still be a regular file that is really there.
func (h *Handlers) ServeLocalArchive(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	name := filepath.Base(strings.TrimPrefix(r.URL.Path, "/api/archives/"))
	if name == "" || name == "." || name == ".." || !strings.HasSuffix(name, ".html") {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join(localArchiveDir(), name)
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	// A capture is a whole page with its scripts inlined. Served with a strict
	// policy of its own so opening one cannot reach back into the dashboard's
	// origin or out to the network.
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src data:")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeFile(w, r, path)
}

// LocalArchivesHandler answers GET /api/archives — what is stored, newest first.
func (h *Handlers) LocalArchivesHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	entries, err := os.ReadDir(localArchiveDir())
	if err != nil {
		// No directory yet is not a failure: nothing has been captured.
		writeJSON(w, map[string]any{"available": MonolithAvailable(), "captures": []LocalCapture{}})
		return
	}
	captures := make([]LocalCapture, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".html") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		captures = append(captures, LocalCapture{
			Path:  filepath.Join(localArchiveDir(), entry.Name()),
			Bytes: info.Size(),
			URL:   "/api/archives/" + entry.Name(),
			At:    info.ModTime().UnixMilli(),
		})
	}
	sort.Slice(captures, func(i, j int) bool { return captures[i].At > captures[j].At })
	writeJSON(w, map[string]any{"available": MonolithAvailable(), "captures": captures})
}
