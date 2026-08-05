/**
 * Toolbar actions, tooltips, header enhancements.
 */
class DashboardToolbar {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    setupToolbarActions() {
        const d = this.dash;
        this.setupToolbarKbdTooltips();
        this.syncSideRailDiscoverability();
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

            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '*') {
                e.preventDefault();
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
        });
    }


    /**
     * Whether the shortcut popovers may appear at all.
     *
     * Default on: they are how the keys get discovered. Absent means never
     * chosen, which is on — only an explicit false switches them off.
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

        const defs = [
            { id: 'quick-add-toolbar-btn', labelKey: 'dashboard.tooltipAddBookmark', keys: ['+'] },
            { id: 'search-button', labelKey: 'dashboard.tooltipSearch', keys: ['>'] },
            { id: 'commands-button', labelKey: 'dashboard.tooltipCommands', keys: [':'] },
            { id: 'finders-button', labelKey: 'dashboard.tooltipFinders', keys: ['?'] },
            { id: 'recent-bookmarks-button', labelKey: 'dashboard.tooltipRecent', keys: ['*'] },
            { id: 'tag-cloud-toggle-btn', labelKey: 'dashboard.tagCloudToggleAria', keys: ['/'] },
            { id: 'help-button', labelKey: 'dashboard.tooltipCheatsheet', keys: ['!', 'F1'] },
            { id: 'whats-new-btn', labelKey: 'dashboard.whatsNewAria', keys: [] }
        ];

        const headerDefs = [
            { selector: '#page-overview-header-btn', labelKey: 'dashboard.pagesOverview', keys: [','] },
            {
                selector: '#page-nav-inbox-btn',
                labelKey: 'dashboard.inboxPageTitle',
                keys: ['Shift+I'],
                when: () => d.inbox?.isEnabled?.() && d.settings?.inboxShowInPageTabs !== false,
            },
            {
                selector: '.health-link-anchor',
                labelKey: 'dashboard.health',
                keys: ['Shift+H'],
                when: () => d.health?.isEnabled?.(),
            },
            {
                selector: '.config-link-anchor',
                labelKey: 'dashboard.config',
                keys: ['Shift+S'],
                when: () => d.config?.isEnabled?.(),
            },
        ];

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
            const isSideRail = document.body.hasAttribute('data-rail');
            if (isSideRail) {
                tip.classList.add('toolbar-kbd-tooltip--side-rail');
                tip.classList.remove('toolbar-kbd-tooltip--below');
                tip.style.left = `${rect.right + 8}px`;
                tip.style.top = `${rect.top + rect.height / 2}px`;
            } else {
                tip.classList.remove('toolbar-kbd-tooltip--side-rail');
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

        const syncToolbarKbdTooltip = () => {
            for (const def of headerDefs) {
                if (def.when && !def.when()) continue;
                const btn = document.querySelector(def.selector);
                if (btn?.matches(':hover') || btn?.matches(':focus-visible')) {
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

        if (d._toolbarKbdTooltipSync) {
            document.removeEventListener('pointermove', d._toolbarKbdTooltipSync);
            document.removeEventListener('focusin', d._toolbarKbdTooltipSync);
            document.removeEventListener('focusout', d._toolbarKbdTooltipSync);
        }
        d._toolbarKbdTooltipSync = syncToolbarKbdTooltip;
        document.addEventListener('pointermove', syncToolbarKbdTooltip, { passive: true });
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
            document.removeEventListener('pointermove', d._toolbarKbdTooltipSync);
            document.removeEventListener('focusin', d._toolbarKbdTooltipSync);
            document.removeEventListener('focusout', d._toolbarKbdTooltipSync);
            d._toolbarKbdTooltipSync = null;
        }
        document.getElementById('toolbar-kbd-tooltip')?.remove();
    }


    setupHeaderEnhancements() {
        const d = this.dash;
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

        const container = document.querySelector('.button-container');
        const isSideRail = (d.settings?.buttonBarPosition || document.body.getAttribute('data-button-position')) === 'side-left';
        if (isSideRail && container) {
            // Direct child of .button-container — not inside .btn-group-secondary, which is
            // display:none when Recent and Help are both hidden (fresh-install defaults).
            if (toggle.parentElement !== container) {
                container.appendChild(toggle);
            }
            this.syncSideRailDiscoverability();
            return;
        }

        if (toggle.parentElement !== wrap) {
            wrap.insertBefore(toggle, wrap.firstChild);
        }
        this.syncSideRailDiscoverability();
    }


    syncSideRailDiscoverability() {
        const d = this.dash;
        const legendId = 'side-rail-legend';
        const storageKey = 'nextdash:side-rail-legend-v1';
        const isSideRail = document.body.hasAttribute('data-rail');
        const canShow = isSideRail
            && !d.isCoarsePointer()
            && window.MobileExperience?.isMobileLayout?.() !== true
            && window.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false;

        let legend = document.getElementById(legendId);
        if (!canShow) {
            if (legend) legend.hidden = true;
            if (d._sideRailLegendTimer) {
                clearTimeout(d._sideRailLegendTimer);
                d._sideRailLegendTimer = null;
            }
            return;
        }

        const dismissLegend = ({ persist = true } = {}) => {
            if (!legend) return;
            legend.classList.add('is-dismissing');
            if (d._sideRailLegendTimer) {
                clearTimeout(d._sideRailLegendTimer);
                d._sideRailLegendTimer = null;
            }
            setTimeout(() => {
                legend.hidden = true;
                legend.classList.remove('is-dismissing');
            }, 360);
            if (persist) {
                try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
            }
        };

        const isToolbarControlVisible = (btn) => {
            if (!btn) return false;
            const style = window.getComputedStyle(btn);
            return style.display !== 'none' && style.visibility !== 'hidden';
        };

        const buildLegendItems = () => {
            const t = (key, fallback) => {
                const fullKey = `dashboard.${key}`;
                const value = d.language?.t?.(fullKey);
                return value && value !== fullKey ? value : fallback;
            };
            const defs = [
                { id: 'quick-add-toolbar-btn', key: '+', labelKey: 'addBookmarkShort', fallback: 'bookmark' },
                { id: 'search-button', key: '>', labelKey: 'searchLabel', fallback: 'search' },
                { id: 'finders-button', key: '?', labelKey: 'findersLabel', fallback: 'finders' },
                { id: 'commands-button', key: ':', labelKey: 'commandsLabel', fallback: 'commands' },
                { id: 'recent-bookmarks-button', key: '*', labelKey: 'tooltipRecent', fallback: 'recent' },
                { id: 'tag-cloud-toggle-btn', key: '/', labelKey: 'tagCloudToggleAria', fallback: 'tag cloud' },
                { id: 'help-button', key: '!', labelKey: 'tooltipCheatsheet', fallback: 'cheatsheet' },
                { id: 'collapse-all-button', key: '.', labelKey: 'collapseAllLabel', fallback: 'fold' },
                { id: 'whats-new-btn', key: '★', labelKey: 'whatsNewAria', fallback: "what's new" },
            ];
            return defs
                .map((def) => {
                    const btn = document.getElementById(def.id);
                    if (!isToolbarControlVisible(btn)) return null;
                    return {
                        key: def.key,
                        label: t(def.labelKey, def.fallback),
                    };
                })
                .filter(Boolean);
        };

        if (!legend) {
            legend = document.createElement('aside');
            legend.id = legendId;
            legend.className = 'side-rail-legend';
            legend.setAttribute('role', 'complementary');
            legend.hidden = true;
            document.body.appendChild(legend);
        }

        const items = buildLegendItems();
        if (!items.length) {
            legend.hidden = true;
            return;
        }

        legend.replaceChildren();
        const title = document.createElement('p');
        title.className = 'side-rail-legend-title';
        title.textContent = d.language?.t('dashboard.sideRailLegendTitle') || 'Side rail';
        legend.appendChild(title);

        const list = document.createElement('ul');
        list.className = 'side-rail-legend-list';
        items.forEach((item) => {
            const li = document.createElement('li');
            li.className = 'side-rail-legend-item';
            const key = document.createElement('span');
            key.className = 'side-rail-legend-key';
            key.textContent = item.key;
            const label = document.createElement('span');
            label.className = 'side-rail-legend-label';
            label.textContent = item.label;
            li.append(key, label);
            list.appendChild(li);
        });
        legend.appendChild(list);

        const foot = document.createElement('p');
        foot.className = 'side-rail-legend-foot';
        foot.textContent = d.language?.t('dashboard.sideRailLegendHover') || 'Hover any icon for shortcuts';
        legend.appendChild(foot);

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'side-rail-legend-dismiss';
        dismissBtn.textContent = d.language?.t('dashboard.sideRailLegendDismiss') || 'Got it';
        dismissBtn.addEventListener('click', () => dismissLegend());
        legend.appendChild(dismissBtn);

        let shouldShow = false;
        try {
            shouldShow = !localStorage.getItem(storageKey);
        } catch {
            shouldShow = true;
        }

        if (!shouldShow || d.onboardingStartedInSession || d.settings?.onboardingCompleted !== true) {
            legend.hidden = true;
            return;
        }

        legend.hidden = false;
        legend.classList.remove('is-dismissing');
        if (d._sideRailLegendTimer) clearTimeout(d._sideRailLegendTimer);
        d._sideRailLegendTimer = setTimeout(() => dismissLegend(), 14_000);
    }


    refreshAddBookmarkToolbarLabel() {
        const d = this.dash;
        const btn = document.getElementById('quick-add-toolbar-btn');
        const label = btn?.querySelector('.search-button-label');
        if (!label) return;
        label.textContent = d.language?.t('dashboard.addBookmarkShort') || 'bookmark';
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
        if (!parts.length) {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        el.hidden = false;
        el.textContent = parts.join(' · ');
    }


    isTagCloudDesktopShortcutVisible() {
        const d = this.dash;
        return d.settings?.showTagCloudButton === true
            && window.MobileExperience?.isMobileLayout?.() !== true;
    }


    isTagCloudTipRelevant() {
        const d = this.dash;
        return this.isTagCloudDesktopShortcutVisible()
            && window.DashboardTagCloud?.libraryHasTags?.() === true;
    }

}

window.DashboardToolbar = DashboardToolbar;
