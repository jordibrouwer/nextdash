/**
 * One-time Widgets tour — shown the first time Config → Widgets is opened.
 *
 * Built the same way as inbox-tutorial.js and health-tutorial.js, and sharing
 * their guards, so a session with tips switched off, or a phone, sees none of
 * them.
 *
 * Why it exists: the Widgets tab opens on a list of your own widgets and a
 * button, which says nothing about the two things worth knowing — that thirteen
 * of the types read data this install already has and need no setup at all, and
 * that the fourteenth points at any address answering JSON, which is what turns
 * the dashboard into a readout of the services you run. That second one is
 * invisible from the tab: the catalogue says "Custom" and leaves the reader to
 * guess what it can reach.
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

    /** A stand-in tile: a title bar and a row of figures, as on the dashboard. */
    function tile(title, figures, extra = '') {
        const cells = figures.map(([value, label]) => `
            <span class="widgets-tutorial-stat">
                <span class="widgets-tutorial-stat-value">${esc(value)}</span>
                <span class="widgets-tutorial-stat-label">${esc(label)}</span>
            </span>`).join('');
        return `<span class="widgets-tutorial-tile${extra}">
            <span class="widgets-tutorial-tile-title">// ${esc(title)}</span>
            <span class="widgets-tutorial-tile-body">${cells}</span>
        </span>`;
    }

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
                title: t('widgetsTutorialStep1Title', 'A block that answers “what is going on”'),
                visual: heroVisual(),
                body: `<p>${esc(t('widgetsTutorialStep1Body1',
                    'A dashboard of links answers “where do I go”. A widget answers the other question: how much is waiting, what is down, how full the disk is. It sits among your categories, is dragged into place like one, and is one or two columns wide.'))}</p>
                <p>${esc(t('widgetsTutorialStep1Body2',
                    'Most of them need nothing set up at all. And one of them — the custom widget — points at any address on your network that answers with JSON, which is what puts the services you run on the page beside the links to them. Six short steps.'))}</p>`,
            },
            {
                title: t('widgetsTutorialStep2Title', 'Thirteen tiles that read what nextDash already keeps'),
                visual: `<div class="widgets-tutorial-visual widgets-tutorial-visual--tiles">
                    ${tile(t('widgetsTutorialTileHealth', 'health'), [['0', t('widgetsTutorialTileBroken', 'broken')], ['8', t('widgetsTutorialTileHealthy', 'healthy')]])}
                    ${tile(t('widgetsTutorialTileInbox', 'inbox'), [['3', t('widgetsTutorialTileWaiting', 'waiting')], ['2d', t('widgetsTutorialTileOldest', 'oldest')]])}
                </div>`,
                body: `<p>${esc(t('widgetsTutorialStep2Body1',
                    'Health, Uptime, Certificates and Trend report what the health view reports. Inbox says what is waiting, Feeds which feed went quiet, Sources which import failed. Neglected, Blind spots, Duplicates, Archive, Trash and Backups each name a kind of tidying.'))}</p>
                <p>${esc(t('widgetsTutorialStep2Body2',
                    'None of them polls anything new: the figures are already on disk and had nowhere to show. Click a figure and you land on the rows behind it, filtered.'))}</p>`,
            },
            {
                title: t('widgetsTutorialStep3Title', 'Each one has a few settings, and no more'),
                visual: `<div class="widgets-tutorial-visual">
                    ${chip(t('widgetsTutorialChipPage', 'This page or all'))}
                    ${chip(t('widgetsTutorialChipRows', 'Rows: 5'))}
                    ${chip(t('widgetsTutorialChipWidth', 'One column / two'))}
                    ${chip(t('widgetsTutorialChipShown', 'Shown'), ' is-on')}
                </div>`,
                body: `<p>${esc(t('widgetsTutorialStep3Body1',
                    'What it counts, how many rows it shows, what it is called, how wide it is. Leave the title empty and the tile uses its type’s name. A tile that leaves rows out says how many, because five of twelve should not look like five of five.'))}</p>
                <p>${esc(t('widgetsTutorialStep3Body2',
                    'Shown takes a widget off the dashboard without deleting it or losing its settings — the same switch the Close entry on the dashboard writes.'))}</p>`,
            },
            {
                title: t('widgetsTutorialStep4Title', 'The custom widget: any address that answers JSON'),
                visual: `<div class="widgets-tutorial-visual widgets-tutorial-visual--map">
                    <pre class="widgets-tutorial-json">{ "totalRecords": <b>7</b>,
  "cpu": { "load": <b>38</b> } }</pre>
                    <span class="widgets-tutorial-arrow" aria-hidden="true">→</span>
                    <span class="widgets-tutorial-paths">
                        ${chip('totalRecords')}
                        ${chip('cpu.load')}
                    </span>
                </div>`,
                body: `<p>${esc(t('widgetsTutorialStep4Body1',
                    'Give it an address, then name the fields you want by their path into the answer — totalRecords, cpu.load, data.0.name. Each becomes a figure on the tile, with a label you choose and a shape: a count, a percentage, bytes, a duration, a date, or plain text.'))}</p>
                <p>${esc(t('widgetsTutorialStep4Body2',
                    'A path into a list works too, so an endpoint that returns items can be drawn as rows rather than figures. Nothing is hard-coded per service: if it speaks JSON over HTTP, it can be a tile.'))}</p>`,
            },
            {
                title: t('widgetsTutorialStep5Title', 'Twenty-eight services already written down'),
                visual: `<div class="widgets-tutorial-visual widgets-tutorial-visual--presets">
                    ${['Sonarr', 'Radarr', 'Plex', 'Jellyfin', 'Immich', 'qBittorrent', 'SABnzbd',
                        'Pi-hole', 'AdGuard Home', 'Traefik', 'Proxmox VE', 'TrueNAS', 'Glances',
                        'Syncthing', 'Nextcloud', 'Paperless-ngx', 'Home Assistant', 'Grafana', 'ntfy']
                        .map((name) => chip(name)).join('')}
                    ${chip(t('widgetsTutorialPresetsMore', '…and nine more'), ' is-quiet')}
                </div>`,
                body: `<p>${esc(t('widgetsTutorialStep5Body1',
                    'Pick a preset and the address shape, the fields and the labels arrive already written — media servers and downloaders, the network boxes, the machine itself, and the everyday apps. You edit it from there rather than starting at a blank form.'))}</p>
                <p>${esc(t('widgetsTutorialStep5Body2',
                    'A preset is a starting point, not a lock: change a path, drop a figure, point it at a different host. And a service nobody has written down yet is the same form with the fields left blank.'))}</p>`,
            },
            {
                title: t('widgetsTutorialStep6Title', 'The request is made by the server, and the key stays there'),
                visual: `<div class="widgets-tutorial-visual">
                    ${chip(t('widgetsTutorialAuthHeader', 'Header'))}
                    ${chip(t('widgetsTutorialAuthKey', 'API key'))}
                    ${chip(t('widgetsTutorialAuthBasic', 'Username & password'))}
                    <span class="widgets-tutorial-visual-hint">${esc(t('widgetsTutorialAuthHint', 'Kept on the machine running nextDash, out of the page and out of your backups'))}</span>
                </div>`,
                body: `<p>${esc(t('widgetsTutorialStep6Body1',
                    'The tile’s address is fetched by nextDash itself, not by your browser. That is what lets a widget read a service your browser cannot reach at all, and it keeps the token out of a page anyone can view the source of.'))}</p>
                <p>${esc(t('widgetsTutorialStep6Body2',
                    'It inherits the same protections as every other outbound request — the address checks and the rate limit — and a widget that needs a sign-in says so on the tile rather than failing quietly.'))}</p>`,
            },
            {
                title: t('widgetsTutorialStep7Title', 'On the page it behaves like a category'),
                visual: `<div class="widgets-tutorial-visual widgets-tutorial-visual--keys">
                    ${key('F2', t('widgetsTutorialKeyRename', 'rename'))}
                    ${key('Shift+W', t('widgetsTutorialKeyWidth', 'one column or two'))}
                    ${key('Delete', t('widgetsTutorialKeyClose', 'close'))}
                    ${key('Enter', t('widgetsTutorialKeyFold', 'fold'))}
                </div>`,
                body: `<p>${esc(t('widgetsTutorialStep7Body1',
                    'Drag the // in its title to move it among your categories, click the header to fold it away, and right-click it for rename, width, settings and close. The arrow keys walk into a tile and through its rows, and Enter on a row does what clicking it does.'))}</p>
                <p>${esc(t('widgetsTutorialStep7Body2',
                    'Everything here is also on this tab: Add a widget opens the catalogue, and Types describes each kind before you take it.'))}</p>`,
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
            // Escape, the backdrop and walking away all count as seen: the Types
            // tab covers the same ground on demand, so reopening this on every
            // visit to the section would be nagging.
            onHide: () => finish('dismissed'),
        });
    }

    let finished = false;
    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('widgets-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /**
     * Called from the config panel when the Widgets section opens.
     *
     * Same guard order as the other tours: the seen-check first because it is
     * the cheapest, then the settings, then the things that would make popping a
     * modal wrong at this moment.
     */
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

    global.WidgetsTutorial = { TIP_ID, maybeShow };
}(typeof window !== 'undefined' ? window : globalThis));
