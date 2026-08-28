package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	// page worth keeping whole. Raised from 32 MB, which was turning away pages
	// people had asked to keep: the cap is there to stop one capture filling
	// the disk, not to pick which pages count.
	monolithMaxBytes = 52 << 20
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

/*
boundedTail keeps the last of a command's stderr and drops the rest.

A capture logs one line per asset, so a page with three hundred images would
otherwise be three hundred lines held in memory for the sake of the one at the
end. What is worth keeping is the tail: monolith prints its failure last.
*/
type boundedTail struct {
	buf []byte
}

// monolithTailBytes is how much of the tail to hold. Two kilobytes is several
// lines of progress plus any error, and nothing anyone would print on purpose.
const monolithTailBytes = 2 << 10

func (b *boundedTail) Write(p []byte) (int, error) {
	b.buf = append(b.buf, p...)
	if len(b.buf) > monolithTailBytes {
		b.buf = b.buf[len(b.buf)-monolithTailBytes:]
	}
	return len(p), nil
}

/*
reason is the last thing the command said that reads like a failure.

The line beginning "Error:" when there is one -- monolith ends with it -- and
otherwise the final non-empty line. Either way it is the sentence a reader can
act on rather than the asset list that came before it.
*/
func (b *boundedTail) reason() string {
	lines := strings.Split(strings.TrimSpace(string(b.buf)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "Error:") {
			return trimReason(line)
		}
	}
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return trimReason(line)
		}
	}
	return ""
}

func trimReason(line string) string {
	if len(line) > 300 {
		return line[:300]
	}
	return line
}

// MonolithAvailable reports whether the binary can be found.
func MonolithAvailable() bool {
	path, err := monolithLookup()
	return err == nil && strings.TrimSpace(path) != ""
}

// archiveDirName is the directory captures live in, under the data directory.
// Named rather than spelled out twice, because the backup has to know it too.
const archiveDirName = "archives"

// localArchiveDir is where captures live: inside the data directory, so a
// backup of data/ is a backup of the archive too.
func localArchiveDir() string {
	return filepath.Join(ResolveDataDir(), archiveDirName)
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

/*
localArchiveSlug is the filename stem for a URL, without the timestamp.

The same transformation localArchiveName applies, exposed on its own so a
listing can group the captures of one page together and a bookmark can find its
own. Two different URLs can in principle collapse to the same slug -- everything
unusual becomes a dash -- so a match is a hint rather than proof, and nothing on
disk resolves the doubt: a capture is a bare HTML file, and the key
CaptureLocally hands back with a fresh one is not written anywhere a later
listing could read it. Two URLs have to differ only in punctuation to collide,
which is why this stays a documented limit rather than a sidecar file per
capture.
*/
func localArchiveSlug(target string) string {
	name := localArchiveName(target, time.Unix(0, 0).UTC())
	return strings.TrimSuffix(strings.TrimSuffix(name, ".html"), "-19700101-000000")
}

// LocalCapture is one stored copy.
type LocalCapture struct {
	Path string `json:"path"`
	// URLKey is the canonical key of the page this is a copy of. Filled on a
	// capture that was just made, where the URL is still in hand; a listing
	// reads the directory rather than the files, so there it is empty and the
	// filename stem is what connects a capture to a bookmark.
	URLKey string `json:"urlKey,omitempty"`
	Bytes  int64  `json:"bytes"`
	/*
	 * NoReadableText marks a capture that opens blank.
	 *
	 * A page that builds itself in the browser is stored as its container and
	 * its scripts, and those scripts cannot run from an archive: the copy is
	 * served under a policy that forbids them, and allowed they would want the
	 * network the archive exists to do without. The file is real and weighs
	 * megabytes; there is simply nothing in it to read.
	 *
	 * Reported rather than refused, because the shell is occasionally what
	 * somebody wants -- and either way the moment to say so is now, not a year
	 * later when the copy is opened.
	 */
	NoReadableText bool `json:"noReadableText,omitempty"`
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
	// BookmarkName and BookmarkURL are the bookmark this is a copy of, when one
	// still exists. Empty means nothing in the dashboard points at this page any
	// more, which is worth showing rather than hiding.
	BookmarkName string `json:"bookmarkName,omitempty"`
	BookmarkURL  string `json:"bookmarkUrl,omitempty"`
}

/*
CaptureLocally runs monolith and stores the result.

The URL goes in as an argument to the program, never through a shell: there is
no shell in the picture, so nothing in a URL can be read as a command. Output
goes to a file this chooses rather than to one monolith derives, so the path is
never influenced by what the page or the address says.
*/
func (h *Handlers) CaptureLocally(ctx context.Context, target string) (capture LocalCapture, err error) {
	target = strings.TrimSpace(target)

	// Every path out of here says what became of the capture. There are eight
	// of them and they all matter to whoever pressed Save a copy, so the log
	// happens once on the way out rather than eight times on the way down.
	defer func() {
		switch {
		case err != nil:
			logWarn(logComponentArchive, "%s could not be saved: %v", hostOf(target), err)
		case capture.NoReadableText:
			logWarn(logComponentArchive, "%s was saved (%s) but holds no readable text; it is probably a page that builds itself in the browser",
				hostOf(target), formatCaptureSize(capture.Bytes))
		default:
			logInfo(logComponentArchive, "saved %s, %s on disk", hostOf(target), formatCaptureSize(capture.Bytes))
		}
		if activityEnabled(activityCategoryArchive) {
			fields := map[string]any{"url": target, "bytes": capture.Bytes}
			if err != nil {
				fields["error"] = err.Error()
			}
			logActivity(activityCategoryArchive, "archive.capture", fields, "")
		}
	}()

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
	 *   -I   isolate -- a CSP meta tag that stops the saved page reaching the
	 *        network when it is opened. An archive that phones home years later
	 *        is not an archive, and combined with the header the route sets it
	 *        means a capture cannot become a tracking beacon.
	 *   -t   network timeout per request, below the whole-run budget so a single
	 *        stuck asset cannot eat it
	 *   quiet, whichever letter this build spells it with -- see below
	 *
	 * No -j or -i: stripping scripts and images would save something that is not
	 * what the reader saw, which is the one thing an archive must not do.
	 */
	args := []string{
		"-o", path,
		"-I",
		"-t", fmt.Sprint(int(monolithPerRequestTimeout.Seconds())),
	}
	args = append(args, target)
	cmd := exec.CommandContext(runCtx, binary, args...)
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
	/*
	 * Progress thrown away, the reason kept.
	 *
	 * monolith writes both to stderr -- a line per asset while it works, and
	 * its error at the end when it cannot. We used to ask it to be quiet
	 * instead, which silenced the error along with the progress: a capture that
	 * could not reach the page came back as "exit status 1" and there was
	 * nothing to act on. Measured against the binary: with the flag a DNS
	 * failure leaves stdout and stderr both empty; without it stderr ends with
	 * "Error: could not retrieve target document".
	 *
	 * Bounded, because the progress log is one line per asset and a page can
	 * have hundreds; the tail is where the failure is.
	 */
	var stderr boundedTail
	cmd.Stdout = io.Discard
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	if runErr != nil {
		// Whatever it managed to write is not a capture; leaving it would make
		// a failed run look like a stored page.
		_ = os.Remove(path)
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return LocalCapture{}, fmt.Errorf("monolith took longer than %s", monolithTimeout)
		}
		detail := stderr.reason()
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
		Path:           path,
		URLKey:         canonicalBookmarkURLKey(target),
		Bytes:          info.Size(),
		URL:            "/api/archives/" + filepath.Base(path),
		At:             at.UnixMilli(),
		NoReadableText: !captureHasReadableText(path),
	}, nil
}

/*
captureHasReadableText reports whether there is anything to read in a capture.

Scanned rather than sampled. A capture inlines every stylesheet and script, so
it opens with hundreds of kilobytes of CSS before the first word of the page --
and reading a fixed head of the file and stripping <style>...</style> only works
while both ends fall inside the window. On a real capture the closing tag did
not, and 129,805 characters of @layer declarations read as prose.

So this walks the file with a small state machine, counting only what is outside
a tag and outside script and style, and stops the moment it has seen enough. A
page with words is answered in the first kilobytes; only a shell is read to the
end, and a shell is mostly base64 the scanner skips without allocating.

The threshold is deliberately low: this is not judging whether a page is worth
keeping, it is telling a page apart from an empty container, and a container
carries a title and a noscript line at most.
*/
const (
	/*
	 * Measured on real captures rather than guessed: a claude.ai shell counts
	 * 225 visible characters (hidden noscript text, invisible in a browser), a
	 * self-hosted app's shell 6, and an ars technica article 7,894. Five hundred
	 * sits well clear of both shells and well under any page with prose.
	 *
	 * A genuinely short page — a status notice of two sentences — would be
	 * called blank by this. It costs a sentence in a toast, and the copy is kept
	 * either way.
	 */
	captureTextMinimum = 500
	captureScanChunk   = 64 << 10
)

func captureHasReadableText(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		// Unreadable is not a claim that it is empty: the file is there, and
		// its size was checked a moment ago.
		return true
	}
	defer file.Close()

	var (
		buf     = make([]byte, captureScanChunk)
		scanner captureTextScanner
	)
	for {
		n, readErr := file.Read(buf)
		if n > 0 && scanner.count(buf[:n]) >= captureTextMinimum {
			return true
		}
		if readErr != nil {
			return scanner.chars >= captureTextMinimum
		}
	}
}

/*
captureTextScanner counts visible characters across chunk boundaries.

Deliberately not a parser: it needs to know whether it is inside a tag, and
whether that tag was script or style, which is four states and a small buffer
for the tag name. Anything more would be reimplementing an HTML parser to answer
"is this page blank".
*/
type captureTextScanner struct {
	chars    int
	inTag    bool
	inScript bool
	inStyle  bool
	// tag collects the opening of a tag name so the scanner can tell <script>
	// from <span>, and </style> from </strong>.
	tag []byte
	// pending holds the tail of a chunk that might be the start of a tag name
	// split across a read.
	closing bool
}

func (s *captureTextScanner) count(chunk []byte) int {
	for _, b := range chunk {
		switch {
		case b == '<':
			s.inTag = true
			s.closing = false
			s.tag = s.tag[:0]
		case b == '>' && s.inTag:
			s.inTag = false
			name := strings.ToLower(string(s.tag))
			switch {
			case strings.HasPrefix(name, "script"):
				s.inScript = !s.closing
			case strings.HasPrefix(name, "style"):
				s.inStyle = !s.closing
			}
			s.tag = s.tag[:0]
		case s.inTag:
			if len(s.tag) == 0 && b == '/' {
				s.closing = true
				continue
			}
			// Only the name is worth keeping; attributes can be megabytes of
			// inlined data.
			if len(s.tag) < 8 {
				s.tag = append(s.tag, b)
			}
		case s.inScript || s.inStyle:
			// Their contents are code, whatever they look like.
		case b > ' ':
			s.chars++
		}
	}
	return s.chars
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

/*
LocalArchivesHandler answers GET /api/archives — what is stored, newest first.

With ?url= it answers only the captures of that page, which is what a bookmark's
own panel asks for. Matching is on the filename stem rather than by reading every
file: the name is derived from the canonical key, so this costs a directory
listing instead of opening a hundred megabytes of HTML.
*/
func (h *Handlers) LocalArchivesHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	target := strings.TrimSpace(r.URL.Query().Get("url"))
	prefix := ""
	if target != "" {
		prefix = localArchiveSlug(target) + "-"
	}

	captures := listLocalArchives(prefix)
	h.attachBookmarkNames(captures)
	writeJSON(w, map[string]any{
		"available": MonolithAvailable(),
		"captures":  captures,
		// The total across every page, so a panel showing one bookmark's copies
		// can still say what the whole archive costs.
		"totalBytes": totalArchiveBytes(),
	})
}

/*
attachBookmarkNames says which bookmark each capture belongs to.

Matched on the filename stem, which is built from the canonical URL key -- so
this costs one pass over the bookmarks rather than opening any file. A capture
whose page is no longer bookmarked keeps an empty Bookmark, which is not a gap
to hide: those are exactly the copies worth reviewing, since nothing in the
dashboard points at them any more.
*/
func (h *Handlers) attachBookmarkNames(captures []LocalCapture) {
	if len(captures) == 0 {
		return
	}
	type owner struct {
		name string
		url  string
	}
	bySlug := map[string]owner{}
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			if strings.TrimSpace(bm.URL) == "" {
				continue
			}
			slug := localArchiveSlug(bm.URL)
			if _, taken := bySlug[slug]; taken {
				continue
			}
			bySlug[slug] = owner{name: bm.Name, url: bm.URL}
		}
	}

	for i := range captures {
		name := filepath.Base(captures[i].URL)
		// Strip the "-YYYYMMDD-HHMMSS.html" the capture time added.
		stem := strings.TrimSuffix(name, ".html")
		if cut := strings.LastIndex(stem, "-"); cut > 0 {
			stem = stem[:cut]
		}
		if cut := strings.LastIndex(stem, "-"); cut > 0 {
			stem = stem[:cut]
		}
		if found, ok := bySlug[stem]; ok {
			captures[i].BookmarkName = found.name
			captures[i].BookmarkURL = found.url
		}
	}
}

// listLocalArchives reads the directory, newest first, optionally narrowed to
// one page's captures.
func listLocalArchives(prefix string) []LocalCapture {
	entries, err := os.ReadDir(localArchiveDir())
	if err != nil {
		// No directory yet is not a failure: nothing has been captured.
		return []LocalCapture{}
	}
	captures := make([]LocalCapture, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".html") {
			continue
		}
		if prefix != "" && !strings.HasPrefix(entry.Name(), prefix) {
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
	return captures
}

func totalArchiveBytes() int64 {
	var total int64
	for _, capture := range listLocalArchives("") {
		total += capture.Bytes
	}
	return total
}

/*
DeleteLocalArchive answers DELETE /api/archives/{name}.

An archive nobody can prune is one that only grows, and these are whole pages
with their images inlined -- a hundred captures is a gigabyte. The name is
reduced to its base first, so nothing in a request can reach a file outside the
archive directory.
*/
func (h *Handlers) DeleteLocalArchive(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	name := filepath.Base(strings.TrimPrefix(r.URL.Path, "/api/archives/"))
	if name == "" || name == "." || name == ".." || !strings.HasSuffix(name, ".html") {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join(localArchiveDir(), name)
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	if err := os.Remove(path); err != nil {
		http.Error(w, "Could not delete that capture", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/*
localCopyIndex counts the stored captures per page, in one directory read.

For the health report, which draws every failing bookmark in a loop: asking per
row would be one round trip each to answer "is there a copy of this". Keyed by
the filename stem, which is what a capture and a URL have in common.
*/
func localCopyIndex() map[string]struct {
	Count  int
	Newest int64
} {
	index := map[string]struct {
		Count  int
		Newest int64
	}{}
	for _, capture := range listLocalArchives("") {
		stem := strings.TrimSuffix(filepath.Base(capture.URL), ".html")
		// Drop the "-YYYYMMDD-HHMMSS" the capture time appended.
		for i := 0; i < 2; i++ {
			if cut := strings.LastIndex(stem, "-"); cut > 0 {
				stem = stem[:cut]
			}
		}
		entry := index[stem]
		entry.Count++
		if capture.At > entry.Newest {
			entry.Newest = capture.At
		}
		index[stem] = entry
	}
	return index
}

// formatCaptureSize is the size as a reader would say it, not as a machine
// would: whole kilobytes or one decimal of a megabyte.
func formatCaptureSize(bytes int64) string {
	if bytes >= 1<<20 {
		return fmt.Sprintf("%.1f MB", float64(bytes)/float64(1<<20))
	}
	return fmt.Sprintf("%d KB", bytes>>10)
}
