/**
 * Temporary dashboard feature toggles during incremental rollouts.
 * Set pinAndNotesEnabled to true when the pin/note makeover is ready.
 */
(function initDashboardFeatureFlags(global) {
    const flags = Object.freeze({
        pinAndNotesEnabled: false,
    });

    function isDashboardPinNotesEnabled() {
        return flags.pinAndNotesEnabled === true;
    }

    global.DashboardFeatureFlags = flags;
    global.isDashboardPinNotesEnabled = isDashboardPinNotesEnabled;
}(typeof window !== 'undefined' ? window : globalThis));
