(function () {
    'use strict';

    const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const DASHBOARD_INERT_SELECTORS = [
        '#dashboard-layout',
        '.button-container',
        '.section-controls',
        '.section-title',
    ];

    function getFocusableElements(root) {
        if (!root) {
            return [];
        }
        return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
            if (el.disabled) {
                return false;
            }
            return el.getAttribute('aria-hidden') !== 'true';
        });
    }

    function trapTabKey(event, root) {
        if (event.key !== 'Tab' || !root) {
            return false;
        }
        const focusable = getFocusableElements(root);
        if (focusable.length === 0) {
            return false;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!root.contains(active)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus({ preventScroll: true });
            return true;
        }
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus({ preventScroll: true });
            return true;
        }
        if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
            return true;
        }
        return false;
    }

    function focusIfConnected(element, fallback) {
        const target = element?.isConnected && typeof element.focus === 'function'
            ? element
            : (fallback?.isConnected && typeof fallback.focus === 'function' ? fallback : null);
        if (!target) {
            return false;
        }
        target.focus({ preventScroll: true });
        return true;
    }

    function isTagCloudModalOpen() {
        const modal = document.getElementById('tag-cloud-modal');
        return Boolean(modal && !modal.hidden);
    }

    function isPageOverviewOpen() {
        return document.getElementById('page-overview-overlay') != null;
    }

    function isOmniboxOpen() {
        return document.getElementById('omnibox-overlay') != null;
    }

    function shouldTrapDashboardBackground() {
        return document.getElementById('shortcut-search')?.classList.contains('show') === true
            || document.getElementById('app-modal')?.classList.contains('show') === true
            || isPageOverviewOpen()
            || isOmniboxOpen()
            || isTagCloudModalOpen();
    }

    function applyDashboardInert(active) {
        DASHBOARD_INERT_SELECTORS.forEach((selector) => {
            document.querySelectorAll(selector).forEach((el) => {
                if (active) {
                    el.setAttribute('inert', '');
                } else {
                    el.removeAttribute('inert');
                }
            });
        });
    }

    /** Sync inert from open search / app modal — safe to call repeatedly. */
    function syncDashboardInert() {
        applyDashboardInert(shouldTrapDashboardBackground());
    }

    /** @deprecated Use syncDashboardInert — trapped arg ignored; DOM is source of truth. */
    function setDashboardInert() {
        syncDashboardInert();
    }

    window.FocusTrapUtils = {
        getFocusableElements,
        trapTabKey,
        focusIfConnected,
        setDashboardInert,
        syncDashboardInert,
        shouldTrapDashboardBackground,
    };
})();
