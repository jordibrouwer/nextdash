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
        window.AppNotification.showGrouped(key, buildMessage, { count, type, options });
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
            notifOpts.actionLabel = d.language?.t('dashboard.retry') || 'Retry';
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
