(function () {
    'use strict';

    const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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

    window.FocusTrapUtils = {
        getFocusableElements,
        trapTabKey,
        focusIfConnected,
    };
})();
