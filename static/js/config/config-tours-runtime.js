/**
 * Shared config tour scheduling and seen-state helpers.
 */
class ConfigToursRuntime {
    constructor(config) {
        this.config = config;
    }

    hasSeenTour({ settingsFlag, storageKeyFallback, tourGlobal }) {
        const c = this.config;
        if (c.settingsData?.[settingsFlag] === true) {
            return true;
        }
        try {
            const key = window[tourGlobal]?.STORAGE_KEY || storageKeyFallback;
            return localStorage.getItem(key) === '1';
        } catch {
            return false;
        }
    }

    syncSeenFromServer({ settingsFlag, storageKeyFallback, tourGlobal }) {
        const c = this.config;
        const key = window[tourGlobal]?.STORAGE_KEY || storageKeyFallback;
        try {
            if (c.settingsData?.[settingsFlag] === true) {
                localStorage.setItem(key, '1');
            } else {
                localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }

    async markTourCompleted({ settingsFlag, storageKeyFallback, tourGlobal, saveSettings = true }) {
        const c = this.config;
        c.settingsData[settingsFlag] = true;
        try {
            localStorage.setItem(
                window[tourGlobal]?.STORAGE_KEY || storageKeyFallback,
                '1'
            );
        } catch {
            // ignore
        }
        if (saveSettings && c.settings?.saveSettingsToServer) {
            await c.settings.saveSettingsToServer(c.settingsData);
        }
    }

    cancelSchedule(statePrefix) {
        const c = this.config;
        c[`_${statePrefix}ScheduleId`] = (c[`_${statePrefix}ScheduleId`] || 0) + 1;
        const timerKey = `_${statePrefix}ScheduleTimer`;
        if (c[timerKey]) {
            clearTimeout(c[timerKey]);
            c[timerKey] = null;
        }
    }

    scheduleTour(statePrefix, { delay = 550, shouldRun, onRun, afterRun } = {}) {
        const c = this.config;
        this.cancelSchedule(statePrefix);
        const runId = c[`_${statePrefix}ScheduleId`] || 0;
        c[`_${statePrefix}ScheduleTimer`] = setTimeout(() => {
            c[`_${statePrefix}ScheduleTimer`] = null;
            if (runId !== c[`_${statePrefix}ScheduleId`]) {
                return;
            }
            if (typeof shouldRun === 'function' && !shouldRun()) {
                return;
            }
            const result = onRun?.();
            if (result && typeof result.then === 'function') {
                void result.then((value) => afterRun?.(value));
            } else {
                afterRun?.(result);
            }
        }, delay);
    }

    isConfigTabActive(tabName) {
        const c = this.config;
        if (c.ui?._currentTab === tabName) {
            return true;
        }
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === tabName) {
            return true;
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash.startsWith(tabName);
    }
}

window.ConfigToursRuntime = ConfigToursRuntime;
