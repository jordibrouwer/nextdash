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
     * Offering the feed a page advertises, while a bookmark is added or edited.
     *
     * Shown as a chip under the address, drawn like the tag suggestions: one
     * to take ("Feed found: Posts · Watch?"), one to turn down ("Not now").
     * Only the first advertised feed is offered -- the rest are in the picker.
     * A saved bookmark is watched at once; one still being created has no row
     * for the server to hang a watch on, so the intent is kept in the
     * dashboard (`setPending`) and saved by `flush` right after the bookmark
     * exists. A refusal is remembered per site on this device.
     */
    const OFFER_DEFAULT_MINUTES = 60;
    const OFFER_REFUSED_KEY = 'nextdash.feedOfferRefused';

    function offerRefusals() {
        try {
            const list = JSON.parse(global.localStorage.getItem(OFFER_REFUSED_KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    }

    function offerRefuse(key) {
        try {
            const list = offerRefusals();
            if (!list.includes(key)) list.push(key);
            global.localStorage.setItem(OFFER_REFUSED_KEY, JSON.stringify(list.slice(-500)));
        } catch { /* no storage: the offer comes back next time */ }
    }

    function offerText(dash, key, fallback, vars) {
        let text = dash?.language?.t?.(key);
        if (!text || text === key) text = fallback;
        Object.keys(vars || {}).forEach((name) => { text = text.replace(`{${name}}`, () => String(vars[name])); });
        return text;
    }

    function offerToast(dash, name, minutes) {
        dash?.showNotification?.(offerText(dash, 'dashboard.feedWatchStarted', 'Watching {name} · checked every {interval}', {
            name,
            interval: global.FeedWatchPicker?.intervalWords?.(minutes) || '',
        }), 'success', { duration: 4000, replace: true });
    }

    /**
     * @param {HTMLElement} host where the chip goes
     * @param {{dash: object, getUrl: () => string, getName: () => string, canWatchNow: () => boolean}} options
     *   `canWatchNow`: the address is a saved bookmark's own (an edit that has not changed it).
     */
    function mountFeedOffer(host, options) {
        const dash = options.dash;
        const watch = dash?.feedWatch;
        let seq = 0;
        let timer = null;
        // address key -> the first feed the page advertises (or null), asked once
        const found = new Map();
        let busy = false;

        const hide = () => { host.replaceChildren(); host.hidden = true; };
        const t = (key, fallback, vars) => offerText(dash, key, fallback, vars);

        const chip = (text, className, onClick, title) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = className;
            button.textContent = text;
            if (title) { button.title = title; button.setAttribute('aria-label', title); }
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onClick();
            });
            return button;
        };

        const draw = (url, feed) => {
            const key = watch.key(url);
            const pending = watch.hasPending(url);
            host.replaceChildren();
            host.hidden = false;
            const accept = document.createElement('span');
            accept.className = 'tag-suggest-chip bookmark-form-feed-offer-chip';
            accept.dataset.feedOffer = pending ? 'pending' : 'offer';
            const label = pending
                ? t('dashboard.feedOfferPending', 'Will watch after saving')
                : t('dashboard.feedOfferFound', 'Feed found: {title} · Watch?', { title: feed.title || feed.url });
            accept.appendChild(chip(label, 'tag-suggest-chip-add', async () => {
                if (busy) return;
                if (pending) {
                    watch.setPending(url, null);
                    draw(url, feed);
                } else if (options.canWatchNow()) {
                    busy = true;
                    const result = await watch.save(url, [{ feedUrl: feed.url, intervalMinutes: OFFER_DEFAULT_MINUTES }]);
                    busy = false;
                    if (!result.ok) return;
                    offerToast(dash, options.getName() || url, OFFER_DEFAULT_MINUTES);
                    hide();
                } else {
                    watch.setPending(url, { feedUrl: feed.url, intervalMinutes: OFFER_DEFAULT_MINUTES });
                    draw(url, feed);
                }
            }, pending ? t('dashboard.feedOfferUndo', 'Do not watch this feed') : ''));
            const notNow = document.createElement('span');
            notNow.className = 'tag-suggest-chip bookmark-form-feed-offer-chip';
            notNow.dataset.feedOffer = 'refuse';
            notNow.appendChild(chip(`${t('dashboard.feedOfferNotNow', 'Not now')} ✕`, 'tag-suggest-chip-dismiss', () => {
                watch.setPending(url, null);
                offerRefuse(key);
                hide();
            }, t('dashboard.feedOfferRefuse', 'Do not offer a feed for this site again')));
            host.append(accept, notNow);
        };

        const evaluate = async () => {
            const url = String(options.getUrl() || '').trim();
            const mine = ++seq;
            if (!watch || !/^https?:\/\//i.test(url)) { hide(); return; }
            const key = watch.key(url);
            // An edit that changed the address has no saved row to hang a watch on.
            if (!key || watch.isWatched({ url }) || offerRefusals().includes(key)) { hide(); return; }
            if (!found.has(key)) {
                let first = null;
                try {
                    const data = await watch.candidates(url);
                    first = (data?.feeds || []).find((feed) => feed?.url && feed.watched !== true) || null;
                } catch { first = null; }
                found.set(key, first);
            }
            if (mine !== seq || !host.isConnected) return;
            const feed = found.get(key);
            if (feed) draw(url, feed); else hide();
        };

        hide();
        return {
            /** The page has settled: look for a feed, once per address. */
            refresh({ delay = 300 } = {}) {
                clearTimeout(timer);
                timer = setTimeout(() => { void evaluate(); }, delay);
            },
            /** The address is being typed over: drop the chip and the unsaved intent. */
            reset() {
                clearTimeout(timer);
                seq += 1;
                const url = String(options.getUrl() || '').trim();
                if (watch && url) watch.setPending(url, null);
                hide();
            },
            /** The form closed without saving: the intent goes with it. */
            discard(url) { if (watch && url) watch.setPending(url, null); },
        };
    }

    /** Save what was ticked on a bookmark that has just been created. */
    async function flushFeedOffer(dash, bookmark) {
        const watch = dash?.feedWatch;
        const url = String(bookmark?.url || '').trim();
        if (!watch || !url || !watch.hasPending(url)) return false;
        const result = await watch.flushPending(url);
        if (result?.ok) offerToast(dash, bookmark.name || url, OFFER_DEFAULT_MINUTES);
        return Boolean(result?.ok);
    }

    global.BookmarkFeedOffer = { mount: mountFeedOffer, flush: flushFeedOffer };

    global.BookmarkFormPreview = BookmarkFormPreview;
    global.BookmarkFormPreviewHtml = { buildPreviewSectionHtml, buildCompactPreviewStripHtml, escHtml };
})(typeof window !== 'undefined' ? window : globalThis);
