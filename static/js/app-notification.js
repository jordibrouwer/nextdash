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
            <span class="app-notification-text"></span>
            <button type="button" class="app-notification-action" hidden></button>
        `;

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
            this._timeout = setTimeout(() => this._advance(), duration);
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
            host.classList.remove('show', 'success', 'error', 'warning', 'info', 'update', 'promo', 'has-action', 'persist');
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
