/**
 * One-time Widgets tour — shown the first time Config → Widgets is opened.
 *
 * Built the same way as inbox-tutorial.js and health-tutorial.js, and sharing
 * their guards, so a session with tips switched off, or a phone, sees none of
 * them.
 *
 * Why it exists: the Widgets tab opens on a list of your own widgets and a
 * button, which says nothing about the two things worth knowing -- that the
 * catalogue holds ready-made widgets, many needing no setup, and that the
 * custom widget points at any address answering JSON. Four short steps.
 *
 * The first step is deliberately an animation rather than prose. What a custom
 * widget does — ask an address, put the answer on the grid — is a movement, and
 * a still picture of it is a paragraph asking to be read twice.
 */
(function (global) {
    'use strict';

    // Also named in dashboard-config.js, which checks it before fetching this
    // file at all. Both must agree.
    const TIP_ID = 'widgetsTutorialV1';

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

    /** A key hint, matching the chips under the grid. */
    const key = (k, label) =>
        `<span class="widgets-tutorial-key"><kbd>${esc(k)}</kbd>${esc(label)}</span>`;

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
                title: t('widgetsTour2WhatTitle', 'A block that shows what is going on'),
                visual: heroVisual(),
                body: `<p>${esc(t('widgetsTour2WhatBody1',
                    'A widget sits among your categories and shows what is going on: how much is waiting, what is down, how full the disk is.'))}</p>
                <p>${esc(t('widgetsTour2WhatBody2',
                    'Many need nothing set up at all. Click a figure and you land on the rows behind it.'))}</p>`,
            },
            {
                title: t('widgetsTour2CatalogueTitle', 'A catalogue of ready-made widgets'),
                visual: `<div class="widgets-tutorial-visual widgets-tutorial-visual--presets">
                    ${[t('widgetsTour2KindHealth', 'Health'), t('widgetsTour2KindInbox', 'Inbox'), t('widgetsTour2KindWeather', 'Weather'),
                        t('widgetsTour2KindCalendar', 'Calendar'), t('widgetsTour2KindFeeds', 'Feeds'), t('widgetsTour2KindDisks', 'Disks'),
                        'Jellyfin', 'Sonarr', 'Radarr', 'Seerr', 'qBittorrent', 'SABnzbd', 'Unraid', 'Home Assistant']
                        .map((name) => chip(name)).join('')}
                </div>`,
                body: `<p>${esc(t('widgetsTour2CatalogueBody1',
                    'Some widgets read what nextDash already keeps: health, uptime, the inbox and feeds. Others show the machine, the weather or a calendar.'))}</p>
                <p>${esc(t('widgetsTour2CatalogueBody2',
                    'Media and home widgets read Jellyfin, Sonarr, Radarr, qBittorrent, Unraid or Home Assistant once you connect them. Add a widget opens the catalogue, with search.'))}</p>`,
            },
            {
                title: t('widgetsTour2CustomTitle', 'The custom widget: any address that answers JSON'),
                visual: `<div class="widgets-tutorial-visual widgets-tutorial-visual--map">
                    <pre class="widgets-tutorial-json">{ "totalRecords": <b>7</b>,
  "cpu": { "load": <b>38</b> } }</pre>
                    <span class="widgets-tutorial-arrow" aria-hidden="true">→</span>
                    <span class="widgets-tutorial-paths">
                        ${chip('totalRecords')}
                        ${chip('cpu.load')}
                    </span>
                </div>`,
                body: `<p>${esc(t('widgetsTour2CustomBody1',
                    'Give it an address, then name the fields you want by their path, such as cpu.load. Presets fill this in for dozens of common services.'))}</p>
                <p>${esc(t('widgetsTour2CustomBody2',
                    'nextDash fetches the address itself, not your browser. The key stays on the server, and a service your browser cannot reach still works.'))}</p>`,
            },
            {
                title: t('widgetsTour2PageTitle', 'On the page it behaves like a category'),
                visual: `<div class="widgets-tutorial-visual widgets-tutorial-visual--keys">
                    ${key('F2', t('widgetsTutorialKeyRename', 'rename'))}
                    ${key('Shift+W', t('widgetsTutorialKeyWidth', 'one column or two'))}
                    ${key('Delete', t('widgetsTutorialKeyClose', 'close'))}
                    ${key('Enter', t('widgetsTutorialKeyFold', 'fold'))}
                </div>`,
                body: `<p>${esc(t('widgetsTour2PageBody1',
                    'Drag the // in its title to move it, click the header to fold it, and right-click it for rename, width, settings and close.'))}</p>
                <p>${esc(t('widgetsTour2PageBody2',
                    'Shown, in Config → Widgets, takes a widget off the page without losing its settings. The Tour button above the list brings this tour back.'))}</p>`,
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
            // Escape, the backdrop and walking away all count as seen: the catalogue
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
        if (!d?.settings || d.settings.enableSessionTips === false) return false;
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
