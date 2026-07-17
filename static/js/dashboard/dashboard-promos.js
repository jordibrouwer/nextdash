/**
 * First-run quick start and the post-onboarding what's-new prompt.
 */
class DashboardPromos {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    canShowPostOnboardingPrompts() {
        const d = this.dash;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (d.onboardingStartedInSession) return false;
        if (!d.settings?.onboardingCompleted) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        return true;
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
        else if (Number.isFinite(options.delay)) delay = options.delay;
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
            ifBlockingModalOpen: force ? undefined : () => d.isModalOpen()
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
