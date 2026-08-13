/**
 * Creating and deleting pages and categories.
 *
 * The creators were born inside the bookmark form, which is why they still carry
 * "FromForm" names the rest of the code calls them by. The form is now one of
 * several callers — the pages overlay, the grid's category placeholder and its
 * right-click menu all reach this without a bookmark in sight — so the logic
 * sits here, in a module that loads with the dashboard rather than behind the
 * form's lazy bundle. Opening the pages overlay must not fetch the bookmark
 * editor.
 *
 * Every method resolves to a result object (`{ id }` / `{ ok }` / `{ error }`
 * with a ready-to-show message), never throws, and leaves the dashboard's own
 * `pages` / `categories` mirrors in step with the server so no caller needs a
 * full reload.
 */
class DashboardStructureCreate {
    constructor(dashboard) {
        this.dash = dashboard;
        // Every method here is read-the-list, change it, write-the-whole-list
        // back — there is no version check on the server. Several unrelated UI
        // entry points (the pages overlay, the grid's category placeholder, its
        // right-click menu, the command palette) can all reach the same pageId's
        // methods, so serializing per key here is the one place that covers all
        // of them at once instead of each caller having to remember to disable
        // its own button.
        this._pendingStructureWrites = new Map();
    }


    /**
     * Run `fn` after any write already in flight for `key` settles, so two
     * overlapping create/delete calls against the same page's category list
     * (or the page list itself) apply in order instead of one clobbering the
     * other's read-modify-write.
     */
    _serializeStructureWrite(key, fn) {
        const prior = this._pendingStructureWrites.get(key) || Promise.resolve();
        const run = prior.then(fn, fn);
        const settled = run.catch(() => {});
        this._pendingStructureWrites.set(key, settled);
        settled.finally(() => {
            if (this._pendingStructureWrites.get(key) === settled) {
                this._pendingStructureWrites.delete(key);
            }
        });
        return run;
    }


    /** Turn a name into a stable, unique category id (mirrors the config rules). */
    slugCategoryId(name, taken = []) {
        let base = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!base) {
            base = 'category';
        }
        const takenSet = new Set(taken.map((id) => String(id)));
        let id = base;
        let n = 2;
        while (takenSet.has(id)) {
            id = `${base}-${n++}`;
        }
        return id;
    }


    /**
     * Create a page.
     * Resolves to `{ id }` on success or `{ error }` with a message to show.
     */
    async createPageFromForm(name) {
        return this._serializeStructureWrite('pages', () => this._createPageFromForm(name));
    }

    async _createPageFromForm(name) {
        const d = this.dash;
        const cfg = (key, fb) => d.configLabel(key, fb);
        try {
            const res = await fetch('/api/pages');
            const existing = res.ok ? await res.json() : [];
            const list = Array.isArray(existing) ? existing : [];
            if (list.some((p) => String(p.name || '').trim().toLowerCase() === name.toLowerCase())) {
                return { error: cfg('pageExists', 'That page already exists.') };
            }
            const nextId = list.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1;
            const payload = [...list, { id: nextId, name }];
            const save = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!save.ok) {
                throw new Error(save.statusText);
            }
            // The dashboard keeps its own page list for the nav tabs and the page
            // select; update it here so both agree without a full reload.
            d.pages = payload;
            d.renderPageNavigation?.();
            d.notifyConfig('pageCreated', 'Page created.', 'success');
            return { id: nextId };
        } catch (e) {
            console.error('Inline create page failed:', e);
            return { error: cfg('pageCreateError', 'Could not create the page.') };
        }
    }


    /**
     * Create a category on `pageId`.
     * Resolves to `{ id }` on success or `{ error }` with a message to show.
     */
    async createCategoryFromForm(pageId, name) {
        return this._serializeStructureWrite(
            `categories:${pageId}`,
            () => this._createCategoryFromForm(pageId, name)
        );
    }

    async _createCategoryFromForm(pageId, name) {
        const d = this.dash;
        const cfg = (key, fb) => d.configLabel(key, fb);
        try {
            const res = await fetch(`/api/categories?page=${encodeURIComponent(pageId)}`);
            const existing = res.ok ? await res.json() : [];
            const list = Array.isArray(existing) ? existing : [];
            if (list.some((c) => String(c.name || '').trim().toLowerCase() === name.toLowerCase())) {
                return { error: cfg('categoryExists', 'That category already exists.') };
            }
            const id = this.slugCategoryId(name, list.map((c) => c.id));
            const payload = [...list, { id, name, icon: '' }];
            const save = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)(
                `/api/categories?page=${encodeURIComponent(pageId)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }
            );
            if (!save.ok) {
                throw new Error(save.statusText);
            }
            // Only the page on screen has its categories mirrored on the dashboard;
            // for any other page the form re-fetches the list it needs.
            if (Number(pageId) === Number(d.currentPageId)) {
                d.categories = payload;
            }
            d.data?.invalidatePageDataCache?.(Number(pageId));
            d.notifyConfig('categoryCreated', 'Category created.', 'success');
            return { id };
        } catch (e) {
            console.error('Inline create category failed:', e);
            return { error: cfg('categoryCreateError', 'Could not create the category.') };
        }
    }


    /**
     * Delete a category from `pageId`. Resolves to `{ ok, before }` or `{ error }`.
     *
     * The bookmarks in it are deliberately left alone — that matches config, and
     * it is the non-destructive half of the choice. They keep pointing at an id
     * nothing defines any more and surface under "unknown category", which is
     * why the caller must warn about the count before getting here.
     *
     * `before` is the category list as it was, which is all an undo needs: this
     * is a replace-the-list write. It comes from the fetch below rather than a
     * second one, so it cannot drift from what was actually deleted.
     */
    async deleteCategory(pageId, categoryId) {
        return this._serializeStructureWrite(
            `categories:${pageId}`,
            () => this._deleteCategory(pageId, categoryId)
        );
    }

    async _deleteCategory(pageId, categoryId) {
        const d = this.dash;
        const cfg = (key, fb) => d.configLabel(key, fb);
        try {
            const res = await fetch(`/api/categories?page=${encodeURIComponent(pageId)}`);
            const list = res.ok ? await res.json() : [];
            if (!Array.isArray(list)) {
                throw new Error('unexpected categories payload');
            }
            const payload = list.filter((c) => String(c.id) !== String(categoryId));
            if (payload.length === list.length) {
                return { error: cfg('categoriesSaveError', 'Could not save categories.') };
            }
            const save = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)(
                `/api/categories?page=${encodeURIComponent(pageId)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }
            );
            if (!save.ok) {
                throw new Error(save.statusText);
            }
            if (Number(pageId) === Number(d.currentPageId)) {
                d.categories = payload;
            }
            if (d.pinnedEmptyCategoryId != null
                && String(d.pinnedEmptyCategoryId) === String(categoryId)) {
                d.pinnedEmptyCategoryId = null;
            }
            // After the save, so a delete that did not persist cannot leave a
            // phantom entry. The 8s toast is the fast path; this is the 30-day one.
            const removedIndex = list.findIndex((c) => String(c.id) === String(categoryId));
            await window.DashboardTrash?.recordCategory?.(
                list[removedIndex],
                pageId,
                removedIndex,
                'category-delete'
            );
            // Here rather than in the menu, so every caller of this method keeps
            // an open trash tab in step. Guarded on `instance`: the config loader
            // proxy answers unknown properties by fetching the whole config
            // bundle, which a grid delete must not trigger.
            await d.config?.instance?.refreshTrashIfVisible?.();
            d.data?.invalidatePageDataCache?.(Number(pageId));
            return { ok: true, before: list };
        } catch (e) {
            console.error('Delete category failed:', e);
            return { error: cfg('categoriesSaveError', 'Could not save categories.') };
        }
    }


    /**
     * Put a category list back exactly as `deleteCategory` found it.
     * Resolves to `{ ok }` or `{ error }`.
     */
    async restoreCategories(pageId, rows) {
        return this._serializeStructureWrite(
            `categories:${pageId}`,
            () => this._restoreCategories(pageId, rows)
        );
    }

    async _restoreCategories(pageId, rows) {
        const d = this.dash;
        const cfg = (key, fb) => d.configLabel(key, fb);
        try {
            const save = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)(
                `/api/categories?page=${encodeURIComponent(pageId)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(rows),
                }
            );
            if (!save.ok) {
                throw new Error(save.statusText);
            }
            if (Number(pageId) === Number(d.currentPageId)) {
                d.categories = rows;
            }
            await d.config?.instance?.refreshTrashIfVisible?.();
            d.data?.invalidatePageDataCache?.(Number(pageId));
            return { ok: true };
        } catch (e) {
            console.error('Restore categories failed:', e);
            return { error: cfg('categoriesSaveError', 'Could not save categories.') };
        }
    }


    /** How many bookmarks on the current page sit in `categoryId`. */
    countBookmarksInCategory(categoryId) {
        const d = this.dash;
        const key = String(categoryId ?? '');
        return (d.bookmarks || []).filter((b) => String(b.category ?? '') === key).length;
    }
}

window.DashboardStructureCreate = DashboardStructureCreate;
