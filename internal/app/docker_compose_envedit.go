package app

import (
	"net/http"
	"strconv"
	"strings"
)

/*
Editing a .env in place, with its secrets masked.

The files view shows every value of an env file as the mask. An editor that
works on that view hands the text back with the mask still where nobody typed a
new value. That mask is a placeholder for "keep what is there": the server puts
the original value back (the original bytes of the line, comment and quoting
included) and writes the result.

The mask text itself is never a value. After any merge, and on every save of any
file, a text that holds more mask than the file on disk did is refused, so a
client that saves the masked view by mistake can not replace a password with six
bullets.
*/

const (
	composeMaskLiteral   = "compose-mask-literal"
	composeMaskUnmatched = "compose-mask-unmatched"
)

type composeMergeError struct {
	Reason string
	Line   int
	Name   string
}

func (e *composeMergeError) message() string {
	if e.Reason == composeMaskUnmatched {
		return "Line " + strconv.Itoa(e.Line) + ": " + e.Name + " is the mask, but the saved file has no value to keep for it. Type a new value, or reveal the old one and copy it."
	}
	return "A value is the mask text. Type the real value, or leave the masked value as it was."
}

// composeEnvSplitLine splits one env line the way the redactor did: the part
// before the value, the value text, and the name.
func composeEnvSplitLine(body string, line int) (prefix, rest, name string) {
	if m := composeEnvLine.FindStringSubmatch(body); m != nil {
		prefix = m[1] + m[2] + m[3]
		return prefix, body[len(prefix):], m[2]
	}
	e := composeEnvOddLine(body, line)
	return e.prefix, body[len(e.prefix):], e.name
}

// composeMergeMaskedEnv puts the original value back for every value of posted
// that is still the mask. A value is matched by its name, in the order the
// names occur in the original; the continuation lines of a quoted multi-line
// value (each shown as the mask) are taken with it.
func composeMergeMaskedEnv(original, posted []byte) ([]byte, *composeMergeError) {
	origLines := strings.Split(string(original), "\n")
	byName := map[string][]composeEnvEntry{}
	for _, e := range parseComposeEnv(original) {
		// An empty value is never masked (redactEnvFile), so it is never what
		// a mask in the view stands for: counted here, DB= before DB=secret
		// would hand the secret's mask the empty line.
		if e.value == "" && e.extraLines == 0 {
			continue
		}
		byName[e.name] = append(byName[e.name], e)
	}
	used := map[string]int{}
	postLines := strings.Split(string(posted), "\n")
	out := make([]string, 0, len(postLines))
	for i := 0; i < len(postLines); i++ {
		line := postLines[i]
		body, eol := line, ""
		if strings.HasSuffix(body, "\r") {
			body, eol = strings.TrimSuffix(body, "\r"), "\r"
		}
		if t := strings.TrimSpace(body); t == "" || strings.HasPrefix(t, "#") {
			out = append(out, line)
			continue
		}
		prefix, rest, name := composeEnvSplitLine(body, i+1)
		if strings.TrimSpace(rest) != composeMask {
			out = append(out, line)
			continue
		}
		list := byName[name]
		n := used[name]
		if n >= len(list) {
			return nil, &composeMergeError{Reason: composeMaskUnmatched, Line: i + 1, Name: name}
		}
		used[name]++
		e := list[n]
		raw := append([]string(nil), origLines[e.line-1:e.line+e.extraLines]...)
		raw[len(raw)-1] = strings.TrimSuffix(raw[len(raw)-1], "\r")
		raw[0] = raw[0][len(e.prefix):]
		out = append(out, prefix+strings.Join(raw, "\n")+eol)
		for k := 0; k < e.extraLines && i+1 < len(postLines); k++ {
			if strings.TrimSpace(strings.TrimSuffix(postLines[i+1], "\r")) != composeMask {
				break
			}
			i++
		}
	}
	merged := []byte(strings.Join(out, "\n"))
	if composeMaskAdded(original, merged) {
		return nil, &composeMergeError{Reason: composeMaskLiteral}
	}
	return merged, nil
}

// composeMaskAdded is whether next holds the mask text more often than the file
// on disk does: a placeholder that survived into what would be written.
func composeMaskAdded(old, next []byte) bool {
	return strings.Count(string(next), composeMask) > strings.Count(string(old), composeMask)
}

// composeRefuseMerge answers a merge or mask refusal: 422 with the reason.
func composeRefuseMerge(w http.ResponseWriter, e *composeMergeError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnprocessableEntity)
	body := map[string]any{"reason": e.Reason, "message": e.message()}
	if e.Reason == composeMaskUnmatched {
		body["line"], body["name"] = e.Line, e.Name
	}
	writeJSON(w, body)
}
