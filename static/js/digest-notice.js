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

    function chips(names, total, extra = '') {
        if (!names?.length && !extra) return '';
        const list = names || [];
        const rest = Math.max(0, (total || list.length) - list.length);
        const more = rest ? `<span class="digest-chip digest-chip--more">${esc(t('dashboard.digestMore', 'and {count} more', { count: rest }))}</span>` : '';
        const tail = extra ? `<span class="digest-chip digest-chip--more">${esc(extra)}</span>` : '';
        return `<div class="digest-chips">${list.map((n) => `<span class="digest-chip">${esc(n)}</span>`).join('')}${more}${tail}</div>`;
    }

    /**
     * The server sends certificates and domains as "host (N days)" lines. Read
     * back into a name and a number, nearest first, so they can be drawn as
     * days left; a line that does not read that way is left out of the bars.
     */
    function expiries(lines) {
        return (lines || []).map((line) => {
            const m = /^(.+) \((-?\d+) days?\)$/.exec(String(line));
            return m ? { name: m[1], days: Number(m[2]) } : null;
        }).filter(Boolean).sort((a, b) => a.days - b.days);
    }

    /**
     * Days left as bars. The scale is the stretch that matters for the kind:
     * a month for a certificate, a year for a domain. Gone already is a full
     * bar in the danger colour, so it reads as the worst of the list.
     */
    function bars(items, { scale, warnBelow }) {
        if (!items.length) return '';
        const rows = items.map((it, i) => {
            const tone = it.days <= 7 ? 'bad' : (it.days <= warnBelow ? 'warn' : 'ok');
            const width = it.days <= 0 ? 100 : Math.max(3, Math.min(100, Math.round((it.days / scale) * 100)));
            const value = it.days < 0
                ? t('dashboard.digestExpiredAgo', 'expired {days} d', { days: -it.days })
                : t('dashboard.digestDaysLeft', '{days} d', { days: it.days });
            return `
                <div class="digest-days-row is-${tone}" style="--digest-i:${i}">
                    <span class="digest-days-name" title="${esc(it.name)}">${esc(it.name)}</span>
                    <span class="digest-days-track" aria-hidden="true"><span class="digest-days-fill" style="width:${width}%"></span></span>
                    <span class="digest-days-value">${esc(value)}</span>
                </div>`;
        }).join('');
        return `<div class="digest-days">${rows}</div>`;
    }

    function partHtml({ id, tone, title, note, names, total, more, bars: barsHtml, action, target, work }, state, i) {
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
            <section class="digest-part digest-tone--${esc(tone)}${done ? ' is-done' : ''}" data-digest-part="${esc(id)}" style="--digest-i:${i}">
                <div class="digest-part-head">
                    <h3 class="digest-part-title"><span class="digest-part-dot" aria-hidden="true">${done ? '✓' : ''}</span>${esc(title)}</h3>
                    ${button}
                </div>
                <p class="digest-part-note">${esc(note)}</p>
                ${barsHtml || ''}
                ${chips(names, total, more)}
            </section>`;
    }

    /**
     * The counts across the top, each a way into the view its part opens. Only
     * the ones with something in them; "runs out within 30 days" takes
     * certificates and domains together, and opens the one with the nearest.
     */
    function tileList(s) {
        const h = s.health || {}, u = s.updates || {}, g = s.usage || {};
        const out = [];
        const broken = (h.newlyBroken?.length || 0) + (h.stillBroken || 0);
        if (broken) out.push({ part: 'broken', target: 'broken', tone: 'bad', count: broken, label: t('dashboard.digestTileBroken', 'broken links') });
        const certs = expiries(h.certsExpiring).filter((e) => e.days <= 30);
        const domains = expiries(h.domainsExpiring).filter((e) => e.days <= 30);
        if (certs.length || domains.length) {
            const first = !domains.length || (certs.length && certs[0].days <= domains[0].days) ? 'certificates' : 'domains';
            out.push({ part: first, target: first, tone: 'warn', count: certs.length + domains.length, label: t('dashboard.digestTileExpiring', 'run out within 30 days') });
        }
        if (u.available?.length) out.push({ part: 'updates', target: 'updates', tone: 'info', count: u.available.length, label: t('dashboard.digestTileUpdates', 'container updates') });
        if (g.neverOpened) out.push({ part: 'never', target: 'unused', tone: 'quiet', count: g.neverOpened, label: t('dashboard.digestTileNever', 'never opened') });
        return out;
    }

    function tilesHtml(tiles, state) {
        if (!tiles.length) return '';
        return `<div class="digest-tiles" style="--digest-tiles:${tiles.length}">${tiles.map((tile, i) => {
            const done = state.visited.includes(tile.part);
            return `
                <button type="button" class="digest-tile digest-tone--${tile.tone}${done ? ' is-done' : ''}" data-digest-tile="${esc(tile.target)}" data-digest-part-id="${esc(tile.part)}" style="--digest-i:${i}">
                    <span class="digest-tile-count" data-digest-count="${tile.count}">${tile.count}</span>
                    <span class="digest-tile-label">${esc(tile.label)}</span>
                    ${done ? '<span class="digest-tile-done" aria-hidden="true">✓</span>' : ''}
                </button>`;
        }).join('')}</div>`;
    }

    /** The tiles count up from nothing, once, unless motion is turned down. */
    function countUp(root) {
        const still = document.body.classList.contains('no-animations')
            || global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (still || typeof global.requestAnimationFrame !== 'function') return;
        root.querySelectorAll('[data-digest-count]').forEach((el, i) => {
            const to = Number(el.getAttribute('data-digest-count')) || 0;
            const start = performance.now() + 150 + i * 80;
            const length = 800;
            el.textContent = '0';
            const step = (now) => {
                const p = Math.min(1, Math.max(0, (now - start) / length));
                el.textContent = String(Math.round(to * (1 - (1 - p) ** 3)));
                if (p < 1) global.requestAnimationFrame(step);
            };
            global.requestAnimationFrame(step);
        });
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
                id: 'broken', tone: 'bad', title: t('dashboard.digestBrokenTitle', 'Broken links'), note,
                names: newly.length ? newly : h.stillBrokenNames, total: newly.length ? newly.length : h.stillBroken,
                more: newly.length && h.stillBroken ? t('dashboard.digestOlder', '+{count} older', { count: h.stillBroken }) : '',
                action: t('dashboard.digestOpenBookmarks', 'Open in Bookmarks'), target: 'broken',
                // The Bookmarks view's Work through, on the broken ones only.
                work: t('dashboard.digestWorkThrough', 'Work through'),
            });
        }
        if (h.certsExpiring?.length) {
            const certs = expiries(h.certsExpiring);
            out.push({
                id: 'certificates', tone: 'warn', title: t('dashboard.digestCertsTitle', 'Certificates'),
                note: t('dashboard.digestCertsBarsNote', 'Days left before the browser shows a warning instead of the site.'),
                bars: bars(certs, { scale: 30, warnBelow: 30 }),
                // Lines the bars could not read stay as names.
                names: certs.length ? null : h.certsExpiring,
                action: t('dashboard.digestOpenBookmarks', 'Open in Bookmarks'), target: 'certificates',
            });
        }
        if (h.domainsExpiring?.length) {
            // A domain with more than half a year to go is a count, not a bar:
            // the bars are for the renewals that are coming.
            const domains = expiries(h.domainsExpiring);
            const near = domains.filter((d) => d.days <= 200);
            const far = domains.length - near.length;
            out.push({
                id: 'domains', tone: 'ok', title: t('dashboard.digestDomainsTitle', 'Domains'),
                note: near.length
                    ? t('dashboard.digestDomainsBarsNote', 'Days left before the site, its certificate and its mail go with the domain.')
                    : t('dashboard.digestDomainsNote', 'When a domain runs out, the site, its certificate and its mail go with it.'),
                bars: bars(near, { scale: 365, warnBelow: 90 }),
                names: domains.length ? null : h.domainsExpiring,
                more: far ? t('dashboard.digestDomainsFar', '+{count} more than 200 days away', { count: far }) : '',
                action: t('dashboard.digestOpenBookmarks', 'Open in Bookmarks'), target: 'domains',
            });
        }
        if (u.available?.length) {
            out.push({
                id: 'updates', tone: 'info', title: t('dashboard.digestUpdatesTitle', 'Container updates'),
                note: t('dashboard.digestUpdatesNote', 'A newer image is available for these. Containers you hold back are left out.'),
                names: u.available, action: t('dashboard.digestOpenContainers', 'Open Containers'), target: 'updates',
            });
        }
        if (g.topOpened?.length) {
            out.push({
                id: 'top', tone: 'accent', title: t('dashboard.digestTopTitle', 'Most opened'),
                note: t('dashboard.digestTopNote', 'What you opened most in the last 7 days.'),
                names: g.topOpened.map((name, i) => `${i + 1} · ${name}`),
            });
        }
        // The Bookmarks view's own two filters, so the count is the list the
        // button opens: Unused is never opened, Stale is not opened for the
        // days set under "count as neglected after".
        if (g.neverOpened) {
            out.push({
                id: 'never', tone: 'quiet', title: t('dashboard.digestNeverTitle', 'Never opened'),
                note: count(g.neverOpened, 'dashboard.digestNeverNote', '1 bookmark nobody has opened yet.', '{count} bookmarks nobody has opened yet.'),
                names: g.neverOpenedNames, total: g.neverOpened,
                action: t('dashboard.digestReview', 'Review'), target: 'unused',
            });
        }
        if (g.stale) {
            const days = String(g.staleDays || 90);
            out.push({
                id: 'stale', tone: 'quiet', title: t('dashboard.digestStaleTitle', 'Not opened in {days} days').replace('{days}', days),
                note: count(g.stale, 'dashboard.digestStaleNote', '1 bookmark. A candidate to move, archive or delete.', '{count} bookmarks. Candidates to move, archive or delete.'),
                names: g.staleNames, total: g.stale,
                action: t('dashboard.digestReview', 'Review'), target: 'stale',
            });
        }
        if (g.inbox) {
            out.push({
                id: 'inbox', tone: 'accent', title: t('dashboard.digestInboxTitle', 'Inbox'),
                note: count(g.inbox, 'dashboard.digestInboxNote', '1 link waiting to be sorted.', '{count} links waiting to be sorted.'),
                action: t('dashboard.digestOpenInbox', 'Open Inbox'), target: 'inbox',
            });
        }
        // nextDash's own releases of the week, last: news, not something to do.
        const news = s.news || {};
        if (news.releases?.length) {
            out.push({
                id: 'news', tone: 'accent', title: t('dashboard.digestNewsTitle', 'New in nextDash'),
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
        // The tiles first, then the parts in two columns, so a full week fits
        // the window without scrolling down through it.
        const html = `
            <div class="digest-window">
                <p class="digest-window-when">${esc(when(s))}</p>
                ${tilesHtml(tileList(s), state)}
                <div class="digest-parts">
                    ${partList(s).map((p, i) => partHtml(p, state, i)).join('')}
                </div>
            </div>`;
        global.AppModal.show({
            title: t('dashboard.digestWindowTitle', 'Weekly digest'),
            htmlMessage: html,
            confirmText: t('dashboard.digestDone', 'Done'),
            showCancel: false,
            modalClass: 'digest-modal',
            modalMaxWidth: 'min(66rem, calc(100vw - 2.5rem))',
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
        // A tile is its part's Open button, counted.
        document.querySelectorAll('.digest-modal [data-digest-tile]').forEach((btn) => {
            btn.addEventListener('click', () => {
                global.AppModal.hide?.();
                void visit(s, btn.getAttribute('data-digest-part-id'), btn.getAttribute('data-digest-tile'));
            });
        });
        const win = document.querySelector('.digest-modal .digest-window');
        if (win) countUp(win);
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

    /**
     * The latest digest in brief, for Config's overview panel: when it came
     * out, its tiles, and how many of its parts are still to be opened. Null
     * while there is none, or with the digest switched off.
     */
    async function summary() {
        if (dash()?.settings?.digestEnabled === false) return null;
        const s = latest || await fetchLatest();
        if (!s) return null;
        const progress = readProgress(s);
        const list = todo(s);
        return {
            generatedAt: s.generatedAt,
            when: when(s),
            tiles: tileList(s).map(({ label, count, tone }) => ({ label, count, tone })),
            todo: list.length,
            left: list.filter((p) => !progress.visited.includes(p.id)).length,
        };
    }

    global.DigestNotice = { shouldShow, openDigest, holdsTheWeek, summary, render: card.render, close: card.close, showBar: () => latest && showBar(latest) };
})(window);
