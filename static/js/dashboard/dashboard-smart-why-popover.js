/**
 * Fixed-position tooltip for smart-collection ℹ hints (escapes column stacking/overflow).
 */
(function () {
    let popoverEl = null;
    let hideTimer = null;
    let repositionHandler = null;

    function ensurePopover() {
        if (popoverEl) {
            return popoverEl;
        }
        popoverEl = document.createElement('div');
        popoverEl.className = 'smart-collection-why-popover';
        popoverEl.setAttribute('role', 'tooltip');
        popoverEl.hidden = true;
        document.body.appendChild(popoverEl);
        return popoverEl;
    }

    function positionPopover(btn) {
        const el = ensurePopover();
        const margin = 8;
        const maxW = Math.min(352, window.innerWidth - margin * 2);
        const rect = btn.getBoundingClientRect();
        const left = Math.min(Math.max(margin, rect.left), window.innerWidth - margin - maxW);

        el.style.maxWidth = `${maxW}px`;
        el.style.left = `${left}px`;
        el.style.top = `${rect.bottom + 6}px`;
        el.hidden = false;

        const popRect = el.getBoundingClientRect();
        if (popRect.bottom > window.innerHeight - margin) {
            el.style.top = `${Math.max(margin, rect.top - popRect.height - 6)}px`;
        }
    }

    function unbindReposition() {
        if (!repositionHandler) {
            return;
        }
        window.removeEventListener('scroll', repositionHandler, true);
        window.removeEventListener('resize', repositionHandler);
        repositionHandler = null;
    }

    function bindReposition(btn) {
        unbindReposition();
        repositionHandler = () => positionPopover(btn);
        window.addEventListener('scroll', repositionHandler, true);
        window.addEventListener('resize', repositionHandler);
    }

    function show(btn, text) {
        clearTimeout(hideTimer);
        const el = ensurePopover();
        el.textContent = text;
        positionPopover(btn);
        bindReposition(btn);
    }

    function hide() {
        hideTimer = setTimeout(() => {
            if (popoverEl) {
                popoverEl.hidden = true;
            }
            unbindReposition();
        }, 80);
    }

    function hideImmediate() {
        clearTimeout(hideTimer);
        if (popoverEl) {
            popoverEl.hidden = true;
        }
        unbindReposition();
    }

    function attach(btn, text) {
        if (!btn || !text) {
            return;
        }
        btn.removeAttribute('data-tooltip');
        btn.addEventListener('mouseenter', () => show(btn, text));
        btn.addEventListener('mouseleave', hide);
        btn.addEventListener('focus', () => show(btn, text));
        btn.addEventListener('blur', hide);
    }

    window.DashboardSmartWhyPopover = {
        attach,
        hide: hideImmediate,
    };
})();
