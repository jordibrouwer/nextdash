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
        'appearance',
        'behavior',
        'data-backups',
    ];

    constructor(dashboard) {
        this.dash = dashboard;
        this.section = 'overview';
        this.loading = false;
        this._loadPromise = null;
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
            appearance: ['config.sectionAppearance', 'Appearance'],
            behavior: ['config.sectionBehavior', 'Behavior'],
            'data-backups': ['config.sectionDataBackups', 'Data & backups'],
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
        this.bindSectionNav(container);
        this.bindTileActions(container);
        if (this.section === 'overview') {
            void this.loadOverviewData();
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

    renderOverview() {
        const tiles = this.overviewTiles().map((t) => this.renderTile(t)).join('');
        const intro = this.dash.escapeHtml(
            this.t('config.overviewIntro', 'A snapshot of your setup. Tiles that need attention link straight to the view that fixes them.')
        );
        return `
            <p class="config-view-intro">${intro}</p>
            <div class="config-tiles" role="list">${tiles}</div>
        `;
    }

    /** Refresh the health report, then repaint the tiles if still on overview. */
    async loadOverviewData() {
        const d = this.dash;
        if (!d.health?.fetchReport) return;
        try {
            await d.health.fetchReport();
        } catch {
            return;
        }
        if (this.isActiveView() && this.section === 'overview') {
            const body = document.getElementById('config-view-body');
            if (body) {
                body.innerHTML = this.renderOverview();
                const container = document.getElementById('dashboard-layout');
                if (container) this.bindTileActions(container);
            }
        }
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
}

window.DashboardConfig = DashboardConfig;
