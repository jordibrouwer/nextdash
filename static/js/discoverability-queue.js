/**
 * Post-onboarding discoverability queue — prompts chain after each closes.
 * Journey: what's new → layout-version-nudge (classic users who skipped layout in onboarding; try modern or glass).
 */
(function () {
    'use strict';

    const JOURNEY = ['whats-new', 'layout-modern-nudge', 'paste-spotlight'];
    const SESSION_DEFER_KEY = 'nextdash:discoverability-deferred';
    const WHATS_NEW_STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';

    function queueMetaFor(itemId) {
        const idx = JOURNEY.indexOf(itemId);
        if (idx < 0) return null;
        return { current: idx + 1, total: JOURNEY.length };
    }

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
                return window.LayoutVersionNudge?.shouldOffer?.(dash) === true;
            }

            if (id === 'paste-spotlight') {
                if (dash.isConfigDiscoverabilityHost) return false;
                if (typeof window.FeatureSpotlight !== 'function') return false;
                if (dash.settings?.pasteUrlQuickAdd === false) return false;
                if (window.matchMedia?.('(pointer: coarse)').matches) return false;
                try {
                    if (localStorage.getItem(window.FeatureSpotlight.DEFAULT_STORAGE_KEY)) return false;
                } catch { return false; }
                return true;
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
            } else if (itemId === 'paste-spotlight') {
                this.runPasteSpotlight(onComplete);
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
                dashboard: dash,
                queueMeta: queueMetaFor('whats-new'),
                onQueueDefer: () => this.deferRemaining(),
                onClose: () => {
                    onComplete();
                    this._activeClose = null;
                },
            });
        }

        runPasteSpotlight(onComplete) {
            const dash = this.dashboard;
            if (!this.shouldShowItem('paste-spotlight')) {
                onComplete();
                return;
            }

            const spotlight = new window.FeatureSpotlight({
                language: dash.language,
                dashboard: dash,
                onTry: () => {
                    const handler = dash.searchComponent?.commandsComponent?.newCommandHandler;
                    if (handler) handler.openModal();
                },
                onDismiss: () => {
                    if (dash.pasteSpotlight === spotlight) dash.pasteSpotlight = null;
                    onComplete();
                },
                queueMeta: queueMetaFor('paste-spotlight'),
                onQueueDefer: () => this.deferRemaining(),
            });

            this._activeClose = () => spotlight.dismiss(false);
            const started = spotlight.show(1000, {
                canShow: () => {
                    if (dash.onboardingStartedInSession) return false;
                    if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) return false;
                    return true;
                },
            });
            if (!started) {
                onComplete();
                return;
            }
            dash.pasteSpotlight = spotlight;
        }

        runLayoutModernNudge(onComplete) {
            const dash = this.dashboard;
            if (!window.LayoutVersionNudge?.shouldOffer?.(dash)) {
                onComplete();
                return;
            }
            if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) {
                this.scheduleRun({ delay: 600 });
                return;
            }

            const spotlight = window.LayoutVersionNudge.create(dash, {
                queueMeta: queueMetaFor('layout-modern-nudge'),
                onQueueDefer: () => this.deferRemaining(),
            });
            if (!spotlight) {
                onComplete();
                return;
            }

            spotlight.onDismiss = () => {
                dash.layoutVersionNudge = null;
                dash.layoutModernNudge = null;
                onComplete();
            };
            this._activeClose = () => spotlight.dismiss(false);

            const started = spotlight.show(800, {
                canShow: () => {
                    if (!window.LayoutVersionNudge?.shouldOffer?.(dash)) return false;
                    if (dash.onboardingStartedInSession) return false;
                    if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) return false;
                    return true;
                },
            });
            if (!started) {
                onComplete();
                return;
            }
            dash.layoutVersionNudge = spotlight;
            dash.layoutModernNudge = spotlight;
        }
    }

    DiscoverabilityQueue.resetSessionState = function resetSessionState() {
        try {
            sessionStorage.removeItem(SESSION_DEFER_KEY);
        } catch { /* ignore */ }
    };

    DiscoverabilityQueue.createConfigHost = function createConfigHost(configManager) {
        if (!configManager) return null;
        const host = {
            settings: configManager.settingsData,
            language: configManager.language,
            onboardingStartedInSession: false,
            isConfigDiscoverabilityHost: true,
            isModalOpen() {
                if (typeof configManager.isDiscoverabilityBlocked === 'function') {
                    return configManager.isDiscoverabilityBlocked();
                }
                return false;
            },
        };
        ['layoutVersionNudge', 'layoutModernNudge', 'pasteSpotlight'].forEach((key) => {
            Object.defineProperty(host, key, {
                enumerable: true,
                get() {
                    return configManager[key];
                },
                set(value) {
                    configManager[key] = value;
                },
            });
        });
        return host;
    };

    function translateQueueLabel(dashboard, key, fallback, replacements = {}) {
        let text = fallback;
        if (dashboard?.language?.t) {
            const fullKey = `dashboard.${key}`;
            const result = dashboard.language.t(fullKey);
            if (result && result !== fullKey) text = result;
        }
        Object.entries(replacements).forEach(([name, value]) => {
            text = text.replaceAll(`{${name}}`, String(value));
        });
        return text;
    }

    const DiscoverabilityQueueBar = {
        inject(spotlightEl, queueMeta, onDefer, dashboard = null) {
            if (!spotlightEl || !queueMeta) return;
            const current = Number(queueMeta.current);
            const total = Number(queueMeta.total);
            if (!Number.isFinite(current) || !Number.isFinite(total) || total < 1 || current < 1) return;

            const bar = document.createElement('div');
            bar.className = 'discoverability-queue-bar';
            bar.setAttribute('role', 'status');
            bar.setAttribute('aria-live', 'polite');

            const step = document.createElement('span');
            step.className = 'discoverability-queue-step';
            step.textContent = translateQueueLabel(
                dashboard,
                'discoverabilityQueueStep',
                'Tip {current} of {total}',
                { current, total }
            );

            const deferBtn = document.createElement('button');
            deferBtn.type = 'button';
            deferBtn.className = 'discoverability-queue-defer';
            deferBtn.textContent = translateQueueLabel(
                dashboard,
                'discoverabilityQueueDefer',
                'Later this session'
            );
            deferBtn.addEventListener('click', () => {
                if (typeof onDefer === 'function') onDefer();
            });

            bar.append(step, deferBtn);
            spotlightEl.insertBefore(bar, spotlightEl.firstChild);
        },
    };

    window.DiscoverabilityQueue = DiscoverabilityQueue;
    window.DiscoverabilityQueue.SESSION_DEFER_KEY = SESSION_DEFER_KEY;
    window.DiscoverabilityQueueBar = DiscoverabilityQueueBar;
})();
