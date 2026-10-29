package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

/*
The bookmark edit and delete tools.

Each one drives the handler the browser uses, through mcpInner, for the same
reason add_bookmark does: the validation, the activity log and the webhook live
there. They sit behind the bookmarksWrite switch and refuse without the write
token before they read a single argument, so a call that is not allowed never
gets as far as finding out whether the bookmark exists.
*/

func mcpBookmarksWriteDefinitions() []map[string]any {
	urlProp := map[string]any{"type": "string", "description": "The bookmark's URL."}
	pageProp := map[string]any{
		"type":        "integer",
		"description": "Page id. Only needed when the same URL is filed on several pages; the error then lists them.",
	}
	return []map[string]any{
		{
			"name":        "update_bookmark",
			"annotations": mcpAnnotations(false, false),
			"description": "Change a bookmark's name or note, or add and remove tags. " +
				"The URL itself cannot be changed here; to relocate a bookmark use move_bookmark. " +
				"Fields left out stay as they are. Returns the page it was on.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url":         urlProp,
					"page":        pageProp,
					"name":        map[string]any{"type": "string", "description": "A new name."},
					"note":        map[string]any{"type": "string", "description": "A new note. An empty string clears it."},
					"tags_add":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"tags_remove": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				},
				"required": []string{"url"},
			},
		},
		{
			"name":        "move_bookmark",
			"annotations": mcpAnnotations(false, false),
			"description": "Move a bookmark to another page, or to another category on its own page. " +
				"Call list_pages first for the page and category ids. " +
				"Refused, with the reason, when the target page already holds that URL.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url":     urlProp,
					"page":    pageProp,
					"to_page": map[string]any{"type": "integer", "description": "The page to move it to."},
					"to_category": map[string]any{
						"type":        "string",
						"description": "Category id or name on the target page. Leave out to file it without a category.",
					},
				},
				"required": []string{"url", "to_page"},
			},
		},
		{
			"name":        "delete_bookmark",
			"annotations": mcpAnnotations(false, true),
			"description": "Delete a bookmark. The deletion is written to the activity log, " +
				"which is where it can be found again. Ask the person before calling this unless they asked for the deletion.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url":  urlProp,
					"page": pageProp,
				},
				"required": []string{"url"},
			},
		},
		{
			"name":        "create_category",
			"annotations": mcpAnnotations(false, false),
			"description": "Add a category to a page. Returns its id, which add_bookmark and move_bookmark take. " +
				"Refused when the page already has a category of that name.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"page": map[string]any{"type": "integer", "description": "The page to add it to."},
					"name": map[string]any{"type": "string", "description": "The category's name."},
				},
				"required": []string{"page", "name"},
			},
		},
		{
			"name":        "rename_category",
			"annotations": mcpAnnotations(false, false),
			"description": "Rename a category. Its id stays, so the bookmarks in it stay in it. " +
				"Refused when another category on that page already has the name.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"page":     map[string]any{"type": "integer", "description": "The page the category is on."},
					"category": map[string]any{"type": "string", "description": "The category's id or current name."},
					"name":     map[string]any{"type": "string", "description": "The new name."},
				},
				"required": []string{"page", "category", "name"},
			},
		},
	}
}

// mcpResolveBookmark finds the bookmark a tool means. With no page, a URL filed
// on several pages is ambiguous and the answer lists them rather than picking
// one: deleting the wrong copy is not something to guess at.
func (h *Handlers) mcpResolveBookmark(rawURL string, page int) (Bookmark, int, map[string]any) {
	key := canonicalBookmarkURLKey(rawURL)
	if key == "" {
		return Bookmark{}, 0, map[string]any{"error": "A URL is required."}
	}
	var found []Bookmark
	seen := map[int]bool{}
	for _, bm := range h.store.GetAllBookmarks() {
		if canonicalBookmarkURLKey(bm.URL) != key {
			continue
		}
		if page != 0 && bm.PageID != page {
			continue
		}
		if seen[bm.PageID] {
			continue
		}
		seen[bm.PageID] = true
		found = append(found, bm)
	}
	switch len(found) {
	case 0:
		return Bookmark{}, 0, map[string]any{"error": "No bookmark with that URL."}
	case 1:
		return found[0], found[0].PageID, nil
	}
	pages := make([]map[string]any, 0, len(found))
	for _, bm := range found {
		pages = append(pages, map[string]any{"id": bm.PageID, "name": pageNameForID(h.store, bm.PageID)})
	}
	return Bookmark{}, 0, map[string]any{
		"error": "That URL is filed on more than one page. Say which with the page argument.",
		"pages": pages,
	}
}

func (h *Handlers) mcpUpdateBookmark(r *http.Request, args json.RawMessage) map[string]any {
	if e := mcpNeedsToken(r); e != nil {
		return e
	}
	var body struct {
		URL        string   `json:"url"`
		Page       int      `json:"page"`
		Name       *string  `json:"name"`
		Note       *string  `json:"note"`
		TagsAdd    []string `json:"tags_add"`
		TagsRemove []string `json:"tags_remove"`
	}
	if err := json.Unmarshal(args, &body); err != nil {
		return map[string]any{"error": "Could not read the arguments."}
	}
	if body.Name != nil && strings.TrimSpace(*body.Name) == "" {
		return map[string]any{"error": "A bookmark needs a name."}
	}
	if body.Name == nil && body.Note == nil && len(body.TagsAdd) == 0 && len(body.TagsRemove) == 0 {
		return map[string]any{"error": "Nothing to change: give a name, a note, tags_add or tags_remove."}
	}
	bm, page, refused := h.mcpResolveBookmark(body.URL, body.Page)
	if refused != nil {
		return refused
	}
	patch := map[string]any{"url": bm.URL}
	if body.Name != nil {
		patch["name"] = *body.Name
	}
	if body.Note != nil {
		patch["note"] = *body.Note
	}
	if len(body.TagsAdd) > 0 {
		patch["addTags"] = body.TagsAdd
	}
	if len(body.TagsRemove) > 0 {
		patch["removeTags"] = body.TagsRemove
	}
	rec, err := h.mcpInner(r, http.MethodPatch, "/api/bookmarks", map[string]any{
		"page": page, "updates": []map[string]any{patch},
	}, nil, h.PatchBookmarks)
	if err != nil {
		return map[string]any{"error": "Could not build the request."}
	}
	if rec.status >= 400 {
		return mcpErrorFrom(rec)
	}
	var answer struct {
		Updated int `json:"updated"`
	}
	_ = json.Unmarshal(rec.body.Bytes(), &answer)
	if answer.Updated == 0 {
		return map[string]any{"error": "No bookmark with that URL."}
	}
	return map[string]any{"updated": true, "url": bm.URL, "page": pageNameForID(h.store, page)}
}

// mcpResolveCategory takes an id or a name and answers the id on that page.
func (h *Handlers) mcpResolveCategory(page int, wanted string) (string, bool) {
	wanted = strings.TrimSpace(wanted)
	categories := h.store.GetCategoriesByPage(page)
	for _, c := range categories {
		if c.ID == wanted {
			return c.ID, true
		}
	}
	for _, c := range categories {
		if strings.EqualFold(strings.TrimSpace(c.Name), wanted) {
			return c.ID, true
		}
	}
	return "", false
}

func (h *Handlers) mcpMoveBookmark(r *http.Request, args json.RawMessage) map[string]any {
	if e := mcpNeedsToken(r); e != nil {
		return e
	}
	var body struct {
		URL        string `json:"url"`
		Page       int    `json:"page"`
		ToPage     int    `json:"to_page"`
		ToCategory string `json:"to_category"`
	}
	if err := json.Unmarshal(args, &body); err != nil {
		return map[string]any{"error": "Could not read the arguments."}
	}
	if body.ToPage == 0 {
		return map[string]any{"error": "to_page is required."}
	}
	bm, page, refused := h.mcpResolveBookmark(body.URL, body.Page)
	if refused != nil {
		return refused
	}
	category := ""
	if strings.TrimSpace(body.ToCategory) != "" {
		id, ok := h.mcpResolveCategory(body.ToPage, body.ToCategory)
		if !ok {
			return map[string]any{"error": "That page has no category " + strconv.Quote(strings.TrimSpace(body.ToCategory)) + ". Call list_pages for the ones it has."}
		}
		category = id
	} else if page == body.ToPage {
		return map[string]any{"error": "That bookmark is already on that page. Give to_category to move it within the page."}
	}
	rec, err := h.mcpInner(r, http.MethodPost, "/api/bookmarks/move", map[string]any{
		"toPage": body.ToPage, "category": category,
		"items": []map[string]any{{"pageId": page, "url": bm.URL}},
	}, nil, h.MoveBookmarks)
	if err != nil {
		return map[string]any{"error": "Could not build the request."}
	}
	if rec.status >= 400 {
		return mcpErrorFrom(rec)
	}
	var answer struct {
		Moved   []map[string]any `json:"moved"`
		Skipped []bookmarkMoveSkip
	}
	_ = json.Unmarshal(rec.body.Bytes(), &answer)
	if len(answer.Moved) == 0 {
		out := map[string]any{"moved": false, "error": "The bookmark was not moved."}
		if len(answer.Skipped) > 0 {
			skip := answer.Skipped[0]
			out["reason"] = skip.Reason
			if skip.Reason == "duplicate_url" {
				out["error"] = "The target page already has a bookmark with that URL."
				out["conflict"] = skip.Conflict
			} else if skip.Reason == "gone" {
				out["error"] = "No bookmark with that URL."
			}
		}
		return out
	}
	out := map[string]any{
		"moved": true, "url": bm.URL,
		"page": pageNameForID(h.store, body.ToPage), "pageId": body.ToPage,
	}
	if name := categoryNameForID(h.store, body.ToPage, category); name != "" {
		out["category"] = name
	}
	return out
}

func (h *Handlers) mcpDeleteBookmark(r *http.Request, args json.RawMessage) map[string]any {
	if e := mcpNeedsToken(r); e != nil {
		return e
	}
	var body struct {
		URL  string `json:"url"`
		Page int    `json:"page"`
	}
	if err := json.Unmarshal(args, &body); err != nil {
		return map[string]any{"error": "Could not read the arguments."}
	}
	bm, page, refused := h.mcpResolveBookmark(body.URL, body.Page)
	if refused != nil {
		return refused
	}
	rec, err := h.mcpInner(r, http.MethodDelete, "/api/bookmarks", map[string]any{
		"page": page, "bookmark": bm,
	}, nil, h.DeleteBookmark)
	if err != nil {
		return map[string]any{"error": "Could not build the request."}
	}
	if rec.status >= 400 {
		return mcpErrorFrom(rec)
	}
	return map[string]any{"deleted": true, "name": bm.Name, "url": bm.URL, "page": pageNameForID(h.store, page)}
}

// mcpSaveCategories writes the whole list for a page through the browser's own
// save, which is the only way categories are written.
func (h *Handlers) mcpSaveCategories(r *http.Request, page int, categories []Category) map[string]any {
	rec, err := h.mcpInner(r, http.MethodPost, "/api/categories?page="+url.QueryEscape(strconv.Itoa(page)), categories, nil, h.SaveCategories)
	if err != nil {
		return map[string]any{"error": "Could not build the request."}
	}
	if rec.status >= 400 {
		return mcpErrorFrom(rec)
	}
	return nil
}

func mcpCategoryNameTaken(categories []Category, name, exceptID string) bool {
	for _, c := range categories {
		if c.ID != exceptID && strings.EqualFold(strings.TrimSpace(c.Name), name) {
			return true
		}
	}
	return false
}

func (h *Handlers) mcpCreateCategory(r *http.Request, args json.RawMessage) map[string]any {
	if e := mcpNeedsToken(r); e != nil {
		return e
	}
	var body struct {
		Page int    `json:"page"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(args, &body); err != nil {
		return map[string]any{"error": "Could not read the arguments."}
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		return map[string]any{"error": "A category needs a name."}
	}
	if body.Page == 0 || !h.pageExists(body.Page) {
		return map[string]any{"error": "No page with that id. Call list_pages for the ids."}
	}
	categories := h.store.GetCategoriesByPage(body.Page)
	if mcpCategoryNameTaken(categories, name, "") {
		return map[string]any{"error": "That page already has a category named " + strconv.Quote(name) + "."}
	}
	base := slugify(name)
	if base == "" {
		return map[string]any{"error": "A category name needs at least one letter or digit."}
	}
	id := base
	for n := 2; ; n++ {
		taken := false
		for _, c := range categories {
			if c.ID == id {
				taken = true
			}
		}
		if !taken {
			break
		}
		id = fmt.Sprintf("%s-%d", base, n)
	}
	if refused := h.mcpSaveCategories(r, body.Page, append(categories, Category{ID: id, Name: name})); refused != nil {
		return refused
	}
	return map[string]any{"created": true, "category": id, "name": name, "page": pageNameForID(h.store, body.Page)}
}

func (h *Handlers) mcpRenameCategory(r *http.Request, args json.RawMessage) map[string]any {
	if e := mcpNeedsToken(r); e != nil {
		return e
	}
	var body struct {
		Page     int    `json:"page"`
		Category string `json:"category"`
		Name     string `json:"name"`
	}
	if err := json.Unmarshal(args, &body); err != nil {
		return map[string]any{"error": "Could not read the arguments."}
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		return map[string]any{"error": "A category needs a name."}
	}
	if body.Page == 0 || !h.pageExists(body.Page) {
		return map[string]any{"error": "No page with that id. Call list_pages for the ids."}
	}
	id, ok := h.mcpResolveCategory(body.Page, body.Category)
	if !ok {
		return map[string]any{"error": "That page has no such category. Call list_pages for the ones it has."}
	}
	categories := h.store.GetCategoriesByPage(body.Page)
	if mcpCategoryNameTaken(categories, name, id) {
		return map[string]any{"error": "That page already has a category named " + strconv.Quote(name) + "."}
	}
	for i := range categories {
		if categories[i].ID == id {
			categories[i].Name = name
		}
	}
	if refused := h.mcpSaveCategories(r, body.Page, categories); refused != nil {
		return refused
	}
	return map[string]any{"renamed": true, "category": id, "name": name, "page": pageNameForID(h.store, body.Page)}
}
