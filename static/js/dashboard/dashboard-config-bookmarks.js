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

    renderBookmarkFilterChips() {
        const esc = (v) => this.dash.escapeHtml(v);
        const chips = [];
        const add = (key, label) => {
            chips.push(`<button type="button" class="config-bm-filter-chip" data-bm-filter-clear="${esc(key)}">${esc(label)}<span aria-hidden="true">×</span></button>`);
        };
        if (this.bmPageFilter) {
            const pageName = this.pageLabel(this.bmPageFilter);
            add('page', this.t('config.bookmarksFilterPage', 'Page: {name}').replace('{name}', pageName));
        }
        if (this.bmCategoryFilter) {
            const parsed = DashboardConfig.parseCategoryFilter(this.bmCategoryFilter);
            const label = parsed.categoryId
                ? (this.knownCategories().find((c) => c.id === this.bmCategoryFilter)?.label || parsed.categoryId)
                : this.bmCategoryFilter;
            add('category', this.t('config.bookmarksFilterCategory', 'Category: {name}').replace('{name}', label));
        }
        // One chip per tag rather than one lumped "Tag: a, b, c": each stays
        // removable on its own, which is the point of picking several.
        for (const tag of this.bookmarkTagFilters()) {
            add(`tag:${tag}`, this.t('config.bookmarksFilterTag', 'Tag: {tag}').replace('{tag}', tag));
        }
        if (String(this.bmQuery || '').trim()) {
            const q = String(this.bmQuery).trim();
            add('search', this.t('config.bookmarksFilterSearch', 'Search: {q}').replace('{q}', q));
        }
        if (this.bmCleanupFilter) {
            add('cleanup', this.cleanupFilterLabel(this.bmCleanupFilter));
        }
        if (chips.length > 1) {
            chips.push(`<button type="button" class="config-bm-filter-chip config-bm-filter-chip--clear" data-bm-filter-clear="all">${esc(this.t('config.bookmarksClearAllFilters', 'Clear all'))}</button>`);
        }
        return chips.join('');
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
     * The three orders people actually use, and the one filter with no way in.
     *
     * Sorting lived in a dropdown of eight, which is where "most opened" went to
     * be never found: a select shows one option and hides the rest behind a
     * click, and none of the three that matter is the default. They are chips
     * now, with the other five still in the menu beside them.
     *
     * "Changed this week" sits with them because it answers the question that
     * follows an import or an afternoon of tidying — what did I touch — and
     * every bookmark has carried the timestamp for it all along with nothing
     * able to ask.
     */
    renderBookmarkQuickBar() {
        const esc = (v) => this.dash.escapeHtml(v);
        const sort = this.bmSort ?? this.defaultBookmarksSort();
        const chips = [
            ['page', this.t('config.sortByPage', 'Page order')],
            ['recent', this.t('config.sortByRecent', 'Recently added')],
            ['opens', this.t('config.sortByOpens', 'Most opened')],
        ].map(([value, label]) => {
            const on = String(sort) === value;
            return `<button type="button" class="config-choice config-choice--small${on ? ' is-active' : ''}"
                    data-bm-sort-chip="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
        }).join('');
        const changedOn = this.bmCleanupFilter === 'changed';
        return `
            <div class="config-bm-quickbar">
                <span class="config-bm-quickbar-label">${esc(this.t('config.sortLabel', 'Sort'))}</span>
                <div class="config-choices" role="group">${chips}</div>
                <button type="button" class="config-choice config-choice--small${changedOn ? ' is-active' : ''}"
                        data-bm-changed-toggle aria-pressed="${changedOn}"
                        title="${esc(this.t('config.cleanupFilterChangedHint', 'Bookmarks added or edited in the last seven days'))}">${
                    esc(this.t('config.cleanupFilterChanged', 'Changed in the last week'))}</button>
            </div>`;
    },

    /**
     * Tag cloud above the bookmark list.
     *
     * Collapsed by default: with a few dozen tags it would otherwise push the
     * list itself off the screen on every visit. Tags are ordered by how many
     * bookmarks carry them, so the ones worth filtering on come first, and each
     * is sized by that count the way the dashboard cloud is.
     */
    renderBookmarkTagCloud() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tags = this.bookmarkTagCounts();
        if (!tags.length) return '';

        const active = new Set(this.bookmarkTagFilters());
        const max = tags[0].count || 1;
        const chips = tags.map(({ tag, count }) => {
            const on = active.has(tag);
            // Four steps rather than a continuous scale: enough to show weight,
            // few enough that the rows still line up.
            const step = Math.min(3, Math.floor((count / max) * 4));
            return `<button type="button"
                    class="config-bm-cloud-tag config-bm-cloud-tag--s${step}${on ? ' is-active' : ''}"
                    role="option" aria-selected="${on}"
                    data-bm-cloud-tag="${esc(tag)}">${esc(tag)}<span class="config-bm-cloud-count">${count}</span></button>`;
        }).join('');

        const activeCount = active.size;
        const summary = activeCount
            ? this.t('config.bookmarksTagCloudActive', '{count} selected').replace('{count}', activeCount)
            : this.t('config.bookmarksTagCloudHint', 'Filter by one or more tags');
        return `
            <details class="config-bm-cloud" id="config-bm-cloud"${activeCount ? ' open' : ''}>
                <summary class="config-bm-cloud-summary">
                    <span>${esc(this.t('config.bookmarksTagCloudTitle', 'Tags'))}</span>
                    <span class="config-bm-cloud-summary-note">${esc(summary)}</span>
                </summary>
                <div class="config-bm-cloud-body">
                    <div class="config-bm-cloud-tags" role="listbox" aria-multiselectable="true"
                         aria-label="${esc(this.t('config.bookmarksTagCloudTitle', 'Tags'))}">${chips}</div>
                    <div class="config-bm-cloud-actions"${activeCount ? '' : ' hidden'}>
                        <button type="button" class="config-btn config-btn--small" data-bm-cloud-select>${esc(this.t('config.bookmarksTagCloudSelect', 'Select these bookmarks'))}</button>
                        <button type="button" class="config-btn config-btn--small" data-bm-cloud-clear>${esc(this.t('config.bookmarksTagCloudClear', 'Clear tags'))}</button>
                    </div>
                </div>
            </details>`;
    },

    /**
     * A banner naming the cleanup filter the list arrived with.
     *
     * Without it the user lands on a list that is silently hiding most of their
     * bookmarks, with nothing on screen to say why or how to get back — the
     * search box is empty and both dropdowns read "all".
     */
    renderCleanupFilterBanner() {
        const esc = (v) => this.dash.escapeHtml(v);
        const key = this.bmCleanupFilter;
        if (!key || !DashboardConfig.CLEANUP_FILTERS[key]) return '';
        const shown = this.visibleBookmarks().length;
        const label = this.cleanupFilterLabel(key);
        const count = this.t('config.cleanupFilterCount', '{n} shown').replace('{n}', String(shown));
        return `
            <div class="config-cleanup-banner" role="status">
                <span class="config-cleanup-banner-text">${esc(label)} · ${esc(count)}</span>
                <button type="button" class="config-btn config-btn--small" data-cleanup-clear="1">${esc(this.t('config.cleanupFilterClear', 'Show all bookmarks'))}</button>
            </div>`;
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

    renderBulkToolbar() {
        const esc = (v) => this.dash.escapeHtml(v);
        const n = this.bmSelected.size;
        if (n === 0) return '';
        const hidden = this.hiddenSelectionCount();
        const pages = this.dash.pages || [];
        const picked = this.bookmarksFromKeys([...this.bmSelected]);
        const pageOpts = [`<option value="">${esc(this.t('config.bulkMovePagePlaceholder', 'Move to page…'))}</option>`]
            .concat(pages.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`)).join('');
        const catOpts = [`<option value="">${esc(this.t('config.bulkMoveCategoryPlaceholder', 'Set category…'))}</option>`]
            .concat(this.bulkKnownCategories(picked).map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`)).join('');
        const modeOpts = [
            ['add', this.t('config.bulkTagsAdd', 'Add')],
            ['replace', this.t('config.bulkTagsReplace', 'Replace')],
            ['remove', this.t('config.bulkTagsRemove', 'Remove')],
        ].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
        const statusOpts = (window.CheckMode?.options?.() || []).map((o) =>
            `<option value="${esc(o.mode)}">${esc(o.label)}</option>`
        ).join('');

        return `
            <div class="config-bulk-bar" role="group" aria-label="${esc(this.t('config.bulkActions', 'Bulk actions'))}">
                <span class="config-bulk-count">${esc(this.t('config.bulkSelectedCount', '{n} selected').replace('{n}', String(n)))}${
                    hidden ? ` ${esc(this.t('config.bulkSelectedHidden', '({n} not shown by this filter)').replace('{n}', String(hidden)))}` : ''}</span>
                ${this.renderBulkOffscreenNotice(picked)}
                <div class="config-bulk-group">
                    <select class="config-select" id="config-bulk-page">${pageOpts}</select>
                    <select class="config-select" id="config-bulk-category">${catOpts}</select>
                    <button type="button" class="config-btn config-btn--small" data-bulk="move">${esc(this.t('config.bulkMoveApply', 'Apply'))}</button>
                </div>
                <div class="config-bulk-group">
                    <input type="text" class="config-text" id="config-bulk-tags" placeholder="${esc(this.t('config.detailTagsPlaceholder', 'work, dev, personal…'))}">
                    <select class="config-select" id="config-bulk-tags-mode">${modeOpts}</select>
                    <button type="button" class="config-btn config-btn--small" data-bulk="tags">${esc(this.t('config.bulkTagsApply', 'Apply tags'))}</button>
                </div>
                <div class="config-bulk-group">
                    <select class="config-select" id="config-bulk-status">${statusOpts}</select>
                    <button type="button" class="config-btn config-btn--small" data-bulk="status">${esc(this.t('config.bulkStatusApply', 'Set checking'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="pin">${esc(this.t('config.bulkTogglePin', 'Toggle pin'))}</button>
                </div>
                <div class="config-bulk-group">
                    <button type="button" class="config-btn config-btn--small" data-bulk="favicons">${esc(this.t('config.bulkRefreshFavicons', 'Refresh favicons'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="export">${esc(this.t('config.bulkExportCsv', 'Export CSV'))}</button>
                    <button type="button" class="config-btn config-btn--small config-btn--danger" data-bulk="delete">${esc(this.t('config.bulkDelete', 'Delete'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="clear">${esc(this.t('config.bulkClearSelection', 'Clear selection'))}</button>
                </div>
            </div>`;
    },

    /** One bookmark row in the config feed. */
    renderBookmarkRow(b, ctx) {
        const esc = ctx.esc;
        const key = this.bookmarkKey(b);
        const ticked = this.bmSelected.has(key);
        const title = b.name || this.formatBookmarkUrlDisplay(b.url) || b.url;
        const domain = this.formatBookmarkUrlDisplay(b.url);
        const metaBits = [];
        if (b.pinned) {
            metaBits.push(`<span class="config-bm-pin-icon" aria-label="${esc(this.t('config.bookmarkPinnedAria', 'Pinned'))}" title="${esc(this.t('config.pinnedShort', 'Pinned'))}">📌</span>`);
        }
        // Editable in place, and present even when empty: assigning a shortcut to
        // fifty rows meant opening fifty modals, and an absent pill gave the
        // keyboard nothing to aim at.
        metaBits.push(b.shortcut
            ? `<button type="button" class="config-bm-shortcut-pill" data-bm-inline="shortcut"
                    title="${esc(this.t('config.bookmarkInlineHint', 'Double-click to edit'))}">${esc(b.shortcut)}</button>`
            : `<button type="button" class="config-bm-shortcut-pill config-bm-shortcut-pill--empty" data-bm-inline="shortcut"
                    title="${esc(this.t('config.bookmarkShortcutAdd', 'Add a shortcut'))}">+</button>`);
        if (ctx.isDuplicate) {
            metaBits.push(`<span class="config-bm-duplicate-badge">${esc(this.t('config.bookmarkDuplicateBadge', 'Duplicate'))}</span>`);
        }
        const tags = b.tags || [];
        const tagChips = tags.map((tag) =>
            `<button type="button" class="config-bm-tag-chip" data-bm-filter-tag="${esc(tag)}">${esc(tag)}</button>`
        ).join('');
        // One or two tags read fine beside the domain. Beyond that they crowd it
        // out, so they move to a line of their own — the identifying line stays
        // scannable and the tags keep their own left edge down the feed.
        const TAGS_INLINE_MAX = 2;
        const tagsOnOwnLine = tags.length > TAGS_INLINE_MAX;
        const inlineTagChips = tagsOnOwnLine ? '' : tagChips;
        const tagRow = tagsOnOwnLine
            ? `<p class="config-bm-tag-row">${tagChips}</p>`
            : '';
        const mode = window.CheckMode?.of?.(b) || 'off';
        const feed = window.BookmarkFeedRow;
        const noteHtml = b.note
            ? `<p class="inbox-item-note">${esc(b.note)}</p>`
            : '';
        const iconSrc = this.resolveIconSrc(b.icon);
        const categoryLine = this.renderBookmarkPlaceCrumb(b, key, ctx);
        // The crumb above carries the page, so the footer no longer needs a
        // badge for it: the page used to appear there, in the crumb, or in
        // neither, depending on whether a category and a page filter happened
        // to be set. One fact, one place.
        const pageFooter = '<span class="config-bm-page-name config-bm-page-name--empty" aria-hidden="true"></span>';
        const usageTip = esc(this.bookmarkUsageTooltip(b));
        const usageFooter = `
            <div class="config-bm-meta-footer">
                ${pageFooter}
                <div class="config-bm-usage-col" title="${usageTip}">${this.renderBookmarkUsageLine(b)}</div>
            </div>`;
        return `
            <article class="feed-row health-view-item config-bm-row config-bm-item${ticked ? ' is-checked feed-row--edge-accent' : ''}" data-bm-key="${esc(key)}" tabindex="-1"
                     role="listitem"${ctx.setSize ? ` aria-posinset="${ctx.posInSet}" aria-setsize="${ctx.setSize}"` : ''}>
                <label class="config-bm-check">
                    <input type="checkbox" class="config-bm-tick" data-bm-tick="${esc(key)}" ${ticked ? 'checked' : ''}
                           aria-label="${esc(this.t('config.selectBookmark', 'Select bookmark'))}">
                </label>
                ${feed?.renderIcon?.(iconSrc, esc) || this.renderBookmarkIcon(b)}
                <div class="health-view-item-body">
                    <div class="health-view-item-head">
                        <h3 class="health-view-item-title config-bm-title" data-bm-inline="name"
                            title="${esc(this.t('config.bookmarkInlineHint', 'Double-click to edit'))}">${esc(title)}</h3>
                    </div>
                    <p class="health-view-item-meta config-bm-meta-primary">
                        <span>${esc(domain)}</span>
                        ${metaBits.join('')}
                        ${inlineTagChips}
                        <span class="health-check-mode-wrap">
                            ${feed?.renderCheckModeBadge?.(key, mode, esc, (k, fb) => this.t(k, fb)) || ''}
                            <!-- Empty until opened: fifty rows each carried a
                                 full menu nobody had asked for, which is most of
                                 the 55 DOM nodes a row costs. -->
                            <div class="health-view-menu" role="menu" hidden
                                 data-menu-for="${esc(key)}" data-menu-owner="check"
                                 data-menu-lazy="check"></div>
                        </span>
                    </p>
                    ${tagRow}
                    ${categoryLine}
                    ${noteHtml}
                    ${feed?.renderActionsBar?.({
                        key,
                        escapeHtml: esc,
                        t: (k, fb) => this.t(k, fb),
                        showRecheck: false,
                        // Same shell treatment as the check menu above.
                        moreMenuHtml: `<div class="health-view-menu" role="menu" hidden data-menu-for="${esc(key)}" data-menu-owner="more" data-menu-lazy="more" aria-label="${esc(this.t('dashboard.healthMore', 'More actions'))}"></div>`,
                    }) || this.renderBookmarkRowActions(b, key, false)}
                    ${usageFooter}
                </div>
            </article>`;
    },

    /** The rows themselves, re-rendered on every search/filter/edit change. */
    renderBookmarksList() {
        const esc = (v) => this.dash.escapeHtml(v);
        this._bmDuplicateUrls = null;
        const dupes = this.ensureDuplicateUrlSet();
        if (!(this.dash.allBookmarks || []).length) {
            return `
                <div class="config-panel-empty config-panel-empty--action">
                    <p>${esc(this.t('config.noBookmarksYet', 'No bookmarks yet.'))}</p>
                    <button type="button" class="config-btn config-btn--primary" data-bm-empty-add>${esc(this.t('config.addBookmarkBtn', 'Add bookmark'))}</button>
                </div>`;
        }
        const allRows = this.visibleBookmarks();
        if (!allRows.length) {
            const hasFilters = this.bookmarksFiltersActive();
            return `
                <div class="config-panel-empty config-panel-empty--action">
                    <p>${esc(this.bookmarksEmptyReason())}</p>
                    ${hasFilters ? `<button type="button" class="config-btn" data-bm-empty-clear>${esc(this.t('config.clearBookmarkFilters', 'Clear filters'))}</button>` : ''}
                    <button type="button" class="config-btn config-btn--primary" data-bm-empty-add>${esc(this.t('config.addBookmarkBtn', 'Add bookmark'))}</button>
                </div>`;
        }
        const names = this.pageNameIndex();
        const pageName = (id) => names.get(String(id)) || id;
        const showPageBadge = !this.bmPageFilter;
        const limit = this.bookmarkVisibleLimit(allRows.length);
        const rows = allRows.slice(0, limit);
        const ctx = { esc, pageName, showPageBadge, isDuplicate: (b) => {
            const url = String(b.url || '').trim().toLowerCase();
            return url && dupes.has(url);
        } };
        // Only the rows near the viewport are drawn. Infinite scroll answered
        // how much is fetched and nothing about how much is painted: a row is
        // thirty-four elements, so a thousand of them is thirty-three thousand
        // nodes and four megabytes of markup, and five thousand is a third of a
        // second of layout on every repaint — a tag added, a row ticked.
        //
        // The rows above and below the window are two spacers of the right
        // height, so the scrollbar still describes the whole list and nothing
        // jumps. Windowing is off while a row is expanded into its editor: that
        // row is several times the height of the others, which is exactly what
        // spacer arithmetic cannot survive, and nobody scrolls thousands of rows
        // with an editor open.
        const window_ = this.bookmarkRowWindow(rows.length);
        const visible = window_ ? rows.slice(window_.start, window_.end) : rows;
        // Position is passed down so each row can carry aria-posinset: with
        // paging the DOM holds only part of the list, and without setsize a
        // screen reader would announce "3 of 50" on a library of 500.
        const items = visible.map((b, i) => this.renderBookmarkRow(b, {
            ...ctx,
            isDuplicate: ctx.isDuplicate(b),
            posInSet: (window_ ? window_.start : 0) + i + 1,
            setSize: allRows.length,
        })).join('');
        const spacer = (n) => (n > 0
            ? `<div class="config-bm-spacer" aria-hidden="true" style="height:${Math.round(n * this.bookmarkRowHeight())}px"></div>`
            : '');
        const above = window_ ? spacer(window_.start) : '';
        const below = window_ ? spacer(rows.length - window_.end) : '';
        const more = allRows.length > rows.length
            ? `<div class="config-bm-load-sentinel" data-bm-load-more hidden aria-hidden="true"></div>
               <p class="config-bm-load-hint">${esc(this.t('config.bookmarksLoadMoreHint', '{shown} of {total} shown — scroll for more')
                   .replace('{shown}', String(rows.length)).replace('{total}', String(allRows.length)))}</p>`
            : '';
        return `<div class="feed-list health-view-feed config-bm-feed" role="list" data-bm-rows="${rows.length}">${above}${items}${below}${more}</div>`;
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
