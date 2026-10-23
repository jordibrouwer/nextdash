/**
 * The weekly digest on the dashboard: a short card, and the digest itself in a
 * window.
 *
 * The server builds and pushes it (internal/app/digest.go); this only shows the
 * stored snapshot to someone who is looking at the dashboard. The card used to
 * carry the whole digest as a row of counts -- "3 newly broken · 2
 * certificates expiring · 16 bookmarks unused" -- which said how much without
 * saying what, or where to go about it. So the card now says the one or two
 * things that matter most, and "Read the digest" opens a window with a part per
 * subject: what it means, the names behind the count, and a button to the view
 * where it is dealt with. A click on the push lands on the same window
 * (/#digest), and so does the button in Config.
 */
(function initDigestNotice(global) {
    'use strict';

    const SEEN_KEY = 'nextdashDigestSeenAt';
    const SHOW_DELAY_MS = 6000;
    const OPEN_HASH = '#digest';
    const DAY_MS = 24 * 60 * 60 * 1000;
    // Which parts of the current digest were opened, and whether the bar was
    // closed. Per browser, like the seen mark, and keyed by the snapshot so a
    // new digest starts over.
    const PROGRESS_KEY = 'nextdashDigestProgress';
    let latest = null;
    let barEl = null;

    function dash() { return global.dashboardInstance || null; }

    function t(key, fallback, vars) {
        const language = dash()?.language;
        let text = fallback;
        if (language && typeof language.t === 'function') {
            const value = language.t(key);
            if (value && value !== key) text = value;
        }
        if (!vars) return text;
        return Object.entries(vars).reduce(
            (acc, [name, value]) => acc.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
            text
        );
    }

    function esc(value) {
        return global.NextDashHtml?.escapeHtml
            ? global.NextDashHtml.escapeHtml(String(value))
            : String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    }

    function seenAt() {
        try { return Number(global.localStorage?.getItem(SEEN_KEY)) || 0; } catch (_) { return 0; }
    }
    function markSeen() {
        try { if (latest) global.localStorage?.setItem(SEEN_KEY, String(latest.generatedAt)); } catch (_) { /* private mode */ }
    }

    function shouldShow(snapshot, seen) {
        return Boolean(snapshot && snapshot.generatedAt > seen);
    }

    async function fetchLatest() {
        try {
            const res = await fetch('/api/digest/latest', { cache: 'no-store' });
            if (res.status !== 200) return null;
            latest = await res.json();
            return latest;
        } catch (_) {
            return null;
        }
    }

    /** "1 link" or "3 links", through the locale. */
    function count(n, key, one, many) {
        return n === 1 ? t(`${key}One`, one, { count: n }) : t(key, many, { count: n });
    }

    /**
     * What the card says: the most pressing one or two things, in the order the
     * push title picks its lead (digestNotice), so the two never disagree.
     */
    function leadParts(s) {
        const h = s.health || {}, u = s.updates || {}, g = s.usage || {};
        const parts = [];
        if (h.newlyBroken?.length) parts.push(count(h.newlyBroken.length, 'dashboard.digestLeadBroken', '1 link broke this week', '{count} links broke this week'));
        if (h.certsExpiring?.length) parts.push(count(h.certsExpiring.length, 'dashboard.digestLeadCerts', '1 certificate runs out soon', '{count} certificates run out soon'));
        if (h.domainsExpiring?.length) parts.push(count(h.domainsExpiring.length, 'dashboard.digestLeadDomains', '1 domain runs out soon', '{count} domains run out soon'));
        if (u.available?.length) parts.push(count(u.available.length, 'dashboard.digestLeadUpdates', '1 container update', '{count} container updates'));
        if (h.stillBroken) parts.push(count(h.stillBroken, 'dashboard.digestLeadStillBroken', '1 link still broken', '{count} links still broken'));
        if (g.neverOpened) parts.push(count(g.neverOpened, 'dashboard.digestLeadNever', '1 bookmark never opened', '{count} bookmarks never opened'));
        if (g.stale) parts.push(count(g.stale, 'dashboard.digestLeadStale', '1 bookmark not opened in {days} days', '{count} bookmarks not opened in {days} days').replace('{days}', String(g.staleDays || 90)));
        if (g.inbox) parts.push(count(g.inbox, 'dashboard.digestLeadInbox', '1 link in the Inbox', '{count} links in the Inbox'));
        if (s.news?.releases?.length) parts.push(t('dashboard.digestLeadNews', 'nextDash {releases} is out', { releases: s.news.releases.join(', ') }));
        return parts;
    }

    function cardBody(s) {
        const parts = leadParts(s).slice(0, 2);
        if (!parts.length) return '';
        const text = parts.join(', ');
        // The name keeps its own spelling at the start of a sentence.
        if (text.startsWith('nextDash')) return `${text}.`;
        return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
    }

    function readProgress(s) {
        try {
            const p = JSON.parse(global.localStorage?.getItem(PROGRESS_KEY) || 'null');
            if (p && s && p.generatedAt === s.generatedAt) {
                return { generatedAt: p.generatedAt, visited: Array.isArray(p.visited) ? p.visited : [], closed: Boolean(p.closed) };
            }
        } catch (_) { /* private mode, or a value from elsewhere */ }
        return { generatedAt: s?.generatedAt || 0, visited: [], closed: false };
    }
    function writeProgress(p) {
        try { global.localStorage?.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (_) { /* private mode */ }
    }

    /** The views a part opens, each the same way the rest of the app opens it. */
    async function go(target) {
        const d = dash();
        if (!d) return;
        if (target === 'inbox') {
            await d.inbox?.openInboxView?.();
            return;
        }
        if (target === 'updates') {
            await d.docker?.openDockerView?.({ filter: 'updates' });
            return;
        }
        if (target === 'whats-new') {
            await global.openWhatsNewModal?.({ force: true });
            return;
        }
        history.replaceState(history.state, '', `${global.location.pathname}${global.location.search}#bookmarks?health=${encodeURIComponent(target)}`);
        await d.config?.openLibraryView?.();
    }

    function chips(names, total) {
        if (!names?.length) return '';
        const rest = Math.max(0, (total || names.length) - names.length);
        const more = rest ? `<span class="digest-chip digest-chip--more">${esc(t('dashboard.digestMore', 'and {count} more', { count: rest }))}</span>` : '';
        return `<div class="digest-chips">${names.map((n) => `<span class="digest-chip">${esc(n)}</span>`).join('')}${more}</div>`;
    }

    function partHtml({ id, icon, title, note, names, total, action, target, work }, state) {
        const done = state.visited.includes(id);
        const next = !done && state.next === id;
        let button = '';
        if (action) {
            const label = done ? t('dashboard.digestOpenAgain', 'Open again') : action;
            const workButton = work
                ? `<button type="button" class="digest-part-go" data-digest-work="${esc(target)}" data-digest-part-id="${esc(id)}">${esc(work)}</button>`
                : '';
            button = `<span class="digest-part-actions">${workButton}<button type="button" class="digest-part-go${next ? ' is-next' : ''}" data-digest-go="${esc(target)}" data-digest-part-id="${esc(id)}">${esc(label)}${done ? '' : ' <span aria-hidden="true">→</span>'}</button></span>`;
        }
        return `
            <section class="digest-part${done ? ' is-done' : ''}" data-digest-part="${esc(id)}">
                <div class="digest-part-head">
                    <h3 class="digest-part-title"><span class="digest-part-icon" aria-hidden="true">${done ? '✓' : icon}</span>${esc(title)}</h3>
                    ${button}
                </div>
                <p class="digest-part-note">${esc(note)}</p>
                ${chips(names, total)}
            </section>`;
    }

    /** The parts, in order; the ones with a view to open are the to-do list. */
    function partList(s) {
        const h = s.health || {}, u = s.updates || {}, g = s.usage || {};
        const out = [];
        const newly = h.newlyBroken || [];
        if (newly.length || h.stillBroken) {
            let note;
            if (newly.length && h.stillBroken) {
                note = t('dashboard.digestBrokenNoteBoth', 'These stopped answering this week. {count} more have been broken for longer.', { count: h.stillBroken });
            } else if (newly.length) {
                note = t('dashboard.digestBrokenNoteNew', 'These stopped answering this week.');
            } else {
                note = t('dashboard.digestBrokenNoteOld', 'Nothing new broke this week. These have been broken for longer.');
            }
            out.push({
                id: 'broken', icon: '⛓', title: t('dashboard.digestBrokenTitle', 'Broken links'), note,
                names: newly.length ? newly : h.stillBrokenNames, total: newly.length ? newly.length : h.stillBroken,
                action: t('dashboard.digestOpenBookmarks', 'Open in Bookmarks'), target: 'broken',
                // The Bookmarks view's Work through, on the broken ones only.
                work: t('dashboard.digestWorkThrough', 'Work through'),
            });
        }
        if (h.certsExpiring?.length) {
            out.push({
                id: 'certificates', icon: '🔒', title: t('dashboard.digestCertsTitle', 'Certificates'),
                note: t('dashboard.digestCertsNote', 'When a certificate runs out, the browser shows a warning instead of the site.'),
                names: h.certsExpiring, action: t('dashboard.digestOpenBookmarks', 'Open in Bookmarks'), target: 'certificates',
            });
        }
        if (h.domainsExpiring?.length) {
            out.push({
                id: 'domains', icon: '🌐', title: t('dashboard.digestDomainsTitle', 'Domains'),
                note: t('dashboard.digestDomainsNote', 'When a domain runs out, the site, its certificate and its mail go with it.'),
                names: h.domainsExpiring, action: t('dashboard.digestOpenBookmarks', 'Open in Bookmarks'), target: 'domains',
            });
        }
        if (u.available?.length) {
            out.push({
                id: 'updates', icon: '⬆', title: t('dashboard.digestUpdatesTitle', 'Container updates'),
                note: t('dashboard.digestUpdatesNote', 'A newer image is available for these. Containers you hold back are left out.'),
                names: u.available, action: t('dashboard.digestOpenContainers', 'Open Containers'), target: 'updates',
            });
        }
        if (g.topOpened?.length) {
            out.push({
                id: 'top', icon: '★', title: t('dashboard.digestTopTitle', 'Most opened'),
                note: t('dashboard.digestTopNote', 'What you opened most in the last 7 days.'),
                names: g.topOpened,
            });
        }
        // The Bookmarks view's own two filters, so the count is the list the
        // button opens: Unused is never opened, Stale is not opened for the
        // days set under "count as neglected after".
        if (g.neverOpened) {
            out.push({
                id: 'never', icon: '○', title: t('dashboard.digestNeverTitle', 'Never opened'),
                note: count(g.neverOpened, 'dashboard.digestNeverNote', '1 bookmark nobody has opened yet.', '{count} bookmarks nobody has opened yet.'),
                names: g.neverOpenedNames, total: g.neverOpened,
                action: t('dashboard.digestReview', 'Review'), target: 'unused',
            });
        }
        if (g.stale) {
            const days = String(g.staleDays || 90);
            out.push({
                id: 'stale', icon: '💤', title: t('dashboard.digestStaleTitle', 'Not opened in {days} days').replace('{days}', days),
                note: count(g.stale, 'dashboard.digestStaleNote', '1 bookmark. A candidate to move, archive or delete.', '{count} bookmarks. Candidates to move, archive or delete.'),
                names: g.staleNames, total: g.stale,
                action: t('dashboard.digestReview', 'Review'), target: 'stale',
            });
        }
        if (g.inbox) {
            out.push({
                id: 'inbox', icon: '📥', title: t('dashboard.digestInboxTitle', 'Inbox'),
                note: count(g.inbox, 'dashboard.digestInboxNote', '1 link waiting to be sorted.', '{count} links waiting to be sorted.'),
                action: t('dashboard.digestOpenInbox', 'Open Inbox'), target: 'inbox',
            });
        }
        // nextDash's own releases of the week, last: news, not something to do.
        const news = s.news || {};
        if (news.releases?.length) {
            out.push({
                id: 'news', icon: '✦', title: t('dashboard.digestNewsTitle', 'New in nextDash'),
                note: t('dashboard.digestNewsNote', '{releases} came out this week.', { releases: news.releases.join(', ') }),
                names: news.highlights,
                action: t('dashboard.digestOpenWhatsNew', "Open What's new"), target: 'whats-new', info: true,
            });
        }
        return out;
    }

    // News carries a button but is not something to work through.
    function todo(s) { return partList(s).filter((p) => p.action && !p.info); }

    function nextPart(s, progress) {
        return todo(s).find((p) => !progress.visited.includes(p.id)) || null;
    }

    function when(s) {
        const at = new Date(Number(s.generatedAt) || Date.now());
        const settings = dash()?.settings || {};
        try {
            return at.toLocaleString(settings.language || undefined, {
                weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                // The clock's own setting, not the locale's habit.
                hour12: settings.timeFormat === '12h',
            });
        } catch (_) {
            return at.toLocaleString();
        }
    }

    /** The digest in a window. Resolves false when there is none to show. */
    async function openDigest() {
        const s = latest || await fetchLatest();
        if (!s || !global.AppModal?.show) return false;
        markSeen();
        card.close();
        removeBar();
        const progress = readProgress(s);
        const state = { visited: progress.visited, next: nextPart(s, progress)?.id };
        const html = `
            <div class="digest-window">
                <p class="digest-window-when">${esc(when(s))}</p>
                <p class="digest-window-intro">${esc(t('dashboard.digestIntro', 'What changed in the last 7 days. Each part opens where you can deal with it.'))}</p>
                ${partList(s).map((p) => partHtml(p, state)).join('')}
            </div>`;
        global.AppModal.show({
            title: t('dashboard.digestWindowTitle', 'Weekly digest'),
            htmlMessage: html,
            confirmText: t('dashboard.digestDone', 'Done'),
            showCancel: false,
            modalClass: 'digest-modal',
            modalMaxWidth: 'min(36rem, calc(100vw - 2.5rem))',
            // Closed halfway through: back to the bar, so the rest is not lost.
            onHide: () => {
                if (readProgress(s).visited.length) showBar(s);
            },
        });
        document.querySelectorAll('.digest-modal [data-digest-go]').forEach((btn) => {
            btn.addEventListener('click', () => {
                global.AppModal.hide?.();
                // News opens What's new and leaves the to-do list as it was.
                if (btn.getAttribute('data-digest-go') === 'whats-new') {
                    void go('whats-new');
                    return;
                }
                void visit(s, btn.getAttribute('data-digest-part-id'), btn.getAttribute('data-digest-go'));
            });
        });
        document.querySelectorAll('.digest-modal [data-digest-work]').forEach((btn) => {
            btn.addEventListener('click', () => {
                global.AppModal.hide?.();
                void visit(s, btn.getAttribute('data-digest-part-id'), btn.getAttribute('data-digest-work'), { work: true });
            });
        });
        return true;
    }

    /**
     * Open one part's view, and shrink the digest to the bar so the next part
     * is one click away once this one is dealt with.
     */
    async function visit(s, id, target, { work = false } = {}) {
        const progress = readProgress(s);
        if (!progress.visited.includes(id)) progress.visited.push(id);
        writeProgress(progress);
        await go(target);
        if (work) {
            // The view's own Work through (f), not the review card's session:
            // that one queues from the whole report, this one walks the list
            // as it is filtered -- here, the broken links.
            const config = dash()?.config?.instance || dash()?.config;
            await config?.refreshBmHealth?.();
            config?.startLibraryWorkThrough?.();
        }
        showBar(s);
    }

    function removeBar() {
        barEl?.remove();
        barEl = null;
    }

    /**
     * The minimised digest: how far along, the next part, and a way back to
     * the window. Not a NoticeCard -- cards show on the dashboard only, and the
     * bar has to stay while the reader is in the view a part opened -- but it
     * stands in the same corner, so it holds it (data-holds-corner) and the
     * cards wait. Gone once every part was opened, or when closed.
     */
    function showBar(s) {
        removeBar();
        const progress = readProgress(s);
        const list = todo(s);
        const done = list.filter((p) => progress.visited.includes(p.id)).length;
        if (progress.closed || !list.length || done >= list.length) return;
        const next = nextPart(s, progress);
        const el = document.createElement('div');
        el.className = 'digest-bar';
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', t('dashboard.digestWindowTitle', 'Weekly digest'));
        el.setAttribute('data-holds-corner', '');
        const pct = Math.round((done / list.length) * 100);
        el.innerHTML = `
            <button type="button" class="digest-bar-open" data-digest-bar="open">
                <span class="digest-bar-label">${esc(t('dashboard.digestBarProgress', 'Weekly digest · {done} of {total} done', { done, total: list.length }))}</span>
                <span class="digest-bar-meter" aria-hidden="true"><span style="width:${pct}%"></span></span>
            </button>
            ${next ? `<button type="button" class="digest-bar-next" data-digest-bar="next">${esc(t('dashboard.digestBarNext', 'Next: {part}', { part: next.title }))}</button>` : ''}
            <button type="button" class="digest-bar-close" data-digest-bar="close" aria-label="${esc(t('dashboard.digestBarClose', 'Close the digest'))}">×</button>`;
        el.querySelector('[data-digest-bar="open"]').addEventListener('click', () => { void openDigest(); });
        el.querySelector('[data-digest-bar="next"]')?.addEventListener('click', () => { void visit(s, next.id, next.target); });
        el.querySelector('[data-digest-bar="close"]').addEventListener('click', () => {
            const p = readProgress(s);
            p.closed = true;
            writeProgress(p);
            removeBar();
        });
        document.body.appendChild(el);
        barEl = el;
    }

    /**
     * Whether the digest has the week: its bar is up, it has not been seen,
     * or it came out less than a day ago. The review card asks this first --
     * both offer the same broken and unopened links, and the digest is the
     * once-a-week one, so on its day it goes first and the daily card waits.
     */
    async function holdsTheWeek() {
        if (barEl) return true;
        if (dash()?.settings?.digestEnabled === false) return false;
        const s = latest || await fetchLatest();
        if (!s) return false;
        if (s.generatedAt > seenAt()) return true;
        return Date.now() - Number(s.generatedAt) < DAY_MS;
    }

    /** A bar left standing before a reload comes back with the page. */
    async function restoreBar() {
        try {
            const p = JSON.parse(global.localStorage?.getItem(PROGRESS_KEY) || 'null');
            if (!p || p.closed || !p.visited?.length) return;
        } catch (_) { return; }
        // After the dashboard has drawn and opened whatever view the address
        // names: a Next pressed before that was undone by the view opening
        // late and writing its own hash back.
        for (let i = 0; i < 75 && !dash()?._bookmarksReady; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const s = await fetchLatest();
        if (s && global.location.hash !== OPEN_HASH) showBar(s);
    }

    const card = global.NoticeCard.define({
        id: 'digest-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.digestTitle', 'Your week in nextDash'),
        body: () => (latest ? cardBody(latest) : ''),
        dismissLabel: () => t('dashboard.digestDismiss', 'Got it'),
        dismissName: 'seen',
        canShow: async () => {
            if (dash()?.settings?.digestEnabled === false) return false;
            return shouldShow(await fetchLatest(), seenAt());
        },
        onDismiss: markSeen,
        actionAttr: 'data-digest-action',
        actions: [
            {
                name: 'read',
                label: () => t('dashboard.digestRead', 'Read the digest'),
                primary: true,
                onClick: () => { void openDigest(); },
            },
            {
                name: 'seen',
                label: () => t('dashboard.digestDismiss', 'Got it'),
                onClick: (handle) => { markSeen(); handle.close(); },
            },
        ],
    });

    /**
     * /#digest is where the push lands. Waits for the dashboard to be there,
     * opens the window, and takes the hash back off so a reload does not open
     * it again.
     */
    function openFromHash() {
        if (global.location.hash !== OPEN_HASH) return;
        history.replaceState(history.state, '', `${global.location.pathname}${global.location.search}`);
        let tries = 0;
        const tick = () => {
            if (dash()?.settings && global.AppModal?.show) {
                void openDigest();
                return;
            }
            if (++tries < 50) setTimeout(tick, 200);
        };
        tick();
    }

    function start() {
        openFromHash();
        // A push clicked while the dashboard is already open changes only the
        // hash; the page does not load again.
        global.addEventListener('hashchange', openFromHash);
        void restoreBar();
        card.autoStart();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }

    global.DigestNotice = { shouldShow, openDigest, holdsTheWeek, render: card.render, close: card.close, showBar: () => latest && showBar(latest) };
})(window);
