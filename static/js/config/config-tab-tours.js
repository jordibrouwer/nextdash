/**
 * Config tab tour registry — seen state, scheduling, and start orchestration.
 * Behaviour matches the former ConfigManager tour methods (blur via highlight
 * box-shadow, GuidedFlowGuard, per-tour dismiss timing).
 */
(function () {
    'use strict';

    function switchToTab(config, tabName, hash) {
        if (config.ui?.switchToTab) {
            config.ui.switchToTab(tabName);
        } else {
            const panel = document.querySelector(`[data-tab-content="${tabName}"]`);
            if (panel && !panel.classList.contains('active')) {
                document.querySelector(`.tab-button[data-tab="${tabName}"]`)?.click();
            }
        }
        const currentHash = (window.location.hash || '').replace(/^#/, '');
        if (currentHash !== hash && !currentHash.startsWith(`${hash}/`)) {
            window.history.replaceState(null, '', `#${hash}`);
        }
    }

    function isTourEnabled(def) {
        return def.enabled !== false;
    }

    const CONFIG_TAB_TOUR_DEFS = [
        {
            id: 'general',
            title: 'General',
            statePrefix: 'configGeneralTour',
            tourGlobal: 'ConfigGeneralTour',
            settingsFlag: 'configGeneralTourCompleted',
            storageKeyFallback: 'nextdash:config-general-tour-v1',
            tabName: 'general',
            wrongTabReason: 'no-general-tab',
            failureDomHint: 'General settings are still loading — refresh and try again.',
            failureDefault: 'Open the General tab on a desktop-sized window.',
            extraFailureReasons: { 'layer-error': 'config.resetConfigGeneralTourFailedDom' },
            useRuntimeSchedule: true,
            ensureTabActive(config) {
                switchToTab(config, 'general', 'general');
                const hash = (window.location.hash || '').replace(/^#/, '');
                if (!hash.startsWith('general')) {
                    config.generalLayers?.applyHash?.('#general');
                }
            },
        },
        {
            id: 'bookmarks',
            title: 'Bookmarks',
            statePrefix: 'configBookmarksTour',
            tourGlobal: 'ConfigBookmarksTour',
            settingsFlag: 'configBookmarksTourCompleted',
            storageKeyFallback: 'nextdash:config-bookmarks-tour-v1',
            tabName: 'bookmarks',
            hashMatches: (hash) => hash === 'bookmarks' || hash.startsWith('bookmarks/'),
            wrongTabReason: 'no-bookmarks-tab',
            failureDomHint: 'The editor is still loading — refresh and try again.',
            supportsResumeCleanup: true,
            ensureTabActive(config) {
                switchToTab(config, 'bookmarks', 'bookmarks');
            },
        },
        {
            id: 'finders',
            title: 'Finders',
            statePrefix: 'configFindersTour',
            tourGlobal: 'ConfigFindersTour',
            settingsFlag: 'configFindersTourCompleted',
            storageKeyFallback: 'nextdash:config-finders-tour-v1',
            tabName: 'finders',
            wrongTabReason: 'no-finders-tab',
            failureDomHint: 'Finders are still loading — refresh and try again.',
            ensureTabActive(config) {
                switchToTab(config, 'finders', 'finders');
            },
        },
        {
            id: 'stats',
            title: 'Stats',
            statePrefix: 'configStatsTour',
            tourGlobal: 'ConfigStatsTour',
            settingsFlag: 'configStatsTourCompleted',
            storageKeyFallback: 'nextdash:config-stats-tour-v1',
            tabName: 'stats',
            wrongTabReason: 'no-stats-tab',
            failureDomHint: 'Stats are still loading — refresh and try again.',
            ensureTabActive(config) {
                switchToTab(config, 'stats', 'stats');
            },
        },
        {
            id: 'categories',
            title: 'Categories',
            statePrefix: 'configCategoriesTour',
            tourGlobal: 'ConfigCategoriesTour',
            settingsFlag: 'configCategoriesTourCompleted',
            storageKeyFallback: 'nextdash:config-categories-tour-v1',
            tabName: 'categories',
            wrongTabReason: 'no-categories-tab',
            failureDomHint: 'Categories are still loading — refresh and try again.',
            dismissBeforeScheduledStart: true,
            dismissOnMaybeStart: true,
            ensureTabActive(config) {
                if (window.MobileExperience?.isMobileLayout?.()) {
                    config.ui?.showNotification?.(
                        config.language.t('config.categoriesMobileOnlyDesktop'),
                        'info'
                    );
                    config.ui?.switchToTab?.('general');
                    return false;
                }
                switchToTab(config, 'categories', 'categories');
                return true;
            },
        },
        {
            id: 'tags',
            title: 'Tags',
            statePrefix: 'configTagsTour',
            tourGlobal: 'ConfigTagsTour',
            settingsFlag: 'configTagsTourCompleted',
            storageKeyFallback: 'nextdash:config-tags-tour-v1',
            tabName: 'tags',
            wrongTabReason: 'no-tags-tab',
            failureDomHint: 'Tags are still loading — refresh and try again.',
            dismissBeforeScheduledStart: true,
            dismissOnMaybeStart: true,
            ensureTabActive(config) {
                if (window.MobileExperience?.isMobileLayout?.()) {
                    config.ui?.showNotification?.(
                        config.language.t('config.tagsMobileOnlyDesktop'),
                        'info'
                    );
                    config.ui?.switchToTab?.('general');
                    return false;
                }
                switchToTab(config, 'tags', 'tags');
                return true;
            },
        },
        {
            id: 'pages',
            title: 'Pages',
            statePrefix: 'configPagesTour',
            tourGlobal: 'ConfigPagesTour',
            settingsFlag: 'configPagesTourCompleted',
            storageKeyFallback: 'nextdash:config-pages-tour-v1',
            tabName: 'pages',
            wrongTabReason: 'no-pages-tab',
            failureDomHint: 'Pages are still loading — refresh and try again.',
            dismissBeforeScheduledStart: true,
            dismissOnMaybeStart: true,
            ensureTabActive(config) {
                if (window.MobileExperience?.isMobileLayout?.()) {
                    config.ui?.showNotification?.(
                        config.language.t('config.pagesMobileOnlyDesktop'),
                        'info'
                    );
                    config.ui?.switchToTab?.('general');
                    return false;
                }
                switchToTab(config, 'pages', 'pages');
                config.renderPagesTab?.();
                return true;
            },
        },
        {
            id: 'collections',
            title: 'Collections',
            statePrefix: 'configCollectionsTour',
            tourGlobal: 'ConfigCollectionsTour',
            settingsFlag: 'configCollectionsTourCompleted',
            storageKeyFallback: 'nextdash:config-collections-tour-v1',
            tabName: 'collections',
            wrongTabReason: 'no-collections-tab',
            failureDomHint: 'Collections are still loading — refresh and try again.',
            dismissBeforeScheduledStart: true,
            dismissOnMaybeStart: true,
            ensureTabActive(config) {
                switchToTab(config, 'collections', 'collections');
            },
        },
        {
            id: 'theme',
            title: 'Theme',
            statePrefix: 'configThemeTour',
            tourGlobal: 'ConfigThemeTour',
            settingsFlag: 'configThemeTourCompleted',
            storageKeyFallback: 'nextdash:config-theme-tour-v1',
            tabName: 'colors',
            isTabActiveMethod: 'isConfigColorsTabActive',
            ensureTabActiveMethod: 'ensureColorsTabActive',
            hashMatches: (hash) => hash === 'colors' || hash.startsWith('colors/'),
            wrongTabReason: 'no-colors-tab',
            failureDomHint: 'The editor is still loading — refresh and try again.',
            failureDefault: 'Open the Theme tab first.',
            dismissBeforeScheduledStart: true,
            dismissOnMaybeStart: true,
            ensureTabActive(config) {
                switchToTab(config, 'colors', 'colors');
            },
            async beforeMaybeStartForce(config) {
                if (typeof config.ensureColorsEditor === 'function') {
                    await config.ensureColorsEditor();
                }
            },
        },
    ];

    class ConfigTabTours {
        constructor(config) {
            this.config = config;
            this.runtime = config.toursRuntime;
            this.defById = Object.fromEntries(CONFIG_TAB_TOUR_DEFS.map((def) => [def.id, def]));
        }

        getDef(id) {
            return this.defById[id];
        }

        getTourClass(def) {
            return window[def.tourGlobal];
        }

        activeKey(def) {
            return `_${def.statePrefix}Active`;
        }

        startingKey(def) {
            return `_${def.statePrefix}Starting`;
        }

        isTabActive(def) {
            const c = this.config;
            const tab = def.tabName;
            if (c.ui?._currentTab === tab) return true;
            const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
            if (activeTab === tab) return true;
            if (def.id === 'general') {
                return this.runtime.isConfigTabActive('general');
            }
            const hash = (window.location.hash || '').replace(/^#/, '');
            if (typeof def.hashMatches === 'function') {
                return def.hashMatches(hash);
            }
            return hash === tab;
        }

        /** Mirrors former ConfigManager._isConfigTabTourBusy */
        isTabTourBusy(exclude) {
            const c = this.config;
            const entries = [
                ['general', c._configGeneralTourActive, c._configGeneralTourStarting],
                ['bookmarks', c._configBookmarksTourActive, c._configBookmarksTourStarting],
                ['finders', c._configFindersTourActive, c._configFindersTourStarting],
                ['stats', c._configStatsTourActive, c._configStatsTourStarting],
                ['categories', c._configCategoriesTourActive, c._configCategoriesTourStarting],
                ['tags', c._configTagsTourActive, c._configTagsTourStarting],
                ['pages', c._configPagesTourActive, c._configPagesTourStarting],
                ['collections', c._configCollectionsTourActive, c._configCollectionsTourStarting],
                ['theme', c._configThemeTourActive, c._configThemeTourStarting],
            ];
            for (const [name, active, starting] of entries) {
                if (exclude && name === exclude) continue;
                if (active || starting) return true;
            }
            return false;
        }

        /** Mirrors former ConfigManager.dismissOtherConfigTabTours */
        dismissOtherConfigTabTours(except) {
            const c = this.config;
            const tours = [
                ['general', window.ConfigGeneralTour, '_configGeneralTourActive', '_configGeneralTourStarting', 'cancelConfigGeneralTourSchedule'],
                ['bookmarks', window.ConfigBookmarksTour, '_configBookmarksTourActive', '_configBookmarksTourStarting', 'cancelConfigBookmarksTourSchedule'],
                ['finders', window.ConfigFindersTour, '_configFindersTourActive', '_configFindersTourStarting', 'cancelConfigFindersTourSchedule'],
                ['stats', window.ConfigStatsTour, '_configStatsTourActive', '_configStatsTourStarting', 'cancelConfigStatsTourSchedule'],
                ['categories', window.ConfigCategoriesTour, '_configCategoriesTourActive', '_configCategoriesTourStarting', 'cancelConfigCategoriesTourSchedule'],
                ['tags', window.ConfigTagsTour, '_configTagsTourActive', '_configTagsTourStarting', 'cancelConfigTagsTourSchedule'],
                ['pages', window.ConfigPagesTour, '_configPagesTourActive', '_configPagesTourStarting', 'cancelConfigPagesTourSchedule'],
                ['collections', window.ConfigCollectionsTour, '_configCollectionsTourActive', '_configCollectionsTourStarting', 'cancelConfigCollectionsTourSchedule'],
                ['theme', window.ConfigThemeTour, '_configThemeTourActive', '_configThemeTourStarting', 'cancelConfigThemeTourSchedule'],
            ];
            for (const [name, TourClass, activeKey, startingKey, cancelMethod] of tours) {
                if (except && name === except) continue;
                TourClass?.teardownStaleDom?.();
                c[activeKey] = false;
                c[startingKey] = false;
                if (typeof c[cancelMethod] === 'function') {
                    c[cancelMethod]();
                }
            }
        }

        hasSeen(id) {
            const def = this.getDef(id);
            return this.runtime.hasSeenTour({
                settingsFlag: def.settingsFlag,
                storageKeyFallback: def.storageKeyFallback,
                tourGlobal: def.tourGlobal,
            });
        }

        syncSeenFromServer(id) {
            const def = this.getDef(id);
            this.runtime.syncSeenFromServer({
                settingsFlag: def.settingsFlag,
                storageKeyFallback: def.storageKeyFallback,
                tourGlobal: def.tourGlobal,
            });
        }

        syncAllSeenFromServer() {
            for (const def of CONFIG_TAB_TOUR_DEFS) {
                this.syncSeenFromServer(def.id);
            }
        }

        async markCompleted(id) {
            const def = this.getDef(id);
            await this.runtime.markTourCompleted({
                settingsFlag: def.settingsFlag,
                storageKeyFallback: def.storageKeyFallback,
                tourGlobal: def.tourGlobal,
            });
        }

        cancelScheduleManual(def) {
            const c = this.config;
            const prefix = def.statePrefix;
            c[`_${prefix}ScheduleId`] = (c[`_${prefix}ScheduleId`] || 0) + 1;
            const timerKey = `_${prefix}ScheduleTimer`;
            if (c[timerKey]) {
                clearTimeout(c[timerKey]);
                c[timerKey] = null;
            }
        }

        cancelSchedule(id) {
            const def = this.getDef(id);
            if (def.useRuntimeSchedule) {
                this.runtime.cancelSchedule(def.statePrefix);
            } else {
                this.cancelScheduleManual(def);
            }
        }

        failureMessage(id, reason) {
            const def = this.getDef(id);
            const title = def.title;
            const tabReason = def.wrongTabReason;
            const keyByReason = {
                'missing-script': `config.resetConfig${title}TourFailedReload`,
                [tabReason]: `config.resetConfig${title}TourFailedTab`,
                'dom-not-ready': `config.resetConfig${title}TourFailedDom`,
                'render-failed': `config.resetConfig${title}TourFailedDom`,
                'step-error': `config.resetConfig${title}TourFailedDom`,
                blocked: `config.resetConfig${title}TourFailedDom`,
                mobile: `config.resetConfig${title}TourFailedMobile`,
                error: `config.resetConfig${title}TourFailedDom`,
                ...(def.extraFailureReasons || {}),
            };
            const fallbacks = {
                'missing-script': `Could not start the ${title} tour. Refresh the page and try again.`,
                [tabReason]: `Could not start the ${title} tour. Open the ${title} tab first.`,
                'dom-not-ready': `Could not start the ${title} tour. ${def.failureDomHint}`,
                mobile: `Could not start the ${title} tour. Use a wider window or disable mobile device emulation in your browser.`,
                error: `Could not start the ${title} tour. Refresh the page and try again.`,
            };
            const key = keyByReason[reason] || `config.resetConfig${title}TourFailed`;
            try {
                const msg = this.config.language?.t?.(key);
                if (msg && msg !== key) return msg;
            } catch {
                // ignore broken i18n during tour recovery
            }
            return fallbacks[reason]
                || def.failureDefault
                || `Could not start the ${title} tour. Open the ${title} tab first.`;
        }

        scheduleGeneralTour() {
            const def = this.getDef('general');
            const c = this.config;
            const TourClass = this.getTourClass(def);
            if (typeof TourClass !== 'function') return;
            if (this.hasSeen('general')) return;
            if (c[this.activeKey(def)] || c[this.startingKey(def)]) return;
            if (this.isTabTourBusy('general')) return;
            if (document.body?.classList.contains('loading')) return;

            this.runtime.scheduleTour(def.statePrefix, {
                shouldRun: () => (
                    !this.hasSeen('general') &&
                    !c._configGeneralTourActive &&
                    !c._configGeneralTourStarting &&
                    !this.isTabTourBusy('general') &&
                    this.isTabActive(def)
                ),
                onRun: () => this.maybeStart('general'),
                afterRun: (result) => {
                    if (result?.ok !== true) return;
                    window.setTimeout(() => {
                        const card = document.querySelector('.config-general-tour-card');
                        const rect = card?.getBoundingClientRect();
                        const vis = card ? window.getComputedStyle(card).visibility : 'hidden';
                        const usable = rect && rect.height > 8 && rect.width > 8 && vis !== 'hidden';
                        if (document.body.hasAttribute('data-config-general-tour-active') && !usable) {
                            console.warn('Config General tour stuck without visible card — recovering');
                            window.ConfigGeneralTour?.teardownStaleDom?.();
                        }
                    }, 2500);
                },
            });
        }

        scheduleManualTour(id) {
            const def = this.getDef(id);
            if (!isTourEnabled(def)) return;
            const c = this.config;
            const TourClass = this.getTourClass(def);
            if (typeof TourClass !== 'function') return;
            if (this.hasSeen(id)) return;
            if (c[this.activeKey(def)] || c[this.startingKey(def)]) return;
            if (this.isTabTourBusy(id)) return;
            if (document.body?.classList.contains('loading')) return;

            this.cancelScheduleManual(def);
            const runId = c[`_${def.statePrefix}ScheduleId`];
            const timerKey = `_${def.statePrefix}ScheduleTimer`;
            c[timerKey] = setTimeout(() => {
                c[timerKey] = null;
                if (runId !== c[`_${def.statePrefix}ScheduleId`]) return;
                if (
                    this.hasSeen(id) ||
                    c[this.activeKey(def)] ||
                    c[this.startingKey(def)] ||
                    this.isTabTourBusy(id)
                ) {
                    return;
                }
                if (!this.isTabActive(def)) return;
                if (def.dismissBeforeScheduledStart) {
                    this.dismissOtherConfigTabTours(id);
                }
                void this.maybeStart(id);
            }, 550);
        }

        schedule(id) {
            const def = this.getDef(id);
            if (def.useRuntimeSchedule) {
                this.scheduleGeneralTour();
            } else {
                this.scheduleManualTour(id);
            }
        }

        ensureTabActive(id) {
            const def = this.getDef(id);
            if (typeof def.ensureTabActive === 'function') {
                return def.ensureTabActive(this.config);
            }
            switchToTab(this.config, def.tabName, def.tabName);
            return true;
        }

        async maybeStart(id, { force = false } = {}) {
            const def = this.getDef(id);
            if (!isTourEnabled(def)) {
                return { ok: false, reason: 'disabled' };
            }
            const TourClass = this.getTourClass(def);
            const c = this.config;

            if (c[this.startingKey(def)]) {
                return { ok: false, reason: 'starting' };
            }

            const blockReason = TourClass?.getBlockReason?.({
                force,
                hasSeen: () => this.hasSeen(id),
            });
            if (blockReason) {
                if (force) console.warn(`Config ${def.title} tour blocked:`, blockReason);
                return { ok: false, reason: blockReason };
            }

            if (c[this.activeKey(def)] && !force) return { ok: false, reason: 'active' };

            if (id === 'general') {
                if (c._configBookmarksTourActive || c._configBookmarksTourStarting) {
                    return { ok: false, reason: 'active-other' };
                }
            }

            if (this.isTabTourBusy(id)) {
                return { ok: false, reason: 'active-other' };
            }

            if (!force && this.hasSeen(id)) return { ok: false, reason: 'completed' };

            if (def.dismissOnMaybeStart) {
                this.dismissOtherConfigTabTours(id);
            }

            if (force) {
                this.cancelSchedule(id);
                TourClass?.teardownStaleDom?.();
                c[this.activeKey(def)] = false;
                if (document.body?.classList.contains('loading')) {
                    window.SkeletonLoading?.finish?.();
                }
                this.ensureTabActive(id);
                if (typeof def.beforeMaybeStartForce === 'function') {
                    await def.beforeMaybeStartForce(c);
                }
            } else if (!this.isTabActive(def)) {
                return { ok: false, reason: 'wrong-tab' };
            }

            const resumeCleanup = def.supportsResumeCleanup
                && TourClass?.consumeResume?.() === 'cleanup';

            const tour = new TourClass({
                language: c.language,
                hasSeen: () => this.hasSeen(id),
                onMarkSeen: () => this.markCompleted(id),
            });

            const canStartForce = force || resumeCleanup;
            if (!tour.canStart({ force: canStartForce })) {
                return { ok: false, reason: force ? def.wrongTabReason : 'mobile' };
            }

            c[this.startingKey(def)] = true;
            c[this.activeKey(def)] = true;
            try {
                const startOpts = def.supportsResumeCleanup
                    ? { force, resumeCleanup }
                    : { force };
                const started = await tour.prepareAndStart(startOpts);
                if (!started) {
                    c[this.activeKey(def)] = false;
                    TourClass?.teardownStaleDom?.();
                    return { ok: false, reason: tour.lastFailureReason || 'prepare-failed' };
                }
                this.cancelSchedule(id);
                return { ok: true };
            } catch (error) {
                console.error(`Config ${def.title} tour failed to start`, error);
                c[this.activeKey(def)] = false;
                TourClass?.teardownStaleDom?.();
                return { ok: false, reason: 'error' };
            } finally {
                c[this.startingKey(def)] = false;
            }
        }

        installPublicMethods() {
            const c = this.config;
            for (const def of CONFIG_TAB_TOUR_DEFS) {
                const title = def.title;
                c[`hasSeenConfig${title}Tour`] = () => this.hasSeen(def.id);
                c[`syncConfig${title}TourSeenFromServer`] = () => this.syncSeenFromServer(def.id);
                c[`markConfig${title}TourCompleted`] = () => this.markCompleted(def.id);
                c[`cancelConfig${title}TourSchedule`] = () => this.cancelSchedule(def.id);
                c[`scheduleConfig${title}Tour`] = () => this.schedule(def.id);
                c[`config${title}TourFailureMessage`] = (reason) => this.failureMessage(def.id, reason);
                c[`maybeStartConfig${title}Tour`] = (opts) => this.maybeStart(def.id, opts);
                c[`isConfig${title}TourEnabled`] = () => isTourEnabled(def);

                const isTabActiveName = def.isTabActiveMethod || `isConfig${title}TabActive`;
                c[isTabActiveName] = () => this.isTabActive(def);

                const ensureTabName = def.ensureTabActiveMethod || `ensure${title}TabActive`;
                c[ensureTabName] = () => this.ensureTabActive(def.id);
            }
            c._isConfigTabTourBusy = (exclude) => this.isTabTourBusy(exclude);
            c.dismissOtherConfigTabTours = (except) => this.dismissOtherConfigTabTours(except);
            c.syncConfigTabToursSeenFromServer = () => this.syncAllSeenFromServer();
        }
    }

    window.ConfigTabTours = ConfigTabTours;
})();
