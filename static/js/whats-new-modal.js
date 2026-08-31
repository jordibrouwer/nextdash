/**
 * What's new modal — manifest index + per-release JSON fetch on demand.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';
    /*
     * Every release the index knows about.
     *
     * This was capped at 50 because each entry beyond the first meant fetching
     * and rendering a whole release as the reader scrolled towards it. Now an
     * older release is one row until somebody opens it, so the cap was only
     * hiding history for no saving -- 150 rows cost less than one of the
     * releases they replaced.
     */
    const MAX_VISIBLE_RELEASES = 500;

    let manifestCache = null;
    let manifestFetch = null;
    const releaseCache = new Map();
    const releaseFetches = new Map();
    let modalSessionId = 0;

    function getDataVersion() {
        return window.NEXTDASH_WHATS_NEW_DATA_VERSION || 'whats-new-v99';
    }

    function getReleaseToken() {
        return window.NEXTDASH_WHATS_NEW_RELEASE || '';
    }

    function dataUrl(relativePath) {
        const version = encodeURIComponent(getDataVersion());
        return `/static/data/whats-new/${relativePath}?v=${version}`;
    }

    function fetchManifest() {
        if (manifestCache) {
            return Promise.resolve(manifestCache);
        }
        if (!manifestFetch) {
            manifestFetch = fetch(dataUrl('index.json'))
                .then((res) => {
                    if (!res.ok) {
                        throw new Error(`manifest HTTP ${res.status}`);
                    }
                    return res.json();
                })
                .then((data) => {
                    // Entries flagged hideFromModal stay in the index — the
                    // release tag and Config → Overview → Latest update both
                    // read index[0], so removing them would roll those back —
                    // but they never reach this modal. Docs-only releases use
                    // it: there is nothing in them for a user to read about.
                    // Filtering here rather than at each call site keeps the
                    // list, the lazy loader and the "n more releases" count
                    // working off one set of entries.
                    manifestCache = (Array.isArray(data) ? data : [])
                        .filter((entry) => !entry?.hideFromModal);
                    return manifestCache;
                })
                .catch((error) => {
                    manifestFetch = null;
                    throw error;
                });
        }
        return manifestFetch;
    }

    function fetchRelease(id) {
        id = String(id || '').trim();
        if (!id) {
            return Promise.reject(new Error('missing release id'));
        }
        if (releaseCache.has(id)) {
            return Promise.resolve(releaseCache.get(id));
        }
        if (!releaseFetches.has(id)) {
            const promise = fetch(dataUrl(`${id}.json`))
                .then((res) => {
                    if (!res.ok) {
                        throw new Error(`release ${id} HTTP ${res.status}`);
                    }
                    return res.json();
                })
                .then((data) => {
                    releaseCache.set(id, data);
                    releaseFetches.delete(id);
                    return data;
                })
                .catch((error) => {
                    releaseFetches.delete(id);
                    throw error;
                });
            releaseFetches.set(id, promise);
        }
        return releaseFetches.get(id);
    }

    /*
     * One item, as a title and an explanation rather than one long run.
     *
     * The text in the JSON is a bold lead sentence followed by a paragraph of
     * detail, written as a single HTML string. Rendered as one run it was ten
     * to twenty bold words followed by more of the same colour -- at that
     * length bold stops being emphasis, and the two halves ran together. They
     * are the same two halves the writer already meant, so they are split back
     * apart here rather than asked for twice in the data.
     */
    function splitItemText(html) {
        const raw = String(html || '').trim();
        const match = raw.match(/^<strong>([\s\S]*?)<\/strong>\s*([\s\S]*)$/i);
        if (!match) {
            return { title: raw, body: '' };
        }
        return { title: match[1].trim(), body: match[2].trim() };
    }

    /**
     * How much explanation fits before it is folded away, counted in plain
     * characters so markup does not decide it. Around three lines at the width
     * this modal keeps.
     */
    const ITEM_BODY_FOLD_CHARS = 190;

    function plainTextLength(html) {
        return String(html || '').replace(/<[^>]*>/g, '').trim().length;
    }

    function renderItem({ badge, text, keys }, isKeys) {
        if (isKeys) {
            return `
                <li class="wn-entry wn-entry--keys">
                    <span class="wn-keycap">${keys || ''}</span>
                    <span class="wn-entry-title">${text}</span>
                </li>
            `;
        }
        const { title, body } = splitItemText(text);
        const isFix = badge !== 'new';
        // A dot instead of a chip: the badge cost seven characters of an
        // already narrow column, and on a green accent its colour was the same
        // as the version tag beside it. Filled means new, hollow means a fix,
        // and the word is still there for anyone who cannot see the difference.
        const badgeLabel = isFix
            ? wnTranslate('dashboard.whatsNewBadgeFix', 'fix')
            : wnTranslate('dashboard.whatsNewBadgeNew', 'new');
        const folded = plainTextLength(body) > ITEM_BODY_FOLD_CHARS;
        const bodyHtml = body
            ? `<div class="wn-entry-body${folded ? ' is-folded' : ''}" data-wn-entry-body>${body}</div>`
            : '';
        const moreHtml = folded
            ? `<button type="button" class="wn-entry-more" data-wn-entry-more
                    aria-expanded="false">${wnTranslate('dashboard.whatsNewItemMore', 'more')}</button>`
            : '';
        return `
            <li class="wn-entry">
                <span class="wn-badge${isFix ? ' wn-badge--fix' : ' wn-badge--new'}">${badgeLabel}</span>
                <div class="wn-entry-main">
                    <div class="wn-entry-title">${title}</div>
                    ${bodyHtml}
                    ${moreHtml}
                </div>
            </li>
        `;
    }

    function renderSections(sections) {
        return (sections || []).map(({ title, items, kind }) => {
            const isKeys = kind === 'keys';
            const count = (items || []).length;
            return `
            <section class="wn-group${isKeys ? ' wn-group--keys' : ''}">
                <h4 class="wn-group-title">
                    <span>${title}</span>
                    <span class="wn-group-count" aria-hidden="true">${count}</span>
                </h4>
                <ul class="wn-entries">
                    ${(items || []).map((item) => renderItem(item, isKeys)).join('')}
                </ul>
            </section>
        `;
        }).join('');
    }

    function countChanges(sections) {
        let added = 0;
        let fixed = 0;
        (sections || []).forEach((section) => {
            (section.items || []).forEach((item) => {
                if (section.kind === 'keys' || item.badge === 'new') {
                    added += 1;
                } else {
                    fixed += 1;
                }
            });
        });
        return { added, fixed };
    }

    /*
     * The newest release, given the top of the modal.
     *
     * modalLead is written for every release already and used to sit in a
     * bordered box below two other bordered boxes. It is the one sentence that
     * says what this release was about, so it goes where a subtitle goes.
     */
    function renderHeadlineRelease({ tag, date, sections, modalLead }) {
        const { added, fixed } = countChanges(sections);
        const counts = [];
        if (added) {
            counts.push(added === 1
                ? wnTranslate('dashboard.whatsNewCountNewOne', '1 new')
                : wnTranslate('dashboard.whatsNewCountNewMany', '{count} new', { count: added }));
        }
        if (fixed) {
            counts.push(fixed === 1
                ? wnTranslate('dashboard.whatsNewCountFixOne', '1 fix')
                : wnTranslate('dashboard.whatsNewCountFixMany', '{count} fixes', { count: fixed }));
        }
        const meta = [date, ...counts].filter(Boolean).join(' · ');
        const lead = String(modalLead || '').trim();
        return `
            <header class="wn-hero">
                <h3 class="wn-hero-version">${tag}</h3>
                <p class="wn-hero-meta">${meta}</p>
                ${lead ? `<p class="wn-hero-lead">${lead}</p>` : ''}
            </header>
            <div class="wn-groups">${renderSections(sections)}</div>
        `;
    }

    /*
     * An older release, opened from the list at the bottom.
     *
     * Same body as the headline release without the hero -- the row it unfolds
     * from already carries the tag and the date, and repeating them under the
     * row that names them is the kind of doubling this redesign is removing.
     */
    function renderRelease({ tag, date, sections }) {
        return `
            <div class="wn-release" data-wn-release="${tag}">
                <div class="wn-groups">${renderSections(sections)}</div>
            </div>
        `;
    }

    /*
     * The support line, at the end rather than the beginning.
     *
     * It used to be the third bordered panel above the first release: someone
     * who opened this to find out what changed read a request for money before
     * reading a single change. Asking after the reading is done costs the ask
     * nothing and costs the reader nothing either.
     *
     * Sticky to the bottom of the scroll area so it is present without being
     * first, which is also where the update status now lives.
     */
    function buildFooterHtml() {
        return `
            <div class="wn-foot" data-wn-foot>
                <div class="wn-foot-update" data-wn-foot-update></div>
                <a class="wn-kofi-btn wn-kofi-btn--animated" href="https://ko-fi.com/jordibrw" target="_blank" rel="noopener">
                <span class="wn-kofi-stars" aria-hidden="true">
                    <span class="wn-kofi-star"></span>
                    <span class="wn-kofi-star"></span>
                    <span class="wn-kofi-star"></span>
                    <span class="wn-kofi-star"></span>
                </span>
                <svg class="wn-kofi-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 5.702 0 8.732c.483 4.918 3.919 5.023 6.782 5.139 2.81.114 3.325.12 3.325.12s.747.468 1.5.654a7.5 7.5 0 0 0 3.56-.468s5.698-1.094 7.035-5.7c.222-.778.35-1.574.35-2.373 0-.888-.098-1.83-.715-2.309zm-3.585 2.39c-.583 2.4-3.11 2.947-3.11 2.947l-1.8-.434c-.016-.003-.033.003-.043.016l-.847 1.067a.15.15 0 0 1-.265-.046l-.522-1.947a.15.15 0 0 0-.102-.107l-1.956-.517a.15.15 0 0 1-.046-.267l3.184-2.304c.016-.011.026-.03.024-.049l-.098-.832a2.617 2.617 0 0 1 2.602-2.944c1.444 0 2.618 1.174 2.618 2.618 0 .295-.049.582-.14.854l.501-.068s.564 1.006-.0 2.013z"/></svg>
                <span class="wn-kofi-label">${wnTranslate('config.helpSupportKofi', 'Support me on Ko-fi')}</span>
                </a>
            </div>
        `;
    }

    function updateCheckEnabled() {
        return window.nextdashUpdateCheckEnabled?.() === true;
    }

    function wnTranslate(key, fallback, vars) {
        const lang = window.dashboardInstance?.language;
        let text = fallback != null ? fallback : key;
        if (lang && typeof lang.t === 'function') {
            const translated = lang.t(key);
            if (translated && translated !== key) {
                text = translated;
            }
        }
        if (vars && typeof vars === 'object') {
            Object.keys(vars).forEach((name) => {
                text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(vars[name]));
            });
        }
        return text;
    }

    function describeModalUpdateStatus(status, checking) {
        const desc = window.nextdashDescribeUpdateStatus?.(status, checking)
            || { tone: 'neutral', message: '' };
        if (checking || desc.tone === 'loading') {
            return desc;
        }
        if (desc.tone === 'warn' && status?.latest) {
            return {
                ...desc,
                message: wnTranslate(
                    'config.updateCheckModalAvailable',
                    '{latest} is available on GitHub.',
                    { latest: status.latest }
                ),
            };
        }
        if (desc.tone === 'neutral' && !status) {
            return { ...desc, message: '' };
        }
        return desc;
    }

    function buildUpdateCheckHeaderHtml() {
        if (!updateCheckEnabled()) {
            return '';
        }
        // Status only — no "Check for updates" button. The daily check still runs
        // on its own, and Config → Overview keeps the manual trigger; this modal
        // is for reading release notes, so it just reports what the check found.
        return `
            <div class="wn-update-check-header" data-wn-update-check>
                <div class="wn-update-check-meta" data-wn-update-meta>
                    <p class="wn-update-check-status" id="wn-update-status-text" data-wn-update-status aria-live="polite"></p>
                </div>
            </div>
        `;
    }

    function teardownWhatsNewUpdateCheckHeader() {
        document.querySelector('#app-modal .whats-new-modal [data-wn-update-check]')?.remove();
    }

    /*
     * Mounted into the footer rather than the modal header.
     *
     * "A newer version exists" and "here is what changed in the one you have"
     * are two different messages, and the first one used to be read first,
     * across the top, in the accent colour. It is still here and still live --
     * it is simply no longer the answer to the question that opened the modal.
     */
    function mountWhatsNewUpdateCheckHeader() {
        teardownWhatsNewUpdateCheckHeader();
        if (!updateCheckEnabled()) {
            return;
        }
        const header = document.querySelector('#app-modal .whats-new-modal [data-wn-foot-update]');
        if (!header) {
            return;
        }
        const wrap = document.createElement('div');
        wrap.innerHTML = buildUpdateCheckHeaderHtml().trim();
        const el = wrap.firstElementChild;
        if (el) {
            header.appendChild(el);
        }
        setupUpdateCheckBar(el);
    }

    function syncWhatsNewUpdateBar(checking) {
        if (!updateCheckEnabled()) {
            teardownWhatsNewUpdateCheckHeader();
            return;
        }
        const root = document.querySelector('#app-modal .whats-new-modal [data-wn-update-check]');
        if (!root) return;
        const statusEl = root.querySelector('[data-wn-update-status]');
        if (!statusEl) return;

        const status = window.dashboardInstance?.updateStatus || null;
        const desc = describeModalUpdateStatus(status, checking);
        statusEl.textContent = desc.message || '';
        statusEl.className = `wn-update-check-status wn-update-check-status--${desc.tone || 'neutral'}`;
        statusEl.hidden = !desc.message;
        root.classList.toggle('wn-update-check-header--warn', desc.tone === 'warn');

        let link = root.querySelector('[data-wn-update-release-link]');
        const metaEl = root.querySelector('[data-wn-update-meta]') || root;
        if (desc.tone === 'warn' && desc.releaseUrl) {
            if (!link) {
                link = document.createElement('a');
                link.className = 'wn-update-check-link';
                link.setAttribute('data-wn-update-release-link', '');
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                metaEl.appendChild(link);
            }
            link.href = desc.releaseUrl;
            link.textContent = wnTranslate('config.overviewUpdateAvailableCta', 'View release on GitHub →');
        } else if (link) {
            link.remove();
        }

        let dismissBtn = root.querySelector('[data-wn-update-dismiss]');
        if (desc.tone === 'warn' && status?.latest) {
            if (!dismissBtn) {
                dismissBtn = document.createElement('button');
                dismissBtn.type = 'button';
                dismissBtn.className = 'wn-update-check-dismiss';
                dismissBtn.setAttribute('data-wn-update-dismiss', '');
                dismissBtn.textContent = wnTranslate('config.overviewUpdateDismiss', 'Dismiss');
                metaEl.appendChild(dismissBtn);
            }
        } else if (dismissBtn) {
            dismissBtn.remove();
        }

        metaEl.hidden = statusEl.hidden
            && !root.querySelector('[data-wn-update-release-link]')
            && !root.querySelector('[data-wn-update-dismiss]');
        root.hidden = metaEl.hidden;
    }

    function setupUpdateCheckBar(checkRoot) {
        if (!checkRoot || !updateCheckEnabled()) return;
        if (checkRoot.dataset.bound === '1') return;
        checkRoot.dataset.bound = '1';
        syncWhatsNewUpdateBar(false);
        checkRoot.addEventListener('click', (e) => {
            if (e.target.closest('[data-wn-update-dismiss]')) {
                const tag = window.dashboardInstance?.updateStatus?.latest;
                window.nextdashDismissUpdateNotice?.(tag);
                syncWhatsNewUpdateBar(false);
            }
        });
    }

    window.nextdashSyncWhatsNewUpdateBar = syncWhatsNewUpdateBar;
    window.nextdashTeardownWhatsNewUpdateCheck = teardownWhatsNewUpdateCheckHeader;
    window.nextdashMountWhatsNewUpdateCheck = mountWhatsNewUpdateCheckHeader;

    function buildSkeletonHtml() {
        return `
            <div class="wn-content wn-content--loading" aria-busy="true" aria-live="polite">
                <div class="wn-skeleton-stack" aria-hidden="true">
                    <div class="wn-skeleton-line"></div>
                    <div class="wn-skeleton-line"></div>
                    <div class="wn-skeleton-line wn-skeleton-line--short"></div>
                </div>
                ${buildFooterHtml()}
            </div>
        `;
    }

    /**
     * Compare two release tags, newest first when the result is positive.
     *
     * Mirrors compareReleaseTags in update_check.go, including the rule that
     * matters most here: a semantic tag outranks a calendar one whatever the
     * numbers say. nextDash tagged vYYYY.MM.N for its whole life, so a plain
     * numeric sort puts v1.0.0 below every release that came before it — 1 is
     * less than 2026 — and the newest release would sink to the bottom of the
     * modal. A first segment at or above 1000 is a year; no semantic major will
     * plausibly reach it.
     */
    const CALENDAR_VERSION_FLOOR = 1000;

    function releaseTagParts(tag) {
        const raw = String(tag || '').trim().replace(/^v/, '');
        if (!raw) return [];
        const parts = raw.split('.').map((seg) => Number.parseInt(seg.trim(), 10));
        return parts.some((n) => !Number.isFinite(n)) ? [] : parts;
    }

    function compareReleaseTags(a, b) {
        const pa = releaseTagParts(a);
        const pb = releaseTagParts(b);

        if (pa.length && pb.length) {
            const calA = pa[0] >= CALENDAR_VERSION_FLOOR;
            const calB = pb[0] >= CALENDAR_VERSION_FLOOR;
            if (calA !== calB) return calA ? -1 : 1;
        }

        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i += 1) {
            const va = i < pa.length ? pa[i] : 0;
            const vb = i < pb.length ? pb[i] : 0;
            if (va !== vb) return va < vb ? -1 : 1;
        }
        return 0;
    }

    function releaseId(entry) {
        return (entry && (entry.id || entry.tag)) || '';
    }

    function getVisibleManifest(manifest) {
        return manifest
            .filter((entry) => releaseId(entry))
            .map((entry) => ({
                ...entry,
                id: releaseId(entry),
                releasedAtMs: Date.parse(`${entry.releasedAt}T12:00:00Z`),
            }))
            .sort((a, b) => {
                // Version tag is authoritative (v2026.07.03 > v2026.07.02); releasedAt is tie-breaker only.
                const tagDiff = compareReleaseTags(b.tag, a.tag);
                if (tagDiff !== 0) {
                    return tagDiff;
                }
                return b.releasedAtMs - a.releasedAtMs;
            })
            .slice(0, MAX_VISIBLE_RELEASES);
    }

    function getModalTextEl() {
        return document.querySelector('#app-modal #modal-text');
    }

    function isModalStillOpen() {
        return document.getElementById('app-modal')?.classList.contains('show') === true;
    }

    /*
     * Everything older than the newest release, as one row each.
     *
     * This replaces a lazy loader that appended whole releases as you scrolled.
     * That put the reader in a corridor: to reach the release before last you
     * scrolled through the last one, and the "scroll for 49 more releases"
     * hint sat between two releases that were both already on screen, reading
     * like an ending that it was not.
     *
     * A row is cheap, so all of them can be listed at once, and the body of one
     * is fetched only when somebody asks for it.
     */
    function buildEarlierHtml(entries) {
        if (!entries.length) {
            return '';
        }
        const rows = entries.map((entry) => `
            <li class="wn-earlier-item">
                <button type="button" class="wn-earlier-row" data-wn-earlier="${entry.id}"
                        aria-expanded="false">
                    <span class="wn-earlier-tag">${entry.tag || entry.id}</span>
                    <span class="wn-earlier-date">${entry.date || ''}</span>
                    <span class="wn-earlier-chevron" aria-hidden="true">›</span>
                </button>
                <div class="wn-earlier-body" data-wn-earlier-body="${entry.id}" hidden></div>
            </li>
        `).join('');
        return `
            <section class="wn-earlier">
                <h4 class="wn-earlier-title">${wnTranslate('dashboard.whatsNewEarlier', 'Earlier')}</h4>
                <ul class="wn-earlier-list" data-wn-earlier-list>${rows}</ul>
            </section>
        `;
    }

    function buildShellHtml(manifestEntries, headlineHtml) {
        return `
            <div class="wn-content" data-wn-content tabindex="-1">
                ${headlineHtml || ''}
                ${buildEarlierHtml(manifestEntries.slice(1))}
                ${buildFooterHtml()}
            </div>
        `;
    }

    /*
     * Opening one older release: fetch once, then toggle.
     *
     * Kept out of the shell so a reader who never opens one never pays for the
     * fetch -- which is every reader who came for the release they just
     * installed.
     */
    function bindEarlierList(root, sessionId) {
        root?.querySelectorAll('[data-wn-earlier]').forEach((button) => {
            button.addEventListener('click', () => {
                const id = button.getAttribute('data-wn-earlier');
                const body = root.querySelector(`[data-wn-earlier-body="${CSS.escape(id)}"]`);
                if (!body) return;

                const open = button.getAttribute('aria-expanded') === 'true';
                button.setAttribute('aria-expanded', open ? 'false' : 'true');
                body.hidden = open;
                if (open || body.dataset.loaded === '1') {
                    return;
                }

                body.dataset.loaded = 'pending';
                body.innerHTML = '<div class="wn-release-loading" aria-hidden="true">'
                    + '<div class="wn-skeleton-line"></div>'
                    + '<div class="wn-skeleton-line wn-skeleton-line--short"></div></div>';
                fetchRelease(id)
                    .then((data) => {
                        if (sessionId !== modalSessionId || !isModalStillOpen()) {
                            return;
                        }
                        body.innerHTML = renderRelease(data);
                        body.dataset.loaded = '1';
                        bindItemFolds(body);
                    })
                    .catch(() => {
                        body.innerHTML = `<p class="wn-empty">${wnTranslate(
                            'dashboard.whatsNewReleaseLoadFailed',
                            'Could not load {tag}.',
                            { tag: id }
                        )}</p>`;
                        body.dataset.loaded = '';
                    });
            });
        });
    }

    /** The "more" under an explanation that was folded to three lines. */
    function bindItemFolds(root) {
        root?.querySelectorAll('[data-wn-entry-more]').forEach((button) => {
            button.addEventListener('click', () => {
                const body = button.parentElement?.querySelector('[data-wn-entry-body]');
                if (!body) return;
                const folded = body.classList.toggle('is-folded');
                button.setAttribute('aria-expanded', folded ? 'false' : 'true');
                button.textContent = folded
                    ? wnTranslate('dashboard.whatsNewItemMore', 'more')
                    : wnTranslate('dashboard.whatsNewItemLess', 'less');
            });
        });
    }

    function isWhatsNewVisible() {
        const overlay = document.getElementById('app-modal');
        if (!overlay?.classList.contains('show')) {
            return false;
        }
        if (!overlay.querySelector('.modal.whats-new-modal')) {
            return false;
        }
        const style = window.getComputedStyle(overlay);
        return style.visibility !== 'hidden'
            && style.display !== 'none'
            && parseFloat(style.opacity) > 0.01;
    }

    function showEmptyMessage(message) {
        const textEl = getModalTextEl();
        if (textEl) {
            textEl.innerHTML = `<div class="wn-content"><p class="wn-empty">${message}</p></div>`;
        }
    }

    window.__whatsNewOpen = function openWhatsNewModal(options) {
        options = options || {};
        const force = options.force === true;
        const markSeenOnConfirm = options.markSeenOnConfirm !== false;
        const onClose = typeof options.onClose === 'function' ? options.onClose : null;
        const onAbort = typeof options.onAbort === 'function' ? options.onAbort : null;
        const releaseToken = getReleaseToken();

        if (!window.AppModal) {
            onAbort?.();
            return Promise.resolve();
        }

        if (isWhatsNewVisible()) {
            if (!force) {
                return Promise.resolve();
            }
            window.AppModal.hide();
        } else if (document.getElementById('app-modal')?.classList.contains('show')) {
            window.AppModal.hide();
        }

        if (!force) {
            const lastSeen = window.DiscoverabilityState?.getLastWhatsNewRelease?.()
                || (() => {
                    try {
                        return localStorage.getItem(STORAGE_KEY);
                    } catch {
                        return null;
                    }
                })();
            if (lastSeen === releaseToken) {
                onClose?.();
                return Promise.resolve();
            }
            if (typeof options.ifBlockingModalOpen === 'function' && options.ifBlockingModalOpen()) {
                onAbort?.();
                return Promise.resolve();
            }
            if (document.body.classList.contains('bookmark-inline-edit-active')) {
                onAbort?.();
                return Promise.resolve();
            }
        }

        // Only claim a new session once we're actually past every early-return guard above —
        // bumping this unconditionally silently broke the lazy loader of an already-open modal
        // whenever a second open call raced in (e.g. an auto-open racing a manual ★ click) and
        // no-opped here, since loadNext() compares against the now-stale captured sessionId.
        modalSessionId += 1;
        const sessionId = modalSessionId;

        window.nextdashTrack?.('modal:whats-new');

        const finish = () => {
            if (markSeenOnConfirm && releaseToken) {
                window.DiscoverabilityState?.setLastWhatsNewRelease?.(releaseToken);
                try {
                    localStorage.setItem(STORAGE_KEY, releaseToken);
                } catch {
                    // Ignore localStorage failures.
                }
            }
            onClose?.();
        };

        // finish() must run however the modal goes away — the close button, Escape,
        // or a click on the backdrop. The latter two only call AppModal.hide(),
        // which fires onHide but not onConfirm/onCancel, so hang it there and guard
        // against running twice when the button path fires both.
        let finished = false;
        const finishOnce = () => {
            if (finished) return;
            finished = true;
            teardownWhatsNewUpdateCheckHeader();
            finish();
        };

        const modalLang = window.dashboardInstance?.language;
        if (modalLang && typeof window.AppModal?.setLanguage === 'function') {
            window.AppModal.setLanguage(modalLang);
        }
        window.AppModal.show({
            title: wnTranslate('dashboard.whatsNewModalTitle', "what's new"),
            htmlMessage: buildSkeletonHtml(),
            confirmText: wnTranslate('dashboard.whatsNewModalClose', 'close'),
            showCancel: false,
            modalClass: 'whats-new-modal',
            onConfirm: finishOnce,
            onCancel: finishOnce,
            onHide: finishOnce,
        });

        mountWhatsNewUpdateCheckHeader();
        if (updateCheckEnabled()) {
            void window.nextdashRefreshUpdateStatus?.(false);
        } else {
            teardownWhatsNewUpdateCheckHeader();
        }

        return fetchManifest()
            .then((manifest) => {
                if (!isModalStillOpen()) {
                    return;
                }
                const visible = getVisibleManifest(manifest);
                if (visible.length === 0) {
                    showEmptyMessage(wnTranslate(
                        'dashboard.whatsNewEmpty',
                        'No release notes found. See <strong>CHANGELOG.md</strong> in Config → Help.'
                    ));
                    return;
                }
                return fetchRelease(visible[0].id).then((first) => {
                    if (!isModalStillOpen() || sessionId !== modalSessionId) {
                        return;
                    }
                    const textEl = getModalTextEl();
                    if (!textEl) {
                        return;
                    }
                    textEl.innerHTML = buildShellHtml(visible, renderHeadlineRelease(first));
                    textEl.querySelector('.wn-content')?.removeAttribute('aria-busy');
                    const contentRoot = textEl.querySelector('[data-wn-content]');
                    if (contentRoot && typeof contentRoot.focus === 'function') {
                        contentRoot.focus({ preventScroll: true });
                    }
                    bindItemFolds(contentRoot);
                    bindEarlierList(contentRoot, sessionId);
                    // The shell replaced everything the skeleton had, footer
                    // included, so the live status bar has to be put back into
                    // the footer that exists now.
                    mountWhatsNewUpdateCheckHeader();
                });
            })
            .catch(() => {
                if (isModalStillOpen()) {
                    showEmptyMessage(wnTranslate(
                        'dashboard.whatsNewLoadFailed',
                        'Could not load release notes. Try again or see <strong>CHANGELOG.md</strong> in Config → Help.'
                    ));
                }
            });
    };

    window.__whatsNewModalReady = true;
})();
