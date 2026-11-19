package app

import (
	"regexp"
	"strings"
	"unicode"
)

/*
Title rewriting: cut the noise out of an article title.

Some feeds put the same bookkeeping in front of every title -- an advisory
number, a severity in brackets -- and the part worth reading starts after it.
A reader can give a pattern and what to put in its place (nothing, by default),
and this applies it. The RSS tile and a watched feed share it, so the two mean
the same thing by the same two fields.

Go's regexp is RE2: it runs in time linear in the text, so a pattern a reader
pastes cannot hang the server, and nothing here needs a timeout.
*/

const (
	// titleRewriteMaxLen bounds the pattern and the replacement alike. A title
	// is a line; a pattern longer than this is not cleaning one.
	titleRewriteMaxLen = 200
	// titleSuggestMin is how few titles are too few to see a pattern in.
	titleSuggestMin = 3
	// titleSuggestShare is the part of titles that must agree before a shared
	// beginning or end counts as bookkeeping rather than coincidence.
	titleSuggestShare = 0.8
)

// titleRewrite is a compiled pattern and what replaces a match.
type titleRewrite struct {
	re   *regexp.Regexp
	with string
}

/*
compileTitleRewrite turns the two settings into a rewrite. No pattern is no
rewrite (nil, nil): the setting is optional and an empty one is the default,
not an error.
*/
func compileTitleRewrite(find, with string) (*titleRewrite, error) {
	find = strings.TrimSpace(find)
	if find == "" {
		return nil, nil
	}
	if len(find) > titleRewriteMaxLen || len(with) > titleRewriteMaxLen {
		return nil, errTitleRewriteTooLong
	}
	re, err := regexp.Compile(find)
	if err != nil {
		return nil, err
	}
	return &titleRewrite{re: re, with: with}, nil
}

type titleRewriteError string

func (e titleRewriteError) Error() string { return string(e) }

const errTitleRewriteTooLong = titleRewriteError("title pattern too long")

/*
apply rewrites one title. A pattern that would leave nothing keeps the
original: an empty line in a list reads as a broken feed, and the reader who
wrote the pattern wanted a shorter title, not no title.
*/
func (t *titleRewrite) apply(title string) string {
	if t == nil {
		return title
	}
	out := strings.TrimSpace(t.re.ReplaceAllString(title, t.with))
	if out == "" {
		return title
	}
	return out
}

/*
suggestTitleRewrite looks for what most titles of a feed share at the start
or the end, and returns a pattern that removes it. Empty means nothing was
sure enough: it is a suggestion for the reader to read, and a wrong one is
worse than none.

At the start the shape is matched rather than the text: digits stand for any
digits and a bracketed group for any bracketed group, so "NCSC-2026-0506
[1.00] [H/H]" and "NCSC-2026-0507 [2.10] [M/H]" are the same shape. Plain
words must be identical to count, and a shape needs at least one number or
bracket in it -- a word most titles start with is a style, not noise.
*/
func suggestTitleRewrite(titles []string) string {
	clean := make([]string, 0, len(titles))
	for _, t := range titles {
		if t = strings.TrimSpace(t); t != "" {
			clean = append(clean, t)
		}
	}
	if len(clean) < titleSuggestMin {
		return ""
	}
	if pattern := suggestTitlePrefix(clean); pattern != "" {
		return pattern
	}
	return suggestTitleSuffix(clean)
}

// titleSuggestAgrees reports whether n of total titles clear the share.
func titleSuggestAgrees(n, total int) bool {
	return float64(n) >= titleSuggestShare*float64(total)
}

var titleDigitRun = regexp.MustCompile(`\d+`)

// titleTokenShape is the pattern one leading word stands for, and whether it
// carries a number or a bracket (code-like) rather than being plain text.
func titleTokenShape(token string) (shape string, codeLike bool) {
	if strings.HasPrefix(token, "[") && strings.HasSuffix(token, "]") {
		return `\[[^\]]*\]`, true
	}
	if strings.HasPrefix(token, "(") && strings.HasSuffix(token, ")") {
		return `\([^)]*\)`, true
	}
	if !titleDigitRun.MatchString(token) {
		return regexp.QuoteMeta(token), false
	}
	var b strings.Builder
	last := 0
	for _, loc := range titleDigitRun.FindAllStringIndex(token, -1) {
		b.WriteString(regexp.QuoteMeta(token[last:loc[0]]))
		b.WriteString(`\d+`)
		last = loc[1]
	}
	b.WriteString(regexp.QuoteMeta(token[last:]))
	return b.String(), true
}

func suggestTitlePrefix(titles []string) string {
	fields := make([][]string, len(titles))
	for i, t := range titles {
		fields[i] = strings.Fields(t)
	}
	var shapes []string
	codeLike := false
	for pos := 0; ; pos++ {
		counts := map[string]int{}
		kinds := map[string]bool{}
		for _, f := range fields {
			// A title with nothing after this word cannot give it up.
			if pos+1 >= len(f) {
				continue
			}
			shape, code := titleTokenShape(f[pos])
			counts[shape]++
			kinds[shape] = code
		}
		best, bestN := "", 0
		for shape, n := range counts {
			if n > bestN || (n == bestN && shape < best) {
				best, bestN = shape, n
			}
		}
		if bestN == 0 || !titleSuggestAgrees(bestN, len(titles)) {
			break
		}
		shapes = append(shapes, best)
		codeLike = codeLike || kinds[best]
	}
	if !codeLike {
		return ""
	}
	// Trailing plain words are kept only if a code-like word came before them;
	// the loop above already guarantees at least one exists somewhere.
	pattern := "^" + strings.Join(shapes, " ") + " "
	return vetTitleSuggestion(pattern, titles)
}

// titleSuffixSeparators are what usually sits between a title and a site name.
var titleSuffixSeparators = []string{" | ", " – ", " — ", " - ", " :: "}

func suggestTitleSuffix(titles []string) string {
	for _, sep := range titleSuffixSeparators {
		counts := map[string]int{}
		for _, t := range titles {
			if i := strings.LastIndex(t, sep); i > 0 {
				if tail := strings.TrimSpace(t[i+len(sep):]); tail != "" {
					counts[tail]++
				}
			}
		}
		best, bestN := "", 0
		for tail, n := range counts {
			if n > bestN || (n == bestN && tail < best) {
				best, bestN = tail, n
			}
		}
		if bestN > 0 && titleSuggestAgrees(bestN, len(titles)) {
			pattern := regexp.QuoteMeta(sep+best) + "$"
			if vetTitleSuggestion(pattern, titles) != "" {
				return pattern
			}
		}
	}
	return ""
}

/*
vetTitleSuggestion checks a pattern against the titles it came from: it must
compile, match most of them, and leave something of each. A suggestion that
fails here would have shown the reader a worse list than the one they had.
*/
func vetTitleSuggestion(pattern string, titles []string) string {
	rewrite, err := compileTitleRewrite(pattern, "")
	if err != nil || rewrite == nil {
		return ""
	}
	matched := 0
	for _, t := range titles {
		if !rewrite.re.MatchString(t) {
			continue
		}
		if strings.TrimSpace(rewrite.re.ReplaceAllString(t, "")) == "" {
			return ""
		}
		matched++
	}
	if !titleSuggestAgrees(matched, len(titles)) {
		return ""
	}
	// A pattern of only separators and whitespace is not worth offering.
	if strings.IndexFunc(pattern, unicode.IsLetter) < 0 && !strings.Contains(pattern, `\d`) {
		return ""
	}
	return pattern
}
