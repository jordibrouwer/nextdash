/*
 * The words the theme groups draw with CSS, in the reader's language.
 *
 * A few group themes spell a status out next to the shape (Legible's
 * "● online", Subway Map's "delayed"). CSS cannot translate, so the words come
 * in as custom properties on <html> -- --nd-word-online: "online" -- and the
 * stylesheets read them with var(--nd-word-online, "online"), keeping the
 * shape glyph themselves. Set again whenever the language changes.
 */
(function () {
    'use strict';

    var WORDS = {
        '--nd-word-online': ['dashboard.themeGroupWordOnline', 'online'],
        '--nd-word-checking': ['dashboard.themeGroupWordChecking', 'checking'],
        '--nd-word-offline': ['dashboard.themeGroupWordOffline', 'offline'],
        '--nd-word-out-of-service': ['dashboard.themeGroupWordOutOfService', 'out of service'],
        '--nd-word-delayed': ['dashboard.themeGroupWordDelayed', 'delayed']
    };

    function apply(language) {
        var lang = language || (window.dashboardInstance && window.dashboardInstance.language)
            || (window.configManager && window.configManager.language);
        if (!lang || typeof lang.t !== 'function') return;
        var style = document.documentElement.style;
        Object.keys(WORDS).forEach(function (name) {
            var key = WORDS[name][0];
            var word = lang.t(key);
            if (!word || word === key) word = WORDS[name][1];
            style.setProperty(name, JSON.stringify(String(word)));
        });
    }

    document.addEventListener('nextdash:translations-applied', function (event) {
        apply(event.detail && event.detail.language);
    });
    document.addEventListener('DOMContentLoaded', function () { apply(); });
})();
