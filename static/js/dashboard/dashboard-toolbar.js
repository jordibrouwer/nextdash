/**
 * Toolbar actions, tooltips, header enhancements.
 */
class DashboardToolbar {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    /**
     * The buttons that have a key, and which key.
     *
     * One list feeds two things: the hover tooltip and
     * the aria-keyshortcuts stamped on the buttons themselves. They used to be
     * three lists, which is how the header row ended up with tooltips and no
     * aria at all.
     */
    shortcutButtonDefs() {
        const d = this.dash;
        return [
            { id: 'quick-add-toolbar-btn', labelKey: 'dashboard.tooltipAddBookmark', keys: ['+'] },
            { id: 'search-button', labelKey: 'dashboard.tooltipSearch', keys: ['>'] },
            { id: 'commands-button', labelKey: 'dashboard.tooltipCommands', keys: [':'] },
            { id: 'finders-button', labelKey: 'dashboard.tooltipFinders', keys: ['?'] },
            { id: 'recent-bookmarks-button', labelKey: 'dashboard.tooltipRecent', keys: ['*'] },
            { id: 'tag-cloud-toggle-btn', labelKey: 'dashboard.tagCloudToggleAria', keys: ['/'] },
            { id: 'collapse-all-button', labelKey: 'dashboard.collapseAllLabel', keys: ['.'] },
            { id: 'help-button', labelKey: 'dashboard.tooltipCheatsheet', keys: ['!', 'F1'] },
            // No key: the star is a button you click, and a chip reading "★"
            // told people to press a key that does not exist.
            { id: 'whats-new-btn', labelKey: 'dashboard.whatsNewAria', keys: [] },
            // An action button like the rest, not a header destination.
            { id: 'page-overview-header-btn', labelKey: 'dashboard.pagesOverview', keys: [','] },
            {
                selector: '#page-nav-inbox-btn',
                labelKey: 'dashboard.inboxPageTitle',
                keys: ['Shift+I'],
                header: true,
                when: () => d.inbox?.isEnabled?.() && d.settings?.inboxShowInPageTabs !== false,
            },
            {
                selector: '.health-link-anchor',
                labelKey: 'dashboard.health',
                keys: ['Shift+H'],
                header: true,
                when: () => d.health?.isEnabled?.(),
            },
            {
                selector: '.config-link-anchor',
                labelKey: 'dashboard.config',
                keys: ['Shift+S'],
                header: true,
                when: () => d.config?.isEnabled?.(),
            },
        ];
    }

    /**
     * Stamp aria-keyshortcuts on every button that has a key.
     *
     * Separate from the tooltips on purpose: those are a desktop hover affordance
     * and can be switched off in settings, while this is the only way the keys
     * reach a screen reader — so it runs on touch devices and with the tooltips
     * turned off as well.
     */
    syncShortcutAriaHints() {
        const SF = window.ShortcutFormat;
        this.shortcutButtonDefs().forEach((def) => {
            const btn = def.id ? document.getElementById(def.id) : document.querySelector(def.selector);
            if (!btn) return;
            const usable = def.keys.length && (!def.when || def.when());
            if (!usable) {
                btn.removeAttribute('aria-keyshortcuts');
                return;
            }
            // Several keys for one button is a space-separated list in this
            // attribute, not a chord.
            btn.setAttribute('aria-keyshortcuts',
                def.keys.map((key) => SF?.ariaKeys?.(key) || key).join(' '));
        });
    }

    setupToolbarActions() {
        const d = this.dash;
        this.setupToolbarKbdTooltips();
        this.syncShortcutAriaHints();
        const helpButton = document.getElementById('help-button');
        if (helpButton) {
            helpButton.addEventListener('click', () => {
                d.showKeyboardCheatSheet();
            });
        }
        const recentButton = document.getElementById('recent-bookmarks-button');
        if (recentButton) {
            recentButton.addEventListener('click', () => {
                d.toggleRecentBookmarksModal();
            });
        }

        // What's new (corner FAB below tag cloud)
        const whatsNewBtn = document.getElementById('whats-new-btn');
        if (whatsNewBtn) {
            whatsNewBtn.addEventListener('click', () => {
                window.openWhatsNewModal?.({ force: true });
            });
        }


        // Launcher tile dimming: dim non-matching tiles when search is active
        document.addEventListener('nextdash:find', (e) => {
            d.applyFindFilter(e.detail.query);
        });

        document.addEventListener('nextdash:launcher-filter', (e) => {
            const grid = document.getElementById('dashboard-layout');
            if (!grid || !grid.classList.contains('layout-launcher')) return;
            const { active, urls } = e.detail;
            grid.querySelectorAll('.bookmark-link').forEach(tile => {
                const rowUrl = tile.getAttribute('data-bookmark-url') || '';
                const urlKey = d.canonicalBookmarkURLKey(rowUrl);
                if (!active || urls.size === 0) {
                    tile.classList.remove('launcher-dim');
                } else {
                    tile.classList.toggle('launcher-dim', !urls.has(urlKey));
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            const isTypingContext = Boolean(
                e.target && (
                    e.target.tagName === 'INPUT' ||
                    e.target.tagName === 'TEXTAREA' ||
                    e.target.isContentEditable
                )
            );

            if (isTypingContext) {
                return;
            }

            // Guarded like the two keys below, with one difference: this key
            // also closes its own modal, so a recent list already on screen is
            // not "a modal is open, keep out". toggleRecentBookmarksModal()
            // refuses to stack on top of another modal by itself; swallowing the
            // key here as well keeps it from reaching anything behind.
            /*
             * `*` opens the panel in its recents mode.
             *
             * The recents panel is still there for anyone who switches its
             * button back on; what the key reaches is the mode, because two
             * surfaces for one list is the thing the header was carrying.
             */
            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '*'
                && d.settings?.showRecentButton === false) {
                if (!d.isBookmarksView() || d.isModalOpen()) {
                    return;
                }
                if (d.searchComponent?.isActive?.()) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                d.searchComponent?.openInRecentMode?.();
                return;
            }
            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '*') {
                // Recent bookmarks is a dashboard button; inert in a
                // full-container view. (! stays live everywhere -- see below --
                // and is deliberately not given this same guard.)
                if (!d.isBookmarksView()) {
                    return;
                }
                const ownModalOpen = d.isRecentBookmarksModalOpen?.() === true;
                if (!ownModalOpen && d.isModalOpen()) {
                    return;
                }
                if (d.searchComponent && d.searchComponent.isActive()) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                d.toggleRecentBookmarksModal();
            }

            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '!') {
                if (d.isModalOpen()) {
                    return;
                }
                if (window.DashboardTagCloud?.modalOpen) {
                    return;
                }
                if (d.searchComponent && d.searchComponent.isActive()) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                d.showKeyboardCheatSheet();
            }

            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '.') {
                // Fold-all is a dashboard button; inert in a full-container view.
                if (!d.isBookmarksView()) {
                    return;
                }
                if (d.isModalOpen()) {
                    return;
                }
                if (window.DashboardTagCloud?.modalOpen) {
                    return;
                }
                if (d.searchComponent && d.searchComponent.isActive()) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                d.toggleAllCategoriesCollapsed();
            }

            // c lives in keyboard-navigation.js, not here: it only acts on a hold
            // (so a tap still types into the shortcut search), and that timer sits
            // with the g chord's.
        });
    }


    /**
     * Whether the shortcut popovers may appear at all.
     *
     * Off unless switched on. They shipped on, were written into every stored
     * settings file, and were turned off for everyone in 63ef3566 by migration
     * rather than by changing a default — so what decides this is the stored
     * value, and an install that has never chosen has `false` written in it.
     * The `!== false` shape is kept for the one case it still covers: a
     * settings file written before the key existed.
     */
    shortcutTooltipsEnabled() {
        return this.dash.settings?.showShortcutTooltips !== false;
    }

    setupToolbarKbdTooltips() {
        const d = this.dash;
        if (d.isCoarsePointer()) return;

        // Switched off: tear down anything a previous run left behind rather
        // than just skipping setup, so flipping the toggle takes effect at once
        // instead of at the next reload.
        if (!this.shortcutTooltipsEnabled()) {
            this.teardownToolbarKbdTooltips();
            return;
        }

        let tip = document.getElementById('toolbar-kbd-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'toolbar-kbd-tooltip';
            tip.className = 'toolbar-kbd-tooltip';
            tip.setAttribute('role', 'tooltip');
            tip.setAttribute('aria-hidden', 'true');
            document.body.appendChild(tip);
        }

        const formatKeys = (keysList) => {
            const SF = window.ShortcutFormat;
            if (!SF || typeof SF.keysToHtml !== 'function') {
                return keysList.map((k) => `<kbd>${k}</kbd>`).join('<span class="kbd-sep">+</span>');
            }
            return keysList.map((k) => SF.keysToHtml(k)).join('<span class="kbd-sep">·</span>');
        };

        const allDefs = this.shortcutButtonDefs();
        const headerDefs = allDefs.filter((def) => def.header);

        /*
         * The action buttons get no popover. Each already carries its key as a
         * chip, so the popover only repeated it -- and in a dock it opened over
         * the bookmarks the reader was aiming for. Their label stays in
         * aria-label and the key in aria-keyshortcuts.
         */
        allDefs.filter((def) => !def.header).forEach((def) => {
            const btn = def.id ? document.getElementById(def.id) : document.querySelector(def.selector);
            if (!btn) return;
            btn.removeAttribute('data-tooltip');
            btn.removeAttribute('data-i18n-tooltip');
        });

        const hide = () => {
            tip.classList.remove('is-visible');
            tip.setAttribute('aria-hidden', 'true');
            tip.removeAttribute('data-for');
        };

        const show = (btn, labelKey, keys, options = {}) => {
            const label = d.language?.t(labelKey) || labelKey;
            tip.replaceChildren();
            const labelSpan = document.createElement('span');
            labelSpan.className = 'toolbar-kbd-tooltip-label';
            labelSpan.textContent = label;
            const keysSpan = document.createElement('span');
            keysSpan.className = 'toolbar-kbd-tooltip-keys';
            if (keys.length) {
                keysSpan.innerHTML = formatKeys(keys);
                tip.append(labelSpan, keysSpan);
            } else {
                tip.append(labelSpan);
            }
            const rect = btn.getBoundingClientRect();
            tip.classList.add('is-visible');
            tip.setAttribute('aria-hidden', 'false');
            tip.dataset.for = btn.id || 'toolbar-btn';
            {
                // The toolbar sits at the bottom of the window, so its tooltips
                // open upwards. The header icons sit at the top, where that same
                // direction runs off the screen and the popover gets clipped —
                // those open downwards instead.
                const below = options.below === true;
                tip.classList.toggle('toolbar-kbd-tooltip--below', below);
                tip.style.left = `${rect.left + rect.width / 2}px`;
                tip.style.top = below ? `${rect.bottom}px` : `${rect.top}px`;
            }
            // Keep the box inside the viewport horizontally. A header icon near
            // the right edge would otherwise centre itself past the edge and lose
            // its right-hand side.
            tip.style.setProperty('--kbd-tooltip-shift', '0px');
            const box = tip.getBoundingClientRect();
            const margin = 8;
            let shift = 0;
            if (box.right > window.innerWidth - margin) {
                shift = window.innerWidth - margin - box.right;
            } else if (box.left < margin) {
                shift = margin - box.left;
            }
            if (shift) {
                tip.style.setProperty('--kbd-tooltip-shift', `${Math.round(shift)}px`);
            }
        };

        // Resolved once rather than per event. This runs on every
        // pointermove, and re-querying four selectors per mouse move cost a
        // document query plus a style resolution for each — for elements that do
        // not move between renders. Rebound on the next renderToolbar anyway.
        const headerButtons = headerDefs
            .map((def) => ({ def, btn: document.querySelector(def.selector) }))
            .filter((entry) => entry.btn);

        const syncToolbarKbdTooltip = () => {
            for (const { def, btn } of headerButtons) {
                if (def.when && !def.when()) continue;
                if (btn.matches(':hover') || btn.matches(':focus-visible')) {
                    show(btn, def.labelKey, def.keys, { below: true });
                    return;
                }
            }
            hide();
        };

        // Pointermove fires far faster than the tooltip can change, and each run
        // resolves :hover on every toolbar button — a style recalc per event.
        // One run per frame is indistinguishable to the eye. Focus changes stay
        // unthrottled: those are discrete and must land immediately.
        let rafId = 0;
        const syncOnNextFrame = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                syncToolbarKbdTooltip();
            });
        };

        if (d._toolbarKbdTooltipSync) {
            document.removeEventListener('pointermove', d._toolbarKbdTooltipPointerSync
                || d._toolbarKbdTooltipSync);
            document.removeEventListener('focusin', d._toolbarKbdTooltipSync);
            document.removeEventListener('focusout', d._toolbarKbdTooltipSync);
        }
        d._toolbarKbdTooltipSync = syncToolbarKbdTooltip;
        d._toolbarKbdTooltipPointerSync = syncOnNextFrame;
        document.addEventListener('pointermove', syncOnNextFrame, { passive: true });
        document.addEventListener('focusin', syncToolbarKbdTooltip);
        document.addEventListener('focusout', syncToolbarKbdTooltip);

        if (!d._toolbarKbdTooltipDocBound) {
            d._toolbarKbdTooltipDocBound = true;
            window.addEventListener('scroll', hide, { passive: true, capture: true });
            window.addEventListener('blur', hide);
        }

        hide();
        syncToolbarKbdTooltip();
    }

    /**
     * Remove the popover and stop tracking hover/focus.
     *
     * The pointermove listener is the one that matters: left bound, it keeps
     * running on every mouse move for a feature the user has switched off.
     */
    teardownToolbarKbdTooltips() {
        const d = this.dash;
        if (d._toolbarKbdTooltipSync) {
            // pointermove is bound to the frame-throttled wrapper, not to the
            // sync itself — removing the wrong reference leaves it running.
            document.removeEventListener('pointermove',
                d._toolbarKbdTooltipPointerSync || d._toolbarKbdTooltipSync);
            document.removeEventListener('focusin', d._toolbarKbdTooltipSync);
            document.removeEventListener('focusout', d._toolbarKbdTooltipSync);
            d._toolbarKbdTooltipSync = null;
            d._toolbarKbdTooltipPointerSync = null;
        }
        document.getElementById('toolbar-kbd-tooltip')?.remove();
    }


    setupHeaderEnhancements() {
        const d = this.dash;

        /*
         * Health and config open in place, whatever the address looks like.
         *
         * They are anchors to `/#health` and `/#config`, which is a hash change
         * -- and therefore a soft route -- only while the address has nothing
         * else in it. Come from the inbox or a health filter and the URL
         * carries a query string (ib_filter, hv_sort and friends), so the same
         * click changes the path *and* the query: the browser reloads the whole
         * app, and the view you asked for arrives after a blank page. The href
         * stays for middle-click, for Copy link address, and for anyone with
         * JavaScript off; the click is handled here instead.
         *
         * Delegated on the document rather than bound to the anchors: both are
         * re-created by dashboard-visual when the chrome settings change.
         */
        document.addEventListener('click', (e) => {
            const anchor = e.target?.closest?.(
                '.config-link-anchor, .health-link-anchor, .dashboard-link-anchor'
            );
            if (!anchor) return;
            // Leave the browser's own gestures alone: a modified click or a
            // middle button is someone asking for a second tab.
            if (e.defaultPrevented || e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            if (anchor.classList.contains('config-link-anchor')) {
                void d.config?.openConfigView?.();
            } else if (anchor.classList.contains('health-link-anchor')) {
                void d.health?.openHealthView?.();
            } else {
                /*
                 * Back to the dashboard, at the page you left it on.
                 *
                 * currentPageId is not cleared while a view is open -- health,
                 * the inbox and config are drawn over the dashboard rather than
                 * instead of it -- so the page you were last on is still there
                 * to return to. requestPageNavigation rebuilds the grid when it
                 * is coming from a view, which is why the href never has to be
                 * followed: `/` would be a full reload of the whole app.
                 */
                void d.pageNav?.requestPageNavigation?.(d.currentPageId);
            }
        });

        document.getElementById('page-overview-header-btn')?.addEventListener('click', () => {
            d.showPageOverlay();
        });
        document.getElementById('quick-add-toolbar-btn')?.addEventListener('click', () => {
            if (d.quickAddWidget) {
                d.quickAddWidget.open();
            } else {
                d.searchComponent?.commandsComponent?.newCommandHandler?.openModal();
            }
        });
        document.getElementById('collapse-all-button')?.addEventListener('click', () => {
            d.toggleAllCategoriesCollapsed();
        });
    }


    /**
     * Fold the actions the header cannot show into one control.
     *
     * The bar can hold nine buttons and most readers use three or four. Past
     * the reader's own cap the rest go behind a control that says how many it
     * holds -- the same bargain the page tabs make with their "+N" chip.
     *
     * Which buttons exist at all is still each `data-show-*` setting's answer:
     * one that is switched off is not on the bar and not in the menu either.
     * The folded ones stay in the DOM, hidden, because the menu opens them by
     * clicking them -- one implementation of what each action does.
     */
    // Zero is allowed: every action behind the one control.
    static HEADER_ACTION_MIN = 0;

    static HEADER_ACTION_DEFAULT = 2;

    headerActionCap() {
        const d = this.dash;
        /*
         * Out of the header, nothing folds: a dock or a side column has the
         * room the band did not. The menu placement keeps the one action that
         * makes something and puts the rest behind the control.
         */
        const place = document.body.getAttribute('data-action-bar');
        if (place === 'bottom' || place === 'left' || place === 'right') return Infinity;
        if (place === 'menu') return 1;
        const raw = Math.round(Number(d.settings?.maxHeaderActions));
        const chosen = Number.isFinite(raw) ? raw : DashboardToolbar.HEADER_ACTION_DEFAULT;
        const capped = Math.min(8, Math.max(DashboardToolbar.HEADER_ACTION_MIN, chosen));
        /*
         * A narrow row folds one more away per rung of the header's own
         * ladder: fitHeaderZones has already decided the row is too full, and
         * an action behind the control is still one key away.
         */
        const step = Number(document.body.getAttribute('data-header-fit')) || 0;
        return Math.max(DashboardToolbar.HEADER_ACTION_MIN, capped - Math.max(0, step - 1));
    }

    /**
     * The action buttons a reader has left switched on, in the order drawn.
     *
     * Drawn, not written: the bar sets each button's place with `order` in
     * CSS, so the first four on screen are not the first four in the markup.
     * Folding by source order took the wrong four away.
     */
    headerActionButtons() {
        const bar = document.querySelector('.header-shortcuts');
        if (!bar) return [];
        const place = (btn) => {
            const value = Number(window.getComputedStyle(btn).order);
            return Number.isFinite(value) ? value : 0;
        };
        return [...bar.querySelectorAll('button.search-button')]
            .filter((btn) => !btn.classList.contains('header-action-overflow'))
            .filter((btn) => {
                if (btn.hidden) return false;
                // Folded buttons are hidden by this very rule, so they are read
                // as shown: what decides is the setting behind them.
                if (btn.classList.contains('is-folded')) return true;
                return window.getComputedStyle(btn).display !== 'none';
            })
            .sort((a, b) => place(a) - place(b));
    }

    syncHeaderActionOverflow() {
        const bar = document.querySelector('.header-shortcuts');
        if (!bar) return;
        /*
         * Unfold first, then look.
         *
         * A folded button is hidden by the fold's own rule, so asking whether
         * it is drawn answers "no" for the button the reader switched off and
         * "no" for the one this method put away -- and the one switched off
         * then stayed in the menu. Cleared here, so what is read is each
         * `data-show-*` setting's own answer.
         */
        bar.querySelectorAll('.is-folded').forEach((btn) => btn.classList.remove('is-folded'));
        const buttons = this.headerActionButtons();
        const cap = this.headerActionCap();

        buttons.forEach((btn, index) => {
            btn.classList.toggle('is-folded', index >= cap);
        });

        const folded = buttons.filter((btn) => btn.classList.contains('is-folded'));
        let more = bar.querySelector('.header-action-overflow');

        if (!folded.length) {
            this.closeHeaderActionMenu();
            more?.remove();
            return;
        }

        if (!more) {
            more = document.createElement('button');
            more.type = 'button';
            more.className = 'search-button header-action-overflow';
            more.setAttribute('aria-haspopup', 'menu');
            more.setAttribute('aria-expanded', 'false');
            more.innerHTML = ''
                + '<svg class="header-action-glyph" viewBox="0 0 24 24" width="16" height="16" fill="none"'
                + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
                + ' aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>'
                + '<span class="header-action-overflow-count"></span>';
            more.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleHeaderActionMenu(more);
            });
            bar.appendChild(more);
        }
        // Last in the bar, whatever was appended to it since.
        if (more.nextElementSibling) bar.appendChild(more);

        const label = this.dash.formatDashboardLabel('headerActionsOverflow', { n: folded.length },
            `${folded.length} more actions`);
        more.querySelector('.header-action-overflow-count').textContent = `+${folded.length}`;
        more.setAttribute('aria-label', label);
        more.title = label;

        if (this._headerActionMenu) this.renderHeaderActionMenu(more);
    }

    toggleHeaderActionMenu(anchorEl) {
        if (this._headerActionMenu) {
            this.closeHeaderActionMenu();
            return;
        }
        this.openHeaderActionMenu(anchorEl);
    }

    closeHeaderActionMenu({ focusAnchor = false } = {}) {
        const menu = this._headerActionMenu;
        if (!menu) return;
        this._headerActionMenu = null;
        menu.remove();
        window.removeEventListener('keydown', this._headerActionKeys, true);
        document.removeEventListener('pointerdown', this._headerActionOutside, true);
        window.removeEventListener('resize', this._headerActionReflow);
        this._headerActionKeys = null;
        this._headerActionOutside = null;
        this._headerActionReflow = null;
        const anchor = this._headerActionAnchor;
        this._headerActionAnchor = null;
        anchor?.setAttribute('aria-expanded', 'false');
        if (focusAnchor) anchor?.focus?.({ preventScroll: true });
    }

    openHeaderActionMenu(anchorEl) {
        const menu = document.createElement('div');
        menu.className = 'move-popover header-action-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', anchorEl.getAttribute('aria-label') || 'More actions');
        document.body.appendChild(menu);
        this._headerActionMenu = menu;
        this._headerActionAnchor = anchorEl;
        anchorEl.setAttribute('aria-expanded', 'true');
        this.renderHeaderActionMenu(anchorEl);

        this._headerActionReflow = () => this.dash.pageNav?.positionPopover?.(menu, anchorEl);
        window.addEventListener('resize', this._headerActionReflow);

        this._headerActionOutside = (e) => {
            if (menu.contains(e.target) || anchorEl.contains(e.target)) return;
            this.closeHeaderActionMenu();
        };
        document.addEventListener('pointerdown', this._headerActionOutside, true);

        // On the window in capture, for the reason the page switcher's menu is:
        // the grid's own navigation listens on document and was bound first.
        this._headerActionKeys = (e) => this._handleHeaderActionKey(e, menu);
        window.addEventListener('keydown', this._headerActionKeys, true);

        requestAnimationFrame(() => {
            if (this._headerActionMenu !== menu) return;
            menu.querySelector('.header-action-item')?.focus({ preventScroll: true });
        });
    }

    renderHeaderActionMenu(anchorEl) {
        const menu = this._headerActionMenu;
        if (!menu) return;
        menu.innerHTML = '';
        const folded = this.headerActionButtons().filter((btn) => btn.classList.contains('is-folded'));
        if (!folded.length) {
            this.closeHeaderActionMenu();
            return;
        }
        folded.forEach((btn) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'header-action-item';
            row.setAttribute('role', 'menuitem');
            const name = btn.querySelector('.search-button-label')?.textContent?.trim()
                || btn.getAttribute('aria-label') || '';
            const key = btn.querySelector('.search-button-icon')?.textContent?.trim() || '';
            const nameEl = document.createElement('span');
            nameEl.className = 'header-action-item-name';
            nameEl.textContent = name;
            row.appendChild(nameEl);
            if (key) {
                const keyEl = document.createElement('span');
                keyEl.className = 'header-action-item-key';
                keyEl.textContent = key;
                row.appendChild(keyEl);
            }
            row.addEventListener('click', () => {
                this.closeHeaderActionMenu();
                // The button is what knows what the action does; this is a way
                // to press it rather than a second copy of it.
                btn.click();
            });
            menu.appendChild(row);
        });
        this.dash.pageNav?.positionPopover?.(menu, anchorEl, { initial: true });
    }

    _handleHeaderActionKey(e, menu) {
        if (!this._headerActionMenu) return;
        const rows = [...menu.querySelectorAll('.header-action-item')];
        const at = rows.indexOf(document.activeElement);
        const mine = () => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };

        if (e.key === 'Escape') {
            mine();
            this.closeHeaderActionMenu({ focusAnchor: true });
            return;
        }
        if (e.key === 'Tab') {
            this.closeHeaderActionMenu();
            return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            mine();
            if (!rows.length) return;
            const step = e.key === 'ArrowDown' ? 1 : -1;
            const next = at < 0
                ? (step > 0 ? 0 : rows.length - 1)
                : (at + step + rows.length) % rows.length;
            rows[next].focus({ preventScroll: true });
            return;
        }
        if ((e.key === 'Home' || e.key === 'End') && rows.length) {
            mine();
            rows[e.key === 'Home' ? 0 : rows.length - 1].focus({ preventScroll: true });
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && at >= 0) {
            mine();
            rows[at].click();
        }
    }

    syncTagCloudButtonPlacement() {
        const d = this.dash;
        const toggle = document.getElementById('tag-cloud-toggle-btn');
        const wrap = document.getElementById('dashboard-tag-cloud-wrap');
        if (!toggle || !wrap) return;

        // The header is where the actions are. It stands between search and
        // recents there, which is the order the keys are learned in: find
        // something, browse by tag, then what you opened last.
        const shortcuts = document.querySelector('.header-shortcuts');
        if (shortcuts) {
            if (toggle.parentElement !== shortcuts) {
                shortcuts.appendChild(toggle);
            }
            return;
        }

        // No header to stand in (the phone layout builds its own): back in the
        // wrap it came from, which is where its modal is anchored.
        if (toggle.parentElement !== wrap) {
            wrap.insertBefore(toggle, wrap.firstChild);
        }
    }


    refreshAddBookmarkToolbarLabel() {
        const d = this.dash;
        const btn = document.getElementById('quick-add-toolbar-btn');
        const label = btn?.querySelector('.search-button-label');
        if (!label) return;
        // The header names the action in full -- "add bookmark", not the
        // "bookmark" the floating bar used, where the + beside it was the verb.
        // Written here as well as in the template because this runs on a
        // language change and on every mobile/desktop switch, and it was
        // putting the old word back.
        label.textContent = d.language?.t('dashboard.headerAddLabel') || 'add bookmark';
    }


    setupReorderUndoShortcut() {
        const d = this.dash;
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (window.DashboardTagCloud?.modalOpen) return;
            if (d.isModalOpen()) return;
            if (d.searchComponent && d.searchComponent.isActive()) return;
            if (d.hasActiveTagFilters()) return;

            if (!d.pendingReorderSnapshot) return;
            e.preventDefault();
            e.stopPropagation();
            d.undoPendingReorder();
        });
    }


    setupPasteToQuickAdd() {
        const d = this.dash;
        document.addEventListener('paste', (e) => {
            if (d.settings?.pasteUrlQuickAdd === false) return;
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
            if (d.isModalOpen()) return;
            if (window.DashboardTagCloud?.modalOpen) return;
            if (d.searchComponent && d.searchComponent.isActive()) return;
            if (d.isInlineEditActive()) return;
            if (document.getElementById('paste-choice-modal')?.classList.contains('show')) return;

            const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
            const trimmed = text.trim().split(/\s/)[0];
            const looksLikeUrl = trimmed && (
                /^https?:\/\/.+/i.test(trimmed)
                || /^[\w.-]+\.[a-z]{2,}/i.test(trimmed)
            );
            if (!looksLikeUrl) return;

            e.preventDefault();

            if (d.pasteChoice?.isEnabled?.()) {
                d.pasteChoice.handlePasteUrl(trimmed);
                return;
            }

            const handler = d.searchComponent?.commandsComponent?.newCommandHandler;
            if (!handler) {
                const msg = d.language?.t?.('dashboard.pasteUrlHint')
                    || 'Paste a URL to directly create a bookmark.';
                d.showNotification(msg, 'info', { duration: 4000 });
                return;
            }

            handler.openModal({ url: trimmed });
        });
    }


    openEmptyStateAdd() {
        const d = this.dash;
        if (d.quickAddWidget) {
            d.quickAddWidget.open();
            return;
        }
        d.searchComponent?.commandsComponent?.newCommandHandler?.openModal();
    }


    openEmptyStateCommand(commandPrefix) {
        const d = this.dash;
        if (!d.searchComponent || !commandPrefix) return;
        d.searchComponent.openSearchInterface();
        d.searchComponent.currentQuery = commandPrefix;
        d.searchComponent.updateSearch();
        d.searchComponent.renderSearchMatches();
    }


    shouldShowEmptyStateKeyboardActions() {
        const d = this.dash;
        return !d.isCoarsePointer() && window.MobileExperience?.isMobileLayout?.() !== true;
    }


    buildEmptyStateAddLabel() {
        const d = this.dash;
        if (d.isCoarsePointer()) {
            return d.language?.t('dashboard.emptyStateAddAction') || '+ bookmark';
        }
        return d.language?.t('dashboard.emptyStateAddAction') || '+ bookmark';
    }


    buildEmptyStateAddHint() {
        const d = this.dash;
        if (d.isCoarsePointer()) {
            return d.language?.t('dashboard.emptyStateAddTouch') || 'Tap + bookmark in the bar below';
        }
        return d.language?.t('dashboard.emptyStateAddDesktop') || 'Press + for the full add-bookmark form (& for quick-add line)';
    }


    updateMiniStatusLine() {
        const d = this.dash;
        const el = document.getElementById('dashboard-mini-status');
        if (!el) return;
        const dateLine = document.querySelector('.date-time-line')?.textContent?.trim() || '';
        const page = d.pages.find((p) => p.id === d.currentPageId);
        const pageName = page?.name || '';
        const badge = document.querySelector('.health-link a .health-badge');
        const parts = [];
        if (dateLine) parts.push(dateLine);
        if (pageName) parts.push(pageName);
        if (badge) {
            const badgeText = badge.textContent.trim();
            if (badgeText) parts.push(badgeText);
        }
        // How many rows are actually on screen. This element is aria-live, and
        // it was only ever refreshed on a page change — so narrowing the grid
        // with a tag filter, or collapsing a category, changed what was there
        // with nothing said about it. Adds and deletes were already covered:
        // their toasts go through a live region of their own.
        const rowCount = document.querySelectorAll(
            '#dashboard-layout .bookmark-link[data-bookmark-url]:not(.is-overflow-hidden)'
        ).length;
        if (rowCount > 0) {
            parts.push(rowCount === 1
                ? (d.language?.t('dashboard.gridCountOne') || '1 bookmark')
                : (d.language?.t('dashboard.gridCountMany') || '{count} bookmarks')
                    .replace('{count}', String(rowCount)));
        }
        if (!parts.length) {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        const next = parts.join(' · ');
        // Writing the same string back into a live region announces it again.
        if (el.textContent === next) {
            el.hidden = false;
            return;
        }
        el.hidden = false;
        el.textContent = next;
    }


    isTagCloudDesktopShortcutVisible() {
        const d = this.dash;
        return d.settings?.showTagCloudButton === true
            && window.MobileExperience?.isMobileLayout?.() !== true;
    }


    isTagCloudTipRelevant() {
        return this.isTagCloudDesktopShortcutVisible()
            && window.DashboardTagCloud?.libraryHasTags?.() === true;
    }

}

window.DashboardToolbar = DashboardToolbar;
