/**
 * UI Helper Functions
 * Handles tabs, number inputs, and notifications
 */

class ConfigUI {
    constructor() {
        this.notificationTimeout = null;
        this.initTabs();
        this.initNumberInputControls();
    }

    /**
     * Initialize tab switching functionality
     */
    initTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');

        // Function to switch to a specific tab
        const switchToTab = (targetTab) => {
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to target button and corresponding content
            const targetButton = document.querySelector(`.tab-button[data-tab="${targetTab}"]`);
            const targetContent = document.querySelector(`[data-tab-content="${targetTab}"]`);
            if (targetButton) {
                targetButton.classList.add('active');
            }
            if (targetContent) {
                targetContent.classList.add('active');
            }
            
            // Update URL hash
            window.location.hash = `#${targetTab}`;
            
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
                }
            }
        };

    // Check initial hash and switch to corresponding tab
    const initialHash = window.location.hash.substring(1);
    const validTabs = ['general', 'pages', 'categories', 'bookmarks', 'finders', 'backups', 'keyboard', 'stats', 'help'];
    if (validTabs.includes(initialHash)) {
        switchToTab(initialHash);
    } else {
        // If no hash, switch to default tab (general)
        switchToTab('general');
    }        // Add hash change listener
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.substring(1);
            if (validTabs.includes(hash)) {
                switchToTab(hash);
            }
        });

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                switchToTab(targetTab);
            });
        });
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
        }

        if (options && typeof options.onAction === 'function' && notificationAction) {
            notificationAction.hidden = false;
            notificationAction.textContent = options.actionLabel || 'Undo';
            notificationAction.onclick = () => {
                options.onAction();
                this.hideNotification();
            };
        }

        if (this.notificationTimeout) {
            clearTimeout(this.notificationTimeout);
            this.notificationTimeout = null;
        }

        if (!options.persist) {
            const duration = Number.isFinite(Number(options.durationMs)) ? Number(options.durationMs) : 3000;
            this.notificationTimeout = setTimeout(() => {
                this.hideNotification();
            }, duration);
        }
    }

    hideNotification() {
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
