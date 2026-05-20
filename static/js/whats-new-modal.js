/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v23';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function buildHtml() {
        return `
            <div class="help-content">
                <p class="help-intro">A short recap of the most recent changes.</p>
                <h4 class="help-subheading">UI & discoverability</h4>
                <ul>
                    <li><strong>Search mode chips</strong> — The search overlay now shows <em>&gt; search</em> · <em>: commands</em> · <em>? finders</em> chips at the bottom. Click any chip to switch mode; the active chip is highlighted in the mode's accent colour.</li>
                    <li><strong>Button tooltips</strong> — Hovering over the search, commands, finders, recent, or cheatsheet buttons shows a small tooltip with the corresponding keyboard shortcut. Not shown on touch devices.</li>
                    <li><strong>Search-flow hint</strong> — The hint banner is now positioned above the button bar without affecting button layout when dismissed. Visual style updated to match the app's borders and background.</li>
                    <li><strong>Mobile header</strong> — On small screens the header stays as a single horizontal row. The date/time widget is hidden to free vertical space for bookmarks.</li>
                    <li><strong>Content area width</strong> — Main content now uses <code>min(88%, 1600px)</code> instead of 80%, giving more grid space on laptop screens and capping neatly on ultra-wide monitors.</li>
                    <li><strong>Config nav links</strong> — The "back to dashboard", "health", and "customize theme" links in the config header now use the same text colour as the equivalent links on the dashboard.</li>
                </ul>
                <h4 class="help-subheading">Search</h4>
                <ul>
                    <li><strong>Mode badge</strong> — The search bar shows a coloured badge for the active input mode: <em>SEARCH</em>, <em>CMD</em>, <em>FIND</em>, or <em>FUZZY</em>.</li>
                    <li><strong>Filter group</strong> — Filter autocomplete suggestions (category:, status:, page:, tag:) are grouped under a collapsible "Filters" header, separate from bookmark results.</li>
                    <li><strong>Empty state</strong> — Opening search with an empty query shows helpful groups (Recent, Filters, Finders) immediately.</li>
                </ul>
                <h4 class="help-subheading">Dashboard</h4>
                <ul>
                    <li><strong>Category collapse animation</strong> — Categories fold and unfold with a smooth height transition.</li>
                    <li><strong>Collapse chevron</strong> — A chevron is always visible next to each category name and rotates when collapsed.</li>
                    <li><strong>Smart collection headers</strong> — Tinted with the accent colour to stand out from regular categories.</li>
                    <li><strong>Smart collection empty state</strong> — Shows a contextual message when a smart collection has no matching items.</li>
                    <li><strong>Focus indicators</strong> — Keyboard focus rings are consistently styled across bookmarks, category headers, and search items.</li>
                </ul>
                <h4 class="help-subheading">Quick-add</h4>
                <ul>
                    <li><strong>Loading states</strong> — Spinner on the icon preview during favicon fetch; Save button shows a loading state while saving.</li>
                    <li><strong>Clear icon button</strong> — A × button next to the icon preview lets you reset to the default favicon without closing the form.</li>
                </ul>
                <h4 class="help-subheading">Config — bookmarks</h4>
                <ul>
                    <li><strong>Last opened date/time</strong> — Each bookmark row now shows the date and time it was last opened.</li>
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
