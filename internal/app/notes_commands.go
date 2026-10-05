package app

import (
	"crypto/rand"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	// Embedded so a zone name from the browser resolves on any image, with or
	// without a system zoneinfo.
	_ "time/tzdata"
)

/*
 * The slash commands and toolbar edits of the notes widget.
 *
 * Every edit takes {value, start, end} and gives the next one. Offsets are
 * UTF-16 code units, because that is what a textarea's selectionStart counts;
 * the text is converted once and sliced in those units. An edit that would take
 * the note past its limit is refused rather than cut. static/js/dashboard/
 * notes-slash.js holds the same edits for the "In the browser" setting, and
 * tests/fixtures/notes-command-cases.json holds both to the same answers.
 */

type noteEdit struct {
	Value string `json:"value"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

func noteUnits(s string) []uint16 { return utf16.Encode([]rune(s)) }

func noteString(u []uint16) string { return string(utf16.Decode(u)) }

func (e noteEdit) bounds() ([]uint16, int, int) {
	u := noteUnits(e.Value)
	start, end := e.Start, e.End
	if start < 0 {
		start = 0
	}
	if start > len(u) {
		start = len(u)
	}
	if end < start {
		end = start
	}
	if end > len(u) {
		end = len(u)
	}
	return u, start, end
}

func noteSplice(u []uint16, from, to int, with []uint16) []uint16 {
	out := make([]uint16, 0, len(u)-(to-from)+len(with))
	out = append(out, u[:from]...)
	out = append(out, with...)
	return append(out, u[to:]...)
}

func noteFit(u []uint16, caret, max int) (noteEdit, bool) {
	value := noteString(u)
	if utf8.RuneCountInString(value) > max {
		return noteEdit{}, false
	}
	return noteEdit{Value: value, Start: caret, End: caret}, true
}

func noteLineRange(u []uint16, start, end int) (int, int) {
	from := 0
	for i := start - 1; i >= 0; i-- {
		if u[i] == '\n' {
			from = i + 1
			break
		}
	}
	to := len(u)
	for i := end; i < len(u); i++ {
		if u[i] == '\n' {
			to = i
			break
		}
	}
	return from, to
}

func noteInsert(e noteEdit, text string, max int) (noteEdit, bool) {
	u, s, en := e.bounds()
	ins := noteUnits(text)
	return noteFit(noteSplice(u, s, en, ins), s+len(ins), max)
}

func noteMapSelection(e noteEdit, fn func(string) string, max int) (noteEdit, bool) {
	u, s, en := e.bounds()
	from, to := s, en
	selected := s != en
	if !selected {
		from, to = noteLineRange(u, s, en)
	}
	next := noteUnits(fn(noteString(u[from:to])))
	r, ok := noteFit(noteSplice(u, from, to, next), from+len(next), max)
	if ok && selected {
		r.Start = from
	}
	return r, ok
}

func noteWrap(e noteEdit, before, after string, max int) (noteEdit, bool) {
	u, s, en := e.bounds()
	b, a := noteUnits(before), noteUnits(after)
	chosen := u[s:en]
	repl := append(append(append([]uint16{}, b...), chosen...), a...)
	return noteFit(noteSplice(u, s, en, repl), s+len(b)+len(chosen), max)
}

func notePrefixLines(e noteEdit, prefix string, max int) (noteEdit, bool) {
	u, s, en := e.bounds()
	from, to := noteLineRange(u, s, en)
	lines := strings.Split(noteString(u[from:to]), "\n")
	for i := range lines {
		lines[i] = prefix + lines[i]
	}
	next := noteUnits(strings.Join(lines, "\n"))
	return noteFit(noteSplice(u, from, to, next), from+len(next), max)
}

func noteTitleCase(s string) string {
	rs := []rune(strings.ToLower(s))
	prevSpace := true
	for i, r := range rs {
		if prevSpace && !unicode.IsSpace(r) {
			rs[i] = unicode.ToUpper(r)
		}
		prevSpace = unicode.IsSpace(r)
	}
	return string(rs)
}

func noteUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// noteLocation is the browser's time zone: its IANA name when this server
// knows it, otherwise the fixed offset the browser also sent. offsetMinutes is
// JavaScript's getTimezoneOffset, minutes *behind* UTC, so UTC+2 is -120.
func noteLocation(name string, offsetMinutes int) *time.Location {
	if name != "" && len(name) <= 64 {
		if loc, err := time.LoadLocation(name); err == nil {
			return loc
		}
	}
	if offsetMinutes < -14*60 || offsetMinutes > 14*60 {
		offsetMinutes = 0
	}
	return time.FixedZone("browser", -offsetMinutes*60)
}

// runNoteCommand returns the edited state, whether it fitted the limit, and
// whether the command exists.
func runNoteCommand(name string, e noteEdit, max int, now time.Time) (noteEdit, bool, bool) {
	var (
		r  noteEdit
		ok bool
	)
	switch name {
	case "date":
		r, ok = noteInsert(e, now.Format("2006-01-02"), max)
	case "time":
		r, ok = noteInsert(e, now.Format("15:04"), max)
	case "uuid":
		r, ok = noteInsert(e, noteUUID(), max)
	case "upper":
		r, ok = noteMapSelection(e, strings.ToUpper, max)
	case "lower":
		r, ok = noteMapSelection(e, strings.ToLower, max)
	case "title":
		r, ok = noteMapSelection(e, noteTitleCase, max)
	case "todo":
		r, ok = notePrefixLines(e, "[ ] ", max)
	case "h1":
		r, ok = notePrefixLines(e, "# ", max)
	case "bullet":
		r, ok = notePrefixLines(e, "- ", max)
	case "quote":
		r, ok = notePrefixLines(e, "> ", max)
	case "bold":
		r, ok = noteWrap(e, "**", "**", max)
	case "italic":
		r, ok = noteWrap(e, "*", "*", max)
	case "inlinecode":
		r, ok = noteWrap(e, "`", "`", max)
	case "link":
		r, ok = noteWrap(e, "[", "](https://)", max)
	case "code":
		r, ok = noteInsert(e, "```\n\n```", max)
		if ok {
			_, s, _ := e.bounds()
			r.Start, r.End = s+4, s+4
		}
	case "table":
		r, ok = noteInsert(e, "| Column | Column |\n| --- | --- |\n|  |  |\n", max)
	default:
		return noteEdit{}, false, false
	}
	return r, ok, true
}
