/**
 * Toast notifications and i18n notify helpers.
 */
class DashboardNotifications {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    showNotification(message, type = 'error', { undoCallback = null, duration = 5000, onAction = null, actionLabel = null, durationMs = null } = {}) {
        const d = this.dash;
        if (!window.AppNotification) return;
        const opts = { duration: durationMs ?? duration };
        const undo = undoCallback || onAction;
        if (undo) {
            opts.onAction = undo;
            opts.actionLabel = actionLabel || (d.language ? d.language.t('dashboard.undo') : 'Undo');
        }
        window.AppNotification.show(message, type, opts);
    }


    showGroupedNotification(key, count, buildMessage, type = 'success', options = {}) {
        if (!window.AppNotification?.showGrouped) {
            this.showNotification(buildMessage(count), type, options);
            return;
        }
        // AppNotification understands onAction/actionLabel; undoCallback is this
        // layer's word for it, and showNotification has always translated it.
        // The grouped path did not, so every caller that passed an undo with a
        // grouped toast — bulk delete among them — rendered a toast with the
        // button hidden and the callback unreachable. Same translation here.
        const d = this.dash;
        const { undoCallback = null, onAction = null, actionLabel = null, ...rest } = options || {};
        const undo = undoCallback || onAction;
        const opts = { ...rest };
        if (undo) {
            opts.onAction = undo;
            opts.actionLabel = actionLabel || (d.language ? d.language.t('dashboard.undo') : 'Undo');
        }
        window.AppNotification.showGrouped(key, buildMessage, { count, type, options: opts });
    }


    showErrorNotification(message, options = {}) {
        const d = this.dash;
        if (options.reload && window.AppNotification?.showErrorWithReload) {
            window.AppNotification.showErrorWithReload(message, options);
            return;
        }
        const notifOpts = { ...options };
        if (typeof options.retry === 'function') {
            notifOpts.onAction = options.retry;
            // Through tDashboard, which compares the answer against the key it
            // asked for: t() returns the key itself when there is no string, so
            // `t(...) || 'Retry'` puts "dashboard.retry" on the button rather
            // than the fallback -- which is what the button read for as long as
            // the key was missing.
            notifOpts.actionLabel = this.tDashboard('retry', 'Retry');
            delete notifOpts.retry;
        }
        this.showNotification(message, 'error', notifOpts);
    }


    tDashboard(key, fallback = '') {
        const d = this.dash;
        const fullKey = `dashboard.${key}`;
        const value = d.language?.t(fullKey);
        return value && value !== fullKey ? value : fallback;
    }


    tConfig(key, fallback = '') {
        const d = this.dash;
        const fullKey = `config.${key}`;
        const value = d.language?.t(fullKey);
        return value && value !== fullKey ? value : fallback;
    }


    notifyDashboard(key, fallback, type = 'success', options = {}) {
        const message = this.tDashboard(key, fallback);
        if (type === 'error') {
            this.showErrorNotification(message, options);
            return;
        }
        this.showNotification(message, type, options);
    }


    notifyConfig(key, fallback, type = 'success', options = {}) {
        const message = this.tConfig(key, fallback);
        if (type === 'error') {
            this.showErrorNotification(message, options);
            return;
        }
        this.showNotification(message, type, options);
    }

}

window.DashboardNotifications = DashboardNotifications;
