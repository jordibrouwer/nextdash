/**
 * Config "Stats" tab — two-column insights dashboard.
 * Sections: overview, insights, cleanup score, activity, top bookmarks,
 *           pages, categories, tags, shortcuts, finders, rot & cleanup, conflicts, search & status.
 */
class ConfigStats {
    constructor(t) {
        this.t = typeof t === 'function' ? t : (k) => k;
        this.lastManager = null;
        this._scrollspyObs = null;
        this._filterQuery = '';
        this._activeSectionId = 'stats-overview';
        // Current period (days) per section; 0 = all time
        this.sectionPeriods = { activity: 30, top: 0, pages: 0, categories: 0, tags: 0, rot: 90, inbox: 30 };
        // Inbox data sources (fetched async; snapshot from /api/inbox, lifetime from /api/inbox-stats)
        this._inboxItems = [];
        this._inboxStats = null;
        // Persisted per-section collapse state (accordion; at most one open).
        this._collapseStateKey = 'nextdash_config_stats_open';
    }

    readCollapseState() {
        try {
            const raw = localStorage.getItem(this._collapseStateKey);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    persistCollapseState() {
        const state = {};
        document.querySelectorAll('.stats-content .stats-block[id]').forEach((block) => {
            state[block.id] = !block.classList.contains('is-collapsed');
        });
        try {
            localStorage.setItem(this._collapseStateKey, JSON.stringify(state));
        } catch { /* ignore quota / private mode */ }
    }

    // ── helpers ────────────────────────────────────────────────────────────

    yn(val) { return val ? this.t('config.statsYes') : this.t('config.statsNo'); }

    setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    pageName(pages, pageId) {
        const id = Number(pageId);
        const p = pages.find((x) => Number(x.id) === id);
        return p && p.name ? String(p.name) : (Number.isFinite(id)
            ? this.t('config.statsPageFallback').replace('{id}', String(id))
            : '');
    }

    uncategorizedLabel() {
        return this.t('config.statsUncategorized');
    }

    sparklineLabels(days) {
        const today = this.t('config.statsSparklineToday');
        const dayLbl = (n) => this.t('config.statsSparklineDaysAgo').replace('{n}', String(n));
        const moLbl = (n) => this.t('config.statsSparklineMonthsAgo').replace('{n}', String(n));
        if (days === 7) return [6, 5, 4, 3, 2, 1, 0].map((n) => (n === 0 ? today : dayLbl(n)));
        if (days === 30) return [30, 24, 18, 12, 6].map(dayLbl);
        if (days === 90) return [90, 80, 70, 60, 50, 40, 30, 20, 10].map(dayLbl);
        if (days === 180) return [6, 5, 4, 3, 2, 1].map(moLbl);
        return [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(moLbl);
    }

    formatWhen(ts, locale) {
        const n = Number(ts);
        if (!n) return '—';
        try {
            return new Date(n).toLocaleString(locale || undefined, { dateStyle: 'short', timeStyle: 'short' });
        } catch (e) { return '—'; }
    }

    clearTable(tbodyId) {
        const tb = document.getElementById(tbodyId);
        if (tb) tb.textContent = '';
    }

    appendRow(tbodyId, cells, opts = {}) {
        const tb = document.getElementById(tbodyId);
        if (!tb) return;
        const tr = document.createElement('tr');
        cells.forEach((content, i) => {
            const td = document.createElement('td');
            if (opts.barCol === i && opts.barPct != null) {
                td.className = 'stats-bar-cell';
                const fill = document.createElement('span');
                fill.className = 'stats-bar-cell-fill';
                fill.style.width = `${opts.barPct}%`;
                const text = document.createElement('span');
                text.className = 'stats-bar-cell-text';
                text.textContent = content;
                td.appendChild(fill);
                td.appendChild(text);
            } else {
                if (opts.rankCol === i) td.className = 'stats-rank';
                td.textContent = content;
            }
            tr.appendChild(td);
        });
        if (opts.bookmark && this.lastManager) {
            const bm = opts.bookmark;
            const name = String(bm.name || '—');
            tr.classList.add('stats-row-clickable');
            tr.title = this.t('config.statsRowOpenHint').replace('{name}', name);
            tr.tabIndex = 0;
            tr.setAttribute('role', 'button');
            tr.setAttribute('aria-label', this.t('config.statsRowOpenAria').replace('{name}', name));
            const open = (e) => {
                if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
                if (e.type === 'keydown') e.preventDefault();
                void this.openBookmarkInConfig(bm, this.lastManager);
            };
            tr.addEventListener('click', open);
            tr.addEventListener('keydown', open);
        }
        tb.appendChild(tr);
    }

    csvEscape(value) {
        return `"${String(value ?? '').replace(/"/g, '""')}"`;
    }

    csvRow(...cells) {
        return cells.map((c) => this.csvEscape(c)).join(',');
    }

    async openBookmarkInConfig(bm, manager) {
        if (!manager || !bm) return;
        const pageId = Number(bm.pageId) || Number(manager.currentPageId) || 1;
        if (manager.ui?.switchToTab) {
            manager.ui.switchToTab('bookmarks');
        }
        window.location.hash = '#bookmarks';
        manager.currentPageId = pageId;
        try {
            await manager.loadPageBookmarks(pageId);
            await manager.loadPageCategories(pageId);
        } catch (e) {
            console.warn('Could not load bookmark page', e);
        }
        const match = manager.bookmarkStore?.findByUrl?.(bm, pageId);
        const idx = match
            ? (manager.bookmarksData || []).indexOf(match)
            : (manager.bookmarksData || []).findIndex(
                (b) =>
                    String(b.url || '').trim().toLowerCase() ===
                    String(bm.url || '').trim().toLowerCase()
            );
        if (idx >= 0 && manager.bookmarks?.openDetailPanel) {
            manager.bookmarks.openDetailPanel(
                idx,
                manager.bookmarksData,
                manager.bookmarksPageCategories || []
            );
        }
        manager.syncBookmarksPageSelectorUI?.(pageId);
        manager.refreshBookmarksList?.();
    }

    noData(tbodyId, cols) {
        this.clearTable(tbodyId);
        const tb = document.getElementById(tbodyId);
        if (!tb) return;
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols;
        td.textContent = this.t('config.statsNoData');
        td.style.opacity = '0.5';
        tr.classList.add('stats-row-nodata');
        tr.appendChild(td);
        tb.appendChild(tr);
    }

    bindTableFilter() {
        const input = document.getElementById('stats-filter-input');
        if (!input || input.dataset.statsFilterBound === '1') return;
        input.dataset.statsFilterBound = '1';
        const clearBtn = document.getElementById('stats-filter-clear');
        const syncClear = () => {
            if (clearBtn) clearBtn.hidden = !input.value;
        };
        input.addEventListener('input', () => {
            this._filterQuery = String(input.value || '').trim().toLowerCase();
            syncClear();
            this.applyTableFilter();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && input.value) {
                e.preventDefault();
                input.value = '';
                this._filterQuery = '';
                syncClear();
                this.applyTableFilter();
            }
        });
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                input.value = '';
                this._filterQuery = '';
                clearBtn.hidden = true;
                input.focus();
                this.applyTableFilter();
            });
        }
    }

    applyTableFilter() {
        const q = this._filterQuery;
        const hint = document.getElementById('stats-filter-hint');
        let totalRows = 0;
        let visibleRows = 0;

        document.querySelectorAll('.stats-content .stats-table tbody').forEach((tbody) => {
            let tbodyVisible = 0;
            let dataRowCount = 0;
            tbody.querySelectorAll('tr.stats-row-filter-empty').forEach((r) => r.remove());
            tbody.querySelectorAll('tr').forEach((tr) => {
                if (tr.classList.contains('stats-row-nodata')) {
                    tr.hidden = !!q;
                    return;
                }
                dataRowCount += 1;
                totalRows += 1;
                const match = !q || tr.textContent.toLowerCase().includes(q);
                tr.hidden = !match;
                if (match) {
                    visibleRows += 1;
                    tbodyVisible += 1;
                }
            });
            if (q && tbodyVisible === 0 && dataRowCount > 0) {
                const tr = document.createElement('tr');
                tr.className = 'stats-row-filter-empty';
                const td = document.createElement('td');
                const colCount = tbody.closest('table')?.querySelectorAll('thead th').length || 4;
                td.colSpan = colCount;
                td.textContent = this.t('config.statsFilterNoMatches');
                td.style.opacity = '0.5';
                tr.appendChild(td);
                tbody.appendChild(tr);
            }
        });

        if (hint) {
            if (q) {
                hint.textContent = this.t('config.statsFilterShowing')
                    .replace('{visible}', String(visibleRows))
                    .replace('{total}', String(totalRows));
                hint.hidden = false;
            } else {
                hint.textContent = '';
                hint.hidden = true;
            }
        }
    }

    filterByPeriod(bookmarks, days) {
        if (!days) return bookmarks;
        const cutoff = Date.now() - days * 86400000;
        return bookmarks.filter((b) => Number(b?.lastOpened || 0) >= cutoff);
    }

    opensColLabel(days) {
        return days
            ? this.t('config.statsColOpensLifetimeActive')
            : this.t('config.statsColOpens');
    }

    updateOpensColumnHeaders(blockId, days) {
        const block = document.getElementById(blockId);
        if (!block) return;
        const label = this.opensColLabel(days);
        block.querySelectorAll('th[data-stats-opens-col]').forEach((th) => {
            th.textContent = label;
        });
    }

    updateActivityOpensLabel(days) {
        const el = document.getElementById('stats-activity-opens-label');
        if (!el) return;
        el.textContent = days
            ? this.t('config.statsActivityOpensLifetimeActive')
            : this.t('config.statsActivityOpensLifetimeYear');
    }

    periodLabel(days) {
        const keys = {
            7: 'statsPeriodWeek',
            30: 'statsPeriodMonth',
            90: 'statsPeriod3Months',
            180: 'statsPeriod6Months',
            0: 'statsPeriodAllTime',
        };
        const key = keys[Number(days)] ?? 'statsPeriodAllTime';
        return this.t(`config.${key}`);
    }

    breadcrumbSectionLabel(sectionId) {
        const keys = {
            'stats-overview': 'statsInfoOverviewTitle',
            'stats-inbox': 'statsInfoInboxTitle',
            'stats-insights': 'statsInfoInsightsTitle',
            'stats-score': 'statsInfoScoreTitle',
            'stats-activity': 'statsInfoActivityTitle',
            'stats-top': 'statsInfoTopTitle',
            'stats-pages': 'statsInfoPagesTitle',
            'stats-categories': 'statsInfoCategoriesTitle',
            'stats-tags': 'statsInfoTagsTitle',
            'stats-shortcuts': 'statsInfoShortcutsTitle',
            'stats-finders': 'statsInfoFindersTitle',
            'stats-rot': 'statsInfoRotTitle',
            'stats-conflicts': 'statsInfoConflictsTitle',
            'stats-search': 'statsInfoSearchTitle',
        };
        const key = keys[sectionId];
        return key ? this.t(`config.${key}`) : null;
    }

    _sectionKeyFromId(sectionId) {
        const map = {
            'stats-activity': 'activity',
            'stats-top': 'top',
            'stats-pages': 'pages',
            'stats-categories': 'categories',
            'stats-tags': 'tags',
            'stats-rot': 'rot',
            'stats-inbox': 'inbox',
        };
        return map[sectionId] || null;
    }

    breadcrumbPeriodLabel(sectionId) {
        const section = this._sectionKeyFromId(sectionId);
        if (!section || !Object.prototype.hasOwnProperty.call(this.sectionPeriods, section)) {
            return null;
        }
        return this.periodLabel(this.sectionPeriods[section]);
    }

    // ── Period button binding ───────────────────────────────────────────────

    syncPeriodButtonAria(bar) {
        bar.querySelectorAll('.stats-period-btn').forEach((btn) => {
            btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false');
        });
    }

    bindPeriodButtons(bookmarks, pages, locale) {
        document.querySelectorAll('.stats-period-bar').forEach((bar) => {
            const section = bar.getAttribute('data-section');
            bar.querySelectorAll('.stats-period-btn').forEach((btn) => {
                const fresh = btn.cloneNode(true);
                btn.replaceWith(fresh);
            });
            bar.querySelectorAll('.stats-period-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    bar.querySelectorAll('.stats-period-btn').forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.syncPeriodButtonAria(bar);
                    const days = Number(btn.getAttribute('data-period'));
                    this.sectionPeriods[section] = days;
                    this.renderSection(section, bookmarks, pages, locale);
                    window.configManager?.ui?.refreshTabBreadcrumb?.('stats');
                });
            });
            this.syncPeriodButtonAria(bar);
        });
    }

    renderSection(section, bookmarks, pages, locale) {
        const days = this.sectionPeriods[section] || 0;
        switch (section) {
            case 'activity':    this.renderActivity(bookmarks, days, locale); break;
            case 'top':         this.renderTopBookmarks(bookmarks, pages, locale, days); break;
            case 'pages':       this.renderPagesBlock(bookmarks, pages, days); break;
            case 'categories':  this.renderCategoriesBlock(bookmarks, pages, days); break;
            case 'tags':        this.renderTagsBlock(bookmarks, pages, days); break;
            case 'rot':         this.renderRotBlock(bookmarks, pages, locale, days); break;
            case 'inbox':       this.renderInboxTrend(days); break;
        }
        this.applyTableFilter();
    }

    // ── Scrollspy ──────────────────────────────────────────────────────────

    buildChipNav() {
        const host = document.getElementById('stats-chip-nav');
        const indexLinks = document.querySelectorAll('.stats-index-list a');
        if (!host || !indexLinks.length) return;
        host.textContent = '';
        indexLinks.forEach((link) => {
            const a = document.createElement('a');
            a.href = link.getAttribute('href') || '#';
            a.textContent = link.textContent;
            a.className = 'stats-chip';
            if (link.classList.contains('is-active')) a.classList.add('is-active');
            host.appendChild(a);
        });
    }

    setActiveNavSection(sectionId) {
        this._activeSectionId = sectionId;
        document.querySelectorAll('.stats-index-list a, #stats-chip-nav a').forEach((a) => {
            a.classList.toggle('is-active', a.getAttribute('href') === `#${sectionId}`);
        });
        window.configManager?.ui?.refreshTabBreadcrumb?.('stats');
    }

    initScrollspy() {
        if (this._scrollspyObs) {
            this._scrollspyObs.disconnect();
            this._scrollspyObs = null;
        }

        this.buildChipNav();

        const sections = document.querySelectorAll('.stats-content .stats-block[id]');
        const links = document.querySelectorAll('.stats-index-list a, #stats-chip-nav a');
        if (!sections.length || !links.length || !('IntersectionObserver' in window)) return;

        const obs = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    this.setActiveNavSection(entry.target.id);
                }
            });
        }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 });

        sections.forEach((s) => obs.observe(s));
        this._scrollspyObs = obs;
    }

    // ── Collapsible blocks (accordion) ───────────────────────────────────────

    setupBlockCollapsible() {
        const savedState = this.readCollapseState();
        const hasSavedState = Object.keys(savedState).length > 0;
        document.querySelectorAll('.stats-content .stats-block[id]').forEach((block) => {
            const title = block.querySelector('.stats-block-title-row .section-title');
            if (!title || title.dataset.collapseWired === '1') return;
            title.dataset.collapseWired = '1';
            block.classList.add('is-collapsible');
            title.setAttribute('role', 'button');
            title.setAttribute('tabindex', '0');
            // Restore the remembered open/collapsed state. On first visit (no saved
            // state) everything starts collapsed; the user expands what they want.
            const expanded = hasSavedState ? savedState[block.id] === true : false;
            block.classList.toggle('is-collapsed', !expanded);
            title.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            const toggle = () => this.toggleBlock(block.id);
            title.addEventListener('click', toggle);
            title.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
            });
        });
        this.syncActiveNavFromOpenBlock();
    }

    setupExpandCollapseAll() {
        const expandBtn = document.getElementById('stats-expand-all-btn');
        const collapseBtn = document.getElementById('stats-collapse-all-btn');
        if (!expandBtn || expandBtn.dataset.bulkWired === '1') {
            if (collapseBtn && collapseBtn.dataset.bulkWired !== '1') {
                collapseBtn.dataset.bulkWired = '1';
                collapseBtn.addEventListener('click', () => this.setAllBlocksCollapsed(true));
            }
            return;
        }
        expandBtn.dataset.bulkWired = '1';
        expandBtn.addEventListener('click', () => this.setAllBlocksCollapsed(false));
        if (collapseBtn && collapseBtn.dataset.bulkWired !== '1') {
            collapseBtn.dataset.bulkWired = '1';
            collapseBtn.addEventListener('click', () => this.setAllBlocksCollapsed(true));
        }
    }

    /** Expand or collapse every stats section at once, then persist and sync nav. */
    setAllBlocksCollapsed(collapsed) {
        document.querySelectorAll('.stats-content .stats-block[id]').forEach((block) => {
            block.classList.toggle('is-collapsed', collapsed);
            const title = block.querySelector('.stats-block-title-row .section-title');
            if (title) title.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });
        this.syncActiveNavFromOpenBlock();
        this.persistCollapseState();
    }

    toggleBlock(blockId) {
        const block = document.getElementById(blockId);
        if (!block) return;
        block.classList.toggle('is-collapsed');
        const expanded = !block.classList.contains('is-collapsed');
        const title = block.querySelector('.stats-block-title-row .section-title');
        if (title) title.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        if (expanded) {
            this.collapseOtherBlocks(blockId);
        }
        this.syncActiveNavFromOpenBlock();
        this.persistCollapseState();
    }

    /** Opening a block via title click or quick link collapses whichever other block was open. */
    collapseOtherBlocks(exceptBlockId) {
        document.querySelectorAll('.stats-content .stats-block[id]').forEach((block) => {
            if (block.id === exceptBlockId || block.classList.contains('is-collapsed')) return;
            block.classList.add('is-collapsed');
            const title = block.querySelector('.stats-block-title-row .section-title');
            if (title) title.setAttribute('aria-expanded', 'false');
        });
    }

    /**
     * Highlight the nav link for whichever block is currently open (accordion guarantees at most
     * one). Called right after any accordion state change instead of relying solely on the
     * scrollspy IntersectionObserver, which may not re-fire when the open block was already
     * inside its trigger zone before the change (e.g. no real scroll distance to cross).
     */
    syncActiveNavFromOpenBlock() {
        const open = document.querySelector('.stats-content .stats-block[id]:not(.is-collapsed)');
        this.setActiveNavSection(open ? open.id : null);
    }

    /** Same trigger as the quick-link click handling in config-general-layers.js. */
    isBlockInViewport(block) {
        const rect = block.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight;
        return rect.top > -40 && rect.top < vh * 0.6;
    }

    scrollToBlock(blockId) {
        const block = document.getElementById(blockId);
        if (!block) return;
        block.classList.remove('is-collapsed');
        const title = block.querySelector('.stats-block-title-row .section-title');
        if (title) title.setAttribute('aria-expanded', 'true');
        this.syncActiveNavFromOpenBlock();
        this.persistCollapseState();
        const tourActive = document.body.hasAttribute('data-config-general-tour-active');
        block.scrollIntoView({ behavior: tourActive ? 'auto' : 'smooth', block: 'start' });
    }

    setupNavClicks() {
        const indexEl = document.querySelector('.stats-index');
        const chipEl = document.getElementById('stats-chip-nav');
        const handler = (e) => {
            const a = e.target.closest('.stats-index-list a, #stats-chip-nav a');
            if (!a) return;
            const id = (a.getAttribute('href') || '').replace(/^#/, '');
            const block = id ? document.getElementById(id) : null;
            if (!block) return;
            e.preventDefault();
            const isOpen = !block.classList.contains('is-collapsed');
            if (isOpen && this.isBlockInViewport(block)) {
                this.toggleBlock(id);
                return;
            }
            this.collapseOtherBlocks(id);
            this.scrollToBlock(id);
        };
        if (indexEl && indexEl.dataset.navClicksBound !== '1') {
            indexEl.dataset.navClicksBound = '1';
            indexEl.addEventListener('click', handler);
        }
        if (chipEl && chipEl.dataset.navClicksBound !== '1') {
            chipEl.dataset.navClicksBound = '1';
            chipEl.addEventListener('click', handler);
        }
    }

    // ── Overview ───────────────────────────────────────────────────────────

    renderOverview(bookmarks, pages, manager) {
        const withUrl = bookmarks.filter((b) => String(b?.url || '').trim()).length;
        const withSc  = bookmarks.filter((b) => String(b?.shortcut || '').trim()).length;
        const catKeys = new Set();
        bookmarks.forEach((b) => {
            catKeys.add(`${Number(b.pageId)||0}::${String(b.category||'').trim()}`);
        });
        const totalOpens = bookmarks.reduce((s, b) => s + Number(b?.openCount || 0), 0);
        const avg = bookmarks.length > 0 ? Math.round((totalOpens / bookmarks.length) * 10) / 10 : 0;
        const uniqueTags = new Set();
        let taggedCount = 0;
        bookmarks.forEach((b) => {
            const tags = Array.isArray(b?.tags)
                ? b.tags.map((t) => String(t || '').trim()).filter(Boolean)
                : [];
            if (tags.length === 0) return;
            taggedCount += 1;
            tags.forEach((t) => uniqueTags.add(t.toLowerCase()));
        });

        this.setText('stats-pages-count',      String(pages.length));
        this.setText('stats-categories-count', String(catKeys.size));
        this.setText('stats-bookmarks-total',  String(bookmarks.length));
        this.setText('stats-unique-tags',      String(uniqueTags.size));
        this.setText('stats-tagged-bookmarks', String(taggedCount));
        this.setText('stats-with-url',         String(withUrl));
        this.setText('stats-without-url',      String(Math.max(0, bookmarks.length - withUrl)));
        this.setText('stats-with-shortcut',    String(withSc));
        this.setText('stats-without-shortcut', String(Math.max(0, bookmarks.length - withSc)));
        this.setText('stats-avg-opens',        String(avg));
        const inboxItems = Array.isArray(this._inboxItems) ? this._inboxItems : [];
        const inboxUnread = inboxItems.filter((it) => !Number(it?.readAt)).length;
        this.setText('stats-overview-inbox-total',  String(inboxItems.length));
        this.setText('stats-overview-inbox-unread', String(inboxUnread));
        manager?.backup?.updateLastBackupDisplay?.(manager.settingsData?.language);
    }

    // ── Info buttons ───────────────────────────────────────────────────────

    bindInfoButtons() {
        const sections = [
            ['stats-overview-info-btn',   'statsInfoOverviewTitle',   'statsInfoOverviewMsg'],
            ['stats-inbox-info-btn',      'statsInfoInboxTitle',      'statsInfoInboxMsg'],
            ['stats-insights-info-btn',   'statsInfoInsightsTitle',   'statsInfoInsightsMsg'],
            ['stats-score-info-btn',      'statsInfoScoreTitle',      'statsInfoScoreMsg'],
            ['stats-activity-info-btn',   'statsInfoActivityTitle',   'statsInfoActivityMsg'],
            ['stats-top-info-btn',        'statsInfoTopTitle',        'statsInfoTopMsg'],
            ['stats-pages-info-btn',      'statsInfoPagesTitle',      'statsInfoPagesMsg'],
            ['stats-categories-info-btn', 'statsInfoCategoriesTitle', 'statsInfoCategoriesMsg'],
            ['stats-tags-info-btn',       'statsInfoTagsTitle',       'statsInfoTagsMsg'],
            ['stats-shortcuts-info-btn',  'statsInfoShortcutsTitle',  'statsInfoShortcutsMsg'],
            ['stats-finders-info-btn',   'statsInfoFindersTitle',    'statsInfoFindersMsg'],
            ['stats-rot-info-btn',        'statsInfoRotTitle',        'statsInfoRotMsg'],
            ['stats-conflicts-info-btn',  'statsInfoConflictsTitle',  'statsInfoConflictsMsg'],
            ['stats-search-info-btn',     'statsInfoSearchTitle',     'statsInfoSearchMsg'],
        ];
        sections.forEach(([btnId, titleKey, msgKey]) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            const fresh = btn.cloneNode(true);
            btn.replaceWith(fresh);
            fresh.setAttribute('aria-label', this.t(`config.${titleKey}`));
            fresh.addEventListener('click', () => {
                if (!window.AppModal) return;
                window.AppModal.alert({
                    title: this.t(`config.${titleKey}`),
                    htmlMessage: this.t(`config.${msgKey}`).replace(/\n/g, '<br>'),
                    confirmText: this.t('config.gotIt'),
                });
            });
        });
    }

    // ── Cleanup score ──────────────────────────────────────────────────────

    renderCleanupScore(bookmarks) {
        const total = bookmarks.length;
        const el = document.getElementById('stats-score-detail');
        if (!el) return;
        el.textContent = '';

        if (total === 0) {
            this.setText('stats-score-value', '—');
            const fill = document.getElementById('stats-score-bar-fill');
            if (fill) fill.style.width = '0%';
            const scoreEl = document.getElementById('stats-score-value');
            if (scoreEl) scoreEl.style.color = '';
            if (fill) fill.style.background = '';
            return;
        }

        const neverOpened = bookmarks.filter(
            (b) => !Number(b?.openCount) && !Number(b?.lastOpened)
        ).length;

        const cutoff90 = Date.now() - 90 * 86400000;
        const stale90  = bookmarks.filter((b) => {
            const lo = Number(b?.lastOpened || 0);
            return lo > 0 && lo < cutoff90;
        }).length;

        const urlMap = new Map();
        bookmarks.forEach((b) => {
            const url = String(b?.url || '').trim().toLowerCase();
            if (url) urlMap.set(url, (urlMap.get(url) || 0) + 1);
        });
        const dupCount = [...urlMap.values()].filter((c) => c > 1).length;

        const scMap = new Map();
        bookmarks.forEach((b) => {
            const sc = String(b?.shortcut || '').trim().toLowerCase();
            if (sc) scMap.set(sc, (scMap.get(sc) || 0) + 1);
        });
        const conflictCount = [...scMap.values()].filter((c) => c > 1).length;

        let score = 100;
        const details = [];

        const neverRatio   = neverOpened / total;
        const neverPenalty = Math.round(Math.min(neverRatio * 50, 25));
        if (neverPenalty > 0) {
            score -= neverPenalty;
            const txt = this.t('config.statsScoreNeverOpened')
                .replace('{count}', neverOpened)
                .replace('{pct}', Math.round(neverRatio * 100));
            details.push({ text: txt, penalty: neverPenalty, type: 'warn' });
        }

        const staleRatio   = stale90 / total;
        const stalePenalty = Math.round(Math.min(staleRatio * 40, 20));
        if (stalePenalty > 0) {
            score -= stalePenalty;
            const txt = this.t('config.statsScoreStale90')
                .replace('{count}', stale90)
                .replace('{pct}', Math.round(staleRatio * 100));
            details.push({ text: txt, penalty: stalePenalty, type: 'warn' });
        }

        if (dupCount > 0) {
            const pen = Math.min(dupCount * 3, 15);
            score -= pen;
            details.push({ text: this.t('config.statsScoreDupUrls').replace('{count}', dupCount), penalty: pen, type: 'bad' });
        }

        if (conflictCount > 0) {
            const pen = Math.min(conflictCount * 5, 10);
            score -= pen;
            details.push({ text: this.t('config.statsScoreConflicts').replace('{count}', conflictCount), penalty: pen, type: 'bad' });
        }

        score = Math.max(0, Math.min(100, score));

        if (details.length === 0) {
            details.push({ text: this.t('config.statsScoreHealthy'), type: 'good' });
        }

        this.setText('stats-score-value', String(score));
        const fill = document.getElementById('stats-score-bar-fill');
        if (fill) fill.style.width = `${score}%`;

        // Score colour via accent-primary fallback; shift to warning/error at low scores
        const scoreEl = document.getElementById('stats-score-value');
        if (scoreEl) {
            scoreEl.style.color = score >= 80
                ? 'var(--accent-success)'
                : score >= 50
                    ? 'var(--accent-warning)'
                    : 'var(--accent-error)';
        }
        const barFill = document.getElementById('stats-score-bar-fill');
        if (barFill) {
            barFill.style.background = score >= 80
                ? 'var(--accent-success)'
                : score >= 50
                    ? 'var(--accent-warning)'
                    : 'var(--accent-error)';
        }

        details.forEach((item) => {
            const li = document.createElement('li');
            li.textContent = item.text;
            if (item.type === 'good') li.classList.add('is-good');
            if (item.type === 'bad')  li.classList.add('is-bad');
            if (item.penalty) {
                const badge = document.createElement('span');
                badge.className = 'stats-score-penalty';
                badge.textContent = `−${item.penalty}`;
                li.appendChild(badge);
            }
            el.appendChild(li);
        });
    }

    // ── Activity sparkline ─────────────────────────────────────────────────

    renderActivityWeekCompare(bookmarks, days) {
        const el = document.getElementById('stats-activity-wow');
        if (!el) return;
        if (Number(days) !== 7) {
            el.hidden = true;
            el.textContent = '';
            return;
        }

        const now = Date.now();
        const weekMs = 7 * 86400000;
        const thisWeekStart = now - weekMs;
        const lastWeekStart = now - 2 * weekMs;
        let thisWeek = 0;
        let lastWeek = 0;

        bookmarks.forEach((b) => {
            const lo = Number(b?.lastOpened || 0);
            if (!lo) return;
            if (lo >= thisWeekStart) {
                thisWeek += 1;
            } else if (lo >= lastWeekStart) {
                lastWeek += 1;
            }
        });

        let deltaText = '—';
        if (lastWeek > 0) {
            const pct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
            const sign = pct > 0 ? '+' : '';
            deltaText = `${sign}${pct}%`;
        } else if (thisWeek > 0) {
            deltaText = this.t('config.statsWeekCompareNew');
        }

        el.hidden = false;
        el.textContent = this.t('config.statsWeekCompare')
            .replace('{thisWeek}', String(thisWeek))
            .replace('{lastWeek}', String(lastWeek))
            .replace('{delta}', deltaText);
    }

    renderActivity(bookmarks, days, locale) {
        const now = Date.now();

        // Bucket configuration
        let bucketCount, bucketMs, labels;
        let effectiveDays = days;
        if (days === 7) {
            bucketCount = 7; bucketMs = 86400000;
        } else if (days === 30) {
            bucketCount = 5; bucketMs = 6 * 86400000;
        } else if (days === 90) {
            bucketCount = 9; bucketMs = 10 * 86400000;
        } else if (days === 180) {
            bucketCount = 6; bucketMs = 30 * 86400000;
        } else {
            bucketCount = 12; bucketMs = 30 * 86400000;
            effectiveDays = 365;
        }
        labels = this.sparklineLabels(days || 0);

        const cutoff = now - effectiveDays * 86400000;
        const buckets = Array(bucketCount).fill(0);

        bookmarks.forEach((b) => {
            const lo = Number(b?.lastOpened || 0);
            if (lo < cutoff) return;
            const age = now - lo;
            const idx = Math.floor(age / bucketMs);
            const bucketIdx = bucketCount - 1 - Math.min(idx, bucketCount - 1);
            buckets[bucketIdx]++;
        });

        const active = bookmarks.filter((b) => Number(b?.lastOpened || 0) >= cutoff).length;
        const totalInPeriod = bookmarks.reduce((s, b) => {
            const lo = Number(b?.lastOpened || 0);
            return lo >= cutoff ? s + Number(b?.openCount || 0) : s;
        }, 0);

        this.updateActivityOpensLabel(days);
        this.setText('stats-activity-total',  String(totalInPeriod));
        this.setText('stats-activity-active', String(active));
        this.renderActivityWeekCompare(bookmarks, days);

        // Render SVG bar chart
        const wrap = document.getElementById('stats-sparkline');
        if (!wrap) return;
        wrap.textContent = '';

        const maxVal = Math.max(...buckets, 1);
        const W = 500, H = 72, gap = 3;
        const barW = Math.floor((W - gap * (bucketCount - 1)) / bucketCount);

        const rects = buckets.map((val, i) => {
            const h = Math.round((val / maxVal) * H);
            const x = i * (barW + gap);
            const y = H - h;
            const opacity = val === 0 ? 0.15 : 0.75 + (val / maxVal) * 0.25;
            return `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(h, val > 0 ? 2 : 0)}" fill="var(--accent-primary)" opacity="${opacity.toFixed(2)}" rx="1"/>`;
        }).join('');

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('height', '72');
        svg.setAttribute('role', 'img');
        const summary = labels.map((lbl, i) => `${lbl}: ${buckets[i]}`).join(', ');
        svg.setAttribute('aria-label', this.t('config.statsSparklineAria').replace('{summary}', summary));
        svg.style.cssText = 'display:block;width:100%;';
        svg.innerHTML = rects;
        wrap.appendChild(svg);

        const srTable = document.createElement('table');
        srTable.className = 'stats-sr-only';
        const caption = document.createElement('caption');
        caption.textContent = this.t('config.statsSparklineTableCaption');
        srTable.appendChild(caption);
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        [this.t('config.statsSparklineColBucket'), this.t('config.statsSparklineColCount')].forEach((txt) => {
            const th = document.createElement('th');
            th.scope = 'col';
            th.textContent = txt;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        srTable.appendChild(thead);
        const tbody = document.createElement('tbody');
        labels.forEach((lbl, i) => {
            const tr = document.createElement('tr');
            [lbl, String(buckets[i])].forEach((txt) => {
                const td = document.createElement('td');
                td.textContent = txt;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        srTable.appendChild(tbody);
        wrap.appendChild(srTable);

        // Labels row
        const labelRow = document.createElement('div');
        labelRow.className = 'stats-sparkline-labels';
        labelRow.setAttribute('aria-hidden', 'true');
        const step = Math.max(1, Math.floor(bucketCount / 5));
        labels.forEach((lbl, i) => {
            const span = document.createElement('span');
            span.textContent = (i % step === 0 || i === bucketCount - 1) ? lbl : '';
            labelRow.appendChild(span);
        });
        wrap.appendChild(labelRow);
    }

    // ── Top bookmarks ──────────────────────────────────────────────────────

    renderTopBookmarks(bookmarks, pages, locale, days) {
        this.updateOpensColumnHeaders('stats-top', days);
        const subset = this.filterByPeriod(bookmarks, days);

        const top = [...subset]
            .filter((b) => Number(b?.openCount || 0) > 0)
            .sort((a, b) => Number(b.openCount || 0) - Number(a.openCount || 0))
            .slice(0, 20);

        this.clearTable('stats-top-opens-body');
        if (top.length === 0) {
            this.noData('stats-top-opens-body', 5);
        } else {
            const maxOpens = Number(top[0]?.openCount || 0);
            top.forEach((b, i) => {
                this.appendRow('stats-top-opens-body', [
                    String(i + 1),
                    String(b.name || '—'),
                    String(Number(b.openCount || 0)),
                    this.pageName(pages, b.pageId),
                    this.formatWhen(b.lastOpened, locale)
                ], { rankCol: 0, barCol: 2, barPct: maxOpens > 0 ? Math.round((Number(b.openCount||0)/maxOpens)*100) : 0, bookmark: b });
            });
        }

        const recent = [...subset]
            .filter((b) => Number(b?.lastOpened || 0) > 0)
            .sort((a, b) => Number(b.lastOpened || 0) - Number(a.lastOpened || 0))
            .slice(0, 20);

        this.clearTable('stats-recent-opens-body');
        if (recent.length === 0) {
            this.noData('stats-recent-opens-body', 4);
        } else {
            recent.forEach((b) => {
                this.appendRow('stats-recent-opens-body', [
                    String(b.name || '—'),
                    String(Number(b.openCount || 0)),
                    this.pageName(pages, b.pageId),
                    this.formatWhen(b.lastOpened, locale)
                ], { bookmark: b });
            });
        }
    }

    // ── Pages ──────────────────────────────────────────────────────────────

    renderPagesBlock(bookmarks, pages, days) {
        this.updateOpensColumnHeaders('stats-pages', days);
        const tbodyId = 'stats-pages-body';
        this.clearTable(tbodyId);
        if (!bookmarks.length || !pages.length) { this.noData(tbodyId, 4); return; }

        const cutoff = days ? Date.now() - days * 86400000 : 0;

        const map = new Map();
        pages.forEach((p) => map.set(Number(p.id), {
            name: p.name || this.pageName(pages, p.id),
            count: 0, opens: 0, never: 0,
        }));
        bookmarks.forEach((b) => {
            const pid = Number(b?.pageId) || 0;
            if (!map.has(pid)) return;
            const e = map.get(pid);
            e.count += 1;
            const lo = Number(b?.lastOpened || 0);
            if (!cutoff || lo >= cutoff) e.opens += Number(b?.openCount || 0);
            if (!Number(b?.openCount) && !Number(b?.lastOpened)) e.never += 1;
        });

        const rows = [...map.values()].sort((a, b) => b.opens - a.opens || b.count - a.count);
        const maxOpens = Math.max(...rows.map((r) => r.opens), 1);
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;

        rows.forEach((row) => {
            const tr = document.createElement('tr');
            // Page name with bar
            const tdName = document.createElement('td');
            tdName.className = 'stats-bar-cell';
            if (row.opens > 0) {
                const fill = document.createElement('span');
                fill.className = 'stats-bar-cell-fill';
                fill.style.width = `${Math.round((row.opens / maxOpens) * 100)}%`;
                tdName.appendChild(fill);
            }
            const lbl = document.createElement('span');
            lbl.className = 'stats-bar-cell-text';
            lbl.textContent = row.name;
            tdName.appendChild(lbl);
            tr.appendChild(tdName);

            [String(row.count), String(row.opens), String(row.never)].forEach((txt) => {
                const td = document.createElement('td');
                td.textContent = txt;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    // ── Categories ─────────────────────────────────────────────────────────

    renderCategoriesBlock(bookmarks, pages, days) {
        this.updateOpensColumnHeaders('stats-categories', days);
        const tbodyId = 'stats-categories-body';
        this.clearTable(tbodyId);
        if (!bookmarks.length) { this.noData(tbodyId, 4); return; }

        const cutoff = days ? Date.now() - days * 86400000 : 0;
        const map = new Map();
        bookmarks.forEach((b) => {
            const pid = Number(b?.pageId) || 0;
            const cat = String(b?.category || '').trim() || this.uncategorizedLabel();
            const key = `${pid}::${cat}`;
            const e = map.get(key) || { pageId: pid, cat, count: 0, opens: 0 };
            e.count += 1;
            const lo = Number(b?.lastOpened || 0);
            if (!cutoff || lo >= cutoff) e.opens += Number(b?.openCount || 0);
            map.set(key, e);
        });

        const rows = [...map.values()].sort((a, b) => b.opens - a.opens || b.count - a.count);
        const maxOpens = Math.max(...rows.map((r) => r.opens), 1);
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;

        rows.forEach((row) => {
            const tr = document.createElement('tr');
            const tdCat = document.createElement('td');
            tdCat.className = 'stats-bar-cell';
            if (row.opens > 0) {
                const bar = document.createElement('span');
                bar.className = 'stats-bar-cell-fill';
                bar.style.width = `${Math.round((row.opens / maxOpens) * 100)}%`;
                tdCat.appendChild(bar);
            }
            const lbl = document.createElement('span');
            lbl.className = 'stats-bar-cell-text';
            lbl.textContent = row.cat;
            tdCat.appendChild(lbl);
            tr.appendChild(tdCat);

            [this.pageName(pages, row.pageId), String(row.count), String(row.opens)].forEach((txt) => {
                const td = document.createElement('td');
                td.textContent = txt;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    // ── Tags ───────────────────────────────────────────────────────────────

    renderTagsBlock(bookmarks, pages, days) {
        this.updateOpensColumnHeaders('stats-tags', days);
        const total = bookmarks.length;
        const cutoff = days ? Date.now() - days * 86400000 : 0;
        const tagMap = new Map();
        let taggedCount = 0;
        let tagAssignments = 0;
        let multiTagCount = 0;

        bookmarks.forEach((b) => {
            const tags = Array.isArray(b?.tags)
                ? b.tags.map((t) => String(t || '').trim()).filter(Boolean)
                : [];
            if (tags.length === 0) return;

            taggedCount += 1;
            tagAssignments += tags.length;
            if (tags.length > 1) multiTagCount += 1;

            const lo = Number(b?.lastOpened || 0);
            const opens = !cutoff || lo >= cutoff ? Number(b?.openCount || 0) : 0;
            const pageId = Number(b?.pageId) || 0;

            tags.forEach((raw) => {
                const key = raw.toLowerCase();
                const entry = tagMap.get(key) || {
                    label: raw,
                    count: 0,
                    opens: 0,
                    pageIds: new Set(),
                };
                if (!entry.label) entry.label = raw;
                entry.count += 1;
                entry.opens += opens;
                if (pageId) entry.pageIds.add(pageId);
                tagMap.set(key, entry);
            });
        });

        const uniqueTags = tagMap.size;
        const pct = total > 0 ? Math.round((taggedCount / total) * 100) : 0;
        const avgTags = taggedCount > 0 ? Math.round((tagAssignments / taggedCount) * 10) / 10 : 0;

        const fill = document.getElementById('stats-tag-bar-fill');
        const label = document.getElementById('stats-tag-bar-label');
        if (fill) fill.style.width = `${pct}%`;
        if (label) {
            label.textContent = this.t('config.statsTagCoverage')
                .replace('{count}', taggedCount)
                .replace('{total}', total)
                .replace('{pct}', pct);
        }

        this.setText('stats-tags-unique-count', String(uniqueTags));
        this.setText('stats-tags-tagged-count', String(taggedCount));
        this.setText('stats-tags-untagged-count', String(Math.max(0, total - taggedCount)));
        this.setText('stats-tags-avg-count', String(avgTags));
        this.setText('stats-tags-multi-count', String(multiTagCount));

        const tbodyId = 'stats-tags-body';
        this.clearTable(tbodyId);
        const rows = [...tagMap.values()].sort((a, b) => b.count - a.count || b.opens - a.opens);
        if (rows.length === 0) {
            this.noData(tbodyId, 4);
        } else {
            const maxCount = Math.max(...rows.map((r) => r.count), 1);
            const tbody = document.getElementById(tbodyId);
            if (tbody) {
                rows.slice(0, 25).forEach((row) => {
                    const tr = document.createElement('tr');
                    const tdTag = document.createElement('td');
                    tdTag.className = 'stats-bar-cell';
                    if (row.count > 0) {
                        const bar = document.createElement('span');
                        bar.className = 'stats-bar-cell-fill';
                        bar.style.width = `${Math.round((row.count / maxCount) * 100)}%`;
                        tdTag.appendChild(bar);
                    }
                    const lbl = document.createElement('span');
                    lbl.className = 'stats-bar-cell-text';
                    lbl.textContent = row.label;
                    tdTag.appendChild(lbl);
                    tr.appendChild(tdTag);

                    [
                        String(row.count),
                        String(row.opens),
                        String(row.pageIds.size),
                    ].forEach((txt) => {
                        const td = document.createElement('td');
                        td.textContent = txt;
                        tr.appendChild(td);
                    });
                    tbody.appendChild(tr);
                });
            }
        }

        const topTaggedId = 'stats-top-tagged-body';
        this.clearTable(topTaggedId);
        const taggedSubset = this.filterByPeriod(bookmarks, days);
        const topTagged = taggedSubset
            .filter((b) => Array.isArray(b?.tags) && b.tags.some((t) => String(t || '').trim()))
            .sort((a, b) => Number(b?.openCount || 0) - Number(a?.openCount || 0))
            .slice(0, 20);

        if (topTagged.length === 0) {
            this.noData(topTaggedId, 4);
        } else {
            topTagged.forEach((b) => {
                const tags = b.tags.map((t) => String(t || '').trim()).filter(Boolean);
                this.appendRow(topTaggedId, [
                    String(b.name || '—'),
                    tags.join(', ') || '—',
                    String(Number(b.openCount || 0)),
                    this.pageName(pages, b.pageId),
                ], { bookmark: b });
            });
        }
    }

    // ── Shortcuts ──────────────────────────────────────────────────────────

    renderShortcutsBlock(bookmarks, pages) {
        const total  = bookmarks.length;
        const withSc = bookmarks.filter((b) => String(b?.shortcut || '').trim());
        const pct    = total > 0 ? Math.round((withSc.length / total) * 100) : 0;

        const fill  = document.getElementById('stats-shortcut-bar-fill');
        const label = document.getElementById('stats-shortcut-bar-label');
        if (fill)  fill.style.width   = `${pct}%`;
        if (label) label.textContent  = this.t('config.statsShortcutCoverage')
            .replace('{count}', withSc.length)
            .replace('{total}', total)
            .replace('{pct}', pct);

        const tbodyId = 'stats-shortcuts-body';
        this.clearTable(tbodyId);
        const top = [...withSc].sort((a, b) => Number(b?.openCount || 0) - Number(a?.openCount || 0)).slice(0, 20);
        if (top.length === 0) { this.noData(tbodyId, 4); return; }
        top.forEach((b) => {
            this.appendRow(tbodyId, [
                String(b.shortcut || '—'),
                String(b.name || '—'),
                String(Number(b.openCount || 0)),
                this.pageName(pages, b.pageId)
            ], { bookmark: b });
        });
    }

    // ── Rot & cleanup ──────────────────────────────────────────────────────

    renderRotBlock(bookmarks, pages, locale, days) {
        const now    = Date.now();
        const cutoff = days ? now - days * 86400000 : 0;

        const neverOpened = bookmarks.filter(
            (b) => !Number(b?.openCount) && !Number(b?.lastOpened)
        );
        const stale = cutoff
            ? bookmarks.filter((b) => {
                const lo = Number(b?.lastOpened || 0);
                return lo > 0 && lo < cutoff;
            })
            : [];
        const recentlyAdded = cutoff
            ? bookmarks.filter((b) => {
                const added = Number(b?.addedAt || b?.createdAt || b?.created || b?.added || 0);
                return added > 0 && added >= cutoff;
            })
            : [];

        this.setText('stats-never-opened',      String(neverOpened.length));
        this.setText('stats-stale-count',        String(stale.length));
        this.setText('stats-recently-added-count', String(recentlyAdded.length));

        // Never opened table
        const neverId = 'stats-never-opened-body';
        this.clearTable(neverId);
        if (neverOpened.length === 0) {
            this.noData(neverId, 4);
        } else {
            neverOpened.slice(0, 30).forEach((b) => {
                const added = Number(b?.addedAt || b?.createdAt || b?.created || b?.added || 0);
                this.appendRow(neverId, [
                    String(b.name || '—'),
                    this.pageName(pages, b.pageId),
                    String(b.category || '—'),
                    added ? this.formatWhen(added, locale) : '—'
                ], { bookmark: b });
            });
        }

        // Stale table
        const staleId = 'stats-stale-body';
        this.clearTable(staleId);
        if (stale.length === 0) {
            this.noData(staleId, 4);
        } else {
            [...stale]
                .sort((a, b) => Number(a?.lastOpened || 0) - Number(b?.lastOpened || 0))
                .slice(0, 30)
                .forEach((b) => {
                    this.appendRow(staleId, [
                        String(b.name || '—'),
                        this.pageName(pages, b.pageId),
                        String(Number(b.openCount || 0)),
                        this.formatWhen(b.lastOpened, locale)
                    ], { bookmark: b });
                });
        }
    }

    // ── Conflicts ──────────────────────────────────────────────────────────

    renderConflictsBlock(bookmarks) {
        const urlMap = new Map();
        bookmarks.forEach((b) => {
            const url = String(b?.url || '').trim().toLowerCase();
            if (url) urlMap.set(url, (urlMap.get(url) || 0) + 1);
        });
        const duplicateUrlCount = [...urlMap.values()].filter((c) => c > 1).length;

        const scMap = new Map();
        bookmarks.forEach((b) => {
            const sc = String(b?.shortcut || '').trim().toLowerCase();
            if (sc) scMap.set(sc, (scMap.get(sc) || 0) + 1);
        });
        const conflicting     = [...scMap.entries()].filter(([, c]) => c > 1);
        const shortcutConflict = conflicting.length;

        this.setText('stats-duplicate-url-count',     String(duplicateUrlCount));
        this.setText('stats-shortcut-conflict-count', String(shortcutConflict));

        const detail = document.getElementById('stats-conflicts-detail');
        if (!detail) return;
        detail.textContent = '';

        if (duplicateUrlCount === 0 && shortcutConflict === 0) {
            const p = document.createElement('p');
            p.className = 'stats-muted';
            p.textContent = this.t('config.statsNoConflictsFound');
            detail.appendChild(p);
            return;
        }

        const duplicateUrls = [...urlMap.entries()].filter(([, c]) => c > 1);
        if (duplicateUrls.length > 0) {
            const p = document.createElement('p');
            p.className = 'stats-muted';
            const labels = duplicateUrls.slice(0, 8).map(([url, c]) => {
                const display = url.length > 50 ? `${url.slice(0, 47)}…` : url;
                return `${display} (×${c})`;
            }).join(', ');
            const more = duplicateUrls.length > 8
                ? this.t('config.statsConflictMore').replace('{count}', duplicateUrls.length - 8)
                : '';
            p.textContent = this.t('config.statsDuplicateUrlsDetail')
                .replace('{labels}', labels)
                .replace('{more}', more);
            detail.appendChild(p);
        }

        if (conflicting.length > 0) {
            const p = document.createElement('p');
            p.className = 'stats-muted';
            p.style.marginTop = duplicateUrls.length > 0 ? '0.5rem' : '0';
            const labels = conflicting.slice(0, 8).map(([sc, c]) => `${sc} (×${c})`).join(', ');
            const more   = conflicting.length > 8
                ? this.t('config.statsConflictMore').replace('{count}', conflicting.length - 8)
                : '';
            p.textContent = this.t('config.statsConflictingShortcuts')
                .replace('{labels}', labels)
                .replace('{more}', more);
            detail.appendChild(p);
        }
    }

    // ── Insights ─────────────────────────────────────────────────────────

    renderInsightsBlock(bookmarks, pages) {
        const list = document.getElementById('stats-insights-list');
        if (!list) return;
        list.textContent = '';

        const total = bookmarks.length;
        if (total === 0) {
            const li = document.createElement('li');
            li.className = 'stats-muted';
            li.textContent = this.t('config.statsNoData');
            list.appendChild(li);
            return;
        }

        const items = [];
        const pageOpens = new Map();
        pages.forEach((p) => {
            pageOpens.set(Number(p.id), { name: this.pageName(pages, p.id), opens: 0 });
        });
        bookmarks.forEach((b) => {
            const pid = Number(b?.pageId) || 0;
            if (!pageOpens.has(pid)) return;
            pageOpens.get(pid).opens += Number(b?.openCount || 0);
        });
        const topPage = [...pageOpens.values()].sort((a, b) => b.opens - a.opens)[0];
        if (topPage && topPage.opens > 0) {
            items.push({
                text: this.t('config.statsInsightTopPage')
                    .replace('{page}', topPage.name)
                    .replace('{opens}', String(topPage.opens)),
                actionHref: '#stats-pages',
                actionKey: 'statsActionOpenTopPage',
            });
        }

        const topBm = [...bookmarks].sort((a, b) => Number(b?.openCount || 0) - Number(a?.openCount || 0))[0];
        if (topBm && Number(topBm.openCount) > 0) {
            items.push({
                text: this.t('config.statsInsightTopBookmark')
                    .replace('{name}', String(topBm.name || '—'))
                    .replace('{count}', String(Number(topBm.openCount))),
                actionHref: '#stats-top',
                actionKey: 'statsActionOpenTopBookmark',
            });
        }

        const neverOpened = bookmarks.filter((b) => !Number(b?.openCount) && !Number(b?.lastOpened)).length;
        if (neverOpened > 0) {
            items.push({
                text: this.t('config.statsInsightNeverOpened')
                    .replace('{percent}', String(Math.round((neverOpened / total) * 100)))
                    .replace('{count}', String(neverOpened))
                    .replace('{total}', String(total)),
                actionHref: '#stats-rot',
                actionKey: 'statsActionReviewNeverOpened',
            });
        }

        const statusCount = bookmarks.filter((b) => b?.checkStatus === true).length;
        items.push({
            text: this.t('config.statsInsightStatusCoverage')
                .replace('{percent}', String(Math.round((statusCount / total) * 100)))
                .replace('{count}', String(statusCount))
                .replace('{total}', String(total)),
        });

        const cutoff48 = Date.now() - 48 * 3600000;
        const recentCount = bookmarks.filter((b) => Number(b?.lastOpened || 0) >= cutoff48).length;
        if (recentCount > 0) {
            items.push({
                text: this.t('config.statsInsightRecentActivity').replace('{count}', String(recentCount)),
                actionHref: '#stats-activity',
                actionKey: 'statsActionOpen',
            });
        } else {
            items.push({ text: this.t('config.statsInsightNoRecent') });
        }

        items.forEach((item) => {
            const li = document.createElement('li');
            li.className = 'stats-insight-item';
            const span = document.createElement('span');
            span.textContent = item.text;
            li.appendChild(span);
            if (item.actionHref && item.actionKey) {
                const a = document.createElement('a');
                a.href = item.actionHref;
                a.className = 'stats-insight-action';
                a.textContent = this.t(`config.${item.actionKey}`);
                li.appendChild(a);
            }
            list.appendChild(li);
        });
    }

    // ── Finders ──────────────────────────────────────────────────────────

    renderFindersBlock(finders, locale) {
        const list = Array.isArray(finders) ? finders : [];
        const totalUses = list.reduce((s, f) => s + Number(f?.useCount || 0), 0);
        const withShortcut = list.filter((f) => String(f?.shortcut || '').trim()).length;

        this.setText('stats-finders-count', String(list.length));
        this.setText('stats-finders-uses-total', String(totalUses));
        this.setText('stats-finders-with-shortcut', String(withShortcut));

        const tbodyId = 'stats-finders-body';
        this.clearTable(tbodyId);
        const top = [...list].sort((a, b) => Number(b?.useCount || 0) - Number(a?.useCount || 0)).slice(0, 20);
        if (top.length === 0) {
            this.noData(tbodyId, 4);
            return;
        }
        top.forEach((f) => {
            this.appendRow(tbodyId, [
                String(f.name || '—'),
                String(f.shortcut || '—'),
                String(Number(f.useCount || 0)),
                this.formatWhen(f.lastUsed, locale),
            ]);
        });
    }

    bindRefreshButton(manager) {
        const btn = document.getElementById('stats-refresh-btn');
        if (!btn) return;
        const fresh = btn.cloneNode(true);
        btn.replaceWith(fresh);
        fresh.addEventListener('click', () => {
            this.refresh(manager);
            if (typeof manager?.bookmarks?.notify === 'function') {
                manager.bookmarks.notify(this.t('config.statsRefreshDone'), 'success');
            }
        });
    }

    bindExportButton(manager) {
        const btn = document.getElementById('stats-export-csv-btn');
        if (!btn) return;
        const fresh = btn.cloneNode(true);
        btn.replaceWith(fresh);
        fresh.addEventListener('click', () => this.exportStatsCSV(manager, fresh));
    }

    exportStatsCSV(manager, btn) {
        const label = this.t('config.statsExportCsv');
        if (btn) {
            btn.disabled = true;
            btn.textContent = this.t('config.statsExportInProgress');
        }
        try {
            const bookmarks = Array.isArray(manager.allBookmarksData) ? manager.allBookmarksData : [];
            const pages = Array.isArray(manager.pagesData) ? manager.pagesData : [];
            const finders = Array.isArray(manager.findersData) ? manager.findersData : [];
            const locale = manager.settingsData?.language;
            const lines = [];
            const addSection = (title) => {
                if (lines.length) lines.push('');
                lines.push(this.csvEscape(title));
            };

            const catKeys = new Set();
            bookmarks.forEach((b) => {
                catKeys.add(`${Number(b.pageId) || 0}::${String(b.category || '').trim()}`);
            });
            const totalOpens = bookmarks.reduce((s, b) => s + Number(b?.openCount || 0), 0);
            const avg = bookmarks.length > 0 ? Math.round((totalOpens / bookmarks.length) * 10) / 10 : 0;

            addSection(this.t('config.statsNavOverview'));
            lines.push(this.csvRow(this.t('config.statsExportMetric'), this.t('config.statsExportValue')));
            [
                [this.t('config.statsPages'), pages.length],
                [this.t('config.statsCategories'), catKeys.size],
                [this.t('config.statsBookmarksTotal'), bookmarks.length],
                [this.t('config.statsAvgOpensLabel'), avg],
            ].forEach(([k, v]) => lines.push(this.csvRow(k, v)));

            const exportTop = (title, rows, headers, mapRow) => {
                addSection(title);
                lines.push(this.csvRow(...headers));
                rows.forEach((row) => lines.push(this.csvRow(...mapRow(row))));
            };

            const topDays = this.sectionPeriods.top || 0;
            const topSubset = this.filterByPeriod(bookmarks, topDays);
            const opensHdr = this.opensColLabel(topDays);
            const topOpens = [...topSubset]
                .filter((b) => Number(b?.openCount || 0) > 0)
                .sort((a, b) => Number(b.openCount || 0) - Number(a.openCount || 0))
                .slice(0, 20);
            exportTop(
                this.t('config.statsSubMostOpened'),
                topOpens,
                [this.t('config.statsColName'), opensHdr, this.t('config.statsColPage'), this.t('config.statsColLastOpened')],
                (b) => [b.name || '', Number(b.openCount || 0), this.pageName(pages, b.pageId), this.formatWhen(b.lastOpened, locale)]
            );

            const recent = [...topSubset]
                .filter((b) => Number(b?.lastOpened || 0) > 0)
                .sort((a, b) => Number(b.lastOpened || 0) - Number(a.lastOpened || 0))
                .slice(0, 20);
            exportTop(
                this.t('config.statsSubRecentlyOpened'),
                recent,
                [this.t('config.statsColName'), opensHdr, this.t('config.statsColPage'), this.t('config.statsColLastOpened')],
                (b) => [b.name || '', Number(b.openCount || 0), this.pageName(pages, b.pageId), this.formatWhen(b.lastOpened, locale)]
            );

            const pageDays = this.sectionPeriods.pages || 0;
            const pageCutoff = pageDays ? Date.now() - pageDays * 86400000 : 0;
            const pageMap = new Map();
            pages.forEach((p) => pageMap.set(Number(p.id), {
                name: p.name || this.pageName(pages, p.id),
                count: 0, opens: 0,
            }));
            bookmarks.forEach((b) => {
                const pid = Number(b?.pageId) || 0;
                if (!pageMap.has(pid)) return;
                const e = pageMap.get(pid);
                e.count += 1;
                const lo = Number(b?.lastOpened || 0);
                if (!pageCutoff || lo >= pageCutoff) e.opens += Number(b?.openCount || 0);
            });
            exportTop(
                this.t('config.statsNavPages'),
                [...pageMap.values()].sort((a, b) => b.opens - a.opens),
                [this.t('config.statsColPage'), this.t('config.statsColBookmarks'), this.opensColLabel(pageDays)],
                (r) => [r.name, r.count, r.opens]
            );

            const catDays = this.sectionPeriods.categories || 0;
            const catCutoff = catDays ? Date.now() - catDays * 86400000 : 0;
            const catMap = new Map();
            bookmarks.forEach((b) => {
                const pid = Number(b?.pageId) || 0;
                const cat = String(b?.category || '').trim() || this.uncategorizedLabel();
                const key = `${pid}::${cat}`;
                const e = catMap.get(key) || { cat, pageId: pid, count: 0, opens: 0 };
                e.count += 1;
                const lo = Number(b?.lastOpened || 0);
                if (!catCutoff || lo >= catCutoff) e.opens += Number(b?.openCount || 0);
                catMap.set(key, e);
            });
            exportTop(
                this.t('config.statsNavCategories'),
                [...catMap.values()].sort((a, b) => b.opens - a.opens),
                [this.t('config.statsColCategory'), this.t('config.statsColPage'), this.t('config.statsColBookmarks'), this.opensColLabel(catDays)],
                (r) => [r.cat, this.pageName(pages, r.pageId), r.count, r.opens]
            );

            const withSc = bookmarks.filter((b) => String(b?.shortcut || '').trim());
            exportTop(
                this.t('config.statsSubTopShortcuts'),
                [...withSc].sort((a, b) => Number(b?.openCount || 0) - Number(a?.openCount || 0)).slice(0, 20),
                [this.t('config.statsColShortcut'), this.t('config.statsColName'), this.t('config.statsColOpens'), this.t('config.statsColPage')],
                (b) => [b.shortcut || '', b.name || '', Number(b.openCount || 0), this.pageName(pages, b.pageId)]
            );

            exportTop(
                this.t('config.statsSubTopFinders'),
                [...finders].sort((a, b) => Number(b?.useCount || 0) - Number(a?.useCount || 0)).slice(0, 20),
                [this.t('config.statsColName'), this.t('config.statsColShortcut'), this.t('config.statsColUses'), this.t('config.statsColLastOpened')],
                (f) => [f.name || '', f.shortcut || '', Number(f.useCount || 0), this.formatWhen(f.lastUsed, locale)]
            );

            const neverOpened = bookmarks.filter((b) => !Number(b?.openCount) && !Number(b?.lastOpened));
            exportTop(
                this.t('config.statsSubNeverOpened'),
                neverOpened.slice(0, 30),
                [this.t('config.statsColName'), this.t('config.statsColPage'), this.t('config.statsColCategory'), this.t('config.statsColAdded')],
                (b) => {
                    const added = Number(b?.addedAt || b?.createdAt || b?.created || b?.added || 0);
                    return [b.name || '', this.pageName(pages, b.pageId), b.category || '', added ? this.formatWhen(added, locale) : ''];
                }
            );

            const csv = '\uFEFF' + lines.join('\r\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `nextdash-stats-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(a);

            if (typeof manager?.bookmarks?.notify === 'function') {
                manager.bookmarks.notify(this.t('config.statsExportSuccess'), 'success');
            }
        } catch (e) {
            console.error('Stats CSV export error:', e);
            if (typeof manager?.bookmarks?.notify === 'function') {
                manager.bookmarks.notify(this.t('config.statsExportError'), 'error');
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = label;
            }
        }
    }

    // ── Search & status ────────────────────────────────────────────────────

    renderSearchStatus(settings, bookmarks) {
        const statusCheckCount = bookmarks.filter((b) => b?.checkStatus === true).length;
        const idxKnown = Object.prototype.hasOwnProperty.call(settings, 'searchIndexed');
        this.setText('stats-search-indexed',    idxKnown ? this.yn(Boolean(settings.searchIndexed)) : '—');
        this.setText('stats-interleave',        this.yn(Boolean(settings.interleaveMode)));
        this.setText('stats-fuzzy',             this.yn(Boolean(settings.enableFuzzySuggestions)));
        this.setText('stats-show-status',       this.yn(Boolean(settings.showStatus)));
        this.setText('stats-status-check-count', String(statusCheckCount));
    }

    // ── Inbox ──────────────────────────────────────────────────────────────

    /** Fetch inbox snapshot + durable aggregate, then render the inbox block. */
    async loadInboxData(locale) {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const [itemsRes, statsRes] = await Promise.allSettled([
            fetcher('/api/inbox'),
            fetcher('/api/inbox-stats'),
        ]);
        try {
            if (itemsRes.status === 'fulfilled' && itemsRes.value.ok) {
                const body = await itemsRes.value.json();
                this._inboxItems = Array.isArray(body?.items) ? body.items : [];
            }
        } catch { this._inboxItems = []; }
        try {
            if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
                this._inboxStats = await statsRes.value.json();
            }
        } catch { this._inboxStats = null; }
        this.renderInboxBlock(locale);
        // Keep the overview inbox tiles in sync once data lands.
        const items = Array.isArray(this._inboxItems) ? this._inboxItems : [];
        this.setText('stats-overview-inbox-total',  String(items.length));
        this.setText('stats-overview-inbox-unread', String(items.filter((it) => !Number(it?.readAt)).length));
        this.applyTableFilter();
    }

    formatDurationShort(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return '—';
        const days = n / 86400000;
        if (days >= 1) {
            const d = Math.round(days);
            return this.t('config.statsInboxDaysUnit').replace('{n}', String(d));
        }
        const hours = n / 3600000;
        if (hours >= 1) {
            return this.t('config.statsInboxHoursUnit').replace('{n}', String(Math.round(hours)));
        }
        const mins = Math.max(1, Math.round(n / 60000));
        return this.t('config.statsInboxMinutesUnit').replace('{n}', String(mins));
    }

    renderInboxBlock(locale) {
        const items = Array.isArray(this._inboxItems) ? this._inboxItems : [];
        const stats = this._inboxStats || {};
        const now = Date.now();

        // ── Snapshot (current inbox) ──
        const unread = items.filter((it) => !Number(it?.readAt));
        const read = items.length - unread.length;
        const oldestUnreadAt = unread.reduce((min, it) => {
            const added = Number(it?.addedAt || 0);
            return added > 0 && added < min ? added : min;
        }, Number.POSITIVE_INFINITY);
        const backlogCutoff = now - 30 * 86400000;
        const backlog = unread.filter((it) => Number(it?.addedAt || 0) > 0 && Number(it.addedAt) < backlogCutoff).length;

        const withTags = items.filter((it) => Array.isArray(it?.tags) && it.tags.some((t) => String(t || '').trim())).length;
        const withNote = items.filter((it) => String(it?.note || '').trim()).length;
        const withPreview = items.filter((it) => String(it?.previewImage || '').trim()).length;

        this.setText('stats-inbox-total',  String(items.length));
        this.setText('stats-inbox-unread', String(unread.length));
        this.setText('stats-inbox-oldest-unread',
            Number.isFinite(oldestUnreadAt) ? this.formatDurationShort(now - oldestUnreadAt) : '—');
        this.setText('stats-inbox-backlog', String(backlog));
        this.setText('stats-inbox-read', String(read));
        this.setText('stats-inbox-with-tags', String(withTags));
        this.setText('stats-inbox-with-note', String(withNote));
        this.setText('stats-inbox-with-preview', String(withPreview));

        // ── Lifetime (durable aggregate) ──
        const added = Number(stats.totalAdded || 0);
        const promoted = Number(stats.totalPromoted || 0);
        const deleted = Number(stats.totalDeleted || 0);
        const triaged = promoted + deleted;
        const conversionPct = triaged > 0 ? Math.round((promoted / triaged) * 100) : 0;

        const fill = document.getElementById('stats-inbox-conversion-fill');
        const label = document.getElementById('stats-inbox-conversion-label');
        if (fill) fill.style.width = `${conversionPct}%`;
        if (label) {
            label.textContent = this.t('config.statsInboxConversion')
                .replace('{promoted}', String(promoted))
                .replace('{triaged}', String(triaged))
                .replace('{pct}', String(conversionPct));
        }

        this.setText('stats-inbox-added',    String(added));
        this.setText('stats-inbox-promoted', String(promoted));
        this.setText('stats-inbox-deleted',  String(deleted));
        const avgRetention = Number(stats.retentionCount || 0) > 0
            ? Number(stats.sumRetentionMs || 0) / Number(stats.retentionCount)
            : 0;
        this.setText('stats-inbox-avg-retention', this.formatDurationShort(avgRetention));

        const sinceEl = document.getElementById('stats-inbox-since');
        if (sinceEl) {
            const firstAt = Number(stats.firstEventAt || 0);
            if (firstAt > 0) {
                sinceEl.hidden = false;
                sinceEl.textContent = this.t('config.statsInboxSince')
                    .replace('{date}', this.formatWhen(firstAt, locale));
            } else {
                sinceEl.hidden = true;
                sinceEl.textContent = '';
            }
        }

        // ── Sources table (current in inbox vs lifetime added) ──
        const currentBySource = new Map();
        items.forEach((it) => {
            const src = String(it?.source || '').trim().toLowerCase() || 'unknown';
            currentBySource.set(src, (currentBySource.get(src) || 0) + 1);
        });
        const lifetimeBySource = new Map(
            Object.entries(stats.bySource || {}).map(([k, v]) => [String(k).toLowerCase(), Number(v) || 0])
        );
        const sourceKeys = new Set([...currentBySource.keys(), ...lifetimeBySource.keys()]);
        const sourceRows = [...sourceKeys]
            .map((src) => ({ src, current: currentBySource.get(src) || 0, lifetime: lifetimeBySource.get(src) || 0 }))
            .sort((a, b) => b.lifetime - a.lifetime || b.current - a.current);

        this.clearTable('stats-inbox-sources-body');
        if (sourceRows.length === 0) {
            this.noData('stats-inbox-sources-body', 3);
        } else {
            const maxLifetime = Math.max(...sourceRows.map((r) => r.lifetime), 1);
            sourceRows.forEach((row) => {
                this.appendRow('stats-inbox-sources-body', [
                    this.inboxSourceLabel(row.src),
                    String(row.current),
                    String(row.lifetime),
                ], { barCol: 2, barPct: Math.round((row.lifetime / maxLifetime) * 100) });
            });
        }

        // ── Top domains in current inbox ──
        const domainMap = new Map();
        items.forEach((it) => {
            const domain = String(it?.domain || '').trim().toLowerCase();
            if (!domain) return;
            domainMap.set(domain, (domainMap.get(domain) || 0) + 1);
        });
        const domainRows = [...domainMap.entries()]
            .map(([domain, count]) => ({ domain, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

        this.clearTable('stats-inbox-domains-body');
        if (domainRows.length === 0) {
            this.noData('stats-inbox-domains-body', 2);
        } else {
            const maxCount = Math.max(...domainRows.map((r) => r.count), 1);
            domainRows.forEach((row) => {
                this.appendRow('stats-inbox-domains-body', [
                    row.domain,
                    String(row.count),
                ], { barCol: 1, barPct: Math.round((row.count / maxCount) * 100) });
            });
        }

        this.renderInboxTrend(this.sectionPeriods.inbox || 30);
    }

    inboxSourceLabel(src) {
        const key = {
            paste: 'statsInboxSourcePaste',
            extension: 'statsInboxSourceExtension',
            api: 'statsInboxSourceApi',
            unknown: 'statsInboxSourceUnknown',
        }[src];
        if (!key) return src;
        const val = this.t(`config.${key}`);
        return val && !val.startsWith('config.') ? val : src;
    }

    /** Trend sparkline: added vs. triaged (promoted+deleted) per bucket, matching renderActivity visuals. */
    renderInboxTrend(days) {
        const wrap = document.getElementById('stats-inbox-sparkline');
        if (!wrap) return;
        wrap.textContent = '';

        const buckets = (this._inboxStats && this._inboxStats.dailyBuckets) || {};
        const period = Number(days) || 30;
        const bucketCount = period === 7 ? 7 : period === 90 ? 9 : 5;
        const bucketDays = period / bucketCount;
        const now = Date.now();
        const cutoff = now - period * 86400000;

        const addedBuckets = Array(bucketCount).fill(0);
        const triagedBuckets = Array(bucketCount).fill(0);
        Object.entries(buckets).forEach(([day, counts]) => {
            const ts = Date.parse(`${day}T00:00:00Z`);
            if (!Number.isFinite(ts) || ts < cutoff) return;
            const age = now - ts;
            const idx = Math.floor(age / (bucketDays * 86400000));
            const bucketIdx = bucketCount - 1 - Math.min(idx, bucketCount - 1);
            addedBuckets[bucketIdx] += Number(counts?.added || 0);
            triagedBuckets[bucketIdx] += Number(counts?.promoted || 0) + Number(counts?.deleted || 0);
        });

        const maxVal = Math.max(...addedBuckets, ...triagedBuckets, 1);
        const W = 500, H = 72, gap = 3;
        const groupW = Math.floor((W - gap * (bucketCount - 1)) / bucketCount);
        const barW = Math.max(2, Math.floor((groupW - 2) / 2));

        const rects = [];
        for (let i = 0; i < bucketCount; i++) {
            const gx = i * (groupW + gap);
            const addH = Math.round((addedBuckets[i] / maxVal) * H);
            const triH = Math.round((triagedBuckets[i] / maxVal) * H);
            rects.push(`<rect x="${gx}" y="${H - addH}" width="${barW}" height="${Math.max(addH, addedBuckets[i] > 0 ? 2 : 0)}" fill="var(--accent-primary)" opacity="0.85" rx="1"/>`);
            rects.push(`<rect x="${gx + barW + 2}" y="${H - triH}" width="${barW}" height="${Math.max(triH, triagedBuckets[i] > 0 ? 2 : 0)}" fill="var(--accent-success)" opacity="0.85" rx="1"/>`);
        }

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('height', '72');
        svg.setAttribute('role', 'img');
        const totalAdded = addedBuckets.reduce((s, v) => s + v, 0);
        const totalTriaged = triagedBuckets.reduce((s, v) => s + v, 0);
        svg.setAttribute('aria-label', this.t('config.statsInboxSparklineAria')
            .replace('{added}', String(totalAdded))
            .replace('{triaged}', String(totalTriaged)));
        svg.style.cssText = 'display:block;width:100%;';
        svg.innerHTML = rects.join('');
        wrap.appendChild(svg);

        // Accessible table equivalent.
        const srTable = document.createElement('table');
        srTable.className = 'stats-sr-only';
        const tbody = document.createElement('tbody');
        for (let i = 0; i < bucketCount; i++) {
            const tr = document.createElement('tr');
            [String(i + 1), String(addedBuckets[i]), String(triagedBuckets[i])].forEach((txt) => {
                const td = document.createElement('td');
                td.textContent = txt;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        }
        srTable.appendChild(tbody);
        wrap.appendChild(srTable);

        // Legend (added vs triaged), reusing muted text style.
        const legend = document.createElement('div');
        legend.className = 'stats-inbox-legend';
        legend.setAttribute('aria-hidden', 'true');
        legend.innerHTML = `
            <span class="stats-inbox-legend-item"><span class="stats-inbox-legend-swatch" style="background:var(--accent-primary)"></span>${this.escapeForLegend(this.t('config.statsInboxLegendAdded'))}</span>
            <span class="stats-inbox-legend-item"><span class="stats-inbox-legend-swatch" style="background:var(--accent-success)"></span>${this.escapeForLegend(this.t('config.statsInboxLegendTriaged'))}</span>
        `;
        wrap.appendChild(legend);
    }

    escapeForLegend(text) {
        return String(text ?? '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    // ── Main entry point ───────────────────────────────────────────────────

    refresh(manager) {
        this.lastManager = manager;
        const bookmarks = Array.isArray(manager.allBookmarksData) ? manager.allBookmarksData : [];
        const pages     = Array.isArray(manager.pagesData)        ? manager.pagesData        : [];
        const settings  = manager.settingsData || {};
        const locale    = settings.language || undefined;

        this.renderOverview(bookmarks, pages, manager);
        this.renderInsightsBlock(bookmarks, pages);
        this.renderCleanupScore(bookmarks);
        this.renderActivity(bookmarks, this.sectionPeriods.activity, locale);
        this.renderTopBookmarks(bookmarks, pages, locale, this.sectionPeriods.top);
        this.renderPagesBlock(bookmarks, pages, this.sectionPeriods.pages);
        this.renderCategoriesBlock(bookmarks, pages, this.sectionPeriods.categories);
        this.renderTagsBlock(bookmarks, pages, this.sectionPeriods.tags);
        this.renderShortcutsBlock(bookmarks, pages);
        this.renderFindersBlock(manager.findersData, locale);
        this.renderRotBlock(bookmarks, pages, locale, this.sectionPeriods.rot);
        this.renderConflictsBlock(bookmarks);
        this.renderSearchStatus(settings, bookmarks);
        void this.loadInboxData(locale);

        const filterInput = document.getElementById('stats-filter-input');
        if (filterInput) {
            this._filterQuery = String(filterInput.value || '').trim().toLowerCase();
        }

        this.bindPeriodButtons(bookmarks, pages, locale);
        this.bindInfoButtons();
        this.bindRefreshButton(manager);
        this.bindExportButton(manager);
        this.bindTableFilter();
        this.applyTableFilter();
        this.setupBlockCollapsible();
        this.setupExpandCollapseAll();
        this.setupNavClicks();
        this.initScrollspy();
        window.configManager?.ui?.refreshTabBreadcrumb?.('stats');
    }
}

window.ConfigStats = ConfigStats;
