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
        return this.configLabel('detailBookmarkFallback', '')
            || this.formatDashboardLabel('bookmarkLinkFallback', {}, 'Bookmark');
    }


    escapeHtml(value) {
        return window.NextDashHtml.escapeHtml(value);
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
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 8 && rect.height > 8;
    }


    isModalOpen() {
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
        const shortcutCount = sections.reduce((total, section) => total + section.items.length, 0);

        const groupHtml = sections.map((section, i) => {
            const isContext = contextIndex >= 0 && i === contextIndex;
            // Falls back to the first section when the view has no section of
            // its own, which is the behaviour this always had.
            const open = contextIndex >= 0 ? isContext : i === 0;
            return `
                    <details class="cheat-sheet-group${isContext ? ' cheat-sheet-group--context' : ''}" ${open ? 'open' : ''}${isContext ? ' data-context-section="true"' : ''}>
                        <summary class="cheat-sheet-group-title">${esc(section.title)}</summary>
                        <table class="keyboard-cheat-sheet-table">
                            <tbody>
                                ${section.items.map((shortcut) => `
                                    <tr>
                                        <td class="keyboard-cheat-sheet-description">${esc(shortcut.description)}</td>
                                        <td class="keyboard-cheat-sheet-keys">${formatKeys(shortcut.keys)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </details>`;
        });
        const html = `
            <div class="keyboard-cheat-sheet" data-context="${esc(context)}">
                ${showLead ? `<p class="cheat-sheet-context-lead">${esc(leadText)}</p>` : ''}
                <input type="text" id="cheat-sheet-filter" class="cheat-sheet-filter"
                       placeholder="${esc(filterPlaceholder)}" autocomplete="off" spellcheck="false"
                       aria-label="${esc(filterPlaceholder)}">
                <p id="cheat-sheet-no-results" class="cheat-sheet-no-results" hidden>${esc(noResultsText)}</p>
                <div class="cheat-sheet-groups">${groupHtml.join('')}</div>
                <div class="cheat-sheet-foot">
                    <span>${esc(d.formatDashboardLabel('cheatsheetCount', { n: shortcutCount },
                        '{n} shortcuts'))}</span>
                    <span><span class="cheat-sheet-foot-key">Esc</span> ${esc(
                        d.formatDashboardLabel('cheatsheetFootClose', {}, 'to close'))}</span>
                </div>
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

        const cheatHeader = document.querySelector('.keyboard-cheat-sheet-modal .modal-header');
        if (cheatHeader && !cheatHeader.querySelector('.cheat-sheet-modal-key')) {
            const chip = document.createElement('span');
            chip.className = 'cheat-sheet-modal-key';
            chip.dataset.modalHeaderExtra = 'true';
            chip.setAttribute('aria-hidden', 'true');
            chip.textContent = '!';
            document.getElementById('modal-title')?.after(chip);

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'cheat-sheet-modal-close';
            close.dataset.modalHeaderExtra = 'true';
            close.setAttribute('aria-label', d.language?.t('dashboard.close') || 'Close');
            close.innerHTML = '<span aria-hidden="true">Esc</span> \u00D7';
            close.addEventListener('click', () => window.AppModal.hide());
            cheatHeader.appendChild(close);
        }

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


    /*
     * How many pages it takes before the panel offers a filter.
     *
     * Eight rows fit in one look; a filter above them is a control nobody
     * needs and a tab stop everybody meets. Past that the list is something to
     * search rather than to read.
     */
    /**
     * Where a panel that hangs from the header has to sit.
     *
     * The band's bottom edge is the sheet's top edge; the header row is its
     * width and its centre line. Measured rather than written down -- the
     * band's height is the reader's, and the row follows the page's container
     * at every width -- and published so the placement is one rule in CSS
     * rather than a second layout in JavaScript. Both sheets use it: the pages
     * panel and recents.
     */
    static publishHeaderSheetAnchor() {
        const band = document.querySelector('.dashboard-section.section-controls');
        const row = document.querySelector('.header-top');
        if (!band || !row) return;
        const bandBox = band.getBoundingClientRect();
        const rowBox = row.getBoundingClientRect();
        const style = document.body.style;
        style.setProperty('--header-sheet-top', `${Math.round(bandBox.bottom)}px`);
        style.setProperty('--header-sheet-width', `${Math.round(rowBox.width)}px`);
        style.setProperty('--header-sheet-mid', `${Math.round(rowBox.x + rowBox.width / 2)}px`);
    }

    static PAGE_FILTER_FROM = 8;

    /**
     * Past this many pages the sheet spans the page's column and lays the rows
     * out in a grid. Three: that is one full row of the widest layout, so the
     * fourth page is the first that would leave a hole in it.
     */
    static PAGE_SHEET_GRID_FROM = 3;


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
            // The first page cannot be deleted -- the server refuses it, because
            // a dashboard with no pages is not a state anything can render.
            const deletable = Number(page.id) !== 1;
            const deleteLabel = this.formatDashboardLabel('pageOverviewDeleteAria',
                { name: pageName, count },
                `Delete ${pageName} and its ${count} bookmarks`);
            const deleteBtn = deletable
                ? `<button type="button" class="page-overview-modal-delete"
                        data-page-delete="${d.escapeHtml(String(page.id))}"
                        data-page-count="${count}"
                        aria-label="${d.escapeHtml(deleteLabel)}"
                        title="${d.escapeHtml(deleteLabel)}">
                        <span aria-hidden="true">\u00D7</span>
                    </button>`
                : '';
            return `
                <li class="page-overview-modal-item${isCurrent ? ' is-current' : ''}" data-page-idx="${idx}">
                    <button type="button" class="page-overview-modal-link" data-page-id="${d.escapeHtml(String(page.id))}" aria-current="${isCurrent ? 'page' : 'false'}" aria-label="${d.escapeHtml(ariaLabel)}">
                        <span class="page-overview-modal-lead">${leadParts.join('')}</span>
                        <span class="page-overview-modal-body">
                            <span class="page-overview-modal-name">${d.escapeHtml(pageName)}</span>
                        </span>
                        <span class="page-overview-modal-count">${count}</span>
                    </button>
                    ${deleteBtn}
                </li>
            `;
        }).join('');

        // The overlay is where pages are chosen, so it is also where a new one is
        // made. It is a button rather than another row: the list holds places to
        // go, this is a thing to do, and it sits outside the listbox.
        const footHtml = `
            <div class="page-overview-modal-foot">
                <span>${d.escapeHtml(this.formatDashboardLabel('pageOverviewCount', { n: pages.length },
                    pages.length === 1 ? '1 page' : `${pages.length} pages`))}</span>
                <span><span class="page-overview-modal-footkey">\u21B5</span> ${d.escapeHtml(
                    this.formatDashboardLabel('pageOverviewFootOpen', {}, 'open'))}</span>
            </div>`;

        /*
         * One page is not a list with one thing in it.
         *
         * A reader who has never made a second page opens this to find a single
         * row and a small dashed cell under it -- the panel answering a question
         * they have not asked yet. With one page the offer is the point, so it
         * is drawn at full width with the one line of explanation that says what
         * a page is for. Past that it goes back to being the last entry.
         */
        const alone = pages.length === 1;
        const newLabel = this.formatDashboardLabel('pageOverviewNewPage', {}, 'New page');
        const newHint = alone
            ? `<span class="page-overview-modal-newhint">${d.escapeHtml(this.formatDashboardLabel(
                'pageOverviewNewPageHint', {},
                'Pages keep separate sets of bookmarks; the digits 1-9 switch between them.'))}</span>`
            : '';
        const newRow = `
            <div class="page-overview-modal-actions${alone ? ' is-alone' : ''}">
                <button type="button" class="page-overview-modal-new" id="page-overview-new-page">
                    <span class="page-overview-modal-plus" aria-hidden="true">+</span>
                    <span class="page-overview-modal-newlabel">${d.escapeHtml(newLabel)}</span>
                    <span class="page-overview-modal-hintkey" aria-hidden="true">n</span>
                </button>
                ${newHint}
            </div>
        `;

        /*
         * The filter, for the readers who have enough pages to need one.
         *
         * Under eight it is a line of chrome above a list you can already read
         * in one look, so it is not drawn at all. Past eight it is the fastest
         * way in: it takes focus when the panel opens, and typing narrows the
         * rows. The digits keep jumping to the page they name, filtered or not
         * -- the number belongs to the page, not to its place in the list.
         */
        const filterHtml = pages.length > DashboardUiHelpers.PAGE_FILTER_FROM
            ? `<div class="page-overview-modal-filterbar">
                    <input type="search" class="page-overview-modal-filter" id="page-overview-filter"
                        autocomplete="off" spellcheck="false"
                        placeholder="${d.escapeHtml(this.formatDashboardLabel('pageOverviewFilterPlaceholder', {}, 'filter pages…'))}"
                        aria-label="${d.escapeHtml(this.formatDashboardLabel('pageOverviewFilterAria', {}, 'Filter pages by name'))}">
                </div>`
            : '';

        /*
         * The new-page entry continues the list without joining it.
         *
         * It sat in a tinted block of its own under the panel -- a gap, a
         * second surface and a second set of corners for one more line. It now
         * stands on the same slab, flush against the rows, with the hairline
         * its neighbours carry. It stays OUTSIDE the listbox: a listbox holds
         * options, and this is a button, so a screen reader must not count it
         * as one more page to choose.
         */
        return `${filterHtml}<div class="page-overview-modal-slab">`
            + `<ul class="page-overview-modal-list" role="listbox" aria-label="${d.escapeHtml(listLabel)}">${items}</ul>`
            + `${newRow}</div>${footHtml}`;
    }


    /**
     * Swap the overlay's "New page" button for the name row, create on confirm,
     * then go to the new page — an empty page you are not looking at is not what
     * anyone means by "new page".
     */
    _setupPageOverviewCreate() {
        const d = this.dash;
        const host = document.querySelector('#app-modal .page-overview-modal-actions');
        const trigger = document.getElementById('page-overview-new-page');
        if (!host || !trigger || !window.InlineCreateRow) {
            return null;
        }

        const ui = window.InlineCreateRow.create({
            kind: 'page',
            placeholder: d.configLabel('newPageNamePlaceholder', 'Page name'),
            labels: {
                create: d.configLabel('create', 'Create'),
                cancel: this.formatDashboardLabel('cancel', {}, 'Cancel'),
                group: this.formatDashboardLabel('pageOverviewNewPage', {}, 'New page'),
            },
        });
        host.appendChild(ui.box);

        const close = () => {
            ui.box.hidden = true;
            ui.error.hidden = true;
            ui.input.value = '';
            trigger.hidden = false;
            trigger.focus({ preventScroll: true });
        };

        const open = () => {
            trigger.hidden = true;
            ui.box.hidden = false;
            ui.error.hidden = true;
            ui.input.value = '';
            ui.input.focus({ preventScroll: true });
        };

        window.InlineCreateRow.wire(ui, {
            submit: async (name) => {
                const created = await d.structureCreate.createPageFromForm(name);
                if (created.error) {
                    return created.error;
                }
                // Leave before the list behind us is rebuilt: the overlay is
                // showing counts for pages we are navigating away from.
                window.AppModal?.hide?.();
                await d.requestPageNavigation(created.id);
                return null;
            },
            onCancel: close,
        });

        trigger.addEventListener('click', open);
        return { open, close, isOpen: () => ui.box.hidden === false };
    }


    /**
     * Delete a page from the overview, asked twice.
     *
     * Deleting a page takes its bookmarks with it -- the server drops them in
     * the trash, but the page you are looking at empties either way -- so one
     * click is not enough of a decision. The row arms first and says what it is
     * about to take; the second press is the one that does it. Ten seconds
     * later it disarms itself, and so does moving the cursor, pressing Escape,
     * or arming a different row.
     *
     * The first page is not offered: the server refuses to delete it, because a
     * dashboard with no pages is not a state anything can draw.
     */
    _setupPageOverviewDelete(pages, listRoot) {
        const d = this.dash;
        if (!listRoot) return null;

        let armedId = null;
        let timer = 0;

        const rowFor = (id) => listRoot.querySelector(`.page-overview-modal-delete[data-page-delete="${id}"]`)
            ?.closest('.page-overview-modal-item');

        const disarm = () => {
            if (timer) { clearTimeout(timer); timer = 0; }
            if (armedId === null) return;
            const row = rowFor(armedId);
            if (row) {
                row.classList.remove('is-armed');
                row.querySelector('.page-overview-modal-confirm')?.remove();
                const btn = row.querySelector('.page-overview-modal-delete');
                if (btn) btn.setAttribute('aria-pressed', 'false');
            }
            armedId = null;
        };

        const arm = (id) => {
            if (Number(id) === 1) return;
            if (armedId !== null && Number(armedId) === Number(id)) {
                void confirmDelete(id);
                return;
            }
            disarm();
            const row = rowFor(id);
            if (!row) return;
            armedId = Number(id);
            row.classList.add('is-armed');
            const btn = row.querySelector('.page-overview-modal-delete');
            if (btn) btn.setAttribute('aria-pressed', 'true');

            const count = Number(btn?.dataset.pageCount || 0);
            const note = document.createElement('p');
            note.className = 'page-overview-modal-confirm';
            note.setAttribute('role', 'alert');
            note.textContent = this.formatDashboardLabel('pageOverviewDeleteConfirm', { n: count },
                count === 1
                    ? 'Delete this page and 1 bookmark? Press again.'
                    : `Delete this page and ${count} bookmarks? Press again.`);
            row.appendChild(note);

            timer = window.setTimeout(disarm, 10_000);
        };

        const confirmDelete = async (id) => {
            disarm();
            const leaving = d.samePageId(id, d.currentPageId);
            try {
                const res = await dashFetch(`/api/pages/${encodeURIComponent(id)}`, { method: 'DELETE' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            } catch {
                d.showNotification?.(
                    this.formatDashboardLabel('pageOverviewDeleteFailed', {}, 'Could not delete the page.'),
                    'error',
                );
                return;
            }

            d.pages = (d.pages || []).filter((p) => Number(p.id) !== Number(id));
            await d.loadAllBookmarks?.();
            d.pageNav?.renderPageNavigation?.();
            d.showNotification?.(
                this.formatDashboardLabel('pageOverviewDeleted', {}, 'Page deleted.'),
                'success',
            );

            // The page you were on has gone; the panel would otherwise stand
            // over a grid that is still drawing it.
            if (leaving && d.pages.length > 0) {
                window.AppModal?.hide?.();
                await d.requestPageNavigation(d.pages[0].id);
                return;
            }
            if (d.pages.length === 0) {
                window.AppModal?.hide?.();
                return;
            }
            // Redraw the panel over the pages that are left.
            window.AppModal?.hide?.();
            await this.showPageOverlay();
        };

        listRoot.querySelectorAll('.page-overview-modal-delete').forEach((btn) => {
            btn.setAttribute('aria-pressed', 'false');
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                arm(btn.getAttribute('data-page-delete'));
            });
        });

        const api = { arm, disarm, isArmed: () => armedId !== null };
        this._pageOverviewDelete = api;
        return api;
    }


    _setupPageOverviewKeyboardNav(pages, listRoot) {
        const d = this.dash;
        this._cleanupPageOverviewKeyHandler();
        if (!listRoot || pages.length === 0) {
            return;
        }

        const create = this._setupPageOverviewCreate();

        let focusedIndex = pages.findIndex((p) => d.samePageId(p.id, d.currentPageId));
        if (focusedIndex < 0) focusedIndex = 0;

        const items = () => Array.from(listRoot.querySelectorAll('.page-overview-modal-item'));

        // "New page" is one stop past the last page, so ↓ off the bottom of the
        // list reaches it and ↓ again wraps to the first page. Its index is
        // pages.length, which is why the ring below is one longer than the list.
        const newPageIndex = create ? pages.length : -1;
        const ringSize = create ? pages.length + 1 : pages.length;

        /*
         * How many pages stand on a line, counted off the layout.
         *
         * The sheet lays the rows out across the page's column now, so ↓ from
         * the first row must land on the row under it rather than on its
         * neighbour -- which is what a step of one gives you in a grid, and is
         * why vertical navigation stopped working. Counted rather than
         * configured: the number falls out of the sheet's width, and the
         * filter can take rows out of the line at any moment.
         */
        const columnsAcross = () => {
            const drawn = items().filter((el) => !el.hidden && el.offsetParent !== null);
            if (drawn.length < 2) return 1;
            const top = Math.round(drawn[0].getBoundingClientRect().top);
            const across = drawn.filter((el) => Math.abs(Math.round(el.getBoundingClientRect().top) - top) <= 2).length;
            return Math.max(1, across);
        };

        /*
         * `move` says whether the keyboard goes with the cursor.
         *
         * While the filter is being typed into, the ring follows what is left
         * on screen but the focus stays in the field -- moving it would take
         * the next letter with it.
         */
        const setFocus = (idx, move = true) => {
            if (pages.length === 0) {
                return;
            }
            // Moving the cursor takes the safety catch off nothing: an armed row
            // you have walked away from is a delete waiting for a keystroke it
            // was never aimed at.
            this._pageOverviewDelete?.disarm?.();
            focusedIndex = ((idx % ringSize) + ringSize) % ringSize;
            // A hidden row is not a stop: with a filter on, walking past one
            // would land the cursor on something nobody can see.
            const visible = (i) => i === newPageIndex || !items()[i]?.hidden;
            if (!visible(focusedIndex)) {
                const step = idx >= 0 ? 1 : -1;
                for (let n = 0; n < ringSize; n += 1) {
                    focusedIndex = ((focusedIndex + step) % ringSize + ringSize) % ringSize;
                    if (visible(focusedIndex)) break;
                }
            }
            const onNewPage = focusedIndex === newPageIndex;
            items().forEach((el, i) => {
                el.classList.toggle('is-focused', !onNewPage && i === focusedIndex);
                if (!onNewPage && i === focusedIndex) {
                    if (move) el.querySelector('.page-overview-modal-link')?.focus({ preventScroll: true });
                    el.scrollIntoView({ block: 'nearest' });
                }
            });
            if (onNewPage) {
                const trigger = document.getElementById('page-overview-new-page');
                if (move) trigger?.focus({ preventScroll: true });
                trigger?.scrollIntoView({ block: 'nearest' });
            }
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

        const remove = this._setupPageOverviewDelete(pages, listRoot);

        /*
         * Filtering hides rows; it does not renumber them.
         *
         * `3` means the third page whatever is on screen, so the filter only
         * decides what is drawn. Walking with the arrows skips what is hidden,
         * which is why setFocus is told which rows are still there rather than
         * counting them itself.
         */
        const filterInput = document.getElementById('page-overview-filter');
        if (filterInput) {
            const apply = () => {
                const needle = filterInput.value.trim().toLowerCase();
                let firstVisible = -1;
                items().forEach((el, i) => {
                    const name = (el.querySelector('.page-overview-modal-name')?.textContent || '').toLowerCase();
                    const hit = !needle || name.includes(needle);
                    el.hidden = !hit;
                    if (hit && firstVisible < 0) firstVisible = i;
                });
                this._pageOverviewDelete?.disarm?.();
                if (needle && firstVisible >= 0) {
                    setFocus(firstVisible, document.activeElement !== filterInput);
                }
            };
            filterInput.addEventListener('input', apply);
        }

        this._pageOverviewKeyHandler = (e) => {
            if (!this.isPageOverviewModalOpen()) {
                this._cleanupPageOverviewKeyHandler();
                return;
            }
            // While the name row is open it owns the keyboard: every key below is
            // a character someone may be typing into it. The row handles its own
            // Enter and Escape.
            if (create?.isOpen()) {
                return;
            }
            /*
             * The filter line owns the characters while it has focus.
             *
             * `,`, `n` and the digits are the panel's keys, and every one of
             * them is also a letter someone may be typing into the filter. The
             * keys that mean the same thing either way -- the arrows, Enter,
             * Escape -- stay with the panel.
             */
            const typing = document.activeElement?.id === 'page-overview-filter';
            // A digit is a page's key wherever it is pressed: "3" means the
            // third page, filtered or not, typed into or not. Every other
            // character belongs to whatever is being typed.
            const isPageDigit = e.key >= '1' && e.key <= '9';
            if (typing && e.key.length === 1 && !isPageDigit) {
                return;
            }
            /*
             * A letter typed on a row goes to the filter.
             *
             * The panel's own keys are `,`, `n` and the digits; anything else
             * of one character is somebody starting to type a page's name. It
             * is handed over with the letter rather than swallowed, so the
             * filter reads the same whether it had the focus or not.
             */
            if (!typing && filterInput && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey
                && e.key !== ',' && e.key !== 'n' && e.key !== 'N' && !(e.key >= '1' && e.key <= '9')) {
                e.preventDefault();
                e.stopPropagation();
                filterInput.focus({ preventScroll: true });
                filterInput.value += e.key;
                filterInput.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
            if (e.key === ',') {
                e.preventDefault();
                e.stopPropagation();
                window.AppModal?.hide?.();
                return;
            }
            if (e.key === 'n' || e.key === 'N') {
                e.preventDefault();
                e.stopPropagation();
                create?.open();
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const page = pages[focusedIndex];
                if (page && focusedIndex !== newPageIndex) {
                    e.preventDefault();
                    e.stopPropagation();
                    remove?.arm(page.id);
                }
                return;
            }
            if (e.key === 'Escape' && remove?.isArmed()) {
                // The armed row owns Escape: backing out of a delete is not the
                // same gesture as closing the panel, and doing both at once
                // would leave you unsure which one you had cancelled.
                e.preventDefault();
                e.stopPropagation();
                remove.disarm();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocus(focusedIndex + columnsAcross());
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocus(focusedIndex - columnsAcross());
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setFocus(focusedIndex + 1);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setFocus(focusedIndex - 1);
            } else if (e.key === 'Enter' || e.key === ' ') {
                if (e.target?.classList?.contains('page-overview-modal-link')) {
                    e.preventDefault();
                    if (focusedIndex === newPageIndex) {
                        create?.open();
                    } else {
                        void navigateTo(pages[focusedIndex]);
                    }
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
        /*
         * And again once the overlay is really on screen.
         *
         * AppModal.show() adds the class; the CSS transition commits a frame or
         * two later, and .focus() on an element that is still
         * `visibility: hidden` does nothing at all. The call above still runs
         * first because it also draws the ring, which does not depend on
         * visibility — this second pass only lands the focus it could not.
         * Without it the row was focused by AppModal's own deferred pass, which
         * picks the first focusable element rather than the page you are on.
         */
        requestAnimationFrame(() => requestAnimationFrame(() => setFocus(focusedIndex)));
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

        /*
         * The panel hangs from the header rather than floating over the page.
         *
         * It is opened from the strip and it answers a question the strip
         * asks, so it drops out of the band the strip stands in: the band's
         * bottom edge and the panel's top edge are one line, and the panel is
         * centred on the strip. The top is measured here because the band's
         * height is the reader's -- the clock placement and the font size both
         * move it -- and published as a property CSS can read.
         */
        DashboardUiHelpers.publishHeaderSheetAnchor();

        /*
         * Wide enough for a grid, or as wide as what it holds.
         *
         * Past a handful of pages the rows lay out in columns across the
         * page's own width -- one column of nine rows is a list you scroll to
         * read. Under that the panel is the width of its contents, because a
         * 1300px band holding two names is a table with nothing in it.
         */
        const grid = pages.length > DashboardUiHelpers.PAGE_SHEET_GRID_FROM;

        window.AppModal.show({
            title,
            htmlMessage: this._buildPageOverviewHtml(pages, allBookmarks),
            confirmText,
            showCancel: false,
            modalClass: `page-overview-modal header-sheet page-overview-sheet${grid ? ' is-grid' : ' is-compact'}`,
            /*
             * The page you are on takes the focus, not the way out.
             *
             * AppModal focuses the first focusable thing it finds, and the
             * close button in the header is now the first -- so opening the
             * panel put the cursor on "leave" and the first arrow key had to
             * travel back into the list.
             */
            /*
             * The page you are on is where the cursor belongs.
             *
             * With enough pages to earn a filter, the filter used to take the
             * keyboard -- so the panel opened with the cursor at the top of the
             * list whatever page you were standing on, and the first arrow key
             * walked from page one rather than from here. Typing still filters:
             * a letter pressed while a row has the focus is handed to the
             * filter (see the key handler), which is the only thing the filter
             * was taking the focus for.
             */
            initialFocusSelector: '.page-overview-modal-item.is-current .page-overview-modal-link',
            /*
             * The width is the sheet's own business (see page-overview-sheet
             * in modal.css): the grid takes the page's column, the compact
             * states take what they hold. Passing a width here would write an
             * inline style that outranks both.
             */
            onHide: () => {
                this._cleanupPageOverviewKeyHandler();
                const restoreTarget = document.getElementById('page-overview-header-btn');
                if (restoreTarget && typeof restoreTarget.focus === 'function') {
                    restoreTarget.focus({ preventScroll: true });
                }
            },
        });

        /*
         * The header names the key and carries the way out, as the other
         * overlays do. The panel said "close" three times before this: a
         * full-width button, an ESC hint under it, and nothing at all beside
         * its name. Marked as header furniture so the next panel to use this
         * one shell does not inherit it -- see AppModal.show.
         */
        const header = document.querySelector('#app-modal .page-overview-modal .modal-header');
        if (header && !header.querySelector('.page-overview-modal-key')) {
            const chip = document.createElement('span');
            chip.className = 'page-overview-modal-key';
            chip.dataset.modalHeaderExtra = 'true';
            chip.setAttribute('aria-hidden', 'true');
            chip.textContent = ',';
            document.getElementById('modal-title')?.after(chip);

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'page-overview-modal-close';
            close.dataset.modalHeaderExtra = 'true';
            close.setAttribute('aria-label', closeLabel && closeLabel !== 'dashboard.closePageOverview'
                ? closeLabel : 'Close');
            close.innerHTML = '<span aria-hidden="true">Esc</span> \u00D7';
            close.addEventListener('click', () => window.AppModal.hide());
            header.appendChild(close);
        }


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
                const postQuickAdd = (allowDuplicate) => dashFetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        allowDuplicate: Boolean(allowDuplicate),
                        page: d.currentPageId,
                        bookmark: {
                            name,
                            url: fullUrl,
                            shortcut,
                            // Defaults from settings rather than fixed: a
                            // homelab dashboard wants every new service checked,
                            // and quick-add landing everything uncategorised is
                            // what creates the cleanup work later.
                            category: String(d.settings?.newBookmarkCategory || ''),
                            pinned: d.settings?.newBookmarkPinned === true,
                            checkStatus: d.settings?.newBookmarkCheckMode === 'periodic'
                                || d.settings?.newBookmarkCheckMode === 'monitor',
                            monitorEnabled: d.settings?.newBookmarkCheckMode === 'monitor' ? true : undefined,
                            monitorIntervalMinutes: d.settings?.newBookmarkCheckMode === 'monitor'
                                ? (Number(d.settings?.defaultMonitorIntervalMinutes) || 15)
                                : undefined,
                            icon,
                            previewTitle: previewTitle || undefined,
                            previewDesc: previewDesc || undefined,
                            previewImage: previewImage || undefined,
                            createdAt: Date.now()
                        }
                    })
                });

                let response = await postQuickAdd(false);
                // A copy on another page is a question, not a failure — quick add
                // asks it with the same dialog the bookmark form uses, so the
                // answer is the same wherever the link came from.
                if (response.status === 409) {
                    const raw = await response.text().catch(() => '');
                    const conflict = window.DuplicateBookmarkPrompt?.parse(raw);
                    if (conflict && !conflict.samePage) {
                        if (!(await window.DuplicateBookmarkPrompt.confirmSecondCopy(conflict.bookmark))) {
                            status.textContent = window.DuplicateBookmarkPrompt.locationMessage(conflict.bookmark);
                            status.classList.add('is-error');
                            input.disabled = false;
                            input.focus();
                            return;
                        }
                        response = await postQuickAdd(true);
                    }
                }

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
