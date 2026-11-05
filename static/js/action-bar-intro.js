/**
 * The one-time note that introduces the action bar, wherever it stands.
 *
 * Built on the shared coach note (coach-note.js) and scheduled after the
 * bell's, so it appears once the bell note is gone. The anchor is the bar
 * itself, outlined all around with no arrow (the note is about the whole bar,
 * not one button). A dock that has slid into its edge is brought out and held
 * there until the note is put away, then auto-hide runs as usual. A bar that is
 * switched off never shows the note and never counts it as seen.
 */
(function (global) {
    'use strict';

    if (!global.CoachNote) return;

    /** Locale lookup with an English fallback, the way neighbouring panels do it. */
    function t(key, fallback) {
        const lang = global.dashboardInstance?.language;
        if (lang?.t) {
            const full = `coachNote.${key}`;
            const value = lang.t(full);
            if (value && value !== full) return value;
        }
        return fallback;
    }

    const body = () => document.body;

    function anchor() {
        if (body().getAttribute('data-action-bar-enabled') === 'off') return null;
        return document.querySelector('.header-shortcuts');
    }

    /** A dock that has slid into its edge comes out, and stays out while the note is up. */
    function bringOut() {
        global.ActionBarAutoHide?.hold?.(true);
    }

    /** A column or a dock faces the page; the header and the menu sit above it. */
    function side() {
        switch (body().getAttribute('data-action-bar')) {
        case 'right': return 'left';
        case 'left': return 'right';
        case 'bottom': return 'above';
        default: return 'below';
        }
    }

    global.CoachNote.define({
        id: 'action-bar-intro',
        localKey: 'nextdash:action-bar-intro-seen',
        anchor,
        arrow: false,
        side,
        prepare: bringOut,
        onDone: () => global.ActionBarAutoHide?.hold?.(false),
        canShow: () => body().getAttribute('data-action-bar-enabled') !== 'off',
        title: () => t('actionBarTitle', 'Your action bar'),
        body: () => t('actionBarBody', 'Everything you can do here, one click away: add a bookmark, search, commands, edit mode and the look. Hover a button for its name and key; Config → Appearance → Action bar moves it or hides it.'),
        okLabel: () => t('ok', 'Got it'),
    });

    // After the bell's note: the queue keeps the order of asking.
    global.CoachNote.schedule('action-bar-intro');
})(window);
