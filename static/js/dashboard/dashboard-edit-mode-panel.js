/**
 * The panel at the right of edit mode (dashboard-edit-mode.js): what is
 * selected, as fields.
 *
 * A category's name, icon, width, view and sort; a page's name, emoji and
 * colour; a widget's settings (the Config form, see the widget section). The
 * writers are the ones the category menu and the page tab editor already use,
 * so there is one way each thing is saved; the fields only ask for it. A change
 * is saved as it is made.
 */
class DashboardEditModePanel {
    constructor(mode) {
        this.mode = mode;
        this.drawer = null;
        this.el = null;
    }

    get dash() { return this.mode.dash; }

    t(key, fallback) { return this.mode.t(key, fallback); }

    esc(value) {
        return window.NextDashHtml?.escapeHtml
            ? window.NextDashHtml.escapeHtml(String(value ?? ''))
            : String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    }

    /** A field the way the Bookmarks view's side panel draws one: label, control, status. */
    field(name, label, control) {
        return `
            <label class="config-bm-field" data-edit-field-wrap="${name}">
                <span class="config-bm-field-label">${this.esc(label)}</span>
                ${control}
                <span class="config-bm-field-status" role="status"></span>
            </label>`;
    }

    select(field, options, value, disabled = false) {
        return `<select class="config-select" data-edit-field="${field}" ${disabled ? 'disabled' : ''}>${
            options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${this.esc(l)}</option>`).join('')}</select>`;
    }

    /** What is known about the block, as label and value rows; a row without a value is left out. */
    facts(rows) {
        const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
        if (!shown.length) return '';
        return `<dl class="edit-panel-facts">${shown.map(([label, value, attr]) => `
            <div><dt>${this.esc(label)}</dt><dd${attr ? ` ${attr}` : ''}>${this.esc(value)}</dd></div>`).join('')}</dl>`;
    }

    /** Buttons for what the block's menu offers, so the panel needs no trip to it. */
    actions(list) {
        return `<div class="edit-panel-actions">${list.map(({ id, label, danger }) => `
            <button type="button" class="config-btn config-btn--small${danger ? ' config-btn--danger' : ''}" data-edit-action="${id}">${this.esc(label)}</button>`).join('')}</div>`;
    }

    /** The Health report's issues, read once a minute at most: the panel opens often. */
    async healthIssues() {
        const now = Date.now();
        if (this._health && now - this._health.at < 60_000) return this._health.issues;
        try {
            const res = await fetch('/api/bookmark-health', { cache: 'no-store' });
            if (!res.ok) return null;
            const issues = (await res.json())?.issues;
            this._health = { at: now, issues: Array.isArray(issues) ? issues : [] };
            return this._health.issues;
        } catch (_) {
            return null;
        }
    }

    /** Opens in the last seven days across some bookmarks. */
    weekOpens(list) {
        const from = Date.now() - 7 * 86_400_000;
        return list.reduce((n, bm) => n + (Array.isArray(bm.openLog) ? bm.openLog.filter((ts) => ts >= from).length : 0), 0);
    }

    /** The widgets code stores a setting as camelCase: "forecastRange" reads as "Forecast range". */
    settingLabel(key) {
        const spaced = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
        return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }

    /** Up to four things that are set on a widget: no secrets, no switches the panel shows itself. */
    settingRows(widget) {
        const skip = /secret|password|token|key|credential|enabled|columns|title|server|url|host|address/i;
        return Object.entries(widget?.config || {})
            .filter(([k, v]) => !skip.test(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v) !== '')
            .slice(0, 4)
            .map(([k, v]) => [this.settingLabel(k), typeof v === 'boolean' ? (v ? this.t('editMode.on', 'On') : this.t('editMode.off', 'Off')) : String(v)]);
    }

    /** The title of a block on the page, which the menu actions anchor to. */
    titleOf(id) {
        return document.querySelector(`#dashboard-layout [data-category-id="${CSS.escape(String(id))}"] .category-title, #dashboard-layout [data-widget-id="${CSS.escape(String(id))}"] .category-title`);
    }

    /** Why a width cannot be chosen, as a line under the field; nothing when it can. */
    widthNote(reason, text) {
        if (!reason) return '';
        return `<p class="edit-panel-note" data-edit-width-note>${this.esc(text)}</p>`;
    }

    /** Show what is selected, or nothing (the panel goes). */
    render(selection) {
        if (!selection) { this.close(); return; }
        if (typeof window.ListViewDrawer !== 'function') return;
        if (!this.drawer) {
            this.drawer = new window.ListViewDrawer({
                id: 'edit-mode',
                storageKey: 'nextdash:edit-mode-sections',
                defaultSections: ['main'],
                ariaLabel: () => this.t('editMode.panelLabel', 'Edit panel'),
                closeLabel: this.t('editMode.closePanel', 'Close the panel'),
                onClose: () => { if (!this._closing) this.mode.select(null); },
            });
        }
        const first = !this.drawer.isOpen();
        let heading = '';
        let label = '';
        let html = '';
        if (selection.kind === 'category') {
            const stored = this.storedCategory(selection.id);
            heading = this.splitName(stored?.name).text || this.t('editMode.category', 'Category');
            label = this.t('editMode.category', 'Category');
            html = this.categoryHtml(selection);
        } else if (selection.kind === 'page') {
            heading = this.pageOf(selection.id)?.name || this.t('editMode.page', 'Page');
            label = this.t('editMode.page', 'Page');
            html = this.pageHtml(selection);
        } else if (selection.kind === 'widget') {
            heading = this.widgetOf(selection.id)?.title || this.t('editMode.widget', 'Widget');
            label = this.t('editMode.widget', 'Widget');
            html = this.widgetHtml(selection);
        } else {
            heading = this.t('editMode.block', 'Block');
            label = heading;
            html = `<div data-edit-section="other"><p class="edit-panel-note">${this.esc(this.t('editMode.noSettings', 'This block has no settings here.'))}</p></div>`;
        }
        this.drawer.open(`${selection.kind}:${selection.id}`, {
            title: heading,
            build: (panel, ctx) => {
                const body = ctx.section('main', label);
                body.innerHTML = `<div id="edit-mode-panel">${html}</div>`;
                this.el = body.querySelector('#edit-mode-panel');
            },
        });
        this.drawer.openSection('main');
        document.body.setAttribute('data-edit-panel', 'open');
        this.bind(selection);
        if (first) window.dispatchEvent(new Event('resize'));
    }

    close() {
        // The drawer's own × has already closed it by the time this runs, but
        // the grid's room is still held back: give it back either way.
        if (this.drawer?.isOpen()) {
            this._closing = true;
            this.drawer.close({ silent: true });
            this._closing = false;
        }
        this.el = null;
        if (document.body.hasAttribute('data-edit-panel')) {
            document.body.removeAttribute('data-edit-panel');
            window.dispatchEvent(new Event('resize'));
        }
    }

    // ── category ───────────────────────────────────────────────────────

    storedCategory(id) {
        return (this.dash.categories || []).find((c) => String(c.id) === String(id)) || null;
    }

    /** The name without the icon token that heads it, and that token. */
    splitName(name) {
        const m = /^\s*(:[^:\s]+:)\s*([\s\S]*)$/.exec(String(name || ''));
        return m ? { icon: m[1], text: m[2] } : { icon: '', text: String(name || '') };
    }

    categoryHtml(selection) {
        const d = this.dash;
        const stored = this.storedCategory(selection.id);
        if (!stored) return `<div data-edit-section="other"><p class="edit-panel-note">${this.esc(this.t('editMode.gone', 'This category is no longer there.'))}</p></div>`;
        const span = window.DashboardCategorySpan;
        const spread = Boolean(span?.isCategorySpread?.(d, stored));
        const locked = d.settings?.lockLayout === true;
        const spreadReason = span?.spreadUnavailableReason?.(d) || null;
        const widthBlocked = locked || Boolean(spreadReason);
        // The menu says the same in its entry; here the field is off and the line says why.
        const widthWhy = locked
            ? this.t('editMode.widthLocked', 'The layout is locked')
            : (spreadReason ? d.categoryMenu?.spreadUnavailableText?.(spreadReason, true) || '' : '');
        const view = stored.view === 'tiles' ? 'tiles' : 'rows';
        const sort = window.DashboardCategorySort?.getCategorySortMode?.(d, stored) || 'order';
        const { text } = this.splitName(stored.name);
        const own = (d.allBookmarks || []).filter((b) => String(b.pageId) === String(d.currentPageId) && String(b.category ?? '') === String(stored.id));
        const facts = this.facts([
            [this.t('editMode.factBookmarks', 'Bookmarks'), String(own.length || d.structureCreate?.countBookmarksInCategory?.(stored.id) || 0)],
            [this.t('editMode.factOpens', 'Opened this week'), own.length ? String(this.weekOpens(own)) : ''],
            [this.t('editMode.factBroken', 'Broken'), '…', 'data-edit-broken'],
        ]);
        const actions = this.actions([
            { id: 'add-bookmark', label: this.t('editMode.actionAddBookmark', 'Add bookmark') },
            ...(window.DashboardBlockPageMove?.canMoveToPage?.(d, stored.id) ? [{ id: 'move-page', label: this.t('editMode.actionMove', 'Move to page…') }] : []),
            { id: 'delete', label: this.t('editMode.actionDelete', 'Delete'), danger: true },
        ]);
        return `
            <div data-edit-section="category" data-edit-id="${this.esc(selection.id)}">
                ${facts}
                ${this.field('name', this.t('editMode.name', 'Name'), `<input type="text" class="config-text" data-edit-field="name" value="${this.esc(text)}" maxlength="80">`)}
                <div class="config-bm-field"><span class="config-bm-field-label">${this.esc(this.t('editMode.icon', 'Icon'))}</span>
                    <button type="button" class="config-btn config-btn--small" data-edit-action="icon">${this.esc(this.t('editMode.chooseIcon', 'Choose an icon…'))}</button></div>
                ${this.field('width', this.t('editMode.width', 'Width'), this.select('width',
                    [['one', this.t('editMode.widthOne', 'One column')], ['wide', this.t('editMode.widthWide', 'Wide')]], spread ? 'wide' : 'one', widthBlocked))}
                ${this.widthNote(widthBlocked, widthWhy)}
                ${this.field('view', this.t('editMode.view', 'View'), this.select('view',
                    [['rows', this.t('editMode.viewRows', 'Rows')], ['tiles', this.t('editMode.viewTiles', 'Tiles')]], view))}
                ${this.field('sort', this.t('editMode.sort', 'Sort'), this.select('sort',
                    [['order', this.t('editMode.sortOrder', 'As placed')], ['az', this.t('editMode.sortAz', 'A to Z')], ['recent', this.t('editMode.sortRecent', 'Recently opened')]], sort))}
                ${actions}
            </div>`;
    }

    /** True while the category is still on the server; clears the panel when it is not. */
    async categoryAlive(id) {
        const d = this.dash;
        try {
            const res = await fetch(`/api/categories?page=${encodeURIComponent(d.currentPageId)}`, { cache: 'no-store' });
            if (res.ok) {
                const list = await res.json();
                if (Array.isArray(list) && !list.some((c) => String(c.id) === String(id))) return this.gone();
                // The list that a save posts is d.categories: when it no longer
                // matches the server (another tab, another session), load it
                // again first, or the save would write the old list back.
                if (Array.isArray(list)) {
                    const local = (d.categories || []).filter((c) => c.isSmartCollection !== true && c.isVirtualCategory !== true).map((c) => String(c.id)).sort().join('|');
                    const remote = list.map((c) => String(c.id)).sort().join('|');
                    if (local !== remote) await d.loadPageBookmarks?.(d.currentPageId, { skipInlineEditConfirm: true, forceFetch: true });
                }
            }
        } catch (_) { /* unreachable: the write will say so */ }
        if (!this.storedCategory(id)) return this.gone();
        return true;
    }

    gone() {
        this.dash.showNotification?.(this.t('editMode.goneNotice', 'That category is no longer there.'), 'info');
        this.mode.select(null);
        return false;
    }

    async saveName(selection, raw) {
        const d = this.dash;
        const text = String(raw || '').trim();
        if (!(await this.categoryAlive(selection.id))) return;
        const stored = this.storedCategory(selection.id);
        if (!stored) return;
        if (!text) { this.render(selection); return; }
        const previous = stored.name;
        const { icon } = this.splitName(previous);
        const next = `${icon ? `${icon} ` : ''}${text}`.trim();
        if (next === previous) return;
        stored.name = next;
        if ((await d.renderCore?.saveCategoryOrder?.()) === false) {
            stored.name = previous;
            d.showErrorNotification?.(this.t('editMode.saveFailed', 'Could not save.'));
        }
        d.renderDashboard?.({ animate: false });
    }

    bindCategory(selection) {
        const d = this.dash;
        const root = this.el.querySelector('[data-edit-section="category"]');
        if (!root) return;
        const name = root.querySelector('[data-edit-field="name"]');
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
        name.addEventListener('change', () => { void this.saveName(selection, name.value); });
        // The count of broken links comes from the Health report, which is a request of its own.
        const broken = root.querySelector('[data-edit-broken]');
        if (broken) {
            void this.healthIssues().then((issues) => {
                if (!broken.isConnected) return;
                if (!issues) { broken.closest('div')?.remove(); return; }
                broken.textContent = String(issues.filter((i) => String(i.pageId) === String(d.currentPageId)
                    && String(i.category ?? '') === String(selection.id) && (i.flags || []).includes('broken')).length);
            });
        }
        root.querySelectorAll('[data-edit-action="add-bookmark"], [data-edit-action="move-page"], [data-edit-action="delete"]').forEach((button) => {
            button.addEventListener('click', async () => {
                const id = button.getAttribute('data-edit-action');
                if (!(await this.categoryAlive(selection.id))) return;
                const stored = this.storedCategory(selection.id);
                if (!stored) return;
                await d.categoryMenu?.runAction?.(id, this.titleOf(selection.id), stored);
                if (id === 'delete') await this.categoryAlive(selection.id);
            });
        });
        root.querySelector('[data-edit-action="icon"]').addEventListener('click', async () => {
            if (!(await this.categoryAlive(selection.id))) return;
            const stored = this.storedCategory(selection.id);
            const titleEl = document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(String(selection.id))}"] .category-title`);
            if (stored && titleEl) await d.categoryMenu?.insertIcon?.(titleEl, stored);
        });
        root.querySelector('[data-edit-field="width"]').addEventListener('change', async (e) => {
            if (!(await this.categoryAlive(selection.id))) return;
            const stored = this.storedCategory(selection.id);
            const wantWide = e.target.value === 'wide';
            if (stored && Boolean(window.DashboardCategorySpan?.isCategorySpread?.(d, stored)) !== wantWide) d.categoryMenu?.toggleSpread?.(stored);
        });
        root.querySelector('[data-edit-field="view"]').addEventListener('change', async (e) => {
            if (!(await this.categoryAlive(selection.id))) return;
            const stored = this.storedCategory(selection.id);
            const wantTiles = e.target.value === 'tiles';
            if (stored && (stored.view === 'tiles') !== wantTiles) d.categoryMenu?.toggleView?.(stored);
        });
        root.querySelector('[data-edit-field="sort"]').addEventListener('change', async (e) => {
            if (!(await this.categoryAlive(selection.id))) return;
            window.DashboardCategorySort?.setCategorySortMode?.(d, selection.id, e.target.value);
            d.renderDashboard?.({ animate: false });
        });
    }

    // ── page ───────────────────────────────────────────────────────────

    pageOf(id) {
        return (this.dash.pages || []).find((p) => String(p.id) === String(id)) || null;
    }

    pageHtml(selection) {
        const page = this.pageOf(selection.id);
        if (!page) return `<div data-edit-section="other"><p class="edit-panel-note">${this.esc(this.t('editMode.gone', 'This page is no longer there.'))}</p></div>`;
        const colors = [null, '#e05252', '#e08852', '#d4bf4a', '#4cac6b', '#5285e0', '#8b5fe0', '#e052a8', '#52c8e0'];
        const swatches = colors.map((c) => `
            <label class="edit-panel-swatch"><input type="radio" name="edit-page-color" data-edit-field="page-color" value="${c || ''}" ${(page.color || null) === c ? 'checked' : ''}>
                <span style="background:${c || 'transparent'}" title="${c || this.esc(this.t('editMode.noColor', 'No colour'))}"></span></label>`).join('');
        const d = this.dash;
        const here = String(page.id) === String(d.currentPageId);
        const facts = this.facts([
            [this.t('editMode.factCategories', 'Categories'), here ? String((d.categories || []).length) : '…', here ? '' : 'data-edit-page-categories'],
            [this.t('editMode.factBookmarks', 'Bookmarks'), here ? String((d.allBookmarks || []).filter((b) => String(b.pageId) === String(page.id)).length || (d.bookmarks || []).length) : '…', here ? '' : 'data-edit-page-bookmarks'],
            [this.t('editMode.factWidgets', 'Widgets'), here ? String((d.widgets || []).length) : '…', here ? '' : 'data-edit-page-widgets'],
        ]);
        const actions = this.actions([
            ...(here ? [{ id: 'add-category', label: this.t('editMode.actionAddCategory', 'Add category') }] : []),
            ...(Number(page.id) !== 1 ? [{ id: 'delete-page', label: this.t('editMode.actionDeletePage', 'Delete page'), danger: true }] : []),
        ]);
        return `
            <div data-edit-section="page" data-edit-id="${this.esc(selection.id)}">
                ${facts}
                ${this.field('page-name', this.t('editMode.name', 'Name'), `<input type="text" class="config-text" data-edit-field="page-name" value="${this.esc(page.name)}" maxlength="40">`)}
                ${this.field('page-icon', this.t('editMode.emoji', 'Emoji'), `<input type="text" class="config-text" data-edit-field="page-icon" value="${this.esc(page.icon || '')}" maxlength="8">`)}
                <div class="config-bm-field"><span class="config-bm-field-label">${this.esc(this.t('editMode.color', 'Colour'))}</span><div class="edit-panel-swatches">${swatches}</div></div>
                ${actions}
            </div>`;
    }

    async savePage(selection, patch) {
        const d = this.dash;
        const page = this.pageOf(selection.id);
        if (!page) return;
        const previous = { name: page.name, icon: page.icon, color: page.color };
        Object.assign(page, patch);
        d.pageNav?.renderPageNavigation?.();
        try {
            const send = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
            const res = await send('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d.pages) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (String(page.id) === String(d.currentPageId)) d.pageNav?.updatePageTitle?.(page.name);
        } catch (error) {
            Object.assign(page, previous);
            d.pageNav?.renderPageNavigation?.();
            d.showErrorNotification?.(this.t('editMode.saveFailed', 'Could not save.'));
            this.render(selection);
        }
    }

    /** The counts of a page that is not in view: its lists, as the server has them. */
    async fillPageCounts(root, id) {
        const get = async (url) => {
            try {
                const res = await fetch(url, { cache: 'no-store' });
                return res.ok ? await res.json() : null;
            } catch (_) { return null; }
        };
        const [categories, bookmarks, blocks] = await Promise.all([
            get(`/api/categories?page=${encodeURIComponent(id)}`),
            get(`/api/bookmarks?page=${encodeURIComponent(id)}`),
            get(`/api/pages/${encodeURIComponent(id)}/blocks`),
        ]);
        const set = (attr, value) => {
            const el = root.querySelector(`[${attr}]`);
            if (!el?.isConnected) return;
            if (value === null) el.closest('div')?.remove();
            else el.textContent = String(value);
        };
        set('data-edit-page-categories', Array.isArray(categories) ? categories.length : null);
        set('data-edit-page-bookmarks', Array.isArray(bookmarks) ? bookmarks.length : null);
        set('data-edit-page-widgets', Array.isArray(blocks?.widgets) ? blocks.widgets.length : null);
    }

    bindPage(selection) {
        const root = this.el.querySelector('[data-edit-section="page"]');
        if (!root) return;
        const name = root.querySelector('[data-edit-field="page-name"]');
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
        name.addEventListener('change', () => {
            const value = name.value.trim();
            if (!value) { this.render(selection); return; }
            void this.savePage(selection, { name: value });
        });
        const icon = root.querySelector('[data-edit-field="page-icon"]');
        icon.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); icon.blur(); } });
        icon.addEventListener('change', () => { void this.savePage(selection, { icon: icon.value.trim() || undefined }); });
        root.querySelectorAll('[data-edit-field="page-color"]').forEach((input) => input.addEventListener('change', () => {
            void this.savePage(selection, { color: input.value || undefined });
        }));
        const d = this.dash;
        // A page that is not the one in view has its counts to be asked for.
        if (root.querySelector('[data-edit-page-categories]')) void this.fillPageCounts(root, selection.id);
        root.querySelector('[data-edit-action="add-category"]')?.addEventListener('click', () => d.categoryAdd?.open?.());
        root.querySelector('[data-edit-action="delete-page"]')?.addEventListener('click', async () => {
            await d.config?.deletePage?.(Number(selection.id));
            if (!this.pageOf(selection.id)) this.mode.select(null);
        });
    }

    // ── widget ─────────────────────────────────────────────────────────

    /** The widget on the page in view, by id. */
    widgetOf(id) {
        return (this.dash.widgets || []).find((w) => String(w?.id) === String(id)) || null;
    }

    widgetHtml(selection) {
        const widget = this.widgetOf(selection.id);
        if (!widget) return `<div data-edit-section="other"><p class="edit-panel-note">${this.esc(this.t('editMode.gone', 'This widget is no longer there.'))}</p></div>`;
        const menu = this.dash.categoryMenu;
        const wide = Boolean(menu?.widgetIsWide?.(widget));
        const locked = this.dash.settings?.lockLayout === true;
        const cannotWiden = !wide && menu?.widgetCanWiden?.() === false;
        const blocked = locked || cannotWiden;
        const widthWhy = locked
            ? this.t('editMode.widthLocked', 'The layout is locked')
            : this.t('widgetMenuWidthUnavailable', 'There is only one column to work with — a widget needs at least two to span.');
        const entry = (window.WidgetState?.snapshot?.() || []).find((e) => e.widgetId === String(selection.id));
        const state = entry
            ? (entry.state === 'error'
                ? this.t('editMode.widgetError', 'Did not load: {reason}').replace('{reason}', () => entry.reason || this.t('editMode.noAnswer', 'no answer'))
                : this.t('editMode.widgetEmpty', 'Loaded with nothing in it'))
            : this.t('editMode.widgetFine', 'Working, as far as this session has seen');
        const about = widget.type ? this.t(`config.widgetAbout.${widget.type}`, '') : '';
        const facts = this.facts([
            [this.t('editMode.factType', 'Type'), menu?.widgetName?.({ ...widget, title: '' }) || widget.type || ''],
            [this.t('editMode.factShows', 'Shows'), about && !about.startsWith('config.widgetAbout.') ? about : ''],
            ...this.settingRows(widget),
        ]);
        return `
            <div data-edit-section="widget" data-edit-id="${this.esc(selection.id)}">
                ${facts}
                ${this.field('widget-name', this.t('editMode.name', 'Name'), `<input type="text" class="config-text" data-edit-field="widget-name" value="${this.esc(widget.title || '')}" placeholder="${this.esc(menu?.widgetName?.({ ...widget, title: '' }) || widget.type || '')}" maxlength="80">`)}
                ${this.field('widget-width', this.t('editMode.width', 'Width'), this.select('widget-width',
                    [['one', this.t('editMode.widthOne', 'One column')], ['wide', this.t('editMode.widthWide', 'Wide')]], wide ? 'wide' : 'one', blocked))}
                ${this.widthNote(blocked, widthWhy)}
                <p class="edit-panel-note" data-edit-widget-state>${this.esc(state)}</p>
                <div class="edit-panel-actions">
                    <button type="button" class="config-btn config-btn--small" data-edit-action="widget-settings">${this.esc(this.t('editMode.widgetSettings', 'Settings…'))}</button>
                    ${window.DashboardBlockPageMove?.canMoveToPage?.(this.dash, widget.id) ? `<button type="button" class="config-btn config-btn--small" data-edit-action="widget-move">${this.esc(this.t('editMode.actionMove', 'Move to page…'))}</button>` : ''}
                    <button type="button" class="config-btn config-btn--small config-btn--danger" data-edit-action="widget-delete">${this.esc(this.t('editMode.actionDelete', 'Delete'))}</button>
                </div>
            </div>`;
    }

    bindWidget(selection) {
        const d = this.dash;
        const root = this.el.querySelector('[data-edit-section="widget"]');
        if (!root) return;
        const name = root.querySelector('[data-edit-field="widget-name"]');
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
        name.addEventListener('change', async () => {
            const widget = this.widgetOf(selection.id);
            if (!widget) return;
            const title = name.value.trim();
            const previous = String(widget.title || '');
            if (title === previous) return;
            widget.title = title;
            if (!(await d.renderCore?.saveWidgetPatch?.(widget.id, { title }))) {
                widget.title = previous;
                name.value = previous;
                return;
            }
            d.renderDashboard?.({ animate: false });
        });
        root.querySelector('[data-edit-field="widget-width"]').addEventListener('change', async (e) => {
            const widget = this.widgetOf(selection.id);
            if (!widget) return;
            const wantWide = e.target.value === 'wide';
            if (Boolean(d.categoryMenu?.widgetIsWide?.(widget)) === wantWide) return;
            await d.categoryMenu?.toggleWidgetWidth?.(widget);
            this.render(selection);
        });
        root.querySelector('[data-edit-action="widget-settings"]').addEventListener('click', async () => {
            // The sheet Config → Widgets uses, over this dashboard: the mode stays on.
            // The widgets code loads on demand, so it is asked for first.
            const ready = typeof d.config?.ensureSection === 'function' && await d.config.ensureSection('widgets');
            const opened = ready && typeof d.config.openWidgetSheetOverDashboard === 'function'
                && await d.config.openWidgetSheetOverDashboard(selection.id);
            if (!opened) d.showErrorNotification?.(this.t('editMode.sheetFailed', 'The widget settings could not be opened.'));
        });
        root.querySelector('[data-edit-action="widget-move"]')?.addEventListener('click', () => {
            const widget = this.widgetOf(selection.id);
            if (widget) void d.categoryMenu?.runWidgetAction?.('move-page', this.titleOf(selection.id), widget);
        });
        root.querySelector('[data-edit-action="widget-delete"]')?.addEventListener('click', async () => {
            // Through the sheet's own Delete: its question, its credential clean-up and its redraw.
            const ready = typeof d.config?.ensureSection === 'function' && await d.config.ensureSection('widgets');
            const opened = ready && typeof d.config.openWidgetSheetOverDashboard === 'function'
                && await d.config.openWidgetSheetOverDashboard(selection.id);
            const remove = opened && document.querySelector('#config-widget-overlay [data-widget-delete]');
            if (!remove) { d.showErrorNotification?.(this.t('editMode.sheetFailed', 'The widget settings could not be opened.')); return; }
            remove.click();
        });
    }

    bind(selection) {
        if (selection.kind === 'category') this.bindCategory(selection);
        else if (selection.kind === 'page') this.bindPage(selection);
        else if (selection.kind === 'widget') this.bindWidget(selection);
    }
}

window.DashboardEditModePanel = DashboardEditModePanel;
