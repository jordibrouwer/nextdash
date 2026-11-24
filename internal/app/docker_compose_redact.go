package app

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

/*
Masking secrets in a compose file or an env file, without rewriting it.

The mask is spliced into the ORIGINAL bytes at the position yaml.v3 reports, so
comments, blank lines, indentation and quoting stay exactly as written. Only
the value is replaced. A file that does not parse falls back to masking line by
line, so a half-edited file never shows a password.
*/

const composeMask = "••••••"

// The short ones (PW, PSK, PIN) only as a word of their own: DB_PW and WIFI_PSK
// are passwords, SPWEIGHT and SPINDOWN are not.
var composeSecretKey = regexp.MustCompile(`(?i)pass|secret|token|key|cred|private|auth|dsn|pwd|salt|jwt|cookie|session|webhook|(?:^|[_.-])(?:pw|psk|pin)(?:$|[_.-])`)

// composeURLCreds finds credentials inside a URL (scheme://user:pw@host), whatever
// the key is called: DATABASE_URL, SENTRY_DSN and friends hold passwords too.
var composeURLCreds = regexp.MustCompile(`://[^/@\s]*:[^/@\s]+@`)

// composeAliasKeys are keys whose value, when it is an alias, makes the anchor's
// definition sensitive (environment: *env, labels: *l, <<: *base).
var composeAliasKeys = map[string]bool{"environment": true, "labels": true, "command": true, "entrypoint": true, "test": true, "<<": true}

// A value that is only a variable reference stays visible: ${DB_PASS} names a
// secret, it does not hold one. A reference with a default (${X:-hunter2}) can,
// so that one is masked.
var composePureRef = regexp.MustCompile(`^\$(\{[A-Za-z_][A-Za-z0-9_]*(:?\?[^}]*)?\}|[A-Za-z_][A-Za-z0-9_]*)$`)

// composeMasked is one hidden value. Key is its path in the file (the old
// address). Name is the bare key or variable name, for a button label. Index is
// its place among the file's masked values, in line order: with Line and Key it
// tells apart two values on one line, or the same key twice.
type composeMasked struct {
	Key   string `json:"key"`
	Name  string `json:"name"`
	Line  int    `json:"line"`
	Index int    `json:"index"`
	value string // what the mask hides; only the reveal route reads it
}

// composeNumberMasked puts the masked values in line order (the walk order
// within a line) and numbers them. The view and the reveal route both come
// through here, so they count alike.
func composeNumberMasked(m []composeMasked) []composeMasked {
	sort.SliceStable(m, func(a, b int) bool { return m[a].Line < m[b].Line })
	for i := range m {
		m[i].Index = i
	}
	return m
}

type composeYAMLError struct {
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Message string `json:"message"`
}

type composeSplice struct {
	start, end int
	text       string
}

func composeLineStarts(src []byte) []int {
	starts := []int{0}
	for i, b := range src {
		if b == '\n' {
			starts = append(starts, i+1)
		}
	}
	return starts
}

func applyComposeSplices(src []byte, sp []composeSplice) []byte {
	sort.Slice(sp, func(a, b int) bool { return sp[a].start < sp[b].start })
	var out []byte
	pos := 0
	for _, s := range sp {
		if s.start < pos || s.end < s.start || s.end > len(src) {
			continue
		}
		out = append(out, src[pos:s.start]...)
		out = append(out, s.text...)
		pos = s.end
	}
	return append(out, src[pos:]...)
}

// lineEnd is the end of the line starting at from, before its \r\n.
func composeLineEnd(src []byte, from int) int {
	i := from
	for i < len(src) && src[i] != '\n' {
		i++
	}
	if i > from && src[i-1] == '\r' {
		i--
	}
	return i
}

func composeIndentOf(src []byte, from int) (indent int, blank bool) {
	i := from
	for i < len(src) && (src[i] == ' ' || src[i] == '\t') {
		i++
	}
	if i >= len(src) || src[i] == '\n' || src[i] == '\r' {
		return i - from, true
	}
	return i - from, false
}

type composeWalker struct {
	src       []byte
	starts    []int
	splice    []composeSplice
	masked    []composeMasked
	sensitive map[string]bool // anchors that an alias uses where a secret lives
}

// newComposeWalker walks doc once to find the anchors that sit behind a secret
// (POSTGRES_PASSWORD: *pw makes &pw sensitive), then walks it again to mask.
func newComposeWalker(src []byte, doc *yaml.Node) *composeWalker {
	w := &composeWalker{src: src, starts: composeLineStarts(src), sensitive: map[string]bool{}}
	w.collect(doc, "")
	w.walk(doc, "", -1, false, false)
	return w
}

func (w *composeWalker) collect(n *yaml.Node, key string) {
	if n == nil {
		return
	}
	switch n.Kind {
	case yaml.DocumentNode:
		for _, c := range n.Content {
			w.collect(c, "")
		}
	case yaml.MappingNode:
		for i := 0; i+1 < len(n.Content); i += 2 {
			k, v := n.Content[i], n.Content[i+1]
			if v.Kind == yaml.AliasNode && (composeSecretKey.MatchString(k.Value) || composeAliasKeys[k.Value]) {
				w.sensitive[v.Value] = true
			}
			w.collect(v, k.Value)
		}
	case yaml.SequenceNode:
		for _, item := range n.Content {
			if item.Kind == yaml.AliasNode && (composeSecretKey.MatchString(key) || composeAliasKeys[key]) {
				w.sensitive[item.Value] = true
			}
			w.collect(item, key)
		}
	}
}

// offsetOf turns yaml.v3's 1-based line and column (columns count characters)
// into a byte offset.
func (w *composeWalker) offsetOf(line, col int) int {
	if line < 1 || line > len(w.starts) {
		return -1
	}
	off := w.starts[line-1]
	for c := 1; c < col; c++ {
		if off >= len(w.src) {
			return -1
		}
		_, n := utf8.DecodeRune(w.src[off:])
		off += n
	}
	return off
}

func (w *composeWalker) lineAt(off int) int {
	return sort.Search(len(w.starts), func(i int) bool { return w.starts[i] > off })
}

// scalarSpan finds where the scalar token that begins at start ends, and what it
// is: a quoted scalar keeps its quotes, a block scalar is returned as header
// plus the content lines that follow. parentIndent is the indent of the key (or
// dash) that owns it, which is how far continuation lines have to be indented.
func (w *composeWalker) scalarSpan(start, parentIndent int, flow bool) (tokStart, tokEnd int, kind byte, ok bool) {
	src := w.src
	i := start
	// An explicit tag or anchor can come first: skip to the value itself.
	for i < len(src) && (src[i] == '!' || src[i] == '&') {
		for i < len(src) && src[i] != ' ' && src[i] != '\n' {
			i++
		}
		for i < len(src) && src[i] == ' ' {
			i++
		}
	}
	if i >= len(src) {
		return 0, 0, 0, false
	}
	switch src[i] {
	case '"':
		j := i + 1
		for j < len(src) {
			if src[j] == '\\' {
				j += 2
				continue
			}
			if src[j] == '"' {
				return i, j + 1, '"', true
			}
			j++
		}
		return 0, 0, 0, false
	case '\'':
		j := i + 1
		for j < len(src) {
			if src[j] == '\'' {
				if j+1 < len(src) && src[j+1] == '\'' {
					j += 2
					continue
				}
				return i, j + 1, '\'', true
			}
			j++
		}
		return 0, 0, 0, false
	case '|', '>':
		return i, composeLineEnd(src, i), 'b', true
	}
	// Plain: to the end of the line (or the next flow delimiter), minus a
	// trailing comment, plus any continuation lines indented deeper than the key.
	end := composeLineEnd(src, i)
	if flow {
		for j := i; j < end; j++ {
			if src[j] == ',' || src[j] == '}' || src[j] == ']' {
				end = j
				break
			}
		}
	}
	for j := i; j+1 < end; j++ {
		if (src[j] == ' ' || src[j] == '\t') && src[j+1] == '#' {
			end = j
			break
		}
	}
	for end > i && (src[end-1] == ' ' || src[end-1] == '\t') {
		end--
	}
	if !flow {
		for {
			next := end
			for next < len(src) && (src[next] == ' ' || src[next] == '\t') {
				next++
			}
			if next >= len(src) || src[next] != '\n' && src[next] != '\r' {
				break // a comment or more text on the same line: not a continuation
			}
			nl := next
			for nl < len(src) && src[nl] != '\n' {
				nl++
			}
			nl++ // start of the next line
			ind, blank := composeIndentOf(src, nl)
			if nl >= len(src) || blank || ind <= parentIndent {
				break
			}
			end = composeLineEnd(src, nl)
			for end > nl && (src[end-1] == ' ' || src[end-1] == '\t') {
				end--
			}
		}
	}
	return i, end, 'p', true
}

// mask hides one scalar. skip counts leading bytes of the token's text to keep
// (the NAME= of an environment list item). It returns the text it hid.
func (w *composeWalker) mask(n *yaml.Node, key, name string, parentIndent int, flow bool, skip int, value string) {
	start := w.offsetOf(n.Line, n.Column)
	if start < 0 {
		return
	}
	ts, te, kind, ok := w.scalarSpan(start, parentIndent, flow)
	if !ok {
		return
	}
	entry := composeMasked{Key: key, Name: name, Line: n.Line, value: value}
	switch kind {
	case 'b':
		// Header stays; every non-blank content line is masked after its indent.
		ln := w.lineAt(ts) // 1-based line of the header
		for l := ln; l < len(w.starts); l++ {
			ls := w.starts[l]
			ind, blank := composeIndentOf(w.src, ls)
			if blank {
				continue
			}
			if ind <= parentIndent {
				break
			}
			w.splice = append(w.splice, composeSplice{ls + ind, composeLineEnd(w.src, ls), composeMask})
		}
	case '"', '\'':
		w.splice = append(w.splice, composeSplice{ts + 1 + skip, te - 1, composeMask})
	default:
		w.splice = append(w.splice, composeSplice{ts + skip, te, composeMask})
	}
	w.masked = append(w.masked, entry)
}

func composeIsRef(v string) bool { return composePureRef.MatchString(strings.TrimSpace(v)) }

func (w *composeWalker) walk(n *yaml.Node, path string, parentIndent int, flow, envList bool) {
	if n == nil {
		return
	}
	flow = flow || n.Style&yaml.FlowStyle != 0
	switch n.Kind {
	case yaml.DocumentNode:
		for _, c := range n.Content {
			w.walk(c, path, -1, flow, false)
		}
	case yaml.MappingNode:
		for i := 0; i+1 < len(n.Content); i += 2 {
			k, v := n.Content[i], n.Content[i+1]
			p := k.Value
			if path != "" {
				p = path + "." + k.Value
			}
			indent := k.Column - 1
			if v.Kind == yaml.ScalarNode {
				if v.Value != "" && (composeURLCreds.MatchString(v.Value) ||
					!composeIsRef(v.Value) && (composeSecretKey.MatchString(k.Value) || v.Anchor != "" && w.sensitive[v.Anchor])) {
					w.mask(v, p, k.Value, indent, flow, 0, v.Value)
				}
				continue
			}
			w.walk(v, p, indent, flow, false)
		}
	case yaml.SequenceNode:
		// Every scalar item is read as it could be a NAME=value pair, a URL with
		// credentials, or the value of the flag before it (--requirepass x): a
		// secret hides in labels, command and x-* lists as well as environment.
		prevFlag := false
		flagName := ""
		for i, item := range n.Content {
			p := path + "[" + strconv.Itoa(i) + "]"
			if item.Kind == yaml.ScalarNode {
				was := prevFlag
				prevFlag = false
				v := item.Value
				switch {
				case v == "":
				case composeURLCreds.MatchString(v),
					was && !composeIsRef(v),
					item.Anchor != "" && w.sensitive[item.Anchor] && !composeIsRef(v):
					w.mask(item, p, flagName, w.itemIndent(item), flow, 0, v)
				default:
					name, val, ok := strings.Cut(v, "=")
					if ok {
						if val != "" && composeSecretKey.MatchString(name) && !composeIsRef(val) {
							// The mask starts after "NAME=": a plain item is that many bytes in.
							w.mask(item, path+"."+name, name, w.itemIndent(item), flow, len(name)+1, val)
						}
					} else if strings.HasPrefix(v, "-") && composeSecretKey.MatchString(v) {
						prevFlag, flagName = true, v
					}
				}
				continue
			}
			prevFlag = false
			w.walk(item, p, w.itemIndent(item), flow, false)
		}
	}
}

// itemIndent is the indent of the line a sequence item sits on: continuation
// lines of a scalar item have to be deeper than its dash.
func (w *composeWalker) itemIndent(item *yaml.Node) int {
	if off := w.offsetOf(item.Line, 1); off >= 0 {
		ind, _ := composeIndentOf(w.src, off)
		return ind
	}
	return 0
}

var composeFallbackLine = regexp.MustCompile(`^(\s*-?\s*["']?)([\w.-]+)(["']?\s*[:=]\s*)(.+)$`)

// redactComposeYAML masks secrets in a compose file. On a parse error it
// masks line by line instead, and reports the error with its line.
func redactComposeYAML(src []byte) ([]byte, []composeMasked, *composeYAMLError) {
	var doc yaml.Node
	if err := yaml.Unmarshal(src, &doc); err != nil {
		out, masked := composeFallbackRedact(src)
		return out, composeNumberMasked(masked), composeYAMLErrorOf(err)
	}
	w := newComposeWalker(src, &doc)
	return applyComposeSplices(src, w.splice), composeNumberMasked(nonNilMasked(w.masked)), nil
}

func nonNilMasked(m []composeMasked) []composeMasked {
	if m == nil {
		return []composeMasked{}
	}
	return m
}

var composeYAMLErrLine = regexp.MustCompile(`line (\d+): (.*)`)

// composeYAMLErrorOf reads yaml.v3's message ("yaml: line 4: did not find
// expected key"). yaml.v3 names the line only, so the column is the line start.
func composeYAMLErrorOf(err error) *composeYAMLError {
	msg := strings.TrimPrefix(err.Error(), "yaml: ")
	e := &composeYAMLError{Line: 1, Column: 1, Message: msg}
	if m := composeYAMLErrLine.FindStringSubmatch(msg); m != nil {
		e.Line, _ = strconv.Atoi(m[1])
		e.Message = m[2]
	}
	return e
}

func composeFallbackRedact(src []byte) ([]byte, []composeMasked) {
	masked := []composeMasked{}
	var out strings.Builder
	contIndent := -1 // after a masked key: lines indented deeper than it are its value
	for i, line := range strings.SplitAfter(string(src), "\n") {
		body, eol := line, ""
		if strings.HasSuffix(body, "\n") {
			body, eol = body[:len(body)-1], "\n"
			if strings.HasSuffix(body, "\r") {
				body, eol = body[:len(body)-1], "\r\n"
			}
		}
		if contIndent >= 0 {
			ind, blank := composeIndentOf([]byte(body), 0)
			if blank {
				out.WriteString(body + eol)
				continue
			}
			if ind > contIndent {
				if n := len(masked); n > 0 {
					masked[n-1].value += "\n" + strings.TrimSpace(body)
				}
				out.WriteString(body[:ind] + composeMask + eol)
				continue
			}
			contIndent = -1
		}
		m := composeFallbackLine.FindStringSubmatch(body)
		switch {
		case m != nil && (composeSecretKey.MatchString(m[2]) && !composeIsRef(m[4]) ||
			composeURLCreds.MatchString(m[4]) ||
			(strings.HasPrefix(m[4], "[") || strings.HasPrefix(m[4], "{")) && composeSecretKey.MatchString(m[4]) && !composeIsRef(m[4])):
			masked = append(masked, composeMasked{Key: m[2], Name: m[2], Line: i + 1, value: strings.TrimSpace(m[4])})
			ind, _ := composeIndentOf([]byte(body), 0)
			contIndent = ind
			body = m[1] + m[2] + m[3] + composeMask
		case composeURLCreds.MatchString(body):
			masked = append(masked, composeMasked{Key: "line " + strconv.Itoa(i+1), Name: "line " + strconv.Itoa(i+1), Line: i + 1, value: strings.TrimSpace(body)})
			body = composeURLCreds.ReplaceAllString(body, "://"+composeMask+"@")
		}
		out.WriteString(body)
		out.WriteString(eol)
	}
	return []byte(out.String()), masked
}

// composeValueAt is the reveal route's lookup: the value the mask hid at a
// masked key. Only keys the redactor masked can be revealed.
func composeValueAt(src []byte, key string) (string, bool) {
	return composeFindMasked(composeMaskedOf(src), key, 0, -1)
}

// composeMaskedOf is the masked list a view of src would carry, with the values.
func composeMaskedOf(src []byte) []composeMasked {
	var doc yaml.Node
	if err := yaml.Unmarshal(src, &doc); err != nil {
		_, masked := composeFallbackRedact(src)
		return composeNumberMasked(masked)
	}
	return composeNumberMasked(newComposeWalker(src, &doc).masked)
}

// composeFindMasked picks one masked value. index >= 0 is the address a view
// gives (a key and a line, when sent too, must agree with it); otherwise a line
// plus key, or the key alone (the first value under it), as before.
func composeFindMasked(masked []composeMasked, key string, line, index int) (string, bool) {
	if index >= 0 {
		if index >= len(masked) {
			return "", false
		}
		m := masked[index]
		if (key != "" && m.Key != key) || (line > 0 && m.Line != line) {
			return "", false
		}
		return m.value, true
	}
	for _, m := range masked {
		if m.Key == key && (line <= 0 || m.Line == line) {
			return m.value, true
		}
	}
	return "", false
}

var composeEnvLine = regexp.MustCompile(`^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$`)

type composeEnvEntry struct {
	name       string
	line       int
	prefix     string // text before the value, to rebuild the line
	value      string // unquoted
	extraLines int    // further lines a quoted value spans
}

// parseComposeEnv reads a dotenv file: NAME=value, optional export, quoted
// values (which may span lines), trailing comments on unquoted values.
func parseComposeEnv(src []byte) []composeEnvEntry {
	lines := strings.Split(string(src), "\n")
	var out []composeEnvEntry
	for i := 0; i < len(lines); i++ {
		body := strings.TrimSuffix(lines[i], "\r")
		if t := strings.TrimSpace(body); t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		m := composeEnvLine.FindStringSubmatch(body)
		if m == nil {
			// Not NAME=value (1PASS=x, KEY: value, a bare line): fail closed. Mask
			// everything after the first = or :, or the whole line without either.
			out = append(out, composeEnvOddLine(body, i+1))
			continue
		}
		e := composeEnvEntry{name: m[2], line: i + 1, prefix: m[1] + m[2] + m[3]}
		raw := strings.TrimSpace(m[4])
		if raw != "" && (raw[0] == '"' || raw[0] == '\'') {
			q := raw[0]
			rest := raw[1:]
			val := ""
			for {
				if j := strings.IndexByte(rest, q); j >= 0 {
					val += rest[:j]
					break
				}
				val += rest
				if i+1 >= len(lines) {
					break
				}
				i++
				e.extraLines++
				val += "\n"
				rest = strings.TrimSuffix(lines[i], "\r")
			}
			e.value = val
		} else {
			if j := strings.Index(raw, " #"); j >= 0 {
				raw = strings.TrimSpace(raw[:j])
			}
			e.value = raw
		}
		out = append(out, e)
	}
	return out
}

func composeEnvOddLine(body string, line int) composeEnvEntry {
	trim := strings.TrimLeft(body, " \t")
	lead := body[:len(body)-len(trim)]
	idx := strings.IndexAny(trim, "=:")
	if idx < 0 {
		return composeEnvEntry{name: "line " + strconv.Itoa(line), line: line, prefix: lead, value: strings.TrimSpace(trim)}
	}
	rest := trim[idx+1:]
	gap := rest[:len(rest)-len(strings.TrimLeft(rest, " \t"))]
	return composeEnvEntry{
		name:   strings.TrimSpace(trim[:idx]),
		line:   line,
		prefix: lead + trim[:idx+1] + gap,
		value:  strings.TrimSpace(rest),
	}
}

// redactEnvFile masks every value in an env file; names, comments and blank
// lines stay. A quoted value that spans lines is masked on every line of it, so
// line numbers do not move.
func redactEnvFile(src []byte) ([]byte, []composeMasked) {
	entries := parseComposeEnv(src)
	masked := []composeMasked{}
	lines := strings.Split(string(src), "\n")
	for _, e := range entries {
		if e.value == "" && e.extraLines == 0 {
			continue
		}
		for k := 0; k <= e.extraLines; k++ {
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
		masked = append(masked, composeMasked{Key: e.name, Name: e.name, Line: e.line, value: e.value})
	}
	return []byte(strings.Join(lines, "\n")), composeNumberMasked(masked)
}

// envValueAt is composeValueAt for an env file: key is the variable name.
func envValueAt(src []byte, key string) (string, bool) {
	return composeFindMasked(envMaskedOf(src), key, 0, -1)
}

func envMaskedOf(src []byte) []composeMasked {
	_, m := redactEnvFile(src)
	return m
}
