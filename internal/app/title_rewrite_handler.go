package app

import (
	"encoding/json"
	"io"
	"net/http"
)

const (
	// titlePreviewMaxTitles and titlePreviewMaxTitleLen bound what one preview
	// reads: a panel shows a handful of a feed's titles, never a feed's worth.
	titlePreviewMaxTitles   = 30
	titlePreviewMaxTitleLen = 400
)

// TitleRewritePreview answers the title-cleanup fields of the settings panels:
// is this pattern valid, what would it do to these titles, and (on request)
// what would the app suggest for them.
//
// The pattern is run here rather than in the page for one reason: the server
// is what applies it, and its RE2 differs from the browser's regular
// expressions in the places that matter -- a lookahead the page accepts is a
// pattern the server would refuse on save. The preview must say what the save
// will do, so it asks the same compiler. It stores nothing.
func (h *Handlers) TitleRewritePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Find    string   `json:"find"`
		Replace string   `json:"replace"`
		Titles  []string `json:"titles"`
		Suggest bool     `json:"suggest"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	titles := make([]string, 0, titlePreviewMaxTitles)
	for _, title := range body.Titles {
		if len(titles) == titlePreviewMaxTitles {
			break
		}
		titles = append(titles, trimToLength(title, titlePreviewMaxTitleLen))
	}

	out := struct {
		// Error is a stable code: bad-pattern or too-long. Empty when fine.
		Error      string   `json:"error,omitempty"`
		Results    []string `json:"results"`
		Suggestion string   `json:"suggestion,omitempty"`
	}{Results: make([]string, 0, len(titles))}

	if body.Suggest {
		out.Suggestion = suggestTitleRewrite(titles)
	}
	rewrite, err := compileTitleRewrite(body.Find, body.Replace)
	switch {
	case err == errTitleRewriteTooLong:
		out.Error = "too-long"
	case err != nil:
		out.Error = "bad-pattern"
	}
	for _, title := range titles {
		out.Results = append(out.Results, rewrite.apply(title))
	}
	writeWatchJSON(w, http.StatusOK, out)
}
