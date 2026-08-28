/**
 * Right-click menu on a category header: rename and delete.
 *
 * Both were reachable before, but barely — rename only through a 500 ms
 * long-press nothing advertises, delete only by going to config. Now that adding
 * a category takes one gesture on the grid, the other two belonging elsewhere is
 * the odd part.
 *
 * Deliberately not part of the bookmark context menu's lazy bundle: that module
 * carries the whole bookmark editor with it, and renaming a header should not
 * fetch it. The popover markup mirrors that menu's (.move-popover) so both look
 * like one feature.
 */
// What a reader does to scroll: the wheel, a finger, a drag on the scrollbar,
// a key. Watched in the capture phase so a scroller that stops propagation
// still counts.
const SCROLL_INTENT_EVENTS = ['wheel', 'touchmove', 'pointerdown', 'keydown'];

class DashboardCategoryMenu {
    constructor(dashboard) {
        this.dash = dashboard;
        this._cleanup = null;
    }

    t(key, fallback, replacements = {}) {
        return this.dash.formatDashboardLabel(key, replacements, fallback);
    }

    close() {
        this._cleanup?.();
    }

    /**
     * Bind a header. Smart collections and the tag-filter chunks are skipped:
     * they are views over bookmarks, not stored categories, so there is nothing
     * to rename or delete.
     */
    bindCategory(categoryEl, category) {
        if (!(categoryEl instanceof HTMLElement) || categoryEl.dataset.categoryMenuBound === '1') {
            return;
        }
        if (category?.isSmartCollection || category?.tagFilterChunk || category?.isVirtualCategory) {
            return;
        }
        const titleEl = categoryEl.querySelector('.category-title');
        if (!titleEl) {
            return;
        }
        categoryEl.dataset.categoryMenuBound = '1';

        titleEl.addEventListener('contextmenu', (e) => {
            const d = this.dash;
            if (e.shiftKey) return; // escape hatch to the native menu
            if (d.uiHelpers?.isModalOpen?.()) return;
            // The long-press rename owns the header while its input is up.
            if (titleEl.querySelector('.category-rename-input')) return;
            e.preventDefault();
            e.stopPropagation();
            // The Menu key raises this event too, with no pointer behind it —
            // taken literally the menu landed in the corner of the window.
            const fromPointer = e.detail > 0 || e.clientX > 0 || e.clientY > 0;
            const box = titleEl.getBoundingClientRect();
            this.show(titleEl, category, fromPointer
                ? { x: e.clientX, y: e.clientY }
                : { x: box.left + 8, y: box.bottom });
        });
    }

    /**
     * Bind a widget header to the same menu.
     *
     * A widget block is a `.category` to the grid and to DragReorder, and from
     * here it is one more kind of block with a name, a width and a way to be
     * put away. Renaming, resizing and closing one meant three trips through
     * Config -> Widgets; they are on the header now, where the category beside
     * it has had them all along.
     */
    bindWidget(blockEl, widget) {
        if (!(blockEl instanceof HTMLElement) || blockEl.dataset.widgetMenuBound === '1') {
            return;
        }
        const titleEl = blockEl.querySelector('.category-title');
        if (!titleEl || !widget?.id) {
            return;
        }
        blockEl.dataset.widgetMenuBound = '1';

        const openFor = (e, anchorEl, rowEl) => {
            const d = this.dash;
            if (e.shiftKey) return; // escape hatch to the native menu
            if (d.uiHelpers?.isModalOpen?.()) return;
            if (titleEl.querySelector('.category-rename-input')) return;
            e.preventDefault();
            e.stopPropagation();
            // The Menu key and Shift+F10 raise this with no pointer behind them;
            // taken literally the menu lands in the corner of the window.
            const fromPointer = e.detail > 0 || e.clientX > 0 || e.clientY > 0;
            const box = anchorEl.getBoundingClientRect();
            this.showWidget(titleEl, widget, fromPointer
                ? { x: e.clientX, y: e.clientY }
                : { x: box.left + 8, y: box.bottom }, rowEl);
        };

        titleEl.addEventListener('contextmenu', (e) => openFor(e, titleEl, null));

        /*
         * The same menu from a row inside the widget.
         *
         * A row that does something should say what, wherever the reader asks --
         * and asking is right-click, or Shift+F10 with the cursor on it, both of
         * which arrive here as one event. The row's own action leads the menu;
         * the widget's actions follow it, because the block under the row is
         * still the thing being pointed at.
         */
        const bodyEl = blockEl.querySelector('.dashboard-widget-body');
        bodyEl?.addEventListener('contextmenu', (e) => {
            const rowEl = e.target instanceof Element
                ? e.target.closest('button[data-widget-action]')
                : null;
            openFor(e, rowEl || bodyEl, rowEl);
        });
    }

    /** The menu for a widget: its name, its width, and putting it away. */
    showWidget(titleEl, widget, point, rowEl = null) {
        const wide = this.widgetIsWide(widget);
        const canWiden = this.widgetCanWiden();
        const rowEntries = this.widgetRowEntries(rowEl);
        const entries = [
            ...rowEntries,
            { id: 'rename', label: this.t('widgetMenuRename', 'Rename'), icon: '✎', key: 'F2' },
            {
                // The label says what the click will do, like the category's
                // spread entry above -- this list is verbs, and a tick beside a
                // constant label belongs to a radio submenu instead.
                id: 'width',
                label: wide
                    ? this.t('widgetMenuWidthOne', 'Back to one column')
                    : this.t('widgetMenuWidthTwo', 'Across two columns'),
                icon: '↔',
                key: 'Shift+W',
                detail: canWiden ? '' : this.t('widgetMenuWidthUnavailableShort', 'One column on this dashboard'),
                disabled: !canWiden && !wide,
            },
            {
                // Folding is on the header already -- click it, Enter, or the
                // fold-all key -- but the menu is where a reader looks to find
                // out what a block can do, and it was the one action missing.
                id: 'fold',
                label: this.widgetIsFolded(titleEl)
                    ? this.t('widgetMenuUnfold', 'Unfold')
                    : this.t('widgetMenuFold', 'Fold'),
                icon: '⌃',
                key: 'Enter',
            },
            {
                // Straight to this widget's own row in Config -> Widgets, rather
                // than opening the section and hunting for it among the others.
                id: 'settings',
                label: this.t('widgetMenuSettings', 'Settings…'),
                icon: '⚙',
            },
            {
                // Closing is not deleting: the widget keeps its settings and any
                // sign-in it holds, and the Shown switch in Config -> Widgets is
                // the same flag. Deleting stays there, where the consequences
                // are spelled out.
                id: 'close',
                label: this.t('widgetMenuClose', 'Close'),
                icon: '✕',
                key: 'Delete',
                danger: true,
            },
        ];

        this._openMenu({
            id: 'widget-context-menu',
            ariaLabel: this.t('widgetMenuTitle', 'Widget actions'),
            // The row when the menu was opened on one: the hint says what is
            // being acted on, and on a row that is the row.
            hint: rowEl ? this.widgetRowName(rowEl) : this.widgetName(widget),
            entries,
            point,
            onPick: (action) => { void this.runWidgetAction(action, titleEl, widget, rowEl); },
        });
    }

    /**
     * What the row under the pointer offers, if anything.
     *
     * Read off the row rather than guessed: the widget wrote its action there
     * when it bound the click, so the menu names the same thing that happens on
     * a click instead of a second description that can drift from it. A row that
     * carries an address gets the second entry a bookmark row has.
     */
    widgetRowEntries(rowEl) {
        const action = rowEl?.dataset?.widgetAction;
        if (!action) {
            return [];
        }
        const entries = [{ id: 'row-open', label: action, icon: '→', key: 'Enter' }];
        if (rowEl.dataset.widgetHref) {
            entries.push({
                id: 'row-open-tab',
                label: this.t('widgetMenuOpenNewTab', 'Open in a new tab'),
                icon: '↗',
                key: 'Ctrl+Enter',
            });
        }
        entries.push({ separator: true });
        return entries;
    }

    /** The row's own text, trimmed to something a menu hint can carry. */
    widgetRowName(rowEl) {
        const text = String(rowEl?.textContent || '').trim().replace(/\s+/g, ' ');
        return text.length > 48 ? `${text.slice(0, 47)}…` : (text || '—');
    }

    /** Whether the block behind this header is folded shut. */
    widgetIsFolded(titleEl) {
        return titleEl?.closest('.category')?.getAttribute('data-collapsed') === 'true';
    }

    /** What the header shows: the widget's own title, or its type's name. */
    widgetName(widget) {
        const given = String(widget?.title || '').trim();
        return given || this.dash.renderCore?.widgetTypeLabel?.(widget?.type) || 'widget';
    }

    widgetIsWide(widget) {
        return Number(widget?.config?.columns) === 2;
    }

    /*
     * Whether there is a second column to spread into.
     *
     * The grid narrows a wide widget to what it has rather than dropping it, so
     * offering the width on a one-column dashboard would be offering a setting
     * with no visible effect. A widget that is already wide keeps the entry, so
     * a reader on a narrow window can still put it back.
     */
    widgetCanWiden() {
        return Number(this.dash.renderCore?.getEffectiveColumnsPerRow?.()) > 1;
    }

    async runWidgetAction(action, titleEl, widget, rowEl = null) {
        const d = this.dash;
        window.nextdashTrack?.('widget:context-menu', { action });

        if (action === 'row-open') {
            rowEl?.click();
            return;
        }
        if (action === 'row-open-tab') {
            const href = rowEl?.dataset?.widgetHref;
            if (href) window.open(href, '_blank', 'noopener');
            return;
        }
        if (action === 'fold') {
            // Through the header's own click handler, so folding from the menu
            // and folding by clicking cannot end up as two behaviours.
            titleEl?.click();
            return;
        }
        if (action === 'settings') {
            window.DashboardWidgetUtils?.openConfigTab?.(d, 'widgets');
            return;
        }
        if (action === 'rename') {
            this.startWidgetRename(titleEl, widget);
            return;
        }
        if (action === 'width') {
            await this.toggleWidgetWidth(widget);
            return;
        }
        if (action === 'close') {
            await this.closeWidget(widget);
        }
    }

    /**
     * Rename from the header, through the editor the category next to it uses.
     *
     * An empty title is a title here: the widget falls back to its type's name,
     * which is what the placeholder in Config -> Widgets has always promised.
     */
    startWidgetRename(titleEl, widget) {
        const d = this.dash;
        const nameSpan = titleEl?.querySelector('.category-title-name');
        if (!nameSpan) return;
        d.renderCore?._startBlockRename?.(titleEl, nameSpan, {
            value: String(widget.title || ''),
            ariaKey: 'renameWidgetAria',
            ariaFallback: 'Rename widget',
            allowEmpty: true,
            displayFor: (name) => String(name || '').trim() || this.widgetName({ ...widget, title: '' }),
            onCommit: async (title) => {
                const previous = String(widget.title || '');
                widget.title = title;
                if (!await d.renderCore?.saveWidgetPatch?.(widget.id, { title })) {
                    widget.title = previous;
                    nameSpan.textContent = this.widgetName(widget).toLowerCase();
                }
            },
        });
    }

    /** One column to two and back, from the header or from Shift+W. */
    async toggleWidgetWidth(widget) {
        const d = this.dash;
        const wide = this.widgetIsWide(widget);
        if (!wide && !this.widgetCanWiden()) {
            d.showNotification?.(this.t('widgetMenuWidthUnavailable',
                'There is only one column to work with — a widget needs at least two to span.'), 'info');
            return false;
        }
        // undefined rather than 1: the default is the key being absent, which is
        // what the config panel and the server both store for one column.
        const next = wide ? undefined : 2;
        if (!await d.renderCore?.saveWidgetPatch?.(widget.id, { config: { columns: next } })) {
            return false;
        }
        widget.config = { ...(widget.config || {}) };
        if (next === undefined) delete widget.config.columns; else widget.config.columns = next;
        // Not renderDashboard directly: a full draw resets the scroll to the top
        // of the document, and the reader is looking at this widget.
        d.renderCore?.redrawKeepingPlace?.(widget.id);
        return true;
    }

    /**
     * Put a widget away.
     *
     * `enabled: false` is the Shown switch in Config -> Widgets, so this is the
     * same state reached from either side rather than a second kind of hidden.
     * No confirm -- nothing is lost and the toast carries the way back, both to
     * undo it here and to the switch that turns it on again later.
     */
    async closeWidget(widget) {
        const d = this.dash;
        const name = this.widgetName(widget);
        if (!await d.renderCore?.saveWidgetPatch?.(widget.id, { config: { enabled: false } })) {
            return false;
        }
        widget.config = { ...(widget.config || {}), enabled: false };
        d.renderCore?.redrawKeepingPlace?.(widget.id);
        d.showNotification?.(
            this.t('widgetClosed', '“{name}” closed. Switch it back on under Config → Widgets.', { name }),
            'success',
            {
                duration: 8000,
                undoCallback: async () => {
                    if (!await d.renderCore?.saveWidgetPatch?.(widget.id, { config: { enabled: undefined } })) {
                        return;
                    }
                    widget.config = { ...(widget.config || {}) };
                    delete widget.config.enabled;
                    d.renderCore?.redrawKeepingPlace?.(widget.id);
                    d.showNotification?.(this.t('widgetClosedUndone', 'Widget back on the page.'), 'success');
                },
            },
        );
        return true;
    }

    show(titleEl, category, point) {
        // `key` is the keyboard route to the same action, shown as a chip so the
        // menu teaches its own shortcuts. Untranslated, like every other key
        // hint in the app.
        const span = window.DashboardCategorySpan;
        const blockedReason = span?.spreadUnavailableReason(this.dash) || null;
        const canSpread = blockedReason === null;
        const isSpread = span?.isCategorySpread(this.dash, category) === true;
        const actions = [
            { id: 'rename', label: this.t('categoryMenuRename', 'Rename'), icon: '✎', key: 'F2' },
            {
                // A switch, not a size: how many columns a spread category
                // takes follows from the items-per-category limit and how many
                // bookmarks are in it, so there is nothing to choose.
                //
                // The label says what the click will do, the way Pin/Unpin does
                // one entry down in the bookmark menu — this list is verbs, and
                // a constant label with a tick beside it belongs to the radio
                // submenus instead. It is deliberately not marked `checked`:
                // paired with a label that already flips, a screen reader would
                // announce "spread across columns, ticked" for the entry that
                // undoes exactly that.
                id: 'spread',
                label: isSpread
                    ? this.t('categoryMenuUnspread', 'Back to one column')
                    : this.t('categoryMenuSpread', 'Spread across columns'),
                icon: '↔',
                key: 'Shift+W',
                detail: canSpread ? '' : this.spreadUnavailableText(blockedReason, true),
                disabled: !canSpread,
            },
            // Category.Icon has been in the model, persisted and rendered since
            // categories had icons at all — an uploaded image or an emoji, with
            // ⊣ as the fallback — and there was nowhere to set it. New
            // categories got icon:'', the config row has only a name field, and
            // the inline rename edits the name. The locale strings for this
            // control were still sitting in all four files with no caller: it
            // fell out at some point and left eight identical headers behind.
            { id: 'icon', label: this.t('categoryMenuIcon', 'Icon…'), icon: '☺' },
            { id: 'add', label: this.t('categoryMenuAdd', 'Add category'), icon: '+', key: 'c' },
            { id: 'delete', label: this.t('categoryMenuDelete', 'Delete'), icon: '✕', danger: true, key: 'Delete' },
        ];

        this._openMenu({
            id: 'category-context-menu',
            ariaLabel: this.t('categoryMenuTitle', 'Category actions'),
            hint: String(category.name || category.id || '').trim() || '—',
            entries: actions,
            point,
            onPick: (action) => {
                if (action === 'spread') {
                    this.toggleSpread(category);
                    return;
                }
                void this.runAction(action, titleEl, category);
            },
        });
    }

    /**
     * A one-field popover for the category's icon.
     *
     * Modelled on the page-tab popover rather than a modal: this is one short
     * string, it belongs beside the header it changes, and Enter/Escape are the
     * whole interaction. Emoji or a couple of characters — the renderer already
     * accepts an uploaded image path here too, but choosing a file is the
     * config's job, and typing an emoji is what people actually do.
     *
     * Saved through the same categories payload the drag reorder and rename
     * already use, so there is one write path rather than a second one that
     * could disagree about what a category is.
     */
    openIconEditor(titleEl, category) {
        const d = this.dash;
        if (!titleEl || !category) return;
        document.querySelector('.category-icon-popover')?.remove();

        const popover = document.createElement('div');
        popover.className = 'category-icon-popover';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'category-icon-input';
        input.value = String(category.icon || '');
        input.maxLength = 4;
        input.setAttribute('aria-label', this.t('categoryIconLabel', 'Category icon'));
        input.placeholder = this.t('categoryIconPlaceholder', 'icon');

        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'category-icon-clear';
        clear.textContent = this.t('categoryIconClear', 'Clear');

        popover.append(input, clear);
        document.body.appendChild(popover);

        const rect = titleEl.getBoundingClientRect();
        popover.style.top = `${Math.round(rect.bottom + window.scrollY + 4)}px`;
        popover.style.left = `${Math.round(rect.left + window.scrollX)}px`;

        // Live preview: the header shows what you are typing, so the choice is
        // made against the thing itself rather than against a field. Written
        // straight into the icon span — a full re-render per keystroke would
        // rebuild the grid to change one character.
        const previewEl = () => document.querySelector(
            `.category[data-category-id="${CSS.escape(String(category.id))}"] .category-title-icon`
        );
        const original = String(category.icon || '');
        const preview = (value) => {
            const el = previewEl();
            if (el) el.textContent = `${String(value || '').trim() || '▣'} `;
        };

        let done = false;
        const close = ({ restore = false } = {}) => {
            if (done) return;
            done = true;
            document.removeEventListener('mousedown', onOutside, true);
            popover.remove();
            // Leaving without choosing puts back what was there: browsing is not
            // choosing, the same rule the type-size preview follows.
            if (restore) preview(original);
        };
        const commit = async (value) => {
            const next = String(value ?? input.value).trim().slice(0, 4);
            const previous = String(category.icon || '');
            close();
            if (next === previous) return;
            category.icon = next;
            // Mirror it onto the array the save reads: the object handed to the
            // menu can be a copy of the row rather than the stored category.
            const stored = (d.categories || []).find((c) => String(c.id) === String(category.id));
            if (stored) stored.icon = next;
            d.renderDashboard?.({ animate: false });
            try {
                await d.renderCore?.saveCategoryOrder?.({ pageId: Number(d.currentPageId) });
            } catch (_error) {
                if (stored) stored.icon = previous;
                category.icon = previous;
                d.renderDashboard?.({ animate: false });
                preview(previous);
                d.showErrorNotification?.(this.t('categoryIconFailed', 'Could not save the icon'));
            }
        };
        const onOutside = (e) => {
            if (!popover.contains(e.target)) close({ restore: true });
        };

        input.addEventListener('input', () => preview(input.value));
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                void commit(input.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                close({ restore: true });
            }
        });
        clear.addEventListener('click', () => {
            preview('');
            void commit('');
        });
        setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
        input.focus();
        input.select();
    }

    /**
     * Flip spreading for one category.
     *
     * Shared with Shift+W, which is why it is a method rather than a closure in
     * the menu above.
     */
    toggleSpread(category) {
        const d = this.dash;
        const span = window.DashboardCategorySpan;
        if (!span) {
            return false;
        }
        const blocked = span.spreadUnavailableReason(d);
        if (blocked) {
            d.showNotification?.(this.spreadUnavailableText(blocked, false), 'info');
            return false;
        }
        const next = span.toggleCategorySpread(d, category.id);
        window.nextdashTrack?.('category:spread', { on: next });
        span.refreshCategorySpreadUi(d, category.id);
        return next;
    }

    /**
     * Why spreading is out of reach, long or short.
     *
     * Short goes beside the menu entry, long into a toast — the same two
     * reasons either way, so they are written in one place.
     */
    spreadUnavailableText(reason, short) {
        if (reason === 'unlimited-items') {
            return short
                ? this.t('categorySpreadNeedsLimitShort', 'Needs an items-per-category limit')
                : this.t('categorySpreadNeedsLimit',
                    'Spreading needs a limit on items per category — that limit is what decides how many columns a category takes. Set one in Config → Appearance → Layout.');
        }
        return short
            ? this.t('categorySpreadUnavailableShort', 'One column per category here')
            : this.t('categorySpreadUnavailable',
                'There is only one column to work with — spreading needs at least two.');
    }

    _openMenu({ id, ariaLabel, hint, entries, point, onPick, focusIndex = 0 }) {
        const d = this.dash;
        this.close();

        const pop = document.createElement('div');
        pop.id = id;
        pop.className = 'move-popover bookmark-context-menu';
        pop.setAttribute('role', 'menu');
        pop.setAttribute('aria-label', ariaLabel);

        if (hint) {
            const nameHint = document.createElement('div');
            nameHint.className = 'move-popover-current-hint';
            nameHint.textContent = hint;
            pop.appendChild(nameHint);
        }

        const items = [];
        entries.forEach((action) => {
            // A rule of its own, for a menu built of two halves -- what the row
            // does, then what the block does.
            if (action.separator) {
                const rule = document.createElement('div');
                rule.className = 'move-popover-divider';
                pop.appendChild(rule);
                return;
            }
            if (action.danger) {
                const divider = document.createElement('div');
                divider.className = 'move-popover-divider';
                pop.appendChild(divider);
            }
            const item = document.createElement('div');
            item.className = 'move-popover-item'
                + (action.danger ? ' is-danger' : '')
                + (action.disabled ? ' is-disabled' : '');
            item.setAttribute('role', 'menuitem');
            item.setAttribute('data-action', action.id);
            if (action.checked) {
                item.setAttribute('aria-checked', 'true');
            }
            if (action.disabled) {
                item.setAttribute('aria-disabled', 'true');
            }

            const check = document.createElement('span');
            check.className = 'move-popover-check';
            check.textContent = action.icon || '';
            item.appendChild(check);

            const label = document.createElement('span');
            label.textContent = action.label;
            item.appendChild(label);

            if (action.detail) {
                const detail = document.createElement('span');
                detail.className = 'move-popover-item-detail';
                detail.textContent = action.detail;
                item.appendChild(detail);
            }

            if (action.submenu) {
                const caret = document.createElement('span');
                caret.className = 'move-popover-submenu-caret';
                caret.textContent = '›';
                caret.setAttribute('aria-hidden', 'true');
                item.appendChild(caret);
            }

            if (action.key) {
                const kbd = document.createElement('kbd');
                kbd.className = 'move-popover-item-key';
                kbd.textContent = action.key;
                // The chip is a label, not a second thing to read out: the item
                // already says what it does. aria-keyshortcuts is how the key
                // reaches a screen reader instead.
                kbd.setAttribute('aria-hidden', 'true');
                item.setAttribute('aria-keyshortcuts',
                    window.ShortcutFormat?.ariaKeys?.(action.key) || action.key);
                item.appendChild(kbd);
            }

            pop.appendChild(item);
            items.push(item);
        });

        document.body.appendChild(pop);
        this._positionAtPoint(pop, point);
        window.FocusTrapUtils?.syncDashboardInert?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        const previousFocus = document.activeElement;
        let focusedIdx = focusIndex;
        const setFocus = (idx) => {
            focusedIdx = ((idx % items.length) + items.length) % items.length;
            items.forEach((el, i) => {
                el.classList.toggle('is-focused', i === focusedIdx);
                if (i === focusedIdx) {
                    el.setAttribute('tabindex', '0');
                    el.focus({ preventScroll: true });
                } else {
                    el.setAttribute('tabindex', '-1');
                }
            });
        };

        let onOutside = null;
        // A scroll closes the menu, but only one the reader asked for. Any
        // re-render of the grid empties the column for an instant, the document
        // gets shorter, and the browser clamps scrollTop back into range --
        // which fires `scroll` just like a real one and used to take the open
        // menu down with it. Wheel, touch, pointer and key are the marks a
        // reader leaves; the clamp leaves none, so it no longer counts.
        const INTENT_WINDOW_MS = 500;
        let lastIntentAt = -Infinity;
        const markScrollIntent = () => { lastIntentAt = performance.now(); };
        const onScroll = () => {
            if (performance.now() - lastIntentAt <= INTENT_WINDOW_MS) close();
        };
        const close = () => {
            if (pop.parentNode) pop.remove();
            document.removeEventListener('keydown', onKey, true);
            if (onOutside) {
                document.removeEventListener('click', onOutside);
                document.removeEventListener('contextmenu', onOutside);
                onOutside = null;
            }
            SCROLL_INTENT_EVENTS.forEach((type) => {
                document.removeEventListener(type, markScrollIntent, true);
            });
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', onScroll, true);
            if (this._cleanup === close) this._cleanup = null;
            if (previousFocus && typeof previousFocus.focus === 'function') {
                previousFocus.focus({ preventScroll: true });
            }
            window.FocusTrapUtils?.syncDashboardInert?.();
        };
        this._cleanup = close;

        const confirm = (item) => {
            if (item.getAttribute('aria-disabled') === 'true') {
                return;
            }
            const action = item.getAttribute('data-action');
            close();
            onPick(action);
        };

        const hasSubmenu = (item) => item.querySelector('.move-popover-submenu-caret') !== null;

        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setFocus(focusedIdx + 1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setFocus(focusedIdx - 1); return; }
            // ArrowRight opens a submenu, the convention in every native menu.
            if (e.key === 'ArrowRight' && items[focusedIdx] && hasSubmenu(items[focusedIdx])) {
                e.preventDefault();
                e.stopImmediatePropagation();
                confirm(items[focusedIdx]);
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (items[focusedIdx]) confirm(items[focusedIdx]);
            }
        };

        items.forEach((item, idx) => {
            item.addEventListener('mouseenter', () => setFocus(idx));
            item.addEventListener('click', () => confirm(item));
        });

        document.addEventListener('keydown', onKey, true);
        // Registered after onKey on purpose: the keys the menu handles itself
        // stop there, so moving through the menu never reads as scroll intent.
        SCROLL_INTENT_EVENTS.forEach((type) => {
            document.addEventListener(type, markScrollIntent, { capture: true, passive: true });
        });
        window.addEventListener('resize', close);
        window.addEventListener('scroll', onScroll, true);
        setTimeout(() => {
            onOutside = (e) => { if (!pop.contains(e.target)) close(); };
            document.addEventListener('click', onOutside);
            document.addEventListener('contextmenu', onOutside);
        }, 0);
        requestAnimationFrame(() => setFocus(focusIndex));
    }

    _positionAtPoint(pop, point) {
        const margin = 8;
        const rect = pop.getBoundingClientRect();
        let left = point.x;
        let top = point.y;
        if (left + rect.width + margin > window.innerWidth) {
            left = Math.max(margin, window.innerWidth - rect.width - margin);
        }
        if (top + rect.height + margin > window.innerHeight) {
            top = Math.max(margin, window.innerHeight - rect.height - margin);
        }
        pop.style.left = `${Math.max(margin, left)}px`;
        pop.style.top = `${Math.max(margin, top)}px`;
    }

    /**
     * Drop the trash entry for a category the undo has just put back, so it does
     * not sit in the trash shadowing a live category.
     *
     * Best-effort: a stale entry is untidy, a failed undo is not.
     */
    async _dropCategoryTrashEntry(pageId, categoryId) {
        try {
            const data = await window.DashboardTrash?.list?.();
            const hit = (data?.items || []).find((item) => item.kind === 'category'
                && Number(item.pageId) === Number(pageId)
                && String(item.trashedCategory?.category?.id || '') === String(categoryId));
            if (hit) {
                await window.DashboardTrash.remove(hit.id);
            }
        } catch (_error) {
            /* leave it; the restore itself already succeeded */
        }
    }

    async runAction(action, titleEl, category) {
        const d = this.dash;
        window.nextdashTrack?.('category:context-menu', { action });

        if (action === 'add') {
            d.categoryAdd?.open();
            return;
        }

        if (action === 'rename') {
            // Reuse the long-press editor rather than a second rename surface, so
            // both routes commit through the same code.
            const nameSpan = titleEl.querySelector('.category-title-name');
            if (nameSpan) {
                d.renderCore?._startCategoryRename?.(titleEl, nameSpan, category);
            }
            return;
        }

        if (action === 'icon') {
            this.openIconEditor(titleEl, category);
            return;
        }

        if (action === 'delete') {
            const pageId = d.currentPageId;
            const name = String(category.name || category.id || '');
            const count = d.structureCreate.countBookmarksInCategory(category.id);
            // The bookmarks survive but lose their category and reappear under
            // "unknown category" — invisible from here, so it goes in the prompt.
            const message = count > 0
                ? this.t(
                    'categoryDeleteWithBookmarks',
                    'Delete “{name}”? Its {n} bookmarks are kept but lose their category.',
                    { name, n: count },
                )
                : this.t('categoryDeleteConfirm', 'Delete “{name}”?', { name });
            const ok = typeof window.AppModal?.danger === 'function'
                ? await window.AppModal.danger({
                    title: this.t('categoryMenuDelete', 'Delete'),
                    message,
                    confirmText: this.t('categoryMenuDelete', 'Delete'),
                })
                : window.confirm(message);
            if (!ok) {
                return;
            }
            const result = await d.structureCreate.deleteCategory(pageId, category.id);
            if (result.error) {
                d.showErrorNotification?.(result.error);
                return;
            }
            await d.loadPageBookmarks(pageId, { skipInlineEditConfirm: true });

            // Deleting from a right-click menu is one slip away from a misclick,
            // so the confirm is not the only safety net.
            d.showNotification?.(
                this.t('categoryDeleted', 'Category deleted.'),
                'success',
                {
                    duration: 8000,
                    undoCallback: async () => {
                        const undone = await d.structureCreate.restoreCategories(pageId, result.before);
                        if (undone.error) {
                            d.showErrorNotification?.(undone.error);
                            return;
                        }
                        await d.loadPageBookmarks(pageId, { skipInlineEditConfirm: true });
                        // Restored through the categories endpoint, so its trash
                        // entry now shadows a live category. Dropping it goes
                        // straight through the trash module, which config does
                        // not need to be loaded for.
                        await this._dropCategoryTrashEntry(pageId, category.id);
                        await d.config?.instance?.refreshTrashIfVisible?.();
                        d.showNotification?.(
                            this.t('categoryDeleteUndone', 'Category restored.'),
                            'success',
                        );
                    },
                },
            );
        }
    }
}

window.DashboardCategoryMenu = DashboardCategoryMenu;
