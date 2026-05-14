/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v5';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function buildHtml() {
        return `
            <div class="keyboard-cheat-sheet">
                <p class="keyboard-cheat-sheet-intro">Short recap of recent changes.</p>
                <div class="keyboard-cheat-sheet-grid">
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Command palette — grouped</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">:</span><span class="keyboard-cheat-sheet-description">Commands now shown in three collapsed groups: Bookmarks, View, Dashboard.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">↑ ↓ / Tab</span><span class="keyboard-cheat-sheet-description">Navigate through group headers and items with arrow keys or Tab.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Enter / click</span><span class="keyboard-cheat-sheet-description">Toggle a group open or closed; type to filter directly.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Search empty state — grouped</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">open search</span><span class="keyboard-cheat-sheet-description">Recent, Filters, and Finders shown as collapsed groups instead of a flat list.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Recent</span><span class="keyboard-cheat-sheet-description">Automatically expands when you have search history.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">type anything</span><span class="keyboard-cheat-sheet-description">Groups disappear and normal search results appear.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Empty state for pages</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">empty page</span><span class="keyboard-cheat-sheet-description">Shows a terminal-style prompt with the page name and shortcut hints.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">fresh install</span><span class="keyboard-cheat-sheet-description">Separate "No bookmarks yet" state with direct links to add or import.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">No search results — hints</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">no matches</span><span class="keyboard-cheat-sheet-description">Two clickable hints appear: add as new bookmark via :new, or search with a finder.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">click hint</span><span class="keyboard-cheat-sheet-description">Pre-fills the search bar with :new &lt;query&gt; or ?FINDER &lt;query&gt;.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Hover card — usage stats</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">hover bookmark</span><span class="keyboard-cheat-sheet-description">Preview card now shows open count and last-opened date.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">viewport aware</span><span class="keyboard-cheat-sheet-description">Card repositions automatically to stay fully on screen.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Reset setting to default</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">↺ button</span><span class="keyboard-cheat-sheet-description">Appears next to a setting when its value differs from the default.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">click ↺</span><span class="keyboard-cheat-sheet-description">Resets that single setting to its default value and marks the form dirty.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Onboarding — smart collections</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">new step</span><span class="keyboard-cheat-sheet-description">Onboarding now includes a step to enable Today and Most Used smart collections.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Today / Most Used</span><span class="keyboard-cheat-sheet-description">Toggle each collection on or off right from the onboarding flow.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Page transition animation</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">switch page tab</span><span class="keyboard-cheat-sheet-description">Dashboard content fades and slides in smoothly when switching pages.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">no-animations</span><span class="keyboard-cheat-sheet-description">Transition is skipped when reduced-motion is active.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Backup &amp; Restore feedback</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Create Backup</span><span class="keyboard-cheat-sheet-description">Button shows a spinner and "Creating…" while the ZIP is being generated.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Import / Export CSV</span><span class="keyboard-cheat-sheet-description">All backup buttons show a loading state during the operation.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Preview card via keyboard</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">-</span><span class="keyboard-cheat-sheet-description">Toggle the preview card on the keyboard-selected bookmark (navigate with ↑ ↓ first).</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">- again / ↑ ↓</span><span class="keyboard-cheat-sheet-description">Press - again or move to another bookmark to close the card.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Copy URL via keyboard</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Ctrl + C</span><span class="keyboard-cheat-sheet-description">Copies the URL of the keyboard-selected bookmark — no hover card needed.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">toast</span><span class="keyboard-cheat-sheet-description">"URL copied" confirmation appears briefly after copying.</span></div>
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
