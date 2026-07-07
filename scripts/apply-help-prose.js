#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const prose = require('./help-prose-content');

const root = path.join(__dirname, '..', 'locales');
const bodyKeyMap = [
    ['helpPageQuickStartItems', 'helpPageQuickStartBody'],
    ['helpPageOnboardingItems', 'helpPageOnboardingBody'],
    ['helpPageConfigGeneralItems', 'helpPageConfigGeneralBody'],
    ['helpPageConfigTabsItems', 'helpPageConfigTabsBody'],
    ['helpPageNavigationItems', 'helpPageNavigationBody'],
    ['helpPageMobileItems', 'helpPageMobileBody'],
    ['helpPageKeyboardItems', 'helpPageKeyboardBody'],
    ['helpPageBookmarksDashboardItems', 'helpPageBookmarksDashboardBody'],
    ['helpPageSearchItems', 'helpPageSearchBody'],
    ['helpPageDateWeatherItems', 'helpPageDateWeatherBody'],
    ['helpPageSmartItems', 'helpPageSmartBody'],
    ['helpPageTagsItems', 'helpPageTagsBody'],
    ['helpPageCollectionsItems', 'helpPageCollectionsBody'],
    ['helpPageSortingItems', 'helpPageSortingBody'],
    ['helpPageManageItems', 'helpPageManageBody'],
    ['helpPageFindersItems', 'helpPageFindersBody'],
    ['helpPageStatusItems', 'helpPageStatusBody'],
    ['helpPageHealthItems', 'helpPageHealthBody'],
    ['helpPageBackupItems', 'helpPageBackupBody'],
    ['helpPageBrandingItems', 'helpPageBrandingBody'],
    ['helpPageDataItems', 'helpPageDataBody'],
    ['helpPageExtensionItems', 'helpPageExtensionBody'],
    ['helpPageSecurityItems', 'helpPageSecurityBody'],
    ['helpPageTroubleshootItems', 'helpPageTroubleshootBody'],
];

for (const lang of ['en', 'nl', 'de', 'fr']) {
    const file = path.join(root, `${lang}.json`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const copy = prose[lang] || prose.en;
    const config = data.config;

    if (copy.helpIntro) {
        config.helpIntro = copy.helpIntro;
    }
    if (copy.helpPageTipsIntro) {
        config.helpPageTipsIntro = copy.helpPageTipsIntro;
    }
    if (copy.helpPageTipsToggle) {
        config.helpPageTipsToggle = copy.helpPageTipsToggle;
    }
    if (copy.helpPageConfigTabsIntro === '') {
        config.helpPageConfigTabsIntro = '';
    }
    if (copy.helpPageMobileIntro === '') {
        config.helpPageMobileIntro = '';
    }

    for (const [oldKey, newKey] of bodyKeyMap) {
        if (copy[newKey]) {
            config[newKey] = copy[newKey];
            delete config[oldKey];
        }
    }

    fs.writeFileSync(file, `${JSON.stringify(data, null, 4)}\n`);
    console.log(`Updated ${lang}.json`);
}
