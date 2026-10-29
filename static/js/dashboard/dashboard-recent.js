/**
 * Recent bookmarks modal and open-tabs helpers.
 */
class DashboardRecent {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    getRecentBookmarksWithUrls(bookmarks, limit) {
        return this.getRecentBookmarks(bookmarks, limit).filter(
            (bookmark) => bookmark && String(bookmark.url || '').trim()
        );
    }


    sameBookmarkList(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        const key = (bookmark) => String(bookmark?.id ?? bookmark?.url ?? '');
        return a.every((item, index) => key(item) === key(b[index]));
    }


    buildOpenTabsPlans(bookmarks, labelKeys) {
        const d = this.dash;
        const list = (bookmarks || []).filter((b) => b && String(b.url || '').trim());
        if (list.length === 0) return [];

        const cap = DashboardBookmarkRows.OPEN_TABS_CAP;
        const n = list.length;
        if (n <= cap) {
            return [{
                label: d.formatDashboardLabel(labelKeys.all, { n }, `Open ${n}`),
                bookmarks: list,
            }];
        }
        return [
            {
                label: d.formatDashboardLabel(labelKeys.first, { cap, n }, `Open first ${cap} of ${n}`),
                bookmarks: list.slice(0, cap),
            },
            {
                label: d.formatDashboardLabel(labelKeys.all, { n }, `Open all ${n}`),
                bookmarks: list,
            },
        ];
    }


    openBookmarksInNewTabs(bookmarks) {
        (bookmarks || []).forEach((bookmark) => {
            const url = window.BookmarkUrlUtils?.safeHttpResourceUrl?.(bookmark?.url) || '';
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        });
    }


    safeHttpBookmarkHref(raw) {
        const d = this.dash;
        const href = window.BookmarkUrlUtils?.safeHttpResourceUrl?.(raw) || '';
        return href ? d.escapeHtml(href) : '#';
    }


    isRecentBookmarksModalOpen() {
        const overlay = document.getElementById('app-modal');
        const panel = overlay ? overlay.querySelector('.modal') : null;
        return Boolean(
            overlay &&
            panel &&
            overlay.classList.contains('show') &&
            panel.classList.contains('recent-bookmarks-modal')
        );
    }


    toggleRecentBookmarksModal() {
        const d = this.dash;
        if (!window.AppModal) return;
        if (d.isModalOpen() && !this.isRecentBookmarksModalOpen()) return;
        if (this.isRecentBookmarksModalOpen()) {
            window.AppModal.hide();
            return;
        }

        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        // Every opening starts on the newest page.
        this._recentPage = 0;

        const skeletonCount = 5;
        // aria-hidden on the rows keeps screen readers from reading placeholder
        // shapes, but on its own that left assistive tech announcing nothing at
        // all while it loaded — aria-busy on the container that hosts it says
        // "content is coming" instead of silence.
        const skeletonHtml = `<div class="recent-bookmarks-skeleton" aria-hidden="true">${
            Array.from({ length: skeletonCount }, () =>
                `<div class="recent-bookmarks-skeleton-row">
                    <span class="recent-bookmarks-skeleton-rank"></span>
                    <span class="recent-bookmarks-skeleton-body">
                        <span class="recent-bookmarks-skeleton-name"></span>
                        <span class="recent-bookmarks-skeleton-detail"></span>
                    </span>
                    <span class="recent-bookmarks-skeleton-stats">
                        <span class="recent-bookmarks-skeleton-recency"></span>
                        <span class="recent-bookmarks-skeleton-opens"></span>
                    </span>
                </div>`
            ).join('')
        }</div>`;

        /*
         * It hangs from the header, the way the pages panel does.
         *
         * Recents is opened from the bar in that band and answers a question
         * about the page under it -- what did I open last -- so it drops out of
         * the band rather than floating over a dimmed screen. The anchor is
         * measured at open time: the band's height is the reader's.
         */
        window.DashboardUiHelpers?.publishHeaderSheetAnchor?.();
        const grid = this.recentSheetIsGrid();

        window.AppModal.show({
            title: d.language.t('dashboard.recentBookmarksTitle') || 'Recent bookmarks',
            htmlMessage: skeletonHtml,
            confirmText: d.language.t('dashboard.close') || 'Close',
            showCancel: false,
            modalClass: `recent-bookmarks-modal header-sheet recents-sheet${grid ? ' is-grid' : ' is-compact'}`,
            onHide: () => {
                this._cleanupRecentModalKeyHandler();
            },
        });
        (document.getElementById('modal-text')
            || document.querySelector('.recent-bookmarks-modal .modal-body'))
            ?.setAttribute('aria-busy', 'true');

        /*
         * The header, in the same language as the other overlays: the name, the
         * key that opens it, and a way out on the right. AppModal renders a
         * bare title, so the chip is added once the panel is on screen.
         */
        const header = document.querySelector('.recent-bookmarks-modal .modal-header');
        if (header && !header.querySelector('.recent-bookmarks-modal-key')) {
            const chip = document.createElement('span');
            chip.className = 'recent-bookmarks-modal-key';
            chip.dataset.modalHeaderExtra = 'true';
            chip.setAttribute('aria-hidden', 'true');
            chip.textContent = '*';
            document.getElementById('modal-title')?.after(chip);

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'recent-bookmarks-modal-close';
            close.dataset.modalHeaderExtra = 'true';
            close.setAttribute('aria-label', d.language.t('dashboard.close') || 'Close');
            close.innerHTML = '<span aria-hidden="true">Esc</span> \u00D7';
            close.addEventListener('click', () => window.AppModal.hide());
            header.appendChild(close);
        }

        if (!d._bookmarksReady) {
            d._pendingRecentModalRefresh = true;
            return;
        }

        requestAnimationFrame(() => this._fillRecentBookmarksModal());
        /*
         * Every page's bookmarks, not only this one's: startup skips the
         * cross-page load when nothing asks for it, and the sheet does. Drawn
         * again when it lands, with what this page has meanwhile.
         */
        if (!d._unsortedLoaded && typeof d.loadAllBookmarks === 'function') {
            void Promise.resolve(d.loadAllBookmarks())
                .then(() => {
                    if (this.isRecentBookmarksModalOpen()) this._fillRecentBookmarksModal();
                })
                .catch(() => {});
        }
    }

    /**
     * What the sheet reads: this page from its own list, every other page from
     * the cross-page one -- the current page's rows are where an open lands
     * first, so they win over their copies there (as in the tag cloud's pool).
     */
    recentPool() {
        const d = this.dash;
        const current = Array.isArray(d.bookmarks) ? d.bookmarks : [];
        const currentId = Number(d.currentPageId);
        const others = (Array.isArray(d.allBookmarks) ? d.allBookmarks : [])
            .filter((bookmark) => Number(bookmark?.pageId ?? bookmark?.pageID) !== currentId);
        return [...current, ...others];
    }

    /** Ten to a page, the newest first; the page clamped to what there is. */
    recentPageOf(all) {
        const size = DashboardBookmarkRows.RECENT_MODAL_DISPLAY_LIMIT;
        const pages = Math.max(1, Math.ceil(all.length / size));
        const page = Math.min(Math.max(0, Number(this._recentPage) || 0), pages - 1);
        this._recentPage = page;
        return { page, pages, size, shown: all.slice(page * size, page * size + size) };
    }

    /** PgDn and ] go back in time, PgUp and [ forward; a page number goes there. */
    goToRecentPage(page) {
        const all = this.getRecentBookmarks(this.recentPool(), 0);
        const pages = Math.max(1, Math.ceil(all.length / DashboardBookmarkRows.RECENT_MODAL_DISPLAY_LIMIT));
        const next = Math.min(Math.max(0, page), pages - 1);
        if (next === this._recentPage) return false;
        this._recentPage = next;
        this._fillRecentBookmarksModal();
        return true;
    }


    /**
     * Past this many entries the sheet spans the page's column and lays the
     * rows out across it. Three: one full line of the widest layout, so the
     * fourth is the first that would leave a hole in it.
     */
    static SHEET_GRID_FROM = 3;

    recentSheetIsGrid() {
        const d = this.dash;
        if (!d?._bookmarksReady) return true;
        const shown = this.getRecentBookmarks(d.bookmarks, DashboardBookmarkRows.RECENT_MODAL_DISPLAY_LIMIT);
        return shown.length > DashboardRecent.SHEET_GRID_FROM;
    }

    /**
     * The shape follows what the list turned out to hold.
     *
     * The panel opens before the bookmarks are counted -- it shows a skeleton
     * while they load -- so the shape it opened with is a guess. Corrected
     * here, where the rows are known.
     */
    _syncRecentSheetShape(count) {
        const panel = document.querySelector('.recent-bookmarks-modal');
        if (!panel) return;
        const grid = count > DashboardRecent.SHEET_GRID_FROM;
        panel.classList.toggle('is-grid', grid);
        panel.classList.toggle('is-compact', !grid);
        panel.classList.toggle('is-empty', count === 0);
        panel.classList.toggle('is-single', count === 1);
    }

    _fillRecentBookmarksModal() {
        const d = this.dash;
        const panel = document.querySelector('.recent-bookmarks-modal');
        if (!panel) return;

        const contentEl = document.getElementById('modal-text') || panel.querySelector('.modal-body');
        if (!contentEl) return;

        const pool = this.recentPool();
        const allRecent = this.getRecentBookmarks(pool, 0);
        const { page, pages, size, shown: recentBookmarks } = this.recentPageOf(allRecent);
        const openInNewTab = d.settings.openInNewTab;
        const noRecentText = d.language.t('dashboard.noRecentBookmarks') || 'No recent bookmarks yet.';
        // The open buttons act on the page on screen; "the last N" is always the newest.
        const shownWithUrls = recentBookmarks.filter((bookmark) => bookmark && String(bookmark.url || '').trim());
        const lastWithUrls = this.getRecentBookmarksWithUrls(pool, DashboardBookmarkRows.OPEN_LAST_DEFAULT);
        // Dates in the app's language, not the browser's, as the stats do.
        const lang = d.settings?.language || undefined;
        // The bar under a tile: its opens against the most opened in the list.
        const mostOpens = Math.max(1, ...allRecent.map((bookmark) => Number(bookmark.openCount) || 0));

        const openPlans = [
            ...this.buildOpenTabsPlans(shownWithUrls, { all: 'recentOpenShown', first: 'recentOpenShownFirst' }),
        ];
        if (!this.sameBookmarkList(shownWithUrls, lastWithUrls)) {
            openPlans.push(...this.buildOpenTabsPlans(lastWithUrls, { all: 'recentOpenLast', first: 'recentOpenLastFirst' }));
        }

        const openToolbarHtml = openPlans.length > 0
            ? `<div class="recent-bookmarks-modal-toolbar" role="toolbar" aria-label="${d.escapeHtml(d.formatDashboardLabel('recentOpenToolbar', {}, 'Open recent bookmarks'))}">
                    <div class="recent-bookmarks-open-actions">
                        ${openPlans.map((plan, index) => `
                            <button type="button" class="recent-bookmarks-open-btn modal-button" data-open-plan="${index}">
                                <span class="modal-button-name">${d.escapeHtml(plan.label)}</span>
                            </button>
                        `).join('')}
                    </div>
                    <p class="recent-bookmarks-open-hint">${d.escapeHtml(d.formatDashboardLabel('recentOpenCommandHint', { n: DashboardBookmarkRows.OPEN_LAST_DEFAULT }, `:open last ${DashboardBookmarkRows.OPEN_LAST_DEFAULT} in command mode`))}</p>
                </div>`
            : '';

        const listHtml = recentBookmarks.length > 0
            ? `<div class="recent-bookmarks-modal-list">
                   ${recentBookmarks.map((bookmark, index) => {
                       const safeName = d.escapeHtml(bookmark.name || d.bookmarkFallbackName());
                       const safeUrl = this.safeHttpBookmarkHref(bookmark.url);
                       const safeDetail = d.escapeHtml(this.recentPlaceLabel(bookmark));
                       const opened = new Date(Number(bookmark.lastOpened) || 0);
                       const day = opened.toLocaleDateString(lang, { day: 'numeric' });
                       const month = opened.toLocaleDateString(lang, { month: 'short' }).replace(/\.$/, '');
                       const recency = d.escapeHtml(this.formatRecentMoment(bookmark.lastOpened));
                       const fullDate = d.escapeHtml(opened.toLocaleString(lang, { dateStyle: 'full', timeStyle: 'short' }));
                       const openCount = this.formatRecentOpenCount(bookmark.openCount);
                       const openCountHtml = openCount
                           ? `<span class="recent-bookmarks-modal-opens">${d.escapeHtml(openCount)}</span>`
                           : '';
                       const share = Math.round(((Number(bookmark.openCount) || 0) / mostOpens) * 100);
                       const target = openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : '';
                       // The key the reader would type, at the end of the name line.
                       const shortcut = String(bookmark.shortcut || '').toUpperCase();
                       return `<a class="recent-bookmarks-modal-item" href="${safeUrl}" data-recent-index="${index}" title="${fullDate}"${target}>
                                   <span class="recent-bookmarks-modal-date" aria-hidden="true"><b>${d.escapeHtml(day)}</b><small>${d.escapeHtml(month)}</small></span>
                                   <span class="recent-bookmarks-modal-main">
                                       <span class="recent-bookmarks-modal-top">
                                           ${this.recentIconHtml(bookmark)}
                                           <span class="recent-bookmarks-modal-name">${safeName}</span>
                                           <span class="recent-bookmarks-modal-shortcut" aria-hidden="true">${d.escapeHtml(shortcut)}</span>
                                       </span>
                                       <span class="recent-bookmarks-modal-meta">
                                           <span class="recent-bookmarks-modal-recency">${recency}</span>
                                           <span class="recent-bookmarks-modal-detail">${safeDetail}</span>
                                           ${openCountHtml}
                                       </span>
                                       <span class="recent-bookmarks-modal-bar" aria-hidden="true"><i style="width:${share}%"></i></span>
                                   </span>
                               </a>`;
                   }).join('')}
               </div>
               ${openToolbarHtml}
               <div class="recent-bookmarks-modal-foot">
                   ${pages > 1
                       ? this.recentPagerHtml(page, pages, size, allRecent.length)
                       : `<span>${d.escapeHtml(d.formatDashboardLabel('recentShowing', { n: recentBookmarks.length },
                           'Showing the last {n}'))}</span>`}
                   <span><span class="recent-bookmarks-modal-key">\u21B5</span> ${d.escapeHtml(
                       d.formatDashboardLabel('recentFootOpen', {}, 'open'))}</span>
               </div>`
            : `<div class="recent-bookmarks-empty">${d.escapeHtml(noRecentText)}</div>`;

        contentEl.innerHTML = listHtml;
        contentEl.setAttribute('aria-busy', 'false');
        this._syncRecentSheetShape(recentBookmarks.length);

        if (recentBookmarks.length > 0) {
            contentEl.querySelectorAll('.recent-bookmarks-modal-item[data-recent-index]').forEach((item) => {
                item.addEventListener('click', (e) => {
                    const index = parseInt(e.currentTarget.getAttribute('data-recent-index'), 10);
                    const bookmark = !Number.isNaN(index) ? recentBookmarks[index] : null;
                    if (bookmark) {
                        this.recordBookmarkOpened(bookmark, d.resolveBookmarkIndex(bookmark), 'recent');
                    }
                });
            });
            contentEl.querySelectorAll('.recent-bookmarks-page-btn[data-recent-page]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.goToRecentPage(parseInt(btn.getAttribute('data-recent-page'), 10));
                });
            });
            contentEl.querySelectorAll('.recent-bookmarks-open-btn[data-open-plan]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const index = parseInt(btn.getAttribute('data-open-plan'), 10);
                    const plan = openPlans[index];
                    if (plan?.bookmarks?.length) this.openBookmarksInNewTabs(plan.bookmarks);
                });
            });
            this._setupRecentModalKeyboardNav(contentEl);
        }

    }


    /**
     * The bookmark's icon, or the letter standing in for one.
     *
     * The row used to open with its position in the list -- 1, 2, 3 -- which is
     * a number nobody needs twice, the order being the list. A favicon is what
     * makes a row recognisable before it is read, and it is what every other
     * list of bookmarks in the app puts there.
     *
     * Icons are stored as bare filenames and served from /data/icons/; an
     * absolute or root-relative value is already a src. Same resolution as the
     * dashboard rows and the health view, or the file is requested from the
     * site root and 404s.
     */
    recentIconHtml(bookmark) {
        const d = this.dash;
        const raw = String(bookmark?.icon || '').trim();
        if (raw) {
            const src = /^(https?:|data:|\/)/i.test(raw) ? raw : `/data/icons/${encodeURIComponent(raw)}`;
            return `<img class="recent-bookmarks-modal-icon" src="${d.escapeHtml(src)}" alt="" loading="lazy">`;
        }
        const letter = (String(bookmark?.name || '').trim()[0] || '?').toUpperCase();
        return `<span class="recent-bookmarks-modal-icon recent-bookmarks-modal-icon--letter" aria-hidden="true">${d.escapeHtml(letter)}</span>`;
    }

    _setupRecentModalKeyboardNav(body) {
        const d = this.dash;
        this._cleanupRecentModalKeyHandler();
        const getFocusables = () => Array.from(
            body.querySelectorAll('.recent-bookmarks-open-btn, .recent-bookmarks-modal-item')
        );
        const focusables = getFocusables();
        if (!focusables.length) {
            return;
        }
        focusables[0].focus({ preventScroll: true });
        d._recentModalKeyHandler = (e) => {
            if (!this.isRecentBookmarksModalOpen()) {
                this._cleanupRecentModalKeyHandler();
                return;
            }
            // Older and newer pages; ← and → are the line's.
            const turn = e.key === 'PageDown' || e.key === ']' ? 1 : e.key === 'PageUp' || e.key === '[' ? -1 : 0;
            if (turn && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                this.goToRecentPage((Number(this._recentPage) || 0) + turn);
                return;
            }
            const walks = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
            if (!walks.includes(e.key)) {
                return;
            }
            const items = getFocusables();
            if (!items.length) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            let idx = items.indexOf(document.activeElement);
            if (idx < 0) {
                idx = 0;
            } else if (e.key === 'Home') {
                idx = 0;
            } else if (e.key === 'End') {
                idx = items.length - 1;
            } else if (e.key === 'ArrowRight') {
                idx = (idx + 1) % items.length;
            } else if (e.key === 'ArrowLeft') {
                idx = (idx - 1 + items.length) % items.length;
            } else {
                /*
                 * Down means down.
                 *
                 * The rows lie across the sheet now, so a step of one is a step
                 * sideways and the vertical arrows stopped doing anything
                 * vertical. The step is the number of entries standing on a
                 * line, counted off the layout rather than configured -- the
                 * count falls out of the sheet's width.
                 */
                const step = this._recentRowsAcross(items);
                idx = e.key === 'ArrowDown'
                    ? Math.min(items.length - 1, idx + step)
                    : Math.max(0, idx - step);
            }
            items[idx].focus({ preventScroll: true });
        };
        document.addEventListener('keydown', d._recentModalKeyHandler, true);
    }


    /** How many entries stand on one line of the sheet. */
    _recentRowsAcross(items) {
        const rows = (items || []).filter((el) => el.classList?.contains('recent-bookmarks-modal-item'));
        if (rows.length < 2) return 1;
        const top = Math.round(rows[0].getBoundingClientRect().top);
        const across = rows.filter((el) => Math.abs(Math.round(el.getBoundingClientRect().top) - top) <= 2).length;
        return Math.max(1, across);
    }

    _cleanupRecentModalKeyHandler() {
        const d = this.dash;
        if (!d._recentModalKeyHandler) {
            return;
        }
        document.removeEventListener('keydown', d._recentModalKeyHandler, true);
        d._recentModalKeyHandler = null;
    }


    getRecentBookmarks(bookmarks, limit = 10) {
        const sorted = [...(Array.isArray(bookmarks) ? bookmarks : [])]
            .filter((bookmark) => bookmark && bookmark.lastOpened)
            .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
        if (limit == null || limit <= 0) return sorted;
        return sorted.slice(0, limit);
    }


    formatRecentRecency(lastOpened) {
        const d = this.dash;
        if (!lastOpened) return '';
        const diffMs = Math.max(0, Date.now() - new Date(lastOpened).getTime());
        const diffMinutes = Math.floor(diffMs / 60000);
        if (diffMinutes < 1) {
            return d.formatDashboardLabel('recentModalRecencyJustNow', {}, 'just now');
        }
        if (diffMinutes < 60) {
            return d.formatDashboardLabel(
                'recentModalRecencyMinutesAgo',
                { count: diffMinutes },
                `${diffMinutes}m ago`
            );
        }
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) {
            return d.formatDashboardLabel(
                'recentModalRecencyHoursAgo',
                { count: diffHours },
                `${diffHours}h ago`
            );
        }
        const diffDays = Math.floor(diffHours / 24);
        return d.formatPreviewLastOpened(diffDays);
    }


    /**
     * "Thu 15:08 · 2m ago": the weekday and the time it was opened, and how
     * long ago while that is under a day. The date itself is the block beside it.
     */
    formatRecentMoment(lastOpened) {
        const ts = Number(lastOpened) || 0;
        if (!ts) return '';
        const opened = new Date(ts);
        const lang = this.dash.settings?.language || undefined;
        const moment = `${opened.toLocaleDateString(lang, { weekday: 'short' })} ${opened.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`;
        const underADay = Date.now() - ts < 24 * 60 * 60 * 1000;
        return underADay ? `${moment} · ${this.formatRecentRecency(ts)}` : moment;
    }

    /** Where it lives: its category on this page, its page's name on another. */
    recentPlaceLabel(bookmark) {
        const d = this.dash;
        const pageId = Number(bookmark?.pageId ?? bookmark?.pageID);
        if (Number.isFinite(pageId) && pageId > 0 && pageId !== Number(d.currentPageId)) {
            const pageName = (d.pages || []).find((p) => Number(p.id) === pageId)?.name;
            if (pageName) return pageName;
        }
        // A bookmark's category is an id; printed raw it read as "cat_mrjjzqik_o2rt0".
        const category = (d.categories || []).find((item) => String(item.id) === String(bookmark?.category));
        return category?.name
            || (d.language.t('dashboard.uncategorized') || 'Other');
    }

    /**
     * "11–20 of 34", the page numbers, and the keys. Long histories keep the
     * first, the last and the ones around this page, with a gap between.
     */
    recentPagerHtml(page, pages, size, total) {
        const d = this.dash;
        const from = page * size + 1;
        const to = Math.min(total, from + size - 1);
        const wanted = new Set([0, pages - 1, page - 1, page, page + 1].filter((n) => n >= 0 && n < pages));
        const numbers = [...wanted].sort((a, b) => a - b);
        const button = (target, label, aria, current = false) => `<button type="button"
            class="recent-bookmarks-page-btn${current ? ' is-current' : ''}"${current ? ' aria-current="page"' : ''}
            data-recent-page="${target}" aria-label="${d.escapeHtml(aria)}"${target < 0 || target >= pages ? ' disabled' : ''}>${label}</button>`;
        const parts = [];
        numbers.forEach((n, i) => {
            if (i > 0 && n - numbers[i - 1] > 1) parts.push('<span class="recent-bookmarks-page-gap" aria-hidden="true">…</span>');
            parts.push(button(n, String(n + 1),
                d.formatDashboardLabel('recentPageN', { n: n + 1 }, `Page ${n + 1}`),
                n === page));
        });
        return `<nav class="recent-bookmarks-pager" aria-label="${d.escapeHtml(d.formatDashboardLabel('recentPagerLabel', {}, 'Earlier bookmarks'))}">
                    <span class="recent-bookmarks-page-range">${d.escapeHtml(d.formatDashboardLabel('recentPageRange',
                        { from, to, total }, `${from}–${to} of ${total}`))}</span>
                    ${button(page - 1, '\u2039', d.formatDashboardLabel('recentPageNewer', {}, 'Newer'))}
                    ${parts.join('')}
                    ${button(page + 1, '\u203A', d.formatDashboardLabel('recentPageOlder', {}, 'Older'))}
                    <span class="recent-bookmarks-page-keys" aria-hidden="true"><span class="recent-bookmarks-modal-key">[</span><span class="recent-bookmarks-modal-key">]</span></span>
                </nav>`;
    }

    formatRecentOpenCount(openCount) {
        const d = this.dash;
        const count = Number(openCount || 0);
        if (count <= 0) return '';
        return d.formatDashboardLabel('recentModalOpenCount', { count }, `${count}×`);
    }


    buildBookmarkTooltip(bookmark, previewTitle, previewDescription) {
        const parts = [];
        const title = previewTitle || bookmark.name || '';
        if (title) parts.push(title);
        if (previewDescription) parts.push(previewDescription);
        const url = String(bookmark.url || '').trim();
        if (url) parts.push(url);
        const openCount = Number(bookmark.openCount || 0);
        const lastOpened = bookmark.lastOpened || null;
        if (openCount > 0) {
            let usageLine = `Opened ${openCount}×`;
            if (lastOpened) {
                const diffDays = Math.floor((Date.now() - new Date(lastOpened)) / 86400000);
                const ago = diffDays === 0 ? 'today'
                    : diffDays === 1 ? 'yesterday'
                    : diffDays < 7 ? `${diffDays} days ago`
                    : diffDays < 30 ? `${Math.floor(diffDays / 7)}w ago`
                    : diffDays < 365 ? `${Math.floor(diffDays / 30)}mo ago`
                    : `${Math.floor(diffDays / 365)}y ago`;
                usageLine += ` · last ${ago}`;
            }
            parts.push(usageLine);
        }
        return parts.join('\n');
    }


    recordBookmarkOpened(bookmark, bookmarkIndex, source = 'dashboard', method, extra) {
        const d = this.dash;
        if (!bookmark) return;

        const pageId = d.resolveBookmarkPageId(bookmark);
        const index = Number.isInteger(bookmarkIndex) && bookmarkIndex >= 0
            ? bookmarkIndex
            : d.resolveBookmarkIndexOnPage(bookmark, pageId);

        bookmark.openCount = Number(bookmark.openCount || 0) + 1;
        bookmark.lastOpened = Date.now();
        // The server appends the same moment to its log (TrackBookmarkOpen);
        // kept here too, so the usage bars show it without a reload.
        bookmark.openLog = [...(Array.isArray(bookmark.openLog) ? bookmark.openLog : []), bookmark.lastOpened].slice(-365);
        // Opening is what clears a fresh count, on the server and here: the
        // server recomputes it against lastOpened, and this keeps the row you
        // just read from still claiming three new until a reload.
        d.feeds?.markOpened(bookmark);
        d.syncBookmarkMetadataAcrossViews(bookmark, pageId);
        d.refreshSmartCollectionsAfterOpen(bookmark.url);

        if (index >= 0 && pageId > 0) {
            d.analytics?.trackBookmarkOpen(pageId, index, source, method, extra, bookmark.url);
        }
    }

}

window.DashboardRecent = DashboardRecent;
