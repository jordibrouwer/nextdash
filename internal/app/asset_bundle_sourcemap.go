package app

import (
	"encoding/json"
	"strings"
)

// Giving the bundle back its file names.
//
// Concatenation costs attribution: every script in the bundle reports as
// dashboard.js in a stack trace, so an error or a key conflict names the bundle
// and a line number nobody can place. The workaround was NEXTDASH_BUNDLE=off,
// which means reproducing the problem in a different build from the one that
// had it.
//
// A `//# sourceURL` per file does not work. Checked in a browser: the last
// directive in a script wins for the whole script, so several of them make
// attribution worse — every function reports as the last file in the bundle.
//
// A source map is the mechanism that exists for this, and it is cheap here
// because the bundle is plain concatenation. Every line of a source file maps
// to exactly one line of the bundle at a fixed offset, so the mappings are
// "line N of the bundle is line N-offset of file F, column 0" and nothing more.
// No transformation means no per-token mappings and no name table.

const base64VLQChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

// encodeVLQ writes one signed value in the base64 VLQ form source maps use:
// the sign goes in the low bit, then 5 bits per digit, with bit 6 as
// "another digit follows".
func encodeVLQ(value int) string {
	v := value << 1
	if value < 0 {
		v = (-value << 1) | 1
	}
	var out strings.Builder
	for {
		digit := v & 31
		v >>= 5
		if v > 0 {
			digit |= 32
		}
		out.WriteByte(base64VLQChars[digit])
		if v == 0 {
			break
		}
	}
	return out.String()
}

// buildBundleSourceMap renders a v3 source map for a concatenated bundle.
// Returns "" when the bundle carries no line offsets, which is what an empty
// or unbundled build looks like.
func buildBundleSourceMap(b assetBundle, bundlePath string) string {
	if len(b.files) == 0 || len(b.lineStarts) != len(b.files) {
		return ""
	}

	sources := make([]string, len(b.files))
	for i, f := range b.files {
		sources[i] = "/static/" + f
	}

	totalLines := strings.Count(string(b.content), "\n")

	// Which source file owns each line of the bundle, and which line of it.
	owner := make([]int, totalLines+1)
	within := make([]int, totalLines+1)
	for i := range owner {
		owner[i] = -1
	}
	for fileIdx, start := range b.lineStarts {
		end := totalLines
		if fileIdx+1 < len(b.lineStarts) {
			// The next file's banner sits between the two, and belongs to
			// neither; leaving it unmapped is correct.
			end = b.lineStarts[fileIdx+1] - 2
		}
		for line := start; line < end && line <= totalLines; line++ {
			owner[line] = fileIdx
			within[line] = line - start
		}
	}

	// Mappings are ";"-separated lines. Each mapped line gets one segment,
	// and every field except the generated column is relative to the previous
	// segment — hence the running previous* values.
	var mappings strings.Builder
	prevSource, prevSourceLine := 0, 0
	for line := 0; line <= totalLines; line++ {
		if line > 0 {
			mappings.WriteByte(';')
		}
		fileIdx := owner[line]
		if fileIdx < 0 {
			continue
		}
		mappings.WriteString(encodeVLQ(0)) // generated column 0
		mappings.WriteString(encodeVLQ(fileIdx - prevSource))
		mappings.WriteString(encodeVLQ(within[line] - prevSourceLine))
		mappings.WriteString(encodeVLQ(0)) // source column 0
		prevSource = fileIdx
		prevSourceLine = within[line]
	}

	// No sourcesContent: the originals are served from disk under their own
	// URLs, so the browser fetches them rather than reading them from here.
	// The key is left out rather than set to null -- the spec makes it an
	// optional array, and Safari rejects the whole map over a null.
	out := map[string]any{
		"version":  3,
		"file":     bundlePath,
		"sources":  sources,
		"mappings": mappings.String(),
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return ""
	}
	return string(raw)
}
