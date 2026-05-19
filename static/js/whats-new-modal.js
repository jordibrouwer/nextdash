/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v21';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function buildHtml() {
        return `
            <div class="help-content">
                <p class="help-intro">A short recap of the most recent changes.</p>
                <h4 class="help-subheading">Config — bookmarks</h4>
                <ul>
                    <li><strong>Last opened date/time</strong> — Each bookmark row now shows the date and time it was last opened, next to the open count.</li>
                    <li><strong>Sort by last opened</strong> — The sort dropdown now includes a "Last opened" option to sort bookmarks by most recently opened.</li>
                </ul>
                <h4 class="help-subheading">Config — help</h4>
                <ul>
                    <li><strong>Footer simplified</strong> — The help page footer now shows only a link to <a href="https://jordibrw.nl" target="_blank" rel="noopener noreferrer">jordibrw.nl</a>.</li>
                </ul>
            </div>
        `;
    }

    /**
     * @param {Object} [options]
     * @param {boolean} [options.force] - If true, always show (skip version gate and modal-open guard).
     * @param {function(): boolean} [options.ifBlockingModalOpen] - When not forcing: return true to abort (e.g. another modal is open).
     */
    window.openWhatsNewModal = function openWhatsNewModal(options) {
        options = options || {};
        const force = options.force === true;
        if (!window.AppModal) {
            return;
        }
        if (!force) {
            try {
                const lastSeen = localStorage.getItem(STORAGE_KEY);
                if (lastSeen === DASHBOARD_RELEASE) {
                    return;
                }
            } catch (error) {
                // Ignore localStorage failures.
            }
            if (typeof options.ifBlockingModalOpen === 'function' && options.ifBlockingModalOpen()) {
                return;
            }
        }

        window.AppModal.show({
            title: "what's new",
            htmlMessage: buildHtml(),
            confirmText: 'close',
            showCancel: false,
            modalMaxWidth: '600px',
            modalWidth: '96vw',
        });
        try {
            localStorage.setItem(STORAGE_KEY, DASHBOARD_RELEASE);
        } catch (error) {
            // Ignore localStorage failures.
        }
    };
})();
