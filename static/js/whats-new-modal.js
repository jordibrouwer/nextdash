/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v10';
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
                    ${section('dashboard — quick-add', [
                        ['<code>+</code>', 'Omnibox: typ <code>naam | url | shortcut</code> en druk Enter. Favicon wordt automatisch opgehaald.'],
                        ['+ / ! knoppen', 'Twee vaste knoppen rechtsonder: <code>+</code> opent de omnibox, <code>!</code> opent de cheatsheet.'],
                    ])}
                    ${section('dashboard — navigatie', [
                        ['<code>,</code>', 'Pagina-overzicht: alle pagina\'s met bookmark-aantallen — navigeer met ↑↓ of 1–9.'],
                        ['preview card', 'Hover-kaart toont nu ook volledige URL, open-count en laatste open-datum.'],
                        ['tabblad-titel', 'Browser-tab toont de actieve paginanaam, bijv. <em>Work — nextDash</em>.'],
                    ])}
                    ${section('config — bookmarks', [
                        ['delete knop', 'Verwijder bookmark direct vanuit het detail-panel. Nieuwe bookmarks worden zonder bevestiging verwijderd.'],
                        ['lege state', 'Side panel is leeg als er niets geselecteerd is — klik buiten een rij om te deselecteren.'],
                    ])}
                    ${section('config — stats &amp; health', [
                        ['conflicts', 'Toont dubbele URLs en conflicterende shortcuts, met directe link naar Health.'],
                        ['categorie-breakdown', 'Welke categorieën de meeste opens hebben.'],
                        ['health badge', 'Health-link toont rood (broken) of geel (warnings) badge-getal.'],
                        ['filter bewaard', 'Filter, sortering en zoekterm in Health blijven bewaard bij refresh.'],
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
