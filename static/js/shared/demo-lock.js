/**
 * What the public demo keeps out of reach, and the one explanation for it.
 *
 * The demo checks no website: availability checks, monitoring and feed
 * polling would let any visitor make the server knock on any address, over
 * and over. The settings stay on screen, so a visitor sees what nextDash can
 * do, but they cannot be changed. The server refuses them as well (demo.go);
 * this is only what the visitor sees.
 *
 * DemoLock.on is read from a meta tag the server writes in demo mode, so
 * nothing changes outside the demo.
 */
(function (global) {
    'use strict';

    const on = !!document.querySelector('meta[name="nextdash-demo"]');
    const POPOVER_ID = 'demo-lock-popover';
    // The availability radio groups: the add form and Config's editor share one
    // markup, the dashboard's inline form has its own.
    const CHECK_MODE_INPUTS = '.bookmark-detail-checkmode-input, .bookmark-inline-checkmode-input';

    function t(key, fallback) {
        const lang = global.dashboardInstance?.language;
        const full = `demo.${key}`;
        const value = lang?.t?.(full);
        return value && value !== full ? value : fallback;
    }

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function text() {
        return t('checksLocked',
            'The demo checks no website. Anyone could otherwise make this server knock on any address, again and again. In your own install these settings are yours to change.');
    }

    /** The shared popover, made the first time it is asked for. */
    function popover() {
        let el = document.getElementById(POPOVER_ID);
        if (el) return el;
        el = document.createElement('div');
        el.id = POPOVER_ID;
        el.className = 'demo-lock-popover';
        el.setAttribute('popover', '');
        el.innerHTML = `<p class="demo-lock-popover-title">${esc(t('lockedTitle', 'Locked in the demo'))}</p>
            <p class="demo-lock-popover-text">${esc(text())}</p>`;
        document.body.appendChild(el);
        return el;
    }

    /** Show the explanation. */
    function explain() {
        const el = popover();
        try {
            if (typeof el.showPopover === 'function') {
                if (!el.matches(':popover-open')) el.showPopover();
                return;
            }
        } catch { /* fall through to the modal */ }
        global.AppModal?.alert?.({
            title: t('lockedTitle', 'Locked in the demo'),
            htmlMessage: esc(text()),
            confirmText: t('gotIt', 'Got it'),
        });
    }

    /** The chip beside a locked panel's title; a click opens the explanation. */
    function chip() {
        popover();
        return `<button type="button" class="demo-lock-chip" popovertarget="${POPOVER_ID}"
            title="${esc(text())}">${esc(t('lockedChip', 'Locked in the demo'))}</button>`;
    }

    if (on) {
        document.documentElement.dataset.demo = '1';
        // The explanation belongs to the view it was opened from.
        global.addEventListener('hashchange', () => {
            const el = document.getElementById(POPOVER_ID);
            try { if (el?.matches(':popover-open')) el.hidePopover(); } catch { /* not open */ }
        });
        /*
         * The availability check in the add and edit forms: choosing Periodic
         * or Monitor goes back to Off, with the reason. One listener for every
         * form that draws the shared radio group.
         */
        document.addEventListener('change', (event) => {
            const input = event.target;
            if (!input?.matches?.(CHECK_MODE_INPUTS) || input.value === 'off') return;
            // The form never hears of Periodic: it hears Off instead.
            event.stopImmediatePropagation();
            const off = document.querySelector(`input[name="${CSS.escape(input.name)}"][value="off"]`);
            if (off) {
                off.checked = true;
                off.dispatchEvent(new Event('change', { bubbles: true }));
            }
            explain();
        }, true);
    }

    global.DemoLock = { on, explain, chip, text };
})(window);
