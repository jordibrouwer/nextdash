/**
 * The links in something dragged in from another window, without a browser.
 *
 * A link, a tab or selected text dragged out of another browser window carries
 * its address in a few formats that differ per browser: text/uri-list (all of
 * them), text/x-moz-url (Firefox, address and title on alternate lines),
 * text/html (an anchor, with the link text) and text/plain. This reads them in
 * that order and answers [{ url, title }].
 *
 * Pure, so it is tested in node (tests/link-drop-model.test.cjs); the module
 * that listens for the drop is dashboard-link-drop.js.
 */
(function (global) {
    'use strict';

    const MAX_LINKS = 50;

    /** An address a person would call a link: http(s), or a bare host.tld[/path] of one word. */
    function asUrl(raw, { bare = false } = {}) {
        const text = String(raw || '').trim();
        if (!text || /\s/.test(text)) return '';
        if (/^https?:\/\/[^/\s]+/i.test(text)) return text;
        if (bare && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(text) && /\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(text)) {
            return `https://${text}`;
        }
        return '';
    }

    function lines(text) {
        return String(text || '').split(/\r?\n/).map((l) => l.trim());
    }

    const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

    /** The characters a few entities stand for; anything else is left as written. */
    function decodeEntities(text) {
        return String(text).replace(/&(?:#(\d{1,6})|#x([0-9a-f]{1,5})|(\w+));/gi, (all, dec, hex, name) => {
            if (name) return NAMED[name.toLowerCase()] ?? all;
            const code = dec ? Number(dec) : parseInt(hex, 16);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
        });
    }

    /** The text of the anchor that points at `url`, from a dragged fragment of HTML. */
    function titleFromHtml(html, url) {
        const source = String(html || '');
        if (!source || !url) return '';
        const anchor = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = anchor.exec(source))) {
            const href = decodeEntities(match[1] ?? match[2] ?? '');
            if (href !== url) continue;
            return decodeEntities(match[3].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
        }
        return '';
    }

    /**
     * transfer: { getData(type) } -- a DataTransfer, or anything shaped like one.
     * Dedupes by address and stops at MAX_LINKS.
     */
    function linksFromTransfer(transfer) {
        const read = (type) => {
            try { return String(transfer?.getData?.(type) || ''); } catch { return ''; }
        };
        const found = [];
        const seen = new Set();
        const add = (url, title) => {
            if (!url || seen.has(url) || found.length >= MAX_LINKS) return;
            seen.add(url);
            found.push({ url, title: String(title || '').trim() });
        };

        const html = read('text/html');
        for (const line of lines(read('text/uri-list'))) {
            if (found.length >= MAX_LINKS) break;
            if (!line || line.startsWith('#')) continue;
            const url = asUrl(line);
            // Only a link that will be kept is looked up in the HTML.
            if (url && !seen.has(url)) add(url, titleFromHtml(html, url));
        }
        if (!found.length) {
            // Address, then title, line pairs.
            const mozilla = lines(read('text/x-moz-url'));
            for (let i = 0; i < mozilla.length; i += 2) {
                const url = asUrl(mozilla[i]);
                add(url, mozilla[i + 1]);
            }
        }
        if (!found.length) {
            const plain = lines(read('text/plain'));
            // A bare host is taken only when it is the whole drop: a sentence
            // that happens to contain "e.g." is not a link.
            const bare = plain.filter(Boolean).length === 1;
            for (const line of plain) {
                if (found.length >= MAX_LINKS) break;
                const url = asUrl(line, { bare });
                if (url && !seen.has(url)) add(url, titleFromHtml(html, url));
            }
        }
        return found;
    }

    /** Whether the formats on offer could hold a link; types is all a dragover is allowed to see. */
    function mayCarryLink(types) {
        const list = Array.from(types || []);
        if (list.includes('Files')) return false;
        return list.includes('text/uri-list') || list.includes('text/x-moz-url') || list.includes('text/plain');
    }

    global.LinkDropModel = { linksFromTransfer, mayCarryLink, titleFromHtml };
})(typeof window !== 'undefined' ? window : globalThis);
