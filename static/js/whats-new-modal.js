/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v22';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function buildHtml() {
        return `
            <div class="help-content">
                <p class="help-intro">A short recap of the most recent changes.</p>
                <h4 class="help-subheading">Search</h4>
                <ul>
                    <li><strong>Mode badge</strong> — The search bar now shows a coloured badge indicating the active input mode: <em>SEARCH</em>, <em>CMD</em>, <em>FIND</em>, or <em>FUZZY</em>.</li>
                    <li><strong>Filter group</strong> — Filter autocomplete suggestions (category:, status:, page:, tag:) are now grouped under a collapsible "Filters" header, separate from bookmark results.</li>
                    <li><strong>Empty state</strong> — Opening search with an empty query now shows helpful groups (Recent, Filters, Finders) even before you type.</li>
                </ul>
                <h4 class="help-subheading">Dashboard</h4>
                <ul>
                    <li><strong>Category collapse animation</strong> — Categories now fold and unfold with a smooth height transition instead of snapping instantly.</li>
                    <li><strong>Collapse chevron</strong> — A subtle chevron arrow is always visible next to each category name, rotating when collapsed to make the affordance clear.</li>
                    <li><strong>Smart collection headers</strong> — Smart collection headers (Today, Recently opened, Most used, Stale) are now tinted with the accent colour so they stand out from regular categories.</li>
                    <li><strong>Smart collection empty state</strong> — When a smart collection has no items it now shows a contextual message instead of an empty area.</li>
                    <li><strong>Focus indicators</strong> — Keyboard focus rings are now consistently styled across bookmarks, category headers, and search result items.</li>
                </ul>
                <h4 class="help-subheading">Quick-add</h4>
                <ul>
                    <li><strong>Loading states</strong> — A spinner appears on the icon preview while the favicon is being fetched, and the Save button shows a loading state while the bookmark is being saved.</li>
                    <li><strong>Clear icon button</strong> — A × button appears next to the icon preview after an icon is set, letting you reset to the default favicon without closing the form.</li>
                </ul>
                <h4 class="help-subheading">Config — bookmarks</h4>
                <ul>
                    <li><strong>Last opened date/time</strong> — Each bookmark row now shows the date and time it was last opened, next to the open count.</li>
                    <li><strong>Sort by last opened</strong> — The sort dropdown now includes a "Last opened" option.</li>
                    <li><strong>Show icons on by default</strong> — Bookmark icons are now enabled by default for new users.</li>
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
