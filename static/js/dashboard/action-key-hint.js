/**
 * The key an action button answers to, shown on hover when the chips are off.
 *
 * "Show the key on each button" hides the chip, not the key: the keys keep
 * working, and a reader who switched the chips off to quiet the bar still has
 * to find out what a button's key is once. Resting on a button for a moment
 * brings up a small popover with that key; leaving, clicking, typing or
 * scrolling takes it away.
 *
 * The delay is what keeps it out of the way. A pointer passing over the bar on
 * its way somewhere else never waits long enough to raise it.
 */
(function (global) {
    'use strict';

    /** How long the pointer has to rest on a button, in milliseconds. */
    const DELAY = 250;
    /** Space between the button and the popover, in pixels. */
    const GAP = 8;
    const BUTTON = '.dashboard-section.section-controls .header-shortcuts .search-button';

    let timer = null;
    let hint = null;
    let current = null;

    const chipsOff = () => document.body.getAttribute('data-action-keys') === 'off';
    const place = () => document.body.getAttribute('data-action-bar') || 'header';

    function element() {
        if (hint) return hint;
        hint = document.createElement('div');
        hint.className = 'action-key-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.hidden = true;
        const kbd = document.createElement('kbd');
        hint.appendChild(kbd);
        document.body.appendChild(hint);
        return hint;
    }

    function hide() {
        clearTimeout(timer);
        timer = null;
        current = null;
        if (hint) hint.hidden = true;
    }

    /** Beside the button, on the side facing away from the edge the bar is on. */
    function position(el, button) {
        const r = button.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        let left;
        let top;
        switch (place()) {
            case 'bottom':
                left = r.left + r.width / 2 - w / 2;
                top = r.top - GAP - h;
                break;
            case 'left':
                left = r.right + GAP;
                top = r.top + r.height / 2 - h / 2;
                break;
            case 'right':
                left = r.left - GAP - w;
                top = r.top + r.height / 2 - h / 2;
                break;
            default:
                left = r.left + r.width / 2 - w / 2;
                top = r.bottom + GAP;
        }
        el.style.left = `${Math.round(Math.max(4, Math.min(left, vw - w - 4)))}px`;
        el.style.top = `${Math.round(Math.max(4, Math.min(top, vh - h - 4)))}px`;
    }

    function show(button) {
        const key = button.querySelector('.search-button-icon')?.textContent?.trim();
        if (!key || !chipsOff() || !button.isConnected) return;
        if (document.body.hasAttribute('data-action-bar-hidden')) return;
        const el = element();
        el.firstChild.textContent = key;
        el.hidden = false;
        position(el, button);
    }

    function onOver(event) {
        if (event.pointerType && event.pointerType !== 'mouse') return;
        const button = event.target.closest?.(BUTTON);
        if (!button || button === current) return;
        hide();
        if (!chipsOff()) return;
        current = button;
        timer = setTimeout(() => {
            timer = null;
            if (current === button && button.matches(':hover')) show(button);
        }, DELAY);
    }

    function onOut(event) {
        if (!current) return;
        // Moving between the button's own children is not leaving it.
        if (event.relatedTarget && current.contains(event.relatedTarget)) return;
        if (event.target.closest?.(BUTTON) === current) hide();
    }

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    global.addEventListener('scroll', hide, { passive: true, capture: true });
    global.addEventListener('blur', hide);

    global.ActionKeyHint = { hide };
})(window);
