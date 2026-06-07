/**
 * Blocks interaction outside guided-flow cards (tours, onboarding, spotlights)
 * while a flow is active. Tour-card controls work; AppModal dialogs opened during
 * a tour are fully interactive (consent, cleanup, etc.).
 */
(function () {
    'use strict';

    const BODY_LOCK_CLASS = 'guided-flow-locked';
    const BODY_MODAL_CLASS = 'guided-flow-modal-open';
    const BODY_COMPANION_CLASS = 'guided-flow-companion-active';
    const BOOKMARKS_COMPANION_CLASS = 'config-bookmarks-tour-interactive-modal';

    const TOUR_CARD_SELECTOR = '[data-config-tour-card], [class$="-tour-card"]';

    function findActiveTourCard() {
        return document.querySelector(
            '[data-config-tour-card], .config-bookmarks-tour-card, .config-tags-tour-card, .config-collections-tour-card, .config-pages-tour-card, .config-theme-tour-card, .config-categories-tour-card, .config-finders-tour-card, .config-stats-tour-card, [class$="-tour-card"]'
        );
    }

    function isConfigTabTourActive() {
        const attrs = document.body.getAttributeNames();
        for (let i = 0; i < attrs.length; i += 1) {
            if (/^data-config-.+-tour-active$/.test(attrs[i])) {
                return true;
            }
        }
        return false;
    }

    function isPointerOnTourCard(event) {
        const card = findActiveTourCard();
        if (!card) {
            return false;
        }

        let x = event.clientX;
        let y = event.clientY;
        if ((x == null || y == null) && event.touches?.[0]) {
            x = event.touches[0].clientX;
            y = event.touches[0].clientY;
        }
        if (typeof x !== 'number' || typeof y !== 'number') {
            return false;
        }

        const hit = document.elementFromPoint(x, y);
        if (hit instanceof Element && (hit === card || card.contains(hit))) {
            return true;
        }

        const rect = card.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
            return false;
        }
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    /** Roots that may receive interaction when no tour modal is open. */
    const CARD_ROOT_SELECTORS = [
        '.onboarding-card',
        '.feature-tour-card',
        '.post-setup-card',
        '.feature-spotlight',
        '[data-config-tour-card]',
        '[class$="-tour-card"]',
        '.modal.whats-new-modal',
    ];

    let mounted = false;
    let syncTimer = null;
    let observer = null;
    let appModalObserver = null;

    function isAppModalOpen() {
        const modal = document.getElementById('app-modal');
        return Boolean(modal?.classList.contains('show'));
    }

    function isPointerOnAppModal(event) {
        const modal = document.getElementById('app-modal');
        if (!modal?.classList.contains('show')) {
            return false;
        }
        let x = event.clientX;
        let y = event.clientY;
        if ((x == null || y == null) && event.touches?.[0]) {
            x = event.touches[0].clientX;
            y = event.touches[0].clientY;
        }
        if (typeof x !== 'number' || typeof y !== 'number') {
            return false;
        }
        const hit = document.elementFromPoint(x, y);
        return hit instanceof Element && Boolean(hit.closest('#app-modal'));
    }

    function isCompanionModeActive() {
        return (
            document.body.classList.contains(BODY_COMPANION_CLASS) ||
            (document.body.hasAttribute('data-config-bookmarks-tour-active') &&
                document.body.classList.contains(BOOKMARKS_COMPANION_CLASS))
        );
    }

    function syncModalOpenClass() {
        const appOpen = isAppModalOpen();
        if (!appOpen) {
            document.body.classList.remove(BODY_MODAL_CLASS);
            return;
        }
        /* Never hide the tour card while the quick-add companion modal is showing. */
        const open = mounted && !isCompanionModeActive();
        document.body.classList.toggle(BODY_MODAL_CLASS, open);
    }

    function watchAppModal() {
        const modal = document.getElementById('app-modal');
        if (!modal || appModalObserver) {
            return;
        }
        appModalObserver = new MutationObserver(() => {
            syncModalOpenClass();
        });
        appModalObserver.observe(modal, {
            attributes: true,
            attributeFilter: ['class'],
        });
    }

    function isTourCardElement(target) {
        return target instanceof Element && Boolean(target.closest(TOUR_CARD_SELECTOR));
    }

    /** True when #app-modal is visible — not the body class (can lag after close). */
    function isAppModalBlockingInteraction() {
        return isAppModalOpen();
    }

    function isAllowedTarget(target) {
        if (!(target instanceof Element)) {
            return false;
        }

        const onTourCard = isTourCardElement(target);
        const appModalBlocking = isAppModalBlockingInteraction();

        /* Tour card buttons must work whenever AppModal is not open. */
        if (onTourCard && !appModalBlocking) {
            return true;
        }

        /* AppModal confirm: only #app-modal. */
        if (appModalBlocking) {
            return Boolean(target.closest('#app-modal'));
        }

        /* Quick-add demo modal: only the tour card (modal is display-only). */
        if (isCompanionModeActive()) {
            return onTourCard;
        }

        for (let i = 0; i < CARD_ROOT_SELECTORS.length; i += 1) {
            if (target.closest(CARD_ROOT_SELECTORS[i])) {
                return true;
            }
        }
        return false;
    }

    function eventPathIncludesAllowed(event) {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (path.length) {
            for (let i = 0; i < path.length; i += 1) {
                if (path[i] instanceof Element && isAllowedTarget(path[i])) {
                    return true;
                }
            }
            return false;
        }
        return isAllowedTarget(event.target);
    }

    function detectActiveGuidedFlow() {
        if (document.body.hasAttribute('data-tour-active')) {
            return true;
        }
        if (document.querySelector('.onboarding-overlay, .onboarding-card')) {
            return true;
        }
        if (document.querySelector('.feature-tour-overlay, .feature-tour-card')) {
            return true;
        }
        if (document.querySelector('.post-setup-overlay, .post-setup-card')) {
            return true;
        }
        if (document.querySelector('.feature-spotlight')) {
            return true;
        }
        const attrs = document.body.getAttributeNames();
        for (let i = 0; i < attrs.length; i += 1) {
            if (/^data-config-.+-tour-active$/.test(attrs[i])) {
                return true;
            }
        }
        if (document.querySelector('[class$="-tour-card"]')) {
            return true;
        }
        return false;
    }

    function blockPointerEvent(event) {
        if (!mounted) {
            return;
        }
        /* Companion layout: CSS handles layering; do not intercept pointer events. */
        if (isCompanionModeActive()) {
            return;
        }

        const appModalBlocking = isAppModalBlockingInteraction();

        if (appModalBlocking && isPointerOnAppModal(event)) {
            return;
        }

        /* Tour card always receives clicks when AppModal is closed. */
        if (!appModalBlocking && (isPointerOnTourCard(event) || isTourCardElement(event.target))) {
            return;
        }

        /*
         * Config tab tours: page chrome is inert via CSS (#config-main, sticky bar, etc.).
         * Capture-phase JS blocking breaks tour-card clicks after tab switches / markDirty.
         */
        if (isConfigTabTourActive() && !appModalBlocking) {
            return;
        }

        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (event.type === 'wheel' && event.ctrlKey) {
            return;
        }
        if (eventPathIncludesAllowed(event)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }
    }

    function focusFirstAppModalControl() {
        const modal = document.getElementById('app-modal');
        if (!modal?.classList.contains('show')) {
            return;
        }
        const focusable = modal.querySelector(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable && typeof focusable.focus === 'function') {
            try {
                focusable.focus({ preventScroll: true });
            } catch {
                focusable.focus();
            }
        }
    }

    function blockFocusIn(event) {
        if (!mounted) {
            return;
        }
        if (isCompanionModeActive()) {
            return;
        }
        if (isTourCardElement(event.target) && !isAppModalBlockingInteraction()) {
            return;
        }
        if (isConfigTabTourActive() && !isAppModalBlockingInteraction()) {
            return;
        }
        if (isAllowedTarget(event.target)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (isAppModalBlockingInteraction()) {
            focusFirstAppModalControl();
            return;
        }
        const focusRoot =
            document.querySelector('[data-config-tour-card], [class$="-tour-card"]') ||
            document.querySelector('.onboarding-card, .feature-tour-card, .post-setup-card, .feature-spotlight');
        const primary =
            focusRoot?.querySelector(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ) || focusRoot;
        if (primary && typeof primary.focus === 'function') {
            try {
                primary.focus({ preventScroll: true });
            } catch {
                primary.focus();
            }
        }
    }

    function blockKeydown(event) {
        if (!mounted) {
            return;
        }
        if (isCompanionModeActive()) {
            return;
        }
        if (event.key === 'Escape') {
            return;
        }
        if (isConfigTabTourActive() && !isAppModalBlockingInteraction()) {
            if (isAllowedTarget(event.target) || isAllowedTarget(document.activeElement)) {
                return;
            }
        }
        if (isAllowedTarget(event.target) || isAllowedTarget(document.activeElement)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }
    }

    const POINTER_EVENTS = [
        'pointerdown',
        'mousedown',
        'touchstart',
        'contextmenu',
        'wheel',
    ];

    const captureOpts = { capture: true, passive: false };

    const pointerHandlers = POINTER_EVENTS.map((type) => {
        const fn = blockPointerEvent;
        return { type, fn };
    });

    const focusHandler = blockFocusIn;
    const keyHandler = blockKeydown;

    function mount() {
        if (mounted) {
            syncModalOpenClass();
            return;
        }
        mounted = true;
        document.body.classList.add(BODY_LOCK_CLASS);
        watchAppModal();
        syncModalOpenClass();
        pointerHandlers.forEach(({ type, fn }) => {
            document.addEventListener(type, fn, captureOpts);
        });
        document.addEventListener('focusin', focusHandler, captureOpts);
        document.addEventListener('keydown', keyHandler, captureOpts);
    }

    function unmount() {
        if (!mounted) {
            return;
        }
        mounted = false;
        document.body.classList.remove(BODY_LOCK_CLASS, BODY_MODAL_CLASS, BODY_COMPANION_CLASS);
        pointerHandlers.forEach(({ type, fn }) => {
            document.removeEventListener(type, fn, captureOpts);
        });
        document.removeEventListener('focusin', focusHandler, captureOpts);
        document.removeEventListener('keydown', keyHandler, captureOpts);
    }

    function syncState() {
        if (detectActiveGuidedFlow()) {
            mount();
        } else {
            unmount();
        }
    }

    function scheduleSync() {
        watchAppModal();
        if (syncTimer != null) {
            return;
        }
        syncTimer = window.setTimeout(() => {
            syncTimer = null;
            syncState();
        }, 0);
    }

    function startObserver() {
        if (observer) {
            return;
        }
        observer = new MutationObserver(scheduleSync);
        observer.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
        });
        watchAppModal();
    }

    function enterCompanionMode() {
        document.body.classList.add(BODY_COMPANION_CLASS);
        syncModalOpenClass();
    }

    function leaveCompanionMode() {
        document.body.classList.remove(BODY_COMPANION_CLASS);
        syncModalOpenClass();
    }

    window.GuidedFlowGuard = {
        isActive: () => mounted,
        isModalOpen: isAppModalOpen,
        isCompanionMode: isCompanionModeActive,
        enterCompanionMode,
        leaveCompanionMode,
        sync: syncState,
        syncModalOpenClass,
        _isAllowedTarget: isAllowedTarget,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            startObserver();
            syncState();
        });
    } else {
        startObserver();
        syncState();
    }
})();
