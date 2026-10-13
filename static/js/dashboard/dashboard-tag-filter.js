/**
 * The tag filter: which tags are on, the bookmarks they reach on every page,
 * and the bulk actions on them. The tag view (dashboard-tag-view.js) draws it.
 */
class DashboardTagFilter {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    normalizeTagFilters(tags) {
        const list = Array.isArray(tags) ? tags : (tags ? [tags] : []);
        const seen = new Set();
        const normalized = [];
        for (const raw of list) {
            const tag = String(raw || '').trim().toLowerCase();
            if (!tag || seen.has(tag)) continue;
            seen.add(tag);
            normalized.push(tag);
        }
        return normalized.sort((a, b) => a.localeCompare(b));
    }


    tagFiltersKey(tags) {
        return this.normalizeTagFilters(tags).join('\u0001');
    }


    tagFiltersEqual(a, b) {
        return this.tagFiltersKey(a) === this.tagFiltersKey(b);
    }


    hasActiveTagFilters(tags = this.dash._tagFilters) {
        return this.normalizeTagFilters(tags).length > 0;
    }


    formatTagFilterTagsLabel(tags = this.dash._tagFilters) {
        return this.normalizeTagFilters(tags).map((tag) => `#${tag}`).join(', ');
    }


    formatTagFilterTagsListForMessage(tags = this.dash._tagFilters) {
        const d = this.dash;
        const list = this.normalizeTagFilters(tags).map((tag) => `#${tag}`);
        if (list.length <= 1) return list[0] || '';
        if (list.length === 2) {
            const pair = d.language?.t?.('dashboard.tagFilterTagsPair', '{first} or {second}');
            if (pair && pair !== 'dashboard.tagFilterTagsPair') {
                return pair.replace('{first}', list[0]).replace('{second}', list[1]);
            }
            return `${list[0]} or ${list[1]}`;
        }
        return `${list.slice(0, -1).join(', ')}, or ${list[list.length - 1]}`;
    }


    _syncTagFilterDomAttributes() {
        const d = this.dash;
        const tags = d._tagFilters || [];
        const active = tags.length > 0;
        document.body.setAttribute('data-tag-filter-active', active ? 'true' : 'false');
        if (active) {
            document.body.setAttribute('data-tag-filters', tags.join(','));
        } else {
            document.body.removeAttribute('data-tag-filters');
        }
        document.body.removeAttribute('data-tag-filter');
    }


    async setTagFilters(tags, { animate = true } = {}) {
        const d = this.dash;
        const normalized = this.normalizeTagFilters(tags);
        if (this.tagFiltersEqual(normalized, d._tagFilters)) {
            return;
        }

        if (d.isInlineEditActive()) {
            if (!(await d.confirmInlineEditBeforeNavigation())) {
                window.DashboardTagCloud?.setActiveTags?.(d._tagFilters);
                return;
            }
        }

        /*
         * `tag-filter`, from every way in (cloud, `t` on a row, :filter).
         * Only how the set changed and how many tags it now holds go out --
         * a tag is the reader's own word and never leaves.
         */
        const before = this.normalizeTagFilters(d._tagFilters).length;
        window.nextdashTrack?.('tag-filter', {
            action: normalized.length === 0 ? 'clear' : (normalized.length > before ? 'add' : 'remove'),
            count: normalized.length,
        });

        /*
         * The one way in to the tag view. The cloud, `t` on a row and
         * :filter all come through here, so the view is opened in one place
         * rather than at each of them. Tags on: open it, or follow the new
         * set when it is already open. Tags off: leave it.
         */
        if (d.tagView) {
            // Written before anything is awaited: the first open loads the
            // view's module, and a second pick in that time (Shift in the
            // cloud) read the old list and dropped the first tag.
            if (normalized.length) {
                d._tagFilters = normalized;
                window.DashboardTagCloud?.setActiveTags?.(normalized);
            }
            if (!normalized.length) {
                if (d.activeView === 'tags') {
                    d.tagView.closeTagView();
                    return;
                }
            } else if (d.activeView === 'tags') {
                await d.tagView.updateTags(normalized);
                return;
            } else {
                await d.tagView.openTagView(normalized, { returnPageId: d.currentPageId });
                return;
            }
        }

        // No view to show them in (and none open): nothing is filtering.
        d._tagFilters = [];
        this._syncTagFilterDomAttributes();
        window.DashboardTagCloud?.setActiveTags?.([]);
        void animate;
    }


    async toggleTagFilter(tag, { animate = true } = {}) {
        const d = this.dash;
        const normalized = String(tag || '').trim().toLowerCase();
        if (!normalized) return;

        const current = this.normalizeTagFilters(d._tagFilters);
        const next = current.includes(normalized)
            ? current.filter((item) => item !== normalized)
            : [...current, normalized].sort((a, b) => a.localeCompare(b));
        await this.setTagFilters(next, { animate });
    }


    async removeTagFilter(tag, { animate = true } = {}) {
        const d = this.dash;
        const normalized = String(tag || '').trim().toLowerCase();
        if (!normalized) return;
        const next = this.normalizeTagFilters(d._tagFilters).filter((item) => item !== normalized);
        await this.setTagFilters(next, { animate });
    }


    clearTagFilter() {
        void this.setTagFilters([], { animate: true });
    }


    getBookmarksForTagFilters(tags = this.dash._tagFilters) {
        const d = this.dash;
        const required = this.normalizeTagFilters(tags);
        if (!required.length || !Array.isArray(d.bookmarks)) {
            return [];
        }
        // Every page, the same pool the cloud counts from: the current page
        // first, so a bookmark on two pages keeps its current-page row.
        const pool = window.DashboardTagCloud?.getBookmarkPool?.() ?? d.bookmarks;
        const seen = new Set();
        const matched = [];
        for (const bookmark of pool) {
            const bookmarkTags = new Set(
                (bookmark.tags || [])
                    .map((raw) => String(raw || '').trim().toLowerCase())
                    .filter(Boolean)
            );
            if (!required.some((tag) => bookmarkTags.has(tag))) {
                continue;
            }
            const key = `${String(bookmark.url || '').trim()}|${String(bookmark.name || '').trim()}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            matched.push(bookmark);
        }
        return d.sortBookmarks(matched);
    }


    getBookmarksForTagFilter(tag) {
        return this.getBookmarksForTagFilters([tag]);
    }


    formatTagFilterCountLabel(count) {
        const d = this.dash;
        if (count === 1) {
            return d.language?.t('dashboard.tagFilterCountOne') || '1 bookmark';
        }
        return (d.language?.t('dashboard.tagFilterCountMany') || '{count} bookmarks')
            .replace('{count}', String(count));
    }


    getTagFilterMatchedBookmarksWithUrls() {
        return this.getBookmarksForTagFilters().filter(
            (bookmark) => bookmark && String(bookmark.url || '').trim()
        );
    }


    buildTagFilterOpenPlans() {
        const d = this.dash;
        return d.buildOpenTabsPlans(this.getTagFilterMatchedBookmarksWithUrls(), {
            all: 'tagFilterOpenAll',
            first: 'tagFilterOpenFirst',
        });
    }


    /** The tag view passes what its list shows; without a list, every match. */
    copyTagFilterLinksToClipboard(list = null) {
        const d = this.dash;
        const urls = (Array.isArray(list) ? list.filter((b) => b && String(b.url || '').trim()) : this.getTagFilterMatchedBookmarksWithUrls())
            .map((bookmark) => window.BookmarkUrlUtils?.safeHttpResourceUrl?.(bookmark.url)
                || String(bookmark.url || '').trim())
            .filter(Boolean);
        if (!urls.length) {
            return;
        }

        const text = urls.join('\n');
        const notify = () => {
            const template = d.language?.t('dashboard.tagFilterLinksCopied')
                || 'Copied {count} link(s) to clipboard';
            const message = template.replace('{count}', String(urls.length));
            d.showNotification(message, 'success', { duration: 2500 });
        };

        const fallbackCopy = () => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                notify();
            } catch {
                d.showErrorNotification(
                    d.language?.t('dashboard.tagFilterCopyFailed') || 'Could not copy links to clipboard.'
                );
            }
            document.body.removeChild(textarea);
        };

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(notify).catch(fallbackCopy);
        } else {
            fallbackCopy();
        }
    }


    getTagFilterBookmarkRefs() {
        const d = this.dash;
        return this.getBookmarksForTagFilters()
            .map((bookmark) => d.resolveBookmarkReference(bookmark))
            .filter((ref) => ref && (
                (ref.scope === 'current' && ref.index >= 0) || ref.scope === 'remote'
            ));
    }


    /**
     * Delete matches that live on other pages, one request each.
     *
     * Their page is not the list on screen, so there is nothing to splice and
     * save; each goes through the store's own single delete, which is atomic
     * under its lock. Answers the refs that went.
     */
    async _deleteRemoteRefs(refs) {
        const d = this.dash;
        const headers = { 'Content-Type': 'application/json' };
        const outcomes = await Promise.allSettled(refs.map(async (ref) => {
            const res = await dashFetch('/api/bookmarks', {
                method: 'DELETE',
                headers,
                body: JSON.stringify({ page: Number(ref.pageId), bookmark: { ...ref.bookmark } }),
            });
            if (!res.ok) throw new Error('delete failed');
            return ref;
        }));
        const done = new Set(outcomes.filter((o) => o.status === 'fulfilled').map((o) => o.value));
        done.forEach((ref) => {
            d.removeBookmarkFromAllBookmarks(ref);
            d.data?.invalidatePageDataCache?.(Number(ref.pageId));
        });
        return done;
    }


    /** The tag view passes its selection; without one, every match. */
    async bulkDeleteTagFilterBookmarks(refsIn = null) {
        const d = this.dash;
        const fresh = () => (Array.isArray(refsIn)
            ? refsIn.map((ref) => d.resolveBookmarkReference(ref.bookmark)).filter(Boolean)
            : this.getTagFilterBookmarkRefs());
        let refs = fresh();
        if (!refs.length) {
            return;
        }

        const count = refs.length;
        let confirmed = false;
        if (window.AppModal && typeof window.AppModal.danger === 'function') {
            confirmed = await window.AppModal.danger({
                title: d.formatDashboardLabel('tagFilterDeleteTitle', {}, 'Delete filtered bookmarks'),
                message: d.formatDashboardLabel(
                    'tagFilterDeleteConfirm',
                    { count },
                    `Delete ${count} bookmark(s)?`
                ),
                confirmText: d.configLabel('delete', 'Delete'),
                cancelText: d.formatDashboardLabel('cancel', {}, 'Cancel'),
            });
        } else {
            confirmed = window.confirm(
                d.formatDashboardLabel(
                    'tagFilterDeleteConfirm',
                    { count },
                    `Delete ${count} bookmark(s)?`
                )
            );
        }
        if (!confirmed) {
            return;
        }
        // Again after the dialog: a background refresh while it was open
        // replaces d.bookmarks, and the old indexes then spliced other rows.
        refs = fresh();
        if (!refs.length) {
            return;
        }

        // The filter spans every page: rows on the page showing are spliced and
        // saved as one list, rows on other pages go one delete at a time.
        const currentRefs = refs.filter((ref) => ref.scope === 'current');
        const remoteRefs = refs.filter((ref) => ref.scope === 'remote');
        const toEntry = (ref) => ({
            pageId: Number(ref.pageId ?? d.currentPageId),
            index: ref.scope === 'current' ? ref.index : -1,
            bookmark: { ...ref.bookmark },
        });

        let trashed = [];
        if (currentRefs.length) {
            // Captured before the splices, which renumber every index behind them.
            const currentEntries = currentRefs.map(toEntry);
            d.ensureBookmarkMutationSnapshot();
            const sorted = [...currentRefs].sort((a, b) => b.index - a.index);
            sorted.forEach((ref) => {
                d.removeBookmarkFromAllBookmarks(ref);
                d.bookmarks.splice(ref.index, 1);
            });

            d._inlineEditGlobalCleanup?.();
            d.inlineEditingBookmarkIndex = null;
            d.renderDashboard();

            const saved = await d.saveBookmarkOrder();
            if (saved) {
                trashed = currentEntries;
            } else {
                // saveBookmarkOrder rolls d.bookmarks back, but allBookmarks has no
                // snapshot of its own -- without this the global-shortcut list stayed
                // missing the rows the failed delete had removed.
                [...currentEntries].sort((a, b) => a.index - b.index).forEach((entry) => {
                    d.restoreBookmarkInAllBookmarks(entry.bookmark, entry.pageId);
                });
            }
        }
        if (remoteRefs.length) {
            const gone = await this._deleteRemoteRefs(remoteRefs);
            trashed = trashed.concat(remoteRefs.filter((ref) => gone.has(ref)).map(toEntry));
            if (gone.size) {
                void d.data?.fetchAndStoreDataRevision?.();
                d.renderDashboard();
            }
        }
        if (!trashed.length) {
            return;
        }
        // Recorded after the save so a delete that did not persist cannot leave
        // a phantom trash entry. The undo below is the fast path; the 30-day
        // trash (this same record()) is what catches it after the toast is gone.
        // After the confirm and the save: only a delete that happened counts.
        window.nextdashTrack?.('tag-view:bulk', { action: 'delete', count: trashed.length });
        await window.DashboardTrash?.record(trashed, 'tag-filter');
        d.showGroupedNotification(
            'tag-filter-delete',
            trashed.length,
            (n) => d.formatDashboardLabel('tagFilterDeleted', { count: n }, `Deleted ${n} bookmark(s)`),
            'success',
            {
                duration: 8000,
                undoCallback: async () => {
                    const pageIds = [...new Set(trashed.map((entry) => Number(entry.pageId)))];
                    // The toast outlives a page switch: spliced into the page
                    // showing now, the rows were saved onto it and their own page
                    // stayed without them. The trash puts each one back home.
                    if (pageIds.some((id) => id !== Number(d.currentPageId))) {
                        await d.multiSelect?.restoreFromTrash?.(trashed);
                        await d.data?.refreshAfterBookmarkMutation?.({ pageIds });
                        return;
                    }
                    // Lowest index first, mirroring how a single-bookmark delete's
                    // undo re-inserts: splicing high-to-low would shift the still-
                    // pending lower indexes out from under themselves.
                    const restoreOrder = [...trashed].sort((a, b) => a.index - b.index);
                    restoreOrder.forEach((entry) => {
                        d.bookmarks.splice(entry.index, 0, entry.bookmark);
                        d.restoreBookmarkInAllBookmarks(entry.bookmark, entry.pageId);
                    });
                    d.pendingReorderSnapshot = null;
                    try {
                        if (await d.saveBookmarkOrder() === false) {
                            await d.data?.refreshAfterBookmarkMutation?.({ pageIds });
                            return;
                        }
                        // Left in the trash, the entries made a later Restore of
                        // the same rows answer 409.
                        await d.multiSelect?.dropRestoredTrashEntries?.(trashed);
                        await d.data?.refreshAfterBookmarkMutation?.({ pageIds });
                    } catch (_error) {
                        // saveBookmarkOrder already surfaces errors and reverts when possible.
                    }
                },
            }
        );
    }


    bulkMoveTagFilterToCategory(categoryId) {
        const d = this.dash;
        const refs = this.getTagFilterBookmarkRefs();
        d.applyBookmarkCategoryMove(refs, categoryId, { count: refs.length });
    }


    /**
     * Send a cross-page bulk move back where it came from.
     *
     * Not a plain reversal of state: the bookmarks now live on the other page's
     * file, so the undo is another add-plus-delete — the same atomic pair the
     * move used, with source and target exchanged. A bookmark whose add fails
     * stays on the target page rather than being deleted from both, which is
     * the same trade the forward move makes.
     */
    async undoBulkMoveToPage(movedRefs, sourcePageId, targetPageId) {
        const d = this.dash;
        const refs = (movedRefs || []).filter((ref) => ref?.bookmark);
        if (!refs.length) return;
        const headers = { 'Content-Type': 'application/json' };

        const outcomes = await Promise.allSettled(refs.map(async (ref) => {
            const bookmarkPayload = { ...ref.bookmark };
            const addRes = await dashFetch('/api/bookmarks/add', {
                method: 'POST',
                headers,
                // See the forward move: add-then-delete puts the URL on both
                // pages for as long as it takes to run.
                // A tag-filter move took each match from its own page.
                body: JSON.stringify({ page: Number(ref.pageId ?? sourcePageId), bookmark: bookmarkPayload, allowDuplicate: true }),
            });
            if (!addRes.ok) {
                throw new Error('add failed');
            }
            const deleteRes = await dashFetch('/api/bookmarks', {
                method: 'DELETE',
                headers,
                body: JSON.stringify({ page: targetPageId, bookmark: bookmarkPayload }),
            });
            if (!deleteRes.ok) {
                throw new Error('delete failed');
            }
            return ref;
        }));

        const restored = outcomes.filter((o) => o.status === 'fulfilled').length;
        const sources = new Set(refs.map((ref) => Number(ref.pageId ?? sourcePageId)));
        sources.forEach((id) => d.data?.invalidatePageDataCache?.(id));
        d.data?.invalidatePageDataCache?.(targetPageId);
        void d.data?.fetchAndStoreDataRevision?.();
        await d.loadAllBookmarks();
        // Reloaded only when it is the page showing: loading it navigates, and
        // an undo clicked from a third page jumped there.
        const showing = Number(d.currentPageId);
        if (sources.has(showing) || showing === Number(targetPageId)) {
            await d.data?.loadPageBookmarks?.(showing);
        }
        d.renderDashboard();

        if (restored < refs.length) {
            d.showErrorNotification(
                d.formatDashboardLabel(
                    'tagFilterMovePartialFailed',
                    { count: refs.length - restored },
                    `Could not move ${refs.length - restored} bookmark(s)`
                )
            );
        }
    }

    async bulkMoveTagFilterToPage(targetPageId, refsIn = null) {
        const d = this.dash;
        const targetId = Number(targetPageId);
        const sourcePageId = Number(d.currentPageId);
        if (!Number.isFinite(targetId) || targetId <= 0) {
            return;
        }
        // Each match leaves from its own page; one already on the target stays.
        const fromPage = (ref) => Number(ref.pageId ?? sourcePageId);
        const refs = (refsIn || this.getTagFilterBookmarkRefs())
            .filter((ref) => fromPage(ref) !== targetId);
        if (!refs.length) {
            return;
        }

        const sorted = [...refs].sort((a, b) => b.index - a.index);
        const headers = { 'Content-Type': 'application/json' };

        // Single-item add + delete per bookmark instead of a whole-list
        // read-modify-write on each side: two full-array snapshots taken up
        // front raced against any concurrent write to either page, and a
        // source save that landed while the target save then failed lost
        // every selected bookmark from both lists at once (see
        // _moveBookmarkToPage, fixed the same way for the single-bookmark
        // case). Each add/delete pair is atomic under the store's own lock,
        // so one bookmark failing cannot corrupt the others, and a failed add
        // leaves that bookmark exactly where it started. Promise.allSettled
        // rather than a loop so one failure doesn't block the rest — same
        // pattern as the inbox's bulk actions.
        const outcomes = await Promise.allSettled(sorted.map(async (ref) => {
            const bookmarkPayload = { ...ref.bookmark };
            // Category ids are per page: the source's id put every row under
            // "Unknown category" on the target.
            const category = await d.inlineEdit.categoryOnPage(ref.bookmark.category, targetId);
            const addRes = await dashFetch('/api/bookmarks/add', {
                method: 'POST',
                headers,
                // A bulk move is many add-then-delete pairs; each one holds the
                // URL on two pages until its delete lands.
                body: JSON.stringify({ page: targetId, bookmark: { ...bookmarkPayload, category }, allowDuplicate: true }),
            });
            if (!addRes.ok) {
                throw new Error('add failed');
            }
            const deleteRes = await dashFetch('/api/bookmarks', {
                method: 'DELETE',
                headers,
                body: JSON.stringify({ page: fromPage(ref), bookmark: bookmarkPayload }),
            });
            if (!deleteRes.ok) {
                // The copy on the target page is now the only way to avoid
                // losing this bookmark outright, so it stays there rather than
                // trying to undo the add — same tradeoff as _moveBookmarkToPage.
                throw new Error('delete failed');
            }
            return ref;
        }));

        const movedRefs = outcomes
            .filter((outcome) => outcome.status === 'fulfilled')
            .map((outcome) => outcome.value);

        if (!movedRefs.length) {
            d.showErrorNotification(d.formatDashboardLabel('tagFilterMoveFailed', {}, 'Failed to move bookmarks.'));
            return;
        }

        // Removed by identity, not by the indexes taken before the requests:
        // a background reload meanwhile replaces d.bookmarks, and a page switch
        // makes it another page's list altogether.
        movedRefs.forEach((ref) => d.removeBookmarkFromAllBookmarks(ref));
        new Set(movedRefs.map(fromPage)).forEach((id) => d.data?.invalidatePageDataCache?.(id));
        d.data?.invalidatePageDataCache?.(targetId);
        const leftThisPage = movedRefs.filter((ref) => fromPage(ref) === Number(d.currentPageId));
        if (leftThisPage.length) {
            const key = (b) => `${b?.url}\u0000${b?.category ?? ''}`;
            const gone = new Map();
            leftThisPage.forEach((ref) => gone.set(key(ref.bookmark), (gone.get(key(ref.bookmark)) || 0) + 1));
            const remaining = (d.bookmarks || []).filter((b) => {
                const n = gone.get(key(b)) || 0;
                if (!n) return true;
                gone.set(key(b), n - 1);
                return false;
            });
            d.bookmarks = remaining;
            d.data?.updatePageDataCache?.(sourcePageId, { bookmarks: remaining });
        }
        void d.data?.fetchAndStoreDataRevision?.();
        await d.loadAllBookmarks();
        // Moved onto the page showing: its own list has to hear about it.
        if (targetId === Number(d.currentPageId)) {
            await d.data?.loadPageBookmarks?.(targetId, { forceFetch: true, skipRender: true });
        }
        d.renderDashboard();

        const targetPage = (d.pages || []).find((page) => Number(page.id) === targetId);
        const targetName = targetPage?.name || String(targetId);
        const movedCount = movedRefs.length;
        d.showGroupedNotification(
            `move-page:${targetId}`,
            movedCount,
            (n) => d.formatDashboardLabel(
                'tagFilterMovedToPage',
                { count: n, name: targetName },
                `Moved ${n} bookmark(s) to "${targetName}"`
            ),
            'success',
            {
                // Eight seconds, like every other undo, and the same shape: the
                // move is an add on the target plus a delete on the source, so
                // the way back is the same pair with the pages swapped. Only the
                // bookmarks that actually moved are offered back — a partial
                // failure left the rest where they were.
                duration: 8000,
                undoCallback: () => this.undoBulkMoveToPage(movedRefs, sourcePageId, targetId),
            }
        );

        const failedCount = sorted.length - movedRefs.length;
        if (failedCount > 0) {
            d.showErrorNotification(
                d.formatDashboardLabel(
                    'tagFilterMovePartialFailed',
                    { count: failedCount },
                    `Could not move ${failedCount} bookmark(s)`
                )
            );
        }
    }


    /**
     * The "Move to…" popover for a set of bookmarks.
     *
     * Options carry the set and what to do with it so the grid's multi-select
     * toolbar can raise the same popover. Defaulting them to the tag filter
     * keeps every existing caller unchanged — this is one popover with two
     * sources, not a second copy that would drift on keyboard handling,
     * positioning and the already-there guard.
     */
    showTagFilterBulkMovePopover(anchorEl, options = {}) {
        const d = this.dash;
        d._closeActionPopovers();

        const refs = options.refs || this.getTagFilterBookmarkRefs();
        const moveToCategory = options.onMoveToCategory
            || ((id) => this.bulkMoveTagFilterToCategory(id));
        const moveToPage = options.onMoveToPage
            || ((id) => { void this.bulkMoveTagFilterToPage(id); });
        if (!refs.length || !anchorEl) {
            return;
        }

        const t = (key, fallback) => {
            const val = d.language?.t ? d.language.t(key) : null;
            return (val && val !== key) ? val : fallback;
        };

        // The tag filter spans every page. Categories belong to the page on
        // screen, so they are offered only when every match stands on it; and
        // when some do not, that page is a destination like any other.
        const allHere = refs.every((ref) => ref.scope !== 'remote');
        const realCategories = allHere
            ? (d.categories || []).filter((category) => !category.isSmartCollection)
            : [];
        const otherPages = (d.pages || []).filter((page) => (
            !allHere || String(page.id) !== String(d.currentPageId)
        ));

        const pop = document.createElement('div');
        pop.id = 'move-popover';
        pop.className = 'move-popover';
        pop.setAttribute('role', 'listbox');
        pop.setAttribute('aria-label', t('dashboard.movePopoverTitle', 'Move to…'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = t('dashboard.movePopoverTitle', 'Move to…');
        pop.appendChild(header);

        const currentCategoryIds = d.collectBookmarkCategoryIds(
            refs.map((ref) => ref.bookmark)
        );
        const currentHint = document.createElement('div');
        currentHint.className = 'move-popover-current-hint';
        currentHint.textContent = d.formatMovePopoverCurrentCategoriesHint(currentCategoryIds);
        pop.appendChild(currentHint);

        const items = [];

        if (!allHere) {
            const catLabel = document.createElement('div');
            catLabel.className = 'move-popover-section-label';
            catLabel.textContent = t('dashboard.movePopoverCategorySection', 'Category');
            pop.appendChild(catLabel);
            const hint = document.createElement('div');
            hint.className = 'move-popover-current-hint move-popover-category-hint';
            hint.textContent = t(
                'dashboard.tagFilterMoveCategoryOtherPages',
                'Some of these are on other pages. Categories belong to one page; move them to a page instead.'
            );
            pop.appendChild(hint);
        }

        if (realCategories.length > 0) {
            const catLabel = document.createElement('div');
            catLabel.className = 'move-popover-section-label';
            catLabel.textContent = t('dashboard.movePopoverCategorySection', 'Category');
            pop.appendChild(catLabel);

            realCategories.forEach((cat) => {
                const isCurrent = currentCategoryIds.has(String(cat.id));
                const item = document.createElement('div');
                item.className = 'move-popover-item' + (isCurrent ? ' is-current' : '');
                item.setAttribute('role', 'option');
                item.setAttribute('data-type', 'category');
                item.setAttribute('data-id', String(cat.id));
                item.setAttribute('aria-selected', String(isCurrent));

                const check = document.createElement('span');
                check.className = 'move-popover-check';
                check.textContent = isCurrent ? '✓' : '';
                item.appendChild(check);

                const label = document.createElement('span');
                label.textContent = cat.name;
                item.appendChild(label);

                pop.appendChild(item);
                items.push(item);
            });
        }

        if (otherPages.length > 0) {
            const divider = document.createElement('div');
            divider.className = 'move-popover-divider';
            pop.appendChild(divider);

            const pageLabel = document.createElement('div');
            pageLabel.className = 'move-popover-section-label';
            pageLabel.textContent = t('dashboard.movePopoverPageSection', 'Page');
            pop.appendChild(pageLabel);

            otherPages.forEach((page) => {
                const item = document.createElement('div');
                item.className = 'move-popover-item';
                item.setAttribute('role', 'option');
                item.setAttribute('data-type', 'page');
                item.setAttribute('data-id', String(page.id));
                item.setAttribute('aria-selected', 'false');

                const check = document.createElement('span');
                check.className = 'move-popover-check';
                check.textContent = '';
                item.appendChild(check);

                const label = document.createElement('span');
                label.textContent = page.name;
                item.appendChild(label);

                pop.appendChild(item);
                items.push(item);
            });
        }

        if (!items.length) {
            return;
        }

        document.body.appendChild(pop);
        d._positionActionPopoverBeside(pop, anchorEl);

        const previousFocus = document.activeElement;
        let focusedIdx = items.findIndex((item) => item.classList.contains('is-current'));
        if (focusedIdx < 0) {
            focusedIdx = 0;
        }

        const setFocus = (idx) => {
            d._focusActionPopoverItem(items, idx);
            focusedIdx = idx;
        };
        setFocus(focusedIdx);

        let onOutside = null;
        let unbindPosition = null;
        const close = () => {
            if (pop.parentNode) {
                pop.remove();
            }
            d._restoreActionPopoverFocus(previousFocus, anchorEl);
            unbindPosition?.();
            unbindPosition = null;
            document.removeEventListener('keydown', onKey, true);
            if (onOutside) {
                document.removeEventListener('click', onOutside);
                onOutside = null;
            }
            if (d._movePopoverCleanup === close) {
                d._movePopoverCleanup = null;
            }
        };
        unbindPosition = d._attachActionPopoverPositioning(pop, anchorEl);
        d._movePopoverCleanup = close;

        const confirm = (item) => {
            const type = item.getAttribute('data-type');
            const id = item.getAttribute('data-id');
            if (type === 'category') {
                const targetId = String(id);
                const allAlreadyThere = refs.every(
                    (ref) => String(ref.bookmark?.category ?? '') === targetId
                );
                if (allAlreadyThere) {
                    return;
                }
            }
            close();
            if (type === 'category') {
                moveToCategory(id);
            } else if (type === 'page') {
                moveToPage(Number(id));
            }
        };

        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focusedIdx + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focusedIdx - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); if (items[focusedIdx]) confirm(items[focusedIdx]); return; }
        };

        items.forEach((item, idx) => {
            item.addEventListener('mouseenter', () => setFocus(idx));
            item.addEventListener('click', () => confirm(item));
        });

        document.addEventListener('keydown', onKey, true);
        setTimeout(() => {
            onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchorEl) close(); };
            document.addEventListener('click', onOutside);
        }, 0);
    }


}

window.DashboardTagFilter = DashboardTagFilter;
