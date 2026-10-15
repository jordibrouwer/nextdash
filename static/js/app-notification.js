/**
 * Unified toast/notification helper for dashboard, config, colors, and health pages.
 *
 * Queue behaviour: at most one notification is visible at a time. Rapid calls to
 * show() are queued (max _QUEUE_MAX items; oldest pending is replaced when full).
 * After a notification auto-hides, the next queued item appears after a short gap
 * so the CSS fade-out completes before the next one fades in.
 * An explicit hide() clears the queue and dismisses the current notification.
 */
const AppNotification = {
    _timeout: null,
    _queue: [],
    _busy: false,
    _groupBuckets: new Map(),
    _QUEUE_MAX: 3,
    _GAP_MS: 260, // slightly longer than the 0.24s CSS fade-out
    _GROUP_WINDOW_MS: 700,

    ensureHost() {
        let host = document.getElementById('app-notification');
        if (host) return host;

        host = document.createElement('div');
        host.id = 'app-notification';
        host.className = 'app-notification';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        host.setAttribute('aria-hidden', 'true');
        host.innerHTML = `
            <span class="app-notification-icon" aria-hidden="true">
                <svg class="app-notification-ring" viewBox="0 0 36 36"><circle class="ring-track" cx="18" cy="18" r="16"/><circle class="ring-fill" cx="18" cy="18" r="16" pathLength="100"/></svg>
                <svg class="app-notification-glyph" viewBox="0 0 24 24"></svg>
            </span>
            <span class="app-notification-text"></span>
            <button type="button" class="app-notification-action" hidden></button>
            <button type="button" class="app-notification-close" aria-label="Dismiss"></button>
        `;
        host.querySelector('.app-notification-close').addEventListener('click', () => this._advance());
        // Hovering holds the card (and its ring) so a long tip can be read.
        // Mouse only: a tap fires no reliable leave on touch screens.
        host.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this._pause(host); });
        host.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this._resume(host); });

        const mount = () => {
            if (!document.body.contains(host)) {
                document.body.appendChild(host);
            }
        };
        if (document.body) {
            mount();
        } else {
            document.addEventListener('DOMContentLoaded', mount, { once: true });
        }
        return host;
    },

    _GLYPHS: {
        success: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
        warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
        update: '<path d="M12 19V6M6 11l6-6 6 6"/>',
        promo: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
        tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    },

    _setGlyph(host, name) {
        const glyph = host.querySelector('.app-notification-glyph');
        if (glyph) glyph.innerHTML = this._GLYPHS[name] || this._GLYPHS.info;
    },

    // Restart the timeout ring: the host keeps its classes between two toasts of
    // the same type, so the CSS animation would otherwise carry on from the last one.
    _restartRing(host) {
        const fill = host.querySelector('.ring-fill');
        if (!fill) return;
        fill.style.animation = 'none';
        void fill.getBoundingClientRect();
        fill.style.animation = '';
    },

    _pause(host) {
        if (!this._timeout || !host.classList.contains('show')) return;
        clearTimeout(this._timeout);
        this._timeout = null;
        this._remainingMs = Math.max(400, this._remainingMs - (Date.now() - this._timerStart));
        host.classList.add('paused');
    },

    _resume(host) {
        host.classList.remove('paused');
        if (this._timeout || this._remainingMs == null || !host.classList.contains('show')
            || host.classList.contains('persist')) return;
        this._timerStart = Date.now();
        this._timeout = setTimeout(() => this._advance(), this._remainingMs);
    },

    _messageEl(host) {
        return host?.querySelector('.app-notification-text');
    },

    _actionEl(host) {
        return host?.querySelector('.app-notification-action');
    },

    _resolveReloadLabel(options = {}) {
        if (options.reloadLabel) return options.reloadLabel;
        const langObj = window.dashboardInstance?.language
            || window.configManager?.language
            || window.healthLanguage;
        if (langObj?.t) {
            for (const key of ['dashboard.reloadPage', 'config.reloadPage', 'health.reloadPage', 'colors.reloadPage']) {
                const val = langObj.t(key);
                if (typeof val === 'string' && val !== key) return val;
            }
        }
        const lang = document.documentElement.getAttribute('data-lang') || 'en';
        const fallbacks = { en: 'Reload page', nl: 'Pagina herladen', de: 'Seite neu laden', fr: 'Recharger la page' };
        return fallbacks[lang] || fallbacks.en;
    },

    /**
     * Coalesce rapid bulk-action toasts into one message (e.g. "3 bookmarks moved").
     * @param {string} key - Group id; same key within the window merges counts.
     * @param {(count: number) => string} buildMessage
     */
    showGrouped(key, buildMessage, { count = 1, type = 'success', options = {}, windowMs } = {}) {
        if (!key || typeof buildMessage !== 'function') {
            this.show(typeof buildMessage === 'string' ? buildMessage : '', type, options);
            return;
        }
        const windowDuration = Number.isFinite(Number(windowMs))
            ? Number(windowMs)
            : this._GROUP_WINDOW_MS;
        const existing = this._groupBuckets.get(key);
        if (existing) {
            existing.total += Math.max(1, Number(count) || 1);
            clearTimeout(existing.timer);
            existing.timer = setTimeout(() => this._flushGrouped(key), windowDuration);
            if (this._busy) {
                const host = document.getElementById('app-notification');
                const messageEl = this._messageEl(host);
                if (messageEl) {
                    messageEl.textContent = buildMessage(existing.total);
                }
            }
            return;
        }
        const bucket = {
            total: Math.max(1, Number(count) || 1),
            buildMessage,
            type,
            options,
            timer: setTimeout(() => this._flushGrouped(key), windowDuration),
        };
        this._groupBuckets.set(key, bucket);
    },

    _flushGrouped(key) {
        const bucket = this._groupBuckets.get(key);
        if (!bucket) return;
        this._groupBuckets.delete(key);
        clearTimeout(bucket.timer);
        this.show(bucket.buildMessage(bucket.total), bucket.type, bucket.options);
    },

    show(message, type = 'success', options = {}) {
        // 'promo' is every unprompted tip; the public demo shows none of them
        // (shared/demo-lock.js). Answers to what the visitor did still show.
        if (type === 'promo' && window.DemoLock?.on) return;
        // An answer that makes the toast on screen beside the point takes its
        // place at once instead of queueing behind it.
        if (this._busy && options.replace === true) {
            this._queue = [];
            this._showNow(message, type, options);
            return;
        }
        if (this._busy) {
            // A promo is an unprompted tip on a long timer (14s). Queueing an
            // answer to something the user just did behind it means the
            // confirmation lands seconds after the action, long past the point
            // where it confirms anything — so a real notification takes the slot
            // instead of waiting for the tip to finish.
            if (this._currentType === 'promo' && type !== 'promo') {
                this._showNow(message, type, options);
                return;
            }
            // A tip already waiting is dropped rather than kept ahead of an
            // answer to something the user just did. The check above catches a
            // promo holding the screen; this catches one holding the queue —
            // switching a bookmark to Periodic raised its confirmation behind
            // the search-mode tip and the reader saw nothing happen at all.
            if (type !== 'promo') {
                this._queue = this._queue.filter((entry) => entry.type !== 'promo');
            }
            if (this._queue.length >= this._QUEUE_MAX) {
                // Replace the last queued item instead of growing unboundedly
                this._queue[this._queue.length - 1] = { message, type, options };
            } else {
                this._queue.push({ message, type, options });
            }
            return;
        }
        this._showNow(message, type, options);
    },

    _showNow(message, type, options) {
        this._busy = true;
        const host = this.ensureHost();
        const messageEl = this._messageEl(host);
        const actionEl = this._actionEl(host);
        if (!host || !messageEl) { this._busy = false; return; }

        const normalized = ['success', 'error', 'warning', 'info', 'update', 'promo'].includes(type) ? type : 'success';
        this._currentType = normalized;
        const persist = options.persist === true;

        // textContent by default — messages can contain user data (bookmark names).
        // allowHtml is opt-in for our own translated markup only, never user input.
        if (options.allowHtml === true) {
            messageEl.innerHTML = message;
        } else {
            messageEl.textContent = message;
        }
        // A session tip rides on 'promo' and carries a label; it gets the bulb.
        const isTip = normalized === 'promo' && !!messageEl.querySelector('.app-notification-tip-label');
        this._setGlyph(host, isTip ? 'tip' : normalized);
        host.className = `app-notification ${normalized}`;
        if (persist) host.classList.add('persist');
        if (options.onAction) host.classList.add('has-action');
        host.classList.add('show');
        host.setAttribute('aria-hidden', 'false');

        if (actionEl) {
            actionEl.hidden = true;
            actionEl.textContent = '';
            actionEl.onclick = null;
            if (typeof options.onAction === 'function') {
                actionEl.hidden = false;
                actionEl.textContent = options.actionLabel || options.undoLabel || 'Undo';
                actionEl.onclick = () => {
                    options.onAction();
                    this.hide();
                };
            }
        }

        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }

        if (!persist) {
            const duration = Number.isFinite(Number(options.durationMs))
                ? Number(options.durationMs)
                : Number.isFinite(Number(options.duration))
                    ? Number(options.duration)
                    : 5000;
            host.style.setProperty('--notification-duration', `${duration}ms`);
            this._restartRing(host);
            this._remainingMs = duration;
            this._timerStart = Date.now();
            this._timeout = setTimeout(() => this._advance(), duration);
            // A card that appears under a resting pointer never gets pointerenter.
            if (host.matches(':hover')) this._pause(host);
        }
    },

    // Called when the current notification's timer fires (auto-advance through queue).
    // Does NOT clear the queue — only explicit hide() does that.
    _advance() {
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
        const host = document.getElementById('app-notification');
        if (host) {
            host.classList.remove('show', 'success', 'error', 'warning', 'info', 'update', 'promo', 'has-action', 'persist', 'paused');
            host.setAttribute('aria-hidden', 'true');
            const actionEl = this._actionEl(host);
            if (actionEl) {
                actionEl.hidden = true;
                actionEl.textContent = '';
                actionEl.onclick = null;
            }
        }
        // The promo is gone from the host, so it must stop granting the takeover
        // above — during the gap below _busy is still true and the next caller
        // should queue normally.
        this._currentType = null;
        const next = this._queue.shift();
        if (next) {
            // Keep _busy = true during the gap so new show() calls queue correctly
            setTimeout(() => this._showNow(next.message, next.type, next.options), this._GAP_MS);
        } else {
            this._busy = false;
        }
    },

    // Explicit dismiss: clears the queue and hides immediately.
    hide() {
        this._groupBuckets.forEach((bucket) => clearTimeout(bucket.timer));
        this._groupBuckets.clear();
        this._queue = [];
        this._advance();
    },

    /** Swap the visible toast without queue gap (e.g. saving → saved). */
    replace(message, type = 'success', options = {}) {
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
        this._groupBuckets.forEach((bucket) => clearTimeout(bucket.timer));
        this._groupBuckets.clear();
        this._queue = [];
        this._showNow(message, type, options);
    },

    showErrorWithReload(message, options = {}) {
        this.show(message, 'error', {
            persist: true,
            actionLabel: this._resolveReloadLabel(options),
            onAction: () => window.location.reload(),
        });
    },
};

if (typeof window !== 'undefined') {
    window.AppNotification = AppNotification;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => AppNotification.ensureHost(), { once: true });
    } else {
        AppNotification.ensureHost();
    }
}
