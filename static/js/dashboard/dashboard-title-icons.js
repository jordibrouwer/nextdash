/**
 * Icons in a title.
 *
 * A category used to have an icon field: a glyph or an uploaded image drawn in
 * front of its name. The icon is part of the title now. An emoji typed in the
 * name is already text; an app icon is written :file.svg: -- the name of a file
 * in data/icons/, which the app-icon picker puts there -- and drawn as the
 * image it names. Categories and widgets are titled the same way.
 *
 * Only the words are lower-cased, like every block title: a file name keeps its
 * case, or the image would not be found.
 */
(function (global) {
    'use strict';

    const TOKEN = /:([A-Za-z0-9][A-Za-z0-9._-]*\.(?:svg|png|webp|jpe?g|gif|ico)):/g;

    /** The title as text and icons, in order. Text is lower-cased, icon names are not. */
    function segments(text) {
        const source = String(text ?? '');
        const out = [];
        let last = 0;
        for (const match of source.matchAll(TOKEN)) {
            if (match.index > last) out.push({ text: source.slice(last, match.index).toLowerCase() });
            out.push({ icon: match[1] });
            last = match.index + match[0].length;
        }
        if (last < source.length) out.push({ text: source.slice(last).toLowerCase() });
        return out;
    }

    /** The title with its icon tokens taken out, for a place that shows plain text. */
    function plain(text) {
        return String(text ?? '').replace(TOKEN, '').replace(/\s{2,}/g, ' ').trim();
    }

    /**
     * Writes a title into el. The raw name is kept in data-raw-name, so a
     * renderer that patches a title compares against the name and not against
     * what the page shows.
     */
    function set(el, text, dash) {
        const raw = String(text ?? '');
        el.dataset.rawName = raw;
        el.textContent = '';
        let hasIcon = false;
        for (const part of segments(raw)) {
            if (part.icon) {
                hasIcon = true;
                const img = document.createElement('img');
                img.src = `/data/icons/${encodeURIComponent(part.icon)}`;
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.draggable = false;
                img.className = 'bookmark-icon category-title-inline-icon';
                el.appendChild(img);
            } else if (part.text) {
                el.appendChild(document.createTextNode(part.text));
            }
        }
        if (hasIcon && dash?.settings && global.ThemeIconStyling) {
            global.ThemeIconStyling.applyThemeIconStylingToElement(
                el,
                global.ThemeIconStyling.getThemeIconStylingEntry(dash.settings),
            );
        }
        return el;
    }

    global.DashboardTitleIcons = { segments, plain, set, TOKEN };
})(window);
