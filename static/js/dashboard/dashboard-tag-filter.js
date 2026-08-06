/**
 * Tag filter view, banner, bulk actions.
 */
class DashboardTagFilter {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    normalizeTagFilters(tags) {
        const d = this.dash;
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
        const d = this.dash;
        return this.normalizeTagFilters(tags).join('\u0001');
    }


    tagFiltersEqual(a, b) {
        const d = this.dash;
        return this.tagFiltersKey(a) === this.tagFiltersKey(b);
    }


    hasActiveTagFilters(tags = this.dash._tagFilters) {
        const d = this.dash;
        return this.normalizeTagFilters(tags).length > 0;
    }


    formatTagFilterTagsLabel(tags = this.dash._tagFilters) {
        const d = this.dash;
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

        d._tagFilters = normalized;
        this._syncTagFilterDomAttributes();
        window.DashboardTagCloud?.setActiveTags?.(normalized);
        if (normalized.length === 0) {
            const container = document.getElementById('dashboard-layout');
            if (container?.classList.contains('tag-filter-view')) {
                this.unmountTagFilterView(container);
            }
        }
        d.renderDashboard({ animate: Boolean(animate), full: normalized.length === 0 });
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
        const d = this.dash;
        void this.setTagFilters([], { animate: true });
    }


    getBookmarksForTagFilters(tags = this.dash._tagFilters) {
        const d = this.dash;
        const required = this.normalizeTagFilters(tags);
        if (!required.length || !Array.isArray(d.bookmarks)) {
            return [];
        }
        const seen = new Set();
        const matched = [];
        for (const bookmark of d.bookmarks) {
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
        const d = this.dash;
        return this.getBookmarksForTagFilters([tag]);
    }


    unmountTagFilterView(container) {
        const d = this.dash;
        container.classList.remove('tag-filter-view', 'tag-filter-layout');
        container.querySelector('#tag-filter-banner')?.remove();
        container.querySelector('#tag-filter-toolbar')?.remove();
        container.querySelectorAll('.tag-filter-chunk, .empty-state--tag-filter').forEach((node) => node.remove());
        d.updateTagFilterIndicator();
        d._categoryListsCache = null;
    }


    renderTagFilterDashboard(container, options = {}) {
        const d = this.dash;
        const animate = options && options.animate === true;
        d._renderAnimationsEnabled = animate;
        const tags = d._tagFilters;
        const matched = this.getBookmarksForTagFilters(tags);
        const CHUNK_SIZE = 10;

        container.innerHTML = '';
        container.classList.remove('page-transition', 'tag-filter-layout');
        const gridLayout = d.syncDashboardGridLayout();
        container.classList.add('tag-filter-view');

        const banner = document.createElement('div');
        banner.className = 'tag-filter-banner';
        banner.id = 'tag-filter-banner';
        this.renderTagFilterBanner(banner, { tags, count: matched.length });
        container.appendChild(banner);

        if (matched.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state empty-state--tag-filter';
            const tagsLabel = this.formatTagFilterTagsListForMessage(tags);
            const emptyText = (d.language?.t?.('dashboard.tagFilterEmpty', 'No bookmarks with {tags} on this page.')
                || 'No bookmarks with {tags} on this page.')
                .replace('{tags}', tagsLabel);
            const text = document.createElement('p');
            text.className = 'empty-state--tag-filter-text';
            text.textContent = emptyText;
            empty.appendChild(text);

            const actions = document.createElement('div');
            actions.className = 'empty-state--tag-filter-actions';

            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'empty-state--tag-filter-btn';
            clearBtn.textContent = d.language?.t?.('dashboard.tagFilterEmptyClear', 'Clear tag filter') || 'Clear tag filter';
            clearBtn.addEventListener('click', () => this.clearTagFilter());
            actions.appendChild(clearBtn);

            if (window.DashboardTagCloud?.openModal) {
                const browseBtn = document.createElement('button');
                browseBtn.type = 'button';
                browseBtn.className = 'empty-state--tag-filter-btn';
                browseBtn.textContent = d.language?.t?.('dashboard.tagFilterEmptyBrowseTags', 'Browse tags') || 'Browse tags';
                browseBtn.addEventListener('click', () => window.DashboardTagCloud.openModal());
                actions.appendChild(browseBtn);
            }

            empty.appendChild(actions);
            container.appendChild(empty);
            if (d.language?.applyTranslations) {
                d.language.applyTranslations();
            }
            d.updateSearchComponent();
            this.updateTagFilterIndicator();
            return;
        }

        const chunkBlocks = [];
        for (let offset = 0; offset < matched.length; offset += CHUNK_SIZE) {
            const chunk = matched.slice(offset, offset + CHUNK_SIZE);
            const chunkIndex = Math.floor(offset / CHUNK_SIZE);
            chunkBlocks.push(
                d.createCategoryElement(
                    {
                        id: `__tag_filter_chunk_${chunkIndex}`,
                        name: '',
                        tagFilterChunk: true,
                    },
                    chunk
                )
            );
        }

        const body = document.createElement('div');
        d._copyDashboardGridLayoutToElement(body, container);
        this._distributeTagFilterColumnBlocks(body, chunkBlocks, { animate, gridLayout });
        container.appendChild(body);

        if (animate) {
            requestAnimationFrame(() => {
                container.classList.add('page-transition');
                setTimeout(() => container.classList.remove('page-transition'), ANIM.PAGE_TRANSITION);
            });
        }

        d.updateSearchComponent();
        this.updateTagFilterIndicator();
        d.syncBookmarkGridA11y();
        d.keyboardNavigation?.scheduleUpdate?.();
        window.FocusTrapUtils?.scheduleSyncDashboardInert?.();
        if (window.DashboardTagCloud?.modalOpen) {
            window.DashboardTagCloud.positionModal?.();
        }
        if (d.statusMonitor) {
            if (d.statusMonitorInitialized) {
                d.statusMonitor.updateBookmarks(matched);
            } else {
                d.statusMonitor.init(matched);
                d.statusMonitorInitialized = true;
            }
        }
    }


    setupTagFilterEscapeShortcut() {
        const d = this.dash;
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (window.DashboardTagCloud?.modalOpen) return;
            if (d.isModalOpen()) return;
            if (d.searchComponent && d.searchComponent.isActive()) return;
            if (!this.hasActiveTagFilters()) return;
            e.preventDefault();
            e.stopPropagation();
            window.DashboardTagCloud?.clearDashboardFilter?.({ focusBookmarks: true });
        });
    }


    setupTagFilterIndicator() {
        const d = this.dash;
        this.updateTagFilterIndicator();
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
        const d = this.dash;
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


    copyTagFilterLinksToClipboard() {
        const d = this.dash;
        const urls = this.getTagFilterMatchedBookmarksWithUrls()
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
            .filter((ref) => ref && ref.scope === 'current' && ref.index >= 0);
    }


    async bulkDeleteTagFilterBookmarks() {
        const d = this.dash;
        const refs = this.getTagFilterBookmarkRefs();
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
                    `Delete ${count} bookmark(s) on this page?`
                ),
                confirmText: d.configLabel('delete', 'Delete'),
                cancelText: d.formatDashboardLabel('cancel', {}, 'Cancel'),
            });
        } else {
            confirmed = window.confirm(
                d.formatDashboardLabel(
                    'tagFilterDeleteConfirm',
                    { count },
                    `Delete ${count} bookmark(s) on this page?`
                )
            );
        }
        if (!confirmed) {
            return;
        }

        // Captured before the splices, which renumber every index behind them.
        const trashed = refs.map((ref) => ({
            pageId: Number(ref.pageId ?? d.currentPageId),
            index: ref.index,
            bookmark: { ...ref.bookmark },
        }));

        d.ensureBookmarkMutationSnapshot();
        const sorted = [...refs].sort((a, b) => b.index - a.index);
        sorted.forEach((ref) => {
            d.removeBookmarkFromAllBookmarks(ref);
            d.bookmarks.splice(ref.index, 1);
        });

        d._inlineEditGlobalCleanup?.();
        d.inlineEditingBookmarkIndex = null;
        d.renderDashboard();

        const saved = await d.saveBookmarkOrder();
        if (!saved) {
            return;
        }
        await window.DashboardTrash?.record(trashed, 'tag-filter');
        d.showGroupedNotification(
            'tag-filter-delete',
            count,
            (n) => d.formatDashboardLabel('tagFilterDeleted', { count: n }, `Deleted ${n} bookmark(s)`),
            'success'
        );
    }


    bulkMoveTagFilterToCategory(categoryId) {
        const d = this.dash;
        const refs = this.getTagFilterBookmarkRefs();
        d.applyBookmarkCategoryMove(refs, categoryId, { count: refs.length });
    }


    async bulkMoveTagFilterToPage(targetPageId) {
        const d = this.dash;
        const refs = this.getTagFilterBookmarkRefs();
        if (!refs.length) {
            return;
        }

        const targetId = Number(targetPageId);
        const sourcePageId = Number(d.currentPageId);
        if (!Number.isFinite(targetId) || targetId <= 0 || targetId === sourcePageId) {
            return;
        }

        const sorted = [...refs].sort((a, b) => b.index - a.index);
        const toMove = sorted.map((ref) => ({ ...ref.bookmark }));

        try {
            const targetRes = await fetch(`/api/bookmarks?page=${targetId}`);
            if (!targetRes.ok) {
                throw new Error(d.formatDashboardLabel('loadSourcePageFailed', {}, 'Failed to load source page.'));
            }
            const targetBookmarks = await targetRes.json();

            d.ensureBookmarkMutationSnapshot();
            const remaining = [...d.bookmarks];
            sorted.forEach((ref) => {
                d.removeBookmarkFromAllBookmarks(ref);
                remaining.splice(ref.index, 1);
            });
            targetBookmarks.push(...toMove);

            const headers = { 'Content-Type': 'application/json' };
            const sourceSaveRes = await dashFetch(`/api/bookmarks?page=${sourcePageId}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(remaining),
            });
            if (!sourceSaveRes.ok) {
                throw new Error(d.formatDashboardLabel('saveBookmarkDeletionFailed', {}, 'Failed to save bookmark deletion.'));
            }
            const targetSaveRes = await dashFetch(`/api/bookmarks?page=${targetId}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(targetBookmarks),
            });
            if (!targetSaveRes.ok) {
                throw new Error(d.formatDashboardLabel('moveBookmarkFailed', {}, 'Failed to move bookmark.'));
            }

            d.bookmarks = remaining;
            d.data?.invalidatePageDataCache?.(sourcePageId);
            d.data?.invalidatePageDataCache?.(targetId);
            d.data?.updatePageDataCache?.(sourcePageId, { bookmarks: remaining });
            void d.data?.fetchAndStoreDataRevision?.();
            await d.loadAllBookmarks();
            d.renderDashboard();

            const targetPage = (d.pages || []).find((page) => Number(page.id) === targetId);
            const targetName = targetPage?.name || String(targetId);
            const movedCount = toMove.length;
            d.showGroupedNotification(
                `move-page:${targetId}`,
                movedCount,
                (n) => d.formatDashboardLabel(
                    'tagFilterMovedToPage',
                    { count: n, name: targetName },
                    `Moved ${n} bookmark(s) to "${targetName}"`
                ),
                'success',
                { duration: 2500 }
            );
        } catch (error) {
            d.showErrorNotification(
                error.message || d.formatDashboardLabel('tagFilterMoveFailed', {}, 'Failed to move bookmarks.')
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

        const realCategories = (d.categories || []).filter((category) => !category.isSmartCollection);
        const otherPages = (d.pages || []).filter((page) => String(page.id) !== String(d.currentPageId));

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


    _appendTagFilterToolbarButton(actions, { label, className = '', onClick }) {
        const d = this.dash;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `recent-bookmarks-open-btn modal-button tag-filter-bulk-btn ${className}`.trim();
        const labelEl = document.createElement('span');
        labelEl.className = 'modal-button-name';
        labelEl.textContent = label;
        btn.appendChild(labelEl);
        btn.addEventListener('click', onClick);
        actions.appendChild(btn);
        return btn;
    }


    renderTagFilterBanner(wrap, { tags, count = 0 } = {}) {
        const d = this.dash;
        const normalized = this.normalizeTagFilters(tags);
        wrap.replaceChildren();
        if (!normalized.length) {
            return;
        }

        const countLabel = this.formatTagFilterCountLabel(count);
        const tagsLabel = this.formatTagFilterTagsLabel(normalized);
        const groupAria = (d.language?.t('dashboard.tagFilterGroupAria')
            || 'Active tag filters: {tags}, {count} on this page')
            .replace('{tags}', tagsLabel)
            .replace('{count}', countLabel);

        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', groupAria);

        const chipsWrap = document.createElement('div');
        chipsWrap.className = 'tag-filter-indicator-chips';

        const chipTagAria = d.language?.t('dashboard.tagFilterChipTagAria')
            || 'Tag filter #{tag}, click to edit';
        const removeAriaTemplate = d.language?.t('dashboard.tagFilterChipRemoveAria')
            || 'Remove tag {tag} from filter';
        const clearAria = d.language?.t('dashboard.tagFilterChipClear') || 'Clear tag filter';

        normalized.forEach((tag) => {
            const item = document.createElement('span');
            item.className = 'tag-filter-indicator-tag-item';

            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'tag-filter-indicator-chip';
            chip.setAttribute(
                'aria-label',
                chipTagAria.replace('{tag}', tag)
            );

            const prefix = document.createElement('span');
            prefix.className = 'tag-filter-indicator-prefix';
            prefix.setAttribute('aria-hidden', 'true');
            prefix.textContent = '#';

            const tagEl = document.createElement('span');
            tagEl.className = 'tag-filter-indicator-tag';
            tagEl.textContent = tag;

            chip.append(prefix, tagEl);
            chip.addEventListener('click', () => {
                if (window.DashboardTagCloud?.isEligible?.()) {
                    window.DashboardTagCloud.openModal();
                }
            });

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'tag-filter-indicator-tag-remove';
            removeBtn.setAttribute('aria-label', removeAriaTemplate.replace('{tag}', tag));
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                void this.removeTagFilter(tag);
            });

            item.append(chip, removeBtn);
            chipsWrap.appendChild(item);
        });

        const summary = document.createElement('span');
        summary.className = 'tag-filter-indicator-summary';
        summary.textContent = countLabel;

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'tag-filter-indicator-clear';
        clearBtn.setAttribute('aria-label', clearAria);
        clearBtn.textContent = '×';
        clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.clearTagFilter();
            window.DashboardTagCloud?.restoreBookmarkFocus?.();
        });

        const head = document.createElement('div');
        head.className = 'tag-filter-banner-head tag-filter-indicator-head';
        head.append(chipsWrap, summary, clearBtn);
        wrap.appendChild(head);

        if (count <= 0) {
            return;
        }

        const toolbar = document.createElement('div');
        toolbar.className = 'tag-filter-bulk-toolbar recent-bookmarks-modal-toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute(
            'aria-label',
            d.language?.t('dashboard.tagFilterToolbarAria') || 'Tag filter actions'
        );

        const actions = document.createElement('div');
        actions.className = 'recent-bookmarks-open-actions';

        const openPlans = this.buildTagFilterOpenPlans();
        openPlans.forEach((plan, index) => {
            this._appendTagFilterToolbarButton(actions, {
                label: plan.label,
                onClick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (plan.bookmarks?.length) {
                        d.openBookmarksInNewTabs(plan.bookmarks);
                    }
                },
            }).setAttribute('data-open-plan', String(index));
        });

        if (this.getTagFilterMatchedBookmarksWithUrls().length > 0) {
            this._appendTagFilterToolbarButton(actions, {
                label: d.language?.t('dashboard.tagFilterCopyLinks') || 'Copy links',
                className: 'tag-filter-copy-btn',
                onClick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.copyTagFilterLinksToClipboard();
                },
            });
        }

        const moveBtn = this._appendTagFilterToolbarButton(actions, {
            label: d.language?.t('dashboard.tagFilterMove') || 'Move',
            className: 'tag-filter-move-btn',
            onClick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showTagFilterBulkMovePopover(moveBtn);
            },
        });

        this._appendTagFilterToolbarButton(actions, {
            label: d.language?.t('dashboard.tagFilterDelete') || 'Delete',
            className: 'tag-filter-delete-btn danger',
            onClick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                void this.bulkDeleteTagFilterBookmarks();
            },
        });

        toolbar.appendChild(actions);
        wrap.appendChild(toolbar);
    }


    updateTagFilterIndicator() {
        const d = this.dash;
        const wrap = document.getElementById('tag-filter-indicator');
        if (!wrap) {
            return;
        }
        d.tagFilterIndicator = wrap;
        wrap.replaceChildren();
        wrap.hidden = true;
        wrap.removeAttribute('role');
        wrap.removeAttribute('aria-label');
    }


    _distributeTagFilterColumnBlocks(container, chunkBlocks, { animate = false, gridLayout = null } = {}) {
        const d = this.dash;
        if (!container || !chunkBlocks.length) {
            return;
        }

        const chunkColCount = chunkBlocks.length;
        const shouldPackColumns = gridLayout?.packed ?? d.shouldPackDashboardColumns();
        const gap = 'var(--gap, 1.5rem)';
        const colMax = 'var(--dashboard-column-max, 300px)';

        container.style.setProperty('--packed-columns', String(chunkColCount));
        container.style.setProperty(
            '--dashboard-grid-max-width',
            `calc(${chunkColCount} * ${colMax} + ${Math.max(0, chunkColCount - 1)} * ${gap})`
        );

        if (shouldPackColumns) {
            chunkBlocks.forEach((el, i) => {
                if (animate) {
                    el.style.setProperty('--stagger-index', String(i));
                    const categoryEnterDelay = (i * ANIM.CATEGORY_STAGGER_STEP) + ANIM.CATEGORY_ENTER_BASE;
                    setTimeout(() => el.classList.remove('animate-enter'), categoryEnterDelay);
                }
                const col = document.createElement('div');
                col.className = 'dashboard-column tag-filter-dashboard-column';
                col.appendChild(el);
                container.appendChild(col);
            });
            return;
        }

        const colMin = 'var(--dashboard-column-min, 250px)';
        if (chunkColCount === 1) {
            container.style.gridTemplateColumns = 'minmax(0, 1fr)';
        } else {
            container.style.gridTemplateColumns = `repeat(${chunkColCount}, minmax(${colMin}, ${colMax}))`;
        }

        chunkBlocks.forEach((el, i) => {
            if (animate) {
                el.style.setProperty('--stagger-index', String(i));
                const categoryEnterDelay = (i * ANIM.CATEGORY_STAGGER_STEP) + ANIM.CATEGORY_ENTER_BASE;
                setTimeout(() => el.classList.remove('animate-enter'), categoryEnterDelay);
            }
            container.appendChild(el);
        });
    }

}

window.DashboardTagFilter = DashboardTagFilter;
