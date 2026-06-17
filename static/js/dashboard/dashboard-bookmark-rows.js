/**
 * Bookmark row DOM, moves, popovers, metadata sync.
 */
class DashboardBookmarkRows {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    applyBookmarkCategoryMove(bookmarkRefs, categoryId, { notify = true, count } = {}) {
        const d = this.dash;
        const refs = (Array.isArray(bookmarkRefs) ? bookmarkRefs : [bookmarkRefs])
            .map((entry) => (entry?.bookmark ? entry : this.resolveBookmarkReference(entry)))
            .filter((ref) => ref && ref.scope === 'current' && ref.bookmark);

        if (!refs.length) {
            return false;
        }

        const cat = (d.categories || []).find((item) => String(item.id) === String(categoryId));
        const catName = cat?.name || categoryId;
        const affectedCount = Number.isFinite(count) ? count : refs.length;

        d.ensureBookmarkMutationSnapshot();
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
            const duration = 2500;
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
                    { duration }
                );
            } else {
                d.showNotification(
                    d.formatDashboardLabel(
                        'movedToCategory',
                        { name: catName },
                        `Moved to "${catName}"`
                    ),
                    'success',
                    { duration }
                );
            }
        }

        return true;
    }


    updateBookmarkRowsCategoryInDom(refs, categoryId) {
        const d = this.dash;
        const normalizedCategoryId = String(categoryId ?? '');
        (refs || []).forEach((ref) => {
            const bookmark = ref?.bookmark;
            if (!bookmark) {
                return;
            }

            let row = null;
            if (ref.scope === 'current' && Number.isInteger(ref.index) && ref.index >= 0) {
                row = document.querySelector(`[data-bookmark-index="${ref.index}"]`);
            }
            if (!row && bookmark.url) {
                const url = String(bookmark.url).trim();
                row = document.querySelector(`.bookmark-link[data-bookmark-url="${CSS.escape(url)}"]`);
            }
            if (row) {
                row.setAttribute('data-category-id', normalizedCategoryId);
            }
        });
    }


    reparentBookmarkRowsInDom(refs, categoryId) {
        const d = this.dash;
        const normalizedCategoryId = String(categoryId ?? '');
        const targetList = document.querySelector(
            `.bookmarks-list[data-category-id="${CSS.escape(normalizedCategoryId)}"]`
        );
        if (!targetList) {
            this.updateBookmarkRowsCategoryInDom(refs, categoryId);
            return false;
        }

        let moved = 0;
        (refs || []).forEach((ref) => {
            const bookmark = ref?.bookmark;
            if (!bookmark) {
                return;
            }

            let row = null;
            if (ref.scope === 'current' && Number.isInteger(ref.index) && ref.index >= 0) {
                row = document.querySelector(`[data-bookmark-index="${ref.index}"]`);
            }
            if (!row && bookmark.url) {
                const url = String(bookmark.url).trim();
                row = document.querySelector(`.bookmark-link[data-bookmark-url="${CSS.escape(url)}"]`);
            }
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
        const d = this.dash;
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
        const d = this.dash;
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
        const d = this.dash;
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
        return d.bookmarks.findIndex((b) => this.canonicalBookmarkURLKey(b.url) === key);
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

        const lead = document.createElement('div');
        lead.className = 'bookmark-lead';
        lead.setAttribute('role', 'presentation');
        const reorderHandle = document.createElement('div');
        reorderHandle.className = 'bookmark-reorder-handle';
        const dragLabel = d.formatDashboardLabel('dragToReorderAria', {}, 'Drag to reorder');
        reorderHandle.setAttribute('aria-label', dragLabel);
        reorderHandle.title = dragLabel;
        lead.appendChild(reorderHandle);

        if (d.settings.showIcons !== false) {
            const iconSlot = document.createElement('span');
            iconSlot.className = 'bookmark-icon-slot';
            lead.appendChild(iconSlot);

            const createLetterAvatar = () => {
                const letter = document.createElement('span');
                letter.className = 'bookmark-icon-letter';
                letter.textContent = (bookmark.name || '?').charAt(0);
                return letter;
            };

            if (bookmark.icon) {
                const placeholder = document.createElement('span');
                placeholder.className = 'icon-placeholder';
                iconSlot.appendChild(placeholder);

                const iconImg = document.createElement('img');
                iconImg.src = `/data/icons/${bookmark.icon}`;
                iconImg.className = 'bookmark-icon';
                iconImg.alt = '';
                iconImg.loading = 'lazy';
                iconImg.draggable = false;
                iconImg.addEventListener('load', () => placeholder.remove());
                iconImg.addEventListener('error', () => {
                    placeholder.remove();
                    iconImg.remove();
                    iconSlot.appendChild(createLetterAvatar());
                });
                iconSlot.appendChild(iconImg);
                try {
                    const currentTheme = document.documentElement.getAttribute('data-theme') || d.settings.theme || 'default';
                    const entry = (d.settings.themeIconStyling && d.settings.themeIconStyling[currentTheme]) || { enabled: false };
                    if (entry.enabled) {
                        iconSlot.classList.add('icon-themed', `icon-themed--${entry.style || 'muted'}`);
                        iconSlot.style.setProperty('--icon-theme-intensity', String(entry.intensity || 0.5));
                    }
                } catch (e) {
                    // ignore
                }
            } else {
                iconSlot.appendChild(createLetterAvatar());
            }
        }
        row.appendChild(lead);

        const openLink = document.createElement('a');
        openLink.className = 'bookmark-open';
        const safeHref = d.safeBookmarkOpenHref(bookmark.url);
        openLink.href = safeHref || '#';
        openLink.id = this.bookmarkCellId(bookmark, bookmarkIndex, categoryId);
        openLink.setAttribute('role', 'gridcell');
        /* Roving tabindex: only the arrow-selected row’s link is in tab order (see KeyboardNavigation). */
        openLink.tabIndex = -1;
        const textSpan = document.createElement('span');
        textSpan.className = 'bookmark-text';
        textSpan.textContent = bookmark.name || '';
        if (bookmark.name) textSpan.title = bookmark.name;
        openLink.appendChild(textSpan);

        const recordOpen = () => d.recordBookmarkOpened(
            bookmark,
            bookmarkIndex >= 0 ? bookmarkIndex : undefined
        );
        openLink.addEventListener('click', (e) => {
            if (!safeHref) {
                e.preventDefault();
                return;
            }
            recordOpen();
            if (document.getElementById('dashboard-layout')?.classList.contains('layout-launcher')) {
                row.classList.remove('bookmark-pulse');
                void row.offsetWidth; // force reflow so re-clicking restarts the animation
                row.classList.add('bookmark-pulse');
                row.addEventListener('animationend', () => row.classList.remove('bookmark-pulse'), { once: true });
            }
            if (window.hyprMode && window.hyprMode.isEnabled()) {
                e.preventDefault();
                window.hyprMode.handleBookmarkClick(safeHref);
            }
        });
        openLink.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                if (!safeHref) {
                    e.preventDefault();
                    return;
                }
                recordOpen();
                if (window.hyprMode && window.hyprMode.isEnabled()) {
                    e.preventDefault();
                    window.hyprMode.handleBookmarkClick(safeHref);
                }
            }
        });

        if (d.settings.openInNewTab) {
            openLink.target = '_blank';
            openLink.rel = 'noopener noreferrer';
        }

        d.attachBookmarkPreviewBehavior(openLink, bookmark);

        row.appendChild(openLink);

        if (d.settings.showStatus && bookmark.checkStatus && d.settings.showPing) {
            const statusBadge = document.createElement('span');
            statusBadge.className = 'status-text bookmark-superscript-badge is-empty';
            statusBadge.setAttribute('aria-hidden', 'true');
            row.appendChild(statusBadge);
        }

        const shortcutSpan = document.createElement('span');
        shortcutSpan.className = 'bookmark-shortcut';
        shortcutSpan.setAttribute('role', 'presentation');
        const showShortcuts = d.settings.showShortcuts !== false;
        const shortcutText = showShortcuts && bookmark.shortcut && String(bookmark.shortcut).trim()
            ? String(bookmark.shortcut).toUpperCase()
            : '';
        shortcutSpan.textContent = shortcutText;
        if (!shortcutText) {
            shortcutSpan.classList.add('is-empty');
            shortcutSpan.setAttribute('aria-hidden', 'true');
        } else {
            shortcutSpan.dataset.shortcut = shortcutText;
        }
        {
            let linkLabel = bookmark.name || bookmark.url || d.bookmarkFallbackName();
            if (shortcutText) {
                const shortcutPrefix = d.language?.t('dashboard.shortcutAriaPrefix') || 'shortcut';
                linkLabel = `${linkLabel}, ${shortcutPrefix} ${shortcutText}`;
            }
            openLink.setAttribute('aria-label', linkLabel);
        }
        row.appendChild(shortcutSpan);

        const pinBadge = document.createElement('span');
        pinBadge.className = 'bookmark-pin-badge bookmark-superscript-badge';
        const showPinIcon = d.settings.showPinIcon === true;
        if (showPinIcon && bookmark.pinned) {
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

        const noteBadge = document.createElement('span');
        noteBadge.className = 'bookmark-note-badge bookmark-superscript-badge';
        const hasNote = bookmark && String(bookmark.note || '').trim();
        if (hasNote) {
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

        if (allowInlineEdit && bookmarkRef) {
            const ac = new AbortController();
            row._bookmarkLongPressAbort = ac;
            d.attachBookmarkRowLongPress(row, openLink, bookmarkRef, ac.signal);
        }
        this.restoreBookmarkRowStatus(row, bookmark);
    }


    restoreBookmarkRowStatus(row, bookmark) {
        const d = this.dash;
        if (!d.statusMonitor || !d.settings.showStatus || !bookmark?.checkStatus || !row) {
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
        const d = this.dash;
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
        const d = this.dash;
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

        const textWrapper = document.createElement('span');
        textWrapper.className = 'bookmark-text recent-bookmark-text';
        textWrapper.textContent = bookmark.name;
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


    syncAllBookmarksMetadata(updatedBookmark) {
        const d = this.dash;
        this.syncBookmarkMetadataAcrossViews(updatedBookmark, this.resolveBookmarkPageId(updatedBookmark));
    }


    syncBookmarkGridA11y() {
        const d = this.dash;
        const grid = this.getBookmarkGridElement();
        if (!grid || grid.getAttribute('role') !== 'grid') {
            return;
        }

        const rowgroups = grid.querySelectorAll('.category[role="rowgroup"]');
        let totalRows = 0;
        rowgroups.forEach((group) => {
            const rows = group.querySelectorAll('.bookmark-link[data-bookmark-url]');
            group.setAttribute('aria-rowcount', String(rows.length));
            rows.forEach((row, idx) => {
                row.setAttribute('aria-rowindex', String(idx + 1));
                const openLink = row.querySelector('a.bookmark-open');
                if (openLink) {
                    openLink.setAttribute('aria-colindex', '1');
                    openLink.setAttribute('aria-colcount', '1');
                }
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
        const d = this.dash;
        const str = String(value || '');
        let hash = 0;
        for (let i = 0; i < str.length; i += 1) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(36) || '0';
    }


    getBookmarkGridElement() {
        const d = this.dash;
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

        const previousFocus = document.activeElement;
        let focusedIdx = items.findIndex(i => i.classList.contains('is-current'));
        if (focusedIdx < 0) focusedIdx = 0;

        const setFocus = (idx) => {
            this._focusActionPopoverItem(items, idx);
            focusedIdx = idx;
        };
        setFocus(focusedIdx);

        let onOutside = null;
        let unbindPosition = null;
        const close = () => {
            if (pop.parentNode) {
                pop.remove();
            }
            if (window.DashboardFeaturePromos?.isPromoOpen?.('quickMove')) {
                window.DashboardFeaturePromos.dismissOpen();
            }
            this._restoreActionPopoverFocus(previousFocus, anchorEl);
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
        setTimeout(() => {
            onOutside = (e) => { if (!pop.contains(e.target)) close(); };
            document.addEventListener('click', onOutside);
        }, 0);
        window.DashboardFeaturePromos?.tryShow?.('quickMove', pop);
        requestAnimationFrame(() => setFocus(focusedIdx));
    }


    showDeletePopover(anchorEl, bookmark, bookmarkIndex) {
        const d = this.dash;
        if (d._deletePopoverCleanup) {
            d._deletePopoverCleanup();
            d._deletePopoverCleanup = null;
            return;
        }
        this._closeMovePopover();

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

        const previousFocus = document.activeElement;
        let focusedIdx = 0;
        const setFocus = (idx) => {
            this._focusActionPopoverItem(items, idx, { syncAriaSelected: true });
            focusedIdx = idx;
        };
        setFocus(focusedIdx);

        let onOutside = null;
        let unbindPosition = null;
        const close = () => {
            if (pop.parentNode) {
                pop.remove();
            }
            if (window.DashboardFeaturePromos?.isPromoOpen?.('quickDelete')) {
                window.DashboardFeaturePromos.dismissOpen();
            }
            this._restoreActionPopoverFocus(previousFocus, anchorEl);
            unbindPosition?.();
            unbindPosition = null;
            document.removeEventListener('keydown', onKey, true);
            if (onOutside) {
                document.removeEventListener('click', onOutside);
                onOutside = null;
            }
            if (d._deletePopoverCleanup === close) {
                d._deletePopoverCleanup = null;
            }
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
        setTimeout(() => {
            onOutside = (e) => { if (!pop.contains(e.target)) close(); };
            document.addEventListener('click', onOutside);
        }, 0);
        window.DashboardFeaturePromos?.tryShow?.('quickDelete', pop);
        requestAnimationFrame(() => setFocus(focusedIdx));
    }


    _quickMoveToCategory(bookmark, categoryId) {
        const d = this.dash;
        const ref = this.resolveBookmarkReference(bookmark);
        if (!ref) {
            return;
        }
        this.applyBookmarkCategoryMove(ref, categoryId);
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


    _closeActionPopovers() {
        const d = this.dash;
        this._closeMovePopover();
        this._closeDeletePopover();
    }


    _positionActionPopoverBeside(pop, anchorEl) {
        const d = this.dash;
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
        const d = this.dash;
        this._positionActionPopoverBeside(pop, anchorEl);
        const reposition = () => this._positionActionPopoverBeside(pop, anchorEl);
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        return () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };
    }


    _focusActionPopoverItem(items, idx, { syncAriaSelected = false } = {}) {
        const d = this.dash;
        items.forEach((el, i) => {
            el.classList.toggle('is-focused', i === idx);
            el.tabIndex = i === idx ? 0 : -1;
            if (syncAriaSelected) {
                el.setAttribute('aria-selected', String(i === idx));
            }
        });
        const target = items[idx];
        target?.scrollIntoView({ block: 'nearest' });
        target?.focus({ preventScroll: true });
    }


    _restoreActionPopoverFocus(previousFocus, anchorEl) {
        const d = this.dash;
        const restoreTarget = (previousFocus && previousFocus.isConnected)
            ? previousFocus
            : anchorEl;
        restoreTarget?.focus?.({ preventScroll: true });
    }

}

window.DashboardBookmarkRows = DashboardBookmarkRows;
