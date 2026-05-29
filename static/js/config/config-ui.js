/**
 * UI Helper Functions
 * Handles tabs, number inputs, and notifications
 */

class ConfigUI {
    constructor() {
        this.notificationTimeout = null;
        this._breadcrumbObserver = null;
        this._currentTab = 'general';
        this.initTabs();
        this.initNumberInputControls();
    }

    /**
     * Initialize tab switching functionality
     */
    initTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');
        const tabsContainer = document.querySelector('.config-controls-wrapper .tabs');

        if (tabsContainer) {
            tabsContainer.setAttribute('role', 'tablist');
        }

        tabButtons.forEach((button) => {
            const targetTab = button.getAttribute('data-tab');
            if (!targetTab) return;
            button.setAttribute('role', 'tab');
            button.setAttribute('type', 'button');
            const panelId = `config-tab-panel-${targetTab}`;
            const targetContent = document.querySelector(`[data-tab-content="${targetTab}"]`);
            if (targetContent) {
                targetContent.id = panelId;
                targetContent.setAttribute('role', 'tabpanel');
                button.setAttribute('aria-controls', panelId);
            }
        });

        // Function to switch to a specific tab
        const switchToTab = (targetTab) => {
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => {
                btn.classList.remove('active');
                btn.setAttribute('aria-selected', 'false');
            });
            tabContents.forEach(content => content.classList.remove('active'));

            // Add active class to target button and corresponding content
            const targetButton = document.querySelector(`.tab-button[data-tab="${targetTab}"]`);
            const targetContent = document.querySelector(`[data-tab-content="${targetTab}"]`);
            if (targetButton) {
                targetButton.classList.add('active');
                targetButton.setAttribute('aria-selected', 'true');
                this._scrollTabIntoView(targetButton);
            }
            if (targetContent) {
                targetContent.classList.add('active');
            }

            this._currentTab = targetTab;
            const generalSub = targetTab === 'general' && window.configManager?.generalLayers
                ? window.configManager.generalLayers.getBreadcrumbSubsection()
                : null;
            this.updateBreadcrumb(targetTab, generalSub);
            this.initBreadcrumbObserver(targetTab);

            // Update URL hash (preserve general layer subpaths)
            if (targetTab !== 'general') {
                window.location.hash = `#${targetTab}`;
            } else if (!/^#general(\/|$)/.test(window.location.hash)) {
                window.location.hash = '#general';
                window.configManager?.generalLayers?.applyLayer?.('essentials', { updateHash: false });
            }
            
            // Keep the selected page when switching tabs; only refresh custom-select chrome.
            // (Previously this reset to pagesData[0] whenever value !== first page, which
            // forced page 1 and saved new bookmarks to the wrong file.)
            if (typeof configManager !== 'undefined') {
                if (targetTab === 'bookmarks' || targetTab === 'categories') {
                    configManager.refreshCustomSelects();
                } else if (targetTab === 'stats' && configManager.stats) {
                    configManager.stats.refresh(configManager);
                } else if (targetTab === 'keyboard' && configManager.keyboard) {
                    configManager.keyboard.refresh(configManager);
                } else if (targetTab === 'tags' && configManager.tags) {
                    configManager.tags.refresh(configManager);
                } else if (targetTab === 'collections' && configManager.collections) {
                    configManager.collections.refresh(configManager);
                }
            }
        };

    const validTabs = ['general', 'pages', 'categories', 'tags', 'bookmarks', 'finders', 'collections', 'backups', 'keyboard', 'stats', 'help'];

    const resolveTabFromHash = (hashRaw) => {
        const hash = (hashRaw || '').replace(/^#/, '');
        if (validTabs.includes(hash)) return hash;
        if (hash.startsWith('general')) return 'general';
        return null;
    };

    // Check initial hash and switch to corresponding tab
    const initialHash = window.location.hash.substring(1);
    const initialTab = resolveTabFromHash(initialHash);
    switchToTab(initialTab || 'general');
    if (initialTab === 'general' && window.configManager?.generalLayers) {
        window.configManager.generalLayers.applyHash(window.location.hash);
    }

    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.substring(1);
        const tab = resolveTabFromHash(hash);
        if (tab) {
            if (tab !== this._currentTab) switchToTab(tab);
            if (tab === 'general' && window.configManager?.generalLayers) {
                window.configManager.generalLayers.applyHash(window.location.hash);
            }
        }
    });

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                switchToTab(targetTab);
                this._scrollTabIntoView(button);
            });
        });

        // Fade mask: toggle is-scrolled-end on wrapper when tabs are fully scrolled
        const tabBar = document.querySelector('.config-controls-wrapper .tabs');
        const tabWrapper = document.querySelector('.tabs-scroll-wrapper');
        if (tabBar && tabWrapper) {
            const updateMask = () => {
                const atEnd = tabBar.scrollLeft + tabBar.clientWidth >= tabBar.scrollWidth - 2;
                tabWrapper.classList.toggle('is-scrolled-end', atEnd);
            };
            tabBar.addEventListener('scroll', updateMask, { passive: true });
            window.addEventListener('resize', updateMask, { passive: true });
            requestAnimationFrame(updateMask);
        }
    }

    _scrollTabIntoView(button) {
        if (!button) return;
        const tabBar = button.closest('.tabs');
        if (!tabBar) return;
        const btnLeft = button.offsetLeft;
        const btnRight = btnLeft + button.offsetWidth;
        const barLeft = tabBar.scrollLeft;
        const barRight = barLeft + tabBar.clientWidth;
        if (btnLeft < barLeft) {
            tabBar.scrollTo({ left: btnLeft - 8, behavior: 'smooth' });
        } else if (btnRight > barRight) {
            tabBar.scrollTo({ left: btnRight - tabBar.clientWidth + 8, behavior: 'smooth' });
        }
    }

    /**
     * Initialize number input controls (up/down buttons)
     */
    initNumberInputControls() {
        const upButtons = document.querySelectorAll('.number-input-up');
        const downButtons = document.querySelectorAll('.number-input-down');

        upButtons.forEach(button => {
            button.addEventListener('click', () => {
                const inputId = button.getAttribute('data-input');
                const input = document.getElementById(inputId);
                if (input) {
                    const currentValue = parseInt(input.value) || 0;
                    const max = parseInt(input.max) || Infinity;
                    if (currentValue < max) {
                        input.value = currentValue + 1;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            });
        });

        downButtons.forEach(button => {
            button.addEventListener('click', () => {
                const inputId = button.getAttribute('data-input');
                const input = document.getElementById(inputId);
                if (input) {
                    const currentValue = parseInt(input.value) || 0;
                    const min = parseInt(input.min) || -Infinity;
                    if (currentValue > min) {
                        input.value = currentValue - 1;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            });
        });
    }

    /**
     * Show notification message
     * @param {string} message - The message to display
     * @param {string} type - Type of notification ('success' or 'error')
     */
    showNotification(message, type = 'success', options = {}) {
        if (window.AppNotification) {
            window.AppNotification.show(message, type, options);
            return;
        }
        const notification = document.getElementById('notification');
        const notificationMessage = document.getElementById('notification-message');
        const notificationAction = document.getElementById('notification-action');
        if (!notification || !notificationMessage) return;
        notificationMessage.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');
        if (notificationAction) {
            notificationAction.hidden = true;
            notificationAction.textContent = '';
            notificationAction.onclick = null;
            if (options && typeof options.onAction === 'function') {
                notificationAction.hidden = false;
                notificationAction.textContent = options.actionLabel || 'Undo';
                notificationAction.onclick = () => {
                    options.onAction();
                    this.hideNotification();
                };
            }
        }
        if (this.notificationTimeout) clearTimeout(this.notificationTimeout);
        if (!options.persist) {
            const duration = Number.isFinite(Number(options.durationMs)) ? Number(options.durationMs) : 3000;
            this.notificationTimeout = setTimeout(() => this.hideNotification(), duration);
        }
    }

    hideNotification() {
        if (window.AppNotification) {
            window.AppNotification.hide();
            return;
        }
        const notification = document.getElementById('notification');
        const notificationAction = document.getElementById('notification-action');
        if (!notification) return;
        notification.classList.remove('show');
        if (notificationAction) {
            notificationAction.hidden = true;
            notificationAction.textContent = '';
            notificationAction.onclick = null;
        }
    }

    updateBreadcrumb(tab, subsection, panelTitle) {
        const el = document.getElementById('config-breadcrumb');
        if (!el) return;
        const sep = `<span class="config-breadcrumb-sep">/</span>`;
        let html = `config${sep}${tab}`;
        if (subsection) {
            html += `${sep}<span class="config-breadcrumb-sub">${subsection}</span>`;
        }
        if (panelTitle) {
            html += `${sep}<span class="config-breadcrumb-sub">${panelTitle}</span>`;
        }
        el.innerHTML = html;
    }

    initBreadcrumbObserver(tab) {
        if (this._breadcrumbObserver) {
            this._breadcrumbObserver.disconnect();
            this._breadcrumbObserver = null;
        }
        if (tab !== 'general') return;

        const layerMode = document.querySelector('[data-tab-content="general"] > div')?.dataset?.generalLayer || 'essentials';
        const panels = [...document.querySelectorAll('[data-general-panel]')].filter((p) => {
            if (layerMode === 'all') return true;
            return (p.dataset.configTier || 'advanced') === layerMode && !p.hidden;
        });
        if (!panels.length || typeof IntersectionObserver === 'undefined') return;

        const visibleRatios = new Map();

        this._breadcrumbObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                visibleRatios.set(entry.target, entry.intersectionRatio);
            });

            let topPanel = null;
            let topRatio = 0;
            visibleRatios.forEach((ratio, el) => {
                if (ratio > topRatio) {
                    topRatio = ratio;
                    topPanel = el;
                }
            });

            const panelTitle = topPanel
                ? (topPanel.querySelector('.section-title') || {}).textContent || null
                : null;
            const layerSub = window.configManager?.generalLayers?.getBreadcrumbSubsection?.() || null;

            if (this._currentTab === 'general') {
                this.updateBreadcrumb('general', layerSub, panelTitle);
            }
        }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] });

        panels.forEach(p => this._breadcrumbObserver.observe(p));
    }

    /**
     * Update status options visibility based on showStatus setting
     * @param {boolean} showStatus - Whether status is enabled
     */
    updateStatusOptionsVisibility(showStatus) {
        const showPingCheckbox = document.getElementById('show-ping-checkbox');
        const showPingLabel = showPingCheckbox ? showPingCheckbox.closest('.checkbox-tree-item') : null;
        
        if (showPingLabel) {
            showPingLabel.style.display = showStatus ? 'flex' : 'none';
        }
    }
}

// Export for use in other modules
window.ConfigUI = ConfigUI;
