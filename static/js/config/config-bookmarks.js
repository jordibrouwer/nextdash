/**
 * Bookmarks Module
 * Handles bookmark management (create, render, remove, reorder)
 */

// Session-level tag pool — grows as tags are typed/saved, persists across bookmark switches
const _sessionTags = new Set();

class ConfigBookmarks {
    constructor(t) {
        this.t = t; // Translation function
        this.bookmarkReorder = null;
        this.currentFilterCategory = '__all__';
        this.currentSearchQuery = '';
        this.keyboardReorderHandler = null;
        this.selectedBookmarkIndexes = new Set();
        this.pendingIconUndo = null;
        this.metadataTimers = new Map();
        this.activeDetailIndex = null;
        this._detailMetaGen = new Map();
        this._rebindAbort = null;
        this.bulkToolbarDismissed = false;
        this._prevSelectedCount = 0;
        this.formPreview = null;
    }

    ensureFormPreview() {
        if (!this.formPreview && window.BookmarkFormPreview) {
            this.formPreview = new window.BookmarkFormPreview({
                prefix: 'detail',
                getSettings: () => window.configManager?.settingsData || {},
                t: (key, fb) => this.t(key) || fb,
                notify: (msg, type) => this.notify(msg, type),
                onPreviewChange: () => window.configManager?.markDirty?.(),
            });
        }
        return this.formPreview;
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
        this.currentSearchQuery = options.searchQuery !== undefined ? options.searchQuery : this.currentSearchQuery;

        container.innerHTML = '';

        let scopedBookmarks = this.getScopedBookmarks(bookmarks, this.currentFilterCategory, this.currentSearchQuery);

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
        } else if (sortOrder === 'last-opened-desc') {
            scopedBookmarks = [...scopedBookmarks].sort((a, b) =>
                (Number(b.bookmark.lastOpened) || 0) - (Number(a.bookmark.lastOpened) || 0));
        }

        if (scopedBookmarks.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            const isMobile = window.MobileExperience?.isMobileLayout?.() || window.matchMedia?.('(max-width: 767px)')?.matches;
            const hintKey = isMobile ? 'config.noBookmarksHintMobile' : 'config.noBookmarksHint';
            emptyState.innerHTML = `
                <div class="empty-state-icon">📚</div>
                <div class="empty-state-text">${this.t('config.noBookmarks') || 'No bookmarks in this category'}</div>
                <div class="empty-state-subtext">${this.t(hintKey) || this.t('config.noBookmarksHint') || 'Use + Add or ⚡ below to create a bookmark.'}</div>
                <div class="empty-state-action">
                    <button type="button" class="btn btn-primary btn-small config-empty-add-btn">${this.t('config.addBookmark') || '+ Add'}</button>
                    <a class="btn btn-secondary btn-small" href="/config#backups" data-i18n="config.importDescription">Import your data</a>
                </div>
            `;
            emptyState.querySelector('.config-empty-add-btn')?.addEventListener('click', () => {
                if (typeof configManager?.addBookmark === 'function') {
                    configManager.addBookmark();
                }
            });
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
        window.ConfigSettingsSearch?.refreshIndex?.();
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
            if (typeof window.configManager.renderCategoriesList === 'function') {
                window.configManager.renderCategoriesList();
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

    getScopedBookmarks(bookmarks, filterCategory = '__all__', searchQuery = '') {
        if (!Array.isArray(bookmarks)) {
            return [];
        }

        let result;

        if (filterCategory === '__all__') {
            result = bookmarks.map((bookmark, index) => ({ bookmark, index }));
        } else if (filterCategory === '__none__') {
            result = bookmarks
                .map((bookmark, index) => ({ bookmark, index }))
                .filter(({ bookmark }) => this.isBookmarkUncategorized(bookmark));
        } else if (filterCategory === '__missing_icon__') {
            result = bookmarks
                .map((bookmark, index) => ({ bookmark, index }))
                .filter(({ bookmark }) => !bookmark.icon);
        } else if (filterCategory === '__icon_failed__') {
            result = bookmarks
                .map((bookmark, index) => ({ bookmark, index }))
                .filter(({ bookmark }) => bookmark.iconFetchState === 'failed');
        } else {
            result = bookmarks
                .map((bookmark, index) => ({ bookmark, index }))
                .filter(({ bookmark }) => bookmark.category === filterCategory);
        }

        const q = (searchQuery || '').trim().toLowerCase();
        if (!q) return result;

        return result.filter(({ bookmark }) => {
            const name = (bookmark.name || '').toLowerCase();
            const url = (bookmark.url || '').toLowerCase();
            const tags = (bookmark.tags || []).join(' ').toLowerCase();
            const note = (bookmark.note || '').toLowerCase();
            return name.includes(q) || url.includes(q) || tags.includes(q) || note.includes(q);
        });
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
        const lastOpened = bookmark.lastOpened ? new Date(bookmark.lastOpened) : null;
        const lastOpenedStr = lastOpened ? lastOpened.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '';

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
                <span class="bookmark-row-name" title="${this._escHtml(bookmark.name || '')}">${this._escHtml(bookmark.name || '')}</span>
                <span class="bookmark-row-meta">
                    <span class="bookmark-row-url" title="${this._escHtml(bookmark.url || '')}">${this._escHtml(urlDisplay)}</span>
                    ${catName ? `<span class="bookmark-row-cat">${this._escHtml(catName)}</span>` : ''}
                    ${openCount > 0 ? `<span class="bookmark-row-opens">${openCount}×${lastOpenedStr ? `<span class="bookmark-row-last-opened">${lastOpenedStr}</span>` : ''}</span>` : ''}
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

    setDetailPanelMode(mode = 'empty') {
        const panel = document.getElementById('bookmark-detail-panel');
        const emptyEl = document.getElementById('bookmark-detail-empty');
        const formEl = document.getElementById('bookmark-detail-form');
        const editing = mode === 'editing';

        panel?.classList.toggle('is-editing', editing);

        if (editing) {
            if (emptyEl) emptyEl.hidden = true;
            if (formEl) formEl.hidden = false;
            return;
        }

        if (formEl) formEl.hidden = true;
        if (emptyEl) emptyEl.hidden = false;
    }

    openDetailPanel(index, bookmarks, categories) {
        this.activeDetailIndex = index;
        const bookmark = bookmarks[index];
        if (!bookmark) return;
        // Config's counterpart to the dashboard's inline editor. There is no
        // per-bookmark save here — fields write straight into the page's data and
        // one Save button commits the lot — so only the open is countable.
        window.nextdashTrack?.('bookmark:edit-open', { source: 'config' });
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

        this.setDetailPanelMode('editing');

        // Rebind first (replaces panel with a clean clone), then populate into the clone.
        this._rebindDetailPanel(index, bookmark, bookmarks, categories);
        this._populateDetailPanel(index, bookmark, bookmarks, categories);
    }

    _populateDetailPanel(index, bookmark, bookmarks, categories) {
        const title = document.getElementById('bookmark-detail-title');
        if (title) title.textContent = bookmark.name || this.t('config.detailBookmarkFallback') || 'Bookmark';

        const nameEl = document.getElementById('detail-name');
        if (nameEl) nameEl.value = bookmark.name || '';

        const urlEl = document.getElementById('detail-url');
        const urlConflictMsg = document.getElementById('detail-url-conflict-msg');
        if (urlEl) {
            urlEl.value = bookmark.url || '';
            const normalizedUrl = (bookmark.url || '').trim().toLowerCase();
            const isDupUrl = Boolean(normalizedUrl) && bookmarks.some((b, i) => i !== index && (b.url || '').trim().toLowerCase() === normalizedUrl);
            urlEl.classList.toggle('field-conflict', isDupUrl);
            if (urlConflictMsg) urlConflictMsg.hidden = !isDupUrl;
        }

        const scEl = document.getElementById('detail-shortcut');
        const scConflictMsg = document.getElementById('detail-shortcut-conflict-msg');
        if (scEl) {
            scEl.value = bookmark.shortcut || '';
            const normalizedSc = (bookmark.shortcut || '').trim().toUpperCase();
            const isDupSc = Boolean(normalizedSc) && bookmarks.some((b, i) => i !== index && (b.shortcut || '').trim().toUpperCase() === normalizedSc);
            scEl.classList.toggle('field-conflict', isDupSc);
            if (scConflictMsg) scConflictMsg.hidden = !isDupSc;
            if (isDupSc) {
                scEl.title = this.t('config.shortcutUniqueHint') || 'Shortcut must be unique within this page.';
            } else {
                scEl.removeAttribute('title');
            }
        }

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

        const mode = bookmark.monitor ? 'monitor' : (bookmark.checkStatus ? 'periodic' : 'off');
        const modeEl = document.getElementById(`detail-check-mode-${mode}`);
        if (modeEl) modeEl.checked = true;

        const monIntervalEl = document.getElementById('detail-monitor-interval');
        if (monIntervalEl) monIntervalEl.value = String(window.CheckMode.intervalOf(bookmark));
        this._syncCheckMode(mode);

        const noteEl = document.getElementById('detail-note');
        if (noteEl) noteEl.value = bookmark.note || '';

        const tagsEl = document.getElementById('detail-tags');
        if (tagsEl) tagsEl.value = (bookmark.tags ?? []).join(', ');

        this._updateDetailIconPreview(bookmark);
        this._updateLinkPreviewCard(bookmark);
    }

    /**
     * Reflect the chosen check mode: show the interval only for Monitor, and
     * describe the mode below the control so the difference is stated rather than
     * implied.
     *
     * select.js replaces the native control with a .custom-select-wrapper, so the
     * `hidden` attribute has to move to that wrapper — setting it on the (already
     * display:none) <select> would toggle nothing on screen.
     */
    /** Same explanation as the dashboard inline editor, reachable from the (i). */
    _showCheckModeExplainer() {
        const t = (key, fallback) => {
            const full = `config.${key}`;
            const v = window.i18n?.t ? window.i18n.t(full) : null;
            return v && v !== full ? v : fallback;
        };
        const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
        const row = (title, body) => `<div class="check-mode-explain-row"><h4>${esc(title)}</h4><p>${esc(body)}</p></div>`;
        const html = `<div class="check-mode-explain">
            ${row(t('checkModePeriodic', 'Periodic'), t('checkModeExplainPeriodic', 'Answers one question: is this link still alive? It is checked in the background about once a day, and a broken bookmark is flagged in the health view. Cheap, and enough for most bookmarks.'))}
            ${row(t('checkModeMonitor', 'Monitor'), t('checkModeExplainMonitor', 'Answers a bigger question: how reliable has it been? It is checked on the interval you pick (from 5 minutes) and keeps history, so you get an uptime percentage, a heartbeat bar, outage history and optional alerts. Use it for the handful of services you actually care about being up.'))}
            ${row(t('checkModeExplainWhichTitle', 'Which should I pick?'), t('checkModeExplainWhich', 'Monitor includes everything Periodic does, so there is never a reason to want both. Periodic suits your ordinary links; Monitor suits your own servers and dashboards. Monitoring everything would make a lot of network requests and a large history file for little benefit.'))}
        </div>`;

        if (window.AppModal?.show) {
            window.AppModal.show({
                title: t('checkModeExplainTitle', 'How availability checking works'),
                htmlMessage: html,
                confirmText: t('checkModeExplainClose', 'Got it'),
                // Informational only — a Cancel button would imply the explanation
                // could be declined.
                showCancel: false,
                modalClass: 'check-mode-explain-modal',
            });
        }
    }

    _syncCheckMode(mode) {
        const select = document.getElementById('detail-monitor-interval');
        if (select) {
            const target = select.closest('.custom-select-wrapper') || select;
            target.hidden = mode !== 'monitor';
        }
        const hint = document.getElementById('detail-check-mode-hint');
        if (!hint) return;
        const key = mode === 'monitor'
            ? 'checkModeMonitorHint'
            : (mode === 'periodic' ? 'checkModePeriodicHint' : 'checkModeOffHint');
        const fallback = {
            checkModeOffHint: 'No availability checking.',
            checkModePeriodicHint: 'Checks once a day and flags the bookmark when it breaks.',
            checkModeMonitorHint: 'Checks on your own interval and keeps uptime history, a heartbeat and outage alerts. Includes everything Periodic does.',
        }[key];
        const translated = window.i18n?.t ? window.i18n.t(`config.${key}`) : null;
        hint.textContent = translated && translated !== `config.${key}` ? translated : fallback;
        hint.setAttribute('data-i18n', `config.${key}`);
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
        this._updateDashboardPreview(bookmark);
    }

    _buildDashboardPreviewHtml(bookmark, expanded) {
        return this.ensureFormPreview()?.buildDashboardPreviewHtml(bookmark, expanded) || '';
    }

    _updateDashboardPreview(bookmark) {
        this.ensureFormPreview()?.updateDashboardPreview(bookmark);
    }

    _hasLinkPreviewMetadata(bookmark) {
        return this.ensureFormPreview()?.hasLinkPreviewMetadata(bookmark) || false;
    }

    _updateLinkPreviewCard(bookmark) {
        this.ensureFormPreview()?.updateLinkPreviewCard(bookmark);
    }

    async _refreshLinkPreview(index, bookmark) {
        const fp = this.ensureFormPreview();
        if (!fp) return;
        const ok = await fp.refreshLinkPreview(bookmark);
        if (ok) window.configManager?.markDirty?.();
    }

    _clearLinkPreview(index, bookmark) {
        this.ensureFormPreview()?.clearLinkPreview(bookmark);
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
        if (nameSpan) { nameSpan.textContent = bookmark.name || ''; nameSpan.title = bookmark.name || ''; }
        if (urlSpan) {
            try { urlSpan.textContent = new URL(bookmark.url || '').hostname; } catch (e) { urlSpan.textContent = bookmark.url || ''; }
            urlSpan.title = bookmark.url || '';
        }
        if (metaSpan) {
            const cats = window.configManager?.bookmarksPageCategories || [];
            const cat = cats.find(c => c.id === bookmark.category);
            const catName = cat ? cat.name : '';
            const openCount = Number(bookmark.openCount || 0);
            const lastOpened = bookmark.lastOpened ? new Date(bookmark.lastOpened) : null;
            const lastOpenedStr = lastOpened ? lastOpened.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '';
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
                if (openCount > 0) {
                    opensSpan.innerHTML = `${openCount}×${lastOpenedStr ? `<span class="bookmark-row-last-opened">${lastOpenedStr}</span>` : ''}`;
                    opensSpan.style.display = '';
                } else {
                    opensSpan.innerHTML = '';
                    opensSpan.style.display = 'none';
                }
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
        if (titleEl && this.activeDetailIndex === index) titleEl.textContent = bookmark.name || this.t('config.detailBookmarkFallback') || 'Bookmark';
        if (this.activeDetailIndex === index) {
            this._updateDashboardPreview(bookmark);
            this._updateLinkPreviewCard(bookmark);
        }
    }

    _rebindDetailPanel(index, bookmark, bookmarks, categories) {
        const panel = document.getElementById('bookmark-detail-form');
        if (!panel) return;

        // Abort previous listeners instead of cloneNode — keeps the original element in the DOM.
        if (this._rebindAbort) this._rebindAbort.abort();
        this._invalidateDetailMetaGeneration(index);
        window.BookmarkPreviewService?.cancelDebounced(`detail-meta-${index}`);
        this._rebindAbort = new AbortController();
        const signal = this._rebindAbort.signal;

        const get = (id) => panel.querySelector(`#${id}`);
        const nameEl = get('detail-name');
        const urlEl = get('detail-url');
        const scEl = get('detail-shortcut');
        const catEl = get('detail-category');
        const pinEl = get('detail-pinned');
        const modeEls = Array.from(panel.querySelectorAll('.bookmark-detail-checkmode-input'));
        const checkModeInfoEl = get('detail-check-mode-info');
        const monIntervalEl = get('detail-monitor-interval');
        const noteEl = get('detail-note');
        const metaBtn = get('detail-meta-refresh-btn');
        const linkPreviewRefreshBtn = get('detail-link-preview-refresh-btn');
        const linkPreviewClearBtn = get('detail-link-preview-clear-btn');
        const moveBtn = get('bookmark-detail-move-btn');
        const deleteBtn = get('bookmark-detail-delete-btn');
        const uploadBtn = get('detail-icon-upload-btn');
        const fileInput = get('detail-icon-file');
        const clearBtn = get('detail-icon-clear-btn');
        const iconUrlInput = get('detail-icon-url');
        const iconUrlBtn = get('detail-icon-url-btn');

        if (nameEl) nameEl.addEventListener('input', (e) => {
            bookmark.name = e.target.value;
            delete bookmark._isNew;
            this._syncRow(index, bookmark);
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        const urlConflictMsg = panel.querySelector('#detail-url-conflict-msg');
        const urlProtocolHint = panel.querySelector('#detail-url-protocol-hint');
        if (urlEl) urlEl.addEventListener('input', (e) => {
            bookmark.url = e.target.value;
            delete bookmark._isNew;
            const trimmed = e.target.value.trim();
            const isDup = Boolean(trimmed) && bookmarks.some((b, i) => i !== index && (b.url || '').trim().toLowerCase() === trimmed.toLowerCase());
            urlEl.classList.toggle('field-conflict', isDup);
            if (urlConflictMsg) urlConflictMsg.hidden = !isDup;
            if (urlProtocolHint) urlProtocolHint.hidden = !trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
            if (window.configManager?.validateBookmarkConflicts) window.configManager.validateBookmarkConflicts({ showToast: false });
            this._syncRow(index, bookmark);
            if (isDup) {
                const key = `detail-${index}`;
                const t = this.metadataTimers?.get(key);
                if (t) { clearTimeout(t); this.metadataTimers.delete(key); }
                window.BookmarkPreviewService?.cancelDebounced(`detail-meta-${index}`);
                this._invalidateDetailMetaGeneration(index);
            } else {
                const policy = window.configManager?.settingsData?.faviconRefreshPolicy || 'on-save';
                if (policy === 'on-save') {
                    this._invalidateDetailMetaGeneration(index);
                    this._scheduleDetailMetaRefresh(index, bookmark);
                }
            }
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        if (urlEl) urlEl.addEventListener('blur', () => {
            const normalized = window.BookmarkUrlUtils?.ensureHttpUrl(urlEl.value) || urlEl.value.trim();
            if (normalized && normalized !== urlEl.value.trim()) {
                urlEl.value = normalized;
                bookmark.url = normalized;
                this._syncRow(index, bookmark);
                if (window.configManager?.markDirty) window.configManager.markDirty();
                const policy = window.configManager?.settingsData?.faviconRefreshPolicy || 'on-save';
                if (policy === 'on-save') {
                    this._invalidateDetailMetaGeneration(index);
                    this._scheduleDetailMetaRefresh(index, bookmark);
                }
            }
            if (urlProtocolHint) urlProtocolHint.hidden = true;
        }, { signal });

        if (scEl) scEl.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
            bookmark.shortcut = e.target.value;
            const normalizedSc = e.target.value.trim().toUpperCase();
            const isDupSc = Boolean(normalizedSc) && bookmarks.some((b, i) => i !== index && (b.shortcut || '').trim().toUpperCase() === normalizedSc);
            scEl.classList.toggle('field-conflict', isDupSc);
            const scConflictMsg = panel.querySelector('#detail-shortcut-conflict-msg');
            if (scConflictMsg) scConflictMsg.hidden = !isDupSc;
            this._updateDashboardPreview(bookmark);
            if (window.configManager?.validateBookmarkConflicts) window.configManager.validateBookmarkConflicts({ showToast: false });
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        if (catEl) catEl.addEventListener('change', (e) => {
            bookmark.category = e.target.value;
            if (e.target.value) {
                window.configManager?.saveLastUsedCategoryIdForPage?.(
                    window.configManager?.currentPageId,
                    e.target.value
                );
            }
            this._syncRow(index, bookmark);
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        if (pinEl) pinEl.addEventListener('change', (e) => {
            bookmark.pinned = e.target.checked;
            this._syncRow(index, bookmark);
            if (window.configManager?.markDirty) window.configManager.markDirty();
        }, { signal });

        // One radio group drives both stored booleans, so they can never disagree.
        modeEls.forEach((el) => el.addEventListener('change', (e) => {
            if (!e.target.checked) return;
            const mode = e.target.value;
            bookmark.checkStatus = mode === 'periodic';
            bookmark.monitor = mode === 'monitor';
            // Give a freshly-chosen monitor an explicit interval, so the stored
            // bookmark says what it does rather than relying on the server default.
            if (bookmark.monitor && !bookmark.monitorIntervalMinutes) {
                bookmark.monitorIntervalMinutes = Number(monIntervalEl?.value) || window.CheckMode.DEFAULT_INTERVAL_MINUTES;
            }
            this._syncCheckMode(mode);
            this._syncRow(index, bookmark);
            if (window.configManager?.markDirty) window.configManager.markDirty();
            window.configManager?.settings?.refreshStatusEssentialsSummary?.(
                window.configManager.settingsData,
                window.configManager.allBookmarksData
            );
        }, { signal }));

        if (checkModeInfoEl) checkModeInfoEl.addEventListener('click', (e) => {
            e.preventDefault();
            this._showCheckModeExplainer();
        }, { signal });

        if (monIntervalEl) monIntervalEl.addEventListener('change', (e) => {
            bookmark.monitorIntervalMinutes = Number(e.target.value) || window.CheckMode.DEFAULT_INTERVAL_MINUTES;
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

        if (linkPreviewRefreshBtn) {
            linkPreviewRefreshBtn.addEventListener('click', () => this._refreshLinkPreview(index, bookmark), { signal });
        }
        if (linkPreviewClearBtn) {
            linkPreviewClearBtn.addEventListener('click', () => this._clearLinkPreview(index, bookmark), { signal });
        }

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

    _normalizeDetailMetaUrl(url) {
        const normalized = window.BookmarkUrlUtils?.ensureHttpUrl(url) || String(url || '').trim();
        return normalized.toLowerCase();
    }

    _invalidateDetailMetaGeneration(index) {
        const key = String(index);
        this._detailMetaGen.set(key, (this._detailMetaGen.get(key) || 0) + 1);
    }

    _beginDetailMetaFetch(index, requestUrl) {
        const key = String(index);
        const gen = (this._detailMetaGen.get(key) || 0) + 1;
        this._detailMetaGen.set(key, gen);
        return { gen, requestUrl: this._normalizeDetailMetaUrl(requestUrl) };
    }

    _isDetailMetaFetchStale(index, gen, requestUrl) {
        if (this.activeDetailIndex !== index) return true;
        if (this._detailMetaGen.get(String(index)) !== gen) return true;
        const bookmarks = window.configManager?.bookmarksData;
        const currentUrl = this._normalizeDetailMetaUrl(bookmarks?.[index]?.url);
        return currentUrl !== this._normalizeDetailMetaUrl(requestUrl);
    }

    _scheduleDetailMetaRefresh(index, bookmark) {
        const key = `detail-meta-${index}`;
        window.BookmarkPreviewService?.scheduleDebounced(key, () => {
            void this._refreshDetailMeta(index, bookmark);
        }, 450);
    }

    async _refreshDetailMeta(index, bookmark) {
        const url = window.BookmarkUrlUtils?.ensureHttpUrl(bookmark?.url) || String(bookmark?.url || '').trim();
        if (!url) return;

        const { gen, requestUrl } = this._beginDetailMetaFetch(index, url);
        bookmark.url = url;

        const btn = document.getElementById('detail-meta-refresh-btn');
        if (btn) btn.disabled = true;
        try {
            let preview = null;
            try {
                preview = await window.BookmarkPreviewService.fetchLinkPreview(url);
            } catch { /* network error — fall through to favicon fallback */ }

            if (this._isDetailMetaFetchStale(index, gen, requestUrl)) return;

            const iconUrl = String(preview?.icon || '').trim();
            let icon = iconUrl
                ? await window.BookmarkPreviewService.uploadIconFromUrl(iconUrl)
                : '';
            if (!icon) {
                const fallback = window.BookmarkUrlUtils?.deriveFaviconFromBookmarkUrl(url) || '';
                if (fallback) icon = await window.BookmarkPreviewService.uploadIconFromUrl(fallback);
            }

            if (this._isDetailMetaFetchStale(index, gen, requestUrl)) return;

            let dirty = false;

            if (icon) {
                bookmark.icon = icon;
                bookmark.iconFetchState = 'ok';
                this._updateDetailIconPreview(bookmark);
                this._syncRow(index, bookmark);
                dirty = true;
            } else {
                bookmark.iconFetchState = 'no_icon';
            }

            if (preview) {
                bookmark.previewTitle = preview.title || '';
                bookmark.previewDesc = preview.description || '';
                bookmark.previewImage = preview.image || '';
                const fp = this.ensureFormPreview();
                if (fp) {
                    fp.updateLinkPreviewCard(bookmark);
                    fp.onPreviewChange(bookmark);
                }
                dirty = true;
            }

            if (dirty) {
                window.configManager?.markDirty?.();
            }
        } finally {
            if (btn && this._detailMetaGen.get(String(index)) === gen) {
                btn.disabled = false;
            }
        }
    }

    async _assignIconFromUrlDetail(remoteUrl, bookmark, index) {
        const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/icon/from-url', {
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
        window.configManager?.markDirty?.();
        return true;
    }

    async _uploadIconFileDetail(file, bookmark, index) {
        const formData = new FormData();
        formData.append('icon', file);
        try {
            const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/icon', { method: 'POST', body: formData });
            if (!response.ok) throw new Error(await response.text() || 'Upload failed');
            const result = await response.json();
            bookmark.icon = result.icon || '';
            this._updateDetailIconPreview(bookmark);
            this._syncRow(index, bookmark);
            window.configManager?.markDirty?.();
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
        window.configManager?.markDirty?.();
        if (window.configManager?.ui?.showNotification) {
            window.configManager.ui.showNotification('Icon verwijderd.', 'success', {
                actionLabel: 'Undo',
                onAction: () => {
                    bookmark.icon = prev;
                    this._updateDetailIconPreview(bookmark);
                    this._syncRow(index, bookmark);
                    window.configManager?.markDirty?.();
                    this.notify('Icon hersteld.', 'success');
                }
            });
        } else {
            this.notify('Icon verwijderd.', 'success');
        }
    }

    scheduleBookmarkMetadataRefresh(index, bookmark) {
        const existingTimer = this.metadataTimers.get(index);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        const timer = setTimeout(() => {
            void this.refreshBookmarkMetadata(index, bookmark);
        }, 450);
        this.metadataTimers.set(index, timer);
    }

    async refreshBookmarkMetadata(index, bookmark) {
        await this._refreshDetailMeta(index, bookmark);
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
            await this._refreshDetailMeta(index, bookmark);
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
            const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/icon', {
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
        const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/icon/from-url', {
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
        if (window.BookmarkUrlUtils) {
            return window.BookmarkUrlUtils.deriveFaviconFromBookmarkUrl(bookmarkUrl);
        }
        return '';
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
            createdAt: Date.now(),
            _isNew: true
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

        ['bulk-delete-bookmarks-btn', 'bulk-toggle-pin-btn',
         'bulk-toggle-status-btn', 'bulk-move-apply-btn', 'bulk-refresh-favicons-btn',
         'bulk-apply-tags-btn', 'bulk-tags-input', 'bulk-tags-mode-select'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.disabled = count === 0;
        });

        const statusSelect = document.getElementById('bulk-status-action-select');
        if (statusSelect) statusSelect.disabled = count === 0;

        const bulkMoveCategorySelect = document.getElementById('bulk-move-category-select');
        if (bulkMoveCategorySelect) bulkMoveCategorySelect.disabled = count === 0;

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

    bulkApplyTags(bookmarks, tags, mode = 'add') {
        const normalized = (Array.isArray(tags) ? tags : [])
            .map(t => String(t).trim().toLowerCase())
            .filter(t => t.length > 0)
            .filter((t, i, arr) => arr.indexOf(t) === i);
        if (normalized.length === 0) return 0;

        let updated = 0;
        this.getSelectedIndexes().forEach((index) => {
            const bm = bookmarks[index];
            if (!bm) return;
            const existing = Array.isArray(bm.tags) ? bm.tags : [];
            let next;
            if (mode === 'replace') {
                next = [...normalized];
            } else if (mode === 'remove') {
                next = existing.filter(t => !normalized.includes(t));
            } else { // 'add'
                next = [...existing, ...normalized]
                    .filter((t, i, arr) => arr.indexOf(t) === i);
            }
            bm.tags = next;
            normalized.forEach(t => _sessionTags.add(t));
            updated += 1;
        });
        this.clearSelection();
        return updated;
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
