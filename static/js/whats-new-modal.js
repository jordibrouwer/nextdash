/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v2';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function buildHtml() {
        return `
            <div class="keyboard-cheat-sheet">
                <p class="keyboard-cheat-sheet-intro">Short recap of recent changes.</p>
                <div class="keyboard-cheat-sheet-grid">
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">:note command</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">:note</span><span class="keyboard-cheat-sheet-description">Lists all bookmarks — current page first.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">:note github</span><span class="keyboard-cheat-sheet-description">Filters by name or URL and opens an edit modal.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Ctrl+Enter</span><span class="keyboard-cheat-sheet-description">Save note in the modal; Esc to cancel.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Inline Rename</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">double-click page tab</span><span class="keyboard-cheat-sheet-description">Rename a page tab directly on the dashboard.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">double-click category</span><span class="keyboard-cheat-sheet-description">Rename a category title inline — no config needed.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Enter / Esc</span><span class="keyboard-cheat-sheet-description">Commit or cancel either rename.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Undo Delete</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">delete bookmark</span><span class="keyboard-cheat-sheet-description">Bookmark disappears immediately from the dashboard.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Ongedaan maken</span><span class="keyboard-cheat-sheet-description">Click the toast button within 5 s to restore it.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">auto-persist</span><span class="keyboard-cheat-sheet-description">If not undone, the deletion is saved after 5 s.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Hover Card: Copy URL</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">hover bookmark</span><span class="keyboard-cheat-sheet-description">Preview card stays open when you move onto it.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">clipboard icon</span><span class="keyboard-cheat-sheet-description">Appears in the card footer — click to copy the URL.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">toast confirm</span><span class="keyboard-cheat-sheet-description">"URL gekopieerd" toast confirms the copy succeeded.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Open-Count Badge</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">compact / dense mode</span><span class="keyboard-cheat-sheet-description">A subtle number badge shows how often each bookmark was opened.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">hover row</span><span class="keyboard-cheat-sheet-description">Badge brightens on hover; hidden in comfortable density.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">1k notation</span><span class="keyboard-cheat-sheet-description">Counts ≥ 1000 are shown as 1k, 2k, …</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Dark / Light Toggle</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">header button</span><span class="keyboard-cheat-sheet-description">Flips the active theme between its dark and light variant.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">enable in config</span><span class="keyboard-cheat-sheet-description">Config → General → show dark/light toggle.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">persisted</span><span class="keyboard-cheat-sheet-description">The chosen variant is saved to settings immediately.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config Bookmark Search</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">search bar</span><span class="keyboard-cheat-sheet-description">Filter the config bookmark list by name, URL, tag, or note.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Esc / ✕</span><span class="keyboard-cheat-sheet-description">Clear the search and show all bookmarks again.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">auto-reset</span><span class="keyboard-cheat-sheet-description">Search clears when switching to a different page.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Health: Favicon Refresh</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">favicon button</span><span class="keyboard-cheat-sheet-description">Re-fetches and stores a fresh favicon per bookmark in health view.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">auto-store</span><span class="keyboard-cheat-sheet-description">Icon is downloaded and saved locally, no external requests at runtime.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">New Bookmark Modal</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Ctrl+Shift+A / :new</span><span class="keyboard-cheat-sheet-description">Open modal from dashboard.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">tags field</span><span class="keyboard-cheat-sheet-description">Comma-separated tags with autocomplete from existing tags.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">page + category</span><span class="keyboard-cheat-sheet-description">Choose target page and category at creation time.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config Bookmarks Split-View</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → bookmarks</span><span class="keyboard-cheat-sheet-description">Compact list left, detail right.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">click to edit</span><span class="keyboard-cheat-sheet-description">All fields including tags editable in place.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">live sync</span><span class="keyboard-cheat-sheet-description">Edits write to the row instantly.</span></div>
                        </div>
                    </section>
                </div>
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
            title: "What's new",
            htmlMessage: buildHtml(),
            confirmText: 'Close',
            showCancel: false,
            modalClass: 'keyboard-cheat-sheet-modal',
            modalMaxWidth: '820px',
            modalWidth: '90vw'
        });
        try {
            localStorage.setItem(STORAGE_KEY, DASHBOARD_RELEASE);
        } catch (error) {
            // Ignore localStorage failures.
        }
    };
})();
