/**
 * Config → Bookmarks, the helpers the list still shares, loaded when that
 * section is opened: the usage tooltip, the count label and the empty-list
 * reason. The list itself — rail, rows and panel — is drawn by
 * dashboard-config-bookmarks-workbench.js.
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
    });

    global.DashboardConfigBookmarksReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
