/**
 * Quick Add Widget
 * Mini form on dashboard for rapid bookmark creation
 */

class QuickAddWidget {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.container = null;
        this.isOpen = false;
        this.shortcutBound = false;
        this.init();
    }

    init() {
        this.attachGlobalShortcut();
    }

    t(key, fallback = '') {
        const raw = this.dashboard?.language?.t?.(key);
        if (typeof raw === 'string' && raw !== key) {
            return raw;
        }
        return fallback || key;
    }

    applyLabels() {
        if (!this.container) return;
        const root = this.container;
        root.setAttribute('aria-label', this.t('config.quickAddBookmark', 'Quick add bookmark'));
        const title = root.querySelector('.quick-add-modal-title');
        if (title) title.textContent = this.t('config.quickAddBookmark', 'Quick add bookmark');
        const closeBtn = root.querySelector('.quick-add-close');
        if (closeBtn) closeBtn.setAttribute('aria-label', this.t('dashboard.close', 'Close'));

        const sections = [
            { input: '.quick-add-name', key: 'config.bookmarkName', fallback: 'Name' },
            { input: '.quick-add-url', key: 'config.urlLabelShort', fallback: 'URL' },
            { input: '.quick-add-page', key: 'config.page', fallback: 'Page' },
            { input: '.quick-add-category', key: 'config.category', fallback: 'Category' },
            { input: '.quick-add-shortcut', key: 'config.shortcut', fallback: 'Shortcut' },
            { input: '.quick-add-icon-url', key: 'config.icon', fallback: 'Icon' },
            { input: '.quick-add-note', key: 'config.note', fallback: 'Note' },
        ];
        sections.forEach(({ input, key, fallback }) => {
            const el = root.querySelector(input);
            const label = el?.closest('.quick-add-section')?.querySelector('.quick-add-label')
                || el?.closest('.quick-add-section-col')?.querySelector('.quick-add-label');
            if (label) label.textContent = this.t(key, fallback);
        });

        const fetchBtn = root.querySelector('.quick-add-icon-fetch');
        if (fetchBtn) fetchBtn.textContent = this.t('config.fetchFavicon', 'Favicon');
        const iconClear = root.querySelector('.quick-add-icon-clear');
        if (iconClear) iconClear.setAttribute('aria-label', this.t('config.clearIcon', 'Clear icon'));
        const iconUrl = root.querySelector('.quick-add-icon-url');
        if (iconUrl) iconUrl.placeholder = this.t('config.iconUrlOptional', 'Icon URL (optional)');

        const cancelBtn = root.querySelector('.quick-add-cancel');
        if (cancelBtn) cancelBtn.textContent = this.t('config.cancel', 'Cancel');
        const submitBtn = root.querySelector('.quick-add-submit');
        if (submitBtn && !submitBtn.classList.contains('btn-loading')) {
            submitBtn.textContent = this.t('config.addBookmarkShort', 'Add bookmark');
        }
    }

    attachGlobalShortcut() {
        if (this.shortcutBound) return;
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') {
                e.preventDefault();
                this.toggle();
            }
        });
        this.shortcutBound = true;
    }

    createWidget() {
        const html = `
            <div class="quick-add-overlay" aria-modal="true" role="dialog" aria-label="${this.t('config.quickAddBookmark', 'Quick add bookmark')}">
                <div class="quick-add-modal">
                    <div class="quick-add-modal-header">
                        <span class="quick-add-modal-title">${this.t('config.quickAddBookmark', 'New Bookmark')}</span>
                        <div class="quick-add-modal-header-actions">
                            <kbd>Ctrl+Shift+A</kbd>
                            <button class="quick-add-close btn btn-small" type="button" aria-label="Close">✕</button>
                        </div>
                    </div>
                    <form class="quick-add-form">
                        <div class="quick-add-section">
                            <label class="quick-add-label">${this.t('config.bookmarkName', 'Name')}</label>
                            <input type="text" class="quick-add-input quick-add-name" required autocomplete="off">
                        </div>
                        <div class="quick-add-section">
                            <label class="quick-add-label">${this.t('config.urlLabelShort', 'URL')}</label>
                            <div class="quick-add-url-row">
                                <input type="url" class="quick-add-input quick-add-url" required autocomplete="off">
                                <button type="button" class="btn btn-small quick-add-icon-fetch">${this.t('config.fetchFavicon', 'Favicon')}</button>
                            </div>
                        </div>
                        <div class="quick-add-section quick-add-section-row">
                            <div class="quick-add-section-col">
                                <label class="quick-add-label">${this.t('config.page', 'Page')}</label>
                                <select class="quick-add-input quick-add-page">
                                </select>
                            </div>
                            <div class="quick-add-section-col">
                                <label class="quick-add-label">${this.t('config.category', 'Category')}</label>
                                <select class="quick-add-input quick-add-category">
                                    <option value="">${this.t('config.noCategory', 'No category')}</option>
                                </select>
                            </div>
                            <div class="quick-add-section-col quick-add-section-col-narrow">
                                <label class="quick-add-label">${this.t('config.shortcut', 'Shortcut')}</label>
                                <input type="text" class="quick-add-input quick-add-shortcut" maxlength="5" autocomplete="off" style="text-transform:uppercase;text-align:center;">
                            </div>
                        </div>
                        <div class="quick-add-section">
                            <label class="quick-add-label">${this.t('config.icon', 'Icon')}</label>
                            <div class="quick-add-icon-row">
                                <div class="quick-add-icon-preview"><span class="quick-add-icon-preview-empty">—</span></div>
                                <button type="button" class="quick-add-icon-clear" hidden aria-label="${this.t('config.clearIcon', 'Clear icon')}">✕</button>
                                <input type="text" class="quick-add-input quick-add-icon-url" placeholder="${this.t('config.iconUrlOptional', 'Icon URL (optional)')}">
                                <input type="file" class="quick-add-icon-file" accept="image/*,.ico,.svg,.webp">
                            </div>
                            <div class="quick-add-icon-state"></div>
                        </div>
                        <div class="quick-add-section">
                            <label class="quick-add-label">${this.t('config.note', 'Note')}</label>
                            <textarea class="quick-add-input quick-add-note" rows="2"></textarea>
                        </div>
                        <div class="quick-add-footer">
                            <button type="button" class="btn btn-secondary quick-add-cancel">${this.t('config.cancel', 'Cancel')}</button>
                            <button type="submit" class="btn btn-primary quick-add-submit">${this.t('config.addBookmarkShort', 'Add Bookmark')}</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        // Mount on body so it overlays everything and is not affected by dashboard rerenders.
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        this.container = tempDiv.firstElementChild;
        document.body.appendChild(this.container);
    }

    attachEventListeners() {
        if (this._listenersBound) return;
        this._listenersBound = true;
        const closeBtn = this.container?.querySelector('.quick-add-close');
        const cancelBtn = this.container?.querySelector('.quick-add-cancel');
        const form = this.container?.querySelector('.quick-add-form');
        const toggleBtn = document.querySelector('[data-quick-add-toggle]');

        closeBtn?.addEventListener('click', () => this.close());
        cancelBtn?.addEventListener('click', () => this.close());
        form?.addEventListener('submit', (e) => this.handleSubmit(e));
        toggleBtn?.addEventListener('click', () => this.toggle());

        // Close on backdrop click
        this.container?.addEventListener('click', (e) => {
            if (e.target === this.container) this.close();
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });

        const iconFileInput = this.container?.querySelector('.quick-add-icon-file');
        const iconUrlInput = this.container?.querySelector('.quick-add-icon-url');
        const urlInput = this.container?.querySelector('.quick-add-url');
        const iconFetchBtn = this.container?.querySelector('.quick-add-icon-fetch');
        const iconClearBtn = this.container?.querySelector('.quick-add-icon-clear');
        iconFileInput?.addEventListener('change', () => this.syncQuickAddIconPreview(''));
        iconUrlInput?.addEventListener('input', () => this.syncQuickAddIconPreview(''));
        iconUrlInput?.addEventListener('blur', () => this.autoFetchQuickAddFavicon());
        urlInput?.addEventListener('blur', () => this.autoFetchQuickAddFavicon());
        iconClearBtn?.addEventListener('click', () => {
            if (iconUrlInput) iconUrlInput.value = '';
            if (iconFileInput) iconFileInput.value = '';
            this.syncQuickAddIconPreview('');
            this.setQuickAddIconState('');
        });
        iconFetchBtn?.addEventListener('click', async () => {
            const urlValue = (this.container?.querySelector('.quick-add-url')?.value || '').trim();
            if (!urlValue) {
                this.dashboard.showNotification(this.t('config.urlRequiredShort', 'URL required.'), 'error');
                return;
            }
            iconFetchBtn.classList.add('btn-loading');
            iconFetchBtn.disabled = true;
            this.setIconFetchingState(true);
            const fetchedIcon = await this.fetchAndAssignFaviconForUrl(urlValue);
            iconFetchBtn.classList.remove('btn-loading');
            iconFetchBtn.disabled = false;
            this.setIconFetchingState(false);
            if (!fetchedIcon) {
                this.setQuickAddIconState(this.t('config.iconNotFound', 'Not found'));
                this.dashboard.showNotification(this.t('config.faviconFetchFailed', 'Favicon fetch failed.'), 'error');
                return;
            }
            if (iconUrlInput) {
                iconUrlInput.value = `/data/icons/${fetchedIcon}`;
            }
            this.syncQuickAddIconPreview(fetchedIcon);
            this.setQuickAddIconState(this.t('config.iconFound', 'Found'));
            this.dashboard.showNotification(this.t('config.faviconFetched', 'Favicon fetched.'), 'success');
        });
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        if (!this.container || !document.body.contains(this.container)) {
            this.createWidget();
            this.attachEventListeners();
        }
        this.applyLabels();
        this.updateCategories();
        this.updatePages();
        this.isOpen = true;
        this.container.classList.add('is-open');
        requestAnimationFrame(() => {
            this.container.querySelector('.quick-add-name')?.focus();
        });
    }

    close() {
        this.isOpen = false;
        this.container?.classList.remove('is-open');
    }

    updateCategories() {
        const select = this.container?.querySelector('.quick-add-category');
        if (select) {
            select.innerHTML = `<option value="">${this.t('config.noCategory', 'No category')}</option>`;
            this.dashboard.categories?.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name;
                select.appendChild(option);
            });
        }
    }

    updatePages() {
        const select = this.container?.querySelector('.quick-add-page');
        if (!select) return;
        const pages = this.dashboard.pages || [];
        const currentId = String(this.dashboard.currentPageId || '');
        select.innerHTML = '';
        pages.forEach(page => {
            const option = document.createElement('option');
            option.value = page.id;
            option.textContent = page.name;
            if (String(page.id) === currentId) option.selected = true;
            select.appendChild(option);
        });
    }

    async handleSubmit(e) {
        e.preventDefault();

        const name = this.container.querySelector('.quick-add-name').value;
        const url = this.container.querySelector('.quick-add-url').value;
        const shortcut = this.container.querySelector('.quick-add-shortcut').value.toUpperCase().replace(/[^A-Z]/g, '');
        const category = this.container.querySelector('.quick-add-category').value;
        const note = (this.container.querySelector('.quick-add-note')?.value || '').trim();
        const pageId = Number(this.container.querySelector('.quick-add-page')?.value) || Number(this.dashboard.currentPageId) || 1;
        const iconFile = this.container.querySelector('.quick-add-icon-file')?.files?.[0];
        const iconUrl = (this.container.querySelector('.quick-add-icon-url')?.value || '').trim();

        const submitBtn = this.container.querySelector('.quick-add-submit');
        const originalText = submitBtn?.textContent;
        this.setSubmittingState(true, submitBtn);

        const icon = await this.resolveIconValue(iconFile, iconUrl);

        if (icon === null) {
            this.setSubmittingState(false, submitBtn, originalText);
            return;
        }

        try {
            const response = await fetch('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: pageId,
                    bookmark: {
                        name,
                        url,
                        shortcut,
                        category,
                        note,
                        pinned: false,
                        checkStatus: false,
                        icon,
                        createdAt: Date.now()
                    }
                })
            });

            if (response.ok) {
                await this.dashboard.loadPageBookmarks(this.dashboard.currentPageId);
                this.close();
                this.container.querySelector('form').reset();
                this.syncQuickAddIconPreview('');
                this.setQuickAddIconState('');
                this.dashboard.showNotification(this.t('config.bookmarkCreated', 'Bookmark created!'), 'success');
            } else if (response.status === 409) {
                this.setSubmittingState(false, submitBtn, originalText);
                this.dashboard.showNotification(this.t('config.duplicateBookmarkUrl', 'Duplicate bookmark URL.'), 'error');
            } else {
                this.setSubmittingState(false, submitBtn, originalText);
                this.dashboard.showNotification(this.t('config.errorCreatingBookmark', 'Failed to add bookmark.'), 'error');
            }
        } catch (error) {
            console.error('Error adding bookmark:', error);
            this.setSubmittingState(false, submitBtn, originalText);
            this.dashboard.showNotification(this.t('config.errorCreatingBookmark', 'Error adding bookmark'), 'error');
        }
    }

    async resolveIconValue(iconFile, iconUrl) {
        if (iconFile) {
            const uploadedIcon = await this.uploadIconFile(iconFile);
            if (!uploadedIcon) {
                this.dashboard.showNotification(this.t('config.iconUploadFailed', 'Icon upload failed.'), 'error');
                return null;
            }
            return uploadedIcon;
        }

        if (iconUrl) {
            if (iconUrl.startsWith('/data/icons/')) {
                return iconUrl.replace('/data/icons/', '').trim();
            }
            const remoteIcon = await this.uploadIconFromUrl(iconUrl);
            if (!remoteIcon) {
                this.dashboard.showNotification(this.t('config.iconUrlInvalid', 'Icon URL invalid.'), 'error');
                return null;
            }
            return remoteIcon;
        }

        return '';
    }

    async uploadIconFile(file) {
        const formData = new FormData();
        formData.append('icon', file);
        try {
            const response = await fetch('/api/icon', {
                method: 'POST',
                body: formData
            });
            if (!response.ok) return '';
            const result = await response.json();
            return result.icon || '';
        } catch (error) {
            return '';
        }
    }

    async uploadIconFromUrl(iconUrl) {
        try {
            const response = await fetch('/api/icon/from-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: iconUrl })
            });
            if (!response.ok) return '';
            const result = await response.json();
            return result.icon || '';
        } catch (error) {
            return '';
        }
    }

    syncQuickAddIconPreview(icon) {
        const previewEl = this.container?.querySelector('.quick-add-icon-preview');
        if (!previewEl) return;
        const hasIcon = Boolean(icon);
        if (hasIcon) {
            previewEl.innerHTML = `<img src="/data/icons/${icon}" alt="">`;
        } else {
            previewEl.innerHTML = `<span class="quick-add-icon-preview-empty">—</span>`;
        }
        const clearBtn = this.container?.querySelector('.quick-add-icon-clear');
        if (clearBtn) clearBtn.hidden = !hasIcon;
    }

    deriveFaviconFromBookmarkUrl(bookmarkUrl) {
        const safeUrl = String(bookmarkUrl || '').trim();
        if (!safeUrl) return '';
        try {
            const parsed = new URL(safeUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            return `${parsed.protocol}//${parsed.host}/favicon.ico`;
        } catch {
            return '';
        }
    }

    async fetchAndAssignFaviconForUrl(bookmarkUrl) {
        const safeUrl = String(bookmarkUrl || '').trim();
        if (!safeUrl) return '';
        try {
            const previewResponse = await fetch(`/api/bookmark-preview?url=${encodeURIComponent(safeUrl)}`);
            if (previewResponse.ok) {
                const preview = await previewResponse.json();
                const iconUrl = String(preview?.icon || '').trim();
                if (iconUrl) {
                    const icon = await this.uploadIconFromUrl(iconUrl);
                    if (icon) return icon;
                }
            }
        } catch {
            // Continue to fallback.
        }
        const fallbackUrl = this.deriveFaviconFromBookmarkUrl(safeUrl);
        if (!fallbackUrl) return '';
        return this.uploadIconFromUrl(fallbackUrl);
    }

    autoFetchQuickAddFavicon() {
        if (this._autoFetchTimer) {
            clearTimeout(this._autoFetchTimer);
        }
        this._autoFetchTimer = setTimeout(async () => {
            if (this._autoFetchInFlight) {
                return;
            }
            const iconUrlInput = this.container?.querySelector('.quick-add-icon-url');
            if (iconUrlInput && String(iconUrlInput.value || '').trim()) {
                return;
            }
            const previewEl = this.container?.querySelector('.quick-add-icon-preview');
            if (previewEl && previewEl.querySelector('img')) {
                return;
            }
            const urlValue = (this.container?.querySelector('.quick-add-url')?.value || '').trim();
            if (!urlValue) {
                return;
            }
            this._autoFetchInFlight = true;
            this.setIconFetchingState(true);
            const icon = await this.fetchAndAssignFaviconForUrl(urlValue);
            this._autoFetchInFlight = false;
            this.setIconFetchingState(false);
            if (!icon) {
                this.setQuickAddIconState(this.t('config.iconNotFound', 'Not found'));
                return;
            }
            if (iconUrlInput) {
                iconUrlInput.value = `/data/icons/${icon}`;
            }
            this.syncQuickAddIconPreview(icon);
            this.setQuickAddIconState(this.t('config.iconFound', 'Found'));
        }, 250);
    }

    setIconFetchingState(fetching) {
        const previewEl = this.container?.querySelector('.quick-add-icon-preview');
        if (previewEl) {
            previewEl.classList.toggle('is-fetching', fetching);
        }
        if (fetching) {
            this.setQuickAddIconState(this.t('config.iconFetching', 'Fetching...'));
        }
    }

    setSubmittingState(submitting, btn, originalText) {
        if (!btn) return;
        if (submitting) {
            btn.classList.add('btn-loading');
            btn.disabled = true;
            btn.textContent = this.t('config.saving', 'Saving…');
        } else {
            btn.classList.remove('btn-loading');
            btn.disabled = false;
            if (originalText) btn.textContent = originalText;
        }
    }

    setQuickAddIconState(text) {
        const stateEl = this.container?.querySelector('.quick-add-icon-state');
        if (stateEl) {
            stateEl.textContent = text;
        }
    }
}
