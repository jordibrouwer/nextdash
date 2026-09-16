/**
 * Config → Bookmarks, the list itself, loaded when that section is opened.
 *
 * Twelve methods and some four hundred lines of the config module drew one
 * list — the rows, the bulk bar, the tag cloud, the chips, the crumbs — and
 * every visit to any other section carried them. They are the same methods on
 * the same prototype, moved verbatim; only the moment they arrive has changed.
 *
 * What the rest of the module calls stays behind: renderBookmarksListTab,
 * repaintBookmarksList and the handlers. What they call *into* is guarded in
 * one place — renderBookmarksListSafe — so nothing else has to know whether
 * this file is here yet.
 *
 * Split one section at a time, deliberately: an earlier attempt to lift the
 * whole of config out at once failed on forty-one tests, and the failures did
 * not name the method that had moved.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {

    bookmarkUsageTooltip(b) {
        const translate = this.lastOpenedTranslator();
        const fmt = (ts) => window.formatLastOpened?.(ts, { t: translate })
            || { label: '—', never: true };
        const opens = Number(b.openCount || 0);
        const openLabel = this.t('config.bookmarkStatOpenCount', '{count}×').replace('{count}', String(opens));
        const last = fmt(b.lastOpened);
        const added = fmt(b.createdAt);
        const parts = [openLabel];
        if (!last.never) parts.push(`${this.t('config.bookmarkStatLastOpened', 'Last opened')}: ${last.label}`);
        if (!added.never) parts.push(`${this.t('config.bookmarkStatAdded', 'Added')}: ${added.label}`);
        return parts.join(' · ');
    },

    renderBookmarkCountLabel(shown, total) {
        if (this.bookmarksFiltersActive() && shown !== total) {
            return this.t('config.bookmarksCountFiltered', '{shown} of {total}')
                .replace('{shown}', String(shown))
                .replace('{total}', String(total));
        }
        return this.t('config.bookmarksCountAll', '{n} bookmarks').replace('{n}', String(total));
    },

    /**
     * The list tab: the tiles, the filter row and the rows themselves.
     *
     * The tiles come with the list rather than staying above the strip: they
     * count what the filters below them produce, and each one is a filter of its
     * own — they belong to the thing they act on.
     */
    /**
     * Why this list is empty, in the reader's own terms.
     *
     * It said "no bookmarks match your search" whatever was narrowing the list
     * — a cleanup filter with nothing in it, a page with no rows, a tag nobody
     * has used since — so the sentence named the one thing that was often not
     * happening, and the reader went looking in the search box for a query that
     * was not there. Each filter that can empty a list now says so itself, and
     * the most specific one wins: a cleanup filter is the loudest thing on
     * screen, a free-text query the most likely to be a typo.
     */
    bookmarksEmptyReason() {
        const query = String(this.bmQuery || '').trim();
        if (this.bmCleanupFilter) {
            const label = this.cleanupFilterLabel?.(this.bmCleanupFilter) || this.bmCleanupFilter;
            return this.t('config.bookmarksEmptyCleanup', 'Nothing here is {filter} — which is the good outcome.')
                .replace('{filter}', String(label).toLowerCase());
        }
        if (this.bmHealthFilter) {
            return this.t('config.bmEmptyHealth', 'No bookmark is in that state right now.');
        }
        const tags = this.bookmarkTagFilters();
        if (tags.length) {
            return this.t('config.bookmarksEmptyTag', 'No bookmarks carry {tags}.')
                .replace('{tags}', tags.join(', '));
        }
        if (this.bmCategoryFilter) {
            return this.t('config.bookmarksEmptyCategory', 'This category has no bookmarks in it.');
        }
        if (this.bmPageFilter) {
            return this.t('config.bookmarksEmptyPage', 'This page has no bookmarks on it.');
        }
        if (query) {
            return this.t('config.bookmarksEmptyQuery', 'Nothing matches “{query}”.').replace('{query}', query);
        }
        return this.t('config.noBookmarksMatch', 'No bookmarks match your search.');
    },

    /**
     * Where a bookmark lives: page › category, as one pill in two halves.
     *
     * It used to be a single underlined button reading "main · Development".
     * The dot was the only thing separating two different facts, nothing said
     * which was which, and the underline promised navigation while the click
     * filters the list. A reader who did not already know their page was called
     * "main" saw two words and no hierarchy.
     *
     * Two halves, each filtering its own thing, split by an arrow that reads as
     * hierarchy — and bordered rather than underlined, so it is visibly a
     * different kind of thing from the tag chips above it.
     *
     * A bookmark with no category gets the page half alone rather than the
     * separate footer badge it used to get, so the page sits in the same place
     * on every row.
     */
    renderBookmarkPlaceCrumb(b, key, ctx = {}) {
        const esc = (v) => this.dash.escapeHtml(v);
        const pageName = typeof ctx.pageName === 'function'
            ? ctx.pageName(b.pageId)
            : this.pageLabel(b.pageId);
        // With a page filter on, every row is on that page: repeating it in
        // every crumb would be a column of the same word.
        const showPage = !this.bmPageFilter && !!pageName;
        const categoryName = b.category ? this.categoryOwnLabel(b) : '';
        if (!showPage && !categoryName) return '';

        const pageHalf = showPage
            ? `<button type="button" class="config-bm-crumb-part config-bm-crumb-page"
                    data-bm-filter-page="${esc(String(b.pageId))}"
                    title="${esc(this.t('config.filterByPageTitle', 'Filter by page {name}').replace('{name}', pageName))}">${esc(pageName)}</button>`
            : '';
        const categoryHalf = categoryName
            ? `<button type="button" class="config-bm-crumb-part config-bm-crumb-category"
                    data-bm-row-key="${esc(key)}"
                    title="${esc(this.t('config.filterByCategoryTitle', 'Filter by category {name}').replace('{name}', categoryName))}">${esc(categoryName)}</button>`
            : '';
        const arrow = pageHalf && categoryHalf
            ? '<span class="config-bm-crumb-sep" aria-hidden="true">›</span>'
            : '';
        return `<p class="config-bm-meta-category"><span class="config-bm-crumb">${pageHalf}${arrow}${categoryHalf}</span></p>`;
    },

    renderBookmarkRowActions(b, key, open) {
        const esc = (v) => this.dash.escapeHtml(v);
        const editLabel = open
            ? this.t('config.close', 'Close')
            : this.t('config.edit', 'Edit');
        const editKbd = open ? '' : '<kbd>e</kbd>';
        return `
            <div class="config-bm-actions">
                <div class="config-bm-actions-inner">
                    <button type="button" class="config-bm-action-btn" data-bm-open="${esc(key)}">${esc(this.t('config.openBookmark', 'Open'))}<kbd>Enter</kbd></button>
                    <button type="button" class="config-bm-action-btn" data-bm-edit="${esc(key)}">${esc(editLabel)}${editKbd}</button>
                    <button type="button" class="config-bm-action-btn config-bm-action-btn--danger" data-bm-delete="${esc(key)}">${esc(this.t('config.delete', 'Delete'))}<kbd>d</kbd></button>
                </div>
            </div>`;
    },
    });

    global.DashboardConfigBookmarksReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
