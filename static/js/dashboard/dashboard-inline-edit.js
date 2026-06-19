/**
 * Inline bookmark editor and related guards.
 */
class DashboardInlineEdit {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    isInlineEditActive() {
        const d = this.dash;
        return d.inlineEditingBookmarkIndex !== null || Boolean(document.querySelector('.bookmark-inline-editing'));
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
        const pinned = fields.pinInput.checked;
        const checkStatus = fields.statusInput.checked;
        const note = fields.noteInput ? String(fields.noteInput.value || '').trim() : '';
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
            : Number(ctx.bookmarkRef.pageId || d.currentPageId);
        const originalPageId = Number(ctx.bookmarkRef.pageId || d.currentPageId);

        return name !== String(original.name || '').trim()
            || url !== String(original.url || '').trim()
            || shortcut !== String(original.shortcut || '').trim().toUpperCase()
            || category !== String(original.category || '')
            || pinned !== Boolean(original.pinned)
            || checkStatus !== Boolean(original.checkStatus)
            || note !== String(original.note || '').trim()
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
                confirmClass: 'danger'
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

    openBookmarkInlineEditor(row, bookmarkRef) {
        const d = this.dash;
        if (!bookmarkRef || !bookmarkRef.bookmark) {
            return;
        }
        // Inline editor should always take focus; clear any active preview card/timers first.
        d.dismissBookmarkPreviewInteractions();
        const bookmark = bookmarkRef.bookmark;
        if (!bookmark) {
            return;
        }
        if (row._bookmarkLongPressAbort) {
            row._bookmarkLongPressAbort.abort();
            row._bookmarkLongPressAbort = null;
        }

        const bookmarkIndex = bookmarkRef.scope === 'current' ? bookmarkRef.index : -1;
        d.inlineEditingBookmarkIndex = bookmarkIndex;
        row.classList.add('bookmark-inline-editing');
        row.innerHTML = '';

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

        // Note field
        const noteInput = document.createElement('textarea');
        noteInput.className = 'bookmark-inline-textarea';
        noteInput.value = bookmark.note || '';
        form.appendChild(mkField(d.language.t('bookmark.noteLabel') || 'Note', noteInput));

        const tagsInput = document.createElement('input');
        tagsInput.type = 'text';
        tagsInput.className = 'bookmark-inline-input';
        tagsInput.placeholder = cfg('detailTagsPlaceholder', 'work, dev, personal…');
        tagsInput.value = (Array.isArray(bookmark.tags) ? bookmark.tags : []).join(', ');
        form.appendChild(mkField(cfg('detailTagsLabel', 'Tags'), tagsInput));
        // Seed session pool from loaded bookmarks
        (d.allBookmarks?.length ? d.allBookmarks : d.bookmarks ?? []).forEach(bm => (bm.tags || []).forEach(t => _sessionTags.add(t)));
        TagAutocomplete.attach(tagsInput, () => {
            tagsInput.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).forEach(t => _sessionTags.add(t));
            return [..._sessionTags];
        });

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
        form.appendChild(shortcutField);

        const catSelect = document.createElement('select');
        catSelect.className = 'bookmark-inline-select';
        const optEmpty = document.createElement('option');
        optEmpty.value = '';
        optEmpty.textContent = '—';
        catSelect.appendChild(optEmpty);
        (d.categories || []).forEach((cat) => {
            const o = document.createElement('option');
            o.value = cat.id || '';
            o.textContent = cat.name || cat.id || '';
            if (String(bookmark.category ?? '') === String(cat.id ?? '')) {
                o.selected = true;
            }
            catSelect.appendChild(o);
        });
        form.appendChild(mkField(cfg('category', 'Category'), catSelect));

        const pageSelect = document.createElement('select');
        pageSelect.className = 'bookmark-inline-select';
        const currentPageId = Number(d.currentPageId);
        const sourcePageId = Number(bookmarkRef.pageId || d.currentPageId);
        (Array.isArray(d.pages) ? d.pages : []).forEach((page) => {
            const o = document.createElement('option');
            o.value = page.id;
            o.textContent = page.name || String(page.id);
            if (Number(page.id) === sourcePageId) o.selected = true;
            pageSelect.appendChild(o);
        });
        form.appendChild(mkField(cfg('page', 'Page'), pageSelect));

        const reloadCatSelectForPage = async (pageId) => {
            const isCurrentPage = Number(pageId) === currentPageId;
            const cats = isCurrentPage
                ? (d.categories || [])
                : await fetch(`/api/categories?page=${pageId}`).then(r => r.ok ? r.json() : []).catch(() => []);
            const prevValue = catSelect.value;
            catSelect.innerHTML = '';
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '—';
            catSelect.appendChild(empty);
            let matched = false;
            cats.forEach(cat => {
                const o = document.createElement('option');
                o.value = cat.id || '';
                o.textContent = cat.name || cat.id || '';
                if ((cat.id || '') === prevValue) { o.selected = true; matched = true; }
                catSelect.appendChild(o);
            });
            // No match from previous page — default to first real category so bookmark doesn't land in Others
            if (!matched && cats.length > 0) {
                catSelect.selectedIndex = 1;
            }
        };

        pageSelect.addEventListener('change', () => reloadCatSelectForPage(pageSelect.value));
        if (bookmarkRef.scope === 'remote' && sourcePageId !== currentPageId) {
            void reloadCatSelectForPage(sourcePageId);
        }

        const pinInput = document.createElement('input');
        pinInput.type = 'checkbox';
        pinInput.id = `bookmark-inline-pin-${bookmarkIndex >= 0 ? bookmarkIndex : `remote-${bookmarkRef.pageId}`}`;
        pinInput.checked = Boolean(bookmark.pinned);
        const pinWrap = document.createElement('div');
        pinWrap.className = 'bookmark-inline-field bookmark-inline-check';
        const pinLabel = document.createElement('label');
        pinLabel.htmlFor = pinInput.id;
        pinLabel.textContent = cfg('pinnedShort', 'Pinned');
        pinWrap.appendChild(pinInput);
        pinWrap.appendChild(pinLabel);
        form.appendChild(pinWrap);

        const statusInput = document.createElement('input');
        statusInput.type = 'checkbox';
        statusInput.id = `bookmark-inline-status-${bookmarkIndex >= 0 ? bookmarkIndex : `remote-${bookmarkRef.pageId}`}`;
        statusInput.checked = Boolean(bookmark.checkStatus);
        const statusWrap = document.createElement('div');
        statusWrap.className = 'bookmark-inline-field bookmark-inline-check';
        const statusLabel = document.createElement('label');
        statusLabel.htmlFor = statusInput.id;
        statusLabel.textContent = cfg('statusCheck', 'Status check');
        statusWrap.appendChild(statusInput);
        statusWrap.appendChild(statusLabel);
        form.appendChild(statusWrap);

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

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'bookmark-inline-action-btn bookmark-inline-save';
        saveBtn.textContent = cfg('saveChanges', 'Save');
        saveBtn.disabled = !validateForm();
        saveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!validateForm(true)) return;
            await this.commitBookmarkInlineEdit(bookmarkRef, {
                nameInput,
                urlInput,
                iconUrlInput,
                shortcutInput,
                catSelect,
                pageSelect,
                pinInput,
                statusInput,
                noteInput,
                tagsInput,
                getPendingIcon: () => pendingIcon
            }, row);
        });

        nameInput.addEventListener('input', () => { nameInput.dataset.touched = '1'; saveBtn.disabled = !validateForm(); });
        urlInput.addEventListener('input', () => { urlInput.dataset.touched = '1'; saveBtn.disabled = !validateForm(); });
        nameInput.addEventListener('blur', () => { nameInput.dataset.touched = '1'; validateForm(); });
        urlInput.addEventListener('blur', () => {
            const normalized = window.BookmarkUrlUtils?.ensureHttpUrl(urlInput.value) || urlInput.value.trim();
            if (normalized && normalized !== urlInput.value.trim()) urlInput.value = normalized;
            urlInput.dataset.touched = '1';
            validateForm();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'bookmark-inline-action-btn';
        cancelBtn.textContent = d.formatDashboardLabel('cancel', {}, 'Cancel');
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.cancelBookmarkInlineEdit(row, bookmarkRef);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'bookmark-inline-action-btn bookmark-inline-delete';
        deleteBtn.textContent = cfg('delete', 'Delete');
        deleteBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        deleteBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await this.deleteBookmarkInline(bookmarkRef);
        });

        actions.appendChild(saveBtn);
        actions.appendChild(cancelBtn);
        actions.appendChild(deleteBtn);

        const hint = document.createElement('span');
        hint.className = 'bookmark-inline-hint';
        hint.textContent = d.formatDashboardLabel(
            'inlineEditHint',
            {},
            'Ctrl+Enter to save · Esc to cancel'
        );
        actions.appendChild(hint);

        form.appendChild(actions);

        form.addEventListener('keydown', async (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (!(await this.confirmDiscardInlineEdit())) {
                    return;
                }
                this.cancelBookmarkInlineEdit(row, bookmarkRef);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                saveBtn.click();
            }
        });

        const rowRect = row.getBoundingClientRect();
        const formExpectedWidth = Math.max(rowRect.width, Math.min(420, window.innerWidth * 0.9));
        const rightOverflow = (rowRect.left + formExpectedWidth) - (window.innerWidth - 8);
        if (rightOverflow > 0) {
            form.style.marginLeft = `-${Math.ceil(rightOverflow)}px`;
        }

        row.appendChild(form);
        requestAnimationFrame(() => window.DashboardFeaturePromos?.reposition?.());
        d.destroyCategoryReorderInstances();
        d.initializeCategoryReorder();
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
                noteInput,
                tagsInput,
                getPendingIcon: () => pendingIcon
            }
        };
        this.enterBookmarkInlineEditFocusMode();
        nameInput.focus();
        nameInput.select();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.DashboardFeaturePromos?.tryShow?.('inlineEdit', form);
            });
        });

        // Global ESC: close the form even when focus has drifted outside it
        const onGlobalEsc = async (e) => {
            if (e.key !== 'Escape') return;
            if (!document.contains(form)) { globalCleanup(); return; }
            if (d.isModalOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            if (!(await this.confirmDiscardInlineEdit())) {
                return;
            }
            globalCleanup();
            this.cancelBookmarkInlineEdit(row, bookmarkRef);
        };

        // Click-outside: close on mousedown anywhere outside the form
        const onGlobalClickOutside = async (e) => {
            if (!document.contains(form)) { globalCleanup(); return; }
            if (form.contains(e.target)) return;
            if (e.target.closest?.('#app-modal')) return;
            if (d.isModalOpen()) return;
            if (!(await this.confirmDiscardInlineEdit())) {
                return;
            }
            globalCleanup();
            this.cancelBookmarkInlineEdit(row, bookmarkRef);
        };

        const clearInlineAutoFetchTimer = () => {
            if (inlineAutoFetchTimer) {
                clearTimeout(inlineAutoFetchTimer);
                inlineAutoFetchTimer = null;
            }
            inlineAutoFetchInFlight = false;
        };

        const globalCleanup = () => {
            document.removeEventListener('keydown', onGlobalEsc, true);
            document.removeEventListener('mousedown', onGlobalClickOutside, true);
            clearInlineAutoFetchTimer();
            if (d._inlineEditGlobalCleanup === globalCleanup) d._inlineEditGlobalCleanup = null;
            if (d._inlineEditAutoFetchClear === clearInlineAutoFetchTimer) {
                d._inlineEditAutoFetchClear = null;
            }
        };

        d._inlineEditAutoFetchClear = clearInlineAutoFetchTimer;

        d._inlineEditGlobalCleanup = globalCleanup;
        document.addEventListener('keydown', onGlobalEsc, true);
        // Delay click-outside to skip the mousedown that may have opened the form
        setTimeout(() => document.addEventListener('mousedown', onGlobalClickOutside, true), 0);
    }


    async commitBookmarkInlineEdit(bookmarkRef, fields, row) {
        const d = this.dash;
        const bookmark = bookmarkRef?.bookmark;
        if (!bookmark || !bookmarkRef) {
            return;
        }

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
            pinned: fields.pinInput.checked,
            checkStatus: fields.statusInput.checked,
            note: fields.noteInput ? String(fields.noteInput.value || '').trim() : (bookmark.note || ''),
            tags: parsedTags
        };

        if (isPageMove) {
            await this._moveBookmarkToPage(bookmarkRef, nextBookmarkState, targetPageId, row);
            return;
        }

        if (bookmarkRef.scope === 'current') {
            this.ensureBookmarkMutationSnapshot();
            Object.assign(bookmark, nextBookmarkState);
            d._inlineEditGlobalCleanup?.();
            d.inlineEditingBookmarkIndex = null;
            d._inlineEditContext = null;
            d.syncEditedBookmarkAcrossCollections(bookmarkRef, previousUrl);
            d.renderDashboard();
            await d.saveBookmarkOrder();
            return;
        }

        const savedRemote = await this.saveRemoteBookmarkEdit(bookmarkRef, nextBookmarkState);
        if (!savedRemote) {
            return;
        }

        d._inlineEditGlobalCleanup?.();
        d.inlineEditingBookmarkIndex = null;
        d._inlineEditContext = null;
        if (Number(bookmarkRef.pageId) === Number(d.currentPageId)) {
            d.renderDashboard();
        } else {
            await d.loadAllBookmarks();
            d.renderDashboard();
        }
    }


    cancelBookmarkInlineEdit(row, bookmarkRef) {
        const d = this.dash;
        d._inlineEditGlobalCleanup?.();
        d._inlineEditAutoFetchClear?.();
        d._inlineEditAutoFetchClear = null;
        this.leaveBookmarkInlineEditFocusMode();
        d._inlineEditContext = null;
        const bookmark = bookmarkRef?.bookmark;
        if (!bookmark) {
            d.inlineEditingBookmarkIndex = null;
            d.renderDashboard();
            return;
        }
        const categoryId = row.getAttribute('data-category-id') || bookmark.category || '';
        d.inlineEditingBookmarkIndex = null;
        d.populateBookmarkRowView(row, bookmark, categoryId, true);
        d.destroyCategoryReorderInstances();
        d.initializeCategoryReorder();

        const openLink = row.querySelector('a.bookmark-open');
        if (openLink && typeof openLink.focus === 'function') {
            openLink.focus({ preventScroll: true });
        }
        const kn = d.keyboardNavigation;
        if (kn) {
            kn.updateNavigableElements();
            const idx = kn.navigableElements.indexOf(row);
            if (idx >= 0) {
                kn.currentIndex = idx;
                kn.navigableElements.forEach((el, i) => {
                    const selected = i === idx;
                    el.classList.toggle('keyboard-selected', selected);
                    el.setAttribute('aria-selected', selected ? 'true' : 'false');
                    if (selected) {
                        el.setAttribute('aria-current', 'true');
                    } else {
                        el.removeAttribute('aria-current');
                    }
                });
                kn.syncRovingTabStops({ focus: false });
                kn.syncGridActiveDescendant();
            }
        }
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
        d.keyboardNavigation?.enable?.();
        window.FocusTrapUtils?.syncDashboardInert?.();
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
                cancelText: d.formatDashboardLabel('cancel', {}, 'Cancel')
            });
        }
        return window.confirm(d.configLabel('removeBookmarkMessage', 'Delete this bookmark?'));
    }


    async deleteBookmarkInline(bookmarkRef, options = {}) {
        const d = this.dash;
        if (!bookmarkRef?.bookmark) {
            return;
        }
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
        d._inlineEditGlobalCleanup?.();
        d.inlineEditingBookmarkIndex = null;
        d.renderDashboard();

        await d.saveBookmarkOrder();

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
                    d.renderDashboard();
                    try {
                        await d.saveBookmarkOrder();
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
            const sourceRes = await fetch(`/api/bookmarks?page=${sourcePageId}`);
            if (!sourceRes.ok) {
                throw new Error(d.formatDashboardLabel('loadSourcePageFailed', {}, 'Failed to load source page.'));
            }
            const sourceBookmarks = await sourceRes.json();
            const sourceIndex = d.findBookmarkIndexByReference(sourceBookmarks, bookmarkRef);
            if (sourceIndex < 0) {
                throw new Error(d.formatDashboardLabel('bookmarkNotFoundOnSourcePage', {}, 'Could not locate bookmark on source page.'));
            }

            const deletedBookmark = { ...sourceBookmarks[sourceIndex] };
            sourceBookmarks.splice(sourceIndex, 1);

            const saveRes = await dashFetch(`/api/bookmarks?page=${sourcePageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sourceBookmarks)
            });
            if (!saveRes.ok) {
                throw new Error(d.formatDashboardLabel('saveBookmarkDeletionFailed', {}, 'Failed to save bookmark deletion.'));
            }

            d._inlineEditGlobalCleanup?.();
            d.inlineEditingBookmarkIndex = null;
            await d.loadAllBookmarks();
            d.renderDashboard();

            const deletedLabel = String(deletedBookmark.name || deletedBookmark.url).slice(0, 40);
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

        try {
            if (row) {
                row.classList.add('bookmark-move-out');
                await new Promise(resolve => setTimeout(resolve, 320));
            }

            let sourceBookmarks;
            if (isCurrentScope) {
                this.ensureBookmarkMutationSnapshot();
                sourceBookmarks = [...d.bookmarks];
                sourceBookmarks.splice(bookmarkRef.index, 1);
            } else {
                const sourceRes = await fetch(`/api/bookmarks?page=${sourcePageId}`);
                if (!sourceRes.ok) throw new Error('Failed to load source page.');
                sourceBookmarks = await sourceRes.json();
                const sourceIndex = d.findBookmarkIndexByReference(sourceBookmarks, bookmarkRef);
                if (sourceIndex < 0) {
                    throw new Error('Could not locate original bookmark on source page.');
                }
                sourceBookmarks.splice(sourceIndex, 1);
            }

            const targetRes = await fetch(`/api/bookmarks?page=${targetPageId}`);
            if (!targetRes.ok) throw new Error('Failed to load target page.');
            const targetBookmarks = await targetRes.json();
            targetBookmarks.push({ ...bookmarkState });

            const headers = { 'Content-Type': 'application/json' };
            const sourceSaveRes = await dashFetch(`/api/bookmarks?page=${sourcePageId}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(sourceBookmarks)
            });
            if (!sourceSaveRes.ok) {
                throw new Error('Failed to save source page bookmarks.');
            }
            const targetSaveRes = await dashFetch(`/api/bookmarks?page=${targetPageId}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(targetBookmarks)
            });
            if (!targetSaveRes.ok) {
                throw new Error('Failed to save target page bookmarks.');
            }

            if (isCurrentScope) {
                d.bookmarks = sourceBookmarks;
            }

            const targetPage = (Array.isArray(d.pages) ? d.pages : []).find(p => Number(p.id) === targetPageId);
            const targetName = targetPage?.name || String(targetPageId);

            d._inlineEditGlobalCleanup?.();
            d._inlineEditAutoFetchClear?.();
            d._inlineEditAutoFetchClear = null;
            d.inlineEditingBookmarkIndex = null;
            d._inlineEditContext = null;
            this.leaveBookmarkInlineEditFocusMode();

            if (isCurrentScope) {
                await d.loadPageBookmarks(d.currentPageId);
            } else {
                await d.loadAllBookmarks();
                d.renderDashboard();
            }
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
        const longMs = 500;
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

        /* Bubble phase: avoid stealing native drag from .bookmark-reorder-handle (capture broke DnD in some browsers). */
        row.addEventListener('pointerdown', onPointerDown, { capture: false, signal });
        row.addEventListener('pointermove', onPointerMove, { capture: false, signal });
        row.addEventListener('pointerup', onPointerEnd, { capture: false, signal });
        row.addEventListener('pointercancel', onPointerEnd, { capture: false, signal });
        row.addEventListener('lostpointercapture', onPointerEnd, { capture: false, signal });
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

window.DashboardInlineEdit = DashboardInlineEdit;
