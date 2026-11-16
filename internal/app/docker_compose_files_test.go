package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestParseComposeMap(t *testing.T) {
	maps, rejected := parseComposeMap("/opt/stacks:/stacks, /opt/stacks/deep:/deep,rel:/x,/a:rel,nocolon,/opt/stacks:/again,:/x")
	if len(maps) != 2 {
		t.Fatalf("maps = %+v", maps)
	}
	if maps[0].Host != "/opt/stacks/deep" || maps[1].Host != "/opt/stacks" {
		t.Fatalf("longest prefix must sort first: %+v", maps)
	}
	if len(rejected) != 5 { // rel:/x, /a:rel, nocolon, duplicate, :/x
		t.Fatalf("rejected = %v", rejected)
	}
	if m, r := parseComposeMap(""); len(m) != 0 || len(r) != 0 {
		t.Fatalf("empty = %v %v", m, r)
	}
	// A colon inside the host path: split on the last one.
	if m, _ := parseComposeMap("/mnt/a:b:/stacks"); len(m) != 1 || m[0].Host != "/mnt/a:b" {
		t.Fatalf("last colon: %+v", m)
	}
}

func TestMapComposePathLongestPrefixAndBoundary(t *testing.T) {
	maps, _ := parseComposeMap("/opt/stacks:/stacks,/opt/stacks/media:/media")
	got, err := mapComposePath("/opt/stacks/media/compose.yml", maps)
	if err != nil || got != "/media/compose.yml" {
		t.Fatalf("longest prefix: %q %v", got, err)
	}
	got, err = mapComposePath("/opt/stacks/web/compose.yml", maps)
	if err != nil || got != "/stacks/web/compose.yml" {
		t.Fatalf("shorter prefix: %q %v", got, err)
	}
	if _, err := mapComposePath("/opt/stacks2/x/compose.yml", maps); err != errComposeUnmapped {
		t.Fatalf("/opt/stacks2 must not match /opt/stacks: %v", err)
	}
	if _, err := mapComposePath("/opt/stacks/../etc/compose.yml", maps); err != errComposeOutside {
		t.Fatalf(".. must be refused: %v", err)
	}
	if _, err := mapComposePath("relative/compose.yml", maps); err != errComposeUnmapped {
		t.Fatalf("relative: %v", err)
	}
}

func composeTestRoot(t *testing.T) (root string, maps []composeMapping) {
	t.Helper()
	root = t.TempDir()
	return root, []composeMapping{{Host: "/opt/stacks", Container: root}}
}

func TestResolveComposeFileStates(t *testing.T) {
	root, maps := composeTestRoot(t)
	writeTestFile(t, filepath.Join(root, "a/compose.yml"), "services: {}\n")
	writeTestFile(t, filepath.Join(root, "a/notes.txt"), "x")
	writeTestFile(t, filepath.Join(root, "a/.env"), "A=1\n")
	writeTestFile(t, filepath.Join(root, "a/big.yml"), strings.Repeat("a", composeFileMax+1))
	writeTestFile(t, filepath.Join(root, "a/edge.yaml"), strings.Repeat("a", composeFileMax))
	if err := os.MkdirAll(filepath.Join(root, "a/dir.yml"), 0o755); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		path, role, want string
	}{
		{"/opt/stacks/a/compose.yml", composeRoleCompose, composeStateOK},
		{"/opt/stacks/a/edge.yaml", composeRoleCompose, composeStateOK},
		{"/opt/stacks/a/big.yml", composeRoleCompose, composeTooLarge},
		{"/opt/stacks/a/notes.txt", composeRoleCompose, composeNotYAML},
		{"/opt/stacks/a/.env", composeRoleCompose, composeNotYAML},
		{"/opt/stacks/a/.env", composeRoleEnv, composeStateOK},
		{"/opt/stacks/a/notes.txt", composeRoleEnv, composeStateOK},
		{"/opt/stacks/a/dir.yml", composeRoleCompose, composeNotFile},
		{"/opt/stacks/a/nope.yml", composeRoleCompose, composeMissing},
		{"/elsewhere/compose.yml", composeRoleCompose, composeUnmapped},
		{"/opt/stacks/a/../../etc/passwd", composeRoleCompose, composeOutside},
	}
	for _, c := range cases {
		if got := resolveComposeFile(c.path, c.role, maps); got.State != c.want {
			t.Errorf("%s (%s): state = %q, want %q", c.path, c.role, got.State, c.want)
		}
	}
	f := resolveComposeFile("/opt/stacks/a/compose.yml", composeRoleCompose, maps)
	if f.Size != 13 || f.Mode != 0o644 || !f.Writable {
		t.Errorf("fields: %+v", f)
	}
	if os.Geteuid() != 0 {
		writeTestFile(t, filepath.Join(root, "a/locked.yml"), "x")
		if err := os.Chmod(filepath.Join(root, "a/locked.yml"), 0); err != nil {
			t.Fatal(err)
		}
		// Stat still works on a mode-0 file, so it resolves; the read is what is denied.
		f := resolveComposeFile("/opt/stacks/a/locked.yml", composeRoleCompose, maps)
		if _, err := readComposeFileWith(f, maps); err == nil {
			t.Error("a mode-0 file must not be readable")
		}
	}
}

// The guard: a symlink inside the prefix that points out of it is refused,
// whatever its name.
func TestResolveComposeFileRefusesSymlinkOut(t *testing.T) {
	root, maps := composeTestRoot(t)
	outside := t.TempDir()
	writeTestFile(t, filepath.Join(outside, "secret.yml"), "services: {}\n")
	if err := os.MkdirAll(filepath.Join(root, "a"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.yml"), filepath.Join(root, "a/compose.yml")); err != nil {
		t.Fatal(err)
	}
	// A symlinked directory that leaves the prefix, too.
	if err := os.Symlink(outside, filepath.Join(root, "linkdir")); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"/opt/stacks/a/compose.yml", "/opt/stacks/linkdir/secret.yml"} {
		f := resolveComposeFile(p, composeRoleCompose, maps)
		if f.State != composeOutside {
			t.Errorf("%s: state = %q, want %q", p, f.State, composeOutside)
		}
		if _, err := readComposeFileWith(f, maps); err == nil {
			t.Errorf("%s: must not be readable", p)
		}
	}
	// A symlink that stays inside is fine.
	writeTestFile(t, filepath.Join(root, "real/compose.yml"), "services: {}\n")
	if err := os.Symlink(filepath.Join(root, "real/compose.yml"), filepath.Join(root, "a/ok.yml")); err != nil {
		t.Fatal(err)
	}
	if f := resolveComposeFile("/opt/stacks/a/ok.yml", composeRoleCompose, maps); f.State != composeStateOK {
		t.Errorf("inside symlink: %q", f.State)
	}
}

func composeSummary(name string, labels map[string]string) dockerContainerSummary {
	labels[composeLabelProject] = name
	return dockerContainerSummary{ID: strings.Repeat("a", 64), Labels: labels}
}

func TestComposeProjectFromUnionAndEnvFileLabel(t *testing.T) {
	list := []dockerContainerSummary{
		composeSummary("media", map[string]string{composeLabelConfig: "/s/media/compose.yml,/s/media/compose.override.yml", composeLabelWorkingDir: "/s/media", composeLabelEnvFile: "/s/media/stack.env"}),
		composeSummary("media", map[string]string{composeLabelConfig: "/s/media/compose.yml,/s/media/compose.override.yml"}),
		composeSummary("other", map[string]string{composeLabelConfig: "/s/other/compose.yml"}),
	}
	p, ok := composeProjectFrom(list, "media")
	if !ok || len(p.Members) != 2 || p.Mismatch {
		t.Fatalf("project = %+v", p)
	}
	if len(p.ConfigFiles) != 2 || p.ConfigFiles[0] != "/s/media/compose.yml" {
		t.Fatalf("label order kept: %v", p.ConfigFiles)
	}
	if p.WorkingDir != "/s/media" || len(p.EnvFiles) != 1 || p.EnvFiles[0] != "/s/media/stack.env" {
		t.Fatalf("working dir / environment_file label: %+v", p)
	}
	if _, ok := composeProjectFrom(list, "nope"); ok {
		t.Fatal("unknown project")
	}
	list = append(list, composeSummary("media", map[string]string{composeLabelConfig: "/s/media/z.yml"}))
	p, _ = composeProjectFrom(list, "media")
	if !p.Mismatch {
		t.Fatal("different labels must set mismatch")
	}
	want := []string{"/s/media/compose.override.yml", "/s/media/compose.yml", "/s/media/z.yml"}
	if strings.Join(p.ConfigFiles, ",") != strings.Join(want, ",") {
		t.Fatalf("sorted union = %v", p.ConfigFiles)
	}
}

func TestComposeFilesOfEnvRules(t *testing.T) {
	root, maps := composeTestRoot(t)
	writeTestFile(t, filepath.Join(root, "s/compose.yml"), "services:\n  a:\n    env_file:\n      - app.env\n      - ../escape.env\n  b:\n    env_file: [.env, {path: other.env}]\n")
	writeTestFile(t, filepath.Join(root, "s/app.env"), "A=1\n")
	writeTestFile(t, filepath.Join(root, "s/other.env"), "B=1\n")
	p := composeProject{Name: "s", ConfigFiles: []string{"/opt/stacks/s/compose.yml"}, WorkingDir: "/opt/stacks/s"}
	files := composeFilesOf(p, maps)
	byID := map[string]composeFile{}
	for _, f := range files {
		byID[f.ID] = f
	}
	// No .env on disk: the default is left out; env_file lists .env once it is named.
	if _, ok := byID["env"]; ok {
		t.Errorf("a missing default .env must be left out: %+v", files)
	}
	var paths []string
	for _, f := range files {
		paths = append(paths, f.ID+"="+f.HostPath+":"+f.State)
	}
	joined := strings.Join(paths, "\n")
	for _, want := range []string{
		"/opt/stacks/s/app.env:ok",
		"/opt/stacks/s/other.env:ok",
		"/opt/stacks/s/.env:compose-missing", // named in the YAML, so it shows
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in:\n%s", want, joined)
		}
	}
	// ../escape.env is outside the working directory: refused, never read.
	if !strings.Contains(joined, "/opt/stacks/s/../escape.env:compose-outside") {
		t.Errorf("escape not refused:\n%s", joined)
	}
	// With the label, that file is `env` and wins over .env.
	writeTestFile(t, filepath.Join(root, "s/stack.env"), "C=1\n")
	p.EnvFiles = []string{"/opt/stacks/s/stack.env"}
	f, ok := composeFileByID(composeFilesOf(p, maps), "env")
	if !ok || f.HostPath != "/opt/stacks/s/stack.env" || f.State != composeStateOK {
		t.Errorf("environment_file label: %+v", f)
	}
	if _, ok := composeFileByID(files, "/etc/passwd"); ok {
		t.Error("a path is not an id")
	}
}
