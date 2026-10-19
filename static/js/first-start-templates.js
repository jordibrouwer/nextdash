/**
 * The bundled page templates' address filling.
 *
 * The first-start card that used to live here ("What do you want?") is the
 * start guide now (start-guide.js). What stays is the one function the import
 * dialog uses to fill the bundled templates from a single server address.
 */
(function (global) {
    'use strict';

    const SERVER = '{server}';

    /**
     * A variable's Default filled with the one server address. Mirrors
     * expandTemplateDefault in bundled_templates.go: a typed scheme or port
     * wins, a Default without {server} stands as it is, and an address with a
     * path, a query or a user name gives nothing.
     */
    function expandDefault(def, server) {
        def = String(def || '').trim();
        if (!def) return '';
        if (!def.includes(SERVER)) return def.replace(/\/+$/, '');
        server = String(server || '').trim().replace(/\/+$/, '');
        if (!server) return '';
        let scheme = '';
        const at = server.indexOf('://');
        if (at >= 0) {
            scheme = server.slice(0, at).toLowerCase();
            server = server.slice(at + 3);
        }
        if (/[/?#@\s]/.test(server) || (scheme && scheme !== 'http' && scheme !== 'https')) return '';
        let typed;
        let base;
        try {
            typed = new URL(`http://${server}`);
            base = new URL(def.replace(SERVER, 'server.invalid'));
        } catch {
            return '';
        }
        if (!typed.hostname) return '';
        const port = typed.port || base.port;
        return `${scheme || base.protocol.replace(':', '')}://${typed.hostname}${port ? `:${port}` : ''}`;
    }

    // A function, because the import dialog checks for one before it asks.
    function FirstStartTemplates() {}
    FirstStartTemplates.expandDefault = expandDefault;
    global.FirstStartTemplates = FirstStartTemplates;
})(window);
