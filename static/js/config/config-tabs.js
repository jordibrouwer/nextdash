/**
 * Config tab lifecycle — open handlers, data reload, and colors leave guard.
 */
class ConfigTabs {
    constructor(config) {
        this.config = config;
    }

    get c() {
        return this.config;
    }

    async syncCategoriesTabToCurrentPage() {
        const pageId = this.c.getLastCategoriesPageId();
        if (Number(this.c.currentCategoriesPageId) !== pageId) {
            const flushed = await this.flushCategoriesPageBeforeSwitch();
            if (!flushed) {
                this.c.syncCategoriesPageSelectorUI(this.c.currentCategoriesPageId);
                return;
            }
        }
        this.c.currentCategoriesPageId = pageId;
        this.c.syncCategoriesPageSelectorUI(pageId);
        await this.c.loadPageCategories(pageId);
    }

    async onConfigCategoriesTabOpened() {
        await this.syncCategoriesTabToCurrentPage();
        if (this.c.hasSeenConfigCategoriesTour()) return;
        this.c.dismissOtherConfigTabTours('categories');
        this.c.scheduleConfigCategoriesTour();
    }

    async reloadTagsTabData() {
        try {
            await this.c.bookmarkStore.loadAll();
        } catch (error) {
            console.warn('Could not reload bookmarks for tags view', error);
        }
        try {
            this.c.tags?.refresh(this.c);
        } catch (error) {
            console.warn('Could not refresh tags tab', error);
        }
    }

    async onConfigTagsTabOpened() {
        await this.reloadTagsTabData();
        if (this.c.hasSeenConfigTagsTour()) return;
        if (this.c._configTagsTourActive || this.c._configTagsTourStarting) {
            return;
        }
        this.c.dismissOtherConfigTabTours('tags');
        this.c.scheduleConfigTagsTour();
    }

    cancelPendingFindersTabReload() {
        this.c._findersTabLoadSeq = (this.c._findersTabLoadSeq || 0) + 1;
    }

    async reloadFindersTabData(options = {}) {
        const seq = ++this.c._findersTabLoadSeq;
        const force = options.force === true;

        if (!force && this.c.savedSnapshot) {
            const currentFinders = JSON.stringify(this.c.findersData || []);
            const savedFinders = JSON.stringify(this.c.savedSnapshot.findersData || []);
            if (currentFinders !== savedFinders) {
                this.c.finders?.refresh(this.c);
                return;
            }
        }

        try {
            const loaded = await this.c.data.loadFinders();
            if (seq !== this.c._findersTabLoadSeq) {
                return;
            }
            this.c.findersData = window.ConfigFinders?.normalizeFinders
                ? window.ConfigFinders.normalizeFinders(loaded, this.c.generateId.bind(this.c))
                : loaded;
        } catch (error) {
            if (seq !== this.c._findersTabLoadSeq) {
                return;
            }
            console.warn('Could not reload finders', error);
        }
        if (seq !== this.c._findersTabLoadSeq) {
            return;
        }
        this.c.finders?.refresh(this.c);
    }

    async onConfigFindersTabOpened() {
        await this.reloadFindersTabData();
        if (this.c.hasSeenConfigFindersTour()) return;
        if (this.c._configFindersTourActive || this.c._configFindersTourStarting) {
            return;
        }
        this.c.dismissOtherConfigTabTours('finders');
        this.c.scheduleConfigFindersTour();
    }

    onConfigPagesTabOpened() {
        if (this.c.hasSeenConfigPagesTour()) return Promise.resolve();
        if (this.c._configPagesTourActive || this.c._configPagesTourStarting) {
            this.c.renderPagesTab();
            return Promise.resolve();
        }
        this.c.dismissOtherConfigTabTours('pages');
        const schedule = () => this.c.scheduleConfigPagesTour();
        this.c.renderPagesTab();
        schedule();
        return Promise.resolve();
    }

    onConfigCollectionsTabOpened() {
        if (this.c.hasSeenConfigCollectionsTour()) return Promise.resolve();
        if (this.c._configCollectionsTourActive || this.c._configCollectionsTourStarting) {
            return Promise.resolve();
        }
        this.c.dismissOtherConfigTabTours('collections');
        const schedule = () => this.c.scheduleConfigCollectionsTour();
        if (this.c.collections?.refresh) {
            try {
                this.c.collections.refresh(this.c);
            } catch {
                // ignore
            }
        }
        schedule();
        return Promise.resolve();
    }

    onConfigColorsTabOpened() {
        if (this.c.hasSeenConfigThemeTour()) return Promise.resolve();
        this.c.dismissOtherConfigTabTours('theme');
        const schedule = () => this.c.scheduleConfigThemeTour();
        if (typeof this.ensureColorsEditor === 'function') {
            return this.ensureColorsEditor().finally(schedule);
        }
        schedule();
        return Promise.resolve();
    }

    async ensureColorsEditor() {
        if (!document.getElementById('theme-colors-editor')) return;
        if (!this.c.colorsEditor) {
            this.c.colorsEditor = new ColorsEditor({
                root: document.getElementById('theme-colors-editor'),
                language: this.c.language,
                settings: this.c.settingsData,
                onDirtyChange: (dirty) => this.c.setColorsDirtyState(dirty),
            });
        }
        await this.c.colorsEditor.init();
    }

    async removeCustomTheme(themeId) {
        return this.c.colorsEditor?.removeCustomTheme(themeId);
    }

    async guardColorsTabLeave(targetTab) {
        if (this.c._configThemeTourActive || this.c._configThemeTourStarting) {
            return true;
        }
        if (this.c.ui._currentTab !== 'colors' || targetTab === 'colors') {
            if (targetTab === 'colors') await this.ensureColorsEditor();
            return true;
        }
        if (!this.c.colorsEditor?.isDirty()) return true;
        const ok = await this.c.colorsEditor.confirmLeave();
        if (ok && targetTab === 'colors') await this.ensureColorsEditor();
        return ok;
    }

    async flushCategoriesPageBeforeSwitch() {
        clearTimeout(this.c._categoryReorderPersistTimer);
        const pageId = Number(this.c.currentCategoriesPageId);
        if (!this.c.categoriesListHydrated || !Number.isFinite(pageId) || pageId < 1) {
            return true;
        }

        const fromDom = this.c.getCategoriesFromDOM();
        if (!fromDom) {
            return true;
        }

        const validationError = this.c.validateCategoriesData(fromDom);
        if (validationError) {
            this.c.ui.showNotification(validationError, 'error');
            return false;
        }

        try {
            this.c.categoriesData = fromDom;
            await this.c.withRetry(() => this.c.data.saveCategoriesByPage(fromDom, pageId));
            this.c.signalDashboardReload('category-page-switch');
            this.c.syncSnapshotAfterStructurePersist();
            return true;
        } catch (error) {
            console.error('Error flushing categories before page switch:', error);
            this.c.ui.showNotification(
                this.c.language.t('config.dashboardSyncFailed'),
                'error'
            );
            return false;
        }
    }


    installPublicMethods() {
        const c = this.config;
        const bind = (name) => {
            c[name] = (...args) => this[name](...args);
        };
        const methods = [
            'syncCategoriesTabToCurrentPage', 'onConfigCategoriesTabOpened',
            'reloadTagsTabData', 'onConfigTagsTabOpened',
            'cancelPendingFindersTabReload', 'reloadFindersTabData', 'onConfigFindersTabOpened',
            'onConfigPagesTabOpened', 'onConfigCollectionsTabOpened', 'onConfigColorsTabOpened',
            'ensureColorsEditor', 'removeCustomTheme', 'guardColorsTabLeave',
            'flushCategoriesPageBeforeSwitch',
        ];
        for (const name of methods) {
            bind(name);
        }
    }
}

window.ConfigTabs = ConfigTabs;
