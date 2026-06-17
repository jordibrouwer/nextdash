/**
 * Config tab sync listeners and refresh after structure/settings changes.
 */
class DashboardConfigSync {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    setupConfigStructureReloadListener() {
        const d = this.dash;
        window.addEventListener('storage', async (event) => {
            if (!event.newValue) {
                return;
            }
            if (event.key !== d.structureSyncEventKey && event.key !== d.settingsSyncEventKey) {
                return;
            }
            if (d._configReturnRefreshInFlight) {
                return;
            }
            d._configReturnRefreshInFlight = true;
            try {
                const payload = JSON.parse(event.newValue);
                if (payload?.sourceTabId && payload.sourceTabId === d.tabId) {
                    return;
                }
                if (event.key === d.structureSyncEventKey) {
                    await this.refreshAfterConfigStructureUpdate(payload);
                    d.lastAppliedStructureSyncAt = payload?.timestamp || Date.now();
                    d.lastAppliedSettingsSyncAt = Math.max(d.lastAppliedSettingsSyncAt, payload?.timestamp || 0);
                    try {
                        sessionStorage.removeItem(d.pendingStructureSyncKey);
                        sessionStorage.removeItem(d.pendingSettingsSyncKey);
                    } catch { /* ignore */ }
                    this.showSyncToast(d.formatDashboardLabel('syncConfigChanges', {}, 'Synced config changes.'));
                    return;
                }
                if (event.key === d.settingsSyncEventKey) {
                    await this.refreshAfterConfigSettingsUpdate(payload);
                    d.lastAppliedSettingsSyncAt = payload?.timestamp || Date.now();
                    try {
                        sessionStorage.removeItem(d.pendingSettingsSyncKey);
                    } catch { /* ignore */ }
                    this.showSyncToast(d.formatDashboardLabel('syncSettingsApplied', {}, 'Applied dashboard settings update.'));
                }
            } catch (error) {
                console.warn('Config sync listener failed:', error);
                d.showErrorNotification(
                    d.formatDashboardLabel('syncConfigRefreshFailed', {}, 'Failed to apply config changes from another tab.'),
                    { retry: () => this.maybeRefreshAfterConfigReturn() }
                );
            } finally {
                d._configReturnRefreshInFlight = false;
            }
        });
    }


    setupConfigReturnRefreshListener() {
        const d = this.dash;
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                this.restoreDashboardInteractionAfterBfcache();
            }
            this.maybeRefreshAfterConfigReturn();
        });
    }


    restoreDashboardInteractionAfterBfcache() {
        const d = this.dash;
        document.querySelectorAll('#dashboard-layout .bookmark-link').forEach((row) => {
            row.classList.remove('keyboard-selected');
            row.removeAttribute('aria-current');
            row.setAttribute('aria-selected', 'false');
            const openLink = row.querySelector('a.bookmark-open');
            if (openLink) {
                openLink.tabIndex = -1;
            }
        });
        document.getElementById('bookmark-grid')?.removeAttribute('aria-activedescendant');

        d.initializeKeyboardNavigation();
        d.keyboardNavigation?.scheduleUpdate?.();
        d.swipeNavigation?.cleanup?.();
        d.initializeSwipeNavigation();
        window.DashboardTagCloud?.init?.();
    }


    readPendingConfigSync(key) {
        const d = this.dash;
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const payload = JSON.parse(raw);
            return payload && Number(payload.timestamp) > 0 ? payload : null;
        } catch {
            return null;
        }
    }


    markPendingConfigSyncAsAppliedAfterLoad() {
        const d = this.dash;
        const structurePending = this.readPendingConfigSync(d.pendingStructureSyncKey);
        const settingsPending = this.readPendingConfigSync(d.pendingSettingsSyncKey);
        const now = Date.now();
        if (structurePending) {
            d.lastAppliedStructureSyncAt = Math.max(d.lastAppliedStructureSyncAt, structurePending.timestamp, now);
            sessionStorage.removeItem(d.pendingStructureSyncKey);
        }
        if (settingsPending) {
            d.lastAppliedSettingsSyncAt = Math.max(d.lastAppliedSettingsSyncAt, settingsPending.timestamp, now);
            sessionStorage.removeItem(d.pendingSettingsSyncKey);
        }
        if (!structurePending && !settingsPending) {
            d.lastAppliedStructureSyncAt = now;
            d.lastAppliedSettingsSyncAt = now;
        }
    }


    async reconcilePendingConfigSyncAfterLoad() {
        const d = this.dash;
        const structurePending = this.readPendingConfigSync(d.pendingStructureSyncKey);
        const settingsPending = this.readPendingConfigSync(d.pendingSettingsSyncKey);
        const structureTs = structurePending?.timestamp || 0;
        const settingsTs = settingsPending?.timestamp || 0;

        if (structureTs > d.lastAppliedStructureSyncAt) {
            try {
                await this.refreshAfterConfigStructureUpdate(structurePending || {});
                d.lastAppliedStructureSyncAt = structureTs;
                try { sessionStorage.removeItem(d.pendingStructureSyncKey); } catch { /* ignore */ }
                if (settingsTs > 0) {
                    d.lastAppliedSettingsSyncAt = Math.max(d.lastAppliedSettingsSyncAt, settingsTs);
                    try { sessionStorage.removeItem(d.pendingSettingsSyncKey); } catch { /* ignore */ }
                }
            } catch {
                // Pending keys stay for maybeRefreshAfterConfigReturn / visibility retry.
            }
            return;
        }

        if (settingsTs > d.lastAppliedSettingsSyncAt) {
            try {
                await this.refreshAfterConfigSettingsUpdate(settingsPending || {});
                d.lastAppliedSettingsSyncAt = settingsTs;
                try { sessionStorage.removeItem(d.pendingSettingsSyncKey); } catch { /* ignore */ }
            } catch {
                // Pending key stays for retry.
            }
            return;
        }

        this.markPendingConfigSyncAsAppliedAfterLoad();
    }


    async maybeRefreshAfterConfigReturn() {
        const d = this.dash;
        if (!d._configRefreshReady || d._configReturnRefreshInFlight) {
            return;
        }

        const structurePending = this.readPendingConfigSync(d.pendingStructureSyncKey);
        const settingsPending = this.readPendingConfigSync(d.pendingSettingsSyncKey);
        const structureTs = structurePending?.timestamp || 0;
        const settingsTs = settingsPending?.timestamp || 0;

        if (structureTs <= d.lastAppliedStructureSyncAt && settingsTs <= d.lastAppliedSettingsSyncAt) {
            return;
        }

        d._configReturnRefreshInFlight = true;
        try {
            if (structureTs > d.lastAppliedStructureSyncAt) {
                await this.refreshAfterConfigStructureUpdate(structurePending || {});
                d.lastAppliedStructureSyncAt = structureTs;
                sessionStorage.removeItem(d.pendingStructureSyncKey);
                if (settingsTs > 0) {
                    d.lastAppliedSettingsSyncAt = Math.max(d.lastAppliedSettingsSyncAt, settingsTs);
                    sessionStorage.removeItem(d.pendingSettingsSyncKey);
                }
                this.showSyncToast(d.formatDashboardLabel('syncConfigChanges', {}, 'Synced config changes.'));
                return;
            }

            if (settingsTs > d.lastAppliedSettingsSyncAt) {
                await this.refreshAfterConfigSettingsUpdate(settingsPending || {});
                d.lastAppliedSettingsSyncAt = settingsTs;
                sessionStorage.removeItem(d.pendingSettingsSyncKey);
                this.showSyncToast(d.formatDashboardLabel('syncSettingsApplied', {}, 'Applied dashboard settings update.'));
            }
        } finally {
            d._configReturnRefreshInFlight = false;
        }
    }


    showSyncToast(message) {
        const d = this.dash;
        if (d.settings?.showSyncToasts === false) {
            return;
        }
        const now = Date.now();
        if (now - d.lastSyncToastAt < 2000) {
            return;
        }
        d.lastSyncToastAt = now;
        d.showNotification(message, 'success');
    }


    async refreshAfterConfigStructureUpdate(payload = {}) {
        const d = this.dash;
        if (d.isInlineEditActive()) {
            if (!(await d.confirmInlineEditBeforeNavigation())) {
                return;
            }
        }
        try {
            await d.loadData();
            await d.withRetry(() => d.loadPageBookmarks(d.currentPageId, { rethrow: true }), 2, 220);
            if (d.needsCrossPageBookmarks()) {
                await d.withRetry(() => d.loadAllBookmarks({ rethrow: true }), 2, 220);
            } else {
                d.allBookmarks = [];
            }
            d.renderPageNavigation();
            d.renderDashboard();
            d.initializeButtonTipsRotation();
            if (d.searchComponent) {
                d.updateSearchComponent();
            }
            d.updateHealthBadge();
        } catch (error) {
            console.warn('Config structure refresh failed:', error);
            d.showErrorNotification(
                d.formatDashboardLabel('syncConfigRefreshFailed', {}, 'Failed to sync config changes. Please try again.'),
                { retry: () => this.refreshAfterConfigStructureUpdate(payload) }
            );
            throw error;
        }
    }


    async refreshAfterConfigSettingsUpdate(payload = {}) {
        const d = this.dash;
        if (d.isInlineEditActive()) {
            if (!(await d.confirmInlineEditBeforeNavigation())) {
                return;
            }
        }
        try {
            await d.loadData();
            if (d.settings.language && d.settings.language !== d.language.currentLanguage) {
                await d.language.loadTranslations(d.settings.language);
            }
            d.applyVisualSettings();
            d.initializeAutoDarkMode();
            d.setupDOM();
            d.updateStatusMonitor();
            await d.withRetry(() => d.loadPageBookmarks(d.currentPageId, { rethrow: true }), 2, 220);
            if (d.needsCrossPageBookmarks()) {
                await d.withRetry(() => d.loadAllBookmarks({ rethrow: true }), 2, 220);
            } else {
                d.allBookmarks = [];
            }
            d.renderPageNavigation();
            d.renderDashboard();
            d.initializeButtonTipsRotation();
            if (d.searchComponent) {
                d.updateSearchComponent();
            }
            if (d.statusMonitor && d.settings.showStatus) {
                d.statusMonitor.refreshAllStatuses();
            }
        } catch (error) {
            console.warn('Config settings refresh failed:', error);
            d.showErrorNotification(
                d.formatDashboardLabel('syncConfigRefreshFailed', {}, 'Failed to apply settings update. Please try again.'),
                { retry: () => this.refreshAfterConfigSettingsUpdate(payload) }
            );
            throw error;
        }
    }


}

window.DashboardConfigSync = DashboardConfigSync;
