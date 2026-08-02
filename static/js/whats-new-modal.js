/**
 * What's new modal — manifest index + per-release JSON fetch on demand.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';
    const MAX_VISIBLE_RELEASES = 50;

    let manifestCache = null;
    let manifestFetch = null;
    const releaseCache = new Map();
    const releaseFetches = new Map();
    let lazyObserver = null;
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

    function teardownLazyLoader() {
        if (lazyObserver) {
            lazyObserver.disconnect();
            lazyObserver = null;
        }
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
                    manifestCache = Array.isArray(data) ? data : [];
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

    function renderRelease({ tag, date, sections }) {
        // A section with "kind": "keys" lists new shortcuts and is tinted with its
        // own accent so it stands apart from the ordinary new/fix rundown.
        const sectionsHtml = (sections || []).map(({ title, items, kind }) => {
            const isKeys = kind === 'keys';
            return `
            <div class="wn-section${isKeys ? ' wn-section-keys' : ''}">
                <h4 class="wn-section-title">${title}</h4>
                <ul class="wn-list">
                    ${(items || []).map(({ badge, text, keys }) => {
                        if (isKeys) {
                            return `
                        <li class="wn-item wn-item-keys">
                            <span class="wn-keycap">${keys || ''}</span>
                            <span class="wn-item-text">${text}</span>
                        </li>
                    `;
                        }
                        const badgeLabel = badge === 'new'
                            ? wnTranslate('dashboard.whatsNewBadgeNew', 'new')
                            : wnTranslate('dashboard.whatsNewBadgeFix', 'fix');
                        return `
                        <li class="wn-item">
                            <span class="wn-badge ${badge === 'new' ? 'wn-badge-new' : 'wn-badge-fix'}">${badgeLabel}</span>
                            <span class="wn-item-text">${text}</span>
                        </li>
                    `;
                    }).join('')}
                </ul>
            </div>
        `;
        }).join('');
        return `
            <div class="wn-release">
                <div class="wn-release-header">
                    <span class="wn-release-tag">${tag}</span>
                    <span class="wn-release-date">${date}</span>
                </div>
                ${sectionsHtml}
            </div>
        `;
    }

    function buildFeatureLeadHtml(lead) {
        const text = String(lead || '').trim();
        if (!text) {
            return '';
        }
        return `
            <div class="wn-feature-lead" role="note">
                <p class="wn-feature-lead-text">${text}</p>
            </div>
        `;
    }

    function buildIntroHtml() {
        return `
            <div class="wn-intro">
                <p class="wn-intro-text">${wnTranslate('dashboard.whatsNewIntro', 'nextDash is a personal project I build and maintain in my spare time. — if you enjoy using it, a small contribution means a lot and helps keep the project going.')}</p>
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

    function buildTopRowHtml(featureLead) {
        const leadHtml = buildFeatureLeadHtml(featureLead);
        const introHtml = buildIntroHtml();
        if (!leadHtml) {
            return `<div class="wn-top-row wn-top-row--intro-only">${introHtml}</div>`;
        }
        return `
            <div class="wn-top-row">
                ${leadHtml}
                ${introHtml}
            </div>
        `;
    }

    function buildUpdateCheckHeaderHtml() {
        if (!updateCheckEnabled()) {
            return '';
        }
        return `
            <div class="wn-update-check-header" data-wn-update-check>
                <div class="wn-update-check-meta" data-wn-update-meta>
                    <p class="wn-update-check-status" id="wn-update-status-text" data-wn-update-status aria-live="polite"></p>
                </div>
                <button type="button" class="wn-update-check-btn" data-wn-update-check-btn aria-describedby="wn-update-status-text">${wnTranslate('config.updateCheckNow', 'Check for updates')}</button>
            </div>
        `;
    }

    function teardownWhatsNewUpdateCheckHeader() {
        document.querySelector('#app-modal .whats-new-modal [data-wn-update-check]')?.remove();
    }

    function mountWhatsNewUpdateCheckHeader() {
        teardownWhatsNewUpdateCheckHeader();
        if (!updateCheckEnabled()) {
            return;
        }
        const header = document.querySelector('#app-modal .whats-new-modal .modal-header');
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
        const btn = root.querySelector('[data-wn-update-check-btn]');
        if (!statusEl || !btn) return;

        const status = window.dashboardInstance?.updateStatus || null;
        const desc = describeModalUpdateStatus(status, checking);
        statusEl.textContent = desc.message || '';
        statusEl.className = `wn-update-check-status wn-update-check-status--${desc.tone || 'neutral'}`;
        statusEl.hidden = !desc.message;
        root.classList.toggle('wn-update-check-header--warn', desc.tone === 'warn');
        btn.disabled = Boolean(checking);
        btn.setAttribute('aria-busy', checking ? 'true' : 'false');
        if (desc.message) {
            btn.setAttribute('aria-describedby', 'wn-update-status-text');
        } else {
            btn.removeAttribute('aria-describedby');
        }
        btn.textContent = checking
            ? wnTranslate('config.updateCheckChecking', 'Checking GitHub…')
            : wnTranslate('config.updateCheckNow', 'Check for updates');

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
    }

    function setupUpdateCheckBar(checkRoot) {
        if (!checkRoot || !updateCheckEnabled()) return;
        const btn = checkRoot.querySelector('[data-wn-update-check-btn]');
        if (!btn || btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        syncWhatsNewUpdateBar(false);
        btn.addEventListener('click', () => {
            syncWhatsNewUpdateBar(true);
            window.nextdashRunUpdateCheck?.().finally(() => {
                syncWhatsNewUpdateBar(false);
            });
        });
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

    function buildTopRowSkeletonHtml() {
        return `
            <div class="wn-top-row wn-top-row--loading">
                <div class="wn-feature-lead wn-feature-lead--skeleton" aria-hidden="true">
                    <div class="wn-skeleton-line"></div>
                    <div class="wn-skeleton-line"></div>
                    <div class="wn-skeleton-line wn-skeleton-line--short"></div>
                </div>
                ${buildIntroHtml()}
            </div>
        `;
    }

    function buildSkeletonHtml() {
        return `
            <div class="wn-content wn-content--loading" aria-busy="true" aria-live="polite">
                ${buildTopRowSkeletonHtml()}
                <div class="wn-skeleton-stack" aria-hidden="true">
                    <div class="wn-skeleton-line"></div>
                    <div class="wn-skeleton-line"></div>
                    <div class="wn-skeleton-line wn-skeleton-line--short"></div>
                </div>
            </div>
        `;
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
                const tagDiff = b.tag.localeCompare(a.tag, undefined, { numeric: true });
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

    function getScrollRoot() {
        return document.querySelector('#app-modal .whats-new-modal .modal-body');
    }

    function isModalStillOpen() {
        return document.getElementById('app-modal')?.classList.contains('show') === true;
    }

    function buildScrollHintHtml(hiddenCount) {
        if (hiddenCount <= 0) return '';
        if (hiddenCount === 1) {
            return `<p class="wn-load-more-hint" data-wn-load-hint>${wnTranslate('dashboard.whatsNewScrollMoreOne', 'Scroll for 1 more release…')}</p>`;
        }
        return `<p class="wn-load-more-hint" data-wn-load-hint>${wnTranslate('dashboard.whatsNewScrollMoreMany', 'Scroll for {count} more releases…', { count: hiddenCount })}</p>`;
    }

    function buildShellHtml(manifestEntries, firstReleaseHtml, featureLead) {
        const hiddenCount = Math.max(0, manifestEntries.length - 1);
        const moreHtml = buildScrollHintHtml(hiddenCount);
        const sentinel = hiddenCount > 0
            ? '<div class="wn-lazy-sentinel" data-wn-sentinel aria-hidden="true"></div>'
            : '';
        return `
            <div class="wn-content" data-wn-content tabindex="-1">
                ${buildTopRowHtml(featureLead)}
                <div class="wn-releases-root" data-wn-releases-root>
                    ${firstReleaseHtml || ''}
                    ${moreHtml}
                    ${sentinel}
                </div>
            </div>
        `;
    }

    function appendReleaseHtml(releasesRoot, html, beforeNode) {
        const wrap = document.createElement('div');
        wrap.innerHTML = html.trim();
        const releaseEl = wrap.firstElementChild;
        if (releaseEl && beforeNode) {
            releasesRoot.insertBefore(releaseEl, beforeNode);
        } else if (releaseEl) {
            releasesRoot.appendChild(releaseEl);
        }
    }

    function showReleaseLoading(releasesRoot, beforeNode) {
        const el = document.createElement('div');
        el.className = 'wn-release-loading';
        el.setAttribute('data-wn-release-loading', 'true');
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = '<div class="wn-skeleton-line"></div><div class="wn-skeleton-line wn-skeleton-line--short"></div>';
        if (beforeNode) {
            releasesRoot.insertBefore(el, beforeNode);
        } else {
            releasesRoot.appendChild(el);
        }
        return el;
    }

    /** Same trigger distance as the IntersectionObserver's rootMargin below, checked manually. */
    const LAZY_TRIGGER_MARGIN_PX = 160;

    function isSentinelTriggered(sentinel, root) {
        if (!sentinel || !root) {
            return false;
        }
        const sRect = sentinel.getBoundingClientRect();
        const rRect = root.getBoundingClientRect();
        return sRect.top < rRect.bottom + LAZY_TRIGGER_MARGIN_PX
            && sRect.bottom > rRect.top - LAZY_TRIGGER_MARGIN_PX;
    }

    function setupLazyLoader(scrollRoot, releasesRoot, manifestEntries, sessionId) {
        teardownLazyLoader();

        if (!scrollRoot || !releasesRoot || manifestEntries.length <= 1) {
            return;
        }

        let nextIndex = 1;
        const sentinel = releasesRoot.querySelector('[data-wn-sentinel]');
        const hint = releasesRoot.querySelector('[data-wn-load-hint]');
        let loading = false;

        const loadNext = () => {
            if (sessionId !== modalSessionId || !isModalStillOpen()) {
                return Promise.resolve();
            }
            if (nextIndex >= manifestEntries.length) {
                teardownLazyLoader();
                sentinel?.remove();
                hint?.remove();
                return Promise.resolve();
            }
            if (loading) {
                return Promise.resolve();
            }
            loading = true;
            const entry = manifestEntries[nextIndex];
            const entryId = releaseId(entry);
            const placeholder = showReleaseLoading(releasesRoot, sentinel || null);

            return fetchRelease(entryId)
                .then((data) => {
                    placeholder.remove();
                    if (sessionId !== modalSessionId || !isModalStillOpen()) {
                        return;
                    }
                    appendReleaseHtml(releasesRoot, renderRelease(data), sentinel || null);
                    nextIndex += 1;
                    if (nextIndex >= manifestEntries.length) {
                        teardownLazyLoader();
                        sentinel?.remove();
                        hint?.remove();
                        return;
                    }
                    // A short release card can leave the sentinel inside the same trigger zone it
                    // was already in, so isIntersecting never crosses back to false and the
                    // IntersectionObserver has nothing to re-fire on. Check the geometry directly
                    // and keep the chain going instead of silently stalling until the next scroll.
                    // Reset `loading` first so the recursive call doesn't bail on its own guard.
                    if (isSentinelTriggered(sentinel, scrollRoot)) {
                        loading = false;
                        return loadNext();
                    }
                })
                .catch(() => {
                    placeholder.remove();
                    if (sessionId !== modalSessionId || !isModalStillOpen()) {
                        return;
                    }
                    const err = document.createElement('p');
                    err.className = 'wn-empty';
                    err.textContent = wnTranslate(
                        'dashboard.whatsNewReleaseLoadFailed',
                        'Could not load {tag}.',
                        { tag: entry.tag || entryId }
                    );
                    releasesRoot.insertBefore(err, sentinel || null);
                    nextIndex += 1;
                })
                .finally(() => {
                    loading = false;
                });
        };

        const loadAllRemaining = () => {
            const chain = () => loadNext().then(() => {
                if (nextIndex < manifestEntries.length && sessionId === modalSessionId) {
                    return chain();
                }
            });
            return chain();
        };

        if (typeof IntersectionObserver !== 'function' || !sentinel) {
            loadAllRemaining();
            return;
        }

        lazyObserver = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) {
                return;
            }
            loadNext();
        }, {
            root: scrollRoot,
            rootMargin: '160px 0px',
            threshold: 0,
        });
        lazyObserver.observe(sentinel);
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
            teardownLazyLoader();
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

        teardownLazyLoader();
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
                    textEl.innerHTML = buildShellHtml(visible, renderRelease(first), first.modalLead);
                    textEl.querySelector('.wn-content')?.removeAttribute('aria-busy');
                    const contentRoot = textEl.querySelector('[data-wn-content]');
                    if (contentRoot && typeof contentRoot.focus === 'function') {
                        contentRoot.focus({ preventScroll: true });
                    }

                    if (visible.length > 1) {
                        const scrollRoot = getScrollRoot();
                        const releasesRoot = textEl.querySelector('[data-wn-releases-root]');
                        setupLazyLoader(scrollRoot, releasesRoot, visible, sessionId);
                    }
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
