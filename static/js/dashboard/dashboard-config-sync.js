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
                // A refresh is already running; this event's pending marker survives in
                // sessionStorage and is drained by maybeRefreshAfterConfigReturn() below.
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
                    const structureTs = payload?.timestamp || Date.now();
                    d.lastAppliedStructureSyncAt = structureTs;
                    try {
                        sessionStorage.removeItem(d.pendingStructureSyncKey);
                        // The structure refresh is a superset of a settings refresh, so
                        // any pending settings sync at or before it is already applied.
                        const settingsPending = this.readPendingConfigSync(d.pendingSettingsSyncKey);
                        if (settingsPending && settingsPending.timestamp <= structureTs) {
                            d.lastAppliedSettingsSyncAt = Math.max(d.lastAppliedSettingsSyncAt, settingsPending.timestamp);
                            sessionStorage.removeItem(d.pendingSettingsSyncKey);
                        }
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
            // Drain any sync event that arrived (and was skipped) while the refresh
            // above held the in-flight guard, so a second edit isn't left until the
            // next pageshow/visibilitychange.
            void this.maybeRefreshAfterConfigReturn();
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


    setupDataRevisionListener() {
        const d = this.dash;
        const checkRevision = () => {
            if (document.visibilityState && document.visibilityState !== 'visible') {
                return;
            }
            void d.data?.refreshIfDataRevisionChanged?.();
        };
        document.addEventListener('visibilitychange', checkRevision);
        window.addEventListener('focus', checkRevision);
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
        d.inbox?.clearKeyboardSelection?.();
        d.inbox?.restoreViewIfNeeded?.();
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
        // Bootstrap loadData() in init() already fetched current API state. Consuming
        // pending markers here avoids a redundant re-fetch + double renderDashboard()
        // flash (empty columns) on every full reload after config edits.
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
            let structureApplied = false;
            if (structureTs > d.lastAppliedStructureSyncAt) {
                await this.refreshAfterConfigStructureUpdate(structurePending || {});
                d.lastAppliedStructureSyncAt = structureTs;
                sessionStorage.removeItem(d.pendingStructureSyncKey);
                structureApplied = true;
                // The structure refresh is a superset of the settings refresh (same
                // loadData + re-render), so a settings sync at or before it is already
                // applied — consume its marker instead of running a second full reload.
                if (settingsTs > 0 && settingsTs <= structureTs) {
                    d.lastAppliedSettingsSyncAt = Math.max(d.lastAppliedSettingsSyncAt, settingsTs);
                    sessionStorage.removeItem(d.pendingSettingsSyncKey);
                }
                this.showSyncToast(d.formatDashboardLabel('syncConfigChanges', {}, 'Synced config changes.'));
            }

            if (settingsTs > d.lastAppliedSettingsSyncAt) {
                await this.refreshAfterConfigSettingsUpdate(settingsPending || {});
                d.lastAppliedSettingsSyncAt = settingsTs;
                sessionStorage.removeItem(d.pendingSettingsSyncKey);
                if (!structureApplied) {
                    this.showSyncToast(d.formatDashboardLabel('syncSettingsApplied', {}, 'Applied dashboard settings update.'));
                }
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
        await this._refreshAfterConfigUpdate({
            payload,
            renderOptions: { animate: false },
            updateHealthBadge: true,
            failureMessage: 'Failed to sync config changes. Please try again.',
            warnLabel: 'Config structure refresh failed:',
            retry: () => this.refreshAfterConfigStructureUpdate(payload)
        });
    }


    async refreshAfterConfigSettingsUpdate(payload = {}) {
        await this._refreshAfterConfigUpdate({
            payload,
            renderOptions: { animate: false, incremental: false },
            updateHealthBadge: false,
            failureMessage: 'Failed to apply settings update. Please try again.',
            warnLabel: 'Config settings refresh failed:',
            retry: () => this.refreshAfterConfigSettingsUpdate(payload)
        });
    }


    async _refreshAfterConfigUpdate({ renderOptions, updateHealthBadge, failureMessage, warnLabel, retry }) {
        const d = this.dash;
        if (d.isInlineEditActive()) {
            if (!(await d.confirmInlineEditBeforeNavigation())) {
                return;
            }
        }
        try {
            d.data?.invalidatePageDataCache?.();
            await d.loadData({ skipPageBookmarks: true });
            if (d.settings.language && d.settings.language !== d.language.currentLanguage) {
                await d.language.loadTranslations(d.settings.language);
            }
            d.applyVisualSettings();
            d.initializeAutoDarkMode();
            d.setupDOM();
            d.updateStatusMonitor();
            await d.withRetry(
                () => d.loadPageBookmarks(d.currentPageId, { rethrow: true, skipRender: true }),
                2,
                220
            );
            if (d.needsCrossPageBookmarks()) {
                await d.withRetry(() => d.loadAllBookmarks({ rethrow: true }), 2, 220);
            } else {
                d.allBookmarks = [];
            }
            d.renderPageNavigation();
            d.inbox?.applySettingsChange?.();
            d.renderDashboard(renderOptions);
            d.initializeButtonTipsRotation();
            if (d.searchComponent) {
                d.updateSearchComponent();
            }
            if (d.statusMonitor && d.settings.showStatus) {
                d.statusMonitor.refreshAllStatuses();
            }
            if (updateHealthBadge) {
                d.updateHealthBadge();
            }
        } catch (error) {
            console.warn(warnLabel, error);
            d.showErrorNotification(
                d.formatDashboardLabel('syncConfigRefreshFailed', {}, failureMessage),
                { retry }
            );
            throw error;
        }
    }


}

window.DashboardConfigSync = DashboardConfigSync;
