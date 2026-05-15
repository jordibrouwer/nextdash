/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v6';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function buildHtml() {
        return `
            <div class="keyboard-cheat-sheet">
                <p class="keyboard-cheat-sheet-intro">Short recap of recent changes.</p>
                <div class="keyboard-cheat-sheet-grid">
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Search — match highlighting</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">type query</span><span class="keyboard-cheat-sheet-description">Matched characters are now underlined in bold in search results — both the shortcut and the bookmark name.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">fuzzy</span><span class="keyboard-cheat-sheet-description">Fuzzy results keep their own highlight style; shortcut results use the new underline mark.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Search — filter autocomplete</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">status:</span><span class="keyboard-cheat-sheet-description">Typing status: now shows all known values: online, offline, broken, ok, pinned, unpinned, checked, unchecked.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">status:on</span><span class="keyboard-cheat-sheet-description">Narrows completions as you type — only matching values are shown, each with a short description.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Command bar — bookmark context</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">↑ ↓ then :</span><span class="keyboard-cheat-sheet-description">Navigate to a bookmark with arrow keys, then press : to open the command bar with that bookmark pre-selected as context.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">:REMOVE / :NOTE</span><span class="keyboard-cheat-sheet-description">These completions are pre-filled with the bookmark name so you can confirm immediately.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Toast undo — inline delete</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">:remove</span><span class="keyboard-cheat-sheet-description">Deleting a bookmark via the command bar now shows an undo toast (8 s window).</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Undo</span><span class="keyboard-cheat-sheet-description">Click Undo in the toast to restore the bookmark exactly as it was.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Drag — placeholder animation</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">drag bookmark</span><span class="keyboard-cheat-sheet-description">The drop placeholder now fades and scales in smoothly each time it moves to a new position.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">empty category</span><span class="keyboard-cheat-sheet-description">A dashed outline appears on empty categories while dragging, so you can still drop into them.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config — general tab redesign</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">cards</span><span class="keyboard-cheat-sheet-description">Bookmarks split into Display and Behavior cards; Language merged into a new Localization card with date, time, and weather.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Smart Collections</span><span class="keyboard-cheat-sheet-description">Each collection is now a collapsible block — no more scrolling through a long flat list.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Buttons table</span><span class="keyboard-cheat-sheet-description">Header &amp; Buttons is now a compact table: one row per button, Show and Label columns side by side.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">collapse state</span><span class="keyboard-cheat-sheet-description">Only Appearance and Layout are open by default. Your open/closed state is saved and restored across sessions.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config — dirty state indicator</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">unsaved changes</span><span class="keyboard-cheat-sheet-description">The sticky config toolbar gets an amber bottom border when there are unsaved changes.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">↺ button</span><span class="keyboard-cheat-sheet-description">Reset tooltip now shows both the default and the previous value: "Reset to 14 (was 20)".</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config — tab bar &amp; reorder hint</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">narrow screen</span><span class="keyboard-cheat-sheet-description">Config tabs are now horizontally scrollable with a fade-out gradient when more tabs are off screen.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Pages tab</span><span class="keyboard-cheat-sheet-description">Hint text at the top of the Pages tab explains how to drag-reorder pages.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Category collapse — per page</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">collapse</span><span class="keyboard-cheat-sheet-description">Collapsed state is now stored per page, not globally — categories with the same name on different pages no longer conflict.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Search history cap</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">history</span><span class="keyboard-cheat-sheet-description">Search history is now capped at 15 entries — oldest entries are dropped automatically.</span></div>
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
