/**
 * Dashboard feature toggles during incremental rollouts.
 */
(function initDashboardFeatureFlags(global) {
    const flags = Object.freeze({
        pinNoteRowIconsEnabled: true,
    });

    function isDashboardPinNoteRowIconsEnabled() {
        return flags.pinNoteRowIconsEnabled === true;
    }

    /** @deprecated Use isDashboardPinNoteRowIconsEnabled — only gates row badge icons. */
    function isDashboardPinNotesEnabled() {
        return isDashboardPinNoteRowIconsEnabled();
    }

    global.DashboardFeatureFlags = flags;
    global.isDashboardPinNoteRowIconsEnabled = isDashboardPinNoteRowIconsEnabled;
    global.isDashboardPinNotesEnabled = isDashboardPinNotesEnabled;
}(typeof window !== 'undefined' ? window : globalThis));
