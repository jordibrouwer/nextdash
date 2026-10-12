/**
 * Media tiles: a service's newest things, with posters, in one of four layouts.
 *
 * Jellyfin was the first; Sonarr and Radarr draw through the same code. A
 * service registers its id, its name and its words, and everything else --
 * the layouts, the pictures, the detail card, where a click goes -- is here.
 *
 * How wide the tile is comes from the panel's container query, not from
 * config.columns: the wide-only blocks are always built and hidden when the
 * tile is narrow, so a two-column widget on a one-column dashboard (or a
 * phone) reads as the one-column version.
 *
 * Items are buttons rather than anchors, as in the RSS tile: keyboard
 * navigation walks the buttons in a widget body, and bindRowAction's
 * data-widget-href gives back what an anchor was for.
 */
(function () {
    'use strict';

    const NARROW_STRIP = 4;
    const WIDE_STRIP = 8;

    /*
     * What every tile says, unless its service says it differently.
     *
     * {name} is the service's name. Jellyfin overrides every key with the ones
     * it shipped with in v1.19.4, so its translations keep working.
     */
    const DEFAULT_WORDS = {
        notSetUp: ['dashboard.widgetMediaNotSetUp', 'Connect {name} in this widget’s settings.'],
        notAllowed: ['dashboard.widgetMediaNotAllowed',
            '{name} is on your local network, and local addresses are not allowed yet. Allow them in Config first.'],
        refused: ['dashboard.widgetMediaRefused', '{name} refused the API key.'],
        noLibraries: ['dashboard.widgetMediaNoLibraries', 'Nothing chosen to show. Choose again in the settings.'],
        unreachable: ['dashboard.widgetMediaUnreachable', '{name} could not be reached.'],
        justNow: ['dashboard.widgetMediaJustNow', 'just now'],
        minutesAgo: ['dashboard.widgetMediaMinutesAgo', '{n}m'],
        hoursAgo: ['dashboard.widgetMediaHoursAgo', '{n}h'],
        daysAgo: ['dashboard.widgetMediaDaysAgo', '{n}d'],
        today: ['dashboard.widgetMediaToday', 'today'],
        inDays: ['dashboard.widgetMediaInDays', 'in {n}d'],
        waiting: ['dashboard.widgetMediaWaiting', 'Loading…'],
        nothing: ['dashboard.widgetMediaNothing', 'Nothing new.'],
        groupFailed: ['dashboard.widgetMediaGroupFailed', 'This part could not be read just now. It is tried again shortly.'],
        open: ['dashboard.widgetMediaOpen', 'Open in {name}'],
        close: ['dashboard.widgetMediaClose', 'Close'],
        actionOpen: ['widgetActionMediaOpen', 'Open in {name}'],
        actionDetails: ['widgetActionMediaDetails', 'Show details'],
    };

    const ERROR_WORDS = {
        'not set up': 'notSetUp',
        'address not allowed': 'notAllowed',
        'key refused': 'refused',
        'no libraries': 'noLibraries',
        unreachable: 'unreachable',
    };

    const services = {};

    /**
     * Register a service: { id, name, words: {key: [i18nKey, fallback]},
     * emptyGroup: {groupId: [i18nKey, fallback]} }. Returns its renderer.
     */
    function register(service) {
        services[service.id] = service;
        return (body, widget, dash) => render(body, widget, dash, service);
    }

    function serviceOf(widget) {
        return services[widget?.type] || { id: widget?.type, name: widget?.type, words: {} };
    }

    function say(dash, widget, key, values = {}) {
        const service = serviceOf(widget);
        const [i18n, fallback] = service.words?.[key] || DEFAULT_WORDS[key] || [key, key];
        const value = dash?.language?.t?.(i18n);
        let text = value && value !== i18n ? value : fallback;
        Object.entries({ name: service.name, ...values }).forEach(([k, v]) => {
            text = text.replace(`{${k}}`, String(v));
        });
        return text;
    }

    function textBlock(tag, className, text) {
        const el = document.createElement(tag);
        el.className = className;
        el.textContent = String(text ?? '');
        return el;
    }

    function sayIn(body, className, text) {
        body.replaceChildren(textBlock('p', className, text));
    }

    function wideOnly(el) {
        el.classList.add('dashboard-widget-wide-only');
        return el;
    }

    function rows(widget) {
        return window.DashboardWidgetUtils?.rowLimit?.(widget, 6) || 6;
    }

    function ttlMs(widget) {
        const ttl = Number(widget?.config?.ttl);
        return (Number.isFinite(ttl) && ttl >= 60 ? ttl : 300) * 1000;
    }

    /** One answer per widget for its own TTL, so a repaint is not a round trip. */
    async function load(dash, widget, pageId, service) {
        dash._widgetMedia = dash._widgetMedia || {};
        const key = `${service.id}:${pageId}:${widget.id}`;
        const held = dash._widgetMedia[key];
        if (held && held.until > Date.now()) return held.result;
        try {
            const res = await fetch(`/api/widgets/${service.id}?pageId=${encodeURIComponent(pageId)}`
                + `&id=${encodeURIComponent(widget.id)}`);
            if (!res.ok) return null;
            const result = await res.json();
            // A half answer is looked at again soon, as the server does.
            const keep = result.partial ? Math.min(ttlMs(widget), 30_000) : ttlMs(widget);
            dash._widgetMedia[key] = { result, until: Date.now() + keep };
            return result;
        } catch (error) {
            return null;
        }
    }

    function errorText(dash, widget, code) {
        return say(dash, widget, ERROR_WORDS[code] || 'unreachable');
    }

    function agoText(dash, widget, at) {
        const ms = Date.now() - (Number(at) || 0);
        if (!Number(at) || ms < 60_000) return say(dash, widget, 'justNow');
        const minutes = Math.floor(ms / 60_000);
        if (minutes < 60) return say(dash, widget, 'minutesAgo', { n: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return say(dash, widget, 'hoursAgo', { n: hours });
        return say(dash, widget, 'daysAgo', { n: Math.floor(hours / 24) });
    }

    /** When something is due: "today" or "in 3d". */
    function whenText(dash, widget, at) {
        const days = Math.floor((Number(at) - Date.now()) / 86_400_000);
        if (days <= 0) return say(dash, widget, 'today');
        return say(dash, widget, 'inDays', { n: days });
    }

    /** The time word for an item: how long ago it came, or when it is due. */
    function timeText(dash, widget, item) {
        if (Number(item.when) > 0) return whenText(dash, widget, item.when);
        return agoText(dash, widget, item.addedAt);
    }

    function titleText(item) {
        return item.subtitle ? `${item.title} — ${item.subtitle}` : String(item.title || '');
    }

    function metaText(dash, widget, item, { wide = false } = {}) {
        const parts = [item.library];
        if (wide && item.year) parts.push(String(item.year));
        if (wide && item.genres?.length) parts.push(item.genres.slice(0, 2).join(', '));
        if (item.left) parts.push(item.left);
        else parts.push(timeText(dash, widget, item));
        return parts.filter(Boolean).join(' · ');
    }

    /** Where a click goes: the widget's own choice, or the dashboard's. */
    function targetFor(dash, widget) {
        const chosen = String(widget?.config?.target || 'inherit');
        if (chosen === '_blank' || chosen === '_self') return chosen;
        return dash?.settings?.openInNewTab ? '_blank' : '_self';
    }

    function go(dash, widget, link) {
        if (!link) return;
        if (targetFor(dash, widget) === '_blank') {
            window.open(link, '_blank', 'noopener,noreferrer');
            return;
        }
        window.location.href = link;
    }

    function initials(title) {
        return String(title || '?').split(/\s+/).filter(Boolean).slice(0, 2)
            .map((word) => word[0]).join('').toUpperCase();
    }

    /** A poster or backdrop, or the title's initials when there is none. */
    function picture(item, kind) {
        const box = document.createElement('span');
        box.className = `media-art media-art--${kind}`;
        const missing = () => {
            box.querySelector('img')?.remove();
            box.classList.add('is-missing');
            box.prepend(textBlock('span', 'media-art-initials', initials(item.title)));
        };
        const src = kind === 'backdrop' ? item.backdrop : item.poster;
        if (src) {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.addEventListener('error', missing, { once: true });
            img.src = src;
            box.appendChild(img);
        } else {
            missing();
        }
        if (item.played) box.appendChild(textBlock('span', 'media-badge media-badge--played', '✓'));
        if (Number(item.newCount) > 1) box.appendChild(textBlock('span', 'media-badge', `+${item.newCount}`));
        return box;
    }

    /** How far a download is: a bar, with the share for screen readers. */
    function progressBar(item) {
        const share = Math.min(1, Math.max(0, Number(item.progress) || 0));
        const bar = document.createElement('span');
        bar.className = 'media-progress';
        bar.style.setProperty('--p', String(share));
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuenow', String(Math.round(share * 100)));
        return bar;
    }

    function itemButton(dash, widget, item, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.dataset.mediaItem = String(item.id || '');
        button.dataset.title = titleText(item);
        const detail = widget?.config?.click === 'detail';
        const which = detail ? 'actionDetails' : 'actionOpen';
        const service = serviceOf(widget);
        const [labelKey, fallback] = service.words?.[which] || DEFAULT_WORDS[which];
        window.DashboardWidgetUtils?.bindRowAction(button, dash, {
            labelKey,
            labelFallback: fallback.replace('{name}', service.name),
            href: item.openUrl,
            run: () => (detail ? openDetail(dash, widget, item, button) : go(dash, widget, item.openUrl)),
        });
        return button;
    }

    function listRow(dash, widget, item, { extras = true } = {}) {
        const row = itemButton(dash, widget, item, 'media-row');
        const text = document.createElement('span');
        text.className = 'media-row-text';
        text.appendChild(textBlock('span', 'media-title', titleText(item)));
        if (extras) {
            text.append(
                textBlock('span', 'media-meta dashboard-widget-narrow-only', metaText(dash, widget, item)),
                wideOnly(textBlock('span', 'media-meta', metaText(dash, widget, item, { wide: true }))),
            );
            if (item.overview) text.appendChild(wideOnly(textBlock('span', 'media-overview', item.overview)));
        } else {
            text.appendChild(textBlock('span', 'media-meta', metaText(dash, widget, item)));
        }
        if (item.progress !== undefined && item.progress !== null) text.appendChild(progressBar(item));
        row.append(picture(item, 'poster'), text);
        return row;
    }

    /*
     * The newest `count` items, with every group given a place.
     *
     * Cutting the merged timeline at `count` let whichever library was added to
     * most recently fill every row: films newer than any episode meant a grid
     * of films, and the Series and Anime libraries never appeared. Each group
     * gets an equal share of the rows first, what is left goes to the newest of
     * the rest, and the result is put back in date order so it still reads as
     * a timeline.
     */
    function pickMixed(items, count) {
        const byGroup = new Map();
        items.forEach((item) => {
            if (!byGroup.has(item.libraryId)) byGroup.set(item.libraryId, []);
            byGroup.get(item.libraryId).push(item);
        });
        const quota = Math.max(1, Math.ceil(count / Math.max(1, byGroup.size)));
        const chosen = new Set();
        byGroup.forEach((list) => list.slice(0, quota).forEach((item) => chosen.add(item)));
        /*
         * Newest first for what has arrived; for what is still to come
         * (a calendar line carries `when`), soonest first and after the rest,
         * so a list reads "downloading now, then tomorrow, then next week".
         */
        const newest = (a, b) => {
            const aw = Number(a.when) || 0;
            const bw = Number(b.when) || 0;
            if (aw && bw) return aw - bw;
            if (aw || bw) return aw ? 1 : -1;
            return (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0);
        };
        const leftovers = items.filter((item) => !chosen.has(item)).sort(newest);
        const picked = [...chosen].sort(newest);
        // Over quota when the shares do not divide evenly: the oldest go.
        const kept = picked.slice(0, count);
        leftovers.slice(0, Math.max(0, count - kept.length)).forEach((item) => kept.push(item));
        return kept.sort(newest);
    }

    function drawList(wrap, dash, widget, items) {
        const list = document.createElement('div');
        list.className = 'media-list';
        pickMixed(items, rows(widget)).forEach((item) => list.appendChild(listRow(dash, widget, item)));
        wrap.appendChild(list);
    }

    /** What an empty tab says: its own words, a failure, or nothing new. */
    function emptyText(dash, widget, result, groupId) {
        if (result?.partial) return say(dash, widget, 'groupFailed');
        const own = serviceOf(widget).emptyGroup?.[groupId];
        if (own) {
            const value = dash?.language?.t?.(own[0]);
            const days = Number(widget?.config?.days) || 7;
            return (value && value !== own[0] ? value : own[1]).replace('{days}', String(days));
        }
        return say(dash, widget, 'nothing');
    }

    function drawStrip(wrap, dash, widget, items, result, activeId) {
        const groups = Array.isArray(result?.libraries) ? result.libraries : [];
        const current = groups.some((group) => group.id === activeId) ? activeId : groups[0]?.id;

        if (groups.length > 1) {
            const tabs = document.createElement('div');
            tabs.className = 'media-tabs';
            tabs.setAttribute('role', 'tablist');
            groups.forEach((group) => {
                const tab = textBlock('button', 'media-tab', group.name);
                tab.type = 'button';
                tab.setAttribute('role', 'tab');
                tab.setAttribute('aria-selected', String(group.id === current));
                tab.dataset.mediaTab = group.id;
                tab.addEventListener('click', () => {
                    wrap.querySelectorAll('.media-tabs, .media-strip, .media-strip-empty')
                        .forEach((el) => el.remove());
                    drawStrip(wrap, dash, widget, items, result, group.id);
                    // Keeps the reader where they were: a redraw would
                    // otherwise drop keyboard focus back to the page.
                    wrap.querySelector(`[data-media-tab="${CSS.escape(group.id)}"]`)?.focus({ preventScroll: true });
                });
                tabs.appendChild(tab);
            });
            wrap.prepend(tabs);
        }

        const shown = items.filter((item) => !current || item.libraryId === current)
            .slice(0, Math.min(rows(widget), WIDE_STRIP));
        if (!shown.length) {
            const empty = textBlock('p', 'dashboard-widget-empty media-strip-empty', emptyText(dash, widget, result, current));
            const tabs = wrap.querySelector('.media-tabs');
            if (tabs) tabs.after(empty); else wrap.prepend(empty);
            return;
        }
        const strip = document.createElement('div');
        strip.className = 'media-strip';
        shown.forEach((item, at) => {
            const cell = itemButton(dash, widget, item, 'media-poster');
            cell.append(
                picture(item, 'poster'),
                textBlock('span', 'media-caption', item.title),
                wideOnly(textBlock('span', 'media-meta',
                    [item.year, item.left || timeText(dash, widget, item)].filter(Boolean).join(' · '))),
            );
            if (item.progress !== undefined && item.progress !== null) cell.appendChild(progressBar(item));
            if (at >= NARROW_STRIP) wideOnly(cell);
            strip.appendChild(cell);
        });
        const tabs = wrap.querySelector('.media-tabs');
        if (tabs) tabs.after(strip); else wrap.prepend(strip);
    }

    function drawHero(wrap, dash, widget, items) {
        const [first, ...rest] = pickMixed(items, rows(widget));
        const layout = document.createElement('div');
        layout.className = 'media-hero-layout';

        const hero = itemButton(dash, widget, first, 'media-hero');
        const caption = document.createElement('span');
        caption.className = 'media-hero-caption';
        caption.append(
            textBlock('span', 'media-title', titleText(first)),
            textBlock('span', 'media-meta dashboard-widget-narrow-only', metaText(dash, widget, first)),
            wideOnly(textBlock('span', 'media-meta', [metaText(dash, widget, first, { wide: true }),
                first.runtimeMinutes ? `${first.runtimeMinutes} min` : ''].filter(Boolean).join(' · '))),
        );
        if (first.overview) caption.appendChild(wideOnly(textBlock('span', 'media-overview', first.overview)));
        hero.append(picture(first, first.backdrop ? 'backdrop' : 'poster'), caption);

        const list = document.createElement('div');
        list.className = 'media-list media-list--side';
        rest.forEach((item) => list.appendChild(listRow(dash, widget, item, { extras: false })));
        layout.append(hero, list);
        wrap.appendChild(layout);
    }

    function drawGrid(wrap, dash, widget, items) {
        const grid = document.createElement('div');
        grid.className = 'media-grid';
        pickMixed(items, rows(widget)).forEach((item) => {
            const cell = itemButton(dash, widget, item, 'media-poster');
            cell.append(
                picture(item, 'poster'),
                wideOnly(textBlock('span', 'media-caption', item.title)),
                wideOnly(textBlock('span', 'media-meta', item.library)),
            );
            if (item.progress !== undefined && item.progress !== null) cell.appendChild(progressBar(item));
            grid.appendChild(cell);
        });
        wrap.appendChild(grid);
    }

    const LAYOUTS = { list: drawList, strip: drawStrip, hero: drawHero, grid: drawGrid };

    /*
     * The detail card: the facts first, the service one button away.
     *
     * A native modal dialog, like the volume confirmation in Containers: Escape
     * and the focus trap come with it, and the scroll lock watcher already
     * treats an open dialog as a reason to hold the page. Focus goes back to
     * the item it was opened from, so the keyboard stays where it was.
     */
    function openDetail(dash, widget, item, returnTo) {
        const dialog = document.createElement('dialog');
        dialog.className = 'media-detail';
        dialog.setAttribute('aria-label', titleText(item));

        const facts = [
            item.year,
            item.runtimeMinutes ? `${item.runtimeMinutes} min` : '',
            (item.genres || []).join(', '),
            item.library,
            item.left || (Number(item.when) > 0 ? whenText(dash, widget, item.when) : ''),
        ].filter(Boolean).join(' · ');

        const actions = document.createElement('div');
        actions.className = 'media-detail-actions';
        const openButton = textBlock('button', 'config-btn', say(dash, widget, 'open'));
        openButton.type = 'button';
        openButton.dataset.mediaOpen = '';
        const closeButton = textBlock('button', 'config-btn config-btn--ghost', say(dash, widget, 'close'));
        closeButton.type = 'button';
        closeButton.dataset.mediaClose = '';
        actions.append(openButton, closeButton);

        dialog.append(
            picture(item, item.backdrop ? 'backdrop' : 'poster'),
            textBlock('h3', 'media-detail-title', titleText(item)),
            textBlock('p', 'media-meta', facts),
        );
        if (item.overview) dialog.appendChild(textBlock('p', 'media-detail-overview', item.overview));
        dialog.appendChild(actions);

        const shut = () => {
            if (dialog.open) dialog.close();
            dialog.remove();
            returnTo?.focus?.({ preventScroll: true });
        };
        openButton.addEventListener('click', () => {
            shut();
            go(dash, widget, item.openUrl);
        });
        closeButton.addEventListener('click', shut);
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            shut();
        });
        // A click on the backdrop, outside the card, closes it too.
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) shut();
        });

        document.body.appendChild(dialog);
        dialog.showModal();
        openButton.focus();
    }

    async function render(body, widget, dash, service) {
        const pageId = Number(dash?.currentPageId) || Number(dash?.pages?.[0]?.id) || 1;
        sayIn(body, 'dashboard-widget-waiting', say(dash, widget, 'waiting'));

        const result = await load(dash, widget, pageId, service);
        if (!result) {
            sayIn(body, 'dashboard-widget-empty', errorText(dash, widget, 'unreachable'));
            return;
        }
        const items = Array.isArray(result.items) ? result.items : [];
        if (result.error && !items.length) {
            sayIn(body, 'dashboard-widget-empty', errorText(dash, widget, result.error));
            return;
        }
        const layout = LAYOUTS[widget?.config?.layout] ? widget.config.layout : 'list';
        // The strip has a tab per group, and an empty tab says why itself.
        if (!items.length && layout !== 'strip') {
            const groups = Array.isArray(result.libraries) ? result.libraries : [];
            sayIn(body, 'dashboard-widget-empty',
                emptyText(dash, widget, result, groups.length === 1 ? groups[0].id : ''));
            return;
        }

        const utils = window.DashboardWidgetUtils;
        const wrap = utils?.panel ? utils.panel(body) : (body.replaceChildren(), body);
        wrap.classList.add('media-panel');
        LAYOUTS[layout](wrap, dash, widget, items, result);
        if (result.stale) {
            wrap.appendChild(textBlock('p', 'media-stale',
                `${errorText(dash, widget, result.error)} · ${agoText(dash, widget, result.fetchedAt)}`));
        }
    }

    window.DashboardMediaTile = {
        register,
        targetFor,
        openDetail: (...args) => openDetail(...args),
    };
})();
