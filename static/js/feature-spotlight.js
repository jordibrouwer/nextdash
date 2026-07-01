(function () {
    'use strict';

    const DEFAULT_STORAGE_KEY = 'nextdash:feature-spotlight-paste-v1';
    const PASTE_REPLAY_KEY = 'nextdash:paste-spotlight-replay-pending';

    const PASTE_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="9" y="2" width="6" height="4" rx="1" ry="1"/>
        <path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/>
        <path d="M10 13h1.5a2 2 0 1 0 0-4H10"/>
        <path d="M14 13h-1.5a2 2 0 1 1 0-4H14"/>
        <line x1="10.5" y1="11" x2="13.5" y2="11"/>
    </svg>`;

    class FeatureSpotlight {
        constructor({
            language,
            dashboard = null,
            storageKey = DEFAULT_STORAGE_KEY,
            titleKey = 'featureSpotlightPasteTitle',
            bodyKey = 'featureSpotlightPasteBody',
            tryKey = 'featureSpotlightPasteTry',
            closeKey = 'featureSpotlightPasteClose',
            titleFallback = 'Paste a URL, save a bookmark instantly',
            bodyFallback = 'Copy any link and press Ctrl+V anywhere on the dashboard — the bookmark form opens with the URL pre-filled and the favicon fetched automatically.',
            tryFallback = 'Try it',
            secondaryTryKey = null,
            secondaryTryFallback = '',
            closeFallback = 'Close',
            iconSvg = PASTE_ICON_SVG,
            onTry = null,
            onSecondaryTry = null,
            onDismiss = null,
        } = {}) {
            this.language = language;
            this.dashboard = dashboard;
            this.storageKey = storageKey;
            this.titleKey = titleKey;
            this.bodyKey = bodyKey;
            this.tryKey = tryKey;
            this.closeKey = closeKey;
            this.titleFallback = titleFallback;
            this.bodyFallback = bodyFallback;
            this.tryFallback = tryFallback;
            this.secondaryTryKey = secondaryTryKey;
            this.secondaryTryFallback = secondaryTryFallback;
            this.closeFallback = closeFallback;
            this.iconSvg = iconSvg;
            this.onTry = onTry;
            this.onSecondaryTry = onSecondaryTry;
            this.onDismiss = onDismiss;
            this.el = null;
            this._showTimer = null;
        }

        _t(key, fallback) {
            if (this.language && typeof this.language.t === 'function') {
                const fullKey = key.startsWith('dashboard.') ? key : `dashboard.${key}`;
                const result = this.language.t(fullKey);
                if (result && result !== fullKey) return result;
            }
            return fallback;
        }

        _build() {
            const title = this._t(this.titleKey, this.titleFallback);
            const body = this._t(this.bodyKey, this.bodyFallback);
            const tryLbl = this._t(this.tryKey, this.tryFallback);
            const closeLbl = this._t(this.closeKey, this.closeFallback);
            const hasSecondaryTry = typeof this.onSecondaryTry === 'function';
            const secondaryTryLbl = hasSecondaryTry
                ? this._t(this.secondaryTryKey, this.secondaryTryFallback)
                : '';

            const el = document.createElement('div');
            el.className = 'feature-spotlight';
            if (hasSecondaryTry) el.classList.add('has-secondary-try');
            el.setAttribute('role', 'complementary');
            el.setAttribute('aria-label', title);
            el.innerHTML = `
                <div class="feature-spotlight-stripe"></div>
                <div class="feature-spotlight-body">
                    <div class="feature-spotlight-icon"></div>
                    <div class="feature-spotlight-content">
                        <p class="feature-spotlight-title"></p>
                        <p class="feature-spotlight-text"></p>
                    </div>
                </div>
                <div class="feature-spotlight-actions">
                    <div class="feature-spotlight-primary-actions">
                        <button class="feature-spotlight-try" type="button"></button>${hasSecondaryTry ? '<button class="feature-spotlight-try-secondary" type="button"></button>' : ''}
                    </div>
                    <button class="feature-spotlight-close" type="button"></button>
                </div>`;

            el.querySelector('.feature-spotlight-icon').innerHTML = this.iconSvg;
            el.querySelector('.feature-spotlight-title').textContent = title;
            el.querySelector('.feature-spotlight-text').innerHTML = body;
            el.querySelector('.feature-spotlight-try').textContent = tryLbl;
            if (hasSecondaryTry) {
                el.querySelector('.feature-spotlight-try-secondary').textContent = secondaryTryLbl;
            }
            el.querySelector('.feature-spotlight-close').textContent = closeLbl;

            el.querySelector('.feature-spotlight-try').addEventListener('click', () => {
                if (typeof this.onTry === 'function') this.onTry();
                setTimeout(() => this._dismiss(true), 120);
            });

            if (hasSecondaryTry) {
                el.querySelector('.feature-spotlight-try-secondary').addEventListener('click', () => {
                    this.onSecondaryTry();
                    setTimeout(() => this._dismiss(true), 120);
                });
            }

            el.querySelector('.feature-spotlight-close').addEventListener('click', () => {
                this._dismiss(true);
            });

            document.body.appendChild(el);
            this.el = el;
        }

        _dismiss(persist = true) {
            clearTimeout(this._showTimer);
            this._showTimer = null;
            if (!this.el) {
                if (typeof this.onDismiss === 'function') {
                    this.onDismiss();
                }
                return;
            }
            if (persist) {
                try {
                    localStorage.setItem(this.storageKey, '1');
                } catch { /* ignore */ }
            }
            this.el.classList.remove('show');
            if (typeof this.onDismiss === 'function') {
                this.onDismiss();
            }
            const el = this.el;
            setTimeout(() => {
                if (el.isConnected) el.remove();
            }, 320);
            this.el = null;
        }

        dismiss(persist = true) {
            this._dismiss(persist);
        }

        show(delayMs = 1400, options = {}) {
            if (window.DashboardPromoRegistry?.areDiscoverabilityPromosPaused?.()) return false;
            if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
            try {
                if (localStorage.getItem(this.storageKey)) return false;
            } catch { /* ignore */ }

            const canShow = typeof options.canShow === 'function' ? options.canShow : null;
            const maxWaitMs = Number.isFinite(options.maxWaitMs) ? options.maxWaitMs : 120000;
            const startedAt = Date.now();

            const attemptShow = () => {
                if (Date.now() - startedAt > maxWaitMs) return;
                if (canShow && !canShow()) {
                    this._showTimer = setTimeout(attemptShow, 600);
                    return;
                }
                try {
                    if (localStorage.getItem(this.storageKey)) return;
                } catch { /* ignore */ }
                if (!this.el) this._build();
                if (this.el) this.el.classList.add('show');
            };

            clearTimeout(this._showTimer);
            this._showTimer = setTimeout(attemptShow, delayMs);
            return true;
        }

        reset() {
            try {
                localStorage.removeItem(this.storageKey);
            } catch { /* ignore */ }
        }

        static resetStorage(storageKey = DEFAULT_STORAGE_KEY) {
            try {
                localStorage.removeItem(storageKey);
            } catch { /* ignore */ }
        }

        static resetPasteSpotlight() {
            FeatureSpotlight.resetStorage(DEFAULT_STORAGE_KEY);
        }

        static queuePasteReplay() {
            FeatureSpotlight.resetPasteSpotlight();
            try {
                sessionStorage.setItem(PASTE_REPLAY_KEY, '1');
            } catch { /* ignore */ }
        }

        static consumePasteReplayPending() {
            try {
                const pending = sessionStorage.getItem(PASTE_REPLAY_KEY) === '1';
                sessionStorage.removeItem(PASTE_REPLAY_KEY);
                return pending;
            } catch {
                return false;
            }
        }

        static dismissVisible() {
            document.querySelectorAll('.feature-spotlight.show').forEach((el) => {
                el.classList.remove('show');
                setTimeout(() => {
                    if (el.isConnected) el.remove();
                }, 320);
            });
        }
    }

    window.FeatureSpotlight = FeatureSpotlight;
    window.FeatureSpotlight.DEFAULT_STORAGE_KEY = DEFAULT_STORAGE_KEY;
    window.FeatureSpotlight.PASTE_REPLAY_KEY = PASTE_REPLAY_KEY;
    window.FeatureSpotlight.PASTE_ICON_SVG = PASTE_ICON_SVG;
})();
