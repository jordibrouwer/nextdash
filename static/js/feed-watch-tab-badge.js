/**
 * News in the browser tab: a count in the title and a dot on the icon.
 *
 * For the reader who is in another tab. Always on, no setting: it costs nothing
 * and the tab is the one place that is visible from everywhere else.
 *
 * Other code rewrites the title (a page switch sets it from scratch), so the
 * prefix is kept by watching the <title> element rather than by setting it once.
 */
(function (global) {
    'use strict';

    const PREFIX = /^\(\d+\)\s+/;
    let count = 0;
    let observer = null;
    let originalIcon = null;
    let iconLink = null;

    function withPrefix(title) {
        const base = String(title || '').replace(PREFIX, '');
        return count > 0 ? `(${count}) ${base}` : base;
    }

    function applyTitle() {
        const wanted = withPrefix(document.title);
        if (document.title !== wanted) document.title = wanted;
    }

    function watchTitle() {
        if (observer || typeof MutationObserver !== 'function') return;
        const el = document.querySelector('head > title');
        if (!el) return;
        observer = new MutationObserver(() => applyTitle());
        observer.observe(el, { childList: true, characterData: true, subtree: true });
    }

    function findIcon() {
        if (iconLink && iconLink.isConnected) return iconLink;
        iconLink = document.querySelector('link[rel~="icon"]');
        return iconLink;
    }

    function restoreIcon() {
        const link = findIcon();
        if (link && originalIcon !== null) link.href = originalIcon;
    }

    function paintIcon() {
        const link = findIcon();
        if (!link) return;
        if (originalIcon === null) originalIcon = link.href;
        const img = new Image();
        img.onload = () => {
            // The count may have gone back to 0 while the icon loaded.
            if (count <= 0) return;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 32, 32);
                ctx.fillStyle = '#8b5cf6';
                ctx.beginPath();
                ctx.arc(24, 8, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
                link.href = canvas.toDataURL('image/png');
            } catch { /* a tainted canvas leaves the icon as it was */ }
        };
        img.src = originalIcon;
    }

    /** Set the number of unread news items; 0 removes the prefix and the dot. */
    function set(next) {
        const n = Math.max(0, Math.floor(Number(next) || 0));
        if (n === count) return;
        count = n;
        watchTitle();
        applyTitle();
        if (count > 0) paintIcon(); else restoreIcon();
    }

    global.FeedWatchTabBadge = { set, count: () => count };
})(window);
