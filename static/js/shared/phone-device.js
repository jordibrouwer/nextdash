/*
 * What a phone changes, in one place.
 *
 * Three settings only apply on a touch device without hover (a phone or a
 * tablet): opening links in a new tab, hiding toasts and hiding the corner
 * cards. They all ask the same question here, so "a phone" means the same
 * thing in each of them.
 *
 * opensInNewTab() is the one place that decides how a link opens. On a phone
 * Open links in a new tab on phones rules, which is off by default (a new tab
 * on a phone is easy to lose); everywhere else Open links in a new tab does.
 * `fallback` is what a missing desktop setting counts as, for the few callers
 * that always treated "never saved" as on.
 *
 * Loaded from the document head so the lazily fetched modules can reach it.
 */
(function (global) {
    'use strict';

    function isPhoneDevice() {
        return typeof global.matchMedia === 'function'
            && global.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }

    function opensInNewTab(settings, fallback = false) {
        if (isPhoneDevice()) return settings?.openLinksNewTabMobile === true;
        const value = settings?.openInNewTab;
        return value === undefined || value === null ? fallback : Boolean(value);
    }

    // For the places that always opened a new tab on a computer (the news
    // popover and window): only a phone follows the setting.
    function opensInNewTabUnlessPhone(settings) {
        return isPhoneDevice() ? settings?.openLinksNewTabMobile === true : true;
    }

    function openUrl(url, settings) {
        if (opensInNewTabUnlessPhone(settings)) global.open(url, '_blank', 'noopener,noreferrer');
        else global.location.assign(url);
    }

    global.isPhoneDevice = isPhoneDevice;
    global.opensInNewTab = opensInNewTab;
    global.opensInNewTabUnlessPhone = opensInNewTabUnlessPhone;
    global.openUrl = openUrl;
})(window);
