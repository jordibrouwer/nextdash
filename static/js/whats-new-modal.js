/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v8';
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
                    ${section('dashboard — bookmarks', [
                        ['bookmark flash', 'Subtiele ripple-animatie als je een bookmark opent — bevestiging dat de actie geregistreerd is.'],
                        ['preview card', 'Hover-card toont nu ook de volledige URL, open-count en laatste open-datum.'],
                        ['page overview', '<code>,</code> opent een overlay met alle pagina\'s en hun bookmark-aantallen — navigeer met ↑↓ of 1–9.'],
                    ])}
                    ${section('dashboard — cheatsheet', [
                        ['? knop', 'Permanente knop rechtsonder opent de keyboard shortcut cheatsheet (optioneel in te schakelen via config).'],
                        ['terminal-stijl', 'Cheatsheet is herontworpen: compacter, thema-kleurig, makkelijker te scannen.'],
                    ])}
                    ${section('config — bookmarks', [
                        ['delete knop', 'Verwijdert het geselecteerde bookmark direct vanuit het side panel. Nieuwe (nog niet opgeslagen) bookmarks worden zonder bevestiging verwijderd.'],
                        ['lege state', 'Side panel toont een lege state als er geen bookmark geselecteerd is — klik buiten een rij om te deselecteren.'],
                    ])}
                    ${section('config — stats', [
                        ['conflicts', 'Nieuw blok: toont dubbele URLs en conflicterende shortcuts, met een directe link naar Health.'],
                        ['categories', 'Breakdown per categorie: welke categorieën de meeste opens hebben.'],
                    ])}
                    ${section('health', [
                        ['filter &amp; sort', 'Actief filter, sortering en zoekterm blijven bewaard bij een page refresh (sessionStorage).'],
                        ['badge', 'Health-link op het dashboard toont een rood (broken) of geel (warnings) badge-getal.'],
                    ])}
                    ${section('colors — themapreview', [
                        ['live preview', 'Naast de kleurpickers staat een mini-kaart die direct meeverandert als je kleuren aanpast.'],
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
