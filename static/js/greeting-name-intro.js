/**
 * The one-time question to existing installs: what should the header call you?
 *
 * The greeting over the large clock ("Good evening, Jordi") has taken a name
 * since it was added, but only through Config → Appearance → Date & time, so
 * nobody who was already using nextDash has any reason to look there. A fresh
 * install is asked in the start guide and never sees this.
 *
 * Built on the shared coach note (coach-note.js), scheduled after the action
 * bar's so it takes its turn once that one is gone. The anchor is the greeting
 * line itself, so the answer shows up right where the note points. It is only
 * asked while that line is drawn (the large clock placement, with a time or a
 * date) and while no name is set. "Save" writes the same setting Config does;
 * "Not now" counts as an answer, so nobody is asked twice.
 */
(function (global) {
    'use strict';

    if (!global.CoachNote) return;

    const MAX_NAME_LENGTH = 40;

    function dash() {
        return global.dashboardInstance || null;
    }

    /** Locale lookup with an English fallback, the way neighbouring panels do it. */
    function t(key, fallback) {
        const lang = dash()?.language;
        if (lang?.t) {
            const full = `coachNote.${key}`;
            const value = lang.t(full);
            if (value && value !== full) return value;
        }
        return fallback;
    }

    function anchor() {
        return document.querySelector('#date-element .date-greeting');
    }

    /** Fresh installs are asked in the start guide; anyone who has a name is done. */
    function canShow() {
        const settings = dash()?.settings;
        if (!settings) return false;
        if (settings.firstRunInstall === true) return false;
        if (String(settings.greetingName || '').trim()) return false;
        return !!anchor();
    }

    function save(value) {
        const d = dash();
        if (!d?.settings) return;
        d.settings.greetingName = String(value || '').trim().slice(0, MAX_NAME_LENGTH);
        void Promise.resolve(d.saveSettings?.({ keys: ['greetingName'] })).catch(() => {});
        d.renderDateWeatherLine?.();
    }

    global.CoachNote.define({
        id: 'greeting-name-intro',
        localKey: 'nextdash:greeting-name-intro-seen',
        anchor,
        side: () => 'below',
        canShow,
        title: () => t('greetingNameTitle', 'What should we call you?'),
        body: () => t('greetingNameBody', 'The header can greet you by name. Leave it out if you like: Config → Appearance → Date & time changes it later.'),
        input: {
            maxLength: MAX_NAME_LENGTH,
            label: () => t('greetingNameLabel', 'Your name'),
            placeholder: () => t('greetingNamePlaceholder', 'Your name'),
        },
        okLabel: () => t('greetingNameSave', 'Save'),
        skipLabel: () => t('greetingNameSkip', 'Not now'),
        onSubmit: save,
    });

    // After the action bar's: the queue keeps the order of asking.
    global.CoachNote.schedule('greeting-name-intro');
})(window);
