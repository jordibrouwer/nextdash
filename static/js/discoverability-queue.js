/**
 * Post-onboarding discoverability queue — prompts chain after each closes.
 * Journey: what's new → layout-modern-nudge (classic users who skipped layout in onboarding).
 */
(function () {
    'use strict';

    const JOURNEY = ['whats-new', 'layout-modern-nudge'];
    const SESSION_DEFER_KEY = 'nextdash:discoverability-deferred';
    const WHATS_NEW_STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    class DiscoverabilityQueue {
        constructor(dashboard) {
            this.dashboard = dashboard;
            this._activeClose = null;
            this._runTimer = null;
        }

        scheduleRun(options = {}) {
            clearTimeout(this._runTimer);
            let delay = 900;
            if (options.afterOnboarding) delay = 600;
            else if (options.chained) delay = 1200;
            else if (Number.isFinite(options.delay)) delay = options.delay;
            this._runTimer = setTimeout(() => this.runNext(), delay);
        }

        canRun() {
            const dash = this.dashboard;
            if (!dash) return false;
            if (dash.onboardingStartedInSession) return false;
            if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) return false;
            if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
            try {
                if (sessionStorage.getItem(SESSION_DEFER_KEY) === '1') return false;
            } catch { /* ignore */ }
            return true;
        }

        deferRemaining() {
            try {
                sessionStorage.setItem(SESSION_DEFER_KEY, '1');
            } catch { /* ignore */ }
            if (typeof this._activeClose === 'function') {
                this._activeClose();
                this._activeClose = null;
            }
        }

        getNextItem() {
            for (const id of JOURNEY) {
                if (this.shouldShowItem(id)) {
                    return id;
                }
            }
            return null;
        }

        shouldShowItem(id) {
            const dash = this.dashboard;
            if (!dash?.settings?.onboardingCompleted) return false;

            if (id === 'whats-new') {
                if (typeof window.openWhatsNewModal !== 'function') return false;
                try {
                    const release = window.NEXTDASH_WHATS_NEW_RELEASE;
                    const lastSeen = localStorage.getItem(WHATS_NEW_STORAGE_KEY);
                    if (release && lastSeen === release) return false;
                    if (!release && lastSeen) return false;
                } catch {
                    return false;
                }
                return true;
            }

            if (id === 'layout-modern-nudge') {
                return window.LayoutModernNudge?.shouldOffer?.(dash) === true;
            }

            return false;
        }

        runNext() {
            if (!this.canRun()) {
                this.scheduleRun({ delay: 600 });
                return;
            }
            const itemId = this.getNextItem();
            if (!itemId) {
                return;
            }

            const onComplete = () => {
                this._activeClose = null;
                this.scheduleRun({ chained: true });
            };

            if (itemId === 'whats-new') {
                this.runWhatsNew(onComplete);
            } else if (itemId === 'layout-modern-nudge') {
                this.runLayoutModernNudge(onComplete);
            }
        }

        runWhatsNew(onComplete) {
            const dash = this.dashboard;
            if (!this.shouldShowItem('whats-new')) {
                onComplete();
                return;
            }
            if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) {
                this.scheduleRun({ delay: 600 });
                return;
            }

            this._activeClose = () => window.AppModal?.hide?.();
            window.openWhatsNewModal({
                force: false,
                onClose: () => {
                    onComplete();
                    this._activeClose = null;
                },
            });
        }

        runLayoutModernNudge(onComplete) {
            const dash = this.dashboard;
            if (!window.LayoutModernNudge?.shouldOffer?.(dash)) {
                onComplete();
                return;
            }
            if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) {
                this.scheduleRun({ delay: 600 });
                return;
            }

            const spotlight = window.LayoutModernNudge.create(dash);
            if (!spotlight) {
                onComplete();
                return;
            }

            spotlight.onDismiss = onComplete;
            this._activeClose = () => spotlight._dismiss(false);

            const started = spotlight.show(800, {
                canShow: () => {
                    if (!window.LayoutModernNudge?.shouldOffer?.(dash)) return false;
                    if (dash.onboardingStartedInSession) return false;
                    if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) return false;
                    return true;
                },
            });
            if (!started) {
                onComplete();
                return;
            }
            dash.layoutModernNudge = spotlight;
        }
    }

    window.DiscoverabilityQueue = DiscoverabilityQueue;
})();
