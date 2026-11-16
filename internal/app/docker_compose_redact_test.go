package app

import (
	"strings"
	"testing"
)

const composeRedactSample = `# stack
services:
  db:
    image: postgres:16 # pinned
    environment:
      POSTGRES_PASSWORD: hunter2
      POSTGRES_USER: "app"
      API_TOKEN: "quoted-token"
      SINGLE_KEY: 'single-key'
      FROM_ENV: ${DB_PASS}
      DB_PASSWORD: ${DB_PASS}
      WITH_DEFAULT_SECRET: ${X:-hunter3}

  web:
    image: web
    environment:
      - SESSION_SECRET=abc123
      - "QUOTED_TOKEN=in-quotes"
      - PLAIN=visible
      - API_KEY=${API_KEY}
    command: ["run"]
    labels:
      traefik.password: label-secret
    private_key: |
      line one
      line two

      line four
    after: kept
`

func TestRedactComposeYAMLMapAndListForms(t *testing.T) {
	out, masked, yerr := redactComposeYAML([]byte(composeRedactSample))
	if yerr != nil {
		t.Fatalf("yaml error: %+v", yerr)
	}
	got := string(out)
	for _, leak := range []string{"hunter2", "quoted-token", "single-key", "hunter3", "abc123", "in-quotes", "label-secret", "line one", "line two", "line four"} {
		if strings.Contains(got, leak) {
			t.Errorf("%q leaked:\n%s", leak, got)
		}
	}
	for _, keep := range []string{"# stack", "postgres:16 # pinned", "POSTGRES_USER: \"app\"", "FROM_ENV: ${DB_PASS}", "DB_PASSWORD: ${DB_PASS}", "- PLAIN=visible", "- API_KEY=${API_KEY}", "command: [\"run\"]", "after: kept", "private_key: |"} {
		if !strings.Contains(got, keep) {
			t.Errorf("%q must stay:\n%s", keep, got)
		}
	}
	for _, shape := range []string{`POSTGRES_PASSWORD: ` + composeMask, `API_TOKEN: "` + composeMask + `"`, `SINGLE_KEY: '` + composeMask + `'`, `- SESSION_SECRET=` + composeMask, `- "QUOTED_TOKEN=` + composeMask + `"`} {
		if !strings.Contains(got, shape) {
			t.Errorf("want %q in:\n%s", shape, got)
		}
	}
	want := map[string]string{
		"services.db.environment.POSTGRES_PASSWORD":   "hunter2",
		"services.db.environment.API_TOKEN":           "quoted-token",
		"services.db.environment.SINGLE_KEY":          "single-key",
		"services.db.environment.WITH_DEFAULT_SECRET": "${X:-hunter3}",
		"services.web.environment.SESSION_SECRET":     "abc123",
		"services.web.environment.QUOTED_TOKEN":       "in-quotes",
		"services.web.labels.traefik.password":        "label-secret",
		"services.web.private_key":                    "line one\nline two\n\nline four\n",
	}
	if len(masked) != len(want) {
		t.Errorf("masked %d keys, want %d: %+v", len(masked), len(want), masked)
	}
	for key, val := range want {
		got, ok := composeValueAt([]byte(composeRedactSample), key)
		if !ok || got != val {
			t.Errorf("composeValueAt(%q) = %q, %v; want %q", key, got, ok, val)
		}
	}
	if _, ok := composeValueAt([]byte(composeRedactSample), "services.db.environment.POSTGRES_USER"); ok {
		t.Error("an unmasked key must not be revealable")
	}
	// Line numbers point at the masked value's line.
	for _, m := range masked {
		if m.Key == "services.db.environment.POSTGRES_PASSWORD" && m.Line != 6 {
			t.Errorf("line = %d", m.Line)
		}
	}
}

// Outside the masks the bytes are exactly what was written: layout, comments,
// blank lines, line endings.
func TestRedactComposeYAMLKeepsEverythingElseByteIdentical(t *testing.T) {
	out, _, _ := redactComposeYAML([]byte(composeRedactSample))
	a, b := strings.Split(composeRedactSample, "\n"), strings.Split(string(out), "\n")
	if len(a) != len(b) {
		t.Fatalf("line count changed: %d -> %d", len(a), len(b))
	}
	changed := 0
	for i := range a {
		if a[i] != b[i] {
			changed++
			if !strings.Contains(b[i], composeMask) {
				t.Errorf("line %d changed without a mask: %q -> %q", i+1, a[i], b[i])
			}
		}
	}
	// 4 db values, 2 list items, 1 label, 3 text lines of the block scalar.
	if changed != 10 {
		t.Errorf("changed lines = %d, want 10", changed)
	}
	crlf := strings.ReplaceAll("environment:\n  A_PASSWORD: x # c\n  B: y\n", "\n", "\r\n")
	out, _, _ = redactComposeYAML([]byte(crlf))
	if string(out) != strings.ReplaceAll("environment:\n  A_PASSWORD: "+composeMask+" # c\n  B: y\n", "\n", "\r\n") {
		t.Errorf("crlf: %q", out)
	}
}

func TestRedactComposeYAMLMultilinePlainAndFlow(t *testing.T) {
	src := "environment:\n  A_SECRET: first\n    second\n  B: y\n  C: {D_TOKEN: abc, E: z}\n"
	out, masked, yerr := redactComposeYAML([]byte(src))
	if yerr != nil || len(masked) != 2 {
		t.Fatalf("%v %+v", yerr, masked)
	}
	got := string(out)
	if strings.Contains(got, "first") || strings.Contains(got, "second") || strings.Contains(got, "abc") {
		t.Errorf("leak:\n%s", got)
	}
	if !strings.Contains(got, "B: y") || !strings.Contains(got, "E: z") {
		t.Errorf("neighbours must stay:\n%s", got)
	}
}

func TestRedactComposeYAMLBrokenFileFallsBackAndReportsLine(t *testing.T) {
	src := "services:\n  web:\n    environment:\n      DB_PASSWORD: hunter2\n      - - broken: [\n    image: x\n"
	out, masked, yerr := redactComposeYAML([]byte(src))
	if yerr == nil || yerr.Line < 1 || yerr.Message == "" {
		t.Fatalf("yaml error = %+v", yerr)
	}
	if strings.Contains(string(out), "hunter2") {
		t.Errorf("fallback leaked:\n%s", out)
	}
	if len(masked) != 1 || masked[0].Key != "DB_PASSWORD" || masked[0].Line != 4 {
		t.Errorf("masked = %+v", masked)
	}
	if v, ok := composeValueAt([]byte(src), "DB_PASSWORD"); !ok || v != "hunter2" {
		t.Errorf("reveal on a broken file = %q %v", v, ok)
	}
	// List form in the fallback.
	out2, _, yerr2 := redactComposeYAML([]byte("a: [\n  - API_TOKEN=abc\n"))
	if yerr2 == nil || strings.Contains(string(out2), "abc") {
		t.Errorf("list fallback: %q %+v", out2, yerr2)
	}
}

func TestRedactEnvFile(t *testing.T) {
	src := "# comment\nDB_PASS=hunter2\nexport TOKEN = \"abc def\"\n\nEMPTY=\nMULTI=\"line1\nline2\"\nPLAIN=x # trailing\nURL=http://u:p@h\n"
	out, masked := redactEnvFile([]byte(src))
	got := string(out)
	for _, leak := range []string{"hunter2", "abc def", "line1", "line2", "p@h", "=x"} {
		if strings.Contains(got, leak) {
			t.Errorf("%q leaked:\n%s", leak, got)
		}
	}
	for _, keep := range []string{"# comment", "DB_PASS=" + composeMask, "export TOKEN = " + composeMask, "EMPTY=\n", "MULTI="} {
		if !strings.Contains(got, keep) {
			t.Errorf("%q must stay:\n%s", keep, got)
		}
	}
	if strings.Count(got, "\n") != strings.Count(src, "\n") {
		t.Errorf("line count moved:\n%s", got)
	}
	names := map[string]string{"DB_PASS": "hunter2", "TOKEN": "abc def", "MULTI": "line1\nline2", "PLAIN": "x", "URL": "http://u:p@h"}
	if len(masked) != len(names) {
		t.Errorf("masked = %+v", masked)
	}
	for k, v := range names {
		if got, ok := envValueAt([]byte(src), k); !ok || got != v {
			t.Errorf("envValueAt(%q) = %q %v, want %q", k, got, ok, v)
		}
	}
	if _, ok := envValueAt([]byte(src), "EMPTY"); ok {
		t.Error("an empty value has nothing to reveal")
	}
}
