/**
 * Config setup — DOM initialization and event listener wiring.
 */
class ConfigSetup {
    constructor(config) {
        this.config = config;
    }

    get c() {
        return this.config;
    }

    setupDOM() {
        this.c.settings.applyAutoDarkMode(this.c.settingsData.autoDarkMode, this.c.settingsData);
        this.c.settings.applyFontSize(this.c.settingsData.fontSize);
        this.c.settings.applyBackgroundDots(this.c.settingsData.showBackgroundDots);
        this.c.settings.applyAnimations(this.c.settingsData.animationsEnabled);
        if (window.LayoutUtils) {
            this.c.settingsData.layoutPreset = window.LayoutUtils.applyLayoutPreset(this.c.settingsData, this.c.settingsData.layoutPreset || 'default');
        } else {
            document.body.setAttribute('data-layout-preset', this.c.settingsData.layoutPreset || 'default');
        }
        if (window.LayoutVersionUtils) {
            // saveSettings:false — this only re-applies the value we just loaded.
            // Saving here would POST the whole settings object on every render and
            // clobber anything written since load (e.g. the tab intro panels).
            this.c.settingsData.layoutVersion = window.LayoutVersionUtils.applyLayoutVersion(
                this.c.settingsData,
                this.c.settingsData.layoutVersion || 'classic',
                { saveSettings: false }
            );
        } else {
            const normalized = (this.c.settingsData.layoutVersion || 'classic').toLowerCase().trim();
            const layoutVersion = ['classic', 'modern'].includes(normalized) ? normalized : 'classic';
            this.c.settingsData.layoutVersion = layoutVersion;
            document.documentElement.setAttribute('data-layout-version', layoutVersion);
            document.body.setAttribute('data-layout-version', layoutVersion);
        }
        document.body.setAttribute('data-density-mode', this.c.settingsData.densityMode || 'compact');
        this.c.settings.applyBackground(this.c.settingsData);
        this.c.settings.applyBackgroundOpacity(this.c.settingsData.backgroundOpacity);
        this.c.settings.applyFontWeight(this.c.settingsData.fontWeight);
        if (window.DashboardFont) {
            window.DashboardFont.applyMainFont(this.c.settingsData);
        }
    }

    async setupEventListeners() {
        // Setup input validation
        this.c.setupInputValidation();
        
        // Setup settings listeners with callbacks
        await this.c.settings.setupListeners(this.c.settingsData, {
            onThemeChange: async (theme) => {
                const displayTheme = window.VisualSettings?.resolveTheme?.(this.c.settingsData) || theme;
                this.c.settings.applyTheme(displayTheme);
                this.c.settings.reloadThemeCSS();
                this.c.settings.updateAutoPreview(displayTheme);
                this.c.settings.applyBackground(this.c.settingsData);
                try { this.c.initThemeIconStylingControls(); } catch (e) {}
                await this.c.autosaveThemeSelection(theme);
            },
            onFontSizeChange: (fontSize) => {
                this.c.settings.applyFontSize(fontSize);
            },
            onBackgroundDotsChange: (show) => {
                this.c.settings.applyBackgroundDots(show);
            },
            onAnimationsChange: (enabled) => {
                this.c.settings.applyAnimations(enabled);
            },
            onLayoutVersionChange: async (layoutVersion) => {
                if (window.LayoutVersionUtils) {
                    this.c.settingsData.layoutVersion = window.LayoutVersionUtils.applyLayoutVersion(
                        this.c.settingsData,
                        layoutVersion || 'classic'
                    );
                } else {
                    const normalized = (layoutVersion || 'classic').toLowerCase().trim();
                    const version = ['classic', 'modern'].includes(normalized) ? normalized : 'classic';
                    this.c.settingsData.layoutVersion = version;
                    document.documentElement.setAttribute('data-layout-version', version);
                    document.body.setAttribute('data-layout-version', version);
                }
                await this.c.autosaveLayoutSettings();
            },
            onLayoutPresetChange: async (preset) => {
                if (window.LayoutUtils) {
                    this.c.settingsData.layoutPreset = window.LayoutUtils.applyLayoutPreset(this.c.settingsData, preset || 'default');
                } else {
                    this.c.settingsData.layoutPreset = preset || 'default';
                    document.body.setAttribute('data-layout-preset', preset || 'default');
                }
                await this.c.autosaveLayoutSettings();
            },
            onDensityModeChange: async (densityMode) => {
                const normalizedDensity = ['comfortable', 'compact', 'dense', 'auto'].includes(densityMode) ? densityMode : 'compact';
                this.c.settingsData.densityMode = normalizedDensity;
                document.body.setAttribute('data-density-mode', normalizedDensity);
                await this.c.autosaveLayoutSettings();
            },
            onBackgroundOpacityChange: (value) => {
                this.c.settings.applyBackgroundOpacity(value);
            },
            onFontWeightChange: (value) => {
                this.c.settings.applyFontWeight(value);
            },
            onFontPresetChange: () => {
                if (window.DashboardFont) {
                    window.DashboardFont.applyMainFont(this.c.settingsData);
                }
            },
            onAutoDarkModeChange: (enabled) => {
                this.c.settings.applyAutoDarkMode(enabled, this.c.settingsData);
            },
            onStatusVisibilityChange: () => {
                this.c.settings.updateStatusOptionsVisibility(this.c.settingsData.showStatus);
                this.c.settings.refreshStatusEssentialsSummary(this.c.settingsData, this.c.allBookmarksData);
            },
            onLauncherIconSizeChange: async () => {
                this.c.settings.updateFromUI(this.c.settingsData);
                if (this.c.deviceSpecific) {
                    this.c.storage.saveDeviceSettings(this.c.settingsData);
                } else {
                    await this.c.settings.saveSettingsToServer(this.c.settingsData);
                }
                this.c.onSettingsAutosaved();
                this.c.signalDashboardSettingsUpdated('settings-updated');
            },
            onCalendarUrlChange: async () => {
                this.c.settings.updateFromUI(this.c.settingsData);
                await this.c.settings.saveSettingsToServer(this.c.settingsData);
                this.c.onSettingsAutosaved();
                this.c.signalDashboardSettingsUpdated('settings-updated');
            },
            onButtonBarPositionChange: async () => {
                this.c.settings.updateFromUI(this.c.settingsData);
                const ok = await this.c.settings.saveSettingsToServer(this.c.settingsData);
                if (!ok) {
                    this.c.ui.showNotification(this.c.language.t('config.buttonBarPositionSaveError'), 'error');
                    return;
                }
                this.c.onSettingsAutosaved();
                this.c.signalDashboardSettingsUpdated('settings-updated');
                this.c.ui.showNotification(this.c.language.t('config.buttonBarPositionSaved'), 'success');
            },
            onPackedColumnsChange: async () => {
                this.c.settings.updateFromUI(this.c.settingsData);
                let ok = true;
                if (this.c.deviceSpecific) {
                    this.c.storage.saveDeviceSettings(this.c.settingsData);
                } else {
                    ok = await this.c.settings.saveSettingsToServer(this.c.settingsData);
                }
                if (!ok) {
                    this.c.ui.showNotification(this.c.language.t('config.packedColumnsSaveError'), 'error');
                    return;
                }
                this.c.onSettingsAutosaved();
                this.c.signalDashboardSettingsUpdated('settings-updated');
                const on = this.c.settingsData.packedColumns === true;
                this.c.ui.showNotification(
                    this.c.language.t(on ? 'config.packedColumnsSavedOn' : 'config.packedColumnsSavedOff'),
                    'success'
                );
            },
            onNotify: (message, type) => {
                this.c.ui.showNotification(message, type);
            },
            onBookmarkPreviewsChanged: async () => {
                if (this.c.bookmarkStore) {
                    await this.c.bookmarkStore.loadAll();
                }
                const pageId = this.c.currentPageId || 1;
                await this.c.loadPageBookmarks(pageId);
                this.c.refreshBookmarksList({ skipFlush: true });
            },
        });
    
        const deviceSpecificCheckbox = document.getElementById('device-specific-checkbox');
        if (deviceSpecificCheckbox) {
            deviceSpecificCheckbox.checked = this.c.deviceSpecific;
            deviceSpecificCheckbox.addEventListener('change', async (e) => {
                this.c.deviceSpecific = e.target.checked;
                this.c.storage.setDeviceSpecificFlag(this.c.deviceSpecific);
                
                const message = this.c.deviceSpecific 
                    ? this.c.language.t('config.deviceSpecificEnabled')
                    : this.c.language.t('config.deviceSpecificDisabled');
                
                if (this.c.deviceSpecific) {
                    this.c.storage.saveDeviceSettings(this.c.settingsData);
                } else {
                    this.c.storage.clearDeviceSettings();
                }
                this.c.ui.showNotification(message, 'success');
            });
        }
    
        const resetOnboardingBtn = document.getElementById('reset-onboarding-btn');
        if (resetOnboardingBtn) {
            resetOnboardingBtn.addEventListener('click', async () => {
                this.c.settingsData.onboardingCompleted = false;
                // Reset server-side quick-start progress so the setup card + checklist
                // show again (state is per-user in settings JSON, not localStorage).
                this.c.settingsData.quickStart = {
                    setupDone: false,
                    dismissed: false,
                    visitedConfig: false,
                    seenCheatsheet: false,
                };
                const ok = await this.c.settings.saveSettingsToServer(this.c.settingsData);
                if (!ok) {
                    this.c.ui.showNotification(this.c.language.t('config.resetOnboardingError'), 'error');
                    return;
                }
                this.c.signalDashboardSettingsUpdated('settings-updated');
                this.c.ui.showNotification(this.c.language.t('config.resetOnboardingSuccess'), 'success');
            });
        }
    
        window.ConfigPwaInstall?.bind?.(document.getElementById('pwa-install-panel'));
    
        this.c.settings.updateStatusOptionsVisibility(this.c.settingsData.showStatus);
    
        this.c.settings.attachSettingResetButtons(this.c.settingsData, () => this.c.markDirty());
    
        const addPageBtn = document.getElementById('add-page-btn');
        if (addPageBtn) addPageBtn.addEventListener('click', () => this.c.addPage());
    
        const addCategoryBtn = document.getElementById('add-category-btn');
        if (addCategoryBtn) addCategoryBtn.addEventListener('click', () => this.c.addCategory());
    
        const addBookmarkMenu = document.getElementById('bookmark-add-menu');
        const closeAddBookmarkMenu = () => {
            if (addBookmarkMenu) addBookmarkMenu.open = false;
        };
    
        const addBookmarkBtn = document.getElementById('add-bookmark-btn');
        if (addBookmarkBtn) {
            addBookmarkBtn.addEventListener('click', () => {
                closeAddBookmarkMenu();
                this.c.addBookmark();
            });
        }
    
        if (window.ConfigQuickAdd) {
            this.c.quickAdd = new window.ConfigQuickAdd(this.c);
            const quickAddBtn = document.getElementById('config-quick-add-btn');
            if (quickAddBtn) {
                quickAddBtn.addEventListener('click', () => {
                    closeAddBookmarkMenu();
                    this.c.quickAdd.open();
                });
            }
        }
    
        const structureAddBookmarkBtn = document.getElementById('structure-add-bookmark-btn');
        if (structureAddBookmarkBtn) structureAddBookmarkBtn.addEventListener('click', () => this.c.addBookmark());

        document.querySelectorAll('[data-structure-goto-tab]').forEach((link) => {
            link.addEventListener('click', () => {
                const tab = link.getAttribute('data-structure-goto-tab');
                if (tab) this.c.ui.switchToTab(tab);
            });
        });
    
        const selectAllBookmarksBtn = document.getElementById('select-all-bookmarks-btn');
        if (selectAllBookmarksBtn) {
            selectAllBookmarksBtn.textContent = this.c.language.t('config.selectShort') || 'select all';
            selectAllBookmarksBtn.addEventListener('click', () => {
                this.c.bookmarks.selectAllVisible();
            });
        }
    
        const clearBookmarkSelectionBtn = document.getElementById('clear-bookmark-selection-btn');
        if (clearBookmarkSelectionBtn) {
            clearBookmarkSelectionBtn.textContent = this.c.language.t('config.clearShort') || 'clear selection';
            clearBookmarkSelectionBtn.addEventListener('click', () => {
                this.c.bookmarks.clearSelection();
            });
        }
    
        const detailDeleteBtn = document.getElementById('bookmark-detail-delete-btn');
        if (detailDeleteBtn) {
            detailDeleteBtn.addEventListener('click', () => {
                const activeIdx = this.c.bookmarks.activeDetailIndex;
                if (activeIdx === null || activeIdx === undefined) return;
                const activeBookmark = this.c.bookmarksData[activeIdx];
                if (!activeBookmark) return;
                if (activeBookmark._isNew) {
                    // New unsaved bookmark — remove without confirmation
                    this.c.bookmarksData.splice(activeIdx, 1);
                    this.c.bookmarks.activeDetailIndex = null;
                    this.c.bookmarks.setDetailPanelMode?.('empty');
                    this.c.refreshBookmarksList({ skipFlush: true });
                    this.c.markDirty();
                } else {
                    this.c.removeBookmark(activeIdx);
                }
            });
        }
    
        const bookmarksList = document.getElementById('bookmarks-list');
        if (bookmarksList) {
            bookmarksList.addEventListener('click', (e) => {
                if (e.target.closest('.bookmark-item')) return;
                if (this.c.bookmarks.activeDetailIndex === null) return;
                this.c.bookmarks.activeDetailIndex = null;
                document.querySelectorAll('.bookmark-item.is-selected-detail').forEach(el => el.classList.remove('is-selected-detail'));
                this.c.bookmarks.setDetailPanelMode?.('empty');
            });
        }
    
        const bulkDeleteBookmarksBtn = document.getElementById('bulk-delete-bookmarks-btn');
        if (bulkDeleteBookmarksBtn) {
            bulkDeleteBookmarksBtn.addEventListener('click', async () => {
                const undoSnapshot = this.c.captureUndoSnapshot();
                const removed = await this.c.bookmarks.bulkDelete(this.c.bookmarksData);
                if (removed) {
                    this.c.refreshBookmarksList();
                    this.c.showUndoNotification('Bookmarks removed.', undoSnapshot);
                    this.c.markDirty();
                }
            });
        }
    
        const bulkTogglePinBtn = document.getElementById('bulk-toggle-pin-btn');
        if (bulkTogglePinBtn) {
            bulkTogglePinBtn.addEventListener('click', () => {
                this.c.bookmarks.bulkTogglePin(this.c.bookmarksData);
                this.c.refreshBookmarksList({ skipFlush: true });
                this.c.markDirty();
            });
        }
    
        const bulkToggleStatusBtn = document.getElementById('bulk-toggle-status-btn');
        const bulkStatusActionSelect = document.getElementById('bulk-status-action-select');
        if (bulkToggleStatusBtn) {
            bulkToggleStatusBtn.addEventListener('click', () => {
                const mode = bulkStatusActionSelect ? bulkStatusActionSelect.value : 'toggle';
                const updated = this.c.bookmarks.bulkSetStatus(this.c.bookmarksData, mode);
                if (updated > 0) {
                    const modeLabel = mode === 'enable'
                        ? (this.c.language.t('config.bulkStatusEnabled') || 'enabled')
                        : mode === 'disable'
                            ? (this.c.language.t('config.bulkStatusDisabled') || 'disabled')
                            : (this.c.language.t('config.bulkStatusToggled') || 'toggled');
                    const template = this.c.language.t('config.bulkStatusUpdated') || 'Status check {mode} for {count} bookmark(s).';
                    this.c.ui.showNotification(template.replace('{mode}', modeLabel).replace('{count}', String(updated)), 'success');
                }
                this.c.refreshBookmarksList({ skipFlush: true });
                this.c.markDirty();
                this.c.settings?.refreshStatusEssentialsSummary?.(this.c.settingsData, this.c.allBookmarksData);
            });
        }
    
        const bulkMoveApplyBtn = document.getElementById('bulk-move-apply-btn');
        const bulkPageSelect = document.getElementById('bulk-page-select');
        const bulkMoveCategorySelect = document.getElementById('bulk-move-category-select');
        if (bulkPageSelect && bulkMoveCategorySelect) {
            bulkPageSelect.addEventListener('change', async () => {
                await this.c.populateBulkMoveCategorySelect(Number(bulkPageSelect.value || 0));
            });
        }
        if (bulkMoveApplyBtn && bulkPageSelect) {
            bulkMoveApplyBtn.addEventListener('click', async () => {
                const targetPageId = Number(bulkPageSelect.value || 0);
                if (!targetPageId) {
                    this.c.ui.showNotification(this.c.language.t('config.selectPageFirst') || 'Select a target page first.', 'info');
                    return;
                }
                const targetCategory = bulkMoveCategorySelect ? bulkMoveCategorySelect.value : '';
                const currentPageId = Number(this.c.currentPageId) || 1;
                if (targetPageId === currentPageId) {
                    const updated = this.c.bookmarks.bulkUpdateCategory(this.c.bookmarksData, targetCategory);
                    if (updated > 0) {
                        const template = this.c.language.t('config.bulkCategoryUpdated') || 'Category updated for {count} bookmark(s).';
                        this.c.ui.showNotification(template.replace('{count}', String(updated)), 'success');
                    }
                    this.c.refreshBookmarksList({ skipFlush: true });
                    this.c.markDirty();
                    return;
                }
                await this.c.bulkMoveBookmarksToPage(targetPageId, targetCategory);
            });
        }
    
        const bulkRefreshFaviconsBtn = document.getElementById('bulk-refresh-favicons-btn');
        if (bulkRefreshFaviconsBtn) {
            bulkRefreshFaviconsBtn.addEventListener('click', async () => {
                const refreshed = await this.c.bookmarks.bulkRefreshFavicons(this.c.bookmarksData);
                if (refreshed <= 0) {
                    this.c.ui.showNotification(this.c.language.t('config.selectBookmarksFirst') || 'Select bookmarks first.', 'info');
                    return;
                }
                const template = this.c.language.t('config.refreshedBookmarksCount') || 'Refreshed {count}.';
                this.c.ui.showNotification(template.replace('{count}', String(refreshed)), 'success');
                this.c.refreshBookmarksList({ skipFlush: true });
                this.c.markDirty();
            });
        }

        const bulkApplyTagsBtn = document.getElementById('bulk-apply-tags-btn');
        const bulkTagsInput = document.getElementById('bulk-tags-input');
        const bulkTagsModeSelect = document.getElementById('bulk-tags-mode-select');
        if (bulkTagsInput && window.TagAutocomplete) {
            window.TagAutocomplete.attach(bulkTagsInput, () =>
                (this.c.allBookmarksData ?? []).flatMap(bm => bm.tags || []));
        }
        if (bulkApplyTagsBtn && bulkTagsInput) {
            bulkApplyTagsBtn.addEventListener('click', () => {
                const tags = bulkTagsInput.value.split(',');
                const mode = bulkTagsModeSelect ? bulkTagsModeSelect.value : 'add';
                const updated = this.c.bookmarks.bulkApplyTags(this.c.bookmarksData, tags, mode);
                if (updated > 0) {
                    const template = this.c.language.t('config.bulkTagsUpdated') || 'Tags updated for {count} bookmark(s).';
                    this.c.ui.showNotification(template.replace('{count}', String(updated)), 'success');
                    bulkTagsInput.value = '';
                    this.c.refreshBookmarksList({ skipFlush: true });
                    this.c.markDirty();
                } else {
                    this.c.ui.showNotification(this.c.language.t('config.selectBookmarksFirst') || 'Select bookmarks first.', 'info');
                }
            });
        }

        if (!this.c._findersAddDelegationBound) {
            this.c._findersAddDelegationBound = true;
            document.addEventListener('click', (e) => {
                const btn = e.target?.closest?.('#add-finder-btn');
                if (!btn || btn.disabled) {
                    return;
                }
                const findersPanel = document.querySelector('[data-tab-content="finders"]');
                if (!findersPanel?.classList.contains('active')) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                void this.c.addFinder();
            }, true);
        }
    
        const addCollectionBtn = document.getElementById('add-collection-btn');
        if (addCollectionBtn) addCollectionBtn.addEventListener('click', () => {
            if (this.c.collections) this.c.collections._openEdit(null, this.c);
        });
        const collectionsEmptyCta = document.getElementById('collections-empty-cta');
        if (collectionsEmptyCta) collectionsEmptyCta.addEventListener('click', () => addCollectionBtn?.click());

        const tagsEmptyCta = document.getElementById('tags-empty-cta');
        if (tagsEmptyCta) tagsEmptyCta.addEventListener('click', () => {
            document.querySelector('.tab-button[data-tab="bookmarks"]')?.click();
        });
    
        const pageSelector = document.getElementById('page-selector');
        if (pageSelector) {
            pageSelector.addEventListener('change', async (e) => {
                const pid = parseInt(String(e.target.value), 10);
                if (!Number.isFinite(pid)) {
                    return;
                }
                this.c.saveLastCategoryFilterForPage(this.c.currentPageId, this.c.currentBookmarksCategoryFilter);
                this.c.currentBookmarksCategoryFilter = this.c.getLastCategoryFilterForPage(pid);
                this.c.currentBookmarksSearch = '';
                const searchEl = document.getElementById('bookmarks-search');
                if (searchEl) searchEl.value = '';
                const clearEl = document.getElementById('bookmarks-search-clear');
                if (clearEl) clearEl.hidden = true;
                await this.c.loadPageBookmarks(e.target.value);
                this.c.renderStructureWorkspace();
                this.c.ui.refreshTabBreadcrumb?.('bookmarks');
            });
        }
        const faviconPolicySelect = document.getElementById('favicon-refresh-policy-select');
        if (faviconPolicySelect) {
            faviconPolicySelect.value = this.c.settingsData.faviconRefreshPolicy || 'on-save';
            faviconPolicySelect.addEventListener('change', async (e) => {
                this.c.settingsData.faviconRefreshPolicy = e.target.value === 'manual' ? 'manual' : 'on-save';
                this.c.markDirty();
                await this.c.settings.saveSettingsToServer(this.c.settingsData);
            });
        }
        document.addEventListener('keydown', (e) => {
            if (window.ConfigTourRuntime?.shouldBlockConfigShortcuts?.()) {
                return;
            }
            const key = String(e.key).toLowerCase();
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.shiftKey && key === 'k') {
                e.preventDefault();
                window.ConfigSettingsSearch?.focusSearch?.();
                return;
            }
            if (!mod || e.shiftKey || key !== 'k') return;
            e.preventDefault();
            this.c.openConfigCommandPalette();
        });
    
        const bookmarksFilterSelector = document.getElementById('bookmarks-category-filter');
        if (bookmarksFilterSelector) {
            bookmarksFilterSelector.addEventListener('change', (e) => {
                this.c.currentBookmarksCategoryFilter = e.target.value;
                this.c.saveLastCategoryFilterForPage(this.c.currentPageId, this.c.currentBookmarksCategoryFilter);
                if (
                    this.c.currentBookmarksCategoryFilter &&
                    !String(this.c.currentBookmarksCategoryFilter).startsWith('__')
                ) {
                    this.c.saveLastUsedCategoryIdForPage(this.c.currentPageId, this.c.currentBookmarksCategoryFilter);
                }
                this.c.refreshBookmarksList();
                this.c.renderStructureWorkspace();
                this.c.ui.refreshTabBreadcrumb?.('bookmarks');
            });
        }
    
        const bookmarksSortSelector = document.getElementById('bookmarks-sort');
        if (bookmarksSortSelector) {
            bookmarksSortSelector.addEventListener('change', (e) => {
                this.c.currentBookmarksSort = e.target.value;
                this.c.refreshBookmarksList();
            });
        }
    
        const bookmarksSearchInput = document.getElementById('bookmarks-search');
        const bookmarksSearchClear = document.getElementById('bookmarks-search-clear');
        if (bookmarksSearchInput) {
            bookmarksSearchInput.addEventListener('input', (e) => {
                this.c.currentBookmarksSearch = e.target.value;
                if (bookmarksSearchClear) bookmarksSearchClear.hidden = !e.target.value;
                this.c.refreshBookmarksList();
            });
            bookmarksSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    bookmarksSearchInput.value = '';
                    this.c.currentBookmarksSearch = '';
                    if (bookmarksSearchClear) bookmarksSearchClear.hidden = true;
                    this.c.refreshBookmarksList();
                }
            });
        }
        if (bookmarksSearchClear) {
            bookmarksSearchClear.addEventListener('click', () => {
                if (bookmarksSearchInput) bookmarksSearchInput.value = '';
                this.c.currentBookmarksSearch = '';
                bookmarksSearchClear.hidden = true;
                this.c.refreshBookmarksList();
                if (bookmarksSearchInput) bookmarksSearchInput.focus();
            });
        }
    
        const categoriesPageSelector = document.getElementById('categories-page-selector');
        if (categoriesPageSelector) {
            categoriesPageSelector.addEventListener('change', async (e) => {
                const nextPageId = parseInt(String(e.target.value), 10);
                if (!Number.isFinite(nextPageId)) {
                    return;
                }
                if (Number(nextPageId) === Number(this.c.currentCategoriesPageId)) {
                    return;
                }
    
                const flushed = await this.c.flushCategoriesPageBeforeSwitch();
                if (!flushed) {
                    this.c.syncCategoriesPageSelectorUI(this.c.currentCategoriesPageId);
                    return;
                }
    
                this.c.currentCategoriesPageId = nextPageId;
                this.c.saveLastCategoriesPageId(nextPageId);
                await this.c.loadPageCategories(nextPageId);
                this.c.syncCategoriesPageSelectorUI(nextPageId);
                this.c.ui.refreshTabBreadcrumb?.('categories');
            });
        }
    
        const saveBtn = document.getElementById('save-btn');
        if (saveBtn) saveBtn.addEventListener('click', () => this.c.saveChanges());
    
        const showWhatsNewBtn = document.getElementById('config-show-whats-new-btn');
        const helpWhatsNewBtn = document.getElementById('help-open-whats-new-link');
        [showWhatsNewBtn, helpWhatsNewBtn].forEach((btn) => {
            if (!btn) return;
            btn.addEventListener('click', () => {
                if (typeof window.openWhatsNewModal === 'function') {
                    window.openWhatsNewModal({ force: true });
                }
            });
        });
    
        const undoTopBtn = document.getElementById('undo-top-btn');
        if (undoTopBtn) {
            undoTopBtn.addEventListener('click', () => {
                if (this.c.undoSnapshot) {
                    this.c.restoreUndoSnapshot(this.c.undoSnapshot);
                    this.c.undoSnapshot = null;
                    this.c.ui.showNotification('Undone.', 'success');
                }
            });
        }
    
        const discardTopBtn = document.getElementById('discard-top-btn');
        if (discardTopBtn) discardTopBtn.addEventListener('click', () => this.c.discardChanges());
    
        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) resetBtn.addEventListener('click', () => this.c.resetToDefaults());
        this.c.setupStructureAutoSyncListeners();
        this.c.setupDirtyTracking();
        this.c.setupAutosaveLowRiskFields();
        this.c.setupStickySaveBar();
        this.c.setupNavigationGuards();
        this.c.setupHeaderBadgeRefresh();
        window.ConfigHelpSearch?.init(this.c.language);
        window.ConfigSettingsSearch?.init(this.c.language);
        this.c.updateHealthBadge();
        // Initialize theme icon styling controls
        try {
            this.c.initThemeIconStylingControls();
        } catch (e) {
            // ignore; non-critical
        }
    }

    setupHeaderBadgeRefresh() {
        if (this.c._headerBadgeRefreshBound) return;
        this.c._headerBadgeRefreshBound = true;
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.c.updateHealthBadge();
            }
        });
    }

    /**
     * Config's header no longer carries a health icon — health opens from the
     * dashboard. The broken count is still needed here, though: Status Essentials
     * shows it and points its own link at the right filter. So this fetches the
     * summary and feeds that panel, with no anchor to paint.
     */
    async updateHealthBadge() {
        const utils = window.HealthBadgeUtils;
        if (!utils) return;
        try {
            const summary = await utils.fetchBookmarkHealthSummary();
            if (!summary) return;
            const { broken } = utils.summarizeHealthCounts(summary);
            this.c._healthBrokenCount = broken;
            this.c.settings?.applyStatusEssentialsHealthHref?.(broken);
            this.c.settings?.refreshStatusEssentialsSummary?.(this.c.settingsData, this.c.allBookmarksData);
        } catch (e) {
            // Non-critical — silently skip
        }
    }

    setupNavigationGuards() {
        document.querySelectorAll('header.header .back-link').forEach((link) => {
            link.addEventListener('click', async (event) => {
                const href = link.getAttribute('href');
                if (!href) {
                    return;
                }
                if (!this.c.isDirty && !this.c.hasUnsavedColorChanges()) {
                    return;
                }
                event.preventDefault();
                let shouldLeave = true;
                if (this.c.isDirty) {
                    shouldLeave = await this.c.confirmLeaveWithUnsavedChanges();
                }
                if (shouldLeave && this.c.hasUnsavedColorChanges()) {
                    shouldLeave = await this.c.colorsEditor.confirmLeave();
                }
                if (!shouldLeave) {
                    return;
                }
                this.c.isNavigatingAway = true;
                window.location.href = href;
            });
        });
    }

    setupStructureAutoSyncListeners() {
        const pagesList = document.getElementById('pages-list');
        if (pagesList) {
            pagesList.addEventListener('change', async (event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement)) return;
                if (target.getAttribute('data-field') !== 'name') return;
                await this.c.persistPagesStructureAndRefresh('page-renamed');
            });
        }
    
        const categoriesList = document.getElementById('categories-list');
        if (categoriesList) {
            categoriesList.addEventListener('change', async (event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement)) return;
                const field = target.getAttribute('data-field');
                const row = target.closest('.category-item');
                const category = row ? row._categoryRef : null;
                if (!category) return;
    
                if (field === 'name') {
                    const categoryBeforeRename = category.originalId || category.id;
                    const renameResult = this.c.applyCategoryRenameWithConflictGuard(category, target.value, categoryBeforeRename);
                    if (!renameResult) return;
                    await this.c.persistCategoriesStructureAndRefresh({
                        persistBookmarks: true,
                        eventType: 'category-renamed',
                        categoryRenameMap: renameResult
                    });
                    return;
                }
    
                if (field === 'icon') {
                    category.icon = (target.value || '').trim();
                    await this.c.persistCategoriesStructureAndRefresh({ eventType: 'category-icon-updated' });
                }
            });
        }
    }

    setupGeneralCardCollapsible() {
        const storageKey = 'nextdash-config-general-panel-state';
        const DEFAULT_OPEN_ESSENTIALS = new Set(['localization']);
        const DEFAULT_OPEN_ADVANCED = new Set(['appearance-advanced']);
    
        const getDefaultOpenForLayer = (layerMode) => {
            if (layerMode === 'advanced') return DEFAULT_OPEN_ADVANCED;
            if (layerMode === 'all') return new Set([...DEFAULT_OPEN_ESSENTIALS, ...DEFAULT_OPEN_ADVANCED]);
            return DEFAULT_OPEN_ESSENTIALS;
        };
    
        const readSavedPanelState = () => {
            try {
                const raw = localStorage.getItem(storageKey);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            } catch { /* ignore */ }
            return null;
        };
    
        const syncTitleA11y = (card, title) => {
            const expanded = !card.classList.contains('is-collapsed');
            title.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            const panelId = card.getAttribute('data-general-panel');
            if (panelId) {
                title.setAttribute('aria-controls', `general-panel-body-${panelId}`);
            }
        };
    
        const ensureGeneralCardBody = (card, title, panelId) => {
            if (!panelId || card.querySelector('.general-card-body')) return;
            const body = document.createElement('div');
            body.className = 'general-card-body';
            body.id = `general-panel-body-${panelId}`;
            while (title.nextElementSibling) {
                body.appendChild(title.nextElementSibling);
            }
            title.after(body);
        };
    
        this.c.refreshGeneralPanelExpandState = () => {
            const layerMode = document.querySelector('[data-tab-content="general"] > div')?.dataset?.generalLayer
                || this.c.generalLayers?.layer
                || 'essentials';
            const DEFAULT_OPEN = getDefaultOpenForLayer(layerMode);
            const saved = readSavedPanelState();
    
            document.querySelectorAll('.general-card[data-general-panel]').forEach((card) => {
                if (card.hidden) return;
                const title = card.querySelector('.section-title');
                if (!title) return;
                const panelId = card.getAttribute('data-general-panel');
                if (!panelId) return;
                const alwaysCollapsed = panelId === 'reset';
                const expanded = !alwaysCollapsed && (saved && Object.prototype.hasOwnProperty.call(saved, panelId)
                    ? Boolean(saved[panelId])
                    : DEFAULT_OPEN.has(panelId));
                card.classList.toggle('is-collapsed', !expanded);
                syncTitleA11y(card, title);
            });
        };
    
        const layer = this.c.generalLayers?.layer || 'essentials';
        const DEFAULT_OPEN = getDefaultOpenForLayer(layer);
        let saved = readSavedPanelState();
    
        const persistState = () => {
            const state = {};
            document.querySelectorAll('.general-card[data-general-panel]').forEach((card) => {
                const id = card.getAttribute('data-general-panel');
                if (id) state[id] = !card.classList.contains('is-collapsed');
            });
            // Also persist smart-collection <details> open state under key 'sc:<id>'
            document.querySelectorAll('.smart-collection-group[data-sc-id]').forEach((el) => {
                state[`sc:${el.dataset.scId}`] = el.open;
            });
            try {
                localStorage.setItem(storageKey, JSON.stringify(state));
            } catch { /* ignore quota / private mode */ }
        };
        // Expose so saveChanges can call it too
        this.c._persistGeneralPanelState = persistState;
    
        // Wire general-card collapse
        document.querySelectorAll('.general-card').forEach((card) => {
            const title = card.querySelector('.section-title');
            if (!title || title.dataset.collapseWired === '1') return;
            title.dataset.collapseWired = '1';
            card.classList.add('is-collapsible');
            title.setAttribute('role', 'button');
            title.setAttribute('tabindex', '0');
            const panelId = card.getAttribute('data-general-panel');
            if (panelId) {
                ensureGeneralCardBody(card, title, panelId);
            }
            if (panelId) {
                const alwaysCollapsed = panelId === 'reset';
                const tier = card.dataset.configTier || 'advanced';
                const layerMode = document.querySelector('[data-tab-content="general"] > div')?.dataset?.generalLayer || 'essentials';
                const tierVisible = layerMode === 'all' || tier === layerMode;
                const expanded = tierVisible && !alwaysCollapsed && (saved && Object.prototype.hasOwnProperty.call(saved, panelId)
                    ? Boolean(saved[panelId])
                    : DEFAULT_OPEN.has(panelId));
                card.classList.toggle('is-collapsed', !expanded);
            }
            syncTitleA11y(card, title);
            const toggleCard = () => {
                card.classList.toggle('is-collapsed');
                const isNowExpanded = !card.classList.contains('is-collapsed');
                if (isNowExpanded && panelId) {
                    this.c.generalLayers?.collapseOtherPanels?.(panelId);
                }
                syncTitleA11y(card, title);
                if (card.getAttribute('data-general-panel')) persistState();
                if (panelId === 'reset') this.c.syncResetPanelGuard();
                this.c.generalLayers?.syncActiveNavFromOpenPanel?.();
            };
            title.addEventListener('click', toggleCard);
            title.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCard();
                }
            });
        });
    
        // Wire smart-collection <details> persistence
        document.querySelectorAll('.smart-collection-group').forEach((el) => {
            const id = el.querySelector('input[type="checkbox"]')?.id || '';
            if (!id) return;
            el.dataset.scId = id;
            const savedOpen = saved && Object.prototype.hasOwnProperty.call(saved, `sc:${id}`)
                ? Boolean(saved[`sc:${id}`])
                : false; // all collapsed by default
            el.open = savedOpen;
            el.addEventListener('toggle', () => persistState());
        });
    
        this.c.syncResetPanelGuard();
    }

    setupBookmarksTabCollapsibles() {
        const STRUCTURE_KEY = 'nextdash-config-structure-workspace-v1';
        const MORE_KEY = 'nextdash-config-bookmark-detail-more-v1';

        const structureCard = document.getElementById('structure-workspace-card');
        const structureToggle = document.getElementById('structure-workspace-toggle');
        if (structureCard && structureToggle) {
            const readStructureExpanded = () => {
                try {
                    const raw = localStorage.getItem(STRUCTURE_KEY);
                    return raw === '1' || raw === 'true';
                } catch {
                    return false;
                }
            };

            const setStructureExpanded = (expanded, { persist = true } = {}) => {
                structureCard.classList.toggle('is-collapsed', !expanded);
                structureToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                if (persist) {
                    try {
                        localStorage.setItem(STRUCTURE_KEY, expanded ? '1' : '0');
                    } catch { /* ignore */ }
                }
            };

            this.c.applyStructureWorkspacePersistedState = () => {
                const card = document.getElementById('structure-workspace-card');
                const toggle = document.getElementById('structure-workspace-toggle');
                if (!card || !toggle) return;
                setStructureExpanded(readStructureExpanded(), { persist: false });
            };

            this.c.expandStructureWorkspace = () => setStructureExpanded(true);

            this.c.applyStructureWorkspacePersistedState();

            const toggleStructure = () => {
                const willExpand = structureCard.classList.contains('is-collapsed');
                setStructureExpanded(willExpand);
            };
            structureToggle.addEventListener('click', toggleStructure);
            structureToggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleStructure();
                }
            });
        }
    
        const moreDetails = document.getElementById('bookmark-detail-more');
        if (moreDetails) {
            let moreOpen = false;
            try {
                const raw = localStorage.getItem(MORE_KEY);
                if (raw === '1' || raw === 'true') moreOpen = true;
            } catch { /* ignore */ }
    
            moreDetails.open = moreOpen;
            moreDetails.addEventListener('toggle', () => {
                try {
                    localStorage.setItem(MORE_KEY, moreDetails.open ? '1' : '0');
                } catch { /* ignore */ }
            });
        }
    }

    setupCascadingCheckboxes() {
        // Define parent-child relationships for checkboxes
        const cascadingPairs = [
            { parent: 'show-status-checkbox', children: ['show-ping-checkbox', 'show-status-loading-checkbox', 'skip-fast-ping-checkbox'] },
            { parent: 'show-page-tabs-checkbox', children: ['show-page-names-in-tabs-checkbox'] },
            { parent: 'enable-custom-title-checkbox', children: ['custom-title-input', 'show-page-in-title-checkbox'] },
            { parent: 'enable-fuzzy-suggestions-checkbox', children: ['fuzzy-suggestions-start-with-checkbox'] },
            { parent: 'enable-custom-favicon-checkbox', children: ['custom-favicon-input'] }
        ];
    
        // Set up event listeners for each parent checkbox
        cascadingPairs.forEach(pair => {
            const parentCheckbox = document.getElementById(pair.parent);
            if (parentCheckbox) {
                parentCheckbox.addEventListener('change', (e) => {
                    pair.children.forEach(childId => {
                        const childElement = document.getElementById(childId);
                        if (childElement) {
                            if (childElement.type === 'checkbox') {
                                childElement.disabled = !e.target.checked;
                                // Visual feedback: gray out child if disabled
                                const parentItem = childElement.closest('.checkbox-tree-child');
                                if (parentItem) {
                                    if (!e.target.checked) {
                                        parentItem.style.opacity = '0.5';
                                        parentItem.style.pointerEvents = 'none';
                                    } else {
                                        parentItem.style.opacity = '1';
                                        parentItem.style.pointerEvents = 'auto';
                                    }
                                }
                            } else if (childElement.type === 'file' || childElement.tagName === 'INPUT') {
                                childElement.disabled = !e.target.checked;
                                const parentItem = childElement.closest('.checkbox-tree-child');
                                if (parentItem) {
                                    if (!e.target.checked) {
                                        parentItem.style.opacity = '0.5';
                                        parentItem.style.pointerEvents = 'none';
                                    } else {
                                        parentItem.style.opacity = '1';
                                        parentItem.style.pointerEvents = 'auto';
                                    }
                                }
                            }
                        }
                    });
                });
                
                // Initialize disabled state on load
                const isChecked = parentCheckbox.checked;
                pair.children.forEach(childId => {
                    const childElement = document.getElementById(childId);
                    if (childElement) {
                        childElement.disabled = !isChecked;
                        if (!isChecked) {
                            const parentItem = childElement.closest('.checkbox-tree-child');
                            if (parentItem) {
                                parentItem.style.opacity = '0.5';
                                parentItem.style.pointerEvents = 'none';
                            }
                        }
                    }
                });
            }
        });
    }

    setupInputValidation() {
        // Validate columns input (1-6)
        const columnsInput = document.getElementById('columns-input');
        if (columnsInput) {
            columnsInput.addEventListener('input', (e) => {
                let value = parseInt(e.target.value);
                if (isNaN(value)) value = 3;
                if (value < 1) value = 1;
                if (value > 6) value = 6;
                e.target.value = value;
            });
        }
    
        // Validate custom title (max length handled by maxlength attribute)
        const customTitleInput = document.getElementById('custom-title-input');
        if (customTitleInput) {
            customTitleInput.addEventListener('input', (e) => {
                // Show character count feedback if near limit
                if (e.target.value.length > 85) {
                    e.target.title = `${e.target.value.length} / 100 characters`;
                } else {
                    e.target.title = '';
                }
            });
        }
    
        // File input validation
        const faviconInput = document.getElementById('custom-favicon-input');
        if (faviconInput) {
            faviconInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    const maxSize = 1024 * 1024; // 1MB
                    if (file.size > maxSize) {
                        this.c.ui.showNotification(this.c.language.t('config.fileTooLarge') || 'File is too large (max 1MB)', 'error');
                        e.target.value = '';
                        return;
                    }
                    const validTypes = ['image/x-icon', 'image/png', 'image/jpeg', 'image/gif'];
                    if (!validTypes.includes(file.type)) {
                        this.c.ui.showNotification(this.c.language.t('config.invalidFileType') || 'Invalid file type', 'error');
                        e.target.value = '';
                    }
                }
            });
        }
    
        const fontInput = document.getElementById('custom-font-input');
        if (fontInput) {
            fontInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    const maxSize = 5 * 1024 * 1024; // 5MB
                    if (file.size > maxSize) {
                        this.c.ui.showNotification(this.c.language.t('config.fileTooLarge') || 'File is too large (max 5MB)', 'error');
                        e.target.value = '';
                        return;
                    }
                    const validTypes = ['font/woff', 'font/woff2', 'font/ttf', 'font/otf'];
                    if (!validTypes.includes(file.type)) {
                        this.c.ui.showNotification(this.c.language.t('config.invalidFileType') || 'Invalid file type', 'error');
                        e.target.value = '';
                    }
                }
            });
        }
    }

    installPublicMethods() {
        const c = this.config;
        for (const name of ['setupDOM', 'setupEventListeners', 'setupHeaderBadgeRefresh', 'updateHealthBadge', 'setupNavigationGuards', 'setupStructureAutoSyncListeners', 'setupGeneralCardCollapsible', 'setupBookmarksTabCollapsibles', 'setupCascadingCheckboxes', 'setupInputValidation']) {
            c[name] = (...args) => this[name](...args);
        }
    }
}

window.ConfigSetup = ConfigSetup;
