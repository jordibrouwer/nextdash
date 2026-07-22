/**
 * Storage Module
 * Handles localStorage for device-specific settings
 */

class ConfigStorage {
    /**
     * Get device-specific settings flag
     * @returns {boolean}
     */
    getDeviceSpecificFlag() {
        return window.DeviceSettingsMerge?.isDeviceSpecificEnabled?.() === true
            || localStorage.getItem('deviceSpecificSettings') === 'true';
    }

    /**
     * Set device-specific settings flag
     * @param {boolean} enabled
     */
    setDeviceSpecificFlag(enabled) {
        try {
            localStorage.setItem('deviceSpecificSettings', enabled.toString());
            return true;
        } catch (error) {
            console.warn('Device-specific flag save failed:', error);
            return false;
        }
    }

    /**
     * Get device-specific settings from localStorage
     * @returns {Object|null}
     */
    getDeviceSettings() {
        if (window.DeviceSettingsMerge?.getDeviceSettingsRaw) {
            return window.DeviceSettingsMerge.getDeviceSettingsRaw();
        }
        // Fallback path when DeviceSettingsMerge isn't loaded yet: guard against
        // corrupt localStorage so a bad JSON blob can't crash config init.
        try {
            const stored = localStorage.getItem('dashboardSettings');
            return stored ? JSON.parse(stored) : null;
        } catch {
            return null;
        }
    }

    /**
     * Save device-local settings (strips server-authoritative keys).
     *
     * Returns whether it stuck. In device-specific mode localStorage *is* the
     * store, not a cache of the server, so a silent failure here means the
     * user's settings are gone — callers must be able to tell instead of
     * reporting success unconditionally.
     *
     * @param {Object} settings
     * @returns {boolean}
     */
    saveDeviceSettings(settings) {
        try {
            if (window.DeviceSettingsMerge?.saveDeviceLocalSettings) {
                return window.DeviceSettingsMerge.saveDeviceLocalSettings(settings) !== false;
            }
            localStorage.setItem('dashboardSettings', JSON.stringify(settings));
            return true;
        } catch (error) {
            console.warn('Device-local settings save failed:', error);
            return false;
        }
    }

    /**
     * Clear device-specific settings from localStorage
     */
    clearDeviceSettings() {
        if (window.DeviceSettingsMerge?.clearDeviceLocalSettings) {
            window.DeviceSettingsMerge.clearDeviceLocalSettings();
            return;
        }
        localStorage.removeItem('dashboardSettings');
    }

    mergeServerAndDeviceSettings(serverSettings, deviceSettings) {
        if (window.DeviceSettingsMerge?.mergeServerAndDeviceSettings) {
            return window.DeviceSettingsMerge.mergeServerAndDeviceSettings(serverSettings, deviceSettings);
        }
        return deviceSettings ? { ...serverSettings, ...deviceSettings } : { ...serverSettings };
    }

    pruneDeviceCacheAfterServerSave() {
        window.DeviceSettingsMerge?.pruneDeviceCacheAfterServerSave?.();
    }
}

// Export for use in other modules
window.ConfigStorage = ConfigStorage;
