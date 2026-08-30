/* Extension UI translations (en / nl / de / fr / zh) */

const EXT_SUPPORTED = new Set(['en', 'nl', 'de', 'fr', 'zh']);
let extStrings = {};
let extLang = 'en';

function extNormalizeLang(code) {
    const base = String(code || 'en').toLowerCase().split('-')[0];
    return EXT_SUPPORTED.has(base) ? base : 'en';
}

function extInterpolate(text, vars) {
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : `{${key}}`));
}

function extT(key, fallback, vars) {
    const raw = extStrings[key] ?? fallback ?? key;
    return extInterpolate(raw, vars);
}

async function extLoadLocaleFile(lang) {
    const url = chrome.runtime.getURL(`locales/${lang}.json`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`locale ${lang}`);
    return res.json();
}

async function resolveExtensionLang() {
    const stored = await chrome.storage.sync.get(['extensionLocale', 'serverUrl']);
    let lang = stored.extensionLocale;

    if (!lang && stored.serverUrl) {
        try {
            const res = await fetch(new URL('/api/settings', stored.serverUrl));
            if (res.ok) {
                const settings = await res.json();
                if (settings.language) {
                    lang = settings.language;
                }
            }
        } catch (e) {
            // use browser locale
        }
    }

    if (!lang && typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
        lang = chrome.i18n.getUILanguage();
    }
    if (!lang && typeof navigator !== 'undefined' && navigator.language) {
        lang = navigator.language;
    }

    return extNormalizeLang(lang || 'en');
}

async function loadExtensionLocale(lang) {
    const normalized = extNormalizeLang(lang);
    try {
        extStrings = await extLoadLocaleFile(normalized);
        extLang = normalized;
    } catch (e) {
        extStrings = await extLoadLocaleFile('en');
        extLang = 'en';
    }
    return extLang;
}

/** Service worker / background — no DOM. */
async function initExtensionI18nBackground() {
    const lang = await resolveExtensionLang();
    return loadExtensionLocale(lang);
}

async function initExtensionI18n() {
    await initExtensionI18nBackground();
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.lang = extLang;
        applyExtensionI18n();
    }
}

function applyExtensionI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        el.textContent = extT(key, el.textContent);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = extT(key, el.placeholder);
    });

    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        el.title = extT(key, el.title);
    });

    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
        const key = el.getAttribute('data-i18n-aria');
        el.setAttribute('aria-label', extT(key, el.getAttribute('aria-label') || ''));
    });
}
