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
        } else if (this.section === 'data-backups') {
            this.bindDataBackupsActions(container);
            void this.loadBackupData();
        } else if (this.section === 'appearance') {
            this.bindAppearanceControls(container);
            void this.loadThemeList();
        } else if (this.section === 'behavior') {
            this.bindBehaviorControls(container);
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
        if (this.section === 'data-backups') {
            return this.renderDataBackups();
        }
        if (this.section === 'appearance') {
            return this.renderAppearance();
        }
        if (this.section === 'behavior') {
            return this.renderBehavior();
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

            <div class="config-panel config-panel--danger">
                <h3 class="config-panel-title">${esc(this.t('config.resetSectionTitle', 'Reset'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.resetOnboardingHint', 'Replay the welcome tour and tips next time you open the dashboard.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-backup-action="reset-onboarding">${esc(this.t('config.resetOnboardingButton', 'Reset onboarding & tips'))}</button>
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
            d.saveSettings?.();
            // Repaint so the interval select enables/disables and the tile updates.
            if (name === 'autoBackupEnabled') {
                void this.loadBackupData();
            } else {
                this.repaintBackupSection();
            }
        }
    }

    setBackupSelect(name, value) {
        if (name !== 'healthAutoRecheckIntervalHours') return;
        this.dash.settings.healthAutoRecheckIntervalHours = Number(value) || 24;
        this.dash.saveSettings?.();
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
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.appearanceMode', 'Quick mode'))}</span>
                    <div class="config-choices" role="group">
                        <button type="button" class="config-choice${theme === 'light' ? ' is-active' : ''}" data-appearance-theme="light" aria-pressed="${theme === 'light'}">${esc(this.t('config.themeLight', 'Light'))}</button>
                        <button type="button" class="config-choice${theme === 'dark' ? ' is-active' : ''}" data-appearance-theme="dark" aria-pressed="${theme === 'dark'}">${esc(this.t('config.themeDark', 'Dark'))}</button>
                    </div>
                </div>
                <label class="config-toggle">
                    <input type="checkbox" data-appearance-toggle="autoDarkMode" ${s.autoDarkMode ? 'checked' : ''}>
                    <span>${esc(this.t('config.appearanceAutoDark', 'Follow system dark mode'))}</span>
                </label>
                <div class="config-actions" style="margin-top:14px">
                    <button type="button" class="config-btn" data-appearance-action="edit-colors">${esc(this.t('config.openThemeColorsLink', 'Edit theme colours…'))}</button>
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceTypeTitle', 'Type'))}</h3>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.fontPresetLabel', 'Font'))}</span>
                    <select class="config-select" data-appearance-select="fontPreset">${fontPresetOptions}</select>
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.fontWeightLabel', 'Weight'))}</span>
                    <div class="config-choices" role="group">${weightChoices}</div>
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
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.backgroundOpacityLabel', 'Opacity'))}</span>
                    <input type="range" class="config-range" data-appearance-range="backgroundOpacity" min="0" max="1" step="0.05" value="${opacity}">
                    <span class="config-range-value">${Math.round(opacity * 100)}%</span>
                </div>
                <label class="config-toggle">
                    <input type="checkbox" data-appearance-toggle="showBackgroundDots" ${s.showBackgroundDots ? 'checked' : ''}>
                    <span>${esc(this.t('config.showBackgroundDots', 'Show background dots'))}</span>
                </label>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceLayoutTitle', 'Layout & display'))}</h3>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.appearanceLayoutVersion', 'Layout'))}</span>
                    <div class="config-choices" role="group">
                        <button type="button" class="config-choice${layout === 'classic' ? ' is-active' : ''}" data-appearance-layout="classic" aria-pressed="${layout === 'classic'}">${esc(this.t('config.layoutClassic', 'Classic'))}</button>
                        <button type="button" class="config-choice${layout === 'modern' ? ' is-active' : ''}" data-appearance-layout="modern" aria-pressed="${layout === 'modern'}">${esc(this.t('config.layoutModern', 'Modern'))}</button>
                    </div>
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.launcherIconSizeLabel', 'Icon size'))}</span>
                    <div class="config-choices" role="group">${iconSizeChoices}</div>
                </div>
                <label class="config-toggle">
                    <input type="checkbox" data-appearance-toggle="showIcons" ${s.showIcons !== false ? 'checked' : ''}>
                    <span>${esc(this.t('config.showIcons', 'Show bookmark icons'))}</span>
                </label>
                <label class="config-toggle">
                    <input type="checkbox" data-appearance-toggle="colorizeStatus" ${s.colorizeStatus ? 'checked' : ''}>
                    <span>${esc(this.t('config.colorizeStatus', 'Colour status on bookmark rows'))}</span>
                </label>
                <label class="config-toggle">
                    <input type="checkbox" data-appearance-toggle="animationsEnabled" ${s.animationsEnabled !== false ? 'checked' : ''}>
                    <span>${esc(this.t('config.enableAnimations', 'Enable animations'))}</span>
                </label>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.generalGroupBranding', 'Branding'))}</h3>
                <label class="config-toggle">
                    <input type="checkbox" data-appearance-toggle="enableCustomTitle" ${s.enableCustomTitle ? 'checked' : ''}>
                    <span>${esc(this.t('config.enableCustomTitle', 'Use a custom page title'))}</span>
                </label>
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
            range.addEventListener('change', () => this.dash.saveSettings?.());
        }
        const titleInput = container.querySelector('[data-appearance-text="customTitle"]');
        if (titleInput) {
            titleInput.addEventListener('input', () => { this.dash.settings.customTitle = titleInput.value; });
            titleInput.addEventListener('change', () => {
                this.dash.saveSettings?.();
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
    }

    /** Persist a settings change and repaint the appearance section. */
    persistAppearance() {
        this.dash.saveSettings?.();
        if (this.isActiveView() && this.section === 'appearance') {
            const body = document.getElementById('config-view-body');
            if (body) {
                body.innerHTML = this.renderAppearance();
                const container = document.getElementById('dashboard-layout');
                if (container) this.bindAppearanceControls(container);
            }
        }
    }

    applyThemeLive() {
        const s = this.dash.settings || {};
        window.ThemeLoader?.applyTheme?.(
            s.theme === 'light' ? 'light' : 'dark',
            s.showBackgroundDots !== false,
            this.currentFontSize()
        );
    }

    setTheme(theme) {
        if (!theme) return;
        this.dash.settings.theme = theme;
        // applyTheme sets data-theme to any id (light, dark, or a custom/built-in
        // theme); reloadThemeCSS re-pulls the server stylesheet that defines it.
        window.ThemeLoader?.applyTheme?.(
            theme,
            this.dash.settings.showBackgroundDots !== false,
            this.currentFontSize()
        );
        this.reloadThemeCSS();
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
                    { field: 'weatherUnit', type: 'select', label: t('config.weatherUnitLabel', 'Temperature unit'), special: 'datetime', options: [
                        opt('celsius', '°C'), opt('fahrenheit', '°F'),
                    ] },
                    { field: 'weatherLocation', type: 'text', label: t('config.weatherLocationLabel', 'Weather location'), special: 'datetime' },
                ],
            },
            {
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
                title: t('config.generalGroupBookmarkDisplay', 'Bookmark display'),
                controls: [
                    bool('showShortcuts', 'config.showShortcutsLabel', 'Show shortcut letters'),
                    bool('showStatus', 'config.showStatusLabel', 'Show online/offline status'),
                    bool('showPing', 'config.showPingLabel', 'Show ping times'),
                    bool('showLinkPreviewCards', 'config.showLinkPreviewCardsLabel', 'Show link preview cards'),
                ],
            },
            {
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
                ],
            },
            {
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
                title: t('config.generalGroupPrivacy', 'Privacy'),
                controls: [
                    { field: 'analyticsOptIn', type: 'checkbox', label: t('config.usageAnalyticsLabel', 'Share anonymous usage analytics'), disabled: this.dash.telemetryLockedOff === true },
                ],
            },
        ];
    }

    renderBehavior() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        const renderControl = (c) => {
            const val = s[c.field];
            if (c.type === 'checkbox') {
                return `
                    <label class="config-toggle">
                        <input type="checkbox" data-behavior-field="${esc(c.field)}" data-behavior-type="checkbox"
                            ${val ? 'checked' : ''} ${c.disabled ? 'disabled' : ''}>
                        <span>${esc(c.label)}</span>
                    </label>`;
            }
            if (c.type === 'select') {
                const opts = c.options.map((o) =>
                    `<option value="${esc(o.value)}" ${String(val) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`
                ).join('');
                return `
                    <div class="config-field">
                        <span class="config-field-label">${esc(c.label)}</span>
                        <select class="config-select" data-behavior-field="${esc(c.field)}" data-behavior-type="select" data-behavior-special="${esc(c.special || '')}">${opts}</select>
                    </div>`;
            }
            if (c.type === 'number') {
                return `
                    <div class="config-field">
                        <span class="config-field-label">${esc(c.label)}</span>
                        <input type="number" class="config-text" style="min-width:80px" data-behavior-field="${esc(c.field)}" data-behavior-type="number" data-behavior-special="${esc(c.special || '')}"
                            min="${c.min ?? ''}" max="${c.max ?? ''}" value="${esc(val ?? '')}">
                    </div>`;
            }
            // text
            return `
                <div class="config-field">
                    <span class="config-field-label">${esc(c.label)}</span>
                    <input type="text" class="config-text" data-behavior-field="${esc(c.field)}" data-behavior-type="text" data-behavior-special="${esc(c.special || '')}" value="${esc(val ?? '')}">
                </div>`;
        };
        const panels = this.behaviorSchema().map((panel) => `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(panel.title)}</h3>
                ${panel.controls.map(renderControl).join('')}
            </div>
        `).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.behaviorIntro', 'How the dashboard behaves. Every change applies immediately and is saved.'))}</p>
            ${panels}
        `;
    }

    bindBehaviorControls(container) {
        container.querySelectorAll('[data-behavior-field]').forEach((el) => {
            const field = el.getAttribute('data-behavior-field');
            const type = el.getAttribute('data-behavior-type');
            const special = el.getAttribute('data-behavior-special') || '';
            if (type === 'checkbox') {
                el.addEventListener('change', () => this.setBehavior(field, el.checked, special));
            } else if (type === 'select') {
                el.addEventListener('change', () => this.setBehavior(field, el.value, special));
            } else if (type === 'number') {
                el.addEventListener('change', () => this.setBehavior(field, Number(el.value), special));
            } else {
                // Text: save on blur/change so typing is not interrupted by re-renders.
                el.addEventListener('change', () => this.setBehavior(field, el.value, special));
            }
        });
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
        try {
            await d.saveSettings?.();
        } catch {
            this.notify(this.t('config.behaviorSaveError', 'Could not save that change.'), 'error');
        }
    }
}

window.DashboardConfig = DashboardConfig;
