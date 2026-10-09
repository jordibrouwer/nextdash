/**
 * Moving a block to another page: a category, a widget or a collection.
 *
 * One path for all three, reached from the header menu's "Move to page ▸" and
 * from Shift+Alt+←/→ on a block title. The block leaves this page, lands last
 * on the other one (where the reader goes to find it), keeps its width, and
 * the notice that says where it went carries one Undo that puts everything
 * back: the block, its place here, and for a collection its page list.
 *
 * What differs per kind is only what the server is asked:
 * - a category is made on the other page and its bookmarks follow it there,
 *   through the same calls the Structure modal's move uses;
 * - a widget is written there and removed here, id and all;
 * - a collection is not stored on a page at all: its page list becomes the
 *   other page, and its place goes into that page's order.
 */
(function (global) {
    'use strict';

    /** The page list setting of each built-in collection. */
    const BUILT_IN_PAGE_LISTS = {
        __smart_today__: 'smartTodayPageIds',
        __smart_recent__: 'smartRecentPageIds',
        __smart_added__: 'smartAddedPageIds',
        __smart_stale__: 'smartStalePageIds',
        __smart_most_used__: 'smartMostUsedPageIds',
        __smart_fresh__: 'smartFreshPageIds',
    };

    function api() {
        return typeof global.nextDashFetch === 'function' ? global.nextDashFetch : fetch;
    }

    function jsonHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (typeof global.nextDashWriteHeaders === 'function') Object.assign(headers, global.nextDashWriteHeaders());
        return headers;
    }

    async function send(url, method, body) {
        const res = await api()(url, { method, headers: jsonHeaders(), body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json().catch(() => ({}));
    }

    async function read(url) {
        const res = await api()(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    /** A page's widgets and resolved order, read with the token (see moveWidget). */
    const readBlocks = (pageId) => read(`/api/pages/${pageId}/blocks`);
    const writeOrder = (pageId, order) => send(`/api/pages/${pageId}/blocks`, 'PUT', { order });
    const readCategories = (pageId) => read(`/api/categories?page=${encodeURIComponent(pageId)}`);
    // originalId = id on every row, as saveCategoryOrder sends it: the server
    // remaps bookmarks by originalId, and a row carrying another id's would
    // move that category's bookmarks into it.
    const writeCategories = (pageId, list) => send(`/api/categories?page=${encodeURIComponent(pageId)}`, 'POST',
        list.map((c) => ({ ...c, originalId: c.id })));
    const nameKey = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

    function kindOf(rc, id) {
        if (rc.isCollectionId(id)) return 'collection';
        if (rc.isWidgetId(id)) return 'widget';
        return 'category';
    }

    /** Whether this block can go to another page at all. Tag collections follow their tag. */
    function canMoveToPage(dash, id) {
        return !dash?.settings?.lockLayout && !String(id ?? '').startsWith('tag:');
    }

    /** The page list a collection is filtered by, and how to set it. */
    function collectionPageList(dash, id) {
        const key = BUILT_IN_PAGE_LISTS[id];
        if (key) {
            return {
                get: () => (Array.isArray(dash.settings[key]) ? [...dash.settings[key]] : []),
                set: (ids) => { dash.settings[key] = ids; },
            };
        }
        const own = String(id).startsWith('custom:') ? String(id).slice('custom:'.length) : null;
        const col = own != null && Array.isArray(dash.settings.collections)
            ? dash.settings.collections.find((c) => String(c.id) === own) : null;
        if (!col) return null;
        return {
            get: () => (Array.isArray(col.pageIds) ? [...col.pageIds] : []),
            set: (ids) => { if (ids.length) col.pageIds = ids; else delete col.pageIds; },
        };
    }

    async function saveSettingsOrThrow(dash) {
        if (await dash.saveSettings?.() === false) throw new Error('settings not saved');
    }

    /*
     * Each mover does the kind's own part and answers what it needs to be
     * undone. Written to the destination first and removed here second: a
     * failure between the two leaves the block in both places, never in
     * neither.
     */
    const movers = {
        async collection(dash, { id, from, to }) {
            const list = collectionPageList(dash, id);
            if (!list) throw new Error('collection not found');
            const before = list.get();
            // From this page to that one; the collection's other pages keep
            // it. Only "every page" (no list) narrows to the one it went to.
            // Setting [to] took it off the other pages without a word.
            list.set(before.length
                ? [...new Set(before.map(Number).filter((p) => p !== Number(from)).concat(Number(to)))]
                : [Number(to)]);
            try {
                await saveSettingsOrThrow(dash);
            } catch (error) {
                list.set(before);
                throw error;
            }
            return {
                landedAs: id,
                async undo() {
                    list.set(before);
                    await saveSettingsOrThrow(dash);
                },
            };
        },

        async widget(dash, { id, from, to }) {
            // Both read with the token. The dashboard's own copy is read
            // without it, and the server leaves a custom widget's address and
            // credential and an RSS widget's feeds out of that; it puts them
            // back on a save only for a widget already stored on the same page.
            const src = await readBlocks(from);
            const full = (src.widgets || []).find((w) => String(w?.id) === id);
            if (!full) throw new Error('widget not found');
            const at = (src.widgets || []).indexOf(full);
            const moved = { id: full.id, type: full.type, title: full.title, config: full.config || {} };
            const dest = await readBlocks(to);
            await send(`/api/pages/${to}/blocks`, 'PUT', { widgets: (dest.widgets || []).concat(moved) });
            // From the stored list, not the dashboard's: the reader may have
            // gone to another page while this waited, and dash.widgets is then
            // that page's.
            const widgets = (src.widgets || []).filter((w) => String(w?.id) !== id);
            await send(`/api/pages/${from}/blocks`, 'PUT', { widgets });
            if (Number(dash.currentPageId) === Number(from)) {
                dash.widgets = (dash.widgets || []).filter((w) => String(w?.id) !== id);
            }
            return {
                landedAs: id,
                async undo() {
                    const there = await readBlocks(to);
                    const back = (there.widgets || []).find((w) => String(w?.id) === id) || moved;
                    const here = await readBlocks(from);
                    const list = (here.widgets || []).filter((w) => String(w?.id) !== id);
                    list.splice(Math.min(at, list.length), 0, back);
                    await send(`/api/pages/${from}/blocks`, 'PUT', { widgets: list });
                    await send(`/api/pages/${to}/blocks`, 'PUT', {
                        widgets: (there.widgets || []).filter((w) => String(w?.id) !== id),
                    });
                    if (Number(dash.currentPageId) === Number(from)) {
                        dash.widgets = (dash.widgets || []).filter((w) => String(w?.id) !== id);
                        dash.widgets.splice(Math.min(at, dash.widgets.length), 0, back);
                    }
                },
            };
        },

        /*
         * A category and its bookmarks: the category is made on the other page
         * under its own id, or a new one when that page already uses the id
         * for a category of another name; with the same id and name there it
         * is that category, and the bookmarks join it. They follow in one
         * server step that refuses a row the other page already holds, and the
         * category leaves its page only when every bookmark went with it.
         *
         * `source` is the page's categories and bookmarks in storage order --
         * the dashboard's own copy for the page on screen, the server's for
         * another (the Bookmarks view's Structure modal moves from any page).
         */
        async category(dash, { id, from, to, name, source }) {
            const t = (key, fallback) => dash.formatDashboardLabel?.(key, { name }, fallback)
                || fallback.replace(/\{name\}/g, name);
            const category = source.categories.find((c) => String(c.id) === id);
            if (!category) throw new Error('category not found');
            const before = source.categories.map((c) => ({ ...c }));
            const dest = await readCategories(to);
            let landedAs = id;
            const clash = dest.find((c) => String(c.id) === id);
            if (clash && nameKey(clash.name) !== nameKey(category.name)) landedAs = `${id}-${Date.now().toString(36)}`;
            const created = !dest.some((c) => String(c.id) === landedAs);
            if (created) {
                const { originalId: _drop, ...row } = category;
                await writeCategories(to, [...dest, { ...row, id: landedAs }]);
            }

            const rows = source.rows;
            const items = [];
            rows.forEach((b, i) => {
                if (String(b?.category || '') !== id) return;
                // Which copy of its URL on this page the row is, as the server counts them.
                const occurrence = rows.slice(0, i).filter((o) => o?.url === b.url).length;
                items.push({ pageId: Number(from), url: b.url, occurrence });
            });
            let moved = [];
            if (items.length) {
                const result = await send('/api/bookmarks/move', 'POST', { toPage: Number(to), category: landedAs, items });
                moved = Array.isArray(result.moved) ? result.moved : [];
                if (Array.isArray(result.skipped) && result.skipped.length) {
                    const err = new Error(t('blockMoveCategoryPartial',
                        'Some bookmarks of {name} are already on that page, so only the others moved: {name} is on both pages now.'));
                    err.partial = true;
                    throw err;
                }
            }
            await writeCategories(from, before.filter((c) => String(c.id) !== id));
            if (Number(dash.currentPageId) === Number(from)) {
                dash.categories = (dash.categories || []).filter((c) => String(c.id) !== id);
            }
            return {
                landedAs,
                async undo() {
                    await writeCategories(from, before);
                    let stayed = 0;
                    if (moved.length) {
                        const back = await send('/api/bookmarks/move', 'POST', {
                            toPage: Number(from),
                            category: id,
                            items: moved.map((m) => ({ pageId: Number(to), url: m.url })),
                        });
                        stayed = Array.isArray(back.skipped) ? back.skipped.length : 0;
                    }
                    // A row the way back refused is still in the category over
                    // there: deleting it would leave that row under "unknown".
                    if (stayed) {
                        return {
                            keptOnTarget: true,
                            message: t('blockMoveUndoPartial',
                                'Some bookmarks of {name} could not go back, so {name} is on both pages now.'),
                        };
                    }
                    if (created) {
                        const there = await readCategories(to);
                        await writeCategories(to, there.filter((c) => String(c.id) !== landedAs));
                    }
                    return {};
                },
            };
        },
    };

    /** Where focus goes once the block has left: the block that took its place. */
    function neighbourOf(rc, id) {
        const order = rc.blockOrderFromDom();
        const at = order.indexOf(id);
        return order[at + 1] || order[at - 1] || null;
    }

    function focusTitle(id) {
        if (!id) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(id)}"] .category-title`)
                ?.focus({ preventScroll: true });
        }));
    }

    /** Draw this page again from what is stored, once the server has changed it. */
    async function reload(dash, pageIds) {
        if (dash.data?.refreshAfterBookmarkMutation) {
            await dash.data.refreshAfterBookmarkMutation({ pageIds });
        } else {
            pageIds.forEach((pid) => dash.data?.invalidatePageDataCache?.(pid));
            await dash.loadPageBookmarks?.(Number(dash.currentPageId), { skipInlineEditConfirm: true });
        }
    }

    /** The categories and bookmarks of a page that is not on screen, from the server. */
    async function readPageSource(pageId) {
        const [categories, body] = await Promise.all([
            readCategories(pageId),
            read(`/api/bookmarks?page=${encodeURIComponent(pageId)}`),
        ]);
        return { categories, rows: Array.isArray(body) ? body : (body?.bookmarks || []) };
    }

    /*
     * `fromPageId` defaults to the page on screen. Given and different -- the
     * Bookmarks view's Structure modal moving a category of any page -- the
     * page is read from the server and nothing on screen is redrawn in place;
     * the views reload from what was stored instead.
     */
    async function move(rc, options) {
        // One move at a time: a second (a double press, a held key) would
        // read the pages while the first is half done and land the block twice.
        if (rc._pageMoveBusy) return false;
        rc._pageMoveBusy = true;
        try {
            return await moveOnce(rc, options);
        } finally {
            rc._pageMoveBusy = false;
        }
    }

    async function moveOnce(rc, { id, toPageId, fromPageId = null, kind: givenKind = null }) {
        const dash = rc.dash;
        const t = (key, vars, fallback) => dash.formatDashboardLabel?.(key, vars, fallback)
            || fallback.replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '');
        const bid = String(id ?? '');
        const here = Number(dash.currentPageId);
        const from = fromPageId == null ? here : Number(fromPageId);
        const onPage = from === here;
        const to = Number(toPageId);
        if (!bid || (onPage && rc.blocksBelongElsewhere())) return false;
        // Lock layout is the dashboard's: its menu and keys honour it, and say
        // so rather than doing nothing. A move from the Structure modal
        // (fromPageId given) is maintenance and never did.
        if (fromPageId == null && dash.settings?.lockLayout) {
            const text = t('blockMoveLocked', {}, 'Layout is locked — turn off Lock layout in Config → Behavior to move blocks.');
            dash.keyboardNavigation?.announce?.(text);
            dash.showNotification?.(text, 'info');
            return false;
        }
        if (bid.startsWith('tag:')) {
            const text = t('blockMoveTagCollection', {}, 'This collection follows its tag, so it shows wherever the tag is used.');
            dash.keyboardNavigation?.announce?.(text);
            // In place of the toast on screen: queued behind the 5-second
            // "Moved … Undo" of a move just before, it answered the key late.
            dash.showNotification?.(text, 'info', { replace: true });
            return false;
        }
        const page = (dash.pages || []).find((p) => Number(p.id) === to);
        if (!page || to === from) return false;

        const kind = givenKind || kindOf(rc, bid);
        // Only a category is moved from a page that is not on screen.
        if (!onPage && kind !== 'category') return false;
        let source = null;
        if (kind === 'category') {
            try {
                source = onPage
                    ? { categories: dash.categories || [], rows: dash.bookmarks || [] }
                    : await readPageSource(from);
            } catch {
                dash.showErrorNotification?.(t('blockMoveToPageFailed', { name: bid }, 'Could not move {name}.'));
                return false;
            }
            // Other and an unknown category are views over bookmarks, not
            // stored categories: there is nothing to make on the other page.
            if (!source.categories.some((c) => String(c.id) === bid)) return false;
        }
        const name = kind === 'category'
            ? String(source.categories.find((c) => String(c.id) === bid)?.name || bid)
            : rc.blockName(bid);
        const pageName = String(page.name || page.id);
        // A drag still waiting out its debounce would otherwise write the old
        // order over the one this writes -- and the old category list, still
        // holding this category, over the one this writes on its page.
        if (onPage) {
            await rc.flushPendingBlockOrderSave();
            await rc.flushPendingCategorySave();
        }
        let sourceOrder;
        try {
            sourceOrder = onPage
                ? [...(dash.blockOrder?.length ? dash.blockOrder : rc.blockOrderFromDom())]
                : [...((await readBlocks(from)).order || [])];
        } catch {
            dash.showErrorNotification?.(t('blockMoveToPageFailed', { name }, 'Could not move {name}.'));
            return false;
        }
        const first = onPage ? rc.captureBlockRects() : null;
        const next = onPage ? neighbourOf(rc, bid) : null;

        let done = null;
        let destOrder;
        try {
            destOrder = (await readBlocks(to)).order || [];
            done = await movers[kind](dash, { id: bid, from, to, name, source });
            await writeOrder(to, [...destOrder.filter((x) => x !== done.landedAs), done.landedAs]);
            const order = sourceOrder.filter((x) => x !== bid);
            if (order.length) await writeOrder(from, order);
            if (onPage && rc.onSamePage(from)) dash.blockOrder = order;
        } catch (error) {
            // Past the kind's own move, a failed order write would leave the
            // block half moved -- a collection listed for a page whose order
            // never heard of it. Put it back rather than leave that.
            if (done) {
                try { await done.undo(); } catch { /* reported below */ }
            }
            rc.forgetStructureCategoryLists?.();
            dash.showErrorNotification?.(error?.partial ? error.message
                : t('blockMoveToPageFailed', { name }, 'Could not move {name}.'));
            if (kind === 'category' || error?.partial || !rc.onSamePage(from)) await reload(dash, [from, to]);
            else if (done) rc.redrawKeepingPlace(bid);
            return false;
        }

        dash.data?.invalidatePageDataCache?.(to);
        rc.forgetStructureCategoryLists?.();
        // The reader may have gone to another page while the move waited on
        // the server: then the dashboard holds that page, and only what is
        // stored is drawn -- never this page's widgets or order over it.
        const stillHere = onPage && rc.onSamePage(from);
        if (kind === 'category' || !stillHere) {
            if (!stillHere) dash.data?.invalidatePageDataCache?.(from);
            await reload(dash, [from, to]);
        } else {
            dash.data?.updatePageDataCache?.(from, { blocks: { widgets: dash.widgets || [], order: dash.blockOrder } });
            rc.forgetWidgetConfigCache?.();
            rc.redrawKeepingPlace();
        }
        if (stillHere) {
            rc.animateBlocksFrom(first);
            focusTitle(next);
        }

        const message = t('blockMovedToPage', { name, page: pageName }, 'Moved {name} to {page}');
        const restore = async () => {
            if (rc._lastBlockMove === snapshot) rc._lastBlockMove = null;
            const back = rc.captureBlockRects();
            let result = {};
            try {
                result = (await done.undo()) || {};
                // A category that had to stay over there keeps its place there.
                if (!result.keptOnTarget) await writeOrder(to, destOrder);
                await writeOrder(from, sourceOrder);
            } catch {
                result = { message: t('blockMoveUndoFailed', { name }, 'Could not put {name} back.') };
            }
            if (result.message) dash.showErrorNotification?.(result.message);
            rc.forgetStructureCategoryLists?.();
            const current = Number(dash.currentPageId);
            if (kind === 'category' || current !== from) {
                // Whatever page is on screen now -- the one it came from, the
                // one it went to, or a third -- is drawn from what is stored.
                [from, to].forEach((pid) => dash.data?.invalidatePageDataCache?.(pid));
                if (kind === 'category' || current === to) await reload(dash, [from, to]);
                else {
                    rc.forgetWidgetConfigCache?.();
                    rc.redrawKeepingPlace();
                }
            } else {
                dash.data?.invalidatePageDataCache?.(to);
                dash.blockOrder = [...sourceOrder];
                dash.data?.updatePageDataCache?.(from, { blocks: { widgets: dash.widgets || [], order: dash.blockOrder } });
                rc.forgetWidgetConfigCache?.();
                rc.redrawKeepingPlace(bid);
            }
            if (Number(dash.currentPageId) === from) {
                rc.animateBlocksFrom(back);
                rc.flashBlock(bid);
            }
        };
        const snapshot = { id: bid, message, restore };
        rc._lastBlockMove = snapshot;
        dash.keyboardNavigation?.announce?.(message);
        dash.showNotification?.(message, 'success', {
            actionLabel: t('undo', {}, 'Undo'),
            onAction: () => void restore(),
            duration: 6000,
        });
        return true;
    }

    /** The page before or after this one, wrapping like Shift+←/→ does. */
    function adjacentPageId(dash, direction) {
        const pages = Array.isArray(dash.pages) ? dash.pages : [];
        if (pages.length < 2) return null;
        const at = pages.findIndex((p) => Number(p.id) === Number(dash.currentPageId));
        if (at < 0) return null;
        return pages[(at + (direction < 0 ? -1 : 1) + pages.length) % pages.length].id;
    }

    global.DashboardBlockPageMove = { move, canMoveToPage, adjacentPageId, collectionPageList };
})(window);
