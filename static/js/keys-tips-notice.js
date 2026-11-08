/**
 * Two tips in the bell about the key help that sits on screen: the mode strip
 * beside the page name (Shift+S) and the key legend of a view (Shift+H).
 *
 * Both reach every install, old and new. The strip tip comes a minute into the first
 * visit; the legend tip follows three days after that, so the two do not
 * arrive together. The moment the strip tip first showed is kept as a marker
 * in the seen setting promos ("mode-strip-tip-start:<ms>"), so it survives a
 * reload and is shared across browsers. A phone gets neither: they are about keys. Each waits in the bell until it is
 * read ("Mark read" or its button), and then it is gone for good.
 */
(function initKeysTipsNotice(global) {
    'use strict';

    const STRIP_ID = 'mode-strip-tip-v1';
    const LEGEND_ID = 'key-legend-tip-v1';
    const START_PREFIX = 'mode-strip-tip-start:';
    const LEGEND_DELAY_MS = 3 * 24 * 3600 * 1000;
    // Nothing arrives in the first minute of a visit: the row, its badge and
    // the bell's sound all come once the person has had time to settle in.
    const SETTLE_MS = 60 * 1000;
    const loadedAt = Date.now();
    const settled = () => Date.now() - loadedAt >= SETTLE_MS;
    // Both tips are about keys: a phone has none, so neither is offered there.
    const phone = () => global.isPhoneDevice?.() === true;

    const dash = () => global.dashboardInstance || null;
    const state = () => global.DiscoverabilityState;

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    const answered = (id) => state()?.hasSeenSettingPromo?.(id) === true;

    /** When the strip tip first showed, written down the first time it is asked for. */
    function startedAt() {
        const ds = state();
        if (!ds) return 0;
        const found = (ds.getSeenSettingPromos?.() || []).find((id) => id.startsWith(START_PREFIX));
        if (found) return Number(found.slice(START_PREFIX.length)) || 0;
        const now = Date.now();
        ds.markSettingPromoSeen?.(START_PREFIX + now);
        return now;
    }

    function stripText() {
        return t('dashboard.modeStripTipText',
            'The strip beside the page name says what your keys do. Shift+S switches it off, and Shift+S brings it back. The same switch is under Config → Behavior → Keyboard.');
    }

    function legendText() {
        return t('dashboard.keyLegendTipText',
            'Every view can show a legend of its keys. Shift+H hides it, and Shift+H shows it again. Where it sits, below, above or off, is under Config → Behavior → Keyboard.');
    }

    const strip = global.NoticeCard.define({
        id: 'mode-strip-tip',
        title: () => t('dashboard.modeStripTipTitle', 'The mode strip: off and on'),
        bell: {
            kind: 'tip',
            group: 'tips',
            icon: '⌨',
            no: 'forever',
            state: async () => {
                if (phone() || answered(STRIP_ID) || !settled()) return null;
                startedAt();
                return { count: 1, text: stripText() };
            },
            onRead: () => state()?.markSettingPromoSeen?.(STRIP_ID),
            actions: [{
                label: () => t('dashboard.modeStripTipTry', 'Try Shift+S'),
                primary: true,
                marksRead: true,
                onClick: () => { void global.ModeStrip?.toggle?.(); },
            }],
        },
    });

    const legend = global.NoticeCard.define({
        id: 'key-legend-tip',
        title: () => t('dashboard.keyLegendTipTitle', 'The key legend: hide and show'),
        bell: {
            kind: 'tip',
            group: 'tips',
            icon: '⌨',
            no: 'forever',
            state: async () => {
                if (phone() || answered(LEGEND_ID) || !settled()) return null;
                const start = startedAt();
                if (!start || Date.now() < start + LEGEND_DELAY_MS) return null;
                return { count: 1, text: legendText() };
            },
            onRead: () => state()?.markSettingPromoSeen?.(LEGEND_ID),
            actions: [{
                label: () => t('dashboard.keyLegendTipOpen', 'Open the key settings'),
                primary: true,
                marksRead: true,
                onClick: () => { dash()?.config?.openConfigView?.('behavior'); },
            }],
        },
    });

    const start = () => {
        strip.autoStart();
        legend.autoStart();
        // The bell polls on its own clock; ask once more as the minute ends.
        setTimeout(() => global.NotificationBell?.refreshAll?.(), SETTLE_MS + 500);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }

    global.DashboardKeysTips = { SETTLE_MS, STRIP_ID, LEGEND_ID, START_PREFIX, LEGEND_DELAY_MS };
}(typeof window !== 'undefined' ? window : globalThis));
