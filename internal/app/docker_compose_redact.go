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

var composeSecretKey = regexp.MustCompile(`(?i)pass|secret|token|key|cred|private`)

// A value that is only a variable reference stays visible: ${DB_PASS} names a
// secret, it does not hold one. A reference with a default (${X:-hunter2}) can,
// so that one is masked.
var composePureRef = regexp.MustCompile(`^\$(\{[A-Za-z_][A-Za-z0-9_]*(:?\?[^}]*)?\}|[A-Za-z_][A-Za-z0-9_]*)$`)

type composeMasked struct {
	Key   string `json:"key"`
	Line  int    `json:"line"`
	value string // what the mask hides; only the reveal route reads it
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
	src    []byte
	starts []int
	splice []composeSplice
	masked []composeMasked
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
func (w *composeWalker) mask(n *yaml.Node, key string, parentIndent int, flow bool, skip int, value string) {
	start := w.offsetOf(n.Line, n.Column)
	if start < 0 {
		return
	}
	ts, te, kind, ok := w.scalarSpan(start, parentIndent, flow)
	if !ok {
		return
	}
	entry := composeMasked{Key: key, Line: n.Line, value: value}
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
				if composeSecretKey.MatchString(k.Value) && v.Value != "" && !composeIsRef(v.Value) {
					w.mask(v, p, indent, flow, 0, v.Value)
				}
				continue
			}
			w.walk(v, p, indent, flow, k.Value == "environment")
		}
	case yaml.SequenceNode:
		for i, item := range n.Content {
			p := path + "[" + strconv.Itoa(i) + "]"
			if item.Kind == yaml.ScalarNode {
				if !envList {
					continue
				}
				name, val, ok := strings.Cut(item.Value, "=")
				if !ok || val == "" || !composeSecretKey.MatchString(name) || composeIsRef(val) {
					continue
				}
				// The mask starts after "NAME=": a plain item is that many bytes in.
				w.mask(item, path+"."+name, w.itemIndent(item), flow, len(name)+1, val)
				continue
			}
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
		return out, masked, composeYAMLErrorOf(err)
	}
	w := &composeWalker{src: src, starts: composeLineStarts(src)}
	w.walk(&doc, "", -1, false, false)
	return applyComposeSplices(src, w.splice), nonNilMasked(w.masked), nil
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
	for i, line := range strings.SplitAfter(string(src), "\n") {
		body, eol := line, ""
		if strings.HasSuffix(body, "\n") {
			body, eol = body[:len(body)-1], "\n"
			if strings.HasSuffix(body, "\r") {
				body, eol = body[:len(body)-1], "\r\n"
			}
		}
		if m := composeFallbackLine.FindStringSubmatch(body); m != nil &&
			composeSecretKey.MatchString(m[2]) && !composeIsRef(m[4]) {
			masked = append(masked, composeMasked{Key: m[2], Line: i + 1, value: strings.TrimSpace(m[4])})
			body = m[1] + m[2] + m[3] + composeMask
		}
		out.WriteString(body)
		out.WriteString(eol)
	}
	return []byte(out.String()), masked
}

// composeValueAt is the reveal route's lookup: the value the mask hid at a
// masked key. Only keys the redactor masked can be revealed.
func composeValueAt(src []byte, key string) (string, bool) {
	var doc yaml.Node
	var masked []composeMasked
	if err := yaml.Unmarshal(src, &doc); err != nil {
		_, masked = composeFallbackRedact(src)
	} else {
		w := &composeWalker{src: src, starts: composeLineStarts(src)}
		w.walk(&doc, "", -1, false, false)
		masked = w.masked
	}
	for _, m := range masked {
		if m.Key == key {
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
		masked = append(masked, composeMasked{Key: e.name, Line: e.line, value: e.value})
	}
	return []byte(strings.Join(lines, "\n")), masked
}

// envValueAt is composeValueAt for an env file: key is the variable name.
func envValueAt(src []byte, key string) (string, bool) {
	for _, e := range parseComposeEnv(src) {
		if e.name == key && (e.value != "" || e.extraLines > 0) {
			return e.value, true
		}
	}
	return "", false
}
