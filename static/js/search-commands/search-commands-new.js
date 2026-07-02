/**
 * Search Command: :new
 * Unified bookmark add modal (also used by QuickAdd / + / Ctrl+Shift+A)
 */

function escapeNewCommandHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeUploadedIconFilename(raw) {
    const trimmed = String(raw || '').trim();
    return /^[a-zA-Z0-9._-]+$/.test(trimmed) ? trimmed : '';
}

class SearchCommandNew {
    constructor(language = null) {
        this.language = language;
        this.modal = null;
        this.currentPageId = null;
        this.categories = [];
        this.pages = [];
        this._mouseDownTarget = null;
        this.pendingIcon = '';
        this.draftState = {};
        this.formPreview = null;
        this._userEditedIcon = false;
        this._wizardStep = 1;
    }

    setLanguage(language) {
        this.language = language;
    }

    setContext(currentPageId, categories, pages) {
        const n = Number(currentPageId);
        this.currentPageId = Number.isFinite(n) && n >= 1 ? n : 1;
        this.categories = categories;
        this.pages = pages;
    }

    t(key, fallback) {
        if (!this.language) return fallback;
        const val = this.language.t(key);
        return val !== key ? val : fallback;
    }

    notify(message, type = 'error') {
        const dash = window.dashboardInstance;
        if (dash && typeof dash.showNotification === 'function') {
            dash.showNotification(message, type);
        }
    }

    canonicalBookmarkURLKey(raw) {
        if (window.BookmarkUrlUtils) {
            return window.BookmarkUrlUtils.canonicalBookmarkURLKey(raw);
        }
        return String(raw || '').trim().toLowerCase();
    }

    duplicateBookmarkUrlMessage() {
        return this.t('config.duplicateBookmarkUrl', 'This bookmark URL already exists on this page.');
    }

    handle(args) {
        const argText = (args || []).join(' ').trim();
        return [{
            name: this.t('config.addNewBookmark', 'Create New Bookmark'),
            shortcut: ':new',
            action: () => this.openModal(argText ? { url: argText } : {}),
            type: 'command'
        }];
    }

    openModal(options = {}) {
        this._openOptions = options;
        this.createModal();
        this.showModal(options);
    }

    resetDraftState() {
        this.draftState = {
            previewTitle: '',
            previewDesc: '',
            previewImage: '',
        };
        this.pendingIcon = '';
        this._userEditedIcon = false;
    }

    getDraftBookmark() {
        const nameEl = document.getElementById('new-bookmark-name');
        const urlEl = document.getElementById('new-bookmark-url');
        const shortcutEl = document.getElementById('new-bookmark-shortcut');
        const noteEl = document.getElementById('new-bookmark-note');
        const pinnedEl = document.getElementById('new-bookmark-pinned');
        const statusEl = document.getElementById('new-bookmark-status');
        return {
            name: nameEl?.value || '',
            url: urlEl?.value || '',
            shortcut: shortcutEl?.value || '',
            note: noteEl?.value || '',
            icon: this.pendingIcon || '',
            pinned: pinnedEl?.checked || false,
            checkStatus: statusEl?.checked || false,
            previewTitle: this.draftState.previewTitle || '',
            previewDesc: this.draftState.previewDesc || '',
            previewImage: this.draftState.previewImage || '',
        };
    }

    updatePreviews() {
        const bookmark = this.getDraftBookmark();
        this.formPreview?.updateAll(bookmark);
    }

    usesMobileWizard() {
        return window.MobileExperience?.isMobileLayout?.() === true;
    }

    setWizardStep(step) {
        this._wizardStep = step === 2 ? 2 : 1;
        const modalInner = this.modal?.querySelector('.modal-new-bookmark');
        if (!modalInner) return;
        modalInner.classList.toggle('nbm-wizard-step-1', this._wizardStep === 1);
        modalInner.classList.toggle('nbm-wizard-step-2', this._wizardStep === 2);
        modalInner.querySelectorAll('.nbm-wizard-step').forEach((el) => {
            const s = parseInt(el.dataset.step, 10);
            el.classList.toggle('is-active', s === this._wizardStep);
            el.classList.toggle('is-done', s < this._wizardStep);
        });
    }

    initWizardLayout() {
        const modalInner = this.modal?.querySelector('.modal-new-bookmark');
        if (!modalInner) return;
        if (this.usesMobileWizard()) {
            modalInner.classList.add('nbm-mobile-wizard');
            const nav = modalInner.querySelector('.nbm-wizard-nav');
            if (nav) nav.removeAttribute('aria-hidden');
            this.setWizardStep(1);
        } else {
            modalInner.classList.remove('nbm-mobile-wizard', 'nbm-wizard-step-1', 'nbm-wizard-step-2');
        }
    }

    validateWizardStep1() {
        const urlInput = document.getElementById('new-bookmark-url');
        const nameInput = document.getElementById('new-bookmark-name');
        if (!urlInput?.value.trim()) {
            urlInput?.focus();
            if (typeof urlInput.reportValidity === 'function') urlInput.reportValidity();
            return false;
        }
        this.normalizeUrlField(urlInput, true);
        if (!window.BookmarkUrlUtils?.isHttpUrl(urlInput.value)) {
            this.notify(this.t('config.urlRequiredShort', 'URL required.'), 'error');
            urlInput.focus();
            return false;
        }
        if (nameInput && !String(nameInput.value || '').trim()) {
            const fallback = this.draftState.previewTitle || '';
            if (fallback) nameInput.value = fallback;
        }
        if (nameInput && !String(nameInput.value || '').trim()) {
            nameInput.focus();
            if (typeof nameInput.reportValidity === 'function') nameInput.reportValidity();
            return false;
        }
        return true;
    }

    getSelectedPageId() {
        const pageSelect = document.getElementById('new-bookmark-page');
        const pageId = parseInt(String(pageSelect?.value ?? ''), 10);
        return Number.isFinite(pageId) && pageId >= 1 ? pageId : null;
    }

    getBookmarksForPage(pageId) {
        const mgr = window.configManager;
        if (pageId == null) return [];

        if (mgr?.bookmarkStore) {
            return mgr.bookmarkStore.getPage(pageId);
        }

        const dash = window.dashboardInstance;
        if (!dash) return [];

        const samePage = Number(dash.currentPageId) === pageId || String(dash.currentPageId) === String(pageId);
        if (samePage && Array.isArray(dash.bookmarks)) return dash.bookmarks;
        return (dash.allBookmarks || []).filter((b) => Number(b.pageId) === pageId);
    }

    hasUrlDuplicateOnPage(url, pageId = null) {
        const key = this.canonicalBookmarkURLKey(url);
        if (!key) return false;
        const pid = pageId ?? this.getSelectedPageId();
        if (pid == null) return false;
        return this.getBookmarksForPage(pid).some(
            (b) => this.canonicalBookmarkURLKey(b.url) === key
        );
    }

    updateUrlDuplicateHint() {
        const urlInput = document.getElementById('new-bookmark-url');
        const urlDuplicateHint = document.getElementById('new-bookmark-url-duplicate');
        if (!urlInput || !urlDuplicateHint) return;

        const raw = String(urlInput.value || '').trim();
        const normalized = raw ? (this.normalizeUrlField(urlInput, false) || raw) : '';
        const duplicate = Boolean(normalized) && this.hasUrlDuplicateOnPage(normalized);
        urlDuplicateHint.hidden = !duplicate;
        urlInput.classList.toggle('field-conflict', Boolean(duplicate));
    }

    hasShortcutConflictOnPage(shortcut, pageId = null) {
        const normalized = String(shortcut || '').trim().toUpperCase();
        if (!normalized) return false;
        const pid = pageId ?? this.getSelectedPageId();
        if (pid == null) return false;
        return this.getBookmarksForPage(pid).some(
            (b) => String(b?.shortcut || '').trim().toUpperCase() === normalized
        );
    }

    updateShortcutConflictHint() {
        const shortcutInput = document.getElementById('new-bookmark-shortcut');
        const shortcutConflictHint = document.getElementById('new-bookmark-shortcut-conflict');
        if (!shortcutInput || !shortcutConflictHint) return;

        const normalized = String(shortcutInput.value || '').trim().toUpperCase();
        const conflict = normalized && this.hasShortcutConflictOnPage(normalized);
        shortcutConflictHint.hidden = !conflict;
        shortcutInput.classList.toggle('field-conflict', Boolean(conflict));
    }

    createModal() {
        const existingModal = document.getElementById('new-bookmark-modal');
        if (existingModal) {
            existingModal.remove();
        }

        this.resetDraftState();

        const compactStripHtml = window.BookmarkFormPreviewHtml?.buildCompactPreviewStripHtml
            ? window.BookmarkFormPreviewHtml.buildCompactPreviewStripHtml('new-bookmark', (key, fb) => this.t(key, fb))
            : '';

        const fullPreviewHtml = window.BookmarkFormPreviewHtml?.buildPreviewSectionHtml
            ? window.BookmarkFormPreviewHtml.buildPreviewSectionHtml('new-bookmark', (key, fb) => this.t(key, fb))
            : '';

        const shortcutConflictLabel = this.t('config.shortcutConflict', 'Shortcut already in use');
        const urlDuplicateLabel = this.t('config.urlConflictHint', 'This URL already exists on this page.');

        const modalHTML = `
            <div id="new-bookmark-modal" class="modal-overlay">
                <div class="modal modal-new-bookmark">
                    <div class="nbm-header">
                        <span class="nbm-title">${this.t('config.addNewBookmark', 'New Bookmark')}</span>
                        <div class="nbm-header-actions">
                            <kbd>&</kbd>
                            <button type="button" class="nbm-btn" id="new-bookmark-cancel-header" aria-label="Close">✕</button>
                        </div>
                    </div>
                    <form id="new-bookmark-form" class="new-bookmark-form">
                        <div class="nbm-wizard-nav" aria-hidden="true">
                            <span class="nbm-wizard-step is-active" data-step="1">${this.t('config.addBookmarkWizardStepLink', '1 · Link')}</span>
                            <span class="nbm-wizard-step" data-step="2">${this.t('config.addBookmarkWizardStepPlace', '2 · Place')}</span>
                        </div>
                        <div class="nbm-section nbm-wizard-step-1-panel">
                            <label class="nbm-label" for="new-bookmark-url">${this.t('config.urlLabelShort', 'URL')}</label>
                            <div class="nbm-url-row">
                                <input type="url" id="new-bookmark-url" name="url" class="nbm-input" required autocomplete="off" placeholder="https://">
                                <button type="button" class="nbm-btn" id="new-bookmark-icon-fetch">${this.t('config.fetchFaviconRetry', 'Retry')}</button>
                            </div>
                            <p id="new-bookmark-url-duplicate" class="nbm-conflict-hint nbm-url-conflict-hint" hidden>${urlDuplicateLabel}</p>
                        </div>
                        <div class="nbm-section nbm-wizard-step-1-panel">
                            <label class="nbm-label" for="new-bookmark-name">${this.t('config.bookmarkNamePlaceholder', 'Name')}</label>
                            <input type="text" id="new-bookmark-name" name="name" class="nbm-input" required autocomplete="off">
                        </div>
                        ${compactStripHtml}
                        <div class="nbm-section nbm-section-row nbm-wizard-step-2-panel">
                            <div class="nbm-col">
                                <label class="nbm-label" for="new-bookmark-page">${this.t('config.page', 'Page')}</label>
                                <select id="new-bookmark-page" name="page" class="nbm-input">
                                    ${this.generatePageOptions()}
                                </select>
                            </div>
                            <div class="nbm-col">
                                <label class="nbm-label" for="new-bookmark-category">${this.t('config.category', 'Category')}</label>
                                <select id="new-bookmark-category" name="category" class="nbm-input">
                                    <option value="">${this.t('config.noCategory', 'No category')}</option>
                                    ${this.generateCategoryOptions()}
                                </select>
                            </div>
                        </div>
                        <details class="nbm-more-options nbm-wizard-step-2-panel" id="new-bookmark-more">
                            <summary>${this.t('config.addBookmarkMoreOptions', 'More options')}</summary>
                            <div class="nbm-more-content">
                                <div class="nbm-section">
                                    <div class="nbm-shortcut-row">
                                        <label class="nbm-label" for="new-bookmark-shortcut">${this.t('config.shortcut', 'Shortcut')}</label>
                                        <input type="text" id="new-bookmark-shortcut" name="shortcut" class="nbm-input nbm-shortcut" maxlength="5" autocomplete="off" placeholder="${this.t('config.bookmarkShortcutPlaceholder', 'Y, YS, YC')}">
                                        <span id="new-bookmark-shortcut-conflict" class="nbm-conflict-hint" hidden>${shortcutConflictLabel}</span>
                                    </div>
                                </div>
                                ${fullPreviewHtml}
                                <div class="nbm-section">
                                    <label class="nbm-label">${this.t('config.icon', 'Icon')}</label>
                                    <div class="nbm-icon-row">
                                        <div id="new-bookmark-icon-preview" class="nbm-icon-preview"><span class="nbm-icon-preview-empty">—</span></div>
                                        <button type="button" class="nbm-btn nbm-icon-clear" id="new-bookmark-icon-clear" hidden aria-label="${this.t('config.clearIcon', 'Clear icon')}">✕</button>
                                        <input type="text" id="new-bookmark-icon-url" class="nbm-input" placeholder="${this.t('config.iconUrlOptional', 'Icon URL (optional)')}">
                                        <label class="nbm-btn nbm-file-label">
                                            Upload
                                            <input type="file" id="new-bookmark-icon-file" class="nbm-file-hidden" accept="image/*,.ico,.svg,.webp">
                                        </label>
                                    </div>
                                    <div id="new-bookmark-icon-fetch-state" class="nbm-icon-state"></div>
                                </div>
                                <div class="nbm-section">
                                    <label class="nbm-label" for="new-bookmark-note">${this.t('config.note', 'Note')}</label>
                                    <textarea id="new-bookmark-note" name="note" class="nbm-input nbm-note" rows="2"></textarea>
                                </div>
                                <div class="nbm-section">
                                    <label class="nbm-label" for="new-bookmark-tags">Tags <span class="nbm-label-hint">comma-separated</span></label>
                                    <input type="text" id="new-bookmark-tags" name="tags" class="nbm-input" placeholder="work, dev, personal…" autocomplete="off" spellcheck="false">
                                </div>
                                <div class="nbm-section nbm-section-toggles">
                                    <label class="nbm-toggle-label">
                                        <input type="checkbox" id="new-bookmark-pinned" name="pinned">
                                        <span>${this.t('config.pinnedShort', 'Pinned')}</span>
                                    </label>
                                    <label class="nbm-toggle-label">
                                        <input type="checkbox" id="new-bookmark-status" name="checkStatus">
                                        <span>${this.t('config.status', 'Status check')}</span>
                                    </label>
                                </div>
                            </div>
                        </details>
                        <div class="nbm-footer">
                            <button type="button" class="nbm-btn nbm-btn-secondary nbm-wizard-only" id="new-bookmark-wizard-back">${this.t('config.addBookmarkWizardBack', 'Back')}</button>
                            <button type="button" class="nbm-btn nbm-btn-secondary" id="new-bookmark-cancel">${this.t('config.cancel', 'Cancel')}</button>
                            <button type="button" class="nbm-btn nbm-btn-primary nbm-wizard-only" id="new-bookmark-wizard-next">${this.t('config.addBookmarkWizardNext', 'Next')}</button>
                            <button type="button" class="nbm-btn nbm-btn-primary" id="new-bookmark-create">${this.t('config.create', 'Add Bookmark')}</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('new-bookmark-modal');

        if (window.BookmarkFormPreview) {
            this.formPreview = new window.BookmarkFormPreview({
                prefix: 'new-bookmark',
                getSettings: () => window.dashboardInstance?.settings || window.configManager?.settingsData || {},
                t: (key, fb) => this.t(key, fb),
                notify: (msg, type) => this.notify(msg, type),
                onPreviewChange: (bookmark) => {
                    this.draftState.previewTitle = bookmark.previewTitle || '';
                    this.draftState.previewDesc = bookmark.previewDesc || '';
                    this.draftState.previewImage = bookmark.previewImage || '';
                },
            });
            this.formPreview.getBookmark = () => this.getDraftBookmark();
            this.formPreview.bind();
        }

        const pageSelectPre = document.getElementById('new-bookmark-page');
        if (pageSelectPre) {
            const want = Number(this.currentPageId);
            const match = [...pageSelectPre.options].find((o) => Number(o.value) === want);
            if (match) pageSelectPre.value = match.value;
        }

        this.setupEventListeners();
        this.syncIconPreview('');

        const pageSelectPost = document.getElementById('new-bookmark-page');
        if (pageSelectPost) {
            const pid = parseInt(String(pageSelectPost.value), 10);
            if (Number.isFinite(pid)) void this.updateCategoriesForPage(pid);
        }

        this.initWizardLayout();
        this.updateShortcutConflictHint();
        this.updateUrlDuplicateHint();
    }

    generatePageOptions() {
        if (!this.pages || this.pages.length === 0) {
            return `<option value="1">${this.t('dashboard.defaultPageTitle', 'Dashboard')}</option>`;
        }
        const currentId = Number(this.currentPageId);
        return this.pages.map(page => {
            const isCurrentPage = Number(page.id) === currentId;
            const pageName = this.language ? this.language.t(page.name) || page.name : page.name;
            return `<option value="${escapeNewCommandHtml(page.id)}" ${isCurrentPage ? 'selected' : ''}>${escapeNewCommandHtml(pageName)}</option>`;
        }).join('');
    }

    generateCategoryOptions() {
        if (!this.categories || this.categories.length === 0) return '';
        return this.categories.map(category => `<option value="${escapeNewCommandHtml(category.id)}">${escapeNewCommandHtml(category.name)}</option>`).join('');
    }

    async updateCategoriesForPage(pageId) {
        try {
            const response = await fetch(`/api/categories?page=${pageId}`);
            if (!response.ok) return;
            const categories = await response.json();
            this.categories = categories.map(cat => ({
                ...cat,
                name: this.language ? this.language.t(cat.name) || cat.name : cat.name
            }));
            const categorySelect = document.getElementById('new-bookmark-category');
            if (!categorySelect) return;
            const currentValue = categorySelect.value;
            if (categorySelect.__customSelectInstance) {
                try {
                    categorySelect.__customSelectInstance.destroy();
                    categorySelect.__customSelectInstance = null;
                    delete categorySelect.dataset.customSelectInit;
                } catch (e) {
                    console.error('Error destroying custom select:', e);
                }
            }
            categorySelect.innerHTML = `
                <option value="">${this.t('config.noCategory', 'No category')}</option>
                ${this.generateCategoryOptions()}
            `;
            if (currentValue && this.categories.find(cat => cat.id === currentValue)) {
                categorySelect.value = currentValue;
            }
            if (typeof CustomSelect !== 'undefined') {
                const instance = new CustomSelect(categorySelect);
                categorySelect.__customSelectInstance = instance;
                categorySelect.dataset.customSelectInit = 'true';
            }
        } catch (error) {
            console.error('Error loading categories for page:', error);
        }
    }

    normalizeUrlField(urlInput, writeBack = true) {
        if (!urlInput) return '';
        const normalized = window.BookmarkUrlUtils?.ensureHttpUrl(urlInput.value) || urlInput.value.trim();
        if (writeBack && normalized && normalized !== urlInput.value.trim()) {
            urlInput.value = normalized;
        }
        return normalized;
    }

    scheduleUrlMetaFetch() {
        window.BookmarkPreviewService?.scheduleDebounced('new-bookmark-url-meta', () => {
            void this.autoFetchFromUrlField(true);
        }, 400);
    }

    async autoFetchFromUrlField(force = false) {
        const urlInput = document.getElementById('new-bookmark-url');
        const iconUrlInput = document.getElementById('new-bookmark-icon-url');
        const urlValue = this.normalizeUrlField(urlInput, true);
        if (!urlValue || !window.BookmarkUrlUtils?.isHttpUrl(urlValue)) {
            this.updatePreviews();
            return;
        }

        if (!force && (this._userEditedIcon || this._autoFetchInFlight)) return;
        if (!force && iconUrlInput && String(iconUrlInput.value || '').trim()) return;
        if (!force && this.pendingIcon) return;

        this._autoFetchInFlight = true;
        this.setModalIconFetchState(this.t('config.iconFetching', 'Fetching...'));
        const icon = await window.BookmarkPreviewService.fetchAndUploadFavicon(urlValue);
        this._autoFetchInFlight = false;

        if (icon && !this._userEditedIcon) {
            this.pendingIcon = icon;
            if (iconUrlInput) iconUrlInput.value = `/data/icons/${icon}`;
            this.syncIconPreview(icon);
            this.setModalIconFetchState(this.t('config.iconFound', 'Found'));

            const nameEl = document.getElementById('new-bookmark-name');
            if (nameEl && !String(nameEl.value || '').trim()) {
                try {
                    const preview = await window.BookmarkPreviewService.fetchLinkPreview(urlValue);
                    if (preview.title) nameEl.value = preview.title;
                } catch { /* ignore */ }
            }
        } else if (!icon) {
            this.setModalIconFetchState(this.t('config.iconNotFound', 'Not found'));
        }

        this.updatePreviews();
    }

    setupEventListeners() {
        this.keyboardBlockHandler = (e) => {
            if (this.modal && this.modal.classList.contains('show')) {
                const isInsideModal = e.target.closest('#new-bookmark-modal');
                if (!isInsideModal) {
                    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', 'Tab'].includes(e.key)) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    const target = e.target;
                    const isInCustomSelect = target.classList.contains('custom-select-trigger')
                        || target.closest('.custom-select')
                        || document.querySelector('.custom-select.open');
                    const isInteractiveElement = target.tagName === 'INPUT'
                        || target.tagName === 'SELECT'
                        || target.tagName === 'TEXTAREA'
                        || target.tagName === 'BUTTON'
                        || target.type === 'checkbox';
                    if (!isInCustomSelect && !isInteractiveElement) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }
            }
        };
        document.addEventListener('keydown', this.keyboardBlockHandler, true);

        this.modal.addEventListener('keydown', (e) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.stopPropagation();
        }, false);

        this.modal.addEventListener('mousedown', (e) => { this._mouseDownTarget = e.target; });
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal && this._mouseDownTarget === this.modal) this.closeModal();
        });

        this._boundHandleKeyDown = this.handleKeyDown.bind(this);
        document.addEventListener('keydown', this._boundHandleKeyDown);

        document.getElementById('new-bookmark-page')?.addEventListener('change', async (e) => {
            await this.updateCategoriesForPage(parseInt(e.target.value, 10));
            this.updateShortcutConflictHint();
            this.updateUrlDuplicateHint();
        });

        const shortcutInput = document.getElementById('new-bookmark-shortcut');
        shortcutInput?.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
            this.updateShortcutConflictHint();
            this.updatePreviews();
        });

        ['new-bookmark-name', 'new-bookmark-note'].forEach((id) => {
            document.getElementById(id)?.addEventListener('input', () => this.updatePreviews());
        });

        document.getElementById('new-bookmark-pinned')?.addEventListener('change', () => this.updatePreviews());
        document.getElementById('new-bookmark-status')?.addEventListener('change', () => this.updatePreviews());

        const urlInput = document.getElementById('new-bookmark-url');
        urlInput?.addEventListener('input', () => {
            this.scheduleUrlMetaFetch();
            this.updateUrlDuplicateHint();
        });
        urlInput?.addEventListener('blur', () => {
            this.normalizeUrlField(urlInput, true);
            void this.autoFetchFromUrlField(false);
            this.updateUrlDuplicateHint();
        });

        const iconFileInput = document.getElementById('new-bookmark-icon-file');
        iconFileInput?.addEventListener('change', () => {
            document.getElementById('new-bookmark-icon-url').value = '';
            this.pendingIcon = '';
            this._userEditedIcon = true;
            this.syncIconPreview('');
            this.setModalIconFetchState('');
            this.updatePreviews();
        });

        const iconUrlInput = document.getElementById('new-bookmark-icon-url');
        iconUrlInput?.addEventListener('input', () => {
            this.pendingIcon = '';
            this._userEditedIcon = true;
        });

        document.getElementById('new-bookmark-icon-clear')?.addEventListener('click', () => {
            if (iconUrlInput) iconUrlInput.value = '';
            if (iconFileInput) iconFileInput.value = '';
            this.pendingIcon = '';
            this._userEditedIcon = false;
            this.syncIconPreview('');
            this.setModalIconFetchState('');
            this.updatePreviews();
        });

        document.getElementById('new-bookmark-icon-fetch')?.addEventListener('click', async () => {
            const urlValue = this.normalizeUrlField(urlInput, true);
            if (!urlValue) {
                this.notify(this.t('config.urlRequiredShort', 'URL required.'), 'error');
                return;
            }
            this._userEditedIcon = false;
            await this.autoFetchFromUrlField(true);
        });

        document.getElementById('new-bookmark-create')?.addEventListener('click', () => this.createBookmark());
        document.getElementById('new-bookmark-cancel')?.addEventListener('click', () => this.closeModal());
        document.getElementById('new-bookmark-cancel-header')?.addEventListener('click', () => this.closeModal());

        document.getElementById('new-bookmark-wizard-next')?.addEventListener('click', () => {
            if (!this.validateWizardStep1()) return;
            void this.autoFetchFromUrlField(false);
            this.setWizardStep(2);
            document.getElementById('new-bookmark-page')?.focus();
        });

        document.getElementById('new-bookmark-wizard-back')?.addEventListener('click', () => {
            this.setWizardStep(1);
            document.getElementById('new-bookmark-url')?.focus();
        });

        document.getElementById('new-bookmark-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.createBookmark();
        });

        this._modalCustomSelects = [];
        this.modal.querySelectorAll('select').forEach(select => {
            if (typeof CustomSelect !== 'undefined') {
                const instance = new CustomSelect(select);
                select.__customSelectInstance = instance;
                this._modalCustomSelects.push(instance);
            }
        });

        const tagsInput = document.getElementById('new-bookmark-tags');
        if (tagsInput && typeof TagAutocomplete !== 'undefined') {
            const dash = window.dashboardInstance;
            const pool = new Set();
            (dash?.allBookmarks?.length ? dash.allBookmarks : dash?.bookmarks ?? [])
                .forEach(bm => (bm.tags || []).forEach(tg => pool.add(tg.toLowerCase())));
            TagAutocomplete.attach(tagsInput, () => {
                tagsInput.value.split(',').map(tg => tg.trim().toLowerCase()).filter(Boolean).forEach(tg => pool.add(tg));
                return [...pool];
            });
        }

        if (this.formPreview) {
            const refreshBtn = document.getElementById('new-bookmark-link-preview-refresh-btn');
            const clearBtn = document.getElementById('new-bookmark-link-preview-clear-btn');
            refreshBtn?.addEventListener('click', async () => {
                const bookmark = this.getDraftBookmark();
                this.normalizeUrlField(urlInput, true);
                bookmark.url = urlInput?.value || bookmark.url;
                const ok = await this.formPreview.refreshLinkPreview(bookmark);
                if (ok) {
                    this.draftState.previewTitle = bookmark.previewTitle || '';
                    this.draftState.previewDesc = bookmark.previewDesc || '';
                    this.draftState.previewImage = bookmark.previewImage || '';
                    this.updatePreviews();
                }
            });
            clearBtn?.addEventListener('click', () => {
                const bookmark = this.getDraftBookmark();
                this.formPreview.clearLinkPreview(bookmark);
                this.draftState.previewTitle = '';
                this.draftState.previewDesc = '';
                this.draftState.previewImage = '';
                this.updatePreviews();
            });
        }
    }

    handleKeyDown(e) {
        if (e.key === 'Escape' && this.modal?.classList.contains('show')) {
            this.closeModal();
        }
    }

    showModal(options = {}) {
        if (!this.modal) return;
        this.modal.classList.add('show');
        document.body.style.overflow = 'hidden';

        const urlInput = document.getElementById('new-bookmark-url');
        const nameInput = document.getElementById('new-bookmark-name');
        const opts = options.url ? options : (this._openOptions || {});

        if (opts.url && urlInput) {
            urlInput.value = window.BookmarkUrlUtils?.ensureHttpUrl(opts.url) || opts.url;
            void this.autoFetchFromUrlField(true);
        }
        if (opts.name && nameInput) {
            nameInput.value = opts.name;
        }

        this.updatePreviews();
        this.updateShortcutConflictHint();
        this.updateUrlDuplicateHint();

        setTimeout(() => {
            if (opts.url && urlInput) {
                urlInput.focus();
                urlInput.select();
            } else if (this.usesMobileWizard()) {
                urlInput?.focus();
            } else {
                urlInput?.focus();
            }
        }, 100);
    }

    closeModal() {
        if (!this.modal) return;
        window.BookmarkPreviewService?.cancelDebounced('new-bookmark-url-meta');

        const tagsInput = document.getElementById('new-bookmark-tags');
        if (tagsInput && typeof TagAutocomplete !== 'undefined') TagAutocomplete.detach(tagsInput);

        this.modal.classList.remove('show');
        document.body.style.overflow = '';

        if (this.keyboardBlockHandler) document.removeEventListener('keydown', this.keyboardBlockHandler, true);
        if (this._boundHandleKeyDown) {
            document.removeEventListener('keydown', this._boundHandleKeyDown);
            this._boundHandleKeyDown = null;
        }
        if (this._modalCustomSelects) {
            this._modalCustomSelects.forEach((cs) => {
                try {
                    cs.destroy();
                } catch (error) {
                    console.warn('Error destroying modal custom select:', error);
                }
            });
            this._modalCustomSelects = [];
        }

        setTimeout(() => {
            if (this.modal) {
                this.modal.remove();
                this.modal = null;
            }
            this.formPreview = null;
            this._openOptions = null;
        }, 200);
    }

    async createBookmark() {
        const form = document.getElementById('new-bookmark-form');
        const nameEl = document.getElementById('new-bookmark-name');
        if (nameEl && !String(nameEl.value || '').trim()) {
            const fallback = this.draftState.previewTitle || '';
            if (fallback) nameEl.value = fallback;
        }
        if (!form?.checkValidity()) {
            form.reportValidity();
            return { ok: false };
        }

        const urlInput = document.getElementById('new-bookmark-url');
        const normalizedUrl = this.normalizeUrlField(urlInput, true);

        const formData = new FormData(form);
        const pageSelectEl = document.getElementById('new-bookmark-page');
        const pageId = parseInt(String(pageSelectEl?.value ?? formData.get('page') ?? ''), 10);

        const shortcut = String(formData.get('shortcut') || '').trim().toUpperCase();
        if (shortcut && this.hasShortcutConflictOnPage(shortcut, pageId)) {
            this.updateShortcutConflictHint();
            this.notify(this.t('config.shortcutConflict', 'Shortcut already in use'), 'error');
            return { ok: false };
        }

        if (normalizedUrl && this.hasUrlDuplicateOnPage(normalizedUrl, pageId)) {
            this.updateUrlDuplicateHint();
            this.notify(this.duplicateBookmarkUrlMessage(), 'error');
            return { ok: false };
        }

        const iconFile = document.getElementById('new-bookmark-icon-file')?.files?.[0];
        const iconUrl = (document.getElementById('new-bookmark-icon-url')?.value || '').trim();
        const icon = await this.resolveIconValue(iconFile, iconUrl);
        if (icon === null) return { ok: false };

        const rawTags = String(formData.get('tags') || '');
        const tags = rawTags.split(',').map(t => t.trim().toLowerCase()).filter((t, i, arr) => t && arr.indexOf(t) === i);

        const categorySelect = document.getElementById('new-bookmark-category');
        const categoryValue = String(categorySelect?.value ?? formData.get('category') ?? '').trim();

        const bookmark = {
            name: formData.get('name').trim(),
            url: normalizedUrl,
            note: (formData.get('note') || '').trim(),
            shortcut: formData.get('shortcut').trim().toUpperCase(),
            category: categoryValue,
            pinned: formData.get('pinned') === 'on',
            checkStatus: formData.get('checkStatus') === 'on',
            tags,
            icon,
            createdAt: Date.now(),
        };

        if (this.draftState.previewTitle) bookmark.previewTitle = this.draftState.previewTitle;
        if (this.draftState.previewDesc) bookmark.previewDesc = this.draftState.previewDesc;
        if (this.draftState.previewImage) bookmark.previewImage = this.draftState.previewImage;

        if (!Number.isFinite(pageId) || pageId < 1) {
            this.notify(this.t('config.errorCreatingBookmark', 'Invalid page selected.'), 'error');
            return { ok: false };
        }

        const urlKey = this.canonicalBookmarkURLKey(bookmark.url);
        const dash = window.dashboardInstance;
        if (dash && urlKey) {
            const samePage = Number(dash.currentPageId) === pageId || String(dash.currentPageId) === String(pageId);
            const pool = samePage
                ? (dash.bookmarks || [])
                : (dash.allBookmarks || []).filter((b) => Number(b.pageId) === pageId);
            if (pool.some((b) => this.canonicalBookmarkURLKey(b.url) === urlKey)) {
                this.notify(this.duplicateBookmarkUrlMessage(), 'error');
                return { ok: false };
            }
        }

        try {
            const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pageId, bookmark })
            });

            if (response.ok) {
                try {
                    this.closeModal();
                } catch (error) {
                    console.warn('Error closing new-bookmark modal after save:', error);
                }
                this.pendingIcon = '';
                if (window.dashboardInstance?.data?.refreshAfterBookmarkAdded) {
                    await window.dashboardInstance.data.refreshAfterBookmarkAdded(pageId);
                } else if (window.dashboardInstance) {
                    await window.dashboardInstance.loadAllBookmarks();
                    if (Number(pageId) === Number(window.dashboardInstance.currentPageId)) {
                        await window.dashboardInstance.loadPageBookmarks(pageId, { forceFetch: true });
                    }
                }
                this.notify(this.t('config.bookmarkCreated', 'Bookmark created successfully!'), 'success');
                return { ok: true, pageId, bookmark: { ...bookmark, pageId } };
            } else if (response.status === 409) {
                let conflictMessage = this.duplicateBookmarkUrlMessage();
                const raw = await response.text();
                if (raw) {
                    try {
                        const errorBody = JSON.parse(raw);
                        if (errorBody?.error === 'duplicate_shortcut') {
                            conflictMessage = `Duplicate shortcut "${errorBody.shortcut}".`;
                        }
                    } catch {
                        if (raw.includes('Duplicate bookmark URL')) conflictMessage = this.duplicateBookmarkUrlMessage();
                    }
                }
                this.notify(conflictMessage, 'error');
            } else {
                this.notify(this.t('config.errorCreatingBookmark', 'Error creating bookmark'), 'error');
            }
        } catch (error) {
            console.error('Error creating bookmark:', error);
            this.notify(this.t('config.errorCreatingBookmark', 'Error creating bookmark'), 'error');
        }
        return { ok: false };
    }

    async resolveIconValue(iconFile, iconUrl) {
        if (iconFile) {
            const uploadedIcon = await this.uploadIconFile(iconFile);
            if (!uploadedIcon) {
                this.notify(this.t('config.iconUploadFailed', 'Icon upload failed.'), 'error');
                return null;
            }
            return uploadedIcon;
        }
        if (iconUrl) {
            if (iconUrl.startsWith('/data/icons/')) return iconUrl.replace('/data/icons/', '').trim();
            const remoteIcon = await window.BookmarkPreviewService.uploadIconFromUrl(iconUrl);
            if (!remoteIcon) {
                this.notify(this.t('config.iconUrlInvalid', 'Icon URL invalid.'), 'error');
                return null;
            }
            return remoteIcon;
        }
        if (this.pendingIcon) return this.pendingIcon;
        return '';
    }

    syncIconPreview(icon) {
        const previewEl = document.getElementById('new-bookmark-icon-preview');
        const clearBtn = document.getElementById('new-bookmark-icon-clear');
        if (!previewEl) return;
        previewEl.innerHTML = '';
        const safeIcon = safeUploadedIconFilename(icon);
        if (safeIcon) {
            const img = document.createElement('img');
            img.src = `/data/icons/${safeIcon}`;
            img.alt = '';
            previewEl.appendChild(img);
        } else {
            const empty = document.createElement('span');
            empty.className = 'nbm-icon-preview-empty';
            empty.textContent = '—';
            previewEl.appendChild(empty);
        }
        if (clearBtn) clearBtn.hidden = !safeIcon;
    }

    setModalIconFetchState(text) {
        const stateEl = document.getElementById('new-bookmark-icon-fetch-state');
        if (stateEl) stateEl.textContent = text;
    }

    async uploadIconFile(file) {
        const formData = new FormData();
        formData.append('icon', file);
        try {
            const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/icon', { method: 'POST', body: formData });
            if (!response.ok) return '';
            const result = await response.json();
            return result.icon || '';
        } catch {
            return '';
        }
    }
}

window.SearchCommandNew = SearchCommandNew;
