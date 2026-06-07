/**
 * Post-onboarding discoverability queue — one prompt per session, priority order.
 * Journey: what's new → feature-tour spotlight
 */
(function () {
    'use strict';

    const JOURNEY = ['whats-new', 'tour-spotlight'];
    const SESSION_SHOWN_KEY = 'nextdash:discoverability-session-shown';
    const SESSION_DEFER_KEY = 'nextdash:discoverability-deferred';
    const TOUR_SPOTLIGHT_KEY = 'nextdash:feature-tour-spotlight-v1';
    const WHATS_NEW_STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function t(dashboard, key, fallback, vars) {
        const raw = dashboard?.language?.t?.(key);
        let text = raw && raw !== key ? raw : fallback;
        if (vars) {
            Object.entries(vars).forEach(([k, v]) => {
                text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
            });
        }
        return text;
    }

    function injectQueueBar(container, meta, onDefer, dashboard) {
        if (!container || !meta) return;
        container.querySelector('.discoverability-queue-bar')?.remove();
        const bar = document.createElement('div');
        bar.className = 'discoverability-queue-bar';
        bar.setAttribute('role', 'status');
        const stepText = t(
            dashboard,
            'dashboard.discoverabilityStep',
            'Step {step} of {total}',
            { step: meta.step, total: meta.total }
        );
        const deferLabel = t(dashboard, 'dashboard.discoverabilitySkipLater', 'Skip for later');
        bar.innerHTML = `
            <span class="discoverability-queue-step">${stepText}</span>
            <button type="button" class="discoverability-queue-defer">${deferLabel}</button>
        `;
        bar.querySelector('.discoverability-queue-defer')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onDefer();
        });
        container.insertBefore(bar, container.firstChild);
    }

    window.DiscoverabilityQueueBar = { inject: injectQueueBar };

    class DiscoverabilityQueue {
        constructor(dashboard) {
            this.dashboard = dashboard;
            this._activeClose = null;
            this._runTimer = null;
        }

        scheduleRun(options = {}) {
            clearTimeout(this._runTimer);
            const delay = options.afterOnboarding ? 450 : 900;
            this._runTimer = setTimeout(() => this.runNext(), delay);
        }

        canRunThisSession() {
            const dash = this.dashboard;
            if (!dash) return false;
            if (dash.onboardingStartedInSession) return false;
            if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) return false;
            if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
            try {
                if (sessionStorage.getItem(SESSION_SHOWN_KEY) === '1') return false;
                if (sessionStorage.getItem(SESSION_DEFER_KEY) === '1') return false;
            } catch { /* ignore */ }
            return true;
        }

        buildMeta(itemId) {
            const step = JOURNEY.indexOf(itemId) + 1;
            return { step: step > 0 ? step : 1, total: JOURNEY.length, itemId };
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

        markSessionShown() {
            try {
                sessionStorage.setItem(SESSION_SHOWN_KEY, '1');
            } catch { /* ignore */ }
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
            if (id === 'tour-spotlight') {
                try {
                    if (localStorage.getItem(TOUR_SPOTLIGHT_KEY)) return false;
                } catch {
                    return false;
                }
                return true;
            }
            return false;
        }

        runNext() {
            if (!this.canRunThisSession()) {
                this.dashboard?.scheduleLayoutModernNudgeWhenIdle?.();
                return;
            }
            const itemId = this.getNextItem();
            if (!itemId) {
                this.dashboard?.scheduleLayoutModernNudgeWhenIdle?.();
                return;
            }

            const meta = this.buildMeta(itemId);
            const onDefer = () => this.deferRemaining();
            const onComplete = () => {
                this._activeClose = null;
                this.dashboard?.scheduleLayoutModernNudgeWhenIdle?.();
            };

            this.markSessionShown();

            if (itemId === 'whats-new') {
                this.runWhatsNew(onComplete);
            } else if (itemId === 'tour-spotlight') {
                this.runTourSpotlight(meta, onDefer, onComplete);
            }
        }

        runWhatsNew(onComplete) {
            this._activeClose = () => window.AppModal?.hide?.();
            window.openWhatsNewModal({
                force: false,
                onClose: () => {
                    onComplete();
                    this._activeClose = null;
                },
            });
        }

        runTourSpotlight(meta, onDefer, onComplete) {
            const dash = this.dashboard;
            const _t = (key, fallback) => t(dash, 'dashboard.' + key, fallback);

            const el = document.createElement('div');
            el.className = 'feature-spotlight';
            el.setAttribute('role', 'complementary');
            el.setAttribute('aria-label', _t('tourSpotlightAriaLabel', 'Discover nextDash features'));
            el.innerHTML = `
                <div class="feature-spotlight-stripe"></div>
                <div class="feature-spotlight-body">
                    <div class="feature-spotlight-icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <circle cx="12" cy="12" r="10"/>
                            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
                        </svg>
                    </div>
                    <div class="feature-spotlight-content">
                        <p class="feature-spotlight-title"></p>
                        <p class="feature-spotlight-text"></p>
                    </div>
                </div>
                <div class="feature-spotlight-actions">
                    <button class="feature-spotlight-try" type="button"></button>
                    <button class="feature-spotlight-close" type="button"></button>
                </div>
            `;
            injectQueueBar(el, meta, onDefer, dash);
            el.querySelector('.feature-spotlight-title').textContent =
                _t('tourSpotlightTitle', 'Discover search, finders and commands');
            el.querySelector('.feature-spotlight-text').textContent =
                _t('tourSpotlightBody', 'Follow a short interactive tour to learn the most powerful features of nextDash.');
            el.querySelector('.feature-spotlight-try').textContent =
                _t('tourSpotlightStart', 'Start tour');
            el.querySelector('.feature-spotlight-close').textContent =
                _t('tourSpotlightLater', 'Later');

            const showPasteAfterDelay = () => setTimeout(() => dash.maybeShowPasteSpotlight?.(), 2000);

            const dismiss = () => {
                try { localStorage.setItem(TOUR_SPOTLIGHT_KEY, '1'); } catch { /* ignore */ }
                el.classList.remove('show');
                setTimeout(() => el.remove(), 320);
            };

            this._activeClose = () => {
                dismiss();
                onComplete();
                this._activeClose = null;
            };

            el.querySelector('.feature-spotlight-try').addEventListener('click', () => {
                dismiss();
                onComplete();
                this._activeClose = null;
                dash.startFeatureTour(showPasteAfterDelay);
            });
            el.querySelector('.feature-spotlight-close').addEventListener('click', () => {
                dismiss();
                onComplete();
                this._activeClose = null;
                showPasteAfterDelay();
            });

            document.body.appendChild(el);
            requestAnimationFrame(() => el.classList.add('show'));
        }
    }

    window.DiscoverabilityQueue = DiscoverabilityQueue;
})();
