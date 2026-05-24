/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v25';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function release(tag, date, sections) {
        const sectionsHtml = sections.map(({ title, items }) => `
            <div class="wn-section">
                <h4 class="wn-section-title">${title}</h4>
                <ul class="wn-list">
                    ${items.map(({ badge, text }) => `
                        <li class="wn-item">
                            <span class="wn-badge ${badge === 'new' ? 'wn-badge-new' : 'wn-badge-fix'}">${badge}</span>
                            <span class="wn-item-text">${text}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `).join('');
        return `
            <div class="wn-release">
                <div class="wn-release-header">
                    <span class="wn-release-tag">${tag}</span>
                    <span class="wn-release-date">${date}</span>
                </div>
                ${sectionsHtml}
            </div>
        `;
    }

    function buildHtml() {
        return `<div class="wn-content">` + [

            release('v2026.05', 'May 2026', [
                {
                    title: 'Onboarding & feature tour',
                    items: [
                        { badge: 'new', text: '<strong>Interactive feature tour</strong> — 8-step guided tour covering search, commands, finders, columns, smart collections and bookmark management. Launched via the spotlight notification after onboarding, or from Config → Advanced.' },
                        { badge: 'new', text: '<strong>Tour spotlight notification</strong> — appears once, 2 seconds after onboarding completes, inviting new users to start the tour. Dismissible; restart any time via Config → Advanced.' },
                        { badge: 'new', text: '<strong>Animated search flow hint</strong> — on first load the <code>&gt;</code> <code>:</code> <code>?</code> <code>!</code> hint above the footer buttons wipes in segment by segment with a spring pop on the accent characters, then auto-dismisses. Shown only once.' },
                    ]
                },
                {
                    title: 'Buttons & discoverability',
                    items: [
                        { badge: 'new', text: '<strong>Finders & Commands buttons on by default</strong> — new installations now show both buttons immediately, without needing to enable them in config.' },
                        { badge: 'fix', text: '<strong>Tips above buttons restored</strong> — the rotating tip element was missing from the HTML, preventing tips from ever rendering even when enabled in config.' },
                    ]
                },
                {
                    title: 'Translations (i18n)',
                    items: [
                        { badge: 'new', text: '<strong>Feature tour fully translated</strong> — all 8 step titles, body text, field labels, options and navigation buttons are translated into EN / NL / DE / FR with English as the fallback.' },
                        { badge: 'fix', text: '<strong>Hardcoded Dutch strings removed</strong> — undo button label, backup tip, tour spotlight and config tour section are now resolved from translation keys for all supported languages.' },
                    ]
                },
            ]),

            release('v2026.04', 'April 2026', [
                {
                    title: 'Dashboard buttons',
                    items: [
                        { badge: 'new', text: '<strong>Labels removed</strong> — footer buttons now show only their key symbol (<code>:</code> <code>?</code> <code>&gt;</code> <code>*</code> <code>!</code>). Hover to see the name as a tooltip.' },
                        { badge: 'new', text: '<strong>Button order</strong> — bar is now: <em>: commands</em> · <em>? finders</em> · <em>&gt; search</em> · <em>* recent</em> · <em>! cheatsheet</em>.' },
                        { badge: 'fix', text: '<strong>Config label toggle removed</strong> — the per-button "Label" column in config → Header & Buttons has been removed.' },
                    ]
                },
                {
                    title: 'Search',
                    items: [
                        { badge: 'new', text: '<strong>Mode badge</strong> — the search bar shows a coloured badge for the active input mode: SEARCH, CMD, FIND, or FUZZY.' },
                        { badge: 'new', text: '<strong>Filter group</strong> — autocomplete suggestions (<code>category:</code>, <code>status:</code>, <code>page:</code>, <code>tag:</code>) are grouped under a collapsible "Filters" header.' },
                        { badge: 'new', text: '<strong>Empty state</strong> — opening search with an empty query shows helpful groups (Recent, Filters, Finders) immediately.' },
                        { badge: 'new', text: '<strong>Search mode chips</strong> — the search overlay shows <em>&gt; search</em> · <em>: commands</em> · <em>? finders</em> chips. Click any chip to switch mode.' },
                    ]
                },
                {
                    title: 'Dashboard',
                    items: [
                        { badge: 'new', text: '<strong>Category collapse animation</strong> — categories fold and unfold with a smooth height transition and a rotating chevron.' },
                        { badge: 'new', text: '<strong>Smart collection accent</strong> — smart collection headers are tinted with the accent colour to stand out from regular categories.' },
                        { badge: 'new', text: '<strong>Focus indicators</strong> — keyboard focus rings are consistently styled across bookmarks, category headers, and search items.' },
                        { badge: 'new', text: '<strong>Compact bookmark rows</strong> — status, pin and note badges are inline chips; grid uses three columns so names are never truncated.' },
                        { badge: 'new', text: '<strong>Health badge</strong> — broken/warning count is now a superscript pill badge above the health link.' },
                    ]
                },
                {
                    title: 'Layout & appearance',
                    items: [
                        { badge: 'new', text: '<strong>Content area width</strong> — switched to <code>min(88%, 1600px)</code>, giving more grid space on laptop screens and capping neatly on ultra-wide monitors.' },
                        { badge: 'fix', text: '<strong>Mobile header</strong> — on small screens the header stays as a single horizontal row; date/time is hidden to free vertical space.' },
                        { badge: 'fix', text: '<strong>Scrollable modals</strong> — What\'s new and Keyboard cheatsheet modals now scroll correctly on small screens.' },
                        { badge: 'fix', text: '<strong>Tab bar spacing</strong> — config tab buttons reduce padding as the window narrows so all tabs stay visible without overlapping.' },
                    ]
                },
                {
                    title: 'Quick-add & bookmarks',
                    items: [
                        { badge: 'new', text: '<strong>Loading states</strong> — spinner on icon preview during favicon fetch; Save button shows a loading state while saving.' },
                        { badge: 'new', text: '<strong>Clear icon button</strong> — a × button next to the icon preview resets to the default favicon without closing the form.' },
                        { badge: 'new', text: '<strong>Last opened date/time</strong> — each bookmark row in config → bookmarks now shows the date and time it was last opened.' },
                        { badge: 'new', text: '<strong>Show icons on by default</strong> — bookmark icons are enabled by default for new installations.' },
                    ]
                },
            ]),

        ].join('') + `</div>`;
    }

    /**
     * @param {Object} [options]
     * @param {boolean} [options.force] - If true, always show (skip version gate and modal-open guard).
     * @param {function(): boolean} [options.ifBlockingModalOpen] - When not forcing: return true to abort.
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
            modalMaxWidth: '640px',
            modalWidth: '96vw',
            modalClass: 'whats-new-modal',
        });
        try {
            localStorage.setItem(STORAGE_KEY, DASHBOARD_RELEASE);
        } catch (error) {
            // Ignore localStorage failures.
        }
    };
})();
