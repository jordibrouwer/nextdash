/**
 * Icons for the context menus, drawn rather than typed.
 *
 * Every entry in those menus is a glyph in the theme's accent colour — ⧉, ✎,
 * →, ◉ — except Pin, which was 📌. An emoji is painted by the system font in
 * its own colours, so on any theme the menu had one red-and-yellow sticker in a
 * column of otherwise quiet marks, and it ignored the danger colour the way the
 * others follow it.
 *
 * `currentColor` throughout, so the drawing inherits whatever the row it sits
 * in is coloured — including the red of a destructive entry.
 */
(function () {
    'use strict';

    const PIN = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor"'
        + ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
        + '<path d="M5.6 1.6h4.8"/>'
        + '<path d="M6.8 1.6v4.1L4.3 8.4h7.4L9.2 5.7V1.6"/>'
        + '<path d="M8 8.4v6"/>'
        + '</svg>';

    /**
     * Put an icon into a menu row's icon slot.
     *
     * A drawn icon is markup, and the slot is filled with textContent
     * everywhere else — so the two are kept apart here rather than at each call
     * site, and only these constants are ever assigned as HTML.
     */
    function applyMenuIcon(slot, icon) {
        if (!slot) return;
        if (icon === 'pin') {
            slot.innerHTML = PIN;
            slot.classList.add('move-popover-check--drawn');
            return;
        }
        slot.textContent = icon == null ? '' : String(icon);
    }

    window.MenuIcons = { PIN, apply: applyMenuIcon };
})();
