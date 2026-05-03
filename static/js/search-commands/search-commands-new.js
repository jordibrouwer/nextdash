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
    }

    setLanguage(language) {
        this.language = language;
    }

    setContext(currentPageId, categories, pages) {
        this.currentPageId = currentPageId;
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

        const modalHTML = `
            <div id="new-bookmark-modal" class="modal-overlay">
                <div class="modal modal-new-bookmark">
                    <div class="modal-header">
                        <span class="modal-title">${this.language ? this.language.t('config.addNewBookmark') : 'Create New Bookmark'}</span>
                    </div>
                    <div class="modal-body">
                        <form id="new-bookmark-form" class="new-bookmark-form">
                            <div class="form-field">
                                <label for="new-bookmark-name">${this.language ? this.language.t('config.bookmarkNamePlaceholder') : 'Bookmark name'}</label>
                                <input 
                                    type="text" 
                                    id="new-bookmark-name" 
                                    name="name" 
                                    placeholder="${this.language ? this.language.t('config.bookmarkNamePlaceholder') : 'Bookmark name'}"
                                    required
                                    autocomplete="off"
                                >
                            </div>

                            <div class="form-field">
                                <label for="new-bookmark-url">URL</label>
                                <input 
                                    type="url" 
                                    id="new-bookmark-url" 
                                    name="url" 
                                    placeholder="${this.language ? this.language.t('config.bookmarkUrlPlaceholder') : 'https://example.com'}"
                                    required
                                    autocomplete="off"
                                >
                            </div>

                            <div class="form-field">
                                <label for="new-bookmark-shortcut">${this.language ? this.language.t('config.bookmarkShortcutPlaceholder') : 'Shortcut'}</label>
                                <input 
                                    type="text" 
                                    id="new-bookmark-shortcut" 
                                    name="shortcut" 
                                    placeholder="${this.language ? this.language.t('config.bookmarkShortcutPlaceholder') : 'Keys (Y, YS, YC)'}"
                                    maxlength="5"
                                    autocomplete="off"
                                >
                            </div>

                            <div class="form-field">
                                <label for="new-bookmark-page">${this.language ? this.language.t('config.page') : 'Page'}</label>
                                <select id="new-bookmark-page" name="page">
                                    ${this.generatePageOptions()}
                                </select>
                            </div>

                            <div class="form-field">
                                <label for="new-bookmark-category">${this.language ? this.language.t('config.category') : 'Category'}</label>
                                <select id="new-bookmark-category" name="category">
                                    <option value="">${this.language ? this.language.t('config.noCategory') : 'No category'}</option>
                                    ${this.generateCategoryOptions()}
                                </select>
                            </div>

                            <div class="form-field">
                                <label>${this.language ? this.language.t('config.icon') : 'Icon'}</label>
                                <div class="quick-add-icon-row">
                                    <input type="file" id="new-bookmark-icon-file" accept="image/*,.ico,.svg,.webp">
                                    <input type="url" id="new-bookmark-icon-url" placeholder="Icon URL (optional)">
                                </div>
                            </div>

                            <div class="form-field">
                                <div class="new-bookmark-toggle-row">
                                    <label class="checkbox-label">
                                        <input 
                                            type="checkbox" 
                                            id="new-bookmark-status" 
                                            name="checkStatus"
                                        >
                                        <span class="checkbox-text">${this.language ? this.language.t('config.status') : 'Status'}</span>
                                    </label>
                                    <label class="checkbox-label">
                                        <input 
                                            type="checkbox" 
                                            id="new-bookmark-pinned" 
                                            name="pinned"
                                        >
                                        <span class="checkbox-text">Pinned</span>
                                    </label>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-actions" id="new-bookmark-actions">
                        <button type="button" class="modal-button" id="new-bookmark-create">
                            <span class="modal-button-name">${this.language ? this.language.t('config.create') : 'Create'}</span>
                        </button>
                        <button type="button" class="modal-button" id="new-bookmark-cancel">
                            <span class="modal-button-name">${this.language ? this.language.t('config.cancel') : 'Cancel'}</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('new-bookmark-modal');
        
        this.setupEventListeners();
    }

    generatePageOptions() {
        if (!this.pages || this.pages.length === 0) {
            return `<option value="1">${this.language ? this.language.t('dashboard.defaultPageTitle') : 'Dashboard'}</option>`;
        }

        return this.pages.map(page => {
            const isCurrentPage = page.id === this.currentPageId;
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
        cancelButton.addEventListener('click', () => {
            this.closeModal();
        });
        cancelButton.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.closeModal();
            }
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
            shortcut: formData.get('shortcut').trim().toUpperCase(),
            category: formData.get('category'),
            pinned: formData.get('pinned') === 'on',
            checkStatus: formData.get('checkStatus') === 'on',
            icon
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
                
                if (window.dashboardInstance) {
                    await window.dashboardInstance.loadAllBookmarks();
                    
                    if (pageId === this.currentPageId) {
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
                this.notify('Icon upload failed.', 'error');
                return null;
            }
            return uploadedIcon;
        }

        if (iconUrl) {
            const remoteIcon = await this.uploadIconFromUrl(iconUrl);
            if (!remoteIcon) {
                this.notify('Icon URL invalid or blocked.', 'error');
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
