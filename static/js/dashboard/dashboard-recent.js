/**
 * Recent bookmarks modal and open-tabs helpers.
 */
class DashboardRecent {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    getRecentBookmarksWithUrls(bookmarks, limit) {
        const d = this.dash;
        return this.getRecentBookmarks(bookmarks, limit).filter(
            (bookmark) => bookmark && String(bookmark.url || '').trim()
        );
    }


    sameBookmarkList(a, b) {
        const d = this.dash;
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
        const d = this.dash;
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
        const d = this.dash;
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

        const skeletonCount = 5;
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

        window.AppModal.show({
            title: d.language.t('dashboard.recentBookmarksTitle') || 'Recent bookmarks',
            htmlMessage: skeletonHtml,
            confirmText: d.language.t('dashboard.close') || 'Close',
            showCancel: false,
            modalClass: 'recent-bookmarks-modal',
            modalMaxWidth: '760px',
            modalWidth: '92vw',
            onHide: () => {
                this._cleanupRecentModalKeyHandler();
            },
        });

        if (!d._bookmarksReady) {
            d._pendingRecentModalRefresh = true;
            return;
        }

        requestAnimationFrame(() => this._fillRecentBookmarksModal());
    }


    _fillRecentBookmarksModal() {
        const d = this.dash;
        const panel = document.querySelector('.recent-bookmarks-modal');
        if (!panel) return;

        const contentEl = document.getElementById('modal-text') || panel.querySelector('.modal-body');
        if (!contentEl) return;

        const recentBookmarks = this.getRecentBookmarks(d.bookmarks, DashboardBookmarkRows.RECENT_MODAL_DISPLAY_LIMIT);
        const openInNewTab = d.settings.openInNewTab;
        const noRecentText = d.language.t('dashboard.noRecentBookmarks') || 'No recent bookmarks yet.';
        const shownWithUrls = this.getRecentBookmarksWithUrls(d.bookmarks, DashboardBookmarkRows.RECENT_MODAL_DISPLAY_LIMIT);
        const lastWithUrls = this.getRecentBookmarksWithUrls(d.bookmarks, DashboardBookmarkRows.OPEN_LAST_DEFAULT);

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
            ? `${openToolbarHtml}
               <div class="recent-bookmarks-modal-list">
                   ${recentBookmarks.map((bookmark, index) => {
                       const safeName = d.escapeHtml(bookmark.name || d.bookmarkFallbackName());
                       const safeUrl = this.safeHttpBookmarkHref(bookmark.url);
                       const safeCategory = d.escapeHtml(bookmark.category || (d.language.t('dashboard.uncategorized') || 'Other'));
                       const recency = d.escapeHtml(this.formatRecentRecency(bookmark.lastOpened));
                       const openCount = this.formatRecentOpenCount(bookmark.openCount);
                       const openCountHtml = openCount
                           ? `<span class="recent-bookmarks-modal-opens">${d.escapeHtml(openCount)}</span>`
                           : '';
                       const target = openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : '';
                       return `<a class="recent-bookmarks-modal-item" href="${safeUrl}" data-recent-index="${index}"${target}>
                                   <span class="recent-bookmarks-modal-rank" aria-hidden="true">${index + 1}</span>
                                   <span class="recent-bookmarks-modal-body">
                                       <span class="recent-bookmarks-modal-name">${safeName}</span>
                                       <span class="recent-bookmarks-modal-detail">${safeCategory}</span>
                                   </span>
                                   <span class="recent-bookmarks-modal-stats">
                                       <span class="recent-bookmarks-modal-recency">${recency}</span>
                                       ${openCountHtml}
                                   </span>
                               </a>`;
                   }).join('')}
               </div>`
            : `<div class="recent-bookmarks-empty">${d.escapeHtml(noRecentText)}</div>`;

        contentEl.innerHTML = listHtml;

        if (recentBookmarks.length > 0) {
            contentEl.querySelectorAll('.recent-bookmarks-modal-item[data-recent-index]').forEach((item) => {
                item.addEventListener('click', (e) => {
                    const index = parseInt(e.currentTarget.getAttribute('data-recent-index'), 10);
                    const bookmark = !Number.isNaN(index) ? recentBookmarks[index] : null;
                    if (bookmark) {
                        this.recordBookmarkOpened(bookmark, d.resolveBookmarkIndex(bookmark));
                    }
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
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
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
            } else if (e.key === 'ArrowDown') {
                idx = (idx + 1) % items.length;
            } else {
                idx = (idx - 1 + items.length) % items.length;
            }
            items[idx].focus({ preventScroll: true });
        };
        document.addEventListener('keydown', d._recentModalKeyHandler, true);
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
        const d = this.dash;
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


    formatRecentOpenCount(openCount) {
        const d = this.dash;
        const count = Number(openCount || 0);
        if (count <= 0) return '';
        return d.formatDashboardLabel('recentModalOpenCount', { count }, `${count}×`);
    }


    buildBookmarkTooltip(bookmark, previewTitle, previewDescription) {
        const d = this.dash;
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


    recordBookmarkOpened(bookmark, bookmarkIndex) {
        const d = this.dash;
        if (!bookmark) return;

        const pageId = d.resolveBookmarkPageId(bookmark);
        const index = Number.isInteger(bookmarkIndex) && bookmarkIndex >= 0
            ? bookmarkIndex
            : d.resolveBookmarkIndexOnPage(bookmark, pageId);

        bookmark.openCount = Number(bookmark.openCount || 0) + 1;
        bookmark.lastOpened = Date.now();
        d.syncBookmarkMetadataAcrossViews(bookmark, pageId);
        d.refreshSmartCollectionsAfterOpen(bookmark.url);

        if (index >= 0 && pageId > 0) {
            d.analytics?.trackBookmarkOpen(pageId, index);
        }
    }

}

window.DashboardRecent = DashboardRecent;
