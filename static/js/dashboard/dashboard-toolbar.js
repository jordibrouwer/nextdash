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
        const helpButton = document.getElementById('help-button');
        if (helpButton) {
            helpButton.addEventListener('click', () => {
                d.showKeyboardCheatSheet();
            });
        }
        const searchButton = document.getElementById('search-button');
        if (searchButton) {
            searchButton.addEventListener('click', () => d.markInlineTipUsed('search_open'));
        }
        const findersButton = document.getElementById('finders-button');
        if (findersButton) {
            findersButton.addEventListener('click', () => d.markInlineTipUsed('finder_open'));
        }
        const commandsButton = document.getElementById('commands-button');
        if (commandsButton) {
            commandsButton.addEventListener('click', () => d.markInlineTipUsed('command_open'));
        }
        const recentButton = document.getElementById('recent-bookmarks-button');
        if (recentButton) {
            recentButton.addEventListener('click', () => {
                d.toggleRecentBookmarksModal();
            });
        }

        // What's new (toolbar button, same row as search/commands)
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
        });
    }


    setupToolbarKbdTooltips() {
        const d = this.dash;
        if (d.isCoarsePointer()) return;

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
            { id: 'help-button', labelKey: 'dashboard.tooltipCheatsheet', keys: ['!', 'F1'] }
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

        const show = (btn, labelKey, keys) => {
            const label = d.language?.t(labelKey) || labelKey;
            tip.replaceChildren();
            const labelSpan = document.createElement('span');
            labelSpan.className = 'toolbar-kbd-tooltip-label';
            labelSpan.textContent = label;
            const keysSpan = document.createElement('span');
            keysSpan.className = 'toolbar-kbd-tooltip-keys';
            keysSpan.innerHTML = formatKeys(keys);
            tip.append(labelSpan, keysSpan);
            const rect = btn.getBoundingClientRect();
            tip.classList.add('is-visible');
            tip.setAttribute('aria-hidden', 'false');
            tip.dataset.for = btn.id || 'toolbar-btn';
            const isSideRail = document.body.getAttribute('data-button-position') === 'side-left';
            if (isSideRail) {
                tip.classList.add('toolbar-kbd-tooltip--side-rail');
                tip.style.left = `${rect.right + 8}px`;
                tip.style.top = `${rect.top + rect.height / 2}px`;
            } else {
                tip.classList.remove('toolbar-kbd-tooltip--side-rail');
                tip.style.left = `${rect.left + rect.width / 2}px`;
                tip.style.top = `${rect.top}px`;
            }
        };

        const syncToolbarKbdTooltip = () => {
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
    }


    syncTagCloudButtonPlacement() {
        const d = this.dash;
        const toggle = document.getElementById('tag-cloud-toggle-btn');
        const wrap = document.getElementById('dashboard-tag-cloud-wrap');
        const recentBtn = document.getElementById('recent-bookmarks-button');
        if (!toggle || !wrap) return;

        const isSideRail = (d.settings?.buttonBarPosition || document.body.getAttribute('data-button-position')) === 'side-left';
        if (isSideRail && recentBtn?.parentElement) {
            if (toggle.parentElement !== recentBtn.parentElement || toggle.previousElementSibling !== recentBtn) {
                recentBtn.insertAdjacentElement('afterend', toggle);
            }
            return;
        }

        if (toggle.parentElement !== wrap) {
            wrap.insertBefore(toggle, wrap.firstChild);
        }
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

            const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
            const trimmed = text.trim().split(/\s/)[0];
            const looksLikeUrl = trimmed && (
                /^https?:\/\/.+/i.test(trimmed)
                || /^[\w.-]+\.[a-z]{2,}/i.test(trimmed)
            );
            if (!looksLikeUrl) return;

            e.preventDefault();

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
