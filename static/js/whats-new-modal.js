/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v1';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function buildHtml() {
        return `
            <div class="keyboard-cheat-sheet">
                <p class="keyboard-cheat-sheet-intro">Short recap of recent changes.</p>
                <div class="keyboard-cheat-sheet-grid">
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Tags</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">add tags</span><span class="keyboard-cheat-sheet-description">Add comma-separated tags in config → bookmarks or inline edit.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">tag:work</span><span class="keyboard-cheat-sheet-description">Filter by tag in search, partial matches included.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → tags</span><span class="keyboard-cheat-sheet-description">View counts, rename, merge, delete.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Collections</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → collections</span><span class="keyboard-cheat-sheet-description">Build dynamic groups with AND/OR rules.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">rule fields</span><span class="keyboard-cheat-sheet-description">Match by tag, category, or shortcut.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">dashboard</span><span class="keyboard-cheat-sheet-description">Collections show before regular categories.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Category Order</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">drag on dashboard</span><span class="keyboard-cheat-sheet-description">Use the grip handle to reorder categories.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">auto-save</span><span class="keyboard-cheat-sheet-description">Order saves automatically.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">collapse</span><span class="keyboard-cheat-sheet-description">Click title to collapse or expand.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Preview Cards</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">hover + open</span><span class="keyboard-cheat-sheet-description">Previews close when a link opens.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">keyboard open</span><span class="keyboard-cheat-sheet-description">Enter or Space dismisses preview too.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">notes</span><span class="keyboard-cheat-sheet-description">Notes still appear in previews.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config Bookmarks</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → bookmarks</span><span class="keyboard-cheat-sheet-description">Sticky controls bar, sticky detail panel.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">split view</span><span class="keyboard-cheat-sheet-description">List left, editor right.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">auto scroll</span><span class="keyboard-cheat-sheet-description">Selected row stays in view.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Search History</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">/</span><span class="keyboard-cheat-sheet-description">Recent terms stay suggested.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">20 items</span><span class="keyboard-cheat-sheet-description">More history kept for reuse.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">dedupe</span><span class="keyboard-cheat-sheet-description">Repeated queries move to top.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Help &amp; Config Sync</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">help page</span><span class="keyboard-cheat-sheet-description">Help and modal track latest changes.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">what's new</span><span class="keyboard-cheat-sheet-description">Open from Config → General → Advanced.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config save</span><span class="keyboard-cheat-sheet-description">Settings stay in sync after save.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Browser Bookmark Import</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → backups</span><span class="keyboard-cheat-sheet-description">Import bookmarks straight from browser.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">.html export</span><span class="keyboard-cheat-sheet-description">Use browser export bookmarks file.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">duplicate skip</span><span class="keyboard-cheat-sheet-description">Existing URLs are skipped.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">CSV Export</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → backups</span><span class="keyboard-cheat-sheet-description">Export all bookmarks as CSV.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">columns</span><span class="keyboard-cheat-sheet-description">Name, URL, Category, Page, Shortcut.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">UTF-8</span><span class="keyboard-cheat-sheet-description">Excel-safe BOM included.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Bookmark Notes</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">add &amp; edit</span><span class="keyboard-cheat-sheet-description">Add notes in modal, inline, or config.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">preview cards</span><span class="keyboard-cheat-sheet-description">Notes show in hover preview.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">note column</span><span class="keyboard-cheat-sheet-description">Dedicated trailing note column.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config Bookmarks Split-View</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → bookmarks</span><span class="keyboard-cheat-sheet-description">Compact list left, detail right.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">click to edit</span><span class="keyboard-cheat-sheet-description">Open all bookmark fields in place.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">live sync</span><span class="keyboard-cheat-sheet-description">Edits write to the row instantly.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">New Bookmark Modal</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Ctrl+Shift+A</span><span class="keyboard-cheat-sheet-description">Flat modal, no floating card.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">page selector</span><span class="keyboard-cheat-sheet-description">Pick target page inside modal.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">note field</span><span class="keyboard-cheat-sheet-description">Add note at creation time.</span></div>
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
