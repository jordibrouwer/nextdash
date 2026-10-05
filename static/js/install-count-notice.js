/**
 * The install count, said once.
 *
 * Since v1.17.2 the server sends one anonymous ping a day, a random id and the
 * version, so the project can say how many installs exist. It is on by default,
 * which is exactly why it is announced: a default that nobody was told about
 * is a default nobody agreed to. The card says what leaves the server and
 * offers the off switch in the same breath; it does not ask a question, and
 * leaving it alone is a fine answer.
 *
 * Not shown when the operator has already disabled telemetry for the whole
 * server, or when the person has switched the count off themselves.
 */
(function initInstallCountNotice(global) {
    'use strict';

    const PROMO_ID = 'install-count-v1';
    // Last in the corner's queue, behind the cards that invite something.
    const SHOW_DELAY_MS = 8000;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, vars) {
        const d = dash();
        if (d?.formatDashboardLabel) return d.formatDashboardLabel(key, vars || {}, fallback);
        return fallback;
    }

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    function turnOff(card) {
        const d = dash();
        if (d?.settings) {
            d.settings.installPingEnabled = false;
            Promise.resolve(d.saveSettings?.()).catch(() => {});
        }
        global.nextdashTrack?.('install-count-notice:off');
        markAnswered();
        card.close();
    }

    const card = global.NoticeCard.define({
        id: 'install-count-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.installCountNoticeTitle', 'nextDash counts installs'),
        body: () => t('dashboard.installCountNoticeBody',
            'Once a day this server sends a random id and the version number, so the project can tell how many installs exist. Nothing else leaves: no address, no settings, no bookmarks. You can turn it off here or under Behavior → Privacy & sync.'),
        dismissLabel: () => t('dashboard.installCountNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: () => {
            if (hasAnswered()) return false;
            const d = dash();
            if (d?.telemetryLockedOff === true) return false;
            return d?.settings?.installPingEnabled !== false;
        },
        onDismiss: markAnswered,
        actionAttr: 'data-install-count-action',
        actions: [
            {
                name: 'keep',
                label: () => t('dashboard.installCountNoticeKeep', 'Fine by me'),
                primary: true,
                onClick: (c) => { markAnswered(); c.close(); },
            },
            {
                name: 'off',
                label: () => t('dashboard.installCountNoticeOff', 'Turn it off'),
                onClick: turnOff,
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardInstallCountNotice = {
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
