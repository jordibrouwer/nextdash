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
    // When the card shows: snoozed, seen, and the two reminders after "Got it".
    // The rules are DigestCardState's; this only keeps them per browser.
    const CARD_KEY = 'nextdashDigestCard';
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
    /** The card's state for this digest. A digest seen before the card kept state is taken as read: no reminders. */
    function readCard(s) {
        let stored = null;
        try { stored = JSON.parse(global.localStorage?.getItem(CARD_KEY) || 'null'); } catch (_) { /* private mode, or a value from elsewhere */ }
        const state = global.DigestCardState.forSnapshot(stored, s.generatedAt);
        if (state === stored || !seenAt() || seenAt() < s.generatedAt) return state;
        return { ...state, seenAt: Date.now(), windowClosed: true };
    }
    function writeCard(state) {
        try { global.localStorage?.setItem(CARD_KEY, JSON.stringify(state)); } catch (_) { /* private mode */ }
    }
    function updateCard(change) {
        if (!latest) return;
        writeCard(change(readCard(latest), Date.now()));
    }

    function markSeen() {
        try { if (latest) global.localStorage?.setItem(SEEN_KEY, String(latest.generatedAt)); } catch (_) { /* private mode */ }
        updateCard(global.DigestCardState.gotIt);
    }

    function shouldShow(snapshot) {
        return Boolean(snapshot && global.DigestCardState.shouldShow(readCard(snapshot), Date.now()));
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
        if (target === 'checkup') {
            await global.Checkup?.open?.();
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

    function partHtml({ id, tone, title, intro, note, names, total, more, bars: barsHtml, action, target, work }, state, i) {
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
                ${intro ? `<p class="digest-part-intro">${esc(intro)}</p>` : ''}
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

    /**
     * The digest counts "not opened" at a fixed 30 days; the Bookmarks view's
     * own filter follows the reader's setting, so the list behind the button
     * can differ. Say so rather than let the two numbers look like a mistake.
     */
    function staleLimitNote(digestDays) {
        const own = Number(dash()?.settings?.bookmarkStaleDays) || 90;
        if (own === digestDays) return '';
        return ` ${t('dashboard.digestStaleLimit', 'The Bookmarks view uses your own limit of {days} days, so its list can differ.', { days: own })}`;
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
                intro: t('dashboard.digestBrokenIntro', 'A broken link is a bookmark whose address did not answer at the last check: the site is down, the page moved, or the address is wrong. You are told because a link you rely on may not open.'),
                count: (newly.length || 0) + (h.stillBroken || 0),
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
                intro: t('dashboard.digestCertsIntro', 'A certificate is what lets the browser trust a site. When it runs out, the browser shows a warning instead of the site. You are told because these run out within 30 days, or already have.'),
                count: h.certsExpiring.length,
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
                intro: t('dashboard.digestDomainsIntro', 'A domain is a name you rent, and it has to be renewed. You are told about the ones that run out soonest, so a site does not disappear because a renewal was missed.'),
                count: h.domainsExpiring.length,
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
                intro: t('dashboard.digestUpdatesIntro', 'Your containers run an image. These have a newer image available. You are told so you can update them when it suits you; nothing changes by itself.'),
                count: u.available.length,
                note: t('dashboard.digestUpdatesNote', 'A newer image is available for these. Containers you hold back are left out.'),
                names: u.available, action: t('dashboard.digestOpenContainers', 'Open Containers'), target: 'updates',
            });
        }
        if (g.topOpened?.length) {
            out.push({
                id: 'top', tone: 'accent', title: t('dashboard.digestTopTitle', 'Most opened'),
                intro: t('dashboard.digestTopIntro', 'The bookmarks you opened most in the last 7 days. Only for your information: there is nothing to do here.'),
                count: g.topOpened.length,
                note: t('dashboard.digestTopNote', 'What you opened most in the last 7 days.'),
                names: g.topOpened.map((name, i) => `${i + 1} · ${name}`),
            });
        }
        // The checkup, when it is there and the week has enough for it.
        if (s.checkup?.items && global.Checkup?.open) {
            out.push({
                id: 'checkup', tone: 'accent', title: t('dashboard.digestCheckupTitle', 'Checkup'),
                intro: t('dashboard.digestCheckupIntro', 'The checkup walks you through what is worth tidying on your dashboard: dead and doubled links, and bookmarks you never or rarely open. You are told because there is enough to do to be worth a few minutes.'),
                count: s.checkup.items,
                note: count(s.checkup.items, 'dashboard.digestCheckupNote', '1 bookmark is broken, doubled, never opened or not opened for a while.', '{count} bookmarks are broken, doubled, never opened or not opened for a while.'),
                action: t('dashboard.digestStartCheckup', 'Start the checkup'), target: 'checkup',
            });
        }
        // The Bookmarks view's own two filters, so the count is the list the
        // button opens: Unused is never opened, Stale is not opened for the
        // days set under "count as neglected after".
        if (g.neverOpened) {
            out.push({
                id: 'never', tone: 'quiet', title: t('dashboard.digestNeverTitle', 'Never opened'),
                intro: t('dashboard.digestNeverIntro', 'These bookmarks have been on your dashboard but were never opened. You are told because a link nobody uses is a candidate to move, archive or delete.'),
                count: g.neverOpened,
                note: count(g.neverOpened, 'dashboard.digestNeverNote', '1 bookmark nobody has opened yet.', '{count} bookmarks nobody has opened yet.'),
                names: g.neverOpenedNames, total: g.neverOpened,
                action: t('dashboard.digestReview', 'Review'), target: 'unused',
            });
        }
        if (g.stale) {
            const days = String(g.staleDays || 30);
            out.push({
                id: 'stale', tone: 'quiet', title: t('dashboard.digestStaleTitle', 'Not opened in {days} days').replace('{days}', days),
                intro: t('dashboard.digestStaleIntro', 'You opened these once, but not for the last {days} days. You are told because they may no longer be worth keeping.', { days }),
                count: g.stale,
                note: count(g.stale, 'dashboard.digestStaleNote', '1 bookmark. A candidate to move, archive or delete.', '{count} bookmarks. Candidates to move, archive or delete.')
                    + staleLimitNote(g.staleDays || 30),
                names: g.staleNames, total: g.stale,
                action: t('dashboard.digestReview', 'Review'), target: 'stale',
            });
        }
        if (g.inbox) {
            out.push({
                id: 'inbox', tone: 'accent', title: t('dashboard.digestInboxTitle', 'Inbox'),
                intro: t('dashboard.digestInboxIntro', 'The Inbox holds links you saved but have not filed on a page yet. You are told so they do not pile up unread.'),
                count: g.inbox,
                note: count(g.inbox, 'dashboard.digestInboxNote', '1 link waiting to be sorted.', '{count} links waiting to be sorted.'),
                action: t('dashboard.digestOpenInbox', 'Open Inbox'), target: 'inbox',
            });
        }
        // nextDash's own releases of the week, last: news, not something to do.
        const news = s.news || {};
        if (news.releases?.length) {
            out.push({
                id: 'news', tone: 'accent', title: t('dashboard.digestNewsTitle', 'New in nextDash'),
                intro: t('dashboard.digestNewsIntro', 'nextDash itself was updated this week. Only for your information: these are the highlights.'),
                count: news.releases.length,
                note: t('dashboard.digestNewsNote', '{releases} came out this week.', { releases: news.releases.join(', ') }),
                names: news.highlights,
                action: t('dashboard.digestOpenWhatsNew', "Open What's new"), target: 'whats-new', info: true,
            });
        }
        return out;
    }

    /**
     * The window's list, in the order a reader should deal with it: what needs
     * action, what is worth tidying, and what is only good to know.
     */
    const GROUPS = [
        { id: 'now', label: () => t('dashboard.digestGroupNow', 'Needs you'), parts: ['broken', 'certificates', 'domains', 'updates'] },
        { id: 'tidy', label: () => t('dashboard.digestGroupTidy', 'Tidy up'), parts: ['checkup', 'never', 'stale'] },
        { id: 'know', label: () => t('dashboard.digestGroupKnow', 'Good to know'), parts: ['inbox', 'top', 'news'] },
    ];

    function rowHtml(p, state, selected) {
        const done = state.visited.includes(p.id);
        return `
            <button type="button" class="digest-row digest-tone--${esc(p.tone)}${done ? ' is-done' : ''}${p.id === selected ? ' is-selected' : ''}" data-digest-row="${esc(p.id)}" aria-pressed="${p.id === selected}">
                <span class="digest-part-dot" aria-hidden="true">${done ? '✓' : ''}</span>
                <span class="digest-row-title">${esc(p.title)}</span>
                <span class="digest-row-count">${esc(String(p.count ?? ''))}</span>
            </button>`;
    }

    function listHtml(parts, state, selected) {
        return GROUPS.map((g) => {
            const rows = g.parts.map((id) => parts.find((p) => p.id === id)).filter(Boolean);
            if (!rows.length) return '';
            return `
                <div class="digest-list-group">
                    <div class="digest-list-label">${esc(g.label())}</div>
                    ${rows.map((p) => rowHtml(p, state, selected)).join('')}
                </div>`;
        }).join('');
    }

    /** What to show first: the first part that needs you and has not been opened, else the first part. */
    function firstSelected(parts, state) {
        const ordered = GROUPS.flatMap((g) => g.parts).map((id) => parts.find((p) => p.id === id)).filter(Boolean);
        return (ordered.find((p) => p.action && !p.info && !state.visited.includes(p.id)) || ordered[0] || {}).id || null;
    }

    function progressText(s, state) {
        const list = todo(s);
        const done = list.filter((p) => state.visited.includes(p.id)).length;
        return t('dashboard.digestProgress', '{done} of {total} looked at', { done, total: list.length });
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
        // Opening the digest is reading it: seen, and no reminders after.
        markSeen();
        updateCard((state) => global.DigestCardState.closeWindow(state));
        card.close();
        removeBar();
        const progress = readProgress(s);
        const state = { visited: progress.visited, next: nextPart(s, progress)?.id };
        // A list of the parts on the left, the chosen one in full on the right,
        // so a full week never grows the window: only the middle scrolls.
        const parts = partList(s);
        let selected = firstSelected(parts, state);
        const html = `
            <div class="digest-window">
                <p class="digest-window-when">${esc(when(s))}</p>
                <p class="digest-summary">${esc(cardBody(s))}</p>
                <div class="digest-split">
                    <nav class="digest-list" aria-label="${esc(t('dashboard.digestListLabel', 'Parts of the digest'))}">${listHtml(parts, state, selected)}</nav>
                    <div class="digest-detail"></div>
                </div>
            </div>`;
        global.AppModal.show({
            title: t('dashboard.digestWindowTitle', 'Weekly digest'),
            htmlMessage: html,
            confirmText: t('dashboard.digestClose', 'Close'),
            showCancel: false,
            modalClass: 'digest-modal',
            modalMaxWidth: 'min(66rem, calc(100vw - 2.5rem))',
            // Closed halfway through: back to the bar, so the rest is not lost.
            onHide: () => {
                if (readProgress(s).visited.length) showBar(s);
            },
        });
        const win = document.querySelector('.digest-modal .digest-window');
        if (!win) return true;
        const detail = win.querySelector('.digest-detail');
        const showDetail = (id) => {
            selected = id;
            const index = Math.max(0, parts.findIndex((p) => p.id === id));
            detail.innerHTML = parts[index] ? partHtml(parts[index], state, 0) : '';
            win.querySelectorAll('.digest-row').forEach((row) => {
                const on = row.getAttribute('data-digest-row') === id;
                row.classList.toggle('is-selected', on);
                row.setAttribute('aria-pressed', String(on));
            });
        };
        showDetail(selected);
        // The head: where the reader is, and a way out that is always in view.
        const header = document.querySelector('.digest-modal .modal-header');
        if (header) {
            // Marked, so the next caller of the shared modal does not inherit them.
            const progress = document.createElement('span');
            progress.setAttribute('data-modal-header-extra', '');
            progress.className = 'digest-progress';
            progress.textContent = progressText(s, state);
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'digest-header-close';
            close.setAttribute('data-modal-header-extra', '');
            close.setAttribute('data-digest-close', '');
            close.setAttribute('aria-label', t('dashboard.digestCloseLabel', 'Close the digest window'));
            close.textContent = '×';
            close.addEventListener('click', () => { global.AppModal.hide?.(); });
            header.append(progress, close);
        }
        // One listener for the rows and the parts' buttons: the detail is drawn
        // again whenever another row is chosen. On the window, which is made
        // anew every time, not on the modal, which stays.
        win.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const row = target.closest('[data-digest-row]');
            if (row) { showDetail(row.getAttribute('data-digest-row')); return; }
            const open = target.closest('[data-digest-go]');
            if (open) {
                global.AppModal.hide?.();
                // News opens What's new and leaves the to-do list as it was.
                if (open.getAttribute('data-digest-go') === 'whats-new') { void go('whats-new'); return; }
                void visit(s, open.getAttribute('data-digest-part-id'), open.getAttribute('data-digest-go'));
                return;
            }
            const work = target.closest('[data-digest-work]');
            if (work) {
                global.AppModal.hide?.();
                void visit(s, work.getAttribute('data-digest-part-id'), work.getAttribute('data-digest-work'), { work: true });
            }
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

    /**
     * What the question on closing the bar names: the two largest things in
     * the first group, "7 broken links, 4 certificates", or, with nothing
     * there, only that parts are still unopened.
     */
    function bodyLine(s) {
        const parts = partList(s);
        const now = GROUPS[0].parts
            .map((id) => parts.find((p) => p.id === id))
            .filter((p) => p && p.count)
            .sort((a, b) => b.count - a.count)
            .slice(0, 2)
            .map((p) => `${p.count} ${p.title.toLowerCase()}`);
        if (!now.length) return t('dashboard.digestCloseGeneral', 'Some parts have not been opened yet.');
        return t('dashboard.digestCloseNamed', 'It still holds, for example, {items}.', { items: now.join(', ') });
    }

    /** Closing the bar loses the digest until next week, so it asks first. */
    function confirmCloseBar(s) {
        if (!global.AppModal?.show) return Promise.resolve(true);
        return new Promise((resolve) => {
            let answered = false;
            const answer = (value) => { if (!answered) { answered = true; resolve(value); } };
            global.AppModal.show({
                title: t('dashboard.digestCloseTitle', 'Close this digest until Monday?'),
                message: `${bodyLine(s)} ${t('dashboard.digestCloseWarn', 'This is important information. Config → Overview opens it again.')}`,
                confirmText: t('dashboard.digestCloseConfirm', 'Close until Monday'),
                cancelText: t('dashboard.digestCloseKeep', 'Keep it'),
                onConfirm: () => answer(true),
                onCancel: () => answer(false),
                onHide: () => answer(false),
            });
        });
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
        el.querySelector('[data-digest-bar="close"]').addEventListener('click', async () => {
            if (!(await confirmCloseBar(s))) return;
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
        canShow: async () => shouldShow(await fetchLatest()),
        // A reminder day is used up once the card is drawn, so a reload the
        // same day stays quiet.
        onShown: () => updateCard(global.DigestCardState.shown),
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
                name: 'snooze',
                label: () => t('dashboard.digestSnooze', 'Snooze 1 day'),
                onClick: (handle) => { updateCard(global.DigestCardState.snooze); handle.close(); },
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
