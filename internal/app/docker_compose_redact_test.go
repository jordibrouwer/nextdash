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

func TestRedactComposeYAMLFailsClosed(t *testing.T) {
	src := `x-env: &env
  - "DB_PASSWORD=anchored-list"
x-db: &pw anchored-scalar
services:
  a:
    environment: *env
    DATABASE_URL: postgres://u:url-pw@db/x
    SENTRY_DSN: https://pub:dsn-pw@sentry.io/1
    BASIC_AUTH: basic-pw
    labels:
      - "traefik.http.middlewares.m.basicauth.users=admin:label-pw"
      - traefik.enable=true
    command: ["--requirepass", "flag-pw", "--port", "6379"]
    environment2:
      POSTGRES_PASSWORD: *pw
`
	out, _, yerr := redactComposeYAML([]byte(src))
	if yerr != nil {
		t.Fatal(yerr)
	}
	got := string(out)
	for _, leak := range []string{"anchored-list", "anchored-scalar", "url-pw", "dsn-pw", "basic-pw", "label-pw", "flag-pw"} {
		if strings.Contains(got, leak) {
			t.Errorf("%q leaked:\n%s", leak, got)
		}
	}
	for _, keep := range []string{"traefik.enable=true", `"--port", "6379"`} {
		if !strings.Contains(got, keep) {
			t.Errorf("%q must stay:\n%s", keep, got)
		}
	}
	if v, ok := composeValueAt([]byte(src), "services.a.DATABASE_URL"); !ok || v != "postgres://u:url-pw@db/x" {
		t.Errorf("reveal of a URL credential = %q, %v", v, ok)
	}
}

func TestRedactComposeURLCredentialsOnly(t *testing.T) {
	// The guard in isolation: a neutral key, no anchor, no list.
	out, _, _ := redactComposeYAML([]byte("services:\n  a:\n    environment:\n      REDIS_URL: redis://:pw123@cache:6379\n      PLAIN_URL: http://host:8080/x\n"))
	if strings.Contains(string(out), "pw123") || !strings.Contains(string(out), "http://host:8080/x") {
		t.Errorf("url credentials: %s", out)
	}
}

func TestRedactComposeFallbackBlockScalarAndURL(t *testing.T) {
	src := "services:\n  a:\n    private_key: |\n      line-one-secret\n      line-two-secret\n    other: x\n   : broken\n  u: postgres://a:fb-pw@h/db\n"
	out, _, yerr := redactComposeYAML([]byte(src))
	if yerr == nil {
		t.Fatal("expected a yaml error")
	}
	got := string(out)
	for _, leak := range []string{"line-one-secret", "line-two-secret", "fb-pw"} {
		if strings.Contains(got, leak) {
			t.Errorf("%q leaked in the fallback:\n%s", leak, got)
		}
	}
	if !strings.Contains(got, "other: x") {
		t.Errorf("unrelated line changed:\n%s", got)
	}
}

func TestRedactEnvFileFailsClosed(t *testing.T) {
	src := "OK=fine\n1PASS=digit-pw\nKEY: colon-pw\nbare-secret-line\n# comment\n  spaced = sp-pw\n"
	out, masked := redactEnvFile([]byte(src))
	got := string(out)
	for _, leak := range []string{"fine", "digit-pw", "colon-pw", "bare-secret-line", "sp-pw"} {
		if strings.Contains(got, leak) {
			t.Errorf("%q leaked:\n%s", leak, got)
		}
	}
	if !strings.Contains(got, "# comment") || !strings.Contains(got, "1PASS=") || len(masked) != 5 {
		t.Errorf("shape wrong (%d masked):\n%s", len(masked), got)
	}
	if v, ok := envValueAt([]byte(src), "1PASS"); !ok || v != "digit-pw" {
		t.Errorf("reveal 1PASS = %q, %v", v, ok)
	}
}

// Short secret names are masked as a word of their own, and only then: the
// files view is readable without the write token, so a miss here is a leak.
func TestRedactComposeYAMLShortSecretNames(t *testing.T) {
	src := "services:\n  db:\n    environment:\n      DB_PW: hunter2\n      WIFI_PSK: wpa-secret\n      ADMIN_PIN: \"4321\"\n      SPINDOWN: \"20\"\n      SPWEIGHT: \"5\"\n"
	out, _, yerr := redactComposeYAML([]byte(src))
	if yerr != nil {
		t.Fatalf("yaml error: %+v", yerr)
	}
	got := string(out)
	for _, leak := range []string{"hunter2", "wpa-secret", "4321"} {
		if strings.Contains(got, leak) {
			t.Errorf("%q leaked:\n%s", leak, got)
		}
	}
	for _, keep := range []string{`SPINDOWN: "20"`, `SPWEIGHT: "5"`} {
		if !strings.Contains(got, keep) {
			t.Errorf("%q must stay:\n%s", keep, got)
		}
	}
}
