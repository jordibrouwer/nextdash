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
        // The widget settings sheet, over the dashboard or in Config.
        if (document.getElementById('config-widget-overlay')) return true;
        if (document.getElementById('date-popover')) return true;
        if (document.getElementById('move-popover')) return true;
        if (document.getElementById('delete-popover')) return true;
        if (document.getElementById('tag-popover')) return true;
        if (document.querySelector('.feature-spotlight.show')) return true;
        // The "x apps found" card, over the dimmed dashboard.
        if (document.querySelector('[data-app-discovery-overlay]')) return true;
        // The start guide's modal, in the middle of the dashboard.
        if (document.querySelector('[data-start-guide-overlay]')) return true;
        // Config's confirm dialog — both the plain and the type-to-confirm
        // variant reuse this id. It is injected straight into the document
        // rather than reusing #app-modal, so without this the config Escape
        // handler did not count it as layered over the view: it claimed the key
        // with stopImmediatePropagation() and closed config, leaving the dialog
        // stranded on the dashboard underneath.
        if (document.getElementById('config-confirm-modal')) return true;
        // Pages and categories, over the Bookmarks view.
        if (document.querySelector('[data-structure-modal]')) return true;
        if (document.querySelector('[data-checking-modal]')) return true;
        if (document.getElementById('paste-choice-modal')?.classList.contains('show')) return true;
        if (this.dash.inbox?.triage?.isOpen?.()) return true;
        if (document.getElementById('new-bookmark-modal')?.classList.contains('show')) return true;
        if (document.getElementById('bookmark-form-modal')?.classList.contains('show')) return true;
        if (window.DockerLogsModal?.isOpen?.()) return true;
        // Any native <dialog> shown modally (the logs window, the Disk tab's
        // volume confirmation) is on top of the view.
        if (document.querySelector('dialog[open]')) return true;
        // The theme browser's docked panel: the page beside it is a preview.
        if (document.querySelector('[data-look-studio]')) return true;
        // The assistant panel. Without it the grid's Escape ("nothing open: go
        // home or open search") ran under the panel's own Escape and opened the
        // palette behind the closing panel, holding a scroll lock nobody saw.
        if (window.AssistantPanel?.isOpen?.()) return true;
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

    async showKeyboardCheatSheet(options = {}) {
        const d = this.dash;
        if (!window.AppModal) {
            return;
        }
        window.nextdashTrack?.('modal:cheatsheet');
        // Record for the first-run start guide bar (server-side, per-user).
        // Only while onboarding is still in progress, so we don't write on every open.
        if (d.settings && d.settings.onboardingCompleted !== true) {
            const qs = d.settings.quickStart || (d.settings.quickStart = {});
            if (qs.seenCheatsheet !== true) {
                qs.seenCheatsheet = true;
                Promise.resolve(d.saveSettings?.({ keys: ['quickStart'] })).catch(() => {});
                // Update the checklist immediately instead of waiting for the next poll.
                d.quickStart?.refresh?.();
            }
        }
        this._cleanupCheatSheetKeyHandler();

        // The sheet quotes the Help, and the Help prose is a locale scope of its
        // own that loads when Config opens. Fetched here when it is not in yet,
        // for a moment at most: the sheet opens without it rather than wait.
        const lang = d.language;
        if (typeof lang?.translations?.config?.helpStartBody !== 'string' && typeof lang?.ensureHelpTranslations === 'function') {
            // One opening at a time; Escape while it waits cancels it, and so does
            // another window taking the screen in the meantime.
            if (this._cheatSheetPending) return;
            this._cheatSheetPending = true;
            let cancelled = false;
            const onKey = (e) => { if (e.key === 'Escape') cancelled = true; };
            document.addEventListener('keydown', onKey, true);
            try {
                await Promise.race([
                    Promise.resolve(lang.ensureHelpTranslations(lang.currentLanguage)).catch(() => {}),
                    new Promise((resolve) => setTimeout(resolve, 1500)),
                ]);
            } finally {
                document.removeEventListener('keydown', onKey, true);
                this._cheatSheetPending = false;
            }
            const other = document.querySelector('#app-modal.show');
            if (cancelled || (other && !other.querySelector('.keyboard-cheat-sheet'))) return;
        }

        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        const allSections = this.getKeyboardCheatSheetItems();
        const formatKeys = (keys) => {
            if (window.ShortcutFormat && typeof window.ShortcutFormat.keysToHtml === 'function') {
                return window.ShortcutFormat.keysToHtml(keys);
            }
            return keys;
        };
        const filterPlaceholder = d.language?.t('dashboard.cheatsheetFilterPlaceholder') || 'Filter by description, key, or section…';
        const noResultsText = d.language?.t('dashboard.cheatsheetNoResults') || 'No shortcuts match your filter.';
        const esc = (text) => this.escapeHtml(String(text ?? ''));
        // Opening from Health should not mean scrolling past eight sections to
        // reach the rows for the view you are looking at. The matching section
        // opens and leads; nothing is hidden, so the filter still sees everything.
        // Opened from a Help panel it can name the page whose keys it should lead with.
        const actualContext = this.getKeyboardCheatSheetContext();
        const context = options?.context || actualContext;
        // Asked for another page's keys (from a Help panel): the keys cannot be tried here.
        // The bell is not a page: its keys work wherever you are, so nothing is foreign about it.
        const foreign = context !== actualContext && context !== 'bell';
        // A Config page's own help (config:structure) reads the Config sections of the registry.
        const sectionContext = context.startsWith('config:') ? 'config' : context;
        // Bookmarks is the default the sheet has always opened on, so it gets no
        // lead line and no marked section: there is nothing to orient someone to.
        const foundContext = context === 'bookmarks'
            ? -1
            : allSections.findIndex((section) => section.contextId === sectionContext);
        // The view's own section leads, across the full width, so it is the
        // first thing under the filter instead of somewhere down the grid.
        const sections = foundContext > 0
            ? [allSections[foundContext], ...allSections.filter((_s, i) => i !== foundContext)]
            : allSections;
        const contextIndex = foundContext >= 0 ? 0 : -1;
        const leadKey = `cheatsheetContext${sectionContext.replace(/(^|-)([a-z])/g, (_m, _d, c) => c.toUpperCase())}Lead`;
        const leadText = context === 'bookmarks'
            ? ''
            : (d.language?.t(`dashboard.${leadKey}`) || '');
        const showLead = leadText && leadText !== `dashboard.${leadKey}`;
        const shortcutCount = sections.reduce((total, section) => total + section.items.length, 0);

        const tr = (key, fallback) => {
            const text = d.language?.t(`dashboard.${key}`);
            return text && text !== `dashboard.${key}` ? text : fallback;
        };
        const dockHint = tr('cheatsheetDockHint', 'Select a shortcut to see its keys');
        // The plain text of a shortcut's keys, so the filter still finds "shift+y"
        // although the row itself only shows the description.
        const keysText = (keys) => {
            const probe = document.createElement('div');
            probe.innerHTML = formatKeys(keys);
            return probe.textContent || '';
        };
        const squash = (text) => String(text).toLowerCase().replace(/\s+/g, '');
        // Rows by id, so selecting one can put its keys in the dock.
        const shortcutById = new Map();
        const groupHtml = sections.map((section, i) => {
            const isContext = contextIndex >= 0 && i === contextIndex;
            return `
                    <section class="cheat-sheet-group${isContext ? ' cheat-sheet-group--context' : ''}"${isContext ? ' data-context-section="true"' : ''} aria-label="${esc(section.title)}">
                        <h3 class="cheat-sheet-group-title"><span class="cheat-sheet-group-label">${esc(section.title)}</span><span class="cheat-sheet-group-count">${section.items.length}</span></h3>
                        <div class="cheat-sheet-rows">
                            ${section.items.map((shortcut, j) => {
                                const id = `${i}-${j}`;
                                shortcutById.set(id, shortcut);
                                return `<button type="button" class="cheat-sheet-row" data-shortcut-id="${id}" title="${esc(shortcut.description)}" data-search="${esc(squash(`${shortcut.description}${keysText(shortcut.keys)}`))}"><span class="cheat-sheet-row-text">${esc(shortcut.description)}</span><span class="sr-only"> \u2014 ${esc(keysText(shortcut.keys))}</span></button>`;
                            }).join('')}
                        </div>
                    </section>`;
        });
        /*
         * Keys and help: the sheet opens on the page you are on. "This page"
         * says where you are, what to do first and what else is here; "All
         * keys" is the whole list (the sheet as it was); the modes and the
         * learning material have a tab each. All four are in the page at once
         * and one shows, so the filter can search across them.
         */
        const pageHelp = window.KeyboardPageHelp?.forContext?.(context, d) || null;
        const chips = (keys) => {
            const text = String(keys ?? '');
            if (text === 'Type') return `<span class="cs-typed">${esc(tr('cheatsheetTyped', 'type'))}</span>`;
            const parts = text.includes(' / ') ? text.split(' / ')
                : (/^(\S\s)+\S$/.test(text) && !text.includes('+') ? text.split(' ') : [text]);
            return parts.map((p) => `<kbd class="cs-kbd">${esc(p)}</kbd>`).join('<span class="cs-sep">/</span>');
        };
        const itemsById = new Map();
        const itemButton = (id, item, keysHtml) => {
            itemsById.set(id, { ...item, keysHtml });
            return `<button type="button" class="cs-item" data-item-id="${id}" data-search="${esc(squash(`${item.description}${item.explain || ''}${item.keys}`))}"><span class="cs-keys">${keysHtml}</span><span class="cs-text">${esc(item.description)}</span></button>`;
        };
        const tryButton = (kind, index, label) => `<button type="button" class="cs-try" data-try-kind="${kind}" data-try-index="${index}">${esc(label)}</button>`;
        const tryLabel = tr('cheatsheetTry', 'Try it');
        // The page's own keys lead; the keys that open other views (Navigation) come after them.
        const hereSections = sections.filter((section) => section.contextId === sectionContext)
            .sort((a, b) => Number(a.id === 'sectionNavigation') - Number(b.id === 'sectionNavigation'));
        const hereItems = hereSections.flatMap((section) => section.items);
        // Keys you have not met yet come first: the strip's own count of what you used.
        const uses = window.ModeStripSuggest?.uses?.() || {};
        const learned = (item) => /^[a-z]$/i.test(String(item.keys)) && (uses[String(item.keys)] || 0) >= (window.ModeStripSuggest?.LEARN_AFTER || 3);
        const hereOrdered = [...hereItems.filter((item) => !learned(item)), ...hereItems.filter(learned)];
        const HERE_SHOWN = 8;
        const modeLine = pageHelp?.mode === 'bell'
            ? tr('cheatsheetModeBell', 'These keys work from anywhere on the dashboard.')
            : foreign
            ? tr('cheatsheetModeForeign', 'These are the keys of that page. Open the page to use them.')
            : pageHelp?.mode === 'search'
            ? tr('cheatsheetModeSearch', 'Your keys now: Search. Type to find a bookmark.')
            : tr('cheatsheetModeBrowse', 'Your keys now: Browse. Press ↓ or j to put a cursor on a row.');
        const learnItems = [];
        // Every tour the app has, the one for this page first.
        const tours = (window.KeyboardPageHelp?.TOURS || []).slice();
        tours.sort((x, y) => Number(y.id === pageHelp?.tour) - Number(x.id === pageHelp?.tour));
        tours.forEach((tour) => {
            const name = d.language?.t?.(tour.labelKey);
            const label = name && name !== tour.labelKey ? name : tour.label;
            const here = tour.id === pageHelp?.tour;
            learnItems.push({
                id: `tour-${tour.id}`,
                group: 'tours',
                label: `${tr('cheatsheetLearnTour', 'Tour')}: ${label}${here ? ` · ${tr('cheatsheetLearnThisPage', 'this page')}` : ''}`,
                run: { tour: tour.id },
            });
        });
        learnItems.push({ id: 'help', group: 'more', label: tr('cheatsheetLearnHelp', 'Read the help'), run: { config: 'help' } });
        if (pageHelp?.settings && pageHelp.settings !== 'help') learnItems.push({ id: 'settings', group: 'more', label: tr('cheatsheetLearnSettings', 'Settings for this page'), run: { config: pageHelp.settings } });
        const learnById = new Map(learnItems.map((item) => [item.id, item]));
        const cards = window.KeyboardPageHelp?.helpCards?.(context, d) || [];
        const moreButton = (n, label) => `<button type="button" class="cs-more-link" data-help-hash="${esc(cards[n]?.hash || '')}" title="${esc(cards[n]?.title || '')}">${esc(label)}</button>`;
        const stepsHtml = (pageHelp?.steps || []).map((step, i) => `
                        <div class="cs-step">${itemButton(`s-${i}`, step, chips(step.keys))}${step.moreHash ? `<button type="button" class="cs-more-link" data-help-hash="${esc(step.moreHash)}">${esc(tr('cheatsheetMore', 'More'))}</button>` : ''}${step.try && !foreign ? tryButton('step', i, tryLabel) : ''}</div>`).join('');
        const cardsHtml = cards.length ? `<p class="cs-lbl">${esc(tr('cheatsheetInHelp', 'In the help'))}</p>${cards.slice(0, 2).map((card) => `
                        <div class="cs-card">
                            <div class="cs-card-title">${esc(card.title)}</div>
                            <div class="cs-card-body">${card.excerpt}</div>
                            <button type="button" class="cs-card-more" data-help-hash="${esc(card.hash)}">${esc(tr('cheatsheetReadMore', 'Read more'))} →</button>
                        </div>`).join('')}` : '';
        const tip = window.KeyboardPageHelp?.tipFor?.(context, d) || null;
        const tipHtml = tip ? `<p class="cs-tip"><span class="cs-tip-label">${esc(tr('cheatsheetTip', 'Tip'))}</span> ${tip.html}</p>` : '';
        const hereHtml = hereOrdered.map((item, j) => `
                        <div class="cs-step${j >= HERE_SHOWN ? ' cs-step--extra' : ''}"${j >= HERE_SHOWN ? ' hidden' : ''}>${itemButton(`h-${j}`, item, formatKeys(item.keys))}</div>`).join('');
        const modesHtml = (window.KeyboardPageHelp?.modes?.(d) || []).map((m, i) => `
                        <div class="cs-step">${itemButton(`m-${i}`, m, chips(m.keys))}${m.try ? tryButton('mode', i, tryLabel) : ''}</div>`).join('');
        const learnRow = (item) => `
                        <div class="cs-step"><button type="button" class="cs-item cs-item--plain" data-item-id="l-${item.id}"><span class="cs-text">${esc(item.label)}</span></button>${tryButton('learn', item.id, tr('cheatsheetOpen', 'Open'))}</div>`;
        learnItems.forEach((item) => itemsById.set(`l-${item.id}`, { description: item.label, explain: '', keys: '', keysHtml: '' }));
        const learnHtml = `<p class="cs-lbl">${esc(tr('cheatsheetLearnTours', 'Guided tours'))}</p><div class="cs-list">${learnItems.filter((i) => i.group === 'tours').map(learnRow).join('')}</div>
                        <p class="cs-lbl">${esc(tr('cheatsheetLearnMore', 'More help'))}</p><div class="cs-list">${learnItems.filter((i) => i.group === 'more').map(learnRow).join('')}</div>`;
        // What the filter can find besides keys: every page's help, the modes and the tours.
        const helpRuns = new Map();
        const helpRows = [];
        const KPH = window.KeyboardPageHelp;
        if (KPH) {
            Object.keys(KPH.HELP).forEach((hid) => {
                const page = KPH.byId(hid, d);
                helpRows.push({ description: page.title, explain: page.intro, keys: '', page: tr('cheatsheetHelpPage', 'page') });
                page.steps.forEach((step) => helpRows.push({ description: step.description, explain: step.explain, keys: step.keys, page: page.title }));
            });
            const seenPanels = new Set();
            Object.keys(KPH.LINKS || {}).forEach((cid) => {
                (KPH.helpCards?.(cid, d) || []).forEach((card) => {
                    if (seenPanels.has(card.hash)) return;
                    seenPanels.add(card.hash);
                    helpRows.push({ description: card.title, explain: card.excerptPlain, keys: '', page: tr('cheatsheetHelpHelp', 'Help'), body: card.plain, hash: card.hash });
                });
            });
            (KPH.modes?.(d) || []).forEach((m) => helpRows.push({ description: m.description, explain: m.explain, keys: m.keys, page: tr('cheatsheetTabModes', 'Search modes'), run: m.try }));
            (KPH.TOURS || []).forEach((tour) => {
                const name = d.language?.t?.(tour.labelKey);
                helpRows.push({ description: `${tr('cheatsheetLearnTour', 'Tour')}: ${name && name !== tour.labelKey ? name : tour.label}`, explain: '', keys: '', page: tr('cheatsheetTabLearn', 'Learn'), run: { tour: tour.id } });
            });
        }
        const helpGroupHtml = helpRows.length ? `
                        <section class="cs-help-group" hidden aria-label="${esc(tr('cheatsheetHelpGroup', 'Help and tours'))}">
                            <h3 class="cheat-sheet-group-title"><span class="cheat-sheet-group-label">${esc(tr('cheatsheetHelpGroup', 'Help and tours'))}</span></h3>
                            <div class="cs-list">${helpRows.map((row, n) => {
                                const id = `q-${n}`;
                                const keysHtml = row.keys ? chips(row.keys) : '';
                                itemsById.set(id, { description: row.description, explain: row.explain, keys: row.keys, keysHtml });
                                if (row.run) helpRuns.set(String(n), row.run);
                                const search = squash(`${row.description}${row.explain}${row.keys}${row.page}${row.body || ''}`);
                                return `<div class="cs-step" hidden><button type="button" class="cs-item" data-item-id="${id}" data-search="${esc(search)}"><span class="cs-keys">${keysHtml}</span><span class="cs-text">${esc(row.description)} <span class="cs-ctx">· ${esc(row.page)}</span></span></button>${row.hash ? `<button type="button" class="cs-more-link" data-help-hash="${esc(row.hash)}">${esc(tr('cheatsheetReadMore', 'Read more'))}</button>` : ''}${row.run ? tryButton('q', n, tryLabel) : ''}</div>`;
                            }).join('')}</div>
                        </section>` : '';
        const tabs = [
            ['this', tr('cheatsheetTabThis', 'This page')],
            ['all', tr('cheatsheetTabAll', 'All keys')],
            ['modes', tr('cheatsheetTabModes', 'Search modes')],
            ['learn', tr('cheatsheetTabLearn', 'Learn')],
        ];
        const html = `
            <div class="keyboard-cheat-sheet" data-context="${esc(context)}" data-tab="this">
                ${showLead ? `<p class="cheat-sheet-context-lead">${esc(leadText)}</p>` : ''}
                <input type="text" id="cheat-sheet-filter" class="cheat-sheet-filter"
                       placeholder="${esc(filterPlaceholder)}" autocomplete="off" spellcheck="false"
                       aria-label="${esc(filterPlaceholder)}">
                <div class="cs-tabs" role="tablist" aria-label="${esc(tr('cheatsheetTabsLabel', 'Keys and help'))}">
                    ${tabs.map(([id, label], i) => `<button type="button" role="tab" class="cs-tab${i === 0 ? ' is-active' : ''}" id="cs-tab-${id}" data-cs-tab="${id}" aria-selected="${i === 0 ? 'true' : 'false'}" aria-controls="cs-panel-${id}" tabindex="${i === 0 ? '0' : '-1'}">${esc(label)}</button>`).join('')}
                </div>
                <p id="cheat-sheet-no-results" class="cheat-sheet-no-results" hidden>${esc(noResultsText)}</p>
                <div class="cheat-sheet-scroller">
                    <div class="cs-panel cs-panel--this" id="cs-panel-this" role="tabpanel" aria-labelledby="cs-tab-this" data-panel="this">
                        ${pageHelp ? `<div class="cs-now">
                            <div class="cs-now-title">${esc(tr('cheatsheetYouAreIn', 'You are in'))} ${esc(pageHelp.title)}</div>
                            <div class="cs-now-intro">${esc(pageHelp.intro)}</div>
                            <div class="cs-now-mode">${esc(modeLine)}</div>
                        </div>
                        <p class="cs-lbl">${esc(tr('cheatsheetFirstSteps', 'First steps'))}</p>
                        <div class="cs-list">${stepsHtml}</div>
                        ${cardsHtml}` : ''}
                        ${hereOrdered.length ? `<p class="cs-lbl">${esc(tr('cheatsheetOnThisPage', 'On this page'))}</p>
                        <div class="cs-list">${hereHtml}</div>
                        ${hereOrdered.length > HERE_SHOWN ? `<button type="button" class="cs-more" data-cs-more>${esc(d.formatDashboardLabel('cheatsheetShowAll', { n: hereOrdered.length - HERE_SHOWN }, '+ {n} more · show all'))}</button>` : ''}` : ''}
                        ${tipHtml}
                    </div>
                    <div class="cs-panel cs-panel--all" id="cs-panel-all" role="tabpanel" aria-labelledby="cs-tab-all" data-panel="all" hidden>
                        ${helpGroupHtml}
                        <div class="cheat-sheet-groups">${groupHtml.join('')}</div>
                    </div>
                    <div class="cs-panel cs-panel--modes" id="cs-panel-modes" role="tabpanel" aria-labelledby="cs-tab-modes" data-panel="modes" hidden>
                        <p class="cs-lbl">${esc(tr('cheatsheetModesLead', 'One key opens each way of searching, from the dashboard or inside the palette.'))}</p>
                        <div class="cs-list">${modesHtml}</div>
                    </div>
                    <div class="cs-panel cs-panel--learn" id="cs-panel-learn" role="tabpanel" aria-labelledby="cs-tab-learn" data-panel="learn" hidden>
                        ${learnHtml}
                    </div>
                </div>
                <div id="cheat-sheet-dock" class="cheat-sheet-dock" aria-live="polite" aria-atomic="true">
                    <span class="cheat-sheet-dock-hint">${esc(dockHint)}</span>
                </div>
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
            chip.textContent = '?';
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

        const dock = document.getElementById('cheat-sheet-dock');
        const allRows = () => Array.from(document.querySelectorAll('.keyboard-cheat-sheet .cheat-sheet-row, .keyboard-cheat-sheet .cs-item'));
        // The dock shows one shortcut: the focused row, else the selected one.
        let selectedRow = null;
        const renderDock = (row) => {
            if (!dock) return;
            const shortcut = row ? shortcutById.get(row.dataset.shortcutId) : null;
            const item = row && !shortcut ? itemsById.get(row.dataset.itemId) : null;
            dock.classList.toggle('has-selection', Boolean(shortcut || item));
            if (item) {
                dock.innerHTML = `<span class="cheat-sheet-dock-keys keyboard-cheat-sheet-keys">${item.keysHtml || ''}</span><span class="cheat-sheet-dock-text">${esc(item.description)}${item.explain ? ` <span class="cs-dock-explain">${esc(item.explain)}</span>` : ''}</span>`;
                return;
            }
            dock.innerHTML = shortcut
                ? `<span class="cheat-sheet-dock-keys keyboard-cheat-sheet-keys">${formatKeys(shortcut.keys)}</span><span class="cheat-sheet-dock-text">${esc(shortcut.description)}</span>`
                : `<span class="cheat-sheet-dock-hint">${esc(dockHint)}</span>`;
        };
        const selectRow = (row) => {
            selectedRow = row;
            allRows().forEach((other) => {
                const on = other === row;
                other.classList.toggle('is-selected', on);
                if (on) other.setAttribute('aria-current', 'true');
                else other.removeAttribute('aria-current');
            });
            renderDock(row);
        };
        const sheet = document.querySelector('.keyboard-cheat-sheet');
        // The tabs: one panel shows. Searching goes to All keys and back when cleared.
        let tabBeforeFilter = null;
        const showTab = (id, { focus = false } = {}) => {
            if (!sheet) return;
            sheet.dataset.tab = id;
            sheet.querySelectorAll('[data-cs-tab]').forEach((tab) => {
                const on = tab.dataset.csTab === id;
                tab.classList.toggle('is-active', on);
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                tab.tabIndex = on ? 0 : -1;
                if (on && focus) tab.focus({ preventScroll: true });
            });
            sheet.querySelectorAll('.cs-panel').forEach((panel) => { panel.hidden = panel.dataset.panel !== id; });
            const noResults = document.getElementById('cheat-sheet-no-results');
            if (noResults && id !== 'all') noResults.hidden = true;
            if (selectedRow && selectedRow.closest('[hidden]')) selectRow(null);
            sheet.querySelector('.cheat-sheet-scroller')?.scrollTo?.({ top: 0 });
        };
        // What a "Try it" does: close the sheet, then act on the page behind it.
        const runTry = (kind, index) => {
            const help = window.KeyboardPageHelp;
            let spec = null;
            if (kind === 'step') spec = pageHelp?.steps?.[Number(index)]?.try;
            else if (kind === 'mode') spec = help?.modes?.(d)?.[Number(index)]?.try;
            else if (kind === 'learn') spec = learnById.get(index)?.run;
            else if (kind === 'q') spec = helpRuns.get(String(index));
            if (!spec) return;
            window.AppModal.hide();
            setTimeout(() => help?.run?.(d, spec), 160);
        };
        sheet?.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const tab = target.closest('[data-cs-tab]');
            if (tab) { tabBeforeFilter = null; showTab(tab.dataset.csTab); return; }
            const helpBtn = target.closest('[data-help-hash]');
            if (helpBtn) { window.KeyboardPageHelp?.openHelp?.(d, helpBtn.dataset.helpHash); return; }
            const tryBtn = target.closest('.cs-try');
            if (tryBtn) { runTry(tryBtn.dataset.tryKind, tryBtn.dataset.tryIndex); return; }
            if (target.closest('[data-cs-more]')) {
                sheet.querySelectorAll('.cs-step--extra').forEach((row) => { row.hidden = false; });
                target.closest('[data-cs-more]').remove();
                return;
            }
            const row = target.closest('.cheat-sheet-row, .cs-item');
            if (row) selectRow(row);
        });
        sheet?.addEventListener('keydown', (event) => {
            const tab = event.target instanceof Element ? event.target.closest('[data-cs-tab]') : null;
            if (!tab || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
            const order = Array.from(sheet.querySelectorAll('[data-cs-tab]'));
            const at = order.indexOf(tab);
            const next = order[(at + (event.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length];
            event.preventDefault();
            event.stopPropagation();
            tabBeforeFilter = null;
            showTab(next.dataset.csTab, { focus: true });
        });
        // The dock follows focus without selecting; off the rows it shows the selection.
        sheet?.addEventListener('focusin', (event) => {
            const row = event.target instanceof Element ? event.target.closest('.cheat-sheet-row, .cs-item') : null;
            renderDock(row || selectedRow);
        });
        // One pass over every column at once; a column with nothing left hides.
        const applyView = () => {
            const q = squash(filterInput.value);
            const groups = document.querySelectorAll('.keyboard-cheat-sheet .cheat-sheet-group');
            const noResults = document.getElementById('cheat-sheet-no-results');
            let anyVisible = false;
            groups.forEach((group) => {
                // A section name that matches shows the whole section.
                const titleMatch = Boolean(q) && squash(group.querySelector('.cheat-sheet-group-label')?.textContent || '').includes(q);
                let visible = 0;
                group.querySelectorAll('.cheat-sheet-row').forEach((row) => {
                    const match = !q || titleMatch || (row.dataset.search || '').includes(q);
                    row.hidden = !match;
                    if (match) visible++;
                });
                group.hidden = visible === 0;
                if (visible > 0) anyVisible = true;
            });
            // The help group: what matches by its text, besides the keys.
            const helpGroup = document.querySelector('.keyboard-cheat-sheet .cs-help-group');
            if (helpGroup) {
                let found = 0;
                helpGroup.querySelectorAll('.cs-step').forEach((row) => {
                    const hit = Boolean(q) && (row.querySelector('.cs-item')?.dataset.search || '').includes(q);
                    row.hidden = !hit;
                    if (hit) found += 1;
                });
                helpGroup.hidden = found === 0;
                if (found > 0) anyVisible = true;
            }
            const selected = document.querySelector('.keyboard-cheat-sheet .is-selected');
            if (selected && (selected.hidden || selected.closest('[hidden]'))) selectRow(null);
            if (noResults) {
                noResults.hidden = anyVisible;
            }
        };
        filterInput.addEventListener('input', () => {
            // A search is over everything: it shows All keys, and the tab you were on comes back when it is cleared.
            if (filterInput.value.trim()) {
                if (tabBeforeFilter === null) tabBeforeFilter = sheet?.dataset.tab || 'this';
                if (sheet?.dataset.tab !== 'all') showTab('all');
            } else if (tabBeforeFilter !== null) {
                showTab(tabBeforeFilter);
                tabBeforeFilter = null;
            }
            applyView();
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

            // Rows are buttons: Enter and Space already press them. The arrows
            // walk them, down a column and across to the next one.
            const rowOf = (el) => (el instanceof Element ? el.closest('.cheat-sheet-row, .cs-item') : null);
            const visibleRows = (scope) => Array.from(scope.querySelectorAll('.cheat-sheet-row, .cs-item'))
                .filter((r) => !r.hidden && !r.closest('[hidden]'));
            const focusRow = (row) => {
                if (!row) return;
                row.focus({ preventScroll: true });
                row.scrollIntoView({ block: 'nearest' });
            };
            const current = rowOf(document.activeElement);
            const fromFilter = document.activeElement?.id === 'cheat-sheet-filter';
            if (fromFilter && e.key === 'ArrowDown' && !e.altKey && !e.ctrlKey && !e.metaKey) {
                const first = visibleRows(panel)[0];
                if (first) {
                    e.preventDefault();
                    e.stopPropagation();
                    focusRow(first);
                }
                return;
            }
            if (current && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                const group = current.closest('.cheat-sheet-group, .cs-panel');
                const rows = visibleRows(group);
                const at = rows.indexOf(current);
                let target = null;
                if (e.key === 'ArrowDown') target = rows[at + 1] || null;
                if (e.key === 'ArrowUp') {
                    target = rows[at - 1] || null;
                    if (!target) {
                        e.preventDefault();
                        e.stopPropagation();
                        panel.querySelector('#cheat-sheet-filter')?.focus({ preventScroll: true });
                        return;
                    }
                }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    // Neighbouring column = the nearest group whose box sits to that side.
                    const here = current.getBoundingClientRect();
                    const dir = e.key === 'ArrowRight' ? 1 : -1;
                    let best = null;
                    let bestGap = Infinity;
                    visibleRows(panel).forEach((r) => {
                        const box = r.getBoundingClientRect();
                        const dx = (box.left - here.left) * dir;
                        if (dx <= 4) return;
                        const gap = dx * 1000 + Math.abs(box.top - here.top);
                        if (gap < bestGap) { bestGap = gap; best = r; }
                    });
                    target = best;
                }
                if (target) {
                    e.preventDefault();
                    e.stopPropagation();
                    focusRow(target);
                }
                return;
            }

            const active = document.activeElement;
            const isTypingTarget = active instanceof HTMLElement
                && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
            if (isTypingTarget) {
                return;
            }

            if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const filter = panel.querySelector('#cheat-sheet-filter');
                if (filter instanceof HTMLElement) {
                    e.preventDefault();
                    e.stopPropagation();
                    filter.focus({ preventScroll: true });
                }
                return;
            }

            const body = panel.querySelector('.cheat-sheet-scroller') || panel.querySelector('.modal-body');
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

        // Pages as files: under the slab, not on it -- the slab is the list.
        const filesHtml = `
            <div class="page-overview-modal-files">
                ${d.isBookmarksView?.() ? `<button type="button" class="page-overview-modal-file" id="page-overview-share">${d.escapeHtml(
                    this.formatDashboardLabel('pageSwitcherSharePage', {}, 'Share this page…'))}</button>` : ''}
                <button type="button" class="page-overview-modal-file" id="page-overview-import">${d.escapeHtml(
                    this.formatDashboardLabel('pageSwitcherImportPage', {}, 'Import a page…'))}</button>
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
            + `${newRow}</div>${filesHtml}${footHtml}`;
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

        // Pages as files, where pages are chosen (page_template.go).
        const fileAction = (id, run) => document.getElementById(id)?.addEventListener('click', () => {
            window.AppModal?.hide?.();
            void run();
        });
        fileAction('page-overview-share', () => d.config?.openPageTemplate?.('export', Number(d.currentPageId)));
        fileAction('page-overview-import', () => d.config?.openPageTemplate?.('import'));

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
            // Shift+P opened the panel and closes it again, with the filter in
            // focus too: a capital P is only a letter once there is a word to
            // put it in.
            if (e.shiftKey && e.code === 'KeyP' && !e.ctrlKey && !e.altKey && !e.metaKey
                && !(typing && filterInput?.value)) {
                e.preventDefault();
                e.stopPropagation();
                window.AppModal?.hide?.();
                return;
            }
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
            if (e.key === ',' || (e.shiftKey && e.code === 'KeyP')) {
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
        /*
         * Draws the ring. The focus itself is AppModal's job: it is handed
         * `initialFocusSelector` for the current page's row and lands it after
         * the overlay is really visible. A second deferred focus from here
         * raced that one and sometimes left the cursor on neither.
         */
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
            chip.textContent = 'Shift+P';
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
        // A full-window layer: the page behind it holds still.
        overlay.setAttribute('data-scroll-lock', '');

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
