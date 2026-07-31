/**
 * Catalog of config setting promos. To highlight a new or updated control:
 *
 * 1. Add data-config-setting-promo-anchor="<id>" on the field in dashboard-config.js
 * 2. Add locale strings (title, body) under config.* in locales/*.json
 * 3. Append a definition below — bump id suffix to re-show after a redesign
 */
(function registerConfigSettingPromos(global) {
    'use strict';

    /** @type {Array<{ id: string, section: string, anchor: string, titleKey: string, bodyKey: string, ensureSubTab?: string, placement?: string }>} */
    const PROMOS = [
        {
            id: 'random-theme-v2',
            section: 'appearance',
            // Random theme lives on the main Appearance panel, not Custom themes.
            ensureSubTab: 'general',
            anchor: 'randomThemeMode',
            placement: 'below',
            titleKey: 'config.randomThemePromoTitle',
            bodyKey: 'config.randomThemePromoBody',
        },
    ];

    global.ConfigSettingPromo?.registerAll?.(PROMOS);
}(typeof window !== 'undefined' ? window : globalThis));
