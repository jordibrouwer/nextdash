/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const VERSION = '2026.05-whatsnew-tags-collections-category-reorder-v1';
    const STORAGE_KEY = 'nextdash:last-whats-new-version';

    function buildHtml() {
        return `
            <div class="keyboard-cheat-sheet">
                <p class="keyboard-cheat-sheet-intro">Recent upgrades and the places where they now work better.</p>
                <div class="keyboard-cheat-sheet-grid">
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Tags</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">add tags</span><span class="keyboard-cheat-sheet-description">Add comma-separated tags to any bookmark in config → bookmarks or via the inline editor on the dashboard.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">tag:work</span><span class="keyboard-cheat-sheet-description">Filter bookmarks by tag in the search bar — partial matches supported.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → tags</span><span class="keyboard-cheat-sheet-description">See all tags with usage counts, rename, merge, or delete them from a single overview.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">tag cloud</span><span class="keyboard-cheat-sheet-description">The tag cloud at the top of the tags tab gives a visual overview — larger means more bookmarks use that tag.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Collections</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → collections</span><span class="keyboard-cheat-sheet-description">Create dynamic bookmark groups with a name, optional icon, match logic (AND/OR), and one or more rules.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">rule fields</span><span class="keyboard-cheat-sheet-description">Filter by tag, category, or shortcut — using includes or excludes operators.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">dashboard</span><span class="keyboard-cheat-sheet-description">Collections appear as groups on the dashboard alongside smart collections, before regular categories.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">tag collections</span><span class="keyboard-cheat-sheet-description">Enable auto tag-collections in config → general to generate one dashboard group per tag automatically.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Category Order</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">drag on dashboard</span><span class="keyboard-cheat-sheet-description">Hover over a category title to reveal the grip handle (⠿), then drag it to reorder categories directly on the dashboard.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">auto-save</span><span class="keyboard-cheat-sheet-description">The new order is saved automatically — no need to open config or press Save.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → categories</span><span class="keyboard-cheat-sheet-description">Category order can also be changed by dragging rows in the categories config tab.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">collapse</span><span class="keyboard-cheat-sheet-description">Click the category title (not the handle) to collapse or expand it — drag and click work independently.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Preview Cards</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">hover + open</span><span class="keyboard-cheat-sheet-description">Preview cards now close as soon as you open a bookmark link, so they do not stick around when you return.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">keyboard open</span><span class="keyboard-cheat-sheet-description">Enter or Space also dismisses the preview before navigating.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → general</span><span class="keyboard-cheat-sheet-description">Preview cards still have a toggle and hover delay in Dashboard settings.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">notes</span><span class="keyboard-cheat-sheet-description">Bookmark notes continue to appear inside the preview card when available.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config Bookmarks</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → bookmarks</span><span class="keyboard-cheat-sheet-description">The bookmarks config tab now stays readable with a sticky controls bar and a sticky detail panel.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">split view</span><span class="keyboard-cheat-sheet-description">The list stays on the left, the editor stays on the right, even while you scroll through many bookmarks.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">bulk toolbar</span><span class="keyboard-cheat-sheet-description">The bulk editor bar can stay pinned while active, and you can still close it without losing selections.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">auto scroll</span><span class="keyboard-cheat-sheet-description">Choosing a bookmark keeps the selected row in view instead of pushing the editor out of place.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Search History</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">/</span><span class="keyboard-cheat-sheet-description">Recent search terms are kept and suggested while you type.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">20 items</span><span class="keyboard-cheat-sheet-description">The search history keeps more entries now, so old queries are easier to reuse.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">dedupe</span><span class="keyboard-cheat-sheet-description">Repeated queries are moved to the top instead of being duplicated.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">click or enter</span><span class="keyboard-cheat-sheet-description">Pick a history item to rerun it instantly.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Help &amp; Config Sync</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">help page</span><span class="keyboard-cheat-sheet-description">The help page and the modal both reflect the latest dashboard, preview, and config updates.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">what's new</span><span class="keyboard-cheat-sheet-description">Open this modal from Config → General → Advanced for a quick recap of what changed recently.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config save</span><span class="keyboard-cheat-sheet-description">Settings stay in sync after saving, including preview, bookmarks, and toolbar behavior.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Browser Bookmark Import</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → backups</span><span class="keyboard-cheat-sheet-description">Import bookmarks straight from your browser — no manual copy-paste needed.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">.html export</span><span class="keyboard-cheat-sheet-description">Use your browser's built-in "Export Bookmarks" to get the file (Chrome, Firefox, Edge all work).</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">folder → category</span><span class="keyboard-cheat-sheet-description">Bookmark folders become categories automatically; missing ones are created for you.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">duplicate skip</span><span class="keyboard-cheat-sheet-description">URLs already in nextDash are skipped — no double entries, no clean-up needed.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">CSV Export</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → backups</span><span class="keyboard-cheat-sheet-description">Download all your bookmarks from every page as a single CSV file.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">columns</span><span class="keyboard-cheat-sheet-description">Name, URL, Category, Page, Shortcut — opens cleanly in Excel, Google Sheets, or any editor.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">date stamped</span><span class="keyboard-cheat-sheet-description">File saves as nextdash-bookmarks-YYYY-MM-DD.csv so versions don't overwrite each other.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">UTF-8</span><span class="keyboard-cheat-sheet-description">The file includes a BOM so special characters display correctly in Excel without manual encoding steps.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Bookmark Notes</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">add &amp; edit</span><span class="keyboard-cheat-sheet-description">Notes can be added via Ctrl+Shift+A, edited inline on the dashboard, and managed in the config detail panel.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">preview cards</span><span class="keyboard-cheat-sheet-description">If a bookmark has a note, a compact note snippet now appears in the hover preview card.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">note column</span><span class="keyboard-cheat-sheet-description">The note indicator sits in its own trailing column on dashboard rows for faster scanning.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">theme-aware icon</span><span class="keyboard-cheat-sheet-description">The note indicator is an SVG icon that adapts to light and dark themes.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config Bookmarks Split-View</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">config → bookmarks</span><span class="keyboard-cheat-sheet-description">The bookmarks tab is now a split-view: compact list on the left, detail panel on the right.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">click to edit</span><span class="keyboard-cheat-sheet-description">Click any bookmark row to open all its fields — name, URL, page, category, shortcut, icon, note, pinned, and status check — without leaving the page.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">live sync</span><span class="keyboard-cheat-sheet-description">Changes in the detail panel write directly to the list row in real time as you type.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">bulk toolbar</span><span class="keyboard-cheat-sheet-description">Select multiple rows to move category or page, toggle pin, refresh favicons, or delete in one action.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">New Bookmark Modal</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Ctrl+Shift+A</span><span class="keyboard-cheat-sheet-description">The new-bookmark modal is redesigned to match the config split-view style — flat sections, no floating card.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">page selector</span><span class="keyboard-cheat-sheet-description">Pick the target page directly in the modal — no need to navigate first.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">note field</span><span class="keyboard-cheat-sheet-description">Add a note at creation time; it appears on the dashboard and in hover previews immediately.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">themed buttons</span><span class="keyboard-cheat-sheet-description">All buttons (Fetch, Upload, Cancel, Create) now use the dashboard theme instead of browser defaults.</span></div>
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
                if (lastSeen === VERSION) {
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
            modalMaxWidth: '920px',
            modalWidth: '94vw'
        });
        try {
            localStorage.setItem(STORAGE_KEY, VERSION);
        } catch (error) {
            // Ignore localStorage failures.
        }
    };
})();
