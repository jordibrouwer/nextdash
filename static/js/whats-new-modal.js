/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v13';
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
                    ${section('dashboard — paste to quick-add', [
                        ['Ctrl+V / Cmd+V', 'Paste a URL anywhere on the dashboard to open the quick-add modal with the URL pre-filled. Works when no input is focused, no search is active, and the pasted text is a valid URL.'],
                        ['config toggle', 'Can be disabled in config → general → Bookmarks → "Paste URL to quick-add bookmark".'],
                    ])}
                    ${section('search — history UI', [
                        ['↺ recent', 'Open search with <code>&gt;</code> and recent searches appear immediately under "Recent" — click any entry to re-run it.'],
                        ['× delete', 'Hover a history row to reveal a × button — click it to remove only that entry without closing search.'],
                        [':history', 'Type <code>:history</code> to browse search history even when you have an active query.'],
                        [':history clear', 'Type <code>:history clear</code> to wipe the entire search history in one step.'],
                    ])}
                    ${section('config — bookmarks side panel', [
                        ['page field', 'Choose a different page → categories for that page load immediately.'],
                        ['→ Move button', 'Confirm the move. Bookmark is saved to the chosen page and category.'],
                        ['delete button', 'Delete a bookmark directly from the detail panel. New bookmarks are removed without confirmation.'],
                        ['empty state', 'Panel is empty when nothing is selected — click outside a row to deselect.'],
                    ])}
                    ${section('dashboard — UI polish', [
                        ['stagger', 'Bookmark rows fade in with a subtle stagger (10 ms per row, capped) — page transitions stay snappy.'],
                        ['drag outline', 'Non-smart category lists show a dashed outline while a drag is in progress so drop targets are always visible.'],
                        ['focus ring', 'Keyboard-selected bookmarks show a clear outline; inline-edit fields have a matching focus ring.'],
                        ['hover color', 'Status color (online/offline) no longer overrides the hover text color.'],
                    ])}
                    ${section('config — pages', [
                        ['dropdowns', 'After saving, all page dropdowns (categories, bookmarks, settings) update instantly — no reload needed.'],
                    ])}
                    ${section('health &amp; stats', [
                        ['keep first', 'Each duplicate group has a button that resolves duplicates in one click.'],
                        ['health badge', 'Health link shows a red (broken) or yellow (warnings) badge count.'],
                        ['conflicts', 'Stats tab shows duplicate URLs and shortcut conflicts with a link to Health.'],
                        ['filter saved', 'Filter, sort order and search term in Health are preserved on refresh.'],
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
