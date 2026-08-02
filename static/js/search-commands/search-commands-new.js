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
    /**
     * The monitor cadences, matching the bookmark editor's list in config.html.
     * Kept as data so the two only differ if someone means them to.
     */
    static MONITOR_INTERVALS = [
        { minutes: 5, fallback: '5m' },
        { minutes: 15, fallback: '15m' },
        { minutes: 30, fallback: '30m' },
        { minutes: 60, fallback: '1h' },
        { minutes: 360, fallback: '6h' },
        { minutes: 1440, fallback: '24h' },
    ];

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
        // Edit mode: set by openModal({ mode: 'edit', … }) and read by every
        // branch that has to behave differently from a create. Null means the
        // modal is doing what it has always done — adding a new bookmark.
        this.editTarget = null;
    }

    /** True while the modal is editing an existing bookmark rather than adding one. */
    isEditMode() {
        return this.editTarget != null;
    }

    setLanguage(language) {
        this.language = language;
    }

    setContext(currentPageId, categories, pages) {
        const n = Number(currentPageId);
        this.currentPageId = Number.isFinite(n) && n >= 1 ? n : 1;
        this.categories = categories;
        this.pages = pages;
        // Deliberate choice: the next openModal keeps this page instead of
        // following the dashboard. Consumed once, so a later open is free again.
        this._contextPinned = true;
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

    /** Fallback label when a bookmark has no stored name (matches the dashboard row title). */
    defaultBookmarkDisplayName(bookmarkOrUrl) {
        const bm = bookmarkOrUrl && typeof bookmarkOrUrl === 'object' ? bookmarkOrUrl : null;
        const url = bm ? bm.url : bookmarkOrUrl;
        const stored = String(bm?.name || '').trim();
        if (stored) return stored;
        const preview = String(bm?.previewTitle || this.draftState?.previewTitle || '').trim();
        if (preview) return preview;
        const raw = String(url || '').trim();
        if (!raw) return '';
        try {
            const parsed = new URL(window.BookmarkUrlUtils?.ensureHttpUrl?.(raw) || raw);
            const host = parsed.hostname.replace(/^www\./i, '');
            const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
            return `${host}${path}`;
        } catch {
            return raw;
        }
    }

    /** Fill an empty name from preview title or URL before HTML5 validation runs. */
    ensureBookmarkNameBeforeSubmit() {
        const nameEl = document.getElementById('new-bookmark-name');
        if (!nameEl || String(nameEl.value || '').trim()) return;
        const urlInput = document.getElementById('new-bookmark-url');
        const fallback = this.defaultBookmarkDisplayName({
            url: this.normalizeUrlField(urlInput, false) || urlInput?.value,
            previewTitle: this.draftState.previewTitle,
            name: this.editTarget?.bookmark?.name,
        });
        if (fallback) nameEl.value = fallback;
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

    /**
     * Open the bookmark form.
     *
     * Two modes share one form. The default adds a bookmark. Passing
     * `{ mode: 'edit', pageId, index, bookmark }` instead loads that bookmark's
     * fields and saves back over it, so callers that already have a bookmark —
     * the health view's Edit, and the inline editor this is meant to replace —
     * get the same markup, styling and validation as the add flow rather than a
     * second form to keep in step.
     */
    openModal(options = {}) {
        // Tracked here rather than at the call sites: the modal is opened from the
        // `+` key, the toolbar, the empty state, the `:new` command and config, and
        // every one of those funnels through this method.
        const editing = options.mode === 'edit' && options.bookmark != null;
        window.nextdashTrack?.(editing ? 'modal:edit-bookmark' : 'modal:new-bookmark');
        this.editTarget = editing
            ? {
                pageId: Number(options.pageId),
                index: Number.isFinite(Number(options.index)) ? Number(options.index) : null,
                originalUrl: String(options.bookmark.url || ''),
                bookmark: { ...options.bookmark },
                onSaved: typeof options.onSaved === 'function' ? options.onSaved : null,
            }
            : null;
        // Refresh the Page/Category context here rather than trusting the caller.
        // Only `:new`, quick-add and config set it on the way past; the inbox
        // promote, the paste-a-URL prompt, the search hint, the toolbar button and
        // the empty state all called straight in, so the dropdowns rendered from
        // whatever the previous caller left behind — and on a fresh load from
        // nothing, which falls back to one hardcoded "Dashboard" option and hides
        // every real page. Callers may still pre-set a page (config picks the one
        // being edited), so an explicit context is only refreshed, never replaced.
        this.syncContextFromDashboard();
        this._openOptions = options;
        this.createModal();
        this.showModal(options);
    }

    /**
     * Pull pages, categories and the current page id off the dashboard.
     *
     * A caller that sets a page deliberately still wins: config opens this modal
     * pointing at the page it is editing, which is not the page the dashboard is
     * showing. setContext marks that by setting _contextPinned, which one
     * openModal consumes; everything else follows the dashboard, so switching
     * page and then adding a bookmark files it where you are looking.
     */
    syncContextFromDashboard() {
        const d = window.dashboardInstance;
        if (!d) return;
        const pages = Array.isArray(d.pages) ? d.pages : [];
        const categories = Array.isArray(d.categories) ? d.categories : [];
        if (pages.length) this.pages = pages;
        if (categories.length) this.categories = categories;
        if (this._contextPinned) {
            this._contextPinned = false;
            return;
        }
        const n = Number(d.currentPageId);
        this.currentPageId = Number.isFinite(n) && n >= 1 ? n : (Number(this.currentPageId) || 1);
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
        // CheckMode.assign turns the chosen mode into the monitor/checkStatus/
        // interval triple the server stores, so the preview and the saved record
        // cannot disagree about what "Monitor" means.
        const modeFields = window.CheckMode
            ? window.CheckMode.assign({ monitorIntervalMinutes: this.getSelectedMonitorInterval() }, this.getSelectedCheckMode())
            : { checkStatus: false, monitor: false };
        return {
            name: nameEl?.value || '',
            url: urlEl?.value || '',
            shortcut: shortcutEl?.value || '',
            note: noteEl?.value || '',
            icon: this.pendingIcon || '',
            pinned: pinnedEl?.checked || false,
            checkStatus: modeFields.checkStatus || false,
            monitor: modeFields.monitor || false,
            monitorIntervalMinutes: modeFields.monitorIntervalMinutes || 0,
            previewTitle: this.draftState.previewTitle || '',
            previewDesc: this.draftState.previewDesc || '',
            previewImage: this.draftState.previewImage || '',
        };
    }

    updatePreviews() {
        const bookmark = this.getDraftBookmark();
        this.formPreview?.updateAll(bookmark);
    }

    /** The ticked availability mode, defaulting to off. */
    getSelectedCheckMode() {
        const checked = document.querySelector('input[name="new-bookmark-check-mode"]:checked');
        return checked?.value || window.CheckMode?.OFF || 'off';
    }

    /** The chosen cadence, only meaningful while the mode is Monitor. */
    getSelectedMonitorInterval() {
        const select = document.getElementById('new-bookmark-monitor-interval');
        return Number(select?.value) || window.CheckMode?.DEFAULT_INTERVAL_MINUTES || 15;
    }

    /**
     * Show the interval only for Monitor and swap the hint under the group.
     *
     * Deliberately the same behaviour as _syncCheckMode in config-bookmarks.js,
     * reading the same `config.checkMode*Hint` keys — the two surfaces offer the
     * same choice, so they should explain it in the same words.
     */
    syncCheckMode() {
        const mode = this.getSelectedCheckMode();
        const select = document.getElementById('new-bookmark-monitor-interval');
        if (select) select.hidden = mode !== (window.CheckMode?.MONITOR || 'monitor');

        const hint = document.getElementById('new-bookmark-check-mode-hint');
        if (!hint) return;
        const key = mode === 'monitor'
            ? 'checkModeMonitorHint'
            : (mode === 'periodic' ? 'checkModePeriodicHint' : 'checkModeOffHint');
        const fallback = {
            checkModeOffHint: 'No availability checking.',
            checkModePeriodicHint: 'Checks once a day and flags the bookmark when it breaks.',
            checkModeMonitorHint: 'Checks on your own interval and keeps uptime history, a heartbeat and outage alerts. Includes everything Periodic does.',
        }[key];
        hint.textContent = this.t(`config.${key}`, fallback);
        hint.setAttribute('data-i18n', `config.${key}`);
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

    /**
     * The bookmark being edited is not its own duplicate. Matched on the URL it
     * had when the modal opened rather than on its index: the report a health row
     * comes from can be minutes old, so the index is the less trustworthy of the
     * two. Only meaningful while the edit stays on its original page.
     */
    isEditingSelf(bookmark, pageId) {
        if (!this.isEditMode() || !bookmark) return false;
        if (Number(pageId) !== Number(this.editTarget.pageId)) return false;
        const originalKey = this.canonicalBookmarkURLKey(this.editTarget.originalUrl || '');
        if (!originalKey) return false;
        return this.canonicalBookmarkURLKey(bookmark.url) === originalKey;
    }

    hasUrlDuplicateOnPage(url, pageId = null) {
        const key = this.canonicalBookmarkURLKey(url);
        if (!key) return false;
        const pid = pageId ?? this.getSelectedPageId();
        if (pid == null) return false;
        return this.getBookmarksForPage(pid).some(
            (b) => this.canonicalBookmarkURLKey(b.url) === key && !this.isEditingSelf(b, pid)
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
                && !this.isEditingSelf(b, pid)
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

        const editing = this.isEditMode();

        const compactStripHtml = window.BookmarkFormPreviewHtml?.buildCompactPreviewStripHtml
            ? window.BookmarkFormPreviewHtml.buildCompactPreviewStripHtml('new-bookmark', (key, fb) => this.t(key, fb))
            : '';

        const fullPreviewHtml = window.BookmarkFormPreviewHtml?.buildPreviewSectionHtml
            ? window.BookmarkFormPreviewHtml.buildPreviewSectionHtml('new-bookmark', (key, fb) => this.t(key, fb))
            : '';

        const shortcutConflictLabel = this.t('config.shortcutConflict', 'Shortcut already in use');
        const urlDuplicateLabel = this.t('config.urlConflictHint', 'This URL already exists on this page.');

        // Built from CheckMode.options() rather than written out here, so the three
        // modes, their order and their labels come from the same place the health
        // view and the context menu read them from. Off is preselected: a new
        // bookmark is not checked until asked, which is what the server assumes too.
        const checkModeOptionsHtml = (window.CheckMode?.options?.() || []).map((opt) => {
            const id = `new-bookmark-check-mode-${opt.mode}`;
            const checked = opt.mode === window.CheckMode.OFF ? ' checked' : '';
            return `<input type="radio" name="new-bookmark-check-mode" id="${id}" value="${opt.mode}" class="bookmark-detail-checkmode-input"${checked}>`
                + `<label for="${id}" class="bookmark-detail-checkmode-option">${escapeNewCommandHtml(opt.label)}</label>`;
        }).join('');

        // Same cadences the config panel offers. Sourced from CheckMode so a new
        // interval only has to be added in one place.
        const monitorIntervalOptionsHtml = SearchCommandNew.MONITOR_INTERVALS.map(({ minutes, fallback }) => {
            const label = this.t(`config.monitorIntervalShort${minutes}`, fallback);
            const selected = minutes === (window.CheckMode?.DEFAULT_INTERVAL_MINUTES ?? 15) ? ' selected' : '';
            return `<option value="${minutes}"${selected}>${escapeNewCommandHtml(label)}</option>`;
        }).join('');

        const modalHTML = `
            <div id="new-bookmark-modal" class="modal-overlay">
                <div class="modal modal-new-bookmark">
                    <div class="nbm-header">
                        <span class="nbm-title">${editing
                            ? this.t('config.editBookmark', 'Edit Bookmark')
                            : this.t('config.addNewBookmark', 'New Bookmark')}</span>
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
                            <input type="text" id="new-bookmark-name" name="name" class="nbm-input"${editing ? '' : ' required'} autocomplete="off"
                                   placeholder="${escapeNewCommandHtml(this.t('config.bookmarkNameAutoHint', 'Left blank, the page title is used'))}">
                        </div>
                        ${compactStripHtml}
                        <div class="nbm-section nbm-section-row nbm-wizard-step-2-panel">
                            <div class="nbm-col">
                                <label class="nbm-label" for="new-bookmark-page">${this.t('config.page', 'Page')}</label>
                                <select id="new-bookmark-page" name="page" class="nbm-input">
                                    ${this.generatePageOptions()}
                                    <option value="__new__" class="nbm-new-option">${this.t('config.addNewPageOption', '➕ New page…')}</option>
                                </select>
                                <div class="nbm-inline-create" id="new-page-create" hidden>
                                    <span class="nbm-inline-create-hint">${this.t('config.newPageNameLabel', 'Name your new page')}</span>
                                    <div class="nbm-inline-create-row">
                                        <input type="text" id="new-page-create-input" class="nbm-input" placeholder="${this.t('config.newPageNamePlaceholder', 'Page name')}" autocomplete="off" spellcheck="false" maxlength="60">
                                        <button type="button" class="nbm-inline-create-ok" id="new-page-create-ok" aria-label="${this.t('config.confirm', 'Confirm')}">✓</button>
                                        <button type="button" class="nbm-inline-create-cancel" id="new-page-create-cancel" aria-label="${this.t('config.cancel', 'Cancel')}">✕</button>
                                    </div>
                                </div>
                            </div>
                            <div class="nbm-col">
                                <label class="nbm-label" for="new-bookmark-category">${this.t('config.category', 'Category')}</label>
                                <select id="new-bookmark-category" name="category" class="nbm-input">
                                    <option value="">${this.t('config.noCategory', 'No category')}</option>
                                    ${this.generateCategoryOptions()}
                                    <option value="__new__" class="nbm-new-option">${this.t('config.addNewCategoryOption', '➕ New category…')}</option>
                                </select>
                                <div class="nbm-inline-create" id="new-category-create" hidden>
                                    <span class="nbm-inline-create-hint">${this.t('config.newCategoryNameLabel', 'Name your new category')}</span>
                                    <div class="nbm-inline-create-row">
                                        <input type="text" id="new-category-create-input" class="nbm-input" placeholder="${this.t('config.newCategoryNamePlaceholder', 'Category name')}" autocomplete="off" spellcheck="false" maxlength="60">
                                        <button type="button" class="nbm-inline-create-ok" id="new-category-create-ok" aria-label="${this.t('config.confirm', 'Confirm')}">✓</button>
                                        <button type="button" class="nbm-inline-create-cancel" id="new-category-create-cancel" aria-label="${this.t('config.cancel', 'Cancel')}">✕</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="nbm-section nbm-wizard-step-2-panel">
                            <label class="nbm-label" for="new-bookmark-tags">${this.t('config.detailTagsLabel', 'Tags')} <span class="nbm-label-hint">${this.t('config.commaSeparatedShort', 'comma-separated')}</span></label>
                            <input type="text" id="new-bookmark-tags" name="tags" class="nbm-input" placeholder="${this.t('config.detailTagsPlaceholder', 'work, dev, personal…')}" autocomplete="off" spellcheck="false">
                        </div>
                        <!-- Availability checking sits above the fold: it decides whether a
                             bookmark is monitored at all, which is a choice worth making while
                             adding it rather than one to rediscover under More options later.
                             The markup mirrors the config bookmark panel exactly, down to the
                             class names, so both surfaces are styled by the same rules and
                             cannot drift apart. -->
                        <div class="nbm-section nbm-wizard-step-2-panel nbm-availability-row">
                            <div class="bookmark-detail-checkmode nbm-availability-main">
                                <div class="bookmark-detail-checkmode-header">
                                    <label class="bookmark-detail-label" data-i18n="config.checkModeLabel">${this.t('config.checkModeLabel', 'Availability check')}</label>
                                    <button type="button" id="new-bookmark-check-mode-info" class="bookmark-detail-checkmode-info"
                                            data-i18n-aria="config.checkModeExplainTitle" aria-label="${this.t('config.checkModeExplainTitle', 'How availability checking works')}">i</button>
                                </div>
                                <div class="bookmark-detail-checkmode-options" role="radiogroup" aria-label="${this.t('config.checkModeLabel', 'Availability check')}">
                                    ${checkModeOptionsHtml}
                                    <select id="new-bookmark-monitor-interval" class="bookmark-detail-toggle-select" data-i18n-aria="config.monitorInterval" aria-label="${this.t('config.monitorInterval', 'Monitor interval')}" hidden>
                                        ${monitorIntervalOptionsHtml}
                                    </select>
                                </div>
                                <p class="bookmark-detail-field-hint" id="new-bookmark-check-mode-hint"></p>
                            </div>
                            <!-- Shortcut shares this row rather than sitting under More
                                 options: it is a per-bookmark decision you make while adding
                                 one, and the availability control left an empty column
                                 beside it that fits the field exactly. -->
                            <div class="nbm-availability-aside">
                                <label class="bookmark-detail-label" for="new-bookmark-shortcut">${this.t('config.shortcut', 'Shortcut')}</label>
                                <input type="text" id="new-bookmark-shortcut" name="shortcut" class="nbm-input nbm-shortcut" maxlength="5" autocomplete="off" placeholder="${this.t('config.bookmarkShortcutPlaceholder', 'Y, YS, YC')}">
                                <span id="new-bookmark-shortcut-conflict" class="nbm-conflict-hint" hidden>${shortcutConflictLabel}</span>
                                <!-- Same pill as the config panel and the inline editor, with
                                     the same pin glyph, rather than a bare checkbox at the very
                                     bottom of the form where it was easy to miss. -->
                                <label class="checkbox-label icon-toggle bookmark-detail-toggle nbm-pin-toggle" title="${this.t('config.pinnedToggleHint', 'Pin this bookmark to the top of its category')}">
                                    <input type="checkbox" id="new-bookmark-pinned" name="pinned">
                                    <span class="icon-toggle-indicator" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" focusable="false">
                                            <path d="M8 3h8l-1 5 3 3v1H6v-1l3-3-1-5zm4 10v8h-1v-8h1z"></path>
                                        </svg>
                                    </span>
                                    <span class="bookmark-detail-toggle-label">${this.t('config.pinnedShort', 'Pinned')}</span>
                                </label>
                            </div>
                        </div>
                        <details class="nbm-more-options nbm-wizard-step-2-panel" id="new-bookmark-more">
                            <summary>${this.t('config.addBookmarkMoreOptions', 'More options')}</summary>
                            <div class="nbm-more-content">
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
                                <!-- Pinned and the status checkbox both used to live here, below
                                     the fold. They now sit beside the availability control above
                                     it, in the same order the dashboard's inline editor uses. -->
                            </div>
                        </details>
                        <div class="nbm-footer">
                            <button type="button" class="nbm-btn nbm-btn-secondary nbm-wizard-only" id="new-bookmark-wizard-back">${this.t('config.addBookmarkWizardBack', 'Back')}</button>
                            <button type="button" class="nbm-btn nbm-btn-secondary" id="new-bookmark-cancel">${this.t('config.cancel', 'Cancel')}</button>
                            <button type="button" class="nbm-btn nbm-btn-primary nbm-wizard-only" id="new-bookmark-wizard-next">${this.t('config.addBookmarkWizardNext', 'Next')}</button>
                            ${editing ? '' : `<button type="button" class="nbm-btn nbm-btn-create-another" id="new-bookmark-create-another" title="${this.t('config.createAndAddAnotherTitle', 'Save this bookmark and keep the form open to add another')}">${this.t('config.createAndAddAnother', 'Create + New')}</button>`}
                            <button type="button" class="nbm-btn nbm-btn-primary" id="new-bookmark-create">${editing
                                ? this.t('config.save', 'Save')
                                : this.t('config.create', 'Add Bookmark')}</button>
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
                <option value="__new__" class="nbm-new-option">${this.t('config.addNewCategoryOption', '➕ New category…')}</option>
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

    // ── Inline create (new page / new category without leaving the modal) ──────

    _inlineIds(kind) {
        return kind === 'page'
            ? { select: 'new-bookmark-page', box: 'new-page-create', input: 'new-page-create-input', ok: 'new-page-create-ok', cancel: 'new-page-create-cancel' }
            : { select: 'new-bookmark-category', box: 'new-category-create', input: 'new-category-create-input', ok: 'new-category-create-ok', cancel: 'new-category-create-cancel' };
    }

    // Re-select a native select value and refresh its CustomSelect skin.
    _setSelectValue(selectEl, value) {
        if (!selectEl) return;
        selectEl.value = value;
        if (typeof CustomSelect !== 'undefined') {
            if (selectEl.__customSelectInstance) {
                try { selectEl.__customSelectInstance.destroy(); } catch (e) { /* ignore */ }
                selectEl.__customSelectInstance = null;
                delete selectEl.dataset.customSelectInit;
            }
            const instance = new CustomSelect(selectEl);
            selectEl.__customSelectInstance = instance;
            selectEl.dataset.customSelectInit = 'true';
        }
    }

    setupInlineCreate(kind) {
        const ids = this._inlineIds(kind);
        const okBtn = document.getElementById(ids.ok);
        const cancelBtn = document.getElementById(ids.cancel);
        const input = document.getElementById(ids.input);
        okBtn?.addEventListener('click', () => this.confirmInlineCreate(kind));
        cancelBtn?.addEventListener('click', () => this.cancelInlineCreate(kind));
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.confirmInlineCreate(kind); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelInlineCreate(kind); }
        });
    }

    openInlineCreate(kind) {
        const ids = this._inlineIds(kind);
        const select = document.getElementById(ids.select);
        const box = document.getElementById(ids.box);
        const input = document.getElementById(ids.input);
        if (!select || !box || !input) return;
        // Hide the select while entering a name; restore its previous value on cancel.
        select.hidden = true;
        if (select.__customSelectInstance?.wrapper) select.__customSelectInstance.wrapper.hidden = true;
        box.hidden = false;
        input.value = '';
        input.focus();
    }

    cancelInlineCreate(kind) {
        const ids = this._inlineIds(kind);
        const select = document.getElementById(ids.select);
        const box = document.getElementById(ids.box);
        if (box) box.hidden = true;
        const prev = kind === 'page' ? (this._prevPageValue ?? '') : (this._prevCategoryValue ?? '');
        if (select) {
            select.hidden = false;
            if (select.__customSelectInstance?.wrapper) select.__customSelectInstance.wrapper.hidden = false;
            this._setSelectValue(select, prev);
        }
    }

    async confirmInlineCreate(kind) {
        const ids = this._inlineIds(kind);
        const input = document.getElementById(ids.input);
        const name = (input?.value || '').trim();
        if (!name) { input?.focus(); return; }
        if (kind === 'page') {
            await this.createNewPage(name);
        } else {
            await this.createNewCategory(name);
        }
    }

    async createNewCategory(name) {
        const pageId = this.getSelectedPageId() || Number(this.currentPageId) || 1;
        try {
            const res = await fetch(`/api/categories?page=${pageId}`);
            const existing = res.ok ? await res.json() : [];
            const list = Array.isArray(existing) ? existing : [];
            if (list.some((c) => (c.name || '').trim().toLowerCase() === name.toLowerCase())) {
                this.notify(this.t('config.categoryExists', 'That category already exists.'), 'warning');
                return;
            }
            const id = this._slugId(name, list.map((c) => String(c.id)));
            const payload = [...list, { id, name }];
            const save = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)(`/api/categories?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!save.ok) throw new Error(save.statusText);

            // Reload the category dropdown for this page and select the new one.
            await this.updateCategoriesForPage(pageId);
            const select = document.getElementById('new-bookmark-category');
            const box = document.getElementById('new-category-create');
            if (box) box.hidden = true;
            if (select) {
                select.hidden = false;
                if (select.__customSelectInstance?.wrapper) select.__customSelectInstance.wrapper.hidden = false;
                this._setSelectValue(select, id);
                this._prevCategoryValue = id;
            }
            this._refreshDashboardData();
            this.notify(this.t('config.categoryCreated', 'Category created.'), 'success');
        } catch (e) {
            console.error('Inline create category failed:', e);
            this.notify(this.t('config.categoryCreateError', 'Could not create the category.'), 'error');
        }
    }

    async createNewPage(name) {
        try {
            const res = await fetch('/api/pages');
            const existing = res.ok ? await res.json() : [];
            const list = Array.isArray(existing) ? existing : [];
            if (list.some((p) => (p.name || '').trim().toLowerCase() === name.toLowerCase())) {
                this.notify(this.t('config.pageExists', 'That page already exists.'), 'warning');
                return;
            }
            const nextId = list.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1;
            const payload = [...list, { id: nextId, name }];
            const save = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!save.ok) throw new Error(save.statusText);

            // Rebuild the page dropdown, select the new page, refresh its categories.
            this.pages = payload;
            const select = document.getElementById('new-bookmark-page');
            const box = document.getElementById('new-page-create');
            if (select) {
                select.innerHTML = `${this.generatePageOptions()}<option value="__new__" class="nbm-new-option">${this.t('config.addNewPageOption', '➕ New page…')}</option>`;
                if (box) box.hidden = true;
                select.hidden = false;
                if (select.__customSelectInstance?.wrapper) select.__customSelectInstance.wrapper.hidden = false;
                this._setSelectValue(select, String(nextId));
                this._prevPageValue = String(nextId);
            }
            await this.updateCategoriesForPage(nextId);
            this.updateShortcutConflictHint();
            this.updateUrlDuplicateHint();
            this._refreshDashboardData();
            this.notify(this.t('config.pageCreated', 'Page created.'), 'success');
        } catch (e) {
            console.error('Inline create page failed:', e);
            this.notify(this.t('config.pageCreateError', 'Could not create the page.'), 'error');
        }
    }

    // Turn a name into a stable, unique id (mirrors config category id rules).
    _slugId(name, taken = []) {
        let base = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!base) base = 'category';
        let id = base;
        let n = 2;
        const takenSet = new Set(taken);
        while (takenSet.has(id)) { id = `${base}-${n++}`; }
        return id;
    }


    // Keep the live dashboard in sync so a new page tab / category appears.
    _refreshDashboardData() {
        const d = window.dashboardInstance;
        if (!d) return;
        try {
            if (typeof d.loadData === 'function') {
                void Promise.resolve(d.loadData()).then(() => {
                    try { d.renderPageNavigation?.(); } catch (e) { /* ignore */ }
                });
            }
        } catch (e) { /* best effort */ }
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

        const pageSelectEl = document.getElementById('new-bookmark-page');
        pageSelectEl?.addEventListener('change', async (e) => {
            if (e.target.value === '__new__') {
                this.openInlineCreate('page');
                return;
            }
            this._prevPageValue = e.target.value;
            await this.updateCategoriesForPage(parseInt(e.target.value, 10));
            this.updateShortcutConflictHint();
            this.updateUrlDuplicateHint();
        });
        if (pageSelectEl) this._prevPageValue = pageSelectEl.value;

        const categorySelectEl = document.getElementById('new-bookmark-category');
        categorySelectEl?.addEventListener('change', (e) => {
            if (e.target.value === '__new__') {
                this.openInlineCreate('category');
                return;
            }
            this._prevCategoryValue = e.target.value;
        });
        if (categorySelectEl) this._prevCategoryValue = categorySelectEl.value;

        this.setupInlineCreate('page');
        this.setupInlineCreate('category');

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
        document.querySelectorAll('input[name="new-bookmark-check-mode"]').forEach((input) => {
            input.addEventListener('change', () => {
                this.syncCheckMode();
                this.updatePreviews();
            });
        });
        document.getElementById('new-bookmark-monitor-interval')?.addEventListener('change', () => this.updatePreviews());
        // Reuses the config panel's explainer modal, so the three modes are
        // described in exactly one place.
        document.getElementById('new-bookmark-check-mode-info')?.addEventListener('click', () => {
            window.CheckMode?.showExplainer?.();
        });
        this.syncCheckMode();

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

        document.getElementById('new-bookmark-create')?.addEventListener('click', () => this.submitBookmark());
        document.getElementById('new-bookmark-create-another')?.addEventListener('click', () => this.createBookmark({ keepOpen: true }));
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
            this.submitBookmark();
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

        // An edit fills the whole form from the stored bookmark and stops: the
        // create path below would re-fetch the favicon and link preview off the
        // URL, overwriting the icon and preview the bookmark already has.
        if (this.isEditMode()) {
            this.fillFormForEdit();
            this.updatePreviews();
            this.updateShortcutConflictHint();
            this.updateUrlDuplicateHint();
            setTimeout(() => {
                nameInput?.focus();
                nameInput?.select();
            }, 100);
            return;
        }

        if (opts.url && urlInput) {
            urlInput.value = window.BookmarkUrlUtils?.ensureHttpUrl(opts.url) || opts.url;
            void this.autoFetchFromUrlField(true);
        }
        if (opts.name && nameInput) {
            nameInput.value = opts.name;
        }
        const noteInput = document.getElementById('new-bookmark-note');
        if (opts.note && noteInput) {
            noteInput.value = opts.note;
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
            // Cleared last: a stale target would put the next plain "add" into
            // edit mode and overwrite whatever was edited before.
            this.editTarget = null;
        }, 200);
    }

    /** Route the primary button to the right save: add a bookmark, or update one. */
    submitBookmark() {
        return this.isEditMode() ? this.updateBookmark() : this.createBookmark();
    }

    /**
     * Load the bookmark being edited into the form. Sets the same controls the
     * create path fills in, plus the ones only an existing bookmark has: the
     * stored icon, tags, category, page and availability mode.
     */
    async fillFormForEdit() {
        const bm = this.editTarget?.bookmark;
        if (!bm) return;

        const setValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.value = value ?? '';
        };

        setValue('new-bookmark-url', bm.url || '');
        setValue('new-bookmark-name', this.defaultBookmarkDisplayName(bm));
        setValue('new-bookmark-note', bm.note || '');
        setValue('new-bookmark-shortcut', String(bm.shortcut || '').toUpperCase());
        setValue('new-bookmark-tags', Array.isArray(bm.tags) ? bm.tags.join(', ') : '');

        const pinnedEl = document.getElementById('new-bookmark-pinned');
        if (pinnedEl) pinnedEl.checked = bm.pinned === true;

        // Carry the stored icon rather than re-fetching a favicon: an edit must
        // not silently replace an icon the user uploaded or picked by hand.
        this.pendingIcon = bm.icon || '';
        this._userEditedIcon = Boolean(bm.icon);
        this.syncIconPreview(bm.icon || '');

        this.draftState.previewTitle = bm.previewTitle || '';
        this.draftState.previewDesc = bm.previewDesc || '';
        this.draftState.previewImage = bm.previewImage || '';

        // The mode is read back through CheckMode so the radio matches what the
        // stored monitor/checkStatus pair actually means, rather than guessing.
        const mode = window.CheckMode?.of?.(bm) || window.CheckMode?.OFF || 'off';
        const modeRadio = document.getElementById(`new-bookmark-check-mode-${mode}`);
        if (modeRadio) modeRadio.checked = true;
        const interval = Number(bm.monitorIntervalMinutes);
        if (Number.isFinite(interval) && interval > 0) {
            setValue('new-bookmark-monitor-interval', String(interval));
        }
        this.syncCheckMode();

        const pageSelect = document.getElementById('new-bookmark-page');
        const pageId = Number(this.editTarget.pageId);
        if (pageSelect && Number.isFinite(pageId)) {
            pageSelect.value = String(pageId);
            pageSelect.__customSelectInstance?.refresh?.();
            // Categories belong to a page, so the list has to be the edited
            // page's before its category can be selected.
            await this.updateCategoriesForPage(pageId);
        }
        const categorySelect = document.getElementById('new-bookmark-category');
        if (categorySelect) {
            categorySelect.value = bm.category || '';
            categorySelect.__customSelectInstance?.refresh?.();
        }
    }

    /**
     * Save an edit by writing the page's bookmark array back.
     *
     * There is no single-bookmark update endpoint — /api/bookmarks/add only
     * appends, and auto-heal-apply only touches URL and title — so this reads the
     * page, replaces the one entry and posts the list, which is what the inline
     * editor does. The list is re-read here rather than trusted from the caller:
     * a health row can be minutes old, so its index is verified against the URL
     * the bookmark had when the modal opened before anything is overwritten.
     */
    async updateBookmark() {
        const form = document.getElementById('new-bookmark-form');
        this.ensureBookmarkNameBeforeSubmit();
        if (!form?.checkValidity()) {
            form?.reportValidity();
            window.nextdashTrack?.('bookmark-edited', { result: 'invalid' });
            return { ok: false };
        }

        const urlInput = document.getElementById('new-bookmark-url');
        const normalizedUrl = this.normalizeUrlField(urlInput, true);
        const formData = new FormData(form);
        const sourcePageId = Number(this.editTarget.pageId);
        const targetPageId = this.getSelectedPageId() || sourcePageId;

        const shortcut = String(formData.get('shortcut') || '').trim().toUpperCase();
        if (shortcut && this.hasShortcutConflictOnPage(shortcut, targetPageId)) {
            this.updateShortcutConflictHint();
            this.notify(this.t('config.shortcutConflict', 'Shortcut already in use'), 'error');
            window.nextdashTrack?.('bookmark-edited', { result: 'shortcut-conflict' });
            return { ok: false };
        }
        if (normalizedUrl && this.hasUrlDuplicateOnPage(normalizedUrl, targetPageId)) {
            this.updateUrlDuplicateHint();
            this.notify(this.duplicateBookmarkUrlMessage(), 'error');
            window.nextdashTrack?.('bookmark-edited', { result: 'duplicate' });
            return { ok: false };
        }

        const iconFile = document.getElementById('new-bookmark-icon-file')?.files?.[0];
        const iconUrl = (document.getElementById('new-bookmark-icon-url')?.value || '').trim();
        const icon = await this.resolveIconValue(iconFile, iconUrl);
        if (icon === null) {
            window.nextdashTrack?.('bookmark-edited', { result: 'icon-failed' });
            return { ok: false };
        }

        const rawTags = String(formData.get('tags') || '');
        const tags = rawTags.split(',').map(t => t.trim().toLowerCase())
            .filter((t, i, arr) => t && arr.indexOf(t) === i);
        const categorySelect = document.getElementById('new-bookmark-category');

        // Spread the original first so fields this form does not expose —
        // createdAt, click counts, health history — survive the edit.
        const updated = {
            ...this.editTarget.bookmark,
            name: String(formData.get('name') || '').trim(),
            url: normalizedUrl,
            note: String(formData.get('note') || '').trim(),
            shortcut,
            category: String(categorySelect?.value ?? formData.get('category') ?? '').trim(),
            pinned: formData.get('pinned') === 'on',
            tags,
            // resolveIconValue already falls back to the stored icon, so an
            // untouched form keeps it and the clear button still empties it.
            icon,
        };
        if (window.CheckMode) {
            updated.monitorIntervalMinutes = this.getSelectedMonitorInterval();
            window.CheckMode.assign(updated, this.getSelectedCheckMode());
        }
        updated.previewTitle = this.draftState.previewTitle || '';
        updated.previewDesc = this.draftState.previewDesc || '';
        updated.previewImage = this.draftState.previewImage || '';

        const doFetch = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const listRes = await fetch(`/api/bookmarks?page=${sourcePageId}`);
            if (!listRes.ok) throw new Error(`load HTTP ${listRes.status}`);
            const list = await listRes.json();
            if (!Array.isArray(list)) throw new Error('unexpected bookmark list');

            const originalKey = this.canonicalBookmarkURLKey(this.editTarget.originalUrl || '');
            let index = Number(this.editTarget.index);
            const atIndex = Number.isFinite(index) ? list[index] : null;
            if (!atIndex || this.canonicalBookmarkURLKey(atIndex.url) !== originalKey) {
                // The index was stale; fall back to the URL it opened with.
                index = list.findIndex((b) => this.canonicalBookmarkURLKey(b.url) === originalKey);
            }
            if (index < 0 || !list[index]) {
                this.notify(
                    this.t('config.bookmarkNoLongerExists', 'That bookmark no longer exists.'),
                    'error'
                );
                window.nextdashTrack?.('bookmark-edited', { result: 'stale' });
                return { ok: false };
            }

            const merged = { ...list[index], ...updated };
            const movedPage = Number(targetPageId) !== Number(sourcePageId);
            if (movedPage) {
                // Moving pages is two writes: drop it from the old page, append to
                // the new one. Ordered so a failure leaves the bookmark in place
                // rather than removing it from both.
                const targetRes = await fetch(`/api/bookmarks?page=${targetPageId}`);
                if (!targetRes.ok) throw new Error(`target HTTP ${targetRes.status}`);
                const targetList = await targetRes.json();
                targetList.push(merged);
                const saveTarget = await doFetch(`/api/bookmarks?page=${targetPageId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(targetList),
                });
                if (!saveTarget.ok) throw new Error(`save target HTTP ${saveTarget.status}`);
                list.splice(index, 1);
            } else {
                list[index] = merged;
            }

            const saveRes = await doFetch(`/api/bookmarks?page=${sourcePageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(list),
            });
            if (!saveRes.ok) throw new Error(`save HTTP ${saveRes.status}`);

            const onSaved = this.editTarget.onSaved;
            try {
                this.closeModal();
            } catch (error) {
                console.warn('Error closing bookmark modal after save:', error);
            }

            const dash = window.dashboardInstance;
            dash?.data?.invalidatePageDataCache?.(Number(sourcePageId));
            if (movedPage) dash?.data?.invalidatePageDataCache?.(Number(targetPageId));
            void dash?.data?.fetchAndStoreDataRevision?.();
            if (dash) {
                await dash.loadAllBookmarks?.();
                if (Number(dash.currentPageId) === Number(sourcePageId)
                    || Number(dash.currentPageId) === Number(targetPageId)) {
                    await dash.loadPageBookmarks?.(dash.currentPageId, { forceFetch: true });
                }
                dash.renderDashboard?.({ incremental: false });
            }

            this.notify(this.t('config.bookmarkUpdated', 'Bookmark updated'), 'success');
            window.nextdashTrack?.('bookmark-edited', { result: 'ok', movedPage });
            // Lets the opener refresh itself — the health view re-reads its report
            // so the edited row reflects the new URL, name and check mode.
            await onSaved?.({ pageId: targetPageId, bookmark: merged });
            return { ok: true, pageId: targetPageId, bookmark: merged };
        } catch (error) {
            console.error('Error updating bookmark:', error);
            this.notify(this.t('config.errorUpdatingBookmark', 'Could not save the bookmark'), 'error');
            window.nextdashTrack?.('bookmark-edited', { result: 'error' });
            return { ok: false };
        }
    }

    async createBookmark({ keepOpen = false } = {}) {
        const form = document.getElementById('new-bookmark-form');
        this.ensureBookmarkNameBeforeSubmit();
        if (!form?.checkValidity()) {
            form.reportValidity();
            window.nextdashTrack?.('bookmark-created', { result: 'invalid' });
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
            window.nextdashTrack?.('bookmark-created', { result: 'shortcut-conflict' });
            return { ok: false };
        }

        if (normalizedUrl && this.hasUrlDuplicateOnPage(normalizedUrl, pageId)) {
            this.updateUrlDuplicateHint();
            this.notify(this.duplicateBookmarkUrlMessage(), 'error');
            window.nextdashTrack?.('bookmark-created', { result: 'duplicate' });
            return { ok: false };
        }

        const iconFile = document.getElementById('new-bookmark-icon-file')?.files?.[0];
        const iconUrl = (document.getElementById('new-bookmark-icon-url')?.value || '').trim();
        const icon = await this.resolveIconValue(iconFile, iconUrl);
        if (icon === null) {
            window.nextdashTrack?.('bookmark-created', { result: 'icon-failed' });
            return { ok: false };
        }

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
            tags,
            icon,
            createdAt: Date.now(),
        };

        // Written through CheckMode rather than by hand: it is the same function
        // the health view and the context menu use, so a bookmark created here
        // carries exactly the fields a mode change elsewhere would set —
        // including the explicit interval a fresh monitor needs.
        if (window.CheckMode) {
            bookmark.monitorIntervalMinutes = this.getSelectedMonitorInterval();
            window.CheckMode.assign(bookmark, this.getSelectedCheckMode());
        } else {
            bookmark.checkStatus = false;
        }

        if (this.draftState.previewTitle) bookmark.previewTitle = this.draftState.previewTitle;
        if (this.draftState.previewDesc) bookmark.previewDesc = this.draftState.previewDesc;
        if (this.draftState.previewImage) bookmark.previewImage = this.draftState.previewImage;

        if (!Number.isFinite(pageId) || pageId < 1) {
            this.notify(this.t('config.errorCreatingBookmark', 'Invalid page selected.'), 'error');
            window.nextdashTrack?.('bookmark-created', { result: 'invalid-page' });
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
                window.nextdashTrack?.('bookmark-created', { result: 'duplicate' });
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
                // "Create + New" keeps the modal open and clears the form (page and
                // category stay put — you are usually filing several bookmarks in the
                // same place) so the next one can be typed straight away.
                if (keepOpen) {
                    this.resetFormForNext(pageId);
                } else {
                    try {
                        this.closeModal();
                    } catch (error) {
                        console.warn('Error closing new-bookmark modal after save:', error);
                    }
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
                const dashAfter = window.dashboardInstance;
                if (dashAfter?._pendingInboxPromoteId && dashAfter.inbox) {
                    const promoteId = dashAfter._pendingInboxPromoteId;
                    dashAfter._pendingInboxPromoteId = null;
                    await dashAfter.inbox.completePromote(promoteId);
                    // A promoted bookmark that opts into status checks starts life with
                    // no health data, so it lands on Health as "missing". Kick off a
                    // one-off server-side check (fire-and-forget) so it shows a real
                    // status without waiting for a full retest.
                    // Monitor counts too: it is a superset of Periodic, and a
                    // monitored bookmark starts just as blank on Health.
                    if (bookmark.checkStatus === true || bookmark.monitor === true) {
                        dashAfter.inbox.triggerHealthCheckForUrl?.(bookmark.url);
                    }
                }
                // Outcome of the add-bookmark funnel: modal:new-bookmark opened it,
                // this closes it. Props stay low-cardinality — never name/url/tags.
                window.nextdashTrack?.('bookmark-created', {
                    result: 'ok',
                    withIcon: Boolean(bookmark.icon),
                    withTags: Array.isArray(bookmark.tags) && bookmark.tags.length > 0,
                    withShortcut: Boolean(bookmark.shortcut),
                });
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
                window.nextdashTrack?.('bookmark-created', { result: 'conflict' });
            } else {
                this.notify(this.t('config.errorCreatingBookmark', 'Error creating bookmark'), 'error');
                window.nextdashTrack?.('bookmark-created', { result: 'error' });
            }
        } catch (error) {
            console.error('Error creating bookmark:', error);
            this.notify(this.t('config.errorCreatingBookmark', 'Error creating bookmark'), 'error');
            window.nextdashTrack?.('bookmark-created', { result: 'error' });
        }
        return { ok: false };
    }

    /**
     * Clear the form after a "Create + New" save so the next bookmark can be
     * typed straight away, while keeping the page/category selection — filing
     * several bookmarks in one place is the common case. The modal stays open.
     */
    resetFormForNext(keepPageId) {
        const form = document.getElementById('new-bookmark-form');
        if (!form) return;

        ['new-bookmark-url', 'new-bookmark-name', 'new-bookmark-shortcut', 'new-bookmark-note', 'new-bookmark-tags', 'new-bookmark-icon-url']
            .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });

        const pinned = document.getElementById('new-bookmark-pinned');
        if (pinned) pinned.checked = false;

        const iconFile = document.getElementById('new-bookmark-icon-file');
        if (iconFile) iconFile.value = '';

        // Keep the page the user was filing into; the category select follows it.
        const pageSelect = document.getElementById('new-bookmark-page');
        if (pageSelect && Number.isFinite(keepPageId)) {
            pageSelect.value = String(keepPageId);
            pageSelect.__customSelectInstance?.refresh?.();
        }

        // Reset icon + link-preview draft state to a clean slate.
        this.resetDraftState();
        this.syncIconPreview('');
        this.setModalIconFetchState('');
        this.formPreview?.clearLinkPreview?.(this.getDraftBookmark());

        // Clear any lingering conflict hints and refresh the previews.
        this.updateShortcutConflictHint();
        this.updateUrlDuplicateHint();
        this.updatePreviews();

        // Wizard flows (mobile) start each bookmark back on the first step.
        if (this.usesMobileWizard()) this.setWizardStep(1);

        // Land the caret in the URL field, ready for the next entry.
        const urlInput = document.getElementById('new-bookmark-url');
        setTimeout(() => urlInput?.focus(), 50);
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
