package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/gorilla/mux"
	"time"
)

// withFakeMonolith stands in for the binary with a script this test controls.
func withFakeMonolith(t *testing.T, script string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "monolith")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script), 0755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	original := monolithLookup
	monolithLookup = func() (string, error) { return path, nil }
	t.Cleanup(func() { monolithLookup = original })
}

func withNoMonolith(t *testing.T) {
	t.Helper()
	original := monolithLookup
	monolithLookup = func() (string, error) { return "", errors.New("not found") }
	t.Cleanup(func() { monolithLookup = original })
}

// The capture lands in the data directory, so backing up data/ backs up the
// archive with it.
func TestCaptureLocallyStoresTheFile(t *testing.T) {
	h := newTestHandlers(t)
	// $2 is the -o path: write something recognisable there.
	withFakeMonolith(t, `echo "<html>captured</html>" > "$2"`)

	capture, err := h.CaptureLocally(context.Background(), "https://example.com/page")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	if capture.Bytes == 0 {
		t.Error("stored an empty capture")
	}
	if !strings.HasPrefix(capture.Path, localArchiveDir()) {
		t.Errorf("stored at %q, want it inside %q", capture.Path, localArchiveDir())
	}
	body, err := os.ReadFile(capture.Path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !strings.Contains(string(body), "captured") {
		t.Errorf("file holds %q", string(body))
	}
	// Behind the write token, not under /data/, which is served unauthenticated.
	if !strings.HasPrefix(capture.URL, "/api/archives/") {
		t.Errorf("url = %q, want it behind the API", capture.URL)
	}
}

/*
A failed run leaves nothing behind.

monolith writes as it goes, so a run that dies halfway leaves a partial file --
and a partial file that stays is indistinguishable from a stored page until
somebody opens it, years later, looking for something that is not there.
*/
func TestCaptureLocallyRemovesAPartialFile(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `echo "half a pa" > "$2"; exit 3`)

	if _, err := h.CaptureLocally(context.Background(), "https://example.com/page"); err == nil {
		t.Fatal("a failing run reported success")
	}
	entries, err := os.ReadDir(localArchiveDir())
	if err == nil && len(entries) > 0 {
		t.Errorf("left %d file(s) behind after a failed run", len(entries))
	}
}

// An empty file is not a capture either.
func TestCaptureLocallyRejectsAnEmptyFile(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `: > "$2"`)

	if _, err := h.CaptureLocally(context.Background(), "https://example.com/page"); err == nil {
		t.Error("stored an empty file as a capture")
	}
}

// Not installed is a setup problem, told apart so the caller can say so.
func TestCaptureLocallyReportsAMissingBinary(t *testing.T) {
	h := newTestHandlers(t)
	withNoMonolith(t)

	if _, err := h.CaptureLocally(context.Background(), "https://example.com/page"); !errors.Is(err, errMonolithMissing) {
		t.Errorf("err = %v, want errMonolithMissing", err)
	}
	if MonolithAvailable() {
		t.Error("MonolithAvailable is true with no binary")
	}
}

/*
The URL never becomes part of the path.

The filename comes from the canonical key with everything unusual replaced, so
an address carrying slashes, dots or a traversal cannot decide where the file
lands.
*/
func TestLocalArchiveNameCannotEscapeTheDirectory(t *testing.T) {
	at := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	for _, target := range []string{
		"https://example.com/../../etc/passwd",
		"https://example.com/a/b/c?q=../..",
		"https://example.com/",
	} {
		name := localArchiveName(target, at)
		if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
			t.Errorf("localArchiveName(%q) = %q, which is not a bare filename", target, name)
		}
		if filepath.Base(name) != name {
			t.Errorf("localArchiveName(%q) = %q, which is a path", target, name)
		}
	}
}

// Two captures of the same page are two files: the point of a local archive is
// having the version you saved.
func TestLocalArchiveNameKeepsSuccessiveCaptures(t *testing.T) {
	first := localArchiveName("https://example.com/x", time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC))
	second := localArchiveName("https://example.com/x", time.Date(2026, 3, 2, 12, 0, 0, 0, time.UTC))
	if first == second {
		t.Errorf("both captures named %q; the first would be overwritten", first)
	}
}

// A page that never finishes must not hold the capture open for ever.
func TestCaptureLocallyTimesOut(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `sleep 30`)

	ctx, cancel := context.WithTimeout(context.Background(), 700*time.Millisecond)
	defer cancel()

	started := time.Now()
	_, err := h.CaptureLocally(ctx, "https://example.com/slow")
	if err == nil {
		t.Fatal("a hanging run reported success")
	}
	if elapsed := time.Since(started); elapsed > 10*time.Second {
		t.Errorf("waited %s on a hanging run", elapsed)
	}
}

/*
The arguments are the ones monolith actually takes.

The first version passed -s, which monolith 2.10 does not have: every capture
died in the argument parser, and the stub in these tests accepted anything, so
nothing here noticed. This asserts the flags rather than the behaviour, which is
usually the wrong test to write -- but the flags are an interface with a program
outside this repo, and getting them wrong fails every capture at once.
*/
func TestCaptureLocallyPassesTheFlagsMonolithHas(t *testing.T) {
	h := newTestHandlers(t)
	argsFile := filepath.Join(t.TempDir(), "args.txt")
	// Record what it was called with, then write the output file so the run
	// succeeds and the rest of the path is exercised too.
	withFakeMonolith(t, `echo "$@" > `+argsFile+`
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then echo "<html>ok</html>" > "$2"; fi
  shift
done`)

	if _, err := h.CaptureLocally(context.Background(), "https://example.com/page"); err != nil {
		t.Fatalf("capture: %v", err)
	}

	raw, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	args := string(raw)

	// -I isolate (the saved page must not reach the network when it is opened
	// years later) and -t a per-request timeout. No quiet flag: it silenced the
	// failure along with the progress, which is what left a broken capture
	// saying only "exit status 1".
	for _, want := range []string{"-o", "-I", "-t", "https://example.com/page"} {
		if !strings.Contains(args, want) {
			t.Errorf("monolith called without %q; got: %s", want, args)
		}
	}
	// Stripping content would archive something the reader never saw.
	for _, unwanted := range []string{"-j", "-i", "--no-js", "--no-images"} {
		if strings.Contains(args, " "+unwanted) {
			t.Errorf("passed %q, which saves less than the page: %s", unwanted, args)
		}
	}
}

/*
Captures can be found per page.

An archive whose files nobody can connect to a bookmark is a folder of
identifiers. The filename stem is the canonical key, so one page's copies can be
picked out with a directory listing rather than by opening a hundred megabytes
of HTML.
*/
func TestListLocalArchivesFiltersByPage(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `echo "<html>ok</html>" > "$2"`)

	for _, target := range []string{
		"https://example.com/one",
		"https://example.com/one",
		"https://other.example/two",
	} {
		if _, err := h.CaptureLocally(context.Background(), target); err != nil {
			t.Fatalf("capture %s: %v", target, err)
		}
		// The name carries a whole-second timestamp, so two captures of the
		// same page in the same second would be one file.
		time.Sleep(1100 * time.Millisecond)
	}

	all := listLocalArchives("")
	if len(all) != 3 {
		t.Fatalf("stored %d captures, want 3", len(all))
	}
	// Newest first, so a panel can offer the latest without sorting again.
	if len(all) > 1 && all[0].At < all[len(all)-1].At {
		t.Error("captures are not newest-first")
	}

	one := listLocalArchives(localArchiveSlug("https://example.com/one") + "-")
	if len(one) != 2 {
		t.Errorf("found %d captures for that page, want its 2", len(one))
	}
	for _, capture := range one {
		if strings.Contains(capture.URL, "other-example") {
			t.Errorf("another page's capture came back: %s", capture.URL)
		}
	}
}

// The slug is the same identity the filename is built from, so a page can find
// its own captures without knowing how the name was made.
func TestLocalArchiveSlugMatchesTheFilename(t *testing.T) {
	target := "https://example.com/one"
	name := localArchiveName(target, time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC))
	if !strings.HasPrefix(name, localArchiveSlug(target)+"-") {
		t.Errorf("name %q does not start with slug %q", name, localArchiveSlug(target))
	}
}

/*
A capture can be deleted.

These are whole pages with their images inlined -- a hundred of them is a
gigabyte -- so an archive nobody can prune is one that only grows.
*/
func TestDeleteLocalArchiveRemovesOnlyThatFile(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `echo "<html>ok</html>" > "$2"`)

	first, err := h.CaptureLocally(context.Background(), "https://example.com/one")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	time.Sleep(1100 * time.Millisecond)
	if _, err := h.CaptureLocally(context.Background(), "https://example.com/two"); err != nil {
		t.Fatalf("capture: %v", err)
	}

	router := mux.NewRouter()
	router.PathPrefix("/api/archives/").HandlerFunc(h.DeleteLocalArchive).Methods(http.MethodDelete)
	req := httptest.NewRequest(http.MethodDelete, "/api/archives/"+filepath.Base(first.Path), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d", rec.Code)
	}

	if _, err := os.Stat(first.Path); !os.IsNotExist(err) {
		t.Error("the capture is still on disk")
	}
	if len(listLocalArchives("")) != 1 {
		t.Error("the other capture went with it")
	}
}

/*
Nothing in a request may reach a file outside the archive directory.

Called without a router, deliberately. mux normalises "../settings.json" to
"settings.json" before a handler ever sees it, so routing the request would test
mux rather than this code -- and a first version of this test passed with the
guard removed for exactly that reason. The handler is called directly with the
path it would have to survive on its own.
*/
func TestDeleteLocalArchiveRefusesToLeaveTheDirectory(t *testing.T) {
	h := newTestHandlers(t)
	outside := filepath.Join(ResolveDataDir(), "settings.json")
	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outside, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	// A real capture, so a traversal that resolved would have something beside
	// it to reach past.
	withFakeMonolith(t, `echo "<html>ok</html>" > "$2"`)
	if _, err := h.CaptureLocally(context.Background(), "https://example.com/one"); err != nil {
		t.Fatalf("capture: %v", err)
	}

	for _, name := range []string{
		"../settings.json",
		"../../settings.json",
		"settings.json",
		"..%2Fsettings.json",
		"subdir/../../settings.json",
	} {
		req := httptest.NewRequest(http.MethodDelete, "/api/archives/x", nil)
		// Set the path directly: this is what the guard has to hold against,
		// with nothing in front of it having cleaned the value up first.
		req.URL.Path = "/api/archives/" + name
		rec := httptest.NewRecorder()
		h.DeleteLocalArchive(rec, req)
		if rec.Code == http.StatusNoContent {
			t.Errorf("deleting %q was allowed", name)
		}
	}
	if _, err := os.Stat(outside); err != nil {
		t.Error("settings.json was deleted through the archive route")
	}
	if len(listLocalArchives("")) != 1 {
		t.Error("the real capture was removed by one of these")
	}
}

/*
The same guard on the read route: a capture is served only from inside the
archive directory.

Worth knowing about this one: it holds for two independent reasons. filepath.Base
reduces the name, and filepath.Join would resolve away a "../" even without it,
so removing either alone still leaves the route safe. That makes this test
unable to pin the failure on one line -- it asserts the property rather than the
mechanism, which is the right thing to assert and worth saying out loud so
nobody reads a passing run as proof that both halves are load-bearing.
*/
func TestServeLocalArchiveRefusesToLeaveTheDirectory(t *testing.T) {
	h := newTestHandlers(t)
	outside := filepath.Join(ResolveDataDir(), "settings.json")
	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outside, []byte(`{"secret":"in settings"}`), 0644); err != nil {
		t.Fatal(err)
	}

	// Also an .html file outside the archive directory: without the base-name
	// guard the suffix check alone would let this through, so this is the case
	// that actually distinguishes the two.
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "elsewhere.html"), []byte("<html>not an archive</html>"), 0644); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{
		"../settings.json", "settings.json", "../../settings.json",
		"../elsewhere.html", "subdir/../../elsewhere.html",
	} {
		req := httptest.NewRequest(http.MethodGet, "/api/archives/x", nil)
		req.URL.Path = "/api/archives/" + name
		rec := httptest.NewRecorder()
		h.ServeLocalArchive(rec, req)
		if rec.Code == http.StatusOK {
			t.Errorf("served %q: %s", name, rec.Body.String())
		}
	}
}

/*
Captures know which bookmark they belong to.

Without it the tab is a list of filenames: the reader sees "https---example-com"
and has to work out which of their bookmarks that is. Matched on the filename
stem, so this costs one pass over the bookmarks rather than opening any file.
*/
func TestCapturesAreMatchedToTheirBookmark(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `echo "<html>ok</html>" > "$2"`)

	bookmarks := append(h.store.GetBookmarksByPage(1), Bookmark{
		Name: "Example site", URL: "https://example.com/", PageID: 1,
	})
	if err := h.store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatalf("save: %v", err)
	}

	for _, target := range []string{"https://example.com/", "https://nobody.example/"} {
		if _, err := h.CaptureLocally(context.Background(), target); err != nil {
			t.Fatalf("capture %s: %v", target, err)
		}
		time.Sleep(1100 * time.Millisecond)
	}

	captures := listLocalArchives("")
	h.attachBookmarkNames(captures)

	var named, orphan int
	for _, capture := range captures {
		switch capture.BookmarkName {
		case "Example site":
			named++
			if capture.BookmarkURL != "https://example.com/" {
				t.Errorf("bookmarkUrl = %q", capture.BookmarkURL)
			}
		case "":
			// A page nothing points at any more: shown rather than hidden,
			// since nothing else would ever lead anyone back to it.
			orphan++
		default:
			t.Errorf("capture attributed to %q", capture.BookmarkName)
		}
	}
	if named != 1 || orphan != 1 {
		t.Errorf("named=%d orphan=%d, want one of each", named, orphan)
	}
}

/*
The health report counts copies once, not once per row.

It draws every failing bookmark in a loop; a request per row to answer "is there
a copy of this" would be a hundred round trips to paint one screen.
*/
func TestLocalCopyIndexCountsPerPage(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `echo "<html>ok</html>" > "$2"`)

	for _, target := range []string{
		"https://example.com/", "https://example.com/", "https://other.example/",
	} {
		if _, err := h.CaptureLocally(context.Background(), target); err != nil {
			t.Fatalf("capture: %v", err)
		}
		time.Sleep(1100 * time.Millisecond)
	}

	index := localCopyIndex()
	if got := index[localArchiveSlug("https://example.com/")].Count; got != 2 {
		t.Errorf("counted %d copies of that page, want 2", got)
	}
	if got := index[localArchiveSlug("https://other.example/")].Count; got != 1 {
		t.Errorf("counted %d copies of the other page, want 1", got)
	}
	if got := index[localArchiveSlug("https://never.example/")].Count; got != 0 {
		t.Errorf("counted %d copies of a page never captured", got)
	}
	// The newest stamp, so a row can say how fresh the fallback is.
	if index[localArchiveSlug("https://example.com/")].Newest == 0 {
		t.Error("no timestamp recorded for the newest copy")
	}
}

/*
A failed capture has to say why it failed.

monolith writes its progress and its errors to stderr, and the quiet flag we
were passing silenced both — so a capture that could not reach the page came
back as "monolith failed: exit status 1", which tells the reader nothing they
can act on. Reproduced against the real binary: with the flag, a DNS failure
produces empty stdout and empty stderr; without it, stderr ends with
"Error: could not retrieve target document".
*/
func TestCaptureLocallyReportsWhyMonolithFailed(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `echo "https://example.com/asset.js" >&2
echo "Error: could not retrieve target document" >&2
exit 1`)

	_, err := h.CaptureLocally(context.Background(), "https://example.com/page")

	if err == nil {
		t.Fatal("a failing monolith reported success")
	}
	if !strings.Contains(err.Error(), "could not retrieve target document") {
		t.Fatalf("error = %q, want it to carry monolith's own reason", err.Error())
	}
	// And not drowned in the asset list that precedes it: the last thing said
	// is the thing that went wrong.
	if strings.Contains(err.Error(), "asset.js") {
		t.Fatalf("error = %q, want the reason rather than the progress log", err.Error())
	}
}

/*
And it is not asked to be quiet in the first place.

The quiet flag exists in two spellings and we probed --help to pick one. Both
suppress the error as well as the progress, which is why a failure could not
explain itself. Nothing needs suppressing: stdout is discarded and stderr is
only read when the run fails.
*/
func TestCaptureLocallyDoesNotSilenceMonolith(t *testing.T) {
	h := newTestHandlers(t)
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args.txt")
	// Answers --help the way monolith 2.10 does, which is what made the code
	// reach for -q. A stub that says nothing would let this test pass against
	// the very behaviour it is here to prevent.
	withFakeMonolith(t, `case "$1" in --help) echo "  -q, --quiet   Suppress verbosity"; exit 0;; esac
echo "$@" > `+argsFile+`
echo "<html>captured</html>" > "$2"`)

	if _, err := h.CaptureLocally(context.Background(), "https://example.com/page"); err != nil {
		t.Fatalf("capture: %v", err)
	}

	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	for _, flag := range []string{" -q", " -s", "--quiet", "--silent"} {
		if strings.Contains(string(args), flag) {
			t.Fatalf("args = %q, want no quiet flag", strings.TrimSpace(string(args)))
		}
	}
}

/*
The size cap, at the two sizes that matter.

Everything a capture references is inlined as base64, so a page with a video or
a gallery is legitimately tens of megabytes. The cap exists to stop one page
filling the disk, not to refuse the pages people actually want kept — 32 MB was
turning away captures that were worth having.

Sparse files: os.Stat reports the size the cap reads, and writing 60 real
megabytes to test a limit would be the slowest test in the suite.
*/
func TestCaptureLocallySizeCap(t *testing.T) {
	cases := []struct {
		name string
		megs int
		kept bool
	}{
		{name: "a heavy page is kept", megs: 40, kept: true},
		{name: "an absurd one is refused", megs: 60, kept: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newTestHandlers(t)
			withFakeMonolith(t, `dd if=/dev/zero of="$2" bs=1 count=0 seek=`+strconv.Itoa(tc.megs)+`m 2>/dev/null`)

			_, err := h.CaptureLocally(context.Background(), "https://example.com/page")

			if tc.kept && err != nil {
				t.Fatalf("%d MB was refused: %v", tc.megs, err)
			}
			if !tc.kept {
				if err == nil {
					t.Fatalf("%d MB was stored, past the limit", tc.megs)
				}
				if !strings.Contains(err.Error(), "limit") {
					t.Fatalf("error = %q, want it to name the limit", err.Error())
				}
			}
		})
	}
}

/*
A page that builds itself with JavaScript is saved as an empty shell.

monolith stores what the server sent, and for a single-page app that is a
container plus scripts. Those scripts cannot run from the archive — the copy is
served under a policy that forbids them, and even allowed they would want the
network the archive exists to do without. So the capture succeeds, weighs
megabytes, and shows nothing when opened.

Reproduced against the real thing: a claude.ai capture of 4.5 MB renders zero
characters of text, while an ars technica one of 40 MB renders eight thousand.
Saying so at the moment of saving is the difference between a copy you chose to
keep and a copy you discover is blank a year later.
*/
func TestCaptureLocallyFlagsAShellWithNoReadableText(t *testing.T) {
	h := newTestHandlers(t)
	// A single-page app as monolith stores it: a mount point and a script.
	withFakeMonolith(t, `cat > "$2" <<'HTML'
<!doctype html><html><head><title>App</title></head>
<body><div id="root"></div><script>window.boot=1</script></body></html>
HTML`)

	capture, err := h.CaptureLocally(context.Background(), "https://app.example/page")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	if !capture.NoReadableText {
		t.Fatal("a shell with nothing to read was reported as an ordinary capture")
	}
}

// And a page with words in it is not flagged, or the warning would mean nothing.
func TestCaptureLocallyLeavesARealPageAlone(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `cat > "$2" <<'HTML'
<!doctype html><html><head><title>Story</title></head><body>
<h1>The tunnel under the harbour</h1>
<p>It took nine years to dig, cost four times what was promised, and carries
more traffic in a day than the ferries it replaced managed in a week. The
engineers who built it are mostly retired now, and the tunnel is due for its
first serious overhaul: new pumps, new lighting, and a ventilation system that
was specified when lorries were smaller. The works will close one bore at a
time, which the harbour authority insists will not affect crossing times, and
which everyone who drives it every morning expects will affect little else.
Estimates for the overhaul run to eleven years, one more than it took to build
the thing in the first place, and nobody involved seems willing to say so out
loud in a meeting that is being minuted.</p>
</body></html>
HTML`)

	capture, err := h.CaptureLocally(context.Background(), "https://news.example/story")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	if capture.NoReadableText {
		t.Fatal("a page of prose was flagged as empty")
	}
}

/*
A style block bigger than the probe window is still not text.

monolith inlines every stylesheet, so a capture opens with hundreds of kilobytes
of CSS before the first word of the page. Reading a fixed head of the file and
stripping <style>…</style> with a pattern only works while both ends are inside
the window: on the real claude.ai capture the closing tag fell outside it, the
CSS was counted as prose, and 129,805 characters of @layer declarations looked
exactly like a page worth keeping.
*/
func TestCaptureLocallySeesPastAHugeStyleBlock(t *testing.T) {
	filler := strings.Repeat(".cls-x{color:#abcdef;background:#123456}\n", 20000)

	t.Run("a shell padded with CSS is still empty", func(t *testing.T) {
		h := newTestHandlers(t)
		withFakeMonolith(t, `{ printf '<!doctype html><html><head><style>'
cat <<'CSS'
`+filler+`
CSS
printf '</style></head><body><div id="root"></div></body></html>'; } > "$2"`)

		capture, err := h.CaptureLocally(context.Background(), "https://app.example/page")
		if err != nil {
			t.Fatalf("capture: %v", err)
		}
		if !capture.NoReadableText {
			t.Fatal("counted the stylesheet as something to read")
		}
	})

	t.Run("a page behind the same CSS is not", func(t *testing.T) {
		h := newTestHandlers(t)
		withFakeMonolith(t, `{ printf '<!doctype html><html><head><style>'
cat <<'CSS'
`+filler+`
CSS
printf '</style></head><body><h1>The tunnel under the harbour</h1><p>It took nine years to dig, cost four times what was promised, and carries more traffic in a day than the ferries it replaced managed in a week. The engineers who built it are mostly retired now, and it is due for its first overhaul: new pumps, new lighting, and ventilation specified when lorries were smaller. The works will close one bore at a time, which the harbour authority insists will not affect crossing times. Estimates for the overhaul run to eleven years, one more than it took to build the thing in the first place, and nobody involved seems willing to say that out loud in a meeting that is being minuted. The ferries, meanwhile, are still tied up at the old quay, repainted twice since anyone last sold a ticket for one.</p></body></html>'; } > "$2"`)

		capture, err := h.CaptureLocally(context.Background(), "https://news.example/story")
		if err != nil {
			t.Fatalf("capture: %v", err)
		}
		if capture.NoReadableText {
			t.Fatal("a page whose words come after the stylesheet was called empty")
		}
	})
}
