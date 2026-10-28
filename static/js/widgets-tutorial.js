/**
 * One-time Widgets tour — shown the first time Config → Widgets is opened.
 *
 * Built the same way as inbox-tutorial.js and health-tutorial.js, and sharing
 * their guards, so a session with tips switched off, or a phone, sees none of
 * them.
 *
 * Why it exists: Config → Widgets opens on a list of your own widgets and an
 * Add widget button, which says nothing about what is worth knowing -- that the
 * picker holds ready-made widgets, many needing no setup, that media kinds are
 * connected and tested first, and that Custom points at any address answering
 * JSON. Four short steps that follow the wizard.
 *
 * The first step is deliberately an animation rather than prose. What a custom
 * widget does — ask an address, put the answer on the grid — is a movement, and
 * a still picture of it is a paragraph asking to be read twice.
 */
(function (global) {
    'use strict';

    // Also named in dashboard-config.js, which checks it before fetching this
    // file at all. Both must agree.
    const TIP_ID = 'widgetsTutorialV2';

    function t(key, fallback, params) {
        const lang = global.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const full = key.includes('.') ? key : `dashboard.${key}`;
            const value = lang.t(full);
            if (value && value !== full) text = value;
        }
        return params
            ? Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(text)
            )
            : text;
    }

    const esc = window.NextDashHtml.escapeHtml;

    /** A chip, the shape the config panel and the tiles already use. */
    const chip = (label, extra = '') =>
        `<span class="widgets-tutorial-chip${extra}">${esc(label)}</span>`;

    /*
     * The opening animation: an address, a request travelling along the wire,
     * and a tile filling in with what came back.
     *
     * Everything here is CSS — three keyframed elements on a loop — because the
     * point is the movement, and a video or a GIF would be a second copy of the
     * interface to keep in step with the real one. It stops for
     * prefers-reduced-motion and for the app's own no-animations setting, where
     * it reads as the finished picture instead.
     */
    function heroVisual() {
        return `<div class="widgets-tutorial-hero" aria-hidden="true">
            <div class="widgets-tutorial-hero-source">
                <span class="widgets-tutorial-hero-label">${esc(t('widgetsTutorialHeroService', 'your service'))}</span>
                <code class="widgets-tutorial-hero-url">/api/v3/queue</code>
            </div>
            <div class="widgets-tutorial-hero-wire">
                <span class="widgets-tutorial-hero-pulse"></span>
            </div>
            <div class="widgets-tutorial-hero-tile">
                <span class="widgets-tutorial-hero-tile-title">// ${esc(t('widgetsTutorialHeroTile', 'downloads'))}</span>
                <span class="widgets-tutorial-hero-figures">
                    <span class="widgets-tutorial-hero-figure" style="--at:0">
                        <b>7</b><i>${esc(t('widgetsTutorialHeroQueued', 'queued'))}</i>
                    </span>
                    <span class="widgets-tutorial-hero-figure" style="--at:1">
                        <b>2</b><i>${esc(t('widgetsTutorialHeroActive', 'active'))}</i>
                    </span>
                    <span class="widgets-tutorial-hero-figure" style="--at:2">
                        <b>41</b><i>${esc(t('widgetsTutorialHeroDone', 'done'))}</i>
                    </span>
                </span>
            </div>
        </div>`;
    }

    /**
     * Each step is a title, a visual and an HTML body. The bodies are trusted —
     * assembled here from esc()'d pieces, never from user input — and the
     * visuals are built from the real class names' shapes, so what the reader
     * sees is the thing itself rather than a drawing of it.
     */
    function steps() {
        return [
            {
                title: t('widgetsTour3ListTitle', 'Your widgets, in one list'),
                visual: heroVisual(),
                body: `<p>${esc(t('widgetsTour3ListBody1',
                    'A widget sits among your categories and shows what is going on: how much is waiting, what is down, how full the disk is.'))}</p>
                <p>${esc(t('widgetsTour3ListBody2',
                    'Config → Widgets lists every one you have, with Shown to take it off the page and Settings to change it. Click a figure on the page and you land on the rows behind it.'))}</p>`,
            },
            {
                title: t('widgetsTour3AddTitle', 'Add widget opens a picker'),
                visual: `<div class="widgets-tutorial-visual widgets-tutorial-visual--presets">
                    ${chip(t('widgetsTour3Search', 'Search kinds'))}
                    ${[t('widgetsTour3KindHealth', 'Health'), t('widgetsTour3KindInbox', 'Inbox'), t('widgetsTour3KindWeather', 'Weather'),
                        t('widgetsTour3KindCalendar', 'Calendar'), t('widgetsTour3KindFeeds', 'Feeds'), t('widgetsTour3KindDisks', 'Disks'),
                        'Jellyfin', 'Sonarr', 'Radarr', 'Seerr', 'qBittorrent', 'Home Assistant']
                        .map((name) => chip(name)).join('')}
                </div>`,
                body: `<p>${esc(t('widgetsTour3AddBody1',
                    'Search by name, then choose a kind. Many need nothing set up at all: health, uptime, the inbox, feeds, disks, the weather or a calendar.'))}</p>
                <p>${esc(t('widgetsTour3AddBody2',
                    'Last, choose the page it goes on. Media and home kinds ask you to connect first.'))}</p>`,
            },
            {
                title: t('widgetsTour3ConnectTitle', 'Connect, then Test'),
                visual: `<div class="widgets-tutorial-visual widgets-tutorial-visual--map">
                    <pre class="widgets-tutorial-json">${esc(t('widgetsTour3Address', 'Address'))}  http://sonarr:8989
${esc(t('widgetsTour3Key', 'Key'))}      ••••••••</pre>
                    <span class="widgets-tutorial-arrow" aria-hidden="true">→</span>
                    <span class="widgets-tutorial-paths">
                        ${chip(t('widgetsTour3Test', 'Test'))}
                        ${chip(t('widgetsTour3Failed', 'Could not connect'))}
                        ${chip(t('widgetsTour3AddAnyway', 'Add anyway'))}
                    </span>
                </div>`,
                body: `<p>${esc(t('widgetsTour3ConnectBody1',
                    'Media and home widgets ask for an address and, where needed, a key. Test asks the service right now and tells you what to fix before anything is added.'))}</p>
                <p>${esc(t('widgetsTour3ConnectBody2',
                    'A failed test never blocks you: Add anyway still adds the widget, for a service that is down or not on yet. The key stays on the server.'))}</p>`,
            },
            {
                title: t('widgetsTour3CustomTitle', 'Custom is a kind too: any address that answers JSON'),
                visual: `<div class="widgets-tutorial-visual widgets-tutorial-visual--map">
                    <pre class="widgets-tutorial-json">{ "totalRecords": <b>7</b>,
  "cpu": { "load": <b>38</b> } }</pre>
                    <span class="widgets-tutorial-arrow" aria-hidden="true">→</span>
                    <span class="widgets-tutorial-paths">
                        ${chip('totalRecords')}
                        ${chip('cpu.load')}
                    </span>
                </div>`,
                body: `<p>${esc(t('widgetsTour3CustomBody1',
                    'Pick Custom in the picker and give it an address. nextDash fetches it itself, not your browser, so a service your browser cannot reach still works.'))}</p>
                <p>${esc(t('widgetsTour3CustomBody2',
                    "Add it first, then choose the figures you want by their path, such as cpu.load, in the widget's settings."))}</p>`,
            },
        ];
    }

    let state = { index: 0 };

    function render() {
        const all = steps();
        const total = all.length;
        const step = all[state.index];
        const isLast = state.index === total - 1;
        const isFirst = state.index === 0;
        const progress = t('widgetsTutorialProgress', 'Step {n} of {total}', { n: state.index + 1, total });

        const html = `
            <div class="widgets-tutorial">
                <div class="widgets-tutorial-progress">${esc(progress)}</div>
                <h3 class="widgets-tutorial-step-title">${esc(step.title)}</h3>
                ${step.visual || ''}
                <div class="widgets-tutorial-step-body">${step.body}</div>
                <div class="widgets-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="widgets-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('widgetsTutorialTitle', 'What a widget can do'),
            htmlMessage: html,
            confirmText: isLast
                ? t('widgetsTutorialDone', 'Got it')
                : t('widgetsTutorialNext', 'Next'),
            cancelText: isFirst
                ? t('widgetsTutorialSkip', 'Skip')
                : t('widgetsTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'widgets-tutorial-modal',
            modalMaxWidth: 'min(36rem, calc(100vw - 2.5rem))',
            onConfirm: () => {
                if (isLast) {
                    finish('completed');
                    return;
                }
                state.index += 1;
                render();
            },
            onCancel: () => {
                if (isFirst) {
                    finish('skipped');
                    return;
                }
                state.index -= 1;
                render();
            },
            // Escape, the backdrop and walking away all count as seen: the picker
            // covers the same ground on demand, so reopening this on every
            // visit to the section would be nagging.
            // Only a real dismissal: Next and Back close the window too, and
            // reach here with their own reason after they have run.
            onHide: ({ reason } = {}) => { if (reason === 'dismiss') finish('dismissed'); },
        });
    }

    let finished = false;
    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('widgets-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** The first visit to the view: once, with the same guards as the dashboard's tour. */
    function maybeShow() {
        if (global.DiscoverabilityState?.hasSeenTip?.(TIP_ID)) return false;
        const d = global.dashboardInstance;
        if (!d?.settings || d.settings.enableSessionTips === false || d.settings.enableSectionTours === false) return false;
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (d.searchComponent?.isActive?.()) return false;
        if (!global.AppModal?.show) return false;

        state = { index: 0 };
        finished = false;
        render();
        global.nextdashTrack?.('widgets-tutorial:shown');
        return true;
    }

    /** The Tour button in the Widgets band, and Config's replay: on request, seen or not. */
    function open() {
        const d = global.dashboardInstance;
        if (!global.AppModal?.show) return false;
        if (typeof d?.isModalOpen === 'function' && d.isModalOpen()) return false;
        state = { index: 0 };
        finished = false;
        render();
        global.nextdashTrack?.('widgets-tutorial:opened');
        return true;
    }

    global.WidgetsTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
