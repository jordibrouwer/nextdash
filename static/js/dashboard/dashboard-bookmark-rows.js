/**
 * Bookmark row DOM, moves, popovers, metadata sync.
 */
class DashboardBookmarkRows {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    /**
     * Does this bookmark take part in availability checking at all?
     *
     * Off / periodic / monitor is one three-state choice stored as two mutually
     * exclusive flags, so a monitored bookmark has `checkStatus === false`.
     * status.js owns the answer; the fallback keeps rows rendering if that
     * script has not loaded yet, and matches it exactly.
     */
    isChecked(bookmark) {
        return typeof window.bookmarkIsChecked === 'function'
            ? window.bookmarkIsChecked(bookmark)
            : Boolean(bookmark?.checkStatus || bookmark?.monitor);
    }

    bookmarkDisplayLabel(bookmark) {
        const d = this.dash;
        const name = String(bookmark?.name || '').trim();
        if (name) return name;
        const url = String(bookmark?.url || '').trim();
        if (url) {
            const host = window.BookmarkUrlUtils?.bookmarkDisplayHostnameFromUrl?.(url)
                || window.BookmarkUrlUtils?.extractDomainFromUrl?.(url);
            return host || url;
        }
        return d.bookmarkFallbackName();
    }

    /** Full URL (or name) for title/aria when the visible label is shortened to hostname. */
    bookmarkRowTooltip(bookmark) {
        const name = String(bookmark?.name || '').trim();
        if (name) return name;
        const url = String(bookmark?.url || '').trim();
        if (url) return url;
        return this.bookmarkDisplayLabel(bookmark);
    }

    /**
     * The hover tooltip: the row label plus how the bookmark has been used.
     *
     * Deliberately separate from bookmarkRowTooltip, which still feeds the
     * aria-label. A screen reader announces that label on every row it moves
     * through, so folding usage into it would read out "opened 35 times, last
     * yesterday" a hundred times while arrowing down a page. Sighted users can
     * ignore a tooltip until they want it; a screen reader user cannot. The
     * counts therefore enrich the visual affordance only.
     *
     * Never-opened bookmarks add nothing: the plain label already says what a
     * "0 times" line would, and it would be the noisiest rows that gained text.
     */
    bookmarkRowTitle(bookmark) {
        const d = this.dash;
        const base = this.bookmarkRowTooltip(bookmark);
        const opens = Number(bookmark?.openCount || 0);
        if (opens <= 0) return base;

        const countText = opens === 1
            ? d.formatDashboardLabel('previewOpenedOnce', {}, 'opened once')
            : d.formatDashboardLabel('previewOpenedMany', { count: opens }, `opened ${opens} times`);

        const last = this.formatRowLastOpened(bookmark?.lastOpened);
        const usage = last
            ? d.formatDashboardLabel('previewUsageWithLast', { count: countText, last }, `${countText} · last ${last}`)
            : countText;
        return `${base}\n${usage}`;
    }

    /** Shared last-opened label, or '' when never opened. */
    formatRowLastOpened(timestamp) {
        const d = this.dash;
        if (typeof window.formatLastOpened !== 'function') return '';
        const { label, never } = window.formatLastOpened(timestamp, {
            t: (key, fallback, params) => {
                const bare = String(key).startsWith('dashboard.') ? String(key).slice('dashboard.'.length) : key;
                return d.formatDashboardLabel(bare, params || {}, fallback);
            },
        });
        return never ? '' : label;
    }

    resolveDashboardBookmarkRow(ref, bookmark, options = {}) {
        const excludeSmart = options.excludeSmart !== false;
        const root = '#dashboard-layout';

        if (ref?.scope === 'current' && Number.isInteger(ref.index) && ref.index >= 0) {
            const rows = document.querySelectorAll(`${root} .bookmark-link[data-bookmark-index="${ref.index}"]`);
            for (const row of rows) {
                if (excludeSmart && row.closest('.category[data-smart-collection="true"]')) {
                    continue;
                }
                return row;
            }
        }

        const url = String(bookmark?.url || '').trim();
        if (!url) {
            return null;
        }
        const escaped = CSS.escape(url);
        const selector = excludeSmart
            ? `${root} .category:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${escaped}"]`
            : `${root} .bookmark-link[data-bookmark-url="${escaped}"]`;
        const candidates = document.querySelectorAll(selector);
        if (candidates.length === 1) {
            return candidates[0];
        }
        if (candidates.length > 1 && options.preferCategoryId != null) {
            const prefer = String(options.preferCategoryId);
            for (const row of candidates) {
                const list = row.closest('.bookmarks-list');
                if (list && String(list.getAttribute('data-category-id') ?? '') === prefer) {
                    return row;
                }
            }
        }
        return candidates[0] || null;
    }

    /**
     * Put moved bookmarks back where they were.
     *
     * Works from the snapshot the move took rather than by moving again: a
     * second move would fire its own toast and its own analytics event, and
     * would file everything into one category — which is exactly what an undo
     * of a bulk move must not do, since the rows came from several.
     */
    undoBookmarkCategoryMove(previous) {
        const d = this.dash;
        const entries = (previous || []).filter((entry) => entry?.ref?.bookmark);
        if (!entries.length) return;

        d.ensureBookmarkMutationSnapshot();
        entries.forEach(({ ref, category }) => {
            ref.bookmark.category = category;
            if (ref.original) {
                ref.original.category = category;
            }
        });
        d.scheduleBookmarkOrderSave();
        if (!d.isInlineEditActive()) {
            d.renderDashboard({ animate: false });
        }
    }

    applyBookmarkCategoryMove(bookmarkRefs, categoryId, { notify = true, count } = {}) {
        const d = this.dash;
        const refs = (Array.isArray(bookmarkRefs) ? bookmarkRefs : [bookmarkRefs])
            .map((entry) => (entry?.bookmark ? entry : this.resolveBookmarkReference(entry)))
            .filter((ref) => ref && ref.scope === 'current' && ref.bookmark);

        if (!refs.length) {
            return false;
        }

        // One event per move, with a bucketed size so a bulk move from the tag
        // filter does not fire once per bookmark. Never the category name.
        window.nextdashTrack?.('bookmark:move', { size: refs.length <= 1 ? '1' : (refs.length <= 5 ? '2-5' : (refs.length <= 20 ? '6-20' : '20+')) });

        const cat = (d.categories || []).find((item) => String(item.id) === String(categoryId));
        const catName = cat?.name || categoryId;
        const affectedCount = Number.isFinite(count) ? count : refs.length;

        d.ensureBookmarkMutationSnapshot();
        // What each bookmark was filed under before this move. Deleting a row has
        // offered eight seconds of Undo for a long time; moving one — or twenty,
        // from the tag filter — offered nothing, and a bulk move to the wrong
        // category lost every original category with no way back.
        const previous = refs.map((ref) => ({ ref, category: ref.bookmark.category }));
        refs.forEach((ref) => {
            ref.bookmark.category = categoryId;
            if (ref.original) {
                ref.original.category = categoryId;
            }
        });

        d.syncInlineEditCategoryAfterMove(categoryId, refs);
        const reparented = this.reparentBookmarkRowsInDom(refs, categoryId);
        d.scheduleBookmarkOrderSave();

        if (!d.isInlineEditActive() && !reparented) {
            d.renderDashboard({ animate: false });
        } else if (!d.isInlineEditActive() && reparented) {
            d.renderCore.syncDashboardGridLayout();
            d.syncBookmarkGridA11y?.();
        }

        if (notify) {
            const groupKey = `move-category:${categoryId}`;
            // Long enough to be caught, matching the delete toast: an undo nobody
            // can reach is the same as no undo.
            const duration = 8000;
            const undoCallback = () => this.undoBookmarkCategoryMove(previous);
            if (affectedCount > 1) {
                d.showGroupedNotification(
                    groupKey,
                    affectedCount,
                    (n) => d.formatDashboardLabel(
                        'tagFilterMovedToCategory',
                        { count: n, name: catName },
                        `Moved ${n} bookmark(s) to "${catName}"`
                    ),
                    'success',
                    { duration, undoCallback }
                );
            } else {
                d.showNotification(
                    d.formatDashboardLabel(
                        'movedToCategory',
                        { name: catName },
                        `Moved to "${catName}"`
                    ),
                    'success',
                    { duration, undoCallback }
                );
            }
        }

        return true;
    }


    /**
     * Retag rows in place when there is no target list to move them into.
     *
     * Private to reparentBookmarkRowsInDom's fallback — it reads as public API
     * and had a delegate on the dashboard to match, which nothing ever called.
     */
    _updateBookmarkRowsCategoryInDom(refs, categoryId) {
        const normalizedCategoryId = String(categoryId ?? '');
        (refs || []).forEach((ref) => {
            const bookmark = ref?.bookmark;
            if (!bookmark) {
                return;
            }

            const row = this.resolveDashboardBookmarkRow(ref, bookmark);
            if (row) {
                row.setAttribute('data-category-id', normalizedCategoryId);
            }
        });
    }


    reparentBookmarkRowsInDom(refs, categoryId) {
        const normalizedCategoryId = String(categoryId ?? '');
        const targetList = document.querySelector(
            `.bookmarks-list[data-category-id="${CSS.escape(normalizedCategoryId)}"]`
        );
        if (!targetList) {
            this._updateBookmarkRowsCategoryInDom(refs, categoryId);
            return false;
        }

        let moved = 0;
        (refs || []).forEach((ref) => {
            const bookmark = ref?.bookmark;
            if (!bookmark) {
                return;
            }

            const row = this.resolveDashboardBookmarkRow(ref, bookmark);
            if (!row) {
                return;
            }

            row.setAttribute('data-category-id', normalizedCategoryId);
            if (row.parentElement !== targetList) {
                targetList.appendChild(row);
            }
            moved += 1;
        });

        return moved > 0 && moved === (refs || []).length;
    }


    collectBookmarkCategoryIds(bookmarks = []) {
        const ids = new Set();
        (bookmarks || []).forEach((entry) => {
            const bookmark = entry?.bookmark ?? entry;
            if (!bookmark) {
                return;
            }
            ids.add(String(bookmark.category ?? '').trim());
        });
        return ids;
    }


    formatMovePopoverCurrentCategoriesHint(categoryIds) {
        const d = this.dash;
        const ids = [...(categoryIds || [])];
        if (!ids.length) {
            return d.formatDashboardLabel('movePopoverCurrentCategory', { name: '—' }, 'Current category: —');
        }

        const names = ids.map((id) => {
            if (!id) {
                return d.configLabel('noCategory', 'No category');
            }
            const cat = (d.categories || []).find((item) => String(item.id) === String(id));
            return cat?.name || id;
        });

        if (names.length === 1) {
            return d.formatDashboardLabel(
                'movePopoverCurrentCategory',
                { name: names[0] },
                `Current category: ${names[0]}`
            );
        }

        return d.formatDashboardLabel(
            'movePopoverCurrentCategories',
            { names: names.join(', ') },
            `Current categories: ${names.join(', ')}`
        );
    }


    canonicalBookmarkURLKey(raw) {
        if (typeof BookmarkUrlUtils !== 'undefined' && typeof BookmarkUrlUtils.canonicalBookmarkURLKey === 'function') {
            return BookmarkUrlUtils.canonicalBookmarkURLKey(raw);
        }
        return String(raw || '').trim();
    }


    resolveBookmarkPageId(bookmark) {
        const d = this.dash;
        const explicit = Number(bookmark?.pageId || bookmark?.pageID || 0);
        if (Number.isFinite(explicit) && explicit > 0) {
            return explicit;
        }
        return Number(d.currentPageId);
    }


    bookmarkMatchesCanonicalUrl(candidate, bookmark) {
        const key = this.canonicalBookmarkURLKey(bookmark?.url || '');
        if (!key) {
            return false;
        }
        return this.canonicalBookmarkURLKey(candidate?.url || '') === key;
    }


    resolveBookmarkIndex(bookmark) {
        const d = this.dash;
        const pageId = this.resolveBookmarkPageId(bookmark);
        if (pageId !== Number(d.currentPageId)) {
            return -1;
        }

        let idx = d.bookmarks.indexOf(bookmark);
        if (idx >= 0) {
            return idx;
        }
        if (!bookmark?.url) {
            return -1;
        }
        const key = this.canonicalBookmarkURLKey(bookmark.url);
        const matches = [];
        d.bookmarks.forEach((b, i) => {
            if (this.canonicalBookmarkURLKey(b.url) === key) matches.push(i);
        });
        if (matches.length <= 1) {
            return matches.length ? matches[0] : -1;
        }
        // The same URL can sit on a page more than once, and a detached copy of
        // a row — what the smart collections hand back — has no identity to match
        // on. Taking the first hit would resolve every copy to the same entry, so
        // a delete from such a row removed the wrong bookmark. Narrow with the
        // fields that actually distinguish them before falling back.
        const narrowed = matches.find((i) => this.sameBookmarkContent(d.bookmarks[i], bookmark));
        return narrowed !== undefined ? narrowed : matches[0];
    }


    /** Do two bookmark objects describe the same row, beyond a shared URL? */
    sameBookmarkContent(a, b) {
        if (!a || !b) return false;
        const norm = (v) => String(v ?? '');
        return norm(a.name) === norm(b.name)
            && norm(a.category) === norm(b.category)
            && norm(a.shortcut) === norm(b.shortcut)
            && norm(a.icon) === norm(b.icon)
            && Number(a.createdAt || 0) === Number(b.createdAt || 0)
            && (a.tags || []).join(',') === (b.tags || []).join(',');
    }


    resolveBookmarkIndexOnPage(bookmark, pageId) {
        const d = this.dash;
        const pid = Number(pageId);
        if (!Number.isFinite(pid) || pid <= 0) {
            return -1;
        }

        const matches = (candidate) => {
            if (candidate === bookmark) {
                return true;
            }
            const candidatePageId = Number(candidate?.pageId || candidate?.pageID || 0);
            if (candidatePageId > 0 && candidatePageId !== pid) {
                return false;
            }
            return this.bookmarkMatchesCanonicalUrl(candidate, bookmark);
        };

        if (pid === Number(d.currentPageId) && Array.isArray(d.bookmarks)) {
            const refIdx = d.bookmarks.indexOf(bookmark);
            if (refIdx >= 0) {
                return refIdx;
            }
            const idx = d.bookmarks.findIndex(matches);
            if (idx >= 0) {
                return idx;
            }
        }

        const pool = Array.isArray(d.allBookmarks) && d.allBookmarks.length > 0
            ? d.allBookmarks
            : (pid === Number(d.currentPageId) ? d.bookmarks : []);
        let pageIndex = 0;
        let urlFallback = -1;
        for (const candidate of pool) {
            const candidatePageId = Number(candidate?.pageId || candidate?.pageID || pid);
            if (candidatePageId !== pid) {
                continue;
            }
            if (candidate === bookmark) {
                return pageIndex;
            }
            if (urlFallback < 0 && this.bookmarkMatchesCanonicalUrl(candidate, bookmark)) {
                urlFallback = pageIndex;
            }
            pageIndex += 1;
        }
        return urlFallback;
    }


    populateBookmarkRowView(row, bookmark, categoryId, allowInlineEdit) {
        const d = this.dash;
        if (row._bookmarkLongPressAbort) {
            row._bookmarkLongPressAbort.abort();
            row._bookmarkLongPressAbort = null;
        }
        const bookmarkRef = this.resolveBookmarkReference(bookmark);
        const bookmarkIndex = bookmarkRef?.scope === 'current' ? bookmarkRef.index : -1;
        row.classList.remove('bookmark-inline-editing');
        row.innerHTML = '';
        row.className = 'bookmark-link reorder-item is-idle';
        row.setAttribute('role', 'row');
        row.setAttribute('data-bookmark-url', bookmark.url || '');
        const tagList = (bookmark.tags || [])
            .map((raw) => String(raw || '').trim().toLowerCase())
            .filter(Boolean);
        if (tagList.length) {
            row.setAttribute('data-bookmark-tags', tagList.join(','));
        } else {
            row.removeAttribute('data-bookmark-tags');
        }
        if (bookmarkIndex >= 0) {
            row.setAttribute('data-bookmark-index', String(bookmarkIndex));
        } else {
            row.removeAttribute('data-bookmark-index');
        }
        row.setAttribute('data-category-id', categoryId);
        d.contextMenu?.bindRow(row);

        const lead = document.createElement('div');
        lead.className = 'bookmark-lead';
        lead.setAttribute('role', 'presentation');
        const reorderHandle = document.createElement('div');
        reorderHandle.className = 'bookmark-reorder-handle';
        const dragLabel = d.formatDashboardLabel('dragToReorderAria', {}, 'Drag to reorder');
        // Hidden from assistive tech rather than labelled: it is a plain div with
        // no role, no tab stop and nothing a key can do to it, so the label was
        // announced by nothing and only promised an affordance that is not there.
        // The keyboard route to the same result is Alt+↑/↓ on the row, which the
        // cheat sheet lists. The title stays — that is the mouse user's tooltip.
        reorderHandle.setAttribute('aria-hidden', 'true');
        reorderHandle.title = dragLabel;
        lead.appendChild(reorderHandle);

        if (d.settings.showIcons !== false) {
            const iconSlot = document.createElement('span');
            iconSlot.className = 'bookmark-icon-slot';
            lead.appendChild(iconSlot);

            const createLetterAvatar = () => {
                const letter = document.createElement('span');
                letter.className = 'bookmark-icon-letter';
                const label = this.bookmarkDisplayLabel(bookmark);
                letter.textContent = (label.charAt(0) || '?').toUpperCase();
                return letter;
            };

            if (bookmark.icon) {
                const placeholder = document.createElement('span');
                placeholder.className = 'icon-placeholder';
                iconSlot.appendChild(placeholder);

                const iconImg = document.createElement('img');
                iconImg.src = `/data/icons/${encodeURIComponent(bookmark.icon)}`;
                iconImg.className = 'bookmark-icon';
                iconImg.alt = '';
                iconImg.loading = 'lazy';
                // Off the main thread: one synchronous decode per favicon during
                // paint is visible jank on a page with hundreds of rows. The
                // preview card already does this.
                iconImg.decoding = 'async';
                iconImg.draggable = false;
                iconImg.addEventListener('load', () => placeholder.remove());
                iconImg.addEventListener('error', () => {
                    placeholder.remove();
                    iconImg.remove();
                    iconSlot.appendChild(createLetterAvatar());
                });
                iconSlot.appendChild(iconImg);
                const entry = window.ThemeIconStyling.getThemeIconStylingEntry(d.settings);
                if (entry.enabled) {
                    window.ThemeIconStyling.applyThemeIconStylingToElement(iconSlot, entry);
                }
            } else {
                iconSlot.appendChild(createLetterAvatar());
            }
        }
        row.appendChild(lead);

        const openLink = document.createElement('a');
        openLink.className = 'bookmark-open';
        /* Anchors are natively draggable; left on, grabbing the row would start a
           useless "drag the URL" gesture instead of the DragReorder move. The whole
           row is the reorder handle (see initializeCategoryReorder), so the link
           itself must not be draggable. */
        openLink.draggable = false;
        const safeHref = d.safeBookmarkOpenHref(bookmark.url);
        openLink.href = safeHref || '#';
        openLink.id = this.bookmarkCellId(bookmark, bookmarkIndex, categoryId);
        openLink.setAttribute('role', 'gridcell');
        // Constant: the grid is one column wide. Stamped here so syncBookmarkGridA11y
        // does not have to find this element again on every render to rewrite them.
        openLink.setAttribute('aria-colindex', '1');
        openLink.setAttribute('aria-colcount', '1');
        /* Roving tabindex: only the arrow-selected row’s link is in tab order (see KeyboardNavigation). */
        openLink.tabIndex = -1;
        const displayLabel = this.bookmarkDisplayLabel(bookmark);
        const textSpan = document.createElement('span');
        textSpan.className = 'bookmark-text';
        textSpan.textContent = displayLabel;
        textSpan.title = this.bookmarkRowTitle(bookmark);
        openLink.appendChild(textSpan);

        this.ensureBookmarkOpenDelegation();

        if (d.settings.openInNewTab) {
            openLink.target = '_blank';
            openLink.rel = 'noopener noreferrer';
        }

        d.attachBookmarkPreviewBehavior(openLink, bookmark);

        row.appendChild(openLink);

        if (d.settings.showStatus && this.isChecked(bookmark) && d.settings.showPing) {
            const statusBadge = document.createElement('span');
            statusBadge.className = 'status-text bookmark-superscript-badge is-empty';
            statusBadge.setAttribute('aria-hidden', 'true');
            row.appendChild(statusBadge);
        }

        // Mark the mode on the row rather than deciding here how loud it should
        // be: `body[data-monitor-emphasis]` makes that call in CSS, so changing
        // the setting is a repaint instead of a re-render.
        if (bookmark?.monitor) {
            row.setAttribute('data-check-mode', 'monitor');
        } else {
            row.removeAttribute('data-check-mode');
        }

        const shortcutSpan = document.createElement('span');
        shortcutSpan.className = 'bookmark-shortcut';
        shortcutSpan.setAttribute('role', 'presentation');
        // Built whenever the bookmark has one, whatever the setting says. Which
        // of the three display modes is in force is a body attribute the CSS
        // reads, so switching modes repaints instead of re-rendering the grid --
        // the same reasoning as data-check-mode a few lines up.
        const shortcutText = bookmark.shortcut && String(bookmark.shortcut).trim()
            ? String(bookmark.shortcut).toUpperCase()
            : '';
        shortcutSpan.textContent = shortcutText;
        if (!shortcutText) {
            shortcutSpan.classList.add('is-empty');
            shortcutSpan.setAttribute('aria-hidden', 'true');
            delete openLink.dataset.shortcut;
        } else {
            shortcutSpan.dataset.shortcut = shortcutText;
            // Also on the name, which is what the "hover" mode draws it from.
            // That mode floats the label over the right end of the name and
            // must stop exactly where the name's column stops -- short of the
            // response time, which has a column of its own. Being a pseudo of
            // the name element makes that true by construction, where an
            // offset measured from the row's edge has to keep adding up the
            // padding, the gap and a column width, and would come apart the
            // first time one of the three changed.
            openLink.dataset.shortcut = shortcutText;
        }
        {
            // Announced whenever the bookmark has a shortcut, including under
            // "never". Hiding the label was always a decision about what the
            // grid looks like -- the shortcut itself keeps working in every
            // mode, so a screen reader that never sees the label is exactly the
            // one that needs to be told the shortcut is there.
            let linkLabel = this.bookmarkRowTooltip(bookmark);
            if (shortcutText) {
                const shortcutPrefix = d.language?.t('dashboard.shortcutAriaPrefix') || 'shortcut';
                linkLabel = `${linkLabel}, ${shortcutPrefix} ${shortcutText}`;
            }
            openLink.setAttribute('aria-label', linkLabel);
        }
        row.appendChild(shortcutSpan);

        const pinBadge = document.createElement('span');
        pinBadge.className = 'bookmark-pin-badge bookmark-superscript-badge';
        if (d.settings.showPinIcon === true && bookmark.pinned) {
            pinBadge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/></svg>';
            pinBadge.title = d.formatDashboardLabel('pinnedBookmarkTitle', {}, 'Pinned');
            pinBadge.setAttribute('aria-label', d.formatDashboardLabel('pinnedBookmarkAria', {}, 'Pinned bookmark'));
            pinBadge.setAttribute('role', 'img');
        } else {
            pinBadge.textContent = '';
            pinBadge.classList.add('is-empty');
            pinBadge.setAttribute('aria-hidden', 'true');
        }
        openLink.appendChild(pinBadge);

        const openCountBadge = document.createElement('span');
        openCountBadge.className = 'bookmark-open-count';
        const openCount = Number(bookmark.openCount || 0);
        if (openCount > 0) {
            openCountBadge.textContent = openCount >= 1000 ? `${Math.floor(openCount / 1000)}k` : String(openCount);
            const openCountLabel = openCount === 1
                ? d.formatDashboardLabel('openCountOnce', {}, 'Opened once')
                : d.formatDashboardLabel('openCountMany', { count: openCount }, `Opened ${openCount} times`);
            openCountBadge.title = openCountLabel;
            openCountBadge.setAttribute('aria-label', openCountLabel);
        } else {
            openCountBadge.classList.add('is-empty');
            openCountBadge.setAttribute('aria-hidden', 'true');
        }
        row.appendChild(openCountBadge);

        // What the page has published since this row was last opened. Quiet by
        // design: a count, no colour of its own, and absent entirely when there
        // is nothing new or when feed polling is off.
        const freshBadge = document.createElement('span');
        freshBadge.className = 'bookmark-fresh-badge bookmark-superscript-badge';
        const fresh = d.feeds?.freshFor(bookmark) || null;
        // A row whose page publishes but has nothing new, when the reader has
        // asked to see those: a dot rather than a number, because there is
        // nothing to count. Off by default — see feedsMarkQuiet.
        const quiet = !fresh && d.settings?.feedsMarkQuiet === true
            && d.feeds?.hasFeed?.(bookmark) === true;
        if (fresh) {
            const count = Number(fresh.newCount) || 0;
            freshBadge.textContent = count > 99 ? '99+' : String(count);
            const label = count === 1
                ? d.formatDashboardLabel('feedOneNew', {}, '1 new since you last opened this')
                : d.formatDashboardLabel('feedManyNew', { count }, `${count} new since you last opened this`);
            freshBadge.title = label;
            freshBadge.setAttribute('aria-label', label);
            freshBadge.setAttribute('role', 'img');
        } else if (quiet) {
            freshBadge.classList.add('is-quiet');
            freshBadge.textContent = '·';
            const label = d.formatDashboardLabel('feedQuietMark', {},
                'Publishes a feed — nothing new since you last opened this');
            freshBadge.title = label;
            freshBadge.setAttribute('aria-label', label);
            freshBadge.setAttribute('role', 'img');
        } else {
            freshBadge.classList.add('is-empty');
            freshBadge.setAttribute('aria-hidden', 'true');
        }
        openLink.appendChild(freshBadge);

        const noteBadge = document.createElement('span');
        noteBadge.className = 'bookmark-note-badge bookmark-superscript-badge';
        const hasNote = bookmark && String(bookmark.note || '').trim();
        if (d.settings.showNoteIcon !== false && hasNote) {
            const label = d.language?.t('bookmark.hasNote') || 'Has note';
            const noteText = String(bookmark.note || '').trim();
            const tooltipText = noteText.length > 200 ? noteText.slice(0, 200) + '…' : noteText;
            noteBadge.setAttribute('data-note-tooltip', tooltipText);
            noteBadge.setAttribute('role', 'img');
            noteBadge.setAttribute('aria-label', label);
            noteBadge.appendChild(d.createNoteBadgeSvg());
        } else {
            noteBadge.classList.add('is-empty');
            noteBadge.setAttribute('aria-hidden', 'true');
        }
        openLink.appendChild(noteBadge);

        // Tag chips, inside the link rather than as a grid column of their own:
        // the row is a subgrid whose columns line up across every category, so a
        // new column would shift every row on the page. Off by default — a row
        // with several tags is noticeably busier, and the whole point of the
        // grid is that it stays scannable.
        this.renderRowTags(row, openLink, bookmark);

        if (allowInlineEdit && bookmarkRef) {
            const ac = new AbortController();
            row._bookmarkLongPressAbort = ac;
            d.attachBookmarkRowLongPress(row, openLink, bookmarkRef, ac.signal);
        }
        this.restoreBookmarkRowStatus(row, bookmark);
        row.setAttribute('data-render-fp', this.bookmarkRenderFingerprint(bookmark));
    }


    bookmarkRenderFingerprint(bookmark) {
        if (!bookmark) {
            return '';
        }
        const d = this.dash;
        const showIcons = d?.settings?.showIcons !== false ? '1' : '0';
        const iconEntry = window.ThemeIconStyling
            ? window.ThemeIconStyling.getThemeIconStylingEntry(d.settings)
            : { enabled: false };
        const iconStylingKey = iconEntry.enabled
            ? `${iconEntry.style}:${iconEntry.intensity}`
            : 'off';
        return [
            bookmark.url || '',
            bookmark.name || '',
            bookmark.shortcut || '',
            bookmark.category || '',
            bookmark.icon || '',
            bookmark.pinned ? '1' : '0',
            // The mode, not just `checkStatus`: switching Periodic → Monitor
            // clears that flag and sets `monitor`, so a fingerprint reading one
            // flag stayed identical across the change and the incremental
            // renderer skipped the row — the new badge never appeared.
            window.CheckMode?.of?.(bookmark) || (bookmark.checkStatus ? 'periodic' : 'off'),
            String(bookmark.note || '').trim(),
            (bookmark.tags || []).join(','),
            String(bookmark.openCount || 0),
            // The count on the row is part of what was drawn, so a row whose
            // feed reported something new — or whose badge was cleared by
            // opening it — has to be redrawn by the incremental renderer.
            String(this.dash.feeds?.freshFor(bookmark)?.newCount || 0),
            this.dash.settings?.feedsMarkQuiet === true && this.dash.feeds?.hasFeed?.(bookmark) ? 'q' : '',
            showIcons,
            iconStylingKey,
        ].join('\u0001');
    }


    /**
     * The focused row's tags, as the same chip the inbox and Config rows use.
     *
     * Rendered into the link so the subgrid is untouched, and capped: past two
     * or three the chips stop being a glance and start being a second line of
     * text competing with the name.
     */
    renderRowTags(row, openLink, bookmark) {
        const d = this.dash;
        openLink.querySelector('.bookmark-tag-strip')?.remove();
        if (d.settings?.showRowTags !== true) return;

        const tags = (bookmark?.tags || [])
            .map((t) => String(t || '').trim())
            .filter(Boolean);
        if (!tags.length) return;

        const max = Number(d.settings?.rowTagsMax) || 2;
        const strip = document.createElement('span');
        strip.className = 'bookmark-tag-strip';
        strip.setAttribute('aria-hidden', 'true');   // the row's aria-label already names them
        tags.slice(0, max).forEach((tag) => {
            const chip = document.createElement('span');
            chip.className = 'bookmark-tag-chip';
            chip.textContent = tag;
            strip.appendChild(chip);
        });
        if (tags.length > max) {
            const more = document.createElement('span');
            more.className = 'bookmark-tag-chip bookmark-tag-chip--more';
            more.textContent = `+${tags.length - max}`;
            strip.appendChild(more);
        }
        openLink.appendChild(strip);
    }

    restoreBookmarkRowStatus(row, bookmark) {
        const d = this.dash;
        if (!d.statusMonitor || !d.settings.showStatus || !this.isChecked(bookmark) || !row) {
            return;
        }
        const cached = d.statusMonitor.getCachedStatus(bookmark.url);
        if (cached) {
            const pingText = d.settings.showPing && cached.ping ? `${cached.ping}ms` : '';
            d.statusMonitor.setBookmarkStatus(row, cached.status, pingText);
            return;
        }
        const persisted = d.statusMonitor.getPersistedStatus(bookmark);
        if (persisted) {
            d.statusMonitor.setBookmarkStatus(row, persisted, '');
            return;
        }
        // No cache yet (or URL changed): run a fresh check so status color returns without page refresh.
        d.statusMonitor.refreshBookmarkStatus(bookmark.url);
    }


    resolveBookmarkReference(bookmark) {
        const d = this.dash;
        if (!bookmark) {
            return null;
        }
        const bookmarkIndex = this.resolveBookmarkIndex(bookmark);
        if (bookmarkIndex >= 0 && d.bookmarks[bookmarkIndex]) {
            return {
                scope: 'current',
                index: bookmarkIndex,
                pageId: Number(d.currentPageId),
                bookmark: d.bookmarks[bookmarkIndex],
                original: { ...d.bookmarks[bookmarkIndex] }
            };
        }

        const sourcePageId = Number(bookmark.pageId || bookmark.pageID || 0);
        if (!Number.isFinite(sourcePageId) || sourcePageId <= 0) {
            return null;
        }
        return {
            scope: 'remote',
            pageId: sourcePageId,
            bookmark,
            original: { ...bookmark }
        };
    }


    isSameBookmarkReference(bookmarkRef, candidate) {
        const d = this.dash;
        if (!bookmarkRef || !candidate) {
            return false;
        }
        const refPageId = Number(bookmarkRef.pageId || d.currentPageId);
        const candidatePageId = Number(candidate.pageId || candidate.pageID || d.currentPageId);
        if (refPageId !== candidatePageId) {
            return false;
        }
        const original = bookmarkRef.original || {};
        const originalUrl = String(original.url || '').trim();
        const originalName = String(original.name || '').trim();
        const candidateUrl = String(candidate.url || '').trim();
        const candidateName = String(candidate.name || '').trim();
        return originalUrl === candidateUrl && originalName === candidateName;
    }


    syncEditedBookmarkAcrossCollections(bookmarkRef, previousUrl = '') {
        const d = this.dash;
        if (!bookmarkRef || !bookmarkRef.bookmark) {
            return;
        }
        const updated = bookmarkRef.bookmark;
        const updatedPageId = Number(bookmarkRef.pageId || d.currentPageId);
        const previousUrlTrimmed = String(previousUrl || '').trim();
        const updatedUrlTrimmed = String(updated.url || '').trim();

        const syncList = (list) => {
            if (!Array.isArray(list)) {
                return;
            }
            list.forEach((bookmark) => {
                if (!d._shouldSyncBookmarkMutation(bookmarkRef, bookmark, previousUrlTrimmed)) {
                    return;
                }
                d._applyBookmarkMutationFields(bookmark, updated);
            });
        };

        if (updatedPageId === Number(d.currentPageId)) {
            syncList(d.bookmarks);
        }
        syncList(d.allBookmarks);

        if (updatedUrlTrimmed && previousUrlTrimmed && updatedUrlTrimmed !== previousUrlTrimmed) {
            bookmarkRef.original.url = updated.url;
        }
        bookmarkRef.original.name = updated.name;
        bookmarkRef.original.shortcut = updated.shortcut;
        bookmarkRef.original.category = updated.category;
        bookmarkRef.original.note = updated.note || '';
        bookmarkRef.original.tags = Array.isArray(updated.tags) ? [...updated.tags] : [];
    }


    removeBookmarkFromAllBookmarks(bookmarkRef) {
        const d = this.dash;
        if (!bookmarkRef || !Array.isArray(d.allBookmarks)) {
            return;
        }
        const pageId = Number(bookmarkRef.pageId || d.currentPageId);
        for (let i = d.allBookmarks.length - 1; i >= 0; i -= 1) {
            const candidate = d.allBookmarks[i];
            const candidatePageId = Number(candidate?.pageId || candidate?.pageID || 0);
            if (candidatePageId !== pageId) {
                continue;
            }
            if (this.isSameBookmarkReference(bookmarkRef, candidate)) {
                d.allBookmarks.splice(i, 1);
            }
        }
    }


    /**
     * Drop a bookmark from every in-memory copy the dashboard holds, matched by
     * page and URL rather than by array index.
     *
     * The health view deletes through its own endpoint and hands back only a
     * pageId + URL — it has no live reference into d.bookmarks, and the index in
     * its (possibly minutes-old) report cannot be trusted to still point at the
     * same row. Matching on the URL is what lets a delete made in that view
     * reach the dashboard grid without a page reload.
     */
    removeBookmarkByUrl(pageId, url) {
        const d = this.dash;
        const key = String(url || '').trim();
        if (!key) return false;
        const pid = Number(pageId);
        let removed = false;

        const purge = (list) => {
            if (!Array.isArray(list)) return;
            for (let i = list.length - 1; i >= 0; i -= 1) {
                const candidate = list[i];
                const candidatePid = Number(candidate?.pageId ?? candidate?.pageID ?? d.currentPageId);
                if (Number.isFinite(pid) && candidatePid !== pid) continue;
                if (String(candidate?.url || '').trim() === key) {
                    list.splice(i, 1);
                    removed = true;
                }
            }
        };

        // Only touch d.bookmarks when it is the page being edited, so a delete on
        // another page does not disturb the current view's array.
        if (Number.isFinite(pid) && Number(d.currentPageId) === pid) {
            purge(d.bookmarks);
        }
        purge(d.allBookmarks);
        return removed;
    }

    restoreBookmarkInAllBookmarks(bookmark, pageId) {
        const d = this.dash;
        if (!bookmark || !Array.isArray(d.allBookmarks)) {
            return;
        }
        const pid = Number(pageId || d.currentPageId);
        const ref = {
            bookmark,
            pageId: pid,
            original: { ...bookmark },
            scope: 'current',
            index: -1
        };
        const exists = d.allBookmarks.some((candidate) => (
            d._shouldSyncBookmarkMutation(ref, candidate, String(bookmark.url || '').trim())
        ));
        if (!exists) {
            d.allBookmarks.push({ ...bookmark, pageId: pid });
        }
    }


    findBookmarkIndexByReference(list, bookmarkRef) {
        const original = bookmarkRef?.original || {};
        const originalUrl = String(original.url || '').trim();
        const originalName = String(original.name || '').trim();
        const originalShortcut = String(original.shortcut || '').trim().toUpperCase();
        const originalCategory = String(original.category || '').trim();

        let index = list.findIndex((bookmark) => {
            return String(bookmark?.url || '').trim() === originalUrl
                && String(bookmark?.name || '').trim() === originalName
                && String(bookmark?.shortcut || '').trim().toUpperCase() === originalShortcut
                && String(bookmark?.category || '').trim() === originalCategory;
        });
        if (index >= 0) return index;

        index = list.findIndex((bookmark) => {
            return String(bookmark?.url || '').trim() === originalUrl
                && String(bookmark?.name || '').trim() === originalName;
        });
        if (index >= 0) return index;

        return list.findIndex((bookmark) => String(bookmark?.url || '').trim() === originalUrl);
    }


    createBookmarkElement(bookmark, categoryId, allowInlineEdit = true) {
        const row = document.createElement('div');
        this.populateBookmarkRowView(row, bookmark, categoryId, allowInlineEdit);
        return row;
    }


    createRecentBookmarkElement(bookmark) {
        const d = this.dash;
        const link = document.createElement('a');
        const safeHref = d.safeBookmarkOpenHref(bookmark.url);
        link.href = safeHref || '#';
        link.className = 'bookmark-link recent-bookmark-link';

        const displayLabel = this.bookmarkDisplayLabel(bookmark);
        const textWrapper = document.createElement('span');
        textWrapper.className = 'bookmark-text recent-bookmark-text';
        textWrapper.textContent = displayLabel;
        // The meta line beside this shows the category, so the counts are new
        // information here — unlike the recent-opened modal, which prints its
        // own recency and open count on every row.
        textWrapper.title = this.bookmarkRowTitle(bookmark);
        link.appendChild(textWrapper);

        const meta = document.createElement('span');
        meta.className = 'bookmark-shortcut recent-bookmark-meta';
        meta.textContent = bookmark.category || d.configLabel('noCategory', 'No category');
        link.appendChild(meta);

        if (d.settings.openInNewTab) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }

        const recordOpen = () => d.recordBookmarkOpened(
            bookmark,
            this.resolveBookmarkIndex(bookmark)
        );
        link.addEventListener('click', (e) => {
            if (!safeHref) {
                e.preventDefault();
                return;
            }
            recordOpen();
        });
        link.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                if (!safeHref) {
                    e.preventDefault();
                    return;
                }
                recordOpen();
            }
        });

        return link;
    }

    static OPEN_TABS_CAP = 15;
    static OPEN_LAST_DEFAULT = 5;
    static RECENT_MODAL_DISPLAY_LIMIT = 10;


    syncBookmarkMetadataAcrossViews(updatedBookmark, pageId) {
        const d = this.dash;
        if (!updatedBookmark) {
            return;
        }

        const pid = Number(pageId);
        const key = this.canonicalBookmarkURLKey(updatedBookmark.url || '');
        if (!key) {
            return;
        }

        const count = updatedBookmark.openCount;
        const opened = updatedBookmark.lastOpened;

        if (pid === Number(d.currentPageId) && Array.isArray(d.bookmarks)) {
            d.bookmarks.forEach((bm) => {
                if (this.canonicalBookmarkURLKey(bm.url) === key) {
                    bm.openCount = count;
                    bm.lastOpened = opened;
                }
            });
        }

        if (Array.isArray(d.allBookmarks)) {
            d.allBookmarks.forEach((bm) => {
                const bmPageId = Number(bm.pageId || bm.pageID || 0);
                if (bmPageId !== pid) {
                    return;
                }
                if (this.canonicalBookmarkURLKey(bm.url) !== key) {
                    return;
                }
                bm.openCount = count;
                bm.lastOpened = opened;
            });
        }
    }




    syncBookmarkGridA11y() {
        const d = this.dash;
        const grid = this.getBookmarkGridElement();
        if (!grid || grid.getAttribute('role') !== 'grid') {
            return;
        }

        // Exactly one row has to be reachable by Tab. Every row is built with
        // tabIndex -1 for the roving tab stop, and KeyboardNavigation only hands
        // one of them a 0 once it has walked the grid — which it does on the
        // first arrow key, not on a render. So from the first paint until an
        // arrow key was pressed, Tab skipped the entire grid: fourteen bookmarks
        // and no way into them from the keyboard. This runs on every render, so
        // it is the one place that can promise it.
        const openLinks = [...grid.querySelectorAll('.bookmark-link a.bookmark-open')];
        if (openLinks.length && !openLinks.some((link) => link.tabIndex === 0)) {
            // The row the cursor is on when there is one, not simply the first:
            // a full render rebuilds every row at -1, and putting the stop back
            // on row 0 would walk the tab position away from where the user was
            // every time anything on the page changed. The `keyboard-selected`
            // class is no use here — KeyboardNavigation re-applies it after this
            // runs — but its index survives the render, and it re-syncs anyway
            // on its next update, so an off-by-one against a show-more toggle
            // corrects itself.
            const cursor = d.keyboardNavigation?.currentIndex ?? -1;
            const target = (cursor >= 0 && openLinks[cursor]) || openLinks[0];
            target.tabIndex = 0;
        }

        const rowgroups = grid.querySelectorAll('.category[role="rowgroup"]');
        let totalRows = 0;
        rowgroups.forEach((group) => {
            const rows = group.querySelectorAll('.bookmark-link[data-bookmark-url]');
            // aria-rowcount belongs to the grid, not to a rowgroup — the role
            // does not carry it, so a per-category count was written and then
            // ignored.
            group.removeAttribute('aria-rowcount');
            // aria-colindex/colcount are constant — one column, always — so they
            // are stamped once in populateBookmarkRowView instead. Setting them
            // here meant a querySelector per row on every render, every
            // incremental render, every tag-filter change and every keyboard
            // rebuild, to write the same two values back.
            //
            // The index counts through the whole grid rather than restarting per
            // category: it is read against the grid's aria-rowcount, so starting
            // over made the first row of every category "row 1 of 14".
            rows.forEach((row, idx) => {
                row.setAttribute('aria-rowindex', String(totalRows + idx + 1));
            });
            totalRows += rows.length;
        });

        grid.setAttribute('aria-rowcount', String(totalRows));
        const layoutCols = typeof d.getEffectiveColumnsPerRow === 'function'
            ? d.getEffectiveColumnsPerRow()
            : 1;
        grid.setAttribute('aria-colcount', String(Math.max(1, layoutCols)));
        grid.setAttribute(
            'aria-label',
            d.language?.t('dashboard.bookmarksGridLabel') || 'Bookmarks'
        );

        // Runs on every render, so it is where the live status line can notice
        // the grid changed size. It rewrites nothing when the text is the same.
        d.updateMiniStatusLine?.();
        this.syncBookmarkGridLegend(grid);
    }

    /**
     * The key legend under the grid.
     *
     * Health and inbox have carried one under their feed since they were built.
     * The dashboard had none, so the only way to learn the keys was the cheat
     * sheet behind `!` — but the dashboard is also the shortest view, and a
     * ten-entry legend under seven bookmarks reads as clutter rather than help.
     *
     * So it is off by default, four entries long, and even when switched on it
     * stays hidden until the keyboard is actually used: KeyboardNavigation
     * stamps data-grid-keys on <body> at the first cursor move and clears it
     * again on Enter, when the reader has arrived where they were going.
     *
     * Rebuilt only when the text changes: this runs on every render, and the
     * legend is constant unless the language does.
     */
    syncBookmarkGridLegend(grid) {
        const d = this.dash ?? this;
        const host = grid?.parentElement;
        if (!grid || !host || !window.KeyboardViewLegends) {
            return;
        }
        // Off unless asked for: on a dashboard with seven bookmarks the legend
        // was as tall as the grid above it, which is a manual, not a hint.
        if (d.settings?.showGridKeyLegend !== true) {
            host.querySelector(':scope > .dashboard-legend')?.remove();
            return;
        }
        const pairs = window.KeyboardViewLegends.toLegendPairs(
            window.KeyboardViewLegends.DASHBOARD_VIEW,
            (key, fallback) => d.formatDashboardLabel?.(key, {}, fallback) ?? fallback,
        );
        const html = pairs
            .map(([keys, label]) => `<span><kbd>${d.escapeHtml(keys)}</kbd> ${d.escapeHtml(label)}</span>`)
            .join('');
        let legend = host.querySelector(':scope > .dashboard-legend');
        if (!legend) {
            legend = document.createElement('p');
            legend.className = 'dashboard-legend';
            // Decorative twice over: every key is in the cheat sheet, and the
            // rows themselves announce what they do.
            legend.setAttribute('aria-hidden', 'true');
            grid.after(legend);
        }
        if (legend.dataset.rendered !== html) {
            legend.innerHTML = html;
            legend.dataset.rendered = html;
        }
    }

    /**
     * Same sort/filter as {@link getRecentBookmarks}, then drops rows without a URL.
     * Pass the same bookmark array you would pass to {@link getRecentBookmarks} (page-local:
     * `d.bookmarks`, not `d.allBookmarks`).
     */

    bookmarkCellId(bookmark, bookmarkIndex, categoryId) {
        const d = this.dash;
        const pageId = Number(d.currentPageId) || 0;
        const cat = String(categoryId ?? 'x').replace(/[^a-zA-Z0-9_-]/g, '') || 'x';
        if (bookmarkIndex >= 0) {
            return `bookmark-cell-p${pageId}-${cat}-i${bookmarkIndex}`;
        }
        const url = String(bookmark?.url || '').trim();
        const seed = url || String(bookmark?.name || 'bookmark');
        return `bookmark-cell-p${pageId}-${cat}-u${this._hashForA11yId(seed)}`;
    }


    _hashForA11yId(value) {
        const str = String(value || '');
        let hash = 0;
        for (let i = 0; i < str.length; i += 1) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(36) || '0';
    }


    getBookmarkGridElement() {
        const root = document.getElementById('dashboard-layout');
        if (!root) {
            return null;
        }
        return root.querySelector('.tag-filter-view-body[role="grid"]') || root;
    }


    showMovePopover(anchorEl, bookmark, bookmarkIndex) {
        const d = this.dash;
        if (d._movePopoverCleanup) {
            d._movePopoverCleanup();
            d._movePopoverCleanup = null;
            return;
        }
        this._closeDeletePopover();
        this._closeTagPopover();

        const t = (key, fallback) => {
            const val = d.language?.t ? d.language.t(key) : null;
            return (val && val !== key) ? val : fallback;
        };

        const realCategories = (d.categories || []).filter(c => !c.isSmartCollection);
        const otherPages = (d.pages || []).filter(p => String(p.id) !== String(d.currentPageId));

        const pop = document.createElement('div');
        pop.id = 'move-popover';
        pop.className = 'move-popover';
        pop.setAttribute('role', 'listbox');
        pop.setAttribute('aria-label', t('dashboard.movePopoverTitle', 'Move to…'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = t('dashboard.movePopoverTitle', 'Move to…');
        pop.appendChild(header);

        const currentCategoryIds = this.collectBookmarkCategoryIds([bookmark]);
        const currentHint = document.createElement('div');
        currentHint.className = 'move-popover-current-hint';
        currentHint.textContent = this.formatMovePopoverCurrentCategoriesHint(currentCategoryIds);
        pop.appendChild(currentHint);

        const items = [];

        if (realCategories.length > 0) {
            const catLabel = document.createElement('div');
            catLabel.className = 'move-popover-section-label';
            catLabel.textContent = t('dashboard.movePopoverCategorySection', 'Category');
            pop.appendChild(catLabel);

            realCategories.forEach(cat => {
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

            otherPages.forEach(page => {
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

        if (items.length === 0) return;

        document.body.appendChild(pop);
        this._positionActionPopoverBeside(pop, anchorEl);
        window.FocusTrapUtils?.syncDashboardInert?.();
        window.dashboardInstance?.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        const previousFocus = document.activeElement;
        let focusedIdx = items.findIndex(i => i.classList.contains('is-current'));
        if (focusedIdx < 0) focusedIdx = 0;

        const setFocus = (idx) => {
            this._focusActionPopoverItem(items, idx);
            focusedIdx = idx;
        };
        setFocus(focusedIdx);

        let unbindOutside = null;
        let unbindPosition = null;
        const close = () => {
            if (pop.parentNode) {
                pop.remove();
            }
            this._restoreActionPopoverFocus(previousFocus, anchorEl, bookmarkIndex);
            unbindPosition?.();
            unbindPosition = null;
            document.removeEventListener('keydown', onKey, true);
            unbindOutside?.();
            unbindOutside = null;
            if (d._movePopoverCleanup === close) {
                d._movePopoverCleanup = null;
            }
            window.FocusTrapUtils?.syncDashboardInert?.();
        };
        unbindPosition = this._attachActionPopoverPositioning(pop, anchorEl);
        d._movePopoverCleanup = close;

        const confirm = (item) => {
            const type = item.getAttribute('data-type');
            const id = item.getAttribute('data-id');
            if (type === 'category' && item.classList.contains('is-current')) {
                return;
            }
            close();
            if (type === 'category') {
                this._quickMoveToCategory(bookmark, id);
            } else if (type === 'page') {
                const bookmarkRef = { index: bookmarkIndex, scope: 'current' };
                d._moveBookmarkToPage(bookmarkRef, { ...bookmark }, Number(id), anchorEl);
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
        unbindOutside = this._bindActionPopoverOutsideClose(pop, close, { anchorEl });
        requestAnimationFrame(() => setFocus(focusedIdx));
    }


    showTagPopover(anchorEl, bookmark, bookmarkIndex) {
        const d = this.dash;
        if (d._tagPopoverCleanup) {
            d._tagPopoverCleanup();
            d._tagPopoverCleanup = null;
            return;
        }
        this._closeMovePopover();
        this._closeDeletePopover();

        const bookmarkRef = this.resolveBookmarkReference(bookmark);
        if (!bookmarkRef?.bookmark || !anchorEl) {
            return;
        }

        const t = (key, fallback) => {
            const val = d.language?.t ? d.language.t(key) : null;
            return (val && val !== key) ? val : fallback;
        };

        const pop = document.createElement('div');
        pop.id = 'tag-popover';
        pop.className = 'move-popover tag-popover';
        pop.setAttribute('role', 'listbox');
        pop.setAttribute('tabindex', '-1');
        pop.setAttribute('aria-activedescendant', '');
        pop.setAttribute('aria-label', t('dashboard.tagPopoverTitle', 'Tags…'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = t('dashboard.tagPopoverTitle', 'Tags…');
        pop.appendChild(header);

        const bookmarkName = String(bookmarkRef.bookmark.name || bookmarkRef.bookmark.url || '').trim();
        const nameHint = document.createElement('div');
        nameHint.className = 'move-popover-current-hint tag-popover-bookmark-name';
        nameHint.textContent = bookmarkName || '—';
        pop.appendChild(nameHint);

        const tagsHint = document.createElement('div');
        tagsHint.className = 'tag-popover-current-tags';
        pop.appendChild(tagsHint);

        const emptyHint = document.createElement('div');
        emptyHint.className = 'tag-popover-empty-hint';
        emptyHint.hidden = true;
        pop.appendChild(emptyHint);

        const items = [];
        const tagRows = this._collectRankedTagsForPopover(bookmarkRef.bookmark);

        if (tagRows.length > 0) {
            const sectionLabel = document.createElement('div');
            sectionLabel.className = 'move-popover-section-label';
            sectionLabel.textContent = t('dashboard.tagPopoverAllTagsSection', 'All tags');
            pop.appendChild(sectionLabel);

            tagRows.forEach(({ tag, count }) => {
                const item = document.createElement('div');
                item.className = 'move-popover-item';
                item.id = `tag-popover-opt-${tag.replace(/[^a-z0-9_-]/g, '-')}`;
                item.setAttribute('role', 'option');
                item.setAttribute('data-tag', tag);
                item.setAttribute('aria-selected', 'false');

                const check = document.createElement('span');
                check.className = 'move-popover-check';
                check.textContent = '';
                item.appendChild(check);

                const label = document.createElement('span');
                label.className = 'tag-popover-item-label';
                label.textContent = `#${tag}`;
                item.appendChild(label);

                if (count > 0) {
                    const meta = document.createElement('span');
                    meta.className = 'tag-popover-item-meta';
                    meta.textContent = count === 1
                        ? t('dashboard.tagPopoverCountOne', '1 bookmark')
                        : t('dashboard.tagPopoverCountMany', '{count} bookmarks').replace('{count}', String(count));
                    item.appendChild(meta);
                }

                pop.appendChild(item);
                items.push(item);
            });
        } else {
            emptyHint.hidden = false;
            emptyHint.textContent = t(
                'dashboard.tagPopoverLibraryEmpty',
                'No tags yet — add tags in config → bookmarks'
            );
        }

        document.body.appendChild(pop);
        this._positionActionPopoverBeside(pop, anchorEl);
        window.FocusTrapUtils?.syncDashboardInert?.();
        window.dashboardInstance?.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        const previousFocus = document.activeElement;
        let focusedIdx = 0;

        const bookmarkHasTag = (tag) => (bookmarkRef.bookmark.tags || [])
            .map((raw) => String(raw || '').trim().toLowerCase())
            .filter(Boolean)
            .includes(tag);

        const syncTagItemStates = () => {
            items.forEach((item) => {
                const tag = item.getAttribute('data-tag') || '';
                const onBookmark = bookmarkHasTag(tag);
                item.classList.toggle('is-current', onBookmark);
                item.setAttribute('aria-selected', String(onBookmark));
                const check = item.querySelector('.move-popover-check');
                if (check) {
                    check.textContent = onBookmark ? '✓' : '';
                }
            });
            this._renderTagPopoverCurrentTags(tagsHint, bookmarkRef.bookmark, t);
        };

        syncTagItemStates();

        const setFocus = (idx) => {
            if (!items.length) {
                pop.removeAttribute('aria-activedescendant');
                return;
            }
            focusedIdx = ((idx % items.length) + items.length) % items.length;
            const target = items[focusedIdx];
            items.forEach((el, i) => {
                el.classList.toggle('is-focused', i === focusedIdx);
            });
            pop.setAttribute('aria-activedescendant', target.id);
            target.scrollIntoView({ block: 'nearest' });
            pop.focus({ preventScroll: true });
        };

        const trapPopoverFocus = () => {
            const active = document.activeElement;
            if (active instanceof HTMLElement && !pop.contains(active)) {
                active.blur();
            }
            if (items.length > 0) {
                setFocus(focusedIdx);
            } else {
                pop.focus({ preventScroll: true });
            }
        };

        if (items.length > 0) {
            const firstCurrent = items.findIndex((item) => item.classList.contains('is-current'));
            focusedIdx = firstCurrent >= 0 ? firstCurrent : 0;
        }

        let unbindOutside = null;
        let unbindPosition = null;
        let toggleInFlight = false;

        const close = () => {
            if (pop.parentNode) {
                pop.remove();
            }
            this._restoreActionPopoverFocus(previousFocus, anchorEl, bookmarkIndex);
            unbindPosition?.();
            unbindPosition = null;
            document.removeEventListener('keydown', onKey, true);
            unbindOutside?.();
            unbindOutside = null;
            if (d._tagPopoverCleanup === close) {
                d._tagPopoverCleanup = null;
            }
            window.FocusTrapUtils?.syncDashboardInert?.();
        };
        unbindPosition = this._attachActionPopoverPositioning(pop, anchorEl);
        d._tagPopoverCleanup = close;

        const toggleTag = async (item, { advance = false } = {}) => {
            const tag = String(item?.getAttribute('data-tag') || '').trim().toLowerCase();
            if (!tag || toggleInFlight) {
                return false;
            }
            toggleInFlight = true;
            try {
                const ok = await this._quickToggleBookmarkTag(bookmarkRef, tag, anchorEl);
                if (ok) {
                    syncTagItemStates();
                    if (advance && items.length > 1) {
                        setFocus(focusedIdx + 1);
                    } else {
                        trapPopoverFocus();
                    }
                }
                return ok;
            } finally {
                toggleInFlight = false;
            }
        };

        const onKey = (e) => {
            if (!document.getElementById('tag-popover')) {
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                close();
                return;
            }
            if (!items.length) {
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopImmediatePropagation();
                setFocus(focusedIdx + 1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopImmediatePropagation();
                setFocus(focusedIdx - 1);
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (items[focusedIdx]) {
                    void toggleTag(items[focusedIdx], { advance: true });
                }
            }
        };

        items.forEach((item, idx) => {
            item.addEventListener('mouseenter', () => setFocus(idx));
            item.addEventListener('click', (e) => {
                e.preventDefault();
                void toggleTag(item, { advance: false });
            });
        });

        // Document capture only. A second capture listener on the popover never
        // ran: document is the outer node, so it handles the key first and every
        // branch of onKey calls stopImmediatePropagation.
        document.addEventListener('keydown', onKey, true);
        trapPopoverFocus();
        unbindOutside = this._bindActionPopoverOutsideClose(pop, close, { anchorEl });
        requestAnimationFrame(() => {
            trapPopoverFocus();
            requestAnimationFrame(() => trapPopoverFocus());
        });
    }


    showDeletePopover(anchorEl, bookmark, bookmarkIndex) {
        const d = this.dash;
        if (d._deletePopoverCleanup) {
            d._deletePopoverCleanup();
            d._deletePopoverCleanup = null;
            return;
        }
        this._closeMovePopover();
        this._closeTagPopover();

        const bookmarkRef = typeof this.resolveBookmarkReference === 'function'
            ? this.resolveBookmarkReference(bookmark)
            : null;
        if (!bookmarkRef?.bookmark || !anchorEl) {
            return;
        }

        const t = (key, fallback) => {
            const val = d.language?.t ? d.language.t(key) : null;
            return (val && val !== key) ? val : fallback;
        };

        const pop = document.createElement('div');
        pop.id = 'delete-popover';
        pop.className = 'move-popover delete-popover';
        pop.setAttribute('role', 'listbox');
        pop.setAttribute('aria-label', t('dashboard.deletePopoverTitle', 'Delete bookmark'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = t('dashboard.deletePopoverTitle', 'Delete bookmark');
        pop.appendChild(header);

        const currentHint = document.createElement('div');
        currentHint.className = 'move-popover-current-hint';
        const bookmarkName = String(bookmarkRef.bookmark.name || bookmarkRef.bookmark.url || '').trim();
        currentHint.textContent = d.formatDashboardLabel(
            'deletePopoverBookmarkHint',
            { name: bookmarkName || '—' },
            `"${bookmarkName || '—'}"`
        );
        pop.appendChild(currentHint);

        const items = [];
        const makeItem = (action, label, { danger = false } = {}) => {
            const item = document.createElement('div');
            item.className = 'move-popover-item' + (danger ? ' is-danger' : '');
            item.setAttribute('role', 'option');
            item.setAttribute('data-action', action);
            item.setAttribute('aria-selected', 'false');

            const check = document.createElement('span');
            check.className = 'move-popover-check';
            check.textContent = danger ? '✕' : '';
            item.appendChild(check);

            const text = document.createElement('span');
            text.textContent = label;
            item.appendChild(text);

            pop.appendChild(item);
            items.push(item);
            return item;
        };

        makeItem('confirm', t('dashboard.deletePopoverConfirm', 'Delete'), { danger: true });
        makeItem('cancel', t('dashboard.deletePopoverCancel', 'Cancel'));

        document.body.appendChild(pop);
        this._positionActionPopoverBeside(pop, anchorEl);
        window.FocusTrapUtils?.syncDashboardInert?.();
        window.dashboardInstance?.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        const previousFocus = document.activeElement;
        let focusedIdx = 0;
        const setFocus = (idx) => {
            this._focusActionPopoverItem(items, idx, { syncAriaSelected: true });
            focusedIdx = idx;
        };
        setFocus(focusedIdx);

        let unbindOutside = null;
        let unbindPosition = null;
        const close = () => {
            if (pop.parentNode) {
                pop.remove();
            }
            this._restoreActionPopoverFocus(previousFocus, anchorEl, bookmarkIndex);
            unbindPosition?.();
            unbindPosition = null;
            document.removeEventListener('keydown', onKey, true);
            unbindOutside?.();
            unbindOutside = null;
            if (d._deletePopoverCleanup === close) {
                d._deletePopoverCleanup = null;
            }
            window.FocusTrapUtils?.syncDashboardInert?.();
        };
        unbindPosition = this._attachActionPopoverPositioning(pop, anchorEl);
        d._deletePopoverCleanup = close;

        const confirm = (item) => {
            const action = item.getAttribute('data-action');
            if (action === 'cancel') {
                close();
                return;
            }
            if (action !== 'confirm') {
                return;
            }
            close();
            const ref = bookmarkRef.scope === 'current' && Number.isInteger(bookmarkIndex) && bookmarkIndex >= 0
                ? { ...bookmarkRef, index: bookmarkIndex, scope: 'current' }
                : bookmarkRef;
            void d.deleteBookmarkInline(ref, { skipConfirm: true });
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
        unbindOutside = this._bindActionPopoverOutsideClose(pop, close, { anchorEl });
        requestAnimationFrame(() => setFocus(focusedIdx));
    }


    _quickMoveToCategory(bookmark, categoryId) {
        const ref = this.resolveBookmarkReference(bookmark);
        if (!ref) {
            return;
        }
        this.applyBookmarkCategoryMove(ref, categoryId);
    }


    _quickToggleBookmarkTag(bookmarkRef, tagName, anchorEl) {
        const d = this.dash;
        const tag = String(tagName || '').trim().toLowerCase();
        if (!tag || !bookmarkRef?.bookmark) {
            return Promise.resolve(false);
        }

        const bookmark = bookmarkRef.bookmark;
        const tags = (Array.isArray(bookmark.tags) ? bookmark.tags : [])
            .map((raw) => String(raw || '').trim().toLowerCase())
            .filter(Boolean);
        const idx = tags.indexOf(tag);
        const previousTags = [...tags];
        const newTags = idx >= 0 ? tags.filter((t) => t !== tag) : [...tags, tag];
        const pageId = Number(bookmarkRef.pageId || d.currentPageId);

        if (bookmarkRef.scope === 'current') {
            d.inlineEdit?.ensureBookmarkMutationSnapshot?.();
        }

        const applyTags = (tagList) => {
            bookmark.tags = [...tagList];
            if (bookmarkRef.original) {
                bookmarkRef.original.tags = [...tagList];
            }
            d.syncEditedBookmarkAcrossCollections(bookmarkRef, String(bookmark.url || '').trim());
            if (anchorEl instanceof HTMLElement) {
                if (tagList.length) {
                    anchorEl.setAttribute('data-bookmark-tags', tagList.join(','));
                } else {
                    anchorEl.removeAttribute('data-bookmark-tags');
                }
            }
        };

        applyTags(newTags);

        const persist = (async () => {
            if (bookmarkRef.scope === 'current') {
                return d.saveBookmarkOrder({ pageId });
            }
            const inlineEdit = d.inlineEdit;
            if (inlineEdit?.saveRemoteBookmarkEdit) {
                return inlineEdit.saveRemoteBookmarkEdit(bookmarkRef, {
                    ...bookmark,
                    tags: newTags,
                });
            }
            return false;
        })();

        return persist
            .then((ok) => {
                if (ok) {
                    void d.data?.fetchAndStoreDataRevision?.();
                    d.renderDashboard({ incremental: false });
                    return true;
                }
                applyTags(previousTags);
                if (bookmarkRef.scope === 'current') {
                    d.pendingReorderSnapshot = null;
                }
                return false;
            })
            .catch(() => {
                applyTags(previousTags);
                if (bookmarkRef.scope === 'current') {
                    d.pendingReorderSnapshot = null;
                }
                return false;
            });
    }


    _collectRankedTagsForPopover(bookmark) {
        const d = this.dash;
        const counts = new Map();
        const pool = Array.isArray(d.allBookmarks) && d.allBookmarks.length
            ? d.allBookmarks
            : (d.bookmarks || []);
        for (const entry of pool) {
            for (const raw of entry?.tags || []) {
                const tag = String(raw || '').trim().toLowerCase();
                if (!tag) continue;
                counts.set(tag, (counts.get(tag) || 0) + 1);
            }
        }
        for (const raw of bookmark?.tags || []) {
            const tag = String(raw || '').trim().toLowerCase();
            if (!tag) continue;
            if (!counts.has(tag)) {
                counts.set(tag, 0);
            }
        }
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag, count]) => ({ tag, count }));
    }


    _renderTagPopoverCurrentTags(container, bookmark, t) {
        const tags = (Array.isArray(bookmark?.tags) ? bookmark.tags : [])
            .map((raw) => String(raw || '').trim().toLowerCase())
            .filter(Boolean);
        container.replaceChildren();
        const label = document.createElement('span');
        label.className = 'tag-popover-current-tags-label';
        label.textContent = t('dashboard.tagPopoverCurrentTags', 'On this bookmark:');
        container.appendChild(label);
        if (!tags.length) {
            const none = document.createElement('span');
            none.className = 'tag-popover-current-tags-none';
            none.textContent = t('dashboard.tagPopoverNoTags', 'none');
            container.appendChild(none);
            return;
        }
        tags.forEach((tag) => {
            const chip = document.createElement('span');
            chip.className = 'bookmark-tag-chip tag-popover-current-chip';
            chip.textContent = `#${tag}`;
            container.appendChild(chip);
        });
    }


    _closeMovePopover() {
        const d = this.dash;
        if (d._movePopoverCleanup) {
            d._movePopoverCleanup();
            d._movePopoverCleanup = null;
        }
    }


    _closeDeletePopover() {
        const d = this.dash;
        if (d._deletePopoverCleanup) {
            d._deletePopoverCleanup();
            d._deletePopoverCleanup = null;
        }
    }


    _closeTagPopover() {
        const d = this.dash;
        if (d._tagPopoverCleanup) {
            d._tagPopoverCleanup();
            d._tagPopoverCleanup = null;
        }
    }


    _closeActionPopovers() {
        this._closeMovePopover();
        this._closeDeletePopover();
        this._closeTagPopover();
    }


    _positionActionPopoverBeside(pop, anchorEl) {
        if (!(pop instanceof HTMLElement) || !(anchorEl instanceof HTMLElement)) {
            return;
        }
        const rect = anchorEl.getBoundingClientRect();
        if (rect.width < 1 && rect.height < 1) {
            return;
        }
        const popW = pop.offsetWidth || 220;
        const popH = pop.offsetHeight || 120;
        const placement = window.DashboardPromoPlacement?.positionBesideAnchor(rect, popW, popH)
            || { left: rect.right + 8, top: rect.top, width: popW };
        pop.style.left = `${Math.round(placement.left)}px`;
        pop.style.top = `${Math.round(placement.top)}px`;
    }


    _attachActionPopoverPositioning(pop, anchorEl) {
        this._positionActionPopoverBeside(pop, anchorEl);
        // One reposition per frame. Scroll fires far faster than the popover can
        // move, and each run reads offsetWidth/offsetHeight and then writes two
        // styles — a forced reflow per event for as long as a popover is open.
        let rafId = 0;
        const reposition = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                this._positionActionPopoverBeside(pop, anchorEl);
            });
        };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };
    }


    /**
     * Close a popover when the next pointer gesture lands outside it.
     *
     * Bound on the next tick, or the very click that opened the popover closes
     * it again. `contextmenu` as well as `click`, because a right-click
     * elsewhere opens the native menu without ever producing a click — the row
     * popovers used to stay open behind it, which the bookmark context menu had
     * already fixed for itself.
     *
     * @returns {() => void} unbind
     */
    _bindActionPopoverOutsideClose(pop, close, { anchorEl = null } = {}) {
        let handler = null;
        const timer = setTimeout(() => {
            handler = (e) => {
                if (pop.contains(e.target)) return;
                // The anchor's own gesture is what toggles the popover; letting
                // this handler see it too would close and reopen in one click.
                if (anchorEl && (e.target === anchorEl || anchorEl.contains(e.target))) return;
                close();
            };
            document.addEventListener('click', handler, true);
            document.addEventListener('contextmenu', handler, true);
        }, 0);

        return () => {
            clearTimeout(timer);
            if (!handler) return;
            document.removeEventListener('click', handler, true);
            document.removeEventListener('contextmenu', handler, true);
            handler = null;
        };
    }


    /**
     * Move the highlight to one item of a popover.
     *
     * Two patterns, picked by the container's role, because the two ARIA
     * widgets disagree about where focus belongs:
     *
     *  - `role="listbox"`: focus stays on the box and `aria-activedescendant`
     *    names the active option. Individually focusing options is what a
     *    listbox is specifically not supposed to do, and the tag popover was
     *    already doing it the right way while Move, Delete and the tag-filter
     *    move popover — the same surface, to a user — did not.
     *  - anything else (the context menus, `role="menu"`): roving tabindex on
     *    the item itself, which is the convention there.
     */
    _focusActionPopoverItem(items, idx, { syncAriaSelected = false } = {}) {
        const target = items[idx];
        const listbox = target?.closest?.('[role="listbox"]') || null;

        items.forEach((el, i) => {
            el.classList.toggle('is-focused', i === idx);
            el.tabIndex = listbox ? -1 : (i === idx ? 0 : -1);
            if (syncAriaSelected) {
                el.setAttribute('aria-selected', String(i === idx));
            }
        });

        if (!target) {
            listbox?.removeAttribute('aria-activedescendant');
            return;
        }
        target.scrollIntoView({ block: 'nearest' });

        if (!listbox) {
            target.focus({ preventScroll: true });
            return;
        }
        if (!target.id) {
            target.id = `action-popover-opt-${idx}-${Math.random().toString(36).slice(2, 8)}`;
        }
        listbox.setAttribute('aria-activedescendant', target.id);
        if (!listbox.hasAttribute('tabindex')) {
            listbox.tabIndex = -1;
        }
        listbox.focus({ preventScroll: true });
    }


    /**
     * Replay a one-shot row animation.
     *
     * The remove/reflow/add dance is needed to restart an animation that may
     * already be running — clicking the same bookmark twice, copying twice — and
     * it was written out by hand in five places. The forced reflow is the point,
     * not an oversight: without it the browser coalesces the class removal and
     * addition and nothing replays.
     *
     * The listener removes the class again, which is why reduced motion collapses
     * these to 0.01ms rather than `animation: none` (see dashboard.css): an
     * animation that never starts fires no `animationend`, and the class would
     * stay on the row for the rest of the session.
     */
    /**
     * One click/auxclick pair for the whole grid instead of two per row.
     *
     * Everything the per-row handlers closed over is recoverable from the row
     * itself — the link's href is already the sanitised one, and the bookmark
     * resolves the way every other row-driven action resolves it. Bound once on
     * #dashboard-layout, which outlives every repaint, so rows carry no click
     * listeners of their own at all.
     */
    ensureBookmarkOpenDelegation() {
        const d = this.dash;
        const grid = document.getElementById('dashboard-layout');
        if (!grid || grid.dataset.bookmarkOpenDelegated === '1') {
            return;
        }
        grid.dataset.bookmarkOpenDelegated = '1';

        const resolve = (e) => {
            const link = e.target instanceof Element
                ? e.target.closest('a.bookmark-open')
                : null;
            if (!link || !grid.contains(link)) return null;
            const row = link.closest('.bookmark-link');
            if (!row) return null;
            // '#' is what populateBookmarkRowView writes when the URL did not
            // survive sanitising, so it means "nothing safe to open".
            const rawHref = link.getAttribute('href');
            return { link, row, safeHref: rawHref && rawHref !== '#' ? link.href : '' };
        };

        const recordOpen = (row) => {
            const bookmark = d.multiSelect?.bookmarkForRow?.(row);
            if (!bookmark) return;
            const index = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
            d.recordBookmarkOpened(bookmark, index >= 0 ? index : undefined);
        };

        grid.addEventListener('click', (e) => {
            const hit = resolve(e);
            if (!hit) return;
            const { row, safeHref } = hit;

            const multi = d.multiSelect;

            // Cmd+click on a Mac, Ctrl+click everywhere else: the browser's own
            // "open in a new tab", and a gesture people use without thinking.
            // This used to tick the row instead, with preventDefault — so the
            // one modifier every link on the web honours did the opposite of
            // what it does everywhere else, and on a Mac Ctrl+click opened our
            // row menu on top of it, since that is the platform's secondary
            // click. The open is recorded here, because letting the default
            // through means the anchor's own handler never runs.
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
                if (!safeHref) {
                    e.preventDefault();
                    return;
                }
                recordOpen(row);
                return;
            }

            // Alt+click ticks a row, Shift+click extends from the anchor. Alt
            // took over from Cmd/Ctrl: it is the one modifier no browser and
            // neither platform has already spoken for on a link.
            if (multi && (e.altKey || e.shiftKey)) {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                    multi.selectRange(row);
                } else {
                    multi.toggleRow(row);
                }
                return;
            }
            // A plain click with a selection open clears it rather than opening,
            // so a stray click cannot silently act on rows the user forgot were
            // ticked.
            if (multi?.isActive()) {
                e.preventDefault();
                e.stopPropagation();
                multi.clear();
                return;
            }
            if (!safeHref) {
                e.preventDefault();
                return;
            }
            recordOpen(row);
            if (grid.classList.contains('layout-launcher')) {
                this.restartRowAnimation(row, 'bookmark-pulse');
            }
            if (window.hyprMode && window.hyprMode.isEnabled()) {
                e.preventDefault();
                window.hyprMode.handleBookmarkClick(safeHref);
            }
        });

        grid.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            const hit = resolve(e);
            if (!hit) return;
            if (!hit.safeHref) {
                e.preventDefault();
                return;
            }
            recordOpen(hit.row);
            if (window.hyprMode && window.hyprMode.isEnabled()) {
                e.preventDefault();
                window.hyprMode.handleBookmarkClick(hit.safeHref);
            }
        });
    }


    restartRowAnimation(row, className) {
        if (!(row instanceof HTMLElement) || !className) {
            return;
        }
        row.classList.remove(className);
        void row.offsetWidth;
        row.classList.add(className);
        row.addEventListener('animationend', () => row.classList.remove(className), { once: true });
    }


    _restoreActionPopoverFocus(previousFocus, anchorEl, bookmarkIndex = -1) {
        const d = this.dash;
        const kn = d.keyboardNavigation || window.dashboardInstance?.keyboardNavigation;

        let row = anchorEl?.classList?.contains?.('bookmark-link')
            ? anchorEl
            : anchorEl?.closest?.('.bookmark-link:not(.bookmark-inline-editing)');
        if (!row?.isConnected && Number.isFinite(bookmarkIndex) && bookmarkIndex >= 0) {
            row = document.querySelector(`.bookmark-link[data-bookmark-index="${bookmarkIndex}"]`);
        }
        if (!row?.isConnected && anchorEl?.dataset?.bookmarkUrl) {
            const url = anchorEl.dataset.bookmarkUrl;
            row = document.querySelector(`.bookmark-link[data-bookmark-url="${CSS.escape(url)}"]`);
        }

        if (kn && typeof kn.selectBookmarkRow === 'function' && kn.selectBookmarkRow(row, { focus: true })) {
            return;
        }

        const restoreTarget = (previousFocus && previousFocus.isConnected)
            ? previousFocus
            : anchorEl;
        if (restoreTarget?.isConnected) {
            restoreTarget.focus({ preventScroll: true });
            return;
        }

        // Everything the popover was anchored to is gone — the usual cause is
        // the row itself having just been deleted. Focusing a detached element
        // is a no-op, which would leave focus on <body>: the next Tab starts
        // from the top of the page and arrow keys reach nothing. Hand it to the
        // first row still on the grid, or to the grid itself if the page is now
        // empty.
        const firstRow = document.querySelector('#dashboard-layout .bookmark-link a.bookmark-open');
        if (firstRow) {
            firstRow.tabIndex = 0;
            firstRow.focus({ preventScroll: true });
            return;
        }
        const grid = document.getElementById('dashboard-layout');
        if (grid) {
            if (!grid.hasAttribute('tabindex')) {
                grid.tabIndex = -1;
            }
            grid.focus({ preventScroll: true });
        }
    }

}

window.DashboardBookmarkRows = DashboardBookmarkRows;
