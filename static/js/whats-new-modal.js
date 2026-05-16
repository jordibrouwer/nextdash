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
                    ${section('config — pagina\'s', [
                        ['dropdowns', 'Na opslaan worden alle pagina-dropdowns (categories, bookmarks, settings) direct bijgewerkt — geen herlaad nodig.'],
                    ])}
                    ${section('dashboard — inline editor', [
                        ['pagina-veld', 'Verander de pagina van een bookmark in de inline editor. De rij animeert weg en de bookmark verschijnt op de doelpagina.'],
                        ['category herlaad', 'Wissel van pagina → category-lijst laadt direct de categorieën van de doelpagina. Eerste categorie wordt automatisch geselecteerd.'],
                        ['preview card', 'Hover-kaart blijft altijd binnen de viewport — flipt automatisch als die buiten het scherm zou vallen.'],
                    ])}
                    ${section('config — bookmarks side panel', [
                        ['pagina-veld', 'Kies een andere pagina → categorieën van die pagina worden direct geladen.'],
                        ['→ Move knop', 'Bevestig de verplaatsing. Bookmark wordt opgeslagen in de gekozen pagina én categorie.'],
                        ['delete knop', 'Verwijder bookmark direct vanuit het detail-panel. Nieuwe bookmarks zonder bevestiging.'],
                        ['lege state', 'Panel is leeg als er niets geselecteerd is — klik buiten een rij om te deselecteren.'],
                    ])}
                    ${section('dashboard — quick-add', [
                        ['<code>+</code>', 'Omnibox: typ <code>naam | url | shortcut</code> en druk Enter. Favicon wordt automatisch opgehaald.'],
                        ['+ / ! knoppen', 'Twee vaste knoppen rechtsonder: <code>+</code> opent de omnibox, <code>!</code> opent de cheatsheet.'],
                    ])}
                    ${section('health &amp; stats', [
                        ['keep first', 'Elke duplicaatgroep heeft een knop die duplicaten in één klik oplost.'],
                        ['health badge', 'Health-link toont rood (broken) of geel (warnings) badge-getal.'],
                        ['conflicts', 'Stats-tab toont dubbele URLs en shortcut-conflicten met link naar Health.'],
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
