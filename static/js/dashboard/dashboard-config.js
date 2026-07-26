/**
 * Config view — configuration as a dashboard view, modelled on DashboardHealth.
 *
 * Phase 1 (scaffold): this makes `#config` a real in-shell view that opens,
 * owns the URL hash, and renders a placeholder. The section navigation and the
 * status tiles are built in later phases; the lifecycle wiring here is what the
 * shell (dashboard.js, render-core, page-nav) hooks into and does not change.
 */
class DashboardConfig {
    static VIEW = 'config';

    /**
     * The regrouped sections that replace the old config tabs. `overview` is the
     * landing section (a summary of tiles from every other section); the rest map
     * to the reorganised areas agreed for the view.
     */
    static SECTIONS = [
        'overview',
        'pages-tags',
        'bookmarks',
        'appearance',
        'behavior',
        'data-backups',
        'stats',
        'help',
    ];

    constructor(dashboard) {
        this.dash = dashboard;
        this.section = 'overview';
        this.loading = false;
        this._loadPromise = null;
        // Pages & tags sub-tab (finders/tags/collections native; pages/categories embedded).
        this.ptTab = 'finders';
        this._finders = null;
        // Behavior sub-tab.
        this.behaviorTab = 'general';
        // Bookmarks section: search, filters, sort, the row being edited, the
        // ticked rows for bulk actions, and whether the open editor has unsaved
        // changes (so Save can be offered rather than saving on every keystroke).
        this.bmQuery = '';
        this.bmPageFilter = '';
        this.bmCategoryFilter = '';
        this.bmSort = 'page';
        this.bmEditing = null;
        this.bmDirty = false;
        this.bmSelected = new Set();
        // Statistics: undefined while the health fetch is in flight, null on failure.
        this._statsHealth = undefined;
        // How far back the activity chart looks, in days.
        this.statsRange = 30;
        // Latest release for the overview: undefined until fetched, null on failure.
        this._latestRelease = undefined;
    }

    isEnabled() {
        // Config is always reachable; the header may hide its entry point, but the
        // view itself is never feature-gated the way health/inbox can be.
        return true;
    }

    isActiveView() {
        return this.dash.activeView === DashboardConfig.VIEW;
    }

    /**
     * `key` is the full dotted key ('config.something'). Mirrors the health view's
     * translation helper so both surfaces resolve labels the same way.
     */
    t(key, fallback) {
        const d = this.dash;
        const translated = d.language?.t?.(key);
        if (translated && translated !== key) {
            return translated;
        }
        return fallback != null ? fallback : key;
    }

    /* ── Hash / deep linking ───────────────────────────────────────────────── */

    /** Normalise a hash like `config/appearance` into a known section. */
    static sectionFromHash(hash) {
        if (typeof hash !== 'string') return null;
        const raw = hash.replace(/^#/, '');
        if (raw === 'config') return 'overview';
        const match = raw.match(/^config\/([a-z-]+)$/);
        if (!match) return null;
        return DashboardConfig.SECTIONS.includes(match[1]) ? match[1] : 'overview';
    }

    hashForSection(section) {
        if (!section || section === 'overview') return 'config';
        return `config/${section}`;
    }

    restoreConfigHash() {
        const wanted = `#${this.hashForSection(this.section)}`;
        if (window.location.hash !== wanted) {
            history.replaceState(
                history.state,
                '',
                `${window.location.pathname}${window.location.search}${wanted}`
            );
        }
    }

    /** Re-apply the section from the hash while the view is already open. */
    restoreConfigSectionFromHash() {
        const section = DashboardConfig.sectionFromHash(window.location.hash);
        if (section && section !== this.section) {
            this.section = section;
            this.render();
        }
    }

    /* ── View lifecycle ────────────────────────────────────────────────────── */

    async openConfigView(section) {
        const d = this.dash;
        if (!this.isEnabled()) {
            return false;
        }
        const targetSection =
            section || DashboardConfig.sectionFromHash(window.location.hash) || 'overview';
        if (d.activeView === DashboardConfig.VIEW) {
            if (targetSection !== this.section) {
                this.section = targetSection;
                this.render();
                this.restoreConfigHash();
            }
            return true;
        }
        if (d.isInlineEditActive() && !(await d.confirmInlineEditBeforeNavigation())) {
            return false;
        }
        d._abortInlineEditForRender?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        d.inbox?.clearKeyboardSelection?.();
        d.health?.clearKeyboardSelection?.();
        this.section = targetSection;
        d.activeView = DashboardConfig.VIEW;
        window.nextdashTrack?.('view:config');
        d.pageNav?.setActiveConfigTab?.();
        d.pageNav?.updateDocumentTitle?.();
        await this.loadAndRender();
        this.restoreConfigHash();
        return true;
    }

    closeConfigView() {
        const d = this.dash;
        if (d.activeView !== DashboardConfig.VIEW) {
            return false;
        }
        // The save indicator lives on <body>, so leaving the view has to take it
        // down; otherwise a "Saved" would linger over the dashboard.
        clearTimeout(this._saveStateTimer);
        document.getElementById('config-save-state')?.remove();
        const restored = d.pageNav?.restoreBookmarksViewForPage?.(d.currentPageId) ?? false;
        if (restored) {
            d.keyboardNavigation?.scheduleUpdate?.();
        }
        return restored;
    }

    async loadAndRender() {
        // Phase 1 has no async data of its own yet; kept async so later phases can
        // fetch settings/stats here without touching the shell wiring.
        this.render();
    }

    setupEscapeShortcut() {
        // Escape returns to the bookmarks view, matching health and inbox.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!this.isActiveView()) return;
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) {
                return;
            }
            e.preventDefault();
            this.closeConfigView();
        });
    }

    /* ── Render ────────────────────────────────────────────────────────────── */

    /** Human labels for the section rail. */
    sectionLabel(section) {
        const map = {
            overview: ['config.sectionOverview', 'Overview'],
            'pages-tags': ['config.sectionPagesTags', 'Pages & tags'],
            bookmarks: ['config.sectionBookmarks', 'Bookmarks'],
            appearance: ['config.sectionAppearance', 'Appearance'],
            behavior: ['config.sectionBehavior', 'Behavior'],
            'data-backups': ['config.sectionDataBackups', 'Data & backups'],
            stats: ['config.sectionStats', 'Statistics'],
            help: ['config.sectionHelp', 'Help'],
        };
        const [key, fallback] = map[section] || [section, section];
        return this.t(key, fallback);
    }

    render() {
        const container = document.getElementById('dashboard-layout');
        if (!container) return;
        container.classList.remove('inbox-layout', 'health-layout', 'tag-filter-layout');
        container.classList.add('config-layout', 'page-transition');
        container.innerHTML = this.renderShell();
        // Created up front, not on first save: a live region has to be in the
        // document before its text changes, or the change is not announced.
        this.ensureSaveStateHost();
        this.bindSectionNav(container);
        this.bindTileActions(container);
        if (this.section === 'overview') {
            this.bindOverviewActions(container);
            void this.loadOverviewData();
        } else if (this.section === 'data-backups') {
            this.bindDataBackupsActions(container);
            void this.loadBackupData();
        } else if (this.section === 'appearance') {
            this.bindAppearanceControls(container);
            void this.loadThemeList();
        } else if (this.section === 'behavior') {
            this.bindBehaviorControls(container);
        } else if (this.section === 'pages-tags') {
            this.bindPagesTags(container);
        } else if (this.section === 'bookmarks') {
            this.bindBookmarksSection(container);
        } else if (this.section === 'stats') {
            this.bindStats(container);
            void this.loadStats();
        } else if (this.section === 'help') {
            this.bindHelp(container);
        }
    }

    renderShell() {
        const esc = (v) => this.dash.escapeHtml(v);
        const nav = DashboardConfig.SECTIONS.map((section) => {
            const active = section === this.section;
            return `
                <button type="button" class="config-nav-item${active ? ' is-active' : ''}"
                        role="tab" aria-selected="${active ? 'true' : 'false'}"
                        data-config-section="${esc(section)}">
                    ${esc(this.sectionLabel(section))}
                </button>`;
        }).join('');

        return `
            <div class="config-view">
                <nav class="config-nav" role="tablist" aria-label="${esc(this.t('config.sectionsNavAria', 'Config sections'))}">
                    ${nav}
                </nav>
                <div class="config-view-main">
                    <div class="config-view-head">
                        <h2 class="config-view-section-title">${esc(this.sectionLabel(this.section))}</h2>
                        <!-- The save state itself lives on <body>, not here: this
                             container animates with a transform on view change,
                             which would make it a containing block and pin the
                             fixed indicator to the wrong place. See
                             ensureSaveStateHost(). -->
                    </div>
                    <div class="config-view-body" id="config-view-body">
                        ${this.renderSection()}
                    </div>
                </div>
            </div>
        `;
    }

    renderSection() {
        if (this.section === 'overview') {
            return this.renderOverview();
        }
        if (this.section === 'data-backups') {
            return this.renderDataBackups();
        }
        if (this.section === 'appearance') {
            return this.renderAppearance();
        }
        if (this.section === 'behavior') {
            return this.renderBehavior();
        }
        if (this.section === 'pages-tags') {
            return this.renderPagesTags();
        }
        if (this.section === 'bookmarks') {
            return this.renderBookmarksSection();
        }
        if (this.section === 'stats') {
            return this.renderStats();
        }
        if (this.section === 'help') {
            return this.renderHelp();
        }
        // Other sections are rewritten in later phases; a placeholder keeps the
        // view navigable meanwhile.
        return `<p class="config-view-placeholder">${this.dash.escapeHtml(
            this.t('config.sectionComingSoon', 'This section is being rebuilt.')
        )}</p>`;
    }

    /* ── Overview tiles ────────────────────────────────────────────────────── */

    /**
     * Read-only summary drawn from state the shell already holds, so the tiles
     * never re-derive counts the health/inbox views own.
     */
    overviewTiles() {
        const d = this.dash;
        const summary = d.health?.report?.summary || {};
        const totalBookmarks = Number(summary.totalBookmarks)
            || (Array.isArray(d.allBookmarks) && d.allBookmarks.length)
            || (Array.isArray(d.bookmarks) ? d.bookmarks.length : 0);
        const broken = Number(summary.brokenCount) || 0;
        const duplicate = Number(summary.duplicateCount) || 0;
        const pages = Array.isArray(d.pages) ? d.pages.length : 0;
        const inboxUnread = d.inbox?.unreadCount?.() || 0;

        return [
            {
                key: 'bookmarks', tone: 'accent',
                label: this.t('config.tileBookmarks', 'Bookmarks'),
                value: totalBookmarks,
            },
            {
                key: 'broken', tone: broken > 0 ? 'crit' : 'good',
                label: this.t('config.tileBroken', 'Broken links'),
                value: broken,
                action: broken > 0 ? { view: 'health', filter: 'broken' } : null,
                detail: broken > 0
                    ? this.t('config.tileBrokenReview', 'Review in health')
                    : this.t('config.tileBrokenNone', 'All links healthy'),
            },
            {
                key: 'duplicate', tone: duplicate > 0 ? 'warn' : 'good',
                label: this.t('config.tileDuplicates', 'Duplicates'),
                value: duplicate,
                action: duplicate > 0 ? { view: 'health', filter: 'duplicate' } : null,
            },
            {
                key: 'pages', tone: 'neutral',
                label: this.t('config.tilePages', 'Pages'),
                value: pages,
            },
            {
                key: 'inbox', tone: inboxUnread > 0 ? 'warn' : 'neutral',
                label: this.t('config.tileInboxUnread', 'Inbox unread'),
                value: inboxUnread,
                action: inboxUnread > 0 ? { view: 'inbox' } : null,
            },
        ];
    }

    renderTile(tile) {
        const esc = (v) => this.dash.escapeHtml(v);
        const clickable = tile.action ? ' config-tile--action' : '';
        const tag = tile.action ? 'button' : 'div';
        const attrs = tile.action
            ? ` type="button" data-tile-view="${esc(tile.action.view)}"${
                  tile.action.filter ? ` data-tile-filter="${esc(tile.action.filter)}"` : ''
              }`
            : '';
        const detail = tile.detail
            ? `<p class="config-tile-detail">${esc(tile.detail)}</p>`
            : '';
        return `
            <${tag} class="config-tile config-tile--${esc(tile.tone)}${clickable}"${attrs}>
                <span class="config-tile-label">${esc(tile.label)}</span>
                <span class="config-tile-value">${esc(String(tile.value))}</span>
                ${detail}
            </${tag}>`;
    }

    /**
     * The landing section: a snapshot of the whole install, arranged so the
     * things that need attention come first and everything else reads as
     * context. Each block links on to the view that acts on it, so the overview
     * stays a summary rather than turning into a second place to fix things.
     */
    renderOverview() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tiles = this.overviewTiles().map((t) => this.renderTile(t)).join('');
        const intro = esc(this.t('config.overviewIntro', 'A snapshot of your setup. Tiles that need attention link straight to the view that fixes them.'));

        return `
            <p class="config-view-intro">${intro}</p>
            <div class="config-tiles" role="list">${tiles}</div>
            ${this.renderOverviewAttention()}
            <div class="config-overview-columns">
                ${this.renderOverviewStats()}
                ${this.renderOverviewWhatsNew()}
            </div>
            ${this.renderOverviewTips()}
        `;
    }

    /**
     * What is waiting for you, in one place: broken links, monitors that are
     * down, duplicates, an unread inbox. Only problems appear — a clean install
     * gets a single "nothing needs attention" line instead of five zeroes.
     */
    renderOverviewAttention() {
        const esc = (v) => this.dash.escapeHtml(v);
        const d = this.dash;
        const sum = d.health?.report?.summary || {};
        const inboxUnread = d.inbox?.unreadCount?.() || 0;

        const items = [
            {
                n: Number(sum.brokenCount) || 0, tone: 'crit',
                label: this.t('config.overviewBroken', 'Broken links'),
                cta: this.t('config.overviewFixInHealth', 'Open health'),
                action: { view: 'health', filter: 'broken' },
            },
            {
                n: Number(sum.monitorDownCount) || 0, tone: 'crit',
                label: this.t('config.overviewMonitorsDown', 'Monitors down'),
                cta: this.t('config.overviewFixInHealth', 'Open health'),
                action: { view: 'health', filter: 'monitored' },
            },
            {
                n: inboxUnread, tone: 'warn',
                label: this.t('config.overviewInboxUnread', 'Unread in the inbox'),
                cta: this.t('config.overviewOpenInbox', 'Open inbox'),
                action: { view: 'inbox' },
            },
            {
                n: Number(sum.duplicateCount) || 0, tone: 'warn',
                label: this.t('config.overviewDuplicates', 'Duplicate bookmarks'),
                cta: this.t('config.overviewFixInHealth', 'Open health'),
                action: { view: 'health', filter: 'duplicate' },
            },
            {
                n: Number(sum.shortcutConflictCount) || 0, tone: 'warn',
                label: this.t('config.overviewShortcutConflicts', 'Shortcut conflicts'),
                cta: this.t('config.overviewOpenBookmarks', 'Open bookmarks'),
                action: { section: 'bookmarks' },
            },
            {
                n: Number(sum.uncheckedCount) || 0, tone: 'neutral',
                label: this.t('config.overviewUnchecked', 'Never checked'),
                cta: this.t('config.overviewFixInHealth', 'Open health'),
                action: { view: 'health', filter: 'unchecked' },
            },
        ].filter((i) => i.n > 0);

        const body = items.length
            ? `<ul class="config-attention-list">${items.map((i) => `
                <li class="config-attention-row config-attention-row--${esc(i.tone)}">
                    <span class="config-attention-count">${esc(String(i.n))}</span>
                    <span class="config-attention-label">${esc(i.label)}</span>
                    <button type="button" class="config-btn config-btn--small"
                            data-overview-go='${esc(JSON.stringify(i.action))}'>${esc(i.cta)}</button>
                </li>`).join('')}</ul>`
            : `<p class="config-attention-clear">${esc(this.t('config.overviewNothingToDo', 'Nothing needs attention — everything checks out.'))}</p>`;

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.overviewAttentionTitle', 'Needs attention'))}</h3>
                ${body}
            </div>`;
    }

    /** A few headline numbers, with the full report a click away. */
    renderOverviewStats() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.computeStats();
        const pct = s.total ? Math.round((s.tagged / s.total) * 100) : 0;
        const scoreTone = s.cleanup.score >= 80 ? 'good' : (s.cleanup.score >= 50 ? 'warn' : 'crit');

        const row = (label, value) => `
            <li class="config-mini-row">
                <span>${esc(label)}</span>
                <span class="config-mini-value">${esc(String(value))}</span>
            </li>`;

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.overviewStatsTitle', 'At a glance'))}</h3>
                ${s.total ? `
                    <div class="config-score config-score--compact">
                        <span class="config-score-value config-score-value--${scoreTone}">${esc(String(s.cleanup.score))}</span>
                        <div>
                            <div class="config-bar">
                                <span class="config-bar-fill config-bar-fill--${scoreTone}" style="width:${s.cleanup.score}%"></span>
                            </div>
                            <p class="config-field-hint">${esc(this.t('config.overviewScoreLabel', 'Cleanup score'))}</p>
                        </div>
                    </div>` : ''}
                <ul class="config-mini-list">
                    ${row(this.t('config.statsBookmarks', 'Bookmarks'), s.total)}
                    ${row(this.t('config.statsPages', 'Pages'), s.pages)}
                    ${row(this.t('config.statsCategoryCount', 'Categories'), s.categories)}
                    ${row(this.t('config.statsTagCount', 'Distinct tags'), s.tagCount)}
                    ${row(this.t('config.statsTaggedBookmarks', 'Tagged'), `${s.tagged} (${pct}%)`)}
                    ${row(this.t('config.statsMonitored', 'Monitored'), s.monitored)}
                </ul>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--small"
                            data-overview-go='{"section":"stats"}'>${esc(this.t('config.overviewMoreStats', 'All statistics →'))}</button>
                </div>
            </div>`;
    }

    /** The most recent release, summarised, with the full notes a click away. */
    renderOverviewWhatsNew() {
        const esc = (v) => this.dash.escapeHtml(v);
        const rel = this._latestRelease;

        let body;
        if (rel === undefined) {
            body = `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        } else if (!rel) {
            body = `<p class="config-panel-empty">${esc(this.t('config.overviewNoRelease', 'Release notes are not available.'))}</p>`;
        } else {
            // modalLead is authored HTML (it carries <strong>), so strip the tags
            // rather than escaping them into visible markup.
            const lead = String(rel.modalLead || '').replace(/<[^>]*>/g, '').trim();
            body = `
                <p class="config-release-tag">${esc(rel.tag || '')}${rel.date ? ` · ${esc(rel.date)}` : ''}</p>
                <p class="config-panel-note">${esc(lead)}</p>`;
        }

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.overviewWhatsNewTitle', 'Latest update'))}</h3>
                ${body}
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--small" data-overview-action="whats-new">${esc(this.t('config.showWhatsNew', 'Show what’s new'))}</button>
                </div>
            </div>`;
    }

    /**
     * A rotating handful of tips. Rotating rather than fixed so the panel is
     * worth glancing at more than once; seeded by the day so it does not shuffle
     * on every repaint.
     */
    renderOverviewTips() {
        const esc = (v) => this.dash.escapeHtml(v);
        const all = this.helpTips();
        if (!all.length) return '';
        const day = Math.floor(Date.now() / 86400000);
        const start = day % all.length;
        const picked = [0, 1, 2].map((i) => all[(start + i) % all.length]);

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.overviewTipsTitle', 'Tips'))}</h3>
                <ul class="config-help-tips">${picked.map((t) => `<li class="config-help-tip">${t}</li>`).join('')}</ul>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--small"
                            data-overview-go='{"section":"help"}'>${esc(this.t('config.overviewMoreTips', 'More tips →'))}</button>
                </div>
            </div>`;
    }

    /** Refresh the health report and the release notes, then repaint. */
    async loadOverviewData() {
        const d = this.dash;
        const jobs = [];
        if (d.health?.fetchReport) {
            jobs.push(d.health.fetchReport().catch(() => {}));
        }
        if (this._latestRelease === undefined) {
            jobs.push(this.loadLatestRelease());
        }
        await Promise.all(jobs);
        this.repaintOverview();
    }

    /**
     * The newest entry from the what's-new index, plus its own file for the
     * summary line. Same data the ★ modal reads, so the two cannot disagree.
     */
    async loadLatestRelease() {
        const version = window.NEXTDASH_WHATS_NEW_DATA_VERSION || '';
        const url = (p) => `/static/data/whats-new/${p}${version ? `?v=${encodeURIComponent(version)}` : ''}`;
        try {
            const idxRes = await fetch(url('index.json'));
            if (!idxRes.ok) throw new Error(`HTTP ${idxRes.status}`);
            const index = await idxRes.json();
            const first = Array.isArray(index) ? index[0] : null;
            if (!first?.id) throw new Error('empty index');

            const relRes = await fetch(url(`${first.id}.json`));
            if (!relRes.ok) throw new Error(`HTTP ${relRes.status}`);
            const release = await relRes.json();
            this._latestRelease = { ...first, ...release };
        } catch {
            this._latestRelease = null;
        }
    }

    repaintOverview() {
        if (!this.isActiveView() || this.section !== 'overview') return;
        const body = document.getElementById('config-view-body');
        if (!body) return;
        body.innerHTML = this.renderOverview();
        const container = document.getElementById('dashboard-layout');
        if (container) {
            this.bindTileActions(container);
            this.bindOverviewActions(container);
        }
    }

    /**
     * Open the what's-new modal, reporting a failure rather than swallowing it.
     * The loader only logs to the console, so a stub that never registered left
     * the button looking dead. Falls back to the ★ button, which is wired
     * independently, before giving up.
     */
    async openWhatsNew() {
        try {
            if (typeof window.openWhatsNewModal === 'function') {
                await window.openWhatsNewModal();
                if (document.querySelector('.whats-new-modal')) return;
            }
            const star = document.getElementById('whats-new-btn');
            if (star) {
                star.click();
                return;
            }
            throw new Error('whats-new unavailable');
        } catch {
            this.notify(this.t('config.whatsNewUnavailable', 'Could not open the release notes.'), 'error');
        }
    }

    /** Jump-off points: another config section, or one of the shell's views. */
    bindOverviewActions(container) {
        container.querySelectorAll('[data-overview-go]').forEach((btn) => {
            btn.addEventListener('click', () => {
                let target;
                try {
                    target = JSON.parse(btn.getAttribute('data-overview-go') || '{}');
                } catch {
                    return;
                }
                if (target.section) {
                    this.selectSection(target.section);
                    return;
                }
                // Same hand-off the status tiles use, which knows that the health
                // filter is set on the component rather than passed as an argument.
                if (target.view) this.openViewFromTile(target.view, target.filter);
            });
        });
        container.querySelectorAll('[data-overview-action="whats-new"]').forEach((btn) => {
            btn.addEventListener('click', () => this.openWhatsNew());
        });
    }

    /* ── Section navigation ────────────────────────────────────────────────── */

    selectSection(section) {
        if (!DashboardConfig.SECTIONS.includes(section) || section === this.section) {
            return;
        }
        this.section = section;
        this.render();
        this.restoreConfigHash();
    }

    bindSectionNav(container) {
        container.querySelectorAll('[data-config-section]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.selectSection(btn.getAttribute('data-config-section'));
            });
        });
    }

    bindTileActions(container) {
        container.querySelectorAll('[data-tile-view]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const view = btn.getAttribute('data-tile-view');
                const filter = btn.getAttribute('data-tile-filter');
                this.openViewFromTile(view, filter);
            });
        });
    }

    /** A tile hands off to the view that acts on it (health with a filter, inbox). */
    openViewFromTile(view, filter) {
        const d = this.dash;
        if (view === 'health' && d.health?.openHealthView) {
            if (filter) d.health.filter = filter;
            void d.health.openHealthView();
        } else if (view === 'inbox' && d.inbox?.openInboxView) {
            void d.inbox.openInboxView();
        }
    }

    /* ── Data & backups ────────────────────────────────────────────────────── */

    notify(message, type = 'info') {
        this.dash.showNotification?.(message, type, { duration: 3500 });
    }

    /** Write-token-aware fetch, matching the other views' POST/DELETE calls. */
    writeFetch(url, options) {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        return fetcher(url, options);
    }

    formatBytes(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
        return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    }

    formatRelative(iso) {
        const then = Date.parse(iso);
        if (!Number.isFinite(then)) return '';
        const mins = Math.round((Date.now() - then) / 60000);
        if (mins < 1) return this.t('config.backupJustNow', 'just now');
        if (mins < 60) return this.t('config.backupMinutesAgo', '{n} min ago').replace('{n}', String(mins));
        const hours = Math.round(mins / 60);
        if (hours < 24) return this.t('config.backupHoursAgo', '{n}h ago').replace('{n}', String(hours));
        const days = Math.round(hours / 24);
        return this.t('config.backupDaysAgo', '{n}d ago').replace('{n}', String(days));
    }

    dataBackupsTiles() {
        const data = this._backupData;
        const backups = Array.isArray(data?.backups) ? data.backups : [];
        const enabled = Boolean(data?.enabled);
        const newest = backups[0];

        return [
            {
                key: 'last-backup',
                tone: newest ? 'good' : 'warn',
                label: this.t('config.tileLastBackup', 'Last backup'),
                value: newest ? this.formatRelative(newest.createdAt) : this.t('config.backupNone', 'none'),
                detail: enabled
                    ? this.t('config.backupAutoOn', 'Auto-backup on')
                    : this.t('config.backupAutoOff', 'Auto-backup off'),
            },
            {
                key: 'stored',
                tone: 'neutral',
                label: this.t('config.tileStoredBackups', 'Stored backups'),
                value: backups.length,
                detail: backups.length
                    ? this.formatBytes(backups.reduce((sum, b) => sum + (Number(b.size) || 0), 0))
                    : '',
            },
        ];
    }

    renderDataBackups() {
        const esc = (v) => this.dash.escapeHtml(v);
        const loading = this._backupData == null;
        const tiles = loading
            ? `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`
            : `<div class="config-tiles" role="list">${this.dataBackupsTiles().map((t) => this.renderTile(t)).join('')}</div>`;

        const s = this.dash.settings || {};
        const recheckHours = Number(s.healthAutoRecheckIntervalHours) || 24;
        const intervalOptions = [6, 12, 24, 48, 168].map((h) => {
            const label = h < 24
                ? this.t('config.recheckEveryHours', 'Every {n}h').replace('{n}', String(h))
                : (h === 24
                    ? this.t('config.recheckDaily', 'Daily')
                    : (h === 168
                        ? this.t('config.recheckWeekly', 'Weekly')
                        : this.t('config.recheckEveryDays', 'Every {n} days').replace('{n}', String(h / 24))));
            return `<option value="${h}" ${h === recheckHours ? 'selected' : ''}>${esc(label)}</option>`;
        }).join('');
        const deviceSpecific = window.DeviceSettingsMerge?.isDeviceSpecificEnabled?.() === true
            || (() => { try { return localStorage.getItem('deviceSpecificSettings') === 'true'; } catch { return false; } })();

        const faviconPolicy = s.faviconRefreshPolicy || 'monthly';
        const faviconPolicyOptions = [
            ['never', this.t('config.faviconPolicyNever', 'Never')],
            ['monthly', this.t('config.faviconPolicyMonthly', 'Monthly')],
            ['weekly', this.t('config.faviconPolicyWeekly', 'Weekly')],
            ['always', this.t('config.faviconPolicyAlways', 'Every load')],
        ].map(([v, label]) => `<option value="${esc(v)}" ${v === faviconPolicy ? 'selected' : ''}>${esc(label)}</option>`).join('');

        return `
            <p class="config-view-intro">${esc(this.t('config.dataBackupsIntro', 'Back up your data, restore an earlier snapshot, or move it in and out of nextDash.'))}</p>
            ${tiles}

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.backupCreateTitle', 'Backup'))}</h3>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-backup-action="download">${esc(this.t('config.backupDownload', 'Download backup'))}</button>
                    <button type="button" class="config-btn" data-backup-action="run">${esc(this.t('config.backupRunNow', 'Make a backup now'))}</button>
                </div>
                <label class="config-toggle">
                    <input type="checkbox" data-backup-toggle="autoBackupEnabled" ${s.autoBackupEnabled ? 'checked' : ''}>
                    <span>${esc(this.t('config.autoBackupEnabledLabel', 'Automatic daily backups'))}</span>
                </label>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.backupStoredTitle', 'Stored backups'))}</h3>
                <div id="config-backup-list">${this.renderBackupList()}</div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.backupsZipSectionTitle', 'Full backup (zip)'))}</h3>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-backup-action="import">${esc(this.t('config.backupImport', 'Import backup…'))}</button>
                </div>
                <input type="file" id="config-import-input" accept=".zip" hidden>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.backupsImportExportSectionTitle', 'Import & export bookmarks'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.csvExportDescription', 'Export every bookmark as a CSV file, or import bookmarks exported from a browser.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-backup-action="csv-export">${esc(this.t('config.csvExportBtn', 'Export bookmarks (CSV)'))}</button>
                    <button type="button" class="config-btn" data-backup-action="browser-import">${esc(this.t('config.browserImportBtn', 'Import browser bookmarks…'))}</button>
                </div>
                <input type="file" id="config-browser-import-input" accept=".html,.htm" hidden>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.settingsSection', 'Settings'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.settingsExportDescription', 'Move just your settings between instances as a JSON file.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-backup-action="settings-export">${esc(this.t('config.settingsExportBtn', 'Export settings (JSON)'))}</button>
                    <button type="button" class="config-btn" data-backup-action="settings-import">${esc(this.t('config.settingsImportBtn', 'Import settings…'))}</button>
                </div>
                <input type="file" id="config-settings-import-input" accept=".json" hidden>
                <label class="config-toggle">
                    <input type="checkbox" data-backup-toggle="deviceSpecificSettings" ${deviceSpecific ? 'checked' : ''}>
                    <span>${esc(this.t('config.deviceSpecificSettings', 'Keep some settings specific to this device'))}</span>
                </label>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statusRecheckInterval', 'Automatic health rechecks'))}</h3>
                <label class="config-toggle">
                    <input type="checkbox" data-backup-toggle="healthAutoRecheckEnabled" ${s.healthAutoRecheckEnabled ? 'checked' : ''}>
                    <span>${esc(this.t('config.healthRecheckEnabledLabel', 'Recheck link health automatically'))}</span>
                </label>
                <div class="config-field" style="margin-top:12px">
                    <span class="config-field-label">${esc(this.t('config.healthRecheckIntervalLabel', 'Interval'))}</span>
                    <select class="config-select" data-backup-select="healthAutoRecheckIntervalHours" ${s.healthAutoRecheckEnabled ? '' : 'disabled'}>${intervalOptions}</select>
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.iconsSectionTitle', 'Icons & previews'))}</h3>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.faviconRefreshPolicyLabel', 'Refresh favicons'))}</span>
                    <select class="config-select" data-backup-select="faviconRefreshPolicy">${faviconPolicyOptions}</select>
                    ${this.renderFieldAffordances('faviconRefreshPolicy', s.faviconRefreshPolicy) ? `<span class="config-field-affordances">${this.renderFieldAffordances('faviconRefreshPolicy', s.faviconRefreshPolicy)}</span>` : ''}
                </div>
                <p class="config-panel-note">${esc(this.t('config.bookmarkPreviewMaintenanceHint', 'Link preview cards are fetched once and cached. Refresh them all after a site redesign, or clear them to free space.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-backup-action="refresh-favicons">${esc(this.t('config.bulkRefreshFaviconsBtn', 'Refresh all favicons'))}</button>
                    <button type="button" class="config-btn" data-backup-action="refresh-previews">${esc(this.t('config.refreshAllPreviewsBtn', 'Refresh all link previews'))}</button>
                    <button type="button" class="config-btn config-btn--danger" data-backup-action="clear-previews">${esc(this.t('config.clearAllPreviewsBtn', 'Clear all link previews'))}</button>
                </div>
            </div>

            <div class="config-panel config-panel--danger">
                <h3 class="config-panel-title">${esc(this.t('config.resetSectionTitle', 'Reset'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.resetOnboardingHint', 'Replay the welcome tour and tips next time you open the dashboard.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-backup-action="reset-onboarding">${esc(this.t('config.resetOnboardingButton', 'Reset onboarding & tips'))}</button>
                </div>
                <p class="config-panel-note" style="margin-top:16px">${esc(this.t('config.deleteAllBookmarksHint', 'Removes every bookmark but keeps your pages, categories, and settings.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--danger" data-backup-action="delete-bookmarks">${esc(this.t('config.deleteAllBookmarksBtn', 'Delete all bookmarks only'))}</button>
                </div>
                <p class="config-panel-note" style="margin-top:16px">${esc(this.t('config.backupResetNote', 'Removes every bookmark, page, and setting. This cannot be undone.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--danger" data-backup-action="reset">${esc(this.t('config.backupReset', 'Reset all data'))}</button>
                </div>
            </div>
        `;
    }

    renderBackupList() {
        const esc = (v) => this.dash.escapeHtml(v);
        const backups = Array.isArray(this._backupData?.backups) ? this._backupData.backups : [];
        if (this._backupData == null) {
            return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        }
        if (backups.length === 0) {
            return `<p class="config-panel-empty">${esc(this.t('config.backupListEmpty', 'No stored backups yet.'))}</p>`;
        }
        const rows = backups.map((b) => `
            <li class="config-backup-row">
                <div class="config-backup-meta">
                    <span class="config-backup-name">${esc(this.formatRelative(b.createdAt) || b.name)}</span>
                    <span class="config-backup-size">${esc(this.formatBytes(b.size))}</span>
                </div>
                <div class="config-backup-row-actions">
                    <button type="button" class="config-btn config-btn--small" data-backup-item="restore" data-backup-name="${esc(b.name)}">${esc(this.t('config.autoBackupRestore', 'Restore'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-backup-item="download" data-backup-name="${esc(b.name)}">${esc(this.t('config.backupDownloadOne', 'Download'))}</button>
                    <button type="button" class="config-btn config-btn--small config-btn--danger" data-backup-item="delete" data-backup-name="${esc(b.name)}">${esc(this.t('config.backupDelete', 'Delete'))}</button>
                </div>
            </li>
        `).join('');
        return `<ul class="config-backup-list">${rows}</ul>`;
    }

    async loadBackupData() {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/auto-backups');
            this._backupData = res && res.ok ? await res.json() : { enabled: false, backups: [] };
        } catch {
            this._backupData = { enabled: false, backups: [] };
        }
        this.repaintBackupSection();
    }

    /** Repaint just the data-backups body, keeping the section shell intact. */
    repaintBackupSection() {
        if (!this.isActiveView() || this.section !== 'data-backups') return;
        const body = document.getElementById('config-view-body');
        if (!body) return;
        body.innerHTML = this.renderDataBackups();
        const container = document.getElementById('dashboard-layout');
        if (container) this.bindDataBackupsActions(container);
    }

    bindDataBackupsActions(container) {
        container.querySelectorAll('[data-backup-action]').forEach((btn) => {
            btn.addEventListener('click', () => this.handleBackupAction(btn.getAttribute('data-backup-action')));
        });
        container.querySelectorAll('[data-backup-item]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.handleBackupItem(btn.getAttribute('data-backup-item'), btn.getAttribute('data-backup-name'));
            });
        });
        const bindFileInput = (id, handler) => {
            const input = container.querySelector(id);
            if (!input) return;
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                if (file) void handler.call(this, file);
                input.value = '';
            });
        };
        bindFileInput('#config-import-input', this.importBackup);
        bindFileInput('#config-browser-import-input', this.importBrowserBookmarks);
        bindFileInput('#config-settings-import-input', this.importSettings);

        container.querySelectorAll('[data-backup-toggle]').forEach((input) => {
            input.addEventListener('change', () => this.setBackupToggle(input.getAttribute('data-backup-toggle'), input.checked));
        });
        container.querySelectorAll('[data-backup-select]').forEach((select) => {
            select.addEventListener('change', () => this.setBackupSelect(select.getAttribute('data-backup-select'), select.value));
        });
    }

    handleBackupAction(action) {
        switch (action) {
            case 'download': this.downloadFullBackup(); break;
            case 'run': void this.runBackupNow(); break;
            case 'import': document.getElementById('config-import-input')?.click(); break;
            case 'csv-export': void this.exportBookmarksCSV(); break;
            case 'browser-import': document.getElementById('config-browser-import-input')?.click(); break;
            case 'settings-export': void this.exportSettings(); break;
            case 'settings-import': document.getElementById('config-settings-import-input')?.click(); break;
            case 'reset-onboarding': void this.resetOnboarding(); break;
            case 'reset': void this.resetAllData(); break;
            case 'refresh-favicons': void this.refreshAllFavicons(); break;
            case 'refresh-previews': void this.refreshAllPreviews(); break;
            case 'clear-previews': void this.clearAllPreviews(); break;
            case 'delete-bookmarks': void this.deleteAllBookmarks(); break;
        }
    }

    setBackupToggle(name, value) {
        const d = this.dash;
        if (name === 'deviceSpecificSettings') {
            try { localStorage.setItem('deviceSpecificSettings', value ? 'true' : 'false'); } catch { /* ignore */ }
            this.notify(this.t('config.deviceSpecificSaved', 'Preference saved.'), 'success');
            return;
        }
        if (name === 'autoBackupEnabled' || name === 'healthAutoRecheckEnabled') {
            d.settings[name] = value;
            void this.saveSettingsWithFeedback();
            // Repaint so the interval select enables/disables and the tile updates.
            if (name === 'autoBackupEnabled') {
                void this.loadBackupData();
            } else {
                this.repaintBackupSection();
            }
        }
    }

    setBackupSelect(name, value) {
        if (name === 'faviconRefreshPolicy') {
            this.dash.settings.faviconRefreshPolicy = value;
            void this.saveSettingsWithFeedback();
            this.repaintBackupSection();
            return;
        }
        if (name !== 'healthAutoRecheckIntervalHours') return;
        this.dash.settings.healthAutoRecheckIntervalHours = Number(value) || 24;
        void this.saveSettingsWithFeedback();
    }

    /** Re-download every bookmark favicon across all pages. */
    async refreshAllFavicons() {
        if (!window.confirm(this.t('config.bulkRefreshFaviconsConfirm', 'Download every bookmark icon again? This can take a while on a large dashboard.'))) return;
        try {
            const res = await this.writeFetch('/api/bookmarks/prefetch-icons', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.bulkRefreshFaviconsDone', 'Favicons refreshed.'), 'success');
            await this.dash.loadAllBookmarks?.();
            this.dash.renderDashboard?.({ animate: false });
        } catch {
            this.notify(this.t('config.bulkRefreshFaviconsError', 'Could not refresh the favicons.'), 'error');
        }
    }

    /** Re-fetch the link-preview card for every bookmark that has one. */
    async refreshAllPreviews() {
        if (!window.confirm(this.t('config.refreshAllPreviewsConfirm', 'Fetch every link preview card again from its site?'))) return;
        try {
            const res = await this.writeFetch('/api/previews/refresh', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.refreshAllPreviewsDone', 'Link previews refreshed.'), 'success');
        } catch {
            this.notify(this.t('config.refreshAllPreviewsError', 'Could not refresh the link previews.'), 'error');
        }
    }

    /** Drop every cached link-preview card. */
    async clearAllPreviews() {
        if (!window.confirm(this.t('config.clearAllPreviewsConfirm', 'Remove every cached preview card? They are fetched again when next needed.'))) return;
        try {
            const res = await this.writeFetch('/api/previews/clear', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.clearAllPreviewsDone', 'Link previews cleared.'), 'success');
            this.dash.renderDashboard?.({ animate: false });
        } catch {
            this.notify(this.t('config.clearAllPreviewsError', 'Could not clear the link previews.'), 'error');
        }
    }

    /** Remove every bookmark but keep pages, categories and settings. */
    async deleteAllBookmarks() {
        if (!window.confirm(this.t('config.deleteAllBookmarksConfirm', 'Delete every bookmark? Your pages, categories and settings are kept. This cannot be undone.'))) return;
        try {
            const res = await this.writeFetch('/api/bookmarks/delete-all', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.deleteAllBookmarksDone', 'All bookmarks deleted.'), 'success');
            await this.dash.loadAllBookmarks?.();
            await this.dash.loadPageBookmarks?.(this.dash.currentPageId, { forceFetch: true });
            this.dash.renderDashboard?.({ animate: false });
        } catch {
            this.notify(this.t('config.deleteAllBookmarksError', 'Could not delete the bookmarks.'), 'error');
        }
    }

    handleBackupItem(action, name) {
        if (!name) return;
        switch (action) {
            case 'restore': void this.restoreBackup(name); break;
            case 'download': this.downloadStoredBackup(name); break;
            case 'delete': void this.deleteBackup(name); break;
        }
    }

    downloadFullBackup() {
        // A plain navigation lets the browser handle the file download.
        window.location.href = '/api/backup';
    }

    downloadStoredBackup(name) {
        window.location.href = `/api/auto-backups/download?name=${encodeURIComponent(name)}`;
    }

    async runBackupNow() {
        try {
            const res = await this.writeFetch('/api/auto-backups/run', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.backupRunSuccess', 'Backup created.'), 'success');
            await this.loadBackupData();
        } catch {
            this.notify(this.t('config.backupRunError', 'Could not create a backup.'), 'error');
        }
    }

    async restoreBackup(name) {
        const ok = window.confirm(this.t('config.backupRestoreConfirm', 'Restore this backup? Current data will be replaced.'));
        if (!ok) return;
        try {
            const res = await this.writeFetch(`/api/auto-backups/restore?name=${encodeURIComponent(name)}`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.autoBackupRestoreSuccess', 'Backup restored. Reloading…'), 'success');
            setTimeout(() => window.location.reload(), 800);
        } catch {
            this.notify(this.t('config.autoBackupRestoreError', 'Failed to restore backup.'), 'error');
        }
    }

    async deleteBackup(name) {
        const ok = window.confirm(this.t('config.backupDeleteConfirm', 'Delete this backup?'));
        if (!ok) return;
        try {
            const res = await this.writeFetch(`/api/auto-backups?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.backupDeleteSuccess', 'Backup deleted.'), 'success');
            await this.loadBackupData();
        } catch {
            this.notify(this.t('config.backupDeleteError', 'Could not delete the backup.'), 'error');
        }
    }

    async importBackup(file) {
        const ok = window.confirm(this.t('config.backupImportConfirm', 'Import this backup? Current data will be replaced.'));
        if (!ok) return;
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await this.writeFetch('/api/import', { method: 'POST', body: form });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.backupImportSuccess', 'Backup imported. Reloading…'), 'success');
            setTimeout(() => window.location.reload(), 800);
        } catch {
            this.notify(this.t('config.backupImportError', 'Could not import the backup.'), 'error');
        }
    }

    async resetAllData() {
        const ok = window.confirm(this.t('config.backupResetConfirm', 'Delete ALL data? This cannot be undone.'));
        if (!ok) return;
        try {
            const res = await this.writeFetch('/api/reset', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.backupResetSuccess', 'All data reset. Reloading…'), 'success');
            setTimeout(() => window.location.reload(), 800);
        } catch {
            this.notify(this.t('config.backupResetError', 'Could not reset data.'), 'error');
        }
    }

    /* ── Import / export (ported from the old config) ──────────────────────── */

    triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async exportBookmarksCSV() {
        try {
            const [bookmarksRes, pagesRes] = await Promise.all([
                fetch('/api/bookmarks?all=true'),
                fetch('/api/pages'),
            ]);
            if (!bookmarksRes.ok || !pagesRes.ok) throw new Error('fetch failed');
            const bookmarks = await bookmarksRes.json();
            const pages = await pagesRes.json();
            const pageNames = Object.fromEntries(pages.map((p) => [p.id, p.name]));

            const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const header = ['Name', 'URL', 'Category', 'Page', 'Shortcut', 'Tags', 'Notes'].map(escape).join(',');
            const rows = (Array.isArray(bookmarks) ? bookmarks : []).map((bm) => [
                escape(bm.name),
                escape(bm.url),
                escape(bm.category || ''),
                escape(pageNames[bm.pageId] ?? bm.pageId ?? ''),
                escape(bm.shortcut),
                escape(Array.isArray(bm.tags) ? bm.tags.join(', ') : ''),
                escape(bm.note || ''),
            ].join(','));
            const csv = '﻿' + [header, ...rows].join('\r\n');
            const date = new Date().toISOString().slice(0, 10);
            this.triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `nextdash-bookmarks-${date}.csv`);
            this.notify(this.t('config.csvExportSuccess', 'Bookmarks exported.'), 'success');
        } catch {
            this.notify(this.t('config.csvExportError', 'Could not export bookmarks.'), 'error');
        }
    }

    /** Parse a browser-exported Netscape bookmark file into {name,url,category}[]. */
    parseBrowserBookmarks(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const bookmarks = [];
        const walk = (container, folderName) => {
            const els = Array.from(container.children);
            for (let i = 0; i < els.length; i++) {
                const el = els[i];
                if (el.tagName === 'DT') {
                    const h3 = el.querySelector('h3');
                    const a = el.querySelector('a[href]');
                    if (h3 && !a) {
                        const name = h3.textContent.trim();
                        if (i + 1 < els.length && els[i + 1].tagName === 'DL') {
                            walk(els[i + 1], name);
                            i++;
                        }
                    } else if (a) {
                        const href = a.getAttribute('href');
                        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                            bookmarks.push({ name: a.textContent.trim() || href, url: href, category: folderName });
                        }
                    }
                } else if (el.tagName === 'DL' || el.tagName === 'P') {
                    walk(el, folderName);
                }
            }
        };
        const topDl = doc.querySelector('dl');
        if (topDl) walk(topDl, '');
        return bookmarks;
    }

    async importBrowserBookmarks(file) {
        if (!/\.(html?|htm)$/i.test(file.name)) {
            this.notify(this.t('config.browserImportInvalidFile', 'Please choose an HTML bookmarks file.'), 'error');
            return;
        }
        let bookmarks;
        try {
            bookmarks = this.parseBrowserBookmarks(await file.text());
        } catch {
            this.notify(this.t('config.browserImportError', 'Could not read that bookmarks file.'), 'error');
            return;
        }
        if (bookmarks.length === 0) {
            this.notify(this.t('config.browserImportEmpty', 'No bookmarks found in that file.'), 'error');
            return;
        }
        // Import onto the current page; the server dedups against existing URLs.
        const pageId = Number(this.dash.currentPageId) || (this.dash.pages?.[0]?.id) || 1;
        const ok = window.confirm(
            this.t('config.browserImportConfirm', 'Import {n} bookmarks onto the current page?').replace('{n}', String(bookmarks.length))
        );
        if (!ok) return;
        try {
            const res = await this.writeFetch('/api/bookmarks/import-browser', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId, bookmarks }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const result = await res.json().catch(() => ({}));
            const imported = Number(result.imported) || 0;
            const skipped = Number(result.skipped) || 0;
            this.notify(
                this.t('config.browserImportDone', 'Imported {i}, skipped {s} duplicates. Reloading…')
                    .replace('{i}', String(imported)).replace('{s}', String(skipped)),
                'success'
            );
            setTimeout(() => window.location.reload(), 1000);
        } catch {
            this.notify(this.t('config.browserImportError', 'Could not import the bookmarks.'), 'error');
        }
    }

    async exportSettings() {
        try {
            const res = await fetch('/api/settings');
            if (!res.ok) throw new Error(res.statusText);
            const settings = await res.json();
            const date = new Date().toISOString().slice(0, 10);
            this.triggerDownload(
                new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }),
                `nextDash-settings-${date}.json`
            );
            this.notify(this.t('config.settingsExportSuccess', 'Settings exported.'), 'success');
        } catch {
            this.notify(this.t('config.settingsExportError', 'Could not export settings.'), 'error');
        }
    }

    async importSettings(file) {
        if (file.size > 2 * 1024 * 1024) {
            this.notify(this.t('config.settingsImportFileTooLarge', 'File too large (max 2 MB).'), 'error');
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(await file.text());
        } catch {
            this.notify(this.t('config.settingsImportInvalidJson', 'That is not a valid JSON file.'), 'error');
            return;
        }
        if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
            this.notify(this.t('config.settingsImportInvalidFile', 'That is not a valid settings file.'), 'error');
            return;
        }
        const ok = window.confirm(this.t('config.settingsImportConfirmMessage', 'This will overwrite your current settings. Continue?'));
        if (!ok) return;
        // Strip one-time migration markers so the destination runs its migrations.
        const { tagCloudDefaultMigrated, linkPreviewCardsOffMigrated, hideEmptyCategoriesMigrated, showTipsOffMigrated, ...clean } = parsed;
        try {
            const res = await this.writeFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(clean),
            });
            if (!res.ok) throw new Error(res.statusText);
            this.notify(this.t('config.settingsImportSuccess', 'Settings imported. Reloading…'), 'success');
            setTimeout(() => window.location.reload(), 1000);
        } catch {
            this.notify(this.t('config.settingsImportError', 'Could not import settings.'), 'error');
        }
    }

    async resetOnboarding() {
        const ok = window.confirm(this.t('config.resetOnboardingConfirm', 'Replay the welcome tour and tips next time?'));
        if (!ok) return;
        this.dash.settings.onboardingCompleted = false;
        try {
            await this.dash.saveSettings?.();
            this.notify(this.t('config.resetOnboardingSuccess', 'Onboarding will replay next time.'), 'success');
        } catch {
            this.notify(this.t('config.resetOnboardingError', 'Could not reset onboarding.'), 'error');
        }
    }

    /* ── Appearance ────────────────────────────────────────────────────────── */

    static FONT_SIZES = ['xs', 's', 'sm', 'm', 'lg', 'l', 'xl'];

    fontSizeLabel(size) {
        const map = {
            xs: ['config.fontSizeXS', 'XS'], s: ['config.fontSizeS', 'S'],
            sm: ['config.fontSizeSM', 'SM'], m: ['config.fontSizeM', 'M'],
            lg: ['config.fontSizeLG', 'LG'], l: ['config.fontSizeL', 'L'],
            xl: ['config.fontSizeXL', 'XL'],
        };
        const [key, fallback] = map[size] || [size, size.toUpperCase()];
        return this.t(key, fallback);
    }

    /** Normalise legacy font-size values the same way applyFontSize does. */
    currentFontSize() {
        let size = this.dash.settings?.fontSize || 'm';
        if (size === 'small') size = 'sm';
        if (size === 'medium') size = 'm';
        if (size === 'large') size = 'l';
        return DashboardConfig.FONT_SIZES.includes(size) ? size : 'm';
    }

    appearanceTiles() {
        const s = this.dash.settings || {};
        const themeId = s.theme || 'dark';
        const theme = this.themeDisplayName(themeId, this._themeList?.[themeId]);
        return [
            {
                key: 'theme', tone: 'accent',
                label: this.t('config.tileActiveTheme', 'Active theme'),
                value: theme,
                detail: s.autoDarkMode ? this.t('config.autoDarkOn', 'Auto dark mode on') : '',
            },
            {
                key: 'font-size', tone: 'neutral',
                label: this.t('config.tileFontSize', 'Font size'),
                value: this.fontSizeLabel(this.currentFontSize()),
            },
        ];
    }

    renderAppearance() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        const theme = s.theme === 'light' ? 'light' : 'dark';
        const tiles = `<div class="config-tiles" role="list">${this.appearanceTiles().map((t) => this.renderTile(t)).join('')}</div>`;

        const fontOptions = DashboardConfig.FONT_SIZES.map((size) => {
            const active = size === this.currentFontSize();
            return `<button type="button" class="config-choice${active ? ' is-active' : ''}" data-appearance-font="${esc(size)}" aria-pressed="${active ? 'true' : 'false'}">${esc(this.fontSizeLabel(size))}</button>`;
        }).join('');

        const layout = s.layoutVersion === 'modern' ? 'modern' : 'classic';

        const presets = (window.DashboardFont?.PRESET_IDS) || ['source-code-pro', 'jetbrains-mono', 'ibm-plex-mono', 'inter', 'ibm-plex-sans', 'dm-sans', 'system'];
        const activePreset = window.DashboardFont?.resolveActiveFontPreset?.(s) || s.fontPreset || 'source-code-pro';
        const fontPresetOptions = presets.map((p) =>
            `<option value="${esc(p)}" ${p === activePreset ? 'selected' : ''}>${esc(this.fontPresetLabel(p))}</option>`
        ).join('');

        const weight = s.fontWeight || 'normal';
        const weights = [['normal', this.t('config.fontWeightNormal', 'Normal')], ['600', this.t('config.fontWeightSemiBold', 'Semi-bold')], ['bold', this.t('config.fontWeightBold', 'Bold')]];
        const weightChoices = weights.map(([val, label]) =>
            `<button type="button" class="config-choice${weight === val ? ' is-active' : ''}" data-appearance-weight="${esc(val)}" aria-pressed="${weight === val}">${esc(label)}</button>`
        ).join('');

        const bgType = s.backgroundType || 'auto';
        const bgTypes = [['auto', this.t('config.backgroundAuto', 'Auto')], ['none', this.t('config.backgroundNone', 'None')], ['gradient', this.t('config.backgroundGradient', 'Gradient')], ['image', this.t('config.backgroundImage', 'Image')]];
        const bgChoices = bgTypes.map(([val, label]) =>
            `<button type="button" class="config-choice${bgType === val ? ' is-active' : ''}" data-appearance-bg="${esc(val)}" aria-pressed="${bgType === val}">${esc(label)}</button>`
        ).join('');
        const opacity = Number.isFinite(Number(s.backgroundOpacity)) ? Number(s.backgroundOpacity) : 1;

        const iconSize = s.launcherIconSize || 'normal';
        const iconSizes = [['small', this.t('config.launcherIconSizeSmall', 'Small')], ['normal', this.t('config.launcherIconSizeNormal', 'Normal')], ['large', this.t('config.launcherIconSizeLarge', 'Large')]];
        const iconSizeChoices = iconSizes.map(([val, label]) =>
            `<button type="button" class="config-choice${iconSize === val ? ' is-active' : ''}" data-appearance-iconsize="${esc(val)}" aria-pressed="${iconSize === val}">${esc(label)}</button>`
        ).join('');

        return `
            <p class="config-view-intro">${esc(this.t('config.appearanceIntro', 'Theme, type, and layout. Changes apply immediately and are saved.'))}</p>
            ${tiles}

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceThemeTitle', 'Theme'))}</h3>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.themeLabel', 'Theme'))}</span>
                    <select class="config-select" data-appearance-select="theme">${this.renderThemeOptions()}</select>
                    ${this.appearanceAff('theme')}
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.appearanceMode', 'Quick mode'))}</span>
                    <div class="config-choices" role="group">
                        <button type="button" class="config-choice${theme === 'light' ? ' is-active' : ''}" data-appearance-theme="light" aria-pressed="${theme === 'light'}">${esc(this.t('config.themeLight', 'Light'))}</button>
                        <button type="button" class="config-choice${theme === 'dark' ? ' is-active' : ''}" data-appearance-theme="dark" aria-pressed="${theme === 'dark'}">${esc(this.t('config.themeDark', 'Dark'))}</button>
                    </div>
                </div>
                <div class="config-field-row">
                    <label class="config-toggle">
                        <input type="checkbox" data-appearance-toggle="autoDarkMode" ${s.autoDarkMode ? 'checked' : ''}>
                        <span>${esc(this.t('config.appearanceAutoDark', 'Follow system dark mode'))}</span>
                    </label>
                    ${this.appearanceAff('autoDarkMode')}
                </div>
                <div class="config-actions" style="margin-top:14px">
                    <button type="button" class="config-btn" data-appearance-action="edit-colors">${esc(this.t('config.openThemeColorsLink', 'Edit theme colours…'))}</button>
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceTypeTitle', 'Type'))}</h3>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.fontPresetLabel', 'Font'))}</span>
                    <select class="config-select" data-appearance-select="fontPreset">${fontPresetOptions}</select>
                    ${this.appearanceAff('fontPreset')}
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.fontWeightLabel', 'Weight'))}</span>
                    <div class="config-choices" role="group">${weightChoices}</div>
                    ${this.appearanceAff('fontWeight')}
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.appearanceFontSize', 'Font size'))}</span>
                    <div class="config-choices" role="group">${fontOptions}</div>
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.uploadFontLabel', 'Custom font'))}</span>
                    <button type="button" class="config-btn config-btn--small" data-appearance-action="upload-font">${esc(this.t('config.detailUploadIconBtn', 'Upload…'))}</button>
                    <input type="file" id="config-font-input" accept=".woff,.woff2,.ttf,.otf" hidden>
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.backgroundLabel', 'Background'))}</h3>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.backgroundLabel', 'Background'))}</span>
                    <div class="config-choices" role="group">${bgChoices}</div>
                    ${this.appearanceAff('backgroundType')}
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.backgroundOpacityLabel', 'Opacity'))}</span>
                    <input type="range" class="config-range" data-appearance-range="backgroundOpacity" min="0" max="1" step="0.05" value="${opacity}">
                    <span class="config-range-value">${Math.round(opacity * 100)}%</span>
                    ${this.appearanceAff('backgroundOpacity')}
                </div>
                <div class="config-field-row">
                    <label class="config-toggle">
                        <input type="checkbox" data-appearance-toggle="showBackgroundDots" ${s.showBackgroundDots ? 'checked' : ''}>
                        <span>${esc(this.t('config.showBackgroundDots', 'Show background dots'))}</span>
                    </label>
                    ${this.appearanceAff('showBackgroundDots')}
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceLayoutTitle', 'Layout & display'))}</h3>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.appearanceLayoutVersion', 'Layout'))}</span>
                    <div class="config-choices" role="group">
                        <button type="button" class="config-choice${layout === 'classic' ? ' is-active' : ''}" data-appearance-layout="classic" aria-pressed="${layout === 'classic'}">${esc(this.t('config.layoutClassic', 'Classic'))}</button>
                        <button type="button" class="config-choice${layout === 'modern' ? ' is-active' : ''}" data-appearance-layout="modern" aria-pressed="${layout === 'modern'}">${esc(this.t('config.layoutModern', 'Modern'))}</button>
                    </div>
                    ${this.appearanceAff('layoutVersion')}
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.launcherIconSizeLabel', 'Icon size'))}</span>
                    <div class="config-choices" role="group">${iconSizeChoices}</div>
                    ${this.appearanceAff('launcherIconSize')}
                </div>
                <div class="config-field-row">
                    <label class="config-toggle">
                        <input type="checkbox" data-appearance-toggle="showIcons" ${s.showIcons !== false ? 'checked' : ''}>
                        <span>${esc(this.t('config.showIcons', 'Show bookmark icons'))}</span>
                    </label>
                    ${this.appearanceAff('showIcons')}
                </div>
                <div class="config-field-row">
                    <label class="config-toggle">
                        <input type="checkbox" data-appearance-toggle="colorizeStatus" ${s.colorizeStatus ? 'checked' : ''}>
                        <span>${esc(this.t('config.colorizeStatus', 'Colour status on bookmark rows'))}</span>
                    </label>
                    ${this.appearanceAff('colorizeStatus')}
                </div>
                <div class="config-field-row">
                    <label class="config-toggle">
                        <input type="checkbox" data-appearance-toggle="animationsEnabled" ${s.animationsEnabled !== false ? 'checked' : ''}>
                        <span>${esc(this.t('config.enableAnimations', 'Enable animations'))}</span>
                    </label>
                    ${this.appearanceAff('animationsEnabled')}
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.generalGroupBranding', 'Branding'))}</h3>
                <div class="config-field-row">
                    <label class="config-toggle">
                        <input type="checkbox" data-appearance-toggle="enableCustomTitle" ${s.enableCustomTitle ? 'checked' : ''}>
                        <span>${esc(this.t('config.enableCustomTitle', 'Use a custom page title'))}</span>
                    </label>
                    ${this.appearanceAff('enableCustomTitle')}
                </div>
                <div class="config-field" style="margin-top:10px">
                    <span class="config-field-label">${esc(this.t('config.customTitleLabel', 'Title'))}</span>
                    <input type="text" class="config-text" data-appearance-text="customTitle" value="${esc(s.customTitle || '')}" ${s.enableCustomTitle ? '' : 'disabled'} placeholder="nextDash">
                </div>
                <div class="config-field" style="margin-top:10px">
                    <span class="config-field-label">${esc(this.t('config.uploadFaviconLabel', 'Custom favicon'))}</span>
                    <button type="button" class="config-btn config-btn--small" data-appearance-action="upload-favicon">${esc(this.t('config.detailUploadIconBtn', 'Upload…'))}</button>
                    <input type="file" id="config-favicon-input" accept="image/*,.ico" hidden>
                </div>
            </div>

            <div class="config-panel" id="config-theme-colors-panel"></div>
        `;
    }

    /** Friendly name for a theme id, matching the old config's labels. */
    themeDisplayName(themeId, name) {
        if (themeId === 'dark') return this.t('config.themeOldDefaultDark', 'Old Default [dark]');
        if (themeId === 'light') return this.t('config.themeOldDefaultLight', 'Old Default [light]');
        if (name && String(name).trim()) return String(name);
        return themeId;
    }

    renderThemeOptions() {
        const esc = (v) => this.dash.escapeHtml(v);
        const current = this.dash.settings?.theme || 'dark';
        // dark + light always available; the rest come from /api/colors/custom-themes.
        const themes = { dark: '', light: '', ...(this._themeList || {}) };
        const entries = Object.entries(themes).sort(([ida, na], [idb, nb]) =>
            this.themeDisplayName(ida, na).localeCompare(this.themeDisplayName(idb, nb), undefined, { sensitivity: 'base' })
        );
        // Make sure the saved theme is selectable even before the list loads.
        if (!themes[current]) entries.unshift([current, '']);
        return entries.map(([id, name]) =>
            `<option value="${esc(id)}" ${id === current ? 'selected' : ''}>${esc(this.themeDisplayName(id, name))}</option>`
        ).join('');
    }

    /** Load the built-in + custom theme list, then repaint the theme select. */
    async loadThemeList() {
        if (this._themeList) return;
        try {
            const res = await fetch('/api/colors/custom-themes');
            this._themeList = res && res.ok ? await res.json() : {};
        } catch {
            this._themeList = {};
        }
        const select = document.querySelector('[data-appearance-select="theme"]');
        if (select && this.isActiveView() && this.section === 'appearance') {
            select.innerHTML = this.renderThemeOptions();
        }
    }

    fontPresetLabel(preset) {
        const map = {
            'source-code-pro': ['config.fontPresetSourceCodePro', 'Source Code Pro'],
            'jetbrains-mono': ['config.fontPresetJetBrainsMono', 'JetBrains Mono'],
            'ibm-plex-mono': ['config.fontPresetIbmPlexMono', 'IBM Plex Mono'],
            inter: ['config.fontPresetInter', 'Inter'],
            'ibm-plex-sans': ['config.fontPresetIbmPlexSans', 'IBM Plex Sans'],
            'dm-sans': ['config.fontPresetDmSans', 'DM Sans'],
            system: ['config.fontPresetSystem', 'System'],
        };
        const [key, fallback] = map[preset] || [preset, preset];
        return this.t(key, fallback);
    }

    bindAppearanceControls(container) {
        container.querySelectorAll('[data-appearance-theme]').forEach((btn) => {
            btn.addEventListener('click', () => this.setTheme(btn.getAttribute('data-appearance-theme')));
        });
        container.querySelectorAll('[data-appearance-font]').forEach((btn) => {
            btn.addEventListener('click', () => this.setFontSize(btn.getAttribute('data-appearance-font')));
        });
        container.querySelectorAll('[data-appearance-layout]').forEach((btn) => {
            btn.addEventListener('click', () => this.setLayout(btn.getAttribute('data-appearance-layout')));
        });
        container.querySelectorAll('[data-appearance-weight]').forEach((btn) => {
            btn.addEventListener('click', () => this.setFontWeight(btn.getAttribute('data-appearance-weight')));
        });
        container.querySelectorAll('[data-appearance-bg]').forEach((btn) => {
            btn.addEventListener('click', () => this.setBackgroundType(btn.getAttribute('data-appearance-bg')));
        });
        container.querySelectorAll('[data-appearance-iconsize]').forEach((btn) => {
            btn.addEventListener('click', () => this.setLauncherIconSize(btn.getAttribute('data-appearance-iconsize')));
        });
        container.querySelectorAll('[data-appearance-toggle]').forEach((input) => {
            input.addEventListener('change', () => this.setToggle(input.getAttribute('data-appearance-toggle'), input.checked));
        });
        container.querySelectorAll('[data-appearance-select]').forEach((select) => {
            select.addEventListener('change', () => this.setAppearanceSelect(select.getAttribute('data-appearance-select'), select.value));
        });
        // Range and text update live without a full repaint so the control keeps focus.
        const range = container.querySelector('[data-appearance-range="backgroundOpacity"]');
        if (range) {
            range.addEventListener('input', () => {
                const val = Number(range.value);
                this.dash.settings.backgroundOpacity = val;
                this.dash.visual?.applyVisualSettings?.();
                const out = range.parentElement?.querySelector('.config-range-value');
                if (out) out.textContent = `${Math.round(val * 100)}%`;
            });
            range.addEventListener('change', () => void this.saveSettingsWithFeedback());
        }
        const titleInput = container.querySelector('[data-appearance-text="customTitle"]');
        if (titleInput) {
            titleInput.addEventListener('input', () => { this.dash.settings.customTitle = titleInput.value; });
            titleInput.addEventListener('change', () => {
                void this.saveSettingsWithFeedback();
                this.dash.pageNav?.updateDocumentTitle?.();
            });
        }
        container.querySelectorAll('[data-appearance-action]').forEach((btn) => {
            btn.addEventListener('click', () => this.handleAppearanceAction(btn.getAttribute('data-appearance-action')));
        });
        const fontInput = container.querySelector('#config-font-input');
        if (fontInput) {
            fontInput.addEventListener('change', () => {
                const file = fontInput.files && fontInput.files[0];
                if (file) void this.uploadFont(file);
                fontInput.value = '';
            });
        }
        const faviconInput = container.querySelector('#config-favicon-input');
        if (faviconInput) {
            faviconInput.addEventListener('change', () => {
                const file = faviconInput.files && faviconInput.files[0];
                if (file) void this.uploadFavicon(file);
                faviconInput.value = '';
            });
        }
        // ℹ info modals + ↺ reset-to-default. Reset routes through the field's
        // live setter (via applyAppearanceField), which repaints the section so
        // the ↺ visibility refreshes.
        this.bindAffordances(container, null, (field, def) => this.applyAppearanceField(field, def));
    }

    /** Persist a settings change and repaint the appearance section. */
    persistAppearance() {
        void this.saveSettingsWithFeedback();
        if (this.isActiveView() && this.section === 'appearance') {
            const body = document.getElementById('config-view-body');
            if (body) {
                body.innerHTML = this.renderAppearance();
                const container = document.getElementById('dashboard-layout');
                if (container) this.bindAppearanceControls(container);
            }
        }
    }

    /**
     * The theme actually shown, which is not always the theme that is stored:
     * with "follow system dark mode" on, a stored `moss-stone-dark` displays as
     * `moss-stone-light` while the OS is in light mode. ThemeLoader owns that
     * pairing, so ask it rather than reducing the value to light/dark here —
     * doing that by hand was what made the toggle look like it did nothing, and
     * it also threw away which theme had been picked.
     */
    displayTheme() {
        const s = this.dash.settings || {};
        const stored = s.theme || 'dark';
        const resolved = window.ThemeLoader?.resolveDisplayTheme?.(stored, s.autoDarkMode === true);
        return resolved || stored;
    }

    /**
     * Apply the theme as it should currently display. Routed through the
     * dashboard's own auto-dark wiring, which additionally keeps the
     * `data-auto-dark-mode` attribute in sync (ThemeLoader reads it on the next
     * load) and registers the OS-preference listener so a system switch while
     * the page is open follows along. Only the fallback path applies the theme
     * by hand.
     */
    applyThemeLive() {
        const s = this.dash.settings || {};
        if (this.dash.visual?.initializeAutoDarkMode) {
            this.dash.visual.initializeAutoDarkMode();
        } else {
            window.ThemeLoader?.applyTheme?.(
                this.displayTheme(),
                s.showBackgroundDots !== false,
                this.currentFontSize()
            );
        }
        this.reloadThemeCSS();
    }

    /** Render the ℹ/↺ affordances for an Appearance-section field. */
    appearanceAff(field) {
        const aff = this.renderFieldAffordances(field, this.dash.settings?.[field]);
        return aff ? `<span class="config-field-affordances">${aff}</span>` : '';
    }

    /**
     * Route an Appearance field to its dedicated setter. Used by the ↺
     * reset-to-default buttons so a reset applies live exactly like the control.
     */
    applyAppearanceField(field, value) {
        switch (field) {
            case 'fontPreset': this.setAppearanceSelect('fontPreset', value); break;
            case 'fontWeight': this.setFontWeight(value); break;
            case 'backgroundType': this.setBackgroundType(value); break;
            case 'backgroundOpacity':
                this.dash.settings.backgroundOpacity = Number(value);
                this.dash.visual?.applyVisualSettings?.();
                this.persistAppearance();
                break;
            case 'launcherIconSize': this.setLauncherIconSize(value); break;
            case 'layoutVersion': this.setLayout(value); break;
            default:
                // Fall back to a plain settings write + repaint for any field
                // without a dedicated live setter.
                this.dash.settings[field] = value;
                this.persistAppearance();
        }
    }

    setTheme(theme) {
        if (!theme) return;
        // The choice is stored as picked; what gets displayed runs through
        // applyThemeLive, which pairs it with the OS preference when "follow
        // system dark mode" is on. Applying `theme` directly here ignored that.
        this.dash.settings.theme = theme;
        this.applyThemeLive();
        this.persistAppearance();
    }

    setFontSize(size) {
        if (!DashboardConfig.FONT_SIZES.includes(size)) return;
        this.dash.settings.fontSize = size;
        this.dash.applyFontSize?.();
        this.persistAppearance();
    }

    setLayout(version) {
        if (version !== 'classic' && version !== 'modern') return;
        this.dash.settings.layoutVersion = version;
        window.ThemeLoader?.applyLayoutVersion?.(version);
        this.persistAppearance();
    }

    setToggle(name, value) {
        const d = this.dash;
        switch (name) {
            case 'autoDarkMode':
                d.settings.autoDarkMode = value;
                this.applyThemeLive();
                break;
            case 'showBackgroundDots':
                d.settings.showBackgroundDots = value;
                this.applyThemeLive();
                break;
            case 'showIcons':
                d.settings.showIcons = value;
                d.renderDashboard?.({ animate: false });
                break;
            case 'colorizeStatus':
                d.settings.colorizeStatus = value;
                d.renderDashboard?.({ animate: false });
                break;
            case 'animationsEnabled':
                d.settings.animationsEnabled = value;
                d.visual?.applyVisualSettings?.();
                break;
            case 'enableCustomTitle':
                d.settings.enableCustomTitle = value;
                d.pageNav?.updateDocumentTitle?.();
                break;
            default:
                return;
        }
        this.persistAppearance();
    }

    setFontWeight(weight) {
        if (!['normal', '600', 'bold'].includes(weight)) return;
        this.dash.settings.fontWeight = weight;
        this.dash.visual?.applyVisualSettings?.();
        this.persistAppearance();
    }

    setBackgroundType(type) {
        if (!['auto', 'none', 'gradient', 'image'].includes(type)) return;
        this.dash.settings.backgroundType = type;
        this.dash.visual?.applyBackground?.();
        this.persistAppearance();
    }

    setLauncherIconSize(size) {
        if (!['small', 'normal', 'large'].includes(size)) return;
        this.dash.settings.launcherIconSize = size;
        this.dash.visual?.applyVisualSettings?.();
        this.persistAppearance();
    }

    setAppearanceSelect(name, value) {
        if (name === 'fontPreset') {
            this.dash.settings.fontPreset = value;
            window.DashboardFont?.applyMainFont?.(this.dash.settings);
            this.persistAppearance();
            return;
        }
        if (name === 'theme') {
            this.setTheme(value);
        }
    }

    /** Reload the server-rendered theme stylesheet so a theme change takes effect. */
    reloadThemeCSS() {
        const link = document.querySelector('link[href^="/api/theme.css"]');
        if (!link || !link.parentNode) return;
        const next = link.cloneNode(true);
        next.href = `/api/theme.css?t=${Date.now()}`;
        link.parentNode.replaceChild(next, link);
    }

    handleAppearanceAction(action) {
        switch (action) {
            case 'edit-colors': void this.toggleThemeColorsEditor(); break;
            case 'upload-font': document.getElementById('config-font-input')?.click(); break;
            case 'upload-favicon': document.getElementById('config-favicon-input')?.click(); break;
        }
    }

    /**
     * Reveal the theme-colours editor. Its markup ships hidden in the shell
     * (#config-theme-colors-host, from the server-rendered partial); on first
     * open we move it into the appearance panel and instantiate the existing
     * ColorsEditor against it, so the whole editor is reused, not rebuilt.
     */
    async toggleThemeColorsEditor() {
        const panel = document.getElementById('config-theme-colors-panel');
        const host = document.getElementById('config-theme-colors-host');
        if (!panel || !host) {
            this.notify(this.t('config.colorsUnavailable', 'The colour editor could not be loaded.'), 'error');
            return;
        }
        if (this._colorsShown) {
            host.hidden = true;
            this._colorsShown = false;
            return;
        }
        if (host.parentElement !== panel) panel.appendChild(host);
        host.hidden = false;
        this._colorsShown = true;
        if (this._colorsEditor) return;
        if (typeof ColorsEditor !== 'function') {
            this.notify(this.t('config.colorsUnavailable', 'The colour editor could not be loaded.'), 'error');
            return;
        }
        try {
            this._colorsEditor = new ColorsEditor({
                root: host.querySelector('#theme-colors-editor') || host,
                language: this.dash.language,
                settings: this.dash.settings,
            });
            await this._colorsEditor.init();
        } catch {
            this.notify(this.t('config.colorsUnavailable', 'The colour editor could not be loaded.'), 'error');
        }
    }

    async uploadFont(file) {
        try {
            const form = new FormData();
            form.append('font', file);
            const res = await this.writeFetch('/api/font', { method: 'POST', body: form });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json().catch(() => ({}));
            if (body.path) this.dash.settings.customFontPath = body.path;
            this.dash.settings.fontPreset = 'custom';
            this.dash.settings.enableCustomFont = true;
            window.DashboardFont?.applyMainFont?.(this.dash.settings);
            this.dash.saveSettings?.();
            this.notify(this.t('config.fontUploadSuccess', 'Custom font applied.'), 'success');
            this.persistAppearance();
        } catch {
            this.notify(this.t('config.fontUploadError', 'Could not upload the font.'), 'error');
        }
    }

    async uploadFavicon(file) {
        try {
            const form = new FormData();
            form.append('favicon', file);
            const res = await this.writeFetch('/api/favicon', { method: 'POST', body: form });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json().catch(() => ({}));
            if (body.path) this.dash.settings.customFaviconPath = body.path;
            this.dash.settings.enableCustomFavicon = true;
            this.dash.saveSettings?.();
            this.notify(this.t('config.faviconUploadSuccess', 'Custom favicon applied. Reloading…'), 'success');
            setTimeout(() => window.location.reload(), 1000);
        } catch {
            this.notify(this.t('config.faviconUploadError', 'Could not upload the favicon.'), 'error');
        }
    }

    /* ── Setting metadata (info + installation defaults) ───────────────────── */

    /**
     * Per-field metadata ported from the old config: the ℹ info modal's i18n
     * keys (from SETTING_INFO_DEFS) and the installation default value (from
     * ConfigSettingsDefaults). Keyed by the settings field the control binds.
     * `info` is `[titleKey, messageKey]`; `def` is the installation default.
     */
    static FIELD_META = {
        // General
        language: { info: ['languageInfoTitle', 'languageInfoMessage'], def: 'en' },
        openInNewTab: { info: ['openLinksInNewTabInfoTitle', 'openLinksInNewTabInfoMessage'] },
        globalShortcuts: { info: ['globalShortcutsInfoTitle', 'globalShortcutsInfoMessage'] },
        allowLocalBookmarks: { info: ['allowLocalBookmarksInfoTitle', 'allowLocalBookmarksInfoMessage'] },
        enableSessionTips: { info: ['sessionTipsInfoTitle', 'sessionTipsInfoMessage'] },
        hyprMode: { info: ['hyprModeInfoTitle', 'hyprModeInfoMessage'], def: false },
        // Date, time & weather
        dateFormat: { info: ['dateFormatInfoTitle', 'dateFormatInfoMessage'], def: 'short-slash' },
        timeFormat: { info: ['timeFormatInfoTitle', 'timeFormatInfoMessage'], def: '24h' },
        showDate: { info: ['showDateInfoTitle', 'showDateInfoMessage'], def: true },
        showTime: { info: ['showTimeInfoTitle', 'showTimeInfoMessage'], def: true },
        showWeatherWithDate: { info: ['showWeatherWithDateInfoTitle', 'showWeatherWithDateInfoMessage'], def: false },
        weatherSource: { info: ['weatherSourceInfoTitle', 'weatherSourceInfoMessage'], def: 'manual' },
        weatherUnit: { info: ['weatherUnitInfoTitle', 'weatherUnitInfoMessage'], def: 'celsius' },
        weatherLocation: { info: ['weatherLocationInfoTitle', 'weatherLocationInfoMessage'] },
        // Layout
        columnsPerRow: { info: ['columnsInfoTitle', 'columnsInfoMessage'] },
        densityMode: { info: ['densityModeInfoTitle', 'densityModeInfoMessage'], def: 'compact' },
        packedColumns: { info: ['packedColumnsInfoTitle', 'packedColumnsInfoMessage'], def: true },
        interleaveMode: { info: ['interleaveModeInfoTitle', 'interleaveModeInfoMessage'], def: false },
        hideEmptyCategories: { info: ['hideEmptyCategoriesInfoTitle', 'hideEmptyCategoriesInfoMessage'] },
        alwaysCollapseCategories: { info: ['alwaysCollapseCategoriesInfoTitle', 'alwaysCollapseCategoriesInfoMessage'] },
        layoutVersion: { info: ['layoutVersionInfoTitle', 'layoutVersionInfoMessage'], def: 'classic' },
        launcherIconSize: { info: ['launcherIconSizeInfoTitle', 'launcherIconSizeInfoMessage'], def: 'normal' },
        // Bookmark display
        showShortcuts: { info: ['showShortcutsInfoTitle', 'showShortcutsInfoMessage'] },
        showStatus: { info: ['showBookmarkStatusInfoTitle', 'showBookmarkStatusInfoMessage'], def: true },
        showPing: { info: ['showPingTimesInfoTitle', 'showPingTimesInfoMessage'], def: true },
        showLinkPreviewCards: { info: ['showLinkPreviewCardsInfoTitle', 'showLinkPreviewCardsInfoMessage'], def: false },
        colorizeStatus: { info: ['colorizeStatusInfoTitle', 'colorizeStatusInfoMessage'], def: true },
        showIcons: { info: ['showIconsInfoTitle', 'showIconsInfoMessage'] },
        // Toolbar & tabs
        showPageTabs: { info: ['showPageTabsInfoTitle', 'showPageTabsInfoMessage'], def: true },
        showPageNamesInTabs: { info: ['showPageNamesInTabsInfoTitle', 'showPageNamesInTabsInfoMessage'] },
        showTitle: { info: ['showDashboardTitleInfoTitle', 'showDashboardTitleInfoMessage'] },
        showTagCloudButton: { info: ['showTagCloudButtonInfoTitle', 'showTagCloudButtonInfoMessage'] },
        // Search
        includeFindersInSearch: { info: ['includeFindersInSearchInfoTitle', 'includeFindersInSearchInfoMessage'] },
        enableFuzzySuggestions: { info: ['fuzzySuggestionsInfoTitle', 'fuzzySuggestionsInfoMessage'] },
        fuzzySuggestionsStartWith: { info: ['fuzzySuggestionsStartWithInfoTitle', 'fuzzySuggestionsStartWithInfoMessage'] },
        keepSearchOpenWhenEmpty: { info: ['keepSearchOpenWhenEmptyInfoTitle', 'keepSearchOpenWhenEmptyInfoMessage'] },
        showSearchFlowBanner: { info: ['showSearchFlowBannerInfoTitle', 'showSearchFlowBannerInfoMessage'], def: true },
        // Quick add & inbox
        pasteUrlQuickAdd: { info: ['pasteUrlQuickAddInfoTitle', 'pasteUrlQuickAddInfoMessage'], def: true },
        inboxEnabled: { info: ['inboxEnabledInfoTitle', 'inboxEnabledInfoMessage'], def: true },
        // Status & health
        statusRecheckIntervalMinutes: { info: ['statusRecheckIntervalInfoTitle', 'statusRecheckIntervalInfoMessage'], def: 5 },
        healthAutoRecheckEnabled: { info: ['healthRecheckInfoTitle', 'healthRecheckInfoMessage'] },
        healthRecheckIntervalMinutes: { def: 60 },
        skipFastPing: { info: ['skipFastPingInfoTitle', 'skipFastPingInfoMessage'] },
        statusOfflineRetries: { info: ['statusOfflineRetriesInfoTitle', 'statusOfflineRetriesInfoMessage'], def: 1 },
        statusOfflineRetryDelayMs: { info: ['statusOfflineRetryDelayInfoTitle', 'statusOfflineRetryDelayInfoMessage'], def: 1500 },
        showStatusLoading: { info: ['showStatusLoadingInfoTitle', 'showStatusLoadingInfoMessage'] },
        monitorNotifyUrl: { info: ['monitorNotifyUrlInfoTitle', 'monitorNotifyUrlInfoMessage'] },
        monitorNotifyRetries: { def: 3 },
        // Toolbar & chrome
        showRecentButton: { def: true },
        showCheatSheetButton: { def: true },
        showConfigButton: { def: true },
        showHealthDashboard: { def: true },
        showAddBookmarkButton: { def: true },
        showSearchButton: { def: true },
        showFindersButton: { def: true },
        showCommandsButton: { def: true },
        buttonBarPosition: { info: ['buttonBarPositionInfoTitle', 'buttonBarPositionInfoMessage'], def: 'center' },
        showPageInTitle: { info: ['showPageInTitleInfoTitle', 'showPageInTitleInfoMessage'] },
        // Weather & calendar
        weatherRefreshMinutes: { def: 30 },
        calendarUrl: { info: ['calendarUrlInfoTitle', 'calendarUrlInfoMessage'] },
        // Link previews
        linkPreviewHoverDelayMs: { info: ['linkPreviewHoverDelayInfoTitle', 'linkPreviewHoverDelayInfoMessage'], def: 400 },
        // Sync
        showSyncToasts: { info: ['showSyncToastsInfoTitle', 'showSyncToastsInfoMessage'] },
        faviconRefreshPolicy: { info: ['faviconRefreshPolicyInfoTitle', 'faviconRefreshPolicyInfoMessage'], def: 'monthly' },
        // Privacy
        analyticsOptIn: { info: ['usageAnalyticsInfoTitle', 'usageAnalyticsInfoMessage'], hint: 'usageAnalyticsHint' },
        // Appearance
        autoDarkMode: { info: ['autoDarkModeInfoTitle', 'autoDarkModeInfoMessage'] },
        showBackgroundDots: { info: ['showBackgroundDotsInfoTitle', 'showBackgroundDotsInfoMessage'] },
        animationsEnabled: { info: ['enableAnimationsInfoTitle', 'enableAnimationsInfoMessage'] },
        fontPreset: { info: ['fontPresetInfoTitle', 'fontPresetInfoMessage'], def: 'source-code-pro' },
        fontWeight: { info: ['fontWeightInfoTitle', 'fontWeightInfoMessage'], def: 'normal' },
        backgroundType: { info: ['backgroundPickerInfoTitle', 'backgroundPickerInfoMessage'], def: 'auto' },
        backgroundOpacity: { info: ['backgroundOpacityInfoTitle', 'backgroundOpacityInfoMessage'], def: 1 },
        enableCustomTitle: { info: ['enableCustomTitleInfoTitle', 'enableCustomTitleInfoMessage'] },
        enableCustomFavicon: { info: ['enableCustomFaviconInfoTitle', 'enableCustomFaviconInfoMessage'] },
        // Collections
        showSmartTodayCollection: { def: true },
        showSmartRecentCollection: { def: false },
        showSmartStaleCollection: { def: false },
        showSmartMostUsedCollection: { def: false },
        smartTodayLimit: { def: 8 },
        smartRecentLimit: { def: 50 },
        smartStaleLimit: { def: 50 },
        smartMostUsedLimit: { def: 25 },
        // Data
        deviceSpecificSettings: { info: ['deviceSpecificSettingsInfoTitle', 'deviceSpecificSettingsInfoMessage'] },
        autoBackupEnabled: { info: ['autoBackupInfoTitle', 'autoBackupInfoMessage'] },
    };

    fieldMeta(field) {
        return DashboardConfig.FIELD_META[field] || null;
    }

    /** Whether a field's current value differs from its installation default. */
    isFieldDefault(field, value) {
        const meta = this.fieldMeta(field);
        if (!meta || meta.def === undefined) return true; // no known default → hide reset
        const d = meta.def;
        if (typeof d === 'boolean') return Boolean(value) === d;
        if (typeof d === 'number') return Number(value) === d;
        return String(value ?? '') === String(d);
    }

    /** Open the shared info modal for a setting field. */
    openFieldInfo(field) {
        const meta = this.fieldMeta(field);
        if (!meta?.info || !window.AppModal?.alert) return;
        const [titleKey, msgKey] = meta.info;
        window.AppModal.alert({
            title: this.t(`config.${titleKey}`, ''),
            htmlMessage: this.dash.escapeHtml(this.t(`config.${msgKey}`, '')).replace(/\n/g, '<br>'),
            confirmText: this.t('config.gotIt', 'Got it'),
        });
    }

    /* ── Behavior ──────────────────────────────────────────────────────────── */

    /**
     * Declarative schema for the behaviour settings, grouped into panels. Each
     * control names the settings field it binds, its type, and (for selects) its
     * options. A generic renderer/binder drives them so the whole set stays in
     * one place — this mirrors the old config's general/keyboard/language tabs.
     */
    behaviorSchema() {
        const t = (k, f) => this.t(k, f);
        const bool = (field, label, fallback) => ({ field, type: 'checkbox', label: t(label, fallback) });
        const opt = (value, label) => ({ value, label });
        return [
            {
                tab: 'general',
                title: t('config.generalGroupGeneral', 'General'),
                controls: [
                    { field: 'language', type: 'select', label: t('config.languageLabel', 'Language'), special: 'language', options: [
                        opt('en', 'English'), opt('nl', 'Nederlands'), opt('de', 'Deutsch'), opt('fr', 'Français'),
                    ] },
                    bool('openInNewTab', 'config.openInNewTab', 'Open links in a new tab'),
                    bool('globalShortcuts', 'config.globalShortcutsLabel', 'Global keyboard shortcuts'),
                    bool('allowLocalBookmarks', 'config.allowLocalBookmarks', 'Allow local (non-http) bookmark URLs'),
                    bool('enableSessionTips', 'config.sessionTipsLabel', 'Show occasional tips'),
                    bool('hyprMode', 'config.hyprModeLabel', 'Hypr mode'),
                ],
            },
            {
                tab: 'datetime',
                title: t('config.generalGroupDateTime', 'Date, time & weather'),
                controls: [
                    { field: 'dateFormat', type: 'select', label: t('config.dateFormatLabel', 'Date format'), special: 'datetime', options: [
                        opt('short-slash', '31/12/2026'), opt('short-dash', '31-12-2026'), opt('mm-slash', '12/31/2026'),
                        opt('iso', '2026-12-31'), opt('weekday-only', 'Thursday'), opt('long-weekday', 'Thu 31 Dec'),
                    ] },
                    { field: 'timeFormat', type: 'select', label: t('config.timeFormatLabel', 'Time format'), special: 'datetime', options: [
                        opt('24h', '23:59'), opt('12h', '11:59 PM'),
                    ] },
                    bool('showDate', 'config.showDateLabel', 'Show the date'),
                    bool('showTime', 'config.showTimeLabel', 'Show the time'),
                    bool('showWeatherWithDate', 'config.showWeatherWithDate', 'Show weather next to the date'),
                    { field: 'weatherSource', type: 'select', label: t('config.weatherSourceLabel', 'Weather source'), special: 'datetime', options: [
                        opt('manual', t('config.weatherSourceManual', 'Manual location')), opt('auto', t('config.weatherSourceAuto', 'Automatic (by IP)')),
                    ] },
                    { field: 'weatherUnit', type: 'select', label: t('config.weatherUnitLabel', 'Temperature unit'), special: 'datetime', options: [
                        opt('celsius', '°C'), opt('fahrenheit', '°F'),
                    ] },
                    { field: 'weatherLocation', type: 'text', label: t('config.weatherLocationLabel', 'Weather location'), special: 'datetime' },
                    { field: 'weatherRefreshMinutes', type: 'number', label: t('config.weatherRefreshLabel', 'Refresh weather every (minutes)'), min: 5, max: 1440, special: 'datetime' },
                    { field: 'calendarUrl', type: 'text', label: t('config.calendarUrlLabel', 'Calendar URL (iCal)'), special: 'datetime' },
                ],
            },
            {
                tab: 'layout',
                title: t('config.generalGroupLayout', 'Bookmarks layout'),
                controls: [
                    { field: 'columnsPerRow', type: 'number', label: t('config.columnsLabel', 'Columns'), min: 1, max: 12, special: 'render' },
                    { field: 'densityMode', type: 'select', label: t('config.densityLabel', 'Density'), special: 'render', options: [
                        opt('comfortable', t('config.densityComfortable', 'Comfortable')), opt('compact', t('config.densityCompact', 'Compact')),
                        opt('dense', t('config.densityDense', 'Dense')), opt('auto', t('config.densityAuto', 'Auto')),
                    ] },
                    bool('packedColumns', 'config.packedColumnsLabel', 'Pack columns tightly'),
                    bool('interleaveMode', 'config.interleaveModeLabel', 'Interleave categories across columns'),
                    bool('hideEmptyCategories', 'config.hideEmptyCategoriesLabel', 'Hide empty categories'),
                    bool('alwaysCollapseCategories', 'config.alwaysCollapseCategoriesLabel', 'Start with categories collapsed'),
                ],
            },
            {
                tab: 'display',
                title: t('config.generalGroupBookmarkDisplay', 'Bookmark display'),
                controls: [
                    bool('showShortcuts', 'config.showShortcutsLabel', 'Show shortcut letters'),
                    bool('showStatus', 'config.showStatusLabel', 'Show online/offline status'),
                    bool('showStatusLoading', 'config.showStatusLoadingLabel', 'Show a loading state while checking'),
                    bool('showPing', 'config.showPingLabel', 'Show ping times'),
                    bool('showLinkPreviewCards', 'config.showLinkPreviewCardsLabel', 'Show link preview cards'),
                    { field: 'linkPreviewHoverDelayMs', type: 'select', label: t('config.linkPreviewHoverDelayLabel', 'Preview hover delay'), options: [
                        opt(0, t('config.linkPreviewDelayInstant', 'Instant')), opt(200, '200 ms'), opt(400, '400 ms'),
                        opt(700, '700 ms'), opt(1000, '1 s'),
                    ] },
                    bool('showPageInTitle', 'config.showPageInTitleLabel', 'Show the page name in the browser title'),
                ],
            },
            {
                tab: 'display',
                title: t('config.generalGroupChrome', 'Toolbar & tabs'),
                controls: [
                    bool('showPageTabs', 'config.showPageTabsLabel', 'Show page tabs'),
                    bool('showPageNamesInTabs', 'config.showPageNamesInTabsLabel', 'Show page names in tabs'),
                    bool('showTitle', 'config.showTitleLabel', 'Show the dashboard title'),
                    bool('showAddBookmarkButton', 'config.showAddBookmarkButtonLabel', 'Show the add-bookmark button'),
                    bool('showSearchButton', 'config.showSearchButtonLabel', 'Show the search button'),
                    bool('showFindersButton', 'config.showFindersButtonLabel', 'Show the finders button'),
                    bool('showCommandsButton', 'config.showCommandsButtonLabel', 'Show the commands button'),
                    bool('showTagCloudButton', 'config.showTagCloudButtonLabel', 'Show the tag-cloud button'),
                    bool('showRecentButton', 'config.showRecentButtonLabel', 'Show the recent button'),
                    bool('showCheatSheetButton', 'config.showCheatSheetButtonLabel', 'Show the cheat-sheet button'),
                    bool('showConfigButton', 'config.showConfigButtonLabel', 'Show the config button'),
                    bool('showHealthDashboard', 'config.showHealthDashboardLabel', 'Show the health icon'),
                    { field: 'buttonBarPosition', type: 'select', label: t('config.buttonBarPositionLabel', 'Button bar position'), special: 'render', options: [
                        opt('center', t('config.buttonBarCenter', 'Centre dock')), opt('left', t('config.buttonBarLeft', 'Left rail')),
                        opt('right', t('config.buttonBarRight', 'Right rail')),
                    ] },
                ],
            },
            {
                tab: 'search',
                title: t('config.generalGroupSearch', 'Search'),
                controls: [
                    bool('includeFindersInSearch', 'config.includeFindersInSearch', 'Include finders in search'),
                    bool('enableFuzzySuggestions', 'config.enableFuzzySuggestions', 'Fuzzy search suggestions'),
                    bool('fuzzySuggestionsStartWith', 'config.fuzzySuggestionsStartWith', 'Prefer matches that start with the query'),
                    bool('keepSearchOpenWhenEmpty', 'config.keepSearchOpenWhenEmpty', 'Keep search open when empty'),
                    bool('showSearchFlowBanner', 'config.showSearchFlowBanner', 'Show the search flow hint'),
                ],
            },
            {
                tab: 'search',
                title: t('config.generalGroupQuickAdd', 'Quick add & inbox'),
                controls: [
                    bool('pasteUrlQuickAdd', 'config.pasteUrlQuickAdd', 'Quick-add a pasted URL'),
                    bool('inboxEnabled', 'config.inboxEnabledLabel', 'Enable the inbox'),
                    { field: 'pasteDestination', type: 'select', label: t('config.pasteDestinationLabel', 'Paste destination'), options: [
                        opt('ask', t('config.pasteDestinationAsk', 'Ask each time')), opt('bookmark', t('config.pasteDestinationBookmark', 'New bookmark')),
                        opt('inbox', t('config.pasteDestinationInbox', 'Inbox')),
                    ] },
                ],
            },
            {
                tab: 'status',
                title: t('config.statusBrowserChecksTitle', 'Checks in this browser'),
                note: t('config.statusBrowserChecksNote', 'How the dashboard tests the bookmarks on screen while you have it open. Applies to bookmarks set to Periodic or Monitor; a bookmark set to Off is never tested.'),
                appliesTo: t('config.appliesToPeriodicMonitor', 'Periodic + Monitor'),
                controls: [
                    { field: 'statusRecheckIntervalMinutes', type: 'select', label: t('config.statusRecheckIntervalLabel', 'Re-check every'), options: [
                        opt(1, '1 min'), opt(5, '5 min'), opt(15, '15 min'), opt(30, '30 min'),
                        opt(60, '1 h'), opt(360, '6 h'), opt(1440, '24 h'),
                    ] },
                    bool('skipFastPing', 'config.skipFastPingLabel', 'Skip the fast ping pre-check'),
                    { field: 'statusOfflineRetries', type: 'number', label: t('config.statusOfflineRetriesLabel', 'Retries before offline'), min: 0, max: 10 },
                    { field: 'statusOfflineRetryDelayMs', type: 'number', label: t('config.statusOfflineRetryDelayLabel', 'Delay between retries (ms)'), min: 0, max: 60000 },
                ],
            },
            {
                tab: 'status',
                title: t('config.statusServerChecksTitle', 'Checks on the server'),
                note: t('config.statusServerChecksNote', 'Re-tests bookmarks on the server, so the Health view stays current without anyone having the dashboard open. Off by default because it makes outbound requests.'),
                appliesTo: t('config.appliesToPeriodicMonitor', 'Periodic + Monitor'),
                controls: [
                    bool('healthAutoRecheckEnabled', 'config.healthRecheckLabel', 'Re-check in the background'),
                    { field: 'healthRecheckIntervalMinutes', type: 'select', label: t('config.healthRecheckIntervalLabel', 'Background re-check interval'), options: [
                        opt(15, '15 min'), opt(30, '30 min'), opt(60, '1 h'), opt(360, '6 h'), opt(1440, '24 h'),
                    ] },
                ],
            },
            {
                tab: 'status',
                title: t('config.generalGroupMonitorNotify', 'Downtime alerts'),
                note: t('config.statusAlertsNote', 'Posts to a webhook when a monitored bookmark goes down and again when it recovers. Only monitored bookmarks raise alerts — Periodic flags a broken link in the Health view but never notifies.'),
                appliesTo: t('config.appliesToMonitorOnly', 'Monitor only'),
                controls: [
                    { field: 'monitorNotifyUrl', type: 'text', label: t('config.monitorNotifyUrlLabel', 'Alert webhook URL') },
                    { field: 'monitorNotifyRetries', type: 'select', label: t('config.monitorNotifyRetriesLabel', 'Alert after this many failures'), options: [
                        opt(1, '1'), opt(2, '2'), opt(3, '3'), opt(5, '5'), opt(10, '10'),
                    ] },
                ],
            },
            {
                tab: 'general',
                title: t('config.generalGroupSync', 'Sync & feedback'),
                controls: [
                    bool('showSyncToasts', 'config.showSyncToastsLabel', 'Show sync notifications'),
                    bool('deviceSpecificSettings', 'config.deviceSpecificSettingsLabel', 'Keep settings on this device only'),
                ],
            },
            {
                tab: 'privacy',
                title: t('config.generalGroupPrivacy', 'Privacy'),
                controls: [
                    { field: 'analyticsOptIn', type: 'checkbox', label: t('config.usageAnalyticsLabel', 'Share anonymous usage analytics'), disabled: this.dash.telemetryLockedOff === true },
                ],
            },
        ];
    }

    /** ℹ + ↺ affordances shown after a control, based on the field's metadata. */
    renderFieldAffordances(field, val) {
        const esc = (v) => this.dash.escapeHtml(v);
        const meta = this.fieldMeta(field);
        let out = '';
        if (meta?.info) {
            out += `<button type="button" class="config-info-btn" data-info-field="${esc(field)}" aria-label="${esc(this.t('config.settingInfoAria', 'More info'))}" title="${esc(this.t('config.settingInfoAria', 'More info'))}">ℹ</button>`;
        }
        const showReset = meta && meta.def !== undefined && !this.isFieldDefault(field, val);
        if (meta && meta.def !== undefined) {
            out += `<button type="button" class="config-reset-btn${showReset ? ' is-visible' : ''}" data-reset-field="${esc(field)}" aria-label="${esc(this.t('config.settingResetAria', 'Reset to default'))}" title="${esc(this.t('config.settingResetTitle', 'Reset to default'))}">↺</button>`;
        }
        return out;
    }

    /** Render a schema of panels into HTML, keyed by a data-<prefix>-field. */
    renderControlPanels(schema, prefix) {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        const renderControl = (c) => {
            const val = s[c.field];
            const dataAttrs = `data-${prefix}-field="${esc(c.field)}" data-${prefix}-special="${esc(c.special || '')}"`;
            const aff = this.renderFieldAffordances(c.field, val);
            const hintKey = this.fieldMeta(c.field)?.hint;
            const hint = hintKey ? `<p class="config-field-hint">${esc(this.t(`config.${hintKey}`, ''))}</p>` : '';
            if (c.type === 'checkbox') {
                return `
                    <div class="config-field-row">
                        <label class="config-toggle">
                            <input type="checkbox" ${dataAttrs} data-${prefix}-type="checkbox" ${val ? 'checked' : ''} ${c.disabled ? 'disabled' : ''}>
                            <span>${esc(c.label)}</span>
                        </label>
                        <span class="config-field-affordances">${aff}</span>
                    </div>${hint}`;
            }
            let control;
            if (c.type === 'select') {
                const opts = c.options.map((o) =>
                    `<option value="${esc(o.value)}" ${String(val) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`
                ).join('');
                control = `<select class="config-select" ${dataAttrs} data-${prefix}-type="select">${opts}</select>`;
            } else if (c.type === 'number') {
                control = `<input type="number" class="config-text" style="min-width:80px" ${dataAttrs} data-${prefix}-type="number" min="${c.min ?? ''}" max="${c.max ?? ''}" value="${esc(val ?? '')}">`;
            } else {
                control = `<input type="text" class="config-text" ${dataAttrs} data-${prefix}-type="text" value="${esc(val ?? '')}">`;
            }
            return `
                <div class="config-field">
                    <span class="config-field-label">${esc(c.label)}</span>
                    ${control}
                    <span class="config-field-affordances">${aff}</span>
                </div>${hint}`;
        };
        // `note` explains the panel; `appliesTo` names the availability modes the
        // panel's settings actually affect, because several of them are inert
        // unless a bookmark is set to Periodic or Monitor.
        return schema.map((panel) => {
            const badge = panel.appliesTo
                ? `<span class="config-applies-to" title="${esc(this.t('config.appliesToTitle', 'These settings only take effect for bookmarks set to this mode'))}">${esc(panel.appliesTo)}</span>`
                : '';
            const note = panel.note ? `<p class="config-panel-note">${esc(panel.note)}</p>` : '';
            return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(panel.title)}${badge}</h3>
                ${note}
                ${panel.controls.map(renderControl).join('')}
            </div>
        `;
        }).join('');
    }

    /** Bind a rendered schema's controls (and ℹ/↺ affordances) back to setBehavior. */
    bindControlPanels(container, prefix) {
        container.querySelectorAll(`[data-${prefix}-field]`).forEach((el) => {
            const field = el.getAttribute(`data-${prefix}-field`);
            const type = el.getAttribute(`data-${prefix}-type`);
            const special = el.getAttribute(`data-${prefix}-special`) || '';
            if (type === 'checkbox') {
                el.addEventListener('change', () => this.setBehavior(field, el.checked, special));
            } else if (type === 'number') {
                el.addEventListener('change', () => this.setBehavior(field, Number(el.value), special));
            } else {
                el.addEventListener('change', () => this.setBehavior(field, el.value, special));
            }
        });
        this.bindAffordances(container, (field) => {
            const el = container.querySelector(`[data-${prefix}-field="${CSS.escape(field)}"]`);
            const special = el?.getAttribute(`data-${prefix}-special`) || '';
            return special;
        });
    }

    /**
     * Wire the ℹ (info modal) and ↺ (reset-to-default) buttons.
     * By default a reset routes through setBehavior; pass `resetHandler` to
     * apply the default some other way (the Appearance section needs its own
     * live setters).
     */
    bindAffordances(container, specialFor, resetHandler) {
        container.querySelectorAll('[data-info-field]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openFieldInfo(btn.getAttribute('data-info-field'));
            });
        });
        container.querySelectorAll('[data-reset-field]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const field = btn.getAttribute('data-reset-field');
                const meta = this.fieldMeta(field);
                if (!meta || meta.def === undefined) return;
                if (resetHandler) {
                    resetHandler(field, meta.def);
                    return;
                }
                const special = specialFor ? specialFor(field) : '';
                void this.setBehavior(field, meta.def, special);
            });
        });
    }

    static BEHAVIOR_TABS = ['general', 'datetime', 'layout', 'display', 'search', 'status', 'privacy'];

    behaviorTabLabel(tab) {
        const map = {
            general: ['config.behaviorTabGeneral', 'General'],
            datetime: ['config.behaviorTabDateTime', 'Date & weather'],
            layout: ['config.behaviorTabLayout', 'Layout'],
            display: ['config.behaviorTabDisplay', 'Display'],
            search: ['config.behaviorTabSearch', 'Search & inbox'],
            status: ['config.behaviorTabStatus', 'Status & health'],
            privacy: ['config.behaviorTabPrivacy', 'Privacy'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    }

    renderBehavior() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tabs = DashboardConfig.BEHAVIOR_TABS.map((tab) => {
            const active = tab === this.behaviorTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" data-behavior-tab="${esc(tab)}">${esc(this.behaviorTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.behaviorIntro', 'How the dashboard behaves. Every change applies immediately and is saved.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div id="config-behavior-body">${this.renderBehaviorBody()}</div>
        `;
    }

    renderBehaviorBody() {
        const panels = this.behaviorSchema().filter((p) => (p.tab || 'general') === this.behaviorTab);
        const lead = this.behaviorTab === 'status' ? this.renderStatusModesLead() : '';
        return lead + this.renderControlPanels(panels, 'behavior');
    }

    /**
     * The settings below are per-install, but what they do depends on the
     * per-bookmark availability mode — several are inert unless a bookmark is
     * set to Monitor. Spelling the three modes out first is what makes the rest
     * of the tab readable; the wording matches the (i) explainer the bookmark
     * forms show, so the two cannot drift apart.
     */
    renderStatusModesLead() {
        const esc = (v) => this.dash.escapeHtml(v);
        const modes = [
            ['off', this.t('config.checkModeOff', 'Off'), this.t('config.checkModeOffHint', 'No availability checking.')],
            ['periodic', this.t('config.checkModePeriodic', 'Periodic'), this.t('config.checkModePeriodicHint', 'Checks once a day and flags the bookmark when it breaks.')],
            ['monitor', this.t('config.checkModeMonitor', 'Monitor'), this.t('config.checkModeMonitorHint', 'Checks on your own interval and keeps uptime history, a heartbeat and outage alerts. Includes everything Periodic does.')],
        ].map(([id, name, hint]) => `
            <li class="config-mode-row">
                <span class="config-mode-name config-mode-name--${esc(id)}">${esc(name)}</span>
                <span class="config-mode-hint">${esc(hint)}</span>
            </li>`).join('');

        return `
            <div class="config-panel config-mode-legend">
                <h3 class="config-panel-title">${esc(this.t('config.checkModeExplainTitle', 'How availability checking works'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.statusModesLead', 'Each bookmark is set to one of three modes, in its own editor or with a right-click on the dashboard. The settings on this tab decide how those checks are carried out.'))}</p>
                <ul class="config-mode-list">${modes}</ul>
                <p class="config-panel-note">${esc(this.t('config.statusModesWhere', 'Set a bookmark’s mode under Bookmarks → Edit, or right-click it on the dashboard.'))}</p>
            </div>`;
    }

    bindBehaviorControls(container) {
        container.querySelectorAll('[data-behavior-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-behavior-tab');
                if (tab === this.behaviorTab) return;
                this.behaviorTab = tab;
                const body = document.getElementById('config-behavior-body');
                if (body) {
                    body.innerHTML = this.renderBehaviorBody();
                    document.querySelectorAll('[data-behavior-tab]').forEach((b) => {
                        const on = b.getAttribute('data-behavior-tab') === this.behaviorTab;
                        b.classList.toggle('is-active', on);
                        b.setAttribute('aria-selected', on ? 'true' : 'false');
                    });
                    this.bindControlPanels(container, 'behavior');
                } else {
                    this.render();
                }
            });
        });
        this.bindControlPanels(container, 'behavior');
    }

    /** Apply a behaviour setting: mutate, run any special apply, save. */
    async setBehavior(field, value, special) {
        const d = this.dash;
        d.settings[field] = value;
        switch (special) {
            case 'language':
                await d.language?.init?.(value);
                d.renderDashboard?.({ animate: false });
                break;
            case 'datetime':
                d.renderDateWeatherLine?.();
                break;
            case 'render':
                d.renderDashboard?.({ animate: false });
                break;
            default:
                // Most display toggles are read at render time.
                d.renderDashboard?.({ animate: false });
                break;
        }
        await this.saveSettingsWithFeedback();
        // Repaint the active control panel so the ↺ reset button's visibility and
        // the control's own value reflect the change (important after a reset).
        this.repaintActiveControlPanels();
    }

    /**
     * Report the outcome of a save in the section header.
     *
     * Everything in this view saves the moment you change it, so without this
     * there is nothing at all to confirm a change stuck. A toast per keystroke
     * would be unbearable on a tab full of toggles, so the state sits in one
     * place: "Saving…" while in flight, then "Saved" which fades, or an error
     * that stays until the next attempt. `role="status"` carries it to screen
     * readers without stealing focus.
     */
    /**
     * The indicator is appended to <body> rather than to the view.
     * `#dashboard-layout` animates with a transform when a view opens, and a
     * transformed ancestor becomes the containing block for `position: fixed` —
     * which parked the indicator hundreds of pixels below the viewport for the
     * length of that animation.
     */
    ensureSaveStateHost() {
        let el = document.getElementById('config-save-state');
        if (el && el.parentElement !== document.body) {
            el.remove();
            el = null;
        }
        if (!el) {
            el = document.createElement('span');
            el.id = 'config-save-state';
            el.className = 'config-save-state';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        return el;
    }

    setSaveState(state) {
        const el = this.ensureSaveStateHost();
        if (!el) return;
        clearTimeout(this._saveStateTimer);
        el.classList.remove('is-saving', 'is-saved', 'is-error');

        if (state === 'saving') {
            el.textContent = this.t('config.saveStateSaving', 'Saving…');
            el.classList.add('is-saving');
            return;
        }
        if (state === 'saved') {
            el.textContent = this.t('config.saveStateSaved', 'Saved');
            el.classList.add('is-saved');
            // Clearing it keeps a stale "Saved" from implying the *next* change
            // was saved too.
            this._saveStateTimer = setTimeout(() => {
                if (el.isConnected && el.classList.contains('is-saved')) {
                    el.textContent = '';
                    el.classList.remove('is-saved');
                }
            }, 2500);
            return;
        }
        if (state === 'error') {
            el.textContent = this.t('config.saveStateError', 'Not saved — try again');
            el.classList.add('is-error');
            return;
        }
        el.textContent = '';
    }

    /**
     * Persist the current settings and report the outcome. Every settings write
     * in this view goes through here so the feedback cannot be forgotten at one
     * call site.
     */
    async saveSettingsWithFeedback() {
        this.setSaveState('saving');
        let ok = false;
        try {
            // saveSettings resolves false rather than rejecting; it reports its
            // own error toast as well.
            ok = (await this.dash.saveSettings?.()) !== false;
        } catch {
            ok = false;
        }
        this.setSaveState(ok ? 'saved' : 'error');
        return ok;
    }

    /** Re-render whichever schema-driven panel body is currently showing. */
    repaintActiveControlPanels() {
        if (!this.isActiveView()) return;
        const container = document.getElementById('dashboard-layout');
        if (!container) return;
        if (this.section === 'behavior') {
            const body = document.getElementById('config-behavior-body');
            if (body) { body.innerHTML = this.renderBehaviorBody(); this.bindControlPanels(container, 'behavior'); }
        } else if (this.section === 'pages-tags' && this.ptTab === 'collections') {
            const body = document.getElementById('config-pt-body');
            if (body) { body.innerHTML = this.renderCollections(); this.bindCollections(container); }
        }
    }

    /* ── Pages & tags ──────────────────────────────────────────────────────── */

    static PT_TABS = ['finders', 'tags', 'collections', 'pages', 'categories'];

    ptTabLabel(tab) {
        const map = {
            finders: ['config.findersTab', 'Finders'],
            tags: ['config.tagsTab', 'Tags'],
            collections: ['config.collectionsTab', 'Collections'],
            pages: ['config.pagesTab', 'Pages'],
            categories: ['config.categoriesTab', 'Categories'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    }

    renderPagesTags() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tabs = DashboardConfig.PT_TABS.map((tab) => {
            const active = tab === this.ptTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" data-pt-tab="${esc(tab)}">${esc(this.ptTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.pagesTagsIntro', 'Manage pages, categories, tags, finders, and smart collections.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div id="config-pt-body">${this.renderPtTab()}</div>
        `;
    }

    renderPtTab() {
        switch (this.ptTab) {
            case 'finders': return this.renderFinders();
            case 'tags': return this.renderTagsManager();
            case 'collections': return this.renderCollections();
            case 'pages': return this.renderPagesEditor();
            case 'categories': return this.renderCategoriesEditor();
            default: return '';
        }
    }

    bindPagesTags(container) {
        container.querySelectorAll('[data-pt-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-pt-tab');
                if (tab === this.ptTab) return;
                this.ptTab = tab;
                this.repaintPtBody();
            });
        });
        this.bindPtTabControls(container);
    }

    repaintPtBody() {
        const body = document.getElementById('config-pt-body');
        if (!body) { this.render(); return; }
        body.innerHTML = this.renderPtTab();
        // Re-mark the active subtab.
        document.querySelectorAll('[data-pt-tab]').forEach((b) => {
            const active = b.getAttribute('data-pt-tab') === this.ptTab;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        const container = document.getElementById('dashboard-layout');
        if (container) this.bindPtTabControls(container);
    }

    bindPtTabControls(container) {
        if (this.ptTab === 'finders') { this.bindFinders(container); void this.loadFinders(); }
        else if (this.ptTab === 'tags') { void this.loadTagsManager(); }
        else if (this.ptTab === 'collections') { this.bindCollections(container); }
        else if (this.ptTab === 'pages') { this.bindPagesEditor(container); }
        else if (this.ptTab === 'categories') { this.bindCategoriesEditor(container); void this.loadCategoriesEditor(); }
    }

    /* ── Finders (native) ──────────────────────────────────────────────────── */

    finderQueryPlaceholder() { return '%s'; }

    renderFinders() {
        const esc = (v) => this.dash.escapeHtml(v);
        if (this._finders == null) {
            return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        }
        const rows = this._finders.map((f, i) => `
            <li class="config-crud-row" data-finder-index="${i}">
                <div class="config-crud-fields">
                    <input type="text" class="config-text" data-finder="name" data-index="${i}" placeholder="${esc(this.t('config.finderNamePlaceholder', 'Name'))}" value="${esc(f.name || '')}">
                    <input type="text" class="config-text" data-finder="searchUrl" data-index="${i}" placeholder="https://example.com/search?q=%s" value="${esc(f.searchUrl || '')}">
                    <input type="text" class="config-text" style="min-width:70px" data-finder="shortcut" data-index="${i}" placeholder="${esc(this.t('config.finderShortcutPlaceholder', 'key'))}" value="${esc(f.shortcut || '')}">
                </div>
                <button type="button" class="config-btn config-btn--small config-btn--danger" data-finder-delete="${i}">${esc(this.t('config.backupDelete', 'Delete'))}</button>
            </li>
        `).join('');
        return `
            <p class="config-panel-note">${esc(this.t('config.findersIntro', 'Finders are search shortcuts. Use %s in the URL where the query goes.'))}</p>
            <ul class="config-crud-list">${rows || `<li class="config-panel-empty">${esc(this.t('config.findersEmpty', 'No finders yet.'))}</li>`}</ul>
            <div class="config-actions">
                <button type="button" class="config-btn" data-finder-add>${esc(this.t('config.finderAdd', 'Add finder'))}</button>
            </div>
        `;
    }

    async loadFinders() {
        if (this._finders != null) return;
        try {
            const res = await fetch('/api/finders');
            const data = res && res.ok ? await res.json() : [];
            this._finders = Array.isArray(data) ? data : [];
        } catch {
            this._finders = [];
        }
        if (this.ptTab === 'finders') this.repaintPtBody();
    }

    bindFinders(container) {
        container.querySelectorAll('[data-finder]').forEach((input) => {
            input.addEventListener('change', () => {
                const i = Number(input.getAttribute('data-index'));
                const key = input.getAttribute('data-finder');
                if (this._finders && this._finders[i]) {
                    this._finders[i][key] = input.value;
                    void this.saveFinders();
                }
            });
        });
        const addBtn = container.querySelector('[data-finder-add]');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this._finders = this._finders || [];
                this._finders.push({ name: '', searchUrl: '', shortcut: '' });
                this.repaintPtBody();
                void this.saveFinders();
            });
        }
        container.querySelectorAll('[data-finder-delete]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = Number(btn.getAttribute('data-finder-delete'));
                if (this._finders && this._finders[i]) {
                    this._finders.splice(i, 1);
                    this.repaintPtBody();
                    void this.saveFinders();
                }
            });
        });
    }

    async saveFinders() {
        try {
            const res = await this.writeFetch('/api/finders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this._finders || []),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch {
            this.notify(this.t('config.findersSaveError', 'Could not save finders.'), 'error');
        }
    }

    /* ── List statistics (count badge + popularity bar) ────────────────────── */

    /**
     * 0–1 scale with boosted contrast, mirroring the classic config's tag cloud
     * so the same list reads identically in both surfaces.
     */
    static scaleForCount(count, minCount, maxCount) {
        if (maxCount <= 0) return 0.5;
        if (maxCount === minCount) return 1;
        const ratio = (count - minCount) / (maxCount - minCount);
        const spread = maxCount / Math.max(1, minCount);
        const power = spread > 8 ? 0.5 : 0.68;
        const floor = spread > 8 ? 0.08 : spread > 3 ? 0.16 : 0.24;
        return floor + (1 - floor) * Math.pow(Math.max(0, Math.min(1, ratio)), power);
    }

    static tierClassForScale(scale) {
        if (scale >= 0.82) return 'config-stat--tier-xl';
        if (scale >= 0.62) return 'config-stat--tier-lg';
        if (scale >= 0.42) return 'config-stat--tier-md';
        if (scale >= 0.22) return 'config-stat--tier-sm';
        return 'config-stat--tier-xs';
    }

    /** Pre-compute the scale for a list of counts so bars share one baseline. */
    static statScales(counts) {
        const max = counts.length ? Math.max(...counts) : 0;
        const min = counts.length ? Math.min(...counts) : max;
        return counts.map((c) => DashboardConfig.scaleForCount(c, min, max));
    }

    /** Count badge + popularity bar markup, matching the classic config layout. */
    renderStatMeta(count, scale, labelKey, labelFallback) {
        const esc = (v) => this.dash.escapeHtml(v);
        const label = this.t(labelKey, labelFallback).replace('{count}', String(count));
        const fill = Math.round(Math.max(0, Math.min(1, scale)) * 100);
        return `<div class="config-stat-meta ${DashboardConfig.tierClassForScale(scale)}">
            <div class="config-stat-bar" aria-hidden="true"><span class="config-stat-bar-fill" style="width:${fill}%"></span></div>
            <span class="config-tag-count" title="${esc(label)}">${esc(label)}</span>
        </div>`;
    }

    /** A row of totals above a list, e.g. "12 tags · 48 assignments". */
    renderStatSummary(pairs) {
        const esc = (v) => this.dash.escapeHtml(v);
        const items = pairs.map(([value, label]) =>
            `<span class="config-stat-summary-item"><strong>${esc(String(value))}</strong> ${esc(label)}</span>`
        ).join('');
        return `<p class="config-stat-summary">${items}</p>`;
    }

    /** Bookmarks per page id, from the dashboard's full bookmark set. */
    pageBookmarkCounts() {
        const counts = new Map();
        (this.dash.allBookmarks || []).forEach((b) => {
            const id = String(b.pageId);
            counts.set(id, (counts.get(id) || 0) + 1);
        });
        return counts;
    }

    /** Bookmarks per category name, limited to one page. */
    categoryBookmarkCounts(pageId) {
        const counts = new Map();
        (this.dash.allBookmarks || []).forEach((b) => {
            if (String(b.pageId) !== String(pageId)) return;
            const name = String(b.category || '');
            if (!name) return;
            counts.set(name, (counts.get(name) || 0) + 1);
        });
        return counts;
    }

    /* ── Tags & collections placeholders (native, built next) ──────────────── */

    renderTagsManager() {
        const esc = (v) => this.dash.escapeHtml(v);
        if (this._tagList == null) {
            return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        }
        if (this._tagList.length === 0) {
            return `<p class="config-panel-empty">${esc(this.t('config.tagsEmpty', 'No tags yet. Add tags to bookmarks to manage them here.'))}</p>`;
        }
        const scales = DashboardConfig.statScales(this._tagList.map((t) => t.count));
        const rows = this._tagList.map(({ tag, count }, i) => `
            <li class="config-crud-row" data-tag-row="${esc(tag)}">
                <div class="config-crud-fields">
                    <input type="text" class="config-text" data-tag-rename="${esc(tag)}" value="${esc(tag)}">
                    ${this.renderStatMeta(count, scales[i], 'config.tagBookmarkCount', '{count} bookmarks')}
                </div>
                <button type="button" class="config-btn config-btn--small config-btn--danger" data-tag-delete="${esc(tag)}">${esc(this.t('config.backupDelete', 'Delete'))}</button>
            </li>
        `).join('');
        return `
            <p class="config-panel-note">${esc(this.t('config.tagsIntro', 'Rename a tag to update it everywhere, or delete it from all bookmarks.'))}</p>
            ${this.renderStatSummary([
                [this._tagList.length, this.t('config.tagsStatTotal', 'tags')],
                [this._tagList.reduce((sum, t) => sum + t.count, 0), this.t('config.tagsStatAssignments', 'assignments')],
            ])}
            <ul class="config-crud-list">${rows}</ul>
        `;
    }

    async loadTagsManager() {
        if (this._tagList != null && this._tagList._loaded) return;
        try {
            const res = await fetch('/api/bookmarks?all=true');
            const bookmarks = res && res.ok ? await res.json() : [];
            const counts = new Map();
            (Array.isArray(bookmarks) ? bookmarks : []).forEach((bm) => {
                (Array.isArray(bm.tags) ? bm.tags : []).forEach((raw) => {
                    const tag = String(raw || '').trim();
                    if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
                });
            });
            this._tagList = [...counts.entries()]
                .map(([tag, count]) => ({ tag, count }))
                .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
            this._tagList._loaded = true;
        } catch {
            this._tagList = [];
            this._tagList._loaded = true;
        }
        if (this.ptTab === 'tags') {
            this.repaintPtBody();
            this.bindTags(document.getElementById('dashboard-layout'));
        }
    }

    bindTags(container) {
        if (!container) return;
        container.querySelectorAll('[data-tag-rename]').forEach((input) => {
            input.addEventListener('change', () => {
                const from = input.getAttribute('data-tag-rename');
                const to = input.value.trim();
                if (to && to !== from) void this.rewriteTag(from, to);
            });
        });
        container.querySelectorAll('[data-tag-delete]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tag = btn.getAttribute('data-tag-delete');
                if (window.confirm(this.t('config.tagDeleteConfirm', 'Delete this tag from all bookmarks?'))) {
                    void this.rewriteTag(tag, null);
                }
            });
        });
    }

    /** Rename (to != null) or delete (to == null) a tag across every bookmark. */
    async rewriteTag(from, to) {
        try {
            const res = await fetch('/api/bookmarks?all=true');
            const bookmarks = res && res.ok ? await res.json() : [];
            const list = Array.isArray(bookmarks) ? bookmarks : [];
            let changed = false;
            list.forEach((bm) => {
                if (!Array.isArray(bm.tags)) return;
                const idx = bm.tags.indexOf(from);
                if (idx === -1) return;
                bm.tags.splice(idx, 1);
                if (to && !bm.tags.includes(to)) bm.tags.push(to);
                changed = true;
            });
            if (!changed) return;
            // Group by page and re-save each page's bookmarks.
            const pages = new Map();
            list.forEach((bm) => {
                if (!pages.has(bm.pageId)) pages.set(bm.pageId, []);
                pages.get(bm.pageId).push(bm);
            });
            for (const [pageId, pageBookmarks] of pages.entries()) {
                const saveRes = await this.writeFetch(`/api/bookmarks?page=${encodeURIComponent(pageId)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pageBookmarks),
                });
                if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`);
            }
            this.notify(to
                ? this.t('config.tagRenamed', 'Tag renamed.')
                : this.t('config.tagDeleted', 'Tag deleted.'), 'success');
            this._tagList = null;
            await this.loadTagsManager();
            this.dash.buildSearchIndex?.();
            this.dash.renderDashboard?.({ animate: false });
        } catch {
            this.notify(this.t('config.tagsSaveError', 'Could not update the tag.'), 'error');
        }
    }

    collectionsSchema() {
        const t = (k, f) => this.t(k, f);
        const bool = (field, label, fallback) => ({ field, type: 'checkbox', label: t(label, fallback) });
        const limitOpts = [5, 10, 15, 20, 30].map((n) => ({ value: n, label: String(n) }));
        return [
            {
                title: t('config.smartCollectionsTitle', 'Smart collections'),
                controls: [
                    bool('showSmartTodayCollection', 'config.showSmartTodayCollection', 'Show “Today” collection'),
                    { field: 'smartTodayLimit', type: 'select', label: t('config.smartTodayLimit', 'Today limit'), special: 'render', options: limitOpts },
                    bool('showSmartRecentCollection', 'config.showSmartRecentCollection', 'Show “Recent” collection'),
                    { field: 'smartRecentLimit', type: 'select', label: t('config.smartRecentLimit', 'Recent limit'), special: 'render', options: limitOpts },
                    bool('showSmartStaleCollection', 'config.showSmartStaleCollection', 'Show “Stale” collection'),
                    { field: 'smartStaleLimit', type: 'select', label: t('config.smartStaleLimit', 'Stale limit'), special: 'render', options: limitOpts },
                    bool('showSmartMostUsedCollection', 'config.showSmartMostUsedCollection', 'Show “Most used” collection'),
                    { field: 'smartMostUsedLimit', type: 'select', label: t('config.smartMostUsedLimit', 'Most-used limit'), special: 'render', options: limitOpts },
                ],
            },
            {
                title: t('config.tagCollectionsTitle', 'Tag collections'),
                controls: [
                    bool('showTagCollections', 'config.showTagCollections', 'Show tag collections'),
                    { field: 'tagCollectionsMinCount', type: 'number', label: t('config.tagCollectionsMinCount', 'Minimum tag count'), min: 1, max: 50, special: 'render' },
                ],
            },
            {
                title: t('config.smartTodayKeywordsTitle', '“Today” keywords'),
                controls: [
                    { field: 'smartTodayWorkKeywords', type: 'text', label: t('config.smartTodayWorkKeywords', 'Work'), special: 'render' },
                    { field: 'smartTodayEveningKeywords', type: 'text', label: t('config.smartTodayEveningKeywords', 'Evening'), special: 'render' },
                    { field: 'smartTodayWeekendKeywords', type: 'text', label: t('config.smartTodayWeekendKeywords', 'Weekend'), special: 'render' },
                ],
            },
        ];
    }

    renderCollections() {
        // Reuse the behaviour control renderer against the collections schema.
        return this.renderCollectionStats()
            + this.renderControlPanels(this.collectionsSchema(), 'collection')
            + this.renderCollectionScopes();
    }

    /**
     * How many bookmarks each collection currently yields. Built from the same
     * evaluator the dashboard renders with, so the numbers match what's on screen.
     */
    renderCollectionStats() {
        const esc = (v) => this.dash.escapeHtml(v);
        let collections = [];
        try {
            collections = this.dash.getSmartCollections?.(this.dash.allBookmarks || []) || [];
        } catch {
            collections = [];
        }
        if (!collections.length) {
            return `<div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.collectionStatsTitle', 'Collection sizes'))}</h3>
                <p class="config-panel-empty">${esc(this.t('config.collectionStatsEmpty', 'No collections are active right now.'))}</p>
            </div>`;
        }
        const counts = collections.map((c) => (c.bookmarks || []).length);
        const scales = DashboardConfig.statScales(counts);
        const rows = collections.map((c, i) => `
            <li class="config-crud-row">
                <div class="config-crud-fields">
                    <span class="config-stat-name">${esc(c.name || '')}</span>
                    ${this.renderStatMeta(counts[i], scales[i], 'config.collectionBookmarkCount', '{count} bookmarks')}
                </div>
            </li>`).join('');
        return `<div class="config-panel">
            <h3 class="config-panel-title">${esc(this.t('config.collectionStatsTitle', 'Collection sizes'))}</h3>
            ${this.renderStatSummary([
                [collections.length, this.t('config.collectionsStatTotal', 'active collections')],
                [counts.reduce((sum, n) => sum + n, 0), this.t('config.collectionsStatBookmarks', 'bookmarks shown')],
            ])}
            <ul class="config-crud-list">${rows}</ul>
        </div>`;
    }

    /**
     * Which pages each smart collection draws from. Stored as an array of page
     * ids per collection (empty = every page), so this needs a checkbox per page
     * rather than the generic single-value controls the schema renderer covers.
     */
    static COLLECTION_SCOPES = [
        ['smartTodayPageIds', 'config.smartTodayScope', '“Today” pages'],
        ['smartRecentPageIds', 'config.smartRecentScope', '“Recent” pages'],
        ['smartStalePageIds', 'config.smartStaleScope', '“Stale” pages'],
        ['smartMostUsedPageIds', 'config.smartMostUsedScope', '“Most used” pages'],
    ];

    renderCollectionScopes() {
        const esc = (v) => this.dash.escapeHtml(v);
        const pages = this.dash.pages || [];
        if (!pages.length) return '';
        const s = this.dash.settings || {};
        const rows = DashboardConfig.COLLECTION_SCOPES.map(([field, key, fallback]) => {
            const selected = Array.isArray(s[field]) ? s[field].map(String) : [];
            const boxes = pages.map((p) => {
                const id = String(p.id);
                const on = selected.includes(id);
                return `<label class="config-scope-page">
                    <input type="checkbox" data-scope-field="${esc(field)}" data-scope-page="${esc(id)}" ${on ? 'checked' : ''}>
                    <span>${esc(p.name || id)}</span>
                </label>`;
            }).join('');
            const allHint = selected.length === 0
                ? this.t('config.collectionScopeAll', 'All pages')
                : this.t('config.collectionScopeSome', 'Selected pages only');
            return `
                <div class="config-field-block">
                    <span class="config-field-label">${esc(this.t(key, fallback))}</span>
                    <p class="config-field-hint">${esc(allHint)}</p>
                    <div class="config-scope-pages">${boxes}</div>
                </div>`;
        }).join('');
        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.collectionScopesTitle', 'Collection scope'))}</h3>
                <p class="config-field-hint">${esc(this.t('config.collectionScopesHint', 'Leave a collection with no pages ticked to draw from every page.'))}</p>
                ${rows}
            </div>`;
    }

    bindCollections(container) {
        this.bindControlPanels(container, 'collection');
        container.querySelectorAll('[data-scope-field]').forEach((box) => {
            box.addEventListener('change', () => {
                const field = box.getAttribute('data-scope-field');
                const pageId = box.getAttribute('data-scope-page');
                const current = Array.isArray(this.dash.settings[field])
                    ? this.dash.settings[field].map(String)
                    : [];
                const next = box.checked
                    ? [...new Set([...current, pageId])]
                    : current.filter((id) => id !== pageId);
                void this.setBehavior(field, next, 'render');
            });
        });
    }

    /* ── Pages (native) ────────────────────────────────────────────────────── */

    renderPagesEditor() {
        const esc = (v) => this.dash.escapeHtml(v);
        const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
        const counts = this.pageBookmarkCounts();
        const pageCounts = pages.map((p) => counts.get(String(p.id)) || 0);
        const scales = DashboardConfig.statScales(pageCounts);
        const rows = pages.map((p, i) => {
            const isFirst = Number(p.id) === 1;
            return `
            <li class="config-crud-row" data-page-row="${esc(p.id)}">
                <div class="config-crud-fields">
                    <input type="text" class="config-text" style="min-width:56px;max-width:64px" data-page="icon" data-id="${esc(p.id)}" placeholder="📄" value="${esc(p.icon || '')}">
                    <input type="text" class="config-text" data-page="name" data-id="${esc(p.id)}" placeholder="${esc(this.t('config.pageNamePlaceholder', 'Page name'))}" value="${esc(p.name || '')}">
                    <input type="color" class="config-color" data-page="color" data-id="${esc(p.id)}" value="${esc(p.color || '#888888')}" title="${esc(this.t('config.pageColorLabel', 'Tab colour'))}">
                    ${this.renderStatMeta(pageCounts[i], scales[i], 'config.pageBookmarkCount', '{count} bookmarks')}
                </div>
                <div class="config-crud-row-actions">
                    <button type="button" class="config-btn config-btn--small" data-page-move="up" data-id="${esc(p.id)}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(this.t('config.moveUp', 'Move up'))}">↑</button>
                    <button type="button" class="config-btn config-btn--small" data-page-move="down" data-id="${esc(p.id)}" ${i === pages.length - 1 ? 'disabled' : ''} aria-label="${esc(this.t('config.moveDown', 'Move down'))}">↓</button>
                    <button type="button" class="config-btn config-btn--small config-btn--danger" data-page-delete="${esc(p.id)}" ${isFirst ? 'disabled title="' + esc(this.t('config.pageDeleteFirstBlocked', 'The first page cannot be deleted')) + '"' : ''}>${esc(this.t('config.backupDelete', 'Delete'))}</button>
                </div>
            </li>`;
        }).join('');
        return `
            <p class="config-panel-note">${esc(this.t('config.pagesIntroView', 'Rename, recolour, reorder (↑ ↓), add, or remove dashboard pages. The first page cannot be removed.'))}</p>
            ${this.renderStatSummary([
                [pages.length, this.t('config.pagesStatTotal', 'pages')],
                [pageCounts.reduce((sum, n) => sum + n, 0), this.t('config.pagesStatBookmarks', 'bookmarks')],
            ])}
            <ul class="config-crud-list">${rows}</ul>
            <div class="config-actions">
                <button type="button" class="config-btn" data-page-add>${esc(this.t('config.pageAdd', 'Add page'))}</button>
            </div>
        `;
    }

    bindPagesEditor(container) {
        container.querySelectorAll('[data-page]').forEach((input) => {
            input.addEventListener('change', () => {
                const id = Number(input.getAttribute('data-id'));
                const key = input.getAttribute('data-page');
                const page = (this.dash.pages || []).find((p) => Number(p.id) === id);
                if (page) { page[key] = input.value; void this.savePages(); }
            });
        });
        const addBtn = container.querySelector('[data-page-add]');
        if (addBtn) addBtn.addEventListener('click', () => void this.addPage());
        container.querySelectorAll('[data-page-delete]').forEach((btn) => {
            btn.addEventListener('click', () => void this.deletePage(Number(btn.getAttribute('data-page-delete'))));
        });
        container.querySelectorAll('[data-page-move]').forEach((btn) => {
            btn.addEventListener('click', () => this.movePage(Number(btn.getAttribute('data-id')), btn.getAttribute('data-page-move')));
        });
    }

    async savePages() {
        try {
            const res = await this.writeFetch('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.dash.pages || []),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.dash.pageNav?.renderPageNavigation?.();
        } catch {
            this.notify(this.t('config.pagesSaveError', 'Could not save pages.'), 'error');
        }
    }

    async addPage() {
        const pages = this.dash.pages || [];
        const maxId = pages.length ? Math.max(...pages.map((p) => Number(p.id) || 0)) : 0;
        const newPage = { id: maxId + 1, name: `${this.t('config.pagePrefix', 'Page')} ${maxId + 1}` };
        pages.push(newPage);
        await this.savePages();
        this.repaintPtBody();
    }

    async deletePage(id) {
        if (Number(id) === 1) return;
        if (!window.confirm(this.t('config.pageDeleteConfirm', 'Delete this page and its bookmarks?'))) return;
        try {
            const res = await this.writeFetch(`/api/pages/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.dash.pages = (this.dash.pages || []).filter((p) => Number(p.id) !== Number(id));
            this.dash.pageNav?.renderPageNavigation?.();
            this.notify(this.t('config.pageDeleted', 'Page deleted.'), 'success');
            this.repaintPtBody();
        } catch {
            this.notify(this.t('config.pagesSaveError', 'Could not delete the page.'), 'error');
        }
    }

    movePage(id, dir) {
        const pages = this.dash.pages || [];
        const idx = pages.findIndex((p) => Number(p.id) === Number(id));
        if (idx < 0) return;
        const swap = dir === 'up' ? idx - 1 : idx + 1;
        if (swap < 0 || swap >= pages.length) return;
        [pages[idx], pages[swap]] = [pages[swap], pages[idx]];
        void this.savePages();
        this.repaintPtBody();
    }

    /* ── Categories (native, per page) ─────────────────────────────────────── */

    renderCategoriesEditor() {
        const esc = (v) => this.dash.escapeHtml(v);
        const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
        const pageId = this._catPageId != null ? this._catPageId : (this.dash.currentPageId ?? pages[0]?.id);
        const pageOptions = pages.map((p) =>
            `<option value="${esc(p.id)}" ${Number(p.id) === Number(pageId) ? 'selected' : ''}>${esc(p.name || p.id)}</option>`
        ).join('');
        let body;
        if (this._categories == null) {
            body = `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        } else if (this._categories.length === 0) {
            body = `<p class="config-panel-empty">${esc(this.t('config.categoriesEmpty', 'No categories on this page yet.'))}</p>`;
        } else {
            const counts = this.categoryBookmarkCounts(pageId);
            const catCounts = this._categories.map((c) => counts.get(String(c.name || '')) || 0);
            const scales = DashboardConfig.statScales(catCounts);
            const rows = this._categories.map((c, i) => `
                <li class="config-crud-row" data-cat-row="${i}">
                    <div class="config-crud-fields">
                        <input type="text" class="config-text" data-cat="name" data-index="${i}" value="${esc(c.name || '')}">
                        ${this.renderStatMeta(catCounts[i], scales[i], 'config.categoryBookmarkCount', '{count} bookmarks')}
                    </div>
                    <div class="config-crud-row-actions">
                        <button type="button" class="config-btn config-btn--small" data-cat-move="up" data-index="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
                        <button type="button" class="config-btn config-btn--small" data-cat-move="down" data-index="${i}" ${i === this._categories.length - 1 ? 'disabled' : ''}>↓</button>
                        <button type="button" class="config-btn config-btn--small config-btn--danger" data-cat-delete="${i}">${esc(this.t('config.backupDelete', 'Delete'))}</button>
                    </div>
                </li>`).join('');
            const summary = this.renderStatSummary([
                [this._categories.length, this.t('config.categoriesStatTotal', 'categories')],
                [catCounts.reduce((sum, n) => sum + n, 0), this.t('config.categoriesStatBookmarks', 'bookmarks on this page')],
            ]);
            body = `${summary}<ul class="config-crud-list">${rows}</ul>`;
        }
        return `
            <p class="config-panel-note">${esc(this.t('config.categoriesIntroView', 'Categories group bookmarks within a page. Pick a page, then rename, reorder (↑ ↓), add, or remove its categories.'))}</p>
            <div class="config-field">
                <span class="config-field-label">${esc(this.t('config.categoriesPageLabel', 'Page'))}</span>
                <select class="config-select" data-cat-page>${pageOptions}</select>
            </div>
            ${body}
            <div class="config-actions">
                <button type="button" class="config-btn" data-cat-add>${esc(this.t('config.categoryAdd', 'Add category'))}</button>
            </div>
        `;
    }

    async loadCategoriesEditor() {
        const pages = this.dash.pages || [];
        const pageId = this._catPageId != null ? this._catPageId : (this.dash.currentPageId ?? pages[0]?.id);
        this._catPageId = pageId;
        // Already loaded for this page — don't refetch/repaint and detach controls.
        if (this._categories != null && this._catLoadedFor === pageId) return;
        try {
            const res = await fetch(`/api/categories?page=${encodeURIComponent(pageId)}`);
            const data = res && res.ok ? await res.json() : [];
            this._categories = Array.isArray(data) ? data : [];
        } catch {
            this._categories = [];
        }
        this._catLoadedFor = pageId;
        if (this.ptTab === 'categories') this.repaintPtBody();
    }

    bindCategoriesEditor(container) {
        const pageSelect = container.querySelector('[data-cat-page]');
        if (pageSelect) {
            pageSelect.addEventListener('change', () => {
                this._catPageId = Number(pageSelect.value);
                this._categories = null;
                this.repaintPtBody();
                void this.loadCategoriesEditor();
            });
        }
        container.querySelectorAll('[data-cat="name"]').forEach((input) => {
            input.addEventListener('change', () => {
                const i = Number(input.getAttribute('data-index'));
                if (this._categories && this._categories[i]) {
                    this._categories[i].name = input.value;
                    void this.saveCategories();
                }
            });
        });
        const addBtn = container.querySelector('[data-cat-add]');
        if (addBtn) addBtn.addEventListener('click', () => {
            this._categories = this._categories || [];
            // Categories need a stable id; the server does not backfill one.
            const id = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            this._categories.push({ id, name: this.t('config.categoryNewName', 'New category') });
            this.repaintPtBody();
            void this.saveCategories();
        });
        container.querySelectorAll('[data-cat-delete]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = Number(btn.getAttribute('data-cat-delete'));
                if (this._categories && this._categories[i]) {
                    this._categories.splice(i, 1);
                    this.repaintPtBody();
                    void this.saveCategories();
                }
            });
        });
        container.querySelectorAll('[data-cat-move]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = Number(btn.getAttribute('data-index'));
                const dir = btn.getAttribute('data-cat-move');
                const swap = dir === 'up' ? i - 1 : i + 1;
                if (!this._categories || swap < 0 || swap >= this._categories.length) return;
                [this._categories[i], this._categories[swap]] = [this._categories[swap], this._categories[i]];
                this.repaintPtBody();
                void this.saveCategories();
            });
        });
    }

    async saveCategories() {
        try {
            const res = await this.writeFetch(`/api/categories?page=${encodeURIComponent(this._catPageId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this._categories || []),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.dash.renderDashboard?.({ animate: false });
        } catch {
            this.notify(this.t('config.categoriesSaveError', 'Could not save categories.'), 'error');
        }
    }

    /* ── Bookmarks (native) ────────────────────────────────────────────────── */

    /**
     * A searchable, sortable list of every bookmark with the full editor from
     * the old config inline. The old page used a master/detail split; here the
     * row expands in place, which keeps the list as the anchor and avoids a
     * second scroll region.
     */
    renderBookmarksSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        const pages = this.dash.pages || [];
        const pageOptions = [`<option value="">${esc(this.t('config.allPages', 'All pages'))}</option>`]
            .concat(pages.map((p) => {
                const sel = String(this.bmPageFilter || '') === String(p.id) ? ' selected' : '';
                return `<option value="${esc(p.id)}"${sel}>${esc(p.name || p.id)}</option>`;
            })).join('');

        const catOptions = [`<option value="">${esc(this.t('config.allCategories', 'All categories'))}</option>`]
            .concat(this.knownCategories().map((c) => {
                const sel = this.bmCategoryFilter === c.id ? ' selected' : '';
                return `<option value="${esc(c.id)}"${sel}>${esc(c.label)}</option>`;
            })).join('');

        const sortOptions = [
            ['page', this.t('config.sortByPage', 'Page order')],
            ['name', this.t('config.sortByName', 'Name (A–Z)')],
            ['url', this.t('config.sortByUrl', 'URL')],
            ['category', this.t('config.sortByCategory', 'Category')],
            ['recent', this.t('config.sortByRecent', 'Recently added')],
        ].map(([v, label]) =>
            `<option value="${esc(v)}" ${this.bmSort === v ? 'selected' : ''}>${esc(label)}</option>`
        ).join('');

        return `
            <p class="config-view-intro">${esc(this.t('config.bookmarksIntro', 'Every bookmark across your pages. Search, edit, or remove them here.'))}</p>
            <div class="config-panel">
                <div class="config-crud-toolbar">
                    <input type="search" class="config-text" id="config-bm-search" placeholder="${esc(this.t('config.searchBookmarks', 'Search bookmarks…'))}" value="${esc(this.bmQuery || '')}">
                    <select class="config-select" id="config-bm-page" aria-label="${esc(this.t('config.page', 'Page'))}">${pageOptions}</select>
                    <select class="config-select" id="config-bm-category" aria-label="${esc(this.t('config.category', 'Category'))}">${catOptions}</select>
                    <select class="config-select" id="config-bm-sort" aria-label="${esc(this.t('config.sortLabel', 'Sort'))}">${sortOptions}</select>
                </div>
                <div id="config-bm-bulk">${this.renderBulkToolbar()}</div>
                <div id="config-bm-list">${this.renderBookmarksList()}</div>
            </div>
        `;
    }

    /** Every category name in use, across all pages, de-duplicated and sorted. */
    /**
     * The categories to offer, as {id, label} pairs.
     *
     * A bookmark stores its category by *id* ("development") while the category
     * list carries a display *name* ("Development"). Keying on the id is what
     * keeps those from being counted as two different categories — collecting
     * both into one set listed everything twice.
     *
     * The page's own category list wins on labels; anything a bookmark refers to
     * that is not in that list is still offered, so an orphaned category never
     * silently disappears from the dropdown.
     */
    knownCategories() {
        const byId = new Map();
        (this.dash.categories || []).forEach((c) => {
            if (typeof c === 'string') {
                if (c) byId.set(c, c);
                return;
            }
            const id = c?.id || c?.name;
            if (id) byId.set(String(id), String(c?.name || id));
        });
        (this.dash.allBookmarks || []).forEach((b) => {
            const id = b.category;
            if (id && !byId.has(String(id))) byId.set(String(id), String(id));
        });
        return [...byId.entries()]
            .map(([id, label]) => ({ id, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    /** The rows currently passing search, page filter, category filter and sort. */
    visibleBookmarks() {
        const all = this.dash.allBookmarks || [];
        const q = String(this.bmQuery || '').trim().toLowerCase();
        const pageFilter = String(this.bmPageFilter || '');
        const catFilter = this.bmCategoryFilter || '';
        const rows = all.filter((b) => {
            if (pageFilter && String(b.pageId) !== pageFilter) return false;
            if (catFilter && (b.category || '') !== catFilter) return false;
            if (!q) return true;
            return [b.name, b.url, b.category, b.note, (b.tags || []).join(' ')]
                .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
        });
        const pageIndex = (id) => (this.dash.pages || []).findIndex((p) => String(p.id) === String(id));
        const cmp = {
            name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
            url: (a, b) => String(a.url || '').localeCompare(String(b.url || '')),
            category: (a, b) => String(a.category || '').localeCompare(String(b.category || '')),
            recent: (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0),
            page: (a, b) => pageIndex(a.pageId) - pageIndex(b.pageId),
        }[this.bmSort] || null;
        return cmp ? [...rows].sort(cmp) : rows;
    }

    static bookmarkKey(b) {
        return `${b.pageId}::${b.url}`;
    }

    /** The bulk-action bar, shown only once rows are ticked. */
    renderBulkToolbar() {
        const esc = (v) => this.dash.escapeHtml(v);
        const n = this.bmSelected.size;
        if (n === 0) return '';
        const pages = this.dash.pages || [];
        const pageOpts = [`<option value="">${esc(this.t('config.bulkMovePagePlaceholder', 'Move to page…'))}</option>`]
            .concat(pages.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`)).join('');
        const catOpts = [`<option value="">${esc(this.t('config.bulkMoveCategoryPlaceholder', 'Set category…'))}</option>`]
            .concat(this.knownCategories().map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`)).join('');
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
                <span class="config-bulk-count">${esc(this.t('config.bulkSelectedCount', '{n} selected').replace('{n}', String(n)))}</span>
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
                    <button type="button" class="config-btn config-btn--small config-btn--danger" data-bulk="delete">${esc(this.t('config.bulkDelete', 'Delete'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="clear">${esc(this.t('config.bulkClearSelection', 'Clear selection'))}</button>
                </div>
            </div>`;
    }

    /** The rows themselves, re-rendered on every search/filter/edit change. */
    renderBookmarksList() {
        const esc = (v) => this.dash.escapeHtml(v);
        if (!(this.dash.allBookmarks || []).length) {
            return `<p class="config-panel-empty">${esc(this.t('config.noBookmarksYet', 'No bookmarks yet.'))}</p>`;
        }
        const rows = this.visibleBookmarks();
        if (!rows.length) {
            return `<p class="config-panel-empty">${esc(this.t('config.noBookmarksMatch', 'No bookmarks match your search.'))}</p>`;
        }
        const pageName = (id) => (this.dash.pages || []).find((p) => String(p.id) === String(id))?.name || id;
        // Rows show the category's display name; the bookmark stores its id.
        const catLabels = new Map(this.knownCategories().map((c) => [c.id, c.label]));
        const catName = (id) => catLabels.get(String(id)) || id;
        const modeLabel = (b) => {
            const mode = window.CheckMode?.of?.(b) || 'off';
            const found = (window.CheckMode?.options?.() || []).find((o) => o.mode === mode);
            return mode === 'off' ? '' : (found?.label || mode);
        };
        const items = rows.map((b) => {
            const key = DashboardConfig.bookmarkKey(b);
            const open = this.bmEditing === key;
            const ticked = this.bmSelected.has(key);
            const bits = [esc(pageName(b.pageId))];
            if (b.category) bits.push(esc(catName(b.category)));
            if ((b.tags || []).length) bits.push(esc((b.tags || []).join(', ')));
            const mode = modeLabel(b);
            if (mode) bits.push(esc(mode));
            if (b.pinned) bits.push(esc(this.t('config.pinnedShort', 'Pinned')));
            if (b.shortcut) bits.push(esc(b.shortcut));
            return `
                <li class="config-crud-row config-bm-row${open ? ' is-open' : ''}">
                    <input type="checkbox" class="config-bm-tick" data-bm-tick="${esc(key)}" ${ticked ? 'checked' : ''}
                           aria-label="${esc(this.t('config.selectBookmark', 'Select bookmark'))}">
                    <div class="config-bm-main">
                        <span class="config-bm-name">${esc(b.name || b.url)}</span>
                        <span class="config-bm-url">${esc(b.url)}</span>
                        <span class="config-bm-meta">${bits.join(' · ')}</span>
                    </div>
                    <div class="config-crud-row-actions">
                        <button type="button" class="config-btn config-btn--small" data-bm-edit="${esc(key)}">${esc(open ? this.t('config.close', 'Close') : this.t('config.edit', 'Edit'))}</button>
                        <button type="button" class="config-btn config-btn--small config-btn--danger" data-bm-delete="${esc(key)}">${esc(this.t('config.delete', 'Delete'))}</button>
                    </div>
                    ${open ? this.renderBookmarkEditor(b) : ''}
                </li>`;
        }).join('');
        return `<ul class="config-crud-list">${items}</ul>`;
    }

    /**
     * The full inline editor, carrying every field the old config's detail panel
     * had. Laid out as a two-column grid: name and URL span both columns because
     * they are the long values, the rest pairs up to keep the form short enough
     * that Save stays near what you were typing. Save/Revert appear above *and*
     * below, so neither end of a long form has to be scrolled to.
     */
    renderBookmarkEditor(b) {
        const esc = (v) => this.dash.escapeHtml(v);
        const pages = this.dash.pages || [];
        const pageOpts = pages.map((p) =>
            `<option value="${esc(p.id)}" ${String(p.id) === String(b.pageId) ? 'selected' : ''}>${esc(p.name || p.id)}</option>`
        ).join('');
        const cats = this.knownCategories();
        const catOpts = [`<option value="">${esc(this.t('config.noCategory', 'No category'))}</option>`]
            .concat(cats.map((c) =>
                `<option value="${esc(c.id)}" ${c.id === (b.category || '') ? 'selected' : ''}>${esc(c.label)}</option>`))
            .concat([`<option value="__new__">${esc(this.t('config.addNewCategoryOption', '➕ New category…'))}</option>`])
            .join('');

        const mode = window.CheckMode?.of?.(b) || 'off';
        const modeRadios = (window.CheckMode?.options?.() || []).map((o) => {
            const id = `config-bm-mode-${o.mode}`;
            return `<input type="radio" name="config-bm-mode" id="${id}" value="${esc(o.mode)}" class="bookmark-detail-checkmode-input" ${o.mode === mode ? 'checked' : ''}>`
                + `<label for="${id}" class="bookmark-detail-checkmode-option">${esc(o.label)}</label>`;
        }).join('');
        const interval = window.CheckMode?.intervalOf?.(b) || 15;
        const intervalOpts = [5, 15, 30, 60, 360, 1440].map((m) => {
            const label = m < 60 ? `${m}m` : (m === 1440 ? '24h' : `${m / 60}h`);
            return `<option value="${m}" ${m === interval ? 'selected' : ''}>${esc(label)}</option>`;
        }).join('');

        const icon = b.icon || '';
        const iconPreview = icon
            ? `<img src="${esc(this.resolveIconSrc(icon))}" alt="" class="config-bm-icon-img">`
            : `<span class="config-bm-icon-empty">—</span>`;

        const saveBar = (position) => `
            <div class="config-bm-savebar config-bm-savebar--${position}">
                <button type="button" class="config-btn config-btn--primary" data-bm-save="1">${esc(this.t('config.save', 'Save'))}</button>
                <button type="button" class="config-btn" data-bm-revert="1">${esc(this.t('config.revert', 'Revert'))}</button>
                <span class="config-bm-dirty" data-bm-dirty hidden>${esc(this.t('config.unsavedChanges', 'Unsaved changes'))}</span>
            </div>`;

        return `
            <div class="config-bm-editor" data-bm-editor-key="${esc(DashboardConfig.bookmarkKey(b))}">
                ${saveBar('top')}

                <div class="config-bm-grid">
                    <div class="config-bm-cell config-bm-cell--wide">
                        <label class="config-bm-label" for="config-bm-name">${esc(this.t('config.bookmarkNamePlaceholder', 'Name'))}</label>
                        <input type="text" id="config-bm-name" class="config-text" data-bm-field="name" value="${esc(b.name || '')}"
                               placeholder="${esc(this.t('config.bookmarkNameAutoHint', 'Left blank, the page title is used'))}">
                    </div>

                    <div class="config-bm-cell config-bm-cell--wide">
                        <label class="config-bm-label" for="config-bm-url">${esc(this.t('config.urlLabelShort', 'URL'))}</label>
                        <div class="config-bm-url-row">
                            <input type="url" id="config-bm-url" class="config-text" data-bm-field="url" value="${esc(b.url || '')}" placeholder="https://">
                            <button type="button" class="config-btn config-btn--small" data-bm-refetch="1"
                                    title="${esc(this.t('config.fetchMetaTitle', 'Fetch the icon and title for this URL'))}">${esc(this.t('config.fetchFaviconRetry', 'Retry'))}</button>
                            <span class="config-bm-fetch-state" data-bm-fetch-state></span>
                        </div>
                        <p class="config-field-hint config-bm-conflict" data-bm-conflict="url" hidden></p>
                    </div>

                    <div class="config-bm-cell">
                        <label class="config-bm-label" for="config-bm-page">${esc(this.t('config.page', 'Page'))}</label>
                        <select id="config-bm-page-sel" class="config-select" data-bm-field="pageId">${pageOpts}</select>
                    </div>

                    <div class="config-bm-cell">
                        <label class="config-bm-label" for="config-bm-cat">${esc(this.t('config.category', 'Category'))}</label>
                        <select id="config-bm-cat" class="config-select" data-bm-field="category">${catOpts}</select>
                        <div class="config-bm-newcat" data-bm-newcat hidden>
                            <input type="text" class="config-text" data-bm-newcat-input placeholder="${esc(this.t('config.newCategoryNamePlaceholder', 'Category name'))}" maxlength="60">
                            <button type="button" class="config-btn config-btn--small" data-bm-newcat-ok>${esc(this.t('config.confirm', 'Confirm'))}</button>
                            <button type="button" class="config-btn config-btn--small" data-bm-newcat-cancel>${esc(this.t('config.cancel', 'Cancel'))}</button>
                        </div>
                    </div>

                    <div class="config-bm-cell config-bm-cell--wide">
                        <label class="config-bm-label" for="config-bm-tags">${esc(this.t('config.detailTagsLabel', 'Tags'))}
                            <span class="config-bm-label-hint">${esc(this.t('config.commaSeparatedShort', 'comma-separated'))}</span></label>
                        <input type="text" id="config-bm-tags" class="config-text" data-bm-field="tags" value="${esc((b.tags || []).join(', '))}"
                               placeholder="${esc(this.t('config.detailTagsPlaceholder', 'work, dev, personal…'))}" autocomplete="off">
                    </div>

                    <div class="config-bm-cell">
                        <label class="config-bm-label" for="config-bm-shortcut">${esc(this.t('config.shortcut', 'Shortcut'))}</label>
                        <input type="text" id="config-bm-shortcut" class="config-text config-bm-shortcut" data-bm-field="shortcut" maxlength="5" value="${esc(b.shortcut || '')}"
                               placeholder="${esc(this.t('config.bookmarkShortcutPlaceholder', 'Y, YS, YC'))}">
                        <p class="config-field-hint config-bm-conflict" data-bm-conflict="shortcut" hidden></p>
                    </div>

                    <div class="config-bm-cell">
                        <label class="config-bm-label" for="config-bm-note">${esc(this.t('config.detailNoteLabel', 'Note'))}</label>
                        <textarea id="config-bm-note" class="config-text config-bm-note" data-bm-field="note" rows="2">${esc(b.note || '')}</textarea>
                    </div>

                    <div class="config-bm-cell">
                        <span class="config-bm-label">${esc(this.t('config.placementLabel', 'Placement'))}</span>
                        <label class="checkbox-label icon-toggle bookmark-detail-toggle config-bm-pin"
                               title="${esc(this.t('config.pinnedToggleHint', 'Pin this bookmark to the top of its category'))}">
                            <input type="checkbox" data-bm-field="pinned" ${b.pinned ? 'checked' : ''}>
                            <span class="icon-toggle-indicator" aria-hidden="true">
                                <svg viewBox="0 0 24 24" focusable="false">
                                    <path d="M8 3h8l-1 5 3 3v1H6v-1l3-3-1-5zm4 10v8h-1v-8h1z"></path>
                                </svg>
                            </span>
                            <span class="bookmark-detail-toggle-label">${esc(this.t('config.pinnedShort', 'Pinned'))}</span>
                        </label>
                    </div>

                    <div class="config-bm-cell">
                        <span class="config-bm-label">${esc(this.t('config.checkModeLabel', 'Availability check'))}</span>
                        <div class="bookmark-detail-checkmode-options" role="radiogroup" aria-label="${esc(this.t('config.checkModeLabel', 'Availability check'))}">
                            ${modeRadios}
                            <select class="bookmark-detail-toggle-select" data-bm-field="monitorIntervalMinutes" ${mode === 'monitor' ? '' : 'hidden'}>${intervalOpts}</select>
                        </div>
                        <p class="config-field-hint" data-bm-mode-hint></p>
                    </div>

                    <div class="config-bm-cell config-bm-cell--wide">
                        <span class="config-bm-label">${esc(this.t('config.icon', 'Icon'))}</span>
                        <div class="config-bm-icon-row">
                            <div class="config-bm-icon-preview">${iconPreview}</div>
                            <input type="text" class="config-text" data-bm-field="icon" value="${esc(icon)}" placeholder="${esc(this.t('config.iconUrlOptional', 'Icon URL (optional)'))}">
                            <button type="button" class="config-btn config-btn--small" data-bm-icon="upload">${esc(this.t('config.detailUploadIconBtn', 'Upload…'))}</button>
                            <button type="button" class="config-btn config-btn--small" data-bm-icon="clear">${esc(this.t('config.clearIcon', 'Clear icon'))}</button>
                            <input type="file" data-bm-icon-file accept="image/*,.ico,.svg,.webp" hidden>
                        </div>
                    </div>

                    <div class="config-bm-cell config-bm-cell--wide">
                        <span class="config-bm-label">${esc(this.t('config.linkPreviewSectionTitle', 'Link preview'))}</span>
                        <p class="config-field-hint" data-bm-preview-title>${b.previewTitle ? esc(b.previewTitle) : esc(this.t('config.noPreviewYet', 'No preview metadata yet.'))}</p>
                        <div class="config-actions">
                            <button type="button" class="config-btn config-btn--small" data-bm-preview="refresh">${esc(this.t('config.detailLinkPreviewRefresh', 'Refresh preview'))}</button>
                            <button type="button" class="config-btn config-btn--small" data-bm-preview="clear">${esc(this.t('config.detailLinkPreviewClear', 'Clear preview'))}</button>
                        </div>
                    </div>
                </div>

                ${saveBar('bottom')}
            </div>`;
    }

    /** Bookmark icons are stored as bare filenames; the dashboard serves them from /data/icons/. */
    resolveIconSrc(icon) {
        const raw = String(icon || '');
        if (!raw) return '';
        if (/^(https?:|data:|\/)/i.test(raw)) return raw;
        return `/data/icons/${raw}`;
    }

    bindBookmarksSection(container) {
        const search = container.querySelector('#config-bm-search');
        if (search) {
            search.addEventListener('input', () => {
                this.bmQuery = search.value;
                this.repaintBookmarksList();
            });
        }
        const wire = (id, prop) => {
            const el = container.querySelector(id);
            if (!el) return;
            el.addEventListener('change', () => {
                this[prop] = el.value;
                this.repaintBookmarksList();
            });
        };
        wire('#config-bm-page', 'bmPageFilter');
        wire('#config-bm-category', 'bmCategoryFilter');
        wire('#config-bm-sort', 'bmSort');
        this.bindBookmarkRows(container);
        this.bindBulkToolbar(container);
    }

    /** Row-level handlers, rebound after every list repaint. */
    bindBookmarkRows(root) {
        root.querySelectorAll('[data-bm-edit]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const key = btn.getAttribute('data-bm-edit');
                if (this.bmEditing === key) {
                    if (!(await this.confirmDiscardBookmarkEdit())) return;
                    this.bmEditing = null;
                } else {
                    if (this.bmEditing && !(await this.confirmDiscardBookmarkEdit())) return;
                    this.bmEditing = key;
                }
                this.bmDirty = false;
                this.repaintBookmarksList();
            });
        });
        root.querySelectorAll('[data-bm-delete]').forEach((btn) => {
            btn.addEventListener('click', () => this.deleteBookmarkByKey(btn.getAttribute('data-bm-delete')));
        });
        root.querySelectorAll('[data-bm-tick]').forEach((box) => {
            box.addEventListener('change', () => {
                const key = box.getAttribute('data-bm-tick');
                if (box.checked) this.bmSelected.add(key);
                else this.bmSelected.delete(key);
                this.repaintBulkToolbar();
            });
        });
        this.bindBookmarkEditorControls(root);
    }

    /** Everything inside the open editor. */
    bindBookmarkEditorControls(root) {
        const editor = root.querySelector('.config-bm-editor');
        if (!editor) return;

        // The URL the current icon belongs to. Leaving the URL field re-fetches
        // the favicon whenever the URL has moved away from this, so a changed
        // address never keeps the previous site's icon.
        this._bmIconUrl = this.canonicalMetaUrl(editor.querySelector('[data-bm-field="url"]')?.value);

        // Two save bars (top and bottom), so both dirty markers move together.
        const markDirty = () => this.markEditorDirty(editor);

        editor.querySelectorAll('[data-bm-field]').forEach((el) => {
            const evt = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
            el.addEventListener(evt, () => {
                markDirty();
                if (el.getAttribute('data-bm-field') === 'category' && el.value === '__new__') {
                    this.openNewCategoryInput(editor);
                }
                if (el.getAttribute('data-bm-field') === 'icon') {
                    this.syncEditorIconPreview(editor);
                    // Typed by hand, so it belongs to the URL as it stands now
                    // and a later blur must not fetch over it.
                    this._bmIconUrl = this.canonicalMetaUrl(editor.querySelector('[data-bm-field="url"]')?.value);
                }
            });
        });

        // Availability mode: show the interval only for Monitor, and explain the
        // choice in the same words the add-bookmark modal and config panel use.
        const syncMode = () => {
            const picked = editor.querySelector('input[name="config-bm-mode"]:checked')?.value || 'off';
            const sel = editor.querySelector('[data-bm-field="monitorIntervalMinutes"]');
            if (sel) sel.hidden = picked !== 'monitor';
            const hint = editor.querySelector('[data-bm-mode-hint]');
            if (hint) {
                const key = picked === 'monitor' ? 'checkModeMonitorHint'
                    : (picked === 'periodic' ? 'checkModePeriodicHint' : 'checkModeOffHint');
                const fallback = {
                    checkModeOffHint: 'No availability checking.',
                    checkModePeriodicHint: 'Checks once a day and flags the bookmark when it breaks.',
                    checkModeMonitorHint: 'Checks on your own interval and keeps uptime history, a heartbeat and outage alerts.',
                }[key];
                hint.textContent = this.t(`config.${key}`, fallback);
            }
        };
        editor.querySelectorAll('input[name="config-bm-mode"]').forEach((r) => {
            r.addEventListener('change', () => { markDirty(); syncMode(); });
        });
        syncMode();

        // Tag autocomplete, drawing on every tag already in use.
        const tagsInput = editor.querySelector('[data-bm-field="tags"]');
        if (tagsInput && typeof TagAutocomplete !== 'undefined') {
            const pool = new Set();
            (this.dash.allBookmarks || []).forEach((bm) => (bm.tags || []).forEach((t) => pool.add(String(t).toLowerCase())));
            TagAutocomplete.attach(tagsInput, () => {
                tagsInput.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).forEach((t) => pool.add(t));
                return [...pool];
            });
        }

        // Inline "new category".
        editor.querySelector('[data-bm-newcat-ok]')?.addEventListener('click', () => this.confirmNewCategory(editor));
        editor.querySelector('[data-bm-newcat-cancel]')?.addEventListener('click', () => this.cancelNewCategory(editor));
        editor.querySelector('[data-bm-newcat-input]')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.confirmNewCategory(editor); }
            if (e.key === 'Escape') { e.preventDefault(); this.cancelNewCategory(editor); }
        });

        // Icon: upload a file, or clear it.
        const fileInput = editor.querySelector('[data-bm-icon-file]');
        editor.querySelectorAll('[data-bm-icon]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-bm-icon');
                if (action === 'upload') fileInput?.click();
                if (action === 'clear') {
                    const f = editor.querySelector('[data-bm-field="icon"]');
                    if (f) f.value = '';
                    this.syncEditorIconPreview(editor);
                    // Cleared on purpose: forget which URL the icon belonged to,
                    // so the next blur is free to fetch one again.
                    this._bmIconUrl = '';
                    markDirty();
                }
            });
        });
        fileInput?.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            fileInput.value = '';
            if (!file) return;
            const name = await this.uploadBookmarkIcon(file);
            if (name) {
                const f = editor.querySelector('[data-bm-field="icon"]');
                if (f) f.value = name;
                this.syncEditorIconPreview(editor);
                // An icon chosen by hand belongs to the URL as it stands now, so
                // leaving the field must not fetch over it.
                this._bmIconUrl = this.canonicalMetaUrl(editor.querySelector('[data-bm-field="url"]')?.value);
                markDirty();
            }
        });

        editor.querySelectorAll('[data-bm-preview]').forEach((btn) => {
            btn.addEventListener('click', () => this.handleEditorPreview(btn.getAttribute('data-bm-preview')));
        });

        // Both save bars (top and bottom) drive the same two actions.
        editor.querySelectorAll('[data-bm-save]').forEach((btn) => {
            btn.addEventListener('click', () => this.saveEditedBookmark());
        });
        editor.querySelectorAll('[data-bm-revert]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.bmDirty = false;
                this.repaintBookmarksList();
            });
        });

        // Live conflict hints for shortcut and URL, matching the add modal.
        editor.querySelector('[data-bm-field="shortcut"]')?.addEventListener('input', () => this.updateEditorConflicts(editor));
        this.updateEditorConflicts(editor);

        // URL handling mirrors the add-bookmark modal: typing schedules a
        // debounced metadata fetch, leaving the field normalises it to a full
        // http(s) URL first. Both then pull the favicon and, if the name is
        // still empty, the page title.
        const urlInput = editor.querySelector('[data-bm-field="url"]');
        if (urlInput) {
            urlInput.addEventListener('input', () => {
                this.updateEditorConflicts(editor);
                this.scheduleEditorMetaFetch(editor);
            });
            urlInput.addEventListener('blur', () => {
                this.normalizeEditorUrl(editor);
                this.updateEditorConflicts(editor);
                void this.autoFetchEditorMeta(editor, { force: false });
            });
        }
        editor.querySelector('[data-bm-refetch]')?.addEventListener('click', () => {
            this.normalizeEditorUrl(editor);
            void this.autoFetchEditorMeta(editor, { force: true });
        });
    }

    /**
     * A stable key for "which URL is this icon for". Normalising first means
     * typing `example.com` and then having it completed to `https://example.com`
     * does not read as a change and re-fetch for no reason.
     */
    canonicalMetaUrl(raw) {
        const full = window.BookmarkUrlUtils?.ensureHttpUrl?.(raw) || String(raw || '').trim();
        if (!full) return '';
        return window.BookmarkUrlUtils?.canonicalBookmarkURLKey?.(full) ?? full.toLowerCase();
    }

    /** Write the URL back as a full http(s) URL, the way the add modal does. */
    normalizeEditorUrl(editor) {
        const input = editor.querySelector('[data-bm-field="url"]');
        if (!input) return '';
        const normalized = window.BookmarkUrlUtils?.ensureHttpUrl(input.value) || String(input.value || '').trim();
        if (normalized && normalized !== String(input.value || '').trim()) {
            input.value = normalized;
            this.markEditorDirty(editor);
        }
        return normalized;
    }

    scheduleEditorMetaFetch(editor) {
        const run = () => void this.autoFetchEditorMeta(editor, { force: false });
        if (window.BookmarkPreviewService?.scheduleDebounced) {
            window.BookmarkPreviewService.scheduleDebounced('config-bm-url-meta', run, 500);
            return;
        }
        clearTimeout(this._bmMetaTimer);
        this._bmMetaTimer = setTimeout(run, 500);
    }

    markEditorDirty(editor) {
        this.bmDirty = true;
        editor.querySelectorAll('[data-bm-dirty]').forEach((el) => { el.hidden = false; });
    }

    /**
     * Fetch the favicon and page title for whatever URL the field now holds.
     * `force` re-fetches even when an icon is already set (the Retry button);
     * without it an icon the user chose is left alone.
     */
    async autoFetchEditorMeta(editor, { force = false } = {}) {
        if (!editor.isConnected) return;
        const urlInput = editor.querySelector('[data-bm-field="url"]');
        const iconInput = editor.querySelector('[data-bm-field="icon"]');
        const nameInput = editor.querySelector('[data-bm-field="name"]');
        const state = editor.querySelector('[data-bm-fetch-state]');
        const url = window.BookmarkUrlUtils?.ensureHttpUrl(urlInput?.value) || String(urlInput?.value || '').trim();
        if (!url || !window.BookmarkUrlUtils?.isHttpUrl?.(url)) return;
        if (this._bmFetchInFlight) return;

        // Whether to replace the icon: a different URL than the one the current
        // icon was fetched for means the old site's icon is simply wrong, so it
        // is refreshed even though the field is filled. An unchanged URL leaves
        // a hand-picked icon alone unless Retry asked for it.
        const canon = this.canonicalMetaUrl(url);
        const urlChanged = canon !== this._bmIconUrl;
        const hasIcon = Boolean(String(iconInput?.value || '').trim());
        const wantIcon = force || urlChanged || !hasIcon;
        const wantName = !String(nameInput?.value || '').trim();
        if (!wantIcon && !wantName) return;

        this._bmFetchInFlight = true;
        if (state) state.textContent = this.t('config.iconFetching', 'Fetching...');
        try {
            if (wantIcon) {
                const icon = await window.BookmarkPreviewService?.fetchAndUploadFavicon?.(url);
                if (icon && iconInput && editor.isConnected) {
                    iconInput.value = icon;
                    this.syncEditorIconPreview(editor);
                    this.markEditorDirty(editor);
                }
                // Recorded either way: a URL whose icon could not be found must
                // not be retried on every blur.
                this._bmIconUrl = canon;
                if (state) state.textContent = icon
                    ? this.t('config.iconFound', 'Found')
                    : this.t('config.iconNotFound', 'Not found');
            } else if (state) {
                state.textContent = '';
            }

            // The title only fills an empty name, and always feeds the preview line.
            const preview = await window.BookmarkPreviewService?.fetchLinkPreview?.(url);
            if (preview && editor.isConnected) {
                if (nameInput && !String(nameInput.value || '').trim() && preview.title) {
                    nameInput.value = preview.title;
                    this.markEditorDirty(editor);
                }
                const line = editor.querySelector('[data-bm-preview-title]');
                if (line && preview.title) line.textContent = preview.title;
            }
        } catch {
            if (state) state.textContent = this.t('config.iconNotFound', 'Not found');
        } finally {
            this._bmFetchInFlight = false;
        }
    }

    syncEditorIconPreview(editor) {
        const host = editor.querySelector('.config-bm-icon-preview');
        if (!host) return;
        const val = editor.querySelector('[data-bm-field="icon"]')?.value || '';
        host.innerHTML = val
            ? `<img src="${this.dash.escapeHtml(this.resolveIconSrc(val))}" alt="" class="config-bm-icon-img">`
            : `<span class="config-bm-icon-empty">—</span>`;
    }

    openNewCategoryInput(editor) {
        const box = editor.querySelector('[data-bm-newcat]');
        if (!box) return;
        box.hidden = false;
        box.querySelector('[data-bm-newcat-input]')?.focus();
    }

    cancelNewCategory(editor) {
        const box = editor.querySelector('[data-bm-newcat]');
        const sel = editor.querySelector('[data-bm-field="category"]');
        if (box) { box.hidden = true; const i = box.querySelector('[data-bm-newcat-input]'); if (i) i.value = ''; }
        if (sel && sel.value === '__new__') sel.value = '';
    }

    /**
     * A new category exists only once a bookmark carries it, so this adds the
     * name as an option and selects it; saving the bookmark is what persists it.
     */
    confirmNewCategory(editor) {
        const box = editor.querySelector('[data-bm-newcat]');
        const input = box?.querySelector('[data-bm-newcat-input]');
        const sel = editor.querySelector('[data-bm-field="category"]');
        const name = String(input?.value || '').trim();
        if (!name || !sel) return;
        if (![...sel.options].some((o) => o.value === name)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
        }
        sel.value = name;
        if (box) { box.hidden = true; if (input) input.value = ''; }
        this.markEditorDirty(editor);
    }

    /** Warn about a shortcut or URL already used on the target page. */
    updateEditorConflicts(editor) {
        const key = editor.getAttribute('data-bm-editor-key');
        const parsed = this.parseBookmarkKey(key);
        const pageId = editor.querySelector('[data-bm-field="pageId"]')?.value || parsed?.pageId;
        const shortcut = String(editor.querySelector('[data-bm-field="shortcut"]')?.value || '').trim().toUpperCase();
        const url = String(editor.querySelector('[data-bm-field="url"]')?.value || '').trim();
        const others = (this.dash.allBookmarks || []).filter((b) =>
            String(b.pageId) === String(pageId) && !(String(b.pageId) === String(parsed?.pageId) && b.url === parsed?.url));

        const show = (which, msg) => {
            const el = editor.querySelector(`[data-bm-conflict="${which}"]`);
            if (!el) return;
            el.textContent = msg || '';
            el.hidden = !msg;
        };
        show('shortcut', shortcut && others.some((b) => String(b.shortcut || '').toUpperCase() === shortcut)
            ? this.t('config.shortcutConflict', 'Shortcut already in use')
            : '');
        const canon = (u) => window.BookmarkUrlUtils?.canonicalBookmarkURLKey?.(u) ?? String(u || '').trim().toLowerCase();
        show('url', url && others.some((b) => canon(b.url) === canon(url))
            ? this.t('config.urlConflictHint', 'This URL already exists on this page.')
            : '');
    }

    /** Same endpoint and payload the add-bookmark modal uses: POST /api/icon. */
    async uploadBookmarkIcon(file) {
        try {
            const form = new FormData();
            form.append('icon', file);
            const res = await this.writeFetch('/api/icon', { method: 'POST', body: form });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const name = data.icon || '';
            if (!name) throw new Error('no filename');
            this.notify(this.t('config.iconUploadSuccess', 'Icon uploaded.'), 'success');
            return name;
        } catch {
            this.notify(this.t('config.iconUploadError', 'Could not upload the icon.'), 'error');
            return '';
        }
    }

    /**
     * Refresh or clear this bookmark's preview metadata. The server's
     * /api/previews/* endpoints act on everything at once, so a single card is
     * done the way the bookmark forms do it: fetch the metadata for the URL and
     * write the three preview fields onto the bookmark itself.
     */
    async handleEditorPreview(action) {
        const parsed = this.parseBookmarkKey(this.bmEditing);
        const editor = document.querySelector('.config-bm-editor');
        if (!parsed || !editor) return;
        const url = editor.querySelector('[data-bm-field="url"]')?.value?.trim() || parsed.url;

        try {
            let fields;
            if (action === 'refresh') {
                if (!window.BookmarkPreviewService?.fetchLinkPreview) {
                    this.notify(this.t('config.bookmarkLinkPreviewRefreshFailed', 'Could not fetch link preview.'), 'error');
                    return;
                }
                const data = await window.BookmarkPreviewService.fetchLinkPreview(url);
                fields = {
                    previewTitle: data.title || '',
                    previewDesc: data.description || '',
                    previewImage: data.image || '',
                };
            } else {
                fields = { previewTitle: '', previewDesc: '', previewImage: '' };
            }

            await this.writePageBookmarks(parsed.pageId, (list) =>
                list.map((b) => (b.url === parsed.url ? { ...b, ...fields } : b)));
            this.notify(action === 'refresh'
                ? this.t('config.bookmarkLinkPreviewRefreshed', 'Link preview updated.')
                : this.t('config.bookmarkLinkPreviewCleared', 'Link preview cleared.'), 'success');
            await this.refreshBookmarksAfterWrite();
        } catch {
            this.notify(this.t('config.bookmarkLinkPreviewRefreshFailed', 'Could not fetch link preview.'), 'error');
        }
    }

    async confirmDiscardBookmarkEdit() {
        if (!this.bmDirty) return true;
        return window.confirm(this.t('config.discardChangesConfirm', 'Discard your unsaved changes?'));
    }

    repaintBookmarksList() {
        const host = document.getElementById('config-bm-list');
        if (!host) return;
        host.innerHTML = this.renderBookmarksList();
        this.bindBookmarkRows(host);
        this.repaintBulkToolbar();
    }

    repaintBulkToolbar() {
        const host = document.getElementById('config-bm-bulk');
        if (!host) return;
        host.innerHTML = this.renderBulkToolbar();
        this.bindBulkToolbar(host);
    }

    bindBulkToolbar(root) {
        root.querySelectorAll('[data-bulk]').forEach((btn) => {
            btn.addEventListener('click', () => this.handleBulkAction(btn.getAttribute('data-bulk')));
        });
    }

    /** Split a "pageId::url" row key back into its parts. */
    parseBookmarkKey(key) {
        const idx = String(key || '').indexOf('::');
        if (idx < 0) return null;
        return { pageId: key.slice(0, idx), url: key.slice(idx + 2) };
    }

    /** Re-save one page's bookmark list with a mutation applied. */
    async writePageBookmarks(pageId, mutate) {
        const all = this.dash.allBookmarks || [];
        const list = all.filter((b) => String(b.pageId) === String(pageId))
            .map((b) => {
                const copy = { ...b };
                delete copy.pageId;
                return copy;
            });
        const next = mutate(list);
        const res = await this.writeFetch(`/api/bookmarks?page=${encodeURIComponent(pageId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }

    async deleteBookmarkByKey(key) {
        const parsed = this.parseBookmarkKey(key);
        if (!parsed) return;
        if (!window.confirm(this.t('config.deleteBookmarkConfirm', 'Delete this bookmark?'))) return;
        try {
            await this.writePageBookmarks(parsed.pageId, (list) => list.filter((b) => b.url !== parsed.url));
            this.bmSelected.delete(key);
            if (this.bmEditing === key) { this.bmEditing = null; this.bmDirty = false; }
            this.notify(this.t('config.bookmarkDeleted', 'Bookmark deleted.'), 'success');
            await this.refreshBookmarksAfterWrite();
        } catch {
            this.notify(this.t('config.bookmarkDeleteError', 'Could not delete the bookmark.'), 'error');
        }
    }

    async saveEditedBookmark() {
        const parsed = this.parseBookmarkKey(this.bmEditing);
        const editor = document.querySelector('.config-bm-editor');
        if (!parsed || !editor) return;
        const val = (field) => editor.querySelector(`[data-bm-field="${field}"]`)?.value ?? '';
        const checked = (field) => editor.querySelector(`[data-bm-field="${field}"]`)?.checked === true;

        const targetPage = String(val('pageId') || parsed.pageId);
        const category = val('category') === '__new__' ? '' : val('category').trim();
        const updated = {
            name: val('name').trim(),
            url: val('url').trim(),
            category,
            shortcut: val('shortcut').trim().toUpperCase(),
            note: val('note').trim(),
            pinned: checked('pinned'),
            icon: val('icon').trim(),
            tags: val('tags').split(',').map((t) => t.trim().toLowerCase()).filter((t, i, a) => t && a.indexOf(t) === i),
        };
        if (!updated.name || !updated.url) {
            this.notify(this.t('config.nameUrlRequired', 'A name and URL are required.'), 'error');
            return;
        }

        // Availability checking goes through CheckMode so the stored
        // monitor/checkStatus/interval triple matches every other surface.
        const mode = editor.querySelector('input[name="config-bm-mode"]:checked')?.value || 'off';
        if (window.CheckMode) {
            updated.monitorIntervalMinutes = Number(val('monitorIntervalMinutes')) || 15;
            window.CheckMode.assign(updated, mode);
        }

        try {
            const original = (this.dash.allBookmarks || [])
                .find((b) => String(b.pageId) === String(parsed.pageId) && b.url === parsed.url) || {};
            if (targetPage === String(parsed.pageId)) {
                await this.writePageBookmarks(parsed.pageId, (list) =>
                    list.map((b) => (b.url === parsed.url ? { ...b, ...updated } : b)));
            } else {
                // Moving pages is two writes: drop it from the old page, then
                // append it to the new one so it cannot exist on both at once.
                await this.writePageBookmarks(parsed.pageId, (list) => list.filter((b) => b.url !== parsed.url));
                await this.refreshBookmarksAfterWrite({ silent: true });
                await this.writePageBookmarks(targetPage, (list) => [...list, { ...original, ...updated }]);
            }
            this.bmEditing = null;
            this.bmDirty = false;
            this.notify(this.t('config.bookmarkSaved', 'Bookmark saved.'), 'success');
            await this.refreshBookmarksAfterWrite();
        } catch {
            this.notify(this.t('config.bookmarkSaveError', 'Could not save the bookmark.'), 'error');
        }
    }

    /* ── Bulk actions ──────────────────────────────────────────────────────── */

    /** The ticked bookmarks, resolved back to live objects. */
    selectedBookmarks() {
        const keys = this.bmSelected;
        return (this.dash.allBookmarks || []).filter((b) => keys.has(DashboardConfig.bookmarkKey(b)));
    }

    async handleBulkAction(action) {
        if (action === 'clear') {
            this.bmSelected.clear();
            this.repaintBookmarksList();
            return;
        }
        const picked = this.selectedBookmarks();
        if (!picked.length) return;

        try {
            if (action === 'move') await this.bulkMove(picked);
            else if (action === 'tags') await this.bulkTags(picked);
            else if (action === 'status') await this.bulkStatus(picked);
            else if (action === 'pin') await this.bulkPin(picked);
            else if (action === 'delete') await this.bulkDelete(picked);
        } catch {
            this.notify(this.t('config.bulkActionError', 'Could not apply the bulk action.'), 'error');
        }
    }

    /**
     * Apply a mutation to every ticked bookmark, grouped per page so each page
     * is written exactly once rather than once per bookmark.
     */
    async mutateSelected(picked, mutate) {
        const byPage = new Map();
        picked.forEach((b) => {
            const list = byPage.get(String(b.pageId)) || [];
            list.push(b.url);
            byPage.set(String(b.pageId), list);
        });
        for (const [pageId, urls] of byPage) {
            const set = new Set(urls);
            await this.writePageBookmarks(pageId, (list) => list.map((b) => (set.has(b.url) ? mutate({ ...b }) : b)));
        }
        this.bmSelected.clear();
        await this.refreshBookmarksAfterWrite();
    }

    async bulkMove(picked) {
        const targetPage = document.getElementById('config-bulk-page')?.value || '';
        const targetCat = document.getElementById('config-bulk-category')?.value || '';
        if (!targetPage && !targetCat) return;

        if (targetCat && !targetPage) {
            await this.mutateSelected(picked, (b) => ({ ...b, category: targetCat }));
            this.notify(this.t('config.bulkMoveDone', 'Bookmarks updated.'), 'success');
            return;
        }

        // A page move is a remove-then-append across two lists, so it cannot go
        // through mutateSelected.
        const moving = picked.filter((b) => String(b.pageId) !== String(targetPage));
        const byPage = new Map();
        moving.forEach((b) => {
            const list = byPage.get(String(b.pageId)) || [];
            list.push(b.url);
            byPage.set(String(b.pageId), list);
        });
        const carried = moving.map((b) => {
            const copy = { ...b };
            delete copy.pageId;
            if (targetCat) copy.category = targetCat;
            return copy;
        });
        for (const [pageId, urls] of byPage) {
            const set = new Set(urls);
            await this.writePageBookmarks(pageId, (list) => list.filter((b) => !set.has(b.url)));
        }
        await this.refreshBookmarksAfterWrite({ silent: true });
        if (carried.length) {
            await this.writePageBookmarks(targetPage, (list) => [...list, ...carried]);
        }
        // Anything already on the target page still needs its category applied.
        const staying = picked.filter((b) => String(b.pageId) === String(targetPage));
        if (targetCat && staying.length) {
            const set = new Set(staying.map((b) => b.url));
            await this.refreshBookmarksAfterWrite({ silent: true });
            await this.writePageBookmarks(targetPage, (list) =>
                list.map((b) => (set.has(b.url) ? { ...b, category: targetCat } : b)));
        }
        this.bmSelected.clear();
        await this.refreshBookmarksAfterWrite();
        this.notify(this.t('config.bulkMoveDone', 'Bookmarks updated.'), 'success');
    }

    async bulkTags(picked) {
        const raw = document.getElementById('config-bulk-tags')?.value || '';
        const mode = document.getElementById('config-bulk-tags-mode')?.value || 'add';
        const tags = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        if (!tags.length) return;
        await this.mutateSelected(picked, (b) => {
            const current = Array.isArray(b.tags) ? b.tags.map((t) => String(t).toLowerCase()) : [];
            let next;
            if (mode === 'replace') next = [...tags];
            else if (mode === 'remove') next = current.filter((t) => !tags.includes(t));
            else next = [...new Set([...current, ...tags])];
            return { ...b, tags: next };
        });
        this.notify(this.t('config.bulkTagsDone', 'Tags updated.'), 'success');
    }

    async bulkStatus(picked) {
        const mode = document.getElementById('config-bulk-status')?.value || 'off';
        await this.mutateSelected(picked, (b) => {
            const next = { ...b };
            if (window.CheckMode) {
                next.monitorIntervalMinutes = window.CheckMode.intervalOf?.(b) || 15;
                window.CheckMode.assign(next, mode);
            }
            return next;
        });
        this.notify(this.t('config.bulkStatusDone', 'Availability checking updated.'), 'success');
    }

    async bulkPin(picked) {
        // Mixed selections pin everything rather than flipping each: a toggle
        // that leaves half pinned is not what "toggle pin" is asked to do.
        const allPinned = picked.every((b) => b.pinned === true);
        await this.mutateSelected(picked, (b) => ({ ...b, pinned: !allPinned }));
        this.notify(this.t('config.bulkPinDone', 'Pins updated.'), 'success');
    }

    async bulkDelete(picked) {
        const msg = this.t('config.bulkDeleteConfirm', 'Delete {n} bookmarks? This cannot be undone.')
            .replace('{n}', String(picked.length));
        if (!window.confirm(msg)) return;
        const byPage = new Map();
        picked.forEach((b) => {
            const list = byPage.get(String(b.pageId)) || [];
            list.push(b.url);
            byPage.set(String(b.pageId), list);
        });
        for (const [pageId, urls] of byPage) {
            const set = new Set(urls);
            await this.writePageBookmarks(pageId, (list) => list.filter((b) => !set.has(b.url)));
        }
        this.bmSelected.clear();
        this.bmEditing = null;
        this.notify(this.t('config.bulkDeleteDone', 'Bookmarks deleted.'), 'success');
        await this.refreshBookmarksAfterWrite();
    }

    /** Reload the dashboard's bookmark copies and repaint both list and grid. */
    async refreshBookmarksAfterWrite({ silent = false } = {}) {
        await this.dash.loadAllBookmarks?.();
        await this.dash.loadPageBookmarks?.(this.dash.currentPageId, { forceFetch: true });
        if (silent) return;
        this.dash.renderDashboard?.({ animate: false });
        if (this.isActiveView() && this.section === 'bookmarks') this.repaintBookmarksList();
    }

    /* ── Statistics (native) ───────────────────────────────────────────────── */

    /** How far back the activity chart looks, in days. */
    static STATS_RANGES = [7, 30, 90, 365];

    /**
     * A read-only report on what is actually in the dashboard: a cleanup score,
     * an activity chart, ratio bars, top lists and per-page/tag distributions.
     *
     * Everything is derived from the bookmark copies the shell already holds, so
     * opening this costs one health fetch rather than a page load. The score and
     * the chart use the same formulas and bucketing the old config's stats tab
     * used, so a number does not change meaning by moving views.
     */
    renderStats() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.computeStats();

        const tile = (label, value, hint) => `
            <div class="config-tile" role="listitem">
                <span class="config-tile-label">${esc(label)}</span>
                <span class="config-tile-value">${esc(String(value))}</span>
                ${hint ? `<p class="config-tile-detail">${esc(hint)}</p>` : ''}
            </div>`;

        return `
            <p class="config-view-intro">${esc(this.t('config.statsIntroView', 'What is in your dashboard right now. These numbers update as you change things.'))}</p>

            <div class="config-actions" style="margin-bottom:16px">
                <button type="button" class="config-btn config-btn--small" data-stats-action="export">${esc(this.t('config.statsExportCsv', 'Export as CSV'))}</button>
            </div>

            <div class="config-tiles" role="list">
                ${tile(this.t('config.statsBookmarks', 'Bookmarks'), s.total)}
                ${tile(this.t('config.statsPages', 'Pages'), s.pages)}
                ${tile(this.t('config.statsCategoryCount', 'Categories'), s.categories)}
                ${tile(this.t('config.statsTagCount', 'Distinct tags'), s.tagCount)}
                ${tile(this.t('config.statsWithShortcut', 'With a shortcut'), s.withShortcut)}
                ${tile(this.t('config.statsMonitored', 'Monitored'), s.monitored)}
            </div>

            ${this.renderStatsScore(s)}
            ${this.renderStatsActivity(s)}
            ${this.renderStatsRatios(s)}
            ${this.renderStatsTopLists(s)}
            ${this.renderStatsDistributions(s)}
            ${this.renderStatsRot(s)}

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsHealthTitle', 'Link health'))}</h3>
                <div id="config-stats-health">${this.renderStatsHealth()}</div>
            </div>
        `;
    }

    /**
     * The cleanup score, using the old config's weights exactly: never-opened
     * costs up to 25, stale-90-days up to 20, duplicate URLs up to 15 and
     * shortcut conflicts up to 10, from a starting 100.
     */
    renderStatsScore(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        if (!s.total) {
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsNavScore', 'Cleanup score'))}</h3>
                    <p class="config-panel-empty">${esc(this.t('config.noBookmarksYet', 'No bookmarks yet.'))}</p>
                </div>`;
        }
        const { score, details } = s.cleanup;
        const tone = score >= 80 ? 'good' : (score >= 50 ? 'warn' : 'crit');
        const rows = details.map((d) => `
            <li class="config-stat-detail config-stat-detail--${esc(d.type)}">
                <span>${esc(d.text)}</span>
                ${d.penalty ? `<span class="config-stat-penalty">−${esc(String(d.penalty))}</span>` : ''}
            </li>`).join('');

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsNavScore', 'Cleanup score'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.statsScoreHint', 'Starts at 100 and loses points for bookmarks you never open, links gone stale, duplicate URLs and clashing shortcuts.'))}</p>
                <div class="config-score">
                    <span class="config-score-value config-score-value--${tone}">${esc(String(score))}</span>
                    <div class="config-bar" role="img" aria-label="${esc(this.t('config.statsNavScore', 'Cleanup score'))}: ${score}/100">
                        <span class="config-bar-fill config-bar-fill--${tone}" style="width:${score}%"></span>
                    </div>
                </div>
                <ul class="config-stat-details">${rows}</ul>
            </div>`;
    }

    /**
     * Opens per bucket as an SVG bar chart. A screen-reader table carries the
     * same numbers, because a chart that only exists as shapes is unreadable to
     * anyone not looking at it.
     */
    renderStatsActivity(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const a = s.activity;
        const ranges = DashboardConfig.STATS_RANGES.map((d) => {
            const on = d === this.statsRange;
            return `<button type="button" class="config-choice${on ? ' is-active' : ''}" data-stats-range="${d}" aria-pressed="${on}">${esc(this.statsRangeLabel(d))}</button>`;
        }).join('');

        if (!a.buckets.length) {
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsNavActivity', 'Activity'))}</h3>
                    <div class="config-choices" role="group">${ranges}</div>
                    <p class="config-panel-empty">${esc(this.t('config.statsNoActivity', 'No opens recorded in this period.'))}</p>
                </div>`;
        }

        const W = 500;
        const H = 72;
        const gap = 3;
        const n = a.buckets.length;
        const max = Math.max(...a.buckets, 1);
        const barW = Math.max(1, Math.floor((W - gap * (n - 1)) / n));
        const bars = a.buckets.map((val, i) => {
            const h = Math.round((val / max) * H);
            const x = i * (barW + gap);
            const opacity = val === 0 ? 0.15 : (0.75 + (val / max) * 0.25).toFixed(2);
            return `<rect x="${x}" y="${H - h}" width="${barW}" height="${Math.max(h, val > 0 ? 2 : 0)}" rx="1" fill="var(--accent-color, #4a90d9)" opacity="${opacity}"></rect>`;
        }).join('');
        const summary = a.labels.map((l, i) => `${l}: ${a.buckets[i]}`).join(', ');
        const srRows = a.labels.map((l, i) =>
            `<tr><th scope="row">${esc(l)}</th><td>${esc(String(a.buckets[i]))}</td></tr>`).join('');

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsNavActivity', 'Activity'))}</h3>
                <div class="config-choices" role="group">${ranges}</div>
                <div class="config-stat-figures">
                    <span><strong>${esc(String(a.totalOpens))}</strong> ${esc(this.t('config.statsActivityOpens', 'opens'))}</span>
                    <span><strong>${esc(String(a.activeCount))}</strong> ${esc(this.t('config.statsActivityActive', 'bookmarks used'))}</span>
                    ${a.wow !== null ? `<span class="config-stat-trend config-stat-trend--${a.wow >= 0 ? 'up' : 'down'}">${a.wow >= 0 ? '▲' : '▼'} ${esc(String(Math.abs(a.wow)))}% ${esc(this.t('config.statsActivityVsPrev', 'vs previous period'))}</span>` : ''}
                </div>
                <div class="config-chart">
                    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
                         aria-label="${esc(this.t('config.statsSparklineAriaView', 'Opens per period'))}: ${esc(summary)}">${bars}</svg>
                    <div class="config-chart-labels">
                        <span>${esc(a.labels[0] || '')}</span>
                        <span>${esc(a.labels[a.labels.length - 1] || '')}</span>
                    </div>
                </div>
                <table class="config-sr-only">
                    <caption>${esc(this.t('config.statsSparklineTableCaptionView', 'Opens per period'))}</caption>
                    <tbody>${srRows}</tbody>
                </table>
            </div>`;
    }

    statsRangeLabel(days) {
        if (days === 365) return this.t('config.statsRangeYear', '1 year');
        return this.t('config.statsRangeDays', '{n} days').replace('{n}', String(days));
    }

    /** Coverage bars: how much of the collection carries tags, shortcuts, notes. */
    renderStatsRatios(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const bar = (label, count, total, hint) => {
            const pct = total ? Math.round((count / total) * 100) : 0;
            return `
                <div class="config-ratio">
                    <div class="config-ratio-head">
                        <span class="config-ratio-label">${esc(label)}</span>
                        <span class="config-ratio-value">${esc(String(count))} / ${esc(String(total))} · ${pct}%</span>
                    </div>
                    <div class="config-bar" role="img" aria-label="${esc(label)}: ${pct}%">
                        <span class="config-bar-fill" style="width:${pct}%"></span>
                    </div>
                    ${hint ? `<p class="config-field-hint">${esc(hint)}</p>` : ''}
                </div>`;
        };
        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsCoverageTitle', 'Coverage'))}</h3>
                ${bar(this.t('config.statsTaggedBookmarks', 'Tagged'), s.tagged, s.total)}
                ${bar(this.t('config.statsWithShortcut', 'With a shortcut'), s.withShortcut, s.total)}
                ${bar(this.t('config.statsWithNote', 'With a note'), s.withNote, s.total)}
                ${bar(this.t('config.statsWithIcon', 'With an icon'), s.withIcon, s.total)}
                ${bar(this.t('config.statsChecked', 'Availability checked'), s.checked, s.total)}
            </div>`;
    }

    /**
     * Top lists: most opened, most tagged, and what has never been touched.
     * The ranked lists get the same bar as the distributions — a count is easier
     * to compare against its neighbours as a length than as a number.
     */
    renderStatsTopLists(s) {
        const esc = (v) => this.dash.escapeHtml(v);

        const rankedList = (title, rows, emptyText, hint) => {
            if (!rows.length) {
                return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(title)}</h3>
                    ${hint ? `<p class="config-panel-note">${esc(hint)}</p>` : ''}
                    <p class="config-panel-empty">${esc(emptyText)}</p>
                </div>`;
            }
            const max = Math.max(...rows.map(([, v]) => Number(v) || 0), 1);
            const items = rows.map(([label, value]) => {
                const n = Number(value) || 0;
                const pct = Math.round((n / max) * 100);
                return `
                    <li class="config-dist-row">
                        <span class="config-dist-label">${esc(label)}</span>
                        <div class="config-bar config-bar--slim" role="img" aria-label="${esc(label)}: ${esc(String(n))}">
                            <span class="config-bar-fill" style="width:${pct}%"></span>
                        </div>
                        <span class="config-dist-count">${esc(String(n))}</span>
                    </li>`;
            }).join('');
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(title)}</h3>
                    ${hint ? `<p class="config-panel-note">${esc(hint)}</p>` : ''}
                    <ul class="config-dist-list">${items}</ul>
                </div>`;
        };

        // Never-opened is a plain list: its second column is a URL, not a count,
        // so there is nothing to scale a bar against.
        const plainList = (title, rows, emptyText, hint) => {
            const items = rows.length
                ? rows.map(([label, sub]) => `
                    <li class="config-crud-row">
                        <div class="config-bm-main">
                            <span class="config-bm-name">${esc(label)}</span>
                            <span class="config-bm-url">${esc(sub)}</span>
                        </div>
                    </li>`).join('')
                : '';
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(title)}</h3>
                    ${hint ? `<p class="config-panel-note">${esc(hint)}</p>` : ''}
                    ${items
                        ? `<ul class="config-crud-list">${items}</ul>`
                        : `<p class="config-panel-empty">${esc(emptyText)}</p>`}
                </div>`;
        };

        return rankedList(this.t('config.statsTopOpened', 'Most opened'), s.topOpened,
                this.t('config.statsNoOpens', 'Nothing has been opened yet.'))
            + rankedList(this.t('config.statsTopTags', 'Most used tags'), s.topTags,
                this.t('config.noTagsYet', 'No tags yet.'))
            + plainList(this.t('config.statsNeverOpenedTitle', 'Never opened'), s.neverOpenedList,
                this.t('config.statsAllOpened', 'Everything has been opened at least once.'),
                this.t('config.statsNeverOpenedHint', 'Candidates to tidy up — they have never been used.'));
    }

    /** Where the bookmarks sit: per page, per category. */
    renderStatsDistributions(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const rows = (pairs) => pairs.map(([label, count]) => {
            const pct = s.total ? Math.round((count / s.total) * 100) : 0;
            return `
                <li class="config-dist-row">
                    <span class="config-dist-label">${esc(label)}</span>
                    <div class="config-bar config-bar--slim" role="img" aria-label="${esc(label)}: ${esc(String(count))}">
                        <span class="config-bar-fill" style="width:${pct}%"></span>
                    </div>
                    <span class="config-dist-count">${esc(String(count))}</span>
                </li>`;
        }).join('');
        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsPerPage', 'Bookmarks per page'))}</h3>
                <ul class="config-dist-list">${rows(s.perPage)}</ul>
            </div>
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsPerCategory', 'Bookmarks per category'))}</h3>
                <ul class="config-dist-list">${rows(s.perCategory)}</ul>
            </div>`;
    }

    /** Link rot and clashes: stale, duplicates, shortcut conflicts. */
    renderStatsRot(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const line = (label, n, hint) => `
            <li class="config-stat-detail${n > 0 ? ' config-stat-detail--warn' : ''}">
                <span>${esc(label)}${hint ? ` — <span class="config-stat-sub">${esc(hint)}</span>` : ''}</span>
                <span class="config-stat-penalty">${esc(String(n))}</span>
            </li>`;
        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsNavRot', 'Link rot & clashes'))}</h3>
                <ul class="config-stat-details">
                    ${line(this.t('config.statsNeverOpened', 'Never opened'), s.neverOpened)}
                    ${line(this.t('config.statsStale90', 'Not opened in 90 days'), s.stale90)}
                    ${line(this.t('config.statsDuplicateUrls', 'Duplicate URLs'), s.duplicateUrls)}
                    ${line(this.t('config.statsShortcutConflicts', 'Shortcut conflicts'), s.shortcutConflicts)}
                    ${line(this.t('config.statsUntagged', 'Untagged'), s.total - s.tagged)}
                </ul>
            </div>`;
    }

    /**
     * Everything derivable from the shell's own bookmark/page copies, including
     * the cleanup score and the activity buckets.
     */
    computeStats() {
        const all = this.dash.allBookmarks || [];
        const pages = this.dash.pages || [];
        const total = all.length;

        const tagCounts = new Map();
        const categoryKeys = new Set();
        const perCategoryCount = new Map();
        let withShortcut = 0;
        let monitored = 0;
        let tagged = 0;
        let withNote = 0;
        let withIcon = 0;
        let checked = 0;
        let neverOpened = 0;

        const cutoff90 = Date.now() - 90 * 86400000;
        let stale90 = 0;
        const urlCounts = new Map();
        const shortcutCounts = new Map();

        all.forEach((b) => {
            const tags = Array.isArray(b.tags) ? b.tags : [];
            tags.forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1));
            if (tags.length) tagged += 1;
            if (b.category) {
                categoryKeys.add(`${b.pageId}::${b.category}`);
                perCategoryCount.set(b.category, (perCategoryCount.get(b.category) || 0) + 1);
            }
            if (b.shortcut) withShortcut += 1;
            if (b.monitor === true) monitored += 1;
            if (String(b.note || '').trim()) withNote += 1;
            if (String(b.icon || '').trim()) withIcon += 1;
            if (b.checkStatus === true || b.monitor === true) checked += 1;

            const opens = Number(b.openCount || 0);
            const last = Number(b.lastOpened || 0);
            if (!opens && !last) neverOpened += 1;
            if (last > 0 && last < cutoff90) stale90 += 1;

            const url = String(b.url || '').trim().toLowerCase();
            if (url) urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
            const sc = String(b.shortcut || '').trim().toLowerCase();
            if (sc) shortcutCounts.set(sc, (shortcutCounts.get(sc) || 0) + 1);
        });

        const duplicateUrls = [...urlCounts.values()].filter((c) => c > 1).length;
        const shortcutConflicts = [...shortcutCounts.values()].filter((c) => c > 1).length;

        const catLabels = new Map(this.knownCategories().map((c) => [c.id, c.label]));
        const perCategory = [...perCategoryCount.entries()]
            .map(([id, n]) => [catLabels.get(id) || id, n])
            .sort((a, b) => b[1] - a[1]);

        const perPage = pages.map((p) => [
            p.name || String(p.id),
            all.filter((b) => String(b.pageId) === String(p.id)).length,
        ]);

        const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        const topOpened = all
            .filter((b) => Number(b.openCount || 0) > 0)
            .sort((a, b) => Number(b.openCount || 0) - Number(a.openCount || 0))
            .slice(0, 10)
            .map((b) => [b.name || b.url, Number(b.openCount || 0)]);
        const neverOpenedList = all
            .filter((b) => !Number(b.openCount || 0) && !Number(b.lastOpened || 0))
            .slice(0, 10)
            .map((b) => [b.name || b.url, b.url]);

        return {
            total,
            pages: pages.length,
            categories: categoryKeys.size,
            tagCount: tagCounts.size,
            withShortcut,
            monitored,
            tagged,
            withNote,
            withIcon,
            checked,
            neverOpened,
            stale90,
            duplicateUrls,
            shortcutConflicts,
            perPage,
            perCategory,
            topTags,
            topOpened,
            neverOpenedList,
            cleanup: this.computeCleanupScore(all, { neverOpened, stale90, duplicateUrls, shortcutConflicts }),
            activity: this.computeActivity(all),
        };
    }

    /** The old config's scoring weights, kept identical so the number carries over. */
    computeCleanupScore(all, { neverOpened, stale90, duplicateUrls, shortcutConflicts }) {
        const total = all.length;
        if (!total) return { score: 0, details: [] };

        let score = 100;
        const details = [];

        const neverRatio = neverOpened / total;
        const neverPenalty = Math.round(Math.min(neverRatio * 50, 25));
        if (neverPenalty > 0) {
            score -= neverPenalty;
            details.push({
                type: 'warn',
                penalty: neverPenalty,
                text: this.t('config.statsScoreNeverOpenedView', '{count} bookmarks never opened ({pct}%)')
                    .replace('{count}', String(neverOpened)).replace('{pct}', String(Math.round(neverRatio * 100))),
            });
        }

        const staleRatio = stale90 / total;
        const stalePenalty = Math.round(Math.min(staleRatio * 40, 20));
        if (stalePenalty > 0) {
            score -= stalePenalty;
            details.push({
                type: 'warn',
                penalty: stalePenalty,
                text: this.t('config.statsScoreStale90View', '{count} not opened in 90 days ({pct}%)')
                    .replace('{count}', String(stale90)).replace('{pct}', String(Math.round(staleRatio * 100))),
            });
        }

        if (duplicateUrls > 0) {
            const pen = Math.min(duplicateUrls * 3, 15);
            score -= pen;
            details.push({
                type: 'bad',
                penalty: pen,
                text: this.t('config.statsScoreDupUrlsView', '{count} duplicate URLs')
                    .replace('{count}', String(duplicateUrls)),
            });
        }

        if (shortcutConflicts > 0) {
            const pen = Math.min(shortcutConflicts * 5, 10);
            score -= pen;
            details.push({
                type: 'bad',
                penalty: pen,
                text: this.t('config.statsScoreConflictsView', '{count} shortcut conflicts')
                    .replace('{count}', String(shortcutConflicts)),
            });
        }

        score = Math.max(0, Math.min(100, score));
        if (!details.length) {
            details.push({ type: 'good', text: this.t('config.statsScoreHealthy', 'Nothing to clean up — everything looks healthy.') });
        }
        return { score, details };
    }

    /**
     * Opens bucketed over the chosen range. Buckets are days for a week or a
     * month and weeks beyond that, so the bar count stays readable.
     */
    computeActivity(all) {
        const days = this.statsRange || 30;
        const now = Date.now();
        const DAY = 86400000;
        const bucketDays = days <= 30 ? 1 : (days <= 90 ? 7 : 30);
        const bucketCount = Math.max(1, Math.round(days / bucketDays));
        const buckets = new Array(bucketCount).fill(0);
        const cutoff = now - days * DAY;

        all.forEach((b) => {
            const last = Number(b.lastOpened || 0);
            if (!last || last < cutoff) return;
            const age = now - last;
            const idx = bucketCount - 1 - Math.min(bucketCount - 1, Math.floor(age / (bucketDays * DAY)));
            buckets[idx] += Math.max(1, Number(b.openCount || 1));
        });

        const labels = buckets.map((_, i) => {
            const agoBuckets = bucketCount - 1 - i;
            if (agoBuckets === 0) return this.t('config.statsSparklineToday', 'now');
            const agoDays = agoBuckets * bucketDays;
            return this.t('config.statsSparklineDaysAgoView', '{n}d ago').replace('{n}', String(agoDays));
        });

        const activeCount = all.filter((b) => Number(b.lastOpened || 0) >= cutoff).length;
        const totalOpens = buckets.reduce((a, b) => a + b, 0);

        // Compare the latter half of the range with the former, which is what the
        // old tab's week-over-week figure did for a 7-day window.
        const half = Math.floor(bucketCount / 2);
        let wow = null;
        if (half > 0) {
            const prev = buckets.slice(0, half).reduce((a, b) => a + b, 0);
            const recent = buckets.slice(bucketCount - half).reduce((a, b) => a + b, 0);
            if (prev > 0) wow = Math.round(((recent - prev) / prev) * 100);
            else if (recent > 0) wow = 100;
        }

        return { buckets, labels, activeCount, totalOpens, wow, bucketDays };
    }

    renderStatsHealth() {
        const esc = (v) => this.dash.escapeHtml(v);
        const h = this._statsHealth;
        if (h === undefined) {
            return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        }
        if (h === null) {
            return `<p class="config-panel-empty">${esc(this.t('config.statsHealthUnavailable', 'Health data is not available.'))}</p>`;
        }
        const total = Math.max(1, h.healthy + h.broken + h.unchecked);
        const pct = Math.round((h.healthy / total) * 100);
        const line = (label, n, tone) => `
            <li class="config-stat-detail${tone ? ' config-stat-detail--' + tone : ''}">
                <span>${esc(label)}</span>
                <span class="config-stat-penalty">${esc(String(n))}</span>
            </li>`;
        return `
            <div class="config-ratio">
                <div class="config-ratio-head">
                    <span class="config-ratio-label">${esc(this.t('config.statsHealthy', 'Healthy'))}</span>
                    <span class="config-ratio-value">${pct}%</span>
                </div>
                <div class="config-bar" role="img" aria-label="${esc(this.t('config.statsHealthy', 'Healthy'))}: ${pct}%">
                    <span class="config-bar-fill config-bar-fill--good" style="width:${pct}%"></span>
                </div>
            </div>
            <ul class="config-stat-details">
                ${line(this.t('config.statsHealthy', 'Healthy'), h.healthy, 'good')}
                ${line(this.t('config.statsBroken', 'Broken'), h.broken, h.broken ? 'bad' : '')}
                ${line(this.t('config.statsMonitorDown', 'Monitors down'), h.monitorDown, h.monitorDown ? 'bad' : '')}
                ${line(this.t('config.statsUnchecked', 'Unchecked'), h.unchecked)}
                ${line(this.t('config.statsStale', 'Stale'), h.stale, h.stale ? 'warn' : '')}
                ${line(this.t('config.statsDuplicates', 'Duplicates'), h.duplicates, h.duplicates ? 'warn' : '')}
                ${line(this.t('config.statsShortcutConflicts', 'Shortcut conflicts'), h.shortcutConflicts, h.shortcutConflicts ? 'warn' : '')}
            </ul>`;
    }

    /**
     * The health endpoint already aggregates the counts, so read its summary
     * rather than re-deriving them from the issue list (which only carries the
     * bookmarks that have something wrong with them).
     */
    async loadStats() {
        try {
            const res = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/bookmark-health');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const sum = data?.summary;
            if (!sum) throw new Error('no summary');
            this._statsHealth = {
                healthy: sum.healthyCount || 0,
                broken: sum.brokenCount || 0,
                unchecked: sum.uncheckedCount || 0,
                monitorDown: sum.monitorDownCount || 0,
                duplicates: sum.duplicateCount || 0,
                stale: sum.staleCount || 0,
                shortcutConflicts: sum.shortcutConflictCount || 0,
            };
        } catch {
            this._statsHealth = null;
        }
        if (this.isActiveView() && this.section === 'stats') {
            const host = document.getElementById('config-stats-health');
            if (host) host.innerHTML = this.renderStatsHealth();
        }
    }

    bindStats(container) {
        container.querySelectorAll('[data-stats-range]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = Number(btn.getAttribute('data-stats-range'));
                if (!next || next === this.statsRange) return;
                this.statsRange = next;
                this.repaintStats();
            });
        });
        container.querySelectorAll('[data-stats-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.getAttribute('data-stats-action') === 'export') this.exportStatsCSV();
            });
        });
    }

    /** Repaint the whole section: the range change feeds nearly every panel. */
    repaintStats() {
        if (!this.isActiveView() || this.section !== 'stats') return;
        const body = document.getElementById('config-view-body');
        if (!body) return;
        body.innerHTML = this.renderStats();
        const container = document.getElementById('dashboard-layout');
        if (container) this.bindStats(container);
    }

    /** The report as a flat CSV, so it can be worked through in a spreadsheet. */
    exportStatsCSV() {
        const s = this.computeStats();
        const rows = [
            ['metric', 'value'],
            ['bookmarks', s.total],
            ['pages', s.pages],
            ['categories', s.categories],
            ['distinct_tags', s.tagCount],
            ['tagged', s.tagged],
            ['with_shortcut', s.withShortcut],
            ['with_note', s.withNote],
            ['with_icon', s.withIcon],
            ['availability_checked', s.checked],
            ['monitored', s.monitored],
            ['never_opened', s.neverOpened],
            ['stale_90_days', s.stale90],
            ['duplicate_urls', s.duplicateUrls],
            ['shortcut_conflicts', s.shortcutConflicts],
            ['cleanup_score', s.cleanup.score],
        ];
        s.perPage.forEach(([name, n]) => rows.push([`page:${name}`, n]));
        s.perCategory.forEach(([name, n]) => rows.push([`category:${name}`, n]));
        s.topTags.forEach(([tag, n]) => rows.push([`tag:${tag}`, n]));

        const esc = (v) => {
            const str = String(v ?? '');
            return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        };
        const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
        this.triggerDownload(new Blob([csv], { type: 'text/csv' }),
            `nextdash-stats-${new Date().toISOString().slice(0, 10)}.csv`);
    }

    /* ── Help (native) ─────────────────────────────────────────────────────── */

    renderHelp() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tips = this.helpTips().map((tip) => `<li class="config-help-tip">${tip}</li>`).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.helpIntro', 'Shortcuts, tips, and where to find more.'))}</p>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.helpWhatsNewTitle', 'What’s new'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.helpWhatsNewHint', 'See what changed in the most recent releases.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-help-action="whats-new">${esc(this.t('config.showWhatsNew', 'Show what’s new'))}</button>
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.helpShortcutsTitle', 'Keyboard shortcuts'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.helpShortcutsHint', 'The cheat sheet lists every shortcut, including the ones you have rebound.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-help-action="cheatsheet">${esc(this.t('config.openCheatSheet', 'Open the cheat sheet'))}</button>
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.helpTipsTitle', 'Tips & tricks'))}</h3>
                <ul class="config-help-tips">${tips}</ul>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.helpAboutTitle', 'About nextDash'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.helpAboutText', 'nextDash is a self-hosted, keyboard-first bookmark dashboard.'))}</p>
                <div class="config-actions">
                    <a class="config-btn" href="https://github.com/jordibrouwer/nextDash" target="_blank" rel="noopener noreferrer">${esc(this.t('config.helpGithub', 'Project on GitHub'))}</a>
                </div>
            </div>
        `;
    }

    /**
     * The same tips the dashboard shows as occasional toasts. Kept as escaped
     * strings with a single <kbd> per line so a key reads as a key.
     */
    helpTips() {
        const esc = (v) => this.dash.escapeHtml(v);
        const kbd = (k, text) => `<kbd>${esc(k)}</kbd> — ${esc(text)}`;
        return [
            kbd('>', this.t('config.tipSearch', 'Open search')),
            kbd(':', this.t('config.tipCommands', 'Open the command palette')),
            kbd('?', this.t('config.tipFinders', 'Open finders')),
            kbd('!', this.t('config.tipCheatsheet', 'Open the keyboard cheat sheet')),
            kbd('+', this.t('config.tipAddBookmark', 'Add a bookmark')),
            kbd('.', this.t('config.tipCollapseAll', 'Collapse or expand every category')),
            kbd('Shift + H', this.t('config.tipHealth', 'Open the health view')),
            kbd('Shift + I', this.t('config.tipInbox', 'Open the inbox')),
        ];
    }

    bindHelp(container) {
        container.querySelectorAll('[data-help-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-help-action');
                if (action === 'whats-new') {
                    void this.openWhatsNew();
                } else if (action === 'cheatsheet') {
                    // The cheat sheet is a dashboard overlay, so leave the config
                    // view first or it would open behind it.
                    this.closeConfigView();
                    this.dash.showKeyboardCheatSheet?.();
                }
            });
        });
    }
}

window.DashboardConfig = DashboardConfig;
