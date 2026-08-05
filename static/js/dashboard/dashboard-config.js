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
        'bookmarks',
        'appearance',
        'pages-tags',
        'behavior',
        'data-backups',
        'stats',
        'help',
    ];

    /** Device-local last config section (and sub-tab) for Shift+S / `<` return visits. */
    static CONFIG_LAST_KEY = 'nextdash:config-last-location-v1';

    /**
     * The activity chart's range, remembered per browser.
     *
     * The sub-tab you were on already survives a visit (SUB_TAB_STATE, via the
     * hash), so returning to Statistics and finding the chart snapped back to 30
     * days was the odd one out. Kept in localStorage rather than settings: it is
     * a view preference, not data worth a write to the server on every click.
     */
    static STATS_RANGE_KEY = 'nextdash:config-stats-range-v1';

    constructor(dashboard) {
        this.dash = dashboard;
        this.section = 'overview';
        this.loading = false;
        this._loadPromise = null;
        // Pages & tags sub-tab (finders/tags/collections native; pages/categories embedded).
        this.ptTab = 'categories';
        // Appearance sub-tab.
        this.appearanceTab = 'general';
        this._finders = null;
        // Behavior sub-tab.
        this.behaviorTab = 'general';
        // Help sub-tab.
        this.helpTab = 'start';
        // Bookmarks section: search, filters, sort, the row being edited, the
        // ticked rows for bulk actions, and whether the open editor has unsaved
        // changes (so Save can be offered rather than saving on every keystroke).
        this.bmQuery = '';
        this.bmPageFilter = '';
        this.bmCategoryFilter = '';
        // A named cleanup filter arrived at from Statistics ('untagged', …).
        // Empty means the list is unfiltered by it.
        this.bmCleanupFilter = '';
        this.bmTagFilter = [];
        this.bmSort = 'page';
        this.bmVisibleLimit = DashboardConfig.BM_PAGE_SIZE;
        this.bmEditing = null;
        this.bmDirty = false;
        this.bmSelected = new Set();
        /** Rows with an in-flight network action (recheck, favicon refresh, …). */
        this._bmBusyKeys = new Set();
        /** Per-page category lists for the bookmarks section dropdowns. */
        this._bmCategoriesCache = new Map();
        // Statistics: undefined while the health fetch is in flight, null on failure.
        this._statsHealth = undefined;
        // How far back the activity chart looks, in days. Restored from the last
        // visit, falling back to 30.
        this.statsRange = DashboardConfig.readStoredStatsRange();
        // Statistics sub-tab.
        this.statsTab = 'overview';
        // Data & backups sub-tab.
        this.dbTab = 'backups';
        // Inbox stats load on demand; undefined means "not fetched yet".
        this._statsInboxItems = undefined;
        this._statsInboxAgg = undefined;
        this._statsFinders = undefined;
        // Latest release for the overview: undefined until fetched, null on failure.
        this._latestRelease = undefined;
        /** Which spotlight is showing in the overview New features carousel. */
        this.overviewFeatureIndex = 0;
        // Pages & tags CRUD list row highlighted via ↑/↓ (health/inbox feed pattern).
        this._listKeyboardKey = null;
        // Bookmarks master list row highlighted via j/k.
        this._bmKeyboardKey = null;
        /** Restores keyboard focus on this row after the add/edit modal closes. */
        this._bmModalRestoreKey = null;
        this._bmSearchTimer = null;
        this._bmLoadMoreObserver = null;
        /** Cached URL set for duplicate detection — rebuilt when the list repaints. */
        this._bmDuplicateUrls = null;
        /** Cached field labels seen while browsing config — merged into settings jump. */
        this._settingsJumpCache = new Map();
        this._settingsJumpHandler = null;
        this._settingsJumpSelected = 0;
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
     * Report a config interaction, mirroring the inbox's `_trackAction`.
     *
     * Props stay low-cardinality per the rules in umami-analytics.js: section
     * and tab ids are a fixed enum, and setting *names* are a fixed enum too.
     * Setting *values* are not reported — a webhook URL or dashboard title is
     * free text, and some of it is personal.
     */
    _trackAction(action, extra) {
        window.nextdashTrack?.('config:' + action, extra);
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
        // Some locale entries are stored as a literal dotted key inside a
        // section ("config": { "layoutPresetName.default": … }). The shared
        // resolver splits on every dot, so it walks past them and never matches.
        const split = key.indexOf('.');
        if (split > 0) {
            const section = d.language?.translations?.[key.slice(0, split)];
            const flat = section?.[key.slice(split + 1)];
            if (typeof flat === 'string' && flat) {
                return flat;
            }
        }
        return fallback != null ? fallback : key;
    }

    /* ── Hash / deep linking ───────────────────────────────────────────────── */

    /** True for `#config` with no section — “open config”, not “open Overview”. */
    static isGenericConfigHash(hash) {
        return typeof hash === 'string' && hash.replace(/^#/, '') === 'config';
    }

    /** Normalise a hash like `config/appearance` into a known section. */
    static sectionFromHash(hash) {
        if (typeof hash !== 'string') return null;
        const raw = hash.replace(/^#/, '');
        if (raw === 'config/behavior/layout') return 'appearance';
        if (raw === 'config/behavior/display') return 'appearance';
        if (raw === 'config') return 'overview';
        // A trailing /<tab> is optional and handled by subTabFromHash.
        const match = raw.match(/^config\/([a-z-]+)(?:\/([a-z-]+))?$/);
        if (!match) return null;
        return DashboardConfig.SECTIONS.includes(match[1]) ? match[1] : 'overview';
    }

    /**
     * The sub-tab named by a #config/<section>/<tab> hash.
     *
     * Sections with sub-tabs are otherwise only reachable at their first tab, so
     * a link to something like Behavior → Privacy could not be given out at all.
     * Returns null when the hash names no tab, or one the section does not have.
     */
    static subTabFromHash(hash) {
        if (typeof hash !== 'string') return null;
        const raw = hash.replace(/^#/, '');
        if (raw === 'config/behavior/layout') return 'layout';
        if (raw === 'config/behavior/display') return 'display';
        const match = raw.match(/^config\/([a-z-]+)\/([a-z-]+)$/);
        if (!match || match[1] === 'bookmarks') return null;
        const tabs = DashboardConfig.SUB_TABS[match[1]];
        return tabs && tabs.includes(match[2]) ? match[2] : null;
    }

    /** Page filter encoded as `#config/bookmarks/<pageId>`. */
    static bookmarksPageFromHash(hash) {
        if (typeof hash !== 'string') return null;
        const match = hash.replace(/^#/, '').match(/^config\/bookmarks\/([^/]+)$/);
        return match ? decodeURIComponent(match[1]) : null;
    }

    /** Composite category filter value when scoping to a page. */
    static categoryFilterKey(pageId, categoryId) {
        if (!categoryId) return '';
        return pageId ? `${pageId}::${categoryId}` : String(categoryId);
    }

    static parseCategoryFilter(value) {
        const raw = String(value || '');
        if (!raw) return { pageId: null, categoryId: '' };
        const idx = raw.indexOf('::');
        if (idx < 0) return { pageId: null, categoryId: raw };
        return { pageId: raw.slice(0, idx), categoryId: raw.slice(idx + 2) };
    }

    /**
     * Sub-tab lists per section, resolved on demand.
     *
     * A getter rather than a static field: the *_TABS constants are declared
     * further down the class body, and static fields initialise in source
     * order, so reading them here would give undefined.
     */
    static get SUB_TABS() {
        return {
            behavior: DashboardConfig.BEHAVIOR_TABS,
            'pages-tags': DashboardConfig.PT_TABS,
            appearance: DashboardConfig.APPEARANCE_TABS,
            stats: DashboardConfig.STATS_TABS,
            'data-backups': DashboardConfig.DB_TABS,
            help: DashboardConfig.HELP_TABS,
        };
    }

    /** Which sub-tab list belongs to which section, and where it is stored. */
    static SUB_TAB_STATE = {
        behavior: 'behaviorTab',
        'pages-tags': 'ptTab',
        appearance: 'appearanceTab',
        stats: 'statsTab',
        'data-backups': 'dbTab',
        help: 'helpTab',
    };

    /**
     * Sub-tab strip attribute → section id, so a tracked tab switch is reported
     * under the same section name the rail and the hash use. Without this the
     * analytics would say 'data-pt-tab' where every other event says
     * 'pages-tags'.
     */
    static SUB_TAB_SECTION = {
        'data-behavior-tab': 'behavior',
        'data-pt-tab': 'pages-tags',
        'data-appearance-tab': 'appearance',
        'data-stats-tab': 'stats',
        'data-db-tab': 'data-backups',
        'data-help-tab': 'help',
    };

    /** data-* attribute on each section's sub-tab strip buttons. */
    static SUB_TAB_ATTR = {
        behavior: 'data-behavior-tab',
        'pages-tags': 'data-pt-tab',
        appearance: 'data-appearance-tab',
        stats: 'data-stats-tab',
        'data-backups': 'data-db-tab',
        help: 'data-help-tab',
    };

    /** Apply a sub-tab from the hash, if the section has one. */
    applySubTabFromHash(hash) {
        const section = DashboardConfig.sectionFromHash(hash);
        const tab = DashboardConfig.subTabFromHash(hash);
        const prop = DashboardConfig.SUB_TAB_STATE[section];
        if (!tab || !prop) return false;
        // A sub-tab named in the URL is as deliberate as clicking one, so a
        // promo's ensureSubTab must not steer away from it.
        window.ConfigSettingPromo?.markSubTabChosen?.();
        if (this[prop] === tab) return false;
        this[prop] = tab;
        return true;
    }

    applyBookmarksPageFromHash(hash) {
        const section = DashboardConfig.sectionFromHash(hash);
        if (section !== 'bookmarks') return false;
        const pageId = DashboardConfig.bookmarksPageFromHash(hash);
        if (pageId == null) {
            if (!this.bmPageFilter) return false;
            this.bmPageFilter = '';
            return true;
        }
        if (String(this.bmPageFilter) === String(pageId)) return false;
        this.bmPageFilter = pageId;
        return true;
    }

    hashForSection(section) {
        if (!section || section === 'overview') return 'config';
        if (section === 'bookmarks' && this.bmPageFilter) {
            return `config/bookmarks/${encodeURIComponent(this.bmPageFilter)}`;
        }
        // Keep the sub-tab in the URL so the address bar is a link you can
        // actually hand to someone.
        const prop = DashboardConfig.SUB_TAB_STATE[section];
        const tab = prop ? this[prop] : null;
        const tabs = DashboardConfig.SUB_TABS[section];
        if (tab && tabs && tabs.includes(tab) && tab !== tabs[0]) {
            return `config/${section}/${tab}`;
        }
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

    /** Read the last config section/sub-tab saved when leaving via Shift+H or Shift+I. */
    loadLastConfigLocation() {
        try {
            const raw = localStorage.getItem(DashboardConfig.CONFIG_LAST_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            const section = data?.section;
            if (!section || !DashboardConfig.SECTIONS.includes(section)) return null;
            let subTab = data?.subTab ?? null;
            if (section === 'behavior' && (subTab === 'layout' || subTab === 'display')) {
                return { section: 'appearance', subTab };
            }
            if (subTab) {
                const tabs = DashboardConfig.SUB_TABS[section];
                if (!tabs?.includes(subTab)) subTab = null;
            }
            return { section, subTab };
        } catch {
            return null;
        }
    }

    /**
     * Fetch what a Statistics tab needs, once.
     *
     * Three tabs each own an endpoint that is of no use to the others, and the
     * "have I fetched this yet" check was repeated at four call sites — the tab
     * strip, the jump buttons, the sub-tab router and the section open. Health
     * was missing from three of them and so was fetched eagerly on every visit
     * instead; keeping the rule in one place is what stops that recurring.
     */
    loadStatsTabData(tab) {
        if (tab === 'inbox' && this._statsInboxItems === undefined) void this.loadStatsInbox();
        if (tab === 'activity' && this._statsFinders === undefined) void this.loadStatsFinders();
        if (tab === 'health' && this._statsHealth === undefined) void this.loadStatsHealth();
    }

    /**
     * The stored activity range, or the 30-day default.
     *
     * Validated against STATS_RANGES rather than trusted: a stale or hand-edited
     * value would otherwise reach computeActivity() and bucket against a range
     * with no button to switch away from it.
     */
    static readStoredStatsRange() {
        try {
            const raw = Number(localStorage.getItem(DashboardConfig.STATS_RANGE_KEY));
            return DashboardConfig.STATS_RANGES.includes(raw) ? raw : 30;
        } catch {
            return 30;
        }
    }

    saveStatsRange(days) {
        try {
            localStorage.setItem(DashboardConfig.STATS_RANGE_KEY, String(days));
        } catch {
            // localStorage unavailable — the range still applies for this visit
        }
    }

    /** Remember where the user left config — only when exiting via Shift+H or Shift+I. */
    saveLastConfigLocation() {
        try {
            const section = this.section;
            if (!DashboardConfig.SECTIONS.includes(section)) return;
            const prop = DashboardConfig.SUB_TAB_STATE[section];
            const subTab = prop ? this[prop] : null;
            localStorage.setItem(DashboardConfig.CONFIG_LAST_KEY, JSON.stringify({
                section,
                subTab: subTab || null,
            }));
        } catch {
            // localStorage unavailable — skip silently
        }
    }

    /** Drop stored config location so the next visit starts on Overview. */
    clearLastConfigLocation() {
        try {
            localStorage.removeItem(DashboardConfig.CONFIG_LAST_KEY);
        } catch {
            // localStorage unavailable — skip silently
        }
    }

    applyStoredSubTab(section, tab) {
        const prop = DashboardConfig.SUB_TAB_STATE[section];
        const tabs = DashboardConfig.SUB_TABS[section];
        if (!prop || !tabs?.includes(tab)) return false;
        this[prop] = tab;
        return true;
    }

    /**
     * Section (and optional sub-tab) when opening config without an explicit
     * target or `#config/…` hash — e.g. Shift+S from the bookmark grid.
     *
     * Saved location (Shift+H / Shift+I) applies when returning from health
     * or inbox via Shift+S. Cold load to bare `#config` is handled in
     * dashboard-data.js before the lazy module loads. Opening config from
     * bookmarks with a page hash (#1) always lands on Overview.
     */
    resolveConfigOpenTarget(explicitSection) {
        const hash = window.location.hash;
        const hashIsGeneric = DashboardConfig.isGenericConfigHash(hash);
        const hashSection = hashIsGeneric ? null : DashboardConfig.sectionFromHash(hash);
        const saved = (!explicitSection && !hashSection) ? this.loadLastConfigLocation() : null;
        let stored = null;
        if (saved?.section) {
            const fromView = this.dash.activeView;
            if (fromView === 'health' || fromView === 'inbox') {
                stored = saved;
            }
        }
        const targetSection = explicitSection || hashSection || stored?.section || 'overview';

        if (!hashIsGeneric && hashSection === targetSection) {
            this.applySubTabFromHash(hash);
        } else if (!explicitSection && stored?.section === targetSection && stored.subTab) {
            this.applyStoredSubTab(targetSection, stored.subTab);
        }

        return targetSection;
    }

    /** Re-apply the section from the hash while the view is already open. */
    restoreConfigSectionFromHash() {
        const hash = window.location.hash;
        if (DashboardConfig.isGenericConfigHash(hash)) {
            const stored = this.loadLastConfigLocation();
            if (stored?.section) {
                if (stored.subTab) {
                    this.applyStoredSubTab(stored.section, stored.subTab);
                }
                if (stored.section !== this.section) {
                    this.section = stored.section;
                    this.render();
                } else if (stored.subTab) {
                    this.render();
                }
                this.restoreConfigHash();
                return;
            }
            if (this.section !== 'overview') {
                this.section = 'overview';
                this.render();
            }
            this.restoreConfigHash();
            return;
        }
        const section = DashboardConfig.sectionFromHash(hash);
        const tabChanged = this.applySubTabFromHash(window.location.hash);
        const pageChanged = this.applyBookmarksPageFromHash(hash);
        if (section && section !== this.section) {
            this.section = section;
            this.render();
        } else if (tabChanged || pageChanged) {
            this.render();
        }
        // Rewrite to the canonical hash: the legacy `#config/behavior/layout`
        // and `/display` links resolve to Appearance, and without this the old
        // address stayed in the bar — so copying the URL handed on a dead link.
        this.restoreConfigHash();
    }

    /* ── View lifecycle ────────────────────────────────────────────────────── */

    async openConfigView(section) {
        const d = this.dash;
        if (!this.isEnabled()) {
            return false;
        }
        const targetSection = this.resolveConfigOpenTarget(section);
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
        this.clearListKeyboardSelection();
        this.clearBookmarkKeyboardSelection();
        this.section = targetSection;
        this.applyBookmarksPageFromHash(window.location.hash);
        d.setActiveView(DashboardConfig.VIEW);
        window.nextdashTrack?.('view:config');
        d.pageNav?.setActiveConfigTab?.();
        d.pageNav?.updateDocumentTitle?.();
        d.pageNav?.updatePageTitle?.();
        await this.loadAndRender();
        this.restoreConfigHash();
        requestAnimationFrame(() => window.DashboardKeyboardTip?.showConfigIntro?.());
        return true;
    }

    closeConfigView() {
        const d = this.dash;
        if (d.activeView !== DashboardConfig.VIEW) {
            return false;
        }
        // Escape and other non–Shift+H/I exits start fresh on Overview next time.
        this.clearLastConfigLocation();
        // The save indicator lives on <body>, so leaving the view has to take it
        // down; otherwise a "Saved" would linger over the dashboard.
        clearTimeout(this._saveStateTimer);
        document.getElementById('config-save-state')?.remove();
        const finishRestore = () => {
            const restored = d.pageNav?.restoreBookmarksViewForPage?.(d.currentPageId) ?? false;
            if (restored) {
                d.keyboardNavigation?.scheduleUpdate?.();
            }
            return restored;
        };
        const pendingSave = this._settingsSavePromise;
        if (pendingSave) {
            void pendingSave.finally(() => {
                finishRestore();
            });
            return true;
        }
        return finishRestore();
    }

    async loadAndRender() {
        // Phase 1 has no async data of its own yet; kept async so later phases can
        // fetch settings/stats here without touching the shell wiring.
        this.render();
    }

    setupEscapeShortcut() {
        const d = this.dash;
        // Escape returns to the bookmarks view, matching health and inbox.
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler, true);
        }
        this._escapeHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (!this.isActiveView()) return;
            // Anything layered over the view takes Escape first. Without this,
            // dismissing a modal opened from config closed config underneath it
            // too, dropping the user on the dashboard instead of back where
            // they were. Health and inbox already guard the same way.
            if (window.DashboardTagCloud?.modalOpen) return;
            if (d.isModalOpen()) return;
            if (window.ConfigSettingPromo?.dismissActive?.({ persist: true })) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            if (d.searchComponent?.isActive()) return;
            if (d.isInlineEditActive()) return;
            if (this.bmEditing) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void this.closeBookmarkEditorFromKeyboard();
                return;
            }
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) {
                return;
            }
            if (this._bmKeyboardKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.clearBookmarkKeyboardSelection();
                return;
            }
            if (this._listKeyboardKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.clearListKeyboardSelection();
                return;
            }
            e.preventDefault();
            // Stop here rather than letting the event bubble on. The tag-filter
            // shortcut listens on document too and registers first, so without
            // this one Escape both closed config and silently cleared an active
            // tag filter — two actions the user only asked for one of. Health
            // and inbox claim the key the same way.
            e.stopImmediatePropagation();
            this.closeConfigView();
        };
        // Capture phase, as in health and inbox: the view-level handler has to
        // see Escape before the bubble-phase shortcuts it needs to pre-empt.
        document.addEventListener('keydown', this._escapeHandler, true);
    }

    /**
     * Mark one button in a sub-tab strip as the current one.
     *
     * Also moves the roving tabindex: a tablist is a single stop in the page's
     * tab order, and Tab from there goes to the panel rather than to the next
     * tab, so only the active button stays focusable.
     */
    syncSubTabStrip(attr, active) {
        document.querySelectorAll(`[${attr}]`).forEach((b) => {
            const on = b.getAttribute(attr) === active;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.setAttribute('tabindex', on ? '0' : '-1');
        });
    }

    /**
     * Mark one button in the section rail as current and keep roving tabindex
     * in sync — the same contract as syncSubTabStrip for the primary nav.
     */
    syncSectionNav(active) {
        document.querySelectorAll('[data-config-section]').forEach((btn) => {
            const on = btn.getAttribute('data-config-section') === active;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
            btn.setAttribute('tabindex', on ? '0' : '-1');
        });
        const panel = document.getElementById('config-section-panel');
        if (panel) {
            panel.setAttribute('aria-labelledby', `config-section-${active}`);
        }
    }

    moveSectionKeyboard(delta) {
        const sections = DashboardConfig.SECTIONS;
        let idx = sections.indexOf(this.section);
        if (idx < 0) idx = 0;
        idx = (idx + delta + sections.length) % sections.length;
        const next = sections[idx];
        if (next === this.section) return false;
        this.selectSection(next, 'keyboard');
        document.querySelector(`[data-config-section="${CSS.escape(next)}"]`)?.focus();
        return true;
    }

    jumpSectionKeyboard(index) {
        const sections = DashboardConfig.SECTIONS;
        const clamped = Math.max(0, Math.min(index, sections.length - 1));
        const next = sections[clamped];
        if (next === this.section) return false;
        this.selectSection(next, 'keyboard');
        document.querySelector(`[data-config-section="${CSS.escape(next)}"]`)?.focus();
        return true;
    }

    /**
     * Pages & tags list rows use ↑/↓ (and g/G while focus sits in the list
     * panel). j/k stay reserved for the section rail unless a row is already
     * keyboard-selected.
     */
    shouldUseListKeyboardNav(target) {
        if (this.section !== 'pages-tags') return false;
        if (this._listKeyboardKey) return true;
        const body = target?.closest?.('#config-pt-body');
        if (!body) return false;
        if (target?.closest?.('.config-sub-tabs, [data-pt-tab]')) return false;
        return this.getListKeyboardRows().length > 0;
    }

    /**
     * Bookmarks master list uses j/k (and g/G while focus sits in the list panel).
     * Section-rail j/k stay reserved unless a row is already keyboard-selected.
     */
    shouldUseBookmarkKeyboardNav(target) {
        if (this.section !== 'bookmarks') return false;
        if (this._bmKeyboardKey) return true;
        const inList = target?.closest?.('#config-bm-list');
        if (inList) return this.getBookmarkKeyboardRows().length > 0;
        if (target?.id === 'config-bm-search') return this.getBookmarkKeyboardRows().length > 0;
        return false;
    }

    /**
     * Config view keyboard handler — section digits and sub-tab shortcuts.
     * Called from keyboard-navigation.js whenever #dashboard-layout carries
     * config-layout.
     */
    handleKeyboardNavigation(e) {
        if (!this.isActiveView() || !this.isEnabled()) return false;
        const d = this.dash;
        if (window.DashboardTagCloud?.modalOpen) return false;
        if (d.isModalOpen?.()) return false;
        if (d.searchComponent?.isActive?.()) return false;
        if (d.isInlineEditActive?.()) return false;

        if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.openSettingsJump();
            return true;
        }

        const target = e.target;
        const tag = target?.tagName;
        const isTagFilter = target?.id === 'config-tag-filter';
        const isBmSearch = target?.id === 'config-bm-search';
        const listNavFromFilter = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ', 'g', 'G']);
        const bmNavFromSearch = new Set(['j', 'k', 'Enter', ' ', 'g', 'G']);
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
            if (!(this.section === 'pages-tags' && isTagFilter && listNavFromFilter.has(e.key))
                && !(this.section === 'bookmarks' && isBmSearch && bmNavFromSearch.has(e.key))) {
                return false;
            }
        }

        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            let subTabDelta = 0;
            const inChoiceControl = Boolean(target?.closest?.('.config-choices, .config-bg-swatches'));
            if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                subTabDelta = e.key === 'ArrowRight' ? 1 : -1;
            } else if (!e.altKey && !inChoiceControl && (e.key === '[' || e.key === ']'
                || e.code === 'BracketLeft' || e.code === 'BracketRight')) {
                subTabDelta = (e.key === ']' || e.code === 'BracketRight') ? 1 : -1;
            }
            if (subTabDelta) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return this.moveSubTab(subTabDelta);
            }
        }

        if (this.shouldUseListKeyboardNav(target) && this.handleListKeyboardNavigation(e)) {
            return true;
        }

        if (this.shouldUseBookmarkKeyboardNav(target) && this.handleBookmarkKeyboardNavigation(e)) {
            return true;
        }

        if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
            && !this.shouldUseListKeyboardNav(target)
            && !this.shouldUseBookmarkKeyboardNav(target)
            && !target?.closest?.('.config-choices, .config-bg-swatches, .config-sub-tabs')) {
            if (e.key === 'j') {
                e.preventDefault();
                e.stopImmediatePropagation();
                return this.moveSectionKeyboard(1);
            }
            if (e.key === 'k') {
                e.preventDefault();
                e.stopImmediatePropagation();
                return this.moveSectionKeyboard(-1);
            }
            if (e.key === 'g') {
                e.preventDefault();
                e.stopImmediatePropagation();
                return this.jumpSectionKeyboard(0);
            }
            if (e.key === 'G') {
                e.preventDefault();
                e.stopImmediatePropagation();
                return this.jumpSectionKeyboard(DashboardConfig.SECTIONS.length - 1);
            }
        }

        if (this.handleShellViewShortcut(e)) {
            return true;
        }

        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey) {
            const d = this.dash;
            // e.code, not e.key — layout-safe, same as dashboard-setup.js.
            if (e.code === 'KeyH' && d.health?.isEnabled?.()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.saveLastConfigLocation();
                void d.health.openHealthView();
                return true;
            }
            if (e.code === 'KeyI' && d.inbox?.isEnabled?.() && d.settings?.inboxShowInPageTabs !== false) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.saveLastConfigLocation();
                void d.inbox.openInboxView();
                return true;
            }
        }

        return false;
    }

    /**
     * Page tabs (1–9) and Inbox (0) work from config too — same as on the
     * bookmark grid — so you can leave without Esc first. Unlike Shift+H/I,
     * these do not remember where you were in config.
     */
    handleShellViewShortcut(e) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
        const d = this.dash;
        if (d.keyboardNavigation?.isGChordActive?.()) return false;

        const key = e.key;
        if (key === '0') {
            if (d.inbox?.isEnabled?.() && d.settings?.inboxShowInPageTabs !== false) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.clearLastConfigLocation();
                void d.inbox.openInboxView();
                return true;
            }
            return false;
        }

        if (key >= '1' && key <= '9') {
            const pageIndex = parseInt(key, 10) - 1;
            if (pageIndex >= d.pages.length) return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            this.clearLastConfigLocation();
            void d.requestPageNavigation(d.pages[pageIndex].id);
            return true;
        }

        return false;
    }

    /** Active sub-tab strip for the current section, if any. */
    getSubTabContext() {
        const section = this.section;
        const tabs = DashboardConfig.SUB_TABS[section];
        const prop = DashboardConfig.SUB_TAB_STATE[section];
        const attr = DashboardConfig.SUB_TAB_ATTR[section];
        if (!tabs?.length || !prop || !attr) return null;
        return { section, tabs, prop, attr, current: this[prop] };
    }

    /**
     * Activate a sub-tab programmatically — mirrors each strip's click handler
     * so keyboard shortcuts do not depend on synthetic clicks.
     */
    switchSubTab(tab, via = 'keyboard') {
        const ctx = this.getSubTabContext();
        if (!ctx || !ctx.tabs.includes(tab) || tab === ctx.current) return false;

        this._trackAction('subtab', { section: ctx.section, tab, via });

        if (ctx.section === 'appearance') {
            void this.switchAppearanceTab(tab).then(() => {
                document.querySelector(`[${ctx.attr}="${CSS.escape(tab)}"]`)?.focus();
            });
            return true;
        }

        this[ctx.prop] = tab;
        this.restoreConfigHash();

        const container = document.getElementById('dashboard-layout');
        switch (ctx.section) {
            case 'behavior': {
                const body = document.getElementById('config-behavior-body');
                if (!body) {
                    this.render();
                    break;
                }
                body.innerHTML = this.renderBehaviorBody();
                if (container) {
                    this.bindControlPanels(container, 'behavior');
                    this.bindBehaviorActions(container);
                    this.bindFormKeyboard(container);
                }
                break;
            }
            case 'pages-tags':
                this.clearListKeyboardSelection();
                this.repaintPtBody();
                break;
            case 'data-backups': {
                const body = document.getElementById('config-db-body');
                if (body) {
                    body.innerHTML = this.renderDbTab();
                    this.bindDataBackupsActions(body);
                }
                break;
            }
            case 'stats':
                this.loadStatsTabData(tab);
                this.repaintStatsBody();
                break;
            case 'help': {
                const body = document.getElementById('config-help-body');
                if (!body) {
                    this.render();
                    break;
                }
                body.innerHTML = this.renderHelpBody();
                this.bindHelpActions(body);
                break;
            }
            default:
                return false;
        }

        this.syncSubTabStrip(ctx.attr, tab);
        const focusTarget = document.querySelector(`[${ctx.attr}="${CSS.escape(tab)}"]`);
        focusTarget?.focus();
        if (focusTarget && !focusTarget.isConnected) {
            document.querySelector(`[${ctx.attr}="${CSS.escape(tab)}"]`)?.focus();
        }
        return true;
    }

    /** Wrap to previous/next sub-tab in the current section. */
    moveSubTab(delta) {
        const ctx = this.getSubTabContext();
        if (!ctx) return false;
        const idx = ctx.tabs.indexOf(ctx.current);
        if (idx < 0) return false;
        const next = ctx.tabs[(idx + delta + ctx.tabs.length) % ctx.tabs.length];
        return this.switchSubTab(next, 'keyboard');
    }

    /**
     * Wire a `role="tablist"` strip: click plus the keys the role promises.
     *
     * These strips carried role="tab" and aria-selected but no key handling, so
     * a screen reader announced a tab widget and then the standard keys did
     * nothing. Arrow keys move (wrapping), Home/End jump to the ends, and each
     * lands on a real tab — matching the ARIA tabs pattern.
     *
     * @param {Element} container scope to bind within
     * @param {string} attr data attribute naming the tab, e.g. 'data-pt-tab'
     * @param {(tab: string) => void} activate called with the newly chosen tab
     */
    bindSubTabStrip(container, attr, activate) {
        const buttons = [...container.querySelectorAll(`[${attr}]`)];
        // Every sub-tab strip is bound here, so reporting the switch in this one
        // place covers all six sections — and keeps click and keyboard
        // distinguishable, which is the point of having added the key handling.
        const strip = DashboardConfig.SUB_TAB_SECTION[attr] || attr;
        const activateTracked = (tab, via) => {
            if (tab) this._trackAction('subtab', { section: strip, tab, via });
            activate(tab);
        };
        buttons.forEach((btn, i) => {
            // Mirror the label into data-label so CSS can lay the tab out at its
            // bold width even when it is not the active one. Without it the
            // strip re-measured on every click and could wrap to a second row.
            if (!btn.hasAttribute('data-label')) {
                btn.setAttribute('data-label', btn.textContent.trim());
            }
            btn.addEventListener('click', () => activateTracked(btn.getAttribute(attr), 'click'));
            btn.addEventListener('keydown', (e) => {
                const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
                if (!keys.includes(e.key)) return;
                e.preventDefault();
                const last = buttons.length - 1;
                const next = e.key === 'Home' ? 0
                    : e.key === 'End' ? last
                        : e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
                            : (i === 0 ? last : i - 1);
                const target = buttons[next];
                if (!target) return;
                const tab = target.getAttribute(attr);
                target.focus();
                activateTracked(tab, 'keyboard');
                // Some sections repaint through render(), which replaces the
                // strip wholesale and drops the focus set above. Re-focus the
                // rebuilt button so a second arrow press still works.
                if (!target.isConnected) {
                    document.querySelector(`[${attr}="${CSS.escape(tab)}"]`)?.focus();
                }
            });
        });
    }

    /* ── Render ────────────────────────────────────────────────────────────── */

    /** Shortcut hint for the settings-jump nav item and legends. */
    settingsJumpShortcutLabel() {
        const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '');
        return mac ? '⌘⇧K' : 'Ctrl+Shift+K';
    }

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

    pageLabel(pageId) {
        const page = (this.dash.pages || []).find((p) => String(p.id) === String(pageId));
        return page?.name || String(pageId ?? '');
    }

    /** Breadcrumb trail for the shell header and document title. */
    headerBreadcrumb() {
        const root = this.t('config.viewBreadcrumbRoot', 'Config').toLowerCase();
        const parts = [root, this.sectionLabel(this.section).toLowerCase()];
        const prop = DashboardConfig.SUB_TAB_STATE[this.section];
        const tabs = DashboardConfig.SUB_TABS[this.section];
        const tab = prop ? this[prop] : null;
        if (tab && tabs?.includes(tab) && tab !== tabs[0]) {
            parts.push(this.subTabHeaderLabel(this.section, tab).toLowerCase());
        }
        if (this.section === 'bookmarks' && this.bmPageFilter) {
            parts.push(this.pageLabel(this.bmPageFilter).toLowerCase());
        }
        return parts.join(' › ');
    }

    subTabHeaderLabel(section, tab) {
        switch (section) {
            case 'behavior': return this.behaviorTabLabel?.(tab) || tab;
            case 'pages-tags': return this.ptTabLabel?.(tab) || tab;
            case 'appearance': return this.appearanceTabLabel?.(tab) || tab;
            case 'stats': return this.statsTabLabel?.(tab) || tab;
            case 'data-backups': return this.dbTabLabel?.(tab) || tab;
            case 'help': return this.helpTabLabel?.(tab) || tab;
            default: return tab;
        }
    }

    /** Refresh section title in the panel head and dashboard header breadcrumb. */
    updateConfigShellHead() {
        const title = document.querySelector('.config-view-section-title');
        if (title) title.textContent = this.sectionLabel(this.section);
        const crumb = document.querySelector('.config-view-head-breadcrumb');
        if (crumb) {
            const trail = this.headerBreadcrumb();
            // A trail with no separator is just the section name again, which
            // the heading directly above already says.
            crumb.textContent = trail;
            crumb.hidden = !trail.includes(' › ');
        }
        this.dash.pageNav?.updatePageTitle?.();
        this.dash.pageNav?.updateDocumentTitle?.();
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
        this.syncSectionNav(this.section);
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
            // The custom-themes tile counts what is in the colour document, so
            // it has to be fetched even when the General tab is showing.
            if (this._colorsData === undefined || this._colorsData === null) {
                void this.loadColorsData().then(() => {
                    if (!this.isActiveView() || this.section !== 'appearance') return;
                    if (this.appearanceTab === 'custom-themes') {
                        this.repaintAppearanceBody();
                        return;
                    }
                    this.render();
                });
            }
        } else if (this.section === 'behavior') {
            this.bindBehaviorControls(container);
        } else if (this.section === 'pages-tags') {
            this.bindPagesTags(container);
        } else if (this.section === 'bookmarks') {
            this.bindBookmarksSection(container);
            void this.prefetchAllBookmarkCategories();
        } else if (this.section === 'stats') {
            this.bindStats(container);
            // The tab can be the one restored from a previous visit rather than
            // one just clicked, so the fetch cannot hang off the click alone.
            this.loadStatsTabData(this.statsTab);
        } else if (this.section === 'help') {
            this.bindHelp(container);
        }
        window.ConfigSettingPromo?.scheduleForSection?.(this.section, { config: this });
        this.bindFormKeyboard(container);
        this.bindFormKeyboardLegend(container);
        this.cacheSettingsJumpFields();
        if (this.isActiveView()) {
            this.updateConfigShellHead();
        }
    }

    /**
     * Wire keyboard patterns for schema-driven and appearance controls: choice
     * rows behave as radiogroups, gradient swatches the same, and range sliders
     * honour Home/End for min/max.
     */
    bindFormKeyboard(container) {
        if (!container) return;
        this.bindChoiceGroups(container);
        this.bindSwatchGroups(container);
        this.bindRangeInputs(container);
    }

    /**
     * Renders `[key, label]` pairs as the keyboard legend used across the app.
     *
     * Inbox, Health and Config → Bookmarks all draw a key as a <kbd> chip beside
     * its label; the form and list sections used to draw one flat sentence with
     * the keys buried in prose. This is the shared shape, so those two now match.
     */
    renderKeyboardLegendPairs(pairs) {
        const esc = (v) => this.dash.escapeHtml(v);
        return pairs
            .map(([k, label]) => `<span><kbd>${esc(k)}</kbd> ${esc(label)}</span>`)
            .join('');
    }

    /** Footer hint on form-heavy sections (Behavior, Appearance, …). */
    bindFormKeyboardLegend(container) {
        const formSections = new Set(['behavior', 'appearance', 'stats', 'data-backups']);
        if (!formSections.has(this.section)) return;
        const body = container?.querySelector('#config-view-body') || document.getElementById('config-view-body');
        if (!body) return;
        if (body.querySelector('.config-form-keyboard-legend')) return;
        if (!body.querySelector('.config-choices, .config-range, .config-subtabs')) return;
        const legend = document.createElement('p');
        legend.className = 'config-form-keyboard-legend';
        legend.setAttribute('aria-hidden', 'true');
        // Keys stay untranslated (they are what is printed on the keyboard);
        // only the action each one performs is a translated string.
        legend.innerHTML = this.renderKeyboardLegendPairs([
            ['←/→', this.t('config.formKeyChoices', 'choices')],
            ['Home / End', this.t('config.formKeySliders', 'sliders')],
            ['Alt+←/→', this.t('config.formKeySubtabs', 'sub-tabs')],
            ['Ctrl/Cmd+Shift+K', this.t('config.formKeyFindSetting', 'find setting')],
            ['!', this.t('config.formKeyCheatSheet', 'cheat sheet')],
        ]);
        body.appendChild(legend);
    }

    /** Roving tabindex for a single `.config-choices` radiogroup. */
    syncChoiceGroup(group) {
        group.querySelectorAll('.config-choice').forEach((btn) => {
            const on = btn.classList.contains('is-active');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.setAttribute('tabindex', on ? '0' : '-1');
        });
    }

    syncSwatchGroup(group) {
        group.querySelectorAll('.config-bg-swatch').forEach((btn) => {
            const on = btn.classList.contains('is-active');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.setAttribute('tabindex', on ? '0' : '-1');
        });
    }

    wireChoiceGroup(group) {
        if (group.dataset.configChoiceWired) return;
        group.dataset.configChoiceWired = '1';
        const choices = [...group.querySelectorAll('.config-choice')];
        if (!choices.length) return;
        group.setAttribute('role', 'radiogroup');
        const label = group.closest('.config-field')?.querySelector('.config-field-label')?.textContent?.trim();
        if (label) {
            group.setAttribute('aria-label', label);
        }
        this.syncChoiceGroup(group);
        choices.forEach((btn) => {
            btn.addEventListener('keydown', (e) => {
                const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
                if (!keys.includes(e.key)) return;
                e.preventDefault();
                e.stopPropagation();
                const current = choices.indexOf(btn);
                const last = choices.length - 1;
                const nextIdx = e.key === 'Home' ? 0
                    : e.key === 'End' ? last
                        : e.key === 'ArrowRight' ? (current === last ? 0 : current + 1)
                            : (current === 0 ? last : current - 1);
                const target = choices[nextIdx];
                if (!target) return;
                target.focus();
                target.click();
                queueMicrotask(() => this.syncChoiceGroup(group));
            });
        });
        group.addEventListener('click', (e) => {
            if (e.target.closest('.config-choice')) {
                queueMicrotask(() => this.syncChoiceGroup(group));
            }
        });
    }

    wireSwatchGroup(group) {
        if (group.dataset.configSwatchWired) return;
        group.dataset.configSwatchWired = '1';
        const swatches = [...group.querySelectorAll('.config-bg-swatch')];
        if (!swatches.length) return;
        group.setAttribute('role', 'radiogroup');
        const label = group.closest('.config-field, .config-bg-picker')?.querySelector('.config-field-label')?.textContent?.trim();
        if (label) {
            group.setAttribute('aria-label', label);
        }
        this.syncSwatchGroup(group);
        swatches.forEach((btn) => {
            btn.addEventListener('keydown', (e) => {
                const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
                if (!keys.includes(e.key)) return;
                e.preventDefault();
                e.stopPropagation();
                const current = swatches.indexOf(btn);
                const last = swatches.length - 1;
                const nextIdx = e.key === 'Home' ? 0
                    : e.key === 'End' ? last
                        : e.key === 'ArrowRight' ? (current === last ? 0 : current + 1)
                            : (current === 0 ? last : current - 1);
                const target = swatches[nextIdx];
                if (!target) return;
                target.focus();
                target.click();
                queueMicrotask(() => this.syncSwatchGroup(group));
            });
        });
        group.addEventListener('click', (e) => {
            if (e.target.closest('.config-bg-swatch')) {
                queueMicrotask(() => this.syncSwatchGroup(group));
            }
        });
    }

    bindChoiceGroups(container) {
        container.querySelectorAll('.config-choices').forEach((group) => this.wireChoiceGroup(group));
    }

    bindSwatchGroups(container) {
        container.querySelectorAll('.config-bg-swatches').forEach((group) => this.wireSwatchGroup(group));
    }

    bindRangeInputs(container) {
        container.querySelectorAll('input.config-range[type="range"]').forEach((range) => {
            if (range.dataset.configRangeWired) return;
            range.dataset.configRangeWired = '1';
            range.addEventListener('keydown', (e) => {
                if (e.key !== 'Home' && e.key !== 'End') return;
                e.preventDefault();
                e.stopPropagation();
                range.value = e.key === 'Home' ? range.min : range.max;
                range.dispatchEvent(new Event('input', { bubbles: true }));
                range.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });
    }

    /* ── Pages & tags list keyboard (feed pattern) ─────────────────────────── */

    listRowKey(row) {
        if (!row) return null;
        if (row.hasAttribute('data-page-row')) return `page:${row.getAttribute('data-page-row')}`;
        if (row.hasAttribute('data-cat-row')) return `cat:${row.getAttribute('data-cat-row')}`;
        if (row.hasAttribute('data-tag-row')) return `tag:${row.getAttribute('data-tag-row')}`;
        if (row.hasAttribute('data-finder-index')) return `finder:${row.getAttribute('data-finder-index')}`;
        if (row.hasAttribute('data-collection-row')) return `collection:${row.getAttribute('data-collection-row')}`;
        return null;
    }

    getListKeyboardRows() {
        const body = document.getElementById('config-pt-body');
        if (!body) return [];
        return Array.from(body.querySelectorAll('.config-crud-list .config-crud-row'));
    }

    clearListKeyboardSelection() {
        this._listKeyboardKey = null;
        document.querySelectorAll('#config-pt-body .config-crud-row.keyboard-selected').forEach((row) => {
            row.classList.remove('keyboard-selected');
            row.removeAttribute('aria-selected');
        });
    }

    applyListKeyboardSelection(rows) {
        const list = Array.isArray(rows) && rows.length ? rows : this.getListKeyboardRows();
        list.forEach((row) => {
            const selected = this.listRowKey(row) === this._listKeyboardKey;
            row.classList.toggle('keyboard-selected', selected);
            if (selected) {
                row.setAttribute('aria-selected', 'true');
                row.scrollIntoView({
                    block: 'nearest',
                    behavior: document.body?.classList.contains('no-animations') ? 'instant' : 'smooth',
                });
            } else {
                row.removeAttribute('aria-selected');
            }
        });
    }

    syncListKeyboardSelectionAfterRender() {
        const rows = this.getListKeyboardRows();
        if (!this._listKeyboardKey || !rows.some((row) => this.listRowKey(row) === this._listKeyboardKey)) {
            this._listKeyboardKey = null;
        }
        this.applyListKeyboardSelection(rows);
    }

    moveListKeyboardSelection(delta, rows) {
        const list = Array.isArray(rows) && rows.length ? rows : this.getListKeyboardRows();
        if (!list.length) return;
        let index = this._listKeyboardKey
            ? list.findIndex((row) => this.listRowKey(row) === this._listKeyboardKey)
            : -1;
        if (index < 0) {
            index = delta > 0 ? 0 : list.length - 1;
        } else {
            index += delta;
            if (index < 0) index = list.length - 1;
            else if (index >= list.length) index = 0;
        }
        this._listKeyboardKey = this.listRowKey(list[index]);
        this.applyListKeyboardSelection(list);
    }

    focusListRow(row) {
        if (!row) return;
        const field = row.querySelector('.config-crud-fields input:not([type="hidden"]), .config-crud-fields select, .config-crud-fields textarea');
        if (field) {
            field.focus();
            return;
        }
        row.querySelector('.config-crud-row-actions button:not(.config-btn--danger), [data-collection-edit]')?.focus();
    }

    appendListKeyboardLegend(body) {
        const list = body?.querySelector('.config-crud-list');
        if (!list || list.querySelector('.config-panel-empty')) return;
        if (body.querySelector('.config-list-keyboard-legend')) return;
        const legend = document.createElement('p');
        legend.className = 'config-list-keyboard-legend';
        legend.setAttribute('aria-hidden', 'true');
        legend.innerHTML = this.renderKeyboardLegendPairs([
            ['↑/↓', this.t('config.listKeyMove', 'move')],
            ['Enter', this.t('config.listKeyEdit', 'edit')],
            ['g / G', this.t('config.listKeyFirstLast', 'first / last')],
            ['/', this.t('config.listKeyFilterTags', 'filter tags')],
            ['Esc', this.t('config.listKeyClear', 'clear')],
        ]);
        list.after(legend);
    }

    bindListKeyboard(container) {
        if (this.section !== 'pages-tags') return;
        const body = container?.querySelector('#config-pt-body') || document.getElementById('config-pt-body');
        if (!body) return;
        this.appendListKeyboardLegend(body);
        if (!body.dataset.configListKbdWired) {
            body.dataset.configListKbdWired = '1';
            body.addEventListener('click', (e) => {
                const row = e.target.closest('.config-crud-row');
                if (!row || !body.contains(row)) return;
                this._listKeyboardKey = this.listRowKey(row);
                this.applyListKeyboardSelection(this.getListKeyboardRows());
            });
        }
        this.syncListKeyboardSelectionAfterRender();
    }

    handleListKeyboardNavigation(e) {
        if (this.section !== 'pages-tags') return false;
        if (e.ctrlKey || e.altKey || e.metaKey) return false;

        const target = e.target;
        const tag = target?.tagName;
        const isTagFilter = target?.id === 'config-tag-filter';
        const listNavKeys = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ', 'g', 'G']);
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
            if (!isTagFilter || !listNavKeys.has(e.key)) {
                return false;
            }
        }

        const onRowControl = Boolean(
            target?.closest?.('.config-crud-row')
            && target?.matches?.('button, a, input, select, textarea')
        );

        const rows = this.getListKeyboardRows();
        if (!rows.length) return false;

        if (e.key === 'ArrowDown') {
            if (onRowControl) return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isTagFilter) target.blur();
            this.moveListKeyboardSelection(1, rows);
            return true;
        }
        if (e.key === 'ArrowUp') {
            if (onRowControl) return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isTagFilter) target.blur();
            this.moveListKeyboardSelection(-1, rows);
            return true;
        }
        if (onRowControl) {
            return false;
        }
        if ((e.key === 'Enter' || e.key === ' ') && this._listKeyboardKey) {
            const row = rows.find((r) => this.listRowKey(r) === this._listKeyboardKey);
            if (row) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.focusListRow(row);
            }
            return true;
        }
        if (e.key === 'g') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._listKeyboardKey = this.listRowKey(rows[0]);
            this.applyListKeyboardSelection(rows);
            return true;
        }
        if (e.key === 'G') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._listKeyboardKey = this.listRowKey(rows[rows.length - 1]);
            this.applyListKeyboardSelection(rows);
            return true;
        }
        if (e.key === '/' && this.ptTab === 'tags' && !isTagFilter) {
            const filter = document.getElementById('config-tag-filter');
            if (filter) {
                e.preventDefault();
                e.stopImmediatePropagation();
                filter.focus();
                return true;
            }
        }
        return false;
    }

    /* ── Bookmarks master/detail keyboard ──────────────────────────────────── */

    bookmarkRowKey(row) {
        return row?.getAttribute('data-bm-key') || null;
    }

    getBookmarkKeyboardRows() {
        const host = document.getElementById('config-bm-list');
        if (!host) return [];
        return Array.from(host.querySelectorAll('.config-bm-row'));
    }

    clearBookmarkKeyboardSelection() {
        this._bmKeyboardKey = null;
        document.querySelectorAll('#config-bm-list .config-bm-row.keyboard-selected').forEach((row) => {
            row.classList.remove('keyboard-selected');
            row.removeAttribute('aria-selected');
        });
    }

    applyBookmarkKeyboardSelection(rows) {
        const list = Array.isArray(rows) && rows.length ? rows : this.getBookmarkKeyboardRows();
        list.forEach((row) => {
            const selected = this.bookmarkRowKey(row) === this._bmKeyboardKey;
            row.classList.toggle('keyboard-selected', selected);
            if (selected) {
                row.setAttribute('aria-selected', 'true');
                row.scrollIntoView({
                    block: 'nearest',
                    behavior: document.body?.classList.contains('no-animations') ? 'instant' : 'smooth',
                });
            } else {
                row.removeAttribute('aria-selected');
            }
        });
    }

    syncBookmarkKeyboardSelectionAfterRender() {
        const rows = this.getBookmarkKeyboardRows();
        if (!this._bmKeyboardKey || !rows.some((row) => this.bookmarkRowKey(row) === this._bmKeyboardKey)) {
            this._bmKeyboardKey = null;
        }
        this.applyBookmarkKeyboardSelection(rows);
    }

    moveBookmarkKeyboardSelection(delta, rows) {
        const list = Array.isArray(rows) && rows.length ? rows : this.getBookmarkKeyboardRows();
        if (!list.length) return;
        let index = this._bmKeyboardKey
            ? list.findIndex((row) => this.bookmarkRowKey(row) === this._bmKeyboardKey)
            : -1;
        if (index < 0) {
            index = delta > 0 ? 0 : list.length - 1;
        } else {
            index += delta;
            if (index < 0) index = list.length - 1;
            else if (index >= list.length) index = 0;
        }
        this._bmKeyboardKey = this.bookmarkRowKey(list[index]);
        this.applyBookmarkKeyboardSelection(list);
    }

    focusBookmarkEditor() {
        document.querySelector('.config-bm-editor [data-bm-field="name"], #config-bm-name')?.focus();
    }

    async activateBookmarkKeyboardRow(key) {
        if (!key) return;
        void this.openBookmarkEditModal(key);
    }

    findBookmarkByKey(key) {
        return (this.dash.allBookmarks || []).find((b) => this.bookmarkKey(b) === key) || null;
    }

    openBookmarkByKey(key) {
        const bookmark = this.findBookmarkByKey(key);
        if (!bookmark?.url) return;
        const href = this.dash.safeBookmarkOpenHref?.(bookmark.url) || bookmark.url;
        window.open(href, '_blank', 'noopener,noreferrer');
    }

    async closeBookmarkEditorFromKeyboard() {
        if (!this.bmEditing) return false;
        if (!(await this.confirmDiscardBookmarkEdit())) return true;
        this.bmEditing = null;
        this.bmDirty = false;
        this.repaintBookmarksList();
        return true;
    }

    appendBookmarkKeyboardLegend(host) {
        const feed = host?.querySelector('.config-bm-feed');
        if (!feed || feed.querySelector('.config-panel-empty')) return;
        if (host.querySelector('.config-bm-keyboard-legend')) return;
        const legend = document.createElement('p');
        legend.className = 'config-bm-keyboard-legend';
        legend.setAttribute('aria-hidden', 'true');
        legend.innerHTML = this.renderBookmarkKeyboardLegend();
        feed.after(legend);
    }

    bindBookmarkKeyboard(container) {
        if (this.section !== 'bookmarks') return;
        const host = container?.querySelector('#config-bm-list') || document.getElementById('config-bm-list');
        if (!host) return;
        this.appendBookmarkKeyboardLegend(host);
        if (!host.dataset.configBmKbdWired) {
            host.dataset.configBmKbdWired = '1';
            host.addEventListener('click', (e) => {
                const row = e.target.closest('.config-bm-row');
                if (!row || !host.contains(row)) return;
                this._bmKeyboardKey = this.bookmarkRowKey(row);
                this.applyBookmarkKeyboardSelection(this.getBookmarkKeyboardRows());
            });
        }
        this.syncBookmarkKeyboardSelectionAfterRender();
    }

    handleBookmarkKeyboardNavigation(e) {
        if (this.section !== 'bookmarks') return false;
        if (e.ctrlKey || e.altKey || e.metaKey) return false;

        const target = e.target;
        const tag = target?.tagName;
        const isBmSearch = target?.id === 'config-bm-search';
        const bmNavKeys = new Set(['j', 'k', 'Enter', ' ', 'g', 'G']);
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
            if (!isBmSearch || !bmNavKeys.has(e.key)) {
                return false;
            }
        }

        const onRowControl = Boolean(
            target?.closest?.('.config-bm-row')
            && target?.matches?.('button, a, input, select, textarea')
        );

        const rows = this.getBookmarkKeyboardRows();
        if (!rows.length) return false;

        if (e.key === 'j') {
            if (onRowControl) return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isBmSearch) target.blur();
            this.moveBookmarkKeyboardSelection(1, rows);
            return true;
        }
        if (e.key === 'k') {
            if (onRowControl) return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isBmSearch) target.blur();
            this.moveBookmarkKeyboardSelection(-1, rows);
            return true;
        }
        if (onRowControl) {
            return false;
        }
        if ((e.key === 'Enter' || e.key === ' ') && this._bmKeyboardKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.openBookmarkByKey(this._bmKeyboardKey);
            return true;
        }
        if (e.key === 'g') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._bmKeyboardKey = this.bookmarkRowKey(rows[0]);
            this.applyBookmarkKeyboardSelection(rows);
            return true;
        }
        if (e.key === 'G') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._bmKeyboardKey = this.bookmarkRowKey(rows[rows.length - 1]);
            this.applyBookmarkKeyboardSelection(rows);
            return true;
        }
        if (this._bmKeyboardKey) {
            if (e.key === 'e') {
                e.preventDefault();
                e.stopImmediatePropagation();
                void this.activateBookmarkKeyboardRow(this._bmKeyboardKey);
                return true;
            }
            if (e.key === 'm') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.toggleBookmarkMenu(this._bmKeyboardKey, 'more');
                return true;
            }
            if (e.key === 'c') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.toggleBookmarkMenu(this._bmKeyboardKey, 'check');
                return true;
            }
            if (e.key === 'd') {
                e.preventDefault();
                e.stopImmediatePropagation();
                void this.deleteBookmarkByKey(this._bmKeyboardKey);
                return true;
            }
            if (e.key === 'o') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.openBookmarkByKey(this._bmKeyboardKey);
                return true;
            }
        }
        if (e.key === '/' && !isBmSearch) {
            const search = document.getElementById('config-bm-search');
            if (search) {
                e.preventDefault();
                e.stopImmediatePropagation();
                search.focus();
                return true;
            }
        }
        return false;
    }

    /* ── Settings jump (Ctrl/Cmd+Shift+K) ──────────────────────────────────── */

    static HELP_JUMP_PANELS = [
        { tab: 'start', titleKey: 'config.helpStartTitle', fallback: 'Getting started' },
        { tab: 'start', titleKey: 'config.helpTipsTitle', fallback: 'Everyday keys' },
        { tab: 'config', titleKey: 'config.helpConfigTitle', fallback: 'Finding your way around config' },
        { tab: 'config', titleKey: 'config.helpAppearanceTitle', fallback: 'Appearance & themes' },
        { tab: 'organizing', titleKey: 'config.helpWorkspaceTitle', fallback: 'Pages & categories' },
        { tab: 'organizing', titleKey: 'config.helpBookmarksTitle', fallback: 'Bookmarks' },
        { tab: 'organizing', titleKey: 'config.helpTagsTitle', fallback: 'Tags & collections' },
        { tab: 'search', titleKey: 'config.helpSearchTitle', fallback: 'Searching your bookmarks' },
        { tab: 'search', titleKey: 'config.helpFindersTitle', fallback: 'Finders' },
        { tab: 'search', titleKey: 'config.helpCommandsTitle', fallback: 'Commands' },
        { tab: 'search', titleKey: 'config.helpKeyboardTitle', fallback: 'Keyboard' },
        { tab: 'health', titleKey: 'config.helpHealthTitle', fallback: 'Availability & health' },
        { tab: 'health', titleKey: 'config.helpInboxTitle', fallback: 'Inbox' },
        { tab: 'data', titleKey: 'config.helpDataTitle', fallback: 'Backups, import & export' },
        { tab: 'data', titleKey: 'config.helpSelfHostingTitle', fallback: 'Self-hosting' },
        { tab: 'about', titleKey: 'config.helpAboutTitle', fallback: 'About nextDash' },
    ];

    subTabLabel(section, tab) {
        switch (section) {
            case 'behavior': return this.behaviorTabLabel(tab);
            case 'pages-tags': return this.ptTabLabel(tab);
            case 'appearance': return this.appearanceTabLabel(tab);
            case 'stats': return this.statsTabLabel(tab);
            case 'data-backups': return this.dbTabLabel(tab);
            case 'help': return this.helpTabLabel(tab);
            default: return tab;
        }
    }

    settingsJumpSubtitle(section, subTab) {
        const parts = [this.sectionLabel(section)];
        if (subTab) parts.push(this.subTabLabel(section, subTab));
        return parts.join(' › ');
    }

    buildSettingsJumpNavEntries() {
        const entries = [];
        DashboardConfig.SECTIONS.forEach((section) => {
            entries.push({
                id: `section:${section}`,
                kind: 'section',
                title: this.sectionLabel(section),
                subtitle: this.sectionLabel(section),
                section,
                subTab: null,
                focusSelector: `[data-config-section="${section}"]`,
            });
            const tabs = DashboardConfig.SUB_TABS[section];
            if (tabs?.length) {
                tabs.forEach((tab) => {
                    entries.push({
                        id: `subtab:${section}:${tab}`,
                        kind: 'subtab',
                        title: this.subTabLabel(section, tab),
                        subtitle: this.settingsJumpSubtitle(section, tab),
                        section,
                        subTab: tab,
                        focusSelector: null,
                    });
                });
            }
        });
        if (DashboardConfig.HELP_JUMP_PANELS?.length) {
            DashboardConfig.HELP_JUMP_PANELS.forEach((panel, i) => {
                const title = this.t(panel.titleKey, panel.fallback);
                entries.push({
                    id: `help:${panel.tab}:${i}`,
                    kind: 'help',
                    title,
                    subtitle: `${this.sectionLabel('help')} › ${this.helpTabLabel(panel.tab)}`,
                    section: 'help',
                    subTab: panel.tab,
                    helpTitle: title,
                    focusSelector: null,
                });
            });
        }
        return entries;
    }

    cacheSettingsJumpFields() {
        const panel = document.getElementById('config-section-panel');
        if (!panel) return;
        const section = this.section;
        const subTab = DashboardConfig.SUB_TAB_STATE[section] ? this[DashboardConfig.SUB_TAB_STATE[section]] : null;
        const subtitle = this.settingsJumpSubtitle(section, subTab);
        let seq = 0;
        panel.querySelectorAll('.config-field-label, .config-panel-title').forEach((labelEl) => {
            const title = labelEl.textContent?.trim();
            if (!title) return;
            const field = labelEl.closest('.config-field');
            const focusEl = field?.querySelector(
                'input:not([type="hidden"]), select, textarea, .config-choices .config-choice.is-active, .config-choices .config-choice'
            ) || labelEl;
            const jumpId = `jump-${section}-${subTab || 'root'}-${seq += 1}`;
            focusEl.setAttribute('data-config-jump', jumpId);
            this._settingsJumpCache.set(jumpId, {
                id: jumpId,
                kind: 'field',
                title,
                subtitle,
                section,
                subTab,
                focusSelector: `[data-config-jump="${jumpId}"]`,
            });
        });
    }

    getSettingsJumpEntries() {
        const byId = new Map();
        this.buildSettingsJumpNavEntries().forEach((e) => byId.set(e.id, e));
        this._settingsJumpCache.forEach((e, id) => byId.set(id, e));
        return [...byId.values()];
    }

    filterSettingsJumpEntries(query) {
        const q = String(query || '').trim().toLowerCase();
        const all = this.getSettingsJumpEntries();
        if (!q) return all;
        return all.filter((e) => `${e.title} ${e.subtitle}`.toLowerCase().includes(q));
    }

    isSettingsJumpOpen() {
        const overlay = document.getElementById('app-modal');
        return Boolean(overlay?.classList.contains('show')
            && overlay.querySelector('.config-settings-jump-modal'));
    }

    cleanupSettingsJumpHandler() {
        if (!this._settingsJumpHandler) return;
        document.removeEventListener('keydown', this._settingsJumpHandler, true);
        this._settingsJumpHandler = null;
    }

    renderSettingsJumpResults(entries) {
        const esc = (v) => this.dash.escapeHtml(v);
        if (!entries.length) {
            return `<p class="config-settings-jump-empty">${esc(this.t('config.settingsSearchNoResults', 'No settings match.'))}</p>`;
        }
        return `<ul class="config-settings-jump-results" role="listbox">
            ${entries.map((entry, i) => `
                <li class="config-settings-jump-result${i === this._settingsJumpSelected ? ' is-active' : ''}"
                    role="option" aria-selected="${i === this._settingsJumpSelected ? 'true' : 'false'}"
                    data-settings-jump-index="${i}">
                    <span class="config-settings-jump-result-title">${esc(entry.title)}</span>
                    <span class="config-settings-jump-result-sub">${esc(entry.subtitle)}</span>
                </li>`).join('')}
        </ul>`;
    }

    syncSettingsJumpResults(entries) {
        const host = document.querySelector('.config-settings-jump-body');
        if (!host) return;
        host.innerHTML = this.renderSettingsJumpResults(entries);
        host.querySelectorAll('[data-settings-jump-index]').forEach((row) => {
            row.addEventListener('click', () => {
                const idx = Number(row.getAttribute('data-settings-jump-index'));
                const entry = entries[idx];
                if (entry) void this.activateSettingsJumpEntry(entry);
            });
        });
        host.querySelector('.config-settings-jump-result.is-active')
            ?.scrollIntoView({ block: 'nearest' });
    }

    setupSettingsJumpKeyboard(entries) {
        this.cleanupSettingsJumpHandler();
        this._settingsJumpHandler = (e) => {
            if (!this.isSettingsJumpOpen()) {
                this.cleanupSettingsJumpHandler();
                return;
            }
            const panel = document.querySelector('.config-settings-jump-modal');
            if (!panel?.contains(document.activeElement) && document.activeElement?.id !== 'config-settings-jump-filter') {
                return;
            }
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
                const filter = document.getElementById('config-settings-jump-filter');
                if (filter instanceof HTMLElement) {
                    e.preventDefault();
                    e.stopPropagation();
                    filter.focus({ preventScroll: true });
                    if (typeof filter.select === 'function') {
                        filter.select();
                    }
                }
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                this._settingsJumpSelected = entries.length
                    ? (this._settingsJumpSelected + 1) % entries.length
                    : 0;
                this.syncSettingsJumpResults(entries);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                this._settingsJumpSelected = entries.length
                    ? (this._settingsJumpSelected - 1 + entries.length) % entries.length
                    : 0;
                this.syncSettingsJumpResults(entries);
                return;
            }
            if (e.key === 'Enter') {
                const entry = entries[this._settingsJumpSelected];
                if (entry) {
                    e.preventDefault();
                    e.stopPropagation();
                    void this.activateSettingsJumpEntry(entry);
                }
            }
        };
        document.addEventListener('keydown', this._settingsJumpHandler, true);
    }

    openSettingsJump() {
        if (this.isSettingsJumpOpen()) return;
        const esc = (v) => this.dash.escapeHtml(v);
        let entries = this.filterSettingsJumpEntries('');
        this._settingsJumpSelected = 0;
        const label = this.t('config.settingsSearchLabel', 'Find a setting');
        const placeholder = this.t('config.settingsSearchPlaceholder', 'Settings, tabs, help…');
        const html = `
            <div class="config-settings-jump">
                <input type="search" id="config-settings-jump-filter" class="config-settings-jump-filter cheat-sheet-filter"
                       placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"
                       aria-label="${esc(label)}">
                <div class="config-settings-jump-body">${this.renderSettingsJumpResults(entries)}</div>
            </div>`;
        window.AppModal.show({
            title: label,
            htmlMessage: html,
            confirmText: this.t('config.close', 'Close'),
            showCancel: false,
            modalClass: 'config-settings-jump-modal keyboard-cheat-sheet-modal',
            initialFocusSelector: '#config-settings-jump-filter',
            onHide: () => this.cleanupSettingsJumpHandler(),
        });
        const filter = document.getElementById('config-settings-jump-filter');
        if (!filter) return;
        const refresh = () => {
            entries = this.filterSettingsJumpEntries(filter.value);
            if (this._settingsJumpSelected >= entries.length) {
                this._settingsJumpSelected = Math.max(0, entries.length - 1);
            }
            this.syncSettingsJumpResults(entries);
            this.setupSettingsJumpKeyboard(entries);
        };
        filter.addEventListener('input', refresh);
        this.setupSettingsJumpKeyboard(entries);
    }

    async activateSettingsJumpEntry(entry) {
        if (!entry) return;
        window.AppModal.hide();
        this.cleanupSettingsJumpHandler();
        if (entry.section !== this.section) {
            this.selectSection(entry.section, 'keyboard');
        }
        if (entry.subTab) {
            const prop = DashboardConfig.SUB_TAB_STATE[entry.section];
            if (prop && this[prop] !== entry.subTab) {
                if (entry.section === 'appearance') {
                    await this.switchAppearanceTab(entry.subTab);
                } else if (entry.section === 'help') {
                    this.helpTab = entry.subTab;
                    this.render();
                    this.restoreConfigHash();
                } else {
                    this.switchSubTab(entry.subTab, 'keyboard');
                }
            }
        }
        await new Promise((r) => requestAnimationFrame(r));
        this.cacheSettingsJumpFields();
        let focusSelector = entry.focusSelector;
        if (entry.kind === 'field') {
            const refreshed = [...this._settingsJumpCache.values()].find((e) => (
                e.kind === 'field'
                && e.title === entry.title
                && e.section === entry.section
                && e.subTab === entry.subTab
            ));
            if (refreshed) focusSelector = refreshed.focusSelector;
        }
        if (entry.helpTitle && entry.section === 'help') {
            const titles = [...document.querySelectorAll('#config-help-body .config-panel-title')];
            const match = titles.find((el) => el.textContent.trim() === entry.helpTitle);
            match?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            match?.focus?.({ preventScroll: true });
            return;
        }
        const focusEl = focusSelector ? document.querySelector(focusSelector) : null;
        if (focusEl) {
            focusEl.scrollIntoView({ block: 'nearest', behavior: document.body?.classList.contains('no-animations') ? 'instant' : 'smooth' });
            if (typeof focusEl.focus === 'function') {
                focusEl.focus({ preventScroll: true });
            }
            return;
        }
        document.querySelector(`[data-config-section="${CSS.escape(entry.section)}"]`)?.focus();
    }

    renderShell() {
        const esc = (v) => this.dash.escapeHtml(v);
        const panelId = 'config-section-panel';
        const activeNavId = `config-section-${this.section}`;
        const nav = DashboardConfig.SECTIONS.map((section) => {
            const active = section === this.section;
            return `
                <button type="button" class="config-nav-item${active ? ' is-active' : ''}"
                        role="tab" aria-selected="${active ? 'true' : 'false'}"
                        tabindex="${active ? '0' : '-1'}"
                        id="config-section-${esc(section)}"
                        aria-controls="${panelId}"
                        data-config-section="${esc(section)}">
                    ${esc(this.sectionLabel(section))}
                </button>`;
        }).join('');
        const searchLabel = this.t('config.settingsSearchLabel', 'Find settings');
        const searchShortcut = this.settingsJumpShortcutLabel();

        return `
            <div class="config-view">
                <div class="config-nav-column">
                <nav class="config-nav" role="tablist" aria-label="${esc(this.t('config.sectionsNavAria', 'Config sections'))}">
                    ${nav}
                </nav>
                <button type="button" class="config-nav-item config-nav-search"
                        data-config-action="settings-jump"
                        data-config-setting-promo-anchor="settingsJump"
                        tabindex="0"
                        aria-keyshortcuts="Control+Shift+K Meta+Shift+K"
                        title="${esc(`${searchLabel} (${searchShortcut})`)}">
                    ${esc(searchLabel)}
                    <span class="config-nav-search-shortcut">${esc(searchShortcut)}</span>
                </button>
                </div>
                <div class="config-view-main" id="${panelId}" role="tabpanel" tabindex="0"
                     aria-labelledby="${activeNavId}">
                    <div class="config-view-head">
                        <h2 class="config-view-section-title">${esc(this.sectionLabel(this.section))}</h2>
                        <p class="config-view-head-breadcrumb"${this.headerBreadcrumb().includes(' › ') ? '' : ' hidden'}>${esc(this.headerBreadcrumb())}</p>
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

    /** Headline counts — pass a subset stats object when filters are active. */
    bookmarksSummaryTiles(stats) {
        const s = stats || this.computeStats();
        const pct = s.total ? Math.round((s.tagged / s.total) * 100) : 0;
        return [
            {
                key: 'total',
                tone: 'accent',
                label: this.t('config.statsBookmarks', 'Bookmarks'),
                value: s.total,
            },
            {
                key: 'tagged',
                tone: 'neutral',
                label: this.t('config.statsTaggedBookmarks', 'Tagged'),
                value: s.tagged,
                detail: s.total
                    ? this.t('config.bookmarksTileTaggedPct', '{pct}% of total').replace('{pct}', String(pct))
                    : undefined,
            },
            {
                key: 'categories',
                tone: 'neutral',
                label: this.t('config.statsCategoryCount', 'Categories'),
                value: s.categories,
            },
            {
                key: 'shortcut',
                tone: 'neutral',
                label: this.t('config.statsWithShortcut', 'With a shortcut'),
                value: s.withShortcut,
            },
            {
                key: 'monitored',
                tone: s.monitored > 0 ? 'accent' : 'neutral',
                label: this.t('config.statsMonitored', 'Monitored'),
                value: s.monitored,
            },
        ];
    }

    renderTile(tile) {
        const esc = (v) => this.dash.escapeHtml(v);
        const clickable = tile.action ? ' config-tile--action' : '';
        const tag = tile.action ? 'button' : 'div';
        // A tile can hand off to a dashboard view, or to a sub-tab of the
        // section it is sitting in.
        const attrs = tile.action
            ? ` type="button"${
                  tile.action.view ? ` data-tile-view="${esc(tile.action.view)}"` : ''
              }${
                  tile.action.filter ? ` data-tile-filter="${esc(tile.action.filter)}"` : ''
              }${
                  tile.action.appearanceTab ? ` data-tile-appearance-tab="${esc(tile.action.appearanceTab)}"` : ''
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
     * The landing section: a snapshot of the whole install. Each block links on
     * to the view that acts on it, so the overview stays a summary rather than
     * turning into a second place to fix things.
     *
     * Grouped by what the reader is meant to do with each block, not by what the
     * data happens to be:
     *
     *   act    — the update bar and Needs attention. Framed panels, and the only
     *            ones that are: a border here means "this wants you".
     *   know   — At a glance beside New features.
     *   read   — About and Latest update.
     *   tips   — a single line, not a panel.
     *
     * Everything below the act zone is deliberately unframed. Seven equally
     * boxed blocks gave the eye nowhere to land, and the update bar — the one
     * thing that must be seen — competed with six identical neighbours. The
     * status tile row is gone entirely: all six numbers were already on the
     * page, in At a glance or in Needs attention.
     */
    renderOverview() {
        const esc = (v) => this.dash.escapeHtml(v);
        const intro = esc(this.t('config.overviewIntro', 'A snapshot of your setup. Anything that needs you is at the top.'));

        return `
            <p class="config-view-intro">${intro}</p>
            <div class="config-overview-act">
                ${this.renderOverviewUpdates()}
                ${this.renderOverviewAttention()}
            </div>
            <div class="config-overview-layout">
                <div class="config-overview-top">
                    ${this.renderOverviewStats()}
                    ${this.renderOverviewNewFeatures()}
                </div>
                <div class="config-overview-about-row">
                    ${this.renderOverviewAbout()}
                    ${this.renderOverviewWhatsNew()}
                </div>
                ${this.renderOverviewTips()}
            </div>
        `;
    }

    /**
     * Who makes nextDash, with the two links that follow from it.
     *
     * Sits beside the latest-update panel at half width — reference material
     * you go looking for rather than read on the way past.
     *
     * The Ko-fi button reuses the shared .wn-kofi-* set from modal.css — the
     * same markup the what's-new modal uses, including the twinkling stars — so
     * the two are identical by construction rather than by two descriptions that
     * can drift apart.
     */
    renderOverviewAbout() {
        const esc = (v) => this.dash.escapeHtml(v);
        const stars = '<span class="wn-kofi-star"></span>'.repeat(4);

        return `
            <div class="config-panel config-panel--plain config-about-panel">
                <h3 class="config-panel-title">${esc(this.t('config.overviewAboutTitle', 'About the developer'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.overviewAboutBodyShort',
                    'Hi, I’m Jordi, a developer from the Netherlands. I build nextDash in my spare time: a bookmark dashboard that is fast, keyboard-first, and stores everything in plain files you own. Free and open-source, and it stays that way.'))}</p>
                <div class="config-about-actions">
                    <a class="config-btn config-about-github" href="https://github.com/jordibrouwer/nextdash" target="_blank" rel="noopener noreferrer">
                        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
                        <span>${esc(this.t('config.overviewAboutGithub', 'GitHub'))}</span>
                    </a>
                    <a class="wn-kofi-btn wn-kofi-btn--animated" href="https://ko-fi.com/jordibrw" target="_blank" rel="noopener noreferrer">
                        <span class="wn-kofi-stars" aria-hidden="true">${stars}</span>
                        <svg class="wn-kofi-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 5.702 0 8.732c.483 4.918 3.919 5.023 6.782 5.139 2.81.114 3.325.12 3.325.12s.747.468 1.5.654a7.5 7.5 0 0 0 3.56-.468s5.698-1.094 7.035-5.7c.222-.778.35-1.574.35-2.373 0-.888-.098-1.83-.715-2.309zm-3.585 2.39c-.583 2.4-3.11 2.947-3.11 2.947l-1.8-.434c-.016-.003-.033.003-.043.016l-.847 1.067a.15.15 0 0 1-.265-.046l-.522-1.947a.15.15 0 0 0-.102-.107l-1.956-.517a.15.15 0 0 1-.046-.267l3.184-2.304c.016-.011.026-.03.024-.049l-.098-.832a2.617 2.617 0 0 1 2.602-2.944c1.444 0 2.618 1.174 2.618 2.618 0 .295-.049.582-.14.854l.501-.068s.564 1.006-.0 2.013z"/></svg>
                        <span class="wn-kofi-label">${esc(this.t('config.helpSupportKofi', 'Support me on Ko-fi'))}</span>
                    </a>
                </div>
            </div>`;
    }

    /**
     * GitHub update check — manual refresh and status (opt-in).
     */
    renderOverviewUpdates() {
        if (!window.nextdashUpdateCheckEnabled?.()) return '';

        const esc = (v) => this.dash.escapeHtml(v);
        const desc = window.nextdashDescribeUpdateStatus?.(
            this._updateStatus,
            this._updateStatusChecking
        ) || { tone: 'neutral', message: '' };
        const toneClass = esc(desc.tone || 'neutral');
        const showDismiss = desc.tone === 'warn'
            && this._updateStatus?.latest
            && !this._updateStatusChecking;
        let statusMessage = desc.message || '';
        if (desc.tone === 'warn' && this._updateStatus?.latest && !this._updateStatusChecking) {
            statusMessage = this.t('config.updateCheckModalAvailable', '{latest} is available on GitHub.')
                .replace(/\{latest\}/g, this._updateStatus.latest);
        }
        const statusHidden = !statusMessage && !this._updateStatusChecking;

        return `
            <div class="config-update-bar config-update-bar--${toneClass}" role="region" aria-label="${esc(this.t('config.updateCheckPanelTitle', 'Software updates'))}">
                <p class="config-update-status" id="config-overview-update-status" aria-live="polite"${statusHidden ? ' hidden' : ''}>${esc(statusMessage)}</p>
                <div class="config-update-actions config-actions">
                    ${desc.releaseUrl ? `<a class="config-btn config-btn--small" href="${esc(desc.releaseUrl)}" target="_blank" rel="noopener noreferrer">${esc(this.t('config.overviewUpdateAvailableCta', 'View release on GitHub →'))}</a>` : ''}
                    ${showDismiss ? `<button type="button" class="config-btn config-btn--small" data-overview-action="dismiss-update">${esc(this.t('config.overviewUpdateDismiss', 'Dismiss'))}</button>` : ''}
                    <button type="button" class="config-btn config-btn--small"
                            data-overview-action="check-update"
                            ${statusHidden ? '' : 'aria-describedby="config-overview-update-status" '}
                            aria-busy="${this._updateStatusChecking ? 'true' : 'false'}"
                            ${this._updateStatusChecking ? 'disabled' : ''}>${esc(this._updateStatusChecking
                                ? this.t('config.updateCheckChecking', 'Checking GitHub…')
                                : this.t('config.updateCheckNow', 'Check for updates'))}</button>
                </div>
            </div>`;
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

        // Nothing wrong means no panel at all, not a panel saying so. A framed
        // block costing ~110px to report the absence of problems was the single
        // largest thing on a healthy install's Overview.
        if (!items.length) {
            return `<p class="config-attention-clear">${esc(this.t('config.overviewNothingToDo', 'Nothing needs attention — everything checks out.'))}</p>`;
        }

        return `
            <div class="config-panel config-panel--attention">
                <h3 class="config-panel-title">${esc(this.t('config.overviewAttentionTitle', 'Needs attention'))}</h3>
                <ul class="config-attention-list">${items.map((i) => `
                    <li class="config-attention-row config-attention-row--${esc(i.tone)}">
                        <span class="config-attention-count">${esc(String(i.n))}</span>
                        <span class="config-attention-label">${esc(i.label)}</span>
                        <button type="button" class="config-btn config-btn--small"
                                data-overview-go='${esc(JSON.stringify(i.action))}'>${esc(i.cta)}</button>
                    </li>`).join('')}</ul>
            </div>`;
    }

    /**
     * Short guides to recent capabilities — one at a time in a compact carousel
     * so the overview row stays the same height as At a glance beside it.
     */
    renderOverviewNewFeatures() {
        const esc = (v) => this.dash.escapeHtml(v);
        const items = this.overviewNewFeatures();
        if (!items.length) return '';

        const total = items.length;
        const index = Math.min(Math.max(0, this.overviewFeatureIndex), total - 1);
        this.overviewFeatureIndex = index;
        const showNav = total > 1;
        const counter = this.overviewNewFeaturesCounterLabel(index, total);
        const navLabel = esc(this.t('config.overviewNewFeaturesNavAria', 'Browse new features'));

        return `
            <div class="config-panel config-panel--plain config-new-features-panel config-new-features-panel--animated">
                ${this.renderNewFeaturesPanelStars()}
                <div class="config-new-features-panel-inner">
                    <div class="config-new-features-head">
                        <h3 class="config-panel-title">${esc(this.t('config.overviewNewFeaturesTitle', 'New features'))}</h3>
                        ${showNav ? `
                            <div class="config-new-features-nav" role="group" aria-label="${navLabel}">
                                <button type="button" class="config-new-features-nav-btn"
                                        data-overview-feature="prev"
                                        aria-label="${esc(this.t('config.overviewNewFeaturesPrev', 'Previous feature'))}">‹</button>
                                <span class="config-new-features-counter" aria-live="polite">${esc(counter)}</span>
                                <button type="button" class="config-new-features-nav-btn"
                                        data-overview-feature="next"
                                        aria-label="${esc(this.t('config.overviewNewFeaturesNext', 'Next feature'))}">›</button>
                            </div>` : ''}
                    </div>
                    <div class="config-new-features-carousel" id="config-new-features-carousel" tabindex="${showNav ? '0' : '-1'}"
                         aria-roledescription="carousel"
                         aria-label="${navLabel}">
                        ${this.renderOverviewFeatureSpotlight(items[index])}
                    </div>
                </div>
            </div>`;
    }

    renderOverviewFeatureSpotlight(item) {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <article class="config-feature-spotlight">
                <h4 class="config-feature-spotlight-title">${esc(this.t(item.titleKey, item.titleFallback))}</h4>
                <p class="config-panel-note">${esc(this.t(item.whatKey, item.whatFallback))}</p>
                <p class="config-panel-note config-feature-spotlight-enable">${esc(this.t(item.enableKey, item.enableFallback))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--small"
                            data-overview-go='${esc(JSON.stringify(item.go))}'>${esc(this.t(item.ctaKey, item.ctaFallback))}</button>
                </div>
            </article>`;
    }

    overviewNewFeaturesCounterLabel(index, total) {
        return this.t('config.overviewNewFeaturesCounter', '{current} / {total}')
            .replace('{current}', String(index + 1))
            .replace('{total}', String(total));
    }

    stepOverviewFeature(delta) {
        const items = this.overviewNewFeatures();
        if (items.length <= 1) return;
        const n = items.length;
        this.overviewFeatureIndex = ((this.overviewFeatureIndex + delta) % n + n) % n;
        this.repaintOverviewNewFeatures();
        requestAnimationFrame(() => {
            document.getElementById('config-new-features-carousel')
                ?.focus({ preventScroll: true });
        });
    }

    repaintOverviewNewFeatures() {
        if (!this.isActiveView() || this.section !== 'overview') return;
        const host = document.querySelector('.config-new-features-panel-inner');
        if (!host) return;
        const panel = host.closest('.config-new-features-panel');
        if (!panel) return;
        const fresh = this.renderOverviewNewFeatures();
        const wrap = document.createElement('div');
        wrap.innerHTML = fresh;
        const nextPanel = wrap.firstElementChild;
        if (!nextPanel) return;
        panel.replaceWith(nextPanel);
    }

    /** Twinkling stars around the new-features panel border (decorative). */
    renderNewFeaturesPanelStars() {
        return `<span class="config-new-features-panel-stars" aria-hidden="true">${'<span class="config-new-features-panel-star"></span>'.repeat(8)}</span>`;
    }

    /** Catalog of feature spotlights shown on the overview. */
    overviewNewFeatures() {
        return [
            {
                titleKey: 'config.overviewNewFeatureMonitorEmphasisTitle',
                titleFallback: 'Monitored bookmarks stand out',
                whatKey: 'config.overviewNewFeatureMonitorEmphasisWhat',
                whatFallback: 'A bookmark set to Monitor now shows its status on the dashboard, the way a Periodic one always did — and you can say how much it should stand out.',
                howKey: 'config.overviewNewFeatureMonitorEmphasisHow',
                howFallback: 'Right-click a bookmark and pick Show in Health to jump straight to its row, from the dashboard or from Config → Bookmarks.',
                enableKey: 'config.overviewNewFeatureMonitorEmphasisEnable',
                enableFallback: 'Set to draw the eye only when something is down. Choose Always or Never under Config → Behavior → Status & health.',
                ctaKey: 'config.overviewNewFeatureMonitorEmphasisCta',
                ctaFallback: 'Open Status & health →',
                go: { section: 'behavior', behaviorTab: 'status' },
            },
            {
                titleKey: 'config.overviewNewFeatureSideRailTitle',
                titleFallback: 'Button bar position',
                whatKey: 'config.overviewNewFeatureSideRailWhat',
                whatFallback: 'The add, search, commands, and finders buttons can float center-bottom, dock into either bottom corner, or stand as a vertical rail down the left edge.',
                howKey: 'config.overviewNewFeatureSideRailHow',
                howFallback: 'Pick a position under Config → Appearance → Layout, or run :buttonbar from the command palette. The bar moves as you choose — no reload.',
                enableKey: 'config.overviewNewFeatureSideRailEnable',
                enableFallback: 'The side rail keeps the space under your bookmarks clear, which pays off on wide screens.',
                ctaKey: 'config.overviewNewFeatureSideRailCta',
                ctaFallback: 'Open Layout →',
                go: { section: 'appearance', appearanceTab: 'layout' },
            },
            {
                titleKey: 'config.overviewNewFeatureBookmarkFormTitle',
                titleFallback: 'Shared bookmark form',
                whatKey: 'config.overviewNewFeatureBookmarkFormWhat',
                whatFallback: 'Add and edit bookmarks in one centered modal — from the dashboard, Health, Inbox, Config, and search.',
                howKey: 'config.overviewNewFeatureBookmarkFormHow',
                howFallback: 'Press +, Shift+B, or Ctrl+Shift+A to open the form. Use Create + New to save and immediately add another; the grid updates behind the modal.',
                enableKey: 'config.overviewNewFeatureBookmarkFormEnable',
                enableFallback: 'Press ! for the full cheat sheet. Edit a row with ; or from Health and Inbox action bars.',
                ctaKey: 'config.overviewNewFeatureBookmarkFormCta',
                ctaFallback: 'Add a bookmark →',
                go: { openBookmarkForm: true },
            },
            {
                titleKey: 'config.overviewNewFeatureUpdateCheckTitle',
                titleFallback: 'GitHub update check',
                whatKey: 'config.overviewNewFeatureUpdateCheckWhat',
                whatFallback: 'nextDash can compare your running version with GitHub once a day — a dot on ★, a toast while you are actively using the app, and a manual check in the ★ modal and Config → Overview.',
                howKey: 'config.overviewNewFeatureUpdateCheckHow',
                howFallback: 'Press Check for updates in the ★ modal header or on Config → Overview. When a newer release exists, open GitHub from the notice or dismiss it until the next version.',
                enableKey: 'config.overviewNewFeatureUpdateCheckEnable',
                enableFallback: 'On by default under Config → Behavior → Privacy. Turn off Check GitHub for new releases if you prefer no outbound request.',
                ctaKey: 'config.overviewNewFeatureUpdateCheckCta',
                ctaFallback: 'Open Privacy →',
                go: { section: 'behavior' },
            },
            {
                titleKey: 'config.overviewNewFeatureBookmarksFiltersTitle',
                titleFallback: 'Bookmarks filters & search',
                whatKey: 'config.overviewNewFeatureBookmarksFiltersWhat',
                whatFallback: 'Search, filter, and sort the full bookmark library from one list — with chips that show what is active and summary tiles that follow your filters.',
                howKey: 'config.overviewNewFeatureBookmarksFiltersHow',
                howFallback: 'Type in the search box (shortcuts match too), pick page or category from the dropdowns, or click a page, category, or tag on a row. Sort by last opened, most opened, or pinned first. Tick rows for bulk favicon refresh or CSV export.',
                enableKey: 'config.overviewNewFeatureBookmarksFiltersEnable',
                enableFallback: 'Open Config → Bookmarks. Scroll to load more rows; press o or double-click a row to open its URL.',
                ctaKey: 'config.overviewNewFeatureBookmarksFiltersCta',
                ctaFallback: 'Open Bookmarks →',
                go: { section: 'bookmarks' },
            },
            {
                titleKey: 'config.overviewNewFeaturePagesTagsTabsTitle',
                titleFallback: 'Categories & tags first',
                whatKey: 'config.overviewNewFeaturePagesTagsTabsWhat',
                whatFallback: 'Pages & tags now opens on Categories, with Tags right beside it — the two lists you reach for most often.',
                howKey: 'config.overviewNewFeaturePagesTagsTabsHow',
                howFallback: 'Use [ and ] to cycle sub-tabs from anywhere in config, or click Categories or Tags in the strip. Pages, Finders, and Collections follow after.',
                enableKey: 'config.overviewNewFeaturePagesTagsTabsEnable',
                enableFallback: 'Open Config → Pages & tags — Categories is selected by default.',
                ctaKey: 'config.overviewNewFeaturePagesTagsTabsCta',
                ctaFallback: 'Open Pages & tags →',
                go: { section: 'pages-tags' },
            },
            {
                titleKey: 'config.overviewNewFeatureKeyboardTitle',
                titleFallback: 'Config keyboard navigation',
                whatKey: 'config.overviewNewFeatureKeyboardWhat',
                whatFallback: 'Move through every config section, sub-tab, and list from the keyboard — no mouse required.',
                howKey: 'config.overviewNewFeatureKeyboardHow',
                howFallback: 'Use j/k or arrow keys on the section rail, [ and ] for sub-tabs, and list keys on Pages & tags and Bookmarks. Ctrl/Cmd+Shift+K opens Find settings.',
                enableKey: 'config.overviewNewFeatureKeyboardEnable',
                enableFallback: 'Press ! for the full cheat sheet, or open Help → Config navigation.',
                ctaKey: 'config.overviewNewFeatureKeyboardCta',
                ctaFallback: 'Open Help →',
                go: { section: 'help', helpTab: 'config' },
            },
            {
                titleKey: 'config.overviewNewFeatureFindSettingsTitle',
                titleFallback: 'Find settings',
                whatKey: 'config.overviewNewFeatureFindSettingsWhat',
                whatFallback: 'Jump straight to any config section, sub-tab, help topic, or field you have visited.',
                howKey: 'config.overviewNewFeatureFindSettingsHow',
                howFallback: 'Press Ctrl/Cmd+Shift+K anywhere in config, or click Find settings below Help in the left nav. Type to filter, then Enter to go.',
                enableKey: 'config.overviewNewFeatureFindSettingsEnable',
                enableFallback: 'The shortcut works on every config section; the nav button is always below Help.',
                ctaKey: 'config.overviewNewFeatureFindSettingsCta',
                ctaFallback: 'Try Find settings →',
                go: { section: 'overview' },
            },
            {
                titleKey: 'config.overviewNewFeatureBookmarkPagesTitle',
                titleFallback: 'Page-scoped bookmark categories',
                whatKey: 'config.overviewNewFeatureBookmarkPagesWhat',
                whatFallback: 'Each page keeps its own category list. The Bookmarks filter shows only categories for the page you pick.',
                howKey: 'config.overviewNewFeatureBookmarkPagesHow',
                howFallback: 'Choose a page in the filter dropdown to scope categories and deep-link with #config/bookmarks/<pageId>. With All pages, categories show as Page · Category.',
                enableKey: 'config.overviewNewFeatureBookmarkPagesEnable',
                enableFallback: 'Open Config → Bookmarks and use the page filter at the top of the list.',
                ctaKey: 'config.overviewNewFeatureBookmarkPagesCta',
                ctaFallback: 'Open Bookmarks →',
                go: { section: 'bookmarks' },
            },
            {
                titleKey: 'config.overviewNewFeatureRandomThemeTitle',
                titleFallback: 'Random theme',
                whatKey: 'config.overviewNewFeatureRandomThemeWhat',
                whatFallback: 'Let nextDash pick a different built-in theme from the pool instead of always showing your saved choice. Your saved theme remains the default whenever random is off.',
                howKey: 'config.overviewNewFeatureRandomThemeHow',
                howFallback: 'Choose Off (always your saved theme), On page refresh (new pick on each reload), or On view change (new pick when switching between bookmarks, config, inbox, health, or dashboard pages). With auto dark mode, only matching light or dark variants are eligible. While random is on, a Currently showing hint names the active theme.',
                enableKey: 'config.overviewNewFeatureRandomThemeEnable',
                enableFallback: 'Open Config → Appearance → Theme and set Random theme to the mode you want.',
                ctaKey: 'config.overviewNewFeatureRandomThemeCta',
                ctaFallback: 'Open Appearance →',
                go: { section: 'appearance', appearanceTab: 'general' },
            },
        ];
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
            <div class="config-panel config-panel--plain">
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
            <div class="config-panel config-panel--plain">
                <h3 class="config-panel-title">${esc(this.t('config.overviewWhatsNewTitle', 'Latest update'))}</h3>
                ${body}
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--small" data-overview-action="whats-new">${esc(this.t('config.showWhatsNew', 'Show what’s new'))}</button>
                </div>
            </div>`;
    }

    /**
     * A rotating handful of tips. Rotating rather than fixed so the row is worth
     * glancing at more than once; seeded by the day so it does not shuffle on
     * every repaint.
     *
     * A footer row rather than a panel: three keyboard hints did not need a
     * heading and a frame at the bottom of the page, and as a panel it read as
     * another block competing with the two above it.
     */
    renderOverviewTips() {
        const esc = (v) => this.dash.escapeHtml(v);
        const all = this.helpTips();
        if (!all.length) return '';
        const day = Math.floor(Date.now() / 86400000);
        const start = day % all.length;
        const picked = [0, 1, 2].map((i) => all[(start + i) % all.length]);

        return `
            <div class="config-overview-tips-row">
                <span class="config-overview-tips-label">${esc(this.t('config.overviewTipsTitle', 'Tips'))}</span>
                <ul class="config-overview-tips-list">${picked.map((t) => `<li class="config-help-tip">${t}</li>`).join('')}</ul>
                <div class="config-overview-tips-actions">
                    <button type="button" class="config-btn config-btn--small"
                            data-overview-go='{"section":"help"}'>${esc(this.t('config.overviewMoreTips', 'More tips →'))}</button>
                    ${this.renderCheatSheetPdfLink()}
                </div>
            </div>`;
    }

    /**
     * Link to the printable one-page shortcut sheet.
     *
     * A PDF, so it always opens in a new tab: replacing the dashboard with a
     * document viewer would lose whatever the user had open, and there is no way
     * back other than the browser's back button.
     */
    renderCheatSheetPdfLink() {
        const esc = (v) => this.dash.escapeHtml(v);
        const label = this.t('config.cheatsheetPdfLink', 'Shortcuts PDF');
        const hint = this.t('config.cheatsheetPdfHint', 'One-page keyboard reference (opens in a new tab)');
        return `<a class="config-btn config-btn--small config-cheatsheet-pdf"
                   href="/static/nextDash-cheatsheet.pdf" target="_blank" rel="noopener noreferrer"
                   title="${esc(hint)}">
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 1.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5z"/><path d="M9 1.5V5h3.5"/><path d="M6.5 8.5h3M6.5 11h3"/></svg>
                    <span>${esc(label)}</span>
                </a>`;
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
        if (d.settings?.updateCheckEnabled !== false && !document.querySelector('meta[name="nextdash-update-check-locked"]')) {
            jobs.push(this.loadUpdateStatus());
        } else {
            this._updateStatus = null;
        }
        await Promise.all(jobs);
        this.repaintOverview();
    }

    /** GitHub release status from /api/update-status (server-side check). */
    async loadUpdateStatus() {
        try {
            const res = await fetch('/api/update-status', { cache: 'no-store' });
            this._updateStatus = res.ok ? await res.json() : null;
            if (this.dash) this.dash.updateStatus = this._updateStatus;
            window.dispatchEvent(new CustomEvent('nextdash:update-status', { detail: this._updateStatus }));
        } catch {
            this._updateStatus = null;
        }
    }

    async runUpdateCheck() {
        if (!window.nextdashUpdateCheckEnabled?.()) return;
        this._updateStatusChecking = true;
        this.repaintOverview();
        try {
            await window.nextdashRunUpdateCheck?.();
            this._updateStatus = this.dash.updateStatus ?? null;
        } finally {
            this._updateStatusChecking = false;
            this.repaintOverview();
        }
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
        const body = container.querySelector('#config-view-body');
        if (!body || body.dataset.overviewClickBound) return;
        body.dataset.overviewClickBound = '1';
        body.addEventListener('click', (e) => {
            if (this.section !== 'overview') return;
            if (e.target.closest('[data-overview-feature="prev"]')) {
                this.stepOverviewFeature(-1);
                return;
            }
            if (e.target.closest('[data-overview-feature="next"]')) {
                this.stepOverviewFeature(1);
                return;
            }
            const go = e.target.closest('[data-overview-go]');
            if (go) {
                this.handleOverviewGo(go);
                return;
            }
            if (e.target.closest('[data-overview-action="whats-new"]')) {
                void this.openWhatsNew();
                return;
            }
            if (e.target.closest('[data-overview-action="check-update"]')) {
                void this.runUpdateCheck();
                return;
            }
            if (e.target.closest('[data-overview-action="dismiss-update"]')) {
                const tag = this._updateStatus?.latest || this.dash.updateStatus?.latest;
                window.nextdashDismissUpdateNotice?.(tag);
            }
        });
        body.addEventListener('keydown', (e) => {
            if (this.section !== 'overview') return;
            if (!e.target.closest('.config-new-features-carousel')) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.stepOverviewFeature(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.stepOverviewFeature(1);
            }
        });
    }

    handleOverviewGo(btn) {
        let target;
        try {
            target = JSON.parse(btn.getAttribute('data-overview-go') || '{}');
        } catch {
            return;
        }
        if (target.section) {
            if (target.bmPageFilter != null) {
                this.bmPageFilter = String(target.bmPageFilter);
            }
            if (target.helpTab && target.section === 'help') {
                this.helpTab = target.helpTab;
            }
            if (target.appearanceTab && target.section === 'appearance') {
                if (this.section !== 'appearance') {
                    this.selectSection('appearance');
                }
                void this.switchAppearanceTab(target.appearanceTab);
                return;
            }
            // Behavior has no switchAppearanceTab equivalent — the tab is only
            // changed by its own strip — so the field is set before the section
            // renders, which is what the strip itself reads.
            if (target.behaviorTab && target.section === 'behavior') {
                this.behaviorTab = target.behaviorTab;
                if (this.section === 'behavior') {
                    this.render();
                    return;
                }
            }
            this.selectSection(target.section);
            if (target.bmPageFilter != null) {
                void this.onBookmarksPageFilterChange();
            }
            return;
        }
        if (target.openBookmarkForm) {
            this.closeConfigView();
            window.dashboardInstance?.openBookmarkFormModal?.({ mode: 'create', source: 'config-overview' });
            return;
        }
        if (target.view) return this.openViewFromTile(target.view, target.filter);
    }

    /* ── Section navigation ────────────────────────────────────────────────── */

    selectSection(section, via = 'click') {
        if (!DashboardConfig.SECTIONS.includes(section) || section === this.section) {
            return;
        }
        this.clearListKeyboardSelection();
        this.clearBookmarkKeyboardSelection();
        this.section = section;
        this._trackAction('section', { section, via });
        this.render();
        this.restoreConfigHash();
    }

    bindSectionNav(container) {
        const buttons = [...container.querySelectorAll('[data-config-section]')];
        const searchBtn = container.querySelector('[data-config-action="settings-jump"]');
        const focusables = searchBtn ? [...buttons, searchBtn] : buttons;

        const moveFocus = (fromEl, key) => {
            const idx = focusables.indexOf(fromEl);
            if (idx < 0) return;
            const last = focusables.length - 1;
            const nextIdx = key === 'Home' ? 0
                : key === 'End' ? last
                    : (key === 'ArrowDown' || key === 'ArrowRight') ? (idx === last ? 0 : idx + 1)
                        : (idx === 0 ? last : idx - 1);
            const target = focusables[nextIdx];
            if (!target) return;
            if (target === searchBtn) {
                target.focus();
                return;
            }
            const section = target.getAttribute('data-config-section');
            target.focus();
            this.selectSection(section, 'keyboard');
            if (!target.isConnected) {
                document.querySelector(`[data-config-section="${CSS.escape(section)}"]`)?.focus();
            }
        };

        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                this.selectSection(btn.getAttribute('data-config-section'), 'click');
            });
            btn.addEventListener('keydown', (e) => {
                const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
                if (!keys.includes(e.key)) return;
                e.preventDefault();
                moveFocus(btn, e.key);
            });
        });

        searchBtn?.addEventListener('click', () => this.openSettingsJump());
        searchBtn?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.openSettingsJump();
                return;
            }
            const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
            if (!keys.includes(e.key)) return;
            e.preventDefault();
            moveFocus(searchBtn, e.key);
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

    /**
     * A tile hands off to the view that acts on it (health with a filter, inbox).
     *
     * `focusKey` is a health issue key (`pageId:index`) to select on arrival —
     * used by "Show in Health" on a single bookmark. focusIssue widens the
     * filter by itself when the row would otherwise be hidden, so it is passed
     * instead of a filter rather than alongside one.
     */
    openViewFromTile(view, filter, focusKey = null) {
        const d = this.dash;
        // The overview's "something needs attention" rows. Worth separating from
        // an ordinary view:health, because it says the summary is what sent
        // people there — and which problem type did it.
        this._trackAction('tile-open', { view, ...(filter ? { filter } : {}) });
        if (view === 'health' && d.health?.openHealthView) {
            return (async () => {
                await d.health.openHealthView();
                const mod = d.health.instance;
                if (filter && mod) {
                    mod.filter = filter;
                    if (mod.isActiveView?.()) {
                        mod.render();
                    }
                }
                if (focusKey && mod?.focusIssue) {
                    mod.focusIssue(focusKey);
                }
            })();
        }
        if (view === 'inbox' && d.inbox?.openInboxView) {
            return d.inbox.openInboxView();
        }
        return Promise.resolve();
    }

    /* ── Data & backups ────────────────────────────────────────────────────── */

    notify(message, type = 'info', options = {}) {
        this.dash.showNotification?.(message, type, { duration: 3500, ...options });
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

        const tabs = DashboardConfig.DB_TABS.map((tab) => {
            const active = tab === this.dbTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-db-body" data-db-tab="${esc(tab)}">${esc(this.dbTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.dataBackupsIntro', 'Back up your data, restore an earlier snapshot, or move it in and out of nextDash.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div id="config-db-body" role="tabpanel" tabindex="0">${this.renderDbTab()}</div>
        `;
    }

    /** Which sub-tab of Data & backups is showing. */
    renderDbTab() {
        return this.dbTab === 'reset' ? this.renderDataReset() : this.renderDataBackupsMain();
    }

    dbTabLabel(tab) {
        const map = {
            backups: ['config.dbTabBackups', 'Backups & data'],
            reset: ['config.dbTabReset', 'Reset'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    }

    /** Everything except the destructive actions, which live on their own tab. */
    renderDataBackupsMain() {
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

        `;
    }

    /**
     * The destructive actions, kept on their own tab so they cannot be hit while
     * scrolling through backup settings. Both ask twice, and the full reset also
     * makes you type the confirmation word.
     */
    renderDataReset() {
        const esc = (v) => this.dash.escapeHtml(v);
        const token = this.t('config.resetTypeToken', 'RESET');
        return `
            <p class="config-view-intro">${esc(this.t('config.resetIntro', 'These actions permanently remove data. Make a backup first — there is no undo.'))}</p>

            <div class="config-panel config-panel--danger">
                <h3 class="config-panel-title">${esc(this.t('config.deleteAllBookmarksTitle', 'Delete all bookmarks'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.deleteAllBookmarksHint', 'Removes every bookmark but keeps your pages, categories, and settings.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--danger" data-backup-action="delete-bookmarks">${esc(this.t('config.deleteAllBookmarksBtn', 'Delete all bookmarks only'))}</button>
                </div>
            </div>

            <div class="config-panel config-panel--danger">
                <h3 class="config-panel-title">${esc(this.t('config.resetSectionTitle', 'Reset all data'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.backupResetNote', 'Removes every bookmark, page, and setting. This cannot be undone.'))}</p>
                <p class="config-panel-note">${esc(this.t('config.resetTypeNote', 'You will be asked to type {token} to confirm.').replace('{token}', token))}</p>
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
        this.bindSubTabStrip(container, 'data-db-tab', (tab) => {
            if (tab === this.dbTab) return;
            this.dbTab = tab;
            this.restoreConfigHash();
            // Only the body is repainted; rebuilding the strip would replace
            // the button that was just clicked.
            const body = document.getElementById('config-db-body');
            if (body) {
                // Bind the new body only: re-binding the whole container would
                // stack a second listener on every tab button.
                body.innerHTML = this.renderDbTab();
                this.bindDataBackupsActions(body);
            }
            this.syncSubTabStrip('data-db-tab', this.dbTab);
        });
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
        // Fires on intent, not on completion: the destructive ones open a
        // confirm dialog, and how often people back out is exactly what makes
        // these worth measuring. `data-backup-action` is a fixed enum.
        this._trackAction('data-action', { action });
        switch (action) {
            case 'download': this.downloadFullBackup(); break;
            case 'run': void this.runBackupNow(); break;
            case 'import': document.getElementById('config-import-input')?.click(); break;
            case 'csv-export': void this.exportBookmarksCSV(); break;
            case 'browser-import': document.getElementById('config-browser-import-input')?.click(); break;
            case 'settings-export': void this.exportSettings(); break;
            case 'settings-import': document.getElementById('config-settings-import-input')?.click(); break;
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
        if (!await this.confirmAction(this.t('config.bulkRefreshFaviconsConfirm', 'Download every bookmark icon again? This can take a while on a large dashboard.'), { confirmLabel: this.t('config.confirmContinue', 'Continue'), danger: false })) return;
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
        if (!await this.confirmAction(this.t('config.refreshAllPreviewsConfirm', 'Fetch every link preview card again from its site?'), { confirmLabel: this.t('config.confirmContinue', 'Continue'), danger: false })) return;
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
        if (!await this.confirmAction(this.t('config.clearAllPreviewsConfirm', 'Remove every cached preview card? They are fetched again when next needed.'), { confirmLabel: this.t('config.confirmClear', 'Clear') })) return;
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
        if (!await this.confirmAction(this.t('config.deleteAllBookmarksConfirm', 'Delete every bookmark? Your pages, categories and settings are kept. This cannot be undone.'))) return;
        try {
            // Same explicit confirmation flag the reset endpoint requires.
            const res = await this.writeFetch('/api/bookmarks/delete-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: true }),
            });
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

    /**
     * Fetch a file through the write-token wrapper and save it.
     *
     * A plain `window.location.href` navigation carries no write token, so
     * /api/backup answered 401 and the browser navigated to an error page
     * instead of downloading — silently, since nothing checks the result of a
     * navigation. With no backup file to be had, there was nothing to restore
     * from either.
     *
     * Same approach the old config used (config-backup.js): fetch with the
     * write headers, then hand the blob to an <a download>.
     */
    async downloadViaBlob(url, filename, errorKey, errorFallback) {
        try {
            const res = await this.writeFetch(url, { method: 'GET' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const href = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = href;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(href);
            a.remove();
            return true;
        } catch {
            this.notify(this.t(errorKey, errorFallback), 'error');
            return false;
        }
    }

    async downloadFullBackup() {
        const stamp = new Date().toISOString().replace('T', '_').replace(/\..+/, '').replace(/:/g, '-');
        const ok = await this.downloadViaBlob('/api/backup', `nextDash-backup-${stamp}.zip`,
            'config.backupError', 'Could not create the backup.');
        if (ok) this.notify(this.t('config.backupCreated', 'Backup downloaded.'), 'success');
    }

    downloadStoredBackup(name) {
        // This endpoint needs no write token, but routing it through the same
        // helper means one download path to keep working rather than two.
        return this.downloadViaBlob(
            `/api/auto-backups/download?name=${encodeURIComponent(name)}`, name,
            'config.autoBackupDownloadError', 'Could not download the backup.');
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
        const ok = await this.confirmAction(this.t('config.backupRestoreConfirm', 'Restore this backup? Current data will be replaced.'), { confirmLabel: this.t('config.autoBackupRestore', 'Restore') });
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
        const ok = await this.confirmAction(this.t('config.backupDeleteConfirm', 'Delete this backup?'));
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
        const ok = await this.confirmAction(this.t('config.backupImportConfirm', 'Import this backup? Current data will be replaced.'), { confirmLabel: this.t('config.confirmImport', 'Import') });
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
        const ok = await this.confirmAction(this.t('config.backupResetConfirm', 'Delete ALL data? This cannot be undone.'));
        if (!ok) return;
        // Second gate: the reader types the word before this can fire.
        const token = this.t('config.resetTypeToken', 'RESET');
        const typed = await this.confirmTypedAction(
            this.t('config.resetTypePrompt', 'Type {token} to confirm this permanent reset:').replace('{token}', token),
            token,
        );
        if (!typed) return;
        try {
            // The server rejects a reset without an explicit confirmation flag.
            const res = await this.writeFetch('/api/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: true }),
            });
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
        const ok = await this.confirmAction(
            this.t('config.browserImportConfirm', 'Import {n} bookmarks onto the current page?').replace('{n}', String(bookmarks.length)),
            { confirmLabel: this.t('config.confirmImport', 'Import'), danger: false }
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
        const ok = await this.confirmAction(this.t('config.settingsImportConfirmMessage', 'This will overwrite your current settings. Continue?'), { confirmLabel: this.t('config.confirmImport', 'Import') });
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
        const ok = await this.confirmAction(this.t('config.resetOnboardingConfirm', 'Replay the welcome tour and tips next time?'), { confirmLabel: this.t('config.confirmContinue', 'Continue'), danger: false });
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

    /**
     * A summary of everything the section controls, not just the theme.
     *
     * Six tiles cover each Appearance panel below; the grid keeps them on one
     * row at common widths (see config-tiles--text in config-view.css).
     */
    appearanceTiles() {
        const s = this.dash.settings || {};
        const themeId = s.theme || 'dark';
        const theme = this.themeDisplayName(themeId, this._themeList?.[themeId]);

        const bgType = s.backgroundType || 'none';
        const bgLabel = {
            auto: this.t('config.backgroundAuto', 'Auto'),
            none: this.t('config.backgroundNone', 'None'),
            gradient: this.t('config.backgroundGradient', 'Gradient'),
            image: this.t('config.backgroundImage', 'Image'),
        }[bgType] || bgType;

        const layoutModern = s.layoutVersion === 'modern';
        const density = s.densityMode || 'comfortable';
        const densityLabel = {
            comfortable: this.t('config.densityComfortable', 'Comfortable'),
            compact: this.t('config.densityCompact', 'Compact'),
            dense: this.t('config.densityDense', 'Dense'),
            auto: this.t('config.densityAuto', 'Auto'),
        }[density] || density;

        const preset = window.DashboardFont?.resolveActiveFontPreset?.(s) || s.fontPreset || 'source-code-pro';
        const customThemeCount = Object.keys(this._colorsData?.custom || {}).length;

        return [
            {
                key: 'theme', tone: 'accent',
                label: this.t('config.tileActiveTheme', 'Active theme'),
                value: theme,
                detail: s.autoDarkMode ? this.t('config.autoDarkOn', 'Auto dark mode on') : '',
            },
            {
                key: 'font', tone: 'neutral',
                label: this.t('config.tileTypeface', 'Typeface'),
                value: this.fontPresetLabel(preset),
                detail: this.t('config.tileFontSizeDetail', 'Size {size}')
                    .replace('{size}', this.fontSizeLabel(this.currentFontSize())),
            },
            {
                key: 'background', tone: 'neutral',
                label: this.t('config.tileBackground', 'Background'),
                value: bgLabel,
                // Opacity only means something once there is something to fade.
                detail: bgType !== 'none' && Number.isFinite(Number(s.backgroundOpacity))
                    ? `${Math.round(Number(s.backgroundOpacity) * 100)}%`
                    : '',
            },
            {
                key: 'layout', tone: layoutModern ? 'warn' : 'neutral',
                label: this.t('config.tileLayout', 'Layout'),
                value: layoutModern
                    ? this.t('config.layoutModern', 'Modern')
                    : this.t('config.layoutClassic', 'Classic'),
                detail: layoutModern ? this.t('config.layoutBetaShort', 'Early beta') : '',
            },
            {
                key: 'density', tone: 'neutral',
                label: this.t('config.tileDensity', 'Density'),
                value: densityLabel,
                detail: this.t('config.tileColumnsDetail', '{n} columns')
                    .replace('{n}', String(Number(s.columnsPerRow) || 4)),
            },
            {
                key: 'custom-themes', tone: 'neutral',
                label: this.t('config.tileCustomThemes', 'Custom themes'),
                value: customThemeCount,
                // Only offered once the colour document has actually loaded.
                action: this._colorsData ? { appearanceTab: 'custom-themes' } : null,
                detail: customThemeCount === 0
                    ? this.t('config.tileCustomThemesNone', 'None yet')
                    : '',
            },
        ];
    }

    renderAppearance() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        const theme = s.theme === 'light' ? 'light' : 'dark';
        const tiles = `<div class="config-tiles config-tiles--text" role="list">${this.appearanceTiles().map((t) => this.renderTile(t)).join('')}</div>`;

        const fontOptions = DashboardConfig.FONT_SIZES.map((size) => {
            const active = size === this.currentFontSize();
            return `<button type="button" class="config-choice${active ? ' is-active' : ''}" data-appearance-font="${esc(size)}" aria-pressed="${active ? 'true' : 'false'}">${esc(this.fontSizeLabel(size))}</button>`;
        }).join('');

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

        const bgType = s.backgroundType || 'none';
        const bgTypes = [['auto', this.t('config.backgroundAuto', 'Auto')], ['none', this.t('config.backgroundNone', 'None')], ['gradient', this.t('config.backgroundGradient', 'Gradient')], ['image', this.t('config.backgroundImage', 'Image')]];
        const bgChoices = bgTypes.map(([val, label]) =>
            `<button type="button" class="config-choice${bgType === val ? ' is-active' : ''}" data-appearance-bg="${esc(val)}" aria-pressed="${bgType === val}">${esc(label)}</button>`
        ).join('');
        const opacity = window.VisualSettings?.clampBackgroundOpacity
            ? window.VisualSettings.clampBackgroundOpacity(s.backgroundOpacity)
            : (Number.isFinite(Number(s.backgroundOpacity)) ? Number(s.backgroundOpacity) : 1);
        const randomMode = window.ThemeUtils?.normalizeRandomThemeMode?.(s) ?? s.randomThemeMode ?? 'off';
        const showingThemeId = randomMode !== 'off'
            ? (document.documentElement.getAttribute('data-theme')
                || window.VisualSettings?.resolveTheme?.(s)
                || s.theme
                || 'dark')
            : '';
        const randomShowingHint = randomMode !== 'off'
            ? `<p class="config-field-hint">${esc(this.t('config.randomThemeShowingHint', 'Currently showing: {theme}').replace('{theme}', this.themeDisplayName(showingThemeId, this._themeList?.[showingThemeId])))}</p>`
            : '';

        // Picking "Gradient" or "Image" only sets the type; these sub-sections
        // are what actually choose one, so the type buttons do not dead-end.
        const bgPresets = window.VisualSettings?.BACKGROUND_PRESETS || {};
        const activeGradient = s.backgroundGradient || '';
        const gradientSwatches = Object.entries(bgPresets).map(([name, css]) =>
            `<button type="button" class="config-bg-swatch${activeGradient === name ? ' is-active' : ''}"
                     data-appearance-gradient="${esc(name)}" style="background:${esc(css)}"
                     aria-pressed="${activeGradient === name}"
                     aria-label="${esc(this.t(`config.backgroundPreset.${name}`, name))}"
                     title="${esc(this.t(`config.backgroundPreset.${name}`, name))}"></button>`).join('');
        const bgDetail = bgType === 'auto'
            ? `<p class="config-field-hint">${esc(this.t('config.backgroundAutoHint', 'A gradient matched to your active theme.'))}</p>`
            : bgType === 'gradient'
            ? `<div class="config-field">
                   <span class="config-field-label">${esc(this.t('config.backgroundGradientLabel', 'Gradient'))}</span>
                   <div class="config-bg-swatches" role="group">${gradientSwatches}</div>
                   <p class="config-field-hint">${esc(this.t('config.backgroundGradientHint', 'Thirteen presets, from dark to light. Pair a light gradient with a light theme.'))}</p>
               </div>`
            : bgType === 'image'
                ? `<div class="config-field">
                       <span class="config-field-label">${esc(this.t('config.backgroundImageUrlLabel', 'Image URL'))}</span>
                       <input type="url" class="config-text" data-appearance-text="backgroundImageUrl"
                              value="${esc(s.backgroundImageUrl || '')}" placeholder="https://example.com/image.jpg">
                       <p class="config-field-hint">${esc(this.t('config.backgroundImageUrlHint', 'A direct link to an image file. Lower the opacity below if it makes the bookmarks hard to read.'))}</p>
                   </div>`
                : '';

        const apTabs = DashboardConfig.APPEARANCE_TABS.map((tab) => {
            const active = tab === this.appearanceTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-appearance-body" data-appearance-tab="${esc(tab)}">${esc(this.appearanceTabLabel(tab))}</button>`;
        }).join('');

        const shell = (body) => `
            <p class="config-view-intro">${esc(this.t('config.appearanceIntro', 'Theme, type, and layout. Changes apply immediately and are saved.'))}</p>
            <div class="config-subtabs" role="tablist">${apTabs}</div>
            <div id="config-appearance-body" role="tabpanel" tabindex="0">${body}</div>`;

        if (this.appearanceTab === 'custom-themes') {
            return shell(this.renderCustomThemes());
        }
        if (this.appearanceTab === 'layout') {
            return shell(this.renderAppearanceLayoutBody());
        }
        if (this.appearanceTab === 'display') {
            return shell(this.renderAppearanceDisplayBody());
        }
        if (this.appearanceTab === 'toolbar') {
            return shell(this.renderAppearanceToolbarBody());
        }
        if (this.appearanceTab === 'branding') {
            return shell(this.renderAppearanceBrandingBody());
        }

        return shell(`
            ${tiles}

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceThemeTitle', 'Theme'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.appearanceThemeNote', 'Pick a built-in theme or follow your system. Edit the colours of any theme, or build your own, in the theme editor.'))}</p>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.themeLabel', 'Theme'))}</span>
                    <select class="config-select" data-appearance-select="theme">${this.renderThemeOptions()}</select>
                    ${this.appearanceAff('theme')}
                </div>
                ${randomShowingHint}
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.appearanceMode', 'Quick mode'))}</span>
                    <div class="config-choices" role="group">
                        <button type="button" class="config-choice${theme === 'light' ? ' is-active' : ''}" data-appearance-theme="light" aria-pressed="${theme === 'light'}">${esc(this.t('config.themeLight', 'Light'))}</button>
                        <button type="button" class="config-choice${theme === 'dark' ? ' is-active' : ''}" data-appearance-theme="dark" aria-pressed="${theme === 'dark'}">${esc(this.t('config.themeDark', 'Dark'))}</button>
                    </div>
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.appearanceAutoDark', 'Follow system dark mode'))}</span>
                    <label class="config-toggle">
                        <input type="checkbox" data-appearance-toggle="autoDarkMode" ${s.autoDarkMode ? 'checked' : ''}>
                    </label>
                    ${this.appearanceAff('autoDarkMode')}
                </div>
                <div class="config-field" data-config-setting-promo-anchor="randomThemeMode">
                    <span class="config-field-label">${esc(this.t('config.randomThemeModeLabel', 'Random theme'))}</span>
                    <div class="config-choices" role="group">${this.renderRandomThemeModeChoices(s)}</div>
                    ${this.appearanceAff('randomThemeMode')}
                </div>
                ${this.renderIconStyling()}
                <div class="config-actions" style="margin-top:14px">
                    <button type="button" class="config-btn" data-appearance-action="edit-colors">${esc(this.t('config.openBuiltInColorsLink', 'Open the theme editor…'))}</button>
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceTypeTitle', 'Type'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.appearanceTypeNote', 'The typeface, weight, and size used across the dashboard. Upload a font file to use one that is not listed.'))}</p>
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
                <p class="config-panel-note">${esc(this.t('config.appearanceBackgroundNote', 'What sits behind the bookmarks. Auto follows your theme; Gradient and Image let you choose your own, and opacity fades it back so the text stays readable.'))}</p>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.backgroundLabel', 'Background'))}</span>
                    <div class="config-choices" role="group">${bgChoices}</div>
                    ${this.appearanceAff('backgroundType')}
                </div>
                ${bgDetail}
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.backgroundOpacityLabel', 'Opacity'))}</span>
                    <input type="range" class="config-range" data-appearance-range="backgroundOpacity" min="0.65" max="1" step="0.05" value="${opacity}">
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
            </div>`);
    }

    /**
     * Which buttons and tabs the dashboard chrome shows. Its own tab rather than
     * a panel under Display: twelve visibility toggles plus the button-bar
     * position buried the three everyday row options they sat beneath.
     */
    renderAppearanceToolbarBody() {
        return this.renderControlPanels(
            this.behaviorSchema().filter((p) => p.tab === 'toolbar'),
            'behavior'
        );
    }

    renderAppearanceBrandingBody() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.generalGroupBranding', 'Branding'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.appearanceBrandingNote', 'The page title and favicon this dashboard uses in the browser tab.'))}</p>
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
            </div>`;
    }

    renderAppearanceLayoutBody() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        const layout = s.layoutVersion === 'modern' ? 'modern' : 'classic';
        const iconSize = s.launcherIconSize || 'normal';
        const iconSizes = [['small', this.t('config.launcherIconSizeSmall', 'Small')], ['normal', this.t('config.launcherIconSizeNormal', 'Normal')], ['large', this.t('config.launcherIconSizeLarge', 'Large')]];
        const iconSizeChoices = iconSizes.map(([val, label]) =>
            `<button type="button" class="config-choice${iconSize === val ? ' is-active' : ''}" data-appearance-iconsize="${esc(val)}" aria-pressed="${iconSize === val}">${esc(label)}</button>`
        ).join('');

        // These five are the only values the server accepts; it silently
        // rewrites anything else to 'bottom'. See models.go.
        const barPosition = ['bottom', 'bottom-left', 'bottom-right', 'side-left', 'side-right']
            .includes(s.buttonBarPosition) ? s.buttonBarPosition : 'bottom';
        // Short labels: the full ones carry "(default)" and "corner", which is
        // more than a button in a five-up group can show.
        const barPositions = [
            ['bottom', this.t('config.buttonBarPositionBottomShort', 'Center-bottom')],
            ['bottom-left', this.t('config.buttonBarPositionLeftShort', 'Bottom-left')],
            ['bottom-right', this.t('config.buttonBarPositionRightShort', 'Bottom-right')],
            ['side-left', this.t('config.buttonBarPositionSideLeftShort', 'Rail left')],
            ['side-right', this.t('config.buttonBarPositionSideRightShort', 'Rail right')],
        ];
        const barChoices = barPositions.map(([val, label]) =>
            `<button type="button" class="config-choice${barPosition === val ? ' is-active' : ''}" data-appearance-barpos="${esc(val)}" aria-pressed="${barPosition === val}">${esc(label)}</button>`
        ).join('');

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceLayoutVersionTitle', 'Layout version'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.layoutVersionDescIntro', 'Choose a layout style. Classic is recommended; Modern is still in early beta.'))}</p>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.appearanceLayoutVersion', 'Layout'))}</span>
                    <div class="config-choices" role="group">
                        <button type="button" class="config-choice${layout === 'classic' ? ' is-active' : ''}" data-appearance-layout="classic" aria-pressed="${layout === 'classic'}">${esc(this.t('config.layoutClassic', 'Classic'))}</button>
                        <button type="button" class="config-choice${layout === 'modern' ? ' is-active' : ''}" data-appearance-layout="modern" aria-pressed="${layout === 'modern'}">${esc(this.t('config.layoutModern', 'Modern'))}</button>
                    </div>
                    ${this.appearanceAff('layoutVersion')}
                    ${layout === 'modern'
                        ? `<p class="config-field-warning">${esc(this.t('config.layoutVersionBetaNotice', 'Modern is still in early beta and not finished yet. Classic is recommended for the best experience.'))}</p>`
                        : ''}
                    <p class="config-field-hint">${esc(this.t(`config.layoutVersionDesc.${layout}`, ''))}</p>
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.launcherIconSizeLabel', 'Icon size'))}</span>
                    <div class="config-choices" role="group">${iconSizeChoices}</div>
                    ${this.appearanceAff('launcherIconSize')}
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.buttonBarPositionTitle', 'Button bar'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.buttonBarPositionNote', 'Where the add, search, commands, and finders buttons sit on the dashboard. Center-bottom floats them above the bookmarks; the corner docks tuck them out of the way; the side rail stacks them vertically down the left edge.'))}</p>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.buttonBarPositionLabel', 'Button bar position'))}</span>
                    <div class="config-choices" role="group">${barChoices}</div>
                    ${this.appearanceAff('buttonBarPosition')}
                    <p class="config-field-hint">${esc(this.t(`config.buttonBarPositionDesc.${barPosition}`, ''))}</p>
                </div>
            </div>
            ${this.renderControlPanels(this.behaviorSchema().filter((p) => p.tab === 'layout'), 'behavior')}`;
    }

    renderAppearanceDisplayBody() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceDisplayQuickTitle', 'Quick display options'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.appearanceDisplayQuickNote', 'Everyday bookmark row options. Toolbar and tab visibility live on their own tab.'))}</p>
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
            ${this.renderControlPanels(this.behaviorSchema().filter((p) => p.tab === 'display'), 'behavior')}`;
    }

    /** Friendly name for a theme id, matching the old config's labels. */
    themeDisplayName(themeId, name) {
        if (themeId === 'dark') return this.t('config.themeOldDefaultDark', 'Old Default [dark]');
        if (themeId === 'light') return this.t('config.themeOldDefaultLight', 'Old Default [light]');
        if (name && String(name).trim()) return String(name);
        return themeId;
    }

    renderRandomThemeModeChoices(settings) {
        const esc = (v) => this.dash.escapeHtml(v);
        const current = window.ThemeUtils?.normalizeRandomThemeMode?.(settings)
            || settings?.randomThemeMode
            || 'off';
        const modes = [
            ['off', 'config.randomThemeModeOff', 'Off'],
            ['refresh', 'config.randomThemeModeRefresh', 'On page refresh'],
            ['view', 'config.randomThemeModeView', 'On view change'],
        ];
        return modes.map(([value, labelKey, fallback]) =>
            `<button type="button" class="config-choice${value === current ? ' is-active' : ''}" data-appearance-randommode="${esc(value)}" aria-pressed="${value === current}">${esc(this.t(labelKey, fallback))}</button>`
        ).join('');
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
        this.bindSubTabStrip(container, 'data-appearance-tab', (tab) => {
            void this.switchAppearanceTab(tab);
        });
        container.querySelectorAll('[data-tile-appearance-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                void this.switchAppearanceTab(btn.getAttribute('data-tile-appearance-tab'));
            });
        });
        this.bindCustomThemes(container);
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
        container.querySelectorAll('[data-appearance-randommode]').forEach((btn) => {
            btn.addEventListener('click', () => this.setAppearanceSelect('randomThemeMode', btn.getAttribute('data-appearance-randommode')));
        });
        container.querySelectorAll('[data-appearance-bg]').forEach((btn) => {
            btn.addEventListener('click', () => this.setBackgroundType(btn.getAttribute('data-appearance-bg')));
        });
        container.querySelectorAll('[data-appearance-gradient]').forEach((btn) => {
            btn.addEventListener('click', () => this.setBackgroundGradient(btn.getAttribute('data-appearance-gradient')));
        });
        // `change`, not `input`: saving mid-URL would fetch half-typed addresses.
        const bgUrl = container.querySelector('[data-appearance-text="backgroundImageUrl"]');
        if (bgUrl) {
            bgUrl.addEventListener('change', () => this.setBackgroundImageUrl(bgUrl.value));
        }
        container.querySelectorAll('[data-appearance-iconsize]').forEach((btn) => {
            btn.addEventListener('click', () => this.setLauncherIconSize(btn.getAttribute('data-appearance-iconsize')));
        });
        container.querySelectorAll('[data-appearance-barpos]').forEach((btn) => {
            btn.addEventListener('click', () => this.setButtonBarPosition(btn.getAttribute('data-appearance-barpos')));
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
                const val = window.VisualSettings?.clampBackgroundOpacity
                    ? window.VisualSettings.clampBackgroundOpacity(range.value)
                    : Number(range.value);
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
        // Favicon harmonisation: the on/off and style buttons repaint (they change
        // which controls are shown); the slider updates live so it keeps the pointer.
        container.querySelectorAll('[data-appearance-toggle-icons]').forEach((btn) => {
            btn.addEventListener('click', () => {
                void this.setIconStyling({ enabled: btn.getAttribute('data-appearance-toggle-icons') === 'on' });
            });
        });
        container.querySelectorAll('[data-appearance-iconstyle]').forEach((btn) => {
            btn.addEventListener('click', () => {
                void this.setIconStyling({ style: btn.getAttribute('data-appearance-iconstyle') });
            });
        });
        const iconRange = container.querySelector('[data-appearance-icon-intensity]');
        if (iconRange) {
            iconRange.addEventListener('input', () => {
                const val = Number(iconRange.value);
                const out = iconRange.parentElement?.querySelector('.config-range-value');
                if (out) out.textContent = `${Math.round(val * 100)}%`;
                iconRange.parentElement?.querySelectorAll('.config-icon-preview-dot').forEach((dot) => {
                    dot.style.setProperty('--icon-theme-intensity', String(val));
                });
                const nextEntry = { ...this.iconStylingEntry(), intensity: val };
                const map = { ...(this.dash.settings.themeIconStyling || {}) };
                for (const key of this.iconStylingThemeKeysForWrite()) {
                    map[key] = { ...nextEntry };
                }
                this.dash.settings.themeIconStyling = map;
                window.ThemeIconStyling?.applyThemeIconStylingToDocument?.(this.dash.settings);
            });
            iconRange.addEventListener('change', () => {
                void this.setIconStyling({ intensity: Number(iconRange.value) }, { repaint: false });
            });
        }
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
        if (['layout', 'display', 'toolbar'].includes(this.appearanceTab)) {
            this.bindControlPanels(container, 'behavior');
        }
        this.bindFormKeyboard(container);
    }

    /** Wait for any in-flight settings write before swapping appearance tabs. */
    async switchAppearanceTab(tab) {
        if (tab === this.appearanceTab) return;
        if (this._settingsSavePromise) {
            await this._settingsSavePromise;
        }
        if (this._colorsSavePromise) {
            await this._colorsSavePromise;
        }
        await this.loadColorsData();
        // Leaving the editor for General while a custom theme is selected should
        // apply that theme first — otherwise harmonisation and other appearance
        // controls still target settings.theme (the old choice).
        if (tab === 'general' && this._themeSelected
            && (this.isCustomTheme(this._themeSelected)
                || window.ThemeUtils?.isUserCustomThemeId?.(this._themeSelected))
            && this.dash.settings?.theme !== this._themeSelected) {
            this.clearThemePreview();
            await this.applyThemeChoice(this._themeSelected);
        }
        this.appearanceTab = tab;
        this.restoreConfigHash();
        // Leaving the tab drops any unsaved preview so the dashboard
        // does not keep showing colours from a theme you stopped editing.
        if (tab !== 'custom-themes') this.clearThemePreview();
        this.render();
        if (tab === 'custom-themes') await this.openCustomThemes();
    }

    /** Persist a settings change and repaint the appearance section. */
    persistAppearance() {
        const savePromise = this.saveSettingsWithFeedback();
        if (this.isActiveView() && this.section === 'appearance') {
            void savePromise.finally(() => {
                if (!this.isActiveView() || this.section !== 'appearance') {
                    return;
                }
                const body = document.getElementById('config-view-body');
                if (body) {
                    body.innerHTML = this.renderAppearance();
                    const container = document.getElementById('dashboard-layout');
                    if (container) this.bindAppearanceControls(container);
                }
            });
        }
        return savePromise;
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
        const base = window.VisualSettings?.effectiveBaseTheme?.(s)
            || window.ThemeLoader?.getEffectiveBaseTheme?.(s, stored)
            || stored;
        const resolved = window.ThemeLoader?.resolveDisplayTheme?.(base, s.autoDarkMode === true);
        return resolved || base;
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

    appearanceTabLabel(tab) {
        const map = {
            general: ['config.appearanceTabGeneral', 'Theme'],
            layout: ['config.appearanceTabLayout', 'Layout'],
            display: ['config.appearanceTabDisplay', 'Display'],
            toolbar: ['config.appearanceTabToolbar', 'Toolbar & tabs'],
            branding: ['config.appearanceTabBranding', 'Branding'],
            'custom-themes': ['config.appearanceTabCustomThemes', 'Custom themes'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    }

    /* ── Custom themes (native) ────────────────────────────────────────────── */

    /**
     * The colour fields a theme carries, in the order they are edited.
     *
     * Mirrors ThemeColors in models.go. Grouped the way the old config grouped
     * them, because "text / surfaces / accents" is how people actually think
     * about a palette, not the flat struct order.
     */
    static THEME_COLOR_GROUPS = [
        ['themeGroupText', 'Text', ['textPrimary', 'textSecondary', 'textTertiary']],
        ['themeGroupSurfaces', 'Surfaces', ['backgroundPrimary', 'backgroundSecondary', 'backgroundDots', 'backgroundModal', 'borderPrimary', 'borderSecondary']],
        ['themeGroupAccents', 'Accents', ['accentSuccess', 'accentWarning', 'accentError']],
    ];

    themeColorLabel(prop) {
        const map = {
            textPrimary: ['config.colorTextPrimary', 'Primary text'],
            textSecondary: ['config.colorTextSecondary', 'Secondary text'],
            textTertiary: ['config.colorTextTertiary', 'Tertiary text'],
            backgroundPrimary: ['config.colorBackgroundPrimary', 'Background'],
            backgroundSecondary: ['config.colorBackgroundSecondary', 'Panels'],
            backgroundDots: ['config.colorBackgroundDots', 'Dot grid'],
            backgroundModal: ['config.colorBackgroundModal', 'Modals'],
            borderPrimary: ['config.colorBorderPrimary', 'Borders'],
            borderSecondary: ['config.colorBorderSecondary', 'Subtle borders'],
            accentSuccess: ['config.colorAccentSuccess', 'Accent'],
            accentWarning: ['config.colorAccentWarning', 'Warning'],
            accentError: ['config.colorAccentError', 'Error'],
        };
        const [key, fallback] = map[prop] || [prop, prop];
        return this.t(key, fallback);
    }

    /** GET /api/colors once; the editor mutates this copy and POSTs it back. */
    async loadColorsData() {
        if (this._colorsData) return this._colorsData;
        try {
            const res = await fetch('/api/colors');
            const data = res && res.ok ? await res.json() : null;
            this._colorsData = data && typeof data === 'object' ? data : { light: {}, dark: {}, builtIn: {}, custom: {} };
        } catch {
            this._colorsData = { light: {}, dark: {}, builtIn: {}, custom: {} };
        }
        if (!this._colorsData.custom || typeof this._colorsData.custom !== 'object') {
            this._colorsData.custom = {};
        }
        this.syncCustomThemeIds();
        return this._colorsData;
    }

    /** Keep custom-theme id lists in sync for pairing and harmonisation helpers. */
    syncCustomThemeIds() {
        const ids = Object.keys(this._colorsData?.custom || {});
        if (window.ThemeUtils?.setCustomThemeIds) {
            window.ThemeUtils.setCustomThemeIds(ids);
        } else {
            window.UserCustomThemeIds = ids;
            window.CustomThemeIds = ids;
            document.documentElement?.setAttribute('data-custom-theme-ids', ids.join(','));
        }
    }

    /**
     * Resolve a theme by id across all three buckets.
     *
     * A palette lives in one of three places: the light/dark pair at the top
     * level, the packaged set under builtIn, or the user's own under custom.
     * The editor treats them uniformly, so every read goes through here rather
     * than reaching into .custom and silently returning undefined for the rest.
     */
    themeById(id) {
        const d = this._colorsData;
        if (!d || !id) return null;
        if (id === 'light' || id === 'dark') return d[id] || null;
        return d.custom?.[id] || d.builtIn?.[id] || null;
    }

    /** Only the user's own themes can be renamed, reordered or deleted. */
    isCustomTheme(id) {
        return Boolean(this._colorsData?.custom?.[id]);
    }

    renderCustomThemes() {
        const esc = (v) => this.dash.escapeHtml(v);
        if (!this._colorsData) {
            return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        }
        const custom = this._colorsData.custom || {};
        const ids = Object.keys(custom);
        const selected = this._themeSelected && this.themeById(this._themeSelected)
            ? this._themeSelected : null;

        // The light/dark pair and the packaged themes are editable too — that is
        // what the old embedded editor offered, and dropping it would have made
        // those palettes unreachable. They are only editable, never renamed,
        // reordered or deleted, so they get a picker rather than a list.
        const builtIn = this._colorsData.builtIn || {};
        const baseIds = ['dark', 'light', ...Object.keys(builtIn).sort()];
        const baseOptions = baseIds.map((id) => {
            const name = id === 'dark' ? this.t('config.themeDark', 'Dark')
                : id === 'light' ? this.t('config.themeLight', 'Light')
                : (builtIn[id]?.name || id);
            return `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(name)}</option>`;
        }).join('');

        const list = ids.length
            ? ids.map((id, i) => {
                const active = id === selected;
                return `
                <li class="config-crud-row${active ? ' is-active' : ''}" data-theme-row="${esc(id)}">
                    <div class="config-crud-fields">
                        <input type="text" class="config-text" data-theme-name="${esc(id)}" value="${esc(custom[id].name || '')}" placeholder="${esc(this.t('config.customThemeNamePlaceholder', 'Theme name'))}">
                        <span class="config-theme-swatches" aria-hidden="true">
                            ${['backgroundPrimary', 'textPrimary', 'accentSuccess'].map((p) =>
                                `<span class="config-theme-swatch" style="background:${esc(custom[id][p] || 'transparent')}"></span>`).join('')}
                        </span>
                    </div>
                    <div class="config-crud-row-actions">
                        <button type="button" class="config-btn config-btn--small" data-theme-move="up" data-id="${esc(id)}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(this.t('config.moveUp', 'Move up'))}">↑</button>
                        <button type="button" class="config-btn config-btn--small" data-theme-move="down" data-id="${esc(id)}" ${i === ids.length - 1 ? 'disabled' : ''} aria-label="${esc(this.t('config.moveDown', 'Move down'))}">↓</button>
                        <button type="button" class="config-btn config-btn--small${active ? ' is-active' : ''}" data-theme-edit="${esc(id)}">${esc(active ? this.t('config.themeEditing', 'Editing') : this.t('config.themeEdit', 'Edit'))}</button>
                        <button type="button" class="config-btn config-btn--small config-btn--danger" data-theme-delete="${esc(id)}">${esc(this.t('config.backupDelete', 'Delete'))}</button>
                    </div>
                </li>`;
            }).join('')
            : `<li class="config-panel-empty">${esc(this.t('config.customThemesEmpty', 'No custom themes yet. Add one to start from a copy of a packaged theme.'))}</li>`;

        return `
            <p class="config-view-intro">${esc(this.t('config.customThemesIntro', 'Build your own theme by editing its colours. Custom themes appear in the theme picker alongside the packaged ones.'))}</p>
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.customThemesTitle', 'Your themes'))}</h3>
                <ul class="config-crud-list">${list}</ul>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-theme-add>${esc(this.t('config.addCustomTheme', 'Add custom theme'))}</button>
                </div>
            </div>
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.packagedThemesTitle', 'Packaged themes'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.packagedThemesNote', 'Recolour a theme that ships with nextDash, or the base light and dark palettes. Reset defaults puts a packaged theme back to how it shipped.'))}</p>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.packagedThemeLabel', 'Theme'))}</span>
                    <select class="config-select" data-theme-base-select>
                        <option value="">${esc(this.t('config.packagedThemePlaceholder', 'Choose a theme to edit…'))}</option>
                        ${baseOptions}
                    </select>
                </div>
            </div>
            ${selected ? this.renderThemeColorEditor(selected) : ''}
        `;
    }

    renderThemeColorEditor(id) {
        const esc = (v) => this.dash.escapeHtml(v);
        const theme = this.themeById(id);
        if (!theme) return '';

        const groups = DashboardConfig.THEME_COLOR_GROUPS.map(([key, fallback, props]) => `
            <div class="config-theme-group">
                <h4 class="config-theme-group-title">${esc(this.t(`config.${key}`, fallback))}</h4>
                ${props.map((prop) => {
                    const val = theme[prop] || '';
                    // A colour input cannot hold rgba(), which existing themes
                    // may use, so the text field is the source of truth and the
                    // swatch is a convenience that writes into it.
                    const forPicker = /^#[0-9a-fA-F]{6}$/.test(val) ? val : '#000000';
                    return `
                    <div class="config-field config-theme-field">
                        <span class="config-field-label">${esc(this.themeColorLabel(prop))}</span>
                        <input type="color" class="config-theme-picker" data-theme-color-picker="${esc(prop)}" value="${esc(forPicker)}" aria-label="${esc(this.themeColorLabel(prop))}">
                        <input type="text" class="config-text config-theme-hex" data-theme-color="${esc(prop)}" value="${esc(val)}" spellcheck="false" placeholder="#1a1a1a">
                    </div>`;
                }).join('')}
            </div>`).join('');

        const isCustom = this.isCustomTheme(id);
        const label = theme.name
            || (id === 'dark' ? this.t('config.themeDark', 'Dark')
                : id === 'light' ? this.t('config.themeLight', 'Light') : id);
        return `
            <div class="config-panel" id="config-theme-editor" data-theme-editing="${esc(id)}">
                <h3 class="config-panel-title">${esc(this.t('config.themeColoursTitle', 'Colours'))} — ${esc(label)}</h3>
                <p class="config-panel-note">${esc(this.t('config.themeColoursNote', 'Changes preview on the dashboard behind you as you type, and save when you leave the field.'))}</p>
                <p class="config-field-warning" id="config-theme-contrast" hidden></p>
                <div class="config-theme-groups">${groups}</div>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-theme-action="apply">${esc(this.t('config.themeApply', 'Use this theme'))}</button>
                    <button type="button" class="config-btn" data-theme-action="duplicate">${esc(this.t('config.themeDuplicate', 'Duplicate'))}</button>
                    <button type="button" class="config-btn" data-theme-action="export">${esc(this.t('config.themeExport', 'Export'))}</button>
                    ${isCustom ? '' : `<button type="button" class="config-btn" data-theme-action="reset">${esc(this.t('config.themeResetDefaults', 'Reset to default'))}</button>`}
                </div>
            </div>`;
    }

    /**
     * Repaint just the custom-themes body.
     *
     * The General tab is re-rendered through render() instead: its markup is
     * produced as one block by renderAppearance and carries state (font
     * pickers, background swatches) that is simpler to rebuild wholesale than
     * to patch in place.
     */
    repaintAppearanceBody() {
        const host = document.getElementById('config-appearance-body');
        if (!host || this.appearanceTab !== 'custom-themes') { this.render(); return; }
        host.innerHTML = this.renderCustomThemes();
        const container = document.getElementById('dashboard-layout');
        if (container) this.bindAppearanceControls(container);
    }

    /**
     * POST the whole colour document back.
     *
     * /api/colors takes the complete ColorTheme, so a partial save would drop
     * the built-in and light/dark palettes. The dashboard's own stylesheet is
     * served from /api/theme.css, so it has to be re-fetched afterwards or the
     * page keeps rendering the previous colours.
     */
    async saveColorsData() {
        const run = async () => {
            try {
                const res = await this.writeFetch('/api/colors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this._colorsData),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                this.syncCustomThemeIds();
                // Every id just POSTed is now known-good on the server, so a
                // theme pick or icon-styling save right after this does not
                // need to re-check it (see ensureCustomThemeOnServer).
                if (!this._confirmedCustomThemeIds) {
                    this._confirmedCustomThemeIds = new Set();
                }
                for (const id of Object.keys(this._colorsData?.custom || {})) {
                    this._confirmedCustomThemeIds.add(id);
                }
                this.reloadThemeCSS();
                // The theme picker is built from a cached /api/colors/custom-themes
                // response; a new or renamed theme would otherwise not appear in it
                // until the view was rebuilt from scratch.
                this._themeList = null;
                void this.loadThemeList();
                this.notify(this.t('config.saved', 'Saved'), 'success');
                return true;
            } catch {
                this.notify(this.t('config.themeSaveError', 'Could not save the theme.'), 'error');
                return false;
            }
        };
        const promise = run();
        this._colorsSavePromise = promise;
        try {
            return await promise;
        } finally {
            if (this._colorsSavePromise === promise) {
                this._colorsSavePromise = null;
            }
        }
    }

    /** A theme id that cannot collide with one already stored. */
    static newThemeId() {
        return `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    /**
     * Start a new theme from a full palette rather than blank fields.
     *
     * Every colour must be set or the dashboard renders with empty CSS
     * variables, so a new theme copies a packaged one — the current theme where
     * possible, so "add" reads as "start from what I am looking at".
     */
    addCustomTheme() {
        const data = this._colorsData;
        if (!data) return;
        const resolved = document.documentElement.getAttribute('data-theme') || '';
        const starter = data.builtIn?.[resolved] || data.dark || data.light || {};
        const names = Object.values(data.custom || {}).map((t) => t.name);
        const id = DashboardConfig.newThemeId();
        data.custom[id] = {
            ...starter,
            name: DashboardConfig.uniqueNameFrom(this.t('config.customThemePrefix', 'My theme'), names),
        };
        this._themeSelected = id;
        this.syncCustomThemeIds();
        this.repaintAppearanceBody();
        void this.saveColorsData();
    }

    /**
     * Custom theme ids are validated on the server when settings are saved. If
     * colors.json does not yet contain the theme, SaveSettings silently resets
     * settings.theme to the default while leaving themeIconStyling entries under
     * the custom id — harmonisation then looks disabled after reload.
     *
     * Confirmed ids are cached so a settings save right after the confirming
     * colours save (the common case) does not pay for another /api/colors
     * round trip — only the first save for a given id needs to check.
     */
    async ensureCustomThemeOnServer(themeId) {
        const id = String(themeId || '').trim();
        if (!id || !window.ThemeUtils?.isUserCustomThemeId?.(id)) {
            return;
        }
        if (!this._confirmedCustomThemeIds) {
            this._confirmedCustomThemeIds = new Set();
        }
        if (this._confirmedCustomThemeIds.has(id)) {
            return;
        }
        if (this._colorsSavePromise) {
            await this._colorsSavePromise;
        }
        await this.loadColorsData();
        if (!this._colorsData?.custom?.[id]) {
            return;
        }
        try {
            const res = await fetch('/api/colors');
            if (!res.ok) {
                return;
            }
            const server = await res.json();
            if (!server.custom?.[id]) {
                await this.saveColorsData();
            }
            this._confirmedCustomThemeIds.add(id);
        } catch {
            /* best effort — saveSettings may still fail validation */
        }
    }

    async deleteCustomTheme(id) {
        const data = this._colorsData;
        const theme = data?.custom?.[id];
        if (!theme) return;
        const ok = await this.confirmAction(
            this.t('config.themeDeleteConfirm', 'Delete the theme “{name}”?')
                .replace('{name}', String(theme.name || id))
        );
        if (!ok) return;
        delete data.custom[id];
        this.syncCustomThemeIds();
        if (this._themeSelected === id) this._themeSelected = null;
        // A deleted theme that is still selected would leave the dashboard on a
        // theme that no longer exists, so fall back to the default.
        if (this.dash.settings?.theme === id) {
            this.dash.settings.theme = 'default';
            void this.saveSettingsWithFeedback();
        }
        this.repaintAppearanceBody();
        await this.saveColorsData();
    }

    moveCustomTheme(id, direction) {
        const data = this._colorsData;
        if (!data?.custom?.[id]) return;
        const ids = Object.keys(data.custom);
        const i = ids.indexOf(id);
        const swap = direction === 'up' ? i - 1 : i + 1;
        if (swap < 0 || swap >= ids.length) return;
        [ids[i], ids[swap]] = [ids[swap], ids[i]];
        // Object key order is the theme order, so the map is rebuilt rather
        // than mutated in place.
        data.custom = Object.fromEntries(ids.map((k) => [k, data.custom[k]]));
        this.repaintAppearanceBody();
        void this.saveColorsData();
    }

    /**
     * Preview a colour without saving.
     *
     * Writes the theme's variables into a <style> the dashboard picks up, using
     * the same buildVarsBlock the old editor used so a preview cannot disagree
     * with what /api/theme.css will produce.
     */
    previewThemeColors(id) {
        const theme = this.themeById(id);
        document.getElementById('config-theme-preview')?.remove();
        if (!theme) return;
        const vars = window.ColorValueUtils?.buildVarsBlock?.(theme) || '';
        if (!vars) return;
        const style = document.createElement('style');
        style.id = 'config-theme-preview';
        // /api/theme.css writes its variables on html[data-theme="…"], which is
        // more specific than :root, so a :root block here would be overridden
        // and the preview would silently do nothing. Match that selector — and
        // the attribute value the document actually carries, since with auto
        // dark mode the resolved theme differs from settings.theme.
        const resolved = document.documentElement.getAttribute('data-theme');
        const scope = resolved ? `html[data-theme="${CSS.escape(resolved)}"]` : ':root';
        style.textContent = `${scope} { ${vars} }`;
        document.head.appendChild(style);
    }

    clearThemePreview() {
        document.getElementById('config-theme-preview')?.remove();
    }

    /** Warn when primary text on the primary background falls below WCAG AA. */
    updateThemeContrastHint(id) {
        const hint = document.getElementById('config-theme-contrast');
        const theme = this.themeById(id);
        if (!hint || !theme || !window.ColorValueUtils?.contrastRatio) return;
        const ratio = window.ColorValueUtils.contrastRatio(theme.textPrimary, theme.backgroundPrimary);
        if (ratio == null || ratio >= 4.5) {
            hint.hidden = true;
            return;
        }
        hint.hidden = false;
        hint.textContent = this.t('config.themeContrastWarning',
            'Low contrast between primary text and background ({ratio}:1). Aim for 4.5:1 or higher.')
            .replace('{ratio}', ratio.toFixed(1));
    }

    /** Fetch the colour document on first open, then draw the tab. */
    async openCustomThemes() {
        await this.loadColorsData();
        if (this.appearanceTab === 'custom-themes') this.repaintAppearanceBody();
    }

    bindCustomThemes(container) {
        container.querySelector('[data-theme-add]')
            ?.addEventListener('click', () => this.addCustomTheme());

        container.querySelectorAll('[data-theme-delete]').forEach((btn) => {
            btn.addEventListener('click', () => void this.deleteCustomTheme(btn.getAttribute('data-theme-delete')));
        });
        container.querySelectorAll('[data-theme-move]').forEach((btn) => {
            btn.addEventListener('click', () =>
                this.moveCustomTheme(btn.getAttribute('data-id'), btn.getAttribute('data-theme-move')));
        });
        const baseSelect = container.querySelector('[data-theme-base-select]');
        if (baseSelect) {
            baseSelect.addEventListener('change', () => {
                this._themeSelected = baseSelect.value || null;
                this.repaintAppearanceBody();
                if (this._themeSelected) {
                    this.previewThemeColors(this._themeSelected);
                    this.updateThemeContrastHint(this._themeSelected);
                } else {
                    this.clearThemePreview();
                }
            });
        }

        container.querySelectorAll('[data-theme-edit]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-theme-edit');
                this._themeSelected = this._themeSelected === id ? null : id;
                this.repaintAppearanceBody();
                if (this._themeSelected) {
                    this.previewThemeColors(this._themeSelected);
                    this.updateThemeContrastHint(this._themeSelected);
                } else {
                    this.clearThemePreview();
                }
            });
        });

        container.querySelectorAll('[data-theme-name]').forEach((input) => {
            const id = input.getAttribute('data-theme-name');
            input.addEventListener('change', () => {
                const theme = this._colorsData?.custom?.[id];
                if (!theme) return;
                const others = Object.entries(this._colorsData.custom)
                    .filter(([k]) => k !== id).map(([, t]) => t.name);
                if (!this.guardUniqueName(input, input.value, others, {
                    previous: theme.name,
                    message: this.t('config.themeNameDuplicate', 'A theme with this name already exists.'),
                })) return;
                theme.name = input.value;
                void this.saveColorsData();
            });
        });

        this.bindThemeColorInputs(container);
    }

    /**
     * The colour fields themselves.
     *
     * Typing previews live but does not save — a save per keystroke would post
     * the whole colour document on every character. The commit happens on
     * `change`, which is blur or a picker selection.
     */
    bindThemeColorInputs(container) {
        const id = this._themeSelected;
        if (!id) return;
        const theme = this.themeById(id);
        if (!theme) return;

        const apply = (prop, value, { save }) => {
            theme[prop] = value;
            this.previewThemeColors(id);
            this.updateThemeContrastHint(id);
            if (save) void this.saveColorsData();
        };

        container.querySelectorAll('[data-theme-color]').forEach((input) => {
            const prop = input.getAttribute('data-theme-color');
            input.addEventListener('input', () => {
                // Invalid text is flagged but still previewed as far as the
                // browser can take it, so a half-typed hex does not blank out.
                window.ColorValueUtils?.validateTextInput?.(input);
                if (window.ColorValueUtils?.isValidCSSValue?.(input.value)) {
                    apply(prop, input.value.trim(), { save: false });
                    const picker = container.querySelector(`[data-theme-color-picker="${prop}"]`);
                    if (picker && /^#[0-9a-fA-F]{6}$/.test(input.value.trim())) picker.value = input.value.trim();
                }
            });
            input.addEventListener('change', () => {
                if (!window.ColorValueUtils?.isValidCSSValue?.(input.value)) {
                    // Put back the stored value rather than saving something the
                    // server would reject or render as an empty variable.
                    input.value = theme[prop] || '';
                    window.ColorValueUtils?.validateTextInput?.(input);
                    this.notify(this.t('config.themeColorInvalid', 'Enter a colour like #1a1a1a or rgba(0,0,0,.5).'), 'error');
                    return;
                }
                apply(prop, input.value.trim(), { save: true });
            });
        });

        container.querySelectorAll('[data-theme-color-picker]').forEach((picker) => {
            const prop = picker.getAttribute('data-theme-color-picker');
            const sync = (save) => {
                const hex = picker.value;
                const text = container.querySelector(`[data-theme-color="${prop}"]`);
                if (text) text.value = hex;
                apply(prop, hex, { save });
            };
            picker.addEventListener('input', () => sync(false));
            picker.addEventListener('change', () => sync(true));
        });

        container.querySelectorAll('[data-theme-action]').forEach((btn) => {
            btn.addEventListener('click', () => this.handleThemeAction(btn.getAttribute('data-theme-action'), id));
        });
    }

    async handleThemeAction(action, id) {
        const theme = this.themeById(id);
        if (!theme) return;
        if (action === 'apply') {
            // Same path the Theme dropdown uses: applyThemeChoice runs applyThemeLive,
            // which pairs the choice with the OS preference when "follow system
            // dark mode" is on, and persists through persistAppearance. Setting
            // settings.theme by hand skipped both, so the choice never reached
            // the server and <html data-theme> never changed.
            this.clearThemePreview();
            await this.applyThemeChoice(id);
            this.reloadThemeCSS();
            this.render();
            return;
        }
        if (action === 'duplicate') {
            const names = Object.values(this._colorsData.custom).map((t) => t.name);
            const copyId = DashboardConfig.newThemeId();
            this._colorsData.custom[copyId] = {
                ...theme,
                name: DashboardConfig.uniqueNameFrom(
                    `${theme.name || id} ${this.t('config.themeCopySuffix', 'copy')}`, names),
            };
            this._themeSelected = copyId;
            this.syncCustomThemeIds();
            this.repaintAppearanceBody();
            await this.saveColorsData();
            return;
        }
        if (action === 'reset') {
            // /api/colors/reset restores light, dark and every packaged theme
            // while leaving custom ones alone, so it is safe to offer from here.
            const ok = await this.confirmAction(
                this.t('config.themeResetConfirm',
                    'Reset the packaged themes to their original colours? Your own themes are kept.'),
                { confirmLabel: this.t('config.themeResetDefaults', 'Reset to default') }
            );
            if (!ok) return;
            try {
                const res = await this.writeFetch('/api/colors/reset', { method: 'POST' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                this._colorsData = await res.json();
                if (!this._colorsData.custom) this._colorsData.custom = {};
                this.clearThemePreview();
                this.reloadThemeCSS();
                this.repaintAppearanceBody();
                if (this._themeSelected) this.previewThemeColors(this._themeSelected);
                this.notify(this.t('config.saved', 'Saved'), 'success');
            } catch {
                this.notify(this.t('config.themeSaveError', 'Could not save the theme.'), 'error');
            }
            return;
        }
        if (action === 'export') {
            const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${String(theme.name || id).replace(/[^\w-]+/g, '-').toLowerCase()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    }

    /** Render the ℹ/↺ affordances for an Appearance-section field. */
    appearanceAff(field) {
        const aff = this.renderFieldAffordances(field, this.dash.settings?.[field]);
        return aff ? `<span class="config-field-affordances">${aff}</span>` : '';
    }

    /**
     * The theme whose icon styling is being edited. The dashboard reads the entry
     * by the *resolved* theme on <html data-theme> rather than settings.theme —
     * with auto dark mode on those differ, so editing must follow the same key or
     * the controls would write to an entry nothing reads.
     */
    iconStylingThemeKey() {
        if (window.ThemeIconStyling?.getThemeIconStylingThemeKey) {
            return window.ThemeIconStyling.getThemeIconStylingThemeKey(this.dash.settings);
        }
        return document.documentElement.getAttribute('data-theme')
            || this.dash.settings?.theme
            || 'default';
    }

    iconStylingEntry() {
        if (window.ThemeIconStyling?.getThemeIconStylingEntry) {
            return window.ThemeIconStyling.getThemeIconStylingEntry(this.dash.settings);
        }
        const map = this.dash.settings?.themeIconStyling || {};
        const entry = map[this.iconStylingThemeKey()] || {};
        return {
            enabled: entry.enabled === true,
            style: entry.style || 'muted',
            intensity: Number.isFinite(Number(entry.intensity)) ? Number(entry.intensity) : 0.5,
        };
    }

    iconStylingThemeKeysForWrite() {
        const primary = this.iconStylingThemeKey();
        if (window.ThemeIconStyling?.themeIconStylingDisplayKeys) {
            return window.ThemeIconStyling.themeIconStylingDisplayKeys(primary);
        }
        return [primary];
    }

    /**
     * Favicon harmonization: blends bookmark icons into the active theme. Stored
     * per theme, so each theme keeps its own setting — the label says which one
     * is being edited, since switching theme changes what these controls affect.
     */
    /**
     * With random theme mode on, the displayed theme keeps changing, so the
     * per-theme phrasing ("applies to … {theme}") would print a different
     * theme every time the pool rotates. Harmonisation is one shared setting
     * across the pool in that case, so the hint says so instead.
     */
    iconStylingHint() {
        if (window.ThemeIconStyling?.isRandomThemeModeActive?.(this.dash.settings)) {
            return this.t('config.iconStylingRandomThemeHint',
                'These settings apply to every theme in your random rotation.');
        }
        return this.t('config.iconStylingThemeHint',
            'These settings apply to the theme you are using now — “{theme}”. Other themes keep their own.')
            .replace('{theme}', this.themeLabel(this.iconStylingThemeKey()));
    }

    renderIconStyling() {
        const esc = (v) => this.dash.escapeHtml(v);
        const { enabled, style, intensity } = this.iconStylingEntry();
        const styles = [
            ['muted', this.t('config.iconStylingStyleMuted', 'Muted')],
            ['tinted', this.t('config.iconStylingStyleTinted', 'Tinted')],
            ['overlay', this.t('config.iconStylingStyleOverlay', 'Overlay')],
        ];
        const choices = styles.map(([val, label]) =>
            `<button type="button" class="config-choice${style === val ? ' is-active' : ''}" data-appearance-iconstyle="${esc(val)}" aria-pressed="${style === val}">${esc(label)}</button>`
        ).join('');
        const enabledChoices = [
            [false, this.t('config.iconStylingOff', 'Off')],
            [true, this.t('config.iconStylingOn', 'On')],
        ].map(([val, label]) =>
            `<button type="button" class="config-choice${enabled === val ? ' is-active' : ''}" data-appearance-toggle-icons="${val ? 'on' : 'off'}" aria-pressed="${enabled === val}">${esc(label)}</button>`
        ).join('');
        // Three sample icons styled exactly as the dashboard styles a favicon, so
        // the effect is visible without leaving the section.
        // .preview-icon inside .icon-themed is what theme.css's variant rules
        // target, so the sample is styled by the same CSS the real favicons use.
        const preview = [1, 2, 3].map(() =>
            `<span class="config-icon-preview-dot icon-themed icon-themed--${esc(style)}" style="--icon-theme-intensity:${intensity}"><span class="preview-icon"></span></span>`
        ).join('');
        return `
            <div class="config-field">
                <span class="config-field-label">${esc(this.t('config.iconStylingLabel', 'Favicon harmonization (per theme)'))}</span>
                <div class="config-choices" role="group">${enabledChoices}</div>
                ${this.appearanceAff('themeIconStyling')}
            </div>
            <p class="config-field-hint">${esc(this.iconStylingHint())}</p>
            ${enabled ? `
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.iconStylingStyleLabel', 'Style'))}</span>
                    <div class="config-choices" role="group">${choices}</div>
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.iconStylingIntensityLabel', 'Intensity'))}</span>
                    <input type="range" class="config-range" data-appearance-icon-intensity min="0" max="1" step="0.05" value="${intensity}">
                    <span class="config-range-value">${Math.round(intensity * 100)}%</span>
                    <span class="config-icon-preview" aria-hidden="true">${preview}</span>
                </div>` : ''}`;
    }

    /** A readable name for a theme id, falling back to the id itself. */
    themeLabel(id) {
        const key = String(id || '');
        const translated = this.t(`config.themeName.${key}`, '');
        return translated || key;
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
                this.dash.settings.backgroundOpacity = window.VisualSettings?.clampBackgroundOpacity
                    ? window.VisualSettings.clampBackgroundOpacity(value)
                    : Number(value);
                this.dash.visual?.applyVisualSettings?.();
                this.persistAppearance();
                break;
            case 'launcherIconSize': this.setLauncherIconSize(value); break;
            case 'layoutVersion': this.setLayout(value); break;
            case 'randomThemeMode': this.setRandomThemeMode(value); break;
            default:
                // Fall back to a plain settings write + repaint for any field
                // without a dedicated live setter.
                this.dash.settings[field] = value;
                this.persistAppearance();
        }
    }

    setTheme(theme) {
        void this.applyThemeChoice(theme);
    }

    async applyThemeChoice(theme) {
        if (!theme) return;
        if (window.ThemeUtils?.isUserCustomThemeId?.(theme)) {
            await this.ensureCustomThemeOnServer(theme);
        }
        const previous = this.dash.settings?.theme;
        const randomActive = window.ThemeIconStyling?.isRandomThemeModeActive?.(this.dash.settings) === true
            || (window.ThemeUtils?.normalizeRandomThemeMode?.(this.dash.settings) ?? this.dash.settings?.randomThemeMode ?? 'off') !== 'off';
        // The choice is stored as picked; what gets displayed runs through
        // applyThemeLive, which pairs it with the OS preference when "follow
        // system dark mode" is on. Applying `theme` directly here ignored that.
        this.dash.settings.theme = theme;
        this.applyThemeLive();
        await this.persistAppearance();
        if (randomActive && theme !== previous) {
            this.notify(this.t('config.randomThemeChoiceSavedHint',
                'Random theme is on — your choice is saved, but the display keeps picking from the pool until you turn random off.'));
        }
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
        // Switching to gradient with nothing chosen would apply no background at
        // all, which reads as a broken button — fall back to the first preset.
        if (type === 'gradient' && !this.dash.settings.backgroundGradient) {
            const first = Object.keys(window.VisualSettings?.BACKGROUND_PRESETS || {})[0];
            if (first) this.dash.settings.backgroundGradient = first;
        }
        this.dash.visual?.applyBackground?.();
        this.persistAppearance();
    }

    /** Merge a change into the current theme's icon-styling entry and apply it. */
    async setIconStyling(patch, { repaint = true } = {}) {
        const d = this.dash;
        const theme = d.settings?.theme;
        if (theme && window.ThemeUtils?.isUserCustomThemeId?.(theme)) {
            await this.ensureCustomThemeOnServer(theme);
        }
        const nextEntry = { ...this.iconStylingEntry(), ...patch };
        const map = { ...(d.settings.themeIconStyling || {}) };
        for (const key of this.iconStylingThemeKeysForWrite()) {
            map[key] = { ...nextEntry };
        }
        d.settings.themeIconStyling = map;
        this.applyIconStylingLive();
        if (repaint) {
            await this.persistAppearance();
        } else {
            await this.saveSettingsWithFeedback();
        }
    }

    /** Push favicon harmonisation onto any bookmark/search icon already in the DOM. */
    applyIconStylingLive() {
        const d = this.dash;
        window.ThemeIconStyling?.applyThemeIconStylingToDocument?.(d.settings);
        if (d.isBookmarksView?.()) {
            d.renderDashboard?.({ animate: false, incremental: 'settings' });
        }
        if (d.searchComponent?.isActive?.()) {
            d.searchComponent.updateSearch?.();
        }
    }

    setBackgroundGradient(name) {
        if (!name || !(window.VisualSettings?.BACKGROUND_PRESETS || {})[name]) return;
        this.dash.settings.backgroundGradient = name;
        this.dash.settings.backgroundType = 'gradient';
        this.dash.visual?.applyBackground?.();
        this.persistAppearance();
    }

    /**
     * The URL is applied through the shared safeCssImageUrl guard downstream, so
     * anything it rejects simply renders no background rather than injecting CSS.
     */
    setBackgroundImageUrl(url) {
        this.dash.settings.backgroundImageUrl = String(url || '').trim();
        this.dash.visual?.applyBackground?.();
        void this.saveSettingsWithFeedback();
    }

    setLauncherIconSize(size) {
        if (!['small', 'normal', 'large'].includes(size)) return;
        this.dash.settings.launcherIconSize = size;
        this.dash.visual?.applyVisualSettings?.();
        this.persistAppearance();
    }

    /**
     * Where the button bar sits. The position is written onto <body> as
     * data-button-position by setupDOM and the rest is CSS, so reapplying the
     * chrome is what moves the bar — the same path `:buttonbar` uses.
     */
    setButtonBarPosition(position) {
        if (!['bottom', 'bottom-left', 'bottom-right', 'side-left', 'side-right'].includes(position)) return;
        this.dash.settings.buttonBarPosition = position;
        this.applyChromeSettings();
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
            return;
        }
        if (name === 'randomThemeMode') {
            this.setRandomThemeMode(value);
        }
    }

    setRandomThemeMode(mode) {
        const normalized = ['off', 'refresh', 'view'].includes(mode) ? mode : 'off';
        const wasActive = window.ThemeIconStyling?.isRandomThemeModeActive?.(this.dash.settings) === true;
        this.dash.settings.randomThemeMode = normalized;
        this.dash.settings.randomThemeOnRefresh = normalized !== 'off';
        const nowActive = normalized !== 'off';
        if (wasActive !== nowActive) {
            this.migrateIconStylingOnRandomModeChange(nowActive);
        }
        document.documentElement.setAttribute('data-random-theme-mode', normalized);
        window.ThemeLoader?.clearSessionRandomTheme?.();
        this.applyThemeLive();
        this.persistAppearance();
    }

    /**
     * Random theme mode keys harmonisation to one shared pool entry instead of
     * per-theme entries (theme-icon-styling.js) — otherwise the toggle keeps
     * flipping back to disabled every time the pool rotates to a theme with no
     * entry of its own. Switching the mode changes which key is read, so the
     * entry is carried across rather than silently losing whatever the user
     * had set.
     */
    migrateIconStylingOnRandomModeChange(nowActive) {
        const poolKey = window.ThemeIconStyling?.RANDOM_POOL_KEY;
        const specificKey = window.ThemeIconStyling?.getSpecificThemeKey?.(this.dash.settings);
        if (!poolKey || !specificKey) return;
        const fromKey = nowActive ? specificKey : poolKey;
        const toKey = nowActive ? poolKey : specificKey;
        if (fromKey === toKey) return;
        const map = this.dash.settings.themeIconStyling || {};
        if (!Object.prototype.hasOwnProperty.call(map, fromKey)) return;
        // Never clobber a setting the target key already has of its own.
        if (Object.prototype.hasOwnProperty.call(map, toKey)) return;
        this.dash.settings.themeIconStyling = { ...map, [toKey]: { ...map[fromKey] } };
    }

    /** Reload the server-rendered theme stylesheet so a theme change takes effect. */
    reloadThemeCSS() {
        window.VisualSettings?.reloadThemeCSS?.();
    }

    handleAppearanceAction(action) {
        switch (action) {
            case 'edit-colors': this.openThemeEditorTab(); break;
            case 'upload-font': document.getElementById('config-font-input')?.click(); break;
            case 'upload-favicon': document.getElementById('config-favicon-input')?.click(); break;
        }
    }

    /**
     * Jump to the Custom themes tab.
     *
     * This used to reveal the old config's editor, embedded from a
     * server-rendered partial. That editor wired its buttons through a
     * document-level delegate calling window.configManager, which only exists
     * on the standalone /config page — so in this view its Add button silently
     * did nothing. The native tab replaces it and covers the same palettes.
     */
    openThemeEditorTab() {
        this.appearanceTab = 'custom-themes';
        this.render();
        void this.openCustomThemes();
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
        showShortcutTooltips: { info: ['shortcutTooltipsInfoTitle', 'shortcutTooltipsInfoMessage'], def: true },
        allowLocalBookmarks: { info: ['allowLocalBookmarksInfoTitle', 'allowLocalBookmarksInfoMessage'] },
        enableSessionTips: { info: ['sessionTipsInfoTitle', 'sessionTipsInfoMessage'], hint: 'sessionTipsHint', def: true },
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
        layoutPreset: { info: ['layoutPresetInfoTitle', 'layoutPresetInfoMessage'], def: 'default' },
        categoryItemLimit: { info: ['categoryItemLimitInfoTitle', 'categoryItemLimitInfoMessage'], def: 15 },
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
        healthRecheckIntervalMinutes: { info: ['healthRecheckIntervalInfoTitle', 'healthRecheckIntervalInfoMessage'], def: 60 },
        skipFastPing: { info: ['skipFastPingInfoTitle', 'skipFastPingInfoMessage'] },
        statusOfflineRetries: { info: ['statusOfflineRetriesInfoTitle', 'statusOfflineRetriesInfoMessage'], def: 1 },
        statusOfflineRetryDelayMs: { info: ['statusOfflineRetryDelayInfoTitle', 'statusOfflineRetryDelayInfoMessage'], def: 1500 },
        showStatusLoading: { info: ['showStatusLoadingInfoTitle', 'showStatusLoadingInfoMessage'] },
        monitorNotifyUrl: { info: ['monitorNotifyUrlInfoTitle', 'monitorNotifyUrlInfoMessage'] },
        monitorNotifyRetries: { info: ['monitorNotifyRetriesInfoTitle', 'monitorNotifyRetriesInfoMessage'], def: 3 },
        pushNotifyEnabled: { info: ['pushNotifyInfoTitle', 'pushNotifyInfoMessage'], def: false },
        pushNotifyMonitor: { def: false },
        pushNotifyBackup: { def: false },
        pushNotifySubject: { def: '' },
        // Toolbar & chrome
        showRecentButton: { def: true },
        showCheatSheetButton: { def: true },
        showConfigButton: { def: true },
        showHealthDashboard: { def: true },
        showAddBookmarkButton: { def: true },
        showSearchButton: { def: true },
        showFindersButton: { def: true },
        showCommandsButton: { def: true },
        buttonBarPosition: { info: ['buttonBarPositionInfoTitle', 'buttonBarPositionInfoMessage'], def: 'bottom' },
        showPageInTitle: { info: ['showPageInTitleInfoTitle', 'showPageInTitleInfoMessage'] },
        // Weather & calendar
        weatherRefreshMinutes: { info: ['weatherRefreshInfoTitle', 'weatherRefreshInfoMessage'], def: 30 },
        calendarUrl: { info: ['calendarUrlInfoTitle', 'calendarUrlInfoMessage'] },
        // Link previews
        linkPreviewHoverDelayMs: { info: ['linkPreviewHoverDelayInfoTitle', 'linkPreviewHoverDelayInfoMessage'], def: 400 },
        // Sync
        showSyncToasts: { info: ['showSyncToastsInfoTitle', 'showSyncToastsInfoMessage'] },
        faviconRefreshPolicy: { info: ['faviconRefreshPolicyInfoTitle', 'faviconRefreshPolicyInfoMessage'], def: 'monthly' },
        // Privacy
        analyticsOptIn: { info: ['usageAnalyticsInfoTitle', 'usageAnalyticsInfoMessage'], hint: 'usageAnalyticsHint' },
        updateCheckEnabled: { info: ['updateCheckInfoTitle', 'updateCheckInfoMessage'], hint: 'updateCheckHint', def: true },
        // Appearance
        autoDarkMode: { info: ['autoDarkModeInfoTitle', 'autoDarkModeInfoMessage'] },
        randomThemeMode: { info: ['randomThemeModeInfoTitle', 'randomThemeModeInfoMessage'], def: 'off' },
        showBackgroundDots: { info: ['showBackgroundDotsInfoTitle', 'showBackgroundDotsInfoMessage'] },
        themeIconStyling: { info: ['iconStylingInfoTitle', 'iconStylingInfoMessage'] },
        animationsEnabled: { info: ['enableAnimationsInfoTitle', 'enableAnimationsInfoMessage'] },
        fontPreset: { info: ['fontPresetInfoTitle', 'fontPresetInfoMessage'], def: 'source-code-pro' },
        fontWeight: { info: ['fontWeightInfoTitle', 'fontWeightInfoMessage'], def: 'normal' },
        backgroundType: { info: ['backgroundPickerInfoTitle', 'backgroundPickerInfoMessage'], def: 'none' },
        backgroundOpacity: { info: ['backgroundOpacityInfoTitle', 'backgroundOpacityInfoMessage'], def: 1 },
        enableCustomTitle: { info: ['enableCustomTitleInfoTitle', 'enableCustomTitleInfoMessage'] },
        enableCustomFavicon: { info: ['enableCustomFaviconInfoTitle', 'enableCustomFaviconInfoMessage'] },
        // Collections
        showSmartTodayCollection: { def: true },
        showSmartRecentCollection: { def: false },
        showSmartStaleCollection: { def: false },
        showSmartMostUsedCollection: { def: false },
        smartTodayLimit: { info: ['smartTodayLimitInfoTitle', 'smartTodayLimitInfoMessage'], def: 8 },
        smartRecentLimit: { info: ['smartRecentLimitInfoTitle', 'smartRecentLimitInfoMessage'], def: 50 },
        smartStaleLimit: { info: ['smartStaleLimitInfoTitle', 'smartStaleLimitInfoMessage'], def: 50 },
        smartMostUsedLimit: { info: ['smartMostUsedLimitInfoTitle', 'smartMostUsedLimitInfoMessage'], def: 25 },
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
        // A toggle whose effect lives in the page chrome rather than the bookmark
        // grid, so it needs the header reapplied instead of a re-render.
        const chrome = (field, label, fallback) => ({ ...bool(field, label, fallback), special: 'chrome' });
        const opt = (value, label) => ({ value, label });
        // From the shared util so config and dashboard cannot drift apart.
        const layoutPresets = window.LayoutUtils?.getLayoutPresets?.()
            || ['default', 'compact', 'cards', 'terminal', 'masonry', 'list', 'widgets', 'launcher'];
        return [
            {
                tab: 'general',
                title: t('config.generalGroupGeneral', 'General'),
                note: t('config.generalGroupGeneralNote', 'Language, link behaviour, and dashboard-wide options.'),
                controls: [
                    { field: 'language', type: 'select', label: t('config.languageLabel', 'Language'), special: 'language', options: [
                        opt('en', 'English'), opt('nl', 'Nederlands'), opt('de', 'Deutsch'), opt('fr', 'Français'),
                    ] },
                    bool('openInNewTab', 'config.openInNewTab', 'Open links in a new tab'),
                    bool('globalShortcuts', 'config.globalShortcutsLabel', 'Global keyboard shortcuts'),
                    { ...bool('showShortcutTooltips', 'config.shortcutTooltipsLabel', 'Show shortcut hints on toolbar icons'), special: 'shortcutTooltips' },
                    bool('allowLocalBookmarks', 'config.allowLocalBookmarks', 'Allow local (non-http) bookmark URLs'),
                    bool('hyprMode', 'config.hyprModeLabel', 'Hypr mode'),
                ],
            },
            {
                // The old config kept the tips toggle beside the quick-start and
                // what's-new actions, which is where people look for it. Split
                // across two sections it read as a stray General option.
                tab: 'general',
                title: t('config.generalGroupOnboarding', 'Onboarding'),
                note: t('config.generalGroupOnboardingNote', 'The quick-start card, the occasional keyboard tip, and the release summary.'),
                controls: [
                    bool('enableSessionTips', 'config.sessionTipsLabel', 'Show occasional keyboard tips'),
                ],
            },
            {
                tab: 'datetime',
                title: t('config.generalGroupDateTime', 'Date, time & weather'),
                note: t('config.generalGroupDateTimeNote', 'The clock, date line, and weather shown above the bookmarks.'),
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
                note: t('config.generalLayoutIntro', 'Grid structure, column count, layout preset, and density.'),
                controls: [
                    { field: 'columnsPerRow', type: 'number', label: t('config.columnsLabel', 'Columns'), min: 1, max: 12, special: 'render' },
                    // The preset drives the grid's `layout-*` class and the
                    // data-layout-preset attribute, so it needs the chrome
                    // reapplied as well as a re-render.
                    { field: 'layoutPreset', type: 'select', label: t('config.layoutPresetLabelShort', 'Layout preset'), special: 'chromeRender',
                        options: layoutPresets.map((p) => opt(p, t(`config.layoutPresetName.${p}`, p))) },
                    { field: 'densityMode', type: 'select', label: t('config.densityLabel', 'Density'), special: 'render', options: [
                        opt('comfortable', t('config.densityComfortable', 'Comfortable')), opt('compact', t('config.densityCompact', 'Compact')),
                        opt('dense', t('config.densityDense', 'Dense')), opt('auto', t('config.densityAuto', 'Auto')),
                    ] },
                    { field: 'categoryItemLimit', type: 'select', label: t('config.categoryItemLimitLabelShort', 'Items per category'), special: 'render', options: [
                        opt(10, '10'), opt(15, '15'), opt(20, '20'), opt(25, '25'), opt(30, '30'), opt(50, '50'),
                        opt(0, t('config.categoryItemLimitUnlimited', 'Unlimited')),
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
                note: t('config.generalBookmarksDisplayIntro', 'Favicons, shortcuts, badges, link preview, sorting, and navigation.'),
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
                tab: 'toolbar',
                title: t('config.generalGroupChrome', 'Toolbar & tabs'),
                note: t('config.generalHeaderButtonsIntro', 'Button visibility in the dashboard footer and header.'),
                // Chrome lives on <body> as data-* attributes rather than being
                // read at render time, so these need applyChromeSettings to show
                // up without a reload — see setBehavior's 'chrome' case.
                controls: [
                    chrome('showPageTabs', 'config.showPageTabsLabel', 'Show page tabs'),
                    chrome('showPageNamesInTabs', 'config.showPageNamesInTabsLabel', 'Show page names in tabs'),
                    chrome('showTitle', 'config.showTitleLabel', 'Show the dashboard title'),
                    chrome('showAddBookmarkButton', 'config.showAddBookmarkButtonLabel', 'Show the add-bookmark button'),
                    chrome('showSearchButton', 'config.showSearchButtonLabel', 'Show the search button'),
                    chrome('showFindersButton', 'config.showFindersButtonLabel', 'Show the finders button'),
                    chrome('showCommandsButton', 'config.showCommandsButtonLabel', 'Show the commands button'),
                    chrome('showTagCloudButton', 'config.showTagCloudButtonLabel', 'Show the tag-cloud button'),
                    chrome('showRecentButton', 'config.showRecentButtonLabel', 'Show the recent button'),
                    chrome('showCheatSheetButton', 'config.showCheatSheetButtonLabel', 'Show the cheat-sheet button'),
                    chrome('showConfigButton', 'config.showConfigButtonLabel', 'Show the config button'),
                    chrome('showHealthDashboard', 'config.showHealthDashboardLabel', 'Show the health icon'),
                    // Button bar position lives on the Layout tab, as a button
                    // group beside the other two layout choices.
                ],
            },
            {
                tab: 'search',
                title: t('config.generalGroupSearch', 'Search'),
                note: t('config.generalSearchInputIntro', 'Search overlay behavior and suggestions.'),
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
                note: t('config.generalGroupQuickAddNote', 'What happens when you paste a URL onto the dashboard — add it straight away, or collect it in the inbox to sort later.'),
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
                title: t('config.monitorEmphasisTitle', 'Monitored bookmarks on the dashboard'),
                note: t('config.monitorEmphasisNote', 'How much a monitored bookmark stands out among the others. A monitor that is down is always marked, whichever you pick — this chooses how visible the healthy ones are.'),
                appliesTo: t('config.appliesToMonitorOnly', 'Monitor only'),
                highlight: true,
                controls: [
                    {
                        field: 'monitorEmphasis',
                        type: 'cards',
                        // Body attribute only, so it needs `chrome` — `render`
                        // redraws the rows but never rewrites <body>.
                        special: 'chrome',
                        label: t('config.monitorEmphasisLabel', 'Emphasis'),
                        options: [
                            {
                                value: 'problems',
                                label: t('config.monitorEmphasisProblems', 'Only when there is a problem'),
                                body: t('config.monitorEmphasisProblemsBody', 'A healthy monitor looks like any other bookmark. Only an outage draws the eye.'),
                            },
                            {
                                value: 'always',
                                label: t('config.monitorEmphasisAlways', 'Always stand out'),
                                body: t('config.monitorEmphasisAlwaysBody', 'Every monitored bookmark gets its own accent edge, so you can see at a glance what you are watching.'),
                            },
                            {
                                value: 'never',
                                label: t('config.monitorEmphasisNever', 'Never stand out'),
                                body: t('config.monitorEmphasisNeverBody', 'Monitoring stays entirely in the Health view. The dashboard shows no marking at all, not even for an outage.'),
                            },
                        ],
                    },
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
                tab: 'status',
                title: t('config.pushNotifyTitle', 'Browser notifications'),
                note: t('config.pushNotifyNote', 'Sends notifications to this browser, even when nextDash is closed. Requires HTTPS (or localhost) and permission per device.'),
                controls: [
                    bool('pushNotifyEnabled', 'config.pushNotifyEnabledLabel', 'Enable browser notifications'),
                    bool('pushNotifyMonitor', 'config.pushNotifyMonitorLabel', 'Notify on downtime and recovery'),
                    bool('pushNotifyBackup', 'config.pushNotifyBackupLabel', 'Notify on automatic backups'),
                    { field: 'pushNotifySubject', type: 'text', label: t('config.pushNotifySubjectLabel', 'Contact address for push services') },
                    { type: 'pushDevice' },
                ],
            },
            {
                tab: 'general',
                title: t('config.generalGroupSync', 'Sync & feedback'),
                note: t('config.generalGroupSyncNote', 'Settings normally follow you to every browser. Keep them on this device to give this one its own appearance and layout.'),
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
                    { field: 'updateCheckEnabled', type: 'checkbox', label: t('config.updateCheckLabel', 'Check GitHub for new releases'), disabled: !!document.querySelector('meta[name="nextdash-update-check-locked"]') },
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
            // Standalone explanatory text between controls. It has no field, so
            // it must be handled before anything reads c.field — the fallthrough
            // below turns an unknown type into a text input bound to undefined.
            if (c.type === 'note') {
                return `<p class="config-field-hint">${esc(c.text)}</p>`;
            }
            // Per-device push controls. Permission is granted per browser, so this
            // cannot be a synced setting like the toggles around it — the state is
            // read from the browser after render.
            if (c.type === 'pushDevice') {
                return `
                    <div class="config-field-row" data-push-device-row>
                        <span class="config-field-hint" data-push-status></span>
                    </div>
                    <div class="config-field-row">
                        <button type="button" class="config-btn" data-push-toggle disabled>${esc(this.t('config.pushNotifyEnableDevice', 'Enable on this device'))}</button>
                        <button type="button" class="config-btn" data-push-test hidden>${esc(this.t('config.pushNotifyTestButton', 'Send test notification'))}</button>
                        <button type="button" class="config-btn" data-push-reask hidden>${esc(this.t('config.pushNotifyAskAgain', 'Show the invitation again'))}</button>
                    </div>`;
            }
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
            // Big labelled choice buttons, for a small set of options where the
            // trade-off needs a sentence each. A <select> hides those sentences
            // behind a click and gives no room for them.
            if (c.type === 'cards') {
                const cards = c.options.map((o) => {
                    const on = String(val) === String(o.value);
                    return `
                        <button type="button" class="config-choice-card${on ? ' is-active' : ''}"
                                ${dataAttrs} data-${prefix}-type="cards" data-${prefix}-value="${esc(o.value)}"
                                role="radio" aria-checked="${on ? 'true' : 'false'}">
                            <span class="config-choice-card-title">${esc(o.label)}</span>
                            <span class="config-choice-card-body">${esc(o.body || '')}</span>
                        </button>`;
                }).join('');
                return `
                    <div class="config-field config-field--cards">
                        <span class="config-field-label">${esc(c.label)}</span>
                        <span class="config-field-affordances">${aff}</span>
                    </div>
                    <div class="config-choice-cards" role="radiogroup" aria-label="${esc(c.label)}">${cards}</div>${hint}`;
            }
            let control;
            if (c.type === 'select') {
                const opts = c.options.map((o) =>
                    `<option value="${esc(o.value)}" ${String(val) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`
                ).join('');
                // A <select> always yields a string, but these fields are ints
                // server-side and a string fails to unmarshal — rejecting the
                // whole save with 400, not just this field. Flag numeric options
                // so the change handler can coerce back.
                const numeric = c.options.every((o) => typeof o.value === 'number');
                control = `<select class="config-select" ${dataAttrs} data-${prefix}-type="select"${numeric ? ` data-${prefix}-numeric="1"` : ''}>${opts}</select>`;
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
            const numericSelect = el.hasAttribute(`data-${prefix}-numeric`);
            if (type === 'cards') {
                // Buttons, not an input: click rather than change, and the group
                // has to repaint its own selection because several elements share
                // one field and nothing else redraws this panel.
                el.addEventListener('click', () => {
                    const value = el.getAttribute(`data-${prefix}-value`);
                    container.querySelectorAll(
                        `[data-${prefix}-field="${CSS.escape(field)}"][data-${prefix}-type="cards"]`
                    ).forEach((card) => {
                        const on = card === el;
                        card.classList.toggle('is-active', on);
                        card.setAttribute('aria-checked', on ? 'true' : 'false');
                    });
                    void this.setBehavior(field, value, special);
                });
            } else if (type === 'checkbox') {
                el.addEventListener('change', () => this.setBehavior(field, el.checked, special));
            } else if (type === 'number' || numericSelect) {
                el.addEventListener('change', () => this.setBehavior(field, Number(el.value), special));
            } else {
                el.addEventListener('change', () => this.setBehavior(field, el.value, special));
            }
        });
        this.bindPushDeviceControls(container);
        this.bindAffordances(container, (field) => {
            const el = container.querySelector(`[data-${prefix}-field="${CSS.escape(field)}"]`);
            const special = el?.getAttribute(`data-${prefix}-special`) || '';
            return special;
        });
    }

    /**
     * Wire the per-device push buttons and reflect this browser's actual state.
     *
     * Kept apart from the synced settings: whether *this* browser has permission
     * is a property of the browser, not of the dashboard's settings, so it is
     * always read live rather than from this.dash.settings.
     */
    bindPushDeviceControls(container) {
        const toggle = container.querySelector('[data-push-toggle]');
        if (!toggle) return;
        const status = container.querySelector('[data-push-status]');
        const test = container.querySelector('[data-push-test]');
        const reask = container.querySelector('[data-push-reask]');
        const push = window.PushNotifications;

        const notify = (msg) => window.AppNotification?.show?.(msg);

        // Mirrors the browser's subscription state so the click handler can branch
        // synchronously; see the comment in that handler for why it must not await.
        let isSubscribedNow = false;

        const refreshState = async () => {
            // Decided before the early returns below: bringing the invitation back
            // is about the dashboard card, not about whether this browser can
            // currently subscribe, so it stays available even when push is blocked
            // here. Re-hidden further down once this device is registered.
            if (reask) {
                reask.hidden = this.dash.settings?.quickStart?.pushChoiceMade !== true;
            }
            if (!push?.isSupported()) {
                isSubscribedNow = false;
                toggle.disabled = true;
                if (status) status.textContent = this.t('config.pushNotifyUnsupported', 'This browser does not support push notifications.');
                if (test) test.hidden = true;
                return;
            }
            if (!push.isSecureContext()) {
                isSubscribedNow = false;
                toggle.disabled = true;
                if (status) status.textContent = this.t('config.pushNotifyInsecure', 'Push notifications require HTTPS (or localhost).');
                if (test) test.hidden = true;
                return;
            }
            if (push.permission() === 'denied') {
                isSubscribedNow = false;
                toggle.disabled = true;
                if (status) status.textContent = this.t('config.pushNotifyBlocked', 'Notifications are blocked for this site. Allow them in your browser settings.');
                if (test) test.hidden = true;
                return;
            }

            // The server-side master switch gates everything; without it the
            // subscribe endpoint refuses, so do not offer the button.
            const enabled = Boolean(this.dash.settings?.pushNotifyEnabled);
            const subscribed = enabled && await push.isSubscribed();
            isSubscribedNow = subscribed;
            toggle.disabled = !enabled;
            toggle.textContent = subscribed
                ? this.t('config.pushNotifyDisableDevice', 'Disable on this device')
                : this.t('config.pushNotifyEnableDevice', 'Enable on this device');
            if (status) {
                status.textContent = subscribed
                    ? this.t('config.pushNotifyEnabledOnDevice', 'Notifications are on for this device.')
                    : this.t('config.pushNotifyDisabledOnDevice', 'Notifications are off for this device.');
            }
            if (test) test.hidden = !subscribed;
            // Nothing to bring back once this device is registered.
            if (reask && subscribed) reask.hidden = true;
        };

        toggle.addEventListener('click', async () => {
            // Nothing may run before subscribe() that could end the user gesture.
            //
            // Safari treats disabling the clicked button as the end of the gesture,
            // and requestPermission() then refuses with "Notification prompting can
            // only be done from a user gesture" — the dialog never appears. The
            // button is therefore disabled *after* the call is under way, and the
            // subscribed state comes from refreshState() rather than a fresh await.
            const wasSubscribed = isSubscribedNow;
            const pending = wasSubscribed ? push.unsubscribe() : push.subscribe();
            toggle.disabled = true;
            try {
                if (wasSubscribed) {
                    await pending;
                    notify(this.t('config.pushNotifyDisabledOnDevice', 'Notifications are off for this device.'));
                } else {
                    await pending;
                    // Confirm in-page *and* send a real notification: without the
                    // second one a successful opt-in looks like nothing happened,
                    // and the user has no way to tell delivery actually works.
                    notify(this.t('config.pushNotifyEnabledOnDevice', 'Notifications are on for this device.'));
                    try {
                        await push.sendTest();
                    } catch (err) {
                        notify(this.t('config.pushNotifyWelcomeFailed', 'Registered, but the first notification could not be delivered.'));
                    }
                }
            } catch (err) {
                notify(err.message || String(err));
            } finally {
                await refreshState();
            }
        });

        // Clearing the answer is all this needs to do: the card checks that flag
        // itself and comes back on the dashboard, where the click that accepts it
        // is a real user gesture. Prompting from here would sit behind the config
        // view the card is not allowed to cover.
        reask?.addEventListener('click', async () => {
            reask.disabled = true;
            try {
                const qs = this.dash.settings?.quickStart;
                if (qs) {
                    qs.pushChoiceMade = false;
                    qs.pushAskAfter = 0;
                    qs.pushSnoozes = 0;
                    await this.dash.saveSettings?.();
                }
                notify(this.t('config.pushNotifyAskAgainDone', 'The invitation will appear again on the dashboard.'));
            } catch (err) {
                notify(err.message || String(err));
            } finally {
                reask.disabled = false;
                await refreshState();
            }
        });

        test?.addEventListener('click', async () => {
            test.disabled = true;
            try {
                await push.sendTest();
                notify(this.t('config.pushNotifyTestSent', 'Test notification sent.'));
            } catch (err) {
                notify(err.message || String(err));
            } finally {
                test.disabled = false;
            }
        });

        refreshState();
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

    static BEHAVIOR_TABS = ['general', 'datetime', 'search', 'status', 'privacy'];

    /**
     * Date & weather fields that need a fresh fetch rather than a redraw: each
     * one is part of the weather cache key (weather.js getCacheKey), so the
     * cached reading belongs to the old value.
     */
    static WEATHER_FETCH_FIELDS = ['weatherLocation', 'weatherSource', 'weatherUnit', 'showWeatherWithDate'];

    behaviorTabLabel(tab) {
        const map = {
            general: ['config.behaviorTabGeneral', 'General'],
            datetime: ['config.behaviorTabDateTime', 'Date & weather'],
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
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-behavior-body" data-behavior-tab="${esc(tab)}">${esc(this.behaviorTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.behaviorIntro', 'How the dashboard behaves. Every change applies immediately and is saved.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div id="config-behavior-body" role="tabpanel" tabindex="0">${this.renderBehaviorBody()}</div>
        `;
    }

    renderBehaviorBody() {
        const panels = this.behaviorSchema().filter((p) => (p.tab || 'general') === this.behaviorTab);
        const lead = this.behaviorTab === 'status' ? this.renderStatusModesLead() : '';
        // The two onboarding actions are buttons rather than settings, so they
        // cannot come from the schema; they are appended to the General tab so
        // the whole of onboarding sits together as it did in the old config.
        const trailing = this.behaviorTab === 'general' ? this.renderOnboardingActions() : '';
        return lead + this.renderControlPanels(panels, 'behavior') + trailing;
    }

    renderOnboardingActions() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-panel config-panel--attached">
                <p class="config-panel-note">${esc(this.t('config.resetOnboardingHint', 'Show the quick-start card again on the dashboard.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-behavior-action="reset-onboarding">${esc(this.t('config.resetOnboardingButton', 'Show quick-start card again'))}</button>
                    <button type="button" class="config-btn" data-behavior-action="whats-new">${esc(this.t('config.showWhatsNew', 'Show what’s new'))}</button>
                </div>
            </div>`;
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
        this.bindSubTabStrip(container, 'data-behavior-tab', (tab) => {
            if (tab === this.behaviorTab) return;
            this.behaviorTab = tab;
            this.restoreConfigHash();
            const body = document.getElementById('config-behavior-body');
            if (!body) { this.render(); return; }
            body.innerHTML = this.renderBehaviorBody();
            this.syncSubTabStrip('data-behavior-tab', this.behaviorTab);
            this.bindControlPanels(container, 'behavior');
            this.bindBehaviorActions(container);
            this.bindFormKeyboard(container);
            this.bindFormKeyboardLegend(container);
        });
        this.bindControlPanels(container, 'behavior');
        this.bindBehaviorActions(container);
        this.bindFormKeyboard(container);
    }

    /**
     * The onboarding buttons on the General tab.
     *
     * Rebound after a tab switch as well: the body is replaced wholesale, so
     * handlers attached to the previous markup are gone with it.
     */
    bindBehaviorActions(container) {
        container.querySelectorAll('[data-behavior-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-behavior-action');
                if (action === 'reset-onboarding') void this.resetOnboarding();
                if (action === 'whats-new') void this.openWhatsNew();
            });
        });
    }

    /** Apply a behaviour setting: mutate, run any special apply, save. */
    async setBehavior(field, value, special) {
        const d = this.dash;
        d.settings[field] = value;
        // Which settings people actually change. The field name is a fixed enum
        // so it is safe to report; the value is not (titles, webhook URLs and
        // custom text are free-form and can be personal). Booleans are the one
        // exception — 'on'/'off' is what makes a toggle worth measuring, and it
        // cannot carry anything identifying.
        this._trackAction('setting', {
            field,
            ...(typeof value === 'boolean' ? { value: value ? 'on' : 'off' } : {}),
        });
        // Toggling analytics here is an answer to the opt-in question, whichever
        // way it goes. The card writes this flag itself and nothing else did, so
        // without it a deliberate choice made in config read as "never asked"
        // and the card came back to ask again. Mirrors search-commands.js.
        if (field === 'analyticsOptIn') {
            const qs = d.settings.quickStart;
            if (qs && typeof qs === 'object') {
                qs.analyticsChoiceMade = true;
                qs.analyticsAskAfter = 0; // answered; no snooze left to honour
            }
        }
        if (field === 'updateCheckEnabled') {
            void window.nextdashRefreshUpdateStatus?.(value !== false);
            if (this.section === 'overview') {
                this.repaintOverview();
            }
        }
        switch (special) {
            case 'language':
                await d.language?.init?.(value);
                d.renderDashboard?.({ animate: false });
                break;
            case 'datetime':
                // The clock and date line render from settings, but the weather
                // comes from a cached fetch keyed by location, source and unit —
                // so changing any of those has to refetch. Redrawing alone kept
                // showing the old location's reading until a full reload.
                if (DashboardConfig.WEATHER_FETCH_FIELDS.includes(field)) {
                    void d.refreshWeather?.(true);
                } else if (field === 'weatherRefreshMinutes') {
                    // The interval is only read when the timer is armed, so
                    // redrawing left the old setInterval running at the previous
                    // cadence until a reload. Re-arm it at the new one.
                    d.scheduleWeatherRefresh?.();
                } else {
                    d.renderDateWeatherLine?.();
                }
                break;
            case 'chrome':
                this.applyChromeSettings();
                break;
            case 'shortcutTooltips':
                // The popovers are listeners bound to the toolbar buttons, not
                // markup read at render time — so re-run the setup, which adds
                // or tears them down to match. This is what `:shortcuts on` in
                // the command palette already did; only config lagged behind.
                d.setupToolbarKbdTooltips?.();
                break;
            case 'chromeRender':
                // Both: the value is read at render time *and* mirrored onto
                // <body> by setupDOM, so neither alone is enough.
                this.applyChromeSettings();
                d.renderDashboard?.({ animate: false });
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
     * Reapply the header/toolbar chrome so a Toolbar & tabs toggle shows up at
     * once, without a reload.
     *
     * These settings are not read at render time: setupDOM writes them onto
     * <body> as data-* attributes that CSS keys off, and it only ran at startup.
     * renderDashboard is no help while config is open either — it re-renders the
     * active view, which is this one, and returns before touching the header.
     */
    applyChromeSettings() {
        const d = this.dash;
        d.setupDOM?.();
        // setupDOM covers the data-* attributes and the config/health/tabs links;
        // the tab labels themselves are built in JS, so showPageNamesInTabs needs
        // the navigation rebuilt to take effect.
        d.renderPageNavigation?.();
        // Rebuilding the nav drops the active markers setActivePageNavButton set.
        d.pageNav?.setActivePageNavButton?.(d.currentPageId);
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
        const promise = (async () => {
            let ok = false;
            try {
                const theme = this.dash.settings?.theme;
                if (theme && window.ThemeUtils?.isUserCustomThemeId?.(theme)) {
                    await this.ensureCustomThemeOnServer(theme);
                }
                // saveSettings resolves false rather than rejecting; it reports its
                // own error toast as well.
                ok = (await this.dash.saveSettings?.()) !== false;
            } catch {
                ok = false;
            }
            this.setSaveState(ok ? 'saved' : 'error');
            return ok;
        })();
        this._settingsSavePromise = promise;
        try {
            return await promise;
        } finally {
            if (this._settingsSavePromise === promise) {
                this._settingsSavePromise = null;
            }
        }
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

    static PT_TABS = ['categories', 'tags', 'pages', 'finders', 'collections'];

    /** Data & backups keeps its destructive actions on a separate tab. */
    static DB_TABS = ['backups', 'reset'];

    static APPEARANCE_TABS = ['general', 'layout', 'display', 'toolbar', 'branding', 'custom-themes'];

    static STATS_TABS = ['overview', 'activity', 'content', 'inbox', 'health'];

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
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-pt-body" data-pt-tab="${esc(tab)}">${esc(this.ptTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.pagesTagsIntro', 'Manage pages, categories, tags, finders, and smart collections.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div id="config-pt-body" role="tabpanel" tabindex="0">${this.renderPtTab()}</div>
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
        this.bindSubTabStrip(container, 'data-pt-tab', (tab) => {
            if (tab === this.ptTab) return;
            this.clearListKeyboardSelection();
            this.ptTab = tab;
            this.restoreConfigHash();
            this.repaintPtBody();
        });
        this.bindPtTabControls(container);
    }

    repaintPtBody() {
        const body = document.getElementById('config-pt-body');
        if (!body) { this.render(); return; }
        body.innerHTML = this.renderPtTab();
        this.syncSubTabStrip('data-pt-tab', this.ptTab);
        const container = document.getElementById('dashboard-layout');
        if (container) this.bindPtTabControls(container);
    }

    bindPtTabControls(container) {
        if (this.ptTab === 'finders') { this.bindFinders(container); void this.loadFinders(); }
        // bindTags here as well as after the fetch: loadTagsManager returns
        // early once loaded, so a repaint would otherwise leave the filter and
        // the cloud with no handlers.
        else if (this.ptTab === 'tags') { this.bindTags(container); void this.loadTagsManager(); }
        else if (this.ptTab === 'collections') { this.bindCollections(container); }
        else if (this.ptTab === 'pages') { this.bindPagesEditor(container); }
        else if (this.ptTab === 'categories') { this.bindCategoriesEditor(container); void this.loadCategoriesEditor(); }
        this.bindListKeyboard(container);
    }

    /* ── Finders (native) ──────────────────────────────────────────────────── */

    finderQueryPlaceholder() { return '%s'; }

    renderFinders() {
        const esc = (v) => this.dash.escapeHtml(v);
        if (this._finders == null) {
            return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        }
        const rows = this._finders.map((f, i) => {
            // search.js does searchUrl.replace('%s', query), which is a no-op
            // when the placeholder is absent: the finder then opens the bare URL
            // and silently drops what you typed. The old config warned about
            // this; without it the finder looks saved and simply misbehaves.
            const url = String(f.searchUrl || '').trim();
            const missingPlaceholder = url.length > 0 && !url.includes('%s');
            const warning = missingPlaceholder
                ? `<p class="config-field-warning" data-finder-warning="${i}">${esc(this.t('config.finderUrlMissingPlaceholderHint', 'Add %s where the search query should go.'))}</p>`
                : '';
            return `
            <li class="config-crud-row" data-finder-index="${i}">
                <div class="config-crud-fields">
                    <input type="text" class="config-text" data-finder="name" data-index="${i}" placeholder="${esc(this.t('config.finderNamePlaceholder', 'Name'))}" value="${esc(f.name || '')}">
                    <input type="text" class="config-text${missingPlaceholder ? ' field-conflict' : ''}" data-finder="searchUrl" data-index="${i}" placeholder="https://example.com/search?q=%s" value="${esc(f.searchUrl || '')}">
                    <input type="text" class="config-text" style="min-width:70px" data-finder="shortcut" data-index="${i}" placeholder="${esc(this.t('config.finderShortcutPlaceholder', 'key'))}" value="${esc(f.shortcut || '')}">
                    ${warning}
                </div>
                <button type="button" class="config-btn config-btn--small config-btn--danger" data-finder-delete="${i}">${esc(this.t('config.backupDelete', 'Delete'))}</button>
            </li>
        `;
        }).join('');
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
        // The %s warning updates as you type rather than on commit, so it goes
        // away the moment you add the placeholder instead of after a repaint.
        container.querySelectorAll('[data-finder="searchUrl"]').forEach((input) => {
            input.addEventListener('input', () => {
                const i = Number(input.getAttribute('data-index'));
                const url = String(input.value || '').trim();
                const missing = url.length > 0 && !url.includes('%s');
                input.classList.toggle('field-conflict', missing);
                const fields = input.closest('.config-crud-fields');
                let hint = fields?.querySelector(`[data-finder-warning="${i}"]`);
                if (missing && !hint && fields) {
                    hint = document.createElement('p');
                    hint.className = 'config-field-warning';
                    hint.setAttribute('data-finder-warning', String(i));
                    hint.textContent = this.t('config.finderUrlMissingPlaceholderHint',
                        'Add %s where the search query should go.');
                    fields.appendChild(hint);
                } else if (!missing && hint) {
                    hint.remove();
                }
            });
        });
        container.querySelectorAll('[data-finder]').forEach((input) => {
            input.addEventListener('change', () => {
                const i = Number(input.getAttribute('data-index'));
                const key = input.getAttribute('data-finder');
                if (!this._finders || !this._finders[i]) return;
                const others = this._finders.filter((_, idx) => idx !== i);
                if (key === 'name' && !this.guardUniqueName(
                    input, input.value, others.map((f) => f.name),
                    {
                        previous: this._finders[i].name,
                        message: this.t('config.finderNameDuplicate', 'A finder with this name already exists.'),
                    }
                )) return;
                // A repeated shortcut is worse than a repeated name: it decides
                // which finder "?g" actually runs, and only one can win.
                if (key === 'shortcut' && !this.guardUniqueName(
                    input, input.value, others.map((f) => f.shortcut),
                    {
                        previous: this._finders[i].shortcut,
                        message: this.t('config.finderShortcutDuplicate', 'Another finder already uses this shortcut.'),
                    }
                )) return;
                this._finders[i][key] = input.value;
                void this.saveFinders();
            });
        });
        const addBtn = container.querySelector('[data-finder-add]');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this._finders = this._finders || [];
                this._finders.push({ name: '', searchUrl: '', shortcut: '' });
                this.repaintPtBody();
                // Deliberately not saved yet: an all-blank finder is not a
                // finder, and persisting it means a refresh mid-typing leaves an
                // empty row behind. The first edit to any field saves the row.
                document.querySelector('[data-finder="name"][data-index="'
                    + (this._finders.length - 1) + '"]')?.focus();
            });
        }
        container.querySelectorAll('[data-finder-delete]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const i = Number(btn.getAttribute('data-finder-delete'));
                if (!this._finders || !this._finders[i]) return;
                const finder = this._finders[i];
                // A blank row was never really created, so asking about it is
                // just an obstacle between adding one by accident and undoing it.
                const named = String(finder.name || '').trim() || String(finder.searchUrl || '').trim();
                if (named) {
                    const ok = await this.confirmAction(
                        this.t('config.finderDeleteConfirm', 'Delete the finder “{name}”?')
                            .replace('{name}', String(finder.name || finder.searchUrl || ''))
                    );
                    if (!ok) return;
                }
                this._finders.splice(i, 1);
                this.repaintPtBody();
                void this.saveFinders();
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

    /**
     * Tier class for a tag-cloud word.
     *
     * Separate from tierClassForScale, which returns the config-stat--tier-*
     * names used by the stat bars: the cloud's own tiers carry the colour
     * gradation that makes a cloud readable, and passing it a stat class meant
     * every word rendered in the same colour.
     */
    static cloudTierForScale(scale) {
        if (scale >= 0.82) return 'tag-cloud-word--tier-xl';
        if (scale >= 0.62) return 'tag-cloud-word--tier-lg';
        if (scale >= 0.42) return 'tag-cloud-word--tier-md';
        if (scale >= 0.22) return 'tag-cloud-word--tier-sm';
        return 'tag-cloud-word--tier-xs';
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

    /**
     * Bookmarks per category, limited to one page.
     *
     * Keyed by category *id* ("development"), which is what a bookmark stores —
     * not the display name ("Development"). Look results up with
     * categoryCountFor so the two are never confused.
     */
    categoryBookmarkCounts(pageId) {
        const counts = new Map();
        (this.dash.allBookmarks || []).forEach((b) => {
            if (String(b.pageId) !== String(pageId)) return;
            const id = String(b.category || '');
            if (!id) return;
            counts.set(id, (counts.get(id) || 0) + 1);
        });
        return counts;
    }

    /**
     * The count for one category, given the map above.
     *
     * Prefers the id, because that is the key bookmarks are counted under.
     * Falls back to the name for categories created without an id, and for
     * bookmarks whose category was stored as a display name — both exist in
     * older data, and neither should silently show zero.
     */
    static categoryCountFor(counts, category) {
        const id = String(category?.id || '');
        if (id && counts.has(id)) return counts.get(id);
        const name = String(category?.name || '');
        if (name && counts.has(name)) return counts.get(name);
        return 0;
    }

    /* ── Tags & collections placeholders (native, built next) ──────────────── */

    /** Stable per-tag tilt, so the cloud looks scattered but never reshuffles. */
    static tagRotate(tag) {
        let h = 0;
        const s = String(tag || '');
        for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
        return ((h % 9) - 4) * 0.55;
    }

    /** Tags passing the filter box, in the stored order (most used first). */
    visibleTags() {
        const q = String(this._tagQuery || '').trim().toLowerCase();
        const list = this._tagList || [];
        return q ? list.filter((t) => t.tag.toLowerCase().includes(q)) : list;
    }

    /**
     * A word cloud sized by usage, as the old config's tags tab had.
     *
     * Reuses the dashboard's own .tag-cloud-word styling and tier classes
     * (dashboard-tag-cloud.css, already loaded here) rather than a lookalike,
     * so the cloud in config and the one on the dashboard cannot drift apart.
     * Clicking a word filters the list below it.
     */
    renderTagCloud(tags) {
        const esc = (v) => this.dash.escapeHtml(v);
        if (!tags.length) return '';
        const counts = tags.map((t) => t.count);
        const max = Math.max(...counts);
        const min = Math.min(...counts);
        const words = [...tags]
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
            .map((t, i) => {
                const scale = DashboardConfig.scaleForCount(t.count, min, max);
                const label = this.t('config.tagBookmarkCount', '{count} bookmarks')
                    .replace('{count}', String(t.count));
                // Same .is-selected / aria-pressed pair the dashboard's own tag
                // cloud uses, so the two clouds behave alike.
                const selected = this._tagQuery === t.tag;
                return `<button type="button"
                    class="tag-cloud-word ${esc(DashboardConfig.cloudTierForScale(scale))}${selected ? ' is-selected' : ''}"
                    data-tag-cloud="${esc(t.tag)}" role="listitem" aria-pressed="${selected ? 'true' : 'false'}"
                    style="--tag-scale:${scale.toFixed(3)};--tag-rotate:${DashboardConfig.tagRotate(t.tag).toFixed(2)}deg;--tag-index:${i}"
                    title="#${esc(t.tag)} — ${esc(label)}" aria-label="${esc(t.tag)}. ${esc(label)}">
                    <span class="tag-cloud-word-hash" aria-hidden="true">#</span>
                    <span class="tag-cloud-word-label">${esc(t.tag)}</span>
                </button>`;
            }).join('');
        return `<div class="tag-cloud-wordcloud config-tag-cloud" role="list">${words}</div>`;
    }

    renderTagsManager() {
        const esc = (v) => this.dash.escapeHtml(v);
        if (this._tagList == null) {
            return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        }
        if (this._tagList.length === 0) {
            return `<p class="config-panel-empty">${esc(this.t('config.tagsEmpty', 'No tags yet. Add tags to bookmarks to manage them here.'))}</p>`;
        }
        const visible = this.visibleTags();
        const scales = DashboardConfig.statScales(visible.map((t) => t.count));
        const rows = visible.map(({ tag, count }, i) => `
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
            ${this.renderTagCloud(this._tagList)}
            <div class="config-crud-toolbar">
                <input type="search" class="config-text" id="config-tag-filter"
                       placeholder="${esc(this.t('config.tagsFilterPlaceholder', 'Filter tags…'))}"
                       value="${esc(this._tagQuery || '')}">
                ${this._tagQuery ? `<button type="button" class="config-btn config-btn--small" data-tag-filter-clear>${esc(this.t('config.statsFilterClear', 'Clear'))}</button>` : ''}
            </div>
            ${rows
                ? `<ul class="config-crud-list">${rows}</ul>`
                : `<p class="config-panel-empty">${esc(this.t('config.tagsNoMatch', 'No tags match your filter.'))}</p>`}
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
        // repaintPtBody re-runs bindPtTabControls, which binds the tags
        // controls against the markup it just wrote.
        if (this.ptTab === 'tags') this.repaintPtBody();
    }

    bindTags(container) {
        if (!container) return;
        const filter = container.querySelector('#config-tag-filter');
        if (filter) {
            filter.addEventListener('input', () => {
                this._tagQuery = filter.value;
                this.repaintTagsBody();
            });
        }
        container.querySelector('[data-tag-filter-clear]')?.addEventListener('click', () => {
            this._tagQuery = '';
            this.repaintTagsBody();
        });
        container.querySelectorAll('[data-tag-cloud]').forEach((chip) => {
            chip.addEventListener('click', () => {
                // Clicking a word filters the list to it, and clicking the same
                // word again clears — the cloud doubles as the filter control.
                const tag = chip.getAttribute('data-tag-cloud');
                this._tagQuery = this._tagQuery === tag ? '' : tag;
                this.repaintTagsBody();
            });
        });
        container.querySelectorAll('[data-tag-rename]').forEach((input) => {
            input.addEventListener('change', () => {
                const from = input.getAttribute('data-tag-rename');
                const to = input.value.trim();
                if (!to || to === from) return;
                // Renaming onto an existing tag would quietly merge the two,
                // losing the distinction with no way back.
                if (!this.guardUniqueName(input, to, (this._tagList || []).map((t) => t.tag), {
                    previous: from,
                    message: this.t('config.tagNameDuplicate', 'A tag with this name already exists.'),
                })) return;
                void this.rewriteTag(from, to);
            });
        });
        container.querySelectorAll('[data-tag-delete]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const tag = btn.getAttribute('data-tag-delete');
                if (await this.confirmAction(this.t('config.tagDeleteConfirm', 'Delete this tag from all bookmarks?'))) {
                    void this.rewriteTag(tag, null);
                }
            });
        });
    }

    /**
     * Repaint the tags tab, restoring focus and caret to the filter box.
     *
     * The body is replaced wholesale, so without this the input would lose
     * focus on the first keystroke and swallow the rest of what you type.
     */
    repaintTagsBody() {
        const active = document.activeElement;
        const wasFilter = active?.id === 'config-tag-filter';
        const caret = wasFilter ? active.selectionStart : null;
        this.repaintPtBody();
        if (!wasFilter) return;
        const next = document.getElementById('config-tag-filter');
        if (!next) return;
        next.focus();
        if (caret != null) next.setSelectionRange(caret, caret);
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
            this.dash.renderDashboard?.({ animate: false });
        } catch {
            this.notify(this.t('config.tagsSaveError', 'Could not update the tag.'), 'error');
        }
    }

    collectionsSchema() {
        const t = (k, f) => this.t(k, f);
        const bool = (field, label, fallback) => ({ field, type: 'checkbox', label: t(label, fallback) });
        // Must cover every stored default (Today 8, Most used 25, Recent and
        // Stale 50) or the select falls back to its first option and shows a
        // value the setting does not have — then writes it on the next change.
        // 0 means "no limit", which is what the builders treat <= 0 as.
        const limitOpts = [0, 5, 8, 10, 15, 20, 25, 30, 50, 100].map((n) => ({
            value: n,
            label: n === 0 ? t('config.smartLimitUnlimited', 'Unlimited') : String(n),
        }));
        return [
            {
                title: t('config.smartCollectionsTitle', 'Smart collections'),
                note: t('config.smartCollectionsNote', 'Collections the dashboard fills for you from how and when you use your bookmarks — no rules to maintain. Each limit caps how many appear.'),
                controls: [
                    bool('showSmartTodayCollection', 'config.showSmartTodayCollection', 'Show “Today” collection'),
                    { field: 'smartTodayLimit', type: 'select', label: t('config.smartTodayLimit', 'Today limit'), special: 'render', options: limitOpts },
                    bool('showSmartRecentCollection', 'config.showSmartRecentCollection', 'Show “Recent” collection'),
                    { field: 'smartRecentLimit', type: 'select', label: t('config.smartRecentLimit', 'Recent limit'), special: 'render', options: limitOpts },
                    bool('showSmartStaleCollection', 'config.showSmartStaleCollection', 'Show “Stale” collection'),
                    { field: 'smartStaleLimit', type: 'select', label: t('config.smartStaleLimit', 'Stale limit'), special: 'render', options: limitOpts },
                    bool('showSmartMostUsedCollection', 'config.showSmartMostUsedCollection', 'Show “Most used” collection'),
                    { field: 'smartMostUsedLimit', type: 'select', label: t('config.smartMostUsedLimit', 'Most-used limit'), special: 'render', options: limitOpts },
                    {
                        type: 'note',
                        // Turning this on before anything has been opened looks
                        // broken: the collection only exists once a bookmark has
                        // an open count, which is why the toggle alone shows
                        // nothing on a fresh dashboard.
                        text: t(
                            'config.smartMostUsedEmptyHint',
                            '“Most used” only appears once you have opened bookmarks from the dashboard — it is built from open counts, so it stays hidden until there is something to rank.'
                        ),
                    },
                ],
            },
            {
                title: t('config.tagCollectionsTitle', 'Tag collections'),
                note: t('config.tagCollectionsNote', 'Turns a tag into its own collection once enough bookmarks share it. Raise the minimum to keep one-off tags out.'),
                controls: [
                    bool('showTagCollections', 'config.showTagCollections', 'Show tag collections'),
                    { field: 'tagCollectionsMinCount', type: 'number', label: t('config.tagCollectionsMinCount', 'Minimum tag count'), min: 1, max: 50, special: 'render' },
                ],
            },
            {
                title: t('config.smartTodayKeywordsTitle', '“Today” keywords'),
                note: t('config.smartTodayKeywordsNote', 'Words that push a bookmark up the “Today” list at the matching time — work terms during office hours, the rest in the evening or at the weekend. Comma-separated.'),
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
            + this.renderCustomCollections()
            + this.renderCollectionScopes();
    }

    /* ── Custom (rule-based) collections ───────────────────────────────────── */

    /** The user's own collections, as stored in settings.collections. */
    customCollections() {
        const list = this.dash.settings?.collections;
        return Array.isArray(list) ? list : [];
    }

    static newCollectionId() {
        return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    collectionRuleFieldLabel(field) {
        const map = {
            tag: ['config.collectionRuleFieldTag', 'Tag'],
            category: ['config.collectionRuleFieldCategory', 'Category'],
            shortcut: ['config.collectionRuleFieldShortcut', 'Shortcut'],
        };
        const [key, fallback] = map[field] || [field, field];
        return this.t(key, fallback);
    }

    /**
     * Rule-based collections, which the dashboard already renders but the new
     * config had no way to create.
     *
     * The shape is fixed by _evaluateCollection in dashboard-smart-collections:
     * {id, name, icon, logic: 'and'|'or', rules:[{field, operator, value}]}.
     * A collection with no rules is skipped there, so the editor keeps at least
     * one rule row rather than letting you save something inert.
     */
    renderCustomCollections() {
        const esc = (v) => this.dash.escapeHtml(v);
        const cols = this.customCollections();
        const editing = this._collectionEditing;

        const rows = cols.length
            ? cols.map((col) => {
                const n = Array.isArray(col.rules) ? col.rules.length : 0;
                const ruleLabel = n === 1
                    ? this.t('config.collectionRuleCountOne', '1 rule')
                    : this.t('config.collectionRuleCount', '{count} rules').replace('{count}', String(n));
                const open = editing === col.id;
                return `
                <li class="config-crud-row${open ? ' is-active' : ''}" data-collection-row="${esc(col.id)}">
                    <div class="config-crud-fields">
                        <span class="config-stat-name">${esc(col.icon ? `${col.icon} ` : '')}${esc(col.name || col.id)}</span>
                        <span class="config-stat-sub">${esc(ruleLabel)}</span>
                    </div>
                    <div class="config-crud-row-actions">
                        <button type="button" class="config-btn config-btn--small${open ? ' is-active' : ''}" data-collection-edit="${esc(col.id)}">${esc(this.t('config.collectionEditBtn', 'Edit'))}</button>
                        <button type="button" class="config-btn config-btn--small config-btn--danger" data-collection-delete="${esc(col.id)}">${esc(this.t('config.backupDelete', 'Delete'))}</button>
                    </div>
                </li>${open ? `<li class="config-collection-editor">${this.renderCollectionEditor(col)}</li>` : ''}`;
            }).join('')
            : `<li class="config-panel-empty">${esc(this.t('config.collectionsEmptyHint', 'No collections yet.'))}</li>`;

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.customCollectionsTitle', 'Custom collections'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.customCollectionsNote', 'Group bookmarks by rules on their tags, category or shortcut. They appear on the dashboard alongside the smart collections.'))}</p>
                <ul class="config-crud-list">${rows}</ul>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-collection-add>${esc(this.t('config.addCollectionBtn', 'Add collection'))}</button>
                </div>
            </div>`;
    }

    renderCollectionEditor(col) {
        const esc = (v) => this.dash.escapeHtml(v);
        const logic = col.logic === 'or' ? 'or' : 'and';
        const rules = Array.isArray(col.rules) && col.rules.length
            ? col.rules
            : [{ field: 'tag', operator: 'includes', value: '' }];

        // Suggestions come from what is actually in use, so a rule value can be
        // picked rather than remembered.
        const tags = [...new Set((this.dash.allBookmarks || []).flatMap((b) => b.tags || []))].sort();
        const cats = this.knownCategories().map((c) => c.id);
        const shortcuts = [...new Set((this.dash.allBookmarks || [])
            .map((b) => String(b.shortcut || '').trim()).filter(Boolean))].sort();
        const listFor = (field) => (field === 'category' ? cats : field === 'shortcut' ? shortcuts : tags);

        const ruleRows = rules.map((r, i) => {
            const field = r.field || 'tag';
            const op = r.operator === 'excludes' ? 'excludes' : 'includes';
            const options = listFor(field)
                .map((v) => `<option value="${esc(v)}"></option>`).join('');
            return `
            <div class="config-collection-rule" data-collection-rule="${i}">
                <select class="config-select" data-rule-field="${i}">
                    ${['tag', 'category', 'shortcut'].map((f) =>
                        `<option value="${f}" ${f === field ? 'selected' : ''}>${esc(this.collectionRuleFieldLabel(f))}</option>`).join('')}
                </select>
                <select class="config-select" data-rule-operator="${i}">
                    <option value="includes" ${op === 'includes' ? 'selected' : ''}>${esc(this.t('config.collectionRuleOpIncludes', 'includes'))}</option>
                    <option value="excludes" ${op === 'excludes' ? 'selected' : ''}>${esc(this.t('config.collectionRuleOpExcludes', 'excludes'))}</option>
                </select>
                <input type="text" class="config-text" data-rule-value="${i}" list="config-rule-values-${i}"
                       value="${esc(r.value || '')}" placeholder="${esc(this.t('config.collectionRuleValuePlaceholder', 'value'))}">
                <datalist id="config-rule-values-${i}">${options}</datalist>
                <button type="button" class="config-btn config-btn--small config-btn--danger" data-rule-remove="${i}" ${rules.length === 1 ? 'disabled' : ''} aria-label="${esc(this.t('config.backupDelete', 'Delete'))}">✕</button>
            </div>`;
        }).join('');

        return `
            <div class="config-panel config-panel--attached">
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.collectionEditNameLabel', 'Name'))}</span>
                    <input type="text" class="config-text" data-collection-field="name"
                           value="${esc(col.name || '')}" placeholder="${esc(this.t('config.collectionEditNamePlaceholder', 'My collection'))}">
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.collectionEditIconLabel', 'Icon (emoji)'))}</span>
                    <input type="text" class="config-text" style="max-width:80px" data-collection-field="icon"
                           value="${esc(col.icon || '')}" placeholder="${esc(this.t('config.collectionEditIconPlaceholder', '★'))}">
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.collectionEditLogicLabel', 'Match logic'))}</span>
                    <select class="config-select" data-collection-field="logic">
                        <option value="and" ${logic === 'and' ? 'selected' : ''}>${esc(this.t('config.collectionEditLogicAnd', 'AND — all rules must match'))}</option>
                        <option value="or" ${logic === 'or' ? 'selected' : ''}>${esc(this.t('config.collectionEditLogicOr', 'OR — any rule must match'))}</option>
                    </select>
                </div>
                <h4 class="config-theme-group-title">${esc(this.t('config.collectionEditRulesLabel', 'Rules'))}</h4>
                <div class="config-collection-rules">${ruleRows}</div>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--small" data-collection-add-rule>${esc(this.t('config.collectionEditAddRule', '+ Add rule'))}</button>
                </div>
                <p class="config-field-hint" data-collection-match></p>
            </div>`;
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

    /**
     * Persist the collection list and redraw the dashboard behind the view, so
     * a rule change is visible without leaving config.
     */
    async saveCustomCollections() {
        this.dash.renderDashboard?.({ animate: false });
        await this.saveSettingsWithFeedback();
    }

    /** Live count of what a collection currently matches. */
    updateCollectionMatchCount(col) {
        const el = document.querySelector('[data-collection-match]');
        if (!el) return;
        const rules = (col.rules || []).filter((r) => String(r.value || '').trim());
        if (!rules.length) {
            el.textContent = this.t('config.collectionNoRules', 'Add a rule to match bookmarks.');
            return;
        }
        let matched = [];
        try {
            matched = this.dash.smartCollections?._evaluateCollection?.(
                { ...col, rules }, this.dash.allBookmarks || []) || [];
        } catch {
            matched = [];
        }
        el.textContent = this.t('config.collectionMatchCount', '{count} bookmarks match')
            .replace('{count}', String(matched.length));
    }

    bindCustomCollections(container) {
        const cols = this.customCollections();
        const editing = this._collectionEditing;
        const col = cols.find((c) => c.id === editing);

        container.querySelector('[data-collection-add]')?.addEventListener('click', () => {
            const names = cols.map((c) => c.name);
            const fresh = {
                id: DashboardConfig.newCollectionId(),
                name: DashboardConfig.uniqueNameFrom(
                    this.t('config.collectionEditNewTitle', 'New collection'), names),
                icon: '',
                logic: 'and',
                rules: [{ field: 'tag', operator: 'includes', value: '' }],
            };
            this.dash.settings.collections = [...cols, fresh];
            this._collectionEditing = fresh.id;
            this.repaintPtBody();
            void this.saveCustomCollections();
        });

        container.querySelectorAll('[data-collection-edit]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-collection-edit');
                this._collectionEditing = this._collectionEditing === id ? null : id;
                this.repaintPtBody();
            });
        });

        container.querySelectorAll('[data-collection-delete]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-collection-delete');
                const target = cols.find((c) => c.id === id);
                if (!target) return;
                const ok = await this.confirmAction(
                    this.t('config.collectionDeleteConfirm', 'Delete the collection “{name}”?')
                        .replace('{name}', String(target.name || id)));
                if (!ok) return;
                this.dash.settings.collections = cols.filter((c) => c.id !== id);
                if (this._collectionEditing === id) this._collectionEditing = null;
                this.repaintPtBody();
                await this.saveCustomCollections();
            });
        });

        if (!col) return;

        const commit = () => {
            this.updateCollectionMatchCount(col);
            void this.saveCustomCollections();
        };

        container.querySelectorAll('[data-collection-field]').forEach((el) => {
            const field = el.getAttribute('data-collection-field');
            el.addEventListener('change', () => {
                if (field === 'name' && !this.guardUniqueName(
                    el, el.value, cols.filter((c) => c.id !== col.id).map((c) => c.name),
                    {
                        previous: col.name,
                        message: this.t('config.collectionNameDuplicate', 'A collection with this name already exists.'),
                    }
                )) return;
                col[field] = el.value;
                if (field === 'name' || field === 'icon') this.repaintPtBody();
                commit();
            });
        });

        container.querySelector('[data-collection-add-rule]')?.addEventListener('click', () => {
            col.rules = [...(col.rules || []), { field: 'tag', operator: 'includes', value: '' }];
            this.repaintPtBody();
            void this.saveCustomCollections();
        });

        container.querySelectorAll('[data-rule-remove]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = Number(btn.getAttribute('data-rule-remove'));
                // The dashboard skips a collection with no rules, so the last
                // one stays; its Remove button is disabled to say so.
                if (!Array.isArray(col.rules) || col.rules.length <= 1) return;
                col.rules.splice(i, 1);
                this.repaintPtBody();
                void this.saveCustomCollections();
            });
        });

        const ruleEdit = (attr, key, repaint) => {
            container.querySelectorAll(`[${attr}]`).forEach((el) => {
                el.addEventListener('change', () => {
                    const i = Number(el.getAttribute(attr));
                    if (!col.rules?.[i]) return;
                    col.rules[i][key] = el.value;
                    // Changing the field changes which values can be suggested.
                    if (repaint) this.repaintPtBody();
                    commit();
                });
            });
        };
        ruleEdit('data-rule-field', 'field', true);
        ruleEdit('data-rule-operator', 'operator', false);
        ruleEdit('data-rule-value', 'value', false);

        this.updateCollectionMatchCount(col);
    }

    bindCollections(container) {
        this.bindControlPanels(container, 'collection');
        this.bindCustomCollections(container);
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
                const pages = this.dash.pages || [];
                const page = pages.find((p) => Number(p.id) === id);
                if (!page) return;
                if (key === 'name' && !this.guardUniqueName(
                    input,
                    input.value,
                    pages.filter((p) => Number(p.id) !== id).map((p) => p.name),
                    { previous: page.name, message: this.t('config.pageNameDuplicate', 'A page with this name already exists.') }
                )) return;
                page[key] = input.value;
                void this.savePages();
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
        // Deleting page 3 of 3 and adding again would otherwise reuse "Page 3".
        const name = DashboardConfig.uniqueNameFrom(
            `${this.t('config.pagePrefix', 'Page')} ${maxId + 1}`,
            pages.map((p) => p.name)
        );
        const newPage = { id: maxId + 1, name };
        pages.push(newPage);
        await this.savePages();
        this.repaintPtBody();
    }

    async deletePage(id) {
        if (Number(id) === 1) return;
        if (!await this.confirmAction(this.t('config.pageDeleteConfirm', 'Delete this page and its bookmarks?'))) return;
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
            const catCounts = this._categories.map((c) => DashboardConfig.categoryCountFor(counts, c));
            const scales = DashboardConfig.statScales(catCounts);
            const rows = this._categories.map((c, i) => `
                <li class="config-crud-row" data-cat-row="${i}">
                    <div class="config-crud-fields">
                        <input type="text" class="config-text" data-cat="name" data-index="${i}" value="${esc(c.name || '')}">
                        ${this.renderStatMeta(catCounts[i], scales[i], 'config.categoryBookmarkCount', '{count} bookmarks')}
                    </div>
                    <div class="config-crud-row-actions">
                        <button type="button" class="config-btn config-btn--small" data-cat-move="up" data-index="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(this.t('config.moveUp', 'Move up'))}">↑</button>
                        <button type="button" class="config-btn config-btn--small" data-cat-move="down" data-index="${i}" ${i === this._categories.length - 1 ? 'disabled' : ''} aria-label="${esc(this.t('config.moveDown', 'Move down'))}">↓</button>
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
                if (!this._categories || !this._categories[i]) return;
                // Categories live per page, so a name only has to be unique
                // within the page currently selected in the dropdown.
                if (!this.guardUniqueName(
                    input,
                    input.value,
                    this._categories.filter((_, idx) => idx !== i).map((c) => c.name),
                    {
                        previous: this._categories[i].name,
                        message: this.t('config.categoryNameDuplicate', 'A category with this name already exists on this page.'),
                    }
                )) return;
                this._categories[i].name = input.value;
                void this.saveCategories();
            });
        });
        const addBtn = container.querySelector('[data-cat-add]');
        if (addBtn) addBtn.addEventListener('click', () => {
            this._categories = this._categories || [];
            // Categories need a stable id; the server does not backfill one.
            const id = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            const name = DashboardConfig.uniqueNameFrom(
                this.t('config.categoryNewName', 'New category'),
                this._categories.map((c) => c.name)
            );
            this._categories.push({ id, name });
            this.repaintPtBody();
            void this.saveCategories();
        });
        container.querySelectorAll('[data-cat-delete]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const i = Number(btn.getAttribute('data-cat-delete'));
                if (!this._categories || !this._categories[i]) return;
                const cat = this._categories[i];
                // Removing a category does not touch its bookmarks: they keep
                // pointing at an id nothing defines any more and collect in
                // "unknown categories" on the dashboard. Say so, with the count,
                // because that consequence is invisible from this list.
                const orphans = this.categoryBookmarkCounts(this._catPageId);
                const n = DashboardConfig.categoryCountFor(orphans, cat);
                const message = n > 0
                    ? this.t('config.categoryDeleteWithBookmarks',
                        'Delete “{name}”? Its {n} bookmarks are kept but lose their category.')
                        .replace('{name}', String(cat.name || cat.id || ''))
                        .replace('{n}', String(n))
                    : this.t('config.categoryDeleteConfirm', 'Delete “{name}”?')
                        .replace('{name}', String(cat.name || cat.id || ''));
                if (!await this.confirmAction(message)) return;
                this._categories.splice(i, 1);
                this.repaintPtBody();
                void this.saveCategories();
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
            this.invalidateBookmarkCategoriesCache(this._catPageId);
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
    /**
     * The bookmarks section: summary tiles, filters, bulk bar, and the feed.
     * List scrolls with the page — no second scroll region.
     */
    ensureDuplicateUrlSet() {
        if (this._bmDuplicateUrls) return this._bmDuplicateUrls;
        const counts = new Map();
        (this.dash.allBookmarks || []).forEach((b) => {
            const url = String(b.url || '').trim().toLowerCase();
            if (url) counts.set(url, (counts.get(url) || 0) + 1);
        });
        this._bmDuplicateUrls = new Set(
            [...counts.entries()].filter(([, c]) => c > 1).map(([url]) => url)
        );
        return this._bmDuplicateUrls;
    }

    bookmarkIsDuplicate(b) {
        const url = String(b?.url || '').trim().toLowerCase();
        return url && this.ensureDuplicateUrlSet().has(url);
    }

    bookmarksFiltersActive() {
        // bmTagFilter is a list, and an empty array is truthy — ask for its
        // length or an unfiltered view would claim to be filtered.
        return !!(this.bmQuery || this.bmPageFilter || this.bmCategoryFilter
            || this.bmCleanupFilter || this.bookmarkTagFilters().length);
    }

    computeBookmarkSubsetStats(bookmarks) {
        const all = bookmarks || [];
        let tagged = 0;
        let withShortcut = 0;
        let monitored = 0;
        const categoryKeys = new Set();
        all.forEach((b) => {
            if ((b.tags || []).length) tagged += 1;
            if (b.shortcut) withShortcut += 1;
            if (b.monitor === true) monitored += 1;
            if (b.category) categoryKeys.add(`${b.pageId}::${b.category}`);
        });
        return {
            total: all.length,
            tagged,
            categories: categoryKeys.size,
            withShortcut,
            monitored,
        };
    }

    /**
     * The element the bookmark list actually scrolls inside, or null when that
     * is the viewport itself.
     *
     * This used to name `.config-view-body` outright, which reads as the right
     * answer and is not: that class carries no CSS at all, so the div grows to
     * fit its rows and never scrolls. Handing it to the load-more observer as a
     * root meant the sentinel sat permanently inside the root's bounds, the
     * intersection state never changed, and the callback never ran — 50 of 102
     * rows, scrolling forever. `repaintBookmarksList` had the same node for its
     * scroll save/restore, where a non-scrolling element reads scrollTop 0.
     *
     * So ask the layout rather than trusting a class name: walk up for the
     * first ancestor that both allows overflow and has content overflowing it.
     * Returning null for the viewport case is meaningful — IntersectionObserver
     * reads `root: null` as the viewport, which is exactly what is wanted.
     */
    bookmarkListScrollHost() {
        let el = document.getElementById('config-bm-list')?.parentElement;
        while (el && el !== document.body && el !== document.documentElement) {
            const overflowY = getComputedStyle(el).overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
                && el.scrollHeight > el.clientHeight + 1) {
                return el;
            }
            el = el.parentElement;
        }
        return null;
    }

    resetBookmarkVisibleLimit() {
        this.bmVisibleLimit = DashboardConfig.BM_PAGE_SIZE;
    }

    scheduleBookmarkSearchRepaint() {
        clearTimeout(this._bmSearchTimer);
        this._bmSearchTimer = setTimeout(() => {
            this._bmSearchTimer = null;
            this.resetBookmarkVisibleLimit();
            this.repaintBookmarksList();
        }, 180);
    }

    bookmarkUsageTooltip(b) {
        const translate = this.lastOpenedTranslator();
        const fmt = (ts) => window.formatLastOpened?.(ts, { t: translate })
            || { label: '—', never: true };
        const opens = Number(b.openCount || 0);
        const openLabel = this.t('config.bookmarkStatOpenCount', '{count}×').replace('{count}', String(opens));
        const last = fmt(b.lastOpened);
        const added = fmt(b.createdAt);
        const parts = [openLabel];
        if (!last.never) parts.push(`${this.t('config.bookmarkStatLastOpened', 'Last opened')}: ${last.label}`);
        if (!added.never) parts.push(`${this.t('config.bookmarkStatAdded', 'Added')}: ${added.label}`);
        return parts.join(' · ');
    }

    renderBookmarkFilterChips() {
        const esc = (v) => this.dash.escapeHtml(v);
        const chips = [];
        const add = (key, label) => {
            chips.push(`<button type="button" class="config-bm-filter-chip" data-bm-filter-clear="${esc(key)}">${esc(label)}<span aria-hidden="true">×</span></button>`);
        };
        if (this.bmPageFilter) {
            const pageName = this.pageLabel(this.bmPageFilter);
            add('page', this.t('config.bookmarksFilterPage', 'Page: {name}').replace('{name}', pageName));
        }
        if (this.bmCategoryFilter) {
            const parsed = DashboardConfig.parseCategoryFilter(this.bmCategoryFilter);
            const label = parsed.categoryId
                ? (this.knownCategories().find((c) => c.id === this.bmCategoryFilter)?.label || parsed.categoryId)
                : this.bmCategoryFilter;
            add('category', this.t('config.bookmarksFilterCategory', 'Category: {name}').replace('{name}', label));
        }
        // One chip per tag rather than one lumped "Tag: a, b, c": each stays
        // removable on its own, which is the point of picking several.
        for (const tag of this.bookmarkTagFilters()) {
            add(`tag:${tag}`, this.t('config.bookmarksFilterTag', 'Tag: {tag}').replace('{tag}', tag));
        }
        if (String(this.bmQuery || '').trim()) {
            const q = String(this.bmQuery).trim();
            add('search', this.t('config.bookmarksFilterSearch', 'Search: {q}').replace('{q}', q));
        }
        if (this.bmCleanupFilter) {
            add('cleanup', this.cleanupFilterLabel(this.bmCleanupFilter));
        }
        if (chips.length > 1) {
            chips.push(`<button type="button" class="config-bm-filter-chip config-bm-filter-chip--clear" data-bm-filter-clear="all">${esc(this.t('config.bookmarksClearAllFilters', 'Clear all'))}</button>`);
        }
        return chips.join('');
    }

    renderBookmarkCountLabel(shown, total) {
        if (this.bookmarksFiltersActive() && shown !== total) {
            return this.t('config.bookmarksCountFiltered', '{shown} of {total}')
                .replace('{shown}', String(shown))
                .replace('{total}', String(total));
        }
        return this.t('config.bookmarksCountAll', '{n} bookmarks').replace('{n}', String(total));
    }

    updateBookmarkListChrome() {
        this.updateBookmarkTagCloud();
        const filtered = this.visibleBookmarks();
        const total = (this.dash.allBookmarks || []).length;
        const shown = filtered.length;
        const countEl = document.getElementById('config-bm-count');
        if (countEl) countEl.textContent = this.renderBookmarkCountLabel(shown, total);
        const live = document.getElementById('config-bm-count-live');
        if (live) live.textContent = this.renderBookmarkCountLabel(shown, total);
        const chips = document.getElementById('config-bm-filter-chips');
        if (chips) {
            chips.innerHTML = this.renderBookmarkFilterChips();
            this.bindBookmarkFilterChips(chips);
        }
        const selectAll = document.getElementById('config-bm-select-all');
        if (selectAll) selectAll.textContent = this.selectAllBookmarksLabel();
        const hint = document.getElementById('config-bm-tiles-hint');
        if (hint) {
            const active = this.bookmarksFiltersActive();
            hint.hidden = !active;
            hint.textContent = active
                ? this.t('config.bookmarksTilesFilteredHint', 'Filtered view — counts below match your filters')
                : '';
        }
        const tilesHost = document.getElementById('config-bm-tiles');
        if (tilesHost) {
            const stats = this.bookmarksFiltersActive()
                ? this.computeBookmarkSubsetStats(filtered)
                : this.computeStats();
            tilesHost.innerHTML = this.bookmarksSummaryTiles(stats).map((t) => this.renderTile(t)).join('');
        }
    }

    bindBookmarkFilterChips(root) {
        root.querySelectorAll('[data-bm-filter-clear]').forEach((btn) => {
            btn.addEventListener('click', () => this.clearBookmarkFilterChip(btn.getAttribute('data-bm-filter-clear')));
        });
    }

    clearBookmarkFilterChip(key) {
        if (key === 'all' || key === 'page') this.bmPageFilter = '';
        if (key === 'all' || key === 'category') this.bmCategoryFilter = '';
        if (key === 'all' || key === 'tag') this.bmTagFilter = [];
        if (key.startsWith('tag:')) {
            const tag = key.slice(4);
            this.bmTagFilter = this.bookmarkTagFilters().filter((t) => t !== tag);
        }
        if (key === 'all' || key === 'search') {
            this.bmQuery = '';
            const search = document.getElementById('config-bm-search');
            if (search) search.value = '';
        }
        if (key === 'all' || key === 'cleanup') this.bmCleanupFilter = '';
        if (key === 'all') {
            this.clearBookmarkFilters();
            return;
        }
        const pageEl = document.getElementById('config-bm-page');
        if (pageEl && key === 'page') pageEl.value = this.bmPageFilter;
        const catEl = document.getElementById('config-bm-category');
        if (catEl && key === 'category') catEl.value = this.bmCategoryFilter;
        this.resetBookmarkVisibleLimit();
        this._bmDuplicateUrls = null;
        void this.ensureBookmarkCategoriesForFilter().then(() => {
            this.repaintBookmarksFilters();
            this.repaintBookmarksList();
            this.restoreConfigHash();
            this.updateConfigShellHead();
        });
    }

    async filterBookmarksByPage(pageId) {
        this.bmPageFilter = String(pageId);
        this.resetBookmarkVisibleLimit();
        await this.onBookmarksPageFilterChange();
        this.updateBookmarkListChrome();
    }

    filterBookmarksByCategory(b) {
        if (!b?.category) return;
        const catKey = this.bmPageFilter
            ? String(b.category)
            : DashboardConfig.categoryFilterKey(b.pageId, b.category);
        this.bmCategoryFilter = catKey;
        this.resetBookmarkVisibleLimit();
        this.repaintBookmarksFilters();
        this.repaintBookmarksList();
        this.updateBookmarkListChrome();
    }

    /**
     * Active tag filters, always as a normalised list.
     *
     * bmTagFilter was a single string before the tag cloud landed; accepting
     * both shapes keeps older stored state and the row chips working.
     */
    bookmarkTagFilters() {
        const raw = this.bmTagFilter;
        const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        const seen = new Set();
        const out = [];
        for (const entry of list) {
            const tag = String(entry || '').trim().toLowerCase();
            if (!tag || seen.has(tag)) continue;
            seen.add(tag);
            out.push(tag);
        }
        return out.sort((a, b) => a.localeCompare(b));
    }

    /**
     * Every tag in use, with how many bookmarks carry it.
     *
     * Ranked by the same function the dashboard tag cloud uses, so both clouds
     * order and count identically instead of drifting through two copies.
     */
    bookmarkTagCounts() {
        const all = this.dash.allBookmarks || [];
        const shared = window.DashboardTagCloud?.countTagsFromBookmarks;
        if (typeof shared === 'function') return shared(all);
        const counts = new Map();
        for (const b of all) {
            for (const raw of b.tags || []) {
                const tag = String(raw || '').trim().toLowerCase();
                if (!tag) continue;
                counts.set(tag, (counts.get(tag) || 0) + 1);
            }
        }
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag, count]) => ({ tag, count }));
    }

    setBookmarkTagFilters(tags) {
        this.bmTagFilter = Array.isArray(tags) ? tags : [];
        this.resetBookmarkVisibleLimit();
        this.repaintBookmarksList();
        this.updateBookmarkListChrome();
    }

    /** Add or remove one tag, leaving the rest of the selection alone. */
    toggleBookmarkTagFilter(tag) {
        const wanted = String(tag || '').trim().toLowerCase();
        if (!wanted) return;
        const current = this.bookmarkTagFilters();
        const next = current.includes(wanted)
            ? current.filter((t) => t !== wanted)
            : current.concat(wanted);
        this.setBookmarkTagFilters(next);
    }

    filterBookmarksByTag(tag) {
        if (!tag) return;
        // Clicking a tag chip on a row means "show me this tag", replacing any
        // cloud selection rather than quietly adding to it.
        this.setBookmarkTagFilters([String(tag)]);
    }

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
            ['lastOpened', this.t('config.sortByLastOpened', 'Last opened')],
            ['opens', this.t('config.sortByOpens', 'Most opened')],
            ['pinned', this.t('config.sortByPinned', 'Pinned first')],
        ].map(([v, label]) =>
            `<option value="${esc(v)}" ${this.bmSort === v ? 'selected' : ''}>${esc(label)}</option>`
        ).join('');
        const filtered = this.visibleBookmarks();
        const totalAll = (this.dash.allBookmarks || []).length;
        const countLabel = this.renderBookmarkCountLabel(filtered.length, totalAll);

        return `
            <p class="config-view-intro">${esc(this.t('config.bookmarksIntro', 'Every bookmark across your pages. Search, edit, or remove them here.'))}</p>
            <div class="config-bm-tiles-wrap">
                <p class="config-bm-tiles-hint" id="config-bm-tiles-hint"${this.bookmarksFiltersActive() ? '' : ' hidden'}>${esc(this.t('config.bookmarksTilesFilteredHint', 'Filtered view — counts below match your filters'))}</p>
                <div class="config-tiles config-tiles--bookmarks" id="config-bm-tiles" role="list">${this.bookmarksSummaryTiles(this.bookmarksFiltersActive() ? this.computeBookmarkSubsetStats(filtered) : null).map((t) => this.renderTile(t)).join('')}</div>
            </div>
            <div class="config-panel">
                <div class="config-crud-toolbar">
                    <input type="search" class="config-text" id="config-bm-search" placeholder="${esc(this.t('config.searchBookmarks', 'Search bookmarks…'))}" value="${esc(this.bmQuery || '')}">
                    <select class="config-select" id="config-bm-page" aria-label="${esc(this.t('config.page', 'Page'))}"
                            data-config-setting-promo-anchor="bookmarksPageFilter">${pageOptions}</select>
                    <select class="config-select" id="config-bm-category" aria-label="${esc(this.t('config.category', 'Category'))}">${catOptions}</select>
                    <select class="config-select" id="config-bm-sort" aria-label="${esc(this.t('config.sortLabel', 'Sort'))}">${sortOptions}</select>
                    <button type="button" class="config-btn config-btn--small" id="config-bm-add">${esc(this.t('config.addBookmark', 'Add bookmark'))}</button>
                    <button type="button" class="config-btn config-btn--small" id="config-bm-select-all">${esc(this.selectAllBookmarksLabel())}</button>
                </div>
                ${this.renderBookmarkTagCloud()}
                <div class="config-bm-list-meta">
                    <span class="config-bm-count" id="config-bm-count">${esc(countLabel)}</span>
                    <div class="config-bm-filter-chips" id="config-bm-filter-chips">${this.renderBookmarkFilterChips()}</div>
                    <span class="config-sr-only" id="config-bm-count-live" aria-live="polite" aria-atomic="true">${esc(countLabel)}</span>
                </div>
                ${this.renderCleanupFilterBanner()}
                <div id="config-bm-bulk">${this.renderBulkToolbar()}</div>
                <div id="config-bm-list">${this.renderBookmarksList()}</div>
            </div>
        `;
    }

    /**
     * Tag cloud above the bookmark list.
     *
     * Collapsed by default: with a few dozen tags it would otherwise push the
     * list itself off the screen on every visit. Tags are ordered by how many
     * bookmarks carry them, so the ones worth filtering on come first, and each
     * is sized by that count the way the dashboard cloud is.
     */
    renderBookmarkTagCloud() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tags = this.bookmarkTagCounts();
        if (!tags.length) return '';

        const active = new Set(this.bookmarkTagFilters());
        const max = tags[0].count || 1;
        const chips = tags.map(({ tag, count }) => {
            const on = active.has(tag);
            // Four steps rather than a continuous scale: enough to show weight,
            // few enough that the rows still line up.
            const step = Math.min(3, Math.floor((count / max) * 4));
            return `<button type="button"
                    class="config-bm-cloud-tag config-bm-cloud-tag--s${step}${on ? ' is-active' : ''}"
                    role="option" aria-selected="${on}"
                    data-bm-cloud-tag="${esc(tag)}">${esc(tag)}<span class="config-bm-cloud-count">${count}</span></button>`;
        }).join('');

        const activeCount = active.size;
        const summary = activeCount
            ? this.t('config.bookmarksTagCloudActive', '{count} selected').replace('{count}', activeCount)
            : this.t('config.bookmarksTagCloudHint', 'Filter by one or more tags');
        return `
            <details class="config-bm-cloud" id="config-bm-cloud"${activeCount ? ' open' : ''}>
                <summary class="config-bm-cloud-summary">
                    <span>${esc(this.t('config.bookmarksTagCloudTitle', 'Tags'))}</span>
                    <span class="config-bm-cloud-summary-note">${esc(summary)}</span>
                </summary>
                <div class="config-bm-cloud-body">
                    <div class="config-bm-cloud-tags" role="listbox" aria-multiselectable="true"
                         aria-label="${esc(this.t('config.bookmarksTagCloudTitle', 'Tags'))}">${chips}</div>
                    <div class="config-bm-cloud-actions"${activeCount ? '' : ' hidden'}>
                        <button type="button" class="config-btn config-btn--small" data-bm-cloud-select>${esc(this.t('config.bookmarksTagCloudSelect', 'Select these bookmarks'))}</button>
                        <button type="button" class="config-btn config-btn--small" data-bm-cloud-clear>${esc(this.t('config.bookmarksTagCloudClear', 'Clear tags'))}</button>
                    </div>
                </div>
            </details>`;
    }

    /**
     * Wire the tag cloud.
     *
     * Delegated from the container: repainting the list replaces the cloud's
     * own markup, so listeners bound to individual chips would not survive the
     * first click.
     */
    bindBookmarkTagCloud(container) {
        const cloud = container.querySelector('#config-bm-cloud');
        if (!cloud || cloud._bmCloudBound) return;
        cloud._bmCloudBound = true;
        cloud.addEventListener('click', (e) => {
            const tagBtn = e.target.closest('[data-bm-cloud-tag]');
            if (tagBtn) {
                e.preventDefault();
                this.toggleBookmarkTagFilter(tagBtn.getAttribute('data-bm-cloud-tag'));
                return;
            }
            if (e.target.closest('[data-bm-cloud-clear]')) {
                e.preventDefault();
                this.setBookmarkTagFilters([]);
                return;
            }
            if (e.target.closest('[data-bm-cloud-select]')) {
                e.preventDefault();
                this.selectFilteredBookmarks();
            }
        });
    }

    /**
     * Repaint the cloud's chips in place.
     *
     * Rebuilding the whole <details> would snap it shut mid-selection and throw
     * away the scroll position, so only the parts that change are rewritten.
     */
    updateBookmarkTagCloud() {
        const cloud = document.getElementById('config-bm-cloud');
        if (!cloud) return;
        const active = new Set(this.bookmarkTagFilters());
        cloud.querySelectorAll('[data-bm-cloud-tag]').forEach((btn) => {
            const on = active.has(btn.getAttribute('data-bm-cloud-tag'));
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', String(on));
        });
        const note = cloud.querySelector('.config-bm-cloud-summary-note');
        if (note) {
            note.textContent = active.size
                ? this.t('config.bookmarksTagCloudActive', '{count} selected').replace('{count}', active.size)
                : this.t('config.bookmarksTagCloudHint', 'Filter by one or more tags');
        }
        const actions = cloud.querySelector('.config-bm-cloud-actions');
        if (actions) actions.hidden = active.size === 0;
    }

    /** Tick every row the current filters leave visible, for the bulk bar. */
    selectFilteredBookmarks() {
        const rows = this.visibleBookmarks() || [];
        for (const b of rows) this.bmSelected.add(this.bookmarkKey(b));
        this.repaintBookmarksList();
        this.updateBookmarkListChrome();
    }

    /** Human label for each named cleanup filter. */
    cleanupFilterLabel(key) {
        const map = {
            never: ['config.cleanupFilterNever', 'Never opened'],
            once: ['config.cleanupFilterOnce', 'Opened once and never again'],
            untagged: ['config.cleanupFilterUntagged', 'Without tags'],
            insecure: ['config.cleanupFilterInsecure', 'Not using HTTPS'],
            noicon: ['config.cleanupFilterNoIcon', 'Without an icon'],
            duplicate: ['config.cleanupFilterDuplicate', 'Duplicate URLs'],
        }[key];
        return map ? this.t(map[0], map[1]) : '';
    }

    /**
     * A banner naming the cleanup filter the list arrived with.
     *
     * Without it the user lands on a list that is silently hiding most of their
     * bookmarks, with nothing on screen to say why or how to get back — the
     * search box is empty and both dropdowns read "all".
     */
    renderCleanupFilterBanner() {
        const esc = (v) => this.dash.escapeHtml(v);
        const key = this.bmCleanupFilter;
        if (!key || !DashboardConfig.CLEANUP_FILTERS[key]) return '';
        const shown = this.visibleBookmarks().length;
        const label = this.cleanupFilterLabel(key);
        const count = this.t('config.cleanupFilterCount', '{n} shown').replace('{n}', String(shown));
        return `
            <div class="config-cleanup-banner" role="status">
                <span class="config-cleanup-banner-text">${esc(label)} · ${esc(count)}</span>
                <button type="button" class="config-btn config-btn--small" data-cleanup-clear="1">${esc(this.t('config.cleanupFilterClear', 'Show all bookmarks'))}</button>
            </div>`;
    }

    /** Every category name in use, across all pages, de-duplicated and sorted. */
    /**
     * Categories to offer in bookmarks dropdowns, as {id, label} pairs.
     *
     * When a page is selected — via the list filter or explicitly — only that
     * page's category list is included, so "Development" on Main is not mixed
     * up with the same label on another page. With no page filter, every
     * category in use across the install is offered.
     *
     * A bookmark stores its category by *id* ("development") while the category
     * list carries a display *name* ("Development"). Keying on the id is what
     * keeps those from being counted as two different categories.
     */
    knownCategories(pageId) {
        const scopedPage = pageId != null && pageId !== ''
            ? String(pageId)
            : (this.bmPageFilter ? String(this.bmPageFilter) : '');

        const categoriesForPage = (pid) => {
            const byId = new Map();
            const addFromList = (list) => {
                (list || []).forEach((c) => {
                    if (typeof c === 'string') {
                        if (c) byId.set(c, c);
                        return;
                    }
                    const id = c?.id || c?.name;
                    if (id) byId.set(String(id), String(c?.name || id));
                });
            };

            const bookmarks = this.dash.allBookmarks || [];
            const key = String(pid);
            const cached = this._bmCategoriesCache.get(key);
            if (cached) {
                addFromList(cached);
            } else if (String(this.dash.currentPageId) === key) {
                addFromList(this.dash.categories);
            }
            bookmarks
                .filter((b) => String(b.pageId) === key)
                .forEach((b) => {
                    const id = b.category;
                    if (id && !byId.has(String(id))) byId.set(String(id), String(id));
                });
            return [...byId.entries()]
                .map(([id, label]) => ({ id, label }))
                .sort((a, b) => a.label.localeCompare(b.label));
        };

        if (scopedPage) {
            return categoriesForPage(scopedPage);
        }

        const pages = this.dash.pages || [];
        const out = [];
        const seen = new Set();
        pages.forEach((p) => {
            const pageName = this.pageLabel(p.id);
            categoriesForPage(p.id).forEach((c) => {
                const compositeId = DashboardConfig.categoryFilterKey(p.id, c.id);
                if (seen.has(compositeId)) return;
                seen.add(compositeId);
                out.push({ id: compositeId, label: `${pageName} · ${c.label}` });
            });
        });
        return out.sort((a, b) => a.label.localeCompare(b.label));
    }

    /** Category options for bulk actions — scoped to the selected rows' page(s). */
    bulkKnownCategories(picked) {
        if (!picked?.length) return this.knownCategories();
        const pageIds = [...new Set(picked.map((b) => String(b.pageId)))];
        if (pageIds.length === 1) {
            return this.knownCategories(pageIds[0]);
        }
        const out = [];
        pageIds.forEach((pageId) => {
            const pageName = this.pageLabel(pageId);
            this.knownCategories(pageId).forEach((c) => {
                out.push({
                    id: DashboardConfig.categoryFilterKey(pageId, c.id),
                    label: `${pageName} · ${c.label}`,
                });
            });
        });
        return out.sort((a, b) => a.label.localeCompare(b.label));
    }

    bookmarksFromKeys(keys) {
        const all = this.dash.allBookmarks || [];
        const wanted = new Set(keys || []);
        return all.filter((b) => wanted.has(this.bookmarkKey(b)));
    }

    /**
     * Category id → label, as one map instead of a fresh knownCategories() scan
     * per row. Building that list walks every page and every category, so doing
     * it once per rendered row made a 50-row repaint 50 full rebuilds.
     *
     * Invalidated by the page filter (which scopes the list) and by the category
     * data itself, which arrives asynchronously per page.
     */
    categoryLabelIndex() {
        const scope = String(this.bmPageFilter || '');
        const token = `${scope}|${this._bmCategoryRevision || 0}`;
        if (this._bmCategoryLabelToken === token && this._bmCategoryLabels) return this._bmCategoryLabels;
        const index = new Map();
        this.knownCategories(scope || undefined).forEach((c) => index.set(c.id, c.label));
        this._bmCategoryLabelToken = token;
        this._bmCategoryLabels = index;
        return index;
    }

    categoryLabelForBookmark(b) {
        const id = String(b.category || '');
        if (!id) return '';
        const labels = this.categoryLabelIndex();
        if (this.bmPageFilter) return labels.get(id) || id;
        const composite = DashboardConfig.categoryFilterKey(b.pageId, id);
        return labels.get(composite) || `${this.pageLabel(b.pageId)} · ${id}`;
    }

    async prefetchAllBookmarkCategories() {
        const pages = this.dash.pages || [];
        await Promise.all(pages.map((p) => this.loadBookmarkCategoriesForPage(p.id)));
        if (this.isActiveView() && this.section === 'bookmarks') {
            this.repaintBookmarksFilters();
            this.repaintBookmarksList();
        }
    }

    async loadBookmarkCategoriesForPage(pageId) {
        const key = String(pageId || '');
        if (!key) return [];
        if (this._bmCategoriesCache.has(key)) {
            return this._bmCategoriesCache.get(key);
        }
        try {
            const res = await fetch(`/api/categories?page=${encodeURIComponent(key)}`);
            const data = res && res.ok ? await res.json() : [];
            const list = Array.isArray(data) ? data : [];
            this._bmCategoriesCache.set(key, list);
            this._bmCategoryRevision = (this._bmCategoryRevision || 0) + 1;
            return list;
        } catch {
            this._bmCategoriesCache.set(key, []);
            this._bmCategoryRevision = (this._bmCategoryRevision || 0) + 1;
            return [];
        }
    }

    invalidateBookmarkCategoriesCache(pageId) {
        this._bmCategoryRevision = (this._bmCategoryRevision || 0) + 1;
        if (pageId != null && pageId !== '') {
            this._bmCategoriesCache.delete(String(pageId));
        }
    }

    async ensureBookmarkCategoriesForFilter() {
        const pageId = String(this.bmPageFilter || '');
        if (!pageId) return;
        await this.loadBookmarkCategoriesForPage(pageId);
        if (this.bmCategoryFilter) {
            const valid = this.knownCategories(pageId).some((c) => {
                if (this.bmPageFilter) return c.id === this.bmCategoryFilter;
                return c.id === this.bmCategoryFilter
                    || c.id === DashboardConfig.categoryFilterKey(pageId, this.bmCategoryFilter);
            });
            if (!valid) this.bmCategoryFilter = '';
        }
    }

    repaintBookmarksFilters() {
        const esc = (v) => this.dash.escapeHtml(v);
        const catEl = document.getElementById('config-bm-category');
        if (!catEl) return;
        catEl.innerHTML = [`<option value="">${esc(this.t('config.allCategories', 'All categories'))}</option>`]
            .concat(this.knownCategories().map((c) => {
                const sel = this.bmCategoryFilter === c.id ? ' selected' : '';
                return `<option value="${esc(c.id)}"${sel}>${esc(c.label)}</option>`;
            })).join('');
    }

    /** The rows currently passing search, page filter, category filter and sort. */
    /**
     * Named cleanup filters, each the list behind a figure in Statistics.
     *
     * Kept as predicates in one place so the count shown there and the rows
     * shown here can never drift apart: both read this map.
     */
    static BM_PAGE_SIZE = 50;

    static CLEANUP_FILTERS = {
        never: (b) => !Number(b.openCount || 0) && !Number(b.lastOpened || 0),
        once: (b) => Number(b.openCount || 0) === 1,
        untagged: (b) => !(Array.isArray(b.tags) && b.tags.length),
        insecure: (b) => /^http:\/\//i.test(String(b.url || '')),
        noicon: (b) => !String(b.icon || '').trim(),
        duplicate: (b, dupes) => {
            const url = String(b.url || '').trim().toLowerCase();
            return url && dupes && dupes.has(url);
        },
    };

    /** Page id → position, built once so sort comparators can look up in O(1). */
    pageOrderIndex() {
        const pages = this.dash.pages || [];
        if (this._bmPageOrderSource === pages && this._bmPageOrder) return this._bmPageOrder;
        const index = new Map();
        pages.forEach((p, i) => index.set(String(p.id), i));
        this._bmPageOrderSource = pages;
        this._bmPageOrder = index;
        return index;
    }

    /** Page id → display name, same idea as pageOrderIndex. */
    pageNameIndex() {
        const pages = this.dash.pages || [];
        if (this._bmPageNameSource === pages && this._bmPageNames) return this._bmPageNames;
        const index = new Map();
        pages.forEach((p) => index.set(String(p.id), p.name || p.id));
        this._bmPageNameSource = pages;
        this._bmPageNames = index;
        return index;
    }

    /**
     * A render pass asks for this list three or four times over — the section
     * shell, the cleanup banner, the list itself and the chrome update. Filtering
     * and sorting the whole set each time is pure repeat work, so the result is
     * memoised against everything it depends on.
     */
    visibleBookmarks() {
        const all = this.dash.allBookmarks || [];
        // JSON rather than a joined string: query, tag and category all hold free
        // text, so a plain separator could be ambiguous — query "a b" with no tag
        // versus query "a" with tag "b" must not share a token.
        const token = JSON.stringify([
            this.bmQuery, this.bmPageFilter, this.bmCategoryFilter,
            this.bookmarkTagFilters(), this.bmCleanupFilter, this.bmSort,
        ]);
        if (this._bmVisibleSource === all && this._bmVisibleToken === token && this._bmVisible) {
            return this._bmVisible;
        }
        const result = this.computeVisibleBookmarks();
        this._bmVisibleSource = all;
        this._bmVisibleToken = token;
        this._bmVisible = result;
        return result;
    }

    /** Drops the memo so the next visibleBookmarks() recomputes from scratch. */
    invalidateVisibleBookmarks() {
        this._bmVisible = null;
        this._bmVisibleSource = null;
        this._bmVisibleToken = null;
        this._bmOccurrence = null;
        this._bmOccurrenceSource = null;
    }

    computeVisibleBookmarks() {
        const all = this.dash.allBookmarks || [];
        const q = String(this.bmQuery || '').trim().toLowerCase();
        const pageFilter = String(this.bmPageFilter || '');
        const catFilter = this.bmCategoryFilter || '';
        const tagFilter = this.bookmarkTagFilters();
        const cleanupKey = this.bmCleanupFilter;
        const dupes = cleanupKey === 'duplicate' ? this.ensureDuplicateUrlSet() : null;
        const cleanup = DashboardConfig.CLEANUP_FILTERS[cleanupKey] || null;
        const { pageId: catPage, categoryId } = DashboardConfig.parseCategoryFilter(catFilter);
        const rows = all.filter((b) => {
            if (cleanup) {
                const ok = cleanupKey === 'duplicate' ? cleanup(b, dupes) : cleanup(b);
                if (!ok) return false;
            }
            if (pageFilter && String(b.pageId) !== pageFilter) return false;
            if (categoryId) {
                if (catPage && String(b.pageId) !== String(catPage)) return false;
                if ((b.category || '') !== categoryId) return false;
            }
            if (tagFilter.length) {
                const tags = (Array.isArray(b.tags) ? b.tags : []).map((t) => String(t).toLowerCase());
                // OR, matching the dashboard tag cloud: picking a second tag
                // widens the result rather than narrowing it to nothing.
                if (!tagFilter.some((t) => tags.includes(t))) return false;
            }
            if (!q) return true;
            return [b.name, b.url, b.category, b.note, b.shortcut, (b.tags || []).join(' ')]
                .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
        });
        const order = this.pageOrderIndex();
        const pageIndex = (id) => (order.has(String(id)) ? order.get(String(id)) : -1);
        const cmp = {
            name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
            url: (a, b) => String(a.url || '').localeCompare(String(b.url || '')),
            category: (a, b) => String(a.category || '').localeCompare(String(b.category || '')),
            recent: (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0),
            page: (a, b) => pageIndex(a.pageId) - pageIndex(b.pageId),
            lastOpened: (a, b) => Number(b.lastOpened || 0) - Number(a.lastOpened || 0),
            opens: (a, b) => Number(b.openCount || 0) - Number(a.openCount || 0),
            pinned: (a, b) => {
                const dp = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
                if (dp !== 0) return dp;
                return pageIndex(a.pageId) - pageIndex(b.pageId);
            },
        }[this.bmSort] || null;
        return cmp ? [...rows].sort(cmp) : rows;
    }

    /**
     * Base identity: page plus URL. Not unique on its own — the same URL may sit
     * twice on one page, which is exactly what the "Duplicate URLs" cleanup
     * filter exists to surface. Use bookmarkKey() for anything that selects or
     * mutates rows; this is only the prefix it builds on.
     */
    static bookmarkKeyBase(b) {
        return `${b.pageId}::${b.url}`;
    }

    /**
     * Stable per-row identity.
     *
     * Bookmarks carry no id in storage, so identity has to be derived. Page and
     * URL alone collide on duplicates, and a bulk delete keyed on that pair
     * takes every copy with it — you tick one row, the confirm says "1", and two
     * bookmarks disappear. Appending which occurrence this is, counted in the
     * order the page stores them, separates the copies.
     *
     * The suffix is only added from the second occurrence on, so keys for the
     * overwhelmingly common unique case are unchanged.
     */
    bookmarkKey(b) {
        const base = DashboardConfig.bookmarkKeyBase(b);
        const occurrence = this.bookmarkOccurrenceIndex().get(b);
        return occurrence ? `${base}::${occurrence}` : base;
    }

    /**
     * Maps each bookmark object to its occurrence number within its own page (0
     * for the first with that URL, 1 for the next, …). Keyed by object identity,
     * so it holds regardless of how the list is later filtered or sorted.
     *
     * Rebuilt whenever allBookmarks is replaced — the array identity is the
     * cache token, so a reload after a write invalidates it on its own.
     */
    bookmarkOccurrenceIndex() {
        const all = this.dash.allBookmarks || [];
        if (this._bmOccurrenceSource === all && this._bmOccurrence) return this._bmOccurrence;
        const seen = new Map();
        const index = new Map();
        all.forEach((b) => {
            const base = DashboardConfig.bookmarkKeyBase(b);
            const n = seen.get(base) || 0;
            index.set(b, n);
            seen.set(base, n + 1);
        });
        this._bmOccurrenceSource = all;
        this._bmOccurrence = index;
        return index;
    }

    /**
     * Warns when part of the selection sits outside the current filters.
     *
     * Ticks survive a filter change, so selecting rows on one page and then
     * switching to another leaves a bar reading "7 selected" above a list where
     * nothing is ticked — and Delete would still take all seven. Naming the
     * hidden count, with a way to drop them, keeps the destructive buttons
     * honest about their reach.
     */
    renderBulkOffscreenNotice(picked) {
        const esc = (v) => this.dash.escapeHtml(v);
        const visibleKeys = new Set(this.visibleBookmarks().map((b) => this.bookmarkKey(b)));
        const hidden = picked.filter((b) => !visibleKeys.has(this.bookmarkKey(b))).length;
        if (!hidden) return '';
        const label = this.t('config.bulkSelectedOffscreen', '{n} not shown by the current filters')
            .replace('{n}', String(hidden));
        return `
            <span class="config-bulk-offscreen">
                <span class="config-bulk-offscreen-text">${esc(label)}</span>
                <button type="button" class="config-btn config-btn--small" data-bulk="keep-visible">${esc(this.t('config.bulkKeepVisible', 'Select only these'))}</button>
            </span>`;
    }

    /** The bulk-action bar, shown only once rows are ticked. */
    renderBulkToolbar() {
        const esc = (v) => this.dash.escapeHtml(v);
        const n = this.bmSelected.size;
        if (n === 0) return '';
        const pages = this.dash.pages || [];
        const picked = this.bookmarksFromKeys([...this.bmSelected]);
        const pageOpts = [`<option value="">${esc(this.t('config.bulkMovePagePlaceholder', 'Move to page…'))}</option>`]
            .concat(pages.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`)).join('');
        const catOpts = [`<option value="">${esc(this.t('config.bulkMoveCategoryPlaceholder', 'Set category…'))}</option>`]
            .concat(this.bulkKnownCategories(picked).map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`)).join('');
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
                ${this.renderBulkOffscreenNotice(picked)}
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
                    <button type="button" class="config-btn config-btn--small" data-bulk="favicons">${esc(this.t('config.bulkRefreshFavicons', 'Refresh favicons'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="export">${esc(this.t('config.bulkExportCsv', 'Export CSV'))}</button>
                    <button type="button" class="config-btn config-btn--small config-btn--danger" data-bulk="delete">${esc(this.t('config.bulkDelete', 'Delete'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="clear">${esc(this.t('config.bulkClearSelection', 'Clear selection'))}</button>
                </div>
            </div>`;
    }

    /** One bookmark row in the config feed. */
    renderBookmarkRow(b, ctx) {
        const esc = ctx.esc;
        const key = this.bookmarkKey(b);
        const ticked = this.bmSelected.has(key);
        const title = b.name || this.formatBookmarkUrlDisplay(b.url) || b.url;
        const domain = this.formatBookmarkUrlDisplay(b.url);
        const metaBits = [];
        if (b.pinned) {
            metaBits.push(`<span class="config-bm-pin-icon" aria-label="${esc(this.t('config.bookmarkPinnedAria', 'Pinned'))}" title="${esc(this.t('config.pinnedShort', 'Pinned'))}">📌</span>`);
        }
        if (b.shortcut) metaBits.push(`<span class="config-bm-shortcut-pill">${esc(b.shortcut)}</span>`);
        if (ctx.isDuplicate) {
            metaBits.push(`<span class="config-bm-duplicate-badge">${esc(this.t('config.bookmarkDuplicateBadge', 'Duplicate'))}</span>`);
        }
        const tags = b.tags || [];
        const tagChips = tags.map((tag) =>
            `<button type="button" class="config-bm-tag-chip" data-bm-filter-tag="${esc(tag)}">${esc(tag)}</button>`
        ).join('');
        // One or two tags read fine beside the domain. Beyond that they crowd it
        // out, so they move to a line of their own — the identifying line stays
        // scannable and the tags keep their own left edge down the feed.
        const TAGS_INLINE_MAX = 2;
        const tagsOnOwnLine = tags.length > TAGS_INLINE_MAX;
        const inlineTagChips = tagsOnOwnLine ? '' : tagChips;
        const tagRow = tagsOnOwnLine
            ? `<p class="config-bm-tag-row">${tagChips}</p>`
            : '';
        const mode = window.CheckMode?.of?.(b) || 'off';
        const feed = window.BookmarkFeedRow;
        const noteHtml = b.note
            ? `<p class="inbox-item-note">${esc(b.note)}</p>`
            : '';
        const iconSrc = this.resolveIconSrc(b.icon);
        const categoryLine = b.category
            ? `<p class="config-bm-meta-category"><button type="button" class="config-bm-meta-category-link" data-bm-row-key="${esc(key)}">${esc(this.categoryLabelForBookmark(b))}</button></p>`
            : '';
        // The category line above already reads "page · category" whenever no
        // page filter is on, so repeating the page name in the footer says the
        // same thing twice. Keep the badge only where that line cannot: on
        // bookmarks with no category at all.
        const pageShownInCategoryLine = !!b.category && !this.bmPageFilter;
        const pageFooter = ctx.showPageBadge && !pageShownInCategoryLine
            ? `<button type="button" class="config-bm-page-badge config-bm-page-name config-bm-page-name--link" data-bm-filter-page="${esc(String(b.pageId))}">${esc(ctx.pageName(b.pageId))}</button>`
            : '<span class="config-bm-page-name config-bm-page-name--empty" aria-hidden="true"></span>';
        const usageTip = esc(this.bookmarkUsageTooltip(b));
        const usageFooter = `
            <div class="config-bm-meta-footer">
                ${pageFooter}
                <div class="config-bm-usage-col" title="${usageTip}">${this.renderBookmarkUsageLine(b)}</div>
            </div>`;
        return `
            <article class="health-view-item config-bm-row config-bm-item${ticked ? ' is-checked' : ''}" data-bm-key="${esc(key)}" tabindex="-1"
                     role="listitem"${ctx.setSize ? ` aria-posinset="${ctx.posInSet}" aria-setsize="${ctx.setSize}"` : ''}>
                <label class="config-bm-check">
                    <input type="checkbox" class="config-bm-tick" data-bm-tick="${esc(key)}" ${ticked ? 'checked' : ''}
                           aria-label="${esc(this.t('config.selectBookmark', 'Select bookmark'))}">
                </label>
                ${feed?.renderIcon?.(iconSrc, esc) || this.renderBookmarkIcon(b)}
                <div class="health-view-item-body">
                    <div class="health-view-item-head">
                        <h3 class="health-view-item-title config-bm-title">${esc(title)}</h3>
                    </div>
                    <p class="health-view-item-meta config-bm-meta-primary">
                        <span>${esc(domain)}</span>
                        ${metaBits.join('')}
                        ${inlineTagChips}
                        <span class="health-check-mode-wrap">
                            ${feed?.renderCheckModeBadge?.(key, mode, esc, (k, fb) => this.t(k, fb)) || ''}
                            ${feed?.renderCheckModeMenu?.(key, mode, esc, (k, fb) => this.t(k, fb)) || ''}
                        </span>
                    </p>
                    ${tagRow}
                    ${categoryLine}
                    ${noteHtml}
                    ${feed?.renderActionsBar?.({
                        key,
                        escapeHtml: esc,
                        t: (k, fb) => this.t(k, fb),
                        showRecheck: false,
                        moreMenuHtml: this.renderBookmarkRowMenu(b, key),
                    }) || this.renderBookmarkRowActions(b, key, false)}
                    ${usageFooter}
                </div>
            </article>`;
    }

    /** The rows themselves, re-rendered on every search/filter/edit change. */
    renderBookmarksList() {
        const esc = (v) => this.dash.escapeHtml(v);
        this._bmDuplicateUrls = null;
        const dupes = this.ensureDuplicateUrlSet();
        if (!(this.dash.allBookmarks || []).length) {
            return `
                <div class="config-panel-empty config-panel-empty--action">
                    <p>${esc(this.t('config.noBookmarksYet', 'No bookmarks yet.'))}</p>
                    <button type="button" class="config-btn config-btn--primary" data-bm-empty-add>${esc(this.t('config.addBookmarkBtn', 'Add bookmark'))}</button>
                </div>`;
        }
        const allRows = this.visibleBookmarks();
        if (!allRows.length) {
            const hasFilters = this.bookmarksFiltersActive();
            return `
                <div class="config-panel-empty config-panel-empty--action">
                    <p>${esc(this.t('config.noBookmarksMatch', 'No bookmarks match your search.'))}</p>
                    ${hasFilters ? `<button type="button" class="config-btn" data-bm-empty-clear>${esc(this.t('config.clearBookmarkFilters', 'Clear filters'))}</button>` : ''}
                    <button type="button" class="config-btn config-btn--primary" data-bm-empty-add>${esc(this.t('config.addBookmarkBtn', 'Add bookmark'))}</button>
                </div>`;
        }
        const names = this.pageNameIndex();
        const pageName = (id) => names.get(String(id)) || id;
        const showPageBadge = !this.bmPageFilter;
        const limit = Math.max(DashboardConfig.BM_PAGE_SIZE, Number(this.bmVisibleLimit) || DashboardConfig.BM_PAGE_SIZE);
        const rows = allRows.slice(0, limit);
        const ctx = { esc, pageName, showPageBadge, isDuplicate: (b) => {
            const url = String(b.url || '').trim().toLowerCase();
            return url && dupes.has(url);
        } };
        // Position is passed down so each row can carry aria-posinset: with
        // paging the DOM holds only part of the list, and without setsize a
        // screen reader would announce "3 of 50" on a library of 500.
        const items = rows.map((b, i) => this.renderBookmarkRow(b, {
            ...ctx,
            isDuplicate: ctx.isDuplicate(b),
            posInSet: i + 1,
            setSize: allRows.length,
        })).join('');
        const more = allRows.length > rows.length
            ? `<div class="config-bm-load-sentinel" data-bm-load-more hidden aria-hidden="true"></div>
               <p class="config-bm-load-hint">${esc(this.t('config.bookmarksLoadMoreHint', '{shown} of {total} shown — scroll for more')
                   .replace('{shown}', String(rows.length)).replace('{total}', String(allRows.length)))}</p>`
            : '';
        return `<div class="health-view-feed config-bm-feed" role="list">${items}${more}</div>`;
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
        const cats = this.knownCategories(b.pageId);
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
            <div class="config-bm-editor" data-bm-editor-key="${esc(this.bookmarkKey(b))}">
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

                    ${this.renderBookmarkStats(b)}
                </div>

                ${saveBar('bottom')}
            </div>`;
    }

    /**
     * A translator formatLastOpened can use. Its labels carry a {count}, and the
     * config t() takes only (key, fallback) — handed to it directly, the count
     * placeholder survives into the UI verbatim. Dashboard keys also arrive
     * prefixed here, which formatDashboardLabel does not expect.
     */
    lastOpenedTranslator() {
        return (key, fallback, params) => {
            const bare = String(key).startsWith('dashboard.') ? String(key).slice('dashboard.'.length) : key;
            if (params && typeof this.dash.formatDashboardLabel === 'function') {
                const text = this.dash.formatDashboardLabel(bare, params, fallback);
                if (text && text !== bare && text !== key) return text;
            }
            const raw = this.t(key, fallback);
            if (!params) return raw;
            return Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(raw || '')
            );
        };
    }

    /**
     * The one-line usage summary on a collapsed row: how often, how recently.
     *
     * Kept out of the meta line above it because that one describes where the
     * bookmark lives (page, category, tags) and this describes whether it is
     * used at all — the thing you scan the list for when clearing out dead
     * links. Never-opened is stated outright rather than left blank, matching
     * Health, where an empty slot would read as missing data instead.
     */
    renderBookmarkUsageLine(b) {
        const esc = (v) => this.dash.escapeHtml(v);
        const opens = Number(b.openCount || 0);
        const { label, title, never } = window.formatLastOpened?.(b.lastOpened, { t: this.lastOpenedTranslator() })
            || { label: '', title: '', never: true };
        const openedCls = never ? 'health-view-item-opened is-never' : 'health-view-item-opened';
        const openedHtml = `<span class="${openedCls}" title="${esc(title)}">${esc(never ? this.t('dashboard.healthNeverOpened', 'never opened') : label)}</span>`;
        if (opens === 0) {
            return openedHtml;
        }
        const count = this.t('config.bookmarkStatOpenCount', '{count}×').replace('{count}', String(opens));
        return `${openedHtml}<span class="config-bm-usage" title="${esc(title)}">${esc(count)}</span>`;
    }

    /**
     * Read-only usage figures for one bookmark, shown at the foot of its editor.
     *
     * Every value here is already stored on the bookmark — this reads, it never
     * writes. That matters for the editor around it: saving spreads the form
     * fields over the existing record, so openCount and friends survive an edit
     * precisely because nothing in the form binds to them. None of these cells
     * carry a data-bm-field for the same reason.
     *
     * Timestamps go through the shared formatLastOpened rather than a local
     * format, so "yesterday" means the same thing here as it does in Health.
     */
    renderBookmarkStats(b) {
        const esc = (v) => this.dash.escapeHtml(v);
        const translate = this.lastOpenedTranslator();
        const when = (ts) => window.formatLastOpened?.(ts, { t: translate })
            || { label: '—', title: '', never: true };

        const rows = [];
        const created = when(b.createdAt);
        rows.push([
            this.t('config.bookmarkStatAdded', 'Added'),
            created.never ? '—' : created.label,
            created.never ? this.t('config.bookmarkStatUnknown', 'Not recorded') : created.title,
        ]);

        // Bookmarks stored before updatedAt existed have none, and no edit has
        // happened since to give them one. A dash is honest; inventing the
        // created date or "now" would not be.
        const modified = when(b.updatedAt);
        rows.push([
            this.t('config.bookmarkStatModified', 'Modified'),
            modified.never ? '—' : modified.label,
            modified.never ? this.t('config.bookmarkStatUnknown', 'Not recorded') : modified.title,
        ]);

        const opens = Number(b.openCount || 0);
        rows.push([
            this.t('config.bookmarkStatOpens', 'Opened'),
            this.t('config.bookmarkStatOpenCount', '{count}×').replace('{count}', String(opens)),
            '',
        ]);

        const lastOpened = when(b.lastOpened);
        rows.push([
            this.t('config.bookmarkStatLastOpened', 'Last opened'),
            lastOpened.label,
            lastOpened.never ? '' : lastOpened.title,
        ]);

        // Only bookmarks with availability checking on ever get a lastChecked,
        // so the row would be a permanent dash for everything else.
        if (b.lastChecked) {
            const checked = when(b.lastChecked);
            const outcome = b.lastError
                ? String(b.lastError)
                : this.t('config.bookmarkStatCheckOk', 'no errors');
            rows.push([
                this.t('config.bookmarkStatLastChecked', 'Last checked'),
                `${checked.label} · ${outcome}`,
                checked.title,
            ]);
        }

        const cells = rows.map(([label, value, title]) => `
            <div class="config-bm-stat">
                <span class="config-bm-stat-label">${esc(label)}</span>
                <span class="config-bm-stat-value"${title ? ` title="${esc(title)}"` : ''}>${esc(value)}</span>
            </div>`).join('');

        // Scale the bar against the busiest bookmark, so the bar answers "is this
        // one of my heavily used links?" rather than restating the raw count.
        const busiest = (this.dash.allBookmarks || [])
            .reduce((max, bm) => Math.max(max, Number(bm.openCount || 0)), 0);
        const meter = opens > 0 && busiest > 0
            ? this.renderStatMeta(opens, opens / busiest, 'config.bookmarkStatOpenCount', '{count}×')
            : '';

        return `
            <div class="config-bm-cell config-bm-cell--wide config-bm-stats" data-bm-stats>
                <span class="config-bm-label">${esc(this.t('config.bookmarkStatsLabel', 'Statistics'))}</span>
                <div class="config-bm-stat-grid">${cells}</div>
                ${meter}
            </div>`;
    }

    /** Bookmark icons are stored as bare filenames; the dashboard serves them from /data/icons/. */
    resolveIconSrc(icon) {
        const raw = String(icon || '');
        if (!raw) return '';
        if (/^(https?:|data:|\/)/i.test(raw)) return raw;
        return `/data/icons/${raw}`;
    }

    formatBookmarkUrlDisplay(url) {
        const raw = String(url || '').trim();
        if (!raw) return '';
        try {
            const parsed = new URL(raw);
            const host = parsed.hostname.replace(/^www\./i, '');
            const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
            return `${host}${path}`;
        } catch {
            return raw;
        }
    }

    renderBookmarkIcon(b) {
        const esc = (v) => this.dash.escapeHtml(v);
        const iconSrc = this.resolveIconSrc(b.icon);
        if (iconSrc) {
            return `<div class="config-bm-icon" aria-hidden="true"><img class="config-bm-icon-img" src="${esc(iconSrc)}" alt="" loading="lazy"></div>`;
        }
        return `<div class="config-bm-icon config-bm-icon--placeholder" aria-hidden="true">🔗</div>`;
    }

    renderBookmarkRowMenu(b, key) {
        const esc = (v) => this.dash.escapeHtml(v);
        const items = [];
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-bm-menu-action="dashboard">${esc(this.t('dashboard.healthOpenInDashboard', 'Show on dashboard'))}</button>`);
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-bm-menu-action="health">${esc(this.t('dashboard.healthOpenInHealth', 'Show in Health'))}</button>`);
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-bm-menu-action="title">${esc(this.t('dashboard.healthRefreshTitle', 'Refresh title'))}</button>`);
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-bm-menu-action="favicon">${esc(this.t('dashboard.healthRefreshFavicon', 'Refresh favicon'))}</button>`);
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-bm-menu-action="archive">${esc(this.t('dashboard.healthArchive', 'Find in Web Archive'))}</button>`);
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-bm-menu-action="copy-url">${esc(this.t('dashboard.contextMenuCopyUrl', 'Copy URL'))}</button>`);
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-bm-menu-action="share">${esc(this.shareBookmarkActionLabel())}</button>`);
        items.push(`<p class="health-view-menu-label health-view-menu-label--danger" role="presentation">${esc(this.t('dashboard.healthMenuRemove', 'Remove'))}</p>`);
        items.push(`<button type="button" class="health-view-menu-item health-view-menu-item--danger" role="menuitem" data-bm-menu-action="delete">${esc(this.t('dashboard.healthDelete', 'Delete bookmark'))}</button>`);
        return window.BookmarkFeedRow?.renderMoreMenu?.(key, items.join(''), esc, (k, fb) => this.t(k, fb)) || '';
    }

    shareBookmarkActionLabel() {
        const menu = this.dash.contextMenu;
        if (menu?.shareActionLabel) {
            return menu.shareActionLabel();
        }
        return typeof navigator.share === 'function'
            ? this.t('dashboard.contextMenuShare', 'Share…')
            : this.t('dashboard.contextMenuCopyNameUrl', 'Copy name + URL');
    }

    bookmarkListRoot() {
        return document.getElementById('config-bm-list');
    }

    closeBookmarkMenus() {
        window.BookmarkFeedRow?.closeAllMenus?.(this.bookmarkListRoot() || document);
    }

    toggleBookmarkMenu(key, kind = 'more') {
        return window.BookmarkFeedRow?.toggleMenu?.(key, kind, this.bookmarkListRoot() || document) === true;
    }

    syncBookmarkRowBusy(key, busy) {
        window.BookmarkFeedRow?.syncRowBusy?.(key, busy, this.bookmarkListRoot() || document);
    }

    async findBookmarkRecord(key) {
        const bookmark = this.findBookmarkByKey(key);
        if (!bookmark) return null;
        const pageId = Number(bookmark.pageId);
        if (!Number.isFinite(pageId)) return null;
        try {
            const res = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!res.ok) return null;
            const list = await res.json();
            if (!Array.isArray(list)) return null;
            // findIndex on the URL alone always lands on the first copy, so
            // acting on the second of two identical URLs would edit the wrong
            // row. Count occurrences and take the one the key names.
            const isTarget = DashboardConfig.matchesParsedKey(this.parseBookmarkKey(key) || { url: bookmark.url });
            const index = list.findIndex((entry) => isTarget(entry));
            if (index < 0 || !list[index]) return null;
            return { pageId, index, record: list[index], bookmark };
        } catch {
            return null;
        }
    }

    async openBookmarkEditModal(key) {
        this.closeBookmarkMenus();
        this._bmModalRestoreKey = key;
        const record = await this.findBookmarkRecord(key);
        const handler = this.dash.searchComponent?.commandsComponent?.newCommandHandler;
        if (!handler?.openModal || !record) {
            this.notify(this.t('config.addBookmarkUnavailable', 'The add-bookmark dialog is not available.'), 'error');
            return;
        }
        handler.setContext?.(record.pageId, this.dash.categories || [], this.dash.pages || []);
        handler.openModal({
            mode: 'edit',
            pageId: record.pageId,
            index: record.index,
            bookmark: record.record,
            onSaved: async () => {
                await this.refreshBookmarksAfterWrite();
            },
        });
        this.watchAddBookmarkModal();
    }

    async recheckBookmarkByKey(key) {
        if (this._bmBusyKeys.has(key)) return;
        const bookmark = this.findBookmarkByKey(key);
        const url = String(bookmark?.url || '').trim();
        if (!url) return;
        const record = await this.findBookmarkRecord(key);
        this._bmBusyKeys.add(key);
        this.syncBookmarkRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const persist = async (status, errorDetail, pingMs, httpStatus) => {
            const cacheURL = url.replace(/\/+$/, '').toLowerCase();
            if (cacheURL) {
                await fetcher('/api/health/cache-scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: cacheURL,
                        status,
                        pingMs: pingMs || 0,
                        error: errorDetail,
                        code: Number(httpStatus) || 0,
                    }),
                }).catch(() => {});
            }
            if (record) {
                await fetcher('/api/health/update-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pageId: record.pageId,
                        index: record.index,
                        status,
                        error: status === 'online' ? '' : errorDetail,
                    }),
                });
            }
        };
        try {
            const res = await fetcher(`/api/ping?url=${encodeURIComponent(url)}`);
            if (!res.ok) throw new Error(`ping HTTP ${res.status}`);
            const result = await res.json();
            const status = result.status === 'online' ? 'online' : 'offline';
            const errorDetail = String(result.errorDetail || '').trim()
                || (status === 'online' ? '' : this.t('dashboard.healthPingFailed', 'ping failed'));
            await persist(status, errorDetail, result.ping, result.httpStatus);
            this.dash.updateHealthBadge?.();
            this.notify(
                status === 'online'
                    ? this.t('dashboard.healthRecheckOnline', 'Reachable')
                    : this.t('dashboard.healthRecheckOffline', 'Unreachable: {error}', { error: errorDetail || 'offline' }),
                status === 'online' ? 'success' : 'error',
                { duration: 3500 }
            );
        } catch {
            this.notify(this.t('dashboard.healthRecheckFailed', 'Could not re-check this bookmark'), 'error');
        } finally {
            this._bmBusyKeys.delete(key);
            this.syncBookmarkRowBusy(key, false);
        }
    }

    openBookmarkOnDashboard(b) {
        this.closeBookmarkMenus();
        const pageId = Number(b?.pageId);
        if (!Number.isFinite(pageId)) return;
        if (typeof DashboardDeepLink?.buildDashboardDeepLink === 'function') {
            window.location.href = DashboardDeepLink.buildDashboardDeepLink({
                pageId,
                categoryId: b.category || null,
                url: b.url || null,
            });
            return;
        }
        void this.dash.pageNav?.requestPageNavigation?.(pageId);
    }

    /**
     * The mirror of openBookmarkOnDashboard: open the Health view with this
     * bookmark's row selected.
     *
     * The index comes from findBookmarkRecord rather than from the in-memory
     * list, because the health key is `pageId:index` against the page's stored
     * order — and that helper already resolves the right one of two identical
     * URLs. An index taken from the filtered config list would point at a
     * different bookmark whenever a filter or sort is active.
     */
    async revealBookmarkInHealth(key) {
        this.closeBookmarkMenus();
        const record = await this.findBookmarkRecord(key);
        if (!record) {
            this.notify(this.t('config.bookmarkNotFound', 'Could not find this bookmark.'), 'error');
            return;
        }
        this._trackAction('reveal-in-health');
        await this.openViewFromTile('health', null, `${record.pageId}:${record.index}`);
    }

    copyBookmarkUrl(b) {
        this.closeBookmarkMenus();
        const url = String(b?.url || '').trim();
        if (!url) return;
        this.dash.searchComponent?.commandsComponent?._copyUrlToClipboard?.(url);
    }

    async shareBookmark(b) {
        const url = String(b?.url || '').trim();
        if (!url) return;
        const menu = this.dash.contextMenu;
        if (!menu?.shareBookmark) return;
        const couldShare = menu.canOpenShareSheet?.();
        const shared = menu.shareBookmark({ name: b?.name || '', url }, null);
        this.closeBookmarkMenus();
        await shared;
        if (couldShare && menu.canOpenShareSheet?.() === false) {
            this.repaintBookmarksList();
        }
    }

    openBookmarkArchive(b) {
        this.closeBookmarkMenus();
        const url = String(b?.url || '').trim();
        if (!url) return;
        window.open(`https://web.archive.org/web/*/${url}`, '_blank', 'noopener,noreferrer');
    }

    async refreshBookmarkFavicon(key) {
        if (this._bmBusyKeys.has(key)) return;
        const record = await this.findBookmarkRecord(key);
        if (!record) return;
        this.closeBookmarkMenus();
        const url = String(record.record?.url || '').trim();
        const fetchIcon = window.BookmarkPreviewService?.fetchAndUploadFavicon;
        if (!url || typeof fetchIcon !== 'function') {
            this.notify(this.t('dashboard.healthFaviconFailed', 'Could not refresh the favicon'), 'error');
            return;
        }
        this._bmBusyKeys.add(key);
        this.syncBookmarkRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const iconPath = await fetchIcon(url);
            if (!iconPath) {
                this.notify(this.t('dashboard.healthFaviconNone', 'No favicon found for this URL'), 'info');
                return;
            }
            const res = await fetch(`/api/bookmarks?page=${record.pageId}`);
            if (!res.ok) throw new Error(`load HTTP ${res.status}`);
            const bookmarks = await res.json();
            if (!Array.isArray(bookmarks) || !bookmarks[record.index]) {
                throw new Error('bookmark not found');
            }
            bookmarks[record.index].icon = iconPath;
            const save = await fetcher(`/api/bookmarks?page=${record.pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookmarks),
            });
            if (!save.ok) throw new Error(`save HTTP ${save.status}`);
            this.notify(this.t('dashboard.healthFaviconDone', 'Favicon updated'), 'success', { duration: 3000 });
            await this.refreshBookmarksAfterWrite();
        } catch {
            this.notify(this.t('dashboard.healthFaviconFailed', 'Could not refresh the favicon'), 'error');
        } finally {
            this._bmBusyKeys.delete(key);
            this.syncBookmarkRowBusy(key, false);
        }
    }

    async refreshBookmarkTitle(key) {
        if (this._bmBusyKeys.has(key)) return;
        const record = await this.findBookmarkRecord(key);
        if (!record) return;
        this.closeBookmarkMenus();
        this._bmBusyKeys.add(key);
        this.syncBookmarkRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/auto-heal-apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: record.pageId,
                    index: record.index,
                    refreshTitle: true,
                }),
            });
            if (!res.ok) throw new Error(`title HTTP ${res.status}`);
            this.notify(this.t('dashboard.healthTitleDone', 'Title refreshed'), 'success', { duration: 3000 });
            await this.refreshBookmarksAfterWrite();
        } catch {
            this.notify(this.t('dashboard.healthTitleFailed', 'Could not refresh the title'), 'error');
        } finally {
            this._bmBusyKeys.delete(key);
            this.syncBookmarkRowBusy(key, false);
        }
    }

    async detectBookmarkRedirect(key) {
        if (this._bmBusyKeys.has(key)) return;
        const record = await this.findBookmarkRecord(key);
        if (!record) return;
        this.closeBookmarkMenus();
        this._bmBusyKeys.add(key);
        this.syncBookmarkRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetch(
                `/api/health/auto-heal-suggest?pageId=${encodeURIComponent(record.pageId)}&index=${encodeURIComponent(record.index)}&redirectOnly=1`
            );
            if (!res.ok) throw new Error(`suggest HTTP ${res.status}`);
            const suggestion = await res.json();
            const redirectUrl = String(suggestion?.redirectUrl || '').trim();
            if (!redirectUrl) {
                this.notify(this.t('dashboard.healthNoRedirect', 'No redirect found for this bookmark'), 'info');
                return;
            }
            const apply = await this.confirmAction(
                this.t('dashboard.healthRedirectBody', 'This bookmark redirects to:\n\n{url}', { url: redirectUrl }),
                {
                    title: this.t('dashboard.healthRedirectTitle', 'Apply redirect?'),
                    confirmLabel: this.t('config.confirmContinue', 'Continue'),
                    danger: false,
                }
            );
            if (!apply) return;
            const applied = await fetcher('/api/health/auto-heal-apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: record.pageId,
                    index: record.index,
                    newUrl: redirectUrl,
                    refreshTitle: false,
                }),
            });
            if (!applied.ok) throw new Error(`apply HTTP ${applied.status}`);
            const body = await applied.json().catch(() => ({}));
            const stillBroken = String(body?.lastError || '').trim();
            this.notify(
                stillBroken
                    ? this.t('dashboard.healthRedirectStillBroken', 'URL updated, but it still fails: {error}', { error: stillBroken })
                    : this.t('dashboard.healthRedirectDone', 'URL updated and reachable'),
                stillBroken ? 'info' : 'success',
                { duration: 4000 }
            );
            await this.refreshBookmarksAfterWrite();
            this.dash.updateHealthBadge?.();
        } catch {
            this.notify(this.t('dashboard.healthRedirectFailed', 'Could not detect a redirect'), 'error');
        } finally {
            this._bmBusyKeys.delete(key);
            this.syncBookmarkRowBusy(key, false);
        }
    }

    async setBookmarkCheckMode(key, mode) {
        const record = await this.findBookmarkRecord(key);
        if (!record || !window.CheckMode) return;
        this.closeBookmarkMenus();
        const updated = { ...record.record };
        window.CheckMode.assign(updated, mode);
        try {
            await this.writePageBookmarks(record.pageId, (list) => {
                const next = [...list];
                if (!next[record.index]) return next;
                next[record.index] = { ...next[record.index], ...updated };
                return next;
            });
            await this.refreshBookmarksAfterWrite();
            this.dash.updateHealthBadge?.();
        } catch {
            this.notify(this.t('config.bookmarkSaveError', 'Could not save the bookmark.'), 'error');
        }
    }

    handleBookmarkMenuAction(action, key) {
        const bookmark = this.findBookmarkByKey(key);
        if (!bookmark) return;
        switch (action) {
            case 'dashboard':
                this.openBookmarkOnDashboard(bookmark);
                break;
            case 'health':
                void this.revealBookmarkInHealth(key);
                break;
            case 'redirect':
                void this.detectBookmarkRedirect(key);
                break;
            case 'title':
                void this.refreshBookmarkTitle(key);
                break;
            case 'favicon':
                void this.refreshBookmarkFavicon(key);
                break;
            case 'archive':
                this.openBookmarkArchive(bookmark);
                break;
            case 'copy-url':
                this.copyBookmarkUrl(bookmark);
                break;
            case 'share':
                void this.shareBookmark(bookmark);
                break;
            case 'delete':
                void this.deleteBookmarkByKey(key);
                break;
            default:
                break;
        }
    }

    renderBookmarkRowActions(b, key, open) {
        const esc = (v) => this.dash.escapeHtml(v);
        const editLabel = open
            ? this.t('config.close', 'Close')
            : this.t('config.edit', 'Edit');
        const editKbd = open ? '' : '<kbd>e</kbd>';
        return `
            <div class="config-bm-actions">
                <div class="config-bm-actions-inner">
                    <button type="button" class="config-bm-action-btn" data-bm-open="${esc(key)}">${esc(this.t('config.openBookmark', 'Open'))}<kbd>Enter</kbd></button>
                    <button type="button" class="config-bm-action-btn" data-bm-edit="${esc(key)}">${esc(editLabel)}${editKbd}</button>
                    <button type="button" class="config-bm-action-btn config-bm-action-btn--danger" data-bm-delete="${esc(key)}">${esc(this.t('config.delete', 'Delete'))}<kbd>d</kbd></button>
                </div>
            </div>`;
    }

    renderBookmarkKeyboardLegend() {
        const keys = [
            ['j / k', this.t('config.bookmarksKeyMove', 'move')],
            ['Enter', this.t('config.bookmarksKeyOpen', 'open')],
            ['o', this.t('config.bookmarksKeyOpen', 'open')],
            ['e', this.t('config.bookmarksKeyEdit', 'edit')],
            ['m', this.t('config.bookmarksKeyMore', 'more')],
            ['c', this.t('config.bookmarksKeyCheckMode', 'checking')],
            ['d', this.t('config.bookmarksKeyDelete', 'delete')],
            ['g / G', this.t('config.bookmarksKeyFirstLast', 'first / last')],
            ['/', this.t('config.bookmarksKeySearch', 'search')],
            ['Esc', this.t('config.bookmarksKeyClear', 'clear')],
        ];
        return this.renderKeyboardLegendPairs(keys);
    }

    bindBookmarksSection(container) {
        const search = container.querySelector('#config-bm-search');
        if (search) {
            search.addEventListener('input', () => {
                this.bmQuery = search.value;
                this.scheduleBookmarkSearchRepaint();
            });
        }
        this.bindBookmarkFilterChips(container.querySelector('#config-bm-filter-chips'));
        this.bindBookmarkTagCloud(container);
        container.querySelector('[data-cleanup-clear]')?.addEventListener('click', () => {
            this.bmCleanupFilter = '';
            this.bmSelected.clear();
            // The banner is outside the list, so repainting the rows alone
            // would leave it on screen describing a filter no longer applied.
            this.render();
        });
        const wire = (id, prop) => {
            const el = container.querySelector(id);
            if (!el) return;
            el.addEventListener('change', () => {
                this[prop] = el.value;
                this.resetBookmarkVisibleLimit();
                this._bmDuplicateUrls = null;
                this.repaintBookmarksList();
                this.updateBookmarkListChrome();
            });
        };
        wire('#config-bm-sort', 'bmSort');
        const pageEl = container.querySelector('#config-bm-page');
        pageEl?.addEventListener('change', () => {
            this.bmPageFilter = pageEl.value;
            void this.onBookmarksPageFilterChange();
        });
        wire('#config-bm-category', 'bmCategoryFilter');
        void this.ensureBookmarkCategoriesForFilter().then(() => {
            this.repaintBookmarksFilters();
            this.repaintBookmarksList();
        });
        container.querySelector('#config-bm-add')
            ?.addEventListener('click', () => this.openAddBookmarkModal());
        container.querySelector('#config-bm-list')?.addEventListener('click', (e) => {
            if (e.target.closest('[data-bm-empty-add]')) {
                this.openAddBookmarkModal();
                return;
            }
            if (e.target.closest('[data-bm-empty-clear]')) {
                this.clearBookmarkFilters();
            }
        });
        container.querySelector('#config-bm-select-all')
            ?.addEventListener('click', () => this.toggleSelectAllBookmarks());
        this.bindBookmarkRows(container);
        this.bindBulkToolbar(container);
        this.bindBookmarkKeyboard(container);
    }

    clearBookmarkFilters() {
        this.bmQuery = '';
        this.bmPageFilter = '';
        this.bmCategoryFilter = '';
        this.bmCleanupFilter = '';
        this.bmTagFilter = [];
        this.bmSelected.clear();
        this.resetBookmarkVisibleLimit();
        this._bmDuplicateUrls = null;
        this.render();
        this.restoreConfigHash();
    }

    async onBookmarksPageFilterChange() {
        if (this.bmPageFilter && this.bmCategoryFilter) {
            const parsed = DashboardConfig.parseCategoryFilter(this.bmCategoryFilter);
            if (parsed.pageId && String(parsed.pageId) !== String(this.bmPageFilter)) {
                this.bmCategoryFilter = parsed.categoryId || '';
            }
        }
        this.resetBookmarkVisibleLimit();
        this._bmDuplicateUrls = null;
        await this.ensureBookmarkCategoriesForFilter();
        this.repaintBookmarksFilters();
        this.repaintBookmarksList();
        this.updateBookmarkListChrome();
        this.restoreConfigHash();
        this.updateConfigShellHead();
    }

    /**
     * Open the dashboard's add-bookmark modal from the Bookmarks section.
     *
     * The modal is the same one the `+` toolbar button and the `:new` command
     * use, so a bookmark filed from config goes through exactly one creation
     * path. It writes the bookmark itself and refreshes `dashboardInstance`,
     * but it knows nothing about the config list — hence the repaint below.
     */
    openAddBookmarkModal() {
        const d = this.dash;
        const handler = d.searchComponent?.commandsComponent?.newCommandHandler;
        if (!handler?.openModal) {
            this.notify(this.t('config.addBookmarkUnavailable', 'The add-bookmark dialog is not available.'), 'error');
            return;
        }
        // The handler caches its own pages/categories/page-id and only refreshes
        // them via setContext, which otherwise runs on the `:new` and quick-add
        // paths only. Without this the modal can open on a stale page list.
        //
        // The page it defaults to is currentPageId, so filtering the list to one
        // page files the new bookmark there — that is nearly always where it
        // belongs. Unfiltered, it falls back to the page being viewed.
        const preferredPage = Number(this.bmPageFilter) || Number(d.currentPageId) || 1;
        handler.setContext?.(preferredPage, d.categories || [], d.pages || []);
        handler.openModal();
        this.watchAddBookmarkModal();
    }

    /**
     * Repaint the list once the modal goes away.
     *
     * The modal exposes no "saved" callback, so rather than reaching into its
     * internals we watch for the overlay losing `.show` — which covers save,
     * cancel and Escape alike. A cancel simply repaints identical rows.
     *
     * Must be called *after* openModal: createModal removes and rebuilds the
     * overlay on every open, so an observer attached beforehand would be left
     * watching a detached node and never fire. Any previous observer is
     * disconnected for the same reason.
     */
    watchAddBookmarkModal() {
        const overlay = document.getElementById('bookmark-form-modal')
            || document.getElementById('new-bookmark-modal');
        if (!overlay) return;
        this._bmModalWatcher?.disconnect();
        const observer = new MutationObserver(() => {
            if (overlay.classList.contains('show')) return;
            observer.disconnect();
            if (this._bmModalWatcher === observer) this._bmModalWatcher = null;
            // The modal awaits its own dashboard refresh before closing, but
            // that runs on a separate promise chain; defer one frame so
            // allBookmarks is settled before we read it.
            requestAnimationFrame(() => {
                this.repaintBookmarksList();
                if (this._bmModalRestoreKey) {
                    this._bmKeyboardKey = this._bmModalRestoreKey;
                    this._bmModalRestoreKey = null;
                    this.syncBookmarkKeyboardSelectionAfterRender();
                }
            });
        });
        observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
        this._bmModalWatcher = observer;
    }

    /** Row-level handlers, rebound after every list repaint. */
    bindBookmarkRows(root) {
        const listRoot = root.querySelector('#config-bm-list') || root;
        listRoot.querySelectorAll('[data-feed-action="open"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const key = btn.closest('.config-bm-row')?.getAttribute('data-bm-key');
                if (key) this.openBookmarkByKey(key);
            });
        });
        listRoot.querySelectorAll('[data-feed-action="edit"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const key = btn.closest('.config-bm-row')?.getAttribute('data-bm-key');
                if (key) void this.openBookmarkEditModal(key);
            });
        });
        listRoot.querySelectorAll('[data-feed-action="recheck"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const key = btn.closest('.config-bm-row')?.getAttribute('data-bm-key');
                if (key) void this.recheckBookmarkByKey(key);
            });
        });
        listRoot.querySelectorAll('.health-view-more-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.getAttribute('data-menu-toggle');
                if (key) this.toggleBookmarkMenu(key, 'more');
            });
        });
        listRoot.querySelectorAll('.health-check-mode').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.getAttribute('data-menu-toggle');
                if (key) this.toggleBookmarkMenu(key, 'check');
            });
        });
        listRoot.querySelectorAll('[data-check-mode]').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = item.closest('.health-view-menu')?.getAttribute('data-menu-for');
                const mode = item.getAttribute('data-check-mode');
                if (key && mode) void this.setBookmarkCheckMode(key, mode);
            });
        });
        listRoot.querySelectorAll('[data-bm-menu-action]').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = item.closest('.health-view-menu')?.getAttribute('data-menu-for');
                const action = item.getAttribute('data-bm-menu-action');
                if (key && action) this.handleBookmarkMenuAction(action, key);
            });
        });
        listRoot.querySelectorAll('[data-bm-tick]').forEach((box) => {
            box.addEventListener('change', () => {
                const key = box.getAttribute('data-bm-tick');
                if (box.checked) this.bmSelected.add(key);
                else this.bmSelected.delete(key);
                this.repaintBulkToolbar();
                box.closest('.config-bm-item')?.classList.toggle('is-checked', box.checked);
            });
        });
        listRoot.querySelectorAll('.health-view-item-icon-img').forEach((img) => {
            window.BookmarkFeedRow?.bindIconFallback?.(img);
        });
        listRoot.querySelectorAll('[data-bm-filter-page]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pageId = btn.getAttribute('data-bm-filter-page');
                if (pageId) void this.filterBookmarksByPage(pageId);
            });
        });
        listRoot.querySelectorAll('[data-bm-row-key]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.getAttribute('data-bm-row-key');
                const b = key ? this.findBookmarkByKey(key) : null;
                if (b) this.filterBookmarksByCategory(b);
            });
        });
        listRoot.querySelectorAll('[data-bm-filter-tag]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.filterBookmarksByTag(btn.getAttribute('data-bm-filter-tag'));
            });
        });
        listRoot.querySelectorAll('.config-bm-row').forEach((row) => {
            row.addEventListener('dblclick', (e) => {
                if (e.target.closest('button, label, input, select, a')) return;
                const key = row.getAttribute('data-bm-key');
                if (key) this.openBookmarkByKey(key);
            });
        });
        if (!listRoot.dataset.configBmPointerWired) {
            listRoot.dataset.configBmPointerWired = '1';
            listRoot.addEventListener('click', (e) => {
                if (!e.target.closest('.health-view-menu') && !e.target.closest('[aria-haspopup="menu"]')) {
                    this.closeBookmarkMenus();
                }
            });
        }
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
                if (el.getAttribute('data-bm-field') === 'pageId') {
                    void this.refreshEditorCategories(editor, el.value);
                }
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
        const editorPageId = editor.querySelector('[data-bm-field="pageId"]')?.value;
        void this.loadBookmarkCategoriesForPage(editorPageId).then(() => {
            void this.refreshEditorCategories(editor, editorPageId);
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

    async refreshEditorCategories(editor, pageId) {
        if (pageId) await this.loadBookmarkCategoriesForPage(pageId);
        const sel = editor.querySelector('[data-bm-field="category"]');
        if (!sel) return;
        const current = sel.value;
        const esc = (v) => this.dash.escapeHtml(v);
        const cats = this.knownCategories(pageId);
        sel.innerHTML = [`<option value="">${esc(this.t('config.noCategory', 'No category'))}</option>`]
            .concat(cats.map((c) =>
                `<option value="${esc(c.id)}" ${c.id === current ? 'selected' : ''}>${esc(c.label)}</option>`))
            .concat([`<option value="__new__">${esc(this.t('config.addNewCategoryOption', '➕ New category…'))}</option>`])
            .join('');
        if (!cats.some((c) => c.id === current) && current !== '__new__') {
            sel.value = '';
        }
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
     * Offer the new name as a selected option and remember it as pending. The
     * dashboard groups bookmarks by the *page's* category list, so saving the
     * bookmark alone would leave it orphaned under "Unknown category" — the
     * category itself is written to the target page in saveEditedBookmark.
     */
    confirmNewCategory(editor) {
        const box = editor.querySelector('[data-bm-newcat]');
        const input = box?.querySelector('[data-bm-newcat-input]');
        const sel = editor.querySelector('[data-bm-field="category"]');
        const name = String(input?.value || '').trim();
        if (!name || !sel) return;
        // Reuse an existing category whose id or label already matches, so
        // typing the name of a category that exists does not duplicate it.
        const pageId = editor.querySelector('[data-bm-field="pageId"]')?.value;
        const existing = this.knownCategories(pageId)
            .find((c) => c.id === name || c.label.toLowerCase() === name.toLowerCase());
        const id = existing ? existing.id : `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        if (!existing) {
            this._pendingCategories = this._pendingCategories || new Map();
            this._pendingCategories.set(id, name);
        }
        if (![...sel.options].some((o) => o.value === id)) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
        }
        sel.value = id;
        if (box) { box.hidden = true; if (input) input.value = ''; }
        this.markEditorDirty(editor);
    }

    /**
     * Make sure a page's category list contains `categoryId`, adding it if not.
     *
     * Assigning a category to a bookmark only writes the id onto the bookmark;
     * nothing adds it to the target page's own list. A page that has never seen
     * that category therefore ends up with bookmarks pointing at an id it does
     * not define, and they surface as "unknown categories" on the dashboard.
     *
     * The label comes from wherever the id is already known — the pending map
     * for a just-typed name, otherwise the id's display name elsewhere — so a
     * category carried onto a new page keeps reading the same.
     */
    async ensureCategoryOnPage(pageId, categoryId) {
        if (!pageId || !categoryId) return;
        const res = await fetch(`/api/categories?page=${encodeURIComponent(pageId)}`);
        const current = res && res.ok ? await res.json() : [];
        const list = Array.isArray(current) ? current : [];
        if (list.some((c) => String(c.id) === String(categoryId))) return;
        const name = this._pendingCategories?.get(categoryId)
            || this.knownCategories(pageId).find((c) => String(c.id) === String(categoryId))?.label
            || String(categoryId);
        const saveRes = await this.writeFetch(`/api/categories?page=${encodeURIComponent(pageId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([...list, { id: categoryId, name, sortMode: 'order' }]),
        });
        if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`);
        this._pendingCategories?.delete(categoryId);
        this.invalidateBookmarkCategoriesCache(pageId);
        if (String(this._catLoadedFor) === String(pageId)) this._catLoadedFor = null;
    }

    /**
     * The comparison key for "is this the same name?".
     *
     * Case and surrounding whitespace are ignored, because "Work" and "work "
     * read as the same label to a person and are exactly the pair that causes
     * confusion. Inner whitespace is collapsed for the same reason.
     */
    static nameKey(value) {
        return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    /**
     * Is `name` free, given the names already taken?
     *
     * `taken` is any iterable of existing names. `self` is the entry being
     * renamed, excluded so that re-saving a row without changing its name — or
     * only changing its capitalisation — is not reported as a clash with itself.
     *
     * An empty name is never treated as a duplicate here; emptiness is a
     * separate concern handled by the callers that care about it.
     */
    static isNameTaken(name, taken, self = null) {
        const key = DashboardConfig.nameKey(name);
        if (!key) return false;
        let selfKey = self === null ? null : DashboardConfig.nameKey(self);
        for (const other of taken) {
            const otherKey = DashboardConfig.nameKey(other);
            if (!otherKey) continue;
            if (selfKey !== null && otherKey === selfKey) {
                // Skip one occurrence only: a list that already contains the
                // name twice should still report the second as a duplicate.
                selfKey = null;
                continue;
            }
            if (otherKey === key) return true;
        }
        return false;
    }

    /**
     * The one guard behind every uniqueness check in config.
     *
     * Pages, categories, tags and finders all edit a name through an inline
     * input that saves on `change`, so they can share this: if the typed name
     * collides, the input is put back to `previous`, a message is shown, and
     * the caller is told to abandon the write.
     *
     * Returns true when the name is free and the caller should proceed.
     */
    guardUniqueName(input, name, taken, { previous = null, message } = {}) {
        if (!DashboardConfig.isNameTaken(name, taken, previous)) return true;
        if (input && previous !== null) input.value = previous;
        this.notify(
            message || this.t('config.nameDuplicate', 'That name is already in use.'),
            'error'
        );
        input?.focus?.();
        input?.select?.();
        return false;
    }

    /**
     * A name that does not collide, by appending " 2", " 3", … as needed.
     * Used by the Add buttons, which invent a name rather than asking for one.
     */
    static uniqueNameFrom(base, taken) {
        if (!DashboardConfig.isNameTaken(base, taken)) return base;
        for (let n = 2; n < 1000; n += 1) {
            const candidate = `${base} ${n}`;
            if (!DashboardConfig.isNameTaken(candidate, taken)) return candidate;
        }
        return `${base} ${Date.now()}`;
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

            const isTarget = DashboardConfig.matchesParsedKey(parsed);
            await this.writePageBookmarks(parsed.pageId, (list) =>
                list.map((b) => (isTarget(b) ? { ...b, ...fields } : b)));
            this.notify(action === 'refresh'
                ? this.t('config.bookmarkLinkPreviewRefreshed', 'Link preview updated.')
                : this.t('config.bookmarkLinkPreviewCleared', 'Link preview cleared.'), 'success');
            await this.refreshBookmarksAfterWrite();
        } catch {
            this.notify(this.t('config.bookmarkLinkPreviewRefreshFailed', 'Could not fetch link preview.'), 'error');
        }
    }

    /**
     * An in-app replacement for window.confirm.
     *
     * Native dialogs cannot be styled or themed and look foreign against the
     * rest of the view. This reuses modal.css — the same overlay, buttons and
     * .danger treatment the other dashboard modals use — so a destructive
     * confirmation looks destructive.
     *
     * Resolves true/false like window.confirm, so call sites only need `await`.
     * Escape, the backdrop and Cancel all resolve false; the confirm button is
     * focused on open so Enter accepts, which keeps the keyboard flow of the
     * native dialog it replaces.
     */
    confirmAction(message, { title, confirmLabel, danger = true } = {}) {
        const esc = (v) => this.dash.escapeHtml(v);
        document.getElementById('config-confirm-modal')?.remove();
        const heading = title || this.t('config.confirmTitle', 'Are you sure?');
        const okLabel = confirmLabel || this.t('config.confirmOk', 'Delete');
        const cancelLabel = this.t('config.confirmCancel', 'Cancel');
        document.body.insertAdjacentHTML('beforeend', `
            <div id="config-confirm-modal" class="modal-overlay" aria-hidden="false">
                <div class="modal" role="dialog" aria-modal="true" aria-labelledby="config-confirm-title">
                    <div class="modal-header">
                        <span class="modal-title" id="config-confirm-title">${esc(heading)}</span>
                    </div>
                    <div class="modal-body">
                        <p class="config-confirm-message">${esc(message)}</p>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="modal-button" data-confirm="cancel">
                            <span class="modal-button-name">${esc(cancelLabel)}</span>
                        </button>
                        <button type="button" class="modal-button${danger ? ' danger' : ''}" data-confirm="ok">
                            <span class="modal-button-name">${esc(okLabel)}</span>
                        </button>
                    </div>
                </div>
            </div>`);
        const overlay = document.getElementById('config-confirm-modal');
        // .show drives the CSS transition; setting it on the next frame lets the
        // overlay animate in rather than appearing fully formed.
        requestAnimationFrame(() => overlay.classList.add('show'));
        const previouslyFocused = document.activeElement;

        return new Promise((resolve) => {
            let done = false;
            const finish = (result) => {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                // Escape from a dialog should land back where it was opened
                // from, not on <body>, or the next keystroke goes nowhere.
                if (previouslyFocused?.isConnected) previouslyFocused.focus?.();
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
            };
            // Capture phase: the config view and the dashboard both listen for
            // Escape, and the dialog has to win while it is open.
            document.addEventListener('keydown', onKey, true);
            overlay.querySelector('[data-confirm="ok"]').addEventListener('click', () => finish(true));
            overlay.querySelector('[data-confirm="cancel"]').addEventListener('click', () => finish(false));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
            overlay.querySelector('[data-confirm="ok"]').focus();
        });
    }

    /**
     * Second gate for the irreversible actions: the reader has to type a word
     * before the confirm button does anything. The token is translated, so a
     * Dutch reader types the Dutch word, and matching ignores case and padding.
     * Resolves true only on an exact match; false on cancel, Escape, or a typo.
     */
    confirmTypedAction(message, token, { title, confirmLabel } = {}) {
        const esc = (v) => this.dash.escapeHtml(v);
        document.getElementById('config-confirm-modal')?.remove();
        const heading = title || this.t('config.resetTypeTitle', 'Final confirmation');
        const okLabel = confirmLabel || this.t('config.resetTypeConfirm', 'Confirm reset');
        const cancelLabel = this.t('config.confirmCancel', 'Cancel');
        const inputLabel = this.t('config.resetTypeLabel', 'Confirmation text');
        document.body.insertAdjacentHTML('beforeend', `
            <div id="config-confirm-modal" class="modal-overlay" aria-hidden="false">
                <div class="modal" role="dialog" aria-modal="true" aria-labelledby="config-confirm-title">
                    <div class="modal-header">
                        <span class="modal-title" id="config-confirm-title">${esc(heading)}</span>
                    </div>
                    <div class="modal-body">
                        <p class="config-confirm-message">${esc(message)}</p>
                        <input type="text" class="config-text config-confirm-input" data-confirm-input
                            autocomplete="off" spellcheck="false" aria-label="${esc(inputLabel)}">
                        <p class="config-field-hint" data-confirm-hint hidden>${esc(this.t('config.resetTypeMismatch', 'That does not match — nothing was changed.'))}</p>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="modal-button" data-confirm="cancel">
                            <span class="modal-button-name">${esc(cancelLabel)}</span>
                        </button>
                        <button type="button" class="modal-button danger" data-confirm="ok" disabled>
                            <span class="modal-button-name">${esc(okLabel)}</span>
                        </button>
                    </div>
                </div>
            </div>`);
        const overlay = document.getElementById('config-confirm-modal');
        requestAnimationFrame(() => overlay.classList.add('show'));
        const previouslyFocused = document.activeElement;
        const wanted = String(token || '').trim().toLocaleUpperCase();

        return new Promise((resolve) => {
            let done = false;
            const input = overlay.querySelector('[data-confirm-input]');
            const okBtn = overlay.querySelector('[data-confirm="ok"]');
            const hint = overlay.querySelector('[data-confirm-hint]');
            const matches = () => String(input.value || '').trim().toLocaleUpperCase() === wanted;
            const finish = (result) => {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                if (previouslyFocused?.isConnected) previouslyFocused.focus?.();
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
            };
            document.addEventListener('keydown', onKey, true);
            // The button stays disabled until the word matches, so there is no
            // way to fire the reset by mistyping and clicking anyway.
            input.addEventListener('input', () => {
                okBtn.disabled = !matches();
                if (hint) hint.hidden = true;
            });
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (matches()) finish(true);
                else if (hint) hint.hidden = false;
            });
            okBtn.addEventListener('click', () => { if (matches()) finish(true); });
            overlay.querySelector('[data-confirm="cancel"]').addEventListener('click', () => finish(false));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
            input.focus();
        });
    }

    async confirmDiscardBookmarkEdit() {
        if (!this.bmDirty) return true;
        return this.confirmAction(
            this.t('config.discardChangesConfirm', 'Discard your unsaved changes?'),
            { confirmLabel: this.t('config.confirmDiscard', 'Discard') }
        );
    }

    /**
     * Tick every row the filters currently show, or clear them if they already
     * are. Scoped to the visible rows, not the whole collection: acting on
     * bookmarks you cannot see is how a bulk delete goes wrong.
     */
    /**
     * "Select all" ticks every row the current filters match, which is usually
     * more than the ~50 rendered — the rest arrive on scroll. Naming the count
     * says so up front, since the next click may well be Delete.
     */
    selectAllBookmarksLabel() {
        const total = this.visibleBookmarks().length;
        const shown = Math.min(total, Math.max(DashboardConfig.BM_PAGE_SIZE, Number(this.bmVisibleLimit) || DashboardConfig.BM_PAGE_SIZE));
        if (total > shown) {
            return this.t('config.selectAllBookmarksCount', 'Select all {n}').replace('{n}', String(total));
        }
        return this.t('config.selectAllBookmarks', 'Select all');
    }

    toggleSelectAllBookmarks() {
        const rows = this.visibleBookmarks();
        const keys = rows.map((b) => this.bookmarkKey(b));
        const allSelected = keys.length > 0 && keys.every((k) => this.bmSelected.has(k));
        if (allSelected) {
            keys.forEach((k) => this.bmSelected.delete(k));
        } else {
            keys.forEach((k) => this.bmSelected.add(k));
        }
        const host = document.getElementById('config-bm-list');
        if (host) {
            keys.forEach((key) => {
                const row = host.querySelector(`.config-bm-row[data-bm-key="${CSS.escape(key)}"]`);
                if (!row) return;
                const box = row.querySelector('.config-bm-tick');
                if (box) box.checked = !allSelected;
                row.classList.toggle('is-checked', !allSelected);
            });
            this.repaintBulkToolbar();
            return;
        }
        this.repaintBookmarksList();
    }

    /**
     * Load the next page when the sentinel scrolls into view.
     *
     * Growing the list re-renders it, which rebuilds this observer; if the
     * sentinel is still on screen at that moment it fires again straight away.
     * With a short window — or a list that simply does not overflow — that loop
     * ran to the end of the library on its own: 500 bookmarks were all in the
     * DOM within a couple of seconds without anyone scrolling, and the 50-row
     * page size did nothing.
     *
     * Each batch now needs a fresh scroll. `_bmLoadMoreArmed` is lowered as soon
     * as one page is added and only raised again by a scroll on the list's own
     * host, so an idle screen stays at the size it was rendered with.
     */
    setupBookmarkLoadMore(host) {
        const sentinel = host?.querySelector('[data-bm-load-more]');
        if (!sentinel) return;
        sentinel.hidden = false;
        sentinel.removeAttribute('aria-hidden');
        this._bmLoadMoreObserver?.disconnect?.();
        const root = this.bookmarkListScrollHost();
        this.armBookmarkLoadMore(root);
        this._bmLoadMoreObserver = new IntersectionObserver((entries) => {
            if (!this._bmLoadMoreArmed) return;
            if (!entries.some((e) => e.isIntersecting)) return;
            const total = this.visibleBookmarks().length;
            if (this.bmVisibleLimit >= total) return;
            this._bmLoadMoreArmed = false;
            this.bmVisibleLimit += DashboardConfig.BM_PAGE_SIZE;
            this.repaintBookmarksList();
        }, { root: root || null, rootMargin: '160px' });
        this._bmLoadMoreObserver.observe(sentinel);
    }

    /**
     * Re-arm the loader on the next scroll of the list's scroll host.
     *
     * `root` is whichever element actually scrolls, or null when that is the
     * viewport. Window is listened to either way: a scroll container can still
     * be carried up the page by an outer scroll, and with a null root the
     * window listener is the only one that fires.
     */
    armBookmarkLoadMore(root) {
        if (this._bmLoadMoreScrollTarget) {
            this._bmLoadMoreScrollTarget.removeEventListener('scroll', this._bmLoadMoreScrollHandler);
            window.removeEventListener('scroll', this._bmLoadMoreScrollHandler);
        }
        this._bmLoadMoreArmed = false;
        this._bmLoadMoreScrollHandler = () => {
            this._bmLoadMoreArmed = true;
        };
        this._bmLoadMoreScrollTarget = root || document;
        this._bmLoadMoreScrollTarget.addEventListener('scroll', this._bmLoadMoreScrollHandler, { passive: true });
        window.addEventListener('scroll', this._bmLoadMoreScrollHandler, { passive: true });
    }

    repaintBookmarksList() {
        const host = document.getElementById('config-bm-list');
        if (!host) return;
        // An explicit repaint means the caller believes something changed, and
        // bookmarks are routinely edited in place — the array identity the memo
        // keys on would not have moved. Drop it and recompute.
        this.invalidateVisibleBookmarks();
        // A null host means the page itself scrolls, so the position to keep
        // across the repaint lives on the window, not on an element.
        const scrollHost = this.bookmarkListScrollHost();
        const scrollTop = scrollHost ? scrollHost.scrollTop : window.scrollY;
        this._bmLoadMoreObserver?.disconnect?.();
        this._bmLoadMoreObserver = null;
        host.innerHTML = this.renderBookmarksList();
        this.bindBookmarkRows(host);
        this.bindBookmarkKeyboard(host);
        this.repaintBulkToolbar();
        this.updateBookmarkListChrome();
        if (scrollHost) scrollHost.scrollTop = scrollTop;
        else window.scrollTo(0, scrollTop);
        this.setupBookmarkLoadMore(host);
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
    /**
     * Splits a row key back into page, URL and which copy of that URL it is.
     *
     * Keys are "pageId::url" for a unique bookmark and "pageId::url::n" for the
     * n-th further copy of a duplicated URL. Only a trailing all-digits segment
     * counts as the occurrence marker, so a URL that itself ends in "::something"
     * is left intact.
     */
    parseBookmarkKey(key) {
        const raw = String(key || '');
        const idx = raw.indexOf('::');
        if (idx < 0) return null;
        let url = raw.slice(idx + 2);
        let occurrence = 0;
        const tail = url.lastIndexOf('::');
        if (tail >= 0 && /^\d+$/.test(url.slice(tail + 2))) {
            occurrence = Number(url.slice(tail + 2));
            url = url.slice(0, tail);
        }
        return { pageId: raw.slice(0, idx), url, occurrence };
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
        if (!await this.confirmAction(this.t('config.deleteBookmarkConfirm', 'Delete this bookmark?'))) return;
        try {
            // Snapshot before the write, so the toast can put this row back —
            // same as bulk delete and the :remove command.
            const snapshot = (this.dash.allBookmarks || [])
                .filter((b) => String(b.pageId) === String(parsed.pageId))
                .map((b) => {
                    const copy = { ...b };
                    delete copy.pageId;
                    return copy;
                });
            const isTarget = DashboardConfig.matchesParsedKey(parsed);
            await this.writePageBookmarks(parsed.pageId, (list) => list.filter((b) => !isTarget(b)));
            this.bmSelected.delete(key);
            if (this.bmEditing === key) { this.bmEditing = null; this.bmDirty = false; }
            this.notify(this.t('config.bookmarkDeleted', 'Bookmark deleted.'), 'success', {
                duration: 8000,
                undoCallback: async () => {
                    try {
                        await this.writeFetch(`/api/bookmarks?page=${encodeURIComponent(parsed.pageId)}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(snapshot),
                        });
                        await this.refreshBookmarksAfterWrite();
                        this.notify(this.t('config.bookmarkRestored', 'Bookmark restored.'), 'success');
                    } catch {
                        this.notify(this.t('config.bookmarkRestoreFailed', 'Could not restore the bookmark.'), 'error');
                    }
                },
            });
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
            // The category has to exist on the target page before the bookmark
            // points at it, or it renders as an orphan. This covers a category
            // invented in this editor and one carried to a page that has never
            // used it — moving a bookmark across pages hits the latter.
            if (category) await this.ensureCategoryOnPage(targetPage, category);
            const findOriginal = DashboardConfig.matchesParsedKey(parsed);
            const original = (this.dash.allBookmarks || [])
                .filter((b) => String(b.pageId) === String(parsed.pageId))
                .find(findOriginal) || {};
            if (targetPage === String(parsed.pageId)) {
                const isTarget = DashboardConfig.matchesParsedKey(parsed);
                await this.writePageBookmarks(parsed.pageId, (list) =>
                    list.map((b) => (isTarget(b) ? { ...b, ...updated } : b)));
            } else {
                // Moving pages is two writes: drop it from the old page, then
                // append it to the new one so it cannot exist on both at once.
                const isTarget = DashboardConfig.matchesParsedKey(parsed);
                await this.writePageBookmarks(parsed.pageId, (list) => list.filter((b) => !isTarget(b)));
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
        return (this.dash.allBookmarks || []).filter((b) => keys.has(this.bookmarkKey(b)));
    }

    async handleBulkAction(action) {
        if (action === 'clear') {
            this.bmSelected.clear();
            this.repaintBookmarksList();
            return;
        }
        if (action === 'keep-visible') {
            const visibleKeys = new Set(this.visibleBookmarks().map((b) => this.bookmarkKey(b)));
            [...this.bmSelected].forEach((k) => {
                if (!visibleKeys.has(k)) this.bmSelected.delete(k);
            });
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
            else if (action === 'favicons') await this.bulkFavicons(picked);
            else if (action === 'export') this.bulkExportCsv(picked);
            else if (action === 'delete') await this.bulkDelete(picked);
        } catch {
            this.notify(this.t('config.bulkActionError', 'Could not apply the bulk action.'), 'error');
            // A selection spanning several pages is written one page at a time,
            // so a failure part-way leaves the earlier pages already saved. The
            // list still shows the pre-action state, which would misreport what
            // is stored — reload so the rows match what actually landed.
            await this.refreshBookmarksAfterWrite();
        }
    }

    /**
     * Groups picked bookmarks per page as sets of "url::occurrence" targets.
     *
     * Matching on the URL alone would hit every copy of a duplicated URL, so
     * ticking one of two identical rows would mutate or delete both. The
     * occurrence number pins which copy was meant. The stored list is walked in
     * the same order the occurrence index was built from, so the counts line up.
     */
    selectionTargetsByPage(picked) {
        const occurrence = this.bookmarkOccurrenceIndex();
        const byPage = new Map();
        picked.forEach((b) => {
            const set = byPage.get(String(b.pageId)) || new Set();
            set.add(`${b.url}::${occurrence.get(b) || 0}`);
            byPage.set(String(b.pageId), set);
        });
        return byPage;
    }

    /**
     * Predicate matching exactly one stored entry: the n-th bookmark with that
     * URL. Built for the single-row paths, where matching on URL alone would
     * edit or delete every copy of a duplicated URL at once.
     */
    static matchesParsedKey(parsed) {
        let n = 0;
        return (b) => {
            if (b.url !== parsed.url) return false;
            return n++ === (parsed.occurrence || 0);
        };
    }

    /** Walks a stored page list, tagging each entry with its occurrence number. */
    static withOccurrence(list) {
        const seen = new Map();
        return (list || []).map((b) => {
            const n = seen.get(b.url) || 0;
            seen.set(b.url, n + 1);
            return { bookmark: b, target: `${b.url}::${n}` };
        });
    }

    /**
     * Apply a mutation to every ticked bookmark, grouped per page so each page
     * is written exactly once rather than once per bookmark.
     */
    async mutateSelected(picked, mutate) {
        for (const [pageId, targets] of this.selectionTargetsByPage(picked)) {
            await this.writePageBookmarks(pageId, (list) => DashboardConfig.withOccurrence(list)
                .map(({ bookmark, target }) => (targets.has(target) ? mutate({ ...bookmark }) : bookmark)));
        }
        this.bmSelected.clear();
        await this.refreshBookmarksAfterWrite();
    }

    async bulkMove(picked) {
        const targetPage = document.getElementById('config-bulk-page')?.value || '';
        const rawCat = document.getElementById('config-bulk-category')?.value || '';
        const { pageId: catPage, categoryId: targetCat } = DashboardConfig.parseCategoryFilter(rawCat);
        if (!targetPage && !targetCat) return;

        if (targetCat && !targetPage) {
            const applyTo = catPage
                ? picked.filter((b) => String(b.pageId) === String(catPage))
                : picked;
            if (!applyTo.length) return;
            const pages = new Set(applyTo.map((b) => String(b.pageId)));
            for (const pageId of pages) {
                await this.ensureCategoryOnPage(pageId, targetCat);
            }
            await this.mutateSelected(applyTo, (b) => ({ ...b, category: targetCat }));
            this.notify(this.t('config.bulkMoveDone', 'Bookmarks updated.'), 'success');
            return;
        }

        // A page move is a remove-then-append across two lists, so it cannot go
        // through mutateSelected.
        if (targetCat) await this.ensureCategoryOnPage(targetPage, targetCat);
        const moving = picked.filter((b) => String(b.pageId) !== String(targetPage));
        const byPage = this.selectionTargetsByPage(moving);
        const carried = moving.map((b) => {
            const copy = { ...b };
            delete copy.pageId;
            if (targetCat) copy.category = targetCat;
            return copy;
        });
        for (const [pageId, targets] of byPage) {
            await this.writePageBookmarks(pageId, (list) => DashboardConfig.withOccurrence(list)
                .filter(({ target }) => !targets.has(target))
                .map(({ bookmark }) => bookmark));
        }
        await this.refreshBookmarksAfterWrite({ silent: true });
        if (carried.length) {
            await this.writePageBookmarks(targetPage, (list) => [...list, ...carried]);
        }
        // Anything already on the target page still needs its category applied.
        // Targets are resolved before the refresh below, while the occurrence
        // index still describes the list these bookmarks were picked from.
        const staying = picked.filter((b) => String(b.pageId) === String(targetPage));
        if (targetCat && staying.length) {
            const targets = this.selectionTargetsByPage(staying).get(String(targetPage)) || new Set();
            await this.refreshBookmarksAfterWrite({ silent: true });
            await this.writePageBookmarks(targetPage, (list) => DashboardConfig.withOccurrence(list)
                .map(({ bookmark, target }) => (targets.has(target) ? { ...bookmark, category: targetCat } : bookmark)));
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
        const msg = this.t('config.bulkDeleteConfirm', 'Delete {n} bookmarks?')
            .replace('{n}', String(picked.length));
        if (!await this.confirmAction(msg)) return;

        const byPage = [...this.selectionTargetsByPage(picked)];
        // Snapshot each affected page before touching it, so the toast can put
        // the rows back. The same approach the :remove command already uses —
        // deleting in bulk is exactly where getting it wrong hurts most.
        const snapshots = new Map();
        for (const [pageId] of byPage) {
            snapshots.set(String(pageId), (this.dash.allBookmarks || [])
                .filter((b) => String(b.pageId) === String(pageId))
                .map((b) => {
                    const copy = { ...b };
                    delete copy.pageId;
                    return copy;
                }));
        }

        for (const [pageId, targets] of byPage) {
            await this.writePageBookmarks(pageId, (list) => DashboardConfig.withOccurrence(list)
                .filter(({ target }) => !targets.has(target))
                .map(({ bookmark }) => bookmark));
        }
        this.bmSelected.clear();
        this.bmEditing = null;

        const undoCallback = async () => {
            try {
                for (const [pageId, rows] of snapshots) {
                    await this.writeFetch(`/api/bookmarks?page=${encodeURIComponent(pageId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(rows),
                    });
                }
                await this.refreshBookmarksAfterWrite();
                this.notify(this.t('config.bulkDeleteUndone', 'Bookmarks restored.'), 'success');
            } catch {
                this.notify(this.t('config.bulkDeleteUndoFailed', 'Could not restore the bookmarks.'), 'error');
            }
        };

        this.notify(this.t('config.bulkDeleteDone', 'Bookmarks deleted.'), 'success', {
            undoCallback,
            duration: 8000,
        });
        await this.refreshBookmarksAfterWrite();
    }

    async bulkFavicons(picked) {
        let ok = 0;
        for (const b of picked) {
            const key = this.bookmarkKey(b);
            try {
                await this.refreshBookmarkFavicon(key);
                ok += 1;
            } catch {
                /* refreshBookmarkFavicon notifies per row */
            }
        }
        if (ok > 0) {
            this.notify(
                this.t('config.bulkFaviconsDone', 'Favicons refreshed for {n} bookmarks.').replace('{n}', String(ok)),
                'success'
            );
        }
    }

    bulkExportCsv(picked) {
        if (!picked?.length) return;
        const pageNames = Object.fromEntries((this.dash.pages || []).map((p) => [p.id, p.name]));
        const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const header = ['Name', 'URL', 'Category', 'Page', 'Shortcut', 'Tags', 'Notes'].map(escape).join(',');
        const rows = picked.map((bm) => [
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
        this.triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `nextdash-bookmarks-selected-${date}.csv`);
        this.notify(this.t('config.bulkExportDone', 'Selection exported.'), 'success');
    }

    /** Reload the dashboard's bookmark copies and repaint both list and grid. */
    async refreshBookmarksAfterWrite({ silent = false } = {}) {
        await this.dash.data?.refreshAfterBookmarkMutation?.({
            pageId: this.dash.currentPageId,
            repaintActiveView: !silent,
        });
    }

    /* ── Statistics (native) ───────────────────────────────────────────────── */

    /** How far back the activity chart looks, in days. */
    static STATS_RANGES = [7, 30, 90, 365];

    /** How many rows the ranked Statistics lists show before cutting off. */
    static STATS_LIST_LIMIT = 20;

    /**
     * A read-only report on what is actually in the dashboard: a cleanup score,
     * an activity chart, ratio bars, top lists and per-page/tag distributions.
     *
     * Everything is derived from the bookmark copies the shell already holds, so
     * opening this costs one health fetch rather than a page load. The score and
     * the chart use the same formulas and bucketing the old config's stats tab
     * used, so a number does not change meaning by moving views.
     */
    statsTabLabel(tab) {
        const map = {
            overview: ['config.statsTabOverview', 'Overview'],
            activity: ['config.statsTabActivity', 'Activity'],
            content: ['config.statsTabContent', 'Content'],
            inbox: ['config.statsTabInbox', 'Inbox'],
            health: ['config.statsTabHealth', 'Health'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    }

    /**
     * Statistics used to be one long scroll of seven panels, which buried
     * everything below the fold. The same panels are grouped into four tabs:
     * the headline numbers and score, what you open over time, what your
     * collection is made of, and what needs fixing.
     */
    renderStats() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tabs = DashboardConfig.STATS_TABS.map((tab) => {
            const active = tab === this.statsTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-stats-body" data-stats-tab="${esc(tab)}">${esc(this.statsTabLabel(tab))}</button>`;
        }).join('');

        return `
            <p class="config-view-intro">${esc(this.t('config.statsIntroView', 'What is in your dashboard right now. These numbers update as you change things.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div id="config-stats-body" role="tabpanel" tabindex="0">${this.renderStatsBody()}</div>
            ${this.renderStatsTimestamp()}
        `;
    }

    /**
     * When these numbers were worked out.
     *
     * They are recomputed from whatever is in memory at render time, not
     * fetched, so nothing on the page said whether you were looking at a
     * snapshot from ten seconds or ten minutes ago. It sits below the body
     * rather than in the intro: it dates everything above it, including the
     * panels that repaint on a tab switch.
     */
    renderStatsTimestamp() {
        const esc = (v) => this.dash.escapeHtml(v);
        const time = new Intl.DateTimeFormat(this.dash.settings?.language || undefined,
            { hour: '2-digit', minute: '2-digit' }).format(new Date());
        return `<p class="config-stats-updated">${esc(this.t('config.statsUpdatedAt', 'Worked out at {time}')
            .replace('{time}', time))}</p>`;
    }

    /**
     * One explanation instead of a page of zeroes.
     *
     * With nothing to measure, every panel still rendered: five coverage bars
     * reading "0 / 0 · 0%", a category list with no rows, a cleanup score of 0
     * out of 100. That reads as something broken rather than as a dashboard
     * nobody has filled yet, so the whole body is replaced by a single line
     * saying what to do — except on Inbox, whose numbers come from the server
     * and mean something even with no bookmarks.
     */
    renderStatsEmpty() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-panel config-panel--empty-state">
                <h3 class="config-panel-title">${esc(this.t('config.statsEmptyTitle', 'Nothing to measure yet'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.statsEmptyBody', 'Statistics fill in as you add bookmarks and start opening them. Add a few and this page will have something to say.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--primary" data-stats-action="add-bookmark">${esc(this.t('config.addBookmarkBtn', 'Add bookmark'))}</button>
                </div>
            </div>`;
    }

    renderStatsBody() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.computeStats();

        // Inbox is server-side and still meaningful on an empty dashboard.
        if (!s.total && this.statsTab !== 'inbox') {
            return this.renderStatsEmpty();
        }

        // The label and the value are separate spans, so a screen reader read
        // them as two loose strings that only made sense because they happened
        // to be adjacent. aria-label names the tile as one thing — "Bookmarks:
        // 102" — and the spans are hidden so it is not then read twice.
        const tile = (label, value, hint) => `
            <div class="config-tile" role="listitem" aria-label="${esc(label)}: ${esc(String(value))}${hint ? `. ${esc(hint)}` : ''}">
                <span class="config-tile-label" aria-hidden="true">${esc(label)}</span>
                <span class="config-tile-value" aria-hidden="true">${esc(String(value))}</span>
                ${hint ? `<p class="config-tile-detail" aria-hidden="true">${esc(hint)}</p>` : ''}
            </div>`;

        switch (this.statsTab) {
            case 'activity':
                return this.renderStatsActivity(s)
                    + this.renderStatsTopLists(s)
                    + this.renderStatsShortcuts(s)
                    + `<div id="config-stats-finders">${this.renderStatsFinders()}</div>`;
            case 'content':
                return this.renderStatsRatios(s)
                    + this.renderStatsConcentration(s)
                    + this.renderStatsCategoryEffectiveness(s)
                    + this.renderStatsDistributions(s)
                    + this.renderStatsCleanup(s);
            case 'inbox':
                return this.renderStatsInbox();
            case 'health':
                return this.renderStatsRot(s)
                    + this.renderStatsConflicts(s)
                    + this.renderStatsSearch(s)
                    + `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(this.t('config.statsHealthTitle', 'Link health'))}</h3>
                        <div id="config-stats-health">${this.renderStatsHealth()}</div>
                    </div>`;
            default:
                return `
                    <div class="config-actions" style="margin-bottom:16px">
                        <button type="button" class="config-btn config-btn--small" data-stats-action="export">${esc(this.t('config.statsExportCsv', 'Export as CSV'))}</button>
                    </div>
                    <div class="config-tiles config-tiles--overview" role="list">
                        ${tile(this.t('config.statsBookmarks', 'Bookmarks'), s.total)}
                        ${tile(this.t('config.statsPages', 'Pages'), s.pages)}
                        ${tile(this.t('config.statsCategoryCount', 'Categories'), s.categories)}
                        ${tile(this.t('config.statsTagCount', 'Distinct tags'), s.tagCount)}
                        ${tile(this.t('config.statsWithShortcut', 'With a shortcut'), s.withShortcut)}
                        ${tile(this.t('config.statsMonitored', 'Monitored'), s.monitored)}
                    </div>
                    ${this.renderStatsHeadline(s)}
                    ${this.renderStatsInsights(s)}
                    ${this.renderStatsScore(s)}`;
        }
    }

    repaintStatsBody() {
        const host = document.getElementById('config-stats-body');
        if (!host) { this.render(); return; }
        host.innerHTML = this.renderStatsBody();
        // The stamp lives outside the body, so it would otherwise keep claiming
        // the time of the first render while the numbers under it were fresh.
        const stamp = host.parentElement?.querySelector('.config-stats-updated');
        if (stamp) stamp.outerHTML = this.renderStatsTimestamp();
        const container = document.getElementById('dashboard-layout');
        if (container) this.bindStats(container);
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
                    <h3 class="config-panel-title">${esc(this.t('config.statsScoreTitle', 'Cleanup score'))}</h3>
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
                <h3 class="config-panel-title">${esc(this.t('config.statsScoreTitle', 'Cleanup score'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.statsScoreHint', 'Starts at 100 and loses points for bookmarks you never open, links gone stale, duplicate URLs and clashing shortcuts.'))}</p>
                <div class="config-score">
                    <span class="config-score-value config-score-value--${tone}">${esc(String(score))}</span>
                    <div class="config-bar" role="img" aria-label="${esc(this.t('config.statsScoreTitle', 'Cleanup score'))}: ${score}/100">
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
                    <h3 class="config-panel-title">${esc(this.t('config.statsActivityTitle', 'Bookmarks used over time'))}</h3>
                    <div class="config-choices" role="group">${ranges}</div>
                    <p class="config-panel-empty">${esc(this.t('config.statsNoActivity', 'No bookmarks were used in this period.'))}</p>
                </div>`;
        }

        const W = 500;
        // 108 = the old 72 plus half again, as the bars were too short to compare
        // neighbouring days by eye.
        const H = 108;
        const gap = 3;
        const n = a.buckets.length;
        const max = Math.max(...a.buckets, 1);
        const barW = Math.max(1, Math.floor((W - gap * (n - 1)) / n));
        const unit = this.statsActivityBucketUnit();
        const bars = a.buckets.map((val, i) => {
            const h = Math.round((val / max) * H);
            const x = i * (barW + gap);
            const opacity = val === 0 ? 0.15 : (0.75 + (val / max) * 0.25).toFixed(2);
            const date = a.dateLabels?.[i] || a.labels[i] || '';
            // The <g> is the hit target, not the painted bar: it spans the full
            // height and half the gap either side, so a short bar — or an empty
            // one — is still reachable. Focusable so the values are on keyboard
            // too, per the same rule that puts them on hover.
            return `<g class="config-chart-bar" tabindex="0" role="listitem"
                       data-bar-date="${esc(date)}" data-bar-value="${esc(String(val))}" data-bar-unit="${esc(unit)}"
                       aria-label="${esc(date)}: ${esc(String(val))} ${esc(this.t('config.statsActivityUsedLabel', 'bookmarks last used'))}">
                <rect class="config-chart-bar-hit" x="${Math.max(0, x - gap / 2)}" y="0" width="${barW + gap}" height="${H}"></rect>
                <rect class="config-chart-bar-fill" x="${x}" y="${H - h}" width="${barW}" height="${Math.max(h, val > 0 ? 2 : 0)}" rx="1" fill="var(--accent-color, #4a90d9)" opacity="${opacity}"></rect>
            </g>`;
        }).join('');
        const summary = a.labels.map((l, i) => `${l}: ${a.buckets[i]}`).join(', ');
        const srRows = a.labels.map((l, i) =>
            `<tr><th scope="row">${esc(l)}</th><td>${esc(String(a.buckets[i]))}</td></tr>`).join('');

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsActivityTitle', 'Bookmarks used over time'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.statsActivityNote', 'Each bar counts the bookmarks whose last use falls in that period. A bookmark appears once, on the day you last opened it.'))}</p>
                <div class="config-choices" role="group">${ranges}</div>
                <div class="config-stat-figures">
                    <span><strong>${esc(String(a.activeCount))}</strong> ${esc(this.t('config.statsActivityActive', 'bookmarks used'))}</span>
                    <span title="${esc(this.t('config.statsActivityLifetimeHint', 'Counted over the whole life of these bookmarks, not only this period — nextDash stores a total per bookmark, not a date for every open.'))}"><strong>${esc(String(a.totalOpens))}</strong> ${esc(this.t('config.statsActivityLifetimeOpens', 'opens all-time'))}</span>
                    ${a.wow !== null ? `<span class="config-stat-trend config-stat-trend--${a.wow >= 0 ? 'up' : 'down'}">${a.wow >= 0 ? '▲' : '▼'} ${esc(String(Math.abs(a.wow)))}% ${esc(this.t('config.statsActivityVsPrev', 'vs previous period'))}</span>` : ''}
                </div>
                <div class="config-chart">
                    <div class="config-chart-plot">
                        <span class="config-chart-axis-y" aria-hidden="true">
                            <span class="config-chart-axis-title">${esc(this.t('config.statsAxisBookmarksUsed', 'Bookmarks'))}</span>
                            <span class="config-chart-axis-ticks">
                                <span>${esc(String(max))}</span>
                                <span>0</span>
                            </span>
                        </span>
                        <span class="config-chart-plot-area">
                            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="list"
                                 aria-label="${esc(this.t('config.statsSparklineAriaView', 'Bookmarks last used per period'))}: ${esc(summary)}">${bars}</svg>
                            <span class="config-chart-ticks" aria-hidden="true">${this.statsActivityTicks(a)}</span>
                        </span>
                    </div>
                    <p class="config-chart-axis-x" aria-hidden="true">${esc(this.statsActivityAxisXLabel())}</p>
                    <div class="config-chart-tip" role="status" aria-live="polite" hidden></div>
                </div>
                <table class="config-sr-only">
                    <caption>${esc(this.t('config.statsSparklineTableCaptionView', 'Bookmarks last used per period'))}</caption>
                    <tbody>${srRows}</tbody>
                </table>
            </div>`;
    }

    statsRangeLabel(days) {
        if (days === 365) return this.t('config.statsRangeYear', '1 year');
        return this.t('config.statsRangeDays', '{n} days').replace('{n}', String(days));
    }

    /** The noun for one bucket, used in the tooltip's date line. */
    statsActivityBucketUnit() {
        const days = this.statsRange || 30;
        if (days <= 30) return this.t('config.statsAxisUnitDay', 'day');
        if (days <= 90) return this.t('config.statsAxisUnitWeek', 'week');
        return this.t('config.statsAxisUnitMonth', 'month');
    }

    /**
     * Dated ticks along the x-axis.
     *
     * The axis used to carry only its two end-caps, so a bar in the middle sat
     * above no date at all. A handful of evenly spaced dates is enough to place
     * any bar by eye, and the tooltip gives the exact one.
     *
     * How many fit depends on how wide they are, not on the bar count: a daily
     * label is "Jul 6" but a weekly one is "Jul 29 – Aug 4", three times the
     * width. Six of those ran into each other and off the panel, so the cap is
     * derived from the longest label rather than fixed.
     */
    statsActivityTicks(a) {
        const esc = (v) => this.dash.escapeHtml(v);
        const dates = a.dateLabels || [];
        const n = dates.length;
        if (!n) return '';
        // ~500px of plot at roughly 6px per character, plus a gap, is how many
        // labels of this width can sit side by side without touching.
        const widest = dates.reduce((w, d) => Math.max(w, String(d).length), 0);
        const fits = Math.floor(500 / (widest * 6 + 16));
        const maxTicks = Math.max(2, Math.min(6, fits, n));
        const step = Math.max(1, Math.round((n - 1) / Math.max(1, maxTicks - 1)));
        const picked = [];
        for (let i = 0; i < n; i += step) picked.push(i);
        // The last bar is the one people look for ("where does it end?"), so it
        // is always labelled even when the stride would have skipped it.
        if (picked[picked.length - 1] !== n - 1) picked.push(n - 1);
        const last = picked.length - 1;
        return picked.map((i, k) => {
            const pct = n === 1 ? 50 : (i / (n - 1)) * 100;
            // Centring every label would push the first one off the left edge
            // and the last one past the right — visible as a date hanging
            // outside the panel. The end labels anchor to their own edge
            // instead; only the middle ones centre on their bar.
            const edge = k === 0 ? ' config-chart-tick--first'
                : k === last ? ' config-chart-tick--last' : '';
            return `<span class="config-chart-tick${edge}" style="left:${pct.toFixed(2)}%">${esc(dates[i])}</span>`;
        }).join('');
    }

    /**
     * What one bar covers, which the selected range decides.
     *
     * computeActivity() buckets by day, week or month depending on the range, so
     * a fixed "Date" would be wrong two times out of three — the whole reason to
     * name the axis is to say what a bar actually is.
     */
    statsActivityAxisXLabel() {
        const days = this.statsRange || 30;
        if (days <= 30) return this.t('config.statsAxisPerDay', 'Day (oldest → newest)');
        if (days <= 90) return this.t('config.statsAxisPerWeek', 'Week (oldest → newest)');
        return this.t('config.statsAxisPerMonth', 'Month (oldest → newest)');
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
                ${this.statsScaleCaption(this.t('config.statsAxisShareOfCollection',
                    'Share of all {total} bookmarks — 0% to 100%').replace('{total}', String(s.total)))}
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

        // axis: [what the rows are, what the bar measures]. The two callers count
        // different things, so neither the label nor the measure can be hardcoded.
        const rankedList = (title, rows, emptyText, hint, axis, total) => {
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
                    ${axis ? this.statsListAxisHeader(axis[0], axis[1]) : ''}
                    <ul class="config-dist-list">${items}</ul>
                    ${this.statsListTruncationNote(rows.length, total)}
                </div>`;
        };

        // Never-opened is a plain list: its second column is a URL, not a count,
        // so there is nothing to scale a bar against.
        const plainList = (title, rows, emptyText, hint, total, cleanupKey) => {
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
                    ${this.statsListTruncationNote(rows.length, total, cleanupKey)}
                </div>`;
        };

        const totals = s.listTotals || {};
        return rankedList(this.t('config.statsTopOpened', 'Most opened'), s.topOpened,
                this.t('config.statsNoOpens', 'Nothing has been opened yet.'), '',
                [this.t('config.statsAxisBookmark', 'Bookmark'), this.t('config.statsAxisOpens', 'Opens')],
                totals.topOpened)
            + rankedList(this.t('config.statsTopTags', 'Most used tags'), s.topTags,
                this.t('config.noTagsYet', 'No tags yet.'), '',
                [this.t('config.statsAxisTag', 'Tag'), this.t('config.statsAxisBookmarks', 'Bookmarks')],
                totals.topTags)
            // 'never' is the cleanup filter that reproduces this list in full,
            // so the panel can hand off the rows it could not show.
            + plainList(this.t('config.statsNeverOpenedTitle', 'Never opened'), s.neverOpenedList,
                this.t('config.statsAllOpened', 'Everything has been opened at least once.'),
                this.t('config.statsNeverOpenedHint', 'Candidates to tidy up — they have never been used.'),
                totals.neverOpened, 'never');
    }

    /**
     * Column header for the bar lists, naming what the label column and the
     * measure column hold.
     *
     * These lists are not x/y plots, so they have no axes to title — but they
     * have the same problem an unlabelled axis has: a name, a bar and a number,
     * with nothing saying what the number counts. This is the equivalent
     * header, and it doubles as the list's own axis legend.
     */
    /**
     * One-line caption naming the scale a set of full-width bars is drawn on.
     *
     * For the panels where every bar shares one axis (coverage is 0–100% of the
     * collection), so the scale is stated once above them rather than repeated
     * on each row.
     */
    statsScaleCaption(text) {
        return `<p class="config-chart-scale" aria-hidden="true">${this.dash.escapeHtml(text)}</p>`;
    }

    /**
     * The same caption pair for the label/value lists that have no bar column.
     *
     * .config-stat-detail is a two-column flex row, not the three-column grid
     * .config-dist-row uses, so its header has to match that shape or the
     * measure name lands over the wrong column.
     */
    statsPairAxisHeader(labelText, valueText) {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-dist-axis config-dist-axis--pair" aria-hidden="true">
                <span>${esc(labelText)}</span>
                <span>${esc(valueText)}</span>
            </div>`;
    }

    /**
     * "20 of 214 shown" under a list that had to cut off.
     *
     * These panels are leaderboards, so cutting off is right — but saying
     * nothing was not. "Never opened" is the clearest case: it heads itself
     * "candidates to tidy up", showed twenty rows, and let you believe that was
     * all, while the cleanup panel beside it counted two hundred.
     *
     * Where a cleanup filter can reproduce the list in full, the note carries
     * the button that does it rather than leaving the rest unreachable.
     */
    statsListTruncationNote(shown, total, cleanupKey) {
        const count = Number(total) || 0;
        if (!shown || count <= shown) return '';
        const esc = (v) => this.dash.escapeHtml(v);
        const text = this.t('config.statsListTruncated', '{shown} of {total} shown')
            .replace('{shown}', String(shown)).replace('{total}', String(count));
        const button = cleanupKey && DashboardConfig.CLEANUP_FILTERS[cleanupKey]
            ? `<button type="button" class="config-btn config-btn--small" data-cleanup-goto="${esc(cleanupKey)}">${esc(this.t('config.statsListShowAll', 'Show all in bookmarks'))}</button>`
            : '';
        return `
            <div class="config-list-truncated">
                <span>${esc(text)}</span>
                ${button}
            </div>`;
    }

    statsListAxisHeader(labelText, valueText) {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-dist-axis" aria-hidden="true">
                <span class="config-dist-axis-label">${esc(labelText)}</span>
                <span class="config-dist-axis-value">${esc(valueText)}</span>
            </div>`;
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
                ${this.statsListAxisHeader(
                    this.t('config.statsAxisPage', 'Page'),
                    this.t('config.statsAxisBookmarks', 'Bookmarks'))}
                <ul class="config-dist-list">${rows(s.perPage)}</ul>
            </div>
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsPerCategory', 'Bookmarks per category'))}</h3>
                ${this.statsListAxisHeader(
                    this.t('config.statsAxisCategory', 'Category'),
                    this.t('config.statsAxisBookmarks', 'Bookmarks'))}
                <ul class="config-dist-list">${rows(s.perCategory)}</ul>
            </div>`;
    }

    /**
     * Opens per bookmark, per category — which shelves you actually reach for.
     *
     * The neighbouring "bookmarks per category" panel measures size, and size
     * alone hides the interesting case: a category holding twenty links that
     * nobody opens looks healthy there and empty here. Sorted by the ratio
     * rather than the total for the same reason.
     */
    renderStatsCategoryEffectiveness(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const list = s.categoryEffectiveness || [];
        if (!list.length) {
            return '';
        }
        const max = Math.max(...list.map((c) => c.perBookmark), 0);
        const rows = list.map((c) => {
            const pct = max > 0 ? Math.round((c.perBookmark / max) * 100) : 0;
            const ratio = c.perBookmark.toFixed(1);
            const detail = this.t('config.statsCategoryEffDetail', '{opens} opens over {count} bookmarks')
                .replace('{opens}', String(c.opens))
                .replace('{count}', String(c.count));
            return `
                <li class="config-dist-row">
                    <span class="config-dist-label" title="${esc(detail)}">${esc(c.label)}</span>
                    <div class="config-bar config-bar--slim" role="img" aria-label="${esc(c.label)}: ${esc(ratio)}">
                        <span class="config-bar-fill" style="width:${pct}%"></span>
                    </div>
                    <span class="config-dist-count" title="${esc(detail)}">${esc(ratio)}</span>
                </li>`;
        }).join('');
        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsCategoryEffTitle', 'Opens per bookmark, by category'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.statsCategoryEffNote', 'How often a bookmark in this category gets opened. A low figure on a large category is one you built but do not use.'))}</p>
                ${this.statsListAxisHeader(
                    this.t('config.statsAxisCategory', 'Category'),
                    this.t('config.statsAxisOpensPerBookmark', 'Opens per bookmark'))}
                <ul class="config-dist-list">${rows}</ul>
            </div>`;
    }

    /**
     * What share of all opens the busiest bookmarks account for.
     *
     * Answers a question none of the per-bookmark figures can: whether the
     * collection is used broadly or is really a handful of links surrounded by
     * everything else.
     */
    renderStatsConcentration(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const c = s.concentration || {};
        if (!c.totalOpens) {
            // Returning '' left a gap between two panels, which reads as a
            // rendering fault rather than as "you have not opened anything yet".
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsConcentrationTitle', 'Where your usage sits'))}</h3>
                    <p class="config-panel-empty">${esc(this.t('config.statsConcentrationEmpty', 'Nothing has been opened yet, so there is no usage to weigh up.'))}</p>
                </div>`;
        }
        const sentence = this.t(
            'config.statsConcentrationBody',
            'Your top {top} bookmarks account for {share}% of all {total} opens.'
        ).replace('{top}', String(c.topCount)).replace('{share}', String(c.share)).replace('{total}', String(c.totalOpens));
        const rest = Math.max(0, c.usedCount - c.topCount);
        const restText = this.t('config.statsConcentrationRest', 'The other {n} used bookmarks share the remaining {pct}%.')
            .replace('{n}', String(rest)).replace('{pct}', String(100 - c.share));
        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsConcentrationTitle', 'Where your usage sits'))}</h3>
                ${this.statsScaleCaption(this.t('config.statsAxisShareOfOpens',
                    'Share of all {total} opens — 0% to 100%').replace('{total}', String(c.totalOpens)))}
                <div class="config-ratio">
                    <div class="config-ratio-head">
                        <span class="config-ratio-label">${esc(this.t('config.statsConcentrationTop', 'Top {n}').replace('{n}', String(c.topCount)))}</span>
                        <span class="config-ratio-value">${esc(String(c.topOpens))} / ${esc(String(c.totalOpens))} · ${esc(String(c.share))}%</span>
                    </div>
                    <div class="config-bar" role="img" aria-label="${esc(sentence)}">
                        <span class="config-bar-fill" style="width:${esc(String(c.share))}%"></span>
                    </div>
                </div>
                <p class="config-panel-note">${esc(sentence)}${rest > 0 ? ` ${esc(restText)}` : ''}</p>
            </div>`;
    }

    /**
     * Cleanup candidates, each with a button that opens the list behind it.
     *
     * A count on its own is a dead end — the work is always "show me those and
     * let me fix them", and the bookmarks section already has bulk tagging and
     * deletion. Rows with nothing to fix are dropped rather than shown as a
     * zero, so the panel is a to-do list and not a scoreboard.
     */
    renderStatsCleanup(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const rows = [
            ['never', s.neverOpened, this.t('config.statsCleanupNeverHint', 'Added but never used')],
            ['once', s.openedOnce, this.t('config.statsCleanupOnceHint', 'Tried once, then dropped')],
            ['untagged', s.untagged, this.t('config.statsCleanupUntaggedHint', 'Harder to find by search')],
            ['insecure', s.insecure, this.t('config.statsCleanupInsecureHint', 'Plain http, no encryption')],
            ['noicon', s.missingIcon, this.t('config.statsCleanupNoIconHint', 'Falls back to a letter tile')],
        ].filter(([, n]) => Number(n) > 0);

        if (!rows.length) {
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsCleanupTitle', 'Cleanup candidates'))}</h3>
                    <p class="config-panel-empty">${esc(this.t('config.statsCleanupNone', 'Nothing to tidy up.'))}</p>
                </div>`;
        }

        const items = rows.map(([key, n, hint]) => `
            <li class="config-stat-detail">
                <span>${esc(this.cleanupFilterLabel(key))} — <span class="config-stat-sub">${esc(hint)}</span></span>
                <span class="config-cleanup-actions">
                    <span class="config-stat-penalty">${esc(String(n))}</span>
                    <button type="button" class="config-btn config-btn--small" data-cleanup-goto="${esc(key)}">${esc(this.t('config.statsCleanupShow', 'Show'))}</button>
                </span>
            </li>`).join('');

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsCleanupTitle', 'Cleanup candidates'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.statsCleanupNote', 'Each opens the matching bookmarks, where they can be tagged or removed in bulk.'))}</p>
                <ul class="config-stat-details">${items}</ul>
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
                <h3 class="config-panel-title">${esc(this.t('config.statsRotTitle', 'Link rot & clashes'))}</h3>
                <ul class="config-stat-details">
                    ${line(this.t('config.statsNeverOpened', 'Never opened'), s.neverOpened)}
                    ${line(this.t('config.statsStale90', 'Not opened in 90 days'), s.stale90)}
                    ${line(this.t('config.statsUntagged', 'Untagged'), s.total - s.tagged)}
                </ul>
            </div>`;
    }

    /**
     * How this collection is actually used, in one line.
     *
     * Everything below already states facts — 94% has a shortcut, 12% is
     * tagged, the top ten account for 43% of opens — but each sits on a
     * different tab, so the conclusion they add up to was never drawn anywhere.
     * This says which way of reaching for a bookmark is yours, which is the one
     * thing a stats page ought to be able to answer at a glance.
     *
     * Deliberately one claim, not a second list: the insights panel underneath
     * already enumerates, and repeating it louder would not be a summary.
     */
    renderStatsHeadline(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const all = this.dash.allBookmarks || [];
        const total = all.length;
        if (!total) return '';

        const shortcutPct = Math.round((s.withShortcut / total) * 100);
        const taggedPct = Math.round((s.tagged / total) * 100);
        const concentration = s.concentration || {};
        const share = Number(concentration.share) || 0;
        const everOpened = Number(concentration.usedCount) || 0;

        // Ordered by how much each says about a habit, so the strongest signal
        // wins rather than whichever happens to be first.
        let text;
        if (everOpened === 0) {
            text = this.t('config.statsHeadlineUnused',
                'Nothing has been opened yet, so there is no habit to read from this collection.');
        } else if (shortcutPct >= 60 && shortcutPct > taggedPct) {
            text = this.t('config.statsHeadlineShortcuts',
                'You reach for bookmarks by keystroke: {pct}% carry a shortcut, against {tagPct}% carrying tags.')
                .replace('{pct}', String(shortcutPct)).replace('{tagPct}', String(taggedPct));
        } else if (taggedPct >= 60) {
            text = this.t('config.statsHeadlineTags',
                'You organise by tag: {pct}% of bookmarks carry one, against {shortcutPct}% carrying a shortcut.')
                .replace('{pct}', String(taggedPct)).replace('{shortcutPct}', String(shortcutPct));
        } else if (share >= 50) {
            text = this.t('config.statsHeadlineNarrow',
                'A narrow habit on a broad collection: your busiest {top} bookmarks account for {share}% of all opens.')
                .replace('{top}', String(concentration.topCount)).replace('{share}', String(share));
        } else {
            text = this.t('config.statsHeadlineBroad',
                'Your usage is spread out: {used} of {total} bookmarks have been opened, with no small group dominating.')
                .replace('{used}', String(everOpened)).replace('{total}', String(total));
        }

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsHeadlineTitle', 'How you use this collection'))}</h3>
                <p class="config-stats-headline">${esc(text)}</p>
            </div>`;
    }

    /**
     * Personal usage insights: the numbers already on the page, read back as
     * sentences with somewhere to go next.
     *
     * Carried over from the old config, including its thresholds — most-active
     * page, top bookmark, never-opened share, status coverage, and whether
     * anything was opened in the last 48 hours.
     */
    renderStatsInsights(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const all = this.dash.allBookmarks || [];
        const total = all.length;
        if (!total) {
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsInsightsSection', 'Personal usage insights'))}</h3>
                    <p class="config-panel-empty">${esc(this.t('config.statsNoData', 'No data yet'))}</p>
                </div>`;
        }

        const pageName = (id) => (this.dash.pages || [])
            .find((p) => String(p.id) === String(id))?.name || String(id);
        const pageOpens = new Map();
        all.forEach((b) => {
            const pid = String(b.pageId);
            pageOpens.set(pid, (pageOpens.get(pid) || 0) + (Number(b.openCount) || 0));
        });
        const topPage = [...pageOpens.entries()].sort((a, b) => b[1] - a[1])[0];
        const topBm = [...all].sort((a, b) => (Number(b.openCount) || 0) - (Number(a.openCount) || 0))[0];
        const neverOpened = all.filter((b) => !Number(b.openCount) && !Number(b.lastOpened)).length;
        const statusCount = all.filter((b) => b.checkStatus === true).length;
        const recent = all.filter((b) => Number(b.lastOpened || 0) >= Date.now() - 48 * 3600000).length;
        const pct = (n) => String(Math.round((n / total) * 100));

        const items = [];
        if (topPage && topPage[1] > 0) {
            items.push({
                text: this.t('config.statsInsightTopPage', 'Most activity happens on {page} with {opens} opens.')
                    .replace('{page}', pageName(topPage[0])).replace('{opens}', String(topPage[1])),
                tab: 'content',
            });
        }
        if (topBm && Number(topBm.openCount) > 0) {
            items.push({
                text: this.t('config.statsInsightTopBookmark', 'Top bookmark is "{name}" with {count} opens.')
                    .replace('{name}', String(topBm.name || '—')).replace('{count}', String(Number(topBm.openCount))),
                tab: 'activity',
            });
        }
        if (neverOpened > 0) {
            items.push({
                text: this.t('config.statsInsightNeverOpened', '{percent}% ({count}/{total}) of bookmarks are never opened yet.')
                    .replace('{percent}', pct(neverOpened)).replace('{count}', String(neverOpened)).replace('{total}', String(total)),
                tab: 'health',
            });
        }
        items.push({
            text: this.t('config.statsInsightStatusCoverage', 'Status checks are enabled for {percent}% ({count}/{total}) of bookmarks.')
                .replace('{percent}', pct(statusCount)).replace('{count}', String(statusCount)).replace('{total}', String(total)),
        });
        items.push(recent > 0
            ? {
                text: this.t('config.statsInsightRecentActivity', '{count} bookmarks were opened in the last 48 hours.')
                    .replace('{count}', String(recent)),
                tab: 'activity',
            }
            : { text: this.t('config.statsInsightNoRecent', 'No bookmark opens recorded in the last 48 hours.') });

        const rows = items.map((it) => `
            <li class="config-stat-detail">
                <span>${esc(it.text)}</span>
                ${it.tab ? `<button type="button" class="config-btn config-btn--small" data-stats-goto="${esc(it.tab)}">${esc(this.statsTabLabel(it.tab))}</button>` : ''}
            </li>`).join('');

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsInsightsSection', 'Personal usage insights'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.statsInsightsIntro', 'Quick interpretation of your usage patterns.'))}</p>
                <ul class="config-stat-details">${rows}</ul>
            </div>`;
    }

    /** Shortcut coverage, and which shortcuts actually earn their keystroke. */
    renderStatsShortcuts(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const all = this.dash.allBookmarks || [];
        const pageName = (id) => (this.dash.pages || [])
            .find((p) => String(p.id) === String(id))?.name || String(id);
        const rows = all
            .filter((b) => String(b.shortcut || '').trim())
            .sort((a, b) => (Number(b.openCount) || 0) - (Number(a.openCount) || 0))
            .slice(0, 20)
            .map((b) => `
                <tr>
                    <th scope="row">${esc(String(b.shortcut).toUpperCase())}</th>
                    <td>${esc(b.name || '—')}</td>
                    <td>${esc(String(Number(b.openCount) || 0))}</td>
                    <td>${esc(pageName(b.pageId))}</td>
                </tr>`).join('');

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsShortcutsTitle', 'Shortcuts'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.statsShortcutCoverage', '{count} of {total} bookmarks have a shortcut ({pct}%)')
                    .replace('{count}', String(s.withShortcut))
                    .replace('{total}', String(s.total))
                    .replace('{pct}', String(s.total ? Math.round((s.withShortcut / s.total) * 100) : 0)))}</p>
                ${rows ? `
                <h4 class="config-theme-group-title">${esc(this.t('config.statsSubTopShortcuts', 'Top shortcuts by opens'))}</h4>
                <table class="config-stats-table">
                    <thead><tr>
                        <th scope="col">${esc(this.t('config.statsColShortcut', 'Shortcut'))}</th>
                        <th scope="col">${esc(this.t('config.statsColBookmark', 'Bookmark'))}</th>
                        <th scope="col">${esc(this.t('config.statsColOpens', 'Opens'))}</th>
                        <th scope="col">${esc(this.t('config.statsColPage', 'Page'))}</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>` : `<p class="config-panel-empty">${esc(this.t('config.statsNoData', 'No data yet'))}</p>`}
            </div>`;
    }

    /**
     * Finders, with their use counts. Loaded separately because finders are not
     * part of the bookmark set the rest of the stats derive from.
     */
    renderStatsFinders() {
        const esc = (v) => this.dash.escapeHtml(v);
        if (this._statsFinders === undefined) {
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsFindersTitle', 'Finders'))}</h3>
                    <p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>
                </div>`;
        }
        const finders = this._statsFinders || [];
        const totalUses = finders.reduce((n, f) => n + (Number(f.useCount) || 0), 0);
        const withShortcut = finders.filter((f) => String(f.shortcut || '').trim()).length;
        const rows = [...finders]
            .sort((a, b) => (Number(b.useCount) || 0) - (Number(a.useCount) || 0))
            .slice(0, 20)
            .map((f) => `
                <tr>
                    <th scope="row">${esc(f.name || '—')}</th>
                    <td>${esc(String(f.shortcut || '—'))}</td>
                    <td>${esc(String(Number(f.useCount) || 0))}</td>
                </tr>`).join('');

        // One accessible name per tile; see the overview tile for why.
        const tile = (label, value) => `
            <div class="config-tile" role="listitem" aria-label="${esc(label)}: ${esc(String(value))}">
                <span class="config-tile-label" aria-hidden="true">${esc(label)}</span>
                <span class="config-tile-value" aria-hidden="true">${esc(String(value))}</span>
            </div>`;

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsFindersTitle', 'Finders'))}</h3>
                <div class="config-tiles" role="list">
                    ${tile(this.t('config.statsFindersTotal', 'Finders total'), finders.length)}
                    ${tile(this.t('config.statsFindersUsesTotal', 'Total finder uses'), totalUses)}
                    ${tile(this.t('config.statsFindersWithShortcut', 'With shortcut'), withShortcut)}
                </div>
                ${rows ? `
                <h4 class="config-theme-group-title">${esc(this.t('config.statsSubTopFinders', 'Top finders by use count'))}</h4>
                <table class="config-stats-table">
                    <thead><tr>
                        <th scope="col">${esc(this.t('config.statsColName', 'Name'))}</th>
                        <th scope="col">${esc(this.t('config.statsColShortcut', 'Shortcut'))}</th>
                        <th scope="col">${esc(this.t('config.statsColUses', 'Uses'))}</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>` : `<p class="config-panel-empty">${esc(this.t('config.findersEmpty', 'No finders yet.'))}</p>`}
            </div>`;
    }

    /** Finders are their own resource, so the stats view fetches them itself. */
    async loadStatsFinders() {
        try {
            const res = await fetch('/api/finders');
            const data = res && res.ok ? await res.json() : [];
            this._statsFinders = Array.isArray(data) ? data : [];
        } catch {
            this._statsFinders = [];
        }
        if (this.isActiveView() && this.section === 'stats' && this.statsTab === 'activity') {
            const host = document.getElementById('config-stats-finders');
            if (host) host.innerHTML = this.renderStatsFinders();
        }
    }

    /**
     * Conflicts & duplicates, with the offending values named.
     *
     * "3 duplicate URLs" tells you there is a problem; naming them tells you
     * which. The old config capped the list at eight and counted the rest, which
     * keeps a badly duplicated install from filling the panel.
     */
    renderStatsConflicts(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const CAP = 8;
        const more = (n) => (n > CAP
            ? this.t('config.statsConflictMore', ' +{count} more').replace('{count}', String(n - CAP))
            : '');

        const dupes = s.duplicateUrlList || [];
        const clashes = s.shortcutConflictList || [];

        let detail;
        if (!dupes.length && !clashes.length) {
            detail = `<p class="config-panel-empty">${esc(this.t('config.statsNoConflictsFound', 'No conflicts found.'))}</p>`;
        } else {
            const parts = [];
            if (dupes.length) {
                const labels = dupes.slice(0, CAP).map(([url, c]) => {
                    const display = url.length > 50 ? `${url.slice(0, 47)}…` : url;
                    return `${display} (×${c})`;
                }).join(', ');
                parts.push(`<p class="config-field-hint">${esc(this.t('config.statsDuplicateUrlsDetail', 'Duplicate URLs: {labels}{more}')
                    .replace('{labels}', labels).replace('{more}', more(dupes.length)))}</p>`);
            }
            if (clashes.length) {
                const labels = clashes.slice(0, CAP).map(([sc, c]) => `${sc} (×${c})`).join(', ');
                parts.push(`<p class="config-field-hint">${esc(this.t('config.statsConflictingShortcuts', 'Conflicting shortcuts: {labels}{more}')
                    .replace('{labels}', labels).replace('{more}', more(clashes.length)))}</p>`);
            }
            detail = parts.join('');
        }

        const line = (label, n) => `
            <li class="config-stat-detail${n > 0 ? ' config-stat-detail--warn' : ''}">
                <span>${esc(label)}</span>
                <span class="config-stat-penalty">${esc(String(n))}</span>
            </li>`;

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsConflictsTitle', 'Conflicts & duplicates'))}</h3>
                <ul class="config-stat-details">
                    ${line(this.t('config.statsDuplicateUrls', 'Duplicate URLs'), s.duplicateUrls)}
                    ${line(this.t('config.statsShortcutConflicts', 'Shortcut conflicts'), s.shortcutConflicts)}
                </ul>
                ${detail}
                ${(dupes.length || clashes.length) ? `
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--small" data-stats-action="open-health">${esc(this.t('config.statsOpenInHealth', 'Open in Health'))}</button>
                </div>` : ''}
            </div>`;
    }

    /**
     * Search & status: which search behaviours are on, and how much of the
     * collection opts into availability checking. These are settings rather
     * than derived counts, so they read from settings directly.
     */
    renderStatsSearch(s) {
        const esc = (v) => this.dash.escapeHtml(v);
        const set = this.dash.settings || {};
        const yes = this.t('config.statsYes', 'Yes');
        const no = this.t('config.statsNo', 'No');
        const onOff = (v) => (v ? yes : no);

        const row = (label, value) => `
            <li class="config-stat-detail">
                <span>${esc(label)}</span>
                <span class="config-stat-penalty">${esc(String(value))}</span>
            </li>`;

        // Whether the search component actually loaded — the honest signal, and
        // the only one there is now that the unused index endpoint is gone.
        const searchReady = Boolean(this.dash.searchComponent);

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsSearchTitle', 'Search & status'))}</h3>
                <ul class="config-stat-details">
                    ${row(this.t('config.statsSearchReady', 'Search ready'), onOff(searchReady))}
                    ${row(this.t('config.statsInterleave', 'Interleave search mode'), onOff(set.interleaveMode))}
                    ${row(this.t('config.statsFuzzy', 'Fuzzy suggestions'), onOff(set.enableFuzzySuggestions !== false))}
                    ${row(this.t('config.statsShowStatus', 'Status monitor enabled'), onOff(set.showStatus !== false))}
                    ${row(this.t('config.statsStatusCheckBookmarks', 'Bookmarks with status check'), s.checked)}
                    ${row(this.t('config.statsMonitored', 'Monitored'), s.monitored)}
                </ul>
            </div>`;
    }

    /**
     * Everything derivable from the shell's own bookmark/page copies, including
     * the cleanup score and the activity buckets.
     */
    /**
     * Labels a `pageId::category` key for the statistics panels.
     *
     * knownCategories() is page-scoped — it reads bmPageFilter — so calling it
     * here would label against whatever filter the Bookmarks section was left
     * on. This walks every page instead, and only prefixes the page name when
     * the same category name exists on more than one page: without that, every
     * row on a single-page install would read "main · Development".
     */
    statsCategoryLabeller() {
        const labels = new Map();
        const nameCounts = new Map();
        (this.dash.pages || []).forEach((p) => {
            this.knownCategories(p.id).forEach((c) => {
                const key = DashboardConfig.categoryFilterKey(p.id, c.id);
                if (labels.has(key)) return;
                labels.set(key, { name: c.label, page: this.pageLabel(p.id) });
                nameCounts.set(c.label, (nameCounts.get(c.label) || 0) + 1);
            });
        });
        return (key) => {
            const hit = labels.get(key);
            // A category whose page is gone still has bookmarks pointing at it,
            // so fall back to the bare name rather than showing "p2::dev".
            if (!hit) return DashboardConfig.parseCategoryFilter(key).categoryId || String(key);
            return (nameCounts.get(hit.name) || 0) > 1 ? `${hit.page} · ${hit.name}` : hit.name;
        };
    }

    computeStats() {
        const all = this.dash.allBookmarks || [];
        const pages = this.dash.pages || [];
        const total = all.length;

        const tagCounts = new Map();
        const categoryKeys = new Set();
        const perCategoryCount = new Map();
        const perCategoryOpens = new Map();
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
                // Key on page::category, not on the bare category name. The
                // Categories tile already counted that way, so keying the panels
                // on the name alone merged "Development" on one page with the
                // same name on another — the tile said 2 while the panel below
                // showed one row, and its opens-per-bookmark averaged two
                // unrelated categories together.
                const key = DashboardConfig.categoryFilterKey(b.pageId, b.category);
                categoryKeys.add(key);
                perCategoryCount.set(key, (perCategoryCount.get(key) || 0) + 1);
                perCategoryOpens.set(key, (perCategoryOpens.get(key) || 0) + Number(b.openCount || 0));
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

        // Both the counts and the offending values: naming what clashes is what
        // makes the number actionable, which is how the old config showed it.
        const duplicateUrlList = [...urlCounts.entries()].filter(([, c]) => c > 1)
            .sort((a, b) => b[1] - a[1]);
        const shortcutConflictList = [...shortcutCounts.entries()].filter(([, c]) => c > 1)
            .sort((a, b) => b[1] - a[1]);
        const duplicateUrls = duplicateUrlList.length;
        const shortcutConflicts = shortcutConflictList.length;

        const catLabel = this.statsCategoryLabeller();
        const perCategory = [...perCategoryCount.entries()]
            .map(([id, n]) => [catLabel(id), n])
            .sort((a, b) => b[1] - a[1]);

        // Opens per bookmark, per category. The raw open total just restates
        // which categories are biggest; dividing by size is what exposes a
        // category you built and then never used.
        const categoryEffectiveness = [...perCategoryCount.entries()]
            .map(([id, n]) => ({
                label: catLabel(id),
                count: n,
                opens: perCategoryOpens.get(id) || 0,
                perBookmark: n > 0 ? (perCategoryOpens.get(id) || 0) / n : 0,
            }))
            .sort((a, b) => b.perBookmark - a.perBookmark);

        const perPage = pages.map((p) => [
            p.name || String(p.id),
            all.filter((b) => String(b.pageId) === String(p.id)).length,
        ]);

        // The ranked panels show a leaderboard, not the whole collection, so
        // they cut off — but the count behind each cut is carried alongside, or
        // a panel headed "candidates to tidy up" silently claims there are ten
        // when there are two hundred, contradicting the cleanup panel next to it.
        const LIST_LIMIT = DashboardConfig.STATS_LIST_LIMIT;
        const topTagsAll = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
        const topTags = topTagsAll.slice(0, LIST_LIMIT);
        const topOpenedAll = all
            .filter((b) => Number(b.openCount || 0) > 0)
            .sort((a, b) => Number(b.openCount || 0) - Number(a.openCount || 0))
            .map((b) => [b.name || b.url, Number(b.openCount || 0)]);
        const topOpened = topOpenedAll.slice(0, LIST_LIMIT);
        const neverOpenedAll = all
            .filter((b) => !Number(b.openCount || 0) && !Number(b.lastOpened || 0))
            .map((b) => [b.name || b.url, b.url]);
        const neverOpenedList = neverOpenedAll.slice(0, LIST_LIMIT);
        const listTotals = {
            topTags: topTagsAll.length,
            topOpened: topOpenedAll.length,
            neverOpened: neverOpenedAll.length,
        };

        // How much of the total usage the busiest handful accounts for. A high
        // share means the collection is broad but the habit is narrow, which no
        // per-bookmark figure shows.
        const openTotals = all.map((b) => Number(b.openCount || 0)).filter((n) => n > 0)
            .sort((a, b) => b - a);
        const totalOpens = openTotals.reduce((sum, n) => sum + n, 0);
        const topSlice = openTotals.slice(0, 10).reduce((sum, n) => sum + n, 0);
        const concentration = {
            totalOpens,
            topCount: Math.min(10, openTotals.length),
            topOpens: topSlice,
            share: totalOpens > 0 ? Math.round((topSlice / totalOpens) * 100) : 0,
            usedCount: openTotals.length,
        };

        // Cleanup candidates, each a filter the bookmarks list can reproduce.
        const openedOnce = all.filter((b) => Number(b.openCount || 0) === 1).length;
        const untagged = all.filter((b) => !(Array.isArray(b.tags) && b.tags.length)).length;
        const insecure = all.filter((b) => /^http:\/\//i.test(String(b.url || ''))).length;
        const missingIcon = all.filter((b) => !String(b.icon || '').trim()).length;

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
            duplicateUrlList,
            shortcutConflictList,
            perPage,
            perCategory,
            categoryEffectiveness,
            concentration,
            openedOnce,
            untagged,
            insecure,
            missingIcon,
            topTags,
            topOpened,
            neverOpenedList,
            listTotals,
            // Untruncated, for the CSV: an export that quietly stops at 20 rows
            // is worse than no export, because it looks complete.
            topTagsAll,
            topOpenedAll,
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
     * Bookmarks last used, bucketed over the chosen range. Buckets are days for
     * a week or a month and weeks beyond that, so the bar count stays readable.
     *
     * Each bookmark counts once, in the bucket holding its lastOpened. It used
     * to add its whole openCount there instead, which put a lifetime of use on
     * a single day: a link opened 100 times over a year, last touched on
     * Tuesday, drew a bar of 100 on Tuesday. The chart called itself "opens over
     * time" while showing no such thing.
     *
     * A real opens-per-day series is not derivable here — a bookmark stores one
     * lastOpened and a cumulative openCount, with no per-open history anywhere
     * (the activity log is a diagnostic file, not a queryable series). So the
     * chart now measures what the data can actually answer: how many bookmarks
     * were last reached for in each period. Every label says so.
     */
    computeActivity(all) {
        const days = this.statsRange || 30;
        const now = Date.now();
        const DAY = 86400000;
        const bucketDays = days <= 30 ? 1 : (days <= 90 ? 7 : 30);
        const bucketCount = Math.max(1, Math.round(days / bucketDays));
        const buckets = new Array(bucketCount).fill(0);
        const cutoff = now - days * DAY;

        // One predicate for the bars and the headline figures beneath them, so a
        // bookmark can never be counted in "42 bookmarks used" while missing
        // from every bar.
        const inWindow = (b) => {
            const last = Number(b.lastOpened || 0);
            return Number.isFinite(last) && last > 0 && last >= cutoff;
        };

        all.forEach((b) => {
            if (!inWindow(b)) return;
            const last = Number(b.lastOpened || 0);
            // A timestamp ahead of now (clock skew between devices, or an import
            // carrying a bad date) makes age negative, and floor() of that is
            // negative too — which pushed idx past the end and wrote outside the
            // array, stretching it with holes so every sum came out NaN. Clamping
            // both ends folds a future date into the newest bucket instead.
            const age = now - last;
            const offset = Math.floor(age / (bucketDays * DAY));
            const idx = bucketCount - 1 - Math.max(0, Math.min(bucketCount - 1, offset));
            buckets[idx] += 1;
        });

        const labels = buckets.map((_, i) => {
            const agoBuckets = bucketCount - 1 - i;
            if (agoBuckets === 0) return this.t('config.statsSparklineToday', 'now');
            const agoDays = agoBuckets * bucketDays;
            return this.t('config.statsSparklineDaysAgoView', '{n}d ago').replace('{n}', String(agoDays));
        });

        // The actual date each bar covers. "12d ago" is fine as an axis end-cap
        // but useless in a tooltip, where the question is which day this is.
        const dateFmt = new Intl.DateTimeFormat(this.dash.settings?.language || undefined,
            { day: 'numeric', month: 'short' });
        const dateLabels = buckets.map((_, i) => {
            const agoBuckets = bucketCount - 1 - i;
            const end = new Date(now - agoBuckets * bucketDays * DAY);
            if (bucketDays === 1) return dateFmt.format(end);
            // A multi-day bucket is a span, so name both ends of it.
            const start = new Date(end.getTime() - (bucketDays - 1) * DAY);
            return `${dateFmt.format(start)} – ${dateFmt.format(end)}`;
        });

        const activeCount = all.filter(inWindow).length;
        // Lifetime opens of the bookmarks used in this window — a real figure,
        // but not one the bars can carry, since those opens are spread over
        // history we do not have. Summing the buckets would now just restate
        // activeCount, so this stays a separate headline number.
        const totalOpens = all.reduce((sum, b) => (
            inWindow(b) ? sum + Math.max(1, Number(b.openCount || 1)) : sum
        ), 0);

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

        return { buckets, labels, dateLabels, activeCount, totalOpens, wow, bucketDays };
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
            ${this.statsScaleCaption(this.t('config.statsAxisShareHealthy',
                'Healthy share of {total} tracked bookmarks — 0% to 100%').replace('{total}', String(total)))}
            <div class="config-ratio">
                <div class="config-ratio-head">
                    <span class="config-ratio-label">${esc(this.t('config.statsHealthy', 'Healthy'))}</span>
                    <span class="config-ratio-value">${pct}%</span>
                </div>
                <div class="config-bar" role="img" aria-label="${esc(this.t('config.statsHealthy', 'Healthy'))}: ${pct}%">
                    <span class="config-bar-fill config-bar-fill--good" style="width:${pct}%"></span>
                </div>
            </div>
            ${this.statsPairAxisHeader(
                this.t('config.statsAxisState', 'State'),
                this.t('config.statsAxisBookmarks', 'Bookmarks'))}
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
     * Inbox figures come from two places: /api/inbox is the current snapshot,
     * /api/inbox-stats the durable lifetime aggregate that survives items being
     * triaged away. Neither can be derived from the other, so both are fetched.
     */
    async loadStatsInbox() {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const [itemsRes, statsRes] = await Promise.allSettled([
            fetcher('/api/inbox'),
            fetcher('/api/inbox-stats'),
        ]);
        try {
            const body = itemsRes.status === 'fulfilled' && itemsRes.value.ok
                ? await itemsRes.value.json() : null;
            this._statsInboxItems = Array.isArray(body?.items) ? body.items : [];
        } catch {
            this._statsInboxItems = [];
        }
        try {
            this._statsInboxAgg = statsRes.status === 'fulfilled' && statsRes.value.ok
                ? await statsRes.value.json() : null;
        } catch {
            this._statsInboxAgg = null;
        }
        if (this.isActiveView() && this.section === 'stats' && this.statsTab === 'inbox') {
            const host = document.getElementById('config-stats-inbox');
            if (host) host.innerHTML = this.renderStatsInboxBody();
        }
    }

    /** "3d" / "5h" / "20m" — the old config's short duration format. */
    formatDurationShort(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return '—';
        const days = n / 86400000;
        if (days >= 1) return this.t('config.statsInboxDaysUnit', '{n}d').replace('{n}', String(Math.round(days)));
        const hours = n / 3600000;
        if (hours >= 1) return this.t('config.statsInboxHoursUnit', '{n}h').replace('{n}', String(Math.round(hours)));
        return this.t('config.statsInboxMinutesUnit', '{n}m').replace('{n}', String(Math.max(1, Math.round(n / 60000))));
    }

    renderStatsInbox() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <p class="config-view-intro">${esc(this.t('config.statsInboxIntro', 'What is waiting in the inbox, and how much of it you turn into bookmarks.'))}</p>
            <div id="config-stats-inbox">${this.renderStatsInboxBody()}</div>`;
    }

    /**
     * The snapshot and lifetime blocks, using the old config's own figures:
     * backlog is unread older than 30 days, and conversion is promoted against
     * everything triaged (promoted + discarded) rather than against everything
     * ever added, which would never reach 100%.
     */
    renderStatsInboxBody() {
        const esc = (v) => this.dash.escapeHtml(v);
        if (this._statsInboxItems === undefined) {
            return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        }
        const items = this._statsInboxItems || [];
        const agg = this._statsInboxAgg || {};
        const now = Date.now();

        const unread = items.filter((it) => !Number(it?.readAt));
        const read = items.length - unread.length;
        const oldestUnreadAt = unread.reduce((min, it) => {
            const added = Number(it?.addedAt || 0);
            return added > 0 && added < min ? added : min;
        }, Number.POSITIVE_INFINITY);
        const backlogCutoff = now - 30 * 86400000;
        const backlog = unread.filter((it) =>
            Number(it?.addedAt || 0) > 0 && Number(it.addedAt) < backlogCutoff).length;
        const withTags = items.filter((it) =>
            Array.isArray(it?.tags) && it.tags.some((t) => String(t || '').trim())).length;
        const withNote = items.filter((it) => String(it?.note || '').trim()).length;
        const withPreview = items.filter((it) => String(it?.previewImage || '').trim()).length;

        const added = Number(agg.totalAdded || 0);
        const promoted = Number(agg.totalPromoted || 0);
        const deleted = Number(agg.totalDeleted || 0);
        const triaged = promoted + deleted;
        const pct = triaged > 0 ? Math.round((promoted / triaged) * 100) : 0;
        const avgRetention = Number(agg.retentionCount || 0) > 0
            ? Number(agg.sumRetentionMs || 0) / Number(agg.retentionCount)
            : 0;

        // One accessible name per tile; see the overview tile for why.
        const tile = (label, value) => `
            <div class="config-tile" role="listitem" aria-label="${esc(label)}: ${esc(String(value))}">
                <span class="config-tile-label" aria-hidden="true">${esc(label)}</span>
                <span class="config-tile-value" aria-hidden="true">${esc(String(value))}</span>
            </div>`;

        // Inflow per source, current inbox against lifetime, so a source that
        // has been fully triaged still shows up.
        const currentBySource = new Map();
        items.forEach((it) => {
            const key = String(it?.source || '').trim() || 'unknown';
            currentBySource.set(key, (currentBySource.get(key) || 0) + 1);
        });
        const lifetimeBySource = agg.bySource && typeof agg.bySource === 'object' ? agg.bySource : {};
        const sourceKeys = [...new Set([...currentBySource.keys(), ...Object.keys(lifetimeBySource)])].sort();
        const sourceLabel = (key) => this.t(
            `config.statsInboxSource${key.charAt(0).toUpperCase()}${key.slice(1)}`, key);
        const sourceRows = sourceKeys.map((key) => `
            <tr>
                <th scope="row">${esc(sourceLabel(key))}</th>
                <td>${esc(String(currentBySource.get(key) || 0))}</td>
                <td>${esc(String(Number(lifetimeBySource[key]) || 0))}</td>
            </tr>`).join('');

        const since = Number(agg.firstEventAt || 0) > 0
            ? `<p class="config-panel-note">${esc(this.t('config.statsInboxSince', 'Lifetime counters since {date}.')
                .replace('{date}', new Date(Number(agg.firstEventAt)).toLocaleDateString()))}</p>`
            : '';

        return `
            ${this.renderStatsInboxTrend(agg)}
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsInboxSubCurrent', 'Current inbox'))}</h3>
                <div class="config-tiles" role="list">
                    ${tile(this.t('config.statsInboxTotal', 'Inbox items'), items.length)}
                    ${tile(this.t('config.statsInboxUnread', 'Unread'), unread.length)}
                    ${tile(this.t('config.statsInboxRead', 'Read (kept)'), read)}
                    ${tile(this.t('config.statsInboxBacklog', 'Unread > 30d'), backlog)}
                    ${tile(this.t('config.statsInboxOldestUnread', 'Oldest unread'),
                        Number.isFinite(oldestUnreadAt) ? this.formatDurationShort(now - oldestUnreadAt) : '—')}
                    ${tile(this.t('config.statsInboxWithTags', 'With tags'), withTags)}
                    ${tile(this.t('config.statsInboxWithNote', 'With note'), withNote)}
                    ${tile(this.t('config.statsInboxWithPreview', 'With preview'), withPreview)}
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsInboxSubThroughput', 'Triage throughput'))}</h3>
                ${since}
                <div class="config-tiles" role="list">
                    ${tile(this.t('config.statsInboxAdded', 'Added'), added)}
                    ${tile(this.t('config.statsInboxPromoted', 'Converted'), promoted)}
                    ${tile(this.t('config.statsInboxDeleted', 'Discarded'), deleted)}
                    ${tile(this.t('config.statsInboxAvgRetention', 'Avg. time to triage'), this.formatDurationShort(avgRetention))}
                </div>
                <div class="config-ratio" style="margin-top:12px">
                    <div class="config-bar" role="img" aria-label="${esc(String(pct))}%">
                        <span class="config-bar-fill" style="width:${pct}%"></span>
                    </div>
                    <p class="config-field-hint">${esc(this.t('config.statsInboxConversion',
                        '{promoted} of {triaged} triaged items converted to bookmarks ({pct}%)')
                        .replace('{promoted}', String(promoted))
                        .replace('{triaged}', String(triaged))
                        .replace('{pct}', String(pct)))}</p>
                </div>
            </div>

            ${sourceKeys.length ? `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsInboxSubSources', 'Inbox by source'))}</h3>
                <table class="config-stats-table">
                    <thead><tr>
                        <th scope="col">${esc(this.t('config.statsInboxColSource', 'Source'))}</th>
                        <th scope="col">${esc(this.t('config.statsInboxColCurrent', 'In inbox now'))}</th>
                        <th scope="col">${esc(this.t('config.statsInboxColLifetime', 'Added (lifetime)'))}</th>
                    </tr></thead>
                    <tbody>${sourceRows}</tbody>
                </table>
            </div>` : ''}`;
    }

    /**
     * Inbox throughput per day: what came in against what was dealt with.
     *
     * The server has kept this all along — inbox-stats.json carries dailyBuckets
     * keyed YYYY-MM-DD, and its own comment says "for the trend chart" — but
     * nothing ever drew it, so the Inbox tab showed lifetime totals and no sense
     * of whether the backlog was growing or shrinking.
     *
     * It is also the only honest time series in Statistics. The activity chart
     * can only bucket bookmarks by their single lastOpened; here each day was
     * genuinely recorded as it happened.
     *
     * Two series, so a legend is required rather than optional; triaged stacks
     * promoted and discarded, since together they are "dealt with" and the split
     * between them is secondary.
     */
    renderStatsInboxTrend(agg) {
        const esc = (v) => this.dash.escapeHtml(v);
        const daily = agg?.dailyBuckets && typeof agg.dailyBuckets === 'object' ? agg.dailyBuckets : null;
        const keys = daily ? Object.keys(daily).sort() : [];
        if (!keys.length) return '';

        // Days with no events are absent from the map, not zero — without
        // filling them a quiet week would compress into a misleadingly busy
        // chart. Bounded by the range the user already picked for activity.
        const DAY = 86400000;
        const days = Math.min(this.statsRange || 30, 90);
        const today = new Date();
        const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        const series = [];
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(today.getTime() - i * DAY);
            const key = iso(date);
            const b = daily[key] || {};
            series.push({
                key,
                date,
                added: Number(b.added || 0),
                triaged: Number(b.promoted || 0) + Number(b.deleted || 0),
            });
        }
        // Nothing inside the window, even though history exists further back.
        if (!series.some((d) => d.added || d.triaged)) {
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsInboxTrendTitle', 'Inbox flow per day'))}</h3>
                    <p class="config-panel-empty">${esc(this.t('config.statsInboxTrendEmpty', 'No inbox activity in this period.'))}</p>
                </div>`;
        }

        const W = 500;
        const H = 108;
        const n = series.length;
        const slot = W / n;
        const barW = Math.max(1, (slot - 3) / 2);
        const max = Math.max(...series.map((d) => Math.max(d.added, d.triaged)), 1);
        const fmt = new Intl.DateTimeFormat(this.dash.settings?.language || undefined,
            { day: 'numeric', month: 'short' });

        const addedLabel = this.t('config.statsInboxTrendAdded', 'Added');
        const triagedLabel = this.t('config.statsInboxTrendTriaged', 'Dealt with');
        const bars = series.map((d, i) => {
            const x = i * slot;
            const hA = Math.round((d.added / max) * H);
            const hT = Math.round((d.triaged / max) * H);
            const label = `${fmt.format(d.date)}: ${d.added} ${addedLabel}, ${d.triaged} ${triagedLabel}`;
            return `<g class="config-chart-bar" tabindex="0" role="listitem"
                       data-bar-date="${esc(fmt.format(d.date))}"
                       data-bar-value="${esc(String(d.added))}"
                       data-bar-value2="${esc(String(d.triaged))}"
                       aria-label="${esc(label)}">
                <rect class="config-chart-bar-hit" x="${x.toFixed(2)}" y="0" width="${slot.toFixed(2)}" height="${H}"></rect>
                <rect class="config-chart-bar-fill config-chart-bar-fill--a" x="${x.toFixed(2)}" y="${H - hA}" width="${barW.toFixed(2)}" height="${Math.max(hA, d.added > 0 ? 2 : 0)}" rx="1"></rect>
                <rect class="config-chart-bar-fill config-chart-bar-fill--b" x="${(x + barW + 2).toFixed(2)}" y="${H - hT}" width="${barW.toFixed(2)}" height="${Math.max(hT, d.triaged > 0 ? 2 : 0)}" rx="1"></rect>
            </g>`;
        }).join('');

        const srRows = series.map((d) =>
            `<tr><th scope="row">${esc(fmt.format(d.date))}</th><td>${esc(String(d.added))}</td><td>${esc(String(d.triaged))}</td></tr>`).join('');
        const totalAdded = series.reduce((s2, d) => s2 + d.added, 0);
        const totalTriaged = series.reduce((s2, d) => s2 + d.triaged, 0);
        const net = totalAdded - totalTriaged;

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.statsInboxTrendTitle', 'Inbox flow per day'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.statsInboxTrendNote',
                    'What arrived against what you dealt with. Recorded per day as it happened, so this is real history rather than a snapshot.'))}</p>
                <div class="config-chart-legend">
                    <span class="config-chart-legend-item"><span class="config-chart-swatch config-chart-swatch--a"></span>${esc(addedLabel)}</span>
                    <span class="config-chart-legend-item"><span class="config-chart-swatch config-chart-swatch--b"></span>${esc(triagedLabel)}</span>
                </div>
                <div class="config-stat-figures">
                    <span><strong>${esc(String(totalAdded))}</strong> ${esc(addedLabel.toLowerCase())}</span>
                    <span><strong>${esc(String(totalTriaged))}</strong> ${esc(triagedLabel.toLowerCase())}</span>
                    <span class="config-stat-trend config-stat-trend--${net > 0 ? 'down' : 'up'}">${esc(net > 0
                        ? this.t('config.statsInboxTrendGrowing', 'backlog grew by {n}').replace('{n}', String(net))
                        : this.t('config.statsInboxTrendShrinking', 'backlog shrank by {n}').replace('{n}', String(Math.abs(net))))}</span>
                </div>
                <div class="config-chart">
                    <div class="config-chart-plot">
                        <span class="config-chart-axis-y" aria-hidden="true">
                            <span class="config-chart-axis-title">${esc(this.t('config.statsInboxTrendAxisY', 'Items'))}</span>
                            <span class="config-chart-axis-ticks"><span>${esc(String(max))}</span><span>0</span></span>
                        </span>
                        <span class="config-chart-plot-area">
                            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="list"
                                 aria-label="${esc(this.t('config.statsInboxTrendTitle', 'Inbox flow per day'))}">${bars}</svg>
                            <span class="config-chart-ticks" aria-hidden="true">${this.statsActivityTicks({
                                dateLabels: series.map((d) => fmt.format(d.date)),
                            })}</span>
                        </span>
                    </div>
                    <p class="config-chart-axis-x" aria-hidden="true">${esc(this.t('config.statsAxisPerDay', 'Day (oldest → newest)'))}</p>
                    <div class="config-chart-tip" role="status" aria-live="polite" hidden></div>
                </div>
                <table class="config-sr-only">
                    <caption>${esc(this.t('config.statsInboxTrendTitle', 'Inbox flow per day'))}</caption>
                    <thead><tr><th scope="col">${esc(this.t('config.statsAxisPerDay', 'Day'))}</th><th scope="col">${esc(addedLabel)}</th><th scope="col">${esc(triagedLabel)}</th></tr></thead>
                    <tbody>${srRows}</tbody>
                </table>
            </div>`;
    }

    /**
     * The health endpoint already aggregates the counts, so read its summary
     * rather than re-deriving them from the issue list (which only carries the
     * bookmarks that have something wrong with them).
     */
    async loadStatsHealth() {
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

    /**
     * Per-bar readout on the activity chart.
     *
     * On a bar chart the mark is the hit target — no crosshair — so each bar
     * carries its own tooltip on hover *and* on focus, because a value that
     * only exists under a pointer is not reachable by keyboard. The screen
     * reader gets the same numbers from the bar's aria-label and the sr-only
     * table, so this layer enhances rather than gates.
     *
     * Values are written with textContent: the labels are dates we format, but
     * the rule holds regardless — never build tooltip DOM by string concat.
     */
    bindActivityChartTooltip(container) {
        // Every chart on the page, not just the first: the Inbox tab has its own
        // trend chart, and binding only container.querySelector('.config-chart')
        // would leave whichever came second inert.
        container.querySelectorAll('.config-chart').forEach((chart) => {
            this.bindOneChartTooltip(chart);
        });
    }

    bindOneChartTooltip(chart) {
        const tip = chart?.querySelector('.config-chart-tip');
        if (!chart || !tip) return;

        const openLabel = this.t('config.statsActivityUsedLabel', 'bookmarks last used');
        const hide = () => {
            tip.hidden = true;
            chart.querySelectorAll('.config-chart-bar.is-active')
                .forEach((el) => el.classList.remove('is-active'));
        };

        const show = (bar) => {
            const value = bar.getAttribute('data-bar-value') || '0';
            const value2 = bar.getAttribute('data-bar-value2');
            const date = bar.getAttribute('data-bar-date') || '';
            tip.replaceChildren();
            // Value leads, label follows: the reader already knows which bar
            // they are pointing at and wants the number.
            if (value2 === null) {
                const strong = document.createElement('strong');
                strong.textContent = `${value} ${openLabel}`;
                tip.append(strong);
            } else {
                // Two series: both are listed, each keyed by its own colour, so
                // the pointer never has to land on the right one of the pair.
                const rows = [
                    [value, this.t('config.statsInboxTrendAdded', 'Added'), 'a'],
                    [value2, this.t('config.statsInboxTrendTriaged', 'Dealt with'), 'b'],
                ];
                rows.forEach(([n, label, key]) => {
                    const row = document.createElement('strong');
                    row.className = 'config-chart-tip-row';
                    const swatch = document.createElement('span');
                    swatch.className = `config-chart-swatch config-chart-swatch--${key}`;
                    const text = document.createElement('span');
                    text.textContent = `${n} ${label}`;
                    row.append(swatch, text);
                    tip.append(row);
                });
            }
            const when = document.createElement('span');
            when.textContent = date;
            tip.append(when);
            tip.hidden = false;

            chart.querySelectorAll('.config-chart-bar.is-active')
                .forEach((el) => el.classList.remove('is-active'));
            bar.classList.add('is-active');

            // Follow the bar horizontally, clamped so the box cannot hang off
            // either end of the panel.
            const barBox = bar.getBoundingClientRect();
            const chartBox = chart.getBoundingClientRect();
            const centre = barBox.left + barBox.width / 2 - chartBox.left;
            const half = tip.offsetWidth / 2;
            const clamped = Math.max(half, Math.min(centre, chartBox.width - half));
            tip.style.left = `${clamped}px`;
        };

        chart.querySelectorAll('.config-chart-bar').forEach((bar) => {
            bar.addEventListener('pointerenter', () => show(bar));
            bar.addEventListener('pointerleave', hide);
            bar.addEventListener('focus', () => show(bar));
            bar.addEventListener('blur', hide);
        });
        // The <g> elements do not tile the plot — the SVG has padding around
        // them — so leaving a bar sideways lands on the svg, not on another bar.
        // Both leave paths are needed: the bar's own, and the chart's for when
        // the pointer exits the panel altogether.
        chart.addEventListener('pointerleave', hide);
    }

    bindStats(container) {
        this.bindSubTabStrip(container, 'data-stats-tab', (tab) => {
            {
                if (tab === this.statsTab) return;
                this.statsTab = tab;
                this.restoreConfigHash();
                // Fetched on first open rather than with the section: each
                // tab's endpoint is of no use to the other tabs.
                this.loadStatsTabData(tab);
                // Only the body changes; repainting the tab strip too would
                // rebuild the buttons under the pointer that just clicked one.
                this.repaintStatsBody();
                this.syncSubTabStrip('data-stats-tab', this.statsTab);
            }
        });
        container.querySelectorAll('[data-stats-range]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = Number(btn.getAttribute('data-stats-range'));
                if (!next || next === this.statsRange) return;
                this.statsRange = next;
                this.saveStatsRange(next);
                this.repaintStatsBody();
            });
        });
        this.bindActivityChartTooltip(container);
        container.querySelectorAll('[data-stats-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-stats-action');
                if (action === 'export') this.exportStatsCSV();
                // Duplicates are the actionable half of this panel, and health
                // is where they can actually be merged.
                if (action === 'open-health') this.openViewFromTile('health', 'duplicate');
                if (action === 'add-bookmark') this.openAddBookmarkModal();
            });
        });
        // Cleanup candidates hand off to the bookmarks list, which is where the
        // rows can actually be tagged or deleted.
        container.querySelectorAll('[data-cleanup-goto]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-cleanup-goto');
                if (!key || !DashboardConfig.CLEANUP_FILTERS[key]) return;
                this.bmCleanupFilter = key;
                this.bmTagFilter = [];
                // A stale search or category from an earlier visit would narrow
                this.bmQuery = '';
                this.bmPageFilter = '';
                this.bmCategoryFilter = '';
                this.bmSelected.clear();
                this.resetBookmarkVisibleLimit();
                this._bmDuplicateUrls = null;
                this.openConfigView('bookmarks');
            });
        });
        container.querySelectorAll('[data-stats-goto]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-stats-goto');
                if (!tab || tab === this.statsTab) return;
                this.statsTab = tab;
                this.loadStatsTabData(tab);
                this.repaintStatsBody();
                this.syncSubTabStrip('data-stats-tab', this.statsTab);
            });
        });
        this.bindFormKeyboard(container);
    }

    /** The report as a flat CSV, so it can be worked through in a spreadsheet. */
    exportStatsCSV() {
        const s = this.computeStats();
        const a = s.activity;
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
            // The activity panel's own figures, which the export omitted
            // entirely — the tab you are looking at contributed nothing to it.
            ['activity_range_days', this.statsRange || 30],
            ['activity_bucket_days', a.bucketDays],
            ['activity_bookmarks_used', a.activeCount],
            ['activity_opens_all_time', a.totalOpens],
            ['opens_total', s.concentration.totalOpens],
            ['bookmarks_ever_opened', s.concentration.usedCount],
            ['top10_share_of_opens_pct', s.concentration.share],
        ];
        s.perPage.forEach(([name, n]) => rows.push([`page:${name}`, n]));
        s.perCategory.forEach(([name, n]) => rows.push([`category:${name}`, n]));
        // The untruncated lists: the rows are labelled `tag:` and `bookmark:`,
        // so stopping at the twenty the panel happens to show would be a
        // silently partial export dressed as a complete one.
        (s.topTagsAll || s.topTags).forEach(([tag, n]) => rows.push([`tag:${tag}`, n]));
        (s.topOpenedAll || s.topOpened).forEach(([name, n]) => rows.push([`bookmark_opens:${name}`, n]));
        s.categoryEffectiveness.forEach((c) => rows.push([`category_opens_per_bookmark:${c.label}`, c.perBookmark.toFixed(2)]));
        // The chart series itself, one row per bar, so the shape is reproducible
        // in a spreadsheet rather than only visible on screen.
        (a.dateLabels || []).forEach((d, i) => rows.push([`bookmarks_last_used:${d}`, a.buckets[i]]));

        const esc = (v) => {
            const str = String(v ?? '');
            return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        };
        const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
        this.triggerDownload(new Blob([csv], { type: 'text/csv' }),
            `nextdash-stats-${new Date().toISOString().slice(0, 10)}.csv`);
    }

    /* ── Help (native) ─────────────────────────────────────────────────────── */

    static HELP_TABS = ['start', 'config', 'organizing', 'search', 'health', 'data', 'about'];

    helpTabLabel(tab) {
        const map = {
            start: ['config.helpTabStart', 'Getting started'],
            config: ['config.helpTabConfig', 'Configuring'],
            organizing: ['config.helpTabOrganizing', 'Pages & bookmarks'],
            search: ['config.helpTabSearch', 'Search & keyboard'],
            health: ['config.helpTabHealth', 'Health & inbox'],
            data: ['config.helpTabData', 'Data & hosting'],
            about: ['config.helpTabAbout', 'About'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    }

    renderHelp() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tabs = DashboardConfig.HELP_TABS.map((tab) => {
            const active = tab === this.helpTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-help-body" data-help-tab="${esc(tab)}">${esc(this.helpTabLabel(tab))}</button>`;
        }).join('');
        return `
            <div class="config-help-header">
                <p class="config-view-intro">${esc(this.t('config.helpIntro', 'How nextDash works, what each part of config does, and where to go next.'))}</p>
                ${this.renderCheatSheetPdfLink()}
            </div>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div id="config-help-body" role="tabpanel" tabindex="0">${this.renderHelpBody()}</div>
        `;
    }

    /**
     * The prose is carried over from the old config's help pages, but rewritten
     * where the new config differs: it has no System/Dashboard/Extras tab groups,
     * no Essentials/Advanced layers, no explicit Save, and the editors it
     * describes were rebuilt (rows expand in place; reordering is ↑/↓ rather than
     * drag; page archiving and category merging are not carried over). Documenting
     * the old behaviour would send people looking for controls that do not exist.
     */
    renderHelpBody() {
        switch (this.helpTab) {
            case 'config': return this.renderHelpConfig();
            case 'organizing': return this.renderHelpOrganizing();
            case 'search': return this.renderHelpSearch();
            case 'health': return this.renderHelpHealth();
            case 'data': return this.renderHelpData();
            case 'about': return this.renderHelpAbout();
            default: return this.renderHelpStart();
        }
    }

    /** A help panel whose body is trusted, translator-supplied HTML. */
    helpPanel(titleKey, titleFallback, bodyKey, bodyFallback, extra = '') {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t(titleKey, titleFallback))}</h3>
                <div class="config-help-prose">${this.t(bodyKey, bodyFallback)}</div>
                ${extra}
            </div>`;
    }

    renderHelpStart() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tips = this.helpTips().map((tip) => `<li class="config-help-tip">${tip}</li>`).join('');
        return this.helpPanel('config.helpStartTitle', 'Getting started',
            'config.helpStartBody', '')
            + `<div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.helpTipsTitle', 'Everyday keys'))}</h3>
                <ul class="config-help-tips">${tips}</ul>
            </div>`;
    }

    renderHelpConfig() {
        return this.helpPanel('config.helpConfigTitle', 'Finding your way around config',
            'config.helpConfigBody', '')
            + this.helpPanel('config.helpAppearanceTitle', 'Appearance & themes',
                'config.helpAppearanceBody', '');
    }

    renderHelpOrganizing() {
        return this.helpPanel('config.helpWorkspaceTitle', 'Pages & categories',
            'config.helpWorkspaceBody', '')
            + this.helpPanel('config.helpBookmarksTitle', 'Bookmarks',
                'config.helpBookmarksBody', '')
            + this.helpPanel('config.helpTagsTitle', 'Tags & collections',
                'config.helpTagsBody', '');
    }

    renderHelpSearch() {
        const esc = (v) => this.dash.escapeHtml(v);
        // Finders and commands get their own panels rather than a paragraph
        // inside Search: they are separate modes with their own syntax, and
        // burying them is why they went unnoticed.
        return this.helpPanel('config.helpSearchTitle', 'Searching your bookmarks',
            'config.helpSearchBody', '')
            + this.helpPanel('config.helpFindersTitle', 'Finders',
                'config.helpFindersBody', '')
            + this.helpPanel('config.helpCommandsTitle', 'Commands',
                'config.helpCommandsBody', '')
            + this.helpPanel('config.helpKeyboardTitle', 'Keyboard',
                'config.helpKeyboardBody', '',
                `<div class="config-actions">
                    <button type="button" class="config-btn" data-help-action="cheatsheet">${esc(this.t('config.openCheatSheet', 'Open the cheat sheet'))}</button>
                    ${this.renderCheatSheetPdfLink()}
                </div>`)
            + this.helpPanel('config.helpConfigKeyboardTitle', 'Config navigation',
                'config.helpConfigKeyboardBody', '');
    }

    renderHelpHealth() {
        return this.helpPanel('config.helpHealthTitle', 'Availability & health',
            'config.helpHealthBody', '')
            + this.helpPanel('config.helpInboxTitle', 'Inbox',
                'config.helpInboxBody', '');
    }

    renderHelpData() {
        return this.helpPanel('config.helpDataTitle', 'Backups, import & export',
            'config.helpDataBody', '')
            + this.helpPanel('config.helpSelfHostingTitle', 'Self-hosting',
                'config.helpSelfHostingBody', '');
    }

    renderHelpAbout() {
        const esc = (v) => this.dash.escapeHtml(v);
        // No version line: the nextdash-app-version meta is an asset fingerprint
        // for cache-busting (see appVersionToken in html_etag.go), not a release
        // number, so printing it as "Version" showed people a meaningless hash.
        // The real one is served by /api/version if this is ever wanted here.
        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.helpWhatsNewTitle', 'What’s new'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.helpWhatsNewHint', 'See what changed in the most recent releases.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-help-action="whats-new">${esc(this.t('config.showWhatsNew', 'Show what’s new'))}</button>
                </div>
            </div>
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.helpAboutTitle', 'About nextDash'))}</h3>
                <div class="config-help-prose">${this.t('config.helpAboutBody', '')}</div>
                <div class="config-actions">
                    <a class="config-btn" href="https://github.com/jordibrouwer/nextDash" target="_blank" rel="noopener noreferrer">${esc(this.t('config.helpGithub', 'Project on GitHub'))}</a>
                </div>
                ${this.renderKofiSupport()}
            </div>`;
    }

    /**
     * The Ko-fi call to action from the old config's help tab. The button's own
     * styling (glow, shimmer, twinkling stars) is the shared .wn-kofi-* set in
     * modal.css, which the dashboard already loads for the what's-new modal —
     * only the surrounding block needed porting into config-view.css.
     */
    renderKofiSupport() {
        const esc = (v) => this.dash.escapeHtml(v);
        const stars = '<span class="wn-kofi-star"></span>'.repeat(4);
        return `
            <div class="help-support-block">
                <span class="help-support-label">${esc(this.t('config.helpSupportLabel', 'nextDash is free and open-source.'))}</span>
                <a href="https://ko-fi.com/jordibrw" target="_blank" rel="noopener noreferrer" class="wn-kofi-btn wn-kofi-btn--animated">
                    <span class="wn-kofi-stars" aria-hidden="true">${stars}</span>
                    <svg class="wn-kofi-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 5.702 0 8.732c.483 4.918 3.919 5.023 6.782 5.139 2.81.114 3.325.12 3.325.12s.747.468 1.5.654a7.5 7.5 0 0 0 3.56-.468s5.698-1.094 7.035-5.7c.222-.778.35-1.574.35-2.373 0-.888-.098-1.83-.715-2.309zm-3.585 2.39c-.583 2.4-3.11 2.947-3.11 2.947l-1.8-.434c-.016-.003-.033.003-.043.016l-.847 1.067a.15.15 0 0 1-.265-.046l-.522-1.947a.15.15 0 0 0-.102-.107l-1.956-.517a.15.15 0 0 1-.046-.267l3.184-2.304c.016-.011.026-.03.024-.049l-.098-.832a2.617 2.617 0 0 1 2.602-2.944c1.444 0 2.618 1.174 2.618 2.618 0 .295-.049.582-.14.854l.501-.068s.564 1.006-.0 2.013z"/></svg>
                    <span class="wn-kofi-label">${esc(this.t('config.helpSupportKofi', 'Support me on Ko-fi'))}</span>
                </a>
            </div>
            <p class="help-signature"><a href="https://jordibrw.nl" target="_blank" rel="noopener noreferrer" class="help-signature-link">jordibrw.nl</a></p>`;
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
            kbd('Shift + B', this.t('config.tipAddBookmarkShift', 'Open the new-bookmark form')),
            kbd('.', this.t('config.tipCollapseAll', 'Collapse or expand every category')),
            kbd('Shift + H', this.t('config.tipHealth', 'Open the health view')),
            kbd('Shift + I', this.t('config.tipInbox', 'Open the inbox')),
            kbd('Shift + S', this.t('config.tipConfig', 'Open config')),
        ];
    }

    bindHelp(container) {
        this.bindSubTabStrip(container, 'data-help-tab', (tab) => {
            {
                if (tab === this.helpTab) return;
                this.helpTab = tab;
                this.restoreConfigHash();
                const body = document.getElementById('config-help-body');
                if (!body) { this.render(); return; }
                body.innerHTML = this.renderHelpBody();
                this.syncSubTabStrip('data-help-tab', this.helpTab);
                // The new body carries its own action buttons.
                this.bindHelpActions(body);
            }
        });
        this.bindHelpActions(container);
    }

    bindHelpActions(container) {
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
