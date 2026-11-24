/**
 * The one-time note that introduces Quick launch, pointing at its corner element.
 *
 * Built on the shared coach note (coach-note.js), scheduled after the others so it
 * comes when they are gone. "Customize" opens Config → Appearance → Header with the
 * Quick launch group open; "Got it" puts the note away. A corner element that is
 * switched off, or not drawn (a narrow window, a touch screen), never shows the note
 * and never counts it as seen: the key and the circles are in the tour instead.
 */
(function (global) {
    'use strict';

    if (!global.CoachNote) return;

    /** Locale lookup with an English fallback, the way neighbouring notes do it. */
    function t(key, fallback) {
        const lang = global.dashboardInstance?.language;
        if (lang?.t) {
            const full = `coachNote.${key}`;
            const value = lang.t(full);
            if (value && value !== full) return value;
        }
        return fallback;
    }

    function anchor() {
        const node = document.getElementById('quick-launch-button');
        if (!node) return null;
        return global.getComputedStyle(node).display === 'none' ? null : node;
    }

    /** Config → Appearance → Header, with the Quick launch group open and in view. */
    function customize() {
        global.location.hash = '#config/appearance/header';
        let tries = 0;
        const timer = setInterval(() => {
            const panel = document.querySelector('[data-fold-key="quick-launch"]');
            if (panel) {
                clearInterval(timer);
                if (panel.classList.contains('is-folded')) panel.querySelector('.config-panel-head')?.click();
                panel.scrollIntoView({ block: 'center' });
            } else if ((tries += 1) > 40) {
                clearInterval(timer);
            }
        }, 150);
    }

    global.CoachNote.define({
        id: 'quick-launch-intro',
        localKey: 'nextdash:quick-launch-intro-seen',
        anchor,
        side: () => 'below',
        canShow: () => global.dashboardInstance?.settings?.quickLaunchButton !== false
            && global.dashboardInstance?.isBookmarksView?.() === true,
        title: () => t('quickLaunchTitle', 'Quick launch'),
        body: () => t('quickLaunchBody',
            'Your bookmarks in a panel in the middle of the screen: the ones you added, the ones you pinned and the ones you open most. Click here, press Shift+Q or draw circles with the mouse. Change how it works, or hide this button, in Config → Appearance → Header.'),
        okLabel: () => t('ok', 'Got it'),
        secondaryLabel: () => t('quickLaunchCustomize', 'Customize'),
        onSecondary: customize,
    });

    // After the others: the queue keeps the order of asking.
    global.CoachNote.schedule('quick-launch-intro');
})(window);
