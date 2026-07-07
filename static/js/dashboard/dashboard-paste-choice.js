/**
 * Paste URL destination chooser — bookmark vs inbox.
 */
class DashboardPasteChoice {
    constructor(dashboard) {
        this.dash = dashboard;
        this.overlay = null;
        this.pendingUrl = '';
        this._keydownHandler = null;
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

    openBookmarkModal(url) {
        const handler = this.dash.searchComponent?.commandsComponent?.newCommandHandler;
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
                        <p class="paste-choice-lead" id="paste-choice-lead"></p>
                        <div class="paste-choice-options">
                            <button type="button" class="paste-choice-card" data-paste-choice="bookmark">
                                <span class="paste-choice-card-icon" aria-hidden="true">📌</span>
                                <span class="paste-choice-card-title" id="paste-choice-bookmark-title"></span>
                                <span class="paste-choice-card-hint" id="paste-choice-bookmark-hint"></span>
                                <kbd class="paste-choice-kbd">1</kbd>
                            </button>
                            <button type="button" class="paste-choice-card" data-paste-choice="inbox">
                                <span class="paste-choice-card-icon" aria-hidden="true">📥</span>
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
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler, true);
            this._keydownHandler = null;
        }
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
