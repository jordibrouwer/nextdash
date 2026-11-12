/**
 * Three tips in the notifications bell about the themes that react to something: Skywatch (the
 * weather), Tidewatch (the health of your services) and Daydrift (the time of day).
 *
 * They are the three themes of the new groups that do something besides look different, and the
 * popover that introduces the groups (new-themes-notice.js) can only say so in a line. Each tip
 * waits in the bell, in the Tips group, until it is read, and they arrive one a day: Skywatch on
 * the first day, Tidewatch on the second, Daydrift on the third. The days count from the first
 * time an upgraded install ran the release that brought them (discoverabilityState.themeTipsFrom,
 * written once). A fresh install is not told: it finds its themes itself.
 *
 * A tip is not there when the install already wears that theme, in either half.
 */
(function initThemeTips(global) {
    'use strict';

    const DAY_MS = 24 * 60 * 60 * 1000;

    const TIPS = [
        {
            id: 'theme-tip-skywatch',
            family: 'living-skywatch',
            icon: '\u{1F326}',
            key: 'dashboard.themeTipSkywatch',
            text: 'Skywatch draws the weather behind your page: rain, fog, snow, sun or stars, from the weather widget’s own data. Set a weather location and the page follows the sky outside.',
        },
        {
            id: 'theme-tip-tidewatch',
            family: 'living-tidewatch',
            icon: '\u{1F30A}',
            key: 'dashboard.themeTipTidewatch',
            text: 'Tidewatch draws a waterline that follows the health of your bookmarks: low teal water when everything is up, amber for a dead link, a high coral surge when something is down.',
        },
        {
            id: 'theme-tip-daydrift',
            family: 'living-daydrift',
            icon: '\u{1F305}',
            key: 'dashboard.themeTipDaydrift',
            text: 'Daydrift follows the time of day: its colours move with your clock, from peach dawn through a noon sky to a navy night, with a sun or moon crossing an arc.',
        },
    ];

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    /** Upgraded installs only: a fresh one has not "been using" anything yet. */
    function eligible() {
        const settings = dash()?.settings;
        return Boolean(settings) && settings.firstRunInstall !== true;
    }

    /** The day the three tips count from, written the first time an eligible install gets here. */
    function startedAt() {
        const state = global.DiscoverabilityState;
        if (!state?.getThemeTipsFrom) return 0;
        let from = state.getThemeTipsFrom();
        if (!(from > 0) && eligible()) {
            from = Date.now();
            state.noteThemeTipsFrom(from);
        }
        return from;
    }

    function mode() {
        return /-light$/.test(String(dash()?.settings?.theme || '')) ? 'light' : 'dark';
    }

    function wearing(family) {
        return String(dash()?.settings?.theme || '').startsWith(`${family}-`);
    }

    function due(index) {
        const from = startedAt();
        return from > 0 && Date.now() - from >= index * DAY_MS;
    }

    async function useTheme(tip) {
        const d = dash();
        const config = d?.config;
        if (!config?.applyThemeChoice) return;
        const id = `${tip.family}-${mode()}`;
        const previous = d.settings?.theme;
        try {
            await config.applyThemeChoice(id);
            await config.applyThemeLookAndSave?.(id, previous);
        } catch { /* the page keeps what it had */ }
    }

    function openStudio(tip) {
        const d = dash();
        const name = tip.family.split('-').pop();
        if (d?.config?.openThemeBrowser) {
            void Promise.resolve(d.config.openThemeBrowser({ query: name })).catch(() => {});
        } else {
            global.location.hash = 'config/appearance';
        }
    }

    function register(tip, index) {
        const card = global.NoticeCard.define({
            id: tip.id,
            title: () => t(`${tip.key}Title`, tip.family === 'living-skywatch' ? 'Skywatch follows the weather'
                : tip.family === 'living-tidewatch' ? 'Tidewatch follows your services' : 'Daydrift follows the day'),
            bell: {
                kind: 'tip',
                group: 'tips',
                icon: tip.icon,
                no: 'forever',
                state: async () => (!eligible() || wearing(tip.family) || !due(index) ? null : {
                    count: 1,
                    text: t(tip.key, tip.text),
                }),
                actions: [
                    {
                        label: () => t('dashboard.newThemesUse', 'Use this theme'),
                        primary: true,
                        marksRead: true,
                        onClick: () => useTheme(tip),
                    },
                    {
                        label: () => t('dashboard.themeTipStudio', 'Open in the theme studio'),
                        marksRead: true,
                        onClick: () => openStudio(tip),
                    },
                ],
            },
        });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
        } else {
            card.autoStart();
        }
        return card;
    }

    const cards = TIPS.map(register);

    global.DashboardThemeTips = { TIPS, DAY_MS, due, eligible, startedAt, cards };
}(typeof window !== 'undefined' ? window : globalThis));
