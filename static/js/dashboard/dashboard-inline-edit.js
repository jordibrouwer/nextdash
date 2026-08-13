/**
 * Inline bookmark editor and related guards.
 */
class DashboardInlineEdit {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    isInlineEditActive() {
        if (document.getElementById('bookmark-form-modal')?.classList.contains('show')) {
            return true;
        }
        const d = this.dash;
        return d.inlineEditingBookmarkIndex !== null || Boolean(document.querySelector('.bookmark-inline-editing'));
    }

    ensureBookmarkFormModalShell() {
        if (this._formModalShell?.isConnected) {
            return this._formModalShell;
        }
        const existing = document.getElementById('bookmark-form-modal');
        if (existing) {
            this._formModalShell = existing;
            return existing;
        }
        const d = this.dash;
        const cfg = (key, fb) => d.configLabel(key, fb);
        const shell = document.createElement('div');
        shell.id = 'bookmark-form-modal';
        shell.className = 'bookmark-form-modal modal-overlay';
        shell.setAttribute('aria-hidden', 'true');
        shell.innerHTML = `
            <div class="bookmark-form-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="bookmark-form-modal-title">
                <div class="bookmark-form-modal-header">
                    <h2 id="bookmark-form-modal-title"></h2>
                    <button type="button" class="bookmark-form-modal-close" aria-label="${cfg('close', 'Close')}">×</button>
                </div>
                <div class="bookmark-form-modal-body"></div>
            </div>`;
        shell.addEventListener('click', (e) => {
            if (e.target === shell) {
                void this.requestCloseBookmarkFormModal();
            }
        });
        shell.querySelector('.bookmark-form-modal-close')?.addEventListener('click', () => {
            void this.requestCloseBookmarkFormModal();
        });
        document.body.appendChild(shell);
        this._formModalShell = shell;
        return shell;
    }

    async requestCloseBookmarkFormModal() {
        if (!(await this.confirmDiscardInlineEdit())) {
            return;
        }
        this.closeBookmarkFormModal();
    }

    closeBookmarkFormModal({ silent = false, clearInboxPromote = true } = {}) {
        const d = this.dash;
        const ctx = this._formModalContext;
        const row = ctx?.row;
        const bookmarkRef = ctx?.bookmarkRef;
        if (clearInboxPromote) {
            d._pendingInboxPromoteId = null;
        }
        d._inlineEditGlobalCleanup?.();
        d._inlineEditAutoFetchClear?.();
        d._inlineEditAutoFetchClear = null;
        d._inlineEditContext = null;
        d.inlineEditingBookmarkIndex = null;
        d._inlineEditWasKeyboardSelected = false;
        this.clearInlineEditSurfaceOverrides();
        document.body.classList.remove('bookmark-form-modal-open');
        document.body.classList.remove('bookmark-inline-edit-active');
        d.keyboardNavigation?.enable?.();
        window.FocusTrapUtils?.syncDashboardInert?.();
        const shell = this._formModalShell || document.getElementById('bookmark-form-modal');
        if (shell) {
            shell.classList.remove('show');
            shell.setAttribute('aria-hidden', 'true');
            shell.querySelector('.bookmark-form-modal-body')?.replaceChildren();
        }
        this._formModalContext = null;
        if (!silent && row && bookmarkRef) {
            this.restoreInlineEditRow(row, bookmarkRef);
        }
    }

    /**
     * Shared bookmark form — add or edit — in a modal usable from every view.
     */
    openBookmarkFormModal(options = {}) {
        const d = this.dash;
        const isEdit = options.mode === 'edit' && (options.bookmark != null || options.bookmarkRef?.bookmark);
        window.nextdashTrack?.(isEdit ? 'modal:edit-bookmark' : 'modal:new-bookmark');

        d.dismissBookmarkPreviewInteractions?.();

        let bookmarkRef = options.bookmarkRef;
        let row = options.row || null;

        if (isEdit) {
            if (!bookmarkRef && options.bookmark) {
                bookmarkRef = d.resolveBookmarkReference(options.bookmark);
                if (!bookmarkRef) {
                    const pageId = Number(options.pageId || d.currentPageId || 1);
                    const idx = Number.isFinite(Number(options.index)) ? Number(options.index) : -1;
                    bookmarkRef = {
                        bookmark: { ...options.bookmark },
                        pageId,
                        index: idx,
                        // A bookmark object passed in from config/search is a copy,
                        // not the live row in d.bookmarks — remote save loads the page
                        // from the API and writes the edit back.
                        scope: 'remote',
                        original: null,
                    };
                }
            }
            if (!bookmarkRef?.bookmark) {
                return;
            }
            window.nextdashTrack?.('bookmark:edit-open', { source: options.source || 'modal' });
        } else {
            const pageId = Number(options.pageId || options.currentPageId || d.currentPageId || 1);
            bookmarkRef = {
                bookmark: {
                    name: String(options.name || '').trim(),
                    url: String(options.url || '').trim(),
                    note: String(options.note || '').trim(),
                    shortcut: '',
                    category: String(options.category || ''),
                    tags: Array.isArray(options.tags) ? [...options.tags] : [],
                    icon: '',
                    pinned: false,
                    checkStatus: false,
                    monitor: false,
                    monitorIntervalMinutes: window.CheckMode?.DEFAULT_INTERVAL_MINUTES || 60,
                },
                pageId,
                index: -1,
                scope: 'create',
                original: null,
            };
        }

        if (row?._bookmarkLongPressAbort) {
            row._bookmarkLongPressAbort.abort();
            row._bookmarkLongPressAbort = null;
        }

        const kbdNav = d.keyboardNavigation;
        d._inlineEditWasKeyboardSelected = Boolean(row)
            && kbdNav?._selectionFromKeyboard === true
            && kbdNav?.navigableElements?.[kbdNav.currentIndex] === row;

        this.ensureBookmarkFormModalShell();
        this.closeBookmarkFormModal({ silent: true, clearInboxPromote: false });

        const shell = this._formModalShell;
        const titleEl = shell.querySelector('#bookmark-form-modal-title');
        const cfg = (key, fb) => d.configLabel(key, fb);
        titleEl.textContent = isEdit
            ? cfg('editBookmark', 'Edit bookmark')
            : cfg('addNewBookmark', 'Add bookmark');

        this._formModalContext = {
            mode: isEdit ? 'edit' : 'create',
            bookmarkRef,
            row,
            onSaved: typeof options.onSaved === 'function' ? options.onSaved : null,
        };

        d.inlineEditingBookmarkIndex = isEdit && bookmarkRef.scope === 'current' ? bookmarkRef.index : null;

        shell.classList.add('show');
        shell.setAttribute('aria-hidden', 'false');

        const body = shell.querySelector('.bookmark-form-modal-body');
        body.innerHTML = '';

        this._renderBookmarkForm(body, bookmarkRef, row);

        d.keyboardNavigation?.disable?.();
        window.FocusTrapUtils?.syncDashboardInert?.();
        document.body.classList.add('bookmark-form-modal-open');
    }

    openBookmarkInlineEditor(row, bookmarkRef) {
        return this.openBookmarkFormModal({ mode: 'edit', row, bookmarkRef, source: 'dashboard' });
    }

    /** Resolve a theme surface to opaque rgb() — CSS vars may be rgba or color-mix. */
    readSolidThemeSurface(varName, fallbackVar) {
        const probe = document.createElement('span');
        probe.style.cssText = [
            'position:fixed',
            'left:-9999px',
            'top:0',
            'width:1px',
            'height:1px',
            `background:var(${varName}, var(${fallbackVar}))`,
        ].join(';');
        document.body.appendChild(probe);
        const computed = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const match = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return match ? `rgb(${match[1]}, ${match[2]}, ${match[3]})` : computed;
    }

    applySolidInlineEditSurfaces(row, form) {
        if (!form) {
            return;
        }
        // Remembered so the row's inline background can be taken off again on
        // close. It is set below to keep the form opaque over the blurred grid,
        // and an inline background outranks every stylesheet rule — including the
        // keyboard-selected gradient, which is why a row left with it looked
        // unselected afterwards.
        this._solidSurfaceRow = row && !row.closest('.layout-launcher') ? row : null;
        const panelBg = this.readSolidThemeSurface('--background-primary', '--background-secondary');
        const fieldBg = this.readSolidThemeSurface('--background-secondary', '--background-primary');
        document.body.style.setProperty('--inline-edit-panel-bg', panelBg);
        document.body.style.setProperty('--inline-edit-field-bg', fieldBg);
        form.style.background = panelBg;
        if (row && !row.closest('.layout-launcher')) {
            row.style.background = panelBg;
        }
        form.querySelectorAll(
            '.bookmark-inline-input, .bookmark-inline-select, .bookmark-inline-textarea, .bookmark-inline-action-btn, .bookmark-inline-create-btn, .bookmark-inline-icon-preview'
        ).forEach((node) => {
            node.style.background = fieldBg;
        });
    }

    clearInlineEditSurfaceOverrides() {
        document.body.style.removeProperty('--inline-edit-panel-bg');
        document.body.style.removeProperty('--inline-edit-field-bg');
        // The row keeps its own inline background until it is removed here.
        // Leaving it behind wins over the selected/hover rules, so the row still
        // takes the keyboard cursor but stops looking like it.
        if (this._solidSurfaceRow) {
            this._solidSurfaceRow.style.removeProperty('background');
            this._solidSurfaceRow = null;
        }
    }


    /**
     * Explains the availability-check modes. Shared by the inline editor and the
     * health view, because the question ("why does this row have a heartbeat and
     * that one doesn't?") arises in both places.
     */
    showCheckModeExplainer() {
        window.CheckMode?.showExplainer?.();
    }

    snapshotInlineEditBaseline(bookmark, pageId) {
        const tags = Array.isArray(bookmark?.tags)
            ? bookmark.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
            : [];
        return {
            name: String(bookmark?.name || '').trim(),
            url: String(bookmark?.url || '').trim(),
            shortcut: String(bookmark?.shortcut || '').trim().toUpperCase(),
            category: String(bookmark?.category ?? ''),
            icon: String(bookmark?.icon || '').trim(),
            pinned: Boolean(bookmark?.pinned),
            checkStatus: Boolean(bookmark?.checkStatus),
            monitor: Boolean(bookmark?.monitor),
            monitorIntervalMinutes: window.CheckMode.intervalOf(bookmark),
            note: String(bookmark?.note || '').trim(),
            tags,
            pageId: Number(pageId),
        };
    }


    refreshInlineEditBaseline(bookmarkRef, fields) {
        if (!bookmarkRef?.bookmark || !fields) {
            return;
        }
        const d = this.dash;
        const pageId = fields.pageSelect
            ? Number(fields.pageSelect.value)
            : Number(bookmarkRef.pageId || d.currentPageId);
        const tags = fields.tagsInput
            ? fields.tagsInput.value.split(',').map((tag) => tag.trim().toLowerCase()).filter((tag, index, arr) => tag && arr.indexOf(tag) === index)
            : [];
        bookmarkRef.original = {
            name: fields.nameInput.value.trim(),
            url: fields.urlInput.value.trim(),
            shortcut: fields.shortcutInput.value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5),
            category: fields.catSelect.value,
            icon: typeof fields.getPendingIcon === 'function'
                ? String(fields.getPendingIcon() || '').trim()
                : String(bookmarkRef.bookmark.icon || '').trim(),
            pinned: fields.pinInput ? fields.pinInput.checked : Boolean(bookmarkRef.bookmark.pinned),
            checkStatus: fields.statusInput.checked,
            monitor: fields.monitorInput ? fields.monitorInput.checked : Boolean(bookmarkRef.bookmark.monitor),
            monitorIntervalMinutes: fields.monitorIntervalInput
                ? Number(fields.monitorIntervalInput.value) || window.CheckMode.DEFAULT_INTERVAL_MINUTES
                : window.CheckMode.intervalOf(bookmarkRef.bookmark),
            note: fields.noteInput ? String(fields.noteInput.value || '').trim() : '',
            tags,
            pageId: Number.isFinite(pageId) ? pageId : Number(bookmarkRef.pageId || d.currentPageId),
        };
    }


    /**
     * Re-baseline after the form itself changed a select (a freshly created page
     * or category), so the new value does not read as an unsaved edit.
     */
    refreshInlineEditBaselineIfActive(bookmarkRef) {
        const fields = this.dash._inlineEditContext?.fields;
        if (fields) {
            this.refreshInlineEditBaseline(bookmarkRef, fields);
        }
    }


    // Creating pages and categories lives in DashboardStructureCreate — the pages
    // overlay and the grid's category placeholder create the same things without
    // a bookmark involved, and must not drag this module in to do it. These stay
    // as the names the form calls them by.

    /** Turn a name into a stable, unique category id (mirrors the config rules). */
    slugCategoryId(name, taken = []) {
        return this.dash.structureCreate.slugCategoryId(name, taken);
    }


    async createPageFromForm(name) {
        return this.dash.structureCreate.createPageFromForm(name);
    }


    async createCategoryFromForm(pageId, name) {
        return this.dash.structureCreate.createCategoryFromForm(pageId, name);
    }


    hasInlineEditUnsavedChanges() {
        const d = this.dash;
        const ctx = d._inlineEditContext;
        if (!ctx?.bookmarkRef?.original || !ctx.fields) {
            return false;
        }
        const original = ctx.bookmarkRef.original;
        const fields = ctx.fields;
        const name = fields.nameInput.value.trim();
        const url = fields.urlInput.value.trim();
        const shortcut = fields.shortcutInput.value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
        const category = fields.catSelect.value;
        const pinned = fields.pinInput ? fields.pinInput.checked : Boolean(original.pinned);
        const checkStatus = fields.statusInput.checked;
        const monitor = fields.monitorInput ? fields.monitorInput.checked : Boolean(original.monitor);
        const monitorIntervalMinutes = fields.monitorIntervalInput
            ? Number(fields.monitorIntervalInput.value) || window.CheckMode.DEFAULT_INTERVAL_MINUTES
            : window.CheckMode.intervalOf(original);
        const note = fields.noteInput ? String(fields.noteInput.value || '').trim() : String(original.note || '').trim();
        const icon = typeof fields.getPendingIcon === 'function'
            ? String(fields.getPendingIcon() || '').trim()
            : String(original.icon || '').trim();
        const tags = fields.tagsInput
            ? fields.tagsInput.value.split(',').map((tag) => tag.trim().toLowerCase()).filter((tag, index, arr) => tag && arr.indexOf(tag) === index)
            : (original.tags || []);
        const originalTags = (original.tags || []).map((tag) => String(tag).trim().toLowerCase());
        const tagsEqual = tags.length === originalTags.length
            && tags.every((tag, index) => tag === originalTags[index]);
        const targetPageId = fields.pageSelect
            ? Number(fields.pageSelect.value)
            : Number(original.pageId || ctx.bookmarkRef.pageId || d.currentPageId);
        const originalPageId = Number(original.pageId || ctx.bookmarkRef.pageId || d.currentPageId);

        return name !== String(original.name || '').trim()
            || url !== String(original.url || '').trim()
            || shortcut !== String(original.shortcut || '').trim().toUpperCase()
            || category !== String(original.category ?? '')
            || (fields.pinInput && pinned !== Boolean(original.pinned))
            || checkStatus !== Boolean(original.checkStatus)
            || monitor !== Boolean(original.monitor)
            // The interval is only a real change while monitoring is on; otherwise
            // it is a value with no effect and must not trigger an unsaved warning.
            || (monitor && monitorIntervalMinutes !== window.CheckMode.intervalOf(original))
            || (fields.noteInput && note !== String(original.note || '').trim())
            || icon !== String(original.icon || '').trim()
            || !tagsEqual
            || targetPageId !== originalPageId;
    }


    dismissInlineEditForNavigation() {
        const d = this.dash;
        const ctx = d._inlineEditContext;
        if (ctx?.row && ctx.bookmarkRef) {
            this.cancelBookmarkInlineEdit(ctx.row, ctx.bookmarkRef);
            return;
        }
        this._abortInlineEditForRender();
    }


    async confirmInlineEditBeforeNavigation() {
        const d = this.dash;
        if (!this.isInlineEditActive()) {
            return true;
        }
        if (!this.hasInlineEditUnsavedChanges()) {
            this.dismissInlineEditForNavigation();
            return true;
        }
        if (!(await this.confirmDiscardInlineEdit())) {
            return false;
        }
        this.dismissInlineEditForNavigation();
        return true;
    }


    _abortInlineEditForRender() {
        const d = this.dash;
        if (d.inlineEditingBookmarkIndex !== null) {
            if (this.hasInlineEditUnsavedChanges()) {
                return;
            }
            d._inlineEditGlobalCleanup?.();
            d.inlineEditingBookmarkIndex = null;
        }
        d._inlineEditAutoFetchClear?.();
        d._inlineEditAutoFetchClear = null;
        d._inlineEditContext = null;
        this.leaveBookmarkInlineEditFocusMode();
    }


    async confirmDiscardInlineEdit() {
        const d = this.dash;
        if (!this.hasInlineEditUnsavedChanges()) {
            return true;
        }
        const message = d.formatDashboardLabel(
            'inlineEditDiscardConfirm',
            {},
            'You have unsaved inline edits. Discard and leave?'
        );
        if (window.AppModal && typeof window.AppModal.confirm === 'function') {
            return window.AppModal.confirm({
                title: d.formatDashboardLabel('inlineEditDiscardTitle', {}, 'Discard inline edits?'),
                message,
                confirmText: d.formatDashboardLabel('inlineEditDiscardConfirmBtn', {}, 'Discard'),
                cancelText: d.configLabel('cancel', 'Cancel'),
                confirmClass: 'danger',
                modalClass: 'inline-edit-discard-modal'
            });
        }
        return window.confirm(message);
    }


    tryOpenInlineBookmarkEdit() {
        const d = this.dash;
        const kn = d.keyboardNavigation;
        const layout = document.getElementById('dashboard-layout');
        let el = null;
        if (layout && document.activeElement && document.activeElement.closest) {
            const hit = document.activeElement.closest('.bookmark-link');
            if (hit && layout.contains(hit) && !hit.classList.contains('recent-bookmark-link')) {
                el = hit;
            }
        }
        if (!el && kn && kn.currentIndex >= 0 && Array.isArray(kn.navigableElements)) {
            el = kn.navigableElements[kn.currentIndex];
        }
        if (!el || !el.classList.contains('bookmark-link') || el.classList.contains('bookmark-inline-editing')) {
            return false;
        }

        let bookmark = null;
        if (el.hasAttribute('data-bookmark-index')) {
            const idx = parseInt(el.getAttribute('data-bookmark-index'), 10);
            if (Number.isFinite(idx) && idx >= 0 && d.bookmarks[idx]) {
                bookmark = d.bookmarks[idx];
            }
        }
        if (!bookmark) {
            const url = String(el.getAttribute('data-bookmark-url') || '').trim();
            const cat = String(el.getAttribute('data-category-id') || '').trim();
            if (url) {
                bookmark = d.bookmarks.find(
                    (b) => String((b.url || '').trim()) === url && String(b.category || '') === cat
                ) || d.bookmarks.find((b) => String((b.url || '').trim()) === url);
            }
        }
        if (!bookmark && Array.isArray(d.allBookmarks)) {
            const url = String(el.getAttribute('data-bookmark-url') || '').trim();
            const cat = String(el.getAttribute('data-category-id') || '').trim();
            if (url) {
                bookmark = d.allBookmarks.find(
                    (b) => String((b.url || '').trim()) === url && String(b.category || '') === cat
                ) || d.allBookmarks.find((b) => String((b.url || '').trim()) === url);
            }
        }
        if (!bookmark) {
            return false;
        }
        const bookmarkRef = d.resolveBookmarkReference(bookmark);
        if (!bookmarkRef) {
            return false;
        }
        this.openBookmarkInlineEditor(el, bookmarkRef);
        return true;
    }

    /**
     * Long-press (not on reorder handle) opens inline editor. Uses AbortController on row to drop listeners on rebuild.
     * @param {AbortSignal} signal
     */

    isPointerInsideInlineEdit(event) {
        const editingRow = document.querySelector('.bookmark-link.bookmark-inline-editing');
        if (!editingRow) {
            return false;
        }
        const active = document.activeElement;
        if (active instanceof Node && editingRow.contains(active)) {
            return true;
        }
        const insideAuxUi = (node) => node instanceof Element && (
            node.classList?.contains('bookmark-inline-form')
            || node.classList?.contains('bookmark-inline-field')
            || node.classList?.contains('bookmark-inline-action-btn')
            || node.classList?.contains('tag-ac-dropdown')
            || node.classList?.contains('dashboard-feature-promo')
            || node.classList?.contains('dashboard-grid-kbd-promo')
            || node.closest?.('#app-modal')
        );
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (path.includes(editingRow) || path.some(insideAuxUi)) {
            return true;
        }
        const target = event.target;
        if (target instanceof Node && (
            editingRow.contains(target)
            || Boolean(target.closest?.(
                '.bookmark-inline-form, .bookmark-inline-action-btn, .tag-ac-dropdown, .dashboard-feature-promo, .dashboard-grid-kbd-promo, #app-modal'
            ))
        )) {
            return true;
        }
        const coords = this.getPointerClientCoords(event);
        if (coords) {
            const hit = document.elementFromPoint(coords.x, coords.y);
            if (hit instanceof Node && (
                editingRow.contains(hit)
                || Boolean(hit.closest?.(
                    '.bookmark-inline-form, .bookmark-inline-action-btn, .tag-ac-dropdown, .dashboard-feature-promo, .dashboard-grid-kbd-promo, #app-modal'
                ))
            )) {
                return true;
            }
        }
        return false;
    }


    getPointerClientCoords(event) {
        if (typeof event?.clientX === 'number' && typeof event?.clientY === 'number') {
            return { x: event.clientX, y: event.clientY };
        }
        const touch = event?.touches?.[0] || event?.changedTouches?.[0];
        if (touch && typeof touch.clientX === 'number' && typeof touch.clientY === 'number') {
            return { x: touch.clientX, y: touch.clientY };
        }
        return null;
    }


    _renderBookmarkForm(container, bookmarkRef, row) {
        const d = this.dash;
        if (!container || !bookmarkRef || !bookmarkRef.bookmark) {
            return;
        }
        const bookmark = bookmarkRef.bookmark;
        const isCreate = this._formModalContext?.mode === 'create';
        const bookmarkIndex = Number.isFinite(Number(bookmarkRef.index)) ? Number(bookmarkRef.index) : -1;
        const form = document.createElement('div');
        form.className = 'bookmark-inline-form';

        const cfg = (key, fallback) => d.configLabel(key, fallback);

        const mkField = (labelText, inputEl, errorEl) => {
            const wrap = document.createElement('div');
            wrap.className = 'bookmark-inline-field';
            const lab = document.createElement('label');
            lab.className = 'bookmark-inline-label';
            lab.textContent = labelText;
            wrap.appendChild(lab);
            wrap.appendChild(inputEl);
            if (errorEl) wrap.appendChild(errorEl);
            return wrap;
        };

        const nameError = document.createElement('span');
        nameError.className = 'bookmark-inline-conflict';
        nameError.hidden = true;
        nameError.textContent = cfg('nameRequired', 'Name is required');

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'bookmark-inline-input';
        nameInput.value = bookmark.name || '';
        form.appendChild(mkField(cfg('bookmarkName', 'Name'), nameInput, nameError));

        const urlError = document.createElement('span');
        urlError.className = 'bookmark-inline-conflict';
        urlError.hidden = true;
        urlError.textContent = cfg('urlRequired', 'Valid URL required (e.g. https://example.com)');

        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.className = 'bookmark-inline-input';
        urlInput.value = bookmark.url || '';
        form.appendChild(mkField(cfg('urlLabelShort', 'URL'), urlInput, urlError));

        let pendingIcon = String(bookmark.icon || '').trim();
        const iconPreview = document.createElement('div');
        iconPreview.className = 'bookmark-inline-icon-preview';

        const iconUrlInput = document.createElement('input');
        iconUrlInput.type = 'text';
        iconUrlInput.className = 'bookmark-inline-input';
        iconUrlInput.placeholder = cfg('detailIconUrlPlaceholder', 'https://.../icon.png');
        iconUrlInput.value = pendingIcon ? `/data/icons/${pendingIcon}` : '';

        const iconActions = document.createElement('div');
        iconActions.className = 'bookmark-inline-icon-actions';

        const setIconBtn = document.createElement('button');
        setIconBtn.type = 'button';
        setIconBtn.className = 'bookmark-inline-action-btn bookmark-inline-save';
        setIconBtn.textContent = cfg('detailSetIconUrlBtn', 'Set URL');

        const fetchIconBtn = document.createElement('button');
        fetchIconBtn.type = 'button';
        fetchIconBtn.className = 'bookmark-inline-action-btn';
        fetchIconBtn.textContent = cfg('fetch', 'Fetch');
        let inlineAutoFetchTimer = null;
        let inlineAutoFetchInFlight = false;

        const uploadIconBtn = document.createElement('button');
        uploadIconBtn.type = 'button';
        uploadIconBtn.className = 'bookmark-inline-action-btn';
        uploadIconBtn.textContent = cfg('detailUploadIconBtn', 'Upload');

        const iconFileInput = document.createElement('input');
        iconFileInput.type = 'file';
        iconFileInput.accept = 'image/*,.ico,.svg,.webp';
        iconFileInput.style.display = 'none';

        const clearIconBtn = document.createElement('button');
        clearIconBtn.type = 'button';
        clearIconBtn.className = 'bookmark-inline-action-btn';
        clearIconBtn.textContent = cfg('detailClearIconBtn', 'Clear');

        const iconState = document.createElement('span');
        iconState.className = 'bookmark-inline-icon-state';
        const iconFetchState = document.createElement('span');
        iconFetchState.className = 'bookmark-inline-icon-state';

        const syncIconState = () => {
            iconState.textContent = pendingIcon
                ? (d.language.t('config.iconSet') || 'Icon set')
                : (d.language.t('config.iconNone') || 'No icon');
            clearIconBtn.disabled = !pendingIcon;
            iconPreview.replaceChildren();
            if (pendingIcon) {
                const img = document.createElement('img');
                img.src = `/data/icons/${encodeURIComponent(pendingIcon)}`;
                img.alt = '';
                iconPreview.appendChild(img);
            } else {
                const empty = document.createElement('span');
                empty.textContent = cfg('iconNone', 'No icon');
                iconPreview.appendChild(empty);
            }
        };

        setIconBtn.addEventListener('click', async () => {
            const inputValue = (iconUrlInput.value || '').trim();
            if (!inputValue) {
                d.notifyDashboard('iconUrlRequired', 'Icon URL is required.', 'error');
                return;
            }
            if (inputValue.startsWith('/data/icons/')) {
                const existingIcon = inputValue.replace('/data/icons/', '').trim();
                if (!existingIcon) {
                    d.notifyDashboard('iconUrlRequired', 'Icon URL is required.', 'error');
                    return;
                }
                pendingIcon = existingIcon;
                syncIconState();
                iconFetchState.textContent = d.tConfig('iconSet', 'Icon set');
                d.notifyDashboard('iconUrlSet', 'Icon URL set.', 'success');
                return;
            }
            setIconBtn.disabled = true;
            iconFetchState.textContent = d.language.t('config.iconFetching') || 'Fetching...';
            const nextIcon = await this.uploadBookmarkIconFromUrl(inputValue);
            setIconBtn.disabled = false;
            if (!nextIcon) {
                iconFetchState.textContent = d.tConfig('iconFetchFailed', 'Fetch failed');
                d.notifyConfig('iconUrlInvalid', 'Invalid or blocked icon URL.', 'error');
                return;
            }
            pendingIcon = nextIcon;
            iconUrlInput.value = `/data/icons/${nextIcon}`;
            syncIconState();
            iconFetchState.textContent = d.tConfig('iconFound', 'Found');
            d.notifyDashboard('iconUrlSet', 'Icon URL set.', 'success');
        });

        fetchIconBtn.addEventListener('click', async () => {
            const urlValue = (urlInput.value || '').trim();
            if (!urlValue) {
                d.notifyConfig('urlRequiredShort', 'URL is required.', 'error');
                return;
            }
            fetchIconBtn.disabled = true;
            iconFetchState.textContent = d.language.t('config.iconFetching') || 'Fetching...';
            const fetchedIcon = await this.fetchAndAssignFaviconForUrl(urlValue);
            fetchIconBtn.disabled = false;
            if (!fetchedIcon) {
                iconFetchState.textContent = d.tConfig('iconNotFound', 'Not found');
                d.notifyConfig('faviconFetchFailed', 'Favicon fetch failed.', 'error');
                return;
            }
            pendingIcon = fetchedIcon;
            iconUrlInput.value = `/data/icons/${fetchedIcon}`;
            syncIconState();
            iconFetchState.textContent = d.tConfig('iconFound', 'Found');
            d.notifyConfig('faviconFetched', 'Favicon fetched.', 'success');
        });
        urlInput.addEventListener('blur', () => {
            if (!urlInput.dataset.touched) {
                return;
            }
            if (inlineAutoFetchTimer) {
                clearTimeout(inlineAutoFetchTimer);
            }
            inlineAutoFetchTimer = setTimeout(async () => {
                const urlValue = (urlInput.value || '').trim();
                if (!urlValue || pendingIcon || inlineAutoFetchInFlight) {
                    return;
                }
                inlineAutoFetchInFlight = true;
                iconFetchState.textContent = d.language.t('config.iconFetching') || 'Fetching...';
                const fetchedIcon = await this.fetchAndAssignFaviconForUrl(urlValue);
                inlineAutoFetchInFlight = false;
                if (!fetchedIcon) {
                    iconFetchState.textContent = d.language.t('config.iconNotFound') || 'Not found';
                    return;
                }
                pendingIcon = fetchedIcon;
                iconUrlInput.value = `/data/icons/${fetchedIcon}`;
                syncIconState();
                iconFetchState.textContent = d.language.t('config.iconFound') || 'Found';
            }, 250);
        });

        uploadIconBtn.addEventListener('click', () => {
            iconFileInput.click();
        });

        iconFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) {
                return;
            }
            uploadIconBtn.disabled = true;
            const uploadedIcon = await this.uploadBookmarkIconFile(file);
            uploadIconBtn.disabled = false;
            e.target.value = '';
            if (!uploadedIcon) {
                d.notifyConfig('iconUploadFailed', 'Icon upload failed.', 'error');
                return;
            }
            pendingIcon = uploadedIcon;
            iconUrlInput.value = `/data/icons/${uploadedIcon}`;
            syncIconState();
            d.notifyDashboard('iconUploaded', 'Icon uploaded.', 'success');
        });

        clearIconBtn.addEventListener('click', () => {
            pendingIcon = '';
            iconUrlInput.value = '';
            syncIconState();
        });

        iconActions.appendChild(uploadIconBtn);
        iconActions.appendChild(fetchIconBtn);
        iconActions.appendChild(setIconBtn);
        iconActions.appendChild(clearIconBtn);
        iconActions.appendChild(iconState);
        iconActions.appendChild(iconFetchState);
        const iconWrap = mkField(cfg('iconUrlOptional', 'Icon URL (opt)'), iconUrlInput);
        iconWrap.appendChild(iconPreview);
        iconWrap.appendChild(iconFileInput);
        iconWrap.appendChild(iconActions);
        form.appendChild(iconWrap);
        syncIconState();

        let noteInput = document.createElement('textarea');
        noteInput.className = 'bookmark-inline-textarea';
        noteInput.value = bookmark.note || '';
        const noteField = mkField(d.language.t('bookmark.noteLabel') || 'Note', noteInput);

        const tagsInput = document.createElement('input');
        tagsInput.type = 'text';
        tagsInput.className = 'bookmark-inline-input';
        tagsInput.placeholder = cfg('detailTagsPlaceholder', 'work, dev, personal…');
        tagsInput.value = (Array.isArray(bookmark.tags) ? bookmark.tags : []).join(', ');
        const tagsField = mkField(cfg('detailTagsLabel', 'Tags'), tagsInput);
        const sessionTags = new Set();
        (d.allBookmarks?.length ? d.allBookmarks : d.bookmarks ?? []).forEach((bm) => (
            (bm.tags || []).forEach((t) => sessionTags.add(t))
        ));
        if (typeof TagAutocomplete !== 'undefined') {
            TagAutocomplete.attach(tagsInput, () => {
                tagsInput.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
                    .forEach((t) => sessionTags.add(t));
                return [...sessionTags];
            });
        }

        const shortcutInput = document.createElement('input');
        shortcutInput.type = 'text';
        shortcutInput.className = 'bookmark-inline-input';
        shortcutInput.maxLength = 5;
        shortcutInput.value = (bookmark.shortcut || '').toUpperCase();
        const shortcutConflictHint = document.createElement('span');
        shortcutConflictHint.className = 'bookmark-inline-conflict';
        shortcutConflictHint.hidden = true;
        shortcutConflictHint.textContent = d.language?.t('config.shortcutConflict') || 'Shortcut already in use';
        const syncShortcutConflict = (value) => {
            const normalized = String(value || '').trim();
            const conflict = Boolean(normalized) && this.hasShortcutConflict(normalized, bookmarkRef);
            shortcutConflictHint.hidden = !conflict;
            shortcutInput.classList.toggle('field-conflict', conflict);
        };
        shortcutInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
            syncShortcutConflict(e.target.value);
        });
        syncShortcutConflict(shortcutInput.value);
        const shortcutField = mkField(cfg('shortcut', 'Shortcut'), shortcutInput);
        shortcutField.appendChild(shortcutConflictHint);

        // The "create" entry sits at the top of each dropdown, so adding a page or
        // category is one click away from the field it belongs to — no trip to the
        // config view mid-edit. Picking it swaps the select for a name input.
        const NEW_OPTION_VALUE = '__new__';

        const mkNewOption = (labelText) => {
            const o = document.createElement('option');
            o.value = NEW_OPTION_VALUE;
            o.className = 'bookmark-inline-new-option';
            o.textContent = labelText;
            return o;
        };

        const catSelect = document.createElement('select');
        catSelect.className = 'bookmark-inline-select';
        const fillCatSelect = (cats, selectedId) => {
            catSelect.replaceChildren();
            catSelect.appendChild(mkNewOption(cfg('addNewCategoryOption', '➕ New category…')));
            const optEmpty = document.createElement('option');
            optEmpty.value = '';
            optEmpty.textContent = '—';
            catSelect.appendChild(optEmpty);
            let matched = false;
            (cats || []).forEach((cat) => {
                const o = document.createElement('option');
                o.value = cat.id || '';
                o.textContent = cat.name || cat.id || '';
                if (String(selectedId ?? '') === String(cat.id ?? '')) {
                    o.selected = true;
                    matched = true;
                }
                catSelect.appendChild(o);
            });
            if (!matched) {
                catSelect.value = '';
            }
            return matched;
        };
        fillCatSelect(d.categories || [], bookmark.category);
        const catField = mkField(cfg('category', 'Category'), catSelect);

        const pageSelect = document.createElement('select');
        pageSelect.className = 'bookmark-inline-select';
        const currentPageId = Number(d.currentPageId);
        const sourcePageId = Number(bookmarkRef.pageId || d.currentPageId);
        const fillPageSelect = (pages, selectedId) => {
            pageSelect.replaceChildren();
            pageSelect.appendChild(mkNewOption(cfg('addNewPageOption', '➕ New page…')));
            const list = Array.isArray(pages) ? pages : [];
            let matched = false;
            list.forEach((page) => {
                const o = document.createElement('option');
                o.value = page.id;
                o.textContent = page.name || String(page.id);
                if (Number(page.id) === Number(selectedId)) {
                    o.selected = true;
                    matched = true;
                }
                pageSelect.appendChild(o);
            });
            // "New page…" is the first option, so an unmatched id would leave the
            // select showing it as the current page. Fall back to a real page.
            if (!matched && list.length > 0) {
                pageSelect.value = String(list[0].id);
            }
        };
        fillPageSelect(d.pages, sourcePageId);
        const pageField = mkField(cfg('page', 'Page'), pageSelect);

        // Field order: Upload → Shortcut → flags → Page → Category → Tags → Note.
        // The flag row is created further down (it needs `cfg` and the bookmark
        // state), so reserve its slot here and fill it in place.
        const togglesSlot = document.createComment('bookmark-inline-toggles');
        form.appendChild(shortcutField);
        form.appendChild(togglesSlot);
        form.appendChild(pageField);
        form.appendChild(catField);
        form.appendChild(tagsField);
        form.appendChild(noteField);

        const loadCategoriesForPage = async (pageId) => (
            Number(pageId) === currentPageId
                ? (d.categories || [])
                : await fetch(`/api/categories?page=${pageId}`).then(r => r.ok ? r.json() : []).catch(() => [])
        );

        const reloadCatSelectForPage = async (pageId, preferredId) => {
            const cats = await loadCategoriesForPage(pageId);
            const wanted = preferredId !== undefined ? preferredId : catSelect.value;
            const matched = fillCatSelect(cats, wanted);
            // No match from previous page — default to first real category so bookmark doesn't land in Others
            if (!matched && cats.length > 0) {
                catSelect.value = cats[0].id || '';
            }
            if (d._inlineEditContext?.fields?.catSelect === catSelect) {
                this.refreshInlineEditBaseline(bookmarkRef, d._inlineEditContext.fields);
            }
        };

        // ─── Inline create: page / category without leaving the form ────────────
        // Each select gets a sibling row holding a name input and confirm/cancel
        // buttons. The row replaces the select in place, so the form's height and
        // the field's position never move.
        const lastSelected = { page: String(sourcePageId), category: catSelect.value };

        const mkInlineCreateRow = (kind, placeholder) => window.InlineCreateRow.create({
            kind,
            placeholder,
            labels: {
                create: cfg('create', 'Create'),
                cancel: d.formatDashboardLabel('cancel', {}, 'Cancel'),
            },
        });

        const closeInlineCreate = (kind, ui, select) => {
            ui.box.hidden = true;
            ui.error.hidden = true;
            ui.input.value = '';
            select.hidden = false;
            select.value = lastSelected[kind];
            select.focus({ preventScroll: true });
        };

        const openInlineCreate = (kind, ui, select) => {
            // Put the previous value back straight away rather than on close: a save
            // while this row is open must not read __new__ as the target page or
            // category. The row on screen, not the sentinel, is the pending state.
            select.value = lastSelected[kind];
            select.hidden = true;
            ui.box.hidden = false;
            ui.error.hidden = true;
            ui.input.value = '';
            ui.input.focus({ preventScroll: true });
        };

        const wireInlineCreate = (kind, ui, select, confirm) => {
            window.InlineCreateRow.wire(ui, {
                submit: async (name) => {
                    const failure = await confirm(name);
                    if (failure) {
                        return failure;
                    }
                    // Success puts the select back in the row's place; the caller's
                    // `confirm` has already refilled it with the new page/category.
                    ui.box.hidden = true;
                    ui.error.hidden = true;
                    ui.input.value = '';
                    select.hidden = false;
                    select.focus({ preventScroll: true });
                    return null;
                },
                onCancel: () => closeInlineCreate(kind, ui, select),
            });
            // The form's Escape listener runs in the capture phase on document, so
            // it hands the key back here through this hook rather than racing it.
            ui.box.__closeInlineCreate = () => closeInlineCreate(kind, ui, select);
        };

        const pageCreate = mkInlineCreateRow(
            'page',
            cfg('newPageNamePlaceholder', 'Page name'),
        );
        pageField.appendChild(pageCreate.box);

        const catCreate = mkInlineCreateRow(
            'category',
            cfg('newCategoryNamePlaceholder', 'Category name'),
        );
        catField.appendChild(catCreate.box);

        wireInlineCreate('page', pageCreate, pageSelect, async (name) => {
            const created = await this.createPageFromForm(name);
            if (created.error) {
                return created.error;
            }
            fillPageSelect(d.pages, created.id);
            lastSelected.page = String(created.id);
            // A brand-new page has no categories yet, so the category select
            // resets to "—" rather than keeping the old page's choice.
            await reloadCatSelectForPage(created.id, '');
            lastSelected.category = catSelect.value;
            this.refreshInlineEditBaselineIfActive(bookmarkRef);
            return null;
        });

        wireInlineCreate('category', catCreate, catSelect, async (name) => {
            const pageId = Number(pageSelect.value) || sourcePageId;
            const created = await this.createCategoryFromForm(pageId, name);
            if (created.error) {
                return created.error;
            }
            await reloadCatSelectForPage(pageId, created.id);
            lastSelected.category = catSelect.value;
            this.refreshInlineEditBaselineIfActive(bookmarkRef);
            return null;
        });

        pageSelect.addEventListener('change', () => {
            if (pageSelect.value === NEW_OPTION_VALUE) {
                openInlineCreate('page', pageCreate, pageSelect);
                return;
            }
            lastSelected.page = pageSelect.value;
            void reloadCatSelectForPage(pageSelect.value);
        });

        catSelect.addEventListener('change', () => {
            if (catSelect.value === NEW_OPTION_VALUE) {
                openInlineCreate('category', catCreate, catSelect);
                return;
            }
            lastSelected.category = catSelect.value;
        });

        if (bookmarkRef.scope === 'remote' && sourcePageId !== currentPageId) {
            void reloadCatSelectForPage(sourcePageId);
        }

        // The three flags sit together as one compact row of toggle pills directly
        // under Shortcut. Stacked checkbox rows pushed the save buttons off small
        // screens and made the flags easy to miss; as pills they read as one group
        // and cost a single line.
        const suffix = bookmarkIndex >= 0 ? bookmarkIndex : `remote-${bookmarkRef.pageId}`;
        const toggleRow = document.createElement('div');
        toggleRow.className = 'bookmark-inline-toggles';
        toggleRow.setAttribute('role', 'group');
        toggleRow.setAttribute('aria-label', cfg('bookmarkFlags', 'Options'));

        const mkToggle = (id, labelText, checked, iconPath) => {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = id;
            input.checked = Boolean(checked);
            input.className = 'bookmark-inline-toggle-input';

            const label = document.createElement('label');
            label.className = 'bookmark-inline-toggle';
            label.htmlFor = id;
            label.title = labelText;

            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('aria-hidden', 'true');
            icon.setAttribute('focusable', 'false');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', iconPath);
            icon.appendChild(path);

            const text = document.createElement('span');
            text.textContent = labelText;

            label.appendChild(icon);
            label.appendChild(text);
            toggleRow.appendChild(input);
            toggleRow.appendChild(label);
            return input;
        };

        const pinInput = mkToggle(
            `bookmark-inline-pin-${suffix}`,
            cfg('pinnedShort', 'Pinned'),
            bookmark.pinned,
            'M8 3h8l-1 5 3 3v1H6v-1l3-3-1-5zm4 10v8h-1v-8h1z'
        );
        // Availability checking is one choice of three, not two overlapping flags.
        // Monitor does everything Status check does and more, so offering both as
        // independent checkboxes invited a meaningless "both on" state and left
        // people guessing at the difference.
        const checkModeRow = document.createElement('div');
        checkModeRow.className = 'bookmark-inline-checkmode';
        checkModeRow.setAttribute('role', 'radiogroup');
        checkModeRow.setAttribute('aria-label', cfg('checkModeLabel', 'Availability check'));

        const currentMode = bookmark.monitor ? 'monitor' : (bookmark.checkStatus ? 'periodic' : 'off');
        const modeDefs = [
            ['off', cfg('checkModeOff', 'Off'), cfg('checkModeOffHint', 'No availability checking.')],
            ['periodic', cfg('checkModePeriodic', 'Periodic'), cfg('checkModePeriodicHint', 'Checks once a day and flags the bookmark when it breaks.')],
            ['monitor', cfg('checkModeMonitor', 'Monitor'), cfg('checkModeMonitorHint', 'Checks on your own interval and keeps uptime history, a heartbeat and outage alerts. Includes everything Periodic does.')],
        ];
        const modeInputs = {};
        modeDefs.forEach(([value, labelText, hint]) => {
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = `bookmark-inline-checkmode-${suffix}`;
            input.id = `bookmark-inline-checkmode-${value}-${suffix}`;
            input.value = value;
            input.checked = currentMode === value;
            input.className = 'bookmark-inline-checkmode-input';

            const label = document.createElement('label');
            label.className = 'bookmark-inline-checkmode-option';
            label.htmlFor = input.id;
            label.textContent = labelText;
            label.title = hint;

            checkModeRow.appendChild(input);
            checkModeRow.appendChild(label);
            modeInputs[value] = input;
        });

        const readCheckMode = () => {
            for (const [value, input] of Object.entries(modeInputs)) {
                if (input.checked) return value;
            }
            return 'off';
        };
        // The two stored booleans are derived from the single choice, so they can
        // never disagree with each other.
        const statusInput = { get checked() { return readCheckMode() === 'periodic'; } };
        const monitorInput = { get checked() { return readCheckMode() === 'monitor'; } };

        const monitorIntervalInput = document.createElement('select');
        monitorIntervalInput.id = `bookmark-inline-monitor-interval-${suffix}`;
        monitorIntervalInput.className = 'bookmark-inline-select bookmark-inline-toggle-select';
        // Abbreviated units here (not the config form's full words): the select
        // shares one line with three pills, and "15 minutes" is what pushes it
        // onto a line of its own.
        [
            [5, cfg('monitorIntervalShort5', '5m')],
            [15, cfg('monitorIntervalShort15', '15m')],
            [30, cfg('monitorIntervalShort30', '30m')],
            [60, cfg('monitorIntervalShort60', '1h')],
            [360, cfg('monitorIntervalShort360', '6h')],
            [1440, cfg('monitorIntervalShort1440', '24h')],
        ].forEach(([value, label]) => {
            const opt = document.createElement('option');
            opt.value = String(value);
            opt.textContent = label;
            monitorIntervalInput.appendChild(opt);
        });
        monitorIntervalInput.value = String(window.CheckMode.intervalOf(bookmark));
        monitorIntervalInput.setAttribute('aria-label', cfg('monitorInterval', 'Check every'));
        // The interval rides along in the same row, so turning Monitor on does not
        // reflow the form — it only reveals a select that was already accounted for.
        monitorIntervalInput.hidden = !monitorInput.checked;
        checkModeRow.appendChild(monitorIntervalInput);

        // A small info button opens the full explanation. Hover titles cover the
        // desktop case; this is the path that also works on touch.
        const checkModeInfo = document.createElement('button');
        checkModeInfo.type = 'button';
        checkModeInfo.className = 'bookmark-inline-checkmode-info';
        checkModeInfo.textContent = 'i';
        checkModeInfo.title = cfg('checkModeExplainTitle', 'How availability checking works');
        checkModeInfo.setAttribute('aria-label', cfg('checkModeExplainTitle', 'How availability checking works'));
        checkModeInfo.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showCheckModeExplainer();
        });
        checkModeRow.appendChild(checkModeInfo);

        Object.values(modeInputs).forEach((input) => {
            input.addEventListener('change', () => {
                monitorIntervalInput.hidden = !monitorInput.checked;
                // Give a freshly-chosen monitor an explicit interval, so the stored
                // bookmark states its cadence rather than relying on the default.
                if (monitorInput.checked && !Number(monitorIntervalInput.value)) {
                    monitorIntervalInput.value = String(window.CheckMode.DEFAULT_INTERVAL_MINUTES);
                }
            });
        });

        form.insertBefore(toggleRow, togglesSlot);
        form.insertBefore(checkModeRow, togglesSlot);

        const actions = document.createElement('div');
        actions.className = 'bookmark-inline-actions';

        const isValidURL = (val) => {
            if (!val) return false;
            try { const u = new URL(val); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
        };

        const validateForm = (showErrors = false) => {
            const nameOk = Boolean(nameInput.value.trim());
            const urlOk = isValidURL(urlInput.value.trim());
            if (showErrors || nameInput.dataset.touched) {
                nameInput.classList.toggle('input-error', !nameOk);
                nameError.hidden = nameOk;
            }
            if (showErrors || urlInput.dataset.touched) {
                urlInput.classList.toggle('input-error', !urlOk);
                urlError.hidden = urlOk;
            }
            return nameOk && urlOk;
        };

        const syncSaveEnabled = () => {
            const valid = validateForm();
            saveBtn.setAttribute('aria-disabled', valid ? 'false' : 'true');
            saveBtn.classList.toggle('bookmark-inline-save--invalid', !valid);
        };

        const runSave = async (e, { keepOpen = false } = {}) => {
            e.preventDefault();
            e.stopPropagation();
            if (saveBtn.dataset.saving === '1') {
                return;
            }
            if (!validateForm(true)) {
                return;
            }
            saveBtn.dataset.saving = '1';
            try {
                if (isCreate) {
                    await this.createBookmarkFromForm(bookmarkRef, {
                        nameInput,
                        urlInput,
                        iconUrlInput,
                        shortcutInput,
                        catSelect,
                        pageSelect,
                        pinInput,
                        statusInput,
                        monitorInput,
                        monitorIntervalInput,
                        noteInput,
                        tagsInput,
                        getPendingIcon: () => pendingIcon,
                        resetPendingIcon: () => { pendingIcon = ''; syncIconState(); },
                    }, { keepOpen });
                } else {
                    await this.commitBookmarkInlineEdit(bookmarkRef, {
                        nameInput,
                        urlInput,
                        iconUrlInput,
                        shortcutInput,
                        catSelect,
                        pageSelect,
                        pinInput,
                        statusInput,
                        monitorInput,
                        monitorIntervalInput,
                        noteInput,
                        tagsInput,
                        getPendingIcon: () => pendingIcon,
                    }, row);
                }
            } finally {
                delete saveBtn.dataset.saving;
            }
        };

        const createAnotherBtn = document.createElement('button');
        createAnotherBtn.type = 'button';
        createAnotherBtn.id = 'bookmark-form-create-another';
        createAnotherBtn.className = 'bookmark-inline-action-btn bookmark-inline-create-another';
        createAnotherBtn.textContent = cfg('createAndAddAnother', 'Create + New');
        createAnotherBtn.title = cfg('createAndAddAnotherTitle', 'Save this bookmark and keep the form open to add another');
        createAnotherBtn.hidden = !isCreate;
        createAnotherBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        createAnotherBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
        createAnotherBtn.addEventListener('click', (e) => { void runSave(e, { keepOpen: true }); });

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'bookmark-inline-action-btn bookmark-inline-save';
        saveBtn.textContent = isCreate ? cfg('addNewBookmark', 'Add bookmark') : cfg('saveChanges', 'Save');
        saveBtn.setAttribute('aria-disabled', 'false');
        saveBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        saveBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });
        saveBtn.addEventListener('click', runSave);

        nameInput.addEventListener('input', () => { nameInput.dataset.touched = '1'; syncSaveEnabled(); });
        urlInput.addEventListener('input', () => { urlInput.dataset.touched = '1'; syncSaveEnabled(); });
        nameInput.addEventListener('blur', () => { nameInput.dataset.touched = '1'; validateForm(); syncSaveEnabled(); });
        urlInput.addEventListener('blur', () => {
            const normalized = window.BookmarkUrlUtils?.ensureHttpUrl(urlInput.value) || urlInput.value.trim();
            if (normalized && normalized !== urlInput.value.trim()) urlInput.value = normalized;
            urlInput.dataset.touched = '1';
            validateForm();
            syncSaveEnabled();
        });
        syncSaveEnabled();

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'bookmark-inline-action-btn';
        cancelBtn.textContent = d.formatDashboardLabel('cancel', {}, 'Cancel');
        const stopActionPointer = (e) => {
            e.stopPropagation();
        };
        cancelBtn.addEventListener('mousedown', stopActionPointer);
        cancelBtn.addEventListener('pointerdown', stopActionPointer);
        cancelBtn.addEventListener('touchstart', stopActionPointer, { passive: true });
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this.requestCloseBookmarkFormModal();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'bookmark-inline-action-btn bookmark-inline-delete';
        deleteBtn.textContent = cfg('delete', 'Delete');
        deleteBtn.hidden = isCreate;
        deleteBtn.addEventListener('mousedown', stopActionPointer);
        deleteBtn.addEventListener('pointerdown', stopActionPointer);
        deleteBtn.addEventListener('touchstart', stopActionPointer, { passive: true });
        deleteBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            d._inlineEditConfirmOpen = true;
            try {
                await this.deleteBookmarkInline(bookmarkRef);
            } finally {
                d._inlineEditConfirmOpen = false;
            }
        });

        actions.appendChild(saveBtn);
        if (isCreate) {
            actions.appendChild(createAnotherBtn);
        }
        actions.appendChild(cancelBtn);
        actions.appendChild(deleteBtn);

        const hint = document.createElement('span');
        hint.className = 'bookmark-inline-hint';
        // The handler below already accepts metaKey alongside ctrlKey — this
        // just makes the hint tell a Mac user which key that means.
        const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '');
        hint.textContent = isMac
            ? d.formatDashboardLabel('inlineEditHintMac', {}, '⌘+Enter to save · Esc to cancel')
            : d.formatDashboardLabel('inlineEditHint', {}, 'Ctrl+Enter to save · Esc to cancel');
        actions.appendChild(hint);

        form.appendChild(actions);

        form.addEventListener('keydown', async (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void runSave(e);
            }
        });

        container.appendChild(form);
        const dialog = this._formModalShell?.querySelector('.bookmark-form-modal-dialog');
        this.applySolidInlineEditSurfaces(null, form);
        if (dialog) {
            const panelBg = this.readSolidThemeSurface('--background-primary', '--background-secondary');
            dialog.style.background = panelBg;
            form.style.background = panelBg;
        }
        d._inlineEditContext = {
            bookmarkRef,
            row,
            fields: {
                nameInput,
                urlInput,
                shortcutInput,
                catSelect,
                pageSelect,
                pinInput,
                statusInput,
                monitorInput,
                monitorIntervalInput,
                noteInput,
                tagsInput,
                getPendingIcon: () => pendingIcon,
            },
        };
        this.refreshInlineEditBaseline(bookmarkRef, d._inlineEditContext.fields);
        nameInput.focus({ preventScroll: true });

        const onGlobalEsc = async (e) => {
            if (e.key !== 'Escape') return;
            if (!document.contains(form)) {
                globalCleanup();
                return;
            }
            if (d.isModalOpen() && !this._formModalShell?.classList.contains('show')) return;
            // An open "New page/category" row owns Escape: it is the innermost thing
            // on screen, and this listener is in the capture phase, so without the
            // hand-off it would close the whole form before the row ever saw the key.
            const openCreateRow = form.querySelector('.bookmark-inline-create:not([hidden])');
            if (openCreateRow) {
                e.preventDefault();
                e.stopPropagation();
                openCreateRow.__closeInlineCreate?.();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (!(await this.confirmDiscardInlineEdit())) {
                return;
            }
            globalCleanup();
            this.closeBookmarkFormModal();
        };

        const globalCleanup = () => {
            document.removeEventListener('keydown', onGlobalEsc, true);
            if (d._inlineEditGlobalCleanup === globalCleanup) d._inlineEditGlobalCleanup = null;
            if (d._inlineEditAutoFetchClear === clearInlineAutoFetchTimer) {
                d._inlineEditAutoFetchClear = null;
            }
        };

        const clearInlineAutoFetchTimer = () => {
            if (inlineAutoFetchTimer) {
                clearTimeout(inlineAutoFetchTimer);
                inlineAutoFetchTimer = null;
            }
            inlineAutoFetchInFlight = false;
        };

        d._inlineEditAutoFetchClear = clearInlineAutoFetchTimer;
        d._inlineEditGlobalCleanup = globalCleanup;
        document.addEventListener('keydown', onGlobalEsc, true);
    }


    async commitBookmarkInlineEdit(bookmarkRef, fields, row) {
        const d = this.dash;
        const bookmark = bookmarkRef?.bookmark;
        if (!bookmark || !bookmarkRef) {
            return;
        }
        window.nextdashTrack?.('bookmark:edit', { source: 'dashboard' });

        const name = fields.nameInput.value.trim();
        const url = fields.urlInput.value.trim();
        const shortcut = fields.shortcutInput.value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
        const category = fields.catSelect.value;
        const sourcePageId = Number(bookmarkRef.pageId || d.currentPageId);
        const targetPageId = fields.pageSelect ? Number(fields.pageSelect.value) : null;
        const isPageMove = targetPageId !== null
            && Number.isFinite(targetPageId)
            && targetPageId !== sourcePageId;

        if (!name || !url) {
            d.notifyDashboard('nameAndUrlRequired', 'Name and URL are required.', 'error');
            return;
        }

        if (shortcut && this.hasShortcutConflict(shortcut, bookmarkRef)) {
            d.notifyDashboard('shortcutMustBeUnique', 'Shortcut must be unique across all bookmarks.', 'error');
            fields.shortcutInput.focus();
            fields.shortcutInput.select();
            return;
        }

        if (shortcut) {
            const finderShortcutConflict = (Array.isArray(d.finders) ? d.finders : []).some((finder) => {
                return String(finder?.shortcut || '').trim().toUpperCase() === shortcut;
            });
            if (finderShortcutConflict) {
                d.notifyConfig('shortcutFinderHint', 'Shortcut matches a finder shortcut.', 'error');
            }
        }

        const previousUrl = String(bookmark.url || '').trim();
        const parsedTags = fields.tagsInput
            ? fields.tagsInput.value.split(',').map(t => t.trim().toLowerCase()).filter((t, i, arr) => t && arr.indexOf(t) === i)
            : (bookmark.tags || []);
        const nextBookmarkState = {
            name,
            url,
            icon: typeof fields.getPendingIcon === 'function' ? fields.getPendingIcon() : bookmark.icon,
            shortcut,
            category,
            pinned: fields.pinInput ? fields.pinInput.checked : Boolean(bookmark.pinned),
            checkStatus: fields.statusInput.checked,
            monitor: fields.monitorInput ? fields.monitorInput.checked : Boolean(bookmark.monitor),
            monitorIntervalMinutes: fields.monitorIntervalInput
                ? Number(fields.monitorIntervalInput.value) || window.CheckMode.DEFAULT_INTERVAL_MINUTES
                : (bookmark.monitorIntervalMinutes || 0),
            note: fields.noteInput ? String(fields.noteInput.value || '').trim() : String(bookmark.note || '').trim(),
            tags: parsedTags
        };

        if (isPageMove) {
            await this._moveBookmarkToPage(bookmarkRef, nextBookmarkState, targetPageId, row);
            return;
        }

        if (bookmarkRef.scope === 'current') {
            const idx = Number(bookmarkRef.index);
            const live = (Number.isInteger(idx) && idx >= 0 && Array.isArray(d.bookmarks))
                ? d.bookmarks[idx]
                : null;
            const sameLive = live
                && String(live.url || '').trim() === String(bookmark?.url || '').trim();
            if (sameLive) {
                this.ensureBookmarkMutationSnapshot();
                Object.assign(live, nextBookmarkState);
                this.finalizeInlineEditAfterSave(row, bookmarkRef, previousUrl);
                await d.saveBookmarkOrder();
                await d.data?.refreshAfterBookmarkMutation?.({ pageIds: [sourcePageId] });
                return;
            }
        }

        const savedRemote = await this.saveRemoteBookmarkEdit(bookmarkRef, nextBookmarkState);
        if (!savedRemote) {
            return;
        }

        this.finalizeInlineEditAfterSave(row, bookmarkRef, previousUrl);
        await d.data?.refreshAfterBookmarkMutation?.({ pageIds: [sourcePageId] });
    }


    async createBookmarkFromForm(bookmarkRef, fields, { keepOpen = false } = {}) {
        const d = this.dash;
        window.nextdashTrack?.('bookmark-created', { source: 'modal' });

        const name = fields.nameInput.value.trim();
        let url = fields.urlInput.value.trim();
        url = window.BookmarkUrlUtils?.ensureHttpUrl?.(url) || url;
        const shortcut = fields.shortcutInput.value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
        const category = fields.catSelect.value;
        const pageId = fields.pageSelect ? Number(fields.pageSelect.value) : Number(bookmarkRef.pageId || d.currentPageId || 1);

        if (!name || !url) {
            d.notifyDashboard('nameAndUrlRequired', 'Name and URL are required.', 'error');
            return;
        }

        const emptyRef = { bookmark: {}, pageId, index: -1, scope: 'create' };
        if (shortcut && this.hasShortcutConflict(shortcut, emptyRef)) {
            d.notifyDashboard('shortcutMustBeUnique', 'Shortcut must be unique across all bookmarks.', 'error');
            fields.shortcutInput.focus();
            return;
        }

        const bookmark = {
            name,
            url,
            note: fields.noteInput ? String(fields.noteInput.value || '').trim() : '',
            shortcut,
            category,
            pinned: fields.pinInput ? fields.pinInput.checked : false,
            tags: fields.tagsInput
                ? fields.tagsInput.value.split(',').map((t) => t.trim().toLowerCase()).filter((t, i, arr) => t && arr.indexOf(t) === i)
                : [],
            icon: typeof fields.getPendingIcon === 'function' ? fields.getPendingIcon() : '',
            createdAt: Date.now(),
        };
        if (window.CheckMode) {
            bookmark.monitorIntervalMinutes = fields.monitorIntervalInput
                ? Number(fields.monitorIntervalInput.value) || window.CheckMode.DEFAULT_INTERVAL_MINUTES
                : 0;
            const mode = fields.monitorInput?.checked ? 'monitor' : (fields.statusInput?.checked ? 'periodic' : 'off');
            window.CheckMode.assign(bookmark, mode);
        } else {
            bookmark.checkStatus = Boolean(fields.statusInput?.checked);
            bookmark.monitor = Boolean(fields.monitorInput?.checked);
            bookmark.monitorIntervalMinutes = fields.monitorIntervalInput
                ? Number(fields.monitorIntervalInput.value) || 60
                : 0;
        }

        if (!Number.isFinite(pageId) || pageId < 1) {
            d.showErrorNotification(d.formatDashboardLabel('invalidPage', {}, 'Invalid page selected.'));
            return;
        }

        try {
            const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pageId, bookmark }),
            });
            if (!response.ok) {
                throw new Error(d.formatDashboardLabel('errorCreatingBookmark', {}, 'Could not create bookmark.'));
            }
            const onSaved = this._formModalContext?.onSaved;
            const pendingInboxPromoteId = d._pendingInboxPromoteId;

            if (keepOpen) {
                const keepPage = fields.pageSelect ? String(fields.pageSelect.value) : String(pageId);
                const keepCategory = fields.catSelect ? String(fields.catSelect.value) : category;
                fields.nameInput.value = '';
                fields.urlInput.value = '';
                if (fields.shortcutInput) fields.shortcutInput.value = '';
                if (fields.noteInput) fields.noteInput.value = '';
                if (fields.tagsInput) fields.tagsInput.value = '';
                if (fields.iconUrlInput) fields.iconUrlInput.value = '';
                if (fields.pinInput) fields.pinInput.checked = false;
                if (typeof fields.resetPendingIcon === 'function') fields.resetPendingIcon();
                if (fields.pageSelect) fields.pageSelect.value = keepPage;
                if (fields.catSelect) fields.catSelect.value = keepCategory;
                delete fields.nameInput.dataset.touched;
                delete fields.urlInput.dataset.touched;
                this.refreshInlineEditBaseline(bookmarkRef, fields);
                fields.urlInput.focus({ preventScroll: true });
            } else {
                // Close before refresh: while the modal is open, isInlineEditActive()
                // is true and loadPageBookmarks would prompt to discard unsaved edits —
                // often behind the modal, which looks like a freeze.
                this.closeBookmarkFormModal({ silent: true, clearInboxPromote: false });
            }

            if (pendingInboxPromoteId && d.inbox) {
                d._pendingInboxPromoteId = null;
                await d.inbox.completePromote(pendingInboxPromoteId);
                if (bookmark.checkStatus === true || bookmark.monitor === true) {
                    d.inbox.triggerHealthCheckForUrl?.(bookmark.url);
                }
            }

            d.data?.invalidatePageDataCache?.(pageId);
            try {
                await d.data?.refreshAfterBookmarkMutation?.({
                    pageIds: [pageId],
                    despiteModal: keepOpen,
                });
            } catch (refreshError) {
                console.warn('Bookmark created but dashboard refresh failed:', refreshError);
            }

            d.showNotification(d.formatDashboardLabel('bookmarkCreated', {}, 'Bookmark created.'), 'success');
            window.nextdashTrack?.('bookmark-created', {
                result: 'ok',
                withIcon: Boolean(bookmark.icon),
                withTags: Array.isArray(bookmark.tags) && bookmark.tags.length > 0,
                withShortcut: Boolean(bookmark.shortcut),
            });
            if (typeof onSaved === 'function') {
                await onSaved();
            }
        } catch (error) {
            d.showErrorNotification(error.message || d.formatDashboardLabel('errorCreatingBookmark', {}, 'Could not create bookmark.'));
        }
    }


    cancelBookmarkInlineEdit(row, bookmarkRef) {
        if (document.getElementById('bookmark-form-modal')?.classList.contains('show')) {
            void this.requestCloseBookmarkFormModal();
            return;
        }
        const d = this.dash;
        d._inlineEditGlobalCleanup?.();
        d._inlineEditAutoFetchClear?.();
        d._inlineEditAutoFetchClear = null;
        this.leaveBookmarkInlineEditFocusMode();
        d._inlineEditContext = null;
        const bookmark = bookmarkRef?.bookmark;
        if (!bookmark) {
            d.inlineEditingBookmarkIndex = null;
            d.renderDashboard({ incremental: false });
            return;
        }
        d.inlineEditingBookmarkIndex = null;
        row?.classList?.remove('bookmark-inline-editing');
        this.restoreInlineEditRow(row, bookmarkRef);
    }


    enterBookmarkInlineEditFocusMode() {
        const d = this.dash;
        document.body.classList.add('bookmark-inline-edit-active');
        d.keyboardNavigation?.disable?.();
        window.FocusTrapUtils?.syncDashboardInert?.();
    }


    leaveBookmarkInlineEditFocusMode() {
        const d = this.dash;
        document.body.classList.remove('bookmark-inline-edit-active');
        this.clearInlineEditSurfaceOverrides();
        d.keyboardNavigation?.enable?.();
        window.FocusTrapUtils?.syncDashboardInert?.();
    }


    finishInlineEditCommit(row) {
        const d = this.dash;
        const onSaved = this._formModalContext?.onSaved;
        d._inlineEditGlobalCleanup?.();
        d._inlineEditAutoFetchClear?.();
        d._inlineEditAutoFetchClear = null;
        d.inlineEditingBookmarkIndex = null;
        d._inlineEditContext = null;
        d._inlineEditWasKeyboardSelected = false;
        row?.classList?.remove('bookmark-inline-editing');
        this.closeBookmarkFormModal({ silent: true });
        if (typeof onSaved === 'function') {
            void onSaved();
        }
    }


    restoreInlineEditRow(row, bookmarkRef) {
        const d = this.dash;
        const bookmark = bookmarkRef?.bookmark;
        if (!row || !bookmark || !document.contains(row)) {
            return false;
        }
        const categoryId = bookmark.category || row.getAttribute('data-category-id') || '';
        d.populateBookmarkRowView(row, bookmark, categoryId, true);
        d.destroyCategoryReorderInstances();
        d.initializeCategoryReorder();

        const kn = d.keyboardNavigation;
        d._inlineEditWasKeyboardSelected = false;
        // The row you just edited stays selected and visibly highlighted, however
        // the editor was opened. Arrow keys then move off it to the next row, the
        // same as any other selected row — you keep your place without the first
        // keypress appearing to do nothing.
        if (kn?.selectBookmarkRow?.(row, { focus: true })) {
            return true;
        }
        const openLink = row.querySelector('a.bookmark-open');
        if (openLink && typeof openLink.focus === 'function') {
            openLink.focus({ preventScroll: true });
        }
        return true;
    }


    finalizeInlineEditAfterSave(row, bookmarkRef, previousUrl) {
        const d = this.dash;
        this.finishInlineEditCommit(row);
        d.syncEditedBookmarkAcrossCollections(bookmarkRef, previousUrl);
    }


    hasShortcutConflict(shortcut, bookmarkRef) {
        const d = this.dash;
        const normalized = String(shortcut || '').trim().toUpperCase();
        if (!normalized) {
            return false;
        }

        const ignoreBookmarkIndex = bookmarkRef?.scope === 'current' ? bookmarkRef.index : -1;
        const localConflict = (Array.isArray(d.bookmarks) ? d.bookmarks : []).some((bookmark, index) => {
            if (index === ignoreBookmarkIndex) {
                return false;
            }
            return String(bookmark?.shortcut || '').trim().toUpperCase() === normalized;
        });
        if (localConflict) {
            return true;
        }

        if (d.settings.globalShortcuts !== true) {
            return false;
        }

        const currentPageIdNumber = Number(d.currentPageId);
        return (Array.isArray(d.allBookmarks) ? d.allBookmarks : []).some((bookmark) => {
            const shortcutValue = String(bookmark?.shortcut || '').trim().toUpperCase();
            if (!shortcutValue || shortcutValue !== normalized) {
                return false;
            }
            if (bookmarkRef?.scope === 'remote' && d.isSameBookmarkReference(bookmarkRef, bookmark)) {
                return false;
            }
            if (bookmarkRef?.scope === 'current' && d.isSameBookmarkReference(bookmarkRef, bookmark)) {
                return false;
            }
            const bookmarkPageId = Number(bookmark?.pageId || bookmark?.pageID || 0);
            return bookmarkPageId !== currentPageIdNumber;
        });
    }


    async uploadBookmarkIconFromUrl(iconUrl) {
        const d = this.dash;
        try {
            const response = await dashFetch('/api/icon/from-url', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: iconUrl })
            });
            if (!response.ok) {
                return '';
            }
            const result = await response.json();
            return String(result?.icon || '').trim();
        } catch (error) {
            return '';
        }
    }


    async uploadBookmarkIconFile(file) {
        const d = this.dash;
        const formData = new FormData();
        formData.append('icon', file);
        try {
            const response = await dashFetch('/api/icon', {
                method: 'POST',
                body: formData
            });
            if (!response.ok) {
                return '';
            }
            const result = await response.json();
            return String(result?.icon || '').trim();
        } catch (error) {
            return '';
        }
    }


    deriveFaviconFromBookmarkUrl(bookmarkUrl) {
        const d = this.dash;
        const safeUrl = String(bookmarkUrl || '').trim();
        if (!safeUrl) {
            return '';
        }
        try {
            const parsed = new URL(safeUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return '';
            }
            return `${parsed.protocol}//${parsed.host}/favicon.ico`;
        } catch (_error) {
            return '';
        }
    }


    async fetchAndAssignFaviconForUrl(bookmarkUrl) {
        const d = this.dash;
        const safeUrl = String(bookmarkUrl || '').trim();
        if (!safeUrl) {
            return '';
        }
        try {
            const previewResponse = await dashFetch(`/api/bookmark-preview?url=${encodeURIComponent(safeUrl)}`);
            if (previewResponse.ok) {
                const preview = await previewResponse.json();
                const previewIconUrl = String(preview?.icon || '').trim();
                if (previewIconUrl) {
                    const iconFromPreview = await this.uploadBookmarkIconFromUrl(previewIconUrl);
                    if (iconFromPreview) {
                        return iconFromPreview;
                    }
                }
            }
        } catch (_error) {
            // Ignore and continue fallback.
        }
        const fallbackUrl = this.deriveFaviconFromBookmarkUrl(safeUrl);
        if (!fallbackUrl) {
            return '';
        }
        return this.uploadBookmarkIconFromUrl(fallbackUrl);
    }


    ensureBookmarkMutationSnapshot() {
        const d = this.dash;
        if (!d.pendingReorderSnapshot) {
            d.pendingReorderSnapshot = d.bookmarks.map((bm) => ({ ...bm }));
        }
    }

    /**
     * Open inline edit for keyboard-selected row, Tab-focused row (e.g. .bookmark-open), or smart list row without data-bookmark-index.
     * @returns {boolean} true if editor opened
     */

    _shouldSyncBookmarkMutation(bookmarkRef, candidate, previousUrlTrimmed) {
        const d = this.dash;
        if (!bookmarkRef || !candidate) {
            return false;
        }
        const updatedPageId = Number(bookmarkRef.pageId || d.currentPageId);
        const candidatePageId = Number(candidate.pageId || candidate.pageID || 0);
        if (candidatePageId !== updatedPageId) {
            return false;
        }
        const candidateUrl = String(candidate.url || '').trim();
        return d.isSameBookmarkReference(bookmarkRef, candidate)
            || (previousUrlTrimmed && candidateUrl === previousUrlTrimmed);
    }


    _applyBookmarkMutationFields(target, source) {
        const d = this.dash;
        if (!target || !source) {
            return;
        }
        target.name = source.name;
        target.url = source.url;
        target.icon = source.icon;
        target.shortcut = source.shortcut;
        target.category = source.category;
        target.pinned = source.pinned;
        target.checkStatus = source.checkStatus;
        target.monitor = source.monitor;
        target.monitorIntervalMinutes = source.monitorIntervalMinutes;
        target.note = source.note || '';
        target.tags = Array.isArray(source.tags) ? [...source.tags] : [];
    }


    async confirmDeleteBookmarkInline(bookmark) {
        const d = this.dash;
        if (!bookmark) {
            return false;
        }
        if (window.AppModal && typeof window.AppModal.danger === 'function') {
            const safeName = String(bookmark.name || d.bookmarkFallbackName()).replace(/</g, '');
            return window.AppModal.danger({
                title: d.configLabel('removeBookmarkTitle', 'Remove bookmark'),
                message: d.formatDashboardLabel('deleteBookmarkConfirm', { name: safeName }, `Remove "${safeName}"?`),
                confirmText: d.configLabel('delete', 'Delete'),
                cancelText: d.formatDashboardLabel('cancel', {}, 'Cancel'),
                modalClass: 'inline-edit-confirm-modal'
            });
        }
        return window.confirm(d.configLabel('removeBookmarkMessage', 'Delete this bookmark?'));
    }


    async deleteBookmarkInline(bookmarkRef, options = {}) {
        const d = this.dash;
        if (!bookmarkRef?.bookmark) {
            return;
        }
        // Both branches below end in a delete, so count it once here rather than
        // in each of them.
        window.nextdashTrack?.('bookmark:delete');
        if (bookmarkRef.scope === 'current') {
            await this.deleteBookmarkAtIndexInline(bookmarkRef, options);
            return;
        }
        await this.deleteRemoteBookmarkInline(bookmarkRef, options);
    }


    async deleteBookmarkAtIndexInline(bookmarkRefOrIndex, options = {}) {
        const d = this.dash;
        const bookmarkRef = typeof bookmarkRefOrIndex === 'object' && bookmarkRefOrIndex !== null
            ? bookmarkRefOrIndex
            : {
                bookmark: d.bookmarks[bookmarkRefOrIndex],
                index: bookmarkRefOrIndex,
                scope: 'current',
                pageId: d.currentPageId,
                original: d.bookmarks[bookmarkRefOrIndex]
                    ? { ...d.bookmarks[bookmarkRefOrIndex] }
                    : null
            };
        const bookmark = bookmarkRef.bookmark;
        if (!bookmark) {
            return;
        }

        const confirmed = options.skipConfirm || await this.confirmDeleteBookmarkInline(bookmark);
        if (!confirmed) {
            return;
        }

        let deleteIndex = d.findBookmarkIndexByReference(d.bookmarks, bookmarkRef);
        if (deleteIndex < 0 && Number.isInteger(bookmarkRef.index) && bookmarkRef.index >= 0) {
            deleteIndex = bookmarkRef.index;
        }
        if (deleteIndex < 0 || !d.bookmarks[deleteIndex]) {
            d.showErrorNotification(
                d.formatDashboardLabel('bookmarkNotFoundOnSourcePage', {}, 'Could not locate bookmark on source page.')
            );
            return;
        }

        this.ensureBookmarkMutationSnapshot();
        const deletedBookmark = { ...d.bookmarks[deleteIndex] };
        const deletedIndex = deleteIndex;
        const deleteRef = {
            ...bookmarkRef,
            bookmark: d.bookmarks[deleteIndex],
            index: deleteIndex,
            pageId: Number(bookmarkRef.pageId || d.currentPageId),
            original: bookmarkRef.original || { ...deletedBookmark }
        };
        d.removeBookmarkFromAllBookmarks(deleteRef);
        d.bookmarks.splice(deleteIndex, 1);
        this.finishInlineEditCommit(d._inlineEditContext?.row);

        await d.saveBookmarkOrder();
        await d.data?.refreshAfterBookmarkMutation?.({ pageIds: [deleteRef.pageId] });

        // Recorded after the page save so a delete that did not persist cannot
        // leave a phantom entry in the trash. The toast undo below is the fast
        // path; the trash is what catches it an hour later.
        await window.DashboardTrash?.record(
            [{ pageId: deleteRef.pageId, index: deletedIndex, bookmark: deletedBookmark }],
            'dashboard'
        );

        const deletedLabel = String(deletedBookmark.name || deletedBookmark.url).slice(0, 40);
        d.showNotification(
            d.formatDashboardLabel('bookmarkDeleted', { name: deletedLabel }, `"${deletedLabel}" deleted`),
            'success',
            {
                duration: 5000,
                undoCallback: async () => {
                    d.bookmarks.splice(deletedIndex, 0, deletedBookmark);
                    d.restoreBookmarkInAllBookmarks(deletedBookmark, deleteRef.pageId);
                    d.pendingReorderSnapshot = null;
                    try {
                        await d.saveBookmarkOrder();
                        await d.data?.refreshAfterBookmarkMutation?.({ pageIds: [deleteRef.pageId] });
                    } catch (_error) {
                        // saveBookmarkOrder already surfaces errors and reverts when possible.
                    }
                }
            }
        );
    }


    async deleteRemoteBookmarkInline(bookmarkRef, options = {}) {
        const d = this.dash;
        const bookmark = bookmarkRef.bookmark;
        const confirmed = options.skipConfirm || await this.confirmDeleteBookmarkInline(bookmark);
        if (!confirmed) {
            return;
        }

        const sourcePageId = Number(bookmarkRef.pageId || 0);
        if (!Number.isFinite(sourcePageId) || sourcePageId <= 0) {
            d.showErrorNotification(
                d.formatDashboardLabel('bookmarkSourcePageUnresolved', {}, 'Unable to resolve bookmark source page.')
            );
            return;
        }

        try {
            // Single-item delete instead of a whole-list read-modify-write: the
            // old GET-splice-POST raced any concurrent write to the source page
            // landing between the read and the save, silently clobbering it.
            // DELETE /api/bookmarks matches and removes the one bookmark
            // atomically under the store's own lock, so there is no window for
            // a concurrent write to be lost.
            const deleteRes = await dashFetch('/api/bookmarks', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: sourcePageId, bookmark })
            });
            if (!deleteRes.ok) {
                if (deleteRes.status === 404) {
                    throw new Error(d.formatDashboardLabel('bookmarkNotFoundOnSourcePage', {}, 'Could not locate bookmark on source page.'));
                }
                throw new Error(d.formatDashboardLabel('saveBookmarkDeletionFailed', {}, 'Failed to save bookmark deletion.'));
            }

            d._inlineEditGlobalCleanup?.();
            d.inlineEditingBookmarkIndex = null;
            this.finishInlineEditCommit(d._inlineEditContext?.row);
            d.data?.invalidatePageDataCache?.(sourcePageId);
            await d.data?.refreshAfterBookmarkMutation?.({ pageIds: [sourcePageId] });

            const deletedLabel = String(bookmark.name || bookmark.url).slice(0, 40);
            d.showNotification(
                d.formatDashboardLabel('bookmarkDeleted', { name: deletedLabel }, `"${deletedLabel}" deleted`),
                'success'
            );
        } catch (error) {
            d.showErrorNotification(
                error.message || d.formatDashboardLabel('deleteBookmarkFailed', {}, 'Failed to delete bookmark.')
            );
        }
    }


    async saveRemoteBookmarkEdit(bookmarkRef, editedBookmark) {
        const d = this.dash;
        const pageId = Number(bookmarkRef.pageId || 0);
        if (!Number.isFinite(pageId) || pageId <= 0) {
            d.showErrorNotification(
                d.formatDashboardLabel('bookmarkSourcePageUnresolved', {}, 'Unable to resolve bookmark source page.')
            );
            return false;
        }

        try {
            const pageResponse = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!pageResponse.ok) {
                throw new Error(d.formatDashboardLabel('loadSourcePageBookmarksFailed', {}, 'Failed to load source page bookmarks.'));
            }
            const sourceBookmarks = await pageResponse.json();
            const sourceIndex = d.findBookmarkIndexByReference(sourceBookmarks, bookmarkRef);
            if (sourceIndex < 0) {
                throw new Error(d.formatDashboardLabel('bookmarkNotFoundOnSourcePage', {}, 'Could not locate original bookmark on source page.'));
            }

            sourceBookmarks[sourceIndex] = {
                ...sourceBookmarks[sourceIndex],
                name: editedBookmark.name,
                url: editedBookmark.url,
                icon: editedBookmark.icon,
                shortcut: editedBookmark.shortcut,
                category: editedBookmark.category,
                pinned: editedBookmark.pinned,
                checkStatus: editedBookmark.checkStatus,
                monitor: editedBookmark.monitor,
                monitorIntervalMinutes: editedBookmark.monitorIntervalMinutes,
                note: editedBookmark.note || '',
                tags: Array.isArray(editedBookmark.tags) ? editedBookmark.tags : []
            };

            const saveResponse = await dashFetch(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sourceBookmarks)
            });
            if (!saveResponse.ok) {
                throw new Error(d.formatDashboardLabel('saveBookmarkOnSourcePageFailed', {}, 'Failed to save bookmark on source page.'));
            }

            Object.assign(bookmarkRef.bookmark, editedBookmark);
            d.syncEditedBookmarkAcrossCollections(bookmarkRef, bookmarkRef.original?.url || '');
            d.data?.invalidatePageDataCache?.(pageId);
            void d.data?.fetchAndStoreDataRevision?.();
            return true;
        } catch (error) {
            d.showErrorNotification(
                error.message || d.formatDashboardLabel('saveBookmarkChangesFailed', {}, 'Failed to save bookmark changes.')
            );
            return false;
        }
    }


    async _moveBookmarkToPage(bookmarkRef, bookmarkState, targetPageId, row) {
        const d = this.dash;
        const sourcePageId = Number(bookmarkRef.pageId || d.currentPageId);
        const isCurrentScope = bookmarkRef.scope === 'current';
        const bookmarksSnapshot = isCurrentScope ? [...d.bookmarks] : null;
        const headers = { 'Content-Type': 'application/json' };

        try {
            if (row) {
                row.classList.add('bookmark-move-out');
                await new Promise(resolve => setTimeout(resolve, 320));
            }

            // No ensureBookmarkMutationSnapshot() here: that sets
            // d.pendingReorderSnapshot for saveBookmarkOrder()'s whole-list
            // rollback path, which this method no longer calls. Left set, an
            // unrelated debounced reorder-save (scheduleBookmarkOrderSave) could
            // still fire afterwards and flush that stale pre-move snapshot back
            // to the source page, silently undoing the delete below.

            // Single-item add + delete instead of a whole-list read-modify-write
            // on each side: two full-array snapshots taken up front raced against
            // any concurrent write to either page, and if the source save
            // succeeded but the target save failed, the bookmark vanished from
            // both lists entirely. AddBookmark/DeleteBookmark are each atomic
            // under the store's own lock, so a mid-move failure now leaves the
            // bookmark exactly where it started rather than nowhere.
            const addRes = await dashFetch('/api/bookmarks/add', {
                method: 'POST',
                headers,
                body: JSON.stringify({ page: targetPageId, bookmark: { ...bookmarkState } }),
            });
            if (!addRes.ok) {
                let message = 'Failed to save target page bookmarks.';
                try {
                    const body = await addRes.json();
                    if (body?.message) message = body.message;
                } catch { /* non-JSON error body, keep the default message */ }
                throw new Error(message);
            }

            const deleteRes = await dashFetch('/api/bookmarks', {
                method: 'DELETE',
                headers,
                body: JSON.stringify({ page: sourcePageId, bookmark: bookmarkState }),
            });
            if (!deleteRes.ok) {
                // The copy on the target page is now the only way to avoid losing
                // the bookmark outright, so leave it there and surface a clear
                // error rather than trying to undo the add and risk losing both.
                throw new Error('Bookmark copied to the target page but could not be removed from the source page.');
            }

            if (isCurrentScope) {
                const removeIndex = d.findBookmarkIndexByReference(d.bookmarks, bookmarkRef);
                if (removeIndex >= 0) {
                    d.bookmarks = [...d.bookmarks];
                    d.bookmarks.splice(removeIndex, 1);
                }
            }

            const targetPage = (Array.isArray(d.pages) ? d.pages : []).find(p => Number(p.id) === targetPageId);
            const targetName = targetPage?.name || String(targetPageId);

            d._inlineEditGlobalCleanup?.();
            d._inlineEditAutoFetchClear?.();
            d._inlineEditAutoFetchClear = null;
            d.inlineEditingBookmarkIndex = null;
            d._inlineEditContext = null;
            this.finishInlineEditCommit(row);

            await d.data?.refreshAfterBookmarkMutation?.({
                pageIds: [sourcePageId, targetPageId],
            });
            d.showNotification(
                d.formatDashboardLabel('movedToCategory', { name: targetName }, `Moved to "${targetName}".`),
                'success'
            );
        } catch (err) {
            if (row) {
                row.classList.remove('bookmark-move-out');
            }
            if (isCurrentScope && bookmarksSnapshot) {
                d.bookmarks = bookmarksSnapshot;
            }
            d.showErrorNotification(
                err.message || d.formatDashboardLabel('moveBookmarkFailed', {}, 'Failed to move bookmark.')
            );
        }
    }


    attachBookmarkRowLongPress(row, openLink, bookmarkRef, signal) {
        const d = this.dash;
        const longMs = DashboardInlineEdit.ROW_LONG_PRESS_MS;
        const slop = 8;
        let timer = null;
        let startX = 0;
        let startY = 0;
        let activePointerId = null;

        const clearTimer = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            row.classList.remove('bookmark-longpress-armed');
            activePointerId = null;
        };

        const onPointerDown = (e) => {
            if (e.button !== undefined && e.button !== 0) {
                return;
            }
            if (e.target.closest('.bookmark-reorder-handle')) {
                return;
            }
            if (e.target.closest('.bookmark-inline-form')) {
                return;
            }
            clearTimer();
            startX = e.clientX;
            startY = e.clientY;
            activePointerId = e.pointerId;
            row.classList.add('bookmark-longpress-armed');
            timer = setTimeout(() => {
                timer = null;
                row.classList.remove('bookmark-longpress-armed');
                activePointerId = null;
                if (row.classList.contains('bookmark-inline-editing')) {
                    return;
                }
                // A drag in progress (mouse or touch) must never turn into an edit.
                if (document.body.classList.contains('bookmark-dragging')
                    || row.classList.contains('is-draggable')) {
                    return;
                }
                this.openBookmarkInlineEditor(row, bookmarkRef);
                const blockNav = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    openLink.removeEventListener('click', blockNav, true);
                };
                openLink.addEventListener('click', blockNav, { capture: true, once: true });
            }, longMs);
        };

        const onPointerMove = (e) => {
            if (activePointerId !== null && e.pointerId !== activePointerId) {
                return;
            }
            if (!timer) {
                return;
            }
            const dx = Math.abs(e.clientX - startX);
            const dy = Math.abs(e.clientY - startY);
            if (dx > slop || dy > slop) {
                clearTimer();
            }
        };

        const onPointerEnd = (e) => {
            if (activePointerId !== null && e.pointerId !== activePointerId) {
                return;
            }
            clearTimer();
        };

        /* Once a native HTML5 drag begins, the browser stops sending pointermove
           (it sends drag events instead), so the slop check above never fires and
           the long-press timer would open the editor mid-drag. Cancel on dragstart
           so a reorder never turns into an inline edit. */
        const onDragStart = () => clearTimer();

        /* Bubble phase: avoid stealing native drag from .bookmark-reorder-handle (capture broke DnD in some browsers). */
        row.addEventListener('pointerdown', onPointerDown, { capture: false, signal });
        row.addEventListener('pointermove', onPointerMove, { capture: false, signal });
        row.addEventListener('pointerup', onPointerEnd, { capture: false, signal });
        row.addEventListener('pointerleave', onPointerEnd, { capture: false, signal });
        row.addEventListener('pointercancel', onPointerEnd, { capture: false, signal });
        row.addEventListener('lostpointercapture', onPointerEnd, { capture: false, signal });
        row.addEventListener('dragstart', onDragStart, { capture: true, signal });
    }


    syncInlineEditCategoryAfterMove(categoryId, affectedRefs = []) {
        const d = this.dash;
        const ctx = d._inlineEditContext;
        if (!ctx?.fields?.catSelect || !ctx.bookmarkRef?.bookmark) {
            return;
        }

        const editingRef = ctx.bookmarkRef;
        const isAffected = (affectedRefs || []).some((ref) => (
            ref === editingRef
            || ref?.bookmark === editingRef.bookmark
            || d.isSameBookmarkReference(editingRef, ref?.bookmark)
        ));
        if (!isAffected) {
            return;
        }

        const normalizedCategoryId = String(categoryId ?? '');
        ctx.fields.catSelect.value = normalizedCategoryId;
        editingRef.bookmark.category = categoryId;
        if (editingRef.original) {
            editingRef.original.category = categoryId;
        }
    }

}

DashboardInlineEdit.ROW_LONG_PRESS_MS = 500;
DashboardInlineEdit.CLICK_OUTSIDE_DELAY_MS = 500;

window.DashboardInlineEdit = DashboardInlineEdit;
