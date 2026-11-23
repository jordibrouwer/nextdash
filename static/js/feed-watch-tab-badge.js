/**
 * What needs the reader in the browser tab: a count in the title and a dot on
 * the icon. Two sources: news (purple dot, "(3)") and an outage of monitored
 * bookmarks (red dot with the number, "🔴 2"). An outage wins the icon, and
 * is also set on the installed app's icon through the Badging API.
 *
 * For the reader who is in another tab. Always on, no setting: it costs nothing
 * and the tab is the one place that is visible from everywhere else.
 *
 * Other code rewrites the title (a page switch sets it from scratch), so the
 * prefix is kept by watching the <title> element rather than by setting it once.
 */
(function (global) {
    'use strict';

    const PREFIX = /^(?:\u{1F534}\s\d+\s+)?(?:\(\d+\)\s+)?/u;
    let count = 0;
    // null until the first report: the app badge outlives the page, so a first
    // report of 0 must still clear whatever an earlier page left on the icon.
    let outage = null;
    let observer = null;
    let originalIcon = null;
    let iconLink = null;

    function withPrefix(title) {
        const base = String(title || '').replace(PREFIX, '');
        const parts = [];
        if (outage > 0) parts.push(`\u{1F534} ${outage}`);
        if (count > 0) parts.push(`(${count})`);
        return parts.length ? `${parts.join(' ')} ${base}` : base;
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
            // The counts may have gone back to 0 while the icon loaded.
            if (count <= 0 && outage <= 0) return;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 32, 32);
                const down = outage > 0;
                const r = down ? 11 : 8;
                const cx = 32 - r;
                const cy = r;
                ctx.fillStyle = down ? '#dc2626' : '#8b5cf6';
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
                if (down) {
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 15px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(outage > 9 ? '9+' : String(outage), cx, cy + 1);
                }
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
        refresh();
    }

    /** Set the number of monitored bookmarks that are down; 0 clears it. */
    function setOutage(next) {
        const n = Math.max(0, Math.floor(Number(next) || 0));
        if (n === outage) return;
        outage = n;
        try {
            if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {});
            else navigator.clearAppBadge?.()?.catch?.(() => {});
        } catch { /* no Badging API, or not an installed app */ }
        refresh();
    }

    function refresh() {
        watchTitle();
        applyTitle();
        if (count > 0 || outage > 0) paintIcon(); else restoreIcon();
    }

    global.FeedWatchTabBadge = { set, setOutage, count: () => count, outage: () => outage || 0 };
})(window);
