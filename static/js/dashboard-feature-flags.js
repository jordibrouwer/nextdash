/**
 * Dashboard feature toggles during incremental rollouts.
 * Pin/note row badges are off; pin sort, :pin/:note, and note search stay active.
 */
(function initDashboardFeatureFlags(global) {
    const flags = Object.freeze({
        pinNoteRowIconsEnabled: false,
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
