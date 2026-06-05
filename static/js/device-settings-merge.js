/**
 * Device-specific settings: merge server settings with local device overrides.
 * Server-authoritative keys (favicon, font, collections) always win from the API.
 */
(function (global) {
    'use strict';

    const DEVICE_SETTINGS_KEY = 'dashboardSettings';
    const DEVICE_FLAG_KEY = 'deviceSpecificSettings';

    /** Always loaded from server; never kept in device localStorage overlay. */
    const GLOBAL_SERVER_SETTING_KEYS = [
        'enableCustomFavicon',
        'customFaviconPath',
        'enableCustomFont',
        'customFontPath',
        'fontPreset',
        'collections'
    ];

    function isDeviceSpecificEnabled() {
        try {
            return localStorage.getItem(DEVICE_FLAG_KEY) === 'true';
        } catch {
            return false;
        }
    }

    function getDeviceSettingsRaw() {
        try {
            const stored = localStorage.getItem(DEVICE_SETTINGS_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch {
            return null;
        }
    }

    function pickDeviceLocalSettings(settings) {
        const copy = { ...(settings || {}) };
        for (const key of GLOBAL_SERVER_SETTING_KEYS) {
            delete copy[key];
        }
        return copy;
    }

    function mergeServerAndDeviceSettings(serverSettings, deviceSettings) {
        const server = { ...(serverSettings || {}) };
        if (!isDeviceSpecificEnabled()) {
            return server;
        }
        const device = deviceSettings && typeof deviceSettings === 'object' ? deviceSettings : getDeviceSettingsRaw();
        if (!device) {
            return server;
        }
        const merged = { ...server, ...device };
        for (const key of GLOBAL_SERVER_SETTING_KEYS) {
            if (Object.prototype.hasOwnProperty.call(server, key)) {
                merged[key] = server[key];
            }
        }
        return merged;
    }

    function saveDeviceLocalSettings(settings) {
        try {
            localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(pickDeviceLocalSettings(settings)));
        } catch {
            // ignore quota / privacy errors
        }
    }

    /** Drop server-authoritative keys from device cache after a global server save. */
    function pruneDeviceCacheAfterServerSave() {
        if (!isDeviceSpecificEnabled()) {
            return;
        }
        const device = getDeviceSettingsRaw();
        if (!device) {
            return;
        }
        saveDeviceLocalSettings(device);
    }

    function clearDeviceLocalSettings() {
        try {
            localStorage.removeItem(DEVICE_SETTINGS_KEY);
        } catch {
            // ignore
        }
    }

    global.DeviceSettingsMerge = {
        GLOBAL_SERVER_SETTING_KEYS,
        isDeviceSpecificEnabled,
        getDeviceSettingsRaw,
        pickDeviceLocalSettings,
        mergeServerAndDeviceSettings,
        saveDeviceLocalSettings,
        pruneDeviceCacheAfterServerSave,
        clearDeviceLocalSettings
    };
})(typeof window !== 'undefined' ? window : this);
