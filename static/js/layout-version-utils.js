// Shared layout version helpers for dashboard and config
(function initLayoutVersionUtils() {
    const VERSIONS = ['classic', 'modern', 'glass'];

    function getLayoutVersions() {
        return [...VERSIONS];
    }

    function normalizeLayoutVersion(value, fallback = 'classic') {
        const normalized = (value || '').toLowerCase().trim();
        return VERSIONS.includes(normalized) ? normalized : fallback;
    }

    function applyLayoutVersionToDOM(version) {
        const nextVersion = normalizeLayoutVersion(version);
        document.documentElement.setAttribute('data-layout-version', nextVersion);
        if (document.body) {
            document.body.setAttribute('data-layout-version', nextVersion);
        }
        return nextVersion;
    }

    function applyLayoutVersion(settings, version, options = {}) {
        const nextVersion = normalizeLayoutVersion(version);
        if (settings && typeof settings === 'object') {
            settings.layoutVersion = nextVersion;
        }

        applyLayoutVersionToDOM(nextVersion);

        if (options.syncDashboard && window.dashboardInstance && typeof window.dashboardInstance.setupDOM === 'function') {
            window.dashboardInstance.setupDOM();
        }

        if (options.saveDashboard && window.dashboardInstance && typeof window.dashboardInstance.saveSettings === 'function') {
            window.dashboardInstance.saveSettings();
        } else if (
            options.saveSettings !== false
            && window.configManager?.settings?.saveSettingsToServer
            && settings === window.configManager.settingsData
        ) {
            void window.configManager.settings.saveSettingsToServer(settings);
            window.configManager.signalDashboardSettingsUpdated?.('settings-updated');
        }

        return nextVersion;
    }

    function toggleLayoutVersion(settings, options = {}) {
        const current = normalizeLayoutVersion(settings?.layoutVersion);
        const order = ['classic', 'modern', 'glass'];
        const index = order.indexOf(current);
        const next = order[(index + 1) % order.length];
        return applyLayoutVersion(settings, next, options);
    }

    window.LayoutVersionUtils = {
        getLayoutVersions,
        normalizeLayoutVersion,
        applyLayoutVersionToDOM,
        applyLayoutVersion,
        toggleLayoutVersion
    };
})();
