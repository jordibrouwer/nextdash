package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeStatic drops a file where readStaticAsset will find it, by making the
// temp dir the process's working directory for the test.
func writeStatic(t *testing.T, dir, rel, body string) {
	t.Helper()
	full := filepath.Join(dir, "static", filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

// buildBundleFromDir runs buildBundle with dir as the working directory, since
// readStaticAsset resolves "static/..." relative to it.
func buildBundleFromDir(t *testing.T, dir string, list []string) assetBundle {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })
	return buildBundle(nil, list)
}

// A stack trace out of the bundle should name the file the code was written in.
//
// Concatenation costs attribution: every one of the 130-odd scripts in the
// bundle reports as dashboard.js, so a key conflict or a thrown error names the
// bundle and a line number nobody can place. NEXTDASH_BUNDLE=off was the
// workaround, which means reproducing the problem in a different build from the
// one that had it.
//
// A `//# sourceURL` per file does not work -- tested in a browser, the last
// directive in a script wins for the whole script, so several of them make the
// attribution worse rather than better. A source map is the mechanism that
// exists for this, and because the bundle is plain concatenation the mapping is
// just a line offset per file.
func TestBundleSourceMapNamesEveryFile(t *testing.T) {
	b := assetBundle{
		files: []string{"js/one.js", "js/two.js"},
		// Two lines of banner + body each, matching what buildBundle writes.
		content: []byte("\n/* ==== js/one.js ==== */\nlineA\nlineB\n\n/* ==== js/two.js ==== */\nlineC\n"),
		hash:    "abc123",
	}
	b.lineStarts = []int{2, 6}

	raw := buildBundleSourceMap(b, bundleJSPath)
	if raw == "" {
		t.Fatal("no source map produced")
	}

	var sm struct {
		Version  int      `json:"version"`
		File     string   `json:"file"`
		Sources  []string `json:"sources"`
		Mappings string   `json:"mappings"`
	}
	if err := json.Unmarshal([]byte(raw), &sm); err != nil {
		t.Fatalf("source map is not valid JSON: %v", err)
	}
	if sm.Version != 3 {
		t.Errorf("version = %d, want 3", sm.Version)
	}
	if len(sm.Sources) != 2 {
		t.Fatalf("sources = %v, want both files", sm.Sources)
	}
	for i, want := range []string{"/static/js/one.js", "/static/js/two.js"} {
		if sm.Sources[i] != want {
			t.Errorf("sources[%d] = %q, want %q", i, sm.Sources[i], want)
		}
	}
	if !strings.Contains(sm.File, "dashboard.js") {
		t.Errorf("file = %q, want it to name the bundle", sm.File)
	}
	// One mapping group per line of the bundle, so a line number resolves.
	if strings.Count(sm.Mappings, ";") < 6 {
		t.Errorf("mappings cover too few lines: %q", sm.Mappings)
	}
}

// The banner comment buildBundle already writes is what the line offsets are
// counted from, so the two cannot drift apart.
func TestBuildBundleRecordsWhereEachFileStarts(t *testing.T) {
	dir := t.TempDir()
	writeStatic(t, dir, "js/a.js", "console.log(1);\nconsole.log(2);\n")
	writeStatic(t, dir, "js/b.js", "console.log(3);\n")

	b := buildBundleFromDir(t, dir, []string{"js/a.js", "js/b.js"})
	if len(b.files) != 2 {
		t.Fatalf("files = %v", b.files)
	}
	if len(b.lineStarts) != 2 {
		t.Fatalf("lineStarts = %v, want one per file", b.lineStarts)
	}
	lines := strings.Split(string(b.content), "\n")
	// The recorded start for each file is the line its first statement is on.
	if got := lines[b.lineStarts[0]]; got != "console.log(1);" {
		t.Errorf("first file starts at %q", got)
	}
	if got := lines[b.lineStarts[1]]; got != "console.log(3);" {
		t.Errorf("second file starts at %q", got)
	}
}
