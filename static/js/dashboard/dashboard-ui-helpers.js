/**
 * Labels, modals, modal-open guards.
 */
class DashboardUiHelpers {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    formatDashboardLabel(key, replacements = {}, fallback = '') {
        const d = this.dash;
        let text = d.language?.t(`dashboard.${key}`) || fallback || key;
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


    setTipHtml(element, html) {
        const d = this.dash;
        if (!element) return;
        element.innerHTML = this.sanitizeTipHtml(html);
    }


    sanitizeTipHtml(html) {
        const d = this.dash;
        const source = String(html || '');
        if (!source) return '';

        const doc = new DOMParser().parseFromString(`<div>${source}</div>`, 'text/html');
        const root = doc.body.firstElementChild;
        if (!root) return this.escapeHtml(source);

        const sanitizeNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return document.createTextNode(node.textContent);
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return null;
            }

            const tag = node.tagName.toLowerCase();
            if (tag === 'code') {
                const code = document.createElement('code');
                node.childNodes.forEach((child) => {
                    const sanitized = sanitizeNode(child);
                    if (sanitized) code.appendChild(sanitized);
                });
                return code;
            }

            if (tag === 'a') {
                const href = String(node.getAttribute('href') || '').trim();
                const classes = String(node.getAttribute('class') || '').split(/\s+/);
                if (classes.includes('button-hint-link') && /^\/[a-z0-9#./?=&_-]*$/i.test(href)) {
                    const link = document.createElement('a');
                    link.className = 'button-hint-link';
                    link.href = href;
                    link.textContent = node.textContent;
                    return link;
                }
            }

            return document.createTextNode(node.textContent);
        };

        const wrapper = document.createElement('div');
        root.childNodes.forEach((child) => {
            const sanitized = sanitizeNode(child);
            if (sanitized) wrapper.appendChild(sanitized);
        });
        return wrapper.innerHTML;
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
        if (document.getElementById('page-overview-overlay')) return true;
        if (document.getElementById('date-popover')) return true;
        if (document.getElementById('move-popover')) return true;
        if (document.getElementById('delete-popover')) return true;
        if (document.getElementById('tag-popover')) return true;
        if (document.querySelector('.feature-spotlight.show')) return true;
        const blockingSelectors = [
            '.onboarding-overlay',
            '.onboarding-card',
            '.feature-tour-overlay',
            '.feature-tour-card',
            '[class$="-tour-card"]',
        ];
        for (const selector of blockingSelectors) {
            for (const el of document.querySelectorAll(selector)) {
                if (this.isVisibleBlockingOverlay(el)) return true;
            }
        }
        return false;
    }


    getKeyboardCheatSheetItems() {
        const d = this.dash;
        const t = (key, fallback) => {
            if (!d.language?.t) return fallback;
            const fullKey = `dashboard.cheatsheet.${key}`;
            const value = d.language.t(fullKey);
            return value !== fullKey ? value : fallback;
        };
        const item = (keys, key, fallback) => ({ keys, description: t(key, fallback) });
        const section = (titleKey, titleFallback, items) => ({
            title: t(titleKey, titleFallback),
            items,
        });

        const isSideRail = d.settings?.buttonBarPosition === 'side-left';
        const sections = [
            section('sectionNavigation', 'Navigation', [
                item('1–9', 'navPageTab', 'Switch to page tab'),
                item('Shift + ← / →', 'navPrevNextPage', 'Previous / next page'),
                item(',', 'navPageOverview', 'Page overview with bookmark counts'),
                item('↑ / ↓', 'navFocusUpDown', 'Move focus up / down through bookmarks'),
                item('← / →', 'navFocusLeftRight', 'Move focus left / right in grid'),
                item('Home / End', 'navCategoryHomeEnd', 'First / last bookmark in the focused category'),
                item('Ctrl + Home / End', 'navGridHomeEnd', 'First / last bookmark on the page'),
                item('Page Up / Page Down', 'navPageScroll', 'Jump one screen up / down through bookmarks'),
                item('Tab / Shift+Tab', 'navTabLinear', 'Step linearly through all bookmarks'),
                item('G + 1–9', 'navGotoCategory', 'Jump to first bookmark in nth category or smart collection'),
                item('G + P', 'navGotoPinned', 'Jump to first pinned bookmark on the page'),
                item('Enter / Space', 'navOpenFocused', 'Open focused bookmark'),
                item('Esc', 'navEscClear', 'Clear selection / close overlay; undo unsaved drag reorder'),
            ]),
        ];

        if (isSideRail) {
            sections.push(section('sectionLayout', 'Layout (side rail)', [
                item('Tab', 'layoutSideRailFocus', 'Toolbar is first in tab order — then page header, then bookmark grid'),
                item('← / →', 'layoutPageTabScroll', 'Scroll page tabs horizontally when many pages'),
                item(':buttonbar bottom', 'layoutSideRailButtonbar', 'Return button bar to bottom — :buttonbar bottom-left / bottom-right also work'),
            ]));
        }

        sections.push(
            section('sectionBookmarks', 'Bookmarks', [
                item('&', 'bmQuickAdd', 'Quick-add — type name | url | shortcut in one line'),
                item('Ctrl + V', 'bmPasteUrlModal', 'Paste a URL to open the new-bookmark modal pre-filled'),
                item('+', 'bmNewBookmarkModal', 'Open full new-bookmark modal (+ on dashboard)'),
                item('Ctrl + Shift + A', 'bmNewBookmarkModalGlobal', 'Open full new-bookmark modal from anywhere'),
                item(';', 'bmInlineEdit', 'Inline-edit focused bookmark'),
                item('Shift + M', 'bmQuickMove', 'Quick-move focused bookmark — choose category or page; Esc close restores selection on same row'),
                item('Shift + D', 'bmQuickDelete', 'Quick-delete focused bookmark — confirm in popover; Esc close restores selection on same row'),
                item('Shift + T', 'bmQuickTag', 'Quick-tag focused bookmark — ↑/↓ navigate; Enter/Space toggles tag and advances; ✓ shows tags on bookmark; Esc close restores selection on same row'),
                item('Ctrl + C', 'bmCopyUrl', 'Copy URL of focused bookmark (row flashes green)'),
                item('[', 'bmTogglePreview', 'Toggle hover preview card on focused bookmark'),
                item('Delete', 'bmDelete', 'Delete focused bookmark (confirmation dialog)'),
                item('Double-click page tab', 'bmRenamePageTab', 'Rename page tab — also set emoji icon and colour dot'),
                item('Long-press category (~500 ms)', 'bmRenameCategory', 'Rename category header (not on sort buttons; double-click still works)'),
                item('Drag handle', 'bmDragReorder', 'Reorder within or across categories'),
            ]),
            section('sectionSearchModes', 'Search modes', [
                item('>', 'smRegularSearch', 'Regular search — filter bookmarks on current page by name'),
                ...(d.isTagCloudDesktopShortcutVisible()
                    ? [item('/', 'smTagCloudSlash', 'Open tag word cloud (desktop); arrow keys select tag or clear filter, Enter apply, Esc close; with interleave search on and modal closed, / can start fuzzy search')]
                    : []),
                item('@', 'smGlobalSearch', 'Global search — fuzzy search across all pages at once; result shows page name as context'),
                item(':', 'smCommandPalette', 'Command palette — 5 collapsible groups at lone : ; recent commands at top; toggles stay open after Enter'),
                item('?', 'smFinders', 'Finders — e.g. ?g query to search Google'),
                item('*', 'smRecentPanel', 'Recent bookmarks panel'),
                item('mode chips', 'smModeChips', 'Click › search · : commands · ? finders at the top of the overlay to switch mode instantly'),
                item('← / → (chip row)', 'smEmptyStateChips', 'Empty overlay — with a recent-search or recent-command chip row highlighted, cycle chips and Enter applies'),
                item('category: / tag: / page: / status:', 'smFieldFilters', 'Filter results by field directly in the search bar'),
            ]),
            section('sectionCommandsBookmarks', 'Commands — bookmarks', [
                item(':new / :add', 'cbNew', 'Open new-bookmark modal (+ / Ctrl+Shift+A) or quick-add omnibox (&)'),
                item(':note', 'cbNote', 'Edit note on the focused bookmark'),
                item(':move / :edit / :copy', 'cbMoveEditCopy', 'Move, inline-edit, or copy URL of the keyboard-selected bookmark'),
                item(':quicktag (:qt)', 'cbQuicktag', 'Open quick-tag popover on the keyboard-selected bookmark (same as Shift+T)'),
                item(':pin / :unpin', 'cbPin', 'Toggle pin flag on the focused bookmark'),
                item(':tag', 'cbTagList', 'List all tags in the command palette (dashboard layout unchanged)'),
                item(':tag <name>', 'cbTagBrowse', 'Browse bookmarks by tag in the palette — :tag work or :tag:work'),
                item(':tag +name / :tag -name', 'cbTagMutate', 'Add or remove a tag on the focused bookmark — :tag +name / :tag -name'),
                item(':category / :cat', 'cbCategory', 'Jump to a category or smart collection by number or name'),
                item(':filter <tag> / :filter clear', 'cbFilter', 'Apply or clear dashboard tag filter (OR logic, same as tag cloud)'),
                item(':remove', 'cbRemove', 'Delete the focused bookmark'),
                item(':find <text> / :find clear', 'cbFind', 'Filter bookmark tiles on the current page — :find clear removes the filter'),
                item(
                    ':open all / :open pinned',
                    'cbOpenAll',
                    'Open every bookmark or pinned bookmarks on the current page (capped at 15)'
                ),
                item(':open tag <name> / :open category <name>', 'cbOpenTagCat', 'Open bookmarks matching a tag or category on the current page'),
                item(':open last [n]', 'cbOpenLast', 'Open the N most recently opened bookmarks on this page (default 5, max 50; tab batch capped at 15; :open recent is an alias)'),
                item(':goto <url or domain>', 'cbGoto', 'Navigate directly — full URLs open as-is, bare domains get https:// prepended'),
                item(':goto config / stats / health', 'cbGotoNav', 'Quick navigation to config, stats, or health page'),
                item(':duplicate / :duplicates', 'cbDuplicates', 'Find bookmarks with duplicate URLs across all pages (opens Health duplicates view)'),
                item(':history / :history clear', 'cbHistory', 'Browse recent searches from the command bar / wipe all search history'),
                item(':stale <days>', 'cbStale', 'Show bookmarks not opened in <days> days (default 30)'),
                item(':health [filter]', 'caHealth', 'Open health page — broken / duplicate / stale / refresh'),
                item(':health page [n]', 'cbHealthPage', 'Open health filtered to a specific page number'),
                item(':save / :saved', 'cbSave', 'Save the current search query / show saved searches'),
            ]),
            section('sectionCommandsNavigation', 'Commands — navigation', [
                item(':page', 'cnPage', 'Switch page by name or number — palette stays open, ✓ on current page'),
                item(':recent', 'cnRecent', 'Open recent bookmarks modal (same as *)'),
                item(':overview', 'cnOverview', 'Open page overview with bookmark counts (same as ,)'),
                item(':cheat', 'cnCheat', 'Open keyboard cheat sheet (same as ! or F1)'),
                item(':whatsnew', 'cnWhatsnew', 'Open what\'s new release notes'),
                item(':reload', 'cnReload', 'Reload the dashboard'),
                item(':config [section]', 'cnConfig', 'Open config or a tab — bookmarks, backups, stats, …'),
            ]),
            section('sectionCommandsAppearance', 'Commands — appearance', [
                item(':layout <preset>', 'caLayout', 'Switch layout — default / compact / cards / masonry / list / launcher'),
                item(':layoutversion <mode>', 'caLayoutversion', 'Switch layout version — classic / modern / glass / toggle (not the same as :layout presets)'),
                item(':theme <name>', 'caTheme', 'Switch colour theme'),
                item(':density <mode>', 'caDensity', 'Change density — comfortable / compact / dense'),
                item(':columns <n>', 'caColumns', 'Set number of columns (1–6)'),
                item(':fontsize <size>', 'caFontsize', 'Change font size'),
                item(':favicons on/off', 'caFavicons', 'Toggle favicons on/off'),
                item(':preview on/off', 'caPreview', 'Toggle hover preview cards'),
                item(':packed on/off', 'caPacked', 'Toggle packed (variable-width) columns'),
                item(':buttonbar <position>', 'caButtonbar', 'Move the button bar — bottom (default) / bottom-left / bottom-right / side-left'),
                item(':sort <method>', 'caSort', 'Sort focused category (shows category name) — order / az / recent'),
                item(':dark / :title / :lang', 'caDisplayToggles', 'Toggle dark mode, dashboard title visibility, or UI language'),
                item(':animations / :status / :opacity', 'caDisplayMore', 'Toggle animations, status monitor, or background opacity'),
                item(':collections', 'caCollections', 'Toggle smart collections (today, recent, stale, most used)'),
            ]),
            section('sectionCommandsTools', 'Commands — tools', [
                item(':backup / :export', 'ctBackup', 'Open config backups or download a ZIP backup immediately'),
                item(':metadata', 'ctMetadata', 'Open health missing previews or config bookmarks metadata view'),
                item(':tour', 'ctTour', 'Start the dashboard feature tour'),
                item(':promo', 'ctPromo', 'Reset discoverability promos (Got it balloons)'),
            ]),
            section('sectionOther', 'Other', [
                item('! or F1', 'otCheatSheet', 'This cheat sheet'),
                item('★ (corner button)', 'otWhatsNew', 'Open what\'s new release notes'),
                item('Ctrl + V (dashboard)', 'otPasteUrlDashboard', 'Paste URL anywhere on the dashboard to quick-add a bookmark'),
                item('1–9 (config page)', 'otConfigTabs', 'Jump to the Nth visible config tab'),
                item('← / → (config page)', 'otConfigTabArrows', 'Previous / next visible config tab when focus is not in an input'),
                item('S (config page)', 'otConfigSave', 'Save config changes'),
                item('Alt + ↑ / ↓ (config page)', 'otConfigReorder', 'Reorder selected bookmark'),
                item('Ctrl/Cmd + Shift + K (config page)', 'otConfigSettingsSearch', 'Find settings, tabs, and help on config'),
                item('Ctrl/Cmd + K (config page)', 'otConfigPalette', 'Quick actions on config (new page, bookmark, …)'),
                item('config → keyboard', 'otConfigKeyboard', 'Customize rebindable dashboard shortcuts — fixed quick actions and grid chords listed too'),
            ]),
        );
        return sections;
    }


    showKeyboardCheatSheet() {
        const d = this.dash;
        if (!window.AppModal) {
            return;
        }

        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        const sections = this.getKeyboardCheatSheetItems();
        const formatKeys = (keys) => {
            if (window.ShortcutFormat && typeof window.ShortcutFormat.keysToHtml === 'function') {
                return window.ShortcutFormat.keysToHtml(keys);
            }
            return keys;
        };
        const filterPlaceholder = d.language?.t('dashboard.cheatsheetFilterPlaceholder') || 'Filter shortcuts…';
        const html = `
            <div class="keyboard-cheat-sheet">
                <input type="text" id="cheat-sheet-filter" class="cheat-sheet-filter"
                       placeholder="${filterPlaceholder}" autocomplete="off" spellcheck="false"
                       aria-label="${filterPlaceholder}">
                ${sections.map((section, i) => `
                    <details class="cheat-sheet-group" ${i === 0 ? 'open' : ''}>
                        <summary class="cheat-sheet-group-title">${section.title}</summary>
                        <table class="keyboard-cheat-sheet-table">
                            <tbody>
                                ${section.items.map((shortcut) => `
                                    <tr>
                                        <td class="keyboard-cheat-sheet-keys">${formatKeys(shortcut.keys)}</td>
                                        <td class="keyboard-cheat-sheet-description">${shortcut.description}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </details>
                `).join('')}
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
                if (window.DashboardFeaturePromos?.isPromoOpen?.('cheatsheet')) {
                    window.DashboardFeaturePromos.dismissOpen();
                }
            },
        });

        requestAnimationFrame(() => {
            const panel = document.querySelector('#app-modal.show .keyboard-cheat-sheet-modal');
            if (panel) {
                window.DashboardFeaturePromos?.tryShowDeferred?.('cheatsheet', panel, [0, 180, 400]);
            }
        });

        const filterInput = document.getElementById('cheat-sheet-filter');
        if (!filterInput) return;

        filterInput.addEventListener('input', () => {
            const q = filterInput.value.toLowerCase().trim();
            const groups = document.querySelectorAll('.cheat-sheet-group');
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
                    if (visible > 0) group.open = true;
                } else {
                    group.hidden = false;
                    group.open = i === 0;
                }
            });
        });
    }


    async showPageOverlay() {
        const d = this.dash;
        if (document.getElementById('page-overview-overlay')) return;

        const pages = Array.isArray(d.pages) ? d.pages : [];
        if (pages.length === 0) return;

        if (pages.length > 1 && (!Array.isArray(d.allBookmarks) || d.allBookmarks.length === 0)) {
            await d.loadAllBookmarks();
        }

        const previousFocus = document.activeElement;
        const allBookmarks = Array.isArray(d.allBookmarks) ? d.allBookmarks : [];

        const overlay = document.createElement('div');
        overlay.id = 'page-overview-overlay';
        overlay.className = 'page-overview-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const isMobileLayout = window.MobileExperience?.isMobileLayout?.() === true;
        if (isMobileLayout) {
            overlay.classList.add('page-overview-overlay--mobile');
        }

        const panel = document.createElement('div');
        panel.className = 'page-overview-panel';

        const header = document.createElement('div');
        header.className = 'page-overview-header';
        const headerTitle = document.createElement('span');
        headerTitle.className = 'page-overview-header-title';
        const pagesLabel = d.language?.t('dashboard.pagesOverview');
        headerTitle.textContent = pagesLabel && pagesLabel !== 'dashboard.pagesOverview'
            ? pagesLabel
            : 'Pages';
        header.appendChild(headerTitle);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'page-overview-close';
        const closeLabel = d.language?.t('dashboard.closePageOverview');
        closeBtn.setAttribute(
            'aria-label',
            closeLabel && closeLabel !== 'dashboard.closePageOverview' ? closeLabel : 'Close'
        );
        closeBtn.textContent = '×';
        header.appendChild(closeBtn);

        const ariaLabel = d.language?.t('dashboard.pagesOverviewAria');
        overlay.setAttribute(
            'aria-label',
            ariaLabel && ariaLabel !== 'dashboard.pagesOverviewAria' ? ariaLabel : 'Page overview'
        );
        panel.appendChild(header);

        const list = document.createElement('ul');
        list.className = 'page-overview-list';

        let focusedIndex = pages.findIndex((p) => d.samePageId(p.id, d.currentPageId));
        if (focusedIndex < 0) focusedIndex = 0;

        pages.forEach((page, idx) => {
            const count = allBookmarks.filter(b => String(b.pageId) === String(page.id)).length;
            const li = document.createElement('li');
            li.className = 'page-overview-item' + (d.samePageId(page.id, d.currentPageId) ? ' is-current' : '');
            li.setAttribute('data-idx', String(idx));

            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'page-overview-link';
            link.setAttribute('aria-current', d.samePageId(page.id, d.currentPageId) ? 'page' : 'false');
            const pageName = page.name || this.formatDashboardLabel('pageOverviewFallbackName', { index: idx + 1 }, `Page ${idx + 1}`);
            link.setAttribute(
                'aria-label',
                this.formatDashboardLabel('pageOverviewItemAria', { name: pageName, count }, `${pageName}, ${count} bookmarks`)
            );

            const numSpan = document.createElement('span');
            numSpan.className = 'page-overview-num';
            numSpan.textContent = String(idx + 1);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'page-overview-name';
            nameSpan.textContent = pageName;

            const countSpan = document.createElement('span');
            countSpan.className = 'page-overview-count';
            countSpan.textContent = String(count);

            link.appendChild(numSpan);
            link.appendChild(nameSpan);
            link.appendChild(countSpan);

            link.addEventListener('click', async () => {
                const switched = await d.requestPageNavigation(page.id);
                if (!switched) {
                    return;
                }
                close();
            });

            li.appendChild(link);
            list.appendChild(li);
        });

        panel.appendChild(list);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        window.dashboardInstance?.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        window.FocusTrapUtils?.syncDashboardInert?.();

        const items = () => list.querySelectorAll('.page-overview-item');

        const setFocus = (idx) => {
            if (pages.length === 0) {
                return;
            }
            focusedIndex = ((idx % pages.length) + pages.length) % pages.length;
            items().forEach((el, i) => {
                el.classList.toggle('is-focused', i === focusedIndex);
                const btn = el.querySelector('.page-overview-link');
                if (i === focusedIndex) {
                    btn?.focus({ preventScroll: true });
                    el.scrollIntoView({ block: 'nearest' });
                }
            });
        };

        const close = () => {
            if (window.DashboardFeaturePromos?.isPromoOpen?.('pageOverview')) {
                window.DashboardFeaturePromos?.dismissOpen?.();
            }
            overlay.remove();
            document.removeEventListener('keydown', onKey, true);
            window.FocusTrapUtils?.syncDashboardInert?.();
            const restoreTarget = (previousFocus && previousFocus.isConnected)
                ? previousFocus
                : document.getElementById('page-overview-header-btn');
            if (restoreTarget && typeof restoreTarget.focus === 'function') {
                restoreTarget.focus({ preventScroll: true });
            }
        };

        header.querySelector('.page-overview-close')?.addEventListener('click', close);

        const onKey = (e) => {
            if (e.key === 'Escape' || e.key === ',') {
                e.preventDefault();
                e.stopPropagation();
                close();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                window.FocusTrapUtils?.trapTabKey(e, panel);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocus(focusedIndex + 1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocus(focusedIndex - 1);
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const page = pages[focusedIndex];
                if (page) {
                    void d.requestPageNavigation(page.id).then((switched) => {
                        if (switched) {
                            close();
                        }
                    });
                }
            } else if (e.key >= '1' && e.key <= '9') {
                const idx = parseInt(e.key) - 1;
                if (idx < pages.length) {
                    e.preventDefault();
                    void d.requestPageNavigation(pages[idx].id).then((switched) => {
                        if (switched) {
                            close();
                        }
                    });
                }
            }
        };

        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', onKey, true);

        setFocus(focusedIndex);
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
            setFocus(focusedIndex);
            requestAnimationFrame(() => {
                window.DashboardFeaturePromos?.tryShow?.('pageOverview', panel);
            });
            overlay.addEventListener('transitionend', () => {
                window.DashboardFeaturePromos?.reposition?.();
            }, { once: true });
        });
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
            if (window.DashboardFeaturePromos?.isPromoOpen?.('quickAddOmnibox')) {
                window.DashboardFeaturePromos?.dismissOpen?.();
            }
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
                    await d.loadPageBookmarks(d.currentPageId);
                    if (d.settings.globalShortcuts) {
                        await d.loadAllBookmarks();
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
            window.DashboardFeaturePromos?.tryShowDeferred?.('quickAddOmnibox', box);
        });
    }

}

window.DashboardUiHelpers = DashboardUiHelpers;
