package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

/*
The API in front of the source register.

Four routes, one rule: a token goes in and never comes back out. Every response
here is built from SourceStatus, which has no token field at all -- so this
cannot leak one by forgetting to strip it, only by someone adding a field that
was deliberately left out.

Running a source is deliberately two calls. GET the preview, then POST the run.
A source that imports on the first click is a source nobody clicks twice, which
is the whole argument for the register: the second round has to be as safe as
the first, or the reader stops before they get there.
*/

// sourceRunTimeout bounds a whole round, however many pages it takes. Long
// because a first import of a large account is legitimately many requests, and
// bounded because a hung round holds nothing else but should still end.
const sourceRunTimeout = 3 * time.Minute

// ListSourcesHandler answers GET /api/sources.
func (h *Handlers) ListSourcesHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	writeJSON(w, ListSources())
}

// SaveSourceHandler answers PUT /api/sources/{id}.
func (h *Handlers) SaveSourceHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var body SourceState
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if _, ok := sourceImporters[strings.TrimSpace(body.Kind)]; !ok {
		http.Error(w, "Unknown source kind", http.StatusBadRequest)
		return
	}

	status, err := SaveSource(mux.Vars(r)["id"], body)
	if err != nil {
		if errors.Is(err, errInvalidSourceID) {
			http.Error(w, "Invalid source id", http.StatusBadRequest)
			return
		}
		http.Error(w, "Could not save the source", http.StatusInternalServerError)
		return
	}
	writeJSON(w, status)
}

// DeleteSourceHandler answers DELETE /api/sources/{id}.
func (h *Handlers) DeleteSourceHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	if err := DeleteSource(mux.Vars(r)["id"]); err != nil {
		http.Error(w, "Invalid source id", http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// sourceImporter fetches rows for one kind of source.
//
// Everything a source needs is in this signature: the round is pure until the
// caller writes, which is what lets the same call serve the preview and the
// import without a flag threaded through it.
type sourceImporter func(ctx context.Context, source SourceState) (rows []ImportedRow, cursor string, truncated bool, err error)

// sourceImporters is the register's dispatch table. A new source in cluster A is
// an entry here plus its fetch function.
var sourceImporters = map[string]sourceImporter{
	"github-stars": func(ctx context.Context, source SourceState) ([]ImportedRow, string, bool, error) {
		result, err := FetchGitHubStars(ctx, source.Token, source.Cursor, source.TargetCategory)
		if err != nil {
			return nil, "", false, err
		}
		return result.Bookmarks, result.NewestStarredAt, result.Truncated, nil
	},
}

/*
RunSourceHandler answers POST /api/sources/{id}/run, and GET .../run?dryRun=1.

The dry run and the real one take the identical path up to the point of writing,
so the number in the confirm comes from the same fetch that will do the work --
the mistake the browser-side import made for years was counting in one place and
writing in another.
*/
func (h *Handlers) RunSourceHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	id := mux.Vars(r)["id"]
	source, ok := GetSource(id)
	if !ok {
		http.Error(w, "No such source", http.StatusNotFound)
		return
	}
	importer, ok := sourceImporters[strings.TrimSpace(source.Kind)]
	if !ok {
		http.Error(w, "Unknown source kind", http.StatusBadRequest)
		return
	}

	pageID := source.TargetPage
	if pageID <= 0 {
		// A source configured before pages existed, or saved without one: the
		// first page is where a bookmark with no home goes everywhere else.
		pageID = 1
	}

	ctx, cancel := context.WithTimeout(r.Context(), sourceRunTimeout)
	defer cancel()

	rows, cursor, truncated, err := importer(ctx, source)
	if err != nil {
		// Recorded even for a dry run: a token that stopped working is worth
		// showing in the panel whether or not the reader went on to import.
		RecordSourceRun(id, "", "", err)
		message := "Could not read from that source"
		status := http.StatusBadGateway
		if errors.Is(err, errGitHubUnauthorized) {
			message = "That token was rejected"
			status = http.StatusUnauthorized
		}
		http.Error(w, message, status)
		return
	}

	preview := h.previewImport(pageID, rows)

	if r.Method == http.MethodGet || r.URL.Query().Get("dryRun") == "1" {
		// A preview is not a round: it moves no cursor and claims no result,
		// or a reader who previewed and thought better of it would never see
		// those stars again.
		writeJSON(w, struct {
			ImportPreview
			Truncated bool `json:"truncated"`
		}{ImportPreview: preview, Truncated: truncated})
		return
	}

	if truncated {
		// The walk hit its page bound with stars unread. Importing what was read
		// is right; advancing the cursor past it is not, so the next round picks
		// up the remainder rather than skipping it forever.
		cursor = ""
	}
	RecordSourceRun(id, cursor, sourceRunSummary(preview), nil)
	h.importRows(w, r, pageID, rows)
}

// sourceRunSummary is the one line the config panel shows per source.
func sourceRunSummary(preview ImportPreview) string {
	return strconv.Itoa(preview.New) + " new, " + strconv.Itoa(preview.Duplicates) + " already here"
}
