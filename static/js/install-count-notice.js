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
 *
 * It lives in the notifications bell as a quiet row (Privacy), not in the
 * corner. The two-day wait behind the analytics question went with the corner:
 * two rows in a list are not a pile of interruptions.
 */
(function initInstallCountNotice(global) {
    'use strict';

    const PROMO_ID = 'install-count-v1';

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

    function turnOff() {
        const d = dash();
        if (d?.settings) {
            d.settings.installPingEnabled = false;
            Promise.resolve(d.saveSettings?.({ keys: ['installPingEnabled'] })).catch(() => {});
        }
        global.nextdashTrack?.('install-count-notice:off');
        answered();
    }

    /** Record the answer where Config reads it, and let the row go at once. */
    function answered() {
        markAnswered();
        void global.NotificationBell?.refreshAll?.();
    }

    /** The bell row: 1 while the count is unanswered, on, and not locked off. */
    async function bellState() {
        if (hasAnswered()) return null;
        const d = dash();
        if (d?.telemetryLockedOff === true) return null;
        if (d?.settings?.installPingEnabled === false) return null;
        return {
            count: 1,
            text: t('dashboard.installCountNoticeTitle', 'nextDash counts installs'),
        };
    }

    // A quiet row in the bell, not a corner card. Answering through a button
    // still records the answer the way Config reads it; "No" in the bell hides
    // the row for good.
    const card = global.NoticeCard.define({
        id: 'install-count-notice',
        title: () => t('dashboard.installCountNoticeTitle', 'nextDash counts installs'),
        bell: {
            kind: 'quiet',
            group: 'privacy',
            icon: '\u{1F512}',
            no: 'forever',
            // "No" says the same as "Fine by me": the question is answered.
            onNo: markAnswered,
            // Config's "Bring back dismissed notifications": the No is undone.
            onReset: () => global.DiscoverabilityState?.resetSettingPromoSeen?.(PROMO_ID),
            state: bellState,
            actions: [
                {
                    label: () => t('dashboard.installCountNoticeOff', 'Turn it off'),
                    primary: true,
                    onClick: turnOff,
                },
                {
                    label: () => t('dashboard.installCountNoticeKeep', 'Fine by me'),
                    onClick: answered,
                },
            ],
        },
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardInstallCountNotice = {
        state: bellState,
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
