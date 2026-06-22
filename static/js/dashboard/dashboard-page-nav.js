/**
 * Page tabs, navigation, rename, deep links.
 */
class DashboardPageNav {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    async requestPageNavigation(pageId) {
        const d = this.dash;
        const targetPageId = Number(pageId);
        if (!Number.isFinite(targetPageId)) {
            return false;
        }
        if (targetPageId === Number(d.currentPageId)) {
            return true;
        }
        if (!(await d.confirmInlineEditBeforeNavigation())) {
            return false;
        }
        return d.loadPageBookmarks(targetPageId, { skipInlineEditConfirm: true });
    }



    updatePageTitle(pageName) {
        const d = this.dash;
        const titleElement = document.querySelector('.title');
        if (titleElement) {
            const defaultTitle = d.language.t('dashboard.defaultPageTitle');
            titleElement.textContent = pageName || (defaultTitle !== 'dashboard.defaultPageTitle' ? defaultTitle : '');
        }
    }


    updateDocumentTitle() {
        const d = this.dash;
        const currentPage = d.pages && d.currentPageId
            ? d.pages.find((p) => d.samePageId(p.id, d.currentPageId))
            : null;
        const pageName = currentPage?.name || '';

        if (d.settings?.enableCustomTitle) {
            const base = (d.settings.customTitle || '').trim();
            if (base) {
                document.title = d.settings.showPageInTitle && pageName
                    ? `${pageName} — ${base}`
                    : base;
            } else {
                document.title = pageName || 'nextDash';
            }
        } else {
            document.title = pageName ? `${pageName} — nextDash` : 'nextDash';
        }
    }

    /** Inline page-tab rename (name/icon/color) — desktop/tablet landscape only. */

    allowsPageTabInlineEdit() {
        const d = this.dash;
        return window.MobileExperience?.isMobileLayout?.() !== true;
    }


    setActivePageNavButton(pageId) {
        const d = this.dash;
        const container = document.getElementById('page-navigation');
        if (!container) {
            return;
        }
        const targetPageId = Number(pageId);
        const pageIndex = d.pages.findIndex((page) => Number(page.id) === targetPageId);
        container.querySelectorAll('.page-nav-btn').forEach((btn, index) => {
            const selected = index === pageIndex;
            btn.classList.toggle('active', selected);
            btn.setAttribute('aria-selected', selected ? 'true' : 'false');
            btn.tabIndex = selected ? 0 : -1;
        });
    }


    renderPageNavigation() {
        const d = this.dash;
        const container = document.getElementById('page-navigation');
        if (!container) return;

        container.innerHTML = '';
        container.setAttribute('role', 'tablist');
        const tabsLabel = d.formatDashboardLabel('pageTabsAria', {}, 'Dashboard pages');
        container.setAttribute('aria-label', tabsLabel);

        let activeBtn = null;
        d.pages.forEach((page, index) => {
            const pageBtn = document.createElement('button');
            pageBtn.type = 'button';
            pageBtn.className = 'page-nav-btn';
            pageBtn.setAttribute('role', 'tab');
            const isActive = d.samePageId(page.id, d.currentPageId);
            pageBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            pageBtn.tabIndex = isActive ? 0 : -1;
            if (isActive) {
                pageBtn.classList.add('active');
                activeBtn = pageBtn;
            }
            this._renderPageTabContent(pageBtn, page, index);
            const prefetchPage = () => {
                d.data?.prefetchPageData?.(page.id);
            };
            pageBtn.addEventListener('mouseenter', prefetchPage, { passive: true });
            pageBtn.addEventListener('focus', prefetchPage, { passive: true });
            pageBtn.addEventListener('click', async () => {
                const switched = await this.requestPageNavigation(page.id);
                if (!switched) {
                    return;
                }
                d.markInlineTipUsed('page_switch');
                pageBtn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            });
            pageBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pageBtn.click();
                }
            });
            pageBtn.addEventListener('dblclick', (e) => {
                if (!this.allowsPageTabInlineEdit()) return;
                e.preventDefault();
                this._startPageTabRename(pageBtn, page, index);
            });
            container.appendChild(pageBtn);
        });
        if (activeBtn) {
            requestAnimationFrame(() => activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
        }

        if (d._pageNavKeyHandler) {
            container.removeEventListener('keydown', d._pageNavKeyHandler);
        }
        d._pageNavKeyHandler = (e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                return;
            }
            const tabs = Array.from(container.querySelectorAll('.page-nav-btn'));
            if (tabs.length === 0) {
                return;
            }
            let idx = tabs.findIndex((tab) => tab === document.activeElement);
            if (idx < 0) {
                idx = tabs.findIndex((tab) => tab.classList.contains('active'));
            }
            if (idx < 0) {
                return;
            }
            e.preventDefault();
            if (e.key === 'Home') {
                idx = 0;
            } else if (e.key === 'End') {
                idx = tabs.length - 1;
            } else if (e.key === 'ArrowRight') {
                idx = (idx + 1) % tabs.length;
            } else {
                idx = (idx - 1 + tabs.length) % tabs.length;
            }
            tabs.forEach((tab, i) => {
                tab.tabIndex = i === idx ? 0 : -1;
            });
            tabs[idx].focus({ preventScroll: true });
            tabs[idx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        };
        container.addEventListener('keydown', d._pageNavKeyHandler);

        d.updateMiniStatusLine();
    }


    _renderPageTabContent(btn, page, index) {
        const d = this.dash;
        btn.innerHTML = '';
        if (page.icon) {
            const iconEl = document.createElement('span');
            iconEl.className = 'page-tab-icon';
            iconEl.textContent = page.icon;
            btn.appendChild(iconEl);
        }
        if (page.color) {
            const dot = document.createElement('span');
            dot.className = 'page-tab-dot';
            dot.style.background = page.color;
            btn.appendChild(dot);
        }
        const label = document.createElement('span');
        label.className = 'page-tab-label';
        label.textContent = d.settings.showPageNamesInTabs ? page.name : (index + 1).toString();
        btn.appendChild(label);
    }

    /**
     * Place a fixed popover fully inside the viewport, anchored to a page tab (or similar).
     */

    _positionPageTabPopover(popover, anchorEl, { initial = false } = {}) {
        const d = this.dash;
        const pad = 8;
        const gap = 6;
        if (initial) {
            popover.style.visibility = 'hidden';
        }
        popover.style.top = '0';
        popover.style.left = '0';
        popover.style.right = 'auto';
        popover.style.bottom = 'auto';

        const measure = () => {
            const anchor = anchorEl.getBoundingClientRect();
            const pop = popover.getBoundingClientRect();
            const maxLeft = Math.max(pad, window.innerWidth - pad - pop.width);
            const maxTop = Math.max(pad, window.innerHeight - pad - pop.height);

            let top = anchor.bottom + gap;
            let left = anchor.left;

            if (left + pop.width > window.innerWidth - pad) {
                left = anchor.right - pop.width;
            }
            left = Math.min(Math.max(pad, left), maxLeft);

            if (top + pop.height > window.innerHeight - pad) {
                const above = anchor.top - gap - pop.height;
                top = above >= pad ? above : maxTop;
            }
            top = Math.min(Math.max(pad, top), maxTop);

            popover.style.top = `${Math.round(top)}px`;
            popover.style.left = `${Math.round(left)}px`;
            if (initial) {
                popover.style.visibility = '';
            }
        };

        if (initial) {
            requestAnimationFrame(measure);
        } else {
            measure();
        }
    }


    _startPageTabRename(btn, page, index) {
        const d = this.dash;
        if (!this.allowsPageTabInlineEdit()) return;
        if (btn.querySelector('.page-tab-popover')) return;

        const PAGE_COLORS = [
            null,
            '#e05252', '#e08852', '#d4bf4a', '#4cac6b',
            '#5285e0', '#8b5fe0', '#e052a8', '#52c8e0'
        ];

        // Build popover
        const popover = document.createElement('div');
        popover.className = 'page-tab-popover';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'page-tab-popover-name';
        nameInput.value = page.name;
        nameInput.placeholder = d.configLabel('pageNamePlaceholder', 'Page name');

        const iconInput = document.createElement('input');
        iconInput.type = 'text';
        iconInput.className = 'page-tab-popover-icon';
        iconInput.value = page.icon || '';
        iconInput.placeholder = '📌';
        iconInput.maxLength = 4;

        const swatches = document.createElement('div');
        swatches.className = 'page-tab-color-swatches';
        PAGE_COLORS.forEach(color => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'page-tab-color-swatch' + (page.color === color ? ' selected' : '');
            sw.style.background = color || 'transparent';
            if (!color) sw.classList.add('swatch-none');
            sw.addEventListener('mousedown', (e) => {
                e.preventDefault();
                swatches.querySelectorAll('.page-tab-color-swatch').forEach(s => s.classList.remove('selected'));
                sw.classList.add('selected');
                page.color = color;
            });
            swatches.appendChild(sw);
        });

        const row = document.createElement('div');
        row.className = 'page-tab-popover-row';
        row.appendChild(iconInput);
        row.appendChild(nameInput);

        popover.appendChild(row);
        popover.appendChild(swatches);

        document.body.appendChild(popover);
        this._positionPageTabPopover(popover, btn, { initial: true });

        const reposition = () => {
            if (popover.isConnected) {
                this._positionPageTabPopover(popover, btn);
            }
        };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);

        const removeRepositionListeners = () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };

        nameInput.focus();
        nameInput.select();

        let done = false;
        const commit = async () => {
            if (done) return;
            done = true;
            removeRepositionListeners();
            popover.remove();
            const newName = nameInput.value.trim();
            const newIcon = iconInput.value.trim();
            if (!newName) { this._renderPageTabContent(btn, page, index); return; }
            const previousName = page.name;
            const previousIcon = page.icon;
            page.name = newName;
            page.icon = newIcon || undefined;
            this._renderPageTabContent(btn, page, index);
            this.updatePageTitle(newName);
            try {
                const response = await dashFetch('/api/pages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(d.pages)
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error) {
                page.name = previousName;
                page.icon = previousIcon;
                this._renderPageTabContent(btn, page, index);
                this.updatePageTitle(previousName || '');
                const message = d.formatDashboardLabel(
                    'savePageFailed',
                    {},
                    'Failed to save page.'
                );
                const detail = error?.message ? `${message} ${error.message}` : message;
                d.showErrorNotification(detail);
            }
        };
        const cancel = () => {
            if (done) return;
            done = true;
            removeRepositionListeners();
            popover.remove();
            this._renderPageTabContent(btn, page, index);
            btn.focus({ preventScroll: true });
        };

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        iconInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); nameInput.focus(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });

        // Close on outside click
        const onOutside = (e) => {
            if (!popover.contains(e.target) && e.target !== btn) {
                document.removeEventListener('mousedown', onOutside);
                commit();
            }
        };
        setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
    }


    async consumeDashboardDeepLink() {
        const d = this.dash;
        if (typeof DashboardDeepLink === 'undefined') return;
        const link = DashboardDeepLink.parseDashboardDeepLink();
        if (!DashboardDeepLink.hasDeepLinkTarget(link)) return;

        if (link.pageId != null && d.pages.some((p) => d.samePageId(p.id, link.pageId))) {
            if (!d.samePageId(d.currentPageId, link.pageId)) {
                await this.requestPageNavigation(link.pageId);
            }
        }

        const focus = () => this.focusDashboardDeepLinkTarget(link);
        requestAnimationFrame(() => requestAnimationFrame(focus));
    }


    expandCategoryForDeepLink(categoryId) {
        const d = this.dash;
        if (!categoryId) return null;
        const escaped = typeof CSS !== 'undefined' && CSS.escape
            ? CSS.escape(categoryId)
            : String(categoryId).replace(/["\\]/g, '\\$&');
        const catEl = document.querySelector(
            `.category[data-category-id="${escaped}"]:not([data-smart-collection="true"])`
        );
        if (!catEl) return null;
        const collapsedKey = `${d.currentPageId}:${categoryId}`;
        catEl.setAttribute('data-collapsed', 'false');
        d.collapsedCategories[collapsedKey] = false;
        if (categoryId in d.collapsedCategories) {
            delete d.collapsedCategories[categoryId];
        }
        d.saveCollapsedStates();
        return catEl;
    }


    findBookmarkRowForDeepLink(link) {
        const d = this.dash;
        if (!link) return null;
        if (link.bookmarkIndex != null && link.bookmarkIndex >= 0) {
            const byIndex = document.querySelector(
                `.bookmark-link[data-bookmark-index="${link.bookmarkIndex}"]`
            );
            if (byIndex) return byIndex;
        }
        if (!link.url) return null;
        const targetUrl = String(link.url).trim();
        const canonical = typeof BookmarkUrlUtils !== 'undefined'
            ? BookmarkUrlUtils.canonicalBookmarkURLKey(targetUrl)
            : targetUrl.toLowerCase();
        const rows = document.querySelectorAll('.bookmark-link[data-bookmark-url]');
        for (const row of rows) {
            const rowUrl = String(row.getAttribute('data-bookmark-url') || '').trim();
            if (!rowUrl) continue;
            const rowKey = typeof BookmarkUrlUtils !== 'undefined'
                ? BookmarkUrlUtils.canonicalBookmarkURLKey(rowUrl)
                : rowUrl.toLowerCase();
            if (rowKey === canonical) return row;
        }
        return null;
    }


    focusDashboardDeepLinkTarget(link) {
        const d = this.dash;
        if (!link) return false;

        if (link.categoryId) {
            const catEl = this.expandCategoryForDeepLink(link.categoryId);
            if (catEl) {
                catEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                const msg = d.language?.t?.('dashboard.deepLinkCategoryNotFound')
                    || 'Category not found — it may have been deleted. Showing all bookmarks.';
                d.showNotification(msg, 'info', { duration: 6000 });
            }
        }

        const row = this.findBookmarkRowForDeepLink(link);
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.remove('bookmark-deep-link-focus');
            void row.offsetWidth;
            row.classList.add('bookmark-deep-link-focus');
            row.addEventListener(
                'animationend',
                () => row.classList.remove('bookmark-deep-link-focus'),
                { once: true }
            );
            if (d.keyboardNavigation?.navigableElements) {
                d.keyboardNavigation.updateNavigableElements?.();
                const navIdx = d.keyboardNavigation.navigableElements.indexOf(row);
                if (navIdx >= 0) {
                    d.keyboardNavigation.currentIndex = navIdx;
                    d.keyboardNavigation.highlightCurrentElement?.();
                }
            }
        } else if (link.bookmarkIndex != null || link.url) {
            const msg = d.language?.t?.('dashboard.deepLinkBookmarkNotFound')
                || 'Bookmark not found on this page (it may have moved).';
            d.showNotification(msg, 'info', { duration: 4000 });
        }

        DashboardDeepLink.stripDeepLinkParams();
        return Boolean(row);
    }

}

window.DashboardPageNav = DashboardPageNav;
