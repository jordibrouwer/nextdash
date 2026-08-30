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
            const showStatus = settings.showStatus === true;

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
            const iconHtml = showIcons
                ? (bookmark?.icon
                    ? `<span class="bookmark-icon-slot"><img class="bookmark-icon" src="${escHtml(iconBase + bookmark.icon)}" alt=""></span>`
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
                    iconEl.innerHTML = `<img src="${escHtml(iconBase + bookmark.icon)}" alt="">`;
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
                ${image ? `<div class="config-link-preview-card-image-wrap"><img class="config-link-preview-card-image" src="${escHtml(image)}" alt=""></div>` : ''}
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
            const feeds = global.dashboardInstance?.feeds;
            const url = String(bookmark?.url || '').trim();
            const entry = feeds?.enabled === true && url
                ? feeds.byKey?.get(feeds.key(url))
                : null;
            const feedURL = String(entry?.feedUrl || '').trim();
            if (!feedURL) {
                line.hidden = true;
                line.textContent = '';
                return;
            }
            line.hidden = false;
            line.innerHTML = `<span class="bookmark-form-feed-label">${escHtml(this.t('config.bookmarkFeedLabel', 'Feed'))}</span>`
                + `<code class="bookmark-form-feed-url">${escHtml(feedURL)}</code>`;
            line.title = this.t('config.bookmarkFeedHint',
                'Fresh reads this feed to count what has been published since you last opened the bookmark.');
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

    global.BookmarkFormPreview = BookmarkFormPreview;
    global.BookmarkFormPreviewHtml = { buildPreviewSectionHtml, buildCompactPreviewStripHtml, escHtml };
})(typeof window !== 'undefined' ? window : globalThis);
