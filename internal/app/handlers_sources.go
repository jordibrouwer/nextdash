package app

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

// ForgetSourceTokenHandler drops a source's token and keeps the rest: its
// page, category and the list of what it already imported. Deleting the whole
// source (what "Forget token" did) let a new token bring back every item the
// reader had removed since.
func (h *Handlers) ForgetSourceTokenHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	if err := ClearSourceToken(mux.Vars(r)["id"]); err != nil {
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
var sourceImporters = map[string]sourceImporter{}

/*
registerHandlerSources adds the importers that need the Handlers receiver.

The table above holds plain functions; these three reach the network through
h.outboundHTTPClient, which is where the SSRF checks, the redirect validation
and the global rate limit live. A source that used http.Get would skip all
three, and the atlas is explicit that this is not negotiable.
*/
func (h *Handlers) registerHandlerSources() {
	// Moved here from the plain table above. They were reaching the network
	// through a bare http.Client, which skips the redirect validation and the
	// outbound limit -- and, since both API bases can be pointed elsewhere by
	// environment, they have to follow this install's own setting about local
	// addresses, which only a Handlers can answer for.
	sourceImporters["github-stars"] = func(ctx context.Context, source SourceState) ([]ImportedRow, string, bool, error) {
		result, err := FetchGitHubStars(ctx, h.outboundHTTPClient(githubStarsTimeout, 5),
			source.Token, source.Cursor, source.TargetCategory)
		if err != nil {
			return nil, "", false, err
		}
		return result.Bookmarks, result.NewestStarredAt, result.Truncated, nil
	}
	sourceImporters["raindrop"] = func(ctx context.Context, source SourceState) ([]ImportedRow, string, bool, error) {
		result, err := FetchRaindrops(ctx, h.outboundHTTPClient(raindropTimeout, 5),
			source.Token, source.Cursor, source.TargetCategory)
		if err != nil {
			return nil, "", false, err
		}
		return result.Bookmarks, result.NewestCreated, result.Truncated, nil
	}
	sourceImporters["hackernews"] = func(ctx context.Context, source SourceState) ([]ImportedRow, string, bool, error) {
		result, err := h.FetchHackerNewsFavorites(ctx, source)
		if err != nil {
			return nil, "", false, err
		}
		return result.Bookmarks, result.NewestAt, false, nil
	}
	sourceImporters["youtube"] = func(ctx context.Context, source SourceState) ([]ImportedRow, string, bool, error) {
		result, err := h.FetchYouTubeChannel(ctx, source)
		if err != nil {
			return nil, "", false, err
		}
		return result.Bookmarks, result.NewestAt, false, nil
	}
	sourceImporters["mastodon"] = func(ctx context.Context, source SourceState) ([]ImportedRow, string, bool, error) {
		result, err := h.FetchMastodonBookmarks(ctx, source)
		if err != nil {
			return nil, "", false, err
		}
		return result.Bookmarks, result.NewestID, result.Truncated, nil
	}
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
	// A page deleted since the source was set up: its rows went into a file
	// nothing draws, and the cursor moved past them.
	if !h.pageExists(pageID) {
		http.Error(w, "The page this source imports into no longer exists", http.StatusNotFound)
		return
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
		// Every source reports a rejected credential the same way, because it is
		// the one failure the reader can actually act on.
		if errors.Is(err, errGitHubUnauthorized) || errors.Is(err, errRaindropUnauthorized) ||
			errors.Is(err, errMastodonUnauthorized) {
			message = "That token was rejected"
			status = http.StatusUnauthorized
		}
		http.Error(w, message, status)
		return
	}

	// What this source brought in before and the reader then deleted or moved
	// is not new again.
	rows = withoutSeenRows(rows, source.Seen)
	preview := h.previewImport(pageID, rows)

	if r.Method == http.MethodGet || r.URL.Query().Get("dryRun") == "1" {
		// A preview is not a round: it moves no cursor and claims no result,
		// or a reader who previewed and thought better of it would never see
		// those stars again.
		// The page is part of the answer, not just the counts: a source keeps
		// the page it was configured with, so an import can land somewhere the
		// reader is not looking. The caller needs it to refresh the right page,
		// and the confirm can say where the bookmarks are going.
		writeJSON(w, struct {
			ImportPreview
			Truncated bool `json:"truncated"`
			Page      int  `json:"page"`
		}{ImportPreview: preview, Truncated: truncated, Page: pageID})
		return
	}

	if truncated {
		// The walk hit its page bound with stars unread. Importing what was read
		// is right; advancing the cursor past it is not, so the next round picks
		// up the remainder rather than skipping it forever.
		cursor = ""
	}
	// One row that fails validation (a dead domain, with local bookmarks off)
	// refused the whole batch; it is left out instead, as a file import does.
	valid := rows[:0:0]
	for _, row := range rows {
		if h.validateBookmarkURL(row.URL) == nil {
			valid = append(valid, row)
		}
	}
	// The cursor moves only once the rows are written. Recorded first, a
	// refused or failed import skipped that round's rows for good.
	rec := &bufferedResponse{header: http.Header{}}
	h.importRows(rec, r, pageID, valid)
	if rec.status == 0 || rec.status == http.StatusOK {
		RecordSourceRun(id, cursor, sourceRunSummary(preview), nil)
		keys := make([]string, 0, len(valid))
		for _, row := range valid {
			keys = append(keys, canonicalBookmarkURLKey(row.URL))
		}
		RecordSourceSeen(id, keys)
	} else {
		RecordSourceRun(id, "", "", errors.New("the import failed: "+strings.TrimSpace(rec.body.String())))
	}
	for key, values := range rec.header {
		w.Header()[key] = values
	}
	if rec.status != 0 {
		w.WriteHeader(rec.status)
	}
	_, _ = w.Write(rec.body.Bytes())
}

// sourceRunSummary is the one line the config panel shows per source.
func sourceRunSummary(preview ImportPreview) string {
	return strconv.Itoa(preview.New) + " new, " + strconv.Itoa(preview.Duplicates) + " already here"
}
