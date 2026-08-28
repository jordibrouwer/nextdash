/**
 * One-time hint that the health filter strip scrolls sideways.
 *
 * The row of filter pills holds a dozen entries and fits perhaps seven. The
 * ones past the edge — Stale, Unused, Drift, Missing preview, Certificates,
 * Ignored — are reachable by scrolling the strip, and nothing says so: the fade
 * at each end is the only clue, and a fade reads as decoration. So the filters
 * that answer "what should I tidy up" are invisible to anyone who does not
 * happen to swipe.
 *
 * Said once, in place, and then never again — dismissing it is the answer, not
 * a postponement, which is why the flag is a setting promo (persisted
 * server-side, so it follows the reader across devices) rather than a session
 * tip that comes back tomorrow.
 *
 * Only when the strip actually overflows. On a wide window every pill is
 * visible and pointing at a scrollbar that is not there would be a lie.
 */
(function initHealthFilterScrollHint(global) {
    'use strict';

    // Also named in dashboard-health.js, which checks it before fetching this
    // file at all. Both must agree.
    const PROMO_ID = 'health-filter-scroll-v1';
    const VIEWPORT_PAD = 12;
    // Long enough that the list has drawn and the reader is looking at it,
    // short enough to still be about what they are doing.
    const SHOW_DELAY_MS = 900;

    let popover = null;
    let anchorEl = null;
    let onReposition = null;
    let onEscape = null;
    let onOutside = null;
    let showTimer = null;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const full = key.includes('.') ? key : `dashboard.${key}`;
        const value = lang.t(full);
        return value && value !== full ? value : fallback;
    }

    const esc = window.NextDashHtml.escapeHtml;

    function seen() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    /** Dismissed is an answer: recorded server-side, so it holds everywhere. */
    function markSeen() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    /** The strip scrolls only when it has more pills than width. */
    function overflows(el) {
        return !!el && el.scrollWidth - el.clientWidth > 8;
    }

    function close({ answered = true } = {}) {
        if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
        }
        if (onReposition) {
            global.removeEventListener('resize', onReposition);
            global.removeEventListener('scroll', onReposition, true);
            onReposition = null;
        }
        if (onEscape) {
            document.removeEventListener('keydown', onEscape, true);
            onEscape = null;
        }
        if (onOutside) {
            document.removeEventListener('pointerdown', onOutside, true);
            onOutside = null;
        }
        popover?.remove();
        popover = null;
        anchorEl = null;
        if (answered) markSeen();
    }

    /*
     * Above the strip, pointing down at it.
     *
     * Fixed rather than absolute: the toolbar is inside a scrolling view and an
     * absolutely placed card would be clipped by the strip's own overflow —
     * which is the very thing this is explaining.
     */
    function position() {
        if (!popover || !anchorEl) return;
        const rect = anchorEl.getBoundingClientRect();
        const width = Math.min(popover.offsetWidth || 280, global.innerWidth - VIEWPORT_PAD * 2);
        let left = rect.left + (rect.width / 2) - (width / 2);
        left = Math.max(VIEWPORT_PAD, Math.min(left, global.innerWidth - width - VIEWPORT_PAD));
        const height = popover.offsetHeight || 90;
        let top = rect.top - height - 10;
        let below = false;
        // No room above — under a header, or a short window — so it goes below
        // and turns its arrow around rather than sitting off screen.
        if (top < VIEWPORT_PAD) {
            top = rect.bottom + 10;
            below = true;
        }
        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
        popover.classList.toggle('is-below', below);
    }

    function render(strip) {
        popover = document.createElement('div');
        popover.className = 'health-filter-hint';
        popover.setAttribute('role', 'status');
        popover.innerHTML = `
            <p class="health-filter-hint-body">${esc(t('healthFilterScrollHint',
                'There are more filters than fit. The row scrolls sideways — Stale, Unused, Drift and the rest are past the edge.'))}</p>
            <button type="button" class="health-filter-hint-btn">${esc(t('healthFilterScrollHintDone', 'Got it'))}</button>
            <span class="health-filter-hint-arrow" aria-hidden="true"></span>`;
        document.body.appendChild(popover);
        anchorEl = strip;
        position();

        popover.querySelector('.health-filter-hint-btn')?.addEventListener('click', () => close());

        onReposition = () => position();
        global.addEventListener('resize', onReposition);
        // Capture: the health feed scrolls in its own container, not the window.
        global.addEventListener('scroll', onReposition, true);

        onEscape = (e) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', onEscape, true);

        /*
         * Clicking anywhere else counts as the answer.
         *
         * Including on the strip itself: someone who scrolls the pills has just
         * learned what this says, and being told afterwards is worse than not
         * being told.
         */
        onOutside = (e) => {
            if (popover && !popover.contains(e.target)) close();
        };
        document.addEventListener('pointerdown', onOutside, true);

        global.nextdashTrack?.('health:filter-scroll-hint-shown');
    }

    /**
     * Called by the health view once its toolbar is on screen.
     *
     * Guards in the order they are cheapest: the answer, the settings, the
     * things that would make a popover wrong right now, and last the measurement
     * — which is the only one that touches layout.
     */
    function maybeShow() {
        if (popover || seen()) return false;
        const d = dash();
        if (!d?.settings || d.settings.enableSessionTips === false) return false;
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;

        if (showTimer) clearTimeout(showTimer);
        showTimer = setTimeout(() => {
            showTimer = null;
            const strip = document.querySelector('.health-view-filter-group');
            // Measured now rather than when the call came in: the list may still
            // have been drawing, and a strip mid-render reports the wrong width.
            if (!strip || !overflows(strip) || seen()) return;
            if (document.querySelector('#app-modal.show')) return;
            render(strip);
        }, SHOW_DELAY_MS);
        return true;
    }

    global.HealthFilterScrollHint = { PROMO_ID, maybeShow, close };
}(typeof window !== 'undefined' ? window : globalThis));
