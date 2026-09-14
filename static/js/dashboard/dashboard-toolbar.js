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
            { selector: '#page-overview-header-btn', labelKey: 'dashboard.pagesOverview', keys: [','], header: true },
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
        const defs = allDefs.filter((def) => !def.header);
        const headerDefs = allDefs.filter((def) => def.header);

        const toolbarButtons = [];
        const defByButton = new Map();

        defs.forEach((def) => {
            const btn = def.id ? document.getElementById(def.id) : document.querySelector(def.selector);
            if (!btn) return;
            toolbarButtons.push(btn);
            defByButton.set(btn, def);
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

        // Resolved once, like toolbarButtons above. This runs on every
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
            const hoveredBtn = toolbarButtons.find((btn) => btn.matches(':hover'));
            if (hoveredBtn) {
                const def = defByButton.get(hoveredBtn);
                if (def) show(hoveredBtn, def.labelKey, def.keys);
                return;
            }
            const focusedBtn = toolbarButtons.find((btn) => btn.matches(':focus-visible'));
            if (focusedBtn) {
                const def = defByButton.get(focusedBtn);
                if (def) show(focusedBtn, def.labelKey, def.keys);
                return;
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
            const anchor = e.target?.closest?.('.config-link-anchor, .health-link-anchor');
            if (!anchor) return;
            // Leave the browser's own gestures alone: a modified click or a
            // middle button is someone asking for a second tab.
            if (e.defaultPrevented || e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            if (anchor.classList.contains('config-link-anchor')) {
                void d.config?.openConfigView?.();
            } else {
                void d.health?.openHealthView?.();
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
