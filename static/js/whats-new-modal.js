/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v7';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function buildHtml() {
        return `
            <div class="keyboard-cheat-sheet">
                <p class="keyboard-cheat-sheet-intro">Short recap of recent changes.</p>
                <div class="keyboard-cheat-sheet-grid">
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config — backups tab</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">backups tab</span><span class="keyboard-cheat-sheet-description">ZIP backup, browser import, and CSV export are now grouped in a dedicated Backups tab.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">reset</span><span class="keyboard-cheat-sheet-description">Reset all data and Reset context tips have moved to the bottom of the General tab, clearly marked as a danger zone.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config — tab bar</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">full width</span><span class="keyboard-cheat-sheet-description">Tab buttons now spread evenly across the full width of the center column.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">scroll indicator</span><span class="keyboard-cheat-sheet-description">On narrow screens a fade gradient appears at the right edge when tabs overflow — it disappears once you've scrolled to the end.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">theme color</span><span class="keyboard-cheat-sheet-description">The active tab underline now follows your theme accent color instead of always being green.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config — collapsible cards</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">+  /  −</span><span class="keyboard-cheat-sheet-description">Section titles now show a colored + or − prefix. The whole title changes color on hover so it's clear it's clickable.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Config — general tab</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Show tips</span><span class="keyboard-cheat-sheet-description">"Show tips above buttons" has moved to the Appearance &amp; Style card.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Favicon</span><span class="keyboard-cheat-sheet-description">Favicon harmonization settings have also moved to Appearance &amp; Style.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Health — sorting</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">sort by</span><span class="keyboard-cheat-sheet-description">Issues can now be sorted by score, status, last checked (oldest or newest first), or name.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">UI — consistency</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">focus rings</span><span class="keyboard-cheat-sheet-description">Keyboard focus is now visible on all inputs, selects, buttons and links across every page.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">disabled state</span><span class="keyboard-cheat-sheet-description">Disabled buttons now show a distinct background and muted text — no longer just a faint opacity.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">card padding</span><span class="keyboard-cheat-sheet-description">Card padding is now consistent across config, health, backups, stats and help via a single spacing token.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">sharp corners</span><span class="keyboard-cheat-sheet-description">Health page buttons, cards and badges now match the sharp border-radius used in config.</span></div>
                        </div>
                    </section>
                    <section class="keyboard-cheat-sheet-panel">
                        <h3 class="keyboard-cheat-sheet-section-title">Health — loading feedback</h3>
                        <div class="keyboard-cheat-sheet-list">
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Retest all</span><span class="keyboard-cheat-sheet-description">Shows a spinner and stays disabled until retesting and the report reload are both complete.</span></div>
                            <div class="keyboard-cheat-sheet-row"><span class="keyboard-cheat-sheet-keys">Open broken</span><span class="keyboard-cheat-sheet-description">Same treatment — button is locked while the request is in flight.</span></div>
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
