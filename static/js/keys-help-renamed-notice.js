/**
 * A tip in the bell for people who knew the cheat sheet: it is called Keys and
 * help now, and says more about the page you are on.
 *
 * Only for installs that were there before the keys moved, and only once the
 * window that says so (shortcuts-changed-modal.js) has been read: the two
 * would otherwise tell the same reader two things at once. A fresh install
 * never knew the old sheet and never gets it. It waits in the bell until it is
 * read (the bell's "Mark read" or the button below), and then it is gone for
 * good.
 */
(function initKeysHelpRenamedNotice(global) {
    'use strict';

    const PROMO_ID = 'keys-help-renamed-v1';

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    /** An install from before the keys moved, whose reader has been told about the move. */
    function due() {
        const d = dash();
        if (!d?.settings || d.settings.firstRunInstall === true) return false;
        return global.ShortcutsChangedModal?.seen?.() === true;
    }

    function openSheet() {
        markAnswered();
        void dash()?.showKeyboardCheatSheet?.();
    }

    const card = global.NoticeCard.define({
        id: 'keys-help-renamed-notice',
        title: () => t('dashboard.keysHelpRenamedTitle', 'The cheat sheet is now Keys and help'),
        bell: {
            kind: 'tip',
            group: 'tips',
            icon: '⌨️',
            no: 'forever',
            state: async () => (hasAnswered() || !due() ? null : {
                count: 1,
                text: t('dashboard.keysHelpRenamedText', 'The cheat sheet is now Keys and help. Press ? on any page: it says where you are, gives first steps you can try, and searches the Help too.'),
            }),
            onRead: () => markAnswered(),
            actions: [
                {
                    label: () => t('dashboard.keysHelpRenamedOpen', 'Open Keys and help'),
                    primary: true,
                    marksRead: true,
                    onClick: () => openSheet(),
                },
            ],
        },
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardKeysHelpRenamedNotice = { shouldShow: () => !hasAnswered() && due(), dismiss: markAnswered, PROMO_ID };
}(typeof window !== 'undefined' ? window : globalThis));
