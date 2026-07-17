/**
 * Strip transient / internal keys before persisting settings JSON.
 */
(function (global) {
    function sanitizeSettingsForPersist(settings) {
        if (!settings || typeof settings !== 'object') {
            return settings;
        }
        const copy = { ...settings };
        delete copy._sortMigratedPageIds;

        return copy;
    }

    global.sanitizeSettingsForPersist = sanitizeSettingsForPersist;
}(typeof window !== 'undefined' ? window : globalThis));
