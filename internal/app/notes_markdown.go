package app

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

/*
 * Markdown for the notes widget, small and safe.
 *
 * The output is data, not markup: blocks made of plain text spans, which the
 * browser turns into elements with textContent. Nothing here can produce
 * HTML, so a note can hold any text. static/js/dashboard/notes-markdown.js
 * does the same in the browser for the "In the browser" setting; the two are
 * held to the same fixture file (tests/fixtures/notes-markdown-cases.json).
 * Whitespace is ASCII in every pattern so the two agree.
 */

var (
	noteTaskRe     = regexp.MustCompile(`^[ \t]*(?:[-*][ \t]+)?\[( |x|X)\][ \t]?([^\n]*)$`)
	noteHeadingRe  = regexp.MustCompile(`^(#{1,3})[ \t]+([^\n]*)$`)
	noteBulletRe   = regexp.MustCompile(`^[ \t]*[-*][ \t]+([^\n]*)$`)
	noteOrderedRe  = regexp.MustCompile(`^[ \t]*\d+[.)][ \t]+([^\n]*)$`)
	noteQuoteRe    = regexp.MustCompile(`^>[ \t]?([^\n]*)$`)
	noteTableRowRe = regexp.MustCompile(`^[ \t]*\|[^\n]*\|[ \t]*$`)
	noteTableSepRe = regexp.MustCompile(`^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$`)
	noteInlineRe   = regexp.MustCompile("(`[^`]+`)|(\\*\\*[^*]+\\*\\*)|(\\*[^* \\t\\r\\n][^*]*\\*)|(\\[[^\\]]+\\]\\([^) \\t\\r\\n]+\\))")
	noteHTTPRe     = regexp.MustCompile(`(?i)^https?://[^ \t\r\n]+$`)
	noteRelativeRe = regexp.MustCompile(`^\.{1,2}/[^ \t\r\n]*$`)
)

type noteSpan = map[string]any

func noteSafeHref(url string) bool {
	if noteHTTPRe.MatchString(url) || noteRelativeRe.MatchString(url) {
		return true
	}
	return strings.HasPrefix(url, "/") && !strings.HasPrefix(url, "//") && !strings.ContainsAny(url, " \t\r\n")
}

func noteInline(text string) []noteSpan {
	out := []noteSpan{}
	last := 0
	for _, m := range noteInlineRe.FindAllStringSubmatchIndex(text, -1) {
		if m[0] > last {
			out = append(out, noteSpan{"t": "text", "v": text[last:m[0]]})
		}
		switch {
		case m[2] >= 0:
			out = append(out, noteSpan{"t": "code", "v": text[m[2]+1 : m[3]-1]})
		case m[4] >= 0:
			out = append(out, noteSpan{"t": "bold", "v": text[m[4]+2 : m[5]-2]})
		case m[6] >= 0:
			out = append(out, noteSpan{"t": "italic", "v": text[m[6]+1 : m[7]-1]})
		default:
			link := text[m[8]:m[9]]
			mid := strings.Index(link, "](")
			label, href := link[1:mid], link[mid+2:len(link)-1]
			if noteSafeHref(href) {
				out = append(out, noteSpan{"t": "link", "v": label, "href": href})
			} else {
				out = append(out, noteSpan{"t": "text", "v": link})
			}
		}
		last = m[1]
	}
	if last < len(text) {
		out = append(out, noteSpan{"t": "text", "v": text[last:]})
	}
	return out
}

func noteCells(row string) [][]noteSpan {
	row = strings.TrimSpace(row)
	row = strings.TrimPrefix(row, "|")
	row = strings.TrimSuffix(row, "|")
	parts := strings.Split(row, "|")
	out := make([][]noteSpan, 0, len(parts))
	for _, p := range parts {
		out = append(out, noteInline(strings.TrimSpace(p)))
	}
	return out
}

func parseNoteMarkdown(text string) []map[string]any {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	blocks := []map[string]any{}
	if text == "" {
		return blocks
	}
	lines := strings.Split(text, "\n")
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if strings.TrimSpace(line) == "" {
			blocks = append(blocks, map[string]any{"type": "gap"})
			continue
		}
		if m := noteTaskRe.FindStringSubmatch(line); m != nil {
			blocks = append(blocks, map[string]any{
				"type": "task", "checked": m[1] != " ", "spans": noteInline(m[2]), "index": i, "raw": line,
			})
			continue
		}
		if strings.HasPrefix(line, "```") {
			end := -1
			for j := i + 1; j < len(lines); j++ {
				if strings.HasPrefix(lines[j], "```") {
					end = j
					break
				}
			}
			if end > i {
				blocks = append(blocks, map[string]any{"type": "code", "text": strings.Join(lines[i+1:end], "\n")})
				i = end
				continue
			}
			blocks = append(blocks, map[string]any{"type": "para", "spans": noteInline(line)})
			continue
		}
		if m := noteHeadingRe.FindStringSubmatch(line); m != nil {
			blocks = append(blocks, map[string]any{"type": "heading", "level": len(m[1]), "spans": noteInline(m[2])})
			continue
		}
		if noteTableRowRe.MatchString(line) && i+1 < len(lines) && noteTableSepRe.MatchString(lines[i+1]) {
			rows := [][][]noteSpan{}
			j := i + 2
			for j < len(lines) && noteTableRowRe.MatchString(lines[j]) {
				rows = append(rows, noteCells(lines[j]))
				j++
			}
			blocks = append(blocks, map[string]any{"type": "table", "head": noteCells(line), "rows": rows})
			i = j - 1
			continue
		}
		if m := noteQuoteRe.FindStringSubmatch(line); m != nil {
			if n := len(blocks); n > 0 && blocks[n-1]["type"] == "quote" {
				blocks[n-1]["lines"] = append(blocks[n-1]["lines"].([][]noteSpan), noteInline(m[1]))
			} else {
				blocks = append(blocks, map[string]any{"type": "quote", "lines": [][]noteSpan{noteInline(m[1])}})
			}
			continue
		}
		bullet := noteBulletRe.FindStringSubmatch(line)
		ordered := []string(nil)
		if bullet == nil {
			ordered = noteOrderedRe.FindStringSubmatch(line)
		}
		if bullet != nil || ordered != nil {
			isOrdered := bullet == nil
			item := ordered
			if bullet != nil {
				item = bullet
			}
			if n := len(blocks); n > 0 && blocks[n-1]["type"] == "list" && blocks[n-1]["ordered"] == isOrdered {
				blocks[n-1]["items"] = append(blocks[n-1]["items"].([][]noteSpan), noteInline(item[1]))
			} else {
				blocks = append(blocks, map[string]any{"type": "list", "ordered": isOrdered, "items": [][]noteSpan{noteInline(item[1])}})
			}
			continue
		}
		blocks = append(blocks, map[string]any{"type": "para", "spans": noteInline(line)})
	}
	return blocks
}

func noteStats(text string) map[string]any {
	done, total := 0, 0
	for _, b := range parseNoteMarkdown(text) {
		if b["type"] == "task" {
			total++
			if b["checked"] == true {
				done++
			}
		}
	}
	return map[string]any{"chars": utf8.RuneCountInString(text), "tasksDone": done, "tasksTotal": total}
}

// notesStarterText is what a new notes widget says before anyone writes in it:
// a short tour of what the note can do, in the note itself. Only a widget that
// is new gets it (see normalizeWidget); one that was emptied stays empty.
const notesStarterText = "# Notes\n" +
	"Write in **Markdown**: *italic*, `code`, lists and tables.\n" +
	"\n" +
	"## Checklist\n" +
	"[x] Add the notes widget\n" +
	"[ ] Tick a box to mark it done\n" +
	"[ ] Type / in the editor for commands\n" +
	"[ ] Open large for a toolbar and a preview\n" +
	"\n" +
	"nextDash on [GitHub](https://github.com/jordibrouwer/nextdash)"

func notesStarterConfig() map[string]any {
	return map[string]any{"text": notesStarterText}
}
