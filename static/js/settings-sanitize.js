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
        // The archive keys are written by their own panel and route. Sent back
        // with every settings save, the copy loaded with the page undid a
        // "Forget keys" or a new pair the next time anything else was saved;
        // left out, the server keeps what it has.
        delete copy.archiveSaveAccessKey;
        delete copy.archiveSaveSecret;
        // The Unraid server likewise has its own route (/api/unraid/settings).
        delete copy.unraidServers;
        // App discovery writes these from the server (Close, Add, Ignore, Undo,
        // the host the page was opened on); a page loaded before would send
        // its older copy back and undo them.
        delete copy.discoveryCardDone;
        delete copy.discoveryIgnored;
        delete copy.dockerHostSeen;

        return copy;
    }

    global.sanitizeSettingsForPersist = sanitizeSettingsForPersist;
}(typeof window !== 'undefined' ? window : globalThis));
