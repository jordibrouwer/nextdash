// @ts-check
const { test, expect } = require('./fixtures');
const fs = require('fs');
const path = require('path');

const KEYS = [
    'listFilterHeading',
    'listSectionHeading',
    'listDensityCompact',
    'listDensityComfortable',
    'listDensityGroup',
];

/*
 * Named rather than counted.
 *
 * This asserted "five locales" against a number, so adding Spanish failed it
 * with nothing wrong: the point is that every locale that exists carries the
 * shell strings, and the list guards the other half -- a locale file quietly
 * disappearing. The other language lists in the tree (validate-locale-parity
 * and its neighbours) are spelled out the same way, so a seventh language
 * trips all of them together and on purpose.
 */
const LOCALES = ['de.json', 'en.json', 'es.json', 'fr.json', 'nl.json', 'zh.json'];

test('every locale carries the shell strings', () => {
    const dir = path.join(__dirname, '..', 'locales');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    expect(files, `locales/ holds ${files.join(', ')}`).toEqual(LOCALES);

    const missing = {};
    for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const gaps = KEYS.filter((key) => !data.dashboard || !data.dashboard[key]);
        if (gaps.length) missing[file] = gaps;
    }
    expect(missing).toEqual({});
});

test('the rail headings and density labels are translated, not hardcoded', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await page.waitForFunction(() => window.ViewStyles?.ensureViewStyles != null, null, { timeout: 15_000 });
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());

    const labels = await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        window.ListViewShell.mount(host, {
            id: 'scratch', title: 'T', description: 'D', density: true,
            t: (key, fallback) => `«${key}»${fallback ? '' : ''}`,
            filters: [{ key: 'all', label: 'All', count: 1 }],
            sections: [{ key: 'monitors', label: 'Monitors' }],
            activeFilter: 'all',
        });
        return {
            filterHeading: host.querySelector('.lvs-group--filters .lvs-group-title')?.textContent,
            sectionHeading: host.querySelector('.lvs-group--sections .lvs-group-title')?.textContent,
            compactLabel: host.querySelector('[data-lvs-density="compact"]')?.getAttribute('aria-label'),
            groupLabel: host.querySelector('.lvs-density')?.getAttribute('aria-label'),
        };
    });

    expect(labels.filterHeading).toBe('«dashboard.listFilterHeading»');
    expect(labels.sectionHeading).toBe('«dashboard.listSectionHeading»');
    expect(labels.compactLabel).toBe('«dashboard.listDensityCompact»');
    expect(labels.groupLabel).toBe('«dashboard.listDensityGroup»');
});
