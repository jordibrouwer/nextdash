(function () {
    'use strict';

    const DEFAULT_STORAGE_KEY = 'nextdash:feature-spotlight-paste-v1';

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
            closeFallback = 'Close',
            iconSvg = PASTE_ICON_SVG,
            onTry = null,
            onDismiss = null,
            queueMeta = null,
            onQueueDefer = null,
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
            this.closeFallback = closeFallback;
            this.iconSvg = iconSvg;
            this.onTry = onTry;
            this.onDismiss = onDismiss;
            this.queueMeta = queueMeta;
            this.onQueueDefer = onQueueDefer;
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

            const el = document.createElement('div');
            el.className = 'feature-spotlight';
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
                    <button class="feature-spotlight-try" type="button"></button>
                    <button class="feature-spotlight-close" type="button"></button>
                </div>`;

            el.querySelector('.feature-spotlight-icon').innerHTML = this.iconSvg;
            el.querySelector('.feature-spotlight-title').textContent = title;
            el.querySelector('.feature-spotlight-text').innerHTML = body;
            el.querySelector('.feature-spotlight-try').textContent = tryLbl;
            el.querySelector('.feature-spotlight-close').textContent = closeLbl;

            if (this.queueMeta && typeof window.DiscoverabilityQueueBar?.inject === 'function') {
                window.DiscoverabilityQueueBar.inject(
                    el,
                    this.queueMeta,
                    () => {
                        if (typeof this.onQueueDefer === 'function') this.onQueueDefer();
                        this._dismiss(false);
                    },
                    this.dashboard
                );
            }

            el.querySelector('.feature-spotlight-try').addEventListener('click', () => {
                if (typeof this.onTry === 'function') this.onTry();
                setTimeout(() => this._dismiss(true), 120);
            });

            el.querySelector('.feature-spotlight-close').addEventListener('click', () => {
                this._dismiss(true);
            });

            document.body.appendChild(el);
            this.el = el;
        }

        _dismiss(persist = true) {
            if (!this.el) return;
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
            setTimeout(() => el.remove(), 320);
            this.el = null;
        }

        show(delayMs = 1400, options = {}) {
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
    }

    window.FeatureSpotlight = FeatureSpotlight;
    window.FeatureSpotlight.DEFAULT_STORAGE_KEY = DEFAULT_STORAGE_KEY;
    window.FeatureSpotlight.PASTE_ICON_SVG = PASTE_ICON_SVG;
})();
