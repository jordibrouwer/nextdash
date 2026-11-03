/**
 * Dashboard tile + link preview card for bookmark add/edit forms.
 */
(function (global) {
    'use strict';

    /*
     * The one deliberate copy of the shared escaper.
     *
     * This module is synced verbatim into the Chrome extension (see
     * scripts/sync-extension-bookmark-form.sh), which loads it on its own
     * popup without the dashboard's head scripts, so it cannot reach
     * window.NextDashHtml. Kept identical to it in behaviour, apostrophe
     * included -- that character was missing here and nowhere else.
     */
    function escHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[ch]));
    }

    function buildCompactPreviewStripHtml(prefix, t) {
        const tr = (key, fb) => (typeof t === 'function' ? t(key, fb) : fb);
        return `
            <div class="nbm-section nbm-section-compact-preview nbm-wizard-step-1-panel" id="${prefix}-preview-strip-section" hidden>
                <div class="bookmark-form-preview-strip" id="${prefix}-preview-strip" aria-live="polite">
                    <div class="bookmark-form-preview-strip-icon" id="${prefix}-preview-strip-icon" aria-hidden="true"></div>
                    <div class="bookmark-form-preview-strip-meta">
                        <span class="bookmark-form-preview-strip-title" id="${prefix}-preview-strip-title">${tr('config.bookmarkPreviewUntitled', 'Untitled')}</span>
                        <span class="bookmark-form-preview-strip-domain" id="${prefix}-preview-strip-domain"></span>
                    </div>
                    <div class="bookmark-form-preview-strip-tile" id="${prefix}-preview-strip-tile"></div>
                </div>
            </div>
        `;
    }

    function buildPreviewSectionHtml(prefix, t) {
        const tr = (key, fb) => (typeof t === 'function' ? t(key, fb) : fb);
        return `
            <div class="bookmark-form-preview-section">
                <div class="bookmark-form-preview-block">
                    <div class="bookmark-form-preview-block-header">
                        <span class="bookmark-form-preview-label">${tr('config.bookmarkDashboardPreviewLabel', 'Dashboard preview')}</span>
                        <span class="bookmark-form-preview-hint">${tr('config.bookmarkDashboardPreviewHint', 'Hover to see the full tile')}</span>
                    </div>
                    <div class="config-bookmark-preview-hover-zone" id="${prefix}-dashboard-preview-zone" tabindex="0">
                        <div class="config-bookmark-preview config-bookmark-preview--compact" id="${prefix}-dashboard-preview"
                             role="img" aria-label="${tr('config.bookmarkDashboardPreviewAria', 'Dashboard tile preview')}"></div>
                        <div class="config-bookmark-preview-popover" id="${prefix}-dashboard-preview-popover"
                             aria-hidden="true"></div>
                    </div>
                </div>
                <div class="bookmark-form-preview-block">
                    <div class="bookmark-form-preview-block-header">
                        <span class="bookmark-form-preview-label">${tr('config.bookmarkLinkPreviewLabel', 'Link preview')}</span>
                        <div class="bookmark-detail-link-preview-actions">
                            <button type="button" id="${prefix}-link-preview-refresh-btn" class="btn btn-secondary btn-small">${tr('config.bookmarkLinkPreviewRefresh', 'Refresh')}</button>
                            <button type="button" id="${prefix}-link-preview-clear-btn" class="btn btn-secondary btn-small">${tr('config.bookmarkLinkPreviewClear', 'Clear')}</button>
                        </div>
                    </div>
                    <p id="${prefix}-link-preview-empty" class="bookmark-form-preview-empty">${tr('config.bookmarkLinkPreviewEmpty', 'No preview metadata yet — refresh to fetch title, description and image.')}</p>
                    <div id="${prefix}-link-preview-card" class="config-link-preview-card" hidden></div>
                    <p id="${prefix}-feed-line" class="bookmark-form-feed-line" hidden></p>
                </div>
            </div>
        `;
    }

    class BookmarkFormPreview {
        constructor(options = {}) {
            this.prefix = options.prefix || 'detail';
            this.apiBase = options.apiBase || '';
            this.getSettings = options.getSettings || (() => ({}));
            this.t = options.t || ((key, fb) => fb);
            this.notify = options.notify || (() => {});
            this.onPreviewChange = options.onPreviewChange || (() => {});
            this.iconBasePath = options.iconBasePath || '/data/icons/';
        }

        ids() {
            const p = this.prefix;
            return {
                stripSection: `${p}-preview-strip-section`,
                stripIcon: `${p}-preview-strip-icon`,
                stripTitle: `${p}-preview-strip-title`,
                stripDomain: `${p}-preview-strip-domain`,
                stripTile: `${p}-preview-strip-tile`,
                dashboardCompact: `${p}-dashboard-preview`,
                dashboardPopover: `${p}-dashboard-preview-popover`,
                linkCard: `${p}-link-preview-card`,
                feedLine: `${p}-feed-line`,
                linkEmpty: `${p}-link-preview-empty`,
                linkRefresh: `${p}-link-preview-refresh-btn`,
                linkClear: `${p}-link-preview-clear-btn`,
            };
        }

        bind(signal) {
            const ids = this.ids();
            const refreshBtn = document.getElementById(ids.linkRefresh);
            const clearBtn = document.getElementById(ids.linkClear);
            const opts = signal ? { signal } : undefined;

            refreshBtn?.addEventListener('click', () => {
                const bookmark = this.getBookmark?.();
                if (bookmark) this.refreshLinkPreview(bookmark);
            }, opts);

            clearBtn?.addEventListener('click', () => {
                const bookmark = this.getBookmark?.();
                if (bookmark) this.clearLinkPreview(bookmark);
            }, opts);
        }

        getBookmark() {
            return null;
        }

        buildDashboardPreviewHtml(bookmark, expanded = false) {
            const settings = this.getSettings() || {};
            const showIcons = settings.showIcons !== false;
            // "hover" counts as showing it: this is a still preview of a row,
            // and a row under the pointer is exactly what it depicts. Only
            // "never" takes the label out of the picture.
            const showShortcuts = (settings.shortcutDisplay || 'always') !== 'never';
            const showPinIcon = settings.showPinIcon === true;
            const showNoteIcon = settings.showNoteIcon !== false;
            // !== false, like its true-default neighbours above: the preview is
            // handed whatever settings object the caller has, and an absent key
            // there took the status colour out of a row that shows it.
            const showStatus = settings.showStatus !== false;

            const untitled = this.t('config.bookmarkPreviewUntitled', 'Untitled');
            const name = String(bookmark?.name || '').trim() || untitled;
            const shortcutRaw = String(bookmark?.shortcut || '').trim().toUpperCase();
            const shortcut = showShortcuts && shortcutRaw ? shortcutRaw : '';

            let statusClass = '';
            let statusHtml = '';
            if (showStatus && bookmark?.checkStatus) {
                statusClass = ' status-checking';
                const statusLabel = this.t('config.bookmarkPreviewStatusCheck', '···');
                statusHtml = `<span class="status-text">${escHtml(statusLabel)}</span>`;
            }

            const pinHtml = (showPinIcon && bookmark?.pinned)
                ? `<span class="bookmark-pin-badge bookmark-superscript-badge" title="Pinned" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/></svg></span>`
                : '';

            const noteHtml = (showNoteIcon && String(bookmark?.note || '').trim())
                ? `<span class="bookmark-note-badge bookmark-superscript-badge" title="Note" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.75h7l3.75 3.75V19A1.25 1.25 0 0 1 17 20.25H7A1.25 1.25 0 0 1 5.75 19V6A1.25 1.25 0 0 1 7 4.75Z"/><path d="M14.5 4.75V8.5h3.75"/><path d="M8.75 11h6.5"/><path d="M8.75 14h5.25"/></svg></span>`
                : '';

            const iconBase = this.iconBasePath.replace(/\/?$/, '/');
            // A full address is a favicon not stored yet (the extension
            // stores it on save), drawn from where it is.
            const iconSrc = (icon) => (/^https?:\/\//i.test(icon) ? icon : iconBase + icon);
            const iconHtml = showIcons
                ? (bookmark?.icon
                    ? `<span class="bookmark-icon-slot"><img class="bookmark-icon" src="${escHtml(iconSrc(bookmark.icon))}" alt=""></span>`
                    : `<span class="bookmark-icon-slot bookmark-icon-slot--empty" aria-hidden="true"></span>`)
                : '';

            const expandedClass = expanded ? ' config-bookmark-preview-tile--expanded' : '';

            return `
                <div class="config-bookmark-preview-tile bookmark-link${statusClass}${expandedClass}" role="presentation">
                    <div class="bookmark-lead">${iconHtml}</div>
                    <span class="bookmark-open">
                        <span class="bookmark-text">${escHtml(name)}</span>
                        ${statusHtml}
                        ${pinHtml}
                        ${noteHtml}
                    </span>
                    <span class="bookmark-shortcut${shortcut ? '' : ' is-empty'}">${escHtml(shortcut)}</span>
                </div>
            `;
        }

        updateCompactStrip(bookmark) {
            const ids = this.ids();
            const section = document.getElementById(ids.stripSection);
            if (!section) return;

            const url = global.BookmarkUrlUtils?.ensureHttpUrl(bookmark?.url) || String(bookmark?.url || '').trim();
            const hasUrl = Boolean(url && global.BookmarkUrlUtils?.isHttpUrl?.(url));
            section.hidden = !hasUrl;
            if (!hasUrl) return;

            const iconEl = document.getElementById(ids.stripIcon);
            const titleEl = document.getElementById(ids.stripTitle);
            const domainEl = document.getElementById(ids.stripDomain);
            const tileEl = document.getElementById(ids.stripTile);
            const untitled = this.t('config.bookmarkPreviewUntitled', 'Untitled');
            const title = String(bookmark?.name || bookmark?.previewTitle || '').trim() || untitled;

            if (titleEl) titleEl.textContent = title;

            let domain = '';
            try { domain = new URL(url).hostname; } catch { domain = ''; }
            if (domainEl) {
                domainEl.textContent = domain;
                domainEl.hidden = !domain;
            }

            const iconBase = this.iconBasePath.replace(/\/?$/, '/');
            if (iconEl) {
                if (bookmark?.icon) {
                    const src = /^https?:\/\//i.test(bookmark.icon) ? bookmark.icon : iconBase + bookmark.icon;
                    iconEl.innerHTML = `<img src="${escHtml(src)}" alt="">`;
                } else {
                    iconEl.innerHTML = '<span class="bookmark-form-preview-strip-icon-empty"></span>';
                }
            }

            if (tileEl) {
                tileEl.innerHTML = this.buildDashboardPreviewHtml(bookmark, false);
            }
        }

        updateDashboardPreview(bookmark) {
            const ids = this.ids();
            const compact = document.getElementById(ids.dashboardCompact);
            const popover = document.getElementById(ids.dashboardPopover);
            if (!compact || !bookmark) return;

            const html = this.buildDashboardPreviewHtml(bookmark, false);
            compact.innerHTML = html;
            if (popover) {
                popover.innerHTML = this.buildDashboardPreviewHtml(bookmark, true);
            }
        }

        hasLinkPreviewMetadata(bookmark) {
            return Boolean(
                String(bookmark?.previewTitle || '').trim()
                || String(bookmark?.previewDesc || '').trim()
                || String(bookmark?.previewImage || '').trim()
            );
        }

        updateLinkPreviewCard(bookmark) {
            const ids = this.ids();
            const card = document.getElementById(ids.linkCard);
            const emptyEl = document.getElementById(ids.linkEmpty);
            const clearBtn = document.getElementById(ids.linkClear);
            if (!card || !emptyEl) return;

            const hasMeta = this.hasLinkPreviewMetadata(bookmark);
            emptyEl.hidden = hasMeta;
            card.hidden = !hasMeta;
            if (clearBtn) clearBtn.disabled = !hasMeta;

            this.renderFeedLine(bookmark);

            if (!hasMeta) {
                card.innerHTML = '';
                return;
            }

            const title = String(bookmark.previewTitle || bookmark.name || '').trim()
                || this.t('config.bookmarkPreviewUntitled', 'Untitled');
            const desc = String(bookmark.previewDesc || '').trim();
            const image = global.BookmarkUrlUtils?.safeHttpResourceUrl?.(bookmark.previewImage) || '';
            let domain = '';
            try { domain = new URL(global.BookmarkUrlUtils?.ensureHttpUrl(bookmark.url) || bookmark.url || '').hostname; } catch { domain = ''; }

            card.innerHTML = `
                ${image ? `<div class="config-link-preview-card-image-wrap"><img class="config-link-preview-card-image" src="${escHtml(image)}" alt="" loading="lazy" decoding="async"></div>` : ''}
                <div class="config-link-preview-card-body">
                    <div class="config-link-preview-card-title">${escHtml(title)}</div>
                    ${desc ? `<div class="config-link-preview-card-desc">${escHtml(desc)}</div>` : ''}
                    ${domain ? `<div class="config-link-preview-card-domain">${escHtml(domain)}</div>` : ''}
                </div>
            `;
        }

        /**
         * The feed behind this bookmark, when Fresh knows of one.
         *
         * The one question the dashboard cannot answer: a bookmark that
         * publishes but has nothing new looks exactly like a bookmark that
         * publishes nothing, and the count on the Fresh tab says how many there
         * are without saying which. This is where someone looks when they are
         * wondering why this bookmark never says anything.
         *
         * Only while Fresh is on: with it off the server sends an empty map, so
         * every bookmark would read as "no feed" — an answer about the setting
         * rather than about the bookmark.
         */
        renderFeedLine(bookmark) {
            const line = document.getElementById(this.ids().feedLine);
            if (!line) return;
            const dash = global.dashboardInstance;
            const url = String(bookmark?.url || '').trim();
            /*
             * Watching needs a saved bookmark: the server keeps a watch against
             * the bookmark it was started from. A bookmark still being created
             * has no such row, so it gets no button until it is saved.
             */
            const watch = dash?.feedWatch;
            const saved = Boolean(watch && url && (dash.allBookmarks || []).some(
                (b) => watch.key(b.url) === watch.key(url)));
            if (!saved) {
                line.hidden = true;
                line.textContent = '';
                return;
            }
            line.hidden = false;
            const watched = watch.watchFor(bookmark)?.feeds || [];
            const label = watched.length
                ? this.t('config.bookmarkFeedWatching', 'Watching · every {interval}', {
                    interval: global.FeedWatchPicker?.intervalWords?.(watched[0].intervalMinutes) || '',
                })
                : this.t('config.bookmarkFeedWatch', 'Watch this feed…');
            line.innerHTML = `<span class="bookmark-form-feed-label">${escHtml(this.t('config.feedWatchLabel', 'Watch feeds'))}</span>`
                + `<button type="button" class="bookmark-form-feed-watch" data-feed-watch-open>${escHtml(label)}</button>`;
            line.title = '';
            line.onclick = (event) => {
                if (!event.target.closest('[data-feed-watch-open]')) return;
                void global.FeedWatchPicker?.open({ bookmark }).then(() => this.renderFeedLine(bookmark));
            };
        }

        async refreshLinkPreview(bookmark) {
            const url = global.BookmarkUrlUtils?.ensureHttpUrl(bookmark?.url) || String(bookmark?.url || '').trim();
            if (!url) {
                this.notify(this.t('config.bookmarkLinkPreviewNoUrl', 'Enter a URL first.'), 'info');
                return false;
            }
            bookmark.url = url;
            const ids = this.ids();
            const btn = document.getElementById(ids.linkRefresh);
            if (btn) btn.disabled = true;
            try {
                const data = await global.BookmarkPreviewService.fetchLinkPreview(url, this.apiBase);
                bookmark.previewTitle = data.title || '';
                bookmark.previewDesc = data.description || '';
                bookmark.previewImage = data.image || '';
                this.updateLinkPreviewCard(bookmark);
                this.onPreviewChange(bookmark);
                this.notify(this.t('config.bookmarkLinkPreviewRefreshed', 'Link preview updated.'), 'success');
                return true;
            } catch {
                this.notify(this.t('config.bookmarkLinkPreviewRefreshFailed', 'Could not fetch link preview.'), 'error');
                return false;
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        clearLinkPreview(bookmark) {
            delete bookmark.previewTitle;
            delete bookmark.previewDesc;
            delete bookmark.previewImage;
            this.updateLinkPreviewCard(bookmark);
            this.onPreviewChange(bookmark);
            this.notify(this.t('config.bookmarkLinkPreviewCleared', 'Link preview cleared.'), 'success');
        }

        updateAll(bookmark) {
            this.updateCompactStrip(bookmark);
            if (document.getElementById(this.ids().dashboardCompact)) {
                this.updateDashboardPreview(bookmark);
            }
            if (document.getElementById(this.ids().linkCard)) {
                this.updateLinkPreviewCard(bookmark);
            }
        }
    }

    /*
     * The Watch feeds row of the add/edit form.
     *
     * One line between Name and the rest, shown only when there is something to
     * say: the page advertises a feed, or the bookmark is watched already. Shut,
     * it says what it knows ("2 feeds found", "Watching · every hour · …") and
     * carries the switch; open, it lists the feeds to tick, an address to paste,
     * the interval and Mute. Nothing is written while the form is open -- the
     * row only collects what was chosen, and `commit` writes it once the
     * bookmark is saved. Closing the form without saving throws it away. Retry
     * is the one exception: it asks the feed again at once, and says so.
     */
    const ROW_DEFAULT_MINUTES = 60;
    // The glyph a watched bookmark carries on the dashboard (feedWatchIcon).
    const FEED_GLYPH = '<svg class="bookmark-form-watch-glyph" viewBox="0 0 12 12" width="13" height="13" aria-hidden="true" focusable="false">'
        + '<circle cx="2.4" cy="9.6" r="1.2" fill="currentColor" stroke="none"/>'
        + '<path d="M1.2 5.2a5.6 5.6 0 0 1 5.6 5.6"/><path d="M1.2 1.4a9.4 9.4 0 0 1 9.4 9.4"/></svg>';

    function offerText(dash, key, fallback, vars) {
        let text = dash?.language?.t?.(key);
        if (!text || text === key) text = fallback;
        Object.keys(vars || {}).forEach((name) => { text = text.replace(`{${name}}`, () => String(vars[name])); });
        return text;
    }

    const isWebUrl = (url) => {
        if (!/^https?:\/\/\S+$/i.test(url)) return false;
        try { return Boolean(new URL(url).hostname); } catch { return false; }
    };

    const feedPath = (url) => {
        try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch { return url; }
    };

    /**
     * @param {HTMLElement} host the row
     * @param {{dash: object, getUrl: () => string, originalUrl?: string}} options
     *   `originalUrl`: the address a saved bookmark had when the form opened.
     */
    function mountFeedWatchRow(host, options) {
        const dash = options.dash;
        const watch = dash?.feedWatch;
        const t = (key, fallback, vars) => offerText(dash, key, fallback, vars);
        const originalUrl = String(options.originalUrl || '').trim();
        const originalWatched = Boolean(watch && originalUrl && watch.isWatched({ url: originalUrl }));
        // address key -> the feeds the page advertises, asked once
        const found = new Map();
        let seq = 0;
        let timer = null;
        let state = null;
        let open = false;
        const uid = `fw-row-${Math.random().toString(36).slice(2, 8)}`;

        host.classList.add('bookmark-form-watch');
        host.dataset.feedWatchRow = '';
        host.hidden = true;
        host.innerHTML = `
            <div class="bookmark-form-watch-head">
                <button type="button" class="bookmark-form-watch-toggle" data-feed-watch-toggle aria-expanded="false" aria-controls="${uid}-body">
                    ${FEED_GLYPH}
                    <span class="bookmark-form-watch-text">
                        <span class="bookmark-form-watch-title">${escHtml(t('dashboard.feedWatchTitle', 'Watch feeds'))}</span>
                        <span class="bookmark-form-watch-summary" data-feed-watch-summary></span>
                    </span>
                    <span class="bookmark-form-watch-chevron" aria-hidden="true"></span>
                </button>
                <label class="bookmark-form-watch-switch">
                    <input type="checkbox" role="switch" data-feed-watch-switch aria-label="${escHtml(t('dashboard.feedWatchTitle', 'Watch feeds'))}">
                    <span class="bookmark-form-watch-track" aria-hidden="true"></span>
                </label>
            </div>
            <div class="bookmark-form-watch-body" id="${uid}-body" hidden>
                <ul class="bookmark-form-watch-feeds" data-feed-watch-feeds aria-label="${escHtml(t('dashboard.feedWatchRowFeeds', 'Feeds to watch'))}"></ul>
                <div class="bookmark-form-watch-paste">
                    <input type="text" inputmode="url" spellcheck="false" class="bookmark-inline-input" data-feed-watch-paste autocomplete="off"
                           placeholder="${escHtml(t('dashboard.feedWatchRowPaste', 'Paste a feed address'))}"
                           aria-label="${escHtml(t('dashboard.feedWatchRowPaste', 'Paste a feed address'))}">
                    <button type="button" class="bookmark-inline-action-btn" data-feed-watch-add>${escHtml(t('dashboard.feedWatchRowAdd', 'Add'))}</button>
                    <span class="bookmark-form-watch-error" data-feed-watch-paste-error role="status" hidden>${escHtml(t('dashboard.feedWatchRowBadAddress', 'Enter an address that starts with http:// or https://'))}</span>
                </div>
                <div class="bookmark-form-watch-options">
                    <label class="bookmark-form-watch-interval">
                        <span>${escHtml(t('dashboard.feedWatchRowEveryLabel', 'Check every'))}</span>
                        <select class="bookmark-inline-select" data-feed-watch-interval>
                            ${(global.FeedWatchPicker?.intervals || []).map((i) => `<option value="${i.minutes}">${escHtml(t(i.label[0], i.label[1]))}</option>`).join('')}
                        </select>
                    </label>
                    <label class="bookmark-form-watch-switch bookmark-form-watch-mute">
                        <input type="checkbox" role="switch" data-feed-watch-mute>
                        <span class="bookmark-form-watch-track" aria-hidden="true"></span>
                        <span>${escHtml(t('config.feedWatchMute', 'Mute'))}</span>
                    </label>
                </div>
                <div class="bookmark-form-watch-stop" data-feed-watch-stop-area></div>
            </div>`;

        const $ = (sel) => host.querySelector(sel);
        const toggle = $('[data-feed-watch-toggle]');
        const summary = $('[data-feed-watch-summary]');
        const onSwitch = $('[data-feed-watch-switch]');
        const body = $('.bookmark-form-watch-body');
        const list = $('[data-feed-watch-feeds]');
        const paste = $('[data-feed-watch-paste]');
        const pasteError = $('[data-feed-watch-paste-error]');
        const intervalSelect = $('[data-feed-watch-interval]');
        const muteSwitch = $('[data-feed-watch-mute]');
        const stopArea = $('[data-feed-watch-stop-area]');

        const sameSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));

        /** The watch as it is stored, or null. */
        const entryOf = (url) => {
            const entry = watch.watchFor({ url });
            return entry?.feeds?.length ? entry : null;
        };

        const fresh = (url, key, entry) => {
            const checked = new Set((entry?.feeds || []).map((f) => f.feedUrl));
            const intervalMinutes = Number(entry?.feeds?.[0]?.intervalMinutes) || ROW_DEFAULT_MINUTES;
            const muted = entry?.muted === true;
            return {
                url, key, entry,
                feeds: (entry?.feeds || []).map((f) => ({ url: f.feedUrl, title: f.title || '' })),
                checked, on: Boolean(entry), stop: false, intervalMinutes, muted,
                initial: { checked: new Set(checked), intervalMinutes, muted },
            };
        };

        /** The feeds the page advertises join the list, unticked. */
        const mergeFound = (feeds) => {
            (feeds || []).forEach((feed) => {
                if (feed?.url && !state.feeds.some((f) => f.url === feed.url)) state.feeds.push({ url: feed.url, title: feed.title || '' });
            });
        };

        const changed = () => {
            if (!state?.entry) return false;
            return state.stop || !sameSet(state.checked, state.initial.checked)
                || state.intervalMinutes !== state.initial.intervalMinutes || state.muted !== state.initial.muted;
        };

        const statusOf = (feed) => {
            const reason = watch.errorReason(feed);
            const withReason = (text) => (reason ? `${text} · ${reason}` : text);
            if (feed.retired === true) return ['bad', withReason(t('config.feedWatchPaused', 'Paused after repeated failures'))];
            if (feed.paused === true) return ['off', t('config.feedWatchPausedByYou', 'Paused')];
            if (Number(feed.failures) > 0) return ['bad', withReason(t('config.feedWatchFailing', 'Last check failed'))];
            const entry = state.entry;
            const count = entry?.feeds?.length === 1 ? Number(entry.newCount) || 0 : 0;
            const head = count > 0 ? t('config.feedWatchNewState', '{n} new', { n: count }) : t('config.feedWatchQuiet', 'Nothing new');
            return ['ok', `${head} · ${t('dashboard.feedWatchRowChecked', 'checked {ago}', { ago: watch.agoText(feed.checkedAt) })}`];
        };

        const drawSummary = () => {
            let text;
            let tone = '';
            if (state.entry) {
                if (state.stop) text = t('dashboard.feedWatchRowWillStop', 'Will stop watching after saving');
                else if (changed()) text = t('dashboard.feedWatchRowWillUpdate', 'Will update after saving');
                else {
                    const info = watch.rowIconFor({ url: state.url });
                    text = info?.label || '';
                    tone = info?.state || '';
                }
            } else if (state.on && state.checked.size) {
                text = t('dashboard.feedOfferPending', 'Will watch after saving');
            } else if (state.feeds.length === 1) {
                text = t('dashboard.feedWatchRowFoundOne', '1 feed found · {title}', { title: state.feeds[0].title || feedPath(state.feeds[0].url) });
            } else {
                text = t('dashboard.feedWatchRowFoundMany', '{n} feeds found', { n: state.feeds.length });
            }
            summary.textContent = text;
            summary.dataset.tone = tone;
            onSwitch.checked = state.on && !state.stop;
            host.classList.toggle('is-on', onSwitch.checked);
        };

        const drawStop = () => {
            stopArea.replaceChildren();
            if (!state.entry) return;
            if (state.stop) {
                const note = document.createElement('span');
                note.className = 'bookmark-form-watch-note';
                note.textContent = t('dashboard.feedWatchRowWillStop', 'Will stop watching after saving');
                const undo = document.createElement('button');
                undo.type = 'button';
                undo.className = 'bookmark-inline-action-btn';
                undo.dataset.feedWatchUndo = '';
                undo.textContent = t('dashboard.undo', 'Undo');
                stopArea.append(note, undo);
            } else {
                const stop = document.createElement('button');
                stop.type = 'button';
                stop.className = 'bookmark-inline-action-btn bookmark-inline-delete bookmark-form-watch-stop-btn';
                stop.dataset.feedWatchStop = '';
                stop.textContent = t('dashboard.feedWatchStop', 'Stop watching');
                stopArea.append(stop);
            }
        };

        const drawList = () => {
            const stored = new Map((state.entry?.feeds || []).map((f) => [f.feedUrl, f]));
            list.innerHTML = state.feeds.map((feed) => {
                const kept = stored.get(feed.url);
                const [tone, text] = kept ? statusOf(kept) : ['', ''];
                const canRetry = kept && (kept.retired === true || Number(kept.failures) > 0);
                return `<li class="bookmark-form-watch-item">`
                    + `<label class="bookmark-form-watch-feed" title="${escHtml(feed.url)}">`
                    + `<input type="checkbox" data-feed-watch-feed value="${escHtml(feed.url)}"${state.checked.has(feed.url) ? ' checked' : ''}>`
                    + `<span class="bookmark-form-watch-feed-text">`
                    + `<span class="bookmark-form-watch-feed-name">${escHtml(feed.title || feedPath(feed.url))}</span>`
                    + `<span class="bookmark-form-watch-feed-path">${escHtml(feedPath(feed.url))}</span>`
                    + `</span></label>`
                    + (kept ? `<div class="bookmark-form-watch-status" data-feed-watch-status data-tone="${tone}">`
                        + `<span>${escHtml(text)}</span>`
                        + (canRetry ? `<button type="button" class="bookmark-inline-action-btn" data-feed-watch-retry="${escHtml(feed.url)}">${escHtml(t('dashboard.feedWatchRetryNow', 'Retry now'))}</button>` : '')
                        + `</div>` : '')
                    + `</li>`;
            }).join('');
        };

        const draw = () => {
            const show = Boolean(state && (state.entry || state.feeds.length));
            host.hidden = !show;
            if (!show) return;
            intervalSelect.value = String(state.intervalMinutes);
            muteSwitch.checked = state.muted;
            drawList();
            drawStop();
            drawSummary();
            setOpen(open);
        };

        function setOpen(value) {
            open = Boolean(value);
            body.hidden = !open;
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            host.classList.toggle('is-open', open);
        }

        const hide = () => { state = null; host.hidden = true; setOpen(false); };

        const evaluate = async () => {
            const mine = ++seq;
            const url = String(options.getUrl() || '').trim();
            if (!watch || !isWebUrl(url)) { hide(); return; }
            const key = watch.key(url);
            if (!key) { hide(); return; }
            if (state?.key !== key) {
                state = fresh(url, key, entryOf(url));
                setOpen(false);
                if (!found.has(key)) host.hidden = !state.entry;
                if (state.entry) draw();
            }
            if (!found.has(key)) {
                let feeds = [];
                try {
                    feeds = ((await watch.candidates(url))?.feeds || []).filter((f) => f?.url);
                } catch { feeds = []; }
                found.set(key, feeds);
            }
            if (mine !== seq || !host.isConnected || state?.key !== key) return;
            mergeFound(found.get(key));
            draw();
        };

        const addPasted = () => {
            const value = String(paste.value || '').trim();
            if (!isWebUrl(value)) {
                pasteError.hidden = false;
                paste.focus();
                return;
            }
            pasteError.hidden = true;
            if (!state.feeds.some((f) => f.url === value)) state.feeds.push({ url: value, title: '' });
            state.checked.add(value);
            state.on = true;
            state.stop = false;
            paste.value = '';
            drawList();
            drawStop();
            drawSummary();
            paste.focus();
        };

        toggle.addEventListener('click', () => setOpen(!open));
        onSwitch.addEventListener('change', () => {
            if (!state) return;
            if (onSwitch.checked) {
                state.on = true;
                state.stop = false;
                if (!state.checked.size) {
                    const first = state.initial.checked.size ? [...state.initial.checked] : [state.feeds[0]?.url].filter(Boolean);
                    first.forEach((u) => state.checked.add(u));
                }
                drawList();
                setOpen(true);
            } else {
                state.on = false;
                if (state.entry) state.stop = true;
            }
            drawStop();
            drawSummary();
        });
        list.addEventListener('change', (event) => {
            const box = event.target.closest?.('[data-feed-watch-feed]');
            if (!box || !state) return;
            if (box.checked) state.checked.add(box.value); else state.checked.delete(box.value);
            // Ticking a feed means watching it; untick the last and nothing is.
            state.on = state.checked.size > 0;
            state.stop = Boolean(state.entry) && !state.on;
            drawStop();
            drawSummary();
        });
        list.addEventListener('click', async (event) => {
            const retry = event.target.closest?.('[data-feed-watch-retry]');
            if (!retry || !state) return;
            event.preventDefault();
            retry.disabled = true;
            const key = state.key;
            await watch.retry(state.url, retry.dataset.feedWatchRetry);
            if (state?.key !== key) return;
            state.entry = entryOf(state.url) || state.entry;
            drawList();
            drawSummary();
            list.querySelector('[data-feed-watch-feed]')?.focus();
        });
        paste.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            addPasted();
        });
        paste.addEventListener('input', () => { pasteError.hidden = true; });
        $('[data-feed-watch-add]').addEventListener('click', addPasted);
        intervalSelect.addEventListener('change', () => {
            if (!state) return;
            state.intervalMinutes = Number(intervalSelect.value) || ROW_DEFAULT_MINUTES;
            drawSummary();
        });
        muteSwitch.addEventListener('change', () => {
            if (!state) return;
            state.muted = muteSwitch.checked;
            drawSummary();
        });
        stopArea.addEventListener('click', (event) => {
            if (!state) return;
            if (event.target.closest('[data-feed-watch-stop]')) {
                state.stop = true;
                state.on = false;
                drawStop();
                drawSummary();
                stopArea.querySelector('[data-feed-watch-undo]')?.focus();
            } else if (event.target.closest('[data-feed-watch-undo]')) {
                state.stop = false;
                state.on = true;
                if (!state.checked.size) state.initial.checked.forEach((u) => state.checked.add(u));
                drawList();
                drawStop();
                drawSummary();
                stopArea.querySelector('[data-feed-watch-stop]')?.focus();
            }
        });

        return {
            /** The page has settled: look for feeds, once per address. */
            refresh({ delay = 300 } = {}) {
                clearTimeout(timer);
                timer = setTimeout(() => { void evaluate(); }, delay);
            },
            /** The address is being typed over: a different one starts over. */
            reset() {
                clearTimeout(timer);
                const url = String(options.getUrl() || '').trim();
                if (!state || !watch || watch.key(url) !== state.key) {
                    seq += 1;
                    hide();
                }
            },
            /**
             * What Save should write, taken before the form is cleared: the
             * feeds and their interval, Mute, a stop -- and the old address, when
             * an edit moved a watched bookmark to a new one.
             */
            intent() {
                const url = String(options.getUrl() || '').trim();
                const moved = originalWatched && watch.key(url) !== watch.key(originalUrl);
                const out = { oldUrl: moved ? originalUrl : '', action: null };
                if (!state || !watch || watch.key(url) !== state.key) return out;
                const wanted = state.on && !state.stop ? [...state.checked] : [];
                if (state.entry) {
                    if (!wanted.length) return { ...out, action: 'stop' };
                    if (!changed()) return out;
                    const own = new Map(state.entry.feeds.map((f) => [f.feedUrl, Number(f.intervalMinutes) || ROW_DEFAULT_MINUTES]));
                    const intervalTouched = state.intervalMinutes !== state.initial.intervalMinutes;
                    return {
                        ...out,
                        action: 'watch',
                        saveSet: intervalTouched || !sameSet(state.checked, state.initial.checked),
                        // An untouched interval leaves each kept feed its own.
                        feeds: wanted.map((feedUrl) => ({
                            feedUrl,
                            intervalMinutes: !intervalTouched && own.has(feedUrl) ? own.get(feedUrl) : state.intervalMinutes,
                        })),
                        intervalMinutes: state.intervalMinutes,
                        muted: state.muted,
                        muteChanged: state.muted !== state.initial.muted,
                    };
                }
                if (!wanted.length) return out;
                return {
                    ...out,
                    action: 'watch',
                    saveSet: true,
                    feeds: wanted.map((feedUrl) => ({ feedUrl, intervalMinutes: state.intervalMinutes })),
                    intervalMinutes: state.intervalMinutes,
                    muted: state.muted,
                    muteChanged: state.muted,
                };
            },
            /** Create + New: the next bookmark starts without a row. */
            clear() { clearTimeout(timer); seq += 1; hide(); },
        };
    }

    /**
     * Write what the row collected, now that the bookmark is saved.
     * @param {object} dash
     * @param {ReturnType<ReturnType<typeof mountFeedWatchRow>['intent']>} intent
     * @param {{name?: string, url: string}} saved
     */
    async function commitFeedWatchRow(dash, intent, saved) {
        const watch = dash?.feedWatch;
        const url = String(saved?.url || '').trim();
        if (!watch || !intent || !url) return false;
        const t = (key, fallback, vars) => offerText(dash, key, fallback, vars);
        const name = String(saved?.name || '').trim() || url;
        const toast = (message, type = 'success') => dash?.showNotification?.(message, type, { duration: 4000, replace: true });

        /*
         * The server keeps a watch under the address it was started from and
         * does not follow an edit. The old one is dropped -- unless another
         * bookmark still has that address, which the list then still shows.
         */
        if (intent.oldUrl && watch.key(intent.oldUrl) !== watch.key(url)) {
            await watch.load({ force: true });
            if (!watch.byKey.has(watch.key(intent.oldUrl))) await watch.unwatch(intent.oldUrl);
        }

        if (intent.action === 'stop') {
            if (!(await watch.unwatch(url))) {
                toast(t('dashboard.feedWatchFailed', 'Could not save the watch'), 'error');
                return false;
            }
            toast(t('dashboard.feedWatchStopped', 'Stopped watching {name}', { name }));
            return true;
        }
        if (intent.action !== 'watch') return false;

        if (intent.saveSet) {
            const result = await watch.save(url, intent.feeds);
            if (!result.ok) {
                if (result.error === 'not-a-feed') toast(t('dashboard.feedWatchNotAFeed', 'That address is not a feed nextDash can read'), 'error');
                else if (result.error === 'limit') toast(t('dashboard.feedWatchLimit', 'You are watching {limit} feeds, the most nextDash follows', { limit: watch.limit }), 'error');
                else toast(t('dashboard.feedWatchFailed', 'Could not save the watch'), 'error');
                return false;
            }
        }
        if (intent.muteChanged || (intent.saveSet && intent.muted)) {
            const feeds = watch.watchFor({ url })?.feeds || [];
            for (const feed of feeds) {
                if ((feed.muted === true) !== intent.muted) await watch.updateFeed(url, feed.feedUrl, { muted: intent.muted });
            }
        }
        toast(t('dashboard.feedWatchStarted', 'Watching {name} · checked every {interval}. You\'ll see news when it publishes something new.', {
            name,
            interval: global.FeedWatchPicker?.intervalWords?.(intent.intervalMinutes) || '',
        }));
        return true;
    }

    global.BookmarkFeedWatchRow = { mount: mountFeedWatchRow, commit: commitFeedWatchRow };

    global.BookmarkFormPreview = BookmarkFormPreview;
    global.BookmarkFormPreviewHtml = { buildPreviewSectionHtml, buildCompactPreviewStripHtml, escHtml };
})(typeof window !== 'undefined' ? window : globalThis);
