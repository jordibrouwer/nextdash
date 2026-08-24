/**
 * A sentence about a control, shown only when it is asked for.
 *
 * The bookmark form explained three of its controls with text that was always
 * on screen: a line under the Pinned pill, a label and a description above and
 * below the availability pills, and a warning under Shortcut that appeared
 * mid-typing and pushed the fields below it down. All three are read once and
 * then never again, so they cost the form permanent height for a first-visit
 * benefit — and the shortcut warning moved the form under the reader's hands.
 *
 * Here they are a bubble instead: on hover, on focus, and on tap, anchored to
 * the control they describe. One element for the whole page, fixed-positioned
 * so a modal's own scrolling cannot clip it, and flipped above the anchor when
 * there is no room below.
 *
 * The text stays reachable without pointing at anything: `attach` also hangs an
 * `sr-only` copy off the control and points `aria-describedby` at it, so a
 * screen reader has the sentence whether or not the bubble is open.
 */
(function () {
    'use strict';

    const GAP = 8;
    let bubble = null;
    let openFor = null;
    let hideTimer = null;

    function ensureBubble() {
        if (bubble?.isConnected) return bubble;
        bubble = document.createElement('div');
        bubble.className = 'field-popover';
        bubble.setAttribute('role', 'tooltip');
        bubble.hidden = true;
        document.body.appendChild(bubble);
        return bubble;
    }

    function place(anchor) {
        const el = ensureBubble();
        const a = anchor.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        // Below the anchor by default; above it when the window has no room,
        // which is the common case for a control near the foot of a dialog.
        let top = a.bottom + GAP;
        if (top + b.height > window.innerHeight - 4) {
            top = Math.max(4, a.top - b.height - GAP);
        }
        let left = a.left;
        if (left + b.width > window.innerWidth - 4) {
            left = Math.max(4, window.innerWidth - b.width - 4);
        }
        el.style.top = `${Math.round(top)}px`;
        el.style.left = `${Math.round(left)}px`;
    }

    function show(anchor, text, { variant = '' } = {}) {
        const message = String(text || '').trim();
        if (!anchor || !message) return;
        clearTimeout(hideTimer);
        const el = ensureBubble();
        el.textContent = message;
        el.classList.toggle('field-popover-warning', variant === 'warning');
        el.hidden = false;
        openFor = anchor;
        // Measure with the text in place, then position: the height decides
        // whether it goes above or below.
        place(anchor);
    }

    function hide(anchor) {
        if (anchor && openFor && anchor !== openFor) return;
        clearTimeout(hideTimer);
        if (bubble) {
            bubble.hidden = true;
            bubble.textContent = '';
        }
        openFor = null;
    }

    /** Hide after a beat, so moving between a control and its bubble is fine. */
    function scheduleHide(anchor) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => hide(anchor), 120);
    }

    /**
     * Attach the bubble to one control.
     *
     * `getText` is called each time rather than once, so a description that
     * follows the control's own state — the chosen availability mode, say —
     * says what is true now.
     */
    function attach(trigger, getText, { describes = null, variant = '', describe = true } = {}) {
        if (!trigger || typeof getText !== 'function') return;
        const text = () => String(getText() || '').trim();
        // A variant can depend on state too: the shortcut field's bubble is a
        // warning for a clash and a plain note for a key the grid also uses.
        const kind = () => (typeof variant === 'function' ? variant() : variant);

        if (describe) {
            const target = describes || trigger;
            const hostId = `field-popover-desc-${Math.random().toString(36).slice(2, 10)}`;
            const host = document.createElement('span');
            host.id = hostId;
            host.className = 'sr-only';
            host.textContent = text();
            // Beside the control, never inside it: half of what this is attached
            // to is an <input>, which cannot hold a child at all.
            (target.parentNode || document.body).insertBefore(host, target.nextSibling);
            const described = target.getAttribute('aria-describedby');
            target.setAttribute('aria-describedby', described ? `${described} ${hostId}` : hostId);
            trigger._fieldPopoverSyncDescription = () => { host.textContent = text(); };
        }

        trigger.addEventListener('mouseenter', () => show(trigger, text(), { variant: kind() }));
        trigger.addEventListener('mouseleave', () => scheduleHide(trigger));
        trigger.addEventListener('focus', () => show(trigger, text(), { variant: kind() }));
        trigger.addEventListener('blur', () => hide(trigger));
        // Touch has no hover: a tap on the control opens the bubble, and the
        // next tap anywhere closes it.
        trigger.addEventListener('click', () => {
            if (openFor === trigger) hide(trigger);
            else show(trigger, text(), { variant: kind() });
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openFor) hide();
    }, true);
    document.addEventListener('pointerdown', (e) => {
        if (openFor && !openFor.contains(e.target)) hide();
    }, true);
    // A bubble is anchored to a rectangle that scrolling moves out from under it.
    window.addEventListener('scroll', () => hide(), true);
    window.addEventListener('resize', () => hide());

    window.FieldPopover = { attach, show, hide };
})();
