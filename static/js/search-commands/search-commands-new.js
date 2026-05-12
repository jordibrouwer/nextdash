/**
 * Search Command: :new
 * Opens a modal to create a new bookmark from the dashboard
 */

class SearchCommandNew {
    constructor(language = null) {
        this.language = language;
        this.modal = null;
        this.currentPageId = null;
        this.categories = [];
        this.pages = [];
        this._mouseDownTarget = null;
        this.pendingIcon = '';
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

    notify(message, type = 'error') {
        const dash = window.dashboardInstance;
        if (dash && typeof dash.showNotification === 'function') {
            dash.showNotification(message, type);
        }
    }

    /** Same rules as server canonicalBookmarkURLKey (handlers.go). */
    canonicalBookmarkURLKey(raw) {
        const s = String(raw || '').trim();
        try {
            const u = new URL(s);
            const scheme = u.protocol.replace(/:$/, '').toLowerCase();
            const host = u.hostname.toLowerCase();
            let path = u.pathname;
            if (path === '/') {
                path = '';
            } else {
                path = path.replace(/\/+$/, '');
            }
            return `${scheme}://${host}${path}${u.search}`;
        } catch {
            let t = s.toLowerCase();
            const hash = t.indexOf('#');
            if (hash >= 0) {
                t = t.slice(0, hash);
            }
            return t.replace(/\/+$/, '');
        }
    }

    duplicateBookmarkUrlMessage() {
        return this.language
            ? (this.language.t('config.duplicateBookmarkUrl') || 'This bookmark URL already exists on this page.')
            : 'This bookmark URL already exists on this page.';
    }

    handle(args) {
        return [{
            name: this.language ? this.language.t('config.addNewBookmark') : 'Create New Bookmark',
            shortcut: ':new',
            action: () => this.openModal(),
            type: 'command'
        }];
    }

    openModal() {
        this.createModal();
        this.showModal();
    }

    createModal() {
        const existingModal = document.getElementById('new-bookmark-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const t = (key, fallback) => {
            if (!this.language) return fallback;
            const val = this.language.t(key);
            return val !== key ? val : fallback;
        };

        const modalHTML = `
            <div id="new-bookmark-modal" class="modal-overlay">
                <div class="modal modal-new-bookmark">
                    <div class="nbm-header">
                        <span class="nbm-title">${t('config.addNewBookmark', 'New Bookmark')}</span>
                        <div class="nbm-header-actions">
                            <kbd>Ctrl+Shift+A</kbd>
                            <button type="button" class="nbm-btn" id="new-bookmark-cancel-header" aria-label="Close">✕</button>
                        </div>
                    </div>
                    <form id="new-bookmark-form" class="new-bookmark-form">
                        <div class="nbm-section">
                            <label class="nbm-label" for="new-bookmark-name">${t('config.bookmarkNamePlaceholder', 'Name')}</label>
                            <input type="text" id="new-bookmark-name" name="name" class="nbm-input" required autocomplete="off">
                        </div>
                        <div class="nbm-section">
                            <label class="nbm-label" for="new-bookmark-url">${t('config.urlLabelShort', 'URL')}</label>
                            <div class="nbm-url-row">
                                <input type="url" id="new-bookmark-url" name="url" class="nbm-input" required autocomplete="off" placeholder="https://">
                                <button type="button" class="nbm-btn" id="new-bookmark-icon-fetch">${t('config.fetch', 'Fetch favicon')}</button>
                            </div>
                        </div>
                        <div class="nbm-section nbm-section-row">
                            <div class="nbm-col">
                                <label class="nbm-label" for="new-bookmark-page">${t('config.page', 'Page')}</label>
                                <select id="new-bookmark-page" name="page" class="nbm-input">
                                    ${this.generatePageOptions()}
                                </select>
                            </div>
                            <div class="nbm-col">
                                <label class="nbm-label" for="new-bookmark-category">${t('config.category', 'Category')}</label>
                                <select id="new-bookmark-category" name="category" class="nbm-input">
                                    <option value="">${t('config.noCategory', 'No category')}</option>
                                    ${this.generateCategoryOptions()}
                                </select>
                            </div>
                            <div class="nbm-col nbm-col-narrow">
                                <label class="nbm-label" for="new-bookmark-shortcut">${t('config.bookmarkShortcutPlaceholder', 'Shortcut')}</label>
                                <input type="text" id="new-bookmark-shortcut" name="shortcut" class="nbm-input nbm-shortcut" maxlength="5" autocomplete="off">
                            </div>
                        </div>
                        <div class="nbm-section">
                            <label class="nbm-label">${t('config.icon', 'Icon')}</label>
                            <div class="nbm-icon-row">
                                <div id="new-bookmark-icon-preview" class="nbm-icon-preview"><span class="nbm-icon-preview-empty">—</span></div>
                                <input type="text" id="new-bookmark-icon-url" class="nbm-input" placeholder="${t('config.iconUrlOptional', 'Icon URL (optional)')}">
                                <label class="nbm-btn nbm-file-label">
                                    Upload
                                    <input type="file" id="new-bookmark-icon-file" class="nbm-file-hidden" accept="image/*,.ico,.svg,.webp">
                                </label>
                            </div>
                            <div id="new-bookmark-icon-fetch-state" class="nbm-icon-state"></div>
                        </div>
                        <div class="nbm-section">
                            <label class="nbm-label" for="new-bookmark-note">${t('config.bookmarkNoteLabel', 'Note')}</label>
                            <textarea id="new-bookmark-note" name="note" class="nbm-input nbm-note" rows="2"></textarea>
                        </div>
                        <div class="nbm-section nbm-section-toggles">
                            <label class="nbm-toggle-label">
                                <input type="checkbox" id="new-bookmark-pinned" name="pinned">
                                <span>${t('config.pinnedShort', 'Pinned')}</span>
                            </label>
                            <label class="nbm-toggle-label">
                                <input type="checkbox" id="new-bookmark-status" name="checkStatus">
                                <span>${t('config.status', 'Status check')}</span>
                            </label>
                        </div>
                        <div class="nbm-footer">
                            <button type="button" class="nbm-btn nbm-btn-secondary" id="new-bookmark-cancel">${t('config.cancel', 'Cancel')}</button>
                            <button type="button" class="nbm-btn nbm-btn-primary" id="new-bookmark-create">${t('config.create', 'Add Bookmark')}</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('new-bookmark-modal');
        this.pendingIcon = '';

        const pageSelectPre = document.getElementById('new-bookmark-page');
        if (pageSelectPre) {
            const want = Number(this.currentPageId);
            const match = [...pageSelectPre.options].find((o) => Number(o.value) === want);
            if (match) {
                pageSelectPre.value = match.value;
            }
        }

        this.setupEventListeners();
        this.syncIconPreview('');

        const pageSelectPost = document.getElementById('new-bookmark-page');
        if (pageSelectPost) {
            const pid = parseInt(String(pageSelectPost.value), 10);
            if (Number.isFinite(pid)) {
                void this.updateCategoriesForPage(pid);
            }
        }
    }

    generatePageOptions() {
        if (!this.pages || this.pages.length === 0) {
            return `<option value="1">${this.language ? this.language.t('dashboard.defaultPageTitle') : 'Dashboard'}</option>`;
        }

        const currentId = Number(this.currentPageId);
        return this.pages.map(page => {
            const isCurrentPage = Number(page.id) === currentId;
            const pageName = this.language ? this.language.t(page.name) || page.name : page.name;
            return `<option value="${page.id}" ${isCurrentPage ? 'selected' : ''}>${pageName}</option>`;
        }).join('');
    }

    generateCategoryOptions() {
        if (!this.categories || this.categories.length === 0) {
            return '';
        }

        return this.categories.map(category => {
            return `<option value="${category.id}">${category.name}</option>`;
        }).join('');
    }

    async updateCategoriesForPage(pageId) {
        try {
            const response = await fetch(`/api/categories?page=${pageId}`);
            if (response.ok) {
                const categories = await response.json();
                
                this.categories = categories.map(cat => ({ 
                    ...cat, 
                    name: this.language ? this.language.t(cat.name) || cat.name : cat.name 
                }));
                
                const categorySelect = document.getElementById('new-bookmark-category');
                if (categorySelect) {
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
                        <option value="">${this.language ? this.language.t('config.noCategory') : 'No category'}</option>
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
                }
            }
        } catch (error) {
            console.error('Error loading categories for page:', error);
        }
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
                } else {
                    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                        const target = e.target;
                        const isInCustomSelect = target.classList.contains('custom-select-trigger') || 
                                                target.closest('.custom-select') ||
                                                document.querySelector('.custom-select.open');
                        const isInteractiveElement = target.tagName === 'INPUT' || 
                                                     target.tagName === 'SELECT' || 
                                                     target.tagName === 'TEXTAREA' ||
                                                     target.tagName === 'BUTTON' ||
                                                     target.type === 'checkbox';
                        
                        if (!isInCustomSelect && !isInteractiveElement) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                    }
                }
            }
        };
        
        document.addEventListener('keydown', this.keyboardBlockHandler, true);

        this.modal.addEventListener('keydown', (e) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.stopPropagation();
            }
        }, false);

        this.modal.addEventListener('mousedown', (e) => {
            this._mouseDownTarget = e.target;
        });

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal && this._mouseDownTarget === this.modal) {
                this.closeModal();
            }
        });

        document.addEventListener('keydown', this.handleKeyDown.bind(this));

        const pageSelect = document.getElementById('new-bookmark-page');
        if (pageSelect) {
            pageSelect.addEventListener('change', async (e) => {
                const selectedPageId = parseInt(e.target.value);
                await this.updateCategoriesForPage(selectedPageId);
            });
        }

        const shortcutInput = document.getElementById('new-bookmark-shortcut');
        shortcutInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
        });

        const statusCheckbox = document.getElementById('new-bookmark-status');
        statusCheckbox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                statusCheckbox.checked = !statusCheckbox.checked;
            }
        });

        const pinnedCheckbox = document.getElementById('new-bookmark-pinned');
        pinnedCheckbox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                pinnedCheckbox.checked = !pinnedCheckbox.checked;
            }
        });

        const iconFileInput = document.getElementById('new-bookmark-icon-file');
        if (iconFileInput) {
            iconFileInput.addEventListener('change', () => {
                const iconUrlInput = document.getElementById('new-bookmark-icon-url');
                if (iconUrlInput) {
                    iconUrlInput.value = '';
                }
                this.pendingIcon = '';
                this.syncIconPreview('');
                this.setModalIconFetchState('');
            });
        }

        const iconUrlInput = document.getElementById('new-bookmark-icon-url');
        if (iconUrlInput) {
            iconUrlInput.addEventListener('input', () => {
                this.pendingIcon = '';
            });
            iconUrlInput.addEventListener('blur', () => {
                this.autoFetchModalFaviconFromUrlField();
            });
        }

        const fetchIconButton = document.getElementById('new-bookmark-icon-fetch');
        if (fetchIconButton) {
            fetchIconButton.addEventListener('click', async () => {
                const urlValue = String(document.getElementById('new-bookmark-url')?.value || '').trim();
                if (!urlValue) {
                    this.notify(this.language ? this.language.t('config.urlRequiredShort') : 'URL required.', 'error');
                    return;
                }
                fetchIconButton.disabled = true;
                this.setModalIconFetchState(this.language ? this.language.t('config.iconFetching') : 'Fetching...');
                const icon = await this.fetchAndAssignFaviconForUrl(urlValue);
                fetchIconButton.disabled = false;
                if (!icon) {
                    this.setModalIconFetchState(this.language ? this.language.t('config.iconNotFound') : 'Not found');
                    this.notify(this.language ? this.language.t('config.faviconFetchFailed') : 'Favicon fetch failed.', 'error');
                    return;
                }
                this.pendingIcon = icon;
                this.syncIconPreview(icon);
                this.setModalIconFetchState(this.language ? this.language.t('config.iconFound') : 'Found');
                this.notify(this.language ? this.language.t('config.faviconFetched') : 'Favicon fetched.', 'success');
            });
        }

        const createButton = document.getElementById('new-bookmark-create');
        createButton.addEventListener('click', () => {
            this.createBookmark();
        });
        createButton.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.createBookmark();
            }
        });

        const cancelButton = document.getElementById('new-bookmark-cancel');
        cancelButton?.addEventListener('click', () => {
            this.closeModal();
        });
        cancelButton?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.closeModal();
            }
        });

        const cancelHeaderButton = document.getElementById('new-bookmark-cancel-header');
        cancelHeaderButton?.addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('new-bookmark-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createBookmark();
        });

        const selects = this.modal.querySelectorAll('select');
        selects.forEach(select => {
            if (typeof CustomSelect !== 'undefined') {
                const instance = new CustomSelect(select);
                select.__customSelectInstance = instance;
            }
        });

        const urlInput = document.getElementById('new-bookmark-url');
        if (urlInput) {
            urlInput.addEventListener('blur', () => {
                this.autoFetchModalFaviconFromUrlField();
            });
        }
    }

    handleKeyDown(e) {
        if (e.key === 'Escape' && this.modal && this.modal.classList.contains('show')) {
            this.closeModal();
        }
    }

    showModal() {
        if (this.modal) {
            this.modal.classList.add('show');
            document.body.style.overflow = 'hidden';
            
            setTimeout(() => {
                const firstInput = document.getElementById('new-bookmark-name');
                if (firstInput) {
                    firstInput.focus();
                }
            }, 100);
        }
    }

    closeModal() {
        if (this.modal) {
            this.modal.classList.remove('show');
            document.body.style.overflow = '';
            
            if (this.keyboardBlockHandler) {
                document.removeEventListener('keydown', this.keyboardBlockHandler, true);
            }
            
            setTimeout(() => {
                if (this.modal) {
                    this.modal.remove();
                    this.modal = null;
                }
            }, 200);
        }
    }

    async createBookmark() {
        const form = document.getElementById('new-bookmark-form');
        
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const formData = new FormData(form);
        const iconFile = document.getElementById('new-bookmark-icon-file')?.files?.[0];
        const iconUrl = (document.getElementById('new-bookmark-icon-url')?.value || '').trim();
        const icon = await this.resolveIconValue(iconFile, iconUrl);

        if (icon === null) {
            return;
        }

        const bookmark = {
            name: formData.get('name').trim(),
            url: formData.get('url').trim(),
            note: (formData.get('note') || '').trim(),
            shortcut: formData.get('shortcut').trim().toUpperCase(),
            category: formData.get('category'),
            pinned: formData.get('pinned') === 'on',
            checkStatus: formData.get('checkStatus') === 'on',
            icon,
            createdAt: Date.now()
        };

        const pageSelectEl = document.getElementById('new-bookmark-page');
        const pageId = parseInt(String(pageSelectEl?.value ?? formData.get('page') ?? ''), 10);
        if (!Number.isFinite(pageId) || pageId < 1) {
            this.notify(
                this.language ? this.language.t('config.errorCreatingBookmark') : 'Invalid page selected.',
                'error'
            );
            return;
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
                return;
            }
        }

        try {
            const response = await fetch('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: pageId,
                    bookmark: bookmark
                })
            });

            if (response.ok) {
                this.closeModal();
                this.pendingIcon = '';
                
                if (window.dashboardInstance) {
                    await window.dashboardInstance.loadAllBookmarks();
                    
                    if (Number(pageId) === Number(window.dashboardInstance.currentPageId)) {
                        await window.dashboardInstance.loadPageBookmarks(pageId);
                    }
                }

                this.notify(
                    this.language ? this.language.t('config.bookmarkCreated') : 'Bookmark created successfully!',
                    'success'
                );
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
                        if (raw.includes('Duplicate bookmark URL')) {
                            conflictMessage = this.duplicateBookmarkUrlMessage();
                        }
                    }
                }
                this.notify(conflictMessage, 'error');
            } else {
                console.error('Failed to create bookmark');
                this.notify(
                    this.language ? this.language.t('config.errorCreatingBookmark') : 'Error creating bookmark',
                    'error'
                );
            }
        } catch (error) {
            console.error('Error creating bookmark:', error);
            this.notify(
                this.language ? this.language.t('config.errorCreatingBookmark') : 'Error creating bookmark',
                'error'
            );
        }
    }

    async resolveIconValue(iconFile, iconUrl) {
        if (iconFile) {
            const uploadedIcon = await this.uploadIconFile(iconFile);
            if (!uploadedIcon) {
                this.notify(this.language ? this.language.t('config.iconUploadFailed') : 'Icon upload failed.', 'error');
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
                this.notify(this.language ? this.language.t('config.iconUrlInvalid') : 'Icon URL invalid.', 'error');
                return null;
            }
            return remoteIcon;
        }

        if (this.pendingIcon) {
            return this.pendingIcon;
        }

        return '';
    }

    syncIconPreview(icon) {
        const previewEl = document.getElementById('new-bookmark-icon-preview');
        if (!previewEl) return;
        if (icon) {
            previewEl.innerHTML = `<img src="/data/icons/${icon}" alt="">`;
        } else {
            previewEl.innerHTML = `<span class="nbm-icon-preview-empty">—</span>`;
        }
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
                    if (icon) {
                        return icon;
                    }
                }
            }
        } catch {
            // Continue to fallback.
        }
        const fallbackUrl = this.deriveFaviconFromBookmarkUrl(safeUrl);
        if (!fallbackUrl) return '';
        return this.uploadIconFromUrl(fallbackUrl);
    }

    autoFetchModalFaviconFromUrlField() {
        if (this._autoFetchTimer) {
            clearTimeout(this._autoFetchTimer);
        }
        this._autoFetchTimer = setTimeout(async () => {
            if (this._autoFetchInFlight || this.pendingIcon) {
                return;
            }
            const urlValue = String(document.getElementById('new-bookmark-url')?.value || '').trim();
            if (!urlValue) {
                return;
            }
            this._autoFetchInFlight = true;
            this.setModalIconFetchState(this.language ? this.language.t('config.iconFetching') : 'Fetching...');
            const icon = await this.fetchAndAssignFaviconForUrl(urlValue);
            this._autoFetchInFlight = false;
            if (!icon) {
                this.setModalIconFetchState(this.language ? this.language.t('config.iconNotFound') : 'Not found');
                return;
            }
            this.pendingIcon = icon;
            const iconUrlInput = document.getElementById('new-bookmark-icon-url');
            if (iconUrlInput) {
                iconUrlInput.value = `/data/icons/${icon}`;
            }
            this.syncIconPreview(icon);
            this.setModalIconFetchState(this.language ? this.language.t('config.iconFound') : 'Found');
        }, 250);
    }

    setModalIconFetchState(text) {
        const stateEl = document.getElementById('new-bookmark-icon-fetch-state');
        if (stateEl) {
            stateEl.textContent = text;
        }
    }

    async uploadIconFile(file) {
        const formData = new FormData();
        formData.append('icon', file);

        try {
            const response = await fetch('/api/icon', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                return '';
            }

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

            if (!response.ok) {
                return '';
            }

            const result = await response.json();
            return result.icon || '';
        } catch (error) {
            return '';
        }
    }
}

window.SearchCommandNew = SearchCommandNew;
