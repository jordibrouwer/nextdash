// Shared layout preset helpers for dashboard and config
(function initLayoutUtils() {
    const PRESETS = ['default', 'compact', 'cards', 'terminal', 'masonry', 'list', 'widgets'];

    function getLayoutPresets() {
        return [...PRESETS];
    }

    function normalizeLayoutPreset(value, fallback = 'default') {
        const normalized = (value || '').toLowerCase().trim();
        return PRESETS.includes(normalized) ? normalized : fallback;
    }

    function applyLayoutPreset(settings, preset, options = {}) {
        const nextPreset = normalizeLayoutPreset(preset);
        if (settings && typeof settings === 'object') {
            settings.layoutPreset = nextPreset;
        }

        document.body.setAttribute('data-layout-preset', nextPreset);

        if (options.syncDashboard && window.dashboardInstance && typeof window.dashboardInstance.setupDOM === 'function') {
            window.dashboardInstance.setupDOM();
        }

        if (options.saveDashboard && window.dashboardInstance && typeof window.dashboardInstance.saveSettings === 'function') {
            window.dashboardInstance.saveSettings();
        }

        return nextPreset;
    }

    window.LayoutUtils = {
        getLayoutPresets,
        normalizeLayoutPreset,
        applyLayoutPreset
    };
})();
