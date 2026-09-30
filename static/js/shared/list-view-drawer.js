'use strict';
/**
 * The side panel a list view opens beside its rows.
 *
 * Grown in the Containers view and lifted out so Health and Inbox can have the
 * same one rather than a copy each. It owns the mechanics every view would
 * otherwise repeat:
 *
 *   - a host on <body>, not in the layout. An ancestor there contains
 *     position:fixed, which left the phone panel short of the screen;
 *   - placed below the page header, like Config -> Bookmarks' panel, so the
 *     header's own buttons stay reachable;
 *   - on a phone, fullscreen and holding the page's ScrollLock;
 *   - collapsible sections whose open state is remembered per view.
 *
 * What goes inside is the view's: open() takes a build function that fills
 * the panel, and ctx.section() hands it one section body at a time.
 */
(function (global) {
    const PHONE = '(max-width: 767px)';

    function loadSections(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            const arr = raw ? JSON.parse(raw) : null;
            return new Set(Array.isArray(arr) ? arr : fallback);
        } catch {
            return new Set(fallback);
        }
    }

    function saveSections(key, set) {
        try {
            localStorage.setItem(key, JSON.stringify([...set]));
        } catch {
            // Storage unavailable or full: sections just stop remembering.
        }
    }

    class ListViewDrawer {
        /*
         * closeOnOutside(target): opt-in. A press anywhere else on the page
         * closes the panel, unless this answers false for what was pressed --
         * a view keeps it open for a press that moves it to another row.
         * Presses in dialogs, menus and listboxes (a confirmation the panel
         * asked for, an autocomplete under one of its fields) never close it.
         */
        constructor({ id, storageKey, defaultSections = [], ariaLabel = null, onClose = null, closeLabel = 'Close', closeOnOutside = null }) {
            this.id = String(id);
            this.storageKey = storageKey;
            this.defaultSections = defaultSections;
            this.ariaLabel = ariaLabel;
            this.onClose = onClose;
            this.closeLabel = closeLabel;
            this.closeOnOutside = closeOnOutside;
            this._outside = (e) => this._onOutsidePress(e);
            this._host = null;
            this._panel = null;
            this._key = null;
            this._lockToken = null;
            this._openSections = loadSections(storageKey, defaultSections);
            this._onSectionToggle = null;
            this._place = () => this.place();
        }

        get host() { return this._host; }
        get panel() { return this._panel; }

        mount() {
            if (this._host) return this._host;
            const host = document.createElement('div');
            host.className = 'lvs-drawer-host';
            host.setAttribute('data-lvs-drawer', this.id);
            host.hidden = true;
            document.body.appendChild(host);
            this._host = host;
            window.addEventListener('scroll', this._place, { passive: true });
            window.addEventListener('resize', this._place, { passive: true });
            this.place();
            return host;
        }

        destroy() {
            this.close({ silent: true });
            window.removeEventListener('scroll', this._place);
            window.removeEventListener('resize', this._place);
            this._host?.remove();
            this._host = null;
        }

        /** The top edge of the view's layout, so the header stays reachable. */
        place() {
            const host = this._host;
            const layout = document.getElementById('dashboard-layout');
            if (!host || !layout) return;
            host.style.top = `${Math.max(0, Math.round(layout.getBoundingClientRect().top))}px`;
        }

        isOpen() {
            return Boolean(this._panel);
        }

        currentKey() {
            return this._key;
        }

        /**
         * Show the panel for one item. Opening while open rebuilds it for the
         * new key and keeps the scroll lock it already holds.
         *
         * build(panel, ctx): panel is the empty slab; ctx.head is its heading
         * row, ctx.actions a host for buttons, ctx.section(name, label) adds a
         * collapsible section and returns its body.
         */
        open(key, { title = '', build = null, onSectionToggle = null } = {}) {
            if (!this._host) this.mount();
            const host = this._host;
            this._key = key;
            this._onSectionToggle = onSectionToggle;
            this._acquireLock();
            if (this.closeOnOutside) document.addEventListener('pointerdown', this._outside, true);
            this.place();
            host.hidden = false;
            host.replaceChildren();

            // Two boxes: the frame carries the slab -- ground, corner, edges,
            // shadow -- and clips; the panel inside it scrolls. A panel that
            // was both scrolled its content up to its edges, and in Safari
            // over them.
            const frame = document.createElement('div');
            frame.className = 'lvs-drawer-frame';
            frame.setAttribute('data-lvs-drawer-panel', '');
            frame.setAttribute('role', 'dialog');
            frame.setAttribute('aria-label', this.ariaLabel ? this.ariaLabel(key) : String(title || key));
            const panel = document.createElement('div');
            panel.className = 'lvs-drawer';
            frame.appendChild(panel);
            // The page under the panel stays put while the panel is scrolled:
            // CSS contains the overscroll of a panel that scrolls, and this
            // covers one too short to, which the browser would pass straight
            // on to the page.
            panel.addEventListener('wheel', (e) => {
                if (panel.scrollHeight > panel.clientHeight) return;
                for (let el = e.target; el && el !== panel; el = el.parentElement) {
                    if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return;
                }
                e.preventDefault();
            }, { passive: false });

            const head = document.createElement('div');
            head.className = 'lvs-drawer-head';
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'lvs-drawer-close';
            close.setAttribute('aria-label', this.closeLabel);
            close.textContent = '×';
            close.addEventListener('click', () => this.close({ via: 'pointer' }));
            const heading = document.createElement('div');
            heading.className = 'lvs-drawer-heading';
            const titleEl = document.createElement('h3');
            titleEl.className = 'lvs-drawer-title';
            titleEl.textContent = String(title || '');
            heading.appendChild(titleEl);
            const actions = document.createElement('div');
            actions.className = 'lvs-drawer-actions';
            actions.setAttribute('data-lvs-drawer-actions', '');
            head.append(close, heading, actions);
            panel.appendChild(head);

            const ctx = {
                head,
                heading,
                title: titleEl,
                actions,
                section: (name, label) => this._section(panel, name, label),
            };
            this._panel = panel;
            host.appendChild(frame);
            if (typeof build === 'function') build(panel, ctx);
            return panel;
        }

        _section(panel, name, label) {
            const details = document.createElement('details');
            details.className = 'lvs-drawer-section';
            details.setAttribute('data-lvs-section', name);
            const summary = document.createElement('summary');
            summary.textContent = String(label || name);
            const body = document.createElement('div');
            body.className = 'lvs-drawer-section-body';
            details.append(summary, body);
            // Listening before the remembered state is applied, so a section
            // restored open still announces itself to the view.
            details.addEventListener('toggle', () => {
                if (details.open) this._openSections.add(name);
                else this._openSections.delete(name);
                saveSections(this.storageKey, this._openSections);
                this._onSectionToggle?.(name, details.open, body);
            });
            details.open = this._openSections.has(name);
            panel.appendChild(details);
            return body;
        }

        openSection(name) {
            const details = this._panel?.querySelector(`[data-lvs-section="${CSS.escape(name)}"]`);
            if (details && !details.open) details.open = true;
            details?.scrollIntoView?.({ block: 'nearest' });
        }

        _onOutsidePress(e) {
            const target = e.target;
            if (!this._panel || !(target instanceof Element)) return;
            if (this._host?.contains(target)) return;
            // dialog: a native <dialog> has the role without the attribute.
            if (target.closest('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .modal-overlay')) return;
            if (this.closeOnOutside(target) === false) return;
            this.close({ via: 'pointer' });
        }

        /** `via: 'pointer'` when the mouse closed it (× or a press beside it); onClose hears which. */
        close({ silent = false, via = 'keyboard' } = {}) {
            const wasOpen = this.isOpen();
            document.removeEventListener('pointerdown', this._outside, true);
            this._releaseLock();
            this._panel = null;
            this._key = null;
            this._onSectionToggle = null;
            if (this._host) {
                this._host.hidden = true;
                this._host.replaceChildren();
            }
            if (wasOpen && !silent) this.onClose?.(via);
        }

        _acquireLock() {
            if (this._lockToken) return;
            if (!global.matchMedia?.(PHONE).matches) return;
            this._lockToken = global.ScrollLock?.acquire(`lvs-drawer-${this.id}`) ?? null;
        }

        _releaseLock() {
            if (!this._lockToken) return;
            global.ScrollLock?.release(this._lockToken);
            this._lockToken = null;
        }
    }

    global.ListViewDrawer = ListViewDrawer;
}(typeof window !== 'undefined' ? window : globalThis));
