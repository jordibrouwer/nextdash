/**
 * The one-time note that explains the mode strip.
 *
 * The strip is the line beside the page name that says what the keys do right
 * now. It appears by itself, so nobody who was already using nextDash knows
 * what it is; a fresh install meets it the same way. Both get this note once,
 * pointing at the strip, and it stays until it is put away.
 *
 * Built on the shared coach note (coach-note.js), scheduled after the others so
 * it takes its turn once they are gone. It is only shown while the strip is
 * switched on and drawn (the classic clock layout, on a wide screen). "Got it"
 * counts as seen; "Turn it off" switches the strip off, the same setting as
 * Shift+S, and counts as seen too.
 */
(function (global) {
    'use strict';

    if (!global.CoachNote) return;

    function dash() {
        return global.dashboardInstance || null;
    }

    /** Locale lookup with an English fallback, the way neighbouring panels do it. */
    function t(key, fallback) {
        const lang = dash()?.language;
        if (lang?.t) {
            const full = `coachNote.${key}`;
            const value = lang.t(full);
            if (value && value !== full) return value;
        }
        return fallback;
    }

    const anchor = () => document.getElementById('mode-strip');

    global.CoachNote.define({
        id: 'mode-strip-intro',
        localKey: 'nextdash:mode-strip-intro-seen',
        anchor,
        side: () => 'below',
        canShow: () => dash()?.settings?.showModeStrip !== false,
        // A mouse press hides the strip; it is brought back for the note, and kept while the note is up.
        prepare: () => global.ModeStrip?.reveal?.(),
        onShown: () => global.ModeStrip?.hold?.(true),
        onDone: () => global.ModeStrip?.hold?.(false),
        title: () => t('modeStripTitle', 'The mode strip'),
        body: () => t('modeStripBody', 'This line says what your keys do right now: type to search, or, with the cursor on a bookmark, the letters for that row. Shift+S switches it off and on in every view.'),
        okLabel: () => t('ok', 'Got it'),
        secondaryLabel: () => t('modeStripOff', 'Turn it off'),
        onSecondary: () => { if (global.ModeStrip?.isEnabled?.()) void global.ModeStrip.toggle(); },
    });

    // After the action bar's and the greeting's: the queue keeps the order of asking.
    global.CoachNote.schedule('mode-strip-intro');
})(window);
