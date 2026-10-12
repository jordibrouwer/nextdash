/**
 * The Jellyfin widget: what was added to the media server lately, with posters.
 *
 * Four layouts over one answer. How wide the tile is comes from the panel's
 * container query, not from config.columns: the wide-only blocks are always
 * built and hidden when the tile is narrow, so a two-column widget on a
 * one-column dashboard (or a phone) reads as the one-column version.
 *
 * Items are buttons rather than anchors, as in the RSS tile: keyboard
 * navigation walks the buttons in a widget body, and bindRowAction's
 * data-widget-href gives back what an anchor was for.
 */
(function () {
    'use strict';

    const NARROW_STRIP = 4;
    const WIDE_STRIP = 8;

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    function textBlock(tag, className, text) {
        const el = document.createElement(tag);
        el.className = className;
        el.textContent = String(text ?? '');
        return el;
    }

    function say(body, className, text) {
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
    async function load(dash, widget, pageId) {
        dash._widgetJellyfin = dash._widgetJellyfin || {};
        const key = `${pageId}:${widget.id}`;
        const held = dash._widgetJellyfin[key];
        if (held && held.until > Date.now()) return held.result;
        try {
            const res = await fetch(`/api/widgets/jellyfin?pageId=${encodeURIComponent(pageId)}`
                + `&id=${encodeURIComponent(widget.id)}`);
            if (!res.ok) return null;
            const result = await res.json();
            // A half answer is looked at again soon, as the server does.
            const keep = result.partial ? Math.min(ttlMs(widget), 30_000) : ttlMs(widget);
            dash._widgetJellyfin[key] = { result, until: Date.now() + keep };
            return result;
        } catch (error) {
            return null;
        }
    }

    const ERRORS = {
        'not set up': ['dashboard.widgetJellyfinNotSetUp', 'Connect Jellyfin in this widget’s settings.'],
        'address not allowed': ['dashboard.widgetJellyfinNotAllowed',
            'Jellyfin is on your local network, and local addresses are not allowed yet. Allow them in Config first.'],
        'key refused': ['dashboard.widgetJellyfinRefused', 'Jellyfin refused the API key.'],
        'no libraries': ['dashboard.widgetJellyfinNoLibraries',
            'None of the chosen libraries exist any more. Choose again in the settings.'],
        unreachable: ['dashboard.widgetJellyfinUnreachable', 'Jellyfin could not be reached.'],
    };

    function errorText(dash, code) {
        const [key, fallback] = ERRORS[code] || ERRORS.unreachable;
        return label(dash, key, fallback);
    }

    function agoText(dash, at) {
        const ms = Date.now() - (Number(at) || 0);
        if (!Number(at) || ms < 60_000) return label(dash, 'dashboard.widgetJellyfinJustNow', 'just now');
        const minutes = Math.floor(ms / 60_000);
        if (minutes < 60) return label(dash, 'dashboard.widgetJellyfinMinutesAgo', '{n}m').replace('{n}', String(minutes));
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return label(dash, 'dashboard.widgetJellyfinHoursAgo', '{n}h').replace('{n}', String(hours));
        return label(dash, 'dashboard.widgetJellyfinDaysAgo', '{n}d').replace('{n}', String(Math.floor(hours / 24)));
    }

    function titleText(item) {
        return item.subtitle ? `${item.title} — ${item.subtitle}` : String(item.title || '');
    }

    function metaText(dash, item, { wide = false } = {}) {
        const parts = [item.library];
        if (wide && item.year) parts.push(String(item.year));
        if (wide && item.genres?.length) parts.push(item.genres.slice(0, 2).join(', '));
        parts.push(agoText(dash, item.addedAt));
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
        box.className = `jellyfin-art jellyfin-art--${kind}`;
        const missing = () => {
            box.querySelector('img')?.remove();
            box.classList.add('is-missing');
            box.prepend(textBlock('span', 'jellyfin-art-initials', initials(item.title)));
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
        if (item.played) box.appendChild(textBlock('span', 'jellyfin-badge jellyfin-badge--played', '✓'));
        if (Number(item.newCount) > 1) box.appendChild(textBlock('span', 'jellyfin-badge', `+${item.newCount}`));
        return box;
    }

    function itemButton(dash, widget, item, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.dataset.jellyfinItem = String(item.id || '');
        button.dataset.title = titleText(item);
        const detail = widget?.config?.click === 'detail';
        window.DashboardWidgetUtils?.bindRowAction(button, dash, {
            labelKey: detail ? 'widgetActionJellyfinDetails' : 'widgetActionJellyfinOpen',
            labelFallback: detail ? 'Show details' : 'Open in Jellyfin',
            href: item.openUrl,
            run: () => (detail ? openDetail(dash, widget, item, button) : go(dash, widget, item.openUrl)),
        });
        return button;
    }

    function listRow(dash, widget, item, { extras = true } = {}) {
        const row = itemButton(dash, widget, item, 'jellyfin-row');
        const text = document.createElement('span');
        text.className = 'jellyfin-row-text';
        text.appendChild(textBlock('span', 'jellyfin-title', titleText(item)));
        if (extras) {
            text.append(
                textBlock('span', 'jellyfin-meta dashboard-widget-narrow-only', metaText(dash, item)),
                wideOnly(textBlock('span', 'jellyfin-meta', metaText(dash, item, { wide: true }))),
            );
            if (item.overview) text.appendChild(wideOnly(textBlock('span', 'jellyfin-overview', item.overview)));
        } else {
            text.appendChild(textBlock('span', 'jellyfin-meta', metaText(dash, item)));
        }
        row.append(picture(item, 'poster'), text);
        return row;
    }

    /*
     * The newest `count` items, with every library given a place.
     *
     * Cutting the merged timeline at `count` let whichever library was added to
     * most recently fill every row: films newer than any episode meant a grid
     * of films, and the Series and Anime libraries never appeared. Each library
     * gets an equal share of the rows first, what is left goes to the newest of
     * the rest, and the result is put back in date order so it still reads as
     * a timeline.
     */
    function pickMixed(items, libraries, count) {
        const byLibrary = new Map();
        items.forEach((item) => {
            if (!byLibrary.has(item.libraryId)) byLibrary.set(item.libraryId, []);
            byLibrary.get(item.libraryId).push(item);
        });
        const quota = Math.max(1, Math.ceil(count / Math.max(1, byLibrary.size)));
        const chosen = new Set();
        byLibrary.forEach((list) => list.slice(0, quota).forEach((item) => chosen.add(item)));
        const newest = (a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0);
        const leftovers = items.filter((item) => !chosen.has(item)).sort(newest);
        const picked = [...chosen].sort(newest);
        // Over quota when the shares do not divide evenly: the oldest go.
        const kept = picked.slice(0, count);
        leftovers.slice(0, Math.max(0, count - kept.length)).forEach((item) => kept.push(item));
        return kept.sort(newest);
    }

    function drawList(wrap, dash, widget, items, result) {
        const list = document.createElement('div');
        list.className = 'jellyfin-list';
        pickMixed(items, result?.libraries, rows(widget))
            .forEach((item) => list.appendChild(listRow(dash, widget, item)));
        wrap.appendChild(list);
    }

    function drawStrip(wrap, dash, widget, items, result, activeId) {
        const libraries = Array.isArray(result?.libraries) ? result.libraries : [];
        const current = libraries.some((lib) => lib.id === activeId) ? activeId : libraries[0]?.id;

        if (libraries.length > 1) {
            const tabs = document.createElement('div');
            tabs.className = 'jellyfin-tabs';
            tabs.setAttribute('role', 'tablist');
            libraries.forEach((lib) => {
                const tab = textBlock('button', 'jellyfin-tab', lib.name);
                tab.type = 'button';
                tab.setAttribute('role', 'tab');
                tab.setAttribute('aria-selected', String(lib.id === current));
                tab.dataset.jellyfinTab = lib.id;
                tab.addEventListener('click', () => {
                    wrap.querySelectorAll('.jellyfin-tabs, .jellyfin-strip, .jellyfin-strip-empty')
                        .forEach((el) => el.remove());
                    drawStrip(wrap, dash, widget, items, result, lib.id);
                    // Keeps the reader where they were: a redraw would
                    // otherwise drop keyboard focus back to the page.
                    wrap.querySelector(`[data-jellyfin-tab="${CSS.escape(lib.id)}"]`)?.focus({ preventScroll: true });
                });
                tabs.appendChild(tab);
            });
            wrap.prepend(tabs);
        }

        const shown = items.filter((item) => !current || item.libraryId === current)
            .slice(0, Math.min(rows(widget), WIDE_STRIP));
        if (!shown.length) {
            // Nothing from a library the server could not read is not the
            // same as nothing new in it, and the tab should not claim it is.
            const words = result?.partial
                ? label(dash, 'dashboard.widgetJellyfinLibraryFailed',
                    'This library could not be read just now. It is tried again shortly.')
                : label(dash, 'dashboard.widgetJellyfinNothing', 'Nothing new in the chosen libraries.');
            wrap.querySelector('.jellyfin-tabs')?.after(textBlock('p', 'dashboard-widget-empty jellyfin-strip-empty', words));
            return;
        }
        const strip = document.createElement('div');
        strip.className = 'jellyfin-strip';
        shown.forEach((item, at) => {
            const cell = itemButton(dash, widget, item, 'jellyfin-poster');
            cell.append(
                picture(item, 'poster'),
                textBlock('span', 'jellyfin-caption', item.title),
                wideOnly(textBlock('span', 'jellyfin-meta',
                    [item.year, agoText(dash, item.addedAt)].filter(Boolean).join(' · '))),
            );
            if (at >= NARROW_STRIP) wideOnly(cell);
            strip.appendChild(cell);
        });
        const tabs = wrap.querySelector('.jellyfin-tabs');
        if (tabs) tabs.after(strip); else wrap.prepend(strip);
    }

    function drawHero(wrap, dash, widget, items, result) {
        const [first, ...rest] = pickMixed(items, result?.libraries, rows(widget));
        const layout = document.createElement('div');
        layout.className = 'jellyfin-hero-layout';

        const hero = itemButton(dash, widget, first, 'jellyfin-hero');
        const caption = document.createElement('span');
        caption.className = 'jellyfin-hero-caption';
        caption.append(
            textBlock('span', 'jellyfin-title', titleText(first)),
            textBlock('span', 'jellyfin-meta dashboard-widget-narrow-only', metaText(dash, first)),
            wideOnly(textBlock('span', 'jellyfin-meta', [metaText(dash, first, { wide: true }),
                first.runtimeMinutes ? `${first.runtimeMinutes} min` : ''].filter(Boolean).join(' · '))),
        );
        if (first.overview) caption.appendChild(wideOnly(textBlock('span', 'jellyfin-overview', first.overview)));
        hero.append(picture(first, first.backdrop ? 'backdrop' : 'poster'), caption);

        const list = document.createElement('div');
        list.className = 'jellyfin-list jellyfin-list--side';
        rest.forEach((item) => list.appendChild(listRow(dash, widget, item, { extras: false })));
        layout.append(hero, list);
        wrap.appendChild(layout);
    }

    function drawGrid(wrap, dash, widget, items, result) {
        const grid = document.createElement('div');
        grid.className = 'jellyfin-grid';
        pickMixed(items, result?.libraries, rows(widget)).forEach((item) => {
            const cell = itemButton(dash, widget, item, 'jellyfin-poster');
            cell.append(
                picture(item, 'poster'),
                wideOnly(textBlock('span', 'jellyfin-caption', item.title)),
                wideOnly(textBlock('span', 'jellyfin-meta', item.library)),
            );
            grid.appendChild(cell);
        });
        wrap.appendChild(grid);
    }

    const LAYOUTS = { list: drawList, strip: drawStrip, hero: drawHero, grid: drawGrid };

    /*
     * The detail card: the facts first, Jellyfin one button away.
     *
     * A native modal dialog, like the volume confirmation in Containers: Escape
     * and the focus trap come with it, and the scroll lock watcher already
     * treats an open dialog as a reason to hold the page. Focus goes back to
     * the item it was opened from, so the keyboard stays where it was.
     */
    function openDetail(dash, widget, item, returnTo) {
        const dialog = document.createElement('dialog');
        dialog.className = 'jellyfin-detail';
        dialog.setAttribute('aria-label', titleText(item));

        const facts = [
            item.year,
            item.runtimeMinutes ? `${item.runtimeMinutes} min` : '',
            (item.genres || []).join(', '),
            item.library,
        ].filter(Boolean).join(' · ');

        const actions = document.createElement('div');
        actions.className = 'jellyfin-detail-actions';
        const openButton = textBlock('button', 'config-btn',
            label(dash, 'dashboard.widgetJellyfinOpen', 'Open in Jellyfin'));
        openButton.type = 'button';
        openButton.dataset.jellyfinOpen = '';
        const closeButton = textBlock('button', 'config-btn config-btn--ghost',
            label(dash, 'dashboard.widgetJellyfinClose', 'Close'));
        closeButton.type = 'button';
        closeButton.dataset.jellyfinClose = '';
        actions.append(openButton, closeButton);

        dialog.append(
            picture(item, item.backdrop ? 'backdrop' : 'poster'),
            textBlock('h3', 'jellyfin-detail-title', titleText(item)),
            textBlock('p', 'jellyfin-meta', facts),
        );
        if (item.overview) dialog.appendChild(textBlock('p', 'jellyfin-detail-overview', item.overview));
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

    async function render(body, widget, dash) {
        const pageId = Number(dash?.currentPageId) || Number(dash?.pages?.[0]?.id) || 1;
        say(body, 'dashboard-widget-waiting', label(dash, 'dashboard.widgetJellyfinWaiting', 'Loading…'));

        const result = await load(dash, widget, pageId);
        if (!result) {
            say(body, 'dashboard-widget-empty', errorText(dash, 'unreachable'));
            return;
        }
        const items = Array.isArray(result.items) ? result.items : [];
        if (result.error && !items.length) {
            say(body, 'dashboard-widget-empty', errorText(dash, result.error));
            return;
        }
        if (!items.length) {
            say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetJellyfinNothing', 'Nothing new in the chosen libraries.'));
            return;
        }

        const utils = window.DashboardWidgetUtils;
        const wrap = utils?.panel ? utils.panel(body) : (body.replaceChildren(), body);
        wrap.classList.add('jellyfin-panel');
        const layout = LAYOUTS[widget?.config?.layout] ? widget.config.layout : 'list';
        LAYOUTS[layout](wrap, dash, widget, items, result);
        if (result.stale) {
            wrap.appendChild(textBlock('p', 'jellyfin-stale',
                `${errorText(dash, result.error)} · ${agoText(dash, result.fetchedAt)}`));
        }
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.jellyfin = render;
    window.DashboardJellyfin = { targetFor, openDetail: (...args) => openDetail(...args) };
})();
