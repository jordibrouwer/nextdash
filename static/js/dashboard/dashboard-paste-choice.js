/**
 * Paste URL destination chooser — bookmark vs inbox.
 */
class DashboardPasteChoice {
    constructor(dashboard) {
        this.dash = dashboard;
        this.overlay = null;
        this.pendingUrl = '';
        this._keydownHandler = null;
        this._previewAbort = null;
        this._previewTimer = 0;
        this._previewSeq = 0;
    }

    t(key, fallback, params) {
        const d = this.dash;
        if (params && typeof d.formatDashboardLabel === 'function') {
            return d.formatDashboardLabel(key, params, fallback);
        }
        const raw = d.language?.t?.(key);
        return raw && raw !== key ? raw : fallback;
    }

    getEffectiveDestination() {
        const d = this.dash;
        const setting = String(d.settings?.pasteDestination || 'ask').toLowerCase();
        if (setting === 'bookmark' || setting === 'inbox') {
            return setting;
        }
        try {
            const stored = localStorage.getItem('nextdash:paste-destination-v1');
            if (stored === 'bookmark' || stored === 'inbox') {
                return stored;
            }
        } catch {
            // ignore
        }
        return 'ask';
    }

    rememberDestination(value) {
        try {
            localStorage.setItem('nextdash:paste-destination-v1', value);
        } catch {
            // ignore
        }
    }

    isEnabled() {
        const d = this.dash;
        if (d.settings?.pasteUrlQuickAdd === false) {
            return false;
        }
        if (d.settings?.inboxEnabled === false) {
            return false;
        }
        return true;
    }

    handlePasteUrl(url) {
        const trimmed = String(url || '').trim();
        if (!trimmed) {
            return;
        }
        const destination = this.getEffectiveDestination();
        if (destination === 'bookmark') {
            this.openBookmarkModal(trimmed);
            return;
        }
        if (destination === 'inbox') {
            void this.dash.inbox?.addFromUrl?.(trimmed, { source: 'paste' });
            return;
        }
        this.openChoiceModal(trimmed);
    }

    async openBookmarkModal(url) {
        const handler = this.dash.searchComponent?.commandsComponent?.newCommandHandler
            || await this.dash.newBookmarkHandler?.();
        if (!handler) {
            this.dash.showNotification(
                this.t('dashboard.pasteUrlHint', 'Paste a URL to directly create a bookmark.'),
                'info',
                { duration: 4000 }
            );
            return;
        }
        handler.openModal({ url });
    }

    ensureModal() {
        if (this.overlay) {
            return;
        }
        const html = `
            <div id="paste-choice-modal" class="modal-overlay paste-choice-overlay" aria-hidden="true">
                <div class="modal paste-choice-modal" role="dialog" aria-modal="true" aria-labelledby="paste-choice-title">
                    <div class="modal-header">
                        <span class="modal-title" id="paste-choice-title"></span>
                    </div>
                    <div class="modal-body">
                        <div class="paste-choice-url" id="paste-choice-url" aria-live="polite"></div>
                        <!--
                            What the link is, while the choice is still open.
                            Filled from /api/bookmark-preview, the same answer
                            the hover card draws; the picture is the local
                            copy under /data/preview-images/, never the remote
                            address. Hidden when there is nothing to show.
                        -->
                        <div class="paste-choice-preview" id="paste-choice-preview" hidden>
                            <div class="paste-choice-preview-text">
                                <div class="paste-choice-preview-head">
                                    <img class="paste-choice-preview-fav" alt="" decoding="async" hidden>
                                    <span class="paste-choice-preview-domain"></span>
                                </div>
                                <div class="paste-choice-preview-title"></div>
                                <div class="paste-choice-preview-desc"></div>
                            </div>
                            <div class="paste-choice-preview-thumb" hidden>
                                <img alt="" decoding="async">
                            </div>
                        </div>
                        <p class="paste-choice-lead" id="paste-choice-lead"></p>
                        <!--
                            The two marks are the app's own: the plus the Add
                            bookmark button in the header carries, and the tray
                            the inbox tab carries. An emoji was neither -- it
                            came from the system's font, changed shape per
                            platform, and matched nothing else on the screen.
                        -->
                        <div class="paste-choice-options">
                            <button type="button" class="paste-choice-card" data-paste-choice="bookmark">
                                <span class="paste-choice-card-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                                        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                                        aria-hidden="true" focusable="false">
                                        <path d="M5 12h14M12 5v14"/>
                                    </svg>
                                </span>
                                <span class="paste-choice-card-title" id="paste-choice-bookmark-title"></span>
                                <span class="paste-choice-card-hint" id="paste-choice-bookmark-hint"></span>
                                <kbd class="paste-choice-kbd">1</kbd>
                            </button>
                            <button type="button" class="paste-choice-card" data-paste-choice="inbox">
                                <span class="paste-choice-card-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                                        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                                        aria-hidden="true" focusable="false">
                                        <path d="M4 14h4l1.5 2.5h5L16 14h4"/>
                                        <path d="M4 14v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>
                                        <path d="M12 4v6m0 0l-2.5-2.5M12 10l2.5-2.5"/>
                                    </svg>
                                </span>
                                <span class="paste-choice-card-title" id="paste-choice-inbox-title"></span>
                                <span class="paste-choice-card-hint" id="paste-choice-inbox-hint"></span>
                                <kbd class="paste-choice-kbd">2</kbd>
                            </button>
                        </div>
                        <label class="paste-choice-remember">
                            <input type="checkbox" id="paste-choice-remember">
                            <span id="paste-choice-remember-label"></span>
                        </label>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="modal-button" id="paste-choice-cancel">
                            <span class="modal-button-name"></span>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        this.overlay = document.getElementById('paste-choice-modal');
        this.overlay.querySelector('[data-paste-choice="bookmark"]')
            ?.addEventListener('click', () => this.choose('bookmark'));
        this.overlay.querySelector('[data-paste-choice="inbox"]')
            ?.addEventListener('click', () => this.choose('inbox'));
        this.overlay.querySelector('#paste-choice-cancel')
            ?.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });
    }

    localize() {
        if (!this.overlay) {
            return;
        }
        const set = (id, key, fallback) => {
            const el = this.overlay.querySelector(`#${id}`);
            if (el) {
                el.textContent = this.t(key, fallback);
            }
        };
        set('paste-choice-title', 'dashboard.pasteChoiceTitle', 'Save this link');
        set('paste-choice-lead', 'dashboard.pasteChoiceLead', 'What would you like to do?');
        set('paste-choice-bookmark-title', 'dashboard.pasteChoiceBookmark', 'Add bookmark');
        set('paste-choice-bookmark-hint', 'dashboard.pasteChoiceBookmarkHint', 'Full form — page, category, shortcut');
        set('paste-choice-inbox-title', 'dashboard.pasteChoiceInbox', 'Save to Inbox');
        set('paste-choice-inbox-hint', 'dashboard.pasteChoiceInboxHint', 'Quick save for later');
        set('paste-choice-remember-label', 'dashboard.pasteChoiceRemember', 'Remember my choice');
        const cancel = this.overlay.querySelector('#paste-choice-cancel .modal-button-name');
        if (cancel) {
            cancel.textContent = this.t('dashboard.cancel', 'Cancel');
        }
    }

    openChoiceModal(url) {
        this.ensureModal();
        this.localize();
        this.pendingUrl = url;
        const urlEl = this.overlay.querySelector('#paste-choice-url');
        if (urlEl) {
            const display = this.dash.inbox?.formatUrlDisplay?.(url) || url;
            urlEl.textContent = display;
            urlEl.title = url;
        }
        const remember = this.overlay.querySelector('#paste-choice-remember');
        if (remember) {
            remember.checked = false;
        }
        this.overlay.classList.add('show');
        this.overlay.setAttribute('aria-hidden', 'false');
        this.loadPreview(url);
        this._keydownHandler = (e) => {
            if (!this.overlay?.classList.contains('show')) {
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
                return;
            }
            if (e.key === '1' || e.key.toLowerCase() === 'b') {
                e.preventDefault();
                this.choose('bookmark');
                return;
            }
            if (e.key === '2' || e.key.toLowerCase() === 'i') {
                e.preventDefault();
                this.choose('inbox');
            }
        };
        document.addEventListener('keydown', this._keydownHandler, true);
        this.overlay.querySelector('[data-paste-choice="bookmark"]')?.focus();
    }

    close() {
        if (!this.overlay) {
            return;
        }
        this.overlay.classList.remove('show');
        this.overlay.setAttribute('aria-hidden', 'true');
        this.pendingUrl = '';
        this.resetPreview();
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler, true);
            this._keydownHandler = null;
        }
    }

    /*
     * Stop whatever preview is in flight and empty the card.
     *
     * The sequence number is what keeps a slow answer out of the wrong modal:
     * aborting covers the fetch, but not a response already being parsed, and
     * not the one-shot refill timer.
     */
    resetPreview() {
        this._previewSeq += 1;
        this._previewAbort?.abort();
        this._previewAbort = null;
        window.clearTimeout(this._previewTimer);
        this._previewTimer = 0;
        const box = this.overlay?.querySelector('#paste-choice-preview');
        if (box) {
            box.hidden = true;
            box.classList.remove('is-loading');
        }
    }

    async fetchPreview(url, seq) {
        const controller = new AbortController();
        this._previewAbort = controller;
        try {
            const response = await dashFetch(
                `/api/bookmark-preview?url=${encodeURIComponent(url)}`,
                { signal: controller.signal }
            );
            if (!response.ok) return null;
            const preview = await response.json();
            return seq === this._previewSeq ? preview : null;
        } catch {
            return null;
        }
    }

    async loadPreview(url) {
        this.resetPreview();
        const seq = this._previewSeq;
        const box = this.overlay?.querySelector('#paste-choice-preview');
        if (!box || !/^https?:\/\//i.test(url)) return;
        this.paintPreview(box, { url }, { loading: true });
        const preview = await this.fetchPreview(url, seq);
        if (seq !== this._previewSeq) return;
        if (!this.paintPreview(box, preview)) return;
        // The picture is fetched in the background on the first ask, so the
        // first answer often names a source and no file yet. Ask once more,
        // as the hover card does; never on a loop.
        const helper = this.dash.preview;
        if (helper?.previewMediaPending?.(preview)) {
            this._previewTimer = window.setTimeout(async () => {
                const fresh = await this.fetchPreview(url, seq);
                if (fresh && seq === this._previewSeq) this.paintPreview(box, fresh);
            }, 1200);
        }
    }

    /** Draws the card; returns false when there is nothing worth showing. */
    paintPreview(box, preview, { loading = false } = {}) {
        const helper = this.dash.preview;
        const decode = (v) => String(helper?.decodeEntities?.(v || '') ?? v ?? '').trim();
        const title = loading ? '' : decode(preview?.title);
        const desc = loading ? '' : decode(preview?.description);
        const image = loading ? '' : (helper?.resolvePreviewImageSrc?.(preview?.image) || '');
        if (!loading && !title && !desc && !image) {
            box.hidden = true;
            box.classList.remove('is-loading');
            return false;
        }
        box.classList.toggle('is-loading', loading);
        const domain = loading ? '' : (decode(preview?.siteName)
            || String(preview?.domain || '').trim());
        box.querySelector('.paste-choice-preview-domain').textContent = domain;
        box.querySelector('.paste-choice-preview-title').textContent = title;
        box.querySelector('.paste-choice-preview-desc').textContent = desc;

        const fav = box.querySelector('.paste-choice-preview-fav');
        const icon = loading ? '' : (helper?.resolvePreviewIconSrc?.(preview?.icon) || '');
        fav.hidden = !icon;
        if (icon) fav.src = icon;
        else fav.removeAttribute('src');

        const thumb = box.querySelector('.paste-choice-preview-thumb');
        const img = thumb.querySelector('img');
        thumb.hidden = !loading && !image;
        if (image) img.src = image;
        else img.removeAttribute('src');
        box.hidden = false;
        return true;
    }

    choose(destination) {
        const url = this.pendingUrl;
        const remember = this.overlay?.querySelector('#paste-choice-remember')?.checked === true;
        this.close();
        if (!url) {
            return;
        }
        if (remember && (destination === 'bookmark' || destination === 'inbox')) {
            this.rememberDestination(destination);
        }
        if (destination === 'inbox') {
            void this.dash.inbox?.addFromUrl?.(url, { source: 'paste' });
            return;
        }
        this.openBookmarkModal(url);
    }
}
