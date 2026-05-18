/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v17';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function section(title, rows) {
        const rowsHtml = rows.map(([key, desc]) => `
            <tr>
                <td class="keyboard-cheat-sheet-keys">${key}</td>
                <td class="keyboard-cheat-sheet-description">${desc}</td>
            </tr>`).join('');
        return `
            <section class="keyboard-cheat-sheet-panel">
                <h3 class="keyboard-cheat-sheet-section-title">${title}</h3>
                <table class="keyboard-cheat-sheet-table"><tbody>${rowsHtml}</tbody></table>
            </section>`;
    }

    function buildHtml() {
        return `
            <div class="keyboard-cheat-sheet">
                <div class="keyboard-cheat-sheet-grid">
                    ${section('localisation — language &amp; translations', [
                        ['language selector', 'Changing language in config → general now applies instantly on both the config page and the dashboard — no page reload needed.'],
                        ['i18n robustness', 'All UI text falls back to English when translations are not yet loaded, preventing raw translation keys (like &ldquo;dashboard.config&rdquo;) from appearing as visible text.'],
                        ['locale files', 'Invalid JSON in the English, Dutch, and German locale files has been repaired. All translations now load correctly.'],
                    ])}
                    ${section('config — navigation links', [
                        ['config header', 'Health link is now always visible in the config header between "→ customize theme" and "← back to dashboard". It pulses with your theme colour and shows the same red/yellow badge as the dashboard.'],
                        ['health page', 'Navigation links reordered to match the config style: <em>refresh</em> | <em>← back to config</em> | <em>← back to dashboard</em>.'],
                    ])}
                    ${section('config — pages (delete empty pages)', [
                        ['remove button', 'Empty pages (no bookmarks) can now be deleted. Previously the delete failed silently because there was no bookmark file to remove.'],
                    ])}
                    ${section('dashboard — scroll clearance', [
                        ['bottom padding', 'The bookmark grid now has enough bottom padding so the last bookmark rows are never hidden behind the floating action buttons.'],
                    ])}
                    ${section('config — pages (archive)', [
                        ['archive button', 'Archive a page from the pages list. The row dims and shows an "archived" badge. Archived pages are hidden from the dashboard.'],
                        ['restore button', 'Click Restore on an archived page to bring it back. The button switches between Archive and Restore automatically.'],
                        ['dropdowns', 'After saving, all page dropdowns update instantly — no reload needed.'],
                    ])}
                    ${section('config — general (alignment)', [
                        ['3-column layout', 'All checkboxes are now aligned in three columns: [checkbox] [↺ reset] [label]. Rows without a reset button leave the column empty so labels stay aligned.'],
                        ['↺ reset buttons', 'Settings that differ from their default show a ↺ button between the checkbox and the label. Click to restore the default.'],
                    ])}
                    ${section('dashboard — navigation', [
                        ['Tab / Shift+Tab', 'Step linearly through all bookmarks when one is already selected. Wraps around.'],
                        ['G + 1–9', 'Jump to the nth visible, non-collapsed category and select its first bookmark.'],
                        ['GG', 'Jump to the very first bookmark on the page.'],
                    ])}
                    ${section('dashboard — quick-add &amp; paste', [
                        ['<code>+</code>', 'Quick-add omnibox: type <code>name | url | shortcut</code> and press Enter. Favicon is fetched automatically.'],
                        ['Ctrl+V / Cmd+V', 'Paste a URL anywhere on the dashboard to open the quick-add modal with the URL pre-filled. Toggle in config → general → Bookmarks.'],
                    ])}
                    ${section('search — history', [
                        ['↺ Recent', 'Open search (<code>&gt;</code>) with no query — recent searches appear immediately under a collapsible "Recent" group.'],
                        ['× on hover', 'Hover a history row to reveal a × button that removes only that entry.'],
                        ['<code>:history</code>', 'Browse search history from the command bar, even with an active query.'],
                        ['<code>:history clear</code>', 'Wipe the entire search history in one step.'],
                    ])}
                    ${section('config — bookmarks side panel', [
                        ['page field', 'Choose a different page → categories for that page load immediately.'],
                        ['→ Move button', 'Confirm the move. Bookmark is saved to the chosen page and category.'],
                        ['delete button', 'Delete a bookmark directly from the detail panel. New bookmarks are removed without confirmation.'],
                    ])}
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
            title: "what's new",
            htmlMessage: buildHtml(),
            confirmText: 'close',
            showCancel: false,
            modalClass: 'keyboard-cheat-sheet-modal',
            modalMaxWidth: '960px',
            modalWidth: '96vw'
        });
        try {
            localStorage.setItem(STORAGE_KEY, DASHBOARD_RELEASE);
        } catch (error) {
            // Ignore localStorage failures.
        }
    };
})();
