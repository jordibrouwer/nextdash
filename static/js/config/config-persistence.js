/**
 * Config persistence — dirty tracking, snapshots, save/discard, and incremental sync.
 */
class ConfigPersistence {
    constructor(config) {
        this.config = config;
    }

    get c() {
        return this.config;
    }

    async persistTagsChanges(options = {}) {
        if (window.ConfigTags?.normalizeTagList) {
            for (const bm of this.c.bookmarkStore.getAll()) {
                bm.tags = window.ConfigTags.normalizeTagList(bm.tags);
            }
        }
        try {
            await this.saveAllBookmarkPages();
            this.signalDashboardReload(options.eventType || 'tags-updated');
            this.c.savedSnapshot = this.captureUndoSnapshot();
            this.setDirtyState(false);
            this.c.refreshBookmarksList();
            this.c.collections?.refresh?.(this.c);
            this.c.tags?.refresh?.(this.c);
            if (!options.silent) {
                this.showSyncToast(
                    this.c.language.t('config.dashboardSyncComplete'),
                    'success'
                );
            }
        } catch (error) {
            console.error('Error persisting tag changes:', error);
            this.showSyncToast(
                this.c.language.t('config.dashboardSyncFailed'),
                'error'
            );
            throw error;
        }
    }

    async saveAllBookmarkPages() {
        await this.c.bookmarkStore.persistAllPages((fn) => this.c.withRetry(fn));
    }

    async saveBookmarkPages(pageIds = []) {
        const ids = (Array.isArray(pageIds) ? pageIds : [])
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id >= 1);
        for (const pageId of ids) {
            await this.c.bookmarkStore.persistPage(pageId, (fn) => this.c.withRetry(fn));
        }
    }

    _getChangedBookmarkPageIds(savedPages = {}) {
        const changed = [];
        const seen = new Set();
        if (this.c.bookmarkStore?._byPage) {
            for (const [pageId, list] of this.c.bookmarkStore._byPage) {
                const pid = Number(pageId);
                if (!Number.isFinite(pid) || pid < 1) {
                    continue;
                }
                seen.add(pid);
                const previous = savedPages[pid] ?? savedPages[String(pid)] ?? [];
                if (JSON.stringify(list) !== JSON.stringify(previous)) {
                    changed.push(pid);
                }
            }
        }
        for (const key of Object.keys(savedPages || {})) {
            const pid = Number(key);
            if (!Number.isFinite(pid) || pid < 1 || seen.has(pid)) {
                continue;
            }
            const previous = savedPages[key];
            if (Array.isArray(previous) && previous.length > 0) {
                changed.push(pid);
            }
        }
        return changed.sort((a, b) => a - b);
    }

    async persistFindersChanges(options = {}) {
        this.c.findersData = window.ConfigFinders?.normalizeFinders
            ? window.ConfigFinders.normalizeFinders(this.c.findersData, this.c.generateId.bind(this.c))
            : this.c.findersData;
        const validationError = this.c.validateFindersData();
        if (validationError) {
            this.c.ui.showNotification(validationError, 'error');
            throw new Error(validationError);
        }
        const seq = (this.c._findersPersistSeq = (this.c._findersPersistSeq || 0) + 1);
        try {
            await this.c.data.saveFinders(this.c.findersData);
            if (seq !== this.c._findersPersistSeq) return;
            this.signalDashboardReload?.(options.eventType || 'finders-updated');
            this.c.savedSnapshot = this.captureUndoSnapshot();
            this.recomputeDirtyState();
            if (options.skipUiRefresh !== true) {
                this.c.finders?.refresh(this.c);
            }
            if (!options.silent) {
                this.showSyncToast(
                    this.c.language.t('config.dashboardSyncComplete'),
                    'success'
                );
            }
        } catch (error) {
            console.error('Error persisting finders:', error);
            if (!options.silent) {
                this.showSyncToast(
                    this.c.language.t('config.dashboardSyncFailed'),
                    'error'
                );
            }
            throw error;
        }
    }

    async confirmLeaveWithUnsavedChanges() {
        if (!this.c.isDirty) return true;
        if (!window.AppModal) {
            return window.confirm(this.c.language.t('config.unsavedChangesLeaveConfirm'));
        }

        const saveAndLeave = await window.AppModal.confirm({
            title: this.c.language.t('config.unsavedChangesTitle'),
            message: this.c.language.t('config.unsavedChangesSavePrompt'),
            confirmText: this.c.language.t('config.unsavedChangesSaveAndLeave'),
            cancelText: this.c.language.t('config.unsavedChangesMoreOptions')
        });
        if (saveAndLeave) {
            await this.saveChanges();
            return !this.c.isDirty;
        }

        return window.AppModal.danger({
            title: this.c.language.t('config.unsavedChangesLeaveTitle'),
            message: this.c.language.t('config.unsavedChangesLeaveMessage'),
            confirmText: this.c.language.t('config.unsavedChangesLeaveWithoutSaving'),
            cancelText: this.c.language.t('config.unsavedChangesStayHere')
        });
    }

    signalDashboardReload(eventType = 'structure-updated') {
        try {
            const payload = {
                type: eventType,
                sourceTabId: this.c.tabId,
                timestamp: Date.now()
            };
            localStorage.setItem(this.c.structureSyncEventKey, JSON.stringify(payload));
            sessionStorage.setItem('nextdash:pending-dashboard-structure-sync', JSON.stringify(payload));
        } catch (error) {
            // Keep config functional even if storage access is blocked.
        }
    }

    signalDashboardSettingsUpdated(eventType = 'settings-updated') {
        try {
            const payload = {
                type: eventType,
                sourceTabId: this.c.tabId,
                timestamp: Date.now()
            };
            localStorage.setItem(this.c.settingsSyncEventKey, JSON.stringify(payload));
            sessionStorage.setItem('nextdash:pending-dashboard-settings-sync', JSON.stringify(payload));
        } catch (error) {
            // Keep config functional even if storage access is blocked.
        }
    }

    showSyncToast(message, type = 'success') {
        if (this.c.settingsData?.showSyncToasts === false) {
            return;
        }
        const now = Date.now();
        if (now - this.c.lastSyncToastAt < 2000) {
            return;
        }
        this.c.lastSyncToastAt = now;
        this.c.ui.showNotification(message, type);
    }

    syncSnapshotAfterStructurePersist() {
        this.c.originalPagesData = JSON.parse(JSON.stringify(this.c.pagesData || []));
        this.c.savedSnapshot = this.captureUndoSnapshot();
        this.setDirtyState(false);
    }

    async persistPagesStructureAndRefresh(eventType = 'page-updated') {
        try {
            await this.c.withRetry(() => this.c.data.savePages(this.c.pagesData));
            await this.c.refreshStructureDependentUI();
            this.signalDashboardReload(eventType);
            this.syncSnapshotAfterStructurePersist();
            this.showSyncToast(
                this.c.language.t('config.dashboardSyncComplete'),
                'success'
            );
        } catch (error) {
            console.error('Error persisting page structure:', error);
            this.showSyncToast(
                this.c.language.t('config.dashboardSyncFailed'),
                'error'
            );
        }
    }

    validateCategoriesData(categories) {
        if (!Array.isArray(categories)) return this.c.language.t('config.categoryNameMustBeUnique');
        const seen = new Set();
        for (const category of categories) {
            const name = String(category?.name || '').trim().toLowerCase();
            if (!name || seen.has(name)) {
                return this.c.language.t('config.categoryNameMustBeUnique');
            }
            seen.add(name);
        }
        return null;
    }

    async persistCategoriesStructureAndRefresh(options = {}) {
        if (!this.c.currentCategoriesPageId) {
            return;
        }

        try {
            const categoriesForSelectedPage = await this.c.resolveCategoriesForSave(this.c.currentCategoriesPageId);
            const categoriesSaved = categoriesForSelectedPage !== null;
            if (categoriesSaved) {
                const validationError = this.validateCategoriesData(categoriesForSelectedPage);
                if (validationError) {
                    this.c.ui.showNotification(validationError, 'error');
                    await this.c.loadPageCategories(this.c.currentCategoriesPageId);
                    return;
                }
                this.c.categoriesData = categoriesForSelectedPage;
                await this.c.withRetry(() => this.c.data.saveCategoriesByPage(categoriesForSelectedPage, this.c.currentCategoriesPageId));
            }

            if (options.persistBookmarks === true) {
                const renameMap = options.categoryRenameMap || null;
                const bookmarksSavePageId = this.c.getResolvedBookmarksPageId();
                if (Number(bookmarksSavePageId) === Number(this.c.currentCategoriesPageId)) {
                    if (renameMap && renameMap.oldId && renameMap.newId && renameMap.oldId !== renameMap.newId) {
                        this.c.reassignBookmarkCategoryIds(renameMap.oldId, renameMap.newId);
                    }
                    if (categoriesSaved || renameMap) {
                        await this.c.saveBookmarksPage(bookmarksSavePageId, this.c.bookmarksData);
                    }
                } else {
                    const pageBookmarks = await this.c.withRetry(() => this.c.data.loadBookmarksByPage(this.c.currentCategoriesPageId));
                    let changed = false;
                    const categoryIdSet = new Set(this.c.categoriesData.map((category) => category.id));
                    const nextBookmarks = pageBookmarks.map((bookmark) => {
                        if (renameMap && bookmark.category === renameMap.oldId) {
                            changed = true;
                            return { ...bookmark, category: renameMap.newId };
                        }
                        if (bookmark.category && !categoryIdSet.has(bookmark.category)) {
                            if (!categoriesSaved) {
                                return bookmark;
                            }
                            changed = true;
                            return { ...bookmark, category: '' };
                        }
                        return bookmark;
                    });
                    if (changed) {
                        await this.c.saveBookmarksPage(this.c.currentCategoriesPageId, nextBookmarks);
                    }
                }
            }

            const categoriesPageId = Number(this.c.currentCategoriesPageId);
            await this.c.refreshCategoriesDependentUI();
            this.c.currentCategoriesPageId = categoriesPageId;
            this.c.saveLastCategoriesPageId(categoriesPageId);
            this.c.syncCategoriesPageSelectorUI(categoriesPageId);
            this.signalDashboardReload(options.eventType || 'category-updated');
            this.syncSnapshotAfterStructurePersist();
            if (!options.silent) {
                this.showSyncToast(
                    this.c.language.t('config.dashboardSyncComplete'),
                    'success'
                );
            }
        } catch (error) {
            console.error('Error persisting category structure:', error);
            if (!options.silent) {
                this.showSyncToast(
                    this.c.language.t('config.dashboardSyncFailed'),
                    'error'
                );
            }
        }
    }

    async autosaveLayoutSettings() {
        if (!this.c.settings?.saveSettingsToServer || this.c._layoutAutosaveInFlight) return false;
        this.c._layoutAutosaveInFlight = true;
        this.c.suppressDirtyTracking = true;
        let ok = false;
        try {
            if (this.c.deviceSpecific) {
                this.c.storage.saveDeviceSettings(this.c.settingsData);
                ok = true;
            } else if (this.c.settings?.saveSettingsToServer) {
                ok = await this.c.settings.saveSettingsToServer(this.c.settingsData);
            }
            if (ok) {
                this.onSettingsAutosaved();
                this.signalDashboardSettingsUpdated('settings-autosave');
            } else if (this.c.ui?.showNotification) {
                this.c.ui.showNotification(this.c.language.t('config.errorSavingConfig'), 'error');
            }
        } catch (error) {
            console.error('Layout settings autosave failed:', error);
            if (this.c.ui?.showNotification) {
                this.c.ui.showNotification(this.c.language.t('config.errorSavingConfig'), 'error');
            }
        } finally {
            this.c.suppressDirtyTracking = false;
            this.c._layoutAutosaveInFlight = false;
        }
        return ok;
    }

    async autosaveThemeSelection(theme) {
        if (theme) {
            this.c.settingsData.theme = theme;
        }
        const token = ++this.c._themeAutosaveToken;
        this.c.updateThemePreviewBadge({ saving: true });

        this.c.suppressDirtyTracking = true;

        let ok = false;
        try {
            if (this.c.deviceSpecific) {
                this.c.storage.saveDeviceSettings(this.c.settingsData);
                ok = true;
            } else {
                ok = await this.c.settings.saveSettingsToServer(this.c.settingsData);
            }
        } catch {
            ok = false;
        }
        this.c.suppressDirtyTracking = false;

        if (token !== this.c._themeAutosaveToken) return;

        if (ok) {
            this.c._persistedTheme = String(this.c.settingsData.theme || '');
            this.c.updateThemePreviewBadge();
            this.onSettingsAutosaved();
            const msg = this.c.language?.t('config.themeSaved');
            const text = msg && msg !== 'config.themeSaved' ? msg : 'Theme saved';
            if (window.AppNotification?.show) {
                window.AppNotification.show(text, 'success', { durationMs: 3000 });
            } else {
                this.c.ui.showNotification(text, 'success', { duration: 3000 });
            }
            this.signalDashboardSettingsUpdated('settings-autosave');
            return;
        }

        this.c.updateThemePreviewBadge();
        const errMsg = this.c.language?.t('config.themeSaveFailed');
        const errText = errMsg && errMsg !== 'config.themeSaveFailed'
            ? errMsg
            : 'Could not save theme — use Save to try again';
        if (window.AppNotification?.show) {
            window.AppNotification.show(errText, 'error', { durationMs: 5000 });
        } else {
            this.c.ui.showNotification(errText, 'error', { duration: 5000 });
        }
    }

    snapshotsEqual(a, b) {
        if (!a || !b) return false;
        return JSON.stringify(a) === JSON.stringify(b);
    }

    syncSavedSettingsSnapshot() {
        if (!this.c.savedSnapshot) {
            this.c.savedSnapshot = this.captureUndoSnapshot();
            return;
        }
        this.c.savedSnapshot.settingsData = JSON.parse(JSON.stringify(this.c.settingsData || {}));
    }

    recomputeDirtyState() {
        if (!this.c.savedSnapshot) {
            this.setDirtyState(false);
            return;
        }
        const current = this.captureUndoSnapshot();
        this.setDirtyState(!this.snapshotsEqual(current, this.c.savedSnapshot));
    }

    scheduleDirtyRecompute() {
        clearTimeout(this.c._dirtyRecomputeTimer);
        this.c._dirtyRecomputeTimer = setTimeout(() => this.recomputeDirtyState(), 150);
    }

    onSettingsAutosaved() {
        this.syncSavedSettingsSnapshot();
        this.recomputeDirtyState();
        if (!this.c.isDirty) {
            this.flashSavedIndicator();
        }
    }

    _shouldSyncSettingsFromUI(changeScope) {
        return changeScope.hasSettingsChanges === true;
    }

    _syncSettingsFromUIForSave(changeScope) {
        if (!this._shouldSyncSettingsFromUI(changeScope)) {
            return;
        }
        if (this.c.settings?.updateFromUI) {
            this.c.settings.updateFromUI(this.c.settingsData);
        }
        if (this.c.keyboard && typeof this.c.keyboard.getSaveData === 'function') {
            const keyboardData = this.c.keyboard.getSaveData();
            this.c.settingsData.customKeyBindings = keyboardData.customKeyBindings;
        }
    }

    getPendingChangeScope() {
        if (!this.c.savedSnapshot) {
            return {
                settingsOnly: false,
                hasStructuralChanges: true,
                hasSettingsChanges: true,
                hasCollectionsChanges: true,
                hasNonCollectionSettingsChanges: true,
                changedBookmarkPageIds: null,
                hasCategoriesChanges: true,
                hasFindersChanges: true,
                hasPagesChanges: true,
            };
        }
        const saved = this.c.savedSnapshot;
        const hasSettingsChanges = JSON.stringify(this.c.settingsData) !== JSON.stringify(saved.settingsData);
        const hasCollectionsChanges = JSON.stringify(this.c.settingsData?.collections ?? [])
            !== JSON.stringify(saved.settingsData?.collections ?? []);
        const hasNonCollectionSettingsChanges = JSON.stringify(
            this._settingsWithoutCollections(this.c.settingsData)
        ) !== JSON.stringify(this._settingsWithoutCollections(saved.settingsData));
        const changedBookmarkPageIds = this._getChangedBookmarkPageIds(saved.allBookmarkPages || {});
        const hasBookmarkChanges = changedBookmarkPageIds.length > 0;
        const hasCategoriesChanges = JSON.stringify(this.c.categoriesData) !== JSON.stringify(saved.categoriesData);
        const hasFindersChanges = JSON.stringify(this.c.findersData) !== JSON.stringify(saved.findersData);
        const hasPagesChanges = JSON.stringify(this.c.pagesData) !== JSON.stringify(saved.pagesData);
        const hasStructuralChanges = hasBookmarkChanges
            || hasCategoriesChanges
            || hasFindersChanges
            || hasPagesChanges;
        return {
            hasSettingsChanges,
            hasCollectionsChanges,
            hasNonCollectionSettingsChanges,
            hasStructuralChanges,
            settingsOnly: hasSettingsChanges && !hasStructuralChanges,
            changedBookmarkPageIds,
            hasCategoriesChanges,
            hasFindersChanges,
            hasPagesChanges,
        };
    }

    _settingsWithoutCollections(settings) {
        if (!settings || typeof settings !== 'object') return {};
        const copy = JSON.parse(JSON.stringify(settings));
        delete copy.collections;
        return copy;
    }

    setupDirtyTracking() {
        const root = document.querySelector('.config-main');
        if (!root) {
            return;
        }
        const mark = () => {
            this.scheduleDirtyRecompute();
            this.c.validateBookmarkConflicts({ showToast: false });
        };
        const shouldIgnoreTarget = (target) => {
            if (!target || !target.id) return false;
            return target.id === 'page-selector' || target.id === 'categories-page-selector' || target.id === 'bookmarks-category-filter' || target.id === 'packed-columns-checkbox' || target.id === 'bookmarks-search' || target.id === 'theme-select';
        };
        root.addEventListener('input', (event) => {
            if (this.c.suppressDirtyTracking) return;
            if (event.target && event.target.closest('#app-notification')) return;
            if (shouldIgnoreTarget(event.target)) return;
            mark();
        });
        root.addEventListener('change', (event) => {
            if (this.c.suppressDirtyTracking) return;
            if (event.target && event.target.closest('#app-notification')) return;
            if (shouldIgnoreTarget(event.target)) return;
            mark();
        });
        window.addEventListener('beforeunload', (event) => {
            if (this.c.isNavigatingAway) return;
            if (!this.c.isDirty && !this.hasUnsavedColorChanges()) return;
            event.preventDefault();
            event.returnValue = '';
        });
        this.setDirtyState(false);
    }

    flashSavedIndicator() {
        if (this.c.isDirty) return;
        this.updateSaveStatusUI('flash');
        clearTimeout(this.c._savedFlashTimer);
        this.c._savedFlashTimer = setTimeout(() => {
            if (!this.c.isDirty) {
                this.updateSaveStatusUI('saved');
            }
        }, 1500);
    }

    setupAutosaveLowRiskFields() {
        const selector = [
            '#show-tips-checkbox',
            '#show-config-button-checkbox',
            '#show-health-dashboard-checkbox',
            '#show-recent-button-checkbox',
            '#animations-enabled-checkbox',
            '#include-finders-in-search-checkbox',
            '#interleave-mode-checkbox',
            '#global-shortcuts-checkbox',
            '#show-sync-toasts-checkbox'
        ].join(', ');
        let debounceTimer = null;
        document.querySelectorAll(selector).forEach((el) => {
            el.addEventListener('change', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                    if (!this.c.settings?.updateFromUI) return;
                    this.c.suppressDirtyTracking = true;
                    this.c.settings.updateFromUI(this.c.settingsData);
                    let ok = false;
                    if (this.c.deviceSpecific) {
                        this.c.storage.saveDeviceSettings(this.c.settingsData);
                        ok = true;
                    } else {
                        ok = await this.c.settings.saveSettingsToServer(this.c.settingsData);
                    }
                    this.c.suppressDirtyTracking = false;
                    if (ok) {
                        this.onSettingsAutosaved();
                        this.signalDashboardSettingsUpdated('settings-autosave');
                    }
                }, 450);
            });
        });
    }

    setupStickySaveBar() {
        const sticky = document.getElementById('config-save-sticky');
        const saveSticky = document.getElementById('save-btn-sticky');
        const discardSticky = document.getElementById('discard-sticky-btn');
        saveSticky?.addEventListener('click', () => this.saveChanges());
        discardSticky?.addEventListener('click', () => this.discardChanges());
        if (!sticky) return;
        const onScroll = () => {
            const active = window.scrollY > 100 && this.c.isDirty;
            sticky.classList.toggle('is-scroll-active', active);
            document.body.classList.toggle('config-sticky-save-visible', active);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        this.c._stickySaveScrollHandler = onScroll;
        onScroll();
    }

    setColorsDirtyState(isDirty) {
        this.c.colorsDirty = isDirty === true;
        document.body.classList.toggle('colors-is-dirty', this.c.colorsDirty);
        window.ConfigTabGroups?.syncUnsavedIndicators?.(this.c);
    }

    getSaveButtons() {
        return [
            document.getElementById('save-btn'),
            document.getElementById('save-btn-sticky'),
        ].filter(Boolean);
    }

    _saveStatusText(state) {
        const lang = this.c.language;
        const map = {
            saved: ['config.savedShort', 'Saved'],
            unsaved: ['config.unsavedStatus', 'Unsaved'],
            saving: ['config.saving', 'Saving…'],
            flash: ['config.allSaved', 'All saved ✓'],
            failed: ['config.saveFailed', 'Save failed'],
        };
        const [key, fallback] = map[state] || map.saved;
        return lang?.t(key) || fallback;
    }

    updateSaveStatusUI(state = 'saved') {
        const saveStatus = document.getElementById('save-status-indicator');
        const stickyHint = document.querySelector('.config-save-sticky-hint');
        const badge = document.getElementById('unsaved-indicator');
        if (badge) {
            badge.classList.remove('is-visible');
        }
        if (!saveStatus) return;

        saveStatus.classList.remove('is-hidden', 'is-unsaved', 'is-saving', 'is-saved-flash', 'is-save-failed');
        saveStatus.textContent = this._saveStatusText(state);

        if (state === 'unsaved') {
            saveStatus.classList.add('is-unsaved');
        } else if (state === 'saving') {
            saveStatus.classList.add('is-saving');
        } else if (state === 'flash') {
            saveStatus.classList.add('is-saved-flash');
        } else if (state === 'failed') {
            saveStatus.classList.add('is-save-failed', 'is-unsaved');
        }

        if (stickyHint) {
            stickyHint.textContent = state === 'unsaved'
                ? (this.c.language?.t('config.unsavedStickyHint') || 'You have unsaved changes')
                : saveStatus.textContent;
        }
    }

    setDirtyState(isDirty) {
        this.c.isDirty = isDirty === true;
        const saveButtons = this.getSaveButtons();
        const undoTopBtn = document.getElementById('undo-top-btn');
        const discardTopBtn = document.getElementById('discard-top-btn');
        saveButtons.forEach((saveBtn) => {
            saveBtn.classList.toggle('has-unsaved', this.c.isDirty);
        });
        this.updateSaveStatusUI(this.c.isDirty ? 'unsaved' : 'saved');
        if (undoTopBtn) {
            undoTopBtn.disabled = !this.c.undoSnapshot;
            undoTopBtn.classList.toggle('is-visible', this.c.isDirty && !!this.c.undoSnapshot);
        }
        if (discardTopBtn) {
            discardTopBtn.disabled = !this.c.isDirty;
            discardTopBtn.classList.toggle('is-visible', this.c.isDirty);
        }
        document.body.classList.toggle('config-is-dirty', this.c.isDirty);
        if (!this.c.isDirty) {
            document.body.classList.remove('config-sticky-save-visible');
        }
        if (this.c._stickySaveScrollHandler) {
            this.c._stickySaveScrollHandler();
        }
        window.ConfigTabGroups?.syncUnsavedIndicators?.(this.c);
    }

    markDirty() {
        this.setDirtyState(true);
        this.scheduleDirtyRecompute();
    }

    clearDirty() {
        this.setDirtyState(false);
    }

    captureUndoSnapshot() {
        const allBookmarkPages = {};
        if (this.c.bookmarkStore?._byPage) {
            for (const [pageId, list] of this.c.bookmarkStore._byPage) {
                allBookmarkPages[pageId] = JSON.parse(JSON.stringify(list || []));
            }
        }
        return {
            bookmarksData: JSON.parse(JSON.stringify(this.c.bookmarksData || [])),
            allBookmarkPages,
            categoriesData: JSON.parse(JSON.stringify(this.c.categoriesData || [])),
            findersData: JSON.parse(JSON.stringify(this.c.findersData || [])),
            settingsData: JSON.parse(JSON.stringify(this.c.settingsData || {})),
            pagesData: JSON.parse(JSON.stringify(this.c.pagesData || [])),
            currentPageId: this.c.currentPageId,
            currentCategoriesPageId: this.c.currentCategoriesPageId,
            currentBookmarksCategoryFilter: this.c.currentBookmarksCategoryFilter
        };
    }

    restoreUndoSnapshot(snapshot) {
        if (!snapshot) return;
        this.c.suppressDirtyTracking = true;
        if (snapshot.allBookmarkPages && Object.keys(snapshot.allBookmarkPages).length > 0 && this.c.bookmarkStore?._byPage) {
            for (const [pageId, list] of Object.entries(snapshot.allBookmarkPages)) {
                this.c.bookmarkStore.setPage(Number(pageId), list);
            }
        } else {
            this.c.bookmarksData = snapshot.bookmarksData;
        }
        this.c.categoriesData = snapshot.categoriesData;
        this.c.findersData = snapshot.findersData;
        this.c.settingsData = snapshot.settingsData;
        this.c.pagesData = snapshot.pagesData;
        this.c.currentPageId = snapshot.currentPageId;
        this.c.currentCategoriesPageId = snapshot.currentCategoriesPageId;
        this.c.currentBookmarksCategoryFilter = snapshot.currentBookmarksCategoryFilter || '__all__';
        this.c.renderConfig();
        this.c.initReordering();
        this.c.refreshBookmarksFilterOptions();
        this.c.refreshBookmarksList();
        this.c.suppressDirtyTracking = false;
        this.markDirty();
    }

    showUndoNotification(message, snapshot = null, options = {}) {
        const activeSnapshot = snapshot || this.captureUndoSnapshot();
        if (!activeSnapshot) return;
        this.c.undoSnapshot = activeSnapshot;
        this.setDirtyState(this.c.isDirty);
        this.c.ui.showNotification(message, 'warning', {
            actionLabel: this.c.language.t('config.undoShort') || 'Undo',
            durationMs: 8000,
            onAction: () => {
                void (async () => {
                    this.restoreUndoSnapshot(this.c.undoSnapshot);
                    this.c.undoSnapshot = null;
                    if (options.persistTags && this.persistTagsChanges) {
                        try {
                            await this.persistTagsChanges({ silent: true });
                        } catch {
                            // restoreUndoSnapshot already marked dirty for manual save
                        }
                    }
                    if (options.persistFinders && this.persistFindersChanges) {
                        try {
                            await this.persistFindersChanges({ silent: true });
                        } catch {
                            // restoreUndoSnapshot already marked dirty for manual save
                        }
                    }
                    this.setDirtyState(this.c.isDirty);
                    this.c.ui.showNotification(this.c.language.t('config.undone') || 'Undone.', 'success');
                })();
            }
        });
    }

    hasUnsavedColorChanges() {
        return Boolean(this.c.colorsEditor?.isDirty());
    }

    async discardChanges() {
        if (!this.c.isDirty) {
            return;
        }
        const confirmed = await window.AppModal.danger({
            title: 'Discard unsaved changes',
            message: 'Revert all unsaved changes from this session?',
            confirmText: 'Discard',
            cancelText: 'Cancel'
        });
        if (!confirmed) {
            return;
        }
        window.location.reload();
    }

    _completeSaveUi({ changeScope, duplicateUrls }) {
        const saveFeedback = this.c.buildConfigSaveFeedback(duplicateUrls, changeScope);
        if (saveFeedback) {
            this.c.ui.replaceNotification(
                saveFeedback.message,
                saveFeedback.type,
                saveFeedback.options
            );
        } else {
            this.c.ui.hideNotification();
        }
        this.clearDirty();
        this.flashSavedIndicator();
        this.c.undoSnapshot = null;
        this.c.savedSnapshot = this.captureUndoSnapshot();
        this.c._persistedTheme = String(this.c.settingsData.theme || '');
        this.c.updateThemePreviewBadge();
        this.setDirtyState(false);
        if (typeof this.c._persistGeneralPanelState === 'function') {
            this.c._persistGeneralPanelState();
        }
    }

    async _refreshAfterSave(changeScope) {
        this.c.refreshSmartCollectionCounters();
        if (!changeScope.hasStructuralChanges) {
            this.c.settings?.refreshStatusEssentialsSummary?.(this.c.settingsData, this.c.allBookmarksData);
            if (this.c.stats && this.c.isConfigStatsTabActive()) {
                this.c.stats.refresh(this.c);
            }
            return;
        }
        try {
            await this.c.bookmarkStore.loadAll();
        } catch (error) {
            // keep previous store state
        }
        this.c.settings?.refreshStatusEssentialsSummary?.(this.c.settingsData, this.c.allBookmarksData);
        if (this.c.stats && this.c.isConfigStatsTabActive()) {
            this.c.stats.refresh(this.c);
        }
    }

    async saveChanges() {
        const conflicts = this.c.validateBookmarkConflicts({ showToast: true });
        if (conflicts.hasConflicts) {
            return;
        }
        const finderValidationError = this.c.validateFindersData();
        if (finderValidationError) {
            this.c.ui.showNotification(finderValidationError, 'error');
            return;
        }
        this.c.findersData = window.ConfigFinders?.normalizeFinders
            ? window.ConfigFinders.normalizeFinders(this.c.findersData, this.c.generateId.bind(this.c))
            : this.c.findersData;
        const changeScope = this.getPendingChangeScope();
        const needsFullPersist = !this.c.savedSnapshot;
        this.updateSaveStatusUI('saving');
        this.c.ui.showNotification(this.c.language.t('config.savingChanges'), 'info', { persist: true });

        try {
            this._syncSettingsFromUIForSave(changeScope);

            const saveBookmarksPageId = this.c.getResolvedBookmarksPageId();
            this.c.currentPageId = saveBookmarksPageId;

            if (Number.isFinite(saveBookmarksPageId) && saveBookmarksPageId >= 1) {
                this.c.settingsData.currentPage = saveBookmarksPageId;
            }

            const duplicateUrls = this.c.findDuplicateBookmarkUrls(this.c.bookmarksData);

            // Settings first so flags like allowLocalBookmarks apply before bookmark URL validation.
            if (changeScope.hasSettingsChanges) {
                if (this.c.deviceSpecific) {
                    this.c.storage.saveDeviceSettings(this.c.settingsData);
                } else {
                    await this.c.data.saveSettings(this.c.settingsData);
                    // Defer clearing the device-local cache until all saves below
                    // succeed, so a later failure leaves the local state intact for
                    // a retry instead of wiping it mid-way through a partial save.
                }
            }

            if (needsFullPersist || changeScope.changedBookmarkPageIds === null) {
                await this.saveAllBookmarkPages();
            } else if (changeScope.changedBookmarkPageIds.length > 0) {
                await this.saveBookmarkPages(changeScope.changedBookmarkPageIds);
            }

            if (needsFullPersist || changeScope.hasFindersChanges) {
                await this.c.data.saveFinders(this.c.findersData);
            }

            if ((needsFullPersist || changeScope.hasCategoriesChanges) && this.c.currentCategoriesPageId) {
                const categoriesForSelectedPage = await this.c.resolveCategoriesForSave(this.c.currentCategoriesPageId);
                if (categoriesForSelectedPage !== null) {
                    this.c.categoriesData = categoriesForSelectedPage.map((cat) => ({ ...cat }));
                    await this.c.data.saveCategoriesByPage(categoriesForSelectedPage, this.c.currentCategoriesPageId);
                }
            }

            if (needsFullPersist || changeScope.hasPagesChanges) {
                await this.c.data.savePages(this.c.pagesData);
            }

            // All server saves succeeded — now safe to drop the device-local cache
            // (server settings are authoritative). Deferred from the settings save
            // above so a mid-save failure doesn't wipe device state.
            if (changeScope.hasSettingsChanges && !this.c.deviceSpecific) {
                this.c.storage.clearDeviceSettings();
            }

            this.c.originalPagesData = JSON.parse(JSON.stringify(this.c.pagesData));
            this.c.refreshPageDropdowns();
            // Signal the right kind of dashboard sync: the dashboard's structure
            // refresh re-reads settings too (it's a superset of the settings
            // refresh), so send it whenever any structural data changed; otherwise
            // a settings-only save needs just the lighter settings signal. This
            // avoids a redundant full settings reload on a structure-only save.
            const hasStructuralChanges = needsFullPersist
                || changeScope.hasStructuralChanges === true
                || changeScope.changedBookmarkPageIds === null;
            if (hasStructuralChanges) {
                this.signalDashboardReload('settings-saved');
            } else if (changeScope.hasSettingsChanges) {
                this.signalDashboardSettingsUpdated('settings-saved');
            }
            this._completeSaveUi({ changeScope, duplicateUrls });
            void this._refreshAfterSave(changeScope);
        } catch (error) {
            console.error('Error saving configuration:', error);
            this.c.ui.hideNotification();
            this.updateSaveStatusUI('failed');
            const message = String(error?.message || '');
            if (message.toLowerCase().includes('duplicate shortcut')) {
                this.c.ui.showNotification(message, 'error');
            } else if (message.toLowerCase().includes('url host is not allowed')) {
                this.c.ui.showNotification(
                    this.c.language.t('config.bookmarkUrlHostNotAllowed')
                        || 'A bookmark uses a local or private URL. Enable Allow local bookmarks in General → Advanced, or change the URL.',
                    'error'
                );
            } else if (message.startsWith('Failed to save ')) {
                this.c.ui.showNotification(message, 'error');
            } else {
                this.c.ui.showNotification(this.c.language.t('config.errorSavingConfig'), 'error');
            }
        }
    }

    async persistRepairedPagesIfNeeded() {
        if (!this.c._pagesRepairedOnLoad) {
            return;
        }
        try {
            await this.c.withRetry(() => this.c.data.savePages(this.c.pagesData));
            this.c.originalPagesData = JSON.parse(JSON.stringify(this.c.pagesData));
            this.signalDashboardReload('pages-repaired');
            // Keep flag until reloadPagesFromServerIfNeeded confirms sync
        } catch (error) {
            console.warn('Auto-persist of default page structure failed:', error);
        }
    }


    installPublicMethods() {
        const c = this.config;
        const bind = (name) => {
            c[name] = (...args) => this[name](...args);
        };
        const methods = [
            'snapshotsEqual', 'syncSavedSettingsSnapshot', 'recomputeDirtyState', 'scheduleDirtyRecompute',
            'onSettingsAutosaved', 'getPendingChangeScope', 'setupDirtyTracking', 'flashSavedIndicator',
            'setupAutosaveLowRiskFields', 'setupStickySaveBar', 'setColorsDirtyState', 'getSaveButtons',
            'setDirtyState', 'markDirty', 'clearDirty', 'captureUndoSnapshot', 'restoreUndoSnapshot',
            'showUndoNotification', 'hasUnsavedColorChanges', 'saveChanges', 'discardChanges',
            'persistTagsChanges', 'persistFindersChanges', 'persistPagesStructureAndRefresh',
            'persistCategoriesStructureAndRefresh', 'syncSnapshotAfterStructurePersist', 'saveAllBookmarkPages',
            'signalDashboardReload', 'signalDashboardSettingsUpdated', 'showSyncToast',
            'autosaveLayoutSettings', 'autosaveThemeSelection', 'confirmLeaveWithUnsavedChanges',
            'persistRepairedPagesIfNeeded', 'validateCategoriesData',
        ];
        for (const name of methods) {
            bind(name);
        }
    }
}

window.ConfigPersistence = ConfigPersistence;
