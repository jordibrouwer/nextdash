/**
 * Config tab tours removed (fase 2, blok A). This is a compatibility stub: it
 * still installs the public method names the config manager and its tabs call
 * (hasSeenConfig*Tour, scheduleConfig*Tour, maybeStartConfig*Tour,
 * isConfig*TabActive, ensure*TabActive, dismissOtherConfigTabTours, …), but the
 * tour-starting methods are inert no-ops and hasSeen* always returns true so
 * nothing ever tries to auto-start a (now non-existent) tour.
 *
 * The tab-activation helpers (isTabActive / ensureTabActive) keep their real
 * behaviour because other config code depends on them for plain tab switching.
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

    // Minimal def list: enough to install per-tab method names and switch tabs.
    const CONFIG_TAB_TOUR_DEFS = [
        { id: 'general', title: 'General', tabName: 'general' },
        { id: 'bookmarks', title: 'Bookmarks', tabName: 'bookmarks' },
        { id: 'finders', title: 'Finders', tabName: 'finders' },
        { id: 'stats', title: 'Stats', tabName: 'stats' },
        { id: 'categories', title: 'Categories', tabName: 'categories' },
        { id: 'tags', title: 'Tags', tabName: 'tags' },
        { id: 'pages', title: 'Pages', tabName: 'pages' },
        { id: 'collections', title: 'Collections', tabName: 'collections' },
        {
            id: 'theme',
            title: 'Theme',
            tabName: 'colors',
            isTabActiveMethod: 'isConfigColorsTabActive',
            ensureTabActiveMethod: 'ensureColorsTabActive',
            hashMatches: (hash) => hash === 'colors' || hash.startsWith('colors/'),
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

        isTabActive(def) {
            const c = this.config;
            const tab = def.tabName;
            if (c.ui?._currentTab === tab) return true;
            const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
            if (activeTab === tab) return true;
            if (def.id === 'general') {
                return this.runtime?.isConfigTabActive?.('general') === true;
            }
            const hash = (window.location.hash || '').replace(/^#/, '');
            if (typeof def.hashMatches === 'function') {
                return def.hashMatches(hash);
            }
            return hash === tab;
        }

        ensureTabActive(id) {
            const def = this.getDef(id);
            if (!def) return false;
            switchToTab(this.config, def.tabName, def.tabName);
            return true;
        }

        // Tours are gone: every tour is treated as already seen so nothing schedules.
        installPublicMethods() {
            const c = this.config;
            const noop = () => {};
            const seen = () => true;
            const inertResult = () => ({ ok: false, reason: 'tours-removed' });
            for (const def of CONFIG_TAB_TOUR_DEFS) {
                const title = def.title;
                c[`hasSeenConfig${title}Tour`] = seen;
                c[`syncConfig${title}TourSeenFromServer`] = noop;
                c[`markConfig${title}TourCompleted`] = noop;
                c[`cancelConfig${title}TourSchedule`] = noop;
                c[`scheduleConfig${title}Tour`] = noop;
                c[`config${title}TourFailureMessage`] = () => '';
                c[`maybeStartConfig${title}Tour`] = inertResult;
                c[`isConfig${title}TourEnabled`] = () => false;

                const isTabActiveName = def.isTabActiveMethod || `isConfig${title}TabActive`;
                c[isTabActiveName] = () => this.isTabActive(def);

                const ensureTabName = def.ensureTabActiveMethod || `ensure${title}TabActive`;
                c[ensureTabName] = () => this.ensureTabActive(def.id);
            }
            c._isConfigTabTourBusy = () => false;
            c.dismissOtherConfigTabTours = noop;
            c.syncConfigTabToursSeenFromServer = noop;
        }
    }

    window.ConfigTabTours = ConfigTabTours;
})();
