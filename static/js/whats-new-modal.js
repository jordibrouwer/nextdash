/**
 * What's new modal — manifest index + per-release JSON fetch on demand.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';
    const RELEASE_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;
    const MAX_VISIBLE_RELEASES = 5;

    let manifestCache = null;
    let manifestFetch = null;
    const releaseCache = new Map();
    const releaseFetches = new Map();
    let lazyObserver = null;
    let modalSessionId = 0;

    function getDataVersion() {
        return window.NEXTDASH_WHATS_NEW_DATA_VERSION || 'whats-new-v59';
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
        const sectionsHtml = sections.map(({ title, items }) => `
            <div class="wn-section">
                <h4 class="wn-section-title">${title}</h4>
                <ul class="wn-list">
                    ${items.map(({ badge, text }) => `
                        <li class="wn-item">
                            <span class="wn-badge ${badge === 'new' ? 'wn-badge-new' : 'wn-badge-fix'}">${badge}</span>
                            <span class="wn-item-text">${text}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `).join('');
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

    function buildIntroHtml() {
        return `
            <div class="wn-intro">
                <p class="wn-intro-text">nextDash is a personal project I build and maintain in my spare time. Every release takes many hours of design, coding and testing — if you enjoy using it, a small contribution means a lot and helps keep the project going.</p>
                <a class="wn-kofi-btn" href="https://ko-fi.com/Z8Z81Z2KIP" target="_blank" rel="noopener">
                    <svg class="wn-kofi-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 5.702 0 8.732c.483 4.918 3.919 5.023 6.782 5.139 2.81.114 3.325.12 3.325.12s.747.468 1.5.654a7.5 7.5 0 0 0 3.56-.468s5.698-1.094 7.035-5.7c.222-.778.35-1.574.35-2.373 0-.888-.098-1.83-.715-2.309zm-3.585 2.39c-.583 2.4-3.11 2.947-3.11 2.947l-1.8-.434c-.016-.003-.033.003-.043.016l-.847 1.067a.15.15 0 0 1-.265-.046l-.522-1.947a.15.15 0 0 0-.102-.107l-1.956-.517a.15.15 0 0 1-.046-.267l3.184-2.304c.016-.011.026-.03.024-.049l-.098-.832a2.617 2.617 0 0 1 2.602-2.944c1.444 0 2.618 1.174 2.618 2.618 0 .295-.049.582-.14.854l.501-.068s.564 1.006-.0 2.013z"/></svg>
                    Support me on Ko-fi
                </a>
            </div>
        `;
    }

    function buildSkeletonHtml() {
        return `
            <div class="wn-content wn-content--loading" aria-busy="true" aria-live="polite">
                ${buildIntroHtml()}
                <div class="wn-skeleton-stack" aria-hidden="true">
                    <div class="wn-skeleton-line"></div>
                    <div class="wn-skeleton-line"></div>
                    <div class="wn-skeleton-line wn-skeleton-line--short"></div>
                </div>
            </div>
        `;
    }

    function getVisibleManifest(manifest) {
        const cutoff = Date.now() - RELEASE_HISTORY_MS;
        return manifest
            .map((entry) => ({
                ...entry,
                releasedAtMs: Date.parse(`${entry.releasedAt}T12:00:00Z`),
            }))
            .filter((entry) => entry.releasedAtMs >= cutoff)
            .sort((a, b) => {
                const dateDiff = b.releasedAtMs - a.releasedAtMs;
                if (dateDiff !== 0) {
                    return dateDiff;
                }
                return b.tag.localeCompare(a.tag, undefined, { numeric: true });
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

    function buildShellHtml(manifestEntries, firstReleaseHtml) {
        const hiddenCount = Math.max(0, manifestEntries.length - 1);
        const moreHtml = hiddenCount > 0
            ? `<p class="wn-load-more-hint" data-wn-load-hint>Scroll for ${hiddenCount} more release${hiddenCount === 1 ? '' : 's'}…</p>`
            : '';
        const sentinel = hiddenCount > 0
            ? '<div class="wn-lazy-sentinel" data-wn-sentinel aria-hidden="true"></div>'
            : '';
        return `
            <div class="wn-content" data-wn-content>
                ${buildIntroHtml()}
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
            const placeholder = showReleaseLoading(releasesRoot, sentinel || null);

            return fetchRelease(entry.id)
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
                    }
                })
                .catch(() => {
                    placeholder.remove();
                    if (sessionId !== modalSessionId || !isModalStillOpen()) {
                        return;
                    }
                    const err = document.createElement('p');
                    err.className = 'wn-empty';
                    err.textContent = `Could not load ${entry.tag}.`;
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
        modalSessionId += 1;
        const sessionId = modalSessionId;

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
            try {
                if (localStorage.getItem(STORAGE_KEY) === releaseToken) {
                    onClose?.();
                    return Promise.resolve();
                }
            } catch {
                // Ignore localStorage failures.
            }
            if (typeof options.ifBlockingModalOpen === 'function' && options.ifBlockingModalOpen()) {
                onAbort?.();
                return Promise.resolve();
            }
        }

        const finish = () => {
            teardownLazyLoader();
            if (markSeenOnConfirm && releaseToken) {
                try {
                    localStorage.setItem(STORAGE_KEY, releaseToken);
                } catch {
                    // Ignore localStorage failures.
                }
            }
            onClose?.();
        };

        teardownLazyLoader();
        window.AppModal.show({
            title: "what's new",
            htmlMessage: buildSkeletonHtml(),
            confirmText: 'close',
            showCancel: false,
            modalMaxWidth: '640px',
            modalWidth: '96vw',
            modalClass: 'whats-new-modal',
            onConfirm: finish,
            onCancel: finish,
        });

        return fetchManifest()
            .then((manifest) => {
                if (!isModalStillOpen()) {
                    return;
                }
                const visible = getVisibleManifest(manifest);
                if (visible.length === 0) {
                    showEmptyMessage('No release notes in the last 7 days. See <strong>CHANGELOG.md</strong> in Config → Help.');
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
                    textEl.innerHTML = buildShellHtml(visible, renderRelease(first));
                    textEl.querySelector('.wn-content')?.removeAttribute('aria-busy');

                    if (visible.length > 1) {
                        const scrollRoot = getScrollRoot();
                        const releasesRoot = textEl.querySelector('[data-wn-releases-root]');
                        setupLazyLoader(scrollRoot, releasesRoot, visible, sessionId);
                    }
                });
            })
            .catch(() => {
                if (isModalStillOpen()) {
                    showEmptyMessage('Could not load release notes. Try again or see <strong>CHANGELOG.md</strong> in Config → Help.');
                }
            });
    };

    window.__whatsNewModalReady = true;
})();
