/**
 * A docked action bar that slides into its edge and comes back.
 *
 * Docked on the left, the right or the bottom, the bar stands over the page
 * margin -- and at some widths over the config rail or the first column. With
 * a delay set it slides into the edge it is docked on once the reader leaves
 * it alone, and comes back when the pointer touches that edge beside it, when
 * focus moves into it, or on ' / Shift+O. In the header or behind the menu
 * nothing slides: the bar is part of the band there.
 *
 * Brought back by ' / Shift+O it stays: the reader asked for it with a key and
 * may be about to use it with the keys, so no timer runs. It goes when the key
 * is pressed again, or when the pointer has been over the bar and leaves it --
 * which hands the bar back to the delay, as if the edge had called it.
 *
 * State lives on <body> as data-action-bar-hidden, so the slide itself is CSS
 * and reduced motion is handled where every other animation is.
 *
 * While the bar is away a small handle stands on that edge, so the place it
 * comes back from is visible. It grows as the pointer comes near -- the
 * nearness is --edge-proximity, 0 to 1, on the handle -- and a click on it
 * brings the bar back for anyone who misses the edge itself.
 *
 * With actionBarIntro on, its buttons swell past their size and settle back,
 * one after the other, whenever the bar comes into view: after a load -- in
 * any place, once nothing else (a modal, a card, a tour) holds the screen --
 * and each time it comes back from the edge it slid into.
 */
(function (global) {
    'use strict';

    const DOCKS = ['bottom', 'left', 'right'];
    /** How close to the edge the pointer has to come, in pixels. */
    const EDGE = 6;
    /** How far past the ends of the bar the edge still counts. */
    const SLACK = 24;
    /** From how far away the handle starts to grow, in pixels. */
    const NEAR = 340;
    /** How long after the load the intro waits for pending release notes. */
    const WHATS_NEW_GRACE_MS = 4000;

    let timer = null;
    let hidden = false;
    /** Called by a key: stays until the key again, or the pointer passes over and leaves. */
    let pinned = false;
    let bound = false;
    let frame = 0;
    let handle = null;
    let introPlayed = false;
    let introWaiter = null;
    let introTimer = null;

    const settings = () => global.dashboardInstance?.settings || {};
    const place = () => document.body.getAttribute('data-action-bar') || 'header';
    const docked = () => DOCKS.includes(place());
    const enabled = () => settings().actionBarEnabled !== false;
    const seconds = () => Number(settings().actionBarAutoHideSeconds) || 0;
    const bar = () => document.querySelector('.dashboard-section.section-controls .header-shortcuts');
    // No hover on a touch screen, so nothing would ever bring the bar back.
    const introOn = () => settings().actionBarIntro === true;
    const touchOnly = () => global.matchMedia?.('(hover: none)').matches === true;

    /** The handle on the edge; drawn only while the bar is away (CSS). */
    function edgeHandle() {
        if (handle) return handle;
        handle = document.createElement('div');
        handle.className = 'action-bar-edge-handle';
        // The keys and the edge already bring the bar back; this is a picture
        // of where, not a control of its own.
        handle.setAttribute('aria-hidden', 'true');
        handle.addEventListener('click', () => show());
        document.body.appendChild(handle);
        return handle;
    }

    function setHidden(value) {
        hidden = value;
        edgeHandle().style.setProperty('--edge-proximity', '0');
        document.body.toggleAttribute('data-action-bar-hidden', value);
        const el = bar();
        if (el) {
            // Out of view is out of the tab order and the accessibility tree.
            if (value) el.setAttribute('inert', '');
            else el.removeAttribute('inert');
        }
    }

    /** The reader is using the bar: over it, in it, or in a menu it opened. */
    function inUse() {
        const el = bar();
        if (!el) return false;
        return el.matches(':hover')
            || el.contains(document.activeElement)
            || Boolean(el.querySelector('[aria-expanded="true"]'));
    }

    function arm() {
        clearTimeout(timer);
        timer = null;
        const wait = seconds();
        if (pinned || !wait || !docked() || !enabled() || touchOnly()) return;
        timer = setTimeout(() => {
            timer = null;
            if (inUse()) {
                arm();
                return;
            }
            setHidden(true);
        }, wait * 1000);
    }

    function show() {
        if (hidden) {
            setHidden(false);
            if (screenIsFree()) playIntro();
        }
        arm();
    }

    /** Nothing else has the screen: no modal, card, tour or onboarding. */
    function screenIsFree() {
        const d = global.dashboardInstance;
        if (!d?.settings) return false;
        if (document.visibilityState === 'hidden') return false;
        if (d.settings.onboardingCompleted === false || d.onboardingStartedInSession) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        // The release notes open about a second after the load. Give them that
        // long to arrive rather than playing just before they cover the bar;
        // not forever, since a browser new to nextDash is never shown them.
        if (performance.now() < WHATS_NEW_GRACE_MS && !global.DemoLock?.on
            && d.promos?.shouldShowWhatsNewPrompt?.()) return false;
        if (global.ScrollLock?.isLocked?.()) return false;
        if (document.querySelector('.quickstart-card')) return false;
        // The release notes' shell can stay in the DOM once closed.
        if (document.querySelector('.whats-new-modal')?.offsetParent) return false;
        const cls = document.body.classList;
        return !cls.contains('is-block-move-intro')
            && !cls.contains('changes-tour-peeking')
            && !cls.contains('bookmark-inline-edit-active');
    }

    /** The buttons the reader sees, in the order they stand on screen. */
    function visibleButtons(el) {
        return [...el.querySelectorAll('button')]
            .filter((b) => !b.closest('[role="menu"]') && b.getClientRects().length > 0)
            .map((b) => ({ b, r: b.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && r.height > 0)
            .sort((p, q) => (p.r.top - q.r.top) || (p.r.left - q.r.left))
            .map(({ b }) => b);
    }

    /** Each button swells past its size and settles back, one after the other. */
    function playIntro() {
        const el = bar();
        if (!el || !introOn() || !enabled() || place() === 'menu' || hidden) return;
        const buttons = visibleButtons(el);
        if (!buttons.length) return;
        // Back from the edge before the load's turn came: that was the load's one.
        introPlayed = true;
        introWaiter?.();
        clearTimeout(introTimer);
        const clear = () => {
            el.querySelectorAll('.action-bar-intro').forEach((b) => {
                b.classList.remove('action-bar-intro');
                b.style.removeProperty('--intro-index');
            });
        };
        clear();
        void el.offsetWidth;
        buttons.forEach((b, i) => {
            b.style.setProperty('--intro-index', String(i));
            b.classList.add('action-bar-intro');
        });
        // 1100 ms each, 70 ms apart (dashboard.css), and a little to spare.
        introTimer = setTimeout(clear, 1100 + buttons.length * 70 + 200);
    }

    /** After a load: now if the screen is free, else when it comes free. */
    function introOnLoad() {
        if (introPlayed || introWaiter || !introOn()) return;
        const attempt = () => {
            // A bar that can never play it (switched off, or in the menu)
            // stops the wait: the watch below ran for the whole session.
            if (introPlayed || !introOn() || place() === 'menu') {
                stopWaiting();
                return false;
            }
            if (hidden || !screenIsFree() || !bar()?.getClientRects().length) return false;
            playIntro();
            return true;
        };
        let frame = 0;
        const check = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => { frame = 0; attempt(); });
        };
        const observer = new MutationObserver(check);
        // Modals, cards and locks all show on <body>: children come and go,
        // classes and the scroll lock's style change.
        observer.observe(document.body, { childList: true, attributes: true });
        const poll = setInterval(check, 1000);
        document.addEventListener('visibilitychange', check);
        // An intro is for the moment the page arrives; a screen that is not
        // free within two minutes has moved on without it.
        const giveUp = setTimeout(() => stopWaiting(), 120000);
        function stopWaiting() {
            observer.disconnect();
            clearInterval(poll);
            clearTimeout(giveUp);
            document.removeEventListener('visibilitychange', check);
            introWaiter = null;
        }
        introWaiter = stopWaiting;
        // Two frames: the settings have just been applied, let the bar lay out.
        requestAnimationFrame(() => requestAnimationFrame(check));
    }

    /** Is the pointer on the edge the bar is docked to, beside the bar? */
    function atEdge(x, y) {
        const el = bar();
        if (!el) return false;
        const r = el.getBoundingClientRect();
        // The page's own width, not the window's: a classic scrollbar stands
        // between the two, and the page hears no pointer over it -- so the
        // right edge measured from innerWidth could never be reached.
        const { clientWidth: width, clientHeight: height } = document.documentElement;
        switch (place()) {
            case 'left':
                return x <= EDGE && y >= r.top - SLACK && y <= r.bottom + SLACK;
            case 'right':
                return x >= width - EDGE && y >= r.top - SLACK && y <= r.bottom + SLACK;
            case 'bottom':
                return y >= height - EDGE && x >= r.left - SLACK && x <= r.right + SLACK;
            default:
                return false;
        }
    }

    /** How close the pointer is to the docked edge: 0 far away, 1 on it. */
    function nearness(x, y) {
        const { clientWidth: width, clientHeight: height } = document.documentElement;
        let distance;
        switch (place()) {
            case 'left': distance = x; break;
            case 'right': distance = width - x; break;
            case 'bottom': distance = height - y; break;
            default: return 0;
        }
        return Math.max(0, Math.min(1, 1 - distance / NEAR));
    }

    function onPointerMove(e) {
        if (!hidden || frame) return;
        const { clientX: x, clientY: y } = e;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (!hidden || !docked()) return;
            if (atEdge(x, y)) {
                show();
                return;
            }
            edgeHandle().style.setProperty('--edge-proximity', nearness(x, y).toFixed(3));
        });
    }

    function bind() {
        if (bound) return;
        bound = true;
        document.addEventListener('pointermove', onPointerMove, { passive: true });
        // Leaving the window is being far from every edge.
        document.documentElement.addEventListener('pointerleave', () => {
            if (handle) handle.style.setProperty('--edge-proximity', '0');
        });
        // Over the bar the wait stops; leaving it, or tabbing out, starts it again.
        document.addEventListener('pointerover', (e) => {
            if (!hidden && bar()?.contains(e.target)) {
                clearTimeout(timer);
                timer = null;
            }
        });
        document.addEventListener('pointerout', (e) => {
            const el = bar();
            if (el && el.contains(e.target) && !el.contains(e.relatedTarget)) {
                // Passing over a bar a key called, and leaving it, is done with it.
                pinned = false;
                arm();
            }
        });
        document.addEventListener('focusin', (e) => {
            if (bar()?.contains(e.target)) show();
        });
        document.addEventListener('focusout', (e) => {
            const el = bar();
            if (el && el.contains(e.target) && !el.contains(e.relatedTarget)) arm();
        });
        // Not on hashchange. Switching page or view used to bring the bar back,
        // so a reader moving through pages had it slide in and out on every
        // step. A load, the edge, focus and ' / Shift+O are what call it.
    }

    /** Settings changed: start over from a visible bar. */
    function sync() {
        bind();
        pinned = false;
        setHidden(false);
        arm();
        introOnLoad();
    }

    /**
     * ' and Shift+O. Answers whether the key did anything, so the caller only
     * swallows it when there was a docked bar to move.
     */
    function toggle() {
        if (!enabled() || !docked()) return false;
        clearTimeout(timer);
        timer = null;
        if (hidden) {
            pinned = true;
            setHidden(false);
            if (screenIsFree()) playIntro();
        } else {
            pinned = false;
            setHidden(true);
        }
        return true;
    }

    global.ActionBarAutoHide = {
        sync,
        toggle,
        show,
        isHidden: () => hidden,
        isPinned: () => pinned,
        introPlayed: () => introPlayed,
    };
}(typeof window !== 'undefined' ? window : globalThis));
