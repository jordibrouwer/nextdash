/**
 * Config → Widgets: the widgets on each page, how each is set up, and the
 * reference of every type.
 *
 * Moved out of dashboard-config.js method for method, unchanged, so that the
 * Bookmarks view -- which runs on config -- no longer parses two hundred
 * kilobytes of widget editor it never draws. Loaded with the Widgets section
 * (DashboardConfig.SECTION_MODULES.widgets) and otherwise while the tab is
 * idle. The type tables (WIDGET_TYPES, WIDGET_SETTINGS) stay on the class,
 * which reads them for its tab lists and tours, and so do the helpers other
 * sections share: the folds, the secret eye and widgetTypeName.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {

    /**
     * Widgets, as a section rather than a tab.
     *
     * The editor is the one that was under Pages & tags; what it gains here is
     * room and a heading of its own. Where a widget *sits* is still arranged on
     * the categories tab, together with the categories it sits between — one
     * order, one place to change it — so that is said here rather than left for
     * someone to discover.
     */
    renderWidgetsSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tabs = DashboardConfig.WIDGETS_TABS.map((tab) => {
            const active = tab === this.widgetsTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-widgets-body" data-widgets-tab="${esc(tab)}">${esc(this.widgetsTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.widgetsSectionIntro',
                'Blocks on a page that hold something other than bookmarks — what is broken, what is waiting, what has gone quiet.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div id="config-widgets-body" role="tabpanel" tabindex="0">${this.renderWidgetsTab()}</div>
        `;
    },

    renderWidgetsTab() {
        return this.widgetsTab === 'types' ? this.renderWidgetTypeReference() : this.renderWidgetsEditor();
    },

    widgetsTabLabel(tab) {
        const map = {
            widgets: ['config.widgetsTabList', 'Widgets'],
            types: ['config.widgetsTabTypes', 'Types'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    },

    widgetTypeGroupLabel(group) {
        const map = {
            links: ['config.widgetGroupLinks', 'Are the links still good?'],
            incoming: ['config.widgetGroupIncoming', 'What is arriving?'],
            system: ['config.widgetGroupSystem', 'How is this machine doing?'],
            unraid: ['config.widgetGroupUnraid', 'How is the Unraid server doing?'],
            ambient: ['config.widgetGroupAmbient', "What's happening around you?"],
            // Custom widgets, and anything registered but not yet catalogued,
            // land here rather than dropping out of the list entirely.
            other: ['config.widgetGroupOther', 'Built by you'],
            upkeep: ['config.widgetGroupUpkeep', 'What needs tidying?'],
        };
        const [key, fallback] = map[group] || [group, group];
        return this.t(key, fallback);
    },

    renderWidgetTypeReference() {
        const esc = (v) => this.dash.escapeHtml(v);
        // Each row carries the button that adds it, so reading about a kind and
        // choosing it are not two screens apart. Reference and catalogue were
        // the same thirteen names and the same thirteen sentences, twice.
        const row = (type) => `
            <li class="config-widget-type-row">
                <span class="config-widget-type-name">${esc(this.widgetTypeName(type))}</span>
                <span class="config-widget-type-about">${esc(this.widgetTypeAbout(type))}</span>
                <button type="button" class="config-btn config-btn--small config-widget-type-add"
                    data-widget-add="${esc(type)}"
                    aria-label="${esc(this.t('config.widgetsAddNamed', 'Add {name}')
                        .replace('{name}', this.widgetTypeName(type)))}">${
                    esc(this.t('config.widgetsAddShort', 'Add'))}</button>
            </li>`;
        const groups = DashboardConfig.WIDGET_TYPE_GROUPS.map(([group, types]) => `
            <section class="config-widget-type-group">
                <h4 class="config-widget-type-group-title">${esc(this.widgetTypeGroupLabel(group))}</h4>
                <ul class="config-widget-type-list">${types.map(row).join('')}</ul>
            </section>`).join('');

        return `
            <p class="config-panel-note">${esc(this.t('config.widgetTypesIntro',
                'Every kind of widget nextDash can draw. Add one straight from this list.'))}</p>
            ${groups}
            ${this.renderCustomWidgetReference()}`;
    },

    /*
     * The custom widget, at length.
     *
     * It is the only type that is a capability rather than a report, and the
     * only one whose limits a reader has to know before they can judge whether
     * their service will work. Everything here is a number the server actually
     * enforces -- the timeout, the caps, the formats -- so this page and
     * widgets_custom.go have to be read together when either changes.
     */
    renderCustomWidgetReference() {
        const esc = (v) => this.dash.escapeHtml(v);
        const t = (key, fallback) => esc(this.t(key, fallback));
        const presets = window.DashboardWidgetPresets?.serviceCount?.() || 0;

        /*
         * Every string here is plain text and escaped; the examples are built
         * as their own elements. Putting markup inside a translatable string
         * means whichever half of it a translator drops is a broken tag.
         */
        const point = (title, body, aside) => `
            <li class="config-widget-custom-point">
                <span class="config-widget-custom-point-title">${title}</span>
                <span class="config-widget-custom-point-body">${body}${aside ? ` ${aside}` : ''}</span>
            </li>`;
        const code = (sample) => `<code class="config-widget-custom-code">${esc(sample)}</code>`;
        const formats = DashboardConfig.CUSTOM_FORMATS
            .map((format) => code(this.t(`config.widgetFormat.${format}`, format)))
            .join(' ');

        return `
            <section class="config-widget-type-group config-widget-custom-ref">
                <h4 class="config-widget-type-group-title">${t('config.widgetGroupCustom',
                    'And anything else: the Custom widget')}</h4>
                <p class="config-widget-custom-lead">${t('config.widgetCustomRefLead',
                    'Every widget above reads something nextDash already knows. The Custom widget reads a figure out of any service that answers JSON, so a tile can show what your own machines are doing without waiting for nextDash to grow a widget for them.')}</p>
                <ul class="config-widget-custom-points">
                    ${point(
                        t('config.widgetCustomRefAddressTitle', 'An address that answers JSON'),
                        t('config.widgetCustomRefAddressBody',
                            'Any http or https endpoint, fetched by the server rather than by the browser — so a service on your own network works, and no key ever reaches the page. GET, or POST with a body for the services that insist.'))}
                    ${point(
                        t('config.widgetCustomRefPathsTitle', 'Paths into the answer'),
                        t('config.widgetCustomRefPathsBody',
                            'Name the value you want and nothing else — the path walks objects and arrays. Up to eight figures on one tile; more than that is a report rather than a glance.'),
                        code('server.disk[0].used'))}
                    ${point(
                        t('config.widgetCustomRefFormatsTitle', 'A shape per figure'),
                        t('config.widgetCustomRefFormatsBody',
                            'The same number reads differently depending on what it is:'),
                        formats)}
                    ${point(
                        t('config.widgetCustomRefListTitle', 'Or a list instead of figures'),
                        t('config.widgetCustomRefListBody',
                            'Point at an array and the tile draws its entries as rows, up to twenty — the downloads running now, the last few errors.'))}
                    ${point(
                        t('config.widgetCustomRefAuthTitle', 'A sign-in that stays out of your backups'),
                        t('config.widgetCustomRefAuthBody',
                            'An API key in a header, or a username and password. Kept in a separate file that no export or backup ZIP includes; the widget itself stores only a reference to it.'))}
                    ${point(
                        t('config.widgetCustomRefCacheTitle', 'Asked on a schedule you set'),
                        t('config.widgetCustomRefCacheBody',
                            'Anywhere between 30 seconds and a day, five minutes by default. One answer is shared by everyone looking at the dashboard, so a wall display costs the service nothing extra.'))}
                    ${presets ? point(
                        t('config.widgetCustomRefPresetsTitle', 'Or start from a service already known'),
                        this.t('config.widgetCustomRefPresetsBody',
                            'Filled in for you: the address, the figures worth reading, and the header its API wants. {count} services in five groups, and everything stays editable afterwards.')
                            .split('{count}').map(esc).join(`<strong>${esc(String(presets))}</strong>`)) : ''}
                </ul>
                <p class="config-widget-custom-lead">${t('config.widgetCustomRefLimits',
                    'What it will not do is change anything. A tile reads, and the two methods it offers are the two that ask a question. An answer has eight seconds to arrive and is read up to a megabyte.')}</p>
                <p class="config-widget-custom-add">
                    <button type="button" class="config-btn config-btn--small" data-widget-add="custom">${
                        t('config.widgetsAddNamed', 'Add {name}')
                            .replace('{name}', esc(this.widgetTypeName('custom')))}</button>
                </p>
            </section>`;
    },

    bindWidgetsTabs(container) {
        this.bindSubTabStrip(container, 'data-widgets-tab', (tab) => {
            if (tab === this.widgetsTab) return;
            this.widgetsTab = tab;
            this.restoreConfigHash();
            // Only the body changes. Repainting the strip as well would rebuild
            // the buttons under the pointer that just clicked one.
            this.repaintWidgetsBody();
            this.syncSubTabStrip('data-widgets-tab', this.widgetsTab);
        });
    },

    /** Redraw the widgets section without refetching what it already has. */
    repaintWidgetsBody() {
        const body = document.getElementById('config-widgets-body');
        if (!body) { this.render(); return; }
        body.innerHTML = this.renderWidgetsTab();
        const container = document.getElementById('dashboard-layout');
        if (container) this.bindWidgetsEditor(container);
    },

    /*
     * The widgets on a page, in the order the dashboard draws them.
     *
     * Moving one here moves it on the dashboard, because both write the same
     * blockOrder -- the alternative is two orders that agree until they do not.
     * The list shows every block, categories included but not editable here, so
     * "move up" means something: a widget between two categories has to be able
     * to be put there without dragging on the dashboard.
     */
    /*
     * The widgets on a page: which there are, and how each is set up.
     *
     * Deliberately no arrows here. Where a widget sits is arranged on the
     * Categories tab, in one list with the categories it sits between -- an
     * order that could be edited in two places is two places that disagree, and
     * that is the bug this tab was split away from.
     */
    renderWidgetsEditor() {
        const esc = (v) => this.dash.escapeHtml(v);
        const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
        const pageId = this._widgetPageId != null ? this._widgetPageId : (this.dash.currentPageId ?? pages[0]?.id);
        const pageOptions = pages.map((p) =>
            `<option value="${esc(p.id)}" ${Number(p.id) === Number(pageId) ? 'selected' : ''}>${esc(p.name || p.id)}</option>`
        ).join('') + (pages.length > 1
            ? `<option value="${WIDGETS_ALL_PAGES}"${
                this.isAllPagesView() ? ' selected' : ''}>${
                esc(this.t('config.widgetsAllPages', 'All pages'))}</option>`
            : '');

        let body;
        if (this._widgetBlocks == null) {
            body = `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        } else {
            const widgets = this._widgetBlocks.filter((b) => b.isWidget);
            if (!widgets.length) {
                // The empty list is the invitation. It used to be one grey line
                // under a picker that filled the screen, which made the picker
                // the page and the list an afterthought.
                body = `
                <div class="config-widget-empty">
                    <p class="config-widget-empty-title">${esc(this.t('config.widgetsEmpty',
                        'No widgets on this page yet.'))}</p>
                    <p class="config-widget-empty-hint">${esc(this.t('config.widgetsEmptyHint',
                        'A widget is a block beside your categories that holds something other than bookmarks.'))}</p>
                    ${this.renderWidgetAddButton()}
                </div>`;
            } else {
                const renderRow = (widget, index) => {
                    const enabled = widget.config?.enabled !== false;
                    const open = this._widgetSettingsOpen === index;
                    return `
                <li class="config-widget-row${open ? ' is-open' : ''}${enabled ? '' : ' is-off'}"
                    data-widget-row="${index}">
                    <div class="config-widget-row-head">
                        <div class="config-widget-row-identity">
                            <label class="config-widget-row-pick"
                                title="${esc(this.t('config.widgetsSelectRow', 'Select this widget'))}">
                                <input type="checkbox" data-widget-pick="${esc(widget.id)}"
                                    ${this.widgetSelection.has(widget.id) ? 'checked' : ''}>
                            </label>
                            <span class="config-widget-row-kind">${esc(this.widgetTypeName(widget.type))}</span>
                            ${this.isAllPagesView() && widget.pageName
                                ? `<span class="config-widget-row-page" title="${
                                    esc(this.t('config.widgetsPageLabel', 'Page'))}">${
                                    esc(widget.pageName)}</span>`
                                : ''}
                            <input type="text" class="config-text config-widget-row-title" data-widget="title"
                                data-index="${index}" value="${esc(widget.title || '')}"
                                aria-label="${esc(this.t('config.widgetsTitleLabel', 'Widget title'))}"
                                placeholder="${esc(this.widgetTypeName(widget.type))}">
                        </div>
                        <div class="config-widget-row-actions">
                            <label class="config-toggle config-toggle--inline"
                                title="${esc(this.t('config.widgetsEnabledHint', 'Show this widget on the dashboard'))}">
                                <input type="checkbox" data-widget-enabled="${index}" ${enabled ? 'checked' : ''}>
                                <span>${esc(this.t('config.widgetsEnabled', 'Shown'))}</span>
                            </label>
                            <button type="button" class="config-btn config-btn--small" data-widget-settings="${index}"
                                aria-expanded="${open ? 'true' : 'false'}">${esc(
                                this.t('config.widgetsConfigure', 'Settings'))}</button>
                            <button type="button" class="config-btn config-btn--small config-btn--danger"
                                data-widget-delete="${index}">${esc(this.t('config.backupDelete', 'Delete'))}</button>
                        </div>
                    </div>
                    <p class="config-widget-row-about">${esc(this.widgetTypeAbout(widget.type))}</p>
                    <div class="config-widget-settings" ${open ? '' : 'hidden'}>${
                        open ? this.renderWidgetSettings(widget, index) : ''}</div>
                </li>`;
                };

                /*
                 * Grouped by default, under the same headings the catalogue
                 * uses. A flat list of fourteen is a list to read; four short
                 * groups is a thing to scan.
                 */
                const groups = this.widgetRowsForDisplay();
                const shown = groups.reduce((n, g) => n + g.rows.length, 0);

                if (!shown) {
                    body = `<p class="config-widget-none">${esc(this.t('config.widgetsNoMatch',
                        'No widgets match that search.'))}</p>`;
                } else {
                    body = groups.map(({ group, rows }) => {
                        const list = `<ul class="config-widget-list">${
                            rows.map(({ block, index }) => renderRow(block, index)).join('')}</ul>`;
                        if (!group) return list;
                        return `
                            <section class="config-widget-group">
                                <h4 class="config-widget-group-title">${
                                    esc(this.widgetTypeGroupLabel(group))}</h4>
                                ${list}
                            </section>`;
                    }).join('');
                }
                body = `${this.renderWidgetCount(shown, widgets.length)}${
                    this.renderWidgetBulkBar()}${body}`;
            }
        }

        const hasWidgets = Array.isArray(this._widgetBlocks)
            && this._widgetBlocks.some((b) => b.isWidget);
        const pagePicker = pages.length > 1
            ? `<select class="config-select" data-widget-page aria-label="${
                esc(this.t('config.widgetsPageLabel', 'Page'))}">${pageOptions}</select>`
            : `<select class="config-select" data-widget-page hidden>${pageOptions}</select>`;

        const sortOptions = [
            ['group', this.t('config.widgetsSortGrouped', 'Grouped')],
            ['order', this.t('config.widgetsSortOrder', 'Order on the page')],
            ['name', this.t('config.widgetsSortName', 'Name A–Z')],
            ['type', this.t('config.widgetsSortType', 'Type')],
        ].map(([value, text]) => `<option value="${esc(value)}"${
            value === this.widgetSort ? ' selected' : ''}>${esc(text)}</option>`).join('');

        /*
         * The same toolbar shape as the bookmarks tab: search, the narrowing
         * selects, then the one button that adds something. Two lists in one
         * config view that arrange their controls differently make the second
         * one feel like somewhere else in the app.
         */
        // Adding needs one page to add to, and Add-while-showing-everything has
        // no answer to "where". The picker is right there to choose one.
        const canAdd = !this.isAllPagesView();
        const toolbar = hasWidgets ? `
            <div class="config-crud-toolbar config-crud-toolbar--view">
                <input type="search" class="config-text" id="config-widget-search"
                    placeholder="${esc(this.t('config.searchWidgets', 'Search widgets…'))}"
                    value="${esc(this.widgetQuery || '')}">
                ${pagePicker}
                <select class="config-select" data-widget-sort aria-label="${
                    esc(this.t('config.sortLabel', 'Sort'))}">${sortOptions}</select>
                ${canAdd ? this.renderWidgetAddButton() : ''}
            </div>` : pagePicker;

        return `
            <p class="config-panel-note">${esc(this.t('config.widgetsIntro',
                'Where each one sits is arranged under Pages & tags → categories, together with the categories it sits between.'))}</p>
            ${toolbar}
            ${body}
        `;
    },

    /*
     * The widgets this tab is showing, in the order it shows them.
     *
     * Search matches the title and the type name both, because a widget with no
     * title of its own is drawn under its type -- looking for "processor" and
     * finding nothing, on a page that plainly shows one, is the kind of small
     * lie a search should not tell.
     */
    widgetRowsForDisplay() {
        const all = (this._widgetBlocks || [])
            .map((block, index) => ({ block, index }))
            .filter((row) => row.block.isWidget);

        const query = String(this.widgetQuery || '').trim().toLowerCase();
        const matched = !query ? all : all.filter(({ block }) => {
            const title = String(block.title || '').toLowerCase();
            const type = String(this.widgetTypeName(block.type) || '').toLowerCase();
            return title.includes(query) || type.includes(query)
                || String(block.type || '').toLowerCase().includes(query);
        });

        const byName = (a, b) => this.widgetRowLabel(a.block)
            .localeCompare(this.widgetRowLabel(b.block), undefined, { sensitivity: 'base' });

        switch (this.widgetSort) {
            case 'order':
                // The order they sit in on the page, which is the order the
                // array already holds.
                return [{ group: null, rows: matched }];
            case 'name':
                return [{ group: null, rows: [...matched].sort(byName) }];
            case 'type':
                return [{ group: null, rows: [...matched].sort((a, b) =>
                    String(a.block.type).localeCompare(String(b.block.type)) || byName(a, b)) }];
            default: {
                /*
                 * Grouped, and the default: fourteen rows in one column is a
                 * list to read, four short groups is a thing to scan. The
                 * groups are the ones the catalogue already uses, so a type
                 * cannot sort itself into one place here and another there.
                 */
                const groups = DashboardConfig.WIDGET_TYPE_GROUPS.map(([group, types]) => ({
                    group,
                    rows: matched.filter(({ block }) => types.includes(block.type)),
                })).filter((entry) => entry.rows.length);

                // Custom is in no group, and so is any type added to the
                // register but not yet to the catalogue -- which would
                // otherwise vanish from this tab entirely.
                const grouped = new Set(
                    DashboardConfig.WIDGET_TYPE_GROUPS.flatMap(([, types]) => types),
                );
                const rest = matched.filter(({ block }) => !grouped.has(block.type));
                if (rest.length) groups.push({ group: 'other', rows: rest });
                return groups;
            }
        }
    },

    /** What a row is called: its own title, or the name of its type. */
    widgetRowLabel(block) {
        return String(block?.title || '').trim() || this.widgetTypeName(block?.type) || '';
    },

    /** How many widgets this page holds, and how many the filters show. */
    renderWidgetCount(shown, total) {
        const esc = (v) => this.dash.escapeHtml(v);
        const text = shown === total
            ? this.t('config.widgetsCount', '{n} widgets').replace('{n}', String(total))
            : this.t('config.widgetsCountFiltered', '{shown} of {n} widgets')
                .replace('{shown}', String(shown)).replace('{n}', String(total));
        return `<span class="config-widget-count">${esc(text)}</span>`;
    },

    /*
     * What to do with the ticked rows.
     *
     * Only on screen while something is ticked: a permanent bar of buttons that
     * usually refuse is the same mistake as a reset that never resets. Move is
     * a select rather than a button, because the question is not "move" but
     * "where to", and only pages other than this one are worth offering.
     */
    renderWidgetBulkBar() {
        const esc = (v) => this.dash.escapeHtml(v);
        const picked = this.selectedWidgetIds();
        if (!picked.length) return '';

        const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
        const here = Number(this._widgetPageId);
        const elsewhere = pages.filter((page) => Number(page.id) !== here);
        const moveOptions = [`<option value="">${
            esc(this.t('config.widgetsBulkMoveTo', 'Move to page…'))}</option>`]
            .concat(elsewhere.map((page) =>
                `<option value="${esc(page.id)}">${esc(page.name || page.id)}</option>`))
            .join('');

        return `
            <div class="config-widget-bulk" role="group">
                <span class="config-widget-bulk-count">${esc(
                    this.t('config.widgetsBulkCount', '{n} selected')
                        .replace('{n}', String(picked.length)))}</span>
                <button type="button" class="config-btn config-btn--small" data-widget-bulk="show">${
                    esc(this.t('config.widgetsBulkShow', 'Show'))}</button>
                <button type="button" class="config-btn config-btn--small" data-widget-bulk="hide">${
                    esc(this.t('config.widgetsBulkHide', 'Hide'))}</button>
                ${elsewhere.length ? `<select class="config-select config-select--small"
                    data-widget-bulk-move aria-label="${
                        esc(this.t('config.widgetsBulkMoveTo', 'Move to page…'))}">${moveOptions}</select>` : ''}
                <button type="button" class="config-btn config-btn--small config-btn--danger"
                    data-widget-bulk="delete">${esc(this.t('config.widgetsBulkDelete', 'Delete'))}</button>
                <button type="button" class="config-btn config-btn--small"
                    data-widget-bulk="clear">${esc(this.t('config.widgetsBulkClear', 'Clear'))}</button>
            </div>`;
    },

    /*
     * Write every page the ticked widgets belong to.
     *
     * One page in the ordinary view, several in the all-pages one -- and each
     * is written once rather than once per widget, so ten ticks across two
     * pages are two requests.
     */
    async saveTouchedPages(ids) {
        if (!this.isAllPagesView()) {
            return this.saveWidgetBlocks(this.widgetPayloadFromBlocks());
        }
        const picked = new Set(ids);
        const pages = new Set((this._widgetBlocks || [])
            .filter((block) => block.isWidget && picked.has(block.id))
            .map((block) => Number(block.pageId)));

        for (const pageId of pages) {
            if (!await this.savePageWidgets(pageId)) return false;
        }
        return true;
    },

    /** The ticked widgets that are still on this page, in page order. */
    selectedWidgetIds() {
        return (this._widgetBlocks || [])
            .filter((block) => block.isWidget && this.widgetSelection.has(block.id))
            .map((block) => block.id);
    },

    /*
     * Show, hide, move or remove every ticked widget at once.
     *
     * Each action writes the whole page once rather than a request per widget:
     * the endpoint takes the page's widgets as a set, so ten separate writes
     * would be ten chances for two of them to race.
     */
    async runWidgetBulkAction(action) {
        const ids = this.selectedWidgetIds();
        if (!ids.length) return;
        const picked = new Set(ids);

        if (action === 'clear') {
            this.widgetSelection.clear();
            this.repaintWidgetsBody();
            return;
        }

        if (action === 'delete') {
            const ok = await this.confirmAction(
                this.t('config.widgetsBulkDeleteBody',
                    'Remove {n} widgets? Their settings and any sign-ins they hold go with them.')
                    .replace('{n}', String(ids.length)),
                { confirmLabel: this.t('config.backupDelete', 'Delete'), danger: true });
            if (!ok) return;

            // The credential a widget minted for itself goes with it, exactly
            // as it does when one is deleted on its own -- after the save.
            const removedBlocks = (this._widgetBlocks || []).filter((block) => block.isWidget && picked.has(block.id));
            for (const block of removedBlocks) delete (this._widgetDrafts || {})[block.id];
            // Which page each one lived on, read before they are dropped.
            const byPage = new Map();
            (this._widgetBlocks || []).forEach((block) => {
                if (!block.isWidget || !picked.has(block.id)) return;
                const page = this.isAllPagesView() ? Number(block.pageId) : Number(this._widgetPageId);
                byPage.set(page, (byPage.get(page) || []).concat(block.id));
            });

            this._widgetBlocks = (this._widgetBlocks || [])
                .filter((block) => !(block.isWidget && picked.has(block.id)));

            if (this.isAllPagesView()) {
                for (const [pageId, removed] of byPage) {
                    for (const id of removed) {
                        if (!await this.savePageWidgetsAfterRemoval(pageId, id)) return;
                    }
                }
            } else if (!await this.saveWidgetBlocks(this.widgetPayloadFromBlocks())) {
                return;
            }
            for (const block of removedBlocks) await this.forgetWidgetCredential(block);

            this.widgetSelection.clear();
            this.notify(this.t('config.widgetsBulkDeleted', '{n} widgets removed.')
                .replace('{n}', String(ids.length)), 'success');
            this._widgetLoadedFor = null;
            await this.loadWidgetsEditor();
            await this.refreshDashboardBlocks();
            return;
        }

        // Show and hide: one field on each, written in a single save.
        const visible = action === 'show';
        this._widgetBlocks = (this._widgetBlocks || []).map((block) => {
            if (!block.isWidget || !picked.has(block.id)) return block;
            const config = { ...(block.config || {}) };
            // Absent is how "shown" is stored, so hiding sets a flag and
            // showing removes one rather than writing enabled: true.
            if (visible) delete config.enabled;
            else config.enabled = false;
            return { ...block, config };
        });
        if (!await this.saveTouchedPages(ids)) return;

        this.repaintWidgetsBody();
        await this.refreshDashboardBlocks();
        this.notify(visible
            ? this.t('config.widgetsBulkShown', '{n} widgets shown.').replace('{n}', String(ids.length))
            : this.t('config.widgetsBulkHidden', '{n} widgets hidden.').replace('{n}', String(ids.length)),
        'success');
    },

    /*
     * Move the ticked widgets to another page.
     *
     * Two pages change, so this is two writes, and the order matters: the
     * destination is written first. If that fails nothing has been removed
     * from here, and a reader still has their widgets -- the other way round
     * loses them to a failed second request.
     */
    async moveWidgetsToPage(targetPageId, ids = this.selectedWidgetIds()) {
        const target = Number(targetPageId);
        if (!ids.length || !target || target === Number(this._widgetPageId)) return;

        const picked = new Set(ids);
        const moving = (this._widgetBlocks || [])
            .filter((block) => block.isWidget && picked.has(block.id))
            // In the all-pages view a tick may already be on the destination,
            // and moving a widget to where it is would delete it from there.
            .filter((block) => !this.isAllPagesView() || Number(block.pageId) !== target);
        if (!moving.length) return;

        let destination;
        try {
            const res = await fetch(`/api/pages/${target}/blocks`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            destination = await res.json();
        } catch (_error) {
            this.notify(this.t('config.widgetsMoveFailed',
                'Could not read the other page — nothing was moved.'), 'error');
            return;
        }

        /*
         * The ids come along, and the server keeps them: a widget that kept
         * its id keeps the credential and the collapsed state that are filed
         * under it, so moving a page is not quietly a delete and a re-add.
         */
        const widgets = (destination.widgets || []).concat(moving.map((block) => ({
            id: block.id, type: block.type, title: block.title, config: block.config || {},
        })));

        const wrote = await this.writeFetch(`/api/pages/${target}/blocks`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgets }),
        }).then((res) => res.ok).catch(() => false);

        if (!wrote) {
            this.notify(this.t('config.widgetsMoveFailed',
                'Could not read the other page — nothing was moved.'), 'error');
            return;
        }

        // Only now: the widgets exist in both places for a moment, which is the
        // safe half of the trade.
        const sources = new Map();
        moving.forEach((block) => {
            const page = this.isAllPagesView() ? Number(block.pageId) : Number(this._widgetPageId);
            sources.set(page, (sources.get(page) || []).concat(block.id));
        });
        this._widgetBlocks = (this._widgetBlocks || [])
            .filter((block) => !(block.isWidget && picked.has(block.id)));

        if (this.isAllPagesView()) {
            for (const [pageId, removed] of sources) {
                for (const id of removed) {
                    if (!await this.savePageWidgetsAfterRemoval(pageId, id)) return;
                }
            }
        } else if (!await this.saveWidgetBlocks(this.widgetPayloadFromBlocks())) {
            return;
        }

        ids.forEach((id) => this.widgetSelection.delete(id));
        // Indices shift once a row leaves, so an open panel would land on
        // whichever widget slid into its place.
        this._widgetSettingsOpen = null;
        const pageName = (this.dash.pages || [])
            .find((page) => Number(page.id) === target)?.name || target;
        this.notify(moving.length === 1
            ? this.t('config.widgetMoved', '{name} moved to {page}.')
                .replace('{name}', this.widgetRowLabel(moving[0])).replace('{page}', String(pageName))
            : this.t('config.widgetsMoved', '{n} widgets moved to {page}.')
                .replace('{n}', String(moving.length)).replace('{page}', String(pageName)), 'success');

        this._widgetLoadedFor = null;
        await this.loadWidgetsEditor();
        await this.refreshDashboardBlocks();
    },

    /*
     * Move one widget from its settings panel.
     *
     * An unsaved draft would not travel: the move carries what is stored, and
     * the panel closes behind it. So that is asked first, and a refusal puts
     * the select back where the widget still is.
     */
    async moveOneWidgetToPage(index, select) {
        const block = (this._widgetBlocks || [])[index];
        const previous = select.getAttribute('data-widget-current-page');
        if (!block?.isWidget || !select.value || select.value === previous) return;

        if (this.widgetDraftDirty(index)) {
            const ok = await this.confirmAction(
                this.t('config.widgetMoveDiscardBody',
                    'This widget has unsaved changes. Moving it keeps what is saved and drops the rest.'),
                {
                    title: this.t('config.widgetsDiscardDraftsTitle', 'Discard unsaved changes?'),
                    confirmLabel: this.t('config.widgetMoveDiscardOk', 'Move anyway'),
                });
            if (!ok) { select.value = previous; return; }
        }
        this.stopCustomProbeLive();
        delete (this._widgetDrafts || {})[block.id];
        await this.moveWidgetsToPage(select.value, [block.id]);
        // A failed move leaves the widget where it was; say so in the select too.
        if (select.isConnected) select.value = previous;
    },

    /** The one door to the catalogue. Same label wherever it appears. */
    renderWidgetAddButton() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `<button type="button" class="config-btn config-btn--primary" data-widget-catalogue>${
            esc(this.t('config.widgetsAddTitle', 'Add a widget'))}</button>`;
    },

    /*
     * Choosing what to add: the kinds themselves, not a list of their names.
     *
     * Every kind is on screen at once, under the question it answers, and
     * choosing one is the click that adds it -- no second step that asks
     * nothing.
     *
     * It opens as an overlay rather than sitting on the tab. Inline it was
     * measured at 900px on a 900px viewport, which put the list of widgets you
     * actually have 412px below the fold: clicking a card added something you
     * could not see, and said so with a toast in the opposite corner. The
     * theme browser answers the same question the same way, for the same
     * reason.
     */
    openWidgetCatalogue() {
        const esc = (v) => this.dash.escapeHtml(v);
        if (!window.AppModal?.show) return;

        window.AppModal.show({
            title: this.t('config.widgetsAddTitle', 'Add a widget'),
            htmlMessage: `
                <p class="config-widget-catalogue-note">${esc(this.t('config.widgetsAddNote',
                    'Choose a kind and it lands at the end of the page. Everything about it is editable afterwards.'))}</p>
                ${this.renderWidgetCatalogue()}`,
            showCancel: false,
            confirmText: this.t('dashboard.close', 'Close'),
            modalClass: 'modal--widget-catalogue',
            modalMaxWidth: '52rem',
            initialFocusSelector: '[data-widget-add]',
        });

        // The overlay lives outside #config-widgets-body, so the tab's
        // delegated click handler never sees these.
        const root = document.getElementById('modal-text');
        if (!root) return;
        root.addEventListener('click', (event) => {
            const card = event.target?.closest?.('[data-widget-add]');
            if (!card) return;
            window.AppModal.hide();
            void this.addWidget(card.getAttribute('data-widget-add') || 'health');
        });
    },

    /** The catalogue itself: every kind, grouped under the question it answers. */
    renderWidgetCatalogue() {
        const esc = (v) => this.dash.escapeHtml(v);
        const card = (type) => `
            <button type="button" class="config-widget-pick" data-widget-add="${esc(type)}">
                <span class="config-widget-pick-name">${esc(this.widgetTypeName(type))}</span>
                <span class="config-widget-pick-about">${esc(this.widgetTypeAbout(type))}</span>
            </button>`;
        const groups = DashboardConfig.WIDGET_TYPE_GROUPS.map(([group, types]) => `
            <section class="config-widget-pick-group">
                <h4 class="config-widget-pick-group-title">${esc(this.widgetTypeGroupLabel(group))}</h4>
                <div class="config-widget-pick-grid">${types.map(card).join('')}</div>
            </section>`).join('');

        return `
            <div class="config-widget-catalogue">
                ${groups}
                <section class="config-widget-pick-group">
                    <h4 class="config-widget-pick-group-title">${esc(this.t('config.widgetGroupCustom',
                        'And anything else: the Custom widget'))}</h4>
                    <div class="config-widget-pick-grid">${card('custom')}</div>
                    <p class="config-widget-pick-footnote">${esc(this.t('config.widgetsAddCustomNote',
                        'Reads a figure out of any service that answers JSON, and can start from one of the services already known. The Types tab explains what it can do.'))}</p>
                </section>
            </div>`;
    },

    /*
     * The id this widget's own key is filed under.
     *
     * Derived from the widget rather than typed, because naming a secret is a
     * question nobody asked to be asked: the reader is filling in a Sonarr
     * widget, and "give this credential a name" is a step between them and the
     * thing they came to do.
     *
     * The colon is deliberate -- normalizeCredentialID allows it -- and marks
     * the entry as belonging to a widget rather than being a shared one
     * somebody made on purpose.
     */
    widgetCredentialId(widget) {
        return widget?.id ? `widget:${widget.id}` : '';
    },

    /*
     * What the credential file says is filed for this widget -- never the secret.
     *
     * The value does not come back from the server and never will, so this
     * reads the shape around it: a header name means an API key, a username
     * means basic auth. Enough to draw the right form with the right box
     * already labelled, and to say that something is set without showing it.
     */
    /*
     * The preset a widget was started from, if any.
     *
     * A sign-in's shape -- where to post, what the fields are called, which
     * header carries a token -- is preset knowledge with no box on screen, and
     * the stored credential never comes back to the browser. A panel opened
     * again therefore reads it from the preset, or a retyped password would
     * be filed without anywhere to sign in.
     */
    widgetPresetOf(widget, index) {
        const draft = index === undefined ? null : this.widgetDraft(index, { create: false });
        const id = String(draft?.config?.presetId || widget?.config?.presetId || '');
        return id ? window.DashboardWidgetPresets?.byId?.(id) || null : null;
    },

    /** A sign-in that asks for a password only (Pi-hole v6, Duplicati). */
    sessionIsPasswordOnly(session) {
        return Boolean(session) && session.format === 'json' && !session.userField;
    },

    storedCredentialState(widget) {
        const own = this.widgetCredentialId(widget);
        const chosen = String(widget?.config?.credentialId || '');
        const details = this.dash.healthCredentialDetails || {};
        if (chosen && chosen !== own) return { kind: 'shared', shared: chosen };
        const stored = details[own];
        if (!stored) return { kind: 'none' };
        if (stored.session) {
            return { kind: 'session', basicUser: stored.sessionUser || '', saved: true };
        }
        if (stored.query?.length) {
            // Before headers: a Plex widget has both -- its Accept header is
            // sent for it -- and the key the reader typed is the query one.
            // With the preset's fixed headers: a key typed again after a reload
            // went out alone, the PUT replaced the entry, and Plex's Accept
            // (Nextcloud's OCS-APIRequest) was gone.
            return { kind: 'query', queryName: stored.query[0], saved: true,
                fixedHeaders: this.widgetPresetOf(widget)?.fixedHeaders || null };
        }
        if (stored.headers?.length) {
            // A header the preset always sends (Nextcloud's OCS-APIRequest) is
            // not the key; the one the reader typed is whichever is left.
            const fixed = Object.keys(this.widgetPresetOf(widget)?.fixedHeaders || {})
                .map((name) => name.toLowerCase());
            const own = stored.headers.find((name) => !fixed.includes(String(name).toLowerCase()))
                || stored.headers[0];
            return { kind: 'header', headerName: own, saved: true,
                fixedHeaders: this.widgetPresetOf(widget)?.fixedHeaders || null };
        }
        if (stored.basic) return { kind: 'basic', basicUser: stored.basicUser || '', saved: true };
        return { kind: 'none' };
    },

    /*
     * What is on screen for one widget, before it is saved.
     *
     * Every control in the panel writes here and nowhere else, and one Save
     * button writes the whole thing out. The alternative -- a listener per
     * input, each writing to the server on its own change -- is what this
     * replaces, and it failed in the one way that leaves no trace: the panel is
     * redrawn by several paths (opening it, a preset landing, the credential
     * names arriving from their own fetch), a listener does not survive its
     * element being replaced, and a box nobody is listening to still accepts
     * typing. It looks saved and is not.
     *
     * Keyed on the widget id rather than the index, because the index shifts
     * when a block above it is removed and a draft must not follow it.
     */
    widgetDraft(index, { create = true } = {}) {
        const block = (this._widgetBlocks || [])[index];
        if (!block?.isWidget) return null;
        this._widgetDrafts = this._widgetDrafts || {};
        if (!this._widgetDrafts[block.id]) {
            if (!create) return null;
            this._widgetDrafts[block.id] = {
                // A copy, deep enough for the one nested shape a config has.
                // Editing the stored object directly would mean a Revert had
                // nothing left to revert to.
                config: {
                    ...(block.config || {}),
                    fields: Array.isArray(block.config?.fields)
                        ? block.config.fields.map((field) => ({ ...field }))
                        : undefined,
                },
                auth: this.storedCredentialState(block),
            };
        }
        return this._widgetDrafts[block.id];
    },

    widgetCredentialState(widget, index) {
        return this.widgetDraft(index)?.auth || { kind: 'none' };
    },

    /*
     * Whether this panel holds anything not yet written.
     *
     * Compared against what is stored rather than tracked with a flag: a value
     * typed and then typed back is not a change, and a flag would keep saying
     * it was.
     */
    /**
     * Is any widget on this page holding unsaved edits?
     *
     * widgetDraftDirty answers for one row; the page selector needs the whole
     * list, because it throws every draft away at once.
     */
    widgetDraftsDirty() {
        return (this._widgetBlocks || []).some((_, index) => this.widgetDraftDirty(index));
    },

    /*
     * A config as one comparable string, keys in a fixed order at every depth.
     *
     * The obvious shorthand -- JSON.stringify(config, Object.keys(config).sort())
     * -- was wrong in a way that read as right: the second argument is a
     * replacer, it applies at every level, and it was built from the top-level
     * keys only. So every object inside `fields` kept none of its own keys and
     * came out as {}, which made a changed path, label or format compare equal
     * to the one before it and left Save greyed out over an edit that had
     * plainly happened. Adding or removing a field still registered, because
     * the array's length survives -- which is what made this look like one
     * stubborn widget rather than a comparison that could not see.
     *
     * undefined is skipped rather than written as null, because a draft spells
     * out `fields: undefined` for a widget that has none while the stored block
     * simply has no such key, and those two are the same thing.
     */
    canonicalJSON(value) {
        if (Array.isArray(value)) {
            // Order is kept: the sequence of fields is the order of the figures
            // on the tile, so moving one is a change like any other.
            return `[${value.map((item) => this.canonicalJSON(item)).join(',')}]`;
        }
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort()
                .filter((key) => value[key] !== undefined)
                .map((key) => `${JSON.stringify(key)}:${this.canonicalJSON(value[key])}`)
                .join(',')}}`;
        }
        return value === undefined ? 'null' : JSON.stringify(value);
    },

    widgetDraftDirty(index) {
        const block = (this._widgetBlocks || [])[index];
        const draft = this.widgetDraft(index, { create: false });
        if (!block || !draft) return false;
        if (this.canonicalJSON(draft.config || {}) !== this.canonicalJSON(block.config || {})) return true;
        const before = this.storedCredentialState(block);
        const now = draft.auth || {};
        // A secret that was typed is a change even when nothing else moved.
        if (String(now.secret || '')) return true;
        return before.kind !== now.kind
            || String(before.headerName || '') !== String(now.headerName || '')
            || String(before.queryName || '') !== String(now.queryName || '')
            || String(before.basicUser || '') !== String(now.basicUser || '')
            || String(before.shared || '') !== String(now.shared || '');
    },

    /*
     * The part of the address the reader still has to fill in.
     *
     * Two presets ship an address that cannot work as given: Home Assistant
     * names one entity out of a few hundred and Proxmox names one node, and
     * neither has a sensible default. Left as YOUR_SENSOR the service answers
     * 404 "Entity not found" -- correct, and no help at all if you have just
     * pasted a token and are looking for what you did wrong.
     *
     * Said beside the address rather than left to the trial, so it is read
     * before Ask now rather than after it.
     */
    renderAddressPlaceholderNote(widget, index) {
        const esc = (v) => this.dash.escapeHtml(v);
        const catalogue = window.DashboardWidgetPresets;
        const draft = this.widgetDraft(index, { create: false });
        const config = draft?.config || widget?.config || {};
        const preset = catalogue?.byId?.(String(config.presetId || ''));
        const marker = preset?.fillIn;
        if (!marker) return '';
        /*
         * The placeholder may be in the address or in the figures, depending on
         * the service: Proxmox names its node in the path, Home Assistant names
         * its entity in each figure because one address answers with all of
         * them. Both are "something still to fill in", so both are looked at.
         */
        const inAddress = String(config.url || '').includes(marker);
        const inFields = (Array.isArray(config.fields) ? config.fields : [])
            .some((field) => String(field?.path || '').includes(marker));
        if (!inAddress && !inFields) return '';
        return `
            <p class="config-widget-note config-widget-note-hint">${esc(
                (inFields
                    ? this.t('config.widgetCustomFillInFields',
                        'Replace {what} in the figures below with entities of your own — one figure per reading.')
                    : this.t('config.widgetCustomFillIn',
                        'Replace {what} in the address with your own — the service cannot answer until you do.'))
                    .replace('{what}', marker))}</p>`;
    },

    /*
     * Where the API key is typed: here, in the widget, and nowhere else.
     *
     * The value does not go into the widget's config. bookmarks-N.json is in
     * the backup allowlist and in every export, so a key stored there would
     * travel in a ZIP to wherever that backup goes; it is written to the
     * credential file instead and the widget keeps only the id. That is a
     * storage decision and not a reason to send anyone to another screen --
     * whoever is filling in a Sonarr widget is holding the Sonarr key.
     */
    /*
     * A secret box with an eye beside it.
     *
     * The box itself is unchanged -- same data-widget-auth="secret" the draft
     * already listens for -- so revealing is bolted beside the form rather than
     * into it: nothing about saving, drafting or dirty-checking learns that this
     * button exists.
     *
     * The stored value is not rendered here. It is fetched when the eye is
     * pressed and cleared when it is pressed again, so a key sits in the DOM for
     * exactly as long as somebody is looking at it, and a panel left open on a
     * second screen is not a key left on a second screen.
     */
    renderSecretInput({ id, index, field, saved, placeholder, value }) {
        const esc = (v) => this.dash.escapeHtml(v);
        const label = this.t('config.widgetAuthReveal', 'Show what is stored');
        // A seeded scheme is not a secret and is the one thing here worth
        // showing plainly: it is what the reader has to type in front of what
        // they hold, so masking it would hide the hint at the moment it lands.
        const seeded = String(value || '');
        return `
            <div class="config-secret-field">
                <input type="${seeded ? 'text' : 'password'}" id="${esc(id)}" class="config-text"
                    data-widget-auth="secret" value="${esc(seeded)}"
                    data-widget-index="${index}" maxlength="1024" spellcheck="false" autocomplete="off"
                    placeholder="${esc(placeholder)}">
                <button type="button" class="config-secret-eye" data-secret-reveal="${esc(id)}"
                    data-widget-index="${index}" data-secret-field="${esc(field || '')}"
                    data-secret-saved="${saved ? '1' : ''}"
                    aria-pressed="false" aria-controls="${esc(id)}" title="${esc(label)}"
                    aria-label="${esc(label)}">${this.secretEyeIcon(false)}</button>
            </div>`;
    },

    /*
     * Show what is stored, or stop showing it.
     *
     * Two cases behind one button, and the difference is invisible to whoever
     * presses it: a box holding something typed just now is already in the DOM
     * and only needs unmasking, while a box over a saved key is empty and the
     * value has to be asked for. The reader's question is the same either way --
     * what is in there -- so the button is the same either way.
     *
     * Hiding again clears a fetched value rather than re-masking it, because a
     * masked box still holds its value: leaving it there would keep the key in
     * the DOM behind a dot pattern, which is the appearance of having put it
     * away rather than putting it away. What was typed by hand stays, since
     * clearing that would throw away an edit nobody asked to lose.
     */
    async toggleSecretReveal(button) {
        const input = document.getElementById(button.getAttribute('data-secret-reveal'));
        if (!input) return;
        const revealed = button.getAttribute('aria-pressed') === 'true';

        const setEye = (on) => {
            button.setAttribute('aria-pressed', on ? 'true' : 'false');
            button.innerHTML = this.secretEyeIcon(on);
            const label = on
                ? this.t('config.widgetAuthHide', 'Hide it again')
                : this.t('config.widgetAuthReveal', 'Show what is stored');
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
        };

        if (revealed) {
            input.type = 'password';
            // Only what this button put there is taken back.
            if (button.dataset.secretFetched === '1') {
                input.value = '';
                delete button.dataset.secretFetched;
            }
            setEye(false);
            return;
        }

        // Something typed is its own answer; nothing needs asking.
        if (!input.value && button.getAttribute('data-secret-saved') === '1') {
            const index = Number(button.getAttribute('data-widget-index'));
            const widget = (this._widgetBlocks || [])[index];
            const id = this.widgetCredentialId(widget);
            const field = button.getAttribute('data-secret-field') || '';
            if (!id || !field) return;
            try {
                const res = await this.writeFetch(
                    `/api/health/credentials/reveal?id=${encodeURIComponent(id)}&field=${encodeURIComponent(field)}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                input.value = String(data?.value || '');
                button.dataset.secretFetched = '1';
            } catch {
                // The box stays as it was. A key that could not be read is not
                // a key that changed, so there is nothing to undo and nothing
                // worth a dialog over a button that can simply be pressed again.
                this.notify(this.t('config.widgetAuthRevealFailed',
                    'That key could not be read.'), 'error');
                return;
            }
        }
        input.type = 'text';
        setEye(true);
    },

    /*
     * Is this only the scheme a preset seeded, with no token after it?
     *
     * Compared against what the presets actually seed rather than a rule about
     * spaces: "PVEAPIToken=" ends in no space at all, and a rule guessing at
     * the shape of a scheme would let it through while catching things that are
     * somebody's real key.
     */
    isSchemeOnly(value) {
        const seeds = window.DashboardWidgetPresets?.PRESETS
            ?.map((preset) => preset.scheme)
            .filter(Boolean) || [];
        const typed = String(value || '').trim();
        return seeds.some((seed) => typed === seed.trim());
    },

    /*
     * Redraws the figures table in place, keeping whatever is being typed.
     *
     * The whole panel is not repainted, because the address, the key and every
     * path are text boxes: redrawing them takes the caret with it, and a trial
     * finishing while somebody is mid-path would move it out from under them.
     */
    repaintCustomFields(index) {
        const block = (this._widgetBlocks || [])[index];
        if (!block) return;
        const host = document.querySelector(`[data-widget-row="${index}"]`);
        const group = host?.querySelector('.config-custom-field')?.closest('.config-custom-group');
        if (!group) return;
        const active = document.activeElement;
        const rows = [...group.querySelectorAll('.config-custom-field')];
        rows.forEach((rowEl, row) => {
            const found = rowEl.querySelector('.config-custom-found');
            if (!found) return;
            // Only the one cell is replaced, so nothing the reader is typing in
            // is touched at all.
            found.outerHTML = this.renderFieldFound(block, row);
        });
        if (active && document.contains(active) && active.focus) active.focus();
    },

    /*
     * What this path actually found, beside the path itself.
     *
     * The trial already knew: it reports a value per figure, in the same order
     * as the rows. But it reported them in a block of its own, below the
     * address and the sign-in and often below the fold -- so writing a path
     * meant typing it here, pressing Ask now, scrolling down, reading "that
     * path found nothing", scrolling back, and guessing again. Beside the box,
     * the same answer is read while the path is being written.
     *
     * Blank until something has been asked. A row that has never been tried has
     * no answer to give, and inventing one would be worse than the space.
     */
    renderFieldFound(widget, row) {
        const esc = (v) => this.dash.escapeHtml(v);
        const values = this.customProbeState(widget?.id)?.data?.result?.values;
        /*
         * An empty column under a heading reads as broken rather than as
         * waiting, so it says which of the two it is. Nothing has been asked is
         * the state every panel opens in and the one where the reader most
         * needs telling what to press.
         */
        if (!Array.isArray(values) || !values[row]) {
            return `<span class="config-custom-found is-waiting">${esc(
                this.t('config.widgetCustomFoundWaiting', 'Ask now'))}</span>`;
        }
        const value = values[row];
        if (value.missing) {
            return `<span class="config-custom-found is-missing" title="${esc(
                this.t('config.widgetCustomTestMissing', 'that path found nothing'))}">${esc(
                this.t('config.widgetCustomFoundNothing', 'not found'))}</span>`;
        }
        const shown = String(value.value ?? '');
        // Titled as well as shown: a figure can be longer than the column, and
        // the whole of it is what the reader is checking against.
        return `<span class="config-custom-found" title="${esc(shown)}">${esc(shown)}</span>`;
    },

    renderWidgetCredential(widget, index) {
        const esc = (v) => this.dash.escapeHtml(v);
        const state = this.widgetCredentialState(widget, index);
        const own = this.widgetCredentialId(widget);
        const shared = Object.entries(this.dash.healthCredentials || {})
            .filter(([id]) => id !== own)
            .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
        const id = `widget-${index}-auth`;
        const pick = (value, key, fallback) =>
            `<option value="${esc(value)}" ${state.kind === value ? 'selected' : ''}>${
                esc(this.t(key, fallback))}</option>`;

        /*
         * A saved key is shown as the fact that it is set, never as itself.
         *
         * An empty box over a stored key reads as "no key", and the reader
         * pastes it again for no reason; a box holding the key is a key on a
         * screen, in a screenshot, over a shoulder.
         */
        const secretPlaceholder = state.saved
            ? this.t('config.widgetAuthKept', 'Set — type to replace')
            : this.t('config.widgetAuthPaste', 'Paste it here');

        /*
         * Authorization is the one header whose value is not just a secret.
         *
         * It carries a scheme -- "Bearer", "token", "PVEAPIToken=" -- and a
         * service handed the bare secret answers 401 exactly as it would to a
         * wrong key, which is the most expensive way this form can be filled in
         * wrongly: everything looks right and the tile just says the service
         * refused. Said here rather than fixed for them, because a few services
         * genuinely want the token bare and prefixing it would break those.
         */
        const wantsScheme = state.kind === 'header'
            && String(state.headerName || '').toLowerCase() === 'authorization';
        const schemeHint = !wantsScheme ? '' : `
            <p class="config-widget-note config-widget-note-hint">${esc(this.t('config.widgetAuthScheme',
                'Most services want a scheme in front of the token here — "Bearer <token>" — not the token on its own.'))}</p>`;

        const header = state.kind !== 'header' ? '' : `
            <div class="config-widget-field">
                <label for="${id}-name">${esc(this.t('config.widgetAuthHeaderName', 'Header'))}</label>
                <input type="text" id="${id}-name" class="config-text" data-widget-auth="headerName"
                    data-widget-index="${index}" maxlength="128" spellcheck="false" autocomplete="off"
                    value="${esc(state.headerName || '')}" placeholder="X-Api-Key">
            </div>
            <div class="config-widget-field">
                <label for="${id}-key">${esc(this.t('config.widgetAuthKey', 'API key'))}</label>
                ${this.renderSecretInput({
                    id: `${id}-key`, index, field: state.headerName || '', saved: state.saved,
                    placeholder: secretPlaceholder, value: state.seed || '',
                })}
                ${schemeHint}
            </div>`;

        /*
         * The address form: one box, for a service that has no header form.
         *
         * The parameter name is not editable, unlike the header name beside it.
         * A header name is something a reader might reasonably know better than
         * the preset does; a query parameter is part of the path the preset
         * already filled in, and a name typed here that does not match the
         * address would fill in a parameter the service never reads.
         */
        const query = state.kind !== 'query' ? '' : `
            <div class="config-widget-field">
                <label for="${id}-query">${esc(this.t('config.widgetAuthKey', 'API key'))}</label>
                ${this.renderSecretInput({
                    id: `${id}-query`, index, field: `query:${state.queryName || ''}`,
                    saved: state.saved, placeholder: secretPlaceholder,
                })}
                <p class="config-widget-note config-widget-note-hint">${esc(this.t('config.widgetAuthQueryNote',
                    'This service takes its key in the address. It is kept in the credential file all the same, and put into the request as {name}.')
                    .replace('{name}', state.queryName || 'apikey'))}</p>
            </div>`;

        /*
         * Signing in for a session: the two things that do not expire.
         *
         * Drawn like basic auth because it is the same two questions, and the
         * difference -- that these are posted to a login endpoint rather than
         * sent on every request -- is the server's business rather than the
         * reader's.
         */
        const passwordOnly = this.sessionIsPasswordOnly(
            this.widgetDraft(index, { create: false })?.auth?.session || this.widgetPresetOf(widget, index)?.session);
        // A service that signs in with a password alone (Pi-hole v6,
        // Duplicati) gets no username box: there is nothing to put in it.
        const session = state.kind !== 'session' ? '' : `${passwordOnly ? '' : `
            <div class="config-widget-field">
                <label for="${id}-suser">${esc(this.t('config.widgetAuthUser', 'Username'))}</label>
                <input type="text" id="${id}-suser" class="config-text" data-widget-auth="basicUser"
                    data-widget-index="${index}" maxlength="128" spellcheck="false" autocomplete="off"
                    value="${esc(state.basicUser || '')}">
            </div>`}
            <div class="config-widget-field">
                <label for="${id}-spass">${esc(this.t('config.widgetAuthPassword', 'Password'))}</label>
                ${this.renderSecretInput({
                    id: `${id}-spass`, index, field: 'sessionPassword',
                    saved: state.saved, placeholder: secretPlaceholder,
                })}
                <p class="config-widget-note config-widget-note-hint">${esc(this.t('config.widgetAuthSessionNote',
                    'nextDash signs in with these and keeps the session itself, so nothing has to be replaced when it expires.'))}</p>
            </div>`;

        const basic = state.kind !== 'basic' ? '' : `
            <div class="config-widget-field">
                <label for="${id}-user">${esc(this.t('config.widgetAuthUser', 'Username'))}</label>
                <input type="text" id="${id}-user" class="config-text" data-widget-auth="basicUser"
                    data-widget-index="${index}" maxlength="128" spellcheck="false" autocomplete="off"
                    value="${esc(state.basicUser || '')}">
            </div>
            <div class="config-widget-field">
                <label for="${id}-pass">${esc(this.t('config.widgetAuthPassword', 'Password'))}</label>
                ${this.renderSecretInput({
                    id: `${id}-pass`, index, field: 'basicPassword', saved: state.saved,
                    placeholder: secretPlaceholder,
                })}
            </div>`;

        const sharedPick = state.kind !== 'shared' ? '' : `
            <div class="config-widget-field">
                <label for="${id}-shared">${esc(this.t('config.widgetAuthSharedPick', 'Which one'))}</label>
                <select id="${id}-shared" class="config-select" data-widget-auth="shared"
                    data-widget-index="${index}">
                    ${shared.map(([sid, label]) =>
                        `<option value="${esc(sid)}" ${sid === state.shared ? 'selected' : ''}>${esc(label)}</option>`).join('')}
                </select>
            </div>`;

        const explains = state.kind === 'header' || state.kind === 'basic'
            || state.kind === 'query' || state.kind === 'session';
        return `
            <div class="config-widget-auth" data-widget-auth-form="${index}">
                <div class="config-widget-field">
                    <label for="${id}">${esc(this.t('config.widgetCustomCredential', 'Sign in with'))}</label>
                    <select id="${id}" class="config-select" data-widget-auth="kind" data-widget-index="${index}">
                        ${pick('none', 'config.widgetAuthNone', 'Nothing — ask anonymously')}
                        ${pick('header', 'config.widgetAuthHeader', 'An API key')}
                        ${state.kind === 'query'
                            ? pick('query', 'config.widgetAuthQuery', 'A key in the address')
                            : ''}
                        ${state.kind === 'session'
                            ? pick('session', 'config.widgetAuthSession', 'A sign-in that nextDash keeps')
                            : ''}
                        ${pick('basic', 'config.widgetAuthBasic', 'A username and password')}
                        ${shared.length ? pick('shared', 'config.widgetAuthShared', 'A sign-in saved elsewhere') : ''}
                    </select>
                </div>
                ${header}${query}${session}${basic}${sharedPick}
                ${explains ? `
                    <p class="config-widget-note">${esc(this.t('config.widgetAuthNote',
                        'Kept in a separate file that stays out of your backups and exports, so a key never travels in a ZIP. The widget itself stores only a reference.'))}</p>` : ''}
            </div>`;
    },

    /**
     * A starting position for the Custom widget, per service.
     *
     * This is the answer to "why is there no Sonarr widget". Everything a
     * dedicated widget would need already exists — a server that fetches, a
     * credential store that keeps the key out of the browser, a cache, a path
     * reader, a formatter — so what was missing was never code. It was knowing
     * that Sonarr keeps the queue size at `totalCount` under
     * `/api/v3/queue/status`, which is knowledge, and knowledge belongs in a
     * data file rather than in a handler that has to be released.
     *
     * It fills the form and then gets out of the way: the address stays
     * editable and the figures become ordinary rows, so a service that moves a
     * field is a thing the reader can fix without waiting for a version.
     */
    renderWidgetPresets(widget, index) {
        const esc = (v) => this.dash.escapeHtml(v);
        const catalogue = window.DashboardWidgetPresets;
        // The picker is drawn from a script that may not have loaded; without
        // it the panel is exactly what it was before presets existed.
        if (!catalogue?.PRESETS?.length) return '';

        const id = `widget-${index}-preset`;
        // What this widget was started from, if anything. Shown as the
        // selection rather than reset to nothing: a panel that has clearly
        // been filled in by Sonarr and says "Choose a service" reads as though
        // the choice did not take.
        const chosen = String(this.widgetDraft(index)?.config?.presetId
            || widget?.config?.presetId || '');
        const groups = catalogue.GROUPS.map(([group, title]) => {
            const options = catalogue.PRESETS
                // A retired service is not offered for a new widget, but a
                // widget already started from it still shows its choice.
                .filter((preset) => preset.group === group && (!preset.retired || preset.id === chosen))
                .map((preset) => `<option value="${esc(preset.id)}"${
                    preset.id === chosen ? ' selected' : ''}>${esc(preset.name)}</option>`)
                .join('');
            return options
                ? `<optgroup label="${esc(this.t(`config.widgetPresetGroup.${group}`, title))}">${options}</optgroup>`
                : '';
        }).join('');

        return `
            <div class="config-custom-group">
                <h4 class="config-custom-group-title">${esc(this.t('config.widgetPresets',
                    'Start from a service'))}</h4>
                <p class="config-widget-note">${esc(this.t('config.widgetPresetsNote',
                    'Fills in the address and the figures for a service that is already known. '
                    + 'Everything stays editable afterwards.'))}</p>
                <div class="config-widget-field">
                    <label for="${id}">${esc(this.t('config.widgetPresetPick', 'Service'))}</label>
                    <select id="${id}" class="config-select" data-widget-preset="${index}">
                        <option value=""${chosen ? '' : ' selected'}>${esc(
                            this.t('config.widgetPresetNone', 'Choose a service…'))}</option>
                        ${groups}
                    </select>
                </div>
            </div>`;
    },

    /**
     * The fields a custom widget reads, as rows that can be added and removed.
     *
     * A path, what to call it, and how to show it. No expression box: the
     * moment a config can compute, it is a second product with its own bugs and
     * no debugger — and a widget only ever needs a number out of a response.
     */
    /*
     * What a widget setting means, in the dialog config already uses.
     *
     * The settings panels reach their explanations through FIELD_META, keyed by
     * the name of a settings field. A widget's settings are their own table
     * with their own keys, so the text is found there instead -- the same two
     * locale keys, the same AppModal, the same "Got it".
     */
    openWidgetFieldInfo(key) {
        if (!key || !window.AppModal?.alert) return;
        const field = Object.values(DashboardConfig.WIDGET_SETTINGS)
            .flat()
            .find((entry) => entry.key === key && entry.info);
        if (!field) return;
        const [titleKey, messageKey] = field.info;
        window.AppModal.alert({
            title: this.t(`config.${titleKey}`, ''),
            htmlMessage: this.dash.escapeHtml(this.t(`config.${messageKey}`, '')).replace(/\n/g, '<br>'),
            confirmText: this.t('config.gotIt', 'Got it'),
        });
    },

    renderCustomWidgetFields(widget, index) {
        const esc = (v) => this.dash.escapeHtml(v);
        const fields = Array.isArray(widget?.config?.fields) ? widget.config.fields : [];
        const formatLabels = {
            percent: 'Percentage (0–100)',
            share: 'Percentage from a share (0–1)',
            percentAuto: 'Percentage (guessed)',
        };
        const formatOptions = (selected) => [...DashboardConfig.CUSTOM_FORMATS,
            ...(selected === 'percentAuto' ? ['percentAuto'] : [])].map((format) =>
            `<option value="${esc(format)}" ${format === selected ? 'selected' : ''}>${esc(
                this.t(`config.widgetFormat.${format}`, formatLabels[format] || format))}</option>`).join('');
        /*
         * The shapes this format can wear, which is all of them but the meter.
         *
         * Left out rather than greyed out: an option that cannot be chosen on
         * six formats out of seven is a question the reader has to answer every
         * time they look at the row, and the answer is always the same.
         */
        const shapeOptions = (format, selected) => DashboardConfig.shapesFor(format).map((shape) =>
            `<option value="${esc(shape)}" ${shape === selected ? 'selected' : ''}>${esc(
                this.t(`config.widgetShape.${shape}`, shape))}</option>`).join('');

        /*
         * How many decimal places, or "however this format writes it".
         *
         * Auto is first and is what every widget saved before this says, so
         * nothing changes underneath anyone. The rest are 0 to 3: past three the
         * digits are longer than the tile and further from what any service
         * reports honestly, and a tile is one figure rather than a column of
         * them to line up.
         */
        const decimalOptions = (selected) => {
            const chosen = Number.isInteger(selected) ? String(selected) : '';
            return ['', '0', '1', '2', '3'].map((value) =>
                `<option value="${value}" ${value === chosen ? 'selected' : ''}>${esc(value === ''
                    ? this.t('config.widgetDecimalsAuto', 'Auto')
                    : value)}</option>`).join('');
        };

        /*
         * Which unit a Data figure already counts in.
         *
         * In the same column as Decimals and shown instead of it, because they
         * are the same question asked of different formats -- "how should this
         * number be read" -- and a seventh column for a control that applies to
         * one format would cost every row the width.
         */
        const unitOptions = (selected) => {
            const chosen = DashboardConfig.CUSTOM_DATA_UNITS.includes(selected) ? selected : 'b';
            return DashboardConfig.CUSTOM_DATA_UNITS.map((unit) =>
                `<option value="${unit}" ${unit === chosen ? 'selected' : ''}>${esc(
                    this.t(`config.widgetDataUnit.${unit}`, unit.toUpperCase()))}</option>`).join('');
        };

        /*
         * A header row, because three unlabelled boxes side by side is a puzzle.
         *
         * Placeholders alone were not enough: they vanish the moment a row has
         * a value, and the second row then has nothing saying which box is the
         * path and which the label.
         */
        const head = fields.length ? `
                <div class="config-custom-head" aria-hidden="true">
                    <span>${esc(this.t('config.widgetCustomPath', 'Path'))}</span>
                    <span>${esc(this.t('config.widgetCustomLabel', 'Label'))}</span>
                    <span>${esc(this.t('config.widgetCustomFormat', 'Show as'))}</span>
                    <span>${esc(fields.every((f) => f?.format === 'data')
                        ? this.t('config.widgetCustomDataUnit', 'Counted in')
                        : this.t('config.widgetCustomDecimals', 'Decimals'))}</span>
                    <span>${esc(this.t('config.widgetCustomShape', 'Size'))}</span>
                    <span>${esc(this.t('config.widgetCustomFound', 'Found'))}</span>
                    <span></span>
                </div>` : '';

        const rows = fields.map((field, row) => `
            <div class="config-custom-field" data-custom-row="${row}">
                <input type="text" class="config-text" data-custom-field="path" data-custom-index="${index}"
                    data-custom-row="${row}" maxlength="200" value="${esc(field?.path || '')}"
                    placeholder="${esc(this.t('config.widgetCustomPathPlaceholder', 'server.recent[0].name'))}"
                    aria-label="${esc(this.t('config.widgetCustomPath', 'Path'))}">
                <input type="text" class="config-text" data-custom-field="label" data-custom-index="${index}"
                    data-custom-row="${row}" maxlength="60" value="${esc(field?.label || '')}"
                    placeholder="${esc(this.t('config.widgetCustomLabelPlaceholder', 'What to call it'))}"
                    aria-label="${esc(this.t('config.widgetCustomLabel', 'Label'))}">
                <select class="config-select" data-custom-field="format" data-custom-index="${index}"
                    data-custom-row="${row}"
                    aria-label="${esc(this.t('config.widgetCustomFormat', 'Show as'))}">${
                    formatOptions(field?.format || 'text')}</select>
                <select class="config-select" data-custom-field="dataUnit" data-custom-index="${index}"
                    data-custom-row="${row}" ${field?.format === 'data' ? '' : 'hidden'}
                    aria-label="${esc(this.t('config.widgetCustomDataUnit', 'Counted in'))}">${
                    unitOptions(field?.dataUnit)}</select>
                <select class="config-select" data-custom-field="decimals" data-custom-index="${index}"
                    data-custom-row="${row}" ${field?.format === 'data' ? 'hidden' : ''}
                    aria-label="${esc(this.t('config.widgetCustomDecimals', 'Decimals'))}">${
                    decimalOptions(field?.decimals)}</select>
                <select class="config-select" data-custom-field="shape" data-custom-index="${index}"
                    data-custom-row="${row}"
                    aria-label="${esc(this.t('config.widgetCustomShape', 'Size'))}">${
                    shapeOptions(field?.format || 'text', field?.shape || 'normal')}</select>
                ${this.renderFieldFound(widget, row)}
                <button type="button" class="config-btn config-btn--small config-btn--danger"
                    data-custom-remove="${row}" data-custom-index="${index}"
                    aria-label="${esc(this.t('config.widgetCustomRemoveField', 'Remove this figure'))}">${esc(
                    this.t('config.backupDelete', 'Delete'))}</button>
            </div>`).join('');

        return `
            <div class="config-custom-group">
                <h4 class="config-custom-group-title">${esc(this.t('config.widgetCustomFields',
                    'Figures to read'))}</h4>
                <p class="config-widget-note">${esc(this.t('config.widgetCustomFieldsNote',
                    'A path into the answer, what to call it, and how to show it. "server.disk[0].used" reads that one value.'))}</p>
                ${head}${rows || `<p class="config-widget-settings-empty">${esc(this.t(
                    'config.widgetCustomNoFields', 'No figures yet.'))}</p>`}
                <div>
                    <button type="button" class="config-btn config-btn--small" data-custom-add="${index}"
                        ${fields.length >= 8 ? 'disabled' : ''}>${esc(
                        this.t('config.widgetCustomAddField', 'Add a figure'))}</button>
                </div>
            </div>`;
    },

    /*
     * What one widget's trial runs have turned up so far.
     *
     * Keyed on the widget id, like the drafts and for the same reason: the
     * panel is redrawn by several paths and the index shifts when a block above
     * is removed. Held here rather than in the DOM so a repaint mid-watch
     * redraws the last answer instead of blanking it.
     */
    customProbeState(widgetId, { create = false } = {}) {
        if (!widgetId) return null;
        this._widgetProbes = this._widgetProbes || {};
        if (!this._widgetProbes[widgetId] && create) {
            this._widgetProbes[widgetId] = { every: DashboardConfig.CUSTOM_PROBE_DEFAULT };
        }
        return this._widgetProbes[widgetId] || null;
    },

    /**
     * The panel that asks the address and shows what came back.
     *
     * Below the figures rather than beside the address, because it is about
     * both: the answer is what a path is written against, and the two lists
     * only mean anything read together — figures all showing "—" say nothing
     * about why, and a document with no figures beside it leaves the reader
     * checking their own paths by eye.
     */
    renderCustomWidgetProbe(widget, index) {
        const esc = (v) => this.dash.escapeHtml(v);
        const state = this.customProbeState(widget?.id);
        const every = Number(state?.every) || DashboardConfig.CUSTOM_PROBE_DEFAULT;
        const intervals = DashboardConfig.CUSTOM_PROBE_INTERVALS.map((seconds) =>
            `<option value="${seconds}" ${seconds === every ? 'selected' : ''}>${esc(
                this.t('config.widgetCustomTestEverySeconds', '{n} s').replace('{n}', seconds))}</option>`).join('');
        return `
            <div class="config-custom-group">
                <h4 class="config-custom-group-title">${esc(this.t('config.widgetCustomTestTitle',
                    'Try it'))}</h4>
                <p class="config-widget-note">${esc(this.t('config.widgetCustomTestNote',
                    'Asks the address now, with whatever is in this panel, and shows what came back — so the paths above are written against the answer rather than guessed at. Nothing is saved by asking.'))}</p>
                <div class="config-custom-probe-bar">
                    <button type="button" class="config-btn config-btn--small" data-custom-test="${index}"
                        ${state?.busy ? 'disabled' : ''}>${esc(state?.busy
                            ? this.t('config.widgetCustomTestAsking', 'Asking…')
                            : this.t('config.widgetCustomTestRun', 'Ask now'))}</button>
                    <label class="config-toggle config-toggle--inline">
                        <input type="checkbox" data-custom-live="${index}" ${state?.live ? 'checked' : ''}>
                        <span>${esc(this.t('config.widgetCustomTestLive', 'Keep watching'))}</span>
                    </label>
                    <label class="config-custom-probe-every">
                        <span>${esc(this.t('config.widgetCustomTestEvery', 'Every'))}</span>
                        <select class="config-select" data-custom-live-every="${index}"
                            aria-label="${esc(this.t('config.widgetCustomTestEvery', 'Every'))}">${intervals}</select>
                    </label>
                </div>
                <div class="config-custom-probe" data-custom-probe="${esc(widget?.id || '')}">${
                    this.renderCustomProbeBody(widget, index)}</div>
            </div>`;
    },

    /** Everything below the buttons: the facts, the figures, the document. */
    renderCustomProbeBody(widget, index) {
        const esc = (v) => this.dash.escapeHtml(v);
        const state = this.customProbeState(widget?.id);
        const note = state?.note
            ? `<p class="config-probe-note">${esc(state.note)}</p>` : '';

        if (state?.failed) {
            return `${note}<p class="config-probe-error">${esc(state.failed)}</p>`;
        }
        const data = state?.data;
        if (!data) {
            return `${note}<p class="config-widget-settings-empty">${esc(state?.busy
                ? this.t('config.widgetCustomTestAsking', 'Asking…')
                : this.t('config.widgetCustomTestIdle', 'Nothing asked yet.'))}</p>`;
        }

        /*
         * The facts, as chips, because they are read at a glance and each one
         * answers a different question: was it asked at all, did the service
         * answer, how long did it take, and did a sign-in go with it. That last
         * is the difference between "the key is wrong" and "no key was sent",
         * which a 401 alone cannot tell anyone.
         */
        const chips = [];
        if (data.method) chips.push(data.method);
        if (data.host) chips.push(data.host);
        if (data.status) chips.push(String(data.status));
        if (data.tookMs != null) chips.push(`${Math.max(0, Math.round(data.tookMs))} ms`);
        if (data.bytes) chips.push(this.formatBytes(data.bytes));
        if (data.signedIn) chips.push(this.t('config.widgetCustomTestSignedIn', 'signed in'));
        if (state.at) chips.push(new Date(state.at).toLocaleTimeString());
        const facts = `<div class="config-probe-facts">${chips
            .map((chip) => `<span class="config-probe-chip">${esc(chip)}</span>`).join('')}</div>`;

        const error = data.error
            ? `<p class="config-probe-error">${esc(data.error)}</p>` : '';

        const values = Array.isArray(data.result?.values) ? data.result.values : [];
        const changed = state.changed || {};
        const figures = values.length ? `
            <div class="config-probe-block">
                <h5 class="config-probe-title">${esc(this.t('config.widgetCustomTestFigures',
                    'What the tile would show'))}</h5>
                <ul class="config-probe-values">${values.map((value, row) => `
                    <li class="config-probe-value${value.missing ? ' is-missing' : ''}${
                        changed[row] ? ' is-changed' : ''}">
                        <span class="config-probe-value-label">${esc(value.label || '')}</span>
                        <span class="config-probe-value-figure">${esc(value.value || '')}</span>
                        ${value.missing ? `<span class="config-probe-value-note">${esc(
                            this.t('config.widgetCustomTestMissing', 'that path found nothing'))}</span>` : ''}
                    </li>`).join('')}</ul>
            </div>` : '';

        const items = Array.isArray(data.result?.items) ? data.result.items : [];
        const list = items.length ? `
            <div class="config-probe-block">
                <h5 class="config-probe-title">${esc(this.t('config.widgetCustomTestItems',
                    'The list'))}</h5>
                <ul class="config-probe-items">${items
                    .map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
            </div>` : '';

        // The document itself, last and in full: it is the thing a path is
        // written against, and it is also the only part worth scrolling.
        /*
         * A search box over the document, once it is long enough to need one.
         *
         * A tile reads a figure or two, but the reader is looking for the one
         * key among however many the service sent -- and Home Assistant answers
         * /api/states with 489 entities in 211 KB, of which the panel shows the
         * first 16. Scrolling that is not finding anything; the entities the
         * reader came for are the ones past the cut, and the panel saying "the
         * first part is shown" is true and no help.
         *
         * Filtering happens over the whole body rather than the shown part, so
         * a key that was cut off is still findable -- which is the entire point.
         */
        const widgetId = widget?.id;
        const query = String(this.customProbeState(widgetId)?.find || '');
        // Always the same shape, so the template does not have to know whether
        // a search is running: reading .text off a bare string gave undefined,
        // and the document rendered empty until something was typed.
        const shown = this.filterProbeBody(data.body, query);
        const body = data.body
            ? `
            <div class="config-probe-block">
                <div class="config-probe-head">
                    <h5 class="config-probe-title">${esc(this.t('config.widgetCustomTestAnswer',
                        'What came back'))}</h5>
                    <input type="search" class="config-text config-probe-find"
                        data-custom-find="${esc(String(widgetId))}" value="${esc(query)}"
                        placeholder="${esc(this.t('config.widgetCustomTestFind', 'Find a key…'))}"
                        aria-label="${esc(this.t('config.widgetCustomTestFind', 'Find a key…'))}">
                </div>
                <pre class="config-probe-body" tabindex="0">${esc(shown.text)}</pre>
                ${shown.note ? `<p class="config-probe-note">${esc(shown.note)}</p>`
                    : (data.truncated ? `<p class="config-probe-note">${esc(this.t(
                        'config.widgetCustomTestTruncated',
                        'Long answer — the first part is shown.'))}</p>` : '')}
            </div>` : '';

        return `${note}${facts}${error}${figures}${list}${body}`;
    },

    /*
     * The lines of a document that mention what was typed, with their context.
     *
     * Lines rather than a highlight, because JSON is written one key to a line
     * and the answer to "where is my sensor" is that line and the few around
     * it. A match on its own would be a key with no value beside it.
     */
    filterProbeBody(text, query) {
        const needle = query.trim().toLowerCase();
        if (!needle) return { text, note: '' };
        const lines = String(text || '').split('\n');
        const keep = new Set();
        let hits = 0;
        lines.forEach((line, at) => {
            if (!line.toLowerCase().includes(needle)) return;
            hits += 1;
            // Two lines either side: enough to see which object a key sits in
            // without the result becoming the document again.
            for (let n = at - 2; n <= at + 2; n += 1) {
                if (n >= 0 && n < lines.length) keep.add(n);
            }
        });
        if (!hits) {
            return {
                text: '',
                note: this.t('config.widgetCustomTestNoMatch',
                    'Nothing in the answer matches “{q}”.').replace('{q}', query),
            };
        }
        const out = [];
        let previous = -1;
        [...keep].sort((a, b) => a - b).forEach((at) => {
            // A gap in the line numbers is a gap in the document, and saying so
            // beats running two unrelated objects together.
            if (previous >= 0 && at > previous + 1) out.push('  …');
            out.push(lines[at]);
            previous = at;
        });
        return {
            text: out.join('\n'),
            note: this.t('config.widgetCustomTestMatches',
                '{n} matching lines. Clear the box to see the whole answer.')
                .replace('{n}', String(hits)),
        };
    },

    /*
     * What the test should be asked with.
     *
     * The panel's own draft, so an address typed a moment ago is the one that
     * is tried -- testing what is stored would be testing the thing the reader
     * is in the middle of changing.
     *
     * The sign-in is the exception, and cannot be otherwise: secrets live in
     * their own file and never come back to the page, so only one already filed
     * can go out. The test names the entry this widget would name once saved,
     * and the answer says whether anything actually went with the request.
     */
    customTestPayload(index) {
        const block = (this._widgetBlocks || [])[index];
        const draft = this.widgetDraft(index, { create: false });
        const config = { ...(draft?.config || block?.config || {}) };
        const auth = draft?.auth || this.storedCredentialState(block);
        if (auth?.kind === 'shared') config.credentialId = auth.shared || '';
        else if (auth?.kind === 'header' || auth?.kind === 'basic' || auth?.kind === 'query'
            || auth?.kind === 'session') {
            config.credentialId = this.widgetCredentialId(block);
        } else config.credentialId = '';
        if (!config.credentialId) delete config.credentialId;
        // enabled is about the dashboard, not about the request.
        delete config.enabled;

        /*
         * The key as typed, when it has not been saved yet.
         *
         * credentialId above is a reference to what is *stored*, so a widget
         * being set up for the first time tested itself anonymously: the
         * service answered 401, which looks exactly like a wrong key -- the one
         * conclusion this panel exists to rule out. Sent alongside rather than
         * instead, so a panel whose key is already filed goes on naming it.
         *
         * Not saved by sending: the route uses it for that one request. Which
         * is what the panel already promises -- "nothing is saved by asking".
         */
        const secret = String(draft?.auth?.secret || '').trim();
        if (secret && !this.isSchemeOnly(secret)) {
            const kind = draft.auth.kind;
            if (kind === 'header' && draft.auth.headerName) {
                config.draftCredential = {
                    headers: { ...(draft.auth.fixedHeaders || {}), [draft.auth.headerName]: secret },
                };
            } else if (kind === 'query' && draft.auth.queryName) {
                config.draftCredential = {
                    query: { [draft.auth.queryName]: secret },
                    ...(draft.auth.fixedHeaders ? { headers: { ...draft.auth.fixedHeaders } } : {}),
                };
            } else if (kind === 'session') {
                const sessionShape = draft.auth.session || this.widgetPresetOf(block, index)?.session;
                if (sessionShape && (draft.auth.basicUser || this.sessionIsPasswordOnly(sessionShape))) {
                    config.draftCredential = {
                        session: {
                            ...sessionShape,
                            user: draft.auth.basicUser || '', password: secret,
                        },
                    };
                }
            } else if (kind === 'basic' && draft.auth.basicUser) {
                config.draftCredential = {
                    basicUser: draft.auth.basicUser, basicPassword: secret,
                };
            }
        }
        return config;
    },

    /*
     * What to say when nextDash itself would not answer.
     *
     * Each of these is a different thing for the reader to do, and the panel
     * saying "check your write token" over a rate limit or a refused address
     * sends them to look at something that is working.
     */
    customProbeFailure(status) {
        if (status === 401 || status === 403) {
            return this.t('config.widgetCustomTestUnauthorized',
                'nextDash refused the request. If this install uses a write token, check it is set.');
        }
        if (status === 429) {
            return this.t('config.widgetCustomTestRateLimited',
                'Too many requests in a row — wait a moment and ask again.');
        }
        if (status === 400) {
            return this.t('config.widgetCustomTestRejected',
                'This panel is not filled in enough to ask yet — check the address.');
        }
        if (status >= 500) {
            return this.t('config.widgetCustomTestServerError',
                'nextDash ran into an error trying to ask. The log will say more.');
        }
        return this.t('config.widgetCustomTestFailed',
            'nextDash itself could not be asked. If this install uses a write token, check it is set.');
    },

    /*
     * Which figures moved since the last answer.
     *
     * The point of watching something is seeing it change, and four numbers
     * refreshing in place look identical whether or not any of them did.
     * Compared by position rather than by label, because two figures may share
     * a label and the row is what is on screen.
     */
    customProbeChanges(before, after) {
        const previous = Array.isArray(before?.result?.values) ? before.result.values : null;
        const next = Array.isArray(after?.result?.values) ? after.result.values : [];
        if (!previous) return {};
        const changed = {};
        next.forEach((value, row) => {
            const was = previous[row];
            if (was && was.value !== value.value) changed[row] = true;
        });
        return changed;
    },

    /** Redraw one probe panel in place, leaving the rest of the tab alone. */
    paintCustomProbe(widgetId, index) {
        const host = document.querySelector(`[data-custom-probe="${CSS.escape(String(widgetId))}"]`);
        if (!host) return false;
        const block = (this._widgetBlocks || [])[index];
        host.innerHTML = this.renderCustomProbeBody(block || { id: widgetId }, index);
        const state = this.customProbeState(widgetId);
        const button = document.querySelector(`[data-custom-test="${index}"]`);
        if (button) {
            button.disabled = Boolean(state?.busy);
            button.textContent = state?.busy
                ? this.t('config.widgetCustomTestAsking', 'Asking…')
                : this.t('config.widgetCustomTestRun', 'Ask now');
        }
        return true;
    },

    /** Ask once, with what is on screen, and show what came back. */
    async runCustomWidgetTest(index) {
        const block = (this._widgetBlocks || [])[index];
        if (!block?.isWidget) return;
        const state = this.customProbeState(block.id, { create: true });
        if (state.busy) return;
        state.busy = true;
        state.failed = '';
        state.note = '';
        this.paintCustomProbe(block.id, index);
        try {
            const res = await this.writeFetch('/api/widgets/custom/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.customTestPayload(index)),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`, { cause: res.status });
            const data = await res.json();
            state.changed = this.customProbeChanges(state.data, data);
            state.data = data;
            state.at = Date.now();
            /*
             * The figures table shows what each path found, so it is stale the
             * moment a new answer lands. Redrawn here rather than left to the
             * next repaint: the reader pressed Ask now to see this.
             */
            this.repaintCustomFields(index);
        } catch (error) {
            /*
             * This one is nextDash refusing, not the service -- but which
             * refusal matters, and the message used to name a write token
             * whatever had gone wrong. An install with no token set was sent to
             * check a token it does not have, over a panel that had rejected
             * the request for some entirely different reason.
             *
             * So the status says what to say. Anything unrecognised keeps the
             * old wording, which is the honest answer when the answer is not
             * known: something between the panel and the server, and the token
             * is the one thing a reader can check.
             */
            const status = Number(error?.cause) || 0;
            state.failed = this.customProbeFailure(status);
            state.data = null;
            this.stopCustomProbeLive();
            this.syncCustomProbeControls(index);
        } finally {
            state.busy = false;
            this.paintCustomProbe(block.id, index);
        }
    },

    /** Start or stop watching one widget's address. */
    toggleCustomProbeLive(index, on) {
        const block = (this._widgetBlocks || [])[index];
        if (!block?.isWidget) return;
        const state = this.customProbeState(block.id, { create: true });
        // One at a time: two panels watching at once is two services being
        // asked on behalf of a reader who is looking at one of them.
        this.stopCustomProbeLive();
        if (!on) {
            this.paintCustomProbe(block.id, index);
            return;
        }
        state.live = true;
        state.note = '';
        state.liveUntil = Date.now() + DashboardConfig.CUSTOM_PROBE_MAX_MS;
        void this.customProbeTick(block.id);
    },

    /*
     * One beat of watching, and the next one booked after it lands.
     *
     * Chained rather than an interval, so a slow service is asked again a
     * moment after it answers instead of having a queue of requests stack up
     * behind it -- which is how a tile pointed at something struggling turns
     * into the reason it is struggling.
     */
    async customProbeTick(widgetId) {
        const state = this.customProbeState(widgetId);
        if (!state?.live) return;
        const index = (this._widgetBlocks || []).findIndex((block) => block?.id === widgetId);
        // The panel is gone: the section was closed, the page changed, the
        // widget was deleted. Whatever it was, nobody is looking.
        if (index < 0 || !document.querySelector(`[data-custom-probe="${CSS.escape(String(widgetId))}"]`)) {
            this.stopCustomProbeLive();
            return;
        }
        if (Date.now() > Number(state.liveUntil || 0)) {
            this.stopCustomProbeLive();
            state.note = this.t('config.widgetCustomTestLiveStopped',
                'Watching stopped after five minutes. Tick it again to carry on.');
            this.paintCustomProbe(widgetId, index);
            this.syncCustomProbeControls(index);
            return;
        }
        // A tab in the background asks nothing, exactly as the tile does not:
        // a config screen on a second monitor is not a reason to question
        // somebody's machine every five seconds.
        if (!document.hidden) await this.runCustomWidgetTest(index);
        if (!this.customProbeState(widgetId)?.live) return;
        const every = Math.max(DashboardConfig.CUSTOM_PROBE_INTERVALS[0],
            Number(state.every) || DashboardConfig.CUSTOM_PROBE_DEFAULT) * 1000;
        this._probeTimer = window.setTimeout(() => { void this.customProbeTick(widgetId); }, every);
    },

    /** Stop watching, whichever widget was being watched. */
    stopCustomProbeLive() {
        if (this._probeTimer) window.clearTimeout(this._probeTimer);
        this._probeTimer = null;
        Object.values(this._widgetProbes || {}).forEach((state) => { state.live = false; });
    },

    /** Put the box back up when watching stopped on its own. */
    syncCustomProbeControls(index) {
        const box = document.querySelector(`[data-custom-live="${index}"]`);
        if (box) box.checked = false;
    },

    /** Fetch the credential names once, so a picker can offer them. */
    async loadCredentialNames() {
        // Details too: Health loads the names alone, and with those cached a
        // widget's own key read as "none" here and Save deleted it.
        if (this.dash.healthCredentials && this.dash.healthCredentialDetails) return this.dash.healthCredentials;
        try {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/health/credentials');
            if (!res.ok) return {};
            const data = await res.json();
            this.dash.healthCredentials = data?.credentials || {};
            // Names are enough for a dropdown; the widget's own sign-in block
            // needs to know what an entry actually holds, so it can say "an
            // X-Api-Key is set" rather than showing an empty box over a key
            // that is very much there.
            this.dash.healthCredentialDetails = data?.details || {};
        } catch (_error) {
            this.dash.healthCredentials = {};
            this.dash.healthCredentialDetails = {};
        }
        // Redrawn once they arrive: the panel is built synchronously and would
        // otherwise offer an empty picker until something else repainted it.
        if (this.section === 'widgets') this.repaintWidgetsBody();
        return this.dash.healthCredentials;
    },

    /** The settings panel for one widget, drawn from WIDGET_SETTINGS. */
    /*
     * The ℹ beside a widget setting, on every kind of field.
     *
     * It was built for the number fields alone, so a choice or a tickbox that
     * needed a paragraph had nowhere to put one -- and the same dialog every
     * other setting in config uses was sitting there unused. Only drawn where
     * there is text behind it: a row of ℹ buttons opening empty dialogs is a
     * mistake this codebase has already made once.
     */
    widgetFieldInfoButton(field, index) {
        const esc = (v) => this.dash.escapeHtml(v);
        if (!field?.info || !this.hasInfoText(field.info)) return '';
        return `<button type="button" class="config-info-btn" data-widget-info="${esc(field.key)}"
            data-widget-index="${index}"
            aria-label="${esc(this.t('config.settingInfoAria', 'More info'))}"
            title="${esc(this.t('config.settingInfoAria', 'More info'))}">ℹ</button>`;
    },

    renderWidgetSettings(stored, index) {
        const esc = (v) => this.dash.escapeHtml(v);
        const fields = DashboardConfig.WIDGET_SETTINGS[stored.type] || [];
        // No early return for a type with no fields of its own: width applies to
        // every widget, so the panel is never empty.

        /*
         * Drawn from the draft, not from what is stored.
         *
         * A shadow of the block with the draft's config on it, so every
         * render* below keeps reading `widget.config` and none of them has to
         * know a draft exists.
         */
        const draft = this.widgetDraft(index);
        const widget = { ...stored, config: draft?.config || stored.config || {} };
        const config = widget.config || {};
        const rows = fields.map((field) => {
            const label = esc(this.t(field.label[0], field.label[1]));
            const id = `widget-${index}-${esc(field.key)}`;
            if (field.kind === 'bool') {
                return `
                    <label class="config-toggle config-toggle--inline">
                        <input type="checkbox" id="${id}" data-widget-setting="${esc(field.key)}"
                            data-widget-index="${index}" data-widget-kind="bool"
                            ${(field.defaultOn ? config[field.key] !== false : Boolean(config[field.key])) ? 'checked' : ''}>
                        <span>${label}${this.widgetFieldInfoButton(field, index)}</span>
                    </label>`;
            }
            if (field.kind === 'int') {
                /*
                 * The bounds were on the input and nowhere a reader looks.
                 *
                 * Someone testing the refresh typed 5, the server brought it up
                 * to 30, and with the range unwritten there was no way to know
                 * that had happened or why. So the field says what it takes,
                 * and where the choice needs more than a line, an ℹ opens the
                 * same dialog every other setting in config uses.
                 */
                const hint = field.hint ? this.t(field.hint[0], field.hint[1]) : '';
                const info = this.widgetFieldInfoButton(field, index);
                return `
                    <div class="config-widget-field">
                        <label for="${id}">${label}${info}</label>
                        <input type="number" id="${id}" class="config-text config-text--number"
                            data-widget-setting="${esc(field.key)}" data-widget-index="${index}"
                            data-widget-kind="int" min="${field.min}" max="${field.max}"
                            value="${esc(config[field.key] ?? '')}"
                            placeholder="${esc(this.t('config.widgetDefault', 'Default'))}">
                        ${hint ? `<p class="config-widget-field-hint" data-widget-field-hint="${esc(field.key)}">${esc(hint)}</p>` : ''}
                    </div>`;
            }
            if (field.kind === 'choice') {
                /*
                 * A named choice from a short list, written into the draft as
                 * text -- which is what it is, and means updateWidgetDraft
                 * needs nothing new to read it.
                 */
                const hint = field.hint ? this.t(field.hint[0], field.hint[1]) : '';
                const current = String(config[field.key] || field.options[0][0]);
                const choices = field.options.map(([value, text]) =>
                    `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${
                        esc(this.t(text[0], text[1]))}</option>`).join('');
                return `
                    <div class="config-widget-field">
                        <label for="${id}">${label}${this.widgetFieldInfoButton(field, index)}</label>
                        <select id="${id}" class="config-select" data-widget-setting="${esc(field.key)}"
                            data-widget-index="${index}" data-widget-kind="text">${choices}</select>
                        ${hint ? `<p class="config-widget-field-hint">${esc(hint)}</p>` : ''}
                    </div>`;
            }
            if (field.kind === 'text') {
                const placeholder = field.placeholder ? this.t(field.placeholder[0], field.placeholder[1]) : '';
                return `
                    <div class="config-widget-field">
                        <label for="${id}">${label}${this.widgetFieldInfoButton(field, index)}</label>
                        <input type="text" id="${id}" class="config-text"
                            data-widget-setting="${esc(field.key)}" data-widget-index="${index}"
                            data-widget-kind="text" maxlength="${field.maxlength || 200}"
                            value="${esc(config[field.key] ?? '')}" placeholder="${esc(placeholder)}">
                    </div>`;
            }
            /*
             * A list of addresses, one per line.
             *
             * Not the tags box: that is one comma-separated line capped at 400
             * characters, which is a sentence's worth of tags and nowhere near
             * a handful of feed addresses -- and a comma is legal inside a URL,
             * so splitting on it would quietly cut one in half.
             */
            if (field.kind === 'urlList') {
                const lines = Array.isArray(config[field.key]) ? config[field.key].join('\n') : '';
                const hint = field.hint ? this.t(field.hint[0], field.hint[1]) : '';
                return `
                    <div class="config-widget-field">
                        <label for="${id}">${label}${this.widgetFieldInfoButton(field, index)}</label>
                        <textarea id="${id}" class="config-text config-widget-urls" rows="4"
                            data-widget-setting="${esc(field.key)}" data-widget-index="${index}"
                            data-widget-kind="urlList"
                            placeholder="${esc(this.t('config.widgetFeedUrlsPlaceholder',
                                'https://example.com/feed.xml'))}">${esc(lines)}</textarea>
                        ${hint ? `<p class="config-widget-field-hint">${esc(hint)}</p>` : ''}
                    </div>`;
            }
            if (field.kind === 'tags') {
                const value = Array.isArray(config[field.key]) ? config[field.key].join(', ') : '';
                // A field whose values are discoverable offers them: the disks
                // this machine actually has, filled in after they are fetched.
                const suggestions = field.suggest
                    ? `<div class="config-widget-suggest" data-widget-suggest="${esc(field.suggest)}"
                            data-widget-suggest-index="${index}"
                            data-widget-suggest-key="${esc(field.key)}"></div>`
                    : '';
                return `
                    <div class="config-widget-field">
                        <label for="${id}">${label}${this.widgetFieldInfoButton(field, index)}</label>
                        <input type="text" id="${id}" class="config-text"
                            data-widget-setting="${esc(field.key)}" data-widget-index="${index}"
                            data-widget-kind="tags" maxlength="400" value="${esc(value)}"
                            placeholder="${esc(this.t('config.widgetTagsPlaceholder', 'Any tag'))}">
                        ${suggestions}
                    </div>`;
            }
            // checkset: an absent list means all, which is the default for the
            // health widget's figures and reads better than every box ticked.
            const chosen = Array.isArray(config[field.key]) ? config[field.key] : null;
            const boxes = (field.options || []).map(([value, text]) => `
                <label class="config-toggle config-toggle--inline">
                    <input type="checkbox" data-widget-setting="${esc(field.key)}"
                        data-widget-index="${index}" data-widget-kind="checkset"
                        value="${esc(value)}" ${!chosen || chosen.includes(value) ? 'checked' : ''}>
                    <span>${esc(this.t(text[0], text[1]))}</span>
                </label>`).join('');
            return `
                <div class="config-widget-field">
                    <span class="config-widget-field-label">${label}${
                        this.widgetFieldInfoButton(field, index)}</span>
                    <div class="config-widget-checkset">${boxes}</div>
                </div>`;
        }).join('');
        if (widget.type === 'custom') {
            /*
             * Two groups rather than one grid of six unrelated boxes.
             *
             * Where to read from and what to show are different questions, and
             * a flat panel made the address, the credential and a dotted path
             * read as equally weighted neighbours. The figures need the full
             * width regardless: their rows are four controls wide, and in a
             * third of the panel they overlapped each other.
             */
            return `<div class="config-widget-settings-body is-custom">
                ${this.renderWidgetPresets(widget, index)}
                <div class="config-custom-group">
                    <h4 class="config-custom-group-title">${esc(this.t('config.widgetCustomSource',
                        'Where to read from'))}</h4>
                    <div class="config-custom-grid">${rows}</div>
                    ${this.renderAddressPlaceholderNote(widget, index)}
                    ${this.renderWidgetCredential(widget, index)}
                </div>
                ${this.renderCustomWidgetFields(widget, index)}
                ${this.renderCustomWidgetProbe(widget, index)}
                <div class="config-custom-group">
                    <h4 class="config-custom-group-title">${esc(this.t('config.widgetCustomOnTheGrid',
                        'On the dashboard'))}</h4>
                    <div class="config-custom-grid">${this.renderWidgetPage(widget, index)}${
                        this.renderWidgetWidth(widget, index)}</div>
                </div>
                ${this.renderWidgetSaveBar(index)}
            </div>`;
        }
        /*
         * The setup note sits outside the settings grid rather than in it.
         *
         * The grid is auto-fit, so its track count is implicit and
         * `grid-column: 1 / -1` cannot reliably claim the full row -- in Safari
         * the note landed as one narrow column beside Width and Refresh, with
         * the lines to copy wrapped down a strip. Above the grid it is simply a
         * block, and needs nothing from the layout to be readable.
         */
        return `${this.renderWidgetSetupNote(widget.type)}<div class="config-widget-settings-body">${
            this.renderWidgetPage(widget, index)}${this.renderWidgetWidth(widget, index)}${rows}${
            this.renderWidgetSaveBar(index)}</div>`;
    },

    /*
     * Which page the widget stands on, for every type.
     *
     * Not part of the draft: a widget lives in its page's file, so changing
     * this is a move between two files rather than a setting Save writes. It
     * goes through the same move the bulk bar uses, and happens on change.
     */
    renderWidgetPage(widget, index) {
        const esc = (v) => this.dash.escapeHtml(v);
        const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
        if (pages.length < 2) return '';
        const current = Number(this.isAllPagesView() ? widget.pageId : this._widgetPageId);
        const id = `widget-${index}-page`;
        const options = pages.map((page) =>
            `<option value="${esc(page.id)}" ${Number(page.id) === current ? 'selected' : ''}>${
                esc(page.name || page.id)}</option>`).join('');
        return `
            <div class="config-widget-field">
                <label for="${id}">${esc(this.t('config.widgetsPageLabel', 'Page'))}</label>
                <select id="${id}" class="config-select" data-widget-move-page="${index}"
                    data-widget-current-page="${esc(current)}">${options}</select>
                <span class="config-widget-note">${esc(this.t('config.widgetPageNote',
                    'Choosing another page moves the widget there straight away, at the end of that page.'))}</span>
            </div>`;
    },

    /*
     * What this widget needs from the host before it can say anything.
     *
     * The system tiles read the machine nextDash runs on, which a container
     * only reaches through mounts somebody has to add. The tile itself says
     * when one is missing, but by then the reader is on the dashboard and the
     * lines to copy are in a manual -- so they belong here, beside the settings,
     * where somebody deciding to use the widget is already looking.
     *
     * Types with nothing to set up render nothing at all.
     */
    /*
     * Fill in the disks this machine has, under the field that names them.
     *
     * Asked for once per panel and after the markup is on the page, because the
     * answer needs a syscall per mount and the panel should not wait on it: the
     * field works typed by hand either way, and the chips are a shortcut rather
     * than the only way in.
     */
    async fillWidgetSuggestions(root) {
        const boxes = [...(root || document).querySelectorAll('[data-widget-suggest="mounts"]')];
        if (!boxes.length) return;

        let mounts = this._mountCandidates;
        if (!mounts) {
            try {
                const res = await fetch('/api/system/mounts');
                mounts = res.ok ? (await res.json()).mounts || [] : [];
            } catch (_error) {
                mounts = [];
            }
            this._mountCandidates = mounts;
        }

        const esc = (v) => this.dash.escapeHtml(v);
        const bytes = (n) => window.NextDashBytes.formatBytes(n);

        boxes.forEach((box) => {
            if (!mounts.length) {
                // Nothing to offer is not a failure: on a machine with no
                // mount table, or none reachable, typing still works.
                box.innerHTML = `<p class="config-field-hint">${esc(this.t(
                    'config.widgetDisksNoneFound',
                    'No disks found to offer — type a path, or check the mount above.'))}</p>`;
                return;
            }
            const chips = mounts.map((m) => {
                const size = m.totalBytes
                    ? ` <span class="config-widget-chip-size">${esc(bytes(m.freeBytes))} ${esc(this.t(
                        'config.widgetDisksChipFree', 'free'))}</span>`
                    : '';
                return `<button type="button" class="config-widget-chip"
                    data-widget-suggest-add="${esc(m.path)}"
                    title="${esc(m.fsType || '')}">${esc(m.path)}${size}</button>`;
            }).join('');
            box.innerHTML = `<p class="config-field-hint">${esc(this.t(
                'config.widgetDisksFound', 'On this machine:'))}</p>
                <div class="config-widget-chips">${chips}</div>`;
        });
    },

    /*
     * Add a disk the reader clicked, without losing what they typed.
     *
     * Appends rather than replaces, and refuses a duplicate: the chips are a
     * shortcut into the same field, not a second way of holding the value.
     */
    addSuggestedMount(button) {
        const box = button.closest('[data-widget-suggest]');
        const field = box?.parentElement?.querySelector('input[data-widget-kind="tags"]');
        if (!field) return;

        const path = button.getAttribute('data-widget-suggest-add') || '';
        const current = field.value.split(',').map((v) => v.trim()).filter(Boolean);
        if (current.includes(path)) return;

        current.push(path);
        field.value = current.join(', ');
        // Through the field's own event, so the draft records it exactly as a
        // typed edit would.
        field.dispatchEvent(new Event('input', { bubbles: true }));
    },

    renderWidgetSetupNote(type) {
        const esc = (v) => this.dash.escapeHtml(v);
        const notes = {
            disks: {
                lead: ['config.widgetDisksSetupLead',
                    'Running nextDash in Docker? A container can only measure what is '
                    + 'mounted into it, so add the disks you want to watch and point '
                    + 'NEXTDASH_HOST_ROOT at them, then recreate the container.'],
                lines: [
                    'volumes:',
                    '  - /mnt:/host/root/mnt:ro,rslave',
                    'environment:',
                    '  - NEXTDASH_HOST_ROOT=/host/root',
                ],
                tail: ['config.widgetDisksSetupTail',
                    'Then name the disks above as this machine knows them — /mnt/user, '
                    + '/mnt/cache — not as the container sees them. On Unraid that is one '
                    + 'Path row (/mnt to /host/mnt, Read Only) and one Variable row in the '
                    + 'container template; mount / instead of /mnt to reach disks outside '
                    + 'the array. Running the binary directly needs nothing.'],
            },
            docker: {
                lead: ['config.widgetDockerSetupLead',
                    'This one needs the Docker socket, and that is a real grant: read-only '
                    + 'still exposes the daemon\u2019s whole read API \u2014 every container, its '
                    + 'image, its environment, its mounts. Add it only if you are content '
                    + 'with that for a container count.'],
                lines: [
                    'volumes:',
                    '  - /var/run/docker.sock:/var/run/docker.sock:ro',
                    'environment:',
                    '  - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock',
                ],
                tail: ['config.widgetDockerSetupTail',
                    'On Unraid that is one Path row (/var/run/docker.sock, Read Only) and one '
                    + 'Variable row. Docker Desktop keeps its socket elsewhere \u2014 run '
                    + '"docker context ls" to find it. If the grant is more than you want, put '
                    + 'a socket proxy in front and point this at that instead.'],
            },
            memory: {
                lead: ['config.widgetMemorySetupLead',
                    'This reads the machine, not the container. /proc/meminfo is not '
                    + 'namespaced, so a container sees the whole host — even one started '
                    + 'with a memory limit reports the full amount, because that limit '
                    + 'lives in cgroups, which this does not read.'],
                lines: [
                    'volumes:',
                    '  - /proc:/host/proc:ro',
                    'environment:',
                    '  - NEXTDASH_HOST_PROC=/host/proc',
                ],
                tail: ['config.widgetMemorySetupTail',
                    'So on a NAS or a Linux server nothing needs adding, and the mount below '
                    + 'only makes explicit which /proc is read. On Docker Desktop for Mac or '
                    + 'Windows the figures are its Linux VM, not your computer — a 24 GB '
                    + 'laptop shows the VM\u2019s 8 GB, and no mount changes that, because the '
                    + 'VM cannot see the memory outside it. On Unraid, one Path row (/proc to '
                    + '/host/proc, Read Only) and one Variable row.'],
            },
            cpu: {
                lead: ['config.widgetCpuSetupLead',
                    'This reads the machine, not the container. /proc/stat is not '
                    + 'namespaced, so a container already counts the host\u2019s processor — '
                    + 'even one started with a CPU limit, because that limit lives in '
                    + 'cgroups, which this does not read.'],
                lines: [
                    'volumes:',
                    '  - /proc:/host/proc:ro',
                    'environment:',
                    '  - NEXTDASH_HOST_PROC=/host/proc',
                ],
                tail: ['config.widgetCpuSetupTail',
                    'So on a NAS or a Linux server nothing needs adding, and the mount below '
                    + 'only makes explicit which /proc is read \u2014 on Unraid, one Path row '
                    + '(/proc to /host/proc, Read Only) and one Variable row. On Docker Desktop '
                    + 'for Mac or Windows the figures come from its Linux VM; it is usually '
                    + 'given every core, so the processor reads true even there. Running the '
                    + 'binary directly needs nothing at all.'],
            },
        };
        notes.containers = notes.docker;
        const note = notes[type];
        if (!note) return '';
        return `
            <details class="config-widget-setup">
                <summary>${esc(this.t('config.widgetSetupTitle', 'Setting this up'))}</summary>
                <p class="config-field-hint">${esc(this.t(note.lead[0], note.lead[1]))}</p>
                <pre class="config-widget-setup-code"><code>${esc(note.lines.join('\n'))}</code></pre>
                <p class="config-field-hint">${esc(this.t(note.tail[0], note.tail[1]))}</p>
            </details>`;
    },

    /*
     * Everything back to how it arrived.
     *
     * Offered only when something is off its default, the rule the reset
     * follows everywhere else in config: a permanent button that usually does
     * nothing teaches people to ignore it.
     *
     * It clears the fields into the draft rather than writing, so the panel's
     * own Save or Discard still decides -- a misclick costs a click, not a
     * widget. The title and the Shown box are deliberately untouched: those
     * are not settings with defaults, and quietly renaming or hiding a widget
     * is not what "reset to default" should mean.
     */
    renderWidgetResetButton(index) {
        const esc = (v) => this.dash.escapeHtml(v);
        if (!this.widgetHasNonDefaultSettings(index)) return '';
        return `<button type="button" class="config-reset-btn is-visible" data-widget-reset="${index}"
            aria-label="${esc(this.t('config.widgetResetAria', 'Reset this widget to its defaults'))}"
            title="${esc(this.t('config.widgetResetTitle', 'Reset to default'))}">↺</button>`;
    },

    /** Whether this widget holds any setting that is not simply the default. */
    widgetHasNonDefaultSettings(index) {
        const block = (this._widgetBlocks || [])[index];
        if (!block?.isWidget) return false;
        const draft = this.widgetDraft(index);
        const config = draft?.config || block.config || {};
        // enabled is the Shown box, which this never touches.
        return Object.keys(config).some((key) => key !== 'enabled' && config[key] !== undefined);
    },

    /*
     * Clear this widget's settings back to their defaults, in the draft.
     *
     * Absent is exactly how the server stores a default, so emptying the map is
     * the whole operation -- there is no second notion of "the default value"
     * that could drift away from what the server would do with a missing key.
     */
    resetWidgetToDefaults(index) {
        const block = (this._widgetBlocks || [])[index];
        if (!block?.isWidget) return;
        const draft = this.widgetDraft(index, { create: true });
        if (!draft) return;

        const enabled = (draft.config || block.config || {}).enabled;
        draft.config = enabled === undefined ? {} : { enabled };
        this._widgetJustSaved = null;
        this.repaintWidgetsBody();
        this.notify(this.t('config.widgetResetNotice',
            'Settings back to their defaults — Save to keep this.'), 'info');
    },

    /*
     * One Save for the whole panel, and a Revert beside it.
     *
     * Every setting here is written by the same button, including the sign-in
     * -- even though that one lands in a different file. Two buttons would ask
     * the reader to know which control belongs to which store, which is a
     * detail of where things are kept and not a question anybody came here to
     * answer.
     *
     * The state line is the point: a panel that saves silently cannot tell the
     * difference between "written" and "ignored", and that is exactly the
     * failure this replaced.
     */
    renderWidgetSaveBar(index) {
        const esc = (v) => this.dash.escapeHtml(v);
        const dirty = this.widgetDraftDirty(index);
        const saved = this._widgetJustSaved === index;
        return `
            <div class="config-widget-savebar${dirty ? ' is-dirty' : ''}">
                <button type="button" class="config-btn config-btn--primary"
                    data-widget-save="${index}" ${dirty ? '' : 'disabled'}>${esc(
                    this.t('config.widgetSave', 'Save changes'))}</button>
                <button type="button" class="config-btn config-btn--small"
                    data-widget-revert="${index}" ${dirty ? '' : 'disabled'}>${esc(
                    this.t('config.widgetRevert', 'Discard'))}</button>
                ${this.renderWidgetResetButton(index)}
                <span class="config-widget-savebar-state" data-widget-save-state>${esc(
                    dirty ? this.t('config.widgetUnsaved', 'Not saved yet')
                    : saved ? this.t('config.widgetSaved', 'Saved.')
                    : '')}</span>
            </div>`;
    },

    /**
     * How wide the widget is drawn, for every type.
     *
     * Outside WIDGET_SETTINGS for the same reason the shown toggle is: it
     * belongs to every widget, and declaring it eight times would be eight
     * copies of one line. Two is the ceiling — a widget is a summary, and one
     * needing three columns is a view that has not admitted it yet.
     */
    renderWidgetWidth(widget, index) {
        const esc = (v) => this.dash.escapeHtml(v);
        const current = Number(widget?.config?.columns) === 2 ? 2 : 1;
        const id = `widget-${index}-columns`;
        const option = (value, key, fallback) =>
            `<option value="${value}" ${current === value ? 'selected' : ''}>${esc(this.t(key, fallback))}</option>`;
        // Drawn beside the choice, because the question is not how big the
        // widget is but what it does to the blocks next to it — and that is a
        // shape rather than a number.
        const art = window.SettingArt?.render?.('widgetSpan', current) || '';
        return `
            <div class="config-widget-field">
                <label for="${id}">${esc(this.t('config.widgetColumns', 'Width'))}</label>
                <span class="config-widget-choice">
                    <select id="${id}" class="config-select" data-widget-setting="columns"
                        data-widget-index="${index}" data-widget-kind="int">
                        ${option(1, 'config.widgetColumnsOne', 'One column')}
                        ${option(2, 'config.widgetColumnsTwo', 'Two columns')}
                    </select>
                    ${art}
                </span>
                <span class="config-widget-note">${esc(this.t('config.widgetColumnsNote',
                    'A dashboard showing one column draws the widget in that one column.'))}</span>
            </div>`;
    },

    /**
     * One line on what a widget puts on the dashboard.
     *
     * Beside the name rather than behind a help icon: eight types is past the
     * point where the names carry themselves, and "Neglected" or "Trend" says
     * nothing about what lands on the grid.
     */
    widgetTypeAbout(type) {
        const key = `config.widgetAbout.${type}`;
        const fallbacks = {
            docker: 'How many containers run, how many do not, and which have a failing healthcheck.',
            containers: 'Your containers by name — what needs you first, and how long each has run.',
            memory: 'How much memory is really in use, with the file cache counted as the spare room it is.',
            disks: 'How full each disk is, and how much room is actually left on it.',
            cpu: 'How hard the processor is working, and whether work is queueing up behind it.',
            health: 'How many bookmarks are broken, down, changed or fine — each figure opens its own filter.',
            uptime: 'The bookmarks you monitor, worst first, with uptime over the last week.',
            certs: 'Certificates about to expire, grouped by host rather than by bookmark.',
            trend: 'The health view\'s summary: the score and its direction over time, what is broken, and the monitors\' last day.',
            inbox: 'How much is waiting to be filed, and how long the oldest has waited.',
            unsorted: 'Bookmarks kept from the inbox without picking a category — most recent, at random, or by tag.',
            feeds: 'Feeds with new items, and the ones that stopped after repeated failures.',
            sources: 'What each import last did, so a failed import is not only visible in config.',
            neglected: 'Bookmarks you have not opened in a long time — the graveyard question in reverse.',
            archive: 'How many bookmarks have a copy kept, and which broken ones have none.',
            unchecked: 'The blind spots: never checked, checked long ago, or not watched at all.',
            duplicates: 'The same address stored more than once, and how many copies could go.',
            trash: 'What is waiting in the trash, and when retention removes it for good.',
            backups: 'How old the newest automatic backup is, and whether the last run failed.',
            custom: 'Any figure out of any JSON endpoint — for the service that has no widget of its own.',
            weather: 'Current conditions beside a forecast, for the location the header already reads.',
            calendar: 'What is coming up, from the ICS feed set in Appearance → Date & weather.',
            rss: 'The latest articles from the feeds you give it — headlines, with the whole entry on hover.',
            notes: 'A few lines of your own, with checkboxes for the ones that are tasks.',
            unraid: 'The Unraid server at a glance: array, parity, disks, alerts, VMs and the UPS, a line each.',
            unraidArray: 'Every disk of the Unraid array: how full, how warm, and which one is in trouble.',
            unraidParity: 'The last parity check, or the one running now, with its history when wide.',
            unraidShares: 'The Unraid shares, fullest first.',
            unraidVms: 'Which virtual machines on the Unraid server run, and which are stopped or paused.',
            unraidUps: 'The UPS behind the Unraid server: charge, runtime and load.',
            unraidNotifications: "Unraid's unread notifications, newest first.",
        };
        const label = this.dash.language?.t?.(key);
        return label && label !== key ? label : (fallbacks[type] || '');
    },

    /*
     * Read the page's blocks and lay them out as one list.
     *
     * Widgets and categories together, in blockOrder, because that is the order
     * being edited. Two lists side by side would make "up" ambiguous.
     */
    async loadWidgetsEditor() {
        const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
        if (this._widgetPageId === WIDGETS_ALL_PAGES) return this.loadAllPageWidgets(pages);
        const pageId = this._widgetPageId != null ? this._widgetPageId : (this.dash.currentPageId ?? pages[0]?.id);
        if (!pageId) return;
        this._widgetPageId = Number(pageId);

        /*
         * Already loaded for this page: do not refetch and repaint.
         *
         * The repaint at the end of this rebinds the tab, which calls this
         * again -- so without the guard it is an endless loop that detaches
         * every control on the tab before a click can land on it. The
         * categories editor beside this one carries the same guard for the same
         * reason.
         */
        if (this._widgetBlocks != null && this._widgetLoadedFor === this._widgetPageId) return;

        try {
            const [blocksRes, catsRes] = await Promise.all([
                this.writeFetch(`/api/pages/${this._widgetPageId}/blocks`),
                fetch(`/api/categories?page=${this._widgetPageId}`),
            ]);
            if (!blocksRes.ok) throw new Error(`HTTP ${blocksRes.status}`);
            const blocks = await blocksRes.json();
            const categories = catsRes.ok ? await catsRes.json() : [];

            const widgetById = new Map((blocks.widgets || []).map((w) => [w.id, w]));
            const categoryById = new Map((categories || []).map((c) => [String(c.id), c]));

            this._widgetOrder = blocks.order || [];
            this._widgetBlocks = (blocks.order || []).map((id) => {
                const widget = widgetById.get(id);
                if (widget) {
                    return { id, isWidget: true, type: widget.type, title: widget.title || '', config: widget.config || {} };
                }
                const category = categoryById.get(String(id));
                return { id, isWidget: false, name: category?.name || id };
            });
        } catch {
            this._widgetBlocks = [];
            this._widgetOrder = [];
        }
        this._widgetLoadedFor = this._widgetPageId;
        this.repaintWidgetsBody();
    },

    /*
     * Every widget on every page, in one list.
     *
     * A reader with four pages had to visit four tabs to answer "what have I
     * actually got", and a widget on the page you are not looking at is the
     * one you forget you are paying for. Each block remembers the page it came
     * from, because a save writes one page at a time and this view spans them.
     *
     * The categories are left out here: they only mean something beside the
     * widgets of their own page, and this list is not an order to rearrange.
     */
    async loadAllPageWidgets(pages) {
        if (this._widgetBlocks != null && this._widgetLoadedFor === WIDGETS_ALL_PAGES) return;

        const blocks = [];
        try {
            const answers = await Promise.all(pages.map(async (page) => {
                const res = await this.writeFetch(`/api/pages/${page.id}/blocks`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return { page, data: await res.json() };
            }));

            answers.forEach(({ page, data }) => {
                const byId = new Map((data.widgets || []).map((w) => [w.id, w]));
                // In the page's own order, so the list reads the way each page
                // is actually arranged rather than by whatever the API returns.
                (data.order || []).forEach((id) => {
                    const widget = byId.get(id);
                    if (!widget) return;
                    blocks.push({
                        id,
                        isWidget: true,
                        type: widget.type,
                        title: widget.title || '',
                        config: widget.config || {},
                        pageId: Number(page.id),
                        pageName: page.name || String(page.id),
                    });
                });
            });
            this._widgetBlocks = blocks;
            this._widgetOrder = blocks.map((b) => b.id);
        } catch {
            this._widgetBlocks = [];
            this._widgetOrder = [];
        }
        this._widgetLoadedFor = WIDGETS_ALL_PAGES;
        this.repaintWidgetsBody();
    },

    /** Whether the tab is showing every page at once. */
    isAllPagesView() {
        return this._widgetPageId === WIDGETS_ALL_PAGES;
    },

    /*
     * Every control on this tab, through one listener per event type.
     *
     * Delegated rather than bound per element, because the panel is redrawn by
     * several paths -- opening a widget's settings, a preset landing, the
     * credential names arriving from their own fetch -- and a listener bound to
     * an input does not survive its element being replaced. Whichever paint
     * lands last then leaves controls nothing is listening to, and that failure
     * is silent: typing works, the value is simply never read, so a setting
     * looks accepted and is gone on the next load.
     *
     * The body element is never replaced, only its innerHTML, so listeners
     * there outlive every repaint. The guard stops a second call from stacking
     * a duplicate, which would act twice on one click.
     */
    bindWidgetsEditor(container) {
        const body = document.getElementById('config-widgets-body') || container;
        if (!body || body.dataset.widgetsDelegated === 'true') return;
        body.dataset.widgetsDelegated = 'true';

        const indexOn = (el, attr) => Number(el.getAttribute(attr));

        body.addEventListener('click', (event) => {
            const target = event.target;
            if (!target?.closest) return;

            // The ℹ beside a widget setting, opening the same dialog every
            // other setting in config uses. Checked before the catalogue so a
            // click on it is never read as something else.
            const info = target.closest('[data-widget-info]');
            if (info) {
                event.preventDefault();
                this.openWidgetFieldInfo(info.getAttribute('data-widget-info'));
                return;
            }

            const catalogue = target.closest('[data-widget-catalogue]');
            if (catalogue) { this.openWidgetCatalogue(); return; }

            const add = target.closest('[data-widget-add]');
            if (add) {
                // The kind is on the control that was clicked -- a card in the
                // catalogue overlay, or a row on the Types tab. It used to be
                // read from a dropdown beside a single Add button, which is
                // what made choosing and adding two steps instead of one.
                void this.addWidget(add.getAttribute('data-widget-add') || 'health');
                return;
            }

            const remove = target.closest('[data-widget-delete]');
            if (remove) { void this.deleteWidget(indexOn(remove, 'data-widget-delete')); return; }

            /*
             * Opening the settings redraws the tab, so which row is open is
             * state rather than a class toggle: a rename or a save elsewhere
             * must not close a panel someone is working in.
             */
            const toggle = target.closest('[data-widget-settings]');
            if (toggle) {
                const index = indexOn(toggle, 'data-widget-settings');
                // Whatever was being watched, its panel is about to close or
                // another is about to open over it.
                this.stopCustomProbeLive();
                this._widgetSettingsOpen = this._widgetSettingsOpen === index ? null : index;
                this._widgetJustSaved = null;
                this.repaintWidgetsBody();
                // The disks live on the machine, not in the panel's own state,
                // so they are asked for after the markup exists.
                void this.fillWidgetSuggestions();
                return;
            }

            const suggested = target.closest('[data-widget-suggest-add]');
            if (suggested) { this.addSuggestedMount(suggested); return; }

            const bulk = target.closest('[data-widget-bulk]');
            if (bulk) {
                event.preventDefault();
                void this.runWidgetBulkAction(bulk.getAttribute('data-widget-bulk'));
                return;
            }

            const reset = target.closest('[data-widget-reset]');
            if (reset) {
                event.preventDefault();
                this.resetWidgetToDefaults(indexOn(reset, 'data-widget-reset'));
                return;
            }

            const save = target.closest('[data-widget-save]');
            if (save) { void this.saveWidgetDraft(indexOn(save, 'data-widget-save')); return; }

            const revert = target.closest('[data-widget-revert]');
            if (revert) { this.revertWidgetDraft(indexOn(revert, 'data-widget-revert')); return; }

            const addField = target.closest('[data-custom-add]');
            if (addField) { this.addWidgetDraftField(indexOn(addField, 'data-custom-add')); return; }

            const test = target.closest('[data-custom-test]');
            if (test) { void this.runCustomWidgetTest(indexOn(test, 'data-custom-test')); return; }

            const eye = target.closest('[data-secret-reveal]');
            if (eye) { void this.toggleSecretReveal(eye); return; }

            const dropField = target.closest('[data-custom-remove]');
            if (dropField) {
                this.removeWidgetDraftField(
                    indexOn(dropField, 'data-custom-index'),
                    indexOn(dropField, 'data-custom-remove'));
            }
        });

        /*
         * Filtering the answer is a redraw of what is already held, not another
         * request: the service was asked once and the reader is reading it.
         */
        body.addEventListener('input', (event) => {
            const find = event.target.closest?.('[data-custom-find]');
            if (!find) return;
            const widgetId = find.getAttribute('data-custom-find');
            const state = this.customProbeState(widgetId, { create: true });
            if (!state) return;
            state.find = find.value;
            const index = (this._widgetBlocks || []).findIndex((b) => String(b?.id) === widgetId);
            if (index < 0) return;
            const caret = find.selectionStart;
            this.paintCustomProbe(widgetId, index);
            // The box is redrawn with the block, so the caret is put back.
            const again = document.querySelector(`[data-custom-find="${CSS.escape(widgetId)}"]`);
            if (again) {
                again.focus();
                again.setSelectionRange(caret, caret);
            }
        });

        /*
         * Typing narrows the list, on the same debounce the bookmarks search
         * uses: repainting on every keystroke rebuilds every row and loses the
         * caret in the field that is being typed in.
         */
        body.addEventListener('input', (event) => {
            if (event.target?.id !== 'config-widget-search') return;
            this.widgetQuery = event.target.value;
            clearTimeout(this._widgetSearchTimer);
            this._widgetSearchTimer = setTimeout(() => {
                this._widgetSearchTimer = null;
                this.repaintWidgetsBody();
                // The field is rebuilt by the repaint, so the caret goes back
                // where the typist left it.
                const field = document.getElementById('config-widget-search');
                if (field) {
                    field.focus();
                    field.setSelectionRange(field.value.length, field.value.length);
                }
            }, 200);
        });

        body.addEventListener('change', (event) => {
            const target = event.target;
            if (!target?.closest) return;

            const pick = target.closest('[data-widget-pick]');
            if (pick) {
                const id = pick.getAttribute('data-widget-pick');
                if (pick.checked) this.widgetSelection.add(id);
                else this.widgetSelection.delete(id);
                this.repaintWidgetsBody();
                return;
            }

            const moveTo = target.closest('[data-widget-bulk-move]');
            if (moveTo) {
                const target_ = moveTo.value;
                // Back to the prompt: the select is a verb, not a stored value.
                moveTo.value = '';
                if (target_) void this.moveWidgetsToPage(target_);
                return;
            }

            const movePage = target.closest('[data-widget-move-page]');
            if (movePage) {
                void this.moveOneWidgetToPage(indexOn(movePage, 'data-widget-move-page'), movePage);
                return;
            }

            const sort = target.closest('[data-widget-sort]');
            if (sort) {
                this.widgetSort = sort.value;
                this.repaintWidgetsBody();
                return;
            }

            const page = target.closest('[data-widget-page]');
            if (page) {
                /*
                 * Ask before throwing away work.
                 *
                 * Widgets is the one section that does not save as you go, so
                 * an open draft is real unsaved work -- and switching page
                 * dropped every one of them without a word. The selector has
                 * already moved by the time a change event arrives, so a
                 * refusal has to put it back.
                 */
                const previousPageId = this._widgetPageId;
                const goToPage = () => {
                    this.stopCustomProbeLive();
                    this._widgetPageId = page.value === WIDGETS_ALL_PAGES
                        ? WIDGETS_ALL_PAGES
                        : Number(page.value);
                    this._widgetBlocks = null;
                    this._widgetLoadedFor = null;
                    this._widgetDrafts = {};
                    this.repaintWidgetsBody();
                    void this.loadWidgetsEditor();
                };
                if (!this.widgetDraftsDirty()) {
                    goToPage();
                    return;
                }
                void this.confirmAction(
                    this.t('config.widgetsDiscardDraftsBody',
                        'Your unsaved widget changes on this page will be lost.'),
                    {
                        title: this.t('config.widgetsDiscardDraftsTitle', 'Discard unsaved changes?'),
                        confirmLabel: this.t('config.widgetsDiscardDraftsOk', 'Discard'),
                    }
                ).then((ok) => {
                    if (ok) {
                        goToPage();
                        return;
                    }
                    page.value = String(previousPageId);
                });
                return;
            }

            // Whether a widget is drawn at all. Written straight through rather
            // than into the draft: it is a property of the list, not of the
            // panel, and it has its own control on the row.
            const shown = target.closest('[data-widget-enabled]');
            if (shown) {
                const visible = shown.checked;
                void this.setWidgetConfig(indexOn(shown, 'data-widget-enabled'),
                    { enabled: visible })
                    // Written straight to the server, so it says so: the panel
                    // below has a Save button and this box does not, and a row
                    // with two ways of saving needs both to be audible.
                    .then((ok) => ok && this.notify(visible
                        ? this.t('config.widgetShownNotice', 'Widget shown on the dashboard.')
                        : this.t('config.widgetHiddenNotice', 'Widget hidden from the dashboard.'),
                    'success'));
                return;
            }

            const preset = target.closest('[data-widget-preset]');
            if (preset) {
                /*
                 * The choice stays on the picker.
                 *
                 * It was cleared here on the grounds that a preset is a
                 * starting position rather than a kind of widget, which is
                 * true of what the widget does and wrong about what the screen
                 * says: a panel holding Sonarr's address, Sonarr's three
                 * figures and Sonarr's header, above a picker reading "Choose
                 * a service", reads as a choice that did not take. What it is
                 * a record of is where this widget started, and the note above
                 * it already says everything stays editable afterwards.
                 */
                const picked = preset.value;
                if (picked) this.applyWidgetPreset(indexOn(preset, 'data-widget-preset'), picked);
                return;
            }

            const auth = target.closest('[data-widget-auth]');
            if (auth) {
                const field = auth.getAttribute('data-widget-auth');
                const index = indexOn(auth, 'data-widget-index');
                if (field === 'kind' || field === 'shared') this.setWidgetAuthKind(index, field, auth.value);
                else this.updateWidgetAuthField(index, field, auth.value);
                return;
            }

            const live = target.closest('[data-custom-live]');
            if (live) {
                this.toggleCustomProbeLive(indexOn(live, 'data-custom-live'), live.checked);
                return;
            }

            const every = target.closest('[data-custom-live-every]');
            if (every) {
                const at = indexOn(every, 'data-custom-live-every');
                const block = (this._widgetBlocks || [])[at];
                const state = this.customProbeState(block?.id, { create: true });
                if (state) state.every = Number(every.value) || DashboardConfig.CUSTOM_PROBE_DEFAULT;
                // Restarted rather than left to finish its wait: a reader who
                // just chose five seconds is not waiting out the minute they
                // chose before it.
                if (state?.live) this.toggleCustomProbeLive(at, true);
                return;
            }

            const field = target.closest('[data-custom-field]');
            if (field) {
                const which = field.getAttribute('data-custom-field');
                const at = indexOn(field, 'data-custom-index');
                this.updateWidgetDraftField(at, indexOn(field, 'data-custom-row'), which, field.value);
                /*
                 * Changing the format changes which shapes are on offer, and a
                 * meter left selected on a format that cannot carry one would
                 * be a choice the server then drops without saying so. Redrawn
                 * rather than patched in place: this is a dropdown being
                 * changed, so there is no caret to lose.
                 */
                if (which === 'path') this.syncPlaceholderNote(at);
                if (which === 'format') {
                    this.dropMeterOnNonPercent(at, indexOn(field, 'data-custom-row'));
                    // Data asks which unit it counts in where every other
                    // format asks for decimals, so the row is redrawn rather
                    // than left showing the question its format does not have.
                    this.repaintWidgetsBody();
                }
                this.refreshWidgetSaveBar(at);
                return;
            }

            const setting = target.closest('[data-widget-setting]');
            if (setting) {
                const index = indexOn(setting, 'data-widget-index');
                this.updateWidgetDraft(index, setting);
                if (setting.getAttribute('data-widget-setting') === 'url') {
                    this.restorePresetPath(index, setting);
                    // The address is a text box, so it is not redrawn on every
                    // keystroke -- the note is toggled where it stands, the way
                    // the scheme hint is.
                    this.syncPlaceholderNote(index);
                }
                this.refreshWidgetSaveBar(index);
                return;
            }

            const title = target.closest('[data-widget="title"]');
            if (title) void this.renameWidget(Number(title.getAttribute('data-index')), title.value);
        });
    },

    /**
     * The one-time tour, the first time this section is opened.
     *
     * The cheap guards are repeated before the fetch so a reader who has seen
     * it, or has session tips off, never asks for the script at all; everything
     * else — an open modal, active search, a phone — is left to the module,
     * which checks the same tip id again.
     *
     * Here rather than on the dashboard because this is where a widget is
     * added, and because the thing worth saying — that the custom tile reaches
     * any address answering JSON — is invisible from a list of your own
     * widgets and one button.
     */
    async maybeShowWidgetsTutorial() {
        // Once per visit to the section, whatever the section does afterwards:
        // binding runs again on every repaint of the tab, and a second call
        // lands while the first tour is still on screen -- replacing it with a
        // fresh copy whose Skip then acts on a step nobody is looking at.
        if (this._widgetsTutorialAsked) return;
        if (window.DiscoverabilityState?.hasSeenTip?.(DashboardConfig.WIDGETS_TUTORIAL_TIP_ID)) return;
        if (this.dash.settings?.enableSessionTips === false) return;
        this._widgetsTutorialAsked = true;
        if (typeof window.WidgetsTutorial === 'undefined') {
            try {
                await window.LazyScript.loadScriptOnce('js/widgets-tutorial.js', 'widgetsTutorialModule',
                    () => typeof window.WidgetsTutorial !== 'undefined');
            } catch {
                // A tour that cannot be fetched is not worth an error toast.
                return;
            }
        }
        window.WidgetsTutorial?.maybeShow?.();
    },

    /*
     * Bring the Save bar in step without redrawing the panel.
     *
     * A full repaint on every keystroke-ending change would take away the box
     * the reader just left and put the caret somewhere else; this touches only
     * the three things that can change.
     */
    refreshWidgetSaveBar(index) {
        const save = document.querySelector(`[data-widget-save="${index}"]`);
        const bar = save?.closest('.config-widget-savebar');
        if (!bar) return;
        const dirty = this.widgetDraftDirty(index);
        bar.classList.toggle('is-dirty', dirty);
        save.disabled = !dirty;
        const revert = bar.querySelector('[data-widget-revert]');
        if (revert) revert.disabled = !dirty;
        const state = bar.querySelector('[data-widget-save-state]');
        if (state) state.textContent = dirty ? this.t('config.widgetUnsaved', 'Not saved yet') : '';
    },

    /*
     * A meter cannot survive its format changing away from a percentage.
     *
     * Dropped here rather than left for the server to ignore: a row still
     * reading "meter" over a count says the tile will draw one, and it will
     * not. Better to show the reader what they are actually going to get.
     */
    dropMeterOnNonPercent(index, row) {
        const field = this.widgetDraft(index)?.config?.fields?.[row];
        if (field?.shape === 'meter' && !DashboardConfig.PERCENT_FORMATS.includes(field.format)) {
            delete field.shape;
            delete field.tone;
        }
    },

    /** Everything the server needs to store, from what is on screen. */
    widgetPayloadFromBlocks() {
        const blocks = this._widgetBlocks || [];
        return {
            widgets: blocks.filter((b) => b.isWidget).map((b) => ({
                id: b.id, type: b.type, title: b.title, config: b.config || {},
            })),
            order: blocks.map((b) => b.id),
        };
    },

    /*
     * Write one page's widgets, whichever page a row belongs to.
     *
     * In the all-pages view the list spans pages, so "save the widgets" has no
     * single destination: each row is written back to the page it came from,
     * with that page's other widgets left exactly as they are.
     */
    async savePageWidgets(pageId) {
        const target = Number(pageId);
        if (!target) return false;

        const mine = (this._widgetBlocks || [])
            .filter((block) => block.isWidget && Number(block.pageId) === target);

        try {
            // Read first: this page's order and any widget the all-pages view
            // is not showing must survive the write.
            const res = await fetch(`/api/pages/${target}/blocks`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const current = await res.json();
            const edited = new Map(mine.map((block) => [block.id, block]));

            const widgets = (current.widgets || []).map((widget) => {
                const block = edited.get(widget.id);
                if (!block) return widget;
                return { id: widget.id, type: block.type, title: block.title, config: block.config || {} };
            });

            const wrote = await this.writeFetch(`/api/pages/${target}/blocks`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets }),
            });
            if (!wrote.ok) throw new Error(`HTTP ${wrote.status}`);
            return true;
        } catch {
            this.notify(this.t('config.widgetsSaveError', 'Could not save the widgets.'), 'error');
            return false;
        }
    },

    /*
     * Write a page with one widget taken out of it.
     *
     * Removal is the one edit the merging save cannot express: that one keeps
     * whatever the server already holds, which is exactly the widget being
     * deleted.
     */
    async savePageWidgetsAfterRemoval(pageId, removedId) {
        const target = Number(pageId);
        if (!target) return false;
        try {
            const res = await fetch(`/api/pages/${target}/blocks`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const current = await res.json();
            const widgets = (current.widgets || []).filter((w) => w.id !== removedId);

            const wrote = await this.writeFetch(`/api/pages/${target}/blocks`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets }),
            });
            if (!wrote.ok) throw new Error(`HTTP ${wrote.status}`);
            return true;
        } catch {
            this.notify(this.t('config.widgetsSaveError', 'Could not save the widgets.'), 'error');
            return false;
        }
    },

    /**
     * Save the page a row belongs to, in either view.
     *
     * One call site for every edit that starts from a row, so nothing has to
     * ask which view it is in.
     */
    async saveWidgetRow(index) {
        const block = (this._widgetBlocks || [])[index];
        if (this.isAllPagesView()) {
            return block?.pageId ? this.savePageWidgets(block.pageId) : false;
        }
        return this.saveWidgetBlocks(this.widgetPayloadFromBlocks());
    },

    async saveWidgetBlocks(payload) {
        const pageId = this._widgetPageId;
        // The all-pages view spans pages, so there is no single page to write:
        // everything reachable from it saves through savePageWidgets instead.
        if (!pageId || pageId === WIDGETS_ALL_PAGES) return false;
        try {
            const res = await this.writeFetch(`/api/pages/${pageId}/blocks`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                /*
                 * A refusal says which widget it could not store, and that is
                 * the one thing worth repeating: "Could not save the widgets"
                 * sends somebody looking at the disk for what is a bad entry.
                 * Only for 4xx -- a 500 really is the server's problem, and
                 * its body is not written for a reader.
                 */
                const detail = res.status >= 400 && res.status < 500
                    ? (await res.text().catch(() => '')).trim()
                    : '';
                throw new Error(detail || `HTTP ${res.status}`);
            }
            return true;
        } catch (error) {
            const said = String(error?.message || '').trim();
            const generic = this.t('config.widgetsSaveError', 'Could not save the widgets.');
            this.notify(
                said && !said.startsWith('HTTP ') ? `${generic} ${said}` : generic,
                'error',
            );
            return false;
        }
    },

    /*
     * Add one, and land on it.
     *
     * The widget is appended, so it is the last row -- which used to be the
     * problem: it arrived below a picker that filled the screen, and the only
     * sign anything had happened was a toast in the opposite corner. The
     * catalogue is an overlay now, so the list is what is on screen when it
     * closes; this puts the new row in view, marks it for a moment, and puts
     * the caret in its title, which is the next thing anyone does to it.
     *
     * The toast is gone with it. A row appearing under the pointer, named and
     * focused, says it better than a message elsewhere saying it happened.
     */
    async addWidget(type) {
        const payload = this.widgetPayloadFromBlocks();
        payload.widgets.push({ type, title: '', config: {} });
        // No id: the server mints one. Inventing one here would be a second
        // place that decides what a widget id looks like.
        if (!await this.saveWidgetBlocks(payload)) return;
        this._widgetLoadedFor = null;
        // Switch to the list before it redraws: adding from the Types tab must
        // land somewhere the new row exists.
        this.widgetsTab = 'widgets';
        this.syncSubTabStrip('data-widgets-tab', this.widgetsTab);
        await this.loadWidgetsEditor();
        /*
         * Open the new widget's settings straight away.
         *
         * Adding one is almost always followed by filling it in, and the fields
         * were a second click away behind a Settings button. Only one panel is
         * open at a time, so on a page that already carries a widget of the
         * same kind that click also closed the panel someone was reading --
         * which is what made a second RSS block feel like it could not be
         * given its own feeds.
         */
        const added = this.lastWidgetIndex();
        if (added >= 0) this._widgetSettingsOpen = added;
        // After the dashboard redraw, not before: a full render replaces the
        // elements this is about to mark and focus, so revealing first left the
        // caret back on <body> and the mark gone within the same tick.
        await this.refreshDashboardBlocks();
        this.revealNewWidget(added);
    },

    /** Where the widget the server just appended sits in the block list. */
    lastWidgetIndex() {
        const blocks = this._widgetBlocks || [];
        for (let index = blocks.length - 1; index >= 0; index -= 1) {
            if (blocks[index]?.isWidget) return index;
        }
        return -1;
    },

    /** Bring the new row into view, mark it, and put the caret in its title. */
    revealNewWidget(index = -1) {
        // By index rather than by position: the list is grouped by default, so
        // the row that was just added is only the last one on screen when the
        // reader happens to be sorting by page order.
        const rows = document.querySelectorAll('#config-widgets-body .config-widget-row');
        const row = (index >= 0
            && document.querySelector(`#config-widgets-body .config-widget-row[data-widget-row="${index}"]`))
            || rows[rows.length - 1];
        if (!row) return;
        row.classList.add('is-new');
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        /*
         * The fields, not just the row's head.
         *
         * The row arrives with its settings open and is now taller than it
         * was; scrolling to its top can leave every field it just opened below
         * the fold, which is the same complaint this reveal was written for.
         */
        const panel = row.querySelector('.config-widget-settings:not([hidden])');
        if (panel) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const title = row.querySelector('[data-widget="title"]');
        if (title) title.focus({ preventScroll: true });
        // Removed rather than left on: it marks an arrival, not a state, and a
        // redraw would otherwise carry it for the rest of the session.
        window.setTimeout(() => row.classList.remove('is-new'), 1600);
    },

    /*
     * Change one widget's settings.
     *
     * Merged into whatever config it already has rather than replaced, so
     * switching a widget off does not also forget what it was counting.
     */
    async setWidgetConfig(index, patch) {
        const blocks = [...(this._widgetBlocks || [])];
        if (!blocks[index]?.isWidget) return;
        const merged = { ...(blocks[index].config || {}), ...patch };
        // undefined means "use the default", and the default is the key being
        // absent — JSON.stringify would drop it anyway, so this makes the local
        // copy agree with what the server will store.
        Object.keys(patch).forEach((key) => {
            if (patch[key] === undefined) delete merged[key];
        });
        blocks[index] = { ...blocks[index], config: merged };
        this._widgetBlocks = blocks;
        // Answers whether it wrote, so a caller can say so without claiming a
        // save that the server refused.
        if (!await this.saveWidgetRow(index)) return false;
        await this.refreshDashboardBlocks();
        return true;
    },

    /**
     * One setting, read off the control that changed.
     *
     * An empty number means "use the default", which is stored as the field
     * being absent — the same thing the server does with a value it cannot
     * accept, and what every renderer already reads as the default.
     */
    /*
     * One control changed: write it into the draft and nothing else.
     *
     * No server call, no repaint. A repaint here would replace the box the
     * reader is typing in, and a server call would be the per-field write this
     * whole panel was rebuilt to get rid of.
     */
    updateWidgetDraft(index, input) {
        const draft = this.widgetDraft(index);
        if (!draft) return;
        const key = input.getAttribute('data-widget-setting');
        const kind = input.getAttribute('data-widget-kind');
        const container = input.closest('.config-widget-settings') || document;

        let value;
        if (kind === 'bool') {
            value = input.checked;
        } else if (kind === 'int') {
            const raw = String(input.value || '').trim();
            const parsed = Number.parseInt(raw, 10);
            value = raw === '' || Number.isNaN(parsed) ? undefined : parsed;
        } else if (kind === 'tags') {
            const list = String(input.value || '').split(',')
                .map((tag) => tag.trim()).filter(Boolean);
            value = list.length ? list : undefined;
        } else if (kind === 'urlList') {
            // One address per line. Blank lines are how a list is edited, not
            // an entry, so they are dropped rather than stored as empties.
            const list = String(input.value || '').split('\n')
                .map((line) => line.trim()).filter(Boolean);
            value = list.length ? list : undefined;
        } else if (kind === 'text') {
            const text = String(input.value || '').trim();
            value = text === '' ? undefined : text;
        } else {
            // checkset: every box for this key, so unticking one sends the rest
            // rather than the one that changed. All ticked is the same as
            // saying nothing, and storing nothing keeps a later addition to the
            // list included by default.
            const boxes = [...container.querySelectorAll(
                `[data-widget-setting="${CSS.escape(key)}"][data-widget-kind="checkset"]`)];
            const chosen = boxes.filter((box) => box.checked).map((box) => box.value);
            value = chosen.length === boxes.length ? undefined : chosen;
        }

        if (value === undefined) delete draft.config[key];
        else draft.config[key] = value;
    },

    /** One cell of the custom widget's figures table, into the draft. */
    updateWidgetDraftField(index, row, key, value) {
        const draft = this.widgetDraft(index);
        if (!draft) return;
        const fields = Array.isArray(draft.config.fields) ? draft.config.fields : [];
        if (!fields[row]) return;
        if (key === 'decimals') {
            /*
             * A number, or the key is not there at all.
             *
             * Auto is the absence of a choice rather than a value meaning it,
             * so it deletes the key: a stored 0 is a real answer -- round to
             * whole -- and the two must not collapse into each other. Stored as
             * a number because the server reads one, and "2" would be read as
             * nothing chosen.
             */
            const next = { ...fields[row] };
            if (value === '') delete next.decimals;
            else next.decimals = Number(value);
            fields[row] = next;
        } else {
            fields[row] = { ...fields[row], [key]: String(value || '').trim() };
        }
        draft.config.fields = fields;
    },

    addWidgetDraftField(index) {
        const draft = this.widgetDraft(index);
        if (!draft) return;
        const fields = Array.isArray(draft.config.fields) ? [...draft.config.fields] : [];
        if (fields.length >= 8) return;
        // Added empty rather than with a guess: the server drops a field with
        // no path, so a row that names nothing exists only in this panel.
        fields.push({ path: '', label: '', format: 'text' });
        draft.config.fields = fields;
        this.repaintWidgetsBody();
    },

    removeWidgetDraftField(index, row) {
        const draft = this.widgetDraft(index);
        if (!draft) return;
        const fields = (Array.isArray(draft.config.fields) ? draft.config.fields : [])
            .filter((_, i) => i !== row);
        draft.config.fields = fields.length ? fields : undefined;
        this.repaintWidgetsBody();
    },

    /*
     * Which kind of sign-in, into the draft.
     *
     * Redraws, because the choice changes which boxes are on screen -- but it
     * writes nothing. Choosing "an API key" is the start of typing one, not a
     * decision worth storing, and an empty credential written at that moment
     * would be an entry that signs in with nothing.
     */
    setWidgetAuthKind(index, field, value) {
        const draft = this.widgetDraft(index);
        if (!draft) return;
        if (field === 'shared') {
            draft.auth = { kind: 'shared', shared: value };
        } else if (value === 'shared') {
            const own = this.widgetCredentialId((this._widgetBlocks || [])[index]);
            const first = Object.keys(this.dash.healthCredentials || {})
                .filter((id) => id !== own).sort()[0] || '';
            draft.auth = { kind: 'shared', shared: first };
        } else if (value === 'none') {
            draft.auth = { kind: 'none' };
        } else {
            // Keep what the stored entry already tells us, so switching away
            // and back does not blank a header name that is right.
            const before = draft.auth || {};
            draft.auth = {
                kind: value,
                headerName: before.headerName || '',
                // queryName and fixedHeaders come from the preset rather than
                // from anything on screen, so switching kinds must not lose
                // them: there is no box that would put them back.
                queryName: before.queryName || '',
                fixedHeaders: before.fixedHeaders || null,
                // Where to sign in comes from the preset and has no box, so
                // switching kinds must not lose it.
                session: before.session || null,
                seed: before.seed || '',
                basicUser: before.basicUser || '',
                saved: before.saved === true && before.kind === value,
            };
        }
        this.repaintWidgetsBody();
    },

    /** A typed key or username, into the draft. Never to the server per keystroke. */
    updateWidgetAuthField(index, field, value) {
        const draft = this.widgetDraft(index);
        if (!draft) return;
        draft.auth = { ...(draft.auth || {}), [field]: String(value || '') };
        if (field === 'headerName') this.syncSchemeHint(index, value);
        // A key typed is a change on its own: Save stayed off until something
        // else on the row moved, so a rotated key could not be saved.
        this.refreshWidgetSaveBar(index);
    },

    /** Shows or hides the fill-in note as the address is typed. */
    syncPlaceholderNote(index) {
        const body = document.querySelector(`[data-widget-row="${index}"]`);
        if (!body) return;
        const group = body.querySelector('.config-custom-grid')?.parentElement;
        if (!group) return;
        const existing = group.querySelector(':scope > .config-widget-note-hint');
        const wanted = this.renderAddressPlaceholderNote(
            (this._widgetBlocks || [])[index], index);
        if (!wanted) {
            existing?.remove();
            return;
        }
        if (existing) return;
        const grid = group.querySelector('.config-custom-grid');
        grid?.insertAdjacentHTML('afterend', wanted);
    },

    /*
     * Whether the scheme hint is showing, without redrawing the panel.
     *
     * The header name is a text box being typed into, and repainting on every
     * keystroke would take the caret with it -- which is why nothing else in
     * this form redraws either. So the hint is toggled where it stands: it
     * belongs to the box above it and appears the moment that box says
     * Authorization.
     */
    syncSchemeHint(index, headerName) {
        const form = document.querySelector(`[data-widget-auth-form="${index}"]`);
        if (!form) return;
        const wanted = String(headerName || '').trim().toLowerCase() === 'authorization';
        const existing = form.querySelector('.config-widget-note-hint');
        if (wanted === !!existing) return;
        if (!wanted) {
            existing.remove();
            return;
        }
        const key = form.querySelector('[data-widget-auth="secret"]');
        const field = key?.closest('.config-widget-field');
        if (!field) return;
        const note = document.createElement('p');
        note.className = 'config-widget-note config-widget-note-hint';
        note.textContent = this.t('config.widgetAuthScheme',
            'Most services want a scheme in front of the token here — "Bearer <token>" — not the token on its own.');
        field.appendChild(note);
    },

    /*
     * A preset fills the form and stops there.
     *
     * Applied on Save like everything else in this panel, so choosing a service
     * to see what it would set is not itself a change to the widget. The
     * address someone already typed keeps its host and only the path is
     * replaced -- that is what makes moving from Sonarr to Radarr on the same
     * box one choice rather than a retype.
     *
     * The credential is filled in as far as it can be: a preset knows which
     * header its service wants, and X-Api-Key is printed on Sonarr's own
     * settings page. The key itself is nobody's business but the reader's.
     */
    applyWidgetPreset(index, presetId) {
        const catalogue = window.DashboardWidgetPresets;
        const preset = catalogue?.byId?.(presetId);
        const draft = this.widgetDraft(index);
        if (!preset || !draft) return;

        // configFor writes presetId along with the address and the figures, so
        // what the panel was started from survives being saved and reopened.
        Object.assign(draft.config, catalogue.configFor(preset, draft.config.url || ''));
        if (preset.auth === 'header') {
            /*
             * The scheme is filled in, the token is not.
             *
             * An Authorization header is two things joined by a space, and only
             * the second half is the secret -- but the box asks for "API key",
             * so the first half gets left off and the service answers 401
             * exactly as it would to a wrong key. Nothing on screen can tell
             * those two apart, which is what made this worth an hour rather
             * than a glance. Seeding the scheme puts the halves the reader
             * cannot know beside the one they hold.
             *
             * Per preset rather than a constant: Paperless wants "Token ",
             * Proxmox wants "PVEAPIToken=", and a shared "Bearer " would be
             * wrong for both in the same silent way.
             */
            draft.auth = {
                kind: 'header', headerName: preset.authName || '', basicUser: '',
                seed: preset.scheme || '',
                // Sent with the key and never asked for: Nextcloud wants
                // OCS-APIRequest beside its NC-Token.
                fixedHeaders: preset.fixedHeaders || null,
            };
        } else if (preset.auth === 'basic') {
            draft.auth = { kind: 'basic', headerName: '', basicUser: '' };
        } else if (preset.auth === 'session') {
            /*
             * A service that signs you in rather than taking a key.
             *
             * What is asked for is what does not expire -- the username and
             * password -- and the server does the signing in. Asking for the
             * cookie instead was the first attempt, and it is a widget that
             * works until the session lapses and then reads 403 with nothing on
             * screen explaining why.
             */
            draft.auth = {
                kind: 'session', headerName: '', basicUser: '',
                session: preset.session || null,
            };
        } else if (preset.auth === 'query') {
            /*
             * A key that goes in the address is still a key.
             *
             * SABnzbd, Tautulli, Pi-hole v5 and Plex offer no header form, so
             * this used to fall through to "no credential needed" -- which left
             * the sign-in block hidden, the API key box gone, and YOUR_KEY
             * sitting in the address for the reader to replace by hand. The box
             * asked for nothing and the address asked for everything, which is
             * the opposite of what the panel says it does.
             *
             * It is an ordinary sign-in now. The value goes to the credential
             * file like any other, the stored address keeps its placeholder,
             * and the server fills the parameter in on each request -- so the
             * key stays out of bookmarks-N.json and out of every export.
             */
            draft.auth = {
                kind: 'query', queryName: preset.queryName || '',
                headerName: '', basicUser: '',
                fixedHeaders: preset.fixedHeaders || null,
            };
        } else {
            draft.auth = { kind: 'none' };
        }
        this.repaintWidgetsBody();

        const note = preset.auth === 'none'
            ? this.t('config.widgetPresetNoAuth', '{name} is ready — no credential needed.')
                .replace('{name}', preset.name)
            : this.t('config.widgetPresetApplied', '{name} filled in. Still to do: {note}')
                .replace('{name}', preset.name)
                .replace('{note}', preset.note);
        this.notify(note, 'info');
    },

    /*
     * Put a preset's path back when the address was retyped without it.
     *
     * A preset fills in a whole address: a sample host, and the path its API
     * actually answers on. Replacing the sample host is then the obvious next
     * move -- and typing an address by hand ends at the host, so the path the
     * preset contributed is the part that gets lost. The widget then asks the
     * service for its front page, which answers 200 with HTML, and the failure
     * reads as "not JSON" rather than as a path that is missing.
     *
     * Only while a preset is active on this draft, and only when what is there
     * names no path of its own: an address deliberately pointed somewhere else
     * is left exactly as it was typed.
     */
    restorePresetPath(index, input) {
        const catalogue = window.DashboardWidgetPresets;
        const draft = this.widgetDraft(index, { create: false });
        // Read from the config rather than from a field on the draft: stored
        // there, it still knows the service after the panel has been closed
        // and opened again, which is exactly when someone retypes an address.
        const startedFrom = draft?.config?.presetId;
        const preset = startedFrom ? catalogue?.byId?.(startedFrom) : null;
        if (!preset || typeof catalogue.hasPath !== 'function') return;

        const typed = String(draft.config.url || '').trim();
        if (!typed || catalogue.hasPath(typed)) return;
        const restored = catalogue.addressFor(preset, typed);
        if (!restored || restored === typed) return;

        draft.config.url = restored;
        input.value = restored;
        // Said rather than done quietly: the box someone just typed in has
        // changed under them, and an unexplained edit reads as the field
        // refusing what was entered.
        this.notify(this.t('config.widgetPresetPathKept',
            '{name} answers on {path}, so that was put back on the address.')
            .replace('{name}', preset.name)
            .replace('{path}', preset.path), 'info');
    },

    /** Throw the draft away and draw what is stored. */
    revertWidgetDraft(index) {
        const block = (this._widgetBlocks || [])[index];
        if (block) delete (this._widgetDrafts || {})[block.id];
        this._widgetJustSaved = null;
        this.repaintWidgetsBody();
    },

    /*
     * Write the whole panel out, in the order that survives a failure.
     *
     * The credential first, then the config that names it: a widget pointing at
     * an entry that does not exist yet fetches anonymously, and that reads as
     * "the key is wrong" rather than "the key has not been saved". The other
     * order is recoverable; this one is confusing.
     */
    async saveWidgetDraft(index) {
        const block = (this._widgetBlocks || [])[index];
        const draft = this.widgetDraft(index, { create: false });
        if (!block?.isWidget || !draft) return;
        const say = (text) => {
            const state = document.querySelector(
                `[data-widget-save="${index}"]`)?.closest('.config-widget-savebar')
                ?.querySelector('[data-widget-save-state]');
            if (state) state.textContent = text;
        };

        const auth = draft.auth || { kind: 'none' };
        const own = this.widgetCredentialId(block);
        const secret = String(auth.secret || '').trim();
        const stored = this.storedCredentialState(block);
        const config = { ...draft.config };
        // Shown belongs to the list, not the panel: the toggle writes the block
        // directly, and the draft still held what was there when the panel
        // opened, so Save brought a widget just hidden back.
        if ((block.config || {}).enabled === false) config.enabled = false;
        else delete config.enabled;
        let dropOwnKey = false;

        if (auth.kind === 'header' || auth.kind === 'basic' || auth.kind === 'query'
            || auth.kind === 'session') {
            const payload = { id: own, label: block.title || block.type || own };
            if (auth.kind === 'session') {
                const user = String(auth.basicUser || '').trim();
                const sessionShape = auth.session || this.widgetPresetOf(block, index)?.session || null;
                const passwordOnly = this.sessionIsPasswordOnly(sessionShape);
                if (!user && !passwordOnly) { say(this.t('config.widgetAuthNeedsUser', 'Fill in the username first.')); return; }
                if (!secret && !(stored.kind === 'session' && stored.basicUser === user)) {
                    say(this.t('config.widgetAuthNeedsPassword', 'Fill in the password as well.'));
                    return;
                }
                if (secret) {
                    // The login is described by the preset, not typed: where to
                    // post and what to call the fields is knowledge, not a
                    // preference, and a box for it would be a box nobody can
                    // answer.
                    payload.session = { ...(sessionShape || {}), user, password: secret };
                }
            } else if (auth.kind === 'query') {
                const name = String(auth.queryName || '').trim();
                if (!name) { say(this.t('config.widgetAuthNeedsHeader', 'Name the header first.')); return; }
                if (!secret && !(stored.kind === 'query' && stored.queryName === name)) {
                    say(this.t('config.widgetAuthNeedsKey', 'Paste the key as well.'));
                    return;
                }
                if (secret) payload.query = { [name]: secret };
                // Plex answers XML unless asked otherwise, and that Accept
                // header is not a secret anyone should be asked to type: it
                // rides along with the key rather than being a second question.
                // Only with a key: the PUT replaces the whole entry, and the
                // header alone filed over a stored key deleted it.
                if (secret && auth.fixedHeaders) payload.headers = { ...auth.fixedHeaders };
            } else if (auth.kind === 'header') {
                const name = String(auth.headerName || '').trim();
                if (!name) { say(this.t('config.widgetAuthNeedsHeader', 'Name the header first.')); return; }
                if (!secret && !(stored.kind === 'header' && stored.headerName === name)) {
                    say(this.t('config.widgetAuthNeedsKey', 'Paste the key as well.'));
                    return;
                }
                /*
                 * A seeded scheme on its own is not a key.
                 *
                 * The box is pre-filled with "Bearer " so the token can be
                 * pasted after it, which means Save can be pressed over a box
                 * holding only the scheme -- and that would file the word
                 * "Bearer" as the secret, sending a header that looks filled in
                 * and authenticates as nothing. Refused here rather than
                 * stored, because the tile's 401 would say nothing about why.
                 */
                if (secret && this.isSchemeOnly(secret)) {
                    say(this.t('config.widgetAuthNeedsKey', 'Paste the key as well.'));
                    return;
                }
                if (secret) payload.headers = { ...(auth.fixedHeaders || {}), [name]: secret };
            } else {
                const user = String(auth.basicUser || '').trim();
                if (!user) { say(this.t('config.widgetAuthNeedsUser', 'Fill in the username first.')); return; }
                if (!secret && !(stored.kind === 'basic' && stored.basicUser === user)) {
                    say(this.t('config.widgetAuthNeedsPassword', 'Fill in the password as well.'));
                    return;
                }
                if (secret) { payload.basicUser = user; payload.basicPassword = secret; }
            }
            // Nothing to write when only the label changed and the secret is
            // already filed: the value never comes back from the server, so
            // re-filing it is not something this panel can do.
            if (payload.headers || payload.basicPassword || payload.query || payload.session) {
                say(this.t('config.widgetAuthSaving', 'Saving…'));
                try {
                    const res = await this.writeFetch('/api/health/credentials', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    this.dash.healthCredentials = data?.credentials || {};
                    this.dash.healthCredentialDetails = data?.details || {};
                } catch (_error) {
                    say(this.t('config.widgetAuthFailed', 'Could not save the sign-in.'));
                    return;
                }
            }
            config.credentialId = own;
        } else if (auth.kind === 'shared') {
            config.credentialId = auth.shared || undefined;
        } else {
            delete config.credentialId;
            dropOwnKey = true;
        }

        const blocks = [...(this._widgetBlocks || [])];
        blocks[index] = { ...block, config };
        this._widgetBlocks = blocks;
        if (!await this.saveWidgetRow(index)) {
            say(this.t('config.widgetsSaveError', 'Could not save the widgets.'));
            return;
        }
        // Only once the widget no longer names it.
        if (dropOwnKey) await this.forgetWidgetCredential(block);

        delete (this._widgetDrafts || {})[block.id];
        this._widgetJustSaved = index;
        // The tile is holding an answer it fetched under the old settings.
        this.dash.renderCore?.forgetWidgetCaches?.();
        this.repaintWidgetsBody();
        await this.refreshDashboardBlocks();
        this.notify(this.t('config.widgetSavedNotice', 'Widget saved.'), 'success');
    },

    /*
     * Rename one widget.
     *
     * Written straight through rather than into the draft, for the same reason
     * the Shown toggle is: a title is a property of the block in the list, not
     * of the settings panel, and it has its own box on the row whether that
     * panel is open or not. Holding it in the draft would mean a rename could
     * only be saved by pressing Save on a panel the reader may never open.
     *
     * No repaint afterwards. The row is redrawn from _widgetBlocks the next
     * time anything paints, and repainting here would replace the box the
     * reader has just typed in while the caret is still in it.
     */
    async renameWidget(index, title) {
        const blocks = [...(this._widgetBlocks || [])];
        if (!blocks[index]?.isWidget) return;
        const next = String(title || '').trim();
        if (next === String(blocks[index].title || '')) return;
        blocks[index] = { ...blocks[index], title: next };
        this._widgetBlocks = blocks;
        if (!await this.saveWidgetRow(index)) return;
        await this.refreshDashboardBlocks();
        /*
         * Said out loud, because this one writes straight to the server.
         *
         * The settings panel below has a Save button, so its changes announce
         * themselves; the title and the Shown box do not, and wrote silently.
         * Two ways of saving in one row, one of them invisible, is what made
         * this tab feel like it might not have taken.
         */
        this.notify(this.t('config.widgetRenamed', 'Widget name saved.'), 'success');
    },

    /** Remove the entry a widget minted for itself, leaving shared ones alone. */
    async forgetWidgetCredential(block) {
        const id = this.widgetCredentialId(block);
        if (!id) return;
        if (!((this.dash.healthCredentials || {})[id])) return;
        try {
            await this.writeFetch(`/api/health/credentials?id=${encodeURIComponent(id)}`,
                { method: 'DELETE' });
        } catch (_error) {
            // A key that could not be removed is no reason to leave the widget
            // pointing at it; the config change goes ahead either way.
        }
        await this.loadCredentialNames();
    },

    async deleteWidget(index) {
        const block = (this._widgetBlocks || [])[index];
        if (!block?.isWidget) return;
        const ok = await this.confirmAction(
            this.t('config.widgetsDeleteConfirm',
                'Remove this widget? Its settings and any sign-in you gave it go with it.'),
            { confirmLabel: this.t('config.backupDelete', 'Delete'), danger: true });
        if (!ok) return;

        delete (this._widgetDrafts || {})[block.id];

        // The page is read off the block before it goes: saveWidgetRow would
        // look at whatever row slid into this index.
        const fromPage = this.isAllPagesView() ? Number(block.pageId) : null;
        this._widgetBlocks = (this._widgetBlocks || []).filter((_, i) => i !== index);
        const wrote = fromPage
            ? await this.savePageWidgetsAfterRemoval(fromPage, block.id)
            : await this.saveWidgetBlocks(this.widgetPayloadFromBlocks());
        if (!wrote) return;
        // After the page save, from the block held above: forgotten first, a
        // failed save left the widget pointing at a key that was gone.
        await this.forgetWidgetCredential(block);
        this.notify(this.t('config.widgetsDeleted', 'Widget removed.'), 'success');
        this._widgetLoadedFor = null;
        await this.loadWidgetsEditor();
        await this.refreshDashboardBlocks();
    },

    /*
     * Put the dashboard in step with what was just changed here.
     *
     * Without this the grid keeps the blocks it loaded with, so a widget added
     * in config appears only after a reload -- and the reader has no way to know
     * that is why.
     */
    async refreshDashboardBlocks() {
        const d = this.dash;
        const pageId = Number(d.currentPageId);
        /*
         * Editing another page's widgets leaves this page alone — but the
         * cached answers are the dashboard's, not the page's, so they go either
         * way. Otherwise switching to the page that was edited draws its new
         * tiles from data fetched before the edit.
         */
        d.renderCore?.forgetWidgetCaches?.();
        if (!Number.isFinite(pageId) || pageId !== Number(this._widgetPageId)) return;
        try {
            const res = await this.writeFetch(`/api/pages/${pageId}/blocks`);
            if (!res.ok) return;
            const blocks = await res.json();
            d.widgets = blocks.widgets || [];
            d.blockOrder = blocks.order || [];
            d.data?.updatePageDataCache?.(pageId, { blocks: { widgets: d.widgets, order: d.blockOrder } });
            d.renderDashboard?.({ animate: false, forceFull: true });
        } catch {
            // The dashboard keeps what it had; the next load corrects it.
        }
    },
    });

    global.DashboardConfigWidgetsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
