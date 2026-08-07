/**
 * Creating pages and categories.
 *
 * These were born inside the bookmark form, which is why they still carry
 * "FromForm" names the rest of the code calls them by. The form is now one of
 * several callers — the pages overlay and the grid's category placeholder create
 * the same things without a bookmark in sight — so the logic sits here, in a
 * module that loads with the dashboard rather than behind the form's lazy
 * bundle. Opening the pages overlay must not fetch the bookmark editor.
 *
 * Both creators resolve to `{ id }` or `{ error }` with a ready-to-show message,
 * never throw, and leave the dashboard's own `pages` / `categories` mirrors in
 * step with the server so no caller needs a full reload.
 */
class DashboardStructureCreate {
    constructor(dashboard) {
        this.dash = dashboard;
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
}

window.DashboardStructureCreate = DashboardStructureCreate;
