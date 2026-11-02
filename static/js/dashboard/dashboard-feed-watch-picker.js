/**
 * The window that chooses which feeds of a bookmark to watch.
 *
 * Reached from the bookmark's right-click menu and the Watched feeds list,
 * so the choice looks the same wherever it is made. The server lists the feeds
 * the page advertises plus the ones already watched; one or several can be
 * ticked, or an address pasted.
 */
(function (global) {
    'use strict';

    function dash() { return global.dashboardInstance; }

    function t(key, fallback, vars) {
        let text = fallback;
        const lang = dash()?.language;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) text = value;
        }
        if (vars) {
            Object.keys(vars).forEach((name) => {
                text = text.replace(`{${name}}`, () => String(vars[name]));
            });
        }
        return text;
    }

    const esc = (value) => global.NextDashHtml.escapeHtml(String(value ?? ''));

    // The choices, in minutes, with how each reads in a sentence ("checked every
    // {words}") and as a menu entry.
    const INTERVALS = [
        { minutes: 30, words: ['dashboard.feedWatchEvery30Short', '30 minutes'], label: ['dashboard.feedWatchEvery30', 'Every 30 minutes'] },
        { minutes: 60, words: ['dashboard.feedWatchEveryHourShort', 'hour'], label: ['dashboard.feedWatchEveryHour', 'Every hour'] },
        { minutes: 120, words: ['dashboard.feedWatchEvery2Short', '2 hours'], label: ['dashboard.feedWatchEvery2', 'Every 2 hours'] },
        { minutes: 240, words: ['dashboard.feedWatchEvery4Short', '4 hours'], label: ['dashboard.feedWatchEvery4', 'Every 4 hours'] },
        { minutes: 360, words: ['dashboard.feedWatchEvery6Short', '6 hours'], label: ['dashboard.feedWatchEvery6', 'Every 6 hours'] },
        { minutes: 720, words: ['dashboard.feedWatchEvery12Short', '12 hours'], label: ['dashboard.feedWatchEvery12', 'Every 12 hours'] },
        { minutes: 1440, words: ['dashboard.feedWatchEveryDayShort', 'day'], label: ['dashboard.feedWatchEveryDay', 'Every day'] },
    ];

    function intervalWords(minutes) {
        const found = INTERVALS.find((i) => i.minutes === Number(minutes)) || INTERVALS[1];
        return t(found.words[0], found.words[1]);
    }

    function notify(message, type) {
        dash()?.showNotification?.(message, type || 'success', { duration: 4000 });
    }

    /** Switch the bookmark to Periodic checking, the way the right-click menu does. */
    async function enableChecking(bookmark) {
        const d = dash();
        const ref = d?.resolveBookmarkReference?.(bookmark);
        const pageId = Number(ref?.pageId || bookmark?.pageId || d?.currentPageId);
        let index = -1;
        if (Number.isFinite(pageId) && pageId > 0) {
            try {
                const res = await fetch(`/api/bookmarks?page=${pageId}`);
                if (res.ok) index = d.findBookmarkIndexByReference?.(await res.json(), ref || bookmark) ?? -1;
            } catch { /* leaves index at -1 */ }
        }
        const outcome = index >= 0 && global.CheckMode
            ? await global.CheckMode.apply({ pageId, index, url: bookmark.url, mode: 'periodic', name: bookmark.name || bookmark.url })
            : 'failed';
        if (outcome === 'failed') {
            notify(t('dashboard.healthCheckModeFailed', 'Could not change availability checking'), 'error');
            return;
        }
        global.CheckMode.assign(bookmark, 'periodic');
        global.CheckMode.syncLocalCopies({ pageId, url: bookmark.url, mode: 'periodic', bookmarkRef: ref });
        d.renderDashboard?.({ incremental: false });
        d.updateHealthBadge?.();
    }

    function candidateRow(feed, ticked) {
        return `<label class="feed-watch-candidate">`
            + `<input type="checkbox" data-feed-watch-tick value="${esc(feed.url)}"${ticked ? ' checked' : ''}>`
            + `<span class="feed-watch-candidate-text" title="${esc(feed.url)}">`
            + `<span class="feed-watch-candidate-name">${esc(feed.title || feed.url)}</span>`
            + (feed.title ? `<span class="feed-watch-candidate-url">${esc(feed.url)}</span>` : '')
            + `</span></label>`;
    }

    /**
     * @param {{bookmark: {name?: string, url?: string}}} options
     * @returns {Promise<'saved'|'removed'|'cancelled'>}
     */
    function open({ bookmark }) {
        const watch = dash()?.feedWatch;
        const url = String(bookmark?.url || '').trim();
        if (!watch || !url) return Promise.resolve('cancelled');

        return new Promise((resolve) => {
            let outcome = 'cancelled';
            let watched = (watch.watchFor(bookmark)?.feeds || []).length > 0;
            const current = watch.watchFor(bookmark)?.feeds?.[0]?.intervalMinutes || 60;
            const name = String(bookmark?.name || '').trim() || url;
            // Offered only while the bookmark is not checked at all: if it already
            // is, there is nothing to add.
            const offered = (window.CheckMode?.of?.(bookmark) || 'off') === 'off';

            global.AppModal.show({
                title: t('dashboard.feedWatchTitle', 'Watch feeds'),
                htmlMessage: `<div class="feed-watch-picker" data-feed-watch-picker>`
                    + `<div class="feed-watch-picker-name">${esc(name)}</div>`
                    + `<div class="feed-watch-list" data-feed-watch-list aria-live="polite">`
                    + `<p class="feed-watch-note">${esc(t('dashboard.feedWatchLoading', 'Looking for feeds…'))}</p></div>`
                    + `<div class="feed-watch-paste">`
                    + `<label for="feed-watch-url">${esc(t('dashboard.feedWatchAddress', 'Feed address'))}</label>`
                    + `<input type="url" id="feed-watch-url" data-feed-watch-url placeholder="https://example.com/feed.xml" autocomplete="off">`
                    + `</div>`
                    + `<div class="feed-watch-interval"><label for="feed-watch-interval">${esc(t('dashboard.feedWatchCheck', 'Check'))}</label>`
                    + `<select id="feed-watch-interval" data-feed-watch-interval>`
                    + INTERVALS.map((i) => `<option value="${i.minutes}"${current === i.minutes ? ' selected' : ''}>${esc(t(i.label[0], i.label[1]))}</option>`).join('')
                    + `</select></div>`
                    + (offered
                        ? `<label class="feed-watch-check"><input type="checkbox" data-feed-watch-check checked>`
                            + `<span>${esc(t('dashboard.feedWatchAlsoCheck', 'Also check that this page is reachable (Periodic)'))}`
                            + `<small>${esc(t('dashboard.feedWatchAlsoCheckHint', 'The site is asked anyway; this adds a daily availability check for the bookmark.'))}</small></span></label>`
                        : '')
                    + `<div class="feed-watch-foot">`
                    + `<button type="button" class="modal-button" data-feed-watch-save><span class="modal-button-name">${esc(t('dashboard.feedWatchSave', 'Save'))}</span></button>`
                    + `<button type="button" class="modal-button" data-feed-watch-cancel><span class="modal-button-name">${esc(t('dashboard.cancel', 'Cancel'))}</span></button>`
                    + (watched
                        ? `<button type="button" class="modal-button danger feed-watch-stop" data-feed-watch-stop><span class="modal-button-name">${esc(t('dashboard.feedWatchStop', 'Stop watching'))}</span></button>`
                        : '')
                    + `</div></div>`,
                showCancel: false,
                modalClass: 'feed-watch-modal',
                initialFocusSelector: '[data-feed-watch-save]',
                onHide: () => resolve(outcome),
            });
            addCloseButton();

            const root = document.querySelector('[data-feed-watch-picker]');
            if (!root) { resolve('cancelled'); return; }
            const list = root.querySelector('[data-feed-watch-list]');

            void watch.candidates(url).then((data) => {
                if (!document.body.contains(root)) return;
                const feeds = data?.feeds || [];
                list.innerHTML = feeds.length
                    ? feeds.map((feed) => candidateRow(feed, feed.watched === true)).join('')
                    : `<p class="feed-watch-note">${esc(t('dashboard.feedWatchNone', 'No feeds found on this page. Paste a feed address.'))}</p>`;
            });

            const close = () => global.AppModal.hide();
            root.querySelector('[data-feed-watch-cancel]')?.addEventListener('click', close);

            root.querySelector('[data-feed-watch-stop]')?.addEventListener('click', async () => {
                if (await watch.unwatch(url)) {
                    outcome = 'removed';
                    notify(t('dashboard.feedWatchStopped', 'Stopped watching {name}', { name }), 'success');
                    close();
                }
            });

            root.querySelector('[data-feed-watch-save]')?.addEventListener('click', async (event) => {
                const button = event.currentTarget;
                const minutes = Number(root.querySelector('[data-feed-watch-interval]')?.value) || 60;
                const urls = [...root.querySelectorAll('[data-feed-watch-tick]:checked')].map((box) => box.value);
                const pasted = String(root.querySelector('[data-feed-watch-url]')?.value || '').trim();
                if (pasted && !urls.includes(pasted)) urls.push(pasted);
                if (!urls.length && !watched) {
                    notify(t('dashboard.feedWatchPickOne', 'Tick a feed or paste an address'), 'info');
                    return;
                }
                button.disabled = true;
                const result = urls.length
                    ? await watch.save(url, urls.map((feedUrl) => ({ feedUrl, intervalMinutes: minutes })))
                    : { ok: await watch.unwatch(url), removed: true };
                button.disabled = false;
                if (!result.ok) {
                    if (result.error === 'not-a-feed') {
                        notify(t('dashboard.feedWatchNotAFeed', 'That address is not a feed nextDash can read'), 'error');
                    } else if (result.error === 'limit') {
                        notify(t('dashboard.feedWatchLimit', 'You are watching {limit} feeds, the most nextDash follows', { limit: watch.limit }), 'error');
                    } else {
                        notify(t('dashboard.feedWatchFailed', 'Could not save the watch'), 'error');
                    }
                    return;
                }
                if (urls.length && root.querySelector('[data-feed-watch-check]')?.checked) {
                    await enableChecking(bookmark);
                }
                watched = urls.length > 0;
                outcome = urls.length ? 'saved' : 'removed';
                notify(urls.length
                    ? t('dashboard.feedWatchStarted', 'Watching {name} · checked every {interval}. You\'ll see news when it publishes something new.', { name, interval: intervalWords(minutes) })
                    : t('dashboard.feedWatchStopped', 'Stopped watching {name}', { name }), 'success');
                close();
            });
        });
    }

    /**
     * A close button in the header of a Watch feeds window, for the mouse; the
     * shell's "ESC to close" line under the window is the keyboard's half.
     */
    function addCloseButton() {
        const header = document.querySelector('#app-modal .modal-header');
        if (!header || header.querySelector('[data-feed-watch-x]')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'feed-watch-x';
        button.setAttribute('data-feed-watch-x', '');
        button.setAttribute('aria-label', t('dashboard.close', 'Close'));
        button.textContent = '\u00d7';
        button.addEventListener('click', () => global.AppModal.hide());
        header.appendChild(button);
    }

    global.FeedWatchPicker = { open, intervalWords, intervals: INTERVALS, addCloseButton };
})(window);
