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

        return `
            <p class="config-view-intro">${esc(this.t('config.dataBackupsIntro', 'Back up your data, restore an earlier snapshot, or move it in and out of nextDash.'))}</p>
            ${tiles}

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.backupCreateTitle', 'Backup'))}</h3>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-backup-action="download">${esc(this.t('config.backupDownload', 'Download backup'))}</button>
                    <button type="button" class="config-btn" data-backup-action="run">${esc(this.t('config.backupRunNow', 'Make a backup now'))}</button>
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.backupStoredTitle', 'Stored backups'))}</h3>
                <div id="config-backup-list">${this.renderBackupList()}</div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.backupMoveTitle', 'Import & export'))}</h3>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-backup-action="import">${esc(this.t('config.backupImport', 'Import backup…'))}</button>
                </div>
                <input type="file" id="config-import-input" accept=".zip" hidden>
            </div>

            <div class="config-panel config-panel--danger">
                <h3 class="config-panel-title">${esc(this.t('config.backupResetTitle', 'Reset'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.backupResetNote', 'Removes every bookmark, page, and setting. This cannot be undone.'))}</p>
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
        const importInput = container.querySelector('#config-import-input');
        if (importInput) {
            importInput.addEventListener('change', () => {
                const file = importInput.files && importInput.files[0];
                if (file) void this.importBackup(file);
                importInput.value = '';
            });
        }
    }

    handleBackupAction(action) {
        switch (action) {
            case 'download': this.downloadFullBackup(); break;
            case 'run': void this.runBackupNow(); break;
            case 'import': document.getElementById('config-import-input')?.click(); break;
            case 'reset': void this.resetAllData(); break;
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
}

window.DashboardConfig = DashboardConfig;
