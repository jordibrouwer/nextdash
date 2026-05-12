/**
 * Bookmarks Module
 * Handles bookmark management (create, render, remove, reorder)
 */

// Session-level tag pool — grows as tags are typed/saved, persists across bookmark switches
const _sessionTags = new Set();

class TagAutocomplete {
    constructor(input, getTagsFn) {
        this._input = input;
        this._getTagsFn = getTagsFn;
        this._dropdown = null;
        this._activeIndex = -1;
        this._onInput = this._handleInput.bind(this);
        this._onKeydown = this._handleKeydown.bind(this);
        this._onBlur = this._handleBlur.bind(this);
        this._onScroll = this._reposition.bind(this);
        input.addEventListener('input', this._onInput);
        input.addEventListener('keydown', this._onKeydown);
        input.addEventListener('blur', this._onBlur);
        input.addEventListener('focus', this._onInput);
    }
    static attach(input, getTagsFn) {
        TagAutocomplete.detach(input);
        input._tagAutocomplete = new TagAutocomplete(input, getTagsFn);
    }
    static detach(input) {
        if (input._tagAutocomplete) { input._tagAutocomplete._destroy(); delete input._tagAutocomplete; }
    }
    _handleInput() {
        const token = this._currentToken();
        if (!token) { this._close(); return; }
        const known = (this._getTagsFn() || []).map(t => t.toLowerCase());
        const used = this._usedTags();
        const candidates = known.filter(t => t.startsWith(token) && t !== token && !used.includes(t))
            .sort((a, b) => a.localeCompare(b)).slice(0, 8);
        if (candidates.length === 0) { this._close(); return; }
        this._open(candidates, token);
    }
    _handleKeydown(e) {
        if (!this._dropdown) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); this._activeIndex = Math.min(this._activeIndex + 1, this._items().length - 1); this._highlightActive(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._activeIndex = Math.max(this._activeIndex - 1, 0); this._highlightActive(); }
        else if (e.key === 'Tab' || e.key === 'Enter') { const t = this._items()[this._activeIndex] ?? this._items()[0]; if (t) { e.preventDefault(); this._accept(t.dataset.tag); } }
        else if (e.key === 'Escape') { e.preventDefault(); this._close(); }
    }
    _handleBlur() { setTimeout(() => this._close(), 120); }
    _open(candidates, token) {
        if (!this._dropdown) {
            this._dropdown = document.createElement('ul');
            this._dropdown.className = 'tag-ac-dropdown';
            document.body.appendChild(this._dropdown);
            window.addEventListener('scroll', this._onScroll, true);
        }
        this._dropdown.innerHTML = '';
        this._activeIndex = 0;
        candidates.forEach((tag, i) => {
            const li = document.createElement('li');
            li.className = 'tag-ac-item' + (i === 0 ? ' tag-ac-item-active' : '');
            li.dataset.tag = tag;
            const bold = document.createElement('strong');
            bold.textContent = tag.slice(0, token.length);
            li.appendChild(bold);
            li.appendChild(document.createTextNode(tag.slice(token.length)));
            li.addEventListener('mousedown', (e) => { e.preventDefault(); this._accept(tag); });
            this._dropdown.appendChild(li);
        });
        this._reposition();
    }
    _reposition() {
        if (!this._dropdown) return;
        const r = this._input.getBoundingClientRect();
        this._dropdown.style.cssText = `left:${r.left}px;top:${r.bottom}px;width:${r.width}px`;
    }
    _close() {
        if (this._dropdown) { this._dropdown.remove(); this._dropdown = null; window.removeEventListener('scroll', this._onScroll, true); }
        this._activeIndex = -1;
    }
    _items() { return this._dropdown ? [...this._dropdown.querySelectorAll('.tag-ac-item')] : []; }
    _highlightActive() { this._items().forEach((li, i) => li.classList.toggle('tag-ac-item-active', i === this._activeIndex)); }
    _accept(tag) {
        const val = this._input.value;
        const lastComma = val.lastIndexOf(',');
        const prevParts = (lastComma >= 0 ? val.slice(0, lastComma) : '').split(',').map(t => t.trim()).filter(Boolean);
        prevParts.push(tag);
        this._input.value = prevParts.join(', ') + ', ';
        this._input.selectionStart = this._input.selectionEnd = this._input.value.length;
        this._close();
        this._input.dispatchEvent(new Event('input', { bubbles: true }));
        this._input.focus();
    }
    _currentToken() {
        const val = this._input.value;
        const lastComma = val.lastIndexOf(',');
        return (lastComma >= 0 ? val.slice(lastComma + 1) : val).trimStart().toLowerCase();
    }
    _usedTags() {
        const val = this._input.value;
        const lastComma = val.lastIndexOf(',');
        return (lastComma >= 0 ? val.slice(0, lastComma) : '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    }
    _destroy() {
        this._input.removeEventListener('input', this._onInput);
        this._input.removeEventListener('keydown', this._onKeydown);
        this._input.removeEventListener('blur', this._onBlur);
        this._input.removeEventListener('focus', this._onInput);
        this._close();
    }
}

class ConfigBookmarks {
    constructor(t) {
        this.t = t; // Translation function
        this.bookmarkReorder = null;
        this.currentFilterCategory = '__all__';
        this.keyboardReorderHandler = null;
        this.selectedBookmarkIndexes = new Set();
        this.pendingIconUndo = null;
        this.metadataTimers = new Map();
        this.activeDetailIndex = null;
        this._rebindAbort = null;
        this.bulkToolbarDismissed = false;
        this._prevSelectedCount = 0;
    }
    
    createNoteBadgeSvg() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.innerHTML = `
            <path d="M7.5 4.75h7l3.75 3.75V19A1.25 1.25 0 0 1 17 20.25H7A1.25 1.25 0 0 1 5.75 19V6A1.25 1.25 0 0 1 7 4.75Z"></path>
            <path d="M14.5 4.75V8.5h3.75"></path>
            <path d="M8.75 11h6.5"></path>
            <path d="M8.75 14h5.25"></path>
        `;
        return svg;
    }

    isBookmarkUncategorized(bookmark) {
        const c = bookmark?.category;
        return c === undefined || c === null || String(c).trim() === '';
    }

    /**
     * In split-view, all field values are written directly to bookmark objects via the detail panel.
     * This method is kept for API compatibility but is a no-op.
     */
    flushBookmarkFormsToData(bookmarks) {
        // No-op: detail panel writes directly to bookmark objects on every input event.
    }

    /**
     * Render bookmarks list
     * @param {Array} bookmarks
     * @param {Array} categories
     */
    render(bookmarks, categories, options = {}) {
        const container = document.getElementById('bookmarks-list');
        if (!container) return;

        if (!options.skipFlush) {
            this.flushBookmarkFormsToData(bookmarks);
        }

        this.currentFilterCategory = options.filterCategory || this.currentFilterCategory;

        container.innerHTML = '';

        let scopedBookmarks = this.getScopedBookmarks(bookmarks, this.currentFilterCategory);

        const sortOrder = options.sortOrder || 'default';
        if (sortOrder === 'name-az') {
            scopedBookmarks = [...scopedBookmarks].sort((a, b) =>
                (a.bookmark.name || '').localeCompare(b.bookmark.name || ''));
        } else if (sortOrder === 'category-az') {
            const catMap = Object.fromEntries((Array.isArray(categories) ? categories : []).map(c => [c.id, c.name]));
            scopedBookmarks = [...scopedBookmarks].sort((a, b) => {
                const ca = catMap[a.bookmark.category] || '';
                const cb = catMap[b.bookmark.category] || '';
                return ca.localeCompare(cb) || (a.bookmark.name || '').localeCompare(b.bookmark.name || '');
            });
        } else if (sortOrder === 'opens-desc') {
            scopedBookmarks = [...scopedBookmarks].sort((a, b) =>
                (Number(b.bookmark.openCount) || 0) - (Number(a.bookmark.openCount) || 0));
        }

        if (scopedBookmarks.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.innerHTML = `
                <div class="empty-state-icon">📚</div>
                <div class="empty-state-text">${this.t('config.noBookmarks') || 'No bookmarks in this category'}</div>
                <div class="empty-state-subtext">Use "Add Bookmark" below, or restore a ZIP backup on the Backups tab.</div>
                <div class="empty-state-action">
                    <a class="btn btn-secondary btn-small" href="/config#backups" data-i18n="config.importDescription">Import your data</a>
                </div>
            `;
            container.appendChild(emptyState);
            if (typeof configManager !== 'undefined' && configManager.language && typeof configManager.language.applyTranslations === 'function') {
                configManager.language.applyTranslations();
            }
            this.updateBulkSelectionToolbar();
            return;
        }

        scopedBookmarks.forEach(({ bookmark, index }) => {
            const bookmarkElement = this.createBookmarkElement(bookmark, index, bookmarks, categories, index);
            container.appendChild(bookmarkElement);
        });

        this.updateBulkSelectionToolbar();
    }

    moveStaleBookmarksToArchive() {
        if (!window.configManager || !Array.isArray(window.configManager.bookmarksData)) {
            return;
        }

        const now = Date.now();
        const staleThresholdMs = 30 * 24 * 60 * 60 * 1000;
        const archiveCategoryId = 'archive';

        if (!Array.isArray(window.configManager.categoriesData)) {
            window.configManager.categoriesData = [];
        }

        const hasArchive = window.configManager.categoriesData.some((category) => category.id === archiveCategoryId);
        if (!hasArchive) {
            window.configManager.categoriesData.push({
                id: archiveCategoryId,
                name: 'Archive',
                icon: '📦'
            });
            if (window.configManager.categories && typeof window.configManager.categories.render === 'function') {
                window.configManager.categories.render(
                    window.configManager.categoriesData,
                    window.configManager.generateId.bind(window.configManager)
                );
            }
        }

        let moved = 0;
        window.configManager.bookmarksData.forEach((bookmark) => {
            const lastOpened = Number(bookmark.lastOpened || 0);
            const isStale = lastOpened === 0 || (now - lastOpened) > staleThresholdMs;
            if (!isStale) {
                return;
            }
            if (bookmark.category !== archiveCategoryId) {
                bookmark.category = archiveCategoryId;
                moved += 1;
            }
        });

        window.configManager.refreshBookmarksFilterOptions();
        window.configManager.refreshBookmarksList();

        if (window.configManager.ui) {
            if (moved > 0) {
                window.configManager.ui.showNotification(`Moved ${moved} stale bookmark(s) to Archive.`, 'success');
            } else {
                window.configManager.ui.showNotification('No stale bookmarks to move in this page.', 'info');
            }
        }
    }

    mergeDuplicatesByUrl(url) {
        if (!url || !window.configManager || !Array.isArray(window.configManager.bookmarksData)) {
            return;
        }

        const normalized = url.trim().toLowerCase();
        const seen = new Set();
        window.configManager.bookmarksData = window.configManager.bookmarksData.filter((bookmark) => {
            const bookmarkUrl = (bookmark.url || '').trim().toLowerCase();
            if (bookmarkUrl !== normalized) {
                return true;
            }
            if (seen.has(bookmarkUrl)) {
                return false;
            }
            seen.add(bookmarkUrl);
            return true;
        });

        window.configManager.refreshBookmarksList();
        if (window.configManager.ui) {
            window.configManager.ui.showNotification('Duplicates merged for selected URL.', 'success');
        }
    }

    getScopedBookmarks(bookmarks, filterCategory = '__all__') {
        if (!Array.isArray(bookmarks)) {
            return [];
        }

        if (filterCategory === '__all__') {
            return bookmarks.map((bookmark, index) => ({ bookmark, index }));
        }

        if (filterCategory === '__none__') {
            return bookmarks
                .map((bookmark, index) => ({ bookmark, index }))
                .filter(({ bookmark }) => this.isBookmarkUncategorized(bookmark));
        }

        if (filterCategory === '__missing_icon__') {
            return bookmarks
                .map((bookmark, index) => ({ bookmark, index }))
                .filter(({ bookmark }) => !bookmark.icon);
        }

        if (filterCategory === '__icon_failed__') {
            return bookmarks
                .map((bookmark, index) => ({ bookmark, index }))
                .filter(({ bookmark }) => bookmark.iconFetchState === 'failed');
        }

        return bookmarks
            .map((bookmark, index) => ({ bookmark, index }))
            .filter(({ bookmark }) => bookmark.category === filterCategory);
    }

    /**
     * Create a compact bookmark row element (split-view design)
     */
    createBookmarkElement(bookmark, index, bookmarks, categories, fullIndex = index) {
        const div = document.createElement('div');
        div.className = 'bookmark-item js-item is-idle';
        div.setAttribute('data-bookmark-index', fullIndex);
        div.setAttribute('data-bookmark-key', fullIndex);

        const faviconHtml = bookmark.icon
            ? `<img src="/data/icons/${bookmark.icon}" alt="" draggable="false" style="pointer-events:none;user-drag:none;">`
            : `<span class="bookmark-row-favicon-empty"></span>`;

        const urlDisplay = (() => {
            try { return new URL(bookmark.url || '').hostname; } catch (e) { return bookmark.url || ''; }
        })();

        const catName = (() => {
            const cat = (Array.isArray(categories) ? categories : []).find(c => c.id === bookmark.category);
            return cat ? cat.name : '';
        })();
        const openCount = Number(bookmark.openCount || 0);

        const pinBadge = bookmark.pinned
            ? `<span class="bookmark-row-badge is-active" title="Pinned"><svg viewBox="0 0 24 24"><path d="M8 3h8l-1 5 3 3v1H6v-1l3-3-1-5zm4 10v8h-1v-8h1z"/></svg></span>`
            : '';
        const statusBadge = bookmark.checkStatus
            ? `<span class="bookmark-row-badge is-active" title="Status check"><svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 4 10 2-5h6v2h-4l-2 5-4-10-2 5H3z"/></svg></span>`
            : '';
        const noteBadge = String(bookmark.note || '').trim()
            ? `<span class="bookmark-row-badge is-active" title="Has note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.75h7l3.75 3.75V19A1.25 1.25 0 0 1 17 20.25H7A1.25 1.25 0 0 1 5.75 19V6A1.25 1.25 0 0 1 7 4.75Z"/><path d="M14.5 4.75V8.5h3.75"/><path d="M8.75 11h6.5"/><path d="M8.75 14h5.25"/></svg></span>`
            : '';
        const tagsBadge = (bookmark.tags?.length > 0)
            ? `<span class="bookmark-row-badge is-active" title="${this._escHtml((bookmark.tags || []).join(', '))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3H5a2 2 0 0 0-2 2v4.5a1 1 0 0 0 .29.71l9 9a1 1 0 0 0 1.42 0l6-6a1 1 0 0 0 0-1.42l-9-9A1 1 0 0 0 9.5 3Z"/><circle cx="6.5" cy="6.5" r="0.5" fill="currentColor"/></svg></span>`
            : '';

        if (this.activeDetailIndex === fullIndex) div.classList.add('is-selected-detail');

        div.innerHTML = `
            <label class="bookmark-select-wrap" onclick="event.stopPropagation()">
                <input type="checkbox" class="bookmark-select-checkbox" data-bookmark-select="${fullIndex}" ${this.selectedBookmarkIndexes.has(fullIndex) ? 'checked' : ''}>
            </label>
            <span class="drag-handle js-drag-handle" title="Drag to reorder" onclick="event.stopPropagation()">&#10783;</span>
            <span class="bookmark-row-favicon">${faviconHtml}</span>
            <span class="bookmark-row-info">
                <span class="bookmark-row-name">${this._escHtml(bookmark.name || '')}</span>
                <span class="bookmark-row-meta">
                    <span class="bookmark-row-url">${this._escHtml(urlDisplay)}</span>
                    ${catName ? `<span class="bookmark-row-cat">${this._escHtml(catName)}</span>` : ''}
                    ${openCount > 0 ? `<span class="bookmark-row-opens">${openCount}×</span>` : ''}
                </span>
            </span>
            <span class="bookmark-row-badges">${pinBadge}${statusBadge}${noteBadge}${tagsBadge}</span>
        `;

        div._bookmarkRef = bookmark;

        div.addEventListener('click', (e) => {
            if (e.target.closest('.bookmark-select-wrap') || e.target.closest('.js-drag-handle')) return;
            this.openDetailPanel(fullIndex, bookmarks, categories);
        });

        const selectCheckbox = div.querySelector('.bookmark-select-checkbox');
        if (selectCheckbox) {
            selectCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedBookmarkIndexes.add(fullIndex);
                    div.classList.add('has-selection');
                } else {
                    this.selectedBookmarkIndexes.delete(fullIndex);
                    div.classList.remove('has-selection');
                }
                this.updateBulkSelectionToolbar();
            });
            if (this.selectedBookmarkIndexes.has(fullIndex)) {
                div.classList.add('has-selection');
            }
        }

        return div;
    }

    _escHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    openDetailPanel(index, bookmarks, categories) {
        this.activeDetailIndex = index;
        const bookmark = bookmarks[index];
        if (!bookmark) return;
        // Always use the freshest category list available.
        const resolvedCategories = (Array.isArray(categories) && categories.length > 0)
            ? categories
            : (window.configManager?.bookmarksPageCategories || []);
        categories = resolvedCategories;



        document.querySelectorAll('.bookmark-item.is-selected-detail').forEach(el => el.classList.remove('is-selected-detail'));
        const activeRow = document.querySelector(`[data-bookmark-index="${index}"]`);
        if (activeRow) {
            activeRow.classList.add('is-selected-detail');
            // Auto-scroll to selected bookmark using smooth scroll and block: 'nearest' to account for sticky controls
            activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        const emptyEl = document.getElementById('bookmark-detail-empty');
        const formEl = document.getElementById('bookmark-detail-form');
        if (emptyEl) emptyEl.style.display = 'none';
        if (formEl) { formEl.removeAttribute('hidden'); formEl.style.display = ''; }

        // Rebind first (replaces panel with a clean clone), then populate into the clone.
        this._rebindDetailPanel(index, bookmark, bookmarks, categories);
        this._populateDetailPanel(index, bookmark, bookmarks, categories);
    }

    _populateDetailPanel(index, bookmark, bookmarks, categories) {
        const title = document.getElementById('bookmark-detail-title');
        if (title) title.textContent = bookmark.name || 'Bookmark';

        const nameEl = document.getElementById('detail-name');
        if (nameEl) nameEl.value = bookmark.name || '';

        const urlEl = document.getElementById('detail-url');
        if (urlEl) {
            urlEl.value = bookmark.url || '';
            const isDup = bookmarks.some((b, i) => i !== index && (b.url || '').trim().toLowerCase() === (bookmark.url || '').trim().toLowerCase());
            urlEl.classList.toggle('field-conflict', isDup);
        }

        const scEl = document.getElementById('detail-shortcut');
        if (scEl) scEl.value = bookmark.shortcut || '';

        const catEl = document.getElementById('detail-category');
        if (catEl) {
            catEl.innerHTML = `<option value="">${this.t('config.noCategory') || 'No category'}</option>`;
            (Array.isArray(categories) ? categories : []).forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name;
                if (cat.id === bookmark.category) opt.selected = true;
                catEl.appendChild(opt);
            });
        }

        const pinEl = document.getElementById('detail-pinned');
        if (pinEl) pinEl.checked = !!bookmark.pinned;

        const csEl = document.getElementById('detail-check-status');
        if (csEl) csEl.checked = !!bookmark.checkStatus;

        const noteEl = document.getElementById('detail-note');
        if (noteEl) noteEl.value = bookmark.note || '';

        const tagsEl = document.getElementById('detail-tags');
        if (tagsEl) tagsEl.value = (bookmark.tags ?? []).join(', ');

        this._updateDetailIconPreview(bookmark);
    }

    _updateDetailIconPreview(bookmark) {
        const preview = document.getElementById('detail-icon-preview');
        if (!preview) return;
        preview.innerHTML = bookmark.icon
            ? `<img src="/data/icons/${bookmark.icon}" alt="">`
            : `<span class="bookmark-icon-preview-empty">?</span>`;
        const clearBtn = document.getElementById('detail-icon-clear-btn');
        if (clearBtn) clearBtn.disabled = !bookmark.icon;
        const iconUrlInput = document.getElementById('detail-icon-url');
        if (iconUrlInput) iconUrlInput.value = bookmark.icon ? `/data/icons/${bookmark.icon}` : '';
    }

    _syncRow(index, bookmark) {
        const row = document.querySelector(`[data-bookmark-index="${index}"]`);
        if (!row) return;
        const nameSpan = row.querySelector('.bookmark-row-name');
        const urlSpan = row.querySelector('.bookmark-row-url');
        const catSpan = row.querySelector('.bookmark-row-cat');
        const metaSpan = row.querySelector('.bookmark-row-meta');
        const faviconSpan = row.querySelector('.bookmark-row-favicon');
        const badgesSpan = row.querySelector('.bookmark-row-badges');
        if (nameSpan) nameSpan.textContent = bookmark.name || '';
        if (urlSpan) {
            try { urlSpan.textContent = new URL(bookmark.url || '').hostname; } catch (e) { urlSpan.textContent = bookmark.url || ''; }
        }
        if (metaSpan) {
            const cats = window.configManager?.bookmarksPageCategories || [];
            const cat = cats.find(c => c.id === bookmark.category);
            const catName = cat ? cat.name : '';
            const openCount = Number(bookmark.openCount || 0);
            if (catSpan) {
                catSpan.textContent = catName;
                catSpan.style.display = catName ? '' : 'none';
            } else if (catName) {
                const s = document.createElement('span');
                s.className = 'bookmark-row-cat';
                s.textContent = catName;
                metaSpan.appendChild(s);
            }
            let opensSpan = metaSpan.querySelector('.bookmark-row-opens');
            if (opensSpan) {
                opensSpan.textContent = openCount > 0 ? `${openCount}×` : '';
                opensSpan.style.display = openCount > 0 ? '' : 'none';
            }
        }
        if (faviconSpan) {
            faviconSpan.innerHTML = bookmark.icon
                ? `<img src="/data/icons/${bookmark.icon}" alt="" draggable="false" style="pointer-events:none;user-drag:none;">`
                : `<span class="bookmark-row-favicon-empty"></span>`;
        }
        if (badgesSpan) {
            badgesSpan.innerHTML =
                (bookmark.pinned ? `<span class="bookmark-row-badge is-active" title="Pinned"><svg viewBox="0 0 24 24"><path d="M8 3h8l-1 5 3 3v1H6v-1l3-3-1-5zm4 10v8h-1v-8h1z"/></svg></span>` : '')
                + (bookmark.checkStatus ? `<span class="bookmark-row-badge is-active" title="Status check"><svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 4 10 2-5h6v2h-4l-2 5-4-10-2 5H3z"/></svg></span>` : '')
                + (String(bookmark.note || '').trim() ? `<span class="bookmark-row-badge is-active" title="Has note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.75h7l3.75 3.75V19A1.25 1.25 0 0 1 17 20.25H7A1.25 1.25 0 0 1 5.75 19V6A1.25 1.25 0 0 1 7 4.75Z"/><path d="M14.5 4.75V8.5h3.75"/><path d="M8.75 11h6.5"/><path d="M8.75 14h5.25"/></svg></span>` : '')
                + (bookmark.tags?.length > 0 ? `<span class="bookmark-row-badge is-active" title="${this._escHtml((bookmark.tags || []).join(', '))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3H5a2 2 0 0 0-2 2v4.5a1 1 0 0 0 .29.71l9 9a1 1 0 0 0 1.42 0l6-6a1 1 0 0 0 0-1.42l-9-9A1 1 0 0 0 9.5 3Z"/><circle cx="6.5" cy="6.5" r="0.5" fill="currentColor"/></svg></span>` : '');
        }
        const titleEl = document.getElementById('bookmark-detail-title');
        if (titleEl && this.activeDetailIndex === index) titleEl.textContent = bookmark.name || 'Bookmark';
    }

    _rebindDetailPanel(index, bookmark, bookmarks, categories) {
        const panel = document.getElementById('bookmark-detail-form');
        if (!panel) return;

        // Abort previous listeners instead of cloneNode — keeps the original element in the DOM.
        if (this._rebindAbort) this._rebindAbort.abort();
        this._rebindAbort = new AbortController();
        const signal = this._rebindAbort.signal;

        const get = (id) => panel.querySelector(`#${id}`);
        const nameEl = get('detail-name');
        const urlEl = get('detail-url');
        const scEl = get('detail-shortcut');
        const catEl = get('detail-category');
        const pinEl = get('detail-pinned');
        const csEl = get('detail-check-status');
        const noteEl = get('detail-note');
        const metaBtn = get('detail-meta-refresh-btn');
        const moveBtn = get('bookmark-detail-move-btn');
        const deleteBtn = get('bookmark-detail-delete-btn');
        const uploadBtn = get('detail-icon-upload-btn');
        const fileInput = get('detail-icon-file');
        const clearBtn = get('detail-icon-clear-btn');
        const iconUrlInput = get('detail-icon-url');
        const iconUrlBtn = get('detail-icon-url-btn');

        if (nameEl) nameEl.addEventListener('input', (e) => {
            bookmark.name = e.target.value;
            this._syncRow(index, bookmark);
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        if (urlEl) urlEl.addEventListener('input', (e) => {
            bookmark.url = e.target.value;
            const isDup = bookmarks.some((b, i) => i !== index && (b.url || '').trim().toLowerCase() === e.target.value.trim().toLowerCase());
            urlEl.classList.toggle('field-conflict', isDup);
            if (window.configManager?.validateBookmarkConflicts) window.configManager.validateBookmarkConflicts({ showToast: false });
            this._syncRow(index, bookmark);
            const policy = window.configManager?.settingsData?.faviconRefreshPolicy || 'on-save';
            if (policy === 'on-save') this._scheduleDetailMetaRefresh(index, bookmark);
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        if (scEl) scEl.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
            bookmark.shortcut = e.target.value;
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        if (catEl) catEl.addEventListener('change', (e) => {
            bookmark.category = e.target.value;
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        if (pinEl) pinEl.addEventListener('change', (e) => {
            bookmark.pinned = e.target.checked;
            this._syncRow(index, bookmark);
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        if (csEl) csEl.addEventListener('change', (e) => {
            bookmark.checkStatus = e.target.checked;
            this._syncRow(index, bookmark);
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        if (noteEl) noteEl.addEventListener('input', (e) => {
            bookmark.note = e.target.value;
            this._syncRow(index, bookmark);
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        const tagsEl = get('detail-tags');
        if (tagsEl) {
            tagsEl.addEventListener('input', (e) => {
                bookmark.tags = e.target.value
                    .split(',')
                    .map(t => t.trim().toLowerCase())
                    .filter(t => t.length > 0)
                    .filter((t, i, arr) => arr.indexOf(t) === i);
                bookmark.tags.forEach(t => _sessionTags.add(t));
                this._syncRow(index, bookmark);
                if (window.configManager?.markDirty) window.configManager.markDirty();
            }, { signal });

            // Seed session pool from all loaded bookmarks
            (window.configManager?.allBookmarksData ?? []).forEach(bm => (bm.tags || []).forEach(t => _sessionTags.add(t)));

            TagAutocomplete.attach(tagsEl, () => {
                // Also add whatever is currently typed so mid-entry tokens are suggestable
                tagsEl.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).forEach(t => _sessionTags.add(t));
                return [..._sessionTags];
            });
            signal.addEventListener('abort', () => TagAutocomplete.detach(tagsEl));
        }

        if (metaBtn) metaBtn.addEventListener('click', () => this._refreshDetailMeta(index, bookmark), { signal });

        if (moveBtn) moveBtn.addEventListener('click', () => {
            window.configManager.moveBookmark(this.activeDetailIndex ?? index);
        }, { signal });

        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', () => fileInput.click(), { signal });
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                await this._uploadIconFileDetail(file, bookmark, index);
                e.target.value = '';
            }, { signal });
        }

        if (clearBtn) clearBtn.addEventListener('click', () => this._clearIconDetail(index, bookmark), { signal });

        if (iconUrlBtn && iconUrlInput) {
            iconUrlBtn.addEventListener('click', async () => {
                await this._uploadIconFromUrlDetail(iconUrlInput.value, bookmark, index);
            }, { signal });
            iconUrlInput.addEventListener('keydown', async (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                await this._uploadIconFromUrlDetail(iconUrlInput.value, bookmark, index);
            }, { signal });
        }
    }

    _scheduleDetailMetaRefresh(index, bookmark) {
        const key = `detail-${index}`;
        const existing = this.metadataTimers.get(key);
        if (existing) clearTimeout(existing);
        this.metadataTimers.set(key, setTimeout(() => this._refreshDetailMeta(index, bookmark), 450));
    }

    async _refreshDetailMeta(index, bookmark) {
        const url = (bookmark?.url || '').trim();
        if (!url) return;
        try {
            const faviconUrl = this.deriveFaviconFromBookmarkUrl(url);
            if (faviconUrl) {
                const ok = await this._assignIconFromUrlDetail(faviconUrl, bookmark, index);
                bookmark.iconFetchState = ok ? 'ok' : 'no_icon';
            }
        } catch (err) {
            bookmark.iconFetchState = 'failed';
        }
    }

    async _assignIconFromUrlDetail(remoteUrl, bookmark, index) {
        const response = await fetch('/api/icon/from-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: remoteUrl })
        });
        if (!response.ok) return false;
        const result = await response.json();
        bookmark.icon = result.icon || '';
        if (!bookmark.icon) return false;
        this._updateDetailIconPreview(bookmark);
        this._syncRow(index, bookmark);
        return true;
    }

    async _uploadIconFileDetail(file, bookmark, index) {
        const formData = new FormData();
        formData.append('icon', file);
        try {
            const response = await fetch('/api/icon', { method: 'POST', body: formData });
            if (!response.ok) throw new Error(await response.text() || 'Upload failed');
            const result = await response.json();
            bookmark.icon = result.icon || '';
            this._updateDetailIconPreview(bookmark);
            this._syncRow(index, bookmark);
            this.notify('Icon geupload.', 'success');
        } catch (err) {
            this.notify('Upload icon mislukt.', 'error');
        }
    }

    async _uploadIconFromUrlDetail(iconUrl, bookmark, index) {
        const safeUrl = (iconUrl || '').trim();
        if (!safeUrl) { this.notify('Vul een icon URL in.', 'info'); return; }
        try {
            const ok = await this._assignIconFromUrlDetail(safeUrl, bookmark, index);
            if (!ok) throw new Error('Failed');
            this.notify('Icon URL ingesteld.', 'success');
        } catch (err) {
            const fallback = this.deriveFaviconFromBookmarkUrl(bookmark?.url);
            if (fallback) {
                const ok2 = await this._assignIconFromUrlDetail(fallback, bookmark, index);
                if (ok2) { this.notify('Icon URL faalde, favicon.ico gebruikt.', 'success'); return; }
            }
            this.notify('Icon URL ongeldig of geblokkeerd.', 'error');
        }
    }

    _clearIconDetail(index, bookmark) {
        const prev = bookmark.icon || '';
        if (!prev) return;
        bookmark.icon = '';
        this._updateDetailIconPreview(bookmark);
        this._syncRow(index, bookmark);
        if (window.configManager?.ui?.showNotification) {
            window.configManager.ui.showNotification('Icon verwijderd.', 'success', {
                actionLabel: 'Undo',
                onAction: () => {
                    bookmark.icon = prev;
                    this._updateDetailIconPreview(bookmark);
                    this._syncRow(index, bookmark);
                    this.notify('Icon hersteld.', 'success');
                }
            });
        } else {
            this.notify('Icon verwijderd.', 'success');
        }
    }

    scheduleBookmarkMetadataRefresh(index, bookmark, bookmarkElement) {
        const existingTimer = this.metadataTimers.get(index);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        const timer = setTimeout(() => {
            this.refreshBookmarkMetadata(bookmark, bookmarkElement);
        }, 450);
        this.metadataTimers.set(index, timer);
    }

    async refreshBookmarkMetadata(bookmark, bookmarkElement) {
        const url = (bookmark?.url || '').trim();
        if (!url) {
            bookmark.iconFetchState = 'missing_url';
            return;
        }

        try {
            const faviconUrl = this.deriveFaviconFromBookmarkUrl(url);
            let iconAssigned = false;
            if (faviconUrl) {
                iconAssigned = await this.tryAssignIconFromRemoteUrl(faviconUrl, bookmark, bookmarkElement);
            }
            bookmark.iconFetchState = iconAssigned ? 'ok' : 'no_icon';
        } catch (error) {
            bookmark.iconFetchState = 'failed';
        }
    }

    async bulkRefreshFavicons(bookmarks) {
        const indexes = this.getSelectedIndexes();
        if (!Array.isArray(indexes) || indexes.length === 0) {
            return 0;
        }
        let refreshed = 0;
        for (const index of indexes) {
            const bookmark = bookmarks[index];
            if (!bookmark) continue;
            const bookmarkElement = document.querySelector(`[data-bookmark-index="${index}"]`);
            await this.refreshBookmarkMetadata(bookmark, bookmarkElement, { force: true });
            refreshed += 1;
        }
        return refreshed;
    }

    notify(message, type = 'info') {
        if (window.configManager?.ui?.showNotification) {
            window.configManager.ui.showNotification(message, type);
        }
    }

    async uploadBookmarkIconFile(file, bookmark, bookmarkElement) {
        const formData = new FormData();
        formData.append('icon', file);
        try {
            const response = await fetch('/api/icon', {
                method: 'POST',
                body: formData
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to upload icon file');
            }
            const result = await response.json();
            bookmark.icon = result.icon || '';
            this.updateIconControls(bookmarkElement);
            const urlInput = bookmarkElement.querySelector('[id^="bookmark-icon-url-"]');
            if (urlInput && bookmark.icon) {
                urlInput.value = `/data/icons/${bookmark.icon}`;
            }
            this.notify('Icon geupload.', 'success');
        } catch (error) {
            this.notify('Upload icon mislukt.', 'error');
        }
    }

    async uploadBookmarkIconFromUrl(iconUrl, bookmark, bookmarkElement) {
        const safeUrl = (iconUrl || '').trim();
        if (!safeUrl) {
            this.notify('Vul een icon URL in.', 'info');
            return;
        }
        try {
            const assigned = await this.tryAssignIconFromRemoteUrl(safeUrl, bookmark, bookmarkElement);
            if (!assigned) {
                throw new Error('Primary icon URL failed');
            }
            this.notify('Icon URL ingesteld.', 'success');
            return;
        } catch (error) {
            const fallbackUrl = this.deriveFaviconFromBookmarkUrl(bookmark?.url);
            if (!fallbackUrl) {
                this.notify('Icon URL ongeldig of geblokkeerd.', 'error');
                return;
            }
            const fallbackAssigned = await this.tryAssignIconFromRemoteUrl(fallbackUrl, bookmark, bookmarkElement);
            if (fallbackAssigned) {
                this.notify('Icon URL faalde, favicon.ico gebruikt.', 'success');
                return;
            }
            this.notify('Icon URL ongeldig of geblokkeerd.', 'error');
        }
    }

    async tryAssignIconFromRemoteUrl(remoteUrl, bookmark, bookmarkElement) {
        const response = await fetch('/api/icon/from-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: remoteUrl })
        });
        if (!response.ok) {
            return false;
        }
        const result = await response.json();
        bookmark.icon = result.icon || '';
        if (!bookmark.icon) {
            return false;
        }
        this.updateIconControls(bookmarkElement);
        const urlInput = bookmarkElement.querySelector('[id^="bookmark-icon-url-"]');
        if (urlInput && bookmark.icon) {
            urlInput.value = `/data/icons/${bookmark.icon}`;
        }
        return true;
    }

    deriveFaviconFromBookmarkUrl(bookmarkUrl) {
        const safeUrl = (bookmarkUrl || '').trim();
        if (!safeUrl) {
            return '';
        }
        try {
            const parsed = new URL(safeUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return '';
            }
            return `${parsed.protocol}//${parsed.host}/favicon.ico`;
        } catch (error) {
            return '';
        }
    }

    updateIconControls(bookmarkElement) {
        if (!bookmarkElement || !bookmarkElement._bookmarkRef) {
            return;
        }
        const bookmark = bookmarkElement._bookmarkRef;
        const iconButton = bookmarkElement.querySelector('.btn-upload-icon');
        if (iconButton) {
            iconButton.classList.toggle('has-icon', Boolean(bookmark.icon));
        }

        const uploadWrap = bookmarkElement.querySelector('.bookmark-icon-upload');
        if (!uploadWrap) {
            return;
        }
        const clearButton = uploadWrap.querySelector('.btn-clear-icon');
        if (clearButton) {
            clearButton.disabled = !bookmark.icon;
        }
        const preview = uploadWrap.querySelector('.bookmark-icon-preview');
        if (preview) {
            preview.classList.toggle('has-icon', Boolean(bookmark.icon));
            if (bookmark.icon) {
                preview.innerHTML = `<img src="/data/icons/${bookmark.icon}" alt="">`;
            } else {
                preview.innerHTML = '<span class="bookmark-icon-preview-empty">No icon</span>';
            }
        }
    }

    /**
     * Initialize bookmark reordering
     * @param {Array} bookmarks
     * @param {Function} onReorder - Callback when reorder happens
     */
    initReorder(bookmarks, onReorder, options = {}) {
        const filterCategory = options.filterCategory || this.currentFilterCategory;

        // Destroy previous instance if it exists
        if (this.bookmarkReorder) {
            this.bookmarkReorder.destroy();
        }

        const container = document.getElementById('bookmarks-list');
        if (!container || container.querySelectorAll('.bookmark-item').length === 0) {
            return;
        }
        
        // Initialize drag-and-drop reordering
        this.bookmarkReorder = new DragReorder({
            container: '#bookmarks-list',
            itemSelector: '.bookmark-item',
            handleSelector: '.js-drag-handle',
            onReorder: (newOrder) => {
                const reorderedScopedBookmarks = [];
                newOrder.forEach((item) => {
                    const bookmark = item.element._bookmarkRef;
                    if (bookmark) {
                        reorderedScopedBookmarks.push(bookmark);
                    }
                });

                if (filterCategory === '__all__') {
                    onReorder(reorderedScopedBookmarks);
                    return;
                }

                const nextBookmarks = [];
                let scopeIndex = 0;
                bookmarks.forEach((bookmark) => {
                    const inScope = (filterCategory === '__none__')
                        ? this.isBookmarkUncategorized(bookmark)
                        : bookmark.category === filterCategory;

                    if (inScope) {
                        nextBookmarks.push(reorderedScopedBookmarks[scopeIndex] || bookmark);
                        scopeIndex += 1;
                    } else {
                        nextBookmarks.push(bookmark);
                    }
                });

                onReorder(nextBookmarks);
            }
        });

        this.setupKeyboardReorder(bookmarks, onReorder, { filterCategory });
    }

    setupKeyboardReorder(bookmarks, onReorder, options = {}) {
        const container = document.getElementById('bookmarks-list');
        if (!container) {
            return;
        }

        if (this.keyboardReorderHandler) {
            container.removeEventListener('keydown', this.keyboardReorderHandler);
        }

        const filterCategory = options.filterCategory || this.currentFilterCategory;

        this.keyboardReorderHandler = (e) => {
            if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) {
                return;
            }

            const bookmarkItem = e.target.closest('.bookmark-item');
            if (!bookmarkItem) {
                return;
            }

            const currentIndex = parseInt(bookmarkItem.getAttribute('data-bookmark-index'), 10);
            if (Number.isNaN(currentIndex)) {
                return;
            }

            const scopedIndexes = bookmarks
                .map((bookmark, index) => ({ bookmark, index }))
                .filter(({ bookmark }) => {
                    if (filterCategory === '__all__') {
                        return true;
                    }
                    if (filterCategory === '__none__') {
                        return this.isBookmarkUncategorized(bookmark);
                    }
                    return bookmark.category === filterCategory;
                })
                .map(({ index }) => index);

            const scopedPosition = scopedIndexes.indexOf(currentIndex);
            if (scopedPosition === -1) {
                return;
            }

            const targetPosition = e.key === 'ArrowUp' ? scopedPosition - 1 : scopedPosition + 1;
            if (targetPosition < 0 || targetPosition >= scopedIndexes.length) {
                return;
            }

            e.preventDefault();

            const targetIndex = scopedIndexes[targetPosition];
            const nextBookmarks = [...bookmarks];
            const temp = nextBookmarks[currentIndex];
            nextBookmarks[currentIndex] = nextBookmarks[targetIndex];
            nextBookmarks[targetIndex] = temp;
            onReorder(nextBookmarks, {
                focusIndex: targetIndex,
                highlightIndex: targetIndex
            });
        };

        container.addEventListener('keydown', this.keyboardReorderHandler);
    }

    /**
     * Add a new bookmark
     * @param {Array} bookmarks
     * @returns {Object} - The new bookmark
     */
    add(bookmarks, options = {}) {
        const preferredCategory = options.preferredCategory || '';
        const newBookmark = {
            name: `${this.t('config.newBookmarkPrefix')} ${bookmarks.length + 1}`,
            url: 'https://example.com',
            shortcut: '',
            category: preferredCategory,
            pinned: false,
            checkStatus: false,
            createdAt: Date.now()
        };
        bookmarks.push(newBookmark);
        return newBookmark;
    }

    /**
     * Remove a bookmark (with confirmation)
     * @param {Array} bookmarks
     * @param {number} index
     * @returns {Promise<boolean>} - Whether the bookmark was removed
     */
    async remove(bookmarks, index) {
        const confirmed = await window.AppModal.danger({
            title: this.t('config.removeBookmarkTitle'),
            message: this.t('config.removeBookmarkMessage'),
            confirmText: this.t('config.remove'),
            cancelText: this.t('config.cancel')
        });
        
        if (!confirmed) {
            return false;
        }
        
        bookmarks.splice(index, 1);
        this.selectedBookmarkIndexes.delete(index);
        return true;
    }

    getSelectedIndexes() {
        return Array.from(this.selectedBookmarkIndexes).sort((a, b) => a - b);
    }

    clearSelection() {
        this.selectedBookmarkIndexes.clear();
        this.updateBulkSelectionToolbar();
        document.querySelectorAll('.bookmark-select-checkbox').forEach((checkbox) => {
            checkbox.checked = false;
        });
    }

    selectAllVisible() {
        document.querySelectorAll('.bookmark-item').forEach((item) => {
            const index = parseInt(item.getAttribute('data-bookmark-index'), 10);
            const checkbox = item.querySelector('.bookmark-select-checkbox');
            if (!Number.isNaN(index) && checkbox) {
                this.selectedBookmarkIndexes.add(index);
                checkbox.checked = true;
            }
        });
        this.updateBulkSelectionToolbar();
    }

    updateBulkSelectionToolbar() {
        const count = this.selectedBookmarkIndexes.size;
        const bulkToolbar = document.getElementById('bookmarks-bulk-toolbar');
        // If selection count changed since last update, reset dismissed state
        if (count !== this._prevSelectedCount) {
            this.bulkToolbarDismissed = false;
        }

        if (bulkToolbar) {
            if (count > 0 && !this.bulkToolbarDismissed) {
                bulkToolbar.classList.add('is-active-selection');
            } else {
                bulkToolbar.classList.remove('is-active-selection');
            }

            // ensure the close button is bound once
            if (!bulkToolbar.__closeBound) {
                const closeBtn = document.getElementById('bulk-toolbar-close-btn');
                if (closeBtn) {
                    closeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.bulkToolbarDismissed = true;
                        bulkToolbar.classList.remove('is-active-selection');
                    });
                }
                bulkToolbar.__closeBound = true;
            }
        }

        const countLabel = document.getElementById('bulk-selection-count');
        if (countLabel) countLabel.textContent = String(count);

        ['bulk-delete-bookmarks-btn', 'bulk-apply-category-btn', 'bulk-toggle-pin-btn',
         'bulk-toggle-status-btn', 'bulk-move-page-btn', 'bulk-refresh-favicons-btn'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.disabled = count === 0;
        });

        const statusSelect = document.getElementById('bulk-status-action-select');
        if (statusSelect) statusSelect.disabled = count === 0;

        const bulkCatSelect = document.getElementById('bulk-category-select');
        if (bulkCatSelect) bulkCatSelect.disabled = count === 0;

        const bulkPageSelect = document.getElementById('bulk-page-select');
        if (bulkPageSelect) bulkPageSelect.disabled = count === 0;

        this._prevSelectedCount = count;
    }

    async bulkDelete(bookmarks) {
        const indexes = this.getSelectedIndexes();
        if (indexes.length === 0) return false;

        const confirmed = await window.AppModal.danger({
            title: 'Delete selected bookmarks',
            message: `Delete ${indexes.length} selected bookmarks?`,
            confirmText: this.t('config.remove'),
            cancelText: this.t('config.cancel')
        });

        if (!confirmed) return false;

        for (let i = indexes.length - 1; i >= 0; i--) {
            bookmarks.splice(indexes[i], 1);
        }
        this.clearSelection();
        return true;
    }

    bulkUpdateCategory(bookmarks, categoryId) {
        let updated = 0;
        this.getSelectedIndexes().forEach((index) => {
            if (bookmarks[index]) {
                bookmarks[index].category = categoryId;
                updated += 1;
            }
        });
        this.clearSelection();
        return updated;
    }

    bulkTogglePin(bookmarks) {
        this.getSelectedIndexes().forEach((index) => {
            if (bookmarks[index]) {
                bookmarks[index].pinned = !bookmarks[index].pinned;
            }
        });
        this.clearSelection();
    }

    bulkToggleStatus(bookmarks) {
        this.bulkSetStatus(bookmarks, 'toggle');
    }

    bulkSetStatus(bookmarks, mode = 'toggle') {
        const indexes = this.getSelectedIndexes();
        let updated = 0;
        indexes.forEach((index) => {
            if (!bookmarks[index]) return;
            if (mode === 'enable') {
                bookmarks[index].checkStatus = true;
            } else if (mode === 'disable') {
                bookmarks[index].checkStatus = false;
            } else {
                bookmarks[index].checkStatus = !bookmarks[index].checkStatus;
            }
            updated += 1;
        });
        this.clearSelection();
        return updated;
    }

    /**
     * Clear the icon from a bookmark
     * @param {number} index - The index of the bookmark to clear the icon from
     */
    clearIcon(index) {
        // Find the bookmark element
        const bookmarkElement = document.querySelector(`[data-bookmark-index="${index}"]`);
        if (!bookmarkElement || !bookmarkElement._bookmarkRef) {
            return;
        }

        const bookmark = bookmarkElement._bookmarkRef;
        const previousIcon = bookmark.icon || '';
        if (!previousIcon) {
            return;
        }
        
        // Clear the icon
        bookmark.icon = '';
        const iconUrlInput = bookmarkElement.querySelector('[id^="bookmark-icon-url-"]');
        if (iconUrlInput) {
            iconUrlInput.value = '';
        }

        this.updateIconControls(bookmarkElement);

        const restore = () => {
            bookmark.icon = previousIcon;
            if (iconUrlInput) {
                iconUrlInput.value = `/data/icons/${previousIcon}`;
            }
            this.updateIconControls(bookmarkElement);
            this.notify('Icon hersteld.', 'success');
        };

        this.pendingIconUndo = { index, restore };
        if (window.configManager?.ui?.showNotification) {
            window.configManager.ui.showNotification('Icon verwijderd.', 'success', {
                actionLabel: 'Undo',
                onAction: () => {
                    if (this.pendingIconUndo && this.pendingIconUndo.index === index) {
                        this.pendingIconUndo.restore();
                        this.pendingIconUndo = null;
                    }
                }
            });
            return;
        }
        this.notify('Icon verwijderd.', 'success');
    }
}

// Export for use in other modules
window.ConfigBookmarks = ConfigBookmarks;
