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
        localStorage.setItem('deviceSpecificSettings', enabled.toString());
    }

    /**
     * Get device-specific settings from localStorage
     * @returns {Object|null}
     */
    getDeviceSettings() {
        if (window.DeviceSettingsMerge?.getDeviceSettingsRaw) {
            return window.DeviceSettingsMerge.getDeviceSettingsRaw();
        }
        const stored = localStorage.getItem('dashboardSettings');
        return stored ? JSON.parse(stored) : null;
    }

    /**
     * Save device-local settings (strips server-authoritative keys)
     * @param {Object} settings
     */
    saveDeviceSettings(settings) {
        if (window.DeviceSettingsMerge?.saveDeviceLocalSettings) {
            window.DeviceSettingsMerge.saveDeviceLocalSettings(settings);
            return;
        }
        localStorage.setItem('dashboardSettings', JSON.stringify(settings));
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
