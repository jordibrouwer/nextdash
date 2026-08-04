/**
 * Labels, modals, modal-open guards.
 */
class DashboardUiHelpers {
    constructor(dashboard) {
        this.dash = dashboard;
        this._cheatSheetKeyHandler = null;
    }

    formatDashboardLabel(key, replacements = {}, fallback = '') {
        const d = this.dash;
        const dashKey = `dashboard.${key}`;
        let text = d.language?.t(dashKey);
        if (!text || text === dashKey) {
            const configKey = `config.${key}`;
            const configText = d.language?.t(configKey);
            text = (configText && configText !== configKey) ? configText : (fallback || key);
        }
        Object.entries(replacements).forEach(([name, value]) => {
            text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        });
        return text;
    }


    configLabel(key, fallback = '') {
        const d = this.dash;
        const fullKey = `config.${key}`;
        const value = d.language?.t(fullKey);
        return value && value !== fullKey ? value : fallback;
    }


    bookmarkFallbackName() {
        const d = this.dash;
        return this.configLabel('detailBookmarkFallback', '')
            || this.formatDashboardLabel('bookmarkLinkFallback', {}, 'Bookmark');
    }


    escapeHtml(value) {
        const d = this.dash;
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }





    /**
     * Recent bookmarks by `lastOpened` (newest first).
     *
     * Scope is **whatever array you pass** — this helper does not read `d.bookmarks` or
     * `d.allBookmarks` itself. All dashboard “recent” UX is **page-local**:
     *
     * - `d.bookmarks` — bookmarks on the **current page** (use this for `*` modal, `:open last`,
     *   open-tabs actions, and any new recent UI).
     * - `d.allBookmarks` — every bookmark on **all pages** (search / global shortcuts only).
     *   Do **not** pass `allBookmarks` here unless you intentionally add a cross-page recent feature
     *   and update copy (cheat sheet, help, commands) to say “across all pages”.
     *
     * `lastOpened` is updated when a bookmark is opened on the dashboard; it is per bookmark record,
     * but filtering by page still requires passing only that page’s rows.
     *
     * @param {Array<object>} bookmarks — usually `d.bookmarks` (current page)
     * @param {number} [limit=10] — max rows returned; `limit <= 0` returns the full sorted list
     * @returns {Array<object>}
     */

    isVisibleBlockingOverlay(el) {
        const d = this.dash;
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 8 && rect.height > 8;
    }


    isModalOpen() {
        const d = this.dash;
        const appModal = document.getElementById('app-modal');
        if (appModal?.classList.contains('show')) return true;
        if (window.DashboardTagCloud?.modalOpen) return true;
        if (document.getElementById('omnibox-overlay')) return true;
        if (document.getElementById('date-popover')) return true;
        if (document.getElementById('move-popover')) return true;
        if (document.getElementById('delete-popover')) return true;
        if (document.getElementById('tag-popover')) return true;
        if (document.querySelector('.feature-spotlight.show')) return true;
        // Config's confirm dialog — both the plain and the type-to-confirm
        // variant reuse this id. It is injected straight into the document
        // rather than reusing #app-modal, so without this the config Escape
        // handler did not count it as layered over the view: it claimed the key
        // with stopImmediatePropagation() and closed config, leaving the dialog
        // stranded on the dashboard underneath.
        if (document.getElementById('config-confirm-modal')) return true;
        if (document.getElementById('paste-choice-modal')?.classList.contains('show')) return true;
        if (this.dash.inbox?.triage?.isOpen?.()) return true;
        if (document.getElementById('new-bookmark-modal')?.classList.contains('show')) return true;
        if (document.getElementById('bookmark-form-modal')?.classList.contains('show')) return true;
        return false;
    }


    /**
     * Rows come from KeyboardCheatSheetRegistry so the modal, the printable
     * one-pager, and the validation scripts cannot drift apart.
     */
    getKeyboardCheatSheetItems() {
        const d = this.dash;
        const t = (key, fallback, opts) => {
            if (!d.language?.t) return fallback;
            // Legend keys shared with the inline view legends live flat under
            // dashboard.*, not under dashboard.cheatsheet.*.
            const fullKey = opts?.flatKey ? `dashboard.${key}` : `dashboard.cheatsheet.${key}`;
            const value = d.language.t(fullKey);
            return value !== fullKey ? value : fallback;
        };
        const registry = window.KeyboardCheatSheetRegistry;
        if (!registry) {
            return [];
        }
        return registry.buildSections(d, t);
    }

    /**
     * Which section the sheet should lead with, from where it was opened.
     * Triage wins over the inbox behind it — that overlay is what the user is
     * actually looking at.
     */
    getKeyboardCheatSheetContext() {
        const registry = window.KeyboardCheatSheetRegistry;
        if (!registry) return 'bookmarks';
        return registry.activeContextId(registry.buildContext(this.dash));
    }

    showKeyboardCheatSheet() {
        const d = this.dash;
        if (!window.AppModal) {
            return;
        }
        window.nextdashTrack?.('modal:cheatsheet');
        // Record for the first-run quick-start checklist (server-side, per-user).
        // Only while onboarding is still in progress, so we don't write on every open.
        if (d.settings && d.settings.onboardingCompleted !== true) {
            const qs = d.settings.quickStart || (d.settings.quickStart = {});
            if (qs.seenCheatsheet !== true) {
                qs.seenCheatsheet = true;
                Promise.resolve(d.saveSettings?.()).catch(() => {});
                // Update the checklist immediately instead of waiting for the next poll.
                d.quickStart?.refresh?.();
            }
        }
        this._cleanupCheatSheetKeyHandler();

        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        const sections = this.getKeyboardCheatSheetItems();
        const formatKeys = (keys) => {
            if (window.ShortcutFormat && typeof window.ShortcutFormat.keysToHtml === 'function') {
                return window.ShortcutFormat.keysToHtml(keys);
            }
            return keys;
        };
        const filterPlaceholder = d.language?.t('dashboard.cheatsheetFilterPlaceholder') || 'Filter shortcuts…';
        const noResultsText = d.language?.t('dashboard.cheatsheetNoResults') || 'No shortcuts match your filter.';
        const esc = (text) => this.escapeHtml(String(text ?? ''));
        // Opening from Health should not mean scrolling past eight sections to
        // reach the rows for the view you are looking at. The matching section
        // opens and leads; nothing is hidden, so the filter still sees everything.
        const context = this.getKeyboardCheatSheetContext();
        // Bookmarks is the default the sheet has always opened on, so it gets no
        // lead line and no marked section: there is nothing to orient someone to.
        const contextIndex = context === 'bookmarks'
            ? -1
            : sections.findIndex((section) => section.contextId === context);
        const leadKey = `cheatsheetContext${context.replace(/(^|-)([a-z])/g, (_m, _d, c) => c.toUpperCase())}Lead`;
        const leadText = context === 'bookmarks'
            ? ''
            : (d.language?.t(`dashboard.${leadKey}`) || '');
        const showLead = leadText && leadText !== `dashboard.${leadKey}`;
        const html = `
            <div class="keyboard-cheat-sheet" data-context="${esc(context)}">
                ${showLead ? `<p class="cheat-sheet-context-lead">${esc(leadText)}</p>` : ''}
                <input type="text" id="cheat-sheet-filter" class="cheat-sheet-filter"
                       placeholder="${esc(filterPlaceholder)}" autocomplete="off" spellcheck="false"
                       aria-label="${esc(filterPlaceholder)}">
                <p id="cheat-sheet-no-results" class="cheat-sheet-no-results" hidden>${esc(noResultsText)}</p>
                ${sections.map((section, i) => {
                    const isContext = contextIndex >= 0 && i === contextIndex;
                    // Falls back to the first section when the view has no section
                    // of its own, which is the behaviour this always had.
                    const open = contextIndex >= 0 ? isContext : i === 0;
                    return `
                    <details class="cheat-sheet-group${isContext ? ' cheat-sheet-group--context' : ''}" ${open ? 'open' : ''}${isContext ? ' data-context-section="true"' : ''}>
                        <summary class="cheat-sheet-group-title">${esc(section.title)}</summary>
                        <table class="keyboard-cheat-sheet-table">
                            <tbody>
                                ${section.items.map((shortcut) => `
                                    <tr>
                                        <td class="keyboard-cheat-sheet-keys">${formatKeys(shortcut.keys)}</td>
                                        <td class="keyboard-cheat-sheet-description">${esc(shortcut.description)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </details>
                `;
                }).join('')}
            </div>
        `;

        window.AppModal.show({
            title: d.language?.t('dashboard.cheatsheetTitle') || 'keyboard shortcuts',
            htmlMessage: html,
            confirmText: d.language?.t('dashboard.cheatsheetClose') || 'close',
            showCancel: false,
            modalClass: 'keyboard-cheat-sheet-modal',
            initialFocusSelector: '#cheat-sheet-filter',
            onHide: () => {
                this._cleanupCheatSheetKeyHandler();
            },
        });

        const filterInput = document.getElementById('cheat-sheet-filter');
        if (!filterInput) return;

        filterInput.addEventListener('input', () => {
            const q = filterInput.value.toLowerCase().trim();
            const groups = document.querySelectorAll('.cheat-sheet-group');
            const noResults = document.getElementById('cheat-sheet-no-results');
            let anyVisible = false;
            groups.forEach((group, i) => {
                const rows = group.querySelectorAll('tr');
                let visible = 0;
                rows.forEach(row => {
                    const match = !q || row.textContent.toLowerCase().includes(q);
                    row.style.display = match ? '' : 'none';
                    if (match) visible++;
                });
                if (q) {
                    group.hidden = visible === 0;
                    if (visible > 0) {
                        group.open = true;
                        anyVisible = true;
                    }
                } else {
                    group.hidden = false;
                    group.open = i === 0;
                    anyVisible = true;
                }
            });
            if (noResults) {
                noResults.hidden = !q || anyVisible;
            }
        });
        this._setupCheatSheetKeyboardNav();
    }


    _cleanupCheatSheetKeyHandler() {
        if (!this._cheatSheetKeyHandler) {
            return;
        }
        document.removeEventListener('keydown', this._cheatSheetKeyHandler, true);
        this._cheatSheetKeyHandler = null;
    }


    _setupCheatSheetKeyboardNav() {
        const d = this.dash;
        this._cleanupCheatSheetKeyHandler();
        this._cheatSheetKeyHandler = (e) => {
            const overlay = document.getElementById('app-modal');
            const panel = overlay?.querySelector('.keyboard-cheat-sheet-modal');
            if (!overlay?.classList.contains('show') || !panel) {
                this._cleanupCheatSheetKeyHandler();
                return;
            }

            if (!panel.contains(document.activeElement)) {
                return;
            }

            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
                const filter = panel.querySelector('#cheat-sheet-filter');
                if (filter instanceof HTMLElement) {
                    e.preventDefault();
                    e.stopPropagation();
                    filter.focus({ preventScroll: true });
                    if (typeof filter.select === 'function') {
                        filter.select();
                    }
                }
                return;
            }

            const activeSummary = document.activeElement?.closest?.('.cheat-sheet-group-title');
            if (activeSummary && (e.key === ' ' || e.key === 'Enter')) {
                const details = activeSummary.closest('details.cheat-sheet-group');
                if (details instanceof HTMLDetailsElement) {
                    e.preventDefault();
                    e.stopPropagation();
                    details.open = !details.open;
                }
                return;
            }

            const active = document.activeElement;
            const isTypingTarget = active instanceof HTMLElement
                && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
            if (isTypingTarget) {
                return;
            }

            const body = panel.querySelector('.modal-body');
            const scrollRoot = body instanceof HTMLElement ? body : panel;
            const lineStep = 56;
            const pageStep = Math.max(200, Math.floor(scrollRoot.clientHeight * 0.85));
            let handled = true;
            switch (e.key) {
                case 'ArrowDown':
                    scrollRoot.scrollBy({ top: lineStep, behavior: 'smooth' });
                    break;
                case 'ArrowUp':
                    scrollRoot.scrollBy({ top: -lineStep, behavior: 'smooth' });
                    break;
                case 'PageDown':
                    scrollRoot.scrollBy({ top: pageStep, behavior: 'smooth' });
                    break;
                case 'PageUp':
                    scrollRoot.scrollBy({ top: -pageStep, behavior: 'smooth' });
                    break;
                case 'Home':
                    scrollRoot.scrollTo({ top: 0, behavior: 'smooth' });
                    break;
                case 'End':
                    scrollRoot.scrollTo({ top: scrollRoot.scrollHeight, behavior: 'smooth' });
                    break;
                default:
                    handled = false;
                    break;
            }
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener('keydown', this._cheatSheetKeyHandler, true);
    }


    isPageOverviewModalOpen() {
        const overlay = document.getElementById('app-modal');
        return overlay?.classList.contains('show') === true
            && Boolean(overlay.querySelector('.page-overview-modal'));
    }


    _cleanupPageOverviewKeyHandler() {
        if (this._pageOverviewKeyHandler) {
            document.removeEventListener('keydown', this._pageOverviewKeyHandler, true);
            this._pageOverviewKeyHandler = null;
        }
    }


    _buildPageOverviewHtml(pages, allBookmarks) {
        const d = this.dash;
        const listLabel = this.formatDashboardLabel('pagesOverviewAria', {}, 'Page overview');
        const items = pages.map((page, idx) => {
            const count = allBookmarks.filter((b) => String(b.pageId) === String(page.id)).length;
            const isCurrent = d.samePageId(page.id, d.currentPageId);
            const pageName = page.name || this.formatDashboardLabel('pageOverviewFallbackName', { index: idx + 1 }, `Page ${idx + 1}`);
            const ariaLabel = this.formatDashboardLabel('pageOverviewItemAria', { name: pageName, count }, `${pageName}, ${count} bookmarks`);
            const leadParts = [];
            if (page.icon) {
                leadParts.push(`<span class="page-tab-icon" aria-hidden="true">${d.escapeHtml(page.icon)}</span>`);
            } else {
                leadParts.push(`<span class="page-overview-modal-num" aria-hidden="true">${idx + 1}</span>`);
            }
            if (page.color) {
                leadParts.push(`<span class="page-tab-dot" style="background:${d.escapeHtml(page.color)}" aria-hidden="true"></span>`);
            }
            return `
                <li class="page-overview-modal-item${isCurrent ? ' is-current' : ''}" data-page-idx="${idx}">
                    <button type="button" class="page-overview-modal-link" data-page-id="${d.escapeHtml(String(page.id))}" aria-current="${isCurrent ? 'page' : 'false'}" aria-label="${d.escapeHtml(ariaLabel)}">
                        <span class="page-overview-modal-lead">${leadParts.join('')}</span>
                        <span class="page-overview-modal-body">
                            <span class="page-overview-modal-name">${d.escapeHtml(pageName)}</span>
                        </span>
                        <span class="page-overview-modal-count">${count}</span>
                    </button>
                </li>
            `;
        }).join('');
        return `<ul class="page-overview-modal-list" role="listbox" aria-label="${d.escapeHtml(listLabel)}">${items}</ul>`;
    }


    _setupPageOverviewKeyboardNav(pages, listRoot) {
        const d = this.dash;
        this._cleanupPageOverviewKeyHandler();
        if (!listRoot || pages.length === 0) {
            return;
        }

        let focusedIndex = pages.findIndex((p) => d.samePageId(p.id, d.currentPageId));
        if (focusedIndex < 0) focusedIndex = 0;

        const items = () => Array.from(listRoot.querySelectorAll('.page-overview-modal-item'));

        const setFocus = (idx) => {
            if (pages.length === 0) {
                return;
            }
            focusedIndex = ((idx % pages.length) + pages.length) % pages.length;
            items().forEach((el, i) => {
                el.classList.toggle('is-focused', i === focusedIndex);
                if (i === focusedIndex) {
                    const btn = el.querySelector('.page-overview-modal-link');
                    btn?.focus({ preventScroll: true });
                    el.scrollIntoView({ block: 'nearest' });
                }
            });
        };

        const navigateTo = async (page) => {
            if (!page) {
                return;
            }
            const switched = await d.requestPageNavigation(page.id);
            if (switched) {
                window.AppModal?.hide?.();
            }
        };

        listRoot.querySelectorAll('.page-overview-modal-link').forEach((btn, idx) => {
            btn.addEventListener('click', () => {
                void navigateTo(pages[idx]);
            });
        });

        this._pageOverviewKeyHandler = (e) => {
            if (!this.isPageOverviewModalOpen()) {
                this._cleanupPageOverviewKeyHandler();
                return;
            }
            if (e.key === ',') {
                e.preventDefault();
                e.stopPropagation();
                window.AppModal?.hide?.();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocus(focusedIndex + 1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocus(focusedIndex - 1);
            } else if (e.key === 'Enter' || e.key === ' ') {
                if (e.target?.classList?.contains('page-overview-modal-link')) {
                    e.preventDefault();
                    void navigateTo(pages[focusedIndex]);
                }
            } else if (e.key >= '1' && e.key <= '9') {
                const idx = parseInt(e.key, 10) - 1;
                if (idx < pages.length) {
                    e.preventDefault();
                    void navigateTo(pages[idx]);
                }
            }
        };
        document.addEventListener('keydown', this._pageOverviewKeyHandler, true);
        setFocus(focusedIndex);
    }


    async showPageOverlay() {
        const d = this.dash;
        if (this.isPageOverviewModalOpen() || !window.AppModal) {
            return;
        }

        const pages = Array.isArray(d.pages) ? d.pages : [];
        if (pages.length === 0) {
            return;
        }

        if (pages.length > 1 && (!Array.isArray(d.allBookmarks) || d.allBookmarks.length === 0)) {
            await d.loadAllBookmarks();
        }

        const allBookmarks = Array.isArray(d.allBookmarks) ? d.allBookmarks : [];
        const pagesLabel = d.language?.t('dashboard.pagesOverview');
        const title = pagesLabel && pagesLabel !== 'dashboard.pagesOverview' ? pagesLabel : 'Pages';
        const closeLabel = d.language?.t('dashboard.closePageOverview');
        const confirmText = closeLabel && closeLabel !== 'dashboard.closePageOverview' ? closeLabel : 'Close';

        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        window.AppModal.show({
            title,
            htmlMessage: this._buildPageOverviewHtml(pages, allBookmarks),
            confirmText,
            showCancel: false,
            modalClass: 'page-overview-modal',
            modalMaxWidth: '22rem',
            modalWidth: 'min(22rem, calc(100vw - 2.5rem))',
            onHide: () => {
                this._cleanupPageOverviewKeyHandler();
                const restoreTarget = document.getElementById('page-overview-header-btn');
                if (restoreTarget && typeof restoreTarget.focus === 'function') {
                    restoreTarget.focus({ preventScroll: true });
                }
            },
        });

        const listRoot = document.querySelector('#app-modal .page-overview-modal-list');
        this._setupPageOverviewKeyboardNav(pages, listRoot);
    }


    showOmnibox() {
        const d = this.dash;
        if (document.getElementById('omnibox-overlay')) return;

        const previousFocus = document.activeElement;
        const overlay = document.createElement('div');
        overlay.id = 'omnibox-overlay';
        overlay.className = 'omnibox-overlay';

        const box = document.createElement('div');
        box.className = 'omnibox-box';

        const t = (key) => d.language && typeof d.language.t === 'function' ? d.language.t(key) : key.split('.').pop();
        const hint = document.createElement('span');
        hint.className = 'omnibox-hint';
        hint.textContent = t('dashboard.quickAddHint');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'omnibox-input';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = t('dashboard.quickAddHint');

        const status = document.createElement('span');
        status.className = 'omnibox-status';

        box.appendChild(hint);
        box.appendChild(input);
        box.appendChild(status);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        window.dashboardInstance?.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        window.FocusTrapUtils?.syncDashboardInert?.();

        const close = () => {
            overlay.remove();
            document.removeEventListener('keydown', onKey, true);
            window.FocusTrapUtils?.syncDashboardInert?.();
            const restoreTarget = (previousFocus && previousFocus.isConnected)
                ? previousFocus
                : document.getElementById('quick-add-toolbar-btn');
            if (restoreTarget && typeof restoreTarget.focus === 'function') {
                restoreTarget.focus({ preventScroll: true });
            }
        };

        const submit = async () => {
            const raw = input.value.trim();
            if (!raw) { close(); return; }

            const parts = raw.split('|').map(p => p.trim());
            const name = parts[0] || '';
            const url = parts[1] || '';
            const shortcut = (parts[2] || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

            if (!name || !url) {
                status.textContent = t('dashboard.quickAddNameUrlRequired');
                status.classList.add('is-error');
                input.focus();
                return;
            }

            if (shortcut) {
                const duplicate = (d.allBookmarks || []).some(
                    b => (b.shortcut || '').toUpperCase() === shortcut
                );
                if (duplicate) {
                    status.textContent = t('dashboard.quickAddShortcutExists').replace('{shortcut}', shortcut);
                    status.classList.add('is-error');
                    input.focus();
                    return;
                }
            }

            let fullUrl = window.BookmarkUrlUtils?.ensureHttpUrl(url) || url;
            if (!/^https?:\/\//i.test(fullUrl)) fullUrl = 'https://' + url;

            status.textContent = t('dashboard.quickAddFetchingFavicon');
            status.classList.remove('is-error');
            input.disabled = true;

            let icon = '';
            let previewTitle = '';
            let previewDesc = '';
            let previewImage = '';
            try {
                if (window.BookmarkPreviewService) {
                    icon = await window.BookmarkPreviewService.fetchAndUploadFavicon(fullUrl);
                    try {
                        const preview = await window.BookmarkPreviewService.fetchLinkPreview(fullUrl);
                        previewTitle = preview.title || '';
                        previewDesc = preview.description || '';
                        previewImage = preview.image || '';
                    } catch { /* optional */ }
                }
            } catch { /* favicon is optional */ }

            status.textContent = t('dashboard.quickAddAdding');

            try {
                const response = await dashFetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        page: d.currentPageId,
                        bookmark: {
                            name,
                            url: fullUrl,
                            shortcut,
                            category: '',
                            pinned: false,
                            checkStatus: false,
                            icon,
                            previewTitle: previewTitle || undefined,
                            previewDesc: previewDesc || undefined,
                            previewImage: previewImage || undefined,
                            createdAt: Date.now()
                        }
                    })
                });
                if (response.ok) {
                    close();
                    if (d.data?.refreshAfterBookmarkAdded) {
                        await d.data.refreshAfterBookmarkAdded(d.currentPageId);
                    } else {
                        d.data?.invalidatePageDataCache?.(Number(d.currentPageId));
                        await d.loadPageBookmarks(d.currentPageId, { forceFetch: true });
                        if (d.settings.globalShortcuts) {
                            await d.loadAllBookmarks();
                        }
                    }
                    d.showNotification(t('dashboard.quickAddAdded').replace('{name}', name), 'success');
                } else if (response.status === 409) {
                    status.textContent = t('dashboard.quickAddUrlExists');
                    status.classList.add('is-error');
                    input.disabled = false;
                    input.focus();
                } else {
                    status.textContent = t('dashboard.quickAddAddFailed');
                    status.classList.add('is-error');
                    input.disabled = false;
                    input.focus();
                }
            } catch {
                status.textContent = t('dashboard.quickAddNetworkError');
                status.classList.add('is-error');
                input.disabled = false;
                input.focus();
            }
        };

        const onKey = (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                window.FocusTrapUtils?.trapTabKey(e, box);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                submit();
            }
        };

        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        input.focus({ preventScroll: true });
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
            input.focus({ preventScroll: true });
        });
    }

}

window.DashboardUiHelpers = DashboardUiHelpers;
