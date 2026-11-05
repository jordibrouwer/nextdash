/**
 * The small label on the bookmark under the cursor: "e m t p … · Esc to
 * search". It says the letters act on this row. aria-hidden: the key legend
 * carries the same words for a screen reader. Hidden on a narrow window by CSS.
 */
(function () {
    function remove() {
        document.querySelectorAll('.row-letter-hint').forEach((node) => node.remove());
    }

    /** Put the label on `row` (a bookmark row), or take it off when `row` is null. */
    function show(row) {
        remove();
        if (!row || !row.classList?.contains('bookmark-link')) return;
        const lang = window.dashboardInstance?.language;
        let words = 'to search';
        try {
            const value = lang?.t ? lang.t('dashboard.rowLetterHintWords') : null;
            if (value && value !== 'dashboard.rowLetterHintWords') words = value;
        } catch (_error) { /* English */ }
        const hint = document.createElement('span');
        hint.className = 'row-letter-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = `e m t p … · Esc ${words}`;
        row.appendChild(hint);
    }

    window.RowLetterHint = { show, hide: remove };
})();
