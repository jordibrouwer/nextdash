/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v12';
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
                    ${section('config — pages', [
                        ['dropdowns', 'After saving, all page dropdowns (categories, bookmarks, settings) update instantly — no reload needed.'],
                    ])}
                    ${section('dashboard — inline editor', [
                        ['page field', 'Change the page of a bookmark in the inline editor. The row animates out and the bookmark appears on the target page.'],
                        ['category reload', 'Switch page → category list immediately loads the categories of the target page. First category is auto-selected.'],
                        ['preview card', 'Hover card always stays within the viewport — flips automatically if it would go off-screen.'],
                    ])}
                    ${section('config — bookmarks side panel', [
                        ['page field', 'Choose a different page → categories for that page load immediately.'],
                        ['→ Move button', 'Confirm the move. Bookmark is saved to the chosen page and category.'],
                        ['delete button', 'Delete a bookmark directly from the detail panel. New bookmarks are removed without confirmation.'],
                        ['empty state', 'Panel is empty when nothing is selected — click outside a row to deselect.'],
                    ])}
                    ${section('dashboard — quick-add', [
                        ['<code>+</code>', 'Omnibox: type <code>name | url | shortcut</code> and press Enter. Favicon is fetched automatically.'],
                        ['+ / ! buttons', 'Two fixed buttons bottom-right: <code>+</code> opens the omnibox, <code>!</code> opens the cheatsheet.'],
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
