(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:feature-spotlight-paste-v1';

    // Clipboard + link chain icon (Lucide-style)
    const ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="9" y="2" width="6" height="4" rx="1" ry="1"/>
        <path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/>
        <path d="M10 13h1.5a2 2 0 1 0 0-4H10"/>
        <path d="M14 13h-1.5a2 2 0 1 1 0-4H14"/>
        <line x1="10.5" y1="11" x2="13.5" y2="11"/>
    </svg>`;

    class FeatureSpotlight {
        constructor({ language, onTry } = {}) {
            this.language = language;
            this.onTry = onTry || null;
            this.el = null;
            this._showTimer = null;
        }

        _t(key, fallback) {
            if (this.language && typeof this.language.t === 'function') {
                const result = this.language.t('dashboard.' + key);
                // t() returns the key itself when not found — treat that as missing
                if (result && result !== 'dashboard.' + key) return result;
            }
            return fallback;
        }

        _build() {
            const title = this._t('featureSpotlightPasteTitle', 'Paste a URL, save a bookmark instantly');
            const body  = this._t('featureSpotlightPasteBody',  'Copy any link and press Ctrl+V anywhere on the dashboard — the bookmark form opens with the URL pre-filled and the favicon fetched automatically.');
            const tryLbl   = this._t('featureSpotlightPasteTry',   'Try it');
            const closeLbl = this._t('featureSpotlightPasteClose', 'Close');

            const el = document.createElement('div');
            el.className = 'feature-spotlight';
            el.setAttribute('role', 'complementary');
            el.setAttribute('aria-label', title);
            el.innerHTML = `
                <div class="feature-spotlight-stripe"></div>
                <div class="feature-spotlight-body">
                    <div class="feature-spotlight-icon">${ICON_SVG}</div>
                    <div class="feature-spotlight-content">
                        <p class="feature-spotlight-title"></p>
                        <p class="feature-spotlight-text"></p>
                    </div>
                </div>
                <div class="feature-spotlight-actions">
                    <button class="feature-spotlight-try" type="button"></button>
                    <button class="feature-spotlight-close" type="button"></button>
                </div>`;

            el.querySelector('.feature-spotlight-title').textContent = title;
            el.querySelector('.feature-spotlight-text').textContent  = body;
            el.querySelector('.feature-spotlight-try').textContent   = tryLbl;
            el.querySelector('.feature-spotlight-close').textContent = closeLbl;

            el.querySelector('.feature-spotlight-try').addEventListener('click', () => {
                this._dismiss();
                if (typeof this.onTry === 'function') this.onTry();
            });

            el.querySelector('.feature-spotlight-close').addEventListener('click', () => {
                this._dismiss();
            });

            document.body.appendChild(el);
            this.el = el;
        }

        _dismiss() {
            if (!this.el) return;
            localStorage.setItem(STORAGE_KEY, '1');
            this.el.classList.remove('show');
        }

        show(delayMs = 1400) {
            if (localStorage.getItem(STORAGE_KEY)) return;
            if (!this.el) this._build();
            clearTimeout(this._showTimer);
            this._showTimer = setTimeout(() => {
                if (this.el) this.el.classList.add('show');
            }, delayMs);
        }

        /** Call from console/dev to force the card visible again */
        reset() {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    window.FeatureSpotlight = FeatureSpotlight;
})();
