/**
 * Config → Watch feeds: every feed followed from a bookmark, in one list.
 *
 * One row per feed: the site and the feed, how it is doing, when it was last
 * asked, how often, and whether it is muted. A row opens a detail with the
 * rest of a feed's settings (word filters, pause, retry, stop) and its
 * address. Rows can be ticked and changed together.
 *
 * Moved out of dashboard-config.js. Loaded with the page rather than with the
 * config module, so it cannot hang methods on DashboardConfig's prototype the
 * way the lazy section files do: config calls in here with itself as `this`.
 * What the reader has open, ticked or under the cursor is kept on config
 * (`_fw`), because the list is painted again whenever the watch store changes.
 */
(function (global) {
    'use strict';

    // The server's caps for a word filter (feed_watch_handlers.go).
    const MAX_WORDS = 10;
    const MAX_WORD_LENGTH = 40;
    const MOVED_SHOWN_MS = 7 * 24 * 3600 * 1000;

    /** A row is one feed of one bookmark; its id carries both. */
    const rowId = (key, feedUrl) => `${encodeURIComponent(key)}|${encodeURIComponent(feedUrl)}`;

    function stateOf(config) {
        if (!config._fw) config._fw = { open: '', cursor: '', ticked: new Set() };
        return config._fw;
    }

    /**
     * The "Watched feeds" panel: what is followed, how often, when it was last
     * asked and how it is doing, with everything that can be changed about it.
     */
    function bindFeedWatchList(container) {
        const host = container.querySelector('[data-feed-watch-overview]');
        const watch = this.dash.feedWatch;
        if (!host || !watch) return;
        const state = stateOf(this);
        const t = (key, fallback) => this.t(key, fallback);
        const esc = (v) => this.dash.escapeHtml(String(v ?? ''));
        const picker = () => window.FeedWatchPicker;
        const intervals = () => window.FeedWatchPicker?.intervals || [];
        const ago = (ms) => {
            const m = Math.max(0, Math.round((Date.now() - Number(ms)) / 60000));
            if (!ms) return t('config.feedWatchNeverChecked', 'not checked yet');
            if (m < 1) return t('dashboard.previewAgoNow', 'just now');
            if (m < 60) return t('dashboard.previewAgoMinutes', '{count} min ago').replace('{count}', String(m));
            const h = Math.round(m / 60);
            if (h < 24) return t('dashboard.previewAgoHours', '{count} h ago').replace('{count}', String(h));
            return t('dashboard.previewAgoDays', '{count} d ago').replace('{count}', String(Math.round(h / 24)));
        };
        const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || ''); } };
        const reasonOf = (feed) => {
            const code = String(feed.lastError || '');
            if (!code) return '';
            const status = Number(feed.lastStatus) || 0;
            if (code === 'http-404') return t('config.feedWatchErr404', 'Not found (404)');
            if (code === 'http-410') return t('config.feedWatchErr410', 'Gone (410)');
            if (code === 'timeout') return t('config.feedWatchErrTimeout', 'Timed out');
            if (code === 'unreachable') return t('config.feedWatchErrUnreachable', 'Could not connect');
            if (code === 'not-a-feed') return t('config.feedWatchErrNotFeed', 'No longer a feed');
            if (code === 'refused') return t('config.feedWatchErrRefused', 'Address not allowed');
            if (code.startsWith('http-')) return t('config.feedWatchErrHttp', 'Server error ({status})').replace('{status}', String(status || code.slice(5)));
            return '';
        };
        const movedNote = (feed) => {
            const at = Number(feed.movedAt) || 0;
            if (!feed.movedFrom || !at || Date.now() - at > MOVED_SHOWN_MS) return '';
            return t('config.feedWatchMoved', 'Moved from {host}').replace('{host}', hostOf(feed.movedFrom));
        };
        const words = (list) => (Array.isArray(list) ? list.filter(Boolean) : []);
        const filterSummary = (feed) => {
            const parts = [];
            if (words(feed.include).length) parts.push(t('config.feedWatchOnlySummary', 'Only: {words}').replace('{words}', words(feed.include).join(', ')));
            if (words(feed.exclude).length) parts.push(t('config.feedWatchNotSummary', 'Not: {words}').replace('{words}', words(feed.exclude).join(', ')));
            return parts.join(' · ');
        };

        /*
         * The state chip, most pressing first. A feed that failed until the
         * server stopped asking is "paused" in the server's old word (retired);
         * a feed the reader paused is the other kind, and says only that.
         */
        const chipOf = (entry, feed) => {
            const count = Number(entry.newCount) || 0;
            const reason = reasonOf(feed);
            const withReason = (text) => (reason ? `${text} · ${reason}` : text);
            if (feed.retired === true) return ['is-bad', 'failing', withReason(t('config.feedWatchPaused', 'Paused after repeated failures'))];
            if (feed.paused === true) return ['is-off', 'paused', t('config.feedWatchPausedByYou', 'Paused')];
            if (Number(feed.failures) > 0) return ['is-warn', 'failing', withReason(t('config.feedWatchFailing', 'Last check failed'))];
            if (count > 0) return ['is-news', 'news', t('config.feedWatchNewState', '{n} new').replace('{n}', String(count))];
            if (feed.muted === true) return ['is-off', 'muted', t('config.feedWatchMutedState', 'Muted')];
            if (movedNote(feed)) return ['is-ok', 'moved', t('config.feedWatchMovedState', 'Moved')];
            return ['is-ok', 'quiet', t('config.feedWatchQuiet', 'Nothing new')];
        };

        /** Every watched feed whose bookmark is still here, in a steady order. */
        const collect = () => {
            const rows = [];
            const bookmarks = this.dash.allBookmarks || [];
            watch.byKey.forEach((entry, key) => {
                const bookmark = bookmarks.find((b) => watch.key(b.url) === key);
                if (!bookmark) return;
                (entry.feeds || []).forEach((feed) => {
                    rows.push({ id: rowId(key, feed.feedUrl), key, entry, feed, bookmark });
                });
            });
            const name = (r) => String(r.bookmark.name || r.bookmark.url).toLowerCase();
            rows.sort((a, b) => name(a).localeCompare(name(b)) || String(a.feed.title || '').localeCompare(String(b.feed.title || '')));
            return rows;
        };
        const rowById = (id) => collect().find((r) => r.id === id) || null;

        const intervalSelect = (attr, minutes, label) => `<select class="fwm-select" ${attr} aria-label="${esc(label)}">`
            + intervals().map((i) => `<option value="${i.minutes}"${Number(minutes) === i.minutes ? ' selected' : ''}>${esc(t(i.label[0], i.label[1]))}</option>`).join('')
            + '</select>';

        const muteButton = (attr, muted) => `<button type="button" class="config-btn config-btn--small fwm-mute" ${attr} aria-pressed="${muted ? 'true' : 'false'}">`
            + `${esc(muted ? t('config.feedWatchMuted', 'Muted') : t('config.feedWatchMute', 'Mute'))}</button>`;

        const wordEditor = (kind, list, label, hint) => `
            <div class="fwm-words" data-fwd-words="${kind}">
                <span class="fwm-label" id="fwm-words-${kind}">${esc(label)}</span>
                <div class="fwm-chips">
                    ${words(list).map((w) => `<span class="fwm-chip">${esc(w)}<button type="button" class="fwm-chip-x" data-fwd-word-remove="${esc(w)}" aria-label="${esc(t('config.feedWatchWordRemove', 'Remove {word}').replace('{word}', w))}">×</button></span>`).join('')}
                    <input type="text" class="fwm-word-input" data-fwd-word-input="${kind}" maxlength="${MAX_WORD_LENGTH}"
                           aria-labelledby="fwm-words-${kind}" placeholder="${esc(t('config.feedWatchWordPlaceholder', 'Add a word, then Enter'))}"
                           ${words(list).length >= MAX_WORDS ? 'disabled' : ''} autocomplete="off">
                </div>
                <span class="fwm-hint">${esc(hint)}</span>
            </div>`;

        const detailHtml = (r) => {
            const { feed, bookmark } = r;
            const reason = reasonOf(feed);
            const moved = movedNote(feed);
            const canRetry = feed.retired === true || Number(feed.failures) > 0;
            return `<li class="fwm-detail" data-fwm-detail="${esc(r.id)}" role="group" aria-label="${esc(t('config.feedWatchDetailAria', 'Settings for {name}').replace('{name}', feed.title || bookmark.name || ''))}">
                <div class="fwm-detail-grid">
                    <div class="fwm-field">
                        <span class="fwm-label">${esc(t('config.feedWatchFeedAddress', 'Feed address'))}</span>
                        <a class="fwm-url" href="${esc(feed.feedUrl)}" target="_blank" rel="noopener noreferrer">${esc(feed.feedUrl)}</a>
                        ${moved ? `<span class="fwm-hint">${esc(moved)}</span>` : ''}
                        ${reason ? `<span class="fwm-hint fwm-reason">${esc(t('config.feedWatchLastError', 'Last error: {reason}').replace('{reason}', reason))}</span>` : ''}
                    </div>
                    <div class="fwm-field">
                        <span class="fwm-label">${esc(t('config.feedWatchCheckEvery', 'Check'))}</span>
                        ${intervalSelect(`data-fwd-interval`, feed.intervalMinutes, t('config.feedWatchCheckEvery', 'Check'))}
                    </div>
                    <div class="fwm-field">
                        <span class="fwm-label">${esc(t('config.feedWatchMuteLabel', 'Toast and push'))}</span>
                        ${muteButton('data-fwd-mute', feed.muted === true)}
                        <span class="fwm-hint">${esc(t('config.feedWatchMuteHint', 'A muted feed still counts and shows in the paper, but never calls out.'))}</span>
                    </div>
                    ${wordEditor('include', feed.include, t('config.feedWatchInclude', 'Only items with'),
                        t('config.feedWatchIncludeHint', 'At least one of these words in the title or summary. Empty: every item.'))}
                    ${wordEditor('exclude', feed.exclude, t('config.feedWatchExclude', 'Never items with'),
                        t('config.feedWatchExcludeHint', 'An item with any of these words is skipped.'))}
                </div>
                <div class="fwm-detail-actions">
                    <button type="button" class="config-btn config-btn--small" data-fwd-pause aria-pressed="${feed.paused === true ? 'true' : 'false'}">${esc(feed.paused === true ? t('config.feedWatchResume', 'Resume') : t('config.feedWatchPause', 'Pause'))}</button>
                    ${canRetry ? `<button type="button" class="config-btn config-btn--small" data-fwl-retry="${esc(bookmark.url)}" data-fwl-feed="${esc(feed.feedUrl)}">${esc(t('config.feedWatchRetry', 'Retry'))}</button>` : ''}
                    <button type="button" class="config-btn config-btn--small" data-fwl-edit="${esc(bookmark.url)}">${esc(t('config.feedWatchChooseFeeds', 'Choose feeds…'))}</button>
                    <button type="button" class="config-btn config-btn--small config-btn--danger" data-fwl-stop="${esc(bookmark.url)}">${esc(t('config.feedWatchStopWatching', 'Stop watching'))}</button>
                </div>
            </li>`;
        };

        const rowHtml = (r) => {
            const { feed, bookmark, entry } = r;
            const [tone, kind, text] = chipOf(entry, feed);
            const open = state.open === r.id;
            const ticked = state.ticked.has(r.id);
            const cursor = state.cursor === r.id;
            const moved = movedNote(feed);
            const filters = filterSummary(feed);
            const name = bookmark.name || bookmark.url;
            const retired = feed.retired === true;
            return `<li class="feed-watch-list-row${cursor ? ' keyboard-selected' : ''}${open ? ' is-open' : ''}" data-key="${esc(r.key)}" data-fw-row="${esc(r.id)}" data-fw-state="${kind}" tabindex="-1">
                <label class="fwm-tick"><input type="checkbox" data-fwm-tick${ticked ? ' checked' : ''} aria-label="${esc(t('config.feedWatchSelect', 'Select {name}').replace('{name}', `${name} · ${feed.title || hostOf(feed.feedUrl)}`))}"></label>
                <button type="button" class="feed-watch-list-main" data-fwm-toggle aria-expanded="${open ? 'true' : 'false'}">
                    <strong>${esc(name)}</strong>
                    <span class="feed-watch-list-feed" title="${esc(feed.feedUrl)}">${esc(feed.title || hostOf(feed.feedUrl))} · ${esc(hostOf(feed.feedUrl))}${moved ? ` · ${esc(moved)}` : ''}</span>
                    ${filters ? `<span class="feed-watch-list-filter">${esc(filters)}</span>` : ''}
                </button>
                <span class="feed-watch-list-state ${tone}">${esc(text)}</span>
                <span class="feed-watch-list-meta">${esc(ago(feed.checkedAt))}</span>
                <span class="feed-watch-list-actions">
                    ${retired ? `<button type="button" class="config-btn config-btn--small" data-fwl-retry="${esc(bookmark.url)}" data-fwl-feed="${esc(feed.feedUrl)}">${esc(t('config.feedWatchRetry', 'Retry'))}</button>` : ''}
                    ${intervalSelect('data-fwm-interval', feed.intervalMinutes, t('config.feedWatchCheckEvery', 'Check'))}
                    ${muteButton('data-fwm-mute', feed.muted === true)}
                </span>
            </li>${open ? detailHtml(r) : ''}`;
        };

        const bulkHtml = (n) => `
            <div class="fwm-bulk" role="toolbar" aria-label="${esc(t('config.feedWatchBulkAria', 'Change the selected feeds'))}">
                <span class="fwm-bulk-count">${esc(t('config.feedWatchSelected', '{n} selected').replace('{n}', String(n)))}</span>
                <select class="fwm-select" data-fwm-bulk-interval aria-label="${esc(t('config.feedWatchBulkInterval', 'Set how often'))}">
                    <option value="">${esc(t('config.feedWatchBulkInterval', 'Set how often'))}…</option>
                    ${intervals().map((i) => `<option value="${i.minutes}">${esc(t(i.label[0], i.label[1]))}</option>`).join('')}
                </select>
                <button type="button" class="config-btn config-btn--small" data-fwm-bulk="mute">${esc(t('config.feedWatchMute', 'Mute'))}</button>
                <button type="button" class="config-btn config-btn--small" data-fwm-bulk="unmute">${esc(t('config.feedWatchUnmute', 'Unmute'))}</button>
                <button type="button" class="config-btn config-btn--small" data-fwm-bulk="pause">${esc(t('config.feedWatchPause', 'Pause'))}</button>
                <button type="button" class="config-btn config-btn--small" data-fwm-bulk="resume">${esc(t('config.feedWatchResume', 'Resume'))}</button>
                <button type="button" class="config-btn config-btn--small config-btn--danger" data-fwm-bulk="stop">${esc(t('config.feedWatchStopWatching', 'Stop watching'))}</button>
                <button type="button" class="config-btn config-btn--small" data-fwm-bulk="clear">${esc(t('config.feedWatchClearSelection', 'Clear'))}</button>
            </div>`;

        const legendHtml = () => `<p class="config-list-keyboard-legend" aria-hidden="true">${this.renderKeyboardLegendPairs([
            ['j / k', t('config.listKeyMove', 'move')],
            ['Enter', t('config.feedWatchKeyDetails', 'details')],
            ['m', t('config.feedWatchKeyMute', 'mute')],
            ['p', t('config.feedWatchKeyPause', 'pause')],
            ['Delete', t('config.feedWatchKeyStop', 'stop watching')],
        ])}</p>`;

        /*
         * What had focus, said in a way that survives the repaint: the row and
         * the control in it. A repaint follows every change the reader makes,
         * so without this the next key went to <body>.
         */
        const captureFocus = () => {
            const el = document.activeElement;
            const live = document.querySelector('[data-feed-watch-overview]');
            if (!el || !live?.contains(el)) return null;
            const holder = el.closest('[data-fw-row], [data-fwm-detail]');
            const id = holder?.getAttribute('data-fw-row') || holder?.getAttribute('data-fwm-detail') || '';
            const attr = [...el.attributes].map((a) => a.name).find((n) => n.startsWith('data-fw')) || '';
            return { id, attr, value: attr ? el.getAttribute(attr) : '', text: el.tagName === 'INPUT' && el.type === 'text' ? el.value : null };
        };
        const restoreFocus = (saved) => {
            const live = document.querySelector('[data-feed-watch-overview]');
            if (!saved || !live) return;
            const scope = saved.id
                ? live.querySelector(`[data-fw-row="${CSS.escape(saved.id)}"]`)?.parentElement || live
                : live;
            let el = null;
            if (saved.attr) {
                const sel = saved.value ? `[${saved.attr}="${CSS.escape(saved.value)}"]` : `[${saved.attr}]`;
                const inRow = saved.id
                    ? [...live.querySelectorAll(`[data-fw-row="${CSS.escape(saved.id)}"] ${sel}, [data-fwm-detail="${CSS.escape(saved.id)}"] ${sel}`)]
                    : [...scope.querySelectorAll(sel)];
                el = inRow[0] || null;
            }
            if (!el && saved.id) el = live.querySelector(`[data-fw-row="${CSS.escape(saved.id)}"]`);
            if (!el) return;
            el.focus({ preventScroll: true });
            if (saved.text != null && el.tagName === 'INPUT') el.value = saved.text;
        };

        /* Nothing watched yet: what this is, in three steps, and where to start. */
        const emptyHtml = () => `<div class="feed-watch-empty">
                <p class="feed-watch-empty-lead">${esc(t('config.feedWatchEmptyLead', 'You are not watching any feed yet. Watch a site and its new posts show up as a badge on the bookmark and together in News.'))}</p>
                <ol class="feed-watch-empty-steps">
                    <li>${esc(t('config.feedWatchEmptyStep1', 'Pick a bookmark of a site that publishes posts: a blog, a news site, release notes.'))}</li>
                    <li>${esc(t('config.feedWatchEmptyStep2', 'nextDash finds its feed and you choose how often to look.'))}</li>
                    <li>${esc(t('config.feedWatchEmptyStep3', 'New posts are announced once; read them on the dashboard or in News.'))}</li>
                </ol>
                <p class="feed-watch-note">${esc(t('config.feedWatchEmptyHint', 'Good first picks: a blog you read, a project’s releases, a changelog. You can also right-click any bookmark and choose Watch this feed…'))}</p>
                <div class="feed-watch-empty-actions">
                    <button type="button" class="config-btn config-btn--primary" data-fwm-more>${esc(t('config.feedWatchEmptyStart', 'Choose a bookmark to watch…'))}</button>
                </div>
            </div>`;

        const paint = () => {
            const live = document.querySelector('[data-feed-watch-overview]');
            if (!live) return;
            const saved = captureFocus();
            const rows = collect();
            // Ticks and the open row only for feeds that are still watched.
            const ids = new Set(rows.map((r) => r.id));
            state.ticked.forEach((id) => { if (!ids.has(id)) state.ticked.delete(id); });
            if (state.open && !ids.has(state.open)) state.open = '';
            if (state.cursor && !ids.has(state.cursor)) state.cursor = '';
            let news = 0;
            let newest = 0;
            watch.byKey.forEach((entry) => { if (Number(entry.newCount) > 0) news += 1; });
            rows.forEach((r) => { newest = Math.max(newest, Number(r.feed.checkedAt) || 0); });
            const summary = `<p class="feed-watch-list-summary" aria-live="polite">${esc(t('config.feedWatchSummary', '{n} of {limit} watched · {news} with news · last check {ago}')
                .replace('{n}', String(watch.total)).replace('{limit}', String(watch.limit)).replace('{news}', String(news))
                .replace('{ago}', newest ? ago(newest) : t('config.feedWatchNever', 'never')))}${state.checking ? ` · ${esc(t('config.feedsFindingNow', 'Looking…'))}` : ''}</p>`;
            const allTicked = rows.length > 0 && rows.every((r) => state.ticked.has(r.id));
            const toolbar = `<div class="fwm-toolbar">
                    ${rows.length ? `<label class="fwm-tick fwm-tick-all"><input type="checkbox" data-fwm-tick-all${allTicked ? ' checked' : ''} aria-label="${esc(t('config.feedWatchSelectAll', 'Select all'))}"></label>` : ''}
                    <button type="button" class="config-btn" data-fwm-paper${rows.length ? '' : ' disabled'}>${esc(t('config.feedWatchOpenPaper', 'Open the paper'))}</button>
                    <button type="button" class="config-btn" data-fwm-check${rows.length && !state.checking ? '' : ' disabled'}>${esc(t('config.feedWatchCheckAll', 'Check all now'))}</button>
                    <button type="button" class="config-btn" data-fwm-more>${esc(t('config.feedWatchMore', 'Watch more…'))}</button>
                </div>`;
            const ticked = rows.filter((r) => state.ticked.has(r.id)).length;
            live.innerHTML = rows.length
                ? summary + toolbar + (ticked ? bulkHtml(ticked) : '')
                    + `<ul class="fwm-list" role="list">${rows.map(rowHtml).join('')}</ul>` + legendHtml()
                : emptyHtml();
            restoreFocus(saved);
        };

        const notify = (message, type = 'success') => this.dash.showNotification?.(message, type, { duration: 3000 });
        const failed = (result) => {
            const text = result?.error === 'bad-filter'
                ? t('config.feedWatchBadFilter', 'Up to {max} words of at most {len} letters each').replace('{max}', String(MAX_WORDS)).replace('{len}', String(MAX_WORD_LENGTH))
                : t('dashboard.feedWatchFailed', 'Could not save the watch');
            notify(text, 'error');
        };
        const update = async (r, fields) => {
            const result = await watch.updateFeed(r.bookmark.url, r.feed.feedUrl, fields);
            if (!result.ok) failed(result);
            paint();
            return result.ok;
        };

        /*
         * Stop watching some feeds. A bookmark that keeps other feeds is saved
         * with those (the server keeps their settings); one that keeps none is
         * unwatched outright.
         */
        const stop = async (targets) => {
            if (!targets.length) return false;
            const label = targets.length === 1
                ? (targets[0].feed.title || targets[0].bookmark.name || targets[0].feed.feedUrl)
                : t('config.feedWatchNFeeds', '{n} feeds').replace('{n}', String(targets.length));
            const ok = await this.confirmAction(
                t('config.feedWatchStopConfirm', 'Stop watching {name}? Its filters and the news kept for it go too.').replace('{name}', label),
                { title: t('config.feedWatchStopWatching', 'Stop watching'), confirmLabel: t('config.feedWatchStopButton', 'Stop') },
            );
            if (!ok) return false;
            const byBookmark = new Map();
            targets.forEach((r) => {
                if (!byBookmark.has(r.key)) byBookmark.set(r.key, { bookmark: r.bookmark, entry: r.entry, gone: new Set() });
                byBookmark.get(r.key).gone.add(r.feed.feedUrl);
            });
            for (const { bookmark, entry, gone } of byBookmark.values()) {
                const rest = (entry.feeds || []).filter((f) => !gone.has(f.feedUrl));
                if (rest.length) await watch.save(bookmark.url, rest.map((f) => ({ feedUrl: f.feedUrl, intervalMinutes: f.intervalMinutes })));
                else await watch.unwatch(bookmark.url);
            }
            targets.forEach((r) => state.ticked.delete(r.id));
            notify(t('dashboard.feedWatchStopped', 'Stopped watching {name}').replace('{name}', label));
            paint();
            return true;
        };

        const ticked = () => collect().filter((r) => state.ticked.has(r.id));

        const bulk = async (action) => {
            const targets = ticked();
            if (action === 'clear') { state.ticked.clear(); paint(); return; }
            if (!targets.length) return;
            if (action === 'stop') { await stop(targets); return; }
            const fields = { mute: { muted: true }, unmute: { muted: false }, pause: { paused: true }, resume: { paused: false } }[action];
            if (!fields) return;
            for (const r of targets) {
                const result = await watch.updateFeed(r.bookmark.url, r.feed.feedUrl, fields);
                if (!result.ok) { failed(result); break; }
            }
            paint();
        };

        /*
         * One interval for the ticked feeds. When the ticks cover every feed of
         * their bookmarks (the usual case: one feed each) that is one request;
         * otherwise feed by feed, so an unticked sibling keeps its own.
         */
        const bulkInterval = async (minutes) => {
            const targets = ticked();
            if (!targets.length || !minutes) return;
            const whole = targets.every((r) => (r.entry.feeds || []).every((f) => state.ticked.has(rowId(r.key, f.feedUrl))));
            if (whole) {
                const urls = [...new Map(targets.map((r) => [r.key, r.bookmark.url])).values()];
                const result = await watch.setIntervalFor(urls, minutes);
                if (!result.ok) failed(result);
            } else {
                for (const r of targets) {
                    const result = await watch.updateFeed(r.bookmark.url, r.feed.feedUrl, { intervalMinutes: minutes });
                    if (!result.ok) { failed(result); break; }
                }
            }
            paint();
        };

        const addWord = async (r, kind, input) => {
            const word = String(input.value || '').trim().replace(/,+$/, '').trim();
            if (!word) return;
            const list = words(r.feed[kind]);
            if (list.some((w) => w.toLowerCase() === word.toLowerCase())) { input.value = ''; return; }
            if (list.length >= MAX_WORDS || word.length > MAX_WORD_LENGTH) { failed({ error: 'bad-filter' }); return; }
            input.value = '';
            await update(r, { [kind]: [...list, word] });
        };

        /**
         * What a quick look at each site found, kept on this device for a week:
         * how many feeds the page advertises. The chooser fills it in as it goes.
         */
        const SCAN_KEY = 'nextdash.feedScan';
        const SCAN_TTL = 7 * 24 * 3600 * 1000;
        const readScan = () => {
            try {
                const raw = JSON.parse(localStorage.getItem(SCAN_KEY) || '{}');
                const fresh = {};
                Object.keys(raw || {}).forEach((k) => { if (Date.now() - Number(raw[k]?.at) < SCAN_TTL) fresh[k] = raw[k]; });
                return fresh;
            } catch { return {}; }
        };
        const writeScan = (scan) => { try { localStorage.setItem(SCAN_KEY, JSON.stringify(scan)); } catch { /* no storage */ } };

        /** A bookmark without a watch, chosen by name, then the usual picker. */
        const watchMore = () => {
            const bookmarks = (this.dash.allBookmarks || []).filter((b) => /^https?:/i.test(String(b.url || '')) && !watch.isWatched(b));
            const seen = new Set();
            const choices = bookmarks.filter((b) => { const k = watch.key(b.url); if (seen.has(k)) return false; seen.add(k); return true; })
                .sort((a, b) => String(a.name || a.url).localeCompare(String(b.name || b.url)));
            const scan = readScan();
            let onlyFeeds = false;
            let query = '';
            // Sites known to have a feed first, then the ones not looked at yet, then the ones without.
            const rank = (b) => { const r = scan[watch.key(b.url)]; return !r ? 1 : (r.n > 0 ? 0 : 2); };
            const list = () => {
                const q = String(query || '').trim().toLowerCase();
                const hits = choices.filter((b) => (!q || `${b.name || ''} ${b.url}`.toLowerCase().includes(q))
                    && (!onlyFeeds || rank(b) === 0))
                    .map((b, i) => ({ b, i }))
                    .sort((x, y) => (rank(x.b) - rank(y.b)) || (x.i - y.i))
                    .map((x) => x.b)
                    .slice(0, 60);
                return hits.length
                    ? hits.map((b) => {
                        const r = scan[watch.key(b.url)];
                        const tag = !r ? '' : (r.n > 0
                            ? `<em class="fwm-tag is-feed">${esc(t('config.feedWatchMoreHasFeed', 'feed found'))}</em>`
                            : `<em class="fwm-tag">${esc(t('config.feedWatchMoreNoFeed', 'no feed advertised'))}</em>`);
                        return `<li><button type="button" class="fwm-choice${r && r.n === 0 ? ' is-none' : ''}" data-fwm-choose="${esc(b.url)}"><strong>${esc(b.name || b.url)}</strong><span>${esc(hostOf(b.url))}</span>${tag}</button></li>`;
                    }).join('')
                    : `<li class="feed-watch-note">${esc(onlyFeeds && !q
                        ? t('config.feedWatchMoreNoneYet', 'No site with a feed found yet. The sites are still being looked at.')
                        : t('config.feedWatchMoreNone', 'No bookmark without a watch matches.'))}</li>`;
            };
            global.AppModal.show({
                title: t('config.feedWatchMoreTitle', 'Watch more feeds'),
                htmlMessage: `<div class="fwm-chooser" data-fwm-chooser>
                        <input type="search" class="fwm-chooser-search" data-fwm-chooser-search autocomplete="off"
                               aria-label="${esc(t('config.feedWatchMoreSearch', 'Find a bookmark'))}" placeholder="${esc(t('config.feedWatchMoreSearch', 'Find a bookmark'))}">
                        <label class="fwm-chooser-only"><input type="checkbox" data-fwm-only> ${esc(t('config.feedWatchMoreOnly', 'Only sites with a feed'))}</label>
                        <p class="feed-watch-note" data-fwm-scan aria-live="polite"></p>
                        <ul class="fwm-chooser-list" data-fwm-chooser-list>${list()}</ul>
                    </div>`,
                showCancel: false,
                modalClass: 'feed-watch-modal',
                initialFocusSelector: '[data-fwm-chooser-search]',
            });
            picker()?.addCloseButton?.();
            const root = document.querySelector('[data-fwm-chooser]');
            if (!root) return;
            const listEl = root.querySelector('[data-fwm-chooser-list]');
            const statusEl = root.querySelector('[data-fwm-scan]');
            const render = () => { listEl.innerHTML = list(); };
            const search = root.querySelector('[data-fwm-chooser-search]');
            search?.addEventListener('input', (e) => { query = e.target.value; render(); });
            root.querySelector('[data-fwm-only]')?.addEventListener('change', (e) => { onlyFeeds = e.target.checked; render(); });
            search?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); listEl.querySelector('[data-fwm-choose]')?.click(); }
            });
            listEl.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-fwm-choose]');
                if (!btn) return;
                const bookmark = choices.find((b) => b.url === btn.getAttribute('data-fwm-choose'));
                // The picker takes over the same modal.
                if (bookmark) void picker()?.open({ bookmark }).then(paint);
            });

            // A quick look at each site the list has not seen yet: the page head
            // only, one request apiece, one every half second so the outbound
            // limit is never in the way. It stops when the window closes.
            const todo = choices.filter((b) => !scan[watch.key(b.url)]);
            const total = choices.length;
            const found = () => choices.filter((b) => scan[watch.key(b.url)]?.n > 0).length;
            const say = () => {
                if (!statusEl.isConnected) return;
                const looked = total - todo.length;
                statusEl.textContent = todo.length
                    ? t('config.feedWatchMoreProgress', 'Looked at {done} of {total} sites · {found} have a feed')
                        .replace('{done}', String(looked)).replace('{total}', String(total)).replace('{found}', String(found()))
                    : t('config.feedWatchMoreDone', '{found} of {total} sites have a feed')
                        .replace('{found}', String(found())).replace('{total}', String(total));
            };
            say();
            void (async () => {
                let sinceRender = 0;
                while (todo.length && root.isConnected) {
                    const b = todo.shift();
                    let n = 0;
                    try {
                        const res = await fetch(`/api/feeds/watch/candidates?light=1&url=${encodeURIComponent(b.url)}`);
                        if (res.ok) n = ((await res.json()).feeds || []).length;
                        else if (res.status === 429) { todo.unshift(b); await new Promise((r) => setTimeout(r, 4000)); continue; }
                    } catch { /* offline or blocked: counts as nothing found */ }
                    scan[watch.key(b.url)] = { at: Date.now(), n };
                    sinceRender += 1;
                    if (sinceRender >= 4 || !todo.length) { sinceRender = 0; writeScan(scan); if (root.isConnected) render(); }
                    say();
                    await new Promise((r) => setTimeout(r, 500));
                }
                writeScan(scan);
                say();
            })();
        };

        const checkAll = async () => {
            state.checking = true;
            paint();
            try {
                await watch.pollNow();
            } finally {
                state.checking = false;
                paint();
            }
        };

        const toggleOpen = (id) => {
            state.open = state.open === id ? '' : id;
            state.cursor = id;
            paint();
        };

        // The host is replaced with the panel; the handlers ride on it once.
        if (host.dataset.fwmBound) { this.paintFeedWatchList = paint; paint(); return; }
        host.dataset.fwmBound = '1';

        host.addEventListener('click', async (event) => {
            const target = event.target;
            const holder = target.closest('[data-fw-row], [data-fwm-detail]');
            const id = holder?.getAttribute('data-fw-row') || holder?.getAttribute('data-fwm-detail') || '';
            const r = id ? rowById(id) : null;
            if (holder?.hasAttribute('data-fw-row') && state.cursor !== id) {
                state.cursor = id;
                host.querySelectorAll('[data-fw-row]').forEach((row) => row.classList.toggle('keyboard-selected', row === holder));
            }

            if (target.closest('[data-fwm-paper]')) { void global.FeedWatchNews?.open(); return; }
            if (target.closest('[data-fwm-check]')) { await checkAll(); return; }
            if (target.closest('[data-fwm-more]')) { watchMore(); return; }
            const bulkBtn = target.closest('[data-fwm-bulk]');
            if (bulkBtn) { await bulk(bulkBtn.getAttribute('data-fwm-bulk')); return; }

            const retry = target.closest('[data-fwl-retry]');
            if (retry) {
                retry.disabled = true;
                await watch.retry(retry.dataset.fwlRetry, retry.dataset.fwlFeed);
                paint();
                return;
            }
            if (target.closest('[data-fwm-toggle]') && r) { toggleOpen(r.id); return; }
            if (!r) return;
            if (target.closest('[data-fwm-mute], [data-fwd-mute]')) { await update(r, { muted: r.feed.muted !== true }); return; }
            if (target.closest('[data-fwd-pause]')) { await update(r, { paused: r.feed.paused !== true }); return; }
            const remove = target.closest('[data-fwd-word-remove]');
            if (remove) {
                const kind = remove.closest('[data-fwd-words]')?.getAttribute('data-fwd-words');
                const word = remove.getAttribute('data-fwd-word-remove');
                if (kind) await update(r, { [kind]: words(r.feed[kind]).filter((w) => w !== word) });
                return;
            }
            if (target.closest('[data-fwl-edit]')) { await picker()?.open({ bookmark: r.bookmark }); paint(); return; }
            if (target.closest('[data-fwl-stop]')) { await stop([r]); }
        });

        host.addEventListener('change', async (event) => {
            const target = event.target;
            if (target.matches('[data-fwm-tick-all]')) {
                if (target.checked) collect().forEach((r) => state.ticked.add(r.id));
                else state.ticked.clear();
                paint();
                return;
            }
            if (target.matches('[data-fwm-bulk-interval]')) { await bulkInterval(Number(target.value)); return; }
            const holder = target.closest('[data-fw-row], [data-fwm-detail]');
            const id = holder?.getAttribute('data-fw-row') || holder?.getAttribute('data-fwm-detail') || '';
            const r = id ? rowById(id) : null;
            if (!r) return;
            if (target.matches('[data-fwm-tick]')) {
                if (target.checked) state.ticked.add(r.id); else state.ticked.delete(r.id);
                paint();
                return;
            }
            if (target.matches('[data-fwm-interval], [data-fwd-interval]')) await update(r, { intervalMinutes: Number(target.value) });
        });

        host.addEventListener('keydown', async (event) => {
            const input = event.target.closest?.('[data-fwd-word-input]');
            if (!input) return;
            if (event.key !== 'Enter' && event.key !== ',') return;
            event.preventDefault();
            const id = input.closest('[data-fwm-detail]')?.getAttribute('data-fwm-detail');
            const r = id ? rowById(id) : null;
            if (r) await addWord(r, input.getAttribute('data-fwd-word-input'), input);
        });

        if (!this._feedWatchListBound) {
            this._feedWatchListBound = true;
            document.addEventListener('feedwatch:changed', () => this.paintFeedWatchList?.());
        }
        this.paintFeedWatchList = paint;
        this._fwActions = { paint, toggleOpen, update, stop, rowById, collect };
        paint();
        void watch.load({ force: true }).then(paint);
    }

    /*
     * The list's keys, asked by config's keyboard handler before its own.
     *
     * j and k move the section rail everywhere else in Config; here they move
     * through the rows while the keys are aimed at the list (nothing focused,
     * or something inside it), as they do on the Bookmarks list. Enter, m, p
     * and Delete are not used anywhere else in Config.
     */
    function handleKey(e) {
        if (this.section !== 'feed-watch' || !this._fwActions) return false;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
        const target = e.target;
        const list = document.querySelector('#config-fw-list');
        if (!list) return false;
        const inList = list.contains(target);
        const loose = !target || target === document.body || target.id === 'config-section-panel';
        if (!inList && !loose) return false;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return false;
        const { collect, toggleOpen, update, stop, rowById, paint } = this._fwActions;
        const state = stateOf(this);
        const rows = collect();
        if (!rows.length) return false;
        const key = e.key;
        const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
        const focusCursor = () => {
            paint();
            const row = document.querySelector(`[data-fw-row="${CSS.escape(state.cursor)}"]`);
            row?.focus({ preventScroll: true });
            row?.scrollIntoView({ block: 'nearest' });
        };
        if (key === 'j' || key === 'k' || key === 'ArrowDown' || key === 'ArrowUp') {
            take();
            const at = rows.findIndex((r) => r.id === state.cursor);
            const step = key === 'j' || key === 'ArrowDown' ? 1 : -1;
            const next = at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + step));
            state.cursor = rows[next].id;
            focusCursor();
            return true;
        }
        const r = state.cursor ? rowById(state.cursor) : null;
        if (!r) return false;
        if (key === 'Enter') {
            // A button or link in the row answers Enter itself.
            if (target?.closest?.('button, a, label')) return false;
            take();
            toggleOpen(r.id);
            document.querySelector(`[data-fw-row="${CSS.escape(r.id)}"]`)?.focus({ preventScroll: true });
            return true;
        }
        if (key === 'm' || key === 'p') {
            take();
            void update(r, key === 'm' ? { muted: r.feed.muted !== true } : { paused: r.feed.paused !== true }).then(focusCursor);
            return true;
        }
        if (key === 'Delete' || key === 'Backspace') {
            take();
            void stop([r]).then(() => {
                const left = collect();
                if (left.length && !rowById(state.cursor)) state.cursor = left[0].id;
                focusCursor();
            });
            return true;
        }
        return false;
    }

    global.ConfigFeedWatch = {
        bindList(config, container) {
            return bindFeedWatchList.call(config, container);
        },
        handleKey(config, e) {
            return handleKey.call(config, e);
        },
    };
})(window);
