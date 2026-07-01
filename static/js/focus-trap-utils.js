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

    function isMoveOrDeletePopoverOpen() {
        return document.getElementById('move-popover') != null
            || document.getElementById('delete-popover') != null
            || document.getElementById('tag-popover') != null;
    }

    function isDatePopoverOpen() {
        return document.getElementById('date-popover') != null;
    }

    function isInlineEditActive() {
        return document.body.classList.contains('bookmark-inline-edit-active');
    }

    function shouldTrapDashboardBackground() {
        return document.getElementById('shortcut-search')?.classList.contains('show') === true
            || document.getElementById('app-modal')?.classList.contains('show') === true
            || isPageOverviewOpen()
            || isOmniboxOpen()
            || isTagCloudModalOpen()
            || isMoveOrDeletePopoverOpen()
            || isDatePopoverOpen();
    }

    function getTagFilterViewBody() {
        const layout = document.getElementById('dashboard-layout');
        if (!layout?.classList.contains('tag-filter-view')) {
            return null;
        }
        return layout.querySelector('.tag-filter-view-body');
    }

    function applyDashboardInert(active) {
        const tagFilterBody = getTagFilterViewBody();
        const inertTagFilterBodyOnly = active && tagFilterBody;

        DASHBOARD_INERT_SELECTORS.forEach((selector) => {
            document.querySelectorAll(selector).forEach((el) => {
                if (selector === '#dashboard-layout' && inertTagFilterBodyOnly) {
                    el.removeAttribute('inert');
                    return;
                }
                if (active) {
                    el.setAttribute('inert', '');
                } else {
                    el.removeAttribute('inert');
                }
            });
        });

        if (inertTagFilterBodyOnly) {
            tagFilterBody.setAttribute('inert', '');
        } else if (tagFilterBody) {
            tagFilterBody.removeAttribute('inert');
        }
    }

    /** Sync inert from open search / app modal — safe to call repeatedly. */
    function syncDashboardInert() {
        applyDashboardInert(shouldTrapDashboardBackground());
    }

    let inertSyncScheduled = false;

    function scheduleSyncDashboardInert() {
        if (inertSyncScheduled) {
            return;
        }
        inertSyncScheduled = true;
        requestAnimationFrame(() => {
            inertSyncScheduled = false;
            syncDashboardInert();
        });
    }

    function initDashboardInertObserver() {
        if (typeof MutationObserver === 'undefined' || !document.body) {
            return;
        }
        const observer = new MutationObserver((mutations) => {
            const relevant = mutations.some((mutation) => {
                if (mutation.type === 'attributes') {
                    const id = mutation.target.id || '';
                    const cls = mutation.target.classList;
                    return id === 'shortcut-search' || id === 'app-modal' || id === 'tag-cloud-modal'
                        || id === 'move-popover' || id === 'delete-popover' || id === 'tag-popover'
                        || id === 'date-popover' || id === 'page-overview-overlay' || id === 'omnibox-overlay'
                        || (mutation.attributeName === 'class' && mutation.target === document.body);
                }
                if (mutation.type === 'childList') {
                    return Array.from(mutation.addedNodes).concat(Array.from(mutation.removedNodes)).some((node) => {
                        if (node.nodeType !== Node.ELEMENT_NODE) {
                            return false;
                        }
                        const el = /** @type {Element} */ (node);
                        const id = el.id || '';
                        return id === 'move-popover' || id === 'delete-popover' || id === 'tag-popover'
                            || id === 'date-popover' || id === 'page-overview-overlay' || id === 'omnibox-overlay'
                            || el.id === 'shortcut-search' || el.id === 'app-modal';
                    });
                }
                return false;
            });
            if (relevant) {
                scheduleSyncDashboardInert();
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'hidden'],
        });
    }

    /** @deprecated Use syncDashboardInert — trapped arg ignored; DOM is source of truth. */
    function setDashboardInert() {
        syncDashboardInert();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDashboardInertObserver);
    } else {
        initDashboardInertObserver();
    }

    window.FocusTrapUtils = {
        getFocusableElements,
        trapTabKey,
        focusIfConnected,
        setDashboardInert,
        syncDashboardInert,
        scheduleSyncDashboardInert,
        shouldTrapDashboardBackground,
    };
})();
