package app

import (
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

/*
The assistant's knowledge of nextDash: the manual and the README that ship in
the binary, split into sections and searched with a small keyword ranker.

Two tools use it, search_docs and read_doc. They are the assistant's own (not
MCP tools): they hold nothing of the person's, read only the embedded files
and are offered whenever the assistant runs.

The index is built once, on first use. Nothing leaves the process for it: no
service, no embeddings.
*/

const (
	aiDocsSearchTool = "search_docs"
	aiDocsReadTool   = "read_doc"
	aiDocsGroup      = "docs" // the group of the "tool" event, for the panel's status line

	aiDocsPartMax      = 6000 // bytes of one section, or one part of a long one
	aiDocsSnippetRunes = 240
	aiDocsDefaultLimit = 5
	aiDocsMaxLimit     = 8
)

// aiConfigSections are the Config sections a link may name. They are the same
// list as DashboardConfig.SECTIONS in static/js/dashboard/dashboard-config.js;
// a test fails when the two drift.
var aiConfigSections = []string{
	"overview", "appearance", "bookmarks", "structure", "behavior", "finders",
	"inbox", "data-backups", "widgets", "containers", "unraid", "glances",
	"monitoring", "status-page", "assistant", "stats", "help", "logs", "about",
}

type aiDoc struct {
	ID      string
	Title   string
	Path    string
	Source  string // MANUAL or README
	Text    string
	Part    int
	Parts   int
	Next    string
	Prev    string
	tf      map[string]float64
	length  float64
	title   []string // stemmed content words of the title, in order
	content []string // stemmed content words of the text, in order
}

type aiDocsIndex struct {
	docs   []*aiDoc
	byID   map[string]*aiDoc
	df     map[string]int
	avgLen float64
}

var (
	aiDocsOnce  sync.Once
	aiDocsBuilt *aiDocsIndex
)

// aiDocsGet is the index of the embedded manual and README, built on first use.
func aiDocsGet() *aiDocsIndex {
	aiDocsOnce.Do(func() {
		var manual, readme string
		if embeddedFiles != nil {
			if b, err := embeddedFiles.ReadFile("MANUAL.md"); err == nil {
				manual = string(b)
			}
			if b, err := embeddedFiles.ReadFile("README.md"); err == nil {
				readme = string(b)
			}
		}
		aiDocsBuilt = buildAIDocsIndex(manual, readme)
	})
	return aiDocsBuilt
}

// ── Reading the Markdown ───────────────────────────────────────────────────

var (
	aiDocsHeadingRe = regexp.MustCompile(`^(#{1,3})\s+(.+?)\s*#*\s*$`)
	aiDocsAnchorRe  = regexp.MustCompile(`^\s*<a\s+id="([^"]+)"\s*>\s*</a>\s*$`)
	aiDocsTagRe     = regexp.MustCompile(`(?i)</?(p|img|a|details|summary|picture|source|br|kbd|b|i|em|strong|sub|sup|div|span|table|tr|td|th|thead|tbody|center|h[1-6]|video|svg)\b[^>]*>`)
	aiDocsImageRe   = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	aiDocsEmptyLink = regexp.MustCompile(`\[\s*\]\([^)]*\)`)
	aiDocsLinkRe    = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)
	aiDocsRuleRe    = regexp.MustCompile(`^\s*(-{3,}|\*{3,}|_{3,})\s*$`)
	aiDocsTableSep  = regexp.MustCompile(`^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$`)
	aiDocsAlertRe   = regexp.MustCompile(`^>\s*\[!(\w+)\]\s*$`)
	aiDocsSpaceRe   = regexp.MustCompile(`\s+`)
)

type aiDocsSection struct {
	level  int
	title  string
	anchor string
	lines  []string
}

// aiDocsTitle drops emoji and tidies the spaces.
func aiDocsTitle(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.Is(unicode.So, r) || unicode.Is(unicode.Sk, r) || r == 0xFE0F || r == 0x200D {
			continue
		}
		b.WriteRune(r)
	}
	s = aiDocsLinkRe.ReplaceAllString(b.String(), "$1")
	s = aiDocsTagRe.ReplaceAllString(s, "")
	s = strings.NewReplacer("**", "", "`", "").Replace(s)
	return strings.TrimSpace(aiDocsSpaceRe.ReplaceAllString(s, " "))
}

func aiDocsSlug(s string) string {
	var b strings.Builder
	dash := false
	for _, r := range s {
		r = aiFoldRune(r)
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

// aiDocsSplit cuts a Markdown file into sections at its #, ## and ### headings.
// A line inside a fenced code block is never a heading.
func aiDocsSplit(src string) []aiDocsSection {
	var out []aiDocsSection
	cur := aiDocsSection{level: 0}
	pendingAnchor := ""
	inFence := false
	flush := func() {
		if cur.level != 0 || len(cur.lines) > 0 {
			out = append(out, cur)
		}
	}
	for _, line := range strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			inFence = !inFence
		}
		if !inFence {
			if m := aiDocsAnchorRe.FindStringSubmatch(line); m != nil {
				pendingAnchor = m[1]
				continue
			}
			if m := aiDocsHeadingRe.FindStringSubmatch(line); m != nil {
				flush()
				cur = aiDocsSection{level: len(m[1]), title: aiDocsTitle(m[2]), anchor: pendingAnchor}
				pendingAnchor = ""
				continue
			}
			if trimmed != "" {
				pendingAnchor = ""
			}
		}
		cur.lines = append(cur.lines, line)
	}
	flush()
	return out
}

// aiDocsClean turns the Markdown of one section into the text the model reads:
// no images, anchors, HTML or tracking markup; links keep their words; tables
// stay as rows of text.
func aiDocsClean(lines []string) string {
	var out []string
	inFence := false
	blank := true
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			inFence = !inFence
			out = append(out, strings.TrimRight(line, " \t"))
			blank = false
			continue
		}
		if inFence {
			out = append(out, strings.TrimRight(line, " \t"))
			blank = false
			continue
		}
		if aiDocsAnchorRe.MatchString(line) || aiDocsRuleRe.MatchString(line) || (aiDocsTableSep.MatchString(line) && strings.Contains(line, "|")) {
			continue
		}
		hadTag := aiDocsTagRe.MatchString(line) || aiDocsImageRe.MatchString(line)
		line = aiDocsImageRe.ReplaceAllString(line, "")
		line = aiDocsEmptyLink.ReplaceAllString(line, "")
		line = aiDocsTagRe.ReplaceAllString(line, "")
		line = aiDocsLinkRe.ReplaceAllString(line, "$1")
		trimmed = strings.TrimSpace(line)
		if m := aiDocsAlertRe.FindStringSubmatch(trimmed); m != nil {
			line = strings.ToUpper(m[1][:1]) + strings.ToLower(m[1][1:]) + ":"
		} else if strings.HasPrefix(trimmed, ">") {
			line = strings.TrimSpace(strings.TrimPrefix(trimmed, ">"))
		} else if strings.HasPrefix(trimmed, "|") {
			line = strings.TrimSpace(strings.Trim(trimmed, "|"))
		}
		line = strings.TrimRight(line, " \t")
		if strings.TrimSpace(line) == "" {
			if hadTag || blank {
				continue
			}
			blank = true
			out = append(out, "")
			continue
		}
		blank = false
		out = append(out, line)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

// aiDocsParagraphs splits text at blank lines outside code fences.
func aiDocsParagraphs(text string) []string {
	var out []string
	var cur []string
	inFence := false
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "```") {
			inFence = !inFence
		}
		if !inFence && strings.TrimSpace(line) == "" {
			if len(cur) > 0 {
				out = append(out, strings.Join(cur, "\n"))
				cur = nil
			}
			continue
		}
		cur = append(cur, line)
	}
	if len(cur) > 0 {
		out = append(out, strings.Join(cur, "\n"))
	}
	return out
}

// aiDocsParts cuts text into pieces of at most max bytes, on paragraph
// boundaries; a paragraph longer than max is cut on a line, then on a character.
func aiDocsParts(text string, max int) []string {
	if len(text) <= max {
		return []string{text}
	}
	var pieces []string
	for _, p := range aiDocsParagraphs(text) {
		for len(p) > max {
			cut := strings.LastIndex(p[:max], "\n")
			if cut <= 0 {
				cut = max
				for cut > 0 && !utf8.RuneStart(p[cut]) {
					cut--
				}
			}
			pieces = append(pieces, p[:cut])
			p = strings.TrimLeft(p[cut:], "\n")
		}
		if p != "" {
			pieces = append(pieces, p)
		}
	}
	var parts []string
	var cur string
	for _, p := range pieces {
		switch {
		case cur == "":
			cur = p
		case len(cur)+2+len(p) <= max:
			cur += "\n\n" + p
		default:
			parts = append(parts, cur)
			cur = p
		}
	}
	if cur != "" {
		parts = append(parts, cur)
	}
	return parts
}

// ── Words ──────────────────────────────────────────────────────────────────

var aiFoldTable = func() map[rune]rune {
	m := map[rune]rune{'ß': 's'}
	for base, letters := range map[rune]string{
		'a': "àáâãäåāăą", 'c': "çćčĉċ", 'd': "ďđ", 'e': "èéêëēĕėęě", 'g': "ĝğġģ",
		'h': "ĥħ", 'i': "ìíîïĩīĭįı", 'j': "ĵ", 'k': "ķ", 'l': "ĺļľŀł", 'n': "ñńņňŉ",
		'o': "òóôõöøōŏő", 'r': "ŕŗř", 's': "śŝşš", 't': "ţťŧ", 'u': "ùúûüũūŭůűų",
		'w': "ŵ", 'y': "ýÿŷ", 'z': "źżž",
	} {
		for _, r := range letters {
			m[r] = base
		}
	}
	return m
}()

// aiFoldRune lowercases a character and drops its accent.
func aiFoldRune(r rune) rune {
	r = unicode.ToLower(r)
	if f, ok := aiFoldTable[r]; ok {
		return f
	}
	return r
}

var aiDocsStop = func() map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(`a an the and or but if so of to in on at by for with from as into about over
		is are was were be been being am do does did done doing have has had having can could should would will
		i me my we our you your it its this that these those there here
		how what which who whom when where why
		not no yes also just any some than then too very nothing something anything everything`) {
		m[w] = true
	}
	return m
}()

// aiStem is a light suffix stripper: plurals, -ing, -ed and a trailing e. It
// runs on the index and on the query alike, so only consistency matters.
func aiStem(w string) string {
	n := len(w)
	switch {
	case n > 4 && strings.HasSuffix(w, "ies"):
		w = w[:n-3] + "y"
	case n > 4 && strings.HasSuffix(w, "sses"):
		w = w[:n-2]
	case n > 3 && strings.HasSuffix(w, "es") && (strings.HasSuffix(w[:n-2], "s") || strings.HasSuffix(w[:n-2], "x") ||
		strings.HasSuffix(w[:n-2], "z") || strings.HasSuffix(w[:n-2], "ch") || strings.HasSuffix(w[:n-2], "sh")):
		w = w[:n-2]
	case n > 3 && strings.HasSuffix(w, "s") && !strings.HasSuffix(w, "ss") && !strings.HasSuffix(w, "us") && !strings.HasSuffix(w, "is"):
		w = w[:n-1]
	}
	n = len(w)
	switch {
	case n > 5 && strings.HasSuffix(w, "ing"):
		w = w[:n-3]
	case n > 5 && strings.HasSuffix(w, "ed"):
		w = w[:n-2]
	}
	if n = len(w); n > 4 && strings.HasSuffix(w, "e") {
		w = w[:n-1]
	}
	return w
}

type aiToken struct {
	stem       string
	start, end int // rune offsets in the text
	stop       bool
}

// aiTokenize lowercases, drops accents and splits on everything that is not a
// letter or a digit. One character words are dropped unless they are digits.
func aiTokenize(text []rune) []aiToken {
	var out []aiToken
	var cur []rune
	start := 0
	flush := func(end int) {
		if len(cur) == 0 {
			return
		}
		w := string(cur)
		cur = cur[:0]
		if len(w) == 1 && !unicode.IsDigit(rune(w[0])) {
			return
		}
		out = append(out, aiToken{stem: aiStem(w), start: start, end: end, stop: aiDocsStop[w]})
	}
	for i, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if len(cur) == 0 {
				start = i
			}
			cur = append(cur, aiFoldRune(r))
		} else {
			flush(i)
		}
	}
	flush(len(text))
	return out
}

// aiContent is the stemmed words of a text with the stop words left out.
func aiContent(text string) []string {
	var out []string
	for _, t := range aiTokenize([]rune(text)) {
		if !t.stop {
			out = append(out, t.stem)
		}
	}
	return out
}

// ── Building the index ─────────────────────────────────────────────────────

func buildAIDocsIndex(manual, readme string) *aiDocsIndex {
	idx := &aiDocsIndex{byID: map[string]*aiDoc{}, df: map[string]int{}}
	for _, src := range []struct{ label, text string }{{"MANUAL", manual}, {"README", readme}} {
		if strings.TrimSpace(src.text) == "" {
			continue
		}
		idx.addSource(src.label, src.text)
	}
	idx.finish()
	return idx
}

func (idx *aiDocsIndex) addSource(label, src string) {
	prefix := strings.ToLower(label) + ":"
	var chain [4]string // titles by level, 1..3
	seen := map[string]int{}
	var first []*aiDoc // the docs of this source, in order
	for _, sec := range aiDocsSplit(src) {
		if sec.level > 0 {
			chain[sec.level] = sec.title
			for l := sec.level + 1; l <= 3; l++ {
				chain[l] = ""
			}
		}
		if sec.level == 0 || sec.title == "" || strings.Contains(strings.ToLower(sec.title), "table of contents") {
			continue
		}
		text := aiDocsClean(sec.lines)
		if text == "" {
			continue
		}
		path := []string{label}
		var parents []string
		for l := 2; l <= sec.level; l++ {
			if chain[l] != "" {
				path = append(path, chain[l])
				if l < sec.level {
					parents = append(parents, chain[l])
				}
			}
		}
		base := prefix + sec.anchor
		if sec.anchor == "" {
			base = prefix + aiDocsSlug(sec.title)
		}
		if n := seen[base]; n > 0 {
			seen[base] = n + 1
			base += "-" + strconv.Itoa(n+1)
		} else {
			seen[base] = 1
		}
		parts := aiDocsParts(text, aiDocsPartMax)
		for i, body := range parts {
			d := &aiDoc{
				ID: base, Title: sec.title, Path: strings.Join(path, " › "), Source: label,
				Text: body, Part: i + 1, Parts: len(parts),
			}
			if i > 0 {
				d.ID = base + "#" + strconv.Itoa(i+1)
			}
			if len(parts) > 1 {
				d.Title += " (part " + strconv.Itoa(i+1) + " of " + strconv.Itoa(len(parts)) + ")"
			}
			d.title = aiContent(sec.title)
			d.content = aiContent(body)
			d.tf = map[string]float64{}
			for _, w := range d.title {
				d.tf[w] += 4
			}
			for _, w := range aiContent(strings.Join(parents, " ")) {
				d.tf[w] += 2
			}
			for _, w := range d.content {
				d.tf[w]++
			}
			idx.docs = append(idx.docs, d)
			first = append(first, d)
		}
	}
	for i, d := range first {
		if i > 0 {
			d.Prev = first[i-1].ID
		}
		if i+1 < len(first) {
			d.Next = first[i+1].ID
		}
	}
}

func (idx *aiDocsIndex) finish() {
	var total float64
	for _, d := range idx.docs {
		idx.byID[d.ID] = d
		for w, f := range d.tf {
			d.length += f
			idx.df[w]++
		}
		total += d.length
	}
	if len(idx.docs) > 0 {
		idx.avgLen = total / float64(len(idx.docs))
	}
}

// ── Searching ──────────────────────────────────────────────────────────────

type aiDocHit struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Path    string `json:"path"`
	Snippet string `json:"snippet"`
	Source  string `json:"source"`
	score   float64
}

func containsRun(hay, needle []string) bool {
	if len(needle) == 0 || len(needle) > len(hay) {
		return false
	}
	for i := 0; i+len(needle) <= len(hay); i++ {
		ok := true
		for j := range needle {
			if hay[i+j] != needle[j] {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

// Search ranks the sections for a query, best first.
func (idx *aiDocsIndex) Search(query string, limit int) []aiDocHit {
	if limit <= 0 {
		limit = aiDocsDefaultLimit
	}
	if limit > aiDocsMaxLimit {
		limit = aiDocsMaxLimit
	}
	toks := aiTokenize([]rune(query))
	var q []string
	for _, t := range toks {
		if !t.stop {
			q = append(q, t.stem)
		}
	}
	if len(q) == 0 {
		for _, t := range toks {
			q = append(q, t.stem)
		}
	}
	// "back up" is the word "backup": a joined pair counts as a word of its own
	// when the docs have it.
	terms := map[string]float64{}
	for _, w := range q {
		terms[w] = 1
	}
	for i := 0; i+1 < len(q); i++ {
		if j := aiStem(q[i] + q[i+1]); idx.df[j] > 0 {
			terms[j] = 0.8
		}
	}
	if len(terms) == 0 || len(idx.docs) == 0 {
		return nil
	}
	n := float64(len(idx.docs))
	const k1, b = 1.2, 0.75
	var hits []aiDocHit
	var docs []*aiDoc
	for _, d := range idx.docs {
		var score float64
		for w, weight := range terms {
			f := d.tf[w]
			if f == 0 {
				continue
			}
			df := float64(idx.df[w])
			idf := math.Log(1 + (n-df+0.5)/(df+0.5))
			score += weight * idf * f * (k1 + 1) / (f + k1*(1-b+b*d.length/idx.avgLen))
		}
		if score == 0 {
			continue
		}
		switch {
		case len(q) >= 1 && len(d.title) == len(q) && containsRun(d.title, q):
			score *= 4 // the title is the question
		case len(q) >= 2 && containsRun(d.title, q):
			score *= 2
		case len(q) >= 2 && containsRun(d.content, q):
			score *= 1.6
		}
		hits = append(hits, aiDocHit{ID: d.ID, Title: d.Title, Path: d.Path, Source: d.Source, score: score})
		docs = append(docs, d)
	}
	order := make([]int, len(hits))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, c int) bool {
		x, y := order[a], order[c]
		if hits[x].score != hits[y].score {
			return hits[x].score > hits[y].score
		}
		if len(docs[x].Text) != len(docs[y].Text) {
			return len(docs[x].Text) < len(docs[y].Text)
		}
		return hits[x].ID < hits[y].ID
	})
	var out []aiDocHit
	for _, i := range order {
		if len(out) == limit {
			break
		}
		h := hits[i]
		h.Snippet = aiDocsSnippet(docs[i].Text, terms)
		out = append(out, h)
	}
	return out
}

// aiDocsSnippet is up to aiDocsSnippetRunes characters around the densest
// cluster of the query's words, on word boundaries.
func aiDocsSnippet(text string, terms map[string]float64) string {
	plain := []rune(strings.TrimSpace(aiDocsSpaceRe.ReplaceAllString(text, " ")))
	if len(plain) <= aiDocsSnippetRunes {
		return string(plain)
	}
	toks := aiTokenize(plain)
	bestStart, bestCount := 0, 0
	for i, t := range toks {
		if _, ok := terms[t.stem]; !ok {
			continue
		}
		seen := map[string]bool{}
		for _, u := range toks[i:] {
			if u.end-t.start > aiDocsSnippetRunes-40 {
				break
			}
			if _, ok := terms[u.stem]; ok {
				seen[u.stem] = true
			}
		}
		if len(seen) > bestCount {
			bestCount, bestStart = len(seen), t.start
		}
	}
	start := bestStart - 40
	if start < 0 {
		start = 0
	}
	end := start + aiDocsSnippetRunes
	if end > len(plain) {
		end = len(plain)
	}
	if start > 0 {
		for start < end && plain[start] != ' ' {
			start++
		}
	}
	if end < len(plain) {
		for end > start && plain[end] != ' ' {
			end--
		}
	}
	s := strings.TrimSpace(string(plain[start:end]))
	if start > 0 {
		s = "…" + s
	}
	if end < len(plain) {
		s += "…"
	}
	return s
}

// Read gives one section by id. The id may come with or without its source prefix.
func (idx *aiDocsIndex) Read(id string) (*aiDoc, bool) {
	id = strings.TrimSpace(id)
	if d, ok := idx.byID[id]; ok {
		return d, true
	}
	lower := strings.ToLower(id)
	for _, prefix := range []string{"", "manual:", "readme:"} {
		if d, ok := idx.byID[prefix+lower]; ok {
			return d, true
		}
	}
	return nil, false
}

// ── The two tools ──────────────────────────────────────────────────────────

func aiDocsToolSpecs() []aiToolSpec {
	return []aiToolSpec{
		{
			Name: aiDocsSearchTool,
			Description: "Search the nextDash manual and README that ship with this install. Returns up to 8 results, each with an id, the section title, its path, a short snippet and the source (MANUAL or README). " +
				"Use it for any how-to question or \"can nextDash do X\" question, and for where a setting lives, before you answer; then call read_doc on the best hit. It holds nothing of the person's data.",
			Schema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string", "description": "A few plain keywords or a short question, in English."},
					"limit": map[string]any{"type": "integer", "description": "How many results, 1 to 8. Default 5."},
				},
				"required": []string{"query"},
			},
		},
		{
			Name: aiDocsReadTool,
			Description: "Read one section of the nextDash manual or README by the id search_docs gave. Returns its text (at most 6 KB), and for a long section the part number and the ids of the next and previous part or section. " +
				"Answer from it and name the section title. Do not guess ids.",
			Schema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"id": map[string]any{"type": "string", "description": "A section id from search_docs, such as manual:2311-the-assistant."},
				},
				"required": []string{"id"},
			},
		},
	}
}

func aiIsDocsTool(name string) bool { return name == aiDocsSearchTool || name == aiDocsReadTool }

// aiRunDocsTool runs search_docs or read_doc in-process and returns the JSON
// text sent on to the model.
func aiRunDocsTool(call aiToolCall) string {
	idx := aiDocsGet()
	if len(idx.docs) == 0 {
		return aiJSONText(map[string]any{"error": "The manual is not available in this build."})
	}
	var args struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
		ID    string `json:"id"`
	}
	if len(call.Arguments) > 0 {
		if err := json.Unmarshal(call.Arguments, &args); err != nil {
			return aiJSONText(map[string]any{"error": "The arguments must be an object."})
		}
	}
	switch call.Name {
	case aiDocsSearchTool:
		if strings.TrimSpace(args.Query) == "" {
			return aiJSONText(map[string]any{"error": "query is required."})
		}
		hits := idx.Search(args.Query, args.Limit)
		if hits == nil {
			hits = []aiDocHit{}
		}
		out := map[string]any{"results": hits}
		if len(hits) == 0 {
			out["note"] = "Nothing in the manual or README matched. If the manual does not cover it, say so."
		}
		return aiJSONText(out)
	default:
		d, ok := idx.Read(args.ID)
		if !ok {
			return aiJSONText(map[string]any{"error": "No section has that id. Use search_docs to find the id of a section."})
		}
		return aiJSONText(map[string]any{
			"id": d.ID, "title": d.Title, "path": d.Path, "text": aiCutText(d.Text, aiDocsPartMax),
			"part": d.Part, "parts": d.Parts, "next": d.Next, "previous": d.Prev,
		})
	}
}
