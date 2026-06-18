/**
 * One-time promos for desktop dashboard search (>, :, ?) and search filters.
 */
(function initDashboardSearchPromo(global) {
    const PROMO_KEYS = {
        search: 'nextdash:dashboard-search-promo-search-v2',
        command: 'nextdash:dashboard-search-promo-command-v1',
        finder: 'nextdash:dashboard-search-promo-finder-v1',
        filters: 'nextdash:dashboard-search-promo-filters-v1',
    };
    const PROMO_SHOW_DELAY_MS = 450;
    const PROMO_RETRY_DELAY_MS = 800;
    const CLICK_SHIELD_MS = 600;

    const PROMO_COPY = {
        search: {
            titleKey: 'searchPromoTitle',
            titleFallback: 'Search',
            bodyKey: 'searchPromoBody',
            bodyFallback: 'Find bookmarks on this page. Use <kbd>↑</kbd>/<kbd>↓</kbd> to move and <kbd>Enter</kbd> to open a match.',
        },
        command: {
            titleKey: 'searchCommandPromoTitle',
            titleFallback: 'Commands',
            bodyKey: 'searchCommandPromoBody',
            bodyFallback: 'Run quick actions from the keyboard. Type <kbd>:open last</kbd>, <kbd>:health</kbd>, or <kbd>:new</kbd> — pick a match with arrows and <kbd>Enter</kbd>.',
        },
        finder: {
            titleKey: 'searchFinderPromoTitle',
            titleFallback: 'Finders',
            bodyKey: 'searchFinderPromoBody',
            bodyFallback: 'Search the web via your finders. Type a shortcut and query, e.g. <kbd>?g cats</kbd>, then <kbd>Enter</kbd>.',
        },
        filters: {
            titleKey: 'searchFiltersPromoTitle',
            titleFallback: 'Search filters',
            bodyKey: 'searchFiltersPromoBody',
            bodyFallback: 'Narrow results with <kbd>tag:</kbd>, <kbd>category:</kbd>, <kbd>status:</kbd>, or <kbd>page:</kbd>. Prefix <kbd>@</kbd> to search all pages. Combine filters with free text.',
        },
    };

    let promoEl = null;
    let shownPromoKind = null;
    let promoShowTimer = null;
    let promoShowToken = 0;
    let pendingPromoRequest = null;
    let suppressUnderlyingClicksUntil = 0;
    let boundReposition = null;

    function readConfirmedFromStorage(kind) {
        try {
            return localStorage.getItem(PROMO_KEYS[kind]) === '1';
        } catch {
            return true;
        }
    }

    function markConfirmedInStorage(kind) {
        try {
            localStorage.setItem(PROMO_KEYS[kind], '1');
        } catch {
            // Ignore storage errors.
        }
    }

    function isPromoSuppressed(kind) {
        return !kind || readConfirmedFromStorage(kind);
    }

    function isAnyPromoSuppressed() {
        return Object.keys(PROMO_KEYS).every(isPromoSuppressed);
    }

    function shouldBlockUnderlyingClick() {
        return Date.now() < suppressUnderlyingClicksUntil;
    }

    function blockUnderlyingClicksBriefly() {
        suppressUnderlyingClicksUntil = Date.now() + CLICK_SHIELD_MS;
    }

    function isDesktopDiscoverability() {
        return global.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false;
    }

    function t(key, fallback) {
        const fullKey = `dashboard.${key}`;
        const value = global.dashboardInstance?.language?.t?.(fullKey);
        return value && value !== fullKey ? value : fallback;
    }

    function isFuzzyQuery(query) {
        const q = String(query || '');
        if (!q.startsWith('/')) return false;
        return global.dashboardInstance?.searchComponent?.interleaveMode === true;
    }

    function getPromoKind(query) {
        const q = String(query || '');
        if (q.startsWith(':')) return 'command';
        if (q.startsWith('?')) return 'finder';
        if (q.startsWith('@') || isFuzzyQuery(q)) return null;
        return 'search';
    }

    function hasSearchFilterPrefix(query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q || q.startsWith(':') || q.startsWith('?')) return false;
        if (q.startsWith('@')) return true;
        return q.split(/\s+/).some((token) => (
            token.startsWith('category:')
            || token.startsWith('status:')
            || token.startsWith('page:')
            || token.startsWith('tag:')
        ));
    }

    function isSearchPanelOpen() {
        return document.getElementById('shortcut-search')?.classList.contains('show') === true;
    }

    function isPromoDeferred() {
        if (document.body.classList.contains('loading')) return true;
        if (global.DashboardTagCloud?.modalOpen) return true;
        if (document.querySelector('.feature-spotlight.show')) return true;
        const overlay = document.getElementById('app-modal');
        if (overlay?.classList.contains('show')) return true;
        if (document.querySelector('.onboarding-overlay, .feature-tour-overlay')) return true;
        const searchOpen = isSearchPanelOpen();
        if (!searchOpen) {
            if (global.DashboardGridKeyboardPromo?.isPromoOpen?.()) return true;
            if (global.DashboardGJumpPromo?.isPromoOpen?.()) return true;
            if (global.DashboardSmartCollectionPromo?.isPromoOpen?.()) return true;
        }
        if (global.DashboardFeaturePromos?.isAnyOpen?.()) return true;
        const isVisibleTourCard = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return el.getBoundingClientRect().width > 8;
        };
        return [...document.querySelectorAll('[class$="-tour-card"], .onboarding-card, .feature-tour-card')]
            .some(isVisibleTourCard);
    }

    function dismissCompetingDiscoverabilityPromos() {
        global.DashboardGridKeyboardPromo?.dismissPopover?.();
        global.DashboardGJumpPromo?.dismissPopover?.();
        global.DashboardSmartCollectionPromo?.dismissPopover?.();
    }

    function getSearchContainer() {
        return document.querySelector('#shortcut-search .search-container');
    }

    function getSearchAnchorRect() {
        const container = getSearchContainer();
        if (!container) return null;
        const rect = container.getBoundingClientRect();
        if (rect.width < 1 && rect.height < 1) {
            return null;
        }
        return rect;
    }

    function unbindReposition() {
        if (!boundReposition) return;
        window.removeEventListener('scroll', boundReposition, true);
        window.removeEventListener('resize', boundReposition);
        boundReposition = null;
    }

    function removePromoFromDom() {
        unbindReposition();
        promoEl = null;
        shownPromoKind = null;
        document.querySelectorAll('.dashboard-search-promo').forEach((el) => el.remove());
        getSearchContainer()?.classList.remove('search-container--promo');
        document.querySelectorAll('.dashboard-search-promo-badge').forEach((el) => el.remove());
        document.querySelectorAll('.search-mode-tab--promo').forEach((el) => {
            el.classList.remove('search-mode-tab--promo');
        });
    }

    function cancelScheduledShow() {
        promoShowToken += 1;
        clearTimeout(promoShowTimer);
        promoShowTimer = null;
    }

    function stopPromoEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    function dismissPopover() {
        blockUnderlyingClicksBriefly();
        cancelScheduledShow();
        removePromoFromDom();
    }

    function confirmPromo(kind = shownPromoKind) {
        if (!kind || isPromoSuppressed(kind)) {
            dismissPopover();
            return;
        }
        blockUnderlyingClicksBriefly();
        markConfirmedInStorage(kind);
        cancelScheduledShow();
        removePromoFromDom();
    }

    function attachPromoButtonHandlers(wrap, kind) {
        const closeBtn = wrap.querySelector('.dashboard-search-promo-close');

        closeBtn?.addEventListener('mousedown', (event) => {
            stopPromoEvent(event);
        }, true);
        closeBtn?.addEventListener('click', (event) => {
            stopPromoEvent(event);
            confirmPromo(kind);
        }, true);
    }

    function buildPromoElement(kind) {
        const copy = PROMO_COPY[kind];
        const title = t(copy.titleKey, copy.titleFallback);
        const body = t(copy.bodyKey, copy.bodyFallback);
        const closeLabel = t('searchPromoDismiss', 'Got it');

        const wrap = document.createElement('div');
        wrap.className = `dashboard-search-promo dashboard-search-promo--${kind}`;
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'false');
        wrap.setAttribute('aria-label', title);
        wrap.innerHTML = `
            <div class="dashboard-search-promo-balloon">
                <span class="dashboard-search-promo-tail" aria-hidden="true"></span>
                <p class="dashboard-search-promo-title"></p>
                <div class="dashboard-search-promo-text"></div>
                <div class="dashboard-search-promo-actions">
                    <button type="button" class="dashboard-search-promo-close"></button>
                </div>
            </div>`;
        wrap.querySelector('.dashboard-search-promo-title').textContent = title;
        wrap.querySelector('.dashboard-search-promo-text').innerHTML = body;
        wrap.querySelector('.dashboard-search-promo-close').textContent = closeLabel;
        attachPromoButtonHandlers(wrap, kind);
        return wrap;
    }

    function addPromoBadge(container, kind) {
        const badgeText = t('searchPromoBadge', 'New');
        let anchor = null;

        if (kind === 'command' || kind === 'finder') {
            anchor = container.querySelector(`.search-mode-tab[data-mode="${kind}"]`);
        } else {
            anchor = container.querySelector('.search-prompt');
        }

        if (!anchor || anchor.querySelector('.dashboard-search-promo-badge')) {
            return;
        }

        if (anchor.classList.contains('search-mode-tab')) {
            anchor.classList.add('search-mode-tab--promo');
        } else {
            anchor.style.position = 'relative';
        }

        const badge = document.createElement('span');
        badge.className = 'dashboard-search-promo-badge';
        badge.textContent = badgeText;
        anchor.appendChild(badge);
    }

    function positionPromo() {
        if (!promoEl) return;

        const anchorRect = getSearchAnchorRect();
        if (!anchorRect) return;

        promoEl.style.visibility = 'hidden';
        promoEl.style.display = 'block';
        promoEl.style.right = 'auto';
        promoEl.style.bottom = 'auto';

        const balloon = promoEl.querySelector('.dashboard-search-promo-balloon');
        const balloonRect = balloon?.getBoundingClientRect();
        const initialWidth = balloonRect?.width || 280;
        const height = balloonRect?.height || 120;
        const placement = global.DashboardPromoPlacement.positionBesideAnchor(anchorRect, initialWidth, height);

        promoEl.style.width = `${Math.round(placement.width)}px`;
        promoEl.style.maxWidth = `${Math.round(placement.width)}px`;
        promoEl.classList.remove(
            'dashboard-search-promo--beside-right',
            'dashboard-search-promo--beside-left'
        );
        promoEl.classList.add(
            placement.placeRight
                ? 'dashboard-search-promo--beside-right'
                : 'dashboard-search-promo--beside-left'
        );
        promoEl.style.left = `${Math.round(placement.left)}px`;
        promoEl.style.top = `${Math.round(placement.top)}px`;
        promoEl.style.visibility = 'visible';
    }

    function bindReposition() {
        if (boundReposition) return;
        boundReposition = () => positionPromo();
        window.addEventListener('scroll', boundReposition, true);
        window.addEventListener('resize', boundReposition);
    }

    function showPromoNow(token, { query = '', kind } = {}) {
        const promoKind = kind || getPromoKind(query);
        if (!promoKind || token !== promoShowToken || isPromoSuppressed(promoKind)) return;
        if (!isDesktopDiscoverability()) return;

        if (isPromoDeferred()) {
            scheduleShow(PROMO_RETRY_DELAY_MS, { query, kind: promoKind });
            return;
        }

        const container = getSearchContainer();
        const searchRoot = document.getElementById('shortcut-search');
        if (!container || !searchRoot?.classList.contains('show')) {
            scheduleShow(PROMO_RETRY_DELAY_MS, { query, kind: promoKind });
            return;
        }
        if (token !== promoShowToken || isPromoSuppressed(promoKind)) return;
        if (promoKind === 'filters') {
            if (!hasSearchFilterPrefix(query)) return;
        } else if (getPromoKind(query) !== promoKind) {
            const liveQuery = global.dashboardInstance?.searchComponent?.currentQuery ?? query;
            scheduleShow(PROMO_RETRY_DELAY_MS, { query: liveQuery, kind: promoKind });
            return;
        }

        removePromoFromDom();
        container.classList.add('search-container--promo');
        addPromoBadge(container, promoKind);

        shownPromoKind = promoKind;
        pendingPromoRequest = null;
        promoEl = buildPromoElement(promoKind);
        document.body.appendChild(promoEl);
        bindReposition();

        const positionAfterLayout = () => {
            positionPromo();
            promoEl?.querySelector('.dashboard-search-promo-close')?.focus({ preventScroll: true });
        };
        requestAnimationFrame(() => requestAnimationFrame(() => {
            positionAfterLayout();
            setTimeout(positionAfterLayout, 400);
        }));
    }

    function scheduleShow(delayMs = PROMO_SHOW_DELAY_MS, { query = '', kind } = {}) {
        const promoKind = kind || getPromoKind(query);
        if (!promoKind || isPromoSuppressed(promoKind) || !isDesktopDiscoverability()) return;
        pendingPromoRequest = { query, kind: promoKind };
        clearTimeout(promoShowTimer);
        const token = promoShowToken;
        promoShowTimer = setTimeout(() => showPromoNow(token, { query, kind: promoKind }), delayMs);
    }

    function flushPendingPromoIfNeeded() {
        if (!pendingPromoRequest || !isSearchPanelOpen()) {
            return;
        }
        const { query, kind } = pendingPromoRequest;
        if (!kind || isPromoSuppressed(kind)) {
            pendingPromoRequest = null;
            return;
        }
        if (promoEl?.isConnected) {
            return;
        }
        scheduleShow(PROMO_SHOW_DELAY_MS, { query, kind });
    }

    function onSearchOpened({ query = '' } = {}) {
        dismissCompetingDiscoverabilityPromos();
        const kind = getPromoKind(query);
        if (!kind || isPromoSuppressed(kind) || !isDesktopDiscoverability()) return;
        scheduleShow(PROMO_SHOW_DELAY_MS, { query, kind });
    }

    function onSearchModeChanged({ query = '' } = {}) {
        dismissCompetingDiscoverabilityPromos();
        const kind = getPromoKind(query);
        cancelScheduledShow();
        removePromoFromDom();
        if (!kind || isPromoSuppressed(kind) || !isDesktopDiscoverability()) return;
        scheduleShow(PROMO_SHOW_DELAY_MS, { query, kind });
    }

    function onSearchClosed() {
        cancelScheduledShow();
        removePromoFromDom();
        pendingPromoRequest = null;
    }

    if (!global.__dashboardSearchPromoBlockerBound) {
        global.__dashboardSearchPromoBlockerBound = true;
        const observer = new MutationObserver(() => {
            if (!pendingPromoRequest || promoEl?.isConnected) {
                return;
            }
            if (!isSearchPanelOpen() || isPromoDeferred()) {
                return;
            }
            flushPendingPromoIfNeeded();
        });
        const startObserver = () => {
            const modal = document.getElementById('app-modal');
            if (modal) {
                observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
            }
            observer.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: false });
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserver, { once: true });
        } else {
            startObserver();
        }
    }

    function onSearchQueryStarted(query = '') {
        const q = String(query);
        const kind = getPromoKind(q);
        if (kind === 'command' && q.length <= 1) return;
        if (kind === 'finder' && q.length <= 1) return;
        if (shownPromoKind === 'filters') return;
        cancelScheduledShow();
        if (promoEl?.isConnected || document.querySelector('.dashboard-search-promo')) {
            dismissPopover();
        }
    }

    function onSearchFilterPrefixUsed(query = '') {
        const q = String(query);
        if (!hasSearchFilterPrefix(q)) return;
        if (!isPromoSuppressed('search') || isPromoSuppressed('filters') || !isDesktopDiscoverability()) return;
        if (q.startsWith(':') || q.startsWith('?')) return;
        if (shownPromoKind === 'filters' && (promoEl?.isConnected || promoShowTimer)) return;
        scheduleShow(PROMO_SHOW_DELAY_MS, { query: q, kind: 'filters' });
    }

    global.DashboardSearchPromo = {
        onSearchOpened,
        onSearchModeChanged,
        onSearchClosed,
        onSearchQueryStarted,
        onSearchFilterPrefixUsed,
        reposition: positionPromo,
        isPromoOpen() {
            return Boolean(promoEl?.isConnected || document.querySelector('.dashboard-search-promo'));
        },
        confirmPromo,
        dismissPopover,
        hasSeenPromo(kind) {
            return kind ? isPromoSuppressed(kind) : isAnyPromoSuppressed();
        },
        isPromoSuppressed,
        shouldBlockUnderlyingClick,
        dismissPromo: confirmPromo,
        dismissCompetingDiscoverabilityPromos,
        flushPendingPromoIfNeeded,
        isPromoDeferred,
        clearPromoSeen(kind) {
            cancelScheduledShow();
            removePromoFromDom();
            const kinds = kind ? [kind] : Object.keys(PROMO_KEYS);
            kinds.forEach((entry) => {
                try {
                    localStorage.removeItem(PROMO_KEYS[entry]);
                } catch {
                    // Ignore storage errors.
                }
            });
        },
    };
}(window));
