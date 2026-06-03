/**
 * Shared helpers for Config → * guided tours (card layering, AppModal, layout).
 */
(function () {
    'use strict';

    const TOUR_BACKDROP_ID = 'config-tour-backdrop';
    const TOUR_PORTAL_ID = 'config-tour-portal';
    const TOUR_CARD_Z = '2147483000';
    const TOUR_CARD_COMPANION_Z = '2147483200';
    const TOUR_BACKDROP_Z = '2147482000';
    const TOUR_QUICKADD_Z = '2147482800';
    const TOUR_MODAL_Z = '2147483100';

    function setTourLayersForAppModal(open) {
        const backdrop = document.getElementById(TOUR_BACKDROP_ID);
        if (backdrop) {
            /* Backdrop is visual/stacking only — never intercept clicks (tour card + guard handle that). */
            backdrop.style.pointerEvents = 'none';
            backdrop.style.zIndex = open ? '2147481990' : TOUR_BACKDROP_Z;
        }
        const modal = document.getElementById('app-modal');
        if (modal?.classList.contains('show')) {
            modal.style.zIndex = TOUR_MODAL_Z;
        }
    }

    function hasActiveConfigTour() {
        return document.body.getAttributeNames().some((name) => /^data-config-.+-tour-active$/.test(name));
    }

    function ensureTourBackdrop() {
        let backdrop = document.getElementById(TOUR_BACKDROP_ID);
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = TOUR_BACKDROP_ID;
            backdrop.className = 'config-tour-backdrop';
            backdrop.setAttribute('aria-hidden', 'true');
            backdrop.setAttribute('data-config-tour-backdrop', 'true');
            document.body.appendChild(backdrop);
        }
        backdrop.style.zIndex = TOUR_BACKDROP_Z;
        backdrop.style.pointerEvents = 'none';
        return backdrop;
    }

    /** Backdrop under the card; card must be the last fixed layer (except AppModal when open). */
    function syncTourLayering(card) {
        if (!card) {
            removeTourBackdropIfIdle();
            return;
        }
        const backdrop = ensureTourBackdrop();
        document.body.appendChild(backdrop);
        document.body.appendChild(card);
        card.style.setProperty('z-index', TOUR_CARD_Z, 'important');
        card.style.setProperty('pointer-events', 'auto', 'important');
        card.style.setProperty('visibility', 'visible', 'important');
    }

    function removeTourBackdropIfIdle() {
        if (hasActiveConfigTour()) {
            return;
        }
        document.getElementById(TOUR_BACKDROP_ID)?.remove();
    }

    function ensureTourPortal() {
        let portal = document.getElementById(TOUR_PORTAL_ID);
        if (!portal) {
            portal = document.createElement('div');
            portal.id = TOUR_PORTAL_ID;
            portal.setAttribute('data-config-tour-portal', 'true');
            portal.setAttribute('aria-hidden', 'true');
            document.body.appendChild(portal);
        }
        document.body.appendChild(portal);
        return portal;
    }

    function isCompanionLayoutActive() {
        return (
            document.body.classList.contains('guided-flow-companion-active') ||
            document.body.classList.contains('config-bookmarks-tour-interactive-modal')
        );
    }

    /** Quick-add (+) modal open: tour card on top, modal display-only, backdrop inert. */
    function syncCompanionLayering(card) {
        if (!card) return;
        card.setAttribute('data-config-tour-card', 'true');
        const backdrop = document.getElementById(TOUR_BACKDROP_ID);
        if (backdrop) {
            backdrop.style.pointerEvents = 'none';
            backdrop.style.zIndex = '2147482700';
        }
        const quickAdd = document.getElementById('new-bookmark-modal');
        if (quickAdd?.classList.contains('show')) {
            quickAdd.style.zIndex = TOUR_QUICKADD_Z;
            quickAdd.style.pointerEvents = 'none';
        }
        document.body.appendChild(card);
        card.style.setProperty('z-index', TOUR_CARD_COMPANION_Z, 'important');
        card.style.setProperty('pointer-events', 'auto', 'important');
        card.style.setProperty('visibility', 'visible', 'important');
        window.GuidedFlowGuard?.syncModalOpenClass?.();
    }

    function elevateTourCard(card) {
        if (!card) return;
        card.setAttribute('data-config-tour-card', 'true');
        if (isCompanionLayoutActive()) {
            syncCompanionLayering(card);
        } else {
            syncTourLayering(card);
        }
        window.GuidedFlowGuard?.syncModalOpenClass?.();
    }

    /** Re-append after tab switches / layout so the card stays topmost and clickable. */
    function reaffirmTourCard(card) {
        if (!card) return;
        elevateTourCard(card);
        window.requestAnimationFrame(() => {
            elevateTourCard(card);
        });
    }

    function removeTourPortalIfEmpty() {
        const portal = document.getElementById(TOUR_PORTAL_ID);
        if (portal && !portal.childElementCount) {
            portal.remove();
        }
    }

    function positionCardAtViewportBottom(tour) {
        const card = tour?.card;
        if (!card) return;
        card.classList.remove('is-docked');
        card.style.removeProperty('top');
        card.style.removeProperty('left');
        card.style.removeProperty('bottom');
        card.style.removeProperty('right');
        card.style.removeProperty('transform');
        elevateTourCard(card);
    }

    function isOversizedHighlight(element) {
        const rect = element?.getBoundingClientRect();
        if (!rect || rect.height < 1) return false;
        return (
            rect.height > window.innerHeight * 0.52 ||
            rect.width > window.innerWidth * 0.78
        );
    }

    /**
     * Prefer bottom placement for large panels so the card does not cover the highlight.
     */
    function applyCardPlacement(tour, element, step = {}) {
        if (!tour?.card) return;
        const placement = step.cardPlacement || 'auto';
        if (
            placement === 'viewport-bottom' ||
            (placement === 'auto' && isOversizedHighlight(element))
        ) {
            positionCardAtViewportBottom(tour);
            return;
        }
        if (typeof tour.positionCardNearTarget === 'function') {
            tour.positionCardNearTarget(element, step);
        }
    }

    async function withAppModal(fn) {
        window.GuidedFlowGuard?.syncModalOpenClass?.();
        setTourLayersForAppModal(true);
        try {
            return await fn();
        } finally {
            setTourLayersForAppModal(false);
            window.GuidedFlowGuard?.syncModalOpenClass?.();
            document.body.classList.remove('guided-flow-modal-open');
        }
    }

    window.ConfigTourRuntime = {
        ensureTourPortal,
        ensureTourBackdrop,
        syncTourLayering,
        removeTourBackdropIfIdle,
        setTourLayersForAppModal,
        syncCompanionLayering,
        isCompanionLayoutActive,
        elevateTourCard,
        reaffirmTourCard,
        removeTourPortalIfEmpty,
        positionCardAtViewportBottom,
        isOversizedHighlight,
        applyCardPlacement,
        withAppModal,
    };
})();
