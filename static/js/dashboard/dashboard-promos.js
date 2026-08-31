/**
 * First-run quick start and the post-onboarding what's-new prompt.
 */
class DashboardPromos {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    /**
     * May unprompted UI take the screen right now?
     *
     * The single answer for every module that wants to show something the user
     * did not ask for — the what's-new prompt here, the occasional keyboard tip
     * in dashboard-keyboard-tip.js. Both used to keep their own copy of these
     * checks and their own retry loop; the copies had already drifted (the tip
     * knew about .quickstart-card, this one did not).
     *
     * Note this is NOT an initialization milestone: it is a condition that goes
     * false again whenever a modal opens or an inline edit starts, so callers
     * still poll rather than awaiting a one-shot "ready" signal. Deliberately
     * kept separate from the deep-link and data-loaded waits, which answer
     * genuinely different questions.
     *
     * `options.ignoreQuickstart` exists for the what's-new prompt: it and the
     * quick-start card can legitimately share a first run, where a tip cannot.
     */
    canShowUnpromptedUi(options = {}) {
        const d = this.dash;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (d.onboardingStartedInSession) return false;
        if (!d.settings?.onboardingCompleted) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (!options.ignoreQuickstart && document.querySelector('.quickstart-card')) return false;
        return true;
    }


    canShowPostOnboardingPrompts() {
        // The what's-new prompt predates the quick-start card check and has
        // always been allowed to run alongside it; keeping that exemption here
        // rather than in the shared primitive.
        return this.canShowUnpromptedUi({ ignoreQuickstart: true });
    }


    shouldShowWhatsNewPrompt() {
        const d = this.dash;
        if (typeof window.openWhatsNewModal !== 'function') return false;
        try {
            const release = window.NEXTDASH_WHATS_NEW_RELEASE;
            const lastSeen = window.DiscoverabilityState?.getLastWhatsNewRelease?.()
                || localStorage.getItem('nextdash:last-whats-new-dashboard-release');
            if (release && lastSeen === release) return false;
            if (!release && lastSeen) return false;
        } catch {
            return false;
        }
        return true;
    }


    schedulePostOnboardingPrompts(options = {}) {
        const d = this.dash;
        clearTimeout(d._postOnboardingPromptsTimer);
        let delay = 900;
        if (options.afterOnboarding) delay = 600;
        // An explicit delay is a retry asking to be tried again later, so it
        // wins. Callers scheduling the first run must NOT pass the default:
        // naming 900 here reaches this branch and skips the one below, which is
        // how the prefetch and the fast path sat dead for a while.
        else if (Number.isFinite(options.delay)) delay = options.delay;
        else if (this.shouldShowWhatsNewPrompt()) {
            // A release the reader has not seen: show it now rather than after
            // the better part of a second. The 900ms was chosen for a prompt
            // that might not appear at all, and on an upgraded install it read
            // as the dashboard settling and then interrupting.
            //
            // The modal's own code is fetched on first open, so it is asked for
            // here: the request overlaps the short wait instead of following it.
            window.ensureWhatsNewLoaded?.();
            delay = 120;
        }
        if (options.resetAttempts === true) {
            d._postOnboardingPromptsAttempts = 0;
        }
        d._postOnboardingPromptsTimer = setTimeout(() => {
            this.runPostOnboardingPrompts();
        }, delay);
    }


    /**
     * Retries while a modal or inline edit blocks the view; what's new is the
     * only prompt left, so there is no ordering to arbitrate.
     */
    runPostOnboardingPrompts() {
        const d = this.dash;
        const maxWaitAttempts = 50;

        if (!this.canShowPostOnboardingPrompts()) {
            d._postOnboardingPromptsAttempts = (d._postOnboardingPromptsAttempts || 0) + 1;
            if (d._postOnboardingPromptsAttempts < maxWaitAttempts) {
                this.schedulePostOnboardingPrompts({ delay: 600 });
                return;
            }
            d._postOnboardingPromptsAttempts = 0;
            return;
        }
        d._postOnboardingPromptsAttempts = 0;

        this.maybeShowWhatsNew();
        this.maybeAnnounceSearchModeKey();
    }


    /**
     * Say once that Shift+Q switches the search mode.
     *
     * The setting moved to Behavior → Search in v1.4.3 and gained a key, and
     * neither is something you find by looking: the old tickbox was in another
     * section under a name that described something else, so nobody was going
     * to notice it had moved, and a key nobody names is a key nobody presses.
     *
     * Once per release, keyed the way the what's-new prompt is. Storage that
     * throws — a private window, blocked site data — means the note is skipped
     * rather than shown on every load.
     */
    maybeAnnounceSearchModeKey() {
        const d = this.dash;
        const release = window.NEXTDASH_WHATS_NEW_RELEASE || '';
        const key = 'nextdash:search-mode-key-announced';
        try {
            if (localStorage.getItem(key) === release) return;
            localStorage.setItem(key, release);
        } catch {
            return;
        }
        const text = d.t?.('dashboard.searchModeKeyAnnounce',
            'Tip: Shift + Q switches the search mode — whether letters find names or shortcuts')
            || 'Tip: Shift + Q switches the search mode';
        // 'promo', not 'info', the way dashboard-keyboard-tip sends its own:
        // this is an unprompted tip on a long timer, and AppNotification gives
        // way for a real notification only when the promo is the one on screen.
        // Sent as 'info' it took the slot like an answer to something the user
        // did, and the confirmation for their next action queued behind it —
        // switching a bookmark to Periodic showed nothing at all.
        d.showNotification?.(text, 'promo', { duration: 8000 });
    }


    maybeShowWhatsNew() {
        const d = this.dash;
        if (!this.canShowPostOnboardingPrompts() || !this.shouldShowWhatsNewPrompt()) return;
        this.showWhatsNewModal({ force: false });
    }


    showWhatsNewModal(options = {}) {
        const d = this.dash;
        if (typeof window.openWhatsNewModal !== 'function') {
            return;
        }
        const force = options.force === true;
        window.openWhatsNewModal({
            force,
            ifBlockingModalOpen: force ? undefined : () => d.isModalOpen(),
            // Disclose the analytics once the release notes are out of the way,
            // so the two cards never compete for the same corner.
            onClose: () => window.DashboardAnalyticsNotice?.scheduleAfterWhatsNew?.(),
        });
    }


    initializeOnboarding() {
        const d = this.dash;
        if (typeof window.QuickStart !== 'function') {
            d.onboardingStartedInSession = false;
            return;
        }
        const quickStart = new window.QuickStart(d);
        d.quickStart = quickStart;
        // Kept for compatibility: post-onboarding prompts and toolbar hints gate on
        // this flag so they don't overlap with first-run quick-start.
        d.onboardingStartedInSession = quickStart.shouldStart();
        if (d.onboardingStartedInSession) {
            const hintEl = document.getElementById('search-flow-hint');
            if (hintEl) {
                hintEl.hidden = true;
                hintEl.classList.remove('dismissing');
            }
            try {
                localStorage.removeItem('nextdash:search-flow-hint-v1');
                localStorage.removeItem('nextdash:search-flow-hint-v2');
            } catch {}
        }
        quickStart.start();
    }


}

window.DashboardPromos = DashboardPromos;
