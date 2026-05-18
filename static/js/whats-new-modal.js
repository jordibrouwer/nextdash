/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v20';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function buildHtml() {
        return `
            <div class="help-content">
                <p class="help-intro">A short recap of the most recent changes.</p>
                <h4 class="help-subheading">Config — stats</h4>
                <ul>
                    <li><strong>Opens filter</strong> — The three opens tables (top by count, most recently opened, most clicked) can now be filtered by time window: Total, Last 30 days, or Last 7 days.</li>
                </ul>
                <h4 class="help-subheading">Config — bookmarks</h4>
                <ul>
                    <li><strong>Bulk feedback</strong> — Bulk delete, pin toggle, and move-to-page now show a toast with the number of affected bookmarks.</li>
                </ul>
                <h4 class="help-subheading">Codebase</h4>
                <ul>
                    <li><strong>Shared TagAutocomplete</strong> — The tag autocomplete is now a single shared file (<code>tag-autocomplete.js</code>). The duplicate copies in dashboard and config-bookmarks have been removed.</li>
                </ul>
                <h4 class="help-subheading">Config — reset</h4>
                <ul>
                    <li><strong>Full reset</strong> — The reset button now correctly wipes all pages, bookmarks, categories, finders, and settings — including extra pages beyond page 1. Tags and collections are also cleared.</li>
                    <li><strong>Enter to confirm</strong> — Pressing Enter in the confirmation input triggers the reset — no need to click the button.</li>
                    <li><strong>Redirect after reset</strong> — After a successful reset the app navigates to the dashboard after 1 second so you start fresh immediately.</li>
                </ul>
                <h4 class="help-subheading">Config — advanced</h4>
                <ul>
                    <li><strong>Context tips moved</strong> — "Reset context tips" has moved from the Reset section to Advanced, with a description matching the layout of other Advanced actions.</li>
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
