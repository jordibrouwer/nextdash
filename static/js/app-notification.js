/**
 * Unified toast/notification helper for dashboard, config, and colors pages.
 */
const AppNotification = {
    _timeout: null,

    _resolveHost() {
        return document.getElementById('notification') || document.getElementById('error-notification');
    },

    _resolveMessageEl(host) {
        if (!host) return null;
        return host.querySelector('#notification-message')
            || host.querySelector('.notification-text')
            || (host.id === 'notification' ? host.querySelector('span') : null);
    },

    _resolveActionEl(host) {
        if (!host) return null;
        return host.querySelector('#notification-action') || host.querySelector('.notification-undo-btn');
    },

    show(message, type = 'success', options = {}) {
        const host = this._resolveHost();
        const messageEl = this._resolveMessageEl(host);
        if (!host || !messageEl) return;

        const normalized = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'success';

        if (host.id === 'error-notification') {
            host.innerHTML = '';
            const textNode = document.createElement('span');
            textNode.className = 'notification-text';
            textNode.textContent = message;
            host.appendChild(textNode);
            const actionEl = this._resolveActionEl(host);
            if (options && typeof options.onAction === 'function') {
                const undoBtn = document.createElement('button');
                undoBtn.type = 'button';
                undoBtn.className = 'notification-undo-btn';
                undoBtn.textContent = options.actionLabel || options.undoLabel || 'Undo';
                undoBtn.addEventListener('click', () => {
                    this.hide();
                    options.onAction();
                });
                host.appendChild(undoBtn);
                host.classList.add('has-undo');
            } else {
                host.classList.remove('has-undo');
            }
            host.classList.remove('success', 'error', 'warning', 'info', 'notification-success', 'notification-error', 'notification-warning', 'notification-info');
            if (normalized === 'success') host.classList.add('success');
            if (normalized === 'error') host.classList.add('error');
            if (normalized === 'warning') host.classList.add('warning');
            if (normalized === 'info') host.classList.add('info');
            requestAnimationFrame(() => {
                host.classList.add('show');
                host.setAttribute('aria-hidden', 'false');
            });
        } else {
            messageEl.textContent = message;
            host.className = `notification ${normalized}`;
            host.classList.add('show');
            host.setAttribute('role', 'status');
            host.setAttribute('aria-live', 'polite');

            const actionEl = this._resolveActionEl(host);
            if (actionEl) {
                actionEl.hidden = true;
                actionEl.textContent = '';
                actionEl.onclick = null;
                if (options && typeof options.onAction === 'function') {
                    actionEl.hidden = false;
                    actionEl.textContent = options.actionLabel || options.undoLabel || 'Undo';
                    actionEl.onclick = () => {
                        options.onAction();
                        this.hide();
                    };
                }
            }
        }

        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }

        if (!options.persist) {
            const duration = Number.isFinite(Number(options.durationMs))
                ? Number(options.durationMs)
                : Number.isFinite(Number(options.duration))
                    ? Number(options.duration)
                    : 3000;
            this._timeout = setTimeout(() => this.hide(), duration);
        }
    },

    hide() {
        const host = this._resolveHost();
        if (!host) return;
        host.classList.remove('show', 'success', 'error', 'warning', 'info', 'has-undo', 'notification-success', 'notification-error', 'notification-warning', 'notification-info');
        host.setAttribute('aria-hidden', 'true');
        const actionEl = this._resolveActionEl(host);
        if (actionEl) {
            actionEl.hidden = true;
            actionEl.textContent = '';
            actionEl.onclick = null;
        }
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
    }
};

if (typeof window !== 'undefined') {
    window.AppNotification = AppNotification;
}
