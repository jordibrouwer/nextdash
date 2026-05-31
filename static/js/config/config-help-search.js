/**
 * Config → Help: type-to-filter sections (same pattern as dashboard cheat sheet).
 */
(function () {
    'use strict';

    function t(language, key, fallback) {
        if (!language?.t) return fallback;
        const fullKey = `config.${key}`;
        const value = language.t(fullKey);
        return value !== fullKey ? value : fallback;
    }

    function applyFilter(filterInput, emptyEl) {
        const q = (filterInput?.value || '').toLowerCase().trim();
        const blocks = document.querySelectorAll('.help-content .help-block');
        const navItems = document.querySelectorAll('.help-index ul li');
        let visibleCount = 0;

        blocks.forEach((block) => {
            const match = !q || block.textContent.toLowerCase().includes(q);
            block.hidden = !match;
            if (match) visibleCount += 1;
        });

        navItems.forEach((li) => {
            const href = li.querySelector('a')?.getAttribute('href') || '';
            const targetId = href.startsWith('#') ? href.slice(1) : '';
            const block = targetId ? document.getElementById(targetId) : null;
            li.hidden = Boolean(q && block?.hidden);
        });

        if (emptyEl) {
            emptyEl.hidden = !q || visibleCount > 0;
        }
    }

    window.ConfigHelpSearch = {
        init(language) {
            const filterInput = document.getElementById('help-search-filter');
            const emptyEl = document.getElementById('help-search-empty');
            if (!filterInput) return;

            const placeholder = t(language, 'helpFilterPlaceholder', 'Filter help sections…');
            filterInput.placeholder = placeholder;
            filterInput.setAttribute('aria-label', placeholder);

            if (emptyEl) {
                emptyEl.textContent = t(language, 'helpFilterNoResults', 'No sections match your search.');
            }

            filterInput.addEventListener('input', () => applyFilter(filterInput, emptyEl));

            filterInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    filterInput.value = '';
                    applyFilter(filterInput, emptyEl);
                    filterInput.blur();
                }
            });
        },
    };
})();
